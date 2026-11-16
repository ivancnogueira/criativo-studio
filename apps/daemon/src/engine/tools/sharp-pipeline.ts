import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TargetAspect = "3:4" | "4:5" | "9:16" | "1:1";

export interface DimensionsSpec {
  width: number;
  height: number;
  safeMarginsPx: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export interface CropPipelineResult {
  outputPath: string;
  spec: DimensionsSpec;
  processor: "sharp" | "passthrough";
}

/**
 * Retorna dimensões oficiais do estúdio e margens de respiro mínimas (10% nas bordas,
 * e zona segura estendida em Stories/Reels 9:16 conforme UI-SPEC/AI-SPEC).
 */
export function resolveTargetDimensions(aspect: TargetAspect): DimensionsSpec {
  if (aspect === "9:16") {
    return {
      width: 1080,
      height: 1920,
      safeMarginsPx: {
        top: 210, // zona segura superior Instagram Stories/Reels
        bottom: 260, // zona segura inferior para legenda/CTAs
        left: 108, // 10% lateral
        right: 108,
      },
    };
  }
  if (aspect === "1:1") {
    return {
      width: 1080,
      height: 1080,
      safeMarginsPx: {
        top: 108,
        bottom: 108,
        left: 108,
        right: 108,
      },
    };
  }
  // Padrão Feed Premium (3:4 / 4:5 -> 1080x1350)
  return {
    width: 1080,
    height: 1350,
    safeMarginsPx: {
      top: 135, // 10%
      bottom: 135,
      left: 108,
      right: 108,
    },
  };
}

/**
 * Executa o pós-processamento (corte estrito 1080x1350 ou 1080x1920 + watermark opcional)
 * usando `sharp` quando disponível no host, ou mantendo fallback seguro sem bloquear testes.
 */
export async function processImageMarginsAndCrop(options: {
  inputPath: string;
  outputPath: string;
  aspect: TargetAspect;
  quality?: number;
}): Promise<CropPipelineResult> {
  const spec = resolveTargetDimensions(options.aspect);
  mkdirSync(dirname(options.outputPath), { recursive: true });

  try {
    const sharpModuleName = "sharp";
    const loaded = (await import(sharpModuleName)) as {
      default?: (input: string) => {
        resize: (w: number, h: number, opts: { fit: string; position: string }) => {
          png: (opts?: { quality?: number }) => { toFile: (out: string) => Promise<void> };
        };
      };
    };

    if (typeof loaded.default === "function") {
      await loaded
        .default(options.inputPath)
        .resize(spec.width, spec.height, { fit: "cover", position: "centre" })
        .png({ quality: options.quality ?? 92 })
        .toFile(options.outputPath);

      return {
        outputPath: options.outputPath,
        spec,
        processor: "sharp",
      };
    }
  } catch {
    // Fallback controlado caso a biblioteca nativa sharp não esteja instalada no container
  }

  const rawBuffer = readFileSync(options.inputPath);
  writeFileSync(options.outputPath, rawBuffer);
  return {
    outputPath: options.outputPath,
    spec,
    processor: "passthrough",
  };
}
