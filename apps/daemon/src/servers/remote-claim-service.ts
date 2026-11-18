import { randomUUID } from "node:crypto";
import type {
  ServerClaimTicket,
  ServerInviteToken,
  StudioServerRecord,
} from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { LicenseClientService } from "../license/license-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { LocalServerManager } from "./local-server-manager.ts";
import { assertServerCreationAllowed } from "./server-quota.ts";

export interface RemoteClaimServiceOptions {
  localServerManager: LocalServerManager;
  licenseService: LicenseClientService;
  wsHub?: WebSocketHub;
  fetchImpl?: FetchLike;
}

export class RemoteClaimService {
  readonly #manager: LocalServerManager;
  readonly #licenseService: LicenseClientService;
  readonly #wsHub?: WebSocketHub;
  readonly #fetchImpl: FetchLike;
  readonly #activeClaims = new Map<string, ServerClaimTicket>();
  readonly #redeemedServerIds = new Map<string, StudioServerRecord>();

  constructor(options: RemoteClaimServiceOptions) {
    this.#manager = options.localServerManager;
    this.#licenseService = options.licenseService;
    this.#wsHub = options.wsHub;
    this.#fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private buildInstallCommands(claimSecret: string, serverName: string): {
    command_bash: string;
    command_agent_prompt: string;
  } {
    const hubUrl = this.#licenseService.hubBaseUrl;
    const safeName = serverName.replace(/[^a-zA-Z0-9 _.-]/g, "").trim() || "Servidor VPS";
    const commandBash = `{ echo CRIATIVO_CLAIM=${claimSecret}; curl -fsSL ${hubUrl}/api/releases/install-server.sh; } | sudo bash -s -- --name "${safeName}" --hub-url "${hubUrl}"`;
    const commandAgentPrompt = `Execute o comando abaixo via terminal/SSH no meu servidor Linux Ubuntu/Debian para instalar o Criativo AI Studio Online e conectá-lo automaticamente:\n\n\`\`\`bash\n${commandBash}\n\`\`\``;
    return { command_bash: commandBash, command_agent_prompt: commandAgentPrompt };
  }

  /** Cria um ticket CRIATIVO_CLAIM único (expira em 15 min) no Hub da Landing Page (Print 4). */
  async createRemoteClaim(serverName = "Servidor VPS"): Promise<ServerClaimTicket> {
    const existing = this.#manager.listServers();
    assertServerCreationAllowed(this.#licenseService.getStatus(), existing, "remote_vps");

    const headers = this.#licenseService.getCredentialHeaders();
    if (!headers && !this.#licenseService.isBypassedForTests()) {
      const err = new Error("Licença ativa necessária para criar comando de VPS.") as Error & { statusCode?: number };
      err.statusCode = 402;
      throw err;
    }

    const res = await this.#fetchImpl(`${this.#licenseService.hubBaseUrl}/api/server-claims/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(headers ?? {}),
      },
      body: JSON.stringify({
        server_name: serverName,
        current_servers_count: existing.length,
      }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      message?: string;
      claim_id?: string;
      claim_secret?: string;
      server_name?: string;
      expires_at?: string;
      ttl_seconds?: number;
    };

    if (!res.ok || !data.claim_id || !data.claim_secret || !data.expires_at) {
      const err = new Error(data.message || data.error || "Não foi possível gerar comando CRIATIVO_CLAIM.") as Error & {
        statusCode?: number;
      };
      err.statusCode = res.status || 400;
      throw err;
    }

    const cmds = this.buildInstallCommands(data.claim_secret, data.server_name || serverName);
    const ticket: ServerClaimTicket = {
      claim_id: data.claim_id,
      server_name: data.server_name || serverName,
      command_bash: cmds.command_bash,
      command_agent_prompt: cmds.command_agent_prompt,
      expires_at: data.expires_at,
      ttl_seconds: data.ttl_seconds ?? 900,
      status: "pending",
      paired_server: null,
    };
    this.#activeClaims.set(ticket.claim_id, ticket);
    this.#wsHub?.broadcast("server:claim_updated", ticket);
    return ticket;
  }

  /** Consulta o Hub para verificar se a VPS já executou o redeem do CRIATIVO_CLAIM. */
  async pollRemoteClaim(claimId: string): Promise<ServerClaimTicket> {
    const cached = this.#activeClaims.get(claimId);
    if (this.#redeemedServerIds.has(claimId) && cached) {
      return {
        ...cached,
        status: "redeemed",
        paired_server: this.#redeemedServerIds.get(claimId)!,
      };
    }

    const headers = this.#licenseService.getCredentialHeaders() ?? {};
    const res = await this.#fetchImpl(
      `${this.#licenseService.hubBaseUrl}/api/server-claims/${encodeURIComponent(claimId)}/status`,
      { method: "GET", headers },
    );

