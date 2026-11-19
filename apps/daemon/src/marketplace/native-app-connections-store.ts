import { randomUUID } from "node:crypto";
import type { McpAcessoAgentes, NativeAppAccountSummary } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";

export interface NativeAppFieldDescriptor {
  key: string;
  label?: string;
  secret?: boolean;
  required?: boolean;
  prefix?: string;
}

export interface UpsertNativeAppAccountInput {
  appSlug: string;
  contaId?: string;
  contaRotulo?: string;
  fields: Record<string, string>;
  flowFields: NativeAppFieldDescriptor[];
  aliasMap?: Record<string, string[]>;
  acesso?: Partial<McpAcessoAgentes>;
}

interface NativeAppRow {
  conta_id: string;
  app_slug: string;
  conta_rotulo: string;
  campos_visiveis_json: string;
  vault_keys_json: string;
  acesso_json: string;
  testado_ok: number;
  ultimo_teste_em: string | null;
  ultimo_erro: string | null;
  perfil_conectado_json: string | null;
  padrao: number;
  atualizado_em: string;
}

const DEFAULT_ALIAS_BY_SLUG: Record<string, Record<string, string[]>> = {
  instagram: {
    IG_ACCESS_TOKEN: ["instagram_access_token", "META_ACCESS_TOKEN", "IG_ACCESS_TOKEN"],
    IG_USER_ID: ["instagram_business_account_id", "META_IG_USER_ID", "IG_USER_ID"],
  },
  telegram: {
    TELEGRAM_BOT_TOKEN: ["telegram_bot_token", "TELEGRAM_BOT_TOKEN"],
  },
  "fish-audio": {
    FISH_AUDIO_API_KEY: ["fish_audio_api_key", "FISH_AUDIO_API_KEY"],
  },
  elevenlabs: {
    ELEVENLABS_API_KEY: ["elevenlabs_api_key", "ELEVENLABS_API_KEY"],
  },
};

