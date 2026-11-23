import React, { useEffect, useId, useRef, useState } from "react";
import type { AvatarShape } from "@criativo/contracts";
import { CriativoSymbolLogo } from "./CriativoSymbolLogo";

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

const SPLASH_STAGE_WIDTH = 960;
const SPLASH_STAGE_HEIGHT = 380;
const SPLASH_HORIZON_TOP = 250;
const SPLASH_MASCOT_SIZE = 104;
const SPLASH_SCOUT_SCALE = 2.65;

// Equipe fixa de 7 mascotes (3 à esquerda + batedor central + 3 à direita)
const SPLASH_SQUAD: readonly MascotMemberSpec[] = [
  { slot: -3, x: -396, xStart: -104, yEnd: -4, shape: "octo", color: "#a855f7" },
  { slot: -2, x: -264, xStart: -52, yEnd: -12, shape: "pill", color: "#3b82f6" },
  { slot: -1, x: -132, xStart: 0, yEnd: -20, shape: "hex", color: "#22c55e" },
  { slot: 0, x: 0, xStart: 0, yEnd: -28, shape: "blob", color: "#B9FC01" },
  { slot: 1, x: 132, xStart: 0, yEnd: -20, shape: "diamond", color: "#f27ba5" },
  { slot: 2, x: 264, xStart: 52, yEnd: -12, shape: "rounded_square", color: "#2dd4bf" },
  { slot: 3, x: 396, xStart: 104, yEnd: -4, shape: "triangle", color: "#eab308" },
];

const INITIAL_VISUAL_STATES: MascotVisualState[] = SPLASH_SQUAD.map((m) => ({
  face: m.slot === 0 ? "curieux" : "resting",
  gx: 0,
  gy: m.slot === 0 ? -0.8 : 0,
  spark: false,
}));

export const SPLASH_REVEAL_TIMINGS = {
  burstMs: 340,
  openMs: 920,
  completeMs: 1820,
  reducedCompleteMs: 320,
} as const;

export const SPLASH_TIMINGS = {
  // Ato 1: Batedor grandão espiando completo (~3,4s)
  scoutRiseMs: 140,
  scoutLookLeftMs: 1180,
  scoutLookRightMs: 1940,
  scoutWinkMs: 2680,
  expandStartMs: 3420,
  // Ato 2: Batedor diminui e os 6 colegas entram par a par (~2,2s)
  expandRestFaceMs: 720,
  expandPair1Ms: 360,
  expandPair2Ms: 840,
  expandPair3Ms: 1320,
  expandDurationMs: 2200,
  // Ato 3: Tempo mínimo com todos os 7 pulando antes de liberar o Reveal
  minJumpingMs: 2600,
} as const;

/**
 * Calcula a escala proporcional do palco para ocupar ~70% da largura da tela sem vazar verticalmente.
 */
export function computeSplashStageScale(
  viewportWidth?: number,
  viewportHeight?: number
): number {
  const w =
    typeof viewportWidth === "number"
      ? viewportWidth
      : typeof window !== "undefined"
        ? window.innerWidth
        : 1380;
  const h =
    typeof viewportHeight === "number"
      ? viewportHeight
      : typeof window !== "undefined"
        ? window.innerHeight
        : 880;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  const raw = Math.min((w * 0.72) / SPLASH_STAGE_WIDTH, (h * 0.62) / SPLASH_STAGE_HEIGHT);
  return Math.max(0.35, Math.min(1.85, Number(raw.toFixed(4))));
}

/**
 * Inicia sempre pelo Ato 1 ("scout") para garantir que a animação completa do batedor
 * seja exibida por inteiro do começo ao fim na entrada do app, sem cortes.
 */
