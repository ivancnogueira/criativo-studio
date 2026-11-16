import type { StatusMensageria } from "@criativo/contracts";

export interface PreparedStatementLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}

export interface SqliteConnectionLike {
  prepare(sql: string): PreparedStatementLike;
}

export interface WhatsAppStatusSnapshot {
  tipo_servico: "whatsapp";
  status: StatusMensageria;
  qrcode_base64: string | null;
  numero?: string | null;
  atualizado_em: string;
}

export interface BaileysConnectionUpdate {
  connection?: "open" | "close" | "connecting";
  qr?: string;
  lastDisconnect?: {
    error?: {
      output?: { statusCode?: number };
    } & Error;
  };
}

export interface IncomingWhatsAppMessage {
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
  pushName?: string;
  text?: string;
  audioBuffer?: Buffer;
  audioMimeType?: string;
  timestampMs?: number;
}

export interface OutgoingWhatsAppPayload {
  text?: string;
  image?: Buffer | { url: string };
  video?: Buffer | { url: string };
  caption?: string;
}

export interface BaileysSocketLike {
  user?: { id?: string; name?: string };
  ev: {
    on(event: string, listener: (...args: any[]) => void): void;
  };
  sendMessage(jid: string, content: OutgoingWhatsAppPayload): Promise<unknown>;
  end?(error?: Error): void;
}
