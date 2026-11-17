import { randomInt, randomUUID } from "node:crypto";
import {
  whatsAppNumberForms,
  type WhatsAppContatoAutorizado,
  type WhatsAppModoOperacao,
  type WhatsAppPairingRequest,
  type WhatsAppPairingStatus,
} from "@criativo/contracts";
import { ensureWhatsAppAccountRow } from "./auth-store.ts";
import type {
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  SqliteConnectionLike,
} from "./types.ts";

/** Alfabeto sem caracteres ambíguos (0/O, 1/I) para códigos de pareamento legíveis em voz alta. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_REQUEST_TTL_MS = 60 * 60 * 1_000;
export const MAX_PENDING_PAIRING_REQUESTS = 20;

const BRAZIL_MOBILE_REGEX = /^(55)([1-9]{2})(9?)([6-9][0-9]{7})$/u;

export function generatePairingCode6(): string {
  return Array.from(
    { length: PAIRING_CODE_LENGTH },
    () => PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)]
  ).join("");
}

export function isBrazilMobileNumber(rawInput: string): boolean {
  if (typeof rawInput !== "string") return false;
  const localPart = rawInput.trim().split("@")[0]?.split(":")[0] ?? "";
  const digits = localPart.replace(/[^0-9]/g, "");
  return BRAZIL_MOBILE_REGEX.test(digits);
}

function extractUserFromJid(rawJid?: string | null): string | null {
  if (!rawJid || typeof rawJid !== "string") return null;
  const trimmed = rawJid.trim();
  if (!trimmed) return null;
  const withoutDomain = trimmed.split("@")[0] ?? trimmed;
  const user = withoutDomain.split(":")[0]?.trim() ?? "";
  return user.length > 0 ? user : null;
}

function extractPhoneDigits(rawJid?: string | null): string | null {
  if (!rawJid || typeof rawJid !== "string") return null;
  if (rawJid.endsWith("@lid") || rawJid.endsWith("@g.us")) return null;
  const user = extractUserFromJid(rawJid);
  if (!user) return null;
  const digits = user.replace(/[^0-9]/g, "");
  return digits.length >= 6 ? digits : null;
}

function normalizeContactJid(rawInput: string, tipo: "contato" | "grupo"): string {
  const trimmed = rawInput.trim();
  if (trimmed.includes("@")) {
    const [left, domain] = trimmed.split("@");
    const cleanLeft = (left ?? "").split(":")[0] ?? "";
    if (tipo === "contato" && (domain === "s.whatsapp.net" || domain === "c.us")) {
      const digits = cleanLeft.replace(/[^0-9]/g, "");
      return digits ? `${digits}@s.whatsapp.net` : trimmed;
    }
    return `${cleanLeft}@${domain}`;
  }

  if (tipo === "grupo") {
    return `${trimmed}@g.us`;
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : trimmed;
}

function isSameWhatsAppUser(jidA?: string | null, jidB?: string | null): boolean {
  if (!jidA || !jidB) return false;
  const userA = extractUserFromJid(jidA);
  const userB = extractUserFromJid(jidB);
  if (!userA || !userB) return false;
  if (userA === userB) return true;

  const isLidA = jidA.endsWith("@lid");
  const isLidB = jidB.endsWith("@lid");
  if (isLidA !== isLidB) return false;

  const digitsA = userA.replace(/[^0-9]/g, "");
  const digitsB = userB.replace(/[^0-9]/g, "");
  if (!digitsA || !digitsB) return false;

  const formsA = new Set(whatsAppNumberForms(digitsA));
  return whatsAppNumberForms(digitsB).some((form) => formsA.has(form));
}

export interface AddAuthorizedContactInput {
  contaId: string;
  tipo: "contato" | "grupo";
  identificadorJid: string;
  nomeExibicao?: string | null;
  permitido?: boolean;
  somenteMencao?: boolean;
  origem?: "manual" | "pareamento" | "auto_chat";
}

export interface EvaluateIncomingInput {
  contaId: string;
  modoOperacao: WhatsAppModoOperacao;
  codigoAutorizacaoObrigatorio: boolean;
  grupoAutoResponder: boolean;
  ownJid?: string | null;
  ownLid?: string | null;
  msg: IncomingWhatsAppMessage;
  socket?: BaileysSocketLike | null;
  resolveLid?: (lid: string) => Promise<string | null>;
}

export type SenderEvaluationResult =
  | {
      decision: "allow";
      reason: "self_chat" | "authorized_contact" | "authorized_group" | "open_dedicated";
      resolvedPhone: string | null;
      chatJid: string;
    }
  | {
      decision: "ignore";
      reason:
        | "from_me_other_chat"
        | "unauthorized_group"
        | "group_requires_mention"
        | "own_number_unknown"
        | "unresolved_lid"
        | "pending_limit_reached";
      resolvedPhone: string | null;
      chatJid: string;
    }
  | {
      decision: "pairing_pending";
      request: WhatsAppPairingRequest;
      resolvedPhone: string | null;
      chatJid: string;
    }
  | {
      decision: "pairing_challenge";
      request: WhatsAppPairingRequest;
      challengeMessage: string;
      resolvedPhone: string | null;
      chatJid: string;
    };

interface AuthorizedRow {
  autorizacao_id: string;
  conta_id: string;
  tipo: "contato" | "grupo";
  identificador_jid: string;
  telefone_normalizado: string | null;
  variantes_json: string;
  nome_exibicao: string | null;
  permitido: number;
  somente_mencao: number;
  origem: "manual" | "pareamento" | "auto_chat";
  criado_em: string;
  atualizado_em: string;
}

interface PairingRequestRow {
  request_id: string;
  conta_id: string;
  codigo: string;
  remetente_jid: string;
  remetente_pn: string | null;
  nome_contato: string | null;
  status: WhatsAppPairingStatus;
  criado_em: string;
  expira_em: string;
  resolvido_em: string | null;
}

function mapAuthorizedRow(row: AuthorizedRow): WhatsAppContatoAutorizado {
  let variantes: string[] = [];
  try {
    const parsed = JSON.parse(row.variantes_json);
    if (Array.isArray(parsed)) {
      variantes = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    variantes = [];
  }

  return {
    autorizacao_id: row.autorizacao_id,
    conta_id: row.conta_id,
    tipo: row.tipo,
    identificador_jid: row.identificador_jid,
    telefone_normalizado: row.telefone_normalizado,
    variantes,
    nome_exibicao: row.nome_exibicao,
    permitido: row.permitido === 1,
    somente_mencao: row.somente_mencao === 1,
    origem: row.origem,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

function mapPairingRow(row: PairingRequestRow): WhatsAppPairingRequest {
  return {
    request_id: row.request_id,
    conta_id: row.conta_id,
    codigo: row.codigo,
    remetente_jid: row.remetente_jid,
    remetente_pn: row.remetente_pn,
    nome_contato: row.nome_contato,
    status: row.status,
    criado_em: row.criado_em,
    expira_em: row.expira_em,
    resolvido_em: row.resolvido_em,
  };
}

/**
 * Motor de segurança e autorização de remetentes WhatsApp:
 * - Política `ownNumber` vs `dedicated`
 * - Normalização de celulares brasileiros com/sem 9º dígito (`whatsAppNumberForms`)
 * - Resolução `LID -> PN` com cache em memória
 * - Desafios de pareamento de 6 caracteres (validade 1h, máximo 20 pendentes/conta)
 * - Controle de grupos com `somente_mencao`
 */
