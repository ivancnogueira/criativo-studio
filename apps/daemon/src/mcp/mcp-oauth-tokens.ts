import type {
  McpOAuthAccountView,
  McpOAuthMetadataSummary,
  McpOAuthStatus,
} from "@criativo/contracts";
import {
  discoverOAuthMetadata,
} from "./mcp-probe.ts";
import { type McpOAuthDeps, TOKEN_REFRESH_MARGIN_MS, OAUTH_REVOCATION_TIMEOUT_MS, OAUTH_HTTP_TIMEOUT_MS, type McpOAuthSecretPayload, type OAuthTokenRow, parseJsonSafe } from "./mcp-oauth-types.ts";

export function readAccountRowOp(deps: McpOAuthDeps, mcpId: string, contaChave?: string): OAuthTokenRow | null {
  if (contaChave) {
    const row = deps.db.connection
      .prepare(`SELECT * FROM projecao_mcp_oauth_tokens WHERE mcp_id = ? AND conta_chave = ? LIMIT 1;`)
      .get(mcpId, contaChave) as unknown as OAuthTokenRow | undefined;
    return row ?? null;
  }

  const activeRow = deps.db.connection
    .prepare(
      `SELECT * FROM projecao_mcp_oauth_tokens
       WHERE mcp_id = ?
       ORDER BY CASE WHEN perdido_em IS NULL THEN 0 ELSE 1 END, atualizado_em DESC
       LIMIT 1;`
    )
    .get(mcpId) as unknown as OAuthTokenRow | undefined;
  return activeRow ?? null;
}

export function markSessionLostOp(deps: McpOAuthDeps, contaChave: string, payload?: McpOAuthSecretPayload): void {
  const agora = new Date().toISOString();
  deps.db.runInTransaction(() => {
    if (payload) {
      // Mantém client_id/client_secret mas limpa access/refresh tokens perdidos
      const stripped: McpOAuthSecretPayload = {
        access_token: "",
        client_id: payload.client_id,
        client_secret: payload.client_secret,
        token_endpoint_auth_method: payload.token_endpoint_auth_method,
      };
      const { ciphertext, ivEnvelope } = deps.encryptPayload(stripped);
      deps.db.connection
        .prepare(
          `UPDATE projecao_mcp_oauth_tokens
           SET payload_criptografado = ?, iv = ?, perdido_em = ?, atualizado_em = ?
           WHERE conta_chave = ?;`
        )
        .run(ciphertext, ivEnvelope, agora, agora, contaChave);
    } else {
      deps.db.connection
        .prepare(
          `UPDATE projecao_mcp_oauth_tokens
           SET perdido_em = ?, atualizado_em = ?
           WHERE conta_chave = ?;`
        )
        .run(agora, agora, contaChave);
    }
  });
}

export async function executeRefreshOp(deps: McpOAuthDeps, row: OAuthTokenRow, payload: McpOAuthSecretPayload): Promise<string | null> {
  const existingRefresh = deps.refreshInFlight.get(row.conta_chave);
  if (existingRefresh) {
    return await existingRefresh;
  }

  const promise = (async (): Promise<string | null> => {
    if (!payload.refresh_token) {
      const expMs = row.expira_em ? Date.parse(row.expira_em) : NaN;
      if (!Number.isNaN(expMs) && expMs <= Date.now()) {
        markSessionLostOp(deps, row.conta_chave, payload);
        return null;
      }
      return payload.access_token || null;
    }

    const discovery = parseJsonSafe<McpOAuthMetadataSummary>(row.discovery_json, {});
    let tokenEndpoint = discovery.tokenEndpoint ?? null;
    if (!tokenEndpoint) {
      const redesc = await discoverOAuthMetadata(row.servidor_url, undefined, deps.fetchImpl).catch(() => null);
      tokenEndpoint = redesc?.tokenEndpoint ?? null;
    }

    if (!tokenEndpoint) {
      const expMs = row.expira_em ? Date.parse(row.expira_em) : NaN;
      return !Number.isNaN(expMs) && expMs > Date.now() ? payload.access_token : null;
    }

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: payload.refresh_token,
    });
    if (payload.client_id) {
      form.set("client_id", payload.client_id);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    if (payload.client_id && payload.client_secret) {
      if (payload.token_endpoint_auth_method === "client_secret_basic") {
        const basic = Buffer.from(`${payload.client_id}:${payload.client_secret}`, "utf8").toString("base64");
        headers.Authorization = `Basic ${basic}`;
      } else {
        form.set("client_secret", payload.client_secret);
      }
    }

    try {
      const res = await deps.fetchImpl(tokenEndpoint, {
        method: "POST",
        headers,
        body: form.toString(),
        signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
      });

      const rawText = await res.text();
      const json = parseJsonSafe<Record<string, unknown>>(rawText, {});

      if (res.ok && typeof json.access_token === "string" && json.access_token.length > 0) {
        const now = new Date();
        const expiresInSec =
          typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
            ? json.expires_in
            : null;
        const nextExpiraEm =
          expiresInSec !== null
            ? new Date(now.getTime() + expiresInSec * 1000).toISOString()
            : row.expira_em;

        const nextPayload: McpOAuthSecretPayload = {
          ...payload,
          access_token: json.access_token,
          refresh_token:
            typeof json.refresh_token === "string" && json.refresh_token.length > 0
              ? json.refresh_token
              : payload.refresh_token,
          token_type:
            typeof json.token_type === "string" && json.token_type.length > 0
              ? json.token_type
              : payload.token_type ?? "Bearer",
        };

        const { ciphertext, ivEnvelope } = deps.encryptPayload(nextPayload);
        const agoraIso = now.toISOString();

        deps.db.runInTransaction(() => {
          deps.db.connection
            .prepare(
              `UPDATE projecao_mcp_oauth_tokens
               SET payload_criptografado = ?, iv = ?, expira_em = ?, perdido_em = NULL, atualizado_em = ?
               WHERE conta_chave = ?;`
            )
            .run(ciphertext, ivEnvelope, nextExpiraEm, agoraIso, row.conta_chave);
        });

        return nextPayload.access_token;
      }

      const oauthErr = typeof json.error === "string" ? json.error : "";
      const isRevokedOrInvalid =
        oauthErr === "invalid_grant" ||
        oauthErr === "invalid_client" ||
        oauthErr === "unauthorized_client" ||
        res.status === 400 ||
        res.status === 401;

      if (isRevokedOrInvalid) {
        markSessionLostOp(deps, row.conta_chave, payload);
        return null;
      }

      const expMs = row.expira_em ? Date.parse(row.expira_em) : NaN;
      return !Number.isNaN(expMs) && expMs > Date.now() ? payload.access_token : null;
    } catch {
      const expMs = row.expira_em ? Date.parse(row.expira_em) : NaN;
      return !Number.isNaN(expMs) && expMs > Date.now() ? payload.access_token : null;
    }
  })();

  deps.refreshInFlight.set(row.conta_chave, promise);
  try {
    return await promise;
  } finally {
    if (deps.refreshInFlight.get(row.conta_chave) === promise) {
      deps.refreshInFlight.delete(row.conta_chave);
    }
  }
}

