import React, { useEffect, useState } from "react";
import type { AvatarStyle } from "@criativo/contracts";
import { resolveActiveServerUrl } from "../../services/websocket-client";
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
export function renderTopAccessory(kind: string, accentColor: string): React.ReactNode {
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
