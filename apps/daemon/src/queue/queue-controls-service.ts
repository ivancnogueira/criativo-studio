import type {
  AgenteThreadRegistro,
  AnexoChat,
  FilaChatEntrega,
  FilaChatSnapshot,
  ModoMensagemOcupado,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { AgentTasksService } from "../threads/agent-tasks-service.ts";
import type { ChatQueueStore } from "./chat-queue-store.ts";

export class QueueConflictError extends Error {
  public readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "QueueConflictError";
  }
}

export class QueueSteerUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueSteerUnsupportedError";
  }
}

interface ActiveLaneTurn {
  turnoId: string;
  entregaIds: string[];
  ownedByAgentIds: Set<string>;
  ownedByNonAgent: boolean;
  abortController: AbortController;
  steerInbox: string[];
}

export interface QueueControlsServiceDeps {
  db: CriativoDatabase;
  queueStore: ChatQueueStore;
  tasksService: AgentTasksService;
  wsHub: WebSocketHub;
  onLaneWake?: (agenteId: string, threadId: string | null) => void;
  supportsNativeSteer?: (agenteId: string) => boolean;
}

/**
 * Orquestra o controle granular da fila de mensagens do chat por lane `(agente_id, thread_id)`:
 * lock de edição, cancelamento, reordenação, `steer` com fallback e interrupção entre agentes.
 */
export class QueueControlsService {
  private readonly db: CriativoDatabase;
  private readonly queueStore: ChatQueueStore;
  private readonly tasksService: AgentTasksService;
  private readonly wsHub: WebSocketHub;
  private onLaneWake?: (agenteId: string, threadId: string | null) => void;
  private supportsNativeSteerFn: (agenteId: string) => boolean;

  private readonly activeTurnsByLane = new Map<string, ActiveLaneTurn>();

  constructor(deps: QueueControlsServiceDeps) {
    this.db = deps.db;
    this.queueStore = deps.queueStore;
    this.tasksService = deps.tasksService;
    this.wsHub = deps.wsHub;
    this.onLaneWake = deps.onLaneWake;
    this.supportsNativeSteerFn = deps.supportsNativeSteer ?? ((agenteId) => this.defaultSupportsSteer(agenteId));
  }

  public setOnLaneWake(cb: (agenteId: string, threadId: string | null) => void): void {
    this.onLaneWake = cb;
  }

  public setSupportsNativeSteer(fn: (agenteId: string) => boolean): void {
    this.supportsNativeSteerFn = fn;
  }

  public static buildLaneKey(agenteId: string, threadId: string | null): string {
    const normalized = threadId && !threadId.startsWith("main:") ? threadId : "main";
    return `${agenteId}:${normalized}`;
  }

  public hasActiveTurn(agenteId: string, threadId: string | null): boolean {
    const normalized = this.normalizeThreadId(threadId);
    return this.activeTurnsByLane.has(QueueControlsService.buildLaneKey(agenteId, normalized));
  }

  private normalizeThreadId(threadId: string | null | undefined): string | null {
    return threadId && !threadId.startsWith("main:") ? threadId : null;
  }

  private defaultSupportsSteer(agenteId: string): boolean {
    const row = this.db.connection
      .prepare("SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = ?;")
      .get(agenteId) as { modelo_padrao: string } | undefined;
    if (!row) return false;
    const lower = row.modelo_padrao.toLowerCase();
    // Modelos Ollama/CLI estritos sem inbox em tempo real não suportam steer nativo; modelos API multi-turn suportam
    return !lower.startsWith("ollama/") && !lower.includes("local");
  }

  private readBusyMode(agenteId: string): ModoMensagemOcupado {
    const row = this.db.connection
      .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ?;")
      .get(agenteId) as { config_json: string } | undefined;
    if (!row) return "steer";
    try {
      const cfg = JSON.parse(row.config_json) as { modo_ocupado?: unknown };
      return cfg.modo_ocupado === "queue" ? "queue" : "steer";
    } catch {
      return "steer";
    }
  }

