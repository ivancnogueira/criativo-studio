import React, { useMemo, useState } from "react";
import type { WorkflowNo } from "@criativo/contracts";
import { Search, X } from "lucide-react";
import { searchWorkflowNodes, type WorkflowNodeRunView } from "./workflow-canvas-helpers";

export interface WorkflowSearchProps {
  open: boolean;
  nos: WorkflowNo[];
  runViewMap: Map<string, WorkflowNodeRunView>;
  onSelectResult: (nodeId: string) => void;
  onClose: () => void;
}

export const WorkflowSearch: React.FC<WorkflowSearchProps> = ({
  open,
  nos,
  runViewMap,
  onSelectResult,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(
    () => searchWorkflowNodes(nos, runViewMap, query),
    [nos, runViewMap, query]
  );

  if (!open) return null;

  return (
    <div
      role="search"
      aria-label="Buscar etapa no fluxo"
      className="w-[320px] rounded-xl border border-white/[0.12] bg-[#212121] p-2 shadow-2xl space-y-2"
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#979797]" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onClose();
              } else if (e.key === "ArrowDown" && results.length > 0) {
                e.preventDefault();
                setActiveIndex((idx) => (idx + 1) % results.length);
              } else if (e.key === "ArrowUp" && results.length > 0) {
                e.preventDefault();
                setActiveIndex((idx) => (idx - 1 + results.length) % results.length);
              } else if (e.key === "Enter" && results[activeIndex]) {
                e.preventDefault();
                onSelectResult(results[activeIndex].node.id);
              }
            }}
            placeholder="Buscar por nome, prompt ou saída..."
            className="w-full rounded-lg border border-white/[0.06] bg-[#242424] py-1 pl-7 pr-2 text-[14px] text-white placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar busca"
          className="flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
          <span>Fechar busca</span>
        </button>
      </div>

      {query.trim().length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-[#979797]">
              Nenhuma etapa encontrada para este termo.
            </p>
          ) : (
            results.map((item, idx) => (
              <button
                key={item.node.id}
                type="button"
                onClick={() => onSelectResult(item.node.id)}
                className={`w-full rounded-lg px-2 py-1 text-left ${
                  idx === activeIndex ? "bg-[#2A2A2A]" : "hover:bg-[#2A2A2A]/70"
                }`}
              >
                <span className="block truncate text-[14px] font-semibold text-white">
                  {item.node.titulo}
                </span>
                <span className="block truncate text-[12px] text-[#979797]">{item.snippet}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
