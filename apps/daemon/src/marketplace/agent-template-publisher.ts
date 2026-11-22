import { createHash, randomUUID } from "node:crypto";
import type { AgentTemplatePackage } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const FORBIDDEN_SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{12,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /EAA[a-zA-Z0-9]{20,}/,
  /[a-zA-Z]:\\Users\\/i,
  /\/Users\/[a-zA-Z0-9._-]+\//i,
  /\/home\/[a-zA-Z0-9._-]+\//i,
];

export class TemplateValidationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "TemplateValidationError";
    this.statusCode = statusCode;
  }
}

export function sanitizeTemplateText(raw: string): string {
  return raw
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, "[TOKEN_REMOVIDO]")
    .replace(/ghp_[a-zA-Z0-9]{20,}/g, "[TOKEN_REMOVIDO]")
    .replace(/EAA[a-zA-Z0-9]{20,}/g, "[TOKEN_REMOVIDO]")
    .replace(/[a-zA-Z]:\\Users\\[^\s"'`]+/gi, "[CAMINHO_LOCAL]")
    .replace(/\/(Users|home)\/[^\s"'`]+/gi, "[CAMINHO_LOCAL]");
}

export function computeAgentTemplateSha256(
  pkg: Omit<AgentTemplatePackage, "sha256">,
): string {
  const canonical = JSON.stringify({
    schema_version: pkg.schema_version,
    template_id: pkg.template_id,
    name: pkg.name,
    role: pkg.role,
    version: pkg.version,
    author_display: pkg.author_display,
    description: pkg.description,
    created_at: pkg.created_at,
    skills: [...pkg.skills].sort(),
    config_sanitized: {
      modelo_padrao: pkg.config_sanitized.modelo_padrao ?? null,
      temperatura: pkg.config_sanitized.temperatura ?? null,
      max_tokens: pkg.config_sanitized.max_tokens ?? null,
      nivel_esforco: pkg.config_sanitized.nivel_esforco ?? null,
      cua_enabled: Boolean(pkg.config_sanitized.cua_enabled),
      system_prompt: pkg.config_sanitized.system_prompt ?? null,
    },
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function assertCleanRoomTemplateContent(pkg: AgentTemplatePackage): void {
  const serialized = JSON.stringify(pkg);
  for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new TemplateValidationError(
        "Pacote rejeitado por conter padrão de caminho local ou segredo proibido.",
        400,
      );
    }
  }
}

/**
 * Exportador e instalador versionado de templates de agentes com verificação SHA-256 (G-23).
 */
export class AgentTemplatePublisher {
  private readonly db: CriativoDatabase;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { db: CriativoDatabase; fetchImpl?: typeof fetch }) {
    this.db = options.db;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public exportAgentTemplate(params: {
    agenteId: string;
    version?: string;
    authorDisplay?: string;
    description?: string;
  }): AgentTemplatePackage {
    const version = (params.version ?? "1.0.0").trim();
    if (!SEMVER_REGEX.test(version)) {
      throw new TemplateValidationError("Versão semver inválida (use X.Y.Z).", 400);
    }

    const row = this.db.connection
      .prepare(
        "SELECT agente_id, nome, papel, modelo_padrao, skills_paths_json, config_json FROM projecao_agentes WHERE agente_id = ?;",
      )
      .get(params.agenteId) as
      | {
          agente_id: string;
          nome: string;
          papel: string;
          modelo_padrao?: string | null;
          skills_paths_json?: string | null;
          config_json?: string | null;
        }
      | undefined;

    if (!row) {
      throw new TemplateValidationError(`Agente '${params.agenteId}' não encontrado para exportação.`, 404);
    }

    let rawSkills: string[] = [];
    try {
      const parsed = JSON.parse(row.skills_paths_json || "[]") as unknown[];
      if (Array.isArray(parsed)) {
        rawSkills = parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeTemplateText(item))
          .filter((item) => !item.includes("[CAMINHO_LOCAL]"));
      }
    } catch {
      rawSkills = [];
    }

    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      cfg = {};
    }

    const systemPromptRaw = typeof cfg.system_prompt === "string" ? sanitizeTemplateText(cfg.system_prompt) : undefined;
    const basePkg: Omit<AgentTemplatePackage, "sha256"> = {
      schema_version: 1,
      template_id: `tpl-${row.agente_id}-${version}`,
      name: sanitizeTemplateText(row.nome),
      role: sanitizeTemplateText(row.papel),
      version,
      author_display: sanitizeTemplateText((params.authorDisplay ?? "Criativo Creator").trim() || "Criativo Creator"),
      description: sanitizeTemplateText(
        (params.description ?? `Template versionado do agente ${row.papel}`).trim(),
      ),
      created_at: new Date().toISOString(),
      skills: rawSkills,
      config_sanitized: {
        ...(row.modelo_padrao ? { modelo_padrao: row.modelo_padrao } : {}),
        ...(typeof cfg.temperatura === "number" ? { temperatura: cfg.temperatura } : {}),
        ...(typeof cfg.max_tokens === "number" ? { max_tokens: cfg.max_tokens } : {}),
        ...(cfg.nivel_esforco === "low" ||
        cfg.nivel_esforco === "medium" ||
        cfg.nivel_esforco === "high" ||
        cfg.nivel_esforco === "xhigh"
          ? { nivel_esforco: cfg.nivel_esforco }
          : {}),
        cua_enabled: false,
        ...(systemPromptRaw ? { system_prompt: systemPromptRaw } : {}),
      },
    };

    const sha256 = computeAgentTemplateSha256(basePkg);
    return { ...basePkg, sha256 };
  }

  public validateTemplatePackage(raw: unknown): AgentTemplatePackage {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TemplateValidationError("Pacote de template inválido.", 400);
    }
    const obj = raw as Record<string, unknown>;
    if (obj.schema_version !== 1) {
      throw new TemplateValidationError("Versão de schema de template não suportada.", 400);
    }
    const version = String(obj.version ?? "").trim();
    if (!SEMVER_REGEX.test(version)) {
      throw new TemplateValidationError("Versão semver inválida no pacote.", 400);
    }
    const expectedHash = String(obj.sha256 ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new TemplateValidationError("Campo sha256 ausente ou malformado.", 400);
    }

    const pkgWithoutHash: Omit<AgentTemplatePackage, "sha256"> = {
      schema_version: 1,
      template_id: String(obj.template_id ?? ""),
      name: String(obj.name ?? "").trim(),
      role: String(obj.role ?? "").trim(),
      version,
      author_display: String(obj.author_display ?? "").trim(),
      description: String(obj.description ?? "").trim(),
      created_at: String(obj.created_at ?? ""),
      skills: Array.isArray(obj.skills) ? obj.skills.map((s) => String(s)) : [],
      config_sanitized:
        obj.config_sanitized && typeof obj.config_sanitized === "object"
          ? (obj.config_sanitized as AgentTemplatePackage["config_sanitized"])
          : {},
    };

    if (!pkgWithoutHash.template_id || !pkgWithoutHash.name || !pkgWithoutHash.role) {
      throw new TemplateValidationError("Metadados obrigatórios ausentes no template.", 400);
    }

    const computed = computeAgentTemplateSha256(pkgWithoutHash);
    if (computed !== expectedHash) {
      throw new TemplateValidationError(
        `Verificação SHA-256 falhou para o template '${pkgWithoutHash.template_id}'.`,
        400,
      );
    }

    const validated: AgentTemplatePackage = { ...pkgWithoutHash, sha256: expectedHash };
    assertCleanRoomTemplateContent(validated);
    return validated;
  }

  public installTemplatePackage(params: {
    pkg: unknown;
    agenteIdOverride?: string;
  }): { agente_id: string; template_id: string; version: string; sha256: string } {
    const validated = this.validateTemplatePackage(params.pkg);
    const rawId =
      params.agenteIdOverride?.trim() ||
      `tpl_${validated.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")}_${randomUUID().slice(0, 4)}`;

    const configToSave = {
      ...validated.config_sanitized,
      cua_enabled: false,
      installed_from_template: {
        template_id: validated.template_id,
        version: validated.version,
        sha256: validated.sha256,
        installed_at: new Date().toISOString(),
      },
    };

    const existing = this.db.connection
      .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ?;")
      .get(rawId) as { agente_id: string } | undefined;

    const now = new Date().toISOString();
    if (existing) {
      this.db.connection
        .prepare(
          "UPDATE projecao_agentes SET nome = ?, papel = ?, modelo_padrao = ?, skills_paths_json = ?, config_json = ?, atualizado_em = ? WHERE agente_id = ?;",
        )
        .run(
          validated.name,
          validated.role,
          validated.config_sanitized.modelo_padrao ?? "gemini-2.5-flash",
          JSON.stringify(validated.skills),
          JSON.stringify(configToSave),
          now,
          rawId,
        );
    } else {
      const countRow = this.db.connection
        .prepare("SELECT COUNT(*) as total FROM projecao_agentes;")
        .get() as { total: number };
      this.db.connection
        .prepare(
          "INSERT INTO projecao_agentes (agente_id, nome, papel, modelo_padrao, status, skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em) VALUES (?, ?, ?, ?, 'ocioso', ?, '', ?, ?, ?);",
        )
        .run(
          rawId,
          validated.name,
          validated.role,
          validated.config_sanitized.modelo_padrao ?? "gemini-2.5-flash",
          JSON.stringify(validated.skills),
          (countRow?.total ?? 0) + 1,
          JSON.stringify(configToSave),
          now,
        );
    }

    return {
      agente_id: rawId,
      template_id: validated.template_id,
      version: validated.version,
      sha256: validated.sha256,
    };
  }

  public async installFromUrl(sourceUrl: string, agenteIdOverride?: string) {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new TemplateValidationError("URL de template inválida.", 400);
    }
    const isLocalhost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
      throw new TemplateValidationError("Somente URLs HTTPS (ou localhost) são permitidas para templates.", 400);
    }
    const res = await this.fetchImpl(parsed.toString());
    if (!res.ok) {
      throw new TemplateValidationError(`Falha ao baixar template HTTP ${res.status}.`, 502);
    }
    const rawPkg = (await res.json()) as unknown;
    return this.installTemplatePackage({ pkg: rawPkg, agenteIdOverride });
  }
}