  public registerActiveTurn(params: {
    agenteId: string;
    threadId: string | null;
    turnoId: string;
    deliveries: FilaChatEntrega[];
    abortController: AbortController;
  }): void {
    const laneKey = QueueControlsService.buildLaneKey(params.agenteId, params.threadId);
    const ownedByAgentIds = new Set<string>();
    let ownedByNonAgent = false;

    for (const d of params.deliveries) {
      if (d.remetente_tipo === "agente" && d.remetente_agente_id) {
        ownedByAgentIds.add(d.remetente_agente_id);
      } else {
        ownedByNonAgent = true;
      }
    }

    this.activeTurnsByLane.set(laneKey, {
      turnoId: params.turnoId,
      entregaIds: params.deliveries.map((d) => d.entrega_id),
      ownedByAgentIds,
      ownedByNonAgent,
      abortController: params.abortController,
      steerInbox: [],
    });
  }

  public addDeliveryToActiveTurn(agenteId: string, threadId: string | null, entrega: FilaChatEntrega): void {
    const lane = this.activeTurnsByLane.get(QueueControlsService.buildLaneKey(agenteId, threadId));
    if (!lane) return;
    lane.entregaIds.push(entrega.entrega_id);
    if (entrega.remetente_tipo === "agente" && entrega.remetente_agente_id) {
      lane.ownedByAgentIds.add(entrega.remetente_agente_id);
    } else {
      lane.ownedByNonAgent = true;
    }
  }

  public consumeSteerInbox(agenteId: string, threadId: string | null): string[] {
    const lane = this.activeTurnsByLane.get(QueueControlsService.buildLaneKey(agenteId, threadId));
    if (!lane || lane.steerInbox.length === 0) return [];
    const items = [...lane.steerInbox];
    lane.steerInbox.length = 0;
    return items;
  }

  public clearActiveTurn(agenteId: string, threadId: string | null, turnoId?: string): void {
    const key = QueueControlsService.buildLaneKey(agenteId, threadId);
    const current = this.activeTurnsByLane.get(key);
    if (!current) return;
    if (!turnoId || current.turnoId === turnoId) {
      this.activeTurnsByLane.delete(key);
    }
  }

  public isLaneBusy(agenteId: string, threadId: string | null): boolean {
    const key = QueueControlsService.buildLaneKey(agenteId, threadId);
    if (this.activeTurnsByLane.has(key)) return true;
    return this.queueStore.listLane(agenteId, this.normalizeThreadId(threadId)).length > 0;
  }

  public getLaneSnapshot(agenteId: string, threadId: string | null): FilaChatSnapshot {
    const normalized = this.normalizeThreadId(threadId);
    const snapshot = this.queueStore.getSnapshot(
      agenteId,
      normalized,
      this.readBusyMode(agenteId),
      this.supportsNativeSteerFn(agenteId),
    );
    return snapshot;
  }

  public emitQueueChanged(agenteId: string, threadId: string | null): FilaChatSnapshot {
    const normalized = this.normalizeThreadId(threadId);
    const snapshot = this.getLaneSnapshot(agenteId, normalized);
    this.wsHub.broadcast("chat_queue:changed", {
      agente_id: agenteId,
      thread_id: normalized,
      snapshot,
    });
    if (normalized) {
      this.tasksService.emitAgentSnapshot(agenteId);
    }
    return snapshot;
  }

  public enqueueMessage(input: {
    mensagemId: string;
    agenteId: string;
    threadId?: string | null;
    remetenteTipo: "usuario" | "agente" | "rotina" | "webhook";
    remetenteAgenteId?: string | null;
    rotinaId?: string | null;
    runId?: string | null;
    conteudoMarkdown: string;
    anexos?: AnexoChat[];
    respostaParaMensagemId?: string | null;
    esperaResposta?: boolean;
    chaveIdempotencia?: string | null;
    skipWake?: boolean;
  }): FilaChatEntrega {
    const normalizedThread = this.normalizeThreadId(input.threadId ?? null);
    const entrega = this.queueStore.enqueue({
      ...input,
      threadId: normalizedThread,
    });
    this.emitQueueChanged(input.agenteId, normalizedThread);
    if (!input.skipWake) {
      this.onLaneWake?.(input.agenteId, normalizedThread);
    }
    return entrega;
  }

