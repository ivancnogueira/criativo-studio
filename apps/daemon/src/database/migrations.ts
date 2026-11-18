import type { DatabaseSync } from "node:sqlite";

const SQL_IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/i;

interface PragmaTableInfoRow {
  name: string;
}

interface LegacyWhatsAppRow {
  status: string;
  qrcode_base64: string | null;
  sessao_dados_json: string | null;
  notificar_aprovacoes: number | null;
  numero_telefone: string | null;
  rotulo: string | null;
  modo_operacao: string | null;
  pairing_code: string | null;
  codigo_autorizacao_obrigatorio: number | null;
  grupo_auto_responder: number | null;
  ultimo_erro: string | null;
  conectado_em: string | null;
  atualizado_em: string;
}

function assertValidSqlIdentifier(identifier: string, kind: "tabela" | "coluna"): void {
  if (!SQL_IDENTIFIER_REGEX.test(identifier)) {
    throw new Error(`Identificador SQL inválido para ${kind}: ${identifier}`);
  }
}

/**
 * Adiciona uma coluna a uma tabela existente de forma idempotente,
 * inspecionando `PRAGMA table_info(...)` antes de aplicar `ALTER TABLE`.
 */
export function ensureColumn(
  connection: DatabaseSync,
  tableName: string,
  columnName: string,
  columnDdl: string
): boolean {
  assertValidSqlIdentifier(tableName, "tabela");
  assertValidSqlIdentifier(columnName, "coluna");

  const columns = connection
    .prepare(`PRAGMA table_info(${tableName});`)
    .all() as unknown as PragmaTableInfoRow[];

  if (columns.some((col) => col.name === columnName)) {
    return false;
  }

  connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDdl};`);
  return true;
}

function ensureLegacyMessagingColumns(connection: DatabaseSync): void {
  ensureColumn(connection, "projecao_conexoes_mensageria", "qrcode_base64", "TEXT");
  ensureColumn(connection, "projecao_conexoes_mensageria", "numero_telefone", "TEXT");
  ensureColumn(connection, "projecao_conexoes_mensageria", "rotulo", "TEXT");
  ensureColumn(
    connection,
    "projecao_conexoes_mensageria",
    "modo_operacao",
    "TEXT NOT NULL DEFAULT 'dedicated' CHECK(modo_operacao IN ('ownNumber', 'dedicated'))"
  );
  ensureColumn(connection, "projecao_conexoes_mensageria", "pairing_code", "TEXT");
  ensureColumn(
    connection,
    "projecao_conexoes_mensageria",
    "codigo_autorizacao_obrigatorio",
    "INTEGER NOT NULL DEFAULT 1 CHECK(codigo_autorizacao_obrigatorio IN (0, 1))"
  );
  ensureColumn(
    connection,
    "projecao_conexoes_mensageria",
    "grupo_auto_responder",
    "INTEGER NOT NULL DEFAULT 0 CHECK(grupo_auto_responder IN (0, 1))"
  );
  ensureColumn(connection, "projecao_conexoes_mensageria", "ultimo_erro", "TEXT");
  ensureColumn(connection, "projecao_conexoes_mensageria", "conectado_em", "TEXT");
}

function ensureLegacyMcpColumns(connection: DatabaseSync): void {
  ensureColumn(
    connection,
    "projecao_mcp_servidores",
    "transporte",
    "TEXT NOT NULL DEFAULT 'stdio' CHECK(transporte IN ('stdio', 'http'))"
  );
  ensureColumn(connection, "projecao_mcp_servidores", "url", "TEXT");
  ensureColumn(
    connection,
    "projecao_mcp_servidores",
    "headers_json",
    "TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(headers_json))"
  );
  ensureColumn(
    connection,
    "projecao_mcp_servidores",
    "env_passthrough_json",
    "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(env_passthrough_json))"
  );
  ensureColumn(connection, "projecao_mcp_servidores", "working_directory", "TEXT");
  ensureColumn(
    connection,
    "projecao_mcp_servidores",
    "acesso_json",
    `TEXT NOT NULL DEFAULT '{"mode":"everyone","agentIds":[]}' CHECK(json_valid(acesso_json))`
  );
  ensureColumn(connection, "projecao_mcp_servidores", "origem_app_slug", "TEXT");
  ensureColumn(connection, "projecao_mcp_servidores", "conta_rotulo", "TEXT");
  ensureColumn(connection, "projecao_mcp_servidores", "posicao", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(connection, "projecao_mcp_servidores", "ultimo_teste_em", "TEXT");
  ensureColumn(connection, "projecao_mcp_servidores", "ultimo_erro", "TEXT");
  ensureColumn(
    connection,
    "projecao_mcp_servidores",
    "qtd_ferramentas",
    "INTEGER NOT NULL DEFAULT 0"
  );
}

function ensureWhatsAppAccountsColumns(connection: DatabaseSync): void {
  ensureColumn(
    connection,
    "whatsapp_contas",
    "codigo_autorizacao_obrigatorio",
    "INTEGER NOT NULL DEFAULT 1 CHECK(codigo_autorizacao_obrigatorio IN (0, 1))"
  );
  ensureColumn(
    connection,
    "whatsapp_contas",
    "grupo_auto_responder",
    "INTEGER NOT NULL DEFAULT 0 CHECK(grupo_auto_responder IN (0, 1))"
  );
}

function mirrorLegacyWhatsAppAccount(connection: DatabaseSync): void {
  const existing = connection
    .prepare("SELECT 1 AS found FROM whatsapp_contas WHERE conta_id = 'whatsapp-principal' LIMIT 1;")
    .get() as { found?: number } | undefined;

  if (existing?.found === 1) {
    return;
  }

  const legacy = connection
    .prepare(
      `SELECT
         status,
         qrcode_base64,
         sessao_dados_json,
         notificar_aprovacoes,
         numero_telefone,
         rotulo,
         modo_operacao,
         pairing_code,
         codigo_autorizacao_obrigatorio,
         grupo_auto_responder,
         ultimo_erro,
         conectado_em,
         atualizado_em
       FROM projecao_conexoes_mensageria
       WHERE tipo_servico = 'whatsapp'
       LIMIT 1;`
    )
    .get() as unknown as LegacyWhatsAppRow | undefined;

  if (!legacy) {
    return;
  }

  const modoOperacao = legacy.modo_operacao === "ownNumber" ? "ownNumber" : "dedicated";
  const rotulo =
    typeof legacy.rotulo === "string" && legacy.rotulo.trim().length > 0
      ? legacy.rotulo.trim()
      : "Número Principal";

  connection
    .prepare(
      `INSERT OR IGNORE INTO whatsapp_contas (
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
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'estrategista', '{}', ?, ?, ?);`
    )
    .run(
      "whatsapp-principal",
      rotulo,
      legacy.numero_telefone ?? null,
      modoOperacao,
      legacy.status || "desconectado",
      legacy.qrcode_base64 ?? null,
      legacy.pairing_code ?? null,
      legacy.sessao_dados_json ?? null,
      legacy.notificar_aprovacoes === 0 ? 0 : 1,
      legacy.codigo_autorizacao_obrigatorio === 0 ? 0 : 1,
      legacy.grupo_auto_responder === 1 ? 1 : 0,
      legacy.ultimo_erro ?? null,
      legacy.conectado_em ?? null,
      legacy.atualizado_em || new Date().toISOString()
    );
}

function ensurePhase10Indexes(connection: DatabaseSync): void {
  connection.exec(`
    CREATE INDEX IF NOT EXISTS idx_conexoes_modo_operacao
      ON projecao_conexoes_mensageria(modo_operacao);
    CREATE INDEX IF NOT EXISTS idx_mcp_servidores_posicao
      ON projecao_mcp_servidores(posicao, nome);
    CREATE INDEX IF NOT EXISTS idx_wpp_contatos_conta_tel
      ON whatsapp_contatos_autorizados(conta_id, telefone_normalizado);
    CREATE INDEX IF NOT EXISTS idx_wpp_pairing_pendentes
      ON whatsapp_pairing_requests(conta_id, status, expira_em);
    CREATE INDEX IF NOT EXISTS idx_wpp_hist_chat_data
      ON whatsapp_historico_mensagens(conta_id, chat_jid, ocorrido_em DESC);
    CREATE INDEX IF NOT EXISTS idx_wpp_hist_expira
      ON whatsapp_historico_mensagens(expira_em);
    CREATE INDEX IF NOT EXISTS idx_mcp_oauth_mcp_id
      ON projecao_mcp_oauth_tokens(mcp_id);
  `);
}

/**
 * Executa todas as migrações idempotentes e não-destrutivas da Fase 10.
 * Deve ser invocada dentro de transação após a criação base de SCHEMA_TABLES.
 */
export function runPhase10Migrations(connection: DatabaseSync): void {
  ensureLegacyMessagingColumns(connection);
  ensureLegacyMcpColumns(connection);
  ensureWhatsAppAccountsColumns(connection);
  mirrorLegacyWhatsAppAccount(connection);
  ensurePhase10Indexes(connection);
}
