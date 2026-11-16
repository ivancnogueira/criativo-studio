import type { SqliteConnectionLike } from "./types.ts";

export interface SerializedAuthState {
  creds: Record<string, unknown>;
  keys: Record<string, Record<string, unknown>>;
}

const BufferJSONReplacer = (_key: string, value: unknown): unknown => {
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

const BufferJSONReviver = (_key: string, value: unknown): unknown => {
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

/**
 * Auth store persistente no SQLite (`projecao_conexoes_mensageria.sessao_dados_json`)
 * compatível com @whiskeysockets/baileys para evitar perda de sessão ao reiniciar o daemon.
 */
export async function useSqliteAuthState(dbConnection: SqliteConnectionLike): Promise<{
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
  const loadSnapshot = (): SerializedAuthState => {
    const row = dbConnection
      .prepare(
        `SELECT sessao_dados_json FROM projecao_conexoes_mensageria WHERE tipo_servico = 'whatsapp';`
      )
      .get() as { sessao_dados_json: string | null } | undefined;

    if (!row?.sessao_dados_json) {
      return { creds: createDefaultCreds(), keys: {} };
    }

    const parsed = JSON.parse(row.sessao_dados_json, BufferJSONReviver) as SerializedAuthState;
    return {
      creds: parsed.creds ?? createDefaultCreds(),
      keys: parsed.keys ?? {},
    };
  };

  let memoryState = loadSnapshot();

  const persistSnapshot = (): void => {
    const serialized = JSON.stringify(memoryState, BufferJSONReplacer);
    const agora = new Date().toISOString();

    dbConnection
      .prepare(
        `
        INSERT INTO projecao_conexoes_mensageria (
          tipo_servico, status, qrcode_base64, sessao_dados_json, notificar_aprovacoes, atualizado_em
        ) VALUES ('whatsapp', 'desconectado', NULL, ?, 1, ?)
        ON CONFLICT(tipo_servico) DO UPDATE SET
          sessao_dados_json = excluded.sessao_dados_json,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(serialized, agora);
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
        persistSnapshot();
      },
    },
  };

  return {
    state,
    async saveCreds(): Promise<void> {
      memoryState.creds = state.creds;
      persistSnapshot();
    },
    async clearState(): Promise<void> {
      memoryState = { creds: createDefaultCreds(), keys: {} };
      state.creds = memoryState.creds;
      persistSnapshot();
    },
  };
}
