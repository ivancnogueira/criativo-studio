import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AgenteRegistro, AvatarShape } from "@criativo/contracts";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";

export interface TaskAgentSelectProps {
  agentes: AgenteRegistro[];
  selectedAgentId: string;
  onSelectAgent: (agenteId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  ariaLabel?: string;
  defaultOpen?: boolean;
}

/**
 * Seletor Carbon Dark em popover pesquisável com `role="listbox"` e `MascoteAvatar`,
 * substituindo controles nativos do navegador em toda a UI de tarefas.
 */
export const TaskAgentSelect: React.FC<TaskAgentSelectProps> = ({
  agentes = [],
  selectedAgentId,
  onSelectAgent,
  disabled = false,
  compact = false,
  ariaLabel = "Selecionar Criativo especialista",
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const currentAgent = useMemo(
    () => agentes.find((a) => a.agente_id === selectedAgentId) ?? agentes[0] ?? null,
    [agentes, selectedAgentId]
  );

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agentes;
    return agentes.filter(
      (a) =>
        a.nome.toLowerCase().includes(q) ||
        a.papel.toLowerCase().includes(q) ||
        a.agente_id.toLowerCase().includes(q)
    );
  }, [agentes, query]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    setHighlightedIdx(0);
    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);

    const handleOutside = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const currentVisual = resolveAgentAvatarConfig(currentAgent, currentAgent?.agente_id ?? "estrategista");

  const handleKeyDown = (ev: React.KeyboardEvent) => {
    if (!open || filteredAgents.length === 0) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setHighlightedIdx((prev) => (prev + 1) % filteredAgents.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlightedIdx((prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const target = filteredAgents[highlightedIdx];
      if (target) {
        onSelectAgent(target.agente_id);
        setOpen(false);
        setQuery("");
      }
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#212121] ${
          compact ? "px-2 py-1" : "px-2 py-2"
        } text-left text-white transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-50`}
      >
        <MascoteAvatar
          avatar={currentVisual}
          agentKey={currentAgent?.agente_id}
          size={compact ? 18 : 22}
          mood="idle"
        />
        <span className={`${compact ? "text-[12px]" : "text-[14px]"} font-semibold text-white truncate max-w-[180px]`}>
          {currentAgent?.nome ?? "Selecionar Criativo"}
        </span>
        <ChevronDown className="h-4 w-4 text-[#979797]" />
      </button>

      {open && (
        <div
          onKeyDown={handleKeyDown}
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-white/[0.06] bg-[#141414] p-2 shadow-2xl"
        >
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#212121] px-2 py-1">
            <Search className="h-4 w-4 shrink-0 text-[#979797]" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedIdx(0);
              }}
              placeholder="Buscar especialista..."
              className="w-full bg-transparent text-[14px] font-normal text-white placeholder-[#979797] focus:outline-none"
            />
          </div>

          <ul
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-60 space-y-1 overflow-y-auto"
          >
            {filteredAgents.length === 0 ? (
              <li className="px-2 py-2 text-[12px] font-normal text-[#979797]">
                Nenhum especialista encontrado.
              </li>
            ) : (
              filteredAgents.map((ag, idx) => {
                const visual = resolveAgentAvatarConfig(ag);
                const selected = ag.agente_id === currentAgent?.agente_id;
                const active = idx === highlightedIdx;
                return (
                  <li
                    key={ag.agente_id}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => {
                      onSelectAgent(ag.agente_id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 transition ${
                      selected
                        ? "bg-[#2A2A2A] border border-[#007CF7]"
                        : active
                          ? "bg-[#242424]"
                          : "hover:bg-[#212121]"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <MascoteAvatar avatar={visual} agentKey={ag.agente_id} size={22} mood="idle" />
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-white">{ag.nome}</div>
                        <div className="truncate text-[12px] font-normal text-[#979797]">{ag.papel}</div>
                      </div>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-[#31CF76]" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
