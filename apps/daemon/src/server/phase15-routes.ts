/**
 * Sub-router HTTP REST da Fase 15:
 * Navegador Chromium CDP, Perfis/Proxies, BrowserTakeover, submit_secret, BrowserTeachBar,
 * Mídia (read_video / capture_screen), Duplicação & Failover de Agentes, Sidebar,
 * Configurações & Armazenamento, Conectores (Slack/Discord/GitHub) e Showcase Local.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BackupModelChoice,
  BrowserProfileProxyPayload,
  BrowserTakeoverReason,
  BrowserTargetSelector,
  MensagemChat,
  ProviderName,
  SidebarLayoutMutation,
  StudioUserSettings,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { BackupModelsResolver } from "../engine/runner/backup-models-resolver.ts";
import type {
  BrowserAutomationService,
  BrowserCdpActionName,
} from "../engine/tools/browser-automation.ts";
import type { HumanCdpInputEvent } from "../engine/tools/browser-cdp-session.ts";
import type { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import { readVideoTool } from "../engine/tools/video-reader.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { TranscriptionService } from "../voice/transcription-service.ts";
import type { ConnectorsWebhookService } from "./connectors-webhook-service.ts";
import {
  clearStorageCategory,
  computeStorageUsage,
  deleteStorageFile,
  getUserSettings,
  getWhatsNewInfo,
  updateUserSettings,
} from "./settings-storage-service.ts";
import type { ShowcaseSiteService } from "./showcase-service.ts";
import { duplicateAgent, getSidebarLayout, mutateSidebarLayout } from "./sidebar-service.ts";
import { generateAgentChatReply, type StudioRoutesDeps } from "./studio-routes.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export interface Phase15RouteContext {
  db: CriativoDatabase;
  wsHub: WebSocketHub;
  workspaceRoot: string;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  browserService: BrowserAutomationService;
  screenCapture: ScreenCaptureBridge;
  showcaseService: ShowcaseSiteService;
  connectorsWebhook: ConnectorsWebhookService;
  transcription?: TranscriptionService;
  backupResolver?: BackupModelsResolver;
  studioRoutesDeps: StudioRoutesDeps;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  readRawBody: (req: IncomingMessage) => Promise<Buffer>;
}

const ALLOWED_HUMAN_INPUT_TYPES = new Set<HumanCdpInputEvent["type"]>([
  "mousePressed",
  "mouseReleased",
  "mouseMoved",
  "wheel",
  "keyDown",
  "keyUp",
  "insertText",
]);

function mapHttpErrorStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("não encontrado") || msg.includes("não encontrada")) return 404;
  if (
    msg.includes("recusado") ||
    msg.includes("negado") ||
    msg.includes("bloqueado") ||
    msg.includes("proibido") ||
    msg.includes("exige confirmação")
  ) {
    return 403;
  }
  return 400;
}

export async function tryHandlePhase15Route(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  _url: URL,
  ctx: Phase15RouteContext,
): Promise<boolean> {
  const {
    db,
    wsHub,
    workspaceRoot,
    browserService,
    screenCapture,
    showcaseService,
    connectorsWebhook,
    sendJson,
    readJsonBody,
    readRawBody,
  } = ctx;

  // =========================================================================
  // 1. Navegador CDP, Perfis Persistentes & Proxies
  // =========================================================================

  if (method === "GET" && path === "/api/navegador/status") {
    sendJson(res, 200, browserService.getStatus());
    return true;
  }

  if (method === "GET" && path === "/api/navegador/perfis") {
    sendJson(res, 200, { perfis: browserService.listProfiles() });
    return true;
  }

  if (method === "POST" && path === "/api/navegador/perfis") {
    try {
      const body = await readJsonBody(req);
      const perfil = browserService.createProfile({
        nome: String(body.nome ?? ""),
        cor_hex: typeof body.cor_hex === "string" ? body.cor_hex : undefined,
        proxy_json:
          body.proxy_json && typeof body.proxy_json === "object"
            ? (body.proxy_json as BrowserProfileProxyPayload)
            : undefined,
      });
      sendJson(res, 201, { perfil });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const perfilClearMatch = path.match(/^\/api\/navegador\/perfis\/([^/]+)\/limpar$/);
  if (method === "POST" && perfilClearMatch) {
    try {
      const perfilId = decodeURIComponent(perfilClearMatch[1]!);
      const result = await browserService.clearProfileStorage(perfilId);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const perfilOpenMatch = path.match(/^\/api\/navegador\/perfis\/([^/]+)\/abrir$/);
  if (method === "POST" && perfilOpenMatch) {
    try {
      const perfilId = decodeURIComponent(perfilOpenMatch[1]!);
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
      const targetUrl =
        typeof body.url === "string" && body.url.trim() ? body.url.trim() : "https://www.google.com";
      const result = await browserService.openProfileWindow(perfilId, targetUrl);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const perfilIdMatch = path.match(/^\/api\/navegador\/perfis\/([^/]+)$/);
  if (perfilIdMatch && (method === "PUT" || method === "DELETE")) {
    const perfilId = decodeURIComponent(perfilIdMatch[1]!);
    try {
      if (method === "PUT") {
        const body = await readJsonBody(req);
        const result = await browserService.updateProfile(perfilId, {
          nome: typeof body.nome === "string" ? body.nome : undefined,
          cor_hex: typeof body.cor_hex === "string" ? body.cor_hex : undefined,
          cdp_porta:
            body.cdp_porta === null
              ? null
              : typeof body.cdp_porta === "number" || typeof body.cdp_porta === "string"
                ? Number(body.cdp_porta)
                : undefined,
          proxy_json:
            body.proxy_json === null
              ? null
              : body.proxy_json && typeof body.proxy_json === "object"
                ? (body.proxy_json as BrowserProfileProxyPayload)
                : undefined,
        });
        sendJson(res, 200, result);
      } else {
        const result = await browserService.deleteProfile(perfilId);
        sendJson(res, 200, result);
      }
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (method === "GET" && path === "/api/navegador/proxies") {
    sendJson(res, 200, { proxies: browserService.listProxies() });
    return true;
  }

  if (method === "POST" && path === "/api/navegador/proxies") {
    try {
      const body = await readJsonBody(req);
      const proxy = browserService.saveProxy({
        proxy_id: typeof body.proxy_id === "string" ? body.proxy_id : undefined,
        nome: String(body.nome ?? ""),
        servidor: String(body.servidor ?? ""),
        usuario: typeof body.usuario === "string" ? body.usuario : null,
        senha: typeof body.senha === "string" ? body.senha : null,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
      });
      sendJson(res, 201, { proxy });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const proxyDeleteMatch = path.match(/^\/api\/navegador\/proxies\/([^/]+)$/);
  if (method === "DELETE" && proxyDeleteMatch) {
    const proxyId = decodeURIComponent(proxyDeleteMatch[1]!);
    const deleted = browserService.deleteProxy(proxyId);
    if (!deleted) {
      sendJson(res, 404, { erro: `Proxy '${proxyId}' não encontrado.` });
      return true;
    }
    sendJson(res, 200, { ok: true, proxy_id: proxyId });
    return true;
  }

  // =========================================================================
  // 2. Sessões CDP, Takeover Remoto, Credencial Direta e BrowserTeachBar
  // =========================================================================

  if (method === "POST" && path === "/api/navegador/sessoes/acao") {
    try {
      const body = await readJsonBody(req);
      const action = String(body.action ?? "") as BrowserCdpActionName;
      if (!action) {
        sendJson(res, 400, { erro: "Informe 'action' em /api/navegador/sessoes/acao." });
        return true;
      }
      const result = await browserService.executeAction({
        ...(body as Record<string, unknown>),
        action,
      });
      sendJson(res, 200, { ok: true, result });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const takeoverStartMatch = path.match(/^\/api\/navegador\/sessoes\/([^/]+)\/takeover\/iniciar$/);
  if (method === "POST" && takeoverStartMatch) {
    try {
      const tabId = decodeURIComponent(takeoverStartMatch[1]!);
      const body = await readJsonBody(req);
      const session = await browserService.requestTakeover({
        tabId,
        agenteId: typeof body.agenteId === "string" ? body.agenteId : null,
        canalId: typeof body.canalId === "string" ? body.canalId : null,
        reason: (typeof body.reason === "string"
          ? body.reason
          : "manual") as BrowserTakeoverReason,
        waitForResolution: false,
      });
      sendJson(res, 200, { ok: true, session });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const takeoverRespMatch = path.match(/^\/api\/navegador\/sessoes\/([^/]+)\/takeover\/responder$/);
  if (method === "POST" && takeoverRespMatch) {
    try {
      const tabId = decodeURIComponent(takeoverRespMatch[1]!);
      const body = await readJsonBody(req);
      const decision = body.decision === "cancel" ? "cancel" : "complete";
      const result = await browserService.resolveTakeover(tabId, decision);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const inputMatch = path.match(/^\/api\/navegador\/sessoes\/([^/]+)\/input$/);
  if (method === "POST" && inputMatch) {
    try {
      const tabId = decodeURIComponent(inputMatch[1]!);
      const body = await readJsonBody(req);
      const eventType = String(body.type ?? "") as HumanCdpInputEvent["type"];
      if (!ALLOWED_HUMAN_INPUT_TYPES.has(eventType)) {
        sendJson(res, 400, { erro: `Tipo de evento CDP inválido: '${eventType}'.` });
        return true;
      }
      const result = await browserService.dispatchTakeoverInput(
        tabId,
        {
          type: eventType,
          x: typeof body.x === "number" ? body.x : undefined,
          y: typeof body.y === "number" ? body.y : undefined,
          button:
            body.button === "right" || body.button === "middle" ? body.button : "left",
          clickCount: typeof body.clickCount === "number" ? body.clickCount : undefined,
          deltaX: typeof body.deltaX === "number" ? body.deltaX : undefined,
          deltaY: typeof body.deltaY === "number" ? body.deltaY : undefined,
          key: typeof body.key === "string" ? body.key.slice(0, 64) : undefined,
          code: typeof body.code === "string" ? body.code.slice(0, 64) : undefined,
          text: typeof body.text === "string" ? body.text.slice(0, 512) : undefined,
          modifiers: typeof body.modifiers === "number" ? body.modifiers : undefined,
        },
        { autoAssume: Boolean(body.autoAssume) },
      );
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const secretMatch = path.match(/^\/api\/navegador\/sessoes\/([^/]+)\/segredo$/);
  if (method === "POST" && secretMatch) {
    try {
      const tabId = decodeURIComponent(secretMatch[1]!);
      const body = await readJsonBody(req);
      const methodKind =
        body.method === "otp" || body.method === "authenticator" ? body.method : "password";
      const targets = Array.isArray(body.targets)
        ? (body.targets as BrowserTargetSelector[])
        : [];
      const result = await browserService.submitSecret({
        tabId,
        method: methodKind,
        targets,
        loginId: typeof body.loginId === "string" ? body.loginId : null,
        username: typeof body.username === "string" ? body.username : null,
        secret: typeof body.secret === "string" ? body.secret : null,
        saveToVault: Boolean(body.saveToVault),
        loginLabel: typeof body.loginLabel === "string" ? body.loginLabel : null,
        submission:
          body.submission === "click" || body.submission === "none" ? body.submission : "enter",
        submitTarget: (body.submitTarget as BrowserTargetSelector | undefined) ?? null,
      });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const teachStartMatch = path.match(/^\/api\/navegador\/sessoes\/([^/]+)\/teach\/iniciar$/);
  if (method === "POST" && teachStartMatch) {
    try {
      const tabId = decodeURIComponent(teachStartMatch[1]!);
      const body = await readJsonBody(req);
      const agenteId = typeof body.agenteId === "string" ? body.agenteId : undefined;
      sendJson(res, 200, browserService.startTeachRecording(tabId, agenteId));
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const teachStopMatch = path.match(/^\/api\/navegador\/sessoes\/([^/]+)\/teach\/parar$/);
  if (method === "POST" && teachStopMatch) {
    try {
      const tabId = decodeURIComponent(teachStopMatch[1]!);
      const body = await readJsonBody(req);
      const action = body.action === "discard" ? "discard" : "save";
      sendJson(res, 200, browserService.stopTeachRecording(tabId, action));
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const browsingLogMatch = path.match(/^\/api\/navegador\/browsing-log\/([^/]+)$/);
  if (browsingLogMatch && (method === "GET" || method === "DELETE")) {
    const agenteId = decodeURIComponent(browsingLogMatch[1]!);
    if (method === "GET") {
      const steps = browserService.browsingLog.listSteps(agenteId);
      sendJson(res, 200, {
        agenteId,
        steps,
        recordedTaskText: browserService.browsingLog.formatRecordedTaskFile(steps),
      });
    } else {
      const removed = browserService.browsingLog.clearSteps(agenteId);
      sendJson(res, 200, { ok: true, removed });
    }
    return true;
  }

  if (method === "POST" && path === "/api/navegador/read-video") {
    try {
      const body = await readJsonBody(req);
      const videoRes = await readVideoTool(
        {
          url: String(body.url ?? ""),
          frames: typeof body.frames === "number" ? body.frames : undefined,
          timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
        },
        { transcription: ctx.transcription },
      );
      sendJson(res, 200, { ok: true, video: videoRes });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const screenCaptureRespMatch = path.match(/^\/api\/navegador\/captura-tela\/([^/]+)\/responder$/);
  if (method === "POST" && screenCaptureRespMatch) {
    try {
      const captureId = decodeURIComponent(screenCaptureRespMatch[1]!);
      const body = await readJsonBody(req);
      const decision = body.decision === "granted" ? "granted" : "declined";
      const resolution = screenCapture.submitCaptureResponse(captureId, {
        decision,
        dataUrl: typeof body.dataUrl === "string" ? body.dataUrl : undefined,
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      sendJson(res, 200, resolution);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 3. Agentes — Duplicação & Resposta ao UsageLimitAskCard
  // =========================================================================

  const dupAgentMatch = path.match(/^\/api\/agentes\/([^/]+)\/duplicar$/);
  if (method === "POST" && dupAgentMatch) {
    try {
      const agenteId = decodeURIComponent(dupAgentMatch[1]!);
      const out = duplicateAgent(db, agenteId, wsHub);
      sendJson(res, 201, out);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const usageLimitRespMatch = path.match(/^\/api\/agentes\/([^/]+)\/uso-limite\/responder$/);
  if (method === "POST" && usageLimitRespMatch) {
    try {
      const agenteId = decodeURIComponent(usageLimitRespMatch[1]!);
      const body = await readJsonBody(req);
      const choiceRaw = (body.choice ?? body) as Record<string, unknown>;
      const modelo = typeof choiceRaw.modelo === "string" ? choiceRaw.modelo.trim() : "";
      if (!modelo) {
        sendJson(res, 400, { erro: "Informe o modelo reserva escolhido em 'choice.modelo'." });
        return true;
      }
      const provedor = (
        typeof choiceRaw.provedor === "string"
          ? choiceRaw.provedor
          : ctx.providers.resolveProviderName(modelo)
      ) as ProviderName;
      const choice: BackupModelChoice = {
        provedor,
        modelo,
        conta_id: typeof choiceRaw.conta_id === "string" ? choiceRaw.conta_id : null,
      };

      const resolver = ctx.backupResolver ?? new BackupModelsResolver();
      let backupConfig = undefined;
      if (body.remember === true) {
        backupConfig = resolver.rememberAutomaticFailover(db, agenteId, choice);
      }

      const askId = typeof body.askId === "string" ? body.askId.trim() : "";
      let pendingPrompt: string | null = null;
      let canalId = `agente:${agenteId}`;
      let threadId = `main:${agenteId}`;
      let anexos: unknown[] = [];

      if (askId) {
        const askRow = db.connection
          .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;")
          .get(`usage_limit_ask:${askId}`) as { valor_json: string } | undefined;
        if (askRow) {
          try {
            const parsed = JSON.parse(askRow.valor_json) as {
              userPrompt?: string;
              canalId?: string;
              threadId?: string;
              anexos?: unknown[];
            };
            pendingPrompt = parsed.userPrompt ?? null;
            canalId = parsed.canalId ?? canalId;
            threadId = parsed.threadId ?? threadId;
            anexos = Array.isArray(parsed.anexos) ? parsed.anexos : [];
          } catch {
            // ignore
          }
          db.connection
            .prepare("DELETE FROM projecao_studio_config WHERE chave = ?;")
            .run(`usage_limit_ask:${askId}`);
        }
      }

      const agenteRow = db.connection
        .prepare("SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(agenteId) as Parameters<typeof generateAgentChatReply>[1] | undefined;

      if (agenteRow && pendingPrompt) {
        const turnoId = `turn-${randomUUID().slice(0, 8)}`;
        const reply = await generateAgentChatReply(
          ctx.studioRoutesDeps,
          agenteRow,
          pendingPrompt,
          anexos as never[],
          [],
          undefined,
          {
            threadId,
            turnoId,
            overrideModel: choice.modelo,
            overrideAccountId: choice.conta_id ?? null,
          },
        );
        const maxOrdRow = db.connection
          .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
          .get(threadId) as { max_ord: number };
        const agentMsg: MensagemChat = {
          mensagem_id: `msg-${randomUUID()}`,
          canal_id: canalId,
          agente_id: agenteId,
          autor: "agente",
          autor_nome: agenteRow.nome,
          conteudo_markdown: reply.markdown,
          anexos: reply.anexosGerados,
          steps: reply.steps,
          tarefa_id: reply.tarefaCriadaId,
          thread_id: threadId,
          turno_id: turnoId,
          item_type: "mensagem",
          status: "completed",
          ordinal: maxOrdRow.max_ord + 1,
          lida: true,
          criado_em: new Date().toISOString(),
        };

        db.connection
          .prepare(
            `INSERT INTO projecao_conversas_chat (
              mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
              anexos_json, steps_json, tarefa_id, lida, criado_em,
              thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
              ordinal, branch_origem_mensagem_id, metadados_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'mensagem', 'completed', NULL, ?, NULL, '{}');`,
          )
          .run(
            agentMsg.mensagem_id,
            agentMsg.canal_id,
            agentMsg.agente_id,
            agentMsg.autor,
            agentMsg.autor_nome ?? agenteRow.nome,
            agentMsg.conteudo_markdown,
            JSON.stringify(agentMsg.anexos),
            JSON.stringify(agentMsg.steps),
            agentMsg.tarefa_id ?? null,
            agentMsg.criado_em,
            threadId,
            turnoId,
            agentMsg.ordinal ?? 1,
          );

        wsHub.broadcast("chat:message", {
          canal_id: canalId,
          agente_id: agenteId,
          mensagem: agentMsg,
        });

        sendJson(res, 200, { ok: true, choice, backupConfig, mensagem: agentMsg });
        return true;
      }

      sendJson(res, 200, { ok: true, choice, backupConfig });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 4. Sidebar — Layout Hierárquico, Drag-and-Drop & Pins
  // =========================================================================

  if (method === "GET" && path === "/api/sidebar/layout") {
    sendJson(res, 200, getSidebarLayout(db));
    return true;
  }

  if (method === "PUT" && path === "/api/sidebar/layout") {
    try {
      const body = await readJsonBody(req);
      const mutation = (
        body.mutation && typeof body.mutation === "object" ? body.mutation : body
      ) as unknown as SidebarLayoutMutation;
      const layout = mutateSidebarLayout(db, mutation, wsHub);
      sendJson(res, 200, layout);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (method === "POST" && path === "/api/sidebar/pins") {
    try {
      const body = await readJsonBody(req);
      const pins = Array.isArray(body.pins) ? body.pins.map(String) : [];
      const layout = mutateSidebarLayout(db, { op: "reorder_pins", pins }, wsHub);
      sendJson(res, 200, layout);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 5. Configurações Unificadas, Atualizações & Armazenamento
  // =========================================================================

  if (method === "GET" && path === "/api/configuracoes") {
    sendJson(res, 200, { settings: getUserSettings(db) });
    return true;
  }

  if (method === "PUT" && path === "/api/configuracoes") {
    try {
      const body = await readJsonBody(req);
      const patch = (
        body.settings && typeof body.settings === "object" ? body.settings : body
      ) as Partial<StudioUserSettings>;
      const settings = updateUserSettings(db, patch, wsHub);
      sendJson(res, 200, { ok: true, settings });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (method === "GET" && path === "/api/configuracoes/atualizacoes") {
    sendJson(
      res,
      200,
      getWhatsNewInfo(
        workspaceRoot,
        ctx.studioRoutesDeps.productRoot ?? process.env.CRIATIVO_PRODUCT_ROOT
      )
    );
    return true;
  }

  if (method === "POST" && path === "/api/voz/transcrever") {
    try {
      const body = await readJsonBody(req);
      const rawAudio =
        typeof body.audio_base64 === "string" ? body.audio_base64.trim() : "";
      if (!rawAudio) {
        sendJson(res, 400, { erro: "Campo obrigatório: 'audio_base64'." });
        return true;
      }

      const rawMime =
        typeof body.mime_type === "string" && body.mime_type.trim()
          ? body.mime_type.trim().toLowerCase()
          : "audio/webm";
      const baseMime = rawMime.split(";")[0]?.trim() || "audio/webm";
      if (!baseMime.startsWith("audio/") && baseMime !== "video/webm") {
        sendJson(res, 400, { erro: `Formato de áudio não suportado: '${baseMime}'.` });
        return true;
      }

      const cleanBase64 = rawAudio.replace(/^data:[^;]+;base64,/i, "");
      if (cleanBase64.length > 20_000_000) {
        sendJson(res, 413, {
          ok: false,
          codigo: "PAYLOAD_TOO_LARGE",
          erro: "Áudio excede o limite de 15 MB.",
        });
        return true;
      }

      const audioBuffer = Buffer.from(cleanBase64, "base64");
      if (audioBuffer.length === 0) {
        sendJson(res, 400, { erro: "Áudio vazio ou base64 inválido." });
        return true;
      }
      if (audioBuffer.length > 15 * 1024 * 1024) {
        sendJson(res, 413, {
          ok: false,
          codigo: "PAYLOAD_TOO_LARGE",
          erro: "Áudio excede o limite de 15 MB.",
        });
        return true;
      }

      const transcriber =
        ctx.transcription ??
        (ctx.studioRoutesDeps.vault
          ? new TranscriptionService({ vault: ctx.studioRoutesDeps.vault })
          : null);
      if (!transcriber) {
        sendJson(res, 422, {
          ok: false,
          code: "MISSING_TRANSCRIPTION_KEY",
          codigo: "MISSING_TRANSCRIPTION_KEY",
          erro: "Cofre de transcrição indisponível neste servidor.",
        });
        return true;
      }

      const texto = await transcriber.transcribeAudio(audioBuffer, rawMime);
      sendJson(res, 200, { ok: true, texto });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("MISSING_TRANSCRIPTION_KEY")) {
        sendJson(res, 422, {
          ok: false,
          code: "MISSING_TRANSCRIPTION_KEY",
          codigo: "MISSING_TRANSCRIPTION_KEY",
          erro: msg,
        });
        return true;
      }
      sendJson(res, mapHttpErrorStatus(err), { ok: false, erro: msg });
    }
    return true;
  }

  if (method === "GET" && path === "/api/armazenamento") {
    sendJson(res, 200, computeStorageUsage(db, workspaceRoot));
    return true;
  }

  if (method === "POST" && path === "/api/armazenamento/limpar") {
    try {
      const body = await readJsonBody(req);
      const category =
        body.category === "browser_cache" || body.category === "temp_previews"
          ? body.category
          : null;
      if (!category) {
        sendJson(res, 400, {
          erro: "Categoria inválida. Use 'browser_cache' ou 'temp_previews'.",
        });
        return true;
      }
      const result = clearStorageCategory(db, workspaceRoot, category);
      sendJson(res, 200, { ...result, snapshot: computeStorageUsage(db, workspaceRoot) });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const storageFileMatch = path.match(/^\/api\/armazenamento\/arquivos\/(.+)$/);
  if (method === "DELETE" && storageFileMatch) {
    try {
      const arquivoId = decodeURIComponent(storageFileMatch[1]!);
      const result = deleteStorageFile(db, workspaceRoot, arquivoId);
      sendJson(res, 200, { ...result, snapshot: computeStorageUsage(db, workspaceRoot) });
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // =========================================================================
  // 6. Conectores Opcionais (Slack, Discord, GitHub) com rawBody intacto
  // =========================================================================

  if (method === "GET" && path === "/api/conectores/opcionais") {
    sendJson(res, 200, connectorsWebhook.getStatusSnapshot());
    return true;
  }

  if (method === "POST" && path === "/api/conectores/slack/configurar") {
    const body = await readJsonBody(req);
    const state = connectorsWebhook.configureSlack({
      botToken: typeof body.botToken === "string" ? body.botToken : undefined,
      signingSecret: typeof body.signingSecret === "string" ? body.signingSecret : undefined,
      defaultChannel:
        body.defaultChannel === null
          ? null
          : typeof body.defaultChannel === "string"
            ? body.defaultChannel
            : undefined,
    });
    sendJson(res, 200, { ok: true, slack: state });
    return true;
  }

  if (method === "POST" && path === "/api/conectores/slack/testar") {
    const out = await connectorsWebhook.testSlack();
    sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (method === "POST" && path === "/api/conectores/slack/webhook") {
    const rawBuf = await readRawBody(req);
    const out = await connectorsWebhook.handleSlackWebhook({
      rawBody: rawBuf.toString("utf8"),
      timestampHeader:
        typeof req.headers["x-slack-request-timestamp"] === "string"
          ? req.headers["x-slack-request-timestamp"]
          : undefined,
      signatureHeader:
        typeof req.headers["x-slack-signature"] === "string"
          ? req.headers["x-slack-signature"]
          : undefined,
    });
    sendJson(res, out.statusCode, out.body);
    return true;
  }

  if (method === "POST" && path === "/api/conectores/discord/configurar") {
    const body = await readJsonBody(req);
    const state = connectorsWebhook.configureDiscord({
      botToken: typeof body.botToken === "string" ? body.botToken : undefined,
      applicationId: typeof body.applicationId === "string" ? body.applicationId : undefined,
      publicKey: typeof body.publicKey === "string" ? body.publicKey : undefined,
      webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl : undefined,
    });
    sendJson(res, 200, { ok: true, discord: state });
    return true;
  }

  if (method === "POST" && path === "/api/conectores/discord/testar") {
    const out = await connectorsWebhook.testDiscord();
    sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (method === "POST" && path === "/api/conectores/discord/webhook") {
    const rawBuf = await readRawBody(req);
    const out = await connectorsWebhook.handleDiscordWebhook({
      rawBody: rawBuf.toString("utf8"),
      signatureHeader:
        typeof req.headers["x-signature-ed25519"] === "string"
          ? req.headers["x-signature-ed25519"]
          : undefined,
      timestampHeader:
        typeof req.headers["x-signature-timestamp"] === "string"
          ? req.headers["x-signature-timestamp"]
          : undefined,
    });
    sendJson(res, out.statusCode, out.body);
    return true;
  }

  if (method === "POST" && path === "/api/conectores/github/configurar") {
    const body = await readJsonBody(req);
    const state = connectorsWebhook.configureGitHub({
      token: typeof body.token === "string" ? body.token : undefined,
      webhookSecret: typeof body.webhookSecret === "string" ? body.webhookSecret : undefined,
      defaultRepo:
        body.defaultRepo === null
          ? null
          : typeof body.defaultRepo === "string"
            ? body.defaultRepo
            : undefined,
    });
    sendJson(res, 200, { ok: true, github: state });
    return true;
  }

  if (method === "POST" && path === "/api/conectores/github/testar") {
    const out = await connectorsWebhook.testGitHub();
    sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (method === "POST" && path === "/api/conectores/github/webhook") {
    const rawBuf = await readRawBody(req);
    const out = await connectorsWebhook.handleGitHubWebhook({
      rawBody: rawBuf.toString("utf8"),
      signatureHeader:
        typeof req.headers["x-hub-signature-256"] === "string"
          ? req.headers["x-hub-signature-256"]
          : undefined,
      eventHeader:
        typeof req.headers["x-github-event"] === "string"
          ? req.headers["x-github-event"]
          : undefined,
    });
    sendJson(res, out.statusCode, out.body);
    return true;
  }

  // =========================================================================
  // 7. Showcase Local (/api/showcase/sites)
  // =========================================================================

  if (method === "GET" && path === "/api/showcase/sites") {
    sendJson(res, 200, { sites: showcaseService.listSites() });
    return true;
  }

  if (method === "POST" && path === "/api/showcase/sites") {
    try {
      const body = await readJsonBody(req);
      const out = showcaseService.publishSite({
        slug: String(body.slug ?? ""),
        titulo: String(body.titulo ?? ""),
        descricao: typeof body.descricao === "string" ? body.descricao : undefined,
        sourceDir: String(body.sourceDir ?? body.source_dir ?? ""),
        spaFallback: body.spaFallback !== false,
        agenteId: typeof body.agenteId === "string" ? body.agenteId : null,
        aprovadoPorHumano: body.aprovadoPorHumano === true,
      });
      sendJson(res, out.ok ? 201 : out.requiresApproval ? 409 : 400, out);
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const showcaseSiteMatch = path.match(/^\/api\/showcase\/sites\/([^/]+)$/);
  if (showcaseSiteMatch && (method === "PUT" || method === "DELETE")) {
    const siteId = decodeURIComponent(showcaseSiteMatch[1]!);
    try {
      const body = await readJsonBody(req);
      if (method === "PUT") {
        const out = showcaseService.replaceSite(siteId, {
          sourceDir: String(body.sourceDir ?? body.source_dir ?? ""),
          titulo: typeof body.titulo === "string" ? body.titulo : undefined,
          descricao: typeof body.descricao === "string" ? body.descricao : undefined,
          spaFallback: typeof body.spaFallback === "boolean" ? body.spaFallback : undefined,
          aprovadoPorHumano: body.aprovadoPorHumano === true,
        });
        sendJson(res, out.ok ? 200 : out.requiresApproval ? 409 : 400, out);
      } else {
        const out = showcaseService.deleteSite(siteId, {
          aprovadoPorHumano: body.aprovadoPorHumano === true,
        });
        sendJson(res, out.ok ? 200 : out.requiresApproval ? 409 : 400, out);
      }
    } catch (err) {
      sendJson(res, mapHttpErrorStatus(err), {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  return false;
}
