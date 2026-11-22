import {
  spawn,
  execFileSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import type { AgentAllowedFolder, ProcessConfinementMetadata } from "@criativo/contracts";
import { resolveConfinedWorkingDirectory } from "./workspace-sandbox.ts";

const DEFAULT_SAFE_ENV_ALLOWLIST = new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "TERM",
  "COLORTERM",
]);

const SENSITIVE_ENV_KEY_PATTERN =
  /(VAULT_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY|OAUTH|CREDENTIAL|BEARER|COOKIE|ANTHROPIC|OPENAI|GEMINI|ELEVENLABS|TELEGRAM|SLACK|DISCORD|META_ACCESS)/i;

/**
 * Sanitiza variáveis de ambiente antes de passar para qualquer processo filho (`spawn`):
 * mantém somente allowlist mínima do SO + chaves explicitamente autorizadas em `passthroughKeys`,
 * bloqueando vazamento de segredos do daemon mesmo que existam no `process.env`.
 */
export function sanitizeChildEnv(options: {
  sourceEnv?: NodeJS.ProcessEnv;
  extraEnv?: Record<string, string>;
  passthroughKeys?: readonly string[];
}): { env: Record<string, string>; removedSecretKeysCount: number } {
  const source = options.sourceEnv ?? process.env;
  const passthrough = new Set(
    (options.passthroughKeys ?? []).map((k) => k.trim()).filter(Boolean),
  );
  const env: Record<string, string> = {};
  let removedSecretKeysCount = 0;

  for (const [key, val] of Object.entries(source)) {
    if (typeof val !== "string") continue;
    const isSensitive = SENSITIVE_ENV_KEY_PATTERN.test(key);
    if (isSensitive && !passthrough.has(key)) {
      removedSecretKeysCount += 1;
      continue;
    }
    if (DEFAULT_SAFE_ENV_ALLOWLIST.has(key) || passthrough.has(key)) {
      env[key] = val;
    }
  }

  for (const [key, val] of Object.entries(options.extraEnv ?? {})) {
    if (typeof val === "string") {
      env[key] = val;
    }
  }

  return { env, removedSecretKeysCount };
}

/**
 * Encerra a árvore completa do processo filho (Windows via `taskkill /T /F`, POSIX via process group `-pid`).
 */
export function killProcessTree(child: ChildProcess | null | undefined): void {
  if (!child || typeof child.pid !== "number" || child.pid <= 0) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 4_000,
      });
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // processo já encerrado
    }
  }
}

export interface SpawnConfinedOptions {
  command: string;
  args: string[];
  workspaceRoot: string;
  requestedCwd?: string | null;
  allowedFolders?: readonly AgentAllowedFolder[];
  extraEnv?: Record<string, string>;
  passthroughKeys?: readonly string[];
  timeoutMs?: number;
  shell?: boolean;
}

/**
 * Lança um processo filho em ambiente confinado:
 * `cwd` validado pelo `workspace-sandbox`, `env` sanitizado sem segredos do daemon,
 * desacoplamento em process group (POSIX) e encerramento forçado de árvore no timeout.
 */
export function spawnConfinedProcess(options: SpawnConfinedOptions): {
  child: ChildProcessWithoutNullStreams;
  confinement: ProcessConfinementMetadata;
  dispose: () => void;
} {
  const confinedCwd = resolveConfinedWorkingDirectory({
    requestedCwd: options.requestedCwd,
    workspaceRoot: options.workspaceRoot,
    allowedFolders: options.allowedFolders,
  });

  const { env, removedSecretKeysCount } = sanitizeChildEnv({
    extraEnv: options.extraEnv,
    passthroughKeys: options.passthroughKeys,
  });

  const child = spawn(options.command, options.args, {
    cwd: confinedCwd,
    env,
    shell: options.shell === true,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
    timer = setTimeout(() => {
      killProcessTree(child);
    }, options.timeoutMs);
  }

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  child.once("close", clearTimer);
  child.once("error", clearTimer);

  const confinement: ProcessConfinementMetadata = {
    platform: process.platform,
    envKeysCount: Object.keys(env).length,
    removedSecretKeysCount,
    confinedCwd,
    treeKillEnabled: true,
    rlimitApplied: process.platform !== "win32",
  };

  return {
    child,
    confinement,
    dispose: () => {
      clearTimer();
      killProcessTree(child);
    },
  };
}
