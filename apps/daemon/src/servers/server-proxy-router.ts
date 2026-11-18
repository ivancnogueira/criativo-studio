import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { LocalServerManager } from "./local-server-manager.ts";

export interface ServerProxyRouterOptions {
  localServerManager: LocalServerManager;
  fetchImpl?: FetchLike;
}

const SKIP_HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function isManagerOwnedRoute(path: string): boolean {
  return (
    path.startsWith("/api/studio/servers") ||
    path.startsWith("/api/studio/license") ||
    path === "/health" ||
    path === "/api/health"
  );
}

export class ServerProxyRouter {
  readonly #manager: LocalServerManager;
  readonly #fetchImpl: FetchLike;

  constructor(options: ServerProxyRouterOptions) {
    this.#manager = options.localServerManager;
    this.#fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  resolveTargetRequest(
    req: IncomingMessage,
    url: URL,
  ): { serverId: string; forwardPathWithQuery: string } | null {
    if (req.headers["x-criativo-proxy-hop"] === "1") {
      return null;
    }

    const proxyMatch = url.pathname.match(/^\/api\/servers-proxy\/([^/]+)(\/.*)$/);
    if (proxyMatch) {
      const serverId = decodeURIComponent(proxyMatch[1]);
      if (!serverId || serverId === "primary") return null;
      return {
        serverId,
        forwardPathWithQuery: `${proxyMatch[2]}${url.search}`,
      };
    }

    if (isManagerOwnedRoute(url.pathname)) {
      return null;
    }

    const headerServerId =
      typeof req.headers["x-criativo-server-id"] === "string"
        ? req.headers["x-criativo-server-id"].trim()
        : "";
    const queryServerId = url.searchParams.get("serverId")?.trim() ?? "";
    const targetId = headerServerId || queryServerId;

    if (!targetId || targetId === "primary") {
      return null;
    }

    const cleanParams = new URLSearchParams(url.searchParams);
    cleanParams.delete("serverId");
    const qs = cleanParams.toString();
    return {
      serverId: targetId,
      forwardPathWithQuery: `${url.pathname}${qs ? `?${qs}` : ""}`,
    };
  }

  private async readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Encaminha requisições HTTP REST/Media/SSE para servidor local filho ou VPS remota. */
  async tryProxyHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    method: string,
  ): Promise<boolean> {
    const target = this.resolveTargetRequest(req, url);
    if (!target) return false;

    const srv = this.#manager.getServer(target.serverId);
    if (!srv) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ erro: `Servidor '${target.serverId}' não encontrado.` }));
      return true;
    }

    let resolvedSrv = srv;
    if (srv.kind === "local_child" && srv.status !== "online") {
      resolvedSrv = await this.#manager.ensureRunning(srv.server_id);
    }

    const accessToken = this.#manager.getServerAccessToken(resolvedSrv.server_id);
    const forwardHeaders: Record<string, string> = {
      "x-criativo-proxy-hop": "1",
    };

    for (const [k, v] of Object.entries(req.headers)) {
      const lower = k.toLowerCase();
      if (SKIP_HOP_BY_HOP.has(lower) || lower === "x-criativo-server-id") continue;
      if (typeof v === "string") forwardHeaders[lower] = v;
      else if (Array.isArray(v)) forwardHeaders[lower] = v.join(", ");
    }

    if (accessToken) {
      forwardHeaders.authorization = `Bearer ${accessToken}`;
    }

    const hasBody = method !== "GET" && method !== "HEAD";
    const bodyBuf = hasBody ? await this.readBodyBuffer(req) : undefined;
    const destUrl = `${resolvedSrv.base_url.replace(/\/+$/, "")}${target.forwardPathWithQuery}`;

    try {
      const upstream = await this.#fetchImpl(destUrl, {
        method,
        headers: forwardHeaders,
        ...(hasBody && bodyBuf ? { body: new Uint8Array(bodyBuf) } : {}),
      });

      const outHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
      };
      upstream.headers?.forEach?.((value: string, key: string) => {
        const lower = key.toLowerCase();
        if (!SKIP_HOP_BY_HOP.has(lower) && lower !== "content-encoding") {
          outHeaders[key] = value;
        }
      });

      const respBuf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, outHeaders);
      res.end(respBuf);
      return true;
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          erro: `Falha ao conectar ao servidor '${resolvedSrv.nome}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        }),
      );
      return true;
    }
  }

  /** Faz proxy TCP bidirecional para upgrades WebSocket (/ws?serverId=...) sem expor token no browser. */
  async tryProxyWebSocketUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
  ): Promise<boolean> {
    const serverId = url.searchParams.get("serverId")?.trim();
    if (!serverId || serverId === "primary") return false;

    const srv = this.#manager.getServer(serverId);
    if (!srv) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return true;
    }

    let resolvedSrv = srv;
    if (srv.kind === "local_child" && srv.status !== "online") {
      resolvedSrv = await this.#manager.ensureRunning(srv.server_id);
    }

    const accessToken = this.#manager.getServerAccessToken(resolvedSrv.server_id);
    const destParsed = new URL(resolvedSrv.base_url);
    const isTls = destParsed.protocol === "https:";
    const targetPort = Number(destParsed.port || (isTls ? 443 : 80));
    const wsKey = String(req.headers["sec-websocket-key"] ?? "");

    const headers: Record<string, string> = {
      Host: destParsed.host,
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": wsKey,
      "Sec-WebSocket-Version": String(req.headers["sec-websocket-version"] ?? "13"),
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const transport = isTls ? https : http;
    const proxyReq = transport.request({
      hostname: destParsed.hostname,
      port: targetPort,
      path: accessToken ? `/ws?token=${encodeURIComponent(accessToken)}` : "/ws",
      method: "GET",
      headers,
    });

    proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
      const acceptHeader = _proxyRes.headers["sec-websocket-accept"] ?? "";
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          acceptHeader ? `Sec-WebSocket-Accept: ${acceptHeader}` : "",
          "\r\n",
        ]
          .filter(Boolean)
          .join("\r\n"),
      );
      if (proxyHead.length > 0) socket.write(proxyHead);
      if (head.length > 0) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      const closeBoth = () => {
        if (!socket.destroyed) socket.destroy();
        if (!proxySocket.destroyed) proxySocket.destroy();
      };
      socket.on("error", closeBoth);
      proxySocket.on("error", closeBoth);
    });

    proxyReq.on("response", (res) => {
      socket.write(`HTTP/1.1 ${res.statusCode ?? 502} Bad Gateway\r\n\r\n`);
      socket.destroy();
    });

    proxyReq.on("error", () => {
      if (!socket.destroyed) {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
      }
    });

    proxyReq.end();
    return true;
  }
}
