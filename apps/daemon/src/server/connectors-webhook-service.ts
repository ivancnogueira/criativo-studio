/**
 * Serviço de conectores diretos opcionais (Slack, Discord e GitHub) com tokens
 * armazenados no VaultService (AES-256-GCM) e validação criptográfica de webhooks (UX-04 / D-07).
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import type { OptionalConnectorWebhookEvent } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export interface ConnectorsWebhookServiceDeps {
  db: CriativoDatabase;
  vault: VaultService;
  wsHub?: WebSocketHub;
  onTriggerWorkflow?: (event: OptionalConnectorWebhookEvent) => Promise<void> | void;
}

export const VAULT_KEY_SLACK_BOT_TOKEN = "slack_bot_token";
export const VAULT_KEY_SLACK_SIGNING_SECRET = "slack_signing_secret";
export const VAULT_KEY_DISCORD_BOT_TOKEN = "discord_bot_token";
export const VAULT_KEY_DISCORD_APP_ID = "discord_application_id";
export const VAULT_KEY_DISCORD_PUBLIC_KEY = "discord_public_key";
export const VAULT_KEY_DISCORD_WEBHOOK_URL = "discord_webhook_url";
export const VAULT_KEY_GITHUB_TOKEN = "github_token";
export const VAULT_KEY_GITHUB_WEBHOOK_SECRET = "github_webhook_secret";

const CONFIG_SLACK_META = "conector_slack_meta";
const CONFIG_DISCORD_META = "conector_discord_meta";
const CONFIG_GITHUB_META = "conector_github_meta";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function maskValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function safeEqualStrings(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class ConnectorsWebhookService {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;
  private readonly wsHub?: WebSocketHub;
  private readonly onTriggerWorkflow?: (
    event: OptionalConnectorWebhookEvent,
  ) => Promise<void> | void;

  constructor(deps: ConnectorsWebhookServiceDeps) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.wsHub = deps.wsHub;
    this.onTriggerWorkflow = deps.onTriggerWorkflow;
  }

  private readMeta(chave: string): Record<string, unknown> {
    const row = this.db.connection
      .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ?")
      .get(chave) as { valor_json: string } | undefined;
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.valor_json);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private writeMeta(chave: string, meta: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.db.connection
      .prepare(`
        INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
        VALUES (?, ?, ?)
        ON CONFLICT(chave) DO UPDATE SET
          valor_json = excluded.valor_json,
          atualizado_em = excluded.atualizado_em
      `)
      .run(chave, JSON.stringify(meta), now);
  }

  public getStatusSnapshot(): {
    slack: {
      configured: boolean;
      hasBotToken: boolean;
      hasSigningSecret: boolean;
      defaultChannel: string | null;
      maskedBotToken: string | null;
      teamName: string | null;
    };
    discord: {
      configured: boolean;
      hasBotToken: boolean;
      hasPublicKey: boolean;
      hasWebhookUrl: boolean;
      applicationId: string | null;
      maskedBotToken: string | null;
      botUsername: string | null;
    };
    github: {
      configured: boolean;
      hasToken: boolean;
      hasWebhookSecret: boolean;
      defaultRepo: string | null;
      maskedToken: string | null;
      username: string | null;
    };
  } {
    const slackBot = this.vault.getSecret(VAULT_KEY_SLACK_BOT_TOKEN);
    const slackSecret = this.vault.getSecret(VAULT_KEY_SLACK_SIGNING_SECRET);
    const slackMeta = this.readMeta(CONFIG_SLACK_META);

    const discordBot = this.vault.getSecret(VAULT_KEY_DISCORD_BOT_TOKEN);
    const discordAppId = this.vault.getSecret(VAULT_KEY_DISCORD_APP_ID);
    const discordPubKey = this.vault.getSecret(VAULT_KEY_DISCORD_PUBLIC_KEY);
    const discordWebhook = this.vault.getSecret(VAULT_KEY_DISCORD_WEBHOOK_URL);
    const discordMeta = this.readMeta(CONFIG_DISCORD_META);

    const githubToken = this.vault.getSecret(VAULT_KEY_GITHUB_TOKEN);
    const githubSecret = this.vault.getSecret(VAULT_KEY_GITHUB_WEBHOOK_SECRET);
    const githubMeta = this.readMeta(CONFIG_GITHUB_META);

    return {
      slack: {
        configured: Boolean(slackBot || slackSecret),
        hasBotToken: Boolean(slackBot),
        hasSigningSecret: Boolean(slackSecret),
        defaultChannel:
          typeof slackMeta.defaultChannel === "string" ? slackMeta.defaultChannel : null,
        maskedBotToken: maskValue(slackBot),
        teamName: typeof slackMeta.teamName === "string" ? slackMeta.teamName : null,
      },
      discord: {
        configured: Boolean(discordBot || discordPubKey || discordWebhook),
        hasBotToken: Boolean(discordBot),
        hasPublicKey: Boolean(discordPubKey),
        hasWebhookUrl: Boolean(discordWebhook),
        applicationId: discordAppId,
        maskedBotToken: maskValue(discordBot),
        botUsername: typeof discordMeta.botUsername === "string" ? discordMeta.botUsername : null,
      },
      github: {
        configured: Boolean(githubToken || githubSecret),
        hasToken: Boolean(githubToken),
        hasWebhookSecret: Boolean(githubSecret),
        defaultRepo: typeof githubMeta.defaultRepo === "string" ? githubMeta.defaultRepo : null,
        maskedToken: maskValue(githubToken),
        username: typeof githubMeta.username === "string" ? githubMeta.username : null,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Slack
  // --------------------------------------------------------------------------

  public configureSlack(params: {
    botToken?: string;
    signingSecret?: string;
    defaultChannel?: string | null;
  }): ReturnType<ConnectorsWebhookService["getStatusSnapshot"]>["slack"] {
    if (typeof params.botToken === "string") {
      const val = params.botToken.trim();
      if (val) this.vault.setSecret(VAULT_KEY_SLACK_BOT_TOKEN, val);
      else this.vault.deleteSecret(VAULT_KEY_SLACK_BOT_TOKEN);
    }
    if (typeof params.signingSecret === "string") {
      const val = params.signingSecret.trim();
      if (val) this.vault.setSecret(VAULT_KEY_SLACK_SIGNING_SECRET, val);
      else this.vault.deleteSecret(VAULT_KEY_SLACK_SIGNING_SECRET);
    }
    const prevMeta = this.readMeta(CONFIG_SLACK_META);
    if (params.defaultChannel !== undefined) {
      prevMeta.defaultChannel = params.defaultChannel?.trim() || null;
      this.writeMeta(CONFIG_SLACK_META, prevMeta);
    }
    return this.getStatusSnapshot().slack;
  }

  public async testSlack(
    fetchImpl: typeof fetch = fetch,
  ): Promise<{ ok: boolean; status: string; team?: string | null; user?: string | null; erro?: string }> {
    const token = this.vault.getSecret(VAULT_KEY_SLACK_BOT_TOKEN);
    if (!token) {
      return { ok: false, status: "desconectado", erro: "Bot Token do Slack não configurado no Cofre." };
    }
    try {
      const resp = await fetchImpl("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        team?: string;
        user?: string;
        error?: string;
      };
      if (!resp.ok || !data.ok) {
        return {
          ok: false,
          status: "atencao",
          erro: data.error ?? `HTTP ${resp.status}`,
        };
      }
      const prevMeta = this.readMeta(CONFIG_SLACK_META);
      this.writeMeta(CONFIG_SLACK_META, { ...prevMeta, teamName: data.team ?? null });
      return {
        ok: true,
        status: "conectado",
        team: data.team ?? null,
        user: data.user ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        status: "atencao",
        erro: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public verifySlackSignature(
    rawBody: string,
    timestampHeader: string | undefined,
    signatureHeader: string | undefined,
    nowMs = Date.now(),
  ): boolean {
    const secret = this.vault.getSecret(VAULT_KEY_SLACK_SIGNING_SECRET);
    if (!secret || !timestampHeader || !signatureHeader) return false;

    const tsSeconds = Number(timestampHeader.trim());
    if (!Number.isFinite(tsSeconds)) return false;
    const diffSeconds = Math.abs(Math.floor(nowMs / 1000) - tsSeconds);
    if (diffSeconds > 300) return false;

    const sig = signatureHeader.trim();
    if (!sig.startsWith("v0=")) return false;

    const baseString = `v0:${timestampHeader.trim()}:${rawBody}`;
    const expected = `v0=${createHmac("sha256", secret).update(baseString, "utf8").digest("hex")}`;
    return safeEqualStrings(expected, sig);
  }

  public async handleSlackWebhook(params: {
    rawBody: string;
    timestampHeader?: string;
    signatureHeader?: string;
    nowMs?: number;
  }): Promise<{
    ok: boolean;
    statusCode: number;
    body: Record<string, unknown>;
    event?: OptionalConnectorWebhookEvent;
  }> {
    if (
      !this.verifySlackSignature(
        params.rawBody,
        params.timestampHeader,
        params.signatureHeader,
        params.nowMs,
      )
    ) {
      return { ok: false, statusCode: 401, body: { erro: "Assinatura do Slack inválida ou expirada." } };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(params.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, statusCode: 400, body: { erro: "JSON de webhook Slack inválido." } };
    }

    if (payload.type === "url_verification" && typeof payload.challenge === "string") {
      return {
        ok: true,
        statusCode: 200,
        body: { challenge: payload.challenge },
      };
    }

    const inner =
      payload.event && typeof payload.event === "object"
        ? (payload.event as Record<string, unknown>)
        : {};
    const evento = String(inner.type ?? payload.type ?? "event_callback");
    const canal = typeof inner.channel === "string" ? inner.channel : null;
    const autor = typeof inner.user === "string" ? inner.user : null;
    const texto = typeof inner.text === "string" ? inner.text : null;

    const event: OptionalConnectorWebhookEvent = {
      conector_id: "slack",
      evento,
      canal_ou_repo: canal,
      autor,
      texto,
      dados: payload,
      recebido_em: new Date().toISOString(),
    };

    if ((evento === "app_mention" || evento === "message") && this.onTriggerWorkflow) {
      await this.onTriggerWorkflow(event);
    }

    return { ok: true, statusCode: 200, body: { ok: true, evento }, event };
  }

  public async sendSlackMessage(params: {
    channel?: string;
    text: string;
    fetchImpl?: typeof fetch;
  }): Promise<{ ok: boolean; ts?: string; erro?: string }> {
    const token = this.vault.getSecret(VAULT_KEY_SLACK_BOT_TOKEN);
    const meta = this.readMeta(CONFIG_SLACK_META);
    const channel =
      params.channel?.trim() ||
      (typeof meta.defaultChannel === "string" ? meta.defaultChannel : "");
    if (!token || !channel) {
      return { ok: false, erro: "Token ou canal padrão do Slack não configurados." };
    }
    const fetchFn = params.fetchImpl ?? fetch;
    const resp = await fetchFn("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text: params.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await resp.json()) as { ok?: boolean; ts?: string; error?: string };
    return data.ok
      ? { ok: true, ts: data.ts }
      : { ok: false, erro: data.error ?? `HTTP ${resp.status}` };
  }

  // --------------------------------------------------------------------------
  // Discord
  // --------------------------------------------------------------------------

  public configureDiscord(params: {
    botToken?: string;
    applicationId?: string;
    publicKey?: string;
    webhookUrl?: string;
  }): ReturnType<ConnectorsWebhookService["getStatusSnapshot"]>["discord"] {
    if (typeof params.botToken === "string") {
      const val = params.botToken.trim();
      if (val) this.vault.setSecret(VAULT_KEY_DISCORD_BOT_TOKEN, val);
      else this.vault.deleteSecret(VAULT_KEY_DISCORD_BOT_TOKEN);
    }
    if (typeof params.applicationId === "string") {
      const val = params.applicationId.trim();
      if (val) this.vault.setSecret(VAULT_KEY_DISCORD_APP_ID, val);
      else this.vault.deleteSecret(VAULT_KEY_DISCORD_APP_ID);
    }
    if (typeof params.publicKey === "string") {
      const val = params.publicKey.trim();
      if (val) this.vault.setSecret(VAULT_KEY_DISCORD_PUBLIC_KEY, val);
      else this.vault.deleteSecret(VAULT_KEY_DISCORD_PUBLIC_KEY);
    }
    if (typeof params.webhookUrl === "string") {
      const val = params.webhookUrl.trim();
      if (val) this.vault.setSecret(VAULT_KEY_DISCORD_WEBHOOK_URL, val);
      else this.vault.deleteSecret(VAULT_KEY_DISCORD_WEBHOOK_URL);
    }
    return this.getStatusSnapshot().discord;
  }

  public async testDiscord(
    fetchImpl: typeof fetch = fetch,
  ): Promise<{ ok: boolean; status: string; username?: string | null; erro?: string }> {
    const token = this.vault.getSecret(VAULT_KEY_DISCORD_BOT_TOKEN);
    const webhookUrl = this.vault.getSecret(VAULT_KEY_DISCORD_WEBHOOK_URL);
    if (!token && !webhookUrl) {
      return {
        ok: false,
        status: "desconectado",
        erro: "Configure o Bot Token ou Webhook URL do Discord no Cofre.",
      };
    }

    try {
      if (token) {
        const resp = await fetchImpl("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await resp.json()) as { username?: string; message?: string };
        if (!resp.ok) {
          return {
            ok: false,
            status: "atencao",
            erro: data.message ?? `HTTP ${resp.status}`,
          };
        }
        const prevMeta = this.readMeta(CONFIG_DISCORD_META);
        this.writeMeta(CONFIG_DISCORD_META, { ...prevMeta, botUsername: data.username ?? null });
        return { ok: true, status: "conectado", username: data.username ?? null };
      }

      // Validação passiva de Webhook URL do Discord
      const parsed = new URL(webhookUrl!);
      if (
        parsed.protocol !== "https:" ||
        (parsed.hostname !== "discord.com" && parsed.hostname !== "discordapp.com")
      ) {
        return { ok: false, status: "atencao", erro: "URL de webhook Discord inválida." };
      }
      const resp = await fetchImpl(webhookUrl!, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        return { ok: false, status: "atencao", erro: `Webhook Discord HTTP ${resp.status}` };
      }
      const info = (await resp.json()) as { name?: string };
      return { ok: true, status: "conectado", username: info.name ?? "Webhook Discord" };
    } catch (err) {
      return {
        ok: false,
        status: "atencao",
        erro: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public verifyDiscordSignature(
    rawBody: string,
    signatureHex: string | undefined,
    timestamp: string | undefined,
  ): boolean {
    const pubKeyRaw = this.vault.getSecret(VAULT_KEY_DISCORD_PUBLIC_KEY);
    if (!pubKeyRaw || !signatureHex || !timestamp) return false;
    try {
      const keyObj = pubKeyRaw.includes("BEGIN PUBLIC KEY")
        ? createPublicKey(pubKeyRaw)
        : createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubKeyRaw.trim(), "hex")]),
            format: "der",
            type: "spki",
          });
      const message = Buffer.from(`${timestamp}${rawBody}`, "utf8");
      const signature = Buffer.from(signatureHex.trim(), "hex");
      return cryptoVerify(null, message, keyObj, signature);
    } catch {
      return false;
    }
  }

  public async handleDiscordWebhook(params: {
    rawBody: string;
    signatureHeader?: string;
    timestampHeader?: string;
  }): Promise<{
    ok: boolean;
    statusCode: number;
    body: Record<string, unknown>;
    event?: OptionalConnectorWebhookEvent;
  }> {
    if (
      !this.verifyDiscordSignature(
        params.rawBody,
        params.signatureHeader,
        params.timestampHeader,
      )
    ) {
      return { ok: false, statusCode: 401, body: { erro: "Assinatura Ed25519 do Discord inválida." } };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(params.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, statusCode: 400, body: { erro: "JSON de interação Discord inválido." } };
    }

    // Discord PING verification (type === 1)
    if (payload.type === 1) {
      return { ok: true, statusCode: 200, body: { type: 1 } };
    }

    const memberObj = (payload.member ?? {}) as Record<string, unknown>;
    const userObj = (memberObj.user ?? payload.user ?? {}) as Record<string, unknown>;
    const dataObj = (payload.data ?? {}) as Record<string, unknown>;
    const evento =
      typeof dataObj.name === "string"
        ? `interaction:${dataObj.name}`
        : `interaction_type_${String(payload.type ?? "unknown")}`;

    const event: OptionalConnectorWebhookEvent = {
      conector_id: "discord",
      evento,
      canal_ou_repo: typeof payload.channel_id === "string" ? payload.channel_id : null,
      autor: typeof userObj.username === "string" ? userObj.username : null,
      texto:
        typeof dataObj.name === "string"
          ? `/${dataObj.name}`
          : null,
      dados: payload,
      recebido_em: new Date().toISOString(),
    };

    if (this.onTriggerWorkflow) {
      await this.onTriggerWorkflow(event);
    }

    return {
      ok: true,
      statusCode: 200,
      body: {
        type: 4,
        data: { content: "Interação recebida pelo Criativo AI Studio." },
      },
      event,
    };
  }

  public async sendDiscordMessage(params: {
    channelId?: string;
    content: string;
    fetchImpl?: typeof fetch;
  }): Promise<{ ok: boolean; erro?: string }> {
    const fetchFn = params.fetchImpl ?? fetch;
    const webhookUrl = this.vault.getSecret(VAULT_KEY_DISCORD_WEBHOOK_URL);
    if (webhookUrl && !params.channelId) {
      const resp = await fetchFn(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: params.content.slice(0, 2000) }),
        signal: AbortSignal.timeout(10_000),
      });
      return resp.ok ? { ok: true } : { ok: false, erro: `Discord HTTP ${resp.status}` };
    }

    const token = this.vault.getSecret(VAULT_KEY_DISCORD_BOT_TOKEN);
    if (!token || !params.channelId) {
      return { ok: false, erro: "Bot token/channelId ou Webhook URL do Discord ausentes." };
    }
    const resp = await fetchFn(
      `https://discord.com/api/v10/channels/${encodeURIComponent(params.channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: params.content.slice(0, 2000) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return resp.ok ? { ok: true } : { ok: false, erro: `Discord HTTP ${resp.status}` };
  }

  // --------------------------------------------------------------------------
  // GitHub
  // --------------------------------------------------------------------------

  public configureGitHub(params: {
    token?: string;
    webhookSecret?: string;
    defaultRepo?: string | null;
  }): ReturnType<ConnectorsWebhookService["getStatusSnapshot"]>["github"] {
    if (typeof params.token === "string") {
      const val = params.token.trim();
      if (val) this.vault.setSecret(VAULT_KEY_GITHUB_TOKEN, val);
      else this.vault.deleteSecret(VAULT_KEY_GITHUB_TOKEN);
    }
    if (typeof params.webhookSecret === "string") {
      const val = params.webhookSecret.trim();
      if (val) this.vault.setSecret(VAULT_KEY_GITHUB_WEBHOOK_SECRET, val);
      else this.vault.deleteSecret(VAULT_KEY_GITHUB_WEBHOOK_SECRET);
    }
    if (params.defaultRepo !== undefined) {
      const prevMeta = this.readMeta(CONFIG_GITHUB_META);
      this.writeMeta(CONFIG_GITHUB_META, {
        ...prevMeta,
        defaultRepo: params.defaultRepo?.trim() || null,
      });
    }
    return this.getStatusSnapshot().github;
  }

  public async testGitHub(
    fetchImpl: typeof fetch = fetch,
  ): Promise<{ ok: boolean; status: string; login?: string | null; erro?: string }> {
    const token = this.vault.getSecret(VAULT_KEY_GITHUB_TOKEN);
    if (!token) {
      return { ok: false, status: "desconectado", erro: "Token GitHub não configurado no Cofre." };
    }
    try {
      const resp = await fetchImpl("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Criativo-AI-Studio",
        },
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await resp.json()) as { login?: string; message?: string };
      if (!resp.ok) {
        return { ok: false, status: "atencao", erro: data.message ?? `HTTP ${resp.status}` };
      }
      const prevMeta = this.readMeta(CONFIG_GITHUB_META);
      this.writeMeta(CONFIG_GITHUB_META, { ...prevMeta, username: data.login ?? null });
      return { ok: true, status: "conectado", login: data.login ?? null };
    } catch (err) {
      return {
        ok: false,
        status: "atencao",
        erro: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public verifyGitHubSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const secret = this.vault.getSecret(VAULT_KEY_GITHUB_WEBHOOK_SECRET);
    if (!secret || !signatureHeader) return false;
    const provided = signatureHeader.trim();
    if (!provided.startsWith("sha256=")) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
    return safeEqualStrings(expected, provided);
  }

  public async handleGitHubWebhook(params: {
    rawBody: string;
    signatureHeader?: string;
    eventHeader?: string;
  }): Promise<{
    ok: boolean;
    statusCode: number;
    body: Record<string, unknown>;
    event?: OptionalConnectorWebhookEvent;
  }> {
    if (!this.verifyGitHubSignature(params.rawBody, params.signatureHeader)) {
      return { ok: false, statusCode: 401, body: { erro: "Assinatura SHA-256 do GitHub inválida." } };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(params.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, statusCode: 400, body: { erro: "JSON de webhook GitHub inválido." } };
    }

    const evento = (params.eventHeader ?? "unknown").trim() || "unknown";
    const repoObj = (payload.repository ?? {}) as Record<string, unknown>;
    const senderObj = (payload.sender ?? {}) as Record<string, unknown>;
    const issueObj = (payload.issue ?? payload.pull_request ?? payload.release ?? {}) as Record<
      string,
      unknown
    >;

    const texto =
      typeof issueObj.title === "string"
        ? issueObj.title
        : typeof (payload.head_commit as Record<string, unknown> | undefined)?.message === "string"
          ? String((payload.head_commit as Record<string, unknown>).message)
          : null;

    const event: OptionalConnectorWebhookEvent = {
      conector_id: "github",
      evento,
      canal_ou_repo: typeof repoObj.full_name === "string" ? repoObj.full_name : null,
      autor: typeof senderObj.login === "string" ? senderObj.login : null,
      texto,
      dados: payload,
      recebido_em: new Date().toISOString(),
    };

    if (["push", "pull_request", "issues", "release"].includes(evento) && this.onTriggerWorkflow) {
      await this.onTriggerWorkflow(event);
    }

    return { ok: true, statusCode: 200, body: { ok: true, evento }, event };
  }

  public async executeGitHubAction(params: {
    action: "create_issue" | "comment_issue";
    repo?: string;
    title?: string;
    body: string;
    issueNumber?: number;
    fetchImpl?: typeof fetch;
  }): Promise<{ ok: boolean; url?: string; erro?: string }> {
    const token = this.vault.getSecret(VAULT_KEY_GITHUB_TOKEN);
    const meta = this.readMeta(CONFIG_GITHUB_META);
    const repo =
      params.repo?.trim() || (typeof meta.defaultRepo === "string" ? meta.defaultRepo : "");
    if (!token || !repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      return { ok: false, erro: "Token GitHub ou repositório owner/repo não configurados." };
    }

    const fetchFn = params.fetchImpl ?? fetch;
    const endpoint =
      params.action === "comment_issue" && params.issueNumber
        ? `https://api.github.com/repos/${repo}/issues/${params.issueNumber}/comments`
        : `https://api.github.com/repos/${repo}/issues`;
    const payload =
      params.action === "comment_issue"
        ? { body: params.body }
        : { title: params.title?.trim() || "Ação do Criativo AI Studio", body: params.body };

    const resp = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Criativo-AI-Studio",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await resp.json()) as { html_url?: string; message?: string };
    return resp.ok
      ? { ok: true, url: data.html_url }
      : { ok: false, erro: data.message ?? `GitHub HTTP ${resp.status}` };
  }
}
