import React, { useCallback, useEffect, useState } from "react";
import type { MetaFirstCommentRecord, MetaFirstCommentStatus } from "@criativo/contracts";
import { CheckCircle2, Clock, Loader2, MessageSquarePlus, RefreshCw, XCircle } from "lucide-react";
import { socialStudioApi } from "../../services/api/social-studio-api";

export interface MetaFirstCommentPanelProps {
  commentText: string;
  approved: boolean;
  delaySeconds: number;
  mediaId?: string | null;
  editorialPostId?: string | null;
  onChangeCommentText: (text: string) => void;
  onChangeApproved: (approved: boolean) => void;
  onChangeDelaySeconds: (seconds: number) => void;
}

const MAX_COMMENT_LENGTH = 2200;

const DELAY_OPTIONS: Array<{ seconds: number; label: string }> = [
  { seconds: 0, label: "0s (Imediato)" },
  { seconds: 30, label: "30s (Recomendado)" },
  { seconds: 60, label: "60s" },
  { seconds: 120, label: "120s" },
];

const STATUS_BADGE: Record<MetaFirstCommentStatus, { label: string; badgeClass: string }> = {
  pending_approval: { label: "Aguardando aprovação", badgeClass: "bg-[#FF9412]/15 text-[#FFB44D]" },
  scheduled: { label: "Agendado", badgeClass: "bg-[#42A0FF]/15 text-[#42A0FF]" },
  processing: { label: "Processando", badgeClass: "bg-[#42A0FF]/20 text-[#7CC0FF]" },
  posted: { label: "Publicado", badgeClass: "bg-[#31CF76]/15 text-[#31CF76]" },
  failed: { label: "Falha", badgeClass: "bg-[#FD2F3B]/15 text-[#FF8A90]" },
  cancelled: { label: "Cancelado", badgeClass: "bg-white/10 text-[#979797]" },
};

/**
 * Painel de configuração e fila do Primeiro Comentário automático pós-publicação (META41-02).
 * Mantém trava explícita de aprovação humana (desmarcada por padrão) e controles Carbon Dark sem seletor HTML nativo.
 */
