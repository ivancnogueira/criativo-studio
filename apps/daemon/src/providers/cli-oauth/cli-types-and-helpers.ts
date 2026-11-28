import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
  ProviderName,
} from "@criativo/contracts";
import {
  ensureProviderRuntimeInstalled,
  resolveManagedProviderRuntime,
  spawnProviderProcess,
} from "../provider-runtime-resolver.ts";
import {
  createTurnStallWatchdog,
  DEFAULT_CLI_TOOL_STALL_MS,
  DEFAULT_CLI_TURN_STALL_MS,
  getLastMcpActivityAt,
  hasActiveMcpToolForAgent,
} from "../turn-stall-watchdog.ts";

export interface CliAccountRecord {
  id: string;
  provedor: "claude" | "openai";
  configDir: string;
  label: string | null;
  email: string | null;
  plano: string | null;
}

export interface CliExecutionInput {
  provedor: "claude" | "openai";
  modelId: string;
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  agentId?: string | null;
  preferredAccountId?: string | null;
  mcpConfig?: Record<string, unknown> | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CliExecutionOutput {
  text: string;
  modelUsed: string;
  accountId: string;
  accountEmail: string | null;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}

export const LOGIN_TIMEOUT_MS = 180_000;
export const EXEC_TIMEOUT_MS = DEFAULT_CLI_TURN_STALL_MS;
export const MODEL_CATALOG_TTL_MS = 5 * 60_000;
export const QUOTA_CACHE_TTL_MS = 2 * 60_000;

export function mapEffortList(list?: string[]): NivelEsforco[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const out = new Set<NivelEsforco>();
  for (const raw of list) {
    const k = String(raw).toLowerCase();
    if (k === "low" || k === "baixo") out.add("baixo");
    else if (k === "medium" || k === "medio") out.add("medio");
    else if (k === "high" || k === "xhigh" || k === "max" || k === "ultra" || k === "alto") out.add("alto");
  }
  return out.size > 0 ? Array.from(out) : undefined;
}

export function resolveCliBinaryForProvider(
  provedor: "claude" | "openai",
  appDataDir?: string
): { executable: string | null; version: string | null } {
  return resolveManagedProviderRuntime(provedor === "claude" ? "claude" : "codex", {
    appDataDir,
  });
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function spawnCommandWithStdin(input: {
  executable: string;
  args: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  stdinText?: string;
  keepStdinOpen?: boolean;
  interactiveWindow?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  stallMode?: boolean;
  toolStallMs?: number;
  agentId?: string | null;
  onOutputLine?: (line: string) => void;
  onRegisterAbort?: (abortFn: () => void) => void;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  if (input.signal?.aborted) {
    const abortErr = new Error("Turno interrompido.");
    abortErr.name = "AbortError";
    return Promise.reject(abortErr);
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProviderProcess(input.executable, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: !input.interactiveWindow,
    });
    child.stdin.on("error", () => {});

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    let watchdog: ReturnType<typeof createTurnStallWatchdog> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      watchdog?.stop();
      if (input.signal && onSignalAbort) {
        input.signal.removeEventListener("abort", onSignalAbort);
      }
    };

    const killChildSafely = () => {
      try {
        child.stdin.end();
        child.kill();
      } catch {
        // ignora
      }
    };

    const onSignalAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      killChildSafely();
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      rejectPromise(abortErr);
    };

    if (input.signal) {
      input.signal.addEventListener("abort", onSignalAbort, { once: true });
    }

    input.onRegisterAbort?.(() => {
      if (finished) return;
      finished = true;
      cleanup();
      killChildSafely();
      rejectPromise(new Error("Autenticação no navegador cancelada pelo usuário."));
    });

    if (input.stallMode) {
      watchdog = createTurnStallWatchdog({
        stallMs: input.timeoutMs,
        toolStallMs: input.toolStallMs ?? DEFAULT_CLI_TOOL_STALL_MS,
        isToolRunning: () => hasActiveMcpToolForAgent(input.agentId),
        getExternalActivityAt: () => getLastMcpActivityAt(input.agentId),
        onStall: ({ limitMs }) => {
          if (finished) return;
          finished = true;
          cleanup();
          killChildSafely();
          rejectPromise(
            new Error(
              `Tempo limite (${Math.round(limitMs / 1000)}s de silêncio) ao aguardar conclusão do processo.`
            )
          );
        },
      });
    } else {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup();
        killChildSafely();
        rejectPromise(
          new Error(`Tempo limite (${Math.round(input.timeoutMs / 1000)}s) ao aguardar conclusão do processo.`)
        );
      }, input.timeoutMs);
      timer.unref?.();
    }

    child.stdout.on("data", (chunk) => {
      watchdog?.touch();
      const str = chunk.toString("utf8");
      stdout += str;
      if (input.onOutputLine) {
        for (const l of str.split(/[\r\n]+/)) {
          if (l.trim()) input.onOutputLine(l);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      watchdog?.touch();
      const str = chunk.toString("utf8");
      stderr += str;
      if (input.onOutputLine) {
        for (const l of str.split(/[\r\n]+/)) {
          if (l.trim()) input.onOutputLine(l);
        }
      }
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      rejectPromise(err);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolvePromise({ code, stdout, stderr });
    });

    if (input.stdinText !== undefined) {
      child.stdin.write(input.stdinText);
    }
    if (!input.keepStdinOpen) {
      child.stdin.end();
    }
  });
}

