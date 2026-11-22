import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  normalizeMessageContent,
} from "@whiskeysockets/baileys";
import {
  normalizeWhatsAppPairingPhone,
  type WhatsAppMetodoPareamento,
} from "@criativo/contracts";
import { useSqliteAuthState } from "./auth-store.ts";
import type {
  BaileysConnectionUpdate,
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  WhatsAppConnectOptions,
  WhatsAppMediaKind,
} from "./types.ts";
import {
  WA_MESSAGE_ACK_EVENT,
  WA_PAIRING_CODE_BROWSER,
  WA_QR_BROWSER,
  WA_STABLE_MS,
  classifyCloseDecision,
  normalizePhoneFromJid,
  readMessageTimestampMs,
  toNumberSafe,
  type WhatsAppAckNode,
  type WhatsAppClientConnectDeps,
} from "./whatsapp-client-helpers.ts";

export async function waClientConnect(
  deps: WhatsAppClientConnectDeps,options: WhatsAppConnectOptions = {}): Promise<void> {
    deps.setManualDisconnect(false);
    deps.clearTimers();

    const mode: WhatsAppMetodoPareamento = options.mode ?? "qr";
    let phoneDigits: string | null = null;
    if (mode === "pairing_code") {
      if (!options.phoneNumber) {
        throw new Error("Informe o número de telefone para pareamento por código numérico.");
      }
      phoneDigits = normalizeWhatsAppPairingPhone(options.phoneNumber);
    }

    deps.setActiveMode(mode);
    deps.setActivePhoneNumber(phoneDigits);
    deps.setPairingCodeRequested(false);

    deps.dropCurrentSocket();

    const { state, saveCreds, clearState } = await useSqliteAuthState(deps.db, deps.contaId);
    const initialLid = (state.creds as { me?: { lid?: string } } | undefined)?.me?.lid;
    if (typeof initialLid === "string" && initialLid.trim().length > 0) {
      deps.setCachedOwnLid(initialLid.trim());
    }

    if (deps.getManualDisconnect()) {
      return;
    }

    if (!state.creds?.registered) {
      deps.persistStatus("aguardando_qrcode", null, {
        pairingCode: null,
        ultimoErro: null,
      });
    }

    const version = await deps.resolveWaWebVersion();

    if (deps.getManualDisconnect()) {
      return;
    }

    const browser = mode === "pairing_code" ? WA_PAIRING_CODE_BROWSER : WA_QR_BROWSER;
    let socket: BaileysSocketLike;
    try {
      socket = await deps.socketFactory(state, {
        contaId: deps.contaId,
        version,
        browser,
        mode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.persistStatus("desconectado", null, {
        pairingCode: null,
        ultimoErro: msg,
      });
      throw err;
    }

    if (deps.getManualDisconnect()) {
      try {
        socket.end?.();
      } catch {
        // Ignora
      }
      return;
    }

    deps.setSocket(socket);
    deps.setLastActivityAt(deps.now());

    socket.ev.on("creds.update", () => {
      if (deps.getSocket() !== socket) return;
      const updatedLid =
        socket.user?.lid ??
        (state.creds as { me?: { lid?: string } } | undefined)?.me?.lid ??
        null;
      if (updatedLid) {
        deps.setCachedOwnLid(updatedLid);
      }
      void saveCreds();
    });

    const recordFrameActivity = () => {
      if (deps.getSocket() === socket) {
        deps.setLastActivityAt(deps.now());
      }
    };
    socket.ws?.on?.("frame", recordFrameActivity);
    socket.ws?.on?.(WA_MESSAGE_ACK_EVENT, (node: WhatsAppAckNode) => {
      if (deps.getSocket() === socket) {
        deps.setLastActivityAt(deps.now());
        deps.handleAckNode(node);
      }
    });
    socket.ev.on(WA_MESSAGE_ACK_EVENT, (node: WhatsAppAckNode) => {
      if (deps.getSocket() === socket) {
        deps.setLastActivityAt(deps.now());
        deps.handleAckNode(node);
      }
    });

    socket.ev.on("connection.update", async (update: BaileysConnectionUpdate) => {
      if (deps.getSocket() !== socket) return;
      deps.setLastActivityAt(deps.now());

      if (deps.getActiveMode() === "pairing_code" && !deps.getPairingCodeRequested()) {
        if (update.qr || update.connection === "connecting") {
          await deps.triggerPairingCodeRequest(socket);
        }
      } else if (update.qr && deps.getActiveMode() === "qr") {
        const dataUrl = await QRCode.toDataURL(update.qr);
        deps.persistStatus("aguardando_qrcode", dataUrl, {
          pairingCode: null,
          ultimoErro: null,
        });
      }

      if (update.connection === "open") {
        deps.setOpenedAt(deps.now());
        deps.setLastActivityAt(deps.getOpenedAt());
        const openLid =
          socket.user?.lid ??
          (state.creds as { me?: { lid?: string } } | undefined)?.me?.lid ??
          null;
        if (openLid) {
          deps.setCachedOwnLid(openLid);
        }
        deps.setActiveMode("qr");
        deps.setActivePhoneNumber(null);
        deps.setPairingCodeRequested(false);
        deps.startWatchdog(socket);
        deps.startStabilityResetTimer(socket);
        deps.persistStatus("conectado", null, {
          pairingCode: null,
          ultimoErro: null,
          conectadoEm: new Date(deps.getOpenedAt()).toISOString(),
        });
        return;
      }

      if (update.connection === "close") {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const decision = classifyCloseDecision(statusCode);
        if (deps.getOpenedAt() > 0 && deps.now() - deps.getOpenedAt() >= WA_STABLE_MS) {
          deps.setReconnectAttempts(0);
        }
        deps.dropCurrentSocket();

        if (deps.getManualDisconnect()) {
          deps.persistStatus("desconectado", null, { pairingCode: null, ultimoErro: null });
          return;
        }

        if (decision === "fatal") {
          await clearState();
          deps.setReconnectAttempts(0);
          deps.persistStatus("desconectado", null, {
            pairingCode: null,
            ultimoErro: "Sessão encerrada ou desconectada pelo aparelho (401/403).",
            conectadoEm: null,
          });
          return;
        }

        if (decision === "replaced") {
          deps.setReconnectAttempts(0);
          deps.persistStatus("desconectado", null, {
            pairingCode: null,
            ultimoErro: "Sessão substituída por outra conexão WhatsApp (440).",
          });
          return;
        }

        if (decision === "restart") {
          deps.scheduleReconnect("Reinicialização solicitada pelo servidor WhatsApp (515).", 500);
          return;
        }

        if (decision === "timeout") {
          deps.scheduleReconnect("Tempo limite atingido na conexão WhatsApp (408).");
          return;
        }

        if (decision === "unreachable") {
          deps.scheduleReconnect("Servidor WhatsApp temporariamente inacessível (428/503).");
          return;
        }

        deps.scheduleReconnect(
          update.lastDisconnect?.error?.message
            ? `Conexão encerrada: ${update.lastDisconnect.error.message.slice(0, 160)}`
            : "Conexão encerrada inesperadamente; reconectando com backoff."
        );
      }
    });

    socket.ev.on(
      "messages.upsert",
      async (upsert: {
        type?: string;
        messages?: Array<{
          key?: {
            id?: string;
            remoteJid?: string;
            remoteJidAlt?: string;
            senderPn?: string;
            fromMe?: boolean;
            participant?: string;
            participantAlt?: string;
            participantPn?: string;
          };
          pushName?: string;
          messageTimestamp?: unknown;
          message?: Record<string, any>;
          audioBuffer?: Buffer;
        }>;
      }) => {
        if (deps.getSocket() !== socket) return;
        deps.setLastActivityAt(deps.now());

        const upsertType = upsert.type;
        const isAppendUpsert = upsertType === "append";
        if (upsertType && upsertType !== "notify" && !isAppendUpsert) {
          return;
        }

        for (const msg of upsert.messages ?? []) {
          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid) continue;
          if (
            isJidStatusBroadcast(remoteJid) ||
            isJidNewsletter(remoteJid) ||
            isJidBroadcast(remoteJid)
          ) {
            continue;
          }

          const msgTimestampMs = readMessageTimestampMs(
            msg.messageTimestamp,
            isAppendUpsert ? 0 : deps.now()
          );
          if (isAppendUpsert && deps.getOpenedAt() > 0 && msgTimestampMs < deps.getOpenedAt() - 15_000) {
            continue;
          }

          const messageId = msg.key?.id ?? `${deps.now()}-${randomUUID().slice(0, 6)}`;
          const fromMe = Boolean(msg.key?.fromMe);

          // Deduplicação de ecos das próprias mensagens enviadas pelo estúdio (TTL 20min)
          if (fromMe && deps.isEchoMessageId(messageId)) {
            continue;
          }

          const content = (normalizeMessageContent(msg.message as never) ?? msg.message ?? {}) as Record<
            string,
            any
          >;

          const text =
            (content.conversation as string | undefined) ??
            (content.extendedTextMessage?.text as string | undefined) ??
            (content.imageMessage?.caption as string | undefined) ??
            (content.videoMessage?.caption as string | undefined) ??
            (content.documentMessage?.caption as string | undefined) ??
            undefined;

          const contextInfo =
            content.extendedTextMessage?.contextInfo ??
            content.imageMessage?.contextInfo ??
            content.videoMessage?.contextInfo ??
            content.documentMessage?.contextInfo ??
            content.audioMessage?.contextInfo ??
            undefined;

          let mediaType: WhatsAppMediaKind | null = null;
          let mediaMimeType: string | undefined;
          let mediaFileName: string | undefined;
          let mediaFileSize: number | undefined;

          if (content.imageMessage) {
            mediaType = "imagem";
            mediaMimeType = content.imageMessage.mimetype ?? "image/jpeg";
            mediaFileSize = toNumberSafe(content.imageMessage.fileLength);
          } else if (content.videoMessage) {
            mediaType = "video";
            mediaMimeType = content.videoMessage.mimetype ?? "video/mp4";
            mediaFileSize = toNumberSafe(content.videoMessage.fileLength);
          } else if (content.audioMessage || msg.audioBuffer) {
            mediaType = "audio";
            mediaMimeType = content.audioMessage?.mimetype ?? "audio/ogg; codecs=opus";
            mediaFileSize =
              toNumberSafe(content.audioMessage?.fileLength) ?? msg.audioBuffer?.byteLength;
          } else if (content.documentMessage) {
            mediaType = "documento";
            mediaMimeType = content.documentMessage.mimetype ?? "application/octet-stream";
            mediaFileName = content.documentMessage.fileName ?? undefined;
            mediaFileSize = toNumberSafe(content.documentMessage.fileLength);
          }

          const normalized: IncomingWhatsAppMessage = {
            contaId: deps.contaId,
            messageId,
            remoteJid,
            remoteJidAlt: msg.key?.remoteJidAlt ?? msg.key?.senderPn ?? null,
            fromMe,
            pushName: msg.pushName,
            text,
            audioBuffer: msg.audioBuffer,
            audioMimeType:
              content.audioMessage?.mimetype ??
              (msg.audioBuffer ? "audio/ogg; codecs=opus" : undefined),
            timestampMs: readMessageTimestampMs(msg.messageTimestamp, deps.now()),
            participant: msg.key?.participant ?? null,
            participantAlt: msg.key?.participantAlt ?? msg.key?.participantPn ?? null,
            quotedMessageId: contextInfo?.stanzaId ?? null,
            quotedParticipant: contextInfo?.participant ?? null,
            mentionedJids: Array.isArray(contextInfo?.mentionedJid)
              ? (contextInfo.mentionedJid as string[])
              : [],
            isGroup: Boolean(isJidGroup(remoteJid)),
            mediaType,
            rawMessage: msg,
            mediaMimeType,
            mediaFileName,
            mediaFileSize,
            upsertType: upsert.type,
          };

          for (const listener of deps.getMessageListeners()) {
            await listener(normalized);
          }
        }
      }
    );
  }
