import {
  isAnnotationNodeKind,
  normalizeNodeKind,
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  workflowLoopEdges,
  type TarefaRegistro,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowOutputTarget,
  type WorkflowPortType,
  type WorkflowRunDetail,
  type WorkflowRunOrigin,
  type WorkflowRunRecord,
  type WorkflowStepRecord,
} from "@criativo/contracts";
import {
  buildNodeInputs,
  conditionAnswer,
  conditionPrompt,
  currentAnswers,
  hasUpstreamApprovedStep,
  MAX_LOOP_PASSES,
  nextActions,
  runScope,
  soloInputs,
  type WorkflowBuiltInputs,
} from "../workflow-walk.ts";
import { safeJsonParse, type WorkflowEngineRuntimeContext } from "./workflow-engine-types.ts";


export async function dispatchWorkflowReadyInitialSteps(
  ctx: WorkflowEngineRuntimeContext,
runDetail: WorkflowRunDetail): Promise<WorkflowRunDetail> {
    const run = runDetail.run;
    const graph = ctx.parseRunGraph(run);
    const execNodes = graph.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
    const loops = workflowLoopEdges(execNodes, graph.arestas);
    const nodeById = new Map(execNodes.map((n) => [n.id, n]));
    const scope = ctx.getScopeForRun(run, graph);

    const controller = new AbortController();
    ctx.runAbortControllers.set(run.run_id, controller);

    // 1. Executa síncronamente gatilhos prontos iniciais para liberar raízes imediatamente
    for (let pass = 0; pass < 3; pass += 1) {
      const latestDetail = ctx.deps.store.getRunDetail(run.run_id);
      if (!latestDetail) break;

      const actions = nextActions({
        nos: graph.nos,
        arestas: graph.arestas,
        scope,
        steps: latestDetail.steps,
        maxLoopPasses: MAX_LOOP_PASSES,
      });

      const triggerRuns = actions.filter(
        (a) => a.action === "run" && nodeById.get(a.nodeId)?.tipo === "gatilho"
      );
      if (triggerRuns.length === 0) break;

      const stepsByNode = ctx.buildLatestStepsMap(latestDetail.steps);
      for (const act of triggerRuns) {
        const node = nodeById.get(act.nodeId)!;
        const attemptNum =
          latestDetail.steps.filter((s) => s.node_id === node.id).length + 1;
        const reqId = `run:${run.run_id}:node:${node.id}:t${attemptNum}`;
        const { step, created } = ctx.deps.store.createOrGetStep({
          workflowId: run.workflow_id,
          runId: run.run_id,
          nodeId: node.id,
          requestId: reqId,
          kind: normalizeNodeKind(node.tipo),
          agenteId: node.agenteId ?? null,
          status: "running",
          input: run.payload ?? "",
        });
        if (created) {
          ctx.emitStepUpdated(step);
          const inputs = buildNodeInputs({
            node,
            nos: graph.nos,
            arestas: graph.arestas,
            latestSteps: stepsByNode,
            loops,
          });
          await ctx.runNodeExecution({
            step,
            node,
            graph,
            inputs,
            stepsByNode,
            loops,
            runPayload: run.payload,
            signal: controller.signal,
            skipSweep: true,
          });
        }
      }
    }

    // 2. Despacha etapas raiz imediatas (garantindo tarefa_id gravado para `agente`)
    const afterTriggers = ctx.deps.store.getRunDetail(run.run_id);
    if (afterTriggers && afterTriggers.run.status === "running") {
      const initialActions = nextActions({
        nos: graph.nos,
        arestas: graph.arestas,
        scope,
        steps: afterTriggers.steps,
        maxLoopPasses: MAX_LOOP_PASSES,
      });

      const stepsByNode = ctx.buildLatestStepsMap(afterTriggers.steps);

      for (const act of initialActions) {
        const node = nodeById.get(act.nodeId);
        if (!node) continue;
        const attemptNum =
          afterTriggers.steps.filter((s) => s.node_id === node.id).length + 1;
        const reqId = `run:${run.run_id}:node:${node.id}:t${attemptNum}`;

        if (act.action === "skip") {
          const { step, created } = ctx.deps.store.createOrGetStep({
            workflowId: run.workflow_id,
            runId: run.run_id,
            nodeId: node.id,
            requestId: reqId,
            kind: normalizeNodeKind(node.tipo),
            agenteId: node.agenteId ?? null,
            status: "skipped",
            input: "",
            erro: act.reason ?? null,
          });
          if (created) ctx.emitStepUpdated(step);
          continue;
        }

        const kind = normalizeNodeKind(node.tipo);
        const inputs = buildNodeInputs({
          node,
          nos: graph.nos,
          arestas: graph.arestas,
          latestSteps: stepsByNode,
          loops,
        });

        let initialTarefaId: string | null = null;
        const { step, created } = ctx.deps.store.createOrGetStep({
          workflowId: run.workflow_id,
          runId: run.run_id,
          nodeId: node.id,
          requestId: reqId,
          kind,
          agenteId:
            node.agenteId ??
            (typeof node.config.agenteId === "string" ? node.config.agenteId : null),
          status: "running",
          input: inputs.inputText,
        });

        if (created && kind === "agente") {
          const promptBase =
            node.prompt ??
            (typeof node.config.prompt === "string" ? node.config.prompt : "") ??
            "";
          const combinedPrompt =
            promptBase && inputs.inputText
              ? `${promptBase}\n\n[Entrada do workflow]\n${inputs.inputText}`
              : promptBase || inputs.inputText || `Executar etapa '${node.titulo}'`;
          const mediaPaths = inputs.mediaInputs
            .map((m) => {
              try {
                return ctx.resolveWithinRoot(m.path);
              } catch {
                return null;
              }
            })
            .filter((p): p is string => Boolean(p));

          const tarefa = ctx.createAgentTaskForStep({
            workflowId: run.workflow_id,
            runId: run.run_id,
            stepId: step.step_id,
            node,
            promptText: combinedPrompt,
            mediaPaths,
          });
          initialTarefaId = tarefa.tarefa_id;
          ctx.deps.store.updateStep(step.step_id, { tarefaId: initialTarefaId });
        }

        if (created) {
          const refreshedStep = ctx.deps.store.getStep(step.step_id) ?? step;
          ctx.emitStepUpdated(refreshedStep);

          const taskPromise = ctx.runNodeExecution({
            step: refreshedStep,
            node,
            graph,
            inputs,
            stepsByNode,
            loops,
            runPayload: run.payload,
            signal: controller.signal,
          });
          ctx.trackPromise(taskPromise);
        }
      }

      if (initialActions.length === 0) {
        await sweepSingleWorkflowRun(ctx, run.run_id);
      }
    }

    return ctx.deps.store.getRunDetail(run.run_id) ?? runDetail;
  }

