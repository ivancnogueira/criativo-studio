/**
 * Fachada de alto nível do Banco SQL Compartilhado (`SharedTablesService`),
 * atendendo tanto as 4 ferramentas de agentes (`list_tables`, `query_data`, `execute_data`, `delete_table`)
 * quanto os endpoints de inspeção, filtragem, exportação CSV/JSON e exclusão pelo usuário no Cockpit Web.
 */
import { dirname, join, resolve } from "node:path";
import type {
  SharedTableDetail,
  SharedTableQueryResult,
  SharedTableSummary,
} from "@criativo/contracts";
import {
  checkAgentParameters,
  checkAgentSql,
  escapeCsvCell,
} from "./shared-tables-rules.ts";
import {
  SharedTablesError,
  SharedTablesSupervisor,
} from "./shared-tables-supervisor.ts";

export interface SharedTablesServiceOptions {
  sharedDbPath?: string;
  operationalDbPath?: string;
  queryTimeoutMs?: number;
  onTableChanged?: (event: {
    acao: "created" | "updated" | "deleted";
    table_name: string;
    owner_agent_id: string | null;
  }) => void;
}

export interface SharedTableExecuteResult {
  changes: number;
  lastInsertRowid: number | null;
  targetTable: string | null;
  kind: "read" | "dml" | "create" | "alter" | "drop";
  returning?: SharedTableQueryResult;
}

export class SharedTablesService {
  public readonly sharedDbPath: string;
  private readonly supervisor: SharedTablesSupervisor;
  private onTableChanged?: SharedTablesServiceOptions["onTableChanged"];

  constructor(options: SharedTablesServiceOptions = {}) {
    const derivedPath = options.sharedDbPath
      ? resolve(options.sharedDbPath)
      : options.operationalDbPath && options.operationalDbPath !== ":memory:"
        ? join(dirname(resolve(options.operationalDbPath)), "shared-tables.db")
        : resolve(process.cwd(), "dados", "shared-tables.db");

    if (
      options.operationalDbPath &&
      options.operationalDbPath !== ":memory:" &&
      resolve(options.operationalDbPath) === derivedPath
    ) {
      throw new Error(
        "Violação de isolamento: shared-tables.db nunca pode apontar para o mesmo arquivo de criativo.db.",
      );
    }

    this.sharedDbPath = derivedPath;
    this.onTableChanged = options.onTableChanged;
    this.supervisor = new SharedTablesSupervisor({
      dbPath: this.sharedDbPath,
      queryTimeoutMs: options.queryTimeoutMs,
    });
  }

  public setOnTableChanged(cb: SharedTablesServiceOptions["onTableChanged"]): void {
    this.onTableChanged = cb;
  }

  /**
   * Lista todas as tabelas colaborativas registradas em `shared-tables.db`.
   */
  public async listTables(): Promise<SharedTableSummary[]> {
    const data = await this.supervisor.dispatch<{ tables: SharedTableSummary[] }>({
      op: "list",
    });
    return data.tables;
  }

  /**
   * Executa consulta somente-leitura (`SELECT`, `VALUES`, `EXPLAIN`) para ferramentas de agente.
   */
  public async queryData(
    sql: string,
    params?: unknown[],
    callerAgentId?: string | null,
  ): Promise<SharedTableQueryResult> {
    const check = checkAgentSql(sql, "read");
    if (!check.ok) {
      throw new SharedTablesError(check.codigo, check.mensagem);
    }
    const pCheck = checkAgentParameters(params);
    if (!pCheck.ok) {
      throw new SharedTablesError(pCheck.codigo, pCheck.mensagem);
    }

    return await this.supervisor.dispatch<SharedTableQueryResult>({
      op: "query",
      sql,
      params: pCheck.values,
      callerAgentId: callerAgentId ?? null,
    });
  }

  /**
   * Executa DDL/DML (`CREATE`, `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`) respeitando posse por `owner_agent_id`.
   */
  public async executeData(
    sql: string,
    params: unknown[] | undefined,
    callerAgentId: string,
  ): Promise<SharedTableExecuteResult> {
    const check = checkAgentSql(sql, "write");
    if (!check.ok) {
      throw new SharedTablesError(check.codigo, check.mensagem);
    }
    const pCheck = checkAgentParameters(params);
    if (!pCheck.ok) {
      throw new SharedTablesError(pCheck.codigo, pCheck.mensagem);
    }

    const cleanAgent = callerAgentId.trim() || "sistema";
    const res = await this.supervisor.dispatch<SharedTableExecuteResult>({
      op: "execute",
      sql,
      params: pCheck.values,
      callerAgentId: cleanAgent,
      asUser: false,
    });

    if (res.targetTable) {
      const acao: "created" | "updated" | "deleted" =
        res.kind === "create"
          ? "created"
          : res.kind === "drop"
            ? "deleted"
            : "updated";
      this.onTableChanged?.({
        acao,
        table_name: res.targetTable,
        owner_agent_id: cleanAgent,
      });
    }

    return res;
  }

