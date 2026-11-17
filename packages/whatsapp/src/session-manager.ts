import { randomUUID } from "node:crypto";
import type {
  StatusMensageria,
  WhatsAppConfigPayload,
  WhatsAppContaResumo,
  WhatsAppModoOperacao,
} from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  ensureWhatsAppAccountRow,
  listRegisteredWhatsAppAccounts,
} from "./auth-store.ts";
import {
  WhatsAppStudioClient,
  type SocketFactory,
  type WaVersionFetcher,
} from "./client.ts";
import type {
  IncomingWhatsAppMessage,
  SqliteConnectionLike,
  WhatsAppConnectOptions,
  WhatsAppStatusSnapshot,
} from "./types.ts";

export interface WhatsAppSessionManagerOptions {
  db: SqliteConnectionLike;
  socketFactory?: SocketFactory;
  versionFetcher?: WaVersionFetcher;
  onStatusChange?: (contaId: string, status: WhatsAppStatusSnapshot) => void;
  onMessage?: (
    contaId: string,
    msg: IncomingWhatsAppMessage,
    client: WhatsAppStudioClient
  ) => Promise<void> | void;
  reconnectDelayMs?: number;
  silenceTimeoutMs?: number;
  watchdogIntervalMs?: number;
}

export interface CreateWhatsAppAccountInput {
  contaId?: string;
  rotulo: string;
  modo_operacao?: WhatsAppModoOperacao;
  notificar_aprovacoes?: boolean;
  codigo_autorizacao_obrigatorio?: boolean;
  grupo_auto_responder?: boolean;
  agente_orquestrador_id?: string | null;
}

interface AccountDbRow {
  conta_id: string;
  rotulo: string;
  numero_telefone: string | null;
  jid_proprio: string | null;
  modo_operacao: string;
  status: StatusMensageria;
  qrcode_base64: string | null;
  pairing_code: string | null;
  notificar_aprovacoes: number;
  codigo_autorizacao_obrigatorio: number;
  grupo_auto_responder: number;
  agente_orquestrador_id: string | null;
  ultimo_erro: string | null;
  conectado_em: string | null;
  atualizado_em: string;
  total_contatos_autorizados: number;
  pareamentos_pendentes: number;
}

function mapAccountRow(row: AccountDbRow): WhatsAppContaResumo {
  return {
    conta_id: row.conta_id,
    rotulo: row.rotulo,
    numero_telefone: row.numero_telefone,
    jid_proprio: row.jid_proprio,
    modo_operacao: row.modo_operacao === "ownNumber" ? "ownNumber" : "dedicated",
    status: row.status,
    qrcode_base64: row.qrcode_base64,
    pairing_code: row.pairing_code,
    notificar_aprovacoes: row.notificar_aprovacoes === 1,
    codigo_autorizacao_obrigatorio: row.codigo_autorizacao_obrigatorio === 1,
    grupo_auto_responder: row.grupo_auto_responder === 1,
    agente_orquestrador_id: row.agente_orquestrador_id,
    total_contatos_autorizados: Number(row.total_contatos_autorizados ?? 0),
    pareamentos_pendentes: Number(row.pareamentos_pendentes ?? 0),
    ultimo_erro: row.ultimo_erro,
    conectado_em: row.conectado_em,
    atualizado_em: row.atualizado_em,
  };
}

/**
 * Gerenciador multi-número WhatsApp com auto-boot de sessões registradas (`creds.registered === true`),
 * ciclo de vida independente por `contaId` e compatibilidade direta com `getPrimaryClient()`.
 */
export class WhatsAppSessionManager {
  private readonly db: SqliteConnectionLike;
  private readonly socketFactory?: SocketFactory;
  private readonly versionFetcher?: WaVersionFetcher;
  private readonly reconnectDelayMs?: number;
  private readonly silenceTimeoutMs?: number;
  private readonly watchdogIntervalMs?: number;

