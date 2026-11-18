import {
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type EventFilter,
  type RoutineSchedule,
} from "@criativo/contracts";

const BASE_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Cuiaba",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Lisbon",
  "Europe/London",
  "UTC",
];

function detectLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

export const COMMON_IANA_TIMEZONES: string[] = Array.from(
  new Set([detectLocalTimezone(), ...BASE_TIMEZONES])
);

const WEEKDAY_NAMES_SHORT: Record<number, string> = {
  0: "Dom",
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
};

const MONTH_NAMES_PT = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
];

export function formatScheduleSummaryPt(
  schedule: RoutineSchedule | null,
  timezone: string,
  triggerKind: "schedule" | "webhook" = "schedule"
): string {
  if (triggerKind === "webhook") {
    return "Webhook autenticado";
  }
  if (!schedule) {
    return `Sem agenda configurada · ${timezone}`;
  }

  switch (schedule.kind) {
    case "hourly":
      return `A cada hora no minuto :${String(schedule.minute).padStart(2, "0")} · ${timezone}`;
    case "daily":
      return `Diária às ${schedule.time} · ${timezone}`;
    case "weekdays":
      return `Seg–Sex às ${schedule.time} · ${timezone}`;
    case "weekly":
      return `Toda ${WEEKDAY_NAMES_SHORT[schedule.weekday] ?? "semana"} às ${schedule.time} · ${timezone}`;
    case "monthly":
      return `Todo dia ${schedule.day} às ${schedule.time} · ${timezone}`;
    case "interval": {
      const unitLabel =
        schedule.unit === "minutes"
          ? schedule.amount === 1
            ? "minuto"
            : "minutos"
          : schedule.unit === "hours"
            ? schedule.amount === 1
              ? "hora"
              : "horas"
            : schedule.amount === 1
              ? "dia"
              : "dias";
      return `A cada ${schedule.amount} ${unitLabel} · ${timezone}`;
    }
    case "advanced": {
      const daysText =
        schedule.days.kind === "every-day"
          ? "Todos os dias"
          : schedule.days.kind === "days-of-week"
            ? schedule.days.days.map((d) => WEEKDAY_NAMES_SHORT[d] ?? String(d)).join(", ")
            : `Dias ${schedule.days.days.join(", ")}`;
      const timeText =
        schedule.time.kind === "at-time"
          ? `às ${schedule.time.time}`
          : `a cada ${schedule.time.amount} ${schedule.time.unit === "minutes" ? "min" : "h"}`;
      return `${daysText} ${timeText} · ${timezone}`;
    }
    case "custom":
      return `Cron (${schedule.expression}) · ${timezone}`;
    case "once": {
      const parts = schedule.date.split("-");
      const dateBr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : schedule.date;
      return `Única vez em ${dateBr} às ${schedule.time} · ${timezone}`;
    }
    default:
      return timezone;
  }
}

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function mondayOfWeek(date: Date): Date {
  const base = startOfDayLocal(date);
  const weekday = base.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(base, offset);
}

export function buildCalendarPeriodRange(
  anchorDate: Date,
  view: "day" | "week" | "month"
): { from: Date; to: Date; label: string; days: Date[] } {
  if (view === "day") {
    const dayStart = startOfDayLocal(anchorDate);
    const dayEnd = endOfDayLocal(anchorDate);
    const label = `${dayStart.getDate()} de ${MONTH_NAMES_PT[dayStart.getMonth()]} de ${dayStart.getFullYear()}`;
    return { from: dayStart, to: dayEnd, label, days: [dayStart] };
  }

  if (view === "week") {
    const start = mondayOfWeek(anchorDate);
    const days: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      days.push(addDays(start, i));
    }
    const end = endOfDayLocal(days[6]);
    const first = days[0];
    const last = days[6];
    const label = `${first.getDate()} ${MONTH_NAMES_PT[first.getMonth()]} – ${last.getDate()} ${MONTH_NAMES_PT[last.getMonth()]} ${last.getFullYear()}`;
    return { from: start, to: end, label, days };
  }

  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const lastOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
  const gridStart = mondayOfWeek(firstOfMonth);
  const gridEndDay = mondayOfWeek(lastOfMonth);
  const gridEnd = addDays(gridEndDay, 6);

  const days: Date[] = [];
  for (
    let cursor = new Date(gridStart.getTime());
    cursor.getTime() <= gridEnd.getTime();
    cursor = addDays(cursor, 1)
  ) {
    days.push(new Date(cursor.getTime()));
  }

  const monthNamesFull = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const label = `${monthNamesFull[firstOfMonth.getMonth()]} de ${firstOfMonth.getFullYear()}`;
  return {
    from: gridStart,
    to: endOfDayLocal(gridEnd),
    label,
    days,
  };
}

