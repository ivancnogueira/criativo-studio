import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runPhase10Migrations } from "./migrations.ts";
import { SCHEMA_TABLES } from "./schema.ts";

export interface DatabaseClientOptions {
  dbPath?: string;
}

/**
 * Cliente SQLite transacional baseado em node:sqlite nativo do Node.js 22.
 * Garante modo WAL, chaves estrangeiras ativadas e migrações idempotentes.
 */
export class CriativoDatabase {
  public readonly dbPath: string;
  public readonly connection: DatabaseSync;

  constructor(options: DatabaseClientOptions = {}) {
    this.dbPath =
      options.dbPath ??
      process.env.CRIATIVO_DB_PATH ??
      resolve(process.cwd(), "dados", "criativo.db");
    if (this.dbPath !== ":memory:") {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }
    this.connection = new DatabaseSync(this.dbPath);
    this.configurePragmas();
  }

  private configurePragmas(): void {
    this.connection.exec("PRAGMA journal_mode = WAL;");
    this.connection.exec("PRAGMA synchronous = NORMAL;");
    this.connection.exec("PRAGMA foreign_keys = ON;");
    this.connection.exec("PRAGMA busy_timeout = 5000;");
  }

  /**
   * Aplica todas as tabelas e índices DDL do API-SPEC.md de forma idempotente e transacional.
   */
  public initializeDatabase(): void {
    this.runInTransaction(() => {
      for (const item of SCHEMA_TABLES) {
        this.connection.exec(item.sql);
      }
      runPhase10Migrations(this.connection);
      this.applyAdditiveMigrations();
      this.applyPhase14Migrations();
    });
  }

  private getTableColumns(tableName: string): Set<string> {
    const rows = this.connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return new Set(rows.map((col) => col.name));
  }