  /**
   * Exclui uma tabela compartilhada validando que pertence ao `callerAgentId`.
   */
  public async deleteTable(
    name: string,
    callerAgentId: string,
  ): Promise<{ deleted: string; ownerAgentId: string | null }> {
    const cleanAgent = callerAgentId.trim();
    if (!cleanAgent) {
      throw new SharedTablesError("AGENTE_INVALIDO", "Informe o agente solicitante para excluir a tabela.");
    }
    const res = await this.supervisor.dispatch<{ deleted: string; ownerAgentId: string | null }>({
      op: "delete",
      tableName: name,
      callerAgentId: cleanAgent,
      asUser: false,
    });
    this.onTableChanged?.({
      acao: "deleted",
      table_name: res.deleted,
      owner_agent_id: res.ownerAgentId,
    });
    return res;
  }

  // ---------------------------------------------------------------------------
  // Operações do Cockpit Web (usuário humano)
  // ---------------------------------------------------------------------------

  public async listTablesForCockpit(): Promise<SharedTableSummary[]> {
    return await this.listTables();
  }

  public async inspectTableForCockpit(
    name: string,
    opts: { limit?: number; offset?: number; busca?: string } = {},
  ): Promise<SharedTableDetail> {
    return await this.supervisor.dispatch<SharedTableDetail>({
      op: "cockpit_inspect",
      tableName: name,
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      busca: opts.busca ?? "",
      asUser: true,
    });
  }

  public async runCockpitReadQuery(
    sql: string,
    params?: unknown[],
  ): Promise<SharedTableQueryResult> {
    const check = checkAgentSql(sql, "read");
    if (!check.ok) {
      throw new SharedTablesError(check.codigo, check.mensagem);
    }
    const pCheck = checkAgentParameters(params);
    if (!pCheck.ok) {
      throw new SharedTablesError(pCheck.codigo, pCheck.mensagem);
    }
    return await this.supervisor.dispatch<SharedTableQueryResult>({
      op: "query",
      sql,
      params: pCheck.values,
      asUser: true,
    });
  }

  public async exportTable(
    name: string,
    formato: "csv" | "json",
  ): Promise<{
    filename: string;
    mimeType: string;
    content: string;
    truncated: boolean;
  }> {
    const exported = await this.supervisor.dispatch<{
      name: string;
      ownerAgentId: string | null;
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
    }>({
      op: "cockpit_export",
      tableName: name,
      asUser: true,
    });

    const safeSlug = exported.name.replace(/[^A-Za-z0-9_-]+/g, "_");
    if (formato === "json") {
      const objects = exported.rows.map((tuple) => {
        const obj: Record<string, unknown> = {};
        exported.columns.forEach((col, idx) => {
          obj[col] = tuple[idx] ?? null;
        });
        return obj;
      });
      return {
        filename: `${safeSlug}.json`,
        mimeType: "application/json; charset=utf-8",
        content: JSON.stringify(
          {
            table: exported.name,
            ownerAgentId: exported.ownerAgentId,
            truncated: exported.truncated,
            rows: objects,
          },
          null,
          2,
        ),
        truncated: exported.truncated,
      };
    }

    const headerLine = exported.columns.map((c) => escapeCsvCell(c)).join(",");
    const bodyLines = exported.rows.map((tuple) => tuple.map((v) => escapeCsvCell(v)).join(","));
    const csvContent = [headerLine, ...bodyLines].join("\r\n");

    return {
      filename: `${safeSlug}.csv`,
      mimeType: "text/csv; charset=utf-8",
      content: csvContent,
      truncated: exported.truncated,
    };
  }

  public async removeTableAsUser(
    name: string,
  ): Promise<{ deleted: string; ownerAgentId: string | null }> {
    const res = await this.supervisor.dispatch<{ deleted: string; ownerAgentId: string | null }>({
      op: "cockpit_delete",
      tableName: name,
      asUser: true,
    });
    this.onTableChanged?.({
      acao: "deleted",
      table_name: res.deleted,
      owner_agent_id: res.ownerAgentId,
    });
    return res;
  }

  public async close(): Promise<void> {
    await this.supervisor.close();
  }
}

export { SharedTablesError };
