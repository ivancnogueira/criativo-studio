import React, { useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react";
import type {
  ConversationUiBlock,
  RequestApiKeyBlockSpec,
  UiBlockSubmitPayload,
} from "@criativo/contracts";

export interface ApiKeyRequestCardProps {
  bloco: ConversationUiBlock;
  onSubmit: (payload: UiBlockSubmitPayload) => Promise<void> | void;
}

/**
 * Cartao seguro para captura de API key diretamente para o Cofre AES-256-GCM (CHAT-02).
 * Nunca expoe o segredo no historico persistido e remove o input da arvore DOM apos gravacao.
 */
export function ApiKeyRequestCard({
  bloco,
  onSubmit,
}: ApiKeyRequestCardProps): React.ReactElement {
  const spec = bloco.spec as unknown as Partial<RequestApiKeyBlockSpec> & Record<string, unknown>;
  const keyName = typeof spec.name === "string" ? spec.name : "CHAVE_INTEGRACAO_EXEMPLO";
  const label = typeof spec.label === "string" ? spec.label : `Configurar ${keyName}`;
  const description = typeof spec.description === "string" ? spec.description : "";
  const placeholder =
    typeof spec.placeholder === "string" ? spec.placeholder : "Cole o segredo de API aqui...";

  const [scope, setScope] = useState<"todos_agentes" | "agente_especifico">(
    spec.defaultScope === "agente_especifico" ? "agente_especifico" : "todos_agentes",
  );
  const [secretValue, setSecretValue] = useState<string>("");
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSaveToVault = async (): Promise<void> => {
    const trimmed = secretValue.trim();
    if (!trimmed) {
      setErrorMsg("Digite o valor da chave antes de gravar no Cofre.");
      return;
    }
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao: "answer",
        api_key_payload: {
          nome: keyName,
          valor: trimmed,
          escopo: scope,
        },
      });
      // Limpa imediatamente o valor em memoria React apos confirmacao
      setSecretValue("");
      setShowSecret(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Não foi possível gravar a chave no Cofre.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleIgnore = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      setSecretValue("");
      await onSubmit({
        bloco_id: bloco.bloco_id,
        canal_id: bloco.canal_id,
        acao: "skip",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (bloco.status === "answered") {
    const savedScope =
      bloco.estado?.values &&
      typeof bloco.estado.values === "object" &&
      (bloco.estado.values as { scope?: string }).scope === "agente_especifico"
        ? "Exclusiva do agente"
        : "Cofre global";

    return (
      <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#42A0FF] shrink-0" />
          <span className="text-[14px] font-semibold font-terminal text-[#FFFFFF]">{keyName}</span>
          <span className="rounded-full bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#979797]">
            {savedScope}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#101010] px-4 py-1 text-[12px] font-semibold text-[#31CF76]">
          <CheckCircle2 className="w-4 h-4" />
          Chave protegida no Cofre
        </span>
      </div>
    );
  }

  if (bloco.status !== "pending") {
    return (
      <div className="w-full rounded-[14px] bg-[#1A1A1A] border border-[rgba(255,255,255,0.06)] p-4 flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold font-terminal text-[#DCDCDC]">{keyName}</span>
        <span className="text-[12px] font-semibold text-[#979797]">Solicitação ignorada</span>
      </div>
    );
  }

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] border-l-4 border-l-[#007CF7] p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#42A0FF] shrink-0" />
          <span className="text-[14px] font-semibold font-terminal text-[#FFFFFF]">{keyName}</span>
        </div>
        <span className="rounded-full bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#979797]">
          {scope === "agente_especifico" ? "Exclusiva do agente" : "Cofre global"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-[#FFFFFF]">{label}</span>
        {description && (
          <p className="text-[14px] font-normal text-[#DCDCDC]">{description}</p>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Escopo da chave no Cofre"
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={scope === "todos_agentes"}
          onClick={() => setScope("todos_agentes")}
          style={
            scope === "todos_agentes"
              ? { backgroundColor: "rgba(0, 124, 247, 0.14)", borderColor: "#007CF7" }
              : undefined
          }
          className={`rounded-lg px-4 py-2 text-left text-[12px] font-semibold border ${
            scope === "todos_agentes"
              ? "text-[#FFFFFF] border-[#007CF7]"
              : "bg-[#242424] hover:bg-[#2A2A2A] text-[#DCDCDC] border-[rgba(255,255,255,0.06)]"
          }`}
        >
          Cofre global (todos os agentes)
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scope === "agente_especifico"}
          onClick={() => setScope("agente_especifico")}
          style={
            scope === "agente_especifico"
              ? { backgroundColor: "rgba(0, 124, 247, 0.14)", borderColor: "#007CF7" }
              : undefined
          }
          className={`rounded-lg px-4 py-2 text-left text-[12px] font-semibold border ${
            scope === "agente_especifico"
              ? "text-[#FFFFFF] border-[#007CF7]"
              : "bg-[#242424] hover:bg-[#2A2A2A] text-[#DCDCDC] border-[rgba(255,255,255,0.06)]"
          }`}
        >
          Exclusiva deste agente
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type={showSecret ? "text" : "password"}
          value={secretValue}
          onChange={(e) => setSecretValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="flex-1 rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-normal font-terminal text-[#FFFFFF] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        />
        <button
          type="button"
          onClick={() => setShowSecret((v) => !v)}
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
      </div>

      {errorMsg && <p className="text-[12px] font-semibold text-[#FD2F3B]">{errorMsg}</p>}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[rgba(255,255,255,0.06)]">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleSaveToVault()}
          className="openbot-btn-primary rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] disabled:opacity-50"
        >
          Gravar chave no Cofre
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleIgnore()}
          className="rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#DCDCDC]"
        >
          Ignorar solicitação
        </button>
      </div>
    </div>
  );
}
