import {
  normalizeWhatsAppPairingPhone,
  type MarketplaceSourceFilter,
  type MarketplaceTab,
  type McpAcessoAgentes,
  type McpServidorConfig,
  type WhatsAppConfigPayload,
  type WhatsAppMetodoPareamento,
  type WhatsAppModoOperacao,
  type WhatsAppPairingStatus,
} from "@criativo/contracts";
import { maskMcpServerForClient, redactMcpPayload } from "../../mcp/mcp-redaction.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { escapeHtml, extractMcpIdSegment, normalizeMcpRequestBody, resolveCallbackBaseUrl, sendError, sendHtml } from "./whatsapp-mcp-store-helpers.ts";

export async function tryHandleMcpRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, wsHub } = ctx;
  const { sendJson, readJsonBody } = deps;

  // ====================================================================
  // 2. MCP GATEWAY & OAUTH 2.1 (/api/mcps/* e /api/mcps/servidores/*)
  // ====================================================================
  if (path === "/api/mcps" || path.startsWith("/api/mcps/")) {
    if (!deps.mcpGateway) {
      sendJson(res, 503, { erro: "McpGateway não inicializado neste servidor." });
      return true;
    }
    const mcpGateway = deps.mcpGateway;

    // Callback OAuth 2.1 PKCE (deve vir antes dos matchers genéricos de :mcpId)
    if (method === "GET" && path === "/api/mcps/oauth/callback") {
      const code = url.searchParams.get("code") ?? undefined;
      const state = url.searchParams.get("state") ?? undefined;
      const error = url.searchParams.get("error") ?? undefined;
      const errorDescription = url.searchParams.get("error_description") ?? undefined;

      try {
        const result = await mcpGateway.oauthProvider.handleCallback({
          code,
          state,
          error,
          errorDescription,
        });
        mcpGateway.invalidateServer(result.mcpId);
        mcpGateway.refreshProxyRoutes();

        const server = mcpGateway.store.getServer(result.mcpId, false);
        wsHub.broadcast("mcp.oauth_concluido", {
          mcp_id: result.mcpId,
          sucesso: true,
          conta_chave: result.contaChave,
          erro: null,
        });
        wsHub.broadcast("mcp.status_atualizado", {
          mcp_id: result.mcpId,
          ativo: server?.ativo ?? true,
          oauth_status: mcpGateway.oauthProvider.getOAuthStatus(result.mcpId),
          qtd_ferramentas: server?.qtdFerramentas ?? 0,
          ultimo_erro: null,
        });

        const safeLabel = escapeHtml(server?.nome ?? result.mcpId);
        sendHtml(
          res,
          200,
          `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Autenticação concluída</title></head><body style="background:#1A1A1A;color:#F0F0F0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="background:#212121;border:1px solid #303030;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600">Autenticação concluída</h2><p style="margin:0 0 16px;color:#A1A1A1;font-size:14px">Conexão OAuth autorizada para <strong>${safeLabel}</strong>. Você já pode fechar esta janela e retornar ao CriativoOS.</p><script>setTimeout(function(){try{window.close()}catch(e){}},400)</script></div></body></html>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha ao concluir autenticação OAuth.";
        const safeMsg = escapeHtml(msg);
        sendHtml(
          res,
          400,
          `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Falha na autenticação</title></head><body style="background:#1A1A1A;color:#F0F0F0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="background:#212121;border:1px solid #4A2428;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600">Falha na autenticação</h2><p style="margin:0;color:#EF5350;font-size:14px">${safeMsg}</p></div></body></html>`
        );
      }
      return true;
    }

    if (method === "POST" && path === "/api/mcps/testar-rascunho") {
      try {
        const body = await readJsonBody(req);
        const draft = normalizeMcpRequestBody(body);
        const resultado = await mcpGateway.testDraft(draft);
        sendJson(res, 200, redactMcpPayload({ ...resultado, resultado }, []));
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    // Listagem & criação (/api/mcps/servidores e alias /api/mcps)
    if ((path === "/api/mcps/servidores" || path === "/api/mcps") && method === "GET") {
      const agentId = url.searchParams.get("agenteId") ?? url.searchParams.get("agentId");
      const servidores = mcpGateway.store
        .listServersForClient({
          includeDisabled: true,
          agentId: agentId || undefined,
        })
        .map((srv) => ({
          ...maskMcpServerForClient(srv),
          oauthStatus: mcpGateway.oauthProvider.getOAuthStatus(srv.mcp_id),
          oauthAccounts: mcpGateway.oauthProvider.listOAuthAccounts(srv.mcp_id),
        }));
      sendJson(res, 200, { servidores });
      return true;
    }

    if ((path === "/api/mcps/servidores" || path === "/api/mcps") && method === "POST") {
      try {
        const body = await readJsonBody(req);
        const payload = normalizeMcpRequestBody(body);
        const saved = mcpGateway.store.saveServer(payload);
        mcpGateway.invalidateServer(saved.mcp_id);
        mcpGateway.refreshProxyRoutes();

        const probe =
          body.testar === true || body.probe === true
            ? await mcpGateway.testServer(saved.mcp_id)
            : undefined;
        const latest = mcpGateway.store.getServer(saved.mcp_id, false) ?? saved;
        const oauthStatus = mcpGateway.oauthProvider.getOAuthStatus(saved.mcp_id);

        wsHub.broadcast("mcp.status_atualizado", {
          mcp_id: latest.mcp_id,
          ativo: latest.ativo,
          oauth_status: oauthStatus,
          qtd_ferramentas: probe?.toolCount ?? latest.qtdFerramentas,
          ultimo_erro: latest.ultimoErro ?? null,
        });

        sendJson(
          res,
          201,
          redactMcpPayload(
            {
              servidor: maskMcpServerForClient({ ...latest, oauthStatus }),
              ...(probe ? { probe } : {}),
            },
            []
          )
        );
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    // Testar servidor salvo (/api/mcps/servidores/:mcpId/testar e alias /api/mcps/:mcpId/testar)
    const testMcpId = extractMcpIdSegment(path, "/testar");
    if (method === "POST" && testMcpId) {
      const existing = mcpGateway.store.getServer(testMcpId, false);
      if (!existing) {
        sendJson(res, 404, { erro: `Servidor MCP '${testMcpId}' não encontrado.` });
        return true;
      }
      const resultado = await mcpGateway.testServer(testMcpId);
      const updated = mcpGateway.store.getServer(testMcpId, false) ?? existing;
      sendJson(
        res,
        200,
        redactMcpPayload(
          {
            ...resultado,
            resultado,
            servidor: maskMcpServerForClient({
              ...updated,
              oauthStatus: mcpGateway.oauthProvider.getOAuthStatus(testMcpId),
            }),
          },
          []
        )
      );
      return true;
    }

    // Alternar ativo e/ou acesso_json
    const activeMcpId = extractMcpIdSegment(path, "/ativo");
    if ((method === "PATCH" || method === "PUT") && activeMcpId) {
      try {
        const body = await readJsonBody(req);
        const existing = mcpGateway.store.getServer(activeMcpId, false);
        if (!existing) {
          sendJson(res, 404, { erro: `Servidor MCP '${activeMcpId}' não encontrado.` });
          return true;
        }

        if (typeof body.ativo === "boolean") {
          mcpGateway.store.setServerEnabled(activeMcpId, body.ativo);
        }
        const acessoInput = (body.acesso ?? body.acesso_json) as McpAcessoAgentes | undefined;
        if (acessoInput && typeof acessoInput === "object") {
          mcpGateway.store.setServerAccess(activeMcpId, {
            mode: acessoInput.mode === "agents" ? "agents" : "everyone",
            agentIds: Array.isArray(acessoInput.agentIds) ? acessoInput.agentIds : [],
          });
        }

        mcpGateway.invalidateServer(activeMcpId);
        mcpGateway.refreshProxyRoutes();

        const updated = mcpGateway.store.getServer(activeMcpId, false)!;
        const oauthStatus = mcpGateway.oauthProvider.getOAuthStatus(activeMcpId);
        wsHub.broadcast("mcp.status_atualizado", {
          mcp_id: updated.mcp_id,
          ativo: updated.ativo,
          oauth_status: oauthStatus,
          qtd_ferramentas: updated.qtdFerramentas,
          ultimo_erro: updated.ultimoErro ?? null,
        });

        sendJson(res, 200, {
          servidor: maskMcpServerForClient({ ...updated, oauthStatus }),
        });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    // Iniciar OAuth 2.1 PKCE
    const oauthInitMcpId = extractMcpIdSegment(path, "/oauth/iniciar");
    if (method === "POST" && oauthInitMcpId) {
      const server = mcpGateway.store.getServer(oauthInitMcpId, false);
      if (!server) {
        sendJson(res, 404, { erro: `Servidor MCP '${oauthInitMcpId}' não encontrado.` });
        return true;
      }
      if (server.transporte !== "http" || !server.url) {
        sendJson(res, 400, {
          erro: "Apenas servidores MCP Streamable HTTP suportam autenticação OAuth 2.1.",
        });
        return true;
      }

      try {
        const body = await readJsonBody(req);
        const useLoopbackListener = body.useLoopbackListener === true;
        const callbackBaseUrl =
          typeof body.callbackBaseUrl === "string" && body.callbackBaseUrl.trim()
            ? body.callbackBaseUrl.trim()
            : resolveCallbackBaseUrl(req);

        const started = await mcpGateway.oauthProvider.startAuthorizationFlow({
          mcpId: server.mcp_id,
          appSlug: server.origemAppSlug,
          serverUrl: server.url,
          contaChave: typeof body.contaChave === "string" ? body.contaChave : undefined,
          callbackBaseUrl,
          useLoopbackListener,
          clientIdOverride:
            typeof body.clientIdOverride === "string" ? body.clientIdOverride : undefined,
          clientSecretOverride:
            typeof body.clientSecretOverride === "string" ? body.clientSecretOverride : undefined,
          scopes: Array.isArray(body.scopes)
            ? body.scopes.filter((s): s is string => typeof s === "string")
            : undefined,
        });

        wsHub.broadcast("mcp.status_atualizado", {
          mcp_id: server.mcp_id,
          ativo: server.ativo,
          oauth_status: "signing_in",
          qtd_ferramentas: server.qtdFerramentas,
          ultimo_erro: null,
        });

        sendJson(res, 200, {
          ok: true,
          mcpId: server.mcp_id,
          authorizeUrl: started.authorizeUrl,
          state: started.state,
          redirectUri: started.redirectUri,
          contaChave: started.contaChave,
          callbackMode: useLoopbackListener ? "loopback" : "daemon",
        });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    // Desconectar / revogar OAuth
    const oauthDiscMcpId = extractMcpIdSegment(path, "/oauth/desconectar");
    if (method === "POST" && oauthDiscMcpId) {
      const server = mcpGateway.store.getServer(oauthDiscMcpId, false);
      if (!server) {
        sendJson(res, 404, { erro: `Servidor MCP '${oauthDiscMcpId}' não encontrado.` });
        return true;
      }
      const body = await readJsonBody(req);
      const contaChave = typeof body.contaChave === "string" ? body.contaChave : undefined;
      await mcpGateway.oauthProvider.signOut(oauthDiscMcpId, contaChave);
      mcpGateway.invalidateServer(oauthDiscMcpId);
      mcpGateway.refreshProxyRoutes();

      const oauthStatus = mcpGateway.oauthProvider.getOAuthStatus(oauthDiscMcpId);
      wsHub.broadcast("mcp.status_atualizado", {
        mcp_id: oauthDiscMcpId,
        ativo: server.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: server.qtdFerramentas,
        ultimo_erro: null,
      });

      sendJson(res, 200, { ok: true, mcpId: oauthDiscMcpId, oauthStatus });
      return true;
    }

    // GET / PUT / PATCH / DELETE por :mcpId
    const itemMcpId = extractMcpIdSegment(path);
    if (itemMcpId && (method === "GET" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
      const existing = mcpGateway.store.getServer(itemMcpId, false);
      if (!existing) {
        sendJson(res, 404, { erro: `Servidor MCP '${itemMcpId}' não encontrado.` });
        return true;
      }

      if (method === "GET") {
        const oauthStatus = mcpGateway.oauthProvider.getOAuthStatus(itemMcpId);
        sendJson(res, 200, {
          servidor: maskMcpServerForClient({ ...existing, oauthStatus }),
          oauthAccounts: mcpGateway.oauthProvider.listOAuthAccounts(itemMcpId),
        });
        return true;
      }

      if (method === "DELETE") {
        await mcpGateway.oauthProvider.signOut(itemMcpId).catch(() => undefined);
        mcpGateway.invalidateServer(itemMcpId);
        const removed = mcpGateway.store.removeServer(itemMcpId);
        mcpGateway.refreshProxyRoutes();
        wsHub.broadcast("mcp.status_atualizado", {
          mcp_id: itemMcpId,
          ativo: false,
          oauth_status: "disconnected",
          qtd_ferramentas: 0,
          ultimo_erro: null,
        });
        sendJson(res, removed ? 200 : 404, { ok: removed, mcp_id: itemMcpId });
        return true;
      }

      try {
        const body = await readJsonBody(req);
        const payload = normalizeMcpRequestBody(body, existing);
        payload.mcp_id = itemMcpId;
        const updated = mcpGateway.store.saveServer(payload);
        mcpGateway.invalidateServer(itemMcpId);
        mcpGateway.refreshProxyRoutes();
        const oauthStatus = mcpGateway.oauthProvider.getOAuthStatus(itemMcpId);

        wsHub.broadcast("mcp.status_atualizado", {
          mcp_id: updated.mcp_id,
          ativo: updated.ativo,
          oauth_status: oauthStatus,
          qtd_ferramentas: updated.qtdFerramentas,
          ultimo_erro: updated.ultimoErro ?? null,
        });

        sendJson(res, 200, {
          servidor: maskMcpServerForClient({ ...updated, oauthStatus }),
        });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }
  }

  return false;
}
