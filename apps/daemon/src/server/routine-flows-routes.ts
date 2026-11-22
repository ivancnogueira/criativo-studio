import type {
  RoutineCalendar,
  RoutineWebhookConfig,
} from "@criativo/contracts";
import {
  expandScheduleOccurrences,
} from "../routines/routine-schedule-calc.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildErrorResponse, parseOptionalDestination, sanitizeFilters, type RoutineRoutesDeps } from "./routine-routes-helpers.ts";

export async function handleRoutineFlowsAndDeliveryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: RoutineRoutesDeps,
): Promise<boolean> {
  const { routineStore, flowStore, timer, resultDispatcher, executionService, webhookService, flowsEngine, wsHub, sendJson, readJsonBody } = deps;
  void timer; void webhookService; void executionService; void parseOptionalDestination; void sanitizeFilters; void url;

  // 12. Histórico e reenvio de entregas
  const deliveriesMatch = path.match(/^\/api\/rotinas\/gerenciar\/([^/]+)\/entregas$/);
  if (method === "GET" && deliveriesMatch) {
    const rotinaId = decodeURIComponent(deliveriesMatch[1]);
    const limitRaw = Number(url.searchParams.get("limit") ?? "25");
    const entregas = routineStore.listDeliveriesByRoutine(
      rotinaId,
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 25
    );
    sendJson(res, 200, { entregas });
    return true;
  }

  const resendDeliveryMatch = path.match(
    /^\/api\/rotinas\/gerenciar\/([^/]+)\/entregas\/([^/]+)\/reenviar$/
  );
  if (method === "POST" && resendDeliveryMatch) {
    const rotinaId = decodeURIComponent(resendDeliveryMatch[1]);
    const execucaoId = decodeURIComponent(resendDeliveryMatch[2]);
    try {
      const entrega = await resultDispatcher.resendDelivery(rotinaId, execucaoId);
      if (!entrega) {
        sendJson(res, 404, { erro: "Execução ou entrega não encontrada para reenvio." });
        return true;
      }
      sendJson(res, 200, { entrega });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  // 13. Gerenciamento HMAC do Webhook da rotina
  const rotateSecretMatch = path.match(
    /^\/api\/rotinas\/gerenciar\/([^/]+)\/webhook\/rotacionar-segredo$/
  );
  if (method === "POST" && rotateSecretMatch) {
    const rotinaId = decodeURIComponent(rotateSecretMatch[1]);
    try {
      const { secret, webhook } = webhookService.rotateSecret(rotinaId);
      const rotina = routineStore.getById(rotinaId);
      sendJson(res, 200, { secret, webhook, rotina });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  const customSecretMatch = path.match(
    /^\/api\/rotinas\/gerenciar\/([^/]+)\/webhook\/segredo$/
  );
  if ((method === "PUT" || method === "POST") && customSecretMatch) {
    const rotinaId = decodeURIComponent(customSecretMatch[1]);
    try {
      const body = await readJsonBody(req);
      const rawSecret =
        typeof body.secret === "string"
          ? body.secret
          : typeof body.segredo === "string"
            ? body.segredo
            : "";
      const webhook: RoutineWebhookConfig = webhookService.setCustomSecret(rotinaId, rawSecret);
      const rotina = routineStore.getById(rotinaId);
      sendJson(res, 200, { webhook, rotina });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  const testWebhookMatch = path.match(
    /^\/api\/rotinas\/gerenciar\/([^/]+)\/webhook\/testar$/
  );
  if (method === "POST" && testWebhookMatch) {
    const rotinaId = decodeURIComponent(testWebhookMatch[1]);
    try {
      const body = await readJsonBody(req);
      const resultado = await webhookService.sendTestWebhook(rotinaId, {
        type: typeof body.type === "string" ? body.type : undefined,
        data: body.data,
      });
      sendJson(res, 200, { resultado });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  const webhookReceiptsMatch = path.match(
    /^\/api\/rotinas\/gerenciar\/([^/]+)\/webhook\/recibos$/
  );
  if (method === "GET" && webhookReceiptsMatch) {
    const rotinaId = decodeURIComponent(webhookReceiptsMatch[1]);
    const limitRaw = Number(url.searchParams.get("limit") ?? "25");
    const recibos = routineStore.listWebhookReceipts(
      rotinaId,
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 25
    );
    sendJson(res, 200, { recibos });
    return true;
  }

  // 14. Agenda Global (/api/agenda)
  if (method === "GET" && path === "/api/agenda") {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 3_600_000);
    const defaultTo = new Date(now.getTime() + 7 * 24 * 3_600_000);

    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const fromDate = fromRaw && !Number.isNaN(Date.parse(fromRaw)) ? new Date(fromRaw) : defaultFrom;
    const toDate = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw) : defaultTo;

    if (toDate.getTime() < fromDate.getTime()) {
      sendJson(res, 400, { erro: "Parâmetro 'to' deve ser maior ou igual a 'from'." });
      return true;
    }

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    const allRoutines = routineStore.listAll();
    const recordedRuns = routineStore.listRunsInRange(fromIso, toIso);

    const calendarExecs: RoutineCalendar["execucoes"] = recordedRuns.map((run) => ({
      id: run.execucao_id,
      rotina_id: run.rotina_id,
      at: run.scheduled_for,
      status: run.status,
      silenciada: run.silenciada,
    }));

    const seenRoutineMinuteKeys = new Set<string>(
      calendarExecs.map((item) => `${item.rotina_id}:${item.at.slice(0, 16)}`)
    );

    const expansionStart = new Date(Math.max(fromDate.getTime(), now.getTime()));
    if (expansionStart.getTime() <= toDate.getTime()) {
      for (const routine of allRoutines) {
        if (!routine.ativa || routine.trigger_kind !== "schedule" || !routine.schedule) {
          continue;
        }
        const futureDates = expandScheduleOccurrences(
          routine.schedule,
          routine.timezone,
          expansionStart,
          toDate,
          120
        );
        for (const occDate of futureDates) {
          const iso = occDate.toISOString();
          const minuteKey = `${routine.rotina_id}:${iso.slice(0, 16)}`;
          if (seenRoutineMinuteKeys.has(minuteKey)) continue;
          seenRoutineMinuteKeys.add(minuteKey);
          calendarExecs.push({
            id: `sched-${routine.rotina_id}-${occDate.getTime()}`,
            rotina_id: routine.rotina_id,
            at: iso,
            status: "scheduled",
          });
        }
      }
    }

    calendarExecs.sort((a, b) => a.at.localeCompare(b.at));

    const calendar: RoutineCalendar = {
      rotinas: allRoutines.map((item) => ({
        rotina_id: item.rotina_id,
        nome: item.nome,
        owner_kind: item.owner_kind,
        owner_id: item.owner_id,
        ativa: item.ativa,
        timezone: item.timezone,
        trigger_kind: item.trigger_kind,
        schedule: item.schedule,
      })),
      execucoes: calendarExecs,
    };

    sendJson(res, 200, calendar);
    return true;
  }

  // 15. Fluxos de Rotinas (Canvas DAG multi-agente)
  if (method === "POST" && path === "/api/fluxos-rotinas/links") {
    try {
      const body = await readJsonBody(req);
      const rotinaId = typeof body.rotina_id === "string" ? body.rotina_id.trim() : "";
      const fromAgentId =
        typeof body.from_agent_id === "string" ? body.from_agent_id.trim() : "";
      const toAgentId = typeof body.to_agent_id === "string" ? body.to_agent_id.trim() : "";
      if (!rotinaId || !fromAgentId || !toAgentId) {
        sendJson(res, 400, {
          erro: "Campos obrigatórios: 'rotina_id', 'from_agent_id' e 'to_agent_id'.",
        });
        return true;
      }

      const routine = routineStore.getById(rotinaId);
      if (!routine) {
        sendJson(res, 404, { erro: `Rotina '${rotinaId}' não encontrada.` });
        return true;
      }
      const ownerId =
        typeof body.owner_id === "string" && body.owner_id.trim()
          ? body.owner_id.trim()
          : routine.owner_id;
      const instrucao = typeof body.instrucao === "string" ? body.instrucao : "";

      const link = flowStore.createLink({
        rotina_id: rotinaId,
        owner_id: ownerId,
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        instrucao,
      });

      await flowsEngine.sweep();
      wsHub.broadcast("routine_flow:updated", {
        affected_agent_ids: [ownerId, fromAgentId, toAgentId],
        rotina_id: rotinaId,
      });

      sendJson(res, 201, { link });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  const flowLinkMatch = path.match(/^\/api\/fluxos-rotinas\/links\/([^/]+)$/);
  if (flowLinkMatch && (method === "PUT" || method === "DELETE")) {
    const linkId = decodeURIComponent(flowLinkMatch[1]);
    const existing = flowStore.getLink(linkId);
    if (!existing) {
      sendJson(res, 404, { erro: `Conexão de fluxo '${linkId}' não encontrada.` });
      return true;
    }

    if (method === "PUT") {
      try {
        const body = await readJsonBody(req);
        const instrucao = typeof body.instrucao === "string" ? body.instrucao : "";
        const updated = flowStore.updateLink(linkId, instrucao);
        wsHub.broadcast("routine_flow:updated", {
          affected_agent_ids: [existing.from_agent_id, existing.to_agent_id],
          rotina_id: existing.rotina_id,
        });
        sendJson(res, 200, { link: updated });
      } catch (error) {
        buildErrorResponse(res, sendJson, error);
      }
      return true;
    }

    const body = await readJsonBody(req);
    const routine = routineStore.getById(existing.rotina_id);
    const ownerId =
      url.searchParams.get("owner_id") ??
      (typeof body.owner_id === "string" && body.owner_id.trim() ? body.owner_id.trim() : null) ??
      routine?.owner_id ??
      existing.from_agent_id;

    const result = flowStore.deleteLink(linkId, ownerId);
    await flowsEngine.sweep();
    wsHub.broadcast("routine_flow:updated", {
      affected_agent_ids: result?.affectedAgents ?? [existing.from_agent_id, existing.to_agent_id],
      rotina_id: existing.rotina_id,
    });
    const deletedIds = result?.deletedLinkIds ?? [linkId];
    sendJson(res, 200, {
      ok: true,
      deletedLinkIds: deletedIds,
      strandedLinks: deletedIds.filter((id) => id !== linkId),
      affectedAgents: result?.affectedAgents ?? [],
    });
    return true;
  }

  const stopFlowRunMatch = path.match(/^\/api\/fluxos-rotinas\/runs\/([^/]+)\/parar$/);
  if (method === "POST" && stopFlowRunMatch) {
    const execucaoId = decodeURIComponent(stopFlowRunMatch[1]);
    const stopRes = await flowsEngine.stopRun(execucaoId, "Execução interrompida pelo usuário");
    executionService.cancelExecution(execucaoId, "Execução interrompida pelo usuário");
    sendJson(res, 200, { ok: true, ...stopRes });
    return true;
  }

  const flowPositionMatch = path.match(
    /^\/api\/fluxos-rotinas\/([^/]+)\/posicoes\/([^/]+)$/
  );
  if (flowPositionMatch && (method === "PUT" || method === "DELETE")) {
    const canvasAgentId = decodeURIComponent(flowPositionMatch[1]);
    const nodeKey = decodeURIComponent(flowPositionMatch[2]);

    if (method === "DELETE") {
      flowStore.deletePosition(canvasAgentId, nodeKey);
      wsHub.broadcast("routine_flow:updated", {
        affected_agent_ids: [canvasAgentId],
        rotina_id: "",
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const body = await readJsonBody(req);
    const x = typeof body.x === "number" ? body.x : Number(body.x);
    const y = typeof body.y === "number" ? body.y : Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      sendJson(res, 400, { erro: "Coordenadas 'x' e 'y' devem ser números válidos." });
      return true;
    }
    flowStore.upsertPosition(canvasAgentId, nodeKey, x, y);
    wsHub.broadcast("routine_flow:updated", {
      affected_agent_ids: [canvasAgentId],
      rotina_id: "",
    });
    sendJson(res, 200, { posicao: { canvas_agent_id: canvasAgentId, node_key: nodeKey, x, y } });
    return true;
  }

  const flowCanvasMatch = path.match(/^\/api\/fluxos-rotinas\/([^/]+)$/);
  if (method === "GET" && flowCanvasMatch) {
    const agenteId = decodeURIComponent(flowCanvasMatch[1]);
    const canvas = flowsEngine.getCanvas(agenteId);
    sendJson(res, 200, { canvas });
    return true;
  }

  return false;
}
