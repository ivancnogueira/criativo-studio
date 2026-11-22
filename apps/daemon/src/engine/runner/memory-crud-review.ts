import type {
  AgenteMemoriasSnapshot,
  MemoriaInclusao,
  MemoryReviewAlteracao,
} from "@criativo/contracts";
import { type MemoryManagerDeps, AGENT_MEMORY_CONTEXT_BUDGET_BYTES, type AgenteMemoria, type MemoriaRow, normalizeMemorySite, normalizeMemoryTextKey } from "./memory-helpers.ts";
import { addMemoryOp, getMemoriesSnapshotOp } from "./memory-turn-ops.ts";

export function listMemoriesPaginatedOp(deps: MemoryManagerDeps, agenteId: string,
    filters?: {
      categoria?: MemoriaInclusao;
      site?: string | null;
      busca?: string;
      after?: string;
      limit?: number;
    },): { items: AgenteMemoria[]; nextCursor: string | null } {
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

  const rows = deps.db.connection
    .prepare(
      `SELECT * FROM projecao_agente_memorias
       WHERE ${clauses.join(" AND ")}
       ORDER BY COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC, memoria_id DESC
       LIMIT ?;`,
    )
    .all(...params, limit + 1) as unknown as MemoriaRow[];

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const items = sliced.map((r) => deps.mapRow(r));
  const nextCursor = hasMore ? (items[items.length - 1]?.atualizado_em ?? null) : null;

  return { items, nextCursor };
}

export function setMemoryInclusionOp(deps: MemoryManagerDeps, agenteId: string,
    changes: Array<{ memoriaId: string; categoria: MemoriaInclusao }>,
    byUser = false,): AgenteMemoriasSnapshot {
  deps.db.runInTransaction(() => {
    const agora = new Date().toISOString();
    for (const ch of changes) {
      const row = deps.db.connection
        .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
        .get(agenteId, ch.memoriaId) as MemoriaRow | undefined;
      if (!row) continue;

      if (!byUser && (row.controlado_usuario === 1 || row.origem === "manual")) {
        throw new Error(
          `A memória '${ch.memoriaId}' é controlada manualmente pelo usuário e não pode ter sua categoria alterada automaticamente.`,
        );
      }

      if (ch.categoria === "essential" && row.categoria !== "essential") {
        const projected = deps.computeEssentialBytes(
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

      deps.db.connection
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
    deps.refreshAgentSummaryColumn(agenteId, agora);
  });

  if (byUser) {
    deps.bumpAgentEpoch(agenteId);
  }
  return getMemoriesSnapshotOp(deps, agenteId);
}

export function updateManualMemoryOp(deps: MemoryManagerDeps, agenteId: string,
    memoriaId: string,
    patch: {
      texto?: string;
      categoria?: MemoriaInclusao;
      escopo_site?: string | null;
    },): AgenteMemoria {
  const existing = deps.db.connection
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
    const projected = deps.computeEssentialBytes(
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
  deps.db.runInTransaction(() => {
    deps.db.connection
      .prepare(
        `UPDATE projecao_agente_memorias
         SET texto = ?, normalized_text = ?, categoria = ?, escopo_site = ?,
             origem = 'manual', controlado_usuario = 1,
             revisao = COALESCE(revisao, 1) + 1, atualizado_em = ?
         WHERE memoria_id = ?;`,
      )
      .run(nextText, normalizeMemoryTextKey(nextText), nextCat, nextSite, agora, memoriaId);
    deps.syncFtsEntry(memoriaId, agenteId, nextText);
    deps.refreshAgentSummaryColumn(agenteId, agora);
  });

  deps.bumpAgentEpoch(agenteId);
  const updated = deps.db.connection
    .prepare("SELECT * FROM projecao_agente_memorias WHERE memoria_id = ?;")
    .get(memoriaId) as unknown as MemoriaRow;
  return deps.mapRow(updated);
}

export function deleteMemoryOp(deps: MemoryManagerDeps, agenteId: string, memoriaId: string, byUser = true): boolean {
  const existing = deps.db.connection
    .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
    .get(agenteId, memoriaId) as MemoriaRow | undefined;
  if (!existing) return false;

  if (!byUser && (existing.controlado_usuario === 1 || existing.origem === "manual")) {
    throw new Error(
      "Memória controlada pelo usuário não pode ser apagada automaticamente pelo agente.",
    );
  }

  deps.db.runInTransaction(() => {
    deps.db.connection
      .prepare("DELETE FROM projecao_agente_memorias WHERE memoria_id = ?;")
      .run(memoriaId);
    deps.syncFtsEntry(memoriaId, agenteId, null);
    deps.refreshAgentSummaryColumn(agenteId, new Date().toISOString());
  });

  if (byUser) {
    deps.bumpAgentEpoch(agenteId);
  }
  return true;
}

/**
 * Aplica operações geradas pelo `MemoryReviewService`, respeitando `controlado_usuario = 1`
 * e rebaixando automaticamente excessos de `8.192` bytes para `searchable`.
 */
export function applyReviewOperationsOp(deps: MemoryManagerDeps, agenteId: string,
    turnId: string,
    ops: Array<{
      op: "save" | "update" | "forget";
      memoriaId?: string;
      texto?: string;
      categoria?: MemoriaInclusao;
      escopoSite?: string | null;
    }>,): MemoryReviewAlteracao[] {
  const applied: MemoryReviewAlteracao[] = [];

  deps.db.runInTransaction(() => {
    const agora = new Date().toISOString();
    for (const item of ops) {
      if (item.op === "forget") {
        const target = item.memoriaId
          ? (deps.db.connection
              .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
              .get(agenteId, item.memoriaId) as MemoriaRow | undefined)
          : item.texto
            ? (deps.db.connection
                .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND normalized_text = ? LIMIT 1;")
                .get(agenteId, normalizeMemoryTextKey(item.texto)) as MemoriaRow | undefined)
            : undefined;

        if (!target || target.controlado_usuario === 1 || target.origem === "manual") {
          continue;
        }
        deps.db.connection
          .prepare("DELETE FROM projecao_agente_memorias WHERE memoria_id = ?;")
          .run(target.memoria_id);
        deps.syncFtsEntry(target.memoria_id, agenteId, null);
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
        const target = deps.db.connection
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
            deps.computeEssentialBytes(
              agenteId,
              [{ texto: clean, escopo_site: site }],
              new Set([target.memoria_id]),
            ) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES
          ) {
            nextCat = "searchable";
          }

          deps.db.connection
            .prepare(
              `UPDATE projecao_agente_memorias
               SET texto = ?, normalized_text = ?, categoria = ?, escopo_site = ?,
                   source_turn_id = ?, revisao = COALESCE(revisao, 1) + 1, atualizado_em = ?
               WHERE memoria_id = ?;`,
            )
            .run(clean, normalizeMemoryTextKey(clean), nextCat, site, turnId, agora, target.memoria_id);
          deps.syncFtsEntry(target.memoria_id, agenteId, clean);
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

      const saved = addMemoryOp(deps, agenteId, clean, "automatica", {
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
    deps.refreshAgentSummaryColumn(agenteId, agora);
  });

  return applied;
}
