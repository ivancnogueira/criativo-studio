import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessagingChannelPolicy } from "@criativo/contracts";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { chunkMessageText } from "../src/messaging/message-chunker.ts";
import { evaluateMessagingAccess } from "../src/messaging/channel-allowlist.ts";
import { resolveMessagingMentionTarget } from "../src/messaging/mention-router.ts";
import { MessagingService } from "../src/messaging/messaging-service.ts";
import { TelegramNotificationBot } from "../src/messaging/telegram-bot.ts";

function withTempDb(fn: (db: CriativoDatabase) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "criativo-msg-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();
  return Promise.resolve(fn(db)).finally(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

test("chunkMessageText respeita limites Discord/Telegram e fecha/reabre cercas Markdown", () => {
  const lines = ["```typescript"];
  for (let i = 0; i < 90; i += 1) {
    lines.push(`const linha_${i} = "conteudo longo para testar fatiamento seguro de codigo";`);
  }
  lines.push("```");
  const full = lines.join("\n");

  const discordChunks = chunkMessageText(full, "discord");
  assert.ok(discordChunks.length >= 2, "esperava ao menos 2 blocos para limite Discord 2000");
  for (const chunk of discordChunks) {
    assert.ok(chunk.length <= 2000, `chunk excedeu 2000 chars: ${chunk.length}`);
    const openCount = (chunk.match(/```/g) ?? []).length;
    assert.equal(openCount % 2, 0, "bloco Markdown deveria abrir e fechar dentro do mesmo chunk");
  }
  assert.ok(discordChunks[1]!.startsWith("```typescript\n"));
});

test("evaluateMessagingAccess aplica allowlist, canal permitido e papel viewer", () => {
  const policy: MessagingChannelPolicy = {
    channelKind: "slack",
    enabled: true,
    orchestratorAgentId: "orquestrador_estrategista",
    replyInThreads: true,
    allowlist: [
      { senderId: "U_ADMIN", role: "admin" },
      { senderId: "U_VIEWER", role: "viewer" },
    ],
    allowedChannelIds: ["C_ALLOWED"],
  };

  assert.equal(
    evaluateMessagingAccess({ policy, senderId: "U_ADMIN", channelId: "C_ALLOWED" }).allowed,
    true,
  );
  assert.equal(
    evaluateMessagingAccess({ policy, senderId: "U_ADMIN", channelId: "C_OTHER" }).allowed,
    false,
  );
  const viewerRes = evaluateMessagingAccess({ policy, senderId: "U_VIEWER", channelId: "C_ALLOWED" });
  assert.equal(viewerRes.allowed, false);
  assert.equal(viewerRes.role, "viewer");
  assert.equal(
    evaluateMessagingAccess({ policy, senderId: "U_UNKNOWN", channelId: "C_ALLOWED" }).allowed,
    false,
  );
});

test("resolveMessagingMentionTarget roteia @agente e faz fallback para orquestrador", () => {
  const explicit = resolveMessagingMentionTarget({
    text: "@estrategista Crie 3 pautas para o produto",
    defaultAgentId: "orquestrador_estrategista",
  });
  assert.equal(explicit.usedFallback, false);
  assert.ok(explicit.agentId.length > 0);
  assert.equal(explicit.cleanedText, "Crie 3 pautas para o produto");

  const fallback = resolveMessagingMentionTarget({
    text: "Preciso de um calendário semanal",
    defaultAgentId: "orquestrador_estrategista",
  });
  assert.equal(fallback.usedFallback, true);
  assert.equal(fallback.agentId, "orquestrador_estrategista");
});

test("MessagingService + TelegramNotificationBot preserva callback inline e responde mensagens em thread", async () => {
  await withTempDb(async (db) => {
    const vault = new VaultService(db, "segredo-mestre-teste");
    vault.setSecret("TELEGRAM_BOT_TOKEN", "bot-token-simulado");

    let approvedTask: string | null = null;
    const sentPayloads: Array<Record<string, unknown>> = [];

    const messaging = new MessagingService({
      db,
      agentExecutor: async ({ agentId, prompt }) =>
        `[${agentId}] Recebido: ${prompt}\n` + "A".repeat(4200),
    });

    messaging.savePolicy({
      channelKind: "telegram",
      enabled: true,
      orchestratorAgentId: "orquestrador_estrategista",
      replyInThreads: true,
      allowlist: [{ senderId: "998877", role: "operator" }],
      allowedChannelIds: ["-100555"],
    });

    const bot = new TelegramNotificationBot({
      vault,
      messagingService: messaging,
      onApproveTask: async (tarefaId) => {
        approvedTask = tarefaId;
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        sentPayloads.push({ url, body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: sentPayloads.length } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    // 1. Callback inline existente segue funcionando
    const cbRes = await bot.handleUpdate({
      update_id: 1,
      callback_query: { id: "cb-1", data: "aprovar:tarefa-42" },
    });
    assert.equal(cbRes.kind, "callback");
    assert.equal(approvedTask, "tarefa-42");

    // 2. Mensagem não autorizada é bloqueada
    const denied = await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 10,
        chat: { id: -100555 },
        from: { id: 111222, username: "intruso" },
        text: "Oi",
      },
    });
    assert.equal((denied.result as { allowed: boolean }).allowed, false);

    // 3. Mensagem autorizada dispara agente e envia chunks fatiados (Telegram > 4096 -> 2 partes) com thread
    const okMsg = await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 11,
        message_thread_id: 777,
        chat: { id: -100555 },
        from: { id: 998877, username: "operador" },
        text: "Gerar pauta completa",
      },
    });
    const handled = okMsg.result as { allowed: boolean; chunksSent: number };
    assert.equal(handled.allowed, true);
    assert.ok(handled.chunksSent >= 2);

    const messageSends = sentPayloads.filter((p) => String(p.url).includes("/sendMessage"));
    assert.equal(messageSends.length, handled.chunksSent);
    assert.equal(messageSends[0]!.body.reply_to_message_id, 11);
    assert.equal(messageSends[0]!.body.message_thread_id, 777);
  });
});
