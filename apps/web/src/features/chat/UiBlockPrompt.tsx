import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import type {
  AskUiBlockSpec,
  ConversationUiBlock,
  UiBlockAction,
  UiBlockFieldOption,
  UiBlockFormField,
  UiBlockSubmitPayload,
} from "@criativo/contracts";
import { UiHoldButton } from "./UiHoldButton";

export interface UiBlockPromptProps {
  bloco: ConversationUiBlock;
  onSubmit: (payload: UiBlockSubmitPayload) => Promise<void> | void;
}

/**
 * Renderizador discriminado de cartoes interativos ask_ui (CHAT-02).
 * Suporta confirm (com UiHoldButton), quick_replies, choice, form (com listbox acessivel customizado),
 * approval e progress/block_run em estrita conformidade com Carbon Dark.
 */
export function UiBlockPrompt({
  bloco,
  onSubmit,
}: UiBlockPromptProps): React.ReactElement {
  const spec = bloco.spec as unknown as Partial<AskUiBlockSpec> & Record<string, unknown>;
  const variant =
    (typeof spec.variant === "string"
      ? spec.variant
      : typeof spec.type === "string"
        ? spec.type
        : "confirm") as AskUiBlockSpec["variant"];
  const title = typeof spec.title === "string" ? spec.title : "Confirmação Necessária";
  const description = typeof spec.description === "string" ? spec.description : "";
  const markdownPreview =
    typeof spec.markdownPreview === "string"
      ? spec.markdownPreview
      : typeof spec.preview === "string"
        ? spec.preview
        : "";
  const isDanger = Boolean(spec.danger);

  const fields = useMemo<UiBlockFormField[]>(() => {
    if (!Array.isArray(spec.fields)) return [];
    return spec.fields.slice(0, 20) as UiBlockFormField[];
  }, [spec.fields]);

  const choiceOptions = useMemo<UiBlockFieldOption[]>(() => {
    if (!Array.isArray(spec.options)) return [];
    return spec.options as UiBlockFieldOption[];
  }, [spec.options]);

  const actions = useMemo<UiBlockAction[]>(() => {
    if (!Array.isArray(spec.actions)) return [];
    return spec.actions.slice(0, 4) as UiBlockAction[];
  }, [spec.actions]);

  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    if (Array.isArray(spec.fields)) {
      for (const f of spec.fields as UiBlockFormField[]) {
        if (f && f.defaultValue !== undefined) {
          init[f.name] = f.defaultValue;
        } else if (f && (f.type === "toggle" || f.type === "checkbox")) {
          init[f.name] = false;
        } else if (f) {
          init[f.name] = "";
        }
      }
    }
    return init;
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const dispatchAction = async (
    actionId: string,
    values?: Record<string, unknown>,
    acao: "answer" | "cancel" = "answer",
  ): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao,
        ui_response: {
          actionId,
          ...(values ? { values } : {}),
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (bloco.status !== "pending") {
    const answered = bloco.status === "answered";
    const feedbackLabel =
      variant === "approval"
        ? answered
          ? "Plano aprovado para execução"
          : "Plano abortado"
        : variant === "form"
          ? answered
            ? "Formulário registrado"
            : "Bloco descartado"
          : variant === "choice"
            ? answered
              ? "Seleção registrada"
              : "Bloco descartado"
            : answered
              ? "Ação aprovada"
              : "Ação recusada";

    return (
      <div className="w-full rounded-[14px] bg-[#1A1A1A] border border-[rgba(255,255,255,0.06)] p-4 flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-[#DCDCDC]">{title}</span>
        <span
          className={`text-[12px] font-semibold ${
            answered ? "text-[#31CF76]" : "text-[#979797]"
          }`}
        >
          {feedbackLabel}
        </span>
      </div>
    );
  }

  // Variante progress / block_run
  if (variant === "progress" || variant === "block_run") {
    const stepsList = Array.isArray(spec.steps) ? (spec.steps as Array<{ label?: string; done?: boolean } | string>) : [];
    return (
      <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-[#42A0FF] animate-spin" />
          <h3 className="text-[14px] font-semibold text-[#FFFFFF]">{title}</h3>
        </div>
        {stepsList.length > 0 && (
          <div className="flex flex-col gap-2">
            {stepsList.map((st, idx) => {
              const label = typeof st === "string" ? st : st.label ?? `Etapa ${idx + 1}`;
              const done = typeof st === "object" && Boolean(st.done);
              return (
                <div key={`prog-${idx}`} className="flex items-center gap-2 text-[14px]">
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-[#31CF76] shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-[#42A0FF] animate-spin shrink-0" />
                  )}
                  <span className={done ? "text-[#31CF76]" : "text-[#DCDCDC]"}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Variante quick_replies
  if (variant === "quick_replies") {
    const quickItems =
      choiceOptions.length > 0
        ? choiceOptions
        : actions.map((a) => ({ value: a.id, label: a.label }));
    return (
      <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 border-l-[#007CF7] p-4 flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[#FFFFFF]">{title}</h3>
        {description && <p className="text-[14px] font-normal text-[#DCDCDC]">{description}</p>}
        <div className="flex flex-wrap gap-2">
          {quickItems.map((item) => (
            <button
              key={item.value}
              type="button"
              disabled={submitting}
              onClick={() => void dispatchAction(item.value, { reply: item.label })}
              className="rounded-full bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF]"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Variante choice
  if (variant === "choice") {
    const isMulti = Boolean(spec.multiSelect);
    const toggleChoice = (val: string): void => {
      setSelectedChoices((prev) =>
        isMulti
          ? prev.includes(val)
            ? prev.filter((v) => v !== val)
            : [...prev, val]
          : [val],
      );
    };

    return (
      <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 border-l-[#007CF7] p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-semibold text-[#FFFFFF]">{title}</h3>
          {description && <p className="text-[14px] font-normal text-[#DCDCDC]">{description}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {choiceOptions.map((opt) => {
            const active = selectedChoices.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleChoice(opt.value)}
                style={
                  active
                    ? { backgroundColor: "rgba(0, 124, 247, 0.14)", borderColor: "#007CF7" }
                    : undefined
                }
                className={`rounded-lg p-4 text-left border flex items-start justify-between gap-2 ${
                  active
                    ? "border-[#007CF7]"
                    : "bg-[#242424] hover:bg-[#2A2A2A] border-[rgba(255,255,255,0.06)]"
                }`}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold text-[#FFFFFF]">{opt.label}</span>
                  {opt.description && (
                    <span className="text-[12px] font-normal text-[#979797]">{opt.description}</span>
                  )}
                </div>
                {active && <Check className="w-4 h-4 text-[#007CF7] shrink-0" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <button
            type="button"
            disabled={submitting || selectedChoices.length === 0}
            onClick={() => void dispatchAction("apply_choice", { selected: selectedChoices })}
            className="studio-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-40"
          >
            Aplicar seleção
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void dispatchAction("discard", {}, "cancel")}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
          >
            Descartar bloco
          </button>
        </div>
      </div>
    );
  }

  // Variante form (com listbox acessivel customizado para campos de selecao)
  if (variant === "form") {
    const handleFormSubmit = async (): Promise<void> => {
      for (const field of fields) {
        if (field.required) {
          const val = formValues[field.name];
          if (val === undefined || val === null || String(val).trim() === "") {
            setFormError(`Preencha o campo obrigatório "${field.label}".`);
            return;
          }
        }
      }
      setFormError(null);
      await dispatchAction("submit_form", formValues);
    };

    return (
      <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 border-l-[#007CF7] p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-semibold text-[#FFFFFF]">{title}</h3>
          {description && <p className="text-[14px] font-normal text-[#DCDCDC]">{description}</p>}
        </div>

        <div className="flex flex-col gap-4">
          {fields.map((field) => {
            const val = formValues[field.name];

            if (field.type === "select") {
              const opts = field.options ?? [];
              const currentStr = String(val ?? "");
              return (
                <div key={field.name} className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-[#DCDCDC]">{field.label}</span>
                  <div
                    role="listbox"
                    aria-label={field.label}
                    className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] p-1 flex flex-col gap-1"
                  >
                    {opts.map((opt) => {
                      const active = currentStr === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() =>
                            setFormValues((prev) => ({ ...prev, [field.name]: opt.value }))
                          }
                          style={
                            active
                              ? { backgroundColor: "rgba(0, 124, 247, 0.14)", borderColor: "#007CF7" }
                              : undefined
                          }
                          className={`w-full text-left rounded-md px-4 py-2 text-[14px] flex items-center justify-between border ${
                            active
                              ? "font-semibold text-[#FFFFFF] border-[#007CF7]"
                              : "font-normal text-[#DCDCDC] border-transparent hover:bg-[#242424]"
                          }`}
                        >
                          <span>{opt.label}</span>
                          {active && <Check className="w-4 h-4 text-[#007CF7]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (field.type === "toggle" || field.type === "checkbox") {
              const checked = Boolean(val);
              return (
                <label
                  key={field.name}
                  className="flex items-center justify-between gap-2 rounded-lg bg-[#242424] px-4 py-2 cursor-pointer"
                >
                  <span className="text-[14px] font-normal text-[#FFFFFF]">{field.label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.name]: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#007CF7]"
                  />
                </label>
              );
            }

            if (field.type === "textarea") {
              return (
                <div key={field.name} className="flex flex-col gap-1">
                  <label className="text-[12px] font-semibold text-[#DCDCDC]">{field.label}</label>
                  <textarea
                    rows={3}
                    value={String(val ?? "")}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] text-[#FFFFFF] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                  />
                </div>
              );
            }

            return (
              <div key={field.name} className="flex flex-col gap-1">
                <label className="text-[12px] font-semibold text-[#DCDCDC]">{field.label}</label>
                <input
                  type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                  min={field.min}
                  max={field.max}
                  value={String(val ?? "")}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setFormValues((prev) => ({
                      ...prev,
                      [field.name]:
                        field.type === "number" ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] text-[#FFFFFF] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                />
              </div>
            );
          })}
        </div>

        {formError && (
          <p className="text-[12px] font-semibold text-[#FD2F3B]">{formError}</p>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleFormSubmit()}
            className="studio-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
          >
            Submeter formulário
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void dispatchAction("discard", {}, "cancel")}
            className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
          >
            Descartar bloco
          </button>
        </div>
      </div>
    );
  }

  // Variante approval (revisao de plano estruturado)
  if (variant === "approval") {
    const planSteps = Array.isArray(spec.steps) ? (spec.steps as string[]) : [];
    const hasAlternative = Boolean(spec.alternativeLabel) || actions.some((a) => a.id === "alternative");
    return (
      <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 border-l-[#007CF7] p-4 flex flex-col gap-4">
        <h3 className="text-[20px] font-semibold leading-[1.4] text-[#FFFFFF]">{title}</h3>
        {description && <p className="text-[14px] font-normal text-[#DCDCDC]">{description}</p>}
        {planSteps.length > 0 && (
          <ol className="flex flex-col gap-2 list-decimal list-inside text-[14px] text-[#DCDCDC]">
            {planSteps.map((s, idx) => (
              <li key={`ap-${idx}`}>{s}</li>
            ))}
          </ol>
        )}
        {markdownPreview && (
          <pre className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.06)] p-4 text-[12px] font-terminal text-[#DCDCDC] whitespace-pre-wrap">
            {markdownPreview}
          </pre>
        )}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void dispatchAction("start")}
            className="studio-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
          >
            Iniciar plano
          </button>
          {hasAlternative && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void dispatchAction("alternative")}
              className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
            >
              Executar alternativa
            </button>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() => void dispatchAction("abort", {}, "cancel")}
            className="rounded-lg bg-transparent hover:bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#FD2F3B]"
          >
            Abortar plano
          </button>
        </div>
      </div>
    );
  }

  // Variante padrao confirm (+ confirmHold)
  const primaryAction = actions[0];
  const tone: "default" | "primary" | "warning" | "danger" =
    isDanger || primaryAction?.tone === "danger"
      ? "danger"
      : primaryAction?.tone === "warning"
        ? "warning"
        : "primary";

  const borderLeftClass =
    tone === "danger"
      ? "border-l-[#FD2F3B]"
      : tone === "warning"
        ? "border-l-[#FF9412]"
        : "border-l-[#007CF7]";

  const rawHold = primaryAction?.confirmHold ?? spec.confirmHold;
  const requiresHold = isDanger || Boolean(rawHold);
  const holdDuration =
    typeof rawHold === "object" && rawHold && typeof (rawHold as { durationMs?: unknown }).durationMs === "number"
      ? (rawHold as { durationMs: number }).durationMs
      : undefined;

  return (
    <div
      className={`w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 ${borderLeftClass} p-4 flex flex-col gap-4`}
    >
      <div className="flex items-start gap-2">
        {tone === "danger" ? (
          <ShieldAlert className="w-5 h-5 text-[#FD2F3B] shrink-0" />
        ) : tone === "warning" ? (
          <AlertTriangle className="w-5 h-5 text-[#FF9412] shrink-0" />
        ) : null}
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-semibold leading-[1.43] text-[#FFFFFF]">{title}</h3>
          {description && (
            <p className="text-[14px] font-normal leading-[1.43] text-[#DCDCDC]">{description}</p>
          )}
        </div>
      </div>

      {markdownPreview && (
        <pre className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.06)] p-4 text-[12px] font-normal leading-[1.33] font-terminal text-[#DCDCDC] whitespace-pre-wrap overflow-x-auto">
          {markdownPreview}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[rgba(255,255,255,0.06)]">
        {requiresHold ? (
          <UiHoldButton
            label="Segurar para aprovar"
            durationMs={holdDuration}
            tone={tone}
            disabled={submitting}
            onConfirmed={() => void dispatchAction(primaryAction?.id ?? "confirm")}
          />
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void dispatchAction(primaryAction?.id ?? "confirm")}
            className="studio-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
          >
            Aprovar ação
          </button>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void dispatchAction("reject", {}, "cancel")}
          className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
        >
          Recusar ação
        </button>
      </div>
    </div>
  );
}
