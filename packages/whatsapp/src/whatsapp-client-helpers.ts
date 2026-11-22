import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestWaWebVersion,
  generateMessageIDV2,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
} from "@whiskeysockets/baileys";
import {
  normalizeWhatsAppPairingPhone,
  type StatusMensageria,
  type WhatsAppMetodoPareamento,
  type WhatsAppModoOperacao,
} from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  ensureWhatsAppAccountRow,
  useSqliteAuthState,
} from "./auth-store.ts";
import type {
  BaileysConnectionUpdate,
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  OutgoingWhatsAppPayload,
  SocketFactoryContext,
  SqliteConnectionLike,
  WhatsAppCloseReason,
  WhatsAppConnectOptions,
  WhatsAppMediaKind,
  WhatsAppSendOptions,
  WhatsAppSendResult,
  WhatsAppStatusSnapshot,
} from "./types.ts";

export const WA_VERSION_TIMEOUT_MS = 5_000;
export const WA_VERSION_CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
export const WA_VERSION_CONFIG_KEY = "whatsapp_wa_web_version";
export const WA_KEEP_ALIVE_MS = 25_000;
export const WA_CONNECT_TIMEOUT_MS = 60_000;
export const WA_QUERY_TIMEOUT_MS = 60_000;
export const WA_BACKOFF_START_MS = 2_000;
export const WA_BACKOFF_MAX_MS = 30_000;
export const WA_BACKOFF_FACTOR = 1.8;
export const WA_BACKOFF_JITTER = 0.25;
export const WA_STABLE_MS = 60_000;
export const WA_WATCHDOG_SILENCE_MS = 90_000;
export const WA_WATCHDOG_INTERVAL_MS = 15_000;
export const WA_CHAT_PACING_MS = 1_000;
export const WA_ECHO_TTL_MS = 20 * 60_000;
export const WA_ECHO_MAX_ENTRIES = 5_000;
export const WA_ACK_WAIT_MS = 10_000;
export const WA_MESSAGE_ACK_EVENT = "CB:ack,class:message";
export const WA_QR_BROWSER: [string, string, string] = ["Criativo Studio", "Chrome", "1.0.0"];
export const WA_PAIRING_CODE_BROWSER: [string, string, string] = ["Chrome (Linux)", "", ""];

export type SocketFactory = (
  authState: unknown,
  context?: SocketFactoryContext
) => Promise<BaileysSocketLike>;

export type WaVersionFetcher = () => Promise<[number, number, number] | null>;

export interface WhatsAppClientOptions {
  db: SqliteConnectionLike;
  contaId?: string;
  socketFactory?: SocketFactory;
  versionFetcher?: WaVersionFetcher;
  onStatusChange?: (status: WhatsAppStatusSnapshot) => void;
  onMessage?: (msg: IncomingWhatsAppMessage) => Promise<void> | void;
  reconnectDelayMs?: number;
  silenceTimeoutMs?: number;
  watchdogIntervalMs?: number;
  now?: () => number;
  random?: () => number;
}

export interface CachedWaVersionPayload {
  version: [number, number, number];
  fetchedAt: number;
}

export interface WhatsAppAckNode {
  attrs?: {
    id?: string;
    error?: string;
  };
}

export let inMemoryWaVersionCache: CachedWaVersionPayload | null = null;
export function setInMemoryWaVersionCache(val: CachedWaVersionPayload | null) { inMemoryWaVersionCache = val; }

export const silentBaileysLogger = {
  level: "silent",
  child: () => silentBaileysLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function isValidWaVersion(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === "number" && Number.isInteger(part) && part >= 0)
  );
}

/**
 * Classifica o motivo de encerramento da sessão Baileys para decidir se deve
 * limpar credenciais, interromper reconexão ou aplicar backoff/restart.
 */
export function classifyCloseDecision(statusCode?: number): WhatsAppCloseReason {
  if (
    statusCode === DisconnectReason.loggedOut ||
    statusCode === DisconnectReason.forbidden ||
    statusCode === DisconnectReason.multideviceMismatch
  ) {
    return "fatal";
  }
  if (statusCode === DisconnectReason.connectionReplaced) {
    return "replaced";
  }
  if (statusCode === DisconnectReason.restartRequired) {
    return "restart";
  }
  if (statusCode === DisconnectReason.timedOut) {
    return "timeout";
  }
  if (
    statusCode === DisconnectReason.connectionClosed ||
    statusCode === DisconnectReason.unavailableService
  ) {
    return "unreachable";
  }
  return "retry";
}

