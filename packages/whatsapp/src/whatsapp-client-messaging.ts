import { randomUUID } from "node:crypto";
import { generateMessageIDV2 } from "@whiskeysockets/baileys";
import type { StatusMensageria, WhatsAppModoOperacao } from "@criativo/contracts";
import { DEFAULT_WHATSAPP_ACCOUNT_ID, useSqliteAuthState } from "./auth-store.ts";
import type {
  OutgoingWhatsAppPayload,
  WhatsAppSendOptions,
  WhatsAppSendResult,
  WhatsAppStatusSnapshot,
} from "./types.ts";
import {
  WA_ACK_WAIT_MS,
  WA_CHAT_PACING_MS,
  type WhatsAppClientConnectDeps,
} from "./whatsapp-client-helpers.ts";

export async function waClientDisconnect(
  deps: WhatsAppClientConnectDeps,options: { limparSessao?: boolean } = {}): Promise<void> {
    deps.setManualDisconnect(true);
    deps.clearTimers();

    const activeSocket = deps.getSocket();
    deps.dropCurrentSocket();

    if (options.limparSessao) {
      try {
        await activeSocket?.logout?.();
      } catch {
        // Ignora erro de logout remoto
      }
      const { clearState } = await useSqliteAuthState(deps.db, deps.contaId);
      await clearState();
    }

    deps.persistStatus("desconectado", null, {
      pairingCode: null,
      ultimoErro: null,
      ...(options.limparSessao ? { conectadoEm: null } : {}),
    });
  }

function enqueueChatSend<T>(
  deps: WhatsAppClientConnectDeps,chatJid: string, task: () => Promise<T>): Promise<T> {
    const previous = deps.getChatQueues().get(chatJid) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    deps.getChatQueues().set(chatJid, next);
    const cleanup = () => {
      if (deps.getChatQueues().get(chatJid) === next) {
        deps.getChatQueues().delete(chatJid);
      }
    };
    next.then(cleanup, cleanup);
    return next;
  }

export async function waClientSendMessage(
  deps: WhatsAppClientConnectDeps,
    jid: string,
    content: OutgoingWhatsAppPayload,
    options: WhatsAppSendOptions = {}
  ): Promise<WhatsAppSendResult> {
    if (!deps.getSocket() || deps.getCurrentStatus().status !== "conectado") {
      throw new Error("WhatsApp não está conectado para envio de mensagens.");
    }

    return enqueueChatSend(deps, jid, async () => {
      const socketRef = deps.getSocket();
      if (!socketRef || deps.getCurrentStatus().status !== "conectado") {
        throw new Error("WhatsApp não está conectado para envio de mensagens.");
      }

      const lastSentAt = deps.getLastSendByChat().get(jid) ?? 0;
      const elapsed = deps.now() - lastSentAt;
      if (lastSentAt > 0 && elapsed < WA_CHAT_PACING_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, WA_CHAT_PACING_MS - elapsed));
      }

      const messageId =
        options.messageId ??
        (typeof generateMessageIDV2 === "function"
          ? generateMessageIDV2(socketRef.user?.id)
          : `msg-${randomUUID()}`);

      deps.rememberSentMessageId(messageId);

      let ackPromise: Promise<{ status: "ack" | "timeout"; error?: string }> | null = null;
      let ackTimer: NodeJS.Timeout | null = null;

      if (options.waitAck) {
        ackPromise = new Promise<{ status: "ack" | "timeout"; error?: string }>((resolve) => {
          const finish = (ackError?: string) => {
            if (ackTimer) {
              clearTimeout(ackTimer);
              ackTimer = null;
            }
            deps.getPendingAcks().delete(messageId);
            resolve({ status: "ack", error: ackError });
          };
          deps.getPendingAcks().set(messageId, finish);
          ackTimer = setTimeout(() => {
            if (deps.getPendingAcks().get(messageId) === finish) {
              deps.getPendingAcks().delete(messageId);
              resolve({ status: "timeout" });
            }
          }, options.ackTimeoutMs ?? WA_ACK_WAIT_MS);
          ackTimer.unref?.();
        });
      }

      try {
        const raw = await socketRef.sendMessage(jid, content, {
          messageId,
          ...(options.quoted ? { quoted: options.quoted } : {}),
        });
        deps.getLastSendByChat().set(jid, deps.now());
        deps.setLastActivityAt(deps.now());

        const returnedId =
          (raw as { key?: { id?: string } } | undefined)?.key?.id ?? messageId;
        if (returnedId !== messageId) {
          deps.rememberSentMessageId(returnedId);
        }

        if (!ackPromise) {
          return {
            messageId: returnedId,
            ackStatus: "sem_ack",
            raw,
          };
        }

        const ackRes = await ackPromise;
        if (ackRes.error) {
          throw new Error(`Mensagem WhatsApp recusada pelo servidor (${ackRes.error}).`);
        }

        return {
          messageId: returnedId,
          ackStatus: ackRes.status,
          raw,
        };
      } catch (err) {
        if (ackTimer) {
          clearTimeout(ackTimer);
        }
        deps.getPendingAcks().delete(messageId);
        throw err;
      }
    });
  }

export function waClientGetStatus(
  deps: WhatsAppClientConnectDeps): WhatsAppStatusSnapshot {
    const row = deps.db
      .prepare(
        `
        SELECT
          conta_id,
          status,
          qrcode_base64,
          pairing_code,
          numero_telefone,
          jid_proprio,
          modo_operacao,
          ultimo_erro,
          conectado_em,
          atualizado_em
        FROM whatsapp_contas
        WHERE conta_id = ?
        LIMIT 1;
      `
      )
      .get(deps.contaId) as
      | {
          conta_id: string;
          status: StatusMensageria;
          qrcode_base64: string | null;
          pairing_code: string | null;
          numero_telefone: string | null;
          jid_proprio: string | null;
          modo_operacao: WhatsAppModoOperacao;
          ultimo_erro: string | null;
          conectado_em: string | null;
          atualizado_em: string;
        }
      | undefined;

    if (row) {
      return {
        tipo_servico: "whatsapp",
        conta_id: row.conta_id,
        status: row.status,
        qrcode_base64: row.qrcode_base64,
        pairing_code: row.pairing_code,
        numero: row.numero_telefone ?? deps.getCurrentStatus().numero ?? null,
        jid_proprio: row.jid_proprio ?? deps.getCurrentStatus().jid_proprio ?? null,
        modo_operacao: row.modo_operacao,
        ultimo_erro: row.ultimo_erro,
        conectado_em: row.conectado_em,
        atualizado_em: row.atualizado_em,
      };
    }

    if (deps.contaId === DEFAULT_WHATSAPP_ACCOUNT_ID) {
      const legacy = deps.db
        .prepare(
          `SELECT tipo_servico, status, qrcode_base64, atualizado_em FROM projecao_conexoes_mensageria WHERE tipo_servico = 'whatsapp';`
        )
        .get() as WhatsAppStatusSnapshot | undefined;
      if (legacy) {
        return {
          ...legacy,
          conta_id: deps.contaId,
          numero: deps.getCurrentStatus().numero ?? null,
        };
      }
    }

    return deps.getCurrentStatus();
  }
