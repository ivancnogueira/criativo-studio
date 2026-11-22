import type { InboundMessagingEvent } from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { ConnectorsWebhookService } from "../server/connectors-webhook-service.ts";
import type { MessagingService } from "./messaging-service.ts";

export interface DiscordAdapterOptions {
  connectorsWebhook: ConnectorsWebhookService;
  messagingService: MessagingService;
  fetchImpl?: FetchLike;
}

/**
 * Adaptador conversacional do Discord sobre `ConnectorsWebhookService` + `MessagingService`.
 * Responde via REST API (`/channels/:id/messages`) com `message_reference` opcional e fatiamento em 2000 chars.
 */
export class DiscordMessagingAdapter {
  private readonly connectorsWebhook: ConnectorsWebhookService;
  private readonly messagingService: MessagingService;
  private readonly fetchFn: FetchLike;

  constructor(options: DiscordAdapterOptions) {
    this.connectorsWebhook = options.connectorsWebhook;
    this.messagingService = options.messagingService;
    this.fetchFn = options.fetchImpl ?? fetch;

    this.messagingService.registerOutboundSender("discord", async (dispatch) => {
      await this.sendReplyChunks({
        channelId: dispatch.channelId,
        chunks: dispatch.chunks,
        replyToMessageId: dispatch.replyToMessageId,
      });
    });
  }

  public async sendReplyChunks(params: {
    channelId: string;
    chunks: string[];
    replyToMessageId?: string | null;
  }): Promise<void> {
    for (let i = 0; i < params.chunks.length; i += 1) {
      const chunk = params.chunks[i]!;
      const result = await this.connectorsWebhook.sendDiscordReply({
        channelId: params.channelId,
        content: chunk,
        replyToMessageId: i === 0 ? params.replyToMessageId : null,
        fetchImpl: this.fetchFn,
      });
      if (!result.ok) {
        throw new Error(result.erro ?? "Falha ao enviar resposta ao Discord.");
      }
    }
  }

  public async handleVerifiedInteractionOrMessage(
    payload: Record<string, unknown>,
  ): Promise<{
    routed: boolean;
    allowed?: boolean;
    reason?: string;
    chunksSent: number;
    immediateContent?: string;
  }> {
    const channelId =
      typeof payload.channel_id === "string"
        ? payload.channel_id
        : typeof payload.channelId === "string"
          ? payload.channelId
          : "";

    const memberObj = (payload.member ?? {}) as Record<string, unknown>;
    const userObj = (memberObj.user ?? payload.user ?? payload.author ?? {}) as Record<
      string,
      unknown
    >;
    if (userObj.bot === true) {
      return { routed: false, chunksSent: 0 };
    }

    const senderId = typeof userObj.id === "string" ? userObj.id : "";
    const senderName = typeof userObj.username === "string" ? userObj.username : senderId;

    // Caso 1: Slash command / Interaction (`data.name` + `data.options`)
    let text = "";
    const dataObj =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    if (dataObj && typeof dataObj.name === "string") {
      const opts = Array.isArray(dataObj.options)
        ? (dataObj.options as Array<{ name?: string; value?: unknown }>)
        : [];
      const promptOpt = opts.find(
        (o) => typeof o.value === "string" && o.value.trim().length > 0,
      );
      text = promptOpt ? String(promptOpt.value).trim() : `/${dataObj.name}`;
    } else if (typeof payload.content === "string") {
      text = payload.content.trim();
    }

    if (!text || !channelId || !senderId) {
      return { routed: false, chunksSent: 0 };
    }

    const messageId =
      typeof payload.id === "string" ? payload.id : String(Date.now());
    const inbound: InboundMessagingEvent = {
      platform: "discord",
      messageId,
      channelId,
      senderId,
      senderName,
      text,
      threadId: typeof payload.thread_id === "string" ? payload.thread_id : null,
      replyToMessageId: typeof payload.content === "string" ? messageId : null,
      raw: payload,
    };

    const res = await this.messagingService.handleInbound(inbound);
    return {
      routed: true,
      allowed: res.allowed,
      reason: res.reason,
      chunksSent: res.chunksSent,
      immediateContent: res.replyText?.slice(0, 1900),
    };
  }
}
