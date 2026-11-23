/**
 * Conversor determinístico de Markdown para texto limpo compatível com WhatsApp
 * (evita títulos #, tabelas quebradas |...| e blocos extensos na tela do celular).
 */

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed);
}

function convertMarkdownTablesToBullets(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const nextLine = lines[i + 1] ?? "";
    if (line.includes("|") && isMarkdownTableSeparator(nextLine)) {
      const headers = parseMarkdownTableRow(line);
      i += 2; // Pula cabeçalho + separador
      while (i < lines.length) {
        const rowLine = lines[i] ?? "";
        if (!rowLine.trim() || !rowLine.includes("|")) break;
        if (isMarkdownTableSeparator(rowLine)) {
          i += 1;
          continue;
        }
        const cells = parseMarkdownTableRow(rowLine);
        if (cells.length === 2 && cells[0]) {
          out.push(`• *${cells[0]}:* ${cells[1] ?? ""}`.trim());
        } else {
          const pairs = cells
            .map((val, idx) => {
              const header = headers[idx];
              if (!val) return "";
              return header ? `*${header}:* ${val}` : val;
            })
            .filter(Boolean);
          if (pairs.length > 0) {
            out.push(`• ${pairs.join(" · ")}`);
          }
        }
        i += 1;
      }
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out;
}

/**
 * Converte Markdown rico em texto legível com formatação nativa de WhatsApp (*negrito*, _itálico_, ~tachado~, • listas).
 */
export function markdownToWhatsAppText(markdown: string): string {
  if (!markdown || !markdown.trim()) return "";

  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = convertMarkdownTablesToBullets(normalized.split("\n"));

  const BOLD_START = "\u0001";
  const BOLD_END = "\u0002";

  const transformed: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Remove cercas ```lang preservando conteúdo interno limpo
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      transformed.push(`  ${rawLine}`);
      continue;
    }

    // Remove separadores horizontais --- / ***
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      transformed.push("");
      continue;
    }

    let line = rawLine;

    // Cabeçalhos # / ## / ### -> *TÍTULO*
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const inner = headingMatch[1]!.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*/g, "").trim();
      transformed.push(`${BOLD_START}${inner}${BOLD_END}`);
      continue;
    }

    // Blockquotes > texto
    line = line.replace(/^\s*>\s?/, "");

    // Listas - item ou * item -> • item (antes da conversão de bold)
    line = line.replace(/^(\s*)[-*+]\s+/, "$1• ");

    // Negrito Markdown **texto** ou __texto__ -> marcador temporário para WhatsApp *texto*
    line = line.replace(/\*\*([^*\n]+?)\*\*/g, `${BOLD_START}$1${BOLD_END}`);
    line = line.replace(/__([^_\n]+?)__/g, `${BOLD_START}$1${BOLD_END}`);

    // Tachado ~~texto~~ -> ~texto~
    line = line.replace(/~~([^~\n]+?)~~/g, "~$1~");

    // Links [texto](url) -> texto (url) ou url se idênticos
    line = line.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
      const cleanLabel = label.trim();
      return cleanLabel === url.trim() ? url.trim() : `${cleanLabel} (${url.trim()})`;
    });

    // Crases inline `codigo` -> codigo limpo (ou mantém sem poluição excessiva)
    line = line.replace(/`([^`\n]+)`/g, "$1");

    transformed.push(line);
  }

  return transformed
    .join("\n")
    .replace(new RegExp(BOLD_START, "g"), "*")
    .replace(new RegExp(BOLD_END, "g"), "*")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Formata e opcionalmente divide a resposta em blocos curtos apropriados para WhatsApp.
 */
export function formatMarkdownForWhatsApp(
  markdown: string,
  options?: { maxChunkLength?: number; maxChunks?: number },
): string[] {
  const clean = markdownToWhatsAppText(markdown);
  if (!clean) return [];

  const maxChunkLength = Math.max(200, options?.maxChunkLength ?? 1600);
  const maxChunks = Math.max(1, options?.maxChunks ?? 4);

  if (clean.length <= maxChunkLength) {
    return [clean];
  }

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  let truncated = false;

  for (const para of paragraphs) {
    const piece = para.trim();
    if (!piece) continue;

    if (!current) {
      if (piece.length <= maxChunkLength) {
        current = piece;
      } else {
        // Quebra por linhas ou corte limpo
        const lines = piece.split("\n");
        for (const ln of lines) {
          if (current && current.length + 1 + ln.length > maxChunkLength) {
            chunks.push(current);
            current = ln.slice(0, maxChunkLength);
            if (chunks.length >= maxChunks) {
              truncated = true;
              break;
            }
          } else {
            current = current ? `${current}\n${ln}` : ln.slice(0, maxChunkLength);
          }
        }
      }
    } else if (current.length + 2 + piece.length <= maxChunkLength) {
      current = `${current}\n\n${piece}`;
    } else {
      chunks.push(current);
      if (chunks.length >= maxChunks) {
        current = "";
        truncated = true;
        break;
      }
      current = piece.length <= maxChunkLength ? piece : piece.slice(0, maxChunkLength);
    }

    if (chunks.length >= maxChunks) {
      truncated = true;
      current = "";
      break;
    }
  }

  if (current && chunks.length < maxChunks) {
    chunks.push(current);
  }

  if (truncated && chunks.length > 0) {
    const suffix = "\n\n_(Resumo completo disponível no chat do CriativoOS)_";
    const lastIdx = chunks.length - 1;
    const base = chunks[lastIdx]!.slice(0, Math.max(50, maxChunkLength - suffix.length));
    chunks[lastIdx] = `${base.trimEnd()}${suffix}`;
  }

  return chunks;
}
