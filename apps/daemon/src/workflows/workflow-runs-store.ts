import { randomUUID } from "node:crypto";
import type {
  WorkflowAresta,
  WorkflowBranch,
  WorkflowNo,
  WorkflowOutputDeliveryRecord,
  WorkflowOutputTarget,
  WorkflowPortType,
  WorkflowRunDetail,
  WorkflowRunOrigin,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowStepRecord,
  WorkflowStepStatus,
} from "@criativo/contracts";
import {
  WorkflowValidationError,
  rowToWorkflowVisual,
  safeJsonParse,
  wf_getLatestRunForWorkflow,
  type WorkflowRow,
  type WorkflowStoreDeps,
} from "./workflow-store-helpers.ts";

export function wf_hasOpenRun(
  deps: WorkflowStoreDeps,workflowId: string): boolean {
    const row = deps.db.connection
      .prepare(
        `
        SELECT 1 FROM projecao_workflow_execucoes
        WHERE workflow_id = ? AND status IN ('running', 'approval', 'stopping')
        LIMIT 1;
      `
      )
      .get(workflowId);
    return Boolean(row);
  }

export function wf_createRunWithReusedSteps(
  deps: WorkflowStoreDeps,params: {
    workflowId: string;
    triggerNodeId?: string | null;
    fromNodeId?: string | null;
    origem: WorkflowRunOrigin;
    scheduledFor?: string | null;
    idempotencyKey: string;
    payload?: string | null;
    reusedSteps: WorkflowStepRecord[];
  }): { detail: WorkflowRunDetail; deduplicated: boolean } {
    const existingRun = deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_execucoes
        WHERE workflow_id = ? AND chave_idempotencia = ?;
      `
      )
      .get(params.workflowId, params.idempotencyKey) as WorkflowRunRecord | undefined;

    if (existingRun) {
      const detail = wf_getRunDetail(deps, existingRun.run_id);
      if (detail) {
        return { detail, deduplicated: true };
      }
    }

    let createdRunId = "";

    deps.db.runInTransaction(() => {
      const wf = deps.db.connection
        .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
        .get(params.workflowId) as unknown as WorkflowRow | undefined;
      if (!wf) {
        throw new WorkflowValidationError(`Workflow não encontrado: ${params.workflowId}`, 404);
      }

      const visual = rowToWorkflowVisual(deps, wf);
      const numero = Number(wf.proximo_numero_run ?? 1);
      const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      createdRunId = runId;
      const nowIso = new Date().toISOString();
      const grafoJson = JSON.stringify({
        nos: visual.nos,
        arestas: visual.arestas,
        tracos: visual.tracos ?? [],
      });

      deps.db.connection
        .prepare(`UPDATE projecao_workflows SET proximo_numero_run = ?, ultima_execucao_em = ? WHERE workflow_id = ?;`)
        .run(numero + 1, nowIso, params.workflowId);

      deps.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_execucoes (
            run_id, workflow_id, numero, trigger_node_id, from_node_id, origem,
            agendado_para, chave_idempotencia, revisao_grafo, grafo_json, payload,
            status, erro, iniciado_em, encerrado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, NULL, ?);
        `
        )
        .run(
          runId,
          params.workflowId,
          numero,
          params.triggerNodeId ?? null,
          params.fromNodeId ?? null,
          params.origem,
          params.scheduledFor ?? null,
          params.idempotencyKey,
          Number(wf.revisao_grafo ?? 0),
          grafoJson,
          params.payload ?? null,
          nowIso,
          nowIso
        );

      for (const reused of params.reusedSteps) {
        const clonedStepId = `stp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const reqId = `reuse:${runId}:${reused.node_id}`;
        deps.db.connection
          .prepare(
            `
            INSERT INTO projecao_workflow_etapas (
              step_id, workflow_id, run_id, node_id, tentativa, request_id, kind, agente_id,
              status, tarefa_id, input, output, output_tipo, artefatos_json, branch, erro, structured_output_json,
              iniciado_em, encerrado_em, criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `
          )
          .run(
            clonedStepId,
            params.workflowId,
            runId,
            reused.node_id,
            reqId,
            reused.kind,
            reused.agente_id,
            reused.status,
            reused.tarefa_id,
            reused.input,
            reused.output,
            reused.output_tipo,
            reused.artefatos_json,
            reused.branch,
            reused.erro,
            reused.structured_output_json ?? null,
            reused.iniciado_em ?? nowIso,
            reused.encerrado_em ?? nowIso,
            nowIso,
            nowIso
          );
      }
    });

    const detail = wf_getRunDetail(deps, createdRunId);
    if (!detail) {
      throw new Error(`Falha ao carregar execução criada: ${createdRunId}`);
    }
    return { detail, deduplicated: false };
  }

export function wf_getRunRecord(
  deps: WorkflowStoreDeps,runId: string): WorkflowRunRecord | null {
    const row = deps.db.connection
      .prepare(`SELECT * FROM projecao_workflow_execucoes WHERE run_id = ?;`)
      .get(runId) as WorkflowRunRecord | undefined;
    return row ?? null;
  }

export function wf_getRunDetail(
  deps: WorkflowStoreDeps,runId: string): WorkflowRunDetail | null {
    const run = wf_getRunRecord(deps, runId);
    if (!run) return null;

    const steps = deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_etapas
        WHERE run_id = ?
        ORDER BY criado_em ASC, tentativa ASC, step_id ASC;
      `
      )
      .all(runId) as unknown as WorkflowStepRecord[];

    const deliveries = deps.db.connection
      .prepare(
        `
        SELECT d.* FROM projecao_workflow_entregas d
        INNER JOIN projecao_workflow_etapas s ON s.step_id = d.step_id
        WHERE s.run_id = ?
        ORDER BY d.criado_em ASC;
      `
      )
      .all(runId) as unknown as WorkflowOutputDeliveryRecord[];

    return { run, steps, deliveries };
  }

