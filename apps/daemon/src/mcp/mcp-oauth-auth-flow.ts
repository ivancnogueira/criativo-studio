import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  type Server as HttpServer,
} from "node:http";
import type {
  VaultService,
} from "../vault/vault-service.ts";
import {
  discoverOAuthMetadata,
  stripUrlFragment,
  validateSafeHttpUrl,
} from "./mcp-probe.ts";
import {
  redactMcpSecrets,
} from "./mcp-redaction.ts";
import { type McpOAuthDeps, OAUTH_STATE_TTL_MS, OAUTH_HTTP_TIMEOUT_MS, MCP_OAUTH_CLIENT_NAME, type McpOAuthSecretPayload, type StartAuthorizationInput, type StartAuthorizationOutput, type HandleCallbackInput, type HandleCallbackOutput, type OAuthTokenRow, isLoopbackBaseUrl, resolveAccountKey } from "./mcp-oauth-types.ts";

export function findReusableClientCredentialsOp(deps: McpOAuthDeps, mcpId: string,
    contaChave: string,
    issuerUrl: string | null | undefined): { clientId: string; clientSecret?: string; tokenEndpointAuthMethod?: string } | null {
  const rows = deps.db.connection
    .prepare(
      `SELECT conta_chave, issuer_url, payload_criptografado, iv
       FROM projecao_mcp_oauth_tokens
       WHERE mcp_id = ?
       ORDER BY CASE WHEN conta_chave = ? THEN 0 ELSE 1 END, atualizado_em DESC;`
    )
    .all(mcpId, contaChave) as unknown as Array<
    Pick<OAuthTokenRow, "conta_chave" | "issuer_url" | "payload_criptografado" | "iv">
  >;

  for (const row of rows) {
    if (issuerUrl && row.issuer_url && row.issuer_url !== issuerUrl) {
      continue;
    }
    try {
      const decrypted = deps.decryptPayload(row.payload_criptografado, row.iv);
      if (decrypted.client_id) {
        return {
          clientId: decrypted.client_id,
          clientSecret: decrypted.client_secret,
          tokenEndpointAuthMethod: decrypted.token_endpoint_auth_method,
        };
      }
    } catch {
      // ignora registro corrompido
    }
  }

  return null;
}

export async function performDynamicClientRegistrationOp(deps: McpOAuthDeps, registrationEndpoint: string,
    redirectUri: string,
    allowLoopbackHttp: boolean): Promise<{ clientId: string; clientSecret?: string; tokenEndpointAuthMethod?: string }> {
  const validated = validateSafeHttpUrl(registrationEndpoint, allowLoopbackHttp);
  if (!validated) {
    throw new Error("Endpoint de registro dinâmico (RFC 7591) inseguro ou inválido.");
  }

  const attempt = async (includeNoneMethod: boolean) => {
    const bodyPayload: Record<string, unknown> = {
      client_name: MCP_OAUTH_CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
    if (includeNoneMethod) {
      bodyPayload.token_endpoint_auth_method = "none";
    }

    const res = await deps.fetchImpl(validated.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    });
    return res;
  };

  let res = await attempt(true);
  if (res.status === 400) {
    const firstErr = await res.text().catch(() => "");
    if (firstErr.includes("token_endpoint_auth_method")) {
      res = await attempt(false);
    } else {
      throw new Error(
        redactMcpSecrets(
          `Registro dinâmico RFC 7591 recusado (HTTP 400): ${firstErr.slice(0, 250)}`,
          []
        )
      );
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      redactMcpSecrets(
        `Falha no registro dinâmico RFC 7591 (HTTP ${res.status}): ${errBody.slice(0, 250)}`,
        []
      )
    );
  }

  const regJson = (await res.json()) as {
    client_id?: string;
    client_secret?: string;
    token_endpoint_auth_method?: string;
  };

  if (!regJson.client_id || typeof regJson.client_id !== "string") {
    throw new Error("Servidor OAuth não retornou client_id no registro dinâmico RFC 7591.");
  }

  return {
    clientId: regJson.client_id,
    clientSecret: typeof regJson.client_secret === "string" ? regJson.client_secret : undefined,
    tokenEndpointAuthMethod:
      typeof regJson.token_endpoint_auth_method === "string"
        ? regJson.token_endpoint_auth_method
        : undefined,
  };
}

/**
 * Inicia o fluxo OAuth 2.1 com PKCE `S256` e Dynamic Client Registration (RFC 7591).
 */
