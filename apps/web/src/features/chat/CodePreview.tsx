import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, WrapText } from "lucide-react";

export interface CodePreviewProps {
  code: string;
  language?: string;
  fileName?: string;
  showLineNumbers?: boolean;
}

const WRAP_STORAGE_KEY = "criativo.codePreview.wrapLines";

export function detectCodeLanguage(fileName?: string, explicitLang?: string): string {
  if (explicitLang && explicitLang.trim()) return explicitLang.trim().toLowerCase();
  if (!fileName) return "txt";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "txt";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    json: "json",
    css: "css",
    html: "html",
    sql: "sql",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    sh: "shell",
    py: "python",
  };
  return map[ext] ?? ext;
}

/**
 * Visualizador seguro de codigo-fonte em bloco #101010 com numeracao de linhas,
 * alternancia de quebra de linha persistida em localStorage e botao Copiar codigo (CHAT-03).
 */
export function CodePreview({
  code,
  language,
  fileName,
  showLineNumbers = true,
}: CodePreviewProps): React.ReactElement {
  const detectedLang = detectCodeLanguage(fileName, language);
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(WRAP_STORAGE_KEY);
      if (saved === "1") setWrapLines(true);
    } catch {
      // ignora ambiente sem localStorage
    }
  }, []);

  const toggleWrap = (): void => {
    const next = !wrapLines;
    setWrapLines(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(WRAP_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignora
      }
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const lines = useMemo(() => code.split(/\r?\n/), [code]);

  return (
    <div className="w-full rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.06)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[#1A1A1A] px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {fileName && (
            <span className="text-[12px] font-semibold text-[#FFFFFF] truncate">
              {fileName}
            </span>
          )}
          <span className="text-[12px] font-semibold font-terminal text-[#979797] uppercase">
            {detectedLang}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleWrap}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold ${
              wrapLines
                ? "bg-[#2A2A2A] text-[#42A0FF]"
                : "bg-[#242424] text-[#979797] hover:text-[#DCDCDC]"
            }`}
          >
            <WrapText className="w-3.5 h-3.5" />
            Quebrar linhas
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#42A0FF]"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#31CF76]" />
                Conteúdo copiado
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar código
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-4 overflow-x-auto max-h-[520px] overflow-y-auto">
        <div className="flex flex-col font-terminal text-[12px] leading-[1.33]">
          {lines.map((line, idx) => (
            <div key={`ln-${idx}`} className="flex items-start gap-4">
              {showLineNumbers && (
                <span className="select-none text-[#6A6A6A] text-right min-w-[28px] shrink-0">
                  {idx + 1}
                </span>
              )}
              <span
                className={`text-[#DCDCDC] flex-1 ${
                  wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                }`}
              >
                {line || " "}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
