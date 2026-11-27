import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ModeloProvedorInfo,
  PoolContasConfig,
  ProviderName,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  decodeJwtPayload,
  MODEL_CATALOG_TTL_MS,
  resolveCliBinaryForProvider,
  type CliAccountRecord,
  type CliExecutionInput,
  type CliExecutionOutput,
  type CliServiceRuntimeContext,
} from "./cli-oauth/cli-types-and-helpers.ts";
import {
  listCliAccountsWithQuotas,
  listCliDynamicModels,
} from "./cli-oauth/cli-quota-and-models.ts";
import { connectCliAccountViaBrowser } from "./cli-oauth/cli-login-flows.ts";
import { executeCliAgentTurn } from "./cli-oauth/cli-turn-executor.ts";
import {
  importCliCodexAuthAccount,
  registerCliLoopbackTargetFromAuthUrl,
  registerCliPendingLoopbackPort,
  relayCliLoopbackCallback,
  signInCliCodexIsolatedForRemoteExport,
} from "./cli-oauth/cli-remote-oauth.ts";

export {
  resolveCliBinaryForProvider,
  type CliAccountRecord,
  type CliExecutionInput,
  type CliExecutionOutput,
};

export class CliOAuthAccountsService {
  private readonly db: CriativoDatabase;
  private readonly workspaceCwd: string;
  private readonly accountsRootDir: string;
  private readonly appDataDir?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pendingSignInAbort = new Map<"claude" | "openai", () => void>();
  private readonly pendingLoopbackTarget = new Map<"claude" | "openai", { host: string; port: number }>();
  private mcpConfigResolver?: (agentId?: string | null) => Record<string, unknown> | null;
  private readonly dynamicModelsCache = new Map<
    "claude" | "openai",
    { expiresAt: number; modelos: ModeloProvedorInfo[] }
  >();
  private readonly accountsQuotaCache = new Map<
    string,
    { expiresAt: number; grupos: GrupoCotaConta[] }
  >();

  constructor(options: {
    db: CriativoDatabase;
    workspaceCwd?: string;
    accountsRootDir?: string;
    appDataDir?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.db = options.db;
    this.workspaceCwd = resolve(options.workspaceCwd ?? process.cwd());
    this.accountsRootDir = resolve(
      options.accountsRootDir ?? join(this.workspaceCwd, "dados", "contas")
    );
    this.appDataDir = options.appDataDir;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public cancelPendingSignIn(provedor: "claude" | "openai"): boolean {
    const abortFn = this.pendingSignInAbort.get(provedor);
    if (!abortFn) return false;
    this.pendingSignInAbort.delete(provedor);
    try {
      abortFn();
      return true;
    } catch {
      return false;
    }
  }

  private getStoredRecords(): CliAccountRecord[] {
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'studio_cli_accounts';`)
        .get() as { valor_json: string } | undefined;
      const parsed = row ? (JSON.parse(row.valor_json) as CliAccountRecord[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveStoredRecords(records: CliAccountRecord[]): void {
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('studio_cli_accounts', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(records), new Date().toISOString());
  }

  public getPoolConfig(provedor: "claude" | "openai"): PoolContasConfig | null {
    const accounts = this.listAccounts(provedor);
    if (accounts.length === 0) return null;

    let override: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null } = {};
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ?;`)
        .get(`studio_cli_pool_${provedor}`) as { valor_json: string } | undefined;
      if (row) {
        override = JSON.parse(row.valor_json) as typeof override;
      }
    } catch {
      // ignora config corrompida
    }

    const excluidas = override.contas_excluidas ?? [];
    const habilitado = override.habilitado !== undefined ? override.habilitado : accounts.length > 1;
    const elegivel =
      accounts.find((a) => override.conta_em_uso && a.id === override.conta_em_uso) ??
      accounts.find((a) => !excluidas.includes(a.id)) ??
      accounts[0] ??
      null;

    return {
      habilitado,
      contas_excluidas: excluidas,
      conta_em_uso: elegivel?.id ?? null,
    };
  }

