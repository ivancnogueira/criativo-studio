import React from "react";
import { ArrowUpCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { UpdateStatusSnapshot } from "@criativo/contracts";

export interface UpdateNotificationBannerProps {
  status: UpdateStatusSnapshot | null;
  applying?: boolean;
  onApplyUpdate?: () => void;
  onForceRestart?: () => void;
  onOpenDetails?: () => void;
}

export const UpdateNotificationBanner: React.FC<UpdateNotificationBannerProps> = ({
  status,
  applying = false,
  onApplyUpdate,
  onForceRestart,
  onOpenDetails,
}) => {
  if (!status) return null;

  const isInProgress =
    applying ||
    status.state === "downloading" ||
    status.state === "verifying" ||
    status.state === "applying";
  const isWaitingIdle = status.state === "waiting_idle";
  const isReady = status.state === "ready_to_restart";
  const show = status.update_available || isInProgress || isWaitingIdle || isReady;
  if (!show) return null;

  const targetVersion = status.latest_version || status.current_version;

  return (
    <div
      role="status"
      aria-label="Atualização disponível"
      className="mx-2.5 mb-2 rounded-xl bg-[#19241E] border border-[#31CF76]/35 p-3 text-[#F0F0F0] shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
          {isReady ? (
            <CheckCircle2 className="h-4 w-4 text-[#31CF76] shrink-0" />
          ) : (
            <Sparkles className="h-4 w-4 text-[#31CF76] shrink-0" />
          )}
          <span>
            {isWaitingIdle
              ? `Atualização v${targetVersion} aguardando ociosidade`
              : isReady
                ? `Atualização v${targetVersion} aplicada`
                : `Nova versão v${targetVersion}`}
          </span>
        </div>

        {onOpenDetails && (
          <button
            type="button"
            onClick={onOpenDetails}
            className="text-[11px] text-[#9BCFB0] hover:text-white underline underline-offset-2 shrink-0"
          >
            Notas
          </button>
        )}
      </div>

      <p className="mt-1 text-[11px] text-[#B8D8C5] leading-snug">
        {isWaitingIdle
          ? "Aguardando a conclusão do turno/renderização atual antes de reiniciar o servidor."
          : isReady
            ? "Dados preservados. Reinicie o servidor para ativar a nova versão."
            : isInProgress
              ? status.state === "verifying"
                ? "Validando assinatura SHA-256 do pacote..."
                : status.state === "applying"
                  ? "Aplicando atualização sem tocar nos seus dados..."
                  : `Baixando atualização (${Math.round(status.progress_percent)}%)...`
              : "Clique para atualizar mantendo Criativos, conversas e banco seguros."}
      </p>

      {isInProgress && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-black/40 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#31CF76] transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(8, status.progress_percent))}%` }}
          />
        </div>
      )}

      <button
        type="button"
        disabled={isInProgress}
        onClick={() => (isWaitingIdle && onForceRestart ? onForceRestart() : onApplyUpdate?.())}
        className="mt-2.5 w-full rounded-lg bg-[#31CF76] hover:bg-[#3EE086] disabled:opacity-60 text-[#081A0F] py-1.5 px-2.5 text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
      >
        {isWaitingIdle ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Reiniciar agora (forçar)</span>
          </>
        ) : isInProgress ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Atualizando...</span>
          </>
        ) : isReady ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Pronto · Reiniciar agora</span>
          </>
        ) : (
          <>
            <ArrowUpCircle className="h-3.5 w-3.5" />
            <span>Atualizar agora</span>
          </>
        )}
      </button>
    </div>
  );
};
