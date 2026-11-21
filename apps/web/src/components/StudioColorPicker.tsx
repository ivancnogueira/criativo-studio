import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pipette } from "lucide-react";

export const DEFAULT_STUDIO_COLOR_SWATCHES = [
  { hex: "#F2555A", label: "Coral" },
  { hex: "#EB7414", label: "Laranja" },
  { hex: "#DDA100", label: "Ouro" },
  { hex: "#0BFF5C", label: "Verde Neon" },
  { hex: "#0BA39B", label: "Turquesa" },
  { hex: "#04A9D8", label: "Ciano" },
  { hex: "#4393F5", label: "Azul" },
  { hex: "#7689FC", label: "Índigo" },
  { hex: "#AC7AF8", label: "Lavanda" },
  { hex: "#CD5BD8", label: "Orquídea" },
  { hex: "#EB588B", label: "Rosa" },
  { hex: "#166534", label: "Verde Floresta" },
] as const;

const HEX6_RE = /^#([0-9A-Fa-f]{6})$/;
const HEX_CHARS_RE = /^[0-9A-Fa-f]{6}$/;

export function normalizeHex6(raw: string, fallback = "#0BFF5C"): string {
  const clean = String(raw || "").trim().replace(/^#/, "");
  if (HEX_CHARS_RE.test(clean)) {
    return `#${clean.toUpperCase()}`;
  }
  return HEX6_RE.test(fallback) ? fallback.toUpperCase() : "#0BFF5C";
}

export function hexToHsv(hexInput: string): { h: number; s: number; v: number } {
  const safe = normalizeHex6(hexInput);
  const r = Number.parseInt(safe.slice(1, 3), 16) / 255;
  const g = Number.parseInt(safe.slice(3, 5), 16) / 255;
  const b = Number.parseInt(safe.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

export function hsvToHex(hDeg: number, sPct: number, vPct: number): string {
  const h = ((hDeg % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, sPct)) / 100;
  const v = Math.max(0, Math.min(100, vPct)) / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const toHexByte = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  return `#${toHexByte(rPrime)}${toHexByte(gPrime)}${toHexByte(bPrime)}`;
}

export interface StudioColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  swatches?: ReadonlyArray<{ hex: string; label?: string }>;
  allowDefaultReset?: boolean;
  isDefaultSelected?: boolean;
  onResetDefault?: () => void;
  ariaLabelPrefix?: string;
}

/**
 * Seletor completo de cor (mapa 2D Saturação x Brilho, barra de Matiz, conta-gotas,
 * entrada HEX e grade de 12 cores rápidas).
 */
export const StudioColorPicker: React.FC<StudioColorPickerProps> = ({
  value,
  onChange,
  swatches = DEFAULT_STUDIO_COLOR_SWATCHES,
  allowDefaultReset = false,
  isDefaultSelected = false,
  onResetDefault,
  ariaLabelPrefix = "Cor",
}) => {
  const safeHex = useMemo(() => normalizeHex6(value, "#0BFF5C"), [value]);
  const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>(() => hexToHsv(safeHex));
  const [hexDraft, setHexDraft] = useState<string>(() => safeHex.slice(1));
  const svAreaRef = useRef<HTMLDivElement | null>(null);
  const hueBarRef = useRef<HTMLDivElement | null>(null);
  const internalDragRef = useRef(false);

  useEffect(() => {
    if (internalDragRef.current) return;
    setHexDraft(safeHex.slice(1));
    const parsed = hexToHsv(safeHex);
    setHsv((prev) => ({
      h: parsed.s === 0 ? prev.h : parsed.h,
      s: parsed.s,
      v: parsed.v,
    }));
  }, [safeHex]);

  const pureHueColor = useMemo(() => hsvToHex(hsv.h, 100, 100), [hsv.h]);

  const applyHsv = (nextH: number, nextS: number, nextV: number) => {
    const clampedH = Math.max(0, Math.min(359, Math.round(nextH)));
    const clampedS = Math.max(0, Math.min(100, Math.round(nextS)));
    const clampedV = Math.max(0, Math.min(100, Math.round(nextV)));
    setHsv({ h: clampedH, s: clampedS, v: clampedV });
    const nextHex = hsvToHex(clampedH, clampedS, clampedV);
    setHexDraft(nextHex.slice(1));
    onChange(nextHex);
  };

  const updateSvFromPointer = (clientX: number, clientY: number) => {
    const rect = svAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const xRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const yRatio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    applyHsv(hsv.h, xRatio * 100, (1 - yRatio) * 100);
  };

  const updateHueFromPointer = (clientX: number) => {
    const rect = hueBarRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    applyHsv(Math.min(359, ratio * 360), hsv.s, hsv.v);
  };

  const handleSvPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    internalDragRef.current = true;
    updateSvFromPointer(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => updateSvFromPointer(ev.clientX, ev.clientY);
    const onUp = () => {
      internalDragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleHuePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    internalDragRef.current = true;
    updateHueFromPointer(e.clientX);
    const onMove = (ev: PointerEvent) => updateHueFromPointer(ev.clientX);
    const onUp = () => {
      internalDragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleEyeDropper = async () => {
    try {
      const EyeDropperCtor = (
        window as unknown as {
          EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
        }
      ).EyeDropper;
      if (!EyeDropperCtor) return;
      const dropper = new EyeDropperCtor();
      const picked = await dropper.open();
      if (picked?.sRGBHex) {
        const nextHex = normalizeHex6(picked.sRGBHex, safeHex);
        setHexDraft(nextHex.slice(1));
        setHsv(hexToHsv(nextHex));
        onChange(nextHex);
      }
    } catch {
      // Usuário cancelou o conta-gotas
    }
  };

  const paletteSwatches = allowDefaultReset ? swatches.slice(0, 11) : swatches.slice(0, 12);

  return (
    <div
      data-testid="studio-color-picker"
      className="w-full rounded-[16px] border border-white/[0.08] bg-[#161618] p-3 space-y-3 select-none"
    >
      {/* Área 2D Saturação x Brilho */}
      <div
        ref={svAreaRef}
        role="slider"
        aria-label={`${ariaLabelPrefix}: saturação e brilho`}
        aria-valuetext={safeHex}
        tabIndex={0}
        onPointerDown={handleSvPointerDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") applyHsv(hsv.h, hsv.s + 5, hsv.v);
          else if (e.key === "ArrowLeft") applyHsv(hsv.h, hsv.s - 5, hsv.v);
          else if (e.key === "ArrowUp") applyHsv(hsv.h, hsv.s, hsv.v + 5);
          else if (e.key === "ArrowDown") applyHsv(hsv.h, hsv.s, hsv.v - 5);
        }}
        style={{ backgroundColor: pureHueColor }}
        className="relative h-36 w-full rounded-[12px] cursor-crosshair overflow-hidden border border-white/[0.08]"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to right, #ffffff 0%, rgba(255,255,255,0) 100%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to top, #000000 0%, rgba(0,0,0,0) 100%)",
          }}
        />
        <span
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: safeHex,
          }}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        />
      </div>

      {/* Conta-gotas + Barra arco-íris de Matiz */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          title="Capturar cor da tela (Conta-gotas)"
          aria-label="Conta-gotas de cor"
          onClick={() => void handleEyeDropper()}
          className="h-8 w-8 shrink-0 rounded-[9px] border border-white/[0.1] bg-[#212124] hover:bg-[#2A2A2E] text-[#C8C8CE] hover:text-white flex items-center justify-center transition-colors"
        >
          <Pipette className="h-3.5 w-3.5" />
        </button>

        <div
          ref={hueBarRef}
          role="slider"
          aria-label={`${ariaLabelPrefix}: matiz`}
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={hsv.h}
          tabIndex={0}
          onPointerDown={handleHuePointerDown}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") applyHsv((hsv.h + 8) % 360, hsv.s, hsv.v);
            else if (e.key === "ArrowLeft") applyHsv((hsv.h - 8 + 360) % 360, hsv.s, hsv.v);
          }}
          style={{
            background:
              "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
          }}
          className="relative h-3.5 flex-1 rounded-full cursor-pointer border border-white/[0.1]"
        >
          <span
            style={{
              left: `${(hsv.h / 360) * 100}%`,
              backgroundColor: pureHueColor,
            }}
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
          />
        </div>
      </div>

      {/* Entrada HEX + Preview */}
      <div className="flex items-center gap-2">
        <span className="h-8 px-2.5 rounded-[9px] border border-white/[0.1] bg-[#212124] text-[11px] font-semibold tracking-wide text-[#9A9AA2] flex items-center justify-center shrink-0">
          HEX
        </span>

        <div className="h-8 flex-1 rounded-[9px] border border-white/[0.1] bg-[#121214] px-2.5 flex items-center gap-1.5 focus-within:border-white/35">
          <span className="text-[12px] font-mono text-[#7E7E86]">#</span>
          <input
            type="text"
            maxLength={6}
            value={hexDraft}
            aria-label={`${ariaLabelPrefix}: código hexadecimal`}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6).toUpperCase();
              setHexDraft(cleaned);
              if (cleaned.length === 6) {
                const full = `#${cleaned}`;
                setHsv(hexToHsv(full));
                onChange(full);
              }
            }}
            onBlur={() => setHexDraft(safeHex.slice(1))}
            className="w-full bg-transparent font-mono text-[12.5px] font-semibold text-white outline-none uppercase"
          />
        </div>

        <span
          aria-hidden="true"
          style={{ backgroundColor: safeHex }}
          className="h-8 w-8 shrink-0 rounded-[9px] border border-white/[0.15]"
        />
      </div>

      {/* Grade de 12 cores rápidas */}
      <div className="grid grid-cols-6 gap-2.5 pt-0.5 justify-items-center">
        {allowDefaultReset && onResetDefault && (
          <button
            type="button"
            title="Restaurar cor padrão"
            aria-label={`${ariaLabelPrefix}: restaurar cor padrão`}
            onClick={onResetDefault}
            className={`relative h-7 w-7 rounded-full border flex items-center justify-center transition-transform bg-[#1C1C1F] ${
              isDefaultSelected
                ? "border-white ring-2 ring-white scale-105"
                : "border-white/25 opacity-85 hover:opacity-100"
            }`}
          >
            <span className="h-[1.5px] w-5 rotate-45 bg-[#9A9AA2] rounded-full" />
          </button>
        )}

        {paletteSwatches.map((sw) => {
          const normalizedSw = normalizeHex6(sw.hex);
          const selected = !isDefaultSelected && safeHex === normalizedSw;
          return (
            <button
              key={normalizedSw}
              type="button"
              title={sw.label ?? normalizedSw}
              aria-label={`${ariaLabelPrefix}: ${sw.label ?? normalizedSw}`}
              onClick={() => {
                setHexDraft(normalizedSw.slice(1));
                setHsv(hexToHsv(normalizedSw));
                onChange(normalizedSw);
              }}
              style={{ backgroundColor: normalizedSw }}
              className={`h-7 w-7 rounded-full border border-white/15 flex items-center justify-center transition-transform ${
                selected ? "ring-2 ring-white scale-110" : "opacity-90 hover:opacity-100 hover:scale-105"
              }`}
            >
              {selected && <Check className="h-3.5 w-3.5 text-[#0D0D0D] stroke-[3]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