  private readonly clients = new Map<string, WhatsAppStudioClient>();
  private readonly statusListeners = new Set<
    (contaId: string, status: WhatsAppStatusSnapshot) => void
  >();
  private readonly messageListeners = new Set<
    (
      contaId: string,
      msg: IncomingWhatsAppMessage,
      client: WhatsAppStudioClient
    ) => Promise<void> | void
  >();

  constructor(options: WhatsAppSessionManagerOptions) {
    this.db = options.db;
    this.socketFactory = options.socketFactory;
    this.versionFetcher = options.versionFetcher;
    this.reconnectDelayMs = options.reconnectDelayMs;
    this.silenceTimeoutMs = options.silenceTimeoutMs;
    this.watchdogIntervalMs = options.watchdogIntervalMs;

    if (options.onStatusChange) {
      this.statusListeners.add(options.onStatusChange);
    }
    if (options.onMessage) {
      this.messageListeners.add(options.onMessage);
    }
  }

  public onStatusChange(
    listener: (contaId: string, status: WhatsAppStatusSnapshot) => void
  ): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public onMessage(
    listener: (
      contaId: string,
      msg: IncomingWhatsAppMessage,
      client: WhatsAppStudioClient
    ) => Promise<void> | void
  ): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public listAccounts(): WhatsAppContaResumo[] {
    const nowIso = new Date().toISOString();
    const rows = this.db
      .prepare(
        `
        SELECT
          c.conta_id,
          c.rotulo,
          c.numero_telefone,
          c.jid_proprio,
          c.modo_operacao,
          c.status,
          c.qrcode_base64,
          c.pairing_code,
          c.notificar_aprovacoes,
          c.codigo_autorizacao_obrigatorio,
          c.grupo_auto_responder,
          c.agente_orquestrador_id,
          c.ultimo_erro,
          c.conectado_em,
          c.atualizado_em,
          (
            SELECT COUNT(*) FROM whatsapp_contatos_autorizados a
            WHERE a.conta_id = c.conta_id AND a.permitido = 1
          ) AS total_contatos_autorizados,
          (
            SELECT COUNT(*) FROM whatsapp_pairing_requests p
            WHERE p.conta_id = c.conta_id AND p.status = 'pendente' AND p.expira_em > ?
          ) AS pareamentos_pendentes
        FROM whatsapp_contas c
        ORDER BY CASE WHEN c.conta_id = 'whatsapp-principal' THEN 0 ELSE 1 END, c.atualizado_em DESC;
      `
      )
      .all(nowIso) as unknown as AccountDbRow[];

    return rows.map(mapAccountRow);
  }

  public getAccount(contaId: string): WhatsAppContaResumo | null {
    const nowIso = new Date().toISOString();
    const row = this.db
      .prepare(
        `
        SELECT
          c.conta_id,
          c.rotulo,
          c.numero_telefone,
          c.jid_proprio,
          c.modo_operacao,
          c.status,
          c.qrcode_base64,
          c.pairing_code,
          c.notificar_aprovacoes,
          c.codigo_autorizacao_obrigatorio,
          c.grupo_auto_responder,
          c.agente_orquestrador_id,
          c.ultimo_erro,
          c.conectado_em,
          c.atualizado_em,
          (
            SELECT COUNT(*) FROM whatsapp_contatos_autorizados a
            WHERE a.conta_id = c.conta_id AND a.permitido = 1
          ) AS total_contatos_autorizados,
          (
            SELECT COUNT(*) FROM whatsapp_pairing_requests p
            WHERE p.conta_id = c.conta_id AND p.status = 'pendente' AND p.expira_em > ?
          ) AS pareamentos_pendentes
        FROM whatsapp_contas c
        WHERE c.conta_id = ?
        LIMIT 1;
      `
      )
      .get(nowIso, contaId) as AccountDbRow | undefined;

    return row ? mapAccountRow(row) : null;
  }

