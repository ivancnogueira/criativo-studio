import React, { useEffect, useMemo, useState } from "react";
import { Clock, Info, ShieldAlert } from "lucide-react";
import type {
  AcknowledgeBlockSpec,
  ConversationUiBlock,
  UiBlockSubmitPayload,
} from "@criativo/contracts";

export interface AcknowledgeRequestCardProps {
  bloco: ConversationUiBlock;
  onSubmit: (payload: UiBlockSubmitPayload) => Promise<void> | void;
}

/**
 * Cartao para ciencia explicita de pre-requisitos ou plano previo com timer opcional planStartAfterMs (CHAT-02).
 * Todos os itens de verificacao iniciam desmarcados por padrao.
 */
export function AcknowledgeRequestCard({
  bloco,
  onSubmit,
}: AcknowledgeRequestCardProps): React.ReactElement {
  const spec = bloco.spec as unknown as Partial<AcknowledgeBlockSpec> & Record<string, unknown>;
  const title = typeof spec.title === "string" ? spec.title : "Plano de Execução";
  const summary =
    typeof spec.summaryMarkdown === "string"
      ? spec.summaryMarkdown
      : typeof spec.message === "string"
        ? spec.message
        : "";
  const isWarning = Boolean(spec.warning);
  const hasAlternative = typeof spec.alternativeLabel === "string" && spec.alternativeLabel.trim().length > 0;

  const steps = useMemo<string[]>(() => {
    if (!Array.isArray(spec.steps)) return [];
    return spec.steps.slice(0, 4).map((s) => String(s));
  }, [spec.steps]);

  const [checkedByStep, setCheckedByStep] = useState<Record<number, boolean>>({});
  const [userInteracted, setUserInteracted] = useState<boolean>(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() => {
    if (bloco.auto_responder_em) {
      const diff = Math.ceil((Date.parse(bloco.auto_responder_em) - Date.now()) / 1000);
      return diff > 0 ? diff : null;
    }
    if (typeof spec.planStartAfterMs === "number" && spec.planStartAfterMs > 0) {
      return Math.ceil(spec.planStartAfterMs / 1000);
    }
    return null;
  });
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (bloco.status !== "pending" || userInteracted || remainingSeconds === null || typeof window === "undefined") {
      return;
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bloco.status, remainingSeconds, userInteracted]);

  const handleAction = async (
    actionId: "start" | "alternative" | "cancel",
    acao: "answer" | "cancel",
  ): Promise<void> => {
    if (submitting) return;
    setUserInteracted(true);
    setSubmitting(true);
    try {
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao,
        ui_response: {
          actionId,
          values: {
            acknowledgedSteps: steps.filter((_, idx) => Boolean(checkedByStep[idx])),
          },
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (bloco.status !== "pending") {
    const answered = bloco.status === "answered";
    return (
      <div className="w-full rounded-[14px] bg-[#1A1A1A] border border-[rgba(255,255,255,0.06)] p-4 flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-[#DCDCDC]">{title}</span>
        <span
          className={`text-[12px] font-semibold ${
            answered ? "text-[#31CF76]" : "text-[#979797]"
          }`}
        >
          {answered ? "Requisitos reconhecidos" : "Continuação recusada"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 ${
        isWarning ? "border-l-[#FF9412]" : "border-l-[#007CF7]"
      } p-4 flex flex-col gap-4`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {isWarning ? (
            <ShieldAlert className="w-5 h-5 text-[#FF9412] shrink-0" />
          ) : (
            <Info className="w-5 h-5 text-[#42A0FF] shrink-0" />
          )}
          <h3 className="text-[14px] font-semibold leading-[1.43] text-[#FFFFFF]">{title}</h3>
        </div>

        {!userInteracted && remainingSeconds !== null && remainingSeconds > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#979797]">
            <Clock className="w-3.5 h-3.5" />
            Início automático em {remainingSeconds}s
          </span>
        )}
      </div>

      {summary && (
        <p className="text-[14px] font-normal leading-[1.43] text-[#DCDCDC]">{summary}</p>
      )}

      {steps.length > 0 && (
        <div className="flex flex-col gap-2">
          {steps.map((stepText, idx) => {
            const isChecked = checkedByStep[idx] === true;
            return (
              <label
                key={`ack-step-${idx}`}
                className="flex items-start gap-2 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.06)] px-4 py-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    setUserInteracted(true);
                    setCheckedByStep((prev) => ({ ...prev, [idx]: e.target.checked }));
                  }}
                  className="mt-1 w-4 h-4 accent-[#007CF7] shrink-0"
                />
                <span className="text-[14px] font-normal leading-[1.43] text-[#DCDCDC]">
                  {stepText}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[rgba(255,255,255,0.06)]">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleAction("start", "answer")}
          className="studio-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
        >
          Reconhecer requisitos
        </button>

        {hasAlternative && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleAction("alternative", "answer")}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
          >
            Executar alternativa
          </button>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleAction("cancel", "cancel")}
          className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
        >
          Recusar continuação
        </button>
      </div>
    </div>
  );
}
