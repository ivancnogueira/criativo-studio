import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ContaProvedorInfo,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
  PoolEstrategiaContas,
} from "@criativo/contracts";
import {
  buildPoolSnapshotsForStudioRecords,
  executeSafeAccountRemoval,
  type SafeAccountRemovalResult,
} from "./provider-account-pool.ts";
import type { CriativoDatabase } from "../database/client.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import {
  AntigravityAcpService,
  type AcpDiscoveredModel,
  type LabeledImageInput,
} from "./antigravity-acp-service.ts";
import {
  ACP_MODELS_CACHE_TTL_MS,
  CACHE_TTL_MS,
  isInternalHiddenModelId,
  type AcpModelsCacheState,
  type AntigravityLiveSnapshot,
  type CodeAssistGenerateInput,
  type CodeAssistGenerateOutput,
  type CodeAssistQuotaBucket,
  type CodeAssistQuotaGroup,
  type CodeAssistRetrieveQuotaResponse,
  type DiscoveredTokenEntry,
  type FetchAvailableModelEntry,
  type FetchAvailableModelQuotaSlot,
  type FetchAvailableModelsResponse,
  type SnapshotCacheEntry,
  type StudioAccountRecord,
  type TokenFilePayload,
} from "./antigravity/live-types.ts";
import {
  classifyQuotaWindowKind,
  extractQuotaBucketsFromResponse,
  extractQuotaGroupsFromResponse,
  extractRemainingPercentage,
  mergeAndSortQuotaGroups,
  normalizeWindowBucket,
  resolveQuotaGroupName,
  synthesizeQuotaGroupsFromModels,
} from "./antigravity/quota-helpers.ts";
import {
  filterHttpAvailableModels,
  normalizeModelFamilyAndEffort,
  safeReadJson,
} from "./antigravity/model-filter-helpers.ts";
import { computeAntigravityLiveSnapshot } from "./antigravity/live-snapshot.ts";
import { executeAntigravityCodeAssistGenerate } from "./antigravity/codeassist-executor.ts";

export type {
  LabeledImageInput,
  CodeAssistQuotaBucket,
  CodeAssistQuotaGroup,
  CodeAssistRetrieveQuotaResponse,
  FetchAvailableModelQuotaSlot,
  FetchAvailableModelEntry,
  FetchAvailableModelsResponse,
  AntigravityLiveSnapshot,
  CodeAssistGenerateInput,
  CodeAssistGenerateOutput,
};

export {
  extractRemainingPercentage,
  classifyQuotaWindowKind,
  normalizeWindowBucket,
  resolveQuotaGroupName,
  extractQuotaGroupsFromResponse,
  extractQuotaBucketsFromResponse,
  mergeAndSortQuotaGroups,
  synthesizeQuotaGroupsFromModels,
  isInternalHiddenModelId,
  filterHttpAvailableModels,
};

export class AntigravityLiveService {
  private readonly db?: CriativoDatabase;
  private readonly accountsRootDir: string;
  private readonly workspaceCwd: string;
  private readonly appDataDir?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly acpService: AntigravityAcpService;
  private readonly allowAutoAcpDiscovery: boolean;
  private mcpGateway?: McpGateway;
  private extraMcpServersResolver?: (agentId?: string | null) => unknown[];
  private snapshotCache: SnapshotCacheEntry | null = null;
  private inFlightSnapshot: Promise<AntigravityLiveSnapshot> | null = null;
  private acpModelsCache: AcpModelsCacheState | null = null;

  constructor(options?: {
    db?: CriativoDatabase;
    accountsRootDir?: string;
    appDataDir?: string;
    workspaceCwd?: string;
    fetchImpl?: typeof fetch;
    acpService?: AntigravityAcpService;
    mcpGateway?: McpGateway;
  }) {
    this.db = options?.db;
    this.appDataDir = options?.appDataDir;
    this.workspaceCwd = resolve(options?.workspaceCwd ?? process.cwd());
    this.accountsRootDir = resolve(
      options?.accountsRootDir ?? join(this.workspaceCwd, "dados", "contas", "gemini")
    );
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.allowAutoAcpDiscovery = Boolean(options?.acpService || !options?.fetchImpl);
    this.mcpGateway = options?.mcpGateway;
    this.acpService =
      options?.acpService ??
      new AntigravityAcpService({
        appDataDir: options?.appDataDir,
        mcpServersResolver: (agentId) => this.resolveCombinedMcpServers(agentId),
      });
    if (options?.mcpGateway && options?.acpService) {
      this.acpService.setMcpServersResolver(
        (agentId) => this.resolveCombinedMcpServers(agentId)
      );
    }
  }

