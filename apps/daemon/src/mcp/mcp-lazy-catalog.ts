import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolDefinition } from "@criativo/contracts";
import type { AcpMcpServer } from "./mcp-provider-shapes.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { LAZY_META_TOOL_NAMES, LazyToolRouter } from "../engine/tools/lazy-tool-router.ts";
import { sanitizeJsonSchemaForGemini } from "./gemini-schema-sanitizer.ts";

export function collectVaultSecretsForRedaction(vault?: VaultService): string[] {
  if (!vault) return [];
  const values: string[] = [];
  try {
    for (const meta of vault.listSecretsMetadata()) {
      const val = vault.getSecret(meta.chave_nome);
      if (val && val.trim().length >= 8) {
        values.push(val.trim());
      }
    }
  } catch {
    // Ignora erro ao listar segredos para redação
  }
  return values;
}

export function assembleClaudeMcpConfigObject(
  internalUrl: string | null,
  authToken: string,
  acpExternal: AcpMcpServer[]
): Record<string, unknown> | null {
  const mcpServers: Record<string, unknown> = {};
  if (internalUrl) {
    mcpServers.criativo_studio = {
      type: "http",
      url: internalUrl,
      headers: {
        "X-Criativo-Mcp-Token": authToken,
      },
    };
  }
  for (const srv of acpExternal) {
    if ("url" in srv) {
      const headersObj: Record<string, string> = {};
      for (const h of srv.headers) {
        headersObj[h.name] = h.value;
      }
      mcpServers[srv.name] = {
        type: "http",
        url: srv.url,
        ...(Object.keys(headersObj).length > 0 ? { headers: headersObj } : {}),
      };
    } else {
      const envObj: Record<string, string> = {};
      for (const e of srv.env) {
        envObj[e.name] = e.value;
      }
      mcpServers[srv.name] = {
        command: srv.command,
        args: srv.args,
        ...(Object.keys(envObj).length > 0 ? { env: envObj } : {}),
      };
    }
  }
  return Object.keys(mcpServers).length === 0 ? null : { mcpServers };
}

const DEFAULT_MCP_PROTOCOL_VERSION = "2024-11-05";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

export function negotiateMcpProtocolVersion(requested: unknown): string {
  if (typeof requested !== "string") return DEFAULT_MCP_PROTOCOL_VERSION;
  const trimmed = requested.trim();
  if (SUPPORTED_MCP_PROTOCOL_VERSIONS.has(trimmed)) return trimmed;
  if (/^202[56]-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return DEFAULT_MCP_PROTOCOL_VERSION;
}

export function sendMcpJsonRpc(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    ...(extraHeaders ?? {}),
  });
  res.end(JSON.stringify(body));
}

export function readMcpHeaderValue(req: IncomingMessage, headerName: string): string | null {
  const raw = req.headers[headerName.toLowerCase()];
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim() || null;
  return null;
}

/**
 * Conjunto mínimo exposto diretamente no protocolo MCP (`tools/list`) antes da descoberta lazy.
 * Ferramentas especializadas são descobertas sob demanda via `tool_search`/`tool_describe`/`tool_call`.
 */
export const MCP_CORE_DIRECT_TOOLS = new Set<string>([
  "load_skill",
  "ask_user",
  "ask_ui",
  "attach_files_to_response",
  "list_agents",
  "send_message",
  "memory_recall",
  "remember",
  "forget_memory",
  "generate_image",
  "criativo_browser",
]);

const ANTIGRAVITY_COMPACT_META_TOOLS: ToolDefinition[] = [
  {
    name: "tool_search",
    description: "Busca ferramentas secundárias do CriativoOS por palavra-chave.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Termo da ação." },
        categoria: { type: "string", description: "Categoria opcional." },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_describe",
    description: "Carrega schemas de ferramentas descobertas.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Nome da ferramenta." },
      },
      required: ["tool_name"],
    },
  },
  {
    name: "tool_call",
    description: "Executa uma ferramenta secundária autorizada.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Nome exato da ferramenta." },
        arguments: { type: "object", description: "Argumentos JSON." },
      },
      required: ["tool_name"],
    },
  },
];

