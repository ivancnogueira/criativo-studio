/**
 * Supervisor de processo filho para o banco SQLite compartilhado (`shared-tables-host`).
 * Garante fila serializada (1 instrução por vez), deadline de 5.000 ms com `SIGKILL`
 * para queries presas e reinício limpo automático para as chamadas subsequentes.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { HostRequestMessage, HostResponseMessage } from "./shared-tables-host.ts";
import { AGENT_DATABASE_LIMITS } from "./shared-tables-rules.ts";

export interface SharedTablesSupervisorOptions {
  dbPath: string;
  queryTimeoutMs?: number;
  hostStartDeadlineMs?: number;
  queueWaitMs?: number;
}

export class SharedTablesError extends Error {
  public readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "SharedTablesError";
    this.codigo = codigo;
  }
}

interface QueuedTask {
  payload: Omit<HostRequestMessage, "id">;
  enqueuedAt: number;
  resolve: (res: unknown) => void;
  reject: (err: Error) => void;
  waitTimer: ReturnType<typeof setTimeout>;
}

function resolveHostScriptPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const productRoot = process.env.CRIATIVO_PRODUCT_ROOT ? resolve(process.env.CRIATIVO_PRODUCT_ROOT) : null;
  const candidates = [
    fileURLToPath(new URL("./shared-tables-host.js", import.meta.url)),
    resolve(currentDir, "../agent-data/shared-tables-host.js"),
    productRoot ? resolve(productRoot, "apps/daemon/dist/agent-data/shared-tables-host.js") : null,
    productRoot ? resolve(productRoot, "apps/daemon/dist/server/shared-tables-host.js") : null,
    fileURLToPath(new URL("./shared-tables-host.ts", import.meta.url)),
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return fileURLToPath(new URL("./shared-tables-host.ts", import.meta.url));
}

export class SharedTablesSupervisor {
  public readonly dbPath: string;
  private readonly queryTimeoutMs: number;
  private readonly hostStartDeadlineMs: number;
  private readonly queueWaitMs: number;

  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private readyPromise: Promise<void> | null = null;
  private closed = false;

  private readonly queue: QueuedTask[] = [];
  private processing = false;
  private inflight: {
    id: string;
    resolve: (msg: HostResponseMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(options: SharedTablesSupervisorOptions) {
    this.dbPath = options.dbPath;
    this.queryTimeoutMs = options.queryTimeoutMs ?? AGENT_DATABASE_LIMITS.queryTimeoutMs;
    this.hostStartDeadlineMs =
      options.hostStartDeadlineMs ?? AGENT_DATABASE_LIMITS.hostStartDeadlineMs;
    this.queueWaitMs = options.queueWaitMs ?? AGENT_DATABASE_LIMITS.queueWaitMs;
  }

  private killCurrentChild(forceSigkill = true): void {
    const proc = this.child;
    this.child = null;
    this.readyPromise = null;
    if (this.rl) {
      try {
        this.rl.close();
      } catch {
        // ignora
      }
      this.rl = null;
    }
    if (proc && !proc.killed) {
      try {
        proc.kill(forceSigkill ? "SIGKILL" : "SIGTERM");
      } catch {
        try {
          proc.kill();
        } catch {
          // ignora
        }
      }
    }
  }

  private ensureHostReady(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new SharedTablesError("SUPERVISOR_ENCERRADO", "O supervisor Shared Tables já foi encerrado."),
      );
    }
    if (this.child && !this.child.killed && this.readyPromise) {
      return this.readyPromise;
    }

    const scriptPath = resolveHostScriptPath();
    const proc = spawn(process.execPath, [scriptPath, "--db", this.dbPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(process.env.CRIATIVO_DESKTOP_PACKAGED === "1" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
    });

    this.child = proc;
    const rl = createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });
    this.rl = rl;

    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      let isReady = false;
      const startTimer = setTimeout(() => {
        if (!isReady) {
          this.killCurrentChild(true);
          rejectReady(
            new SharedTablesError(
              "HOST_START_TIMEOUT",
              `O processo isolado Shared Tables não iniciou dentro de ${this.hostStartDeadlineMs} ms.`,
            ),
          );
        }
      }, this.hostStartDeadlineMs);

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }

        if (!isReady && parsed.type === "ready") {
          isReady = true;
          clearTimeout(startTimer);
          resolveReady();
          return;
        }

        if (this.inflight && parsed.id === this.inflight.id) {
          const current = this.inflight;
          this.inflight = null;
          clearTimeout(current.timer);
          current.resolve(parsed as unknown as HostResponseMessage);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(startTimer);
        if (!isReady) {
          this.killCurrentChild(true);
          rejectReady(err);
        } else if (this.inflight) {
          const current = this.inflight;
          this.inflight = null;
          clearTimeout(current.timer);
          this.killCurrentChild(true);
          current.reject(err);
        }
      });

      proc.on("exit", (code, signal) => {
        clearTimeout(startTimer);
        if (this.child === proc) {
          this.child = null;
          this.readyPromise = null;
          this.rl = null;
        }
        if (!isReady) {
          rejectReady(
            new SharedTablesError(
              "HOST_EXIT_PREMATURO",
              `Processo Shared Tables encerrou antes de ficar pronto (code=${code}, signal=${signal}).`,
            ),
          );
        } else if (this.inflight) {
          const current = this.inflight;
          this.inflight = null;
          clearTimeout(current.timer);
          current.reject(
            new SharedTablesError(
              "HOST_REINICIADO",
              `Processo Shared Tables encerrado abruptamente (code=${code}, signal=${signal}).`,
            ),
          );
        }
      });
    });

    return this.readyPromise;
  }

  public dispatch<T = unknown>(payload: Omit<HostRequestMessage, "id">): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new SharedTablesError("SUPERVISOR_ENCERRADO", "O supervisor Shared Tables está fechado."),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask = {
        payload,
        enqueuedAt: Date.now(),
        resolve: (val) => resolve(val as T),
        reject,
        waitTimer: setTimeout(() => {
          const idx = this.queue.indexOf(task);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(
              new SharedTablesError(
                "FILA_TIMEOUT",
                `A operação SQL aguardou mais de ${this.queueWaitMs} ms na fila serializada.`,
              ),
            );
          }
        }, this.queueWaitMs),
      };

      this.queue.push(task);
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.closed) {
        const next = this.queue.shift()!;
        clearTimeout(next.waitTimer);

        try {
          await this.ensureHostReady();
          const res = await this.sendSingleRequest(next.payload);
          if (!res.ok) {
            next.reject(
              new SharedTablesError(
                res.codigo ?? "ERRO_SQL",
                res.mensagem ?? "Falha ao executar instrução no banco compartilhado.",
              ),
            );
          } else {
            next.resolve(res.result);
          }
        } catch (err) {
          next.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private sendSingleRequest(payload: Omit<HostRequestMessage, "id">): Promise<HostResponseMessage> {
    return new Promise<HostResponseMessage>((resolve, reject) => {
      if (!this.child || !this.child.stdin.writable) {
        reject(new SharedTablesError("HOST_INDISPONIVEL", "Canal stdin do host SQL indisponível."));
        return;
      }

      const id = randomUUID();
      const timer = setTimeout(() => {
        if (this.inflight && this.inflight.id === id) {
          this.inflight = null;
          // Termina imediatamente com SIGKILL qualquer query presa em sqlite3_step (ex.: CTE infinita)
          this.killCurrentChild(true);
          reject(
            new SharedTablesError(
              "TIMEOUT_EXECUCAO",
              `Consulta interrompida após exceder o limite de ${this.queryTimeoutMs.toLocaleString("pt-BR")} ms.`,
            ),
          );
        }
      }, this.queryTimeoutMs);

      this.inflight = { id, resolve, reject, timer };
      const message: HostRequestMessage = { ...payload, id };
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  public async close(): Promise<void> {
    this.closed = true;
    while (this.queue.length > 0) {
      const pending = this.queue.shift()!;
      clearTimeout(pending.waitTimer);
      pending.reject(new SharedTablesError("SUPERVISOR_ENCERRADO", "Supervisor encerrado."));
    }
    if (this.inflight) {
      const current = this.inflight;
      this.inflight = null;
      clearTimeout(current.timer);
      current.reject(new SharedTablesError("SUPERVISOR_ENCERRADO", "Supervisor encerrado."));
    }
    this.killCurrentChild(false);
  }
}
