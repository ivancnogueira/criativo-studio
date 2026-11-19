import React, { useMemo, useState } from "react";
import type {
  StorageUsageCategory,
  StorageUsageItem,
  StorageUsageSnapshot,
  WhatsNewReleaseInfo,
} from "@criativo/contracts";
import {
  CheckCircle2,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";

const CATEGORY_DEFAULT_COLORS: Record<StorageUsageCategory, string> = {
  artes_geradas: "#007CF7",
  videos: "#007CF7",
  uploads: "#31CF76",
  perfis_navegador: "#FF9412",
  banco_dados: "#74B9FF",
};

export interface ComputedStorageSegment extends StorageUsageItem {
  percent: number;
  widthPercent: number;
}

/**
 * Formata volume em bytes para unidade legível em pt-BR.
 */
export function formatStorageBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${Math.round(safe)} B`;
  const kb = safe / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Calcula largura proporcional mínima legível e percentuais consistentes para StorageUsageBar.
 */
export function computeStorageSegments(
  snapshot: StorageUsageSnapshot
): ComputedStorageSegment[] {
  const items = snapshot.categorias ?? [];
  const sumBytes = items.reduce((acc, it) => acc + Math.max(0, it.bytes || 0), 0);
  const denominator = Math.max(1, snapshot.totalBytes || sumBytes);

  const nonZero = items.filter((it) => it.bytes > 0);
  if (nonZero.length === 0) {
    return items.map((it) => ({
      ...it,
      cor_hex: it.cor_hex || CATEGORY_DEFAULT_COLORS[it.categoria] || "#007CF7",
      percent: 0,
      widthPercent: 0,
    }));
  }

  return items.map((it) => {
    const safeBytes = Math.max(0, it.bytes || 0);
    const rawPct = (safeBytes / denominator) * 100;
    const widthPercent = safeBytes > 0 ? Math.max(2, Number(rawPct.toFixed(2))) : 0;
    return {
      ...it,
      cor_hex: it.cor_hex || CATEGORY_DEFAULT_COLORS[it.categoria] || "#007CF7",
      percent: Number(rawPct.toFixed(1)),
      widthPercent,
    };
  });
}

export interface StorageUsageBarProps {
  snapshot: StorageUsageSnapshot;
  activeCategory?: StorageUsageCategory | null;
  onActiveCategoryChange?: (category: StorageUsageCategory | null) => void;
}

export const StorageUsageBar: React.FC<StorageUsageBarProps> = ({
  snapshot,
  activeCategory: controlledActive,
  onActiveCategoryChange,
}) => {
  const [internalActive, setInternalActive] = useState<StorageUsageCategory | null>(null);
  const activeCategory = controlledActive !== undefined ? controlledActive : internalActive;

  const setActive = (cat: StorageUsageCategory | null) => {
    setInternalActive(cat);
    onActiveCategoryChange?.(cat);
  };

  const segments = useMemo(() => computeStorageSegments(snapshot), [snapshot]);

  const widthSum = segments.reduce((acc, s) => acc + s.widthPercent, 0);
  const scaleFactor = widthSum > 100 ? 100 / widthSum : 1;

  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={`Uso total em disco: ${formatStorageBytes(snapshot.totalBytes)}`}
        className="h-[16px] w-full rounded-full bg-[#141414] border border-white/[0.06] overflow-hidden flex"
      >
        {segments
          .filter((seg) => seg.widthPercent > 0)
          .map((seg) => {
            const isActive = activeCategory === seg.categoria;
            const effectiveWidth = Number((seg.widthPercent * scaleFactor).toFixed(2));
            return (
              <div
                key={seg.categoria}
                data-category={seg.categoria}
                data-active={isActive ? "true" : "false"}
                title={`${seg.rotulo}: ${formatStorageBytes(seg.bytes)} (${seg.percent}%)`}
                onPointerEnter={() => setActive(seg.categoria)}
                onPointerLeave={() => setActive(null)}
                style={{
                  width: `${effectiveWidth}%`,
                  backgroundColor: seg.cor_hex,
                }}
                className={`h-full transition-opacity cursor-pointer ${
                  activeCategory && !isActive ? "opacity-45" : "opacity-100"
                }`}
              />
            );
          })}
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {segments.map((seg) => {
          const isActive = activeCategory === seg.categoria;
          return (
            <li
              key={seg.categoria}
              data-category={seg.categoria}
              data-active={isActive ? "true" : "false"}
              onPointerEnter={() => setActive(seg.categoria)}
              onPointerLeave={() => setActive(null)}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer ${
                isActive
                  ? "border-[#007CF7] bg-[#242424] text-white"
                  : "border-white/[0.05] bg-[#141414] text-[#DCDCDC]"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: seg.cor_hex }}
                />
                <span className="truncate">{seg.rotulo}</span>
              </span>
              <span className="font-mono text-[11px] text-[#979797] tabular-nums shrink-0">
                {formatStorageBytes(seg.bytes)} ({seg.percent}%)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export interface SettingsStorageTabProps {
  snapshot: StorageUsageSnapshot | null;
  busy?: boolean;
  onRefresh?: () => Promise<void>;
  onClearCategory?: (category: "browser_cache" | "temp_previews") => Promise<void>;
  onDeleteFile?: (arquivoId: string) => Promise<void>;
}

export const SettingsStorageTab: React.FC<SettingsStorageTabProps> = ({
  snapshot,
  busy = false,
  onRefresh,
  onClearCategory,
  onDeleteFile,
}) => {
  const [confirmFileId, setConfirmFileId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-6 text-center space-y-3">
        <HardDrive className="h-6 w-6 text-[#74B9FF] mx-auto" />
        <p className="text-[13px] text-[#979797]">
          Calculando espaço ocupado por artes, vídeos, uploads e perfis Chromium...
        </p>
        {onRefresh && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRefresh()}
            className="rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#333333]"
          >
            Atualizar leitura de disco
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] text-[#979797]">Espaço total local do estúdio</div>
            <div className="text-[22px] font-semibold text-white tabular-nums">
              {formatStorageBytes(snapshot.totalBytes)}
            </div>
          </div>
          {onRefresh && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#141414] px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424] disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              <span>Recalcular uso</span>
            </button>
          )}
        </div>

        <StorageUsageBar snapshot={snapshot} />

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.06]">
          {onClearCategory && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onClearCategory("browser_cache");
                  setStatusMsg("Cache de perfis Chromium limpo com preservação de cookies.");
                }}
                className="rounded-lg bg-[#2A2A2A] px-3 py-2 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#333333] disabled:opacity-40"
              >
                Limpar cache de perfis
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onClearCategory("temp_previews");
                  setStatusMsg("Previews temporários antigos removidos com segurança.");
                }}
                className="rounded-lg bg-[#2A2A2A] px-3 py-2 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#333333] disabled:opacity-40"
              >
                Limpar previews antigos
              </button>
            </>
          )}
        </div>
        {statusMsg && (
          <div className="rounded-lg border border-[#31CF76]/30 bg-[#31CF76]/10 px-3 py-2 text-[12px] text-[#31CF76]">
            {statusMsg}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-white">Maiores arquivos locais</h4>
          <span className="text-[11px] text-[#979797]">
            {snapshot.topFiles.length} registro(s)
          </span>
        </div>

        {snapshot.topFiles.length === 0 ? (
          <p className="text-[12px] text-[#6A6A6A] py-3">
            Nenhum arquivo grande registrado no catálogo local.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {snapshot.topFiles.map((file) => (
              <div
                key={file.arquivo_id}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                    <span className="text-[12.5px] font-medium text-white truncate">
                      {file.nome}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#6A6A6A] truncate pl-5">
                    {file.caminho_relativo}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11.5px] font-mono text-[#DCDCDC] tabular-nums">
                    {formatStorageBytes(file.bytes)}
                  </span>
                  {onDeleteFile && (
                    confirmFileId === file.arquivo_id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            await onDeleteFile(file.arquivo_id);
                            setConfirmFileId(null);
                          }}
                          className="rounded-md bg-[#FD2F3B] px-2 py-1 text-[11px] font-semibold text-white"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmFileId(null)}
                          className="rounded-md bg-[#2A2A2A] px-2 py-1 text-[11px] text-[#DCDCDC]"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmFileId(file.arquivo_id)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-2 py-1 text-[11px] font-semibold text-[#FF7675] hover:bg-[#FD2F3B]/20"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Excluir arquivo</span>
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export interface WhatsNewPanelProps {
  whatsNew: WhatsNewReleaseInfo | null;
  checking?: boolean;
  hideSummaryHeader?: boolean;
  onCheckUpdates?: () => Promise<void>;
}

export const WhatsNewPanel: React.FC<WhatsNewPanelProps> = ({
  whatsNew,
  checking = false,
  hideSummaryHeader = false,
  onCheckUpdates,
}) => {
  const [showAllHistory, setShowAllHistory] = useState(false);

  const notes = whatsNew?.notas ?? [];
  const visibleNotes = showAllHistory ? notes : notes.slice(0, 2);

  return (
    <div className="space-y-4">
      {!hideSummaryHeader && (
        <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#42A0FF]" />
              <span className="text-[14px] font-semibold text-white">
                Versão instalada
              </span>
              <span className="rounded-md bg-[#141414] border border-white/10 px-2 py-0.5 font-mono text-[12px] text-[#42A0FF]">
                v{whatsNew?.versao_atual ?? "1.0.0"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#979797]">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>
                {whatsNew?.atualizacao_disponivel
                  ? "Nova versão local detectada nas notas de lançamento."
                  : "Ambiente local atualizado conforme manifesto."}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onCheckUpdates && (
              <button
                type="button"
                disabled={checking}
                onClick={() => void onCheckUpdates()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
                <span>Verificar atualizações</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAllHistory((v) => !v)}
              className="rounded-lg border border-white/10 bg-[#141414] px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
            >
              {showAllHistory ? "Recolher histórico" : "Abrir histórico de versões"}
            </button>
          </div>
        </div>
      )}

      {visibleNotes.map((rel) => (
        <div
          key={rel.versao}
          className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <span className="font-mono text-[12px] font-semibold text-white">
              v{rel.versao}
            </span>
            <span className="text-[11px] text-[#979797]">{rel.data}</span>
          </div>

          {rel.added.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#31CF76]">
                Novidades
              </div>
              <ul className="space-y-1 pl-3 text-[12.5px] text-[#DCDCDC]">
                {rel.added.map((line, i) => (
                  <li key={i}>• {line}</li>
                ))}
              </ul>
            </div>
          )}

          {rel.changed.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#42A0FF]">
                Melhorias
              </div>
              <ul className="space-y-1 pl-3 text-[12.5px] text-[#DCDCDC]">
                {rel.changed.map((line, i) => (
                  <li key={i}>• {line}</li>
                ))}
              </ul>
            </div>
          )}

          {rel.fixed.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#FF9412]">
                Correções
              </div>
              <ul className="space-y-1 pl-3 text-[12.5px] text-[#DCDCDC]">
                {rel.fixed.map((line, i) => (
                  <li key={i}>• {line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {hideSummaryHeader && notes.length > 2 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAllHistory((v) => !v)}
            className="rounded-lg border border-white/10 bg-[#141414] px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
          >
            {showAllHistory ? "Recolher histórico" : "Abrir histórico completo"}
          </button>
        </div>
      )}
    </div>
  );
};
