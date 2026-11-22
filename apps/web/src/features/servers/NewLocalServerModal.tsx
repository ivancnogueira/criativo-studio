import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Palette,
  X,
} from "lucide-react";
import type {
  ServerQuotaSummary,
  StudioServerRecord,
} from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import { StudioColorPicker } from "../../components/StudioColorPicker";
import {
  SERVER_ACCENT_COLORS,
  isLocalQuotaBlocked,
} from "./server-modals-helpers";

export interface NewLocalServerModalProps {
  open: boolean;
  quota: ServerQuotaSummary | null;
  onClose: () => void;
  onCreated: (server: StudioServerRecord, servers: StudioServerRecord[]) => Promise<void> | void;
  onOpenLicenseSettings?: () => void;
}

export const NewLocalServerModal: React.FC<NewLocalServerModalProps> = ({
  open,
  quota,
  onClose,
  onCreated,
  onOpenLicenseSettings,
}) => {
  const [nome, setNome] = useState("");
  const [corHex, setCorHex] = useState<string>(SERVER_ACCENT_COLORS[0].hex);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setNome("");
      setColorPickerOpen(false);
      setErro(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const quotaCheck = isLocalQuotaBlocked(quota);
  const canSubmit = nome.trim().length >= 2 && !submitting && !quotaCheck.blocked;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErro(null);
    try {
      const res = await daemonApi.criarServidorLocal({
        nome: nome.trim(),
        cor_hex: corHex,
      });
      await onCreated(res.server, res.servers);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar servidor local.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Novo servidor neste computador"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[440px] bg-[#1E1E1E] border border-white/[0.1] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.8)] p-6 text-[#F0F0F0]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-white leading-snug">
              Novo servidor neste computador
            </h2>
            <p className="mt-1.5 text-[13.5px] text-[#9A9A9A] leading-relaxed">
              O servidor tem seus próprios agentes, chats e arquivos. Ele é executado neste computador.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="text-[#8E8E8E] hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="criativo-local-server-name"
              className="block text-[12.5px] font-medium text-[#E5E5E5] mb-1.5"
            >
              Nome do servidor
            </label>
            <input
              id="criativo-local-server-name"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Cliente Acme, Clínica Estética..."
              disabled={submitting}
              autoFocus
              className="w-full rounded-xl bg-[#141414] border border-white/[0.16] focus:border-white/50 outline-none px-3.5 py-2.5 text-[14px] text-white placeholder:text-[#666666] transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="block text-[12px] font-medium text-[#A8A8A8]">
                Cor de identificação
              </span>
              <button
                type="button"
                aria-expanded={colorPickerOpen}
                onClick={() => setColorPickerOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#141414] hover:border-white/25 px-2 py-1 text-[11.5px] font-mono text-[#E5E5E5] transition-colors"
              >
                <span
                  className="h-3 w-3 rounded-full border border-white/20"
                  style={{ backgroundColor: corHex }}
                />
                <span>{corHex.toUpperCase()}</span>
                <Palette className="h-3 w-3 text-[#9A9A9A]" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {SERVER_ACCENT_COLORS.slice(0, 6).map((item) => {
                const selected = corHex.toUpperCase() === item.hex.toUpperCase();
                return (
                  <button
                    key={item.hex}
                    type="button"
                    onClick={() => setCorHex(item.hex)}
                    title={item.label}
                    aria-label={`Cor ${item.label}`}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-transform ${
                      selected ? "ring-2 ring-white scale-105" : "opacity-75 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: item.hex }}
                  >
                    {selected && <Check className="w-3.5 h-3.5 text-[#0D0D0D] stroke-[3]" />}
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="Abrir seletor de cor completo"
                onClick={() => setColorPickerOpen((v) => !v)}
                className="px-2.5 h-7 rounded-lg border border-white/[0.12] bg-[#141414] hover:border-white/30 text-[11.5px] font-medium text-[#DCDCDC] flex items-center gap-1.5 transition-colors"
              >
                <Palette className="w-3.5 h-3.5 text-[#31CF76]" />
                <span>{colorPickerOpen ? "Fechar cores" : "Mais cores"}</span>
              </button>
            </div>
            {colorPickerOpen && (
              <div className="mt-2.5">
                <StudioColorPicker
                  value={corHex}
                  onChange={setCorHex}
                  swatches={SERVER_ACCENT_COLORS}
                  ariaLabelPrefix="Cor do servidor"
                />
              </div>
            )}
          </div>

          {quotaCheck.blocked && quotaCheck.message && (
            <div className="rounded-xl bg-[#FF9412]/10 border border-[#FF9412]/30 p-3 text-[12.5px] text-[#FFD79E] flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#FF9412] shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="leading-relaxed">{quotaCheck.message}</p>
                {onOpenLicenseSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenLicenseSettings();
                    }}
                    className="text-[12px] font-semibold text-white underline underline-offset-2 hover:text-[#FFD79E]"
                  >
                    Ver planos e licença
                  </button>
                )}
              </div>
            </div>
          )}

          {erro && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-[12.5px] text-red-200">
              {erro}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13.5px] font-medium text-[#D4D4D4] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`px-4 py-2 rounded-xl text-[13.5px] font-semibold transition-colors flex items-center gap-2 ${
              canSubmit
                ? "bg-[#E5E5E5] text-[#0D0D0D] hover:bg-white"
                : "bg-[#686868]/60 text-[#1A1A1A] cursor-not-allowed"
            }`}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Criar servidor
          </button>
        </div>
      </form>
    </div>
  );
};

/* ============================================================================
 * MODAL 2: Novo servidor em outro computador — CRIATIVO_CLAIM (Print 4)
 * ============================================================================ */
