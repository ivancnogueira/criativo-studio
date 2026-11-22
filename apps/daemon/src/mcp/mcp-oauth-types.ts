import {
  type Server as HttpServer,
} from "node:http";
import type {
  McpOAuthMetadataSummary,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  FetchLike,
} from "../engine/providers/provider-interface.ts";
import type {
  VaultService,
} from "../vault/vault-service.ts";

export const TOKEN_REFRESH_MARGIN_MS = 60_000;
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const OAUTH_REVOCATION_TIMEOUT_MS = 5_000;
export const OAUTH_HTTP_TIMEOUT_MS = 15_000;
export const MCP_OAUTH_CLIENT_NAME = "Criativo AI Studio Online";

export const VAULT_SEAL_KEY_NAME = "__mcp_oauth_seal_key__";

export interface McpOAuthSecretPayload {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  client_id?: string;
  client_secret?: string;
  token_endpoint_auth_method?: string;
}

export interface StartAuthorizationInput {
  mcpId: string;
  appSlug?: string | null;
  serverUrl: string;
  contaChave?: string;
  callbackBaseUrl?: string;
  clientIdOverride?: string;
  clientSecretOverride?: string;
  scopes?: string[];
  useLoopbackListener?: boolean;
}

export interface StartAuthorizationOutput {
  authorizeUrl: string;
  state: string;
  redirectUri: string;
  contaChave: string;
}

export interface HandleCallbackInput {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface HandleCallbackOutput {
  contaChave: string;
  mcpId: string;
  appSlug: string | null;
  escopos: string[];
  expiraEm: string | null;
}

export interface PendingOAuthFlow {
  state: string;
  mcpId: string;
  appSlug: string | null;
  serverUrl: string;
  cleanServerUrl: string;
  contaChave: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: string;
  scopes: string[];
  discovery: McpOAuthMetadataSummary & {
    resourceMetadataUrl?: string | null;
    authorizationServerUrl?: string | null;
  };
  expiresAt: number;
  loopbackServer?: HttpServer | null;
  loopbackTimer?: ReturnType<typeof setTimeout> | null;
}

export interface OAuthTokenRow {
  conta_chave: string;
  mcp_id: string;
  app_slug: string | null;
  servidor_url: string;
  issuer_url: string | null;
  escopos_json: string;
  discovery_json: string;
  payload_criptografado: string;
  iv: string;
  expira_em: string | null;
  obtido_em: string;
  perdido_em: string | null;
  atualizado_em: string;
}

export interface McpOAuthProviderOptions {
  db: CriativoDatabase;
  vault: VaultService;
  fetchImpl?: FetchLike;
  onTokensUpdated?: (event: {
    mcpId: string;
    contaChave: string;
    sucesso: boolean;
    erro?: string | null;
  }) => void;
}

export function isLoopbackBaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function extractAccountFragment(serverUrl: string): string | null {
  try {
    const parsed = new URL(serverUrl);
    const hash = parsed.hash.replace(/^#/, "").trim();
    return hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

export function resolveAccountKey(mcpId: string, serverUrl: string, explicitContaChave?: string): string {
  if (explicitContaChave && explicitContaChave.trim().length > 0) {
    return explicitContaChave.trim();
  }
  const fragment = extractAccountFragment(serverUrl);
  if (fragment) {
    return `${mcpId}#${fragment}`;
  }
  return `${mcpId}#account-1`;
}

export function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Provedor OAuth 2.1 completo para MCPs HTTP:
 * - PKCE S256
 * - Discovery RFC 9728 / RFC 8414
 * - Dynamic Client Registration RFC 7591
 * - Callback duplo (loopback `127.0.0.1` e `/api/mcps/oauth/callback`)
 * - Persistência cifrada AES-256-GCM vinculada ao `VaultService`
 * - Refresh automático com margem de `60_000ms` e detecção de `invalid_grant`
 * - Múltiplas contas por servidor (`#account-N`)
 */

export interface McpOAuthDeps {
  db: CriativoDatabase;
  vault: VaultService;
  fetchImpl: FetchLike;
  onTokensUpdated?: McpOAuthProviderOptions["onTokensUpdated"];
  pendingFlows: Map<string, PendingOAuthFlow>;
  refreshInFlight: Map<string, Promise<string | null>>;
  encryptPayload: (payload: McpOAuthSecretPayload) => { ciphertext: string; ivEnvelope: string };
  decryptPayload: (ciphertext: string, ivEnvelope: string) => McpOAuthSecretPayload;
  cleanupExpiredFlows: () => void;
  closeFlowListener: (flow: PendingOAuthFlow) => void;
  startTemporaryLoopbackListener: (state: string) => Promise<{
    redirectUri: string;
    server: import("node:http").Server;
    timer: NodeJS.Timeout;
  }>;
}

export type TailArgs<F> = F extends (deps: McpOAuthDeps, ...args: infer A) => unknown ? A : never;