  public createAccount(input: CreateWhatsAppAccountInput): WhatsAppContaResumo {
    const rotulo = input.rotulo.trim();
    if (!rotulo) {
      throw new Error("Informe um rótulo para a conta WhatsApp.");
    }

    const contaId = input.contaId?.trim() || `whatsapp-${randomUUID().slice(0, 8)}`;
    const existing = this.getAccount(contaId);
    if (existing) {
      throw new Error(`Já existe uma conta WhatsApp cadastrada com o identificador '${contaId}'.`);
    }

    ensureWhatsAppAccountRow(this.db, contaId, {
      rotulo,
      modo_operacao: input.modo_operacao ?? "dedicated",
      notificar_aprovacoes: input.notificar_aprovacoes ?? true,
      codigo_autorizacao_obrigatorio: input.codigo_autorizacao_obrigatorio ?? true,
      grupo_auto_responder: input.grupo_auto_responder ?? false,
      agente_orquestrador_id:
        input.agente_orquestrador_id === undefined ? "estrategista" : input.agente_orquestrador_id,
    });

    const created = this.getAccount(contaId);
    if (!created) {
      throw new Error(`Falha ao criar conta WhatsApp '${contaId}'.`);
    }
    return created;
  }

  public updateAccount(
    contaId: string,
    patch: WhatsAppConfigPayload
  ): WhatsAppContaResumo | null {
    const existing = this.getAccount(contaId);
    if (!existing) {
      return null;
    }

    const rotulo =
      typeof patch.rotulo === "string" && patch.rotulo.trim().length > 0
        ? patch.rotulo.trim()
        : existing.rotulo;
    const modoOperacao: WhatsAppModoOperacao =
      patch.modo_operacao === "ownNumber" || patch.modo_operacao === "dedicated"
        ? patch.modo_operacao
        : existing.modo_operacao;
    const notificarAprovacoes =
      typeof patch.notificar_aprovacoes === "boolean"
        ? patch.notificar_aprovacoes
        : existing.notificar_aprovacoes;
    const codigoObrigatorio =
      typeof patch.codigo_autorizacao_obrigatorio === "boolean"
        ? patch.codigo_autorizacao_obrigatorio
        : existing.codigo_autorizacao_obrigatorio;
    const grupoAutoResponder =
      typeof patch.grupo_auto_responder === "boolean"
        ? patch.grupo_auto_responder
        : existing.grupo_auto_responder;
    const agenteOrquestradorId =
      patch.agente_orquestrador_id !== undefined
        ? patch.agente_orquestrador_id
        : existing.agente_orquestrador_id;
    const agora = new Date().toISOString();

    this.db
      .prepare(
        `
        UPDATE whatsapp_contas
        SET rotulo = ?,
            modo_operacao = ?,
            notificar_aprovacoes = ?,
            codigo_autorizacao_obrigatorio = ?,
            grupo_auto_responder = ?,
            agente_orquestrador_id = ?,
            atualizado_em = ?
        WHERE conta_id = ?;
      `
      )
      .run(
        rotulo,
        modoOperacao,
        notificarAprovacoes ? 1 : 0,
        codigoObrigatorio ? 1 : 0,
        grupoAutoResponder ? 1 : 0,
        agenteOrquestradorId,
        agora,
        contaId
      );

    if (contaId === DEFAULT_WHATSAPP_ACCOUNT_ID) {
      this.db
        .prepare(
          `
          UPDATE projecao_conexoes_mensageria
          SET rotulo = ?,
              modo_operacao = ?,
              notificar_aprovacoes = ?,
              codigo_autorizacao_obrigatorio = ?,
              grupo_auto_responder = ?,
              atualizado_em = ?
          WHERE tipo_servico = 'whatsapp';
        `
        )
        .run(
          rotulo,
          modoOperacao,
          notificarAprovacoes ? 1 : 0,
          codigoObrigatorio ? 1 : 0,
          grupoAutoResponder ? 1 : 0,
          agora
        );
    }

    return this.getAccount(contaId);
  }

