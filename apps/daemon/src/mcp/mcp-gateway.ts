import type {
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  ToolDefinition,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { McpAuthRequiredError, McpClient, type McpServerConfig } from "../engine/providers/mcp-client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { McpOAuthProvider } from "./mcp-oauth-provider.ts";
import { McpOAuthProxy } from "./mcp-oauth-proxy.ts";
import { discoverOAuthMetadata, inspectMcpServer } from "./mcp-probe.ts";
import {
  type AcpMcpServer,
  type DiscoveredMcpTool,
  resolveMcpToolOrigin,
  toAcpMcpServers,
  toNativeProviderTools,
  usableMcpServers,
} from "./mcp-provider-shapes.ts";
import {
  collectSensitiveSecrets,
  MASKED_SECRET_VALUE,
  maskMcpServerForClient,
  redactMcpPayload,
  redactMcpSecrets,
  SECRET_REDACTED_PLACEHOLDER,
} from "./mcp-redaction.ts";
import { isAgentAuthorizedForServer, McpServerStore } from "./mcp-server-store.ts";
import { sanitizeJsonSchemaForGemini } from "./gemini-schema-sanitizer.ts";
import { McpApprovalAutomationService } from "./approval-automation.ts";

export interface McpOAuthRequiredNotice {
  ok: false;
  action: "sign_in";
  mcpId: string;
  nome: string;
  appSlug: string | null;
  motivo: string;
  authorizeUrl?: string | null;
  agentId?: string | null;
}

export interface McpServerStatusChangedEvent {
  mcpId: string;
  ativo: boolean;
  oauthStatus: McpOAuthStatus;
  qtdFerramentas: number;
  ultimoErro?: string | null;
}

export interface McpGatewayOptions {
  db: CriativoDatabase;
  vault: VaultService;
  store?: McpServerStore;
  oauthProvider?: McpOAuthProvider;
  oauthProxy?: McpOAuthProxy;
  fetchImpl?: FetchLike;
  onOAuthRequired?: (notice: McpOAuthRequiredNotice) => void;
  onServerStatusChanged?: (event: McpServerStatusChangedEvent) => void;
}

interface PooledClientEntry {
  fingerprint: string;
  client: McpClient;
  discoveredTools: DiscoveredMcpTool[];
  needsSignIn?: boolean;
}

function buildServerFingerprint(server: McpServidorConfig): string {
  return JSON.stringify({
    transporte: server.transporte,
    comando: server.comando,
    args: server.args,
    env: server.env,
    envPassthrough: server.envPassthrough,
    workingDirectory: server.workingDirectory,
    url: server.url,
    headers: server.headers,
    ativo: server.ativo,
  });
}

function toLegacyClientConfig(
  server: McpServidorConfig,
  headersOverride?: Record<string, string>
): McpServerConfig {
  return {
    mcp_id: server.mcp_id,
    nome: server.nome,
    comando: server.comando,
    args: [...server.args],
    env: { ...server.env },
    transport: server.transporte,
    endpointUrl: server.url ?? undefined,
    headers: headersOverride ?? { ...server.headers },
    envPassthrough: [...server.envPassthrough],
    workingDirectory: server.workingDirectory,
    acesso: server.acesso,
    origemAppSlug: server.origemAppSlug,
    contaRotulo: server.contaRotulo,
  };
}

/**
 * Fachada unificada de gerenciamento MCP:
 * - Pool de conexões `McpClient` por servidor
 * - Proxy OAuth loopback (`127.0.0.1`) isolando tokens de processos ACP/LLMs
 * - Sondagem STDIO / Streamable HTTP + descoberta OAuth
 * - Controle de acesso por agente e redação sistemática de segredos
 */
export class McpGateway {
  public readonly store: McpServerStore;
  public readonly oauthProvider: McpOAuthProvider;
  public readonly oauthProxy: McpOAuthProxy;
  public readonly approvalService: McpApprovalAutomationService;
  private readonly fetchImpl: FetchLike;
  private readonly onOAuthRequired?: McpGatewayOptions["onOAuthRequired"];
  private readonly onServerStatusChanged?: McpGatewayOptions["onServerStatusChanged"];
  private readonly pool = new Map<string, PooledClientEntry>();

  constructor(options: McpGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onOAuthRequired = options.onOAuthRequired;
    this.onServerStatusChanged = options.onServerStatusChanged;

    this.store = options.store ?? new McpServerStore({ db: options.db, vault: options.vault });
    this.oauthProvider =
      options.oauthProvider ??
      new McpOAuthProvider({
        db: options.db,
        vault: options.vault,
        fetchImpl: this.fetchImpl,
      });
    this.oauthProxy =
      options.oauthProxy ??
      new McpOAuthProxy({
        oauthProvider: this.oauthProvider,
        fetchImpl: this.fetchImpl,
      });
    this.approvalService = new McpApprovalAutomationService(options.db);
  }

  /**
   * Inicia o proxy loopback em `127.0.0.1:0` e registra rotas dos servidores HTTP ativos.
   */
  public async start(): Promise<{ proxyPort: number; proxyBaseUrl: string }> {
    const started = await this.oauthProxy.start();
    this.refreshProxyRoutes();
    return { proxyPort: started.port, proxyBaseUrl: started.baseUrl };
  }

  /**
   * Sincroniza as rotas registradas no proxy loopback para servidores HTTP ativos com OAuth.
   */
  public refreshProxyRoutes(): void {
    if (this.oauthProxy.listeningPort === null) return;

    const activeServers = this.store.listServers({
      includeDisabled: false,
      resolveSecrets: true,
    });
    const activeHttpOAuthIds = new Set<string>();

    for (const server of activeServers) {
      if (server.transporte !== "http" || !server.url) continue;
      const hasOAuth =
        server.oauthStatus !== "disconnected" ||
        this.oauthProvider.listOAuthAccounts(server.mcp_id).length > 0;
      if (!hasOAuth) continue;

      activeHttpOAuthIds.add(server.mcp_id);
      this.oauthProxy.registerServerRoute({
        mcpId: server.mcp_id,
        targetUrl: server.url,
        extraHeaders: server.headers,
      });
    }

    for (const pooledId of this.pool.keys()) {
      if (!activeServers.some((s) => s.mcp_id === pooledId)) {
        this.invalidateServer(pooledId);
      }
    }
  }

  /**
   * Invalida conexões em cache de um servidor específico (após editar/desabilitar/desconectar).
   */
  public invalidateServer(mcpId: string): void {
    const entry = this.pool.get(mcpId);
    if (entry) {
      entry.client.close();
      this.pool.delete(mcpId);
    }
    this.oauthProxy.unregisterServerRoute(mcpId);
  }

  /**
   * Encerra todas as conexões do pool, listeners OAuth temporários e o proxy loopback.
   */
  public async close(): Promise<void> {
    for (const entry of this.pool.values()) {
      entry.client.close();
    }
    this.pool.clear();
    this.oauthProvider.close();
    await this.oauthProxy.close();
  }

  /**
   * Lista servidores autorizados para um agente (sempre mascarados para exibição/contexto).
   */
  public listServersForAgent(agentId?: string | null): McpServidorConfig[] {
    return usableMcpServers(this.store, agentId).map((server) =>
      maskMcpServerForClient(server)
    );
  }

  public listDiscoveredTools(): Array<{
    mcpId: string;
    serverName: string;
    name: string;
    description?: string;
  }> {
    const out: Array<{ mcpId: string; serverName: string; name: string; description?: string }> = [];
    for (const entry of this.pool.values()) {
      for (const t of entry.discoveredTools) {
        out.push({
          mcpId: t.mcpId,
          serverName: t.serverName ?? t.mcpId,
          name: t.name,
          description: t.description,
        });
      }
    }
    return out;
  }

  /**
   * Retorna `AcpMcpServer[]` pronto para injeção em `AntigravityAcpService` e `OpenCodeLiveService`,
   * omitindo STDIO com `workingDirectory` e usando URLs do `McpOAuthProxy` para servidores OAuth.
   */
  public getAcpMcpServers(agentId?: string | null): AcpMcpServer[] {
    const servers = usableMcpServers(this.store, agentId);
    return toAcpMcpServers(servers, (server) => {
      if (server.transporte !== "http" || !server.url) return null;
      const hasOAuth =
        server.oauthStatus !== "disconnected" ||
        this.oauthProvider.listOAuthAccounts(server.mcp_id).length > 0;
      if (!hasOAuth) return null;
      if (this.oauthProxy.listeningPort === null) return null;

      return this.oauthProxy.registerServerRoute({
        mcpId: server.mcp_id,
        targetUrl: server.url,
        extraHeaders: server.headers,
      });
    });
  }

  private hasOAuthSession(server: McpServidorConfig): boolean {
    return (
      server.oauthStatus !== "disconnected" ||
      this.oauthProvider.listOAuthAccounts(server.mcp_id).length > 0
    );
  }

  private async ensureClientForServer(
    server: McpServidorConfig,
    accessToken?: string | null
  ): Promise<PooledClientEntry> {
    const fingerprint = buildServerFingerprint(server);
    const headers = { ...server.headers };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const existing = this.pool.get(server.mcp_id);
    if (existing && existing.fingerprint === fingerprint) {
      existing.client.setHeaders(headers);
      if (existing.discoveredTools.length > 0 && !existing.needsSignIn) {
        return existing;
      }
    } else if (existing) {
      existing.client.close();
      this.pool.delete(server.mcp_id);
    }

    const client = new McpClient(toLegacyClientConfig(server, headers), this.fetchImpl);
    await client.connect();

    const discoveredTools: DiscoveredMcpTool[] = client.rawTools.map((tool) => ({
      mcpId: server.mcp_id,
      serverName: server.nome,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    const nextEntry: PooledClientEntry = {
      fingerprint,
      client,
      discoveredTools,
      needsSignIn: false,
    };
    this.pool.set(server.mcp_id, nextEntry);
    return nextEntry;
  }

  /**
   * Descobre/cacheia ferramentas MCP dos servidores autorizados para `agentId`,
   * ignorando servidores offline sem derrubar o turno e registrando `sign_in` quando aplicável.
   */
  public async getToolsForAgent(agentId?: string | null): Promise<ToolDefinition[]> {
    const servers = usableMcpServers(this.store, agentId);
    if (servers.length === 0) return [];

    const collected: DiscoveredMcpTool[] = [];

    await Promise.allSettled(
      servers.map(async (server) => {
        const useOAuth = server.transporte === "http" && this.hasOAuthSession(server);
        let accessToken: string | null = null;

        if (useOAuth) {
          accessToken = await this.oauthProvider.getValidAccessToken(server.mcp_id);
          if (!accessToken) {
            const notice: McpOAuthRequiredNotice = {
              ok: false,
              action: "sign_in",
              mcpId: server.mcp_id,
              nome: server.nome,
              appSlug: server.origemAppSlug,
              motivo: `Sessão OAuth expirada ou ausente para '${server.nome}'.`,
              agentId: agentId ?? null,
            };
            this.onOAuthRequired?.(notice);
            return;
          }
        }

        try {
          const entry = await this.ensureClientForServer(server, accessToken);
          collected.push(...entry.discoveredTools);
        } catch (err) {
          if (err instanceof McpAuthRequiredError) {
            const existing = this.pool.get(server.mcp_id);
            if (existing) existing.needsSignIn = true;

            const discovery = server.url
              ? await discoverOAuthMetadata(server.url, err.wwwAuthenticate, this.fetchImpl).catch(
                  () => null
                )
              : null;

            const notice: McpOAuthRequiredNotice = {
              ok: false,
              action: "sign_in",
              mcpId: server.mcp_id,
              nome: server.nome,
              appSlug: server.origemAppSlug,
              motivo: redactMcpSecrets(
                err.message,
                collectSensitiveSecrets(server, [accessToken])
              ),
              authorizeUrl: discovery?.authorizationEndpoint ?? null,
              agentId: agentId ?? null,
            };
            this.onOAuthRequired?.(notice);
            this.onServerStatusChanged?.({
              mcpId: server.mcp_id,
              ativo: server.ativo,
              oauthStatus: this.oauthProvider.getOAuthStatus(server.mcp_id),
              qtdFerramentas: server.qtdFerramentas,
              ultimoErro: notice.motivo,
            });
          }
          // Servidores offline ou inacessíveis são ignorados silenciosamente sem derrubar o turno
        }
      })
    );

    return toNativeProviderTools(collected).map((tool) => ({
      ...tool,
      parameters: sanitizeJsonSchemaForGemini(tool.parameters),
    }));
  }

  private resolveToolTarget(
    qualifiedToolName: string
  ): { mcpId: string; remoteToolName: string } | null {
    const mapped = resolveMcpToolOrigin(qualifiedToolName);
    if (mapped) return mapped;

    const allActive = this.store.listServers({ includeDisabled: false, resolveSecrets: false });
    for (const server of allActive) {
      const directPrefix = `mcp_${server.mcp_id}_`;
      if (qualifiedToolName.startsWith(directPrefix)) {
        return {
          mcpId: server.mcp_id,
          remoteToolName: qualifiedToolName.slice(directPrefix.length),
        };
      }
    }

    return null;
  }

  /**
   * Executa uma tool MCP validando permissão por agente, injetando Bearer OAuth se aplicável,
   * redigindo qualquer segredo do retorno e convertendo recusas 401/-32001 em `{ ok: false, action: "sign_in", ... }`.
   */
  public async callMcpTool(
    qualifiedToolName: string,
    args: Record<string, unknown>,
    context?: { agentId?: string }
  ): Promise<unknown> {
    const target = this.resolveToolTarget(qualifiedToolName);
    if (!target) {
      throw new Error(`Ferramenta MCP desconhecida: ${qualifiedToolName}`);
    }

    const server = this.store.getServer(target.mcpId, true);
    if (!server || !server.ativo) {
      throw new Error(`Servidor MCP '${target.mcpId}' inativo ou não encontrado.`);
    }

    if (!isAgentAuthorizedForServer(server, context?.agentId)) {
      throw new Error(
        `O agente '${context?.agentId ?? "desconhecido"}' não possui acesso ao servidor MCP '${server.nome}'.`
      );
    }

    const consentDecision = this.approvalService.evaluateExecution({
      agenteId: context?.agentId,
      mcpId: server.mcp_id,
      toolName: target.remoteToolName,
      args,
    });
    if (!consentDecision.allowed) {
      if (consentDecision.requiresConsent) {
        return {
          ok: false,
          requiresConsent: true,
          mcpId: server.mcp_id,
          toolName: target.remoteToolName,
          motivo: consentDecision.reason,
        };
      }
      throw new Error(consentDecision.reason);
    }

    const hasOAuth = server.transporte === "http" && this.hasOAuthSession(server);
    let accessToken = hasOAuth
      ? await this.oauthProvider.getValidAccessToken(server.mcp_id)
      : null;

    if (hasOAuth && !accessToken) {
      const notice: McpOAuthRequiredNotice = {
        ok: false,
        action: "sign_in",
        mcpId: server.mcp_id,
        nome: server.nome,
        appSlug: server.origemAppSlug,
        motivo: `Sessão OAuth expirada ou revogada para '${server.nome}'. Autentique no navegador para continuar.`,
        agentId: context?.agentId ?? null,
      };
      this.onOAuthRequired?.(notice);
      return notice;
    }

    const secrets = collectSensitiveSecrets(server, [accessToken]);

    const invokeOnce = async (token: string | null): Promise<unknown> => {
      const entry = await this.ensureClientForServer(server, token);
      const rawOutput = await entry.client.callTool(target.remoteToolName, args);
      return redactMcpPayload(rawOutput, collectSensitiveSecrets(server, [token]));
    };

    try {
      return await invokeOnce(accessToken);
    } catch (err) {
      if (err instanceof McpAuthRequiredError) {
        if (accessToken) {
          const renewed = await this.oauthProvider.refreshAfterUnauthorized(
            server.mcp_id,
            accessToken
          );
          if (renewed) {
            accessToken = renewed;
            secrets.push(renewed);
            try {
              return await invokeOnce(renewed);
            } catch (retryErr) {
              if (!(retryErr instanceof McpAuthRequiredError)) {
                const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                throw new Error(redactMcpSecrets(msg, secrets));
              }
              this.oauthProvider.markAccountLost(server.mcp_id);
            }
          }
        }

        const discovery = server.url
          ? await discoverOAuthMetadata(server.url, err.wwwAuthenticate, this.fetchImpl).catch(
              () => null
            )
          : null;

        const notice: McpOAuthRequiredNotice = {
          ok: false,
          action: "sign_in",
          mcpId: server.mcp_id,
          nome: server.nome,
          appSlug: server.origemAppSlug,
          motivo: redactMcpSecrets(err.message, secrets),
          authorizeUrl: discovery?.authorizationEndpoint ?? null,
          agentId: context?.agentId ?? null,
        };
        this.onOAuthRequired?.(notice);
        return notice;
      }

      const rawMessage = err instanceof Error ? err.message : String(err);
      throw new Error(redactMcpSecrets(rawMessage, secrets));
    }
  }

  /**
   * Testa um servidor já salvo, atualiza diagnóstico em `projecao_mcp_servidores` e emite status.
   */
  public async testServer(mcpId: string): Promise<McpProbeResultado> {
    const server = this.store.getServer(mcpId, true);
    if (!server) {
      return {
        status: "failed",
        toolCount: 0,
        toolNames: [],
        needs: null,
        error: `Servidor MCP '${mcpId}' não encontrado.`,
        durationMs: 0,
      };
    }

    const accessToken =
      server.transporte === "http"
        ? await this.oauthProvider.getValidAccessToken(server.mcp_id)
        : null;

    const result = await inspectMcpServer(server, {
      accessToken: accessToken ?? undefined,
      fetchImpl: this.fetchImpl,
    });

    const updated = this.store.recordProbeResult(mcpId, result);
    this.invalidateServer(mcpId);
    this.refreshProxyRoutes();

    if (updated) {
      this.onServerStatusChanged?.({
        mcpId: updated.mcp_id,
        ativo: updated.ativo,
        oauthStatus: this.oauthProvider.getOAuthStatus(updated.mcp_id),
        qtdFerramentas: updated.qtdFerramentas,
        ultimoErro: updated.ultimoErro,
      });
    }

    return result;
  }

  /**
   * Testa um rascunho de servidor antes de salvá-lo, resolvendo eventuais máscaras se houver `mcp_id`.
   */
  public async testDraft(draft: Partial<McpServidorConfig>): Promise<McpProbeResultado> {
    let configToTest: Partial<McpServidorConfig> = { ...draft };
    let accessToken: string | null = null;

    if (typeof draft.mcp_id === "string" && draft.mcp_id.trim().length > 0) {
      const existing = this.store.getServer(draft.mcp_id.trim(), true);
      if (existing) {
        const mergeRecord = (
          nextRec: Record<string, string> | undefined,
          oldRec: Record<string, string>
        ) => {
          if (!nextRec) return oldRec;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(nextRec)) {
            if (
              (v === MASKED_SECRET_VALUE || v === SECRET_REDACTED_PLACEHOLDER) &&
              typeof oldRec[k] === "string"
            ) {
              out[k] = oldRec[k];
            } else {
              out[k] = v;
            }
          }
          return out;
        };

        configToTest = {
          ...existing,
          ...draft,
          env: mergeRecord(draft.env, existing.env),
          headers: mergeRecord(draft.headers, existing.headers),
        };

        if (configToTest.transporte !== "stdio") {
          accessToken = await this.oauthProvider.getValidAccessToken(existing.mcp_id);
        }
      }
    }

    return await inspectMcpServer(configToTest, {
      accessToken: accessToken ?? undefined,
      fetchImpl: this.fetchImpl,
    });
  }
}