  public handleEditAction(input: {
    agenteId: string;
    threadId: string | null;
    entregaId: string;
    acao: "begin" | "retain-attachments" | "save" | "cancel";
    editId: string;
    conteudo?: string;
    anexos?: AnexoChat[];
  }): FilaChatSnapshot {
    const normalizedThread = this.normalizeThreadId(input.threadId);
    if (input.acao === "begin") {
      const res = this.queueStore.beginEdit(input.entregaId, input.editId);
      if (!res.ok) {
        throw new QueueConflictError(res.motivo);
      }
      return this.emitQueueChanged(input.agenteId, normalizedThread);
    }

    if (input.acao === "retain-attachments") {
      const res = this.queueStore.retainAttachments(input.entregaId, input.editId, input.anexos ?? []);
      if (!res.ok) {
        throw new QueueConflictError(res.motivo);
      }
      return this.emitQueueChanged(input.agenteId, normalizedThread);
    }

    if (input.acao === "save") {
      const cleanText = (input.conteudo ?? "").trim();
      if (!cleanText) {
        throw new Error("A mensagem editada na fila não pode ficar vazia.");
      }
      const res = this.queueStore.saveEdit(input.entregaId, input.editId, cleanText, input.anexos);
      if (!res.ok) {
        throw new QueueConflictError(res.motivo);
      }
      this.db.connection
        .prepare("UPDATE projecao_conversas_chat SET conteudo_markdown = ? WHERE mensagem_id = ?;")
        .run(cleanText, res.entrega.mensagem_id);
      const snapshot = this.emitQueueChanged(input.agenteId, normalizedThread);
      this.onLaneWake?.(input.agenteId, normalizedThread);
      return snapshot;
    }

    const cancelRes = this.queueStore.cancelEdit(input.entregaId, input.editId);
    if (!cancelRes.ok) {
      throw new QueueConflictError(cancelRes.motivo);
    }
    const snapshot = this.emitQueueChanged(input.agenteId, normalizedThread);
    this.onLaneWake?.(input.agenteId, normalizedThread);
    return snapshot;
  }

  public cancelQueuedDelivery(
    agenteId: string,
    threadId: string | null,
    entregaId: string,
    deleteAfter = false,
  ): FilaChatSnapshot {
    const normalizedThread = this.normalizeThreadId(threadId);
    const existing = this.queueStore.getDelivery(entregaId);
    if (!existing || existing.agente_id !== agenteId) {
      throw new QueueConflictError("Entrega não encontrada na fila ou já processada.");
    }
    if (deleteAfter) {
      this.queueStore.deleteDelivery(entregaId);
    } else {
      const ok = this.queueStore.cancelDelivery(entregaId);
      if (!ok) {
        throw new QueueConflictError("Esta mensagem já entrou em execução e não pode ser cancelada na fila.");
      }
    }
    return this.emitQueueChanged(agenteId, normalizedThread);
  }

  public reorderQueuedDeliveries(
    agenteId: string,
    threadId: string | null,
    entregaIds: string[],
  ): FilaChatSnapshot {
    const normalizedThread = this.normalizeThreadId(threadId);
    this.queueStore.reorderLane(agenteId, normalizedThread, entregaIds);
    return this.emitQueueChanged(agenteId, normalizedThread);
  }

