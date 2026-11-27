import type {
  EditorialPostFormato,
  MetaChampionFormatItem,
  MetaNextSuggestedSlot,
  MetaPostingConfidence,
  MetaPostingHourBucket,
  MetaPostingIntelligencePeriod,
  MetaPostingIntelligenceReport,
  MetaPostingRecommendationItem,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

type NormalizedFormat = "carrossel" | "reels" | "imagem" | "story";

interface CachedMetricPayload {
  media_type?: string;
  media_product_type?: string;
  timestamp?: string | null;
  likes?: number | null;
  comments?: number | null;
  reach?: number | null;
  views?: number | null;
  saved?: number | null;
  shares?: number | null;
  reposts?: number | null;
  total_interactions?: number | null;
  taxa_salvamento_pct?: number | null;
  skip_rate_3s_pct?: number | null;
}

interface ParsedPostSample {
  formato: NormalizedFormat;
  diaSemana: number;
  hora: number;
  reach: number;
  views: number;
  saved: number;
  shares: number;
  reposts: number;
  interactions: number;
  taxaSalvamentoPct: number | null;
  skipRate3sPct: number | null;
  score: number;
}

const WEEK_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;
const WEEKDAY_TO_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const FORMAT_TO_EDITORIAL: Record<NormalizedFormat, EditorialPostFormato> = {
  carrossel: "carrossel",
  reels: "reels",
  imagem: "feed_4_5",
  story: "story",
};

const nonNeg = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);

function avgNullable(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return valid.length > 0 ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2)) : null;
}

function resolveValidTimezone(raw?: string): string {
  const candidate = raw?.trim() || "America/Sao_Paulo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return "America/Sao_Paulo";
  }
}

function normalizeFormat(item: CachedMetricPayload): NormalizedFormat {
  const product = String(item.media_product_type ?? "").toUpperCase();
  const mediaType = String(item.media_type ?? "").toUpperCase();
  if (product === "REELS" || product === "REEL") return "reels";
  if (product === "STORY" || product === "STORIES") return "story";
  if (mediaType === "CAROUSEL_ALBUM" || mediaType === "CAROUSEL") return "carrossel";
  return mediaType === "VIDEO" ? "reels" : "imagem";
}

function extractLocalDayAndHour(date: Date, timeZone: string): { diaSemana: number; hora: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hrRaw = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
  return { diaSemana: WEEKDAY_TO_INDEX[wd] ?? 0, hora: Number.isFinite(hrRaw) ? ((hrRaw % 24) + 24) % 24 : 12 };
}

function formatYmdInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string, fb: string) => parts.find((p) => p.type === t)?.value ?? fb;
  return `${get("year", "2026")}-${get("month", "01")}-${get("day", "01")}`;
}

function computePostScore(p: Omit<ParsedPostSample, "score">, maxViews: number, maxEng: number): number {
  if (p.reach > 0) {
    const savePct = p.taxaSalvamentoPct ?? (p.saved / p.reach) * 100;
    const viralityPct = ((p.shares + p.reposts) / p.reach) * 100;
    const engPct = (p.interactions / p.reach) * 100;
    let weighted =
      Math.min(100, (savePct / 10) * 100) * 0.35 +
      Math.min(100, (viralityPct / 5) * 100) * 0.25 +
      Math.min(100, (engPct / 15) * 100) * 0.2;
    let weightSum = 0.8;
    if (p.skipRate3sPct !== null) {
      weighted += Math.max(0, Math.min(100, 100 - p.skipRate3sPct)) * 0.2;
      weightSum += 0.2;
    }
    return Number((weighted / weightSum).toFixed(2));
  }
  if (p.views > 0 && maxViews > 0) return Number(Math.min(100, (p.views / maxViews) * 100).toFixed(2));
  if (p.interactions > 0 && maxEng > 0) return Number(Math.min(100, (p.interactions / maxEng) * 100).toFixed(2));
  return 0;
}

function resolveConfidence(bucketPosts: number, totalPosts: number): MetaPostingConfidence {
  if (bucketPosts >= 3 && totalPosts >= 10) return "alta";
  if (bucketPosts >= 2 || totalPosts >= 5) return "media";
  return "baixa";
}

