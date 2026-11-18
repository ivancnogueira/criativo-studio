import { randomUUID } from "node:crypto";
import type {
  AgenteMemoria as AgenteMemoriaContrato,
  AgenteMemoriasSnapshot,
  MemoriaInclusao,
  MemoryReviewAlteracao,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";

export const AGENT_MEMORY_CONTEXT_BUDGET_BYTES = 8192;
export const DEFAULT_AGENT_MEMORY_LIMIT = 250;

export type AgenteMemoria = AgenteMemoriaContrato;

interface MemoriaRow {
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

function normalizeMemoryTextKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function serializeEssentialBlock(items: Array<{ texto: string; escopo_site: string | null }>): string {
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
export class MemoryManager {
  private readonly db: CriativoDatabase;
  private readonly epochByAgent = new Map<string, number>();
  private readonly pendingMutationsByTurn = new Map<
    string,
    { agenteId: string; epoch: number; ops: PendingMemoryOp[] }
  >();

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private mapRow(row: MemoriaRow): AgenteMemoria {
    return {
      memoria_id: row.memoria_id,
      agente_id: row.agente_id,
      texto: row.texto,
      categoria: row.categoria === "essential" ? "essential" : "searchable",
      escopo_site: row.escopo_site ?? null,
      origem: row.origem === "manual" ? "manual" : "automatica",
      controlado_usuario: Boolean(row.controlado_usuario) || row.origem === "manual",
      revisao: typeof row.revisao === "number" && row.revisao > 0 ? row.revisao : 1,
      criado_em: row.criado_em,
      atualizado_em:
        row.atualizado_em && row.atualizado_em.length > 0 ? row.atualizado_em : row.criado_em,
    };
  }

  public getAgentEpoch(agenteId: string): number {
    return this.epochByAgent.get(agenteId) ?? 0;
  }

  public bumpAgentEpoch(agenteId: string): number {
    const next = this.getAgentEpoch(agenteId) + 1;
    this.epochByAgent.set(agenteId, next);
    return next;
  }

  private syncFtsEntry(memoriaId: string, agenteId: string, texto: string | null): void {
    this.db.connection
      .prepare("DELETE FROM agente_memorias_fts WHERE memoria_id = ?;")
      .run(memoriaId);
    if (texto !== null) {
      this.db.connection
        .prepare("INSERT INTO agente_memorias_fts (texto, memoria_id, agente_id) VALUES (?, ?, ?);")
        .run(texto, memoriaId, agenteId);
    }
  }

  private refreshAgentSummaryColumn(agenteId: string, agora: string): void {
    const recentRows = this.db.connection
      .prepare(
        `SELECT texto FROM projecao_agente_memorias
         WHERE agente_id = ?
         ORDER BY CASE WHEN categoria = 'essential' THEN 0 ELSE 1 END ASC,
                  COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
         LIMIT 5;`,
      )
      .all(agenteId) as Array<{ texto: string }>;

    const recent = recentRows.map((m) => m.texto).join(" | ");
    this.db.connection
      .prepare(
        "UPDATE projecao_agentes SET memoria_resumo = ?, atualizado_em = ? WHERE agente_id = ?;",
      )
      .run(recent ? recent.slice(0, 500) : null, agora, agenteId);
  }

  public computeEssentialBytes(
    agenteId: string,
    extraItems: Array<{ texto: string; escopo_site: string | null }> = [],
    excludeIds = new Set<string>(),
  ): number {
    const rows = this.db.connection
      .prepare(
        `SELECT memoria_id, texto, escopo_site
         FROM projecao_agente_memorias
         WHERE agente_id = ? AND categoria = 'essential'
         ORDER BY criado_em ASC;`,
      )
      .all(agenteId) as Array<{ memoria_id: string; texto: string; escopo_site: string | null }>;

    const filtered = rows
      .filter((r) => !excludeIds.has(r.memoria_id))
      .map((r) => ({ texto: r.texto, escopo_site: r.escopo_site }));

    const block = serializeEssentialBlock([...filtered, ...extraItems]);
    return Buffer.byteLength(block, "utf8");
  }

  public getConfiguredMemoryLimit(): number {
    try {
      const row = this.db.connection
        .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = 'memory_limit' LIMIT 1;")
        .get() as { valor_json?: string } | undefined;
      if (row?.valor_json) {
        const parsed = Number(JSON.parse(row.valor_json));
        if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 5000) {
          return Math.floor(parsed);
        }
      }
    } catch {
      // ignora fallback
    }
    return DEFAULT_AGENT_MEMORY_LIMIT;
  }

  /**
   * Adiciona memória diretamente (retrocompatível com Fases 3–13).
   * Quando `origem === 'manual'`, marca `controlado_usuario = 1` e incrementa epoch.
   */
  public addMemory(
    agenteId: string,
    texto: string,
    origem: "automatica" | "manual" = "automatica",
    opts?: {
      categoria?: MemoriaInclusao;
      escopoSite?: string | null;
      sourceTurnId?: string | null;
    },
  ): (AgenteMemoria & { downgradedToSearchable?: boolean }) | null {
    const cleanText = texto.trim();
    if (!cleanText) return null;

    const normalized = normalizeMemoryTextKey(cleanText);
    const site = normalizeMemorySite(opts?.escopoSite);
    const requestedCat: MemoriaInclusao =
      opts?.categoria ?? (origem === "manual" ? "essential" : "searchable");
    const isUserControlled = origem === "manual" ? 1 : 0;
    const agora = new Date().toISOString();

    let downgradedToSearchable = false;
    let targetId = "";

    this.db.runInTransaction(() => {
      const existing = this.db.connection
        .prepare(
          `SELECT * FROM projecao_agente_memorias
           WHERE agente_id = ? AND (texto = ? OR normalized_text = ?)
           LIMIT 1;`,
        )
        .get(agenteId, cleanText, normalized) as MemoriaRow | undefined;

      if (existing) {
        targetId = existing.memoria_id;
        if (origem === "automatica" && (existing.controlado_usuario === 1 || existing.origem === "manual")) {
          return;
        }
        let nextCat = requestedCat;
        if (
          nextCat === "essential" &&
          this.computeEssentialBytes(
            agenteId,
            [{ texto: cleanText, escopo_site: site }],
            new Set([existing.memoria_id]),
          ) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES
        ) {
          nextCat = "searchable";
          downgradedToSearchable = true;
        }
        this.db.connection
          .prepare(
            `UPDATE projecao_agente_memorias
             SET texto = ?, normalized_text = ?, categoria = ?, escopo_site = COALESCE(?, escopo_site),
                 controlado_usuario = CASE WHEN ? = 1 THEN 1 ELSE controlado_usuario END,
                 origem = CASE WHEN ? = 'manual' THEN 'manual' ELSE origem END,
                 revisao = COALESCE(revisao, 1) + 1,
                 atualizado_em = ?
             WHERE memoria_id = ?;`,
          )
          .run(cleanText, normalized, nextCat, site, isUserControlled, origem, agora, existing.memoria_id);
        this.syncFtsEntry(existing.memoria_id, agenteId, cleanText);
      } else {
        targetId = randomUUID();
        let nextCat = requestedCat;
        if (
          nextCat === "essential" &&
          this.computeEssentialBytes(agenteId, [{ texto: cleanText, escopo_site: site }]) >
            AGENT_MEMORY_CONTEXT_BUDGET_BYTES
        ) {
          nextCat = "searchable";
          downgradedToSearchable = true;
        }
        this.db.connection
          .prepare(
            `INSERT INTO projecao_agente_memorias (
              memoria_id, agente_id, texto, origem, criado_em,
              categoria, escopo_site, normalized_text, source_turn_id,
              controlado_usuario, revisao, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
          )
          .run(
            targetId,
            agenteId,
            cleanText,
            origem,
            agora,
            nextCat,
            site,
            normalized,
            opts?.sourceTurnId ?? null,
            isUserControlled,
            agora,
          );
        this.syncFtsEntry(targetId, agenteId, cleanText);
      }

      this.refreshAgentSummaryColumn(agenteId, agora);
    });

    if (origem === "manual") {
      this.bumpAgentEpoch(agenteId);
    }

    const row = this.db.connection
      .prepare("SELECT * FROM projecao_agente_memorias WHERE memoria_id = ?;")
      .get(targetId) as MemoriaRow | undefined;
    if (!row) return null;

    return {
      ...this.mapRow(row),
      ...(downgradedToSearchable ? { downgradedToSearchable: true } : {}),
    };
  }

  public listMemories(agenteId: string, limit = 50): AgenteMemoria[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_agente_memorias
         WHERE agente_id = ?
         ORDER BY CASE WHEN categoria = 'essential' THEN 0 ELSE 1 END ASC,
                  COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
         LIMIT ?;`,
      )
      .all(agenteId, limit) as unknown as MemoriaRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getMemoriesSnapshot(agenteId: string): AgenteMemoriasSnapshot {
    const all = this.listMemories(agenteId, 1000);
    const essentials = all.filter((m) => m.categoria === "essential");
    const usedBytes =
      essentials.length === 0
        ? 0
        : Buffer.byteLength(
            serializeEssentialBlock(
              essentials.map((e) => ({ texto: e.texto, escopo_site: e.escopo_site })),
            ),
            "utf8",
          );
    return {
      memorias: all,
      usedBytes,
      budgetBytes: AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
      total: all.length,
      limit: this.getConfiguredMemoryLimit(),
    };
  }

  /**
   * Registra mutação de memória em staging vinculada ao `turnId` e ao `epoch` atual do agente.
   * Só é gravada no banco se `commitTurnMutations(turnId, "completed")` concluir sem mudança de epoch.
   */
  public stageTurnMutation(
    turnId: string,
    agenteId: string,
    op: PendingMemoryOp,
  ): { ok: boolean; staged: boolean; erro?: string } {
    if (op.action === "remember") {
      const clean = (op.texto ?? "").trim();
      if (!clean) {
        return { ok: false, staged: false, erro: "O texto da memória não pode ser vazio." };
      }
      const norm = normalizeMemoryTextKey(clean);
      const existing = this.db.connection
        .prepare(
          `SELECT * FROM projecao_agente_memorias
           WHERE agente_id = ? AND (memoria_id = ? OR normalized_text = ?)
           LIMIT 1;`,
        )
        .get(agenteId, op.memoriaId ?? "", norm) as MemoriaRow | undefined;

      if (existing && (existing.controlado_usuario === 1 || existing.origem === "manual")) {
        return {
          ok: false,
          staged: false,
          erro: "Esta memória é controlada manualmente pelo usuário e não pode ser sobrescrita automaticamente pelo agente.",
        };
      }
    } else {
      const target = op.memoriaId
        ? (this.db.connection
            .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
            .get(agenteId, op.memoriaId) as MemoriaRow | undefined)
        : op.texto
          ? (this.db.connection
              .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND normalized_text = ? LIMIT 1;")
              .get(agenteId, normalizeMemoryTextKey(op.texto)) as MemoriaRow | undefined)
          : undefined;

      if (!target) {
        return { ok: false, staged: false, erro: "Memória informada para esquecimento não foi encontrada." };
      }
      if (target.controlado_usuario === 1 || target.origem === "manual") {
        return {
          ok: false,
          staged: false,
          erro: "Esta memória foi definida manualmente pelo usuário e só pode ser removida pelo próprio usuário no painel do agente.",
        };
      }
    }

    let bucket = this.pendingMutationsByTurn.get(turnId);
    if (!bucket) {
      bucket = {
        agenteId,
        epoch: this.getAgentEpoch(agenteId),
        ops: [],
      };
      this.pendingMutationsByTurn.set(turnId, bucket);
    }
    bucket.ops.push(op);
    return { ok: true, staged: true };
  }

  public commitTurnMutations(
    turnId: string,
    outcome: "completed" | "failed" | "cancelled",
  ): {
    committed: boolean;
    discarded: boolean;
    downgradedCount: number;
    changes: MemoryReviewAlteracao[];
  } {
    const bucket = this.pendingMutationsByTurn.get(turnId);
    this.pendingMutationsByTurn.delete(turnId);
    if (!bucket || bucket.ops.length === 0) {
      return { committed: false, discarded: false, downgradedCount: 0, changes: [] };
    }

    if (outcome !== "completed" || this.getAgentEpoch(bucket.agenteId) !== bucket.epoch) {
      return { committed: false, discarded: true, downgradedCount: 0, changes: [] };
    }

    let downgradedCount = 0;
    const changes: MemoryReviewAlteracao[] = [];

    this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      for (const op of bucket.ops) {
        if (op.action === "remember" && op.texto) {
          const added = this.addMemory(bucket.agenteId, op.texto, "automatica", {
            categoria: op.categoria ?? "searchable",
            escopoSite: op.escopoSite ?? null,
            sourceTurnId: turnId,
          });
          if (added) {
            if (added.downgradedToSearchable) downgradedCount += 1;
            changes.push({
              memoria_id: added.memoria_id,
              acao: added.revisao > 1 ? "updated" : "saved",
              texto: added.texto,
              categoria: added.categoria,
              escopo_site: added.escopo_site,
            });
          }
        } else if (op.action === "forget") {
          const target = op.memoriaId
            ? (this.db.connection
                .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
                .get(bucket.agenteId, op.memoriaId) as MemoriaRow | undefined)
            : op.texto
              ? (this.db.connection
                  .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND normalized_text = ? LIMIT 1;")
                  .get(bucket.agenteId, normalizeMemoryTextKey(op.texto)) as MemoriaRow | undefined)
              : undefined;

          if (target && target.controlado_usuario !== 1 && target.origem !== "manual") {
            this.db.connection
              .prepare("DELETE FROM projecao_agente_memorias WHERE memoria_id = ?;")
              .run(target.memoria_id);
            this.syncFtsEntry(target.memoria_id, bucket.agenteId, null);
            changes.push({
              memoria_id: target.memoria_id,
              acao: "forgotten",
              texto: target.texto,
            });
          }
        }
      }
      this.refreshAgentSummaryColumn(bucket.agenteId, agora);
    });

    return { committed: true, discarded: false, downgradedCount, changes };
  }

  public getEssentialContextSnapshot(
    agenteId: string,
    site?: string | null,
  ): {
    memorias: AgenteMemoria[];
    contextBlock: string;
    usedBytes: number;
    budgetBytes: number;
  } {
    const cleanSite = normalizeMemorySite(site);
    const rows = (
      cleanSite
        ? this.db.connection
            .prepare(
              `SELECT * FROM projecao_agente_memorias
               WHERE agente_id = ? AND categoria = 'essential'
                 AND (escopo_site IS NULL OR escopo_site = ?)
               ORDER BY criado_em ASC;`,
            )
            .all(agenteId, cleanSite)
        : this.db.connection
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
      const mapped = this.mapRow(r);
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

  /**
   * Busca memórias via FTS5 BM25 com prefix matching para termos >= 6 caracteres e teto de 8.192 bytes.
   */
  public searchMemoriesFts(
    agenteId: string,
    query: string,
    options?: {
      limit?: number;
      site?: string | null;
      redact?: (s: string) => string;
    },
  ): AgenteMemoria[] {
    const limit = Math.min(Math.max(1, options?.limit ?? 15), 50);
    const cleanSite = normalizeMemorySite(options?.site);
    const redactFn = options?.redact ?? ((s: string) => s);

    const rawTerms = query
      .trim()
      .split(/[\s,.;:!?()[\]{}"'`/\\+-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    let matchedRows: MemoriaRow[] = [];

    if (rawTerms.length > 0) {
      const ftsExpr = rawTerms
        .map((term) => {
          const safe = term.replace(/"/g, '""');
          return term.length >= 6 ? `"${safe}"*` : `"${safe}"`;
        })
        .join(" OR ");

      try {
        matchedRows = (
          cleanSite
            ? this.db.connection
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
            : this.db.connection
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
      const likeTerm = `%${query.trim().toLowerCase()}%`;
      matchedRows = (
        cleanSite
          ? this.db.connection
              .prepare(
                `SELECT * FROM projecao_agente_memorias
                 WHERE agente_id = ? AND lower(texto) LIKE ?
                   AND (escopo_site IS NULL OR escopo_site = ?)
                 ORDER BY COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
                 LIMIT ?;`,
              )
              .all(agenteId, likeTerm, cleanSite, limit)
          : this.db.connection
              .prepare(
                `SELECT * FROM projecao_agente_memorias
                 WHERE agente_id = ? AND lower(texto) LIKE ?
                 ORDER BY COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
                 LIMIT ?;`,
              )
              .all(agenteId, likeTerm, limit)
      ) as unknown as MemoriaRow[];
    }

    const bounded: AgenteMemoria[] = [];
    let accBytes = 0;
    for (const r of matchedRows) {
      const mapped = this.mapRow(r);
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

  public listMemoriesPaginated(
    agenteId: string,
    filters?: {
      categoria?: MemoriaInclusao;
      site?: string | null;
      busca?: string;
      after?: string;
      limit?: number;
    },
  ): { items: AgenteMemoria[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(1, filters?.limit ?? 30), 100);
    const clauses: string[] = ["agente_id = ?"];
    const params: Array<string | number> = [agenteId];

    if (filters?.categoria) {
      clauses.push("categoria = ?");
      params.push(filters.categoria);
    }
    if (filters?.site) {
      const normSite = normalizeMemorySite(filters.site);
      if (normSite) {
        clauses.push("escopo_site = ?");
        params.push(normSite);
      }
    }
    if (filters?.busca?.trim()) {
      clauses.push("lower(texto) LIKE ?");
      params.push(`%${filters.busca.trim().toLowerCase()}%`);
    }
    if (filters?.after) {
      clauses.push("COALESCE(NULLIF(atualizado_em, ''), criado_em) < ?");
      params.push(filters.after);
    }

    const rows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_agente_memorias
         WHERE ${clauses.join(" AND ")}
         ORDER BY COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC, memoria_id DESC
         LIMIT ?;`,
      )
      .all(...params, limit + 1) as unknown as MemoriaRow[];

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map((r) => this.mapRow(r));
    const nextCursor = hasMore ? (items[items.length - 1]?.atualizado_em ?? null) : null;

    return { items, nextCursor };
  }

  public setMemoryInclusion(
    agenteId: string,
    changes: Array<{ memoriaId: string; categoria: MemoriaInclusao }>,
    byUser = false,
  ): AgenteMemoriasSnapshot {
    this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      for (const ch of changes) {
        const row = this.db.connection
          .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
          .get(agenteId, ch.memoriaId) as MemoriaRow | undefined;
        if (!row) continue;

        if (!byUser && (row.controlado_usuario === 1 || row.origem === "manual")) {
          throw new Error(
            `A memória '${ch.memoriaId}' é controlada manualmente pelo usuário e não pode ter sua categoria alterada automaticamente.`,
          );
        }

        if (ch.categoria === "essential" && row.categoria !== "essential") {
          const projected = this.computeEssentialBytes(
            agenteId,
            [{ texto: row.texto, escopo_site: row.escopo_site }],
            new Set([row.memoria_id]),
          );
          if (projected > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
            throw new Error(
              `Orçamento de memórias essenciais excedido (${projected}/${AGENT_MEMORY_CONTEXT_BUDGET_BYTES} bytes). Rebaixe memórias antigas para 'searchable' antes de promover esta.`,
            );
          }
        }

        this.db.connection
          .prepare(
            `UPDATE projecao_agente_memorias
             SET categoria = ?,
                 controlado_usuario = CASE WHEN ? = 1 THEN 1 ELSE controlado_usuario END,
                 revisao = COALESCE(revisao, 1) + 1,
                 atualizado_em = ?
             WHERE memoria_id = ?;`,
          )
          .run(ch.categoria, byUser ? 1 : 0, agora, row.memoria_id);
      }
      this.refreshAgentSummaryColumn(agenteId, agora);
    });

    if (byUser) {
      this.bumpAgentEpoch(agenteId);
    }
    return this.getMemoriesSnapshot(agenteId);
  }

  public updateManualMemory(
    agenteId: string,
    memoriaId: string,
    patch: {
      texto?: string;
      categoria?: MemoriaInclusao;
      escopo_site?: string | null;
    },
  ): AgenteMemoria {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
      .get(agenteId, memoriaId) as MemoriaRow | undefined;
    if (!existing) {
      throw new Error(`Memória '${memoriaId}' não encontrada.`);
    }

    const nextText = patch.texto !== undefined ? patch.texto.trim() : existing.texto;
    if (!nextText) {
      throw new Error("O texto da memória não pode ficar vazio.");
    }
    const nextCat: MemoriaInclusao =
      patch.categoria ?? (existing.categoria === "essential" ? "essential" : "searchable");
    const nextSite =
      patch.escopo_site !== undefined
        ? normalizeMemorySite(patch.escopo_site)
        : existing.escopo_site;

    if (nextCat === "essential") {
      const projected = this.computeEssentialBytes(
        agenteId,
        [{ texto: nextText, escopo_site: nextSite }],
        new Set([memoriaId]),
      );
      if (projected > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
        throw new Error(
          `Orçamento de memórias essenciais excedido (${projected}/${AGENT_MEMORY_CONTEXT_BUDGET_BYTES} bytes).`,
        );
      }
    }

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `UPDATE projecao_agente_memorias
           SET texto = ?, normalized_text = ?, categoria = ?, escopo_site = ?,
               origem = 'manual', controlado_usuario = 1,
               revisao = COALESCE(revisao, 1) + 1, atualizado_em = ?
           WHERE memoria_id = ?;`,
        )
        .run(nextText, normalizeMemoryTextKey(nextText), nextCat, nextSite, agora, memoriaId);
      this.syncFtsEntry(memoriaId, agenteId, nextText);
      this.refreshAgentSummaryColumn(agenteId, agora);
    });

    this.bumpAgentEpoch(agenteId);
    const updated = this.db.connection
      .prepare("SELECT * FROM projecao_agente_memorias WHERE memoria_id = ?;")
      .get(memoriaId) as unknown as MemoriaRow;
    return this.mapRow(updated);
  }

  public deleteMemory(agenteId: string, memoriaId: string, byUser = true): boolean {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
      .get(agenteId, memoriaId) as MemoriaRow | undefined;
    if (!existing) return false;

    if (!byUser && (existing.controlado_usuario === 1 || existing.origem === "manual")) {
      throw new Error(
        "Memória controlada pelo usuário não pode ser apagada automaticamente pelo agente.",
      );
    }

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare("DELETE FROM projecao_agente_memorias WHERE memoria_id = ?;")
        .run(memoriaId);
      this.syncFtsEntry(memoriaId, agenteId, null);
      this.refreshAgentSummaryColumn(agenteId, new Date().toISOString());
    });

    if (byUser) {
      this.bumpAgentEpoch(agenteId);
    }
    return true;
  }

  /**
   * Aplica operações geradas pelo `MemoryReviewService`, respeitando `controlado_usuario = 1`
   * e rebaixando automaticamente excessos de `8.192` bytes para `searchable`.
   */
  public applyReviewOperations(
    agenteId: string,
    turnId: string,
    ops: Array<{
      op: "save" | "update" | "forget";
      memoriaId?: string;
      texto?: string;
      categoria?: MemoriaInclusao;
      escopoSite?: string | null;
    }>,
  ): MemoryReviewAlteracao[] {
    const applied: MemoryReviewAlteracao[] = [];

    this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      for (const item of ops) {
        if (item.op === "forget") {
          const target = item.memoriaId
            ? (this.db.connection
                .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
                .get(agenteId, item.memoriaId) as MemoriaRow | undefined)
            : item.texto
              ? (this.db.connection
                  .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND normalized_text = ? LIMIT 1;")
                  .get(agenteId, normalizeMemoryTextKey(item.texto)) as MemoriaRow | undefined)
              : undefined;

          if (!target || target.controlado_usuario === 1 || target.origem === "manual") {
            continue;
          }
          this.db.connection
            .prepare("DELETE FROM projecao_agente_memorias WHERE memoria_id = ?;")
            .run(target.memoria_id);
          this.syncFtsEntry(target.memoria_id, agenteId, null);
          applied.push({
            memoria_id: target.memoria_id,
            acao: "forgotten",
            texto: target.texto,
          });
          continue;
        }

        const clean = (item.texto ?? "").trim();
        if (!clean) continue;

        if (item.op === "update" && item.memoriaId) {
          const target = this.db.connection
            .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
            .get(agenteId, item.memoriaId) as MemoriaRow | undefined;

          if (target) {
            if (target.controlado_usuario === 1 || target.origem === "manual") {
              continue;
            }
            const site = normalizeMemorySite(item.escopoSite) ?? target.escopo_site;
            let nextCat: MemoriaInclusao =
              item.categoria ?? (target.categoria === "essential" ? "essential" : "searchable");
            if (
              nextCat === "essential" &&
              this.computeEssentialBytes(
                agenteId,
                [{ texto: clean, escopo_site: site }],
                new Set([target.memoria_id]),
              ) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES
            ) {
              nextCat = "searchable";
            }

            this.db.connection
              .prepare(
                `UPDATE projecao_agente_memorias
                 SET texto = ?, normalized_text = ?, categoria = ?, escopo_site = ?,
                     source_turn_id = ?, revisao = COALESCE(revisao, 1) + 1, atualizado_em = ?
                 WHERE memoria_id = ?;`,
              )
              .run(clean, normalizeMemoryTextKey(clean), nextCat, site, turnId, agora, target.memoria_id);
            this.syncFtsEntry(target.memoria_id, agenteId, clean);
            applied.push({
              memoria_id: target.memoria_id,
              acao: "updated",
              texto: clean,
              categoria: nextCat,
              escopo_site: site,
            });
            continue;
          }
        }

        const saved = this.addMemory(agenteId, clean, "automatica", {
          categoria: item.categoria ?? "searchable",
          escopoSite: item.escopoSite ?? null,
          sourceTurnId: turnId,
        });
        if (saved) {
          applied.push({
            memoria_id: saved.memoria_id,
            acao: saved.revisao > 1 ? "updated" : "saved",
            texto: saved.texto,
            categoria: saved.categoria,
            escopo_site: saved.escopo_site,
          });
        }
      }
      this.refreshAgentSummaryColumn(agenteId, agora);
    });

    return applied;
  }
}
