import type {
  AgenteEspera,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  ConversationUiBlock,
  FilaChatEntrega,
  FilaChatSnapshot,
  MensagemChat,
  MensagemFixada,
  PaginaConversaThread,
  SkillSugestaoItem,
  TarefaRegistro,
  UiBlockSubmitPayload,
} from "@criativo/contracts";
import { requestJson } from "../http-client";

export const threadsQueueUiApi = {
  async listAllThreads(): Promise<AgenteThreadRegistro[]> {
    const data = await requestJson<{ threads?: AgenteThreadRegistro[] }>("/api/threads");
    return data.threads ?? [];
  },

  async listAgentThreads(agenteId: string): Promise<AgenteThreadsSnapshot> {
    return await requestJson<AgenteThreadsSnapshot>(
      `/api/agentes/${encodeURIComponent(agenteId)}/threads`
    );
  },

  async createAgentThread(
    agenteId: string,
    input: {
      titulo?: string;
      conteudo: string;
      anexos?: AnexoChat[];
      prioridade?: number;
      client_message_id?: string;
    }
  ): Promise<{ thread: AgenteThreadRegistro; tarefa: TarefaRegistro }> {
    return await requestJson<{ thread: AgenteThreadRegistro; tarefa: TarefaRegistro }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
  },

  async createEmptyTopic(
    agenteId: string,
    titulo?: string
  ): Promise<{ thread: AgenteThreadRegistro }> {
    return await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vazio: true,
          ...(titulo ? { titulo } : {}),
        }),
      }
    );
  },

  async readThreadMessages(
    threadId: string,
    opts?: { limit?: number; beforeCursor?: string | null; aroundMessageId?: string | null }
  ): Promise<PaginaConversaThread> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.beforeCursor) q.set("beforeCursor", opts.beforeCursor);
    if (opts?.aroundMessageId) q.set("aroundMessageId", opts.aroundMessageId);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const data = await requestJson<{ pagina: PaginaConversaThread }>(
      `/api/threads/${encodeURIComponent(threadId)}/mensagens${suffix}`
    );
    return data.pagina;
  },

  async readAgentMessagesPage(
    agenteId: string,
    opts?: { limit?: number; beforeCursor?: string | null; aroundMessageId?: string | null }
  ): Promise<PaginaConversaThread> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.beforeCursor) q.set("beforeCursor", opts.beforeCursor);
    if (opts?.aroundMessageId) q.set("aroundMessageId", opts.aroundMessageId);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const data = await requestJson<{ pagina: PaginaConversaThread; mensagens: MensagemChat[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/mensagens${suffix}`
    );
    return data.pagina;
  },

  async sendThreadMessage(
    threadId: string,
    conteudo: string,
    anexos: AnexoChat[],
    clientMessageId?: string
  ): Promise<{
    enfileirada?: boolean;
    steered?: boolean;
    entrega?: FilaChatEntrega;
    mensagem_usuario?: MensagemChat;
    mensagem_agente?: MensagemChat;
    thread?: AgenteThreadRegistro;
  }> {
    return await requestJson(`/api/threads/${encodeURIComponent(threadId)}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conteudo,
        anexos,
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      }),
    });
  },

  async renameThread(threadId: string, titulo: string): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/threads/${encodeURIComponent(threadId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo }),
      }
    );
    return data.thread;
  },

  async archiveThread(threadId: string): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/threads/${encodeURIComponent(threadId)}/arquivar`,
      { method: "POST" }
    );
    return data.thread;
  },

  async reopenThread(threadId: string): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/threads/${encodeURIComponent(threadId)}/reabrir`,
      { method: "POST" }
    );
    return data.thread;
  },

  async stopThread(threadId: string): Promise<{ interrupted: boolean }> {
    return await requestJson<{ interrupted: boolean }>(
      `/api/threads/${encodeURIComponent(threadId)}/parar`,
      { method: "POST" }
    );
  },

  async markThreadRead(threadId: string, lastMessageId?: string): Promise<AgenteThreadRegistro | null> {
    const data = await requestJson<{ thread: AgenteThreadRegistro | null }>(
      `/api/threads/${encodeURIComponent(threadId)}/lida`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastMessageId ? { ultima_mensagem_id: lastMessageId } : {}),
      }
    );
    return data.thread;
  },

  async deleteThread(threadId: string): Promise<void> {
    await requestJson(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    });
  },

  async branchConversation(
    agenteId: string,
    input: { thread_id: string | null; mensagem_id: string; request_id: string }
  ): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/branch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    return data.thread;
  },

  async listWaits(agenteId: string): Promise<AgenteEspera[]> {
    const data = await requestJson<{ esperas?: AgenteEspera[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/esperas`
    );
    return data.esperas ?? [];
  },

  async cancelWait(agenteId: string, esperaId: string): Promise<void> {
    await requestJson(
      `/api/agentes/${encodeURIComponent(agenteId)}/esperas/${encodeURIComponent(esperaId)}`,
      { method: "DELETE" }
    );
  },

  async listChatQueue(agenteId: string, threadId?: string | null): Promise<FilaChatSnapshot> {
    const q = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    return await requestJson<FilaChatSnapshot>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat${q}`
    );
  },

  async editChatQueue(
    agenteId: string,
    payload: {
      thread_id?: string | null;
      entrega_id: string;
      acao: "begin" | "retain-attachments" | "save" | "cancel";
      edit_id: string;
      conteudo?: string;
      anexos?: AnexoChat[];
    }
  ): Promise<FilaChatSnapshot> {
    const data = await requestJson<{ snapshot: FilaChatSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/editar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.snapshot;
  },

  async cancelChatQueue(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_id: string; delete_after?: boolean }
  ): Promise<FilaChatSnapshot> {
    const data = await requestJson<{ snapshot: FilaChatSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/cancelar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: payload.thread_id ?? null,
          entrega_id: payload.entrega_id,
          excluir: payload.delete_after === true,
        }),
      }
    );
    return data.snapshot;
  },

  async reorderChatQueue(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_ids: string[] }
  ): Promise<FilaChatSnapshot> {
    const data = await requestJson<{ snapshot: FilaChatSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/reordenar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.snapshot;
  },

  async steerChatQueue(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_id: string }
  ): Promise<{ mode: "steered" | "fallback_send_now"; snapshot: FilaChatSnapshot }> {
    return await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async runQueuedAsTask(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_id: string }
  ): Promise<{ thread: AgenteThreadRegistro; snapshot: FilaChatSnapshot }> {
    return await requestJson(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/mover-para-tarefa`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async interruptTurn(agenteId: string, threadId?: string | null): Promise<{ interrupted: boolean }> {
    return await requestJson<{ interrupted: boolean }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/interromper`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId ?? null }),
      }
    );
  },

  async askSideQuestion(
    agenteId: string,
    payload: {
      pergunta: string;
      historico_lateral: Array<{ pergunta: string; resposta: string }>;
      thread_id?: string | null;
    }
  ): Promise<{ resposta: string }> {
    return await requestJson<{ resposta: string }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/pergunta-lateral`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async startNewChat(
    agenteId: string
  ): Promise<{ cutoff_at: string; mensagem_divisor: MensagemChat }> {
    return await requestJson<{ cutoff_at: string; mensagem_divisor: MensagemChat }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/novo-chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forcar: true }),
      }
    );
  },

  async listPins(agenteId: string): Promise<MensagemFixada[]> {
    const data = await requestJson<{ pins?: MensagemFixada[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/pins`
    );
    return data.pins ?? [];
  },

  async setMessagePinned(
    agenteId: string,
    payload: { thread_id: string; mensagem_id: string; pinned: boolean }
  ): Promise<MensagemFixada[]> {
    if (payload.pinned) {
      await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}/pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: payload.thread_id,
          mensagem_id: payload.mensagem_id,
        }),
      });
    } else {
      await requestJson(
        `/api/agentes/${encodeURIComponent(agenteId)}/pins/${encodeURIComponent(payload.thread_id)}/${encodeURIComponent(payload.mensagem_id)}`,
        { method: "DELETE" }
      );
    }
    return await threadsQueueUiApi.listPins(agenteId);
  },

  async submitChatUiResponse(
    payload: UiBlockSubmitPayload
  ): Promise<{ ok: boolean; bloco: ConversationUiBlock }> {
    return await requestJson<{ ok: boolean; bloco: ConversationUiBlock }>("/api/chat/ui-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async saveSkillSuggestion(mensagemId: string): Promise<{
    ok: boolean;
    sugestao?: SkillSugestaoItem;
    fallbackToReply?: boolean;
    erro?: string;
  }> {
    return await requestJson(
      `/api/chat/skill-sugestao/${encodeURIComponent(mensagemId)}/salvar`,
      { method: "POST" }
    );
  },

  async dismissSkillSuggestion(mensagemId: string): Promise<{
    ok: boolean;
    sugestao: SkillSugestaoItem;
  }> {
    return await requestJson(
      `/api/chat/skill-sugestao/${encodeURIComponent(mensagemId)}/dispensar`,
      { method: "POST" }
    );
  },

  async getVisualPage(
    agenteId: string,
    arquivoId: string
  ): Promise<{ arquivo_id: string; titulo: string; html: string }> {
    return await requestJson<{ arquivo_id: string; titulo: string; html: string }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/visual-pages/${encodeURIComponent(arquivoId)}`
    );
  },

  async transcribeAudio(
    audioBase64: string,
    mimeType = "audio/webm",
    options?: { vadEnabled?: boolean; clientSpeechMs?: number; durationSec?: number }
  ): Promise<{ ok: boolean; texto: string; silent?: boolean; chunks_processados?: number }> {
    return await requestJson("/api/voz/transcrever", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: mimeType,
        ...(options?.vadEnabled !== undefined ? { vad_enabled: options.vadEnabled } : {}),
        ...(options?.clientSpeechMs !== undefined ? { client_speech_ms: options.clientSpeechMs } : {}),
        ...(options?.durationSec !== undefined ? { duration_sec: options.durationSec } : {}),
      }),
    });
  },
};
