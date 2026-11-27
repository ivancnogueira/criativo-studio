import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocxPreviewFromBuffer } from "../docx-preview-parser.ts";
import { resolveOrCreateImageThumbnail } from "../image-thumbnail-service.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

export class UnsafeFilePathError extends Error {
  public readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "UnsafeFilePathError";
  }
}

/**
 * Valida caminhos relativos contra path traversal e restringe acesso a
 * `recursos/`, `conteudos/`, `saidas/` e `previas/`.
 */
export function resolveSafeAllowedFilePath(workspaceRoot: string, requestedRel: string): string {
  const clean = String(requestedRel ?? "").trim();
  if (
    !clean ||
    clean.includes("\0") ||
    clean.includes("..") ||
    clean.startsWith("/") ||
    clean.startsWith("\\") ||
    /^[a-zA-Z]:/.test(clean)
  ) {
    throw new UnsafeFilePathError("Caminho não permitido.");
  }

  const allowedRoots = ["recursos", "conteudos", "saidas", "previas"].map((d) =>
    resolve(workspaceRoot, d),
  );
  const resolvedTarget = resolve(workspaceRoot, clean);
  const isAllowed = allowedRoots.some((root) => {
    const rel = relative(root, resolvedTarget);
    return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel));
  });

  if (!isAllowed) {
    throw new UnsafeFilePathError("Acesso negado fora dos diretórios de mídia permitidos.");
  }
  return resolvedTarget;
}

function resolveValidatedExistingFile(ctx: StudioRouteContext, requestedRel: string): string | null {
  try {
    const resolvedTarget = resolveSafeAllowedFilePath(ctx.workspaceRoot, requestedRel);
    if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
      ctx.deps.sendJson(ctx.res, 404, { erro: "Arquivo não encontrado." });
      return null;
    }
    return resolvedTarget;
  } catch (err) {
    const status = err instanceof UnsafeFilePathError ? err.statusCode : 403;
    ctx.deps.sendJson(ctx.res, status, { erro: err instanceof Error ? err.message : "Caminho não permitido." });
    return null;
  }
}

export async function tryHandleFilesPreviewRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, workspaceRoot } = ctx;

  if (method === "GET" && path === "/api/arquivos/preview-docx") {
    const resolvedTarget = resolveValidatedExistingFile(ctx, url.searchParams.get("path") ?? "");
    if (!resolvedTarget) return true;
    try {
      const document = parseDocxPreviewFromBuffer(readFileSync(resolvedTarget));
      deps.sendJson(res, 200, { ok: true, document });
    } catch (err) {
      deps.sendJson(res, 400, {
        ok: false,
        erro: err instanceof Error ? err.message : "Falha ao processar prévia do arquivo .docx.",
      });
    }
    return true;
  }

  if (method === "GET" && path === "/api/arquivos/thumbnail") {
    const resolvedTarget = resolveValidatedExistingFile(ctx, url.searchParams.get("path") ?? "");
    if (!resolvedTarget) return true;
    const widthRaw = Number(url.searchParams.get("w") ?? "480");
    const thumb = await resolveOrCreateImageThumbnail({
      sourcePath: resolvedTarget,
      workspaceRoot,
      width: Number.isFinite(widthRaw) ? widthRaw : 480,
    });
    const stat = statSync(thumb.filePath);
    const etag = `"thumb-${createHash("sha1").update(`${thumb.filePath}:${stat.mtimeMs}:${stat.size}`).digest("hex")}"`;
    const headers = {
      ETag: etag,
      "Cache-Control": "private, max-age=86400",
      "X-Thumbnail-Mode": thumb.mode,
      "Access-Control-Allow-Origin": "*",
    };

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }

    res.writeHead(200, { ...headers, "Content-Type": thumb.mimeType });
    res.end(readFileSync(thumb.filePath));
    return true;
  }

  return false;
}
