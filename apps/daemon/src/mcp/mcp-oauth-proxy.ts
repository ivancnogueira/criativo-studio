import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { McpOAuthProvider } from "./mcp-oauth-provider.ts";
import { stripUrlFragment } from "./mcp-probe.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const POST_HEADER_TIMEOUT_MS = 5 * 60_000;
const OTHER_HEADER_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
export const JSON_RPC_SIGN_IN_REQUIRED_CODE = -32001;
export const PROXY_TOKEN_HEADER_NAME = "X-Criativo-Proxy-Token";

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "mcp-method",
  "mcp-name",
  "last-event-id",
]);

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "mcp-session-id",
  "mcp-protocol-version",
];

export interface McpProxyRouteEntry {
  mcpId: string;
  targetUrl: string;
  contaChave?: string;
  extraHeaders: Record<string, string>;
  proxySecret: string;
}

export interface RegisterProxyRouteInput {
  mcpId: string;
  targetUrl: string;
  contaChave?: string;
  extraHeaders?: Record<string, string>;
  rotateSecret?: boolean;
}

export interface RegisteredProxyRouteInfo {
  proxyUrl: string;
  proxyHeaderName: string;
  proxySecret: string;
}

export interface McpOAuthProxyOptions {
  oauthProvider: McpOAuthProvider;
  fetchImpl?: FetchLike;
}

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return true;
  const clean = remoteAddress.trim().toLowerCase();
  return clean === "127.0.0.1" || clean === "::1" || clean === "::ffff:127.0.0.1";
}

function isAllowedHostHeader(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.trim().toLowerCase();
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorizedProxyRequest(req: IncomingMessage, expectedSecret: string): boolean {
  const customHeaderRaw = req.headers[PROXY_TOKEN_HEADER_NAME.toLowerCase()];
  if (typeof customHeaderRaw === "string" && customHeaderRaw.length > 0) {
    return constantTimeEquals(customHeaderRaw.trim(), expectedSecret);
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return constantTimeEquals(authHeader.slice("Bearer ".length).trim(), expectedSecret);
  }
  return false;
}

function sendHttpRefusal(res: ServerResponse, status: number, errorCode: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: errorCode }));
}

type JsonRpcId = string | number | null;

function extractJsonRpcRequestIds(body: Buffer | null): {
  isBatch: boolean;
  ids: JsonRpcId[];
} {
  if (!body || body.length === 0) {
    return { isBatch: false, ids: [null] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return { isBatch: false, ids: [null] };
  }

  const isBatch = Array.isArray(parsed);
  const items = isBatch ? (parsed as unknown[]) : [parsed];
  const ids: JsonRpcId[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.method !== "string") continue;
    if (typeof rec.id === "string" || typeof rec.id === "number" || rec.id === null) {
      ids.push(rec.id);
    }
  }

  return { isBatch, ids };
}

function sendJsonRpcSignInRequired(
  res: ServerResponse,
  method: string,
  body: Buffer | null,
  mcpId: string,
  message = "Autenticação OAuth necessária no navegador."
): void {
  if (method !== "POST") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: JSON_RPC_SIGN_IN_REQUIRED_CODE,
          message,
          data: { action: "sign_in", mcpId },
        },
      })
    );
    return;
  }

  const { isBatch, ids } = extractJsonRpcRequestIds(body);
  if (ids.length === 0) {
    // Corpo composto apenas de notificações JSON-RPC
    res.writeHead(202);
    res.end();
    return;
  }

  const payloads = ids.map((id) => ({
    jsonrpc: "2.0",
    id,
    error: {
      code: JSON_RPC_SIGN_IN_REQUIRED_CODE,
      message,
      data: { action: "sign_in", mcpId },
    },
  }));

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(isBatch ? payloads : payloads[0]));
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      return "too-large";
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

async function pipeReadableStream(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse,
  signal: AbortSignal
): Promise<void> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        if (!res.write(value)) {
          await once(res, "drain", { signal });
        }
      }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Proxy loopback seguro em `127.0.0.1` que isola tokens OAuth reais de subprocessos ACP e LLMs.
 * Injeta `Authorization: Bearer` exclusivamente na requisição upstream e traduz `401` em `-32001`.
 */