export class WhatsAppSenderRules {
  private readonly db: SqliteConnectionLike;
  private readonly now: () => number;
  private readonly lidCache = new Map<string, string | null>();

  constructor(db: SqliteConnectionLike, options: { now?: () => number } = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
  }

  private async resolvePhoneForCandidate(
    contaId: string,
    candidates: Array<string | null | undefined>,
    resolveLid?: (lid: string) => Promise<string | null>
  ): Promise<string | null> {
    for (const candidate of candidates) {
      const direct = extractPhoneDigits(candidate);
      if (direct) return direct;
    }

    for (const candidate of candidates) {
      if (!candidate || !candidate.endsWith("@lid")) continue;
      const cacheKey = `${contaId}:${candidate}`;
      if (this.lidCache.has(cacheKey)) {
        const cached = this.lidCache.get(cacheKey);
        if (cached) return cached;
        continue;
      }
      if (!resolveLid) continue;
      try {
        const resolved = await resolveLid(candidate);
        const digits = resolved ? resolved.replace(/[^0-9]/g, "") : null;
        const normalized = digits && digits.length >= 6 ? digits : null;
        this.lidCache.set(cacheKey, normalized);
        if (normalized) return normalized;
      } catch {
        this.lidCache.set(cacheKey, null);
      }
    }

    return null;
  }

