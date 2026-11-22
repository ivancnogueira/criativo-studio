import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";
import type {
  MarketplaceSkillItem,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import {
  parseSkillMarkdown,
} from "../engine/runner/skill-loader.ts";
import { type SkillsManagerDeps, type TailArgs, type CatalogBundleData, type CatalogSkillRow, type AgentSkillLinkRow, SkillsManagerError, loadCatalogBundle, sanitizeSkillSlug, type SkillsManagerOptions } from "./skills-manager-helpers.ts";
import * as catOps from "./skills-manager-catalog.ts";
import * as mutOps from "./skills-manager-mutations.ts";

export * from "./skills-manager-helpers.ts";

export class SkillsManager {
  private readonly db: CriativoDatabase;
  private readonly workspaceRoot: string;
  private readonly productRoot: string | null;
  private readonly skillsLojaRoot: string;
  private readonly bundlePath?: string;

  constructor(options: SkillsManagerOptions) {
    this.db = options.db;
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.productRoot = options.productRoot
      ? resolve(options.productRoot)
      : process.env.CRIATIVO_PRODUCT_ROOT
        ? resolve(process.env.CRIATIVO_PRODUCT_ROOT)
        : null;
    this.skillsLojaRoot = resolve(this.workspaceRoot, "dados", "skills-loja");
    this.bundlePath = options.bundlePath;
  }

  private getBundle(): CatalogBundleData {
    return loadCatalogBundle({
      workspaceRoot: this.workspaceRoot,
      productRoot: this.productRoot ?? undefined,
      bundlePath: this.bundlePath,
    });
  }

  private getNativeSkillsDirs(): string[] {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(this.workspaceRoot, ".agents", "skills"),
      this.productRoot ? resolve(this.productRoot, ".agents", "skills") : null,
      resolve(this.workspaceRoot, "..", "..", ".agents", "skills"),
      resolve(moduleDir, "..", "..", "..", "..", ".agents", "skills"),
      resolve(process.cwd(), ".agents", "skills"),
    ].filter((dir): dir is string => Boolean(dir));
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

  private deps(): SkillsManagerDeps {
    return {
      db: this.db,
      workspaceRoot: this.workspaceRoot,
      productRoot: this.productRoot,
      skillsLojaRoot: this.skillsLojaRoot,
      getBundle: this.getBundle.bind(this),
      getNativeSkillsDirs: this.getNativeSkillsDirs.bind(this),
      assertContainedInLojaRoot: this.assertContainedInLojaRoot.bind(this),
      resolveManagedDirForSlug: this.resolveManagedDirForSlug.bind(this),
      resolveExistingRow: this.resolveExistingRow.bind(this),
      filterValidAgentIds: this.filterValidAgentIds.bind(this),
      linkAgentsTx: this.linkAgentsTx.bind(this),
      hydrateSkillRow: this.hydrateSkillRow.bind(this),
    };
  }

  public syncDiskAndCatalog(...args: TailArgs<typeof catOps.syncDiskAndCatalogOp>): ReturnType<typeof catOps.syncDiskAndCatalogOp> {
    return catOps.syncDiskAndCatalogOp(this.deps(), ...args);
  }

  public listSkills(...args: TailArgs<typeof catOps.listSkillsOp>): ReturnType<typeof catOps.listSkillsOp> {
    return catOps.listSkillsOp(this.deps(), ...args);
  }

  public readSkill(...args: TailArgs<typeof catOps.readSkillOp>): ReturnType<typeof catOps.readSkillOp> {
    return catOps.readSkillOp(this.deps(), ...args);
  }

  public createCustomSkill(...args: TailArgs<typeof mutOps.createCustomSkillOp>): ReturnType<typeof mutOps.createCustomSkillOp> {
    return mutOps.createCustomSkillOp(this.deps(), ...args);
  }

  public reviseSkill(...args: TailArgs<typeof mutOps.reviseSkillOp>): ReturnType<typeof mutOps.reviseSkillOp> {
    return mutOps.reviseSkillOp(this.deps(), ...args);
  }

  public installCatalogSkill(...args: TailArgs<typeof mutOps.installCatalogSkillOp>): ReturnType<typeof mutOps.installCatalogSkillOp> {
    return mutOps.installCatalogSkillOp(this.deps(), ...args);
  }

  public installExternalSkill(...args: TailArgs<typeof mutOps.installExternalSkillOp>): ReturnType<typeof mutOps.installExternalSkillOp> {
    return mutOps.installExternalSkillOp(this.deps(), ...args);
  }

  public setSkillAgentsBatch(...args: TailArgs<typeof mutOps.setSkillAgentsBatchOp>): ReturnType<typeof mutOps.setSkillAgentsBatchOp> {
    return mutOps.setSkillAgentsBatchOp(this.deps(), ...args);
  }

  public setSkillEnabledForAgent(...args: TailArgs<typeof mutOps.setSkillEnabledForAgentOp>): ReturnType<typeof mutOps.setSkillEnabledForAgentOp> {
    return mutOps.setSkillEnabledForAgentOp(this.deps(), ...args);
  }

  public uninstallSkill(...args: TailArgs<typeof mutOps.uninstallSkillOp>): ReturnType<typeof mutOps.uninstallSkillOp> {
    return mutOps.uninstallSkillOp(this.deps(), ...args);
  }
}