export class McpOAuthProxy {
  private readonly oauthProvider: McpOAuthProvider;
  private readonly fetchImpl: FetchLike;
  private readonly routes = new Map<string, McpProxyRouteEntry>();
  private server: HttpServer | null = null;
  private port: number | null = null;
  private startPromise: Promise<{ port: number; baseUrl: string }> | null = null;

  constructor(options: McpOAuthProxyOptions) {
    this.oauthProvider = options.oauthProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public get listeningPort(): number | null {
    return this.port;
  }

  /**
   * Inicia o servidor HTTP estritamente em `127.0.0.1:0` (idempotente).
   */
  public async start(): Promise<{ port: number; baseUrl: string }> {
    if (this.server && this.port !== null) {
      return { port: this.port, baseUrl: `http://127.0.0.1:${this.port}` };
    }
    if (this.startPromise) {
      return await this.startPromise;
    }

    this.startPromise = (async () => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res).catch((err) => {
          if (res.destroyed) return;
          if (res.headersSent) {
            res.destroy();
            return;
          }
          const msg = err instanceof Error ? err.message : "Erro interno no proxy MCP.";
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: msg },
            })
          );
        });
      });

      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });

      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        throw new Error("Não foi possível obter a porta loopback do McpOAuthProxy.");
      }

      this.server = server;
      this.port = addr.port;
      return { port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` };
    })();

    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Registra ou atualiza uma rota loopback autenticada em memória para um servidor MCP.
   */
  public registerServerRoute(input: RegisterProxyRouteInput): RegisteredProxyRouteInfo {
    if (this.port === null) {
      throw new Error("McpOAuthProxy deve ser iniciado via start() antes de registrar rotas.");
    }

    const cleanHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.extraHeaders ?? {})) {
      const trimmedKey = key.trim();
      if (!trimmedKey || trimmedKey.toLowerCase() === "authorization") continue;
      cleanHeaders[trimmedKey] = value;
    }

    const existing = this.routes.get(input.mcpId);
    const proxySecret =
      existing && !input.rotateSecret && existing.targetUrl === input.targetUrl
        ? existing.proxySecret
        : randomBytes(32).toString("base64url");

    this.routes.set(input.mcpId, {
      mcpId: input.mcpId,
      targetUrl: input.targetUrl,
      contaChave: input.contaChave,
      extraHeaders: cleanHeaders,
      proxySecret,
    });

    return {
      proxyUrl: `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(input.mcpId)}`,
      proxyHeaderName: PROXY_TOKEN_HEADER_NAME,
      proxySecret,
    };
  }

  public getRouteInfo(mcpId: string): RegisteredProxyRouteInfo | null {
    if (this.port === null) return null;
    const entry = this.routes.get(mcpId);
    if (!entry) return null;
    return {
      proxyUrl: `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(entry.mcpId)}`,
      proxyHeaderName: PROXY_TOKEN_HEADER_NAME,
      proxySecret: entry.proxySecret,
    };
  }

  public unregisterServerRoute(mcpId: string): boolean {
    return this.routes.delete(mcpId);
  }

  private buildUpstreamHeaders(
    route: McpProxyRouteEntry,
    accessToken: string,
    incomingReq: IncomingMessage
  ): Headers {
    const headers = new Headers();

    for (const [k, v] of Object.entries(route.extraHeaders)) {
      if (k.toLowerCase() === "authorization") continue;
      headers.set(k, v);
    }

    for (const [rawName, rawValue] of Object.entries(incomingReq.headers)) {
      if (typeof rawValue !== "string") continue;
      const lower = rawName.toLowerCase();
      if (FORWARDED_REQUEST_HEADERS.has(lower) || lower.startsWith("mcp-param-")) {
        headers.set(lower, rawValue);
      }
    }

    headers.set("Authorization", `Bearer ${accessToken}`);
    return headers;
  }

  private async forwardUpstream(
    route: McpProxyRouteEntry,
    accessToken: string,
    method: string,
    body: Buffer | null,
    incomingReq: IncomingMessage,
    signal: AbortSignal
  ): Promise<Response> {
    const cleanTarget = stripUrlFragment(route.targetUrl);
    let currentUrl = new URL(cleanTarget);
    const expectedOrigin = currentUrl.origin;
    const headers = this.buildUpstreamHeaders(route, accessToken, incomingReq);
    const timeoutMs = method === "POST" ? POST_HEADER_TIMEOUT_MS : OTHER_HEADER_TIMEOUT_MS;

    for (let hop = 0; ; hop += 1) {
      const attemptController = new AbortController();
      const forwardAbort = () => attemptController.abort(signal.reason);
      signal.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => {
        attemptController.abort(new Error("Tempo limite excedido aguardando resposta do servidor MCP."));
      }, timeoutMs);
      timer.unref?.();

      let response: Response;
      try {
        response = await this.fetchImpl(currentUrl.toString(), {
          method,
          headers,
          ...(body ? { body: new Uint8Array(body) } : {}),
          redirect: "manual",
          signal: attemptController.signal,
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", forwardAbort);
      }

      if (response.status < 300 || response.status >= 400) {
        return response;
      }

      await response.body?.cancel().catch(() => {});
      const location = response.headers.get("location");
      const isSafeRedirect = response.status === 307 || response.status === 308;

      if (!location || !isSafeRedirect || hop >= MAX_REDIRECTS) {
        throw new Error("Redirecionamento HTTP não permitido no proxy OAuth MCP.");
      }

      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== expectedOrigin) {
        throw new Error("Redirecionamento cross-origin bloqueado para proteção do token Bearer.");
      }
      currentUrl = nextUrl;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = this.port;
    if (
      port === null ||
      !isLoopbackRemoteAddress(req.socket?.remoteAddress) ||
      !isAllowedHostHeader(req.headers.host, port)
    ) {
      sendHttpRefusal(res, 403, "forbidden");
      return;
    }

    const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const match = /^\/mcp\/([^/]+)$/.exec(reqUrl.pathname);
    if (!match) {
      sendHttpRefusal(res, 403, "forbidden");
      return;
    }

    let mcpId: string;
    try {
      mcpId = decodeURIComponent(match[1]);
    } catch {
      sendHttpRefusal(res, 403, "forbidden");
      return;
    }

    const route = this.routes.get(mcpId);
    if (!route || !isAuthorizedProxyRequest(req, route.proxySecret)) {
      sendHttpRefusal(res, 403, "forbidden");
      return;
    }

    const method = (req.method ?? "").toUpperCase();
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      res.writeHead(405, { Allow: "POST, GET, DELETE" });
      res.end();
      return;
    }

    const body = method === "POST" ? await readRequestBody(req) : null;
    if (body === "too-large") {
      sendHttpRefusal(res, 413, "request_too_large");
      return;
    }

    const abortController = new AbortController();
    res.once("close", () => abortController.abort());

    const token = await this.oauthProvider.getValidAccessToken(route.mcpId, route.contaChave);
    if (!token) {
      sendJsonRpcSignInRequired(res, method, body, route.mcpId);
      return;
    }

    let upstream = await this.forwardUpstream(
      route,
      token,
      method,
      body,
      req,
      abortController.signal
    );

    if (upstream.status === 401) {
      await upstream.body?.cancel().catch(() => {});
      const refreshedToken = await this.oauthProvider.refreshAfterUnauthorized(
        route.mcpId,
        token,
        route.contaChave
      );
      if (!refreshedToken) {
        sendJsonRpcSignInRequired(res, method, body, route.mcpId);
        return;
      }

      upstream = await this.forwardUpstream(
        route,
        refreshedToken,
        method,
        body,
        req,
        abortController.signal
      );

      if (upstream.status === 401) {
        await upstream.body?.cancel().catch(() => {});
        this.oauthProvider.markAccountLost(route.mcpId, route.contaChave);
        sendJsonRpcSignInRequired(res, method, body, route.mcpId);
        return;
      }
    }

    const responseHeaders: Record<string, string> = {};
    for (const headerName of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(headerName);
      if (value !== null) {
        responseHeaders[headerName] = value;
      }
    }

    res.writeHead(upstream.status, responseHeaders);
    res.flushHeaders?.();

    if (!upstream.body) {
      res.end();
      return;
    }

    await pipeReadableStream(upstream.body, res, abortController.signal);
  }

  /**
   * Encerra o servidor HTTP loopback graciosamente no shutdown do daemon.
   */
  public async close(): Promise<void> {
    const activeServer = this.server;
    this.server = null;
    this.port = null;
    this.routes.clear();
    if (!activeServer) return;

    await new Promise<void>((resolveClose) => {
      activeServer.close(() => resolveClose());
      activeServer.closeAllConnections?.();
    });
  }
}
