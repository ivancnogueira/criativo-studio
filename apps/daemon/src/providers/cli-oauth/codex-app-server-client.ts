import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { NdjsonBufferedLineReader } from "../acp-stream-framing.ts";
import { spawnProviderProcess } from "../provider-runtime-locate.ts";
import {
  buildCodexThreadStartParams,
  isCodexToolItemType,
} from "./codex-prompt-settings.ts";
import {
  createTurnStallWatchdog,
  DEFAULT_CLI_TOOL_STALL_MS,
  DEFAULT_CLI_TURN_STALL_MS,
  getLastMcpActivityAt,
  hasActiveMcpToolForAgent,
  type TurnStallWatchdogHandle,
} from "../turn-stall-watchdog.ts";

const DEFAULT_IDLE_TTL_MS = 5 * 60_000;
const RPC_REQUEST_TIMEOUT_MS = 30_000;

export class CodexAppServerUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAppServerUnsupportedError";
  }
}

export interface CodexAppServerTurnInput {
  executable: string;
  cwd: string;
  codexHome: string;
  accountId: string;
  modelId: string;
  agenteId?: string | null;
  threadId?: string | null;
  turnMode?: "light" | "action";
  effort?: string | null;
  systemPrompt?: string;
  coldPrompt: string;
  incrementalPrompt: string;
  overrideArgs: string[];
  configFingerprint: string;
  timeoutMs?: number;
  idleTtlMs?: number;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
  onToolStep?: (step: {
    id: string;
    toolName: string;
    title: string;
    status: "executando" | "concluido" | "erro";
    duracaoMs?: number;
  }) => void;
}

export interface CodexAppServerTurnResult {
  text: string;
  codexThreadId: string;
  reusedThread: boolean;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}

interface PendingRpcRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveTurnState {
  codexThreadId: string;
  accumulatedDeltaText: string;
  fallbackCompletedText: string;
  openToolIds: Set<string>;
  toolStartedAt: Map<string, number>;
  usage: { uncachedInput: number; cachedInput: number; output: number };
  onDelta?: (chunk: string) => void;
  onToolStep?: CodexAppServerTurnInput["onToolStep"];
  watchdog: TurnStallWatchdogHandle;
  resolve: (res: CodexAppServerTurnResult) => void;
  reject: (err: Error) => void;
  settled: boolean;
}

interface ThreadBinding {
  codexThreadId: string;
  workerKey: string;
  fingerprint: string;
  accountId: string;
  bindingKey: string;
}

function isUnsupportedAppServerError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("unknown subcommand") ||
    lower.includes("unrecognized subcommand") ||
    lower.includes("invalid subcommand") ||
    (lower.includes("unexpected argument") && lower.includes("listen")) ||
    (lower.includes("app-server") && lower.includes("not supported"))
  );
}

function isThreadNotFoundError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("thread not found") ||
    lower.includes("unknown thread") ||
    lower.includes("no such thread") ||
    lower.includes("invalid thread")
  );
}

function extractTextFromDeltaOrItem(obj: Record<string, unknown>): string {
  if (typeof obj.delta === "string") return obj.delta;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.textDelta === "string") return obj.textDelta;
  if (Array.isArray(obj.content)) {
    return obj.content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? String((part as { text: string }).text)
        : ""))
      .join("");
  }
  return "";
}

function parseUsageObject(raw: unknown): { uncachedInput: number; cachedInput: number; output: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const nested = (u.total && typeof u.total === "object" ? (u.total as Record<string, unknown>) : u);
  const rawIn = Number(nested.input_tokens ?? nested.inputTokens ?? 0);
  const cached = Number(nested.cached_input_tokens ?? nested.cachedInputTokens ?? 0);
  const out = Number(nested.output_tokens ?? nested.outputTokens ?? 0);
  if (!Number.isFinite(rawIn) && !Number.isFinite(out)) return null;
  const uncached = Math.max(0, (Number.isFinite(rawIn) ? rawIn : 0) - (Number.isFinite(cached) ? cached : 0));
  return {
    uncachedInput: uncached,
    cachedInput: Number.isFinite(cached) ? cached : 0,
    output: Number.isFinite(out) ? out : 0,
  };
}

