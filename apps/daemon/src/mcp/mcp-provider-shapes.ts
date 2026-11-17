import { createHash } from "node:crypto";
import type { McpServidorConfig, ToolDefinition } from "@criativo/contracts";
import { stripUrlFragment } from "./mcp-probe.ts";
import { isAgentAuthorizedForServer, type McpServerStore } from "./mcp-server-store.ts";

export const MAX_PROVIDER_TOOL_NAME_LENGTH = 64;

export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      type: "http";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    };

export interface ProxyRouteResolverResult {
  proxyUrl: string;
  proxyHeaderName: string;
  proxySecret: string;
}

export type AcpProxyResolver = (server: McpServidorConfig) => ProxyRouteResolverResult | null;

export interface DiscoveredMcpTool {
  mcpId: string;
  serverName?: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface QualifiedMcpToolOrigin {
  mcpId: string;
  remoteToolName: string;
}

const qualifiedToolOriginMap = new Map<string, QualifiedMcpToolOrigin>();

function sanitizeSlugSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

export function registerMcpToolOrigin(
  qualifiedName: string,
  mcpId: string,
  remoteToolName: string
): void {
  qualifiedToolOriginMap.set(qualifiedName, { mcpId, remoteToolName });
}

export function resolveMcpToolOrigin(qualifiedName: string): QualifiedMcpToolOrigin | null {
  return qualifiedToolOriginMap.get(qualifiedName) ?? null;
}

/**
 * Constrói nome qualificado seguro `mcp_<servidor>_<ferramenta>` respeitando o limite
 * de 64 caracteres exigido por OpenAI/Gemini/Claude e mantendo mapa reverso.
 */
export function buildSafeMcpToolName(mcpId: string, toolName: string): string {
  const safeServer = sanitizeSlugSegment(mcpId, "srv");
  const safeTool = sanitizeSlugSegment(toolName, "tool");
  const candidate = `mcp_${safeServer}_${safeTool}`;

  let finalName = candidate;
  if (candidate.length > MAX_PROVIDER_TOOL_NAME_LENGTH) {
    const hash6 = createHash("sha256")
      .update(`${mcpId}\u0000${toolName}`)
      .digest("hex")
      .slice(0, 6);
    const serverSlice = safeServer.slice(0, 18).replace(/_+$/g, "") || "srv";
    // "mcp_" (4) + serverSlice + "_" (1) + toolSlice + "_" (1) + hash6 (6) <= 64
    const remainingForTool = Math.max(
      4,
      MAX_PROVIDER_TOOL_NAME_LENGTH - (4 + serverSlice.length + 1 + 1 + 6)
    );
    const toolSlice = safeTool.slice(0, remainingForTool).replace(/_+$/g, "") || "tool";
    finalName = `mcp_${serverSlice}_${toolSlice}_${hash6}`.slice(0, MAX_PROVIDER_TOOL_NAME_LENGTH);
  }

  registerMcpToolOrigin(finalName, mcpId, toolName);
  return finalName;
}

/**
 * Retorna servidores ativos com segredos resolvidos e filtrados pelo escopo `acesso_json` do agente.
 */
export function usableMcpServers(
  store: McpServerStore,
  agentId?: string | null
): McpServidorConfig[] {
  const enabled = store.listServers({
    includeDisabled: false,
    resolveSecrets: true,
  });

  return enabled.filter((server) => isAgentAuthorizedForServer(server, agentId));
}

function resolveServerEnvironment(server: McpServidorConfig): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of server.envPassthrough ?? []) {
    const inherited = process.env[key];
    if (inherited !== undefined) {
      env[key] = inherited;
    }
  }
  for (const [key, value] of Object.entries(server.env ?? {})) {
    env[key] = value;
  }
  return env;
}

