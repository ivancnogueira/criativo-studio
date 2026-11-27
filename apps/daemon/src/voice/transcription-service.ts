import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { splitAudioBufferForTranscription } from "./audio-chunker.ts";
import type { VoiceHostService } from "./voice-host-service.ts";
import {
  analyzeAudioVoiceActivity,
  sanitizeTranscriptHallucinations,
  VAD_MIN_SPEECH_MS,
  type VadAnalysisResult,
} from "./voice-vad.ts";

export interface DetailedTranscriptionOptions {
  vadEnabled?: boolean;
  clientSpeechMs?: number;
  maxDurationSec?: number;
}

export interface DetailedTranscriptionResult {
  texto: string;
  silent: boolean;
  chunks: number;
  vad: VadAnalysisResult;
}

export interface TranscriptionOptions {
  vault: VaultService;
  fetchImpl?: FetchLike;
  voiceHost?: VoiceHostService;
}

/**
 * Serviço de transcrição de comandos de voz (OGG/Opus, MP3, WAV) usando Host Local Isolado ou OpenAI Whisper / Gemini Multimodal.
 */
export class TranscriptionService {
  private readonly vault: VaultService;
  private readonly fetchFn: FetchLike;
  private voiceHost?: VoiceHostService;

  constructor(options: TranscriptionOptions) {
    this.vault = options.vault;
    this.fetchFn = options.fetchImpl ?? fetch;
    this.voiceHost = options.voiceHost;
  }

  public attachVoiceHost(host: VoiceHostService): void {
    this.voiceHost = host;
  }

  private getSecretAnyCase(candidates: string[]): string | null {
    for (const candidate of candidates) {
      const found = this.vault.getSecret(candidate);
      if (typeof found === "string" && found.trim().length > 0) {
        return found.trim();
      }
    }
    return null;
  }

  private hasConfiguredTranscriptionProvider(): boolean {
    if (this.voiceHost) {
      const cfg = this.voiceHost.getSettings();
      if (cfg.mode === "local") {
        return true;
      }
      if (cfg.mode === "auto") {
        const hasLocalStt = this.voiceHost
          .listModels()
          .some((m) => m.kind === "stt" && m.installed);
        if (hasLocalStt) {
          return true;
        }
      }
    }

    const openaiKey = this.getSecretAnyCase(["OPENAI_API_KEY", "openai_api_key"]);
    const geminiKey = this.getSecretAnyCase([
      "GEMINI_API_KEY",
      "gemini_api_key",
      "GOOGLE_API_KEY",
      "google_api_key",
    ]);
    return Boolean(geminiKey || openaiKey);
  }

  /**
   * Transcrição com VAD pré-STT (silêncio não gasta cota) e fatiamento automático de ditados longos.
   */
  public async transcribeAudioDetailed(
    audioBuffer: Buffer,
    mimeType = "audio/ogg",
    options: DetailedTranscriptionOptions = {}
  ): Promise<DetailedTranscriptionResult> {
    if (!this.hasConfiguredTranscriptionProvider()) {
      throw new Error(
        "MISSING_TRANSCRIPTION_KEY: Nenhuma chave de transcrição (GEMINI_API_KEY ou OPENAI_API_KEY) configurada no Cofre."
      );
    }

    const vad = analyzeAudioVoiceActivity(audioBuffer, mimeType);
    const clientHeardSpeech =
      typeof options.clientSpeechMs === "number" && options.clientSpeechMs >= VAD_MIN_SPEECH_MS;
    if (options.vadEnabled !== false && !vad.hasSpeech && !clientHeardSpeech) {
      return { texto: "", silent: true, chunks: 0, vad };
    }

    const chunks = splitAudioBufferForTranscription(audioBuffer, mimeType);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const raw = await this.transcribeAudio(chunk, mimeType);
      const clean = sanitizeTranscriptHallucinations(raw, vad);
      if (clean) parts.push(clean);
    }
    const texto = parts.join(" ").trim();
    return { texto, silent: texto.length === 0, chunks: chunks.length, vad };
  }

  public async transcribeAudio(
    audioBuffer: Buffer,
    mimeType = "audio/ogg"
  ): Promise<string> {
    if (this.voiceHost) {
      const cfg = this.voiceHost.getSettings();
      if (cfg.mode === "local" || cfg.mode === "auto") {
        try {
          return await this.voiceHost.transcribeLocal(audioBuffer, mimeType);
        } catch (err) {
          if (cfg.mode === "local") {
            throw err;
          }
          // Modo 'auto' faz fallback transparente para nuvem caso modelo local não esteja pronto
        }
      }
    }

    const openaiKey = this.getSecretAnyCase(["OPENAI_API_KEY", "openai_api_key"]);
    const geminiKey = this.getSecretAnyCase([
      "GEMINI_API_KEY",
      "gemini_api_key",
      "GOOGLE_API_KEY",
      "google_api_key",
    ]);

    if (geminiKey) {
      return await this.transcribeWithGemini(audioBuffer, mimeType, geminiKey);
    }

    if (openaiKey) {
      return await this.transcribeWithWhisper(audioBuffer, mimeType, openaiKey);
    }

    throw new Error(
      "MISSING_TRANSCRIPTION_KEY: Nenhuma chave de transcrição (GEMINI_API_KEY ou OPENAI_API_KEY) configurada no Cofre."
    );
  }

  private async transcribeWithGemini(
    audioBuffer: Buffer,
    mimeType: string,
    apiKey: string
  ): Promise<string> {
    const cleanMime = mimeType.split(";")[0].trim() || "audio/ogg";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: audioBuffer.toString("base64"),
                  },
                },
                {
                  text: "Transcreva exatamente em português brasileiro o comando falado neste áudio. Retorne apenas a transcrição limpa sem comentários adicionais.",
                },
              ],
            },
          ],
        }),
      });

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? `Erro Gemini Audio API: HTTP ${response.status}`
        );
      }

      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      return text;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [apiKey]));
    }
  }

  private async transcribeWithWhisper(
    audioBuffer: Buffer,
    mimeType: string,
    apiKey: string
  ): Promise<string> {
    try {
      const formData = new FormData();
      const cleanMime = (mimeType.split(";")[0]?.trim() || "audio/ogg").toLowerCase();
      const ext = cleanMime.includes("webm")
        ? "webm"
        : cleanMime.includes("mp4") || cleanMime.includes("m4a")
          ? "m4a"
          : cleanMime.includes("wav")
            ? "wav"
            : cleanMime.includes("mp3") || cleanMime.includes("mpeg")
              ? "mp3"
              : "ogg";
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanMime });
      formData.append("file", blob, `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "pt");

      const response = await this.fetchFn(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        }
      );

      const payload = (await response.json()) as {
        text?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? `Erro OpenAI Whisper API: HTTP ${response.status}`
        );
      }
      return payload.text?.trim() ?? "";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeProviderError(msg, [apiKey]));
    }
  }
}
