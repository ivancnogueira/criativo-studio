import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { UpdateStatusSnapshot, WhatsNewReleaseInfo } from "@criativo/contracts";
import { WhatsNewPanel } from "./StorageUsageBar";

export interface SettingsUpdatesTabProps {
  updateStatus: UpdateStatusSnapshot | null;
  whatsNew: WhatsNewReleaseInfo | null;
  activeServerName?: string;
  onCheckUpdates?: () => Promise<void>;
  onApplyUpdate?: () => Promise<void>;
  onRestartForUpdate?: () => Promise<void>;
}

export const SettingsUpdatesTab: React.FC<SettingsUpdatesTabProps> = ({
  updateStatus,
  whatsNew,
  activeServerName = "Servidor Principal",
  onCheckUpdates,
  onApplyUpdate,
  onRestartForUpdate,
}) => {
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const isDownloadingOrApplying =
    applying ||
    updateStatus?.state === "downloading" ||
    updateStatus?.state === "verifying" ||
    updateStatus?.state === "applying";

  const isLicenseBlocked = updateStatus?.state === "license_blocked";
  const isReadyToRestart = updateStatus?.state === "ready_to_restart";
  const hasUpdate = Boolean(updateStatus?.update_available) && !isLicenseBlocked;
  const hasError =
    Boolean(erro || updateStatus?.error_message || updateStatus?.state === "error") &&
    !isLicenseBlocked;

  const handleCheck = async () => {
    if (!onCheckUpdates || checking) return;
    setChecking(true);
    setErro(null);
    try {
      await onCheckUpdates();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao verificar atualizações.");
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    if (isReadyToRestart && onRestartForUpdate) {
      if (applying) return;
      setApplying(true);
      setErro(null);
      try {
        await onRestartForUpdate();
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Erro ao reiniciar aplicativo.");
      } finally {
        setApplying(false);
      }
      return;
    }
    if (!onApplyUpdate || applying) return;
    setApplying(true);
    setErro(null);
    try {
      await onApplyUpdate();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao aplicar atualização.");
    } finally {
      setApplying(false);
    }
  };

  const currentVersion = updateStatus?.current_version ?? whatsNew?.versao_atual ?? "1.0.0";

  return (
    <div className="space-y-5 text-[#E5E5E5]">
      <div className="rounded-2xl bg-[#181818] border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#31CF76]" />
              <h3 className="text-[15px] font-semibold text-white">
                Motor de Atualizações Automáticas
              </h3>
            </div>
            <p className="text-[12.5px] text-[#9A9A9A] flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-[#7D7D7D]" />
              <span>
                Alvo conectado: <strong className="text-white">{activeServerName}</strong> · Versão instalada:{" "}
                <code className="font-mono text-[#31CF76]">v{currentVersion}</code>
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={checking || isDownloadingOrApplying}
              onClick={() => void handleCheck()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-[#222222] hover:bg-[#2A2A2A] px-3.5 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
              <span>{checking ? "Verificando..." : "Verificar atualizações"}</span>
            </button>

            {(hasUpdate || isDownloadingOrApplying || isReadyToRestart) && (
              <button
                type="button"
                disabled={isDownloadingOrApplying}
                onClick={() => void handleApply()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#31CF76] hover:bg-[#3EE086] px-4 py-2 text-[12.5px] font-semibold text-[#081A0F] disabled:opacity-60"
              >
                {isDownloadingOrApplying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Aplicando ({Math.round(updateStatus?.progress_percent ?? 0)}%)</span>
                  </>
                ) : isReadyToRestart ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Pronto · Reiniciar agora</span>
                  </>
                ) : (
                  <>
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    <span>Atualizar agora (v{updateStatus?.latest_version})</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Estado e progresso */}
        {isLicenseBlocked ? (
          <div className="rounded-xl bg-[#FF9412]/10 border border-[#FF9412]/30 p-3.5 flex items-start gap-2.5 text-[12.5px] text-[#FFD79E]">
            <AlertTriangle className="h-4 w-4 text-[#FF9412] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white">Atualizações bloqueadas pela licença</p>
              <p className="mt-0.5">
                {updateStatus?.error_message ||
                  "É necessário manter uma licença ativa na aba Licença & Plano para baixar novas versões."}
              </p>
            </div>
          </div>
        ) : isReadyToRestart ? (
          <div className="rounded-xl bg-[#31CF76]/10 border border-[#31CF76]/30 p-3.5 flex items-start gap-2.5 text-[12.5px] text-[#B8F3CF]">
            <CheckCircle2 className="h-4 w-4 text-[#31CF76] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white">
                Versão v{updateStatus?.latest_version} verificada (SHA-256) e pronta!
              </p>
              <p className="mt-0.5">
                Todos os arquivos de marca, banco SQLite, chaves e conversas foram preservados intactos.
              </p>
            </div>
          </div>
        ) : hasUpdate ? (
          <div className="rounded-xl bg-[#141414] border border-white/[0.08] p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="font-semibold text-white">
                Atualização disponível: v{updateStatus?.latest_version}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#31CF76]/15 text-[#31CF76] font-medium">
                Verificação SHA-256 obrigatória
              </span>
            </div>
            {updateStatus?.changelog_markdown && (
              <pre className="whitespace-pre-wrap text-[12px] text-[#BDBDBD] font-sans leading-relaxed">
                {updateStatus.changelog_markdown}
              </pre>
            )}
            {isDownloadingOrApplying && (
              <div className="pt-1">
                <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#31CF76] transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(8, updateStatus?.progress_percent ?? 15))}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : hasError ? (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3.5 flex items-start gap-2.5 text-[12px] text-red-200">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <span>{erro || updateStatus?.error_message || "Falha ao consultar servidor de atualizações."}</span>
          </div>
        ) : (
          <div className="rounded-xl bg-[#141414] border border-white/[0.06] p-3 text-[12.5px] text-[#A8A8A8] flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#31CF76] shrink-0" />
            <span>
              Você já está usando a versão mais recente (v{currentVersion}).
            </span>
          </div>
        )}

        <div className="rounded-xl bg-[#131313] border border-white/[0.06] p-3 text-[11.5px] text-[#8E8E8E] flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#31CF76] shrink-0" />
          <span>
            Blindagem de dados: atualizações substituem apenas os binários do CriativoOS, preservando 100% dos arquivos da marca, `.env`, banco SQLite e servidores conectados.
          </span>
        </div>
      </div>

      <WhatsNewPanel whatsNew={whatsNew} hideSummaryHeader onCheckUpdates={handleCheck} />
    </div>
  );
};