/**
 * Obtém `access_token` válido, renovando automaticamente quando faltar menos de `60_000ms` para expirar.
 * Marca `perdido_em` em caso de `invalid_grant` / recusa `400`/`401` no refresh e devolve `null`.
 */
export async function getValidAccessTokenOp(deps: McpOAuthDeps, mcpId: string, contaChave?: string): Promise<string | null> {
  const row = readAccountRowOp(deps, mcpId, contaChave);
  if (!row || row.perdido_em) {
    return null;
  }

  let payload: McpOAuthSecretPayload;
  try {
    payload = deps.decryptPayload(row.payload_criptografado, row.iv);
  } catch {
    markSessionLostOp(deps, row.conta_chave);
    return null;
  }

  if (!payload.access_token) {
    return null;
  }

  if (row.expira_em) {
    const expiresAtMs = Date.parse(row.expira_em);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs - Date.now() <= TOKEN_REFRESH_MARGIN_MS) {
      return await executeRefreshOp(deps, row, payload);
    }
  }

  return payload.access_token;
}

/**
 * Chamado pelo proxy ou gateway quando o servidor upstream recusa um token com HTTP 401 antes do prazo previsto.
 */
export async function refreshAfterUnauthorizedOp(deps: McpOAuthDeps, mcpId: string,
    rejectedToken: string,
    contaChave?: string): Promise<string | null> {
  const row = readAccountRowOp(deps, mcpId, contaChave);
  if (!row || row.perdido_em) {
    return null;
  }

  let payload: McpOAuthSecretPayload;
  try {
    payload = deps.decryptPayload(row.payload_criptografado, row.iv);
  } catch {
    markSessionLostOp(deps, row.conta_chave);
    return null;
  }

  if (payload.access_token && payload.access_token !== rejectedToken) {
    return payload.access_token;
  }

  if (!payload.refresh_token) {
    markSessionLostOp(deps, row.conta_chave, payload);
    return null;
  }

  return await executeRefreshOp(deps, row, payload);
}

/**
 * Marca explicitamente a sessão OAuth de um servidor como perdida (ex.: após dupla rejeição 401).
 */
export function markAccountLostOp(deps: McpOAuthDeps, mcpId: string, contaChave?: string): void {
  const row = readAccountRowOp(deps, mcpId, contaChave);
  if (!row) return;
  let payload: McpOAuthSecretPayload | undefined;
  try {
    payload = deps.decryptPayload(row.payload_criptografado, row.iv);
  } catch {
    payload = undefined;
  }
  markSessionLostOp(deps, row.conta_chave, payload);
}

/**
 * Revoga tokens no `revocation_endpoint` (timeout 5s) e remove os registros de `projecao_mcp_oauth_tokens`.
 */