class CodexAppServerWorker {
  public readonly workerKey: string;
  public readonly accountId: string;
  public readonly executable: string;
  public readonly pid: number | undefined;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly reader: NdjsonBufferedLineReader;
  private readonly pendingRequests = new Map<number, PendingRpcRequest>();
  private readonly activeTurns = new Map<string, ActiveTurnState>();
  private readonly idleTtlMs: number;
  private readonly onDispose: () => void;

  private nextId = 1;
  private stderrTail = "";
  private closed = false;
  private initializedReady = false;
  private initPromise: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    opts: {
      workerKey: string;
      accountId: string;
      executable: string;
      cwd: string;
      codexHome: string;
      overrideArgs: string[];
      idleTtlMs?: number;
    },
    onDispose: () => void
  ) {
    this.workerKey = opts.workerKey;
    this.accountId = opts.accountId;
    this.executable = opts.executable;
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.onDispose = onDispose;

    this.child = spawnProviderProcess(
      opts.executable,
      ["app-server", "--listen", "stdio://", ...opts.overrideArgs],
      {
        cwd: opts.cwd,
        env: { ...process.env, CODEX_HOME: opts.codexHome },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    this.pid = this.child.pid;
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4096);
    });

    this.reader = new NdjsonBufferedLineReader({
      stream: this.child.stdout,
      onLine: (line) => this.handleLine(line),
    });

    this.child.on("error", (err) => {
      this.terminateAll(
        isUnsupportedAppServerError(err.message)
          ? new CodexAppServerUnsupportedError(err.message)
          : err
      );
    });

    this.child.on("close", (code) => {
      const detail = this.stderrTail.trim();
      if (!this.initializedReady && (isUnsupportedAppServerError(detail) || (code !== null && code !== 0))) {
        this.terminateAll(
          new CodexAppServerUnsupportedError(
            detail || `codex app-server encerrou antes do handshake (código ${code ?? "null"}).`
          )
        );
        return;
      }
      this.terminateAll(new Error(detail || `codex app-server encerrou (código ${code ?? "null"}).`));
    });
  }

  public isAlive(): boolean {
    return !this.closed && this.child.exitCode === null && !this.child.killed;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initializedReady) return;
    if (this.initPromise) return await this.initPromise;

    this.initPromise = (async () => {
      await this.sendRequest("initialize", {
        clientInfo: {
          name: "criativo-studio",
          version: process.env.CRIATIVO_APP_VERSION || "1.1.3",
        },
        capabilities: {},
      }, 15_000);
      this.sendNotification("initialized", {});
      this.initializedReady = true;
      this.scheduleIdleShutdown();
    })();

    return await this.initPromise;
  }

  public async sendRequest<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = RPC_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (!this.isAlive()) {
      throw new Error("Worker codex app-server não está ativo.");
    }
    this.clearIdleTimer();
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.scheduleIdleShutdown();
        reject(new Error(`Timeout aguardando RPC '${method}' do Codex app-server.`));
      }, timeoutMs);
      timer.unref?.();

      this.pendingRequests.set(id, {
        method,
        resolve: (val) => {
          this.scheduleIdleShutdown();
          resolve(val as T);
        },
        reject: (err) => {
          this.scheduleIdleShutdown();
          reject(err);
        },
        timer,
      });

      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async runTurn(opts: {
    codexThreadId: string;
    reusedThread: boolean;
    promptText: string;
    effort?: string | null;
    agenteId?: string | null;
    timeoutMs?: number;
    signal?: AbortSignal;
    onDelta?: (chunk: string) => void;
    onToolStep?: CodexAppServerTurnInput["onToolStep"];
  }): Promise<CodexAppServerTurnResult> {
    if (opts.signal?.aborted) {
      const err = new Error("Turno interrompido.");
      err.name = "AbortError";
      throw err;
    }
    this.clearIdleTimer();

    return await new Promise<CodexAppServerTurnResult>((resolve, reject) => {
      const openToolIds = new Set<string>();
      const toolStartedAt = new Map<string, number>();

      const settleTurn = (fn: () => void) => {
        if (state.settled) return;
        state.settled = true;
        opts.signal?.removeEventListener("abort", onAbort);
        state.watchdog.stop();
        this.activeTurns.delete(opts.codexThreadId);
        this.scheduleIdleShutdown();
        fn();
      };

      const watchdog = createTurnStallWatchdog({
        stallMs: opts.timeoutMs ?? DEFAULT_CLI_TURN_STALL_MS,
        toolStallMs: DEFAULT_CLI_TOOL_STALL_MS,
        isToolRunning: () =>
          openToolIds.size > 0 || (opts.agenteId ? hasActiveMcpToolForAgent(opts.agenteId) : false),
        getExternalActivityAt: () => (opts.agenteId ? getLastMcpActivityAt(opts.agenteId) : 0),
        onStall: ({ silentMs }) => {
          void this.sendRequest("turn/interrupt", { threadId: opts.codexThreadId }, 5_000).catch(() => {});
          settleTurn(() => reject(new Error(`Codex app-server sem atividade há ${Math.round(silentMs / 1000)}s.`)));
        },
      });

      const onAbort = () => {
        void this.sendRequest("turn/interrupt", { threadId: opts.codexThreadId }, 5_000).catch(() => {});
        const abortErr = new Error("Turno interrompido.");
        abortErr.name = "AbortError";
        settleTurn(() => reject(abortErr));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      const state: ActiveTurnState = {
        codexThreadId: opts.codexThreadId,
        accumulatedDeltaText: "",
        fallbackCompletedText: "",
        openToolIds,
        toolStartedAt,
        usage: {
          uncachedInput: Math.round(opts.promptText.length / 4),
          cachedInput: 0,
          output: 0,
        },
        onDelta: opts.onDelta,
        onToolStep: opts.onToolStep,
        watchdog,
        resolve: (res) => settleTurn(() => resolve(res)),
        reject: (err) => settleTurn(() => reject(err)),
        settled: false,
      };
      (state as ActiveTurnState & { reusedThread?: boolean }).reusedThread = opts.reusedThread;

      this.activeTurns.set(opts.codexThreadId, state);

      this.sendRequest("turn/start", {
        threadId: opts.codexThreadId,
        input: [{ type: "text", text: opts.promptText }],
        ...(opts.effort ? { effort: opts.effort } : {}),
      })
        .then(() => {
          watchdog.touch();
        })
        .catch((err) => {
          settleTurn(() => reject(err instanceof Error ? err : new Error(String(err))));
        });
    });
  }

  public dispose(): void {
    this.terminateAll(new Error("Worker codex app-server encerrado."));
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.isAlive()) return;
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    } catch {
      // ignora erro ao escrever notificação
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    if (this.closed || this.activeTurns.size > 0 || this.pendingRequests.size > 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.activeTurns.size === 0 && this.pendingRequests.size === 0) {
        this.dispose();
      }
    }, Math.max(50, this.idleTtlMs));
    this.idleTimer.unref?.();
  }

  private handleLine(rawLine: string): void {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof msg.id === "number" && !msg.method) {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error && typeof msg.error === "object") {
        const errMsg = String((msg.error as { message?: unknown }).message ?? `Erro RPC ${pending.method}`);
        pending.reject(
          !this.initializedReady && isUnsupportedAppServerError(errMsg)
            ? new CodexAppServerUnsupportedError(errMsg)
            : new Error(errMsg)
        );
      } else {
        pending.resolve(msg.result ?? {});
      }
      return;
    }

    if (typeof msg.method !== "string") return;
    const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    const turn = threadId ? this.activeTurns.get(threadId) : Array.from(this.activeTurns.values())[0];
    if (!turn || turn.settled) return;

    turn.watchdog.touch();

    if (msg.method === "item/agentMessage/delta" || msg.method === "item/delta") {
      const chunk = extractTextFromDeltaOrItem(params);
      if (chunk) {
        turn.accumulatedDeltaText += chunk;
        turn.onDelta?.(chunk);
      }
      return;
    }

    if (msg.method === "item/started" || msg.method === "item/completed") {
      const item = (params.item && typeof params.item === "object" ? params.item : null) as Record<string, unknown> | null;
      if (!item) return;
      const itemType = String(item.type ?? "");
      const itemId = String(item.id ?? `item-${Date.now()}`);
      if (itemType === "agentMessage" || itemType === "agent_message") {
        if (msg.method === "item/completed") {
          const text = extractTextFromDeltaOrItem(item);
          if (text) turn.fallbackCompletedText = text;
        }
        return;
      }

      if (!isCodexToolItemType(itemType)) {
        return;
      }

      const toolName = String(item.tool ?? item.name ?? itemType ?? "tool");
      if (msg.method === "item/started") {
        turn.openToolIds.add(itemId);
        turn.toolStartedAt.set(itemId, Date.now());
        turn.onToolStep?.({
          id: itemId,
          toolName,
          title: `Executando ${toolName}`,
          status: "executando",
        });
      } else {
        turn.openToolIds.delete(itemId);
        const started = turn.toolStartedAt.get(itemId);
        turn.toolStartedAt.delete(itemId);
        const failed = item.status === "failed" || item.status === "error";
        turn.onToolStep?.({
          id: itemId,
          toolName,
          title: `${toolName} ${failed ? "falhou" : "concluído"}`,
          status: failed ? "erro" : "concluido",
          duracaoMs: started ? Date.now() - started : undefined,
        });
      }
      return;
    }

    if (msg.method === "thread/tokenUsage/updated") {
      const parsed = parseUsageObject(params.tokenUsage ?? params.token_usage ?? params.usage);
      if (parsed) turn.usage = parsed;
      return;
    }

    if (msg.method === "turn/completed") {
      const turnObj = (params.turn && typeof params.turn === "object" ? params.turn : {}) as Record<string, unknown>;
      const parsed = parseUsageObject(turnObj.usage ?? params.usage);
      if (parsed) turn.usage = parsed;

      if (turnObj.status === "failed") {
        const errObj = turnObj.error as { message?: unknown } | undefined;
        turn.reject(new Error(String(errObj?.message ?? "Turno Codex app-server falhou.")));
        return;
      }

      const finalText = (turn.accumulatedDeltaText || turn.fallbackCompletedText).trim();
      const reusedThread = Boolean((turn as ActiveTurnState & { reusedThread?: boolean }).reusedThread);
      turn.resolve({
        text: finalText,
        codexThreadId: turn.codexThreadId,
        reusedThread,
        usage: {
          ...turn.usage,
          output: turn.usage.output || Math.round(finalText.length / 4),
        },
      });
      return;
    }

    if (msg.method === "error") {
      const message = String(params.message ?? "Erro no protocolo Codex app-server.");
      turn.reject(new Error(message));
    }
  }

  private terminateAll(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    this.reader.dispose();
    this.onDispose();

    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(err);
      this.pendingRequests.delete(id);
    }
    for (const turn of this.activeTurns.values()) {
      turn.reject(err);
    }
    this.activeTurns.clear();

    try {
      this.child.stdin.end();
    } catch {
      // ignora
    }
    if (this.child.exitCode === null && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        // ignora
      }
    }
  }
}

