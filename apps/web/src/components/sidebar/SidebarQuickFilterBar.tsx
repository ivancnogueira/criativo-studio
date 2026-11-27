import React from "react";

export type SidebarQuickFilterValue = "all" | "unread" | "folders";

export interface SidebarQuickFilterBarProps {
  value: SidebarQuickFilterValue;
  totalUnreadCount: number;
  onChange: (next: SidebarQuickFilterValue) => void;
}

const FILTER_OPTIONS: ReadonlyArray<{ id: SidebarQuickFilterValue; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "unread", label: "Não lidas" },
  { id: "folders", label: "Pastas" },
];

export const SidebarQuickFilterBar: React.FC<SidebarQuickFilterBarProps> = ({
  value,
  totalUnreadCount,
  onChange,
}) => {
  return (
    <div className="px-2.5 pb-1.5">
      <div
        role="tablist"
        aria-label="Filtrar conversas"
        className="grid grid-cols-3 gap-1 rounded-xl bg-[#141414] border border-white/[0.06] p-1"
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.id)}
              className={`inline-flex items-center justify-center gap-1 rounded-lg py-1 px-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-[#27272A] text-white border border-white/10"
                  : "text-[#8E8E93] hover:text-white border border-transparent"
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.id === "unread" && totalUnreadCount > 0 && (
                <span className="rounded-full bg-[#42A0FF]/20 px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-[#74B9FF]">
                  {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
