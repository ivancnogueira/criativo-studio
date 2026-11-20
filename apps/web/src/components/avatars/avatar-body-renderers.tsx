import React, { useEffect, useId, useState } from "react";
import type { AvatarShape, AvatarStyle } from "@criativo/contracts";
import { resolveActiveServerUrl } from "../../services/websocket-client";
import { CLASSIC_SHAPE_PATHS } from "./avatar-catalog";
import {
  AvatarFaceRig,
  AvatarFxLayer,
  AvatarGlassesOverlay,
} from "./avatar-face-rig";
import type { AvatarExpression, AvatarTaskContext } from "./avatar-types";

export interface ExpressiveBodyRenderProps {
  style: Exclude<AvatarStyle, "classic" | "image">;
  variant: string;
  color: string;
  size: number;
  expression: AvatarExpression;
  talkPhase: number;
  blink: boolean;
  gazeX: number;
  gazeY: number;
  isWorking?: boolean;
  label?: string;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

/**
 * Acessórios reutilizáveis entre Plush+ e Carinhas Cartoon (sempre desenhados na camada certa).
 */
function renderTopAccessory(kind: string, accentColor: string): React.ReactNode {
  switch (kind) {
    case "crown":
      return (
        <path
          d="M 33 17 L 37 4 L 44 12 L 50 2 L 56 12 L 63 4 L 67 17 Z"
          fill="#facc15"
          stroke="#78350f"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      );
    case "cap":
      return (
        <g>
          <path d="M 21 28 Q 50 7 79 28 Z" fill="#1d4ed8" stroke="#0f172a" strokeWidth="2.2" />
          <path d="M 20 28 Q 52 24 89 31 Q 62 34 20 28 Z" fill="#2563eb" stroke="#0f172a" strokeWidth="2" />
        </g>
      );
    case "beanie":
      return (
        <g>
          <circle cx="50" cy="6" r="5.5" fill="#f43f5e" stroke="#18181b" strokeWidth="1.8" />
          <path d="M 21 29 Q 50 7 79 29 Z" fill="#e11d48" stroke="#18181b" strokeWidth="2" />
          <rect x="19" y="24" width="62" height="8" rx="4" fill="#fb7185" stroke="#18181b" strokeWidth="1.8" />
        </g>
      );
    case "halo":
      return (
        <ellipse
          cx="50"
          cy="10"
          rx="22"
          ry="5.5"
          fill="none"
          stroke="#fde047"
          strokeWidth="3.5"
        />
      );
    case "bow":
      return (
        <g>
          <path d="M 50 15 L 33 7 Q 31 18 39 20 Z" fill="#ec4899" stroke="#18181b" strokeWidth="1.8" />
          <path d="M 50 15 L 67 7 Q 69 18 61 20 Z" fill="#ec4899" stroke="#18181b" strokeWidth="1.8" />
          <circle cx="50" cy="15" r="4" fill="#f9a8d4" stroke="#18181b" strokeWidth="1.6" />
        </g>
      );
    case "horns":
      return (
        <g>
          <path d="M 27 23 Q 20 7 33 10 Q 35 17 36 20 Z" fill="#fef08a" stroke="#18181b" strokeWidth="2" />
          <path d="M 73 23 Q 80 7 67 10 Q 65 17 64 20 Z" fill="#fef08a" stroke="#18181b" strokeWidth="2" />
        </g>
      );
    case "antenna":
      return (
        <g>
          <line x1="50" y1="16" x2="50" y2="5" stroke="#334155" strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="50" cy="5" r="5" fill="#fde047" stroke="#18181b" strokeWidth="1.8" />
        </g>
      );
    case "beret":
      return (
        <g>
          <line x1="52" y1="11" x2="55" y2="6" stroke="#18181b" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="50" cy="19" rx="28" ry="10" transform="rotate(-10 50 19)" fill="#f43f5e" stroke="#18181b" strokeWidth="2" />
        </g>
      );
    case "wizard":
      return (
        <g>
          <path d="M 16 28 L 84 28 Q 50 22 16 28 Z" fill="#4c1d95" stroke="#18181b" strokeWidth="2" />
          <path d="M 29 26 L 52 2 L 69 26 Z" fill="#6d28d9" stroke="#18181b" strokeWidth="2" strokeLinejoin="round" />
          <path d="M 48 14 L 50 18 L 54 19 L 50 20 L 48 24 L 46 20 L 42 19 L 46 18 Z" fill="#fde047" />
        </g>
      );
    case "leaf":
      return (
        <g>
          <path d="M 50 15 Q 50 6 58 4" fill="none" stroke="#15803d" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M 50 11 Q 66 2 67 12 Q 58 17 50 11 Z" fill="#4ade80" stroke="#14532d" strokeWidth="1.8" />
        </g>
      );
    case "chef":
      return (
        <g>
          <path
            d="M 27 25 C 18 14 28 3 40 9 C 45 2 55 2 60 9 C 72 3 82 14 73 25 Z"
            fill="#f8fafc"
            stroke="#18181b"
            strokeWidth="2"
          />
          <rect x="27" y="21" width="46" height="6" rx="2" fill="#e2e8f0" stroke="#18181b" strokeWidth="1.6" />
        </g>
      );
    case "tophat":
      return (
        <g>
          <line x1="20" y1="24" x2="80" y2="24" stroke="#18181b" strokeWidth="3.6" strokeLinecap="round" />
          <rect x="30" y="5" width="40" height="19" rx="3" fill="#27272a" stroke="#18181b" strokeWidth="2.2" />
          <rect x="30" y="18" width="40" height="4" fill={accentColor} />
        </g>
      );
    case "headphones":
      return (
        <g>
          <path d="M 13 49 Q 13 11 50 11 Q 87 11 87 49" fill="none" stroke="#18181b" strokeWidth="5.2" strokeLinecap="round" />
          <rect x="5" y="40" width="11" height="24" rx="5" fill="#facc15" stroke="#18181b" strokeWidth="2" />
          <rect x="84" y="40" width="11" height="24" rx="5" fill="#facc15" stroke="#18181b" strokeWidth="2" />
        </g>
      );
    case "bandana":
      return (
        <g>
          <path d="M 17 27 Q 50 20 83 27 L 83 34 Q 50 28 17 34 Z" fill="#dc2626" stroke="#18181b" strokeWidth="1.8" />
          <path d="M 80 28 L 93 23 L 90 32 Z" fill="#dc2626" stroke="#18181b" strokeWidth="1.6" />
        </g>
      );
    case "ears":
      return (
        <g>
          <path d="M 18 33 L 15 11 L 36 22 Z" fill={accentColor} stroke="#18181b" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M 82 33 L 85 11 L 64 22 Z" fill={accentColor} stroke="#18181b" strokeWidth="2.2" strokeLinejoin="round" />
        </g>
      );
    default:
      return null;
  }
}

export const ExpressiveSvgAvatar: React.FC<ExpressiveBodyRenderProps> = ({
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
}) => {
  const uid = useId().replace(/:/g, "");

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

  // ==============================
  // 6. MONSTRINHOS (20 criaturas únicas)
  // ==============================
  const key = variant.replace(/^mon_/, "");
  const eyeMode: "duo" | "cyclops" | "tri" =
    key === "cyclops" ? "cyclops" : key === "tri_eye" ? "tri" : "duo";

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
        {/* Adornos de fundo/topo por criatura */}
        {(key === "horned" || key === "imp" || key === "yeti") && (
          <>
            <path
              d="M 24 28 Q 18 10 31 12 Q 33 20 35 23 Z"
              fill={key === "imp" ? "#dc2626" : "#fef08a"}
              stroke="#18181b"
              strokeWidth="2.2"
            />
            <path
              d="M 76 28 Q 82 10 69 12 Q 67 20 65 23 Z"
              fill={key === "imp" ? "#dc2626" : "#fef08a"}
              stroke="#18181b"
              strokeWidth="2.2"
            />
          </>
        )}
        {key === "yeti" && (
          <path d="M 34 18 L 41 7 L 50 15 L 59 7 L 66 18 Z" fill="#f1f5f9" stroke="#18181b" strokeWidth="1.8" />
        )}
        {key === "alien" && (
          <>
            <line x1="36" y1="22" x2="29" y2="8" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
            <circle cx="28" cy="7" r="4.5" fill="#fde047" stroke="#18181b" strokeWidth="1.6" />
            <line x1="64" y1="22" x2="71" y2="8" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
            <circle cx="72" cy="7" r="4.5" fill="#fde047" stroke="#18181b" strokeWidth="1.6" />
          </>
        )}
        {key === "bat" && (
          <>
            <path d="M 16 40 Q 2 22 9 14 Q 20 22 25 32 Z" fill="#18181b" />
            <path d="M 84 40 Q 98 22 91 14 Q 80 22 75 32 Z" fill="#18181b" />
          </>
        )}
        {key === "shark" && (
          <path d="M 44 17 L 54 3 L 61 18 Z" fill={color} stroke="#18181b" strokeWidth="2.2" strokeLinejoin="round" />
        )}
        {key === "pumpkin" && (
          <path d="M 46 17 L 48 6 L 56 8 L 53 17 Z" fill="#16a34a" stroke="#18181b" strokeWidth="2" />
        )}
        {key === "dino" && (
          <path d="M 35 17 L 41 6 L 47 16 L 53 6 L 59 16 L 65 7 L 69 19 Z" fill="#facc15" stroke="#18181b" strokeWidth="1.8" />
        )}

        {/* Corpo da criatura */}
        {key === "ghost" ? (
          <path
            d="M 16 52 C 16 24 31 12 50 12 C 69 12 84 24 84 52 L 84 86 L 73 78 L 62 86 L 50 78 L 38 86 L 27 78 L 16 86 Z"
            fill={color}
            stroke="#18181b"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
        ) : key === "storm" ? (
          <path d={CLASSIC_SHAPE_PATHS.cloud} fill={color} stroke="#18181b" strokeWidth="2.6" />
        ) : key === "starfish" ? (
          <path d={CLASSIC_SHAPE_PATHS.octo} fill={color} stroke="#18181b" strokeWidth="2.6" strokeLinejoin="round" />
        ) : key === "crystal" ? (
          <path d={CLASSIC_SHAPE_PATHS.hex} fill={color} stroke="#18181b" strokeWidth="2.6" />
        ) : key === "mushroom" ? (
          <>
            <path d="M 12 52 C 12 18 88 18 88 52 Z" fill="#ef4444" stroke="#18181b" strokeWidth="2.5" />
            <circle cx="30" cy="34" r="6" fill="#fef2f2" />
            <circle cx="70" cy="34" r="5" fill="#fef2f2" />
            <rect x="24" y="45" width="52" height="42" rx="18" fill={color} stroke="#18181b" strokeWidth="2.5" />
          </>
        ) : key === "jelly" || key === "tentacle" ? (
          <>
            <path d="M 24 72 L 20 90 M 40 76 L 38 92 M 60 76 L 62 92 M 76 72 L 80 90" stroke={color} strokeWidth="5.5" strokeLinecap="round" />
            <path
              d="M 50 15 C 76 15 88 32 88 55 C 88 73 74 82 50 82 C 26 82 12 73 12 55 C 12 32 24 15 50 15 Z"
              fill={color}
              stroke="#18181b"
              strokeWidth="2.6"
            />
          </>
        ) : (
          <path
            d="M 50 15 C 76 15 88 32 88 55 C 88 78 74 89 50 89 C 26 89 12 78 12 55 C 12 32 24 15 50 15 Z"
            fill={color}
            stroke="#18181b"
            strokeWidth="2.6"
          />
        )}

        {key === "cactus" && (
          <>
            <circle cx="50" cy="14" r="7" fill="#f43f5e" stroke="#18181b" strokeWidth="1.8" />
            <line x1="17" y1="45" x2="10" y2="42" stroke="#18181b" strokeWidth="2" strokeLinecap="round" />
            <line x1="83" y1="45" x2="90" y2="42" stroke="#18181b" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {key === "berry" && (
          <path d="M 31 19 L 41 11 L 50 18 L 59 11 L 69 19 L 50 23 Z" fill="#22c55e" stroke="#14532d" strokeWidth="1.8" />
        )}
        {key === "slime" && (
          <ellipse cx="33" cy="29" rx="10" ry="5" transform="rotate(-25 33 29)" fill="#ffffff" opacity="0.45" />
        )}
        {key === "storm" && (
          <polygon
            points="52,79 44,91 51,91 47,99 61,86 54,86"
            fill="#fde047"
            stroke="#18181b"
            strokeWidth="1.6"
          />
        )}

        <AvatarFaceRig
          expression={expression}
          talkPhase={talkPhase}
          blink={blink}
          gazeX={gazeX}
          gazeY={gazeY}
          cx={50}
          cy={key === "mushroom" ? 63 : 56}
          scale={key === "tri_eye" ? 0.72 : 0.8}
          lidColor="rgba(0,0,0,0.3)"
          eyeMode={eyeMode}
        />

        {expression === "cool" && eyeMode !== "cyclops" && (
          <AvatarGlassesOverlay
            variant="cool"
            cx={50}
            cy={key === "mushroom" ? 63 : 56}
            scale={0.8}
          />
        )}
      </g>
      <AvatarFxLayer expression={expression} size={size} />
    </svg>
  );
};

export interface PhotoAvatarRendererProps {
  imageUrl?: string | null;
  color: string;
  size: number;
  taskContext: AvatarTaskContext;
  isWorking: boolean;
  label?: string;
  className?: string;
  fallbackNode: React.ReactNode;
}

/**
 * Renderizador circular para foto enviada pelo usuário ou gerada por IA com anel de status.
 */
export const PhotoAvatarRenderer: React.FC<PhotoAvatarRendererProps> = ({
  imageUrl,
  color,
  size,
  taskContext,
  isWorking,
  label = "Avatar do agente",
  className = "",
  fallbackNode,
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  if (!imageUrl || imgError) {
    return <>{fallbackNode}</>;
  }

  const resolvedUrl = resolveActiveServerUrl(imageUrl);
  const ringColor =
    taskContext === "error"
      ? "#ef4444"
      : taskContext === "approval"
        ? "#f59e0b"
        : taskContext === "completed"
          ? "#31CF76"
          : isWorking
            ? color
            : "rgba(255,255,255,0.22)";

  const showBadge = size >= 28 && (isWorking || taskContext === "error" || taskContext === "approval" || taskContext === "completed");
  const badgeBg =
    taskContext === "error"
      ? "#ef4444"
      : taskContext === "approval"
        ? "#f59e0b"
        : taskContext === "completed"
          ? "#31CF76"
          : color;
  const badgeSymbol =
    taskContext === "error"
      ? "!"
      : taskContext === "approval"
        ? "?"
        : taskContext === "ads"
          ? "$"
          : "";

  return (
    <div
      style={{
        width: size,
        height: size,
        borderColor: ringColor,
        boxShadow: isWorking ? `0 0 0 2px ${ringColor}33` : undefined,
      }}
      className={`relative shrink-0 rounded-full border-2 overflow-visible select-none transition-all ${
        isWorking ? "animate-pulse" : ""
      } ${className}`}
      role="img"
      aria-label={label}
    >
      <img
        src={resolvedUrl}
        alt={label}
        onError={() => setImgError(true)}
        className="h-full w-full rounded-full object-cover bg-[#141414]"
      />
      {showBadge && (
        <span
          style={{ backgroundColor: badgeBg }}
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#141414] text-[9px] font-black text-white shadow"
        >
          {badgeSymbol}
        </span>
      )}
    </div>
  );
};
