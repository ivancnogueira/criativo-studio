import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import type { VaultService } from "../vault/vault-service.ts";

export interface TelegramBotOptions {
  vault: VaultService;
  fetchImpl?: FetchLike;
  onApproveTask?: (tarefaId: string) => Promise<void>;
  onRejectTask?: (tarefaId: string) => Promise<void>;
}

/**
 * Bot complementar do Telegram usando a Telegram Bot API oficial com botões inline (InlineKeyboardMarkup)
 * para espelhamento de aprovações móveis e alertas do servidor.
 */
export class TelegramNotificationBot {
  private readonly vault: VaultService;
  private readonly fetchFn: FetchLike;
  private readonly onApproveTask?: (tarefaId: string) => Promise<void>;
  private readonly onRejectTask?: (tarefaId: string) => Promise<void>;

  constructor(options: TelegramBotOptions) {
    this.vault = options.vault;
    this.fetchFn = options.fetchImpl ?? fetch;
    this.onApproveTask = options.onApproveTask;
    this.onRejectTask = options.onRejectTask;
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

  public async handleCallbackQuery(callbackQuery: {
    id: string;
    data?: string;
  }): Promise<{ action: string; tarefaId: string } | null> {
    const data = callbackQuery.data ?? "";
    const [action, tarefaId] = data.split(":");
    if (!action || !tarefaId) return null;

    if (action === "aprovar") {
      await this.onApproveTask?.(tarefaId);
    } else if (action === "ajustar") {
      await this.onRejectTask?.(tarefaId);
    }

    const { token } = this.getCredentials();
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
              : "Solicitação de ajuste registrada!",
        }),
      }
    );

    return { action, tarefaId };
  }
}