export function openExternalUrlIfNeeded(url: string): void {
  if (process.env.CRIATIVO_ISOLATED_SERVER === "1") return;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  try {
    if (process.platform === "win32") {
      // rundll32 passa a URL inteira por argv sem cmd.exe cortar query params no '&'
      spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore", shell: false }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore", shell: false }).unref();
    }
  } catch {
    // fallback silencioso caso ambiente headless bloqueie abertura do navegador
  }
}

export function createBrowserCaptureShim(onUrl: (url: string) => void): {
  commandPath: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "criativo-oauth-browser-"));
  const pageFile = join(dir, "page");
  const isWin = process.platform === "win32";
  const commandPath = join(dir, isWin ? "browser.cmd" : "browser.sh");

  if (isWin) {
    writeFileSync(
      commandPath,
      '@echo off\r\nsetlocal EnableDelayedExpansion\r\nset "address=%~1"\r\n>>"%~dp0page" echo(!address!\r\n',
      "utf8"
    );
  } else {
    writeFileSync(
      commandPath,
      `#!/bin/sh\nprintf '%s\\n' "$1" >> '${pageFile.replaceAll("'", "'\\''")}'\n`,
      "utf8"
    );
    chmodSync(commandPath, 0o700);
  }

  let handled = false;
  const poll = setInterval(() => {
    if (handled || !existsSync(pageFile)) return;
    try {
      const content = readFileSync(pageFile, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const candidate = rawLine.trim();
        if (!candidate) continue;
        try {
          const parsed = new URL(candidate);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            handled = true;
            clearInterval(poll);
            onUrl(parsed.toString());
            return;
          }
        } catch {
          // ignora linha inválida
        }
      }
    } catch {
      // ignora leitura concorrente
    }
  }, 200);
  poll.unref?.();

  return {
    commandPath,
    cleanup: () => {
      clearInterval(poll);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignora erro de remoção temporária
      }
    },
  };
}

export interface CliServiceRuntimeContext {
  workspaceCwd: string;
  accountsRootDir: string;
  appDataDir?: string;
  fetchImpl: typeof fetch;
  pendingSignInAbort: Map<"claude" | "openai", () => void>;
  pendingLoopbackTarget: Map<"claude" | "openai", { host: string; port: number }>;
  dynamicModelsCache: Map<"claude" | "openai", { expiresAt: number; modelos: ModeloProvedorInfo[] }>;
  accountsQuotaCache: Map<string, { expiresAt: number; grupos: GrupoCotaConta[] }>;
  getMcpConfigResolver: () => ((agentId?: string | null) => Record<string, unknown> | null) | undefined;
  cancelPendingSignIn: (provedor: "claude" | "openai") => boolean;
  getStoredRecords: () => CliAccountRecord[];
  saveStoredRecords: (records: CliAccountRecord[]) => void;
  getPoolConfig: (provedor: "claude" | "openai") => PoolContasConfig | null;
  listAccounts: (provedor: "claude" | "openai") => ContaProvedorInfo[];
  invalidateModelCache: (provedor?: "claude" | "openai") => void;
  invalidateQuotaCache: (provedor?: "claude" | "openai") => void;
  listAccountsWithQuotas: (provedor: "claude" | "openai", forceRefresh?: boolean) => Promise<ContaProvedorInfo[]>;
  registerLoopbackTargetFromAuthUrl: (provedor: "claude" | "openai", rawUrl: string) => void;
}
