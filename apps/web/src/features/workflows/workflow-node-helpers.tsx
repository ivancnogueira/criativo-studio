import React, { useEffect, useRef, useState } from "react";
import {
  normalizeNodeKind,
  type WorkflowNo,
  type WorkflowOutputTarget,
  type WorkflowShapeKind,
  type WorkflowTriggerKind,
} from "@criativo/contracts";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Film,
  GitBranch,
  Image as ImageIcon,
  Send,
  Sparkles,
  StickyNote,
  Type,
  Zap,
} from "lucide-react";

export interface PopoverOption<T extends string> {
  value: T;
  label: string;
  subtitle?: string;
}

interface CarbonMenuPickerProps<T extends string> {
  value: T;
  options: Array<PopoverOption<T>>;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  renderTrigger?: (selected: PopoverOption<T> | undefined) => React.ReactNode;
}

export function CarbonMenuPicker<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  renderTrigger,
}: CarbonMenuPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDocDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDocDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.12] bg-[#242424] px-2 py-1 text-left text-[12px] font-normal text-[#DCDCDC] hover:bg-[#2A2A2A] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
      >
        <span className="truncate">
          {renderTrigger ? renderTrigger(selected) : (selected?.label ?? String(value))}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#979797]" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full min-w-[210px] overflow-y-auto rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[12px] ${
                  active
                    ? "bg-[#2A2A2A] font-semibold text-white"
                    : "font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]/70"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="block truncate">{opt.label}</span>
                  {opt.subtitle && (
                    <span className="block truncate text-[12px] text-[#979797]">
                      {opt.subtitle}
                    </span>
                  )}
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#42A0FF]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const TRIGGER_KIND_OPTIONS: Array<PopoverOption<WorkflowTriggerKind>> = [
  { value: "schedule", label: "Agendado", subtitle: "Frequência IANA" },
  { value: "manual", label: "Manual", subtitle: "Disparo sob demanda" },
  { value: "webhook", label: "Webhook HTTP", subtitle: "Assinado por HMAC-SHA256" },
  { value: "whatsapp", label: "WhatsApp", subtitle: "Mensagem recebida" },
  { value: "telegram", label: "Telegram", subtitle: "Bot / comando" },
  { value: "conector", label: "Conector externo", subtitle: "Eventos integrados" },
];

export const OUTPUT_TARGET_OPTIONS: Array<PopoverOption<WorkflowOutputTarget>> = [
  { value: "canal", label: "Canal em Equipe" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "github", label: "GitHub" },
  { value: "arquivo", label: "Arquivo no Workspace" },
  { value: "instagram", label: "Instagram Meta" },
  { value: "notificacao", label: "Notificação Cockpit" },
];

export const EFFORT_OPTIONS: Array<PopoverOption<"baixo" | "medio" | "alto">> = [
  { value: "baixo", label: "Baixo" },
  { value: "medio", label: "Médio" },
  { value: "alto", label: "Alto" },
];

export const SHAPE_OPTIONS: Array<PopoverOption<WorkflowShapeKind>> = [
  { value: "rectangle", label: "Retângulo" },
  { value: "circle", label: "Círculo" },
  { value: "diamond", label: "Losango" },
  { value: "triangle", label: "Triângulo" },
  { value: "inverted", label: "Triângulo invertido" },
  { value: "oval", label: "Oval" },
  { value: "star", label: "Estrela" },
];

export const NOTE_PALETTE = [
  { id: "amber", bg: "bg-[#2A2418] border-[#FF9412]/30 text-[#FDE68A]" },
  { id: "emerald", bg: "bg-[#192822] border-[#31CF76]/30 text-[#BBF7D0]" },
  { id: "blue", bg: "bg-[#19222E] border-[#42A0FF]/30 text-[#BFDBFE]" },
  { id: "neutral", bg: "bg-[#242424] border-white/[0.12] text-[#DCDCDC]" },
];

export function renderShapeSvg(shape: WorkflowShapeKind, color: string) {
  switch (shape) {
    case "circle":
      return <circle cx="50" cy="50" r="42" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "diamond":
      return <polygon points="50,6 94,50 50,94 6,50" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "triangle":
      return <polygon points="50,8 92,88 8,88" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "inverted":
      return <polygon points="8,12 92,12 50,92" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "oval":
      return <ellipse cx="50" cy="50" rx="44" ry="28" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
    case "star":
      return (
        <polygon
          points="50,6 62,36 94,38 69,58 77,90 50,72 23,90 31,58 6,38 38,36"
          fill={color}
          fillOpacity={0.22}
          stroke={color}
          strokeWidth="3"
        />
      );
    case "rectangle":
    default:
      return <rect x="8" y="14" width="84" height="72" rx="10" fill={color} fillOpacity={0.22} stroke={color} strokeWidth="3" />;
  }
}

export function NodeHeaderIcon({ tipo }: { tipo: WorkflowNo["tipo"] }) {
  const kind = normalizeNodeKind(tipo);
  switch (kind) {
    case "gatilho":
      return <Zap className="h-4 w-4 text-[#FF9412]" />;
    case "prompt":
      return <FileText className="h-4 w-4 text-[#DCDCDC]" />;
    case "asset":
      return <ImageIcon className="h-4 w-4 text-[#42A0FF]" />;
    case "llm":
      return <Sparkles className="h-4 w-4 text-[#42A0FF]" />;
    case "agente":
      return <Bot className="h-4 w-4 text-[#31CF76]" />;
    case "gerar_imagem":
      return <ImageIcon className="h-4 w-4 text-[#42A0FF]" />;
    case "render_video":
      return <Film className="h-4 w-4 text-[#FF9412]" />;
    case "condition":
      return <GitBranch className="h-4 w-4 text-[#31CF76]" />;
    case "approval":
      return <CheckCircle2 className="h-4 w-4 text-[#FF9412]" />;
    case "output":
      return <Send className="h-4 w-4 text-[#31CF76]" />;
    case "nota":
      return <StickyNote className="h-4 w-4 text-[#FF9412]" />;
    case "text":
      return <Type className="h-4 w-4 text-[#DCDCDC]" />;
    default:
      return <Sparkles className="h-4 w-4 text-[#DCDCDC]" />;
  }
}
