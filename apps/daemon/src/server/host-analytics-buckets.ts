import type {
  GranularidadeAnalyticsUso,
  PontoSerieTemporalUso,
  PontoSerieUsoPorProvedor,
} from "@criativo/contracts";

export interface UsageAnalyticsRowInput {
  provider: string;
  occurred_at: string;
  uncached_input: number;
  cache_creation: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MESES_CURTOS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Resolve a granularidade efetiva da série empilhada com base na janela de dias.
 */
export function resolveAnalyticsGranularity(
  dias: number,
  requested?: string | null,
): GranularidadeAnalyticsUso {
  if (requested === "diario" || requested === "semanal" || requested === "mensal") {
    return requested;
  }
  if (dias <= 35) return "diario";
  if (dias <= 120) return "semanal";
  return "mensal";
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDayMonthPt(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfIsoWeekUtc(date: Date): Date {
  const day = startOfUtcDay(date);
  return addUtcDays(day, -((day.getUTCDay() || 7) - 1));
}

function formatIsoWeekKey(monday: Date): string {
  const thursday = addUtcDays(monday, 3);
  const isoYear = thursday.getUTCFullYear();
  const weekNum = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / MS_PER_DAY + 1) / 7);
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

interface BucketSlot {
  chave: string;
  rotulo: string;
  inicio_iso: string;
  fim_iso: string;
  tokens: number;
  custo_usd: number;
  turnos: number;
  byProvider: Map<string, { tokens: number; custoUsd: number }>;
}

function newSlot(chave: string, rotulo: string, inicioDate: Date, fimDate: Date): BucketSlot {
  return {
    chave,
    rotulo,
    inicio_iso: `${formatIsoDate(inicioDate)}T00:00:00.000Z`,
    fim_iso: `${formatIsoDate(fimDate)}T23:59:59.999Z`,
    tokens: 0,
    custo_usd: 0,
    turnos: 0,
    byProvider: new Map(),
  };
}

function createSlots(windowStart: Date, windowEnd: Date, granularidade: GranularidadeAnalyticsUso): BucketSlot[] {
  const slots: BucketSlot[] = [];
  if (granularidade === "diario") {
    for (let c = new Date(windowStart.getTime()); c.getTime() <= windowEnd.getTime(); c = addUtcDays(c, 1)) {
      slots.push(newSlot(formatIsoDate(c), formatDayMonthPt(c), c, c));
    }
    return slots;
  }
  if (granularidade === "semanal") {
    const first = startOfIsoWeekUtc(windowStart);
    const last = startOfIsoWeekUtc(windowEnd);
    for (let c = new Date(first.getTime()); c.getTime() <= last.getTime(); c = addUtcDays(c, 7)) {
      slots.push(newSlot(formatIsoWeekKey(c), formatDayMonthPt(c), c, addUtcDays(c, 6)));
    }
    return slots;
  }

  let year = windowStart.getUTCFullYear();
  let month = windowStart.getUTCMonth();
  const endYear = windowEnd.getUTCFullYear();
  const endMonth = windowEnd.getUTCMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const mm = String(month + 1).padStart(2, "0");
    slots.push(newSlot(`${year}-${mm}`, `${MESES_CURTOS_PT[month]}/${String(year).slice(-2)}`, firstDay, lastDay));
    month = month === 11 ? 0 : month + 1;
    if (month === 0) year += 1;
  }
  return slots;
}

function resolveRowBucketKey(date: Date, granularidade: GranularidadeAnalyticsUso): string {
  if (granularidade === "diario") return formatIsoDate(date);
  if (granularidade === "semanal") return formatIsoWeekKey(startOfIsoWeekUtc(date));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Gera série temporal contínua de buckets (diário, semanal ou mensal) com detalhamento por provedor.
 */
export function buildStackedUsageSeries(
  rows: UsageAnalyticsRowInput[],
  options: {
    dias: number;
    granularidade: GranularidadeAnalyticsUso;
    now?: Date;
    formatProviderLabel: (provider: string) => string;
  },
): PontoSerieTemporalUso[] {
  const endDay = startOfUtcDay(options.now ?? new Date());
  const safeDays = Math.max(1, Math.min(3650, Math.floor(options.dias)));

  let earliestRowDay: Date | null = null;
  for (const row of rows) {
    const parsed = new Date(row.occurred_at);
    if (Number.isNaN(parsed.getTime())) continue;
    const utcDay = startOfUtcDay(parsed);
    if (!earliestRowDay || utcDay.getTime() < earliestRowDay.getTime()) earliestRowDay = utcDay;
  }

  // Em janelas longas (ex.: 3650d), inicia no primeiro dado real ou fallback de 12 meses para evitar milhares de barras vazias
  const fallbackDays =
    safeDays > 400
      ? options.granularidade === "mensal" ? 365 : options.granularidade === "semanal" ? 180 : 90
      : safeDays;
  const minWindow = addUtcDays(endDay, -(fallbackDays - 1));
  const effectiveStart = earliestRowDay && earliestRowDay.getTime() < minWindow.getTime() ? earliestRowDay : minWindow;

  const slots = createSlots(effectiveStart, endDay, options.granularidade);
  const slotMap = new Map<string, BucketSlot>(slots.map((s) => [s.chave, s]));
  const providerTotals = new Map<string, number>();

  for (const row of rows) {
    const dt = new Date(row.occurred_at);
    if (Number.isNaN(dt.getTime())) continue;
    const slot = slotMap.get(resolveRowBucketKey(dt, options.granularidade));
    if (!slot) continue;

    const pKey = (row.provider || "outro").toLowerCase();
    const tokens = Math.max(0, row.uncached_input + row.cache_creation + row.output_tokens);
    const custo = typeof row.estimated_cost_usd === "number" && Number.isFinite(row.estimated_cost_usd)
      ? row.estimated_cost_usd
      : 0;

    slot.tokens += tokens;
    slot.custo_usd += custo;
    slot.turnos += 1;

    const current = slot.byProvider.get(pKey) ?? { tokens: 0, custoUsd: 0 };
    current.tokens += tokens;
    current.custoUsd += custo;
    slot.byProvider.set(pKey, current);
    providerTotals.set(pKey, (providerTotals.get(pKey) ?? 0) + tokens);
  }

  const orderedProviders = [...providerTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p);
  const providerOrder = new Map<string, number>(orderedProviders.map((p, idx) => [p, idx]));

  return slots.map((slot) => {
    const porProvedor: PontoSerieUsoPorProvedor[] = [...slot.byProvider.entries()]
      .sort(([a], [b]) => (providerOrder.get(a) ?? 999) - (providerOrder.get(b) ?? 999))
      .map(([provedor, val]) => ({
        provedor,
        rotulo: options.formatProviderLabel(provedor),
        tokens: val.tokens,
        custo_usd: Number(val.custoUsd.toFixed(4)),
      }));

    return {
      chave: slot.chave,
      rotulo: slot.rotulo,
      inicio_iso: slot.inicio_iso,
      fim_iso: slot.fim_iso,
      tokens: slot.tokens,
      custo_usd: Number(slot.custo_usd.toFixed(4)),
      turnos: slot.turnos,
      por_provedor: porProvedor,
    };
  });
}
