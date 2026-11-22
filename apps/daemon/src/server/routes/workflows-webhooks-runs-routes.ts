import { randomUUID, timingSafeEqual } from "node:crypto";
import type { WorkflowEngine } from "../../workflows/workflow-engine.ts";
import { WorkflowStore, WorkflowValidationError } from "../../workflows/workflow-store.ts";
import type { WorkflowTriggers } from "../../workflows/workflow-triggers.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { readRawBodyFallback, resolveWorkflowRuntime } from "./route-helpers.ts";

export async function tryHandleWorkflowsWebhooksAndRunsRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

  // 5. Fluxos de Trabalho Visuais & Motor em Grafo (Fase 12)
  const wfWebhookMatch = path.match(/^\/api\/workflows\/webhook\/([^/]+)$/);
  if (method === "POST" && wfWebhookMatch) {
    const routeId = decodeURIComponent(wfWebhookMatch[1]);
    if (!deps.workflowTriggers) {
      sendJson(res, 503, { erro: "WorkflowTriggers não inicializado neste daemon." });
      return true;
    }
    const rawBody = deps.readRawBody
      ? await deps.readRawBody(req)
      : await readRawBodyFallback(req);
    const sigHeader =
      (typeof req.headers["x-criativo-signature"] === "string"
        ? req.headers["x-criativo-signature"]
        : undefined) ??
      (typeof req.headers["x-hub-signature-256"] === "string"
        ? req.headers["x-hub-signature-256"]
        : undefined);
    const deliveryIdHeader =
      (typeof req.headers["x-delivery-id"] === "string"
        ? req.headers["x-delivery-id"]
        : undefined) ??
      (typeof req.headers["x-request-id"] === "string"
        ? req.headers["x-request-id"]
        : undefined);

    const result = await deps.workflowTriggers.handleWebhookRequest({
      routeId,
      rawBody,
      signatureHeader: sigHeader,
      deliveryIdHeader,
    });
    sendJson(res, result.httpStatus, result.body);
    return true;
  }

  if (method === "POST" && path === "/api/workflows/conector-evento") {
    if (!deps.workflowTriggers) {
      sendJson(res, 503, { erro: "WorkflowTriggers não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const conectorId = typeof body.conector_id === "string" ? body.conector_id : "";
    const evento = typeof body.evento === "string" ? body.evento : "";
    if (!conectorId || !evento) {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'conector_id' e 'evento'." });
      return true;
    }
    const triggeredRuns = await deps.workflowTriggers.receiveConnectorTrigger({
      conectorId,
      evento,
      dados: body.dados ?? {},
      eventId: typeof body.event_id === "string" ? body.event_id : undefined,
    });
    sendJson(res, 202, { ok: true, triggered_runs: triggeredRuns });
    return true;
  }

  if (method === "POST" && path === "/api/mensageria/telegram/webhook") {
    const expectedSecret =
      deps.vault?.getSecret("TELEGRAM_WEBHOOK_SECRET") ??
      deps.vault?.getSecret("telegram_webhook_secret");
    if (expectedSecret) {
      const provided =
        typeof req.headers["x-telegram-bot-api-secret-token"] === "string"
          ? req.headers["x-telegram-bot-api-secret-token"]
          : "";
      const a = Buffer.from(provided, "utf8");
      const b = Buffer.from(expectedSecret, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        sendJson(res, 401, { erro: "Secret token Telegram inválido." });
        return true;
      }
    }

    const body = await readJsonBody(req);
    if (body.callback_query && typeof body.callback_query === "object") {
      const cq = body.callback_query as { id?: unknown; data?: unknown };
      if (typeof cq.id === "string") {
        await deps.telegramBot?.handleCallbackQuery({
          id: cq.id,
          data: typeof cq.data === "string" ? cq.data : undefined,
        });
      }
    }
    if (body.message && typeof body.message === "object") {
      const msg = body.message as {
        message_id?: unknown;
        text?: unknown;
        chat?: { id?: unknown; username?: unknown };
        from?: { username?: unknown };
      };
      if (msg.chat?.id !== undefined && typeof msg.text === "string") {
        await deps.workflowTriggers?.receiveTelegramTrigger({
          chatId: String(msg.chat.id),
          username:
            typeof msg.from?.username === "string"
              ? msg.from.username
              : typeof msg.chat.username === "string"
                ? msg.chat.username
                : undefined,
          text: msg.text,
          messageId: String(msg.message_id ?? randomUUID()),
        });
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  const wfRunDetailMatch = path.match(/^\/api\/workflows\/execucoes\/([^/]+)$/);
  if (method === "GET" && wfRunDetailMatch) {
    const runId = decodeURIComponent(wfRunDetailMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    const execucao = store.getRunDetail(runId);
    if (!execucao) {
      sendJson(res, 404, { erro: `Execução '${runId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { execucao });
    return true;
  }

  const wfRunStopMatch = path.match(/^\/api\/workflows\/execucoes\/([^/]+)\/parar$/);
  if (method === "POST" && wfRunStopMatch) {
    const runId = decodeURIComponent(wfRunStopMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const execucao = await deps.workflowEngine.stopRun(runId);
    if (!execucao) {
      sendJson(res, 404, { erro: `Execução '${runId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { ok: true, execucao });
    return true;
  }

  const wfStepDecideMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/decidir$/);
  if (method === "POST" && wfStepDecideMatch) {
    const stepId = decodeURIComponent(wfStepDecideMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    if (typeof body.approved !== "boolean") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'approved' (boolean)." });
      return true;
    }
    try {
      await deps.workflowEngine.decideStep(stepId, body.approved, "web");
      sendJson(res, 200, { ok: true, step_id: stepId, approved: body.approved });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfStepRetryMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/retentar$/);
  if (method === "POST" && wfStepRetryMatch) {
    const stepId = decodeURIComponent(wfStepRetryMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    try {
      const resultado = await deps.workflowEngine.retryStep(stepId);
      sendJson(res, 200, { ok: true, resultado });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfStepStopMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/parar$/);
  if (method === "POST" && wfStepStopMatch) {
    const stepId = decodeURIComponent(wfStepStopMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    await deps.workflowEngine.stopStep(stepId);
    sendJson(res, 200, { ok: true, step_id: stepId });
    return true;
  }


  return false;
}
