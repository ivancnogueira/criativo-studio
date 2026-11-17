import type { IncomingMessage, ServerResponse } from "node:http";
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
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WhatsAppArchiveService,
  WhatsAppSenderRules,
} from "@criativo/whatsapp";
import { CatalogServiceError, type ConnectCatalogAppInput } from "../marketplace/catalog-service.ts";
import { GithubImportError } from "../marketplace/github-importer.ts";
import { SkillsManagerError } from "../marketplace/skills-manager.ts";
import { maskMcpServerForClient, redactMcpPayload } from "../mcp/mcp-redaction.ts";
import { McpServerStoreError } from "../mcp/mcp-server-store.ts";
import type { StudioRoutesDeps } from "./studio-routes.ts";
import { resolveSafeStudioMediaPath } from "./studio-tools-bridge.ts";

const RESERVED_MCP_PATH_SEGMENTS = new Set(["oauth", "testar-rascunho", "servidores"]);

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  res.end(html);
}

function resolveCallbackBaseUrl(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protoRaw = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = protoRaw?.split(",")[0]?.trim().toLowerCase() === "https" ? "https" : "http";

  const forwardedHost = req.headers["x-forwarded-host"];
  const hostRaw = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const host = (hostRaw?.split(",")[0]?.trim() || req.headers.host || "127.0.0.1:3000").trim();

  return `${proto}://${host}`;
}

