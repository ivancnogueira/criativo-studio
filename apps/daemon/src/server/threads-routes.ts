import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AnexoChat, MensagemChat } from "@criativo/contracts";
import type { ContextResetService } from "../chat/context-reset-service.ts";
import type { MessagePinsService } from "../chat/message-pins-service.ts";
import type { SideQuestionService } from "../chat/side-question-service.ts";
import { QueueConflictError, type QueueControlsService } from "../queue/queue-controls-service.ts";
import type { AgentTasksService } from "../threads/agent-tasks-service.ts";
import type { AgentThreadStore } from "../threads/agent-thread-store.ts";
import type { ConversationPaginationReader } from "../threads/conversation-pagination.ts";
import type { AgentWaitsService } from "../waits/agent-waits-service.ts";
import type { StudioRoutesDeps } from "./studio-routes.ts";

export interface Phase13ServicesBundle {
  threadStore: AgentThreadStore;
  tasksService: AgentTasksService;
  waitsService: AgentWaitsService;
  queueControls: QueueControlsService;
  pagination: ConversationPaginationReader;
  sideQuestion: SideQuestionService;
  contextReset: ContextResetService;
  pinsService: MessagePinsService;
  onDrainLane: (agenteId: string, threadId: string | null) => void;
}

export type ThreadsRouteDeps = StudioRoutesDeps & Phase13ServicesBundle;

