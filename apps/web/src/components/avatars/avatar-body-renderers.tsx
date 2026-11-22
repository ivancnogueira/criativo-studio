import React, { useId } from "react";
import { CLASSIC_SHAPE_PATHS } from "./avatar-catalog";
import {
  AvatarFaceRig,
  AvatarFxLayer,
  AvatarGlassesOverlay,
} from "./avatar-face-rig";
import {
  PhotoAvatarRenderer,
  type ExpressiveBodyRenderProps,
  type PhotoAvatarRendererProps,
} from "./avatar-accessories-and-photo";
import { renderClassicExpressiveStyles } from "./avatar-classic-styles";
import { renderPersonasAndPetsStyles } from "./avatar-personas-styles";

export {
  PhotoAvatarRenderer,
  type ExpressiveBodyRenderProps,
  type PhotoAvatarRendererProps,
};

export const ExpressiveSvgAvatar: React.FC<ExpressiveBodyRenderProps> = (props) => {
  const {
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
  } = props;
  const uid = useId().replace(/:/g, "");

  const classicNode = renderClassicExpressiveStyles({ ...props, uid });
  if (classicNode) return classicNode as React.ReactElement;

  const personasNode = renderPersonasAndPetsStyles({ ...props, uid });
  if (personasNode) return personasNode as React.ReactElement;

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
