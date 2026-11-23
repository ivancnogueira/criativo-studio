import React, { useEffect, useId, useRef, useState } from "react";
import type { AvatarShape, AvatarStyle } from "@criativo/contracts";
import {
  CLASSIC_SHAPE_PATHS,
  getDefaultMascotForAgent,
  getDefaultVariantForStyle,
  normalizeAvatarStyle,
} from "./avatar-catalog";
import {
  ExpressiveSvgAvatar,
  PhotoAvatarRenderer,
} from "./avatar-body-renderers";
import {
  inferTaskContextFromActivity,
  TASK_EXPRESSION_PLAYLISTS,
  type AgentAvatarVisual,
  type AvatarExpression,
  type AvatarTaskContext,
} from "./avatar-types";

export type MascotEyeMood =
  | "idle"
  | "working"
  | "waiting"
  | "failed"
  | "responded"
  | "completed";

type ClassicEyeFace =
  | "resting"
  | "wink"
  | "surpris"
  | "curieux"
  | "excite"
  | "attentif"
  | "squint"
  | "focused"
  | "wide";

const HOVER_FACES: readonly ClassicEyeFace[] = [
  "wink",
  "surpris",
  "curieux",
  "excite",
  "attentif",
  "squint",
  "wide",
];

const WORKING_GAZES: ReadonlyArray<{ face: ClassicEyeFace; x: number; y: number }> = [
  { face: "squint", x: 0, y: -2.8 },
  { face: "focused", x: -3.2, y: -2.2 },
  { face: "squint", x: 3.2, y: -2.2 },
  { face: "wide", x: 0, y: -1.4 },
  { face: "curieux", x: -2.6, y: 0.8 },
  { face: "focused", x: 2.6, y: 0.6 },
  { face: "excite", x: 2.2, y: -1.6 },
  { face: "attentif", x: -1.8, y: -2.6 },
];

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

const EXPRESSIVE_HOVER_FACES: readonly AvatarExpression[] = [
  "wink",
  "sweet",
  "cheeky",
  "cool",
  "wow",
  "smug",
  "love",
];

function pickDifferentHoverFace(prev: ClassicEyeFace | null): ClassicEyeFace {
  const candidates = HOVER_FACES.filter((f) => f !== prev);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? "wink";
}

function pickDifferentExpressiveHoverFace(prev: AvatarExpression | null): AvatarExpression {
  const candidates = EXPRESSIVE_HOVER_FACES.filter((f) => f !== prev);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? "wink";
}

export interface MascoteAvatarProps {
  shape?: AvatarShape;
  color?: string;
  style?: AvatarStyle;
  variant?: string;
  imageUrl?: string | null;
  avatar?: Partial<AgentAvatarVisual> | null;
  size?: number;
  trackCursor?: boolean;
  animated?: boolean;
  mood?: MascotEyeMood;
  activity?: AvatarTaskContext | string | null;
  expressionOverride?: AvatarExpression | null;
  hoverAnimate?: boolean;
  agentKey?: string;
  label?: string;
  className?: string;
}

/**
 * Motor unificado de avatares do CriativoOS:
 * - "classic": pelúcia 3D original com animação ocular.
 * - 6 estilos expressivos (plush, cartoon, robots, personas, pets, monsters) com 20 variantes cada e 16+1 expressões ligadas ao contexto da tarefa.
 * - "image": foto real enviada ou gerada com IA.
 */