export function formatRelativeExecutionLabel(iso: string, now = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;

  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  const timeStr = `${hh}:${mm}`;

  const todayKey = startOfDayLocal(now).getTime();
  const targetKey = startOfDayLocal(parsed).getTime();
  const diffDays = Math.round((targetKey - todayKey) / 86_400_000);

  if (diffDays === 0) return `Hoje às ${timeStr}`;
  if (diffDays === 1) return `Amanhã às ${timeStr}`;
  if (diffDays === -1) return `Ontem às ${timeStr}`;

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} às ${timeStr}`;
}

export interface RoutineFormDraftValidationInput {
  nome: string;
  instrucao: string;
  triggerKind: "schedule" | "webhook";
  schedule: RoutineSchedule | null;
  timezone: string;
  filters?: EventFilter[];
}

export function validateRoutineFormDraft(draft: RoutineFormDraftValidationInput): string | null {
  if (!draft.nome.trim()) {
    return "Informe o nome da rotina.";
  }
  if (!draft.instrucao.trim()) {
    return "Informe a instrução da rotina.";
  }

  if (draft.triggerKind === "webhook") {
    for (const f of draft.filters ?? []) {
      if (!f.pointer.startsWith("/")) {
        return "Cada filtro JSON Pointer deve começar com '/'.";
      }
    }
    return null;
  }

  const sched = draft.schedule;
  if (!sched) {
    return "Selecione a frequência da agenda.";
  }

  if (sched.kind === "interval") {
    const minutes =
      sched.unit === "minutes"
        ? sched.amount
        : sched.unit === "hours"
          ? sched.amount * 60
          : sched.amount * 1440;
    if (!Number.isFinite(minutes) || minutes < ROUTINE_MINIMUM_INTERVAL_MINUTES) {
      return `O intervalo mínimo permitido é de ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutos.`;
    }
  }

  if (sched.kind === "advanced") {
    if (sched.days.kind !== "every-day" && sched.days.days.length === 0) {
      return "Selecione ao menos um dia na agenda avançada.";
    }
    if (sched.time.kind === "every") {
      const minutes = sched.time.unit === "minutes" ? sched.time.amount : sched.time.amount * 60;
      if (!Number.isFinite(minutes) || minutes < ROUTINE_MINIMUM_INTERVAL_MINUTES) {
        return `O intervalo mínimo permitido é de ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutos.`;
      }
    }
  }

  if (sched.kind === "custom") {
    const fields = sched.expression.trim().split(/\s+/);
    if (fields.length !== 5) {
      return "Expressão cron personalizada deve conter 5 campos.";
    }
    if (fields[0] === "*" || /^\*\/([12])$/.test(fields[0])) {
      return `Expressão cron viola o piso mínimo de ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutos.`;
    }
  }

  if (sched.kind === "once") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sched.date) || !/^\d{2}:\d{2}$/.test(sched.time)) {
      return "Data e horário inválidos para rotina única.";
    }
    const candidateLocal = new Date(`${sched.date}T${sched.time}:00`);
    if (!Number.isNaN(candidateLocal.getTime()) && candidateLocal.getTime() <= Date.now() - 60_000) {
      return "Para rotina única, escolha data e hora no futuro.";
    }
  }

  return null;
}

export function buildSignedCurlExample(url: string): string {
  const safeUrl = url || "http://127.0.0.1:3000/api/webhooks/rotina/SEU_TOKEN";
  return [
    `SECRET="SEU_SEGREDO_HMAC"`,
    `TS="$(date +%s)"`,
    `DELIVERY_ID="evt-$(date +%s)"`,
    `BODY='{"type":"pedido.aprovado","data":{"pedido":{"status":"pago"}}}'`,
    `SIG="$(printf '%s.%s.%s' "$TS" "$DELIVERY_ID" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"`,
    `curl -X POST "${safeUrl}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "X-Criativo-Timestamp: $TS" \\`,
    `  -H "X-Criativo-Delivery-Id: $DELIVERY_ID" \\`,
    `  -H "X-Criativo-Signature: sha256=$SIG" \\`,
    `  -d "$BODY"`,
  ].join("\n");
}
