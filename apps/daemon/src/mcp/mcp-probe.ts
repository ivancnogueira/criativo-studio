import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import {
  mcpConfigErrors,
  normalizeMcpConfig,
  type McpOAuthMetadataSummary,
  type McpProbeResultado,
  type McpServidorConfig,
} from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { collectSensitiveSecrets, redactMcpSecrets } from "./mcp-redaction.ts";

export const MCP_PROBE_TIMEOUT_MS = 30_000;
export const MCP_STDIO_PROBE_TIMEOUT_MS = 60_000;
export const MAX_CAPTURED_TOOLS = 50;
const STDIO_KILL_GRACE_MS = 1_500;
const MAX_STDERR_BYTES = 16 * 1024;

export interface McpProbeOptions {
  accessToken?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  extraSecrets?: Iterable<string>;
  signal?: AbortSignal;
}

export interface OAuthDiscoveryResult extends McpOAuthMetadataSummary {
  resourceMetadataUrl: string | null;
  authorizationServerUrl: string | null;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
}

function isLoopbackHostname(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1";
}

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map((n) => Number(n));
  if (octets.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!clean) return true;
  if (isLoopbackHostname(clean)) return true;
  if (isPrivateIpv4(clean)) return true;
  if (clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd") || clean === "::") {
    return true;
  }
  return false;
}

/**
 * Valida URL de servidor MCP ou endpoint OAuth evitando esquemas perigosos e SSRF em metadados externos.
 */
export function validateSafeHttpUrl(rawUrl: string, allowLoopbackHttp: boolean): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const local = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol === "http:" && !(allowLoopbackHttp && local)) {
    return null;
  }

  if (!allowLoopbackHttp && isPrivateHostname(parsed.hostname)) {
    return null;
  }

  return parsed;
}

export function stripUrlFragment(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function extractResourceMetadataFromHeader(wwwAuthenticateHeader?: string | null): string | null {
  if (!wwwAuthenticateHeader) return null;
  const quoted = /\bresource_metadata="([^"]+)"/i.exec(wwwAuthenticateHeader);
  if (quoted?.[1]) return quoted[1].trim();
  const unquoted = /\bresource_metadata=([^\s,;]+)/i.exec(wwwAuthenticateHeader);
  return unquoted?.[1]?.trim() ?? null;
}

function hasManualCredentialHeader(config: McpServidorConfig): boolean {
  return Object.entries(config.headers ?? {}).some(
    ([key, value]) =>
      /^(?:authorization|x-api-key|api-key|x-auth-token|x-access-token)$/i.test(key.trim()) &&
      value.trim().length > 0
  );
}

