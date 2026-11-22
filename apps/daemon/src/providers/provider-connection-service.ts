import {
  existsSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";
import type {
  OnboardingEstado,
  ProviderName,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  McpGateway,
} from "../mcp/mcp-gateway.ts";
import type {
  CriativoStudioMcpBridge,
  McpBridgeEndpointOptions,
} from "../mcp/studio-mcp-bridge.ts";
import type {
  VaultService,
} from "../vault/vault-service.ts";
import {
  AntigravityLiveService,
} from "./antigravity-live-service.ts";
import {
  CliOAuthAccountsService,
  resolveCliBinaryForProvider,
} from "./cli-oauth-accounts-service.ts";
import {
  OpenCodeLiveService,
} from "./opencode-live-service.ts";
import { type ProviderConnectionDeps, type TailArgs, PROVIDER_CATALOG, DEFAULT_ONBOARDING } from "./provider-catalog-helpers.ts";
import { detectLocalBinary, detectOllamaModels, selectPoolAccount } from "./provider-local-detection.ts";
import * as actionsOps from "./provider-status-and-actions.ts";

export { PROVIDER_CATALOG } from "./provider-catalog-helpers.ts";
export { selectPoolAccount } from "./provider-local-detection.ts";

export class ProviderConnectionService {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;
  private readonly antigravityLive: AntigravityLiveService;
  private readonly cliOAuth: CliOAuthAccountsService;
  private readonly opencodeLive: OpenCodeLiveService;
  private mcpGateway?: McpGateway;
  private studioMcpBridge?: CriativoStudioMcpBridge;
  private cliCache: {
    expiresAt: number;
    data: Record<ProviderName, { found: boolean; version: string | null; executable: string | null }>;
  } | null = null;

  constructor(options: {
    db: CriativoDatabase;
    vault: VaultService;
    workspaceRoot?: string;
    sharedAuthDir?: string | null;
    antigravityLive?: AntigravityLiveService;
    cliOAuth?: CliOAuthAccountsService;
    opencodeLive?: OpenCodeLiveService;
    mcpGateway?: McpGateway;
  }) {
    this.db = options.db;
    this.vault = options.vault;
    this.mcpGateway = options.mcpGateway;
    const baseWorkspace = resolve(options.workspaceRoot ?? process.cwd());
    const explicitSharedAuth = options.sharedAuthDir ?? process.env.CRIATIVO_SHARED_AUTH_DIR;
    const daemonDadosContas = join(baseWorkspace, "apps", "daemon", "dados", "contas");
    const daemonDadosDir = join(baseWorkspace, "apps", "daemon", "dados");
    const accountsRoot =
      explicitSharedAuth && explicitSharedAuth.trim().length > 0
        ? resolve(explicitSharedAuth)
        : existsSync(daemonDadosContas) || existsSync(daemonDadosDir)
          ? daemonDadosContas
          : join(baseWorkspace, "dados", "contas");

    this.antigravityLive =
      options.antigravityLive ??
      new AntigravityLiveService({
        db: this.db,
        workspaceCwd: baseWorkspace,
        accountsRootDir: join(accountsRoot, "gemini"),
        mcpGateway: options.mcpGateway,
      });

    this.cliOAuth =
      options.cliOAuth ??
      new CliOAuthAccountsService({
        db: this.db,
        workspaceCwd: baseWorkspace,
        accountsRootDir: accountsRoot,
      });

    this.opencodeLive =
      options.opencodeLive ??
      new OpenCodeLiveService({
        vault: this.vault,
        workspaceCwd: baseWorkspace,
        mcpServersResolver: (agentId) => this.buildCombinedAcpMcpServers(agentId),
      });

    if (options.mcpGateway) {
      this.attachMcpGateway(options.mcpGateway);
    }
  }

  public buildCombinedAcpMcpServers(
    agentId?: string | null,
    endpointOpts?: McpBridgeEndpointOptions,
  ): unknown[] {
    if (
      Array.isArray(endpointOpts?.scopes) &&
      endpointOpts.scopes.length === 0 &&
      endpointOpts.includeExternalMcps === false
    ) {
      return [];
    }
    const internalBridge =
      Array.isArray(endpointOpts?.scopes) && endpointOpts.scopes.length === 0
        ? null
        : this.studioMcpBridge?.getAcpBridgeServerSpec(agentId, endpointOpts) ?? null;
    const external =
      endpointOpts?.includeExternalMcps === false
        ? []
        : this.mcpGateway?.getAcpMcpServers(agentId) ?? [];
    return internalBridge ? [internalBridge, ...external] : external;
  }

  public buildClaudeMcpConfig(
    agentId?: string | null,
    endpointOpts?: McpBridgeEndpointOptions,
  ): Record<string, unknown> | null {
    return this.studioMcpBridge?.getClaudeMcpConfigObject(agentId, endpointOpts) ?? null;
  }

  public getStudioMcpBridge(): CriativoStudioMcpBridge | undefined {
    return this.studioMcpBridge;
  }

  public attachMcpGateway(gateway: McpGateway): void {
    this.mcpGateway = gateway;
    this.antigravityLive.setMcpGateway(gateway);
    this.opencodeLive.setMcpServersResolver((agentId) => this.buildCombinedAcpMcpServers(agentId));
  }

  public attachStudioMcpBridge(bridge: CriativoStudioMcpBridge): void {
    this.studioMcpBridge = bridge;
    this.antigravityLive.setExtraMcpServersResolver((agentId) => {
      const spec = this.studioMcpBridge?.getAcpBridgeServerSpec(agentId);
      return spec ? [spec] : [];
    });
    this.opencodeLive.setMcpServersResolver((agentId) => this.buildCombinedAcpMcpServers(agentId));
    this.cliOAuth.setMcpConfigResolver((agentId) =>
      this.studioMcpBridge?.getClaudeMcpConfigObject(agentId) ?? null
    );
  }

  public getAntigravityService(): AntigravityLiveService {
    return this.antigravityLive;
  }

  public getCliOAuthService(): CliOAuthAccountsService {
    return this.cliOAuth;
  }

  public getOpenCodeService(): OpenCodeLiveService {
    return this.opencodeLive;
  }

  public getStudioConfig<T>(chave: string, fallback: T): T {
    const row = this.db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ?;`)
      .get(chave) as { valor_json: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.valor_json) as T;
    } catch {
      return fallback;
    }
  }

  public setStudioConfig(chave: string, valor: unknown): void {
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(chave, JSON.stringify(valor), new Date().toISOString());
  }

  public getOnboardingState(): OnboardingEstado {
    return this.getStudioConfig<OnboardingEstado>("onboarding", {
      ...DEFAULT_ONBOARDING,
      atualizado_em: new Date().toISOString(),
    });
  }

  public updateOnboardingState(patch: Partial<OnboardingEstado>): OnboardingEstado {
    const current = this.getOnboardingState();
    const updated: OnboardingEstado = {
      ...current,
      ...patch,
      atualizado_em: new Date().toISOString(),
    };
    this.setStudioConfig("onboarding", updated);
    return updated;
  }

  private async getCliProbeCache(): Promise<
    Record<ProviderName, { found: boolean; version: string | null; executable: string | null }>
  > {
    const now = Date.now();
    if (this.cliCache && this.cliCache.expiresAt > now) {
      return this.cliCache.data;
    }

    const entries = await Promise.all(
      PROVIDER_CATALOG.map(async (item) => {
        if (item.provedor === "claude" || item.provedor === "openai") {
          const b = resolveCliBinaryForProvider(item.provedor);
          if (b.executable) {
            return [item.provedor, { found: true, version: b.version, executable: b.executable }] as const;
          }
        }
        const probed = await detectLocalBinary(item.cliBins, item.managedRuntimeFolder);
        if (item.provedor === "ollama" && !probed.found) {
          const ollamaCheck = await detectOllamaModels();
          if (ollamaCheck.up) {
            return [
              item.provedor,
              { found: true, version: "Ollama Daemon HTTP", executable: "http://127.0.0.1:11434" },
            ] as const;
          }
        }
        return [item.provedor, probed] as const;
      })
    );

    const map = Object.fromEntries(entries) as Record<
      ProviderName,
      { found: boolean; version: string | null; executable: string | null }
    >;
    this.cliCache = { expiresAt: now + 60_000, data: map };
    return map;
  }

  private getAgentsByProvider(): Record<string, string[]> {
    const rows = this.db.connection
      .prepare(`SELECT nome, modelo_padrao FROM projecao_agentes ORDER BY nome ASC;`)
      .all() as Array<{ nome: string; modelo_padrao: string }>;

    const map: Record<string, string[]> = {
      gemini: [],
      claude: [],
      openai: [],
      opencode: [],
      grok: [],
      ollama: [],
    };
    for (const r of rows) {
      const m = r.modelo_padrao.toLowerCase();
      if (m.startsWith("opencode/") || m.endsWith("-free") || m.includes("big-pickle")) map.opencode.push(r.nome);
      else if (m.startsWith("ollama/") || m.includes("llama") || m.includes("qwen")) map.ollama.push(r.nome);
      else if (m.includes("claude")) map.claude.push(r.nome);
      else if (m.includes("grok")) map.grok.push(r.nome);
      else if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3")) map.openai.push(r.nome);
      else map.gemini.push(r.nome);
    }
    return map;
  }

  public invalidateCliProbeCache(): void {
    this.cliCache = null;
  }


  private deps(): ProviderConnectionDeps {
    return {
      db: this.db,
      vault: this.vault,
      antigravityLive: this.antigravityLive,
      cliOAuth: this.cliOAuth,
      opencodeLive: this.opencodeLive,
      mcpGateway: this.mcpGateway,
      studioMcpBridge: this.studioMcpBridge,
      getCliProbeCache: this.getCliProbeCache.bind(this),
      getAgentsByProvider: this.getAgentsByProvider.bind(this),
      invalidateCliProbeCache: this.invalidateCliProbeCache.bind(this),
      getStudioConfig: this.getStudioConfig.bind(this),
      setStudioConfig: this.setStudioConfig.bind(this),
      getOnboardingState: this.getOnboardingState.bind(this),
      updateOnboardingState: this.updateOnboardingState.bind(this),
    };
  }

  public getProvidersStatus(...args: TailArgs<typeof actionsOps.getProvidersStatusOp>): ReturnType<typeof actionsOps.getProvidersStatusOp> {
    return actionsOps.getProvidersStatusOp(this.deps(), ...args);
  }

  public ensureOpenCodeRuntimeInBackground(...args: TailArgs<typeof actionsOps.ensureOpenCodeRuntimeInBackgroundOp>): ReturnType<typeof actionsOps.ensureOpenCodeRuntimeInBackgroundOp> {
    return actionsOps.ensureOpenCodeRuntimeInBackgroundOp(this.deps(), ...args);
  }

  public connectProvider(...args: TailArgs<typeof actionsOps.connectProviderOp>): ReturnType<typeof actionsOps.connectProviderOp> {
    return actionsOps.connectProviderOp(this.deps(), ...args);
  }

  public pickPoolAccount(...args: TailArgs<typeof actionsOps.pickPoolAccountOp>): ReturnType<typeof actionsOps.pickPoolAccountOp> {
    return actionsOps.pickPoolAccountOp(this.deps(), ...args);
  }

  public selectPoolAccount(...args: TailArgs<typeof actionsOps.selectPoolAccountOp>): ReturnType<typeof actionsOps.selectPoolAccountOp> {
    return actionsOps.selectPoolAccountOp(this.deps(), ...args);
  }

  public connectProviderViaBrowser(...args: TailArgs<typeof actionsOps.connectProviderViaBrowserOp>): ReturnType<typeof actionsOps.connectProviderViaBrowserOp> {
    return actionsOps.connectProviderViaBrowserOp(this.deps(), ...args);
  }

  public cancelBrowserSignIn(...args: TailArgs<typeof actionsOps.cancelBrowserSignInOp>): ReturnType<typeof actionsOps.cancelBrowserSignInOp> {
    return actionsOps.cancelBrowserSignInOp(this.deps(), ...args);
  }

  public setHiddenModels(...args: TailArgs<typeof actionsOps.setHiddenModelsOp>): ReturnType<typeof actionsOps.setHiddenModelsOp> {
    return actionsOps.setHiddenModelsOp(this.deps(), ...args);
  }

  public disconnectProvider(...args: TailArgs<typeof actionsOps.disconnectProviderOp>): ReturnType<typeof actionsOps.disconnectProviderOp> {
    return actionsOps.disconnectProviderOp(this.deps(), ...args);
  }

  public getUsageSnapshot(...args: TailArgs<typeof actionsOps.getUsageSnapshotOp>): ReturnType<typeof actionsOps.getUsageSnapshotOp> {
    return actionsOps.getUsageSnapshotOp(this.deps(), ...args);
  }

  public close(): void {
    this.antigravityLive.close();
    this.opencodeLive.close();
  }
}

