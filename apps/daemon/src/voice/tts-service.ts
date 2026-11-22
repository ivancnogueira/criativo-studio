import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { VoiceHostService } from "./voice-host-service.ts";

export interface TtsGenerateInput {
  text: string;
  outputPath: string;
  voiceId?: string;
  provider?: "elevenlabs" | "openai" | "edge-tts";
}

export interface TtsGenerateResult {
  outputPath: string;
  providerUsed: "elevenlabs" | "openai" | "edge-tts" | "local-voice-host";
  bytesWritten: number;
}

/**
 * Serviço de geração de locução MP3 (Voice Engine) para vídeos Reels via Host Local Isolado, ElevenLabs, OpenAI TTS ou edge-tts.
 */
export class TtsService {
  private readonly vault: VaultService;
  private readonly fetchFn: FetchLike;
  private voiceHost?: VoiceHostService;

  constructor(options: { vault: VaultService; fetchImpl?: FetchLike; voiceHost?: VoiceHostService }) {
    this.vault = options.vault;
    this.fetchFn = options.fetchImpl ?? fetch;
    this.voiceHost = options.voiceHost;
  }

  public attachVoiceHost(host: VoiceHostService): void {
    this.voiceHost = host;
  }

  public async generateNarration(input: TtsGenerateInput): Promise<TtsGenerateResult> {
    mkdirSync(dirname(input.outputPath), { recursive: true });

    if (this.voiceHost) {
      const cfg = this.voiceHost.getSettings();
      if (cfg.mode === "local" || cfg.mode === "auto") {
        try {
          const audioBuf = await this.voiceHost.synthesizeLocal(input.text);
          writeFileSync(input.outputPath, audioBuf);
          return {
            outputPath: input.outputPath,
            providerUsed: "local-voice-host",
            bytesWritten: audioBuf.length,
          };
        } catch (err) {
          if (cfg.mode === "local") {
            throw err;
          }
        }
      }
    }

    const elevenKey = this.vault.getSecret("ELEVENLABS_API_KEY");
    const openaiKey = this.vault.getSecret("OPENAI_API_KEY");

    const selected =
      input.provider ??
      (elevenKey ? "elevenlabs" : openaiKey ? "openai" : "edge-tts");

    if (selected === "elevenlabs") {
      if (!elevenKey) {
        throw new Error("ELEVENLABS_API_KEY ausente no Cofre para síntese de voz.");
      }
      const voiceId = input.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
      try {
        const res = await this.fetchFn(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": elevenKey,
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text: input.text,
              model_id: "eleven_multilingual_v2",
            }),
          }
        );
        if (!res.ok) {
          throw new Error(`Erro ElevenLabs HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(input.outputPath, buf);
        return {
          outputPath: input.outputPath,
          providerUsed: "elevenlabs",
          bytesWritten: buf.length,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(sanitizeProviderError(msg, [elevenKey]));
      }
    }

    if (selected === "openai") {
      if (!openaiKey) {
        throw new Error("OPENAI_API_KEY ausente no Cofre para OpenAI TTS.");
      }
      try {
        const res = await this.fetchFn("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "tts-1",
            voice: input.voiceId ?? "alloy",
            input: input.text,
          }),
        });
        if (!res.ok) {
          throw new Error(`Erro OpenAI TTS HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(input.outputPath, buf);
        return {
          outputPath: input.outputPath,
          providerUsed: "openai",
          bytesWritten: buf.length,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(sanitizeProviderError(msg, [openaiKey]));
      }
    }

    // Fallback gratuito via edge-tts CLI quando instalado no host Linux/VPS
    const voiceName = input.voiceId ?? "pt-BR-AntonioNeural";
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const proc = spawn(
        "edge-tts",
        ["--voice", voiceName, "--text", input.text, "--write-media", input.outputPath],
        { shell: process.platform === "win32" }
      );
      proc.on("error", (err) => rejectPromise(err));
      proc.on("close", (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`edge-tts encerrou com código ${code}`));
      });
    });

    return {
      outputPath: input.outputPath,
      providerUsed: "edge-tts",
      bytesWritten: 0,
    };
  }
}
