import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import type { VaultService } from "../vault/vault-service.ts";

export interface TranscriptionOptions {
  vault: VaultService;
  fetchImpl?: FetchLike;
}

/**
 * Serviço de transcrição de comandos de voz (OGG/Opus, MP3, WAV) usando OpenAI Whisper ou Gemini Multimodal.
 */
export class TranscriptionService {
  private readonly vault: VaultService;
  private readonly fetchFn: FetchLike;

  constructor(options: TranscriptionOptions) {
    this.vault = options.vault;
    this.fetchFn = options.fetchImpl ?? fetch;
  }

  public async transcribeAudio(
    audioBuffer: Buffer,
    mimeType = "audio/ogg"
  ): Promise<string> {
    const openaiKey = this.vault.getSecret("OPENAI_API_KEY");
    const geminiKey =
      this.vault.getSecret("GEMINI_API_KEY") ?? this.vault.getSecret("GOOGLE_API_KEY");

    if (geminiKey) {
      return await this.transcribeWithGemini(audioBuffer, mimeType, geminiKey);
    }

    if (openaiKey) {
      return await this.transcribeWithWhisper(audioBuffer, mimeType, openaiKey);
    }

    throw new Error(
      "Nenhuma chave de transcrição (GEMINI_API_KEY ou OPENAI_API_KEY) encontrada no Cofre."
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
      const cleanMime = mimeType.split(";")[0].trim() || "audio/ogg";
      const ext = cleanMime.includes("mp3") || cleanMime.includes("mpeg") ? "mp3" : "ogg";
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
