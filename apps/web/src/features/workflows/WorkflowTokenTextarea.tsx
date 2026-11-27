import React, { useMemo, useRef, useState } from "react";
import type { WorkflowAresta, WorkflowNo } from "@criativo/contracts";
import { Braces } from "lucide-react";
import {
  collectAvailableNodeTokens,
  type AvailableWorkflowToken,
} from "./workflow-variable-catalog";

interface PopoverTriggerState {
  startIdx: number;
  caretIdx: number;
  query: string;
}

const TOKEN_MATCH_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function WorkflowTokenTextarea({
  nodeId,
  value,
  onChange,
  allNodes = [],
  allEdges = [],
  readOnly = false,
  rows = 3,
  placeholder,
  className,
}: {
  nodeId: string;
  value: string;
  onChange: (nextVal: string) => void;
  allNodes?: WorkflowNo[];
  allEdges?: WorkflowAresta[];
  readOnly?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [trigger, setTrigger] = useState<PopoverTriggerState | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const availableTokens = useMemo(
    () => collectAvailableNodeTokens(nodeId, allNodes, allEdges),
    [nodeId, allNodes, allEdges]
  );

  const tokenMetaMap = useMemo(() => {
    const map = new Map<string, AvailableWorkflowToken>();
    for (const item of availableTokens) {
      map.set(item.token, item);
    }
    return map;
  }, [availableTokens]);

  const usedTokens = useMemo(() => {
    const found: string[] = [];
    const seen = new Set<string>();
    for (const m of value.matchAll(TOKEN_MATCH_RE)) {
      const tok = m[1]?.trim();
      if (tok && !seen.has(tok)) {
        seen.add(tok);
        found.push(tok);
      }
    }
    return found;
  }, [value]);

  const filteredSuggestions = useMemo(() => {
    if (!trigger) return availableTokens;
    const q = trigger.query.trim().toLowerCase();
    if (!q) return availableTokens;
    return availableTokens.filter(
      (t) =>
        t.token.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.sourceTitle.toLowerCase().includes(q)
    );
  }, [availableTokens, trigger]);

  const detectTriggerAtCaret = (nextVal: string, caret: number | null) => {
    if (readOnly || caret === null) {
      setTrigger(null);
      return;
    }
    const before = nextVal.slice(0, caret);
    const match = before.match(/(\{\{|\{)([a-zA-Z0-9_.-]*)$/);
    if (match && match.index !== undefined) {
      setTrigger({
        startIdx: match.index,
        caretIdx: caret,
        query: match[2] ?? "",
      });
      setManualOpen(false);
    } else {
      setTrigger(null);
    }
  };

  const insertToken = (item: AvailableWorkflowToken) => {
    if (readOnly) return;
    if (trigger) {
      const before = value.slice(0, trigger.startIdx);
      const after = value.slice(trigger.caretIdx);
      const next = `${before}${item.insertText}${after}`;
      onChange(next);
      setTrigger(null);
      setManualOpen(false);
      requestAnimationFrame(() => {
        const pos = before.length + item.insertText.length;
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(pos, pos);
      });
      return;
    }

    const el = textareaRef.current;
    const pos = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, pos)}${item.insertText}${value.slice(pos)}`;
    onChange(next);
    setManualOpen(false);
    requestAnimationFrame(() => {
      const nextPos = pos + item.insertText.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextPos, nextPos);
    });
  };

  const popoverVisible = !readOnly && (Boolean(trigger) || manualOpen);

  return (
    <div className="relative space-y-1.5">
      <textarea
        ref={textareaRef}
        readOnly={readOnly}
        rows={rows}
        value={value}
        placeholder={placeholder}
        className={
          className ??
          "w-full resize-none rounded-lg border border-white/[0.06] bg-[#242424] p-2 text-[13px] text-[#DCDCDC] placeholder:text-[#6A6A6A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        }
        onChange={(e) => {
          onChange(e.target.value);
          detectTriggerAtCaret(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => detectTriggerAtCaret(value, (e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => {
          if (popoverVisible && e.key === "Escape") {
            e.preventDefault();
            setTrigger(null);
            setManualOpen(false);
            return;
          }
          if (popoverVisible && (e.key === "Enter" || e.key === "Tab") && filteredSuggestions[0]) {
            e.preventDefault();
            insertToken(filteredSuggestions[0]);
          }
        }}
      />

      {popoverVisible && filteredSuggestions.length > 0 && (
        <div
          data-testid="workflow-token-autocomplete"
          className="absolute left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-xl border border-white/[0.14] bg-[#181818] p-1 shadow-2xl"
        >
          {filteredSuggestions.map((item) => (
            <button
              key={item.token}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertToken(item);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] hover:bg-[#2A2A2A]"
            >
              <span className="truncate font-mono text-[#31CF76]">{item.insertText}</span>
              <span className="truncate text-[#979797]">
                {item.sourceTitle} · {item.type}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {usedTokens.map((tok) => {
            const meta = tokenMetaMap.get(tok);
            return (
              <span
                key={tok}
                title={meta ? `${meta.label} (${meta.type})` : "Campo não encontrado nos predecessores"}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  meta
                    ? "border border-[#31CF76]/35 bg-[#31CF76]/15 text-[#31CF76]"
                    : "border border-[#F59E0B]/35 bg-[#F59E0B]/15 text-[#F59E0B]"
                }`}
              >
                <span>{`{{${tok}}}`}</span>
                {meta && <span className="opacity-75">· {meta.type}</span>}
              </span>
            );
          })}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              setTrigger(null);
              setManualOpen((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded bg-[#1E1E1E] px-1.5 py-0.5 text-[11px] text-[#42A0FF] hover:bg-[#2A2A2A]"
          >
            <Braces className="h-3 w-3" />
            <span>Inserir {"{{campo}}"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
