import type {
  LojaCatalogoSnapshot,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceSourceFilter,
  McpAcessoAgentes,
  McpOAuthAccountView,
  McpOAuthStatus,
  McpServidorConfig,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import type { WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import { McpOAuthProvider } from "../mcp/mcp-oauth-provider.ts";
import { McpServerStore } from "../mcp/mcp-server-store.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import {
  getBrandIdentity,
  hasConfiguredBrand,
  interpolateBrandPlaceholders,
} from "../server/brand-onboarding-service.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { NativeAppConnectionsStore } from "./native-app-connections-store.ts";
import {
  type CatalogBundleData,
  loadCatalogBundle,
  SkillsManager,
} from "./skills-manager.ts";
import {
  CatalogServiceError,
  NATIVE_VAULT_ALIAS_MAP,
  uniqueSortedCategories,
  type CatalogAppAccountInfo,
  type CatalogAppDetail,
  type CatalogServiceDeps,
  type CatalogServiceOptions,
  type CatalogSnapshotQuery,
  type ConnectCatalogAppInput,
  type ConnectCatalogAppResult,
  type ExportedAgentTemplate,
  type InstallAgentOverrides,
  type InstalledAgentRecord,
  type InstalledAgentResult,
} from "./catalog-types.ts";
import { catalog_connectCatalogApp } from "./catalog-app-connector.ts";
import {
  catalog_deleteNativeAppAccount,
  catalog_testNativeApp,
  catalog_updateNativeAppAccess,
} from "./catalog-native-accounts.ts";
import {
  catalog_duplicateAgent,
  catalog_exportAgentTemplate,
  catalog_installAgentPackage,
} from "./catalog-agent-installer.ts";

export {
  CatalogServiceError,
  type CatalogAppAccountInfo,
  type CatalogAppDetail,
  type CatalogServiceOptions,
  type CatalogSnapshotQuery,
  type ConnectCatalogAppInput,
  type ConnectCatalogAppResult,
  type ExportedAgentTemplate,
  type InstallAgentOverrides,
  type InstalledAgentRecord,
  type InstalledAgentResult,
};

type TailArgs<F> = F extends (deps: CatalogServiceDeps, ...args: infer A) => unknown ? A : never;

/**
 * Serviço central do catálogo unificado da Loja (`Apps`, `Agentes`, `Habilidades`),
 * conexão multi-conta de aplicativos, instalação de agentes em 1 clique e exportação/duplicação.
 */
export class CatalogService {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;
  private readonly mcpGateway?: McpGateway;
  private readonly mcpStore: McpServerStore;
  public readonly nativeStore: NativeAppConnectionsStore;
  private readonly oauthProvider?: McpOAuthProvider;
  private readonly skillsManager: SkillsManager;
  private readonly providerConnection?: ProviderConnectionService;
  private whatsappManager?: WhatsAppSessionManager;
  private readonly workspaceRoot: string;
  private readonly bundlePath?: string;
  private readonly fetchImpl?: FetchLike;

  constructor(options: CatalogServiceOptions) {
    this.db = options.db;
    this.vault = options.vault;
    this.mcpGateway = options.mcpGateway;
    this.mcpStore =
      options.mcpStore ??
      options.mcpGateway?.store ??
      new McpServerStore({ db: options.db, vault: options.vault });
    this.nativeStore =
      options.nativeStore ??
      new NativeAppConnectionsStore({ db: options.db, vault: options.vault });
    this.oauthProvider = options.oauthProvider ?? options.mcpGateway?.oauthProvider;
    this.providerConnection = options.providerConnection;
    this.whatsappManager = options.whatsappManager;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.bundlePath = options.bundlePath;
    this.fetchImpl = options.fetchImpl;
    this.skillsManager =
      options.skillsManager ??
      new SkillsManager({
        db: options.db,
        workspaceRoot: this.workspaceRoot,
        bundlePath: this.bundlePath,
      });
  }

  public attachWhatsAppManager(manager: WhatsAppSessionManager): void {
    this.whatsappManager = manager;
  }

  private resolveConfiguredBrand() {
    if (!this.providerConnection) return null;
    const brand = getBrandIdentity(this.providerConnection);
    return hasConfiguredBrand(brand) ? brand : null;
  }

  private applyBrandToCatalogApp(
    app: MarketplaceAppItem,
    brand: ReturnType<CatalogService["resolveConfiguredBrand"]>
  ): MarketplaceAppItem {
    if (!brand) return app;
    return {
      ...app,
      tagline: interpolateBrandPlaceholders(app.tagline, brand),
      description: interpolateBrandPlaceholders(app.description, brand),
      prompts: (app.prompts ?? []).map((p) => ({
        ...p,
        text: interpolateBrandPlaceholders(p.text, brand),
      })),
    };
  }

  private applyBrandToCatalogAgent(
    agent: MarketplaceAgentPackage,
    brand: ReturnType<CatalogService["resolveConfiguredBrand"]>
  ): MarketplaceAgentPackage {
    if (!brand) return agent;
    return {
      ...agent,
      role: interpolateBrandPlaceholders(agent.role, brand),
      tagline: interpolateBrandPlaceholders(agent.tagline, brand),
      description: interpolateBrandPlaceholders(agent.description, brand),
      promptBase: interpolateBrandPlaceholders(agent.promptBase, brand),
      routines: (agent.routines ?? []).map((r) => ({
        ...r,
        name: interpolateBrandPlaceholders(r.name, brand),
        instruction: interpolateBrandPlaceholders(r.instruction, brand),
      })),
    };
  }

  private listAllNativeAndWhatsAppAccounts(): NativeAppAccountSummary[] {
    const stored = this.nativeStore.listAllAccounts([
      "instagram",
      "telegram",
      "fish-audio",
      "elevenlabs",
    ]);
    const seenIds = new Set(stored.map((a) => a.conta_id));
    const combined: NativeAppAccountSummary[] = [...stored];

    try {
      const wppRows = this.whatsappManager
        ? this.whatsappManager.listAccounts()
        : (this.db.connection
            .prepare(
              `SELECT conta_id, rotulo, numero_telefone, jid_proprio, status, atualizado_em
               FROM whatsapp_contas
               WHERE status = 'conectado';`
            )
            .all() as Array<{
            conta_id: string;
            rotulo: string;
            numero_telefone: string | null;
            jid_proprio: string | null;
            status: string;
            atualizado_em: string;
          }>);

      for (const acc of wppRows) {
        if (acc.status !== "conectado" || seenIds.has(acc.conta_id)) continue;
        seenIds.add(acc.conta_id);
        const numero = acc.numero_telefone || acc.jid_proprio || acc.rotulo;
        combined.push({
          conta_id: acc.conta_id,
          app_slug: "whatsapp",
          conta_rotulo: acc.rotulo,
          campos_mascarados: numero ? { PHONE: numero } : {},
          campos_visiveis: numero ? { PHONE: numero } : {},
          configurado: true,
          testado_ok: true,
          ultimo_teste_em: acc.atualizado_em,
          ultimo_erro: null,
          perfil_conectado: {
            username: numero,
            account_id: acc.conta_id,
          },
          acesso: { mode: "everyone", agentIds: [] },
          atualizado_em: acc.atualizado_em,
        });
      }
    } catch {
      // ignora se whatsapp_contas ainda não foi criada em testes unitários isolados
    }

    return combined;
  }

  public getBundle(): CatalogBundleData {
    return loadCatalogBundle({
      workspaceRoot: this.workspaceRoot,
      bundlePath: this.bundlePath,
    });
  }

  public findAppBySlug(slug: string): MarketplaceAppItem | null {
    const clean = slug.trim().toLowerCase();
    if (!clean) return null;
    return this.getBundle().apps.find((a) => a.slug.toLowerCase() === clean) ?? null;
  }

  public searchCatalogApps(query: string, limit = 6): MarketplaceAppItem[] {
    const q = query.trim().toLowerCase();
    const apps = this.getBundle().apps;
    if (!q) {
      return apps.filter((a) => a.featured).slice(0, limit);
    }
    return apps
      .filter((a) =>
        [a.slug, a.name, a.tagline, a.description, a.category, a.creatorName]
          .join("\n")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, limit);
  }

  /**
   * Retorna o snapshot unificado do catálogo da Loja (`Apps`, `Agentes`, `Habilidades`),
   * aplicando busca textual, filtro por origem (`all` | `verified` | `public`) e categoria.
   */
  public getCatalogSnapshot(params: CatalogSnapshotQuery = {}): LojaCatalogoSnapshot {
    const bundle = this.getBundle();
    const configuredBrand = this.resolveConfiguredBrand();
    const queryLower = (params.query ?? params.q ?? "").trim().toLowerCase();
    const sourceFilter: MarketplaceSourceFilter =
      params.sourceFilter ?? params.fonte ?? "all";
    const categoryFilter = params.category?.trim().toLowerCase() ?? "";

    const apps = bundle.apps
      .map((app) => this.applyBrandToCatalogApp(app, configuredBrand))
      .filter((app) => {
        if (sourceFilter === "verified" && !app.verified) return false;
        if (sourceFilter === "public" && app.verified) return false;
        if (categoryFilter && app.category.toLowerCase() !== categoryFilter) return false;
        if (queryLower) {
          const hay = [
            app.slug,
            app.name,
            app.tagline,
            app.description,
            app.category,
            app.creatorName,
          ]
            .join("\n")
            .toLowerCase();
          if (!hay.includes(queryLower)) return false;
        }
        return true;
      });

    const agents = bundle.agents
      .map((agent) => this.applyBrandToCatalogAgent(agent, configuredBrand))
      .filter((agent) => {
        const isVerified = agent.verified || agent.source === "verified";
        if (sourceFilter === "verified" && !isVerified) return false;
        if (sourceFilter === "public" && isVerified) return false;
        if (categoryFilter && agent.category.toLowerCase() !== categoryFilter) return false;
        if (queryLower) {
          const hay = [
            agent.slug,
            agent.name,
            agent.role,
            agent.tagline,
            agent.description,
            agent.category,
            ...(agent.skills ?? []),
          ]
            .join("\n")
            .toLowerCase();
          if (!hay.includes(queryLower)) return false;
        }
        return true;
      });

    const allSkills = this.skillsManager.listSkills();
    const skills = this.skillsManager.listSkills({
      query: queryLower || undefined,
      source: sourceFilter,
      category: categoryFilter || undefined,
    });

    const installedAppsRaw = this.mcpStore.listServersForClient({ includeDisabled: true });
    const installedApps = installedAppsRaw.map((srv) => ({
      ...srv,
      oauthStatus: this.oauthProvider?.getOAuthStatus(srv.mcp_id) ?? srv.oauthStatus,
    }));

    const installedSkills = allSkills.filter((s) => s.installed);
    const nativeAccounts = this.listAllNativeAndWhatsAppAccounts();
    const connectedNativeSlugs = Array.from(
      new Set(nativeAccounts.filter((acc) => acc.configurado).map((acc) => acc.app_slug))
    );

    return {
      apps,
      agents,
      skills,
      installedApps,
      installedSkills,
      nativeAccounts,
      connectedNativeSlugs,
      categories: {
        apps: uniqueSortedCategories(bundle.apps.map((a) => a.category)),
        agents: uniqueSortedCategories(bundle.agents.map((a) => a.category)),
        skills: uniqueSortedCategories(allSkills.map((s) => s.category)),
      },
    };
  }

  /**
   * Retorna metadados completos de um App da Loja, todas as contas conectadas (`#account-N`),
   * status de OAuth/teste e permissões por agente.
   */
  public getAppDetail(slug: string): CatalogAppDetail | null {
    const rawApp = this.findAppBySlug(slug);
    if (!rawApp) return null;
    const app = this.applyBrandToCatalogApp(rawApp, this.resolveConfiguredBrand());

    const allServers = this.mcpStore.listServersForClient({ includeDisabled: true });
    const matchingServers = allServers.filter(
      (srv) =>
        srv.origemAppSlug === app.slug ||
        srv.mcp_id === app.slug ||
        srv.mcp_id.startsWith(`${app.slug}-`)
    );

    const accounts: CatalogAppAccountInfo[] = matchingServers.map((server) => {
      const oauthAccounts = this.oauthProvider?.listOAuthAccounts(server.mcp_id) ?? [];
      const oauthStatus = this.oauthProvider?.getOAuthStatus(server.mcp_id) ?? server.oauthStatus;
      return {
        server: { ...server, oauthStatus },
        contaRotulo: server.contaRotulo,
        oauthStatus,
        oauthAccounts,
      };
    });

    const agents = this.db.connection
      .prepare(
        `SELECT agente_id, nome, papel, modelo_padrao FROM projecao_agentes ORDER BY ordem_exibicao ASC;`
      )
      .all() as Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;

    let nativeStatus: CatalogAppDetail["nativeStatus"];
    let nativeAccounts: NativeAppAccountSummary[] = [];
    if (app.isNative) {
      nativeAccounts = this.nativeStore.listAccounts(app.slug);
      const secretNames = new Set(this.vault.listSecretsMetadata().map((s) => s.chave_nome));
      const configuredKeys: string[] = [];
      const missingKeys: string[] = [];

      const aliasMap = NATIVE_VAULT_ALIAS_MAP[app.slug];
      if (aliasMap) {
        for (const [fieldKey, aliases] of Object.entries(aliasMap)) {
          const configuredInAccount = nativeAccounts.some((acc) =>
            Boolean(acc.campos_mascarados?.[fieldKey] || acc.campos_visiveis?.[fieldKey])
          );
          if (configuredInAccount || aliases.some((alias) => secretNames.has(alias))) {
            configuredKeys.push(fieldKey);
          } else {
            missingKeys.push(fieldKey);
          }
        }
      }

      nativeStatus = { configuredKeys, missingKeys };

      if (app.slug === "whatsapp") {
        try {
          const row = this.db.connection
            .prepare(
              `SELECT COUNT(*) AS total,
                      COALESCE(SUM(CASE WHEN status = 'conectado' THEN 1 ELSE 0 END), 0) AS conectadas
               FROM whatsapp_contas;`
            )
            .get() as { total?: number; conectadas?: number } | undefined;
          nativeStatus.whatsappAccountsCount = Number(row?.total ?? 0);
          nativeStatus.whatsappConnectedCount = Number(row?.conectadas ?? 0);
        } catch {
          nativeStatus.whatsappAccountsCount = 0;
          nativeStatus.whatsappConnectedCount = 0;
        }
      }
    }

    return {
      app,
      accounts,
      nativeAccounts,
      agents,
      nativeStatus,
    };
  }

  private getDeps(): CatalogServiceDeps {
    return {
      db: this.db,
      vault: this.vault,
      mcpGateway: this.mcpGateway,
      mcpStore: this.mcpStore,
      nativeStore: this.nativeStore,
      oauthProvider: this.oauthProvider,
      skillsManager: this.skillsManager,
      providerConnection: this.providerConnection,
      getWhatsappManager: () => this.whatsappManager,
      workspaceRoot: this.workspaceRoot,
      bundlePath: this.bundlePath,
      fetchImpl: this.fetchImpl,
      getBundle: () => this.getBundle(),
      findAppBySlug: (slug) => this.findAppBySlug(slug),
      resolveConfiguredBrand: () => this.resolveConfiguredBrand(),
    };
  }

  public async connectCatalogApp(...args: TailArgs<typeof catalog_connectCatalogApp>) {
    return await catalog_connectCatalogApp(this.getDeps(), ...args);
  }

  public async testNativeApp(...args: TailArgs<typeof catalog_testNativeApp>) {
    return await catalog_testNativeApp(this.getDeps(), ...args);
  }

  public updateNativeAppAccess(...args: TailArgs<typeof catalog_updateNativeAppAccess>) {
    return catalog_updateNativeAppAccess(this.getDeps(), ...args);
  }

  public deleteNativeAppAccount(...args: TailArgs<typeof catalog_deleteNativeAppAccount>) {
    return catalog_deleteNativeAppAccount(this.getDeps(), ...args);
  }

  public installAgentPackage(...args: TailArgs<typeof catalog_installAgentPackage>) {
    return catalog_installAgentPackage(this.getDeps(), ...args);
  }

  public exportAgentTemplate(...args: TailArgs<typeof catalog_exportAgentTemplate>) {
    return catalog_exportAgentTemplate(this.getDeps(), ...args);
  }

  public duplicateAgent(...args: TailArgs<typeof catalog_duplicateAgent>) {
    return catalog_duplicateAgent(this.getDeps(), ...args);
  }
}
