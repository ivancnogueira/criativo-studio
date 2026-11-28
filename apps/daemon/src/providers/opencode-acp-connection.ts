import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnProviderProcess } from "./provider-runtime-resolver.ts";
import { ACP_MAX_MESSAGE_BYTES, NdjsonBufferedLineReader } from "./acp-stream-framing.ts";
import { acpSessionCache, runWithAcpSessionCache } from "./acp-session-cache.ts";
import { createAcpStreamPresentation, createTurnStallWatchdog, detectAcpBackgroundTaskOutput, getLastMcpActivityAt, hasActiveMcpToolForAgent, type AcpToolStepEvent } from "./turn-stall-watchdog.ts";

export const OPENCODE_SESSION_NEW_TIMEOUT_MS = 60_000;

interface PendingRpc {
  method: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
  touchActivity?: () => void;
  cleanup?: () => void;
}

interface OpenCodeConfigOption {
  id?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value?: string; name?: string }>;
}

export class OpenCodeAcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: NdjsonBufferedLineReader;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly openToolCalls = new Set<string>();
  private readonly deferredCloseTimers = new Set<NodeJS.Timeout>();
  private readonly streamPresentation = createAcpStreamPresentation();
  private detectedBackgroundTaskInTurn = false;
  private nextId = 1;
  private closed = false;
  private initialized = false;
  private stderrTail: string[] = [];
  private onChunk: ((txt: string) => void) | null = null;
  private onUsage: ((used: number) => void) | null = null;

  constructor(
    executable: string,
    cwd: string,
    extraEnv: Record<string, string | undefined>,
    options?: { maxMessageBytes?: number },
  ) {
    this.child = spawnProviderProcess(executable, ["acp"], {
      cwd,
      env: {
        ...process.env,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.child.stdin.on("error", () => {
      this.closed = true;
    });

    this.child.stderr.on("data", (chunk) => {
      for (const wait of this.pending.values()) {
        wait.touchActivity?.();
      }
      const txt = chunk.toString("utf8").trim();
      if (!txt) return;
      this.stderrTail.push(txt.slice(-260));
      if (this.stderrTail.length > 6) this.stderrTail.shift();
    });

    this.stdoutReader = new NdjsonBufferedLineReader({
      stream: this.child.stdout,
      maxMessageBytes: options?.maxMessageBytes ?? ACP_MAX_MESSAGE_BYTES,
      onOversizedLine: (info) => {
        const err = new Error(
          `Payload ACP excedeu o limite seguro de 256 MB (${Math.round(info.byteLength / 1024)} KB) e foi descartado sem afetar outras sessões.`,
        );
        const target =
          Array.from(this.pending.entries()).find(([, w]) => w.method === "session/prompt") ??
          Array.from(this.pending.entries())[0];
        if (!target) return;
        const [id, wait] = target;
        this.pending.delete(id);
        if (wait.timer) clearTimeout(wait.timer);
        wait.cleanup?.();
        wait.reject(err);
      },
      onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      if (typeof msg.method === "string" && msg.id !== undefined) {
        for (const wait of this.pending.values()) {
          wait.touchActivity?.();
        }
        try {
          if (msg.method === "session/request_permission") {
            const rawOptions = (
              msg.params as { options?: Array<{ optionId?: string; kind?: string }> } | undefined
            )?.options;
            const options = Array.isArray(rawOptions) ? rawOptions : [];
            const chosen =
              options.find((o) => o.kind === "allow_always" || o.optionId === "allow_always") ??
              options.find((o) => o.kind === "allow_once" || o.optionId === "allow_once") ??
              options.find((o) => !String(o.kind ?? "").toLowerCase().includes("reject"));
            const optionId = chosen?.optionId || "allow";
            this.send({
              id: msg.id,
              result: { outcome: { outcome: "selected", optionId } },
            });
          } else {
            this.send({ id: msg.id, error: { code: -32601, message: "Method not found" } });
          }
        } catch {
          // ignora
        }
        return;
      }

      if (msg.method === "session/update" && msg.params && typeof msg.params === "object") {
        const upd = (msg.params as {
          update?: {
            sessionUpdate?: string;
            toolCallId?: string;
            status?: string;
            title?: unknown;
            name?: unknown;
            kind?: unknown;
            rawOutput?: unknown;
            content?: { type?: string; text?: string };
            used?: number;
          };
        }).update;
        if (!upd) return;
        if (upd.sessionUpdate === "tool_call" && typeof upd.toolCallId === "string" && upd.toolCallId) {
          this.openToolCalls.add(upd.toolCallId);
        } else if (upd.sessionUpdate === "tool_call_update" && typeof upd.toolCallId === "string" && upd.toolCallId) {
          const st = String(upd.status ?? "").toLowerCase();
          if (st === "completed" || st === "failed" || st === "cancelled" || st === "error") {
            this.openToolCalls.delete(upd.toolCallId);
            if (detectAcpBackgroundTaskOutput(upd.rawOutput)) {
              this.detectedBackgroundTaskInTurn = true;
            }
          } else {
            this.openToolCalls.add(upd.toolCallId);
          }
        }
        for (const wait of this.pending.values()) {
          wait.touchActivity?.();
        }
        if (upd.sessionUpdate === "usage_update" && typeof upd.used === "number") {
          this.onUsage?.(upd.used);
        } else {
          this.streamPresentation.handleUpdate(upd, this.onChunk);
        }
        return;
      }

      if (typeof msg.id === "number") {
        const wait = this.pending.get(msg.id);
        if (!wait) return;
        this.pending.delete(msg.id);
        if (wait.timer) clearTimeout(wait.timer);
        wait.cleanup?.();
        if (msg.error !== undefined) {
          const rec = msg.error as { message?: string; data?: { details?: string } };
          wait.reject(new Error(rec.data?.details || rec.message || "Falha no servidor OpenCode ACP."));
        } else {
          wait.resolve(msg.result);
        }
      }
      },
    });

    this.child.on("exit", (code) => {
      this.closed = true;
      this.openToolCalls.clear();
      this.streamPresentation.reset(null);
      const errDetail = this.stderrTail.length > 0 ? this.stderrTail[this.stderrTail.length - 1] : "";
      const errMessage = errDetail
        ? `Servidor OpenCode ACP encerrou (código ${code ?? "null"}): ${errDetail}`
        : `Servidor OpenCode ACP encerrou (código ${code ?? "null"}).`;
      for (const [id, wait] of this.pending.entries()) {
        if (wait.timer) clearTimeout(wait.timer);
        wait.cleanup?.();
        wait.reject(new Error(errMessage));
        this.pending.delete(id);
      }
      this.stdoutReader.dispose();
    });
  }

  public isAlive(): boolean {
    return !this.closed && !this.child.killed;
  }

  private send(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
  }

  private request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    options?: {
      signal?: AbortSignal;
      resetOnActivity?: boolean;
      agentId?: string | null;
      onAbortSendCancelSessionId?: string;
    }
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Conexão OpenCode ACP fechada."));
    if (options?.signal?.aborted) {
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      return Promise.reject(abortErr);
    }
    const id = this.nextId++;
    return new Promise<T>((resolvePromise, rejectPromise) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let watchdog: ReturnType<typeof createTurnStallWatchdog> | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        watchdog?.stop();
        if (options?.signal && onSignalAbort) {
          options.signal.removeEventListener("abort", onSignalAbort);
        }
      };

      const failTimeout = (silentSeconds: number) => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
        cleanup();
        if (options?.onAbortSendCancelSessionId && !this.closed) {
          try {
            this.send({
              method: "session/cancel",
              params: { sessionId: options.onAbortSendCancelSessionId },
            });
          } catch {
            // ignora
          }
        }
        const suffix = options?.resetOnActivity ? " de silêncio" : "";
        rejectPromise(new Error(`Timeout (${silentSeconds}s${suffix}) em OpenCode '${method}'.`));
      };

      if (options?.resetOnActivity) {
        watchdog = createTurnStallWatchdog({
          stallMs: timeoutMs,
          toolStallMs: null,
          isToolRunning: () => this.openToolCalls.size > 0 || hasActiveMcpToolForAgent(options.agentId),
          getExternalActivityAt: () => getLastMcpActivityAt(options.agentId),
          onStall: () => failTimeout(Math.round(timeoutMs / 1000)),
        });
      } else {
        timer = setTimeout(() => failTimeout(Math.round(timeoutMs / 1000)), timeoutMs);
        timer.unref?.();
      }

      const onSignalAbort = () => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
        cleanup();
        if (options?.onAbortSendCancelSessionId && !this.closed) {
          try {
            this.send({
              method: "session/cancel",
              params: { sessionId: options.onAbortSendCancelSessionId },
            });
          } catch {
            // ignora
          }
        }
        const abortErr = new Error("Turno interrompido.");
        abortErr.name = "AbortError";
        rejectPromise(abortErr);
      };

      if (options?.signal) {
        options.signal.addEventListener("abort", onSignalAbort, { once: true });
      }

      this.pending.set(id, {
        method,
        resolve: (res) => {
          if (settled) return;
          settled = true;
          resolvePromise(res as T);
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          rejectPromise(err);
        },
        timer,
        cleanup,
        ...(watchdog
          ? {
              touchActivity: () => {
                if (!settled) watchdog?.touch();
              },
            }
          : {}),
      });

      try {
        this.send({ id, method, params });
      } catch (err) {
        settled = true;
        cleanup();
        this.pending.delete(id);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async runPrompt(input: {
    cwd: string;
    promptText: string;
    incrementalPromptText?: string;
    reuseKey?: string;
    configFingerprint?: string;
    modelId: string;
    timeoutMs: number;
    signal?: AbortSignal;
    agentId?: string | null;
    mcpServers?: unknown[];
    onDelta?: (chunk: string) => void;
    onToolStep?: (step: AcpToolStepEvent) => void;
  }): Promise<{
    text: string;
    modelUsed: string;
    usage: { uncachedInput: number; cachedInput: number; output: number };
  }> {
    if (!this.initialized) {
      await this.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "criativo-ai-studio", title: "CriativoOS", version: "1.0.0" },
        },
        20_000,
        { signal: input.signal }
      );
      this.initialized = true;
    }

    const resolvedMcpServers = Array.isArray(input.mcpServers) ? input.mcpServers : [];
    const closeSession = (sid: string) => {
      if (!this.closed) {
        void this.request("session/close", { sessionId: sid }, 3_000).catch(() => {});
      }
    };

    return await runWithAcpSessionCache({
      provider: "opencode",
      reuseKey: input.reuseKey,
      connectionRef: this,
      configFingerprint: input.configFingerprint,
      modelId: input.modelId,
      hasDeferredClose: () => Boolean(!input.reuseKey && this.detectedBackgroundTaskInTurn && !this.closed),
      createSession: async () => {
        const sess = await this.request<{ sessionId: string; configOptions?: OpenCodeConfigOption[] }>(
          "session/new",
          { cwd: input.cwd, mcpServers: resolvedMcpServers },
          OPENCODE_SESSION_NEW_TIMEOUT_MS,
          { signal: input.signal }
        );
        let modelUsed = input.modelId;
        if (Array.isArray(sess.configOptions)) {
          const modelOpt = sess.configOptions.find((o) => o.id === "model" || o.category === "model");
          if (modelOpt?.id) {
            try {
              await this.request(
                "session/set_config_option",
                { sessionId: sess.sessionId, configId: modelOpt.id, value: input.modelId },
                10_000,
                { signal: input.signal }
              );
            } catch {
              if (modelOpt.currentValue) modelUsed = modelOpt.currentValue;
            }
          }
        }
        return { sessionId: sess.sessionId, modelUsed };
      },
      closeSession,
      executePrompt: async ({ sessionId, modelUsed, reused }) => {
        const effectivePromptText =
          reused && input.incrementalPromptText !== undefined
            ? input.incrementalPromptText
            : input.promptText;
        const chunks: string[] = [];
        let reportedUsed = 0;
        this.onChunk = (txt) => {
          chunks.push(txt);
          input.onDelta?.(txt);
        };
        this.onUsage = (u) => {
          reportedUsed = Math.max(reportedUsed, u);
        };

        this.openToolCalls.clear();
        this.detectedBackgroundTaskInTurn = false;
        this.streamPresentation.reset(input.onToolStep);
        try {
          await this.request(
            "session/prompt",
            { sessionId, prompt: [{ type: "text", text: effectivePromptText }] },
            input.timeoutMs,
            {
              signal: input.signal,
              resetOnActivity: true,
              agentId: input.agentId,
              onAbortSendCancelSessionId: sessionId,
            }
          );
        } finally {
          this.openToolCalls.clear();
          this.streamPresentation.reset(null);
          this.onChunk = null;
          this.onUsage = null;
          if (!input.reuseKey && this.detectedBackgroundTaskInTurn && !this.closed) {
            const holdTimer = setTimeout(() => {
              this.deferredCloseTimers.delete(holdTimer);
              closeSession(sessionId);
            }, 5 * 60_000);
            holdTimer.unref?.();
            this.deferredCloseTimers.add(holdTimer);
          }
          this.detectedBackgroundTaskInTurn = false;
        }

        const finalText = chunks.join("").trim();
        const estOut = Math.max(1, Math.round(finalText.length / 4));
        const estIn = Math.max(1, Math.round(effectivePromptText.length / 4));
        return {
          text: finalText,
          modelUsed,
          usage: {
            uncachedInput: reportedUsed > estOut ? reportedUsed - estOut : estIn,
            cachedInput: 0,
            output: estOut,
          },
        };
      },
    });
  }

  public dispose(): void {
    this.closed = true;
    acpSessionCache.invalidateByConnection(this);
    this.openToolCalls.clear();
    for (const timer of this.deferredCloseTimers) {
      clearTimeout(timer);
    }
    this.deferredCloseTimers.clear();
    this.streamPresentation.reset(null);
    for (const [id, wait] of this.pending.entries()) {
      if (wait.timer) clearTimeout(wait.timer);
      wait.cleanup?.();
      wait.reject(new Error("OpenCode ACP encerrado."));
      this.pending.delete(id);
    }
    try {
      this.child.stdin.end();
      this.child.kill();
    } catch {
      // ignora
    }
  }
}
