import { useState } from "react";
import type { WorkflowBatchVariantResult } from "@criativo/contracts";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { daemonApi } from "../../services/websocket-client";

const BATCH_OPTIONS = [1, 2, 3, 4] as const;

export function WorkflowBatchGallery({
  kind,
  stepId,
  batchCount,
  selectedVariantIndex = 0,
  variants = [],
  readOnly = false,
  onChangeBatchCount,
  onSelectPrimaryVariant,
  onVariantRetried,
}: {
  kind: "gerar_imagem" | "render_video";
  stepId?: string;
  batchCount: 1 | 2 | 3 | 4;
  selectedVariantIndex?: number;
  variants?: WorkflowBatchVariantResult[];
  readOnly?: boolean;
  onChangeBatchCount: (count: 1 | 2 | 3 | 4) => void;
  onSelectPrimaryVariant: (slotIndex: number) => void;
  onVariantRetried?: () => void;
}) {
  const [retryingSlot, setRetryingSlot] = useState<number | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetrySlot = async (slotIndex: number) => {
    if (!stepId || readOnly) return;
    setRetryingSlot(slotIndex);
    setRetryError(null);
    try {
      await daemonApi.retryWorkflowStepVariant(stepId, slotIndex);
      onVariantRetried?.();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Falha ao retentar variação.");
    } finally {
      setRetryingSlot(null);
    }
  };

  return (
    <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[#979797]">Lote simultâneo:</span>
        <div className="flex items-center gap-1 rounded-lg bg-[#181818] p-0.5">
          {BATCH_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              disabled={readOnly}
              data-testid={`workflow-batch-count-${count}`}
              onClick={() => onChangeBatchCount(count)}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                batchCount === count
                  ? "bg-[#007CF7] text-white"
                  : "text-[#979797] hover:text-white"
              }`}
            >
              {count}x
            </button>
          ))}
        </div>
      </div>

      {retryError && (
        <p className="rounded bg-[#FD2F3B]/15 px-2 py-1 text-[11px] text-[#FD2F3B]">
          {retryError}
        </p>
      )}

      {variants.length > 0 && (
        <div className={`grid gap-1.5 ${variants.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {variants.map((v) => {
            const isPrimary = selectedVariantIndex === v.slotIndex;
            const isBusy = retryingSlot === v.slotIndex || v.status === "running";
            const rawUrl = v.relPath ? `/api/arquivos/raw?path=${encodeURIComponent(v.relPath)}` : "";

            return (
              <div
                key={v.slotIndex}
                className={`space-y-1 rounded-lg border bg-[#101010] p-1 ${
                  isPrimary
                    ? "border-[#31CF76]/60"
                    : v.status === "failed"
                      ? "border-[#FD2F3B]/40"
                      : "border-white/[0.08]"
                }`}
              >
                {v.status === "done" && rawUrl ? (
                  kind === "gerar_imagem" ? (
                    <img
                      src={rawUrl}
                      alt={`Variação ${v.slotIndex + 1}`}
                      className="h-20 w-full rounded object-cover"
                    />
                  ) : (
                    <video
                      src={rawUrl}
                      controls
                      muted
                      playsInline
                      className="h-20 w-full rounded bg-black object-contain"
                    />
                  )
                ) : (
                  <div className="flex h-20 items-center justify-center rounded bg-[#1A1A1A] p-1 text-center text-[10px] text-[#FD2F3B]">
                    {isBusy ? "Gerando..." : v.error || "Falhou"}
                  </div>
                )}

                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <button
                    type="button"
                    disabled={readOnly || v.status !== "done"}
                    onClick={() => onSelectPrimaryVariant(v.slotIndex)}
                    className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium ${
                      isPrimary
                        ? "bg-[#31CF76]/20 text-[#31CF76]"
                        : "bg-[#242424] text-[#DCDCDC] hover:bg-[#2A2A2A] disabled:opacity-40"
                    }`}
                  >
                    {isPrimary && <Check className="h-2.5 w-2.5" />}
                    <span>#{v.slotIndex + 1}</span>
                  </button>

                  {stepId && !readOnly && (
                    <button
                      type="button"
                      disabled={isBusy}
                      title={`Retentar variação #${v.slotIndex + 1}`}
                      aria-label={`Retentar variação #${v.slotIndex + 1}`}
                      onClick={() => void handleRetrySlot(v.slotIndex)}
                      className="flex items-center gap-0.5 rounded bg-[#242424] px-1.5 py-0.5 text-[#FF9412] hover:bg-[#2A2A2A] disabled:opacity-40"
                    >
                      {isBusy ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-2.5 w-2.5" />
                      )}
                      <span>Retentar</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
