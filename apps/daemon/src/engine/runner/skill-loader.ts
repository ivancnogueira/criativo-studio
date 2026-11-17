import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AvatarShape, FrenteAgente, NivelEsforco } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import { ROSTER_15_AGENTES, type AgenteDefinicao } from "./roster-defaults.ts";

export interface LinkedAgentSkillInfo {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  origin: string;
  sourceFilePath: string | null;
  frontmatter: Record<string, string>;
  body: string;
}

export interface CompiledAgentSkill {
  agente_id: string;
  nome: string;
  skillSlug: string;
  sourceFilePath: string | null;
  frontmatter: Record<string, string>;
  systemPrompt: string;
  linkedSkills?: LinkedAgentSkillInfo[];
}

/**
 * Extrai frontmatter YAML simples (key: value) e o corpo Markdown de um arquivo SKILL.md.
 */
export function parseSkillMarkdown(rawMarkdown: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: rawMarkdown.trim() };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) {
      frontmatter[key] = val;
    }
  }

  return {
    frontmatter,
    body: match[2].trim(),
  };
}

/**
 * Carrega e compila as instruções Markdown das skills oficiais e vinculadas aos agentes do estúdio.
 */
export class SkillLoader {
  private readonly searchRoots: string[];

  constructor(searchRoots: string[] = [], workspaceRoot?: string) {
    const derivedLojaRoots = workspaceRoot
      ? [
          resolve(workspaceRoot, "dados", "skills-loja"),
          resolve(workspaceRoot, ".agents", "skills"),
          resolve(workspaceRoot),
        ]
      : [];

    this.searchRoots = Array.from(
      new Set([
        ...searchRoots,
        ...derivedLojaRoots,
        resolve(process.cwd(), "dados", "skills-loja"),
        resolve(process.cwd(), "apps", "daemon", "dados", "skills-loja"),
        resolve(process.cwd(), ".agents", "skills"),
        resolve(process.cwd(), "..", "..", ".agents", "skills"),
        process.cwd(),
        resolve(process.cwd(), ".."),
        resolve(process.cwd(), "..", "criativo-ai-studio"),
      ])
    );
  }

  public getDefinition(agenteId: string, db?: CriativoDatabase): AgenteDefinicao {
    const found = ROSTER_15_AGENTES.find((a) => a.agente_id === agenteId);
    if (found) {
      return found;
    }

    if (db) {
      try {
        const row = db.connection
          .prepare(
            `SELECT agente_id, nome, papel, modelo_padrao, skills_paths_json, ordem_exibicao, config_json
             FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`
          )
          .get(agenteId) as
          | {
              agente_id: string;
              nome: string;
              papel: string;
              modelo_padrao: string;
              skills_paths_json: string;
              ordem_exibicao: number;
              config_json: string;
            }
          | undefined;

        if (row) {
          let parsedConfig: Record<string, unknown> = {};
          let parsedPaths: string[] = [];
          try {
            parsedConfig = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
          } catch {
            parsedConfig = {};
          }
          try {
            const rawPaths = JSON.parse(row.skills_paths_json || "[]") as unknown;
            if (Array.isArray(rawPaths)) {
              parsedPaths = rawPaths.filter((p): p is string => typeof p === "string");
            }
          } catch {
            parsedPaths = [];
          }

          return {
            agente_id: row.agente_id,
            nome: row.nome,
            papel: row.papel,
            frente: (typeof parsedConfig.frente === "string"
              ? parsedConfig.frente
              : "custom") as FrenteAgente,
            pacote: "base",
            pasta:
              typeof parsedConfig.pasta === "string"
                ? parsedConfig.pasta
                : "Agentes Customizados",
            skill_slug:
              typeof parsedConfig.skill_slug === "string" && parsedConfig.skill_slug.trim()
                ? parsedConfig.skill_slug.trim()
                : row.agente_id,
            modelo_padrao: row.modelo_padrao,
            avatar_shape: (typeof parsedConfig.avatar_shape === "string"
              ? parsedConfig.avatar_shape
              : "rounded_square") as AvatarShape,
            avatar_color:
              typeof parsedConfig.avatar_color === "string"
                ? parsedConfig.avatar_color
                : "#007CF7",
            effort: (typeof parsedConfig.effort === "string"
              ? parsedConfig.effort
              : "medio") as NivelEsforco,
            ordem_exibicao: Number(row.ordem_exibicao ?? 99),
            skills_paths: parsedPaths,
            ferramentas: Array.isArray(parsedConfig.ferramentas)
              ? parsedConfig.ferramentas.filter((t): t is string => typeof t === "string")
              : ["handoff_agente"],
            prompt_base:
              typeof parsedConfig.prompt_base === "string" && parsedConfig.prompt_base.trim()
                ? parsedConfig.prompt_base
                : `Você é ${row.nome}. ${row.papel}`,
          };
        }
      } catch {
        // Fallback para erro padrão se tabela indisponível
      }
    }

    throw new Error(`Agente desconhecido no roster oficial de 15 especialistas: '${agenteId}'`);
  }