/**
 * Calcula atraso exponencial com jitter (±25%) limitado entre 2s e 30s (por padrão).
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseMs: number = WA_BACKOFF_START_MS,
  randomFn: () => number = Math.random
): number {
  const safeAttempt = Math.max(0, attempt);
  const capped = Math.min(WA_BACKOFF_MAX_MS, baseMs * WA_BACKOFF_FACTOR ** safeAttempt);
  const multiplier = 1 - WA_BACKOFF_JITTER + 2 * WA_BACKOFF_JITTER * randomFn();
  return Math.max(100, Math.round(capped * multiplier));
}

export function formatPairingCodeDisplay(rawCode: string): string {
  const cleaned = rawCode.replace(/[^A-Z0-9]/giu, "").toUpperCase();
  if (cleaned.length === 8) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  }
  return cleaned;
}

export async function defaultWaVersionFetcher(): Promise<[number, number, number] | null> {
  const result = await fetchLatestWaWebVersion({
    signal: AbortSignal.timeout(WA_VERSION_TIMEOUT_MS),
  });
  return isValidWaVersion(result.version) ? result.version : null;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("wa_version_timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function defaultBaileysFactory(
  authState: unknown,
  context?: SocketFactoryContext
): Promise<BaileysSocketLike> {
  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket =
    (baileys as unknown as { default?: (cfg: unknown) => BaileysSocketLike }).default ??
    (baileys as unknown as { makeWASocket: (cfg: unknown) => BaileysSocketLike }).makeWASocket;

  const typedAuth = authState as { creds?: unknown; keys?: unknown } | undefined;
  const wrappedAuth =
    typedAuth && typedAuth.keys
      ? {
          creds: typedAuth.creds,
          keys: makeCacheableSignalKeyStore(
            typedAuth.keys as Parameters<typeof makeCacheableSignalKeyStore>[0],
            silentBaileysLogger as unknown as Parameters<typeof makeCacheableSignalKeyStore>[1]
          ),
        }
      : authState;

  return makeWASocket({
    auth: wrappedAuth,
    version: context?.version ?? DEFAULT_CONNECTION_CONFIG.version,
    browser: context?.browser ?? WA_QR_BROWSER,
    printQRInTerminal: false,
    logger: silentBaileysLogger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    emitOwnEvents: true,
    fireInitQueries: true,
    generateHighQualityLinkPreview: false,
    keepAliveIntervalMs: WA_KEEP_ALIVE_MS,
    connectTimeoutMs: WA_CONNECT_TIMEOUT_MS,
    defaultQueryTimeoutMs: WA_QUERY_TIMEOUT_MS,
  }) as unknown as BaileysSocketLike;
}

export function normalizePhoneFromJid(jid?: string | null): string | null {
  if (!jid || typeof jid !== "string") return null;
  const local = jid.split("@")[0]?.split(":")[0] ?? "";
  const digits = local.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

export function readMessageTimestampMs(rawTimestamp: unknown, fallbackMs: number): number {
  if (typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)) {
    return rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
  }
  if (
    rawTimestamp &&
    typeof rawTimestamp === "object" &&
    "toNumber" in rawTimestamp &&
    typeof (rawTimestamp as { toNumber?: unknown }).toNumber === "function"
  ) {
    const num = (rawTimestamp as { toNumber: () => number }).toNumber();
    return num > 1e12 ? num : num * 1000;
  }
  return fallbackMs;
}

export function toNumberSafe(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (
    raw &&
    typeof raw === "object" &&
    "toNumber" in raw &&
    typeof (raw as { toNumber?: unknown }).toNumber === "function"
  ) {
    return (raw as { toNumber: () => number }).toNumber();
  }
  return undefined;
}

export interface WhatsAppClientConnectDeps {
  contaId: string;
  db: SqliteConnectionLike;
  socketFactory: SocketFactory;
  now: () => number;
  getManualDisconnect: () => boolean;
  setManualDisconnect: (v: boolean) => void;
  getSocket: () => BaileysSocketLike | null;
  setSocket: (s: BaileysSocketLike | null) => void;
  getActiveMode: () => WhatsAppMetodoPareamento;
  setActiveMode: (m: WhatsAppMetodoPareamento) => void;
  setActivePhoneNumber: (p: string | null) => void;
  getPairingCodeRequested: () => boolean;
  setPairingCodeRequested: (v: boolean) => void;
  getCachedOwnLid: () => string | null;
  setCachedOwnLid: (lid: string | null) => void;
  getOpenedAt: () => number;
  setOpenedAt: (ms: number) => void;
  setLastActivityAt: (ms: number) => void;
  setReconnectAttempts: (n: number) => void;
  getMessageListeners: () => Set<(msg: IncomingWhatsAppMessage) => Promise<void> | void>;
  getChatQueues: () => Map<string, Promise<unknown>>;
  getLastSendByChat: () => Map<string, number>;
  getCurrentStatus: () => WhatsAppStatusSnapshot;
  getPendingAcks: () => Map<string, (error?: string) => void>;
  clearTimers: () => void;
  dropCurrentSocket: (notifyEndError?: Error) => void;
  persistStatus: (
    status: StatusMensageria,
    qrCodeDataUrl: string | null,
    extras?: {
      pairingCode?: string | null;
      numeroTelefone?: string | null;
      jidProprio?: string | null;
      ultimoErro?: string | null;
      conectadoEm?: string | null;
    }
  ) => void;
  resolveWaWebVersion: () => Promise<[number, number, number]>;
  startWatchdog: (socketRef: BaileysSocketLike) => void;
  startStabilityResetTimer: (socketRef: BaileysSocketLike) => void;
  scheduleReconnect: (reasonMessage: string, fixedDelayMs?: number) => void;
  triggerPairingCodeRequest: (socketRef: BaileysSocketLike) => Promise<void>;
  handleAckNode: (node: WhatsAppAckNode | undefined) => void;
  isEchoMessageId: (messageId?: string | null) => boolean;
  rememberSentMessageId: (messageId: string) => void;
  resolveLidToPn: (lid: string) => Promise<string | null>;
}
