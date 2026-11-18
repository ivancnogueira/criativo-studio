import React, { useEffect, useId, useMemo, useState } from "react";
import { Code2, Copy, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { CodePreview } from "./CodePreview";

class BoundedLruCache<V> {
  private readonly maxEntries: number;
  private readonly store = new Map<string, V>();

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  public get(key: string): V | undefined {
    if (!this.store.has(key)) return undefined;
    const val = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  public set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, value);
  }
}

const mermaidSvgCache = new BoundedLruCache<string>(100);
const katexHtmlCache = new BoundedLruCache<string>(500);
let mermaidInitialized = false;

export interface MermaidDiagramProps {
  chart: string;
  title?: string;
}

/**
 * Renderizador assincrono seguro de diagramas Mermaid com LRU (100),
 * securityLevel="strict", htmlLabels=false e alternancia Alternar codigo (CHAT-03).
 */
export function MermaidDiagram({
  chart,
  title = "Diagrama Mermaid",
}: MermaidDiagramProps): React.ReactElement {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(() => {
    const cached = mermaidSvgCache.get(chart);
    return cached ?? null;
  });
  const [parseError, setParseError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = mermaidSvgCache.get(chart);
    if (cached) {
      setSvgDataUrl(cached);
      setParseError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("mermaid");
        const mermaid = mod.default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            htmlLabels: false,
            theme: "dark",
          });
          mermaidInitialized = true;
        }
        const renderId = `mmd-${reactId}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, chart);
        const safeDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        mermaidSvgCache.set(chart, safeDataUrl);
        if (!cancelled) {
          setSvgDataUrl(safeDataUrl);
          setParseError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setParseError(err instanceof Error ? err.message : "Erro de sintaxe no diagrama Mermaid.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  if (expanded && svgDataUrl) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-0 z-50 bg-[#0D0D0D] flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 bg-[#141414] border-b border-[rgba(255,255,255,0.12)] p-4">
          <span className="text-[20px] font-semibold text-[#FFFFFF]">{title}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              className="rounded-lg bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[12px] font-semibold text-[#DCDCDC]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="rounded-lg bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
            >
              <Minimize2 className="w-4 h-4" />
              Sair da tela cheia
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center p-8">
          <img
            src={svgDataUrl}
            alt={title}
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            className="max-w-full h-auto transition-transform"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
        <span className="text-[12px] font-semibold text-[#DCDCDC]">{title}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSource((s) => !s)}
            className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#42A0FF]"
          >
            <Code2 className="w-3.5 h-3.5" />
            Alternar código
          </button>
          {svgDataUrl && !showSource && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Expandir prévia
            </button>
          )}
        </div>
      </div>

      {parseError ? (
        <div className="p-4 flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-[#FD2F3B]">
            Falha ao interpretar diagrama: {parseError}
          </span>
          <CodePreview code={chart} language="mermaid" />
        </div>
      ) : showSource || !svgDataUrl ? (
        <div className="p-4">
          <CodePreview code={chart} language="mermaid" />
        </div>
      ) : (
        <div className="p-4 bg-[#1A1A1A] flex items-center justify-center overflow-x-auto">
          <img src={svgDataUrl} alt={title} className="max-w-full h-auto" />
        </div>
      )}
    </div>
  );
}

export interface MathFormulaProps {
  formula: string;
  displayMode?: boolean;
}

/**
 * Renderizador lazy seguro de formulas LaTeX via KaTeX com trust=false e LRU 500 (CHAT-03).
 */
export function MathFormula({
  formula,
  displayMode = false,
}: MathFormulaProps): React.ReactElement {
  const cacheKey = `${displayMode ? "block" : "inline"}:${formula}`;
  const [renderedHtml, setRenderedHtml] = useState<string | null>(() => {
    return katexHtmlCache.get(cacheKey) ?? null;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hit = katexHtmlCache.get(cacheKey);
    if (hit) {
      setRenderedHtml(hit);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const katexMod = await import("katex");
        const katex = katexMod.default;
        const html = katex.renderToString(formula, {
          displayMode,
          trust: false,
          strict: "ignore",
          throwOnError: false,
          output: "htmlAndMathml",
        });
        katexHtmlCache.set(cacheKey, html);
        if (!cancelled) {
          setRenderedHtml(html);
        }
      } catch {
        if (!cancelled) {
          setRenderedHtml(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, displayMode, formula]);

  if (!renderedHtml) {
    return displayMode ? (
      <pre className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.06)] p-4 text-[12px] font-terminal text-[#DCDCDC] overflow-x-auto">
        {formula}
      </pre>
    ) : (
      <code className="rounded bg-[#101010] px-1 font-terminal text-[12px] text-[#DCDCDC]">
        {formula}
      </code>
    );
  }

  return displayMode ? (
    <div
      className="my-2 overflow-x-auto text-[#FFFFFF]"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  ) : (
    <span
      className="inline-block text-[#FFFFFF]"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(\$[^$\n]+\$|`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return tokens.map((part, idx) => {
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      return <MathFormula key={`m-${idx}`} formula={part.slice(1, -1)} displayMode={false} />;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={`c-${idx}`}
          className="rounded bg-[#101010] px-1 font-terminal text-[12px] text-[#42A0FF]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`b-${idx}`} className="font-semibold text-[#FFFFFF]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`t-${idx}`}>{part}</React.Fragment>;
  });
}

