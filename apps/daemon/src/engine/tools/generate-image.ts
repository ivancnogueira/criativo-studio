import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import type { VaultService } from "../../vault/vault-service.ts";
import type { FetchLike } from "../providers/provider-interface.ts";

export type ImageProviderEngine = "gemini" | "openai" | "flux";

export interface GenerateImageParams {
  aspect_ratio: "3:4" | "9:16" | "1:1";
  prompt: string;
  image_paths?: string[];
  facial_consistency?: boolean;
  output_path: string;
  engine?: ImageProviderEngine;
}

export interface EncodedReferenceImage {
  path: string;
  mimeType: string;
  base64: string;
}

export interface GenerateImageResult {
  output_path: string;
  engine_used: ImageProviderEngine;
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
 * Carrega até 3 imagens de referência (foto real do especialista, logo ou layout base) em Base64.
 */
export function loadReferenceImages(imagePaths: string[] = []): EncodedReferenceImage[] {
  const limited = imagePaths.slice(0, 3);
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
  if (aspect === "9:16" || aspect === "3:4") return "1024x1792";
  return "1024x1024";
}

/**
 * Motor multimodal generate_image: roteia para Google Gemini/Imagen, OpenAI DALL-E/GPT Image ou Flux (Fal.ai).
 */
export async function generateImageTool(
  params: GenerateImageParams,
  deps: { vault: VaultService; fetchImpl?: FetchLike }
): Promise<GenerateImageResult> {
  const fetchFn = deps.fetchImpl ?? fetch;
  const references = loadReferenceImages(params.image_paths ?? []);
  const finalPrompt = buildGenerativeImagePrompt(params);
  const engine = selectEngine(params.engine, deps.vault);

  mkdirSync(dirname(params.output_path), { recursive: true });

  if (engine === "gemini") {
    const apiKey = deps.vault.getSecret("GEMINI_API_KEY") ?? deps.vault.getSecret("GOOGLE_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY ausente no Cofre para geração multimodal de imagem.");
    }

    const parts: Array<Record<string, unknown>> = references.map((ref) => ({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.base64,
      },
    }));
    parts.push({ text: finalPrompt });

    const model = process.env.CRIATIVO_GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image-preview";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
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
      throw new Error(data.error?.message ?? `Erro Gemini Image API: HTTP ${response.status}`);
    }

    const imgPart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
      throw new Error("A API Gemini não retornou payload binário de imagem.");
    }
    writeFileSync(params.output_path, Buffer.from(imgPart.inlineData.data, "base64"));
  } else if (engine === "openai") {
    const apiKey = deps.vault.getSecret("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY ausente no Cofre para DALL-E / GPT Image.");
    }

    const model = process.env.CRIATIVO_OPENAI_IMAGE_MODEL ?? "gpt-image-1";
    const response = await fetchFn("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: finalPrompt,
        size: mapAspectRatioToOpenAISize(params.aspect_ratio),
        n: 1,
      }),
    });

    const data = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(data.error?.message ?? `Erro OpenAI Image API: HTTP ${response.status}`);
    }

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("OpenAI Image API não retornou imagem em base64.");
    }
    writeFileSync(params.output_path, Buffer.from(b64, "base64"));
  } else {
    const falKey = deps.vault.getSecret("FAL_API_KEY") ?? deps.vault.getSecret("FLUX_API_KEY");
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
  }

  return {
    output_path: params.output_path,
    engine_used: engine,
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
  if (vault.getSecret("GEMINI_API_KEY") || vault.getSecret("GOOGLE_API_KEY")) return "gemini";
  if (vault.getSecret("OPENAI_API_KEY")) return "openai";
  if (vault.getSecret("FAL_API_KEY") || vault.getSecret("FLUX_API_KEY")) return "flux";
  return "gemini";
}
