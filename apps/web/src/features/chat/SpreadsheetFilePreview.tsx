import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpDown, Copy, Search } from "lucide-react";

export interface SpreadsheetFilePreviewProps {
  content: string;
  fileName?: string;
  delimiterHint?: "," | "\t" | ";";
}

const MAX_DISPLAY_ROWS = 500;
const MAX_DISPLAY_COLS = 50;

export function detectDelimiter(raw: string, fileName?: string): "," | "\t" | ";" {
  if (fileName?.toLowerCase().endsWith(".tsv")) return "\t";
  const firstLine = raw.split(/\r?\n/)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/**
 * Parser RFC 4180 clean-room para CSV/TSV suportando celulas entre aspas,
 * aspas escapadas ("") e quebras de linha internas.
 */
export function parseDelimitedRfc4180(raw: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (ch === "\r" && next === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += ch;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function buildMarkdownTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";
  const escapeMd = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const headerLine = `| ${headers.map(escapeMd).join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map((r) => `| ${headers.map((_, idx) => escapeMd(r[idx] ?? "")).join(" | ")} |`);
  return [headerLine, sepLine, ...bodyLines].join("\n");
}

export function SpreadsheetFilePreview({
  content,
  fileName,
  delimiterHint,
}: SpreadsheetFilePreviewProps): React.ReactElement {
  const [search, setSearch] = useState<string>("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const delim = delimiterHint ?? detectDelimiter(content, fileName);
    const matrix = parseDelimitedRfc4180(content, delim);
    if (matrix.length === 0) {
      return {
        headers: [] as string[],
        rows: [] as string[][],
        totalRows: 0,
        totalCols: 0,
        truncated: false,
      };
    }

    const rawHeaders = matrix[0] ?? [];
    const totalCols = rawHeaders.length;
    const headers = rawHeaders.slice(0, MAX_DISPLAY_COLS);
    const bodyAll = matrix.slice(1);
    const totalRows = bodyAll.length;
    const truncated = totalRows > MAX_DISPLAY_ROWS || totalCols > MAX_DISPLAY_COLS;
    const rows = bodyAll
      .slice(0, MAX_DISPLAY_ROWS)
      .map((r) => r.slice(0, MAX_DISPLAY_COLS));

    return { headers, rows, totalRows, totalCols, truncated };
  }, [content, delimiterHint, fileName]);

  const filteredAndSortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? parsed.rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q)))
      : [...parsed.rows];

    if (sortCol !== null) {
      list.sort((a, b) => {
        const va = a[sortCol] ?? "";
        const vb = b[sortCol] ?? "";
        const na = Number(va);
        const nb = Number(vb);
        if (va !== "" && vb !== "" && Number.isFinite(na) && Number.isFinite(nb)) {
          return sortAsc ? na - nb : nb - na;
        }
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return list;
  }, [parsed.rows, search, sortAsc, sortCol]);

  const copyToClipboard = async (text: string): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedFeedback("Conteúdo copiado");
      setTimeout(() => setCopiedFeedback(null), 2000);
    }
  };

  return (
    <div className="w-full rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-[rgba(255,255,255,0.06)] p-4">
        <div className="flex items-center gap-2 flex-wrap">
          {fileName && (
            <span className="text-[14px] font-semibold text-[#FFFFFF]">{fileName}</span>
          )}
          <span className="text-[12px] font-normal text-[#979797]">
            {parsed.totalRows} × {parsed.totalCols}
          </span>
          {parsed.truncated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#242424] px-2 py-1 text-[12px] font-semibold text-[#FF9412]">
              <AlertTriangle className="w-3.5 h-3.5" />
              Limitado a 500 linhas × 50 colunas
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {copiedFeedback && (
            <span className="text-[12px] font-semibold text-[#31CF76]">{copiedFeedback}</span>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#6A6A6A] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar planilha..."
              className="rounded-lg bg-[#101010] border border-[rgba(255,255,255,0.12)] pl-8 pr-2 py-1 text-[12px] text-[#FFFFFF] placeholder:text-[#6A6A6A]"
            />
          </div>

          <button
            type="button"
            onClick={() => void copyToClipboard(content)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
          >
            <Copy className="w-3.5 h-3.5" />
            Copiar CSV
          </button>

          <button
            type="button"
            onClick={() =>
              void copyToClipboard(buildMarkdownTable(parsed.headers, filteredAndSortedRows))
            }
            className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC]"
          >
            <Copy className="w-3.5 h-3.5" />
            Copiar Markdown
          </button>
        </div>
      </div>

      <div className="max-h-[480px] overflow-auto bg-[#101010]">
        {parsed.headers.length === 0 ? (
          <div className="p-4 text-[12px] text-[#979797]">Planilha vazia.</div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-[#242424] z-10">
              <tr>
                {parsed.headers.map((header, idx) => (
                  <th
                    key={`${header}-${idx}`}
                    onClick={() => {
                      if (sortCol === idx) setSortAsc((v) => !v);
                      else {
                        setSortCol(idx);
                        setSortAsc(true);
                      }
                    }}
                    className="px-4 py-2 text-[12px] font-semibold font-terminal text-[#FFFFFF] border-b border-[rgba(255,255,255,0.06)] cursor-pointer whitespace-nowrap select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {header || `Coluna ${idx + 1}`}
                      <ArrowUpDown className="w-3 h-3 text-[#979797]" />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedRows.map((row, rIdx) => (
                <tr
                  key={`csv-r-${rIdx}`}
                  className="border-b border-[rgba(255,255,255,0.06)] hover:bg-[#1A1A1A]"
                >
                  {parsed.headers.map((_, cIdx) => (
                    <td
                      key={`csv-c-${rIdx}-${cIdx}`}
                      className="px-4 py-2 text-[12px] font-normal font-terminal text-[#DCDCDC] max-w-[260px] truncate"
                    >
                      {row[cIdx] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
