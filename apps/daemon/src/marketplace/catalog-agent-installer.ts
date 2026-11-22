import { randomUUID } from "node:crypto";
import type {
  AvatarShape,
  MarketplaceAgentPackage,
  MarketplaceAgentRoutineTemplate,
  MarketplaceSkillItem,
} from "@criativo/contracts";
import { computeNextCronExecution } from "../routines/cron-scheduler.ts";
import { interpolateBrandPlaceholders } from "../server/brand-onboarding-service.ts";
import {
  CatalogServiceError,
  convertRoutineScheduleToCron,
  sanitizeAgentIdBase,
  sanitizeMcpIdSegment,
  type CatalogServiceDeps,
  type ExportedAgentTemplate,
  type InstallAgentOverrides,
  type InstalledAgentRecord,
  type InstalledAgentResult,
} from "./catalog-types.ts";

export function catalog_allocateUniqueAgentId(
  deps: CatalogServiceDeps,baseCandidate: string): string {
    const base = sanitizeAgentIdBase(baseCandidate);
    const existingRows = deps.db.connection
      .prepare(`SELECT agente_id FROM projecao_agentes;`)
      .all() as Array<{ agente_id: string }>;
    const existingSet = new Set(existingRows.map((r) => r.agente_id));

    if (!existingSet.has(base)) {
      return base;
    }

    for (let i = 2; i < 10_000; i += 1) {
      const candidate = `${base}_${i}`;
      if (!existingSet.has(candidate)) {
        return candidate;
      }
    }

    return `${base}_${randomUUID().slice(0, 6)}`;
  }

  /**
   * Instala um agente do catálogo (ou manifesto validado) em 1 clique para `projecao_agentes`,
   * instala/vincula suas habilidades em `projecao_agente_habilidades` e cria rotinas associadas.
   */