  private ensureColumn(tableName: string, columnName: string, columnDefSql: string): void {
    const cols = this.getTableColumns(tableName);
    if (!cols.has(columnName)) {
      this.connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefSql};`);
    }
  }

  private applyPhase14Migrations(): void {
    // 1. projecao_agente_memorias + FTS5 backfill
    this.ensureColumn(
      "projecao_agente_memorias",
      "categoria",
      "TEXT NOT NULL DEFAULT 'searchable' CHECK(categoria IN ('essential', 'searchable'))",
    );
    this.ensureColumn("projecao_agente_memorias", "escopo_site", "TEXT");
    this.ensureColumn("projecao_agente_memorias", "normalized_text", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("projecao_agente_memorias", "source_turn_id", "TEXT");
    this.ensureColumn(
      "projecao_agente_memorias",
      "controlado_usuario",
      "INTEGER NOT NULL DEFAULT 0 CHECK(controlado_usuario IN (0, 1))",
    );
    this.ensureColumn("projecao_agente_memorias", "revisao", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("projecao_agente_memorias", "atualizado_em", "TEXT NOT NULL DEFAULT ''");

    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS idx_memorias_agente_categoria ON projecao_agente_memorias(agente_id, categoria, atualizado_em DESC);",
    );
    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS idx_memorias_agente_site ON projecao_agente_memorias(agente_id, escopo_site) WHERE escopo_site IS NOT NULL;",
    );

    this.connection.exec(`
      UPDATE projecao_agente_memorias
      SET normalized_text = lower(trim(texto)),
          atualizado_em = COALESCE(NULLIF(atualizado_em, ''), criado_em),
          controlado_usuario = CASE WHEN origem = 'manual' THEN 1 ELSE controlado_usuario END
      WHERE normalized_text = '' OR atualizado_em = '';
    `);

    this.connection.exec(`
      INSERT INTO agente_memorias_fts (texto, memoria_id, agente_id)
      SELECT m.texto, m.memoria_id, m.agente_id
      FROM projecao_agente_memorias m
      WHERE NOT EXISTS (
        SELECT 1 FROM agente_memorias_fts f WHERE f.memoria_id = m.memoria_id
      );
    `);

    // 2. projecao_arquivos — pastas hierárquicas da Biblioteca e URL de páginas visuais
    this.ensureColumn("projecao_arquivos", "url", "TEXT");
    this.ensureColumn(
      "projecao_arquivos",
      "pasta_id",
      "TEXT REFERENCES projecao_biblioteca_pastas(pasta_id) ON DELETE SET NULL",
    );
    this.ensureColumn("projecao_arquivos", "folder_path", "TEXT");
    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS idx_arquivos_pasta ON projecao_arquivos(pasta_id, criado_em DESC);",
    );

    // 3. projecao_conversas_chat — blocos interativos UI e reação emoji
    this.ensureColumn("projecao_conversas_chat", "item_type", "TEXT NOT NULL DEFAULT 'mensagem'");
    this.ensureColumn(
      "projecao_conversas_chat",
      "ui_block_json",
      "TEXT CHECK(ui_block_json IS NULL OR json_valid(ui_block_json))",
    );
    this.ensureColumn("projecao_conversas_chat", "reacao_emoji", "TEXT");

    // 4. projecao_canal_mensagens — mensageria assíncrona inter-agentes avançada
    this.ensureColumn("projecao_canal_mensagens", "reply_to_message_id", "TEXT");
    this.ensureColumn(
      "projecao_canal_mensagens",
      "expects_reply",
      "INTEGER NOT NULL DEFAULT 1 CHECK(expects_reply IN (0, 1))",
    );
    this.ensureColumn("projecao_canal_mensagens", "thread_origem_id", "TEXT");
    this.ensureColumn(
      "projecao_canal_mensagens",
      "status_entrega",
      "TEXT NOT NULL DEFAULT 'enfileirada' CHECK(status_entrega IN ('enfileirada', 'entregue_steer', 'respondida', 'sem_resposta_necessaria'))",
    );
    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS idx_canal_mensagens_reply ON projecao_canal_mensagens(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;",
    );
  }

  private applyAdditiveMigrations(): void {
    const workflowCols = this.getTableColumns("projecao_workflows");
    if (!workflowCols.has("revisao_grafo")) {
      this.connection.exec("ALTER TABLE projecao_workflows ADD COLUMN revisao_grafo INTEGER NOT NULL DEFAULT 0;");
    }
    if (!workflowCols.has("proximo_numero_run")) {
      this.connection.exec("ALTER TABLE projecao_workflows ADD COLUMN proximo_numero_run INTEGER NOT NULL DEFAULT 1;");
    }
    if (!workflowCols.has("tracos_json")) {
      this.connection.exec("ALTER TABLE projecao_workflows ADD COLUMN tracos_json TEXT NOT NULL DEFAULT '[]';");
    }

    const chatCols = this.getTableColumns("projecao_conversas_chat");
    if (!chatCols.has("thread_id")) {
      this.connection.exec("ALTER TABLE projecao_conversas_chat ADD COLUMN thread_id TEXT;");
    }
    if (!chatCols.has("turno_id")) {
      this.connection.exec("ALTER TABLE projecao_conversas_chat ADD COLUMN turno_id TEXT;");
    }
    if (!chatCols.has("item_type")) {
      this.connection.exec(
        "ALTER TABLE projecao_conversas_chat ADD COLUMN item_type TEXT NOT NULL DEFAULT 'mensagem';",
      );
    }
    if (!chatCols.has("status")) {
      this.connection.exec(
        "ALTER TABLE projecao_conversas_chat ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';",
      );
    }
    if (!chatCols.has("resposta_para_mensagem_id")) {
      this.connection.exec("ALTER TABLE projecao_conversas_chat ADD COLUMN resposta_para_mensagem_id TEXT;");
    }
    if (!chatCols.has("ordinal")) {
      this.connection.exec("ALTER TABLE projecao_conversas_chat ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;");
    }
    if (!chatCols.has("branch_origem_mensagem_id")) {
      this.connection.exec("ALTER TABLE projecao_conversas_chat ADD COLUMN branch_origem_mensagem_id TEXT;");
    }
    if (!chatCols.has("metadados_json")) {
      this.connection.exec(
        "ALTER TABLE projecao_conversas_chat ADD COLUMN metadados_json TEXT NOT NULL DEFAULT '{}';",
      );
    }

    this.connection.exec(
      "UPDATE projecao_conversas_chat SET thread_id = 'main:' || agente_id WHERE thread_id IS NULL AND canal_id LIKE 'agente:%' AND agente_id IS NOT NULL;",
    );
    this.connection.exec(
      "UPDATE projecao_conversas_chat SET thread_id = canal_id WHERE thread_id IS NULL;",
    );
    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS idx_chat_thread_paginacao ON projecao_conversas_chat(thread_id, criado_em ASC, ordinal ASC, mensagem_id ASC);",
    );

    const taskCols = this.getTableColumns("projecao_tarefas");
    if (!taskCols.has("thread_id")) {
      this.connection.exec("ALTER TABLE projecao_tarefas ADD COLUMN thread_id TEXT;");
    }
    if (!taskCols.has("origem")) {
      this.connection.exec("ALTER TABLE projecao_tarefas ADD COLUMN origem TEXT NOT NULL DEFAULT 'usuario';");
    }
  }

  private transactionDepth = 0;

  /**
   * Executa um bloco de operações em transação atômica (suportando SAVEPOINT reentrante) com rollback em erro.
   */
  public runInTransaction<T>(fn: () => T): T {
    const isNested =
      this.transactionDepth > 0 ||
      Boolean((this.connection as unknown as { isTransaction?: boolean }).isTransaction);
    const spName = isNested ? `sp_${this.transactionDepth}_${Date.now()}` : null;
    if (isNested && spName) {
      this.connection.exec(`SAVEPOINT ${spName};`);
    } else {
      this.connection.exec("BEGIN IMMEDIATE;");
    }
    this.transactionDepth += 1;
    try {
      const result = fn();
      this.transactionDepth -= 1;
      if (isNested && spName) {
        this.connection.exec(`RELEASE SAVEPOINT ${spName};`);
      } else {
        this.connection.exec("COMMIT;");
      }
      return result;
    } catch (error) {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      try {
        if (isNested && spName) {
          this.connection.exec(`ROLLBACK TO SAVEPOINT ${spName};`);
          this.connection.exec(`RELEASE SAVEPOINT ${spName};`);
        } else {
          this.connection.exec("ROLLBACK;");
        }
      } catch {
        // Ignora erro secundário se a transação já estiver encerrada
      }
      throw error;
    }
  }

  /**
   * Retorna a lista de tabelas existentes no schema principal (para diagnóstico e testes).
   */
  public listTables(): string[] {
    const rows = this.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;"
      )
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /**
   * Verifica se determinada tabela já existe no schema SQLite.
   */
  public hasTable(tableName: string): boolean {
    const row = this.connection
      .prepare(
        "SELECT 1 AS existe FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;"
      )
      .get(tableName) as { existe?: number } | undefined;
    return row?.existe === 1;
  }

  /**
   * Fecha a conexão com o SQLite com segurança.
   */
  public close(): void {
    this.connection.close();
  }
}

export function initializeDatabase(options: DatabaseClientOptions = {}): CriativoDatabase {
  const client = new CriativoDatabase(options);
  client.initializeDatabase();
  return client;
}
