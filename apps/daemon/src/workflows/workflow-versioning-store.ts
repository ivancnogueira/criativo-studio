import { randomBytes, randomUUID } from "node:crypto";
import {
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  type WorkflowAresta,
  type WorkflowDetail,
  type WorkflowNo,
  type WorkflowTraco,
  type WorkflowVersionKind,
  type WorkflowVersionRecord,
  type WorkflowVersionSummary,
  type WorkflowVisual,
} from "@criativo/contracts";
import {
  MAX_WORKFLOW_VERSIONS,
  WorkflowValidationError,
  computeNextWorkflowScheduleAt,
  extractNodeTriggerMeta,
  listWorkflowTriggers,
  rowToWorkflowVisual,
  safeJsonParse,
  type TriggerRow,
  type WorkflowRow,
  type WorkflowStoreDeps,
} from "./workflow-store-helpers.ts";
import { wf_listRunsPaginated } from "./workflow-runs-store.ts";

export function wf_getWorkflowVisual(
  deps: WorkflowStoreDeps,
  workflowId: string
): WorkflowVisual | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
    .get(workflowId) as unknown as WorkflowRow | undefined;
  if (!row) return null;
  return rowToWorkflowVisual(deps, row);
}

export function wf_getWorkflowDetail(
  deps: WorkflowStoreDeps,
  workflowId: string
): WorkflowDetail | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
    .get(workflowId) as unknown as WorkflowRow | undefined;
  if (!row) return null;

  const workflow = rowToWorkflowVisual(deps, row);
  const versions = wf_listVersions(deps, workflowId);
  const triggers = listWorkflowTriggers(deps, workflowId);
  const runs = wf_listRunsPaginated(deps, workflowId, 30, 0);

  return {
    workflow,
    versions,
    triggers,
    runs,
  };
}

export function wf_pruneVersions(
  deps: WorkflowStoreDeps,workflowId: string): void {
    deps.db.connection
      .prepare(
        `
        DELETE FROM projecao_workflow_versoes
        WHERE workflow_id = ?
          AND version_id NOT IN (
            SELECT version_id FROM projecao_workflow_versoes
            WHERE workflow_id = ?
            ORDER BY criado_em DESC, version_id DESC
            LIMIT ?
          );
      `
      )
      .run(workflowId, workflowId, MAX_WORKFLOW_VERSIONS);
  }

