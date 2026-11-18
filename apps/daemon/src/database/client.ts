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
    });
  }

  /**
   * Executa um bloco de operações em transação atômica com rollback automático em caso de erro.
   */
  public runInTransaction<T>(fn: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.connection.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.connection.exec("ROLLBACK;");
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
