/**
 * Contratos compartilhados, validadores e type guards puros para:
 * - Rotinas completas por Agente e Canal (9 variantes de schedule + once)
 * - Execuções, modo silencioso (`routine_no_update`), histórico e agenda
 * - Destinos de entrega configuráveis (Canal, WhatsApp, Telegram, Notificação)
 * - Webhooks dedicados por rotina com filtros JSON Pointer
 * - Fluxos de Rotinas em grafo DAG (`RoutineFlowCanvas`)
 */

export const ROUTINE_MINIMUM_INTERVAL_MINUTES = 3;

export type RoutineIntervalUnit = "minutes" | "hours" | "days";

export type RoutineDaySelection =
  | { kind: "every-day" }
  | { kind: "days-of-week"; days: number[] }
  | { kind: "days-of-month"; days: number[] };

export type RoutineTimeSelection =
  | { kind: "at-time"; time: string }
  | { kind: "every"; amount: number; unit: Exclude<RoutineIntervalUnit, "days"> };

export type RoutineSchedule =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "interval"; amount: number; unit: RoutineIntervalUnit; anchorAt: string }
  | { kind: "advanced"; months: number[]; days: RoutineDaySelection; time: RoutineTimeSelection }
  | { kind: "custom"; expression: string }
  | { kind: "once"; date: string; time: string };

export type RoutineLimitPolicy = "wait" | "skip";
export type RoutineMissedPolicy = "skip" | "run-once";
export type RoutineRunPlace = "chat" | "side_thread";
export type RoutineOwnerKind = "agente" | "canal";

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "needs-attention"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled";

export type RoutineResultDestination =
  | { tipo: "none" }
  | { tipo: "canal"; canal_id: string; destino_nome: string }
  | { tipo: "whatsapp"; destino_id: string; destino_nome: string }
  | { tipo: "telegram"; chat_id: string; destino_nome: string }
  | { tipo: "notificacao"; destino_nome: string };

export type RoutineResultDeliveryStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "uncertain"
  | "quiet";

