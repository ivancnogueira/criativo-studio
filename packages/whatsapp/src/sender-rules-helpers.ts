import {
  randomInt,
} from "node:crypto";
import {
  whatsAppNumberForms,
  type WhatsAppContatoAutorizado,
  type WhatsAppModoOperacao,
  type WhatsAppPairingRequest,
  type WhatsAppPairingStatus,
} from "@criativo/contracts";
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

export const BRAZIL_MOBILE_REGEX = /^(55)([1-9]{2})(9?)([6-9][0-9]{7})$/u;

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

export function extractUserFromJid(rawJid?: string | null): string | null {
  if (!rawJid || typeof rawJid !== "string") return null;
  const trimmed = rawJid.trim();
  if (!trimmed) return null;
  const withoutDomain = trimmed.split("@")[0] ?? trimmed;
  const user = withoutDomain.split(":")[0]?.trim().toLowerCase() ?? "";
  return user.length > 0 ? user : null;
}

export function extractPhoneDigits(rawJid?: string | null): string | null {
  if (!rawJid || typeof rawJid !== "string") return null;
  if (rawJid.endsWith("@lid") || rawJid.endsWith("@g.us")) return null;
  const user = extractUserFromJid(rawJid);
  if (!user) return null;
  const digits = user.replace(/[^0-9]/g, "");
  return digits.length >= 6 ? digits : null;
}

export function normalizeContactJid(rawInput: string, tipo: "contato" | "grupo"): string {
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

export function isSameWhatsAppUser(jidA?: string | null, jidB?: string | null): boolean {
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

export interface AuthorizedRow {
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

export interface PairingRequestRow {
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

export function mapAuthorizedRow(row: AuthorizedRow): WhatsAppContatoAutorizado {
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

export function mapPairingRow(row: PairingRequestRow): WhatsAppPairingRequest {
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

export interface SenderRulesDeps {
  db: SqliteConnectionLike;
  now: () => number;
  lidCache: Map<string, string | null>;
  resolvePhoneForCandidate: (
    contaId: string,
    candidates: Array<string | null | undefined>,
    resolveLid?: (lid: string) => Promise<string | null>,
  ) => Promise<string | null>;
  expirePendingRequests: (contaId: string) => void;
  findAuthorizedContact: (
    contaId: string,
    remoteJid: string,
    resolvedPhone: string | null,
  ) => WhatsAppContatoAutorizado | null;
}

export type TailArgs<F> = F extends (deps: SenderRulesDeps, ...args: infer A) => unknown ? A : never;
