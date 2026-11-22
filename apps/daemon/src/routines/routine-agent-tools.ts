import {
  isEventFilter,
  isRoutineSchedule,
  isValidIanaTimeZone,
  type EventFilter,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineRunPlace,
  type RoutineSchedule,
  type ToolCallRequest,
} from "@criativo/contracts";
import {
  resolveAgentIdFromDb,
} from "../server/agent-resolver.ts";
import {
  computeNextRoutineOccurrence,
  validateRoutineSchedule,
} from "./routine-schedule-calc.ts";
import { sanitizeRoutineForTool, postSystemNotice, type RoutineToolExecutionContext, type RoutineToolsDeps } from "./routine-tool-schemas.ts";

export * from "./routine-tool-schemas.ts";

export async function executeRoutineToolCall(
  call: ToolCallRequest,
  context: RoutineToolExecutionContext,
  deps: RoutineToolsDeps
): Promise<unknown> {
  const args = call.arguments ?? {};

  switch (call.name) {
    case "routine_no_update": {
      context.flags.noUpdateCalled = true;
      return {
        ok: true,
        silenced: true,
        message: "Modo silencioso registrado. A notificação automática será omitida.",
      };
    }

    case "routine_report_failure": {
      const reason =
        typeof args.reason === "string" && args.reason.trim()
          ? args.reason.trim()
          : "Falha reportada pelo agente durante a rotina.";
      context.flags.failureReason = reason;
      return {
        ok: true,
        recordedFailure: reason,
      };
    }

    case "list_routines": {
      const rawAgentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : "";
      const targetAgent = rawAgentId
        ? resolveAgentIdFromDb(deps.db, rawAgentId) ?? rawAgentId
        : context.agenteId;
      const list = deps.routineStore.listByOwner("agente", targetAgent);
      return {
        agenteId: targetAgent,
        total: list.length,
        rotinas: list.map(sanitizeRoutineForTool),
      };
    }

    case "create_routine": {
      const rawAgentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : "";
      const targetAgent = rawAgentId
        ? resolveAgentIdFromDb(deps.db, rawAgentId) ?? rawAgentId
        : context.agenteId;
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!name || !instruction) {
        throw new Error("Informe 'name' e 'instruction' válidos para criar a rotina.");
      }

      let scheduleRaw = args.schedule;
      if (
        scheduleRaw &&
        typeof scheduleRaw === "object" &&
        !Array.isArray(scheduleRaw) &&
        (scheduleRaw as Record<string, unknown>).kind === "interval" &&
        !(
          typeof (scheduleRaw as Record<string, unknown>).anchorAt === "string" &&
          String((scheduleRaw as Record<string, unknown>).anchorAt).trim()
        )
      ) {
        scheduleRaw = {
          ...(scheduleRaw as Record<string, unknown>),
          anchorAt: new Date().toISOString(),
        };
      }
      if (!isRoutineSchedule(scheduleRaw)) {
        if (
          scheduleRaw &&
          typeof scheduleRaw === "object" &&
          !Array.isArray(scheduleRaw) &&
          (scheduleRaw as Record<string, unknown>).kind === "interval" &&
          (scheduleRaw as Record<string, unknown>).unit === "minutes" &&
          typeof (scheduleRaw as Record<string, unknown>).amount === "number" &&
          Number((scheduleRaw as Record<string, unknown>).amount) < 3
        ) {
          throw new Error(
            "Intervalo mínimo para rotinas agendadas é de 3 minutos. Para ciclos curtos (< 3 min, de 10s a 179s) ou verificações no chat, utilize 'schedule_wakeup'.",
          );
        }
        throw new Error("Campo 'schedule' inválido.");
      }

      const timezone =
        typeof args.timezone === "string" && isValidIanaTimeZone(args.timezone)
          ? args.timezone.trim()
          : "America/Sao_Paulo";

      const validationErr = validateRoutineSchedule(scheduleRaw, timezone, new Date(), {
        requireFutureOnce: true,
      });
      if (validationErr) {
        if (/3\s*min|m[ií]nimo/i.test(validationErr)) {
          throw new Error(
            `${validationErr} Para verificações curtas (< 3 minutos, de 10s a 179s) ou retomadas rápidas no chat, utilize 'schedule_wakeup'.`,
          );
        }
        throw new Error(validationErr);
      }

      const now = new Date();
      const active = typeof args.active === "boolean" ? args.active : true;
      const nextOccurrence = active
        ? computeNextRoutineOccurrence(scheduleRaw, timezone, now)
        : null;

      const created = deps.routineStore.createRoutine({
        owner_kind: "agente",
        owner_id: targetAgent,
        nome: name,
        instrucao: instruction,
        ativa: active,
        timezone,
        trigger_kind: "schedule",
        schedule: scheduleRaw as RoutineSchedule,
        next_run_at: nextOccurrence?.toISOString() ?? null,
        limit_policy: (args.limitPolicy as RoutineLimitPolicy) ?? "wait",
        missed_policy:
          (args.missedPolicy as RoutineMissedPolicy) ??
          (scheduleRaw.kind === "once" ? "run-once" : "skip"),
        run_in: args.runIn === "side_thread" ? "side_thread" : "chat",
      });

      deps.timer.arm();
      deps.wsHub.broadcast("routine:updated", {
        owner_kind: created.owner_kind,
        owner_id: created.owner_id,
        rotina_id: created.rotina_id,
        acao: "created",
      });
      postSystemNotice(deps, targetAgent, `Rotina agendada criada: **${created.nome}**.`);

      return {
        ok: true,
        routine: sanitizeRoutineForTool(created),
      };
    }

    case "update_routine": {
      const routineId = typeof args.routineId === "string" ? args.routineId.trim() : "";
      if (!routineId) {
        throw new Error("Informe 'routineId' da rotina a atualizar.");
      }
      if (typeof args.agentId === "string" && args.agentId.trim()) {
        void resolveAgentIdFromDb(deps.db, args.agentId.trim());
      }
      const existing = deps.routineStore.getById(routineId);
      if (!existing) {
        throw new Error(`Rotina '${routineId}' não encontrada.`);
      }
      if (existing.trigger_kind === "webhook") {
        throw new Error(
          "Esta é uma rotina de webhook. Use 'update_webhook_routine' para alterá-la."
        );
      }

      const nextTimezone =
        typeof args.timezone === "string" && isValidIanaTimeZone(args.timezone)
          ? args.timezone.trim()
          : existing.timezone;
      let nextSchedule =
        args.schedule !== undefined ? args.schedule : existing.schedule;
      if (
        nextSchedule &&
        typeof nextSchedule === "object" &&
        !Array.isArray(nextSchedule) &&
        (nextSchedule as Record<string, unknown>).kind === "interval" &&
        !(
          typeof (nextSchedule as Record<string, unknown>).anchorAt === "string" &&
          String((nextSchedule as Record<string, unknown>).anchorAt).trim()
        )
      ) {
        nextSchedule = {
          ...(nextSchedule as Record<string, unknown>),
          anchorAt: new Date().toISOString(),
        };
      }
      if (!nextSchedule || !isRoutineSchedule(nextSchedule)) {
        if (
          nextSchedule &&
          typeof nextSchedule === "object" &&
          !Array.isArray(nextSchedule) &&
          (nextSchedule as Record<string, unknown>).kind === "interval" &&
          (nextSchedule as Record<string, unknown>).unit === "minutes" &&
          typeof (nextSchedule as Record<string, unknown>).amount === "number" &&
          Number((nextSchedule as Record<string, unknown>).amount) < 3
        ) {
          throw new Error(
            "Intervalo mínimo para rotinas agendadas é de 3 minutos. Para ciclos curtos (< 3 min, de 10s a 179s) ou verificações no chat, utilize 'schedule_wakeup'.",
          );
        }
        throw new Error("Campo 'schedule' inválido.");
      }

      const nextActive = typeof args.active === "boolean" ? args.active : existing.ativa;
      const requiresFutureOnce =
        nextSchedule.kind === "once" &&
        (nextActive && (!existing.ativa || args.schedule !== undefined));
      const validationErr = validateRoutineSchedule(nextSchedule, nextTimezone, new Date(), {
        requireFutureOnce: requiresFutureOnce,
      });
      if (validationErr) {
        if (/3\s*min|m[ií]nimo/i.test(validationErr)) {
          throw new Error(
            `${validationErr} Para verificações curtas (< 3 minutos, de 10s a 179s) ou retomadas rápidas no chat, utilize 'schedule_wakeup'.`,
          );
        }
        throw new Error(validationErr);
      }

      const nextRunAt = nextActive
        ? computeNextRoutineOccurrence(nextSchedule, nextTimezone, new Date())?.toISOString() ??
          null
        : existing.next_run_at;

      const updated = deps.routineStore.updateRoutine(routineId, {
        nome: typeof args.name === "string" ? args.name.trim() : undefined,
        instrucao: typeof args.instruction === "string" ? args.instruction.trim() : undefined,
        timezone: nextTimezone,
        schedule: nextSchedule,
        ativa: nextActive,
        next_run_at: nextRunAt,
        limit_policy:
          args.limitPolicy === "skip" || args.limitPolicy === "wait"
            ? (args.limitPolicy as RoutineLimitPolicy)
            : undefined,
        missed_policy:
          args.missedPolicy === "skip" || args.missedPolicy === "run-once"
            ? (args.missedPolicy as RoutineMissedPolicy)
            : undefined,
        run_in:
          args.runIn === "chat" || args.runIn === "side_thread"
            ? (args.runIn as RoutineRunPlace)
            : undefined,
      });

      deps.timer.arm();
      deps.wsHub.broadcast("routine:updated", {
        owner_kind: updated.owner_kind,
        owner_id: updated.owner_id,
        rotina_id: updated.rotina_id,
        acao: "updated",
      });

      return {
        ok: true,
        routine: sanitizeRoutineForTool(updated),
      };
    }

    case "delete_routine": {
      const routineId = typeof args.routineId === "string" ? args.routineId.trim() : "";
      if (!routineId) {
        throw new Error("Informe 'routineId' da rotina a excluir.");
      }
      const existing = deps.routineStore.getById(routineId);
      if (!existing) {
        throw new Error(`Rotina '${routineId}' não encontrada.`);
      }

      for (const run of deps.routineStore.listRuns(routineId, { limit: 25 })) {
        if (run.status === "queued" || run.status === "running" || run.status === "needs-attention") {
          deps.executionService.cancelExecution(run.execucao_id, "Rotina removida.");
        }
      }

      deps.webhookService.removeWebhook(routineId);
      const removed = deps.routineStore.deleteRoutine(routineId);
      deps.timer.arm();

      if (removed) {
        deps.wsHub.broadcast("routine:updated", {
          owner_kind: existing.owner_kind,
          owner_id: existing.owner_id,
          rotina_id: routineId,
          acao: "deleted",
        });
      }

      return { ok: removed, removed, routineId };
    }

    case "test_routine": {
      const routineId = typeof args.routineId === "string" ? args.routineId.trim() : "";
      if (!routineId) {
        throw new Error("Informe 'routineId' da rotina para testar.");
      }
      const existing = deps.routineStore.getById(routineId);
      if (!existing) {
        throw new Error(`Rotina '${routineId}' não encontrada.`);
      }
      if (existing.trigger_kind === "webhook") {
        throw new Error(
          "Rotinas webhook não podem ser disparadas por test_routine; use o botão 'Testar webhook' nas configurações da rotina."
        );
      }

      const exec = deps.executionService.enqueueManualRun({
        rotinaId: routineId,
        runSource: "test",
      });

      return {
        ok: true,
        execucao_id: exec.execucao_id,
        status: exec.status,
      };
    }

    case "create_webhook_routine": {
      if (context.turnOrigin !== "human") {
        throw new Error(
          "Por segurança, rotinas de webhook só podem ser criadas quando solicitadas pelo usuário humano no chat."
        );
      }
      const rawAgentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : "";
      const targetAgent = rawAgentId
        ? resolveAgentIdFromDb(deps.db, rawAgentId) ?? rawAgentId
        : context.agenteId;
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!name || !instruction) {
        throw new Error("Informe 'name' e 'instruction' para a rotina webhook.");
      }

      const eventType =
        typeof args.eventType === "string" && args.eventType.trim()
          ? args.eventType.trim()
          : null;
      const rawFilters = Array.isArray(args.filters) ? args.filters : [];
      const filters: EventFilter[] = rawFilters.filter(isEventFilter);

      const created = deps.routineStore.createRoutine({
        owner_kind: "agente",
        owner_id: targetAgent,
        nome: name,
        instrucao: instruction,
        ativa: typeof args.active === "boolean" ? args.active : true,
        timezone: "America/Sao_Paulo",
        trigger_kind: "webhook",
        limit_policy: args.limitPolicy === "skip" ? "skip" : "wait",
        run_in: args.runIn === "side_thread" ? "side_thread" : "chat",
        webhook_event_type: eventType,
        webhook_filters: filters,
      });

      const provisioned = deps.webhookService.provisionWebhook(created, {
        event_type: eventType,
        filters,
      });

      deps.wsHub.broadcast("routine:updated", {
        owner_kind: created.owner_kind,
        owner_id: created.owner_id,
        rotina_id: created.rotina_id,
        acao: "created",
      });

      const refreshed = deps.routineStore.getById(created.rotina_id) ?? created;
      postSystemNotice(
        deps,
        targetAgent,
        `Webhook configurado para a rotina **${refreshed.nome}**. O segredo HMAC está protegido no Cofre AES-256-GCM.`
      );

      // Segredo NUNCA é devolvido às LLMs (D-06 / T-11-12)
      return {
        ok: true,
        routine: sanitizeRoutineForTool(refreshed),
        webhook: {
          url: provisioned.webhook.url,
          event_type: provisioned.webhook.event_type,
          filters: provisioned.webhook.filters,
        },
        secretNotice:
          "O segredo HMAC foi salvo no Cofre local e deve ser visualizado/rotacionado apenas na interface pelo usuário.",
      };
    }

    case "update_webhook_routine": {
      if (context.turnOrigin !== "human") {
        throw new Error(
          "Por segurança, rotinas de webhook só podem ser modificadas em conversa direta iniciada pelo usuário."
        );
      }
      const routineId = typeof args.routineId === "string" ? args.routineId.trim() : "";
      if (!routineId) {
        throw new Error("Informe 'routineId' da rotina webhook.");
      }
      const existing = deps.routineStore.getById(routineId);
      if (!existing) {
        throw new Error(`Rotina '${routineId}' não encontrada.`);
      }
      if (existing.trigger_kind !== "webhook") {
        throw new Error("A rotina especificada não é do tipo webhook; use 'update_routine'.");
      }

      const eventType =
        args.eventType !== undefined
          ? typeof args.eventType === "string" && args.eventType.trim()
            ? args.eventType.trim()
            : null
          : undefined;
      const filters = Array.isArray(args.filters)
        ? (args.filters as unknown[]).filter(isEventFilter)
        : undefined;

      const updated = deps.routineStore.updateRoutine(routineId, {
        nome: typeof args.name === "string" ? args.name.trim() : undefined,
        instrucao: typeof args.instruction === "string" ? args.instruction.trim() : undefined,
        ativa: typeof args.active === "boolean" ? args.active : undefined,
        limit_policy:
          args.limitPolicy === "skip" || args.limitPolicy === "wait"
            ? (args.limitPolicy as RoutineLimitPolicy)
            : undefined,
        run_in:
          args.runIn === "chat" || args.runIn === "side_thread"
            ? (args.runIn as RoutineRunPlace)
            : undefined,
        webhook_event_type: eventType,
        webhook_filters: filters,
      });

      deps.wsHub.broadcast("routine:updated", {
        owner_kind: updated.owner_kind,
        owner_id: updated.owner_id,
        rotina_id: updated.rotina_id,
        acao: "updated",
      });

      return {
        ok: true,
        routine: sanitizeRoutineForTool(updated),
      };
    }

    default:
      throw new Error(`Ferramenta de rotina desconhecida: ${call.name}`);
  }
}

