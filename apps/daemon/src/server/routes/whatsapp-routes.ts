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
import { resolveSafeStudioMediaPath } from "../studio-tools-bridge.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { sendError } from "./whatsapp-mcp-store-helpers.ts";

export async function tryHandleWhatsAppRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

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

  return false;
}