async function fetchJsonSafe(
  url: string,
  fetchFn: FetchLike,
  signal: AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json") && contentType.trim().length > 0) {
      // Alguns servidores devolvem JSON com text/plain; tentamos parsear mesmo assim se não for HTML
      if (contentType.toLowerCase().includes("html")) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
    }
    const payload = (await res.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Descobre metadados OAuth 2.1 conforme RFC 9728 (Protected Resource Metadata)
 * e RFC 8414 (Authorization Server Metadata), validando HTTPS e bloqueando SSRF.
 */
export async function discoverOAuthMetadata(
  resourceUrl: string,
  wwwAuthenticateHeader?: string | null,
  fetchImpl?: FetchLike
): Promise<OAuthDiscoveryResult> {
  const fetchFn = fetchImpl ?? fetch;
  const cleanResource = stripUrlFragment(resourceUrl);
  let parsedResource: URL;
  try {
    parsedResource = new URL(cleanResource);
  } catch {
    throw new Error("URL de servidor MCP inválida para descoberta OAuth.");
  }

  if (parsedResource.protocol !== "http:" && parsedResource.protocol !== "https:") {
    throw new Error("Protocolo inválido para descoberta OAuth (permitido apenas http/https).");
  }

  const allowLoopbackHttp = isLoopbackHostname(parsedResource.hostname);
  if (parsedResource.protocol === "http:" && !allowLoopbackHttp) {
    throw new Error("Servidores MCP OAuth externos exigem HTTPS.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timeout na descoberta OAuth")), 10_000);
  timer.unref?.();

  try {
    const headerMetadataRaw = extractResourceMetadataFromHeader(wwwAuthenticateHeader);
    const prCandidates: string[] = [];

    if (headerMetadataRaw) {
      try {
        const resolved = new URL(headerMetadataRaw, parsedResource.origin).toString();
        if (validateSafeHttpUrl(resolved, allowLoopbackHttp)) {
          prCandidates.push(resolved);
        }
      } catch {
        // ignora URL inválida no cabeçalho
      }
    }

    const pathname = parsedResource.pathname.replace(/\/+$/, "");
    if (pathname && pathname !== "/") {
      prCandidates.push(`${parsedResource.origin}/.well-known/oauth-protected-resource${pathname}`);
    }
    prCandidates.push(`${parsedResource.origin}/.well-known/oauth-protected-resource`);

    let resourceMetadataUrl: string | null = null;
    let protectedResourceDoc: Record<string, unknown> | null = null;

    for (const candidate of Array.from(new Set(prCandidates))) {
      if (!validateSafeHttpUrl(candidate, allowLoopbackHttp)) continue;
      const doc = await fetchJsonSafe(candidate, fetchFn, controller.signal);
      if (doc) {
        resourceMetadataUrl = candidate;
        protectedResourceDoc = doc;
        break;
      }
    }

    const authServersRaw = Array.isArray(protectedResourceDoc?.authorization_servers)
      ? (protectedResourceDoc.authorization_servers as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        )
      : [];

    let authServerUrl: string = parsedResource.origin;
    for (const candidateAuth of authServersRaw) {
      const valid = validateSafeHttpUrl(candidateAuth.trim(), allowLoopbackHttp);
      if (valid) {
        authServerUrl = valid.toString().replace(/\/+$/, "");
        break;
      }
    }

    const parsedAuth = new URL(authServerUrl);
    const authPath = parsedAuth.pathname.replace(/\/+$/, "");
    const asCandidates: string[] = [];
    if (authPath && authPath !== "/") {
      asCandidates.push(`${parsedAuth.origin}/.well-known/oauth-authorization-server${authPath}`);
      asCandidates.push(`${parsedAuth.origin}${authPath}/.well-known/oauth-authorization-server`);
    }
    asCandidates.push(`${parsedAuth.origin}/.well-known/oauth-authorization-server`);
    asCandidates.push(`${parsedAuth.origin}/.well-known/openid-configuration`);

    let authDoc: Record<string, unknown> | null = null;
    for (const candidate of Array.from(new Set(asCandidates))) {
      if (!validateSafeHttpUrl(candidate, allowLoopbackHttp)) continue;
      const doc = await fetchJsonSafe(candidate, fetchFn, controller.signal);
      if (doc && (typeof doc.authorization_endpoint === "string" || typeof doc.token_endpoint === "string")) {
        authDoc = doc;
        break;
      }
    }

    const validateEndpoint = (val: unknown): string | null => {
      if (typeof val !== "string" || !val.trim()) return null;
      const valid = validateSafeHttpUrl(val.trim(), allowLoopbackHttp);
      return valid ? valid.toString() : null;
    };

    const scopesFromPr = Array.isArray(protectedResourceDoc?.scopes_supported)
      ? (protectedResourceDoc.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const scopesFromAs = Array.isArray(authDoc?.scopes_supported)
      ? (authDoc.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : [];

    const codeChallengeMethods = Array.isArray(authDoc?.code_challenge_methods_supported)
      ? (authDoc.code_challenge_methods_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : [];

    return {
      resource:
        typeof protectedResourceDoc?.resource === "string"
          ? protectedResourceDoc.resource
          : cleanResource,
      authorizationServer:
        typeof authDoc?.issuer === "string" ? authDoc.issuer : authServerUrl,
      authorizationServerUrl: authServerUrl,
      resourceMetadataUrl,
      authorizationEndpoint: validateEndpoint(authDoc?.authorization_endpoint),
      tokenEndpoint: validateEndpoint(authDoc?.token_endpoint),
      registrationEndpoint: validateEndpoint(authDoc?.registration_endpoint),
      revocationEndpoint: validateEndpoint(authDoc?.revocation_endpoint),
      scopesSupported: scopesFromPr.length > 0 ? scopesFromPr : scopesFromAs,
      codeChallengeMethodsSupported: codeChallengeMethods,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseSseJsonRpcMessages(rawText: string): JsonRpcEnvelope[] {
  const results: JsonRpcEnvelope[] = [];
  const blocks = rawText.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            results.push(item as JsonRpcEnvelope);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        results.push(parsed as JsonRpcEnvelope);
      }
    } catch {
      // ignora blocos SSE que não sejam JSON-RPC
    }
  }

  return results;
}

export function extractSseEndpointEvent(rawChunk: string): string | null {
  const blocks = rawChunk.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (eventName === "endpoint" && dataLines.length > 0) {
      return dataLines.join("\n").trim();
    }
  }
  return null;
}

function expandHomeDirectory(inputPath: string): string {
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

async function terminateChildCleanly(child: ChildProcessWithoutNullStreams): Promise<void> {
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

async function probeStdioServer(
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

async function readHttpJsonRpcEnvelope(
  response: Response,
  expectedId: string
): Promise<JsonRpcEnvelope> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const rawBody = await response.text();

  if (contentType.includes("text/event-stream") || (!rawBody.trim().startsWith("{") && rawBody.includes("data:"))) {
    const messages = parseSseJsonRpcMessages(rawBody);
    const matched =
      messages.find((m) => m.id !== undefined && String(m.id) === expectedId) ??
      messages.find((m) => m.result !== undefined || m.error !== undefined);
    if (!matched) {
      throw new Error("Stream SSE recebido sem resposta JSON-RPC válida.");
    }
    return matched;
  }

  if (!rawBody.trim()) {
    return {};
  }

  const parsed = JSON.parse(rawBody) as unknown;
  if (Array.isArray(parsed)) {
    const matched = (parsed as JsonRpcEnvelope[]).find(
      (m) => m.id !== undefined && String(m.id) === expectedId
    );
    return matched ?? ((parsed[0] as JsonRpcEnvelope) ?? {});
  }
  return (parsed as JsonRpcEnvelope) ?? {};
}

async function probeHttpServer(
  config: McpServidorConfig,
  secrets: string[],
  timeoutMs: number,
  options: McpProbeOptions
): Promise<McpProbeResultado> {
  const startedAt = Date.now();
  const rawUrl = config.url ?? "";
  const targetUrl = stripUrlFragment(rawUrl);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: "URL do servidor MCP HTTP inválida.",
      durationMs: Date.now() - startedAt,
    };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: "O transporte HTTP MCP aceita apenas os protocolos http:// ou https://.",
      durationMs: Date.now() - startedAt,
    };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s) excedido na sondagem HTTP.`));
  }, timeoutMs);
  timer.unref?.();

  const onExternalAbort = () => controller.abort(new Error("Sondagem MCP cancelada."));
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const baseHeaders: Record<string, string> = {
    ...(config.headers ?? {}),
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (options.accessToken) {
    baseHeaders.Authorization = `Bearer ${options.accessToken}`;
  }

  let sessionId: string | null = null;

  const sendPostRpc = async (
    urlToCall: string,
    method: string,
    params: Record<string, unknown>,
    isNotification = false
  ): Promise<{ response: Response; envelope: JsonRpcEnvelope | null }> => {
    const id = isNotification ? undefined : randomUUID();
    const body = isNotification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id, method, params };
    const headers: Record<string, string> = { ...baseHeaders };
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const response = await fetchFn(urlToCall, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const respSession = response.headers.get("mcp-session-id");
    if (respSession && !sessionId) {
      sessionId = respSession;
    }

    if (response.status === 401 || response.status === 403) {
      return { response, envelope: null };
    }

    if (!response.ok) {
      return { response, envelope: null };
    }

    if (isNotification || response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => {});
      return { response, envelope: null };
    }

    const envelope = await readHttpJsonRpcEnvelope(response, String(id));
    return { response, envelope };
  };

  try {
    let activeEndpoint = targetUrl;
    let initRes = await sendPostRpc(activeEndpoint, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
    });

    // Fallback para HTTP+SSE legado (2024-11-05) quando POST inicial retorna 404/405
    if (initRes.response.status === 404 || initRes.response.status === 405) {
      await initRes.response.body?.cancel().catch(() => {});
      const sseEndpoint = await tryLegacySseHandshakeEndpoint(
        targetUrl,
        baseHeaders,
        fetchFn,
        controller.signal
      );
      if (sseEndpoint) {
        activeEndpoint = sseEndpoint;
        initRes = await sendPostRpc(activeEndpoint, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
        });
      }
    }

    if (initRes.response.status === 401 || initRes.response.status === 403) {
      const wwwAuth = initRes.response.headers.get("www-authenticate");
      await initRes.response.body?.cancel().catch(() => {});
      const discovery = await discoverOAuthMetadata(targetUrl, wwwAuth, fetchFn).catch(() => null);
      const hasOAuthMetadata = Boolean(
        discovery?.authorizationEndpoint || discovery?.tokenEndpoint || /\bbearer\b/i.test(wwwAuth ?? "")
      );

      if (hasManualCredentialHeader(config) && !hasOAuthMetadata) {
        return {
          status: "needs_key",
          toolCount: 0,
          toolNames: [],
          needs: "key",
          error: `Credencial rejeitada pelo servidor MCP (HTTP ${initRes.response.status}). Verifique a chave informada nos cabeçalhos.`,
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        status: "needs_sign_in",
        toolCount: 0,
        toolNames: [],
        needs: "sign_in",
        authUrl: discovery?.authorizationEndpoint ?? undefined,
        error: `Autenticação OAuth necessária no navegador (HTTP ${initRes.response.status}).`,
        durationMs: Date.now() - startedAt,
      };
    }

    if (!initRes.response.ok) {
      const errText = await initRes.response.text().catch(() => "");
      return {
        status: "failed",
        toolCount: 0,
        toolNames: [],
        needs: null,
        error: redactMcpSecrets(
          `Servidor MCP HTTP respondeu ${initRes.response.status}${errText ? `: ${errText.slice(0, 300)}` : ""}`,
          secrets
        ),
        durationMs: Date.now() - startedAt,
      };
    }

    if (initRes.envelope?.error) {
      const rpcErr = initRes.envelope.error;
      if (rpcErr.code === -32001) {
        const discovery = await discoverOAuthMetadata(targetUrl, undefined, fetchFn).catch(() => null);
        return {
          status: "needs_sign_in",
          toolCount: 0,
          toolNames: [],
          needs: "sign_in",
          authUrl: discovery?.authorizationEndpoint ?? undefined,
          error: redactMcpSecrets(rpcErr.message ?? "Autenticação OAuth necessária.", secrets),
          durationMs: Date.now() - startedAt,
        };
      }
      return {
        status: "failed",
        toolCount: 0,
        toolNames: [],
        needs: null,
        error: redactMcpSecrets(rpcErr.message ?? "Erro JSON-RPC no initialize MCP.", secrets),
        durationMs: Date.now() - startedAt,
      };
    }

    await sendPostRpc(activeEndpoint, "notifications/initialized", {}, true).catch(() => {});

    const toolNames: string[] = [];
    let toolCount = 0;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const listRes = await sendPostRpc(activeEndpoint, "tools/list", cursor ? { cursor } : {});
      if (listRes.response.status === 401 || listRes.response.status === 403) {
        const wwwAuth = listRes.response.headers.get("www-authenticate");
        await listRes.response.body?.cancel().catch(() => {});
        const discovery = await discoverOAuthMetadata(targetUrl, wwwAuth, fetchFn).catch(() => null);
        return {
          status: "needs_sign_in",
          toolCount: 0,
          toolNames: [],
          needs: "sign_in",
          authUrl: discovery?.authorizationEndpoint ?? undefined,
          error: `Autenticação OAuth necessária ao listar ferramentas (HTTP ${listRes.response.status}).`,
          durationMs: Date.now() - startedAt,
        };
      }

      if (!listRes.response.ok) {
        const errText = await listRes.response.text().catch(() => "");
        return {
          status: "failed",
          toolCount: 0,
          toolNames: [],
          needs: null,
          error: redactMcpSecrets(
            `Falha em tools/list (HTTP ${listRes.response.status})${errText ? `: ${errText.slice(0, 300)}` : ""}`,
            secrets
          ),
          durationMs: Date.now() - startedAt,
        };
      }

      if (listRes.envelope?.error) {
        return {
          status: "failed",
          toolCount: 0,
          toolNames: [],
          needs: null,
          error: redactMcpSecrets(listRes.envelope.error.message ?? "Erro JSON-RPC em tools/list.", secrets),
          durationMs: Date.now() - startedAt,
        };
      }

      const result = listRes.envelope?.result ?? {};
      const tools = Array.isArray(result.tools) ? (result.tools as Array<{ name?: unknown }>) : [];
      for (const item of tools) {
        if (typeof item?.name === "string" && item.name.trim()) {
          toolCount += 1;
          if (toolNames.length < MAX_CAPTURED_TOOLS) {
            toolNames.push(item.name.trim().slice(0, 128));
          }
        }
      }

      const nextCursor =
        typeof result.nextCursor === "string" && result.nextCursor.trim()
          ? result.nextCursor
          : undefined;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    if (sessionId) {
      await fetchFn(activeEndpoint, {
        method: "DELETE",
        headers: { ...baseHeaders, "Mcp-Session-Id": sessionId },
        signal: AbortSignal.timeout(2_000),
      }).catch(() => {});
    }

    return {
      status: "passed",
      toolCount,
      toolNames,
      needs: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: redactMcpSecrets(message, secrets),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function tryLegacySseHandshakeEndpoint(
  baseUrl: string,
  baseHeaders: Record<string, string>,
  fetchFn: FetchLike,
  signal: AbortSignal
): Promise<string | null> {
  const sseAbort = new AbortController();
  const forwardAbort = () => sseAbort.abort();
  signal.addEventListener("abort", forwardAbort, { once: true });

  const localTimer = setTimeout(() => sseAbort.abort(), 5_000);
  localTimer.unref?.();

  try {
    const res = await fetchFn(baseUrl, {
      method: "GET",
      headers: {
        ...baseHeaders,
        Accept: "text/event-stream",
      },
      signal: sseAbort.signal,
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (buffer.length < 16 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const endpointRel = extractSseEndpointEvent(buffer);
        if (endpointRel) {
          return new URL(endpointRel, baseUrl).toString();
        }
      }
    } finally {
      reader.releaseLock();
      await res.body.cancel().catch(() => {});
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(localTimer);
    signal.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Inspeciona um servidor MCP (STDIO ou Streamable HTTP / SSE) retornando contagem e nomes
 * de até `50` ferramentas ou solicitando `needs_sign_in` em respostas 401/403 OAuth.
 */
export async function inspectMcpServer(
  config: Partial<McpServidorConfig>,
  options: McpProbeOptions = {}
): Promise<McpProbeResultado> {
  const normalized = normalizeMcpConfig(config);
  const secrets = collectSensitiveSecrets(normalized, [
    ...(options.extraSecrets ?? []),
    options.accessToken,
  ]);

  const errors = mcpConfigErrors(normalized);
  const firstError = errors.nome ?? errors.comando ?? errors.url ?? errors.acesso;
  if (firstError) {
    return {
      status: "failed",
      toolCount: 0,
      toolNames: [],
      needs: null,
      error: redactMcpSecrets(firstError, secrets),
      durationMs: 0,
    };
  }

  const defaultTimeout =
    normalized.transporte === "stdio" ? MCP_STDIO_PROBE_TIMEOUT_MS : MCP_PROBE_TIMEOUT_MS;
  const timeoutMs = options.timeoutMs ?? defaultTimeout;

  if (normalized.transporte === "stdio") {
    return await probeStdioServer(normalized, secrets, timeoutMs, options.signal);
  }

  return await probeHttpServer(normalized, secrets, timeoutMs, options);
}

/**
 * Sonda um servidor MCP (STDIO ou Streamable HTTP / SSE) e devolve o resultado estruturado.
 */
export async function testMcpServer(
  config: Partial<McpServidorConfig>,
  options: McpProbeOptions = {}
): Promise<McpProbeResultado> {
  return await inspectMcpServer(config, options);
}