export class CodexAppServerPool {
  private readonly workers = new Map<string, CodexAppServerWorker>();
  private readonly threadBindings = new Map<string, ThreadBinding>();

  private buildBindingKey(accountId: string, agenteId?: string | null, threadId?: string | null): string {
    return `${agenteId?.trim() || "default"}::${threadId?.trim() || "main"}::${accountId}`;
  }

  private async getOrCreateWorker(input: CodexAppServerTurnInput): Promise<CodexAppServerWorker> {
    const workerKey = `${input.accountId}::${input.configFingerprint}`;
    const existing = this.workers.get(workerKey);
    if (existing && existing.isAlive() && existing.executable === input.executable) {
      await existing.ensureInitialized();
      return existing;
    }
    if (existing) {
      existing.dispose();
      this.workers.delete(workerKey);
    }

    const worker = new CodexAppServerWorker(
      {
        workerKey,
        accountId: input.accountId,
        executable: input.executable,
        cwd: input.cwd,
        codexHome: input.codexHome,
        overrideArgs: input.overrideArgs,
        idleTtlMs: input.idleTtlMs,
      },
      () => {
        if (this.workers.get(workerKey) === worker) {
          this.workers.delete(workerKey);
        }
        for (const [k, b] of this.threadBindings.entries()) {
          if (b.workerKey === workerKey) {
            this.threadBindings.delete(k);
          }
        }
      }
    );
    this.workers.set(workerKey, worker);
    await worker.ensureInitialized();
    return worker;
  }