export const MascoteAvatar: React.FC<MascoteAvatarProps> = ({
  shape,
  color,
  style,
  variant,
  imageUrl,
  avatar,
  size = 40,
  trackCursor = false,
  animated = false,
  mood = "idle",
  activity = null,
  expressionOverride = null,
  hoverAnimate,
  agentKey = "",
  label = "Mascote do Criativo",
  className = "",
}) => {
  const uid = useId().replace(/:/g, "");
  const containerRef = useRef<SVGSVGElement | null>(null);
  const lastHoverFaceRef = useRef<ClassicEyeFace | null>(null);
  const lastExpressiveHoverRef = useRef<AvatarExpression | null>(null);

  const resolvedStyle: AvatarStyle = normalizeAvatarStyle(
    style ?? avatar?.style ?? "classic"
  );
  const resolvedShape: AvatarShape = shape ?? avatar?.shape ?? "blob";
  const resolvedColor: string = color ?? avatar?.color ?? "#38bdf8";
  const resolvedVariant: string =
    variant ?? avatar?.variant ?? getDefaultVariantForStyle(resolvedStyle, resolvedShape);
  const resolvedImageUrl: string | null =
    imageUrl !== undefined ? imageUrl : (avatar?.imageUrl ?? null);

  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [hoverFace, setHoverFace] = useState<ClassicEyeFace>("resting");
  const [hoverExpressiveFace, setHoverExpressiveFace] = useState<AvatarExpression>("wink");
  const [workingIdx, setWorkingIdx] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const [playlistIdx, setPlaylistIdx] = useState(0);
  const [talkPhase, setTalkPhase] = useState(1);

  const isWorking = mood === "working" || animated;
  const enableHover = hoverAnimate ?? size >= 24;
  const taskContext = inferTaskContextFromActivity({
    mood,
    activity,
  });
  const playlist = TASK_EXPRESSION_PLAYLISTS[taskContext];
  const seed = hashSeed(`${agentKey}:${resolvedStyle}:${resolvedVariant}:${resolvedColor}`);

  // Reset playlist index when taskContext changes sharply so transitions reflect task mood quickly
  useEffect(() => {
    setPlaylistIdx(0);
  }, [taskContext]);

  // Rastreia hover/ponteiro sobre o avatar ou botão pai
  useEffect(() => {
    if (!enableHover || resolvedStyle === "image" || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const svgEl = containerRef.current;
    if (!svgEl) return;

    const host: Element =
      svgEl.closest("button, a, [role='button'], [data-avatar-hover]") ?? svgEl;

    const onEnter = () => {
      const next = pickDifferentHoverFace(lastHoverFaceRef.current);
      lastHoverFaceRef.current = next;
      setHoverFace(next);
      const nextExp = pickDifferentExpressiveHoverFace(lastExpressiveHoverRef.current);
      lastExpressiveHoverRef.current = nextExp;
      setHoverExpressiveFace(nextExp);
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
  }, [enableHover, trackCursor, resolvedStyle]);

  // Rastreio contínuo de cursor
  useEffect(() => {
    if (!trackCursor || resolvedStyle === "image" || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const handleMove = (ev: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setEyeOffset({
        x: clamp((ev.clientX - cx) / 140, -1, 1) * 3.1,
        y: clamp((ev.clientY - cy) / 140, -1, 1) * 2.4,
      });
    };

    window.addEventListener("pointermove", handleMove, { passive: true });
    return () => window.removeEventListener("pointermove", handleMove);
  }, [trackCursor, resolvedStyle]);

  // Ciclo orgânico de olhar/expressões em avatares ativos ou expressivos grandes
  useEffect(() => {
    if (typeof window === "undefined" || resolvedStyle === "image") {
      setBlinking(false);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const isExpressive = resolvedStyle !== "classic";
    const shouldCycle =
      resolvedStyle === "classic"
        ? isWorking
        : isWorking && size >= 24 && !expressionOverride;

    if (!shouldCycle) {
      setPlaylistIdx(0);
      return;
    }

    let stepTimer: number | undefined;
    let blinkTimer: number | undefined;
    let cancelled = false;

    const basePeriod =
      isWorking || taskContext === "error" || taskContext === "ads"
        ? 2600 + (seed % 1400)
        : 5200 + (seed % 2600);

    const scheduleStep = () => {
      const jitter = Math.random() * 750;
      stepTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (resolvedStyle === "classic") {
          setWorkingIdx((prev) => (prev + 1 + Math.floor(Math.random() * 2)) % WORKING_GAZES.length);
        } else if (isExpressive) {
          setPlaylistIdx((prev) => (prev + 1) % Math.max(1, playlist.length));
        }

        if (Math.random() < 0.52) {
          setBlinking(true);
          blinkTimer = window.setTimeout(() => {
            if (!cancelled) setBlinking(false);
          }, 135);
        }
        scheduleStep();
      }, isWorking && resolvedStyle === "classic" ? 520 + Math.random() * 880 : basePeriod + jitter);
    };

    scheduleStep();
    return () => {
      cancelled = true;
      if (stepTimer) window.clearTimeout(stepTimer);
      if (blinkTimer) window.clearTimeout(blinkTimer);
    };
  }, [
    isWorking,
    resolvedStyle,
    size,
    taskContext,
    playlist.length,
    expressionOverride,
    seed,
  ]);

  // Piscada orgânica apenas em hover ou rastreio de cursor em repouso (todos os estilos SVG)
  useEffect(() => {
    if (
      resolvedStyle === "image" ||
      (!trackCursor && !isHovered) ||
      isWorking ||
      typeof window === "undefined"
    ) {
      return;
    }
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
  }, [resolvedStyle, trackCursor, isHovered, isWorking]);

  const currentExpressiveExp: AvatarExpression =
    expressionOverride ??
    (isHovered && !isWorking
      ? hoverExpressiveFace
      : isWorking
        ? (playlist[playlistIdx % playlist.length] ?? "cute")
        : taskContext === "idle"
          ? "cute"
          : (playlist[0] ?? "cute"));

  // Articulação silábica rápida quando o avatar está falando ("talking")
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      resolvedStyle === "classic" ||
      resolvedStyle === "image" ||
      currentExpressiveExp !== "talking" ||
      size < 20
    ) {
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setTalkPhase((prev) => (prev + 1) % 4);
    }, 175);
    return () => window.clearInterval(id);
  }, [resolvedStyle, currentExpressiveExp, size]);

  // Renderizador Clássico (100% compatível com o original)
  const renderClassicSvg = () => {
    const pathData = CLASSIC_SHAPE_PATHS[resolvedShape] ?? CLASSIC_SHAPE_PATHS.blob;
    const workingGaze = WORKING_GAZES[workingIdx] ?? WORKING_GAZES[0];

    const activeFace: ClassicEyeFace = isHovered
      ? hoverFace
      : isWorking
        ? workingGaze.face
        : mood === "waiting"
          ? "curieux"
          : mood === "responded" || mood === "completed"
            ? "excite"
            : "resting";

    const activeOffsetX =
      isHovered || trackCursor ? eyeOffset.x : isWorking ? workingGaze.x : 0;
    const activeOffsetY =
      isHovered || trackCursor ? eyeOffset.y : isWorking ? workingGaze.y : 0;

    const animClass = mood === "working" ? "mascote-working" : animated ? "mascote-idle" : "";

    const leftScaleX =
      activeFace === "surpris" || activeFace === "wide"
        ? 1.18
        : activeFace === "squint"
          ? 1.16
          : activeFace === "attentif" || activeFace === "focused"
            ? 1.06
            : 1;
    const leftScaleY = blinking
      ? 0.14
      : activeFace === "surpris" || activeFace === "wide"
        ? 1.18
        : activeFace === "squint"
          ? 0.54
          : activeFace === "focused"
            ? 0.72
            : activeFace === "curieux"
              ? 1.1
              : activeFace === "attentif"
                ? 0.84
                : 1;
    const rightScaleX = leftScaleX;
    const rightScaleY = blinking
      ? 0.14
      : activeFace === "surpris" || activeFace === "wide"
        ? 1.18
        : activeFace === "squint"
          ? 0.54
          : activeFace === "focused"
            ? 0.72
            : activeFace === "curieux"
              ? 0.72
              : activeFace === "attentif"
                ? 0.84
                : 1;

    return (
      <svg
        ref={containerRef}
        data-avatar-style="classic"
        data-avatar-variant={resolvedShape}
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
            <stop offset="45%" stopColor={resolvedColor} stopOpacity="1" />
            <stop offset="100%" stopColor="#050505" stopOpacity="0.42" />
          </radialGradient>
          <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="0"
              dy="3"
              stdDeviation="3.5"
              floodColor={resolvedColor}
              floodOpacity="0.28"
            />
          </filter>
        </defs>

        <g filter={size >= 36 ? `url(#glow-${uid})` : undefined}>
          <path d={pathData} fill={resolvedColor} />
          <path d={pathData} fill={`url(#plush-${uid})`} />
          <path
            d={pathData}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="1.6"
          />
        </g>

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
              <g
                style={{
                  transform: `scale(${leftScaleX}, ${leftScaleY})`,
                  transformOrigin: "40.5px 50px",
                  transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <ellipse cx="40.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7" />
                <ellipse cx="41.4" cy="49.2" rx="1.6" ry="3.2" fill="#E6D5B8" opacity="0.55" />
                <circle cx="38.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92" />
              </g>

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
                  <circle cx="57.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92" />
                </g>
              )}
            </>
          )}
        </g>
      </svg>
    );
  };

  if (resolvedStyle === "image") {
    return (
      <PhotoAvatarRenderer
        imageUrl={resolvedImageUrl}
        color={resolvedColor}
        size={size}
        taskContext={taskContext}
        isWorking={isWorking}
        label={label}
        className={className}
        fallbackNode={renderClassicSvg()}
      />
    );
  }

  if (resolvedStyle === "classic") {
    return renderClassicSvg();
  }

  const animClass = mood === "working" ? "mascote-working" : animated ? "mascote-idle" : "";
  const workingGaze = WORKING_GAZES[playlistIdx % WORKING_GAZES.length] ?? WORKING_GAZES[0];
  const expressiveGazeX = isHovered || trackCursor ? eyeOffset.x : isWorking ? workingGaze.x : 0;
  const expressiveGazeY = isHovered || trackCursor ? eyeOffset.y : isWorking ? workingGaze.y : 0;

  return (
    <ExpressiveSvgAvatar
      svgRef={containerRef}
      style={resolvedStyle}
      variant={resolvedVariant}
      color={resolvedColor}
      size={size}
      expression={currentExpressiveExp}
      talkPhase={talkPhase}
      blink={blinking}
      gazeX={expressiveGazeX}
      gazeY={expressiveGazeY}
      isWorking={isWorking}
      label={label}
      className={`${animClass} ${className}`}
    />
  );
};

