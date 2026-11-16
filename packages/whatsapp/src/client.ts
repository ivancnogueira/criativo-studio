import QRCode from "qrcode";
import type { StatusMensageria } from "@criativo/contracts";
import { useSqliteAuthState } from "./auth-store.ts";
import type {
  BaileysConnectionUpdate,
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  OutgoingWhatsAppPayload,
  SqliteConnectionLike,
  WhatsAppStatusSnapshot,
} from "./types.ts";

export type SocketFactory = (authState: unknown) => Promise<BaileysSocketLike>;

export interface WhatsAppClientOptions {
  db: SqliteConnectionLike;
  socketFactory?: SocketFactory;
  onStatusChange?: (status: WhatsAppStatusSnapshot) => void;
  onMessage?: (msg: IncomingWhatsAppMessage) => Promise<void> | void;
  reconnectDelayMs?: number;
}

const LOGOUT_STATUS_CODE = 401;

async function defaultBaileysFactory(authState: unknown): Promise<BaileysSocketLike> {
  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket =
    (baileys as unknown as { default?: (cfg: unknown) => BaileysSocketLike }).default ??
    (baileys as unknown as { makeWASocket: (cfg: unknown) => BaileysSocketLike }).makeWASocket;

  return makeWASocket({
    auth: authState,
    printQRInTerminal: false,
    browser: ["Criativo AI Studio", "Chrome", "124.0.0"],
  });
}

/**
 * Cliente nativo de WhatsApp via Baileys com geração automática de QR Code base64,
 * persistência de sessão em SQLite e reconexão automática.
 */
export class WhatsAppStudioClient {
  private readonly db: SqliteConnectionLike;
  private readonly socketFactory: SocketFactory;
  private readonly onStatusChange?: (status: WhatsAppStatusSnapshot) => void;
  private readonly messageListeners = new Set<
    (msg: IncomingWhatsAppMessage) => Promise<void> | void
  >();
  private readonly reconnectDelayMs: number;

  private socket: BaileysSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;
  private currentStatus: WhatsAppStatusSnapshot = {
    tipo_servico: "whatsapp",
    status: "desconectado",
    qrcode_base64: null,
    numero: null,
    atualizado_em: new Date().toISOString(),
  };

  constructor(options: WhatsAppClientOptions) {
    this.db = options.db;
    this.socketFactory = options.socketFactory ?? defaultBaileysFactory;
    this.onStatusChange = options.onStatusChange;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 3000;
    if (options.onMessage) {
      this.messageListeners.add(options.onMessage);
    }
  }

  public onMessage(listener: (msg: IncomingWhatsAppMessage) => Promise<void> | void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  private persistStatus(status: StatusMensageria, qrcodeBase64: string | null): WhatsAppStatusSnapshot {
    const agora = new Date().toISOString();
    const numero = this.socket?.user?.id ? this.socket.user.id.split(":")[0] : null;

    this.db
      .prepare(
        `
        INSERT INTO projecao_conexoes_mensageria (
          tipo_servico, status, qrcode_base64, notificar_aprovacoes, atualizado_em
        ) VALUES ('whatsapp', ?, ?, 1, ?)
        ON CONFLICT(tipo_servico) DO UPDATE SET
          status = excluded.status,
          qrcode_base64 = excluded.qrcode_base64,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(status, qrcodeBase64, agora);

    this.currentStatus = {
      tipo_servico: "whatsapp",
      status,
      qrcode_base64: qrcodeBase64,
      numero,
      atualizado_em: agora,
    };

    this.onStatusChange?.(this.currentStatus);
    return this.currentStatus;
  }

  public async connect(): Promise<void> {
    this.manualDisconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const { state, saveCreds, clearState } = await useSqliteAuthState(this.db);
    this.socket = await this.socketFactory(state);

    this.socket.ev.on("creds.update", () => {
      void saveCreds();
    });

    this.socket.ev.on("connection.update", async (update: BaileysConnectionUpdate) => {
      if (update.qr) {
        const dataUrl = await QRCode.toDataURL(update.qr);
        this.persistStatus("aguardando_qrcode", dataUrl);
      }

      if (update.connection === "open") {
        this.persistStatus("conectado", null);
      } else if (update.connection === "close") {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = !this.manualDisconnect && statusCode !== LOGOUT_STATUS_CODE;

        if (statusCode === LOGOUT_STATUS_CODE) {
          await clearState();
        }
        this.persistStatus("desconectado", null);

        if (shouldReconnect) {
          this.reconnectTimer = setTimeout(() => {
            void this.connect();
          }, this.reconnectDelayMs);
          this.reconnectTimer.unref?.();
        }
      }
    });

    this.socket.ev.on(
      "messages.upsert",
      async (upsert: {
        messages?: Array<{
          key?: { id?: string; remoteJid?: string; fromMe?: boolean };
          pushName?: string;
          message?: {
            conversation?: string;
            extendedTextMessage?: { text?: string };
            audioMessage?: { mimetype?: string; directPath?: string };
          };
          audioBuffer?: Buffer;
        }>;
      }) => {
        for (const msg of upsert.messages ?? []) {
          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid || remoteJid === "status@broadcast") continue;

          const text =
            msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;

          const normalized: IncomingWhatsAppMessage = {
            messageId: msg.key?.id ?? `${Date.now()}`,
            remoteJid,
            fromMe: Boolean(msg.key?.fromMe),
            pushName: msg.pushName,
            text,
            audioBuffer: msg.audioBuffer,
            audioMimeType: msg.message?.audioMessage?.mimetype ?? "audio/ogg; codecs=opus",
            timestampMs: Date.now(),
          };

          for (const listener of this.messageListeners) {
            await listener(normalized);
          }
        }
      }
    );
  }

  public async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.end?.();
    this.socket = null;
    this.persistStatus("desconectado", null);
  }

  public async sendMessage(jid: string, content: OutgoingWhatsAppPayload): Promise<void> {
    if (!this.socket || this.currentStatus.status !== "conectado") {
      throw new Error("WhatsApp não está conectado para envio de mensagens.");
    }
    await this.socket.sendMessage(jid, content);
  }

  public getStatus(): WhatsAppStatusSnapshot {
    const row = this.db
      .prepare(
        `SELECT tipo_servico, status, qrcode_base64, atualizado_em FROM projecao_conexoes_mensageria WHERE tipo_servico = 'whatsapp';`
      )
      .get() as WhatsAppStatusSnapshot | undefined;

    return row ?? this.currentStatus;
  }
}
