import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

export function resolveWebDistDir(preferredDistDir?: string, productRoot?: string): string {
  if (preferredDistDir && existsSync(resolve(preferredDistDir, "index.html"))) {
    return preferredDistDir;
  }
  const currentDir = resolve(fileURLToPath(import.meta.url), "..");
  const candidates = [
    productRoot ? resolve(productRoot, "apps/web/dist") : null,
    productRoot ? resolve(productRoot, "web-dist") : null,
    resolve(currentDir, "../../../../apps/web/dist"),
    resolve(process.cwd(), "apps/web/dist"),
    resolve(process.cwd(), "../web/dist"),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) {
      return dir;
    }
  }
  return candidates[0] ?? resolve(currentDir, "../../../../apps/web/dist");
}

export function tryServeWebStatic(
  pathName: string,
  res: ServerResponse,
  preferredDistDir?: string,
  productRoot?: string
): boolean {
  if (pathName.startsWith("/api/") || pathName === "/health" || pathName === "/ws") {
    return false;
  }
  const distDir = resolveWebDistDir(preferredDistDir, productRoot);
  const indexHtml = resolve(distDir, "index.html");
  if (!existsSync(indexHtml)) {
    return false;
  }

  const relativePath = pathName === "/" ? "index.html" : pathName.replace(/^\/+/, "");
  const resolvedTarget = resolve(distDir, relativePath);
  if (resolvedTarget !== distDir && !resolvedTarget.startsWith(distDir + sep)) {
    return false;
  }

  const fileToServe =
    existsSync(resolvedTarget) && statSync(resolvedTarget).isFile()
      ? resolvedTarget
      : indexHtml;
  const mime = STATIC_MIME_TYPES[extname(fileToServe).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control":
      fileToServe === indexHtml
        ? "no-store, no-cache, must-revalidate"
        : "public, max-age=31536000, immutable",
  });
  res.end(readFileSync(fileToServe));
  return true;
}
