import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  MAX_SIDE_SPLIT_GROUPS,
  reorderSplitGroup,
  resizeSplitPair,
  type SideSplitGroupKind,
  type SideSplitLayoutState,
} from "./side-split-layout";

const GROUP_TITLES: Record<SideSplitGroupKind, string> = {
  inspector: "Inspetor",
  browser: "Navegador",
  preview: "Prévia de arquivo",
  side_thread: "Thread lateral",
};

export interface SideSplitContainerProps {
  layout: SideSplitLayoutState;
  onChange: (next: SideSplitLayoutState) => void;
  renderGroup: (kind: SideSplitGroupKind) => React.ReactNode;
  onCloseKind: (kind: SideSplitGroupKind) => void;
  openableKinds?: SideSplitGroupKind[];
  onOpenKind?: (kind: SideSplitGroupKind) => void;
}

/**
 * Container vertical com até 3 grupos redimensionáveis (Inspetor + Navegador + Prévia/Thread).
 */
export const SideSplitContainer: React.FC<SideSplitContainerProps> = ({
  layout,
  onChange,
  renderGroup,
  onCloseKind,
  openableKinds = [],
  onOpenKind,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const canAdd = layout.groups.length < MAX_SIDE_SPLIT_GROUPS && openableKinds.length > 0;

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (ev: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>, upperIndex: number): void => {
    e.preventDefault();
    const height = containerRef.current?.getBoundingClientRect().height ?? 0;
    if (height <= 0) return;
    const startY = e.clientY;
    const startLayout = layout;
    const onMove = (ev: PointerEvent): void => {
      onChange(resizeSplitPair(startLayout, upperIndex, (ev.clientY - startY) / height));
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={containerRef}
      data-testid="side-split-container"
      className="flex flex-col h-full w-full overflow-hidden bg-[#141416]"
    >
      {layout.groups.map((group, index) => (
        <React.Fragment key={group.id}>
          <section
            className="flex flex-col min-h-[140px] overflow-hidden"
            style={{ flexBasis: `${group.ratio * 100}%`, flexGrow: 0, flexShrink: 1 }}
          >
            <header className="h-[34px] shrink-0 px-2.5 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-[#111113]">
              <span className="text-[11.5px] font-semibold text-[#DCDCDC] truncate">
                {GROUP_TITLES[group.kind]}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {canAdd && index === 0 && onOpenKind && (
                  <div ref={menuRef} className="relative">
                    <button
                      type="button"
                      aria-label="Adicionar grupo ao painel lateral"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((prev) => !prev)}
                      className="h-6 px-1.5 rounded-md bg-[#1C1C20] border border-white/10 text-[11px] text-[#CCCCCC] hover:text-white hover:bg-[#242428] inline-flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Grupo</span>
                    </button>
                    {menuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-7 z-40 min-w-[148px] rounded-lg border border-white/10 bg-[#1B1B1F] p-1 shadow-xl"
                      >
                        {openableKinds.map((k) => (
                          <button
                            key={k}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              onOpenKind(k);
                            }}
                            className="w-full text-left rounded-md px-2.5 py-1.5 text-[11.5px] text-[#DCDCDC] hover:bg-[#2A2A30] hover:text-white"
                          >
                            {GROUP_TITLES[k]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onChange(reorderSplitGroup(layout, group.id, "up"))}
                  aria-label="Mover grupo para cima"
                  className="h-6 w-6 rounded-md flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242428] disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={index === layout.groups.length - 1}
                  onClick={() => onChange(reorderSplitGroup(layout, group.id, "down"))}
                  aria-label="Mover grupo para baixo"
                  className="h-6 w-6 rounded-md flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242428] disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onCloseKind(group.kind)}
                  aria-label="Fechar grupo"
                  className="h-6 w-6 rounded-md flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242428]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </header>
            <div className="flex-1 min-h-0 overflow-hidden [&>aside]:!w-full [&>div]:!w-full">
              {renderGroup(group.kind)}
            </div>
          </section>
          {index < layout.groups.length - 1 && (
            <div
              role="separator"
              aria-orientation="horizontal"
              onPointerDown={(e) => startResize(e, index)}
              className="h-1 shrink-0 cursor-row-resize bg-white/[0.06] hover:bg-[#007CF7] transition-colors"
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