  private persistDiscoveredAcpModels(
    geminiDir: string,
    models: AcpDiscoveredModel[],
    defaultModelId: string | null
  ): void {
    try {
      if (!models || models.length === 0) return;
      const acpDir = join(resolve(geminiDir), "antigravity-acp");
      mkdirSync(acpDir, { recursive: true });
      writeFileSync(
        join(acpDir, "acp-discovered-models.json"),
        JSON.stringify(
          {
            models,
            defaultModelId,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {
      // ignora erro ao gravar cache em disco
    }
  }

  private loadDiscoveredAcpModels(
    geminiDir: string
  ): { models: AcpDiscoveredModel[]; defaultModelId: string | null } | null {
    const filePath = join(resolve(geminiDir), "antigravity-acp", "acp-discovered-models.json");
    const parsed = safeReadJson<{
      models?: AcpDiscoveredModel[];
      defaultModelId?: string | null;
    }>(filePath);
    if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) {
      return null;
    }
    return {
      models: parsed.models,
      defaultModelId: parsed.defaultModelId ?? null,
    };
  }

  private resolveCombinedMcpServers(agentId?: string | null): unknown[] {
    const extra = this.extraMcpServersResolver?.(agentId) ?? [];
    const ext = this.mcpGateway?.getAcpMcpServers(agentId) ?? [];
    return [...extra, ...ext];
  }

  public setMcpGateway(gateway: McpGateway): void {
    this.mcpGateway = gateway;
    this.acpService.setMcpServersResolver(
      (agentId) => this.resolveCombinedMcpServers(agentId)
    );
  }

  public setExtraMcpServersResolver(resolver: (agentId?: string | null) => unknown[]): void {
    this.extraMcpServersResolver = resolver;
    this.acpService.setMcpServersResolver(
      (agentId) => this.resolveCombinedMcpServers(agentId)
    );
  }

  public getCliExecutable(): string | null {
    return this.acpService.getCliExecutable();
  }

  private getStudioRecords(): {
    accounts: StudioAccountRecord[];
    poolOverride?: {
      habilitado?: boolean;
      contas_excluidas?: string[];
      conta_em_uso?: string | null;
      estrategia?: PoolEstrategiaContas;
    };
  } {
    if (!this.db) return { accounts: [] };
    try {
      const rowAcc = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_contas_studio';`)
        .get() as { valor_json: string } | undefined;
      const rowPool = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_pool';`)
        .get() as { valor_json: string } | undefined;

      const parsedAcc = rowAcc ? (JSON.parse(rowAcc.valor_json) as StudioAccountRecord[]) : [];
      const parsedPool = rowPool
        ? (JSON.parse(rowPool.valor_json) as {
            habilitado?: boolean;
            contas_excluidas?: string[];
            conta_em_uso?: string | null;
            estrategia?: PoolEstrategiaContas;
          })
        : undefined;

      return { accounts: Array.isArray(parsedAcc) ? parsedAcc : [], poolOverride: parsedPool };
    } catch {
      return { accounts: [] };
    }
  }

  private saveStudioRecords(accounts: StudioAccountRecord[]): void {
    if (!this.db) return;
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('antigravity_contas_studio', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(accounts), new Date().toISOString());
    this.snapshotCache = null;
    this.acpModelsCache = null;
  }

  private saveLastSnapshotCache(data: {
    contas: ContaProvedorInfo[];
    modelos: ModeloProvedorInfo[];
    defaultModelId: string | null;
    imageGenerationModelIds: string[];
  }): void {
    if (!this.db) return;
    try {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
           VALUES ('antigravity_last_snapshot', ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
        )
        .run(JSON.stringify(data), new Date().toISOString());
    } catch {
      // ignora erro ao gravar cache local
    }
  }

  private loadLastSnapshotCache(): {
    contas?: ContaProvedorInfo[];
    modelos?: ModeloProvedorInfo[];
    defaultModelId?: string | null;
    imageGenerationModelIds?: string[];
  } | null {
    if (!this.db) return null;
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_last_snapshot';`)
        .get() as { valor_json: string } | undefined;
      return row
        ? (JSON.parse(row.valor_json) as {
            contas?: ContaProvedorInfo[];
            modelos?: ModeloProvedorInfo[];
            defaultModelId?: string | null;
            imageGenerationModelIds?: string[];
          })
        : null;
    } catch {
      return null;
    }
  }

  private deduplicateModels(models: ModeloProvedorInfo[]): ModeloProvedorInfo[] {
    const byLabel = new Map<string, ModeloProvedorInfo>();
    for (const m of models) {
      const key = `${m.rotulo.trim().toLowerCase()}::${m.grupo_cota ?? ""}`;
      const existing = byLabel.get(key);
      if (!existing) {
        byLabel.set(key, { ...m });
        continue;
      }
      const existingScore =
        (existing.padrao ? 4 : 0) +
        (existing.id.includes("-high") ? 2 : existing.id.includes("-medium") ? 1 : 0);
      const nextScore =
        (m.padrao ? 4 : 0) + (m.id.includes("-high") ? 2 : m.id.includes("-medium") ? 1 : 0);
      const mergedEfforts = Array.from(
        new Set([...(existing.esforcos_suportados ?? []), ...(m.esforcos_suportados ?? []), "baixo", "medio", "alto"])
      ) as NivelEsforco[];

      if (nextScore > existingScore) {
        byLabel.set(key, {
          ...m,
          padrao: Boolean(existing.padrao || m.padrao),
          suporta_imagem: Boolean(existing.suporta_imagem || m.suporta_imagem),
          esforcos_suportados: mergedEfforts,
        });
      } else {
        existing.padrao = Boolean(existing.padrao || m.padrao);
        existing.suporta_imagem = Boolean(existing.suporta_imagem || m.suporta_imagem);
        existing.esforcos_suportados = mergedEfforts;
        if (
          typeof m.restante_percentual === "number" &&
          (existing.restante_percentual === null ||
            existing.restante_percentual === undefined ||
            m.restante_percentual > existing.restante_percentual)
        ) {
          existing.restante_percentual = m.restante_percentual;
        }
      }
    }
    return [...byLabel.values()].sort((a, b) => {
      if (a.padrao && !b.padrao) return -1;
      if (!a.padrao && b.padrao) return 1;
      return a.rotulo.localeCompare(b.rotulo, "pt-BR");
    });
  }

  private discoverStudioTokenEntries(): {
    entries: DiscoveredTokenEntry[];
    poolOverride?: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null };
  } {
    const { accounts, poolOverride } = this.getStudioRecords();
    const entries: DiscoveredTokenEntry[] = [];
    const seenEmails = new Set<string>();

    for (const acc of accounts) {
      if (!acc.geminiDir) continue;
      const absDir = resolve(acc.geminiDir);
      const tokenPath = join(absDir, "antigravity-acp", "antigravity-oauth-token");
      if (!existsSync(tokenPath)) continue;

      const payload = safeReadJson<TokenFilePayload>(tokenPath);
      const email = payload?.id_token_email?.trim() || acc.email || null;
      if (email) {
        const lowerEmail = email.toLowerCase();
        if (seenEmails.has(lowerEmail)) continue;
        seenEmails.add(lowerEmail);
      }

      const accessToken = payload?.token?.access_token?.trim() || null;
      const expiryIso = payload?.token?.expiry ?? null;
      const expiryMs = expiryIso ? Date.parse(expiryIso) : Number.NaN;
      const tokenValid = Boolean(accessToken && (!expiryIso || expiryMs > Date.now() + 60_000));

      entries.push({
        id: acc.id,
        label: acc.label ?? null,
        geminiDir: absDir,
        tokenPath,
        email,
        accessToken,
        hasRefreshToken: Boolean(payload?.token?.refresh_token?.trim()),
        expiryIso,
        tokenValid,
      });
    }

    return { entries, poolOverride };
  }

  public async getLiveSnapshot(forceRefresh = false): Promise<AntigravityLiveSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.snapshotCache && this.snapshotCache.expiresAt > now) {
      return this.snapshotCache.data;
    }
    if (!forceRefresh && this.inFlightSnapshot) {
      return await this.inFlightSnapshot;
    }

