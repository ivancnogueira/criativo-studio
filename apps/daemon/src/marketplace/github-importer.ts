import type {
  AvatarShape,
  GithubImportItemPreview,
  GithubImportPreview,
  MarketplaceAgentPackage,
  MarketplaceSkillItem,
} from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { parseSkillMarkdown } from "../engine/runner/skill-loader.ts";
import {
  CatalogService,
  type InstalledAgentResult,
} from "./catalog-service.ts";
import { sanitizeSkillSlug, SkillsManager } from "./skills-manager.ts";

export const GITHUB_IMPORT_TIMEOUT_MS = 10_000;
export const GITHUB_MAX_FILE_BYTES = 512 * 1024;
export const GITHUB_CACHE_TTL_MS = 5 * 60_000;
const MAX_CANDIDATES_PER_INSPECT = 25;

const SHORTHAND_REPO_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const SAFE_COMMIT_SHA_REGEX = /^[a-fA-F0-9]{7,64}$/;

export class GithubImportError extends Error {
  public readonly code: string;

  constructor(message: string, code = "GITHUB_IMPORT_ERROR") {
    super(message);
    this.name = "GithubImportError";
    this.code = code;
  }
}

export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
  repositoryUrl: string;
}

/**
 * Valida estritamente URLs `https://github.com/<owner>/<repo>` (ou shorthand `owner/repo`),
 * bloqueando SSRF contra outros hosts, IPs privados, credenciais na URL ou esquemas inseguros (T-10-11).
 */
export function parseGithubRepoUrl(rawUrl: string): ParsedGithubRepo {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new GithubImportError(
      "Informe uma URL válida do GitHub (ex.: https://github.com/owner/repo).",
      "INVALID_GITHUB_URL"
    );
  }

  let owner = "";
  let repo = "";
  let branch: string | undefined;
  let subpath: string | undefined;

  if (SHORTHAND_REPO_REGEX.test(trimmed)) {
    const [rawOwner, rawRepo] = trimmed.split("/");
    owner = rawOwner;
    repo = rawRepo.replace(/\.git$/i, "");
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new GithubImportError(
        "URL inválida. Use o formato https://github.com/<owner>/<repo>.",
        "INVALID_GITHUB_URL"
      );
    }

    if (parsed.protocol !== "https:") {
      throw new GithubImportError(
        "Apenas URLs HTTPS de github.com são aceitas por segurança.",
        "SSRF_PROTOCOL_BLOCKED"
      );
    }

    if (parsed.hostname.toLowerCase() !== "github.com") {
      throw new GithubImportError(
        `Host '${parsed.hostname}' não permitido. Apenas github.com é aceito.`,
        "SSRF_HOST_BLOCKED"
      );
    }

    if (parsed.port || parsed.username || parsed.password) {
      throw new GithubImportError(
        "URLs GitHub não podem conter porta customizada ou credenciais embutidas.",
        "SSRF_URL_BLOCKED"
      );
    }

    const segments = parsed.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length < 2) {
      throw new GithubImportError(
        "URL GitHub incompleta. Informe https://github.com/<owner>/<repo>.",
        "INVALID_GITHUB_URL"
      );
    }

    owner = segments[0];
    repo = segments[1].replace(/\.git$/i, "");

    if (segments[2] === "tree" && segments[3]) {
      branch = decodeURIComponent(segments[3]);
      if (segments.length > 4) {
        subpath = segments
          .slice(4)
          .map((s) => decodeURIComponent(s))
          .join("/");
      }
    }
  }

  if (
    !SAFE_SEGMENT_REGEX.test(owner) ||
    !SAFE_SEGMENT_REGEX.test(repo) ||
    owner === "." ||
    owner === ".." ||
    repo === "." ||
    repo === ".."
  ) {
    throw new GithubImportError(
      "Identificador owner/repo do GitHub inválido.",
      "INVALID_GITHUB_REPO"
    );
  }

  if (branch && (branch.includes("..") || branch.includes("\\") || branch.includes("\0"))) {
    throw new GithubImportError("Nome de branch inválido.", "INVALID_GITHUB_BRANCH");
  }

  if (subpath && (subpath.includes("..") || subpath.includes("\\") || subpath.includes("\0"))) {
    throw new GithubImportError("Subcaminho de repositório inválido.", "INVALID_GITHUB_PATH");
  }

  return {
    owner,
    repo,
    branch,
    subpath,
    repositoryUrl: `https://github.com/${owner}/${repo}`,
  };
}

function encodeGithubPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0")) {
        throw new GithubImportError(`Caminho inválido no repositório: ${path}`, "INVALID_PATH");
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

function assertAllowedGithubNetworkUrl(urlStr: string): string {
  const parsed = new URL(urlStr);
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "api.github.com" && parsed.hostname !== "raw.githubusercontent.com")
  ) {
    throw new GithubImportError(
      `Destino de rede bloqueado pela proteção anti-SSRF: ${parsed.hostname}`,
      "SSRF_TARGET_BLOCKED"
    );
  }
  return parsed.toString();
}

function deriveSkillSlugFromPath(path: string, frontmatterName?: string): string {
  const parts = path.split("/").filter(Boolean);
  const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : "";
  const candidate = parentFolder || frontmatterName || "imported-skill";
  try {
    return sanitizeSkillSlug(candidate);
  } catch {
    return sanitizeSkillSlug(frontmatterName || "imported-skill");
  }
}

function isAgentManifestPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower === "agent.json" || lower.endsWith("/agent.json")) return true;
  if (lower.endsWith(".agent.json")) return true;
  if (/^(?:.*\/)?agents\/[^/]+\.json$/.test(lower)) return true;
  return false;
}

export interface GithubImporterOptions {
  skillsManager: SkillsManager;
  catalogService: CatalogService;
}

interface CacheEntry {
  expiresAt: number;
  fetchRef: FetchLike;
  preview: GithubImportPreview;
}

/**
 * Inspetor e importador seguro anti-SSRF de repositórios públicos `github.com`
 * para habilidades (`SKILL.md`) e manifestos de agentes.
 */
