import { createHmac, timingSafeEqual } from "node:crypto";
import type { VaultService } from "../vault/vault-service.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { resolveMetaCommentCredentials } from "./meta-comment-dm-client.ts";
import type { MetaCommentDmEngine } from "./meta-comment-dm-engine.ts";
import type { MetaCommentDmService } from "./meta-comment-dm-service.ts";

export interface RelayEventEnvelope {
  id: string;
  raw_body: string;
  signature_header?: string | null;
  received_at?: string;
}

export function verifyMetaWebhookHmac(rawBody: string, signatureHeader: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!appSecret || !signatureHeader) return false;
  const sig = signatureHeader.trim();
  if (!sig.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dispatchParsedMetaWebhookPayload(
  payload: Record<string, unknown>,
  engine: MetaCommentDmEngine,
  contaId: string,
  sourceMode: "direct_webhook" | "painel_relay"
): Promise<number> {
  const entries = Array.isArray(payload.entry) ? (payload.entry as Array<Record<string, unknown>>) : [];
  const tasks: Array<Promise<unknown>> = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as Array<Record<string, unknown>>) : [];
    for (const ch of changes) {
      const field = String(ch.field ?? "");
      if (field !== "comments" && field !== "live_comments") continue;
      const val = (ch.value ?? {}) as Record<string, unknown>;
      const from = (val.from ?? {}) as Record<string, unknown>;
      const media = (val.media ?? {}) as Record<string, unknown>;
      const commentId = String(val.id ?? val.comment_id ?? "").trim();
      const text = String(val.text ?? "").trim();
      const senderIgId = String(from.id ?? "").trim();
      const mediaId = String(media.id ?? val.media_id ?? "unknown-media").trim();
      if (!commentId || !senderIgId) continue;

      tasks.push(
        engine.handleIncomingComment({
          contaId,
          commentId,
          mediaId,
          parentId: typeof val.parent_id === "string" ? val.parent_id : null,
          senderIgId,
          senderUsername: typeof from.username === "string" ? from.username : null,
          text,
          timestamp: typeof val.timestamp === "string" ? val.timestamp : new Date().toISOString(),
          isLive: field === "live_comments",
          sourceMode,
        })
      );
    }

    const messaging = Array.isArray(entry.messaging) ? (entry.messaging as Array<Record<string, unknown>>) : [];
    for (const msgEvt of messaging) {
      const sender = (msgEvt.sender ?? {}) as Record<string, unknown>;
      const senderIgId = String(sender.id ?? "").trim();
      if (!senderIgId) continue;
      const postback = msgEvt.postback as Record<string, unknown> | undefined;
      const message = msgEvt.message as Record<string, unknown> | undefined;
      const quickReply = message?.quick_reply as Record<string, unknown> | undefined;

      tasks.push(
        engine.handleIncomingDmInteraction({
          contaId,
          senderIgId,
          text: typeof message?.text === "string" ? message.text : null,
          postbackPayload: typeof postback?.payload === "string" ? postback.payload : null,
          quickReplyPayload: typeof quickReply?.payload === "string" ? quickReply.payload : null,
          isEcho: message?.is_echo === true,
          metadata: typeof message?.metadata === "string" ? message.metadata : null,
          timestamp:
            typeof msgEvt.timestamp === "number"
              ? new Date(msgEvt.timestamp).toISOString()
              : new Date().toISOString(),
        })
      );
    }
  }

  return Promise.all(tasks).then((list) => list.length);
}

/**
 * Cliente local (Modo 3) que consome eventos do Webhook Relay no Painel via pull/SSE,
 * valida X-Hub-Signature-256 localmente com o Cofre AES-256-GCM e confirma ACK.
 */
