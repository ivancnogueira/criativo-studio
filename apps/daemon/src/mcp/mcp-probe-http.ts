import {
  randomUUID,
} from "node:crypto";
import {
  type McpProbeResultado,
  type McpServidorConfig,
} from "@criativo/contracts";
import type {
  FetchLike,
} from "../engine/providers/provider-interface.ts";
import {
  redactMcpSecrets,
} from "./mcp-redaction.ts";
import { MAX_CAPTURED_TOOLS, type McpProbeOptions, type JsonRpcEnvelope, stripUrlFragment, hasManualCredentialHeader } from "./mcp-probe-helpers.ts";
import { discoverOAuthMetadata, parseSseJsonRpcMessages, extractSseEndpointEvent } from "./mcp-probe-oauth.ts";

export async function readHttpJsonRpcEnvelope(
  response: Response,
  expectedId: string
): Promise<JsonRpcEnvelope> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const rawBody = await response.text();

  if (contentType.includes("text/event-stream") || (!rawBody.trim().startsWith("{") && rawBody.includes("data:"))) {
    const messages = parseSseJsonRpcMessages(rawBody);
    const matched =
      messages.find((m) => m.id !== undefined && String(m.id) === expectedId) ??
      messages.find((m) => m.result !== undefined || m.error !== undefined);
    if (!matched) {
      throw new Error("Stream SSE recebido sem resposta JSON-RPC válida.");
    }
    return matched;
  }

  if (!rawBody.trim()) {
    return {};
  }

  const parsed = JSON.parse(rawBody) as unknown;
  if (Array.isArray(parsed)) {
    const matched = (parsed as JsonRpcEnvelope[]).find(
      (m) => m.id !== undefined && String(m.id) === expectedId
    );
    return matched ?? ((parsed[0] as JsonRpcEnvelope) ?? {});
  }
  return (parsed as JsonRpcEnvelope) ?? {};
}

