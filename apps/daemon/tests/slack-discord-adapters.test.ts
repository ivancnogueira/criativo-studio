import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { ConnectorsWebhookService } from "../src/server/connectors-webhook-service.ts";
import { MessagingService } from "../src/messaging/messaging-service.ts";
import { SlackMessagingAdapter } from "../src/messaging/slack-adapter.ts";
import { DiscordMessagingAdapter } from "../src/messaging/discord-adapter.ts";

function withTempDb(fn: (db: CriativoDatabase, vault: VaultService) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "criativo-sd-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();
  const vault = new VaultService(db, "segredo-mestre-slack-discord");
  return Promise.resolve(fn(db, vault)).finally(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

test("SlackMessagingAdapter valida assinatura HMAC, aplica política de canal, roteia menção e responde em thread", async () => {
  await withTempDb(async (db, vault) => {
    const sentPosts: Array<Record<string, unknown>> = [];
    const webhookService = new ConnectorsWebhookService({ db, vault });
    webhookService.configureSlack({
      botToken: "xoxb-simulado-000",
      signingSecret: "segredo-hmac-slack",
      defaultChannel: "C_CRIATIVO",
    });

    const messaging = new MessagingService({
      db,
      agentExecutor: async ({ agentId, prompt }) =>
        `Resposta (${agentId}): ${prompt} — ${"X".repeat(4100)}`,
    });
    messaging.savePolicy({
      channelKind: "slack",
      enabled: true,
      orchestratorAgentId: "orquestrador_estrategista",
      replyInThreads: true,
      allowlist: [{ senderId: "U_OPERADOR", role: "admin" }],
      allowedChannelIds: ["C_CRIATIVO"],
    });

    const slackAdapter = new SlackMessagingAdapter({
      connectorsWebhook: webhookService,
      messagingService: messaging,
      fetchImpl: async (_input, init) => {
        if (init?.body) {
          sentPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        }
        return new Response(JSON.stringify({ ok: true, ts: "1700000001.000100" }), { status: 200 });
      },
    });
    webhookService.attachMessagingHandlers({
      onSlackEvent: (p) => slackAdapter.handleVerifiedEventPayload(p),
    });

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "app_mention",
        user: "U_OPERADOR",
        channel: "C_CRIATIVO",
        ts: "1700000000.000200",
        text: "@estrategista Gerar plano editorial de 5 dias",
      },
    });
    const tsHeader = String(Math.floor(Date.now() / 1000));
    const sig = `v0=${createHmac("sha256", "segredo-hmac-slack")
      .update(`v0:${tsHeader}:${body}`, "utf8")
      .digest("hex")}`;

    const webhookRes = await webhookService.handleSlackWebhook({
      rawBody: body,
      timestampHeader: tsHeader,
      signatureHeader: sig,
    });

    assert.equal(webhookRes.statusCode, 200);
    assert.ok(sentPosts.length >= 2, "resposta >4000 chars deve fatiar em >=2 mensagens Slack");
    assert.equal(sentPosts[0]!.channel, "C_CRIATIVO");
    assert.equal(sentPosts[0]!.thread_ts, "1700000000.000200");
  });
});

test("DiscordMessagingAdapter valida assinatura Ed25519, fatia resposta em <=2000 chars e respeita allowlist", async () => {
  await withTempDb(async (db, vault) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const rawPubHex = spkiDer.subarray(spkiDer.length - 32).toString("hex");

    const discordPosts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const webhookService = new ConnectorsWebhookService({ db, vault });
    webhookService.configureDiscord({
      botToken: "discord-token-simulado",
      publicKey: rawPubHex,
    });

    const messaging = new MessagingService({
      db,
      agentExecutor: async () => "B".repeat(2300),
    });
    messaging.savePolicy({
      channelKind: "discord",
      enabled: true,
      orchestratorAgentId: "orquestrador_estrategista",
      replyInThreads: true,
      allowlist: [{ senderId: "USR_99", role: "operator" }],
      allowedChannelIds: ["CHAN_77"],
    });

    const discordAdapter = new DiscordMessagingAdapter({
      connectorsWebhook: webhookService,
      messagingService: messaging,
      fetchImpl: async (input, init) => {
        discordPosts.push({
          url: String(input),
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
        });
        return new Response(JSON.stringify({ id: "msg-out-1" }), { status: 200 });
      },
    });
    webhookService.attachMessagingHandlers({
      onDiscordEvent: (p) => discordAdapter.handleVerifiedInteractionOrMessage(p),
    });

    const interactionPayload = JSON.stringify({
      id: "int-1",
      type: 2,
      channel_id: "CHAN_77",
      member: { user: { id: "USR_99", username: "criativo_op" } },
      data: { name: "perguntar", options: [{ name: "prompt", value: "Resumo da campanha" }] },
    });
    const timestamp = "1700000100";
    const sigHex = sign(null, Buffer.from(`${timestamp}${interactionPayload}`, "utf8"), privateKey).toString("hex");

    const res = await webhookService.handleDiscordWebhook({
      rawBody: interactionPayload,
      signatureHeader: sigHex,
      timestampHeader: timestamp,
    });

    assert.equal(res.statusCode, 200);
    assert.ok(discordPosts.length >= 2, "resposta >2000 chars deve fatiar em >=2 mensagens Discord");
    for (const p of discordPosts) {
      assert.ok(String(p.body.content).length <= 2000);
    }
  });
});
