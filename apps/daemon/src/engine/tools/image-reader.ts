/**
 * Inspeção estruturada de imagens locais (`read_image` — BRWS-03 / D-03).
 * Valida confinamento de diretório anti-traversal, limite estrito de 100 MB,
 * assinatura binária real (PNG / JPEG / WebP) e redimensionamento seguro com `sharp` (quando presente).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ReadImageResult } from "@criativo/contracts";

export const READ_IMAGE_MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
export const DEFAULT_READ_IMAGE_MAX_DIMENSION = 1568;

function detectMagicBytesAndDimensions(buf: Buffer): {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
} {
  if (buf.length < 16) {
    throw new Error("Arquivo de imagem corrompido ou truncado (menor que 16 bytes).");
  }

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    if (buf.length < 24) {
      throw new Error("Cabeçalho PNG IHDR incompleto.");
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      throw new Error("Dimensões PNG inválidas.");
    }
    return { mimeType: "image/png", width, height };
  }

  // 2. JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let offset = 2;
    let width = 0;
    let height = 0;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1]!;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 8 < buf.length) {
        height = buf.readUInt16BE(offset + 5);
        width = buf.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + segLen;
    }
    return {
      mimeType: "image/jpeg",
      width: width || 1,
      height: height || 1,
    };
  }

  // 3. WebP: RIFF .... WEBP
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    let width = 1;
    let height = 1;
    const chunkType = buf.toString("ascii", 12, 16);
    if (chunkType === "VP8X" && buf.length >= 30) {
      width = 1 + buf.readUIntLE(24, 3);
      height = 1 + buf.readUIntLE(27, 3);
    } else if (chunkType === "VP8 " && buf.length >= 30) {
      width = buf.readUInt16LE(26) & 0x3fff;
      height = buf.readUInt16LE(28) & 0x3fff;
    } else if (chunkType === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    return { mimeType: "image/webp", width, height };
  }

  throw new Error(
    "Assinatura binária (magic bytes) inválida ou formato não suportado. Envie PNG, JPEG ou WebP autêntico.",
  );
}

export async function readImageTool(
  params: { path: string; maxDimension?: number },
  workspaceRoot: string,
): Promise<ReadImageResult> {
  const rawPath = String(params.path ?? "").trim();
  if (!rawPath || rawPath.includes("\0")) {
    throw new Error("Informe um caminho de imagem válido em 'path'.");
  }

  const rootAbs = resolve(workspaceRoot);
  const absCandidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(rootAbs, rawPath);
  const rel = relative(rootAbs, absCandidate).replace(/\\/g, "/");

  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Leitura de imagem bloqueada fora do workspace: '${rawPath}'.`);
  }

  const allowedRoots = [
    resolve(rootAbs, "recursos"),
    resolve(rootAbs, "saidas"),
    resolve(rootAbs, "previas"),
    resolve(rootAbs, "conteudos"),
    resolve(rootAbs, "dados"),
  ];
  const isInsideAllowed = allowedRoots.some((allowed) => {
    const subRel = relative(allowed, absCandidate);
    return subRel === "" || (!subRel.startsWith("..") && !isAbsolute(subRel));
  });
  if (!isInsideAllowed) {
    throw new Error(
      `Leitura de imagem permitida apenas dentro de recursos/, saidas/, previas/, conteudos/ ou dados/ ('${rel}').`,
    );
  }

  if (!existsSync(absCandidate)) {
    throw new Error(`Arquivo de imagem não encontrado: '${rel}'.`);
  }
  const st = statSync(absCandidate);
  if (!st.isFile()) {
    throw new Error(`O caminho '${rel}' não é um arquivo regular.`);
  }
  if (st.size > READ_IMAGE_MAX_FILE_BYTES) {
    throw new Error(
      `O arquivo '${rel}' (${st.size} bytes) excede o limite máximo de 100 MB em read_image.`,
    );
  }

  const rawBuf = readFileSync(absCandidate);
  const headerInfo = detectMagicBytesAndDimensions(rawBuf);
  const maxDim = Math.min(
    Math.max(128, Math.round(params.maxDimension ?? DEFAULT_READ_IMAGE_MAX_DIMENSION)),
    2048,
  );

  // Tenta redimensionamento com orientação EXIF via sharp quando disponível no ambiente
  try {
    const sharpPkg = "sharp";
    const sharpMod = (await import(sharpPkg)) as {
      default?: (input: Buffer) => {
        metadata: () => Promise<{ width?: number; height?: number }>;
        rotate: () => {
          resize: (opts: {
            width: number;
            height: number;
            fit: "inside";
            withoutEnlargement: boolean;
          }) => {
            toBuffer: (opts: { resolveWithObject: true }) => Promise<{
              data: Buffer;
              info: { width: number; height: number; format: string; size: number };
            }>;
          };
        };
      };
    };

    if (typeof sharpMod.default === "function") {
      const instance = sharpMod.default(rawBuf);
      const meta = await instance.metadata();
      const sourceWidth = meta.width ?? headerInfo.width;
      const sourceHeight = meta.height ?? headerInfo.height;
      const out = await instance
        .rotate()
        .resize({
          width: maxDim,
          height: maxDim,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toBuffer({ resolveWithObject: true });

      const outMime =
        out.info.format === "png"
          ? "image/png"
          : out.info.format === "webp"
            ? "image/webp"
            : "image/jpeg";

      return {
        path: rel,
        dataUrl: `data:${outMime};base64,${out.data.toString("base64")}`,
        width: out.info.width,
        height: out.info.height,
        sourceWidth,
        sourceHeight,
        mimeType: outMime,
        bytes: out.data.length,
      };
    }
  } catch {
    // Fallback nativo puro caso sharp não esteja instalado no host
  }

  return {
    path: rel,
    dataUrl: `data:${headerInfo.mimeType};base64,${rawBuf.toString("base64")}`,
    width: headerInfo.width,
    height: headerInfo.height,
    sourceWidth: headerInfo.width,
    sourceHeight: headerInfo.height,
    mimeType: headerInfo.mimeType,
    bytes: rawBuf.length,
  };
}
