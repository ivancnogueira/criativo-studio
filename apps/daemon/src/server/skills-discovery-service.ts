import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  homedir,
} from "node:os";
import {
  join,
} from "node:path";
import type {
  HabilidadeInstaladaInfo,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  LicenseClientService,
} from "../license/license-service.ts";
import {
  isUpgradeUnlocked,
  UPGRADE_PACKAGE_SLUGS,
} from "./studio-tools-bridge.ts";

function parseSkillFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content);
  if (!match) {
    return { body: content };
  }
  const yamlBlock = match[1];
  const body = match[2];
  let name: string | undefined;
  let description: string | undefined;
  for (const line of yamlBlock.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") name = val;
    if (key === "description") description = val;
  }
  return { name, description, body };
}

function inferSkillCategory(slug: string): HabilidadeInstaladaInfo["categoria"] {
  const s = slug.toLowerCase();
  if (s.includes("video") || s.includes("reels") || s.includes("roteirista") || s.includes("story") || s.includes("stories")) {
    return s.includes("video") || s.includes("reels") || s.includes("roteirista") ? "video" : "conteudo";
  }
  if (
    s.includes("carrossel") ||
    s.includes("post") ||
    s.includes("copy") ||
    s.includes("consistencia") ||
    s.includes("identidade")
  ) {
    return "conteudo";
  }
  if (s.includes("planejar") || s.includes("metricas") || s.includes("concorrentes") || s.includes("entregaveis")) {
    return "estrategia";
  }
  if (s.includes("configurar") || s.includes("instagram") || s.includes("wp-")) {
    return "sistema";
  }
  return "outros";
}

export function getSkillUpgradePackage(slug: string): "bonus" | "video" | null {
  const clean = slug.trim();
  if ((UPGRADE_PACKAGE_SLUGS.bonus as readonly string[]).includes(clean)) return "bonus";
  if ((UPGRADE_PACKAGE_SLUGS.video as readonly string[]).includes(clean)) return "video";
  return null;
}

export interface SkillsDiscoveryOptions {
  db?: CriativoDatabase;
  licenseService?: LicenseClientService;
  productRoot?: string;
  includeExternalHome?: boolean;
}

function getSkillsRootCandidates(
  workspaceRoot?: string,
  opts?: SkillsDiscoveryOptions
): string[] {
  const home = homedir();
  const baseCwd = workspaceRoot ?? process.cwd();
  const basePrefixes = Array.from(
    new Set(
      [
        baseCwd,
        opts?.productRoot,
        process.env.CRIATIVO_PRODUCT_ROOT,
        join(baseCwd, "..", ".."),
      ].filter((p): p is string => Boolean(p && p.trim()))
    )
  );

  const roots: string[] = [];
  for (const prefix of basePrefixes) {
    roots.push(join(prefix, ".agents", "skills"));
  }

  if (opts?.db) {
    const bonusUnlocked = isUpgradeUnlocked(
      opts.db,
      baseCwd,
      "bonus",
      opts.licenseService,
      opts.productRoot
    );
    const videoUnlocked = isUpgradeUnlocked(
      opts.db,
      baseCwd,
      "video",
      opts.licenseService,
      opts.productRoot
    );

    if (bonusUnlocked) {
      for (const prefix of basePrefixes) {
        roots.push(join(prefix, ".agents", "skills-upgrades", "bonus"));
      }
    }
    if (videoUnlocked) {
      for (const prefix of basePrefixes) {
        roots.push(join(prefix, ".agents", "skills-upgrades", "video"));
      }
    }
  }

  if (opts?.includeExternalHome !== false && process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
    roots.push(join(home, ".gemini", "config", "skills"), join(home, ".agents", "skills"));
  }

  return Array.from(new Set(roots));
}