export const MetaFirstCommentPanel: React.FC<MetaFirstCommentPanelProps> = ({
  commentText,
  approved,
  delaySeconds,
  mediaId,
  editorialPostId,
  onChangeCommentText,
  onChangeApproved,
  onChangeDelaySeconds,
}) => {
  const [jobs, setJobs] = useState<MetaFirstCommentRecord[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [schedulingNow, setSchedulingNow] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    if (!mediaId) return;
    setLoadingJobs(true);
    setErrorMsg(null);
    try {
      const list = await socialStudioApi.listFirstComments({ media_id: mediaId });
      setJobs(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao carregar fila do 1º comentário.");
    } finally {
      setLoadingJobs(false);
    }
  }, [mediaId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleScheduleForPublishedMedia = async () => {
    if (!mediaId || !commentText.trim()) return;
    setSchedulingNow(true);
    setErrorMsg(null);
    try {
      const created = await socialStudioApi.scheduleFirstComment({
        media_id: mediaId,
        comment_text: commentText.trim(),
        approved_by_human: approved,
        delay_seconds: delaySeconds,
        editorial_post_id: editorialPostId ?? null,
      });
      setJobs((prev) => [created, ...prev]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao enfileirar 1º comentário.");
    } finally {
      setSchedulingNow(false);
    }
  };

  const handleApproveJob = async (jobId: string) => {
    setBusyJobId(jobId);
    setErrorMsg(null);
    try {
      const updated = await socialStudioApi.approveFirstComment(jobId, delaySeconds);
      setJobs((prev) => prev.map((j) => (j.comment_job_id === jobId ? updated : j)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao aprovar disparo.");
    } finally {
      setBusyJobId(null);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    setBusyJobId(jobId);
    setErrorMsg(null);
    try {
      const updated = await socialStudioApi.cancelFirstComment(jobId);
      setJobs((prev) => prev.map((j) => (j.comment_job_id === jobId ? updated : j)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao cancelar disparo.");
    } finally {
      setBusyJobId(null);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#1A1A1A] p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <MessageSquarePlus className="h-4 w-4 text-[#31CF76]" />
          <span className="text-xs font-semibold text-white">1º Comentário Automático</span>
        </div>
        <span
          className={`font-mono text-[10.5px] ${
            commentText.length > MAX_COMMENT_LENGTH ? "text-[#FD2F3B]" : "text-[#979797]"
          }`}
        >
          {commentText.length} / {MAX_COMMENT_LENGTH}
        </span>
      </div>

      <textarea
        rows={3}
        maxLength={MAX_COMMENT_LENGTH + 100}
        value={commentText}
        onChange={(e) => onChangeCommentText(e.target.value)}
        placeholder="Hashtags estratégicas, CTA complementar ou link para [@SEU_PERFIL]..."
        className="w-full resize-none rounded-lg border border-white/10 bg-[#0D0D0D] p-2.5 text-xs leading-relaxed text-white placeholder:text-[#6A6A6A] focus:border-[#31CF76] focus:outline-none"
      />

      <div className="space-y-1.5">
        <span className="flex items-center gap-1 text-[11px] font-medium text-[#DCDCDC]">
          <Clock className="h-3 w-3 text-[#42A0FF]" />
          <span>Atraso após publicação</span>
        </span>
        <div
          className="grid grid-cols-2 gap-1.5"
          role="radiogroup"
          aria-label="Atraso após publicação do primeiro comentário"
        >
          {DELAY_OPTIONS.map((opt) => {
            const active = delaySeconds === opt.seconds;
            return (
              <button
                key={opt.seconds}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChangeDelaySeconds(opt.seconds)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-[#42A0FF]/70 bg-[#42A0FF]/15 text-white"
                    : "border-white/10 bg-[#141414] text-[#979797] hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.06] bg-[#141414] p-2 text-[11px] text-[#DCDCDC]">
        <input
          type="checkbox"
          checked={approved}
          onChange={(e) => onChangeApproved(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-[#0D0D0D] accent-[#31CF76]"
        />
        <span>Aprovo a publicação automática deste 1º comentário após o post ir ao ar</span>
      </label>

      {mediaId && (
        <div className="space-y-2 border-t border-white/[0.06] pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-[#DCDCDC]">
              Fila desta mídia ({jobs.length})
            </span>
            <div className="flex items-center gap-1.5">
              {commentText.trim() && (
                <button
                  type="button"
                  disabled={schedulingNow || commentText.length > MAX_COMMENT_LENGTH}
                  onClick={() => void handleScheduleForPublishedMedia()}
                  className="rounded-md bg-[#31CF76]/20 px-2 py-1 text-[10.5px] font-semibold text-[#31CF76] hover:bg-[#31CF76]/30 disabled:opacity-40"
                >
                  {schedulingNow ? "Enviando..." : "Enfileirar"}
                </button>
              )}
              <button
                type="button"
                disabled={loadingJobs}
                onClick={() => void loadJobs()}
                aria-label="Atualizar fila de primeiro comentário"
                className="rounded-md border border-white/10 bg-[#141414] p-1 text-[#979797] hover:text-white disabled:opacity-40"
              >
                {loadingJobs ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <p className="rounded-md bg-[#FD2F3B]/10 px-2 py-1 text-[10.5px] text-[#FF8A90]">
              {errorMsg}
            </p>
          )}

          {jobs.map((job) => {
            const st = STATUS_BADGE[job.status];
            const canApprove = job.status === "pending_approval" || job.status === "failed";
            const canCancel = job.status !== "posted" && job.status !== "cancelled";
            const isBusy = busyJobId === job.comment_job_id;
            return (
              <div
                key={job.comment_job_id}
                className="rounded-lg border border-white/[0.06] bg-[#141414] p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${st.badgeClass}`}>
                    {st.label}
                  </span>
                  <span className="font-mono text-[10px] text-[#979797]">{job.delay_seconds}s</span>
                </div>
                <p className="line-clamp-2 text-[11px] text-[#DCDCDC]">{job.comment_text}</p>
                {job.last_error && (
                  <p className="text-[10px] text-[#FF8A90]">{job.last_error}</p>
                )}
                {(canApprove || canCancel) && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {canApprove && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleApproveJob(job.comment_job_id)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-[#31CF76] px-2 py-1 text-[10.5px] font-semibold text-[#0D0D0D] hover:bg-[#3CE084] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Aprovar Disparo</span>
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleCancelJob(job.comment_job_id)}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-white/10 bg-[#212121] px-2 py-1 text-[10.5px] text-[#DCDCDC] hover:bg-[#2A2A2A] disabled:opacity-50"
                      >
                        <XCircle className="h-3 w-3" />
                        <span>Cancelar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
