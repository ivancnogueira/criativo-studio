import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { parseSkillMarkdown } from "../engine/runner/skill-loader.ts";

export interface CatalogBundleData {
  schemaVersion: number;
  generatedAt: string;
  apps: MarketplaceAppItem[];
  agents: MarketplaceAgentPackage[];
  skills: MarketplaceSkillItem[];
  skillMarkdowns: Record<string, string>;
}

interface CatalogSkillRow {
  skill_id: string;
  slug: string;
  nome: string;
  descricao: string;
  categoria: string;
  origem: "nativa" | "loja" | "github" | "personalizada";
  fonte_rotulo: string | null;
  repositorio_url: string | null;
  commit_sha: string | null;
  caminho_pasta: string;
  verificada: number;
  criado_em: string;
  atualizado_em: string;
}

interface AgentSkillLinkRow {
  agente_id: string;
  skill_id: string;
  habilitada: number;
}

export class SkillsManagerError extends Error {
  public readonly code: string;

  constructor(message: string, code = "SKILLS_MANAGER_ERROR") {
    super(message);
    this.name = "SkillsManagerError";
    this.code = code;
  }
}

export const STRICT_SKILL_SLUG_REGEX = /^[a-z0-9-]+$/;

const catalogBundleCache = new Map<string, CatalogBundleData>();