function sendDomainError(
  sendJson: StudioRoutesDeps["sendJson"],
  res: ServerResponse,
  err: unknown,
): void {
  if (err instanceof QueueConflictError) {
    sendJson(res, 409, { erro: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("não encontrad") || lower.includes("nao encontrad")) {
    sendJson(res, 404, { erro: msg });
    return;
  }
  if (lower.includes("limite") || lower.includes("fila humana") || lower.includes("fixada pelo usuário")) {
    sendJson(res, 409, { erro: msg });
    return;
  }
  sendJson(res, 400, { erro: msg });
}

/**
 * Trata todas as rotas REST e SSE da Fase 13 (Threads Paralelas, Branches, Esperas,
 * Fila Granular do Chat, Pergunta Lateral, Novo Chat e Mensagens Fixadas).
 */
export async function tryHandleThreadsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: ThreadsRouteDeps,
): Promise<boolean> {
  const {
    db,
    sendJson,
    readJsonBody,
    wsHub,
    threadStore,
    tasksService,
    waitsService,
    queueControls,
    pagination,
    sideQuestion,
    contextReset,
    pinsService,
    onDrainLane,
  } = deps;

  // 1. Stream SSE isolado para proxies sem WebSocket
  if (method === "GET" && path === "/api/stream/threads") {
    const agenteId = url.searchParams.get("agenteId");
    const threadId = url.searchParams.get("threadId");
    const cleanup = wsHub.registerSseClient(res, { agenteId, threadId });
    req.on("close", cleanup);
    return true;
  }

  // 2. Listagem agregada de threads paralelas
  if (method === "GET" && path === "/api/threads") {
    const agenteId = url.searchParams.get("agenteId");
    if (agenteId) {
      sendJson(res, 200, tasksService.getAgentSnapshot(agenteId));
    } else {
      sendJson(res, 200, { threads: tasksService.listAllThreads() });
    }
    return true;
  }

  // 3. Threads de um agente (GET / POST)
  const agentThreadsMatch = path.match(/^\/api\/agentes\/([^/]+)\/threads$/);
  if (agentThreadsMatch) {
    const agenteId = decodeURIComponent(agentThreadsMatch[1]);
    if (method === "GET") {
      sendJson(res, 200, tasksService.getAgentSnapshot(agenteId));
      return true;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody(req);
        const conteudo = typeof body.conteudo === "string" ? body.conteudo : "";
        const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
        const created = tasksService.createTaskThread({
          agenteId,
          origem: "usuario",
          titulo: typeof body.titulo === "string" ? body.titulo : undefined,
          conteudo,
          anexos,
          prioridade: typeof body.prioridade === "number" ? body.prioridade : undefined,
          clientMessageId:
            typeof body.client_message_id === "string" ? body.client_message_id : undefined,
        });
        onDrainLane(agenteId, created.thread.thread_id);
        sendJson(res, 201, {
          thread: created.thread,
          tarefa: created.tarefa,
          mensagem_usuario: created.mensagem,
        });
      } catch (err) {
        sendDomainError(sendJson, res, err);
      }
      return true;
    }
  }

  // 4. Mensagens paginadas / envio em sub-thread
  const threadMsgsMatch = path.match(/^\/api\/threads\/([^/]+)\/mensagens$/);
  if (threadMsgsMatch) {
    const threadId = decodeURIComponent(threadMsgsMatch[1]);
    const thread = threadStore.getThread(threadId);
    if (!thread) {
      sendJson(res, 404, { erro: `Thread '${threadId}' não encontrada.` });
      return true;
    }

    if (method === "GET") {
      try {
        const limitRaw = Number(url.searchParams.get("limit") ?? 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;
        const beforeCursor = url.searchParams.get("beforeCursor");
        const aroundMessageId = url.searchParams.get("aroundMessageId");

        const pagina = aroundMessageId
          ? pagination.readAround({
              threadId,
              agenteId: thread.agente_id,
              aroundMessageId,
              limit,
            })
          : pagination.readPage({
              threadId,
              agenteId: thread.agente_id,
              beforeCursor,
              limit,
            });
        sendJson(res, 200, { pagina, mensagens: pagina.mensagens });
      } catch (err) {
        sendDomainError(sendJson, res, err);
      }
      return true;
    }

    if (method === "POST") {
      try {
        const body = await readJsonBody(req);
        const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
        const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
        if (!conteudo && anexos.length === 0) {
          sendJson(res, 400, { erro: "Envie 'conteudo' ou ao menos um anexo." });
          return true;
        }

        if (thread.arquivada_em) {
          tasksService.reopenThread(threadId);
        }

        const msgId = `msg-${randomUUID()}`;
        const agora = new Date().toISOString();
        const maxOrdRow = db.connection
          .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
          .get(threadId) as { max_ord: number };
        const ordinal = maxOrdRow.max_ord + 1;
        const canalId = `thread:${threadId}`;

        const userMsg: MensagemChat = {
          mensagem_id: msgId,
          canal_id: canalId,
          agente_id: thread.agente_id,
          autor: "usuario",
          autor_nome: "Você",
          conteudo_markdown: conteudo || "Anexo enviado",
          anexos,
          steps: [],
          tarefa_id: thread.tarefa_id,
          thread_id: threadId,
          item_type: "mensagem",
          status: "completed",
          resposta_para_mensagem_id:
            typeof body.resposta_para_mensagem_id === "string" ? body.resposta_para_mensagem_id : null,
          ordinal,
          lida: true,
          criado_em: agora,
        };

        db.connection
          .prepare(
            `
            INSERT INTO projecao_conversas_chat (
              mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
              anexos_json, steps_json, tarefa_id, lida, criado_em,
              thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
              ordinal, branch_origem_mensagem_id, metadados_json
            ) VALUES (?, ?, ?, 'usuario', 'Você', ?, ?, '[]', ?, 1, ?, ?, NULL, 'mensagem', 'completed', ?, ?, NULL, '{}');
          `,
          )
          .run(
            userMsg.mensagem_id,
            canalId,
            thread.agente_id,
            userMsg.conteudo_markdown,
            JSON.stringify(anexos),
            thread.tarefa_id ?? null,
            agora,
            threadId,
            userMsg.resposta_para_mensagem_id ?? null,
            ordinal,
          );

        wsHub.broadcast("thread:message", {
          agente_id: thread.agente_id,
          thread_id: threadId,
          mensagem: userMsg,
        });

        const delivery = queueControls.enqueueMessage({
          mensagemId: userMsg.mensagem_id,
          agenteId: thread.agente_id,
          threadId,
          remetenteTipo: "usuario",
          conteudoMarkdown: userMsg.conteudo_markdown,
          anexos,
          respostaParaMensagemId: userMsg.resposta_para_mensagem_id,
          chaveIdempotencia:
            typeof body.client_message_id === "string" ? `thread-msg:${body.client_message_id}` : null,
          skipWake: true,
        });

        const snapshot = queueControls.getLaneSnapshot(thread.agente_id, threadId);
        let steered = false;
        if (snapshot.modo_ocupado === "steer" && queueControls.isLaneBusy(thread.agente_id, threadId) && snapshot.suporta_steer_nativo) {
          try {
            const steerRes = queueControls.steerDelivery(thread.agente_id, threadId, delivery.entrega_id);
            steered = steerRes.mode === "steered";
          } catch {
            steered = false;
          }
        }

        if (!steered) {
          onDrainLane(thread.agente_id, threadId);
        }

        sendJson(res, 201, {
          mensagem_usuario: userMsg,
          entrega: delivery,
          enfileirada: !steered,
        });
      } catch (err) {
        sendDomainError(sendJson, res, err);
      }
      return true;
    }
  }

  // 5. Ciclo de vida da Thread (PUT/DELETE + POST arquivar|reabrir|parar|lida)
  const threadActionMatch = path.match(/^\/api\/threads\/([^/]+)\/(arquivar|reabrir|parar|lida)$/);
  if (method === "POST" && threadActionMatch) {
    const threadId = decodeURIComponent(threadActionMatch[1]);
    const action = threadActionMatch[2];
    try {
      if (action === "arquivar") {
        sendJson(res, 200, { thread: tasksService.archiveThread(threadId) });
      } else if (action === "reabrir") {
        sendJson(res, 200, { thread: tasksService.reopenThread(threadId) });
      } else if (action === "parar") {
        sendJson(res, 200, tasksService.stopThreadOrChat(threadId));
      } else {
        const body = await readJsonBody(req);
        const lastId = typeof body.ultima_mensagem_id === "string" ? body.ultima_mensagem_id : null;
        sendJson(res, 200, { thread: tasksService.markThreadRead(threadId, lastId) });
      }
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  const threadSingleMatch = path.match(/^\/api\/threads\/([^/]+)$/);
  if (threadSingleMatch) {
    const threadId = decodeURIComponent(threadSingleMatch[1]);
    if (method === "GET") {
      const thread = threadStore.getThread(threadId);
      sendJson(res, thread ? 200 : 404, thread ? { thread } : { erro: "Thread não encontrada." });
      return true;
    }
    if (method === "PUT") {
      try {
        const body = await readJsonBody(req);
        const titulo = typeof body.titulo === "string" ? body.titulo : "";
        sendJson(res, 200, { thread: tasksService.renameThread(threadId, titulo) });
      } catch (err) {
        sendDomainError(sendJson, res, err);
      }
      return true;
    }
    if (method === "DELETE") {
      const removed = tasksService.deleteThread(threadId);
      sendJson(res, removed ? 200 : 404, removed ? { ok: true } : { erro: "Thread não encontrada." });
      return true;
    }
  }

  // 6. Branch a partir de uma mensagem
  const branchMatch = path.match(/^\/api\/agentes\/([^/]+)\/branch$/);
  if (method === "POST" && branchMatch) {
    const agenteId = decodeURIComponent(branchMatch[1]);
    try {
      const body = await readJsonBody(req);
      const mensagemId = typeof body.mensagem_id === "string" ? body.mensagem_id : "";
      const requestId =
        typeof body.request_id === "string" && body.request_id.trim().length > 0
          ? body.request_id.trim()
          : randomUUID();
      const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
      if (!mensagemId) {
        sendJson(res, 400, { erro: "Campo obrigatório: 'mensagem_id'." });
        return true;
      }
      const thread = tasksService.branchFromMessage({
        agenteId,
        origemThreadId: threadId,
        origemMensagemId: mensagemId,
        requestId,
      });
      sendJson(res, 201, { thread });
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  // 7. Esperas Longas (Waits)
  const waitsListMatch = path.match(/^\/api\/agentes\/([^/]+)\/esperas$/);
  if (method === "GET" && waitsListMatch) {
    const agenteId = decodeURIComponent(waitsListMatch[1]);
    sendJson(res, 200, { esperas: waitsService.listWaitsForUi(agenteId) });
    return true;
  }

  const waitDeleteMatch = path.match(/^\/api\/agentes\/([^/]+)\/esperas\/([^/]+)$/);
  if (method === "DELETE" && waitDeleteMatch) {
    const agenteId = decodeURIComponent(waitDeleteMatch[1]);
    const esperaId = decodeURIComponent(waitDeleteMatch[2]);
    try {
      sendJson(res, 200, waitsService.closeWait(esperaId, agenteId));
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  // 8. Fila Granular do Chat (GET + ações editar/cancelar/reordenar/steer/mover-para-tarefa)
  const queueGetMatch = path.match(/^\/api\/agentes\/([^/]+)\/fila-chat$/);
  if (method === "GET" && queueGetMatch) {
    const agenteId = decodeURIComponent(queueGetMatch[1]);
    const threadId = url.searchParams.get("threadId");
    sendJson(res, 200, queueControls.getLaneSnapshot(agenteId, threadId));
    return true;
  }

  const queueActionMatch = path.match(
    /^\/api\/agentes\/([^/]+)\/fila-chat\/(editar|atualizar|cancelar|reordenar|steer|mover-para-tarefa)$/,
  );
  if (method === "POST" && queueActionMatch) {
    const agenteId = decodeURIComponent(queueActionMatch[1]);
    const action = queueActionMatch[2];
    try {
      const body = await readJsonBody(req);
      const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
      const entregaId = typeof body.entrega_id === "string" ? body.entrega_id : "";

      if (action === "editar" || action === "atualizar") {
        const acao =
          action === "atualizar"
            ? "save"
            : typeof body.acao === "string"
              ? (body.acao as "begin" | "retain-attachments" | "save" | "cancel")
              : "save";
        const editId =
          typeof body.edit_id === "string" && body.edit_id.trim().length > 0
            ? body.edit_id
            : randomUUID();
        const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : undefined;
        const snapshot = queueControls.handleEditAction({
          agenteId,
          threadId,
          entregaId,
          acao,
          editId,
          conteudo: typeof body.conteudo === "string" ? body.conteudo : undefined,
          anexos,
        });
        sendJson(res, 200, { snapshot, edit_id: editId });
      } else if (action === "cancelar") {
        const snapshot = queueControls.cancelQueuedDelivery(
          agenteId,
          threadId,
          entregaId,
          body.excluir === true,
        );
        sendJson(res, 200, { snapshot });
      } else if (action === "reordenar") {
        const entregaIds = Array.isArray(body.entrega_ids)
          ? body.entrega_ids.filter((id): id is string => typeof id === "string")
          : [];
        const snapshot = queueControls.reorderQueuedDeliveries(agenteId, threadId, entregaIds);
        sendJson(res, 200, { snapshot });
      } else if (action === "steer") {
        const resSteer = queueControls.steerDelivery(agenteId, threadId, entregaId);
        sendJson(res, 200, resSteer);
      } else {
        const resMove = queueControls.runQueuedMessageAsTask(agenteId, threadId, entregaId);
        onDrainLane(agenteId, resMove.thread.thread_id);
        sendJson(res, 201, resMove);
      }
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  // 9. Interromper turno ativo
  const interruptMatch = path.match(/^\/api\/agentes\/([^/]+)\/interromper$/);
  if (method === "POST" && interruptMatch) {
    const agenteId = decodeURIComponent(interruptMatch[1]);
    const body = await readJsonBody(req);
    const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
    sendJson(res, 200, queueControls.interruptActiveTurnFromUi(agenteId, threadId));
    return true;
  }

  // 10. Pergunta Lateral (Side Question)
  const sideQuestionMatch = path.match(/^\/api\/agentes\/([^/]+)\/pergunta-lateral$/);
  if (method === "POST" && sideQuestionMatch) {
    const agenteId = decodeURIComponent(sideQuestionMatch[1]);
    try {
      const body = await readJsonBody(req);
      const pergunta = typeof body.pergunta === "string" ? body.pergunta : "";
      const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
      const historicoLateral = Array.isArray(body.historico_lateral)
        ? (body.historico_lateral as Array<{ pergunta: string; resposta?: string | null }>)
        : [];
      const answer = await sideQuestion.ask({
        agenteId,
        threadId,
        pergunta,
        historicoLateral,
      });
      sendJson(res, 200, answer);
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  // 11. Reiniciar contexto (`start_new_chat`) preservando histórico visual
  const newChatMatch = path.match(/^\/api\/agentes\/([^/]+)\/novo-chat$/);
  if (method === "POST" && newChatMatch) {
    const agenteId = decodeURIComponent(newChatMatch[1]);
    try {
      const body = await readJsonBody(req);
      const resReset = contextReset.executeContextReset(agenteId, {
        forceImmediate: body.forcar === true,
      });
      if (resReset.delayed) {
        sendJson(res, 409, {
          erro: "Aguarde as mensagens humanas pendentes na fila finalizarem antes de iniciar um novo chat.",
          delayed: true,
        });
        return true;
      }
      sendJson(res, 200, resReset);
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  // 12. Fixação de mensagens (`Pins`)
  const pinsRootMatch = path.match(/^\/api\/agentes\/([^/]+)\/pins$/);
  if (pinsRootMatch) {
    const agenteId = decodeURIComponent(pinsRootMatch[1]);
    if (method === "GET") {
      const threadFilter = url.searchParams.get("threadId");
      const pins = threadFilter
        ? pinsService.listPinsByThread(agenteId, threadFilter)
        : pinsService.listPinsByAgent(agenteId);
      sendJson(res, 200, { pins });
      return true;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody(req);
        const mensagemId = typeof body.mensagem_id === "string" ? body.mensagem_id : "";
        const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
        if (!mensagemId) {
          sendJson(res, 400, { erro: "Campo obrigatório: 'mensagem_id'." });
          return true;
        }
        const pinned = pinsService.pinMessage({
          agenteId,
          threadId,
          mensagemId,
          actorTipo: "usuario",
        });
        sendJson(res, 201, pinned);
      } catch (err) {
        sendDomainError(sendJson, res, err);
      }
      return true;
    }
  }

  const pinDeleteMatch = path.match(/^\/api\/agentes\/([^/]+)\/pins\/([^/]+)\/([^/]+)$/);
  if (method === "DELETE" && pinDeleteMatch) {
    const agenteId = decodeURIComponent(pinDeleteMatch[1]);
    const threadId = decodeURIComponent(pinDeleteMatch[2]);
    const mensagemId = decodeURIComponent(pinDeleteMatch[3]);
    try {
      const resUnpin = pinsService.unpinMessage({
        agenteId,
        threadId,
        mensagemId,
        actorTipo: "usuario",
      });
      sendJson(res, 200, resUnpin);
    } catch (err) {
      sendDomainError(sendJson, res, err);
    }
    return true;
  }

  return false;
}
