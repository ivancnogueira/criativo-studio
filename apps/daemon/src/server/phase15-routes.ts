/**
 * Sub-router HTTP REST da Fase 15:
 * Navegador Chromium CDP, Perfis/Proxies, BrowserTakeover, submit_secret, BrowserTeachBar,
 * Mídia (read_video / capture_screen), Duplicação & Failover de Agentes, Sidebar,
 * Configurações & Armazenamento, Conectores (Slack/Discord/GitHub) e Showcase Local.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mapHttpErrorStatus, type Phase15RouteContext } from "./phase15-routes-types.ts";
import { handlePhase15BrowserRoutes } from "./phase15-browser-routes.ts";
import { handlePhase15StudioRoutes } from "./phase15-studio-routes.ts";

export type { Phase15RouteContext } from "./phase15-routes-types.ts";

export async function tryHandlePhase15Route(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  _url: URL,
  ctx: Phase15RouteContext,
): Promise<boolean> {
  if (await handlePhase15BrowserRoutes(req, res, path, method, _url, ctx)) return true;
  if (await handlePhase15StudioRoutes(req, res, path, method, _url, ctx)) return true;

  const {
    showcaseService,
    connectorsWebhook,
    sendJson,
    readJsonBody,
    readRawBody,
  } = ctx;

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
