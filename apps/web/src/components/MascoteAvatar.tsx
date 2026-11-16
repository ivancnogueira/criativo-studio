import React, { useEffect, useId, useRef, useState } from "react";
import type { AvatarShape } from "@criativo/contracts";

/**
 * 17 cores fiéis às duas fileiras do construtor de mascotes OpenBot (9 na 1ª linha + 8 na 2ª).
 */
export const MASCOT_COLOR_PALETTE: readonly string[] = [
  "#38bdf8", // Azul sky
  "#ef4444", // Vermelho coral
  "#f97316", // Laranja
  "#eab308", // Amarelo ouro
  "#84cc16", // Verde lima
  "#22c55e", // Verde menta
  "#2dd4bf", // Turquesa claro
  "#67e8f9", // Ciano gelo
  "#3b82f6", // Azul elétrico
  "#34479c", // Azul marinho
  "#6366f1", // Índigo
  "#a855f7", // Violeta
  "#d946ef", // Magenta
  "#f27ba5", // Rosa chiclete
  "#a8324e", // Vinho
  "#8b5e3c", // Caramelo
  "#d6b98c", // Areia
];

export const MASCOT_SHAPES: readonly { id: AvatarShape; label: string }[] = [
  { id: "blob", label: "Redondo" },
  { id: "pill", label: "Pílula" },
  { id: "triangle", label: "Triângulo" },
  { id: "cloud", label: "Nuvem" },
  { id: "hex", label: "Hexágono" },
  { id: "rounded_square", label: "Cubo" },
  { id: "octo", label: "Estrela" },
  { id: "diamond", label: "Losango" },
];

