import type { ConversationMessage, MensagemChat } from "@criativo/contracts";

export interface HandoffHistoryBuildResult {
  messages: ConversationMessage[];
  handoffNotice: string;
  compactedCount: number;
}

function summarizeToolResult(content: string): string {
  const clean = String(content ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 280) return clean;
  return `${clean.slice(0, 277)}...`;
}

/**
 * Normaliza e sintetiza o histórico recente ao alternar entre provedores/modelos distintos
 * (Claude, Gemini, OpenAI, Grok, OpenCode, Ollama), evitando falhas de formato incompatível
 * entre tool calls proprietários e preservando decisões e artefatos.
 */
export function buildPortableHandoffHistory(
  messages: ConversationMessage[],
  fromModel: string,
  toModel: string,
  maxMessages = 16
): HandoffHistoryBuildResult {
  const normalized: ConversationMessage[] = [];
  const toolOutcomes: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      continue;
    }

    if (msg.role === "tool") {
      const summary = `[Resultado ${msg.toolName ?? "ferramenta"}]: ${summarizeToolResult(msg.content)}`;
      toolOutcomes.push(summary);
      // Converte retorno de tool para turno de contexto portátil sem exigir `toolCallId` proprietário
      const last = normalized[normalized.length - 1];
      if (last && last.role === "user") {
        last.content = `${last.content}\n${summary}`;
      } else {
        normalized.push({ role: "user", content: summary });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const callNotes =
        Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
          ? `\n[Ações solicitadas anteriormente: ${msg.toolCalls
              .map((c) => `${c.name}(${JSON.stringify(c.arguments ?? {}).slice(0, 120)})`)
              .join(", ")}]`
          : "";
      const text = `${msg.content ?? ""}${callNotes}`.trim();
      if (!text) continue;
      const prev = normalized[normalized.length - 1];
      if (prev && prev.role === "assistant") {
        prev.content = `${prev.content}\n\n${text}`;
      } else {
        normalized.push({ role: "assistant", content: text });
      }
      continue;
    }

    const userText = String(msg.content ?? "").trim();
    if (!userText) continue;
    const prev = normalized[normalized.length - 1];
    if (prev && prev.role === "user") {
      prev.content = `${prev.content}\n\n${userText}`;
    } else {
      normalized.push({ role: "user", content: userText });
    }
  }

  let compactedCount = 0;
  let finalMessages = normalized;
  if (normalized.length > maxMessages) {
    compactedCount = normalized.length - maxMessages;
    const dropped = normalized.slice(0, compactedCount);
    const kept = normalized.slice(compactedCount);
    const digest = dropped
      .slice(-4)
      .map((m) => `- ${m.role === "user" ? "Pedido" : "Resposta"}: ${m.content.replace(/\s+/g, " ").slice(0, 140)}`)
      .join("\n");
    finalMessages = [
      {
        role: "user",
        content: `[Resumo portátil do contexto anterior transferido de ${fromModel} → ${toModel}]:\n${digest}`,
      },
      ...kept,
    ];
  }

  const handoffNotice =
    `Transferência de contexto de ${fromModel} para ${toModel}: ${finalMessages.length} turnos normalizados` +
    (toolOutcomes.length > 0 ? ` (${toolOutcomes.length} execuções de ferramentas sintetizadas).` : ".");

  return {
    messages: finalMessages,
    handoffNotice,
    compactedCount,
  };
}

/**
 * Converte mensagens visuais do chat (`MensagemChat[]`) em resumo portátil para failover.
 */
export function buildPortableChatMessages(
  history: MensagemChat[],
  fromModel: string,
  toModel: string,
  maxItems = 12
): HandoffHistoryBuildResult {
  const conv: ConversationMessage[] = history.map((m) => ({
    role: m.autor === "agente" ? "assistant" : "user",
    content: String(m.conteudo_markdown ?? ""),
  }));
  return buildPortableHandoffHistory(conv, fromModel, toModel, maxItems);
}
