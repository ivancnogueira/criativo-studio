import type { RemoteClaimService } from "../../servers/remote-claim-service.ts";
import type { RemoteOAuthBridgeService } from "../../servers/remote-oauth-bridge.ts";
import { ServerQuotaExceededError } from "../../servers/server-quota.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

export async function tryHandleServersRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;

  // 0.5 Multi-Servidores Local & Pareamento VPS (Fase 17)
  if (method === "GET" && path === "/api/studio/servers") {
    if (!deps.localServerManager) {
      sendJson(res, 200, { servers: [], active_server_id: "primary", quota: null });
      return true;
    }
    sendJson(res, 200, {
      servers: deps.localServerManager.listServers(),
      active_server_id: deps.localServerManager.getActiveServerId(),
      quota: deps.localServerManager.getQuotaSummary(),
    });
    return true;
  }

  if (method === "POST" && path === "/api/studio/servers/local") {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível em processo filho." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const server = await deps.localServerManager.createLocalServer({
        nome: String(body.nome ?? ""),
        cor_hex: typeof body.cor_hex === "string" ? body.cor_hex : undefined,
      });
      sendJson(res, 201, {
        ok: true,
        server,
        servers: deps.localServerManager.listServers(),
        quota: deps.localServerManager.getQuotaSummary(),
      });
    } catch (err) {
      if (err instanceof ServerQuotaExceededError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code, quota: err.quota });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "POST" && path === "/api/studio/servers/claims") {
    if (!deps.remoteClaimService) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const claim = await deps.remoteClaimService.createRemoteClaim(
        typeof body.server_name === "string" && body.server_name.trim()
          ? body.server_name.trim()
          : "Servidor VPS",
      );
      sendJson(res, 201, { ok: true, claim });
    } catch (err) {
      if (err instanceof ServerQuotaExceededError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code, quota: err.quota });
        return true;
      }
      throw err;
    }
    return true;
  }

  const claimPollMatch = path.match(/^\/api\/studio\/servers\/claims\/([^/]+)$/);
  if (method === "GET" && claimPollMatch) {
    if (!deps.remoteClaimService) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const claim = await deps.remoteClaimService.pollRemoteClaim(decodeURIComponent(claimPollMatch[1]));
    sendJson(res, 200, { ok: true, claim });
    return true;
  }

  if (method === "POST" && path === "/api/studio/servers/join") {
    if (!deps.remoteClaimService || !deps.localServerManager) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const server = await deps.remoteClaimService.joinServerByInviteOrDirect({
        invite_url: typeof body.invite_url === "string" ? body.invite_url : undefined,
        nome: typeof body.nome === "string" ? body.nome : undefined,
        base_url: typeof body.base_url === "string" ? body.base_url : undefined,
        access_token: typeof body.access_token === "string" ? body.access_token : undefined,
      });
      sendJson(res, 201, {
        ok: true,
        server,
        servers: deps.localServerManager.listServers(),
        quota: deps.localServerManager.getQuotaSummary(),
      });
    } catch (err) {
      if (err instanceof ServerQuotaExceededError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code, quota: err.quota });
        return true;
      }
      throw err;
    }
    return true;
  }

  const serverSelectMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/select$/);
  if (method === "POST" && serverSelectMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const server = await deps.localServerManager.selectActiveServer(decodeURIComponent(serverSelectMatch[1]));
    sendJson(res, 200, {
      ok: true,
      server,
      active_server_id: server.server_id,
      servers: deps.localServerManager.listServers(),
    });
    return true;
  }

  const serverRestartMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/restart$/);
  if (method === "POST" && serverRestartMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(serverRestartMatch[1]);
    await deps.localServerManager.stopLocalChild(srvId);
    const server = await deps.localServerManager.ensureRunning(srvId);
    sendJson(res, 200, { ok: true, server });
    return true;
  }

  const serverInviteMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/invite$/);
  if (method === "POST" && serverInviteMatch) {
    if (!deps.remoteClaimService) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const invite = deps.remoteClaimService.createServerInvite(decodeURIComponent(serverInviteMatch[1]));
    sendJson(res, 200, { ok: true, invite });
    return true;
  }

  const oauthBridgeMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/oauth-bridge$/);
  if (method === "POST" && oauthBridgeMatch) {
    if (!deps.remoteOAuthBridge) {
      sendJson(res, 503, { erro: "RemoteOAuthBridgeService indisponível neste servidor." });
      return true;
    }
    const srvId = decodeURIComponent(oauthBridgeMatch[1]);
    const body = await readJsonBody(req);
    const provedor = body.provedor === "claude" || body.provedor === "openai" ? body.provedor : null;
    const authUrl = typeof body.auth_url === "string" ? body.auth_url.trim() : "";
    if (!provedor || !authUrl) {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'provedor' ('claude' | 'openai') e 'auth_url'." });
      return true;
    }
    const prepared = await deps.remoteOAuthBridge.prepareBridgeForAuthUrl({
      serverId: srvId,
      provedor,
      authUrl,
    });
    sendJson(res, 200, prepared);
    return true;
  }

  const remoteGeminiMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/connect-gemini-via-desktop$/);
  if (method === "POST" && remoteGeminiMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(remoteGeminiMatch[1]);
    const targetSrv = deps.localServerManager.getServer(srvId);
    if (!targetSrv) {
      sendJson(res, 404, { erro: `Servidor '${srvId}' não encontrado.` });
      return true;
    }
    const body = await readJsonBody(req);
    const label = typeof body.label === "string" ? body.label : undefined;

    try {
      const exported = await providerConnection
        .getAntigravityService()
        .signInIsolatedForRemoteExport(label, (url) => {
          wsHub.broadcast("provider:auth_url", { provedor: "gemini", url });
        });

      const accessToken = deps.localServerManager.getServerAccessToken(targetSrv.server_id);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const syncedCertB64 = deps.licenseService?.exportCertificateForPeerSync();
      if (syncedCertB64) {
        headers["X-Criativo-Synced-License"] = syncedCertB64;
      }

      const upstreamRes = await fetch(
        `${targetSrv.base_url.replace(/\/+$/, "")}/api/provedores/gemini/contas`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: exported.email,
            label: exported.label,
            access_token: exported.accessToken,
            refresh_token: exported.refreshToken,
            expiry: exported.expiry,
            ...(exported.acpModels ? { acp_models: exported.acpModels } : {}),
            ...(exported.acpDefaultModelId ? { acp_default_model_id: exported.acpDefaultModelId } : {}),
          }),
        }
      );
      const upstreamPayload = (await upstreamRes.json().catch(() => ({}))) as {
        conta?: unknown;
        provedores?: unknown;
        uso?: unknown;
        erro?: string;
      };
      if (!upstreamRes.ok) {
        sendJson(res, upstreamRes.status, {
          ok: false,
          erro: upstreamPayload.erro ?? `Falha ao enviar conta Google para '${targetSrv.nome}'.`,
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        conta: upstreamPayload.conta,
        provedores: upstreamPayload.provedores,
        uso: upstreamPayload.uso,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível autenticar sua conta Google pelo Desktop para o servidor remoto.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const remoteOpenAiMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/connect-openai-via-desktop$/);
  if (method === "POST" && remoteOpenAiMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(remoteOpenAiMatch[1]);
    const targetSrv = deps.localServerManager.getServer(srvId);
    if (!targetSrv) {
      sendJson(res, 404, { erro: `Servidor '${srvId}' não encontrado.` });
      return true;
    }
    const body = await readJsonBody(req);
    const label = typeof body.label === "string" ? body.label : undefined;

    try {
      const exported = await providerConnection
        .getCliOAuthService()
        .signInCodexIsolatedForRemoteExport(label, (url) => {
          wsHub.broadcast("provider:auth_url", { provedor: "openai", url });
        });

      const accessToken = deps.localServerManager.getServerAccessToken(targetSrv.server_id);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const syncedCertB64 = deps.licenseService?.exportCertificateForPeerSync();
      if (syncedCertB64) {
        headers["X-Criativo-Synced-License"] = syncedCertB64;
      }

      const upstreamRes = await fetch(
        `${targetSrv.base_url.replace(/\/+$/, "")}/api/provedores/openai/contas-auth`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            auth_json: exported.authJson,
            email: exported.email,
            plano: exported.plano,
            label: exported.label,
          }),
        }
      );
      const upstreamPayload = (await upstreamRes.json().catch(() => ({}))) as {
        conta?: unknown;
        provedores?: unknown;
        uso?: unknown;
        erro?: string;
      };
      if (!upstreamRes.ok) {
        sendJson(res, upstreamRes.status, {
          ok: false,
          erro: upstreamPayload.erro ?? `Falha ao enviar sessão ChatGPT para '${targetSrv.nome}'.`,
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        conta: upstreamPayload.conta,
        provedores: upstreamPayload.provedores,
        uso: upstreamPayload.uso,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível autenticar sua conta ChatGPT pelo Desktop para o servidor remoto.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const serverSingleMatch = path.match(/^\/api\/studio\/servers\/([^/]+)$/);
  if (serverSingleMatch && (method === "PATCH" || method === "DELETE")) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(serverSingleMatch[1]);
    if (method === "PATCH") {
      const body = await readJsonBody(req);
      const server = deps.localServerManager.renameOrUpdateServer(srvId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        cor_hex: typeof body.cor_hex === "string" ? body.cor_hex : undefined,
      });
      sendJson(res, 200, { ok: true, server, servers: deps.localServerManager.listServers() });
      return true;
    }
    const deleteFiles = url.searchParams.get("delete_files") === "1";
    await deps.localServerManager.deleteServer(srvId, deleteFiles);
    sendJson(res, 200, {
      ok: true,
      servers: deps.localServerManager.listServers(),
      active_server_id: deps.localServerManager.getActiveServerId(),
    });
    return true;
  }


  return false;
}
