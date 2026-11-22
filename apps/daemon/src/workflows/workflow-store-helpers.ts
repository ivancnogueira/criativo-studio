import {
  isValidIanaTimeZone,
  normalizeWorkflowGraph,
  type RoutineSchedule,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowRunRecord,
  type WorkflowScheduleConfig,
  type WorkflowTraco,
  type WorkflowTriggerKind,
  type WorkflowTriggerState,
  type WorkflowVisual,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  collapseMissedOccurrences,
  computeNextRoutineOccurrence,
} from "../routines/routine-schedule-calc.ts";
import type { VaultService } from "../vault/vault-service.ts";

export const MAX_WORKFLOW_VERSIONS = 50;
export const AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000;

export class WorkflowValidationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "WorkflowValidationError";
    this.statusCode = statusCode;
  }
}

export interface WorkflowRow {
  workflow_id: string;
  nome: string;
  descricao: string | null;
  nos_json: string;
  arestas_json: string;
  tracos_json: string;
  ativo: number;
  revisao_grafo: number;
  proximo_numero_run: number;
  ultima_execucao_em: string | null;
  atualizado_em: string;
}

export interface TriggerRow {
  workflow_id: string;
  node_id: string;
  tipo: WorkflowTriggerKind;
  timezone: string | null;
  schedule_json: string | null;
  filtro_json: string;
  webhook_route_id: string | null;
  webhook_secret_vault_key: string | null;
  proxima_execucao_em: string | null;
  atualizado_em: string;
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function fmtHourMinute(hour = 9, minute = 0): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function resolveSafeTimeZone(tz?: string | null): string {
  const candidate = tz?.trim() || "America/Sao_Paulo";
  return isValidIanaTimeZone(candidate) ? candidate : "America/Sao_Paulo";
}

export function toRoutineSchedule(
  schedule: WorkflowScheduleConfig,
  anchorRef: Date
): RoutineSchedule | null {
  switch (schedule.kind) {
    case "hourly":
      return {
        kind: "hourly",
        minute: Math.max(0, Math.min(59, Math.floor(schedule.minute ?? 0))),
      };
    case "daily":
      return {
        kind: "daily",
        time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
      };
    case "weekdays":
      return {
        kind: "weekdays",
        time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
      };
    case "weekly": {
      const days =
        Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0
          ? schedule.daysOfWeek
          : [1];
      if (days.length === 1) {
        return {
          kind: "weekly",
          weekday: Math.max(0, Math.min(6, Math.floor(days[0]))),
          time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
        };
      }
      return {
        kind: "advanced",
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        days: { kind: "days-of-week", days },
        time: { kind: "at-time", time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0) },
      };
    }
    case "monthly":
      return {
        kind: "monthly",
        day: Math.max(1, Math.min(31, Math.floor(schedule.dayOfMonth ?? 1))),
        time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
      };
    case "interval": {
      const amount = Math.max(3, Math.floor(schedule.intervalMinutes ?? 15));
      const anchorMs = schedule.runAt ? Date.parse(schedule.runAt) : Number.NaN;
      return {
        kind: "interval",
        amount,
        unit: "minutes",
        anchorAt: Number.isNaN(anchorMs) ? anchorRef.toISOString() : new Date(anchorMs).toISOString(),
      };
    }
    case "advanced": {
      let days: Extract<RoutineSchedule, { kind: "advanced" }>["days"] = { kind: "every-day" };
      if (Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0) {
        days = { kind: "days-of-week", days: [...schedule.daysOfWeek] };
      } else if (typeof schedule.dayOfMonth === "number") {
        days = { kind: "days-of-month", days: [schedule.dayOfMonth] };
      }
      const time: Extract<RoutineSchedule, { kind: "advanced" }>["time"] =
        typeof schedule.intervalMinutes === "number" && schedule.intervalMinutes >= 3
          ? { kind: "every", amount: Math.floor(schedule.intervalMinutes), unit: "minutes" }
          : { kind: "at-time", time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0) };
      return {
        kind: "advanced",
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        days,
        time,
      };
    }
    case "custom":
      return {
        kind: "custom",
        expression: (schedule.cronExpression ?? "0 9 * * *").trim(),
      };
    case "once": {
      if (!schedule.runAt) return null;
      const dt = new Date(schedule.runAt);
      if (Number.isNaN(dt.getTime())) return null;
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      return {
        kind: "once",
        date: `${yyyy}-${mm}-${dd}`,
        time: fmtHourMinute(dt.getUTCHours(), dt.getUTCMinutes()),
      };
    }
    default:
      return null;
  }
}