export async function signOutOp(deps: McpOAuthDeps, mcpId: string, contaChave?: string): Promise<void> {
  for (const [state, flow] of deps.pendingFlows.entries()) {
    if (flow.mcpId === mcpId && (!contaChave || flow.contaChave === contaChave)) {
      deps.closeFlowListener(flow);
      deps.pendingFlows.delete(state);
    }
  }

  const rows = (
    contaChave
      ? deps.db.connection
          .prepare(`SELECT * FROM projecao_mcp_oauth_tokens WHERE mcp_id = ? AND conta_chave = ?;`)
          .all(mcpId, contaChave)
      : deps.db.connection
          .prepare(`SELECT * FROM projecao_mcp_oauth_tokens WHERE mcp_id = ?;`)
          .all(mcpId)
  ) as unknown as OAuthTokenRow[];

  deps.db.runInTransaction(() => {
    if (contaChave) {
      deps.db.connection
        .prepare(`DELETE FROM projecao_mcp_oauth_tokens WHERE mcp_id = ? AND conta_chave = ?;`)
        .run(mcpId, contaChave);
    } else {
      deps.db.connection
        .prepare(`DELETE FROM projecao_mcp_oauth_tokens WHERE mcp_id = ?;`)
        .run(mcpId);
    }
  });

  for (const row of rows) {
    const discovery = parseJsonSafe<McpOAuthMetadataSummary>(row.discovery_json, {});
    if (!discovery.revocationEndpoint) continue;

    let payload: McpOAuthSecretPayload | null = null;
    try {
      payload = deps.decryptPayload(row.payload_criptografado, row.iv);
    } catch {
      payload = null;
    }
    if (!payload) continue;

    const tokensToRevoke: Array<[string | undefined, string]> = [
      [payload.refresh_token, "refresh_token"],
      [payload.access_token, "access_token"],
    ];

    for (const [tokenValue, hint] of tokensToRevoke) {
      if (!tokenValue) continue;
      const form = new URLSearchParams({
        token: tokenValue,
        token_type_hint: hint,
      });
      if (payload.client_id) {
        form.set("client_id", payload.client_id);
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (payload.client_id && payload.client_secret) {
        if (payload.token_endpoint_auth_method === "client_secret_basic") {
          const basic = Buffer.from(`${payload.client_id}:${payload.client_secret}`, "utf8").toString("base64");
          headers.Authorization = `Basic ${basic}`;
        } else {
          form.set("client_secret", payload.client_secret);
        }
      }
      await deps.fetchImpl(discovery.revocationEndpoint, {
        method: "POST",
        headers,
        body: form.toString(),
        signal: AbortSignal.timeout(OAUTH_REVOCATION_TIMEOUT_MS),
      }).catch(() => {});
    }
  }
}

/**
 * Retorna estado agregado seguro OAuth (`disconnected` | `signing_in` | `connected` | `lost`).
 */
export function getOAuthStatusOp(deps: McpOAuthDeps, mcpId: string): McpOAuthStatus {
  deps.cleanupExpiredFlows();

  for (const flow of deps.pendingFlows.values()) {
    if (flow.mcpId === mcpId) {
      return "signing_in";
    }
  }

  const accounts = listOAuthAccountsOp(deps, mcpId);
  if (accounts.some((acc) => acc.status === "connected")) {
    return "connected";
  }
  if (accounts.some((acc) => acc.status === "lost")) {
    return "lost";
  }
  return "disconnected";
}

/**
 * Lista contas OAuth vinculadas ao servidor MCP expondo apenas metadados seguros.
 */
export function listOAuthAccountsOp(deps: McpOAuthDeps, mcpId: string): McpOAuthAccountView[] {
  const rows = deps.db.connection
    .prepare(
      `SELECT conta_chave, mcp_id, app_slug, servidor_url, issuer_url, escopos_json,
              expira_em, obtido_em, perdido_em, atualizado_em
       FROM projecao_mcp_oauth_tokens
       WHERE mcp_id = ?
       ORDER BY atualizado_em DESC, conta_chave ASC;`
    )
    .all(mcpId) as unknown as Array<
    Omit<OAuthTokenRow, "discovery_json" | "payload_criptografado" | "iv">
  >;

  return rows.map((row) => {
    const escopos = parseJsonSafe<string[]>(row.escopos_json, []).filter(
      (s): s is string => typeof s === "string"
    );
    let status: McpOAuthStatus = "connected";
    if (row.perdido_em) {
      status = "lost";
    } else if (row.expira_em) {
      const expMs = Date.parse(row.expira_em);
      if (!Number.isNaN(expMs) && expMs <= Date.now()) {
        // Se estiver vencido no relógio (ainda sem tentativa de refresh), pode renovar se tiver refresh_token,
        // mas aqui mantemos connected até falhar ou verificamos de forma segura sem expor segredos.
        status = "connected";
      }
    }

    return {
      conta_chave: row.conta_chave,
      mcp_id: row.mcp_id,
      app_slug: row.app_slug,
      servidor_url: row.servidor_url,
      issuer_url: row.issuer_url,
      escopos,
      status,
      expira_em: row.expira_em,
      obtido_em: row.obtido_em,
      perdido_em: row.perdido_em,
      atualizado_em: row.atualizado_em,
    };
  });
}

/**
 * Encerra eventuais listeners loopback temporários no shutdown do daemon.
 */
