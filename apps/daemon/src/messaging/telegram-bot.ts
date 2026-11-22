import type { InboundMessagingEvent } from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { MessagingService } from "./messaging-service.ts";

export interface TelegramUpdateMessage {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  chat: { id: number | string; type?: string; title?: string };
  from?: { id: number | string; is_bot?: boolean; username?: string; first_name?: string };
  reply_to_message?: { message_id: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramUpdateMessage;
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number | string };
  };
}

export interface TelegramBotOptions {
  vault: VaultService;
  fetchImpl?: FetchLike;
  messagingService?: MessagingService;
  onApproveTask?: (tarefaId: string) => Promise<void>;
  onRejectTask?: (tarefaId: string) => Promise<void>;
  onWorkflowApproval?: (stepId: string, approved: boolean) => Promise<void>;
  onInboundMessage?: (event: InboundMessagingEvent) => Promise<void>;
}

/**
 * Bot complementar do Telegram usando a Telegram Bot API oficial com botões inline (InlineKeyboardMarkup)
 * para espelhamento de aprovações móveis e alertas do servidor.
 */
export class TelegramNotificationBot {
  private readonly vault: VaultService;
  private readonly fetchFn: FetchLike;
  private readonly messagingService?: MessagingService;
  private readonly onApproveTask?: (tarefaId: string) => Promise<void>;
  private readonly onRejectTask?: (tarefaId: string) => Promise<void>;
  private readonly onWorkflowApproval?: (stepId: string, approved: boolean) => Promise<void>;
  private readonly onInboundMessage?: (event: InboundMessagingEvent) => Promise<void>;
  private lastUpdateId = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingActive = false;

  constructor(options: TelegramBotOptions) {
    this.vault = options.vault;
    this.fetchFn = options.fetchImpl ?? fetch;
    this.messagingService = options.messagingService;
    this.onApproveTask = options.onApproveTask;
    this.onRejectTask = options.onRejectTask;
    this.onWorkflowApproval = options.onWorkflowApproval;
    this.onInboundMessage = options.onInboundMessage;

    this.messagingService?.registerOutboundSender("telegram", async (dispatch) => {
      await this.sendReplyChunks({
        chatId: dispatch.channelId,
        chunks: dispatch.chunks,
        replyToMessageId: dispatch.replyToMessageId,
        messageThreadId: dispatch.threadId,
      });
    });
  }

