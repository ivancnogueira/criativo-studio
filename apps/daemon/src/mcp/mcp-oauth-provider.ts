import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  createServer,
  type Server as HttpServer,
} from "node:http";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  FetchLike,
} from "../engine/providers/provider-interface.ts";
import type {
  VaultService,
} from "../vault/vault-service.ts";
import { type McpOAuthDeps, type TailArgs, OAUTH_STATE_TTL_MS, VAULT_SEAL_KEY_NAME, type McpOAuthSecretPayload, type PendingOAuthFlow, type McpOAuthProviderOptions } from "./mcp-oauth-types.ts";
import * as flowOps from "./mcp-oauth-auth-flow.ts";
import * as tokOps from "./mcp-oauth-tokens.ts";

export * from "./mcp-oauth-types.ts";

export class McpOAuthProvider {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;
  private readonly fetchImpl: FetchLike;
  private readonly onTokensUpdated?: McpOAuthProviderOptions["onTokensUpdated"];
  private readonly pendingFlows = new Map<string, PendingOAuthFlow>();
  private readonly refreshInFlight = new Map<string, Promise<string | null>>();

  constructor(options: McpOAuthProviderOptions) {
    this.db = options.db;
    this.vault = options.vault;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onTokensUpdated = options.onTokensUpdated;
  }

  private getOrCreateSealKey(): Buffer {
    const existing = this.vault.getSecret(VAULT_SEAL_KEY_NAME);
    if (existing) {
      const buf = Buffer.from(existing, "base64");
      if (buf.length === 32) {
        return buf;
      }
    }
    const generated = randomBytes(32);
    this.vault.setSecret(VAULT_SEAL_KEY_NAME, generated.toString("base64"));
    return generated;
  }

