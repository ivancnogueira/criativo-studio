import React, { useEffect, useState } from "react";
import type { MetaGalleryPostItem } from "@criativo/contracts";
import { AlertTriangle, ExternalLink, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import {
  socialStudioApi,
  type MetaMediaDeletionApiResponse,
} from "../../services/api/social-studio-api";

export interface MetaMediaDeleteModalProps {
  post: MetaGalleryPostItem | null;
  onClose: () => void;
  onCompleted: (info: {
    mediaId: string;
    deletedRemote: boolean;
    removedLocalCache: boolean;
  }) => void;
}

/**
 * Modal de confirmação dupla para exclusão controlada de mídia publicada (META41-03).
 * Exige aprovação humana + digitação de "EXCLUIR" ou do media_id e trata limitações da Meta API.
 */
export const MetaMediaDeleteModal: React.FC<MetaMediaDeleteModalProps> = ({
  post,
  onClose,
  onCompleted,
}) => {
  const [approved, setApproved] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unsupportedResult, setUnsupportedResult] =
    useState<MetaMediaDeletionApiResponse | null>(null);

  useEffect(() => {
    setApproved(false);
    setConfirmText("");
    setReason("");
    setSubmitting(false);
    setErrorMsg(null);
    setUnsupportedResult(null);
  }, [post?.id]);

  if (!post) return null;

  const trimmedConfirm = confirmText.trim();
  const confirmValid =
    trimmedConfirm.toUpperCase() === "EXCLUIR" || trimmedConfirm === post.id;

  const executeDelete = async (removeFromLocalCache: boolean) => {
    if (!approved || !confirmValid) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await socialStudioApi.deleteInstagramMedia(post.id, {
        approved_by_human: true,
        confirm_text: trimmedConfirm,
        reason: reason.trim() || undefined,
        remove_from_local_cache: removeFromLocalCache,
      });

      if (res.deleted_remote || res.removed_local_cache) {
        onCompleted({
          mediaId: post.id,
          deletedRemote: res.deleted_remote,
          removedLocalCache: res.removed_local_cache,
        });
        onClose();
        return;
      }

      if (res.limitation_code === "META_DELETE_UNSUPPORTED") {
        setUnsupportedResult(res);
        return;
      }

      setErrorMsg(res.message || "Não foi possível excluir esta mídia.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao excluir publicação.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Excluir publicação do Instagram"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#141414] p-5 text-[#F0F0F0] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FD2F3B]/15 text-[#FD2F3B]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Exclusão Controlada Meta</h2>
              <p className="font-mono text-[11px] text-[#979797]">media_id: {post.id}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar modal de exclusão"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#979797] hover:bg-[#212121] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="rounded-xl border border-white/[0.06] bg-[#1A1A1A] p-3 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#979797]">
            Formato: {post.formato_normalizado}
          </p>
          <p className="line-clamp-3 text-xs leading-relaxed text-[#DCDCDC]">
            {post.caption_resumo || "Publicação sem legenda resumida."}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 p-3 text-xs text-[#FFB3B7]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FD2F3B]" />
          <p>
            Quando suportada pela Meta Graph API v27.0, a remoção na conta Instagram é{" "}
            <strong>irreversível</strong> e também limpa o espelho local e comentários pendentes na fila.
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.08] bg-[#0D0D0D] p-3 text-xs text-[#DCDCDC]">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#141414] accent-[#FD2F3B]"
            />
            <span>
              Aprovo explicitamente a exclusão desta mídia e confirmo ciência de que a ação pode ser irreversível.
            </span>
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">
              Digite <code className="rounded bg-[#212121] px-1.5 py-0.5 text-[#FF8A90]">EXCLUIR</code> ou o{" "}
              <code className="rounded bg-[#212121] px-1.5 py-0.5 text-[#DCDCDC]">{post.id}</code>
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 text-xs text-white placeholder:text-[#6A6A6A] focus:border-[#FD2F3B] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">
              Motivo da auditoria (opcional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: Conteúdo duplicado ou campanha encerrada"
              className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 text-xs text-white placeholder:text-[#6A6A6A] focus:border-[#42A0FF] focus:outline-none"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-3 py-2 text-xs text-[#FF8A90]">
            {errorMsg}
          </div>
        )}

        {unsupportedResult && (
          <div className="space-y-2.5 rounded-xl border border-[#FF9412]/40 bg-[#FF9412]/10 p-3 text-xs text-[#FFD08A]">
            <p className="font-medium">{unsupportedResult.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              {post.permalink && (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#141414] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#212121]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Abrir publicação no Instagram</span>
                </a>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={() => void executeDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF9412] px-3 py-1.5 text-xs font-semibold text-[#0D0D0D] hover:bg-[#FFA73D] disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Remover apenas do cache local após excluir no app</span>
              </button>
            </div>
          </div>
        )}

        <footer className="flex justify-end gap-2 border-t border-white/[0.06] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-[#212121] px-4 py-2 text-xs font-medium text-[#DCDCDC] hover:bg-[#2A2A2A]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!approved || !confirmValid || submitting}
            onClick={() => void executeDelete(false)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#FD2F3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#FF4B55] disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            <span>Excluir publicação</span>
          </button>
        </footer>
      </div>
    </div>
  );
};
