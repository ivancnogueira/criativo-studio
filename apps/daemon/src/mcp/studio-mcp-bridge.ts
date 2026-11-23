import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolDefinition } from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { BrowserAutomationService } from "../engine/tools/browser-automation.ts";
import type { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import type { CatalogService } from "../marketplace/catalog-service.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { SkillsManager } from "../marketplace/skills-manager.ts";
import type { RoutineToolExecutionContext, RoutineToolsDeps } from "../routines/routine-agent-tools.ts";
import type { RemoteClaimService } from "../servers/remote-claim-service.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { toolBelongsToScopes, type StudioToolScope } from "../server/turn-context-planner.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WorkflowEngine } from "../workflows/workflow-engine.ts";
import type { WorkflowStore } from "../workflows/workflow-store.ts";
import type { TranscriptionService } from "../voice/transcription-service.ts";
import type { BrowserAutofillService } from "../vault/browser-autofill-service.ts";
import type { CrmService } from "../crm/crm-service.ts";
import type { CuaDriverClient } from "../engine/tools/cua-driver-client.ts";
import type { Phase13ServicesBundle } from "../server/threads-routes.ts";
import type { ShowcaseSiteService } from "../server/showcase-service.ts";
import {
  executeChatWorkflowTool,
  executePhase13Tool,
  executePhase14ToolCall,
  executePhase15ChatTool,
  executeStudioExtensionTool,
  executeStudioRoutineTool,
  getChatWorkflowToolCatalog,
  HIDDEN_CATALOG_TOOL_NAMES,
  isAgentAuthorizedForStudioTool,
  isPhase10ExtensionTool,
  isPhase13ToolName,
  isPhase14ToolName,
  isPhase15ToolName,
  isRoutineToolName,
  isWorkflowToolName,
  PHASE10_TOOL_DEFINITIONS,
  PHASE13_TOOLS_SCHEMA,
  PHASE14_TOOLS_SCHEMA,
  PHASE15_TOOLS_SCHEMA,
  resolveNativeAppConnectionsStore,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  type Phase14ToolServices,
} from "../server/studio-tools-bridge.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import { sanitizeJsonSchemaForGemini } from "./gemini-schema-sanitizer.ts";
import type { McpGateway } from "./mcp-gateway.ts";
import type { AcpMcpServer } from "./mcp-provider-shapes.ts";
import { redactMcpPayload, redactMcpSecrets } from "./mcp-redaction.ts";

export interface CriativoStudioMcpBridgeOptions {
  db: CriativoDatabase;
  vault?: VaultService;
  wsHub: WebSocketHub;
  workspaceRoot: string;
  mcpGateway?: McpGateway;
  catalogService?: CatalogService;
  nativeStore?: NativeAppConnectionsStore;
  providerConnection?: ProviderConnectionService;
  skillsManager?: SkillsManager;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  routineToolsDeps?: RoutineToolsDeps;
  workflowStore?: WorkflowStore;
  workflowEngine?: WorkflowEngine;
  phase13?: Phase13ServicesBundle;
  phase14?: Phase14ToolServices;
  browserService?: BrowserAutomationService;
  screenCapture?: ScreenCaptureBridge;
  showcaseService?: ShowcaseSiteService;
  transcription?: TranscriptionService;
  remoteClaimService?: RemoteClaimService | null;
  browserAutofillService?: BrowserAutofillService;
  crmService?: CrmService;
  cuaClient?: CuaDriverClient;
  authToken?: string;
  fetchImpl?: FetchLike;
}

export const INTERNAL_MCP_ROUTE_PATH = "/api/internal/mcp";
const DEFAULT_MCP_PROTOCOL_VERSION = "2024-11-05";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

