import React from "react";
import type { AvatarShape } from "@criativo/contracts";
import { CLASSIC_SHAPE_PATHS } from "./avatar-catalog";
import {
  AvatarFaceRig,
  AvatarFxLayer,
  AvatarGlassesOverlay,
} from "./avatar-face-rig";
import {
  renderTopAccessory,
  type ExpressiveBodyRenderProps,
} from "./avatar-accessories-and-photo";

export function renderClassicExpressiveStyles({
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
  // ==============================
  // 1. PLUSH+ (20 modelos com acessórios e 16 expressões)
  // ==============================
  if (style === "plush") {
    const shapeKey: AvatarShape =
      variant === "plush_star"
        ? "octo"
        : variant === "plush_cloud"
          ? "cloud"
          : variant === "plush_hex"
            ? "hex"
            : variant === "plush_diamond"
              ? "diamond"
              : "blob";
    const pathData = CLASSIC_SHAPE_PATHS[shapeKey];
    const accKey = variant.replace(/^plush_/, "");
    const overlayKind =
      expression === "cool"
        ? "cool"
        : accKey === "shades"
          ? "shades"
          : accKey === "glasses"
            ? "glasses"
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
          <radialGradient id={`plp-${uid}`} cx="36%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.48" />
            <stop offset="45%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor="#050505" stopOpacity="0.42" />
          </radialGradient>
        </defs>
        <g>
          <path d={pathData} fill={color} />
          <path d={pathData} fill={`url(#plp-${uid})`} />
          <path d={pathData} fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth="1.8" />
          {renderTopAccessory(accKey, color)}
          <AvatarFaceRig
            expression={expression}
            talkPhase={talkPhase}
            blink={blink}
            gazeX={gazeX}
            gazeY={gazeY}
            cx={50}
            cy={52}
            scale={0.76}
            eyeWhite="#FFF8E7"
            lidColor="rgba(0,0,0,0.34)"
          />
          {overlayKind && (
            <AvatarGlassesOverlay variant={overlayKind} cx={50} cy={52} scale={0.78} />
          )}
        </g>
        <AvatarFxLayer expression={expression} size={size} />
      </svg>
    );
  }

  // ==============================
  // 2. CARINHAS CARTOON (20 silhuetas/acessórios + bocas expressivas)
  // ==============================
  if (style === "cartoon") {
    const key = variant.replace(/^cart_/, "");
    const overlayKind =
      expression === "cool"
        ? "cool"
        : key === "shades"
          ? "shades"
          : key === "glasses"
            ? "glasses"
            : key === "visor"
              ? "visor"
              : null;

    const renderBodyShape = (customFill?: string) => {
      const fillVal = customFill ?? color;
      const strokeVal = customFill ? "none" : "#18181b";
      const strokeW = customFill ? 0 : 2.8;
      switch (key) {
        case "circle":
          return <circle cx="50" cy="50" r="42" fill={fillVal} stroke={strokeVal} strokeWidth={strokeW} />;
        case "pillow":
          return (
            <path
              d="M 50 9 C 78 9 91 22 91 50 C 91 78 78 91 50 91 C 22 91 9 78 9 50 C 9 22 22 9 50 9 Z"
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
            />
          );
        case "drop":
          return (
            <path
              d="M 50 8 C 72 28 88 46 88 64 C 88 82 72 91 50 91 C 28 91 12 82 12 64 C 12 46 28 28 50 8 Z"
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
            />
          );
        case "cloud":
          return (
            <path
              d={CLASSIC_SHAPE_PATHS.cloud}
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
            />
          );
        case "star":
          return (
            <path
              d={CLASSIC_SHAPE_PATHS.octo}
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
              strokeLinejoin="round"
            />
          );
        case "shield":
          return (
            <path
              d="M 16 14 L 84 14 L 84 52 C 84 74 50 91 50 91 C 50 91 16 74 16 52 Z"
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
              strokeLinejoin="round"
            />
          );
        case "ticket":
          return (
            <path
              d="M 12 20 A 8 8 0 0 0 20 12 L 80 12 A 8 8 0 0 0 88 20 L 88 80 A 8 8 0 0 0 80 88 L 20 88 A 8 8 0 0 0 12 80 Z"
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
            />
          );
        case "hex":
          return (
            <path
              d={CLASSIC_SHAPE_PATHS.hex}
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
            />
          );
        default:
          return (
            <rect
              x="9"
              y="10"
              width="82"
              height="82"
              rx="23"
              fill={fillVal}
              stroke={strokeVal}
              strokeWidth={strokeW}
            />
          );
      }
    };

    const accId = key === "sprout" ? "leaf" : key;

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
          <linearGradient id={`crt-${uid}`} x1="15%" y1="10%" x2="85%" y2="95%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="55%" stopColor={color} stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.24" />
          </linearGradient>
        </defs>
        <g>
          {key === "lightning" && (
            <polygon
              points="52,2 40,18 49,18 44,30 62,14 52,14"
              fill="#fde047"
              stroke="#18181b"
              strokeWidth="1.8"
            />
          )}
          {renderBodyShape()}
          <g pointerEvents="none" opacity="0.72">
            {renderBodyShape(`url(#crt-${uid})`)}
          </g>
          {renderTopAccessory(accId, color)}
          <AvatarFaceRig
            expression={expression}
            talkPhase={talkPhase}
            blink={blink}
            gazeX={gazeX}
            gazeY={gazeY}
            cx={50}
            cy={52}
            scale={key === "shield" ? 0.84 : 0.94}
            lidColor="rgba(0,0,0,0.32)"
          />
          {overlayKind && (
            <AvatarGlassesOverlay
              variant={overlayKind}
              cx={50}
              cy={52}
              scale={key === "shield" ? 0.86 : 0.96}
            />
          )}
        </g>
        <AvatarFxLayer expression={expression} size={size} />
      </svg>
    );
  }

  // ==============================
  // 3. ROBOZINHOS LED (20 modelos de chassis com neon + equalizador ao falar)
  // ==============================
  if (style === "robots") {
    const isLightChassis =
      variant === "bot_capsule" || variant === "bot_astro" || variant === "bot_halo";
    const bodyFill = isLightChassis ? "#e2e8f0" : variant === "bot_retro_tv" ? "#57534e" : "#1e293b";
    const strokeCol = isLightChassis ? "#475569" : "rgba(255,255,255,0.28)";
    const rxOuter =
      variant === "bot_drone"
        ? 40
        : variant === "bot_capsule" || variant === "bot_astro"
          ? 30
          : variant === "bot_cube"
            ? 12
            : 21;

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
          {/* Orelhas / módulos laterais */}
          {variant === "bot_headphones" ? (
            <>
              <path d="M 11 47 Q 14 14 50 14 Q 86 14 89 47" fill="none" stroke={color} strokeWidth="4.6" />
              <rect x="6" y="42" width="11" height="27" rx="5" fill={color} stroke="#0f172a" strokeWidth="1.8" />
              <rect x="83" y="42" width="11" height="27" rx="5" fill={color} stroke="#0f172a" strokeWidth="1.8" />
            </>
          ) : variant === "bot_cat" ? (
            <>
              <polygon points="18,32 21,9 41,23" fill={bodyFill} stroke={strokeCol} strokeWidth="2.2" />
              <polygon points="82,32 79,9 59,23" fill={bodyFill} stroke={strokeCol} strokeWidth="2.2" />
            </>
          ) : variant === "bot_bunny" ? (
            <>
              <rect x="26" y="4" width="12" height="24" rx="6" fill={bodyFill} stroke={strokeCol} strokeWidth="2" />
              <rect x="62" y="4" width="12" height="24" rx="6" fill={bodyFill} stroke={strokeCol} strokeWidth="2" />
            </>
          ) : (
            <>
              <rect x="7" y="44" width="9" height="22" rx="4" fill={color} opacity="0.85" />
              <rect x="84" y="44" width="9" height="22" rx="4" fill={color} opacity="0.85" />
            </>
          )}

          {/* Topo / Antena / Acessório de Robô */}
          {variant === "bot_visor" ? (
            <rect x="30" y="18" width="40" height="4" rx="2" fill={color} />
          ) : variant === "bot_dual_ant" ? (
            <>
              <line x1="33" y1="22" x2="27" y2="8" stroke="#94a3b8" strokeWidth="3.2" strokeLinecap="round" />
              <circle cx="27" cy="8" r="4.5" fill={color} />
              <line x1="67" y1="22" x2="73" y2="8" stroke="#94a3b8" strokeWidth="3.2" strokeLinecap="round" />
              <circle cx="73" cy="8" r="4.5" fill={color} />
            </>
          ) : variant === "bot_retro_tv" ? (
            <>
              <line x1="46" y1="22" x2="32" y2="5" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
              <circle cx="32" cy="5" r="3" fill={color} />
              <line x1="54" y1="22" x2="68" y2="5" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
              <circle cx="68" cy="5" r="3" fill={color} />
            </>
          ) : variant === "bot_mech" ? (
            <path
              d="M 36 22 L 50 7 L 64 22 Z"
              fill={color}
              stroke="#0f172a"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          ) : variant === "bot_crown" ? (
            <path
              d="M 33 21 L 37 7 L 44 15 L 50 5 L 56 15 L 63 7 L 67 21 Z"
              fill="#facc15"
              stroke="#78350f"
              strokeWidth="1.8"
            />
          ) : variant === "bot_halo" ? (
            <ellipse cx="50" cy="11" rx="22" ry="5" fill="none" stroke={color} strokeWidth="3.2" />
          ) : variant === "bot_radar" ? (
            <>
              <line x1="50" y1="22" x2="50" y2="12" stroke="#94a3b8" strokeWidth="3" />
              <path d="M 34 8 Q 50 18 66 8" fill="none" stroke={color} strokeWidth="3.6" strokeLinecap="round" />
              <circle cx="50" cy="7" r="3.5" fill="#fde047" />
            </>
          ) : variant !== "bot_cat" && variant !== "bot_bunny" ? (
            <>
              <line x1="50" y1="22" x2="50" y2="9" stroke="#94a3b8" strokeWidth="3.5" strokeLinecap="round" />
              <circle
                cx="50"
                cy="8"
                r={isWorking ? 6 : 5}
                fill={color}
                stroke="#ffffff"
                strokeWidth="1.3"
              />
            </>
          ) : null}

          {/* Chassi */}
          {variant === "bot_crt" && (
            <>
              <rect x="42" y="84" width="16" height="6" rx="2" fill="#475569" />
              <rect x="31" y="89" width="38" height="5" rx="2.5" fill="#334155" />
            </>
          )}
          {variant === "bot_hex" ? (
            <path d={CLASSIC_SHAPE_PATHS.hex} fill={bodyFill} stroke={strokeCol} strokeWidth="2.4" />
          ) : variant === "bot_shield" ? (
            <path
              d="M 17 20 L 83 20 L 83 56 C 83 77 50 90 50 90 C 50 90 17 77 17 56 Z"
              fill={bodyFill}
              stroke={strokeCol}
              strokeWidth="2.4"
            />
          ) : (
            <rect
              x="14"
              y="22"
              width="72"
              height="62"
              rx={rxOuter}
              fill={bodyFill}
              stroke={strokeCol}
              strokeWidth="2.4"
            />
          )}

          {/* Visor interno escuro */}
          <rect
            x="21"
            y="31"
            width={variant === "bot_retro_tv" ? 49 : 58}
            height="43"
            rx={variant === "bot_cyclops" ? 21 : 14}
            fill="#090d16"
            stroke={color}
            strokeOpacity="0.6"
            strokeWidth="2"
          />

          {/* Detalhes extras por modelo de robô */}
          {variant === "bot_crt" && (
            <>
              <circle cx="67" cy="79" r="2.2" fill="#22c55e" />
              <circle cx="74" cy="79" r="2.2" fill={color} />
            </>
          )}
          {variant === "bot_retro_tv" && (
            <>
              <circle cx="77" cy="43" r="4" fill="#d6d3d1" stroke="#18181b" strokeWidth="1.4" />
              <circle cx="77" cy="56" r="4" fill="#d6d3d1" stroke="#18181b" strokeWidth="1.4" />
            </>
          )}
          {variant === "bot_astro" && (
            <circle cx="50" cy="53" r="41" fill="none" stroke={color} strokeWidth="3" strokeOpacity="0.55" />
          )}
          {variant === "bot_ninja" && (
            <path d="M 15 26 L 85 26 L 85 33 L 15 33 Z" fill={color} opacity="0.85" />
          )}

          <AvatarFaceRig
            expression={expression}
            talkPhase={talkPhase}
            blink={blink}
            gazeX={gazeX}
            gazeY={gazeY}
            cx={50}
            cy={52}
            scale={0.62}
            lineColor={color}
            eyeWhite={color}
            pupilColor="#090d16"
            lidColor="#1e293b"
            isRobot
            eyeMode={variant === "bot_cyclops" ? "cyclops" : "duo"}
          />
          {expression === "cool" && (
            <AvatarGlassesOverlay variant="cool" cx={50} cy={52} scale={0.64} />
          )}
        </g>
        <AvatarFxLayer expression={expression} size={size} />
      </svg>
    );
  }

  // ==============================
  // 4. PERSONAGENS (20 arquétipos ilustrados inspirados na referência 2 + óculos por cima!)
  // ==============================
  return null;
}
