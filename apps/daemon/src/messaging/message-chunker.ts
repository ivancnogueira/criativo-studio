import type { MessagingPlatform } from "@criativo/contracts";

export const PLATFORM_MESSAGE_LIMITS: Record<MessagingPlatform, number> = {
  telegram: 4096,
  discord: 2000,
  slack: 4000,
};

function findFenceLanguage(openLine: string): string {
  const match = openLine.match(/^```([A-Za-z0-9_+-]*)/);
  return match?.[1] ?? "";
}

/**
 * Divide uma mensagem longa respeitando o limite de caracteres da plataforma e
 * preservando blocos de código Markdown (```` ``` ````) fechados/reabertos entre partes.
 */
export function chunkMessageText(
  text: string,
  platformOrLimit: MessagingPlatform | number,
): string[] {
  const rawLimit =
    typeof platformOrLimit === "number"
      ? platformOrLimit
      : PLATFORM_MESSAGE_LIMITS[platformOrLimit] ?? 2000;
  const maxLen = Math.max(80, rawLimit);
  const input = String(text ?? "").replace(/\r\n/g, "\n");
  if (!input.trim()) return [];
  if (input.length <= maxLen) return [input];

  const lines = input.split("\n");
  const chunks: string[] = [];
  let buffer = "";
  let activeFenceLang: string | null = null;

  const flush = (closeFence: boolean) => {
    let out = buffer.replace(/\n+$/, "");
    if (closeFence && activeFenceLang !== null && !out.endsWith("```")) {
      out = out ? `${out}\n\`\`\`` : "```";
    }
    if (out.length > 0) {
      chunks.push(out);
    }
    buffer = closeFence && activeFenceLang !== null ? `\`\`\`${activeFenceLang}\n` : "";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const isFence = trimmed.startsWith("```");
    const candidateLine = buffer.length > 0 && !buffer.endsWith("\n") ? `\n${line}` : line;
    const reserveClose = activeFenceLang !== null ? 5 : 0;

    if (buffer.length + candidateLine.length + reserveClose > maxLen) {
      if (buffer.trim().length > 0) {
        flush(true);
      }

      const prefix = buffer;
      const effectiveMax = Math.max(32, maxLen - prefix.length - (activeFenceLang !== null ? 5 : 0));
      if (line.length > effectiveMax) {
        let offset = 0;
        while (offset < line.length) {
          const slice = line.slice(offset, offset + effectiveMax);
          buffer = `${prefix}${slice}`;
          const moreRemaining = offset + effectiveMax < line.length;
          if (moreRemaining) {
            flush(true);
          }
          offset += effectiveMax;
        }
        if (isFence) {
          activeFenceLang = activeFenceLang === null ? findFenceLanguage(trimmed) : null;
        }
        continue;
      }
    }

    buffer =
      buffer.length > 0 && !buffer.endsWith("\n") ? `${buffer}\n${line}` : `${buffer}${line}`;
    if (isFence) {
      activeFenceLang = activeFenceLang === null ? findFenceLanguage(trimmed) : null;
    }
  }

  if (buffer.trim().length > 0 && buffer !== "```" && !/^```[A-Za-z0-9_+-]*\n?$/.test(buffer)) {
    flush(true);
  }

  return chunks;
}
