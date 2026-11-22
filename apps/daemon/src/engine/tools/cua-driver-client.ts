import type {
  CuaActionRequest,
  CuaActionResult,
  CuaActionType,
  CuaPoint,
  CuaRegion,
  CuaStatusSnapshot,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";

const BLOCKED_HOTKEY_COMBOS = new Set([
  "alt+f4",
  "ctrl+alt+del",
  "ctrl+alt+delete",
  "ctrl+alt+backspace",
  "cmd+q",
  "command+q",
  "meta+q",
  "super+l",
  "win+l",
  "ctrl+shift+q",
]);

const VALID_ACTIONS = new Set<CuaActionType>([
  "click",
  "double_click",
  "type_text",
  "hotkey",
  "scroll",
  "focus_window",
  "screenshot_region",
]);

export type CuaDesktopExecutor = (
  req: CuaActionRequest,
) => Promise<{
  window_title?: string | null;
  cursor?: CuaPoint | null;
  highlight_region?: CuaRegion | null;
  screenshot_base64?: string | null;
  message?: string;
}>;

export function normalizeHotkeySignature(keys: string[]): string {
  return keys
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .join("+");
}

export class CuaSecurityError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "CuaSecurityError";
    this.statusCode = statusCode;
  }
}

/**
 * Cliente isolado de Computer Use Nativo (G-21).
 * Desligado por padrão; exige habilitação explícita por agente e possui kill-switch global.
 */
export class CuaDriverClient {
  private readonly db: CriativoDatabase;
  private readonly wsHub?: WebSocketHub;
  private desktopExecutor: CuaDesktopExecutor | null = null;
  private bridgeUrl: string | null = null;
  private bridgeToken: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private status: CuaStatusSnapshot = {
    enabled: false,
    running: false,
    aborted: false,
    active_agent_id: null,
    active_window: null,
    cursor: null,
    highlight_region: null,
    permission_granted: process.platform !== "darwin",
    last_action: null,
    last_action_at: null,
    message: null,
  };

  constructor(options: {
    db: CriativoDatabase;
    wsHub?: WebSocketHub;
    desktopExecutor?: CuaDesktopExecutor;
    fetchImpl?: typeof fetch;
  }) {
    this.db = options.db;
    this.wsHub = options.wsHub;
    this.desktopExecutor = options.desktopExecutor ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public attachDesktopExecutor(executor: CuaDesktopExecutor | null): void {
    this.desktopExecutor = executor;
    if (executor) {
      this.status = { ...this.status, enabled: true };
      this.emitStatus();
    }
  }

  public configureDesktopBridge(url: string | null, token: string | null): void {
    this.bridgeUrl = url;
    this.bridgeToken = token;
    this.status = { ...this.status, enabled: Boolean(url) };
    this.emitStatus();
  }

  public setPermissionGranted(granted: boolean): void {
    this.status = { ...this.status, permission_granted: granted };
    this.emitStatus();
  }

  public getStatus(): CuaStatusSnapshot {
    return { ...this.status };
  }

  public isAgentCuaEnabled(agenteId: string): boolean {
    try {
      const row = this.db.connection
        .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ?;")
        .get(agenteId) as { config_json?: string | null } | undefined;
      if (!row?.config_json) return false;
      const parsed = JSON.parse(row.config_json) as { cua_enabled?: unknown };
      return parsed.cua_enabled === true;
    } catch {
      return false;
    }
  }

  public validateActionRequest(req: CuaActionRequest): void {
    if (!VALID_ACTIONS.has(req.action)) {
      throw new CuaSecurityError(`Ação CUA não permitida: '${String(req.action)}'.`, 400);
    }

    if (!req.agente_id || !req.agente_id.trim()) {
      throw new CuaSecurityError("agente_id é obrigatório para ações CUA.", 400);
    }

    if (!this.isAgentCuaEnabled(req.agente_id)) {
      throw new CuaSecurityError(
        `Computer Use Nativo (CUA) está desativado para o agente '${req.agente_id}'. Ative cua_enabled explicitamente nas configurações do agente.`,
        403,
      );
    }

    if (req.action === "click" || req.action === "double_click" || req.action === "scroll") {
      if (
        typeof req.x !== "number" ||
        typeof req.y !== "number" ||
        !Number.isFinite(req.x) ||
        !Number.isFinite(req.y) ||
        req.x < 0 ||
        req.y < 0 ||
        req.x > 16384 ||
        req.y > 16384
      ) {
        throw new CuaSecurityError("Coordenadas CUA inválidas ou fora dos limites de tela seguros.", 400);
      }
    }

    if (req.action === "type_text") {
      if (typeof req.text !== "string" || req.text.length === 0 || req.text.length > 4000) {
        throw new CuaSecurityError("Texto CUA vazio ou excede o limite de 4000 caracteres.", 400);
      }
    }

    if (req.action === "hotkey") {
      const keys = Array.isArray(req.keys) ? req.keys : [];
      const sig = normalizeHotkeySignature(keys);
      if (!sig) {
        throw new CuaSecurityError("Informe keys válidas para ação hotkey.", 400);
      }
      if (BLOCKED_HOTKEY_COMBOS.has(sig)) {
        throw new CuaSecurityError(`Atalho bloqueado por política de segurança CUA: '${sig}'.`, 403);
      }
    }

    if (req.action === "focus_window") {
      if (!req.window_title || !req.window_title.trim()) {
        throw new CuaSecurityError("window_title é obrigatório para focus_window.", 400);
      }
    }

    if (req.action === "screenshot_region" && req.region) {
      const { x, y, width, height } = req.region;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0
      ) {
        throw new CuaSecurityError("Região de captura CUA inválida.", 400);
      }
    }
  }

