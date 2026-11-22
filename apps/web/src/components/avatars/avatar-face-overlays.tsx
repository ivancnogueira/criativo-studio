import React from "react";
import type {
  AvatarExpression,
} from "./avatar-types";

export interface AvatarGlassesOverlayProps {
  variant: "shades" | "glasses" | "visor" | "cool";
  cx?: number;
  cy?: number;
  scale?: number;
  frameColor?: string;
}

/**
 * Óculos e viseiras SEMPRE montados DEPOIS do <AvatarFaceRig /> para ficar na camada frontal sobre os olhos.
 */
export const AvatarGlassesOverlay: React.FC<AvatarGlassesOverlayProps> = ({
  variant,
  cx = 50,
  cy = 52,
  scale = 1,
  frameColor = "#18181b",
}) => {
  return (
    <g data-layer="avatar-glasses" transform={`translate(${cx},${cy}) scale(${scale})`}>
      {(variant === "shades" || variant === "cool") && (
        <g>
          <path
            d="M -32 -15 L 32 -15 L 30 -8 L 24 4 Q 12 8 3 0 L 0 -6 L -3 0 Q -12 8 -24 4 L -30 -8 Z"
            fill={frameColor}
            stroke="#09090b"
            strokeWidth="2.2"
          />
          <path d="M -27 -12 L -5 -12 L -7 -2 Q -16 3 -24 0 Z" fill="#09090b" />
          <path d="M 5 -12 L 27 -12 L 24 0 Q 16 3 7 -2 Z" fill="#09090b" />
          <path d="M -23 -11 L -16 -11 L -20 1 L -25 -1 Z" fill="#ffffff" opacity="0.52" />
          <path d="M 9 -11 L 16 -11 L 12 1 L 7 -1 Z" fill="#ffffff" opacity="0.52" />
        </g>
      )}

      {variant === "glasses" && (
        <g>
          <rect x="-29" y="-17" width="24" height="19" rx="6" fill="rgba(255,255,255,0.14)" stroke={frameColor} strokeWidth="3.2" />
          <rect x="5" y="-17" width="24" height="19" rx="6" fill="rgba(255,255,255,0.14)" stroke={frameColor} strokeWidth="3.2" />
          <line x1="-5" y1="-9" x2="5" y2="-9" stroke={frameColor} strokeWidth="3" />
          <path d="M -24 -13 L -17 -13 L -22 -4 L -26 -4 Z" fill="#ffffff" opacity="0.35" />
          <path d="M 10 -13 L 17 -13 L 12 -4 L 8 -4 Z" fill="#ffffff" opacity="0.35" />
        </g>
      )}

      {variant === "visor" && (
        <g>
          <rect x="-33" y="-16" width="66" height="18" rx="9" fill="#06b6d4" fillOpacity="0.45" stroke="#0891b2" strokeWidth="2.6" />
          <line x1="-26" y1="-11" x2="10" y2="-11" stroke="#ecfeff" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
        </g>
      )}
    </g>
  );
};

export const AvatarFxLayer: React.FC<{ expression: AvatarExpression; size?: number }> = ({
  expression,
  size = 40,
}) => {
  if (size < 20) return null;
  if (expression === "sleep") {
    return (
      <g data-layer="avatar-fx">
        <text x="72" y="25" fontSize="14" fontWeight="900" fill="#facc15" stroke="#18181b" strokeWidth="0.9">
          zZZ
        </text>
      </g>
    );
  }
  if (expression === "shock" || expression === "cry") {
    return (
      <g data-layer="avatar-fx">
        <circle cx="82" cy="18" r="10" fill="#ef4444" stroke="#ffffff" strokeWidth="1.6" />
        <text x="82" y="23" textAnchor="middle" fontSize="15" fontWeight="900" fill="#ffffff">
          !
        </text>
      </g>
    );
  }
  if (expression === "dizzy") {
    return (
      <g data-layer="avatar-fx">
        <text x="81" y="26" textAnchor="middle" fontSize="20" fontWeight="900" fill="#f59e0b" stroke="#18181b" strokeWidth="0.9">
          ?
        </text>
      </g>
    );
  }
  if (expression === "love" || expression === "wow") {
    return (
      <g data-layer="avatar-fx">
        <path
          d="M 15 15 L 17 20 L 22 22 L 17 24 L 15 29 L 13 24 L 8 22 L 13 20 Z"
          fill="#fde047"
          stroke="#18181b"
          strokeWidth="0.8"
        />
        <path
          d="M 84 12 L 85.8 17 L 91 18.8 L 85.8 20.6 L 84 25.6 L 82.2 20.6 L 77 18.8 L 82.2 17 Z"
          fill="#fde047"
          stroke="#18181b"
          strokeWidth="0.8"
        />
      </g>
    );
  }
  return null;
};

