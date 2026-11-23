import {
  randomUUID,
} from "node:crypto";
import {
  whatsAppNumberForms,
  type WhatsAppPairingRequest,
} from "@criativo/contracts";
import {
  ensureWhatsAppAccountRow,
} from "./auth-store.ts";
import { PAIRING_REQUEST_TTL_MS, MAX_PENDING_PAIRING_REQUESTS, generatePairingCode6, extractPhoneDigits, isSameWhatsAppUser, mapPairingRow, type EvaluateIncomingInput, type SenderEvaluationResult, type AuthorizedRow, type PairingRequestRow, type SenderRulesDeps } from "./sender-rules-helpers.ts";

export async function evaluateIncomingOp(deps: SenderRulesDeps, input: EvaluateIncomingInput): Promise<SenderEvaluationResult> {
  const {
    contaId,
    modoOperacao,
    codigoAutorizacaoObrigatorio,
    grupoAutoResponder,
    ownJid,
    ownLid,
    msg,
    socket,
    resolveLid,
  } = input;

  const lidResolver =
    resolveLid ??
    (socket?.signalRepository?.lidMapping?.getPNForLID
      ? (lid: string) => socket.signalRepository!.lidMapping!.getPNForLID!(lid)
      : undefined);

  const isGroup = msg.isGroup ?? msg.remoteJid.endsWith("@g.us");
  const ownDigits = extractPhoneDigits(ownJid);

  const resolvedPhone = await deps.resolvePhoneForCandidate(
    contaId,
    isGroup
      ? [msg.participantAlt, msg.participant]
      : [msg.remoteJidAlt, msg.remoteJid],
    lidResolver
  );

  const isSelfChat =
    !isGroup &&
    (isSameWhatsAppUser(msg.remoteJid, ownJid) ||
      isSameWhatsAppUser(msg.remoteJid, ownLid) ||
      isSameWhatsAppUser(msg.remoteJidAlt, ownJid) ||
      isSameWhatsAppUser(msg.remoteJidAlt, ownLid) ||
      isSameWhatsAppUser(msg.participant, ownJid) ||
      isSameWhatsAppUser(msg.participant, ownLid) ||
      (ownDigits !== null &&
        resolvedPhone !== null &&
        whatsAppNumberForms(resolvedPhone).some((f) =>
          whatsAppNumberForms(ownDigits).includes(f)
        )));

  if (isSelfChat) {
    return {
      decision: "allow",
      reason: "self_chat",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  if (msg.fromMe) {
    return {
      decision: "ignore",
      reason: "from_me_other_chat",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  if (isGroup) {
    const groupRow = deps.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ? AND tipo = 'grupo' AND identificador_jid = ? AND permitido = 1
        LIMIT 1;
      `
      )
      .get(contaId, msg.remoteJid) as AuthorizedRow | undefined;

    if (!groupRow) {
      return {
        decision: "ignore",
        reason: "unauthorized_group",
        resolvedPhone,
        chatJid: msg.remoteJid,
      };
    }

    if (groupRow.somente_mencao === 1 && !grupoAutoResponder) {
      const mentionedMe = (msg.mentionedJids ?? []).some(
        (jid) => isSameWhatsAppUser(jid, ownJid) || isSameWhatsAppUser(jid, ownLid)
      );
      const repliedToMe =
        isSameWhatsAppUser(msg.quotedParticipant, ownJid) ||
        isSameWhatsAppUser(msg.quotedParticipant, ownLid);
      const textMentionsOwnDigits =
        ownDigits !== null && typeof msg.text === "string" && msg.text.includes(`@${ownDigits}`);

      if (!mentionedMe && !repliedToMe && !textMentionsOwnDigits) {
        return {
          decision: "ignore",
          reason: "group_requires_mention",
          resolvedPhone,
          chatJid: msg.remoteJid,
        };
      }
    }

    return {
      decision: "allow",
      reason: "authorized_group",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  // Chat 1:1 de terceiros
  const authorizedContact = deps.findAuthorizedContact(contaId, msg.remoteJid, resolvedPhone);
  if (authorizedContact) {
    return {
      decision: "allow",
      reason: "authorized_contact",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  // Número pessoal conectado jamais envia respostas ou desafios de pareamento para desconhecidos
  if (modoOperacao === "ownNumber") {
    return {
      decision: "ignore",
      reason: "own_number_unknown",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  if (!codigoAutorizacaoObrigatorio) {
    return {
      decision: "allow",
      reason: "open_dedicated",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  if (msg.remoteJid.endsWith("@lid") && !resolvedPhone) {
    return {
      decision: "ignore",
      reason: "unresolved_lid",
      resolvedPhone: null,
      chatJid: msg.remoteJid,
    };
  }

  // Modo dedicated com autorização obrigatória: fluxo de código de 6 caracteres
  ensureWhatsAppAccountRow(deps.db, contaId);
  deps.expirePendingRequests(contaId);

  const pendingRows = deps.db
    .prepare(
      `
      SELECT * FROM whatsapp_pairing_requests
      WHERE conta_id = ? AND status = 'pendente'
      ORDER BY criado_em ASC;
    `
    )
    .all(contaId) as unknown as PairingRequestRow[];

  const incomingForms = new Set(
    resolvedPhone ? whatsAppNumberForms(resolvedPhone) : whatsAppNumberForms(msg.remoteJid)
  );

  const existing = pendingRows.find((req) => {
    if (isSameWhatsAppUser(req.remetente_jid, msg.remoteJid)) return true;
    if (req.remetente_pn) {
      return whatsAppNumberForms(req.remetente_pn).some((form) => incomingForms.has(form));
    }
    return false;
  });

  if (existing) {
    return {
      decision: "pairing_pending",
      request: mapPairingRow(existing),
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  if (pendingRows.length >= MAX_PENDING_PAIRING_REQUESTS) {
    return {
      decision: "ignore",
      reason: "pending_limit_reached",
      resolvedPhone,
      chatJid: msg.remoteJid,
    };
  }

  const createdAt = deps.now();
  const criadoEm = new Date(createdAt).toISOString();
  const expiraEm = new Date(createdAt + PAIRING_REQUEST_TTL_MS).toISOString();
  const requestId = `pair-${randomUUID()}`;
  const codigo = generatePairingCode6();
  const nomeContato = msg.pushName?.trim().slice(0, 80) || resolvedPhone || msg.remoteJid;

  deps.db
    .prepare(
      `
      INSERT INTO whatsapp_pairing_requests (
        request_id, conta_id, codigo, remetente_jid, remetente_pn, nome_contato, status, criado_em, expira_em, resolvido_em
      ) VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?, NULL);
    `
    )
    .run(
      requestId,
      contaId,
      codigo,
      msg.remoteJid,
      resolvedPhone,
      nomeContato,
      criadoEm,
      expiraEm
    );

  const request: WhatsAppPairingRequest = {
    request_id: requestId,
    conta_id: contaId,
    codigo,
    remetente_jid: msg.remoteJid,
    remetente_pn: resolvedPhone,
    nome_contato: nomeContato,
    status: "pendente",
    criado_em: criadoEm,
    expira_em: expiraEm,
    resolvido_em: null,
  };

  const challengeMessage = [
    "Olá! Este número do CriativoOS exige aprovação para iniciar atendimento.",
    `Seu código de solicitação é: *${codigo}* (válido por 1 hora).`,
    "Peça ao administrador do estúdio para aprovar este código no painel do WhatsApp.",
  ].join("\n");

  return {
    decision: "pairing_challenge",
    request,
    challengeMessage,
    resolvedPhone,
    chatJid: msg.remoteJid,
  };
}