  public abortAllCuaActions(reason = "Parada de emergência acionada pelo usuário."): CuaStatusSnapshot {
    this.status = {
      ...this.status,
      running: false,
      aborted: true,
      active_agent_id: null,
      cursor: null,
      highlight_region: null,
      message: reason,
    };
    this.emitStatus();
    return this.getStatus();
  }

  public clearAbort(): CuaStatusSnapshot {
    this.status = {
      ...this.status,
      aborted: false,
      message: null,
    };
    this.emitStatus();
    return this.getStatus();
  }

  public async executeAction(req: CuaActionRequest): Promise<CuaActionResult> {
    this.validateActionRequest(req);

    if (this.status.aborted) {
      throw new CuaSecurityError(
        "CUA em estado de parada de emergência. Libere o kill-switch antes de executar novas ações.",
        409,
      );
    }

    if (!this.status.permission_granted) {
      throw new CuaSecurityError(
        "Permissão de Acessibilidade do sistema operacional não concedida para controle CUA.",
        403,
      );
    }

    const cursor: CuaPoint | null =
      typeof req.x === "number" && typeof req.y === "number"
        ? { x: Math.round(req.x), y: Math.round(req.y) }
        : this.status.cursor;

    const highlightRegion: CuaRegion | null = req.region ?? this.status.highlight_region;

    this.status = {
      ...this.status,
      enabled: true,
      running: true,
      active_agent_id: req.agente_id,
      active_window: req.window_title ?? this.status.active_window,
      cursor,
      highlight_region: highlightRegion,
      last_action: req.action,
      message: `Executando ${req.action}`,
    };
    this.emitStatus();

    const executedAt = new Date().toISOString();
    try {
      if (this.desktopExecutor) {
        const res = await this.desktopExecutor(req);
        if (this.status.aborted) {
          throw new CuaSecurityError("Execução CUA interrompida pelo kill-switch.", 409);
        }
        this.status = {
          ...this.status,
          running: false,
          active_window: res.window_title ?? this.status.active_window,
          cursor: res.cursor ?? cursor,
          highlight_region: res.highlight_region ?? highlightRegion,
          last_action: req.action,
          last_action_at: executedAt,
          message: res.message ?? `Ação ${req.action} concluída`,
        };
        this.emitStatus();
        return {
          ok: true,
          action: req.action,
          window_title: this.status.active_window,
          cursor: this.status.cursor,
          highlight_region: this.status.highlight_region,
          screenshot_base64: res.screenshot_base64 ?? null,
          executed_at: executedAt,
          message: this.status.message ?? "OK",
        };
      }

      if (this.bridgeUrl && this.bridgeToken) {
        const response = await this.fetchImpl(`${this.bridgeUrl.replace(/\/+$/, "")}/cua/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-criativo-cua-token": this.bridgeToken,
          },
          body: JSON.stringify(req),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`Desktop CUA bridge HTTP ${response.status}: ${text.slice(0, 200)}`);
        }
        const payload = (await response.json()) as Partial<CuaActionResult>;
        this.status = {
          ...this.status,
          running: false,
          last_action: req.action,
          last_action_at: executedAt,
          message: payload.message ?? `Ação ${req.action} concluída`,
        };
        this.emitStatus();
        return {
          ok: true,
          action: req.action,
          window_title: payload.window_title ?? req.window_title ?? null,
          cursor: payload.cursor ?? cursor,
          highlight_region: payload.highlight_region ?? highlightRegion,
          screenshot_base64: payload.screenshot_base64 ?? null,
          executed_at: executedAt,
          message: payload.message ?? "OK",
        };
      }

      throw new CuaSecurityError(
        "Runtime Desktop CUA não conectado neste ambiente (recurso disponível no app Desktop Electron).",
        503,
      );
    } catch (err) {
      this.status = {
        ...this.status,
        running: false,
        message: err instanceof Error ? err.message : String(err),
      };
      this.emitStatus();
      throw err;
    }
  }

  private emitStatus(): void {
    this.wsHub?.broadcast("cua:status", this.getStatus());
  }
}
