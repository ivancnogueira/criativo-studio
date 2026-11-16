import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { FetchLike } from "./provider-interface.ts";

export interface McpServerConfig {
  mcp_id: string;
  nome: string;
  comando: string;
  args: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "http";
  endpointUrl?: string;
}

interface JsonRpcResponse {
  id?: string | number;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

/**
 * Cliente MCP (Model Context Protocol) compatível com servidores STDIO e HTTP JSON-RPC 2.0.
 * Permite descobrir ferramentas externas e expô-las dinamicamente aos 15 agentes.
 */
export class McpClient {
  private readonly config: McpServerConfig;
  private readonly fetchFn: FetchLike;
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private readonly pending = new Map<
    string,
    { resolve: (val: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();
  private discoveredTools: ToolDefinition[] = [];

  constructor(config: McpServerConfig, fetchImpl?: FetchLike) {
    this.config = config;
    this.fetchFn = fetchImpl ?? fetch;
  }

  public get serverId(): string {
    return this.config.mcp_id;
  }

  public get tools(): ToolDefinition[] {
    return this.discoveredTools;
  }

  /**
   * Inicializa a conexão MCP e executa handshake `initialize` + `tools/list`.
   */
  public async connect(): Promise<ToolDefinition[]> {
    const isHttp =
      this.config.transport === "http" ||
      Boolean(this.config.endpointUrl) ||
      this.config.comando.startsWith("http://") ||
      this.config.comando.startsWith("https://");

    if (!isHttp && !this.process) {
      this.startStdioProcess();
    }

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "criativo-ai-studio-online", version: "1.0.0" },
    });

    const listResult = await this.request("tools/list", {});
    const rawTools = (listResult.tools ?? []) as Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;

    this.discoveredTools = rawTools.map((t) => ({
      name: `mcp_${this.config.mcp_id}_${t.name}`,
      description: t.description ?? `Ferramenta MCP (${this.config.nome})`,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    }));

    return this.discoveredTools;
  }

  private startStdioProcess(): void {
    const child = spawn(this.config.comando, this.config.args, {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined) {
            const waiter = this.pending.get(String(msg.id));
            if (waiter) {
              this.pending.delete(String(msg.id));
              if (msg.error) {
                waiter.reject(new Error(msg.error.message ?? "Erro JSON-RPC MCP"));
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

    child.on("error", (err) => {
      for (const [, waiter] of this.pending) {
        waiter.reject(err);
      }
      this.pending.clear();
    });

    child.on("exit", () => {
      this.process = null;
    });

    this.process = child;
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

    const httpUrl =
      this.config.endpointUrl ??
      (this.config.comando.startsWith("http") ? this.config.comando : null);

    if (httpUrl) {
      const response = await this.fetchFn(httpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rpcBody),
      });
      const payload = (await response.json()) as JsonRpcResponse;
      if (payload.error) {
        throw new Error(payload.error.message ?? `Erro MCP HTTP em ${method}`);
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
      }, 15_000);

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolvePromise(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(err);
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
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.pending.clear();
  }
}

/**
 * Carrega servidores MCP ativos persistidos em `projecao_mcp_servidores`.
 */
export function loadConfiguredMcpServers(db: CriativoDatabase): McpServerConfig[] {
  const rows = db.connection
    .prepare(`SELECT * FROM projecao_mcp_servidores WHERE ativo = 1;`)
    .all() as unknown as Array<{
    mcp_id: string;
    nome: string;
    comando: string;
    args_json: string;
    env_json: string;
  }>;

  return rows.map((row) => ({
    mcp_id: row.mcp_id,
    nome: row.nome,
    comando: row.comando,
    args: JSON.parse(row.args_json) as string[],
    env: JSON.parse(row.env_json) as Record<string, string>,
  }));
}
