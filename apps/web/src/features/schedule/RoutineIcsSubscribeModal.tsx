import React, { useCallback, useEffect, useState } from "react";
import type { RoutineCalendarFeedInfo } from "@criativo/contracts";
import { Calendar, Check, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { daemonApi, getActiveServerId, resolveActiveServerUrl } from "../../services/websocket-client";

export interface RoutineIcsSubscribeModalProps {
  open: boolean;
  onClose: () => void;
}

export const RoutineIcsSubscribeModal: React.FC<RoutineIcsSubscribeModalProps> = ({
  open,
  onClose,
}) => {
  const [info, setInfo] = useState<RoutineCalendarFeedInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await daemonApi.getRoutineIcsFeedConfig();
      setInfo(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao obter link do feed .ics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadConfig();
    }
  }, [open, loadConfig]);

  if (!open) return null;

  const baseUrl = resolveActiveServerUrl(getActiveServerId()).replace(/\/+$/, "");
  const fullUrl = info ? `${baseUrl}${info.feedPath}` : "";

  const handleCopy = async () => {
    if (!fullUrl) return;
    await navigator.clipboard?.writeText(fullUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleRotate = async () => {
    setRotating(true);
    setError(null);
    try {
      const updated = await daemonApi.rotateRoutineIcsFeedToken();
      setInfo(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao rotacionar token.");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Assinar Calendário (.ics)"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#141414] p-5 text-[#F0F0F0] shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4.5 w-4.5 text-[#31CF76]" />
            <h3 className="text-base font-semibold text-white">Assinar Calendário (.ics)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#212121] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed text-[#979797]">
          Cole este endereço no Google Calendar ("Por URL"), Apple Calendar ou Outlook para acompanhar as próximas execuções das rotinas ativas em tempo real.
        </p>

        {error && (
          <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-2 text-xs text-[#FF8A90]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#979797]">
            <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
            <span>Gerando URL de assinatura...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={fullUrl}
                className="flex-1 rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 font-mono text-[11px] text-[#DCDCDC]"
              />
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#212121] px-3 py-2 text-xs font-medium text-white hover:bg-[#2A2A2A]"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[#31CF76]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copied ? "Copiado" : "Copiar"}</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-[#6A6A6A]">
                {info?.updatedAt
                  ? `Token atualizado em ${new Date(info.updatedAt).toLocaleString("pt-BR")}`
                  : "Token ativo"}
              </span>
              <button
                type="button"
                disabled={rotating}
                onClick={() => void handleRotate()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-[#FDCB6E] hover:bg-[#242424] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rotating ? "animate-spin" : ""}`} />
                <span>Rotacionar Token</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
