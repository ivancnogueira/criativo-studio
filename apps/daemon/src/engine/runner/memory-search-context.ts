
import { type MemoryManagerDeps, AGENT_MEMORY_CONTEXT_BUDGET_BYTES, type AgenteMemoria, type MemoriaRow, normalizeMemorySite, normalizeForTokenSearch, serializeEssentialBlock } from "./memory-helpers.ts";
import { listMemoriesOp } from "./memory-turn-ops.ts";

export function getEssentialContextSnapshotOp(deps: MemoryManagerDeps, agenteId: string,
    site?: string | null,): {
  memorias: AgenteMemoria[];
  contextBlock: string;
  usedBytes: number;
  budgetBytes: number;
} {
  const cleanSite = normalizeMemorySite(site);
  const rows = (
    cleanSite
      ? deps.db.connection
          .prepare(
            `SELECT * FROM projecao_agente_memorias
             WHERE agente_id = ? AND categoria = 'essential'
               AND (escopo_site IS NULL OR escopo_site = ?)
             ORDER BY criado_em ASC;`,
          )
          .all(agenteId, cleanSite)
      : deps.db.connection
          .prepare(
            `SELECT * FROM projecao_agente_memorias
             WHERE agente_id = ? AND categoria = 'essential'
               AND escopo_site IS NULL
             ORDER BY criado_em ASC;`,
          )
          .all(agenteId)
  ) as unknown as MemoriaRow[];

  const fitted: AgenteMemoria[] = [];
  for (const r of rows) {
    const mapped = deps.mapRow(r);
    const candidateBlock = serializeEssentialBlock(
      [...fitted, mapped].map((m) => ({ texto: m.texto, escopo_site: m.escopo_site })),
    );
    if (Buffer.byteLength(candidateBlock, "utf8") > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
      break;
    }
    fitted.push(mapped);
  }

  const contextBlock =
    fitted.length > 0
      ? serializeEssentialBlock(
          fitted.map((m) => ({ texto: m.texto, escopo_site: m.escopo_site })),
        )
      : "";
  const usedBytes = contextBlock ? Buffer.byteLength(contextBlock, "utf8") : 0;

  return {
    memorias: fitted,
    contextBlock,
    usedBytes,
    budgetBytes: AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
  };
}

export function searchMemoriesSqlFallbackOp(deps: MemoryManagerDeps, agenteId: string,
    query: string,
    rawTerms: string[],
    cleanSite: string | null,
    limit: number,): MemoriaRow[] {
  const candidates = (
    cleanSite
      ? deps.db.connection
          .prepare(
            `SELECT * FROM projecao_agente_memorias
             WHERE agente_id = ? AND (escopo_site IS NULL OR escopo_site = ?)
             ORDER BY COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
             LIMIT 1000;`,
          )
          .all(agenteId, cleanSite)
      : deps.db.connection
          .prepare(
            `SELECT * FROM projecao_agente_memorias
             WHERE agente_id = ?
             ORDER BY COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
             LIMIT 1000;`,
          )
          .all(agenteId)
  ) as unknown as MemoriaRow[];

  const normQuery = normalizeForTokenSearch(query.trim());
  const normTerms = rawTerms.map((t) => normalizeForTokenSearch(t)).filter((t) => t.length >= 2);
  if (!normQuery && normTerms.length === 0) return [];

  const scored: Array<{ row: MemoriaRow; score: number }> = [];
  for (const row of candidates) {
    const normText = normalizeForTokenSearch(row.texto);
    const words = normText.split(/[^a-z0-9_]+/).filter(Boolean);
    let score = 0;

    for (const term of normTerms) {
      if (words.includes(term)) {
        score += 3;
      } else if (term.length >= 6 && words.some((w) => w.startsWith(term))) {
        score += 2;
      } else if (normText.includes(term)) {
        score += 1;
      }
    }

    if (normQuery.length >= 2 && normText.includes(normQuery)) {
      score += 4;
    }

    if (score > 0) {
      scored.push({ row, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bTime = b.row.atualizado_em || b.row.criado_em;
    const aTime = a.row.atualizado_em || a.row.criado_em;
    return bTime.localeCompare(aTime);
  });

  return scored.slice(0, limit).map((item) => item.row);
}

/**
 * Busca memórias via FTS5 BM25 com prefix matching para termos >= 6 caracteres e teto de 8.192 bytes.
 * Quando o runtime SQLite não dispõe de FTS5, utiliza pontuação SQL/tokenizada compatível.
 */
export function searchMemoriesFtsOp(deps: MemoryManagerDeps, agenteId: string,
    query: string,
    options?: {
      limit?: number;
      site?: string | null;
      redact?: (s: string) => string;
    },): AgenteMemoria[] {
  const limit = Math.min(Math.max(1, options?.limit ?? 15), 50);
  const cleanSite = normalizeMemorySite(options?.site);
  const redactFn = options?.redact ?? ((s: string) => s);

  const rawTerms = query
    .trim()
    .split(/[\s,.;:!?()[\]{}"'`/\\+-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  let matchedRows: MemoriaRow[] = [];

  if (rawTerms.length > 0 && deps.db.hasFts5MemoriesTable()) {
    const ftsExpr = rawTerms
      .map((term) => {
        const safe = term.replace(/"/g, '""');
        return term.length >= 6 ? `"${safe}"*` : `"${safe}"`;
      })
      .join(" OR ");

    try {
      matchedRows = (
        cleanSite
          ? deps.db.connection
              .prepare(
                `SELECT m.*
                 FROM agente_memorias_fts f
                 JOIN projecao_agente_memorias m ON m.memoria_id = f.memoria_id
                 WHERE agente_memorias_fts MATCH ?
                   AND m.agente_id = ?
                   AND (m.escopo_site IS NULL OR m.escopo_site = ?)
                 ORDER BY bm25(agente_memorias_fts) ASC
                 LIMIT ?;`,
              )
              .all(ftsExpr, agenteId, cleanSite, limit)
          : deps.db.connection
              .prepare(
                `SELECT m.*
                 FROM agente_memorias_fts f
                 JOIN projecao_agente_memorias m ON m.memoria_id = f.memoria_id
                 WHERE agente_memorias_fts MATCH ?
                   AND m.agente_id = ?
                 ORDER BY bm25(agente_memorias_fts) ASC
                 LIMIT ?;`,
              )
              .all(ftsExpr, agenteId, limit)
      ) as unknown as MemoriaRow[];
    } catch {
      matchedRows = [];
    }
  }

  if (matchedRows.length === 0 && query.trim().length > 0) {
    matchedRows = searchMemoriesSqlFallbackOp(deps, agenteId, query, rawTerms, cleanSite, limit);
  }

  const bounded: AgenteMemoria[] = [];
  let accBytes = 0;
  for (const r of matchedRows) {
    const mapped = deps.mapRow(r);
    const redacted: AgenteMemoria = { ...mapped, texto: redactFn(mapped.texto) };
    const itemBytes = Buffer.byteLength(redacted.texto, "utf8") + 64;
    if (bounded.length > 0 && accBytes + itemBytes > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
      break;
    }
    accBytes += itemBytes;
    bounded.push(redacted);
  }

  return bounded;
}

