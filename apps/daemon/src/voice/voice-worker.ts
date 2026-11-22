import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface WorkerRequest {
  id: string;
  action: "ping" | "list_models" | "stt" | "tts";
  modelsDir?: string;
  modelId?: string;
  mimeType?: string;
  audioBase64?: string;
  text?: string;
}

function sendResponse(payload: Record<string, unknown>): void {
  if (typeof process.send === "function") {
    process.send(payload);
  }
}

process.on("message", (msg: WorkerRequest) => {
  if (!msg || typeof msg !== "object" || !msg.id) return;

  try {
    if (msg.action === "ping") {
      sendResponse({ id: msg.id, ok: true, pid: process.pid });
      return;
    }

    if (msg.action === "list_models") {
      const dir = msg.modelsDir ?? join(process.cwd(), "dados", "voice-models");
      const files = existsSync(dir) ? readdirSync(dir) : [];
      sendResponse({ id: msg.id, ok: true, files });
      return;
    }

    if (msg.action === "stt") {
      const dir = msg.modelsDir ?? join(process.cwd(), "dados", "voice-models");
      const modelId = msg.modelId ?? "whisper-small-local";
      const modelMarker = join(dir, `${modelId}.json`);
      if (!existsSync(modelMarker)) {
        sendResponse({
          id: msg.id,
          ok: false,
          code: "LOCAL_MODEL_NOT_INSTALLED",
          error: `Modelo STT local '${modelId}' não instalado em ${dir}.`,
        });
        return;
      }
      const audioBytes = msg.audioBase64 ? Buffer.from(msg.audioBase64, "base64").length : 0;
      sendResponse({
        id: msg.id,
        ok: true,
        transcript: `[voz-local:${modelId}] Áudio processado (${audioBytes} bytes).`,
      });
      return;
    }

    if (msg.action === "tts") {
      const dir = msg.modelsDir ?? join(process.cwd(), "dados", "voice-models");
      const modelId = msg.modelId ?? "piper-ptbr-faber";
      const modelMarker = join(dir, `${modelId}.json`);
      if (!existsSync(modelMarker)) {
        sendResponse({
          id: msg.id,
          ok: false,
          code: "LOCAL_MODEL_NOT_INSTALLED",
          error: `Modelo TTS local '${modelId}' não instalado em ${dir}.`,
        });
        return;
      }
      sendResponse({
        id: msg.id,
        ok: true,
        audioBase64: Buffer.from(`LOCAL_TTS_AUDIO:${modelId}:${msg.text ?? ""}`, "utf8").toString("base64"),
      });
      return;
    }

    sendResponse({ id: msg.id, ok: false, error: `Ação desconhecida: ${String(msg.action)}` });
  } catch (err) {
    sendResponse({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
