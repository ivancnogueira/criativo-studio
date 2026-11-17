import { randomUUID } from "node:crypto";
import {
  mcpConfigErrors,
  normalizeMcpConfig,
  type McpAcessoAgentes,
  type McpOAuthStatus,
  type McpProbeResultado,
  type McpServidorConfig,
  type McpTransporte,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";
import {
  collectSensitiveSecrets,
  MASKED_SECRET_VALUE,
  maskMcpServerForClient,
  redactMcpSecrets,
  SECRET_REDACTED_PLACEHOLDER,
} from "./mcp-redaction.ts";

export class McpServerStoreError extends Error {
  public readonly fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "McpServerStoreError";
    this.fieldErrors = fieldErrors;
  }
}

interface McpServerRow {
  mcp_id: string;
  nome: string;
  transporte: string | null;
  comando: string;
  args_json: string;
  env_json: string;
  env_passthrough_json: string | null;
  working_directory: string | null;
  url: string | null;
  headers_json: string | null;
  acesso_json: string | null;
  origem_app_slug: string | null;
  conta_rotulo: string | null;
  posicao: number | null;
  ativo: number;
  ultimo_teste_em: string | null;
  ultimo_erro: string | null;
  qtd_ferramentas: number | null;
  atualizado_em: string;
}

interface OAuthStatusRow {
  mcp_id: string;
  perdido_em: string | null;
}

export interface ListMcpServersOptions {
  includeDisabled?: boolean;
  agentId?: string | null;
  resolveSecrets?: boolean;
}

const VAULT_REF_PREFIX = "vault://";

function buildVaultKey(mcpId: string, scope: "env" | "header", key: string): string {
  return `mcp/${mcpId}/${scope}/${encodeURIComponent(key)}`;
}

function buildVaultUri(mcpId: string, scope: "env" | "header", key: string): string {
  return `${VAULT_REF_PREFIX}${buildVaultKey(mcpId, scope, key)}`;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  const parsed = parseJsonSafe<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function parseStringRecord(raw: string | null | undefined): Record<string, string> {
  const parsed = parseJsonSafe<unknown>(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") {
      result[k] = v;
    }
  }
  return result;
}

function parseAcesso(raw: string | null | undefined): McpAcessoAgentes {
  const parsed = parseJsonSafe<unknown>(raw, { mode: "everyone", agentIds: [] });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { mode: "everyone", agentIds: [] };
  }
  const obj = parsed as { mode?: unknown; agentIds?: unknown };
  const mode = obj.mode === "agents" ? "agents" : "everyone";
  const agentIds = Array.isArray(obj.agentIds)
    ? Array.from(
        new Set(
          obj.agentIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean)
        )
      )
    : [];
  return {
    mode,
    agentIds: mode === "everyone" ? [] : agentIds,
  };
}

function preserveUrlQueryMasks(newUrl: string | null, existingUrl: string | null): string | null {
  if (!newUrl || !existingUrl) return newUrl;
  try {
    const nextParsed = new URL(newUrl);
    const oldParsed = new URL(existingUrl);
    let changed = false;

    if (nextParsed.password === MASKED_SECRET_VALUE && oldParsed.password) {
      nextParsed.password = oldParsed.password;
      changed = true;
    }

    for (const [k, v] of nextParsed.searchParams.entries()) {
      if ((v === MASKED_SECRET_VALUE || v === SECRET_REDACTED_PLACEHOLDER) && oldParsed.searchParams.has(k)) {
        const oldVal = oldParsed.searchParams.get(k);
        if (oldVal !== null) {
          nextParsed.searchParams.set(k, oldVal);
          changed = true;
        }
      }
    }

    return changed ? nextParsed.toString() : newUrl;
  } catch {
    return newUrl;
  }
}

export function isAgentAuthorizedForServer(
  server: McpServidorConfig,
  agentId?: string | null
): boolean {
  if (!server.ativo) return false;
  if (server.acesso.mode === "everyone") return true;
  if (!agentId || !agentId.trim()) return false;
  return server.acesso.agentIds.includes(agentId.trim());
}

/**
 * Repositório SQLite + Cofre AES-256-GCM para servidores MCP e controle de acesso por agente.
 */
