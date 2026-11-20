import React, { useEffect, useId, useRef, useState } from "react";
import type { AvatarShape } from "@criativo/contracts";

export type SplashInitialStage = "scout" | "expand" | "jumping";

type SplashStage =
  | "scout"
  | "expand"
  | "jumping"
  | "reveal-squash"
  | "reveal-burst"
  | "reveal-open";

type SplashFace = "resting" | "curieux" | "wink" | "blink" | "excite";

interface MascotMemberSpec {
  slot: -3 | -2 | -1 | 0 | 1 | 2 | 3;
  x: number;
  xStart: number;
  yEnd: number;
  shape: AvatarShape;
  color: string;
}

interface MascotVisualState {
  face: SplashFace;
  gx: number;
  gy: number;
  spark: boolean;
}

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

// Equipe fixa de 7 mascotes (3 à esquerda + batedor central + 3 à direita)
const SPLASH_SQUAD: readonly MascotMemberSpec[] = [
  { slot: -3, x: -186, xStart: -48, yEnd: -2, shape: "octo", color: "#a855f7" },
  { slot: -2, x: -124, xStart: -24, yEnd: -6, shape: "pill", color: "#3b82f6" },
  { slot: -1, x: -62, xStart: 0, yEnd: -10, shape: "hex", color: "#22c55e" },
  { slot: 0, x: 0, xStart: 0, yEnd: -14, shape: "blob", color: "#f97316" },
  { slot: 1, x: 62, xStart: 0, yEnd: -10, shape: "diamond", color: "#f27ba5" },
  { slot: 2, x: 124, xStart: 24, yEnd: -6, shape: "rounded_square", color: "#2dd4bf" },
  { slot: 3, x: 186, xStart: 48, yEnd: -2, shape: "triangle", color: "#eab308" },
];

const INITIAL_VISUAL_STATES: MascotVisualState[] = SPLASH_SQUAD.map((m) => ({
  face: m.slot === 0 ? "curieux" : "resting",
  gx: 0,
  gy: m.slot === 0 ? -0.8 : 0,
  spark: false,
}));

/**
 * Decide em qual ato o preloader do React deve iniciar para dar continuidade exata
 * ao splash nativo do Electron sem reiniciar a espiada.
 */
export function resolveInitialSplashStageFromSearch(search: string): SplashInitialStage {
  const params = new URLSearchParams(search);
  if (params.get("fromSplash") !== "1") return "scout";
  const splashElapsed = Number(params.get("splashElapsed") || "0");
  if (Number.isFinite(splashElapsed) && splashElapsed >= 1900) {
    return "jumping";
  }
  return "expand";
}

interface SplashMascotSvgProps {
  uidPrefix: string;
  shape: AvatarShape;
  color: string;
  face: SplashFace;
  gx: number;
  gy: number;
}

