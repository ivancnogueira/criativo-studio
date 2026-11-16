import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  WhatsAppApprovalNotifier,
  WhatsAppMessageHandler,
  WhatsAppStudioClient,
  useSqliteAuthState,
  type BaileysSocketLike,
  type OutgoingWhatsAppPayload,
} from "@criativo/whatsapp";
import { CriativoDatabase, initializeDatabase } from "../src/database/client.ts";
import { seedDefaultAgents } from "../src/engine/runner/roster-defaults.ts";
import { TelegramNotificationBot } from "../src/messaging/telegram-bot.ts";
import { FifoQueueManager } from "../src/queue/fifo-queue.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { TranscriptionService } from "../src/voice/transcription-service.ts";
import { TtsService } from "../src/voice/tts-service.ts";

class MockBaileysSocket extends EventEmitter implements BaileysSocketLike {
  public user = { id: "5500999990000:1@s.whatsapp.net", name: "Estúdio Teste" };
  public sentMessages: Array<{ jid: string; content: OutgoingWhatsAppPayload }> = [];
  public ended = false;

  public ev = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.on(event, listener);
    },
  };

  public async sendMessage(jid: string, content: OutgoingWhatsAppPayload): Promise<unknown> {
    this.sentMessages.push({ jid, content });
    return { key: { id: `sent-${this.sentMessages.length}` } };
  }

  public end(): void {
    this.ended = true;
  }
}

