import React, { useEffect, useId, useRef, useState } from "react";
import { Blocks, Check, ChevronDown, Plug } from "lucide-react";

export interface CarbonSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
  disabled?: boolean;
}

interface CarbonSelectProps<T extends string = string> {
  id?: string;
  ariaLabel?: string;
  value: T;
  options: readonly CarbonSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Seletor dropdown customizado no design system Carbon Dark.
 * Utiliza `role="listbox"` e navegação por teclado sem usar elemento select nativo.
 */
export function CarbonSelect<T extends string = string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = "Selecionar opção",
  disabled = false,
  className = "",
}: CarbonSelectProps<T>) {
  const autoId = useId();
  const controlId = id ?? `carbon-select-${autoId}`;
  const listboxId = `${controlId}-listbox`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value)
  );
  const [activeIndex, setActiveIndex] = useState<number>(selectedIndex);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex, open]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const currentOption = options.find((opt) => opt.value === value);

  const commitSelection = (opt: CarbonSelectOption<T> | undefined) => {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((prev) => {
        for (let step = 1; step <= options.length; step += 1) {
          const idx = (prev + step) % options.length;
          if (!options[idx]?.disabled) return idx;
        }
        return prev;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((prev) => {
        for (let step = 1; step <= options.length; step += 1) {
          const idx = (prev - step + options.length) % options.length;
          if (!options[idx]?.disabled) return idx;
        }
        return prev;
      });
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      if (open) {
        event.preventDefault();
        commitSelection(options[activeIndex]);
      } else {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        id={controlId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center justify-between gap-2 rounded-[10px] border border-[#2A2A2A] bg-[#242424] px-3 py-2 text-left text-[13px] font-normal text-[#F0F0F0] transition-colors hover:border-[#42A0FF]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-50"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="truncate">{currentOption ? currentOption.label : placeholder}</span>
          {currentOption?.badge && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: `${currentOption.badgeColor ?? "#31CF76"}20`,
                color: currentOption.badgeColor ?? "#31CF76",
              }}
            >
              {currentOption.badge}
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-[#979797] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ?? "Opções disponíveis"}
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-64 overflow-y-auto rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-1 shadow-[0_14px_40px_rgba(0,0,0,0.55)]"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === activeIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commitSelection(opt)}
                className={`w-full flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-colors ${
                  isFocused ? "bg-[#2A2A2A] text-white" : "text-[#DCDCDC] hover:bg-[#242424]"
                } disabled:opacity-45`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-normal">{opt.label}</span>
                    {opt.badge && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: `${opt.badgeColor ?? "#31CF76"}20`,
                          color: opt.badgeColor ?? "#31CF76",
                        }}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </span>
                  {opt.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-[#979797]">
                      {opt.description}
                    </span>
                  )}
                </span>
                {isSelected && <Check size={14} className="shrink-0 text-[#007CF7]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface SlidingTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface SlidingTabsProps<T extends string = string> {
  ariaLabel?: string;
  value: T;
  tabs: readonly SlidingTabItem<T>[];
  onChange: (id: T) => void;
  variant?: "light" | "subtle";
  className?: string;
}

/**
 * Alternador segmentado Carbon Dark / Carbon Dark (`role="tablist"` e `role="tab"`).
 */
export function SlidingTabs<T extends string = string>({
  ariaLabel = "Seletor de abas",
  value,
  tabs,
  onChange,
  variant = "light",
  className = "",
}: SlidingTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 rounded-[12px] border border-[#2A2A2A] bg-[#242424] p-1 ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const activeClasses =
          variant === "light"
            ? "bg-[#F0F0F0] text-[#141414] font-semibold shadow-sm"
            : "bg-[#2A2A2A] text-[#F0F0F0] font-semibold";
        const idleClasses = "text-[#979797] hover:text-[#F0F0F0] font-normal";

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-45 ${
              active ? activeClasses : idleClasses
            }`}
          >
            <span>{tab.label}</span>
            {typeof tab.count === "number" && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  active
                    ? variant === "light"
                      ? "bg-[#141414]/15 text-[#141414]"
                      : "bg-[#141414] text-[#DCDCDC]"
                    : "bg-[#1A1A1A] text-[#979797]"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface BrandBadgeSpec {
  bg: string;
  fg: string;
  glyph: string;
  pathD?: string;
}

const BRAND_SPECS: Record<string, BrandBadgeSpec> = {
  canva: {
    bg: "#00C4CC",
    fg: "#FFFFFF",
    glyph: "C",
  },
  figma: {
    bg: "#1E1E1E",
    fg: "#F24E1E",
    glyph: "F",
    pathD:
      "M9 3h3a2 2 0 1 1 0 4H9V3Zm0 4h3a2 2 0 1 1 0 4H9V7Zm0 4h1.5a2 2 0 1 1 0 4H9v-4ZM6 5a2 2 0 0 1 2-2h1v4H8a2 2 0 0 1-2-2Zm0 4a2 2 0 0 1 2-2h1v4H8a2 2 0 0 1-2-2Z",
  },
  notion: {
    bg: "#191919",
    fg: "#FFFFFF",
    glyph: "N",
  },
  "google-drive": {
    bg: "#1F2937",
    fg: "#34A853",
    glyph: "D",
    pathD: "M9 3h4l5 9h-4L9 3Zm-5 9 4-7 2 3.5-4 7L4 12Zm3 4h11l-2 3.5H5L7 16Z",
  },
  instagram: {
    bg: "#E1306C",
    fg: "#FFFFFF",
    glyph: "IG",
    pathD:
      "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm5 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm5-1.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  },
  elevenlabs: {
    bg: "#141414",
    fg: "#FFFFFF",
    glyph: "II",
    pathD: "M8 5h2.5v14H8V5Zm5.5 0H16v14h-2.5V5Z",
  },
  higgsfield: {
    bg: "#7C3AED",
    fg: "#FFFFFF",
    glyph: "H",
  },
  sunra: {
    bg: "#F59E0B",
    fg: "#141414",
    glyph: "S",
  },
  github: {
    bg: "#24292F",
    fg: "#FFFFFF",
    glyph: "GH",
    pathD:
      "M12 3a9 9 0 0 0-2.8 17.5c.4.1.6-.2.6-.4v-1.5c-2.5.5-3-1-3-1-.4-1-.9-1.3-.9-1.3-.8-.5.1-.5.1-.5.8.1 1.3.9 1.3.9.8 1.3 2 .9 2.5.7.1-.6.3-.9.6-1.1-2-.2-4-1-4-4.4 0-1 .4-1.8.9-2.4-.1-.2-.4-1.1.1-2.3 0 0 .8-.2 2.5.9a8.6 8.6 0 0 1 4.6 0c1.7-1.1 2.5-.9 2.5-.9.5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.4 0 3.4-2.1 4.2-4.1 4.4.3.3.6.8.6 1.7v2.4c0 .2.2.5.6.4A9 9 0 0 0 12 3Z",
  },
  slack: {
    bg: "#4A154B",
    fg: "#FFFFFF",
    glyph: "#",
  },
  whatsapp: {
    bg: "#25D366",
    fg: "#0B141A",
    glyph: "WA",
    pathD:
      "M12 4a8 8 0 0 0-6.8 12.2L4 20l4-.9A8 8 0 1 0 12 4Zm-2.5 4.7c.2 0 .4 0 .6.4l.7 1.7c.1.2 0 .4-.1.5l-.5.6c.5.9 1.3 1.7 2.2 2.2l.6-.5c.1-.1.3-.2.5-.1l1.7.7c.3.2.4.4.4.6 0 .7-.5 1.3-1.2 1.4-1.5.2-3.4-.6-4.8-2-1.4-1.4-2.2-3.3-2-4.8.1-.7.7-1.2 1.4-1.2Z",
  },
  telegram: {
    bg: "#229ED9",
    fg: "#FFFFFF",
    glyph: "TG",
    pathD: "M20 5 3.5 11.4c-.9.4-.9 1.1 0 1.4l4.2 1.3 1.6 5c.2.5.7.6 1.1.3l2.3-2.1 4.4 3.2c.8.4 1.3.2 1.5-.7L21.3 6c.2-.9-.4-1.4-1.3-1Z",
  },
  linear: {
    bg: "#5E6AD2",
    fg: "#FFFFFF",
    glyph: "L",
  },
  airtable: {
    bg: "#18BFFF",
    fg: "#FFFFFF",
    glyph: "AT",
  },
  apify: {
    bg: "#FF9013",
    fg: "#141414",
    glyph: "AP",
  },
};

interface AppBrandIconProps {
  slug?: string | null;
  name?: string;
  size?: number;
  kind?: "app" | "mcp";
}

/**
 * Ícone vetorial local em SVG sem dependência de CDN externo.
 */
export function AppBrandIcon({
  slug,
  name,
  size = 32,
  kind = "app",
}: AppBrandIconProps) {
  const key = (slug ?? "").trim().toLowerCase();
  const spec = BRAND_SPECS[key];

  if (!spec) {
    const Fallback = kind === "mcp" ? Plug : Blocks;
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="inline-flex shrink-0 items-center justify-center rounded-[8px] border border-[#2A2A2A] bg-[#1A1A1A] text-[#42A0FF]"
      >
        <Fallback size={Math.max(14, Math.round(size * 0.52))} />
      </span>
    );
  }

  return (
    <span
      aria-label={name ? `Ícone de ${name}` : `Ícone ${key}`}
      style={{
        width: size,
        height: size,
        backgroundColor: spec.bg,
        color: spec.fg,
      }}
      className="inline-flex shrink-0 items-center justify-center rounded-[8px] border border-white/10 font-semibold"
    >
      {spec.pathD ? (
        <svg
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d={spec.pathD} />
        </svg>
      ) : (
        <span style={{ fontSize: Math.max(10, Math.round(size * 0.36)) }}>
          {spec.glyph}
        </span>
      )}
    </span>
  );
}
