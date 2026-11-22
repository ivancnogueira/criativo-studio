import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  statSync,
} from "node:fs";
import {
  homedir,
} from "node:os";
import {
  delimiter,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  type McpProbeResultado,
  type McpServidorConfig,
} from "@criativo/contracts";
import {
  redactMcpSecrets,
} from "./mcp-redaction.ts";
import { MAX_CAPTURED_TOOLS, STDIO_KILL_GRACE_MS, MAX_STDERR_BYTES, type JsonRpcEnvelope } from "./mcp-probe-helpers.ts";

export function expandHomeDirectory(inputPath: string): string {
  const trimmed = inputPath.trim();
  const homePattern = process.platform === "win32" ? /^~[/\\]/ : /^~\//;
  if (trimmed === "~") return homedir();
  if (homePattern.test(trimmed)) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/**
 * Resolve executável no PATH (incluindo extensões .cmd/.exe no Windows sem ativar shell arbitrário).
 */
export function resolveExecutableCommand(command: string, pathEnv?: string): string | null {
  const expanded = expandHomeDirectory(command);
  if (!expanded) return null;

  if (isAbsolute(expanded) || expanded.includes("/") || expanded.includes("\\")) {
    if (existsSync(expanded)) return expanded;
    if (process.platform === "win32") {
      const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean);
      for (const ext of exts) {
        const candidate = `${expanded}${ext.toLowerCase()}`;
        if (existsSync(candidate)) return candidate;
        const candidateUpper = `${expanded}${ext.toUpperCase()}`;
        if (existsSync(candidateUpper)) return candidateUpper;
      }
    }
    return null;
  }

  const dirs = (pathEnv ?? process.env.PATH ?? "")
    .split(delimiter)
    .map((d) => d.trim())
    .filter(Boolean);

  if (process.platform === "win32") {
    const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
      .split(";")
      .map((e) => e.trim())
      .filter(Boolean);
    const hasExt = /\.[a-z0-9]+$/i.test(expanded);
    for (const dir of dirs) {
      if (hasExt) {
        const full = join(dir, expanded);
        if (existsSync(full)) return full;
      } else {
        for (const ext of exts) {
          const full = join(dir, `${expanded}${ext.toLowerCase()}`);
          if (existsSync(full)) return full;
          const fullUpper = join(dir, `${expanded}${ext.toUpperCase()}`);
          if (existsSync(fullUpper)) return fullUpper;
        }
      }
    }
    return null;
  }

  for (const dir of dirs) {
    const full = join(dir, expanded);
    if (existsSync(full)) return full;
  }

  return expanded;
}

export function buildStdioEnvironment(config: McpServidorConfig): Record<string, string> {
  const env: Record<string, string> = {};
  const baseKeys =
    process.platform === "win32"
      ? ["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
      : ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "NODE_ENV"];

  for (const key of baseKeys) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }

  for (const passthroughKey of config.envPassthrough ?? []) {
    const val = process.env[passthroughKey];
    if (val !== undefined) {
      env[passthroughKey] = val;
    }
  }

  for (const [k, v] of Object.entries(config.env ?? {})) {
    env[k] = v;
  }

  return env;
}

export async function terminateChildCleanly(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolveStop) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolveStop();
    };

    child.once("exit", done);
    child.once("close", done);

    try {
      child.stdin.end();
    } catch {
      // ignora erro ao fechar stdin
    }

    try {
      child.kill("SIGTERM");
    } catch {
      done();
      return;
    }

    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignora falha se já encerrou
        }
      }
      done();
    }, STDIO_KILL_GRACE_MS);
    killTimer.unref?.();
  });
}

