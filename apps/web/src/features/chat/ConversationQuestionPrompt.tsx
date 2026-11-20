import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, HelpCircle } from "lucide-react";
import type {
  AskUserQuestion,
  ConversationUiBlock,
  UiBlockSubmitPayload,
} from "@criativo/contracts";

export interface ConversationQuestionPromptProps {
  bloco: ConversationUiBlock;
  onSubmit: (payload: UiBlockSubmitPayload) => Promise<void> | void;
}

/**
 * Cartao inline bloqueante para coleta estruturada de 1 a 3 respostas em ask_user (CHAT-02).
 * Protege campos isSecret com mascara e remove o segredo da memoria React apos submissao.
 */
export function ConversationQuestionPrompt({
  bloco,
  onSubmit,
}: ConversationQuestionPromptProps): React.ReactElement {
  const questions = useMemo<AskUserQuestion[]>(() => {
    const raw = bloco.spec?.questions;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 3) as AskUserQuestion[];
  }, [bloco.spec]);

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string[]>>({});
  const [customOpenByQuestion, setCustomOpenByQuestion] = useState<Record<string, boolean>>({});
  const [customTextByQuestion, setCustomTextByQuestion] = useState<Record<string, string>>({});
  const [showSecretByQuestion, setShowSecretByQuestion] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  const safeIndex = Math.min(currentIndex, Math.max(0, questions.length - 1));
  const activeQuestion = questions[safeIndex] ?? null;

  useEffect(() => {
    if (!activeQuestion) return;
    if (customOpenByQuestion[activeQuestion.id]) {
      customInputRef.current?.focus();
    }
  }, [activeQuestion, customOpenByQuestion]);

  useEffect(() => {
    if (bloco.status !== "pending" || !activeQuestion || typeof window === "undefined") return;
    const opts = activeQuestion.options ?? [];
    if (opts.length === 0) return;

    const handleKey = (e: KeyboardEvent): void => {
      const targetTag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea") return;
      const upper = e.key.toUpperCase();
      const letterIdx = upper.charCodeAt(0) - 65;
      if (upper.length === 1 && letterIdx >= 0 && letterIdx < opts.length && letterIdx < 9) {
        e.preventDefault();
        const chosen = opts[letterIdx]?.label;
        if (chosen) {
          toggleOption(activeQuestion, chosen);
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeQuestion, bloco.status]);

  const toggleOption = (question: AskUserQuestion, optionLabel: string): void => {
    setCustomOpenByQuestion((prev) => ({ ...prev, [question.id]: false }));
    setSelectedByQuestion((prev) => {
      const cur = prev[question.id] ?? [];
      if (question.multiSelect) {
        return {
          ...prev,
          [question.id]: cur.includes(optionLabel)
            ? cur.filter((item) => item !== optionLabel)
            : [...cur, optionLabel],
        };
      }
      return { ...prev, [question.id]: [optionLabel] };
    });
  };

  const buildAnswersPayload = (): Record<string, string[] | string> => {
    const out: Record<string, string[] | string> = {};
    for (const q of questions) {
      const hasOptions = Array.isArray(q.options) && q.options.length > 0;
      const useCustom = customOpenByQuestion[q.id] || !hasOptions || Boolean(q.isSecret);
      const customVal = (customTextByQuestion[q.id] ?? "").trim();
      const picked = selectedByQuestion[q.id] ?? [];

      if (useCustom && customVal) {
        out[q.id] = q.multiSelect ? [...picked, customVal] : customVal;
      } else if (picked.length > 0) {
        out[q.id] = q.multiSelect ? picked : picked[0]!;
      }
    }
    return out;
  };

  const clearSecretState = (): void => {
    setCustomTextByQuestion((prev) => {
      const next = { ...prev };
      for (const q of questions) {
        if (q.isSecret) {
          delete next[q.id];
        }
      }
      return next;
    });
  };

  const handleSubmitAll = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const answers = buildAnswersPayload();
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao: "answer",
        respostas_ask_user: answers,
      });
      clearSecretState();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkipCurrentOrAll = async (): Promise<void> => {
    if (questions.length > 1 && safeIndex < questions.length - 1) {
      setCurrentIndex((idx) => idx + 1);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao: "skip",
      });
      clearSecretState();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDiscard = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao: "cancel",
      });
      clearSecretState();
    } finally {
      setSubmitting(false);
    }
  };

  if (bloco.status !== "pending") {
    const persistedAnswers =
      bloco.estado?.answers && typeof bloco.estado.answers === "object"
        ? (bloco.estado.answers as Record<string, unknown>)
        : {};
    const wasAnswered = bloco.status === "answered";

    return (
      <div className="w-full rounded-[14px] bg-[#1A1A1A] border border-[rgba(255,255,255,0.06)] p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold leading-[1.33] text-[#31CF76]">
            {wasAnswered ? "Respostas registradas" : "Questionário ignorado"}
          </span>
        </div>
        {wasAnswered &&
          questions.map((q) => {
            const rawVal = persistedAnswers[q.id];
            const displayVal = q.isSecret
              ? "Valor secreto enviado com segurança"
              : Array.isArray(rawVal)
                ? rawVal.join(", ")
                : typeof rawVal === "string" && rawVal
                  ? rawVal
                  : "—";
            return (
              <div key={q.id} className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-[#979797]">{q.question}</span>
                <span className="text-[14px] font-normal text-[#DCDCDC]">{displayVal}</span>
              </div>
            );
          })}
      </div>
    );
  }

  if (!activeQuestion) {
    return <div className="hidden" />;
  }

  const options = activeQuestion.options ?? [];
  const selectedForActive = selectedByQuestion[activeQuestion.id] ?? [];
  const showCustomInput =
    Boolean(activeQuestion.isSecret) ||
    options.length === 0 ||
    Boolean(customOpenByQuestion[activeQuestion.id]);
  const showSecret = Boolean(showSecretByQuestion[activeQuestion.id]);

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 border-l-[#007CF7] p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#42A0FF]" />
          <span className="rounded-full bg-[#242424] px-2 py-1 text-[12px] font-semibold leading-[1.33] text-[#42A0FF]">
            Aguardando resposta
          </span>
          {questions.length > 1 && (
            <span className="rounded-full bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold leading-[1.33] text-[#FFFFFF]">
              {safeIndex + 1} de {questions.length}
            </span>
          )}
        </div>

        {questions.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safeIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-1 rounded-md bg-[#242424] hover:bg-[#2A2A2A] disabled:opacity-40 px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Voltar pergunta
            </button>
            <button
              type="button"
              disabled={safeIndex >= questions.length - 1}
              onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
              className="inline-flex items-center gap-1 rounded-md bg-[#242424] hover:bg-[#2A2A2A] disabled:opacity-40 px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              Avançar pergunta
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {activeQuestion.header && (
          <span className="text-[12px] font-semibold uppercase tracking-wide text-[#979797]">
            {activeQuestion.header}
          </span>
        )}
        <h3 className="text-[14px] font-semibold leading-[1.43] text-[#FFFFFF]">
          {activeQuestion.question}
        </h3>
        {activeQuestion.detail && (
          <p className="text-[12px] font-normal leading-[1.33] text-[#979797]">
            {activeQuestion.detail}
          </p>
        )}
      </div>

      {options.length > 0 && !activeQuestion.isSecret && (
        <div className="flex flex-col gap-2">
          {options.map((opt, idx) => {
            const isSelected = selectedForActive.includes(opt.label);
            const shortcutLetter = String.fromCharCode(65 + idx);
            return (
              <button
                key={`${activeQuestion.id}-${opt.label}`}
                type="button"
                onClick={() => toggleOption(activeQuestion, opt.label)}
                style={
                  isSelected
                    ? { backgroundColor: "rgba(0, 124, 247, 0.14)", borderColor: "#007CF7" }
                    : undefined
                }
                className={`w-full text-left rounded-lg px-4 py-2 border transition-colors flex items-start justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                  isSelected
                    ? "border-[#007CF7]"
                    : "bg-[#242424] hover:bg-[#2A2A2A] border-[rgba(255,255,255,0.06)]"
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center rounded bg-[#101010] px-2 py-1 text-[12px] font-semibold text-[#979797] font-terminal shrink-0">
                    {shortcutLetter}
                  </span>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[14px] font-semibold leading-[1.43] text-[#FFFFFF]">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-[12px] font-normal leading-[1.33] text-[#979797]">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`mt-1 w-4 h-4 flex items-center justify-center shrink-0 border ${
                    activeQuestion.multiSelect ? "rounded" : "rounded-full"
                  } ${
                    isSelected
                      ? "bg-[#007CF7] border-[#007CF7] text-[#FFFFFF]"
                      : "border-[rgba(255,255,255,0.12)]"
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3" />}
                </span>
              </button>
            );
          })}

          {!customOpenByQuestion[activeQuestion.id] && (
            <button
              type="button"
              onClick={() =>
                setCustomOpenByQuestion((prev) => ({ ...prev, [activeQuestion.id]: true }))
              }
              className="w-full text-left rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.06)] px-4 py-2 text-[14px] font-normal text-[#DCDCDC]"
            >
              Escrever outra resposta
            </button>
          )}
        </div>
      )}

      {showCustomInput && (
        <div className="flex items-center gap-2">
          <input
            ref={customInputRef}
            type={activeQuestion.isSecret && !showSecret ? "password" : "text"}
            value={customTextByQuestion[activeQuestion.id] ?? ""}
            onChange={(e) =>
              setCustomTextByQuestion((prev) => ({
                ...prev,
                [activeQuestion.id]: e.target.value,
              }))
            }
            placeholder={
              activeQuestion.isSecret
                ? "Digite o valor secreto protegido..."
                : "Digite sua resposta..."
            }
            className="flex-1 rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-normal text-[#FFFFFF] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
          {activeQuestion.isSecret && (
            <button
              type="button"
              onClick={() =>
                setShowSecretByQuestion((prev) => ({
                  ...prev,
                  [activeQuestion.id]: !showSecret,
                }))
              }
              className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[12px] font-semibold text-[#DCDCDC]"
            >
              {showSecret ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  Ocultar valor
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Mostrar valor
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmitAll()}
            className="studio-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            Submeter respostas
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSkipCurrentOrAll()}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
          >
            Pular pergunta
          </button>
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleDiscard()}
          className="rounded-lg bg-transparent hover:bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#979797]"
        >
          Descartar questionário
        </button>
      </div>
    </div>
  );
}
