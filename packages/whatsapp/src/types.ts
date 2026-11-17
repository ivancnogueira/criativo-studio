import type {
  StatusMensageria,
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
} from "@criativo/contracts";

export interface PreparedStatementLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}

export interface SqliteConnectionLike {
  prepare(sql: string): PreparedStatementLike;
}

export type WhatsAppCloseReason =
  | "fatal"
  | "replaced"
  | "restart"
  | "timeout"
  | "unreachable"
  | "retry";

export type WhatsAppMediaKind = "imagem" | "documento" | "audio" | "video";

export interface WhatsAppStatusSnapshot {
  tipo_servico: "whatsapp";
  conta_id?: string;
  status: StatusMensageria;
  qrcode_base64: string | null;
  pairing_code?: string | null;
  numero?: string | null;
  jid_proprio?: string | null;
  modo_operacao?: WhatsAppModoOperacao;
  ultimo_erro?: string | null;
  conectado_em?: string | null;
  atualizado_em: string;
}

export interface BaileysConnectionUpdate {
  connection?: "open" | "close" | "connecting";
  qr?: string;
  isNewLogin?: boolean;
  lastDisconnect?: {
    error?: {
      output?: { statusCode?: number };
      message?: string;
    } & Error;
  };
}

export interface IncomingWhatsAppMessage {
  contaId?: string;
  messageId: string;
  remoteJid: string;
  remoteJidAlt?: string | null;
  fromMe: boolean;
  pushName?: string;
  text?: string;
  audioBuffer?: Buffer;
  audioMimeType?: string;
  timestampMs?: number;
  participant?: string | null;
  participantAlt?: string | null;
  quotedMessageId?: string | null;
  quotedParticipant?: string | null;
  mentionedJids?: string[];
  isGroup?: boolean;
  mediaType?: WhatsAppMediaKind | null;
  rawMessage?: unknown;
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaFileSize?: number;
  upsertType?: string;
}

export interface OutgoingWhatsAppPayload {
  text?: string;
  image?: Buffer | { url: string };
  video?: Buffer | { url: string };
  document?: Buffer | { url: string };
  audio?: Buffer | { url: string };
  mimetype?: string;
  fileName?: string;
  ptt?: boolean;
  caption?: string;
  mentions?: string[];
}

export interface WhatsAppGroupSummary {
  id: string;
  subject?: string;
  participants?: Array<{ id: string }>;
}

export interface BaileysSocketLike {
  user?: { id?: string; name?: string; lid?: string };
  ev: {
    on(event: string, listener: (...args: any[]) => void): void;
    off?(event: string, listener: (...args: any[]) => void): void;
  };
  ws?: {
    on?(event: string, listener: (...args: any[]) => void): void;
    off?(event: string, listener: (...args: any[]) => void): void;
  };
  sendMessage(
    jid: string,
    content: OutgoingWhatsAppPayload,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  requestPairingCode?(phoneNumber: string, customPairingCode?: string): Promise<string>;
  groupFetchAllParticipating?(): Promise<Record<string, WhatsAppGroupSummary>>;
  groupMetadata?(jid: string): Promise<WhatsAppGroupSummary>;
  onWhatsApp?(...phoneNumbers: string[]): Promise<Array<{ jid: string; exists: boolean }> | undefined>;
  signalRepository?: {
    lidMapping?: {
      getPNForLID?(lid: string): Promise<string | null>;
    };
  };
  updateMediaMessage?(msg: unknown): Promise<unknown>;
  query?(node: unknown): Promise<unknown>;
  logout?(msg?: string): Promise<void>;
  end?(error?: Error): void;
}

export interface WhatsAppConnectOptions {
  mode?: WhatsAppMetodoPareamento;
  phoneNumber?: string;
}

export interface WhatsAppSendOptions {
  waitAck?: boolean;
  messageId?: string;
  quoted?: unknown;
  ackTimeoutMs?: number;
}

export interface WhatsAppSendResult {
  messageId: string;
  ackStatus: "ack" | "timeout" | "sem_ack" | "recusado";
  ackError?: string;
  raw?: unknown;
}

export interface SocketFactoryContext {
  contaId: string;
  version: [number, number, number];
  browser: [string, string, string];
  mode: WhatsAppMetodoPareamento;
}