  public resolveSkillFilePath(def: AgenteDefinicao, customPaths: string[] = []): string | null {
    const candidates: string[] = [];

    for (const p of [...customPaths, ...def.skills_paths]) {
      candidates.push(p);
    }

    for (const root of this.searchRoots) {
      candidates.push(resolve(root, def.skill_slug, "SKILL.md"));
      candidates.push(resolve(root, "dados", "skills-loja", def.skill_slug, "SKILL.md"));
      candidates.push(resolve(root, ".agents", "skills", def.skill_slug, "SKILL.md"));
      candidates.push(resolve(root, "skills", def.skill_slug, "SKILL.md"));
      for (const rel of def.skills_paths) {
        candidates.push(resolve(root, rel));
      }
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private resolveSlugFilePath(slug: string, folderHint?: string | null): string | null {
    const candidates: string[] = [];
    if (folderHint && folderHint.trim()) {
      candidates.push(resolve(folderHint.trim(), "SKILL.md"));
    }
    for (const root of this.searchRoots) {
      candidates.push(resolve(root, slug, "SKILL.md"));
      candidates.push(resolve(root, "dados", "skills-loja", slug, "SKILL.md"));
      candidates.push(resolve(root, ".agents", "skills", slug, "SKILL.md"));
      candidates.push(resolve(root, "skills", slug, "SKILL.md"));
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Carrega todas as habilidades vinculadas e habilitadas (`habilitada = 1`) ao agente em
   * `projecao_agente_habilidades JOIN projecao_habilidades_catalogo`.
   */
  public loadLinkedAgentSkills(db: CriativoDatabase, agenteId: string): LinkedAgentSkillInfo[] {
    let rows: Array<{
      skill_id: string;
      slug: string;
      nome: string;
      descricao: string;
      caminho_pasta: string;
      origem: string;
    }> = [];

    try {
      rows = db.connection
        .prepare(
          `SELECT c.skill_id, c.slug, c.nome, c.descricao, c.caminho_pasta, c.origem
           FROM projecao_agente_habilidades ah
           JOIN projecao_habilidades_catalogo c ON c.skill_id = ah.skill_id
           WHERE ah.agente_id = ? AND ah.habilitada = 1
           ORDER BY ah.instalada_em ASC, c.nome ASC;`
        )
        .all(agenteId) as typeof rows;
    } catch {
      return [];
    }

    const loaded: LinkedAgentSkillInfo[] = [];
    for (const row of rows) {
      const filePath = this.resolveSlugFilePath(row.slug, row.caminho_pasta);
      let frontmatter: Record<string, string> = {
        name: row.slug,
        description: row.descricao,
      };
      let body = row.descricao;

      if (filePath) {
        try {
          const raw = readFileSync(filePath, "utf8");
          const parsed = parseSkillMarkdown(raw);
          frontmatter = { ...frontmatter, ...parsed.frontmatter };
          if (parsed.body) {
            body = parsed.body;
          }
        } catch {
          // Mantém descrição resumida caso arquivo no disco esteja ilegível
        }
      }

      loaded.push({
        skillId: row.skill_id,
        slug: row.slug,
        name: row.nome,
        description: row.descricao,
        origin: row.origem,
        sourceFilePath: filePath,
        frontmatter,
        body,
      });
    }

    return loaded;
  }

  public loadAgentSkill(
    agenteId: string,
    options: { customPaths?: string[]; memoriaContexto?: string[]; db?: CriativoDatabase } = {}
  ): CompiledAgentSkill {
    const def = this.getDefinition(agenteId, options.db);
    const skillFile = this.resolveSkillFilePath(def, options.customPaths);

    let frontmatter: Record<string, string> = {
      name: def.skill_slug,
      description: def.papel,
    };
    let instructionsBody = def.prompt_base;

    if (skillFile) {
      const raw = readFileSync(skillFile, "utf8");
      const parsed = parseSkillMarkdown(raw);
      frontmatter = { ...frontmatter, ...parsed.frontmatter };
      if (parsed.body) {
        instructionsBody = `${def.prompt_base}\n\n## Instruções da Skill (${def.skill_slug})\n${parsed.body}`;
      }
    }

    const linkedSkills = options.db ? this.loadLinkedAgentSkills(options.db, agenteId) : [];
    const extraSkills = linkedSkills.filter((item) => item.slug !== def.skill_slug || !skillFile);
    if (extraSkills.length > 0) {
      const extraSections = extraSkills
        .map((skill) => `## Habilidade Vinculada: ${skill.name} (${skill.slug})\n${skill.body}`)
        .join("\n\n");
      instructionsBody = `${instructionsBody}\n\n${extraSections}`;
    }

    const memorySection =
      options.memoriaContexto && options.memoriaContexto.length > 0
        ? `\n\n## Memórias Persistentes do Agente\n${options.memoriaContexto.map((m) => `- ${m}`).join("\n")}`
        : "";

    const securityFooter = `\n\n## Invariantes Obrigatórias\n- Nunca publique na Meta Graph API sem approved_by_human=true.\n- Use generate_image para geração visual multimodal e mantenha proporções 3:4 (1080x1350) ou 9:16 (1080x1920).\n- Nunca exponha chaves de API em logs.`;

    return {
      agente_id: def.agente_id,
      nome: def.nome,
      skillSlug: def.skill_slug,
      sourceFilePath: skillFile,
      frontmatter,
      systemPrompt: `${instructionsBody}${memorySection}${securityFooter}`,
      linkedSkills,
    };
  }
}
