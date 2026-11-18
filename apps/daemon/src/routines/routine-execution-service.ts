import { randomUUID } from "node:crypto";
import type { AgentRoutine, RoutineRun } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import {
  collapseMissedOccurrences,
  computeNextRoutineOccurrence,
} from "./routine-schedule-calc.ts";
import type { RoutineResultDispatcher } from "./routine-result-dispatcher.ts";
import type { RoutineStore } from "./routine-store.ts";
import type { RoutineTimer } from "./routine-timer.ts";

export interface RoutineExecutionServiceOptions {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  routineStore: RoutineStore;
  dispatcher: RoutineResultDispatcher;
  wsHub: WebSocketHub;
  providerConnection: ProviderConnectionService;
  timer?: RoutineTimer;
  usageLimited?: (agentId: string) => Promise<boolean> | boolean;
  onRunSettled?: (execucaoId: string) => Promise<void> | void;
}

const SILENT_FALLBACK_MARKERS = new Set(["[[no-update]]", "[silent]"]);

/**
 * Orquestra disparos de rotinas agendadas e manuais, política `limitPolicy` (`wait`/`skip`),
 * colapso pós-queda (`skipMissed`), isolamento `side_thread`, detecção de modo silencioso
 * (`routine_no_update`) e entregas pós-execução.
 */
export class RoutineExecutionService {
  private readonly db: CriativoDatabase;
  private readonly queue: FifoQueueManager;
  private readonly routineStore: RoutineStore;
  private readonly dispatcher: RoutineResultDispatcher;
  private readonly wsHub: WebSocketHub;
  private readonly providerConnection: ProviderConnectionService;
  private timer?: RoutineTimer;
  private readonly usageLimitedHook?: (agentId: string) => Promise<boolean> | boolean;
  private onRunSettled?: (execucaoId: string) => Promise<void> | void;

  constructor(options: RoutineExecutionServiceOptions) {
    this.db = options.db;
    this.queue = options.queue;
    this.routineStore = options.routineStore;
    this.dispatcher = options.dispatcher;
    this.wsHub = options.wsHub;
    this.providerConnection = options.providerConnection;
    this.timer = options.timer;
    this.usageLimitedHook = options.usageLimited;
    this.onRunSettled = options.onRunSettled;
  }

  public setTimer(timer: RoutineTimer): void {
    this.timer = timer;
  }

  public setOnRunSettled(handler: (execucaoId: string) => Promise<void> | void): void {
    this.onRunSettled = handler;
  }

  public resolveTargetChatCanalId(routine: AgentRoutine): string {
    if (routine.run_in === "side_thread") {
      return `rotina:${routine.rotina_id}`;
    }
    if (routine.owner_kind === "canal") {
      return routine.owner_id;
    }
    return `agente:${routine.owner_id}`;
  }