const SHAPE_PATHS: Record<AvatarShape, string> = {
  blob: "M50 11 C73 11 89 26 89 49 C89 72 74 89 50 89 C26 89 11 72 11 49 C11 26 27 11 50 11 Z",
  pill: "M50 10 C71 10 83 22 83 41 L83 60 C83 78 70 90 50 90 C30 90 17 78 17 60 L17 41 C17 22 29 10 50 10 Z",
  triangle:
    "M50 10 C56 10 61 14 66 22 L85 59 C90 70 84 85 71 86 L29 86 C16 85 10 70 15 59 L34 22 C39 14 44 10 50 10 Z",
  cloud:
    "M32 30 C39 17 61 17 68 30 C82 30 90 42 86 55 C91 69 78 85 63 83 C56 90 44 90 37 83 C22 85 9 69 14 55 C10 42 18 30 32 30 Z",
  hex: "M42 12 C47 9 53 9 58 12 L81 26 C86 29 89 35 89 41 L89 60 C89 66 86 72 81 75 L58 89 C53 92 47 92 42 89 L19 75 C14 72 11 66 11 60 L11 41 C11 35 14 29 19 26 Z",
  rounded_square:
    "M32 13 L68 13 C80 13 87 20 87 32 L87 68 C87 80 80 87 68 87 L32 87 C20 87 13 80 13 68 L13 32 C13 20 20 13 32 13 Z",
  octo: "M50 9 L64 17 L80 19 L84 35 L91 50 L84 65 L80 81 L64 83 L50 91 L36 83 L20 81 L16 65 L9 50 L16 35 L20 19 L36 17 Z",
  diamond:
    "M50 8 C54 8 58 10 62 14 L86 38 C92 44 92 56 86 62 L62 86 C56 92 44 92 38 86 L14 62 C8 56 8 44 14 38 L38 14 C42 10 46 8 50 8 Z",
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getDefaultMascotForAgent(agentId: string): { shape: AvatarShape; color: string } {
  const hash = Array.from(agentId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const shapes: AvatarShape[] = [
    "hex",
    "blob",
    "diamond",
    "rounded_square",
    "triangle",
    "cloud",
    "octo",
    "pill",
  ];
  return {
    shape: shapes[hash % shapes.length],
    color: MASCOT_COLOR_PALETTE[hash % MASCOT_COLOR_PALETTE.length],
  };
}

export type MascotEyeMood = "idle" | "working" | "waiting" | "failed" | "responded";
type MascotEyeFace = "resting" | "wink" | "surpris" | "curieux" | "excite" | "attentif";

const HOVER_FACES: readonly MascotEyeFace[] = ["wink", "surpris", "curieux", "excite", "attentif"];
const WORKING_GAZES: ReadonlyArray<{ face: MascotEyeFace; x: number; y: number }> = [
  { face: "attentif", x: 0, y: -2.8 },
  { face: "curieux", x: -2.9, y: -2.0 },
  { face: "attentif", x: 2.9, y: -2.0 },
  { face: "surpris", x: 0, y: -1.2 },
  { face: "curieux", x: -2.2, y: 0.6 },
  { face: "excite", x: 2.0, y: -1.4 },
];

function pickDifferentHoverFace(prev: MascotEyeFace | null): MascotEyeFace {
  const candidates = HOVER_FACES.filter((f) => f !== prev);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? "wink";
}

export interface MascoteAvatarProps {
  shape?: AvatarShape;
  color?: string;
  size?: number;
  trackCursor?: boolean;
  animated?: boolean;
  mood?: MascotEyeMood;
  hoverAnimate?: boolean;
  label?: string;
  className?: string;
}

/**
 * Mascote vetorial orgânico estilo Bloub (clean-room SVG) com brilho de pelúcia e olhinhos
 * expressivos que reagem ao passar o mouse (hover no botão/linha) e enquanto trabalha.
 */
export const MascoteAvatar: React.FC<MascoteAvatarProps> = ({
  shape = "blob",
  color = "#38bdf8",
  size = 40,
  trackCursor = false,
  animated = false,
  mood = "idle",
  hoverAnimate,
  label = "Mascote do agente",
  className = "",
}) => {
  const uid = useId().replace(/:/g, "");
  const containerRef = useRef<SVGSVGElement | null>(null);
  const lastHoverFaceRef = useRef<MascotEyeFace | null>(null);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [hoverFace, setHoverFace] = useState<MascotEyeFace>("resting");
  const [workingIdx, setWorkingIdx] = useState(0);
  const [blinking, setBlinking] = useState(false);

  const isWorking = mood === "working" || animated;
  const enableHover = hoverAnimate ?? size >= 24;

  // Detecta hover e movimento do mouse no botão/linha pai (padrão HOVER_GROUP do OpenBot)
  useEffect(() => {
    if (!enableHover || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const svgEl = containerRef.current;
    if (!svgEl) return;

    const host: Element =
      svgEl.closest("button, a, [role='button'], [data-avatar-hover]") ?? svgEl;

    const onEnter = () => {
      const next = pickDifferentHoverFace(lastHoverFaceRef.current);
      lastHoverFaceRef.current = next;
      setHoverFace(next);
      setIsHovered(true);
    };

    const onLeave = () => {
      setIsHovered(false);
      setHoverFace("resting");
      if (!trackCursor) {
        setEyeOffset({ x: 0, y: 0 });
      }
    };

    const onMove = (rawEv: Event) => {
      const ev = rawEv as PointerEvent;
      const rect = svgEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setEyeOffset({
        x: clamp((ev.clientX - cx) / 110, -1, 1) * 2.6,
        y: clamp((ev.clientY - cy) / 110, -1, 1) * 2.0,
      });
    };

    const onFocusIn = (ev: Event) => {
      if (ev.target instanceof Element && ev.target.matches(":focus-visible")) {
        onEnter();
      }
    };

    const onFocusOut = (rawEv: Event) => {
      const ev = rawEv as FocusEvent;
      if (!(ev.relatedTarget instanceof Node) || !host.contains(ev.relatedTarget)) {
        onLeave();
      }
    };

    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);

    return () => {
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, [enableHover, trackCursor]);

  // Rastreio contínuo de cursor para mascotes grandes em tela inicial
  useEffect(() => {
    if (!trackCursor || typeof window === "undefined") {
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const handleMove = (ev: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (ev.clientX - cx) / 140;
      const dy = (ev.clientY - cy) / 140;
      setEyeOffset({
        x: clamp(dx, -1, 1) * 3.1,
        y: clamp(dy, -1, 1) * 2.4,
      });
    };

    window.addEventListener("pointermove", handleMove, { passive: true });
    return () => window.removeEventListener("pointermove", handleMove);
  }, [trackCursor]);

  // Enquanto trabalha: olha em direções variadas (750–1850ms) e pisca naturalmente
  useEffect(() => {
    if (!isWorking || typeof window === "undefined") {
      setBlinking(false);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let stepTimer: number | undefined;
    let blinkTimer: number | undefined;
    let cancelled = false;

    const scheduleStep = () => {
      const delay = 750 + Math.random() * 1100;
      stepTimer = window.setTimeout(() => {
        if (cancelled) return;
        setWorkingIdx((prev) => (prev + 1 + Math.floor(Math.random() * 2)) % WORKING_GAZES.length);
        // Pisca ocasionalmente entre mudanças de olhar
        if (Math.random() < 0.45) {
          setBlinking(true);
          blinkTimer = window.setTimeout(() => {
            if (!cancelled) setBlinking(false);
          }, 135);
        }
        scheduleStep();
      }, delay);
    };

    scheduleStep();
    return () => {
      cancelled = true;
      if (stepTimer) window.clearTimeout(stepTimer);
      if (blinkTimer) window.clearTimeout(blinkTimer);
    };
  }, [isWorking]);

  // Piscada orgânica ocasional em mascotes com cursor ativo ou hover prolongado
  useEffect(() => {
    if ((!trackCursor && !isHovered) || isWorking || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let cycleTimer: number | undefined;
    let openTimer: number | undefined;
    let cancelled = false;

    const scheduleBlink = () => {
      cycleTimer = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        openTimer = window.setTimeout(() => {
          if (!cancelled) setBlinking(false);
          scheduleBlink();
        }, 130);
      }, 2600 + Math.random() * 2200);
    };

    scheduleBlink();
    return () => {
      cancelled = true;
      if (cycleTimer) window.clearTimeout(cycleTimer);
      if (openTimer) window.clearTimeout(openTimer);
    };
  }, [trackCursor, isHovered, isWorking]);

  const pathData = SHAPE_PATHS[shape] ?? SHAPE_PATHS.blob;
  const workingGaze = WORKING_GAZES[workingIdx] ?? WORKING_GAZES[0];

  const activeFace: MascotEyeFace = isHovered
    ? hoverFace
    : isWorking
      ? workingGaze.face
      : mood === "waiting"
        ? "curieux"
        : mood === "responded"
          ? "excite"
          : "resting";

  const activeOffsetX = isHovered || trackCursor ? eyeOffset.x : isWorking ? workingGaze.x : 0;
  const activeOffsetY = isHovered || trackCursor ? eyeOffset.y : isWorking ? workingGaze.y : 0;

  const animClass = mood === "working" ? "mascote-working" : animated ? "mascote-idle" : "";

  const leftScaleX = activeFace === "surpris" ? 1.18 : activeFace === "attentif" ? 1.06 : 1;
  const leftScaleY = blinking
    ? 0.14
    : activeFace === "surpris"
      ? 1.16
      : activeFace === "curieux"
        ? 1.1
        : activeFace === "attentif"
          ? 0.84
          : 1;
  const rightScaleX = activeFace === "surpris" ? 1.18 : activeFace === "attentif" ? 1.06 : 1;
  const rightScaleY = blinking
    ? 0.14
    : activeFace === "surpris"
      ? 1.16
      : activeFace === "curieux"
        ? 0.72
        : activeFace === "attentif"
          ? 0.84
          : 1;

  return (
    <svg
      ref={containerRef}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      className={`${animClass} shrink-0 select-none ${className}`}
    >
      <defs>
        <radialGradient id={`plush-${uid}`} cx="36%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.48" />
          <stop offset="45%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor="#050505" stopOpacity="0.42" />
        </radialGradient>
        <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor={color} floodOpacity="0.28" />
        </filter>
      </defs>

      <g filter={size >= 36 ? `url(#glow-${uid})` : undefined}>
        <path d={pathData} fill={color} />
        <path d={pathData} fill={`url(#plush-${uid})`} />
        <path
          d={pathData}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1.6"
        />
      </g>

      {/* Olhos animados estilo Bloub/OpenBot: transição fluida ao passar o mouse e trabalhar */}
      <g
        style={{
          transform: `translate(${activeOffsetX.toFixed(2)}px, ${activeOffsetY.toFixed(2)}px)`,
          transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {activeFace === "excite" && !blinking ? (
          <>
            <path
              d="M 35 52 Q 40.5 43.5 46 52"
              fill="none"
              stroke="#FFF8E7"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <path
              d="M 54 52 Q 59.5 43.5 65 52"
              fill="none"
              stroke="#FFF8E7"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            {/* Olho esquerdo */}
            <g
              style={{
                transform: `scale(${leftScaleX}, ${leftScaleY})`,
                transformOrigin: "40.5px 50px",
                transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <ellipse cx="40.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7" />
              <ellipse cx="41.4" cy="49.2" rx="1.6" ry="3.2" fill="#E6D5B8" opacity="0.55" />
            </g>

            {/* Olho direito: fecha em piscadinha charmosa no estado "wink" */}
            {activeFace === "wink" && !blinking ? (
              <path
                d="M 54.5 51 Q 59.5 46 64.5 51"
                fill="none"
                stroke="#FFF8E7"
                strokeWidth="3.8"
                strokeLinecap="round"
              />
            ) : (
              <g
                style={{
                  transform: `scale(${rightScaleX}, ${rightScaleY})`,
                  transformOrigin: "59.5px 50px",
                  transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <ellipse cx="59.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7" />
                <ellipse cx="60.4" cy="49.2" rx="1.6" ry="3.2" fill="#E6D5B8" opacity="0.55" />
              </g>
            )}
          </>
        )}
      </g>
    </svg>
  );
};

interface ChannelMascoteClusterProps {
  members: Array<{ agente_id: string; shape?: AvatarShape; color?: string }>;
  size?: number;
}

/**
 * Mosaico compacto 2x2 de mascotes em um bloco escuro arredondado para Canais em Equipe.
 */
export const ChannelMascoteCluster: React.FC<ChannelMascoteClusterProps> = ({
  members,
  size = 38,
}) => {
  const top4 = members.slice(0, 4);
  const subSize = Math.max(13, Math.round(size * 0.42));

  return (
    <div
      style={{ width: size, height: size }}
      className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-[#242424] border border-white/10 p-1 place-items-center shrink-0"
      aria-label="Avatar do canal em equipe"
    >
      {top4.map((m, idx) => {
        const def = getDefaultMascotForAgent(m.agente_id || `m${idx}`);
        return (
          <MascoteAvatar
            key={`${m.agente_id}-${idx}`}
            shape={m.shape ?? def.shape}
            color={m.color ?? def.color}
            size={subSize}
          />
        );
      })}
    </div>
  );
};

interface MascoteAppearancePickerProps {
  color: string;
  shape: AvatarShape;
  onChangeColor: (color: string) => void;
  onChangeShape: (shape: AvatarShape) => void;
}

/**
 * Seletor completo de 17 cores (2 fileiras) e 8 formatos de mascote (Screenshot 3).
 */
export const MascoteAppearancePicker: React.FC<MascoteAppearancePickerProps> = ({
  color,
  shape,
  onChangeColor,
  onChangeShape,
}) => {
  const row1 = MASCOT_COLOR_PALETTE.slice(0, 9);
  const row2 = MASCOT_COLOR_PALETTE.slice(9, 17);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-2">
        {[row1, row2].map((row, rIdx) => (
          <div key={rIdx} className="flex items-center gap-2 flex-wrap justify-center">
            {row.map((hex) => {
              const selected = hex.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onChangeColor(hex)}
                  aria-label={`Selecionar cor ${hex}`}
                  className={`h-4 w-4 rounded-full transition-transform ${
                    selected
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#1A1A1A] scale-110"
                      : "hover:scale-110 opacity-90 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1">
        {MASCOT_SHAPES.map((item) => {
          const active = item.id === shape;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeShape(item.id)}
              title={item.label}
              aria-label={`Formato ${item.label}`}
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                active
                  ? "bg-[#2A2A2A] ring-1 ring-[#42A0FF]"
                  : "hover:bg-[#242424] opacity-80 hover:opacity-100"
              }`}
            >
              <MascoteAvatar shape={item.id} color={color} size={22} />
            </button>
          );
        })}
      </div>
    </div>
  );
};
