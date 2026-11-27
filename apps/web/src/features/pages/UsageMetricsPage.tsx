import React, { useMemo, useState } from "react";
import type {
  AgenteRegistro,
  GranularidadeAnalyticsUso,
  LinhaDetalheUso,
  ProvedorStatusInfo,
  RelatorioAnalyticsHost,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import { ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";
import { HostResourcesPanel } from "../../components/HostResourcesPanel";
import { UsageStackedBarChart } from "./UsageStackedBarChart";
import {
  formatCompactTokensPt,
  formatDateTimePt,
  formatUsdPt,
  inferProviderFromModelOrAgent,
  RECOMMENDED_PERIOD_OPTIONS,
  resolveProviderChartColor,
} from "./usage-chart-helpers";

interface UsageMetricsPageProps {
  uso: UsoProvedoresSnapshot | null;
  provedores: ProvedorStatusInfo[];
  onRefresh: () => Promise<void>;
  analytics?: RelatorioAnalyticsHost | null;
  agentes?: AgenteRegistro[];
  periodoDias?: number;
  agenteFiltroId?: string | null;
  granularidade?: "auto" | GranularidadeAnalyticsUso;
  loading?: boolean;
  onChangeFilters?: (
    dias: number,
    agenteId: string | null,
    granularidade?: "auto" | GranularidadeAnalyticsUso,
  ) => Promise<void>;
}

type DetailTabKey = "modelo" | "agente" | "dia" | "habilidade";

/**
 * Página dedicada 'Uso' com série empilhada multi-provedor, buckets diário/semanal/mensal,
 * transição dimmed sem piscar durante recargas e detalhamento por modelo, criativo, dia e habilidade.
 */
export const UsageMetricsPage: React.FC<UsageMetricsPageProps> = ({
  uso,
  provedores,
  onRefresh,
  analytics,
  agentes = [],
  periodoDias = 30,
  agenteFiltroId = null,
  granularidade = "auto",
  loading = false,
  onChangeFilters,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTabKey>("agente");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [estimatesOpen, setEstimatesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const report: RelatorioAnalyticsHost = useMemo(() => {
    if (analytics) return analytics;
    const nowIso = new Date().toISOString();
    return {
      periodo_dias: periodoDias,
      agente_id: agenteFiltroId,
      coleta_iniciada_em: nowIso,
      atualizado_em: nowIso,
      granularidade: "diario",
      totais: {
        sessoes: 0,
        turnos: uso?.total_execucoes_24h ?? 0,
        turnos_sem_uso: 0,
        registros_sem_preco: 0,
        registros_incompletos: 0,
        tokens_sem_cache: uso?.total_tokens_estimados ?? 0,
        tokens_processados: uso?.total_tokens_estimados ?? 0,
        entrada_cache: 0,
        entrada_sem_cache: uso?.total_tokens_estimados ?? 0,
        criacao_cache: 0,
        saida: 0,
        custo_estimado_usd: null,
      },
      provedores: [],
      por_modelo: [],
      por_agente: [],
      por_dia: [],
      serie_empilhada: [],
      por_habilidade: [],
    };
  }, [analytics, uso, periodoDias, agenteFiltroId]);

  const totais = report.totais;
  const hasPartialBanner =
    totais.turnos_sem_uso > 0 || totais.registros_sem_preco > 0 || totais.registros_incompletos > 0;
  const isDimmed = Boolean(loading || refreshing);

  const tabIndex = ["modelo", "agente", "dia", "habilidade"].indexOf(activeTab);

  const selectedPeriodLabel =
    RECOMMENDED_PERIOD_OPTIONS.find((o) => o.dias === periodoDias)?.rotulo ?? `Últimos ${periodoDias} dias`;
  const selectedAgentLabel = agenteFiltroId
    ? agentes.find((a) => a.agente_id === agenteFiltroId)?.nome ?? agenteFiltroId
    : "Todos os Criativos";

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const renderDetailRows = (rows: LinhaDetalheUso[], isModelOrAgent: boolean) => {
    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={4} className="py-6 text-[12.5px] text-[#787878] text-center">
            Nenhum registro encontrado neste período. Envie uma mensagem em um Criativo ou importe a telemetria local.
          </td>
        </tr>
      );
    }
    return rows.map((row) => (
      <tr key={row.chave} className="border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors">
        <td className="py-2.5 pr-4 text-[13px] font-medium text-[#E5E5E5]">
          <div className="flex items-center gap-2">
            {isModelOrAgent && (
              <ProviderLogo provider={inferProviderFromModelOrAgent(row.provedor ?? row.nome)} size={14} />
            )}
            <span className="truncate">{row.nome}</span>
          </div>
        </td>
        <td className="py-2.5 px-4 text-right text-[12.5px] text-[#B5B5B5] tabular-nums">
          {formatUsdPt(row.custo_estimado_usd)}
        </td>
        <td className="py-2.5 px-4 text-right text-[12.5px] text-[#B5B5B5] tabular-nums">
          {row.participacao_percentual !== null && row.custo_estimado_usd !== null
            ? `${row.participacao_percentual.toLocaleString("pt-BR")}%`
            : "Indisponível"}
        </td>
        <td className="py-2.5 pl-4 text-right text-[12.5px] font-medium text-[#E5E5E5] tabular-nums">
          {formatCompactTokensPt(row.tokens_sem_cache)}
        </td>
      </tr>
    ));
  };

  return (
    <div className="flex-1 h-full bg-[#171717] overflow-y-auto px-6 py-5">
      <div className="max-w-[920px] mx-auto space-y-6">
        {/* Filtros discretos customizados no topo (ZERO dropdown nativo) */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtro de período */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setPeriodMenuOpen((v) => !v);
                  setAgentMenuOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-1.5 text-[12px] text-[#DCDCDC] hover:bg-[#282828] transition-colors"
              >
                <span>{selectedPeriodLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#888]" />
              </button>
              {periodMenuOpen && (
                <div className="absolute left-0 mt-1.5 w-56 rounded-xl bg-[#212121] border border-white/10 shadow-2xl p-1 z-30">
                  {RECOMMENDED_PERIOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.dias}
                      type="button"
                      onClick={() => {
                        setPeriodMenuOpen(false);
                        if (onChangeFilters) void onChangeFilters(opt.dias, agenteFiltroId ?? null, granularidade);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] transition-colors ${
                        periodoDias === opt.dias
                          ? "bg-[#31CF76]/15 text-[#31CF76] font-medium"
                          : "text-[#DCDCDC] hover:bg-white/[0.06]"
                      }`}
                    >
                      {opt.rotulo}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Filtro de agente */}
            {agentes.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setAgentMenuOpen((v) => !v);
                    setPeriodMenuOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-1.5 text-[12px] text-[#DCDCDC] hover:bg-[#282828] transition-colors"
                >
                  <span className="truncate max-w-[180px]">{selectedAgentLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-[#888]" />
                </button>
                {agentMenuOpen && (
                  <div className="absolute left-0 mt-1.5 w-56 max-h-64 overflow-y-auto rounded-xl bg-[#212121] border border-white/10 shadow-2xl p-1 z-30">
                    <button
                      type="button"
                      onClick={() => {
                        setAgentMenuOpen(false);
                        if (onChangeFilters) void onChangeFilters(periodoDias, null, granularidade);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] transition-colors ${
                        !agenteFiltroId
                          ? "bg-[#31CF76]/15 text-[#31CF76] font-medium"
                          : "text-[#DCDCDC] hover:bg-white/[0.06]"
                      }`}
                    >
                      Todos os Criativos
                    </button>
                    {agentes.map((ag) => (
                      <button
                        key={ag.agente_id}
                        type="button"
                        onClick={() => {
                          setAgentMenuOpen(false);
                          if (onChangeFilters) void onChangeFilters(periodoDias, ag.agente_id, granularidade);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] truncate transition-colors ${
                          agenteFiltroId === ag.agente_id
                            ? "bg-[#31CF76]/15 text-[#31CF76] font-medium"
                            : "text-[#DCDCDC] hover:bg-white/[0.06]"
                        }`}
                      >
                        {ag.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-1.5 text-[12px] text-[#B5B5B5] hover:text-white hover:bg-[#282828] transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isDimmed ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </button>
        </div>

        {/* Conteúdo principal com transição dimmed preservando os dados anteriores durante recarga */}
        <div className={`space-y-6 transition-opacity duration-200 ${isDimmed ? "opacity-55 pointer-events-none" : ""}`}>
          {/* Banner de dados parciais no topo */}
          {hasPartialBanner && (
            <div className="rounded-xl bg-[#212121] border border-white/[0.07] px-3.5 py-2 text-[12px] text-[#B5B5B5]">
              Dados parciais · {totais.turnos_sem_uso} turnos sem uso informado;{" "}
              {totais.registros_sem_preco} registros sem estimativa de custo;{" "}
              {totais.registros_incompletos} registros com dados de tokens incompletos.
            </div>
          )}

          {/* Grade superior: Hero + lista de provedores à esquerda | Gráfico empilhado à direita */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Esquerda */}
            <div className="lg:col-span-5 space-y-5">
              <div>
                <div className="text-[32px] leading-tight font-bold tracking-tight text-[#F0F0F0]">
                  {formatUsdPt(totais.custo_estimado_usd)}
                </div>
                <div className="text-[12px] text-[#787878] mt-1">
                  {totais.sessoes} {totais.sessoes === 1 ? "sessão" : "sessões"} · Estimativa de API · USD
                </div>
              </div>

              <div className="space-y-3 pt-1">
                {report.provedores.length > 0 ? (
                  report.provedores.map((p) => (
                    <div key={p.provedor} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[13px] font-medium text-[#E5E5E5]">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: resolveProviderChartColor(p.provedor) }}
                          />
                          <Sparkles className="h-3.5 w-3.5 text-[#979797]" />
                          <span>{p.rotulo}</span>
                        </div>
                        <div className="text-[11.5px] text-[#787878] pl-4 mt-0.5">
                          {formatCompactTokensPt(p.tokens)} tokens
                        </div>
                      </div>
                      <div className="text-[13px] font-semibold text-[#E5E5E5] tabular-nums">
                        {formatUsdPt(p.custo_estimado_usd)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-[12.5px] text-[#787878]">
                    Nenhum provedor com turnos registrados ainda.
                  </div>
                )}
              </div>
            </div>

            {/* Direita: Gráfico SVG empilhado por provedor */}
            <UsageStackedBarChart
              series={report.serie_empilhada}
              fallbackDaily={report.por_dia}
              activeGranularity={granularidade}
              resolvedGranularity={report.granularidade}
              onChangeGranularity={(nextGran) => {
                if (onChangeFilters) void onChangeFilters(periodoDias, agenteFiltroId ?? null, nextGran);
              }}
              dimmed={isDimmed}
              onOpenDailyTab={() => setActiveTab("dia")}
            />
          </div>

          {/* Seção Totais — 6 colunas em 6 métricas principais */}
          <section className="space-y-3 pt-2">
            <h2 className="text-[13px] font-semibold text-[#E5E5E5]">Totais</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { rotulo: "Tokens sem leituras de cache", valor: formatCompactTokensPt(totais.tokens_sem_cache) },
                {
                  rotulo: "Tokens processados com leituras de cache",
                  valor: formatCompactTokensPt(totais.tokens_processados),
                },
                { rotulo: "Entrada em cache", valor: formatCompactTokensPt(totais.entrada_cache) },
                { rotulo: "Entrada sem cache", valor: formatCompactTokensPt(totais.entrada_sem_cache) },
                { rotulo: "Criação de cache", valor: formatCompactTokensPt(totais.criacao_cache) },
                { rotulo: "Saída", valor: formatCompactTokensPt(totais.saida) },
              ].map((item) => (
                <div key={item.rotulo} className="space-y-1">
                  <div className="text-[11px] text-[#787878] leading-snug min-h-[30px]">
                    {item.rotulo}
                  </div>
                  <div className="text-[17px] font-semibold text-[#F0F0F0] tabular-nums">
                    {item.valor}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Seção Detalhamento com SlidingTabs (Modelo | Criativo | Dia | Habilidade) */}
          <section className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold text-[#E5E5E5]">Detalhamento</h2>

              {/* SlidingTabs do CriativoOS */}
              <div className="relative inline-grid grid-cols-4 rounded-xl bg-[#212121] border border-white/[0.06] p-1">
                <div
                  aria-hidden="true"
                  className="absolute top-1 bottom-1 left-1 w-[calc(25%-2px)] rounded-lg bg-[#2E2E2E] transition-transform duration-200"
                  style={{ transform: `translateX(${tabIndex * 100}%)` }}
                />
                {[
                  { key: "modelo", label: "Modelo" },
                  { key: "agente", label: "Criativo" },
                  { key: "dia", label: "Dia" },
                  { key: "habilidade", label: "Habilidade" },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setActiveTab(t.key as DetailTabKey)}
                    className={`relative z-10 px-3 py-1 text-[12px] font-medium transition-colors ${
                      activeTab === t.key ? "text-white" : "text-[#888] hover:text-[#DCDCDC]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[11.5px] text-[#787878] font-medium">
                    <th className="py-2 pr-4 text-left">
                      {activeTab === "modelo"
                        ? "Modelo"
                        : activeTab === "agente"
                          ? "Criativo"
                          : activeTab === "dia"
                            ? "Dia"
                            : "Habilidade"}
                    </th>
                    <th className="py-2 px-4 text-right">Custo</th>
                    <th className="py-2 px-4 text-right">Participação</th>
                    <th className="py-2 pl-4 text-right">
                      {activeTab === "habilidade" ? "Tokens (Leituras)" : "Tokens"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeTab === "modelo" && renderDetailRows(report.por_modelo, true)}
                  {activeTab === "agente" && renderDetailRows(report.por_agente, true)}
                  {activeTab === "dia" &&
                    (report.por_dia.filter((d) => d.tokens > 0).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-[12.5px] text-[#787878] text-center">
                          Nenhum dia com uso registrado nesta janela.
                        </td>
                      </tr>
                    ) : (
                      [...report.por_dia]
                        .reverse()
                        .filter((d) => d.tokens > 0)
                        .map((d) => (
                          <tr key={d.data} className="border-t border-white/[0.05]">
                            <td className="py-2.5 pr-4 text-[13px] font-medium text-[#E5E5E5]">
                              {d.rotulo} <span className="text-[11px] text-[#787878]">({d.turnos} turnos)</span>
                            </td>
                            <td className="py-2.5 px-4 text-right text-[12.5px] text-[#B5B5B5] tabular-nums">
                              {formatUsdPt(d.custo_usd)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-[12.5px] text-[#B5B5B5]">
                              {totais.tokens_sem_cache > 0
                                ? `${((d.tokens / totais.tokens_sem_cache) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
                                : "Indisponível"}
                            </td>
                            <td className="py-2.5 pl-4 text-right text-[12.5px] font-medium text-[#E5E5E5] tabular-nums">
                              {formatCompactTokensPt(d.tokens)}
                            </td>
                          </tr>
                        ))
                    ))}
                  {activeTab === "habilidade" &&
                    (report.por_habilidade.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-[12.5px] text-[#787878] text-center">
                          Nenhuma leitura de `SKILL.md` registrada ainda neste período.
                        </td>
                      </tr>
                    ) : (
                      report.por_habilidade.map((h) => (
                        <tr key={h.habilidade} className="border-t border-white/[0.05]">
                          <td className="py-2.5 pr-4 text-[13px] font-medium text-[#E5E5E5]">
                            {h.habilidade}{" "}
                            <span className="text-[11px] text-[#787878]">
                              ({h.carregamentos}x)
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right text-[12.5px] text-[#B5B5B5]">
                            {formatUsdPt(h.custo_estimado_usd)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-[12.5px] text-[#B5B5B5]">
                            {h.participacao_percentual !== null
                              ? `${h.participacao_percentual.toLocaleString("pt-BR")}%`
                              : "Indisponível"}
                          </td>
                          <td className="py-2.5 pl-4 text-right text-[12.5px] font-medium text-[#E5E5E5] tabular-nums">
                            {formatCompactTokensPt(h.tokens)}
                          </td>
                        </tr>
                      ))
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Contas conectadas & janelas de cota ao vivo */}
          {(uso?.contas?.length ?? 0) > 0 && (
            <section className="rounded-2xl bg-[#1E1E1E] border border-white/[0.06] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[12.5px] font-semibold text-[#E5E5E5]">
                  Cotas em Tempo Real por Conta Conectada
                </h3>
                <span className="text-[11px] text-[#787878]">
                  {uso?.contas?.length ?? 0} conta(s) ativa(s)
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {uso!.contas!.map((conta) => (
                  <div
                    key={conta.id}
                    className="rounded-xl bg-[#161616] border border-white/[0.05] p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-1.5 font-medium text-white truncate">
                        <ProviderLogo provider={conta.provedor} size={13} />
                        <span className="truncate">{conta.email ?? conta.rotulo ?? conta.id}</span>
                      </div>
                      {conta.plano && (
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[#B5B5B5]">
                          {conta.plano}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {conta.grupos_cota.map((g) => (
                        <div key={g.nome} className="space-y-1">
                          {g.janela_5h && (
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-[#888] w-28 truncate">{g.nome} · 5h</span>
                              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#31CF76]"
                                  style={{ width: `${g.janela_5h.restante_percentual}%` }}
                                />
                              </div>
                              <span className="text-white tabular-nums">{g.janela_5h.restante_percentual}%</span>
                              <span className="text-[#6A6A6A] text-[10px] tabular-nums">{g.janela_5h.reseta_em_texto}</span>
                            </div>
                          )}
                          {g.janela_semanal && (
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-[#888] w-28 truncate">{g.nome} · Semanal</span>
                              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#DCDCDC]"
                                  style={{ width: `${g.janela_semanal.restante_percentual}%` }}
                                />
                              </div>
                              <span className="text-white tabular-nums">{g.janela_semanal.restante_percentual}%</span>
                              <span className="text-[#6A6A6A] text-[10px] tabular-nums">{g.janela_semanal.reseta_em_texto}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <HostResourcesPanel />

          {/* Rodapé timestamps + Sobre estas estimativas */}
          <footer className="pt-2 border-t border-white/[0.05] space-y-2 pb-6">
            <div className="text-[11.5px] text-[#787878]">
              Coleta iniciada em {formatDateTimePt(report.coleta_iniciada_em)} · Atualizado em{" "}
              {formatDateTimePt(report.atualizado_em)}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setEstimatesOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11.5px] text-[#888] hover:text-white transition-colors"
              >
                {estimatesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span>Sobre estas estimativas</span>
              </button>
              {estimatesOpen && (
                <p className="mt-1.5 text-[11.5px] text-[#787878] max-w-2xl leading-relaxed">
                  Os valores em USD refletem estimativas equivalentes de API pública quando aplicável; execuções
                  em planos OAuth (Google AI / Antigravity, Claude ou Codex) exibem &quot;Indisponível&quot; no custo por não
                  serem faturadas por token avulso. Contagens de tokens incluem leituras de cache reportadas pelo
                  provedor e registros locais importados.
                </p>
              )}
            </div>

            {provedores.some((p) => p.cli_detectado) && (
              <div className="text-[11px] text-[#6A6A6A] pt-1">
                Runtimes detectados:{" "}
                {provedores
                  .filter((p) => p.cli_detectado)
                  .map((p) => `${p.rotulo} (${p.cli_versao ?? "CLI"})`)
                  .join(" · ")}
              </div>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
};
