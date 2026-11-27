import { inflateRawSync } from "node:zlib";

export const MAX_DOCX_XML_BYTES = 10 * 1024 * 1024;

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

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decompressZipPayload(payload: Buffer, method: number, declaredSize: number): Buffer {
  if (declaredSize > MAX_DOCX_XML_BYTES) {
    throw new Error("Entrada word/document.xml excede o limite de segurança de 10 MB.");
  }
  if (method === 0) {
    if (payload.length > MAX_DOCX_XML_BYTES) throw new Error("Entrada word/document.xml excede 10 MB.");
    return payload;
  }
  if (method === 8) {
    const out = inflateRawSync(payload, { maxOutputLength: MAX_DOCX_XML_BYTES });
    if (out.length > MAX_DOCX_XML_BYTES) throw new Error("Entrada word/document.xml descompactada excede 10 MB.");
    return out;
  }
  throw new Error(`Método de compressão ZIP não suportado no .docx (${method}).`);
}

function extractDocumentXmlFromZip(buffer: Buffer): string {
  if (buffer.length < 30) throw new Error("Arquivo .docx inválido ou corrompido.");

  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const cdEnd = Math.min(buffer.length, buffer.readUInt32LE(eocdOffset + 16) + buffer.readUInt32LE(eocdOffset + 12));
    let pos = buffer.readUInt32LE(eocdOffset + 16);
    while (pos + 46 <= cdEnd && buffer.readUInt32LE(pos) === 0x02014b50) {
      const method = buffer.readUInt16LE(pos + 10);
      const compSize = buffer.readUInt32LE(pos + 20);
      const uncompSize = buffer.readUInt32LE(pos + 24);
      const nameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const lhOff = buffer.readUInt32LE(pos + 42);
      const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
      if (name === "word/document.xml") {
        if (lhOff + 30 > buffer.length || buffer.readUInt32LE(lhOff) !== 0x04034b50) {
          throw new Error("Cabeçalho local ZIP inválido para word/document.xml.");
        }
        const start = lhOff + 30 + buffer.readUInt16LE(lhOff + 26) + buffer.readUInt16LE(lhOff + 28);
        if (start + compSize > buffer.length) throw new Error("Dados truncados em word/document.xml.");
        return decompressZipPayload(buffer.subarray(start, start + compSize), method, uncompSize).toString("utf8");
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
  }

  let offset = 0;
  let foundLocal = false;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    foundLocal = true;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const uncompSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLen + buffer.readUInt16LE(offset + 28);
    if (start + compSize > buffer.length) break;
    if (buffer.toString("utf8", offset + 30, offset + 30 + nameLen) === "word/document.xml") {
      return decompressZipPayload(buffer.subarray(start, start + compSize), method, uncompSize).toString("utf8");
    }
    offset = start + compSize;
  }

  if (!foundLocal && eocdOffset < 0) throw new Error("Arquivo não é um pacote ZIP/.docx válido.");
  throw new Error("Arquivo word/document.xml não encontrado no .docx.");
}

function isRunFlagEnabled(rPrXml: string, tag: "b" | "i"): boolean {
  const match = rPrXml.match(new RegExp(`<w:${tag}(?:\\s+([^>]*))?\\/?>`, "i"));
  return Boolean(match && !/(?:w:)?val=["'](?:0|false|off)["']/i.test(match[1] ?? ""));
}

function parseParagraphXml(pXml: string): DocxPreviewBlock | null {
  const pPr = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/i)?.[1] ?? "";
  const styleVal = pPr.match(/<w:pStyle\b[^>]*?(?:w:)?val=["']([^"']+)["']/i)?.[1] ?? "";
  const headingMatch = styleVal.match(/^(?:Heading|Titulo|Título|H)\s*([1-6])$/i);
  const isListItem = /<w:numPr\b/i.test(pPr) || /list/i.test(styleVal);

  const runs: DocxTextRun[] = [];
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = runRegex.exec(pXml)) !== null) {
    const rBody = rMatch[1] ?? "";
    const rPr = rBody.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i)?.[1] ?? "";
    const bold = isRunFlagEnabled(rPr, "b");
    const italic = isRunFlagEnabled(rPr, "i");
    const parts: string[] = [];
    const textRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = textRegex.exec(rBody)) !== null) {
      parts.push(tMatch[2] ? (tMatch[2].toLowerCase() === "tab" ? "  " : "\n") : decodeXmlEntities(tMatch[1] ?? ""));
    }
    const text = parts.join("");
    if (!text) continue;
    const prev = runs[runs.length - 1];
    if (prev && Boolean(prev.bold) === bold && Boolean(prev.italic) === italic) {
      prev.text += text;
    } else {
      runs.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
    }
  }

  const fullText = runs.map((r) => r.text).join("").trim();
  if (!fullText) return null;
  if (headingMatch) {
    const level = Math.max(1, Math.min(6, Number(headingMatch[1]))) as 1 | 2 | 3 | 4 | 5 | 6;
    return { kind: "heading", level, text: fullText };
  }
  return isListItem ? { kind: "list_item", text: fullText } : { kind: "paragraph", runs };
}

function parseTableXml(tblXml: string): DocxPreviewBlock | null {
  const rows: string[][] = [];
  const trRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tblXml)) !== null) {
    const rowCells: string[] = [];
    const tcRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
    let tcMatch: RegExpExecArray | null;
    while ((tcMatch = tcRegex.exec(trMatch[1] ?? "")) !== null) {
      const cellParts: string[] = [];
      const pRegex = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/gi;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = pRegex.exec(tcMatch[1] ?? "")) !== null) {
        const parsed = parseParagraphXml(pMatch[0]);
        if (!parsed) continue;
        cellParts.push(parsed.kind === "paragraph" ? parsed.runs.map((r) => r.text).join("") : parsed.kind === "table" ? "" : parsed.text);
      }
      rowCells.push(cellParts.join("\n").trim());
    }
    if (rowCells.length > 0) rows.push(rowCells);
  }
  return rows.length > 0 ? { kind: "table", rows } : null;
}

/**
 * Faz o parse estruturado de arquivos `.docx` (ZIP/XML) sem dependências externas,
 * retornando blocos seguros (títulos, parágrafos, listas e tabelas) sem HTML bruto.
 */
export function parseDocxPreviewFromBuffer(buffer: Buffer): DocxPreviewDocument {
  const xml = extractDocumentXmlFromZip(buffer);
  const bodyXml = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i)?.[1] ?? xml;
  const blocks: DocxPreviewBlock[] = [];
  const blockRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(bodyXml)) !== null) {
    const chunk = match[0];
    const block = chunk.toLowerCase().startsWith("<w:tbl") ? parseTableXml(chunk) : parseParagraphXml(chunk);
    if (block) blocks.push(block);
  }

  const stats = {
    headings: blocks.filter((b) => b.kind === "heading").length,
    paragraphs: blocks.filter((b) => b.kind === "paragraph").length,
    listItems: blocks.filter((b) => b.kind === "list_item").length,
    tables: blocks.filter((b) => b.kind === "table").length,
  };
  const plainTextPreview = blocks
    .map((b) => (b.kind === "paragraph" ? b.runs.map((r) => r.text).join("") : b.kind === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text))
    .join("\n\n")
    .slice(0, 4000);

  return { blocks, plainTextPreview, stats };
}
