import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

/**
 * No Windows o Antigravity CLI abre a página de login Google diretamente (Chrome/rundll32)
 * sem escrever o link em stdout/stderr. Este processo único em loop rápido (150ms) lê o
 * `CommandLine` do navegador disparado para capturar a URL OAuth em <200ms e enviá-la ao Cockpit,
 * abrindo a guia na janela visível do usuário (mesmo comportamento de Claude/ChatGPT).
 */
function watchGoogleSignInUrlOnWindows(onUrl: (url: string) => void, timeoutMs = 90_000): () => void {
  if (process.platform !== "win32") return () => {};
  const psScript = [
    `$deadline = [DateTime]::UtcNow.AddMilliseconds(${timeoutMs})`,
    "while ([DateTime]::UtcNow -lt $deadline) {",
    "  try {",
    "    $p = Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%accounts.google.com/o/oauth2%'\" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^powershell' } | Select-Object -First 1 -ExpandProperty CommandLine",
    "    if ($p) { Write-Output $p; break }",
    "  } catch {}",
    "  Start-Sleep -Milliseconds 150",
    "}",
  ].join("\n");

  const watcher = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
  );

  let found = false;
  watcher.stdout.on("data", (chunk) => {
    if (found) return;
    const match = chunk.toString("utf8").match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"']+/i);
    if (match?.[0]) {
      found = true;
      onUrl(match[0]);
      try {
        watcher.kill();
      } catch {
        // ignora
      }
    }
  });

  return () => {
    found = true;
    try {
      watcher.kill();
    } catch {
      // ignora
    }
  };
}

export interface AcpDiscoveredModel {
  modelId: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
}

export interface AcpAuthTokenSnapshot {
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiryIso: string | null;
}

export type McpServersResolver = (
  agentId?: string | null
) => Promise<unknown[]> | unknown[];

export interface AcpPromptExecutionInput {
  geminiDir: string;
  cwd: string;
  promptText: string;
  modelId?: string;
  imagePaths?: string[];
  timeoutMs?: number;
  agentId?: string | null;
  mcpServers?: unknown[];
  onDelta?: (chunk: string) => void;
}

export interface AcpPromptExecutionOutput {
  text: string;
  modelUsed: string;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface AcpConfigOption {
  id?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value?: string; name?: string }>;
}

interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: AcpConfigOption[];
  models?: {
    currentModelId?: string;
    availableModels?: Array<{
      modelId?: string;
      name?: string;
      description?: string;
    }>;
  };
}

function resolveAcpModelSelection(requestedId: string, candidateIds: string[]): string | null {
  if (candidateIds.includes(requestedId)) return requestedId;
  for (const suffix of ["-medium", "-high", "-low", "-xhigh"]) {
    const candidate = `${requestedId}${suffix}`;
    if (candidateIds.includes(candidate)) return candidate;
  }
  return candidateIds.find((c) => c.startsWith(`${requestedId}-`)) ?? null;
}

const DEFAULT_SIGN_IN_TIMEOUT_MS = 180_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 90_000;
const WORKER_IDLE_TTL_MS = 5 * 60_000;