  private expirePendingRequests(contaId: string): void {
    const nowIso = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `
        UPDATE whatsapp_pairing_requests
        SET status = 'expirado'
        WHERE conta_id = ? AND status = 'pendente' AND expira_em <= ?;
      `
      )
      .run(contaId, nowIso);
  }

  private findAuthorizedContact(
    contaId: string,
    remoteJid: string,
    resolvedPhone: string | null
  ): WhatsAppContatoAutorizado | null {
    const candidateForms = new Set<string>();
    if (resolvedPhone) {
      for (const form of whatsAppNumberForms(resolvedPhone)) {
        candidateForms.add(form);
      }
    }
    for (const form of whatsAppNumberForms(remoteJid)) {
      candidateForms.add(form);
    }

    const rows = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ? AND tipo = 'contato' AND permitido = 1;
      `
      )
      .all(contaId) as unknown as AuthorizedRow[];

    for (const row of rows) {
      if (isSameWhatsAppUser(row.identificador_jid, remoteJid)) {
        return mapAuthorizedRow(row);
      }
      if (row.telefone_normalizado && candidateForms.has(row.telefone_normalizado)) {
        return mapAuthorizedRow(row);
      }
      const mapped = mapAuthorizedRow(row);
      if (mapped.variantes.some((variant) => candidateForms.has(variant))) {
        return mapped;
      }
    }

    return null;
  }

  public async evaluateIncoming(input: EvaluateIncomingInput): Promise<SenderEvaluationResult> {
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

    const resolvedPhone = await this.resolvePhoneForCandidate(
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
      const groupRow = this.db
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
    const authorizedContact = this.findAuthorizedContact(contaId, msg.remoteJid, resolvedPhone);
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
    ensureWhatsAppAccountRow(this.db, contaId);
    this.expirePendingRequests(contaId);

    const pendingRows = this.db
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

    const createdAt = this.now();
    const criadoEm = new Date(createdAt).toISOString();
    const expiraEm = new Date(createdAt + PAIRING_REQUEST_TTL_MS).toISOString();
    const requestId = `pair-${randomUUID()}`;
    const codigo = generatePairingCode6();
    const nomeContato = msg.pushName?.trim().slice(0, 80) || resolvedPhone || msg.remoteJid;

    this.db
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
      "Olá! Este número do Criativo AI Studio exige aprovação para iniciar atendimento.",
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

  public addAuthorizedContact(input: AddAuthorizedContactInput): WhatsAppContatoAutorizado {
    ensureWhatsAppAccountRow(this.db, input.contaId);

    const identificadorJid = normalizeContactJid(input.identificadorJid, input.tipo);
    const variantes = input.tipo === "contato" ? whatsAppNumberForms(identificadorJid) : [];
    const telefoneNormalizado =
      input.tipo === "contato"
        ? variantes.find((v) => v.startsWith("55") && v.length === 13) ?? variantes[0] ?? null
        : null;

    const agora = new Date(this.now()).toISOString();
    const autorizacaoId = `auth-${randomUUID()}`;
    const permitido = input.permitido === false ? 0 : 1;
    const somenteMencao = input.somenteMencao === false ? 0 : 1;
    const origem = input.origem ?? "manual";
    const nomeExibicao = input.nomeExibicao?.trim() || null;

    this.db
      .prepare(
        `
        INSERT INTO whatsapp_contatos_autorizados (
          autorizacao_id,
          conta_id,
          tipo,
          identificador_jid,
          telefone_normalizado,
          variantes_json,
          nome_exibicao,
          permitido,
          somente_mencao,
          origem,
          criado_em,
          atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conta_id, identificador_jid) DO UPDATE SET
          tipo = excluded.tipo,
          telefone_normalizado = excluded.telefone_normalizado,
          variantes_json = excluded.variantes_json,
          nome_exibicao = COALESCE(excluded.nome_exibicao, whatsapp_contatos_autorizados.nome_exibicao),
          permitido = excluded.permitido,
          somente_mencao = excluded.somente_mencao,
          origem = excluded.origem,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(
        autorizacaoId,
        input.contaId,
        input.tipo,
        identificadorJid,
        telefoneNormalizado,
        JSON.stringify(variantes),
        nomeExibicao,
        permitido,
        somenteMencao,
        origem,
        agora,
        agora
      );

    const saved = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ? AND identificador_jid = ?
        LIMIT 1;
      `
      )
      .get(input.contaId, identificadorJid) as AuthorizedRow;

    return mapAuthorizedRow(saved);
  }

  public removeAuthorizedContact(contaId: string, autorizacaoId: string): boolean {
    const res = this.db
      .prepare(
        `DELETE FROM whatsapp_contatos_autorizados WHERE conta_id = ? AND autorizacao_id = ?;`
      )
      .run(contaId, autorizacaoId);
    return Number(res.changes) > 0;
  }

  public listAuthorizedContacts(contaId: string): WhatsAppContatoAutorizado[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_contatos_autorizados
        WHERE conta_id = ?
        ORDER BY atualizado_em DESC;
      `
      )
      .all(contaId) as unknown as AuthorizedRow[];

    return rows.map(mapAuthorizedRow);
  }

  public listPairingRequests(
    contaId: string,
    statusFilter?: WhatsAppPairingStatus
  ): WhatsAppPairingRequest[] {
    this.expirePendingRequests(contaId);
    const rows = statusFilter
      ? (this.db
          .prepare(
            `
            SELECT * FROM whatsapp_pairing_requests
            WHERE conta_id = ? AND status = ?
            ORDER BY criado_em DESC;
          `
          )
          .all(contaId, statusFilter) as unknown as PairingRequestRow[])
      : (this.db
          .prepare(
            `
            SELECT * FROM whatsapp_pairing_requests
            WHERE conta_id = ?
            ORDER BY criado_em DESC;
          `
          )
          .all(contaId) as unknown as PairingRequestRow[]);

    return rows.map(mapPairingRow);
  }

  public resolvePairingRequest(
    contaId: string,
    requestId: string,
    aprovar: boolean
  ): { request: WhatsAppPairingRequest; contato?: WhatsAppContatoAutorizado } | null {
    this.expirePendingRequests(contaId);

    const existing = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_pairing_requests
        WHERE conta_id = ? AND request_id = ?
        LIMIT 1;
      `
      )
      .get(contaId, requestId) as PairingRequestRow | undefined;

    if (!existing) {
      return null;
    }

    const agora = new Date(this.now()).toISOString();
    const novoStatus: WhatsAppPairingStatus = aprovar ? "aprovado" : "recusado";

    this.db
      .prepare(
        `
        UPDATE whatsapp_pairing_requests
        SET status = ?, resolvido_em = ?
        WHERE conta_id = ? AND request_id = ?;
      `
      )
      .run(novoStatus, agora, contaId, requestId);

    const updated = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_pairing_requests
        WHERE conta_id = ? AND request_id = ?
        LIMIT 1;
      `
      )
      .get(contaId, requestId) as PairingRequestRow;

    const request = mapPairingRow(updated);
    if (!aprovar) {
      return { request };
    }

    const identificadorJid = existing.remetente_pn
      ? `${existing.remetente_pn}@s.whatsapp.net`
      : existing.remetente_jid;

    const contato = this.addAuthorizedContact({
      contaId,
      tipo: "contato",
      identificadorJid,
      nomeExibicao: existing.nome_contato,
      permitido: true,
      somenteMencao: false,
      origem: "pareamento",
    });

    return { request, contato };
  }
}
