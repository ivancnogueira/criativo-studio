/**
 * Contratos compartilhados e funções puras do subsistema WhatsApp Multi-Número.
 * Mantém paridade entre validações da interface web, pacote @criativo/whatsapp e daemon.
 */

import type { StatusMensageria } from "./index.ts";

export type WhatsAppModoOperacao = "ownNumber" | "dedicated";

export type WhatsAppPairingStatus = "pendente" | "aprovado" | "recusado" | "expirado";

export type WhatsAppMetodoPareamento = "qr" | "pairing_code";

export interface WhatsAppContaResumo {
  conta_id: string;
  rotulo: string;
  numero_telefone: string | null;
  jid_proprio: string | null;
  modo_operacao: WhatsAppModoOperacao;
  status: StatusMensageria;
  qrcode_base64: string | null;
  pairing_code: string | null;
  notificar_aprovacoes: boolean;
  codigo_autorizacao_obrigatorio: boolean;
  grupo_auto_responder: boolean;
  agente_orquestrador_id: string | null;
  total_contatos_autorizados: number;
  pareamentos_pendentes: number;
  ultimo_erro: string | null;
  conectado_em: string | null;
  atualizado_em: string;
}

export interface WhatsAppContatoAutorizado {
  autorizacao_id: string;
  conta_id: string;
  tipo: "contato" | "grupo";
  identificador_jid: string;
  telefone_normalizado: string | null;
  variantes: string[];
  nome_exibicao: string | null;
  permitido: boolean;
  somente_mencao: boolean;
  origem: "manual" | "pareamento" | "auto_chat";
  criado_em: string;
  atualizado_em: string;
}

export interface WhatsAppPairingRequest {
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

export interface WhatsAppMensagemRegistro {
  mensagem_id: string;
  conta_id: string;
  chat_jid: string;
  remetente_jid: string;
  remetente_nome: string | null;
  direcao: "entrada" | "saida";
  tipo_conteudo: "texto" | "imagem" | "documento" | "audio" | "video" | "sistema";
  texto: string | null;
  midia_caminho: string | null;
  midia_mime: string | null;
  midia_tamanho_bytes: number;
  eh_grupo: boolean;
  ack_status: string | null;
  metadados: Record<string, unknown>;
  ocorrido_em: string;
  expira_em: string;
}

export interface WhatsAppConfigPayload {
  rotulo?: string;
  modo_operacao?: WhatsAppModoOperacao;
  notificar_aprovacoes?: boolean;
  codigo_autorizacao_obrigatorio?: boolean;
  grupo_auto_responder?: boolean;
  agente_orquestrador_id?: string | null;
}

const BRAZIL_MOBILE_REGEX = /^(55)([1-9]{2})(9?)([6-9][0-9]{7})$/u;

/**
 * Normaliza números ou JIDs do WhatsApp e gera variantes equivalentes.
 * Para celulares brasileiros (DDI 55), retorna obrigatoriamente ambas as formas
 * com e sem o 9º dígito para tolerar discrepâncias entre Baileys e cadastro manual.
 */
export function whatsAppNumberForms(rawInput: string): string[] {
  if (typeof rawInput !== "string") {
    return [];
  }
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return [];
  }

  // Remove sufixo JID (@s.whatsapp.net, @lid, etc.) e identificador de dispositivo (:0, :12)
  const localPart = trimmed.split("@")[0]?.split(":")[0] ?? trimmed;
  const digits = localPart.replace(/[^0-9]/g, "");
  if (!digits) {
    return [];
  }

  const forms = new Set<string>([digits]);
  const brMatch = BRAZIL_MOBILE_REGEX.exec(digits);
  if (brMatch) {
    const ddi = brMatch[1];
    const ddd = brMatch[2];
    const subscriber = brMatch[4];
    forms.add(`${ddi}${ddd}9${subscriber}`);
    forms.add(`${ddi}${ddd}${subscriber}`);
  }

  return Array.from(forms);
}

/**
 * Valida e retorna apenas dígitos E.164 (10 a 15 dígitos) para pareamento por código no telefone.
 */
export function normalizeWhatsAppPairingPhone(rawInput: string): string {
  if (typeof rawInput !== "string") {
    throw new Error("Informe o número de telefone com DDI e DDD para pareamento.");
  }
  const digits = rawInput.replace(/[^0-9]/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new Error(
      "Informe um número de telefone válido com DDI e DDD (10 a 15 dígitos, ex.: +55 11 90000-0000)."
    );
  }
  return digits;
}
