import React, { useCallback, useEffect, useState } from "react";
import type {
  MetaMediaAuditAction,
  MetaMediaAuditLogRecord,
  MetaMediaAuditOutcome,
} from "@criativo/contracts";
import { History, Loader2, RefreshCw, X } from "lucide-react";
import { socialStudioApi } from "../../services/api/social-studio-api";

export interface MetaAuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
}

type ActionFilter = "todas" | "delete_media" | "first_comment" | "trial_reel";

const ACTION_FILTERS: Array<{ value: ActionFilter; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "delete_media", label: "Exclusão" },
  { value: "first_comment", label: "1º Comentário" },
  { value: "trial_reel", label: "Trial Reel" },
];

const ACTION_LABELS: Record<MetaMediaAuditAction, string> = {
  publish: "Publicação",
  trial_reel: "Trial Reel",
  first_comment: "1º Comentário",
  delete_media: "Exclusão",
  cache_remove: "Cache Local",
};

const OUTCOME_META: Record<MetaMediaAuditOutcome, { label: string; badgeClass: string }> = {
  deleted_remote: { label: "Removido remoto", badgeClass: "bg-[#31CF76]/15 text-[#31CF76]" },
  unsupported_by_meta_api: {
    label: "Limitação Meta API",
    badgeClass: "bg-[#FF9412]/15 text-[#FFB44D]",
  },
  blocked: { label: "Bloqueado", badgeClass: "bg-[#FD2F3B]/15 text-[#FF8A90]" },
  success: { label: "Sucesso", badgeClass: "bg-[#31CF76]/15 text-[#31CF76]" },
  failed: { label: "Falha", badgeClass: "bg-[#FD2F3B]/15 text-[#FF8A90]" },
};

function formatDateTimePt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Drawer lateral de consulta da trilha de auditoria Meta Graph API (META41-03).
 */
export const MetaAuditLogDrawer: React.FC<MetaAuditLogDrawerProps> = ({ open, onClose }) => {
  const [actionFilter, setActionFilter] = useState<ActionFilter>("todas");
  const [logs, setLogs] = useState<MetaMediaAuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const items = await socialStudioApi.listInstagramAuditLogs({
        action: actionFilter === "todas" ? undefined : actionFilter,
        limit: 80,
      });
      setLogs(items);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao carregar logs de auditoria.");
    } finally {
      setLoading(false);
    }
  }, [open, actionFilter]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trilha de Auditoria Meta"
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs"
    >
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#141414] text-[#F0F0F0] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0D0D0D] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <History className="h-5 w-5 text-[#42A0FF]" />
            <div>
              <h2 className="text-base font-semibold text-white">Auditoria Meta Graph API</h2>
              <p className="text-[11px] text-[#979797]">
                Histórico de exclusões, bloqueios de segurança, 1º comentário e Trial Reels.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadLogs()}
              aria-label="Atualizar auditoria Meta"
              className="rounded-lg border border-white/10 bg-[#1A1A1A] p-1.5 text-[#979797] hover:text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            <button
              type="button"
              aria-label="Fechar auditoria Meta"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#979797] hover:bg-[#212121] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] bg-[#111111] px-5 py-3">
          {ACTION_FILTERS.map((item) => {
            const active = actionFilter === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setActionFilter(item.value)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[#42A0FF]/20 text-[#42A0FF] ring-1 ring-[#42A0FF]/40"
                    : "bg-[#1A1A1A] text-[#979797] hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          {errorMsg && (
            <div className="rounded-xl border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-3 py-2 text-xs text-[#FF8A90]">
              {errorMsg}
            </div>
          )}

          {loading && logs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-[#979797]">
              <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
              <span>Consultando trilha de auditoria...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-[#1A1A1A] py-12 text-center text-xs text-[#979797]">
              Nenhum evento auditado encontrado para este filtro.
            </div>
          ) : (
            logs.map((log) => {
              const out = OUTCOME_META[log.outcome];
              return (
                <article
                  key={log.audit_id}
                  className="rounded-xl border border-white/[0.08] bg-[#1A1A1A] p-3 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] font-medium text-white">
                        {ACTION_LABELS[log.action]}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${out.badgeClass}`}>
                        {out.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10.5px] text-[#979797]">
                      {formatDateTimePt(log.criado_em)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#979797]">
                    <span className="font-mono">media_id: {log.media_id}</span>
                    <span>Ator: {log.actor_label}</span>
                  </div>

                  {log.reason && (
                    <p className="text-xs leading-relaxed text-[#DCDCDC]">{log.reason}</p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
