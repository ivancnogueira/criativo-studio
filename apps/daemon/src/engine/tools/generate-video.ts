import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { VaultService } from "../../vault/vault-service.ts";
import type { FetchLike } from "../providers/provider-interface.ts";
import { loadReferenceImages, resolveVaultSecretCaseInsensitive } from "./generate-image.ts";

export const DEFAULT_GEMINI_VIDEO_MODEL = "gemini-omni-1.2-flash";
export const MAX_VIDEO_REFERENCE_IMAGES = 6;

export interface GenerateVideoParams {
  prompt: string;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  duration_seconds?: number;
  resolution?: "360p" | "720p" | "1080p" | "4k";
  image_paths?: string[];
  output_path: string;
  model?: string;
  poll_interval_ms?: number;
  timeout_ms?: number;
}

export interface GenerateVideoResult {
  output_path: string;
  model_used: string;
  aspect_ratio: string;
  duration_seconds: number;
  resolution: string;
  references_loaded: number;
  size_bytes: number;
  interaction_id: string | null;
}

export interface ExtractedVideoPayloadRef {
  interactionId: string | null;
  status: string | null;
  fileUri: string | null;
  inlineBase64: string | null;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function pickString(rec: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!rec) return null;
  for (const key of keys) {
    const val = rec[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Extrai de forma defensiva URI do Files API, base64 inline ou estado de polling
 * da resposta retornada pelo endpoint Gemini Interactions.
 */
export function extractVideoRefFromInteractionPayload(
  payload: unknown
): ExtractedVideoPayloadRef {
  const root = asRecord(payload);
  if (!root) {
    return { interactionId: null, status: null, fileUri: null, inlineBase64: null };
  }

  const interactionId = pickString(root, "id", "name", "interaction_id");
  const status = pickString(root, "status", "state");

  const outputVideo = asRecord(root.output_video);
  const outputObj = asRecord(root.output);
  const fileObj = asRecord(root.file);

  let inlineBase64 =
    pickString(outputVideo, "data") ??
    pickString(outputObj, "data");

  let fileUri =
    pickString(outputVideo, "uri", "file_uri", "url") ??
    pickString(outputObj, "file_uri", "uri", "url") ??
    pickString(fileObj, "uri", "url") ??
    pickString(root, "uri", "file_uri", "video_uri");

  const inspectList = (arrRaw: unknown) => {
    if (!Array.isArray(arrRaw)) return;
    for (const item of arrRaw) {
      const rec = asRecord(item);
      if (!rec) continue;
      if (!inlineBase64) {
        const mime = pickString(rec, "mime_type", "mimeType");
        if (mime && mime.startsWith("video/")) {
          inlineBase64 = pickString(rec, "data");
        }
      }
      if (!fileUri) {
        const nestedOutVid = asRecord(rec.output_video);
        const nestedVid = asRecord(rec.video);
        const nestedFile = asRecord(rec.file);
        fileUri =
          pickString(nestedOutVid, "uri", "file_uri", "url") ??
          pickString(nestedVid, "uri", "file_uri", "url") ??
          pickString(nestedFile, "uri", "url") ??
          pickString(rec, "file_uri", "uri", "url");
      }
    }
  };

  inspectList(root.outputs);
  inspectList(root.steps);

  return {
    interactionId,
    status,
    fileUri,
    inlineBase64,
  };
}

function clampDurationSeconds(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 8;
  return Math.max(3, Math.min(15, Math.round(raw)));
}

function extractGeminiFileId(fileUri: string): string | null {
  const match = fileUri.match(/(?:^|\/)files\/([^/?:#]+)/i);
  return match?.[1] ? match[1] : null;
}

function buildVideoPrompt(rawPrompt: string, referencesCount: number): string {
  const clauses = [rawPrompt.trim()];
  if (referencesCount > 0) {
    clauses.push(
      "CONSISTÊNCIA VISUAL: Preserve fielmente os traços, rosto, cores, produto e identidade dos elementos presentes nas imagens de referência enviadas."
    );
  }
  clauses.push(
    "REGRA ANTI-CÓPIA: Nunca inclua marcas d'água, assinaturas ou @handles de terceiros no vídeo gerado."
  );
  return clauses.join("\n\n");
}

/**
 * Gera vídeo com áudio nativo sincronizado via Gemini Omni 1.2 Flash (`gemini-omni-1.2-flash`),
 * aceitando até 6 imagens de referência, aguardando processamento no Files API e salvando `.mp4`.
 */
export async function generateVideoTool(
  params: GenerateVideoParams,
  deps: {
    vault: VaultService;
    fetchImpl?: FetchLike;
    sleepImpl?: (ms: number) => Promise<void>;
    onProgress?: (msg: string) => void;
  }
): Promise<GenerateVideoResult> {
  const apiKey = resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key");
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY ausente no Cofre para gerar vídeos com Gemini Omni 1.2 Flash."
    );
  }

  const fetchFn = deps.fetchImpl ?? fetch;
  const sleepFn = deps.sleepImpl ?? ((ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));

  const model = (params.model || process.env.CRIATIVO_GEMINI_VIDEO_MODEL || DEFAULT_GEMINI_VIDEO_MODEL).trim();
  const aspectRatio = params.aspect_ratio ?? "9:16";
  const durationSeconds = clampDurationSeconds(params.duration_seconds);
  const resolution = params.resolution ?? "720p";
  const pollIntervalMs = Math.max(10, params.poll_interval_ms ?? 5_000);
  const timeoutMs = Math.max(5_000, params.timeout_ms ?? 300_000);

  const references = loadReferenceImages(params.image_paths ?? [], MAX_VIDEO_REFERENCE_IMAGES);
  const finalPrompt = buildVideoPrompt(params.prompt, references.length);

  mkdirSync(dirname(params.output_path), { recursive: true });
  deps.onProgress?.(`Disparando geração de vídeo (${model}, ${durationSeconds}s, ${resolution})...`);

  const requestBody: Record<string, unknown> = {
    model,
    input: finalPrompt,
    response_format: {
      type: "video",
      duration: `${durationSeconds}s`,
      aspect_ratio: aspectRatio,
      resolution,
      delivery: "uri",
    },
  };

  if (references.length > 0) {
    requestBody.image_inputs = references.map((ref) => ({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.base64,
      },
    }));
  }

  const startRes = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  const startJson = (await startRes.json()) as Record<string, unknown>;
  if (!startRes.ok) {
    const errObj = asRecord(startJson.error);
    const errMsg = pickString(errObj, "message") ?? `Erro Gemini Omni 1.2 Flash: HTTP ${startRes.status}`;
    throw new Error(errMsg);
  }

  const deadline = Date.now() + timeoutMs;
  let extracted = extractVideoRefFromInteractionPayload(startJson);
  const interactionId = extracted.interactionId;

  // Se a interação ainda não retornou URI nem base64 inline, faz polling na interação
  while (!extracted.fileUri && !extracted.inlineBase64 && interactionId) {
    if (extracted.status && /fail|error|cancel/i.test(extracted.status)) {
      throw new Error(`Geração de vídeo falhou na API Gemini (${extracted.status}).`);
    }
    if (Date.now() >= deadline) {
      throw new Error("Timeout aguardando URI de vídeo da interação Gemini Omni 1.2 Flash.");
    }
    deps.onProgress?.("Aguardando interação do vídeo concluir na API Gemini...");
    await sleepFn(pollIntervalMs);

    const pollRes = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(interactionId)}?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" }
    );
    const pollJson = (await pollRes.json()) as Record<string, unknown>;
    if (!pollRes.ok) {
      const errObj = asRecord(pollJson.error);
      throw new Error(
        pickString(errObj, "message") ?? `Erro ao consultar interação de vídeo: HTTP ${pollRes.status}`
      );
    }
    extracted = extractVideoRefFromInteractionPayload(pollJson);
  }

  let videoBuf: Buffer;

  if (extracted.inlineBase64) {
    videoBuf = Buffer.from(extracted.inlineBase64, "base64");
  } else if (extracted.fileUri) {
    const fileId = extractGeminiFileId(extracted.fileUri);
    if (fileId) {
      while (true) {
        if (Date.now() >= deadline) {
          throw new Error("Timeout aguardando processamento do arquivo de vídeo no Gemini Files API.");
        }
        const statusRes = await fetchFn(
          `https://generativelanguage.googleapis.com/v1beta/files/${encodeURIComponent(fileId)}?key=${encodeURIComponent(apiKey)}`,
          { method: "GET" }
        );
        const statusJson = (await statusRes.json()) as Record<string, unknown>;
        if (!statusRes.ok) {
          const errObj = asRecord(statusJson.error);
          throw new Error(
            pickString(errObj, "message") ?? `Erro ao consultar status do vídeo: HTTP ${statusRes.status}`
          );
        }
        const state = pickString(statusJson, "state") ?? "ACTIVE";
        if (state === "ACTIVE") {
          break;
        }
        if (state === "FAILED") {
          throw new Error("Processamento de vídeo falhou no Gemini Files API (state=FAILED).");
        }
        deps.onProgress?.(`Renderizando vídeo na API Gemini (estado: ${state})...`);
        await sleepFn(pollIntervalMs);
      }

      const dlRes = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/files/${encodeURIComponent(fileId)}:download?alt=media&key=${encodeURIComponent(apiKey)}`,
        { method: "GET" }
      );
      if (!dlRes.ok) {
        throw new Error(`Falha ao baixar vídeo MP4 do Gemini Files API (HTTP ${dlRes.status}).`);
      }
      videoBuf = Buffer.from(await dlRes.arrayBuffer());
    } else {
      const dlUrl =
        extracted.fileUri.includes("generativelanguage.googleapis.com") &&
        !extracted.fileUri.includes("key=")
          ? `${extracted.fileUri}${extracted.fileUri.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`
          : extracted.fileUri;
      const dlRes = await fetchFn(dlUrl, { method: "GET" });
      if (!dlRes.ok) {
        throw new Error(`Falha ao baixar vídeo MP4 (HTTP ${dlRes.status}).`);
      }
      videoBuf = Buffer.from(await dlRes.arrayBuffer());
    }
  } else {
    throw new Error("Gemini Omni 1.2 Flash não retornou URI nem payload de vídeo.");
  }

  if (videoBuf.byteLength === 0) {
    throw new Error("Arquivo MP4 retornado pela API Gemini está vazio.");
  }

  writeFileSync(params.output_path, videoBuf);

  return {
    output_path: params.output_path,
    model_used: model,
    aspect_ratio: aspectRatio,
    duration_seconds: durationSeconds,
    resolution,
    references_loaded: references.length,
    size_bytes: videoBuf.byteLength,
    interaction_id: interactionId,
  };
}