export function loadSkillPromptBySlug(
  slug: string,
  customRoot?: string,
  workspaceRoot?: string,
  opts?: SkillsDiscoveryOptions
): { path: string; body: string; tokensEst: number } | null {
  if (!slug || slug.includes("..") || slug.includes("/") || slug.includes("\\")) return null;
  if (!customRoot && opts?.db) {
    const pkg = getSkillUpgradePackage(slug);
    if (
      pkg &&
      !isUpgradeUnlocked(opts.db, workspaceRoot ?? process.cwd(), pkg, opts.licenseService, opts.productRoot)
    ) {
      return null;
    }
  }
  const roots = customRoot ? [customRoot] : getSkillsRootCandidates(workspaceRoot, opts);
  for (const root of roots) {
    const filePath = join(root, slug, "SKILL.md");
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf8");
        return {
          path: filePath,
          body: content,
          tokensEst: Math.max(80, Math.round(content.length / 4)),
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function listInstalledSkills(
  db: CriativoDatabase,
  customRoot?: string,
  workspaceRoot?: string,
  licenseService?: LicenseClientService,
  productRoot?: string
): HabilidadeInstaladaInfo[] {
  const skipLocalProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1";
  const baseCwd = workspaceRoot ?? process.cwd();
  const bonusUnlocked = isUpgradeUnlocked(db, baseCwd, "bonus", licenseService, productRoot);
  const videoUnlocked = isUpgradeUnlocked(db, baseCwd, "video", licenseService, productRoot);
  const isSkillAllowed = (slugOrId: string): boolean => {
    const pkg = getSkillUpgradePackage(slugOrId);
    if (pkg === "bonus") return bonusUnlocked;
    if (pkg === "video") return videoUnlocked;
    return true;
  };

  const roots = customRoot
    ? [customRoot]
    : getSkillsRootCandidates(workspaceRoot, {
        db,
        licenseService,
        productRoot,
        includeExternalHome: !skipLocalProbe,
      });

  const agentsRows = db.connection
    .prepare(`SELECT agente_id, nome, config_json FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
    .all() as Array<{ agente_id: string; nome: string; config_json: string }>;

  const agentNameById = new Map<string, string>();
  const agentsBySkill = new Map<string, Set<string>>();
  for (const a of agentsRows) {
    agentNameById.set(a.agente_id, a.nome);
    try {
      const cfg = JSON.parse(a.config_json) as { skill_slug?: string };
      if (cfg.skill_slug) {
        const set = agentsBySkill.get(cfg.skill_slug) ?? new Set<string>();
        set.add(a.nome);
        agentsBySkill.set(cfg.skill_slug, set);
      }
    } catch {
      // ignora config inválida
    }
  }

  // Mescla vínculos persistidos em projecao_agente_habilidades (Fase 10)
  const linkedBySlugOrId = new Map<string, Set<string>>();
  try {
    const linkRows = db.connection
      .prepare(
        `SELECT ah.agente_id, ah.skill_id, c.slug
         FROM projecao_agente_habilidades ah
         JOIN projecao_habilidades_catalogo c ON c.skill_id = ah.skill_id
         WHERE ah.habilitada = 1;`
      )
      .all() as Array<{ agente_id: string; skill_id: string; slug: string }>;
    for (const link of linkRows) {
      const agentLabel = agentNameById.get(link.agente_id) ?? link.agente_id;
      for (const key of [link.slug, link.skill_id]) {
        const set = linkedBySlugOrId.get(key) ?? new Set<string>();
        set.add(agentLabel);
        linkedBySlugOrId.set(key, set);
      }
    }
  } catch {
    // tabela pode não existir em instâncias antigas
  }

  const getAgentsForSkill = (slug: string, skillId?: string): string[] => {
    const merged = new Set<string>(agentsBySkill.get(slug) ?? []);
    for (const name of linkedBySlugOrId.get(slug) ?? []) merged.add(name);
    if (skillId) {
      for (const name of linkedBySlugOrId.get(skillId) ?? []) merged.add(name);
    }
    return Array.from(merged);
  };

  const skillsMap = new Map<string, HabilidadeInstaladaInfo>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const dir of dirs) {
        if (!customRoot && !isSkillAllowed(dir.name)) continue;
        if (skillsMap.has(dir.name)) continue;
        const skillFile = join(root, dir.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        try {
          const content = readFileSync(skillFile, "utf8");
          const parsed = parseSkillFrontmatter(content);
          const id = parsed.name || dir.name;
          if (!customRoot && !isSkillAllowed(id)) continue;
          skillsMap.set(id, {
            id,
            nome: id,
            descricao: parsed.description || "Habilidade de especialista configurada em SKILL.md.",
            categoria: inferSkillCategory(id),
            caminho: skillFile,
            agentes_vinculados: getAgentsForSkill(id),
            conteudo_preview: parsed.body.trim().slice(0, 650),
          });
        } catch {
          // ignora arquivo ilegível
        }
      }
    } catch {
      // ignora pasta ilegível
    }
  }

  // Quando não está em modo diretório customizado isolado, mescla skills da Loja / dados/skills-loja/
  if (!customRoot) {
    try {
      const catalogRows = db.connection
        .prepare(
          `SELECT skill_id, slug, nome, descricao, categoria, origem, caminho_pasta
           FROM projecao_habilidades_catalogo
           ORDER BY nome ASC;`
        )
        .all() as Array<{
        skill_id: string;
        slug: string;
        nome: string;
        descricao: string;
        categoria: string;
        origem: string;
        caminho_pasta: string;
      }>;

      for (const row of catalogRows) {
        if (!isSkillAllowed(row.slug)) continue;
        const existing = skillsMap.get(row.slug);
        if (existing) {
          const mergedAgents = new Set([
            ...existing.agentes_vinculados,
            ...getAgentsForSkill(row.slug, row.skill_id),
          ]);
          existing.agentes_vinculados = Array.from(mergedAgents);
          continue;
        }

        const skillFile = join(row.caminho_pasta, "SKILL.md");
        let preview = row.descricao;
        if (existsSync(skillFile)) {
          try {
            const parsed = parseSkillFrontmatter(readFileSync(skillFile, "utf8"));
            if (parsed.body.trim()) {
              preview = parsed.body.trim().slice(0, 650);
            }
          } catch {
            // fallback para descrição do catálogo
          }
        }

        skillsMap.set(row.slug, {
          id: row.slug,
          nome: row.nome || row.slug,
          descricao: row.descricao || "Habilidade instalada via Loja.",
          categoria: inferSkillCategory(row.slug || row.categoria),
          caminho: skillFile,
          agentes_vinculados: getAgentsForSkill(row.slug, row.skill_id),
          conteudo_preview: preview,
        });
      }
    } catch {
      // tabela pode estar ausente em bancos antigos
    }
  }

  return [...skillsMap.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