export function wf_listRunsPaginated(
  deps: WorkflowStoreDeps,
    workflowId: string,
    limit = 20,
    offset = 0
  ): WorkflowRunRecord[] {
    return deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_execucoes
        WHERE workflow_id = ?
        ORDER BY numero DESC, iniciado_em DESC
        LIMIT ? OFFSET ?;
      `
      )
      .all(
        workflowId,
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset)
      ) as unknown as WorkflowRunRecord[];
  }

export function wf_updateRunStatus(
  deps: WorkflowStoreDeps,
    runId: string,
    status: WorkflowRunStatus,
    erro: string | null = null
  ): WorkflowRunRecord | null {
    const nowIso = new Date().toISOString();
    const isTerminal = status === "done" || status === "failed" || status === "stopped";
    deps.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_execucoes
        SET status = ?,
            erro = COALESCE(?, erro),
            encerrado_em = CASE WHEN ? THEN COALESCE(encerrado_em, ?) ELSE NULL END,
            atualizado_em = ?
        WHERE run_id = ?;
      `
      )
      .run(status, erro, isTerminal ? 1 : 0, nowIso, nowIso, runId);

    return wf_getRunRecord(deps, runId);
  }

export function wf_getStep(
  deps: WorkflowStoreDeps,stepId: string): WorkflowStepRecord | null {
    const row = deps.db.connection
      .prepare(`SELECT * FROM projecao_workflow_etapas WHERE step_id = ?;`)
      .get(stepId) as WorkflowStepRecord | undefined;
    return row ?? null;
  }

