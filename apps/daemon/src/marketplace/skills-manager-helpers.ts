import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";
import type {
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceSkillItem,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";

export interface CatalogBundleData {
  schemaVersion: number;
  generatedAt: string;
  apps: MarketplaceAppItem[];
  agents: MarketplaceAgentPackage[];
  skills: MarketplaceSkillItem[];
  skillMarkdowns: Record<string, string>;
}

export interface CatalogSkillRow {
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

export interface AgentSkillLinkRow {
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

export const catalogBundleCache = new Map<string, CatalogBundleData>();

export function resolveCatalogBundlePath(options?: {
  workspaceRoot?: string;
  productRoot?: string;
  bundlePath?: string;
}): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = options?.workspaceRoot ? resolve(options.workspaceRoot) : process.cwd();
  const productRoot = options?.productRoot
    ? resolve(options.productRoot)
    : process.env.CRIATIVO_PRODUCT_ROOT
      ? resolve(process.env.CRIATIVO_PRODUCT_ROOT)
      : null;

  const candidates = [
    options?.bundlePath ? resolve(options.bundlePath) : null,
    productRoot ? resolve(productRoot, "apps", "daemon", "src", "marketplace", "catalog", "catalog-bundle.json") : null,
    productRoot ? resolve(productRoot, "catalog-bundle.json") : null,
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
  productRoot?: string;
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

export function buildSkillMarkdownDocument(
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
  productRoot?: string;
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

export interface SkillsManagerDeps {
  db: CriativoDatabase;
  workspaceRoot: string;
  productRoot: string | null;
  skillsLojaRoot: string;
  getBundle: () => CatalogBundleData;
  getNativeSkillsDirs: () => string[];
  assertContainedInLojaRoot: (targetPath: string) => string;
  resolveManagedDirForSlug: (rawSlug: string) => { slug: string; dirPath: string };
  resolveExistingRow: (slugOrId: string) => CatalogSkillRow | null;
  filterValidAgentIds: (agentIds?: string[]) => string[];
  linkAgentsTx: (skillId: string, agentIds: string[], nowIso: string) => void;
  hydrateSkillRow: (
    row: CatalogSkillRow,
    linksBySkillId: Map<string, AgentSkillLinkRow[]>,
    bundleBySlug: Map<string, CatalogBundleData["skills"][number]>,
  ) => MarketplaceSkillItem;
}

export type TailArgs<F> = F extends (deps: SkillsManagerDeps, ...args: infer A) => unknown ? A : never;