export interface ChannelMascoteClusterProps {
  members: Array<{
    agente_id: string;
    style?: AvatarStyle;
    shape?: AvatarShape;
    variant?: string;
    color?: string;
    imageUrl?: string | null;
  }>;
  size?: number;
}

/**
 * Cluster horizontal sobreposto de avatares para Canais em Equipe.
 */
export const ChannelMascoteCluster: React.FC<ChannelMascoteClusterProps> = ({
  members,
  size = 38,
}) => {
  const top3 = members.slice(0, 3);
  const avatarSize =
    top3.length <= 1
      ? size
      : top3.length === 2
        ? Math.max(20, Math.round(size * 0.68))
        : Math.max(18, Math.round(size * 0.56));
  const overlapPx = top3.length <= 1 ? 0 : Math.max(6, Math.round(avatarSize * 0.34));

  return (
    <div
      style={{ minWidth: size, height: size }}
      className="inline-flex items-center justify-center shrink-0"
      aria-label="Avatar do canal em equipe"
    >
      {top3.map((m, idx) => {
        const def = getDefaultMascotForAgent(m.agente_id || `m${idx}`);
        return (
          <div
            key={`${m.agente_id}-${idx}`}
            style={{
              marginLeft: idx === 0 ? 0 : -overlapPx,
              zIndex: idx + 1,
            }}
            className="relative rounded-full ring-2 ring-[#1A1A1A] bg-[#1A1A1A] flex items-center justify-center"
          >
            <MascoteAvatar
              style={m.style ?? "classic"}
              shape={m.shape ?? def.shape}
              variant={m.variant}
              color={m.color ?? def.color}
              imageUrl={m.imageUrl}
              size={avatarSize}
            />
          </div>
        );
      })}
    </div>
  );
};
