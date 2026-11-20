import { randomUUID } from "node:crypto";
import {
  isEventFilter,
  isRoutineSchedule,
  isValidIanaTimeZone,
  type AgentRoutine,
  type EventFilter,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineRunPlace,
  type RoutineSchedule,
  type ToolCallRequest,
  type ToolDefinition,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { resolveAgentIdFromDb } from "../server/agent-resolver.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { RoutineExecutionService } from "./routine-execution-service.ts";
import type { RoutineFlowsEngine } from "./routine-flows-engine.ts";
import {
  computeNextRoutineOccurrence,
  validateRoutineSchedule,
} from "./routine-schedule-calc.ts";
import type { RoutineStore } from "./routine-store.ts";
import type { RoutineTimer } from "./routine-timer.ts";
import type { WebhookRoutineService } from "./webhook-routine-service.ts";

export const ROUTINE_SCHEDULE_SCHEMA = {
  type: "object",
  description:
    "Objeto RoutineSchedule tipado ({ kind: 'daily'|'weekly'|'weekdays'|'monthly'|'hourly'|'interval'|'advanced'|'custom'|'once', ... }).",
  properties: {
    kind: {
      type: "string",
      enum: ["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "advanced", "custom", "once"],
      description: "Tipo/frequência da rotina.",
    },
    minute: {
      type: "number",
      description: "Minuto da hora (0–59) quando kind='hourly'.",
    },
    time: {
      type: "string",
      description: "Horário no formato HH:MM (ex.: '09:30') para daily, weekdays, weekly, monthly ou once.",
    },
    weekday: {
      type: "number",
      description: "Dia da semana (0=Domingo..6=Sábado) quando kind='weekly'.",
    },
    day: {
      type: "number",
      description: "Dia do mês (1–31) quando kind='monthly'.",
    },
    amount: {
      type: "number",
      description: "Quantidade de unidades quando kind='interval' (ex.: 5 para a cada 5 minutos).",
    },
    unit: {
      type: "string",
      enum: ["minutes", "hours", "days"],
      description: "Unidade do intervalo quando kind='interval'.",
    },
    anchorAt: {
      type: "string",
      description: "Data/hora ISO âncora opcional para kind='interval' (preenchida automaticamente se omitida).",
    },
    expression: {
      type: "string",
      description: "Expressão cron 5 campos quando kind='custom'.",
    },
    date: {
      type: "string",
      description: "Data YYYY-MM-DD quando kind='once'.",
    },
    months: {
      type: "array",
      items: { type: "number" },
      description: "Lista de meses (1–12) quando kind='advanced'.",
    },
    days: {
      type: "object",
      description: "Seleção de dias para kind='advanced'.",
      properties: {
        kind: {
          type: "string",
          enum: ["every-day", "days-of-week", "days-of-month"],
        },
        days: {
          type: "array",
          items: { type: "number" },
        },
      },
    },
  },
  required: ["kind"],
} as const;

export const ROUTINE_AGENT_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "routine_no_update",
    description:
      "Encerra uma execução automática agendada/webhook de rotina quando não houver novidades ou ações pendentes, colapsando notificações e envios externos.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "routine_report_failure",
    description:
      "Registra falha estruturada durante uma execução automática de rotina, encerrando a execução como falhada e propagando o erro.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo objetivo da falha encontrada na rotina.",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "list_routines",
    description:
      "Lista as rotinas agendadas e webhooks de um agente ou do próprio agente sem expor segredos.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID do agente (opcional; padrão é o agente atual).",
        },
      },
    },
  },
  {
    name: "create_routine",
    description:
      "Cria uma rotina agendada (hourly, daily, weekdays, weekly, monthly, interval, advanced, custom cron ou once) respeitando intervalo mínimo de 3 minutos.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        name: { type: "string" },
        instruction: { type: "string" },
        schedule: ROUTINE_SCHEDULE_SCHEMA,
        active: { type: "boolean" },
        timezone: { type: "string" },
        limitPolicy: { type: "string", enum: ["wait", "skip"] },
        missedPolicy: { type: "string", enum: ["skip", "run-once"] },
        runIn: { type: "string", enum: ["chat", "side_thread"] },
      },
      required: ["name", "instruction", "schedule"],
    },
  },
  {
    name: "update_routine",
    description:
      "Atualiza uma rotina agendada existente (não permite editar rotinas webhook; use update_webhook_routine).",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        agentId: { type: "string" },
        name: { type: "string" },
        instruction: { type: "string" },
        schedule: ROUTINE_SCHEDULE_SCHEMA,
        active: { type: "boolean" },
        timezone: { type: "string" },
        limitPolicy: { type: "string", enum: ["wait", "skip"] },
        missedPolicy: { type: "string", enum: ["skip", "run-once"] },
        runIn: { type: "string", enum: ["chat", "side_thread"] },
      },
      required: ["routineId"],
    },
  },
  {
    name: "delete_routine",
    description:
      "Exclui definitivamente uma rotina (e revoga seu segredo de webhook no Cofre, se houver).",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
      },
      required: ["routineId"],
    },
  },
  {
    name: "test_routine",
    description:
      "Dispara imediatamente uma execução manual de teste para uma rotina agendada.",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
      },
      required: ["routineId"],
    },
  },
  {
    name: "create_webhook_routine",
    description:
      "Cria uma rotina acionada por webhook HTTP autenticado com HMAC-SHA256 e filtros opcionais (permitido apenas quando solicitado pelo usuário no chat).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        name: { type: "string" },
        instruction: { type: "string" },
        eventType: { type: "string" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pointer: { type: "string" },
              value: {
                type: "string",
                description: "Valor esperado para comparação com o ponteiro JSON.",
              },
            },
            required: ["pointer", "value"],
          },
        },
        active: { type: "boolean" },
        limitPolicy: { type: "string", enum: ["wait", "skip"] },
        runIn: { type: "string", enum: ["chat", "side_thread"] },
      },
      required: ["name", "instruction"],
    },
  },
  {
    name: "update_webhook_routine",
    description:
      "Atualiza filtros, eventType ou instruções de uma rotina webhook existente (permitido apenas em conversa direta com o usuário).",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        name: { type: "string" },
        instruction: { type: "string" },
        eventType: { type: "string" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pointer: { type: "string" },
              value: {
                type: "string",
                description: "Valor esperado para comparação.",
              },
            },
            required: ["pointer", "value"],
          },
        },
        active: { type: "boolean" },
        limitPolicy: { type: "string", enum: ["wait", "skip"] },
        runIn: { type: "string", enum: ["chat", "side_thread"] },
      },
      required: ["routineId"],
    },
  },
];