export interface MarkdownFilePreviewProps {
  markdown: string;
  fileName?: string;
  showHeader?: boolean;
}

/**
 * Renderizador seguro de Markdown GFM (sem injecao de HTML bruto arbitrario),
 * com suporte nativo a tabelas, CodePreview, MermaidDiagram e MathFormula (CHAT-03).
 */
export function MarkdownFilePreview({
  markdown,
  fileName,
  showHeader = true,
}: MarkdownFilePreviewProps): React.ReactElement {
  const [copied, setCopied] = useState<boolean>(false);

  const blocks = useMemo(() => {
    const out: React.ReactNode[] = [];
    const lines = markdown.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // Bloco de codigo cercado ```lang
      const fenceMatch = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
      if (fenceMatch) {
        const lang = (fenceMatch[1] ?? "").toLowerCase();
        const codeLines: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i]!.startsWith("```")) {
          codeLines.push(lines[i]!);
          i += 1;
        }
        i += 1; // consome ```
        const body = codeLines.join("\n");
        if (lang === "mermaid" || lang === "mmd") {
          out.push(<MermaidDiagram key={`blk-${i}`} chart={body} />);
        } else if (lang === "math" || lang === "latex") {
          out.push(<MathFormula key={`blk-${i}`} formula={body} displayMode />);
        } else {
          out.push(<CodePreview key={`blk-${i}`} code={body} language={lang || "txt"} />);
        }
        continue;
      }

      // Bloco de formula $$...$$
      if (line.trim().startsWith("$$")) {
        if (line.trim().endsWith("$$") && line.trim().length > 4) {
          out.push(
            <MathFormula
              key={`math-${i}`}
              formula={line.trim().slice(2, -2).trim()}
              displayMode
            />,
          );
          i += 1;
          continue;
        }
        const mathLines: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i]!.trim().startsWith("$$")) {
          mathLines.push(lines[i]!);
          i += 1;
        }
        i += 1;
        out.push(
          <MathFormula key={`math-${i}`} formula={mathLines.join("\n")} displayMode />,
        );
        continue;
      }

      // Tabela GFM
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1]!)) {
        const parseRow = (r: string) =>
          r
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim());
        const headers = parseRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i]!.includes("|")) {
          rows.push(parseRow(lines[i]!));
          i += 1;
        }
        out.push(
          <div
            key={`tbl-${i}`}
            className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#101010]"
          >
            <table className="w-full border-collapse text-left">
              <thead className="bg-[#242424]">
                <tr>
                  {headers.map((h, hIdx) => (
                    <th
                      key={`th-${hIdx}`}
                      className="px-4 py-2 text-[12px] font-semibold text-[#FFFFFF] border-b border-[rgba(255,255,255,0.06)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rIdx) => (
                  <tr
                    key={`tr-${rIdx}`}
                    className="border-b border-[rgba(255,255,255,0.06)]"
                  >
                    {headers.map((_, cIdx) => (
                      <td
                        key={`td-${rIdx}-${cIdx}`}
                        className="px-4 py-2 text-[14px] text-[#DCDCDC]"
                      >
                        {renderInlineMarkdown(r[cIdx] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }

      // Titulos
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const contentText = headingMatch[2]!;
        out.push(
          level === 1 ? (
            <h2 key={`h-${i}`} className="text-[20px] font-semibold text-[#FFFFFF]">
              {renderInlineMarkdown(contentText)}
            </h2>
          ) : (
            <h3 key={`h-${i}`} className="text-[14px] font-semibold text-[#FFFFFF]">
              {renderInlineMarkdown(contentText)}
            </h3>
          ),
        );
        i += 1;
        continue;
      }

      // Blockquote
      if (line.startsWith(">")) {
        out.push(
          <blockquote
            key={`bq-${i}`}
            className="border-l-4 border-l-[#007CF7] bg-[#1A1A1A] px-4 py-2 text-[14px] text-[#DCDCDC] rounded-r-lg"
          >
            {renderInlineMarkdown(line.replace(/^>\s?/, ""))}
          </blockquote>,
        );
        i += 1;
        continue;
      }

      // Lista
      if (/^\s*[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
          items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
          i += 1;
        }
        out.push(
          <ul key={`ul-${i}`} className="list-disc list-inside flex flex-col gap-1 text-[14px] text-[#DCDCDC]">
            {items.map((it, itIdx) => (
              <li key={`li-${itIdx}`}>{renderInlineMarkdown(it)}</li>
            ))}
          </ul>,
        );
        continue;
      }

      if (line.trim().length === 0) {
        i += 1;
        continue;
      }

      out.push(
        <p key={`p-${i}`} className="text-[14px] font-normal leading-[1.43] text-[#DCDCDC]">
          {renderInlineMarkdown(line)}
        </p>,
      );
      i += 1;
    }

    return out;
  }, [markdown]);

  const handleCopyMarkdown = async (): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] overflow-hidden">
      {showHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
          <span className="text-[14px] font-semibold text-[#FFFFFF] truncate">
            {fileName ?? "Documento Markdown"}
          </span>
          <button
            type="button"
            onClick={() => void handleCopyMarkdown()}
            className="inline-flex items-center gap-1 rounded bg-[#242424] hover:bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#42A0FF]"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? "Conteúdo copiado" : "Copiar Markdown"}
          </button>
        </div>
      )}
      <div className="p-4 flex flex-col gap-4">{blocks}</div>
    </div>
  );
}
