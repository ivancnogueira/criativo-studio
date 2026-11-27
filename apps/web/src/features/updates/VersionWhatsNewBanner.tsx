import React, { useEffect, useMemo, useState } from "react";
import type { WhatsNewReleaseInfo } from "@criativo/contracts";
import { ChevronDown, ChevronUp, ExternalLink, Sparkles, X } from "lucide-react";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";

const CHANGELOG_BASE_URL = "https://criativoos.com.br/changelog";
const DISMISSED_VERSION_STORAGE_KEY = "criativo:whats-new-dismissed-version";

export function buildChangelogAnchorUrl(version?: string | null): string {
  const clean = String(version ?? "")
    .trim()
    .replace(/^v/i, "");
  if (!clean) return CHANGELOG_BASE_URL;
  return `${CHANGELOG_BASE_URL}#v${clean.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
}

export function openExternalChangelogUrl(url: string): void {
  const desktop = getCriativoDesktopBridge();
  if (desktop?.openExternalSafe) {
    void desktop.openExternalSafe(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_VERSION_STORAGE_KEY, version);
  } catch {
    // ignora ambientes sem localStorage
  }
}

export interface VersionWhatsNewBannerProps {
  whatsNew: WhatsNewReleaseInfo | null;
  currentVersion?: string | null;
  onOpenUpdatesSettings?: () => void;
}

export const VersionWhatsNewBanner: React.FC<VersionWhatsNewBannerProps> = ({
  whatsNew,
  currentVersion,
  onOpenUpdatesSettings,
}) => {
  const activeVersion = (
    whatsNew?.versao_atual ||
    currentVersion ||
    whatsNew?.notas?.[0]?.versao ||
    ""
  )
    .trim()
    .replace(/^v/i, "");

  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() =>
    readDismissedVersion(),
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDismissedVersion(readDismissedVersion());
  }, [activeVersion]);

  const activeNote = useMemo(() => {
    const notas = whatsNew?.notas ?? [];
    if (notas.length === 0) return null;
    return (
      notas.find((n) => n.versao.replace(/^v/i, "") === activeVersion) ?? notas[0]
    );
  }, [whatsNew, activeVersion]);

  if (!activeVersion || !activeNote) return null;
  if (dismissedVersion === activeVersion) return null;

  const added = activeNote.added ?? [];
  const changed = activeNote.changed ?? [];
  const fixed = activeNote.fixed ?? [];
  const totalItems = added.length + changed.length + fixed.length;
  if (totalItems === 0) return null;

  const headline =
    added[0] ??
    changed[0] ??
    fixed[0] ??
    `Confira todas as melhorias da versão v${activeVersion}.`;

  const changelogUrl = buildChangelogAnchorUrl(activeVersion);

  const handleDismiss = () => {
    saveDismissedVersion(activeVersion);
    setDismissedVersion(activeVersion);
    setExpanded(false);
  };

  return (
    <section
      aria-label={`Novidades da versão v${activeVersion}`}
      className="shrink-0 border-b border-[#B9FC01]/25 bg-[#11140E] text-[#E9ECE6]"
    >
      <div className="px-4 py-1.5 flex items-center justify-between gap-3 text-[12px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 rounded-md border border-[#B9FC01]/40 bg-[#B9FC01]/12 px-2 py-0.5 font-mono text-[10.5px] font-bold text-[#B9FC01] shrink-0">
            <Sparkles className="h-3 w-3" />
            <span>Novidades v{activeVersion}</span>
          </span>
          <span className="truncate text-[#D2D8CC]">{headline}</span>
          {totalItems > 1 && (
            <span className="hidden sm:inline-block shrink-0 font-mono text-[10.5px] text-[#98A48D]">
              +{totalItems - 1} {totalItems - 1 === 1 ? "item" : "itens"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-0.5 text-[11.5px] font-medium text-white transition-colors"
          >
            <span>{expanded ? "Ocultar detalhes" : "Ver detalhes"}</span>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-[#B9FC01]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[#B9FC01]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => openExternalChangelogUrl(changelogUrl)}
            className="inline-flex items-center gap-1 rounded-md bg-[#B9FC01] hover:bg-[#C8FF29] px-2.5 py-0.5 text-[11.5px] font-bold text-[#07080C] transition-colors"
          >
            <span>Changelog</span>
            <ExternalLink className="h-3 w-3" />
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dispensar novidades desta versão"
            className="rounded p-0.5 text-[#8A9483] hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.07] bg-[#0B0D0F] px-4 py-3 text-[12px] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-white">
                O que há de novo no CriativoOS v{activeVersion}
              </p>
              <p className="text-[11px] text-[#8E968A]">
                Publicado em {activeNote.data}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {onOpenUpdatesSettings && (
                <button
                  type="button"
                  onClick={onOpenUpdatesSettings}
                  className="text-[11.5px] font-medium text-[#A4B0C0] hover:text-white underline underline-offset-2"
                >
                  Ir para Atualizações
                </button>
              )}
              <button
                type="button"
                onClick={() => openExternalChangelogUrl(changelogUrl)}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#B9FC01] hover:underline underline-offset-2"
              >
                <span>Abrir página completa de changelogs</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {added.length > 0 && (
              <div className="rounded-xl border border-[#B9FC01]/20 bg-[#12160E] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#B9FC01]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#B9FC01]" />
                  <span>Novidades ({added.length})</span>
                </p>
                <ul className="mt-2 space-y-1.5 text-[#D8DFD4] leading-relaxed">
                  {added.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-[#B9FC01]/70 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {changed.length > 0 && (
              <div className="rounded-xl border border-sky-400/20 bg-[#0F141A] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  <span>Melhorias ({changed.length})</span>
                </p>
                <ul className="mt-2 space-y-1.5 text-[#D0DAE5] leading-relaxed">
                  {changed.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-400/70 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {fixed.length > 0 && (
              <div className="rounded-xl border border-emerald-400/20 bg-[#0E1613] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Correções ({fixed.length})</span>
                </p>
                <ul className="mt-2 space-y-1.5 text-[#CFE0D8] leading-relaxed">
                  {fixed.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-400/70 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-[#C8CFC4] hover:text-white"
            >
              Entendi, dispensar aviso desta versão
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
