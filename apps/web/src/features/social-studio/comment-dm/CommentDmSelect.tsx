import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface CommentDmSelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface CommentDmSelectProps {
  value: string;
  options: CommentDmSelectOption[];
  onChange: (nextValue: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * Seletor acessível em tema Carbon Dark sem uso de tag select nativa.
 */
export const CommentDmSelect: React.FC<CommentDmSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = "Selecione...",
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (evt: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(evt.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const current = options.find((opt) => opt.value === value);

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#141414] px-3 py-2 text-left text-xs text-white hover:border-white/25 transition-colors"
      >
        <span className={current ? "truncate text-white" : "truncate text-neutral-500"}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-[#1B1B1B] py-1 shadow-xl"
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  selected ? "bg-[#42A0FF]/15 text-[#42A0FF]" : "text-neutral-200 hover:bg-white/5"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{opt.label}</div>
                  {opt.hint && <div className="truncate text-[10.5px] text-neutral-400">{opt.hint}</div>}
                </div>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
