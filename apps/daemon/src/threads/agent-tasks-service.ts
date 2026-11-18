import { createHash, randomUUID } from "node:crypto";
import type {
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  MensagemChat,
  OrigemThread,
  TarefaRegistro,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { ChatQueueStore } from "../queue/chat-queue-store.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { AgentThreadStore } from "./agent-thread-store.ts";

export interface AgentTasksServiceDeps {
  db: CriativoDatabase;
  threadStore: AgentThreadStore;
  queue: FifoQueueManager;
  queueStore: ChatQueueStore;
  wsHub: WebSocketHub;
  onLaneWake?: (agenteId: string, threadId: string | null) => void;
}

export interface CreateTaskThreadInput {
  agenteId: string;
  origem: OrigemThread;
  titulo?: string;
  conteudo: string;
  anexos?: AnexoChat[];
  prioridade?: number;
  clientMessageId?: string;
  rotinaId?: string | null;
  bypassOpenLimit?: boolean;
  remetenteTipo?: "usuario" | "agente" | "rotina" | "webhook";
  remetenteAgenteId?: string | null;
  esperaResposta?: boolean;
  respostaParaMensagemId?: string | null;
}

/**
 * Orquestra sub-conversas paralelas, ferramenta `start_task`, ramificações (`branch`),
 * limites de concorrência/arquivamento e controle isolado de `AbortController` por thread.
 */
export class AgentTasksService {
  private readonly db: CriativoDatabase;
  private readonly threadStore: AgentThreadStore;
  private readonly queue: FifoQueueManager;
  private readonly queueStore: ChatQueueStore;
  private readonly wsHub: WebSocketHub;
  private onLaneWake?: (agenteId: string, threadId: string | null) => void;

  private readonly abortControllersByThread = new Map<string, AbortController>();
  private readonly abortControllersByTurn = new Map<string, AbortController>();

  constructor(deps: AgentTasksServiceDeps) {
    this.db = deps.db;
    this.threadStore = deps.threadStore;
    this.queue = deps.queue;
    this.queueStore = deps.queueStore;
    this.wsHub = deps.wsHub;
    this.onLaneWake = deps.onLaneWake;
  }

  public setOnLaneWake(cb: (agenteId: string, threadId: string | null) => void): void {
    this.onLaneWake = cb;
  }

  private assertAgentExists(agenteId: string): { agente_id: string; modelo_padrao: string; config_json: string } {
    const row = this.db.connection
      .prepare("SELECT agente_id, modelo_padrao, config_json FROM projecao_agentes WHERE agente_id = ?;")
      .get(agenteId) as { agente_id: string; modelo_padrao: string; config_json: string } | undefined;
    if (!row) {
      throw new Error(`Agente não encontrado: ${agenteId}`);
    }
    return row;
  }

  public supportsConcurrentTurns(modelName: string): boolean {
    const lower = modelName.toLowerCase();
    // Provedores API/ACP suportam até 4 turnos paralelos; Ollama local ou single-turn respeitam 1 se configurado
    return !lower.startsWith("ollama/") && !lower.includes("local");
  }

  public getConcurrencyLimit(agenteId: string): number {
    const row = this.db.connection
      .prepare("SELECT modelo_padrao, config_json FROM projecao_agentes WHERE agente_id = ?;")
      .get(agenteId) as { modelo_padrao: string; config_json: string } | undefined;
    if (!row) return 1;
    try {
      const cfg = JSON.parse(row.config_json) as { task_limit?: unknown };
      if (typeof cfg.task_limit === "number" && Number.isFinite(cfg.task_limit)) {
        return Math.max(1, Math.min(4, Math.floor(cfg.task_limit)));
      }
    } catch {
      // usa padrão do provedor
    }
    return this.supportsConcurrentTurns(row.modelo_padrao) ? 4 : 1;
  }

  public getAgentSnapshot(agenteId: string): AgenteThreadsSnapshot {
    const limit = this.getConcurrencyLimit(agenteId);
    const base = this.threadStore.listThreadsByAgent(agenteId, limit);
    const enriched = base.threads.map((thread) => {
      const fila = this.queueStore.listLane(agenteId, thread.thread_id);
      const mensagensEnfileiradas = fila
        .filter((f) => f.status === "enfileirada" || f.status === "iniciando")
        .map((f) => ({
          entrega_id: f.entrega_id,
          texto: f.conteudo_markdown,
          criado_em: f.criado_em,
        }));
      return {
        ...thread,
        fila,
        mensagens_enfileiradas: mensagensEnfileiradas,
      };
    });

    return {
      agente_id: agenteId,
      threads: enriched,
      limite_concorrencia: limit,
    };
  }

  public listAllThreads(): AgenteThreadRegistro[] {
    return this.threadStore.listAllThreads();
  }

  public emitAgentSnapshot(agenteId: string): AgenteThreadsSnapshot {
    const snapshot = this.getAgentSnapshot(agenteId);
    this.wsHub.broadcast("threads:changed", {
      agente_id: agenteId,
      snapshot,
    });
    return snapshot;
  }

  public createTaskThread(input: CreateTaskThreadInput): {
    thread: AgenteThreadRegistro;
    tarefa: TarefaRegistro;
    mensagem: MensagemChat;
  } {
    this.assertAgentExists(input.agenteId);
    const cleanContent = input.conteudo.trim();
    if (!cleanContent) {
      throw new Error("O conteúdo inicial da tarefa paralela não pode estar vazio.");
    }

    const computedTitle =
      input.titulo?.trim().slice(0, 140) ||
      cleanContent.replace(/\s+/g, " ").slice(0, 72) ||
      "Nova tarefa";
    const threadId = `thread-${randomUUID()}`;
    const msgId = `msg-${randomUUID()}`;
    const agora = new Date().toISOString();

    const created = this.db.runInTransaction(() => {
      const tarefa = this.queue.enqueueTask({
        agente_id: input.agenteId,
        canal_origem: "web",
        tipo: "subtarefa_paralela",
        titulo: computedTitle,
        prioridade: input.prioridade ?? 4,
        payload: {
          tema: cleanContent,
          thread_id: threadId,
          origem: input.origem,
          anexos: input.anexos ?? [],
        },
      });

      this.db.connection
        .prepare("UPDATE projecao_tarefas SET thread_id = ?, origem = ? WHERE tarefa_id = ?;")
        .run(threadId, input.rotinaId ? "rotina" : input.origem, tarefa.tarefa_id);

      const thread = this.threadStore.createThread({
        threadId,
        agenteId: input.agenteId,
        tarefaId: tarefa.tarefa_id,
        origem: input.origem,
        titulo: computedTitle,
        tituloOrigem: input.titulo ? (input.origem === "agente" ? "agente" : "usuario") : "auto",
        estado: "enfileirada",
        progressoAtual: "Na fila de execução paralela",
        rotinaId: input.rotinaId ?? null,
        bypassOpenLimit: input.bypassOpenLimit,
      });

      const canalId = `thread:${threadId}`;
      const anexosJson = JSON.stringify(input.anexos ?? []);
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, lida, criado_em,
            thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
            ordinal, branch_origem_mensagem_id, metadados_json
          ) VALUES (?, ?, ?, 'usuario', ?, ?, ?, '[]', ?, 1, ?, ?, NULL, 'mensagem', 'completed', ?, 0, NULL, '{}');
        `,
        )
        .run(
          msgId,
          canalId,
          input.agenteId,
          input.origem === "agente" ? "Delegação interna" : "Você",
          cleanContent,
          anexosJson,
          tarefa.tarefa_id,
          agora,
          threadId,
          input.respostaParaMensagemId ?? null,
        );

      const remetenteTipo = input.remetenteTipo ?? (input.rotinaId ? "rotina" : input.origem);
      this.queueStore.enqueue({
        mensagemId: msgId,
        agenteId: input.agenteId,
        threadId,
        remetenteTipo,
        remetenteAgenteId: input.remetenteAgenteId ?? (input.origem === "agente" ? input.agenteId : null),
        rotinaId: input.rotinaId ?? null,
        conteudoMarkdown: cleanContent,
        anexos: input.anexos ?? [],
        respostaParaMensagemId: input.respostaParaMensagemId ?? null,
        esperaResposta: input.esperaResposta ?? true,
        chaveIdempotencia: input.clientMessageId ? `thread-msg:${input.clientMessageId}` : null,
      });

      const mensagem: MensagemChat = {
        mensagem_id: msgId,
        canal_id: canalId,
        agente_id: input.agenteId,
        autor: "usuario",
        autor_nome: input.origem === "agente" ? "Delegação interna" : "Você",
        conteudo_markdown: cleanContent,
        anexos: input.anexos ?? [],
        steps: [],
        tarefa_id: tarefa.tarefa_id,
        thread_id: threadId,
        item_type: "mensagem",
        status: "completed",
        ordinal: 0,
        lida: true,
        criado_em: agora,
      };

      const reloadedTask = this.queue.getTask(tarefa.tarefa_id) ?? tarefa;
      return { thread: this.threadStore.getThread(thread.thread_id) ?? thread, tarefa: reloadedTask, mensagem };
    });

    this.wsHub.broadcast("task:queued", {
      tarefa_id: created.tarefa.tarefa_id,
      tipo: created.tarefa.tipo,
      titulo: created.tarefa.titulo,
      prioridade: created.tarefa.prioridade,
      canal_origem: created.tarefa.canal_origem,
    });
    this.wsHub.broadcast("thread:message", {
      agente_id: input.agenteId,
      thread_id: created.thread.thread_id,
      mensagem: created.mensagem,
    });
    this.emitAgentSnapshot(input.agenteId);
    this.onLaneWake?.(input.agenteId, created.thread.thread_id);

    return created;
  }

  /**
   * Executa a ferramenta `start_task` validando origem, tamanhos, idempotência SHA-256 e limites.
   */
  public startTaskFromTool(
    ctx: {
      agenteId: string;
      callerThreadId: string | null;
      callerChannelId: string | null;
      turnoId: string;
      callId: string;
    },
    args: { title: string; brief: string },
  ): { taskId: string; threadId: string; title: string; note: string } {
    if (ctx.callerChannelId && ctx.callerChannelId.startsWith("canal-")) {
      throw new Error(
        "A ferramenta start_task não pode ser invocada dentro de um canal em equipe. Use o chat principal do agente.",
      );
    }

    if (ctx.callerThreadId && !ctx.callerThreadId.startsWith("main:")) {
      const currentThread = this.threadStore.getThread(ctx.callerThreadId);
      if (!currentThread || !currentThread.rotina_id) {
        throw new Error(
          "A ferramenta start_task só pode ser chamada no chat principal do agente ou em uma thread de rotina (recursão em sub-tarefas bloqueada).",
        );
      }
    }

    const title = typeof args.title === "string" ? args.title.trim() : "";
    const brief = typeof args.brief === "string" ? args.brief.trim() : "";
    if (title.length < 1 || title.length > 140) {
      throw new Error("O título de start_task deve ter entre 1 e 140 caracteres.");
    }
    if (brief.length < 1 || brief.length > 100_000) {
      throw new Error("O briefing de start_task deve ter entre 1 e 100.000 caracteres.");
    }

    const hashKey = `start_task:${createHash("sha256")
      .update(`${ctx.agenteId}:${ctx.turnoId}:${ctx.callId}`)
      .digest("hex")}`;

    const existingEvent = this.db.connection
      .prepare("SELECT payload_json FROM eventos_orquestracao WHERE comando_id = ? LIMIT 1;")
      .get(hashKey) as { payload_json: string } | undefined;
    if (existingEvent) {
      try {
        const parsed = JSON.parse(existingEvent.payload_json) as {
          taskId: string;
          threadId: string;
          title: string;
        };
        if (parsed.taskId && parsed.threadId) {
          return {
            taskId: parsed.taskId,
            threadId: parsed.threadId,
            title: parsed.title,
            note: "Sub-tarefa já iniciada anteriormente nesta chamada (idempotência).",
          };
        }
      } catch {
        // segue criação
      }
    }

    const created = this.createTaskThread({
      agenteId: ctx.agenteId,
      origem: "agente",
      titulo: title,
      conteudo: brief,
      remetenteTipo: "agente",
      remetenteAgenteId: ctx.agenteId,
    });

    this.db.connection
      .prepare(
        `
        INSERT INTO eventos_orquestracao (
          evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
        ) VALUES (?, ?, 'thread', ?, 'start_task_idempotencia', ?, ?);
      `,
      )
      .run(
        randomUUID(),
        hashKey,
        created.thread.thread_id,
        new Date().toISOString(),
        JSON.stringify({
          taskId: created.tarefa.tarefa_id,
          threadId: created.thread.thread_id,
          title: created.thread.titulo,
        }),
      );

    return {
      taskId: created.tarefa.tarefa_id,
      threadId: created.thread.thread_id,
      title: created.thread.titulo,
      note: "Sub-tarefa paralela criada e colocada em execução sem bloquear o chat principal.",
    };
  }

  public branchFromMessage(input: {
    agenteId: string;
    origemThreadId: string | null;
    origemMensagemId: string;
    requestId: string;
  }): AgenteThreadRegistro {
    this.assertAgentExists(input.agenteId);
    const origemThreadId =
      input.origemThreadId && input.origemThreadId.trim().length > 0
        ? input.origemThreadId
        : `main:${input.agenteId}`;

    const thread = this.threadStore.createBranch({
      agenteId: input.agenteId,
      origemThreadId,
      origemMensagemId: input.origemMensagemId,
      requestId: input.requestId,
    });

    this.emitAgentSnapshot(input.agenteId);
    return thread;
  }

  public renameThread(threadId: string, titulo: string): AgenteThreadRegistro {
    const updated = this.threadStore.renameThread(threadId, titulo, "usuario");
    this.emitAgentSnapshot(updated.agente_id);
    return updated;
  }

  public archiveThread(threadId: string): AgenteThreadRegistro {
    this.stopThreadOrChat(threadId);
    const updated = this.threadStore.archiveThread(threadId);
    this.emitAgentSnapshot(updated.agente_id);
    return updated;
  }

  public reopenThread(threadId: string): AgenteThreadRegistro {
    const updated = this.threadStore.reopenThread(threadId);
    this.emitAgentSnapshot(updated.agente_id);
    return updated;
  }

  public deleteThread(threadId: string): boolean {
    const existing = this.threadStore.getThread(threadId);
    if (!existing) {
      return false;
    }
    this.stopThreadOrChat(threadId);
    const removed = this.threadStore.deleteThread(threadId);
    if (removed) {
      this.emitAgentSnapshot(existing.agente_id);
    }
    return removed;
  }

  public markThreadRead(threadId: string, lastMsgId?: string | null): AgenteThreadRegistro | null {
    const updated = this.threadStore.markThreadRead(threadId, lastMsgId);
    if (updated) {
      this.emitAgentSnapshot(updated.agente_id);
    }
    return updated;
  }

  public registerTurnAbort(threadKey: string, turnoId: string): AbortController {
    const prev = this.abortControllersByThread.get(threadKey);
    if (prev && !prev.signal.aborted) {
      prev.abort(new Error("Substituído por novo turno na mesma thread."));
    }
    const ctrl = new AbortController();
    this.abortControllersByThread.set(threadKey, ctrl);
    this.abortControllersByTurn.set(turnoId, ctrl);
    return ctrl;
  }

  public clearTurnAbort(threadKey: string, turnoId: string): void {
    const byTurn = this.abortControllersByTurn.get(turnoId);
    if (byTurn && this.abortControllersByThread.get(threadKey) === byTurn) {
      this.abortControllersByThread.delete(threadKey);
    }
    this.abortControllersByTurn.delete(turnoId);
  }

  public stopThreadOrChat(threadKey: string): { interrupted: boolean; turnoId: string | null } {
    const ctrl = this.abortControllersByThread.get(threadKey);
    let interrupted = false;
    let turnoId: string | null = null;

    if (ctrl && !ctrl.signal.aborted) {
      ctrl.abort(new Error("Interrompido pelo usuário."));
      interrupted = true;
    }

    if (!threadKey.startsWith("main:")) {
      const existing = this.threadStore.getThread(threadKey);
      if (existing) {
        turnoId = existing.turno_ativo_id;
        if (existing.estado === "executando" || existing.turno_ativo_id) {
          this.threadStore.updateRuntimeState(threadKey, {
            estado: "ociosa",
            desfecho: "interrompida",
            turno_ativo_id: null,
            progresso_atual: "Execução interrompida pelo usuário",
          });
          interrupted = true;
        }
        this.emitAgentSnapshot(existing.agente_id);
      }
    }

    return { interrupted, turnoId };
  }
}
