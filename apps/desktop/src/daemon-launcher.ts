import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  onUpdateRestartRequested?: (payload: UpdateRestartPayload) => void;
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

export interface EmbeddedDaemonHandle {
  port: number;
  baseUrl: string;
  productRoot: string;
  userDataDir: string;
  stop: () => Promise<void>;
  getRecentLogs: () => string[];
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
  const logs: string[] = [];
  const pushLog = (line: string) => {
    const clean = line.trim();
    if (!clean) return;
    logs.push(clean);
    if (logs.length > 200) logs.shift();
  };

  const proc = spawn(process.execPath, [entryFile], {
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
      ...(options.appVersion ? { CRIATIVO_APP_VERSION: options.appVersion } : {}),
    },
  });

  proc.on("message", (raw: unknown) => {
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

  proc.stdout?.on("data", (buf: Buffer) => {
    for (const l of buf.toString("utf8").split(/\r?\n/)) pushLog(l);
  });
  proc.stderr?.on("data", (buf: Buffer) => {
    for (const l of buf.toString("utf8").split(/\r?\n/)) pushLog(`[stderr] ${l}`);
  });

  await waitForDaemonHealthy(port, proc, () => logs);

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    productRoot,
    userDataDir,
    getRecentLogs: () => [...logs],
    async stop(): Promise<void> {
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
