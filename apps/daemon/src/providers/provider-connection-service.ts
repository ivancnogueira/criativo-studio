import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ContaProvedorInfo,
  ModeloProvedorInfo,
  OnboardingEstado,
  PoolContasConfig,
  ProvedorStatusInfo,
  ProviderName,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { AntigravityLiveService } from "./antigravity-live-service.ts";
import { CliOAuthAccountsService, resolveCliBinaryForProvider } from "./cli-oauth-accounts-service.ts";
import { OpenCodeLiveService } from "./opencode-live-service.ts";
import { buildUsageWindowsFromGroups } from "./provider-quota-utils.ts";

interface ProviderCatalogMeta {
  provedor: ProviderName;
  rotulo: string;
  subtitulo: string;
  cliBins: string[];
  managedRuntimeFolder?: string;
  vaultKeys: string[];
  fallbackModelos: ModeloProvedorInfo[];
}

export const PROVIDER_CATALOG: readonly ProviderCatalogMeta[] = [
  {
    provedor: "gemini",
    rotulo: "Gemini",
    subtitulo: "Conta Google OAuth (Antigravity & Nano Banana) ou Gemini API Key",
    cliBins: ["antigravity", "agy", "gemini"],
    managedRuntimeFolder: "antigravity",
    vaultKeys: ["gemini_api_key", "google_api_key"],
    fallbackModelos: [
      { id: "gemini-3.8-flash-high", rotulo: "Gemini 3.8 Flash", padrao: true, suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gemini-2.5-pro", rotulo: "Gemini 2.5 Pro", suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gemini-3.1-flash-image", rotulo: "Gemini 3.1 Flash Image (Nano Banana)", suporta_imagem: true },
    ],
  },
  {
    provedor: "claude",
    rotulo: "Claude",
    subtitulo: "Conta Claude.ai no navegador ou Anthropic API Key",
    cliBins: ["claude"],
    managedRuntimeFolder: "claude",
    vaultKeys: ["anthropic_api_key", "claude_api_key"],
    fallbackModelos: [
      { id: "claude-sonnet-4-6", rotulo: "Claude Sonnet 4.6", padrao: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "claude-opus-4-6", rotulo: "Claude Opus 4.6", esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "claude-3-7-sonnet-latest", rotulo: "Claude 3.7 Sonnet", esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "claude-3-5-haiku-latest", rotulo: "Claude 3.5 Haiku", esforcos_suportados: ["baixo", "medio"] },
    ],
  },
  {
    provedor: "openai",
    rotulo: "ChatGPT",
    subtitulo: "Conta ChatGPT/Codex no navegador ou OpenAI API Key",
    cliBins: ["codex", "openai"],
    managedRuntimeFolder: "codex",
    vaultKeys: ["openai_api_key"],
    fallbackModelos: [
      { id: "gpt-5.4", rotulo: "GPT-5.4 (Codex)", padrao: true, suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gpt-4o", rotulo: "GPT-4o", suporta_imagem: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "o3-mini", rotulo: "o3-mini (Raciocínio)", esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "gpt-image-1", rotulo: "GPT Image 2.5", suporta_imagem: true },
    ],
  },
  {
    provedor: "opencode",
    rotulo: "OpenCode",
    subtitulo: "Modelos gratuitos ativos neste computador (API Key opcional)",
    cliBins: ["opencode"],
    managedRuntimeFolder: "opencode",
    vaultKeys: ["opencode_api_key"],
    fallbackModelos: [
      { id: "opencode/glm-5.3-flash-free", rotulo: "OpenCode / GLM 5.3 Flash Free", padrao: true, gratuito: true, esforcos_suportados: ["medio", "alto"] },
      { id: "opencode/deepseek-v4.1-flash-free", rotulo: "OpenCode / DeepSeek V4.1 Flash Free", gratuito: true, esforcos_suportados: ["medio", "alto"] },
      { id: "opencode/beam-free", rotulo: "OpenCode / Beam Free", gratuito: true, esforcos_suportados: ["medio", "alto"] },
    ],
  },
  {
    provedor: "grok",
    rotulo: "Grok",
    subtitulo: "xAI API Key cifrada no Cofre",
    cliBins: ["grok"],
    managedRuntimeFolder: "grok",
    vaultKeys: ["xai_api_key", "grok_api_key"],
    fallbackModelos: [
      { id: "grok-4.7", rotulo: "Grok 4.7", padrao: true, esforcos_suportados: ["baixo", "medio", "alto"] },
      { id: "grok-4.6", rotulo: "Grok 4.6", esforcos_suportados: ["baixo", "medio"] },
      { id: "grok-code-fast-1", rotulo: "Grok Code Fast 1" },
    ],
  },
  {
    provedor: "ollama",
    rotulo: "Ollama (Local)",
    subtitulo: "Servidor Ollama offline em http://127.0.0.1:11434",
    cliBins: ["ollama"],
    vaultKeys: [],
    fallbackModelos: [
      { id: "ollama/qwen2.5:14b", rotulo: "Qwen 2.5 14B (Local)", padrao: true, gratuito: true },
      { id: "ollama/llama3.2:latest", rotulo: "Llama 3.2 (Local)", gratuito: true },
      { id: "ollama/gemma3:12b", rotulo: "Gemma 3 12B (Local)", gratuito: true },
    ],
  },
];

const DEFAULT_ONBOARDING: OnboardingEstado = {
  onboarding_concluido: false,
  modo_provedor_inicial: null,
  provedor_selecionado: null,
  telemetria_anonima: false,
  marca_nome: "[NOME_DA_MARCA]",
  perfil_handle: "[@SEU_PERFIL]",
  runtime_versao: "v2.3.0",
  atualizado_em: new Date().toISOString(),
};

function runShortCommand(command: string, args: string[], timeoutMs = 900): Promise<string | null> {
  return new Promise((resolvePromise) => {
    try {
      execFile(
        command,
        args,
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolvePromise(null);
            return;
          }
          resolvePromise(stdout.trim() || "ok");
        }
      );
    } catch {
      resolvePromise(null);
    }
  });
}