  public steerDelivery(
    agenteId: string,
    threadId: string | null,
    entregaId: string,
  ): {
    mode: "steered" | "fallback_send_now";
    reason?: "provedor_nao_suporta" | "falha_steer";
    entrega: FilaChatEntrega;
    snapshot: FilaChatSnapshot;
  } {
    const normalizedThread = this.normalizeThreadId(threadId);
    const entrega = this.queueStore.getDelivery(entregaId);
    if (!entrega || entrega.agente_id !== agenteId || entrega.status !== "enfileirada") {
      throw new QueueConflictError("Mensagem indisponível para direcionamento (steer).");
    }

    const laneKey = QueueControlsService.buildLaneKey(agenteId, normalizedThread);
    const activeTurn = this.activeTurnsByLane.get(laneKey);
    const supportsSteer = this.supportsNativeSteerFn(agenteId);

    if (activeTurn && supportsSteer) {
      activeTurn.steerInbox.push(entrega.conteudo_markdown);
      this.queueStore.markRunning(entrega.entrega_id, activeTurn.turnoId);
      const updated = this.queueStore.getDelivery(entrega.entrega_id) ?? entrega;
      this.addDeliveryToActiveTurn(agenteId, normalizedThread, updated);
      const snapshot = this.emitQueueChanged(agenteId, normalizedThread);
      return {
        mode: "steered",
        entrega: updated,
        snapshot,
      };
    }

    const reason: "provedor_nao_suporta" | "falha_steer" = supportsSteer
      ? "falha_steer"
      : "provedor_nao_suporta";
    this.queueStore.markSteerFallback(entrega.entrega_id, reason);

    const restIds = this.queueStore
      .listLane(agenteId, normalizedThread)
      .filter((d) => d.status === "enfileirada" && d.entrega_id !== entrega.entrega_id)
      .map((d) => d.entrega_id);
    this.queueStore.reorderLane(agenteId, normalizedThread, [entrega.entrega_id, ...restIds]);

    if (activeTurn && !activeTurn.abortController.signal.aborted) {
      activeTurn.abortController.abort(new Error("Prioridade redirecionada por Enviar agora."));
    }

    const updated = this.queueStore.getDelivery(entrega.entrega_id) ?? entrega;
    const snapshot = this.emitQueueChanged(agenteId, normalizedThread);
    this.onLaneWake?.(agenteId, normalizedThread);

    return {
      mode: "fallback_send_now",
      reason,
      entrega: updated,
      snapshot,
    };
  }

  public runQueuedMessageAsTask(
    agenteId: string,
    threadId: string | null,
    entregaId: string,
  ): { thread: AgenteThreadRegistro; snapshot: FilaChatSnapshot } {
    const normalizedThread = this.normalizeThreadId(threadId);
    const entrega = this.queueStore.getDelivery(entregaId);
    if (!entrega || entrega.agente_id !== agenteId || entrega.status !== "enfileirada") {
      throw new QueueConflictError("A mensagem selecionada não está mais na fila.");
    }

    const result = this.db.runInTransaction(() => {
      const ok = this.queueStore.cancelDelivery(entrega.entrega_id);
      if (!ok) {
        throw new QueueConflictError("Conflito ao mover mensagem da fila para tarefa paralela.");
      }
      return this.tasksService.createTaskThread({
        agenteId,
        origem: entrega.remetente_tipo === "agente" ? "agente" : "usuario",
        conteudo: entrega.conteudo_markdown,
        anexos: entrega.anexos,
        remetenteTipo: entrega.remetente_tipo,
        remetenteAgenteId: entrega.remetente_agente_id,
      });
    });

    const snapshot = this.emitQueueChanged(agenteId, normalizedThread);
    return {
      thread: result.thread,
      snapshot,
    };
  }

