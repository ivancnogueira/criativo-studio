import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DAEMON_LOG_BYTES = 2 * 1024 * 1024;
const WATCHDOG_WINDOW_MS = 120_000;
const WATCHDOG_MAX_RESTARTS = 5;

function appendDaemonLogLine(logFilePath: string, line: string): void {
  try {
    mkdirSync(dirname(logFilePath), { recursive: true });
    if (existsSync(logFilePath)) {
      const size = statSync(logFilePath).size;
      if (size > MAX_DAEMON_LOG_BYTES) {
        try {
          renameSync(logFilePath, `${logFilePath}.prev`);
        } catch {
          // ignora erro de rotação concorrente no Windows se arquivo estiver bloqueado
        }
      }
    }
    appendFileSync(logFilePath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    // falha de disco não pode derrubar o launcher
  }
}

export interface UpdateRestartPayload {
  mode: "hot_bundle" | "native_installer";
  stagedArtifactPath: string | null;
  version: string | null;
}

export interface EmbeddedDaemonOptions {
  productRoot: string;
  userDataDir: string;
  preferredPort?: number;
  isPackaged?: boolean;
  appVersion?: string;
  vaultKey?: string;
  onUpdateRestartRequested?: (payload: UpdateRestartPayload) => void;
  onDaemonRestarted?: (port: number, attempt: number) => void;
  onDaemonCrashed?: (code: number | null, signal: string | null) => void;
}

export function resolveSafeUpdateArtifactPath(
  userDataDir: string,
  candidatePath: string | null | undefined,
): string | null {
  if (typeof candidatePath !== "string" || candidatePath.trim().length === 0) {
    return null;
  }
  const updatesDir = resolve(join(userDataDir, "updates"));
  const resolvedCandidate = resolve(candidatePath.trim());
  const rel = relative(updatesDir, resolvedCandidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  const normalizedBase = process.platform === "win32" ? updatesDir.toLowerCase() : updatesDir;
  const normalizedTarget =
    process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  if (!normalizedTarget.startsWith(normalizedBase + sep)) {
    return null;
  }
  return resolvedCandidate;
}

export interface EnsureRunningResult {
  ok: boolean;
  restarted: boolean;
  port: number;
}

export interface EmbeddedDaemonHandle {
  port: number;
  baseUrl: string;
  productRoot: string;
  userDataDir: string;
  ensureRunning: () => Promise<EnsureRunningResult>;
  stop: () => Promise<void>;
  getRecentLogs: () => string[];
}

export function createWatchdogRecoveryController<TProc extends { exitCode: number | null; killed: boolean }>(deps: {
  port: number;
  maxRestarts?: number;
  windowMs?: number;
  getCurrentProc: () => TProc | null;
  setCurrentProc: (next: TProc) => void;
  spawnProc: () => TProc;
  waitHealthy: (proc: TProc) => Promise<void>;
  attachWatchdog: (proc: TProc) => void;
  checkHealth: () => Promise<boolean>;
  isStopping: () => boolean;
  log?: (msg: string) => void;
}) {
  const maxRestarts = deps.maxRestarts ?? WATCHDOG_MAX_RESTARTS;
  const windowMs = deps.windowMs ?? WATCHDOG_WINDOW_MS;
  const restartTimestamps: number[] = [];
  let inFlightRecovery: Promise<EnsureRunningResult> | null = null;
  let watchdogSuspended = false;

  const canAutoRestart = (now = Date.now()): { allowed: boolean; attempt: number; backoffMs: number } => {
    while (restartTimestamps.length > 0 && now - restartTimestamps[0]! > windowMs) {
      restartTimestamps.shift();
    }
    if (restartTimestamps.length >= maxRestarts) {
      watchdogSuspended = true;
      return { allowed: false, attempt: restartTimestamps.length, backoffMs: 0 };
    }
    const attempt = restartTimestamps.length + 1;
    const backoffMs = 1000 * 2 ** Math.min(3, restartTimestamps.length);
    restartTimestamps.push(now);
    return { allowed: true, attempt, backoffMs };
  };

  const ensureRunning = async (): Promise<EnsureRunningResult> => {
    if (deps.isStopping()) {
      return { ok: false, restarted: false, port: deps.port };
    }
    if (inFlightRecovery) {
      return await inFlightRecovery;
    }

    const run = (async (): Promise<EnsureRunningResult> => {
      const proc = deps.getCurrentProc();
      const procLooksAlive = Boolean(proc && proc.exitCode === null && !proc.killed);
      if (procLooksAlive && (await deps.checkHealth().catch(() => false))) {
        return { ok: true, restarted: false, port: deps.port };
      }

      if (watchdogSuspended) {
        deps.log?.("[Watchdog] Recuperação manual solicitada ao reabrir janela; limpando suspensão anterior.");
      }
      restartTimestamps.length = 0;
      watchdogSuspended = false;

      const nextProc = deps.spawnProc();
      deps.setCurrentProc(nextProc);
      deps.attachWatchdog(nextProc);
      await deps.waitHealthy(nextProc);
      deps.log?.(`[Watchdog] Daemon recuperado na porta ${deps.port} via ensureRunning().`);
      return { ok: true, restarted: true, port: deps.port };
    })().finally(() => {
      inFlightRecovery = null;
    });

    inFlightRecovery = run;
    return await run;
  };

  return {
    canAutoRestart,
    ensureRunning,
    isWatchdogSuspended: () => watchdogSuspended,
  };
}

export function resolveDesktopProductRoot(options: {
  isPackaged: boolean;
  resourcesPath?: string;
}): string {
  if (options.isPackaged && options.resourcesPath) {
    const packagedDir = join(options.resourcesPath, "app-product");
    if (existsSync(join(packagedDir, "apps", "daemon", "dist", "server", "daemon-server.js"))) {
      return packagedDir;
    }
    return options.resourcesPath;
  }

  // Modo desenvolvimento: sobe até a raiz do monorepo a partir de apps/desktop/dist|src
  let cursor = resolve(dirname(fileURLToPath(import.meta.url)));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(cursor, "produto.json")) && existsSync(join(cursor, "apps", "daemon"))) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolve(process.cwd());
}