function buildUniqueAcpName(
  rawName: string,
  usedNames: Set<string>,
  fallbackId: string
): string {
  const base = sanitizeSlugSegment(rawName, sanitizeSlugSegment(fallbackId, "mcp_server")).slice(
    0,
    48
  );
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}_${Date.now()}`;
  usedNames.add(fallback);
  return fallback;
}

/**
 * Converte servidores MCP para o formato ACP (`AntigravityAcpService`, `OpenCodeLiveService`),
 * omitindo servidores STDIO que definam `workingDirectory` (D-06) e roteando servidores OAuth
 * pelo `McpOAuthProxy` loopback para não vazar tokens Bearer brutos a processos externos.
 */
export function toAcpMcpServers(
  servers: readonly McpServidorConfig[],
  proxyResolver?: AcpProxyResolver
): AcpMcpServer[] {
  const result: AcpMcpServer[] = [];
  const usedNames = new Set<string>();

  for (const server of servers) {
    if (!server.ativo) continue;

    if (server.transporte === "stdio") {
      // Invariante D-06: sessões ACP externas não suportam `workingDirectory` em STDIO
      if (server.workingDirectory && server.workingDirectory.trim().length > 0) {
        continue;
      }
      if (!server.comando.trim()) {
        continue;
      }

      const name = buildUniqueAcpName(server.nome, usedNames, server.mcp_id);
      const envRecord = resolveServerEnvironment(server);
      result.push({
        name,
        command: server.comando,
        args: [...(server.args ?? [])],
        env: Object.entries(envRecord).map(([k, v]) => ({ name: k, value: v })),
      });
      continue;
    }

    if (!server.url || !server.url.trim()) {
      continue;
    }

    const name = buildUniqueAcpName(server.nome, usedNames, server.mcp_id);
    const proxyRoute = proxyResolver ? proxyResolver(server) : null;

    if (proxyRoute) {
      result.push({
        type: "http",
        name,
        url: proxyRoute.proxyUrl,
        headers: [{ name: proxyRoute.proxyHeaderName, value: proxyRoute.proxySecret }],
      });
    } else {
      result.push({
        type: "http",
        name,
        url: stripUrlFragment(server.url),
        headers: Object.entries(server.headers ?? {}).map(([k, v]) => ({ name: k, value: v })),
      });
    }
  }

  return result;
}

function normalizeJsonSchemaParameters(
  schema?: Record<string, unknown>
): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }

  const normalized: Record<string, unknown> = { ...schema };
  if (typeof normalized.type !== "string" || !normalized.type) {
    normalized.type = "object";
  }
  if (
    normalized.type === "object" &&
    (!normalized.properties || typeof normalized.properties !== "object")
  ) {
    normalized.properties = {};
  }
  return normalized;
}

/**
 * Converte ferramentas MCP descobertas em `ToolDefinition[]` compatível com
 * `GeminiProvider`, `ClaudeProvider`, `OpenAIProvider` e `AgentRunner`.
 */
export function toNativeProviderTools(
  discoveredTools: readonly DiscoveredMcpTool[]
): ToolDefinition[] {
  const usedNames = new Set<string>();
  const definitions: ToolDefinition[] = [];

  for (const tool of discoveredTools) {
    if (!tool.name || !tool.mcpId) continue;
    let safeName = buildSafeMcpToolName(tool.mcpId, tool.name);

    if (usedNames.has(safeName)) {
      let suffix = 2;
      while (suffix < 1000) {
        const suffixStr = `_${suffix}`;
        const candidate = `${safeName.slice(0, MAX_PROVIDER_TOOL_NAME_LENGTH - suffixStr.length)}${suffixStr}`;
        if (!usedNames.has(candidate)) {
          safeName = candidate;
          registerMcpToolOrigin(safeName, tool.mcpId, tool.name);
          break;
        }
        suffix += 1;
      }
    }

    usedNames.add(safeName);
    const labelPrefix = tool.serverName ? `[MCP ${tool.serverName}] ` : "";
    const description =
      tool.description && tool.description.trim().length > 0
        ? `${labelPrefix}${tool.description.trim()}`
        : `${labelPrefix}Ferramenta MCP '${tool.name}'`;

    definitions.push({
      name: safeName,
      description,
      parameters: normalizeJsonSchemaParameters(tool.inputSchema),
    });
  }

  return definitions;
}