export function wf_insertVersionSnapshot(
  deps: WorkflowStoreDeps,params: {
    workflowId: string;
    revisaoGrafo: number;
    kind: WorkflowVersionKind;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos: WorkflowTraco[];
    criadoEm?: string;
  }): WorkflowVersionSummary {
    const versionId = `wfv_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const criadoEm = params.criadoEm ?? new Date().toISOString();
    const grafoJson = JSON.stringify({
      nos: params.nos,
      arestas: params.arestas,
      tracos: params.tracos,
    });

    deps.db.connection
      .prepare(
        `
        INSERT INTO projecao_workflow_versoes (
          version_id, workflow_id, revisao_grafo, kind, grafo_json, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?);
      `
      )
      .run(versionId, params.workflowId, params.revisaoGrafo, params.kind, grafoJson, criadoEm);

    wf_pruneVersions(deps, params.workflowId);

    return {
      version_id: versionId,
      workflow_id: params.workflowId,
      revisao_grafo: params.revisaoGrafo,
      kind: params.kind,
      criado_em: criadoEm,
    };
  }

export function wf_syncTriggersInTx(
  deps: WorkflowStoreDeps,
    workflowId: string,
    nos: WorkflowNo[],
    ativo: boolean,
    nowIso: string
  ): void {
    const existingRows = deps.db.connection
      .prepare(`SELECT * FROM projecao_workflow_gatilhos WHERE workflow_id = ?;`)
      .all(workflowId) as unknown as TriggerRow[];
    const existingByNode = new Map(existingRows.map((r) => [r.node_id, r]));

    const currentTriggers = nos.filter((n) => n.tipo === "gatilho");
    const keepIds = new Set(currentTriggers.map((n) => n.id));
    const keysToDelete: string[] = [];

    for (const oldRow of existingRows) {
      if (!keepIds.has(oldRow.node_id)) {
        if (oldRow.webhook_secret_vault_key) {
          keysToDelete.push(oldRow.webhook_secret_vault_key);
        }
        deps.db.connection
          .prepare(`DELETE FROM projecao_workflow_gatilhos WHERE workflow_id = ? AND node_id = ?;`)
          .run(workflowId, oldRow.node_id);
      }
    }

    for (const node of currentTriggers) {
      const prev = existingByNode.get(node.id);
      const meta = extractNodeTriggerMeta(node);
      const scheduleJson = meta.schedule ? JSON.stringify(meta.schedule) : null;
      const filtroJson = JSON.stringify(meta.filtro);

      let webhookRouteId: string | null = null;
      let webhookVaultKey: string | null = null;
      if (meta.tipo === "webhook") {
        webhookRouteId =
          prev?.webhook_route_id ?? `whk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        webhookVaultKey = prev?.webhook_secret_vault_key ?? null;
      } else if (prev?.webhook_secret_vault_key) {
        keysToDelete.push(prev.webhook_secret_vault_key);
      }

      let proximaExecucaoEm: string | null = null;
      if (meta.tipo === "schedule" && ativo && meta.schedule) {
        const unchangedSchedule =
          prev &&
          prev.tipo === "schedule" &&
          prev.schedule_json === scheduleJson &&
          prev.timezone === meta.timezone &&
          prev.proxima_execucao_em !== null;
        proximaExecucaoEm = unchangedSchedule
          ? prev.proxima_execucao_em
          : computeNextWorkflowScheduleAt(meta.schedule, meta.timezone, new Date(nowIso));
      }

      deps.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_gatilhos (
            workflow_id, node_id, tipo, timezone, schedule_json, filtro_json,
            webhook_route_id, webhook_secret_vault_key, proxima_execucao_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workflow_id, node_id) DO UPDATE SET
            tipo = excluded.tipo,
            timezone = excluded.timezone,
            schedule_json = excluded.schedule_json,
            filtro_json = excluded.filtro_json,
            webhook_route_id = excluded.webhook_route_id,
            webhook_secret_vault_key = excluded.webhook_secret_vault_key,
            proxima_execucao_em = excluded.proxima_execucao_em,
            atualizado_em = excluded.atualizado_em;
        `
        )
        .run(
          workflowId,
          node.id,
          meta.tipo,
          meta.timezone,
          scheduleJson,
          filtroJson,
          webhookRouteId,
          webhookVaultKey,
          proximaExecucaoEm,
          nowIso
        );
    }

    if (deps.vault) {
      for (const secretKey of keysToDelete) {
        deps.vault.deleteSecret(secretKey);
      }
    }
  }

export function wf_listVersions(
  deps: WorkflowStoreDeps,workflowId: string): WorkflowVersionSummary[] {
    return deps.db.connection
      .prepare(
        `
        SELECT version_id, workflow_id, revisao_grafo, kind, criado_em
        FROM projecao_workflow_versoes
        WHERE workflow_id = ?
        ORDER BY criado_em DESC, version_id DESC
        LIMIT ?;
      `
      )
      .all(workflowId, MAX_WORKFLOW_VERSIONS) as unknown as WorkflowVersionSummary[];
  }

export function wf_getVersion(
  deps: WorkflowStoreDeps,workflowId: string, versionId: string): WorkflowVersionRecord | null {
    const row = deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_versoes
        WHERE workflow_id = ? AND version_id = ?;
      `
      )
      .get(workflowId, versionId) as WorkflowVersionRecord | undefined;
    return row ?? null;
  }