export async function startAuthorizationFlowOp(deps: McpOAuthDeps, input: StartAuthorizationInput): Promise<StartAuthorizationOutput> {
  deps.cleanupExpiredFlows();

  const cleanServerUrl = stripUrlFragment(input.serverUrl);
  const parsedServer = new URL(cleanServerUrl);
  const allowLoopbackHttp = isLoopbackBaseUrl(cleanServerUrl);
  const contaChave = resolveAccountKey(input.mcpId, input.serverUrl, input.contaChave);

  const discovery = await discoverOAuthMetadata(cleanServerUrl, undefined, deps.fetchImpl);
  if (!discovery.authorizationEndpoint || !discovery.tokenEndpoint) {
    throw new Error(
      "O servidor MCP não publicou endpoints OAuth 2.1 válidos (authorization_endpoint / token_endpoint)."
    );
  }

  const state = randomBytes(24).toString("base64url");
  let redirectUri: string;
  let loopbackServer: HttpServer | null = null;
  let loopbackTimer: ReturnType<typeof setTimeout> | null = null;

  const shouldUseLoopbackListener =
    input.useLoopbackListener === true || !input.callbackBaseUrl;

  if (shouldUseLoopbackListener) {
    const listener = await deps.startTemporaryLoopbackListener(state);
    redirectUri = listener.redirectUri;
    loopbackServer = listener.server;
    loopbackTimer = listener.timer;
  } else {
    const cleanBase = input.callbackBaseUrl!.trim().replace(/\/+$/, "");
    redirectUri = `${cleanBase}/api/mcps/oauth/callback`;
  }

  try {
    let clientId = input.clientIdOverride?.trim() || "";
    let clientSecret = input.clientSecretOverride?.trim() || undefined;
    let tokenEndpointAuthMethod: string | undefined;

    if (!clientId) {
      const cachedClient = findReusableClientCredentialsOp(deps, 
        input.mcpId,
        contaChave,
        discovery.authorizationServer
      );
      if (cachedClient) {
        clientId = cachedClient.clientId;
        clientSecret = cachedClient.clientSecret;
        tokenEndpointAuthMethod = cachedClient.tokenEndpointAuthMethod;
      }
    }

    // Dynamic Client Registration (RFC 7591 via discovery.registrationEndpoint / registration_endpoint)
    if (!clientId && discovery.registrationEndpoint) {
      const registered = await performDynamicClientRegistrationOp(deps, 
        discovery.registrationEndpoint,
        redirectUri,
        allowLoopbackHttp
      );
      clientId = registered.clientId;
      clientSecret = registered.clientSecret;
      tokenEndpointAuthMethod = registered.tokenEndpointAuthMethod;
    }

    if (!clientId) {
      throw new Error(
        "O servidor OAuth não suporta registro dinâmico (RFC 7591) e nenhum client_id foi informado."
      );
    }

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const scopes =
      Array.isArray(input.scopes) && input.scopes.length > 0
        ? input.scopes.map((s) => s.trim()).filter(Boolean)
        : discovery.scopesSupported ?? [];

    const authorizeUrl = new URL(discovery.authorizationEndpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("resource", discovery.resource ?? cleanServerUrl);
    if (scopes.length > 0) {
      authorizeUrl.searchParams.set("scope", scopes.join(" "));
    }

    deps.pendingFlows.set(state, {
      state,
      mcpId: input.mcpId,
      appSlug: input.appSlug ?? null,
      serverUrl: input.serverUrl,
      cleanServerUrl,
      contaChave,
      redirectUri,
      codeVerifier,
      clientId,
      clientSecret,
      tokenEndpointAuthMethod,
      scopes,
      discovery,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
      loopbackServer,
      loopbackTimer,
    });

    return {
      authorizeUrl: authorizeUrl.toString(),
      state,
      redirectUri,
      contaChave,
    };
  } catch (err) {
    if (loopbackTimer) clearTimeout(loopbackTimer);
    if (loopbackServer) {
      try {
        loopbackServer.closeAllConnections?.();
        loopbackServer.close();
      } catch {
        // ignora
      }
    }
    throw err;
  } finally {
    void parsedServer;
  }
}

/**
 * Processa o retorno OAuth (`code` + `state`), troca por tokens e persiste cifrado via `VaultService`.
 */
export async function handleCallbackOp(deps: McpOAuthDeps, params: HandleCallbackInput): Promise<HandleCallbackOutput> {
  deps.cleanupExpiredFlows();

  const state = params.state?.trim() ?? "";
  const flow = state ? deps.pendingFlows.get(state) : undefined;
  if (!flow) {
    throw new Error("Estado OAuth inválido ou expirado. Inicie a autenticação novamente.");
  }

  deps.pendingFlows.delete(state);
  deps.closeFlowListener(flow);

  if (flow.expiresAt <= Date.now()) {
    throw new Error("Solicitação de autenticação OAuth expirada.");
  }

  if (params.error) {
    const reason = redactMcpSecrets(
      params.errorDescription ? `${params.error}: ${params.errorDescription}` : params.error,
      [flow.clientSecret ?? "", flow.codeVerifier]
    );
    deps.onTokensUpdated?.({
      mcpId: flow.mcpId,
      contaChave: flow.contaChave,
      sucesso: false,
      erro: reason,
    });
    throw new Error(`Autorização OAuth recusada: ${reason}`);
  }

  const code = params.code?.trim();
  if (!code) {
    throw new Error("Código de autorização OAuth ausente no callback.");
  }

  const tokenEndpoint = flow.discovery.tokenEndpoint;
  if (!tokenEndpoint) {
    throw new Error("Token endpoint ausente nos metadados OAuth descobertos.");
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: flow.redirectUri,
    client_id: flow.clientId,
    code_verifier: flow.codeVerifier,
    resource: flow.discovery.resource ?? flow.cleanServerUrl,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (flow.clientSecret) {
    if (flow.tokenEndpointAuthMethod === "client_secret_basic") {
      const basic = Buffer.from(`${flow.clientId}:${flow.clientSecret}`, "utf8").toString("base64");
      headers.Authorization = `Basic ${basic}`;
    } else {
      form.set("client_secret", flow.clientSecret);
    }
  }

  const res = await deps.fetchImpl(tokenEndpoint, {
    method: "POST",
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  });

  const rawText = await res.text();
  let tokenJson: Record<string, unknown> = {};
  try {
    tokenJson = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    tokenJson = {};
  }

  if (!res.ok || typeof tokenJson.access_token !== "string" || !tokenJson.access_token) {
    const errDetail =
      typeof tokenJson.error_description === "string"
        ? tokenJson.error_description
        : typeof tokenJson.error === "string"
          ? tokenJson.error
          : `HTTP ${res.status}`;
    const sanitizedErr = redactMcpSecrets(`Falha ao trocar código OAuth por token: ${errDetail}`, [
      code,
      flow.codeVerifier,
      flow.clientSecret ?? "",
      typeof tokenJson.access_token === "string" ? tokenJson.access_token : "",
      typeof tokenJson.refresh_token === "string" ? tokenJson.refresh_token : "",
    ]);
    deps.onTokensUpdated?.({
      mcpId: flow.mcpId,
      contaChave: flow.contaChave,
      sucesso: false,
      erro: sanitizedErr,
    });
    throw new Error(sanitizedErr);
  }

  const now = new Date();
  const expiresInSec =
    typeof tokenJson.expires_in === "number" && Number.isFinite(tokenJson.expires_in)
      ? tokenJson.expires_in
      : null;
  const expiraEm =
    expiresInSec !== null ? new Date(now.getTime() + expiresInSec * 1000).toISOString() : null;

  const grantedScopes =
    typeof tokenJson.scope === "string" && tokenJson.scope.trim().length > 0
      ? tokenJson.scope.trim().split(/\s+/)
      : flow.scopes;

  const payload: McpOAuthSecretPayload = {
    access_token: tokenJson.access_token,
    refresh_token:
      typeof tokenJson.refresh_token === "string" && tokenJson.refresh_token.length > 0
        ? tokenJson.refresh_token
        : undefined,
    token_type:
      typeof tokenJson.token_type === "string" && tokenJson.token_type.length > 0
        ? tokenJson.token_type
        : "Bearer",
    client_id: flow.clientId,
    client_secret: flow.clientSecret,
    token_endpoint_auth_method: flow.tokenEndpointAuthMethod,
  };

  const { ciphertext, ivEnvelope } = deps.encryptPayload(payload);
  const agoraIso = now.toISOString();

  deps.db.runInTransaction(() => {
    deps.db.connection
      .prepare(
        `INSERT INTO projecao_mcp_oauth_tokens (
           conta_chave, mcp_id, app_slug, servidor_url, issuer_url,
           escopos_json, discovery_json, payload_criptografado, iv,
           expira_em, obtido_em, perdido_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(conta_chave) DO UPDATE SET
           mcp_id = excluded.mcp_id,
           app_slug = excluded.app_slug,
           servidor_url = excluded.servidor_url,
           issuer_url = excluded.issuer_url,
           escopos_json = excluded.escopos_json,
           discovery_json = excluded.discovery_json,
           payload_criptografado = excluded.payload_criptografado,
           iv = excluded.iv,
           expira_em = excluded.expira_em,
           obtido_em = excluded.obtido_em,
           perdido_em = NULL,
           atualizado_em = excluded.atualizado_em;`
      )
      .run(
        flow.contaChave,
        flow.mcpId,
        flow.appSlug,
        flow.serverUrl,
        flow.discovery.authorizationServer ?? null,
        JSON.stringify(grantedScopes),
        JSON.stringify(flow.discovery),
        ciphertext,
        ivEnvelope,
        expiraEm,
        agoraIso,
        agoraIso
      );
  });

  deps.onTokensUpdated?.({
    mcpId: flow.mcpId,
    contaChave: flow.contaChave,
    sucesso: true,
    erro: null,
  });

  return {
    contaChave: flow.contaChave,
    mcpId: flow.mcpId,
    appSlug: flow.appSlug,
    escopos: grantedScopes,
    expiraEm,
  };
}