/**
 * Calcula a próxima execução UTC (ISO 8601) de um nó gatilho `schedule` em timezone IANA.
 */
export function computeNextWorkflowScheduleAt(
  schedule: WorkflowScheduleConfig | null | undefined,
  timezone?: string | null,
  fromDate: Date = new Date()
): string | null {
  if (!schedule || !schedule.kind) return null;

  if (schedule.kind === "once") {
    if (!schedule.runAt) return null;
    const targetMs = Date.parse(schedule.runAt);
    if (Number.isNaN(targetMs) || targetMs <= fromDate.getTime()) {
      return null;
    }
    return new Date(targetMs).toISOString();
  }

  const tz = resolveSafeTimeZone(timezone ?? schedule.timezone);
  const routineSched = toRoutineSchedule(schedule, fromDate);
  if (!routineSched) return null;

  try {
    const next = computeNextRoutineOccurrence(routineSched, tz, fromDate);
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Colapsa múltiplas janelas vencidas no passado em uma única execução imediata (`runDueAt`)
 * e calcula o próximo horário futuro (`nextRunAt > now`) sem gerar rajada.
 */
export function collapseMissedWorkflowDue(params: {
  schedule: WorkflowScheduleConfig;
  timezone?: string | null;
  dueAtIso: string;
  now?: Date;
}): {
  missedCount: number;
  runDueAt: string | null;
  nextRunAt: string | null;
} {
  const now = params.now ?? new Date();
  const dueMs = Date.parse(params.dueAtIso);
  if (Number.isNaN(dueMs)) {
    return {
      missedCount: 0,
      runDueAt: null,
      nextRunAt: computeNextWorkflowScheduleAt(params.schedule, params.timezone, now),
    };
  }

  const dueDate = new Date(dueMs);
  if (params.schedule.kind === "once") {
    return {
      missedCount: 0,
      runDueAt: dueMs <= now.getTime() ? dueDate.toISOString() : null,
      nextRunAt: dueMs > now.getTime() ? dueDate.toISOString() : null,
    };
  }

  const tz = resolveSafeTimeZone(params.timezone ?? params.schedule.timezone);
  const routineSched = toRoutineSchedule(params.schedule, dueDate);
  if (!routineSched) {
    return { missedCount: 0, runDueAt: null, nextRunAt: null };
  }

  const collapsed = collapseMissedOccurrences({
    schedule: routineSched,
    timezone: tz,
    currentDueAt: dueDate,
    now,
    missedPolicy: "run-once",
  });

  return {
    missedCount: collapsed.missedCount,
    runDueAt: collapsed.runDueAt ? collapsed.runDueAt.toISOString() : null,
    nextRunAt: collapsed.nextRunAt ? collapsed.nextRunAt.toISOString() : null,
  };
}

export function extractNodeTriggerMeta(node: WorkflowNo): {
  tipo: WorkflowTriggerKind;
  timezone: string;
  schedule: WorkflowScheduleConfig | null;
  filtro: Record<string, unknown>;
} {
  const cfg = node.config ?? {};
  const triggerKind =
    node.triggerKind ??
    node.trigger?.kind ??
    (typeof cfg.triggerKind === "string" ? (cfg.triggerKind as WorkflowTriggerKind) : undefined) ??
    "manual";

  const schedule =
    node.trigger?.kind === "schedule"
      ? node.trigger.schedule
      : cfg.schedule && typeof cfg.schedule === "object"
        ? (cfg.schedule as WorkflowScheduleConfig)
        : null;

  const timezone = resolveSafeTimeZone(
    schedule?.timezone ??
      (typeof cfg.timezone === "string" ? cfg.timezone : undefined) ??
      "America/Sao_Paulo"
  );

  const filtro: Record<string, unknown> = {};
  if (node.trigger?.kind === "whatsapp") {
    filtro.connectionId = node.trigger.connectionId ?? null;
    filtro.grupoOuNumero = node.trigger.grupoOuNumero ?? null;
    filtro.palavraChave = node.trigger.palavraChave ?? null;
    filtro.tipoMidia = node.trigger.tipoMidia ?? "all";
  } else if (node.trigger?.kind === "telegram") {
    filtro.chatId = node.trigger.chatId ?? null;
    filtro.palavraChave = node.trigger.palavraChave ?? null;
  } else if (node.trigger?.kind === "conector") {
    filtro.conectorId = node.trigger.conectorId ?? null;
    filtro.evento = node.trigger.evento ?? null;
    filtro.filtro = node.trigger.filtro ?? null;
  } else {
    for (const key of [
      "connectionId",
      "grupoOuNumero",
      "palavraChave",
      "tipoMidia",
      "chatId",
      "conectorId",
      "evento",
      "filtro",
    ]) {
      if (cfg[key] !== undefined) {
        filtro[key] = cfg[key];
      }
    }
  }

  return {
    tipo: triggerKind,
    timezone,
    schedule,
    filtro,
  };
}

export interface WorkflowStoreDeps {
  db: CriativoDatabase;
  vault?: VaultService;
}

export function wf_getLatestRunForWorkflow(
  deps: WorkflowStoreDeps,
  workflowId: string
): WorkflowRunRecord | null {
  const row = deps.db.connection
    .prepare(
      `
      SELECT * FROM projecao_workflow_execucoes
      WHERE workflow_id = ?
      ORDER BY numero DESC, iniciado_em DESC
      LIMIT 1;
    `
    )
    .get(workflowId) as WorkflowRunRecord | undefined;
  return row ?? null;
}

export function rowToWorkflowVisual(deps: WorkflowStoreDeps, row: WorkflowRow): WorkflowVisual {
  const rawNos = safeJsonParse<WorkflowNo[]>(row.nos_json, []);
  const rawArestas = safeJsonParse<WorkflowAresta[]>(row.arestas_json, []);
  const rawTracos = safeJsonParse<WorkflowTraco[]>(row.tracos_json, []);
  const normalized = normalizeWorkflowGraph({
    nos: rawNos,
    arestas: rawArestas,
    tracos: rawTracos,
  });
  return {
    workflow_id: row.workflow_id,
    nome: row.nome,
    descricao: row.descricao ?? "",
    nos: normalized.nos,
    arestas: normalized.arestas,
    tracos: normalized.tracos,
    ativo: row.ativo === 1,
    revisao_grafo: Number(row.revisao_grafo ?? 0),
    ultima_execucao_em: row.ultima_execucao_em,
    atualizado_em: row.atualizado_em,
    last_run: wf_getLatestRunForWorkflow(deps, row.workflow_id),
  };
}

export function sanitizeWorkflowTriggerRow(row: TriggerRow): WorkflowTriggerState {
  return {
    workflow_id: row.workflow_id,
    node_id: row.node_id,
    tipo: row.tipo,
    timezone: row.timezone,
    schedule_json: row.schedule_json,
    filtro_json: row.filtro_json,
    webhook_route_id: row.webhook_route_id,
    webhook_url: row.webhook_route_id
      ? `/api/workflows/webhook/${row.webhook_route_id}`
      : null,
    proxima_execucao_em: row.proxima_execucao_em,
    atualizado_em: row.atualizado_em,
  };
}

export function listWorkflowTriggers(
  deps: WorkflowStoreDeps,
  workflowId?: string
): WorkflowTriggerState[] {
  const rows = workflowId
    ? (deps.db.connection
        .prepare(`SELECT * FROM projecao_workflow_gatilhos WHERE workflow_id = ? ORDER BY node_id ASC;`)
        .all(workflowId) as unknown as TriggerRow[])
    : (deps.db.connection
        .prepare(`SELECT * FROM projecao_workflow_gatilhos ORDER BY workflow_id ASC, node_id ASC;`)
        .all() as unknown as TriggerRow[]);
  return rows.map((r) => sanitizeWorkflowTriggerRow(r));
}