function findManagedRuntimeExecutable(
  appDataDir: string,
  providerFolder: string,
  exeName: string
): { executable: string; version: string } | null {
  try {
    const platArch =
      process.platform === "win32" ? "win32-x64" : process.platform === "darwin" ? "darwin-arm64" : "linux-x64";
    const base = join(appDataDir, "OpenBot", "provider-runtimes", providerFolder, platArch);
    if (!existsSync(base)) return null;
    const versions = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));

    for (const ver of versions) {
      const candidate = join(base, ver, "bin", exeName);
      if (existsSync(candidate)) {
        return { executable: candidate, version: ver };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function detectLocalBinary(
  bins: string[],
  managedFolder?: string
): Promise<{ found: boolean; version: string | null; executable: string | null }> {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { found: false, version: null, executable: null };
  }

  const appDataDir = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const isWin = process.platform === "win32";

  if (managedFolder) {
    const exeName = isWin ? `${managedFolder}.exe` : managedFolder;
    const managed = findManagedRuntimeExecutable(appDataDir, managedFolder, exeName);
    if (managed) {
      return {
        found: true,
        version: managed.version,
        executable: managed.executable,
      };
    }
  }

  const locator = isWin ? "where.exe" : "which";
  for (const bin of bins) {
    const pathFound = await runShortCommand(locator, [bin], 600);
    if (pathFound) {
      const firstPath = pathFound.split(/\r?\n/)[0].trim();
      const ver = await runShortCommand(firstPath, ["--version"], 800);
      return {
        found: true,
        version: ver ? ver.split(/\r?\n/)[0].slice(0, 48) : "CLI ativo",
        executable: firstPath,
      };
    }
  }

  if (isWin) {
    const extra: string[] = [];
    for (const bin of bins) {
      if (bin === "agy") extra.push(join(localAppData, "agy", "bin", "agy.exe"));
      if (bin === "codex") extra.push(join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
      if (bin === "claude") extra.push(join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
      if (bin === "opencode") {
        extra.push(join(homedir(), ".opencode", "bin", "opencode.exe"));
        extra.push(join(appDataDir, "npm", "opencode.cmd"));
      }
    }
    for (const candidate of extra) {
      if (existsSync(candidate)) {
        const ver = await runShortCommand(candidate, ["--version"], 800);
        return {
          found: true,
          version: ver ? ver.split(/\r?\n/)[0].slice(0, 48) : "CLI ativo",
          executable: candidate,
        };
      }
    }
  }

  return { found: false, version: null, executable: null };
}

async function detectOllamaModels(): Promise<{ up: boolean; models: ModeloProvedorInfo[] }> {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { up: false, models: [] };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) return { up: false, models: [] };
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const list: ModeloProvedorInfo[] = (body.models ?? [])
      .filter((m) => typeof m.name === "string" && m.name.length > 0)
      .map((m, idx) => ({
        id: m.name!.startsWith("ollama/") ? m.name! : `ollama/${m.name!}`,
        rotulo: `${m.name!} (Ollama Local)`,
        padrao: idx === 0,
        gratuito: true,
        descoberto_em_conta: true,
      }));
    return { up: true, models: list };
  } catch {
    return { up: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

export class ProviderConnectionService {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;
  private readonly antigravityLive: AntigravityLiveService;
  private readonly cliOAuth: CliOAuthAccountsService;
  private readonly opencodeLive: OpenCodeLiveService;
  private cliCache: {
    expiresAt: number;
    data: Record<ProviderName, { found: boolean; version: string | null; executable: string | null }>;
  } | null = null;

  constructor(options: {
    db: CriativoDatabase;
    vault: VaultService;
    workspaceRoot?: string;
    antigravityLive?: AntigravityLiveService;
    cliOAuth?: CliOAuthAccountsService;
    opencodeLive?: OpenCodeLiveService;
  }) {
    this.db = options.db;
    this.vault = options.vault;
    const baseWorkspace = resolve(options.workspaceRoot ?? process.cwd());
    const daemonDadosContas = join(baseWorkspace, "apps", "daemon", "dados", "contas");
    const daemonDadosDir = join(baseWorkspace, "apps", "daemon", "dados");
    const accountsRoot = existsSync(daemonDadosContas) || existsSync(daemonDadosDir)
      ? daemonDadosContas
      : join(baseWorkspace, "dados", "contas");

    this.antigravityLive =
      options.antigravityLive ??
      new AntigravityLiveService({
        db: this.db,
        workspaceCwd: baseWorkspace,
        accountsRootDir: join(accountsRoot, "gemini"),
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
      });
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

  public async getProvidersStatus(forceProbe = false): Promise<ProvedorStatusInfo[]> {
    if (forceProbe) {
      this.cliCache = null;
    }

    const [
      cliData,
      agSnapshot,
      ollamaCheck,
      opencodeCatalog,
      claudeDynamicModels,
      openaiDynamicModels,
      claudeAccounts,
      openaiAccounts,
    ] = await Promise.all([
      this.getCliProbeCache(),
      this.antigravityLive.getLiveSnapshot(forceProbe),
      detectOllamaModels(),
      this.opencodeLive.getLiveCatalog(forceProbe),
      this.cliOAuth.listDynamicModels("claude", forceProbe).catch(() => []),
      this.cliOAuth.listDynamicModels("openai", forceProbe).catch(() => []),
      this.cliOAuth.listAccountsWithQuotas("claude", forceProbe).catch(() => this.cliOAuth.listAccounts("claude")),
      this.cliOAuth.listAccountsWithQuotas("openai", forceProbe).catch(() => this.cliOAuth.listAccounts("openai")),
    ]);

    const secretSet = new Set(this.vault.listSecretsMetadata().map((item) => item.chave_nome));
    const connectedFlags = this.getStudioConfig<Record<string, boolean>>("provedores_conectados", {});
    const hiddenModelsMap = this.getStudioConfig<Record<string, string[]>>("modelos_ocultos_por_provedor", {});
    const agentsByProvider = this.getAgentsByProvider();

    return PROVIDER_CATALOG.map((meta) => {
      const cli = cliData[meta.provedor] ?? { found: false, version: null, executable: null };
      const vaultConfigured = meta.vaultKeys.some((k) => secretSet.has(k));
      const assinaturaManual = Boolean(connectedFlags[meta.provedor]);

      let contas: ContaProvedorInfo[] = [];
      let pool: PoolContasConfig | null = null;
      let modelos: ModeloProvedorInfo[] = meta.fallbackModelos;

      if (meta.provedor === "gemini") {
        contas = agSnapshot.contas;
        pool = agSnapshot.pool;
        if (agSnapshot.modelos.length > 0) {
          modelos = agSnapshot.modelos;
        }
      } else if (meta.provedor === "claude") {
        contas = claudeAccounts;
        pool = this.cliOAuth.getPoolConfig("claude");
        if (claudeDynamicModels.length > 0) {
          modelos = claudeDynamicModels;
        }
      } else if (meta.provedor === "openai") {
        contas = openaiAccounts;
        pool = this.cliOAuth.getPoolConfig("openai");
        if (openaiDynamicModels.length > 0) {
          modelos = openaiDynamicModels;
        }
      } else if (meta.provedor === "opencode") {
        if (opencodeCatalog.modelos.length > 0) {
          modelos = opencodeCatalog.modelos;
        }
      } else if (meta.provedor === "ollama") {
        if (ollamaCheck.models.length > 0) {
          modelos = ollamaCheck.models;
        }
      }

      const hiddenSet = new Set(hiddenModelsMap[meta.provedor] ?? []);
      const decoratedModelos = modelos.map((m) => ({
        ...m,
        oculto: hiddenSet.has(m.id),
      }));

      const hasValidAccount = contas.some((c) => c.estado === "conectado" || c.token_valido);
      let modo: ProvedorStatusInfo["modo_conexao"] = "nenhum";

      if (meta.provedor === "opencode") {
        if (vaultConfigured) modo = "api_key";
        else if (opencodeCatalog.detected && opencodeCatalog.modelos.length > 0) modo = "cli";
      } else if (meta.provedor === "ollama") {
        if (ollamaCheck.up) modo = "local";
      } else {
        if (hasValidAccount) modo = "assinatura";
        else if (vaultConfigured) modo = "api_key";
      }

      return {
        provedor: meta.provedor,
        rotulo: meta.rotulo,
        subtitulo: meta.subtitulo,
        conectado: modo !== "nenhum",
        cli_detectado:
          meta.provedor === "opencode" ? opencodeCatalog.detected : cli.found,
        cli_versao:
          meta.provedor === "opencode" ? opencodeCatalog.version : cli.version,
        cli_executavel:
          meta.provedor === "opencode" ? opencodeCatalog.executable : cli.executable,
        vault_configurado: vaultConfigured,
        modo_conexao: modo,
        modelos: decoratedModelos,
        contas,
        pool,
        usado_por_agentes: agentsByProvider[meta.provedor] ?? [],
        reporta_cota: contas.some((c) => (c.grupos_cota?.length ?? 0) > 0),
      };
    });
  }

  public async connectProvider(
    provedor: ProviderName,
    options?:
      | string
      | {
          apiKey?: string;
          modo?: "cli" | "api_key" | "local" | "assinatura";
        }
  ): Promise<ProvedorStatusInfo> {
    const meta = PROVIDER_CATALOG.find((item) => item.provedor === provedor);
    if (!meta) {
      throw new Error(`Provedor desconhecido: ${provedor}`);
    }

    const opts = typeof options === "string" ? { apiKey: options } : (options ?? {});
    const cleanKey = typeof opts.apiKey === "string" ? opts.apiKey.trim() : "";

    if (cleanKey.length > 0 && meta.vaultKeys[0]) {
      this.vault.setSecret(meta.vaultKeys[0], cleanKey);
    }

    if (cleanKey.length > 0 || opts.modo) {
      const connectedFlags = this.getStudioConfig<Record<string, boolean>>("provedores_conectados", {});
      connectedFlags[provedor] = true;
      this.setStudioConfig("provedores_conectados", connectedFlags);
    }

    const list = await this.getProvidersStatus(false);
    return list.find((item) => item.provedor === provedor)!;
  }

  public async connectProviderViaBrowser(
    provedor: "gemini" | "claude" | "openai",
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<{ conta: ContaProvedorInfo; provedores: ProvedorStatusInfo[] }> {
    const conta =
      provedor === "gemini"
        ? await this.antigravityLive.connectGoogleViaBrowser(label, onAuthUrl)
        : await this.cliOAuth.connectViaBrowser(provedor, label, onAuthUrl);

    const provedores = await this.getProvidersStatus(true);
    return { conta, provedores };
  }

  public cancelBrowserSignIn(provedor: "gemini" | "claude" | "openai"): boolean {
    if (provedor === "gemini") {
      return this.antigravityLive.cancelPendingSignIn();
    }
    return this.cliOAuth.cancelPendingSignIn(provedor);
  }

  public async setHiddenModels(
    provedor: ProviderName,
    hiddenModelIds: string[]
  ): Promise<ProvedorStatusInfo[]> {
    const cleanIds = Array.from(
      new Set(hiddenModelIds.map((id) => id.trim()).filter((id) => id.length > 0))
    );
    const current = this.getStudioConfig<Record<string, string[]>>("modelos_ocultos_por_provedor", {});
    current[provedor] = cleanIds;
    this.setStudioConfig("modelos_ocultos_por_provedor", current);
    return this.getProvidersStatus(false);
  }

  public async disconnectProvider(provedor: ProviderName): Promise<ProvedorStatusInfo> {
    const meta = PROVIDER_CATALOG.find((item) => item.provedor === provedor);
    if (!meta) {
      throw new Error(`Provedor desconhecido: ${provedor}`);
    }

    for (const keyName of meta.vaultKeys) {
      this.db.connection.prepare(`DELETE FROM cofre_segredos WHERE chave_nome = ?;`).run(keyName);
    }

    if (provedor === "gemini") {
      const agSnap = await this.antigravityLive.getLiveSnapshot(false);
      for (const acc of agSnap.contas) {
        this.antigravityLive.removeAccount(acc.id);
      }
    } else if (provedor === "claude" || provedor === "openai") {
      for (const acc of this.cliOAuth.listAccounts(provedor)) {
        this.cliOAuth.removeAccount(provedor, acc.id);
      }
    }

    const connectedFlags = this.getStudioConfig<Record<string, boolean>>("provedores_conectados", {});
    connectedFlags[provedor] = false;
    this.setStudioConfig("provedores_conectados", connectedFlags);

    const list = await this.getProvidersStatus(true);
    return list.find((item) => item.provedor === provedor)!;
  }

  public async getUsageSnapshot(forceRefresh = false): Promise<UsoProvedoresSnapshot> {
    const [statuses, agSnapshot] = await Promise.all([
      this.getProvidersStatus(forceRefresh),
      this.antigravityLive.getLiveSnapshot(forceRefresh),
    ]);

    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rowUso = this.db.connection
      .prepare(
        `SELECT COUNT(*) as turnos,
                COALESCE(SUM(uncached_input + cached_input + output_tokens), 0) as tokens
         FROM projecao_uso_registros
         WHERE occurred_at >= ?;`
      )
      .get(cutoffIso) as { turnos: number; tokens: number };

    const rowEv = this.db.connection
      .prepare(`SELECT COUNT(*) as total FROM eventos_orquestracao WHERE ocorrido_em >= ?;`)
      .get(cutoffIso) as { total: number };

    const execucoes24h = Number(rowUso?.turnos ?? 0) || Number(rowEv?.total ?? 0);
    const totalTokens = Number(rowUso?.tokens ?? 0);

    const provedoresList: UsoProvedoresSnapshot["provedores"] = [];
    const allContas: ContaProvedorInfo[] = [...agSnapshot.contas];

    // Adiciona contas Google conectadas no Studio com suas cotas reais
    for (const conta of agSnapshot.contas) {
      provedoresList.push({
        provedor: "gemini",
        rotulo: conta.email ? `Gemini - ${conta.email}` : conta.rotulo ?? `Gemini (${conta.id})`,
        conectado: conta.estado === "conectado" || Boolean(conta.token_valido),
        email: conta.email,
        janelas: buildUsageWindowsFromGroups(conta.grupos_cota, false),
        grupos: conta.grupos_cota,
      });
    }

    // Inclui contas OAuth de Claude/ChatGPT (com cotas reais 5h/Semanal) e outros provedores ativos
    for (const st of statuses) {
      if (st.provedor === "gemini" && agSnapshot.contas.length > 0) continue;
      if ((st.provedor === "claude" || st.provedor === "openai") && st.contas && st.contas.length > 0) {
        allContas.push(...st.contas);
        for (const acc of st.contas) {
          provedoresList.push({
            provedor: st.provedor,
            rotulo: acc.email ? `${st.rotulo} - ${acc.email}` : st.rotulo,
            conectado: true,
            email: acc.email,
            janelas: buildUsageWindowsFromGroups(acc.grupos_cota ?? [], true),
            grupos: acc.grupos_cota,
          });
        }
        continue;
      }
      if (!st.conectado && allContas.length > 0) continue;
      provedoresList.push({
        provedor: st.provedor,
        rotulo: st.rotulo,
        conectado: st.conectado,
        email: null,
        janelas: [],
        grupos: [],
      });
    }

    return {
      total_execucoes_24h: execucoes24h,
      total_tokens_estimados: totalTokens,
      contas: allContas,
      provedores: provedoresList,
      atualizado_em: new Date().toISOString(),
    };
  }

  public close(): void {
    this.antigravityLive.close();
    this.opencodeLive.close();
  }
}
