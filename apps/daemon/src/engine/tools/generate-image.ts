import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import type { VaultService } from "../../vault/vault-service.ts";
import type { FetchLike } from "../providers/provider-interface.ts";

export type ImageProviderEngine = "gemini" | "openai" | "flux";

export const GEMINI_IMAGE_MODEL_FALLBACKS = [
  "gemini-nano-banana-2.1",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
] as const;

export const OPENAI_IMAGE_MODEL_FALLBACKS = [
  "gpt-image-2.6-sunburst",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.6-flare",
  "gpt-image-2.5-flare",
  "gpt-image-1",
] as const;

export const MAX_REFERENCES_BY_ENGINE: Record<ImageProviderEngine, number> = {
  gemini: 14,
  openai: 16,
  flux: 6,
};

export interface GenerateImageParams {
  aspect_ratio: "3:4" | "9:16" | "1:1" | "16:9";
  prompt: string;
  image_paths?: string[];
  facial_consistency?: boolean;
  output_path: string;
  engine?: ImageProviderEngine;
  model?: string;
  resolution?: "1K" | "2K" | "4K";
  quality?: "low" | "medium" | "high";
  max_references?: number;
}

export interface EncodedReferenceImage {
  path: string;
  mimeType: string;
  base64: string;
}

export interface GenerateImageResult {
  output_path: string;
  engine_used: ImageProviderEngine;
  model_used: string;
  mime_type: string;
  aspect_ratio: string;
  prompt_final: string;
  references_loaded: number;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Busca uma chave no Cofre aceitando variações em minúsculo, maiúsculo ou formato original.
 */
export function resolveVaultSecretCaseInsensitive(
  vault: VaultService,
  ...keys: string[]
): string | null {
  for (const rawKey of keys) {
    const clean = rawKey.trim();
    if (!clean) continue;
    const candidates = Array.from(new Set([clean, clean.toLowerCase(), clean.toUpperCase()]));
    for (const candidate of candidates) {
      const val = vault.getSecret(candidate);
      if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
      }
    }
  }
  return null;
}

export function isModelNotFoundOrUnsupportedError(status: number, message: string): boolean {
  if (status === 404) return true;
  return /model.*not found|not_found|unsupported model|does not exist|not available|invalid model/i.test(
    message
  );
}

/**
 * Carrega referências visuais (fotos reais, estilos ou logos) em Base64 respeitando o limite do motor.
 */
export function loadReferenceImages(
  imagePaths: string[] = [],
  maxReferences = 14
): EncodedReferenceImage[] {
  const safeCap = Math.max(0, Math.min(Math.trunc(maxReferences), 16));
  const limited = safeCap === 0 ? [] : imagePaths.slice(0, safeCap);
  const loaded: EncodedReferenceImage[] = [];

  for (const imgPath of limited) {
    if (!imgPath || !existsSync(imgPath)) {
      throw new Error(`Imagem de referência não encontrada em ImagePaths: ${imgPath}`);
    }
    const ext = extname(imgPath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] ?? "image/png";
    const base64 = readFileSync(imgPath).toString("base64");
    loaded.push({ path: imgPath, mimeType, base64 });
  }

  return loaded;
}

/**
 * Monta o prompt generativo completo com âncoras biométricas faciais e regras anti-cópia.
 */
export function buildGenerativeImagePrompt(params: GenerateImageParams): string {
  const clauses: string[] = [params.prompt.trim()];

  clauses.push(
    `FORMATO E PROPORÇÃO: enquadramento estrito ${params.aspect_ratio}, deixando no mínimo 10% de margens seguras para tipografia e interface mobile sem cortes críticos.`
  );

  if (params.facial_consistency) {
    clauses.push(
      `SUBJECT / FACIAL CONSISTENCY: Preserve com máxima fidelidade biométrica o rosto, formato facial, tom de pele, expressão natural e traços autênticos da pessoa presente nas imagens de referência (ImagePaths). Proibido alterar identidade facial ou criar rosto genérico.`
    );
  }

  clauses.push(
    `REGRA ANTI-CÓPIA E ANTI-CONTAMINAÇÃO: Nunca copie ou reproduza nomes, @handles, marcas d'água, assinaturas ou logos terceiros visíveis em imagens de referência estéticas; aplique apenas a identidade visual própria enviada.`
  );

  return clauses.join("\n\n");
}

