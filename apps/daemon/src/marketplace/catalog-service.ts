import { randomUUID } from "node:crypto";
import type {
  AvatarShape,
  LojaCatalogoSnapshot,
  MarketplaceAgentPackage,
  MarketplaceAgentRoutineTemplate,
  MarketplaceAppItem,
  MarketplaceAuthFlow,
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
import type { WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import {
  type MetaValidationReport,
  validateMetaIntegration,
} from "../engine/tools/meta-insights.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import { McpOAuthProvider } from "../mcp/mcp-oauth-provider.ts";
import { inspectMcpServer } from "../mcp/mcp-probe.ts";
import { McpServerStore } from "../mcp/mcp-server-store.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { computeNextCronExecution } from "../routines/cron-scheduler.ts";
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

export class CatalogServiceError extends Error {
  public readonly code: string;

  constructor(message: string, code = "CATALOG_SERVICE_ERROR") {
    super(message);
    this.name = "CatalogServiceError";
    this.code = code;
  }
}

export interface CatalogServiceOptions {
  db: CriativoDatabase;
  vault: VaultService;
  mcpGateway?: McpGateway;
  mcpStore?: McpServerStore;
  nativeStore?: NativeAppConnectionsStore;
  oauthProvider?: McpOAuthProvider;
  skillsManager?: SkillsManager;
  providerConnection?: ProviderConnectionService;
  whatsappManager?: WhatsAppSessionManager;
  workspaceRoot?: string;
  bundlePath?: string;
  fetchImpl?: FetchLike;
}

export interface CatalogSnapshotQuery {
  query?: string;
  q?: string;
  tab?: MarketplaceTab;
  sourceFilter?: MarketplaceSourceFilter;
  fonte?: MarketplaceSourceFilter;
  category?: string;
}

export interface CatalogAppAccountInfo {
  server: McpServidorConfig;
  contaRotulo: string | null;
  oauthStatus: McpOAuthStatus;
  oauthAccounts: McpOAuthAccountView[];
}

export interface CatalogAppDetail {
  app: MarketplaceAppItem;
  accounts: CatalogAppAccountInfo[];
  nativeAccounts?: NativeAppAccountSummary[];
  agents: Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;
  nativeStatus?: {
    configuredKeys: string[];
    missingKeys: string[];
    whatsappAccountsCount?: number;
    whatsappConnectedCount?: number;
  };
}

export interface ConnectCatalogAppInput {
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
  callbackBaseUrl?: string;
  useLoopbackListener?: boolean;
  clientIdOverride?: string;
  clientSecretOverride?: string;
  skipProbe?: boolean;
}

export interface ConnectCatalogAppResult {
  ok: boolean;
  kind: MarketplaceAuthKind;
  appSlug: string;
  native?: boolean;
  mcpId?: string;
  contaRotulo?: string;
  contaChave?: string;
  authorizeUrl?: string;
  state?: string;
  redirectUri?: string;
  savedKeys?: string[];
  instructions?: string[];
  server?: McpServidorConfig;
  probe?: McpProbeResultado;
  nativeAccount?: NativeAppAccountSummary;
  validationReport?: MetaValidationReport;
}

export interface InstallAgentOverrides {
  name?: string;
  model?: string;
  pasta?: string;
  customAgenteId?: string;
  activateRoutines?: boolean;
}

export interface InstalledAgentRecord {
  agente_id: string;
  nome: string;
  papel: string;
  modelo_padrao: string;
  status: string;
  skills_paths_json: string;
  ordem_exibicao: number;
  config_json: string;
  atualizado_em: string;
}

export interface InstalledAgentResult {
  agente: InstalledAgentRecord;
  installedSkills: MarketplaceSkillItem[];
  createdRoutines: Array<{
    rotina_id: string;
    titulo: string;
    expressao_cron: string;
    ativa: boolean;
  }>;
}

export interface ExportedAgentTemplate extends MarketplaceAgentPackage {
  schemaVersion: number;
  exportedAt: string;
  exportedFromAgentId: string;
}

const NATIVE_VAULT_ALIAS_MAP: Record<string, Record<string, string[]>> = {
  instagram: {
    IG_ACCESS_TOKEN: ["instagram_access_token", "META_ACCESS_TOKEN", "IG_ACCESS_TOKEN"],
    IG_USER_ID: ["instagram_business_account_id", "META_IG_USER_ID", "IG_USER_ID"],
  },
  telegram: {
    TELEGRAM_BOT_TOKEN: ["telegram_bot_token", "TELEGRAM_BOT_TOKEN"],
  },
  "fish-audio": {
    FISH_AUDIO_API_KEY: ["fish_audio_api_key", "FISH_AUDIO_API_KEY"],
  },
  elevenlabs: {
    ELEVENLABS_API_KEY: ["elevenlabs_api_key", "ELEVENLABS_API_KEY"],
  },
};

function sanitizeAgentIdBase(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || `agente_${randomUUID().slice(0, 6)}`;
}

function sanitizeMcpIdSegment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseScheduleTime(time?: string): { hour: number; minute: number } {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time.trim())) {
    return { hour: 9, minute: 0 };
  }
  const [hStr, mStr] = time.trim().split(":");
  const hour = Math.max(0, Math.min(23, Number.parseInt(hStr, 10) || 0));
  const minute = Math.max(0, Math.min(59, Number.parseInt(mStr, 10) || 0));
  return { hour, minute };
}