  public async deleteAccount(contaId: string): Promise<boolean> {
    const client = this.clients.get(contaId);
    if (client) {
      await client.disconnect({ limparSessao: true }).catch(() => undefined);
      this.clients.delete(contaId);
    }

    const res = this.db
      .prepare(`DELETE FROM whatsapp_contas WHERE conta_id = ?;`)
      .run(contaId);

    if (contaId === DEFAULT_WHATSAPP_ACCOUNT_ID) {
      this.db
        .prepare(
          `
          UPDATE projecao_conexoes_mensageria
          SET status = 'desconectado',
              qrcode_base64 = NULL,
              pairing_code = NULL,
              sessao_dados_json = NULL,
              numero_telefone = NULL,
              conectado_em = NULL,
              atualizado_em = ?
          WHERE tipo_servico = 'whatsapp';
        `
        )
        .run(new Date().toISOString());
    }

    return Number(res.changes) > 0;
  }

  public getClient(contaId: string): WhatsAppStudioClient | undefined {
    return this.clients.get(contaId);
  }

  public getOrCreateClient(contaId: string): WhatsAppStudioClient {
    const existing = this.clients.get(contaId);
    if (existing) {
      return existing;
    }

    ensureWhatsAppAccountRow(this.db, contaId);

    const client = new WhatsAppStudioClient({
      db: this.db,
      contaId,
      socketFactory: this.socketFactory,
      versionFetcher: this.versionFetcher,
      reconnectDelayMs: this.reconnectDelayMs,
      silenceTimeoutMs: this.silenceTimeoutMs,
      watchdogIntervalMs: this.watchdogIntervalMs,
      onStatusChange: (snapshot) => {
        for (const listener of this.statusListeners) {
          listener(contaId, snapshot);
        }
      },
      onMessage: async (msg) => {
        for (const listener of this.messageListeners) {
          await listener(contaId, msg, client);
        }
      },
    });

    this.clients.set(contaId, client);
    return client;
  }

  public getPrimaryClient(): WhatsAppStudioClient {
    if (this.clients.has(DEFAULT_WHATSAPP_ACCOUNT_ID)) {
      return this.clients.get(DEFAULT_WHATSAPP_ACCOUNT_ID)!;
    }
    const first = this.clients.values().next().value;
    if (first) {
      return first;
    }
    return this.getOrCreateClient(DEFAULT_WHATSAPP_ACCOUNT_ID);
  }

  public async connectAccount(
    contaId: string,
    options: WhatsAppConnectOptions = {}
  ): Promise<WhatsAppStatusSnapshot> {
    const client = this.getOrCreateClient(contaId);
    await client.connect(options);
    return client.getStatus();
  }

  public async disconnectAccount(
    contaId: string,
    options: { limparSessao?: boolean } = {}
  ): Promise<WhatsAppStatusSnapshot> {
    const client = this.getOrCreateClient(contaId);
    await client.disconnect(options);
    return client.getStatus();
  }

  /**
   * Auto-boot multi-número: inicia automaticamente todas as sessões cujo
   * `sessao_dados_json` possua `creds.registered === true`, sem bloquear o caller.
   */
  public async bootSavedAccounts(): Promise<string[]> {
    const registeredAccounts = listRegisteredWhatsAppAccounts(this.db);
    if (registeredAccounts.length === 0) {
      return [];
    }

    await Promise.allSettled(
      registeredAccounts.map(async (account) => {
        ensureWhatsAppAccountRow(this.db, account.conta_id, {
          rotulo: account.rotulo,
          modo_operacao: account.modo_operacao,
          agente_orquestrador_id: account.agente_orquestrador_id,
          notificar_aprovacoes: account.notificar_aprovacoes,
          codigo_autorizacao_obrigatorio: account.codigo_autorizacao_obrigatorio,
          grupo_auto_responder: account.grupo_auto_responder,
        });
        await this.connectAccount(account.conta_id);
      })
    );

    return registeredAccounts.map((acc) => acc.conta_id);
  }

  public async shutdownAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.clients.values()).map((client) => client.disconnect({ limparSessao: false }))
    );
  }
}
