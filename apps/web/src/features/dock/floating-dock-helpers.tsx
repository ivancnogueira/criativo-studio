import React from "react";
import type {
  AgenteRegistro,
  MensagemChat,
} from "@criativo/contracts";

export function renderCompactLine(line: string, keyPrefix: string): React.ReactNode {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${idx}`} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-${idx}`}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-[#E5E5EA]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${idx}`}>{part}</React.Fragment>;
  });
}

export function CompactDockMarkdown({ text }: { text: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="space-y-1 break-words">
      {lines.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) return <div key={`sp-${i}`} className="h-1" />;
        const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
        if (heading) {
          return (
            <p key={`h-${i}`} className="font-semibold text-white">
              {renderCompactLine(heading[1]!, `h-${i}`)}
            </p>
          );
        }
        const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <p key={`li-${i}`} className="pl-2 flex gap-1.5">
              <span className="text-[#8E8E93]">•</span>
              <span>{renderCompactLine(bullet[1]!, `li-${i}`)}</span>
            </p>
          );
        }
        return <p key={`p-${i}`}>{renderCompactLine(raw, `p-${i}`)}</p>;
      })}
    </div>
  );
}

export interface FloatingDesktopDockProps {
  initialAgentes?: AgenteRegistro[];
  initialMessagesByAgent?: Record<string, MensagemChat[]>;
  initialSelectedAgentId?: string | null;
  initialPinned?: boolean;
  initialPeeked?: boolean;
  initialSide?: "left" | "right";
}

