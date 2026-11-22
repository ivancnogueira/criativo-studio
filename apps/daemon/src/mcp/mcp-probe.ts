import {
  mcpConfigErrors,
  normalizeMcpConfig,
  type McpProbeResultado,
  type McpServidorConfig,
} from "@criativo/contracts";
import {
  collectSensitiveSecrets,
  redactMcpSecrets,
} from "./mcp-redaction.ts";
import { probeStdioServer } from "./mcp-probe-stdio.ts";
import { probeHttpServer } from "./mcp-probe-http.ts";
import {
  type McpProbeOptions,
  MCP_PROBE_TIMEOUT_MS,
  MCP_STDIO_PROBE_TIMEOUT_MS,
} from "./mcp-probe-helpers.ts";

export * from "./mcp-probe-helpers.ts";
export * from "./mcp-probe-oauth.ts";
export * from "./mcp-probe-stdio.ts";
export * from "./mcp-probe-http.ts";

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

