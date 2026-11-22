import React from "react";
import {
  AvatarFaceRig,
  AvatarFxLayer,
  AvatarGlassesOverlay,
} from "./avatar-face-rig";
import type { ExpressiveBodyRenderProps } from "./avatar-accessories-and-photo";

export function renderPersonasAndPetsStyles({
  style,
  variant,
  color,
  size,
  expression,
  talkPhase,
  blink,
  gazeX,
  gazeY,
  isWorking = false,
  label = "Avatar do agente",
  className = "",
  svgRef,
  uid,
}: ExpressiveBodyRenderProps & { uid: string }): React.ReactNode | null {
  if (style === "personas") {
    const key = variant.replace(/^per_/, "");
    const skinMap: Record<string, string> = {
      heisenberg: "#f5cba7",
      catgirl: "#fbdcc4",
      vampire: "#e2e8f0",
      bun: "#fbdcc4",
      ninja: "#f5cba7",
      long_dark: "#fde2c8",
      agent: "#8d5524",
      gamer: "#f5cba7",
      paperbag: "#a16207",
      senior: "#fbdcc4",
      pigtails: "#fde2c8",
      cap_creator: "#e0ac69",
      afro: "#7c4722",
      bob: "#fde2c8",
      beret: "#f5cba7",
      chef: "#f1c27d",
      astro: "#f5cba7",
      punk: "#fbdcc4",
      royal: "#f5cba7",
      cyber: "#e2e8f0",
    };
    const skin = skinMap[key] ?? "#fbdcc4";
    const coat =
      key === "vampire" || key === "agent" || key === "heisenberg"
        ? "#27272a"
        : key === "chef" || key === "astro"
          ? "#f8fafc"
          : "#334155";
    const hasShades = key === "heisenberg" || key === "agent";
    const hasGlasses = key === "senior";
    const hasVisor = key === "cyber";
    const overlayKind =
      expression === "cool"
        ? "cool"
        : hasShades
          ? "shades"
          : hasGlasses
            ? "glasses"
            : hasVisor
              ? "visor"
              : null;

    return (
      <svg
        ref={svgRef}
        data-avatar-style={style}
        data-avatar-variant={variant}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        className={`shrink-0 select-none overflow-visible ${className}`}
      >
        <defs>
          <clipPath id={`prc-${uid}`}>
            <circle cx="50" cy="50" r="43" />
          </clipPath>
        </defs>
        <circle cx="50" cy="50" r="45" fill={color} stroke="#18181b" strokeWidth="3" />
        <g clipPath={`url(#prc-${uid})`}>
          {/* Ombros / Roupa */}
          <path
            d="M 22 96 Q 26 73 50 73 Q 74 73 78 96 Z"
            fill={coat}
            stroke="#18181b"
            strokeWidth="2.5"
          />
          {key === "vampire" && (
            <path d="M 31 76 L 36 66 L 50 75 L 64 66 L 69 76 Z" fill="#7c3aed" stroke="#18181b" strokeWidth="1.8" />
          )}

          {/* Cabelo de fundo */}
          {key === "afro" && <circle cx="50" cy="48" r="29" fill="#18181b" />}
          {key === "long_dark" && (
            <rect x="27" y="29" width="46" height="52" rx="20" fill="#18181b" stroke="#09090b" strokeWidth="2" />
          )}
          {key === "catgirl" && (
            <>
              <path d="M 30 37 L 31 19 L 44 29 Z" fill="#9a4e24" stroke="#18181b" strokeWidth="2.2" />
              <path d="M 70 37 L 69 19 L 56 29 Z" fill="#9a4e24" stroke="#18181b" strokeWidth="2.2" />
              <rect x="29" y="29" width="42" height="47" rx="19" fill="#9a4e24" stroke="#18181b" strokeWidth="2" />
            </>
          )}
          {key === "pigtails" && (
            <>
              <path d="M 29 36 C 18 39 17 56 24 62" fill="#facc15" stroke="#18181b" strokeWidth="2.2" />
              <path d="M 71 36 C 82 39 83 56 76 62" fill="#facc15" stroke="#18181b" strokeWidth="2.2" />
            </>
          )}

          {/* Orelhas */}
          <circle cx="30" cy="52" r="4" fill={skin} stroke="#18181b" strokeWidth="2" />
          <circle cx="70" cy="52" r="4" fill={skin} stroke="#18181b" strokeWidth="2" />

          {/* Cabeça ou Saco de Papel Misterioso */}
          {key === "paperbag" ? (
            <path
              d="M 30 24 L 70 24 L 73 74 L 64 70 L 57 75 L 50 70 L 43 75 L 36 70 L 27 74 Z"
              fill="#b45309"
              stroke="#18181b"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          ) : (
            <circle cx="50" cy="53" r="19.5" fill={skin} stroke="#18181b" strokeWidth="2.4" />
          )}

          {/* Barba / Cavanhaque */}
          {key === "heisenberg" && (
            <path d="M 42 62 Q 50 75 58 62 Q 50 66 42 62 Z" fill="#451a03" stroke="#18181b" strokeWidth="1.5" />
          )}
          {key === "senior" && (
            <path d="M 33 58 Q 35 76 50 77 Q 65 76 67 58 Q 50 63 33 58 Z" fill="#f8fafc" stroke="#18181b" strokeWidth="2" />
          )}

          {/* Motor de Rosto */}
          <AvatarFaceRig
            expression={expression}
            talkPhase={talkPhase}
            blink={blink}
            gazeX={gazeX}
            gazeY={gazeY}
            cx={50}
            cy={54}
            scale={0.46}
            lidColor="#d4a373"
          />

          {/* Cabelo frontal / Chapéus (antes ou junto com a borda da testa, NUNCA tapando óculos) */}
          {key === "catgirl" && (
            <path d="M 33 41 Q 50 32 67 41 L 66 32 Q 50 25 34 32 Z" fill="#9a4e24" stroke="#18181b" strokeWidth="1.8" />
          )}
          {key === "pigtails" && (
            <path d="M 33 41 Q 50 32 67 41 L 66 32 Q 50 25 34 32 Z" fill="#facc15" stroke="#18181b" strokeWidth="1.8" />
          )}
          {key === "senior" && (
            <path d="M 32 41 Q 36 24 50 24 Q 64 24 68 41 Q 59 33 50 33 Q 41 33 32 41 Z" fill="#f8fafc" stroke="#18181b" strokeWidth="2" />
          )}
          {key === "agent" && (
            <path d="M 32 41 Q 50 28 68 41 Q 66 28 50 28 Q 34 28 32 41 Z" fill="#18181b" />
          )}
          {key === "bun" && (
            <>
              <circle cx="50" cy="26" r="7" fill="#fde047" stroke="#18181b" strokeWidth="2" />
              <path d="M 32 45 Q 50 32 68 45 Q 66 30 50 30 Q 34 30 32 45 Z" fill="#fde047" stroke="#18181b" strokeWidth="2" />
            </>
          )}
          {key === "long_dark" && (
            <path d="M 32 44 Q 44 33 68 42 Q 66 30 50 30 Q 34 30 32 44 Z" fill="#18181b" />
          )}
          {key === "bob" && (
            <path d="M 30 48 Q 30 29 50 29 Q 70 29 70 48 Q 62 39 50 39 Q 38 39 30 48 Z" fill="#ec4899" stroke="#18181b" strokeWidth="2" />
          )}
          {key === "punk" && (
            <path d="M 44 34 L 42 15 L 50 20 L 58 14 L 56 34 Z" fill="#22d3ee" stroke="#18181b" strokeWidth="2" />
          )}
          {key === "vampire" && (
            <path d="M 31 45 Q 35 32 50 38 Q 65 32 69 45 Q 64 29 50 29 Q 36 29 31 45 Z" fill="#18181b" />
          )}
          {key === "heisenberg" && (
            <g>
              <line x1="22" y1="39" x2="78" y2="39" stroke="#18181b" strokeWidth="3.2" strokeLinecap="round" />
              <path d="M 31 39 L 35 20 L 65 20 L 69 39 Z" fill="#27272a" stroke="#18181b" strokeWidth="2.4" />
              <rect x="33" y="33" width="34" height="4" fill="#52525b" />
            </g>
          )}
          {key === "gamer" && (
            <g>
              <path d="M 27 52 Q 27 22 50 22 Q 73 22 73 52" fill="none" stroke="#8b5cf6" strokeWidth="4.6" strokeLinecap="round" />
              <rect x="23" y="44" width="8" height="16" rx="4" fill="#7c3aed" stroke="#18181b" strokeWidth="1.8" />
              <rect x="69" y="44" width="8" height="16" rx="4" fill="#7c3aed" stroke="#18181b" strokeWidth="1.8" />
            </g>
          )}
          {key === "ninja" && (
            <>
              <rect x="31" y="31" width="38" height="9" rx="3" fill="#dc2626" stroke="#18181b" strokeWidth="1.8" />
              <path d="M 48 31 Q 56 19 60 27 Q 54 31 48 31 Z" fill="#22c55e" stroke="#18181b" strokeWidth="1.5" />
            </>
          )}
          {key === "cap_creator" && (
            <g>
              <path d="M 30 37 Q 50 21 70 37 Z" fill="#2563eb" stroke="#18181b" strokeWidth="2" />
              <line x1="28" y1="37" x2="76" y2="37" stroke="#18181b" strokeWidth="3" strokeLinecap="round" />
            </g>
          )}
          {key === "beret" && (
            <ellipse cx="52" cy="30" rx="21" ry="8" transform="rotate(-12 52 30)" fill="#f43f5e" stroke="#18181b" strokeWidth="2" />
          )}
          {key === "chef" && (
            <path d="M 33 34 C 28 22 39 17 45 21 C 50 15 56 15 60 21 C 66 17 72 22 67 34 Z" fill="#ffffff" stroke="#18181b" strokeWidth="2" />
          )}
          {key === "royal" && (
            <path d="M 36 33 L 39 20 L 45 27 L 50 17 L 55 27 L 61 20 L 64 33 Z" fill="#facc15" stroke="#78350f" strokeWidth="1.8" />
          )}
          {key === "astro" && (
            <circle cx="50" cy="52" r="27" fill="none" stroke="#38bdf8" strokeWidth="3.2" strokeOpacity="0.85" />
          )}

          {/* ÓCULOS SEMPRE POR CIMA DOS OLHOS! */}
          {overlayKind && (
            <AvatarGlassesOverlay
              variant={overlayKind}
              cx={50}
              cy={54}
              scale={0.48}
            />
          )}
        </g>
        <AvatarFxLayer expression={expression} size={size} />
      </svg>
    );
  }

  // ==============================
  // 5. BICHINHOS / PETS (20 animais distintos)
  // ==============================
  if (style === "pets") {
    const key = variant.replace(/^pet_/, "");
    const isLightFace = key === "panda" || key === "penguin" || key === "chick";
    const headFill = key === "panda" ? "#f8fafc" : key === "penguin" ? "#1e293b" : key === "chick" ? "#fde047" : color;

    return (
      <svg
        ref={svgRef}
        data-avatar-style={style}
        data-avatar-variant={variant}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        className={`shrink-0 select-none overflow-visible ${className}`}
      >
        <g>
          {/* Orelhas / Juba / Chifres / Guelras específicos */}
          {key === "lion" && (
            <path
              d="M 50 6 L 62 14 L 77 13 L 84 26 L 94 37 L 91 52 L 95 66 L 84 77 L 75 88 L 60 87 L 50 94 L 40 87 L 25 88 L 16 77 L 5 66 L 9 52 L 6 37 L 16 26 L 23 13 L 38 14 Z"
              fill="#b45309"
              stroke="#18181b"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          )}
          {key === "bunny" && (
            <>
              <ellipse cx="33" cy="22" rx="9" ry="20" transform="rotate(-10 33 22)" fill={headFill} stroke="#18181b" strokeWidth="2.4" />
              <ellipse cx="33" cy="22" rx="4.5" ry="13" transform="rotate(-10 33 22)" fill="#fbcfe8" />
              <ellipse cx="67" cy="22" rx="9" ry="20" transform="rotate(10 67 22)" fill={headFill} stroke="#18181b" strokeWidth="2.4" />
              <ellipse cx="67" cy="22" rx="4.5" ry="13" transform="rotate(10 67 22)" fill="#fbcfe8" />
            </>
          )}
          {key === "dog" && (
            <>
              <ellipse cx="15" cy="58" rx="9" ry="20" transform="rotate(14 15 58)" fill="#78350f" stroke="#18181b" strokeWidth="2.4" />
              <ellipse cx="85" cy="58" rx="9" ry="20" transform="rotate(-14 85 58)" fill="#78350f" stroke="#18181b" strokeWidth="2.4" />
            </>
          )}
          {(key === "bear" || key === "panda" || key === "capybara") && (
            <>
              <circle cx="23" cy="28" r="11" fill={key === "panda" ? "#18181b" : headFill} stroke="#18181b" strokeWidth="2.4" />
              <circle cx="77" cy="28" r="11" fill={key === "panda" ? "#18181b" : headFill} stroke="#18181b" strokeWidth="2.4" />
            </>
          )}
          {key === "frog" && (
            <>
              <circle cx="28" cy="25" r="11" fill={headFill} stroke="#18181b" strokeWidth="2.4" />
              <circle cx="72" cy="25" r="11" fill={headFill} stroke="#18181b" strokeWidth="2.4" />
            </>
          )}
          {key === "axolotl" && (
            <>
              <path d="M 15 44 L 4 37 M 14 52 L 2 52 M 16 60 L 6 67" stroke="#f43f5e" strokeWidth="4.5" strokeLinecap="round" />
              <path d="M 85 44 L 96 37 M 86 52 L 98 52 M 84 60 L 94 67" stroke="#f43f5e" strokeWidth="4.5" strokeLinecap="round" />
            </>
          )}
          {key === "deer" && (
            <>
              <path d="M 32 28 L 24 8 M 27 16 L 19 14 M 26 20 L 34 15" stroke="#78350f" strokeWidth="3.6" strokeLinecap="round" />
              <path d="M 68 28 L 76 8 M 73 16 L 81 14 M 74 20 L 66 15" stroke="#78350f" strokeWidth="3.6" strokeLinecap="round" />
            </>
          )}
          {key === "bee" && (
            <>
              <ellipse cx="22" cy="28" rx="13" ry="8" transform="rotate(-28 22 28)" fill="#e0f2fe" stroke="#18181b" strokeWidth="2" opacity="0.85" />
              <ellipse cx="78" cy="28" rx="13" ry="8" transform="rotate(28 78 28)" fill="#e0f2fe" stroke="#18181b" strokeWidth="2" opacity="0.85" />
            </>
          )}
          {key === "dragon" && (
            <>
              <path d="M 27 29 L 20 10 L 37 22 Z" fill="#facc15" stroke="#18181b" strokeWidth="2.2" />
              <path d="M 73 29 L 80 10 L 63 22 Z" fill="#facc15" stroke="#18181b" strokeWidth="2.2" />
            </>
          )}
          {(key === "cat" || key === "fox" || key === "owl" || key === "tiger" || key === "raccoon" || key === "wolf") && (
            <>
              <path d="M 18 42 L 20 12 L 42 26 Z" fill={headFill} stroke="#18181b" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M 82 42 L 80 12 L 58 26 Z" fill={headFill} stroke="#18181b" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M 22 36 L 23 19 L 36 27 Z" fill="#fef3c7" opacity="0.8" />
              <path d="M 78 36 L 77 19 L 64 27 Z" fill="#fef3c7" opacity="0.8" />
            </>
          )}
          {key === "octopus" && (
            <path
              d="M 20 75 Q 16 90 26 89 Q 35 88 38 78 Q 44 92 50 92 Q 56 92 62 78 Q 65 88 74 89 Q 84 90 80 75"
              fill={headFill}
              stroke="#18181b"
              strokeWidth="2.4"
            />
          )}

          {/* Cabeça do Animal */}
          <ellipse
            cx="50"
            cy="56"
            rx={key === "capybara" ? 41 : 37}
            ry={33}
            fill={headFill}
            stroke="#18181b"
            strokeWidth="2.6"
          />

          {/* Detalhes internos característicos */}
          {key === "panda" && (
            <>
              <ellipse cx="37" cy="48" rx="11" ry="12" transform="rotate(-14 37 48)" fill="#18181b" />
              <ellipse cx="63" cy="48" rx="11" ry="12" transform="rotate(14 63 48)" fill="#18181b" />
            </>
          )}
          {key === "raccoon" && (
            <rect x="19" y="40" width="62" height="19" rx="9" fill="#334155" opacity="0.85" />
          )}
          {key === "penguin" && (
            <ellipse cx="50" cy="60" rx="28" ry="25" fill="#f8fafc" />
          )}
          {key === "tiger" && (
            <>
              <path d="M 44 24 L 47 34 L 50 24 L 53 34 L 56 24" fill="none" stroke="#18181b" strokeWidth="2.6" strokeLinecap="round" />
              <line x1="16" y1="53" x2="26" y2="55" stroke="#18181b" strokeWidth="2.4" strokeLinecap="round" />
              <line x1="84" y1="53" x2="74" y2="55" stroke="#18181b" strokeWidth="2.4" strokeLinecap="round" />
            </>
          )}
          {key === "bee" && (
            <path d="M 20 68 Q 50 74 80 68 L 76 76 Q 50 81 24 76 Z" fill="#18181b" />
          )}
          {key === "cat" && (
            <>
              <line x1="15" y1="60" x2="28" y2="62" stroke="#18181b" strokeWidth="1.7" strokeLinecap="round" />
              <line x1="15" y1="67" x2="28" y2="66" stroke="#18181b" strokeWidth="1.7" strokeLinecap="round" />
              <line x1="85" y1="60" x2="72" y2="62" stroke="#18181b" strokeWidth="1.7" strokeLinecap="round" />
              <line x1="85" y1="67" x2="72" y2="66" stroke="#18181b" strokeWidth="1.7" strokeLinecap="round" />
            </>
          )}
          {key === "fox" && (
            <>
              <path d="M 14 58 Q 25 58 31 74 L 18 74 Z" fill="#ffffff" opacity="0.88" />
              <path d="M 86 58 Q 75 58 69 74 L 82 74 Z" fill="#ffffff" opacity="0.88" />
            </>
          )}
          {key === "wolf" && (
            <path d="M 37 26 L 44 37 L 50 29 L 56 37 L 63 26 Z" fill="#334155" />
          )}
          {key === "owl" && (
            <path d="M 38 35 L 50 42 L 62 35" fill="none" stroke="#fef3c7" strokeWidth="3" strokeLinecap="round" />
          )}
          {!isLightFace && key !== "frog" && key !== "octopus" && key !== "axolotl" && (
            <ellipse cx="50" cy="69" rx="21" ry="14" fill="#fff7ed" opacity="0.72" />
          )}

          {/* Face Rig */}
          <AvatarFaceRig
            expression={expression}
            talkPhase={talkPhase}
            blink={blink}
            gazeX={gazeX}
            gazeY={gazeY}
            cx={50}
            cy={56}
            scale={0.76}
            lidColor="rgba(0,0,0,0.3)"
          />

          {/* Bico / Narizinho fofo acima da boca */}
          {(key === "owl" || key === "penguin" || key === "chick") && (
            <polygon points="46,56 54,56 50,62" fill="#f97316" stroke="#18181b" strokeWidth="1.4" />
          )}

          {expression === "cool" && (
            <AvatarGlassesOverlay variant="cool" cx={50} cy={56} scale={0.76} />
          )}
        </g>
        <AvatarFxLayer expression={expression} size={size} />
      </svg>
    );
  }
  return null;
}