export async function sweepAllWorkflows(
  ctx: WorkflowEngineRuntimeContext,
workflowId?: string): Promise<void> {
    if (ctx.isDisposed()) return;
    const rows = workflowId
      ? (ctx.deps.db.connection
          .prepare(
            `SELECT run_id FROM projecao_workflow_execucoes WHERE workflow_id = ? AND status IN ('running', 'stopping') ORDER BY iniciado_em ASC;`
          )
          .all(workflowId) as Array<{ run_id: string }>)
      : (ctx.deps.db.connection
          .prepare(
            `SELECT run_id FROM projecao_workflow_execucoes WHERE status IN ('running', 'stopping') ORDER BY iniciado_em ASC;`
          )
          .all() as Array<{ run_id: string }>);

    for (const row of rows) {
      await sweepSingleWorkflowRun(ctx, row.run_id);
    }
  }

export async function sweepSingleWorkflowRun(
  ctx: WorkflowEngineRuntimeContext,
runId: string): Promise<void> {
    if (ctx.isDisposed()) return;
    if (ctx.sweepingRuns.has(runId)) {
      ctx.pendingSweepRuns.add(runId);
      return;
    }

    ctx.sweepingRuns.add(runId);
    try {
      let keepRunning = true;
      while (keepRunning && !ctx.isDisposed()) {
        ctx.pendingSweepRuns.delete(runId);
        const detail = ctx.deps.store.getRunDetail(runId);
        if (!detail) break;

        const { run, steps } = detail;
        if (run.status === "stopping") {
          for (const s of steps) {
            if (s.status === "running" || s.status === "approval") {
              const updated = ctx.deps.store.updateStep(s.step_id, {
                status: "stopped",
                erro: s.erro ?? "Execução interrompida.",
              });
              if (updated) ctx.emitStepUpdated(updated);
            }
          }
          const stoppedRun = ctx.deps.store.updateRunStatus(runId, "stopped");
          if (stoppedRun) ctx.emitRunUpdated(stoppedRun);
          ctx.runAbortControllers.delete(runId);
          break;
        }

        if (run.status !== "running") {
          break;
        }

        const graph = ctx.parseRunGraph(run);
        const execNodes = graph.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
        const loops = workflowLoopEdges(execNodes, graph.arestas);
        const nodeById = new Map(execNodes.map((n) => [n.id, n]));
        const scope = ctx.getScopeForRun(run, graph);

        const actions = nextActions({
          nos: graph.nos,
          arestas: graph.arestas,
          scope,
          steps,
          maxLoopPasses: MAX_LOOP_PASSES,
        });

        const controller =
          ctx.runAbortControllers.get(runId) ??
          (() => {
            const c = new AbortController();
            ctx.runAbortControllers.set(runId, c);
            return c;
          })();

        const stepsByNode = ctx.buildLatestStepsMap(steps);
        let didSyncChange = false;

        for (const act of actions) {
          const node = nodeById.get(act.nodeId);
          if (!node) continue;
          const attemptNum = steps.filter((s) => s.node_id === node.id).length + 1;
          const reqId = `run:${runId}:node:${node.id}:t${attemptNum}`;

          if (act.action === "skip") {
            const { step, created } = ctx.deps.store.createOrGetStep({
              workflowId: run.workflow_id,
              runId,
              nodeId: node.id,
              requestId: reqId,
              kind: normalizeNodeKind(node.tipo),
              agenteId: node.agenteId ?? null,
              status: "skipped",
              input: "",
              erro: act.reason ?? null,
            });
            if (created) {
              ctx.emitStepUpdated(step);
              didSyncChange = true;
            }
            continue;
          }

          const kind = normalizeNodeKind(node.tipo);
          const inputs = buildNodeInputs({
            node,
            nos: graph.nos,
            arestas: graph.arestas,
            latestSteps: stepsByNode,
            loops,
          });

          const { step, created } = ctx.deps.store.createOrGetStep({
            workflowId: run.workflow_id,
            runId,
            nodeId: node.id,
            requestId: reqId,
            kind,
            agenteId:
              node.agenteId ??
              (typeof node.config.agenteId === "string" ? node.config.agenteId : null),
            status: "running",
            input: inputs.inputText,
          });

          if (created) {
            ctx.emitStepUpdated(step);
            const execPromise = ctx.runNodeExecution({
              step,
              node,
              graph,
              inputs,
              stepsByNode,
              loops,
              runPayload: run.payload,
              signal: controller.signal,
            });
            ctx.trackPromise(execPromise);
          }
        }

        // Recarrega etapas para checar convergência terminal do run
        const fresh = ctx.deps.store.getRunDetail(runId);
        if (!fresh) break;

        const hasOpenSteps = fresh.steps.some(
          (s) => s.status === "running" || s.status === "approval"
        );
        const hasApprovalStep = fresh.steps.some((s) => s.status === "approval");

        if (hasApprovalStep && fresh.run.status !== "approval") {
          const paused = ctx.deps.store.updateRunStatus(runId, "approval");
          if (paused) ctx.emitRunUpdated(paused);
          break;
        }

        const remainingActions = nextActions({
          nos: graph.nos,
          arestas: graph.arestas,
          scope,
          steps: fresh.steps,
          maxLoopPasses: MAX_LOOP_PASSES,
        });

        if (!hasOpenSteps && remainingActions.length === 0) {
          const anyFailed = fresh.steps.find((s) => s.status === "failed");
          const finalStatus = anyFailed ? "failed" : "done";
          const closedRun = ctx.deps.store.updateRunStatus(
            runId,
            finalStatus,
            anyFailed?.erro ?? null
          );
          if (closedRun) {
            ctx.emitRunUpdated(closedRun);
            ctx.deps.wsHub.broadcast("workflow:status", {
              workflow_id: closedRun.workflow_id,
              status: finalStatus === "done" ? "concluido" : "falha",
              resumo:
                finalStatus === "done"
                  ? `Execução #${closedRun.numero} concluída`
                  : anyFailed?.erro ?? "Falha na execução do workflow",
            });
          }
          ctx.runAbortControllers.delete(runId);
          break;
        }

        keepRunning = didSyncChange || ctx.pendingSweepRuns.has(runId);
      }
    } finally {
      ctx.sweepingRuns.delete(runId);
    }
  }

