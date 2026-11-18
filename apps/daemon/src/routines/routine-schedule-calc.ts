import {
  isRoutineSchedule,
  isValidIanaTimeZone,
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type RoutineMissedPolicy,
  type RoutineSchedule,
} from "@criativo/contracts";

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Domingo .. 6 = Sábado
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = FORMATTER_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    FORMATTER_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const lookup = new Map<string, string>();
  for (const part of parts) {
    lookup.set(part.type, part.value);
  }
  return {
    year: Number(lookup.get("year") ?? 1970),
    month: Number(lookup.get("month") ?? 1),
    day: Number(lookup.get("day") ?? 1),
    hour: Number(lookup.get("hour") ?? 0) % 24,
    minute: Number(lookup.get("minute") ?? 0),
    second: Number(lookup.get("second") ?? 0),
    weekday: WEEKDAY_MAP[lookup.get("weekday") ?? "Sun"] ?? 0,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDaysToCivilDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function parseTimeString(time: string): { hour: number; minute: number } {
  const [hStr, mStr] = time.split(":");
  return {
    hour: Number.parseInt(hStr, 10),
    minute: Number.parseInt(mStr, 10),
  };
}

/**
 * Resolve uma data/hora civil em um fuso horário IANA para `Date` UTC em até 2 passes.
 * Trata lacunas de horário de verão (DST gap) retornando `null` ou avançando até 180 minutos.
 */
export function resolveZonedDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  handleDstGap: "null" | "shift-forward" = "null"
): Date | null {
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessMs = targetAsUtcMs;

  for (let pass = 0; pass < 3; pass += 1) {
    const parts = getZonedDateParts(new Date(guessMs), timeZone);
    const localAsUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0
    );
    const diff = targetAsUtcMs - localAsUtcMs;
    if (diff === 0) {
      return new Date(guessMs);
    }
    guessMs += diff;
  }

  const check = getZonedDateParts(new Date(guessMs), timeZone);
  if (
    check.year === year &&
    check.month === month &&
    check.day === day &&
    check.hour === hour &&
    check.minute === minute
  ) {
    return new Date(guessMs);
  }

  if (handleDstGap === "null") {
    return null;
  }

  // Avança minuto a minuto a partir do alvo UTC menos margem de segurança procurando instante após o gap
  const scanStart = targetAsUtcMs - 24 * 60 * 60_000;
  for (let stepMs = 0; stepMs <= 180 * 60_000; stepMs += 60_000) {
    const candidateMs = guessMs + stepMs;
    if (candidateMs < scanStart) continue;
    const p = getZonedDateParts(new Date(candidateMs), timeZone);
    const pScore =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    if (pScore >= targetAsUtcMs) {
      return new Date(candidateMs);
    }
  }
  return null;
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const rawToken of field.split(",")) {
    const token = rawToken.trim();
    if (!token) {
      throw new Error(`Campo cron inválido: "${field}"`);
    }
    const [rangePart, stepPart] = token.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Passo cron inválido: "${token}"`);
    }
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [a, b] = rangePart.split("-");
        start = Number.parseInt(a, 10);
        end = Number.parseInt(b, 10);
      } else {
        start = Number.parseInt(rangePart, 10);
        end = start;
      }
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start < min || end > max || start > end) {
      throw new Error(`Intervalo cron inválido: "${token}"`);
    }
    for (let v = start; v <= end; v += step) {
      result.add(max === 7 && v === 7 ? 0 : v);
    }
  }
  return result;
}

function computeNextCustomCron(
  expression: string,
  timeZone: string,
  afterDate: Date
): Date | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  let minutes: Set<number>;
  let hours: Set<number>;
  let days: Set<number>;
  let months: Set<number>;
  let weekdays: Set<number>;

  try {
    minutes = parseCronField(fields[0], 0, 59);
    hours = parseCronField(fields[1], 0, 23);
    days = parseCronField(fields[2], 1, 31);
    months = parseCronField(fields[3], 1, 12);
    weekdays = parseCronField(fields[4], 0, 7);
  } catch {
    return null;
  }

  const dayWildcard = fields[2].trim() === "*";
  const weekdayWildcard = fields[4].trim() === "*";
  const cursorMs = Math.floor(afterDate.getTime() / 60_000) * 60_000 + 60_000;
  const maxSteps = 366 * 24 * 60;

  for (let i = 0; i < maxSteps; i += 1) {
    const candidate = new Date(cursorMs + i * 60_000);
    const z = getZonedDateParts(candidate, timeZone);
    if (!months.has(z.month)) continue;
    if (!hours.has(z.hour)) continue;
    if (!minutes.has(z.minute)) continue;
    const dayMatches = days.has(z.day);
    const weekdayMatches = weekdays.has(z.weekday);
    const calendarOk =
      dayWildcard || weekdayWildcard
        ? dayMatches && weekdayMatches
        : dayMatches || weekdayMatches;
    if (calendarOk) {
      return candidate;
    }
  }
  return null;
}

/**
 * Simula `sampleCount` execuções consecutivas de uma expressão cron customizada
 * verificando se qualquer par possui distância menor que `minMinutes`.
 */
export function hasRunsTooClose(
  expression: string,
  timezone: string,
  minMinutes = ROUTINE_MINIMUM_INTERVAL_MINUTES,
  sampleCount = 200
): boolean {
  let cursor = new Date();
  let previous: Date | null = null;
  const minDiffMs = minMinutes * 60_000;

  for (let i = 0; i < sampleCount; i += 1) {
    const next = computeNextCustomCron(expression, timezone, cursor);
    if (!next) return false;
    if (previous && next.getTime() - previous.getTime() < minDiffMs) {
      return true;
    }
    previous = next;
    cursor = next;
  }
  return false;
}

/**
 * Valida regras de negócio completas do `RoutineSchedule` no fuso horário IANA especificado.
 * Retorna mensagem descritiva em caso de erro ou `null` quando válido.
 */
export function validateRoutineSchedule(
  schedule: RoutineSchedule,
  timezone: string,
  now = new Date(),
  options: { requireFutureOnce?: boolean } = {}
): string | null {
  if (!isValidIanaTimeZone(timezone)) {
    return `Fuso horário IANA inválido: "${timezone}".`;
  }
  if (!isRoutineSchedule(schedule)) {
    return "Definição de agendamento (schedule) inválida ou abaixo do intervalo mínimo de 3 minutos.";
  }

  if (
    schedule.kind === "interval" &&
    schedule.unit === "minutes" &&
    schedule.amount < ROUTINE_MINIMUM_INTERVAL_MINUTES
  ) {
    return `O intervalo mínimo permitido para rotinas é de ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutos.`;
  }

  if (
    schedule.kind === "advanced" &&
    schedule.time.kind === "every" &&
    schedule.time.unit === "minutes" &&
    schedule.time.amount < ROUTINE_MINIMUM_INTERVAL_MINUTES
  ) {
    return `O intervalo mínimo permitido para rotinas avançadas é de ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutos.`;
  }

  if (schedule.kind === "custom") {
    try {
      const fields = schedule.expression.trim().split(/\s+/);
      parseCronField(fields[0], 0, 59);
      parseCronField(fields[1], 0, 23);
      parseCronField(fields[2], 1, 31);
      parseCronField(fields[3], 1, 12);
      parseCronField(fields[4], 0, 7);
    } catch (err) {
      return err instanceof Error ? err.message : "Expressão cron inválida.";
    }
    if (hasRunsTooClose(schedule.expression, timezone, ROUTINE_MINIMUM_INTERVAL_MINUTES, 200)) {
      return `Expressão cron dispara em intervalos menores que ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutos.`;
    }
  }

  if (schedule.kind === "once") {
    const [yStr, mStr, dStr] = schedule.date.split("-");
    const { hour, minute } = parseTimeString(schedule.time);
    const resolved = resolveZonedDateTime(
      Number(yStr),
      Number(mStr),
      Number(dStr),
      hour,
      minute,
      timezone,
      "shift-forward"
    );
    if (!resolved) {
      return "Não foi possível resolver a data e hora no fuso horário informado.";
    }
    if (options.requireFutureOnce !== false && resolved.getTime() <= now.getTime()) {
      return "Agendamentos do tipo 'once' exigem data e hora futuras.";
    }
  }

  return null;
}

/**
 * Calcula a próxima ocorrência estritamente posterior a `afterDate` (`> afterDate`)
 * para todas as 9 variantes de `RoutineSchedule`.
 */
export function computeNextRoutineOccurrence(
  schedule: RoutineSchedule,
  timezone: string,
  afterDate: Date
): Date | null {
  const afterMs = afterDate.getTime();

  switch (schedule.kind) {
    case "hourly": {
      let z = getZonedDateParts(new Date(afterMs), timezone);
      for (let hourOffset = 0; hourOffset <= 48; hourOffset += 1) {
        const ref = new Date(afterMs + hourOffset * 3_600_000);
        z = getZonedDateParts(ref, timezone);
        const dt = resolveZonedDateTime(
          z.year,
          z.month,
          z.day,
          z.hour,
          schedule.minute,
          timezone,
          "null"
        );
        if (dt && dt.getTime() > afterMs) {
          return dt;
        }
      }
      return null;
    }

    case "daily": {
      const { hour, minute } = parseTimeString(schedule.time);
      const startParts = getZonedDateParts(afterDate, timezone);
      for (let d = 0; d <= 10; d += 1) {
        const civil = addDaysToCivilDate(startParts.year, startParts.month, startParts.day, d);
        const dt = resolveZonedDateTime(
          civil.year,
          civil.month,
          civil.day,
          hour,
          minute,
          timezone,
          "null"
        );
        if (dt && dt.getTime() > afterMs) return dt;
      }
      return null;
    }

    case "weekdays": {
      const { hour, minute } = parseTimeString(schedule.time);
      const startParts = getZonedDateParts(afterDate, timezone);
      for (let d = 0; d <= 14; d += 1) {
        const civil = addDaysToCivilDate(startParts.year, startParts.month, startParts.day, d);
        const dt = resolveZonedDateTime(
          civil.year,
          civil.month,
          civil.day,
          hour,
          minute,
          timezone,
          "null"
        );
        if (!dt || dt.getTime() <= afterMs) continue;
        const wd = getZonedDateParts(dt, timezone).weekday;
        if (wd >= 1 && wd <= 5) return dt;
      }
      return null;
    }

    case "weekly": {
      const { hour, minute } = parseTimeString(schedule.time);
      const startParts = getZonedDateParts(afterDate, timezone);
      for (let d = 0; d <= 14; d += 1) {
        const civil = addDaysToCivilDate(startParts.year, startParts.month, startParts.day, d);
        const dt = resolveZonedDateTime(
          civil.year,
          civil.month,
          civil.day,
          hour,
          minute,
          timezone,
          "null"
        );
        if (!dt || dt.getTime() <= afterMs) continue;
        const wd = getZonedDateParts(dt, timezone).weekday;
        if (wd === schedule.weekday) return dt;
      }
      return null;
    }

    case "monthly": {
      const { hour, minute } = parseTimeString(schedule.time);
      const startParts = getZonedDateParts(afterDate, timezone);
      for (let mOffset = 0; mOffset <= 24; mOffset += 1) {
        const monthIndex = startParts.month - 1 + mOffset;
        const year = startParts.year + Math.floor(monthIndex / 12);
        const month = (monthIndex % 12) + 1;
        const maxDay = daysInMonth(year, month);
        const targetDay = Math.min(schedule.day, maxDay);
        const dt = resolveZonedDateTime(year, month, targetDay, hour, minute, timezone, "null");
        if (dt && dt.getTime() > afterMs) return dt;
      }
      return null;
    }

    case "interval": {
      const unitMs =
        schedule.unit === "minutes"
          ? 60_000
          : schedule.unit === "hours"
            ? 3_600_000
            : 86_400_000;
      const stepMs = schedule.amount * unitMs;
      const anchorMs = Date.parse(schedule.anchorAt);
      if (Number.isNaN(anchorMs) || stepMs <= 0) return null;
      if (anchorMs > afterMs) return new Date(anchorMs);
      const stepsPassed = Math.floor((afterMs - anchorMs) / stepMs) + 1;
      return new Date(anchorMs + stepsPassed * stepMs);
    }

    case "advanced": {
      const allowedMonths = new Set(schedule.months);
      const startParts = getZonedDateParts(afterDate, timezone);
      for (let d = 0; d <= 366; d += 1) {
        const civil = addDaysToCivilDate(startParts.year, startParts.month, startParts.day, d);
        if (!allowedMonths.has(civil.month)) continue;

        const midday = resolveZonedDateTime(civil.year, civil.month, civil.day, 12, 0, timezone, "shift-forward");
        if (!midday) continue;
        const civilWd = getZonedDateParts(midday, timezone).weekday;

        if (schedule.days.kind === "days-of-week" && !schedule.days.days.includes(civilWd)) {
          continue;
        }
        if (schedule.days.kind === "days-of-month" && !schedule.days.days.includes(civil.day)) {
          continue;
        }

        if (schedule.time.kind === "at-time") {
          const { hour, minute } = parseTimeString(schedule.time.time);
          const dt = resolveZonedDateTime(
            civil.year,
            civil.month,
            civil.day,
            hour,
            minute,
            timezone,
            "null"
          );
          if (dt && dt.getTime() > afterMs) return dt;
        } else {
          const stepMin =
            schedule.time.unit === "hours" ? schedule.time.amount * 60 : schedule.time.amount;
          for (let totalMin = 0; totalMin < 24 * 60; totalMin += stepMin) {
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            const dt = resolveZonedDateTime(
              civil.year,
              civil.month,
              civil.day,
              h,
              m,
              timezone,
              "null"
            );
            if (dt && dt.getTime() > afterMs) return dt;
          }
        }
      }
      return null;
    }

    case "custom":
      return computeNextCustomCron(schedule.expression, timezone, afterDate);

    case "once": {
      const [yStr, mStr, dStr] = schedule.date.split("-");
      const { hour, minute } = parseTimeString(schedule.time);
      const dt = resolveZonedDateTime(
        Number(yStr),
        Number(mStr),
        Number(dStr),
        hour,
        minute,
        timezone,
        "shift-forward"
      );
      if (!dt || dt.getTime() <= afterMs) {
        return null;
      }
      return dt;
    }
  }
}

/**
 * Trata ocorrências perdidas enquanto o Daemon esteve inativo com limite seguro de 999 passos.
 */
export function collapseMissedOccurrences(params: {
  schedule: RoutineSchedule;
  timezone: string;
  currentDueAt: Date;
  now: Date;
  missedPolicy: RoutineMissedPolicy;
}): {
  missedCount: number;
  missedUntil: string | null;
  runDueAt: Date | null;
  nextRunAt: Date | null;
} {
  const { schedule, timezone, currentDueAt, now, missedPolicy } = params;
  const nowMs = now.getTime();

  if (currentDueAt.getTime() > nowMs) {
    return {
      missedCount: 0,
      missedUntil: null,
      runDueAt: null,
      nextRunAt: currentDueAt,
    };
  }

  if (schedule.kind === "once") {
    if (missedPolicy === "run-once") {
      return {
        missedCount: 0,
        missedUntil: null,
        runDueAt: currentDueAt,
        nextRunAt: null,
      };
    }
    return {
      missedCount: 1,
      missedUntil: currentDueAt.toISOString(),
      runDueAt: null,
      nextRunAt: null,
    };
  }

  const overdueDates: Date[] = [currentDueAt];
  let cursor = currentDueAt;
  const maxSteps = 999;

  for (let i = 1; i < maxSteps; i += 1) {
    const next = computeNextRoutineOccurrence(schedule, timezone, cursor);
    if (!next || next.getTime() > nowMs) break;
    overdueDates.push(next);
    cursor = next;
  }

  const lastOverdue = overdueDates[overdueDates.length - 1];
  const nextFuture = computeNextRoutineOccurrence(schedule, timezone, now);

  if (missedPolicy === "run-once") {
    return {
      missedCount: Math.max(0, overdueDates.length - 1),
      missedUntil:
        overdueDates.length > 1
          ? overdueDates[overdueDates.length - 2].toISOString()
          : null,
      runDueAt: lastOverdue,
      nextRunAt: nextFuture,
    };
  }

  return {
    missedCount: overdueDates.length,
    missedUntil: lastOverdue.toISOString(),
    runDueAt: null,
    nextRunAt: nextFuture,
  };
}

/**
 * Expande ocorrências futuras no intervalo `[fromDate, toDate]` para exibição na Agenda e Canvas.
 */
export function expandScheduleOccurrences(
  schedule: RoutineSchedule,
  timezone: string,
  fromDate: Date,
  toDate: Date,
  maxItems = 250
): Date[] {
  const results: Date[] = [];
  const toMs = toDate.getTime();
  let cursor = new Date(fromDate.getTime() - 1);

  for (let i = 0; i < maxItems; i += 1) {
    const next = computeNextRoutineOccurrence(schedule, timezone, cursor);
    if (!next || next.getTime() > toMs) break;
    results.push(next);
    cursor = next;
    if (schedule.kind === "once") break;
  }

  return results;
}