export async function findFreeLoopbackPort(preferredPort = 3000): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number>((resolvePort, rejectPort) => {
      const srv = createNetServer();
      srv.unref();
      srv.once("error", rejectPort);
      srv.listen(port, "127.0.0.1", () => {
        const addr = srv.address();
        const chosen = typeof addr === "object" && addr ? addr.port : port;
        srv.close(() => resolvePort(chosen));
      });
    });

  try {
    return await tryPort(preferredPort);
  } catch {
    return await tryPort(0);
  }
}

async function waitForDaemonHealthy(port: number, proc: ChildProcess, getLogs: () => string[]): Promise<void> {
  const deadline = Date.now() + 45_000;
  const healthUrl = `http://127.0.0.1:${port}/health`;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Daemon encerrou inesperadamente (código ${proc.exitCode}). Logs: ${getLogs().slice(-10).join(" | ")}`,
      );
    }
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1200) });
      if (res.ok) return;
    } catch {
      // aguardando escuta HTTP
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `Timeout aguardando daemon responder em ${healthUrl}. Logs: ${getLogs().slice(-10).join(" | ")}`,
  );
}

export async function startEmbeddedDaemon(options: EmbeddedDaemonOptions): Promise<EmbeddedDaemonHandle> {
  const productRoot = resolve(options.productRoot);
  const userDataDir = resolve(options.userDataDir);
  mkdirSync(userDataDir, { recursive: true });

  const distEntry = join(productRoot, "apps", "daemon", "dist", "server", "daemon-server.js");
  const devEntry = join(productRoot, "apps", "daemon", "src", "server", "daemon-server.ts");
  const entryFile = existsSync(distEntry) ? distEntry : devEntry;
  if (!existsSync(entryFile)) {
    throw new Error(`Entrypoint do daemon não encontrado em '${productRoot}'.`);
  }

  const port = await findFreeLoopbackPort(options.preferredPort ?? 3000);
  const daemonLogPath = join(userDataDir, "logs", "daemon.log");
  const logs: string[] = [];
  const pushLog = (line: string) => {
    const clean = line.trim();
    if (!clean) return;
    logs.push(clean);
    if (logs.length > 200) logs.shift();
    appendDaemonLogLine(daemonLogPath, clean);
  };

  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;

  const spawnDaemonChild = (): ChildProcess => {
    const child = spawn(process.execPath, [entryFile], {
      cwd: userDataDir,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: options.isPackaged ? "production" : (process.env.NODE_ENV ?? "production"),
        HOST: "127.0.0.1",
        PORT: String(port),
        CRIATIVO_PACKAGED: options.isPackaged === false ? "0" : "1",
        CRIATIVO_DESKTOP_PACKAGED: "1",
        CRIATIVO_PRODUCT_ROOT: productRoot,
        CRIATIVO_USER_DATA_DIR: userDataDir,
        ...(options.vaultKey ? { CRIATIVO_VAULT_KEY: options.vaultKey } : {}),
        ...(options.appVersion ? { CRIATIVO_APP_VERSION: options.appVersion } : {}),
      },
    });

    child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const msg = raw as Record<string, unknown>;
      if (msg.type === "criativo:request-update-restart") {
        const mode = msg.mode === "native_installer" ? "native_installer" : "hot_bundle";
        const stagedArtifactPath =
          typeof msg.stagedArtifactPath === "string" ? msg.stagedArtifactPath : null;
        const version = typeof msg.version === "string" ? msg.version : null;
        options.onUpdateRestartRequested?.({ mode, stagedArtifactPath, version });
      }
    });

    child.stdout?.on("data", (buf: Buffer) => {
      for (const l of buf.toString("utf8").split(/\r?\n/)) pushLog(l);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      for (const l of buf.toString("utf8").split(/\r?\n/)) pushLog(`[stderr] ${l}`);
    });

    return child;
  };

  let currentProc: ChildProcess = spawnDaemonChild();

  const checkDaemonHealthNow = async (): Promise<boolean> => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  };

  const attachExitWatchdog = (procRef: ChildProcess): void => {
    procRef.once("exit", (code, signal) => {
      if (stopping) return;
      pushLog(`[Watchdog] Daemon encerrou inesperadamente (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
      options.onDaemonCrashed?.(code, signal);

      const decision = recovery.canAutoRestart();
      if (!decision.allowed) {
        pushLog(
          `[Watchdog] Limite de ${WATCHDOG_MAX_RESTARTS} reinícios em ${WATCHDOG_WINDOW_MS / 1000}s atingido. Auto-restart suspenso.`,
        );
        return;
      }

      pushLog(`[Watchdog] Agendando reinício automático #${decision.attempt} em ${decision.backoffMs}ms...`);

      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (stopping) return;
        const nextProc = spawnDaemonChild();
        currentProc = nextProc;
        attachExitWatchdog(nextProc);
        void waitForDaemonHealthy(port, nextProc, () => logs)
          .then(() => {
            pushLog(`[Watchdog] Daemon reiniciado com sucesso na porta ${port} (tentativa #${decision.attempt}).`);
            options.onDaemonRestarted?.(port, decision.attempt);
          })
          .catch((err) => {
            pushLog(
              `[Watchdog] Falha ao aguardar saúde após reinício #${decision.attempt}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      }, decision.backoffMs);
    });
  };

  const recovery = createWatchdogRecoveryController({
    port,
    getCurrentProc: () => currentProc,
    setCurrentProc: (next) => {
      currentProc = next;
    },
    spawnProc: spawnDaemonChild,
    waitHealthy: (proc) => waitForDaemonHealthy(port, proc, () => logs),
    attachWatchdog: attachExitWatchdog,
    checkHealth: checkDaemonHealthNow,
    isStopping: () => stopping,
    log: pushLog,
  });

  await waitForDaemonHealthy(port, currentProc, () => logs);
  attachExitWatchdog(currentProc);

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    productRoot,
    userDataDir,
    ensureRunning: () => recovery.ensureRunning(),
    getRecentLogs: () => [...logs],
    async stop(): Promise<void> {
      stopping = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      const proc = currentProc;
      if (proc.exitCode !== null || proc.killed) return;
      await new Promise<void>((resolveStop) => {
        const forceTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // já encerrado
          }
          resolveStop();
        }, 4000);

        proc.once("exit", () => {
          clearTimeout(forceTimer);
          resolveStop();
        });

        try {
          proc.kill("SIGTERM");
        } catch {
          clearTimeout(forceTimer);
          resolveStop();
        }
      });
    },
  };
}
