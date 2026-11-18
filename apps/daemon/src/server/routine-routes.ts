import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AgentRoutine,
  EventFilter,
  RoutineCalendar,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineOwnerKind,
  RoutineResultDestination,
  RoutineRunPlace,
  RoutineSchedule,
  RoutineWebhookConfig,
} from "@criativo/contracts";
import {
  isEventFilter,
  isRoutineResultDestination,
  isRoutineSchedule,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { RoutineFlowStore, RoutineFlowStoreError } from "../routines/routine-flow-store.ts";
import type { RoutineFlowsEngine } from "../routines/routine-flows-engine.ts";
import type { RoutineExecutionService } from "../routines/routine-execution-service.ts";
import type { RoutineResultDispatcher } from "../routines/routine-result-dispatcher.ts";
import {
  computeNextRoutineOccurrence,
  expandScheduleOccurrences,
  validateRoutineSchedule,
} from "../routines/routine-schedule-calc.ts";
import { RoutineStore, RoutineStoreError } from "../routines/routine-store.ts";
import type { RoutineTimer } from "../routines/routine-timer.ts";
import type { WebhookRoutineService } from "../routines/webhook-routine-service.ts";
import {
  MAX_WEBHOOK_BODY_BYTES,
  PayloadTooLargeError,
  readRawBodyWithLimit,
} from "../routines/webhook-verifier.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export interface RoutineRoutesDeps {
  db: CriativoDatabase;
  routineStore: RoutineStore;
  flowStore: RoutineFlowStore;
  timer: RoutineTimer;
  resultDispatcher: RoutineResultDispatcher;
  executionService: RoutineExecutionService;
  webhookService: WebhookRoutineService;
  flowsEngine: RoutineFlowsEngine;
  wsHub: WebSocketHub;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
}

function normalizeOwnerKind(raw: unknown): RoutineOwnerKind {
  if (raw === "canal" || raw === "channel") return "canal";
  return "agente";
}

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
}

function parseBooleanQuery(raw: string | null): boolean {
  return raw === "true" || raw === "1" || raw === "sim";
}

function sanitizeFilters(raw: unknown): EventFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEventFilter);
}

function parseOptionalDestination(raw: unknown): RoutineResultDestination | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (isRoutineResultDestination(raw)) return raw;
  return undefined;
}

function buildErrorResponse(res: ServerResponse, sendJson: RoutineRoutesDeps["sendJson"], error: unknown): void {
  if (error instanceof RoutineStoreError || error instanceof RoutineFlowStoreError) {
    sendJson(res, error.statusCode, { erro: error.message, code: error.code });
    return;
  }
  const msg = error instanceof Error ? error.message : String(error);
  sendJson(res, 400, { erro: msg });
}

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