    const data = (await res.json()) as {
      claim_id?: string;
      server_name?: string;
      status?: "pending" | "redeemed" | "expired";
      expires_at?: string;
      paired_info?: {
        server_name: string;
        host_url: string;
        public_ip?: string | null;
        server_api_token: string;
        app_version?: string | null;
      } | null;
      error?: string;
    };

    if (!res.ok) {
      const err = new Error(data.error || "Falha ao consultar status do pareamento.") as Error & { statusCode?: number };
      err.statusCode = res.status || 404;
      throw err;
    }

    let pairedServer: StudioServerRecord | null = null;
    if (data.status === "redeemed" && data.paired_info) {
      pairedServer = this.#manager.registerRemoteServer({
        nome: data.paired_info.server_name || cached?.server_name || "Servidor VPS",
        kind: "remote_vps",
        base_url: data.paired_info.host_url,
        access_token: data.paired_info.server_api_token,
        remote_ip: data.paired_info.public_ip ?? null,
        version: data.paired_info.app_version ?? null,
      });
      this.#redeemedServerIds.set(claimId, pairedServer);
    } else if (this.#redeemedServerIds.has(claimId)) {
      pairedServer = this.#redeemedServerIds.get(claimId)!;
    }

    const updated: ServerClaimTicket = {
      claim_id: claimId,
      server_name: data.server_name || cached?.server_name || "Servidor VPS",
      command_bash: cached?.command_bash ?? "",
      command_agent_prompt: cached?.command_agent_prompt ?? "",
      expires_at: data.expires_at || cached?.expires_at || new Date().toISOString(),
      ttl_seconds: cached?.ttl_seconds ?? 900,
      status: data.status ?? "pending",
      paired_server: pairedServer,
    };

    this.#activeClaims.set(claimId, updated);
    this.#wsHub?.broadcast("server:claim_updated", updated);
    return updated;
  }

  /** Gera link de convite seguro (criativo://join?...) para compartilhar acesso a um servidor. */
  createServerInvite(serverId: string): ServerInviteToken {
    const srv = this.#manager.getServer(serverId);
    if (!srv) {
      const err = new Error(`Servidor '${serverId}' não encontrado.`) as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const token = this.#manager.getServerAccessToken(serverId) ?? randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        nome: srv.nome,
        base_url: srv.base_url,
        access_token: token,
        expires_at: expiresAt,
      }),
      "utf8",
    ).toString("base64url");

    return {
      server_id: srv.server_id,
      invite_url: `criativo://join?data=${payload}`,
      token_masked: `${token.slice(0, 4)}••••${token.slice(-4)}`,
      expires_at: expiresAt,
    };
  }

  /** Conecta a um servidor existente via link de convite ou URL + Token (Print 2: Entrar em um servidor). */
  async joinServerByInviteOrDirect(input: {
    invite_url?: string;
    nome?: string;
    base_url?: string;
    access_token?: string;
  }): Promise<StudioServerRecord> {
    let nome = input.nome?.trim() || "";
    let baseUrl = input.base_url?.trim() || "";
    let accessToken = input.access_token?.trim() || "";

    if (input.invite_url && input.invite_url.trim()) {
      const raw = input.invite_url.trim();
      const idx = raw.indexOf("data=");
      if (idx === -1) {
        const err = new Error("Link de convite inválido.") as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      }
      const encoded = raw.slice(idx + 5).split("&")[0];
      try {
        const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
          nome?: string;
          base_url?: string;
          access_token?: string;
          expires_at?: string;
        };
        if (parsed.expires_at && Date.now() > Date.parse(parsed.expires_at)) {
          const err = new Error("Este link de convite expirou.") as Error & { statusCode?: number };
          err.statusCode = 410;
          throw err;
        }
        nome = nome || parsed.nome || "Servidor Compartilhado";
        baseUrl = baseUrl || parsed.base_url || "";
        accessToken = accessToken || parsed.access_token || "";
      } catch (e) {
        if (e instanceof Error && (e as { statusCode?: number }).statusCode) throw e;
        const err = new Error("Não foi possível decodificar o convite.") as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      }
    }

    if (!baseUrl || !accessToken) {
      const err = new Error("Informe o link de convite ou a URL e Token do servidor.") as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }

    const cleanUrl = baseUrl.replace(/\/+$/, "");
    // Valida conectividade real com o servidor alvo antes de cadastrar
    const healthRes = await this.#fetchImpl(`${cleanUrl}/api/agentes`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null);

    if (healthRes && healthRes.status === 401) {
      const err = new Error("Token de acesso recusado pelo servidor remoto.") as Error & { statusCode?: number };
      err.statusCode = 401;
      throw err;
    }

    return this.#manager.registerRemoteServer({
      nome: nome || "Servidor Conectado",
      kind: "joined",
      base_url: cleanUrl,
      access_token: accessToken,
    });
  }
}