export function wf_restoreVersion(
  deps: WorkflowStoreDeps,workflowId: string, versionId: string): WorkflowDetail | null {
    let restored = false;

    deps.db.runInTransaction(() => {
      const current = deps.db.connection
        .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
        .get(workflowId) as unknown as WorkflowRow | undefined;
      const version = deps.db.connection
        .prepare(
          `SELECT * FROM projecao_workflow_versoes WHERE workflow_id = ? AND version_id = ?;`
        )
        .get(workflowId, versionId) as WorkflowVersionRecord | undefined;

      if (!current || !version) {
        return;
      }

      const prevVisual = rowToWorkflowVisual(deps, current);
      const nowIso = new Date().toISOString();

      wf_insertVersionSnapshot(deps, {
        workflowId,
        revisaoGrafo: Number(current.revisao_grafo ?? 0),
        kind: "restore",
        nos: prevVisual.nos,
        arestas: prevVisual.arestas,
        tracos: prevVisual.tracos ?? [],
        criadoEm: nowIso,
      });

      const parsedGraph = safeJsonParse<{
        nos?: WorkflowNo[];
        arestas?: WorkflowAresta[];
        tracos?: WorkflowTraco[];
      }>(version.grafo_json, {});
      const normalized = normalizeWorkflowGraph({
        nos: parsedGraph.nos ?? [],
        arestas: parsedGraph.arestas ?? [],
        tracos: parsedGraph.tracos ?? [],
      });

      const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
      if (problem) {
        throw new WorkflowValidationError(`Versão contém grafo inválido: ${problem}`, 400);
      }

      const nextRev = Number(current.revisao_grafo ?? 0) + 1;
      deps.db.connection
        .prepare(
          `
          UPDATE projecao_workflows
          SET nos_json = ?,
              arestas_json = ?,
              tracos_json = ?,
              revisao_grafo = ?,
              atualizado_em = ?
          WHERE workflow_id = ?;
        `
        )
        .run(
          JSON.stringify(normalized.nos),
          JSON.stringify(normalized.arestas),
          JSON.stringify(normalized.tracos),
          nextRev,
          nowIso,
          workflowId
        );

      wf_syncTriggersInTx(deps, workflowId, normalized.nos, current.ativo === 1, nowIso);
      restored = true;
    });

    return restored ? wf_getWorkflowDetail(deps, workflowId) : null;
  }

export function wf_saveRunVersionSnapshot(
  deps: WorkflowStoreDeps,workflowId: string): WorkflowVersionSummary | null {
    const row = deps.db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as unknown as WorkflowRow | undefined;
    if (!row) return null;

    const visual = rowToWorkflowVisual(deps, row);
    const currentGrafoJson = JSON.stringify({
      nos: visual.nos,
      arestas: visual.arestas,
      tracos: visual.tracos ?? [],
    });

    const lastRunVersion = deps.db.connection
      .prepare(
        `
        SELECT grafo_json FROM projecao_workflow_versoes
        WHERE workflow_id = ? AND kind = 'run'
        ORDER BY criado_em DESC, version_id DESC
        LIMIT 1;
      `
      )
      .get(workflowId) as { grafo_json: string } | undefined;

    if (lastRunVersion && lastRunVersion.grafo_json === currentGrafoJson) {
      return null;
    }

    return deps.db.runInTransaction(() =>
      wf_insertVersionSnapshot(deps, {
        workflowId,
        revisaoGrafo: Number(row.revisao_grafo ?? 0),
        kind: "run",
        nos: visual.nos,
        arestas: visual.arestas,
        tracos: visual.tracos ?? [],
      })
    );
  }

