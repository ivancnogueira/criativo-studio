/**
 * Serviço de Showcase Local (`dados/showcase/<slug>/`) e rota pública `/showcase/:slug/*` (UX-04 / D-08).
 * Aplica validação estrita de whitelist de extensões, rejeição de symlinks e aprovação humana explícita.
 */
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import type { ShowcaseSiteSummary } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export const MAX_SHOWCASE_SITE_BYTES = 100 * 1024 * 1024; // 100 MB

export const ALLOWED_SHOWCASE_EXTS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".woff",
  ".woff2",
  ".txt",
  ".csv",
  ".pdf",
]);

const SHOWCASE_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
};

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}$/;

interface RawShowcaseRow {
  site_id: string;
  slug: string;
  titulo: string;
  descricao: string;
  source_dir: string;
  public_dir: string;
  spa_fallback: number;
  agente_id: string | null;
  aprovado_por_humano: number;
  ativo: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ShowcaseValidationResult {
  absSourceDir: string;
  relSourceDir: string;
  filesCount: number;
  totalBytes: number;
  sampleFiles: string[];
}

export interface ShowcaseMutationResult {
  ok: boolean;
  requiresApproval?: boolean;
  site?: ShowcaseSiteSummary;
  previewSummary?: {
    slug: string;
    titulo: string;
    sourceDir: string;
    filesCount: number;
    totalBytes: number;
    sampleFiles: string[];
  };
  erro?: string;
}

export interface ShowcaseSiteServiceDeps {
  db: CriativoDatabase;
  workspaceRoot: string;
  wsHub?: WebSocketHub;
}

export class ShowcaseSiteService {
  private readonly db: CriativoDatabase;
  private readonly workspaceRoot: string;
  private wsHub?: WebSocketHub;

  constructor(deps: ShowcaseSiteServiceDeps) {
    this.db = deps.db;
    this.workspaceRoot = resolve(deps.workspaceRoot);
    this.wsHub = deps.wsHub;
  }

  public setWebSocketHub(wsHub: WebSocketHub): void {
    this.wsHub = wsHub;
  }

  public sanitizeSlug(rawSlug: string): string {
    const normalized = String(rawSlug ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 49);
    if (!SLUG_REGEX.test(normalized)) {
      throw new Error(
        "Slug inválido para Showcase: use entre 2 e 49 caracteres alfanuméricos minúsculos e hífens.",
      );
    }
    return normalized;
  }

  public validateSourceDirectory(sourceDir: string): ShowcaseValidationResult {
    const trimmed = String(sourceDir ?? "").trim();
    if (!trimmed) {
      throw new Error("Informe o diretório de origem (sourceDir) para publicação.");
    }

    const absSource = resolve(this.workspaceRoot, trimmed);
    const allowedRoots = [
      resolve(this.workspaceRoot, "saidas"),
      resolve(this.workspaceRoot, "recursos"),
      resolve(this.workspaceRoot, "previas"),
    ];

    const isInsideAllowed = allowedRoots.some((root) => {
      const rel = relative(root, absSource);
      return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
    });

    if (!isInsideAllowed) {
      throw new Error(
        "O diretório de origem do Showcase deve estar dentro de saidas/, recursos/ ou previas/.",
      );
    }

    if (!existsSync(absSource)) {
      throw new Error(`Diretório de origem não encontrado: ${trimmed}`);
    }

    const rootStat = lstatSync(absSource);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error("O sourceDir do Showcase deve ser um diretório real (links simbólicos não são permitidos).");
    }

