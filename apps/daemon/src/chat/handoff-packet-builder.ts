export const MAX_HANDOFF_PACKET_CHARS = 32_000;

const COMPARTMENT_RECENT_CHARS = 24_000;
const COMPARTMENT_OLDER_CHARS = 4_000;
const COMPARTMENT_STEPS_CHARS = 2_000;
const COMPARTMENT_INSTRUCTIONS_CHARS = 2_000;

export interface HandoffMessageEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface HandoffWorkStepEntry {
  tool?: string;
  title: string;
  status?: string;
}

export interface BuildHandoffPacketInput {
  messages?: HandoffMessageEntry[];
  workSteps?: HandoffWorkStepEntry[];
  instructions?: string[];
  redactSecrets?: string[];
  maxChars?: number;
}

function redactSecretsFromText(text: string, secrets?: string[]): string {
  if (!text || !Array.isArray(secrets) || secrets.length === 0) return text;
  let out = text;
  for (const raw of secrets) {
    const clean = typeof raw === "string" ? raw.trim() : "";
    if (clean.length >= 6 && out.includes(clean)) {
      out = out.split(clean).join("[SEGREDO_OCULTADO]");
    }
  }
  return out;
}

/**
 * Preserva início e fim de textos extensos para nunca perder contexto de abertura nem a instrução final.
 */
function truncateKeepingEdges(text: string, limit: number): string {
  const clean = text.trim();
  if (limit <= 0) return "";
  if (clean.length <= limit) return clean;
  if (limit < 80) return clean.slice(0, limit);
  const marker = "\n[... trecho omitido na compactação ...]\n";
  const usable = Math.max(20, limit - marker.length);
  const headLen = Math.ceil(usable * 0.45);
  const tailLen = Math.max(0, usable - headLen);
  return `${clean.slice(0, headLen)}${marker}${clean.slice(clean.length - tailLen)}`;
}

function fitLinesInBudget(lines: string[], budget: number): string {
  if (budget <= 0 || lines.length === 0) return "";
  const joined = lines.join("\n");
  if (joined.length <= budget) return joined;
  return truncateKeepingEdges(joined, budget);
}

/**
 * Constrói pacote determinístico de handoff limitado a 32.000 caracteres:
 * 24k recentes + 4k trechos anteriores + 2k passos + 2k instruções/memórias,
 * reaproveitando espaço ocioso de outros compartimentos para as mensagens recentes.
 */
export function buildDeterministicHandoffPacket(input: BuildHandoffPacketInput): string {
  const hardLimit = Math.max(
    1_000,
    Math.min(MAX_HANDOFF_PACKET_CHARS, input.maxChars ?? MAX_HANDOFF_PACKET_CHARS)
  );
  const allMessages = (input.messages ?? []).filter((m) => m.content && m.content.trim().length > 0);
  const recentSlice = allMessages.slice(-8);
  const olderSlice = allMessages.slice(0, Math.max(0, allMessages.length - 8));

  const formatMsg = (m: HandoffMessageEntry) =>
    `${m.role === "user" ? "Usuário" : m.role === "assistant" ? "Assistente" : "Sistema"}: ${redactSecretsFromText(m.content, input.redactSecrets).replace(/\s+/g, " ").trim()}`;

  const rawInstructionsLines = (input.instructions ?? [])
    .map((s) => redactSecretsFromText(s, input.redactSecrets).trim())
    .filter(Boolean)
    .map((s) => `- ${s}`);
  const instructionsText = fitLinesInBudget(rawInstructionsLines, COMPARTMENT_INSTRUCTIONS_CHARS);
  const instructionsSection = instructionsText
    ? `### Instruções e Memórias Essenciais\n${instructionsText}`
    : "";

  const rawStepsLines = (input.workSteps ?? [])
    .slice(-16)
    .map((s) => {
      const label = redactSecretsFromText(s.title || s.tool || "etapa", input.redactSecrets).trim();
      return `- [${s.status || "ok"}] ${s.tool ? `${s.tool}: ` : ""}${label.slice(0, 140)}`;
    });
  const stepsText = fitLinesInBudget(rawStepsLines, COMPARTMENT_STEPS_CHARS);
  const stepsSection = stepsText ? `### Ações e Ferramentas Recentes\n${stepsText}` : "";

  const olderLines = olderSlice.map(formatMsg);
  const olderText = fitLinesInBudget(olderLines, COMPARTMENT_OLDER_CHARS);
  const olderSection = olderText ? `### Trechos Anteriores Relevantes\n${olderText}` : "";

  const header = "## Resumo Estruturado de Compactação";
  const fixedSections = [header, instructionsSection, stepsSection, olderSection].filter(Boolean);
  const fixedText = fixedSections.join("\n\n");

  const sectionPrefix = recentSlice.length > 0 ? "\n\n### Mensagens Recentes\n" : "";
  const remainingBudget = Math.max(
    0,
    hardLimit - fixedText.length - sectionPrefix.length
  );
  const recentBudget = Math.max(
    Math.min(COMPARTMENT_RECENT_CHARS, remainingBudget),
    remainingBudget
  );

  let recentBody = "";
  if (recentSlice.length > 0 && recentBudget > 0) {
    const formattedRecent = recentSlice.map(formatMsg);
    const selected: string[] = [];
    let used = 0;
    for (let idx = formattedRecent.length - 1; idx >= 0; idx -= 1) {
      const entry = formattedRecent[idx]!;
      const separatorLen = selected.length > 0 ? 1 : 0;
      if (used + entry.length + separatorLen <= recentBudget) {
        selected.unshift(entry);
        used += entry.length + separatorLen;
      } else {
        const roomLeft = recentBudget - used - separatorLen;
        if (roomLeft >= 120) {
          selected.unshift(truncateKeepingEdges(entry, roomLeft));
        }
        break;
      }
    }
    recentBody = selected.join("\n");
  }

  const combined = recentBody
    ? `${fixedText}${sectionPrefix}${recentBody}`
    : fixedText;

  return combined.length <= hardLimit ? combined : combined.slice(0, hardLimit);
}