export function catalog_installAgentPackage(
  deps: CatalogServiceDeps,
    slugOrPayload: string | Partial<MarketplaceAgentPackage>,
    overrides: InstallAgentOverrides = {}
  ): InstalledAgentResult {
    const bundle = deps.getBundle();
    const pkg: MarketplaceAgentPackage | null =
      typeof slugOrPayload === "string"
        ? bundle.agents.find((a) => a.slug === slugOrPayload.trim()) ?? null
        : {
            slug: slugOrPayload.slug?.trim() || sanitizeMcpIdSegment(slugOrPayload.name || "agente"),
            name: slugOrPayload.name?.trim() || "Agente Importado",
            role: slugOrPayload.role?.trim() || "Especialista do Estúdio",
            tagline: slugOrPayload.tagline?.trim() || slugOrPayload.role?.trim() || "Agente instalado pela Loja",
            description: slugOrPayload.description?.trim() || slugOrPayload.tagline?.trim() || "",
            category: slugOrPayload.category?.trim() || "Operações",
            source: slugOrPayload.source === "verified" ? "verified" : "public",
            verified: Boolean(slugOrPayload.verified),
            featured: Boolean(slugOrPayload.featured),
            recommendedModel: slugOrPayload.recommendedModel?.trim() || "gemini-2.5-pro",
            avatarShape: (slugOrPayload.avatarShape ?? "rounded_square") as AvatarShape,
            avatarColor: slugOrPayload.avatarColor?.trim() || "#007CF7",
            promptBase:
              slugOrPayload.promptBase?.trim() ||
              `Você é ${slugOrPayload.name?.trim() || "um agente especialista"} atuando para [NOME_DA_MARCA] ([@SEU_PERFIL]).`,
            skills: Array.isArray(slugOrPayload.skills)
              ? slugOrPayload.skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              : [],
            routines: Array.isArray(slugOrPayload.routines) ? slugOrPayload.routines : [],
            mcpSlugs: Array.isArray(slugOrPayload.mcpSlugs)
              ? slugOrPayload.mcpSlugs.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
              : [],
          };

    if (!pkg) {
      throw new CatalogServiceError(
        `Pacote de agente '${String(slugOrPayload)}' não encontrado no catálogo.`,
        "AGENT_PACKAGE_NOT_FOUND"
      );
    }

    const configuredBrand = deps.resolveConfiguredBrand();
    const agenteId = catalog_allocateUniqueAgentId(deps, overrides.customAgenteId || pkg.slug || pkg.name);
    const nome = overrides.name?.trim() || pkg.name;
    const rawPapel = pkg.role || pkg.tagline || "Especialista";
    const papel = configuredBrand ? interpolateBrandPlaceholders(rawPapel, configuredBrand) : rawPapel;
    const rawPromptBase = pkg.promptBase;
    const resolvedPromptBase = configuredBrand
      ? interpolateBrandPlaceholders(rawPromptBase, configuredBrand)
      : rawPromptBase;
    const resolvedTagline = configuredBrand
      ? interpolateBrandPlaceholders(pkg.tagline, configuredBrand)
      : pkg.tagline;
    const welcomeMessage = configuredBrand
      ? interpolateBrandPlaceholders(
          `Olá! Sou **${nome}** (${papel}). ${resolvedTagline}\n\nEstou pronto para colaborar com [NOME_DA_MARCA].`,
          configuredBrand
        )
      : `Olá! Sou **${nome}** (${papel}). ${pkg.tagline}\n\nEstou pronto para colaborar com [NOME_DA_MARCA].`;
    const modeloPadrao = overrides.model?.trim() || pkg.recommendedModel || "gemini-2.5-pro";
    const agora = new Date().toISOString();

    const maxOrderRow = deps.db.connection
      .prepare(`SELECT COALESCE(MAX(ordem_exibicao), 15) AS max_ordem FROM projecao_agentes;`)
      .get() as { max_ordem?: number } | undefined;
    const ordemExibicao = Number(maxOrderRow?.max_ordem ?? 15) + 1;

    const primarySkillSlug = pkg.skills[0] ?? pkg.slug;
    const configJson = {
      frente: "custom",
      pacote: "loja",
      pasta: overrides.pasta?.trim() || "Agentes da Loja",
      skill_slug: primarySkillSlug,
      avatar_shape: pkg.avatarShape || "rounded_square",
      avatar_color: pkg.avatarColor || "#007CF7",
      effort: "alto",
      ferramentas: ["handoff_agente"],
      prompt_base: resolvedPromptBase,
      customizado: true,
      origem_loja_slug: pkg.slug,
      categoria_loja: pkg.category,
      mcp_slugs: pkg.mcpSlugs ?? [],
    };

    const skillsPathsJson = pkg.skills.map((s) => `dados/skills-loja/${s}/SKILL.md`);

    const createdRoutines: InstalledAgentResult["createdRoutines"] = [];

    deps.db.runInTransaction(() => {
      deps.db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status,
             skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
           ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?);`
        )
        .run(
          agenteId,
          nome,
          papel,
          modeloPadrao,
          JSON.stringify(skillsPathsJson),
          ordemExibicao,
          JSON.stringify(configJson),
          agora
        );

      deps.db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
             mensagem_id, canal_id, agente_id, autor, autor_nome,
             conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em
           ) VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', NULL, 0, ?);`
        )
        .run(
          `msg-${randomUUID()}`,
          `agente:${agenteId}`,
          agenteId,
          nome,
          welcomeMessage,
          agora
        );

      for (const routine of pkg.routines ?? []) {
        if (!routine || typeof routine.name !== "string" || !routine.name.trim()) continue;
        const rotinaId = `rotina-${agenteId}-${randomUUID().slice(0, 6)}`;
        const expressaoCron = convertRoutineScheduleToCron(routine.schedule);
        const timezone = "America/Sao_Paulo";
        const proximaExecucao = computeNextCronExecution(
          expressaoCron,
          new Date(),
          timezone
        ).toISOString();
        const ativa =
          overrides.activateRoutines !== undefined ? overrides.activateRoutines : routine.active !== false;

        deps.db.connection
          .prepare(
            `INSERT INTO projecao_rotinas (
               rotina_id, titulo, expressao_cron, tipo_tarefa, ativa, timezone,
               payload_modelo_json, proxima_execucao_em, criado_em
             ) VALUES (?, ?, ?, 'execucao_agente', ?, ?, ?, ?, ?);`
          )
          .run(
            rotinaId,
            routine.name.trim(),
            expressaoCron,
            ativa ? 1 : 0,
            timezone,
            JSON.stringify({
              agente_id: agenteId,
              instrucao: routine.instruction ?? "",
              origem_loja_slug: pkg.slug,
            }),
            proximaExecucao,
            agora
          );

        createdRoutines.push({
          rotina_id: rotinaId,
          titulo: routine.name.trim(),
          expressao_cron: expressaoCron,
          ativa,
        });
      }
    });

    // Sincroniza e instala/vincula todas as habilidades associadas ao agente
    const installedSkills: MarketplaceSkillItem[] = [];
    for (const skillSlug of pkg.skills ?? []) {
      const cleanSlug = skillSlug.trim();
      if (!cleanSlug) continue;
      try {
        const installed = deps.skillsManager.installCatalogSkill(cleanSlug, [agenteId]);
        installedSkills.push(installed);
      } catch {
        // Ignora skill externa ausente no catálogo sem abortar criação do agente
      }
    }

    const agente = deps.db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as unknown as InstalledAgentRecord;

    return {
      agente,
      installedSkills,
      createdRoutines,
    };
  }

  /**
   * Exporta um agente do estúdio em manifesto JSON limpo (sem segredos/tokens),
   * incluindo `promptBase`, `recommendedModel`, habilidades vinculadas e rotinas associadas.
   */