export async function probeStdioServer(
  config: McpServidorConfig,
  secrets: string[],
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<McpProbeResultado> {
  const startedAt = Date.now();
  let cwd: string | undefined;

  if (config.workingDirectory) {
    const expandedCwd = resolve(expandHomeDirectory(config.workingDirectory));
    if (!existsSync(expandedCwd) || !statSync(expandedCwd).isDirectory()) {
      return {
        status: "failed",
        toolCount: 0,
        toolNames: [],
        needs: null,
        error: redactMcpSecrets(`Diretório de trabalho inexistente: ${config.workingDirectory}`, secrets),
        durationMs: Date.now() - startedAt,
      };
    }
    cwd = expandedCwd;
  }

  const env = buildStdioEnvironment(config);
  const resolvedCommand = resolveExecutableCommand(config.comando, env.PATH);
  if (!resolvedCommand) {
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: redactMcpSecrets(`Comando executável não encontrado: ${config.comando}`, secrets),
      durationMs: Date.now() - startedAt,
    };
  }

  const isWinBatch = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand);
  const spawnCmd = isWinBatch ? process.env.ComSpec || "cmd.exe" : resolvedCommand;
  const spawnArgs = isWinBatch ? ["/d", "/s", "/c", resolvedCommand, ...config.args] : [...config.args];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(spawnCmd, spawnArgs, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: redactMcpSecrets(`Falha ao iniciar processo STDIO: ${msg}`, secrets),
      durationMs: Date.now() - startedAt,
    };
  }

  let stdoutBuffer = "";
  let stderrCaptured = "";
  const pending = new Map<
    string,
    { resolve: (val: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();

  let processExitedError: Error | null = null;

  const rejectAllPending = (err: Error) => {
    for (const [, waiter] of pending) {
      waiter.reject(err);
    }
    pending.clear();
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcEnvelope;
        if (msg.id !== undefined && msg.id !== null) {
          const waiter = pending.get(String(msg.id));
          if (waiter) {
            pending.delete(String(msg.id));
            if (msg.error) {
              waiter.reject(new Error(msg.error.message ?? "Erro JSON-RPC no servidor MCP STDIO."));
            } else {
              waiter.resolve(msg.result ?? {});
            }
          }
        }
      } catch {
        // Ignora logs não-JSON no stdout
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    if (stderrCaptured.length < MAX_STDERR_BYTES) {
      stderrCaptured += chunk.toString("utf8");
      if (stderrCaptured.length > MAX_STDERR_BYTES) {
        stderrCaptured = stderrCaptured.slice(0, MAX_STDERR_BYTES);
      }
    }
  });

  child.on("error", (err) => {
    processExitedError = err;
    rejectAllPending(err);
  });

  child.on("exit", (code, signal) => {
    const detail = stderrCaptured.trim()
      ? ` Saída stderr: ${stderrCaptured.trim()}`
      : "";
    const err = new Error(
      `Processo MCP STDIO encerrou inesperadamente (código=${code ?? "null"}, sinal=${signal ?? "none"}).${detail}`
    );
    processExitedError = err;
    rejectAllPending(err);
  });

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort(new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s) excedido na sondagem STDIO.`));
  }, timeoutMs);
  timeoutTimer.unref?.();

  const onExternalAbort = () => {
    controller.abort(new Error("Sondagem MCP cancelada."));
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const rpcRequest = (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (controller.signal.aborted) {
      return Promise.reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error("Sondagem MCP abortada.")
      );
    }
    if (processExitedError) {
      return Promise.reject(processExitedError);
    }
    const id = randomUUID();
    return new Promise((resolvePromise, rejectPromise) => {
      const onAbort = () => {
        pending.delete(id);
        rejectPromise(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error(`Timeout na chamada MCP '${method}'.`)
        );
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });

      pending.set(id, {
        resolve: (val) => {
          controller.signal.removeEventListener("abort", onAbort);
          resolvePromise(val);
        },
        reject: (err) => {
          controller.signal.removeEventListener("abort", onAbort);
          rejectPromise(err);
        },
      });

      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (writeErr) {
        controller.signal.removeEventListener("abort", onAbort);
        pending.delete(id);
        rejectPromise(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
      }
    });
  };

  try {
    await rpcRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
    });

    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    } catch {
      // ignora se stdin fechou logo após
    }

    const toolNames: string[] = [];
    let toolCount = 0;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const page = await rpcRequest("tools/list", cursor ? { cursor } : {});
      const tools = Array.isArray(page.tools) ? (page.tools as Array<{ name?: unknown }>) : [];
      for (const item of tools) {
        if (typeof item?.name === "string" && item.name.trim()) {
          toolCount += 1;
          if (toolNames.length < MAX_CAPTURED_TOOLS) {
            toolNames.push(item.name.trim().slice(0, 128));
          }
        }
      }
      const nextCursor = typeof page.nextCursor === "string" && page.nextCursor.trim() ? page.nextCursor : undefined;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return {
      status: "passed",
      toolCount,
      toolNames,
      needs: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const withStderr =
      stderrCaptured.trim() && !rawMsg.includes(stderrCaptured.trim())
        ? `${rawMsg} | stderr: ${stderrCaptured.trim()}`
        : rawMsg;
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: redactMcpSecrets(withStderr, secrets),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeoutTimer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    await terminateChildCleanly(child);
  }
}