export class McpServerStore {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;

  constructor(
    dbOrOptions: CriativoDatabase | { db: CriativoDatabase; vault: VaultService },
    vaultArg?: VaultService
  ) {
    if (vaultArg) {
      this.db = dbOrOptions as CriativoDatabase;
      this.vault = vaultArg;
    } else {
      const opts = dbOrOptions as { db: CriativoDatabase; vault: VaultService };
      this.db = opts.db;
      this.vault = opts.vault;
    }
  }

  private resolveSecretMap(record: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value.startsWith(VAULT_REF_PREFIX)) {
        const vaultKey = value.slice(VAULT_REF_PREFIX.length);
        const secret = this.vault.getSecret(vaultKey);
        resolved[key] = secret ?? "";
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private computeOAuthStatusMap(): Map<string, McpOAuthStatus> {
    const rows = this.db.connection
      .prepare(`SELECT mcp_id, perdido_em FROM projecao_mcp_oauth_tokens;`)
      .all() as unknown as OAuthStatusRow[];

    const statusByMcp = new Map<string, McpOAuthStatus>();
    for (const row of rows) {
      const current = statusByMcp.get(row.mcp_id);
      if (row.perdido_em === null) {
        statusByMcp.set(row.mcp_id, "connected");
      } else if (!current) {
        statusByMcp.set(row.mcp_id, "lost");
      }
    }
    return statusByMcp;
  }

  private hydrateRow(
    row: McpServerRow,
    oauthStatusMap: Map<string, McpOAuthStatus>,
    resolveSecrets: boolean
  ): McpServidorConfig {
    const rawEnv = parseStringRecord(row.env_json);
    const rawHeaders = parseStringRecord(row.headers_json);
    const env = resolveSecrets ? this.resolveSecretMap(rawEnv) : rawEnv;
    const headers = resolveSecrets ? this.resolveSecretMap(rawHeaders) : rawHeaders;

    const transporte: McpTransporte =
      row.transporte === "http" || (row.url && !row.comando) ? "http" : "stdio";

    const config: McpServidorConfig = {
      mcp_id: row.mcp_id,
      nome: row.nome,
      transporte,
      comando: row.comando ?? "",
      args: parseStringArray(row.args_json),
      env,
      envPassthrough: parseStringArray(row.env_passthrough_json),
      workingDirectory: row.working_directory ?? null,
      url: row.url ?? null,
      headers,
      acesso: parseAcesso(row.acesso_json),
      origemAppSlug: row.origem_app_slug ?? null,
      contaRotulo: row.conta_rotulo ?? null,
      posicao: Number(row.posicao ?? 0),
      ativo: row.ativo === 1,
      ultimoTesteEm: row.ultimo_teste_em ?? null,
      ultimoErro: row.ultimo_erro ?? null,
      qtdFerramentas: Number(row.qtd_ferramentas ?? 0),
      oauthStatus: oauthStatusMap.get(row.mcp_id) ?? "disconnected",
      atualizadoEm: row.atualizado_em,
    };

    return resolveSecrets ? config : maskMcpServerForClient(config);
  }

  /**
   * Lista servidores MCP com filtragem opcional por status ativo e `agentId`.
   * Por padrão retorna segredos mascarados (`resolveSecrets = false`).
   */
  public listServers(options: ListMcpServersOptions = {}): McpServidorConfig[] {
    const includeDisabled = options.includeDisabled ?? true;
    const resolveSecrets = options.resolveSecrets ?? false;
    const oauthStatusMap = this.computeOAuthStatusMap();

    const rows = this.db.connection
      .prepare(
        includeDisabled
          ? `SELECT * FROM projecao_mcp_servidores ORDER BY posicao ASC, nome ASC;`
          : `SELECT * FROM projecao_mcp_servidores WHERE ativo = 1 ORDER BY posicao ASC, nome ASC;`
      )
      .all() as unknown as McpServerRow[];

    const servers = rows.map((row) => this.hydrateRow(row, oauthStatusMap, resolveSecrets));

    if (options.agentId !== undefined && options.agentId !== null) {
      return servers.filter((srv) => {
        if (srv.acesso.mode === "everyone") return true;
        const cleanAgentId = options.agentId!.trim();
        return cleanAgentId.length > 0 && srv.acesso.agentIds.includes(cleanAgentId);
      });
    }

    return servers;
  }

  /**
   * Lista servidores estritamente sanitizados para exposição em rotas UI ou ferramentas de agentes.
   */
  public listServersForClient(
    options: Omit<ListMcpServersOptions, "resolveSecrets"> = {}
  ): McpServidorConfig[] {
    return this.listServers({ ...options, resolveSecrets: false });
  }

  /**
   * Obtém um servidor específico por `mcpId`.
   */
  public getServer(mcpId: string, resolveSecrets = false): McpServidorConfig | null {
    const cleanId = mcpId.trim();
    if (!cleanId) return null;

    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_mcp_servidores WHERE mcp_id = ? LIMIT 1;`)
      .get(cleanId) as unknown as McpServerRow | undefined;

    if (!row) return null;

    const oauthStatusMap = this.computeOAuthStatusMap();
    return this.hydrateRow(row, oauthStatusMap, resolveSecrets);
  }

  private mergePreservedMasks(
    incoming: Partial<McpServidorConfig>,
    existing: McpServidorConfig | null
  ): Partial<McpServidorConfig> {
    if (!existing) return incoming;

    const mergeRecord = (
      nextRec: Record<string, string> | undefined,
      oldRec: Record<string, string>
    ): Record<string, string> => {
      if (!nextRec) return { ...oldRec };
      const merged: Record<string, string> = {};
      for (const [key, val] of Object.entries(nextRec)) {
        if (
          (val === MASKED_SECRET_VALUE || val === SECRET_REDACTED_PLACEHOLDER) &&
          typeof oldRec[key] === "string"
        ) {
          merged[key] = oldRec[key];
        } else {
          merged[key] = val;
        }
      }
      return merged;
    };

    return {
      ...incoming,
      env: mergeRecord(incoming.env, existing.env),
      headers: mergeRecord(incoming.headers, existing.headers),
      url:
        incoming.url !== undefined
          ? preserveUrlQueryMasks(incoming.url, existing.url)
          : existing.url,
    };
  }

  private sealAndPersistSecrets(
    mcpId: string,
    env: Record<string, string>,
    headers: Record<string, string>,
    existingRawEnv: Record<string, string>,
    existingRawHeaders: Record<string, string>
  ): { sealedEnv: Record<string, string>; sealedHeaders: Record<string, string> } {
    const sealedEnv: Record<string, string> = {};
    const sealedHeaders: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (!value) {
        sealedEnv[key] = "";
        this.vault.deleteSecret(buildVaultKey(mcpId, "env", key));
        continue;
      }
      if (value.startsWith(VAULT_REF_PREFIX)) {
        sealedEnv[key] = value;
        continue;
      }
      this.vault.setSecret(buildVaultKey(mcpId, "env", key), value);
      sealedEnv[key] = buildVaultUri(mcpId, "env", key);
    }

    for (const [key, value] of Object.entries(headers)) {
      if (!value) {
        sealedHeaders[key] = "";
        this.vault.deleteSecret(buildVaultKey(mcpId, "header", key));
        continue;
      }
      if (value.startsWith(VAULT_REF_PREFIX)) {
        sealedHeaders[key] = value;
        continue;
      }
      this.vault.setSecret(buildVaultKey(mcpId, "header", key), value);
      sealedHeaders[key] = buildVaultUri(mcpId, "header", key);
    }

    // Limpa chaves removidas do Cofre
    for (const oldKey of Object.keys(existingRawEnv)) {
      if (!(oldKey in env)) {
        this.vault.deleteSecret(buildVaultKey(mcpId, "env", oldKey));
      }
    }
    for (const oldKey of Object.keys(existingRawHeaders)) {
      if (!(oldKey in headers)) {
        this.vault.deleteSecret(buildVaultKey(mcpId, "header", oldKey));
      }
    }

    return { sealedEnv, sealedHeaders };
  }

  /**
   * Cria ou atualiza um servidor MCP validado por `normalizeMcpConfig` + `mcpConfigErrors`
   * e armazena valores sensíveis cifrados no Cofre AES-256-GCM.
   */
  public saveServer(input: Partial<McpServidorConfig>): McpServidorConfig {
    const targetId = typeof input.mcp_id === "string" ? input.mcp_id.trim() : "";
    const existingResolved = targetId ? this.getServer(targetId, true) : null;

    if (targetId && !existingResolved && input.mcp_id) {
      // Permite upsert se o chamador forneceu ID novo explícito (ex.: seeds/apps da loja)
    }

    const mergedInput = this.mergePreservedMasks(input, existingResolved);
    const normalized = normalizeMcpConfig(mergedInput);
    const errors = mcpConfigErrors(normalized);
    const firstError = errors.nome ?? errors.comando ?? errors.url ?? errors.acesso;
    if (firstError) {
      throw new McpServerStoreError(firstError, errors);
    }

    const mcpId = normalized.mcp_id || `mcp-${randomUUID().slice(0, 12)}`;

    const duplicateName = this.db.connection
      .prepare(
        `SELECT mcp_id FROM projecao_mcp_servidores WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?)) AND mcp_id != ? LIMIT 1;`
      )
      .get(normalized.nome, mcpId) as { mcp_id?: string } | undefined;

    if (duplicateName?.mcp_id) {
      throw new McpServerStoreError(
        `Já existe um servidor MCP cadastrado com o nome "${normalized.nome}".`,
        { nome: `Já existe um servidor MCP cadastrado com o nome "${normalized.nome}".` }
      );
    }

    const existingRow = this.db.connection
      .prepare(`SELECT env_json, headers_json, posicao FROM projecao_mcp_servidores WHERE mcp_id = ? LIMIT 1;`)
      .get(mcpId) as { env_json?: string; headers_json?: string; posicao?: number } | undefined;

    const existingRawEnv = parseStringRecord(existingRow?.env_json);
    const existingRawHeaders = parseStringRecord(existingRow?.headers_json);

    const nextPositionRow = this.db.connection
      .prepare(`SELECT COALESCE(MAX(posicao) + 1, 0) AS next_pos FROM projecao_mcp_servidores;`)
      .get() as { next_pos?: number } | undefined;

    const posicao =
      typeof existingRow?.posicao === "number"
        ? existingRow.posicao
        : Number(nextPositionRow?.next_pos ?? normalized.posicao ?? 0);

    const { sealedEnv, sealedHeaders } = this.sealAndPersistSecrets(
      mcpId,
      normalized.env,
      normalized.headers,
      existingRawEnv,
      existingRawHeaders
    );

    const agora = new Date().toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_mcp_servidores (
             mcp_id, nome, transporte, comando, args_json, env_json, env_passthrough_json,
             working_directory, url, headers_json, acesso_json, origem_app_slug, conta_rotulo,
             posicao, ativo, ultimo_teste_em, ultimo_erro, qtd_ferramentas, atualizado_em
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(mcp_id) DO UPDATE SET
             nome = excluded.nome,
             transporte = excluded.transporte,
             comando = excluded.comando,
             args_json = excluded.args_json,
             env_json = excluded.env_json,
             env_passthrough_json = excluded.env_passthrough_json,
             working_directory = excluded.working_directory,
             url = excluded.url,
             headers_json = excluded.headers_json,
             acesso_json = excluded.acesso_json,
             origem_app_slug = excluded.origem_app_slug,
             conta_rotulo = excluded.conta_rotulo,
             ativo = excluded.ativo,
             atualizado_em = excluded.atualizado_em;`
        )
        .run(
          mcpId,
          normalized.nome,
          normalized.transporte,
          normalized.comando,
          JSON.stringify(normalized.args),
          JSON.stringify(sealedEnv),
          JSON.stringify(normalized.envPassthrough),
          normalized.workingDirectory,
          normalized.url,
          JSON.stringify(sealedHeaders),
          JSON.stringify(normalized.acesso),
          normalized.origemAppSlug,
          normalized.contaRotulo,
          posicao,
          normalized.ativo ? 1 : 0,
          existingResolved?.ultimoTesteEm ?? normalized.ultimoTesteEm ?? null,
          existingResolved?.ultimoErro ?? normalized.ultimoErro ?? null,
          existingResolved?.qtdFerramentas ?? normalized.qtdFerramentas ?? 0,
          agora
        );
    });

    return this.getServer(mcpId, false)!;
  }

  /**
   * Habilita ou desabilita um servidor MCP.
   */
  public setServerEnabled(mcpId: string, ativo: boolean): McpServidorConfig {
    const existing = this.getServer(mcpId, false);
    if (!existing) {
      throw new McpServerStoreError(`Servidor MCP '${mcpId}' não encontrado.`);
    }

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(`UPDATE projecao_mcp_servidores SET ativo = ?, atualizado_em = ? WHERE mcp_id = ?;`)
        .run(ativo ? 1 : 0, agora, mcpId);
    });

    return this.getServer(mcpId, false)!;
  }

  /**
   * Atualiza o escopo de acesso por agente (`everyone` ou lista específica de `agentIds`).
   */
  public setServerAccess(mcpId: string, acesso: McpAcessoAgentes): McpServidorConfig {
    const existing = this.getServer(mcpId, false);
    if (!existing) {
      throw new McpServerStoreError(`Servidor MCP '${mcpId}' não encontrado.`);
    }

    const normalizedAcesso = parseAcesso(JSON.stringify(acesso));
    if (normalizedAcesso.mode === "agents" && normalizedAcesso.agentIds.length === 0) {
      throw new McpServerStoreError(
        "Selecione pelo menos um agente autorizado ou altere o acesso para todos os agentes.",
        {
          acesso:
            "Selecione pelo menos um agente autorizado ou altere o acesso para todos os agentes.",
        }
      );
    }

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(`UPDATE projecao_mcp_servidores SET acesso_json = ?, atualizado_em = ? WHERE mcp_id = ?;`)
        .run(JSON.stringify(normalizedAcesso), agora, mcpId);
    });

    return this.getServer(mcpId, false)!;
  }

  /**
   * Grava o diagnóstico mais recente de sondagem (`ultimo_teste_em`, `ultimo_erro`, `qtd_ferramentas`).
   */
  public recordProbeResult(mcpId: string, result: McpProbeResultado): McpServidorConfig | null {
    const existing = this.getServer(mcpId, true);
    if (!existing) return null;

    const agora = new Date().toISOString();
    const secrets = collectSensitiveSecrets(existing);
    const sanitizedError =
      result.status === "passed"
        ? null
        : result.error
          ? redactMcpSecrets(result.error, secrets)
          : result.status === "needs_sign_in"
            ? "Autenticação OAuth necessária no navegador."
            : "Falha ao testar servidor MCP.";

    const toolCount = result.status === "passed" ? result.toolCount : existing.qtdFerramentas;

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `UPDATE projecao_mcp_servidores
           SET ultimo_teste_em = ?, ultimo_erro = ?, qtd_ferramentas = ?, atualizado_em = ?
           WHERE mcp_id = ?;`
        )
        .run(agora, sanitizedError, toolCount, agora, mcpId);
    });

    return this.getServer(mcpId, false);
  }

  /**
   * Remove um servidor MCP e apaga todos os segredos vinculados no Cofre.
   */
  public removeServer(mcpId: string): boolean {
    const cleanId = mcpId.trim();
    if (!cleanId) return false;

    const row = this.db.connection
      .prepare(`SELECT env_json, headers_json FROM projecao_mcp_servidores WHERE mcp_id = ? LIMIT 1;`)
      .get(cleanId) as { env_json?: string; headers_json?: string } | undefined;

    if (!row) return false;

    const rawEnv = parseStringRecord(row.env_json);
    const rawHeaders = parseStringRecord(row.headers_json);

    for (const key of Object.keys(rawEnv)) {
      this.vault.deleteSecret(buildVaultKey(cleanId, "env", key));
    }
    for (const key of Object.keys(rawHeaders)) {
      this.vault.deleteSecret(buildVaultKey(cleanId, "header", key));
    }

    const info = this.db.connection
      .prepare(`DELETE FROM projecao_mcp_servidores WHERE mcp_id = ?;`)
      .run(cleanId);

    return Number(info.changes) > 0;
  }
}
