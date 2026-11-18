import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

const UNDO_DURATION_MS = 6000;

export interface PendingWorkflowDelete {
  workflowId: string;
  nome: string;
}

export interface WorkflowDeleteUndoToastProps {
  pending: PendingWorkflowDelete | null;
  onUndoDelete: (workflowId: string) => void;
  onCommitDelete: (workflowId: string) => Promise<void> | void;
}

export const WorkflowDeleteUndoToast: React.FC<WorkflowDeleteUndoToastProps> = ({
  pending,
  onUndoDelete,
  onCommitDelete,
}) => {
  const [remainingMs, setRemainingMs] = useState(UNDO_DURATION_MS);
  const [paused, setPaused] = useState(false);
  const committedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setRemainingMs(UNDO_DURATION_MS);
      setPaused(false);
      committedRef.current = null;
      return;
    }
    setRemainingMs(UNDO_DURATION_MS);
    setPaused(false);
    committedRef.current = null;
  }, [pending?.workflowId]);

  useEffect(() => {
    if (!pending || paused) return;

    const timer = window.setInterval(() => {
      setRemainingMs((prev) => {
        const next = Math.max(0, prev - 50);
        if (next === 0 && committedRef.current !== pending.workflowId) {
          committedRef.current = pending.workflowId;
          void onCommitDelete(pending.workflowId);
        }
        return next;
      });
    }, 50);

    return () => window.clearInterval(timer);
  }, [pending, paused, onCommitDelete]);

  if (!pending) return null;

  const pct = Math.max(0, Math.min(100, (remainingMs / UNDO_DURATION_MS) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="fixed bottom-4 right-4 z-50 w-[340px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#212121] p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-white">
            <Trash2 className="h-4 w-4 text-[#FD2F3B]" />
            <span>Fluxo excluído</span>
          </div>
          <p className="mt-1 truncate text-[12px] text-[#DCDCDC]">
            {pending.nome} · Você tem 6 segundos para desfazer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onUndoDelete(pending.workflowId)}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414] hover:bg-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Desfazer exclusão</span>
        </button>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#141414]">
        <div
          className="h-full bg-[#007CF7] transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
