import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpAcessoAgentes, ToolDefinition } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import {
  buildStdioEnvironment,
  parseSseJsonRpcMessages,
  resolveExecutableCommand,
  stripUrlFragment,
} from "../../mcp/mcp-probe.ts";
import { collectSensitiveSecrets, redactMcpSecrets } from "../../mcp/mcp-redaction.ts";
import { sanitizeChildEnv } from "../sandbox/process-confinement.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import type { FetchLike } from "./provider-interface.ts";

export interface McpServerConfig {
  mcp_id: string;
  nome: string;
  comando: string;
  args: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "http";
  endpointUrl?: string;
  headers?: Record<string, string>;
  envPassthrough?: string[];
  workingDirectory?: string | null;
  acesso?: McpAcessoAgentes;
  origemAppSlug?: string | null;
  contaRotulo?: string | null;
}

export interface McpRawToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * Erro estruturado lançado quando um servidor MCP HTTP requer autenticação OAuth (`401`/`403`/`-32001`).
 */
export class McpAuthRequiredError extends Error {
  public readonly action = "sign_in" as const;
  public readonly status: number;
  public readonly wwwAuthenticate: string | null;

  constructor(
    message = "Autenticação OAuth necessária no navegador.",
    status = 401,
    wwwAuthenticate: string | null = null
  ) {
    super(message);
    this.name = "McpAuthRequiredError";
    this.status = status;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const STDIO_KILL_GRACE_MS = 1_500;
const MAX_STDERR_BYTES = 8 * 1024;

function expandHomeDir(p: string): string {
  const trimmed = p.trim();
  const homePattern = process.platform === "win32" ? /^~[/\\]/ : /^~\//;
  if (trimmed === "~") return homedir();
  if (homePattern.test(trimmed)) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

/**
 * Cliente MCP (Model Context Protocol) compatível com servidores STDIO e Streamable HTTP / SSE.
 * Permite descobrir ferramentas externas e expô-las dinamicamente aos agentes.
 */
export class McpClient {
  private readonly config: McpServerConfig;
  private readonly fetchFn: FetchLike;
  private runtimeHeaders: Record<string, string>;
  private sessionId: string | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<
    string,
    { resolve: (val: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();
  private discoveredTools: ToolDefinition[] = [];
  private discoveredRawTools: McpRawToolDefinition[] = [];

  constructor(config: McpServerConfig, fetchImpl?: FetchLike) {
    this.config = config;
    this.fetchFn = fetchImpl ?? fetch;
    this.runtimeHeaders = { ...(config.headers ?? {}) };
  }

  public get serverId(): string {
    return this.config.mcp_id;
  }

  public get tools(): ToolDefinition[] {
    return this.discoveredTools;
  }

  public get rawTools(): McpRawToolDefinition[] {
    return this.discoveredRawTools;
  }

  public setHeaders(headers: Record<string, string>): void {
    this.runtimeHeaders = { ...headers };
  }

  private collectSecrets(): string[] {
    return collectSensitiveSecrets({
      env: this.config.env ?? {},
      envPassthrough: this.config.envPassthrough ?? [],
      headers: this.runtimeHeaders,
      url: this.resolveHttpUrl(),
    });
  }

  private isHttpTransport(): boolean {
    return (
      this.config.transport === "http" ||
      Boolean(this.config.endpointUrl) ||
      this.config.comando.startsWith("http://") ||
      this.config.comando.startsWith("https://")
    );
  }

  private resolveHttpUrl(): string | null {
    const raw =
      this.config.endpointUrl ??
      (this.config.comando.startsWith("http://") || this.config.comando.startsWith("https://")
        ? this.config.comando
        : null);
    return raw ? stripUrlFragment(raw) : null;
  }

  /**
   * Inicializa a conexão MCP e executa handshake `initialize` + `tools/list`.
   */
  public async connect(): Promise<ToolDefinition[]> {
    const isHttp = this.isHttpTransport();

    if (!isHttp && !this.process) {
      this.startStdioProcess();
    }

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
    });

    await this.sendNotification("notifications/initialized", {}).catch(() => {});

    const rawCollected: McpRawToolDefinition[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const listResult = await this.request("tools/list", cursor ? { cursor } : {});
      const pageTools = (listResult.tools ?? []) as Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
      for (const tool of pageTools) {
        if (typeof tool?.name === "string" && tool.name.trim()) {
          rawCollected.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      }
      const nextCursor =
        typeof listResult.nextCursor === "string" && listResult.nextCursor.trim()
          ? listResult.nextCursor
          : undefined;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    this.discoveredRawTools = rawCollected;
    this.discoveredTools = rawCollected.map((t) => ({
      name: `mcp_${this.config.mcp_id}_${t.name}`,
      description: t.description ?? `Ferramenta MCP (${this.config.nome})`,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    }));

    return this.discoveredTools;
  }

  private startStdioProcess(): void {
    const env = buildStdioEnvironment({
      env: this.config.env ?? {},
      envPassthrough: this.config.envPassthrough ?? [],
    } as never);

    const resolvedCommand = resolveExecutableCommand(this.config.comando, env.PATH) ?? this.config.comando;
    const isWinBatch = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand);
    const spawnCmd = isWinBatch ? process.env.ComSpec || "cmd.exe" : resolvedCommand;
    const spawnArgs = isWinBatch
      ? ["/d", "/s", "/c", resolvedCommand, ...this.config.args]
      : this.config.args;

    let cwd: string | undefined;
    if (this.config.workingDirectory && this.config.workingDirectory.trim()) {
      const expanded = resolve(expandHomeDir(this.config.workingDirectory));
      if (existsSync(expanded)) {
        cwd = expanded;
      }
    }

    const { env: confinedBaseEnv } = sanitizeChildEnv({
      extraEnv: env,
      passthroughKeys: this.config.envPassthrough ?? [],
    });

    const child = spawn(spawnCmd, spawnArgs, {
      cwd,
      env: confinedBaseEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    this.stderrBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined && msg.id !== null) {
            const waiter = this.pending.get(String(msg.id));
            if (waiter) {
              this.pending.delete(String(msg.id));
              if (msg.error) {
                const msgText = redactMcpSecrets(
                  msg.error.message ?? "Erro JSON-RPC MCP",
                  this.collectSecrets()
                );
                waiter.reject(new Error(msgText));
              } else {
                waiter.resolve(msg.result ?? {});
              }
            }
          }
        } catch {
          // Ignora linhas de log não-JSON no stdout
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (this.stderrBuffer.length < MAX_STDERR_BYTES) {
        this.stderrBuffer += chunk.toString("utf8");
        if (this.stderrBuffer.length > MAX_STDERR_BYTES) {
          this.stderrBuffer = this.stderrBuffer.slice(0, MAX_STDERR_BYTES);
        }
      }
    });

    child.on("error", (err) => {
      const safeErr = new Error(redactMcpSecrets(err.message, this.collectSecrets()));
      for (const [, waiter] of this.pending) {
        waiter.reject(safeErr);
      }
      this.pending.clear();
    });

    child.on("exit", (code, signal) => {
      this.process = null;
      if (this.pending.size > 0) {
        const stderrHint = this.stderrBuffer.trim()
          ? ` (${this.stderrBuffer.trim()})`
          : "";
        const err = new Error(
          redactMcpSecrets(
            `Processo MCP '${this.config.mcp_id}' encerrou (código=${code ?? "null"}, sinal=${signal ?? "none"})${stderrHint}.`,
            this.collectSecrets()
          )
        );
        for (const [, waiter] of this.pending) {
          waiter.reject(err);
        }
        this.pending.clear();
      }
    });

    this.process = child;
  }

  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const rpcBody = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const httpUrl = this.resolveHttpUrl();
    if (httpUrl) {
      const headers: Record<string, string> = {
        ...this.runtimeHeaders,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.sessionId) {
        headers["Mcp-Session-Id"] = this.sessionId;
      }
      const res = await this.fetchFn(httpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(rpcBody),
      });
      await res.body?.cancel().catch(() => {});
      return;
    }

    if (this.process) {
      this.process.stdin.write(`${JSON.stringify(rpcBody)}\n`);
    }
  }

  public async request(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = randomUUID();
    const rpcBody = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const secrets = this.collectSecrets();
    const httpUrl = this.resolveHttpUrl();

    if (httpUrl) {
      const headers: Record<string, string> = {
        ...this.runtimeHeaders,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.sessionId) {
        headers["Mcp-Session-Id"] = this.sessionId;
      }

      const response = await this.fetchFn(httpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(rpcBody),
      });

      const respSessionId = response.headers.get("mcp-session-id");
      if (respSessionId) {
        this.sessionId = respSessionId;
      }

      if (response.status === 401 || response.status === 403) {
        const wwwAuth = response.headers.get("www-authenticate");
        await response.body?.cancel().catch(() => {});
        throw new McpAuthRequiredError(
          `Autenticação OAuth necessária no navegador para '${this.config.nome}' (HTTP ${response.status}).`,
          response.status,
          wwwAuth
        );
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(
          redactMcpSecrets(
            `Erro HTTP ${response.status} em '${method}'${errText ? `: ${errText.slice(0, 400)}` : ""}`,
            secrets
          )
        );
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const rawText = await response.text();
      let payload: JsonRpcResponse = {};

      if (
        contentType.includes("text/event-stream") ||
        (!rawText.trim().startsWith("{") && !rawText.trim().startsWith("[") && rawText.includes("data:"))
      ) {
        const sseMessages = parseSseJsonRpcMessages(rawText);
        payload =
          sseMessages.find((m) => m.id !== undefined && String(m.id) === id) ??
          sseMessages.find((m) => m.result !== undefined || m.error !== undefined) ??
          {};
      } else if (rawText.trim().length > 0) {
        const parsed = JSON.parse(rawText) as unknown;
        if (Array.isArray(parsed)) {
          payload =
            (parsed as JsonRpcResponse[]).find(
              (m) => m.id !== undefined && String(m.id) === id
            ) ?? ((parsed[0] as JsonRpcResponse) ?? {});
        } else {
          payload = (parsed as JsonRpcResponse) ?? {};
        }
      }

      if (payload.error) {
        const errMessage = redactMcpSecrets(
          payload.error.message ?? `Erro MCP HTTP em ${method}`,
          secrets
        );
        if (payload.error.code === -32001) {
          throw new McpAuthRequiredError(errMessage, 401);
        }
        throw new Error(errMessage);
      }

      return payload.result ?? {};
    }

    if (!this.process) {
      throw new Error(`Processo MCP '${this.config.mcp_id}' não inicializado.`);
    }

    return await new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timeout MCP na chamada '${method}'`));
      }, DEFAULT_RPC_TIMEOUT_MS);
      timer.unref?.();

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolvePromise(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(new Error(redactMcpSecrets(err.message, secrets)));
        },
      });

      this.process!.stdin.write(`${JSON.stringify(rpcBody)}\n`);
    });
  }

  public async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const prefix = `mcp_${this.config.mcp_id}_`;
    const remoteName = toolName.startsWith(prefix)
      ? toolName.slice(prefix.length)
      : toolName;

    return await this.request("tools/call", {
      name: remoteName,
      arguments: args,
    });
  }

  public close(): void {
    const child = this.process;
    this.process = null;
    this.pending.clear();

    if (child) {
      try {
        child.stdin.end();
      } catch {
        // ignora
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // ignora
      }
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignora
          }
        }
      }, STDIO_KILL_GRACE_MS);
      killTimer.unref?.();
    }
  }
}

interface RawMcpConfigRow {
  mcp_id: string;
  nome: string;
  transporte?: string | null;
  comando: string;
  args_json: string;
  env_json: string;
  env_passthrough_json?: string | null;
  working_directory?: string | null;
  url?: string | null;
  headers_json?: string | null;
  acesso_json?: string | null;
  origem_app_slug?: string | null;
  conta_rotulo?: string | null;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function resolveVaultReferences(
  record: Record<string, string>,
  vault?: VaultService
): Record<string, string> {
  if (!vault) return record;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string" && v.startsWith("vault://")) {
      out[k] = vault.getSecret(v.slice("vault://".length)) ?? "";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Carrega servidores MCP ativos persistidos em `projecao_mcp_servidores`,
 * lendo transporte STDIO/HTTP e todas as colunas expandidas mantendo retrocompatibilidade.
 */
export function loadConfiguredMcpServers(
  db: CriativoDatabase,
  vault?: VaultService
): McpServerConfig[] {
  const rows = db.connection
    .prepare(
      `SELECT * FROM projecao_mcp_servidores WHERE ativo = 1 ORDER BY posicao ASC, nome ASC;`
    )
    .all() as unknown as RawMcpConfigRow[];

  return rows.map((row) => {
    const args = safeJsonParse<string[]>(row.args_json, []);
    const envRaw = safeJsonParse<Record<string, string>>(row.env_json, {});
    const headersRaw = safeJsonParse<Record<string, string>>(row.headers_json, {});
    const envPassthrough = safeJsonParse<string[]>(row.env_passthrough_json, []);
    const acesso = safeJsonParse<McpAcessoAgentes>(row.acesso_json, {
      mode: "everyone",
      agentIds: [],
    });

    const isHttp =
      row.transporte === "http" ||
      (Boolean(row.url) && (!row.comando || row.comando.trim().length === 0));

    return {
      mcp_id: row.mcp_id,
      nome: row.nome,
      comando: row.comando,
      args: Array.isArray(args) ? args : [],
      env: resolveVaultReferences(envRaw, vault),
      transport: isHttp ? "http" : "stdio",
      endpointUrl: isHttp ? (row.url ?? undefined) : undefined,
      headers: resolveVaultReferences(headersRaw, vault),
      envPassthrough: Array.isArray(envPassthrough) ? envPassthrough : [],
      workingDirectory: row.working_directory ?? null,
      acesso: {
        mode: acesso?.mode === "agents" ? "agents" : "everyone",
        agentIds: Array.isArray(acesso?.agentIds) ? acesso.agentIds : [],
      },
      origemAppSlug: row.origem_app_slug ?? null,
      contaRotulo: row.conta_rotulo ?? null,
    };
  });
}