/**
 * Motor determinístico de Inteligência de Retenção, Melhor Horário e Formatos Campeões (Fase 45).
 */
export class MetaPostingIntelligenceService {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public analyze(options: {
    periodo?: MetaPostingIntelligencePeriod;
    formato?: NormalizedFormat;
    contaId?: string;
    timezone?: string;
    referenceNow?: Date;
  } = {}): MetaPostingIntelligenceReport {
    const periodo: MetaPostingIntelligencePeriod =
      options.periodo === "90d" || options.periodo === "all" ? options.periodo : "30d";
    const timezone = resolveValidTimezone(options.timezone);
    const now = options.referenceNow ?? new Date();
    const cutoffMs = periodo === "all" ? null : now.getTime() - (periodo === "90d" ? 90 : 30) * 86_400_000;

    const rows = (
      options.contaId?.trim()
        ? this.db.connection
            .prepare("SELECT payload_json, sincronizado_em FROM meta_posts_cache WHERE conta_id = ? ORDER BY sincronizado_em DESC LIMIT 200;")
            .all(options.contaId.trim())
        : this.db.connection
            .prepare("SELECT payload_json, sincronizado_em FROM meta_posts_cache ORDER BY sincronizado_em DESC LIMIT 200;")
            .all()
    ) as Array<{ payload_json: string; sincronizado_em: string }>;

    let newestSync: string | null = null;
    const rawSamples: Array<Omit<ParsedPostSample, "score">> = [];

    for (const row of rows) {
      if (!newestSync || row.sincronizado_em > newestSync) newestSync = row.sincronizado_em;
      let parsed: CachedMetricPayload;
      try {
        parsed = JSON.parse(row.payload_json) as CachedMetricPayload;
      } catch {
        continue;
      }
      const ts = parsed.timestamp ? Date.parse(parsed.timestamp) : Date.parse(row.sincronizado_em);
      if (Number.isNaN(ts) || (cutoffMs !== null && ts < cutoffMs)) continue;

      const formato = normalizeFormat(parsed);
      if (options.formato && formato !== options.formato) continue;

      const { diaSemana, hora } = extractLocalDayAndHour(new Date(ts), timezone);
      const reach = nonNeg(parsed.reach);
      const views = nonNeg(parsed.views);
      const saved = nonNeg(parsed.saved);
      const shares = nonNeg(parsed.shares);
      const reposts = nonNeg(parsed.reposts);
      const interactions =
        typeof parsed.total_interactions === "number" && Number.isFinite(parsed.total_interactions)
          ? Math.max(0, parsed.total_interactions) + reposts
          : nonNeg(parsed.likes) + nonNeg(parsed.comments) + saved + shares + reposts;
      const taxaSalvamentoPct =
        typeof parsed.taxa_salvamento_pct === "number" && Number.isFinite(parsed.taxa_salvamento_pct)
          ? parsed.taxa_salvamento_pct
          : reach > 0
            ? Number(((saved / reach) * 100).toFixed(2))
            : null;
      const skipRate3sPct =
        formato === "reels" && typeof parsed.skip_rate_3s_pct === "number" && Number.isFinite(parsed.skip_rate_3s_pct)
          ? Math.min(100, Math.max(0, Number(parsed.skip_rate_3s_pct.toFixed(2))))
          : null;

      rawSamples.push({ formato, diaSemana, hora, reach, views, saved, shares, reposts, interactions, taxaSalvamentoPct, skipRate3sPct });
    }

    const maxViews = rawSamples.reduce((m, p) => Math.max(m, p.views), 0);
    const maxEng = rawSamples.reduce((m, p) => Math.max(m, p.interactions), 0);
    const samples: ParsedPostSample[] = rawSamples.map((s) => ({ ...s, score: computePostScore(s, maxViews, maxEng) }));

    const totalPosts = samples.length;
    const hourGroups = new Map<string, ParsedPostSample[]>();
    const formatGroups = new Map<NormalizedFormat, ParsedPostSample[]>();
    let totalReposts = 0;

    for (const s of samples) {
      totalReposts += s.reposts;
      const hk = `${s.diaSemana}:${s.hora}`;
      hourGroups.set(hk, [...(hourGroups.get(hk) ?? []), s]);
      formatGroups.set(s.formato, [...(formatGroups.get(s.formato) ?? []), s]);
    }

    const skipList = samples.map((s) => s.skipRate3sPct);
    const avgSkip = avgNullable(skipList);
    const avgHook = avgSkip !== null ? Number((100 - avgSkip).toFixed(2)) : null;
    const skipCount = skipList.filter((v) => v !== null).length;

    const heatmap: MetaPostingHourBucket[] = Array.from(hourGroups.values())
      .map((items) => {
        const { diaSemana, hora } = items[0];
        const diaLabel = WEEK_LABELS[diaSemana] ?? "Seg";
        const hh = String(hora).padStart(2, "0");
        const count = items.length;
        return {
          dia_semana: diaSemana,
          dia_label: diaLabel,
          hora,
          faixa_label: `${diaLabel} · ${hh}:00–${hh}:59`,
          quantidade_posts: count,
          reach_medio: Math.round(items.reduce((a, b) => a + b.reach, 0) / count),
          views_medio: Math.round(items.reduce((a, b) => a + b.views, 0) / count),
          taxa_salvamento_media_pct: avgNullable(items.map((i) => i.taxaSalvamentoPct)),
          skip_rate_3s_medio_pct: avgNullable(items.map((i) => i.skipRate3sPct)),
          reposts_total: items.reduce((a, b) => a + b.reposts, 0),
          score_medio: Number((items.reduce((a, b) => a + b.score, 0) / count).toFixed(2)),
          confianca: resolveConfidence(count, totalPosts),
        };
      })
      .sort((a, b) => b.score_medio - a.score_medio || b.quantidade_posts - a.quantidade_posts || b.reach_medio - a.reach_medio);

    const melhoresHorarios = heatmap.slice(0, 5);
    const formatosCampeoes: MetaChampionFormatItem[] = Array.from(formatGroups.entries())
      .map(([formato, items]) => {
        const count = items.length;
        const saveAvg = avgNullable(items.map((i) => i.taxaSalvamentoPct));
        const fmtSkipAvg = avgNullable(items.map((i) => i.skipRate3sPct));
        const fmtReposts = items.reduce((a, b) => a + b.reposts, 0);
        const scoreMedio = Number((items.reduce((a, b) => a + b.score, 0) / count).toFixed(2));
        const motivoParts = [`Score ${scoreMedio}`];
        if (saveAvg !== null) motivoParts.push(`${saveAvg}% salvamento`);
        if (fmtSkipAvg !== null) motivoParts.push(`Skip 3s ${fmtSkipAvg}%`);
        if (fmtReposts > 0) motivoParts.push(`${fmtReposts} reposts`);
        return {
          formato,
          editorial_formato: FORMAT_TO_EDITORIAL[formato],
          quantidade: count,
          reach_medio: Math.round(items.reduce((a, b) => a + b.reach, 0) / count),
          views_medio: Math.round(items.reduce((a, b) => a + b.views, 0) / count),
          taxa_salvamento_media_pct: saveAvg,
          avg_skip_rate_3s_pct: fmtSkipAvg,
          total_reposts: fmtReposts,
          score_medio: scoreMedio,
          campeao: false,
          motivo_destaque: motivoParts.join(" · "),
        };
      })
      .sort((a, b) => b.score_medio - a.score_medio || b.quantidade - a.quantidade)
      .map((item, idx) => ({ ...item, campeao: idx === 0 }));

    return {
      ok: true,
      periodo,
      timezone,
      total_posts_analisados: totalPosts,
      amostra_insuficiente: totalPosts < 5,
      resumo_retencao: {
        total_reels_com_skip_rate: skipCount,
        avg_skip_rate_3s_pct: avgSkip,
        avg_hook_retention_3s_pct: avgHook,
        total_reposts: totalReposts,
      },
      melhores_horarios: melhoresHorarios,
      heatmap_horarios: heatmap,
      formatos_campeoes: formatosCampeoes,
      proximo_slot_sugerido: this.computeNextFreeSlot(
        melhoresHorarios[0] ?? null,
        formatosCampeoes[0]?.editorial_formato ?? "reels",
        timezone,
        now
      ),
      recomendacoes: this.buildRecommendations({
        totalPosts,
        amostraInsuficiente: totalPosts < 5,
        melhorHorario: melhoresHorarios[0] ?? null,
        formatoCampeao: formatosCampeoes[0] ?? null,
        avgSkipRate: avgSkip,
      }),
      ultima_sincronizacao: newestSync,
    };
  }

