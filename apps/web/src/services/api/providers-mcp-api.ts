import type {
  ApiKeyMetadata,
  ConectorIntegracaoInfo,
  ContaProvedorInfo,
  HabilidadeInstaladaInfo,
  IdentidadeMarcaStudio,
  McpAcessoAgentes,
  McpOAuthAccountView,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  McpTransporte,
  OnboardingEstado,
  PacoteUpgradeInfo,
  ProvedorStatusInfo,
  ProviderName,
  RelatorioAnalyticsHost,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import { apiFetch, requestJson } from "../http-client";

export const providersMcpApi = {
  async getVaultStatus(): Promise<Array<{ chave_nome: string; atualizado_em: string }>> {
    const res = await apiFetch("/api/vault/status");
    const json = (await res.json()) as {
      chaves: Array<{ chave_nome: string; atualizado_em: string }>;
    };
    return json.chaves ?? [];
  },

  async saveVaultSecret(chave_nome: string, valor: string): Promise<void> {
    await apiFetch("/api/vault/salvar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave_nome, valor }),
    });
  },

  async listVaultApiKeys(agenteId?: string | null): Promise<ApiKeyMetadata[]> {
    const suffix = agenteId ? `?agente_id=${encodeURIComponent(agenteId)}` : "";
    const data = await requestJson<{ keys?: ApiKeyMetadata[] }>(`/api/cofre/api-keys${suffix}`);
    return data.keys ?? [];
  },

  async saveVaultApiKey(input: {
    name: string;
    value: string;
    scope: "todos_agentes" | "agente_especifico";
    agente_id?: string | null;
  }): Promise<{ status: "saved"; name: string; scope: "todos_agentes" | "agente_especifico" }> {
    return await requestJson("/api/cofre/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async removeVaultApiKey(
    nome: string,
    scope: "todos_agentes" | "agente_especifico",
    agenteId?: string | null
  ): Promise<{ removed: boolean }> {
    const qs = new URLSearchParams({ scope });
    if (agenteId) qs.set("agente_id", agenteId);
    return await requestJson<{ removed: boolean }>(
      `/api/cofre/api-keys/${encodeURIComponent(nome)}?${qs.toString()}`,
      { method: "DELETE" }
    );
  },

  async getOnboarding(): Promise<OnboardingEstado> {
    const json = await requestJson<{ onboarding: OnboardingEstado }>("/api/onboarding");
    return json.onboarding;
  },

  async updateOnboarding(patch: Partial<OnboardingEstado>): Promise<OnboardingEstado> {
    const json = await requestJson<{ onboarding: OnboardingEstado }>("/api/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return json.onboarding;
  },

  async setSetupAssistantState(
    action: "dismiss" | "reopen"
  ): Promise<{ ok: boolean; onboarding: OnboardingEstado; setup_assistant_visible: boolean }> {
    return await requestJson("/api/onboarding/setup-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  },

  async setVpsAssistantState(
    action: "dismiss" | "reopen"
  ): Promise<{ ok: boolean; vps_assistant_visible: boolean }> {
    return await requestJson("/api/servers/vps-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  },

  async listProvidersStatus(refresh = false): Promise<ProvedorStatusInfo[]> {
    const res = await apiFetch(`/api/provedores/status${refresh ? "?refresh=1" : ""}`);
    const json = (await res.json()) as { provedores: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async connectProvider(provedor: ProviderName, apiKey?: string): Promise<ProvedorStatusInfo> {
    const res = await apiFetch("/api/provedores/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor, api_key: apiKey }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      provedor?: ProvedorStatusInfo;
      erro?: string;
    };
    if (!res.ok || !json.provedor) {
      throw new Error(json.erro || `Falha ao conectar provedor (${res.status}).`);
    }
    return json.provedor;
  },

  async disconnectProvider(provedor: ProviderName): Promise<ProvedorStatusInfo> {
    const res = await apiFetch("/api/provedores/desconectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor }),
    });
    const json = (await res.json()) as { provedor: ProvedorStatusInfo };
    return json.provedor;
  },

  async getProvidersUsage(refresh = false): Promise<UsoProvedoresSnapshot> {
    const res = await apiFetch(`/api/provedores/uso${refresh ? "?refresh=1" : ""}`);
    const json = (await res.json()) as { uso: UsoProvedoresSnapshot };
    return json.uso;
  },

  async setProviderPool(
    provedor: ProviderName | string,
    payload: {
      habilitado?: boolean;
      contas_excluidas?: string[];
      conta_em_uso?: string | null;
    }
  ): Promise<ProvedorStatusInfo[]> {
    const res = await apiFetch(`/api/provedores/${encodeURIComponent(provedor)}/pool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { provedores: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async connectProviderViaBrowser(
    provedor: "gemini" | "claude" | "openai",
    label?: string
  ): Promise<{
    ok: boolean;
    canceled?: boolean;
    conta?: ContaProvedorInfo;
    provedores?: ProvedorStatusInfo[];
    uso?: UsoProvedoresSnapshot;
    erro?: string;
  }> {
    const res = await apiFetch(`/api/provedores/${encodeURIComponent(provedor)}/conectar-navegador`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    return (await res.json()) as {
      ok: boolean;
      canceled?: boolean;
      conta?: ContaProvedorInfo;
      provedores?: ProvedorStatusInfo[];
      uso?: UsoProvedoresSnapshot;
      erro?: string;
    };
  },

  async cancelProviderBrowserSignIn(
    provedor: "gemini" | "claude" | "openai"
  ): Promise<{ ok: boolean; canceled?: boolean }> {
    const res = await apiFetch(`/api/provedores/${encodeURIComponent(provedor)}/cancelar-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return (await res.json()) as { ok: boolean; canceled?: boolean };
  },

  async setProviderModelsVisibility(
    provedor: ProviderName,
    ocultos: string[]
  ): Promise<ProvedorStatusInfo[]> {
    const res = await apiFetch(
      `/api/provedores/${encodeURIComponent(provedor)}/modelos-visibilidade`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ocultos }),
      }
    );
    const json = (await res.json()) as { provedores?: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async addProviderAccount(
    provedor: ProviderName | string,
    payload: {
      email: string;
      access_token: string;
      label?: string;
      refresh_token?: string;
    }
  ): Promise<{ conta: ContaProvedorInfo; provedores: ProvedorStatusInfo[] }> {
    const res = await apiFetch(`/api/provedores/${encodeURIComponent(provedor)}/contas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { conta: ContaProvedorInfo; provedores: ProvedorStatusInfo[] };
  },

  async removeProviderAccount(
    provedor: ProviderName | string,
    contaId: string
  ): Promise<ProvedorStatusInfo[]> {
    const res = await apiFetch(
      `/api/provedores/${encodeURIComponent(provedor)}/contas/${encodeURIComponent(contaId)}`,
      { method: "DELETE" }
    );
    const json = (await res.json()) as { provedores: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async getUsageAnalytics(params?: {
    dias?: number;
    agente_id?: string | null;
  }): Promise<RelatorioAnalyticsHost> {
    const qs = new URLSearchParams();
    if (params?.dias !== undefined) qs.set("dias", String(params.dias));
    if (params?.agente_id) qs.set("agente_id", params.agente_id);
    const query = qs.toString();
    const res = await apiFetch(`/api/uso/analytics${query ? `?${query}` : ""}`);
    const json = (await res.json()) as { analytics: RelatorioAnalyticsHost };
    return json.analytics;
  },

  async listSkills(): Promise<HabilidadeInstaladaInfo[]> {
    const res = await apiFetch("/api/habilidades");
    const json = (await res.json()) as { habilidades: HabilidadeInstaladaInfo[] };
    return json.habilidades ?? [];
  },

  async listConnectors(): Promise<ConectorIntegracaoInfo[]> {
    const res = await apiFetch("/api/conectores");
    const json = (await res.json()) as { conectores: ConectorIntegracaoInfo[] };
    return json.conectores ?? [];
  },

  async configureConnector(
    conectorId: string,
    payload: {
      segredos?: Record<string, string>;
      agente_orquestrador_id?: string;
      nome?: string;
      comando?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  ): Promise<{ ok: boolean; conectores: ConectorIntegracaoInfo[] }> {
    const res = await apiFetch(`/api/conectores/${encodeURIComponent(conectorId)}/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { ok: boolean; conectores: ConectorIntegracaoInfo[] };
  },

  async testConnector(conectorId: string): Promise<{
    ok: boolean;
    mensagem: string;
    detalhes?: unknown;
  }> {
    const res = await apiFetch(`/api/conectores/${encodeURIComponent(conectorId)}/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return (await res.json()) as { ok: boolean; mensagem: string; detalhes?: unknown };
  },

  async configureOptionalConnector(
    conector: "slack" | "discord" | "github",
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return await requestJson(`/api/conectores/${conector}/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async testOptionalConnector(
    conector: "slack" | "discord" | "github"
  ): Promise<Record<string, unknown>> {
    return await requestJson(`/api/conectores/${conector}/testar`, {
      method: "POST",
    });
  },

  async listUpgrades(): Promise<PacoteUpgradeInfo[]> {
    const res = await apiFetch("/api/upgrades");
    const json = (await res.json()) as { upgrades: PacoteUpgradeInfo[] };
    return json.upgrades ?? [];
  },

  async installUpgrade(pacote: "bonus" | "video"): Promise<PacoteUpgradeInfo[]> {
    const res = await apiFetch("/api/upgrades/instalar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pacote }),
    });
    const json = (await res.json()) as { upgrades: PacoteUpgradeInfo[] };
    return json.upgrades ?? [];
  },

  async saveBrandIdentity(patch: Partial<IdentidadeMarcaStudio>): Promise<IdentidadeMarcaStudio> {
    const res = await apiFetch("/api/marca/identidade", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { identidade: IdentidadeMarcaStudio };
    return json.identidade;
  },

  async listMcpServers(agentId?: string): Promise<
    Array<
      McpServidorConfig & {
        oauthStatus: McpOAuthStatus;
        oauthAccounts?: McpOAuthAccountView[];
      }
    >
  > {
    const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    const res = await apiFetch(`/api/mcps/servidores${qs}`);
    const json = (await res.json()) as {
      servidores?: Array<
        McpServidorConfig & {
          oauthStatus: McpOAuthStatus;
          oauthAccounts?: McpOAuthAccountView[];
        }
      >;
    };
    return json.servidores ?? [];
  },

  async saveMcpServer(payload: {
    mcp_id?: string;
    nome: string;
    transporte: McpTransporte;
    comando?: string;
    args?: string[];
    env?: Record<string, string>;
    envPassthrough?: string[];
    workingDirectory?: string | null;
    url?: string | null;
    headers?: Record<string, string>;
    acesso?: McpAcessoAgentes;
    origemAppSlug?: string | null;
    contaRotulo?: string | null;
    ativo?: boolean;
    testar?: boolean;
  }): Promise<{ servidor: McpServidorConfig; probe?: McpProbeResultado }> {
    const res = await apiFetch("/api/mcps/servidores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      servidor?: McpServidorConfig;
      probe?: McpProbeResultado;
      erro?: string;
    };
    if (!res.ok || !json.servidor) {
      throw new Error(json.erro ?? "Falha ao registrar servidor MCP.");
    }
    return { servidor: json.servidor, probe: json.probe };
  },

  async updateMcpServer(
    mcpId: string,
    payload: Record<string, unknown>
  ): Promise<McpServidorConfig> {
    const res = await apiFetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { servidor?: McpServidorConfig; erro?: string };
    if (!res.ok || !json.servidor) {
      throw new Error(json.erro ?? "Falha ao atualizar servidor MCP.");
    }
    return json.servidor;
  },

  async deleteMcpServer(mcpId: string): Promise<void> {
    const res = await apiFetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover servidor MCP.");
    }
  },

  async testMcpServer(mcpId: string): Promise<McpProbeResultado & { servidor?: McpServidorConfig }> {
    const res = await apiFetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/testar`, {
      method: "POST",
    });
    const json = (await res.json()) as McpProbeResultado & {
      servidor?: McpServidorConfig;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao testar servidor MCP.");
    }
    return json;
  },

  async testMcpDraft(payload: Record<string, unknown>): Promise<McpProbeResultado> {
    const res = await apiFetch("/api/mcps/testar-rascunho", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as McpProbeResultado & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao validar rascunho MCP.");
    }
    return json;
  },

  async setMcpServerStatus(
    mcpId: string,
    patch: { ativo?: boolean; acesso?: McpAcessoAgentes }
  ): Promise<McpServidorConfig> {
    const res = await apiFetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/ativo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { servidor?: McpServidorConfig; erro?: string };
    if (!res.ok || !json.servidor) {
      throw new Error(json.erro ?? "Falha ao atualizar status/acesso do servidor MCP.");
    }
    return json.servidor;
  },

  async startMcpOAuth(
    mcpId: string,
    opts?: { contaChave?: string; scopes?: string[] }
  ): Promise<{ authorizeUrl: string; state: string; redirectUri: string; contaChave: string }> {
    const res = await apiFetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/oauth/iniciar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
    const json = (await res.json()) as {
      authorizeUrl?: string;
      state?: string;
      redirectUri?: string;
      contaChave?: string;
      erro?: string;
    };
    if (!res.ok || !json.authorizeUrl) {
      throw new Error(json.erro ?? "Falha ao iniciar fluxo OAuth 2.1.");
    }
    return {
      authorizeUrl: json.authorizeUrl,
      state: json.state ?? "",
      redirectUri: json.redirectUri ?? "",
      contaChave: json.contaChave ?? "",
    };
  },

  async listProviderRuntimeUpdates(force = false): Promise<
    Array<{
      folder: string;
      provider: "openai" | "claude" | "gemini" | "opencode";
      label: string;
      executable: string | null;
      currentVersion: string | null;
      latestVersion: string | null;
      updateAvailable: boolean;
    }>
  > {
    const res = await apiFetch(`/api/provedores/runtimes/updates${force ? "?force=1" : ""}`);
    const json = (await res.json()) as {
      runtimes?: Array<{
        folder: string;
        provider: "openai" | "claude" | "gemini" | "opencode";
        label: string;
        executable: string | null;
        currentVersion: string | null;
        latestVersion: string | null;
        updateAvailable: boolean;
      }>;
    };
    return json.runtimes ?? [];
  },

  async upgradeProviderRuntime(
    provedor: "openai" | "claude" | "gemini" | "opencode" | string
  ): Promise<{
    ok: boolean;
    provedor: string;
    versao: string | null;
    executavel: string | null;
    erro: string | null;
    provedores: ProvedorStatusInfo[];
  }> {
    const res = await apiFetch(
      `/api/provedores/${encodeURIComponent(provedor)}/runtime/atualizar`,
      { method: "POST" }
    );
    const json = (await res.json()) as {
      ok?: boolean;
      provedor?: string;
      versao?: string | null;
      executavel?: string | null;
      erro?: string | null;
      provedores?: ProvedorStatusInfo[];
    };
    return {
      ok: Boolean(json.ok),
      provedor: json.provedor ?? provedor,
      versao: json.versao ?? null,
      executavel: json.executavel ?? null,
      erro: json.erro ?? null,
      provedores: json.provedores ?? [],
    };
  },

  async disconnectMcpOAuth(mcpId: string, contaChave?: string): Promise<void> {
    const res = await apiFetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/oauth/desconectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contaChave ? { contaChave } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao desconectar conta OAuth.");
    }
  },
};
