import React, { useEffect, useState } from "react";
import type {
  EditorialPostFormato,
  MetaPostingIntelligenceReport,
} from "@criativo/contracts";
import { Award, CalendarPlus, ChevronDown, ChevronUp, Clock, Sparkles } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

export interface EditorialBestTimesBarProps {
  initialReport?: MetaPostingIntelligenceReport | null;
  onApplyRecommendation: (dataIso: string, formato: EditorialPostFormato) => void;
}

const FORMAT_LABELS: Record<EditorialPostFormato, string> = {
  carrossel: "Carrossel",
  reels: "Reels",
  feed_4_5: "Feed 4:5",
  story: "Story",
};

/**
 * Faixa compacta colapsável de recomendação de melhores horários e preenchimento rápido no Calendário Editorial (META42-03).
 */
export const EditorialBestTimesBar: React.FC<EditorialBestTimesBarProps> = ({
  initialReport,
  onApplyRecommendation,
}) => {
  const [report, setReport] = useState<MetaPostingIntelligenceReport | null>(initialReport ?? null);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(!initialReport);

  useEffect(() => {
    if (initialReport) {
      setReport(initialReport);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    setLoading(true);
    void daemonApi
      .getPostingIntelligence({ periodo: "30d", timezone })
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch(() => {
        // Silencioso no calendário caso ainda não haja dados ou backend offline
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialReport]);

  if (loading || !report) return null;

  const top3 = report.melhores_horarios.slice(0, 3);
  const champion = report.formatos_campeoes.find((f) => f.campeao) ?? report.formatos_campeoes[0];
  const slot = report.proximo_slot_sugerido;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#141414] px-4 py-3 text-[#F0F0F0]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#31CF76]" />
          <span className="text-xs font-semibold text-white">
            Melhores Horários & Formato Campeão
          </span>
          {champion && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
              <Award className="h-3 w-3" />
              {FORMAT_LABELS[champion.editorial_formato]}
            </span>
          )}
          <span className="text-[11px] text-[#979797]">({report.timezone})</span>
        </div>

        <div className="flex items-center gap-2">
          {slot && (
            <button
              type="button"
              onClick={() => onApplyRecommendation(slot.data_agendada, slot.formato_recomendado)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#42A0FF] px-3 py-1.5 text-xs font-semibold text-[#0D0D0D] hover:bg-[#66B2FF]"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              <span>Agendar no melhor horário</span>
            </button>
          )}
          <button
            type="button"
            aria-label={expanded ? "Recolher melhores horários" : "Expandir melhores horários"}
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded-lg border border-white/10 bg-[#1A1A1A] p-1.5 text-[#979797] hover:text-white"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5 text-xs">
          {top3.length === 0 ? (
            <p className="text-[11.5px] text-[#979797]">
              Sincronize sua Galeria IG para liberar recomendações automáticas de horários e formatos campeões.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {top3.map((h) => (
                <span
                  key={`${h.dia_semana}-${h.hora}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#1A1A1A] px-2.5 py-1 text-[11px] text-[#DCDCDC]"
                >
                  <Clock className="h-3 w-3 text-[#42A0FF]" />
                  <span className="font-medium text-white">{h.faixa_label}</span>
                  <span className="text-[#979797]">score {h.score_medio}</span>
                </span>
              ))}
            </div>
          )}

          {slot && (
            <p className="text-[11px] text-[#979797]">
              Próximo slot livre:{" "}
              <span className="font-semibold text-white">
                {slot.dia_label} {slot.data_agendada} às {slot.hora_sugerida}
              </span>{" "}
              ({FORMAT_LABELS[slot.formato_recomendado]})
            </p>
          )}
        </div>
      )}
    </div>
  );
};
