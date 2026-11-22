import type {
  AgentRoutine,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineRunPlace,
  RoutineSchedule,
} from "@criativo/contracts";
import {
  isRoutineResultDestination,
  isRoutineSchedule,
} from "@criativo/contracts";
import {
  computeNextRoutineOccurrence,
  validateRoutineSchedule,
} from "../routines/routine-schedule-calc.ts";
import {
  buildRoutinesIcsFeed,
  getIcsFeedConfig,
  rotateIcsFeedToken,
  verifyIcsFeedToken,
} from "../routines/routine-feed-ics.ts";
import {
  MAX_WEBHOOK_BODY_BYTES,
  PayloadTooLargeError,
  readRawBodyWithLimit,
} from "../routines/webhook-verifier.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOwnerKind, defaultTimezone, parseBooleanQuery, sanitizeFilters, parseOptionalDestination, buildErrorResponse, type RoutineRoutesDeps } from "./routine-routes-helpers.ts";
import { handleRoutineFlowsAndDeliveryRoutes } from "./routine-flows-routes.ts";

export * from "./routine-routes-helpers.ts";

export async function tryHandleRoutineRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: RoutineRoutesDeps
): Promise<boolean> {
  const {
    routineStore,
    flowStore,
    timer,
    resultDispatcher,
    executionService,
    webhookService,
    flowsEngine,
    wsHub,
    sendJson,
    readJsonBody,
  } = deps;

  // 1. Endpoint público de Webhook HMAC-SHA256
  if (await handleRoutineFlowsAndDeliveryRoutes(req, res, path, method, url, deps)) return true;

  const webhookPublicMatch = path.match(/^\/api\/webhooks\/rotina\/([^/]+)$/);
  if (method === "POST" && webhookPublicMatch) {
    const routeToken = decodeURIComponent(webhookPublicMatch[1]);
    try {
      const rawBody = await readRawBodyWithLimit(req, MAX_WEBHOOK_BODY_BYTES);
      const result = await webhookService.processIncomingWebhook({
        routeToken,
        headers: req.headers,
        rawBody,
      });
      sendJson(res, result.httpStatus, result.body);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { status: "rejected", erro: error.message });
        return true;
      }
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { status: "rejected", erro: message });
    }
    return true;
  }

  // 2. SSE em tempo real para rotinas e fluxos
  if (method === "GET" && path === "/api/rotinas/eventos") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`: connected\n\n`);

    const unsubscribe = wsHub.subscribe(
      (envelope) => {
        if (!envelope.event.startsWith("routine")) return;
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${envelope.event}\ndata: ${JSON.stringify(envelope)}\n\n`);
      },
      () => {
        if (!res.writableEnded && !res.destroyed) {
          res.end();
        }
      }
    );

    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 25_000);
    heartbeat.unref?.();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    return true;
  }

  // 3. Listagem filtrada em GET /api/rotinas apenas quando query explícita for informada
  // (Mantém retrocompatibilidade das Fases 2–10 quando GET/POST /api/rotinas não tem owner_kind)
  if (method === "GET" && path === "/api/rotinas") {
    const ownerKindParam = url.searchParams.get("owner_kind");
    const ownerIdParam = url.searchParams.get("owner_id");
    if (!ownerKindParam && !ownerIdParam) {
      return false;
    }
    if (ownerKindParam === "all") {
      sendJson(res, 200, { rotinas: routineStore.listAll() });
      return true;
    }
    const ownerKind = normalizeOwnerKind(ownerKindParam);
    const rotinas = ownerIdParam
      ? routineStore.listByOwner(ownerKind, ownerIdParam)
      : routineStore.listAll().filter((item) => item.owner_kind === ownerKind);
    sendJson(res, 200, { rotinas });
    return true;
  }

  // Preserva POST /api/rotinas para rotas legadas de cron simples
  if (method === "POST" && path === "/api/rotinas") {
    return false;
  }

  // 4. Listagem por agente ou canal
  const agentRoutinesMatch = path.match(/^\/api\/agentes\/([^/]+)\/rotinas$/);
  if (method === "GET" && agentRoutinesMatch) {
    const agenteId = decodeURIComponent(agentRoutinesMatch[1]);
    sendJson(res, 200, { rotinas: routineStore.listByOwner("agente", agenteId) });
    return true;
  }

  const channelRoutinesMatch = path.match(/^\/api\/canais\/([^/]+)\/rotinas$/);
  if (method === "GET" && channelRoutinesMatch) {
    const canalId = decodeURIComponent(channelRoutinesMatch[1]);
    sendJson(res, 200, { rotinas: routineStore.listByOwner("canal", canalId) });
    return true;
  }

  // 5. Opções de destino de entrega
  if (method === "GET" && path === "/api/rotinas/destinos-opcoes") {
    sendJson(res, 200, { opcoes: resultDispatcher.listDestinationOptions() });
    return true;
  }

  // 6. Criar nova rotina gerenciada
  if (method === "POST" && path === "/api/rotinas/gerenciar") {
    try {
      const body = await readJsonBody(req);
      const nome = typeof body.nome === "string" ? body.nome.trim() : "";
      const instrucao = typeof body.instrucao === "string" ? body.instrucao.trim() : "";
      if (!nome || !instrucao) {
        sendJson(res, 400, { erro: "Campos obrigatórios: 'nome' e 'instrucao'." });
        return true;
      }

      const ownerKind = normalizeOwnerKind(body.owner_kind);
      const ownerId =
        typeof body.owner_id === "string" && body.owner_id.trim()
          ? body.owner_id.trim()
          : "estrategista";
      const triggerKind: "schedule" | "webhook" =
        body.trigger_kind === "webhook" ? "webhook" : "schedule";
      const ativa = typeof body.ativa === "boolean" ? body.ativa : true;
      const timezone =
        typeof body.timezone === "string" && body.timezone.trim()
          ? body.timezone.trim()
          : defaultTimezone();

      let schedule: RoutineSchedule | null = null;
      let nextRunAt: string | null = null;

      if (triggerKind === "schedule") {
        if (!isRoutineSchedule(body.schedule)) {
          sendJson(res, 400, { erro: "Configuração de agenda ('schedule') inválida ou ausente." });
          return true;
        }
        schedule = body.schedule;
        const now = new Date();
        const validationErr = validateRoutineSchedule(schedule, timezone, now, {
          requireFutureOnce: true,
        });
        if (validationErr) {
          sendJson(res, 400, { erro: validationErr });
          return true;
        }
        if (ativa) {
          nextRunAt = computeNextRoutineOccurrence(schedule, timezone, now)?.toISOString() ?? null;
        }
      }

      const webhookEventType =
        typeof body.webhook_event_type === "string"
          ? body.webhook_event_type.trim() || null
          : null;
      const webhookFilters = sanitizeFilters(body.webhook_filters);

      const created = routineStore.createRoutine({
        owner_kind: ownerKind,
        owner_id: ownerId,
        nome,
        instrucao,
        ativa,
        timezone,
        trigger_kind: triggerKind,
        schedule,
        next_run_at: nextRunAt,
        limit_policy: (body.limit_policy as RoutineLimitPolicy | undefined) ?? "wait",
        missed_policy: (body.missed_policy as RoutineMissedPolicy | undefined) ?? "skip",
        run_in: (body.run_in as RoutineRunPlace | undefined) ?? "chat",
        destino_resultado: parseOptionalDestination(body.destino_resultado) ?? null,
        webhook_event_type: webhookEventType,
        webhook_filters: webhookFilters,
      });

      let secretOnce: string | null = null;
      let finalRoutine: AgentRoutine = created;
      if (triggerKind === "webhook") {
        const provisioned = webhookService.provisionWebhook(created, {
          event_type: webhookEventType,
          filters: webhookFilters,
        });
        secretOnce = provisioned.secretOnce;
        finalRoutine = routineStore.getById(created.rotina_id) ?? created;
      }

      timer.arm();
      wsHub.broadcast("routine:updated", {
        owner_kind: finalRoutine.owner_kind,
        owner_id: finalRoutine.owner_id,
        rotina_id: finalRoutine.rotina_id,
        acao: "created",
      });

      sendJson(res, 201, { rotina: finalRoutine, secret: secretOnce });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  // 7. Atualizar / Excluir rotina gerenciada
  const manageRoutineMatch = path.match(/^\/api\/rotinas\/gerenciar\/([^/]+)$/);
  if (manageRoutineMatch && (method === "PUT" || method === "PATCH" || method === "DELETE")) {
    const rotinaId = decodeURIComponent(manageRoutineMatch[1]);
    const existing = routineStore.getById(rotinaId);
    if (!existing) {
      sendJson(res, 404, { erro: `Rotina '${rotinaId}' não encontrada.` });
      return true;
    }

    if (method === "DELETE") {
      webhookService.removeWebhook(rotinaId);
      routineStore.deleteRoutine(rotinaId);
      timer.arm();
      wsHub.broadcast("routine:updated", {
        owner_kind: existing.owner_kind,
        owner_id: existing.owner_id,
        rotina_id: existing.rotina_id,
        acao: "deleted",
      });
      sendJson(res, 200, { ok: true, rotina_id: rotinaId });
      return true;
    }

    try {
      const body = await readJsonBody(req);
      const nextTriggerKind: "schedule" | "webhook" =
        body.trigger_kind === "webhook" || body.trigger_kind === "schedule"
          ? body.trigger_kind
          : existing.trigger_kind;
      const nextAtiva = typeof body.ativa === "boolean" ? body.ativa : existing.ativa;
      const nextTimezone =
        typeof body.timezone === "string" && body.timezone.trim()
          ? body.timezone.trim()
          : existing.timezone;

      let nextSchedule: RoutineSchedule | null = existing.schedule;
      if (body.schedule !== undefined) {
        if (body.schedule === null) {
          nextSchedule = null;
        } else if (isRoutineSchedule(body.schedule)) {
          nextSchedule = body.schedule;
        } else {
          sendJson(res, 400, { erro: "Objeto 'schedule' inválido." });
          return true;
        }
      }

      let nextRunAt: string | null = existing.next_run_at;
      if (nextTriggerKind === "webhook") {
        nextSchedule = null;
        nextRunAt = null;
      } else {
        if (!nextSchedule) {
          sendJson(res, 400, { erro: "Rotinas agendadas exigem configuração 'schedule'." });
          return true;
        }
        const now = new Date();
        const scheduleChanged =
          body.schedule !== undefined ||
          body.timezone !== undefined ||
          existing.trigger_kind !== "schedule";
        const reactivatedOnce =
          nextSchedule.kind === "once" && nextAtiva && (!existing.ativa || scheduleChanged);
        const validationErr = validateRoutineSchedule(nextSchedule, nextTimezone, now, {
          requireFutureOnce: reactivatedOnce,
        });
        if (validationErr) {
          sendJson(res, 400, { erro: validationErr });
          return true;
        }
        if (nextSchedule.kind === "once" && nextAtiva) {
          const nextDate = computeNextRoutineOccurrence(nextSchedule, nextTimezone, now);
          if (!nextDate) {
            sendJson(res, 400, {
              erro: "Informe uma data e horário futuros para reativar uma rotina única.",
            });
            return true;
          }
          nextRunAt = nextDate.toISOString();
        } else if (!nextAtiva) {
          nextRunAt = null;
        } else if (scheduleChanged || !existing.ativa || !existing.next_run_at) {
          nextRunAt = computeNextRoutineOccurrence(nextSchedule, nextTimezone, now)?.toISOString() ?? null;
        }
      }

      if (existing.trigger_kind === "webhook" && nextTriggerKind === "schedule") {
        webhookService.removeWebhook(rotinaId);
      }

      const patchDestination = parseOptionalDestination(body.destino_resultado);
      const updated = routineStore.updateRoutine(rotinaId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        instrucao: typeof body.instrucao === "string" ? body.instrucao : undefined,
        ativa: nextAtiva,
        timezone: nextTimezone,
        trigger_kind: nextTriggerKind,
        schedule: nextSchedule,
        next_run_at: nextRunAt,
        limit_policy: body.limit_policy as RoutineLimitPolicy | undefined,
        missed_policy: body.missed_policy as RoutineMissedPolicy | undefined,
        run_in: body.run_in as RoutineRunPlace | undefined,
        destino_resultado: patchDestination,
        webhook_event_type:
          body.webhook_event_type !== undefined
            ? typeof body.webhook_event_type === "string"
              ? body.webhook_event_type.trim() || null
              : null
            : undefined,
        webhook_filters:
          body.webhook_filters !== undefined ? sanitizeFilters(body.webhook_filters) : undefined,
      });

      let secretOnce: string | null = null;
      let finalRoutine = updated;
      if (nextTriggerKind === "webhook" && existing.trigger_kind !== "webhook") {
        const provisioned = webhookService.provisionWebhook(updated, {
          event_type: updated.webhook?.event_type ?? null,
          filters: updated.webhook?.filters ?? [],
        });
        secretOnce = provisioned.secretOnce;
        finalRoutine = routineStore.getById(rotinaId) ?? updated;
      }

      timer.arm();
      wsHub.broadcast("routine:updated", {
        owner_kind: finalRoutine.owner_kind,
        owner_id: finalRoutine.owner_id,
        rotina_id: finalRoutine.rotina_id,
        acao: "updated",
      });

      sendJson(res, 200, { rotina: finalRoutine, secret: secretOnce });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  // 8. Testar rotina manualmente
  const testRoutineMatch = path.match(/^\/api\/rotinas\/gerenciar\/([^/]+)\/testar$/);
  if (method === "POST" && testRoutineMatch) {
    const rotinaId = decodeURIComponent(testRoutineMatch[1]);
    try {
      const body = await readJsonBody(req);
      const instrucaoOverride =
        typeof body.instrucao === "string" && body.instrucao.trim()
          ? body.instrucao.trim()
          : undefined;
      const execucao = executionService.enqueueManualRun({
        rotinaId,
        runSource: "test",
        instrucaoOverride,
      });
      await flowsEngine.sweep();
      sendJson(res, 202, { execucao });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  // 9. Listar execuções da rotina
  const listRunsMatch = path.match(/^\/api\/rotinas\/gerenciar\/([^/]+)\/execucoes$/);
  if (method === "GET" && listRunsMatch) {
    const rotinaId = decodeURIComponent(listRunsMatch[1]);
    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : 20;
    const withSkipped = parseBooleanQuery(url.searchParams.get("with_skipped"));
    const execucoes = routineStore.listRuns(rotinaId, { limit, withSkipped });
    sendJson(res, 200, { execucoes });
    return true;
  }

  // 10. Parar execução ativa da rotina
  const stopRunMatch = path.match(
    /^\/api\/rotinas\/gerenciar\/([^/]+)\/execucoes\/([^/]+)\/parar$/
  );
  if (method === "POST" && stopRunMatch) {
    const execucaoId = decodeURIComponent(stopRunMatch[2]);
    const execucao = executionService.cancelExecution(execucaoId, "Interrompida pelo usuário");
    await flowsEngine.stopRun(execucaoId, "Interrompida pelo usuário");
    if (!execucao) {
      sendJson(res, 404, { erro: `Execução '${execucaoId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { ok: true, execucao });
    return true;
  }

  // 11. Atualizar destino de resultado da rotina
  const updateDestMatch = path.match(/^\/api\/rotinas\/gerenciar\/([^/]+)\/destino$/);
  if (method === "PUT" && updateDestMatch) {
    const rotinaId = decodeURIComponent(updateDestMatch[1]);
    try {
      const body = await readJsonBody(req);
      const rawDest = body.destino ?? body.destino_resultado ?? body;
      if (rawDest !== null && !isRoutineResultDestination(rawDest)) {
        sendJson(res, 400, { erro: "Destino de resultado inválido." });
        return true;
      }
      const updated = routineStore.updateRoutine(rotinaId, {
        destino_resultado: rawDest,
      });
      wsHub.broadcast("routine:updated", {
        owner_kind: updated.owner_kind,
        owner_id: updated.owner_id,
        rotina_id: updated.rotina_id,
        acao: "updated",
      });
      sendJson(res, 200, { rotina: updated });
    } catch (error) {
      buildErrorResponse(res, sendJson, error);
    }
    return true;
  }

  // 12. Feed iCalendar (.ics) das rotinas + gestão de token (G-13)
  if (method === "GET" && path === "/api/rotinas/feed.ics") {
    const token = url.searchParams.get("token");
    if (!verifyIcsFeedToken(deps.db, token)) {
      sendJson(res, 401, { erro: "Token do feed iCalendar ausente ou inválido." });
      return true;
    }
    const routines = routineStore.listAll();
    const ics = buildRoutinesIcsFeed(routines);
    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="criativo-rotinas.ics"',
      "Cache-Control": "no-cache",
    });
    res.end(ics);
    return true;
  }

  if (method === "GET" && path === "/api/rotinas/feed-config") {
    const config = getIcsFeedConfig(deps.db);
    sendJson(res, 200, {
      ok: true,
      enabled: config.enabled,
      feedPath: config.feedPath,
      updatedAt: config.updatedAt,
    });
    return true;
  }

  if (method === "POST" && path === "/api/rotinas/feed-token/rotate") {
    rotateIcsFeedToken(deps.db);
    const config = getIcsFeedConfig(deps.db);
    sendJson(res, 200, {
      ok: true,
      enabled: config.enabled,
      feedPath: config.feedPath,
      updatedAt: config.updatedAt,
    });
    return true;
  }

  return false;
}