function inferMimeFromImagePath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export function resolveAntigravityCliExecutable(appDataDir?: string): string | null {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return null;
  }

  const resolvedAppData = appDataDir ?? process.env.APPDATA ?? "";
  if (resolvedAppData) {
    const baseRuntime = join(resolvedAppData, "OpenBot", "provider-runtimes", "antigravity");
    try {
      if (existsSync(baseRuntime)) {
        const archDirs = readdirSync(baseRuntime);
        for (const arch of archDirs) {
          const versionsDir = join(baseRuntime, arch);
          try {
            const versions = readdirSync(versionsDir).sort().reverse();
            for (const ver of versions) {
              const exe = join(
                versionsDir,
                ver,
                "bin",
                process.platform === "win32" ? "antigravity.exe" : "antigravity"
              );
              if (existsSync(exe)) return exe;
            }
          } catch {
            // ignora diretório ilegível
          }
        }
      }
    } catch {
      // ignora erro de leitura
    }
  }

  const pathEntries = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const names = process.platform === "win32" ? ["antigravity.exe", "agy.exe", "agy.cmd"] : ["antigravity", "agy"];
  for (const dir of pathEntries) {
    if (!dir) continue;
    for (const n of names) {
      const candidate = join(dir, n);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

export function readAccountTokenFile(geminiDir: string): AcpAuthTokenSnapshot | null {
  const tokenPath = join(geminiDir, "antigravity-acp", "antigravity-oauth-token");
  if (!existsSync(tokenPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(tokenPath, "utf8")) as {
      token?: { access_token?: string; refresh_token?: string; expiry?: string };
      id_token_email?: string;
    };
    return {
      email: raw.id_token_email?.trim() || null,
      accessToken: raw.token?.access_token?.trim() || null,
      refreshToken: raw.token?.refresh_token?.trim() || null,
      expiryIso: raw.token?.expiry ?? null,
    };
  } catch {
    return null;
  }
}

function normalizeJsonRpcError(errObj: unknown): string {
  if (!errObj || typeof errObj !== "object") return "Erro desconhecido do servidor ACP.";
  const rec = errObj as { message?: unknown; data?: { details?: unknown } };
  if (typeof rec.data?.details === "string" && rec.data.details.trim()) {
    return rec.data.details.trim();
  }
  if (typeof rec.message === "string" && rec.message.trim()) {
    return rec.message.trim();
  }
  return "Falha no servidor Antigravity ACP.";
}

class AcpProcessConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRpc>();
  private nextId = 1;
  private closed = false;
  private initialized = false;
  private authenticated = false;
  private supportsImages = false;
  private onChunkListener: ((text: string) => void) | null = null;
  private onUsageListener: ((usedTokens: number) => void) | null = null;
  private stderrTail: string[] = [];
  private readonly executable: string;
  private readonly geminiDir: string;
  private readonly spawnArgsOverride?: string[];

  constructor(
    executable: string,
    geminiDir: string,
    spawnArgsOverrideOrOptions?:
      | string[]
      | {
          spawnArgsOverride?: string[];
          interactiveLogin?: boolean;
          onAuthUrl?: (url: string) => void;
        }
  ) {
    this.executable = executable;
    this.geminiDir = geminiDir;
    const opts = Array.isArray(spawnArgsOverrideOrOptions)
      ? { spawnArgsOverride: spawnArgsOverrideOrOptions }
      : (spawnArgsOverrideOrOptions ?? {});
    this.spawnArgsOverride = opts.spawnArgsOverride;
    const onAuthUrl = opts.onAuthUrl;
    const absGeminiDir = resolve(geminiDir);
    mkdirSync(join(absGeminiDir, "antigravity-acp"), { recursive: true });

    const args = this.spawnArgsOverride ?? [
      "acp",
      `--gemini-dir=${absGeminiDir}`,
      "--app-data-dir=antigravity-acp",
    ];

    this.child = spawn(this.executable, args, {
      cwd: absGeminiDir,
      env: {
        ...process.env,
        // Força o Antigravity CLI 1.5+ a armazenar `antigravity-oauth-token` isolado
        // dentro de `<geminiDir>/antigravity-acp/` sem ler/sobrescrever o Keychain global do SO.
        WSL_DISTRO_NAME: "CriativoStudio",
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: !opts.interactiveLogin,
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.handleStdoutLine(line));

    let authUrlEmitted = false;
    this.child.stderr.on("data", (chunk) => {
      const txt = chunk.toString("utf8").trim();
      if (txt) {
        this.stderrTail.push(txt.slice(-300));
        if (this.stderrTail.length > 6) this.stderrTail.shift();
        if (!authUrlEmitted && onAuthUrl) {
          const urlMatch = txt.match(/https:\/\/accounts\.google\.com\/[^\s<>"'`)\]]+/i);
          if (urlMatch?.[0]) {
            authUrlEmitted = true;
            onAuthUrl(urlMatch[0]);
          }
        }
      }
    });

    this.child.on("exit", (code) => {
      this.closed = true;
      const errMsg =
        this.stderrTail.length > 0
          ? `Processo Antigravity ACP encerrou (${code ?? "sinal"}): ${this.stderrTail[this.stderrTail.length - 1]}`
          : `Processo Antigravity ACP encerrou inesperadamente (código ${code ?? "null"}).`;
      for (const [id, wait] of this.pending.entries()) {
        clearTimeout(wait.timer);
        wait.reject(new Error(errMsg));
        this.pending.delete(id);
      }
      rl.close();
    });
  }

  public isAlive(): boolean {
    return !this.closed && !this.child.killed;
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (this.closed) {
      throw new Error("Conexão ACP já encerrada.");
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    // Requisição iniciada pelo servidor recebe recusa padrão para não travar aguardando interação
    if (typeof msg.method === "string" && msg.id !== undefined) {
      try {
        this.sendRaw({
          id: msg.id,
          error: { code: -32601, message: "Method not found" },
        });
      } catch {
        // ignora erro após fechamento
      }
      return;
    }

    // Notificações session/update
    if (msg.method === "session/update" && msg.params && typeof msg.params === "object") {
      const params = msg.params as {
        update?: {
          sessionUpdate?: string;
          content?: { type?: string; text?: string };
          used?: number;
        };
      };
      const upd = params.update;
      if (!upd) return;
      if (upd.sessionUpdate === "agent_message_chunk" && upd.content?.type === "text" && upd.content.text) {
        this.onChunkListener?.(upd.content.text);
      } else if (upd.sessionUpdate === "usage_update" && typeof upd.used === "number") {
        this.onUsageListener?.(upd.used);
      }
      return;
    }

    // Respostas JSON-RPC
    if (typeof msg.id === "number") {
      const wait = this.pending.get(msg.id);
      if (!wait) return;
      this.pending.delete(msg.id);
      clearTimeout(wait.timer);
      if (msg.error !== undefined) {
        wait.reject(new Error(normalizeJsonRpcError(msg.error)));
      } else {
        wait.resolve(msg.result);
      }
    }
  }

  public request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Processo ACP encerrado."));
    }
    const id = this.nextId++;
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s) aguardando resposta de '${method}'.`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        resolve: (res) => resolvePromise(res as T),
        reject: rejectPromise,
        timer,
      });

      try {
        this.sendRaw({ id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async ensureInitializedAndAuthenticated(authTimeoutMs = 30_000): Promise<void> {
    if (!this.initialized) {
      const initRes = await this.request<{
        agentCapabilities?: { promptCapabilities?: { image?: boolean } };
      }>(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "criativo-ai-studio", title: "Criativo AI Studio", version: "1.0.0" },
        },
        25_000
      );
      this.supportsImages = Boolean(initRes?.agentCapabilities?.promptCapabilities?.image);
      this.initialized = true;
    }

    if (!this.authenticated) {
      await this.request("authenticate", { methodId: "oauth-personal" }, authTimeoutMs);
      this.authenticated = true;
    }
  }

  public async discoverSessionModels(
    timeoutMs = 30_000,
    mcpServers?: unknown[]
  ): Promise<{
    models: AcpDiscoveredModel[];
    defaultModelId: string | null;
  }> {
    await this.ensureInitializedAndAuthenticated(timeoutMs);

    const resolvedMcpServers = Array.isArray(mcpServers) ? mcpServers : [];
    const sessionRes = await this.request<AcpSessionNewResult>(
      "session/new",
      {
        cwd: resolve(this.geminiDir),
        mcpServers: resolvedMcpServers,
        _meta: { antigravity: { disabledTools: ["schedule", "run_workflow"] } },
      },
      timeoutMs
    );

    const sessionId = sessionRes.sessionId;
    try {
      const modelOpt = Array.isArray(sessionRes.configOptions)
        ? sessionRes.configOptions.find((opt) => opt.id === "model" || opt.category === "model")
        : undefined;
      const defaultModelId =
        sessionRes.models?.currentModelId?.trim() || modelOpt?.currentValue?.trim() || null;

      const discovered: AcpDiscoveredModel[] = [];
      const seen = new Set<string>();

      for (const item of sessionRes.models?.availableModels ?? []) {
        const id = typeof item.modelId === "string" ? item.modelId.trim() : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        discovered.push({
          modelId: id,
          name: item.name?.trim() || id,
          description: item.description?.trim() ?? null,
          isDefault: defaultModelId === id,
        });
      }

      if (discovered.length === 0 && modelOpt?.options) {
        for (const opt of modelOpt.options) {
          const id = typeof opt.value === "string" ? opt.value.trim() : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          discovered.push({
            modelId: id,
            name: opt.name?.trim() || id,
            isDefault: defaultModelId === id,
          });
        }
      }

      return { models: discovered, defaultModelId };
    } finally {
      if (sessionId) {
        void this.request("session/close", { sessionId }, 3_000).catch(() => {});
      }
    }
  }

  public async runPrompt(input: {
    cwd: string;
    promptText: string;
    modelId?: string;
    imagePaths?: string[];
    timeoutMs: number;
    agentId?: string | null;
    mcpServers?: unknown[];
    onDelta?: (chunk: string) => void;
  }): Promise<AcpPromptExecutionOutput> {
    await this.ensureInitializedAndAuthenticated(30_000);

    const resolvedMcpServers = Array.isArray(input.mcpServers) ? input.mcpServers : [];
    const sessionRes = await this.request<AcpSessionNewResult>(
      "session/new",
      {
        cwd: input.cwd,
        mcpServers: resolvedMcpServers,
        _meta: { antigravity: { disabledTools: ["schedule", "run_workflow"] } },
      },
      30_000
    );

    const sessionId = sessionRes.sessionId;
    const modelOpt = Array.isArray(sessionRes.configOptions)
      ? sessionRes.configOptions.find((opt) => opt.id === "model" || opt.category === "model")
      : undefined;
    const candidateIds = [
      ...(sessionRes.models?.availableModels?.map((m) => m.modelId?.trim() ?? "").filter(Boolean) ?? []),
      ...(modelOpt?.options?.map((o) => o.value?.trim() ?? "").filter(Boolean) ?? []),
    ];

    let modelUsed =
      input.modelId ?? sessionRes.models?.currentModelId ?? modelOpt?.currentValue ?? "gemini-4-argon-medium";

    // Seleciona o modelo solicitado (ou variante correspondente ao prefixo) na sessão ACP
    if (input.modelId) {
      const resolvedId = resolveAcpModelSelection(input.modelId, candidateIds) ?? input.modelId;
      if (modelOpt?.id && modelOpt.options?.some((o) => o.value === resolvedId)) {
        try {
          await this.request(
            "session/set_config_option",
            { sessionId, configId: modelOpt.id, value: resolvedId },
            10_000
          );
          modelUsed = resolvedId;
        } catch {
          // fallback abaixo para session/set_model
        }
      } else if (sessionRes.models?.availableModels?.some((m) => m.modelId === resolvedId)) {
        try {
          await this.request("session/set_model", { sessionId, modelId: resolvedId }, 10_000);
          modelUsed = resolvedId;
        } catch {
          // Mantém modelo padrão caso servidor não aceite troca explícita
        }
      } else if (sessionRes.models?.currentModelId || modelOpt?.currentValue) {
        modelUsed = sessionRes.models?.currentModelId ?? modelOpt?.currentValue ?? modelUsed;
      }
    }

    const promptBlocks: Array<Record<string, unknown>> = [{ type: "text", text: input.promptText }];
    if (this.supportsImages && input.imagePaths && input.imagePaths.length > 0) {
      for (const imgPath of input.imagePaths.slice(0, 3)) {
        try {
          if (existsSync(imgPath)) {
            promptBlocks.push({
              type: "image",
              mimeType: inferMimeFromImagePath(imgPath),
              data: readFileSync(imgPath).toString("base64"),
            });
          }
        } catch {
          // ignora anexo ilegível
        }
      }
    }

    const chunks: string[] = [];
    let reportedUsedTokens = 0;

    this.onChunkListener = (txt) => {
      chunks.push(txt);
      input.onDelta?.(txt);
    };
    this.onUsageListener = (used) => {
      reportedUsedTokens = Math.max(reportedUsedTokens, used);
    };

    try {
      await this.request(
        "session/prompt",
        {
          sessionId,
          prompt: promptBlocks,
        },
        input.timeoutMs
      );
    } finally {
      this.onChunkListener = null;
      this.onUsageListener = null;
      // Encerra sessão sem bloquear
      void this.request("session/close", { sessionId }, 3_000).catch(() => {});
    }

    const finalText = chunks.join("").trim();
    const estInput = Math.max(1, Math.round(input.promptText.length / 4));
    const estOutput = Math.max(1, Math.round(finalText.length / 4));
    const uncachedInput = reportedUsedTokens > estOutput ? reportedUsedTokens - estOutput : estInput;

    return {
      text: finalText,
      modelUsed,
      usage: {
        uncachedInput,
        cachedInput: 0,
        output: estOutput,
      },
    };
  }

  public dispose(): void {
    this.closed = true;
    for (const [id, wait] of this.pending.entries()) {
      clearTimeout(wait.timer);
      wait.reject(new Error("Sessão ACP encerrada."));
      this.pending.delete(id);
    }
    try {
      this.child.stdin.end();
      this.child.kill();
    } catch {
      // ignora erro ao matar processo já finalizado
    }
  }
}

/**
 * Pool persistente de conexões ACP por conta Google isolada em `dados/contas/gemini/<id>`.
 * Permite autenticação Google abrindo o navegador do usuário e execução rápida de prompts sem travar stdin.
 */
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
    const exe = this.getCliExecutable();
    if (!exe) {
      throw new Error(
        "Motor Antigravity CLI não encontrado na máquina para abrir o login Google no navegador."
      );
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
    const exe = this.getCliExecutable();
    if (!exe) {
      throw new Error("Motor Antigravity CLI não instalado para executar via ACP.");
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
        imagePaths: input.imagePaths,
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
