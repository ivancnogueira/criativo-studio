import type {
  ContaProvedorInfo,
  LicenseActivationStatus,
  LicenseDeviceRecord,
  ProvedorStatusInfo,
  ServerClaimTicket,
  ServerInviteToken,
  ServerQuotaSummary,
  StudioServerRecord,
  UpdateStatusSnapshot,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import { getActiveServerId, requestJson, setActiveServerId } from "../http-client";

export const serversLicenseApi = {
  async obterStatusLicenca(): Promise<LicenseActivationStatus> {
    const data = await requestJson<{ license: LicenseActivationStatus }>("/api/studio/license/status");
    return data.license;
  },

  async ativarLicenca(payload: {
    license_key: string;
    email: string;
  }): Promise<LicenseActivationStatus> {
    const data = await requestJson<{ ok: boolean; license: LicenseActivationStatus }>(
      "/api/studio/license/activate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.license;
  },

  async sincronizarLicenca(): Promise<LicenseActivationStatus> {
    const data = await requestJson<{ ok: boolean; license: LicenseActivationStatus }>(
      "/api/studio/license/heartbeat",
      { method: "POST" }
    );
    return data.license;
  },

  async desvincularDispositivoLicenca(payload: {
    target_machine_id: string;
    license_key?: string;
    email?: string;
  }): Promise<{ ok: boolean; devices: LicenseDeviceRecord[]; status?: LicenseActivationStatus }> {
    return await requestJson("/api/studio/license/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async listarServidores(): Promise<{
    servers: StudioServerRecord[];
    active_server_id: string;
    quota: ServerQuotaSummary | null;
  }> {
    return await requestJson("/api/studio/servers");
  },

  async criarServidorLocal(payload: {
    nome: string;
    cor_hex?: string;
  }): Promise<{
    ok: boolean;
    server: StudioServerRecord;
    servers: StudioServerRecord[];
    quota: ServerQuotaSummary;
  }> {
    return await requestJson("/api/studio/servers/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async criarClaimVps(payload: { server_name?: string }): Promise<ServerClaimTicket> {
    const data = await requestJson<{ ok: boolean; claim: ServerClaimTicket }>(
      "/api/studio/servers/claims",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.claim;
  },

  async consultarClaimVps(claimId: string): Promise<ServerClaimTicket> {
    const data = await requestJson<{ ok: boolean; claim: ServerClaimTicket }>(
      `/api/studio/servers/claims/${encodeURIComponent(claimId)}`
    );
    return data.claim;
  },

  async entrarEmServidor(payload: {
    invite_url?: string;
    nome?: string;
    base_url?: string;
    access_token?: string;
  }): Promise<{
    ok: boolean;
    server: StudioServerRecord;
    servers: StudioServerRecord[];
    quota: ServerQuotaSummary;
  }> {
    return await requestJson("/api/studio/servers/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async selecionarServidor(serverId: string): Promise<{
    ok: boolean;
    server: StudioServerRecord;
    active_server_id: string;
    servers: StudioServerRecord[];
  }> {
    const data = await requestJson<{
      ok: boolean;
      server: StudioServerRecord;
      active_server_id: string;
      servers: StudioServerRecord[];
    }>(`/api/studio/servers/${encodeURIComponent(serverId)}/select`, {
      method: "POST",
    });
    setActiveServerId(data.active_server_id);
    return data;
  },

  async atualizarServidor(
    serverId: string,
    patch: { nome?: string; cor_hex?: string }
  ): Promise<{ ok: boolean; server: StudioServerRecord; servers: StudioServerRecord[] }> {
    return await requestJson(`/api/studio/servers/${encodeURIComponent(serverId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  async reiniciarServidor(serverId: string): Promise<{ ok: boolean; server: StudioServerRecord }> {
    return await requestJson(`/api/studio/servers/${encodeURIComponent(serverId)}/restart`, {
      method: "POST",
    });
  },

  async removerServidor(
    serverId: string,
    deleteFiles = false
  ): Promise<{ ok: boolean; servers: StudioServerRecord[]; active_server_id: string }> {
    const data = await requestJson<{
      ok: boolean;
      servers: StudioServerRecord[];
      active_server_id: string;
    }>(`/api/studio/servers/${encodeURIComponent(serverId)}?delete_files=${deleteFiles ? "1" : "0"}`, {
      method: "DELETE",
    });
    if (getActiveServerId() === serverId) {
      setActiveServerId(data.active_server_id || "primary");
    }
    return data;
  },

  async gerarConviteServidor(serverId: string): Promise<ServerInviteToken> {
    const data = await requestJson<{ ok: boolean; invite: ServerInviteToken }>(
      `/api/studio/servers/${encodeURIComponent(serverId)}/invite`,
      { method: "POST" }
    );
    return data.invite;
  },

  async prepararPonteOAuthRemoto(
    serverId: string,
    provedor: "claude" | "openai",
    authUrl: string
  ): Promise<{ ok: boolean; bridged: boolean; port?: number; reason?: string }> {
    return await requestJson(`/api/studio/servers/${encodeURIComponent(serverId)}/oauth-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor, auth_url: authUrl }),
    });
  },

  async enviarCallbackOAuthManual(
    provedor: "claude" | "openai",
    callbackUrl: string
  ): Promise<{ ok: boolean; status?: number; erro?: string }> {
    return await requestJson(`/api/provedores/${encodeURIComponent(provedor)}/oauth-callback-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_url: callbackUrl }),
    });
  },

  async conectarGeminiRemotoViaDesktop(
    serverId: string,
    label?: string
  ): Promise<{
    ok: boolean;
    canceled?: boolean;
    conta?: ContaProvedorInfo;
    provedores?: ProvedorStatusInfo[];
    uso?: UsoProvedoresSnapshot;
    erro?: string;
  }> {
    return await requestJson(
      `/api/studio/servers/${encodeURIComponent(serverId)}/connect-gemini-via-desktop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
      }
    );
  },

  async conectarOpenAiRemotoViaDesktop(
    serverId: string,
    label?: string
  ): Promise<{
    ok: boolean;
    canceled?: boolean;
    conta?: ContaProvedorInfo;
    provedores?: ProvedorStatusInfo[];
    uso?: UsoProvedoresSnapshot;
    erro?: string;
  }> {
    return await requestJson(
      `/api/studio/servers/${encodeURIComponent(serverId)}/connect-openai-via-desktop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
      }
    );
  },

  async obterStatusAtualizacao(): Promise<UpdateStatusSnapshot> {
    const data = await requestJson<{ ok: boolean; status: UpdateStatusSnapshot }>(
      "/api/studio/updates/status"
    );
    return data.status;
  },

  async verificarAtualizacoes(): Promise<UpdateStatusSnapshot> {
    const data = await requestJson<{ ok: boolean; status: UpdateStatusSnapshot }>(
      "/api/studio/updates/check",
      { method: "POST" }
    );
    return data.status;
  },

  async aplicarAtualizacao(payload?: {
    platform?: "win32" | "darwin" | "linux" | "vps-tarball";
    restart?: boolean;
  }): Promise<UpdateStatusSnapshot> {
    const data = await requestJson<{ ok: boolean; status: UpdateStatusSnapshot }>(
      "/api/studio/updates/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }
    );
    return data.status;
  },

  async triggerUpdateRestart(): Promise<{
    ok: boolean;
    triggered: boolean;
    mode: "hot_bundle" | "native_installer";
    stagedArtifactPath: string | null;
    version: string;
  }> {
    return await requestJson("/api/studio/updates/restart", {
      method: "POST",
    });
  },
};
