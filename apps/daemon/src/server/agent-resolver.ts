import type { CriativoDatabase } from "../database/client.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";

export interface ResolvableAgentRecord {
  agente_id: string;
  nome?: string | null;
}

export interface AgentAliasSummary {
  agente_id: string;
  nome: string;
  apelido: string;
  papel: string;
  modelo_padrao: string;
  status: string;
}

/**
 * Normaliza um apelido/ID/nome de agente removendo `@`, acentos e convertendo separadores em `_`.
 */
export function normalizeAgentSlug(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Deriva um apelido legível (sem acentos e minúsculo) a partir do nome ou do ID do agente.
 */
export function deriveAgentAlias(agenteId: string, nome?: string | null): string {
  const fromName = typeof nome === "string" ? normalizeAgentSlug(nome) : "";
  if (fromName) return fromName;
  const fromCustom = agenteId.match(/^custom_(.+?)_[a-f0-9]{4,}$/i);
  if (fromCustom?.[1]) {
    return normalizeAgentSlug(fromCustom[1]) || agenteId;
  }
  return normalizeAgentSlug(agenteId) || agenteId;
}

/**
 * Resolve uma referência textual (`agente_id`, `@apelido`, nome completo ou prefixo único)
 * para um registro de agente de forma determinística.
 */
export function resolveAgentRecord<T extends ResolvableAgentRecord>(
  agents: readonly T[],
  rawRef: string,
): T | null {
  const trimmed = String(rawRef ?? "").trim();
  if (!trimmed) return null;
  const cleanId = trimmed.replace(/^@+/, "");
  const cleanLower = cleanId.toLowerCase();

  // 1. Correspondência exata por agente_id (case-insensitive)
  const exactId = agents.find((a) => a.agente_id.toLowerCase() === cleanLower);
  if (exactId) return exactId;

  const slug = normalizeAgentSlug(trimmed);
  if (!slug) return null;

  // 2. Correspondência exata por nome normalizado
  const exactName = agents.find(
    (a) => typeof a.nome === "string" && normalizeAgentSlug(a.nome) === slug,
  );
  if (exactName) return exactName;

  // 3. Correspondência exata por slug do ID ou padrão `custom_<slug>_*`
  const exactSlugId = agents.find((a) => normalizeAgentSlug(a.agente_id) === slug);
  if (exactSlugId) return exactSlugId;

  const customMatches = agents.filter((a) =>
    a.agente_id.toLowerCase().startsWith(`custom_${slug}_`),
  );
  if (customMatches.length === 1) return customMatches[0]!;

  // 4. Correspondência única por prefixo do nome normalizado ou primeiro termo único do nome
  const namePrefixMatches = agents.filter((a) => {
    if (typeof a.nome !== "string") return false;
    const ns = normalizeAgentSlug(a.nome);
    return ns === slug || ns.startsWith(`${slug}_`);
  });
  if (namePrefixMatches.length === 1) {
    return namePrefixMatches[0]!;
  }

  return null;
}

/**
 * Resolve o `agente_id` canônico no banco (`projecao_agentes`) aceitando ID, `@apelido` ou nome.
 */
export function resolveAgentIdFromDb(db: CriativoDatabase, rawRef: string): string | null {
  const trimmed = String(rawRef ?? "").trim();
  if (!trimmed) return null;

  let rows: Array<{ agente_id: string; nome: string }> = [];
  try {
    rows = db.connection
      .prepare("SELECT agente_id, nome FROM projecao_agentes ORDER BY ordem_exibicao ASC;")
      .all() as Array<{ agente_id: string; nome: string }>;
  } catch {
    rows = [];
  }

  const fromDb = resolveAgentRecord(rows, trimmed);
  if (fromDb) return fromDb.agente_id;

  const fromRoster = resolveAgentRecord(ROSTER_15_AGENTES, trimmed);
  return fromRoster?.agente_id ?? null;
}

/**
 * Lista todos os agentes ativos do estúdio com seus respectivos `@apelidos` derivados.
 */
export function listAgentsWithAliases(db: CriativoDatabase): AgentAliasSummary[] {
  let rows: Array<{
    agente_id: string;
    nome: string;
    papel: string;
    modelo_padrao: string;
    status: string;
  }> = [];
  try {
    rows = db.connection
      .prepare(
        `SELECT agente_id, nome, papel, modelo_padrao, status
         FROM projecao_agentes
         ORDER BY ordem_exibicao ASC, nome ASC;`,
      )
      .all() as typeof rows;
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return ROSTER_15_AGENTES.map((a) => ({
      agente_id: a.agente_id,
      nome: a.nome,
      apelido: deriveAgentAlias(a.agente_id, a.nome),
      papel: a.papel,
      modelo_padrao: a.modelo_padrao,
      status: "ocioso",
    }));
  }

  return rows.map((r) => ({
    agente_id: r.agente_id,
    nome: r.nome,
    apelido: deriveAgentAlias(r.agente_id, r.nome),
    papel: r.papel,
    modelo_padrao: r.modelo_padrao,
    status: r.status,
  }));
}
