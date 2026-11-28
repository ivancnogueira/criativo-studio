import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DeliverableSourceType, PublicDeliverableRecord } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { ShowcaseSiteService } from "../server/showcase-service.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { assertSafePublicHttpsUrl } from "./deliverable-url-guard.ts";

const ALLOWED_DELIVERABLE_EXTS = new Set([
  ".pdf",
  ".csv",
  ".docx",
  ".txt",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".zip",
  ".md",
]);

function escapeHtml(raw: string): string {
  return String(raw ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeSlug(raw: string): string {
  const clean = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || `entregavel-${randomUUID().slice(0, 6)}`;
}

function mapDeliverableRow(row: Record<string, unknown>): PublicDeliverableRecord {
  return {
    deliverable_id: String(row.deliverable_id),
    slug: String(row.slug),
    titulo: String(row.titulo),
    descricao: String(row.descricao ?? ""),
    source_type: String(row.source_type) as DeliverableSourceType,
    public_https_url: String(row.public_https_url),
    local_artifact_path: row.local_artifact_path ? String(row.local_artifact_path) : null,
    agente_id: row.agente_id ? String(row.agente_id) : null,
    github_repo: row.github_repo ? String(row.github_repo) : null,
    github_commit_sha: row.github_commit_sha ? String(row.github_commit_sha) : null,
    ativo: Number(row.ativo) === 1,
    criado_em: String(row.criado_em),
    atualizado_em: String(row.atualizado_em),
  };
}

export interface PublishDeliverableInput {
  titulo: string;
  descricao?: string;
  slug?: string;
  source_type: DeliverableSourceType;
  local_file_path?: string | null;
  html_content?: string | null;
  external_https_url?: string | null;
  public_base_url?: string | null;
  agente_id?: string | null;
  github_owner?: string | null;
  github_repo?: string | null;
  github_branch?: string | null;
  github_token?: string | null;
}

/**
 * Publicador público seguro de entregáveis do `diretor_entregaveis` para uso no Direct (DM47-04).
 * Padrão Desktop Local / VPS sem domínio: GitHub Pages automático via PAT no Cofre.
 */
export class DeliverablePublisherService {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private readonly showcaseService?: ShowcaseSiteService;
  private readonly workspaceRoot: string;
  private readonly fetchImpl: FetchLike;

  constructor(deps: {
    db: CriativoDatabase;
    vault?: VaultService;
    showcaseService?: ShowcaseSiteService;
    workspaceRoot: string;
    fetchImpl?: FetchLike;
  }) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.showcaseService = deps.showcaseService;
    this.workspaceRoot = resolve(deps.workspaceRoot);
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  public listDeliverables(onlyActive = true): PublicDeliverableRecord[] {
    const sql = onlyActive
      ? "SELECT * FROM meta_public_deliverables WHERE ativo = 1 ORDER BY atualizado_em DESC;"
      : "SELECT * FROM meta_public_deliverables ORDER BY atualizado_em DESC;";
    const rows = this.db.connection.prepare(sql).all() as Array<Record<string, unknown>>;
    return rows.map(mapDeliverableRow);
  }

  public getDeliverable(deliverableIdOrSlug: string): PublicDeliverableRecord | null {
    const row = this.db.connection
      .prepare("SELECT * FROM meta_public_deliverables WHERE deliverable_id = ? OR slug = ? LIMIT 1;")
      .get(deliverableIdOrSlug, deliverableIdOrSlug) as Record<string, unknown> | undefined;
    return row ? mapDeliverableRow(row) : null;
  }

  public resolveSafeDeliverableUrl(input: {
    deliverableId?: string | null;
    explicitUrl?: string | null;
  }): { ok: boolean; url?: string; title?: string; erro?: string } {
    try {
      if (input.deliverableId) {
        const rec = this.getDeliverable(input.deliverableId);
        if (!rec || !rec.ativo) {
          return { ok: false, erro: "Entregável selecionado não encontrado ou inativo." };
        }
        const safe = assertSafePublicHttpsUrl(rec.public_https_url);
        return { ok: true, url: safe.toString(), title: rec.titulo };
      }
      if (input.explicitUrl) {
        const safe = assertSafePublicHttpsUrl(input.explicitUrl);
        return { ok: true, url: safe.toString() };
      }
      return { ok: false, erro: "Nenhum entregável ou URL HTTPS configurada." };
    } catch (err) {
      return { ok: false, erro: err instanceof Error ? err.message : String(err) };
    }
  }

  public async publishDeliverable(input: PublishDeliverableInput): Promise<PublicDeliverableRecord> {
    const titulo = String(input.titulo ?? "").trim();
    if (!titulo) throw new Error("Título do entregável é obrigatório.");
    const descricao = String(input.descricao ?? "").trim();
    const slug = sanitizeSlug(input.slug || titulo);
    const agora = new Date().toISOString();

    let publicUrl: string;
    let githubRepoFull: string | null = null;
    let commitSha: string | null = null;
    let savedRelPath: string | null = null;

    if (input.source_type === "external_https") {
      publicUrl = assertSafePublicHttpsUrl(input.external_https_url || "").toString();
    } else if (input.source_type === "showcase_https") {
      if (!this.showcaseService) {
        throw new Error("ShowcaseSiteService indisponível nesta instância.");
      }
      const safeBase = assertSafePublicHttpsUrl(input.public_base_url || "");
      const bundleDir = this.stageDeliverableFolder(slug, titulo, descricao, input.local_file_path, input.html_content);
      savedRelPath = relative(this.workspaceRoot, bundleDir).split(sep).join("/");
      const safeAgentId = (() => {
        const candidate = input.agente_id ?? "diretor_entregaveis";
        const row = this.db.connection
          .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
          .get(candidate) as { agente_id: string } | undefined;
        return row ? row.agente_id : null;
      })();
      const pubRes = this.showcaseService.publishSite({
        slug,
        titulo,
        descricao,
        sourceDir: bundleDir,
        agenteId: safeAgentId,
        aprovadoPorHumano: true,
      });
      if (!pubRes.ok) {
        throw new Error(pubRes.erro || "Falha ao publicar entregável no Showcase.");
      }
      publicUrl = `${safeBase.origin}/showcase/${slug}/`;
    } else {
      // Padrão seguro: GitHub Pages automático via PAT no Cofre
      const token = input.github_token?.trim() || this.vault?.getSecret("GITHUB_PAGES_TOKEN") || "";
      const owner = input.github_owner?.trim() || this.vault?.getSecret("GITHUB_PAGES_OWNER") || "";
      const repo = input.github_repo?.trim() || this.vault?.getSecret("GITHUB_PAGES_REPO") || "";
      const branch = input.github_branch?.trim() || this.vault?.getSecret("GITHUB_PAGES_BRANCH") || "main";
      if (!token || !owner || !repo) {
        throw new Error(
          "Configure GITHUB_PAGES_TOKEN, GITHUB_PAGES_OWNER e GITHUB_PAGES_REPO no Cofre (ou informe na janela) para publicar no GitHub Pages."
        );
      }

      if (input.github_token?.trim()) this.vault?.setSecret("GITHUB_PAGES_TOKEN", token);
      if (input.github_owner?.trim()) this.vault?.setSecret("GITHUB_PAGES_OWNER", owner);
      if (input.github_repo?.trim()) this.vault?.setSecret("GITHUB_PAGES_REPO", repo);

      let assetName: string | null = null;
      if (input.local_file_path) {
        const absFile = this.resolveWorkspaceArtifact(input.local_file_path);
        savedRelPath = relative(this.workspaceRoot, absFile).split(sep).join("/");
        assetName = basename(absFile);
        const contentB64 = readFileSync(absFile).toString("base64");
        await this.putGithubFile({
          token,
          owner,
          repo,
          branch,
          repoPath: `entregaveis/${slug}/${assetName}`,
          base64Content: contentB64,
          message: `chore(entregaveis): publica ${assetName} (${slug})`,
        });
      }

      const htmlBody =
        input.html_content?.trim() ||
        this.buildDownloadLandingHtml({ titulo, descricao, assetFileName: assetName });
      const htmlRes = await this.putGithubFile({
        token,
        owner,
        repo,
        branch,
        repoPath: `entregaveis/${slug}/index.html`,
        base64Content: Buffer.from(htmlBody, "utf8").toString("base64"),
        message: `chore(entregaveis): publica landing ${slug}`,
      });
      commitSha = htmlRes.commitSha;
      githubRepoFull = `${owner}/${repo}`;
      publicUrl = assertSafePublicHttpsUrl(
        `https://${owner}.github.io/${repo}/entregaveis/${slug}/`
      ).toString();
    }

    const deliverableId = `deliv-${randomUUID().slice(0, 12)}`;
    this.db.connection
      .prepare(
        `INSERT INTO meta_public_deliverables (
           deliverable_id, slug, titulo, descricao, source_type, public_https_url,
           local_artifact_path, agente_id, github_repo, github_commit_sha, ativo, criado_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           titulo = excluded.titulo,
           descricao = excluded.descricao,
           source_type = excluded.source_type,
           public_https_url = excluded.public_https_url,
           local_artifact_path = excluded.local_artifact_path,
           github_repo = excluded.github_repo,
           github_commit_sha = excluded.github_commit_sha,
           ativo = 1,
           atualizado_em = excluded.atualizado_em;`
      )
      .run(
        deliverableId,
        slug,
        titulo,
        descricao,
        input.source_type,
        publicUrl,
        savedRelPath,
        input.agente_id ?? "diretor_entregaveis",
        githubRepoFull,
        commitSha,
        agora,
        agora
      );

    return this.getDeliverable(slug)!;
  }

  public deleteDeliverable(deliverableId: string): boolean {
    const res = this.db.connection
      .prepare("DELETE FROM meta_public_deliverables WHERE deliverable_id = ?;")
      .run(deliverableId);
    return Number(res.changes ?? 0) > 0;
  }

  private resolveWorkspaceArtifact(rawPath: string): string {
    const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(this.workspaceRoot, rawPath);
    const rel = relative(this.workspaceRoot, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Caminho do arquivo fora do workspace autorizado.");
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new Error("Arquivo de entregável não encontrado no workspace.");
    }
    const ext = extname(resolved).toLowerCase();
    if (!ALLOWED_DELIVERABLE_EXTS.has(ext)) {
      throw new Error(`Extensão '${ext}' não permitida para publicação pública.`);
    }
    return resolved;
  }

  private stageDeliverableFolder(
    slug: string,
    titulo: string,
    descricao: string,
    localFilePath?: string | null,
    htmlContent?: string | null
  ): string {
    const stageDir = resolve(this.workspaceRoot, "saidas", "deliverables", slug);
    mkdirSync(stageDir, { recursive: true });
    let assetName: string | null = null;
    if (localFilePath) {
      const absFile = this.resolveWorkspaceArtifact(localFilePath);
      assetName = basename(absFile);
      writeFileSync(join(stageDir, assetName), readFileSync(absFile));
    }
    const html = htmlContent?.trim() || this.buildDownloadLandingHtml({ titulo, descricao, assetFileName: assetName });
    writeFileSync(join(stageDir, "index.html"), html, "utf8");
    return stageDir;
  }

  private buildDownloadLandingHtml(input: {
    titulo: string;
    descricao: string;
    assetFileName: string | null;
  }): string {
    const safeTitle = escapeHtml(input.titulo);
    const safeDesc = escapeHtml(input.descricao || "Material disponibilizado para download seguro.");
    const btn = input.assetFileName
      ? `<a class="btn" href="./${encodeURIComponent(input.assetFileName)}" download>Baixar Arquivo (${escapeHtml(input.assetFileName)})</a>`
      : "";
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#0d0d0d;color:#f5f5f5;display:grid;place-items:center;min-height:100vh;padding:24px}.card{max-width:540px;width:100%;background:#18181b;border:1px solid #27272a;border-radius:16px;padding:32px}h1{margin:0 0 12px;font-size:24px}p{margin:0 0 24px;color:#a1a1aa;line-height:1.6}.btn{display:inline-block;background:#31cf76;color:#08120c;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px}</style></head><body><main class="card"><h1>${safeTitle}</h1><p>${safeDesc}</p>${btn}</main></body></html>`;
  }

  private async putGithubFile(input: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    repoPath: string;
    base64Content: string;
    message: string;
  }): Promise<{ commitSha: string | null }> {
    const apiBase = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.repoPath}`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "User-Agent": "CriativoOS-DeliverablePublisher",
      "Content-Type": "application/json",
    };

    let existingSha: string | undefined;
    const getRes = await this.fetchImpl(`${apiBase}?ref=${encodeURIComponent(input.branch)}`, { headers });
    if (getRes.ok) {
      const existing = (await getRes.json()) as { sha?: string };
      existingSha = existing.sha;
    }

    const putRes = await this.fetchImpl(apiBase, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: input.message,
        content: input.base64Content,
        branch: input.branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`Falha ao publicar no GitHub Pages (HTTP ${putRes.status}): ${errText.slice(0, 200)}`);
    }
    const resJson = (await putRes.json()) as { commit?: { sha?: string } };
    return { commitSha: resJson.commit?.sha ?? null };
  }
}
