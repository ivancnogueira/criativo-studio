/**
 * Utilitários puros de cor, contraste e agrupamento em blocos para balões do Chat (CHAT23-01).
 */

export interface BubbleColorPalette {
  backgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  codeBgClass: string;
  isLightBg: boolean;
}

export const AGENT_CHAT_COLOR_SWATCHES = [
  { hex: "#166534", label: "Verde Floresta" },
  { hex: "#0BFF5C", label: "Verde Neon" },
  { hex: "#1D4ED8", label: "Azul Cobalto" },
  { hex: "#6D28D9", label: "Violeta Estúdio" },
  { hex: "#BE123C", label: "Carmim" },
  { hex: "#B45309", label: "Âmbar" },
  { hex: "#0F766E", label: "Petróleo" },
] as const;

export const OPERATOR_BUBBLE_SWATCHES = [
  { hex: "#2A2A2A", label: "Grafite Neutro" },
  { hex: "#D9483B", label: "Coral Operador" },
  { hex: "#007CF7", label: "Azul Estúdio" },
  { hex: "#15803D", label: "Esmeralda" },
  { hex: "#7C3AED", label: "Roxo" },
  { hex: "#C2410C", label: "Terracota" },
] as const;

const HEX6_RE = /^#([0-9A-Fa-f]{6})$/;

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(HEX6_RE);
  if (!m) return null;
  const full = m[1]!;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Calcula contraste perceptivo YIQ garantindo legibilidade em qualquer cor de balão.
 */
export function computeBubbleColors(
  customHex: string | null | undefined,
  defaultHex: string,
): BubbleColorPalette {
  const safeHex =
    typeof customHex === "string" && HEX6_RE.test(customHex.trim())
      ? customHex.trim().toUpperCase()
      : defaultHex;
  const rgb = parseHexRgb(safeHex) ?? { r: 33, g: 33, b: 33 };
  const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  const isLightBg = yiq >= 158;

  if (isLightBg) {
    return {
      backgroundColor: safeHex,
      textColor: "#0D1117",
      mutedTextColor: "rgba(13,17,23,0.72)",
      borderColor: "rgba(13,17,23,0.18)",
      codeBgClass: "bg-black/15 text-[#0D1117] border-black/15",
      isLightBg: true,
    };
  }

  return {
    backgroundColor: safeHex,
    textColor: "#FFFFFF",
    mutedTextColor: "rgba(255,255,255,0.75)",
    borderColor: "rgba(255,255,255,0.12)",
    codeBgClass: "bg-black/30 text-white border-white/15",
    isLightBg: false,
  };
}

/**
 * Divide blocos de texto Markdown do assistente em balões visuais concisos,
 * mantendo parágrafos introdutórios terminados em ':' ou '#' colados à lista seguinte.
 */
export function splitMarkdownIntoBubbleChunks(markdownText: string): string[] {
  const raw = (markdownText || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  // Divide em parágrafos respeitando cercas ``` para nunca cortar um bloco de código ao meio
  const paragraphs: string[] = [];
  const currentLines: string[] = [];
  let inFence = false;
  for (const line of raw.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      currentLines.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (currentLines.length > 0) {
        const block = currentLines.join("\n").trim();
        if (block) paragraphs.push(block);
        currentLines.length = 0;
      }
      continue;
    }
    currentLines.push(line);
  }
  if (currentLines.length > 0) {
    const tail = currentLines.join("\n").trim();
    if (tail) paragraphs.push(tail);
  }

  if (paragraphs.length <= 1) {
    return paragraphs;
  }

  const grouped: string[] = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const current = paragraphs[i]!;
    const prev = grouped[grouped.length - 1];
    const isListBlock = /^([ \t]*[-*•]|[ \t]*\d+\.)\s+/m.test(current);
    const prevIntroducesNext =
      Boolean(prev) &&
      (prev!.endsWith(":") ||
        /^#{1,4}\s+/.test(prev!.split("\n").pop() ?? ""));
    const isShortClosingAfterList =
      Boolean(prev) &&
      /^([ \t]*[-*•]|[ \t]*\d+\.)\s+/m.test(prev!) &&
      current.length <= 110 &&
      !current.startsWith("#");

    if (prev && ((prevIntroducesNext && isListBlock) || isShortClosingAfterList)) {
      grouped[grouped.length - 1] = `${prev}\n\n${current}`;
    } else {
      grouped.push(current);
    }
  }

  return grouped;
}