  public setPoolSettings(
    provedor: "claude" | "openai",
    patch: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null }
  ): void {
    const current = this.getPoolConfig(provedor);
    const next = {
      habilitado: patch.habilitado ?? current?.habilitado ?? true,
      contas_excluidas: patch.contas_excluidas ?? current?.contas_excluidas ?? [],
      conta_em_uso: patch.conta_em_uso !== undefined ? patch.conta_em_uso : current?.conta_em_uso ?? null,
    };
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(`studio_cli_pool_${provedor}`, JSON.stringify(next), new Date().toISOString());
  }

  public listAccounts(provedor: "claude" | "openai"): ContaProvedorInfo[] {
    const records = this.getStoredRecords().filter((r) => r.provedor === provedor);
    const out: ContaProvedorInfo[] = [];

    for (const rec of records) {
      const absDir = resolve(rec.configDir);
      if (!existsSync(absDir)) continue;

      let email = rec.email;
      let plano = rec.plano;
      let hasAuthFile = false;

      if (provedor === "claude") {
        const credPath = join(absDir, ".credentials.json");
        hasAuthFile = existsSync(credPath);
        const claudeJson = join(absDir, ".claude.json");
        if (existsSync(claudeJson)) {
          try {
            const parsed = JSON.parse(readFileSync(claudeJson, "utf8")) as {
              oauthAccount?: { emailAddress?: string; billingType?: string };
            };
            email = parsed.oauthAccount?.emailAddress ?? email;
            plano = parsed.oauthAccount?.billingType ?? plano ?? "Claude.ai";
            if (parsed.oauthAccount?.emailAddress) hasAuthFile = true;
          } catch {
            // ignora
          }
        }
      } else {
        const authPath = join(absDir, "auth.json");
        if (existsSync(authPath)) {
          hasAuthFile = true;
          try {
            const auth = JSON.parse(readFileSync(authPath, "utf8")) as {
              tokens?: { id_token?: string };
            };
            const jwt = auth.tokens?.id_token ? decodeJwtPayload(auth.tokens.id_token) : null;
            if (jwt && typeof jwt.email === "string") email = jwt.email;
            const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: string } | undefined;
            if (authMeta?.chatgpt_plan_type) plano = `ChatGPT ${authMeta.chatgpt_plan_type}`;
          } catch {
            // ignora
          }
        }
      }

      if (!hasAuthFile) continue;

      out.push({
        id: rec.id,
        provedor: provedor as ProviderName,
        rotulo: rec.label,
        email: email ?? null,
        plano: plano ?? (provedor === "claude" ? "Claude Pro / Max" : "ChatGPT Plus / Pro"),
        estado: "conectado",
        padrao: out.length === 0,
        token_valido: true,
        grupos_cota: [],
        origem: "criativo",
      });
    }

    return out;
  }


  private getCtx(): CliServiceRuntimeContext {
    return {
      workspaceCwd: this.workspaceCwd,
      accountsRootDir: this.accountsRootDir,
      appDataDir: this.appDataDir,
      fetchImpl: this.fetchImpl,
      pendingSignInAbort: this.pendingSignInAbort,
      pendingLoopbackTarget: this.pendingLoopbackTarget,
      dynamicModelsCache: this.dynamicModelsCache,
      accountsQuotaCache: this.accountsQuotaCache,
      getMcpConfigResolver: () => this.mcpConfigResolver,
      cancelPendingSignIn: (p) => this.cancelPendingSignIn(p),
      getStoredRecords: () => this.getStoredRecords(),
      saveStoredRecords: (r) => this.saveStoredRecords(r),
      getPoolConfig: (p) => this.getPoolConfig(p),
      listAccounts: (p) => this.listAccounts(p),
      invalidateModelCache: (p) => this.invalidateModelCache(p),
      invalidateQuotaCache: (p) => this.invalidateQuotaCache(p),
      listAccountsWithQuotas: (p, f) => this.listAccountsWithQuotas(p, f),
      registerLoopbackTargetFromAuthUrl: (p, u) => this.registerLoopbackTargetFromAuthUrl(p, u),
    };
  }

  public async connectViaBrowser(
    provedor: "claude" | "openai",
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<ContaProvedorInfo> {
    return await connectCliAccountViaBrowser(this.getCtx(), provedor, label, onAuthUrl);
  }

  public getAccountConfigDirs(provedor: "claude" | "openai"): string[] {
    return this.getStoredRecords()
      .filter((r) => r.provedor === provedor)
      .map((r) => resolve(r.configDir));
  }

  public invalidateModelCache(provedor?: "claude" | "openai"): void {
    if (provedor) {
      this.dynamicModelsCache.delete(provedor);
    } else {
      this.dynamicModelsCache.clear();
    }
  }

  public invalidateQuotaCache(provedor?: "claude" | "openai"): void {
    if (!provedor) {
      this.accountsQuotaCache.clear();
      return;
    }
    for (const key of this.accountsQuotaCache.keys()) {
      if (key.startsWith(`${provedor}:`)) {
        this.accountsQuotaCache.delete(key);
      }
    }
  }

  /**
   * Consulta ao vivo as cotas reais (5 horas / Semanal) das contas OAuth de Claude e ChatGPT/Codex:
   * - `claude`: GET `https://api.anthropic.com/api/oauth/usage` usando `claudeAiOauth.accessToken`;
   * - `openai`: JSON-RPC `account/rateLimits/read` em `codex app-server` com `CODEX_HOME` da conta.
   */

  public async listAccountsWithQuotas(
    provedor: "claude" | "openai",
    forceRefresh = false
  ): Promise<ContaProvedorInfo[]> {
    return await listCliAccountsWithQuotas(this.getCtx(), provedor, forceRefresh);
  }

  public async listDynamicModels(
    provedor: "claude" | "openai",
    forceRefresh = false
  ): Promise<ModeloProvedorInfo[]> {
    return await listCliDynamicModels(this.getCtx(), provedor, forceRefresh);
  }

  public setMcpConfigResolver(
    resolver: (agentId?: string | null) => Record<string, unknown> | null
  ): void {
    this.mcpConfigResolver = resolver;
  }

  public removeAccount(provedor: "claude" | "openai", contaId: string): boolean {
    const records = this.getStoredRecords();
    const target = records.find((r) => r.provedor === provedor && r.id === contaId);
    if (!target) return false;

    try {
      rmSync(resolve(target.configDir), { recursive: true, force: true });
    } catch {
      // ignora erro ao apagar pasta
    }

    this.saveStoredRecords(records.filter((r) => !(r.provedor === provedor && r.id === contaId)));
    this.invalidateModelCache(provedor);
    this.invalidateQuotaCache(provedor);
    return true;
  }


  public async executeTurn(input: CliExecutionInput): Promise<CliExecutionOutput> {
    return await executeCliAgentTurn(this.getCtx(), input);
  }

  private registerLoopbackTargetFromAuthUrl(provedor: "claude" | "openai", rawUrl: string): void {
    registerCliLoopbackTargetFromAuthUrl(this.getCtx(), provedor, rawUrl);
  }

  public registerPendingLoopbackPort(provedor: "claude" | "openai", port: number): void {
    registerCliPendingLoopbackPort(this.getCtx(), provedor, port);
  }

  public async signInCodexIsolatedForRemoteExport(
    label?: string,
    onAuthUrl?: (url: string) => void
  ) {
    return await signInCliCodexIsolatedForRemoteExport(this.getCtx(), label, onAuthUrl);
  }

  public async importCodexAuthAccount(input: {
    authJson: string;
    email?: string | null;
    plano?: string | null;
    label?: string;
  }) {
    return await importCliCodexAuthAccount(this.getCtx(), input);
  }

  public async relayLoopbackCallback(
    provedor: "claude" | "openai",
    rawCallbackInput: string
  ) {
    return await relayCliLoopbackCallback(this.getCtx(), provedor, rawCallbackInput);
  }
}
