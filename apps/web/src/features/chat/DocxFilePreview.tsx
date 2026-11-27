import React, { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { requestJson, resolveActiveServerUrl } from "../../services/http-client";

export interface DocxTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type DocxPreviewBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "list_item"; text: string }
  | { kind: "paragraph"; runs: DocxTextRun[] }
  | { kind: "table"; rows: string[][] };

export interface DocxPreviewDocument {
  blocks: DocxPreviewBlock[];
  plainTextPreview: string;
  stats: { headings: number; paragraphs: number; listItems: number; tables: number };
}

export function extractDocxRelativePath(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    if (parsed.pathname === "/api/arquivos/raw") return parsed.searchParams.get("path");
    if (parsed.pathname.startsWith("/api/arquivos/raw/")) {
      return decodeURIComponent(parsed.pathname.slice("/api/arquivos/raw/".length));
    }
    return parsed.searchParams.get("path");
  } catch {
    return null;
  }
}

const HEADING_CLASSES: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: "text-[20px] font-bold text-[#FFFFFF] mt-3 mb-1.5",
  2: "text-[17px] font-semibold text-[#FFFFFF] mt-2.5 mb-1",
  3: "text-[15px] font-semibold text-[#EAEAEA] mt-2 mb-1",
  4: "text-[14px] font-semibold text-[#DCDCDC] mt-2 mb-0.5",
  5: "text-[13px] font-semibold text-[#DCDCDC] mt-1.5 mb-0.5",
  6: "text-[12px] font-semibold text-[#B4B4B4] mt-1.5 mb-0.5",
};

/** Renderiza prévia estruturada de `.docx` via `/api/arquivos/preview-docx` sem HTML bruto. */
export function DocxFilePreview({ url, fileName }: { url: string; fileName: string }): React.ReactElement {
  const [doc, setDoc] = useState<DocxPreviewDocument | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const relPath = extractDocxRelativePath(url);
    if (!relPath) {
      setDoc(null);
      setError("Caminho do documento indisponível para prévia nativa.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void requestJson<{ ok: boolean; document?: DocxPreviewDocument; erro?: string }>(
      `/api/arquivos/preview-docx?path=${encodeURIComponent(relPath)}`,
    )
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.document) setDoc(res.document);
        else setError(res.erro ?? "Não foi possível renderizar este documento .docx.");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar prévia do .docx.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) return <div className="p-4 text-[12px] text-[#979797]">Lendo documento .docx...</div>;

  if (error || !doc) {
    return (
      <div className="rounded-[14px] bg-[#212121] border border-[rgba(255,255,255,0.12)] p-6 flex flex-col items-center gap-4 text-center">
        <FileText className="w-8 h-8 text-[#42A0FF]" />
        <p className="text-[13px] text-[#DCDCDC]">{error ?? "Prévia indisponível."}</p>
        <a
          href={resolveActiveServerUrl(url)}
          download={fileName}
          className="studio-btn-primary inline-flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[13px] font-semibold text-[#141414]"
        >
          <Download className="w-4 h-4" />
          Baixar {fileName}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] bg-[#141414] border border-[rgba(255,255,255,0.1)] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-2 text-[12px] text-[#979797]">
          <FileText className="w-4 h-4 text-[#42A0FF]" />
          <span>Documento Word (.docx)</span>
        </div>
        <span className="text-[11px] text-[#8E8E8E]">
          {doc.stats.headings} títulos · {doc.stats.paragraphs} parágrafos · {doc.stats.tables} tabelas
        </span>
      </div>
      {doc.blocks.length === 0 ? (
        <p className="text-[13px] text-[#979797]">Documento sem blocos de texto legíveis.</p>
      ) : (
        <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-[#DCDCDC]">
          {doc.blocks.map((block, idx) => {
            if (block.kind === "heading") {
              return (
                <div key={idx} role="heading" aria-level={block.level} className={HEADING_CLASSES[block.level]}>
                  {block.text}
                </div>
              );
            }
            if (block.kind === "list_item") {
              return (
                <div key={idx} className="flex items-start gap-2 pl-2">
                  <span className="text-[#42A0FF] select-none">•</span>
                  <span>{block.text}</span>
                </div>
              );
            }
            if (block.kind === "table") {
              return (
                <div key={idx} className="overflow-x-auto my-2 rounded-lg border border-[rgba(255,255,255,0.12)]">
                  <table className="w-full border-collapse text-left text-[12px]">
                    <tbody>
                      {block.rows.map((row, rIdx) => (
                        <tr key={rIdx} className={rIdx === 0 ? "bg-[#1F1F22] font-semibold text-[#FFFFFF]" : "bg-[#161618] border-t border-[rgba(255,255,255,0.08)]"}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-3 py-2 align-top whitespace-pre-wrap">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return (
              <p key={idx} className="whitespace-pre-wrap">
                {block.runs.map((run, rIdx) => {
                  let node: React.ReactNode = run.text;
                  if (run.bold) node = <strong>{node}</strong>;
                  if (run.italic) node = <em>{node}</em>;
                  return <React.Fragment key={rIdx}>{node}</React.Fragment>;
                })}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
