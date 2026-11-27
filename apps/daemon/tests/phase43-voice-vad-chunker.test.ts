import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VaultService } from "../src/vault/vault-service.ts";
import { splitWavPcmIntoChunks, MAX_DICTATION_DURATION_SEC } from "../src/voice/audio-chunker.ts";
import { TranscriptionService } from "../src/voice/transcription-service.ts";
import {
  analyzeAudioVoiceActivity,
  sanitizeTranscriptHallucinations,
  type VadAnalysisResult,
} from "../src/voice/voice-vad.ts";

const RATE = 8000;

function makeWav(seconds: number, kind: "silence" | "speech"): Buffer {
  const samples = Math.floor(seconds * RATE);
  const pcm = Buffer.alloc(samples * 2);
  if (kind === "speech") {
    for (let i = 0; i < samples; i += 1) {
      const burst = Math.floor(i / (RATE / 2)) % 2 === 0;
      const v = burst ? Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.35 * 32767) : 0;
      pcm.writeInt16LE(v, i * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function makeService(fetchImpl: typeof fetch): TranscriptionService {
  const vault = { getSecret: (k: string) => (k === "gemini_api_key" ? "fake-key-4303" : null) };
  return new TranscriptionService({ vault: vault as unknown as VaultService, fetchImpl });
}

describe("Fase 43-03 — VAD pré-transcrição, anti-alucinação e fatiamento longo", () => {
  it("silêncio não chama o provedor de STT (zero cota, zero frase fantasma)", async () => {
    let calls = 0;
    const svc = makeService((async () => {
      calls += 1;
      return new Response("{}");
    }) as typeof fetch);
    const res = await svc.transcribeAudioDetailed(makeWav(3, "silence"), "audio/wav");
    assert.equal(res.silent, true);
    assert.equal(res.texto, "");
    assert.equal(res.chunks, 0);
    assert.equal(calls, 0);
    assert.equal(analyzeAudioVoiceActivity(makeWav(2, "speech"), "audio/wav").hasSpeech, true);
  });

  it("sanitizeTranscriptHallucinations remove frase fantasma só em baixa energia", () => {
    const low: VadAnalysisResult = {
      hasSpeech: true, speechMs: 300, durationMs: 2000, peakDbfs: -40, rmsDbfs: -50,
      activeFrameRatio: 0.1, reason: "x",
    };
    const speech: VadAnalysisResult = { ...low, speechMs: 1500, peakDbfs: -8 };
    assert.equal(sanitizeTranscriptHallucinations("Obrigado.", low), "");
    assert.equal(
      sanitizeTranscriptHallucinations("Crie 5 ganchos para Reels.", speech),
      "Crie 5 ganchos para Reels."
    );
  });

  it("fatia WAV de 200s em 3 blocos <= 90s e transcreve em ordem", async () => {
    const wav = makeWav(200, "speech");
    const { chunks } = splitWavPcmIntoChunks(wav);
    assert.equal(chunks.length, 3);
    for (const c of chunks) assert.ok(c.length - 44 <= 90 * RATE * 2 + 2);

    let n = 0;
    const svc = makeService((async () => {
      n += 1;
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: `bloco${n}` }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch);
    const res = await svc.transcribeAudioDetailed(wav, "audio/wav");
    assert.equal(res.chunks, 3);
    assert.equal(res.texto, "bloco1 bloco2 bloco3");
  });

  it("rejeita áudio acima de 10 minutos com CRV-VOICE-DURATION", () => {
    assert.equal(MAX_DICTATION_DURATION_SEC, 600);
    assert.throws(() => splitWavPcmIntoChunks(makeWav(620, "silence")), /CRV-VOICE-DURATION/);
  });
});
