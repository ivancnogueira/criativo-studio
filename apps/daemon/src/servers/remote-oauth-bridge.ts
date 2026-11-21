import http, { type Server } from "node:http";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { LocalServerManager } from "./local-server-manager.ts";

export interface RemoteOAuthBridgeOptions {
  localServerManager: LocalServerManager;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface ActiveBridgeEntry {
  port: number;
  server: Server;
  timer: NodeJS.Timeout;
  close: () => void;
}

const DEFAULT_BRIDGE_TIMEOUT_MS = 5 * 60_000;

function extractLoopbackRedirect(rawAuthUrl: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(rawAuthUrl);
    const redirectUri = parsed.searchParams.get("redirect_uri")?.trim();
    if (!redirectUri) return null;
    const redUrl = new URL(redirectUri);
    const host = redUrl.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      return null;
    }
    const portNum = Number(redUrl.port);
    if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
      return null;
    }
    return { host: "127.0.0.1", port: portNum };
  } catch {
    return null;
  }
}

function renderBridgeResultHtml(ok: boolean, message: string): string {
  const accent = ok ? "#31CF76" : "#FD2F3B";
  const title = ok ? "Autenticação concluída!" : "Falha na autenticação remota";
  const escaped = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Criativo AI Studio</title>
  <style>
    body { margin: 0; font-family: Inter, -apple-system, sans-serif; background: #0D0D0D; color: #FFFFFF; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { max-width: 440px; padding: 28px 24px; border-radius: 16px; background: #18181A; border: 1px solid rgba(255,255,255,0.1); text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
    .dot { width: 12px; height: 12px; border-radius: 999px; background: ${accent}; display: inline-block; margin-bottom: 12px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    p { font-size: 13px; color: #B4B4BC; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <span class="dot"></span>
    <h1>${title}</h1>
    <p>${escaped}</p>
  </div>
</body>
</html>`;
}

/**
 * Ponte temporária em loopback local (Desktop -> VPS) para encaminhar callbacks OAuth
 * (`127.0.0.1:<porta>/auth/callback`) quando o navegador roda no Desktop e a CLI roda na VPS.
 */
export class RemoteOAuthBridgeService {
  private readonly localServerManager: LocalServerManager;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly activeBridges = new Map<number, ActiveBridgeEntry>();

  constructor(options: RemoteOAuthBridgeOptions) {
    this.localServerManager = options.localServerManager;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  }

  public async prepareBridgeForAuthUrl(input: {
    serverId: string;
    provedor: "claude" | "openai";
    authUrl: string;
  }): Promise<{ ok: boolean; bridged: boolean; port?: number; reason?: string }> {
    const srv = this.localServerManager.getServer(input.serverId);
    if (!srv) {
      return { ok: false, bridged: false, reason: "server_not_found" };
    }
    if (srv.kind === "primary" || srv.kind === "local_child") {
      return { ok: true, bridged: false, reason: "local_server" };
    }

    const loopback = extractLoopbackRedirect(input.authUrl);
    if (!loopback) {
      return { ok: true, bridged: false, reason: "no_loopback_redirect" };
    }

    const existing = this.activeBridges.get(loopback.port);
    if (existing) {
      existing.close();
    }

    const accessToken = this.localServerManager.getServerAccessToken(srv.server_id);
    const targetBaseUrl = srv.base_url.replace(/\/+$/, "");

    let server: Server | null = null;
    let timer: NodeJS.Timeout | null = null;

    const closeBridge = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const cur = this.activeBridges.get(loopback.port);
      if (cur && cur.server === server) {
        this.activeBridges.delete(loopback.port);
      }
      try {
        server?.closeAllConnections?.();
        server?.close();
      } catch {
        // ignora erro ao encerrar ponte temporária
      }
    };

    server = http.createServer(async (req, res) => {
      const reqUrl = req.url || "/";
      if (reqUrl === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const relayRes = await this.fetchImpl(
          `${targetBaseUrl}/api/provedores/${encodeURIComponent(input.provedor)}/oauth-callback-relay`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ callback_path: reqUrl }),
          },
        );
        const relayPayload = (await relayRes.json().catch(() => ({}))) as {
          ok?: boolean;
          erro?: string;
        };

        if (!relayRes.ok || relayPayload.ok === false) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            renderBridgeResultHtml(
              false,
              relayPayload.erro ||
                "Não foi possível entregar o retorno OAuth ao servidor remoto. Tente reiniciar o login.",
            ),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          renderBridgeResultHtml(
            true,
            `Autenticação concluída em '${srv.nome}'! Você já pode fechar esta aba e voltar ao Criativo AI Studio.`,
          ),
        );
      } catch (err) {
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          renderBridgeResultHtml(
            false,
            err instanceof Error
              ? `Erro de conexão ao encaminhar login para '${srv.nome}': ${err.message}`
              : "Erro ao encaminhar callback OAuth para o servidor remoto.",
          ),
        );
      } finally {
        setTimeout(closeBridge, 400).unref?.();
      }
    });

    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server!.once("error", rejectListen);
        server!.listen(loopback.port, loopback.host, () => {
          server!.off("error", rejectListen);
          resolveListen();
        });
      });
    } catch {
      closeBridge();
      return { ok: true, bridged: false, port: loopback.port, reason: "port_busy" };
    }

    server.unref?.();
    timer = setTimeout(closeBridge, this.timeoutMs);
    timer.unref?.();

    this.activeBridges.set(loopback.port, {
      port: loopback.port,
      server,
      timer,
      close: closeBridge,
    });

    return { ok: true, bridged: true, port: loopback.port };
  }

  public closeAll(): void {
    for (const entry of [...this.activeBridges.values()]) {
      entry.close();
    }
    this.activeBridges.clear();
  }
}