  public async isProviderUsageLimited(agentId: string): Promise<boolean> {
    if (this.usageLimitedHook) {
      return await this.usageLimitedHook(agentId);
    }

    try {
      const agRow = this.db.connection
        .prepare(`SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
        .get(agentId) as { modelo_padrao?: string } | undefined;

      const modelo = (agRow?.modelo_padrao ?? "").toLowerCase();
      const targetProvider = modelo.includes("claude")
        ? "claude"
        : modelo.includes("gpt") || modelo.startsWith("o")
          ? "openai"
          : "gemini";

      const snap = await this.providerConnection.getUsageSnapshot(false);
      const accounts = (snap.contas ?? []).filter((c) => c.provedor === targetProvider);
      if (accounts.length === 0) return false;

      const allExhausted = accounts.every((acc) =>
        acc.grupos_cota.some(
          (g) =>
            (g.janela_5h && g.janela_5h.restante_percentual <= 0) ||
            (g.janela_semanal && g.janela_semanal.restante_percentual <= 0)
        )
      );
      return allExhausted;
    } catch {
      return false;
    }
  }

  public async skipMissed(now = new Date()): Promise<number> {
    const dueRoutines = this.routineStore.listDueScheduledRoutines(now.toISOString());
    let adjusted = 0;

    for (const routine of dueRoutines) {
      if (!routine.schedule || !routine.next_run_at) continue;
      const dueDate = new Date(routine.next_run_at);
      if (Number.isNaN(dueDate.getTime())) continue;

      const collapsed = collapseMissedOccurrences({
        schedule: routine.schedule,
        timezone: routine.timezone || "America/Sao_Paulo",
        currentDueAt: dueDate,
        now,
        missedPolicy: routine.missed_policy,
      });

      if (collapsed.missedCount > 0) {
        const missedRun = this.routineStore.createRun({
          rotina_id: routine.rotina_id,
          owner_kind: routine.owner_kind,
          owner_id: routine.owner_id,
          run_kind: "scheduled",
          run_source: null,
          scheduled_for: collapsed.missedUntil ?? routine.next_run_at,
          rotina_nome: routine.nome,
          instrucao: routine.instrucao,
          status: "cancelled",
          silenciada: false,
          erro: `${collapsed.missedCount} ocorrências perdidas enquanto o servidor esteve desligado.`,
          missed_count: collapsed.missedCount,
          missed_until: collapsed.missedUntil,
        });
        if (missedRun) {
          this.wsHub.broadcast("routine:run_updated", {
            rotina_id: routine.rotina_id,
            execucao_id: missedRun.execucao_id,
            owner_kind: routine.owner_kind,
            owner_id: routine.owner_id,
            status: "cancelled",
            silenciada: false,
          });
        }
      }

      if (collapsed.runDueAt) {
        this.routineStore.advanceRoutineSchedule(
          routine.rotina_id,
          collapsed.runDueAt.toISOString(),
          false
        );
      } else {
        const isOnceExhausted = routine.schedule.kind === "once";
        this.routineStore.advanceRoutineSchedule(
          routine.rotina_id,
          collapsed.nextRunAt?.toISOString() ?? null,
          isOnceExhausted
        );
        if (isOnceExhausted) {
          this.wsHub.broadcast("routine:updated", {
            owner_kind: routine.owner_kind,
            owner_id: routine.owner_id,
            rotina_id: routine.rotina_id,
            acao: "updated",
          });
        }
      }

      adjusted += 1;
    }

    this.timer?.arm();
    return adjusted;
  }

  public async processDueRoutines(now = new Date()): Promise<string[]> {
    const nowIso = now.toISOString();
    const dueRoutines = this.routineStore.listDueScheduledRoutines(nowIso);
    const createdExecIds: string[] = [];

    for (const routine of dueRoutines) {
      if (!routine.schedule) continue;

      const isOnce = routine.schedule.kind === "once";
      const scheduledFor = routine.next_run_at ?? nowIso;
      const nextOccurrence = isOnce
        ? null
        : computeNextRoutineOccurrence(
            routine.schedule,
            routine.timezone || "America/Sao_Paulo",
            now
          );
      const nextRunIso = isOnce ? routine.next_run_at : (nextOccurrence?.toISOString() ?? null);

      const hasOpen = this.routineStore.hasOpenRun(routine.rotina_id);
      const quotaExhausted = await this.isProviderUsageLimited(routine.owner_id);

      if ((hasOpen || quotaExhausted) && routine.limit_policy === "skip" && !isOnce) {
        const skippedRun = this.routineStore.createRun({
          rotina_id: routine.rotina_id,
          owner_kind: routine.owner_kind,
          owner_id: routine.owner_id,
          run_kind: "scheduled",
          run_source: null,
          scheduled_for: scheduledFor,
          rotina_nome: routine.nome,
          instrucao: routine.instrucao,
          status: "cancelled",
          erro: hasOpen
            ? "Ocorrência pulada devido a execução anterior ainda em andamento."
            : "Ocorrência pulada por limite de cota do provedor.",
        });

        this.routineStore.advanceRoutineSchedule(routine.rotina_id, nextRunIso, false);

        if (skippedRun) {
          this.wsHub.broadcast("routine:run_updated", {
            rotina_id: routine.rotina_id,
            execucao_id: skippedRun.execucao_id,
            owner_kind: routine.owner_kind,
            owner_id: routine.owner_id,
            status: "cancelled",
            silenciada: false,
          });
        }
        continue;
      }

      if (hasOpen && (routine.limit_policy === "wait" || isOnce)) {
        // Evita disparo duplicado enquanto a execução atual está em fila/andamento
        continue;
      }

      const targetCanalId = this.resolveTargetChatCanalId(routine);
      const threadId = routine.run_in === "side_thread" ? targetCanalId : null;

      const exec = this.routineStore.createRun({
        rotina_id: routine.rotina_id,
        owner_kind: routine.owner_kind,
        owner_id: routine.owner_id,
        run_kind: "scheduled",
        run_source: null,
        scheduled_for: scheduledFor,
        rotina_nome: routine.nome,
        instrucao: routine.instrucao,
        thread_id: threadId,
        status: "queued",
      });

      if (!exec) {
        // Índice de idempotência evitou execução duplicada do mesmo scheduled_for
        this.routineStore.advanceRoutineSchedule(routine.rotina_id, nextRunIso, isOnce);
        continue;
      }

      const task = this.queue.enqueueTask({
        canal_origem: "rotina_cron",
        agente_id: routine.owner_kind === "agente" ? routine.owner_id : null,
        tipo: "rotina_agendada",
        titulo: routine.nome,
        prioridade: 4,
        payload: {
          rotina_id: routine.rotina_id,
          rotina_execucao_id: exec.execucao_id,
          owner_kind: routine.owner_kind,
          owner_id: routine.owner_id,
          run_in: routine.run_in,
          run_kind: "scheduled",
          run_source: null,
          instrucao: routine.instrucao,
          target_canal_id: targetCanalId,
        },
      });

      this.routineStore.updateRun(exec.execucao_id, { tarefa_id: task.tarefa_id });
      this.routineStore.advanceRoutineSchedule(routine.rotina_id, nextRunIso, isOnce);

      createdExecIds.push(exec.execucao_id);

      this.wsHub.broadcast("task:queued", {
        tarefa_id: task.tarefa_id,
        tipo: task.tipo,
        titulo: task.titulo,
        prioridade: task.prioridade,
        canal_origem: task.canal_origem,
      });

      this.wsHub.broadcast("routine:run_updated", {
        rotina_id: routine.rotina_id,
        execucao_id: exec.execucao_id,
        owner_kind: routine.owner_kind,
        owner_id: routine.owner_id,
        status: "queued",
        silenciada: false,
      });

      if (isOnce) {
        this.wsHub.broadcast("routine:updated", {
          owner_kind: routine.owner_kind,
          owner_id: routine.owner_id,
          rotina_id: routine.rotina_id,
          acao: "updated",
        });
      }
    }

    return createdExecIds;
  }

  public enqueueManualRun(params: {
    rotinaId: string;
    runSource: "test" | "webhook" | "script";
    instrucaoOverride?: string;
    scheduledFor?: string;
  }): RoutineRun {
    const routine = this.routineStore.getById(params.rotinaId);
    if (!routine) {
      throw new Error(`Rotina '${params.rotinaId}' não encontrada.`);
    }

    const agoraIso = new Date().toISOString();
    const instrucaoEfetiva = (params.instrucaoOverride ?? routine.instrucao).trim();
    const targetCanalId = this.resolveTargetChatCanalId(routine);
    const threadId = routine.run_in === "side_thread" ? targetCanalId : null;

    const exec = this.routineStore.createRun({
      rotina_id: routine.rotina_id,
      owner_kind: routine.owner_kind,
      owner_id: routine.owner_id,
      run_kind: "manual",
      run_source: params.runSource,
      scheduled_for: params.scheduledFor ?? agoraIso,
      rotina_nome: routine.nome,
      instrucao: instrucaoEfetiva,
      thread_id: threadId,
      status: "queued",
    });

    if (!exec) {
      throw new Error("Não foi possível registrar execução manual da rotina.");
    }

    const canalOrigem = params.runSource === "webhook" ? "webhook" : "rotina_cron";
    const task = this.queue.enqueueTask({
      canal_origem: canalOrigem,
      agente_id: routine.owner_kind === "agente" ? routine.owner_id : null,
      tipo: params.runSource === "webhook" ? "rotina_webhook" : "rotina_manual",
      titulo: routine.nome,
      prioridade: params.runSource === "test" ? 2 : 3,
      payload: {
        rotina_id: routine.rotina_id,
        rotina_execucao_id: exec.execucao_id,
        owner_kind: routine.owner_kind,
        owner_id: routine.owner_id,
        run_in: routine.run_in,
        run_kind: "manual",
        run_source: params.runSource,
        instrucao: instrucaoEfetiva,
        target_canal_id: targetCanalId,
      },
    });

    const updated = this.routineStore.updateRun(exec.execucao_id, { tarefa_id: task.tarefa_id })!;

    this.wsHub.broadcast("task:queued", {
      tarefa_id: task.tarefa_id,
      tipo: task.tipo,
      titulo: task.titulo,
      prioridade: task.prioridade,
      canal_origem: task.canal_origem,
    });

    this.wsHub.broadcast("routine:run_updated", {
      rotina_id: routine.rotina_id,
      execucao_id: updated.execucao_id,
      owner_kind: routine.owner_kind,
      owner_id: routine.owner_id,
      status: "queued",
      silenciada: false,
    });

    return updated;
  }

  public markExecutionRunning(execucaoId: string): RoutineRun | null {
    const exec = this.routineStore.updateRun(execucaoId, { status: "running" });
    if (exec) {
      this.wsHub.broadcast("routine:run_updated", {
        rotina_id: exec.rotina_id,
        execucao_id: exec.execucao_id,
        owner_kind: exec.owner_kind,
        owner_id: exec.owner_id,
        status: "running",
        silenciada: exec.silenciada,
      });
    }
    return exec;
  }

  public cancelExecution(execucaoId: string, reason = "Execução cancelada pelo usuário"): RoutineRun | null {
    const current = this.routineStore.getRun(execucaoId);
    if (!current) return null;

    if (current.tarefa_id) {
      const task = this.queue.getTask(current.tarefa_id);
      if (task && (task.status === "pendente" || task.status === "executando" || task.status === "aguardando_aprovacao")) {
        this.queue.cancelTask(current.tarefa_id, reason);
      }
    }

    const updated = this.routineStore.updateRun(execucaoId, {
      status: "cancelled",
      erro: reason,
    });

    if (updated) {
      this.wsHub.broadcast("routine:run_updated", {
        rotina_id: updated.rotina_id,
        execucao_id: updated.execucao_id,
        owner_kind: updated.owner_kind,
        owner_id: updated.owner_id,
        status: "cancelled",
        silenciada: updated.silenciada,
      });
    }
    return updated;
  }

  private recordChatEntry(params: {
    canalId: string;
    agenteId: string | null;
    autor: "agente" | "sistema";
    autorNome: string;
    markdown: string;
    tarefaId: string | null;
    lida: boolean;
    broadcast: boolean;
  }): void {
    const msgId = `msg-exec-${randomUUID()}`;
    const agora = new Date().toISOString();

    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome,
          conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?);
      `
      )
      .run(
        msgId,
        params.canalId,
        params.agenteId,
        params.autor,
        params.autorNome,
        params.markdown,
        params.tarefaId,
        params.lida ? 1 : 0,
        agora
      );

    if (params.broadcast) {
      this.wsHub.broadcast("chat:message", {
        canal_id: params.canalId,
        agente_id: params.agenteId,
        mensagem: {
          mensagem_id: msgId,
          canal_id: params.canalId,
          agente_id: params.agenteId,
          autor: params.autor,
          autor_nome: params.autorNome,
          conteudo_markdown: params.markdown,
          anexos: [],
          steps: [],
          tarefa_id: params.tarefaId,
          lida: params.lida,
          criado_em: agora,
        },
      });
    }
  }

  public async completeRoutineTaskExecution(params: {
    execucaoId: string;
    finalText: string;
    artifacts: string[];
    noUpdateCalled: boolean;
    failureReason: string | null;
    erro?: string | null;
  }): Promise<RoutineRun | null> {
    const exec = this.routineStore.getRun(params.execucaoId);
    const routine = exec ? this.routineStore.getById(exec.rotina_id) : null;
    if (!exec || !routine) return null;

    const targetCanalId = this.resolveTargetChatCanalId(routine);
    const trimmedText = (params.finalText ?? "").trim();
    const isFallbackSilent = SILENT_FALLBACK_MARKERS.has(trimmedText.toLowerCase());
    const silentEligible =
      exec.run_kind === "scheduled" ||
      exec.run_source === "webhook" ||
      exec.run_source === "script";

    const hasFailure = Boolean(params.failureReason || params.erro);
    if (hasFailure) {
      const failureMsg = params.failureReason || params.erro || "Falha na execução da rotina.";
      const updated = this.routineStore.updateRun(exec.execucao_id, {
        status: "failed",
        silenciada: false,
        erro: failureMsg,
        resultado_resumo: trimmedText ? trimmedText.slice(0, 1200) : null,
      });

      this.recordChatEntry({
        canalId: targetCanalId,
        agenteId: routine.owner_kind === "agente" ? routine.owner_id : null,
        autor: "sistema",
        autorNome: routine.nome,
        markdown: `⚠️ **Rotina "${routine.nome}" falhou:** ${failureMsg}`,
        tarefaId: exec.tarefa_id ?? null,
        lida: routine.run_in === "side_thread",
        broadcast: routine.run_in !== "side_thread",
      });

      if (updated) {
        this.wsHub.broadcast("routine:run_updated", {
          rotina_id: routine.rotina_id,
          execucao_id: updated.execucao_id,
          owner_kind: routine.owner_kind,
          owner_id: routine.owner_id,
          status: "failed",
          silenciada: false,
        });
      }
      await this.onRunSettled?.(exec.execucao_id);
      return updated;
    }

    const isSilenced =
      silentEligible &&
      (params.noUpdateCalled || isFallbackSilent) &&
      params.artifacts.length === 0;

    if (isSilenced) {
      const updated = this.routineStore.updateRun(exec.execucao_id, {
        status: "succeeded",
        silenciada: true,
        erro: null,
        resultado_resumo: null,
      });

      this.recordChatEntry({
        canalId: targetCanalId,
        agenteId: routine.owner_kind === "agente" ? routine.owner_id : null,
        autor: "sistema",
        autorNome: routine.nome,
        markdown: `• Rotina "${routine.nome}" verificada sem novidades.`,
        tarefaId: exec.tarefa_id ?? null,
        lida: true,
        broadcast: false,
      });

      await this.dispatcher.dispatchDelivery({
        execucao: updated ?? exec,
        routine,
        contentText: "",
        artifacts: [],
        silenced: true,
      });

      if (updated) {
        this.wsHub.broadcast("routine:run_updated", {
          rotina_id: routine.rotina_id,
          execucao_id: updated.execucao_id,
          owner_kind: routine.owner_kind,
          owner_id: routine.owner_id,
          status: "succeeded",
          silenciada: true,
        });
      }
      await this.onRunSettled?.(exec.execucao_id);
      return updated;
    }

    const resumo = trimmedText.slice(0, 1200);
    const updated = this.routineStore.updateRun(exec.execucao_id, {
      status: "succeeded",
      silenciada: false,
      erro: null,
      resultado_resumo: resumo,
    });

    if (trimmedText.length > 0) {
      this.recordChatEntry({
        canalId: targetCanalId,
        agenteId: routine.owner_kind === "agente" ? routine.owner_id : null,
        autor: "agente",
        autorNome: routine.nome,
        markdown: trimmedText,
        tarefaId: exec.tarefa_id ?? null,
        lida: routine.run_in === "side_thread",
        broadcast: routine.run_in !== "side_thread",
      });
    }

    await this.dispatcher.dispatchDelivery({
      execucao: updated ?? exec,
      routine,
      contentText: trimmedText,
      artifacts: params.artifacts,
      silenced: false,
    });

    if (updated) {
      this.wsHub.broadcast("routine:run_updated", {
        rotina_id: routine.rotina_id,
        execucao_id: updated.execucao_id,
        owner_kind: routine.owner_kind,
        owner_id: routine.owner_id,
        status: "succeeded",
        silenciada: false,
      });
    }
    await this.onRunSettled?.(exec.execucao_id);
    return updated;
  }
}