export async function recoverAndSweepWorkflowRuns(
  ctx: WorkflowEngineRuntimeContext
): Promise<{
    recoveredRuns: number;
    pausedApprovals: number;
    uncertainDeliveries: number;
  }> {
    let recoveredRuns = 0;
    let pausedApprovals = 0;
    let uncertainDeliveries = 0;

    // 1. Transicionar entregas em trânsito (`sending`) para `uncertain` sem reenviar duplicado
    const uncertainInfo = ctx.deps.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_entregas
        SET status = 'uncertain',
            motivo = 'Envio interrompido por reinício do Daemon; verifique manualmente antes de reenviar.',
            atualizado_em = ?
        WHERE status = 'sending';
      `
      )
      .run(new Date().toISOString());
    uncertainDeliveries = Number(uncertainInfo.changes ?? 0);

    // 2. Recuperar execuções abertas
    const openRuns = ctx.deps.db.connection
      .prepare(
        `SELECT * FROM projecao_workflow_execucoes WHERE status IN ('running', 'approval', 'stopping') ORDER BY iniciado_em ASC;`
      )
      .all() as unknown as WorkflowRunRecord[];

    for (const run of openRuns) {
      const detail = ctx.deps.store.getRunDetail(run.run_id);
      if (!detail) continue;

      if (run.status === "stopping") {
        await ctx.stopRun(run.run_id);
        recoveredRuns += 1;
        continue;
      }

      let hasApproval = false;
      for (const step of detail.steps) {
        if (step.status === "approval") {
          hasApproval = true;
          pausedApprovals += 1;
          continue;
        }

        if (step.status === "running") {
          if (step.kind === "agente") {
            const tarefa = step.tarefa_id ? ctx.deps.queue.getTask(step.tarefa_id) : null;
            if (!tarefa) {
              const graph = ctx.parseRunGraph(run);
              const node = graph.nos.find((n) => n.id === step.node_id);
              if (node) {
                const newTask = ctx.createAgentTaskForStep({
                  workflowId: run.workflow_id,
                  runId: run.run_id,
                  stepId: step.step_id,
                  node,
                  promptText: step.input || `Retomando etapa ${node.titulo}`,
                  mediaPaths: [],
                });
                ctx.deps.store.updateStep(step.step_id, { tarefaId: newTask.tarefa_id });
              }
            } else if (tarefa.status === "concluido") {
              const resObj = (tarefa.resultado ?? {}) as Record<string, unknown>;
              const outText =
                typeof resObj.texto === "string"
                  ? resObj.texto
                  : typeof resObj.copy === "string"
                    ? resObj.copy
                    : "";
              const arts = Array.isArray(resObj.artefatos) ? resObj.artefatos : [];
              ctx.deps.store.updateStep(step.step_id, {
                status: "done",
                output: outText,
                artefatos: arts,
              });
            } else if (tarefa.status === "falha" || tarefa.status === "pendente") {
              ctx.deps.store.updateStep(step.step_id, {
                status: "failed",
                erro: tarefa.erro_detalhes ?? "Etapa de agente interrompida pelo reinício do Daemon.",
              });
            }
          } else {
            ctx.deps.store.updateStep(step.step_id, {
              status: "failed",
              erro: "Execução interrompida por reinício do Daemon.",
            });
          }
          recoveredRuns += 1;
        }
      }

      if (hasApproval && run.status !== "approval") {
        ctx.deps.store.updateRunStatus(run.run_id, "approval");
      } else if (!hasApproval && run.status === "running") {
        await sweepSingleWorkflowRun(ctx, run.run_id);
      }
    }

    return { recoveredRuns, pausedApprovals, uncertainDeliveries };
  }