export class MetaRelayClient {
  private readonly vault?: VaultService;
  private readonly nativeStore?: NativeAppConnectionsStore;
  private readonly engine: MetaCommentDmEngine;
  private readonly service: MetaCommentDmService;
  private readonly fetchImpl: FetchLike;
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: {
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    engine: MetaCommentDmEngine;
    service: MetaCommentDmService;
    fetchImpl?: FetchLike;
  }) {
    this.vault = deps.vault;
    this.nativeStore = deps.nativeStore;
    this.engine = deps.engine;
    this.service = deps.service;
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  public start(intervalMs = 4_000): void {
    this.dispose();
    this.pollTimer = setInterval(() => {
      void this.pullOnce();
    }, Math.max(1_500, intervalMs));
    this.pollTimer.unref?.();
  }

  public dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async provisionChannel(input: {
    painelBaseUrl: string;
    licenseKey: string;
    contaId?: string;
    verifyToken?: string;
  }): Promise<{ ok: boolean; channel_id?: string; verify_token?: string; webhook_url?: string; erro?: string }> {
    const base = input.painelBaseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/api/relay/meta/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: input.licenseKey,
        verify_token: input.verifyToken,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !data.ok) {
      return { ok: false, erro: String(data.error || data.message || `HTTP ${res.status}`) };
    }
    const channelId = String(data.channel_id);
    const channelSecret = String(data.channel_secret);
    const verifyToken = String(data.verify_token);
    const contaId = input.contaId?.trim() || "principal";

    this.vault?.setSecret("META_RELAY_BASE_URL", base);
    this.vault?.setSecret("META_RELAY_CHANNEL_ID", channelId);
    this.vault?.setSecret("META_RELAY_CHANNEL_SECRET", channelSecret);
    this.vault?.setSecret("META_RELAY_VERIFY_TOKEN", verifyToken);
    this.service.saveConnectionConfig({
      conta_id: contaId,
      reception_mode: "painel_relay",
      relay_channel_id: channelId,
      relay_verify_token: verifyToken,
      relay_enabled: true,
    });

    return {
      ok: true,
      channel_id: channelId,
      verify_token: verifyToken,
      webhook_url: `${base}/api/webhooks/meta-relay/${encodeURIComponent(channelId)}`,
    };
  }

  public async pullOnce(contaId = "principal"): Promise<{ received: number; accepted: number; rejected: number }> {
    if (this.running) return { received: 0, accepted: 0, rejected: 0 };
    const cfg = this.service.getConnectionConfig(contaId);
    if (cfg.reception_mode !== "painel_relay" || !cfg.relay_enabled) {
      return { received: 0, accepted: 0, rejected: 0 };
    }

    const baseUrl = this.vault?.getSecret("META_RELAY_BASE_URL")?.replace(/\/+$/, "");
    const channelId = this.vault?.getSecret("META_RELAY_CHANNEL_ID") || cfg.relay_channel_id;
    const channelSecret = this.vault?.getSecret("META_RELAY_CHANNEL_SECRET");
    if (!baseUrl || !channelId || !channelSecret) {
      return { received: 0, accepted: 0, rejected: 0 };
    }

    this.running = true;
    try {
      const res = await this.fetchImpl(`${baseUrl}/api/relay/meta/pull`, {
        headers: {
          "x-relay-channel-id": channelId,
          "x-relay-secret": channelSecret,
        },
      });
      if (!res.ok) return { received: 0, accepted: 0, rejected: 0 };
      const body = (await res.json()) as { items?: RelayEventEnvelope[] };
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return { received: 0, accepted: 0, rejected: 0 };

      const creds = resolveMetaCommentCredentials(this.vault, this.nativeStore, contaId);
      const ackIds: string[] = [];
      let accepted = 0;
      let rejected = 0;

      for (const item of items) {
        ackIds.push(item.id);
        if (creds.appSecret && !verifyMetaWebhookHmac(item.raw_body, item.signature_header, creds.appSecret)) {
          rejected += 1;
          continue;
        }
        try {
          const parsed = JSON.parse(item.raw_body) as Record<string, unknown>;
          await dispatchParsedMetaWebhookPayload(parsed, this.engine, contaId, "painel_relay");
          accepted += 1;
        } catch {
          rejected += 1;
        }
      }

      if (ackIds.length > 0) {
        await this.fetchImpl(`${baseUrl}/api/relay/meta/ack`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-relay-channel-id": channelId,
            "x-relay-secret": channelSecret,
          },
          body: JSON.stringify({ ids: ackIds }),
        });
      }

      return { received: items.length, accepted, rejected };
    } finally {
      this.running = false;
    }
  }
}
