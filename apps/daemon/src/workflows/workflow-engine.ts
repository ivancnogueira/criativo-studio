import { randomUUID } from "node:crypto";
import type {
  WorkflowAresta,
  WorkflowNo,
  WorkflowPortType,
  WorkflowRunDetail,
  WorkflowRunOrigin,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from "@criativo/contracts";
import {
  isAnnotationNodeKind,
  normalizeNodeKind,
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  workflowLoopEdges,
} from "@criativo/contracts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import type { AgentRunner } from "../engine/runner/agent-runner.ts";
import { WorkflowStore, WorkflowValidationError } from "./workflow-store.ts";
import {
  buildNodeInputs,
  currentAnswers,
  nextActions,
  runScope,
  soloInputs,
  type WorkflowBuiltInputs,
} from "./workflow-walk.ts";
import {
  AsyncSemaphore,
  safeJsonParse,
  type WorkflowEngineDeps,
  type WorkflowEngineRuntimeContext,
  type WorkflowWhatsAppAdapter,
} from "./engine/workflow-engine-types.ts";
import {
  createWorkflowAgentTaskForStep,
  executeWorkflowDirectModelText,
  getWorkflowSecretsForRedaction,
  hasWorkflowVaultApiKey,
  interpolateWorkflowBrandPlaceholders,
  resolveWorkflowPathWithinRoot,
  resolveWorkflowSafeOutputFile,
} from "./engine/workflow-direct-llm.ts";
import { executeWorkflowCoreOrAiNode } from "./engine/workflow-node-core-exec.ts";
import { retryBatchMediaVariant } from "./engine/workflow-batch-media-exec.ts";
import { executeWorkflowOutputNode } from "./engine/workflow-node-output-exec.ts";
import {
  dispatchWorkflowReadyInitialSteps,
  recoverAndSweepWorkflowRuns,
  sweepAllWorkflows,
  sweepSingleWorkflowRun,
} from "./engine/workflow-run-coordinator.ts";

export type { WorkflowWhatsAppAdapter, WorkflowEngineDeps };

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;
  private whatsappAdapter: WorkflowWhatsAppAdapter | null;
  private readonly generationLock = new AsyncSemaphore(1);
  private readonly mediaLock = new AsyncSemaphore(1);
  private readonly runScopeCache = new Map<string, Set<string>>();
  private readonly sweepingRuns = new Set<string>();
  private readonly pendingSweepRuns = new Set<string>();
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly activePromises = new Set<Promise<void>>();
  private disposed = false;

  constructor(deps: WorkflowEngineDeps) {
    this.deps = deps;
    this.whatsappAdapter = deps.whatsapp ?? null;
  }

  public setWhatsAppAdapter(adapter: WorkflowWhatsAppAdapter | null): void {
    this.whatsappAdapter = adapter;
  }

  public setRunner(runner: AgentRunner): void {
    this.deps.runner = runner;
  }

  private trackPromise(promise: Promise<void>): void {
    this.activePromises.add(promise);
    void promise.finally(() => {
      this.activePromises.delete(promise);
    });
  }


  private getRuntimeContext(): WorkflowEngineRuntimeContext {
    return {
      deps: this.deps,
      generationLock: this.generationLock,
      mediaLock: this.mediaLock,
      runScopeCache: this.runScopeCache,
      sweepingRuns: this.sweepingRuns,
      pendingSweepRuns: this.pendingSweepRuns,
      runAbortControllers: this.runAbortControllers,
      activePromises: this.activePromises,
      isDisposed: () => this.disposed,
      getWhatsAppAdapter: () => this.whatsappAdapter,
      trackPromise: (p) => this.trackPromise(p),
      resolveWithinRoot: (p) => resolveWorkflowPathWithinRoot(this.getRuntimeContext(), p),
      resolveSafeOutputFile: (n) => resolveWorkflowSafeOutputFile(this.getRuntimeContext(), n),
      getSecretsListForRedaction: () => getWorkflowSecretsForRedaction(this.getRuntimeContext()),
      hasVaultApiKey: (p) => hasWorkflowVaultApiKey(this.getRuntimeContext(), p),
      executeDirectModelText: (p) => executeWorkflowDirectModelText(this.getRuntimeContext(), p),
      getScopeForRun: (r, g) => this.getScopeForRun(r, g),
      emitStepUpdated: (s) => this.emitStepUpdated(s),
      emitRunUpdated: (r) => this.emitRunUpdated(r),
      parseRunGraph: (r) => this.parseRunGraph(r),
      buildLatestStepsMap: (s) => this.buildLatestStepsMap(s),
      interpolateBrandPlaceholders: (r) => interpolateWorkflowBrandPlaceholders(this.getRuntimeContext(), r),
      createAgentTaskForStep: (p) => createWorkflowAgentTaskForStep(this.getRuntimeContext(), p),
      runNodeExecution: (p) => this.runNodeExecution(p),
      sweepRun: (id) => this.sweepRun(id),
      stopRun: (id) => this.stopRun(id),
    };
  }

  private getScopeForRun(run: WorkflowRunRecord, graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] }): Set<string> {
    const cached = this.runScopeCache.get(run.run_id);
    if (cached) return cached;

    const latestDone = this.deps.store.listLatestDoneStepsByNode(run.workflow_id);
    const answers = currentAnswers(graph, latestDone.stepsByNode, latestDone.ranWithGraph);
    const scopeRes = runScope(graph, {
      triggerNodeId: run.trigger_node_id ?? undefined,
      fromNodeId: run.from_node_id ?? undefined,
      answers,
    });
    this.runScopeCache.set(run.run_id, scopeRes.scope);
    return scopeRes.scope;
  }

  private emitStepUpdated(step: WorkflowStepRecord): void {
    this.deps.wsHub.broadcast("workflow:step_updated", {
      workflow_id: step.workflow_id,
      run_id: step.run_id,
      step_id: step.step_id,
      node_id: step.node_id,
      status: step.status,
      branch: step.branch,
    });
  }

  private emitRunUpdated(run: WorkflowRunRecord): void {
    this.deps.wsHub.broadcast("workflow:run_updated", {
      workflow_id: run.workflow_id,
      run_id: run.run_id,
      numero: run.numero,
      status: run.status,
    });
  }

  private parseRunGraph(run: WorkflowRunRecord): { nos: WorkflowNo[]; arestas: WorkflowAresta[] } {
    const parsed = safeJsonParse<{ nos?: WorkflowNo[]; arestas?: WorkflowAresta[] }>(run.grafo_json, {});
    const normalized = normalizeWorkflowGraph({
      nos: parsed.nos ?? [],
      arestas: parsed.arestas ?? [],
    });
    return { nos: normalized.nos, arestas: normalized.arestas };
  }

  private buildLatestStepsMap(steps: WorkflowStepRecord[]): Map<string, WorkflowStepRecord> {
    const map = new Map<string, WorkflowStepRecord>();
    for (const step of steps) {
      map.set(step.node_id, step);
    }
    return map;
  }


