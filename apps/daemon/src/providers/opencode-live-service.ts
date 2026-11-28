import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ModeloProvedorInfo } from "@criativo/contracts";
import type { VaultService } from "../vault/vault-service.ts";
import { OpenCodeAcpConnection } from "./opencode-acp-connection.ts";
import { acpSessionCache, computeAcpConfigFingerprint } from "./acp-session-cache.ts";
import { type AcpToolStepEvent } from "./turn-stall-watchdog.ts";
import {
  ensureProviderRuntimeInstalled,
  resolveManagedProviderRuntime,
} from "./provider-runtime-resolver.ts";

const execFileAsync = promisify(execFile);
const MODELS_CACHE_TTL_MS = 120_000;
const EXEC_TIMEOUT_MS = 10 * 60_000;

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
  return resolveManagedProviderRuntime("opencode", { appDataDir });
}

export type OpenCodeMcpServersResolver = (
  agentId?: string | null
) => Promise<unknown[]> | unknown[];

interface OpenCodeWorkerSlot {
  conn: OpenCodeAcpConnection;
  idleTimer: NodeJS.Timeout | null;
  queue: Promise<unknown>;
  activeCount: number;
}

type OpenCodeCatalogCommandRunner = (
  cmd: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; env: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>;

/**
 * Descobre e executa os modelos gratuitos e ativos do OpenCode CLI instalado na máquina.
 */
export class OpenCodeLiveService {
  private readonly vault?: VaultService;
  private readonly workspaceCwd: string;
  private readonly appDataDir?: string;
  private readonly catalogCommandRunner: OpenCodeCatalogCommandRunner;
  private mcpServersResolver?: OpenCodeMcpServersResolver;
  private modelsCache: { expiresAt: number; data: ModeloProvedorInfo[]; version: string | null; executable: string | null } | null = null;
  private inFlightCatalogPromise: Promise<{
    detected: boolean;
    version: string | null;
    executable: string | null;
    modelos: ModeloProvedorInfo[];
  }> | null = null;
  private readonly workers = new Map<string, OpenCodeWorkerSlot>();

  constructor(options?: {
    vault?: VaultService;
    workspaceCwd?: string;
    appDataDir?: string;
    mcpServersResolver?: OpenCodeMcpServersResolver;
    catalogCommandRunner?: OpenCodeCatalogCommandRunner;
  }) {
    this.vault = options?.vault;
    this.workspaceCwd = resolve(options?.workspaceCwd ?? process.cwd());
    this.appDataDir = options?.appDataDir;
    this.mcpServersResolver = options?.mcpServersResolver;
    this.catalogCommandRunner =
      options?.catalogCommandRunner ??
      ((cmd, args, opts) => execFileAsync(cmd, args, opts));
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

    if (this.inFlightCatalogPromise) {
      return await this.inFlightCatalogPromise;
    }

    const promise = this.loadLiveCatalogInternal().finally(() => {
      if (this.inFlightCatalogPromise === promise) {
        this.inFlightCatalogPromise = null;
      }
    });
    this.inFlightCatalogPromise = promise;
    return await promise;
  }

  private async loadLiveCatalogInternal(): Promise<{
    detected: boolean;
    version: string | null;
    executable: string | null;
    modelos: ModeloProvedorInfo[];
  }> {
    const now = Date.now();
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
      const { stdout } = await this.catalogCommandRunner(
        isCmd ? process.env.ComSpec || "cmd.exe" : executable,
        isCmd ? ["/c", executable, "models"] : ["models"],
        {
          timeout: 20_000,
          windowsHide: true,
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
        // Sem API Key configurada, priorizamos somente modelos gratuitos prontos para rodar
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

  private getOrCreateWorker(
    workerKey: string,
    executable: string,
    sandboxCwd: string,
    apiKey?: string | null
  ): OpenCodeWorkerSlot {
    let slot = this.workers.get(workerKey);
    if (!slot || !slot.conn.isAlive()) {
      if (slot?.idleTimer) clearTimeout(slot.idleTimer);
      slot = {
        conn: new OpenCodeAcpConnection(executable, sandboxCwd, {
          ...(apiKey ? { OPENCODE_API_KEY: apiKey } : {}),
        }),
        idleTimer: null,
        queue: Promise.resolve(),
        activeCount: 0,
      };
      this.workers.set(workerKey, slot);
    }

    if (slot.idleTimer) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
    return slot;
  }

  private disposeWorker(workerKey: string): void {
    const slot = this.workers.get(workerKey);
    if (!slot) return;
    if (slot.activeCount > 0 && slot.conn.isAlive()) return;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.conn.dispose();
    this.workers.delete(workerKey);
  }

  public async ensureInstalled(timeoutMs = 180_000): Promise<{
    ok: boolean;
    executable: string | null;
    version: string | null;
    installedNow: boolean;
    error?: string;
  }> {
    const res = await ensureProviderRuntimeInstalled("opencode", {
      appDataDir: this.appDataDir,
      timeoutMs,
    });
    if (res.executable) {
      this.modelsCache = null;
      await this.getLiveCatalog(true).catch(() => null);
    }
    return {
      ok: Boolean(res.executable),
      executable: res.executable,
      version: res.version,
      installedNow: res.installedNow,
      ...(res.error ? { error: res.error } : {}),
    };
  }

  public async executePrompt(input: {
    modelId: string;
    turnMode?: "light" | "action";
    systemPrompt?: string;
    messages: Array<{ role: "user" | "assistant"; text: string }>;
    timeoutMs?: number;
    signal?: AbortSignal;
    agentId?: string | null;
    threadId?: string | null;
    channelOrigin?: "web" | "whatsapp";
    mcpServers?: unknown[];
    onDelta?: (chunk: string) => void;
    onToolStep?: (step: AcpToolStepEvent) => void;
  }): Promise<{
    text: string;
    modelUsed: string;
    usage: { uncachedInput: number; cachedInput: number; output: number };
  }> {
    if (input.signal?.aborted) {
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    let { executable } = resolveOpenCodeCliExecutable(this.appDataDir);
    if (!executable) {
      const ens = await this.ensureInstalled();
      executable = ens.executable;
      if (!executable) {
        throw new Error(ens.error || "OpenCode CLI não encontrado neste computador.");
      }
    }

    const isLight = input.turnMode === "light";
    const sandboxCwd = resolve(
      this.workspaceCwd,
      "dados",
      isLight ? ".light-cwd" : "opencode-sandbox"
    );
    mkdirSync(sandboxCwd, { recursive: true });
    const apiKey = this.vault?.getSecret("opencode_api_key");
    const resolvedMcpServers = isLight
      ? []
      : Array.isArray(input.mcpServers)
        ? input.mcpServers
        : ((await this.mcpServersResolver?.(input.agentId)) ?? []);

    const promptParts: string[] = [];
    if (input.systemPrompt) {
      if (isLight) {
        promptParts.push(input.systemPrompt);
      } else {
        const styleDirective =
          input.channelOrigin === "whatsapp"
            ? "[Diretriz de execução WhatsApp]: Responda diretamente de forma curta e amigável para celular (máximo 1 a 4 parágrafos curtos ou lista breve com •). Nunca use tabelas Markdown (|...|), nunca use cabeçalhos #, e não inspecione arquivos internos do repositório nem cite diretórios de código como apps/daemon."
            : "[Diretriz de execução]: Responda diretamente ao pedido editorial/estratégico do usuário usando Markdown bem estruturado (títulos, listas, negrito, tabelas quando útil). Não inspecione arquivos internos do repositório nem cite diretórios de código como apps/daemon.";
        promptParts.push(`${input.systemPrompt}\n\n${styleDirective}`);
      }
    }
    if (input.messages.length > 1) {
      promptParts.push(
        `[Contexto recente da conversa]\n${input.messages
          .slice(-7, -1)
          .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
          .join("\n")}`
      );
    }
    const lastUserMessage = input.messages[input.messages.length - 1]?.text ?? "";
    promptParts.push(lastUserMessage);
    const fullPrompt = promptParts.join("\n\n");
    const workerKey = input.agentId?.trim() || "default";

    const runWithModel = async (targetModel: string) => {
      const reuseKey = acpSessionCache.buildKey({
        provider: "opencode",
        accountId: "default",
        agentId: input.agentId,
        threadId: input.threadId,
      });
      const configFingerprint = computeAcpConfigFingerprint({
        modelId: targetModel,
        systemPrompt: input.systemPrompt,
        mcpServers: resolvedMcpServers,
      });
      const activeWorker = this.getOrCreateWorker(workerKey, executable, sandboxCwd, apiKey);
      activeWorker.activeCount += 1;
      const run = activeWorker.queue.then(() =>
        activeWorker.conn.runPrompt({
          cwd: sandboxCwd,
          promptText: fullPrompt,
          incrementalPromptText: lastUserMessage,
          reuseKey,
          configFingerprint,
          modelId: targetModel,
          timeoutMs: input.timeoutMs ?? EXEC_TIMEOUT_MS,
          signal: input.signal,
          agentId: input.agentId,
          mcpServers: resolvedMcpServers,
          onDelta: input.onDelta,
          onToolStep: input.onToolStep,
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
        activeWorker.activeCount = Math.max(0, activeWorker.activeCount - 1);
        if (activeWorker.activeCount === 0) {
          activeWorker.idleTimer = setTimeout(() => {
            if (activeWorker.activeCount > 0) return;
            activeWorker.conn.dispose();
            if (this.workers.get(workerKey) === activeWorker) {
              this.workers.delete(workerKey);
            }
          }, 5 * 60_000);
          activeWorker.idleTimer.unref?.();
        }
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
        if (input.signal?.aborted) {
          const abortErr = new Error("Turno interrompido.");
          abortErr.name = "AbortError";
          throw abortErr;
        }
        try {
          return await runWithModel(candidateModel);
        } catch (err) {
          if ((err instanceof Error && err.name === "AbortError") || input.signal?.aborted) {
            throw err;
          }
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient =
            /internal\s*error|internal service failure|serviceunavailable|temporar|timeout|rate[ _-]?limit|429|50[0-4]|encerrou/i.test(
              msg
            );
          if (!isTransient) {
            throw err;
          }
          // Descarta apenas o worker isolado deste agente (nunca workers de outros agentes)
          this.disposeWorker(workerKey);
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 700));
            if (idx === 0) continue;
          }
          break;
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error("Falha ao executar modelo no OpenCode ACP.");
  }

  public close(): void {
    for (const [key, slot] of this.workers.entries()) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.conn.dispose();
      this.workers.delete(key);
    }
  }
}
