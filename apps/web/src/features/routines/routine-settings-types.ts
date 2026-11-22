import type {
  AgentRoutine,
  CanalEquipe,
  EventFilter,
  RoutineDestinationOption,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineOwnerKind,
  RoutineResultDestination,
  RoutineRunPlace,
  RoutineSchedule,
} from "@criativo/contracts";
import { COMMON_IANA_TIMEZONES } from "./routine-schedule-format";

export interface AgentRoutinesSettingsProps {
  ownerKind: RoutineOwnerKind;
  ownerId: string;
  ownerName: string;
  canais?: CanalEquipe[];
  initialRoutines?: AgentRoutine[];
  initialSelectedRoutineId?: string | null;
  onBackToHub?: () => void;
  onOpenThreadOrChat?: (canalId: string) => void;
  onRoutinesChanged?: () => void;
}

export type ScheduleKind = RoutineSchedule["kind"];

export const SCHEDULE_KIND_OPTIONS: Array<{ value: ScheduleKind; label: string; description: string }> = [
  { value: "hourly", label: "A cada hora", description: "Repete todo dia no minuto escolhido" },
  { value: "daily", label: "Diária", description: "Todos os dias no mesmo horário" },
  { value: "weekdays", label: "Dias úteis", description: "Segunda a sexta no horário definido" },
  { value: "weekly", label: "Semanal", description: "Um dia da semana fixo" },
  { value: "monthly", label: "Mensal", description: "Um dia do mês específico" },
  { value: "interval", label: "Intervalo", description: "A cada N minutos, horas ou dias" },
  { value: "advanced", label: "Avançado", description: "Dias múltiplos combinados com horário ou ciclo" },
  { value: "custom", label: "Cron personalizado", description: "Expressão cron de 5 campos" },
  { value: "once", label: "Única vez (once)", description: "Dispara uma única vez e pausa" },
];

export const WEEKDAY_CHIPS = [
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
];

export interface RoutineDraft {
  rotina_id: string | null;
  nome: string;
  instrucao: string;
  ativa: boolean;
  timezone: string;
  triggerKind: "schedule" | "webhook";
  schedule: RoutineSchedule;
  limitPolicy: RoutineLimitPolicy;
  missedPolicy: RoutineMissedPolicy;
  runIn: RoutineRunPlace;
  destinoResultado: RoutineResultDestination;
  webhookEventType: string;
  webhookFilters: EventFilter[];
}

export function defaultTomorrowDate(): string {
  const tomorrow = new Date(Date.now() + 24 * 3_600_000);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildDefaultScheduleForKind(kind: ScheduleKind): RoutineSchedule {
  switch (kind) {
    case "hourly":
      return { kind: "hourly", minute: 0 };
    case "daily":
      return { kind: "daily", time: "09:00" };
    case "weekdays":
      return { kind: "weekdays", time: "09:00" };
    case "weekly":
      return { kind: "weekly", weekday: 1, time: "09:00" };
    case "monthly":
      return { kind: "monthly", day: 1, time: "09:00" };
    case "interval":
      return { kind: "interval", amount: 30, unit: "minutes", anchorAt: new Date().toISOString() };
    case "advanced":
      return {
        kind: "advanced",
        months: [],
        days: { kind: "days-of-week", days: [1, 3, 5] },
        time: { kind: "at-time", time: "09:00" },
      };
    case "custom":
      return { kind: "custom", expression: "*/15 * * * *" };
    case "once":
      return { kind: "once", date: defaultTomorrowDate(), time: "09:00" };
  }
}

export function createEmptyDraft(): RoutineDraft {
  return {
    rotina_id: null,
    nome: "",
    instrucao: "",
    ativa: true,
    timezone: COMMON_IANA_TIMEZONES[0] ?? "America/Sao_Paulo",
    triggerKind: "schedule",
    schedule: { kind: "weekdays", time: "09:00" },
    limitPolicy: "wait",
    missedPolicy: "skip",
    runIn: "chat",
    destinoResultado: { tipo: "none" },
    webhookEventType: "",
    webhookFilters: [],
  };
}

export function draftFromRoutine(r: AgentRoutine): RoutineDraft {
  return {
    rotina_id: r.rotina_id,
    nome: r.nome,
    instrucao: r.instrucao,
    ativa: r.ativa,
    timezone: r.timezone,
    triggerKind: r.trigger_kind,
    schedule: r.schedule ?? { kind: "weekdays", time: "09:00" },
    limitPolicy: r.limit_policy,
    missedPolicy: r.missed_policy,
    runIn: r.run_in,
    destinoResultado: r.destino_resultado ?? { tipo: "none" },
    webhookEventType: r.webhook?.event_type ?? "",
    webhookFilters: r.webhook?.filters ?? [],
  };
}

export function destinationKey(dest: RoutineResultDestination | null | undefined): string {
  if (!dest || dest.tipo === "none") return "none";
  if (dest.tipo === "notificacao") return "notificacao";
  if (dest.tipo === "canal") return `canal:${dest.canal_id}`;
  if (dest.tipo === "telegram") return `telegram:${dest.chat_id}`;
  return `whatsapp:${dest.destino_id}`;
}

export function destinationDisplayLabel(
  dest: RoutineResultDestination,
  options: RoutineDestinationOption[]
): string {
  if (dest.tipo === "none") return "Apenas no histórico/chat";
  if (dest.tipo === "notificacao") return dest.destino_nome || "Notificação no Cockpit";
  if (dest.tipo === "canal") {
    const opt = options.find((o) => o.tipo === "canal" && o.id === dest.canal_id);
    return opt?.nome ?? dest.destino_nome ?? dest.canal_id;
  }
  if (dest.tipo === "telegram") {
    const opt = options.find((o) => o.tipo === "telegram" && o.id === dest.chat_id);
    return opt?.nome ?? dest.destino_nome ?? dest.chat_id;
  }
  const opt = options.find((o) => o.tipo === "whatsapp" && o.id === dest.destino_id);
  return opt?.nome ?? dest.destino_nome ?? dest.destino_id;
}

export function isPastOnceRoutine(r: AgentRoutine): boolean {
  if (r.trigger_kind !== "schedule" || r.schedule?.kind !== "once") return false;
  if (r.ativa) return false;
  const candidate = new Date(`${r.schedule.date}T${r.schedule.time}:00`);
  return !Number.isNaN(candidate.getTime()) && candidate.getTime() <= Date.now();
}
