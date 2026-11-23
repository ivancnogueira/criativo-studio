import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";
import type {
  MarketplaceSkillItem,
} from "@criativo/contracts";
import { type SkillsManagerDeps, SkillsManagerError, buildSkillMarkdownDocument } from "./skills-manager-helpers.ts";
import { syncDiskAndCatalogOp, listSkillsOp, readSkillOp } from "./skills-manager-catalog.ts";

export function createCustomSkillOp(deps: SkillsManagerDeps, input: {
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

  const { slug, dirPath } = deps.resolveManagedDirForSlug(input.slug?.trim() || cleanName);

  const existing = deps.resolveExistingRow(slug);
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

  deps.db.runInTransaction(() => {
    deps.db.connection
      .prepare(
        `INSERT INTO projecao_habilidades_catalogo (
           skill_id, slug, nome, descricao, categoria, origem,
           fonte_rotulo, repositorio_url, commit_sha, caminho_pasta,
           verificada, criado_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, 'personalizada', 'Criada no estúdio', NULL, NULL, ?, 0, ?, ?);`
      )
      .run(skillId, slug, cleanName, cleanDesc, cleanCategory, dirPath, agora, agora);

    if (input.agentIds && input.agentIds.length > 0) {
      deps.linkAgentsTx(skillId, input.agentIds, agora);
    }
  });

  return readSkillOp(deps, skillId)!.skill;
}

/**
 * Atualiza instruções e metadados de habilidade local (`personalizada` | `loja` | `github`),
 * protegendo habilidades nativas do sistema contra mutação destrutiva.
 */
export function reviseSkillOp(deps: SkillsManagerDeps, slugOrId: string,
    patch: { description?: string; instructions: string; category?: string; name?: string }): MarketplaceSkillItem {
  const existing = deps.resolveExistingRow(slugOrId);
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

  const containedDir = deps.assertContainedInLojaRoot(existing.caminho_pasta);
  mkdirSync(containedDir, { recursive: true });

  const nextName = patch.name?.trim() || existing.nome;
  const nextDescription = patch.description?.trim() || existing.descricao;
  const nextCategory = patch.category?.trim() || existing.categoria;
  const markdown = buildSkillMarkdownDocument(nextName, nextDescription, cleanInstructions);

  writeFileSync(resolve(containedDir, "SKILL.md"), markdown, "utf8");

  const agora = new Date().toISOString();
  deps.db.runInTransaction(() => {
    deps.db.connection
      .prepare(
        `UPDATE projecao_habilidades_catalogo
         SET nome = ?, descricao = ?, categoria = ?, atualizado_em = ?
         WHERE skill_id = ?;`
      )
      .run(nextName, nextDescription, nextCategory, agora, existing.skill_id);
  });

  return readSkillOp(deps, existing.skill_id)!.skill;
}

/**
 * Materializa `SKILL.md` do catálogo oficial em `dados/skills-loja/<slug>/SKILL.md`,
 * registra em `projecao_habilidades_catalogo` e vincula aos agentes selecionados.
 */
export function installCatalogSkillOp(deps: SkillsManagerDeps, slugOrId: string, targetAgentIds: string[] = []): MarketplaceSkillItem {
  const clean = slugOrId.trim();
  const agora = new Date().toISOString();

  const existing = deps.resolveExistingRow(clean);
  if (existing) {
    if (targetAgentIds.length > 0) {
      deps.db.runInTransaction(() => {
        deps.linkAgentsTx(existing.skill_id, targetAgentIds, agora);
      });
    }
    return readSkillOp(deps, existing.skill_id)!.skill;
  }

  const bundle = deps.getBundle();
  const catItem = bundle.skills.find((s) => s.slug === clean || s.skillId === clean);
  if (!catItem) {
    throw new SkillsManagerError(
      `Habilidade '${slugOrId}' não encontrada no catálogo local.`,
      "SKILL_NOT_FOUND"
    );
  }

  if (catItem.source === "nativa") {
    syncDiskAndCatalogOp(deps);
    const synced = deps.resolveExistingRow(catItem.slug);
    if (synced) {
      if (targetAgentIds.length > 0) {
        deps.db.runInTransaction(() => {
          deps.linkAgentsTx(synced.skill_id, targetAgentIds, agora);
        });
      }
      return readSkillOp(deps, synced.skill_id)!.skill;
    }
  }

  const { slug, dirPath } = deps.resolveManagedDirForSlug(catItem.slug);
  mkdirSync(dirPath, { recursive: true });

  const markdown =
    bundle.skillMarkdowns[slug] ??
    buildSkillMarkdownDocument(catItem.name, catItem.description, catItem.markdownPreview);
  writeFileSync(resolve(dirPath, "SKILL.md"), markdown, "utf8");

  const skillId = catItem.skillId || `loja:${slug}`;
  deps.db.runInTransaction(() => {
    deps.db.connection
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

    const persisted = deps.resolveExistingRow(slug)!;
    if (targetAgentIds.length > 0) {
      deps.linkAgentsTx(persisted.skill_id, targetAgentIds, agora);
    }
  });

  return readSkillOp(deps, slug)!.skill;
}

/**
 * Instala habilidade externa importada (ex.: GitHub) com metadados de rastreabilidade.
 */
export function installExternalSkillOp(deps: SkillsManagerDeps, input: {
    slug: string;
    name: string;
    description: string;
    category?: string;
    markdown: string;
    repositoryUrl: string;
    commitSha: string;
    targetAgentIds?: string[];
  }): MarketplaceSkillItem {
  const { slug, dirPath } = deps.resolveManagedDirForSlug(input.slug);
  const existing = deps.resolveExistingRow(slug);
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

  deps.db.runInTransaction(() => {
    deps.db.connection
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

    const persisted = deps.resolveExistingRow(slug)!;
    if (input.targetAgentIds && input.targetAgentIds.length > 0) {
      deps.linkAgentsTx(persisted.skill_id, input.targetAgentIds, agora);
    }
  });

  return readSkillOp(deps, slug)!.skill;
}

/**
 * Substitui em transação SQLite o conjunto de agentes vinculados a uma habilidade,
 * retornando `{ previousAgentIds, currentAgentIds }` para o fluxo de `Desfazer vínculo` (6s).
 */
export function setSkillAgentsBatchOp(deps: SkillsManagerDeps, skillIdOrSlug: string,
    nextAgentIds: string[]): {
  skillId: string;
  slug: string;
  previousAgentIds: string[];
  currentAgentIds: string[];
} {
  let row = deps.resolveExistingRow(skillIdOrSlug);
  if (!row) {
    // Materializa automaticamente caso seja habilidade do catálogo ainda não instalada
    installCatalogSkillOp(deps, skillIdOrSlug, []);
    row = deps.resolveExistingRow(skillIdOrSlug);
  }
  if (!row) {
    throw new SkillsManagerError(`Habilidade '${skillIdOrSlug}' não encontrada.`, "SKILL_NOT_FOUND");
  }

  const validNextIds = deps.filterValidAgentIds(nextAgentIds);
  const agora = new Date().toISOString();
  let previousAgentIds: string[] = [];

  deps.db.runInTransaction(() => {
    const currentRows = deps.db.connection
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

    deps.db.connection
      .prepare(`DELETE FROM projecao_agente_habilidades WHERE skill_id = ?;`)
      .run(row!.skill_id);

    const insertStmt = deps.db.connection.prepare(
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
export function setSkillEnabledForAgentOp(deps: SkillsManagerDeps, agenteId: string,
    skillIdOrSlug: string,
    habilitada: boolean): { agenteId: string; skillId: string; habilitada: boolean } {
  const cleanAgentId = agenteId.trim();
  const agentExists = deps.db.connection
    .prepare(`SELECT 1 FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
    .get(cleanAgentId);
  if (!agentExists) {
    throw new SkillsManagerError(`Agente '${cleanAgentId}' não encontrado.`, "AGENT_NOT_FOUND");
  }

  let row = deps.resolveExistingRow(skillIdOrSlug);
  if (!row) {
    installCatalogSkillOp(deps, skillIdOrSlug, []);
    row = deps.resolveExistingRow(skillIdOrSlug);
  }
  if (!row) {
    throw new SkillsManagerError(`Habilidade '${skillIdOrSlug}' não encontrada.`, "SKILL_NOT_FOUND");
  }

  const agora = new Date().toISOString();
  const enabledBit = habilitada ? 1 : 0;

  deps.db.runInTransaction(() => {
    deps.db.connection
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
export function uninstallSkillOp(deps: SkillsManagerDeps, skillIdOrSlug: string): {
  removed: boolean;
  skillId?: string;
  slug?: string;
} {
  const existing = deps.resolveExistingRow(skillIdOrSlug);
  if (!existing) {
    return { removed: false };
  }

  if (existing.origem === "nativa") {
    throw new SkillsManagerError(
      "Habilidades nativas do CriativoOS não podem ser desinstaladas.",
      "NATIVE_SKILL_PROTECTED"
    );
  }

  const containedDir = deps.assertContainedInLojaRoot(existing.caminho_pasta);

  deps.db.runInTransaction(() => {
    deps.db.connection
      .prepare(`DELETE FROM projecao_agente_habilidades WHERE skill_id = ?;`)
      .run(existing.skill_id);
    deps.db.connection
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
