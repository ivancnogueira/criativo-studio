import {
  resolveMetaGraphApiVersion,
  type CommentDmButton,
} from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { resolveMetaCredentials } from "../engine/tools/meta-insights.ts";
import { redactMetaSecrets } from "../engine/tools/meta-trial-eligibility.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { VaultService } from "../vault/vault-service.ts";

export type MetaLoginMode = "instagram" | "facebook";

export interface MetaCommentResolvedCredentials {
  accessToken: string | null;
  accountId: string | null;
  contaId: string | null;
  pageId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  loginMode: MetaLoginMode;
  apiVersion: string;
  configured: boolean;
}

export interface DmOutboundPayload {
  text: string;
  buttons?: CommentDmButton[];
  quickReplies?: Array<{ title: string; payload: string }>;
  metadataTag: string;
}

export interface MetaGraphSendResult {
  ok: boolean;
  messageId?: string | null;
  commentId?: string | null;
  recipientId?: string | null;
  endpointUsed?: string;
  httpStatus?: number;
  erro?: string;
}

function readSecretFromStoreOrVault(
  vault: VaultService | undefined,
  nativeStore: NativeAppConnectionsStore | undefined,
  contaId: string | null | undefined,
  keys: string[]
): string | null {
  if (nativeStore) {
    const resolved = nativeStore.getResolvedCredentials("instagram", contaId);
    for (const key of keys) {
      const val = resolved.values[key]?.trim();
      if (val) return val;
    }
  }
  if (vault) {
    for (const key of keys) {
      const val = vault.getSecret(key)?.trim();
      if (val) return val;
    }
  }
  return null;
}

export function resolveMetaCommentCredentials(
  vault?: VaultService,
  nativeStore?: NativeAppConnectionsStore,
  contaId?: string | null
): MetaCommentResolvedCredentials {
  const base = resolveMetaCredentials(vault, nativeStore, contaId);
  const pageId = readSecretFromStoreOrVault(vault, nativeStore, base.contaId ?? contaId, [
    "IG_PAGE_ID",
    "FB_PAGE_ID",
    "META_PAGE_ID",
  ]);
  const appSecret = readSecretFromStoreOrVault(vault, nativeStore, base.contaId ?? contaId, [
    "IG_APP_SECRET",
    "META_APP_SECRET",
  ]);
  const verifyToken = readSecretFromStoreOrVault(vault, nativeStore, base.contaId ?? contaId, [
    "IG_WEBHOOK_VERIFY_TOKEN",
    "META_WEBHOOK_VERIFY_TOKEN",
  ]);
  const modeRaw = readSecretFromStoreOrVault(vault, nativeStore, base.contaId ?? contaId, [
    "IG_LOGIN_MODE",
  ]);

  const loginMode: MetaLoginMode =
    modeRaw === "facebook" || (Boolean(pageId) && modeRaw !== "instagram")
      ? "facebook"
      : "instagram";

  const apiVersion = resolveMetaGraphApiVersion();
  const configured =
    Boolean(base.accessToken && base.accountId) &&
    (loginMode === "instagram" || Boolean(pageId));

  return {
    accessToken: base.accessToken,
    accountId: base.accountId,
    contaId: base.contaId ?? contaId ?? null,
    pageId,
    appSecret,
    verifyToken,
    loginMode,
    apiVersion,
    configured,
  };
}

export function buildDmMessageBody(payload: DmOutboundPayload): Record<string, unknown> {
  const trimmedText = payload.text.trim().slice(0, 1000);
  const buttons = (payload.buttons ?? []).slice(0, 3);
  const quickReplies = (payload.quickReplies ?? []).slice(0, 13);

  if (buttons.length > 0) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: trimmedText,
          buttons: buttons.map((btn) =>
            btn.kind === "web_url" && btn.url
              ? {
                  type: "web_url",
                  url: btn.url,
                  title: btn.label.slice(0, 20),
                }
              : {
                  type: "postback",
                  title: btn.label.slice(0, 20),
                  payload: btn.payload || `btn:${btn.id}`,
                }
          ),
        },
      },
      metadata: payload.metadataTag,
    };
  }

  const msg: Record<string, unknown> = {
    text: trimmedText,
    metadata: payload.metadataTag,
  };
  if (quickReplies.length > 0) {
    msg.quick_replies = quickReplies.map((qr) => ({
      content_type: "text",
      title: qr.title.slice(0, 20),
      payload: qr.payload,
    }));
  }
  return msg;
}

