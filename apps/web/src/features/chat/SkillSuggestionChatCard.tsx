import React, { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import type { SkillSugestaoItem } from "@criativo/contracts";

export interface SkillSuggestionChatCardProps {
  sugestao: SkillSugestaoItem;
  onSave?: (mensagemId: string) => Promise<void> | void;
  onDismiss?: (mensagemId: string) => Promise<void> | void;
}

/**
 * Cartao de sugestao de auto-aprendizado de habilidade no modo ask (LRN-02).
 * Permite inspecionar instrucoes, gravar/atualizar SKILL.md ou dispensar sugestao.
 */
export function SkillSuggestionChatCard({
  sugestao,
  onSave,
  onDismiss,
}: SkillSuggestionChatCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const isUpdate = sugestao.acao === "update";
  const previewContent =
    sugestao.instrucoes_preview ?? sugestao.pergunta_markdown;

  const handleSave = async (): Promise<void> => {
    if (busy || !onSave) return;
    setBusy(true);
    try {
      await onSave(sugestao.mensagem_id);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async (): Promise<void> => {
    if (busy || !onDismiss) return;
    setBusy(true);
    try {
      await onDismiss(sugestao.mensagem_id);
    } finally {
      setBusy(false);
    }
  };

  if (sugestao.status === "dispensada") {
    return (
      <div className="w-full rounded-[14px] bg-[#1A1A1A] border border-[rgba(255,255,255,0.06)] p-4 flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-[#979797]">{sugestao.nome_skill}</span>
        <span className="text-[12px] font-semibold text-[#979797]">Sugestão dispensada</span>
      </div>
    );
  }

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-full bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#42A0FF]">
          <Sparkles className="w-3.5 h-3.5" />
          {isUpdate ? "Revisão de habilidade existente" : "Nova habilidade sugerida"}
        </span>

        {sugestao.status === "salva" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#101010] px-2 py-1 text-[12px] font-semibold text-[#31CF76]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isUpdate ? "Habilidade atualizada" : "Habilidade gravada"}
          </span>
        )}
      </div>

      <h3 className="text-[14px] font-semibold leading-[1.43] text-[#FFFFFF]">
        {sugestao.nome_skill}
      </h3>
      <p className="text-[14px] font-normal leading-[1.43] text-[#DCDCDC]">
        {sugestao.pergunta_markdown}
      </p>

      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#42A0FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] rounded"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Recolher instruções
            </>
          ) : (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              Expandir instruções
            </>
          )}
        </button>
      </div>

      {expanded && (
        <pre className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.06)] p-4 max-h-60 overflow-y-auto text-[12px] font-normal leading-[1.33] font-terminal text-[#DCDCDC] whitespace-pre-wrap">
          {previewContent}
        </pre>
      )}

      {sugestao.status === "aberta" && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSave()}
            className="openbot-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
          >
            {isUpdate ? "Atualizar habilidade" : "Gravar habilidade"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDismiss()}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
          >
            Dispensar sugestão
          </button>
        </div>
      )}
    </div>
  );
}
