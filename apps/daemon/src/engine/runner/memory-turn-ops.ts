import {
  randomUUID,
} from "node:crypto";
import type {
  AgenteMemoriasSnapshot,
  MemoriaInclusao,
  MemoryReviewAlteracao,
} from "@criativo/contracts";
import { type MemoryManagerDeps, AGENT_MEMORY_CONTEXT_BUDGET_BYTES, type AgenteMemoria, type MemoriaRow, type PendingMemoryOp, normalizeMemorySite, normalizeMemoryTextKey, serializeEssentialBlock } from "./memory-helpers.ts";

export function addMemoryOp(deps: MemoryManagerDeps, agenteId: string,
    texto: string,
    origem: "automatica" | "manual" = "automatica",
    opts?: {
      categoria?: MemoriaInclusao;
      escopoSite?: string | null;
      sourceTurnId?: string | null;
    },): (AgenteMemoria & { downgradedToSearchable?: boolean }) | null {
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

  deps.db.runInTransaction(() => {
    const existing = deps.db.connection
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
        deps.computeEssentialBytes(
          agenteId,
          [{ texto: cleanText, escopo_site: site }],
          new Set([existing.memoria_id]),
        ) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES
      ) {
        nextCat = "searchable";
        downgradedToSearchable = true;
      }
      deps.db.connection
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
      deps.syncFtsEntry(existing.memoria_id, agenteId, cleanText);
    } else {
      targetId = randomUUID();
      let nextCat = requestedCat;
      if (
        nextCat === "essential" &&
        deps.computeEssentialBytes(agenteId, [{ texto: cleanText, escopo_site: site }]) >
          AGENT_MEMORY_CONTEXT_BUDGET_BYTES
      ) {
        nextCat = "searchable";
        downgradedToSearchable = true;
      }
      deps.db.connection
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
      deps.syncFtsEntry(targetId, agenteId, cleanText);
    }

    deps.refreshAgentSummaryColumn(agenteId, agora);
  });

  if (origem === "manual") {
    deps.bumpAgentEpoch(agenteId);
  }

  const row = deps.db.connection
    .prepare("SELECT * FROM projecao_agente_memorias WHERE memoria_id = ?;")
    .get(targetId) as MemoriaRow | undefined;
  if (!row) return null;

  return {
    ...deps.mapRow(row),
    ...(downgradedToSearchable ? { downgradedToSearchable: true } : {}),
  };
}

export function listMemoriesOp(deps: MemoryManagerDeps, agenteId: string, limit = 50): AgenteMemoria[] {
  const rows = deps.db.connection
    .prepare(
      `SELECT * FROM projecao_agente_memorias
       WHERE agente_id = ?
       ORDER BY CASE WHEN categoria = 'essential' THEN 0 ELSE 1 END ASC,
                COALESCE(NULLIF(atualizado_em, ''), criado_em) DESC
       LIMIT ?;`,
    )
    .all(agenteId, limit) as unknown as MemoriaRow[];
  return rows.map((r) => deps.mapRow(r));
}

export function getMemoriesSnapshotOp(deps: MemoryManagerDeps, agenteId: string): AgenteMemoriasSnapshot {
  const all = listMemoriesOp(deps, agenteId, 1000);
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
    limit: deps.getConfiguredMemoryLimit(),
  };
}

/**
 * Registra mutação de memória em staging vinculada ao `turnId` e ao `epoch` atual do agente.
 * Só é gravada no banco se `commitTurnMutations(turnId, "completed")` concluir sem mudança de epoch.
 */
export function stageTurnMutationOp(deps: MemoryManagerDeps, turnId: string,
    agenteId: string,
    op: PendingMemoryOp,): { ok: boolean; staged: boolean; erro?: string } {
  if (op.action === "remember") {
    const clean = (op.texto ?? "").trim();
    if (!clean) {
      return { ok: false, staged: false, erro: "O texto da memória não pode ser vazio." };
    }
    const norm = normalizeMemoryTextKey(clean);
    const existing = deps.db.connection
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
      ? (deps.db.connection
          .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
          .get(agenteId, op.memoriaId) as MemoriaRow | undefined)
      : op.texto
        ? (deps.db.connection
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

  let bucket = deps.pendingMutationsByTurn.get(turnId);
  if (!bucket) {
    bucket = {
      agenteId,
      epoch: deps.getAgentEpoch(agenteId),
      ops: [],
    };
    deps.pendingMutationsByTurn.set(turnId, bucket);
  }
  bucket.ops.push(op);
  return { ok: true, staged: true };
}

export function commitTurnMutationsOp(deps: MemoryManagerDeps, turnId: string,
    outcome: "completed" | "failed" | "cancelled",): {
  committed: boolean;
  discarded: boolean;
  downgradedCount: number;
  changes: MemoryReviewAlteracao[];
} {
  const bucket = deps.pendingMutationsByTurn.get(turnId);
  deps.pendingMutationsByTurn.delete(turnId);
  if (!bucket || bucket.ops.length === 0) {
    return { committed: false, discarded: false, downgradedCount: 0, changes: [] };
  }

  if (outcome !== "completed" || deps.getAgentEpoch(bucket.agenteId) !== bucket.epoch) {
    return { committed: false, discarded: true, downgradedCount: 0, changes: [] };
  }

  let downgradedCount = 0;
  const changes: MemoryReviewAlteracao[] = [];

  deps.db.runInTransaction(() => {
    const agora = new Date().toISOString();
    for (const op of bucket.ops) {
      if (op.action === "remember" && op.texto) {
        const added = addMemoryOp(deps, bucket.agenteId, op.texto, "automatica", {
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
          ? (deps.db.connection
              .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND memoria_id = ? LIMIT 1;")
              .get(bucket.agenteId, op.memoriaId) as MemoriaRow | undefined)
          : op.texto
            ? (deps.db.connection
                .prepare("SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND normalized_text = ? LIMIT 1;")
                .get(bucket.agenteId, normalizeMemoryTextKey(op.texto)) as MemoriaRow | undefined)
            : undefined;

        if (target && target.controlado_usuario !== 1 && target.origem !== "manual") {
          deps.db.connection
            .prepare("DELETE FROM projecao_agente_memorias WHERE memoria_id = ?;")
            .run(target.memoria_id);
          deps.syncFtsEntry(target.memoria_id, bucket.agenteId, null);
          changes.push({
            memoria_id: target.memoria_id,
            acao: "forgotten",
            texto: target.texto,
          });
        }
      }
    }
    deps.refreshAgentSummaryColumn(bucket.agenteId, agora);
  });

  return { committed: true, discarded: false, downgradedCount, changes };
}

