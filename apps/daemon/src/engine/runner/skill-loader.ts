import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROSTER_15_AGENTES, type AgenteDefinicao } from "./roster-defaults.ts";

export interface CompiledAgentSkill {
  agente_id: string;
  nome: string;
  skillSlug: string;
  sourceFilePath: string | null;
  frontmatter: Record<string, string>;
  systemPrompt: string;
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
 * Carrega e compila as instruções Markdown das 15 skills oficiais do estúdio.
 */
export class SkillLoader {
  private readonly searchRoots: string[];

  constructor(searchRoots: string[] = []) {
    this.searchRoots = [
      ...searchRoots,
      resolve(process.cwd(), ".agents", "skills"),
      resolve(process.cwd(), "..", "..", ".agents", "skills"),
      process.cwd(),
      resolve(process.cwd(), ".."),
      resolve(process.cwd(), "..", "criativo-ai-studio"),
    ];
  }

  public getDefinition(agenteId: string): AgenteDefinicao {
    const found = ROSTER_15_AGENTES.find((a) => a.agente_id === agenteId);
    if (!found) {
      throw new Error(`Agente desconhecido no roster oficial de 15 especialistas: '${agenteId}'`);
    }
    return found;
  }

  public resolveSkillFilePath(def: AgenteDefinicao, customPaths: string[] = []): string | null {
    const candidates: string[] = [];

    for (const p of [...customPaths, ...def.skills_paths]) {
      candidates.push(p);
    }

    for (const root of this.searchRoots) {
      candidates.push(resolve(root, def.skill_slug, "SKILL.md"));
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

  public loadAgentSkill(
    agenteId: string,
    options: { customPaths?: string[]; memoriaContexto?: string[] } = {}
  ): CompiledAgentSkill {
    const def = this.getDefinition(agenteId);
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
    };
  }
}
