import type { CustomOpenAIEndpointConfig, ProviderName } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { OpenAIProvider } from "../engine/providers/openai-provider.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { VaultService } from "../vault/vault-service.ts";

interface CustomProviderRow {
  id: string;
  name: string;
  base_url: string;
  models_json: string;
  vault_secret_key: string | null;
  enabled: number;
  headers_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertCustomEndpointInput {
  id?: string;
  name: string;
  baseUrl: string;
  models?: string[];
  apiKey?: string | null;
  enabled?: boolean;
  headers?: Record<string, string>;
}

function sanitizeProviderSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeBaseUrl(rawUrl: string): string {
  const clean = String(rawUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error("URL base do provedor customizado deve iniciar com http:// ou https://.");
  }
  return clean;
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseCustomHeaders(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && k.trim()) {
        out[k.trim()] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gerencia endpoints OpenAI-compatíveis customizados (OpenRouter, DeepSeek, Groq, vLLM, LM Studio).
 * As chaves de API são armazenadas exclusivamente no `VaultService` AES-256-GCM.
 */
export class CustomEndpointsService {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;
  private readonly registry: ProviderRegistry;
  private readonly fetchImpl?: FetchLike;

  constructor(deps: {
    db: CriativoDatabase;
    vault: VaultService;
    registry: ProviderRegistry;
    fetchImpl?: FetchLike;
  }) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.registry = deps.registry;
    this.fetchImpl = deps.fetchImpl;
  }

  private mapRow(row: CustomProviderRow): CustomOpenAIEndpointConfig {
    const secretVal = row.vault_secret_key ? this.vault.getSecret(row.vault_secret_key) : null;
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      models: parseJsonStringArray(row.models_json),
      hasApiKey: Boolean(secretVal && secretVal.trim().length > 0),
      enabled: row.enabled === 1,
      headersJson: row.headers_json ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private registerRowInRegistry(row: CustomProviderRow): void {
    const registryKey = (row.id === "lmstudio" ? "lmstudio" : `custom:${row.id}`) as ProviderName;
    if (row.enabled !== 1) return;
    const headers = parseCustomHeaders(row.headers_json);
    const client = new OpenAIProvider({
      vault: this.vault,
      fetchImpl: this.fetchImpl,
      providerName: registryKey,
      baseUrl: row.base_url,
      secretKeys: row.vault_secret_key ? [row.vault_secret_key] : [],
      requireApiKey: false,
      customHeaders: headers,
      defaultModel: parseJsonStringArray(row.models_json)[0],
    });
    this.registry.registerCustomProvider(registryKey, client);
  }

  public syncAllIntoRegistry(): void {
    const rows = this.db.connection
      .prepare("SELECT * FROM projecao_custom_providers WHERE enabled = 1 ORDER BY name ASC;")
      .all() as unknown as CustomProviderRow[];
    for (const row of rows) {
      this.registerRowInRegistry(row);
    }
  }

  public listEndpoints(): CustomOpenAIEndpointConfig[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM projecao_custom_providers ORDER BY created_at DESC;")
      .all() as unknown as CustomProviderRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getEndpoint(id: string): CustomOpenAIEndpointConfig | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_custom_providers WHERE id = ? LIMIT 1;")
      .get(id) as unknown as CustomProviderRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public upsertEndpoint(input: UpsertCustomEndpointInput): CustomOpenAIEndpointConfig {
    const name = String(input.name ?? "").trim();
    if (!name) {
      throw new Error("Nome do provedor customizado é obrigatório.");
    }
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const id = sanitizeProviderSlug(input.id?.trim() || name);
    if (!id) {
      throw new Error("Identificador inválido para provedor customizado.");
    }

    const secretKey = `custom_provider_${id}_api_key`;
    const models = (input.models ?? []).map((m) => m.trim()).filter(Boolean);
    const headersJson = input.headers ? JSON.stringify(input.headers) : null;
    const enabled = input.enabled === false ? 0 : 1;
    const now = new Date().toISOString();

    if (typeof input.apiKey === "string" && input.apiKey.trim().length > 0) {
      this.vault.setSecret(secretKey, input.apiKey.trim());
    }

    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_custom_providers (
          id, name, base_url, models_json, vault_secret_key, enabled, headers_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          base_url = excluded.base_url,
          models_json = excluded.models_json,
          vault_secret_key = excluded.vault_secret_key,
          enabled = excluded.enabled,
          headers_json = COALESCE(excluded.headers_json, projecao_custom_providers.headers_json),
          updated_at = excluded.updated_at;
      `
      )
      .run(id, name, baseUrl, JSON.stringify(models), secretKey, enabled, headersJson, now, now);

    const row = this.db.connection
      .prepare("SELECT * FROM projecao_custom_providers WHERE id = ? LIMIT 1;")
      .get(id) as unknown as CustomProviderRow;
    this.registerRowInRegistry(row);
    return this.mapRow(row);
  }

  public deleteEndpoint(id: string): boolean {
    const row = this.db.connection
      .prepare("SELECT vault_secret_key FROM projecao_custom_providers WHERE id = ? LIMIT 1;")
      .get(id) as { vault_secret_key?: string | null } | undefined;
    if (!row) return false;
    if (row.vault_secret_key) {
      this.vault.deleteSecret(row.vault_secret_key);
    }
    const info = this.db.connection
      .prepare("DELETE FROM projecao_custom_providers WHERE id = ?;")
      .run(id);
    return Number(info.changes ?? 0) > 0;
  }

  public async testEndpoint(id: string): Promise<{
    ok: boolean;
    status: number | null;
    models: string[];
    erro?: string;
  }> {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_custom_providers WHERE id = ? LIMIT 1;")
      .get(id) as unknown as CustomProviderRow | undefined;
    if (!row) {
      return { ok: false, status: null, models: [], erro: `Provedor '${id}' não encontrado.` };
    }

    const fetchFn = this.fetchImpl ?? (fetch as unknown as FetchLike);
    const apiKey = row.vault_secret_key ? this.vault.getSecret(row.vault_secret_key) : null;
    const headers: Record<string, string> = {
      ...(parseCustomHeaders(row.headers_json) ?? {}),
      Accept: "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    try {
      const res = await fetchFn(`${row.base_url}/models`, {
        method: "GET",
        headers,
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string; name?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          models: [],
          erro: json.error?.message ?? `Endpoint respondeu HTTP ${res.status}`,
        };
      }
      const discovered = [
        ...(Array.isArray(json.data) ? json.data.map((m) => m.id ?? "") : []),
        ...(Array.isArray(json.models) ? json.models.map((m) => m.id ?? m.name ?? "") : []),
      ]
        .map((m) => m.trim())
        .filter(Boolean);

      return { ok: true, status: res.status, models: Array.from(new Set(discovered)) };
    } catch (err) {
      return {
        ok: false,
        status: null,
        models: [],
        erro: err instanceof Error ? err.message : "Falha de conexão com o endpoint customizado.",
      };
    }
  }
}