function mapAspectRatioToOpenAISize(aspect: GenerateImageParams["aspect_ratio"]): string {
  if (aspect === "9:16" || aspect === "3:4") return "1024x1536";
  if (aspect === "16:9") return "1536x1024";
  return "1024x1024";
}

function buildUniqueCandidateModels(...sources: Array<string | undefined | readonly string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    const list = typeof src === "string" ? [src] : Array.isArray(src) ? src : [];
    for (const item of list) {
      const clean = typeof item === "string" ? item.trim() : "";
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/**
 * Motor multimodal generate_image: roteia para Google Gemini Nano Banana 2.1,
 * OpenAI GPT Image 2.6 / 2.5 (com múltiplas referências via /v1/images/edits) ou Flux (Fal.ai).
 */
export async function generateImageTool(
  params: GenerateImageParams,
  deps: { vault: VaultService; fetchImpl?: FetchLike }
): Promise<GenerateImageResult> {
  const fetchFn = deps.fetchImpl ?? fetch;
  const engine = selectEngine(params.engine, deps.vault);
  const maxByEngine = MAX_REFERENCES_BY_ENGINE[engine] ?? 14;
  const maxRefs =
    typeof params.max_references === "number" && Number.isFinite(params.max_references)
      ? Math.max(0, Math.min(Math.trunc(params.max_references), maxByEngine))
      : maxByEngine;
  const references = loadReferenceImages(params.image_paths ?? [], maxRefs);
  const finalPrompt = buildGenerativeImagePrompt(params);

  mkdirSync(dirname(params.output_path), { recursive: true });

  let modelUsed = "";
  let mimeType = "image/png";

  if (engine === "gemini") {
    const apiKey = resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY ausente no Cofre para geração multimodal de imagem.");
    }

    const candidates = buildUniqueCandidateModels(
      params.model,
      process.env.CRIATIVO_GEMINI_IMAGE_MODEL,
      GEMINI_IMAGE_MODEL_FALLBACKS
    );

    let lastError: Error | null = null;
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const model = candidates[idx]!;
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const parts: Array<Record<string, unknown>> = [
        { text: finalPrompt },
        ...references.map((ref) => ({
          inlineData: {
            mimeType: ref.mimeType,
            data: ref.base64,
          },
        })),
      ];

      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio: params.aspect_ratio,
              imageSize: params.resolution ?? "2K",
            },
          },
        }),
      });

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
          };
        }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        const msg = data.error?.message ?? `Erro Gemini Image API: HTTP ${response.status}`;
        lastError = new Error(msg);
        if (idx < candidates.length - 1 && isModelNotFoundOrUnsupportedError(response.status, msg)) {
          continue;
        }
        throw lastError;
      }

      const imgPart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!imgPart?.inlineData?.data) {
        lastError = new Error("A API Gemini não retornou payload binário de imagem.");
        throw lastError;
      }

      mimeType = imgPart.inlineData.mimeType || "image/png";
      modelUsed = model;
      writeFileSync(params.output_path, Buffer.from(imgPart.inlineData.data, "base64"));
      break;
    }

    if (!modelUsed) {
      throw lastError ?? new Error("Falha ao gerar imagem via Gemini Image API.");
    }
  } else if (engine === "openai") {
    const apiKey = resolveVaultSecretCaseInsensitive(deps.vault, "openai_api_key");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY ausente no Cofre para GPT Image.");
    }

    const candidates = buildUniqueCandidateModels(
      params.model,
      process.env.CRIATIVO_OPENAI_IMAGE_MODEL,
      OPENAI_IMAGE_MODEL_FALLBACKS
    );
    const size = mapAspectRatioToOpenAISize(params.aspect_ratio);
    const quality = params.quality ?? "high";

    let lastError: Error | null = null;
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const model = candidates[idx]!;
      let response: Response;

      if (references.length > 0) {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", finalPrompt);
        form.append("size", size);
        form.append("quality", quality);
        for (let rIdx = 0; rIdx < references.length; rIdx += 1) {
          const ref = references[rIdx]!;
          const fileBlob = new Blob([Buffer.from(ref.base64, "base64")], { type: ref.mimeType });
          const fileName = basename(ref.path) || `ref-${rIdx + 1}.png`;
          form.append("image[]", fileBlob, fileName);
        }
        response = await fetchFn("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        });
      } else {
        response = await fetchFn("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            prompt: finalPrompt,
            size,
            quality,
            n: 1,
          }),
        });
      }

      const data = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        const msg = data.error?.message ?? `Erro OpenAI Image API: HTTP ${response.status}`;
        lastError = new Error(msg);
        if (idx < candidates.length - 1 && isModelNotFoundOrUnsupportedError(response.status, msg)) {
          continue;
        }
        throw lastError;
      }

      const b64 = data.data?.[0]?.b64_json;
      const imgUrl = data.data?.[0]?.url;
      if (b64) {
        writeFileSync(params.output_path, Buffer.from(b64, "base64"));
      } else if (imgUrl) {
        const dl = await fetchFn(imgUrl);
        if (!dl.ok) {
          throw new Error(`Falha ao baixar imagem retornada pela OpenAI (HTTP ${dl.status}).`);
        }
        writeFileSync(params.output_path, Buffer.from(await dl.arrayBuffer()));
      } else {
        throw new Error("OpenAI Image API não retornou imagem em base64 nem URL.");
      }

      modelUsed = model;
      mimeType = "image/png";
      break;
    }

    if (!modelUsed) {
      throw lastError ?? new Error("Falha ao gerar imagem via OpenAI GPT Image API.");
    }
  } else {
    const falKey = resolveVaultSecretCaseInsensitive(deps.vault, "fal_api_key", "flux_api_key");
    if (!falKey) {
      throw new Error("FAL_API_KEY / FLUX_API_KEY ausente no Cofre para geração Flux.");
    }

    const response = await fetchFn("https://fal.run/fal-ai/flux-pro/v1.1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${falKey}`,
      },
      body: JSON.stringify({
        prompt: finalPrompt,
        aspect_ratio: params.aspect_ratio,
        image_urls: references.map((r) => `data:${r.mimeType};base64,${r.base64}`),
      }),
    });

    const data = (await response.json()) as {
      images?: Array<{ url?: string; content?: string }>;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? `Erro Flux API: HTTP ${response.status}`);
    }
    const imgUrl = data.images?.[0]?.url;
    if (imgUrl && imgUrl.startsWith("data:")) {
      const base64Body = imgUrl.split(",")[1] ?? "";
      writeFileSync(params.output_path, Buffer.from(base64Body, "base64"));
    } else if (imgUrl) {
      const dl = await fetchFn(imgUrl);
      const buf = Buffer.from(await dl.arrayBuffer());
      writeFileSync(params.output_path, buf);
    } else {
      throw new Error("Flux API não retornou URL válida de imagem.");
    }
    modelUsed = "fal-ai/flux-pro/v1.1";
    mimeType = "image/png";
  }

  return {
    output_path: params.output_path,
    engine_used: engine,
    model_used: modelUsed,
    mime_type: mimeType,
    aspect_ratio: params.aspect_ratio,
    prompt_final: finalPrompt,
    references_loaded: references.length,
  };
}

function selectEngine(
  preferred: ImageProviderEngine | undefined,
  vault: VaultService
): ImageProviderEngine {
  if (preferred) return preferred;
  if (resolveVaultSecretCaseInsensitive(vault, "gemini_api_key", "google_api_key")) return "gemini";
  if (resolveVaultSecretCaseInsensitive(vault, "openai_api_key")) return "openai";
  if (resolveVaultSecretCaseInsensitive(vault, "fal_api_key", "flux_api_key")) return "flux";
  return "gemini";
}
