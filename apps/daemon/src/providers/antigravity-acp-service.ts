import {
  resolve,
} from "node:path";
import { watchGoogleSignInUrlOnWindows, type AcpDiscoveredModel, type AcpAuthTokenSnapshot, type McpServersResolver, type AcpPromptExecutionInput, type AcpPromptExecutionOutput, DEFAULT_SIGN_IN_TIMEOUT_MS, DEFAULT_PROMPT_TIMEOUT_MS, WORKER_IDLE_TTL_MS, resolveAntigravityCliExecutable, readAccountTokenFile } from "./antigravity-acp-helpers.ts";
import { AcpProcessConnection } from "./antigravity-acp-connection.ts";
import { ensureProviderRuntimeInstalled } from "./provider-runtime-resolver.ts";

export * from "./antigravity-acp-helpers.ts";

export class AntigravityAcpService {
  private readonly workers = new Map<
    string,
    { conn: AcpProcessConnection; idleTimer: NodeJS.Timeout | null; queue: Promise<unknown>; activeCount: number }
  >();
  private readonly executableOverride?: string;
  private readonly spawnArgsFactory?: (geminiDir: string) => string[];
  private mcpServersResolver?: McpServersResolver;

  constructor(options?: {
    appDataDir?: string;
    executableOverride?: string;
    spawnArgsFactory?: (geminiDir: string) => string[];
    mcpServersResolver?: McpServersResolver;
  }) {
    this.appDataDir = options?.appDataDir;
    this.executableOverride = options?.executableOverride;
    this.spawnArgsFactory = options?.spawnArgsFactory;
    this.mcpServersResolver = options?.mcpServersResolver;
  }

  public setMcpServersResolver(resolver?: McpServersResolver): void {
    this.mcpServersResolver = resolver;
  }

  private async resolveMcpServers(
    agentId?: string | null,
    explicitServers?: unknown[]
  ): Promise<unknown[]> {
    if (Array.isArray(explicitServers)) {
      return explicitServers;
    }
    if (!this.mcpServersResolver) {
      return [];
    }
    const resolved = await this.mcpServersResolver(agentId);
    return Array.isArray(resolved) ? resolved : [];
  }

  private readonly appDataDir?: string;
  private pendingSignInDispose: (() => void) | null = null;

  public getCliExecutable(): string | null {
    return this.executableOverride ?? resolveAntigravityCliExecutable(this.appDataDir);
  }

  public async ensureCliExecutable(): Promise<{
    executable: string | null;
    installedNow: boolean;
    error?: string;
  }> {
    const existing = this.getCliExecutable();
    if (existing) {
      return { executable: existing, installedNow: false };
    }
    if (this.executableOverride) {
      return { executable: null, installedNow: false };
    }
    const installed = await ensureProviderRuntimeInstalled("antigravity", {
      appDataDir: this.appDataDir,
    });
    return {
      executable: installed.executable,
      installedNow: installed.installedNow,
      ...(installed.error ? { error: installed.error } : {}),
    };
  }

