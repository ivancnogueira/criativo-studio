import React, { useEffect, useMemo, useState } from "react";
import type {
  MetaGalleryPeriod,
  MetaPostingConfidence,
  MetaPostingIntelligenceReport,
} from "@criativo/contracts";
import {
  Activity,
  Award,
  CalendarClock,
  Flame,
  Lightbulb,
  Loader2,
  Repeat2,
  Sparkles,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

export interface MetaRetentionInsightsPanelProps {
  periodo: MetaGalleryPeriod;
  formatFilter: "todos" | "carrossel" | "reels" | "imagem";
  refreshNonce?: number;
  initialReport?: MetaPostingIntelligenceReport | null;
  onAnalyzeWithAgent: (prompt: string) => void;
}

const WEEKDAY_ORDER = [
  { dia: 1, label: "Seg" },
  { dia: 2, label: "Ter" },
  { dia: 3, label: "Qua" },
  { dia: 4, label: "Qui" },
  { dia: 5, label: "Sex" },
  { dia: 6, label: "Sáb" },
  { dia: 0, label: "Dom" },
];

function skipRateTextClass(val: number | null | undefined): string {
  if (val === null || val === undefined) return "text-[#979797]";
  if (val <= 35) return "text-[#31CF76]";
  if (val <= 50) return "text-[#FDCB6E]";
  return "text-[#FD2F3B]";
}

function confidenceBadge(c: MetaPostingConfidence): { label: string; cls: string } {
  if (c === "alta") return { label: "Confiança alta", cls: "bg-[#31CF76]/15 text-[#31CF76]" };
  if (c === "media") return { label: "Confiança média", cls: "bg-[#FDCB6E]/15 text-[#FDCB6E]" };
  return { label: "Amostra baixa", cls: "bg-white/10 text-[#979797]" };
}

function formatPct(val: number | null | undefined): string {
  return val === null || val === undefined ? "—" : `${val}%`;
}

/**
 * Painel visual Carbon Dark de Retenção 3s, Reposts, Formatos Campeões e Heatmap Dia x Horário (META42-03).
 */
export const MetaRetentionInsightsPanel: React.FC<MetaRetentionInsightsPanelProps> = ({
  periodo,
  formatFilter,
  refreshNonce = 0,
  initialReport,
  onAnalyzeWithAgent,
}) => {
  const [report, setReport] = useState<MetaPostingIntelligenceReport | null>(initialReport ?? null);
  const [loading, setLoading] = useState(!initialReport);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialReport) {
      setReport(initialReport);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    setLoading(true);
    setErrorMsg(null);

    void daemonApi
      .getPostingIntelligence({
        periodo: periodo === "90d" ? "90d" : "30d",
        formato: formatFilter === "todos" ? undefined : formatFilter,
        timezone,
      })
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Erro ao calcular inteligência de retenção.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [periodo, formatFilter, refreshNonce, initialReport]);

  const maxFormatScore = useMemo(() => {
    if (!report?.formatos_campeoes.length) return 1;
    return Math.max(...report.formatos_campeoes.map((f) => f.score_medio), 1);
  }, [report?.formatos_campeoes]);

  const observedHours = useMemo(() => {
    if (!report?.heatmap_horarios.length) return [];
    const unique = Array.from(new Set(report.heatmap_horarios.map((b) => b.hora))).sort((a, b) => a - b);
    return unique.slice(0, 8);
  }, [report?.heatmap_horarios]);

  const bucketMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of report?.heatmap_horarios ?? []) {
      map.set(`${b.dia_semana}-${b.hora}`, b.score_medio);
    }
    return map;
  }, [report?.heatmap_horarios]);

  const maxHeatScore = useMemo(() => {
    if (!report?.heatmap_horarios.length) return 1;
    return Math.max(...report.heatmap_horarios.map((b) => b.score_medio), 1);
  }, [report?.heatmap_horarios]);

  const handleAnalyzeRetention = () => {
    if (!report) return;
    const topWindows = report.melhores_horarios
      .slice(0, 3)
      .map((h) => `${h.faixa_label} (score ${h.score_medio})`)
      .join(", ");
    const champions = report.formatos_campeoes
      .map((f) => `${f.formato}: score ${f.score_medio}, skip3s ${formatPct(f.avg_skip_rate_3s_pct)}, reposts ${f.total_reposts}`)
      .join("; ");
    const prompt = [
      `Analise a inteligência de retenção e horários da conta (${report.periodo}, fuso ${report.timezone}) e sugira 3 ganchos de abertura + plano semanal:`,
      `- Skip Rate 3s Médio: ${formatPct(report.resumo_retencao.avg_skip_rate_3s_pct)}`,
      `- Retenção 3s Média: ${formatPct(report.resumo_retencao.avg_hook_retention_3s_pct)}`,
      `- Reposts Totais: ${report.resumo_retencao.total_reposts}`,
      `- Melhores Horários: ${topWindows || "Sem janela consolidada"}`,
      `- Formatos Campeões: ${champions || "Sem ranking"}`,
    ].join("\n");
    onAnalyzeWithAgent(prompt);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-[#141414] py-8 text-xs text-[#979797]">
        <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
        <span>Calculando retenção 3s, reposts e melhores horários...</span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-4 py-3 text-xs text-[#FF8A90]">
        {errorMsg}
      </div>
    );
  }

  if (!report) return null;

  const r = report.resumo_retencao;

  return (
    <section
      aria-label="Inteligência de Retenção e Melhores Horários"
      className="rounded-2xl border border-white/[0.06] bg-[#141414] p-4 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#42A0FF]" />
          <div>
            <h2 className="text-sm font-semibold text-white">
              Inteligência de Retenção 3s, Reposts & Melhores Horários
            </h2>
            <p className="text-[11px] text-[#979797]">
              {report.total_posts_analisados} post(s) analisado(s) · Fuso {report.timezone}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAnalyzeRetention}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#212121] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2B2B2B]"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#31CF76]" />
          <span>Analisar retenção com Criativo</span>
        </button>
      </div>

      {(report.total_posts_analisados === 0 || report.amostra_insuficiente) && (
        <div className="rounded-xl border border-[#FF9412]/30 bg-[#FF9412]/10 px-3.5 py-2.5 text-xs text-[#FDCB6E]">
          {report.total_posts_analisados === 0
            ? "Sincronize sua conta Meta API para coletar dados reais de Skip Rate 3s, Reposts e melhores horários."
            : "Amostra ainda reduzida (< 5 posts sincronizados). Os rankings abaixo refletem apenas os posts já coletados e ganharão maior confiança após novas sincronizações."}
        </div>
      )}

      {/* Faixa 1: Retenção & Viralidade */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.06] bg-[#101010] p-3">
          <p className="text-[11px] text-[#979797]">Retenção 3s Média</p>
          <p className="mt-1 text-xl font-semibold text-[#31CF76] tabular-nums">
            {formatPct(r.avg_hook_retention_3s_pct)}
          </p>
          <p className="mt-0.5 text-[10.5px] text-[#6A6A6A]">
            Reels com dado 3s: {r.total_reels_com_skip_rate}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#101010] p-3">
          <p className="text-[11px] text-[#979797]">Skip Rate 3s Médio</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${skipRateTextClass(r.avg_skip_rate_3s_pct)}`}>
            {formatPct(r.avg_skip_rate_3s_pct)}
          </p>
          <p className="mt-0.5 text-[10.5px] text-[#6A6A6A]">
            Meta ideal: até 35% (alerta acima de 50%)
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#101010] p-3">
          <p className="flex items-center gap-1 text-[11px] text-[#979797]">
            <Repeat2 className="h-3.5 w-3.5 text-[#42A0FF]" />
            <span>Reposts Totais</span>
          </p>
          <p className="mt-1 text-xl font-semibold text-white tabular-nums">
            {r.total_reposts.toLocaleString("pt-BR")}
          </p>
          <p className="mt-0.5 text-[10.5px] text-[#6A6A6A]">
            Sinal direto de alcance orgânico compartilhado
          </p>
        </div>
      </div>

      {/* Faixa 2: Formatos Campeões + Melhores Horários */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-[#101010] p-3.5 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <Award className="h-4 w-4 text-[#FDCB6E]" />
            <span>Formatos Campeões</span>
          </div>
          {report.formatos_campeoes.length === 0 ? (
            <p className="text-xs text-[#979797]">Nenhum formato ranqueado ainda.</p>
          ) : (
            <div className="space-y-2">
              {report.formatos_campeoes.map((fmt) => {
                const widthPct = Math.max(8, Math.round((fmt.score_medio / maxFormatScore) * 100));
                return (
                  <div key={fmt.formato} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11.5px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold capitalize text-white">{fmt.formato}</span>
                        {fmt.campeao && (
                          <span className="rounded bg-[#31CF76]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#31CF76]">
                            Campeão
                          </span>
                        )}
                      </div>
                      <span className="text-[10.5px] text-[#979797] tabular-nums">
                        Score {fmt.score_medio} · Salv. {formatPct(fmt.taxa_salvamento_media_pct)} · Skip{" "}
                        {formatPct(fmt.avg_skip_rate_3s_pct)} · Reposts {fmt.total_reposts}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#1E1E1E]">
                      <div
                        className={`h-full rounded-full ${fmt.campeao ? "bg-[#31CF76]" : "bg-[#42A0FF]"}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#101010] p-3.5 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <CalendarClock className="h-4 w-4 text-[#42A0FF]" />
            <span>Melhores Horários & Mapa de Calor</span>
          </div>
          {report.melhores_horarios.length === 0 ? (
            <p className="text-xs text-[#979797]">Sem janelas consolidadas no período.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {report.melhores_horarios.slice(0, 3).map((slot) => {
                  const badge = confidenceBadge(slot.confianca);
                  return (
                    <div
                      key={`${slot.dia_semana}-${slot.hora}`}
                      className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#161616] px-2.5 py-1 text-[11px]"
                    >
                      <Flame className="h-3 w-3 text-[#FDCB6E]" />
                      <span className="font-semibold text-white">{slot.faixa_label}</span>
                      <span className="text-[#979797]">({slot.score_medio})</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {observedHours.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="inline-grid gap-1 text-[10px]" style={{ gridTemplateColumns: `34px repeat(${observedHours.length}, minmax(28px, 1fr))` }}>
                    <div />
                    {observedHours.map((h) => (
                      <div key={h} className="text-center font-mono text-[#979797]">
                        {String(h).padStart(2, "0")}h
                      </div>
                    ))}
                    {WEEKDAY_ORDER.map((w) => (
                      <React.Fragment key={w.dia}>
                        <div className="flex items-center font-medium text-[#979797]">{w.label}</div>
                        {observedHours.map((h) => {
                          const score = bucketMap.get(`${w.dia}-${h}`);
                          const ratio = score ? Math.max(0.18, score / maxHeatScore) : 0;
                          return (
                            <div
                              key={`${w.dia}-${h}`}
                              title={score ? `${w.label} ${String(h).padStart(2, "0")}h: score ${score}` : `${w.label} ${String(h).padStart(2, "0")}h: sem dados`}
                              className="h-5 rounded border border-white/[0.05] text-center leading-5 font-mono text-[9px] text-white/90"
                              style={{
                                backgroundColor: score ? `rgba(49, 207, 118, ${ratio.toFixed(2)})` : "#161616",
                              }}
                            >
                              {score ? Math.round(score) : ""}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Faixa 3: Recomendações Acionáveis */}
      {report.recomendacoes.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {report.recomendacoes.slice(0, 4).map((rec) => (
            <div
              key={rec.id}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                rec.tipo === "alerta_gancho"
                  ? "border-[#FD2F3B]/35 bg-[#FD2F3B]/10 text-[#FFB4B8]"
                  : "border-white/[0.06] bg-[#101010] text-[#DCDCDC]"
              }`}
            >
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FDCB6E]" />
              <div>
                <p className="font-semibold text-white">{rec.titulo}</p>
                <p className="text-[11px] text-[#979797]">{rec.justificativa}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
