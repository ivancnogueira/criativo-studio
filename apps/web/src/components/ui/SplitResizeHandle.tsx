import React, { useEffect, useRef, useState } from "react";

export interface SplitResizeHandleProps {
  orientation?: "vertical";
  ariaLabel: string;
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  invertDirection?: boolean;
  onResize: (nextWidth: number) => void;
  onCollapse?: () => void;
  onReset: () => void;
  onResizeEnd?: (finalWidth: number) => void;
}

/**
 * Divisor vertical arrastável e acessível para redimensionar as colunas do Cockpit
 * com suporte a mouse/ponteiro, teclas de seta, duplo clique para restaurar padrão e colapso automático.
 */
export const SplitResizeHandle: React.FC<SplitResizeHandleProps> = ({
  orientation = "vertical",
  ariaLabel,
  currentWidth,
  minWidth,
  maxWidth,
  invertDirection = false,
  onResize,
  onCollapse,
  onReset,
  onResizeEnd,
}) => {
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; initialWidth: number; lastWidth: number } | null>(null);

  useEffect(() => {
    if (!dragging || typeof window === "undefined") return;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (evt: PointerEvent) => {
      const origin = dragStartRef.current;
      if (!origin) return;
      const rawDelta = evt.clientX - origin.clientX;
      const delta = invertDirection ? -rawDelta : rawDelta;
      const rawNext = origin.initialWidth + delta;

      if (onCollapse && rawNext < minWidth - 60) {
        dragStartRef.current = null;
        setDragging(false);
        onCollapse();
        return;
      }

      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(rawNext)));
      origin.lastWidth = clamped;
      onResize(clamped);
    };

    const handlePointerUp = () => {
      const origin = dragStartRef.current;
      dragStartRef.current = null;
      setDragging(false);
      if (origin && onResizeEnd) {
        onResizeEnd(origin.lastWidth);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragging, invertDirection, minWidth, maxWidth, onCollapse, onResize, onResizeEnd]);

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    if (evt.key !== "ArrowLeft" && evt.key !== "ArrowRight") return;
    evt.preventDefault();
    const step = evt.shiftKey ? 32 : 16;
    const dir = evt.key === "ArrowRight" ? 1 : -1;
    const signed = invertDirection ? -dir * step : dir * step;
    const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(currentWidth + signed)));
    onResize(clamped);
    onResizeEnd?.(clamped);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(currentWidth)}
      tabIndex={0}
      title="Arraste para redimensionar · Duplo clique para restaurar"
      onPointerDown={(evt) => {
        if (evt.button !== 0) return;
        evt.preventDefault();
        dragStartRef.current = {
          clientX: evt.clientX,
          initialWidth: currentWidth,
          lastWidth: currentWidth,
        };
        setDragging(true);
      }}
      onDoubleClick={() => onReset()}
      onKeyDown={handleKeyDown}
      className="group relative w-[6px] -mx-[2px] z-20 shrink-0 cursor-col-resize flex items-center justify-center focus:outline-none select-none"
    >
      <div
        className={`h-full transition-colors ${
          dragging
            ? "w-[2px] bg-[#007CF7]"
            : "w-[1px] bg-transparent group-hover:w-[2px] group-hover:bg-[#007CF7]/70 group-focus:w-[2px] group-focus:bg-[#007CF7]"
        }`}
      />
    </div>
  );
};