function normalizeMcpRequestBody(
  body: Record<string, unknown>,
  existing?: McpServidorConfig | null
): Partial<McpServidorConfig> {
  const rawAcesso = (body.acesso ?? body.access ?? body.acesso_json) as
    | Partial<McpAcessoAgentes>
    | undefined;

  const transporte =
    body.transporte === "http" || body.transport === "http"
      ? "http"
      : body.transporte === "stdio" || body.transport === "stdio"
        ? "stdio"
        : existing?.transporte;

  return {
    ...(existing ?? {}),
    ...(typeof body.mcp_id === "string" ? { mcp_id: body.mcp_id } : {}),
    ...(typeof body.nome === "string"
      ? { nome: body.nome }
      : typeof body.name === "string"
        ? { nome: body.name }
        : {}),
    ...(transporte ? { transporte } : {}),
    ...(typeof body.comando === "string"
      ? { comando: body.comando }
      : typeof body.command === "string"
        ? { comando: body.command }
        : {}),
    ...(Array.isArray(body.args)
      ? { args: body.args.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(body.env && typeof body.env === "object" && !Array.isArray(body.env)
      ? { env: body.env as Record<string, string> }
      : {}),
    ...(Array.isArray(body.envPassthrough ?? body.env_passthrough)
      ? {
          envPassthrough: ((body.envPassthrough ?? body.env_passthrough) as unknown[]).filter(
            (item): item is string => typeof item === "string"
          ),
        }
      : {}),
    ...(body.workingDirectory !== undefined || body.working_directory !== undefined
      ? {
          workingDirectory:
            typeof (body.workingDirectory ?? body.working_directory) === "string"
              ? String(body.workingDirectory ?? body.working_directory)
              : null,
        }
      : {}),
    ...(body.url !== undefined ? { url: typeof body.url === "string" ? body.url : null } : {}),
    ...(body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
      ? { headers: body.headers as Record<string, string> }
      : {}),
    ...(rawAcesso && typeof rawAcesso === "object"
      ? {
          acesso: {
            mode: rawAcesso.mode === "agents" ? "agents" : "everyone",
            agentIds: Array.isArray(rawAcesso.agentIds)
              ? rawAcesso.agentIds.filter((id): id is string => typeof id === "string")
              : [],
          },
        }
      : {}),
    ...(typeof body.ativo === "boolean" ? { ativo: body.ativo } : {}),
  };
}

function mapDomainErrorStatus(err: unknown): { statusCode: number; message: string; code?: string; fieldErrors?: Record<string, string> } {
  if (err instanceof McpServerStoreError) {
    return { statusCode: 400, message: err.message, fieldErrors: err.fieldErrors };
  }
  if (err instanceof SkillsManagerError) {
    const statusCode =
      err.code === "SKILL_NOT_FOUND" || err.code === "AGENT_NOT_FOUND"
        ? 404
        : err.code === "SKILL_ALREADY_EXISTS"
          ? 409
          : 400;
    return { statusCode, message: err.message, code: err.code };
  }
  if (err instanceof CatalogServiceError) {
    const statusCode =
      err.code === "APP_NOT_FOUND" ||
      err.code === "AGENT_NOT_FOUND" ||
      err.code === "AGENT_PACKAGE_NOT_FOUND"
        ? 404
        : 400;
    return { statusCode, message: err.message, code: err.code };
  }
  if (err instanceof GithubImportError) {
    return { statusCode: 400, message: err.message, code: err.code };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const statusCode = /não encontrad[oa]/i.test(msg) ? 404 : 400;
  return { statusCode, message: msg };
}

function sendError(res: ServerResponse, sendJson: StudioRoutesDeps["sendJson"], err: unknown): void {
  const mapped = mapDomainErrorStatus(err);
  sendJson(res, mapped.statusCode, {
    erro: mapped.message,
    ...(mapped.code ? { codigo: mapped.code } : {}),
    ...(mapped.fieldErrors ? { fieldErrors: mapped.fieldErrors } : {}),
  });
}

function extractMcpIdSegment(
  path: string,
  suffix = ""
): string | null {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const primaryMatch = path.match(new RegExp(`^/api/mcps/servidores/([^/]+)${escapedSuffix}$`));
  if (primaryMatch) {
    return decodeURIComponent(primaryMatch[1]);
  }
  const aliasMatch = path.match(new RegExp(`^/api/mcps/([^/]+)${escapedSuffix}$`));
  if (aliasMatch) {
    const candidate = decodeURIComponent(aliasMatch[1]);
    if (!RESERVED_MCP_PATH_SEGMENTS.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Roteador modular da Fase 10:
 * - WhatsApp multi-número (`/api/mensageria/whatsapp/contas/*`)
 * - MCP Gateway & OAuth 2.1 (`/api/mcps/*` com aliases `/api/mcps/servidores/*`)
 * - Loja Unificada (`/api/loja/*`: Apps, Agentes, Habilidades, GitHub)
 */
export async function tryHandleWhatsAppMcpStoreRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: StudioRoutesDeps
): Promise<boolean> {
  const { db, sendJson, readJsonBody, wsHub } = deps;
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();

  // ====================================================================
  // 1. WHATSAPP MULTI-NÚMERO (/api/mensageria/whatsapp/contas...)
  // ====================================================================
  if (path.startsWith("/api/mensageria/whatsapp/contas")) {
    if (!deps.whatsappManager) {
      sendJson(res, 503, { erro: "Gerenciador WhatsApp não inicializado neste servidor." });
      return true;
    }

    const senderRules = new WhatsAppSenderRules(db.connection);
    const archiveService = new WhatsAppArchiveService({
      db: db.connection,
      workspaceRoot,
    });

    if (method === "GET" && path === "/api/mensageria/whatsapp/contas") {
      sendJson(res, 200, { contas: deps.whatsappManager.listAccounts() });
      return true;
    }

    if (method === "POST" && path === "/api/mensageria/whatsapp/contas") {
      try {
        const body = await readJsonBody(req);
        const rotulo = typeof body.rotulo === "string" ? body.rotulo.trim() : "";
        if (!rotulo) {
          sendJson(res, 400, { erro: "Campo obrigatório: 'rotulo'." });
          return true;
        }
        const conta = deps.whatsappManager.createAccount({
          contaId: typeof body.contaId === "string" ? body.contaId : typeof body.conta_id === "string" ? body.conta_id : undefined,
          rotulo,
          modo_operacao:
            body.modo_operacao === "ownNumber" || body.modo_operacao === "dedicated"
              ? (body.modo_operacao as WhatsAppModoOperacao)
              : "dedicated",
          notificar_aprovacoes:
            typeof body.notificar_aprovacoes === "boolean" ? body.notificar_aprovacoes : true,
          codigo_autorizacao_obrigatorio:
            typeof body.codigo_autorizacao_obrigatorio === "boolean"
              ? body.codigo_autorizacao_obrigatorio
              : true,
          grupo_auto_responder:
            typeof body.grupo_auto_responder === "boolean" ? body.grupo_auto_responder : false,
          agente_orquestrador_id:
            typeof body.agente_orquestrador_id === "string" || body.agente_orquestrador_id === null
              ? body.agente_orquestrador_id
              : "estrategista",
        });

        wsHub.broadcast("whatsapp.conta_atualizada", {
          conta_id: conta.conta_id,
          status: conta.status,
          qrcode_base64: conta.qrcode_base64,
          pairing_code: conta.pairing_code,
          numero_telefone: conta.numero_telefone,
          ultimo_erro: conta.ultimo_erro,
        });

        sendJson(res, 201, { conta });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const accountMatch = path.match(/^\/api\/mensageria\/whatsapp\/contas\/([^/]+)$/);
    if (accountMatch && (method === "PATCH" || method === "DELETE")) {
      const contaId = decodeURIComponent(accountMatch[1]);
      if (method === "DELETE") {
        const removed = await deps.whatsappManager.deleteAccount(contaId);
        if (!removed) {
          sendJson(res, 404, { erro: `Conta WhatsApp '${contaId}' não encontrada.` });
          return true;
        }
        sendJson(res, 200, { ok: true, conta_id: contaId });
        return true;
      }

      const body = await readJsonBody(req);
      const updated = deps.whatsappManager.updateAccount(contaId, body as WhatsAppConfigPayload);
      if (!updated) {
        sendJson(res, 404, { erro: `Conta WhatsApp '${contaId}' não encontrada.` });
        return true;
      }

      wsHub.broadcast("whatsapp.conta_atualizada", {
        conta_id: updated.conta_id,
        status: updated.status,
        qrcode_base64: updated.qrcode_base64,
        pairing_code: updated.pairing_code,
        numero_telefone: updated.numero_telefone,
        ultimo_erro: updated.ultimo_erro,
      });
      sendJson(res, 200, { conta: updated });
      return true;
    }

    const connectMatch = path.match(/^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/conectar$/);
    if (method === "POST" && connectMatch) {
      const contaId = decodeURIComponent(connectMatch[1]);
      const body = await readJsonBody(req);
      const mode: WhatsAppMetodoPareamento =
        body.mode === "pairing_code" ? "pairing_code" : "qr";
      const phoneNumber =
        typeof body.phoneNumber === "string"
          ? body.phoneNumber
          : typeof body.phone_number === "string"
            ? body.phone_number
            : undefined;

      try {
        if (mode === "pairing_code") {
          normalizeWhatsAppPairingPhone(phoneNumber ?? "");
        }
        const status = await deps.whatsappManager.connectAccount(contaId, {
          mode,
          phoneNumber,
        });
        const conta = deps.whatsappManager.getAccount(contaId);
        sendJson(res, 200, { status, conta });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const disconnectMatch = path.match(
      /^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/desconectar$/
    );
    if (method === "POST" && disconnectMatch) {
      const contaId = decodeURIComponent(disconnectMatch[1]);
      const body = await readJsonBody(req);
      const status = await deps.whatsappManager.disconnectAccount(contaId, {
        limparSessao: Boolean(body.limparSessao ?? body.limpar_sessao),
      });
      const conta = deps.whatsappManager.getAccount(contaId);
      sendJson(res, 200, { status, conta });
      return true;
    }

    const contactsMatch = path.match(/^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/contatos$/);
    if (contactsMatch && (method === "GET" || method === "POST")) {
      const contaId = decodeURIComponent(contactsMatch[1]);
      if (method === "GET") {
        sendJson(res, 200, { contatos: senderRules.listAuthorizedContacts(contaId) });
        return true;
      }

      try {
        const body = await readJsonBody(req);
        const rawIdent =
          typeof body.identificador_jid === "string"
            ? body.identificador_jid
            : typeof body.identificadorJid === "string"
              ? body.identificadorJid
              : typeof body.telefone === "string"
                ? body.telefone
                : typeof body.jid === "string"
                  ? body.jid
                  : "";
        if (!rawIdent.trim()) {
          sendJson(res, 400, {
            erro: "Informe 'identificador_jid' ou 'telefone' para autorizar o contato/grupo.",
          });
          return true;
        }
        const tipo = body.tipo === "grupo" ? "grupo" : "contato";
        const contato = senderRules.addAuthorizedContact({
          contaId,
          tipo,
          identificadorJid: rawIdent.trim(),
          nomeExibicao:
            typeof (body.nome_exibicao ?? body.nomeExibicao) === "string"
              ? String(body.nome_exibicao ?? body.nomeExibicao)
              : null,
          permitido: typeof body.permitido === "boolean" ? body.permitido : true,
          somenteMencao:
            typeof (body.somente_mencao ?? body.somenteMencao) === "boolean"
              ? Boolean(body.somente_mencao ?? body.somenteMencao)
              : tipo === "grupo",
          origem: "manual",
        });
        const updatedConta = deps.whatsappManager.getAccount(contaId);
        if (updatedConta) {
          wsHub.broadcast("whatsapp.conta_atualizada", {
            conta_id: updatedConta.conta_id,
            status: updatedConta.status,
            qrcode_base64: updatedConta.qrcode_base64,
            pairing_code: updatedConta.pairing_code,
            numero_telefone: updatedConta.numero_telefone,
            ultimo_erro: updatedConta.ultimo_erro,
          });
        }
        sendJson(res, 201, { contato });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const deleteContactMatch = path.match(
      /^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/contatos\/([^/]+)$/
    );
    if (method === "DELETE" && deleteContactMatch) {
      const contaId = decodeURIComponent(deleteContactMatch[1]);
      const autorizacaoId = decodeURIComponent(deleteContactMatch[2]);
      const removed = senderRules.removeAuthorizedContact(contaId, autorizacaoId);
      if (!removed) {
        sendJson(res, 404, { erro: "Autorização de contato/grupo não encontrada." });
        return true;
      }
      sendJson(res, 200, { ok: true, autorizacao_id: autorizacaoId });
      return true;
    }

    const pairingsMatch = path.match(/^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/pareamentos$/);
    if (method === "GET" && pairingsMatch) {
      const contaId = decodeURIComponent(pairingsMatch[1]);
      const statusParam = url.searchParams.get("status") as WhatsAppPairingStatus | null;
      sendJson(res, 200, {
        pareamentos: senderRules.listPairingRequests(contaId, statusParam ?? undefined),
      });
      return true;
    }

    const resolvePairingMatch = path.match(
      /^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/pareamentos\/([^/]+)\/resolver$/
    );
    if (method === "POST" && resolvePairingMatch) {
      const contaId = decodeURIComponent(resolvePairingMatch[1]);
      const requestId = decodeURIComponent(resolvePairingMatch[2]);
      const body = await readJsonBody(req);
      if (typeof body.aprovar !== "boolean") {
        sendJson(res, 400, { erro: "Campo obrigatório: 'aprovar' (boolean)." });
        return true;
      }

      const resolved = senderRules.resolvePairingRequest(contaId, requestId, body.aprovar);
      if (!resolved) {
        sendJson(res, 404, { erro: `Solicitação de pareamento '${requestId}' não encontrada.` });
        return true;
      }

      const updatedConta = deps.whatsappManager.getAccount(contaId);
      if (updatedConta) {
        wsHub.broadcast("whatsapp.conta_atualizada", {
          conta_id: updatedConta.conta_id,
          status: updatedConta.status,
          qrcode_base64: updatedConta.qrcode_base64,
          pairing_code: updatedConta.pairing_code,
          numero_telefone: updatedConta.numero_telefone,
          ultimo_erro: updatedConta.ultimo_erro,
        });
      }

      if (body.aprovar && resolved.contato && deps.whatsappOrchestrator) {
        await deps.whatsappOrchestrator
          .sendMessageAndArchive(contaId, resolved.contato.identificador_jid, {
            text: "Acesso autorizado! Agora você pode enviar pedidos e instruções por aqui.",
            waitAck: false,
          })
          .catch(() => undefined);
      }

      sendJson(res, 200, { ok: true, ...resolved });
      return true;
    }

    const historyMatch = path.match(/^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/historico$/);
    if (method === "GET" && historyMatch) {
      const contaId = decodeURIComponent(historyMatch[1]);
      const chatJid = url.searchParams.get("chatJid") || undefined;
      const limitParam = Number(url.searchParams.get("limit") ?? "30");
      const mensagens = archiveService.listHistory({
        contaId,
        chatJid,
        limit: Number.isFinite(limitParam) ? limitParam : 30,
      });
      sendJson(res, 200, { mensagens });
      return true;
    }

    const sendMatch = path.match(/^\/api\/mensageria\/whatsapp\/contas\/([^/]+)\/enviar$/);
    if (method === "POST" && sendMatch) {
      if (!deps.whatsappOrchestrator) {
        sendJson(res, 503, { erro: "Orquestrador WhatsApp não inicializado." });
        return true;
      }
      const contaId = decodeURIComponent(sendMatch[1]);
      try {
        const body = await readJsonBody(req);
        const rawTarget =
          typeof body.chatJid === "string"
            ? body.chatJid
            : typeof body.to === "string"
              ? body.to
              : "";
        if (!rawTarget.trim()) {
          sendJson(res, 400, { erro: "Informe 'chatJid' ou 'to' para envio." });
          return true;
        }
        const chatJid = rawTarget.includes("@")
          ? rawTarget.trim()
          : `${rawTarget.replace(/[^0-9]/g, "")}@s.whatsapp.net`;

        const rawMediaPath = typeof body.mediaPath === "string" ? body.mediaPath.trim() : "";
        const safeMediaPath = rawMediaPath
          ? resolveSafeStudioMediaPath(workspaceRoot, rawMediaPath)
          : undefined;

        const mensagem = await deps.whatsappOrchestrator.sendMessageAndArchive(contaId, chatJid, {
          text: typeof (body.text ?? body.texto) === "string" ? String(body.text ?? body.texto) : undefined,
          mediaPath: safeMediaPath,
          caption: typeof body.caption === "string" ? body.caption : undefined,
          asAudioPtt: typeof body.asAudioPtt === "boolean" ? body.asAudioPtt : undefined,
          waitAck: typeof body.waitAck === "boolean" ? body.waitAck : false,
        });
        sendJson(res, 200, { ok: true, mensagem });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }
  }

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
          `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Autenticação concluída</title></head><body style="background:#1A1A1A;color:#F0F0F0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="background:#212121;border:1px solid #303030;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600">Autenticação concluída</h2><p style="margin:0 0 16px;color:#A1A1A1;font-size:14px">Conexão OAuth autorizada para <strong>${safeLabel}</strong>. Você já pode fechar esta janela e retornar ao Criativo AI Studio.</p><script>setTimeout(function(){try{window.close()}catch(e){}},400)</script></div></body></html>`
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

  // ====================================================================
  // 3. LOJA UNIFICADA (/api/loja/*)
  // ====================================================================
  if (path.startsWith("/api/loja/")) {
    if (!deps.catalogService || !deps.skillsManager || !deps.githubImporter) {
      sendJson(res, 503, { erro: "Serviços da Loja Unificada não inicializados." });
      return true;
    }

    if (method === "GET" && path === "/api/loja/catalogo") {
      const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
      const tab = (url.searchParams.get("tab") as MarketplaceTab | null) ?? undefined;
      const sourceFilter =
        ((url.searchParams.get("fonte") ?? url.searchParams.get("source")) as MarketplaceSourceFilter | null) ??
        undefined;
      const category = url.searchParams.get("category") ?? url.searchParams.get("categoria") ?? undefined;

      const snapshot = deps.catalogService.getCatalogSnapshot({
        q,
        tab,
        sourceFilter,
        category,
      });
      sendJson(res, 200, snapshot);
      return true;
    }

    const appDetailMatch = path.match(/^\/api\/loja\/apps\/([^/]+)$/);
    if (method === "GET" && appDetailMatch) {
      const slug = decodeURIComponent(appDetailMatch[1]);
      const detail = deps.catalogService.getAppDetail(slug);
      if (!detail) {
        sendJson(res, 404, { erro: `Aplicativo '${slug}' não encontrado na Loja.` });
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }

    const appConnectMatch = path.match(/^\/api\/loja\/apps\/([^/]+)\/conectar$/);
    if (method === "POST" && appConnectMatch) {
      const slug = decodeURIComponent(appConnectMatch[1]);
      try {
        const body = (await readJsonBody(req)) as ConnectCatalogAppInput;
        const callbackBaseUrl =
          typeof body.callbackBaseUrl === "string" && body.callbackBaseUrl.trim()
            ? body.callbackBaseUrl.trim()
            : resolveCallbackBaseUrl(req);
        const result = await deps.catalogService.connectCatalogApp(slug, {
          ...body,
          callbackBaseUrl,
        });

        if (result.mcpId) {
          const srv = result.server ?? deps.mcpGateway?.store.getServer(result.mcpId, false);
          wsHub.broadcast("mcp.status_atualizado", {
            mcp_id: result.mcpId,
            ativo: srv?.ativo ?? true,
            oauth_status:
              result.kind === "oauth"
                ? "signing_in"
                : deps.mcpGateway?.oauthProvider.getOAuthStatus(result.mcpId) ?? "disconnected",
            qtd_ferramentas: result.probe?.toolCount ?? srv?.qtdFerramentas ?? 0,
            ultimo_erro: srv?.ultimoErro ?? null,
          });
        }

        sendJson(res, 200, redactMcpPayload(result, []));
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentInstallMatch = path.match(/^\/api\/loja\/agentes\/([^/]+)\/instalar$/);
    if (method === "POST" && agentInstallMatch) {
      const slug = decodeURIComponent(agentInstallMatch[1]);
      try {
        const body = await readJsonBody(req);
        const overrides =
          body.overrides && typeof body.overrides === "object"
            ? (body.overrides as Record<string, unknown>)
            : body;

        const hasManifestPayload =
          Boolean(body.manifest && typeof body.manifest === "object") ||
          ((slug === "importar" || slug === "personalizado") &&
            (typeof body.name === "string" || typeof body.promptBase === "string"));

        const targetPayload = hasManifestPayload
          ? ((body.manifest as Record<string, unknown>) ?? body)
          : slug;

        const installed = deps.catalogService.installAgentPackage(targetPayload, {
          name: typeof overrides.name === "string" ? overrides.name : typeof overrides.nome === "string" ? overrides.nome : undefined,
          model: typeof overrides.model === "string" ? overrides.model : typeof overrides.modelo_padrao === "string" ? overrides.modelo_padrao : undefined,
          pasta: typeof overrides.pasta === "string" ? overrides.pasta : undefined,
          customAgenteId: typeof overrides.customAgenteId === "string" ? overrides.customAgenteId : undefined,
          activateRoutines:
            typeof overrides.activateRoutines === "boolean" ? overrides.activateRoutines : undefined,
        });

        wsHub.broadcast("loja.agente_instalado", {
          agente_id: installed.agente.agente_id,
          slug,
        });
        sendJson(res, 201, installed);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentExportMatch = path.match(/^\/api\/loja\/agentes\/([^/]+)\/exportar$/);
    if (method === "GET" && agentExportMatch) {
      const agenteId = decodeURIComponent(agentExportMatch[1]);
      try {
        const exported = deps.catalogService.exportAgentTemplate(agenteId);
        sendJson(res, 200, exported);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentDuplicateMatch = path.match(/^\/api\/loja\/agentes\/([^/]+)\/duplicar$/);
    if (method === "POST" && agentDuplicateMatch) {
      const agenteId = decodeURIComponent(agentDuplicateMatch[1]);
      try {
        const body = await readJsonBody(req);
        const newName =
          typeof body.nome === "string"
            ? body.nome
            : typeof body.name === "string"
              ? body.name
              : undefined;
        const duplicated = deps.catalogService.duplicateAgent(agenteId, newName);
        wsHub.broadcast("loja.agente_instalado", {
          agente_id: duplicated.agente.agente_id,
          slug: duplicated.agente.agente_id,
        });
        sendJson(res, 201, duplicated);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    if (method === "GET" && path === "/api/loja/github/inspecionar") {
      const repoUrl = url.searchParams.get("url") ?? "";
      const tipoParam = url.searchParams.get("tipo") ?? url.searchParams.get("kind") ?? "skills";
      const kind = tipoParam === "agents" ? "agents" : "skills";
      try {
        const preview = await deps.githubImporter.inspectRepository(repoUrl, kind);
        sendJson(res, 200, preview);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    if (method === "POST" && path === "/api/loja/github/instalar") {
      try {
        const body = await readJsonBody(req);
        const repoUrl = typeof body.url === "string" ? body.url : "";
        const kindParam = body.kind ?? body.tipo ?? "skills";
        const kind = kindParam === "agents" ? "agents" : "skills";
        const itemPaths = Array.isArray(body.itemPaths)
          ? body.itemPaths.filter((p): p is string => typeof p === "string")
          : undefined;
        const targetAgentIds = Array.isArray(body.targetAgentIds)
          ? body.targetAgentIds.filter((id): id is string => typeof id === "string")
          : undefined;

        const installed = await deps.githubImporter.installFromGithub({
          url: repoUrl,
          kind,
          itemPaths,
          targetAgentIds,
        });

        for (const s of installed.installedSkills) {
          wsHub.broadcast("loja.skill_atualizada", {
            skill_id: s.skillId,
            acao: "instalada",
          });
        }
        for (const a of installed.installedAgents) {
          wsHub.broadcast("loja.agente_instalado", {
            agente_id: a.agente.agente_id,
            slug: a.agente.agente_id,
          });
        }

        sendJson(res, 201, installed);
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    if (method === "GET" && path === "/api/loja/habilidades") {
      const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
      const source =
        ((url.searchParams.get("fonte") ?? url.searchParams.get("source")) as MarketplaceSourceFilter | null) ??
        "all";
      const agentId = url.searchParams.get("agenteId") ?? url.searchParams.get("agentId") ?? undefined;
      const category = url.searchParams.get("category") ?? url.searchParams.get("categoria") ?? undefined;
      sendJson(res, 200, {
        habilidades: deps.skillsManager.listSkills({
          query: q,
          source,
          agentId,
          category,
        }),
      });
      return true;
    }

    if (method === "POST" && path === "/api/loja/habilidades") {
      try {
        const body = await readJsonBody(req);
        const created = deps.skillsManager.createCustomSkill({
          name: String(body.name ?? body.nome ?? ""),
          slug: typeof body.slug === "string" ? body.slug : undefined,
          description: String(body.description ?? body.descricao ?? ""),
          category: String(body.category ?? body.categoria ?? "Automação & Rotinas"),
          instructions: String(body.instructions ?? body.instrucoes ?? ""),
          agentIds: Array.isArray(body.agentIds ?? body.agentes)
            ? ((body.agentIds ?? body.agentes) as unknown[]).filter(
                (id): id is string => typeof id === "string"
              )
            : undefined,
        });
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: created.skillId,
          acao: "criada",
        });
        sendJson(res, 201, { habilidade: created });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const skillDetailMatch = path.match(/^\/api\/loja\/habilidades\/([^/]+)$/);
    if (skillDetailMatch && (method === "GET" || method === "DELETE")) {
      const skillId = decodeURIComponent(skillDetailMatch[1]);
      if (method === "GET") {
        const found = deps.skillsManager.readSkill(skillId);
        if (!found) {
          sendJson(res, 404, { erro: `Habilidade '${skillId}' não encontrada.` });
          return true;
        }
        sendJson(res, 200, found);
        return true;
      }

      try {
        const resDel = deps.skillsManager.uninstallSkill(skillId);
        if (!resDel.removed) {
          sendJson(res, 404, { erro: `Habilidade '${skillId}' não está instalada.` });
          return true;
        }
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: resDel.skillId ?? skillId,
          acao: "removida",
        });
        sendJson(res, 200, { ok: true, ...resDel });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const skillInstallMatch = path.match(/^\/api\/loja\/habilidades\/([^/]+)\/instalar$/);
    if (method === "POST" && skillInstallMatch) {
      const skillId = decodeURIComponent(skillInstallMatch[1]);
      try {
        const body = await readJsonBody(req);
        const rawAgents = body.targetAgentIds ?? body.agentIds ?? body.agentes ?? [];
        const targetAgentIds = Array.isArray(rawAgents)
          ? rawAgents.filter((id): id is string => typeof id === "string")
          : [];
        const installed = deps.skillsManager.installCatalogSkill(skillId, targetAgentIds);
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: installed.skillId,
          acao: "instalada",
        });
        sendJson(res, 200, { habilidade: installed });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const skillAgentsBatchMatch = path.match(/^\/api\/loja\/habilidades\/([^/]+)\/agentes$/);
    if (method === "PUT" && skillAgentsBatchMatch) {
      const skillId = decodeURIComponent(skillAgentsBatchMatch[1]);
      try {
        const body = await readJsonBody(req);
        const rawAgents = body.agentIds ?? body.agentes ?? [];
        const agentIds = Array.isArray(rawAgents)
          ? rawAgents.filter((id): id is string => typeof id === "string")
          : [];
        const result = deps.skillsManager.setSkillAgentsBatch(skillId, agentIds);
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: result.skillId,
          acao: "vinculada",
        });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }

    const agentSkillToggleMatch = path.match(
      /^\/api\/loja\/agentes\/([^/]+)\/habilidades\/([^/]+)$/
    );
    if (method === "PATCH" && agentSkillToggleMatch) {
      const agenteId = decodeURIComponent(agentSkillToggleMatch[1]);
      const skillId = decodeURIComponent(agentSkillToggleMatch[2]);
      try {
        const body = await readJsonBody(req);
        if (typeof body.habilitada !== "boolean") {
          sendJson(res, 400, { erro: "Campo obrigatório: 'habilitada' (boolean)." });
          return true;
        }
        const toggled = deps.skillsManager.setSkillEnabledForAgent(
          agenteId,
          skillId,
          body.habilitada
        );
        wsHub.broadcast("loja.skill_atualizada", {
          skill_id: toggled.skillId,
          acao: "vinculada",
        });
        sendJson(res, 200, { ok: true, ...toggled });
      } catch (err) {
        sendError(res, sendJson, err);
      }
      return true;
    }
  }

  return false;
}
