import type { CriativoDatabase } from "../database/client.ts";
import { resolveAgentIdFromDb, resolveAgentRecord } from "../server/agent-resolver.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";

export interface MentionRouteResult {
  agentId: string;
  mentionedAlias?: string;
  cleanedText: string;
  usedFallback: boolean;
}

const DEFAULT_ORCHESTRATOR_ID = "orquestrador_estrategista";

/**
 * Detecta menção explícita (`@agente` ou `/agente`) no início ou corpo da mensagem,
 * resolvendo para o `agente_id` canônico e aplicando fallback ao orquestrador padrão.
 */
export function resolveMessagingMentionTarget(options: {
  text: string;
  db?: CriativoDatabase;
  defaultAgentId?: string;
}): MentionRouteResult {
  const raw = String(options.text ?? "").trim();
  const fallbackAgent = options.defaultAgentId?.trim() || DEFAULT_ORCHESTRATOR_ID;
  const match = raw.match(/(?:^|\s)@([a-zA-Z0-9À-ÿ._-]{2,48})\b/);
  if (!match?.[1]) {
    return {
      agentId: fallbackAgent,
      cleanedText: raw,
      usedFallback: true,
    };
  }

  const token = match[1];
  const resolved = options.db
    ? resolveAgentIdFromDb(options.db, token)
    : resolveAgentRecord(ROSTER_15_AGENTES, token)?.agente_id ?? null;

  if (!resolved) {
    return {
      agentId: fallbackAgent,
      cleanedText: raw,
      usedFallback: true,
    };
  }

  const cleanedText = raw
    .replace(match[0], match[0].startsWith(" ") ? " " : "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    agentId: resolved,
    mentionedAlias: token,
    cleanedText: cleanedText || raw,
    usedFallback: false,
  };
}
