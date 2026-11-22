import React from "react";
import { Check, Copy, Download } from "lucide-react";
import {
  splitMarkdownIntoBubbleChunks,
  type BubbleColorPalette,
} from "./chat-bubble-theme";
import { CodePreview } from "./CodePreview";
import { MathFormula, MermaidDiagram } from "./MarkdownMathMermaidPreview";

export function formatElapsedClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m} min ${rem} s` : `${m} min`;
}

export interface ParsedBlock {
  type: "markdown" | "table" | "code";
  content: string;
  headers?: string[];
  rows?: string[][];
  language?: string;
}

export function splitMarkdownBlocks(text: string): ParsedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  let textAcc: string[] = [];
  let i = 0;

  const flushText = () => {
    const trimmed = textAcc.join("\n").trim();
    if (trimmed) {
      blocks.push({ type: "markdown", content: trimmed });
    }
    textAcc = [];
  };

  while (i < lines.length) {
    const cur = lines[i];
    const trimmedCur = cur.trim();

    if (trimmedCur.startsWith("```")) {
      flushText();
      const lang = trimmedCur.slice(3).trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) {
        i += 1;
      }
      blocks.push({
        type: "code",
        language: lang || "texto",
        content: codeLines.join("\n"),
      });
      continue;
    }

    const next = lines[i + 1] ?? "";
    const isTableStart =
      trimmedCur.startsWith("|") &&
      next.trim().startsWith("|") &&
      /^\|[\s:|-]+\|?$/.test(next.trim());

    if (isTableStart) {
      flushText();
      const rawTable: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rawTable.push(lines[i].trim());
        i += 1;
      }
      const parseRow = (line: string) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseRow(rawTable[0] ?? "");
      const rows = rawTable.slice(2).map(parseRow);
      blocks.push({
        type: "table",
        content: rawTable.join("\n"),
        headers,
        rows,
      });
    } else {
      textAcc.push(cur);
      i += 1;
    }
  }
  flushText();
  return blocks;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const esc = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function renderInlineMarkdown(
  text: string,
  depth = 0,
  palette?: BubbleColorPalette
): React.ReactNode[] {
  const parts = text.split(
    /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|~~[^~]+?~~|\*[^*\s][^*]*?\*|(?<![A-Za-z0-9_])_[^_\s][^_]*?_(?![A-Za-z0-9_]))/g
  );
  const strongClass = palette?.isLightBg
    ? "font-semibold text-[#0D1117]"
    : "font-semibold text-white";
  const codeClass = palette
    ? `rounded border px-1.5 py-0.5 font-terminal text-[12px] ${palette.codeBgClass}`
    : "rounded bg-[#2A2A2A] border border-white/10 px-1.5 py-0.5 font-terminal text-[12px] text-[#74B9FF]";
  const linkClass = palette?.isLightBg
    ? "text-[#0B4F8A] underline underline-offset-2 font-medium"
    : "text-[#42A0FF] underline underline-offset-2 hover:text-[#74B9FF]";

  return parts.map((part, idx) => {
    if (
      ((part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))) &&
      part.length > 4
    ) {
      return (
        <strong key={idx} className={strongClass}>
          {depth < 3
            ? renderInlineMarkdown(part.slice(2, -2), depth + 1, palette)
            : part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={idx} className={codeClass}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
      const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (linkMatch) {
        return (
          <a
            key={idx}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {linkMatch[1]}
          </a>
        );
      }
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return (
        <del
          key={idx}
          className={`line-through ${palette?.isLightBg ? "text-[#0D1117]/60" : "text-[#888888]"}`}
        >
          {depth < 3
            ? renderInlineMarkdown(part.slice(2, -2), depth + 1, palette)
            : part.slice(2, -2)}
        </del>
      );
    }
    if (
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))) &&
      part.length > 2
    ) {
      return (
        <em
          key={idx}
          className={`italic ${palette?.isLightBg ? "text-[#0D1117]/85" : "text-[#B5B5B5]"}`}
        >
          {depth < 3
            ? renderInlineMarkdown(part.slice(1, -1), depth + 1, palette)
            : part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

export function renderFormattedMarkdownText(
  content: string,
  palette?: BubbleColorPalette
): React.ReactNode {
  const lines = content.split(/\r?\n/);
  const headingColor = palette?.isLightBg ? "text-[#0D1117]" : "text-white";
  const subHeadingColor = palette?.isLightBg ? "text-[#0D1117]/90" : "text-[#E8E8E8]";
  const markerColor = palette?.isLightBg ? "text-[#0D1117]/75" : "text-[#8E8E93]";
  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        // Fórmula matemática display $$...$$
        if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
          return (
            <div key={idx} className="my-2 overflow-x-auto">
              <MathFormula formula={trimmed.slice(2, -2).trim()} displayMode />
            </div>
          );
        }

        // Separador horizontal --- / *** / ___
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
          return (
            <hr
              key={idx}
              className={`border-0 border-t my-2.5 ${
                palette?.isLightBg ? "border-black/15" : "border-white/10"
              }`}
            />
          );
        }

        // Títulos Markdown (#, ##, ###, ####)
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const inner = renderInlineMarkdown(headingMatch[2], 0, palette);
          if (level === 1) {
            return (
              <h1 key={idx} className={`text-[17px] font-bold pt-1.5 leading-snug ${headingColor}`}>
                {inner}
              </h1>
            );
          }
          if (level === 2) {
            return (
              <h2 key={idx} className={`text-[15.5px] font-bold pt-1.5 leading-snug ${headingColor}`}>
                {inner}
              </h2>
            );
          }
          if (level === 3) {
            return (
              <h3 key={idx} className={`text-[14px] font-semibold pt-1 leading-snug ${headingColor}`}>
                {inner}
              </h3>
            );
          }
          return (
            <h4 key={idx} className={`text-[13px] font-semibold pt-0.5 leading-snug ${subHeadingColor}`}>
              {inner}
            </h4>
          );
        }

        if (trimmed.startsWith("> ")) {
          return (
            <blockquote
              key={idx}
              className={`border-l-2 pl-3 py-0.5 italic rounded-r-lg ${
                palette?.isLightBg
                  ? "border-[#0D1117]/40 text-[#0D1117]/90 bg-black/[0.06]"
                  : "border-[#42A0FF]/70 text-[#DCDCDC] bg-white/[0.04]"
              }`}
            >
              {renderInlineMarkdown(trimmed.slice(2), 0, palette)}
            </blockquote>
          );
        }

        // Lista numerada (1. item)
        const orderedMatch = line.match(/^(\s*)(\d+\.)\s+(.+)$/);
        if (orderedMatch) {
          const indentLevel = Math.min(2, Math.floor(orderedMatch[1].length / 2));
          return (
            <div
              key={idx}
              style={{ paddingLeft: `${indentLevel * 14 + 4}px` }}
              className="flex items-start gap-2"
            >
              <span className={`font-medium shrink-0 tabular-nums ${markerColor}`}>
                {orderedMatch[2]}
              </span>
              <span className="flex-1 min-w-0 break-words">
                {renderInlineMarkdown(orderedMatch[3], 0, palette)}
              </span>
            </div>
          );
        }

        // Lista com marcadores (- ou *) inclusive aninhada
        const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
        if (bulletMatch) {
          const indentLevel = Math.min(2, Math.floor(bulletMatch[1].length / 2));
          return (
            <div
              key={idx}
              style={{ paddingLeft: `${indentLevel * 14 + 4}px` }}
              className="flex items-start gap-2"
            >
              <span className={`mt-0.5 shrink-0 ${markerColor}`}>
                {indentLevel > 0 ? "◦" : "•"}
              </span>
              <span className="flex-1 min-w-0 break-words">
                {renderInlineMarkdown(bulletMatch[2], 0, palette)}
              </span>
            </div>
          );
        }

        return (
          <p key={idx} className="break-words leading-relaxed">
            {renderInlineMarkdown(line, 0, palette)}
          </p>
        );
      })}
    </div>
  );
}
