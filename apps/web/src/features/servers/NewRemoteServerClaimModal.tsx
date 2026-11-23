import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  ServerClaimTicket,
  ServerQuotaSummary,
  StudioServerRecord,
} from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import { MascoteAvatar } from "../../components/MascoteAvatar";
import {
  copyTextToClipboard,
  formatCountdownMMSS,
  isRemoteQuotaBlocked,
} from "./server-modals-helpers";

export interface NewRemoteServerClaimModalProps {
  open: boolean;
  quota: ServerQuotaSummary | null;
  initialClaim?: ServerClaimTicket | null;
  onClose: () => void;
  onConfigureWithAgent: (promptText: string, claim: ServerClaimTicket | null) => void;
  onOpenPairedServer: (server: StudioServerRecord) => Promise<void> | void;
  onOpenLicenseSettings?: () => void;
}

export const NewRemoteServerClaimModal: React.FC<NewRemoteServerClaimModalProps> = ({
  open,
  quota,
  initialClaim = null,
  onClose,
  onConfigureWithAgent,
  onOpenPairedServer,
  onOpenLicenseSettings,
}) => {
  const [serverName, setServerName] = useState(initialClaim?.server_name ?? "");
  const [claim, setClaim] = useState<ServerClaimTicket | null>(initialClaim);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiedMode, setCopiedMode] = useState<"bash" | "agent" | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [openingServer, setOpeningServer] = useState(false);

  const quotaCheck = isRemoteQuotaBlocked(quota);

  const generateNewClaim = useCallback(async (customName?: string) => {
    setLoading(true);
    setErro(null);
    try {
      const next = await daemonApi.criarClaimVps({
        server_name: customName?.trim() ? customName.trim() : undefined,
      });
      setClaim(next);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao gerar comando CRIATIVO_CLAIM.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      if (!initialClaim) {
        setClaim(null);
      }
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      setErro(null);
      setCopiedMode(null);
      return;
    }
    if (!claim && !initialClaim && !quotaCheck.blocked) {
      void generateNewClaim();
    }
  }, [open, claim, initialClaim, quotaCheck.blocked, generateNewClaim]);

  useEffect(() => {
    if (!open || !claim || claim.status !== "pending") return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, claim]);

  useEffect(() => {
    if (!open || !claim || claim.status !== "pending") return;
    const poller = window.setInterval(async () => {
      try {
        const updated = await daemonApi.consultarClaimVps(claim.claim_id);
        setClaim(updated);
      } catch {
        // mantém última leitura em falhas transitórias de rede
      }
    }, 3000);
    return () => window.clearInterval(poller);
  }, [open, claim]);

  const remainingSeconds = useMemo(() => {
    if (!claim) return 15 * 60;
    const expMs = Date.parse(claim.expires_at);
    if (!Number.isFinite(expMs)) return claim.ttl_seconds;
    return Math.max(0, Math.floor((expMs - nowMs) / 1000));
  }, [claim, nowMs]);

  if (!open) return null;

  const isRedeemed = claim?.status === "redeemed" && Boolean(claim.paired_server);
  const isExpired = claim?.status === "expired" || (claim?.status === "pending" && remainingSeconds <= 0);

  const copyText = async (mode: "bash" | "agent") => {
    if (!claim) return;
    const text = mode === "bash" ? claim.command_bash : claim.command_agent_prompt;
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      setErro("Não foi possível acessar a área de transferência automaticamente. Selecione o texto do comando para copiar.");
      return;
    }
    setErro(null);
    setCopiedMode(mode);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedMode(null);
      copyTimerRef.current = null;
    }, 2500);
  };

  const handleOpenPaired = async () => {
    if (!claim?.paired_server || openingServer) return;
    setOpeningServer(true);
    try {
      await onOpenPairedServer(claim.paired_server);
      onClose();
    } finally {
      setOpeningServer(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Novo servidor em outro computador"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="relative w-full max-w-[490px] bg-[#1C1C1C] border border-white/[0.1] rounded-[22px] shadow-[0_24px_70px_rgba(0,0,0,0.85)] p-6 text-[#F0F0F0]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar modal"
          className="absolute right-4 top-4 text-[#8E8E8E] hover:text-white p-1.5 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Logo oficial CriativoOS */}
        <div className="flex flex-col items-center text-center pt-1">
          <div className="w-14 h-14 rounded-2xl bg-[#141414] border border-white/[0.1] flex items-center justify-center shadow-lg">
            <MascoteAvatar shape="hex" color="#31cf76" size={40} />
          </div>
          <h2 className="mt-4 text-[21px] font-bold text-white tracking-tight">
            Novo servidor em outro computador
          </h2>
          <p className="mt-2 text-[13.5px] text-[#9A9A9A] max-w-[380px] leading-relaxed">
            Execute este comando em um computador Linux ou VPS que seja seu. Ele instala o CriativoOS e adiciona o servidor a esta conta.
          </p>
        </div>

        {quotaCheck.blocked && quotaCheck.message && (
          <div className="mt-4 rounded-xl bg-[#FF9412]/10 border border-[#FF9412]/30 p-3 text-[12.5px] text-[#FFD79E] flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#FF9412] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>{quotaCheck.message}</p>
              {onOpenLicenseSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLicenseSettings();
                  }}
                  className="text-[12px] font-semibold text-white underline underline-offset-2"
                >
                  Fazer upgrade de plano
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="criativo-remote-name" className="sr-only">
            Nome opcional da VPS
          </label>
          <input
            id="criativo-remote-name"
            type="text"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder="Nome do servidor remoto (opcional, ex.: VPS Cliente)"
            className="w-full rounded-xl bg-[#121212] border border-white/[0.08] focus:border-white/35 outline-none px-3 py-2 text-[12.5px] text-white placeholder:text-[#666666]"
          />
        </div>

        {/* Bloco Shell */}
        <div className="mt-3 rounded-xl bg-[#121212] border border-white/[0.08] overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#161616]">
            <span className="text-[11.5px] font-medium px-2 py-0.5 rounded-md bg-white/[0.06] text-[#B8B8B8]">
              Shell
            </span>
            <div className="flex items-center gap-2 text-[11.5px] text-[#B0B0B0]">
              <button
                type="button"
                disabled={!claim}
                onClick={() => void copyText("agent")}
                className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors disabled:opacity-40 ${
                  copiedMode === "agent"
                    ? "bg-[#31CF76]/15 text-[#31CF76] border border-[#31CF76]/40 font-semibold"
                    : "hover:text-white border border-transparent hover:bg-white/[0.06]"
                }`}
              >
                {copiedMode === "agent" ? (
                  <Check className="w-3.5 h-3.5 text-[#31CF76]" />
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
                <span>{copiedMode === "agent" ? "Copiado para IA!" : "Copiar para um Criativo de IA"}</span>
              </button>
              <button
                type="button"
                disabled={!claim}
                aria-label="Copiar comando shell"
                onClick={() => void copyText("bash")}
                className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors disabled:opacity-40 ${
                  copiedMode === "bash"
                    ? "bg-[#31CF76]/15 text-[#31CF76] border border-[#31CF76]/40 font-semibold"
                    : "hover:text-white border border-transparent hover:bg-white/[0.06]"
                }`}
              >
                {copiedMode === "bash" ? (
                  <Check className="w-3.5 h-3.5 text-[#31CF76]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedMode === "bash" ? "Copiado!" : "Copiar"}</span>
              </button>
            </div>
          </div>

          <div
            onClick={() => {
              if (claim) void copyText("bash");
            }}
            title={claim ? "Clique para copiar o comando" : undefined}
            className="px-3.5 py-3 font-mono text-[12px] text-[#E6E6E6] overflow-x-auto whitespace-nowrap flex items-center gap-3 cursor-pointer"
          >
            <span className="text-[#5C5C5C] select-none">1</span>
            <code className="select-all">
              {loading
                ? "Gerando token único CRIATIVO_CLAIM..."
                : claim?.command_bash ?? "Comando indisponível no momento."}
            </code>
          </div>
          {copiedMode && (
            <div
              role="status"
              className="px-3 py-1.5 border-t border-[#31CF76]/25 bg-[#31CF76]/10 text-[11.5px] font-medium text-[#31CF76] flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                {copiedMode === "agent"
                  ? "Prompt com comando copiado para a área de transferência."
                  : "Comando copiado para a área de transferência."}
              </span>
            </div>
          )}
        </div>

        {/* Expiração + Novo comando */}
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-[#969696]">
            Funciona uma vez. Expira em {formatCountdownMMSS(remainingSeconds)}.
          </span>
          <button
            type="button"
            disabled={loading || quotaCheck.blocked}
            onClick={() => void generateNewClaim(serverName)}
            className="text-[#E5E5E5] hover:text-white font-medium flex items-center gap-1.5 disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Novo comando
          </button>
        </div>

        {/* Status do pareamento */}
        <div className="mt-4 flex items-center gap-2.5 text-[13px]">
          {isRedeemed ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-[#31CF76] shrink-0" />
              <span className="text-[#31CF76] font-medium">
                Servidor conectado: {claim?.paired_server?.nome}. Pronto para abrir!
              </span>
            </>
          ) : isExpired ? (
            <>
              <AlertTriangle className="w-4 h-4 text-[#FF9412] shrink-0" />
              <span className="text-[#FFD79E]">
                Comando expirado. Clique em Novo comando para gerar outro.
              </span>
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#9A9A9A] shrink-0" />
              <span className="text-[#B8B8B8]">
                Aguardando o comando ser executado no seu servidor...
              </span>
            </>
          )}
        </div>

        {erro && (
          <div className="mt-3 rounded-xl bg-red-500/10 border border-red-500/30 p-2.5 text-[12px] text-red-200">
            {erro}
          </div>
        )}

        {/* Ações inferiores largas do Print 4 */}
        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            disabled={!claim && !quotaCheck.blocked}
            onClick={() => {
              const prompt =
                claim?.command_agent_prompt ??
                `Quero instalar e parear um novo servidor CriativoOS em minha VPS Linux${
                  serverName ? ` chamada "${serverName}"` : ""
                }. Gere ou utilize o comando seguro CRIATIVO_CLAIM e me guie passo a passo.`;
              onConfigureWithAgent(prompt, claim);
            }}
            className="w-full py-2.5 rounded-xl bg-[#F0F0F0] hover:bg-white text-[#0D0D0D] text-[13.5px] font-semibold transition-colors disabled:opacity-40"
          >
            Configurar com um Criativo
          </button>

          <button
            type="button"
            disabled={!isRedeemed || openingServer}
            onClick={() => void handleOpenPaired()}
            className={`w-full py-2.5 rounded-xl text-[13.5px] font-semibold transition-colors flex items-center justify-center gap-2 ${
              isRedeemed
                ? "bg-[#31CF76] hover:bg-[#3CE085] text-[#081A0F]"
                : "bg-[#5A5A5A]/70 text-[#191919] cursor-not-allowed"
            }`}
          >
            {openingServer && <Loader2 className="w-4 h-4 animate-spin" />}
            Abrir servidor
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * MODAL 3: Entrar em um servidor existente
 * ============================================================================ */
