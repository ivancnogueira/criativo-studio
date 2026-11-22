/**
 * Sub-router HTTP REST da Fase 15:
 * Navegador Chromium CDP, Perfis/Proxies, BrowserTakeover, submit_secret, BrowserTeachBar,
 * Mídia (read_video / capture_screen), Duplicação & Failover de Agentes, Sidebar,
 * Configurações & Armazenamento, Conectores (Slack/Discord/GitHub) e Showcase Local.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BrowserProfileProxyPayload,
  BrowserTakeoverReason,
  BrowserTargetSelector,
} from "@criativo/contracts";
import type {
  BrowserCdpActionName,
} from "../engine/tools/browser-automation.ts";
import type {
  HumanCdpInputEvent,
} from "../engine/tools/browser-cdp-session.ts";
import {
  readVideoTool,
} from "../engine/tools/video-reader.ts";
import { ALLOWED_HUMAN_INPUT_TYPES, mapHttpErrorStatus, type Phase15RouteContext } from "./phase15-routes-types.ts";

export async function handlePhase15BrowserRoutes(
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
  void db; void wsHub; void workspaceRoot; void browserService; void screenCapture;
  void showcaseService; void connectorsWebhook; void readRawBody;

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


  return false;
}
