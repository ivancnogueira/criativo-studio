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

interface CachedWaVersionPayload {
  version: [number, number, number];
  fetchedAt: number;
}

interface WhatsAppAckNode {
  attrs?: {
    id?: string;
    error?: string;
  };
}

let inMemoryWaVersionCache: CachedWaVersionPayload | null = null;

const silentBaileysLogger = {
  level: "silent",
  child: () => silentBaileysLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function isValidWaVersion(value: unknown): value is [number, number, number] {
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

async function defaultWaVersionFetcher(): Promise<[number, number, number] | null> {
  const result = await fetchLatestWaWebVersion({
    signal: AbortSignal.timeout(WA_VERSION_TIMEOUT_MS),
  });
  return isValidWaVersion(result.version) ? result.version : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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

async function defaultBaileysFactory(
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
    emitOwnEvents: false,
    fireInitQueries: true,
    generateHighQualityLinkPreview: false,
    keepAliveIntervalMs: WA_KEEP_ALIVE_MS,
    connectTimeoutMs: WA_CONNECT_TIMEOUT_MS,
    defaultQueryTimeoutMs: WA_QUERY_TIMEOUT_MS,
  }) as unknown as BaileysSocketLike;
}

function normalizePhoneFromJid(jid?: string | null): string | null {
  if (!jid || typeof jid !== "string") return null;
  const local = jid.split("@")[0]?.split(":")[0] ?? "";
  const digits = local.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

function readMessageTimestampMs(rawTimestamp: unknown, fallbackMs: number): number {
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

function toNumberSafe(raw: unknown): number | undefined {
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

/**
 * Cliente WhatsApp via Baileys com suporte multi-conta (`contaId`), cache de versão WA Web,
 * pareamento dual (QR Code + Código Numérico), watchdog de silêncio 90s, backoff exponencial
 * com jitter, pacing 1s/chat, deduplicação de ecos e confirmação CB:ack.
 */
export class WhatsAppStudioClient {
  public readonly contaId: string;
  private readonly db: SqliteConnectionLike;
  private readonly socketFactory: SocketFactory;
  private readonly versionFetcher: WaVersionFetcher;
  private readonly onStatusChange?: (status: WhatsAppStatusSnapshot) => void;
  private readonly messageListeners = new Set<
    (msg: IncomingWhatsAppMessage) => Promise<void> | void
  >();
  private readonly baseReconnectDelayMs: number;
  private readonly silenceTimeoutMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  private socket: BaileysSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;
  private reconnectAttempts = 0;
  private openedAt = 0;
  private lastActivityAt = 0;
  private activeMode: WhatsAppMetodoPareamento = "qr";
  private activePhoneNumber: string | null = null;
  private pairingCodeRequested = false;

  private readonly sentEchoes = new Map<string, number>();
  private readonly pendingAcks = new Map<string, (error?: string) => void>();
  private readonly chatQueues = new Map<string, Promise<unknown>>();
  private readonly lastSendByChat = new Map<string, number>();
  private readonly lidCache = new Map<string, string | null>();

  private currentStatus: WhatsAppStatusSnapshot;

  constructor(options: WhatsAppClientOptions) {
    this.db = options.db;
    this.contaId = options.contaId?.trim() || DEFAULT_WHATSAPP_ACCOUNT_ID;
    this.socketFactory = options.socketFactory ?? defaultBaileysFactory;
    this.versionFetcher = options.versionFetcher ?? defaultWaVersionFetcher;
    this.onStatusChange = options.onStatusChange;
    this.baseReconnectDelayMs = options.reconnectDelayMs ?? WA_BACKOFF_START_MS;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? WA_WATCHDOG_SILENCE_MS;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? WA_WATCHDOG_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;

    if (options.onMessage) {
      this.messageListeners.add(options.onMessage);
    }

    this.currentStatus = {
      tipo_servico: "whatsapp",
      conta_id: this.contaId,
      status: "desconectado",
      qrcode_base64: null,
      pairing_code: null,
      numero: null,
      jid_proprio: null,
      modo_operacao: "dedicated",
      ultimo_erro: null,
      conectado_em: null,
      atualizado_em: new Date(this.now()).toISOString(),
    };
  }

  public getSocket(): BaileysSocketLike | null {
    return this.socket;
  }

  public onMessage(listener: (msg: IncomingWhatsAppMessage) => Promise<void> | void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public isEchoMessageId(messageId?: string | null): boolean {
    if (!messageId) return false;
    const recordedAt = this.sentEchoes.get(messageId);
    if (recordedAt === undefined) return false;
    if (this.now() - recordedAt >= WA_ECHO_TTL_MS) {
      this.sentEchoes.delete(messageId);
      return false;
    }
    return true;
  }

  public rememberSentMessageId(messageId: string): void {
    const currentNow = this.now();
    this.sentEchoes.set(messageId, currentNow);
    if (this.sentEchoes.size <= WA_ECHO_MAX_ENTRIES) {
      return;
    }
    for (const [id, at] of this.sentEchoes) {
      if (this.sentEchoes.size <= WA_ECHO_MAX_ENTRIES && currentNow - at < WA_ECHO_TTL_MS) {
        break;
      }
      this.sentEchoes.delete(id);
    }
  }

  public async resolveLidToPn(lid: string): Promise<string | null> {
    const normalizedLid = lid.split(":")[0]?.includes("@") ? lid : `${lid}@lid`;
    if (this.lidCache.has(normalizedLid)) {
      return this.lidCache.get(normalizedLid) ?? null;
    }
    const getter = this.socket?.signalRepository?.lidMapping?.getPNForLID;
    if (!getter) {
      return null;
    }
    try {
      const pn = await getter(normalizedLid);
      const digits = pn ? normalizePhoneFromJid(pn) : null;
      this.lidCache.set(normalizedLid, digits);
      return digits;
    } catch {
      return null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private resolveAllPendingAcks(error?: string): void {
    for (const finish of this.pendingAcks.values()) {
      finish(error);
    }
    this.pendingAcks.clear();
  }

  private dropCurrentSocket(notifyEndError?: Error): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    const oldSocket = this.socket;
    this.socket = null;
    this.resolveAllPendingAcks(undefined);
    if (oldSocket) {
      try {
        oldSocket.end?.(notifyEndError);
      } catch {
        // Socket já fechado
      }
    }
  }

  private readAccountConfigMeta(): { modo_operacao: WhatsAppModoOperacao; conectado_em: string | null } {
    try {
      const row = this.db
        .prepare(`SELECT modo_operacao, conectado_em FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
        .get(this.contaId) as { modo_operacao?: string; conectado_em?: string | null } | undefined;
      return {
        modo_operacao: row?.modo_operacao === "ownNumber" ? "ownNumber" : "dedicated",
        conectado_em: row?.conectado_em ?? null,
      };
    } catch {
      return { modo_operacao: "dedicated", conectado_em: null };
    }
  }

  private persistStatus(
    status: StatusMensageria,
    qrcodeBase64: string | null,
    extras: {
      pairingCode?: string | null;
      ultimoErro?: string | null;
      conectadoEm?: string | null;
    } = {}
  ): WhatsAppStatusSnapshot {
    const agora = new Date(this.now()).toISOString();
    const rawUserId = this.socket?.user?.id ?? null;
    const numero = normalizePhoneFromJid(rawUserId) ?? (status === "conectado" ? this.currentStatus.numero ?? null : null);
    const jidProprio = rawUserId ?? (status === "conectado" ? this.currentStatus.jid_proprio ?? null : null);

    ensureWhatsAppAccountRow(this.db, this.contaId);
    const meta = this.readAccountConfigMeta();

    const pairingCode = extras.pairingCode !== undefined ? extras.pairingCode : null;
    const ultimoErro = extras.ultimoErro !== undefined ? extras.ultimoErro : null;
    const conectadoEm =
      extras.conectadoEm !== undefined
        ? extras.conectadoEm
        : status === "conectado"
          ? meta.conectado_em ?? agora
          : meta.conectado_em;

    this.db
      .prepare(
        `
        UPDATE whatsapp_contas
        SET status = ?,
            qrcode_base64 = ?,
            pairing_code = ?,
            numero_telefone = COALESCE(?, numero_telefone),
            jid_proprio = COALESCE(?, jid_proprio),
            ultimo_erro = ?,
            conectado_em = ?,
            atualizado_em = ?
        WHERE conta_id = ?;
      `
      )
      .run(
        status,
        qrcodeBase64,
        pairingCode,
        numero,
        jidProprio,
        ultimoErro,
        conectadoEm,
        agora,
        this.contaId
      );

    if (this.contaId === DEFAULT_WHATSAPP_ACCOUNT_ID) {
      this.db
        .prepare(
          `
          INSERT INTO projecao_conexoes_mensageria (
            tipo_servico,
            status,
            qrcode_base64,
            pairing_code,
            numero_telefone,
            ultimo_erro,
            conectado_em,
            notificar_aprovacoes,
            atualizado_em
          ) VALUES ('whatsapp', ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(tipo_servico) DO UPDATE SET
            status = excluded.status,
            qrcode_base64 = excluded.qrcode_base64,
            pairing_code = excluded.pairing_code,
            numero_telefone = COALESCE(excluded.numero_telefone, projecao_conexoes_mensageria.numero_telefone),
            ultimo_erro = excluded.ultimo_erro,
            conectado_em = excluded.conectado_em,
            atualizado_em = excluded.atualizado_em;
        `
        )
        .run(status, qrcodeBase64, pairingCode, numero, ultimoErro, conectadoEm, agora);
    }

    this.currentStatus = {
      tipo_servico: "whatsapp",
      conta_id: this.contaId,
      status,
      qrcode_base64: qrcodeBase64,
      pairing_code: pairingCode,
      numero,
      jid_proprio: jidProprio,
      modo_operacao: meta.modo_operacao,
      ultimo_erro: ultimoErro,
      conectado_em: conectadoEm,
      atualizado_em: agora,
    };

    this.onStatusChange?.(this.currentStatus);
    return this.currentStatus;
  }

  private async resolveWaWebVersion(): Promise<[number, number, number]> {
    const currentNow = this.now();

    if (
      inMemoryWaVersionCache &&
      currentNow - inMemoryWaVersionCache.fetchedAt < WA_VERSION_CACHE_TTL_MS
    ) {
      return inMemoryWaVersionCache.version;
    }

    let persistedFallback: [number, number, number] | null = null;
    try {
      const row = this.db
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;`)
        .get(WA_VERSION_CONFIG_KEY) as { valor_json?: string } | undefined;

      if (row?.valor_json) {
        const parsed = JSON.parse(row.valor_json) as Partial<CachedWaVersionPayload>;
        if (isValidWaVersion(parsed?.version)) {
          persistedFallback = parsed.version;
          if (
            typeof parsed.fetchedAt === "number" &&
            currentNow - parsed.fetchedAt < WA_VERSION_CACHE_TTL_MS
          ) {
            inMemoryWaVersionCache = {
              version: parsed.version,
              fetchedAt: parsed.fetchedAt,
            };
            return parsed.version;
          }
        }
      }
    } catch {
      // Ignora cache corrompido ou ausência de tabela em mocks mínimos
    }

    try {
      const fetched = await withTimeout(this.versionFetcher(), WA_VERSION_TIMEOUT_MS);
      if (isValidWaVersion(fetched)) {
        const cacheEntry: CachedWaVersionPayload = {
          version: fetched,
          fetchedAt: currentNow,
        };
        inMemoryWaVersionCache = cacheEntry;
        try {
          this.db
            .prepare(
              `
              INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
              VALUES (?, ?, ?)
              ON CONFLICT(chave) DO UPDATE SET
                valor_json = excluded.valor_json,
                atualizado_em = excluded.atualizado_em;
            `
            )
            .run(WA_VERSION_CONFIG_KEY, JSON.stringify(cacheEntry), new Date(currentNow).toISOString());
        } catch {
          // Persistência do cache é melhor-esforço
        }
        return fetched;
      }
    } catch {
      // Offline ou timeout de 5_000ms -> fallback para último cache ou padrão Baileys
    }

    return persistedFallback ?? DEFAULT_CONNECTION_CONFIG.version;
  }

  private startWatchdog(socketRef: BaileysSocketLike): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }
    this.watchdogTimer = setInterval(() => {
      if (
        this.manualDisconnect ||
        this.socket !== socketRef ||
        this.currentStatus.status !== "conectado"
      ) {
        return;
      }
      if (this.now() - this.lastActivityAt < this.silenceTimeoutMs) {
        return;
      }

      // Socket silencioso por > 90_000ms -> força reconexão limpa
      this.dropCurrentSocket(new Error("watchdog_silence"));
      this.scheduleReconnect(
        "Silêncio prolongado na conexão WhatsApp (watchdog 90s).",
        Math.min(500, this.baseReconnectDelayMs)
      );
    }, this.watchdogIntervalMs);
    this.watchdogTimer.unref?.();
  }

  private startStabilityResetTimer(socketRef: BaileysSocketLike): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
    }
    this.stableTimer = setTimeout(() => {
      if (this.socket === socketRef && this.currentStatus.status === "conectado") {
        this.reconnectAttempts = 0;
      }
    }, WA_STABLE_MS);
    this.stableTimer.unref?.();
  }

  private scheduleReconnect(reasonMessage: string, fixedDelayMs?: number): void {
    if (this.manualDisconnect) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const delay =
      fixedDelayMs !== undefined
        ? fixedDelayMs
        : computeBackoffDelayMs(this.reconnectAttempts, this.baseReconnectDelayMs, this.random);

    if (fixedDelayMs === undefined) {
      this.reconnectAttempts += 1;
    }

    this.persistStatus("desconectado", null, {
      pairingCode: null,
      ultimoErro: reasonMessage,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect) return;
      void this.connect({
        mode: this.activeMode,
        phoneNumber: this.activePhoneNumber ?? undefined,
      }).catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async triggerPairingCodeRequest(socketRef: BaileysSocketLike): Promise<void> {
    if (
      this.pairingCodeRequested ||
      this.activeMode !== "pairing_code" ||
      !this.activePhoneNumber ||
      this.socket !== socketRef
    ) {
      return;
    }
    if (!socketRef.requestPairingCode) {
      this.persistStatus("desconectado", null, {
        pairingCode: null,
        ultimoErro: "Socket atual não suporta requestPairingCode.",
      });
      return;
    }

    this.pairingCodeRequested = true;
    try {
      const rawCode = await socketRef.requestPairingCode(this.activePhoneNumber);
      if (this.socket !== socketRef || this.manualDisconnect) return;
      const formatted = formatPairingCodeDisplay(rawCode);
      this.persistStatus("aguardando_qrcode", null, {
        pairingCode: formatted,
        ultimoErro: null,
      });
    } catch (error) {
      // Permite nova tentativa quando o QR evento chegar logo após `connecting`
      this.pairingCodeRequested = false;
      const msg = error instanceof Error ? error.message : String(error);
      this.persistStatus("aguardando_qrcode", null, {
        pairingCode: null,
        ultimoErro: `Falha ao solicitar código de pareamento: ${msg}`,
      });
    }
  }

  private handleAckNode(node: WhatsAppAckNode | undefined): void {
    const id = node?.attrs?.id;
    if (!id) return;
    const resolver = this.pendingAcks.get(id);
    if (!resolver) return;
    this.pendingAcks.delete(id);
    resolver(node?.attrs?.error);
  }

  public async connect(options: WhatsAppConnectOptions = {}): Promise<void> {
    this.manualDisconnect = false;
    this.clearTimers();

    const mode: WhatsAppMetodoPareamento = options.mode ?? "qr";
    let phoneDigits: string | null = null;
    if (mode === "pairing_code") {
      if (!options.phoneNumber) {
        throw new Error("Informe o número de telefone para pareamento por código numérico.");
      }
      phoneDigits = normalizeWhatsAppPairingPhone(options.phoneNumber);
    }

    this.activeMode = mode;
    this.activePhoneNumber = phoneDigits;
    this.pairingCodeRequested = false;

    this.dropCurrentSocket();

    const { state, saveCreds, clearState } = await useSqliteAuthState(this.db, this.contaId);

    if (this.manualDisconnect) {
      return;
    }

    if (!state.creds?.registered) {
      this.persistStatus("aguardando_qrcode", null, {
        pairingCode: null,
        ultimoErro: null,
      });
    }

    const version = await this.resolveWaWebVersion();

    if (this.manualDisconnect) {
      return;
    }

    const browser = mode === "pairing_code" ? WA_PAIRING_CODE_BROWSER : WA_QR_BROWSER;
    let socket: BaileysSocketLike;
    try {
      socket = await this.socketFactory(state, {
        contaId: this.contaId,
        version,
        browser,
        mode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.persistStatus("desconectado", null, {
        pairingCode: null,
        ultimoErro: msg,
      });
      throw err;
    }

    if (this.manualDisconnect) {
      try {
        socket.end?.();
      } catch {
        // Ignora
      }
      return;
    }

    this.socket = socket;
    this.lastActivityAt = this.now();

    socket.ev.on("creds.update", () => {
      if (this.socket !== socket) return;
      void saveCreds();
    });

    const recordFrameActivity = () => {
      if (this.socket === socket) {
        this.lastActivityAt = this.now();
      }
    };
    socket.ws?.on?.("frame", recordFrameActivity);
    socket.ws?.on?.(WA_MESSAGE_ACK_EVENT, (node: WhatsAppAckNode) => {
      if (this.socket === socket) {
        this.lastActivityAt = this.now();
        this.handleAckNode(node);
      }
    });
    socket.ev.on(WA_MESSAGE_ACK_EVENT, (node: WhatsAppAckNode) => {
      if (this.socket === socket) {
        this.lastActivityAt = this.now();
        this.handleAckNode(node);
      }
    });

    socket.ev.on("connection.update", async (update: BaileysConnectionUpdate) => {
      if (this.socket !== socket) return;
      this.lastActivityAt = this.now();

      if (this.activeMode === "pairing_code" && !this.pairingCodeRequested) {
        if (update.qr || update.connection === "connecting") {
          await this.triggerPairingCodeRequest(socket);
        }
      } else if (update.qr && this.activeMode === "qr") {
        const dataUrl = await QRCode.toDataURL(update.qr);
        this.persistStatus("aguardando_qrcode", dataUrl, {
          pairingCode: null,
          ultimoErro: null,
        });
      }

      if (update.connection === "open") {
        this.openedAt = this.now();
        this.lastActivityAt = this.openedAt;
        this.activeMode = "qr";
        this.activePhoneNumber = null;
        this.pairingCodeRequested = false;
        this.startWatchdog(socket);
        this.startStabilityResetTimer(socket);
        this.persistStatus("conectado", null, {
          pairingCode: null,
          ultimoErro: null,
          conectadoEm: new Date(this.openedAt).toISOString(),
        });
        return;
      }

      if (update.connection === "close") {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const decision = classifyCloseDecision(statusCode);
        if (this.openedAt > 0 && this.now() - this.openedAt >= WA_STABLE_MS) {
          this.reconnectAttempts = 0;
        }
        this.dropCurrentSocket();

        if (this.manualDisconnect) {
          this.persistStatus("desconectado", null, { pairingCode: null, ultimoErro: null });
          return;
        }

        if (decision === "fatal") {
          await clearState();
          this.reconnectAttempts = 0;
          this.persistStatus("desconectado", null, {
            pairingCode: null,
            ultimoErro: "Sessão encerrada ou desconectada pelo aparelho (401/403).",
            conectadoEm: null,
          });
          return;
        }

        if (decision === "replaced") {
          this.reconnectAttempts = 0;
          this.persistStatus("desconectado", null, {
            pairingCode: null,
            ultimoErro: "Sessão substituída por outra conexão WhatsApp (440).",
          });
          return;
        }

        if (decision === "restart") {
          this.scheduleReconnect("Reinicialização solicitada pelo servidor WhatsApp (515).", 500);
          return;
        }

        if (decision === "timeout") {
          this.scheduleReconnect("Tempo limite atingido na conexão WhatsApp (408).");
          return;
        }

        if (decision === "unreachable") {
          this.scheduleReconnect("Servidor WhatsApp temporariamente inacessível (428/503).");
          return;
        }

        this.scheduleReconnect(
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
        if (this.socket !== socket) return;
        this.lastActivityAt = this.now();

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

          const messageId = msg.key?.id ?? `${this.now()}-${randomUUID().slice(0, 6)}`;
          const fromMe = Boolean(msg.key?.fromMe);

          // Deduplicação de ecos das próprias mensagens enviadas pelo estúdio (TTL 20min)
          if (fromMe && this.isEchoMessageId(messageId)) {
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
            contaId: this.contaId,
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
            timestampMs: readMessageTimestampMs(msg.messageTimestamp, this.now()),
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

          for (const listener of this.messageListeners) {
            await listener(normalized);
          }
        }
      }
    );
  }

  public async disconnect(options: { limparSessao?: boolean } = {}): Promise<void> {
    this.manualDisconnect = true;
    this.clearTimers();

    const activeSocket = this.socket;
    this.dropCurrentSocket();

    if (options.limparSessao) {
      try {
        await activeSocket?.logout?.();
      } catch {
        // Ignora erro de logout remoto
      }
      const { clearState } = await useSqliteAuthState(this.db, this.contaId);
      await clearState();
    }

    this.persistStatus("desconectado", null, {
      pairingCode: null,
      ultimoErro: null,
      ...(options.limparSessao ? { conectadoEm: null } : {}),
    });
  }

  private enqueueChatSend<T>(chatJid: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chatQueues.get(chatJid) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.chatQueues.set(chatJid, next);
    const cleanup = () => {
      if (this.chatQueues.get(chatJid) === next) {
        this.chatQueues.delete(chatJid);
      }
    };
    next.then(cleanup, cleanup);
    return next;
  }

  public async sendMessage(
    jid: string,
    content: OutgoingWhatsAppPayload,
    options: WhatsAppSendOptions = {}
  ): Promise<WhatsAppSendResult> {
    if (!this.socket || this.currentStatus.status !== "conectado") {
      throw new Error("WhatsApp não está conectado para envio de mensagens.");
    }

    return this.enqueueChatSend(jid, async () => {
      const socketRef = this.socket;
      if (!socketRef || this.currentStatus.status !== "conectado") {
        throw new Error("WhatsApp não está conectado para envio de mensagens.");
      }

      const lastSentAt = this.lastSendByChat.get(jid) ?? 0;
      const elapsed = this.now() - lastSentAt;
      if (lastSentAt > 0 && elapsed < WA_CHAT_PACING_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, WA_CHAT_PACING_MS - elapsed));
      }

      const messageId =
        options.messageId ??
        (typeof generateMessageIDV2 === "function"
          ? generateMessageIDV2(socketRef.user?.id)
          : `msg-${randomUUID()}`);

      this.rememberSentMessageId(messageId);

      let ackPromise: Promise<{ status: "ack" | "timeout"; error?: string }> | null = null;
      let ackTimer: NodeJS.Timeout | null = null;

      if (options.waitAck) {
        ackPromise = new Promise<{ status: "ack" | "timeout"; error?: string }>((resolve) => {
          const finish = (ackError?: string) => {
            if (ackTimer) {
              clearTimeout(ackTimer);
              ackTimer = null;
            }
            this.pendingAcks.delete(messageId);
            resolve({ status: "ack", error: ackError });
          };
          this.pendingAcks.set(messageId, finish);
          ackTimer = setTimeout(() => {
            if (this.pendingAcks.get(messageId) === finish) {
              this.pendingAcks.delete(messageId);
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
        this.lastSendByChat.set(jid, this.now());
        this.lastActivityAt = this.now();

        const returnedId =
          (raw as { key?: { id?: string } } | undefined)?.key?.id ?? messageId;
        if (returnedId !== messageId) {
          this.rememberSentMessageId(returnedId);
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
        this.pendingAcks.delete(messageId);
        throw err;
      }
    });
  }

  public getStatus(): WhatsAppStatusSnapshot {
    const row = this.db
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
      .get(this.contaId) as
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
        numero: row.numero_telefone ?? this.currentStatus.numero ?? null,
        jid_proprio: row.jid_proprio ?? this.currentStatus.jid_proprio ?? null,
        modo_operacao: row.modo_operacao,
        ultimo_erro: row.ultimo_erro,
        conectado_em: row.conectado_em,
        atualizado_em: row.atualizado_em,
      };
    }

    if (this.contaId === DEFAULT_WHATSAPP_ACCOUNT_ID) {
      const legacy = this.db
        .prepare(
          `SELECT tipo_servico, status, qrcode_base64, atualizado_em FROM projecao_conexoes_mensageria WHERE tipo_servico = 'whatsapp';`
        )
        .get() as WhatsAppStatusSnapshot | undefined;
      if (legacy) {
        return {
          ...legacy,
          conta_id: this.contaId,
          numero: this.currentStatus.numero ?? null,
        };
      }
    }

    return this.currentStatus;
  }
}
