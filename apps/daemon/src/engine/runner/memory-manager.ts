import type {
  CriativoDatabase,
} from "../../database/client.ts";
import { type MemoryManagerDeps, type TailArgs, DEFAULT_AGENT_MEMORY_LIMIT, type AgenteMemoria, type MemoriaRow, type PendingMemoryOp, serializeEssentialBlock } from "./memory-helpers.ts";
import * as turnOps from "./memory-turn-ops.ts";
import * as searchOps from "./memory-search-context.ts";
import * as crudOps from "./memory-crud-review.ts";

export * from "./memory-helpers.ts";

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
    if (!this.db.hasFts5MemoriesTable()) return;
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

  private deps(): MemoryManagerDeps {
    return {
      db: this.db,
      epochByAgent: this.epochByAgent,
      pendingMutationsByTurn: this.pendingMutationsByTurn,
      mapRow: this.mapRow.bind(this),
      syncFtsEntry: this.syncFtsEntry.bind(this),
      refreshAgentSummaryColumn: this.refreshAgentSummaryColumn.bind(this),
      computeEssentialBytes: this.computeEssentialBytes.bind(this),
      getConfiguredMemoryLimit: this.getConfiguredMemoryLimit.bind(this),
      getAgentEpoch: this.getAgentEpoch.bind(this),
      bumpAgentEpoch: this.bumpAgentEpoch.bind(this),
    };
  }

  public addMemory(...args: TailArgs<typeof turnOps.addMemoryOp>): ReturnType<typeof turnOps.addMemoryOp> {
    return turnOps.addMemoryOp(this.deps(), ...args);
  }

  public listMemories(...args: TailArgs<typeof turnOps.listMemoriesOp>): ReturnType<typeof turnOps.listMemoriesOp> {
    return turnOps.listMemoriesOp(this.deps(), ...args);
  }

  public getMemoriesSnapshot(...args: TailArgs<typeof turnOps.getMemoriesSnapshotOp>): ReturnType<typeof turnOps.getMemoriesSnapshotOp> {
    return turnOps.getMemoriesSnapshotOp(this.deps(), ...args);
  }

  public stageTurnMutation(...args: TailArgs<typeof turnOps.stageTurnMutationOp>): ReturnType<typeof turnOps.stageTurnMutationOp> {
    return turnOps.stageTurnMutationOp(this.deps(), ...args);
  }

  public commitTurnMutations(...args: TailArgs<typeof turnOps.commitTurnMutationsOp>): ReturnType<typeof turnOps.commitTurnMutationsOp> {
    return turnOps.commitTurnMutationsOp(this.deps(), ...args);
  }

  public getEssentialContextSnapshot(...args: TailArgs<typeof searchOps.getEssentialContextSnapshotOp>): ReturnType<typeof searchOps.getEssentialContextSnapshotOp> {
    return searchOps.getEssentialContextSnapshotOp(this.deps(), ...args);
  }

  public searchMemoriesFts(...args: TailArgs<typeof searchOps.searchMemoriesFtsOp>): ReturnType<typeof searchOps.searchMemoriesFtsOp> {
    return searchOps.searchMemoriesFtsOp(this.deps(), ...args);
  }

  public listMemoriesPaginated(...args: TailArgs<typeof crudOps.listMemoriesPaginatedOp>): ReturnType<typeof crudOps.listMemoriesPaginatedOp> {
    return crudOps.listMemoriesPaginatedOp(this.deps(), ...args);
  }

  public setMemoryInclusion(...args: TailArgs<typeof crudOps.setMemoryInclusionOp>): ReturnType<typeof crudOps.setMemoryInclusionOp> {
    return crudOps.setMemoryInclusionOp(this.deps(), ...args);
  }

  public updateManualMemory(...args: TailArgs<typeof crudOps.updateManualMemoryOp>): ReturnType<typeof crudOps.updateManualMemoryOp> {
    return crudOps.updateManualMemoryOp(this.deps(), ...args);
  }

  public deleteMemory(...args: TailArgs<typeof crudOps.deleteMemoryOp>): ReturnType<typeof crudOps.deleteMemoryOp> {
    return crudOps.deleteMemoryOp(this.deps(), ...args);
  }

  public applyReviewOperations(...args: TailArgs<typeof crudOps.applyReviewOperationsOp>): ReturnType<typeof crudOps.applyReviewOperationsOp> {
    return crudOps.applyReviewOperationsOp(this.deps(), ...args);
  }
}
