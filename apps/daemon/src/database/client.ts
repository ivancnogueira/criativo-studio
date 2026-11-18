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
    });
  }

  private getTableColumns(tableName: string): Set<string> {
    const rows = this.connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return new Set(rows.map((col) => col.name));
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
