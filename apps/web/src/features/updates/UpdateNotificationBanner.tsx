import React, { useEffect, useRef, useState } from "react";
import { ArrowUpCircle, CheckCircle2, ExternalLink, Loader2, Sparkles } from "lucide-react";
import type { UpdateStatusSnapshot } from "@criativo/contracts";
import { triggerUpdateBeam } from "./update-beam-effect";
import { buildChangelogAnchorUrl, openExternalChangelogUrl } from "./VersionWhatsNewBanner";

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
  const actionBtnRef = useRef<HTMLButtonElement | null>(null);
  const downloadBeamVersionRef = useRef<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const isInProgress =
    applying ||
    status?.state === "downloading" ||
    status?.state === "verifying" ||
    status?.state === "applying";
  const isWaitingIdle = status?.state === "waiting_idle";
  const isReady = status?.state === "ready_to_restart";
  const show = Boolean(status) && (Boolean(status?.update_available) || isInProgress || isWaitingIdle || isReady);
  const targetVersion = status?.latest_version || status?.current_version || "";

  useEffect(() => {
    if (status?.state === "error" || status?.state === "up_to_date") {
      setRestarting(false);
    }
  }, [status?.state]);

  // Animação radial focada ao surgir atualização disponível/pronta ou iniciar download
  useEffect(() => {
    if (!show || !targetVersion) return;

    if (status?.update_available || isReady) {
      let seen = false;
      const seenKey = `criativo:update-beam-seen:${targetVersion}`;
      try {
        seen = sessionStorage.getItem(seenKey) === "1";
        if (!seen) sessionStorage.setItem(seenKey, "1");
      } catch {
        // ignora ambientes sem sessionStorage
      }
      if (!seen) {
        const raf = requestAnimationFrame(() => {
          void triggerUpdateBeam(actionBtnRef.current, "in");
        });
        return () => cancelAnimationFrame(raf);
      }
    }

    if (status?.state === "downloading" && downloadBeamVersionRef.current !== targetVersion) {
      downloadBeamVersionRef.current = targetVersion;
      const raf = requestAnimationFrame(() => {
        void triggerUpdateBeam(actionBtnRef.current, "in");
      });
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [show, isReady, status?.update_available, status?.state, targetVersion]);

  if (!status || !show) return null;

  const handleActionClick = () => {
    const btn = actionBtnRef.current;
    if (isWaitingIdle && onForceRestart) {
      setRestarting(true);
      void triggerUpdateBeam(btn, "out");
      onForceRestart();
      return;
    }
    if (isReady && onApplyUpdate) {
      setRestarting(true);
      const beamPromise = triggerUpdateBeam(btn, "out");
      const hold = new Promise<void>((r) => setTimeout(r, 380));
      void Promise.race([beamPromise, hold]).then(() => {
        onApplyUpdate();
      });
      return;
    }
    void triggerUpdateBeam(btn, "out");
    onApplyUpdate?.();
  };

  return (
    <div
      role="status"
      aria-label="Atualização disponível"
      className={`mx-2.5 mb-2 rounded-xl bg-[#19241E] border p-3 text-[#F0F0F0] transition-all duration-300 ${
        status.update_available || isReady
          ? "border-[#B9FC01]/45 shadow-[0_0_24px_rgba(185,252,1,0.12)]"
          : "border-[#31CF76]/35 shadow-lg"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
          {isReady ? (
            <CheckCircle2 className="h-4 w-4 text-[#31CF76] shrink-0" />
          ) : (
            <Sparkles className="h-4 w-4 text-[#31CF76] shrink-0" />
          )}
          <span>
            {restarting
              ? `Atualizando v${targetVersion}...`
              : isWaitingIdle
                ? `Atualização v${targetVersion} aguardando ociosidade`
                : isReady
                  ? `Nova versão v${targetVersion} pronta`
                  : `Nova versão v${targetVersion}`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {targetVersion && (
            <button
              type="button"
              onClick={() => openExternalChangelogUrl(buildChangelogAnchorUrl(targetVersion))}
              className="inline-flex items-center gap-0.5 text-[11px] text-[#B9FC01] hover:text-white underline underline-offset-2"
            >
              <span>Changelog</span>
              <ExternalLink className="h-2.5 w-2.5" />
            </button>
          )}
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
      </div>

      <p className="mt-1 text-[11px] text-[#B8D8C5] leading-snug">
        {restarting
          ? "Fechando serviços, aplicando atualização e reabrindo automaticamente..."
          : isWaitingIdle
            ? "Aguardando a conclusão da tarefa atual antes de reiniciar e atualizar."
            : isReady
              ? "Atualização já baixada e validada. Clique abaixo para reiniciar e atualizar."
              : isInProgress
                ? status.state === "verifying"
                  ? "Validando assinatura SHA-256 do pacote..."
                  : status.state === "applying"
                    ? "Preparando atualização sem tocar nos seus dados..."
                    : `Baixando em segundo plano (${Math.round(status.progress_percent)}%)...`
                : "Clique para baixar, atualizar e reiniciar automaticamente mantendo seus dados seguros."}
      </p>

      {!restarting && !isInProgress && status.changelog_markdown && (
        <p className="mt-1.5 line-clamp-2 rounded-md bg-black/25 px-2 py-1 text-[10.5px] text-[#D7EBD9] leading-snug">
          {status.changelog_markdown}
        </p>
      )}

      {isInProgress && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-black/40 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#31CF76] transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(8, status.progress_percent))}%` }}
          />
        </div>
      )}

      <button
        ref={actionBtnRef}
        type="button"
        disabled={isInProgress || restarting}
        onClick={handleActionClick}
        className="mt-2.5 w-full rounded-lg bg-[#31CF76] hover:bg-[#3EE086] active:scale-[0.97] disabled:opacity-60 text-[#081A0F] py-1.5 px-2.5 text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all"
      >
        {restarting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Reiniciando e atualizando...</span>
          </>
        ) : isWaitingIdle ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Reiniciar para atualizar (forçar)</span>
          </>
        ) : isInProgress ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Baixando atualização...</span>
          </>
        ) : isReady ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Reiniciar para atualizar</span>
          </>
        ) : (
          <>
            <ArrowUpCircle className="h-3.5 w-3.5" />
            <span>Atualizar e reiniciar</span>
          </>
        )}
      </button>
    </div>
  );
};