  private encryptPayload(payload: McpOAuthSecretPayload): { ciphertext: string; ivEnvelope: string } {
    const key = this.getOrCreateSealKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString("base64"),
      ivEnvelope: `${iv.toString("hex")}:${authTag.toString("hex")}`,
    };
  }

  private decryptPayload(ciphertext: string, ivEnvelope: string): McpOAuthSecretPayload {
    const parts = ivEnvelope.split(":");
    if (parts.length !== 2) {
      throw new Error("Envelope criptográfico OAuth inválido.");
    }
    const [ivHex, tagHex] = parts;
    const key = this.getOrCreateSealKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as McpOAuthSecretPayload;
  }

  private cleanupExpiredFlows(): void {
    const now = Date.now();
    for (const [state, flow] of this.pendingFlows.entries()) {
      if (flow.expiresAt <= now) {
        this.closeFlowListener(flow);
        this.pendingFlows.delete(state);
      }
    }
  }

  private closeFlowListener(flow: PendingOAuthFlow): void {
    if (flow.loopbackTimer) {
      clearTimeout(flow.loopbackTimer);
      flow.loopbackTimer = null;
    }
    if (flow.loopbackServer) {
      try {
        flow.loopbackServer.closeAllConnections?.();
        flow.loopbackServer.close();
      } catch {
        // ignora erro ao fechar listener
      }
      flow.loopbackServer = null;
    }
  }

  private async startTemporaryLoopbackListener(state: string): Promise<{
    redirectUri: string;
    server: HttpServer;
    timer: ReturnType<typeof setTimeout>;
  }> {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Rota de callback OAuth não encontrada.");
        return;
      }

      const code = reqUrl.searchParams.get("code") ?? undefined;
      const incomingState = reqUrl.searchParams.get("state") ?? undefined;
      const error = reqUrl.searchParams.get("error") ?? undefined;
      const errorDescription = reqUrl.searchParams.get("error_description") ?? undefined;

      void this.handleCallback({ code, state: incomingState, error, errorDescription })
        .then(() => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html lang="pt-BR"><body style="background:#1A1A1A;color:#F0F0F0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Autenticação concluída</h2><p>Você já pode fechar esta janela e retornar ao Criativo Studio.</p><script>setTimeout(function(){try{window.close()}catch(e){}},400)</script></div></body></html>`
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Falha na autenticação OAuth.";
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html lang="pt-BR"><body style="background:#1A1A1A;color:#F0F0F0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Falha na autenticação</h2><p>${msg.replace(/[<>&"]/g, "")}</p></div></body></html>`
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

    server.unref?.();
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      server.close();
      throw new Error("Não foi possível alocar porta loopback para callback OAuth.");
    }

    const timer = setTimeout(() => {
      const flow = this.pendingFlows.get(state);
      if (flow) {
        this.closeFlowListener(flow);
        this.pendingFlows.delete(state);
      } else {
        try {
          server.closeAllConnections?.();
          server.close();
        } catch {
          // ignora
        }
      }
    }, OAUTH_STATE_TTL_MS);
    timer.unref?.();

    return {
      redirectUri: `http://127.0.0.1:${addr.port}/callback`,
      server,
      timer,
    };
  }


  private deps(): McpOAuthDeps {
    return {
      db: this.db,
      vault: this.vault,
      fetchImpl: this.fetchImpl,
      onTokensUpdated: this.onTokensUpdated,
      pendingFlows: this.pendingFlows,
      refreshInFlight: this.refreshInFlight,
      encryptPayload: this.encryptPayload.bind(this),
      decryptPayload: this.decryptPayload.bind(this),
      cleanupExpiredFlows: this.cleanupExpiredFlows.bind(this),
      closeFlowListener: this.closeFlowListener.bind(this),
      startTemporaryLoopbackListener: this.startTemporaryLoopbackListener.bind(this),
    };
  }

  public startAuthorizationFlow(...args: TailArgs<typeof flowOps.startAuthorizationFlowOp>): ReturnType<typeof flowOps.startAuthorizationFlowOp> {
    return flowOps.startAuthorizationFlowOp(this.deps(), ...args);
  }

  public handleCallback(...args: TailArgs<typeof flowOps.handleCallbackOp>): ReturnType<typeof flowOps.handleCallbackOp> {
    return flowOps.handleCallbackOp(this.deps(), ...args);
  }

  public getValidAccessToken(...args: TailArgs<typeof tokOps.getValidAccessTokenOp>): ReturnType<typeof tokOps.getValidAccessTokenOp> {
    return tokOps.getValidAccessTokenOp(this.deps(), ...args);
  }

  public refreshAfterUnauthorized(...args: TailArgs<typeof tokOps.refreshAfterUnauthorizedOp>): ReturnType<typeof tokOps.refreshAfterUnauthorizedOp> {
    return tokOps.refreshAfterUnauthorizedOp(this.deps(), ...args);
  }

  public markAccountLost(...args: TailArgs<typeof tokOps.markAccountLostOp>): ReturnType<typeof tokOps.markAccountLostOp> {
    return tokOps.markAccountLostOp(this.deps(), ...args);
  }

  public signOut(...args: TailArgs<typeof tokOps.signOutOp>): ReturnType<typeof tokOps.signOutOp> {
    return tokOps.signOutOp(this.deps(), ...args);
  }

  public getOAuthStatus(...args: TailArgs<typeof tokOps.getOAuthStatusOp>): ReturnType<typeof tokOps.getOAuthStatusOp> {
    return tokOps.getOAuthStatusOp(this.deps(), ...args);
  }

  public listOAuthAccounts(...args: TailArgs<typeof tokOps.listOAuthAccountsOp>): ReturnType<typeof tokOps.listOAuthAccountsOp> {
    return tokOps.listOAuthAccountsOp(this.deps(), ...args);
  }

  public close(): void {
    for (const flow of this.pendingFlows.values()) {
      this.closeFlowListener(flow);
    }
    this.pendingFlows.clear();
  }
}

