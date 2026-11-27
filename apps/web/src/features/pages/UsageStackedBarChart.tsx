import React, { useMemo, useState } from "react";
import type { GranularidadeAnalyticsUso, PontoDiarioUso, PontoSerieTemporalUso } from "@criativo/contracts";
import { formatBucketCompactValue, formatCompactTokensPt, formatUsdPt, resolveProviderChartColor } from "./usage-chart-helpers";

interface UsageStackedBarChartProps {
  series?: PontoSerieTemporalUso[];
  fallbackDaily?: PontoDiarioUso[];
  activeGranularity: "auto" | GranularidadeAnalyticsUso;
  resolvedGranularity?: GranularidadeAnalyticsUso;
  onChangeGranularity?: (granularidade: "auto" | GranularidadeAnalyticsUso) => void;
  dimmed?: boolean;
  onOpenDailyTab?: () => void;
}

const GRANULARITY_BUTTONS: Array<{ key: "auto" | GranularidadeAnalyticsUso; label: string }> = [
  { key: "auto", label: "Auto" },
  { key: "diario", label: "Diário" },
  { key: "semanal", label: "Semanal" },
  { key: "mensal", label: "Mensal" },
];

const GRANULARITY_TITLE: Record<GranularidadeAnalyticsUso, string> = {
  diario: "Uso diário por provedor",
  semanal: "Uso semanal por provedor",
  mensal: "Uso mensal por provedor",
};

/**
 * Gráfico SVG responsivo de barras empilhadas coloridas por provedor,
 * com alternador USD/Tokens, seleção de granularidade, legenda clicável e estado dimmed.
 */