  public cancelPendingSignIn(): boolean {
    if (!this.pendingSignInDispose) return false;
    const fn = this.pendingSignInDispose;
    this.pendingSignInDispose = null;
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inicia o fluxo oficial de login Google via `antigravity acp` + `authenticate(oauth-personal)`,
   * abrindo o navegador do usuário para login e salvando o token dentro da pasta isolada `geminiDir`.
   */
  public async signInWithGoogleBrowser(options: {
    geminiDir: string;
    timeoutMs?: number;
    onAuthUrl?: (url: string) => void;
  }): Promise<AcpAuthTokenSnapshot> {
    let exe = this.getCliExecutable();
    if (!exe) {
      const ensured = await this.ensureCliExecutable();
      exe = ensured.executable;
      if (!exe) {
        const extraReason = ensured.error ? ` (${ensured.error})` : "";
        throw new Error(
          `Motor Antigravity CLI não encontrado na máquina e não pôde ser instalado automaticamente para abrir o login Google no navegador${extraReason}.`
        );
      }
    }

    let urlEmitted = false;
    const emitUrlOnce = (url: string) => {
      if (urlEmitted) return;
      urlEmitted = true;
      options.onAuthUrl?.(url);
    };

    const absDir = resolve(options.geminiDir);
    const conn = new AcpProcessConnection(exe, absDir, {
      spawnArgsOverride: this.spawnArgsFactory ? this.spawnArgsFactory(absDir) : undefined,
      interactiveLogin: true,
      onAuthUrl: emitUrlOnce,
    });

    let canceled = false;
    this.pendingSignInDispose = () => {
      canceled = true;
      conn.dispose();
    };

    const stopWatcher = options.onAuthUrl ? watchGoogleSignInUrlOnWindows(emitUrlOnce) : () => {};

    try {
      await conn.ensureInitializedAndAuthenticated(options.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS);
      const tokenSnap = readAccountTokenFile(absDir);
      if (!tokenSnap || (!tokenSnap.accessToken && !tokenSnap.refreshToken)) {
        throw new Error(
          "Login Google concluído, porém o token OAuth não foi gravado na pasta isolada da conta."
        );
      }
      return tokenSnap;
    } catch (err) {
      if (canceled) {
        throw new Error("Login Google cancelado pelo usuário.");
      }
      throw err;
    } finally {
      stopWatcher();
      this.pendingSignInDispose = null;
      conn.dispose();
    }
  }

  private async withAccountWorker<T>(
    accountKey: string,
    geminiDir: string,
    fn: (conn: AcpProcessConnection) => Promise<T>
  ): Promise<T> {
    let exe = this.getCliExecutable();
    if (!exe) {
      const ensured = await this.ensureCliExecutable();
      exe = ensured.executable;
      if (!exe) {
        const extraReason = ensured.error ? ` (${ensured.error})` : "";
        throw new Error(
          `Motor Antigravity CLI não instalado para executar via ACP${extraReason}.`
        );
      }
    }

    let slot = this.workers.get(accountKey);
    if (!slot || !slot.conn.isAlive()) {
      if (slot?.idleTimer) clearTimeout(slot.idleTimer);
      slot = {
        conn: new AcpProcessConnection(
          exe,
          resolve(geminiDir),
          this.spawnArgsFactory ? this.spawnArgsFactory(resolve(geminiDir)) : undefined
        ),
        idleTimer: null,
        queue: Promise.resolve(),
        activeCount: 0,
      };
      this.workers.set(accountKey, slot);
    }

    if (slot.idleTimer) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }

    const currentSlot = slot;
    currentSlot.activeCount += 1;
    const run = currentSlot.queue.then(() => fn(currentSlot.conn));
    currentSlot.queue = run.catch(() => {});

    try {
      return await run;
    } finally {
      currentSlot.activeCount = Math.max(0, currentSlot.activeCount - 1);
      if (currentSlot.activeCount === 0) {
        currentSlot.idleTimer = setTimeout(() => {
          currentSlot.conn.dispose();
          if (this.workers.get(accountKey) === currentSlot) {
            this.workers.delete(accountKey);
          }
        }, WORKER_IDLE_TTL_MS);
        currentSlot.idleTimer.unref?.();
      }
    }
  }

  public async refreshAccountToken(accountKey: string, geminiDir: string): Promise<AcpAuthTokenSnapshot | null> {
    return this.withAccountWorker(accountKey, geminiDir, async (conn) => {
      await conn.ensureInitializedAndAuthenticated(30_000);
      return readAccountTokenFile(resolve(geminiDir));
    });
  }

  public async listAvailableModels(
    accountKey: string,
    geminiDir: string,
    agentId?: string | null
  ): Promise<{ models: AcpDiscoveredModel[]; defaultModelId: string | null }> {
    const resolvedMcpServers = await this.resolveMcpServers(agentId);
    return this.withAccountWorker(accountKey, geminiDir, (conn) =>
      conn.discoverSessionModels(30_000, resolvedMcpServers)
    );
  }

  public async executePrompt(
    accountKey: string,
    input: AcpPromptExecutionInput
  ): Promise<AcpPromptExecutionOutput> {
    const resolvedMcpServers = await this.resolveMcpServers(input.agentId, input.mcpServers);
    return this.withAccountWorker(accountKey, input.geminiDir, (conn) =>
      conn.runPrompt({
        cwd: input.cwd,
        promptText: input.promptText,
        modelId: input.modelId,
        effort: input.effort,
        imagePaths: input.imagePaths,
        labeledImages: input.labeledImages,
        timeoutMs: input.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
        agentId: input.agentId,
        mcpServers: resolvedMcpServers,
        onDelta: input.onDelta,
      })
    );
  }

  public disposeAccount(accountKey: string): void {
    const slot = this.workers.get(accountKey);
    if (!slot) return;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.conn.dispose();
    this.workers.delete(accountKey);
  }

  public closeAll(): void {
    for (const [key, slot] of this.workers.entries()) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.conn.dispose();
      this.workers.delete(key);
    }
  }
}