export interface RoutineResultDelivery {
  execucao_id: string;
  rotina_id: string;
  owner_id: string;
  destino_tipo: Exclude<RoutineResultDestination["tipo"], "none">;
  destino_id: string;
  destino_nome: string;
  conteudo_texto: string | null;
  status: RoutineResultDeliveryStatus;
  motivo_falha: string | null;
  tentativas: number;
  proximo_envio_em: string | null;
  expira_em: string | null;
  enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RoutineDestinationOption {
  tipo: Exclude<RoutineResultDestination["tipo"], "none">;
  id: string;
  nome: string;
  disponivel: boolean;
  detalhe?: string;
}

export interface EventFilter {
  pointer: string;
  value: string | number | boolean | null;
}

export interface RoutineWebhookConfig {
  webhook_id: string;
  route_token: string;
  url: string;
  event_type: string | null;
  filters: EventFilter[];
  ultimo_disparo_em: string | null;
}

export interface WebhookReceipt {
  recibo_id: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  delivery_id: string;
  event_type: string;
  status: "started" | "ignored";
  reason: "event-type" | "filter" | "inactive" | null;
  execucao_id: string | null;
  recebido_em: string;
}

export interface WebhookTestResult {
  ok: boolean;
  http_status: number;
  status: "accepted" | "duplicate" | "ignored" | "rejected";
  reason?: string | null;
  execucao_id?: string | null;
  recibo_id?: string | null;
}

export interface EventEnvelope {
  version: 1;
  id: string;
  routineId: string;
  type: string;
  occurredAt: string | null;
  receivedAt: string;
  data: unknown;
}

export interface AgentRoutine {
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  nome: string;
  instrucao: string;
  ativa: boolean;
  timezone: string;
  trigger_kind: "schedule" | "webhook";
  schedule: RoutineSchedule | null;
  next_run_at: string | null;
  webhook: RoutineWebhookConfig | null;
  limit_policy: RoutineLimitPolicy;
  missed_policy: RoutineMissedPolicy;
  run_in: RoutineRunPlace;
  destino_resultado: RoutineResultDestination | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RoutineRun {
  execucao_id: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  run_kind: "scheduled" | "manual";
  run_source: "test" | "script" | "webhook" | null;
  scheduled_for: string;
  rotina_nome: string;
  instrucao: string;
  tarefa_id: string | null;
  thread_id: string | null;
  status: RoutineRunStatus;
  silenciada: boolean;
  erro: string | null;
  missed_count: number | null;
  missed_until: string | null;
  resultado_resumo: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RoutineCalendar {
  rotinas: Array<{
    rotina_id: string;
    nome: string;
    owner_kind: RoutineOwnerKind;
    owner_id: string;
    ativa: boolean;
    timezone: string;
    trigger_kind: "schedule" | "webhook";
    schedule: RoutineSchedule | null;
  }>;
  execucoes: Array<{
    id: string;
    rotina_id: string;
    at: string;
    status: RoutineRunStatus | "scheduled";
    silenciada?: boolean;
  }>;
}

export interface SaveAgentRoutineInput {
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  nome: string;
  instrucao: string;
  ativa?: boolean;
  timezone?: string;
  trigger_kind: "schedule" | "webhook";
  schedule?: RoutineSchedule | null;
  limit_policy?: RoutineLimitPolicy;
  missed_policy?: RoutineMissedPolicy;
  run_in?: RoutineRunPlace;
  destino_resultado?: RoutineResultDestination | null;
  webhook_event_type?: string | null;
  webhook_filters?: EventFilter[];
}

export interface UpdateAgentRoutineInput {
  nome?: string;
  instrucao?: string;
  ativa?: boolean;
  timezone?: string;
  trigger_kind?: "schedule" | "webhook";
  schedule?: RoutineSchedule | null;
  limit_policy?: RoutineLimitPolicy;
  missed_policy?: RoutineMissedPolicy;
  run_in?: RoutineRunPlace;
  destino_resultado?: RoutineResultDestination | null;
  webhook_event_type?: string | null;
  webhook_filters?: EventFilter[];
}

export interface RoutineFlowLink {
  link_id: string;
  rotina_id: string;
  from_agent_id: string;
  to_agent_id: string;
  instrucao: string;
  criado_em: string;
}

export interface RoutineFlowStep {
  step_id: string;
  flow_run_id: string;
  execucao_id: string;
  agente_id: string;
  tarefa_id: string | null;
  input: string;
  output: string | null;
  status: "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RoutineFlowRun {
  flow_run_id: string;
  execucao_id: string;
  rotina_id: string;
  root_agent_id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  steps: RoutineFlowStep[];
  criado_em: string;
  atualizado_em: string;
}

export interface RoutineFlowPosition {
  canvas_agent_id: string;
  node_key: string;
  x: number;
  y: number;
  atualizado_em: string;
}

export interface RoutineFlowCanvas {
  agente_id: string;
  rotinas: Array<{
    rotina: AgentRoutine;
    recent_runs: RoutineRun[];
    upcoming_runs: string[];
    active_flow_run: RoutineFlowRun | null;
  }>;
  links: RoutineFlowLink[];
  positions: Array<{ node_key: string; x: number; y: number }>;
  placed_agent_ids: string[];
}

export type RoutineFlowConnectProblem =
  | "same-agent"
  | "into-owner"
  | "not-on-path"
  | "duplicate"
  | "cycle";

// ====================================================================
// Type Guards Puros (sem dependência de Zod/Effect)
// ====================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isRoutineTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function isRoutineDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isRoutineSchedule(value: unknown): value is RoutineSchedule {
  if (!isRecord(value) || typeof value.kind !== "string") return false;

  switch (value.kind) {
    case "hourly":
      return (
        typeof value.minute === "number" &&
        Number.isInteger(value.minute) &&
        value.minute >= 0 &&
        value.minute <= 59
      );
    case "daily":
    case "weekdays":
      return isRoutineTime(value.time);
    case "weekly":
      return (
        typeof value.weekday === "number" &&
        Number.isInteger(value.weekday) &&
        value.weekday >= 0 &&
        value.weekday <= 6 &&
        isRoutineTime(value.time)
      );
    case "monthly":
      return (
        typeof value.day === "number" &&
        Number.isInteger(value.day) &&
        value.day >= 1 &&
        value.day <= 31 &&
        isRoutineTime(value.time)
      );
    case "interval":
      return (
        typeof value.amount === "number" &&
        Number.isInteger(value.amount) &&
        value.amount >= 1 &&
        (value.unit === "minutes" || value.unit === "hours" || value.unit === "days") &&
        typeof value.anchorAt === "string" &&
        !Number.isNaN(Date.parse(value.anchorAt)) &&
        (value.unit !== "minutes" || value.amount >= ROUTINE_MINIMUM_INTERVAL_MINUTES)
      );
    case "advanced": {
      if (!Array.isArray(value.months) || value.months.length === 0) return false;
      const validMonths = value.months.every(
        (m) => typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 12
      );
      if (!validMonths) return false;

      if (!isRecord(value.days) || typeof value.days.kind !== "string") return false;
      if (value.days.kind === "every-day") {
        // válido
      } else if (value.days.kind === "days-of-week") {
        if (
          !Array.isArray(value.days.days) ||
          value.days.days.length === 0 ||
          !value.days.days.every(
            (d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
          )
        ) {
          return false;
        }
      } else if (value.days.kind === "days-of-month") {
        if (
          !Array.isArray(value.days.days) ||
          value.days.days.length === 0 ||
          !value.days.days.every(
            (d) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 31
          )
        ) {
          return false;
        }
      } else {
        return false;
      }

      if (!isRecord(value.time) || typeof value.time.kind !== "string") return false;
      if (value.time.kind === "at-time") {
        return isRoutineTime(value.time.time);
      }
      if (value.time.kind === "every") {
        return (
          typeof value.time.amount === "number" &&
          Number.isInteger(value.time.amount) &&
          value.time.amount >= 1 &&
          (value.time.unit === "minutes" || value.time.unit === "hours") &&
          (value.time.unit !== "minutes" || value.time.amount >= ROUTINE_MINIMUM_INTERVAL_MINUTES)
        );
      }
      return false;
    }
    case "custom":
      return (
        typeof value.expression === "string" &&
        value.expression.trim().split(/\s+/).length === 5
      );
    case "once":
      return isRoutineDate(value.date) && isRoutineTime(value.time);
    default:
      return false;
  }
}

export function isEventFilter(value: unknown): value is EventFilter {
  if (!isRecord(value) || typeof value.pointer !== "string") return false;
  const pointer = value.pointer;
  if (pointer !== "" && !pointer.startsWith("/")) return false;
  // RFC 6901 escape validation: ~ só seguido por 0 ou 1
  if (/~(?![01])/.test(pointer)) return false;
  const v = value.value;
  return (
    v === null ||
    typeof v === "string" ||
    (typeof v === "number" && Number.isFinite(v)) ||
    typeof v === "boolean"
  );
}

export function isRoutineResultDestination(
  value: unknown
): value is RoutineResultDestination {
  if (!isRecord(value) || typeof value.tipo !== "string") return false;
  switch (value.tipo) {
    case "none":
      return true;
    case "canal":
      return (
        typeof value.canal_id === "string" &&
        value.canal_id.trim().length > 0 &&
        typeof value.destino_nome === "string"
      );
    case "whatsapp":
      return (
        typeof value.destino_id === "string" &&
        value.destino_id.trim().length > 0 &&
        typeof value.destino_nome === "string"
      );
    case "telegram":
      return (
        typeof value.chat_id === "string" &&
        value.chat_id.trim().length > 0 &&
        typeof value.destino_nome === "string"
      );
    case "notificacao":
      return typeof value.destino_nome === "string";
    default:
      return false;
  }
}