function convertRoutineScheduleToCron(
  schedule?: MarketplaceAgentRoutineTemplate["schedule"]
): string {
  if (!schedule || typeof schedule !== "object") {
    return "0 9 * * 1-5";
  }

  if (schedule.kind === "cron" && typeof schedule.cron === "string" && schedule.cron.trim()) {
    return schedule.cron.trim();
  }

  const { hour, minute } = parseScheduleTime(schedule.time);

  if (schedule.kind === "weekdays") {
    return `${minute} ${hour} * * 1-5`;
  }

  if (schedule.kind === "weekly") {
    const weekday =
      typeof schedule.weekday === "number" && Number.isInteger(schedule.weekday)
        ? Math.max(0, Math.min(7, schedule.weekday))
        : 1;
    return `${minute} ${hour} * * ${weekday}`;
  }

  if (schedule.kind === "monthly") {
    const day =
      typeof schedule.day === "number" && Number.isInteger(schedule.day)
        ? Math.max(1, Math.min(31, schedule.day))
        : 1;
    return `${minute} ${hour} ${day} * *`;
  }

  if (schedule.kind === "daily") {
    return `${minute} ${hour} * * *`;
  }

  return `${minute} ${hour} * * 1-5`;
}

function uniqueSortedCategories(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );
}

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

  private resolveAuthFlow(
    app: MarketplaceAppItem,
    payload: ConnectCatalogAppInput
  ): MarketplaceAuthFlow | null {
    if (payload.flowId) {
      const byId = app.authFlows.find((f) => f.id === payload.flowId);
      if (byId) return byId;
    }
    if (payload.kind) {
      const byKind = app.authFlows.find((f) => f.kind === payload.kind);
      if (byKind) return byKind;
    }
    return app.authFlows[0] ?? null;
  }

  private allocateServerIdentity(
    app: MarketplaceAppItem,
    payload: ConnectCatalogAppInput
  ): { mcpId: string; serverName: string; contaRotulo: string } {
    const existingAll = this.mcpStore.listServersForClient({ includeDisabled: true });
    const existingForApp = existingAll.filter((s) => s.origemAppSlug === app.slug);

    const contaRotulo =
      payload.contaRotulo?.trim() || `#account-${existingForApp.length + 1}`;

    if (payload.mcpId?.trim()) {
      const existingById = existingAll.find((s) => s.mcp_id === payload.mcpId!.trim());
      return {
        mcpId: payload.mcpId.trim(),
        serverName: existingById?.nome ?? app.name,
        contaRotulo: existingById?.contaRotulo ?? contaRotulo,
      };
    }

    const existingIds = new Set(existingAll.map((s) => s.mcp_id));
    const existingNames = new Set(existingAll.map((s) => s.nome.trim().toLowerCase()));

    const slugPart = sanitizeMcpIdSegment(app.slug) || "app";
    const rotuloPart = sanitizeMcpIdSegment(contaRotulo) || `account-${existingForApp.length + 1}`;
    let mcpId = `${slugPart}-${rotuloPart}`;
    let idx = 2;
    while (existingIds.has(mcpId)) {
      mcpId = `${slugPart}-${rotuloPart}-${idx}`;
      idx += 1;
    }

    let serverName =
      existingForApp.length === 0 && !existingNames.has(app.name.trim().toLowerCase())
        ? app.name
        : `${app.name} (${contaRotulo})`;
    let nameIdx = 2;
    while (existingNames.has(serverName.trim().toLowerCase())) {
      serverName = `${app.name} (${contaRotulo} #${nameIdx})`;
      nameIdx += 1;
    }

    return { mcpId, serverName, contaRotulo };
  }

  private async probeSavedServer(mcpId: string): Promise<McpProbeResultado> {
    if (this.mcpGateway) {
      return await this.mcpGateway.testServer(mcpId);
    }
    const resolved = this.mcpStore.getServer(mcpId, true);
    if (!resolved) {
      throw new CatalogServiceError(`Servidor MCP '${mcpId}' não encontrado após salvar.`);
    }
    const result = await inspectMcpServer(resolved);
    this.mcpStore.recordProbeResult(mcpId, result);
    return result;
  }

  /**
   * Conecta um aplicativo da Loja suportando fluxos adaptativos `key`, `local` e `oauth`,
   * múltiplas contas (`#account-N`) e sondagem via `McpProbe`.
   */
  public async connectCatalogApp(
    slug: string,
    payload: ConnectCatalogAppInput = {}
  ): Promise<ConnectCatalogAppResult> {
    const app = this.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }

    const authFlow = this.resolveAuthFlow(app, payload);
    const kind: MarketplaceAuthKind = payload.kind ?? authFlow?.kind ?? "key";

    // Fluxo 1: Chave de API / Token guardado no Cofre
    if (kind === "key") {
      const providedFields = payload.fields ?? {};
      const requiredFields = (authFlow?.fields ?? []).filter((f) => f.required !== false);

      // Conectores nativos sem serverTemplate persistem em projecao_apps_nativos_contas + VaultService
      if (!app.serverTemplate) {
        const existingNativeAccounts = this.nativeStore.listAccounts(app.slug);
        const cleanRotulo = payload.contaRotulo?.trim().toLowerCase() ?? "";
        const targetExisting = payload.contaId?.trim()
          ? existingNativeAccounts.find((a) => a.conta_id === payload.contaId!.trim())
          : cleanRotulo
            ? existingNativeAccounts.find((a) => a.conta_rotulo.trim().toLowerCase() === cleanRotulo)
            : existingNativeAccounts.length === 1
              ? existingNativeAccounts[0]
              : undefined;

        for (const field of requiredFields) {
          const val = providedFields[field.key];
          const hasStored = Boolean(
            targetExisting &&
              (targetExisting.campos_mascarados?.[field.key] ||
                targetExisting.campos_visiveis?.[field.key])
          );
          if ((typeof val !== "string" || val.trim().length === 0) && !hasStored) {
            throw new CatalogServiceError(
              `Preencha o campo obrigatório '${field.label || field.key}'.`,
              "MISSING_REQUIRED_FIELD"
            );
          }
        }

        const aliasMap = NATIVE_VAULT_ALIAS_MAP[app.slug] ?? {};
        let savedAcc = this.nativeStore.upsertAccount({
          appSlug: app.slug,
          contaId: payload.contaId ?? targetExisting?.conta_id,
          contaRotulo: payload.contaRotulo,
          fields: providedFields,
          flowFields: (authFlow?.fields ?? []).map((f) => ({
            key: f.key,
            label: f.label,
            secret: f.secret !== false,
            required: f.required !== false,
            prefix: f.prefix,
          })),
          aliasMap,
          acesso: payload.acesso,
        });

        const savedKeys: string[] = [];
        for (const field of authFlow?.fields ?? []) {
          if (providedFields[field.key]?.trim()) {
            const targets = aliasMap[field.key] ?? [field.key];
            savedKeys.push(...targets);
          }
        }

        let validationReport: MetaValidationReport | undefined;
        if (app.slug === "instagram" && !payload.skipProbe) {
          validationReport = await validateMetaIntegration(this.vault, this.fetchImpl, {
            nativeStore: this.nativeStore,
            contaId: savedAcc.conta_id,
          });
          savedAcc =
            this.nativeStore.recordTestResult(savedAcc.conta_id, {
              ok: validationReport.ok,
              error: validationReport.detalhes.erro,
              perfilConectado: validationReport.detalhes.username
                ? {
                    username: validationReport.detalhes.username,
                    followers_count: validationReport.detalhes.followersCount,
                    media_count: validationReport.detalhes.mediaCount,
                  }
                : null,
            }) ?? savedAcc;
        } else if (!payload.skipProbe && savedAcc.configurado && app.slug !== "instagram") {
          savedAcc =
            this.nativeStore.recordTestResult(savedAcc.conta_id, {
              ok: true,
              error: null,
            }) ?? savedAcc;
        }

        return {
          ok: true,
          kind: "key",
          appSlug: app.slug,
          native: true,
          contaRotulo: savedAcc.conta_rotulo,
          nativeAccount: savedAcc,
          validationReport,
          savedKeys: Array.from(new Set(savedKeys)),
        };
      }

      for (const field of requiredFields) {
        const val = providedFields[field.key];
        if (typeof val !== "string" || val.trim().length === 0) {
          throw new CatalogServiceError(
            `Preencha o campo obrigatório '${field.label || field.key}'.`,
            "MISSING_REQUIRED_FIELD"
          );
        }
      }

      const { mcpId, serverName, contaRotulo } = this.allocateServerIdentity(app, payload);
      const env: Record<string, string> = { ...(app.serverTemplate.env ?? {}) };
      const headers: Record<string, string> = { ...(app.serverTemplate.headers ?? {}) };
      let targetUrl = payload.url?.trim() || authFlow?.defaultUrl?.trim() || app.serverTemplate.url || "";

      const applyField = (
        key: string,
        rawValue: string,
        target: "header" | "env" | "query",
        prefix = "",
        isSecret = false
      ) => {
        const formatted = `${prefix}${rawValue.trim()}`;
        if (target === "header") {
          headers[key] = formatted;
        } else if (target === "env") {
          env[key] = formatted;
        } else if (target === "query" && targetUrl) {
          const parsedUrl = new URL(targetUrl);
          parsedUrl.searchParams.set(key, formatted);
          targetUrl = parsedUrl.toString();
          if (isSecret) {
            this.vault.setSecret(`mcp/${mcpId}/query/${encodeURIComponent(key)}`, formatted);
          }
        }
      };

      const flowFieldMap = new Map((authFlow?.fields ?? []).map((f) => [f.key, f]));
      for (const field of authFlow?.fields ?? []) {
        const raw = providedFields[field.key];
        if (typeof raw === "string" && raw.trim()) {
          applyField(field.key, raw, field.target, field.prefix ?? "", field.secret);
        }
      }
      for (const [extraKey, extraVal] of Object.entries(providedFields)) {
        if (flowFieldMap.has(extraKey)) continue;
        if (typeof extraVal === "string" && extraVal.trim()) {
          applyField(extraKey, extraVal, app.serverTemplate.transport === "http" ? "header" : "env");
        }
      }

      const saved = this.mcpStore.saveServer({
        mcp_id: mcpId,
        nome: serverName,
        transporte: app.serverTemplate.transport,
        comando: payload.comando ?? app.serverTemplate.command ?? "",
        args: payload.args ?? app.serverTemplate.args ?? [],
        env,
        headers,
        url: app.serverTemplate.transport === "http" ? targetUrl || null : null,
        workingDirectory: payload.workingDirectory ?? null,
        acesso: payload.acesso ?? { mode: "everyone", agentIds: [] },
        origemAppSlug: app.slug,
        contaRotulo,
        ativo: true,
      });

      if (payload.skipProbe) {
        this.mcpGateway?.refreshProxyRoutes();
        return {
          ok: true,
          kind: "key",
          appSlug: app.slug,
          mcpId: saved.mcp_id,
          contaRotulo,
          server: saved,
        };
      }

      const probe = await this.probeSavedServer(saved.mcp_id);
      this.mcpGateway?.refreshProxyRoutes();
      const updatedServer = this.mcpStore.getServer(saved.mcp_id, false) ?? saved;

      return {
        ok: probe.status === "passed",
        kind: "key",
        appSlug: app.slug,
        mcpId: saved.mcp_id,
        contaRotulo,
        server: updatedServer,
        probe,
      };
    }

    // Fluxo 2: App Local (Desktop / STDIO / Loopback HTTP)
    if (kind === "local") {
      if (!app.serverTemplate) {
        return {
          ok: true,
          kind: "local",
          appSlug: app.slug,
          native: true,
          instructions: authFlow?.localInstructions ?? [],
        };
      }

      const { mcpId, serverName, contaRotulo } = this.allocateServerIdentity(app, payload);
      const transport = app.serverTemplate.transport;
      const targetUrl =
        transport === "http"
          ? payload.url?.trim() || authFlow?.defaultUrl?.trim() || app.serverTemplate.url || "http://127.0.0.1:3000/mcp"
          : null;

      if (transport === "http" && targetUrl) {
        const parsed = new URL(targetUrl);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol === "http:" && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
          throw new CatalogServiceError(
            "Apps locais HTTP devem apontar para 127.0.0.1/localhost ou utilizar HTTPS.",
            "UNSAFE_LOCAL_URL"
          );
        }
      }

      const saved = this.mcpStore.saveServer({
        mcp_id: mcpId,
        nome: serverName,
        transporte: transport,
        comando: transport === "stdio" ? payload.comando ?? app.serverTemplate.command ?? "" : "",
        args: transport === "stdio" ? payload.args ?? app.serverTemplate.args ?? [] : [],
        env: { ...(app.serverTemplate.env ?? {}) },
        headers: { ...(app.serverTemplate.headers ?? {}) },
        url: targetUrl,
        workingDirectory: payload.workingDirectory ?? null,
        acesso: payload.acesso ?? { mode: "everyone", agentIds: [] },
        origemAppSlug: app.slug,
        contaRotulo,
        ativo: true,
      });

      if (payload.skipProbe) {
        this.mcpGateway?.refreshProxyRoutes();
        return {
          ok: true,
          kind: "local",
          appSlug: app.slug,
          mcpId: saved.mcp_id,
          contaRotulo,
          server: saved,
        };
      }

      const probe = await this.probeSavedServer(saved.mcp_id);
      this.mcpGateway?.refreshProxyRoutes();
      const updatedServer = this.mcpStore.getServer(saved.mcp_id, false) ?? saved;

      return {
        ok: probe.status === "passed",
        kind: "local",
        appSlug: app.slug,
        mcpId: saved.mcp_id,
        contaRotulo,
        server: updatedServer,
        probe,
      };
    }

    // Fluxo 3: OAuth 2.1 PKCE (suporta múltiplas contas #account-N)
    if (!this.oauthProvider) {
      throw new CatalogServiceError(
        "Provedor OAuth 2.1 MCP não configurado neste servidor.",
        "OAUTH_UNAVAILABLE"
      );
    }

    const oauthUrl =
      payload.url?.trim() || authFlow?.defaultUrl?.trim() || app.serverTemplate?.url?.trim() || "";
    if (!oauthUrl) {
      throw new CatalogServiceError(
        `O aplicativo '${app.name}' não possui endpoint Streamable HTTP definido para OAuth.`,
        "MISSING_OAUTH_URL"
      );
    }

    const { mcpId, serverName, contaRotulo } = this.allocateServerIdentity(app, payload);
    const saved = this.mcpStore.saveServer({
      mcp_id: mcpId,
      nome: serverName,
      transporte: "http",
      comando: "",
      args: [],
      env: {},
      headers: { ...(app.serverTemplate?.headers ?? {}) },
      url: oauthUrl,
      workingDirectory: null,
      acesso: payload.acesso ?? { mode: "everyone", agentIds: [] },
      origemAppSlug: app.slug,
      contaRotulo,
      ativo: true,
    });

    const contaChave = `${saved.mcp_id}#${contaRotulo.replace(/^#/, "")}`;
    const authFlowResult = await this.oauthProvider.startAuthorizationFlow({
      mcpId: saved.mcp_id,
      appSlug: app.slug,
      serverUrl: oauthUrl,
      contaChave,
      callbackBaseUrl: payload.callbackBaseUrl,
      useLoopbackListener: payload.useLoopbackListener,
      clientIdOverride: payload.clientIdOverride,
      clientSecretOverride: payload.clientSecretOverride,
    });

    this.mcpGateway?.refreshProxyRoutes();

    return {
      ok: true,
      kind: "oauth",
      appSlug: app.slug,
      mcpId: saved.mcp_id,
      contaRotulo,
      contaChave: authFlowResult.contaChave,
      authorizeUrl: authFlowResult.authorizeUrl,
      state: authFlowResult.state,
      redirectUri: authFlowResult.redirectUri,
      server: saved,
    };
  }

  /**
   * Testa a conexão real de um aplicativo nativo da Loja (ex.: Meta Graph API v27.0 para Instagram,
   * Bot API para Telegram, ou status pareado para WhatsApp) e registra o resultado no SQLite.
   */
  public async testNativeApp(
    slug: string,
    contaId?: string
  ): Promise<{
    ok: boolean;
    appSlug: string;
    contaId: string | null;
    resumo: string;
    account?: NativeAppAccountSummary | null;
    validationReport?: MetaValidationReport;
    nativeAccounts: NativeAppAccountSummary[];
  }> {
    const app = this.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }

    const accounts = this.nativeStore.listAccounts(app.slug);
    const targetContaId = contaId?.trim() || accounts[0]?.conta_id || null;

    if (app.slug === "instagram") {
      const validationReport = await validateMetaIntegration(this.vault, this.fetchImpl, {
        nativeStore: this.nativeStore,
        contaId: targetContaId,
      });

      let updatedAcc: NativeAppAccountSummary | null = null;
      if (targetContaId) {
        updatedAcc = this.nativeStore.recordTestResult(targetContaId, {
          ok: validationReport.ok,
          error: validationReport.detalhes.erro,
          perfilConectado: validationReport.detalhes.username
            ? {
                username: validationReport.detalhes.username,
                followers_count: validationReport.detalhes.followersCount,
                media_count: validationReport.detalhes.mediaCount,
              }
            : null,
        });
      }

      return {
        ok: validationReport.ok,
        appSlug: app.slug,
        contaId: targetContaId,
        resumo: validationReport.resumo,
        account: updatedAcc,
        validationReport,
        nativeAccounts: this.nativeStore.listAccounts(app.slug),
      };
    }

    if (app.slug === "telegram") {
      const creds = this.nativeStore.getResolvedCredentials("telegram", targetContaId);
      const token = creds.values.TELEGRAM_BOT_TOKEN?.trim() || "";
      if (!token) {
        if (targetContaId) {
          this.nativeStore.recordTestResult(targetContaId, {
            ok: false,
            error: "Token do bot Telegram não configurado no Cofre.",
          });
        }
        const refreshed = this.nativeStore.listAccounts(app.slug);
        return {
          ok: false,
          appSlug: app.slug,
          contaId: targetContaId,
          resumo: "Token do bot Telegram não configurado no Cofre.",
          account: targetContaId ? this.nativeStore.getAccount(targetContaId) : null,
          nativeAccounts: refreshed,
        };
      }

      let ok = false;
      let errMsg: string | null = null;
      let botUsername: string | null = null;
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
          method: "GET",
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await res.json()) as { ok?: boolean; description?: string; result?: { username?: string } };
        if (res.ok && data.ok) {
          ok = true;
          botUsername = data.result?.username ?? null;
        } else {
          errMsg = data.description || `HTTP ${res.status} na Telegram Bot API.`;
        }
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }

      const updatedAcc = targetContaId
        ? this.nativeStore.recordTestResult(targetContaId, {
            ok,
            error: errMsg,
            perfilConectado: botUsername ? { username: botUsername } : null,
          })
        : null;

      return {
        ok,
        appSlug: app.slug,
        contaId: targetContaId,
        resumo: ok
          ? `Bot Telegram conectado${botUsername ? ` (@${botUsername})` : ""}.`
          : errMsg || "Falha ao validar token do Telegram.",
        account: updatedAcc,
        nativeAccounts: this.nativeStore.listAccounts(app.slug),
      };
    }

    if (app.slug === "whatsapp") {
      let total = 0;
      let conectadas = 0;
      try {
        const row = this.db.connection
          .prepare(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'conectado' THEN 1 ELSE 0 END), 0) AS conectadas
             FROM whatsapp_contas;`
          )
          .get() as { total?: number; conectadas?: number } | undefined;
        total = Number(row?.total ?? 0);
        conectadas = Number(row?.conectadas ?? 0);
      } catch {
        // Ignora caso a tabela ainda esteja vazia
      }
      const ok = conectadas > 0;
      const resumo = ok
        ? `${conectadas} conta(s) WhatsApp conectada(s) (total: ${total}).`
        : "Nenhuma conta WhatsApp conectada no momento.";
      const updatedAcc = targetContaId
        ? this.nativeStore.recordTestResult(targetContaId, { ok, error: ok ? null : resumo })
        : null;
      return {
        ok,
        appSlug: app.slug,
        contaId: targetContaId,
        resumo,
        account: updatedAcc,
        nativeAccounts: this.nativeStore.listAccounts(app.slug),
      };
    }

    const creds = this.nativeStore.getResolvedCredentials(app.slug, targetContaId);
    const hasValues = Object.values(creds.values).some((v) => v.trim().length > 0);
    const updatedAcc = targetContaId
      ? this.nativeStore.recordTestResult(targetContaId, {
          ok: hasValues,
          error: hasValues ? null : "Credenciais não configuradas no Cofre.",
        })
      : null;

    return {
      ok: hasValues,
      appSlug: app.slug,
      contaId: targetContaId,
      resumo: hasValues
        ? "Credenciais localizadas no Cofre AES-256-GCM."
        : "Credenciais não configuradas no Cofre.",
      account: updatedAcc,
      nativeAccounts: this.nativeStore.listAccounts(app.slug),
    };
  }

  /**
   * Persiste as regras de acesso de agentes (`everyone` ou `agents`) para um App Nativo da Loja.
   */
  public updateNativeAppAccess(
    slug: string,
    acesso: Partial<McpAcessoAgentes>,
    contaId?: string | null
  ): {
    ok: boolean;
    appSlug: string;
    nativeAccounts: NativeAppAccountSummary[];
  } {
    const app = this.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }
    const nativeAccounts = this.nativeStore.updateAccess(app.slug, acesso, contaId);
    return {
      ok: true,
      appSlug: app.slug,
      nativeAccounts,
    };
  }

  /**
   * Remove uma conta nativa salva do SQLite e apaga suas chaves correspondentes no Cofre.
   */
  public deleteNativeAppAccount(
    slug: string,
    contaId: string
  ): {
    ok: boolean;
    appSlug: string;
    contaId: string;
    nativeAccounts: NativeAppAccountSummary[];
  } {
    const app = this.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }
    const removed = this.nativeStore.deleteAccount(app.slug, contaId);
    if (!removed) {
      throw new CatalogServiceError(
        `Conta nativa '${contaId}' não encontrada para '${app.slug}'.`,
        "ACCOUNT_NOT_FOUND"
      );
    }
    return {
      ok: true,
      appSlug: app.slug,
      contaId,
      nativeAccounts: this.nativeStore.listAccounts(app.slug),
    };
  }

  private allocateUniqueAgentId(baseCandidate: string): string {
    const base = sanitizeAgentIdBase(baseCandidate);
    const existingRows = this.db.connection
      .prepare(`SELECT agente_id FROM projecao_agentes;`)
      .all() as Array<{ agente_id: string }>;
    const existingSet = new Set(existingRows.map((r) => r.agente_id));

    if (!existingSet.has(base)) {
      return base;
    }

    for (let i = 2; i < 10_000; i += 1) {
      const candidate = `${base}_${i}`;
      if (!existingSet.has(candidate)) {
        return candidate;
      }
    }

    return `${base}_${randomUUID().slice(0, 6)}`;
  }

  /**
   * Instala um agente do catálogo (ou manifesto validado) em 1 clique para `projecao_agentes`,
   * instala/vincula suas habilidades em `projecao_agente_habilidades` e cria rotinas associadas.
   */
  public installAgentPackage(
    slugOrPayload: string | Partial<MarketplaceAgentPackage>,
    overrides: InstallAgentOverrides = {}
  ): InstalledAgentResult {
    const bundle = this.getBundle();
    const pkg: MarketplaceAgentPackage | null =
      typeof slugOrPayload === "string"
        ? bundle.agents.find((a) => a.slug === slugOrPayload.trim()) ?? null
        : {
            slug: slugOrPayload.slug?.trim() || sanitizeMcpIdSegment(slugOrPayload.name || "agente"),
            name: slugOrPayload.name?.trim() || "Agente Importado",
            role: slugOrPayload.role?.trim() || "Especialista do Estúdio",
            tagline: slugOrPayload.tagline?.trim() || slugOrPayload.role?.trim() || "Agente instalado pela Loja",
            description: slugOrPayload.description?.trim() || slugOrPayload.tagline?.trim() || "",
            category: slugOrPayload.category?.trim() || "Operações",
            source: slugOrPayload.source === "verified" ? "verified" : "public",
            verified: Boolean(slugOrPayload.verified),
            featured: Boolean(slugOrPayload.featured),
            recommendedModel: slugOrPayload.recommendedModel?.trim() || "gemini-2.5-pro",
            avatarShape: (slugOrPayload.avatarShape ?? "rounded_square") as AvatarShape,
            avatarColor: slugOrPayload.avatarColor?.trim() || "#007CF7",
            promptBase:
              slugOrPayload.promptBase?.trim() ||
              `Você é ${slugOrPayload.name?.trim() || "um agente especialista"} atuando para [NOME_DA_MARCA] ([@SEU_PERFIL]).`,
            skills: Array.isArray(slugOrPayload.skills)
              ? slugOrPayload.skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              : [],
            routines: Array.isArray(slugOrPayload.routines) ? slugOrPayload.routines : [],
            mcpSlugs: Array.isArray(slugOrPayload.mcpSlugs)
              ? slugOrPayload.mcpSlugs.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
              : [],
          };

    if (!pkg) {
      throw new CatalogServiceError(
        `Pacote de agente '${String(slugOrPayload)}' não encontrado no catálogo.`,
        "AGENT_PACKAGE_NOT_FOUND"
      );
    }

    const configuredBrand = this.resolveConfiguredBrand();
    const agenteId = this.allocateUniqueAgentId(overrides.customAgenteId || pkg.slug || pkg.name);
    const nome = overrides.name?.trim() || pkg.name;
    const rawPapel = pkg.role || pkg.tagline || "Especialista";
    const papel = configuredBrand ? interpolateBrandPlaceholders(rawPapel, configuredBrand) : rawPapel;
    const rawPromptBase = pkg.promptBase;
    const resolvedPromptBase = configuredBrand
      ? interpolateBrandPlaceholders(rawPromptBase, configuredBrand)
      : rawPromptBase;
    const resolvedTagline = configuredBrand
      ? interpolateBrandPlaceholders(pkg.tagline, configuredBrand)
      : pkg.tagline;
    const welcomeMessage = configuredBrand
      ? interpolateBrandPlaceholders(
          `Olá! Sou **${nome}** (${papel}). ${resolvedTagline}\n\nEstou pronto para colaborar com [NOME_DA_MARCA].`,
          configuredBrand
        )
      : `Olá! Sou **${nome}** (${papel}). ${pkg.tagline}\n\nEstou pronto para colaborar com [NOME_DA_MARCA].`;
    const modeloPadrao = overrides.model?.trim() || pkg.recommendedModel || "gemini-2.5-pro";
    const agora = new Date().toISOString();

    const maxOrderRow = this.db.connection
      .prepare(`SELECT COALESCE(MAX(ordem_exibicao), 15) AS max_ordem FROM projecao_agentes;`)
      .get() as { max_ordem?: number } | undefined;
    const ordemExibicao = Number(maxOrderRow?.max_ordem ?? 15) + 1;

    const primarySkillSlug = pkg.skills[0] ?? pkg.slug;
    const configJson = {
      frente: "custom",
      pacote: "loja",
      pasta: overrides.pasta?.trim() || "Agentes da Loja",
      skill_slug: primarySkillSlug,
      avatar_shape: pkg.avatarShape || "rounded_square",
      avatar_color: pkg.avatarColor || "#007CF7",
      effort: "alto",
      ferramentas: ["handoff_agente"],
      prompt_base: resolvedPromptBase,
      customizado: true,
      origem_loja_slug: pkg.slug,
      categoria_loja: pkg.category,
      mcp_slugs: pkg.mcpSlugs ?? [],
    };

    const skillsPathsJson = pkg.skills.map((s) => `dados/skills-loja/${s}/SKILL.md`);

    const createdRoutines: InstalledAgentResult["createdRoutines"] = [];

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status,
             skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
           ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?);`
        )
        .run(
          agenteId,
          nome,
          papel,
          modeloPadrao,
          JSON.stringify(skillsPathsJson),
          ordemExibicao,
          JSON.stringify(configJson),
          agora
        );

      this.db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
             mensagem_id, canal_id, agente_id, autor, autor_nome,
             conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em
           ) VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', NULL, 0, ?);`
        )
        .run(
          `msg-${randomUUID()}`,
          `agente:${agenteId}`,
          agenteId,
          nome,
          welcomeMessage,
          agora
        );

      for (const routine of pkg.routines ?? []) {
        if (!routine || typeof routine.name !== "string" || !routine.name.trim()) continue;
        const rotinaId = `rotina-${agenteId}-${randomUUID().slice(0, 6)}`;
        const expressaoCron = convertRoutineScheduleToCron(routine.schedule);
        const timezone = "America/Sao_Paulo";
        const proximaExecucao = computeNextCronExecution(
          expressaoCron,
          new Date(),
          timezone
        ).toISOString();
        const ativa =
          overrides.activateRoutines !== undefined ? overrides.activateRoutines : routine.active !== false;

        this.db.connection
          .prepare(
            `INSERT INTO projecao_rotinas (
               rotina_id, titulo, expressao_cron, tipo_tarefa, ativa, timezone,
               payload_modelo_json, proxima_execucao_em, criado_em
             ) VALUES (?, ?, ?, 'execucao_agente', ?, ?, ?, ?, ?);`
          )
          .run(
            rotinaId,
            routine.name.trim(),
            expressaoCron,
            ativa ? 1 : 0,
            timezone,
            JSON.stringify({
              agente_id: agenteId,
              instrucao: routine.instruction ?? "",
              origem_loja_slug: pkg.slug,
            }),
            proximaExecucao,
            agora
          );

        createdRoutines.push({
          rotina_id: rotinaId,
          titulo: routine.name.trim(),
          expressao_cron: expressaoCron,
          ativa,
        });
      }
    });

    // Sincroniza e instala/vincula todas as habilidades associadas ao agente
    const installedSkills: MarketplaceSkillItem[] = [];
    for (const skillSlug of pkg.skills ?? []) {
      const cleanSlug = skillSlug.trim();
      if (!cleanSlug) continue;
      try {
        const installed = this.skillsManager.installCatalogSkill(cleanSlug, [agenteId]);
        installedSkills.push(installed);
      } catch {
        // Ignora skill externa ausente no catálogo sem abortar criação do agente
      }
    }

    const agente = this.db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as unknown as InstalledAgentRecord;

    return {
      agente,
      installedSkills,
      createdRoutines,
    };
  }

  /**
   * Exporta um agente do estúdio em manifesto JSON limpo (sem segredos/tokens),
   * incluindo `promptBase`, `recommendedModel`, habilidades vinculadas e rotinas associadas.
   */
  public exportAgentTemplate(agenteId: string): ExportedAgentTemplate {
    const cleanId = agenteId.trim();
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(cleanId) as InstalledAgentRecord | undefined;

    if (!row) {
      throw new CatalogServiceError(`Agente '${cleanId}' não encontrado.`, "AGENT_NOT_FOUND");
    }

    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      cfg = {};
    }

    const linkedSkillsRows = this.db.connection
      .prepare(
        `SELECT c.slug
         FROM projecao_agente_habilidades ah
         JOIN projecao_habilidades_catalogo c ON c.skill_id = ah.skill_id
         WHERE ah.agente_id = ?
         ORDER BY ah.instalada_em ASC, c.slug ASC;`
      )
      .all(cleanId) as Array<{ slug: string }>;

    const skillSlugs = Array.from(
      new Set([
        ...linkedSkillsRows.map((r) => r.slug),
        ...(typeof cfg.skill_slug === "string" && cfg.skill_slug.trim() ? [cfg.skill_slug.trim()] : []),
      ])
    );

    const routineRows = this.db.connection
      .prepare(`SELECT * FROM projecao_rotinas ORDER BY criado_em ASC;`)
      .all() as Array<{
      rotina_id: string;
      titulo: string;
      expressao_cron: string;
      ativa: number;
      payload_modelo_json: string;
    }>;

    const routines: MarketplaceAgentRoutineTemplate[] = [];
    for (const r of routineRows) {
      try {
        const payload = JSON.parse(r.payload_modelo_json || "{}") as {
          agente_id?: string;
          instrucao?: string;
        };
        if (payload.agente_id === cleanId) {
          routines.push({
            name: r.titulo,
            instruction: typeof payload.instrucao === "string" ? payload.instrucao : "",
            active: r.ativa === 1,
            schedule: {
              kind: "cron",
              cron: r.expressao_cron,
            },
          });
        }
      } catch {
        // Ignora rotina com payload malformado
      }
    }

    const mcpSlugs = Array.isArray(cfg.mcp_slugs)
      ? cfg.mcp_slugs.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : [];

    const promptBase =
      typeof cfg.prompt_base === "string" && cfg.prompt_base.trim()
        ? cfg.prompt_base.trim()
        : `Você é ${row.nome}. ${row.papel}`;

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedFromAgentId: row.agente_id,
      slug: sanitizeMcpIdSegment(row.agente_id) || "agente-exportado",
      name: row.nome,
      role: row.papel,
      tagline: row.papel,
      description: `Agente exportado do Criativo AI Studio (${row.nome}).`,
      category: typeof cfg.categoria_loja === "string" ? cfg.categoria_loja : "Operações",
      source: "public",
      verified: false,
      featured: false,
      recommendedModel: row.modelo_padrao,
      avatarShape: (typeof cfg.avatar_shape === "string"
        ? cfg.avatar_shape
        : "rounded_square") as AvatarShape,
      avatarColor: typeof cfg.avatar_color === "string" ? cfg.avatar_color : "#007CF7",
      promptBase,
      skills: skillSlugs,
      routines,
      mcpSlugs,
    };
  }

  /**
   * Duplica um agente existente (base ou customizado) em 1 clique no SQLite,
   * preservando `prompt_base`, `modelo_padrao`, aparência, habilidades e rotinas associadas.
   */
  public duplicateAgent(agenteId: string, newName?: string): InstalledAgentResult {
    const template = this.exportAgentTemplate(agenteId);
    const targetName = newName?.trim() || `${template.name} (Cópia)`;

    const result = this.installAgentPackage(
      {
        ...template,
        slug: `${template.slug}-copia`,
        name: targetName,
      },
      {
        name: targetName,
        pasta: "Agentes Customizados",
      }
    );

    // Garante vínculo de eventuais habilidades já existentes no SQLite (ex.: personalizadas/github)
    // que não vieram do catalog-bundle.json
    const agora = new Date().toISOString();
    const extraSkillIds = this.db.connection
      .prepare(`SELECT skill_id, habilitada FROM projecao_agente_habilidades WHERE agente_id = ?;`)
      .all(agenteId) as Array<{ skill_id: string; habilitada: number }>;

    if (extraSkillIds.length > 0) {
      this.db.runInTransaction(() => {
        const stmt = this.db.connection.prepare(
          `INSERT OR IGNORE INTO projecao_agente_habilidades (
             agente_id, skill_id, habilitada, instalada_em, atualizado_em
           ) VALUES (?, ?, ?, ?, ?);`
        );
        for (const item of extraSkillIds) {
          stmt.run(result.agente.agente_id, item.skill_id, item.habilitada, agora, agora);
        }
      });
    }

    const refreshedSkills = this.skillsManager.listSkills({ agentId: result.agente.agente_id });
    return {
      ...result,
      installedSkills: refreshedSkills,
    };
  }
}
