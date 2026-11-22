import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";
import type {
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
} from "@criativo/contracts";
import {
  parseSkillMarkdown,
} from "../engine/runner/skill-loader.ts";
import { type SkillsManagerDeps, type CatalogSkillRow, type AgentSkillLinkRow, STRICT_SKILL_SLUG_REGEX, buildSkillMarkdownDocument, type SkillReadResult } from "./skills-manager-helpers.ts";

export function syncDiskAndCatalogOp(deps: SkillsManagerDeps): { syncedCount: number; linkedAgentsCount: number } {
  const bundle = deps.getBundle();
  const bundleBySlug = new Map(bundle.skills.map((s) => [s.slug, s]));
  const agora = new Date().toISOString();
  let syncedCount = 0;
  let linkedAgentsCount = 0;

  deps.db.runInTransaction(() => {
    const upsertDiskStmt = deps.db.connection.prepare(
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
    for (const nativeRoot of deps.getNativeSkillsDirs()) {
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
    if (existsSync(deps.skillsLojaRoot)) {
      let lojaEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
      try {
        lojaEntries = readdirSync(deps.skillsLojaRoot, { withFileTypes: true });
      } catch {
        lojaEntries = [];
      }

      for (const entry of lojaEntries) {
        if (!entry.isDirectory()) continue;
        if (!STRICT_SKILL_SLUG_REGEX.test(entry.name)) continue;

        const folderPath = join(deps.skillsLojaRoot, entry.name);
        const skillMdPath = join(folderPath, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;

        const existing = deps.resolveExistingRow(entry.name);
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

        deps.db.connection
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
    const agentRows = deps.db.connection
      .prepare(`SELECT agente_id, config_json FROM projecao_agentes;`)
      .all() as Array<{ agente_id: string; config_json: string }>;

    const insertLinkIgnore = deps.db.connection.prepare(
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

      const skillRow = deps.resolveExistingRow(primarySlug);
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
export function listSkillsOp(deps: SkillsManagerDeps, filters?: {
    query?: string;
    source?: MarketplaceSourceFilter;
    agentId?: string;
    category?: string;
  }): MarketplaceSkillItem[] {
  const bundle = deps.getBundle();
  const bundleBySlug = new Map(bundle.skills.map((s) => [s.slug, s]));

  const installedRows = deps.db.connection
    .prepare(`SELECT * FROM projecao_habilidades_catalogo ORDER BY nome ASC;`)
    .all() as unknown as CatalogSkillRow[];

  const linkRows = deps.db.connection
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
    combined.push(deps.hydrateSkillRow(row, linksBySkill, bundleBySlug));
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
export function readSkillOp(deps: SkillsManagerDeps, slugOrId: string): SkillReadResult | null {
  const clean = slugOrId.trim();
  if (!clean) return null;

  const bundle = deps.getBundle();
  const bundleBySlug = new Map(bundle.skills.map((s) => [s.slug, s]));
  const row = deps.resolveExistingRow(clean);

  if (row) {
    const linkRows = deps.db.connection
      .prepare(`SELECT agente_id, skill_id, habilitada FROM projecao_agente_habilidades WHERE skill_id = ?;`)
      .all(row.skill_id) as unknown as AgentSkillLinkRow[];
    const linksBySkill = new Map<string, AgentSkillLinkRow[]>([[row.skill_id, linkRows]]);
    const hydrated = deps.hydrateSkillRow(row, linksBySkill, bundleBySlug);

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