  private getCredentials(): { token: string; defaultChatId: string | null } {
    const token = this.vault.getSecret("TELEGRAM_BOT_TOKEN");
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN não configurado no Cofre de Segredos.");
    }
    const defaultChatId = this.vault.getSecret("TELEGRAM_CHAT_ID");
    return { token, defaultChatId };
  }

  public async sendApprovalNotification(params: {
    tarefaId: string;
    titulo: string;
    copy: string;
    chatId?: string;
  }): Promise<{ message_id: number }> {
    const { token, defaultChatId } = this.getCredentials();
    const targetChatId = params.chatId ?? defaultChatId;
    if (!targetChatId) {
      throw new Error("TELEGRAM_CHAT_ID ausente no Cofre e não informado na chamada.");
    }

    const texto = [
      `🚀 *Criativo pronto para aprovação* (#${params.tarefaId.slice(0, 8)})`,
      `*Título:* ${params.titulo}`,
      "",
      params.copy.slice(0, 800),
    ].join("\n");

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "✅ Aprovar e Publicar",
            callback_data: `aprovar:${params.tarefaId}`,
          },
          {
            text: "✏️ Pedir Ajuste",
            callback_data: `ajustar:${params.tarefaId}`,
          },
        ],
      ],
    };

    try {
      const res = await this.fetchFn(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: texto,
            parse_mode: "Markdown",
            reply_markup: replyMarkup,
          }),
        }
      );

      const json = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!res.ok || !json.ok || !json.result) {
        throw new Error(json.description ?? `Erro Telegram API: HTTP ${res.status}`);
      }
      return { message_id: json.result.message_id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [token]));
    }
  }

  public async sendWorkflowMessage(params: {
    text: string;
    chatId?: string;
    parseMode?: "Markdown" | "HTML";
  }): Promise<{ message_id: number }> {
    const { token, defaultChatId } = this.getCredentials();
    const targetChatId = params.chatId?.trim() || defaultChatId;
    if (!targetChatId) {
      throw new Error("TELEGRAM_CHAT_ID ausente no Cofre e não informado na chamada.");
    }

    try {
      const res = await this.fetchFn(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: params.text.slice(0, 4096),
            ...(params.parseMode ? { parse_mode: params.parseMode } : {}),
          }),
        }
      );

      const json = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!res.ok || !json.ok || !json.result) {
        throw new Error(json.description ?? `Erro Telegram API: HTTP ${res.status}`);
      }
      return { message_id: json.result.message_id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [token]));
    }
  }

  public async sendWorkflowApproval(params: {
    stepId: string;
    workflowNome: string;
    question: string;
    previewText: string;
    chatId?: string;
  }): Promise<{ message_id: number }> {
    const { token, defaultChatId } = this.getCredentials();
    const targetChatId = params.chatId?.trim() || defaultChatId;
    if (!targetChatId) {
      throw new Error("TELEGRAM_CHAT_ID ausente no Cofre e não informado na chamada.");
    }

    const texto = [
      `⏸ *Aprovação de Workflow* — ${params.workflowNome}`,
      params.question ? `*Pergunta:* ${params.question}` : "",
      "",
      params.previewText.slice(0, 800),
    ]
      .filter(Boolean)
      .join("\n");

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "✅ Aprovar",
            callback_data: `wf_aprovar:${params.stepId}`,
          },
          {
            text: "🛑 Rejeitar",
            callback_data: `wf_rejeitar:${params.stepId}`,
          },
        ],
      ],
    };

    try {
      const res = await this.fetchFn(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: texto,
            parse_mode: "Markdown",
            reply_markup: replyMarkup,
          }),
        }
      );

      const json = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!res.ok || !json.ok || !json.result) {
        throw new Error(json.description ?? `Erro Telegram API: HTTP ${res.status}`);
      }
      return { message_id: json.result.message_id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [token]));
    }
  }

  public async handleCallbackQuery(callbackQuery: {
    id: string;
    data?: string;
  }): Promise<{ action: string; tarefaId: string } | null> {
    const data = callbackQuery.data ?? "";
    const sepIdx = data.indexOf(":");
    const action = sepIdx >= 0 ? data.slice(0, sepIdx) : "";
    const targetId = sepIdx >= 0 ? data.slice(sepIdx + 1) : "";
    if (!action || !targetId) return null;

    if (action === "aprovar") {
      await this.onApproveTask?.(targetId);
    } else if (action === "ajustar") {
      await this.onRejectTask?.(targetId);
    } else if (action === "wf_aprovar") {
      await this.onWorkflowApproval?.(targetId, true);
    } else if (action === "wf_rejeitar") {
      await this.onWorkflowApproval?.(targetId, false);
    }

    const { token } = this.getCredentials();
    try {
      await this.fetchFn(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text:
              action === "aprovar"
                ? "Aprovado! Publicando agora..."
                : action === "wf_aprovar"
                  ? "Etapa aprovada! Continuando workflow..."
                  : action === "wf_rejeitar"
                    ? "Etapa rejeitada! Workflow interrompido."
                    : "Solicitação de ajuste registrada!",
          }),
        }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [token]));
    }

    return { action, tarefaId: targetId };
  }

  public async sendReplyChunks(params: {
    chatId: string | number;
    chunks: string[];
    replyToMessageId?: string | number | null;
    messageThreadId?: string | number | null;
  }): Promise<number[]> {
    const { token } = this.getCredentials();
    const sentIds: number[] = [];
    for (let idx = 0; idx < params.chunks.length; idx += 1) {
      const chunk = params.chunks[idx]!;
      const payload: Record<string, unknown> = {
        chat_id: params.chatId,
        text: chunk,
      };
      if (idx === 0 && params.replyToMessageId) {
        const numericReply = Number(params.replyToMessageId);
        if (Number.isFinite(numericReply) && numericReply > 0) {
          payload.reply_to_message_id = numericReply;
        }
      }
      if (params.messageThreadId) {
        const numericThread = Number(params.messageThreadId);
        if (Number.isFinite(numericThread) && numericThread > 0) {
          payload.message_thread_id = numericThread;
        }
      }

      try {
        const res = await this.fetchFn(
          `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const json = (await res.json()) as {
          ok: boolean;
          result?: { message_id: number };
          description?: string;
        };
        if (!res.ok || !json.ok || !json.result) {
          throw new Error(json.description ?? `Erro Telegram API: HTTP ${res.status}`);
        }
        sentIds.push(json.result.message_id);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(sanitizeProviderError(msg, [token]));
      }
    }
    return sentIds;
  }

  public async handleUpdate(update: TelegramUpdate): Promise<{
    kind: "callback" | "message" | "ignored";
    result?: unknown;
  }> {
    if (update.update_id >= this.lastUpdateId) {
      this.lastUpdateId = update.update_id + 1;
    }

    if (update.callback_query) {
      const result = await this.handleCallbackQuery(update.callback_query);
      return { kind: "callback", result };
    }

    const msg = update.message;
    const text = (msg?.text ?? msg?.caption ?? "").trim();
    if (!msg || !text || msg.from?.is_bot) {
      return { kind: "ignored" };
    }

    const senderId = String(msg.from?.id ?? msg.chat.id);
    const senderName =
      msg.from?.username || msg.from?.first_name || `tg_${senderId}`;
    const event: InboundMessagingEvent = {
      platform: "telegram",
      messageId: String(msg.message_id),
      channelId: String(msg.chat.id),
      senderId,
      senderName,
      text,
      threadId:
        typeof msg.message_thread_id === "number"
          ? String(msg.message_thread_id)
          : null,
      replyToMessageId: String(msg.message_id),
      raw: update,
    };

    if (this.messagingService) {
      const result = await this.messagingService.handleInbound(event);
      return { kind: "message", result };
    }
    if (this.onInboundMessage) {
      await this.onInboundMessage(event);
      return { kind: "message" };
    }
    return { kind: "ignored" };
  }

  public async pollUpdatesOnce(limit = 20): Promise<number> {
    const { token } = this.getCredentials();
    const url =
      `https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates` +
      `?offset=${this.lastUpdateId}&limit=${limit}&timeout=0`;

    const res = await this.fetchFn(url, { method: "GET" });
    const json = (await res.json()) as {
      ok: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };
    if (!res.ok || !json.ok || !Array.isArray(json.result)) {
      throw new Error(sanitizeProviderError(json.description ?? `HTTP ${res.status}`, [token]));
    }

    for (const upd of json.result) {
      await this.handleUpdate(upd);
    }
    return json.result.length;
  }

  public startPolling(intervalMs = 3000): void {
    if (this.pollingActive) return;
    this.pollingActive = true;
    const tick = async () => {
      if (!this.pollingActive) return;
      try {
        await this.pollUpdatesOnce();
      } catch {
        // Falha transitória ou token ausente não derruba o daemon.
      } finally {
        if (this.pollingActive) {
          this.pollTimer = setTimeout(() => void tick(), intervalMs);
        }
      }
    };
    this.pollTimer = setTimeout(() => void tick(), intervalMs);
  }

  public stopPolling(): void {
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