  public async executeTurn(input: CodexAppServerTurnInput): Promise<CodexAppServerTurnResult> {
    const worker = await this.getOrCreateWorker(input);
    const bindingKey = this.buildBindingKey(input.accountId, input.agenteId, input.threadId);
    const cached = this.threadBindings.get(bindingKey);

    if (cached && cached.workerKey === worker.workerKey && cached.fingerprint === input.configFingerprint) {
      try {
        return await worker.runTurn({
          codexThreadId: cached.codexThreadId,
          reusedThread: true,
          promptText: input.incrementalPrompt,
          effort: input.turnMode === "light" ? (input.effort ?? "low") : input.effort,
          agenteId: input.agenteId,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
          onDelta: input.onDelta,
          onToolStep: input.onToolStep,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isThreadNotFoundError(msg)) throw err;
        this.threadBindings.delete(bindingKey);
      }
    } else if (cached) {
      this.threadBindings.delete(bindingKey);
    }

    const richThreadParams = buildCodexThreadStartParams({
      modelId: input.modelId,
      cwd: input.cwd,
      systemPrompt: input.systemPrompt,
      turnMode: input.turnMode,
      effort: input.effort,
    });
    let startRes: { thread?: { id?: string }; threadId?: string };
    try {
      startRes = await worker.sendRequest("thread/start", richThreadParams);
    } catch (startErr) {
      const msg = startErr instanceof Error ? startErr.message : String(startErr);
      if (!/unknown field|unrecognized|invalid.*(config|param|field)/i.test(msg)) {
        throw startErr;
      }
      startRes = await worker.sendRequest("thread/start", {
        model: input.modelId,
        cwd: input.cwd,
        sandbox: "read-only",
        approvalPolicy: "never",
        ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
      });
    }
    const codexThreadId = startRes.thread?.id ?? startRes.threadId;
    if (!codexThreadId) {
      throw new Error("Codex app-server retornou thread/start sem threadId.");
    }

    this.threadBindings.set(bindingKey, {
      codexThreadId,
      workerKey: worker.workerKey,
      fingerprint: input.configFingerprint,
      accountId: input.accountId,
      bindingKey,
    });

    return await worker.runTurn({
      codexThreadId,
      reusedThread: false,
      promptText: input.coldPrompt,
      effort: input.turnMode === "light" ? (input.effort ?? "low") : input.effort,
      agenteId: input.agenteId,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      onDelta: input.onDelta,
      onToolStep: input.onToolStep,
    });
  }

  public async compactThread(input: {
    accountId?: string | null;
    agenteId?: string | null;
    threadId?: string | null;
  }): Promise<boolean> {
    const prefix = `${input.agenteId?.trim() || "default"}::${input.threadId?.trim() || "main"}::`;
    const candidates = Array.from(this.threadBindings.values()).filter((b) =>
      input.accountId ? b.bindingKey === `${prefix}${input.accountId}` : b.bindingKey.startsWith(prefix)
    );
    let compacted = false;
    for (const binding of candidates) {
      const worker = this.workers.get(binding.workerKey);
      if (worker && worker.isAlive()) {
        try {
          await worker.sendRequest("thread/compact/start", { threadId: binding.codexThreadId }, 15_000);
          compacted = true;
        } catch {
          // ignora erro se o app-server não suportar thread/compact/start
        }
      }
      this.threadBindings.delete(binding.bindingKey);
    }
    return compacted;
  }

  public invalidateAgentThread(agenteId?: string | null, threadId?: string | null): number {
    const cleanAgent = agenteId?.trim() || "default";
    const cleanThread = threadId?.trim();
    let count = 0;
    for (const [k, b] of this.threadBindings.entries()) {
      const parts = k.split("::");
      if (parts[0] !== cleanAgent) continue;
      if (cleanThread && parts[1] !== cleanThread) continue;
      this.threadBindings.delete(k);
      count += 1;
    }
    return count;
  }

  public getActiveWorkerPid(accountId: string, configFingerprint: string): number | undefined {
    return this.workers.get(`${accountId}::${configFingerprint}`)?.pid;
  }

  public disposeAll(): void {
    for (const worker of this.workers.values()) {
      worker.dispose();
    }
    this.workers.clear();
    this.threadBindings.clear();
  }
}

export const codexAppServerPool = new CodexAppServerPool();
