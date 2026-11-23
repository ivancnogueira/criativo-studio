import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";
import {
  createInterface,
} from "node:readline";
import { type AcpDiscoveredModel, type LabeledImageInput, formatLabeledImageInstruction, type AcpPromptExecutionOutput, type PendingRpc, type AcpSessionNewResult, resolveAcpModelSelection, inferMimeFromImagePath, normalizeJsonRpcError } from "./antigravity-acp-helpers.ts";

export class AcpProcessConnection {
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
      "--include-default-customizations=false",
      "--disable-telemetry",
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

    this.child.stdin.on("error", () => {
      this.closed = true;
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

    // Requisição iniciada pelo servidor: auto-aprova chamadas de ferramentas MCP autorizadas
    if (typeof msg.method === "string" && msg.id !== undefined) {
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
          this.sendRaw({
            id: msg.id,
            result: { outcome: { outcome: "selected", optionId } },
          });
        } else {
          this.sendRaw({
            id: msg.id,
            error: { code: -32601, message: "Method not found" },
          });
        }
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
          clientInfo: { name: "criativo-ai-studio", title: "CriativoOS", version: "1.0.0" },
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
        _meta: {
          antigravity: {
            disabledTools: [
              "schedule",
              "run_workflow",
              "swarm",
              "search_marketplace",
              "invoke_subagent",
              "define_subagent",
              "manage_subagents",
              "list_plugin_accounts",
              "manage_task",
            ],
          },
        },
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
    effort?: string;
    imagePaths?: string[];
    labeledImages?: LabeledImageInput[];
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
        _meta: {
          antigravity: {
            disabledTools: [
              "schedule",
              "run_workflow",
              "swarm",
              "search_marketplace",
              "invoke_subagent",
              "define_subagent",
              "manage_subagents",
              "list_plugin_accounts",
              "manage_task",
            ],
          },
        },
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
      const resolvedId = resolveAcpModelSelection(input.modelId, candidateIds, input.effort) ?? input.modelId;
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
    const labeledList =
      this.supportsImages && input.labeledImages && input.labeledImages.length > 0
        ? input.labeledImages.slice(0, 5)
        : this.supportsImages && input.imagePaths && input.imagePaths.length > 0
          ? input.imagePaths.slice(0, 3).map((p) => ({ path: p, role: "anexo_usuario" as const, label: p }))
          : [];
    if (labeledList.length > 0) {
      for (const item of labeledList) {
        try {
          if (existsSync(item.path)) {
            if (input.labeledImages && input.labeledImages.length > 0) {
              promptBlocks.push({
                type: "text",
                text: formatLabeledImageInstruction(item),
              });
            }
            promptBlocks.push({
              type: "image",
              mimeType: inferMimeFromImagePath(item.path),
              data: readFileSync(item.path).toString("base64"),
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