export const UsageStackedBarChart: React.FC<UsageStackedBarChartProps> = ({
  series,
  fallbackDaily = [],
  activeGranularity,
  resolvedGranularity = "diario",
  onChangeGranularity,
  dimmed = false,
  onOpenDailyTab,
}) => {
  const effectiveSeries: PontoSerieTemporalUso[] = useMemo(() => {
    if (series && series.length > 0) return series;
    return fallbackDaily.map((d) => ({
      chave: d.data,
      rotulo: d.rotulo,
      inicio_iso: `${d.data}T00:00:00.000Z`,
      fim_iso: `${d.data}T23:59:59.999Z`,
      tokens: d.tokens,
      custo_usd: d.custo_usd,
      turnos: d.turnos,
      por_provedor:
        d.tokens > 0 || d.custo_usd > 0
          ? [{ provedor: "geral", rotulo: "Total", tokens: d.tokens, custo_usd: d.custo_usd }]
          : [],
    }));
  }, [series, fallbackDaily]);

  const hasAnyUsd = useMemo(() => effectiveSeries.some((item) => item.custo_usd > 0), [effectiveSeries]);
  const [metricOverride, setMetricOverride] = useState<"usd" | "tokens" | null>(null);
  const metricMode: "usd" | "tokens" = metricOverride ?? (hasAnyUsd ? "usd" : "tokens");
  const [isolatedProvider, setIsolatedProvider] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const legendProviders = useMemo(() => {
    const totals = new Map<string, { provedor: string; rotulo: string; total: number }>();
    for (const bucket of effectiveSeries) {
      for (const seg of bucket.por_provedor) {
        const val = metricMode === "usd" ? seg.custo_usd : seg.tokens;
        const prev = totals.get(seg.provedor) ?? { provedor: seg.provedor, rotulo: seg.rotulo, total: 0 };
        prev.total += val;
        totals.set(seg.provedor, prev);
      }
    }
    return [...totals.values()].sort((a, b) => b.total - a.total);
  }, [effectiveSeries, metricMode]);

  const activeIsolatedProvider = useMemo(() => {
    if (!isolatedProvider) return null;
    return legendProviders.some((p) => p.provedor === isolatedProvider) ? isolatedProvider : null;
  }, [isolatedProvider, legendProviders]);

  const maxY = useMemo(() => {
    let maxVal = 0;
    for (const bucket of effectiveSeries) {
      let bucketSum = 0;
      for (const seg of bucket.por_provedor) {
        if (activeIsolatedProvider && seg.provedor !== activeIsolatedProvider) continue;
        bucketSum += metricMode === "usd" ? seg.custo_usd : seg.tokens;
      }
      if (bucketSum > maxVal) maxVal = bucketSum;
    }
    if (metricMode === "usd") return maxVal > 0 ? Math.max(0.1, Math.ceil(maxVal * 10) / 10) : 1;
    return maxVal > 0 ? Math.ceil(maxVal * 1.1) : 1000;
  }, [effectiveSeries, metricMode, activeIsolatedProvider]);

  const svgWidth = 520;
  const svgHeight = 148;
  const padTop = 8;
  const padBottom = 10;
  const plotHeight = svgHeight - padTop - padBottom;

  const bars = useMemo(() => {
    const count = Math.max(1, effectiveSeries.length);
    const slotWidth = svgWidth / count;
    const barWidth = Math.max(3, Math.min(26, slotWidth * 0.68));
    return effectiveSeries.map((bucket, idx) => {
      const x = idx * slotWidth + (slotWidth - barWidth) / 2;
      let currentY = svgHeight - padBottom;
      const segments: Array<{ provedor: string; color: string; x: number; y: number; width: number; height: number }> = [];
      for (const seg of bucket.por_provedor) {
        if (activeIsolatedProvider && seg.provedor !== activeIsolatedProvider) continue;
        const val = metricMode === "usd" ? seg.custo_usd : seg.tokens;
        if (val <= 0) continue;
        const segH = Math.max(1.5, (val / maxY) * plotHeight);
        const segY = Math.max(padTop, currentY - segH);
        segments.push({
          provedor: seg.provedor,
          color: resolveProviderChartColor(seg.provedor),
          x,
          y: segY,
          width: barWidth,
          height: Math.max(0.5, currentY - segY),
        });
        currentY = segY;
      }
      return { idx, slotX: idx * slotWidth, slotWidth, bucket, segments };
    });
  }, [effectiveSeries, activeIsolatedProvider, metricMode, maxY, plotHeight]);

  const xTickIndices = useMemo(() => {
    const len = effectiveSeries.length;
    if (len === 0) return [];
    if (len <= 6) return effectiveSeries.map((_, i) => i);
    const indices = new Set<number>();
    for (let i = 0; i <= 5; i += 1) indices.add(Math.round((i / 5) * (len - 1)));
    return [...indices].sort((a, b) => a - b);
  }, [effectiveSeries]);

  const hoveredBar = hoveredIdx !== null ? bars[hoveredIdx] ?? null : null;

  return (
    <div className="lg:col-span-7 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-[#E5E5E5]">
            {GRANULARITY_TITLE[resolvedGranularity]}
          </span>
          {dimmed && (
            <span className="inline-flex items-center rounded-full bg-[#31CF76]/15 border border-[#31CF76]/30 px-2 py-0.5 text-[10.5px] font-medium text-[#31CF76]">
              Atualizando...
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-lg bg-[#212121] border border-white/[0.06] p-0.5">
            {([{ key: "usd", label: "Custo USD" }, { key: "tokens", label: "Tokens" }] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMetricOverride(opt.key)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  metricMode === opt.key ? "bg-[#2E2E2E] text-white" : "text-[#888] hover:text-[#DCDCDC]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {onChangeGranularity && (
            <div className="inline-flex rounded-lg bg-[#212121] border border-white/[0.06] p-0.5">
              {GRANULARITY_BUTTONS.map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => onChangeGranularity(btn.key)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    activeGranularity === btn.key ? "bg-[#2E2E2E] text-white" : "text-[#888] hover:text-[#DCDCDC]"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}

          {onOpenDailyTab && (
            <button
              type="button"
              onClick={onOpenDailyTab}
              className="text-[11.5px] text-[#787878] hover:text-white transition-colors pl-1"
            >
              Ver tabela
            </button>
          )}
        </div>
      </div>

      <div className={`relative pt-1 transition-opacity duration-200 ${dimmed ? "opacity-55 pointer-events-none" : "opacity-100"}`}>
        <div className="flex gap-3">
          <div className="flex flex-col justify-between text-[10.5px] text-[#787878] tabular-nums py-1 text-right min-w-[58px] h-[156px]">
            <span>{formatBucketCompactValue(maxY, metricMode)}</span>
            <span>{formatBucketCompactValue((maxY * 2) / 3, metricMode)}</span>
            <span>{formatBucketCompactValue(maxY / 3, metricMode)}</span>
            <span>{formatBucketCompactValue(0, metricMode)}</span>
          </div>

          <div className="flex-1 min-w-0">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-[156px] overflow-visible" preserveAspectRatio="none">
              {[padTop, padTop + plotHeight / 3, padTop + (plotHeight * 2) / 3, svgHeight - padBottom].map((yPos, i) => (
                <line
                  key={i}
                  x1="0"
                  y1={yPos}
                  x2={svgWidth}
                  y2={yPos}
                  stroke={i === 3 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"}
                  strokeWidth="1"
                />
              ))}

              {bars.map((bar) => (
                <g
                  key={bar.bucket.chave}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(bar.idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <rect
                    x={bar.slotX}
                    y={padTop}
                    width={bar.slotWidth}
                    height={plotHeight}
                    fill={hoveredIdx === bar.idx ? "rgba(255,255,255,0.04)" : "transparent"}
                    rx="2"
                  />
                  {bar.segments.map((seg) => (
                    <rect
                      key={`${bar.bucket.chave}-${seg.provedor}`}
                      x={seg.x}
                      y={seg.y}
                      width={seg.width}
                      height={seg.height}
                      fill={seg.color}
                      opacity={hoveredIdx !== null && hoveredIdx !== bar.idx ? 0.72 : 0.95}
                      rx="1"
                    />
                  ))}
                </g>
              ))}
            </svg>

            <div className="flex items-center justify-between text-[10.5px] text-[#787878] tracking-wide mt-1">
              {xTickIndices.map((idx) => (
                <span key={idx}>{effectiveSeries[idx]?.rotulo ?? ""}</span>
              ))}
            </div>
          </div>
        </div>

        {legendProviders.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            {legendProviders.map((prov) => {
              const color = resolveProviderChartColor(prov.provedor);
              const isSelected = activeIsolatedProvider === prov.provedor;
              const isMuted = Boolean(activeIsolatedProvider && !isSelected);
              return (
                <button
                  key={prov.provedor}
                  type="button"
                  onClick={() => setIsolatedProvider((curr) => (curr === prov.provedor ? null : prov.provedor))}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] border transition-colors ${
                    isSelected
                      ? "bg-white/10 border-white/25 text-white font-medium"
                      : isMuted
                        ? "bg-[#1B1B1B] border-white/[0.04] text-[#666]"
                        : "bg-[#212121] border-white/[0.07] text-[#C8C8C8] hover:border-white/20"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span>{prov.rotulo}</span>
                </button>
              );
            })}
          </div>
        )}

        {hoveredBar && (
          <div className="mt-2 rounded-xl bg-[#212121] border border-white/[0.08] px-3 py-2 text-[11.5px] text-[#DCDCDC] space-y-1">
            <div className="flex items-center justify-between gap-2 font-medium">
              <span>{hoveredBar.bucket.rotulo} ({hoveredBar.bucket.chave}) · {hoveredBar.bucket.turnos} turnos</span>
              <span className="tabular-nums text-white">
                {formatCompactTokensPt(hoveredBar.bucket.tokens)} tokens · {formatUsdPt(hoveredBar.bucket.custo_usd)}
              </span>
            </div>
            {hoveredBar.bucket.por_provedor.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#B5B5B5]">
                {hoveredBar.bucket.por_provedor.map((seg) => (
                  <span key={seg.provedor} className="inline-flex items-center gap-1.5 tabular-nums">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: resolveProviderChartColor(seg.provedor) }} />
                    <span>{seg.rotulo}:</span>
                    <strong className="text-[#E5E5E5] font-medium">{formatCompactTokensPt(seg.tokens)}</strong>
                    <span>({formatUsdPt(seg.custo_usd)})</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