const ROUTINE_TOOL_NAMES = new Set(ROUTINE_AGENT_TOOLS_SCHEMA.map((t) => t.name));

export function isRoutineToolName(name: string): boolean {
  return ROUTINE_TOOL_NAMES.has(name);
}

export interface RoutineToolExecutionContext {
  agenteId: string;
  turnOrigin: "human" | "routine" | "webhook" | "flow";
  execucaoId?: string | null;
  flags: {
    noUpdateCalled: boolean;
    failureReason: string | null;
  };
}

export interface RoutineToolsDeps {
  db: CriativoDatabase;
  routineStore: RoutineStore;
  timer: RoutineTimer;
  executionService: RoutineExecutionService;
  webhookService: WebhookRoutineService;
  flowsEngine?: RoutineFlowsEngine;
  wsHub: WebSocketHub;
}

function sanitizeRoutineForTool(routine: AgentRoutine): Record<string, unknown> {
  return {
    rotina_id: routine.rotina_id,
    owner_kind: routine.owner_kind,
    owner_id: routine.owner_id,
    nome: routine.nome,
    instrucao: routine.instrucao,
    ativa: routine.ativa,
    timezone: routine.timezone,
    trigger_kind: routine.trigger_kind,
    schedule: routine.schedule,
    next_run_at: routine.next_run_at,
    limit_policy: routine.limit_policy,
    missed_policy: routine.missed_policy,
    run_in: routine.run_in,
    webhook: routine.webhook
      ? {
          webhook_id: routine.webhook.webhook_id,
          url: routine.webhook.url,
          event_type: routine.webhook.event_type,
          filters: routine.webhook.filters,
          ultimo_disparo_em: routine.webhook.ultimo_disparo_em,
        }
      : null,
  };
}

function postSystemNotice(
  deps: RoutineToolsDeps,
  agenteId: string,
  markdown: string
): void {
  const msgId = `msg-rot-sys-${randomUUID()}`;
  const agora = new Date().toISOString();
  const canalId = `agente:${agenteId}`;
  try {
    deps.db.connection
      .prepare(
        `
        INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome,
          conteudo_markdown, anexos_json, steps_json, lida, criado_em
        ) VALUES (?, ?, ?, 'sistema', 'Rotinas', ?, '[]', '[]', 1, ?);
      `
      )
      .run(msgId, canalId, agenteId, markdown, agora);
  } catch {
    // Melhor-esforço caso chat ainda não esteja inicializado
  }
}

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