export function wf_listSoloSteps(
  deps: WorkflowStoreDeps,workflowId: string, limit = 50): WorkflowStepRecord[] {
    return deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_etapas
        WHERE workflow_id = ? AND run_id IS NULL
        ORDER BY criado_em DESC, step_id DESC
        LIMIT ?;
      `
      )
      .all(workflowId, Math.max(1, Math.min(200, limit))) as unknown as WorkflowStepRecord[];
  }

export function wf_listLatestDoneStepsByNode(
  deps: WorkflowStoreDeps,workflowId: string): {
    stepsByNode: Map<string, WorkflowStepRecord>;
    ranWithGraph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] } | null;
  } {
    const rows = deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_etapas
        WHERE workflow_id = ? AND status = 'done'
        ORDER BY COALESCE(encerrado_em, criado_em) DESC, criado_em DESC, step_id DESC;
      `
      )
      .all(workflowId) as unknown as WorkflowStepRecord[];

    const map = new Map<string, WorkflowStepRecord>();
    for (const row of rows) {
      if (!map.has(row.node_id)) {
        map.set(row.node_id, row);
      }
    }

    const lastRun = wf_getLatestRunForWorkflow(deps, workflowId);
    let ranWithGraph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] } | null = null;
    if (lastRun?.grafo_json) {
      const parsed = safeJsonParse<{ nos?: WorkflowNo[]; arestas?: WorkflowAresta[] }>(
        lastRun.grafo_json,
        {}
      );
      if (Array.isArray(parsed.nos) && Array.isArray(parsed.arestas)) {
        ranWithGraph = { nos: parsed.nos, arestas: parsed.arestas };
      }
    }

    return { stepsByNode: map, ranWithGraph };
  }

export function wf_createOrGetStep(
  deps: WorkflowStoreDeps,params: {
    workflowId: string;
    runId: string | null;
    nodeId: string;
    requestId: string;
    kind: string;
    agenteId?: string | null;
    status: WorkflowStepStatus;
    input: string;
    output?: string | null;
    outputTipo?: WorkflowPortType | null;
    artefatos?: unknown[];
    branch?: WorkflowBranch | null;
    erro?: string | null;
    tarefaId?: string | null;
    structuredOutput?: Record<string, unknown> | null;
  }): { step: WorkflowStepRecord; created: boolean } {
    const byReq = deps.db.connection
      .prepare(
        `SELECT * FROM projecao_workflow_etapas WHERE workflow_id = ? AND request_id = ?;`
      )
      .get(params.workflowId, params.requestId) as WorkflowStepRecord | undefined;
    if (byReq) {
      return { step: byReq, created: false };
    }

    let stepId = "";
    deps.db.runInTransaction(() => {
      const countRow = params.runId
        ? (deps.db.connection
            .prepare(
              `SELECT COALESCE(MAX(tentativa), 0) AS max_t FROM projecao_workflow_etapas WHERE run_id = ? AND node_id = ?;`
            )
            .get(params.runId, params.nodeId) as { max_t: number })
        : ({ max_t: 0 } as { max_t: number });

      const tentativa = Number(countRow.max_t ?? 0) + 1;
      stepId = `stp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const nowIso = new Date().toISOString();
      const isTerminal =
        params.status === "done" ||
        params.status === "failed" ||
        params.status === "stopped" ||
        params.status === "skipped";

      deps.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_etapas (
            step_id, workflow_id, run_id, node_id, tentativa, request_id, kind, agente_id,
            status, tarefa_id, input, output, output_tipo, artefatos_json, branch, erro, structured_output_json,
            iniciado_em, encerrado_em, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `
        )
        .run(
          stepId,
          params.workflowId,
          params.runId,
          params.nodeId,
          tentativa,
          params.requestId,
          params.kind,
          params.agenteId ?? null,
          params.status,
          params.tarefaId ?? null,
          params.input,
          params.output ?? null,
          params.outputTipo ?? null,
          JSON.stringify(params.artefatos ?? []),
          params.branch ?? null,
          params.erro ?? null,
          params.structuredOutput ? JSON.stringify(params.structuredOutput) : null,
          nowIso,
          isTerminal ? nowIso : null,
          nowIso,
          nowIso
        );
    });

    const created = wf_getStep(deps, stepId);
    if (!created) {
      throw new Error(`Falha ao carregar etapa criada: ${stepId}`);
    }
    return { step: created, created: true };
  }

