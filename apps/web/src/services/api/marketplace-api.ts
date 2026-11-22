import type {
  GithubImportPreview,
  LojaCatalogoSnapshot,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceAuthKind,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthAccountView,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import { apiFetch, requestJson } from "../http-client";

export const marketplaceApi = {
  async getLojaCatalogo(params?: {
    q?: string;
    tab?: MarketplaceTab;
    fonte?: MarketplaceSourceFilter;
    category?: string;
  }): Promise<LojaCatalogoSnapshot> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.tab) qs.set("tab", params.tab);
    if (params?.fonte) qs.set("fonte", params.fonte);
    if (params?.category) qs.set("category", params.category);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/loja/catalogo${suffix}`);
    const json = (await res.json()) as LojaCatalogoSnapshot & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar catálogo da Loja.");
    }
    return json;
  },

  async getLojaAppDetail(slug: string): Promise<{
    app: MarketplaceAppItem;
    accounts: Array<{
      server: McpServidorConfig;
      contaRotulo: string | null;
      oauthStatus: McpOAuthStatus;
      oauthAccounts: McpOAuthAccountView[];
    }>;
    nativeAccounts?: NativeAppAccountSummary[];
    agents: Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;
    nativeStatus?: {
      configuredKeys: string[];
      missingKeys: string[];
      whatsappAccountsCount?: number;
      whatsappConnectedCount?: number;
    };
  }> {
    const json = await requestJson<{
      app?: MarketplaceAppItem;
      accounts?: Array<{
        server: McpServidorConfig;
        contaRotulo: string | null;
        oauthStatus: McpOAuthStatus;
        oauthAccounts: McpOAuthAccountView[];
      }>;
      nativeAccounts?: NativeAppAccountSummary[];
      agents?: Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;
      nativeStatus?: {
        configuredKeys: string[];
        missingKeys: string[];
        whatsappAccountsCount?: number;
        whatsappConnectedCount?: number;
      };
      erro?: string;
    }>(`/api/loja/apps/${encodeURIComponent(slug)}`);
    if (!json.app) {
      throw new Error(json.erro ?? "Falha ao carregar detalhes do aplicativo.");
    }
    return {
      app: json.app,
      accounts: json.accounts ?? [],
      nativeAccounts: json.nativeAccounts ?? [],
      agents: json.agents ?? [],
      nativeStatus: json.nativeStatus,
    };
  },

  async connectLojaApp(
    slug: string,
    payload: {
      flowId?: string;
      kind?: MarketplaceAuthKind;
      mcpId?: string;
      contaId?: string;
      contaRotulo?: string;
      fields?: Record<string, string>;
      url?: string;
      comando?: string;
      args?: string[];
      workingDirectory?: string | null;
      acesso?: McpAcessoAgentes;
      skipProbe?: boolean;
    }
  ): Promise<{
    ok: boolean;
    kind: MarketplaceAuthKind;
    appSlug: string;
    native?: boolean;
    mcpId?: string;
    authorizeUrl?: string;
    state?: string;
    server?: McpServidorConfig;
    probe?: McpProbeResultado;
    instructions?: string[];
    nativeAccount?: NativeAppAccountSummary;
    validationReport?: { ok: boolean; estagio: number; resumo: string; detalhes?: Record<string, unknown> };
  }> {
    const json = await requestJson<{
      ok?: boolean;
      kind?: MarketplaceAuthKind;
      appSlug?: string;
      native?: boolean;
      mcpId?: string;
      authorizeUrl?: string;
      state?: string;
      server?: McpServidorConfig;
      probe?: McpProbeResultado;
      instructions?: string[];
      nativeAccount?: NativeAppAccountSummary;
      validationReport?: { ok: boolean; estagio: number; resumo: string; detalhes?: Record<string, unknown> };
    }>(`/api/loja/apps/${encodeURIComponent(slug)}/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      ok: Boolean(json.ok),
      kind: json.kind ?? "oauth",
      appSlug: json.appSlug ?? slug,
      native: json.native,
      mcpId: json.mcpId,
      authorizeUrl: json.authorizeUrl,
      state: json.state,
      server: json.server,
      probe: json.probe,
      instructions: json.instructions,
      nativeAccount: json.nativeAccount,
      validationReport: json.validationReport,
    };
  },

  async updateNativeAppAccess(
    slug: string,
    payload: { acesso: McpAcessoAgentes; contaId?: string | null }
  ): Promise<{ ok: boolean; appSlug: string; nativeAccounts: NativeAppAccountSummary[] }> {
    return await requestJson(`/api/loja/apps/${encodeURIComponent(slug)}/acesso`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async testNativeAppConnection(
    slug: string,
    payload?: { contaId?: string }
  ): Promise<{
    ok: boolean;
    appSlug: string;
    contaId: string | null;
    resumo: string;
    account?: NativeAppAccountSummary | null;
    validationReport?: { ok: boolean; estagio: number; resumo: string; detalhes?: Record<string, unknown> };
    nativeAccounts: NativeAppAccountSummary[];
  }> {
    return await requestJson(`/api/loja/apps/${encodeURIComponent(slug)}/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
  },

  async deleteNativeAppAccount(
    slug: string,
    contaId: string
  ): Promise<{ ok: boolean; appSlug: string; contaId: string; nativeAccounts: NativeAppAccountSummary[] }> {
    return await requestJson(
      `/api/loja/apps/${encodeURIComponent(slug)}/contas/${encodeURIComponent(contaId)}`,
      { method: "DELETE" }
    );
  },

  async installLojaAgent(
    slug: string,
    overrides?: {
      name?: string;
      model?: string;
      pasta?: string;
      activateRoutines?: boolean;
      manifest?: Partial<MarketplaceAgentPackage>;
    }
  ): Promise<{
    agente: { agente_id: string; nome: string; papel: string; modelo_padrao: string };
    installedSkills: MarketplaceSkillItem[];
  }> {
    const res = await apiFetch(`/api/loja/agentes/${encodeURIComponent(slug)}/instalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides ? { overrides, manifest: overrides.manifest } : {}),
    });
    const json = (await res.json()) as {
      agente?: { agente_id: string; nome: string; papel: string; modelo_padrao: string };
      installedSkills?: MarketplaceSkillItem[];
      erro?: string;
    };
    if (!res.ok || !json.agente) {
      throw new Error(json.erro ?? "Falha ao instalar agente da Loja.");
    }
    return {
      agente: json.agente,
      installedSkills: json.installedSkills ?? [],
    };
  },

  async exportLojaAgent(agenteId: string): Promise<MarketplaceAgentPackage & Record<string, unknown>> {
    const res = await apiFetch(`/api/loja/agentes/${encodeURIComponent(agenteId)}/exportar`);
    const json = (await res.json()) as (MarketplaceAgentPackage & Record<string, unknown>) & {
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao exportar agente.");
    }
    return json;
  },

  async duplicateLojaAgent(
    agenteId: string,
    nome?: string
  ): Promise<{ agente: { agente_id: string; nome: string } }> {
    const res = await apiFetch(`/api/loja/agentes/${encodeURIComponent(agenteId)}/duplicar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nome ? { nome } : {}),
    });
    const json = (await res.json()) as {
      agente?: { agente_id: string; nome: string };
      erro?: string;
    };
    if (!res.ok || !json.agente) {
      throw new Error(json.erro ?? "Falha ao duplicar agente.");
    }
    return { agente: json.agente };
  },

  async inspectGithubRepo(url: string, tipo: "skills" | "agents"): Promise<GithubImportPreview> {
    const params = new URLSearchParams({ url, tipo });
    const res = await apiFetch(`/api/loja/github/inspecionar?${params.toString()}`);
    const json = (await res.json()) as GithubImportPreview & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao inspecionar repositório do GitHub.");
    }
    return json;
  },

  async installFromGithub(payload: {
    url: string;
    kind: "skills" | "agents";
    itemPaths?: string[];
    targetAgentIds?: string[];
  }): Promise<{ installedCount: number; installedSkills: unknown[]; installedAgents: unknown[] }> {
    const res = await apiFetch("/api/loja/github/instalar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      installedCount?: number;
      installedSkills?: unknown[];
      installedAgents?: unknown[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao instalar pacote do GitHub.");
    }
    return {
      installedCount: json.installedCount ?? 0,
      installedSkills: json.installedSkills ?? [],
      installedAgents: json.installedAgents ?? [],
    };
  },

  async listLojaSkills(params?: {
    q?: string;
    fonte?: MarketplaceSourceFilter;
    agentId?: string;
  }): Promise<MarketplaceSkillItem[]> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.fonte) qs.set("fonte", params.fonte);
    if (params?.agentId) qs.set("agentId", params.agentId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/loja/habilidades${suffix}`);
    const json = (await res.json()) as { habilidades?: MarketplaceSkillItem[] };
    return json.habilidades ?? [];
  },

  async readLojaSkill(skillId: string): Promise<{ skill: MarketplaceSkillItem; markdown: string }> {
    const res = await apiFetch(`/api/loja/habilidades/${encodeURIComponent(skillId)}`);
    const json = (await res.json()) as {
      skill?: MarketplaceSkillItem;
      markdown?: string;
      erro?: string;
    };
    if (!res.ok || !json.skill) {
      throw new Error(json.erro ?? "Habilidade não encontrada.");
    }
    return { skill: json.skill, markdown: json.markdown ?? "" };
  },

  async createCustomSkill(payload: {
    name: string;
    slug?: string;
    description: string;
    category?: string;
    instructions: string;
    agentIds?: string[];
  }): Promise<MarketplaceSkillItem> {
    const res = await apiFetch("/api/loja/habilidades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { habilidade?: MarketplaceSkillItem; erro?: string };
    if (!res.ok || !json.habilidade) {
      throw new Error(json.erro ?? "Falha ao criar habilidade personalizada.");
    }
    return json.habilidade;
  },

  async installCatalogSkill(
    slugOrId: string,
    targetAgentIds?: string[]
  ): Promise<MarketplaceSkillItem> {
    const res = await apiFetch(`/api/loja/habilidades/${encodeURIComponent(slugOrId)}/instalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetAgentIds: targetAgentIds ?? [] }),
    });
    const json = (await res.json()) as { habilidade?: MarketplaceSkillItem; erro?: string };
    if (!res.ok || !json.habilidade) {
      throw new Error(json.erro ?? "Falha ao instalar habilidade.");
    }
    return json.habilidade;
  },

  async setSkillAgentsBatch(
    skillId: string,
    agentIds: string[]
  ): Promise<{ skillId: string; previousAgentIds: string[]; currentAgentIds: string[] }> {
    const res = await apiFetch(`/api/loja/habilidades/${encodeURIComponent(skillId)}/agentes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds }),
    });
    const json = (await res.json()) as {
      skillId?: string;
      previousAgentIds?: string[];
      currentAgentIds?: string[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao vincular habilidade aos agentes.");
    }
    return {
      skillId: json.skillId ?? skillId,
      previousAgentIds: json.previousAgentIds ?? [],
      currentAgentIds: json.currentAgentIds ?? agentIds,
    };
  },

  async setAgentSkillEnabled(
    agenteId: string,
    skillId: string,
    habilitada: boolean
  ): Promise<{ ok: boolean }> {
    const res = await apiFetch(
      `/api/loja/agentes/${encodeURIComponent(agenteId)}/habilidades/${encodeURIComponent(skillId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habilitada }),
      }
    );
    const json = (await res.json()) as { ok?: boolean; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao alterar habilidade do agente.");
    }
    return { ok: Boolean(json.ok ?? true) };
  },

  async deleteLojaSkill(skillId: string): Promise<void> {
    const res = await apiFetch(`/api/loja/habilidades/${encodeURIComponent(skillId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover habilidade.");
    }
  },
};