function parseJsonObject<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function normalizeAcesso(acesso?: Partial<McpAcessoAgentes> | null): McpAcessoAgentes {
  const mode = acesso?.mode === "agents" ? "agents" : "everyone";
  const agentIds = Array.isArray(acesso?.agentIds)
    ? Array.from(
        new Set(
          acesso.agentIds
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

export function maskSecretTail(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 6) return "••••••";
  return `••••••••${trimmed.slice(-4)}`;
}

function sanitizeSegment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Gerencia persistência SQLite multi-conta, mascaramento seguro e controle de acesso por agente
 * para Apps Nativos da Loja sem `serverTemplate` (ex.: `instagram`, `telegram`, `fish-audio`, `elevenlabs`, `whatsapp`).
 */
export class NativeAppConnectionsStore {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;

  constructor(options: { db: CriativoDatabase; vault: VaultService }) {
    this.db = options.db;
    this.vault = options.vault;
  }

  private ensureLegacyMigrated(appSlug: string): void {
    const slug = appSlug.trim().toLowerCase();
    const existing = this.db.connection
      .prepare(`SELECT COUNT(*) AS total FROM projecao_apps_nativos_contas WHERE app_slug = ?;`)
      .get(slug) as { total: number };
    if (Number(existing?.total ?? 0) > 0) return;

    const aliases = DEFAULT_ALIAS_BY_SLUG[slug];
    if (!aliases) return;

    const camposVisiveis: Record<string, string> = {};
    const vaultKeys: Record<string, string> = {};
    let hasAnySecret = false;

    for (const [fieldKey, candidates] of Object.entries(aliases)) {
      for (const alias of candidates) {
        const val = this.vault.getSecret(alias);
        if (val && val.trim()) {
          hasAnySecret = true;
          vaultKeys[fieldKey] = alias;
          if (fieldKey === "IG_USER_ID") {
            camposVisiveis[fieldKey] = val.trim();
          }
          break;
        }
      }
    }

    if (!hasAnySecret) return;

    const contaId = `native-${sanitizeSegment(slug) || "app"}-1`;
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT OR IGNORE INTO projecao_apps_nativos_contas (
          conta_id, app_slug, conta_rotulo, campos_visiveis_json, vault_keys_json,
          acesso_json, testado_ok, ultimo_teste_em, ultimo_erro, perfil_conectado_json, padrao, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, '{"mode":"everyone","agentIds":[]}', 0, NULL, NULL, NULL, 1, ?);`
      )
      .run(
        contaId,
        slug,
        "#account-1",
        JSON.stringify(camposVisiveis),
        JSON.stringify(vaultKeys),
        agora
      );
  }

  private rowToSummary(row: NativeAppRow): NativeAppAccountSummary {
    const camposVisiveis = parseJsonObject<Record<string, string>>(row.campos_visiveis_json, {});
    const vaultKeys = parseJsonObject<Record<string, string>>(row.vault_keys_json, {});
    const acesso = normalizeAcesso(parseJsonObject<Partial<McpAcessoAgentes>>(row.acesso_json, {}));
    const perfilConectado = parseJsonObject<NativeAppAccountSummary["perfil_conectado"]>(
      row.perfil_conectado_json,
      null as unknown as NativeAppAccountSummary["perfil_conectado"]
    );

    const camposMascarados: Record<string, string> = {};
    let configuredFields = 0;

    for (const [fieldKey, vaultKey] of Object.entries(vaultKeys)) {
      const secretVal = this.vault.getSecret(vaultKey);
      if (secretVal && secretVal.trim()) {
        configuredFields += 1;
        camposMascarados[fieldKey] = camposVisiveis[fieldKey]
          ? camposVisiveis[fieldKey]
          : maskSecretTail(secretVal);
      }
    }

    return {
      conta_id: row.conta_id,
      app_slug: row.app_slug,
      conta_rotulo: row.conta_rotulo,
      campos_mascarados: camposMascarados,
      campos_visiveis: camposVisiveis,
      configurado: configuredFields > 0 || Object.keys(camposVisiveis).length > 0,
      testado_ok: row.testado_ok === 1,
      ultimo_teste_em: row.ultimo_teste_em,
      ultimo_erro: row.ultimo_erro,
      perfil_conectado: row.perfil_conectado_json ? perfilConectado : null,
      acesso,
      atualizado_em: row.atualizado_em,
    };
  }

  public listAccounts(appSlug: string): NativeAppAccountSummary[] {
    const slug = appSlug.trim().toLowerCase();
    if (!slug) return [];
    this.ensureLegacyMigrated(slug);

    const rows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_apps_nativos_contas
         WHERE app_slug = ?
         ORDER BY padrao DESC, atualizado_em DESC;`
      )
      .all(slug) as unknown as NativeAppRow[];

    return rows.map((r) => this.rowToSummary(r));
  }

  public getAccount(contaId: string): NativeAppAccountSummary | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_apps_nativos_contas WHERE conta_id = ?;`)
      .get(contaId.trim()) as unknown as NativeAppRow | undefined;
    return row ? this.rowToSummary(row) : null;
  }

  public getResolvedCredentials(
    appSlug: string,
    contaId?: string | null
  ): { contaId: string | null; values: Record<string, string> } {
    const slug = appSlug.trim().toLowerCase();
    this.ensureLegacyMigrated(slug);

    const row = (
      contaId?.trim()
        ? this.db.connection
            .prepare(`SELECT * FROM projecao_apps_nativos_contas WHERE app_slug = ? AND conta_id = ?;`)
            .get(slug, contaId.trim())
        : this.db.connection
            .prepare(
              `SELECT * FROM projecao_apps_nativos_contas WHERE app_slug = ? ORDER BY padrao DESC, atualizado_em DESC LIMIT 1;`
            )
            .get(slug)
    ) as unknown as NativeAppRow | undefined;

    if (!row) return { contaId: null, values: {} };
    const vaultKeys = parseJsonObject<Record<string, string>>(row.vault_keys_json, {});
    const visiveis = parseJsonObject<Record<string, string>>(row.campos_visiveis_json, {});
    const values: Record<string, string> = { ...visiveis };
    for (const [fieldKey, vaultKey] of Object.entries(vaultKeys)) {
      const secretVal = this.vault.getSecret(vaultKey);
      if (secretVal && secretVal.trim()) {
        values[fieldKey] = secretVal.trim();
      }
    }
    return { contaId: row.conta_id, values };
  }

  public upsertAccount(input: UpsertNativeAppAccountInput): NativeAppAccountSummary {
    const slug = input.appSlug.trim().toLowerCase();
    this.ensureLegacyMigrated(slug);

    const currentRows = this.db.connection
      .prepare(`SELECT * FROM projecao_apps_nativos_contas WHERE app_slug = ? ORDER BY padrao DESC, atualizado_em DESC;`)
      .all(slug) as unknown as NativeAppRow[];

    const cleanRotuloInput = input.contaRotulo?.trim() || "";
    let targetRow: NativeAppRow | undefined;

    if (input.contaId?.trim()) {
      targetRow = currentRows.find((r) => r.conta_id === input.contaId!.trim());
    } else if (cleanRotuloInput) {
      targetRow = currentRows.find(
        (r) => r.conta_rotulo.trim().toLowerCase() === cleanRotuloInput.toLowerCase()
      );
    }
    if (!targetRow && !input.contaId?.trim() && currentRows.length === 1 && !cleanRotuloInput) {
      targetRow = currentRows[0];
    }

    const contaId =
      targetRow?.conta_id ||
      input.contaId?.trim() ||
      `native-${sanitizeSegment(slug) || "app"}-${sanitizeSegment(cleanRotuloInput) || currentRows.length + 1}-${randomUUID().slice(0, 4)}`;
    const contaRotulo =
      cleanRotuloInput || targetRow?.conta_rotulo || `#account-${currentRows.length + 1}`;
    const isDefault = targetRow ? targetRow.padrao === 1 : currentRows.length === 0;

    const existingVisiveis = targetRow
      ? parseJsonObject<Record<string, string>>(targetRow.campos_visiveis_json, {})
      : {};
    const existingVaultKeys = targetRow
      ? parseJsonObject<Record<string, string>>(targetRow.vault_keys_json, {})
      : {};

    const nextVisiveis: Record<string, string> = { ...existingVisiveis };
    const nextVaultKeys: Record<string, string> = { ...existingVaultKeys };
    const aliasMap = input.aliasMap ?? DEFAULT_ALIAS_BY_SLUG[slug] ?? {};

    for (const desc of input.flowFields) {
      const rawInput = input.fields[desc.key];
      const existingVaultKey = existingVaultKeys[desc.key];
      const hasExistingVal = Boolean(existingVaultKey && this.vault.getSecret(existingVaultKey));

      if (typeof rawInput === "string" && rawInput.trim().length > 0) {
        const formatted = `${desc.prefix ?? ""}${rawInput.trim()}`;
        const primaryVaultKey = `native/${slug}/${contaId}/${desc.key}`;
        this.vault.setSecret(primaryVaultKey, formatted);
        nextVaultKeys[desc.key] = primaryVaultKey;

        if (isDefault) {
          for (const legacyKey of aliasMap[desc.key] ?? [desc.key]) {
            this.vault.setSecret(legacyKey, formatted);
          }
        }

        if (!desc.secret) {
          nextVisiveis[desc.key] = formatted;
        } else {
          delete nextVisiveis[desc.key];
        }
      } else if (hasExistingVal && isDefault && existingVaultKey) {
        const existingSecret = this.vault.getSecret(existingVaultKey);
        if (existingSecret) {
          for (const legacyKey of aliasMap[desc.key] ?? [desc.key]) {
            this.vault.setSecret(legacyKey, existingSecret);
          }
        }
      }
    }

    const acesso = input.acesso
      ? normalizeAcesso(input.acesso)
      : targetRow
        ? normalizeAcesso(parseJsonObject<Partial<McpAcessoAgentes>>(targetRow.acesso_json, {}))
        : { mode: "everyone" as const, agentIds: [] };

    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO projecao_apps_nativos_contas (
          conta_id, app_slug, conta_rotulo, campos_visiveis_json, vault_keys_json,
          acesso_json, testado_ok, ultimo_teste_em, ultimo_erro, perfil_conectado_json, padrao, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conta_id) DO UPDATE SET
          conta_rotulo = excluded.conta_rotulo,
          campos_visiveis_json = excluded.campos_visiveis_json,
          vault_keys_json = excluded.vault_keys_json,
          acesso_json = excluded.acesso_json,
          atualizado_em = excluded.atualizado_em;`
      )
      .run(
        contaId,
        slug,
        contaRotulo,
        JSON.stringify(nextVisiveis),
        JSON.stringify(nextVaultKeys),
        JSON.stringify(acesso),
        targetRow?.testado_ok ?? 0,
        targetRow?.ultimo_teste_em ?? null,
        targetRow?.ultimo_erro ?? null,
        targetRow?.perfil_conectado_json ?? null,
        isDefault ? 1 : 0,
        agora
      );

    return this.getAccount(contaId)!;
  }

  public recordTestResult(
    contaId: string,
    result: {
      ok: boolean;
      error?: string | null;
      perfilConectado?: NativeAppAccountSummary["perfil_conectado"];
    }
  ): NativeAppAccountSummary | null {
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE projecao_apps_nativos_contas
         SET testado_ok = ?,
             ultimo_teste_em = ?,
             ultimo_erro = ?,
             perfil_conectado_json = COALESCE(?, perfil_conectado_json),
             atualizado_em = ?
         WHERE conta_id = ?;`
      )
      .run(
        result.ok ? 1 : 0,
        agora,
        result.ok ? null : result.error ?? "Falha ao validar conexão.",
        result.perfilConectado ? JSON.stringify(result.perfilConectado) : null,
        agora,
        contaId
      );
    return this.getAccount(contaId);
  }

  public updateAccess(
    appSlug: string,
    acesso: Partial<McpAcessoAgentes>,
    contaId?: string | null
  ): NativeAppAccountSummary[] {
    const slug = appSlug.trim().toLowerCase();
    this.ensureLegacyMigrated(slug);

    const normalized = normalizeAcesso(acesso);
    const agora = new Date().toISOString();
    const existing = this.listAccounts(slug);

    if (existing.length === 0) {
      // Caso o usuário configure permissão antes mesmo de inserir credenciais (ex: WhatsApp ou pré-config)
      const fallbackId = contaId?.trim() || `native-${sanitizeSegment(slug) || "app"}-1`;
      this.db.connection
        .prepare(
          `INSERT INTO projecao_apps_nativos_contas (
            conta_id, app_slug, conta_rotulo, campos_visiveis_json, vault_keys_json,
            acesso_json, testado_ok, padrao, atualizado_em
          ) VALUES (?, ?, '#account-1', '{}', '{}', ?, 0, 1, ?)
          ON CONFLICT(conta_id) DO UPDATE SET
            acesso_json = excluded.acesso_json,
            atualizado_em = excluded.atualizado_em;`
        )
        .run(fallbackId, slug, JSON.stringify(normalized), agora);
    } else if (contaId?.trim()) {
      this.db.connection
        .prepare(
          `UPDATE projecao_apps_nativos_contas
           SET acesso_json = ?, atualizado_em = ?
           WHERE app_slug = ? AND conta_id = ?;`
        )
        .run(JSON.stringify(normalized), agora, slug, contaId.trim());
    } else {
      this.db.connection
        .prepare(
          `UPDATE projecao_apps_nativos_contas
           SET acesso_json = ?, atualizado_em = ?
           WHERE app_slug = ?;`
        )
        .run(JSON.stringify(normalized), agora, slug);
    }

    return this.listAccounts(slug);
  }

  public deleteAccount(appSlug: string, contaId: string): boolean {
    const slug = appSlug.trim().toLowerCase();
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_apps_nativos_contas WHERE app_slug = ? AND conta_id = ?;`)
      .get(slug, contaId.trim()) as unknown as NativeAppRow | undefined;
    if (!row) return false;

    const vaultKeys = parseJsonObject<Record<string, string>>(row.vault_keys_json, {});
    for (const k of Object.values(vaultKeys)) {
      this.vault.deleteSecret(k);
    }

    this.db.connection
      .prepare(`DELETE FROM projecao_apps_nativos_contas WHERE conta_id = ?;`)
      .run(row.conta_id);

    const countRow = this.db.connection
      .prepare(`SELECT COUNT(*) AS total FROM projecao_apps_nativos_contas WHERE app_slug = ?;`)
      .get(slug) as { total: number } | undefined;

    if (Number(countRow?.total ?? 0) === 0) {
      const aliases = DEFAULT_ALIAS_BY_SLUG[slug] ?? {};
      for (const [fieldKey, aliasList] of Object.entries(aliases)) {
        this.vault.deleteSecret(fieldKey);
        for (const k of aliasList) {
          this.vault.deleteSecret(k);
        }
      }
    } else if (row.padrao === 1) {
      const remaining = this.listAccounts(slug);
      if (remaining.length > 0) {
        this.db.connection
          .prepare(`UPDATE projecao_apps_nativos_contas SET padrao = 1 WHERE conta_id = ?;`)
          .run(remaining[0].conta_id);
      }
    }
    return true;
  }

  public isAgentAuthorizedForNativeApp(appSlug: string, agentId?: string | null): boolean {
    const slug = appSlug.trim().toLowerCase();
    this.ensureLegacyMigrated(slug);
    const accounts = this.listAccounts(slug);

    if (accounts.length === 0) {
      // Nenhuma regra específica cadastrada ainda; mantém compatibilidade caso chaves existam via .env
      return true;
    }

    return accounts.some((acc) => {
      if (acc.acesso.mode === "everyone") return true;
      if (!agentId || !agentId.trim()) return false;
      return acc.acesso.agentIds.includes(agentId.trim());
    });
  }
}