export interface LazyMcpCatalogResult {
  exposedTools: ToolDefinition[];
  router: LazyToolRouter;
  compactAntigravity: boolean;
}

export function normalizeMcpToolName(rawToolName: string): string {
  return String(rawToolName ?? "")
    .replace(/^mcp__criativo_studio__/, "")
    .replace(/^criativo_studio[_.:-]+/, "")
    .replace(/^criativo-studio[_.:-]+/, "")
    .trim();
}

function compactSchemaNode(
  node: Record<string, unknown>,
  stripDescriptions: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(node)) {
    if (key === "description" && typeof val === "string") {
      if (stripDescriptions) continue;
      if (val.length > 36) {
        out[key] = `${val.slice(0, 33)}...`;
        continue;
      }
    }
    if (key === "properties" && val && typeof val === "object" && !Array.isArray(val)) {
      const compactProps: Record<string, unknown> = {};
      for (const [pKey, pVal] of Object.entries(val as Record<string, unknown>)) {
        compactProps[pKey] =
          pVal && typeof pVal === "object" && !Array.isArray(pVal)
            ? compactSchemaNode(pVal as Record<string, unknown>, stripDescriptions)
            : pVal;
      }
      out[key] = compactProps;
      continue;
    }
    if (key === "items" && val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = compactSchemaNode(val as Record<string, unknown>, stripDescriptions);
      continue;
    }
    out[key] = val;
  }
  return out;
}

function compactListedToolDefinition(
  tool: ToolDefinition,
  options: { compactAntigravity: boolean }
): ToolDefinition {
  const serializedSize = Buffer.byteLength(JSON.stringify(tool), "utf8");
  const isHeavyTool = serializedSize > 600;
  if (!options.compactAntigravity && !isHeavyTool) {
    return tool;
  }
  const desc =
    tool.description.length > 75
      ? `${tool.description.slice(0, 72)}...`
      : tool.description;
  return {
    name: tool.name,
    description: desc,
    parameters: compactSchemaNode(
      (tool.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
      options.compactAntigravity
    ),
  };
}

export function buildLazyMcpToolCatalog(
  authorizedTools: ToolDefinition[],
  options?: {
    provider?: string | null;
    lazyEnabled?: boolean;
    threshold?: number;
    coreNames?: Set<string>;
  }
): LazyMcpCatalogResult {
  const providerLower = String(options?.provider ?? "").trim().toLowerCase();
  const compactAntigravity =
    providerLower === "antigravity" || providerLower === "gemini";

  const router = new LazyToolRouter(authorizedTools, {
    coreNames: options?.coreNames ?? MCP_CORE_DIRECT_TOOLS,
    threshold: options?.threshold ?? 12,
    enabled: options?.lazyEnabled !== false,
  });

  let exposedTools = router.selectExposedTools();
  if (router.isLazyActive()) {
    exposedTools = exposedTools.map((t) => {
      if (compactAntigravity) {
        const compactMeta = ANTIGRAVITY_COMPACT_META_TOOLS.find((m) => m.name === t.name);
        if (compactMeta) return compactMeta;
      }
      return compactListedToolDefinition(t, { compactAntigravity });
    });
  }

  return {
    exposedTools,
    router,
    compactAntigravity,
  };
}

export function formatMcpToolsListPayload(exposedTools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return exposedTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: sanitizeJsonSchemaForGemini(
      t.parameters ?? { type: "object", properties: {} }
    ) as Record<string, unknown>,
  }));
}

export async function tryHandleLazyMetaMcpCall(
  router: LazyToolRouter,
  rawToolName: string,
  args: Record<string, unknown>,
  dispatchFn: (targetName: string, targetArgs: Record<string, unknown>) => Promise<unknown>
): Promise<{ handled: boolean; result?: unknown }> {
  const cleanName = normalizeMcpToolName(rawToolName);
  if (!LAZY_META_TOOL_NAMES.has(cleanName)) {
    return { handled: false };
  }
  const result = await router.executeMetaTool(cleanName, args, dispatchFn);
  return { handled: true, result };
}