  private computeNextFreeSlot(
    topHour: MetaPostingHourBucket | null,
    bestEditorialFormato: EditorialPostFormato,
    timezone: string,
    referenceNow: Date
  ): MetaNextSuggestedSlot | null {
    if (!topHour) return null;
    const scheduledRows = this.db.connection
      .prepare("SELECT data_agendada FROM calendario_editorial_posts WHERE data_agendada IS NOT NULL AND status IN ('agendado', 'aprovacao', 'em_producao');")
      .all() as Array<{ data_agendada: string }>;
    const occupiedDates = new Set(
      scheduledRows.map((r) => String(r.data_agendada).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    );

    let chosenDate: string | null = null;
    for (let offset = 1; offset <= 21; offset += 1) {
      const candidate = new Date(referenceNow.getTime() + offset * 86_400_000);
      if (extractLocalDayAndHour(candidate, timezone).diaSemana !== topHour.dia_semana) continue;
      const ymd = formatYmdInTimezone(candidate, timezone);
      if (!occupiedDates.has(ymd)) {
        chosenDate = ymd;
        break;
      }
    }
    if (!chosenDate) chosenDate = formatYmdInTimezone(new Date(referenceNow.getTime() + 86_400_000), timezone);

    const hh = String(topHour.hora).padStart(2, "0");
    return {
      data_agendada: chosenDate,
      dia_label: topHour.dia_label,
      hora_sugerida: `${hh}:00`,
      formato_recomendado: bestEditorialFormato,
      motivo: `Slot livre alinhado ao pico ${topHour.faixa_label} (score ${topHour.score_medio}).`,
    };
  }

  private buildRecommendations(input: {
    totalPosts: number;
    amostraInsuficiente: boolean;
    melhorHorario: MetaPostingHourBucket | null;
    formatoCampeao: MetaChampionFormatItem | null;
    avgSkipRate: number | null;
  }): MetaPostingRecommendationItem[] {
    const out: MetaPostingRecommendationItem[] = [];
    if (input.totalPosts === 0) {
      return [
        {
          id: "rec-sync-galeria",
          tipo: "amostra",
          titulo: "Sincronize a Galeria IG para gerar recomendações",
          justificativa:
            "Ainda não há publicações em cache local. Clique em Atualizar na Galeria de Métricas para analisar horários e retenção.",
        },
      ];
    }
    if (input.melhorHorario) {
      out.push({
        id: "rec-melhor-horario",
        tipo: "melhor_horario",
        titulo: `Melhor janela observada: ${input.melhorHorario.faixa_label}`,
        justificativa: `Score médio ${input.melhorHorario.score_medio} em ${input.melhorHorario.quantidade_posts} publicação(ões) (${input.melhorHorario.reach_medio} alcance médio).`,
      });
    }
    if (input.formatoCampeao) {
      out.push({
        id: "rec-formato-campeao",
        tipo: "formato_campeao",
        titulo: `Formato líder: ${input.formatoCampeao.formato.toUpperCase()}`,
        justificativa: input.formatoCampeao.motivo_destaque,
      });
    }
    if (input.avgSkipRate !== null && input.avgSkipRate > 50) {
      out.push({
        id: "rec-alerta-gancho",
        tipo: "alerta_gancho",
        titulo: `Skip Rate 3s elevado (${input.avgSkipRate}%)`,
        justificativa:
          "Mais da metade das visualizações abandona os Reels nos primeiros 3 segundos. Reforce o gancho visual e textual na abertura.",
      });
    } else if (input.amostraInsuficiente) {
      out.push({
        id: "rec-amostra-baixa",
        tipo: "amostra",
        titulo: `Amostra ainda reduzida (${input.totalPosts} posts)`,
        justificativa:
          "Recomendações ganham confiança estatística a partir de 5 a 10 publicações sincronizadas no período.",
      });
    }
    return out.slice(0, 4);
  }
}
