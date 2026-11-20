import React, { useMemo, useState } from "react";
import type {
  AgenteRegistro,
  LinhaDetalheUso,
  ProvedorStatusInfo,
  RelatorioAnalyticsHost,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import { ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";

interface UsageMetricsPageProps {
  uso: UsoProvedoresSnapshot | null;
  provedores: ProvedorStatusInfo[];
  onRefresh: () => Promise<void>;
  analytics?: RelatorioAnalyticsHost | null;
  agentes?: AgenteRegistro[];
  periodoDias?: number;
  agenteFiltroId?: string | null;
  onChangeFilters?: (dias: number, agenteId: string | null) => Promise<void>;
}

type DetailTabKey = "modelo" | "agente" | "dia" | "habilidade";

function formatCompactTokensPt(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe === 0) return "0";
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mi`;
  }
  if (safe >= 1_000) {
    return `${(safe / 1_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mil`;
  }
  return safe.toLocaleString("pt-BR");
}

function formatUsdPt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return "Indisponível";
  }
  return `US$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTimePt(iso: string | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function providerAccentDot(provedor: string): string {
  const lower = provedor.toLowerCase();
  if (lower.includes("claude")) return "#D97757";
  if (lower.includes("openai") || lower.includes("codex") || lower.includes("gpt")) return "#74AA9C";
  if (lower.includes("opencode")) return "#31CF76";
  if (lower.includes("grok")) return "#DCDCDC";
  if (lower.includes("ollama")) return "#A3B8FF";
  return "#7C8CFF";
}

function inferProviderFromModelOrAgent(nameOrProvider: string | null | undefined): "gemini" | "claude" | "openai" | "opencode" | "grok" | "ollama" {
  const lower = (nameOrProvider ?? "").toLowerCase();
  if (lower.includes("opencode") || lower.endsWith("-free") || lower.includes("big-pickle")) return "opencode";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gpt") || lower.includes("codex") || lower.includes("openai")) return "openai";
  if (lower.includes("grok")) return "grok";
  if (lower.includes("ollama") || lower.includes("llama") || lower.includes("qwen")) return "ollama";
  return "gemini";
}

const PERIOD_OPTIONS: Array<{ dias: number; rotulo: string }> = [
  { dias: 7, rotulo: "Últimos 7 dias" },
  { dias: 30, rotulo: "Últimos 30 dias" },
  { dias: 90, rotulo: "Últimos 90 dias" },
  { dias: 3650, rotulo: "Todo o histórico" },
];

/**
 * Página dedicada 'Uso' espelhando o relatório completo de uso:
 * banner de dados parciais, hero USD/Indisponível, gráfico SVG diário, 6 totais e SlidingTabs.
 */
export const UsageMetricsPage: React.FC<UsageMetricsPageProps> = ({
  uso,
  provedores,
  onRefresh,
  analytics,
  agentes = [],
  periodoDias = 30,
  agenteFiltroId = null,
  onChangeFilters,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTabKey>("agente");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [estimatesOpen, setEstimatesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredPointIdx, setHoveredPointIdx] = useState<number | null>(null);

  const report: RelatorioAnalyticsHost = useMemo(() => {
    if (analytics) return analytics;
    const nowIso = new Date().toISOString();
    return {
      periodo_dias: periodoDias,
      agente_id: agenteFiltroId,
      coleta_iniciada_em: nowIso,
      atualizado_em: nowIso,
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
      por_habilidade: [],
    };
  }, [analytics, uso, periodoDias, agenteFiltroId]);

  const totais = report.totais;
  const hasPartialBanner =
    totais.turnos_sem_uso > 0 || totais.registros_sem_preco > 0 || totais.registros_incompletos > 0;

  const hasNonZeroCost = report.por_dia.some((p) => p.custo_usd > 0);
  const maxY = useMemo(() => {
    if (hasNonZeroCost) {
      const m = Math.max(...report.por_dia.map((p) => p.custo_usd), 3);
      return Math.ceil(m);
    }
    return 3;
  }, [report.por_dia, hasNonZeroCost]);

  // Calcula polilinha SVG do gráfico diário (width 440 x height 136)
  const chartGeometry = useMemo(() => {
    const pts = report.por_dia;
    const w = 440;
    const h = 132;
    const padY = 8;
    if (pts.length === 0) {
      return { linePath: `M 0 ${h - padY} L ${w} ${h - padY}`, areaPath: "", points: [] };
    }
    const coords = pts.map((p, idx) => {
      const x = pts.length === 1 ? w : (idx / (pts.length - 1)) * w;
      const ratio = hasNonZeroCost ? Math.min(1, p.custo_usd / maxY) : 0;
      const y = h - padY - ratio * (h - padY * 2);
      return { x, y, point: p };
    });
    const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L ${w} ${h - padY} L 0 ${h - padY} Z`;
    return { linePath, areaPath, points: coords };
  }, [report.por_dia, hasNonZeroCost, maxY]);

  // 4 marcadores de data no eixo X (como no Screenshot 3)
  const xTickIndices = useMemo(() => {
    const len = report.por_dia.length;
    if (len === 0) return [];
    if (len <= 4) return report.por_dia.map((_, i) => i);
    return [0, Math.floor((len - 1) * 0.33), Math.floor((len - 1) * 0.66), len - 1];
  }, [report.por_dia]);

  const tabIndex = ["modelo", "agente", "dia", "habilidade"].indexOf(activeTab);

  const selectedPeriodLabel =
    PERIOD_OPTIONS.find((o) => o.dias === periodoDias)?.rotulo ?? `Últimos ${periodoDias} dias`;
  const selectedAgentLabel = agenteFiltroId
    ? agentes.find((a) => a.agente_id === agenteFiltroId)?.nome ?? agenteFiltroId
    : "Todos os agentes";

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
            Nenhum registro encontrado neste período. Envie uma mensagem em um agente ou importe a telemetria local.
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
                <div className="absolute left-0 mt-1.5 w-44 rounded-xl bg-[#212121] border border-white/10 shadow-2xl p-1 z-30">
                  {PERIOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.dias}
                      type="button"
                      onClick={() => {
                        setPeriodMenuOpen(false);
                        if (onChangeFilters) void onChangeFilters(opt.dias, agenteFiltroId ?? null);
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
                        if (onChangeFilters) void onChangeFilters(periodoDias, null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] transition-colors ${
                        !agenteFiltroId
                          ? "bg-[#31CF76]/15 text-[#31CF76] font-medium"
                          : "text-[#DCDCDC] hover:bg-white/[0.06]"
                      }`}
                    >
                      Todos os agentes
                    </button>
                    {agentes.map((ag) => (
                      <button
                        key={ag.agente_id}
                        type="button"
                        onClick={() => {
                          setAgentMenuOpen(false);
                          if (onChangeFilters) void onChangeFilters(periodoDias, ag.agente_id);
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
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </button>
        </div>

        {/* Banner de dados parciais no topo (topo da página) */}
        {hasPartialBanner && (
          <div className="rounded-xl bg-[#212121] border border-white/[0.07] px-3.5 py-2 text-[12px] text-[#B5B5B5]">
            Dados parciais · {totais.turnos_sem_uso} turnos sem uso informado;{" "}
            {totais.registros_sem_preco} registros sem estimativa de custo;{" "}
            {totais.registros_incompletos} registros com dados de tokens incompletos.
          </div>
        )}

        {/* Grade superior: Hero + lista de provedores à esquerda | Custo diário SVG à direita */}
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
                          style={{ backgroundColor: providerAccentDot(p.provedor) }}
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

          {/* Direita: Custo diário (gráfico SVG limpo estilo Screenshot 3) */}
          <div className="lg:col-span-7 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-[#E5E5E5]">Custo diário</span>
              <button
                type="button"
                onClick={() => setActiveTab("dia")}
                className="text-[12px] text-[#787878] hover:text-white transition-colors"
              >
                Ver dados diários
              </button>
            </div>

            <div className="relative pt-2">
              <div className="flex gap-3">
                {/* Eixo Y */}
                <div className="flex flex-col justify-between text-[11px] text-[#787878] tabular-nums py-1 text-right min-w-[52px] h-[142px]">
                  <span>US$ {maxY.toFixed(2).replace(".", ",")}</span>
                  <span>US$ {((maxY * 2) / 3).toFixed(2).replace(".", ",")}</span>
                  <span>US$ {(maxY / 3).toFixed(2).replace(".", ",")}</span>
                  <span>US$ 0,00</span>
                </div>

                {/* SVG Área / Linha */}
                <div className="flex-1 min-w-0">
                  <svg
                    viewBox="0 0 440 132"
                    className="w-full h-[142px] overflow-visible"
                    preserveAspectRatio="none"
                  >
                    {[8, 49.3, 90.6, 124].map((yPos, i) => (
                      <line
                        key={i}
                        x1="0"
                        y1={yPos}
                        x2="440"
                        y2={yPos}
                        stroke={i === 3 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"}
                        strokeWidth="1"
                      />
                    ))}

                    {chartGeometry.areaPath && (
                      <path d={chartGeometry.areaPath} fill="rgba(124,140,255,0.12)" />
                    )}
                    <path
                      d={chartGeometry.linePath}
                      fill="none"
                      stroke="#9DA3B4"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {chartGeometry.points.map((pt, idx) => (
                      <circle
                        key={pt.point.data}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredPointIdx === idx ? 4.5 : 2.5}
                        fill={pt.point.tokens > 0 ? "#31CF76" : "transparent"}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredPointIdx(idx)}
                        onMouseLeave={() => setHoveredPointIdx(null)}
                      />
                    ))}
                  </svg>

                  {/* Datas eixo X */}
                  <div className="flex items-center justify-between text-[10.5px] text-[#787878] tracking-wide mt-1">
                    {xTickIndices.map((idx) => (
                      <span key={idx}>{report.por_dia[idx]?.rotulo ?? ""}</span>
                    ))}
                  </div>
                </div>
              </div>

              {hoveredPointIdx !== null && chartGeometry.points[hoveredPointIdx] && (
                <div className="mt-1.5 text-[11px] text-[#B5B5B5] text-right">
                  {chartGeometry.points[hoveredPointIdx].point.rotulo}:{" "}
                  <strong className="text-white">
                    {formatCompactTokensPt(chartGeometry.points[hoveredPointIdx].point.tokens)} tokens
                  </strong>{" "}
                  ({chartGeometry.points[hoveredPointIdx].point.turnos} turnos ·{" "}
                  {formatUsdPt(chartGeometry.points[hoveredPointIdx].point.custo_usd)})
                </div>
              )}
            </div>
          </div>
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

        {/* Seção Detalhamento com SlidingTabs (Modelo | Agente | Dia | Habilidade) */}
        <section className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-[#E5E5E5]">Detalhamento</h2>

            {/* SlidingTabs do Criativo Studio */}
            <div className="relative inline-grid grid-cols-4 rounded-xl bg-[#212121] border border-white/[0.06] p-1">
              <div
                aria-hidden="true"
                className="absolute top-1 bottom-1 left-1 w-[calc(25%-2px)] rounded-lg bg-[#2E2E2E] transition-transform duration-200"
                style={{ transform: `translateX(${tabIndex * 100}%)` }}
              />
              {[
                { key: "modelo", label: "Modelo" },
                { key: "agente", label: "Agente" },
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
                        ? "Agente"
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
  );
};
