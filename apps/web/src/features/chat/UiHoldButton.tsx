import React, { useCallback, useEffect, useRef, useState } from "react";

export interface UiHoldButtonProps {
  label?: string;
  durationMs?: number;
  tone?: "default" | "primary" | "warning" | "danger";
  disabled?: boolean;
  onConfirmed: () => void;
}

function clampHoldDuration(ms?: number): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return 800;
  return Math.max(400, Math.min(3000, Math.round(ms)));
}

function resolveProgressColor(tone?: UiHoldButtonProps["tone"]): string {
  if (tone === "danger") return "#FD2F3B";
  if (tone === "warning") return "#FF9412";
  return "#007CF7";
}

/**
 * Botao de pressionar e segurar (confirmHold) de 400..3000ms (CHAT-02).
 * Suporta pointer continuo, teclas Enter/Space e fallback acessivel em 2 passos para leitores de tela.
 */
export function UiHoldButton({
  label = "Segurar para aprovar",
  durationMs,
  tone = "primary",
  disabled = false,
  onConfirmed,
}: UiHoldButtonProps): React.ReactElement {
  const targetMs = clampHoldDuration(durationMs);
  const fillColor = resolveProgressColor(tone);

  const [progress, setProgress] = useState<number>(0);
  const [fallbackConfirmOpen, setFallbackConfirmOpen] = useState<boolean>(false);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const completedRef = useRef<boolean>(false);

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startTimeRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopAnimation();
  }, [stopAnimation]);

  const startHold = useCallback(() => {
    if (disabled || typeof window === "undefined") return;
    stopAnimation();
    completedRef.current = false;
    startTimeRef.current = performance.now();

    const tick = (now: number): void => {
      if (startTimeRef.current === null) return;
      const elapsed = now - startTimeRef.current;
      const ratio = Math.min(1, elapsed / targetMs);
      setProgress(ratio * 100);
      if (ratio >= 1) {
        completedRef.current = true;
        stopAnimation();
        setProgress(0);
        setFallbackConfirmOpen(false);
        onConfirmed();
        return;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
  }, [disabled, onConfirmed, stopAnimation, targetMs]);

  const releaseHold = useCallback(
    (allowAssistiveFallback = false) => {
      const wasStarted = startTimeRef.current !== null;
      const elapsed =
        wasStarted && typeof performance !== "undefined"
          ? performance.now() - (startTimeRef.current ?? 0)
          : 0;
      stopAnimation();
      if (!completedRef.current) {
        setProgress(0);
        if (allowAssistiveFallback && wasStarted && elapsed < 220 && !disabled) {
          setFallbackConfirmOpen(true);
        }
      }
    },
    [disabled, stopAnimation],
  );

  if (fallbackConfirmOpen) {
    return (
      <div className="flex items-center gap-2 flex-wrap rounded-lg bg-[#242424] border border-[rgba(255,255,255,0.12)] px-4 py-2">
        <span className="text-[12px] font-semibold text-[#DCDCDC]">
          Tem certeza que deseja executar esta ação?
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setFallbackConfirmOpen(false);
            onConfirmed();
          }}
          style={{ backgroundColor: fillColor }}
          className="rounded-md px-2 py-1 text-[12px] font-semibold text-[#FFFFFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          Confirmar execução
        </button>
        <button
          type="button"
          onClick={() => setFallbackConfirmOpen(false)}
          className="rounded-md bg-[#1A1A1A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
        >
          Recusar ação
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={() => startHold()}
      onPointerUp={() => releaseHold(true)}
      onPointerLeave={() => releaseHold(false)}
      onPointerCancel={() => releaseHold(false)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          startHold();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          releaseHold(true);
        }
      }}
      className="relative overflow-hidden rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-4 py-2 text-[14px] font-semibold text-[#FFFFFF] disabled:opacity-50 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
    >
      <span
        aria-hidden="true"
        style={{
          width: `${progress}%`,
          backgroundColor: fillColor,
          opacity: 0.35,
        }}
        className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-75"
      />
      <span
        aria-hidden="true"
        style={{
          width: `${progress}%`,
          backgroundColor: fillColor,
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-1"
      />
      <span className="relative z-10">{label}</span>
    </button>
  );
}
