import { timingSafeEqual } from "node:crypto";
import type {
  CreateCommentDmRuleInput,
  DryRunSimulationInput,
  UpdateCommentDmRuleInput,
} from "@criativo/contracts";
import type { PublishDeliverableInput } from "../social/deliverable-publisher-service.ts";
import { resolveMetaCommentCredentials } from "../social/meta-comment-dm-client.ts";
import { dispatchParsedMetaWebhookPayload, verifyMetaWebhookHmac } from "../social/meta-relay-client.ts";
import { createPhase47Runtime } from "../social/phase47-runtime.ts";
import { readRawBody as defaultReadRawBody } from "./daemon-http-utils.ts";
import type { StudioRouteContext } from "./routes/route-helpers.ts";
import { resolveNativeAppConnectionsStore } from "./studio-tools-bridge.ts";

function getOrBuildRuntime(ctx: StudioRouteContext) {
  if (ctx.deps.phase47) return ctx.deps.phase47;
  const nativeStore =
    ctx.deps.catalogService?.nativeStore ??
    resolveNativeAppConnectionsStore({ db: ctx.db, vault: ctx.deps.vault }) ??
    undefined;
  return createPhase47Runtime({
    db: ctx.db,
    vault: ctx.deps.vault,
    nativeStore,
    wsHub: ctx.wsHub,
    workspaceRoot: ctx.workspaceRoot,
    showcaseService: ctx.deps.showcaseService,
    crmService: ctx.deps.crmService,
    workflowEngine: ctx.deps.workflowEngine,
    fetchImpl: ctx.deps.fetchImpl,
  });
}

function safeTokenMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length > 0 && bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Rotas HTTP da Fase 47:
 * - Webhook Direto Meta (`GET/POST /api/instagram/webhook`)
 * - CRUD Regras, Simulação Dry-Run, Aprovações, Logs, Analytics, Modos de Conexão e Entregáveis Públicos
 */
export async function tryHandleSocialCommentDmRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps } = ctx;
  const { sendJson, readJsonBody } = deps;

  if (path === "/api/instagram/webhook") {
    const rt = getOrBuildRuntime(ctx);
    const nativeStore =
      deps.catalogService?.nativeStore ??
      resolveNativeAppConnectionsStore({ db: ctx.db, vault: deps.vault }) ??
      undefined;
    const creds = resolveMetaCommentCredentials(deps.vault, nativeStore, url.searchParams.get("conta_id"));

    if (method === "GET") {
      const mode = url.searchParams.get("hub.mode") ?? "";
      const token = url.searchParams.get("hub.verify_token") ?? "";
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      const expectedToken =
        creds.verifyToken || rt.service.getConnectionConfig(creds.contaId ?? "principal").relay_verify_token || "";

      if (mode === "subscribe" && safeTokenMatch(token, expectedToken)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(challenge);
        return true;
      }
      sendJson(res, 403, { ok: false, erro: "hub.verify_token inválido." });
      return true;
    }

    if (method === "POST") {
      const readRaw = deps.readRawBody ?? defaultReadRawBody;
      const rawBuf = await readRaw(req);
      const rawText = rawBuf.toString("utf8");
      const sig = req.headers["x-hub-signature-256"];
      const sigStr = Array.isArray(sig) ? sig[0] : sig;

      if (!creds.appSecret || !verifyMetaWebhookHmac(rawText, sigStr, creds.appSecret)) {
        sendJson(res, 401, { ok: false, erro: "Assinatura X-Hub-Signature-256 inválida ou IG_APP_SECRET ausente." });
        return true;
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { ok: false, erro: "Payload JSON inválido." });
        return true;
      }

      const dispatched = await dispatchParsedMetaWebhookPayload(
        parsed,
        rt.engine,
        creds.contaId ?? "principal",
        "direct_webhook"
      );
      sendJson(res, 200, { ok: true, dispatched });
      return true;
    }
  }

  if (path === "/api/instagram/comment-dm/rules" && method === "GET") {
    const rt = getOrBuildRuntime(ctx);
    const contaId = url.searchParams.get("conta_id") ?? undefined;
    sendJson(res, 200, { ok: true, rules: rt.service.listRules(contaId) });
    return true;
  }

  if (path === "/api/instagram/comment-dm/rules" && method === "POST") {
    const rt = getOrBuildRuntime(ctx);
    try {
      const body = (await readJsonBody(req)) as unknown as CreateCommentDmRuleInput;
      const rule = rt.service.createRule(body);
      sendJson(res, 201, { ok: true, rule });
    } catch (err) {
      sendJson(res, 400, { ok: false, erro: err instanceof Error ? err.message : "Erro ao criar regra." });
    }
    return true;
  }

  const ruleMatch = path.match(/^\/api\/instagram\/comment-dm\/rules\/([^/]+)$/);
  if (ruleMatch) {
    const rt = getOrBuildRuntime(ctx);
    const ruleId = decodeURIComponent(ruleMatch[1]);
    if (method === "PATCH") {
      try {
        const body = (await readJsonBody(req)) as unknown as UpdateCommentDmRuleInput;
        const rule = rt.service.updateRule(ruleId, body);
        sendJson(res, 200, { ok: true, rule });
      } catch (err) {
        sendJson(res, 400, { ok: false, erro: err instanceof Error ? err.message : "Erro ao atualizar regra." });
      }
      return true;
    }
    if (method === "DELETE") {
      const deleted = rt.service.deleteRule(ruleId);
      sendJson(res, deleted ? 200 : 404, { ok: deleted });
      return true;
    }
  }

  if (path === "/api/instagram/comment-dm/simulate" && method === "POST") {
    const rt = getOrBuildRuntime(ctx);
    try {
      const body = (await readJsonBody(req)) as unknown as DryRunSimulationInput;
      const result = rt.service.simulateDryRun(body);
      sendJson(res, 200, { ok: true, result });
    } catch (err) {
      sendJson(res, 400, { ok: false, erro: err instanceof Error ? err.message : "Erro na simulação." });
    }
    return true;
  }

  if (path === "/api/instagram/comment-dm/approvals" && method === "GET") {
    const rt = getOrBuildRuntime(ctx);
    const st = (url.searchParams.get("status") ?? "pending") as "pending" | "approved" | "rejected" | "all";
    sendJson(res, 200, { ok: true, approvals: rt.service.listApprovals(st) });
    return true;
  }

  const approveMatch = path.match(/^\/api\/instagram\/comment-dm\/approvals\/([^/]+)\/decide$/);
  if (approveMatch && method === "POST") {
    const rt = getOrBuildRuntime(ctx);
    try {
      const body = await readJsonBody(req);
      const resDec = await rt.service.decideApproval({
        approvalId: decodeURIComponent(approveMatch[1]),
        approved: body.approved === true,
        decidedBy: typeof body.decided_by === "string" ? body.decided_by : "operador",
      });
      sendJson(res, 200, resDec);
    } catch (err) {
      sendJson(res, 400, { ok: false, erro: err instanceof Error ? err.message : "Falha na decisão." });
    }
    return true;
  }

  if (path === "/api/instagram/comment-dm/logs" && method === "GET") {
    const rt = getOrBuildRuntime(ctx);
    const limit = Number(url.searchParams.get("limit") ?? "60");
    const contaId = url.searchParams.get("conta_id") ?? undefined;
    sendJson(res, 200, { ok: true, logs: rt.service.listLogs(limit, contaId) });
    return true;
  }

  if (path === "/api/instagram/comment-dm/analytics" && method === "GET") {
    const rt = getOrBuildRuntime(ctx);
    const contaId = url.searchParams.get("conta_id") ?? undefined;
    sendJson(res, 200, { ok: true, analytics: rt.service.getAnalytics(contaId) });
    return true;
  }

  if (path === "/api/instagram/comment-dm/connection-mode") {
    const rt = getOrBuildRuntime(ctx);
    const contaId = url.searchParams.get("conta_id") ?? "principal";
    if (method === "GET") {
      sendJson(res, 200, { ok: true, config: rt.service.getConnectionConfig(contaId) });
      return true;
    }
    if (method === "PUT") {
      const body = await readJsonBody(req);
      const config = rt.service.saveConnectionConfig({
        conta_id: typeof body.conta_id === "string" ? body.conta_id : contaId,
        reception_mode: body.reception_mode as "polling" | "direct_webhook" | "painel_relay" | undefined,
        poll_interval_sec: typeof body.poll_interval_sec === "number" ? body.poll_interval_sec : undefined,
        relay_verify_token: typeof body.relay_verify_token === "string" ? body.relay_verify_token : undefined,
        relay_enabled: typeof body.relay_enabled === "boolean" ? body.relay_enabled : undefined,
        public_https_domain: typeof body.public_https_domain === "string" ? body.public_https_domain : undefined,
      });
      sendJson(res, 200, { ok: true, config });
      return true;
    }
  }

  if (path === "/api/instagram/comment-dm/relay/provision" && method === "POST") {
    const rt = getOrBuildRuntime(ctx);
    const body = await readJsonBody(req);
    const licenseKey =
      (typeof body.license_key === "string" && body.license_key.trim()) ||
      deps.licenseService?.getCredentialHeaders?.()?.["X-Criativo-License-Key"] ||
      "";
    const painelUrl =
      (typeof body.painel_base_url === "string" && body.painel_base_url.trim()) ||
      process.env.CRIATIVO_PAINEL_URL ||
      "";
    if (!painelUrl || !licenseKey) {
      sendJson(res, 400, { ok: false, erro: "Informe 'painel_base_url' e possua uma licença ativa." });
      return true;
    }
    const provisioned = await rt.relayClient.provisionChannel({
      painelBaseUrl: painelUrl,
      licenseKey,
      contaId: typeof body.conta_id === "string" ? body.conta_id : "principal",
      verifyToken: typeof body.verify_token === "string" ? body.verify_token : undefined,
    });
    sendJson(res, provisioned.ok ? 200 : 400, provisioned);
    return true;
  }

  if (path === "/api/instagram/deliverables" && method === "GET") {
    const rt = getOrBuildRuntime(ctx);
    sendJson(res, 200, { ok: true, deliverables: rt.deliverablePublisher.listDeliverables(false) });
    return true;
  }

  if (path === "/api/instagram/deliverables/publish" && method === "POST") {
    const rt = getOrBuildRuntime(ctx);
    try {
      const body = (await readJsonBody(req)) as unknown as PublishDeliverableInput;
      const deliverable = await rt.deliverablePublisher.publishDeliverable(body);
      sendJson(res, 201, { ok: true, deliverable });
    } catch (err) {
      sendJson(res, 400, { ok: false, erro: err instanceof Error ? err.message : "Erro ao publicar entregável." });
    }
    return true;
  }

  const delivMatch = path.match(/^\/api\/instagram\/deliverables\/([^/]+)$/);
  if (delivMatch && method === "DELETE") {
    const rt = getOrBuildRuntime(ctx);
    const deleted = rt.deliverablePublisher.deleteDeliverable(decodeURIComponent(delivMatch[1]));
    sendJson(res, deleted ? 200 : 404, { ok: deleted });
    return true;
  }

  return false;
}
