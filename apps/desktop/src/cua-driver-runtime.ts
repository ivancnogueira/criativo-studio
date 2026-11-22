import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { globalShortcut, screen, systemPreferences } from "electron";
import type { CuaActionRequest, CuaActionResult } from "@criativo/contracts";
import { buildCuaDaemonHeaders } from "./cua-auth-headers.ts";
import { CuaOverlayController } from "./cua-overlay.ts";
import { registerTrustedIpcHandle } from "./desktop-security.ts";

export interface CuaDesktopRuntimeHandle {
  bridgeUrl: string;
  bridgeToken: string;
  abortNow: (reason?: string) => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * Runtime CUA cross-platform no processo principal do Electron (G-21).
 * Fornece bridge HTTP loopback autenticado para o daemon, overlay visual e atalho Ctrl/Cmd+Shift+Esc.
 */
export async function startCuaDesktopRuntime(options: {
  getDaemonBaseUrl: () => string;
  getDaemonPort?: () => number | null | undefined;
  getServerToken?: () => string | null | undefined;
  onLog?: (msg: string) => void;
}): Promise<CuaDesktopRuntimeHandle> {
  const bridgeToken = randomBytes(24).toString("hex");
  const overlay = new CuaOverlayController();
  let aborted = false;

  const getAuthHeaders = (extra?: Record<string, string>): Record<string, string> =>
    buildCuaDaemonHeaders(options.getServerToken?.() ?? null, extra);

  const checkAccessibilityGranted = (): boolean => {
    if (process.platform === "darwin") {
      try {
        return systemPreferences.isTrustedAccessibilityClient(false);
      } catch {
        return false;
      }
    }
    return true;
  };

  const executeNativeStep = async (req: CuaActionRequest): Promise<CuaActionResult> => {
    if (aborted) {
      throw new Error("Execução CUA bloqueada: parada de emergência ativa.");
    }
    if (!checkAccessibilityGranted()) {
      throw new Error("Permissão de acessibilidade do sistema operacional pendente.");
    }

    const display = screen.getPrimaryDisplay();
    const cursor =
      typeof req.x === "number" && typeof req.y === "number"
        ? {
            x: Math.max(0, Math.min(display.bounds.width, req.x)),
            y: Math.max(0, Math.min(display.bounds.height, req.y)),
          }
        : null;

    await overlay.showState({
      cursor,
      region: req.region ?? null,
      label: `${req.agente_id}: ${req.action}`,
    });

    return {
      ok: true,
      action: req.action,
      window_title: req.window_title ?? "Desktop Host",
      cursor,
      highlight_region: req.region ?? null,
      screenshot_base64: null,
      executed_at: new Date().toISOString(),
      message: `Ação ${req.action} processada pelo runtime CUA.`,
    };
  };

  const abortNow = async (reason = "Atalho de emergência acionado."): Promise<void> => {
    aborted = true;
    overlay.hide();
    const daemonBaseUrl = options.getDaemonBaseUrl();
    if (daemonBaseUrl) {
      await fetch(`${daemonBaseUrl}/api/cua/abort`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ reason }),
      }).catch(() => {});
    }
  };

  const server: Server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/cua/execute") {
      res.writeHead(404);
      res.end();
      return;
    }
    const tokenHeader = req.headers["x-criativo-cua-token"];
    if (tokenHeader !== bridgeToken) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, erro: "Token CUA inválido." }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CuaActionRequest;
      const result = await executeNativeStep(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, erro: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((resolveBind) => {
    server.listen(0, "127.0.0.1", () => resolveBind());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const bridgeUrl = `http://127.0.0.1:${port}`;

  try {
    globalShortcut.register("CommandOrControl+Shift+Escape", () => {
      void abortNow("Atalho global CommandOrControl+Shift+Escape acionado.");
    });
  } catch (err) {
    options.onLog?.(`[CUA] Falha ao registrar atalho global de emergência: ${String(err)}`);
  }

  const getPort = () => options.getDaemonPort?.();
  registerTrustedIpcHandle("criativo:cua-abort", getPort, async (_evt, reason: unknown) => {
    await abortNow(typeof reason === "string" && reason.trim() ? reason.trim() : undefined);
    return true;
  });

  registerTrustedIpcHandle("criativo:cua-reset-abort", getPort, async () => {
    aborted = false;
    const daemonBaseUrl = options.getDaemonBaseUrl();
    if (daemonBaseUrl) {
      await fetch(`${daemonBaseUrl}/api/cua/reset-abort`, {
        method: "POST",
        headers: getAuthHeaders(),
      }).catch(() => {});
    }
    return true;
  });

  registerTrustedIpcHandle("criativo:cua-permission-status", getPort, () => ({
    granted: checkAccessibilityGranted(),
    aborted,
  }));

  const daemonBaseUrl = options.getDaemonBaseUrl();
  if (daemonBaseUrl && port > 0) {
    await fetch(`${daemonBaseUrl}/api/cua/register-bridge`, {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        bridgeUrl,
        bridgeToken,
        permissionGranted: checkAccessibilityGranted(),
      }),
    }).catch(() => {});
  }

  return {
    bridgeUrl,
    bridgeToken,
    abortNow,
    async dispose(): Promise<void> {
      try {
        globalShortcut.unregister("CommandOrControl+Shift+Escape");
      } catch {
        // ignora
      }
      overlay.destroy();
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    },
  };
}