    let filesCount = 0;
    let totalBytes = 0;
    const sampleFiles: string[] = [];

    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".")) {
          throw new Error(`Arquivo oculto ou sensível proibido no Showcase: ${name}`);
        }
        const full = join(dir, name);
        const st = lstatSync(full);
        if (st.isSymbolicLink()) {
          throw new Error(`Links simbólicos são proibidos no Showcase: ${name}`);
        }
        if (st.isDirectory()) {
          walk(full);
        } else if (st.isFile()) {
          const ext = extname(name).toLowerCase();
          if (!ext || !ALLOWED_SHOWCASE_EXTS.has(ext)) {
            throw new Error(`Extensão não permitida no Showcase: ${name}`);
          }
          totalBytes += st.size;
          if (totalBytes > MAX_SHOWCASE_SITE_BYTES) {
            throw new Error("Tamanho máximo de 100 MB por site Showcase excedido.");
          }
          filesCount += 1;
          if (sampleFiles.length < 15) {
            sampleFiles.push(relative(absSource, full).split(sep).join("/"));
          }
        }
      }
    };

    walk(absSource);
    if (filesCount === 0) {
      throw new Error("O diretório de origem não contém arquivos estáticos válidos.");
    }

    return {
      absSourceDir: absSource,
      relSourceDir: relative(this.workspaceRoot, absSource).split(sep).join("/"),
      filesCount,
      totalBytes,
      sampleFiles,
    };
  }

  private countPublicStats(publicDir: string): { arquivos_count: number; tamanho_bytes: number } {
    if (!existsSync(publicDir)) return { arquivos_count: 0, tamanho_bytes: 0 };
    let count = 0;
    let bytes = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = lstatSync(full);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) walk(full);
        else if (st.isFile()) {
          count += 1;
          bytes += st.size;
        }
      }
    };
    walk(publicDir);
    return { arquivos_count: count, tamanho_bytes: bytes };
  }

  private toSummary(row: RawShowcaseRow): ShowcaseSiteSummary {
    const stats = this.countPublicStats(resolve(this.workspaceRoot, row.public_dir));
    return {
      site_id: row.site_id,
      slug: row.slug,
      titulo: row.titulo,
      descricao: row.descricao,
      source_dir: row.source_dir,
      public_dir: row.public_dir,
      url_local: `/showcase/${row.slug}/`,
      spa_fallback: row.spa_fallback === 1,
      agente_id: row.agente_id,
      aprovado_por_humano: row.aprovado_por_humano === 1,
      ativo: row.ativo === 1,
      arquivos_count: stats.arquivos_count,
      tamanho_bytes: stats.tamanho_bytes,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  public listSites(): ShowcaseSiteSummary[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT
          site_id, slug, titulo, descricao, source_dir, public_dir,
          spa_fallback, agente_id, aprovado_por_humano, ativo, criado_em, atualizado_em
        FROM projecao_showcase_sites
        ORDER BY atualizado_em DESC
      `,
      )
      .all() as unknown as RawShowcaseRow[];

    return rows.map((row) => this.toSummary(row));
  }

  public publishSite(params: {
    slug: string;
    titulo: string;
    descricao?: string;
    sourceDir: string;
    spaFallback?: boolean;
    agenteId?: string | null;
    aprovadoPorHumano: boolean;
  }): ShowcaseMutationResult {
    const slug = this.sanitizeSlug(params.slug);
    const titulo = String(params.titulo ?? "").trim() || slug;
    const descricao = String(params.descricao ?? "").trim();
    const validation = this.validateSourceDirectory(params.sourceDir);

    if (params.aprovadoPorHumano !== true) {
      return {
        ok: false,
        requiresApproval: true,
        previewSummary: {
          slug,
          titulo,
          sourceDir: validation.relSourceDir,
          filesCount: validation.filesCount,
          totalBytes: validation.totalBytes,
          sampleFiles: validation.sampleFiles,
        },
        erro: "Publicação de site Showcase exige confirmação humana explícita.",
      };
    }

    const existing = this.db.connection
      .prepare("SELECT site_id FROM projecao_showcase_sites WHERE slug = ?")
      .get(slug) as { site_id: string } | undefined;
    if (existing) {
      throw new Error(`Já existe um site publicado com o slug "${slug}". Use replace_site.`);
    }

    const publicRel = `dados/showcase/${slug}`;
    const publicAbs = resolve(this.workspaceRoot, publicRel);
    mkdirSync(resolve(this.workspaceRoot, "dados", "showcase"), { recursive: true });
    if (existsSync(publicAbs)) {
      rmSync(publicAbs, { recursive: true, force: true });
    }
    cpSync(validation.absSourceDir, publicAbs, { recursive: true, dereference: false });

    const now = new Date().toISOString();
    const siteId = `site-${randomUUID().slice(0, 8)}`;

    this.db.connection
      .prepare(`
        INSERT INTO projecao_showcase_sites (
          site_id, slug, titulo, descricao, source_dir, public_dir,
          spa_fallback, agente_id, aprovado_por_humano, ativo, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
      `)
      .run(
        siteId,
        slug,
        titulo,
        descricao,
        validation.relSourceDir,
        publicRel,
        params.spaFallback === false ? 0 : 1,
        params.agenteId ?? null,
        now,
        now,
      );

    const row = this.db.connection
      .prepare("SELECT * FROM projecao_showcase_sites WHERE site_id = ?")
      .get(siteId) as unknown as RawShowcaseRow;

    const site = this.toSummary(row);
    this.wsHub?.broadcast("showcase:updated", {
      acao: "published",
      site_id: site.site_id,
      slug: site.slug,
    });
    return { ok: true, site };
  }

  public replaceSite(
    siteIdOrSlug: string,
    params: {
      sourceDir: string;
      titulo?: string;
      descricao?: string;
      spaFallback?: boolean;
      aprovadoPorHumano: boolean;
    },
  ): ShowcaseMutationResult {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_showcase_sites WHERE site_id = ? OR slug = ?")
      .get(siteIdOrSlug, siteIdOrSlug) as unknown as RawShowcaseRow | undefined;

    if (!existing) {
      throw new Error(`Site Showcase "${siteIdOrSlug}" não encontrado.`);
    }

    const validation = this.validateSourceDirectory(params.sourceDir);
    if (params.aprovadoPorHumano !== true) {
      return {
        ok: false,
        requiresApproval: true,
        previewSummary: {
          slug: existing.slug,
          titulo: params.titulo?.trim() || existing.titulo,
          sourceDir: validation.relSourceDir,
          filesCount: validation.filesCount,
          totalBytes: validation.totalBytes,
          sampleFiles: validation.sampleFiles,
        },
        erro: "Substituição de site Showcase exige confirmação humana explícita.",
      };
    }

    const publicAbs = resolve(this.workspaceRoot, existing.public_dir);
    mkdirSync(resolve(this.workspaceRoot, "dados", "showcase"), { recursive: true });
    if (existsSync(publicAbs)) {
      rmSync(publicAbs, { recursive: true, force: true });
    }
    cpSync(validation.absSourceDir, publicAbs, { recursive: true, dereference: false });

    const now = new Date().toISOString();
    const nextTitulo = params.titulo?.trim() || existing.titulo;
    const nextDescricao =
      params.descricao !== undefined ? params.descricao.trim() : existing.descricao;
    const nextSpa =
      params.spaFallback !== undefined ? (params.spaFallback ? 1 : 0) : existing.spa_fallback;

    this.db.connection
      .prepare(`
        UPDATE projecao_showcase_sites
        SET titulo = ?, descricao = ?, source_dir = ?, spa_fallback = ?, aprovado_por_humano = 1, ativo = 1, atualizado_em = ?
        WHERE site_id = ?
      `)
      .run(
        nextTitulo,
        nextDescricao,
        validation.relSourceDir,
        nextSpa,
        now,
        existing.site_id,
      );

    const updated = this.db.connection
      .prepare("SELECT * FROM projecao_showcase_sites WHERE site_id = ?")
      .get(existing.site_id) as unknown as RawShowcaseRow;

    const site = this.toSummary(updated);
    this.wsHub?.broadcast("showcase:updated", {
      acao: "replaced",
      site_id: site.site_id,
      slug: site.slug,
    });
    return { ok: true, site };
  }

  public deleteSite(
    siteIdOrSlug: string,
    opts: { aprovadoPorHumano: boolean },
  ): { ok: boolean; requiresApproval?: boolean; siteId?: string; slug?: string; erro?: string } {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_showcase_sites WHERE site_id = ? OR slug = ?")
      .get(siteIdOrSlug, siteIdOrSlug) as unknown as RawShowcaseRow | undefined;

    if (!existing) {
      throw new Error(`Site Showcase "${siteIdOrSlug}" não encontrado.`);
    }

    if (opts.aprovadoPorHumano !== true) {
      return {
        ok: false,
        requiresApproval: true,
        siteId: existing.site_id,
        slug: existing.slug,
        erro: "Exclusão de site Showcase exige confirmação humana explícita.",
      };
    }

    const publicAbs = resolve(this.workspaceRoot, existing.public_dir);
    const showcaseBase = resolve(this.workspaceRoot, "dados", "showcase");
    const rel = relative(showcaseBase, publicAbs);
    if (!rel.startsWith("..") && existsSync(publicAbs)) {
      rmSync(publicAbs, { recursive: true, force: true });
    }

    this.db.connection
      .prepare("DELETE FROM projecao_showcase_sites WHERE site_id = ?")
      .run(existing.site_id);

    this.wsHub?.broadcast("showcase:updated", {
      acao: "deleted",
      site_id: existing.site_id,
      slug: existing.slug,
    });
    return { ok: true, siteId: existing.site_id, slug: existing.slug };
  }

  public tryServePublicRoute(pathname: string, res: ServerResponse): boolean {
    if (pathname !== "/showcase" && !pathname.startsWith("/showcase/")) {
      return false;
    }

    const rest = pathname.slice("/showcase/".length);
    const slashIdx = rest.indexOf("/");
    const rawSlug = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const rawSubPath = slashIdx === -1 ? "index.html" : rest.slice(slashIdx + 1) || "index.html";

    if (!rawSlug || !SLUG_REGEX.test(rawSlug)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Site Showcase não encontrado.");
      return true;
    }

    let decodedSubPath = "";
    try {
      decodedSubPath = decodeURIComponent(rawSubPath);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Caminho inválido.");
      return true;
    }

    if (decodedSubPath.includes("\0") || decodedSubPath.includes("..")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Acesso negado.");
      return true;
    }

    const row = this.db.connection
      .prepare(
        "SELECT * FROM projecao_showcase_sites WHERE slug = ? AND ativo = 1 AND aprovado_por_humano = 1",
      )
      .get(rawSlug) as unknown as RawShowcaseRow | undefined;

    if (!row) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Site Showcase não encontrado.");
      return true;
    }

    const publicDir = resolve(this.workspaceRoot, row.public_dir);
    const cleanRel = decodedSubPath.replace(/^\/+/, "") || "index.html";
    let targetFile = resolve(publicDir, cleanRel);

    const relToPublic = relative(publicDir, targetFile);
    if (relToPublic.startsWith("..") || relToPublic.includes(`..${sep}`)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Acesso negado.");
      return true;
    }

    if (existsSync(targetFile) && statSync(targetFile).isDirectory()) {
      targetFile = resolve(targetFile, "index.html");
    }

    if (!existsSync(targetFile) || lstatSync(targetFile).isSymbolicLink()) {
      if (row.spa_fallback === 1) {
        const spaIndex = resolve(publicDir, "index.html");
        if (existsSync(spaIndex) && !lstatSync(spaIndex).isSymbolicLink()) {
          targetFile = spaIndex;
        } else {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Arquivo não encontrado.");
          return true;
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Arquivo não encontrado.");
        return true;
      }
    }

    const ext = extname(targetFile).toLowerCase();
    if (!ALLOWED_SHOWCASE_EXTS.has(ext)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Tipo de arquivo bloqueado no Showcase.");
      return true;
    }

    const content = readFileSync(targetFile);
    const contentType = SHOWCASE_MIME_TYPES[ext] ?? "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy":
        "default-src 'self' 'unsafe-inline' data: blob:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; frame-ancestors 'self';",
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  }
}

export const SHOWCASE_AGENT_TOOL_NAMES = [
  "list_sites",
  "publish_site",
  "replace_site",
  "delete_site",
] as const;

export type ShowcaseAgentToolName = (typeof SHOWCASE_AGENT_TOOL_NAMES)[number];

export function executeShowcaseTool(
  service: ShowcaseSiteService,
  toolName: ShowcaseAgentToolName | string,
  args: Record<string, unknown>,
  ctx?: { agenteId?: string | null; aprovadoPorHumano?: boolean },
): Record<string, unknown> {
  const aprovadoPorHumano =
    ctx?.aprovadoPorHumano === true || args.aprovadoPorHumano === true;

  switch (toolName) {
    case "list_sites":
      return { ok: true, sites: service.listSites() };

    case "publish_site":
      return {
        ...service.publishSite({
          slug: String(args.slug ?? ""),
          titulo: String(args.titulo ?? args.title ?? ""),
          descricao: typeof args.descricao === "string" ? args.descricao : undefined,
          sourceDir: String(args.sourceDir ?? args.source_dir ?? ""),
          spaFallback: args.spaFallback !== false,
          agenteId: ctx?.agenteId ?? null,
          aprovadoPorHumano,
        }),
      };

    case "replace_site":
      return {
        ...service.replaceSite(String(args.siteId ?? args.slug ?? args.site_id ?? ""), {
          sourceDir: String(args.sourceDir ?? args.source_dir ?? ""),
          titulo: typeof args.titulo === "string" ? args.titulo : undefined,
          descricao: typeof args.descricao === "string" ? args.descricao : undefined,
          spaFallback: typeof args.spaFallback === "boolean" ? args.spaFallback : undefined,
          aprovadoPorHumano,
        }),
      };

    case "delete_site":
      return {
        ...service.deleteSite(String(args.siteId ?? args.slug ?? args.site_id ?? ""), {
          aprovadoPorHumano,
        }),
      };

    default:
      throw new Error(`Ferramenta de Showcase desconhecida: ${toolName}`);
  }
}
