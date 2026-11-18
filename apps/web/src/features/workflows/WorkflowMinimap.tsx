import React, { useMemo, useRef } from "react";
import type { WorkflowNo, WorkflowTraco } from "@criativo/contracts";
import { computeGraphBounds, getWorkflowNodeWidth } from "./workflow-canvas-helpers";

export interface WorkflowMinimapProps {
  nos: WorkflowNo[];
  tracos?: WorkflowTraco[];
  selectedNodeId: string | null;
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
  };
  onPanToWorld: (worldX: number, worldY: number) => void;
}

export const WorkflowMinimap: React.FC<WorkflowMinimapProps> = ({
  nos,
  tracos = [],
  selectedNodeId,
  viewport,
  onPanToWorld,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const bounds = useMemo(() => {
    const raw = computeGraphBounds(nos, tracos);
    const pad = 80;
    return {
      minX: raw.minX - pad,
      minY: raw.minY - pad,
      width: raw.width + pad * 2,
      height: raw.height + pad * 2,
    };
  }, [nos, tracos]);

  const toWorldPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return {
      x: bounds.minX + relX * bounds.width,
      y: bounds.minY + relY * bounds.height,
    };
  };

  const viewWorldWidth = viewport.width / Math.max(0.25, viewport.zoom);
  const viewWorldHeight = viewport.height / Math.max(0.25, viewport.zoom);

  return (
    <div
      aria-label="Minimapa do fluxo"
      className="h-[128px] w-[200px] rounded-xl border border-white/[0.12] bg-[#212121]/95 p-2 shadow-2xl"
    >
      <svg
        ref={svgRef}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        className="h-full w-full cursor-crosshair select-none rounded-lg bg-[#141414]"
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const pt = toWorldPoint(e.clientX, e.clientY);
          if (pt) onPanToWorld(pt.x, pt.y);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          const pt = toWorldPoint(e.clientX, e.clientY);
          if (pt) onPanToWorld(pt.x, pt.y);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
      >
        {tracos.map((t) => (
          <polyline
            key={t.id}
            fill="none"
            stroke={t.color ?? "#6A6A6A"}
            strokeWidth={Math.max(4, t.width ?? 4)}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={t.points.map(([px, py]) => `${px},${py}`).join(" ")}
          />
        ))}

        {nos.map((n) => {
          const w = getWorkflowNodeWidth(n);
          const h = n.height ?? 140;
          const isSelected = n.id === selectedNodeId;
          return (
            <rect
              key={n.id}
              x={n.x}
              y={n.y}
              width={w}
              height={h}
              rx={16}
              fill={isSelected ? "#007CF7" : "#2A2A2A"}
              fillOpacity={isSelected ? 0.35 : 0.9}
              stroke={isSelected ? "#007CF7" : "rgba(255,255,255,0.18)"}
              strokeWidth={12}
            />
          );
        })}

        <rect
          x={viewport.x}
          y={viewport.y}
          width={Math.max(120, viewWorldWidth)}
          height={Math.max(80, viewWorldHeight)}
          fill="#007CF7"
          fillOpacity={0.08}
          stroke="#007CF7"
          strokeWidth={14}
          rx={12}
        />
      </svg>
    </div>
  );
};
