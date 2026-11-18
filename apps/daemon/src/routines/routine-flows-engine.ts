import type {
  RoutineFlowCanvas,
  RoutineFlowLink,
  RoutineFlowRun,
  RoutineFlowStep,
  RoutineRun,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import {
  collectAffectedAgents,
  reachableFromOwner,
  routineFlowDepths,
} from "./routine-flow-graph.ts";
import type { RoutineFlowStore } from "./routine-flow-store.ts";
import { expandScheduleOccurrences } from "./routine-schedule-calc.ts";
import type { RoutineStore } from "./routine-store.ts";

export interface RoutineFlowsEngineOptions {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  routineStore: RoutineStore;
  flowStore: RoutineFlowStore;
  wsHub: WebSocketHub;
}

/**
 * Motor DAG de Fluxos de Rotinas (`routine -> agente -> agente`).
 * Executa varreduras coalescidas com trava em memória, aguarda convergência de múltiplos
 * predecessores, propaga `skipped` diante de `routine_no_update`/falha e suporta `stopRun`.
 */
export class RoutineFlowsEngine {
  private readonly db: CriativoDatabase;
  private readonly queue: FifoQueueManager;
  private readonly routineStore: RoutineStore;
  private readonly flowStore: RoutineFlowStore;
  private readonly wsHub: WebSocketHub;

  private sweepPromise: Promise<void> | null = null;
  private sweepPending = false;

  constructor(options: RoutineFlowsEngineOptions) {
    this.db = options.db;
    this.queue = options.queue;
    this.routineStore = options.routineStore;
    this.flowStore = options.flowStore;
    this.wsHub = options.wsHub;
  }

  private getAgentDisplayName(agenteId: string): string {
    const row = this.db.connection
      .prepare(`SELECT nome FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { nome?: string } | undefined;
    return row?.nome?.trim() || agenteId;
  }

  /**
   * Varredura serializada e coalescida: múltiplas chamadas simultâneas aguardam o passe ativo
   * e disparam no máximo mais um passe ao finalizar, evitando race conditions no DAG.
   */
  public async sweep(): Promise<void> {
    if (this.sweepPromise) {
      this.sweepPending = true;
      await this.sweepPromise;
      return;
    }

    this.sweepPromise = (async () => {
      try {
        do {
          this.sweepPending = false;
          await this.executeSweepPass();
        } while (this.sweepPending);
      } finally {
        this.sweepPromise = null;
      }
    })();

    await this.sweepPromise;
  }

  private mapRootRunToStepStatus(
    exec: RoutineRun
  ): "running" | "succeeded" | "failed" | "skipped" | "cancelled" {
    if (exec.status === "succeeded") return "succeeded";
    if (exec.status === "failed") return "failed";
    if (exec.status === "cancelled" || exec.status === "interrupted") return "cancelled";
    return "running";
  }

  private listCandidateExecutions(): RoutineRun[] {
    const cutoffIso = new Date(Date.now() - 72 * 3_600_000).toISOString();
    const rows = this.db.connection
      .prepare(
        `
        SELECT DISTINCT r.*
        FROM projecao_rotina_execucoes r
        WHERE r.missed_count IS NULL
          AND r.criado_em >= ?
          AND (
            EXISTS (
              SELECT 1 FROM projecao_routine_flow_links l
              WHERE l.rotina_id = r.rotina_id AND l.criado_em <= r.criado_em
            )
            OR EXISTS (
              SELECT 1 FROM projecao_routine_flow_runs fr
              WHERE fr.execucao_id = r.execucao_id AND fr.status = 'running'
            )
          )
        ORDER BY r.criado_em ASC;
      `
      )
      .all(cutoffIso) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      execucao_id: String(row.execucao_id),
      rotina_id: String(row.rotina_id),
      owner_kind: row.owner_kind === "canal" ? "canal" : "agente",
      owner_id: String(row.owner_id),
      run_kind: row.run_kind === "manual" ? "manual" : "scheduled",
      run_source: (row.run_source as RoutineRun["run_source"]) ?? null,
      scheduled_for: String(row.scheduled_for),
      rotina_nome: String(row.rotina_nome),
      instrucao: String(row.instrucao),
      tarefa_id: row.tarefa_id ? String(row.tarefa_id) : null,
      thread_id: row.thread_id ? String(row.thread_id) : null,
      status: row.status as RoutineRun["status"],
      silenciada: row.silenciada === 1,
      erro: row.erro ? String(row.erro) : null,
      missed_count: typeof row.missed_count === "number" ? row.missed_count : null,
      missed_until: row.missed_until ? String(row.missed_until) : null,
      resultado_resumo: row.resultado_resumo ? String(row.resultado_resumo) : null,
      criado_em: String(row.criado_em),
      atualizado_em: String(row.atualizado_em),
    }));
  }

  private async executeSweepPass(): Promise<void> {
    const candidates = this.listCandidateExecutions();

    for (const exec of candidates) {
      const routine = this.routineStore.getById(exec.rotina_id);
      if (!routine) continue;

      const allLinks = this.flowStore.listLinksByRoutine(exec.rotina_id);
      // Links criados após o início da execução não se aplicam retroativamente
      const eligibleLinks = allLinks.filter((l) => l.criado_em <= exec.criado_em);
      if (eligibleLinks.length === 0) continue;

      let flowRun = this.flowStore.getFlowRunByExecucaoId(exec.execucao_id);
      if (!flowRun) {
        if (exec.status === "cancelled") continue;
        flowRun = this.flowStore.createFlowRun({
          execucao_id: exec.execucao_id,
          rotina_id: exec.rotina_id,
          root_agent_id: exec.owner_id,
          status: "running",
          criado_em: exec.criado_em,
        });
      }

      if (flowRun.status !== "running") {
        continue;
      }

      const rootStatus = this.mapRootRunToStepStatus(exec);
      const rootOutput =
        rootStatus === "succeeded"
          ? exec.silenciada
            ? null
            : (exec.resultado_resumo ?? "")
          : null;

      const existingSteps = new Map<string, RoutineFlowStep>(
        flowRun.steps.map((s) => [s.agente_id, s])
      );

      let rootStep = existingSteps.get(exec.owner_id);
      if (!rootStep) {
        const createdRoot = this.flowStore.createStepIdempotent({
          flow_run_id: flowRun.flow_run_id,
          execucao_id: exec.execucao_id,
          agente_id: exec.owner_id,
          tarefa_id: exec.tarefa_id,
          input: exec.instrucao,
          output: rootOutput,
          status: rootStatus,
          erro: exec.erro,
        });
        if (createdRoot) {
          rootStep = createdRoot;
          existingSteps.set(exec.owner_id, createdRoot);
        }
      } else if (
        rootStep.status === "running" &&
        rootStatus !== "running"
      ) {
        const synced = this.flowStore.updateStep(rootStep.step_id, {
          status: rootStatus,
          output: rootOutput,
          erro: exec.erro,
        });
        if (synced) {
          rootStep = synced;
          existingSteps.set(exec.owner_id, synced);
        }
      }

      // Percorre nós alcançáveis em ordem topológica BFS por profundidade
      const depths = routineFlowDepths(exec.owner_id, eligibleLinks);
      const orderedNodes = Array.from(depths.entries())
        .filter(([, depth]) => depth >= 1)
        .sort((a, b) => a[1] - b[1])
        .map(([agentId]) => agentId);

      const affectedAgents = collectAffectedAgents(exec.owner_id, eligibleLinks);

      for (const targetAgentId of orderedNodes) {
        if (existingSteps.has(targetAgentId)) continue;

        const incoming = eligibleLinks.filter((l) => l.to_agent_id === targetAgentId);
        if (incoming.length === 0) continue;

        const predecessorSteps = incoming
          .map((link) => ({
            link,
            step: existingSteps.get(link.from_agent_id),
          }));

        const allPredecessorsFinished = predecessorSteps.every(
          (item) => item.step && item.step.status !== "running"
        );
        if (!allPredecessorsFinished) {
          continue;
        }

        const validInputs = predecessorSteps.filter(
          (item): item is { link: RoutineFlowLink; step: RoutineFlowStep } =>
            Boolean(
              item.step &&
                item.step.status === "succeeded" &&
                item.step.output !== null &&
                item.step.output.trim().length > 0
            )
        );

        if (validInputs.length === 0) {
          const skipped = this.flowStore.createStepIdempotent({
            flow_run_id: flowRun.flow_run_id,
            execucao_id: exec.execucao_id,
            agente_id: targetAgentId,
            input: "",
            output: null,
            status: "skipped",
            erro: "Ignorado em cascata (sem saída dos predecessores ou silenciado).",
          });
          if (skipped) {
            existingSteps.set(targetAgentId, skipped);
            this.wsHub.broadcast("routine_flow:updated", {
              affected_agent_ids: affectedAgents,
              rotina_id: exec.rotina_id,
              execucao_id: exec.execucao_id,
            });
          }
          continue;
        }

        const predecessorBlocks = validInputs.map(({ step }) => {
          const fromName = this.getAgentDisplayName(step.agente_id);
          return `[${fromName} respondeu:] ${step.output}`;
        });

        const linkInstructions = validInputs
          .map(({ link }) => link.instrucao.trim())
          .filter(Boolean);

        const combinedPrompt = [
          `A rotina "${routine.nome}" continua com você.`,
          "",
          predecessorBlocks.join("\n---\n"),
          ...(linkInstructions.length > 0 ? ["", linkInstructions.join("\n\n")] : []),
        ].join("\n");

        const createdStep = this.flowStore.createStepIdempotent({
          flow_run_id: flowRun.flow_run_id,
          execucao_id: exec.execucao_id,
          agente_id: targetAgentId,
          input: combinedPrompt,
          status: "running",
        });

        if (createdStep) {
          const targetAgentName = this.getAgentDisplayName(targetAgentId);
          const task = this.queue.enqueueTask({
            canal_origem: "rotina_cron",
            agente_id: targetAgentId,
            tipo: "fluxo_rotina",
            titulo: `${routine.nome} → ${targetAgentName}`,
            prioridade: 3,
            payload: {
              rotina_id: routine.rotina_id,
              rotina_execucao_id: exec.execucao_id,
              routine_flow_step_id: createdStep.step_id,
              flow_run_id: flowRun.flow_run_id,
              instrucao: combinedPrompt,
              target_canal_id:
                routine.run_in === "side_thread"
                  ? `rotina:${routine.rotina_id}`
                  : `agente:${targetAgentId}`,
              run_in: routine.run_in,
            },
          });

          const runningStep =
            this.flowStore.updateStep(createdStep.step_id, { tarefa_id: task.tarefa_id }) ??
            createdStep;
          existingSteps.set(targetAgentId, runningStep);

          this.wsHub.broadcast("task:queued", {
            tarefa_id: task.tarefa_id,
            tipo: task.tipo,
            titulo: task.titulo,
            prioridade: task.prioridade,
            canal_origem: task.canal_origem,
          });
          this.wsHub.broadcast("routine_flow:updated", {
            affected_agent_ids: affectedAgents,
            rotina_id: exec.rotina_id,
            execucao_id: exec.execucao_id,
          });
        }
      }

      // Verifica se todas as etapas alcançáveis terminaram
      const reachableAgents = Array.from(reachableFromOwner(exec.owner_id, eligibleLinks));
      const allStepsPresentAndSettled = reachableAgents.every((agentId) => {
        const s = existingSteps.get(agentId);
        return Boolean(s && s.status !== "running");
      });

      if (allStepsPresentAndSettled) {
        const stepsList = Array.from(existingSteps.values());
        const anyCancelled =
          rootStatus === "cancelled" || stepsList.some((s) => s.status === "cancelled");
        const anySucceeded = stepsList.some((s) => s.status === "succeeded");
        const finalStatus: RoutineFlowRun["status"] = anyCancelled
          ? "cancelled"
          : !anySucceeded && stepsList.some((s) => s.status === "failed")
            ? "failed"
            : "succeeded";

        this.flowStore.updateFlowRunStatus(flowRun.flow_run_id, finalStatus);
        this.wsHub.broadcast("routine_flow:updated", {
          affected_agent_ids: affectedAgents,
          rotina_id: exec.rotina_id,
          execucao_id: exec.execucao_id,
        });
      }
    }
  }

  public async onFlowStepTaskSettled(params: {
    stepId: string;
    status: "succeeded" | "failed" | "cancelled";
    output: string | null;
    erro: string | null;
  }): Promise<void> {
    const updated = this.flowStore.updateStep(params.stepId, {
      status: params.status,
      output: params.output,
      erro: params.erro,
    });

    if (updated) {
      const links = this.flowStore.listLinksByRoutine(
        this.routineStore.getRun(updated.execucao_id)?.rotina_id ?? ""
      );
      const exec = this.routineStore.getRun(updated.execucao_id);
      if (exec) {
        this.wsHub.broadcast("routine_flow:updated", {
          affected_agent_ids: collectAffectedAgents(exec.owner_id, links),
          rotina_id: exec.rotina_id,
          execucao_id: exec.execucao_id,
        });
      }
    }

    await this.sweep();
  }

  public async stopRun(
    execucaoId: string,
    reason = "Execução interrompida pelo usuário"
  ): Promise<{ cancelledTasks: number }> {
    let cancelledTasks = 0;
    const exec = this.routineStore.getRun(execucaoId);
    if (!exec) {
      return { cancelledTasks: 0 };
    }

    this.db.runInTransaction(() => {
      if (
        exec.status === "queued" ||
        exec.status === "running" ||
        exec.status === "needs-attention"
      ) {
        if (exec.tarefa_id) {
          const t = this.queue.getTask(exec.tarefa_id);
          if (
            t &&
            (t.status === "pendente" ||
              t.status === "executando" ||
              t.status === "aguardando_aprovacao")
          ) {
            this.queue.cancelTask(exec.tarefa_id, reason);
            cancelledTasks += 1;
          }
        }
        this.routineStore.updateRun(execucaoId, {
          status: "cancelled",
          erro: reason,
        });
      }

      const flowRun = this.flowStore.getFlowRunByExecucaoId(execucaoId);
      if (flowRun) {
        for (const step of flowRun.steps) {
          if (step.status === "running") {
            if (step.tarefa_id) {
              const st = this.queue.getTask(step.tarefa_id);
              if (
                st &&
                (st.status === "pendente" ||
                  st.status === "executando" ||
                  st.status === "aguardando_aprovacao")
              ) {
                this.queue.cancelTask(step.tarefa_id, reason);
                cancelledTasks += 1;
              }
            }
            this.flowStore.updateStep(step.step_id, {
              status: "cancelled",
              erro: reason,
            });
          }
        }

        const allLinks = this.flowStore
          .listLinksByRoutine(exec.rotina_id)
          .filter((l) => l.criado_em <= exec.criado_em);
        const reachable = Array.from(reachableFromOwner(exec.owner_id, allLinks));
        const existingSet = new Set(flowRun.steps.map((s) => s.agente_id));

        for (const agentId of reachable) {
          if (!existingSet.has(agentId)) {
            this.flowStore.createStepIdempotent({
              flow_run_id: flowRun.flow_run_id,
              execucao_id: execucaoId,
              agente_id: agentId,
              input: "",
              output: null,
              status: "skipped",
              erro: reason,
            });
          }
        }

        this.flowStore.updateFlowRunStatus(flowRun.flow_run_id, "cancelled");
      }
    });

    const links = this.flowStore.listLinksByRoutine(exec.rotina_id);
    this.wsHub.broadcast("routine:run_updated", {
      rotina_id: exec.rotina_id,
      execucao_id: exec.execucao_id,
      owner_kind: exec.owner_kind,
      owner_id: exec.owner_id,
      status: "cancelled",
      silenciada: exec.silenciada,
    });
    this.wsHub.broadcast("routine_flow:updated", {
      affected_agent_ids: collectAffectedAgents(exec.owner_id, links),
      rotina_id: exec.rotina_id,
      execucao_id: exec.execucao_id,
    });

    return { cancelledTasks };
  }

  public getCanvas(agenteId: string): RoutineFlowCanvas {
    const ownerRoutines = this.routineStore.listByOwner("agente", agenteId);
    const rotinaIds = ownerRoutines.map((r) => r.rotina_id);
    const links = this.flowStore.listLinksByRoutineIds(rotinaIds);
    const positions = this.flowStore.listPositions(agenteId);

    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 86_400_000);

    const rotinas = ownerRoutines.map((rotina) => {
      const recentRuns = this.routineStore.listRuns(rotina.rotina_id, {
        limit: 8,
        withSkipped: true,
      });
      const upcomingRuns =
        rotina.ativa && rotina.trigger_kind === "schedule" && rotina.schedule
          ? expandScheduleOccurrences(
              rotina.schedule,
              rotina.timezone || "America/Sao_Paulo",
              now,
              horizon,
              5
            ).map((d) => d.toISOString())
          : [];

      const activeFlowRun = this.flowStore.getLatestFlowRunByRoutine(rotina.rotina_id);

      return {
        rotina,
        recent_runs: recentRuns,
        upcoming_runs: upcomingRuns,
        active_flow_run: activeFlowRun,
      };
    });

    const placedSet = new Set<string>([agenteId]);
    for (const l of links) {
      placedSet.add(l.from_agent_id);
      placedSet.add(l.to_agent_id);
    }
    for (const p of positions) {
      if (p.node_key && !p.node_key.includes(":")) {
        placedSet.add(p.node_key);
      }
    }

    return {
      agente_id: agenteId,
      rotinas,
      links,
      positions,
      placed_agent_ids: Array.from(placedSet),
    };
  }
}
