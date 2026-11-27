import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { resolveFfmpegBinaries } from "../engine/tools/video-runtime-resolver.ts";

export interface ImageThumbnailOptions {
  sourcePath: string;
  workspaceRoot: string;
  width: number;
  quality?: number;
}

export interface ImageThumbnailResult {
  filePath: string;
  mimeType: string;
  mode: "generated" | "original-fallback";
}

function inferImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function transcodeThumbnailWithFfmpeg(
  ffmpegBin: string,
  sourcePath: string,
  targetPath: string,
  width: number,
  quality: number,
): Promise<boolean> {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp.webp`;
  const ok = await new Promise<boolean>((resolvePromise) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };

    const child = spawn(
      ffmpegBin,
      [
        "-y",
        "-i",
        sourcePath,
        "-vf",
        `scale='min(${width},iw)':-2`,
        "-q:v",
        String(quality),
        "-frames:v",
        "1",
        tmpPath,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignora erro ao encerrar processo lento
      }
      finish(false);
    }, 10_000);
    timer.unref?.();

    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 && existsSync(tmpPath) && statSync(tmpPath).size > 0);
    });
  });

  if (!ok) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignora limpeza temporária
    }
    return false;
  }

  try {
    renameSync(tmpPath, targetPath);
    return true;
  } catch {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignora
    }
    return false;
  }
}

/**
 * Resolve ou gera miniatura otimizada em `<workspaceRoot>/previas/.thumbs/` usando SHA-256
 * `(relPath + mtimeMs + width)`, com fallback limpo para o arquivo original se `ffmpeg` faltar.
 */
export async function resolveOrCreateImageThumbnail(
  options: ImageThumbnailOptions,
): Promise<ImageThumbnailResult> {
  const sourcePath = resolve(options.sourcePath);
  const workspaceRoot = resolve(options.workspaceRoot);
  const width = Math.max(64, Math.min(1600, Math.round(options.width || 480)));
  const quality = Math.max(40, Math.min(95, Math.round(options.quality ?? 80)));
  const originalMime = inferImageMimeType(sourcePath);

  const ext = extname(sourcePath).toLowerCase();
  if (ext === ".svg" || ext === ".gif") {
    return {
      filePath: sourcePath,
      mimeType: originalMime,
      mode: "original-fallback",
    };
  }

  const stat = statSync(sourcePath);
  const relPath = relative(workspaceRoot, sourcePath).replaceAll("\\", "/");
  const cacheKey = createHash("sha256")
    .update(`${relPath}|${stat.mtimeMs}|${width}|${quality}`)
    .digest("hex");

  const thumbsDir = resolve(workspaceRoot, "previas", ".thumbs");
  const thumbPath = join(thumbsDir, `${cacheKey}.webp`);

  if (existsSync(thumbPath) && statSync(thumbPath).size > 0) {
    return {
      filePath: thumbPath,
      mimeType: "image/webp",
      mode: "generated",
    };
  }

  const ffmpegBin = resolveFfmpegBinaries().ffmpeg;
  if (!ffmpegBin) {
    return {
      filePath: sourcePath,
      mimeType: originalMime,
      mode: "original-fallback",
    };
  }

  mkdirSync(thumbsDir, { recursive: true });
  const generated = await transcodeThumbnailWithFfmpeg(
    ffmpegBin,
    sourcePath,
    thumbPath,
    width,
    quality,
  );

  if (generated && existsSync(thumbPath) && statSync(thumbPath).size > 0) {
    return {
      filePath: thumbPath,
      mimeType: "image/webp",
      mode: "generated",
    };
  }

  return {
    filePath: sourcePath,
    mimeType: originalMime,
    mode: "original-fallback",
  };
}