export function catalog_exportAgentTemplate(
  deps: CatalogServiceDeps,agenteId: string): ExportedAgentTemplate {
    const cleanId = agenteId.trim();
    const row = deps.db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(cleanId) as InstalledAgentRecord | undefined;

    if (!row) {
      throw new CatalogServiceError(`Agente '${cleanId}' não encontrado.`, "AGENT_NOT_FOUND");
    }

    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      cfg = {};
    }

    const linkedSkillsRows = deps.db.connection
      .prepare(
        `SELECT c.slug
         FROM projecao_agente_habilidades ah
         JOIN projecao_habilidades_catalogo c ON c.skill_id = ah.skill_id
         WHERE ah.agente_id = ?
         ORDER BY ah.instalada_em ASC, c.slug ASC;`
      )
      .all(cleanId) as Array<{ slug: string }>;

    const skillSlugs = Array.from(
      new Set([
        ...linkedSkillsRows.map((r) => r.slug),
        ...(typeof cfg.skill_slug === "string" && cfg.skill_slug.trim() ? [cfg.skill_slug.trim()] : []),
      ])
    );

    const routineRows = deps.db.connection
      .prepare(`SELECT * FROM projecao_rotinas ORDER BY criado_em ASC;`)
      .all() as Array<{
      rotina_id: string;
      titulo: string;
      expressao_cron: string;
      ativa: number;
      payload_modelo_json: string;
    }>;

    const routines: MarketplaceAgentRoutineTemplate[] = [];
    for (const r of routineRows) {
      try {
        const payload = JSON.parse(r.payload_modelo_json || "{}") as {
          agente_id?: string;
          instrucao?: string;
        };
        if (payload.agente_id === cleanId) {
          routines.push({
            name: r.titulo,
            instruction: typeof payload.instrucao === "string" ? payload.instrucao : "",
            active: r.ativa === 1,
            schedule: {
              kind: "cron",
              cron: r.expressao_cron,
            },
          });
        }
      } catch {
        // Ignora rotina com payload malformado
      }
    }

    const mcpSlugs = Array.isArray(cfg.mcp_slugs)
      ? cfg.mcp_slugs.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : [];

    const promptBase =
      typeof cfg.prompt_base === "string" && cfg.prompt_base.trim()
        ? cfg.prompt_base.trim()
        : `Você é ${row.nome}. ${row.papel}`;

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedFromAgentId: row.agente_id,
      slug: sanitizeMcpIdSegment(row.agente_id) || "agente-exportado",
      name: row.nome,
      role: row.papel,
      tagline: row.papel,
      description: `Agente exportado do Criativo AI Studio (${row.nome}).`,
      category: typeof cfg.categoria_loja === "string" ? cfg.categoria_loja : "Operações",
      source: "public",
      verified: false,
      featured: false,
      recommendedModel: row.modelo_padrao,
      avatarShape: (typeof cfg.avatar_shape === "string"
        ? cfg.avatar_shape
        : "rounded_square") as AvatarShape,
      avatarColor: typeof cfg.avatar_color === "string" ? cfg.avatar_color : "#007CF7",
      promptBase,
      skills: skillSlugs,
      routines,
      mcpSlugs,
    };
  }

  /**
   * Duplica um agente existente (base ou customizado) em 1 clique no SQLite,
   * preservando `prompt_base`, `modelo_padrao`, aparência, habilidades e rotinas associadas.
   */
export function catalog_duplicateAgent(
  deps: CatalogServiceDeps,agenteId: string, newName?: string): InstalledAgentResult {
    const template = catalog_exportAgentTemplate(deps, agenteId);
    const targetName = newName?.trim() || `${template.name} (Cópia)`;

    const result = catalog_installAgentPackage(deps, 
      {
        ...template,
        slug: `${template.slug}-copia`,
        name: targetName,
      },
      {
        name: targetName,
        pasta: "Agentes Customizados",
      }
    );

    // Garante vínculo de eventuais habilidades já existentes no SQLite (ex.: personalizadas/github)
    // que não vieram do catalog-bundle.json
    const agora = new Date().toISOString();
    const extraSkillIds = deps.db.connection
      .prepare(`SELECT skill_id, habilitada FROM projecao_agente_habilidades WHERE agente_id = ?;`)
      .all(agenteId) as Array<{ skill_id: string; habilitada: number }>;

    if (extraSkillIds.length > 0) {
      deps.db.runInTransaction(() => {
        const stmt = deps.db.connection.prepare(
          `INSERT OR IGNORE INTO projecao_agente_habilidades (
             agente_id, skill_id, habilitada, instalada_em, atualizado_em
           ) VALUES (?, ?, ?, ?, ?);`
        );
        for (const item of extraSkillIds) {
          stmt.run(result.agente.agente_id, item.skill_id, item.habilitada, agora, agora);
        }
      });
    }

    const refreshedSkills = deps.skillsManager.listSkills({ agentId: result.agente.agente_id });
    return {
      ...result,
      installedSkills: refreshedSkills,
    };
  }