export function wf_updateStep(
  deps: WorkflowStoreDeps,
    stepId: string,
    patch: {
      status?: WorkflowStepStatus;
      tarefaId?: string | null;
      output?: string | null;
      outputTipo?: WorkflowPortType | null;
      artefatos?: unknown[];
      branch?: WorkflowBranch | null;
      erro?: string | null;
      structuredOutput?: Record<string, unknown> | null;
    }
  ): WorkflowStepRecord | null {
    const current = wf_getStep(deps, stepId);
    if (!current) return null;

    const nowIso = new Date().toISOString();
    const nextStatus = patch.status ?? current.status;
    const isTerminal =
      nextStatus === "done" ||
      nextStatus === "failed" ||
      nextStatus === "stopped" ||
      nextStatus === "skipped";

    const nextStructuredJson =
      patch.structuredOutput !== undefined
        ? patch.structuredOutput
          ? JSON.stringify(patch.structuredOutput)
          : null
        : (current.structured_output_json ?? null);

    deps.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_etapas
        SET status = ?,
            tarefa_id = ?,
            output = ?,
            output_tipo = ?,
            artefatos_json = ?,
            branch = ?,
            erro = ?,
            structured_output_json = ?,
            encerrado_em = CASE WHEN ? THEN COALESCE(encerrado_em, ?) ELSE NULL END,
            atualizado_em = ?
        WHERE step_id = ?;
      `
      )
      .run(
        nextStatus,
        patch.tarefaId !== undefined ? patch.tarefaId : current.tarefa_id,
        patch.output !== undefined ? patch.output : current.output,
        patch.outputTipo !== undefined ? patch.outputTipo : current.output_tipo,
        patch.artefatos !== undefined ? JSON.stringify(patch.artefatos) : current.artefatos_json,
        patch.branch !== undefined ? patch.branch : current.branch,
        patch.erro !== undefined ? patch.erro : current.erro,
        nextStructuredJson,
        isTerminal ? 1 : 0,
        nowIso,
        nowIso,
        stepId
      );

    return wf_getStep(deps, stepId);
  }

export function wf_upsertDelivery(
  deps: WorkflowStoreDeps,params: {
    stepId: string;
    destino: WorkflowOutputTarget;
    destinoRef: string;
    texto: string;
    anexos?: unknown[];
  }): WorkflowOutputDeliveryRecord {
    const nowIso = new Date().toISOString();
    deps.db.connection
      .prepare(
        `
        INSERT INTO projecao_workflow_entregas (
          step_id, destino, destino_ref, texto, anexos_json,
          status, motivo, tentativas, enviado_em, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0, NULL, ?, ?)
        ON CONFLICT(step_id) DO UPDATE SET
          destino = excluded.destino,
          destino_ref = excluded.destino_ref,
          texto = excluded.texto,
          anexos_json = excluded.anexos_json,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(
        params.stepId,
        params.destino,
        params.destinoRef,
        params.texto,
        JSON.stringify(params.anexos ?? []),
        nowIso,
        nowIso
      );

    return deps.db.connection
      .prepare(`SELECT * FROM projecao_workflow_entregas WHERE step_id = ?;`)
      .get(params.stepId) as unknown as WorkflowOutputDeliveryRecord;
  }

export function wf_claimDeliveryForSending(
  deps: WorkflowStoreDeps,stepId: string): boolean {
    const nowIso = new Date().toISOString();
    const info = deps.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_entregas
        SET status = 'sending',
            tentativas = tentativas + 1,
            atualizado_em = ?
        WHERE step_id = ? AND status = 'pending';
      `
      )
      .run(nowIso, stepId);
    return Number(info.changes) > 0;
  }

export function wf_markDeliveryResult(
  deps: WorkflowStoreDeps,
    stepId: string,
    status: "sent" | "failed" | "uncertain",
    motivo: string | null = null
  ): void {
    const nowIso = new Date().toISOString();
    deps.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_entregas
        SET status = ?,
            motivo = ?,
            enviado_em = CASE WHEN ? = 'sent' THEN COALESCE(enviado_em, ?) ELSE enviado_em END,
            atualizado_em = ?
        WHERE step_id = ?;
      `
      )
      .run(status, motivo, status, nowIso, nowIso, stepId);
  }