export async function probeHttpServer(
  config: McpServidorConfig,
  secrets: string[],
  timeoutMs: number,
  options: McpProbeOptions
): Promise<McpProbeResultado> {
  const startedAt = Date.now();
  const rawUrl = config.url ?? "";
  const targetUrl = stripUrlFragment(rawUrl);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: "URL do servidor MCP HTTP inválida.",
      durationMs: Date.now() - startedAt,
    };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: "O transporte HTTP MCP aceita apenas os protocolos http:// ou https://.",
      durationMs: Date.now() - startedAt,
    };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s) excedido na sondagem HTTP.`));
  }, timeoutMs);
  timer.unref?.();

  const onExternalAbort = () => controller.abort(new Error("Sondagem MCP cancelada."));
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const baseHeaders: Record<string, string> = {
    ...(config.headers ?? {}),
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (options.accessToken) {
    baseHeaders.Authorization = `Bearer ${options.accessToken}`;
  }

  let sessionId: string | null = null;

  const sendPostRpc = async (
    urlToCall: string,
    method: string,
    params: Record<string, unknown>,
    isNotification = false
  ): Promise<{ response: Response; envelope: JsonRpcEnvelope | null }> => {
    const id = isNotification ? undefined : randomUUID();
    const body = isNotification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id, method, params };
    const headers: Record<string, string> = { ...baseHeaders };
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const response = await fetchFn(urlToCall, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const respSession = response.headers.get("mcp-session-id");
    if (respSession && !sessionId) {
      sessionId = respSession;
    }

    if (response.status === 401 || response.status === 403) {
      return { response, envelope: null };
    }

    if (!response.ok) {
      return { response, envelope: null };
    }

    if (isNotification || response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => {});
      return { response, envelope: null };
    }

    const envelope = await readHttpJsonRpcEnvelope(response, String(id));
    return { response, envelope };
  };

  try {
    let activeEndpoint = targetUrl;
    let initRes = await sendPostRpc(activeEndpoint, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
    });

    // Fallback para HTTP+SSE legado (2024-11-05) quando POST inicial retorna 404/405
    if (initRes.response.status === 404 || initRes.response.status === 405) {
      await initRes.response.body?.cancel().catch(() => {});
      const sseEndpoint = await tryLegacySseHandshakeEndpoint(
        targetUrl,
        baseHeaders,
        fetchFn,
        controller.signal
      );
      if (sseEndpoint) {
        activeEndpoint = sseEndpoint;
        initRes = await sendPostRpc(activeEndpoint, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
        });
      }
    }

    if (initRes.response.status === 401 || initRes.response.status === 403) {
      const wwwAuth = initRes.response.headers.get("www-authenticate");
      await initRes.response.body?.cancel().catch(() => {});
      const discovery = await discoverOAuthMetadata(targetUrl, wwwAuth, fetchFn).catch(() => null);
      const hasOAuthMetadata = Boolean(
        discovery?.authorizationEndpoint || discovery?.tokenEndpoint || /\bbearer\b/i.test(wwwAuth ?? "")
      );

      if (hasManualCredentialHeader(config) && !hasOAuthMetadata) {
        return {
          status: "needs_key",
          toolCount: 0,
          toolNames: [],
          needs: "key",
          error: `Credencial rejeitada pelo servidor MCP (HTTP ${initRes.response.status}). Verifique a chave informada nos cabeçalhos.`,
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        status: "needs_sign_in",
        toolCount: 0,
        toolNames: [],
        needs: "sign_in",
        authUrl: discovery?.authorizationEndpoint ?? undefined,
        error: `Autenticação OAuth necessária no navegador (HTTP ${initRes.response.status}).`,
        durationMs: Date.now() - startedAt,
      };
    }

    if (!initRes.response.ok) {
      const errText = await initRes.response.text().catch(() => "");
      return {
        status: "failed",
        toolCount: 0,
        toolNames: [],
        needs: null,
        error: redactMcpSecrets(
          `Servidor MCP HTTP respondeu ${initRes.response.status}${errText ? `: ${errText.slice(0, 300)}` : ""}`,
          secrets
        ),
        durationMs: Date.now() - startedAt,
      };
    }

    if (initRes.envelope?.error) {
      const rpcErr = initRes.envelope.error;
      if (rpcErr.code === -32001) {
        const discovery = await discoverOAuthMetadata(targetUrl, undefined, fetchFn).catch(() => null);
        return {
          status: "needs_sign_in",
          toolCount: 0,
          toolNames: [],
          needs: "sign_in",
          authUrl: discovery?.authorizationEndpoint ?? undefined,
          error: redactMcpSecrets(rpcErr.message ?? "Autenticação OAuth necessária.", secrets),
          durationMs: Date.now() - startedAt,
        };
      }
      return {
        status: "failed",
        toolCount: 0,
        toolNames: [],
        needs: null,
        error: redactMcpSecrets(rpcErr.message ?? "Erro JSON-RPC no initialize MCP.", secrets),
        durationMs: Date.now() - startedAt,
      };
    }

    await sendPostRpc(activeEndpoint, "notifications/initialized", {}, true).catch(() => {});

    const toolNames: string[] = [];
    let toolCount = 0;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const listRes = await sendPostRpc(activeEndpoint, "tools/list", cursor ? { cursor } : {});
      if (listRes.response.status === 401 || listRes.response.status === 403) {
        const wwwAuth = listRes.response.headers.get("www-authenticate");
        await listRes.response.body?.cancel().catch(() => {});
        const discovery = await discoverOAuthMetadata(targetUrl, wwwAuth, fetchFn).catch(() => null);
        return {
          status: "needs_sign_in",
          toolCount: 0,
          toolNames: [],
          needs: "sign_in",
          authUrl: discovery?.authorizationEndpoint ?? undefined,
          error: `Autenticação OAuth necessária ao listar ferramentas (HTTP ${listRes.response.status}).`,
          durationMs: Date.now() - startedAt,
        };
      }

      if (!listRes.response.ok) {
        const errText = await listRes.response.text().catch(() => "");
        return {
          status: "failed",
          toolCount: 0,
          toolNames: [],
          needs: null,
          error: redactMcpSecrets(
            `Falha em tools/list (HTTP ${listRes.response.status})${errText ? `: ${errText.slice(0, 300)}` : ""}`,
            secrets
          ),
          durationMs: Date.now() - startedAt,
        };
      }

      if (listRes.envelope?.error) {
        return {
          status: "failed",
          toolCount: 0,
          toolNames: [],
          needs: null,
          error: redactMcpSecrets(listRes.envelope.error.message ?? "Erro JSON-RPC em tools/list.", secrets),
          durationMs: Date.now() - startedAt,
        };
      }

      const result = listRes.envelope?.result ?? {};
      const tools = Array.isArray(result.tools) ? (result.tools as Array<{ name?: unknown }>) : [];
      for (const item of tools) {
        if (typeof item?.name === "string" && item.name.trim()) {
          toolCount += 1;
          if (toolNames.length < MAX_CAPTURED_TOOLS) {
            toolNames.push(item.name.trim().slice(0, 128));
          }
        }
      }

      const nextCursor =
        typeof result.nextCursor === "string" && result.nextCursor.trim()
          ? result.nextCursor
          : undefined;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    if (sessionId) {
      await fetchFn(activeEndpoint, {
        method: "DELETE",
        headers: { ...baseHeaders, "Mcp-Session-Id": sessionId },
        signal: AbortSignal.timeout(2_000),
      }).catch(() => {});
    }

    return {
      status: "passed",
      toolCount,
      toolNames,
      needs: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: redactMcpSecrets(message, secrets),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function tryLegacySseHandshakeEndpoint(
  baseUrl: string,
  baseHeaders: Record<string, string>,
  fetchFn: FetchLike,
  signal: AbortSignal
): Promise<string | null> {
  const sseAbort = new AbortController();
  const forwardAbort = () => sseAbort.abort();
  signal.addEventListener("abort", forwardAbort, { once: true });

  const localTimer = setTimeout(() => sseAbort.abort(), 5_000);
  localTimer.unref?.();

  try {
    const res = await fetchFn(baseUrl, {
      method: "GET",
      headers: {
        ...baseHeaders,
        Accept: "text/event-stream",
      },
      signal: sseAbort.signal,
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (buffer.length < 16 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const endpointRel = extractSseEndpointEvent(buffer);
        if (endpointRel) {
          return new URL(endpointRel, baseUrl).toString();
        }
      }
    } finally {
      reader.releaseLock();
      await res.body.cancel().catch(() => {});
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(localTimer);
    signal.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Inspeciona um servidor MCP (STDIO ou Streamable HTTP / SSE) retornando contagem e nomes
 * de até `50` ferramentas ou solicitando `needs_sign_in` em respostas 401/403 OAuth.
 */
