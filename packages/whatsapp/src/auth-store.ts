import type { WhatsAppModoOperacao } from "@criativo/contracts";
import type { SqliteConnectionLike } from "./types.ts";

export const DEFAULT_WHATSAPP_ACCOUNT_ID = "whatsapp-principal";

export interface SerializedAuthState {
  creds: Record<string, unknown>;
  keys: Record<string, Record<string, unknown>>;
}

export interface RegisteredWhatsAppAccount {
  conta_id: string;
  rotulo: string;
  modo_operacao: WhatsAppModoOperacao;
  sessao_dados_json: string;
  agente_orquestrador_id?: string | null;
  notificar_aprovacoes?: boolean;
  codigo_autorizacao_obrigatorio?: boolean;
  grupo_auto_responder?: boolean;
}

export interface EnsureAccountDefaults {
  rotulo?: string;
  modo_operacao?: WhatsAppModoOperacao;
  agente_orquestrador_id?: string | null;
  notificar_aprovacoes?: boolean;
  codigo_autorizacao_obrigatorio?: boolean;
  grupo_auto_responder?: boolean;
}

export const BufferJSONReplacer = (_key: string, value: unknown): unknown => {
  if (value && typeof value === "object" && (value as { type?: string }).type === "Buffer") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", data: value.toString("base64") };
  }
  if (value instanceof Uint8Array) {
    return { type: "Buffer", data: Buffer.from(value).toString("base64") };
  }
  return value;
};

export const BufferJSONReviver = (_key: string, value: unknown): unknown => {
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: string; data?: unknown }).type === "Buffer"
  ) {
    const rawData = (value as { data?: unknown }).data;
    if (typeof rawData === "string") {
      return Buffer.from(rawData, "base64");
    }
    if (Array.isArray(rawData)) {
      return Buffer.from(rawData as number[]);
    }
  }
  return value;
};

function createDefaultCreds(): Record<string, unknown> {
  return {
    registered: false,
    accountSettings: { unarchiveChats: false },
  };
}

function normalizeModoOperacao(raw: unknown): WhatsAppModoOperacao {
  return raw === "ownNumber" ? "ownNumber" : "dedicated";
}

function isRegisteredSessionJson(rawJson: string | null | undefined): boolean {
  if (!rawJson || typeof rawJson !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(rawJson, BufferJSONReviver) as SerializedAuthState | null;
    const creds = parsed?.creds;
    return Boolean(creds && typeof creds === "object" && creds.registered === true);
  } catch {
    return false;
  }
}

/**
 * Garante de forma idempotente a existência da conta em `whatsapp_contas`
 * antes de gravar sessão, contatos, pareamentos ou histórico (Foreign Key).
 */
export function ensureWhatsAppAccountRow(
  dbConnection: SqliteConnectionLike,
  contaId: string,
  defaults: EnsureAccountDefaults = {}
): void {
  const agora = new Date().toISOString();
  const rotulo =
    defaults.rotulo?.trim() ||
    (contaId === DEFAULT_WHATSAPP_ACCOUNT_ID ? "Número Principal" : `Conta ${contaId}`);
  const modo = normalizeModoOperacao(defaults.modo_operacao);
  const notificar = defaults.notificar_aprovacoes === false ? 0 : 1;
  const exigirCodigo = defaults.codigo_autorizacao_obrigatorio === false ? 0 : 1;
  const grupoAuto = defaults.grupo_auto_responder === true ? 1 : 0;
  const orquestrador =
    defaults.agente_orquestrador_id === undefined ? "estrategista" : defaults.agente_orquestrador_id;

  dbConnection
    .prepare(
      `
      INSERT OR IGNORE INTO whatsapp_contas (
        conta_id,
        rotulo,
        numero_telefone,
        jid_proprio,
        modo_operacao,
        status,
        qrcode_base64,
        pairing_code,
        sessao_dados_json,
        notificar_aprovacoes,
        codigo_autorizacao_obrigatorio,
        grupo_auto_responder,
        agente_orquestrador_id,
        regras_json,
        ultimo_erro,
        conectado_em,
        atualizado_em
      ) VALUES (?, ?, NULL, NULL, ?, 'desconectado', NULL, NULL, NULL, ?, ?, ?, ?, '{}', NULL, NULL, ?);
    `
    )
    .run(contaId, rotulo, modo, notificar, exigirCodigo, grupoAuto, orquestrador, agora);
}