  public interruptAgentFromTool(
    callerAgentId: string,
    targetAgentId: string,
    reason?: string,
  ): {
    interruptedTurnId: string | null;
    cancelledMessages: number;
    runningTasks: number;
    runningChannelTask: boolean;
  } {
    if (callerAgentId === targetAgentId) {
      throw new Error("Um agente não pode usar interrupt_agent contra si mesmo.");
    }

    const targetRow = this.db.connection
      .prepare("SELECT agente_id, nome FROM projecao_agentes WHERE agente_id = ?;")
      .get(targetAgentId) as { agente_id: string; nome: string } | undefined;
    if (!targetRow) {
      throw new Error(`Agente alvo não encontrado: ${targetAgentId}`);
    }

    const laneEntregas = this.queueStore.listLane(targetAgentId, null);
    let cancelledMessages = 0;
    for (const ent of laneEntregas) {
      if (
        ent.status === "enfileirada" &&
        ent.remetente_tipo === "agente" &&
        ent.remetente_agente_id === callerAgentId &&
        ent.espera_resposta
      ) {
        if (this.queueStore.cancelDelivery(ent.entrega_id)) {
          cancelledMessages += 1;
        }
      }
    }

    const laneKey = QueueControlsService.buildLaneKey(targetAgentId, null);
    const activeTurn = this.activeTurnsByLane.get(laneKey);
    let interruptedTurnId: string | null = null;

    if (
      activeTurn &&
      !activeTurn.ownedByNonAgent &&
      activeTurn.ownedByAgentIds.size === 1 &&
      activeTurn.ownedByAgentIds.has(callerAgentId)
    ) {
      interruptedTurnId = activeTurn.turnoId;
      if (!activeTurn.abortController.signal.aborted) {
        activeTurn.abortController.abort(
          new Error(reason?.trim() || `Interrompido por ${callerAgentId}.`),
        );
      }
      for (const id of activeTurn.entregaIds) {
        this.queueStore.markFinished(
          id,
          "interrompida",
          reason?.trim() || `Turno interrompido pelo agente '${callerAgentId}'.`,
        );
      }
      if (reason?.trim()) {
        this.queueStore.enqueue({
          mensagemId: `msg-int-${Date.now()}`,
          agenteId: targetAgentId,
          threadId: null,
          remetenteTipo: "agente",
          remetenteAgenteId: callerAgentId,
          conteudoMarkdown: `[Aviso de interrupção de @${callerAgentId}]: ${reason.trim()}`,
          esperaResposta: false,
        });
      }
    }

    if (cancelledMessages > 0 || interruptedTurnId) {
      this.emitQueueChanged(targetAgentId, null);
    }

    const runningTasksRow = this.db.connection
      .prepare(
        "SELECT COUNT(*) AS total FROM projecao_agente_threads WHERE agente_id = ? AND estado IN ('executando', 'enfileirada');",
      )
      .get(targetAgentId) as { total: number };

    return {
      interruptedTurnId,
      cancelledMessages,
      runningTasks: runningTasksRow.total,
      runningChannelTask: false,
    };
  }

  public interruptActiveTurnFromUi(agenteId: string, threadId: string | null): {
    interrupted: boolean;
    turnoId: string | null;
  } {
    const normalizedThread = this.normalizeThreadId(threadId);
    const key = QueueControlsService.buildLaneKey(agenteId, normalizedThread);
    const activeTurn = this.activeTurnsByLane.get(key);

    let interrupted = false;
    let turnoId: string | null = activeTurn?.turnoId ?? null;

    if (activeTurn && !activeTurn.abortController.signal.aborted) {
      activeTurn.abortController.abort(new Error("Interrompido manualmente pelo usuário."));
      interrupted = true;
      for (const id of activeTurn.entregaIds) {
        this.queueStore.markFinished(id, "interrompida", "Turno interrompido pelo usuário.");
      }
    }

    const threadKey = normalizedThread ?? `main:${agenteId}`;
    const stopped = this.tasksService.stopThreadOrChat(threadKey);
    if (stopped.interrupted) {
      interrupted = true;
      turnoId = turnoId ?? stopped.turnoId;
    }

    if (interrupted) {
      this.emitQueueChanged(agenteId, normalizedThread);
    }

    return { interrupted, turnoId };
  }
}