describe("Fase 4 — Hub de Mensageria Nativo (WhatsApp Baileys, Voz & Telegram)", () => {
  let tempDir: string;
  let db: CriativoDatabase;
  let vault: VaultService;
  let queue: FifoQueueManager;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase4-"));
    db = initializeDatabase({ dbPath: join(tempDir, "phase4.db") });
    seedDefaultAgents(db);
    vault = new VaultService(db, "chave-fase-4-teste");
    queue = new FifoQueueManager(db);

    vault.setSecret("GEMINI_API_KEY", "gem-key-phase4-00000");
    vault.setSecret("ELEVENLABS_API_KEY", "eleven-key-phase4-00000");
    vault.setSecret("TELEGRAM_BOT_TOKEN", "123456:BOT_TOKEN_SIMULADO");
    vault.setSecret("TELEGRAM_CHAT_ID", "99887766");
  });

  after(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persiste e restaura credenciais criptográficas Baileys no SQLite (useSqliteAuthState)", async () => {
    const first = await useSqliteAuthState(db.connection);
    first.state.creds.me = { id: "5500999990000@s.whatsapp.net" };
    await first.state.keys.set({
      "pre-key": {
        "1": { public: Buffer.from("chave-publica-teste") },
      },
    });
    await first.saveCreds();

    // Simula reinicialização do daemon lendo do mesmo SQLite
    const reloaded = await useSqliteAuthState(db.connection);
    assert.deepEqual(reloaded.state.creds.me, { id: "5500999990000@s.whatsapp.net" });
    const loadedKeys = await reloaded.state.keys.get("pre-key", ["1"]);
    assert.ok(Buffer.isBuffer((loadedKeys["1"] as { public: Buffer }).public));
    assert.equal(
      (loadedKeys["1"] as { public: Buffer }).public.toString("utf8"),
      "chave-publica-teste"
    );
  });

  it("gerencia ciclo de QR Code Base64, status conectado e desconexão no WhatsAppStudioClient", async () => {
    const socket = new MockBaileysSocket();
    const statuses: string[] = [];

    const client = new WhatsAppStudioClient({
      db: db.connection,
      socketFactory: async () => socket,
      onStatusChange: (s) => statuses.push(s.status),
    });

    await client.connect();
    socket.emit("connection.update", { qr: "criativo-qr-payload-teste-123" });
    for (let i = 0; i < 40 && client.getStatus().status !== "aguardando_qrcode"; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }

    const waitingStatus = client.getStatus();
    assert.equal(waitingStatus.status, "aguardando_qrcode");
    assert.ok(waitingStatus.qrcode_base64?.startsWith("data:image/png;base64,"));

    socket.emit("connection.update", { connection: "open" });
    for (let i = 0; i < 40 && client.getStatus().status !== "conectado"; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(client.getStatus().status, "conectado");

    await client.disconnect();
    assert.equal(client.getStatus().status, "desconectado");
    assert.ok(statuses.includes("aguardando_qrcode"));
    assert.ok(statuses.includes("conectado"));
  });

  it("transcreve áudio OGG/Opus e sintetiza narração MP3 no motor de voz", async () => {
    const transcription = new TranscriptionService({
      vault,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Crie um carrossel sobre hábitos saudáveis pela manhã" }],
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });

    const text = await transcription.transcribeAudio(Buffer.from("OGG_MOCK"), "audio/ogg");
    assert.equal(text, "Crie um carrossel sobre hábitos saudáveis pela manhã");

    const mp3Out = join(tempDir, "narracao.mp3");
    const tts = new TtsService({
      vault,
      fetchImpl: async () =>
        new Response(Buffer.from("MP3_AUDIO_SIMULADO"), { status: 200 }),
    });
    const ttsRes = await tts.generateNarration({ text, outputPath: mp3Out });
    assert.equal(ttsRes.providerUsed, "elevenlabs");
    assert.equal(readFileSync(mp3Out).toString("utf8"), "MP3_AUDIO_SIMULADO");
  });

  it("converte áudios/mensagens no WhatsApp em tarefas da fila e processa aprovação '1' disparando publicação", async () => {
    const socket = new MockBaileysSocket();
    const client = new WhatsAppStudioClient({
      db: db.connection,
      socketFactory: async () => socket,
    });
    await client.connect();
    socket.emit("connection.update", { connection: "open" });
    await new Promise((r) => setTimeout(r, 10));

    let publishedTaskId: string | null = null;
    const notifier = new WhatsAppApprovalNotifier({
      client,
      updateTaskStatus: (id, status, result, err) =>
        queue.updateTaskStatus(id, status, result, err),
      onApproveAndPublish: async (tarefaId) => {
        publishedTaskId = tarefaId;
        return { permalink: "https://www.instagram.com/p/teste_ok/" };
      },
    });

    const handler = new WhatsAppMessageHandler({
      client,
      enqueueTask: (input) => queue.enqueueTask(input),
      transcribeAudio: async () => "Gerar um carrossel educativo de 5 lâminas sobre café especial",
      onApprovalReply: (jid, txt) => notifier.handleReply(jid, txt),
    });

    const jidUsuario = "5500988887777@s.whatsapp.net";
    const tarefaCriada = await handler.handleIncomingMessage({
      messageId: "msg-audio-1",
      remoteJid: jidUsuario,
      fromMe: false,
      pushName: "Usuário Teste",
      audioBuffer: Buffer.from("AUDIO_OGG_OPUS"),
      audioMimeType: "audio/ogg; codecs=opus",
    });

    assert.ok(tarefaCriada);
    assert.equal(tarefaCriada!.canal_origem, "whatsapp");
    assert.equal(tarefaCriada!.tipo, "carrossel");
    assert.match(socket.sentMessages[0].content.text ?? "", /Recebi seu pedido!/);

    // Simula prévia gerada aguardando aprovação via WhatsApp
    const imgPath = join(tempDir, "slide-1.png");
    writeFileSync(imgPath, Buffer.from("SLIDE_PNG_MOCK"));
    await notifier.notifyReadyForApproval({
      tarefa_id: tarefaCriada!.tarefa_id,
      tipo: "carrossel",
      previews: [imgPath],
      copy: "Legenda gerada pelo Copywriter #dicas",
      targetJid: jidUsuario,
    });

    assert.equal(notifier.getPendingTaskForJid(jidUsuario), tarefaCriada!.tarefa_id);

    // Usuário responde "1" no WhatsApp para aprovar e publicar
    await handler.handleIncomingMessage({
      messageId: "msg-aprovacao-1",
      remoteJid: jidUsuario,
      fromMe: false,
      text: "1",
    });

    assert.equal(publishedTaskId, tarefaCriada!.tarefa_id);
    const tarefaDepois = queue.getTask(tarefaCriada!.tarefa_id);
    assert.equal(tarefaDepois?.status, "concluido");
    assert.match(
      socket.sentMessages.at(-1)?.content.text ?? "",
      /Aprovado! O agente publicador Meta API disparou/
    );

    await client.disconnect();
  });

  it("envia notificações com botões inline no Telegram e processa callback de aprovação", async () => {
    let approvedFromTelegram: string | null = null;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const bot = new TelegramNotificationBot({
      vault,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
          status: 200,
        });
      },
      onApproveTask: async (tarefaId) => {
        approvedFromTelegram = tarefaId;
      },
    });

    const sent = await bot.sendApprovalNotification({
      tarefaId: "tarefa-tg-123",
      titulo: "Reels lançamento semanal",
      copy: "Gancho + CTA",
    });
    assert.equal(sent.message_id, 77);
    assert.ok((requests[0].body.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard);

    const cb = await bot.handleCallbackQuery({
      id: "cbq-1",
      data: "aprovar:tarefa-tg-123",
    });
    assert.equal(cb?.action, "aprovar");
    assert.equal(approvedFromTelegram, "tarefa-tg-123");
  });
});
