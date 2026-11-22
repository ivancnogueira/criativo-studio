import { randomUUID } from "node:crypto";
import { DEFAULT_CONNECTION_CONFIG } from "@whiskeysockets/baileys";
import type {
  StatusMensageria,
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
} from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  ensureWhatsAppAccountRow,
} from "./auth-store.ts";
import type {
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  OutgoingWhatsAppPayload,
  SqliteConnectionLike,
  WhatsAppConnectOptions,
  WhatsAppSendOptions,
  WhatsAppSendResult,
  WhatsAppStatusSnapshot,
} from "./types.ts";
import {
  WA_ACK_WAIT_MS,
  WA_BACKOFF_FACTOR,
  WA_BACKOFF_JITTER,
  WA_BACKOFF_MAX_MS,
  WA_BACKOFF_START_MS,
  WA_CHAT_PACING_MS,
  WA_CONNECT_TIMEOUT_MS,
  WA_ECHO_MAX_ENTRIES,
  WA_ECHO_TTL_MS,
  WA_KEEP_ALIVE_MS,
  WA_MESSAGE_ACK_EVENT,
  WA_PAIRING_CODE_BROWSER,
  WA_QR_BROWSER,
  WA_QUERY_TIMEOUT_MS,
  WA_STABLE_MS,
  WA_VERSION_CACHE_TTL_MS,
  WA_VERSION_CONFIG_KEY,
  WA_VERSION_TIMEOUT_MS,
  WA_WATCHDOG_INTERVAL_MS,
  WA_WATCHDOG_SILENCE_MS,
  classifyCloseDecision,
  computeBackoffDelayMs,
  defaultBaileysFactory,
  defaultWaVersionFetcher,
  formatPairingCodeDisplay,
  isValidWaVersion,
  normalizePhoneFromJid,
  withTimeout,
  type CachedWaVersionPayload,
  type SocketFactory,
  type WaVersionFetcher,
  type WhatsAppAckNode,
  type WhatsAppClientConnectDeps,
  inMemoryWaVersionCache,
  setInMemoryWaVersionCache,
  type WhatsAppClientOptions,
} from "./whatsapp-client-helpers.ts";
import { waClientConnect } from "./whatsapp-client-connect.ts";
import {
  waClientDisconnect,
  waClientGetStatus,
  waClientSendMessage,
} from "./whatsapp-client-messaging.ts";

export {
  WA_ACK_WAIT_MS,
  WA_BACKOFF_FACTOR,
  WA_BACKOFF_JITTER,
  WA_BACKOFF_MAX_MS,
  WA_BACKOFF_START_MS,
  WA_CHAT_PACING_MS,
  WA_CONNECT_TIMEOUT_MS,
  WA_ECHO_MAX_ENTRIES,
  WA_ECHO_TTL_MS,
  WA_KEEP_ALIVE_MS,
  WA_MESSAGE_ACK_EVENT,
  WA_PAIRING_CODE_BROWSER,
  WA_QR_BROWSER,
  WA_QUERY_TIMEOUT_MS,
  WA_STABLE_MS,
  WA_VERSION_CACHE_TTL_MS,
  WA_VERSION_CONFIG_KEY,
  WA_VERSION_TIMEOUT_MS,
  WA_WATCHDOG_INTERVAL_MS,
  WA_WATCHDOG_SILENCE_MS,
  classifyCloseDecision,
  computeBackoffDelayMs,
  formatPairingCodeDisplay,
  type SocketFactory,
  type WaVersionFetcher,
  type WhatsAppClientOptions,
};

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
  private cachedOwnLid: string | null = null;

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

  public getOwnLid(): string | null {
    return this.socket?.user?.lid ?? this.cachedOwnLid ?? null;
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
            setInMemoryWaVersionCache({
              version: parsed.version,
              fetchedAt: parsed.fetchedAt,
            });
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
        setInMemoryWaVersionCache(cacheEntry);
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

  private getConnectDeps(): WhatsAppClientConnectDeps {
    return {
      contaId: this.contaId,
      db: this.db,
      socketFactory: this.socketFactory,
      now: this.now,
      getManualDisconnect: () => this.manualDisconnect,
      setManualDisconnect: (v) => { this.manualDisconnect = v; },
      getSocket: () => this.socket,
      setSocket: (s) => { this.socket = s; },
      getActiveMode: () => this.activeMode,
      setActiveMode: (m) => { this.activeMode = m; },
      setActivePhoneNumber: (p) => { this.activePhoneNumber = p; },
      getPairingCodeRequested: () => this.pairingCodeRequested,
      setPairingCodeRequested: (v) => { this.pairingCodeRequested = v; },
      getCachedOwnLid: () => this.cachedOwnLid,
      setCachedOwnLid: (l) => { this.cachedOwnLid = l; },
      getOpenedAt: () => this.openedAt,
      setOpenedAt: (ms) => { this.openedAt = ms; },
      setLastActivityAt: (ms) => { this.lastActivityAt = ms; },
      setReconnectAttempts: (n) => { this.reconnectAttempts = n; },
      getMessageListeners: () => this.messageListeners,
      getChatQueues: () => this.chatQueues,
      getLastSendByChat: () => this.lastSendByChat,
      getCurrentStatus: () => this.currentStatus,
      getPendingAcks: () => this.pendingAcks,
      clearTimers: () => this.clearTimers(),
      dropCurrentSocket: (err) => this.dropCurrentSocket(err),
      persistStatus: (st, qr, ex) => this.persistStatus(st, qr, ex),
      resolveWaWebVersion: () => this.resolveWaWebVersion(),
      startWatchdog: (s) => this.startWatchdog(s),
      startStabilityResetTimer: (s) => this.startStabilityResetTimer(s),
      scheduleReconnect: (r, f) => this.scheduleReconnect(r, f),
      triggerPairingCodeRequest: (s) => this.triggerPairingCodeRequest(s),
      handleAckNode: (n) => this.handleAckNode(n),
      isEchoMessageId: (id) => this.isEchoMessageId(id),
      rememberSentMessageId: (id) => this.rememberSentMessageId(id),
      resolveLidToPn: (lid) => this.resolveLidToPn(lid),
    };
  }

  public async connect(options: WhatsAppConnectOptions = {}): Promise<void> {
    return await waClientConnect(this.getConnectDeps(), options);
  }

  public async disconnect(options: { limparSessao?: boolean } = {}): Promise<void> {
    return await waClientDisconnect(this.getConnectDeps(), options);
  }

  public async sendMessage(
    jid: string,
    content: OutgoingWhatsAppPayload,
    options: WhatsAppSendOptions = {}
  ): Promise<WhatsAppSendResult> {
    return await waClientSendMessage(this.getConnectDeps(), jid, content, options);
  }

  public getStatus(): WhatsAppStatusSnapshot {
    return waClientGetStatus(this.getConnectDeps());
  }
}
