import { randomUUID } from "node:crypto";
import {
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  type WorkflowAresta,
  type WorkflowDetail,
  type WorkflowNo,
  type WorkflowOutputDeliveryRecord,
  type WorkflowRunRecord,
  type WorkflowSummary,
  type WorkflowTraco,
  type WorkflowTriggerState,
  type WorkflowVisual,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";
import {
  AUTO_VERSION_INTERVAL_MS,
  WorkflowValidationError,
  collapseMissedWorkflowDue,
  computeNextWorkflowScheduleAt,
  listWorkflowTriggers,
  rowToWorkflowVisual,
  sanitizeWorkflowTriggerRow,
  wf_getLatestRunForWorkflow,
  type TriggerRow,
  type WorkflowRow,
  type WorkflowStoreDeps,
} from "./workflow-store-helpers.ts";
import {
  wf_getTriggerByWebhookRouteId,
  wf_getVersion,
  wf_getWorkflowDetail,
  wf_insertVersionSnapshot,
  wf_insertWebhookReceipt,
  wf_listVersions,
  wf_listWebhookReceipts,
  wf_pruneVersions,
  wf_restoreVersion,
  wf_rotateWebhookSecret,
  wf_saveRunVersionSnapshot,
  wf_syncTriggersInTx,
} from "./workflow-versioning-store.ts";
import {
  wf_claimDeliveryForSending,
  wf_createOrGetStep,
  wf_createRunWithReusedSteps,
  wf_getRunDetail,
  wf_getRunRecord,
  wf_getStep,
  wf_hasOpenRun,
  wf_listLatestDoneStepsByNode,
  wf_listRunsPaginated,
  wf_listSoloSteps,
  wf_markDeliveryResult,
  wf_updateRunStatus,
  wf_updateStep,
  wf_upsertDelivery,
} from "./workflow-runs-store.ts";

export {
  WorkflowValidationError,
  collapseMissedWorkflowDue,
  computeNextWorkflowScheduleAt,
};

type TailArgs<F> = F extends (deps: WorkflowStoreDeps, ...args: infer A) => unknown ? A : never;

export class WorkflowStore {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private readonly deps: WorkflowStoreDeps;

  constructor(deps: { db: CriativoDatabase; vault?: VaultService }) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.deps = { db: deps.db, vault: deps.vault };
  }

  private getLatestRunForWorkflow(workflowId: string): WorkflowRunRecord | null {
    return wf_getLatestRunForWorkflow(this.deps, workflowId);
  }

  private rowToVisual(row: WorkflowRow): WorkflowVisual {
    return rowToWorkflowVisual(this.deps, row);
  }

  private sanitizeTriggerRow(row: TriggerRow): WorkflowTriggerState {
    return sanitizeWorkflowTriggerRow(row);
  }

  public getWorkflowDetail(workflowId: string): WorkflowDetail | null {
    return wf_getWorkflowDetail(this.deps, workflowId);
  }

  public listTriggers(workflowId?: string): WorkflowTriggerState[] {
    return listWorkflowTriggers(this.deps, workflowId);
  }

  public listWorkflows(): WorkflowSummary[] {
    const rows = this.db.connection
      .prepare(`SELECT * FROM projecao_workflows ORDER BY atualizado_em DESC, workflow_id ASC;`)
      .all() as unknown as WorkflowRow[];

    return rows.map((row) => {
      const visual = rowToWorkflowVisual(this.deps, row);
      const execCount = visual.nos.filter(
        (n) => n.tipo !== "nota" && n.tipo !== "shape" && n.tipo !== "text"
      ).length;
      return {
        ...visual,
        revisao_grafo: visual.revisao_grafo ?? 0,
        qtd_nos: execCount,
        qtd_arestas: visual.arestas.length,
      };
    });
  }

  public getWorkflowVisual(workflowId: string): WorkflowVisual | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as unknown as WorkflowRow | undefined;
    if (!row) return null;
    return rowToWorkflowVisual(this.deps, row);
  }


  public createWorkflow(input: {
    workflow_id?: string;
    nome?: string;
    descricao?: string;
    nos?: WorkflowNo[];
    arestas?: WorkflowAresta[];
    tracos?: WorkflowTraco[];
    ativo?: boolean;
  }): WorkflowDetail {
    const workflowId = input.workflow_id?.trim() || `wf_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const nome = input.nome?.trim() || "Novo Workflow";
    const descricao = input.descricao?.trim() || "";
    const normalized = normalizeWorkflowGraph({
      nos: input.nos ?? [],
      arestas: input.arestas ?? [],
      tracos: input.tracos ?? [],
    });

    const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
    if (problem) {
      throw new WorkflowValidationError(problem, 400);
    }

    const ativo = input.ativo ?? true;
    const nowIso = new Date().toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflows (
            workflow_id, nome, descricao, nos_json, arestas_json, tracos_json,
            ativo, revisao_grafo, proximo_numero_run, ultima_execucao_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, NULL, ?);
        `
        )
        .run(
          workflowId,
          nome,
          descricao,
          JSON.stringify(normalized.nos),
          JSON.stringify(normalized.arestas),
          JSON.stringify(normalized.tracos),
          ativo ? 1 : 0,
          nowIso
        );

      wf_syncTriggersInTx(this.deps, workflowId, normalized.nos, ativo, nowIso);
    });

    const detail = wf_getWorkflowDetail(this.deps, workflowId);
    if (!detail) {
      throw new Error(`Falha ao carregar workflow recém-criado: ${workflowId}`);
    }
    return detail;
  }

  public saveWorkflow(
    workflowId: string,
    patch: {
      nome?: string;
      descricao?: string;
      nos?: WorkflowNo[];
      arestas?: WorkflowAresta[];
      tracos?: WorkflowTraco[];
      ativo?: boolean;
      base_revision?: number;
    }
  ):
    | { ok: true; detail: WorkflowDetail }
    | { ok: false; conflict: WorkflowDetail }
    | null {
    const existingCheck = this.db.connection
      .prepare(`SELECT workflow_id FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as { workflow_id: string } | undefined;
    if (!existingCheck) {
      return null;
    }

    let conflictFound = false;

    this.db.runInTransaction(() => {
      const current = this.db.connection
        .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
        .get(workflowId) as unknown as WorkflowRow | undefined;
      if (!current) {
        return;
      }

      const currentRev = Number(current.revisao_grafo ?? 0);
      if (patch.base_revision !== undefined && patch.base_revision !== currentRev) {
        conflictFound = true;
        return;
      }

      const prevVisual = rowToWorkflowVisual(this.deps, current);
      const nextNosRaw = patch.nos ?? prevVisual.nos;
      const nextArestasRaw = patch.arestas ?? prevVisual.arestas;
      const nextTracosRaw = patch.tracos ?? prevVisual.tracos ?? [];
      const normalized = normalizeWorkflowGraph({
        nos: nextNosRaw,
        arestas: nextArestasRaw,
        tracos: nextTracosRaw,
      });

      const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
      if (problem) {
        throw new WorkflowValidationError(problem, 400);
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const graphChanged =
        JSON.stringify(prevVisual.nos) !== JSON.stringify(normalized.nos) ||
        JSON.stringify(prevVisual.arestas) !== JSON.stringify(normalized.arestas) ||
        JSON.stringify(prevVisual.tracos ?? []) !== JSON.stringify(normalized.tracos);

      if (graphChanged) {
        const lastAuto = this.db.connection
          .prepare(
            `
            SELECT criado_em FROM projecao_workflow_versoes
            WHERE workflow_id = ? AND kind = 'auto'
            ORDER BY criado_em DESC, version_id DESC
            LIMIT 1;
          `
          )
          .get(workflowId) as { criado_em: string } | undefined;

        const elapsedMs = lastAuto ? now.getTime() - Date.parse(lastAuto.criado_em) : Number.POSITIVE_INFINITY;
        if (!lastAuto || Number.isNaN(elapsedMs) || elapsedMs >= AUTO_VERSION_INTERVAL_MS) {
          wf_insertVersionSnapshot(this.deps, {
            workflowId,
            revisaoGrafo: currentRev,
            kind: "auto",
            nos: prevVisual.nos,
            arestas: prevVisual.arestas,
            tracos: prevVisual.tracos ?? [],
            criadoEm: nowIso,
          });
        }
      }

      const nextNome = patch.nome !== undefined ? patch.nome.trim() || prevVisual.nome : prevVisual.nome;
      const nextDescricao = patch.descricao !== undefined ? patch.descricao : prevVisual.descricao;
      const nextAtivo = patch.ativo !== undefined ? patch.ativo : prevVisual.ativo;
      const nextRev = currentRev + 1;

      this.db.connection
        .prepare(
          `
          UPDATE projecao_workflows
          SET nome = ?,
              descricao = ?,
              nos_json = ?,
              arestas_json = ?,
              tracos_json = ?,
              ativo = ?,
              revisao_grafo = ?,
              atualizado_em = ?
          WHERE workflow_id = ?;
        `
        )
        .run(
          nextNome,
          nextDescricao,
          JSON.stringify(normalized.nos),
          JSON.stringify(normalized.arestas),
          JSON.stringify(normalized.tracos),
          nextAtivo ? 1 : 0,
          nextRev,
          nowIso,
          workflowId
        );

      wf_syncTriggersInTx(this.deps, workflowId, normalized.nos, nextAtivo, nowIso);
    });

    const detail = wf_getWorkflowDetail(this.deps, workflowId);
    if (!detail) return null;
    if (conflictFound) {
      return { ok: false, conflict: detail };
    }
    return { ok: true, detail };
  }

  public deleteWorkflow(workflowId: string): boolean {
    const triggers = this.db.connection
      .prepare(`SELECT webhook_secret_vault_key FROM projecao_workflow_gatilhos WHERE workflow_id = ?;`)
      .all(workflowId) as Array<{ webhook_secret_vault_key: string | null }>;

    let deleted = false;
    this.db.runInTransaction(() => {
      const info = this.db.connection
        .prepare(`DELETE FROM projecao_workflows WHERE workflow_id = ?;`)
        .run(workflowId);
      deleted = Number(info.changes) > 0;
    });

    if (deleted && this.vault) {
      for (const row of triggers) {
        if (row.webhook_secret_vault_key) {
          this.vault.deleteSecret(row.webhook_secret_vault_key);
        }
      }
    }

    return deleted;
  }

  public listVersions(...args: TailArgs<typeof wf_listVersions>) {
    return wf_listVersions(this.deps, ...args);
  }

  public getVersion(...args: TailArgs<typeof wf_getVersion>) {
    return wf_getVersion(this.deps, ...args);
  }

  public restoreVersion(...args: TailArgs<typeof wf_restoreVersion>) {
    return wf_restoreVersion(this.deps, ...args);
  }

  public saveRunVersionSnapshot(...args: TailArgs<typeof wf_saveRunVersionSnapshot>) {
    return wf_saveRunVersionSnapshot(this.deps, ...args);
  }

  public rotateWebhookSecret(...args: TailArgs<typeof wf_rotateWebhookSecret>) {
    return wf_rotateWebhookSecret(this.deps, ...args);
  }

  public getTriggerByWebhookRouteId(...args: TailArgs<typeof wf_getTriggerByWebhookRouteId>) {
    return wf_getTriggerByWebhookRouteId(this.deps, ...args);
  }

  public listWebhookReceipts(...args: TailArgs<typeof wf_listWebhookReceipts>) {
    return wf_listWebhookReceipts(this.deps, ...args);
  }

  public insertWebhookReceipt(...args: TailArgs<typeof wf_insertWebhookReceipt>) {
    return wf_insertWebhookReceipt(this.deps, ...args);
  }

  public hasOpenRun(...args: TailArgs<typeof wf_hasOpenRun>) {
    return wf_hasOpenRun(this.deps, ...args);
  }

  public createRunWithReusedSteps(...args: TailArgs<typeof wf_createRunWithReusedSteps>) {
    return wf_createRunWithReusedSteps(this.deps, ...args);
  }

  public getRunRecord(...args: TailArgs<typeof wf_getRunRecord>) {
    return wf_getRunRecord(this.deps, ...args);
  }

  public getRunDetail(...args: TailArgs<typeof wf_getRunDetail>) {
    return wf_getRunDetail(this.deps, ...args);
  }

  public listRunsPaginated(...args: TailArgs<typeof wf_listRunsPaginated>) {
    return wf_listRunsPaginated(this.deps, ...args);
  }

  public updateRunStatus(...args: TailArgs<typeof wf_updateRunStatus>) {
    return wf_updateRunStatus(this.deps, ...args);
  }

  public getStep(...args: TailArgs<typeof wf_getStep>) {
    return wf_getStep(this.deps, ...args);
  }

  public listSoloSteps(...args: TailArgs<typeof wf_listSoloSteps>) {
    return wf_listSoloSteps(this.deps, ...args);
  }

  public listLatestDoneStepsByNode(...args: TailArgs<typeof wf_listLatestDoneStepsByNode>) {
    return wf_listLatestDoneStepsByNode(this.deps, ...args);
  }

  public createOrGetStep(...args: TailArgs<typeof wf_createOrGetStep>) {
    return wf_createOrGetStep(this.deps, ...args);
  }

  public updateStep(...args: TailArgs<typeof wf_updateStep>) {
    return wf_updateStep(this.deps, ...args);
  }

  public upsertDelivery(...args: TailArgs<typeof wf_upsertDelivery>): WorkflowOutputDeliveryRecord {
    return wf_upsertDelivery(this.deps, ...args);
  }

  public claimDeliveryForSending(...args: TailArgs<typeof wf_claimDeliveryForSending>): boolean {
    return wf_claimDeliveryForSending(this.deps, ...args);
  }

  public markDeliveryResult(...args: TailArgs<typeof wf_markDeliveryResult>): void {
    wf_markDeliveryResult(this.deps, ...args);
  }
}