    const promise = this.computeLiveSnapshot(forceRefresh).finally(() => {
      if (this.inFlightSnapshot === promise) {
        this.inFlightSnapshot = null;
      }
    });
    this.inFlightSnapshot = promise;
    return await promise;
  }

  private async computeLiveSnapshot(forceRefresh = false): Promise<AntigravityLiveSnapshot> {
    return await computeAntigravityLiveSnapshot(
      {
        appDataDir: this.appDataDir,
        fetchImpl: this.fetchImpl,
        acpService: this.acpService,
        allowAutoAcpDiscovery: this.allowAutoAcpDiscovery,
        getAcpModelsCache: () => this.acpModelsCache,
        setAcpModelsCache: (val) => {
          this.acpModelsCache = val;
        },
        setSnapshotCache: (val) => {
          this.snapshotCache = val;
        },
        discoverStudioTokenEntries: () => this.discoverStudioTokenEntries(),
        loadLastSnapshotCache: () => this.loadLastSnapshotCache(),
        saveLastSnapshotCache: (data) => this.saveLastSnapshotCache(data),
        persistDiscoveredAcpModels: (geminiDir, models, defaultModelId) =>
          this.persistDiscoveredAcpModels(geminiDir, models, defaultModelId),
        loadDiscoveredAcpModels: (geminiDir) => this.loadDiscoveredAcpModels(geminiDir),
        deduplicateModels: (models) => this.deduplicateModels(models),
      },
      forceRefresh
    );
  }

  public setPoolSettings(patch: {
    habilitado?: boolean;
    contas_excluidas?: string[];
    conta_em_uso?: string | null;
    estrategia?: PoolEstrategiaContas;
  }): void {
    if (!this.db) return;
    const { poolOverride } = this.getStudioRecords();
    const next = {
      habilitado: patch.habilitado ?? poolOverride?.habilitado ?? true,
      contas_excluidas: patch.contas_excluidas ?? poolOverride?.contas_excluidas ?? [],
      conta_em_uso: patch.conta_em_uso !== undefined ? patch.conta_em_uso : poolOverride?.conta_em_uso ?? null,
      estrategia: patch.estrategia ?? poolOverride?.estrategia ?? "fill_first",
    };
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('antigravity_pool', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(next), new Date().toISOString());
    this.snapshotCache = null;
    this.acpModelsCache = null;
  }

  public cancelPendingSignIn(): boolean {
    return this.acpService.cancelPendingSignIn();
  }

  /**
   * Abre o fluxo oficial Google OAuth no navegador via `antigravity acp --gemini-dir=<pasta_isolada>`
   * e salva a conta exclusivamente no armazenamento local do CriativoOS.
   */
  public async connectGoogleViaBrowser(
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<ContaProvedorInfo> {
    const id = `ag-${randomUUID().slice(0, 8)}`;
    const geminiDir = resolve(this.accountsRootDir, id);

    try {
      const tokenSnap = await this.acpService.signInWithGoogleBrowser({
        geminiDir,
        onAuthUrl,
      });
      const email = tokenSnap.email;
      const { accounts } = this.getStudioRecords();

      // Deduplica automaticamente se o usuário reautenticar com o mesmo e-mail Google
      const dupIdx = email
        ? accounts.findIndex((a) => a.email && a.email.toLowerCase() === email.toLowerCase())
        : -1;

      if (dupIdx >= 0) {
        const old = accounts[dupIdx];
        this.acpService.disposeAccount(old.id);
        if (old.geminiDir && resolve(old.geminiDir) !== geminiDir) {
          try {
            rmSync(resolve(old.geminiDir), { recursive: true, force: true });
          } catch {
            // ignora remoção da pasta antiga
          }
        }
        accounts.splice(dupIdx, 1);
      }

      const nextAccounts: StudioAccountRecord[] = [
        ...accounts,
        {
          id,
          geminiDir,
          label: label?.trim() || null,
          email,
        },
      ];
      this.saveStudioRecords(nextAccounts);

      const snapshot = await this.getLiveSnapshot(true);
      const found = snapshot.contas.find((c) => c.id === id);
      return (
        found ?? {
          id,
          provedor: "gemini",
          rotulo: label?.trim() || null,
          email,
          estado: "conectado",
          padrao: nextAccounts.length === 1,
          token_valido: true,
          token_expira_em: tokenSnap.expiryIso,
          grupos_cota: [],
          origem: "criativo",
        }
      );
    } catch (err) {
      try {
        rmSync(geminiDir, { recursive: true, force: true });
      } catch {
        // ignora limpeza em erro
      }
      throw err;
    }
  }

  /**
   * Executa login Google OAuth em pasta temporária isolada apenas para exportar os tokens
   * ao servidor remoto (VPS), sem gravar nem alterar contas no servidor principal do Desktop.
   */
  public async signInIsolatedForRemoteExport(
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<{
    email: string;
    accessToken: string;
    refreshToken: string;
    expiry: string;
    label?: string;
    acpModels?: AcpDiscoveredModel[];
    acpDefaultModelId?: string | null;
  }> {
    const tempId = `ag-remote-${randomUUID().slice(0, 8)}`;
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-gemini-remote-"));

    try {
      const tokenSnap = await this.acpService.signInWithGoogleBrowser({
        geminiDir: tempDir,
        onAuthUrl,
      });
      const tokenPath = join(tempDir, "antigravity-acp", "antigravity-oauth-token");
      const raw = safeReadJson<TokenFilePayload>(tokenPath);
      const accessToken = tokenSnap.accessToken ?? raw?.token?.access_token?.trim() ?? "";
      const refreshToken = tokenSnap.refreshToken ?? raw?.token?.refresh_token?.trim() ?? "";
      const email = tokenSnap.email ?? raw?.id_token_email?.trim() ?? "";
      const expiry =
        tokenSnap.expiryIso ?? raw?.token?.expiry?.trim() ?? new Date(Date.now() + 55 * 60_000).toISOString();

      if (!accessToken || !email) {
        throw new Error(
          "Login Google concluído, porém o token OAuth ou e-mail da conta não puderam ser exportados."
        );
      }

      const acpCatalog = await this.acpService
        .listAvailableModels(tempId, tempDir)
        .catch(() => null);

      return {
        email,
        accessToken,
        refreshToken,
        expiry,
        ...(label?.trim() ? { label: label.trim() } : {}),
        ...(acpCatalog && acpCatalog.models.length > 0
          ? {
              acpModels: acpCatalog.models,
              acpDefaultModelId: acpCatalog.defaultModelId,
            }
          : {}),
      };
    } finally {
      this.acpService.disposeAccount(tempId);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignora erro na limpeza temporária
      }
    }
  }

  public addManualTokenAccount(input: {
    email: string;
    label?: string;
    accessToken: string;
    refreshToken?: string;
    expiry?: string;
    acpModels?: AcpDiscoveredModel[];
    acpDefaultModelId?: string | null;
  }): ContaProvedorInfo {
    if (!this.db) throw new Error("Banco indisponível para salvar conta.");
    const id = `ag-${Date.now().toString(36)}`;
    const geminiDir = resolve(this.accountsRootDir, id);
    const acpDir = join(geminiDir, "antigravity-acp");
    mkdirSync(acpDir, { recursive: true });
    const tokenPath = join(acpDir, "antigravity-oauth-token");
    const expiry = input.expiry?.trim() || new Date(Date.now() + 55 * 60_000).toISOString();

    writeFileSync(
      tokenPath,
      JSON.stringify(
        {
          token: {
            access_token: input.accessToken.trim(),
            token_type: "Bearer",
            refresh_token: input.refreshToken?.trim() || "",
            expiry,
          },
          auth_method: "consumer",
          id_token_email: input.email.trim(),
        },
        null,
        2
      ),
      "utf8"
    );

    const { accounts } = this.getStudioRecords();
    const filtered = accounts.filter(
      (a) => !a.email || a.email.toLowerCase() !== input.email.trim().toLowerCase()
    );
    const nextAccounts: StudioAccountRecord[] = [
      ...filtered,
      {
        id,
        geminiDir,
        label: input.label?.trim() || null,
        email: input.email.trim(),
      },
    ];
    this.saveStudioRecords(nextAccounts);
    this.snapshotCache = null;

    if (Array.isArray(input.acpModels) && input.acpModels.length > 0) {
      const defaultId = input.acpDefaultModelId ?? null;
      this.persistDiscoveredAcpModels(geminiDir, input.acpModels, defaultId);
      this.acpModelsCache = {
        accountId: id,
        expiresAt: Date.now() + ACP_MODELS_CACHE_TTL_MS,
        models: input.acpModels,
        defaultModelId: defaultId,
      };
    }

    return {
      id,
      provedor: "gemini",
      rotulo: input.label?.trim() || null,
      email: input.email.trim(),
      estado: "conectado",
      padrao: nextAccounts.length === 1,
      token_valido: true,
      token_expira_em: expiry,
      grupos_cota: [],
      origem: "criativo",
    };
  }

  public removeAccount(accountId: string): boolean {
    if (!this.db) return false;
    const { accounts } = this.getStudioRecords();
    const target = accounts.find((a) => a.id === accountId);
    if (!target) return false;

    this.acpService.disposeAccount(accountId);
    try {
      rmSync(resolve(target.geminiDir), { recursive: true, force: true });
    } catch {
      // ignora erro ao apagar pasta da conta
    }

    const next = accounts.filter((a) => a.id !== accountId);
    this.saveStudioRecords(next);
    if (next.length === 0) {
      this.db.connection.prepare(`DELETE FROM projecao_studio_config WHERE chave = 'antigravity_last_snapshot';`).run();
    }
    return true;
  }

  public removeExtraAccount(accountId: string): boolean {
    return this.removeAccount(accountId);
  }

  public requestSafeRemoveAccount(accountId: string, onFinalized?: () => void, timeoutMs?: number): SafeAccountRemovalResult {
    const { accounts, poolOverride } = this.getStudioRecords();
    const { contas, pool } = buildPoolSnapshotsForStudioRecords("gemini", accounts, poolOverride);
    const result = executeSafeAccountRemoval({
      provedor: "gemini",
      accountId,
      accounts: contas,
      pool,
      updatePoolAccountInUse: (nextId) => this.setPoolSettings({ conta_em_uso: nextId }),
      performPhysicalRemove: () => { this.removeAccount(accountId); },
      onFinalized: () => { this.snapshotCache = null; onFinalized?.(); },
      timeoutMs,
    });
    this.snapshotCache = null;
    return result;
  }


  public async executeCodeAssistGenerate(input: CodeAssistGenerateInput): Promise<CodeAssistGenerateOutput> {
    return await executeAntigravityCodeAssistGenerate(
      {
        workspaceCwd: this.workspaceCwd,
        fetchImpl: this.fetchImpl,
        acpService: this.acpService,
        getLiveSnapshot: (forceRefresh) => this.getLiveSnapshot(forceRefresh),
        discoverStudioTokenEntries: () => this.discoverStudioTokenEntries(),
        clearSnapshotCache: () => {
          this.snapshotCache = null;
        },
      },
      input
    );
  }

  public getLocalFallbackSnapshot(): AntigravityLiveSnapshot {
    const { accounts, poolOverride } = this.getStudioRecords();
    const { contas, pool } = buildPoolSnapshotsForStudioRecords("gemini", accounts, poolOverride);
    const cached = this.loadLastSnapshotCache();
    return {
      contas,
      pool,
      modelos: cached?.modelos ?? [],
      defaultModelId: cached?.defaultModelId ?? null,
      imageGenerationModelIds: cached?.imageGenerationModelIds ?? [],
      atualizado_em: new Date().toISOString(),
    };
  }

  public close(): void {
    this.acpService.closeAll();
  }
}