/**
 * Auth store persistente no SQLite (`whatsapp_contas.sessao_dados_json`)
 * com fallback e espelhamento automático para `projecao_conexoes_mensageria`
 * quando `contaId === "whatsapp-principal"`.
 */
export async function useSqliteAuthState(
  dbConnection: SqliteConnectionLike,
  contaId: string = DEFAULT_WHATSAPP_ACCOUNT_ID
): Promise<{
  state: {
    creds: Record<string, unknown>;
    keys: {
      get(type: string, ids: string[]): Promise<Record<string, unknown>>;
      set(data: Record<string, Record<string, unknown | null>>): Promise<void>;
    };
  };
  saveCreds: () => Promise<void>;
  clearState: () => Promise<void>;
}> {
  const isPrimaryAccount = contaId === DEFAULT_WHATSAPP_ACCOUNT_ID;

  const loadSnapshot = (): SerializedAuthState => {
    const accountRow = dbConnection
      .prepare(`SELECT sessao_dados_json FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
      .get(contaId) as { sessao_dados_json: string | null } | undefined;

    let rawJson = accountRow?.sessao_dados_json ?? null;

    if (!rawJson && isPrimaryAccount) {
      const legacyRow = dbConnection
        .prepare(
          `SELECT sessao_dados_json FROM projecao_conexoes_mensageria WHERE tipo_servico = 'whatsapp' LIMIT 1;`
        )
        .get() as { sessao_dados_json: string | null } | undefined;
      rawJson = legacyRow?.sessao_dados_json ?? null;
    }

    if (!rawJson) {
      return { creds: createDefaultCreds(), keys: {} };
    }

    try {
      const parsed = JSON.parse(rawJson, BufferJSONReviver) as SerializedAuthState;
      return {
        creds: parsed?.creds ?? createDefaultCreds(),
        keys: parsed?.keys ?? {},
      };
    } catch {
      return { creds: createDefaultCreds(), keys: {} };
    }
  };

  let memoryState = loadSnapshot();

  const persistSnapshot = (clearIdentity = false): void => {
    const serialized = JSON.stringify(memoryState, BufferJSONReplacer);
    const agora = new Date().toISOString();

    ensureWhatsAppAccountRow(dbConnection, contaId);

    if (clearIdentity) {
      dbConnection
        .prepare(
          `
          UPDATE whatsapp_contas
          SET sessao_dados_json = ?,
              qrcode_base64 = NULL,
              pairing_code = NULL,
              numero_telefone = NULL,
              jid_proprio = NULL,
              conectado_em = NULL,
              atualizado_em = ?
          WHERE conta_id = ?;
        `
        )
        .run(serialized, agora, contaId);
    } else {
      dbConnection
        .prepare(
          `
          UPDATE whatsapp_contas
          SET sessao_dados_json = ?,
              atualizado_em = ?
          WHERE conta_id = ?;
        `
        )
        .run(serialized, agora, contaId);
    }

    if (isPrimaryAccount) {
      dbConnection
        .prepare(
          `
          INSERT INTO projecao_conexoes_mensageria (
            tipo_servico, status, qrcode_base64, sessao_dados_json, notificar_aprovacoes, atualizado_em
          ) VALUES ('whatsapp', 'desconectado', NULL, ?, 1, ?)
          ON CONFLICT(tipo_servico) DO UPDATE SET
            sessao_dados_json = excluded.sessao_dados_json,
            ${clearIdentity ? "qrcode_base64 = NULL, pairing_code = NULL, numero_telefone = NULL, conectado_em = NULL," : ""}
            atualizado_em = excluded.atualizado_em;
        `
        )
        .run(serialized, agora);
    }
  };

  const state = {
    creds: memoryState.creds,
    keys: {
      async get(type: string, ids: string[]): Promise<Record<string, unknown>> {
        const bucket = memoryState.keys[type] ?? {};
        const result: Record<string, unknown> = {};
        for (const id of ids) {
          if (bucket[id] !== undefined && bucket[id] !== null) {
            result[id] = bucket[id];
          }
        }
        return result;
      },
      async set(data: Record<string, Record<string, unknown | null>>): Promise<void> {
        for (const [category, entries] of Object.entries(data)) {
          memoryState.keys[category] ??= {};
          for (const [id, value] of Object.entries(entries)) {
            if (value === null || value === undefined) {
              delete memoryState.keys[category][id];
            } else {
              memoryState.keys[category][id] = value;
            }
          }
        }
        persistSnapshot(false);
      },
    },
  };

  return {
    state,
    async saveCreds(): Promise<void> {
      memoryState.creds = state.creds;
      persistSnapshot(false);
    },
    async clearState(): Promise<void> {
      memoryState = { creds: createDefaultCreds(), keys: {} };
      state.creds = memoryState.creds;
      persistSnapshot(true);
    },
  };
}

/**
 * Lista todas as contas salvas em `whatsapp_contas` cuja sessão possua `creds.registered === true`,
 * habilitando auto-boot multi-número na inicialização do daemon.
 */
export function listRegisteredWhatsAppAccounts(
  dbConnection: SqliteConnectionLike
): RegisteredWhatsAppAccount[] {
  const rows = dbConnection
    .prepare(
      `
      SELECT
        conta_id,
        rotulo,
        modo_operacao,
        sessao_dados_json,
        agente_orquestrador_id,
        notificar_aprovacoes,
        codigo_autorizacao_obrigatorio,
        grupo_auto_responder
      FROM whatsapp_contas
      WHERE sessao_dados_json IS NOT NULL
      ORDER BY CASE WHEN conta_id = 'whatsapp-principal' THEN 0 ELSE 1 END, atualizado_em DESC;
    `
    )
    .all() as Array<{
    conta_id: string;
    rotulo: string;
    modo_operacao: string;
    sessao_dados_json: string | null;
    agente_orquestrador_id: string | null;
    notificar_aprovacoes: number | null;
    codigo_autorizacao_obrigatorio: number | null;
    grupo_auto_responder: number | null;
  }>;

  const registered: RegisteredWhatsAppAccount[] = [];
  const seenIds = new Set<string>();

  for (const row of rows) {
    if (!row.sessao_dados_json || !isRegisteredSessionJson(row.sessao_dados_json)) {
      continue;
    }
    seenIds.add(row.conta_id);
    registered.push({
      conta_id: row.conta_id,
      rotulo: row.rotulo || row.conta_id,
      modo_operacao: normalizeModoOperacao(row.modo_operacao),
      sessao_dados_json: row.sessao_dados_json,
      agente_orquestrador_id: row.agente_orquestrador_id ?? "estrategista",
      notificar_aprovacoes: row.notificar_aprovacoes !== 0,
      codigo_autorizacao_obrigatorio: row.codigo_autorizacao_obrigatorio !== 0,
      grupo_auto_responder: row.grupo_auto_responder === 1,
    });
  }

  // Fallback defensivo caso exista sessão legada registrada ainda não espelhada
  if (!seenIds.has(DEFAULT_WHATSAPP_ACCOUNT_ID)) {
    const legacy = dbConnection
      .prepare(
        `
        SELECT
          sessao_dados_json,
          rotulo,
          modo_operacao,
          notificar_aprovacoes,
          codigo_autorizacao_obrigatorio,
          grupo_auto_responder
        FROM projecao_conexoes_mensageria
        WHERE tipo_servico = 'whatsapp' AND sessao_dados_json IS NOT NULL
        LIMIT 1;
      `
      )
      .get() as
      | {
          sessao_dados_json: string | null;
          rotulo: string | null;
          modo_operacao: string | null;
          notificar_aprovacoes: number | null;
          codigo_autorizacao_obrigatorio: number | null;
          grupo_auto_responder: number | null;
        }
      | undefined;

    if (legacy?.sessao_dados_json && isRegisteredSessionJson(legacy.sessao_dados_json)) {
      registered.push({
        conta_id: DEFAULT_WHATSAPP_ACCOUNT_ID,
        rotulo: legacy.rotulo?.trim() || "Número Principal",
        modo_operacao: normalizeModoOperacao(legacy.modo_operacao),
        sessao_dados_json: legacy.sessao_dados_json,
        agente_orquestrador_id: "estrategista",
        notificar_aprovacoes: legacy.notificar_aprovacoes !== 0,
        codigo_autorizacao_obrigatorio: legacy.codigo_autorizacao_obrigatorio !== 0,
        grupo_auto_responder: legacy.grupo_auto_responder === 1,
      });
    }
  }

  return registered;
}
