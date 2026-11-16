import type { GrupoCotaConta, JanelaCotaConta, JanelaCotaUso } from "@criativo/contracts";

/**
 * Formata uma data ISO de reinício de cota em texto curto pt-BR ("42 min", "1 h 50 min", "6 d 20 h").
 */
export function formatResetCountdownPtBr(resetIso: string | null | undefined): string {
  if (!resetIso) return "";
  const ts = Date.parse(resetIso);
  if (!Number.isFinite(ts)) return "";
  const diffMs = Math.max(0, ts - Date.now());
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)} min`;
  }
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) {
    return `${days} d ${hours} h`;
  }
  return `${hours} h ${mins} min`;
}

/**
 * Converte grupos de cota (5h / semanal) para a lista plana `janelas` exibida no relatório de uso.
 */
export function buildUsageWindowsFromGroups(
  grupos: GrupoCotaConta[],
  singleGroupShortLabel = false
): JanelaCotaUso[] {
  const onlyOne = singleGroupShortLabel && grupos.length === 1;
  return grupos.flatMap((g) => {
    const items: JanelaCotaUso[] = [];
    if (g.janela_5h) {
      items.push({
        janela: "5h",
        rotulo: onlyOne ? "5 horas" : `${g.nome} (5h)`,
        restante_percentual: g.janela_5h.restante_percentual,
        usado_tokens: 0,
        limite_tokens: 100,
        reseta_em_texto: g.janela_5h.reseta_em_texto,
        reseta_em: g.janela_5h.reseta_em,
      });
    }
    if (g.janela_semanal) {
      items.push({
        janela: "7d",
        rotulo: onlyOne ? "Semanal" : `${g.nome} (Semanal)`,
        restante_percentual: g.janela_semanal.restante_percentual,
        usado_tokens: 0,
        limite_tokens: 100,
        reseta_em_texto: g.janela_semanal.reseta_em_texto,
        reseta_em: g.janela_semanal.reseta_em,
      });
    }
    return items;
  });
}

function buildQuotaWindow(
  janela: "5h" | "semanal",
  rotulo: string,
  duracaoMinutos: number,
  remainingPct: number | null | undefined,
  resetIso: string | null | undefined
): JanelaCotaConta | null {
  if (typeof remainingPct !== "number" || !Number.isFinite(remainingPct)) return null;
  const clampedRemaining = Math.max(0, Math.min(100, Math.round(remainingPct)));
  return {
    rotulo,
    janela,
    duracao_minutos: duracaoMinutos,
    restante_percentual: clampedRemaining,
    usado_percentual: 100 - clampedRemaining,
    reseta_em: resetIso ?? null,
    reseta_em_texto: formatResetCountdownPtBr(resetIso),
  };
}

/**
 * Monta um `GrupoCotaConta` padrão (janelas 5h + Semanal) usado por provedores CLI/OAuth (ChatGPT, Claude).
 */
export function buildDualWindowQuotaGroup(params: {
  nome: string;
  fiveHourRemaining?: number | null;
  fiveHourResetIso?: string | null;
  fiveHourDurationMins?: number;
  weeklyRemaining?: number | null;
  weeklyResetIso?: string | null;
  weeklyDurationMins?: number;
}): GrupoCotaConta | null {
  const janela5h = buildQuotaWindow(
    "5h",
    "5 horas",
    params.fiveHourDurationMins ?? 300,
    params.fiveHourRemaining,
    params.fiveHourResetIso
  );
  const janelaSemanal = buildQuotaWindow(
    "semanal",
    "Semanal",
    params.weeklyDurationMins ?? 10_080,
    params.weeklyRemaining,
    params.weeklyResetIso
  );
  if (!janela5h && !janelaSemanal) return null;
  return {
    nome: params.nome,
    modelos: [],
    janela_5h: janela5h,
    janela_semanal: janelaSemanal,
  };
}

/**
 * Recalcula textos de contagem regressiva de grupos em cache para nunca exibir tempo vencido.
 */
export function refreshCachedQuotaGroupCountdowns(grupos: GrupoCotaConta[]): GrupoCotaConta[] {
  return grupos.map((g) => ({
    ...g,
    janela_5h: g.janela_5h
      ? { ...g.janela_5h, reseta_em_texto: formatResetCountdownPtBr(g.janela_5h.reseta_em) }
      : null,
    janela_semanal: g.janela_semanal
      ? { ...g.janela_semanal, reseta_em_texto: formatResetCountdownPtBr(g.janela_semanal.reseta_em) }
      : null,
  }));
}