private async runNodeExecution(params: {
    step: WorkflowStepRecord;
    node: WorkflowNo;
    graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] };
    inputs: WorkflowBuiltInputs;
    stepsByNode: Map<string, WorkflowStepRecord>;
    loops: Set<string>;
    runPayload: string | null;
    signal?: AbortSignal;
    skipSweep?: boolean;
  }): Promise<void> {
    const { step, node, graph, inputs, stepsByNode, loops, runPayload, signal, skipSweep } = params;
    const kind = normalizeNodeKind(node.tipo);
    const cfg = node.config ?? {};

    if (this.disposed || signal?.aborted) {
      const stopped = this.deps.store.updateStep(step.step_id, {
        status: "stopped",
        erro: "Execução interrompida.",
      });
      if (stopped) this.emitStepUpdated(stopped);
      return;
    }

    const rtCtx = this.getRuntimeContext();
    try {
      if (kind === "output") {
        await executeWorkflowOutputNode(rtCtx, { step, node, cfg, graph, inputs, stepsByNode, loops });
      } else {
        const earlyReturn = await executeWorkflowCoreOrAiNode(rtCtx, {
          kind,
          step,
          node,
          cfg,
          graph,
          inputs,
          stepsByNode,
          runPayload,
          signal,
        });
        if (earlyReturn) return;
      }
    } catch (err) {
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : String(err),
        getWorkflowSecretsForRedaction(rtCtx)
      );
      const updated = this.deps.store.updateStep(step.step_id, {
        status: "failed",
        erro: msg,
      });
      if (updated) this.emitStepUpdated(updated);
      if (step.run_id && !skipSweep) {
        await this.sweepRun(step.run_id);
      }
      return;
    }

    if (step.run_id && !skipSweep) {
      await this.sweepRun(step.run_id);
    }
  }

  private async dispatchReadyInitialSteps(runDetail: WorkflowRunDetail): Promise<WorkflowRunDetail> {
    return await dispatchWorkflowReadyInitialSteps(this.getRuntimeContext(), runDetail);
  }

  public async sweep(workflowId?: string): Promise<void> {
    return await sweepAllWorkflows(this.getRuntimeContext(), workflowId);
  }

  public async sweepRun(runId: string): Promise<void> {
    return await sweepSingleWorkflowRun(this.getRuntimeContext(), runId);
  }

  public async startRun(input: {
    workflowId: string;
    origem: WorkflowRunOrigin;
    triggerNodeId?: string;
    fromNodeId?: string;
    payload?: unknown;
    requestId?: string;
    scheduledFor?: string;
  }): Promise<WorkflowRunDetail> {
    if (this.disposed) {
      throw new Error("WorkflowEngine já encerrado.");
    }

    const visual = this.deps.store.getWorkflowVisual(input.workflowId);
    if (!visual) {
      throw new WorkflowValidationError(`Workflow não encontrado: ${input.workflowId}`, 404);
    }

    const normalized = normalizeWorkflowGraph({
      nos: visual.nos,
      arestas: visual.arestas,
      tracos: visual.tracos,
    });
    const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
    if (problem) {
      throw new WorkflowValidationError(problem, 400);
    }

    this.deps.store.saveRunVersionSnapshot(input.workflowId);

    const latestDone = this.deps.store.listLatestDoneStepsByNode(input.workflowId);
    const answers = currentAnswers(
      { nos: normalized.nos, arestas: normalized.arestas },
      latestDone.stepsByNode,
      latestDone.ranWithGraph
    );

    const scopeRes = runScope(
      { nos: normalized.nos, arestas: normalized.arestas },
      {
        triggerNodeId: input.triggerNodeId,
        fromNodeId: input.fromNodeId,
        answers,
      }
    );

    const payloadText =
      input.payload === undefined || input.payload === null
        ? null
        : typeof input.payload === "string"
          ? input.payload
          : JSON.stringify(input.payload);

    const idempotencyKey =
      input.requestId?.trim() || `manual:${randomUUID()}`;

    const { detail, deduplicated } = this.deps.store.createRunWithReusedSteps({
      workflowId: input.workflowId,
      triggerNodeId: input.triggerNodeId ?? null,
      fromNodeId: input.fromNodeId ?? null,
      origem: input.origem,
      scheduledFor: input.scheduledFor ?? null,
      idempotencyKey,
      payload: payloadText,
      reusedSteps: scopeRes.reused,
    });

    this.runScopeCache.set(detail.run.run_id, scopeRes.scope);

    if (deduplicated) {
      return detail;
    }

    this.emitRunUpdated(detail.run);
    this.deps.wsHub.broadcast("workflow:status", {
      workflow_id: input.workflowId,
      status: "executando",
      no_atual: input.fromNodeId ?? input.triggerNodeId ?? null,
      resumo: `Execução #${detail.run.numero} iniciada`,
    });

    return await this.dispatchReadyInitialSteps(detail);
  }

  public async runStep(input: {
    workflowId: string;
    nodeId: string;
    requestId?: string;
    payload?: unknown;
  }): Promise<WorkflowStepRecord> {
    if (this.disposed) {
      throw new Error("WorkflowEngine já encerrado.");
    }

    const visual = this.deps.store.getWorkflowVisual(input.workflowId);
    if (!visual) {
      throw new WorkflowValidationError(`Workflow não encontrado: ${input.workflowId}`, 404);
    }

    const node = visual.nos.find((n) => n.id === input.nodeId);
    if (!node || isAnnotationNodeKind(node.tipo)) {
      throw new WorkflowValidationError(`Nó executável não encontrado: ${input.nodeId}`, 404);
    }

    const latestDone = this.deps.store.listLatestDoneStepsByNode(input.workflowId);
    const validAnswers = currentAnswers(
      { nos: visual.nos, arestas: visual.arestas },
      latestDone.stepsByNode,
      latestDone.ranWithGraph
    );
    const inputs = soloInputs({
      node,
      nos: visual.nos,
      arestas: visual.arestas,
      latestDoneSteps: validAnswers,
    });

    const payloadText =
      input.payload === undefined || input.payload === null
        ? inputs.inputText
        : typeof input.payload === "string"
          ? input.payload
          : JSON.stringify(input.payload);

    const reqId = input.requestId?.trim() || `solo:${node.id}:${randomUUID()}`;
    const { step, created } = this.deps.store.createOrGetStep({
      workflowId: input.workflowId,
      runId: null,
      nodeId: node.id,
      requestId: reqId,
      kind: normalizeNodeKind(node.tipo),
      agenteId: node.agenteId ?? null,
      status: "running",
      input: payloadText,
    });

    if (!created) {
      return step;
    }

    this.emitStepUpdated(step);
    const execNodes = visual.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
    const loops = workflowLoopEdges(execNodes, visual.arestas);

    await this.runNodeExecution({
      step,
      node,
      graph: { nos: visual.nos, arestas: visual.arestas },
      inputs: { ...inputs, inputText: payloadText },
      stepsByNode: validAnswers,
      loops,
      runPayload: payloadText,
    });

    return this.deps.store.getStep(step.step_id) ?? step;
  }

  public async retryStep(stepId: string): Promise<WorkflowRunDetail | WorkflowStepRecord> {
    const oldStep = this.deps.store.getStep(stepId);
    if (!oldStep) {
      throw new WorkflowValidationError(`Etapa não encontrada: ${stepId}`, 404);
    }

    if (!oldStep.run_id) {
      return await this.runStep({
        workflowId: oldStep.workflow_id,
        nodeId: oldStep.node_id,
      });
    }

    const detail = this.deps.store.getRunDetail(oldStep.run_id);
    if (!detail) {
      throw new WorkflowValidationError(`Execução não encontrada: ${oldStep.run_id}`, 404);
    }

    const graph = this.parseRunGraph(detail.run);
    const node = graph.nos.find((n) => n.id === oldStep.node_id);
    if (!node) {
      throw new WorkflowValidationError(`Nó '${oldStep.node_id}' ausente no grafo do run.`, 404);
    }

    if (detail.run.status !== "running") {
      const reopened = this.deps.store.updateRunStatus(detail.run.run_id, "running", null);
      if (reopened) this.emitRunUpdated(reopened);
    }

    const reqId = `retry:${stepId}:${randomUUID().slice(0, 8)}`;
    const { step } = this.deps.store.createOrGetStep({
      workflowId: oldStep.workflow_id,
      runId: oldStep.run_id,
      nodeId: oldStep.node_id,
      requestId: reqId,
      kind: oldStep.kind,
      agenteId: oldStep.agente_id,
      status: "running",
      input: oldStep.input,
    });

    this.emitStepUpdated(step);

    const execNodes = graph.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
    const loops = workflowLoopEdges(execNodes, graph.arestas);
    const stepsByNode = this.buildLatestStepsMap(detail.steps);
    const inputs = buildNodeInputs({
      node,
      nos: graph.nos,
      arestas: graph.arestas,
      latestSteps: stepsByNode,
      loops,
    });

    const controller = this.runAbortControllers.get(detail.run.run_id) ?? new AbortController();
    this.runAbortControllers.set(detail.run.run_id, controller);

    const p = this.runNodeExecution({
      step,
      node,
      graph,
      inputs,
      stepsByNode,
      loops,
      runPayload: detail.run.payload,
      signal: controller.signal,
    }).then(async () => {
      await this.sweepRun(detail.run.run_id!);
    });
    this.trackPromise(p);

    return this.deps.store.getRunDetail(detail.run.run_id) ?? detail;
  }

  public async retryStepVariant(
    stepId: string,
    slotIndex: number
  ) {
    return await retryBatchMediaVariant(this.getRuntimeContext(), stepId, slotIndex);
  }

  public async decideStep(
    stepId: string,
    approved: boolean,
    decidedBy?: string
  ): Promise<WorkflowStepRecord> {
    const step = this.deps.store.getStep(stepId);
    if (!step) {
      throw new WorkflowValidationError(`Etapa não encontrada: ${stepId}`, 404);
    }
    if (step.status !== "approval") {
      throw new WorkflowValidationError(`Etapa '${stepId}' não está aguardando aprovação.`, 400);
    }

    if (approved) {
      const artefatos = safeJsonParse<unknown[]>(step.artefatos_json, []);
      const outTipo: WorkflowPortType =
        step.output_tipo ?? (artefatos.length > 0 ? "file" : "text");
      const doneStep = this.deps.store.updateStep(stepId, {
        status: "done",
        output: step.input || "Aprovado pelo usuário.",
        outputTipo: outTipo,
        erro: null,
      })!;
      this.emitStepUpdated(doneStep);

      if (step.run_id) {
        const resumedRun = this.deps.store.updateRunStatus(step.run_id, "running", null);
        if (resumedRun) this.emitRunUpdated(resumedRun);
        await this.sweepRun(step.run_id);
      }
      return doneStep;
    }

    const reason = decidedBy ? `Rejeitado por ${decidedBy}.` : "Rejeitado pelo usuário.";
    const stoppedStep = this.deps.store.updateStep(stepId, {
      status: "stopped",
      erro: reason,
    })!;
    this.emitStepUpdated(stoppedStep);

    if (step.run_id) {
      const detail = this.deps.store.getRunDetail(step.run_id);
      if (detail) {
        for (const s of detail.steps) {
          if (s.step_id !== stepId && (s.status === "running" || s.status === "approval")) {
            const closedOther = this.deps.store.updateStep(s.step_id, {
              status: "stopped",
              erro: reason,
            });
            if (closedOther) this.emitStepUpdated(closedOther);
          }
        }
      }
      const stoppedRun = this.deps.store.updateRunStatus(step.run_id, "stopped", reason);
      if (stoppedRun) this.emitRunUpdated(stoppedRun);
      this.runAbortControllers.get(step.run_id)?.abort();
      this.runAbortControllers.delete(step.run_id);
    }

    return stoppedStep;
  }

  public async stopRun(runId: string): Promise<WorkflowRunDetail | null> {
    const detail = this.deps.store.getRunDetail(runId);
    if (!detail) return null;

    this.runAbortControllers.get(runId)?.abort();
    this.runAbortControllers.delete(runId);

    for (const step of detail.steps) {
      if (step.status === "running" || step.status === "approval") {
        const updated = this.deps.store.updateStep(step.step_id, {
          status: "stopped",
          erro: "Execução parada pelo usuário.",
        });
        if (updated) this.emitStepUpdated(updated);
      }
    }

    const stoppedRun = this.deps.store.updateRunStatus(
      runId,
      "stopped",
      "Execução parada pelo usuário."
    );
    if (stoppedRun) this.emitRunUpdated(stoppedRun);

    return this.deps.store.getRunDetail(runId);
  }

  public async stopStep(stepId: string): Promise<void> {
    const step = this.deps.store.getStep(stepId);
    if (!step) return;
    if (step.run_id) {
      this.runAbortControllers.get(step.run_id)?.abort();
    }
    const updated = this.deps.store.updateStep(stepId, {
      status: "stopped",
      erro: "Etapa interrompida pelo usuário.",
    });
    if (updated) this.emitStepUpdated(updated);
  }


  public async recoverAndSweep() {
    return await recoverAndSweepWorkflowRuns(this.getRuntimeContext());
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.runAbortControllers.values()) {
      controller.abort();
    }
    this.runAbortControllers.clear();
    await Promise.allSettled([...this.activePromises]);
  }
}