function negotiateMcpProtocolVersion(requested: unknown): string {
  if (typeof requested !== "string") return DEFAULT_MCP_PROTOCOL_VERSION;
  const trimmed = requested.trim();
  if (SUPPORTED_MCP_PROTOCOL_VERSIONS.has(trimmed)) return trimmed;
  if (/^202[56]-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return DEFAULT_MCP_PROTOCOL_VERSION;
}

function sendJsonRpc(
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

function readHeaderValue(req: IncomingMessage, headerName: string): string | null {
  const raw = req.headers[headerName.toLowerCase()];
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim() || null;
  return null;
}

export interface McpBridgeEndpointOptions {
  scopes?: StudioToolScope[] | null;
  threadId?: string | null;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  execucaoId?: string | null;
  includeExternalMcps?: boolean;
}

export interface McpBridgeCallContext {
  threadId?: string | null;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  execucaoId?: string | null;
}

/**
 * Ponte MCP Interna do CriativoOS (`criativo_studio`).
 * Expõe ferramentas nativas do Estúdio (Cofre/Meta v27.0, Analytics, Memórias, Tarefas, Workflows, Browser CDP)
 * sobre Streamable HTTP JSON-RPC 2.0 autenticada por token aleatório por processo,
 * garantindo isolamento por agente (`agentId`) e redação de segredos.
 */
export class CriativoStudioMcpBridge {
  private readonly deps: CriativoStudioMcpBridgeOptions;
  private readonly authToken: string;
  private readonly activeSessionIds = new Set<string>();
  private readonly routineFlagsByExecId = new Map<string, RoutineToolExecutionContext["flags"]>();
  private boundPort: number | null = null;

  constructor(options: CriativoStudioMcpBridgeOptions) {
    this.deps = options;
    this.authToken = options.authToken?.trim() || randomBytes(24).toString("hex");
  }

  public registerRoutineExecutionFlags(
    execucaoId: string,
    flags: RoutineToolExecutionContext["flags"],
  ): void {
    const clean = execucaoId.trim();
    if (clean) {
      this.routineFlagsByExecId.set(clean, flags);
    }
  }

  public clearRoutineExecutionFlags(execucaoId: string): void {
    const clean = execucaoId.trim();
    if (clean) {
      this.routineFlagsByExecId.delete(clean);
    }
  }

  public setPort(port: number): void {
    if (Number.isInteger(port) && port > 0) {
      this.boundPort = port;
    }
  }

  public getPort(): number | null {
    return this.boundPort;
  }

  public getAuthToken(): string {
    return this.authToken;
  }

  public getEndpointUrlForAgent(
    agentId?: string | null,
    opts?: McpBridgeEndpointOptions,
  ): string | null {
    if (!this.boundPort) return null;
    const base = `http://127.0.0.1:${this.boundPort}${INTERNAL_MCP_ROUTE_PATH}`;
    const qs = new URLSearchParams();
    const cleanAgent = agentId?.trim();
    if (cleanAgent) qs.set("agentId", cleanAgent);
    if (Array.isArray(opts?.scopes)) {
      qs.set("scopes", opts.scopes.length === 0 ? "__none__" : opts.scopes.join(","));
    }
    if (opts?.threadId?.trim()) qs.set("threadId", opts.threadId.trim());
    if (opts?.channelOrigin) qs.set("channelOrigin", opts.channelOrigin);
    if (opts?.whatsappContaId?.trim()) qs.set("whatsappContaId", opts.whatsappContaId.trim());
    if (opts?.whatsappChatJid?.trim()) qs.set("whatsappChatJid", opts.whatsappChatJid.trim());
    if (opts?.execucaoId?.trim()) qs.set("execucaoId", opts.execucaoId.trim());
    const serialized = qs.toString();
    return serialized ? `${base}?${serialized}` : base;
  }

  public getAcpBridgeServerSpec(
    agentId?: string | null,
    opts?: McpBridgeEndpointOptions,
  ): AcpMcpServer | null {
    if (Array.isArray(opts?.scopes) && opts.scopes.length === 0) {
      return null;
    }
    const url = this.getEndpointUrlForAgent(agentId, opts);
    if (!url) return null;
    return {
      type: "http",
      name: "criativo_studio",
      url,
      headers: [
        {
          name: "X-Criativo-Mcp-Token",
          value: this.authToken,
        },
      ],
    };
  }

  public getClaudeMcpConfigObject(
    agentId?: string | null,
    opts?: McpBridgeEndpointOptions,
  ): Record<string, unknown> | null {
    if (
      Array.isArray(opts?.scopes) &&
      opts.scopes.length === 0 &&
      opts?.includeExternalMcps === false
    ) {
      return null;
    }

    const includeInternal = !(Array.isArray(opts?.scopes) && opts.scopes.length === 0);
    const url = includeInternal ? this.getEndpointUrlForAgent(agentId, opts) : null;

    const mcpServers: Record<string, unknown> = {};
    if (url) {
      mcpServers.criativo_studio = {
        type: "http",
        url,
        headers: {
          "X-Criativo-Mcp-Token": this.authToken,
        },
      };
    }

    const acpExternal =
      opts?.includeExternalMcps === false
        ? []
        : this.deps.mcpGateway?.getAcpMcpServers(agentId) ?? [];
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

    if (Object.keys(mcpServers).length === 0) {
      return null;
    }

    return { mcpServers };
  }

  public isAuthorizedToken(candidate: string | null | undefined): boolean {
    if (!candidate) return false;
    const expectedBuf = Buffer.from(this.authToken, "utf8");
    const receivedBuf = Buffer.from(candidate.trim(), "utf8");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  private resolveNativeStore(): NativeAppConnectionsStore | undefined {
    return (
      resolveNativeAppConnectionsStore({
        db: this.deps.db,
        vault: this.deps.vault,
        nativeStore: this.deps.nativeStore,
        catalogService: this.deps.catalogService,
      }) ?? undefined
    );
  }

  private collectVaultSecretValues(): string[] {
    if (!this.deps.vault) return [];
    const values: string[] = [];
    try {
      for (const meta of this.deps.vault.listSecretsMetadata()) {
        const val = this.deps.vault.getSecret(meta.chave_nome);
        if (val && val.trim().length >= 8) {
          values.push(val.trim());
        }
      }
    } catch {
      // Ignora erro ao listar segredos para redação
    }
    return values;
  }

  public listToolsForAgent(
    agentId?: string | null,
    scopes?: StudioToolScope[] | null,
  ): ToolDefinition[] {
    if (Array.isArray(scopes) && scopes.length === 0) {
      return [];
    }
    const scopeSet = Array.isArray(scopes) ? new Set<StudioToolScope>(scopes) : null;

    const candidates: ToolDefinition[] = [
      ...PHASE10_TOOL_DEFINITIONS,
      ...(this.deps.routineToolsDeps ? ROUTINE_AGENT_TOOLS_SCHEMA : []),
      ...(this.deps.workflowStore && this.deps.workflowEngine ? getChatWorkflowToolCatalog() : []),
      ...(this.deps.phase13 ? PHASE13_TOOLS_SCHEMA : []),
      ...(this.deps.phase14 ? PHASE14_TOOLS_SCHEMA : []),
      ...(this.deps.browserService ||
      this.deps.screenCapture ||
      this.deps.showcaseService ||
      this.deps.remoteClaimService
        ? PHASE15_TOOLS_SCHEMA
        : []),
    ];

    const nativeStore = this.resolveNativeStore();
    const dedup = new Map<string, ToolDefinition>();

    for (const tool of candidates) {
      if (HIDDEN_CATALOG_TOOL_NAMES.has(tool.name)) continue;
      if (scopeSet && !toolBelongsToScopes(tool.name, scopeSet)) continue;
      if (dedup.has(tool.name)) continue;
      if (
        !isAgentAuthorizedForStudioTool(tool.name, agentId, {
          db: this.deps.db,
          vault: this.deps.vault,
          nativeStore,
          catalogService: this.deps.catalogService,
        })
      ) {
        continue;
      }
      dedup.set(tool.name, {
        ...tool,
        parameters: sanitizeJsonSchemaForGemini(tool.parameters ?? { type: "object", properties: {} }),
      });
    }

    return Array.from(dedup.values());
  }

  public async callToolForAgent(
    rawToolName: string,
    args: Record<string, unknown>,
    agentId?: string | null,
    callCtx?: McpBridgeCallContext,
  ): Promise<unknown> {
    const toolName = rawToolName
      .replace(/^mcp__criativo_studio__/, "")
      .replace(/^criativo_studio[_.:-]+/, "")
      .replace(/^criativo-studio[_.:-]+/, "")
      .trim();
    const resolvedAgentId = agentId?.trim() || "sistema";
    const effectiveThreadId = callCtx?.threadId?.trim() || `main:${resolvedAgentId}`;
    const canalId =
      effectiveThreadId && !effectiveThreadId.startsWith("main:")
        ? `thread:${effectiveThreadId}`
        : `agente:${resolvedAgentId}`;
    const nativeStore = this.resolveNativeStore();

    if (
      !isAgentAuthorizedForStudioTool(toolName, resolvedAgentId, {
        db: this.deps.db,
        vault: this.deps.vault,
        nativeStore,
        catalogService: this.deps.catalogService,
      })
    ) {
      throw new Error(
        `Acesso negado: o agente '${resolvedAgentId}' não tem permissão ao aplicativo nativo correspondente na Loja.`
      );
    }

    let output: unknown;

    if (isPhase15ToolName(toolName)) {
      output = await executePhase15ChatTool({
        toolName,
        args,
        agenteId: resolvedAgentId,
        canalId,
        deps: {
          db: this.deps.db,
          wsHub: this.deps.wsHub,
          workspaceRoot: this.deps.workspaceRoot,
          browserService: this.deps.browserService,
          screenCapture: this.deps.screenCapture,
          showcaseService: this.deps.showcaseService,
          transcription: this.deps.transcription,
          remoteClaimService: this.deps.remoteClaimService ?? undefined,
          browserAutofillService: this.deps.browserAutofillService,
          crmService: this.deps.crmService,
          cuaClient: this.deps.cuaClient,
        },
      });
    } else if (isPhase10ExtensionTool(toolName)) {
      output = await executeStudioExtensionTool(toolName, args, {
        db: this.deps.db,
        vault: this.deps.vault,
        wsHub: this.deps.wsHub,
        workspaceRoot: this.deps.workspaceRoot,
        agenteId: resolvedAgentId,
        canalId,
        mcpGateway: this.deps.mcpGateway,
        catalogService: this.deps.catalogService,
        nativeStore,
        providerConnection: this.deps.providerConnection,
        skillsManager: this.deps.skillsManager,
        whatsappManager: this.deps.whatsappManager,
        whatsappOrchestrator: this.deps.whatsappOrchestrator,
        fetchImpl: this.deps.fetchImpl,
      });
    } else if (isRoutineToolName(toolName)) {
      const execId = callCtx?.execucaoId?.trim() || null;
      const sharedFlags = execId ? this.routineFlagsByExecId.get(execId) : undefined;
      output = await executeStudioRoutineTool(toolName, args, {
        agenteId: resolvedAgentId,
        turnOrigin: execId ? "routine" : "human",
        execucaoId: execId,
        flags: sharedFlags,
        routineToolsDeps: this.deps.routineToolsDeps,
      });
    } else if (isWorkflowToolName(toolName)) {
      output = await executeChatWorkflowTool(toolName, args, {
        store: this.deps.workflowStore,
        engine: this.deps.workflowEngine,
        wsHub: this.deps.wsHub,
        agenteId: resolvedAgentId,
        requestSeed: randomUUID().slice(0, 8),
      });
    } else if (isPhase14ToolName(toolName) && this.deps.phase14) {
      output = await executePhase14ToolCall(
        toolName,
        args,
        {
          agenteId: resolvedAgentId,
          canalId,
          threadId: effectiveThreadId,
          turnId: `mcp-${randomUUID().slice(0, 8)}`,
          origemTurno: "usuario_local",
          isOneToOneUserChat: true,
        },
        this.deps.phase14
      );
    } else if (isPhase13ToolName(toolName) && this.deps.phase13) {
      const p13 = await executePhase13Tool(
        toolName,
        args,
        {
          agenteId: resolvedAgentId,
          turnoId: `mcp-${randomUUID().slice(0, 8)}`,
          callId: randomUUID().slice(0, 8),
          threadId: effectiveThreadId,
          canalId,
          entregaOrigemId: randomUUID().slice(0, 8),
          pedidoTexto: "",
          channelOrigin: callCtx?.channelOrigin,
          whatsappContaId: callCtx?.whatsappContaId ?? null,
          whatsappChatJid: callCtx?.whatsappChatJid ?? null,
        },
        {
          ...this.deps.phase13,
          db: this.deps.db,
        }
      );
      output = p13.result;
    } else if (this.deps.mcpGateway && toolName.startsWith("mcp_")) {
      output = await this.deps.mcpGateway.callMcpTool(toolName, args, {
        agentId: resolvedAgentId,
      });
    } else {
      throw new Error(`Ferramenta '${toolName}' desconhecida ou indisponível na ponte criativo_studio.`);
    }

    return redactMcpPayload(output, this.collectVaultSecretValues());
  }

  public async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    method: string,
    url: URL,
    readJsonBody: (r: IncomingMessage) => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    if (path !== INTERNAL_MCP_ROUTE_PATH) return false;

    const tokenHeader = readHeaderValue(req, "x-criativo-mcp-token");
    if (!this.isAuthorizedToken(tokenHeader)) {
      sendJsonRpc(res, 401, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message: "Token X-Criativo-Mcp-Token ausente ou inválido.",
        },
      });
      return true;
    }

    if (method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const timer = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) {
          res.write(": ping\n\n");
        }
      }, 20_000);
      timer.unref?.();
      req.on("close", () => clearInterval(timer));
      return true;
    }

    if (method === "DELETE") {
      const incomingSessionId = readHeaderValue(req, "mcp-session-id");
      if (incomingSessionId) {
        this.activeSessionIds.delete(incomingSessionId);
      }
      res.writeHead(204);
      res.end();
      return true;
    }

    if (method !== "POST") {
      sendJsonRpc(res, 405, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32601, message: "Método HTTP não suportado na ponte MCP." },
      });
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonRpc(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Payload JSON-RPC inválido." },
      });
      return true;
    }

    const id = body.id !== undefined ? body.id : null;
    const rpcMethod = typeof body.method === "string" ? body.method : "";
    const params =
      body.params && typeof body.params === "object" && !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : {};

    const agentFromQuery = url.searchParams.get("agentId")?.trim() || null;
    const agentFromHeader = readHeaderValue(req, "x-criativo-agent-id");
    const meta =
      params._meta && typeof params._meta === "object" && !Array.isArray(params._meta)
        ? (params._meta as Record<string, unknown>)
        : null;
    const agentFromMeta =
      meta && typeof meta.agentId === "string" ? meta.agentId.trim() || null : null;
    const resolvedAgentId = agentFromQuery ?? agentFromHeader ?? agentFromMeta;

    const scopesParam = url.searchParams.get("scopes");
    const parsedScopes: StudioToolScope[] | undefined =
      scopesParam === null
        ? undefined
        : scopesParam === "" || scopesParam === "__none__"
          ? []
          : (scopesParam
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean) as StudioToolScope[]);

    const rawChannelOrigin = url.searchParams.get("channelOrigin");
    const callCtx: McpBridgeCallContext = {
      threadId: url.searchParams.get("threadId")?.trim() || null,
      channelOrigin:
        rawChannelOrigin === "whatsapp"
          ? "whatsapp"
          : rawChannelOrigin === "web"
            ? "web"
            : undefined,
      whatsappContaId: url.searchParams.get("whatsappContaId")?.trim() || null,
      whatsappChatJid: url.searchParams.get("whatsappChatJid")?.trim() || null,
      execucaoId: url.searchParams.get("execucaoId")?.trim() || null,
    };

    if (rpcMethod === "notifications/initialized" || rpcMethod === "notifications/cancelled") {
      if (id === null) {
        res.writeHead(202);
        res.end();
      } else {
        sendJsonRpc(res, 200, { jsonrpc: "2.0", id, result: {} });
      }
      return true;
    }

    if (rpcMethod === "ping") {
      sendJsonRpc(res, 200, { jsonrpc: "2.0", id, result: {} });
      return true;
    }

    if (rpcMethod === "initialize") {
      const requestedProtocol = negotiateMcpProtocolVersion(params.protocolVersion);
      const incomingSessionId = readHeaderValue(req, "mcp-session-id");
      const sessionId =
        incomingSessionId && this.activeSessionIds.has(incomingSessionId)
          ? incomingSessionId
          : randomUUID();
      this.activeSessionIds.add(sessionId);
      sendJsonRpc(
        res,
        200,
        {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: requestedProtocol,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: "criativo-studio",
              version: "1.0.0",
            },
          },
        },
        { "Mcp-Session-Id": sessionId }
      );
      return true;
    }

    if (rpcMethod === "tools/list") {
      const tools = this.listToolsForAgent(resolvedAgentId, parsedScopes).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: sanitizeJsonSchemaForGemini(t.parameters ?? { type: "object", properties: {} }),
      }));
      sendJsonRpc(res, 200, {
        jsonrpc: "2.0",
        id,
        result: { tools },
      });
      return true;
    }

    if (rpcMethod === "tools/call") {
      const toolName = typeof params.name === "string" ? params.name.trim() : "";
      if (!toolName) {
        sendJsonRpc(res, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Parâmetro 'name' obrigatório em tools/call." },
        });
        return true;
      }
      const rawArgs =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};

      try {
        const result = await this.callToolForAgent(toolName, rawArgs, resolvedAgentId, callCtx);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        sendJsonRpc(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
            isError: false,
          },
        });
      } catch (err) {
        const rawErr = err instanceof Error ? err.message : String(err);
        const safeErr = redactMcpSecrets(rawErr, this.collectVaultSecretValues());
        sendJsonRpc(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ erro: safeErr }) }],
            isError: true,
          },
        });
      }
      return true;
    }

    sendJsonRpc(res, 200, {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Método JSON-RPC não implementado: ${rpcMethod}`,
      },
    });
    return true;
  }
}