export class GithubImporter {
  private readonly skillsManager: SkillsManager;
  private readonly catalogService: CatalogService;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: GithubImporterOptions) {
    this.skillsManager = options.skillsManager;
    this.catalogService = options.catalogService;
  }

  private async fetchJsonBounded(
    urlStr: string,
    fetchImpl: FetchLike
  ): Promise<Record<string, unknown>> {
    const safeUrl = assertAllowedGithubNetworkUrl(urlStr);
    const res = await fetchImpl(safeUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "criativo-ai-studio-online/1.0",
      },
      signal: AbortSignal.timeout(GITHUB_IMPORT_TIMEOUT_MS),
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new GithubImportError(
        `GitHub API respondeu HTTP ${res.status} ao consultar repositório.`,
        "GITHUB_API_ERROR"
      );
    }

    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
      await res.body?.cancel().catch(() => {});
      throw new GithubImportError("Resposta da API GitHub excedeu o limite permitido.", "PAYLOAD_TOO_LARGE");
    }

    return (await res.json()) as Record<string, unknown>;
  }

  private async fetchTextFileBounded(
    urlStr: string,
    fetchImpl: FetchLike
  ): Promise<string> {
    const safeUrl = assertAllowedGithubNetworkUrl(urlStr);
    const res = await fetchImpl(safeUrl, {
      method: "GET",
      headers: {
        Accept: "text/plain, text/markdown, application/json",
        "User-Agent": "criativo-ai-studio-online/1.0",
      },
      signal: AbortSignal.timeout(GITHUB_IMPORT_TIMEOUT_MS),
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new GithubImportError(
        `Falha ao baixar arquivo do GitHub (HTTP ${res.status}).`,
        "GITHUB_FILE_ERROR"
      );
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > GITHUB_MAX_FILE_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new GithubImportError(
        `Arquivo no repositório excede o limite de 512 KB (${declaredLength} bytes).`,
        "FILE_TOO_LARGE"
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > GITHUB_MAX_FILE_BYTES) {
      throw new GithubImportError(
        `Arquivo no repositório excede o limite de 512 KB (${buffer.byteLength} bytes).`,
        "FILE_TOO_LARGE"
      );
    }

    if (buffer.includes(0)) {
      throw new GithubImportError(
        "Arquivo binário não permitido durante importação de texto/manifesto.",
        "BINARY_FILE_REJECTED"
      );
    }

    return buffer.toString("utf8");
  }

  /**
   * Inspeciona um repositório GitHub (com timeout 10s, cache TTL 5 min e aviso `unreviewedExternalSource: true`)
   * listando `SKILL.md` ou manifestos de agentes descobertos no commit atual.
   */
  public async inspectRepository(
    rawUrl: string,
    kind: "skills" | "agents",
    fetchImpl: FetchLike = fetch
  ): Promise<GithubImportPreview> {
    const parsed = parseGithubRepoUrl(rawUrl);
    const cacheKey = `${parsed.owner}/${parsed.repo}@${parsed.branch ?? "default"}:${parsed.subpath ?? ""}:${kind}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.fetchRef === fetchImpl) {
      return cached.preview;
    }

    const repoMeta = await this.fetchJsonBounded(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      fetchImpl
    );

    const branch =
      parsed.branch ||
      (typeof repoMeta.default_branch === "string" && repoMeta.default_branch.trim()
        ? repoMeta.default_branch.trim()
        : "main");

    const treeDoc = await this.fetchJsonBounded(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      fetchImpl
    );

    const rawSha = typeof treeDoc.sha === "string" ? treeDoc.sha.trim() : "";
    const commitSha = SAFE_COMMIT_SHA_REGEX.test(rawSha) ? rawSha : branch;

    const treeEntries = Array.isArray(treeDoc.tree)
      ? (treeDoc.tree as Array<{ path?: unknown; type?: unknown; size?: unknown }>)
      : [];

    const prefixFilter = parsed.subpath ? `${parsed.subpath.replace(/\/+$/, "")}/` : "";
    const candidateEntries = treeEntries
      .filter((entry) => {
        if (entry.type !== "blob" || typeof entry.path !== "string") return false;
        const p = entry.path;
        if (p.includes("..") || p.startsWith("/") || p.includes("\\")) return false;
        if (prefixFilter && p !== parsed.subpath && !p.startsWith(prefixFilter)) return false;
        if (typeof entry.size === "number" && entry.size > GITHUB_MAX_FILE_BYTES) return false;
        if (kind === "skills") {
          return p === "SKILL.md" || p.endsWith("/SKILL.md");
        }
        return isAgentManifestPath(p);
      })
      .slice(0, MAX_CANDIDATES_PER_INSPECT);

    const items: GithubImportItemPreview[] = [];

    for (const entry of candidateEntries) {
      const path = entry.path as string;
      const encodedPath = encodeGithubPath(path);
      const rawFileUrl = `https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${encodeURIComponent(commitSha)}/${encodedPath}`;

      try {
        const content = await this.fetchTextFileBounded(rawFileUrl, fetchImpl);

        if (kind === "skills") {
          const parsedMd = parseSkillMarkdown(content);
          const slug = deriveSkillSlugFromPath(path, parsedMd.frontmatter.name);
          const name = parsedMd.frontmatter.name?.trim() || slug;
          const description =
            parsedMd.frontmatter.description?.trim() ||
            parsedMd.body.split(/\r?\n/)[0]?.replace(/^#+\s*/, "").trim() ||
            `Habilidade importada de ${parsed.owner}/${parsed.repo}`;

          items.push({
            slug,
            name,
            description,
            path,
            kind: "skill",
            markdown: content,
          });
        } else {
          const parsedManifest = JSON.parse(content) as unknown;
          if (!parsedManifest || typeof parsedManifest !== "object" || Array.isArray(parsedManifest)) {
            continue;
          }
          const rec = parsedManifest as Record<string, unknown>;
          const rawName = typeof rec.name === "string" ? rec.name.trim() : "";
          const rawSlug =
            typeof rec.slug === "string" && rec.slug.trim()
              ? rec.slug.trim()
              : rawName || path.split("/").pop()?.replace(/(?:\.agent)?\.json$/i, "") || "agent";
          const slug = sanitizeSkillSlug(rawSlug);
          const name = rawName || slug;
          const description =
            (typeof rec.description === "string" && rec.description.trim()) ||
            (typeof rec.tagline === "string" && rec.tagline.trim()) ||
            (typeof rec.role === "string" && rec.role.trim()) ||
            `Agente importado de ${parsed.owner}/${parsed.repo}`;

          items.push({
            slug,
            name,
            description,
            path,
            kind: "agent",
            manifest: rec,
          });
        }
      } catch {
        // Ignora arquivo individual inválido ou acima de 512 KB sem derrubar a inspeção do repositório
      }
    }

    const preview: GithubImportPreview = {
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      repositoryUrl: parsed.repositoryUrl,
      commitSha,
      kind,
      unreviewedExternalSource: true,
      items,
    };

    this.cache.set(cacheKey, {
      expiresAt: Date.now() + GITHUB_CACHE_TTL_MS,
      fetchRef: fetchImpl,
      preview,
    });

    return preview;
  }

  /**
   * Instala skills (`SKILL.md`) ou agentes selecionados de um repositório GitHub inspecionado
   * no `commitSha` exato, validando tamanho `<= 512 KB` e delegando ao `SkillsManager` ou `CatalogService`.
   */
  public async installFromGithub(input: {
    url: string;
    kind: "skills" | "agents";
    itemPaths?: string[];
    targetAgentIds?: string[];
    fetchImpl?: FetchLike;
  }): Promise<{
    installedCount: number;
    installedSkills: MarketplaceSkillItem[];
    installedAgents: InstalledAgentResult[];
    preview: GithubImportPreview;
    unreviewedExternalSource: true;
  }> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const preview = await this.inspectRepository(input.url, input.kind, fetchImpl);

    const selectedItems =
      Array.isArray(input.itemPaths) && input.itemPaths.length > 0
        ? preview.items.filter((item) => input.itemPaths!.includes(item.path))
        : preview.items;

    if (selectedItems.length === 0) {
      throw new GithubImportError(
        "Nenhum item válido selecionado para instalação a partir do repositório GitHub.",
        "NO_ITEMS_SELECTED"
      );
    }

    const installedSkills: MarketplaceSkillItem[] = [];
    const installedAgents: InstalledAgentResult[] = [];

    for (const item of selectedItems) {
      if (input.kind === "skills" && item.kind === "skill") {
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(preview.owner)}/${encodeURIComponent(preview.repo)}/${encodeURIComponent(preview.commitSha)}/${encodeGithubPath(item.path)}`;
        const markdown = item.markdown ?? (await this.fetchTextFileBounded(rawUrl, fetchImpl));
        if (Buffer.byteLength(markdown, "utf8") > GITHUB_MAX_FILE_BYTES) {
          throw new GithubImportError(
            `Arquivo '${item.path}' excede o limite de 512 KB.`,
            "FILE_TOO_LARGE"
          );
        }

        const installed = this.skillsManager.installExternalSkill({
          slug: item.slug,
          name: item.name,
          description: item.description,
          category: "Comunidade & GitHub",
          markdown,
          repositoryUrl: preview.repositoryUrl,
          commitSha: preview.commitSha,
          targetAgentIds: input.targetAgentIds ?? [],
        });
        installedSkills.push(installed);
      } else if (input.kind === "agents" && item.kind === "agent" && item.manifest) {
        const m = item.manifest;
        const pkg: Partial<MarketplaceAgentPackage> = {
          slug: item.slug,
          name: item.name,
          role: typeof m.role === "string" ? m.role : "Especialista Importado",
          tagline: typeof m.tagline === "string" ? m.tagline : item.description,
          description: item.description,
          category: typeof m.category === "string" ? m.category : "Comunidade & GitHub",
          source: "public",
          verified: false,
          featured: false,
          recommendedModel:
            typeof m.recommendedModel === "string"
              ? m.recommendedModel
              : typeof m.modelo_padrao === "string"
                ? m.modelo_padrao
                : "gemini-2.5-pro",
          avatarShape: (typeof m.avatarShape === "string"
            ? m.avatarShape
            : "rounded_square") as AvatarShape,
          avatarColor: typeof m.avatarColor === "string" ? m.avatarColor : "#007CF7",
          promptBase:
            (typeof m.promptBase === "string" && m.promptBase) ||
            (typeof m.prompt_base === "string" && m.prompt_base) ||
            `Você é ${item.name}. ${item.description}`,
          skills: Array.isArray(m.skills)
            ? m.skills.filter((s): s is string => typeof s === "string")
            : [],
          routines: Array.isArray(m.routines)
            ? (m.routines as MarketplaceAgentPackage["routines"])
            : [],
          mcpSlugs: Array.isArray(m.mcpSlugs)
            ? m.mcpSlugs.filter((s): s is string => typeof s === "string")
            : [],
        };

        const installed = this.catalogService.installAgentPackage(pkg);
        installedAgents.push(installed);
      }
    }

    return {
      installedCount: installedSkills.length + installedAgents.length,
      installedSkills,
      installedAgents,
      preview,
      unreviewedExternalSource: true,
    };
  }
}
