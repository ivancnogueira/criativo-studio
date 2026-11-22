import type {
  InboundMessagingEvent,
  MessagingAllowlistEntry,
  MessagingAllowlistRole,
  MessagingChannelPolicy,
  MessagingPlatform,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { evaluateMessagingAccess } from "./channel-allowlist.ts";
import { resolveMessagingMentionTarget } from "./mention-router.ts";
import { chunkMessageText } from "./message-chunker.ts";

export interface MessagingOutboundDispatch {
  platform: MessagingPlatform;
  channelId: string;
  threadId?: string | null;
  replyToMessageId?: string | null;
  chunks: string[];
}

export interface MessagingAgentExecutorInput {
  agentId: string;
  prompt: string;
  event: InboundMessagingEvent;
  role: MessagingAllowlistRole;
  policy: MessagingChannelPolicy;
}

export type MessagingAgentExecutor = (
  input: MessagingAgentExecutorInput,
) => Promise<string>;

export type MessagingOutboundSender = (
  dispatch: MessagingOutboundDispatch,
) => Promise<void>;

export interface MessagingInboundResult {
  handled: boolean;
  allowed: boolean;
  reason: string;
  agentId?: string;
  usedFallback?: boolean;
  chunksSent: number;
  replyText?: string;
}

const DEFAULT_ORCHESTRATOR = "orquestrador_estrategista";

function safeParseJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function createDefaultPolicy(platform: MessagingPlatform): MessagingChannelPolicy {
  return {
    channelKind: platform,
    enabled: true,
    orchestratorAgentId: DEFAULT_ORCHESTRATOR,
    replyInThreads: true,
    allowlist: [],
    allowedChannelIds: [],
  };
}

/**
 * Serviço central de Mensageria Multicanal Conversacional (Telegram, Slack, Discord):
 * gerencia políticas por canal em SQLite, valida allowlists e papéis, resolve `@agente`
 * com fallback para o orquestrador, executa o agente e fatia a resposta respeitando limites.
 */
export class MessagingService {
  private readonly db: CriativoDatabase;
  private agentExecutor?: MessagingAgentExecutor;
  private readonly outboundSenders = new Map<MessagingPlatform, MessagingOutboundSender>();

  constructor(options: {
    db: CriativoDatabase;
    agentExecutor?: MessagingAgentExecutor;
  }) {
    this.db = options.db;
    this.agentExecutor = options.agentExecutor;
  }

  public setAgentExecutor(executor: MessagingAgentExecutor): void {
    this.agentExecutor = executor;
  }

  public registerOutboundSender(
    platform: MessagingPlatform,
    sender: MessagingOutboundSender,
  ): void {
    this.outboundSenders.set(platform, sender);
  }

  public getPolicy(platform: MessagingPlatform): MessagingChannelPolicy {
    const row = this.db.connection
      .prepare(
        `SELECT channel_kind, enabled, orchestrator_agent_id, reply_in_threads,
                allowlist_json, allowed_channels_json, updated_at
         FROM projecao_messaging_policies
         WHERE channel_kind = ?;`,
      )
      .get(platform) as
      | {
          channel_kind: MessagingPlatform;
          enabled: number;
          orchestrator_agent_id: string;
          reply_in_threads: number;
          allowlist_json: string;
          allowed_channels_json: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return createDefaultPolicy(platform);
    }

    return {
      channelKind: row.channel_kind,
      enabled: row.enabled === 1,
      orchestratorAgentId: row.orchestrator_agent_id || DEFAULT_ORCHESTRATOR,
      replyInThreads: row.reply_in_threads === 1,
      allowlist: safeParseJsonArray<MessagingAllowlistEntry>(row.allowlist_json, []),
      allowedChannelIds: safeParseJsonArray<string>(row.allowed_channels_json, []),
      updatedAt: row.updated_at,
    };
  }

  public listPolicies(): MessagingChannelPolicy[] {
    const platforms: MessagingPlatform[] = ["telegram", "slack", "discord"];
    return platforms.map((p) => this.getPolicy(p));
  }

  public savePolicy(policy: MessagingChannelPolicy): MessagingChannelPolicy {
    const now = new Date().toISOString();
    const orchestrator = policy.orchestratorAgentId?.trim() || DEFAULT_ORCHESTRATOR;
    const allowlist = Array.isArray(policy.allowlist) ? policy.allowlist : [];
    const allowedChannels = Array.isArray(policy.allowedChannelIds)
      ? policy.allowedChannelIds
      : [];

    this.db.connection
      .prepare(
        `INSERT INTO projecao_messaging_policies (
          channel_kind, enabled, orchestrator_agent_id, reply_in_threads,
          allowlist_json, allowed_channels_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_kind) DO UPDATE SET
          enabled = excluded.enabled,
          orchestrator_agent_id = excluded.orchestrator_agent_id,
          reply_in_threads = excluded.reply_in_threads,
          allowlist_json = excluded.allowlist_json,
          allowed_channels_json = excluded.allowed_channels_json,
          updated_at = excluded.updated_at;`,
      )
      .run(
        policy.channelKind,
        policy.enabled ? 1 : 0,
        orchestrator,
        policy.replyInThreads ? 1 : 0,
        JSON.stringify(allowlist),
        JSON.stringify(allowedChannels),
        now,
      );

    return this.getPolicy(policy.channelKind);
  }

  public async handleInbound(event: InboundMessagingEvent): Promise<MessagingInboundResult> {
    const text = String(event.text ?? "").trim();
    if (!text) {
      return {
        handled: false,
        allowed: true,
        reason: "Mensagem vazia ignorada.",
        chunksSent: 0,
      };
    }

    const policy = this.getPolicy(event.platform);
    const access = evaluateMessagingAccess({
      policy,
      senderId: event.senderId,
      channelId: event.channelId,
    });

    if (!access.allowed || !access.role) {
      return {
        handled: false,
        allowed: false,
        reason: access.reason,
        chunksSent: 0,
      };
    }

    const route = resolveMessagingMentionTarget({
      text,
      db: this.db,
      defaultAgentId: policy.orchestratorAgentId,
    });

    if (!this.agentExecutor) {
      return {
        handled: false,
        allowed: true,
        reason: "Executor de agente não configurado no MessagingService.",
        agentId: route.agentId,
        usedFallback: route.usedFallback,
        chunksSent: 0,
      };
    }

    const replyText = await this.agentExecutor({
      agentId: route.agentId,
      prompt: route.cleanedText,
      event,
      role: access.role,
      policy,
    });

    const chunks = chunkMessageText(replyText, event.platform);
    const sender = this.outboundSenders.get(event.platform);
    if (sender && chunks.length > 0) {
      const threadId = policy.replyInThreads ? event.threadId ?? null : null;
      const replyToMessageId = policy.replyInThreads
        ? event.replyToMessageId ?? event.messageId
        : null;
      await sender({
        platform: event.platform,
        channelId: event.channelId,
        threadId,
        replyToMessageId,
        chunks,
      });
    }

    return {
      handled: true,
      allowed: true,
      reason: access.reason,
      agentId: route.agentId,
      usedFallback: route.usedFallback,
      chunksSent: chunks.length,
      replyText,
    };
  }
}
