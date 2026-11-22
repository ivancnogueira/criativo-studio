import {
  randomUUID,
} from "node:crypto";
import {
  type AgentRoutine,
  type RoutineSchedule,
  type ToolDefinition,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  WebSocketHub,
} from "../server/websocket-hub.ts";
import type {
  RoutineExecutionService,
} from "./routine-execution-service.ts";
import type {
  RoutineFlowsEngine,
} from "./routine-flows-engine.ts";
import type {
  RoutineStore,
} from "./routine-store.ts";
import type {
  RoutineTimer,
} from "./routine-timer.ts";
import type {
  WebhookRoutineService,
} from "./webhook-routine-service.ts";

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

export const ROUTINE_TOOL_NAMES = new Set(ROUTINE_AGENT_TOOLS_SCHEMA.map((t) => t.name));

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

export function sanitizeRoutineForTool(routine: AgentRoutine): Record<string, unknown> {
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

export function postSystemNotice(
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