/**
 * Adaptador Dual-Endpoint oficial Meta (Instagram Login vs Facebook Page Login)
 * + resposta pública texto-only em comentários.
 */
export class MetaCommentDmClient {
  private readonly vault?: VaultService;
  private readonly nativeStore?: NativeAppConnectionsStore;
  private readonly fetchImpl: FetchLike;

  constructor(deps: {
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    fetchImpl?: FetchLike;
  }) {
    this.vault = deps.vault;
    this.nativeStore = deps.nativeStore;
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  public getCredentials(contaId?: string | null): MetaCommentResolvedCredentials {
    return resolveMetaCommentCredentials(this.vault, this.nativeStore, contaId);
  }

  public resolveMessagingEndpoint(creds: MetaCommentResolvedCredentials): string {
    if (creds.loginMode === "facebook") {
      if (!creds.pageId) {
        throw new Error("Modo Facebook Login requer 'page_id' (IG_PAGE_ID) configurado para enviar DM.");
      }
      return `https://graph.facebook.com/${creds.apiVersion}/${encodeURIComponent(creds.pageId)}/messages`;
    }
    return `https://graph.instagram.com/${creds.apiVersion}/me/messages`;
  }

  public async sendPrivateReply(input: {
    contaId?: string | null;
    commentId: string;
    payload: DmOutboundPayload;
  }): Promise<MetaGraphSendResult> {
    const creds = this.getCredentials(input.contaId);
    if (!creds.accessToken || !creds.configured) {
      return { ok: false, erro: "Credenciais Meta insuficientes para Private Reply." };
    }
    const endpoint = this.resolveMessagingEndpoint(creds);
    const body = {
      recipient: { comment_id: input.commentId },
      message: buildDmMessageBody(input.payload),
    };
    return await this.postGraphJson(endpoint, creds.accessToken, body);
  }

  public async sendWindowDm(input: {
    contaId?: string | null;
    recipientIgUserId: string;
    payload: DmOutboundPayload;
  }): Promise<MetaGraphSendResult> {
    const creds = this.getCredentials(input.contaId);
    if (!creds.accessToken || !creds.configured) {
      return { ok: false, erro: "Credenciais Meta insuficientes para enviar DM na janela de 24h." };
    }
    const endpoint = this.resolveMessagingEndpoint(creds);
    const body = {
      recipient: { id: input.recipientIgUserId },
      message: buildDmMessageBody(input.payload),
    };
    return await this.postGraphJson(endpoint, creds.accessToken, body);
  }

  public async sendPublicCommentReply(input: {
    contaId?: string | null;
    commentId: string;
    messageText: string;
  }): Promise<MetaGraphSendResult> {
    const creds = this.getCredentials(input.contaId);
    if (!creds.accessToken) {
      return { ok: false, erro: "Token Meta ausente para responder comentário público." };
    }
    // Regra oficial Meta: resposta pública em /{comment_id}/replies aceita apenas texto plano
    const plainText = input.messageText.replace(/<[^>]+>/g, "").trim().slice(0, 2200);
    if (!plainText) {
      return { ok: false, erro: "Texto da resposta pública vazio." };
    }
    const host = creds.loginMode === "facebook" ? "https://graph.facebook.com" : "https://graph.instagram.com";
    const endpoint = `${host}/${creds.apiVersion}/${encodeURIComponent(input.commentId)}/replies`;
    return await this.postGraphJson(endpoint, creds.accessToken, { message: plainText });
  }

  private async postGraphJson(
    endpoint: string,
    accessToken: string,
    body: Record<string, unknown>
  ): Promise<MetaGraphSendResult> {
    try {
      const res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const rawText = await res.text();
      let parsed: Record<string, unknown> = {};
      if (rawText) {
        try {
          parsed = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      }
      if (!res.ok) {
        const errObj = parsed.error as Record<string, unknown> | undefined;
        const rawErr =
          (typeof errObj?.message === "string" && errObj.message) ||
          rawText ||
          `HTTP ${res.status}`;
        return {
          ok: false,
          endpointUsed: endpoint,
          httpStatus: res.status,
          erro: redactMetaSecrets(rawErr, accessToken),
        };
      }
      return {
        ok: true,
        endpointUsed: endpoint,
        httpStatus: res.status,
        messageId: typeof parsed.message_id === "string" ? parsed.message_id : null,
        commentId: typeof parsed.id === "string" ? parsed.id : null,
        recipientId: typeof parsed.recipient_id === "string" ? parsed.recipient_id : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        endpointUsed: endpoint,
        erro: redactMetaSecrets(msg, accessToken),
      };
    }
  }
}