const SplashMascotSvg: React.FC<SplashMascotSvgProps> = ({
  uidPrefix,
  shape,
  color,
  face,
  gx,
  gy,
}) => {
  const path = SHAPE_PATHS[shape] ?? SHAPE_PATHS.blob;
  const ryR = face === "curieux" ? 6.2 : 8.4;

  return (
    <svg width={52} height={52} viewBox="0 0 100 100" style={{ overflow: "visible", display: "block" }}>
      <defs>
        <radialGradient id={`plush-splash-${uidPrefix}`} cx="36%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.48" />
          <stop offset="45%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor="#050505" stopOpacity="0.42" />
        </radialGradient>
        <filter id={`glow-splash-${uidPrefix}`} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={color} floodOpacity="0.34" />
        </filter>
      </defs>
      <g filter={`url(#glow-splash-${uidPrefix})`}>
        <path d={path} fill={color} />
        <path d={path} fill={`url(#plush-splash-${uidPrefix})`} />
        <path d={path} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.6" />
      </g>
      <g
        style={{
          transform: `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`,
          transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {face === "excite" ? (
          <>
            <path
              d="M 35 52 Q 40.5 43.5 46 52"
              fill="none"
              stroke="#FFF8E7"
              strokeWidth="4.4"
              strokeLinecap="round"
            />
            <path
              d="M 54 52 Q 59.5 43.5 65 52"
              fill="none"
              stroke="#FFF8E7"
              strokeWidth="4.4"
              strokeLinecap="round"
            />
          </>
        ) : face === "wink" ? (
          <>
            <ellipse cx="40.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7" />
            <circle cx="38.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92" />
            <path
              d="M 54.5 51 Q 59.5 46 64.5 51"
              fill="none"
              stroke="#FFF8E7"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </>
        ) : face === "blink" ? (
          <>
            <ellipse cx="40.5" cy="50" rx="5.4" ry="1.3" fill="#FFF8E7" />
            <ellipse cx="59.5" cy="50" rx="5.4" ry="1.3" fill="#FFF8E7" />
          </>
        ) : (
          <>
            <ellipse cx="40.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7" />
            <circle cx="38.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92" />
            <ellipse cx="59.5" cy="50" rx="5.2" ry={ryR} fill="#FFF8E7" />
            <circle cx="57.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92" />
          </>
        )}
      </g>
    </svg>
  );
};

export interface StudioSplashPreloaderProps {
  loading: boolean;
  initialStage?: SplashInitialStage;
  onRevealComplete?: () => void;
}

/**
 * Preloader oficial (Variação 2B) — 100% sem texto, com continuidade opcional do splash Electron
 * e duração adaptativa até a conclusão real do carregamento + abertura em portal circular.
 */
export const StudioSplashPreloader: React.FC<StudioSplashPreloaderProps> = ({
  loading,
  initialStage = "scout",
  onRevealComplete,
}) => {
  const uid = useId().replace(/:/g, "");
  const [stage, setStage] = useState<SplashStage>(initialStage);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [peekRaised, setPeekRaised] = useState(initialStage !== "scout");
  const [scoutTiltDeg, setScoutTiltDeg] = useState(0);
  const [lineWide, setLineWide] = useState(initialStage !== "scout");
  const [pairsVisible, setPairsVisible] = useState<[boolean, boolean, boolean]>(
    initialStage === "jumping" ? [true, true, true] : [false, false, false]
  );
  const [visuals, setVisuals] = useState<MascotVisualState[]>(() =>
    initialStage === "jumping"
      ? SPLASH_SQUAD.map(() => ({ face: "resting", gx: 0, gy: 0, spark: false }))
      : INITIAL_VISUAL_STATES
  );

  const revealStartedRef = useRef(false);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;

  const setMemberVisual = (idx: number, patch: Partial<MascotVisualState>) => {
    setVisuals((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  // Detecta preferência de movimento reduzido somente no cliente
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setReducedMotion(true);
      setPeekRaised(true);
      setLineWide(true);
      setPairsVisible([true, true, true]);
      setStage("jumping");
    }
  }, []);

  // Coreografia de entrada (Atos 1 -> 2 -> 3)
  useEffect(() => {
    if (reducedMotion) return;
    if (stage !== "scout" && stage !== "expand") return;

    const timers: number[] = [];
    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      timers.push(id);
    };

    if (stage === "scout") {
      // Ato 1: Batedor central sobe pela metade e confere os dois lados com calma
      schedule(() => setPeekRaised(true), 100);
      schedule(() => {
        setScoutTiltDeg(-5);
        setMemberVisual(3, { face: "curieux", gx: -4.4, gy: -1.4 });
      }, 820);
      schedule(() => {
        setScoutTiltDeg(5);
        setMemberVisual(3, { face: "curieux", gx: 4.4, gy: -1.4 });
      }, 1260);
      schedule(() => {
        setScoutTiltDeg(0);
        setMemberVisual(3, { face: "wink", gx: 0, gy: -0.4 });
      }, 1640);
      schedule(() => {
        setStage("expand");
      }, 1900);
    } else if (stage === "expand") {
      // Ato 2: Central diminui revelando por inteiro enquanto 6 colegas saem (3 esq + 3 dir)
      setPeekRaised(true);
      setScoutTiltDeg(0);
      setLineWide(true);
      setMemberVisual(3, { face: "excite", gx: 0, gy: 0 });

      schedule(() => setMemberVisual(3, { face: "resting", gx: 0, gy: 0 }), 440);
      schedule(() => setPairsVisible([true, false, false]), 110);
      schedule(() => setPairsVisible([true, true, false]), 250);
      schedule(() => setPairsVisible([true, true, true]), 390);
      schedule(() => setStage("jumping"), 1050);
    }

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [stage, reducedMotion]);

  // Loop vivo enquanto aguarda o carregamento real terminar no Ato 3
  useEffect(() => {
    if (reducedMotion || stage !== "jumping") return;

    let cancelled = false;
    let beat = 0;
    const timers: number[] = [];

    const tick = () => {
      if (cancelled) return;
      const idx = beat % SPLASH_SQUAD.length;
      const mood: SplashFace = beat % 3 === 0 ? "excite" : beat % 3 === 1 ? "wink" : "blink";
      setMemberVisual(idx, {
        face: mood,
        gx: 0,
        gy: -0.5,
        spark: mood === "excite",
      });

      const resetId = window.setTimeout(() => {
        if (cancelled) return;
        setMemberVisual(idx, { face: "resting", gx: 0, gy: 0, spark: false });
      }, mood === "blink" ? 150 : 340);
      timers.push(resetId);

      beat += 1;
      const nextId = window.setTimeout(tick, 440);
      timers.push(nextId);
    };

    const startId = window.setTimeout(tick, 280);
    timers.push(startId);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [stage, reducedMotion]);

  // Ato 4: Dispara o Reveal somente após loading=false E entrada já no estágio jumping
  useEffect(() => {
    if (loading || stage !== "jumping" || revealStartedRef.current) return;
    revealStartedRef.current = true;

    const timers: number[] = [];
    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      timers.push(id);
    };

    if (reducedMotion) {
      setStage("reveal-open");
      schedule(() => onRevealCompleteRef.current?.(), 240);
      return () => timers.forEach((id) => window.clearTimeout(id));
    }

    // Fase 1: Squash sincronizado + todos felizes (^ ^)
    setVisuals(SPLASH_SQUAD.map(() => ({ face: "excite", gx: 0, gy: 0, spark: false })));
    setStage("reveal-squash");

    // Fase 2: Salto conjunto em leque + faíscas + anel laranja
    schedule(() => {
      setVisuals(SPLASH_SQUAD.map(() => ({ face: "excite", gx: 0, gy: 0, spark: true })));
      setStage("reveal-burst");
    }, 160);

    // Fase 3: Portal circular abrindo a interface por baixo
    schedule(() => {
      setStage("reveal-open");
    }, 350);

    schedule(() => {
      onRevealCompleteRef.current?.();
    }, 920);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [loading, stage, reducedMotion]);

  const isRevealing =
    stage === "reveal-squash" || stage === "reveal-burst" || stage === "reveal-open";
  const clipUnlocked = stage === "jumping" || isRevealing;

  const isSlotVisible = (slot: number): boolean => {
    if (slot === 0) return true;
    if (clipUnlocked) return true;
    const dist = Math.abs(slot);
    if (dist === 1) return pairsVisible[0];
    if (dist === 2) return pairsVisible[1];
    return pairsVisible[2];
  };

  return (
    <div
      role="status"
      aria-label="Carregando Criativo AI Studio"
      data-testid="studio-splash-preloader"
      data-splash-stage={stage}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden select-none"
      style={{
        background: "radial-gradient(circle at 50% 54%, #181615 0%, #0D0D0D 76%)",
        clipPath: stage === "reveal-open" ? "circle(0% at 50% 50%)" : "circle(100% at 50% 50%)",
        opacity: stage === "reveal-open" ? 0 : 1,
        pointerEvents: stage === "reveal-open" ? "none" : "auto",
        transition: reducedMotion
          ? "opacity 220ms ease"
          : "clip-path 560ms cubic-bezier(0.76, 0, 0.24, 1), opacity 340ms ease",
      }}
    >
      {/* Palco fixo centralizado (mesmas coordenadas usadas no splash nativo Electron) */}
      <div
        className="relative"
        style={{ width: 460, maxWidth: "calc(100vw - 24px)", height: 240 }}
      >
        {/* Brilho ambiente sob a linha do horizonte */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2"
          style={{
            top: 154,
            width: 440,
            height: 120,
            transform: "translate(-50%, -45%)",
            background:
              "radial-gradient(ellipse at center, rgba(249, 115, 22, 0.22) 0%, rgba(56, 189, 248, 0.09) 48%, transparent 74%)",
            filter: "blur(20px)",
            opacity: stage === "reveal-burst" || stage === "reveal-open" ? 0 : 1,
            transition: "opacity 380ms ease",
          }}
        />

        {/* Anel laranja de impacto no Reveal */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 top-1/2 rounded-full border-2 border-[#FF6B00] ${
            stage === "reveal-burst" || stage === "reveal-open" ? "studio-splash-ring-pop" : ""
          }`}
          style={{
            width: 96,
            height: 96,
            transform: "translate(-50%, -50%) scale(0.35)",
            opacity: stage === "reveal-burst" || stage === "reveal-open" ? undefined : 0,
          }}
        />

        {/* Janela do horizonte que corta pela metade na espiada e destrava para os pulos */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: 154,
            clipPath: clipUnlocked
              ? "inset(-140px -80px -160px -80px)"
              : "inset(-120px 0px 0px 0px)",
            WebkitClipPath: clipUnlocked
              ? "inset(-140px -80px -160px -80px)"
              : "inset(-120px 0px 0px 0px)",
          }}
        >
          {SPLASH_SQUAD.map((m, i) => {
            const isScout = m.slot === 0;
            const visible = isSlotVisible(m.slot);
            const visual = visuals[i] ?? { face: "resting", gx: 0, gy: 0, spark: false };

            let slotTransform = "";
            let slotOpacity = 1;
            let slotTransition = "transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 280ms ease";

            if (stage === "reveal-burst" || stage === "reveal-open") {
              const fanX = m.x * 1.68;
              const fanY = -152 - Math.abs(m.slot) * 12;
              slotTransform = `translate(calc(-50% + ${fanX}px), ${fanY}px) scale(0.86)`;
              slotOpacity = 0;
              slotTransition = "transform 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease";
            } else if (stage === "scout" && isScout) {
              slotTransform = peekRaised
                ? "translate(-50%, 40px) scale(2.15)"
                : "translate(-50%, 116px) scale(2.15)";
              slotOpacity = 1;
              slotTransition = "transform 620ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease";
            } else if (visible) {
              slotTransform = `translate(calc(-50% + ${m.x}px), ${m.yEnd}px) scale(1)`;
              slotOpacity = 1;
            } else {
              slotTransform = `translate(calc(-50% + ${m.xStart}px), 62px) scale(0.5)`;
              slotOpacity = 0;
            }

            const jumperClass =
              stage === "jumping" && !reducedMotion
                ? "studio-splash-hop"
                : "";

            const jumperTransform =
              stage === "reveal-squash"
                ? "translateY(8px) scale(1.16, 0.82)"
                : stage === "reveal-burst" || stage === "reveal-open"
                  ? "translateY(-10px) scale(0.95, 1.08)"
                  : isScout && stage === "scout"
                    ? `rotate(${scoutTiltDeg}deg)`
                    : undefined;

            return (
              <div
                key={m.slot}
                data-splash-mascot={m.slot}
                className="absolute bottom-0 left-1/2"
                style={{
                  width: 52,
                  height: 52,
                  transformOrigin: "center bottom",
                  zIndex: isScout ? 8 : 7 - Math.abs(m.slot),
                  transform: slotTransform,
                  opacity: slotOpacity,
                  transition: slotTransition,
                  willChange: "transform, opacity",
                }}
              >
                <div
                  className={`relative ${jumperClass}`}
                  style={{
                    width: 52,
                    height: 52,
                    transformOrigin: "center bottom",
                    animationDelay: stage === "jumping" ? `${i * 115}ms` : undefined,
                    transform: jumperTransform,
                    transition:
                      stage === "reveal-squash"
                        ? "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)"
                        : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                    willChange: "transform",
                  }}
                >
                  {/* Faísca criativa */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2"
                    style={{
                      top: -17,
                      transform: visual.spark
                        ? "translateX(-50%) translateY(-6px) scale(1)"
                        : "translateX(-50%) scale(0.35)",
                      opacity: visual.spark ? 1 : 0,
                      transition:
                        "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease",
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      style={{ display: "block", filter: `drop-shadow(0 0 6px ${m.color})` }}
                    >
                      <path
                        d="M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z"
                        fill={m.color}
                        stroke="#FFF8E7"
                        strokeWidth="1"
                      />
                    </svg>
                  </div>

                  <SplashMascotSvg
                    uidPrefix={`${uid}-${i}`}
                    shape={m.shape}
                    color={m.color}
                    face={visual.face}
                    gx={visual.gx}
                    gy={visual.gy}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Linha luminosa do horizonte */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 rounded-full"
          style={{
            top: 154,
            height: 1.5,
            width:
              stage === "reveal-burst" || stage === "reveal-open"
                ? 520
                : lineWide
                  ? 460
                  : 136,
            transform: "translateX(-50%)",
            opacity:
              stage === "reveal-burst" || stage === "reveal-open"
                ? 0
                : stage === "jumping"
                  ? 0.45
                  : 1,
            background:
              "linear-gradient(90deg, transparent, rgba(255, 107, 0, 0.52), rgba(255, 255, 255, 0.34), rgba(255, 107, 0, 0.52), transparent)",
            boxShadow: "0 0 14px rgba(255, 107, 0, 0.32)",
            transition: "width 540ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease",
          }}
        />
      </div>
    </div>
  );
};