export function wf_rotateWebhookSecret(
  deps: WorkflowStoreDeps,
    workflowId: string,
    nodeId: string
  ): { routeId: string; webhookUrl: string; secret: string } {
    if (!deps.vault) {
      throw new Error("VaultService indisponível para rotacionar segredo de webhook.");
    }

    const visual = wf_getWorkflowVisual(deps, workflowId);
    if (!visual) {
      throw new WorkflowValidationError(`Workflow não encontrado: ${workflowId}`, 404);
    }

    const node = visual.nos.find((n) => n.id === nodeId);
    if (!node || node.tipo !== "gatilho") {
      throw new WorkflowValidationError(`Nó gatilho não encontrado: ${nodeId}`, 404);
    }

    const meta = extractNodeTriggerMeta(node);
    if (meta.tipo !== "webhook") {
      throw new WorkflowValidationError(`O nó '${nodeId}' não é um gatilho do tipo webhook.`, 400);
    }

    const secret = randomBytes(32).toString("hex");
    const vaultKey = `wf_webhook_secret:${workflowId}:${nodeId}`;
    deps.vault.setSecret(vaultKey, secret);

    let routeId = "";
    const nowIso = new Date().toISOString();

    deps.db.runInTransaction(() => {
      const existing = deps.db.connection
        .prepare(
          `SELECT webhook_route_id FROM projecao_workflow_gatilhos WHERE workflow_id = ? AND node_id = ?;`
        )
        .get(workflowId, nodeId) as { webhook_route_id: string | null } | undefined;

      routeId =
        existing?.webhook_route_id ?? `whk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

      deps.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_gatilhos (
            workflow_id, node_id, tipo, timezone, schedule_json, filtro_json,
            webhook_route_id, webhook_secret_vault_key, proxima_execucao_em, atualizado_em
          ) VALUES (?, ?, 'webhook', ?, NULL, ?, ?, ?, NULL, ?)
          ON CONFLICT(workflow_id, node_id) DO UPDATE SET
            tipo = 'webhook',
            webhook_route_id = excluded.webhook_route_id,
            webhook_secret_vault_key = excluded.webhook_secret_vault_key,
            atualizado_em = excluded.atualizado_em;
        `
        )
        .run(
          workflowId,
          nodeId,
          meta.timezone,
          JSON.stringify(meta.filtro),
          routeId,
          vaultKey,
          nowIso
        );
    });

    return {
      routeId,
      webhookUrl: `/api/workflows/webhook/${routeId}`,
      secret,
    };
  }

export function wf_getTriggerByWebhookRouteId(
  deps: WorkflowStoreDeps,routeId: string): TriggerRow | null {
    const row = deps.db.connection
      .prepare(`SELECT * FROM projecao_workflow_gatilhos WHERE webhook_route_id = ?;`)
      .get(routeId) as unknown as TriggerRow | undefined;
    return row ?? null;
  }

export function wf_listWebhookReceipts(
  deps: WorkflowStoreDeps,
    workflowId: string,
    limit = 30
  ): Array<{
    receipt_id: string;
    workflow_id: string;
    node_id: string;
    delivery_id: string;
    status: "started" | "ignored";
    motivo: "busy" | "refused" | "unauthorized" | null;
    run_id: string | null;
    recebido_em: string;
  }> {
    return deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_webhook_recibos
        WHERE workflow_id = ?
        ORDER BY recebido_em DESC
        LIMIT ?;
      `
      )
      .all(workflowId, Math.max(1, Math.min(200, limit))) as Array<{
      receipt_id: string;
      workflow_id: string;
      node_id: string;
      delivery_id: string;
      status: "started" | "ignored";
      motivo: "busy" | "refused" | "unauthorized" | null;
      run_id: string | null;
      recebido_em: string;
    }>;
  }

export function wf_insertWebhookReceipt(
  deps: WorkflowStoreDeps,params: {
    workflowId: string;
    nodeId: string;
    deliveryId: string;
    status: "started" | "ignored";
    motivo?: "busy" | "refused" | "unauthorized" | null;
    runId?: string | null;
  }): { inserted: boolean; receiptId: string } {
    const existing = deps.db.connection
      .prepare(
        `
        SELECT receipt_id FROM projecao_workflow_webhook_recibos
        WHERE workflow_id = ? AND node_id = ? AND delivery_id = ?;
      `
      )
      .get(params.workflowId, params.nodeId, params.deliveryId) as
      | { receipt_id: string }
      | undefined;
    if (existing) {
      return { inserted: false, receiptId: existing.receipt_id };
    }

    const receiptId = `wfr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    deps.db.connection
      .prepare(
        `
        INSERT INTO projecao_workflow_webhook_recibos (
          receipt_id, workflow_id, node_id, delivery_id, status, motivo, run_id, recebido_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `
      )
      .run(
        receiptId,
        params.workflowId,
        params.nodeId,
        params.deliveryId,
        params.status,
        params.motivo ?? null,
        params.runId ?? null,
        new Date().toISOString()
      );
    return { inserted: true, receiptId };
  }
