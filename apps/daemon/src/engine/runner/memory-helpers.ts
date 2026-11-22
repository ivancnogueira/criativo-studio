import type {
  AgenteMemoria as AgenteMemoriaContrato,
  MemoriaInclusao,
} from "@criativo/contracts";

export const AGENT_MEMORY_CONTEXT_BUDGET_BYTES = 8192;
export const DEFAULT_AGENT_MEMORY_LIMIT = 250;

export type AgenteMemoria = AgenteMemoriaContrato;

export interface MemoriaRow {
  memoria_id: string;
  agente_id: string;
  texto: string;
  categoria: MemoriaInclusao | null;
  escopo_site: string | null;
  normalized_text: string | null;
  origem: "automatica" | "manual";
  source_turn_id: string | null;
  controlado_usuario: number | null;
  revisao: number | null;
  criado_em: string;
  atualizado_em: string | null;
}

export interface PendingMemoryOp {
  action: "remember" | "forget";
  memoriaId?: string;
  texto?: string;
  categoria?: MemoriaInclusao;
  escopoSite?: string | null;
}

/**
 * Normaliza domínio de escopo opcional `site` extraindo o hostname minúsculo sem `www.` (até 255 chars).
 */
export function normalizeMemorySite(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let host = trimmed.toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      host = new URL(trimmed).hostname.toLowerCase();
    } else {
      host = new URL(`https://${trimmed}`).hostname.toLowerCase();
    }
  } catch {
    host = trimmed
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .split(/[/?#]/)[0]!
      .split(":")[0]!;
  }

  host = host.replace(/^www\./, "").replace(/\.+$/, "").trim();
  if (!host || host.length > 255 || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) {
    return null;
  }
  return host;
}

export function normalizeMemoryTextKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeForTokenSearch(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function serializeEssentialBlock(items: Array<{ texto: string; escopo_site: string | null }>): string {
  if (items.length === 0) {
    return `<agent_memories count="0"></agent_memories>`;
  }
  const lines = items.map((m) =>
    m.escopo_site ? `- [site:${m.escopo_site}] ${m.texto}` : `- ${m.texto}`,
  );
  return `<agent_memories count="${items.length}">\n${lines.join("\n")}\n</agent_memories>`;
}

/**
 * Gerenciador avançado de memórias de longo prazo por agente em `projecao_agente_memorias` + `agente_memorias_fts`.
 */

export interface MemoryManagerDeps {
  db: import("../../database/client.ts").CriativoDatabase;
  epochByAgent: Map<string, number>;
  pendingMutationsByTurn: Map<string, { agenteId: string; epoch: number; ops: PendingMemoryOp[] }>;
  mapRow: (row: MemoriaRow) => AgenteMemoria;
  syncFtsEntry: (memoriaId: string, agenteId: string, texto: string | null) => void;
  refreshAgentSummaryColumn: (agenteId: string, agora: string) => void;
  computeEssentialBytes: (
    agenteId: string,
    extraItems?: Array<{ texto: string; escopo_site: string | null }>,
    excludeIds?: Set<string>,
  ) => number;
  getConfiguredMemoryLimit: () => number;
  getAgentEpoch: (agenteId: string) => number;
  bumpAgentEpoch: (agenteId: string) => number;
}

export type TailArgs<F> = F extends (deps: MemoryManagerDeps, ...args: infer A) => unknown ? A : never;

