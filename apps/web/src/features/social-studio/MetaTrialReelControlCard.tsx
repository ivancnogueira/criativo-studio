import React, { useState } from "react";
import type {
  MetaTrialEligibilityResult,
  MetaTrialGraduationStrategy,
} from "@criativo/contracts";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { socialStudioApi } from "../../services/api/social-studio-api";

export interface MetaTrialReelControlCardProps {
  visible: boolean;
  enabled: boolean;
  strategy: MetaTrialGraduationStrategy;
  onChangeEnabled: (enabled: boolean) => void;
  onChangeStrategy: (strategy: MetaTrialGraduationStrategy) => void;
  onCheckEligibility?: () => Promise<MetaTrialEligibilityResult>;
}

const STRATEGY_OPTIONS: Array<{
  value: MetaTrialGraduationStrategy;
  label: string;
  hint: string;
}> = [
  {
    value: "SS_PERFORMANCE",
    label: "Automática por performance",
    hint: "Gradua para seguidores em até 72h conforme retenção e engajamento.",
  },
  {
    value: "MANUAL",
    label: "Manual no app Instagram",
    hint: "Permanece apenas para não seguidores até decisão manual.",
  },
];

/**
 * Painel modular de configuração de Trial Reels (Meta Graph API v27.0).
 * Exibe toggle, estratégia de graduação e verificação de elegibilidade (>= 1.000 seguidores).
 */
export const MetaTrialReelControlCard: React.FC<MetaTrialReelControlCardProps> = ({
  visible,
  enabled,
  strategy,
  onChangeEnabled,
  onChangeStrategy,
  onCheckEligibility,
}) => {
  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState<MetaTrialEligibilityResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  if (!visible) return null;

  const runEligibilityCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = onCheckEligibility
        ? await onCheckEligibility()
        : await socialStudioApi.checkTrialReelEligibility();
      setEligibility(result);
    } catch (err) {
      setCheckError(
        err instanceof Error ? err.message : "Erro ao consultar elegibilidade de Trial Reels."
      );
    } finally {
      setChecking(false);
    }
  };

  const handleToggle = () => {
    const next = !enabled;
    onChangeEnabled(next);
    if (next && !eligibility && !checking) {
      void runEligibilityCheck();
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#1A1A1A] p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-[#42A0FF]" />
          <div>
            <p className="text-xs font-semibold text-white">
              Publicar como Trial Reel (teste com não seguidores)
            </p>
            <p className="text-[11px] text-[#979797]">
              Testa o Reel primeiro fora da base atual antes de exibir no feed principal.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Ativar publicação como Trial Reel"
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            enabled ? "bg-[#31CF76]" : "bg-[#2A2A2A]"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-4.5" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-2 border-t border-white/[0.06] pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-[#DCDCDC]">Estratégia de graduação</span>
            <button
              type="button"
              disabled={checking}
              onClick={() => void runEligibilityCheck()}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#141414] px-2 py-1 text-[10.5px] font-medium text-[#42A0FF] hover:bg-[#212121] disabled:opacity-50"
            >
              {checking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              <span>Checar elegibilidade</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Estratégia de graduação do Trial Reel">
            {STRATEGY_OPTIONS.map((opt) => {
              const active = strategy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChangeStrategy(opt.value)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    active
                      ? "border-[#42A0FF]/70 bg-[#42A0FF]/15 text-white"
                      : "border-white/10 bg-[#141414] text-[#979797] hover:text-white"
                  }`}
                >
                  <span className="block text-[11px] font-semibold">{opt.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-tight text-[#979797]">
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {checkError && (
            <div className="flex items-start gap-1.5 rounded-lg border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-2.5 py-2 text-[11px] text-[#FF8A90]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{checkError}</span>
            </div>
          )}

          {eligibility && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${
                eligibility.eligible
                  ? "border-[#31CF76]/35 bg-[#31CF76]/10 text-[#9CF2BE]"
                  : "border-[#FF9412]/40 bg-[#FF9412]/10 text-[#FFD08A]"
              }`}
            >
              {eligibility.eligible ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#31CF76]" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF9412]" />
              )}
              <div className="space-y-0.5">
                <p className="font-medium">{eligibility.reason}</p>
                {!eligibility.eligible &&
                  typeof eligibility.followers_count === "number" &&
                  eligibility.followers_count < eligibility.min_followers && (
                    <p className="text-[10.5px] opacity-90">
                      Sua conta possui {eligibility.followers_count.toLocaleString("pt-BR")} seguidores
                      (mínimo de {eligibility.min_followers.toLocaleString("pt-BR")} para Trial Reels).
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
