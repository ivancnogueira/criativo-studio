import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { ModeloProvedorInfo } from "@criativo/contracts";
import type { VaultService } from "../vault/vault-service.ts";

const execFileAsync = promisify(execFile);
const MODELS_CACHE_TTL_MS = 120_000;
const EXEC_TIMEOUT_MS = 90_000;

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface OpenCodeConfigOption {
  id?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value?: string; name?: string }>;
}

function formatOpenCodeModelLabel(rawId: string): string {
  const withoutPrefix = rawId.startsWith("opencode/") ? rawId.slice("opencode/".length) : rawId;
  const titled = withoutPrefix
    .split("-")
    .map((part) => {
      const up = part.toUpperCase();
      if (up === "GLM" || up === "GPT" || up === "VL") return up;
      if (/^v\d/i.test(part)) return up;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
  return `OpenCode / ${titled}`;
}

export function resolveOpenCodeCliExecutable(appDataDir?: string): {
  executable: string | null;
  version: string | null;
} {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { executable: null, version: null };
  }

  // 1. Prioriza binário nativo gerenciado ou instalado sem depender de wrapper .cmd
  const resolvedAppData = appDataDir ?? process.env.APPDATA ?? "";
  if (resolvedAppData) {
    const baseRuntime = join(resolvedAppData, "OpenBot", "provider-runtimes", "opencode");
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
                process.platform === "win32" ? "opencode.exe" : "opencode"
              );
              if (existsSync(exe)) {
                return { executable: exe, version: ver };
              }
            }
          } catch {
            // ignora leitura inválida
          }
        }
      }
    } catch {
      // ignora erro
    }
  }

  // 2. Procura no PATH do sistema
  const pathEntries = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const names = process.platform === "win32" ? ["opencode.exe", "opencode.cmd"] : ["opencode"];
  for (const dir of pathEntries) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return { executable: candidate, version: "PATH" };
      }
    }
  }

  return { executable: null, version: null };
}

class OpenCodeAcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRpc>();
  private nextId = 1;
  private closed = false;
  private initialized = false;
  private onChunk: ((txt: string) => void) | null = null;
  private onUsage: ((used: number) => void) | null = null;

  constructor(
    executable: string,
    cwd: string,
    extraEnv: Record<string, string | undefined>
  ) {
    const isCmdWrapper = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    this.child = spawn(
      isCmdWrapper ? process.env.ComSpec || "cmd.exe" : executable,
      isCmdWrapper ? ["/c", executable, "acp"] : ["acp"],
      {
        cwd,
        env: {
          ...process.env,
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          ...extraEnv,
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      }
    );

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

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
          update?: { sessionUpdate?: string; content?: { type?: string; text?: string }; used?: number };
        }).update;
        if (!upd) return;
        if (upd.sessionUpdate === "agent_message_chunk" && upd.content?.type === "text" && upd.content.text) {
          this.onChunk?.(upd.content.text);
        } else if (upd.sessionUpdate === "usage_update" && typeof upd.used === "number") {
          this.onUsage?.(upd.used);
        }
        return;
      }

      if (typeof msg.id === "number") {
        const wait = this.pending.get(msg.id);
        if (!wait) return;
        this.pending.delete(msg.id);
        clearTimeout(wait.timer);
        if (msg.error !== undefined) {
          const rec = msg.error as { message?: string; data?: { details?: string } };
          wait.reject(new Error(rec.data?.details || rec.message || "Falha no servidor OpenCode ACP."));
        } else {
          wait.resolve(msg.result);
        }
      }
    });

    this.child.on("exit", (code) => {
      this.closed = true;
      for (const [id, wait] of this.pending.entries()) {
        clearTimeout(wait.timer);
        wait.reject(new Error(`Servidor OpenCode ACP encerrou (código ${code ?? "null"}).`));
        this.pending.delete(id);
      }
      rl.close();
    });
  }

  public isAlive(): boolean {
    return !this.closed && !this.child.killed;
  }

  private send(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
  }

  private request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Conexão OpenCode ACP fechada."));
    const id = this.nextId++;
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) em OpenCode '${method}'.`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        resolve: (res) => resolvePromise(res as T),
        reject: rejectPromise,
        timer,
      });

      try {
        this.send({ id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async runPrompt(input: {
    cwd: string;
    promptText: string;
    modelId: string;
    timeoutMs: number;
    agentId?: string | null;
    mcpServers?: unknown[];
    onDelta?: (chunk: string) => void;
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
          clientInfo: { name: "criativo-ai-studio", title: "Criativo AI Studio", version: "1.0.0" },
        },
        20_000
      );
      this.initialized = true;
    }

    const resolvedMcpServers = Array.isArray(input.mcpServers) ? input.mcpServers : [];
    const sess = await this.request<{ sessionId: string; configOptions?: OpenCodeConfigOption[] }>(
      "session/new",
      { cwd: input.cwd, mcpServers: resolvedMcpServers },
      25_000
    );

    let modelUsed = input.modelId;
    if (Array.isArray(sess.configOptions)) {
      const modelOpt = sess.configOptions.find((o) => o.id === "model" || o.category === "model");
      if (modelOpt?.id) {
        try {
          await this.request(
            "session/set_config_option",
            { sessionId: sess.sessionId, configId: modelOpt.id, value: input.modelId },
            10_000
          );
        } catch {
          // alguns modelos livres são selecionados direto ou usa o padrão livre
          if (modelOpt.currentValue) modelUsed = modelOpt.currentValue;
        }
      }
    }

    const chunks: string[] = [];
    let reportedUsed = 0;
    this.onChunk = (txt) => {
      chunks.push(txt);
      input.onDelta?.(txt);
    };
    this.onUsage = (u) => {
      reportedUsed = Math.max(reportedUsed, u);
    };

    try {
      await this.request(
        "session/prompt",
        { sessionId: sess.sessionId, prompt: [{ type: "text", text: input.promptText }] },
        input.timeoutMs
      );
    } finally {
      this.onChunk = null;
      this.onUsage = null;
      void this.request("session/close", { sessionId: sess.sessionId }, 3_000).catch(() => {});
    }

    const finalText = chunks.join("").trim();
    const estOut = Math.max(1, Math.round(finalText.length / 4));
    const estIn = Math.max(1, Math.round(input.promptText.length / 4));
    return {
      text: finalText,
      modelUsed,
      usage: {
        uncachedInput: reportedUsed > estOut ? reportedUsed - estOut : estIn,
        cachedInput: 0,
        output: estOut,
      },
    };
  }

  public dispose(): void {
    this.closed = true;
    for (const [id, wait] of this.pending.entries()) {
      clearTimeout(wait.timer);
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

export type OpenCodeMcpServersResolver = (
  agentId?: string | null
) => Promise<unknown[]> | unknown[];

/**
 * Descobre e executa os modelos gratuitos e ativos do OpenCode CLI instalado na máquina.
 */
export class OpenCodeLiveService {
  private readonly vault?: VaultService;
  private readonly workspaceCwd: string;
  private readonly appDataDir?: string;
  private mcpServersResolver?: OpenCodeMcpServersResolver;
  private modelsCache: { expiresAt: number; data: ModeloProvedorInfo[]; version: string | null; executable: string | null } | null = null;
  private worker: { conn: OpenCodeAcpConnection; idleTimer: NodeJS.Timeout | null; queue: Promise<unknown> } | null = null;

  constructor(options?: {
    vault?: VaultService;
    workspaceCwd?: string;
    appDataDir?: string;
    mcpServersResolver?: OpenCodeMcpServersResolver;
  }) {
    this.vault = options?.vault;
    this.workspaceCwd = resolve(options?.workspaceCwd ?? process.cwd());
    this.appDataDir = options?.appDataDir;
    this.mcpServersResolver = options?.mcpServersResolver;
  }

  public setMcpServersResolver(resolver?: OpenCodeMcpServersResolver): void {
    this.mcpServersResolver = resolver;
  }

  public async getLiveCatalog(forceRefresh = false): Promise<{
    detected: boolean;
    version: string | null;
    executable: string | null;
    modelos: ModeloProvedorInfo[];
  }> {
    const now = Date.now();
    if (!forceRefresh && this.modelsCache && this.modelsCache.expiresAt > now) {
      return {
        detected: Boolean(this.modelsCache.executable),
        version: this.modelsCache.version,
        executable: this.modelsCache.executable,
        modelos: this.modelsCache.data,
      };
    }

    const { executable, version } = resolveOpenCodeCliExecutable(this.appDataDir);
    if (!executable) {
      this.modelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, data: [], version: null, executable: null };
      return { detected: false, version: null, executable: null, modelos: [] };
    }

    const hasApiKey = Boolean(this.vault?.getSecret("opencode_api_key"));
    const isCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);

    let models: ModeloProvedorInfo[] = [];
    try {
      const apiKey = this.vault?.getSecret("opencode_api_key");
      const { stdout } = await execFileAsync(
        isCmd ? process.env.ComSpec || "cmd.exe" : executable,
        isCmd ? ["/c", executable, "models"] : ["models"],
        {
          timeout: 20_000,
          env: {
            ...process.env,
            OPENCODE_DISABLE_AUTOUPDATE: "1",
            ...(apiKey ? { OPENCODE_API_KEY: apiKey } : {}),
          },
        }
      );

      const rawIds = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("Fetching") && l.includes("/"));

      const seen = new Set<string>();
      for (const id of rawIds) {
        if (seen.has(id)) continue;
        const lower = id.toLowerCase();
        const isFree =
          lower.startsWith("opencode/") && (lower.endsWith("-free") || lower === "opencode/big-pickle");
        // Sem API Key configurada, priorizamos somente modelos gratuitos prontos para rodar (como no OpenBot)
        if (!hasApiKey && !isFree) continue;
        seen.add(id);
        models.push({
          id,
          rotulo: formatOpenCodeModelLabel(id),
          padrao: id === "opencode/glm-5.3-flash-free",
          gratuito: isFree,
          esforcos_suportados: ["medio", "alto"],
          descoberto_em_conta: true,
        });
      }
    } catch {
      // ignora erro temporário ao listar modelos
    }

    // Ordena deixando os gratuitos e padrão no topo
    models.sort((a, b) => {
      if (a.padrao && !b.padrao) return -1;
      if (!a.padrao && b.padrao) return 1;
      if (a.gratuito && !b.gratuito) return -1;
      if (!a.gratuito && b.gratuito) return 1;
      return a.rotulo.localeCompare(b.rotulo, "pt-BR");
    });

    if (models.length > 0) {
      this.modelsCache = {
        expiresAt: now + MODELS_CACHE_TTL_MS,
        data: models,
        version,
        executable,
      };
    } else if (this.modelsCache && this.modelsCache.data.length > 0) {
      models = this.modelsCache.data;
    }

    return { detected: true, version, executable, modelos: models };
  }

  private getOrCreateWorker(executable: string, sandboxCwd: string, apiKey?: string | null) {
    if (!this.worker || !this.worker.conn.isAlive()) {
      if (this.worker?.idleTimer) clearTimeout(this.worker.idleTimer);
      this.worker = {
        conn: new OpenCodeAcpConnection(executable, sandboxCwd, {
          ...(apiKey ? { OPENCODE_API_KEY: apiKey } : {}),
        }),
        idleTimer: null,
        queue: Promise.resolve(),
      };
    }

    if (this.worker.idleTimer) {
      clearTimeout(this.worker.idleTimer);
      this.worker.idleTimer = null;
    }
    return this.worker;
  }

  public async executePrompt(input: {
    modelId: string;
    systemPrompt?: string;
    messages: Array<{ role: "user" | "assistant"; text: string }>;
    timeoutMs?: number;
    agentId?: string | null;
    mcpServers?: unknown[];
    onDelta?: (chunk: string) => void;
  }): Promise<{
    text: string;
    modelUsed: string;
    usage: { uncachedInput: number; cachedInput: number; output: number };
  }> {
    const { executable } = resolveOpenCodeCliExecutable(this.appDataDir);
    if (!executable) {
      throw new Error("OpenCode CLI não encontrado neste computador.");
    }

    const sandboxCwd = resolve(this.workspaceCwd, "dados", "opencode-sandbox");
    mkdirSync(sandboxCwd, { recursive: true });
    const apiKey = this.vault?.getSecret("opencode_api_key");
    const resolvedMcpServers = Array.isArray(input.mcpServers)
      ? input.mcpServers
      : ((await this.mcpServersResolver?.(input.agentId)) ?? []);

    const promptParts: string[] = [];
    if (input.systemPrompt) {
      promptParts.push(
        `${input.systemPrompt}\n\n[Diretriz de execução]: Responda diretamente ao pedido editorial/estratégico do usuário usando Markdown bem estruturado (títulos, listas, negrito, tabelas). Não inspecione arquivos internos do repositório nem cite diretórios de código como apps/daemon.`
      );
    }
    if (input.messages.length > 1) {
      promptParts.push(
        `[Contexto recente da conversa]\n${input.messages
          .slice(-7, -1)
          .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
          .join("\n")}`
      );
    }
    promptParts.push(input.messages[input.messages.length - 1]?.text ?? "");
    const fullPrompt = promptParts.join("\n\n");

    const runWithModel = async (targetModel: string) => {
      const activeWorker = this.getOrCreateWorker(executable, sandboxCwd, apiKey);
      const run = activeWorker.queue.then(() =>
        activeWorker.conn.runPrompt({
          cwd: sandboxCwd,
          promptText: fullPrompt,
          modelId: targetModel,
          timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
          agentId: input.agentId,
          mcpServers: resolvedMcpServers,
          onDelta: input.onDelta,
        })
      );
      activeWorker.queue = run.catch(() => {});

      try {
        const res = await run;
        if (!res.text) {
          throw new Error(`Modelo ${targetModel} retornou resposta vazia.`);
        }
        return res;
      } finally {
        activeWorker.idleTimer = setTimeout(() => {
          activeWorker.conn.dispose();
          if (this.worker === activeWorker) this.worker = null;
        }, 5 * 60_000);
        activeWorker.idleTimer.unref?.();
      }
    };

    const isFreeModel =
      input.modelId.toLowerCase().endsWith("-free") || input.modelId.toLowerCase() === "opencode/big-pickle";
    const candidates: string[] = [input.modelId];

    if (isFreeModel) {
      const catalog = await this.getLiveCatalog(false).catch(() => null);
      const availableFree = (catalog?.modelos ?? [])
        .filter((m) => m.gratuito && m.id !== input.modelId)
        .map((m) => m.id);
      const preferredFallbacks = [
        "opencode/glm-5.3-flash-free",
        "opencode/deepseek-v4.1-flash-free",
        "opencode/big-pickle",
        ...availableFree,
      ];
      for (const cand of preferredFallbacks) {
        if (cand !== input.modelId && !candidates.includes(cand) && (availableFree.length === 0 || availableFree.includes(cand))) {
          candidates.push(cand);
        }
        if (candidates.length >= 3) break;
      }
    }

    let lastErr: unknown = null;
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const candidateModel = candidates[idx];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await runWithModel(candidateModel);
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient =
            /internal\s*error|internal service failure|serviceunavailable|temporar|timeout|rate[ _-]?limit|429|50[0-4]|encerrou/i.test(
              msg
            );
          if (!isTransient) {
            throw err;
          }
          // Descarta worker potencialmente frio/instável e aguarda curto backoff antes de tentar outro ou repetir
          this.close();
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 700));
            // Só repete o mesmo modelo na 1a falha se for o primeiro candidato; nos fallbacks vai direto
            if (idx === 0) continue;
          }
          break;
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error("Falha ao executar modelo no OpenCode ACP.");
  }

  public close(): void {
    if (!this.worker) return;
    if (this.worker.idleTimer) clearTimeout(this.worker.idleTimer);
    this.worker.conn.dispose();
    this.worker = null;
  }
}
