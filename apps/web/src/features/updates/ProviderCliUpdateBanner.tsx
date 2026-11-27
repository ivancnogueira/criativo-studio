import React, { useEffect, useState } from "react";
import type { ProvedorStatusInfo } from "@criativo/contracts";
import { ArrowUpCircle, Loader2, X } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

interface ManagedRuntimeUpdateEntry {
  folder: string;
  provider: "openai" | "claude" | "gemini" | "opencode";
  label: string;
  executable: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

export interface ProviderCliUpdateBannerProps {
  onProvidersUpdated?: (list: ProvedorStatusInfo[]) => void;
}

/**
 * Banner fino no topo avisando quando há nova versão de CLI conectada
 * (Codex, Claude, Antigravity ou OpenCode) com atualização e recarga de modelos em 1 clique.
 */
export const ProviderCliUpdateBanner: React.FC<ProviderCliUpdateBannerProps> = ({
  onProvidersUpdated,
}) => {
  const [items, setItems] = useState<ManagedRuntimeUpdateEntry[]>([]);
  const [upgradingFolder, setUpgradingFolder] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void daemonApi
        .listProviderRuntimeUpdates(false)
        .then((list) => {
          if (cancelled) return;
          const pending = list.filter((item) => {
            if (!item.updateAvailable || !item.latestVersion) return false;
            try {
              const seenKey = `criativo:cli-update-dismissed:${item.folder}:${item.latestVersion}`;
              return sessionStorage.getItem(seenKey) !== "1";
            } catch {
              return true;
            }
          });
          setItems(pending);
        })
        .catch(() => {});
    }, 9_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (items.length === 0 && !statusNotice) return null;

  const active = items[0] ?? null;

  const handleUpgrade = async (entry: ManagedRuntimeUpdateEntry) => {
    setUpgradingFolder(entry.folder);
    setStatusNotice(null);
    try {
      const res = await daemonApi.upgradeProviderRuntime(entry.provider);
      if (res.provedores.length > 0) {
        onProvidersUpdated?.(res.provedores);
      }
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.folder !== entry.folder));
        setStatusNotice(
          `${entry.label} atualizada para v${res.versao ?? entry.latestVersion ?? "recente"} · catálogo de modelos atualizado.`
        );
        window.setTimeout(() => setStatusNotice(null), 5000);
      } else {
        setStatusNotice(res.erro ?? `Não foi possível atualizar ${entry.label} agora.`);
      }
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : `Erro ao atualizar ${entry.label}.`
      );
    } finally {
      setUpgradingFolder(null);
    }
  };

  const handleDismiss = (entry: ManagedRuntimeUpdateEntry) => {
    if (entry.latestVersion) {
      try {
        sessionStorage.setItem(
          `criativo:cli-update-dismissed:${entry.folder}:${entry.latestVersion}`,
          "1"
        );
      } catch {
        // ignora
      }
    }
    setItems((prev) => prev.filter((item) => item.folder !== entry.folder));
  };

  if (!active && statusNotice) {
    return (
      <div className="shrink-0 border-b border-[#31CF76]/25 bg-[#121D16] px-4 py-1.5 text-[12px] text-[#B8ECCB] flex items-center justify-between gap-3">
        <span>{statusNotice}</span>
        <button
          type="button"
          onClick={() => setStatusNotice(null)}
          className="text-[#8ABEA0] hover:text-white"
          aria-label="Fechar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (!active) return null;
  const isBusy = upgradingFolder === active.folder;

  return (
    <div
      role="status"
      aria-label="Atualização de CLI disponível"
      className="shrink-0 border-b border-[#B9FC01]/25 bg-[#141D17] px-4 py-1.5 text-[12px] text-[#E6F4EC] flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2 min-w-0 truncate">
        <ArrowUpCircle className="h-3.5 w-3.5 text-[#31CF76] shrink-0" />
        <span className="truncate">
          Nova versão da <strong>{active.label}</strong> disponível (
          {active.currentVersion ? `v${active.currentVersion}` : "CLI atual"} →{" "}
          <strong>v{active.latestVersion}</strong>)
          {items.length > 1 ? ` · +${items.length - 1} outra(s)` : ""}
          {statusNotice ? ` — ${statusNotice}` : ""}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleUpgrade(active)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#31CF76] hover:bg-[#3EE086] disabled:opacity-60 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#081A0F] transition-colors"
        >
          {isBusy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Atualizando CLI...</span>
            </>
          ) : (
            <span>Atualizar CLI</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleDismiss(active)}
          aria-label="Dispensar atualização de CLI"
          className="rounded p-0.5 text-[#8AA596] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
