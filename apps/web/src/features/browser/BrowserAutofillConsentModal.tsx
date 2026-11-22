import React, { useState } from "react";
import type { BrowserAutofillConsentRequest } from "@criativo/contracts";
import { KeyRound, ShieldCheck, X } from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";

export const BrowserAutofillConsentModal: React.FC<{
  request: BrowserAutofillConsentRequest | null;
  onResolve: (payload: {
    requestId: string;
    approved: boolean;
    selectedLoginId?: string;
  }) => Promise<void>;
}> = ({ request, onResolve }) => {
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  if (!request) return null;

  const activeLoginId = selectedId || request.candidates[0]?.id || "";
  const candidateOptions = request.candidates.map((cand) => ({
    value: cand.id,
    label: `${cand.title} (${cand.username} · ${cand.source})`,
  }));

  const handleDecision = async (approved: boolean) => {
    setBusy(true);
    try {
      await onResolve({
        requestId: request.requestId,
        approved,
        selectedLoginId: approved ? activeLoginId : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Consentimento humano para autopreenchimento de login"
      data-testid="browser-autofill-consent-modal"
      className="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-[460px] rounded-2xl bg-[#212121] border border-white/15 shadow-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-[#42A0FF]/15 text-[#42A0FF] flex items-center justify-center shrink-0">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-white">
              Autorizar autopreenchimento de login
            </h3>
            <p className="text-[12.5px] text-[#979797] mt-0.5">
              Um agente solicitou o preenchimento direto da credencial em{" "}
              <span className="font-mono text-white">{request.domain}</span>. A senha permanece
              oculta do modelo de IA.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11.5px] font-medium text-[#DCDCDC]">
            Credencial selecionada
          </span>
          <CarbonSelect
            ariaLabel="Selecionar credencial para autopreenchimento"
            value={activeLoginId}
            options={candidateOptions}
            onChange={(val) => setSelectedId(val)}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDecision(false)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2A2A2A] hover:bg-[#333333] px-3.5 py-2 text-[12.5px] font-semibold text-[#F0F0F0] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            <span>Recusar</span>
          </button>
          <button
            type="button"
            disabled={busy || !activeLoginId}
            onClick={() => void handleDecision(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#31CF76] hover:opacity-90 px-4 py-2 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{busy ? "Preenchendo..." : "Autorizar e preencher"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