export function resolveCatalogBundlePath(options?: {
  workspaceRoot?: string;
  bundlePath?: string;
}): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = options?.workspaceRoot ? resolve(options.workspaceRoot) : process.cwd();

  const candidates = [
    options?.bundlePath ? resolve(options.bundlePath) : null,
    resolve(moduleDir, "catalog", "catalog-bundle.json"),
    resolve(moduleDir, "..", "..", "src", "marketplace", "catalog", "catalog-bundle.json"),
    resolve(workspaceRoot, "apps", "daemon", "src", "marketplace", "catalog", "catalog-bundle.json"),
    resolve(workspaceRoot, "src", "marketplace", "catalog", "catalog-bundle.json"),
    resolve(process.cwd(), "apps", "daemon", "src", "marketplace", "catalog", "catalog-bundle.json"),
    resolve(process.cwd(), "src", "marketplace", "catalog", "catalog-bundle.json"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new SkillsManagerError(
    "Catálogo estático 'catalog-bundle.json' não encontrado no workspace do daemon.",
    "CATALOG_BUNDLE_NOT_FOUND"
  );
}

/**
 * Carrega e cacheia o catálogo clean-room (`catalog-bundle.json`) em memória.
 */
export function loadCatalogBundle(options?: {
  workspaceRoot?: string;
  bundlePath?: string;
}): CatalogBundleData {
  const filePath = resolveCatalogBundlePath(options);
  const cached = catalogBundleCache.get(filePath);
  if (cached) {
    return cached;
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<CatalogBundleData>;
  const data: CatalogBundleData = {
    schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date().toISOString(),
    apps: Array.isArray(parsed.apps) ? parsed.apps : [],
    agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    skillMarkdowns:
      parsed.skillMarkdowns && typeof parsed.skillMarkdowns === "object"
        ? parsed.skillMarkdowns
        : {},
  };

  catalogBundleCache.set(filePath, data);
  return data;
}

/**
 * Normaliza e valida um slug de habilidade contra o padrão estrito `^[a-z0-9-]+$`.
 */
export function sanitizeSkillSlug(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  if (
    !trimmed ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new SkillsManagerError(
      "Slug de habilidade inválido: caracteres de caminho ou travessia não são permitidos.",
      "INVALID_SLUG"
    );
  }

  const normalized = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized || !STRICT_SKILL_SLUG_REGEX.test(normalized)) {
    throw new SkillsManagerError(
      "Slug de habilidade inválido. Utilize apenas letras minúsculas, números e hífens.",
      "INVALID_SLUG"
    );
  }

  return normalized;
}

function buildSkillMarkdownDocument(
  name: string,
  description: string,
  instructions: string
): string {
  const cleanName = name.replace(/[\r\n\0]+/g, " ").trim() || "habilidade";
  const cleanDescription = description.replace(/[\r\n\0]+/g, " ").trim() || cleanName;
  const cleanInstructions = instructions.replace(/\0/g, "").trim();
  return `---\nname: ${JSON.stringify(cleanName)}\ndescription: ${JSON.stringify(cleanDescription)}\n---\n\n${cleanInstructions}\n`;
}

export interface SkillsManagerOptions {
  db: CriativoDatabase;
  workspaceRoot?: string;
  bundlePath?: string;
}

export interface SkillReadResult {
  skill: MarketplaceSkillItem;
  markdown: string;
  frontmatter: Record<string, string>;
  body: string;
}

/**
 * Gerencia habilidades locais (`SKILL.md`), sincronização com `.agents/skills` e `dados/skills-loja/`,
 * e vinculação multi-agente em `projecao_habilidades_catalogo` + `projecao_agente_habilidades`.
 */
export class SkillsManager {
  private readonly db: CriativoDatabase;
  private readonly workspaceRoot: string;
  private readonly skillsLojaRoot: string;
  private readonly bundlePath?: string;

  constructor(options: SkillsManagerOptions) {
    this.db = options.db;
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.skillsLojaRoot = resolve(this.workspaceRoot, "dados", "skills-loja");
    this.bundlePath = options.bundlePath;
  }

  private getBundle(): CatalogBundleData {
    return loadCatalogBundle({
      workspaceRoot: this.workspaceRoot,
      bundlePath: this.bundlePath,
    });
  }

  private getNativeSkillsDirs(): string[] {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(this.workspaceRoot, ".agents", "skills"),
      resolve(this.workspaceRoot, "..", "..", ".agents", "skills"),
      resolve(moduleDir, "..", "..", "..", "..", ".agents", "skills"),
      resolve(process.cwd(), ".agents", "skills"),
    ];
    return Array.from(new Set(candidates)).filter((dir) => existsSync(dir));
  }

  /**
   * Valida estritamente path containment garantindo que `targetDir` permaneça filho direto
   * de `dados/skills-loja` e não seja symlink (T-10-12).
   */
  private assertContainedInLojaRoot(targetPath: string): string {
    const rootResolved = resolve(this.skillsLojaRoot);
    const targetResolved = resolve(targetPath);
    const rel = relative(rootResolved, targetResolved);

    if (
      !rel ||
      rel === "." ||
      rel.startsWith("..") ||
      isAbsolute(rel) ||
      rel.includes("/") ||
      rel.includes("\\")
    ) {
      throw new SkillsManagerError(
        "Operação bloqueada: caminho fora da pasta gerenciada de habilidades.",
        "PATH_TRAVERSAL_BLOCKED"
      );
    }

    if (existsSync(targetResolved)) {
      const stats = lstatSync(targetResolved);
      if (stats.isSymbolicLink()) {
        throw new SkillsManagerError(
          "Operação bloqueada: links simbólicos não são permitidos no diretório de habilidades.",
          "SYMLINK_BLOCKED"
        );
      }
    }

    return targetResolved;
  }

  private resolveManagedDirForSlug(rawSlug: string): { slug: string; dirPath: string } {
    const slug = sanitizeSkillSlug(rawSlug);
    const dirPath = this.assertContainedInLojaRoot(resolve(this.skillsLojaRoot, slug));
    return { slug, dirPath };
  }

  private resolveExistingRow(slugOrId: string): CatalogSkillRow | null {
    const clean = slugOrId.trim();
    if (!clean) return null;
    const row = this.db.connection
      .prepare(
        `SELECT * FROM projecao_habilidades_catalogo WHERE skill_id = ? OR slug = ? LIMIT 1;`
      )
      .get(clean, clean) as CatalogSkillRow | undefined;
    return row ?? null;
  }

  private filterValidAgentIds(agentIds: string[] = []): string[] {
    const clean = Array.from(
      new Set(agentIds.map((id) => id.trim()).filter((id) => id.length > 0))
    );
    if (clean.length === 0) return [];

    const existingRows = this.db.connection
      .prepare(`SELECT agente_id FROM projecao_agentes;`)
      .all() as Array<{ agente_id: string }>;
    const existingSet = new Set(existingRows.map((r) => r.agente_id));

    return clean.filter((id) => existingSet.has(id));
  }

  private linkAgentsTx(skillId: string, agentIds: string[], nowIso: string): void {
    const validAgentIds = this.filterValidAgentIds(agentIds);
    if (validAgentIds.length === 0) return;

    const stmt = this.db.connection.prepare(
      `INSERT INTO projecao_agente_habilidades (agente_id, skill_id, habilitada, instalada_em, atualizado_em)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(agente_id, skill_id) DO UPDATE SET
         atualizado_em = excluded.atualizado_em;`
    );

    for (const agentId of validAgentIds) {
      stmt.run(agentId, skillId, nowIso, nowIso);
    }
  }

  private hydrateSkillRow(
    row: CatalogSkillRow,
    linksBySkill: Map<string, AgentSkillLinkRow[]>,
    bundleBySlug: Map<string, MarketplaceSkillItem>
  ): MarketplaceSkillItem {
    const links = linksBySkill.get(row.skill_id) ?? [];
    const agentIds = links.map((l) => l.agente_id);
    const enabledByAgent: Record<string, boolean> = {};
    for (const l of links) {
      enabledByAgent[l.agente_id] = l.habilitada === 1;
    }

    const catalogMeta = bundleBySlug.get(row.slug);
    let markdownPreview = catalogMeta?.markdownPreview ?? row.descricao;
    const skillMdPath = join(row.caminho_pasta, "SKILL.md");
    if (existsSync(skillMdPath)) {
      try {
        const raw = readFileSync(skillMdPath, "utf8");
        const parsed = parseSkillMarkdown(raw);
        if (parsed.body) {
          markdownPreview = parsed.body.slice(0, 600);
        }
      } catch {
        // Fallback para descrição em banco/catálogo
      }
    }

    return {
      skillId: row.skill_id,
      slug: row.slug,
      name: row.nome,
      description: row.descricao,
      category: row.categoria,
      source: row.origem,
      verified: row.verificada === 1,
      featured: catalogMeta?.featured ?? false,
      installed: true,
      agentIds,
      enabledByAgent,
      repositoryUrl: row.repositorio_url,
      commitSha: row.commit_sha,
      pathOnDisk: row.caminho_pasta,
      markdownPreview,
    };
  }

  /**
   * Sincroniza de forma idempotente as skills existentes em `.agents/skills/` (`origem = 'nativa'`)
   * e `dados/skills-loja/` com SQLite, além de garantir o vínculo da skill padrão de cada agente.
   */
  public syncDiskAndCatalog(): { syncedCount: number; linkedAgentsCount: number } {
    const bundle = this.getBundle();
    const bundleBySlug = new Map(bundle.skills.map((s) => [s.slug, s]));
    const agora = new Date().toISOString();
    let syncedCount = 0;
    let linkedAgentsCount = 0;

    this.db.runInTransaction(() => {
      const upsertDiskStmt = this.db.connection.prepare(
        `INSERT INTO projecao_habilidades_catalogo (
           skill_id, slug, nome, descricao, categoria, origem,
           fonte_rotulo, repositorio_url, commit_sha, caminho_pasta,
           verificada, criado_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           nome = CASE WHEN projecao_habilidades_catalogo.origem = 'nativa' THEN excluded.nome ELSE projecao_habilidades_catalogo.nome END,
           descricao = CASE WHEN projecao_habilidades_catalogo.origem = 'nativa' THEN excluded.descricao ELSE projecao_habilidades_catalogo.descricao END,
           categoria = CASE WHEN projecao_habilidades_catalogo.origem = 'nativa' THEN excluded.categoria ELSE projecao_habilidades_catalogo.categoria END,
           caminho_pasta = excluded.caminho_pasta,
           verificada = CASE WHEN projecao_habilidades_catalogo.origem = 'nativa' THEN 1 ELSE projecao_habilidades_catalogo.verificada END,
           atualizado_em = excluded.atualizado_em;`
      );

      const seenNativeSlugs = new Set<string>();
      for (const nativeRoot of this.getNativeSkillsDirs()) {
        let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
        try {
          entries = readdirSync(nativeRoot, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (!STRICT_SKILL_SLUG_REGEX.test(entry.name)) continue;
          if (seenNativeSlugs.has(entry.name)) continue;

          const folderPath = join(nativeRoot, entry.name);
          const skillMdPath = join(folderPath, "SKILL.md");
          if (!existsSync(skillMdPath)) continue;

          seenNativeSlugs.add(entry.name);
          const raw = readFileSync(skillMdPath, "utf8");
          const parsed = parseSkillMarkdown(raw);
          const catalogItem = bundleBySlug.get(entry.name);

          const slug = entry.name;
          const skillId = catalogItem?.skillId || `nativa:${slug}`;
          const nome = catalogItem?.name || parsed.frontmatter.name || slug;
          const descricao =
            catalogItem?.description ||
            parsed.frontmatter.description ||
            "Habilidade nativa do Criativo Studio.";
          const categoria = catalogItem?.category || "Design & Criação";

          upsertDiskStmt.run(
            skillId,
            slug,
            nome,
            descricao,
            categoria,
            "nativa",
            "Criativo Studio",
            folderPath,
            1,
            agora,
            agora
          );
          syncedCount += 1;
        }
      }

      // Garante também sync de skills locais já gravadas em dados/skills-loja/
      if (existsSync(this.skillsLojaRoot)) {
        let lojaEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
        try {
          lojaEntries = readdirSync(this.skillsLojaRoot, { withFileTypes: true });
        } catch {
          lojaEntries = [];
        }

        for (const entry of lojaEntries) {
          if (!entry.isDirectory()) continue;
          if (!STRICT_SKILL_SLUG_REGEX.test(entry.name)) continue;

          const folderPath = join(this.skillsLojaRoot, entry.name);
          const skillMdPath = join(folderPath, "SKILL.md");
          if (!existsSync(skillMdPath)) continue;

          const existing = this.resolveExistingRow(entry.name);
          if (existing) continue;

          const raw = readFileSync(skillMdPath, "utf8");
          const parsed = parseSkillMarkdown(raw);
          const catalogItem = bundleBySlug.get(entry.name);

          const slug = entry.name;
          const skillId = catalogItem?.skillId || `loja:${slug}`;
          const nome = parsed.frontmatter.name || catalogItem?.name || slug;
          const descricao =
            parsed.frontmatter.description ||
            catalogItem?.description ||
            "Habilidade instalada localmente.";
          const categoria = catalogItem?.category || "Automação & Rotinas";

          this.db.connection
            .prepare(
              `INSERT OR IGNORE INTO projecao_habilidades_catalogo (
                 skill_id, slug, nome, descricao, categoria, origem,
                 fonte_rotulo, repositorio_url, commit_sha, caminho_pasta,
                 verificada, criado_em, atualizado_em
               ) VALUES (?, ?, ?, ?, ?, 'loja', 'Loja Criativo', NULL, NULL, ?, ?, ?, ?);`
            )
            .run(
              skillId,
              slug,
              nome,
              descricao,
              categoria,
              folderPath,
              catalogItem?.verified ? 1 : 0,
              agora,
              agora
            );
          syncedCount += 1;
        }
      }

      // Garante vínculo padrão da skill_slug de cada agente em projecao_agente_habilidades
      const agentRows = this.db.connection
        .prepare(`SELECT agente_id, config_json FROM projecao_agentes;`)
        .all() as Array<{ agente_id: string; config_json: string }>;

      const insertLinkIgnore = this.db.connection.prepare(
        `INSERT OR IGNORE INTO projecao_agente_habilidades (
           agente_id, skill_id, habilitada, instalada_em, atualizado_em
         ) VALUES (?, ?, 1, ?, ?);`
      );

      for (const ag of agentRows) {
        let primarySlug = "";
        try {
          const cfg = JSON.parse(ag.config_json || "{}") as { skill_slug?: unknown };
          if (typeof cfg.skill_slug === "string") {
            primarySlug = cfg.skill_slug.trim();
          }
        } catch {
          primarySlug = "";
        }
        if (!primarySlug) continue;

        const skillRow = this.resolveExistingRow(primarySlug);
        if (!skillRow) continue;

        const info = insertLinkIgnore.run(ag.agente_id, skillRow.skill_id, agora, agora);
        linkedAgentsCount += Number(info.changes ?? 0);
      }
    });

    return { syncedCount, linkedAgentsCount };
  }

  /**
   * Lista todas as habilidades combinando `projecao_habilidades_catalogo`, catálogo curado e vínculos por agente.
   */
  public listSkills(filters?: {
    query?: string;
    source?: MarketplaceSourceFilter;
    agentId?: string;
    category?: string;
  }): MarketplaceSkillItem[] {
    const bundle = this.getBundle();
    const bundleBySlug = new Map(bundle.skills.map((s) => [s.slug, s]));

    const installedRows = this.db.connection
      .prepare(`SELECT * FROM projecao_habilidades_catalogo ORDER BY nome ASC;`)
      .all() as unknown as CatalogSkillRow[];

    const linkRows = this.db.connection
      .prepare(`SELECT agente_id, skill_id, habilitada FROM projecao_agente_habilidades;`)
      .all() as unknown as AgentSkillLinkRow[];

    const linksBySkill = new Map<string, AgentSkillLinkRow[]>();
    for (const link of linkRows) {
      const list = linksBySkill.get(link.skill_id) ?? [];
      list.push(link);
      linksBySkill.set(link.skill_id, list);
    }

    const installedSlugs = new Set<string>();
    const combined: MarketplaceSkillItem[] = [];

    for (const row of installedRows) {
      installedSlugs.add(row.slug);
      combined.push(this.hydrateSkillRow(row, linksBySkill, bundleBySlug));
    }

    for (const catItem of bundle.skills) {
      if (installedSlugs.has(catItem.slug)) continue;
      combined.push({
        ...catItem,
        installed: false,
        agentIds: [],
        enabledByAgent: {},
      });
    }

    const queryLower = filters?.query?.trim().toLowerCase() ?? "";
    const sourceFilter = filters?.source ?? "all";
    const categoryFilter = filters?.category?.trim().toLowerCase() ?? "";
    const agentFilter = filters?.agentId?.trim() ?? "";

    const filtered = combined.filter((item) => {
      if (sourceFilter === "verified" && !item.verified) {
        return false;
      }
      if (sourceFilter === "public" && item.verified) {
        return false;
      }
      if (categoryFilter && item.category.toLowerCase() !== categoryFilter) {
        return false;
      }
      if (agentFilter && !item.agentIds.includes(agentFilter)) {
        return false;
      }
      if (queryLower) {
        const haystack = [item.name, item.slug, item.description, item.category, item.markdownPreview]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(queryLower)) {
          return false;
        }
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }

  /**
   * Lê conteúdo completo do `SKILL.md` de uma habilidade instalada ou presente no catálogo.
   */
  public readSkill(slugOrId: string): SkillReadResult | null {
    const clean = slugOrId.trim();
    if (!clean) return null;

    const bundle = this.getBundle();
    const bundleBySlug = new Map(bundle.skills.map((s) => [s.slug, s]));
    const row = this.resolveExistingRow(clean);

    if (row) {
      const linkRows = this.db.connection
        .prepare(`SELECT agente_id, skill_id, habilitada FROM projecao_agente_habilidades WHERE skill_id = ?;`)
        .all(row.skill_id) as unknown as AgentSkillLinkRow[];
      const linksBySkill = new Map<string, AgentSkillLinkRow[]>([[row.skill_id, linkRows]]);
      const hydrated = this.hydrateSkillRow(row, linksBySkill, bundleBySlug);

      const skillFile = join(row.caminho_pasta, "SKILL.md");
      const markdown = existsSync(skillFile)
        ? readFileSync(skillFile, "utf8")
        : bundle.skillMarkdowns[row.slug] ??
          buildSkillMarkdownDocument(row.nome, row.descricao, row.descricao);
      const parsed = parseSkillMarkdown(markdown);

      return {
        skill: hydrated,
        markdown,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      };
    }

    const catSkill = bundle.skills.find((s) => s.slug === clean || s.skillId === clean);
    if (!catSkill) return null;

    const markdown =
      bundle.skillMarkdowns[catSkill.slug] ??
      buildSkillMarkdownDocument(catSkill.name, catSkill.description, catSkill.markdownPreview);
    const parsed = parseSkillMarkdown(markdown);

    return {
      skill: {
        ...catSkill,
        installed: false,
        agentIds: [],
        enabledByAgent: {},
      },
      markdown,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
    };
  }

  /**
   * Cria uma nova habilidade local personalizada (`SKILL.md` em `dados/skills-loja/<slug>/`)
   * e registra em `projecao_habilidades_catalogo` + vínculos iniciais em `projecao_agente_habilidades`.
   */
  public createCustomSkill(input: {
    name: string;
    slug?: string;
    description: string;
    category: string;
    instructions: string;
    agentIds?: string[];
  }): MarketplaceSkillItem {
    const cleanName = input.name?.trim();
    const cleanDesc = input.description?.trim();
    const cleanInstructions = input.instructions?.trim();
    const cleanCategory = input.category?.trim() || "Automação & Rotinas";

    if (!cleanName) {
      throw new SkillsManagerError("Informe o nome da habilidade.", "VALIDATION_ERROR");
    }
    if (!cleanDesc) {
      throw new SkillsManagerError("Informe uma descrição curta para a habilidade.", "VALIDATION_ERROR");
    }
    if (!cleanInstructions) {
      throw new SkillsManagerError("Informe as instruções da habilidade (SKILL.md).", "VALIDATION_ERROR");
    }

    const { slug, dirPath } = this.resolveManagedDirForSlug(input.slug?.trim() || cleanName);

    const existing = this.resolveExistingRow(slug);
    if (existing) {
      throw new SkillsManagerError(
        `Já existe uma habilidade registrada com o slug '${slug}'. Escolha outro identificador.`,
        "SKILL_ALREADY_EXISTS"
      );
    }

    mkdirSync(dirPath, { recursive: true });
    const markdown = buildSkillMarkdownDocument(cleanName, cleanDesc, cleanInstructions);
    const skillFilePath = resolve(dirPath, "SKILL.md");
    writeFileSync(skillFilePath, markdown, "utf8");

    const skillId = `personalizada:${slug}`;
    const agora = new Date().toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_habilidades_catalogo (
             skill_id, slug, nome, descricao, categoria, origem,
             fonte_rotulo, repositorio_url, commit_sha, caminho_pasta,
             verificada, criado_em, atualizado_em
           ) VALUES (?, ?, ?, ?, ?, 'personalizada', 'Criada no estúdio', NULL, NULL, ?, 0, ?, ?);`
        )
        .run(skillId, slug, cleanName, cleanDesc, cleanCategory, dirPath, agora, agora);

      if (input.agentIds && input.agentIds.length > 0) {
        this.linkAgentsTx(skillId, input.agentIds, agora);
      }
    });

    return this.readSkill(skillId)!.skill;
  }

  /**
   * Atualiza instruções e metadados de habilidade local (`personalizada` | `loja` | `github`),
   * protegendo habilidades nativas do sistema contra mutação destrutiva.
   */
  public reviseSkill(
    slugOrId: string,
    patch: { description?: string; instructions: string; category?: string; name?: string }
  ): MarketplaceSkillItem {
    const existing = this.resolveExistingRow(slugOrId);
    if (!existing) {
      throw new SkillsManagerError(
        `Habilidade '${slugOrId}' não está instalada localmente.`,
        "SKILL_NOT_FOUND"
      );
    }

    if (existing.origem === "nativa") {
      throw new SkillsManagerError(
        "Habilidades nativas do sistema são protegidas contra edição direta. Crie uma habilidade personalizada.",
        "NATIVE_SKILL_PROTECTED"
      );
    }

    const cleanInstructions = patch.instructions?.trim();
    if (!cleanInstructions) {
      throw new SkillsManagerError("As instruções atualizadas não podem ficar vazias.", "VALIDATION_ERROR");
    }

    const containedDir = this.assertContainedInLojaRoot(existing.caminho_pasta);
    mkdirSync(containedDir, { recursive: true });

    const nextName = patch.name?.trim() || existing.nome;
    const nextDescription = patch.description?.trim() || existing.descricao;
    const nextCategory = patch.category?.trim() || existing.categoria;
    const markdown = buildSkillMarkdownDocument(nextName, nextDescription, cleanInstructions);

    writeFileSync(resolve(containedDir, "SKILL.md"), markdown, "utf8");

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `UPDATE projecao_habilidades_catalogo
           SET nome = ?, descricao = ?, categoria = ?, atualizado_em = ?
           WHERE skill_id = ?;`
        )
        .run(nextName, nextDescription, nextCategory, agora, existing.skill_id);
    });

    return this.readSkill(existing.skill_id)!.skill;
  }

  /**
   * Materializa `SKILL.md` do catálogo oficial em `dados/skills-loja/<slug>/SKILL.md`,
   * registra em `projecao_habilidades_catalogo` e vincula aos agentes selecionados.
   */
  public installCatalogSkill(slugOrId: string, targetAgentIds: string[] = []): MarketplaceSkillItem {
    const clean = slugOrId.trim();
    const agora = new Date().toISOString();

    const existing = this.resolveExistingRow(clean);
    if (existing) {
      if (targetAgentIds.length > 0) {
        this.db.runInTransaction(() => {
          this.linkAgentsTx(existing.skill_id, targetAgentIds, agora);
        });
      }
      return this.readSkill(existing.skill_id)!.skill;
    }

    const bundle = this.getBundle();
    const catItem = bundle.skills.find((s) => s.slug === clean || s.skillId === clean);
    if (!catItem) {
      throw new SkillsManagerError(
        `Habilidade '${slugOrId}' não encontrada no catálogo local.`,
        "SKILL_NOT_FOUND"
      );
    }

    if (catItem.source === "nativa") {
      this.syncDiskAndCatalog();
      const synced = this.resolveExistingRow(catItem.slug);
      if (synced) {
        if (targetAgentIds.length > 0) {
          this.db.runInTransaction(() => {
            this.linkAgentsTx(synced.skill_id, targetAgentIds, agora);
          });
        }
        return this.readSkill(synced.skill_id)!.skill;
      }
    }

    const { slug, dirPath } = this.resolveManagedDirForSlug(catItem.slug);
    mkdirSync(dirPath, { recursive: true });

    const markdown =
      bundle.skillMarkdowns[slug] ??
      buildSkillMarkdownDocument(catItem.name, catItem.description, catItem.markdownPreview);
    writeFileSync(resolve(dirPath, "SKILL.md"), markdown, "utf8");

    const skillId = catItem.skillId || `loja:${slug}`;
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_habilidades_catalogo (
             skill_id, slug, nome, descricao, categoria, origem,
             fonte_rotulo, repositorio_url, commit_sha, caminho_pasta,
             verificada, criado_em, atualizado_em
           ) VALUES (?, ?, ?, ?, ?, 'loja', 'Loja Criativo', NULL, NULL, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             caminho_pasta = excluded.caminho_pasta,
             atualizado_em = excluded.atualizado_em;`
        )
        .run(
          skillId,
          slug,
          catItem.name,
          catItem.description,
          catItem.category,
          dirPath,
          catItem.verified ? 1 : 0,
          agora,
          agora
        );

      const persisted = this.resolveExistingRow(slug)!;
      if (targetAgentIds.length > 0) {
        this.linkAgentsTx(persisted.skill_id, targetAgentIds, agora);
      }
    });

    return this.readSkill(slug)!.skill;
  }

  /**
   * Instala habilidade externa importada (ex.: GitHub) com metadados de rastreabilidade.
   */
  public installExternalSkill(input: {
    slug: string;
    name: string;
    description: string;
    category?: string;
    markdown: string;
    repositoryUrl: string;
    commitSha: string;
    targetAgentIds?: string[];
  }): MarketplaceSkillItem {
    const { slug, dirPath } = this.resolveManagedDirForSlug(input.slug);
    const existing = this.resolveExistingRow(slug);
    if (existing && existing.origem === "nativa") {
      throw new SkillsManagerError(
        `Conflito de slug '${slug}': não é permitido sobrescrever uma habilidade nativa do sistema.`,
        "NATIVE_SKILL_PROTECTED"
      );
    }

    const cleanMarkdown = input.markdown.replace(/\0/g, "");
    if (Buffer.byteLength(cleanMarkdown, "utf8") > 512 * 1024) {
      throw new SkillsManagerError(
        "Arquivo SKILL.md excede o limite de 512 KB.",
        "FILE_TOO_LARGE"
      );
    }

    mkdirSync(dirPath, { recursive: true });
    writeFileSync(resolve(dirPath, "SKILL.md"), cleanMarkdown, "utf8");

    const skillId = existing?.skill_id ?? `github:${slug}`;
    const agora = new Date().toISOString();
    const nome = input.name.trim() || slug;
    const descricao = input.description.trim() || nome;
    const categoria = input.category?.trim() || "Comunidade & GitHub";

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_habilidades_catalogo (
             skill_id, slug, nome, descricao, categoria, origem,
             fonte_rotulo, repositorio_url, commit_sha, caminho_pasta,
             verificada, criado_em, atualizado_em
           ) VALUES (?, ?, ?, ?, ?, 'github', 'GitHub (externo)', ?, ?, ?, 0, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             nome = excluded.nome,
             descricao = excluded.descricao,
             categoria = excluded.categoria,
             origem = 'github',
             fonte_rotulo = 'GitHub (externo)',
             repositorio_url = excluded.repositorio_url,
             commit_sha = excluded.commit_sha,
             caminho_pasta = excluded.caminho_pasta,
             verificada = 0,
             atualizado_em = excluded.atualizado_em;`
        )
        .run(
          skillId,
          slug,
          nome,
          descricao,
          categoria,
          input.repositoryUrl,
          input.commitSha,
          dirPath,
          agora,
          agora
        );

      const persisted = this.resolveExistingRow(slug)!;
      if (input.targetAgentIds && input.targetAgentIds.length > 0) {
        this.linkAgentsTx(persisted.skill_id, input.targetAgentIds, agora);
      }
    });

    return this.readSkill(slug)!.skill;
  }

  /**
   * Substitui em transação SQLite o conjunto de agentes vinculados a uma habilidade,
   * retornando `{ previousAgentIds, currentAgentIds }` para o fluxo de `Desfazer vínculo` (6s).
   */
  public setSkillAgentsBatch(
    skillIdOrSlug: string,
    nextAgentIds: string[]
  ): {
    skillId: string;
    slug: string;
    previousAgentIds: string[];
    currentAgentIds: string[];
  } {
    let row = this.resolveExistingRow(skillIdOrSlug);
    if (!row) {
      // Materializa automaticamente caso seja habilidade do catálogo ainda não instalada
      this.installCatalogSkill(skillIdOrSlug, []);
      row = this.resolveExistingRow(skillIdOrSlug);
    }
    if (!row) {
      throw new SkillsManagerError(`Habilidade '${skillIdOrSlug}' não encontrada.`, "SKILL_NOT_FOUND");
    }

    const validNextIds = this.filterValidAgentIds(nextAgentIds);
    const agora = new Date().toISOString();
    let previousAgentIds: string[] = [];

    this.db.runInTransaction(() => {
      const currentRows = this.db.connection
        .prepare(
          `SELECT agente_id, habilitada, instalada_em FROM projecao_agente_habilidades WHERE skill_id = ?;`
        )
        .all(row!.skill_id) as Array<{
        agente_id: string;
        habilitada: number;
        instalada_em: string;
      }>;

      previousAgentIds = currentRows.map((r) => r.agente_id);
      const prevMap = new Map(currentRows.map((r) => [r.agente_id, r]));

      this.db.connection
        .prepare(`DELETE FROM projecao_agente_habilidades WHERE skill_id = ?;`)
        .run(row!.skill_id);

      const insertStmt = this.db.connection.prepare(
        `INSERT INTO projecao_agente_habilidades (agente_id, skill_id, habilitada, instalada_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?);`
      );

      for (const agentId of validNextIds) {
        const prev = prevMap.get(agentId);
        insertStmt.run(
          agentId,
          row!.skill_id,
          prev ? prev.habilitada : 1,
          prev ? prev.instalada_em : agora,
          agora
        );
      }
    });

    return {
      skillId: row.skill_id,
      slug: row.slug,
      previousAgentIds,
      currentAgentIds: validNextIds,
    };
  }

  /**
   * Habilita ou desabilita (`habilitada = 1 | 0`) uma habilidade para um agente específico.
   */
  public setSkillEnabledForAgent(
    agenteId: string,
    skillIdOrSlug: string,
    habilitada: boolean
  ): { agenteId: string; skillId: string; habilitada: boolean } {
    const cleanAgentId = agenteId.trim();
    const agentExists = this.db.connection
      .prepare(`SELECT 1 FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(cleanAgentId);
    if (!agentExists) {
      throw new SkillsManagerError(`Agente '${cleanAgentId}' não encontrado.`, "AGENT_NOT_FOUND");
    }

    let row = this.resolveExistingRow(skillIdOrSlug);
    if (!row) {
      this.installCatalogSkill(skillIdOrSlug, []);
      row = this.resolveExistingRow(skillIdOrSlug);
    }
    if (!row) {
      throw new SkillsManagerError(`Habilidade '${skillIdOrSlug}' não encontrada.`, "SKILL_NOT_FOUND");
    }

    const agora = new Date().toISOString();
    const enabledBit = habilitada ? 1 : 0;

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_agente_habilidades (agente_id, skill_id, habilitada, instalada_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(agente_id, skill_id) DO UPDATE SET
             habilitada = excluded.habilitada,
             atualizado_em = excluded.atualizado_em;`
        )
        .run(cleanAgentId, row!.skill_id, enabledBit, agora, agora);
    });

    return {
      agenteId: cleanAgentId,
      skillId: row.skill_id,
      habilitada,
    };
  }

  /**
   * Desinstala uma habilidade local (`loja`, `github` ou `personalizada`),
   * bloqueando exclusão de skills com `origem === 'nativa'` e validando path containment.
   */
  public uninstallSkill(skillIdOrSlug: string): {
    removed: boolean;
    skillId?: string;
    slug?: string;
  } {
    const existing = this.resolveExistingRow(skillIdOrSlug);
    if (!existing) {
      return { removed: false };
    }

    if (existing.origem === "nativa") {
      throw new SkillsManagerError(
        "Habilidades nativas do Criativo Studio não podem ser desinstaladas.",
        "NATIVE_SKILL_PROTECTED"
      );
    }

    const containedDir = this.assertContainedInLojaRoot(existing.caminho_pasta);

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(`DELETE FROM projecao_agente_habilidades WHERE skill_id = ?;`)
        .run(existing.skill_id);
      this.db.connection
        .prepare(`DELETE FROM projecao_habilidades_catalogo WHERE skill_id = ?;`)
        .run(existing.skill_id);
    });

    if (existsSync(containedDir)) {
      rmSync(containedDir, { recursive: true, force: true });
    }

    return {
      removed: true,
      skillId: existing.skill_id,
      slug: existing.slug,
    };
  }
}
