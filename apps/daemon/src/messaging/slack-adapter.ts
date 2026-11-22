import type { InboundMessagingEvent } from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { ConnectorsWebhookService } from "../server/connectors-webhook-service.ts";
import type { MessagingService } from "./messaging-service.ts";

export interface SlackAdapterOptions {
  connectorsWebhook: ConnectorsWebhookService;
  messagingService: MessagingService;
  fetchImpl?: FetchLike;
}

/**
 * Adaptador conversacional do Slack sobre `ConnectorsWebhookService` + `MessagingService`.
 * Mantém threads nativos via `thread_ts` e fatiamento automático de blocos longos.
 */
export class SlackMessagingAdapter {
  private readonly connectorsWebhook: ConnectorsWebhookService;
  private readonly messagingService: MessagingService;
  private readonly fetchFn: FetchLike;

  constructor(options: SlackAdapterOptions) {
    this.connectorsWebhook = options.connectorsWebhook;
    this.messagingService = options.messagingService;
    this.fetchFn = options.fetchImpl ?? fetch;

    this.messagingService.registerOutboundSender("slack", async (dispatch) => {
      await this.sendReplyChunks({
        channelId: dispatch.channelId,
        chunks: dispatch.chunks,
        threadTs: dispatch.threadId,
      });
    });
  }

  public async sendReplyChunks(params: {
    channelId: string;
    chunks: string[];
    threadTs?: string | null;
  }): Promise<void> {
    for (const chunk of params.chunks) {
      const result = await this.connectorsWebhook.sendSlackMessageWithThread({
        channel: params.channelId,
        text: chunk,
        threadTs: params.threadTs,
        fetchImpl: this.fetchFn,
      });
      if (!result.ok) {
        throw new Error(result.erro ?? "Falha ao enviar resposta ao Slack.");
      }
    }
  }

  public async handleVerifiedEventPayload(payload: Record<string, unknown>): Promise<{
    routed: boolean;
    allowed?: boolean;
    reason?: string;
    chunksSent: number;
  }> {
    const inner =
      payload.event && typeof payload.event === "object"
        ? (payload.event as Record<string, unknown>)
        : null;
    if (!inner) {
      return { routed: false, chunksSent: 0 };
    }

    const eventType = String(inner.type ?? "");
    if (eventType !== "message" && eventType !== "app_mention") {
      return { routed: false, chunksSent: 0 };
    }
    if (inner.bot_id || inner.subtype === "bot_message") {
      return { routed: false, chunksSent: 0 };
    }

    const text = typeof inner.text === "string" ? inner.text.trim() : "";
    const channelId = typeof inner.channel === "string" ? inner.channel : "";
    const senderId = typeof inner.user === "string" ? inner.user : "";
    const ts = typeof inner.ts === "string" ? inner.ts : String(Date.now());
    const threadTs =
      typeof inner.thread_ts === "string" ? inner.thread_ts : ts;

    if (!text || !channelId || !senderId) {
      return { routed: false, chunksSent: 0 };
    }

    const inbound: InboundMessagingEvent = {
      platform: "slack",
      messageId: ts,
      channelId,
      senderId,
      senderName: senderId,
      text,
      threadId: threadTs,
      replyToMessageId: ts,
      raw: payload,
    };

    const res = await this.messagingService.handleInbound(inbound);
    return {
      routed: true,
      allowed: res.allowed,
      reason: res.reason,
      chunksSent: res.chunksSent,
    };
  }
}
