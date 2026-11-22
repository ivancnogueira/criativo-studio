import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { VoiceHostService } from "../src/voice/voice-host-service.ts";
import { TranscriptionService } from "../src/voice/transcription-service.ts";

test("VoiceHostService isola worker IPC, gerencia modelos locais e realiza fallback seguro em modo auto", async () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-voice-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  const modelsDir = join(dir, "voice-models");
  const vault = new VaultService(db, "chave-voice-test");
  const voiceHost = new VoiceHostService({ db, modelsDir });

  try {
    // 1. Worker IPC responde ping em processo filho separado
    const ping = await voiceHost.pingWorker(5000);
    assert.equal(ping.ok, true);
    assert.ok(typeof ping.pid === "number" && ping.pid !== process.pid);

    // 2. Sem modelo local instalado, modo 'local' estrito falha; modo 'auto' faz fallback para nuvem
    voiceHost.updateSettings({ mode: "local" });
    await assert.rejects(() => voiceHost.transcribeLocal(Buffer.from("wav"), "audio/wav"));

    voiceHost.updateSettings({ mode: "auto" });
    vault.setSecret("OPENAI_API_KEY", "sk-voice-mock-key");
    const transcription = new TranscriptionService({
      vault,
      voiceHost,
      fetchImpl: async () =>
        new Response(JSON.stringify({ text: "Fallback OpenAI Whisper" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const cloudFallback = await transcription.transcribeAudio(Buffer.from("audio"), "audio/ogg");
    assert.equal(cloudFallback, "Fallback OpenAI Whisper");

    // 3. Instala modelo local -> transcrição roda direto no Voice Worker isolado
    voiceHost.installLocalModel("whisper-small-local");
    voiceHost.updateSettings({ mode: "local" });
    const localOut = await transcription.transcribeAudio(Buffer.from("123456"), "audio/wav");
    assert.ok(localOut.includes("voz-local:whisper-small-local"));

    voiceHost.removeLocalModel("whisper-small-local");
  } finally {
    voiceHost.dispose();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