export function resolveInitialSplashStageFromSearch(_search: string): SplashInitialStage {
  return "scout";
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
    <svg
      width={SPLASH_MASCOT_SIZE}
      height={SPLASH_MASCOT_SIZE}
      viewBox="0 0 100 100"
      style={{ overflow: "visible", display: "block" }}
    >
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

  const [stageScale, setStageScale] = useState<number>(() => computeSplashStageScale());
  const [minJumpDone, setMinJumpDone] = useState(false);
  const revealStartedRef = useRef(false);
  const revealTimersRef = useRef<number[]>([]);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateScale = () => setStageScale(computeSplashStageScale());
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => {
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const id of revealTimersRef.current) {
        window.clearTimeout(id);
      }
      revealTimersRef.current = [];
      revealStartedRef.current = false;
    };
  }, []);

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
      schedule(() => setPeekRaised(true), SPLASH_TIMINGS.scoutRiseMs);
      schedule(() => {
        setScoutTiltDeg(-6);
        setMemberVisual(3, { face: "curieux", gx: -4.8, gy: -1.4 });
      }, SPLASH_TIMINGS.scoutLookLeftMs);
      schedule(() => {
        setScoutTiltDeg(6);
        setMemberVisual(3, { face: "curieux", gx: 4.8, gy: -1.4 });
      }, SPLASH_TIMINGS.scoutLookRightMs);
      schedule(() => {
        setScoutTiltDeg(0);
        setMemberVisual(3, { face: "wink", gx: 0, gy: -0.4 });
      }, SPLASH_TIMINGS.scoutWinkMs);
      schedule(() => {
        setStage("expand");
      }, SPLASH_TIMINGS.expandStartMs);
    } else if (stage === "expand") {
      // Ato 2: Central diminui revelando por inteiro enquanto 6 colegas saem (3 esq + 3 dir)
      setPeekRaised(true);
      setScoutTiltDeg(0);
      setLineWide(true);
      setMemberVisual(3, { face: "excite", gx: 0, gy: 0 });

      schedule(
        () => setMemberVisual(3, { face: "resting", gx: 0, gy: 0 }),
        SPLASH_TIMINGS.expandRestFaceMs
      );
      schedule(() => setPairsVisible([true, false, false]), SPLASH_TIMINGS.expandPair1Ms);
      schedule(() => setPairsVisible([true, true, false]), SPLASH_TIMINGS.expandPair2Ms);
      schedule(() => setPairsVisible([true, true, true]), SPLASH_TIMINGS.expandPair3Ms);
      schedule(() => setStage("jumping"), SPLASH_TIMINGS.expandDurationMs);
    }

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [stage, reducedMotion]);

  // Garante tempo mínimo com todos os 7 mascotes pulando juntos antes de liberar o Reveal
  useEffect(() => {
    if (stage === "scout" || stage === "expand") {
      setMinJumpDone(false);
      return;
    }
    if (stage !== "jumping") return;
    if (reducedMotion) {
      setMinJumpDone(true);
      return;
    }
    setMinJumpDone(false);
    const id = window.setTimeout(() => setMinJumpDone(true), SPLASH_TIMINGS.minJumpingMs);
    return () => {
      window.clearTimeout(id);
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
      }, mood === "blink" ? 160 : 380);
      timers.push(resetId);

      beat += 1;
      const nextId = window.setTimeout(tick, 520);
      timers.push(nextId);
    };

    const startId = window.setTimeout(tick, 280);
    timers.push(startId);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [stage, reducedMotion]);

  // Ato 4: Dispara o Reveal somente após loading=false E entrada já no estágio jumping com tempo mínimo de pulos.
  // Os timers ficam em revealTimersRef (limpos apenas no unmount) para que a transição
  // jumping -> reveal-squash nunca cancele reveal-burst / reveal-open / onRevealComplete.
  useEffect(() => {
    if (loading || stage !== "jumping" || !minJumpDone || revealStartedRef.current) return;
    revealStartedRef.current = true;

    const scheduleReveal = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      revealTimersRef.current.push(id);
    };

    if (reducedMotion) {
      setStage("reveal-open");
      scheduleReveal(
        () => onRevealCompleteRef.current?.(),
        SPLASH_REVEAL_TIMINGS.reducedCompleteMs
      );
      return;
    }

    // Fase 1: Squash sincronizado + todos felizes (^ ^)
    setVisuals(SPLASH_SQUAD.map(() => ({ face: "excite", gx: 0, gy: 0, spark: false })));
    setStage("reveal-squash");

    // Fase 2: Salto conjunto em leque + faíscas + anel laranja
    scheduleReveal(() => {
      setVisuals(SPLASH_SQUAD.map(() => ({ face: "excite", gx: 0, gy: 0, spark: true })));
      setStage("reveal-burst");
    }, SPLASH_REVEAL_TIMINGS.burstMs);

    // Fase 3: Portal circular abrindo a interface por baixo
    scheduleReveal(() => {
      setStage("reveal-open");
    }, SPLASH_REVEAL_TIMINGS.openMs);

    scheduleReveal(() => {
      onRevealCompleteRef.current?.();
    }, SPLASH_REVEAL_TIMINGS.completeMs);
  }, [loading, stage, minJumpDone, reducedMotion]);

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
      aria-label="Carregando CriativoOS"
      data-testid="studio-splash-preloader"
      data-splash-stage={stage}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden select-none"
      style={{
        background: "radial-gradient(circle at 50% 54%, #181615 0%, #0D0D0D 76%)",
        clipPath: stage === "reveal-open" ? "circle(0% at 50% 50%)" : "circle(85% at 50% 50%)",
        WebkitClipPath:
          stage === "reveal-open" ? "circle(0% at 50% 50%)" : "circle(85% at 50% 50%)",
        opacity: stage === "reveal-open" ? 0 : 1,
        pointerEvents: stage === "reveal-open" ? "none" : "auto",
        transition: reducedMotion
          ? "opacity 300ms ease"
          : "clip-path 780ms cubic-bezier(0.65, 0, 0.25, 1), -webkit-clip-path 780ms cubic-bezier(0.65, 0, 0.25, 1), opacity 180ms ease 600ms",
      }}
    >
      {/* Palco fixo centralizado com escala responsiva (~70% da tela, mesmas coordenadas do splash Electron) */}
      <div
        className="relative shrink-0"
        data-splash-stage-root="1"
        style={{
          width: SPLASH_STAGE_WIDTH,
          height: SPLASH_STAGE_HEIGHT,
          transform: `scale(${stageScale})`,
          transformOrigin: "center center",
        }}
      >
        {/* Brilho ambiente sob a linha do horizonte */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2"
          style={{
            top: SPLASH_HORIZON_TOP,
            width: 900,
            height: 210,
            transform: "translate(-50%, -45%)",
            background:
              "radial-gradient(ellipse at center, rgba(185, 252, 1, 0.20) 0%, rgba(0, 49, 204, 0.10) 48%, transparent 74%)",
            filter: "blur(36px)",
            opacity: stage === "reveal-burst" || stage === "reveal-open" ? 0 : 1,
            transition: "opacity 420ms ease",
          }}
        />

        {/* Anel Volt de impacto no Reveal + Easter Egg oO piscando */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 rounded-full border-[4px] border-[#B9FC01] ${
            stage === "reveal-burst" || stage === "reveal-open" ? "studio-splash-ring-pop" : ""
          }`}
          style={{
            top: SPLASH_HORIZON_TOP - 40,
            width: 220,
            height: 220,
            transform: "translate(-50%, -50%) scale(0.35)",
            boxShadow: "0 0 36px rgba(185, 252, 1, 0.45)",
            opacity: stage === "reveal-burst" || stage === "reveal-open" ? undefined : 0,
          }}
        />

        {/* Assinatura discreta CriativoOS abaixo do horizonte com Easter Egg na transição */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 flex flex-col items-center gap-1"
          style={{
            top: SPLASH_HORIZON_TOP + 22,
            transform: "translateX(-50%)",
            opacity: stage === "reveal-open" ? 0 : 0.85,
            transition: "opacity 240ms ease",
          }}
        >
          <CriativoSymbolLogo
            size={34}
            color="#B9FC01"
            blinkActive={stage === "reveal-squash" || stage === "reveal-burst"}
          />
        </div>

        {/* Janela do horizonte que corta pela metade na espiada e destrava para os pulos */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: SPLASH_HORIZON_TOP,
            clipPath: clipUnlocked ? "none" : "inset(-360px -80px 0px -80px)",
            WebkitClipPath: clipUnlocked ? "none" : "inset(-360px -80px 0px -80px)",
          }}
        >
          {SPLASH_SQUAD.map((m, i) => {
            const isScout = m.slot === 0;
            const visible = isSlotVisible(m.slot);
            const visual = visuals[i] ?? { face: "resting", gx: 0, gy: 0, spark: false };

            let slotTransform = "";
            let slotOpacity = 1;
            let slotTransition = "transform 760ms cubic-bezier(0.34, 1.4, 0.64, 1), opacity 360ms ease";

            if (stage === "reveal-burst" || stage === "reveal-open") {
              const fanX = m.x * 1.45;
              const fanY = -280 - Math.abs(m.slot) * 24;
              slotTransform = `translate(calc(-50% + ${fanX}px), ${fanY}px) scale(1.06)`;
              slotOpacity = 0;
              slotTransition = "transform 580ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease 180ms";
            } else if (stage === "scout" && isScout) {
              slotTransform = peekRaised
                ? `translate(-50%, 100px) scale(${SPLASH_SCOUT_SCALE})`
                : `translate(-50%, 290px) scale(${SPLASH_SCOUT_SCALE})`;
              slotOpacity = 1;
              slotTransition = "transform 950ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease";
            } else if (visible) {
              slotTransform = `translate(calc(-50% + ${m.x}px), ${m.yEnd}px) scale(1)`;
              slotOpacity = 1;
            } else {
              slotTransform = `translate(calc(-50% + ${m.xStart}px), 124px) scale(0.5)`;
              slotOpacity = 0;
            }

            const jumperClass =
              stage === "jumping" && !reducedMotion
                ? "studio-splash-hop"
                : "";

            const jumperTransform =
              stage === "reveal-squash"
                ? "translateY(18px) scale(1.18, 0.78)"
                : stage === "reveal-burst" || stage === "reveal-open"
                  ? "translateY(-22px) scale(0.94, 1.1)"
                  : isScout && stage === "scout"
                    ? `rotate(${scoutTiltDeg}deg)`
                    : undefined;

            return (
              <div
                key={m.slot}
                data-splash-mascot={m.slot}
                className="absolute bottom-0 left-1/2"
                style={{
                  width: SPLASH_MASCOT_SIZE,
                  height: SPLASH_MASCOT_SIZE,
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
                    width: SPLASH_MASCOT_SIZE,
                    height: SPLASH_MASCOT_SIZE,
                    transformOrigin: "center bottom",
                    animationDelay: stage === "jumping" ? `${i * 140}ms` : undefined,
                    transform: jumperTransform,
                    transition:
                      stage === "reveal-squash"
                        ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)"
                        : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
                    willChange: "transform",
                  }}
                >
                  {/* Faísca criativa */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2"
                    style={{
                      top: -30,
                      transform: visual.spark
                        ? "translateX(-50%) translateY(-10px) scale(1)"
                        : "translateX(-50%) scale(0.35)",
                      opacity: visual.spark ? 1 : 0,
                      transition:
                        "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease",
                    }}
                  >
                    <svg
                      width={26}
                      height={26}
                      viewBox="0 0 24 24"
                      style={{ display: "block", filter: `drop-shadow(0 0 8px ${m.color})` }}
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
            top: SPLASH_HORIZON_TOP,
            height: 2,
            width:
              stage === "reveal-burst" || stage === "reveal-open"
                ? 1040
                : lineWide
                  ? 940
                  : 320,
            transform: "translateX(-50%)",
            opacity:
              stage === "reveal-burst" || stage === "reveal-open"
                ? 0
                : stage === "jumping"
                  ? 0.45
                  : 1,
            background:
              "linear-gradient(90deg, transparent, rgba(185, 252, 1, 0.55), rgba(255, 255, 255, 0.34), rgba(185, 252, 1, 0.55), transparent)",
            boxShadow: "0 0 22px rgba(185, 252, 1, 0.38)",
            transition: "width 900ms cubic-bezier(0.22, 1, 0.36, 1), opacity 360ms ease",
          }}
        />
      </div>
    </div>
  );
};
