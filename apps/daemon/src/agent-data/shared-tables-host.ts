/**
 * Processo filho isolado Node 22 para operar exclusivamente sobre `dados/shared-tables.db`
 * via protocolo JSON line-delimited (stdin/stdout) com `readOnly`, `PRAGMA trusted_schema = OFF`,
 * `max_page_count = 65536`, `DatabaseSync.setAuthorizer` (quando exposto pelo runtime) e proteção
 * estrita de posse (`criativo_shared_metadata`).
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import * as nodeSqlite from "node:sqlite";
import {
  AGENT_DATABASE_LIMITS,
  checkAgentParameters,
  checkAgentSql,
  quoteSqliteIdentifier,
} from "./shared-tables-rules.ts";

const { DatabaseSync } = nodeSqlite;
const sqliteConstants = (nodeSqlite.constants ?? {}) as Record<string, number>;

const SQLITE_OK = sqliteConstants.SQLITE_OK ?? 0;
const SQLITE_DENY = sqliteConstants.SQLITE_DENY ?? 1;

const ACTION_CREATE_TEMP_TRIGGER = sqliteConstants.SQLITE_CREATE_TEMP_TRIGGER ?? 5;
const ACTION_CREATE_TRIGGER = sqliteConstants.SQLITE_CREATE_TRIGGER ?? 7;
const ACTION_DELETE = sqliteConstants.SQLITE_DELETE ?? 9;
const ACTION_DROP_TABLE = sqliteConstants.SQLITE_DROP_TABLE ?? 11;
const ACTION_DROP_TRIGGER = sqliteConstants.SQLITE_DROP_TRIGGER ?? 16;
const ACTION_INSERT = sqliteConstants.SQLITE_INSERT ?? 18;
const ACTION_PRAGMA = sqliteConstants.SQLITE_PRAGMA ?? 19;
const ACTION_UPDATE = sqliteConstants.SQLITE_UPDATE ?? 23;
const ACTION_ATTACH = sqliteConstants.SQLITE_ATTACH ?? 24;
const ACTION_DETACH = sqliteConstants.SQLITE_DETACH ?? 25;
const ACTION_ALTER_TABLE = sqliteConstants.SQLITE_ALTER_TABLE ?? 26;
const ACTION_REINDEX = sqliteConstants.SQLITE_REINDEX ?? 27;
const ACTION_ANALYZE = sqliteConstants.SQLITE_ANALYZE ?? 28;
const ACTION_CREATE_VTABLE = sqliteConstants.SQLITE_CREATE_VTABLE ?? 29;
const ACTION_DROP_VTABLE = sqliteConstants.SQLITE_DROP_VTABLE ?? 30;
const ACTION_FUNCTION = sqliteConstants.SQLITE_FUNCTION ?? 31;

const ALLOWED_VTABLE_MODULES = new Set(["fts5", "fts5vocab", "rtree", "rtreecheck"]);
const BLOCKED_FUNCTIONS = new Set([
  "load_extension",
  "readfile",
  "writefile",
  "edit",
  "fts3_tokenizer",
]);
const SAFE_INTERNAL_PRAGMAS = new Set(["data_version", "page_size"]);

export interface HostRequestMessage {
  id: string;
  op:
    | "list"
    | "query"
    | "execute"
    | "delete"
    | "cockpit_inspect"
    | "cockpit_export"
    | "cockpit_delete";
  sql?: string;
  params?: unknown[];
  tableName?: string;
  callerAgentId?: string | null;
  asUser?: boolean;
  limit?: number;
  offset?: number;
  busca?: string;
}

export interface HostResponseMessage {
  id: string;
  ok: boolean;
  result?: unknown;
  codigo?: string;
  mensagem?: string;
}

type AuthorizableDatabase = InstanceType<typeof DatabaseSync> & {
  setAuthorizer?: (
    cb: (
      actionCode: number,
      arg1: string | null,
      arg2: string | null,
      dbName: string | null,
      triggerOrView: string | null,
    ) => number,
  ) => void;
};

function isFtsOrRtreeShadowTable(name: string, baseTables: Set<string>): boolean {
  const lower = name.toLowerCase();
  const suffixes = [
    "_data",
    "_idx",
    "_content",
    "_docsize",
    "_config",
    "_node",
    "_rowid",
    "_parent",
  ];
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      const candidate = name.slice(0, name.length - suffix.length);
      for (const base of baseTables) {
        if (base.toLowerCase() === candidate.toLowerCase()) {
          return true;
        }
      }
    }
  }
  return false;
}

function ensureDatabaseProvisioned(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, {
    readOnly: false,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 2000,
  });
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA trusted_schema = OFF;");
    db.exec(`PRAGMA max_page_count = ${AGENT_DATABASE_LIMITS.maxPageCount};`);
    db.exec("PRAGMA busy_timeout = 2000;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS criativo_shared_metadata (
        table_name TEXT PRIMARY KEY,
        owner_agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

function readMetadataMap(db: InstanceType<typeof DatabaseSync>): Map<string, { owner: string; createdAt: string }> {
  const rows = db
    .prepare("SELECT table_name, owner_agent_id, created_at FROM criativo_shared_metadata;")
    .all() as Array<{ table_name: string; owner_agent_id: string; created_at: string }>;
  const map = new Map<string, { owner: string; createdAt: string }>();
  for (const row of rows) {
    map.set(row.table_name.toLowerCase(), {
      owner: row.owner_agent_id,
      createdAt: row.created_at,
    });
  }
  return map;
}

function listUserMasterTables(db: InstanceType<typeof DatabaseSync>): Array<{ name: string; sql: string }> {
  const raw = db
    .prepare(
      `SELECT name, COALESCE(sql, '') AS sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND lower(name) != 'criativo_shared_metadata'
       ORDER BY name ASC;`,
    )
    .all() as Array<{ name: string; sql: string }>;

  const allNames = new Set(raw.map((r) => r.name));
  return raw.filter((r) => !isFtsOrRtreeShadowTable(r.name, allNames));
}

function installAuthorizer(
  db: AuthorizableDatabase,
  protectedTablesLower: Set<string>,
  asUser: boolean,
): void {
  if (typeof db.setAuthorizer !== "function") {
    return;
  }
  db.setAuthorizer((actionCode, arg1, arg2) => {
    const a1 = (arg1 ?? "").toLowerCase();
    const a2 = (arg2 ?? "").toLowerCase();

    if (
      actionCode === ACTION_ATTACH ||
      actionCode === ACTION_DETACH ||
      actionCode === ACTION_CREATE_TEMP_TRIGGER ||
      actionCode === ACTION_ANALYZE ||
      actionCode === ACTION_REINDEX
    ) {
      return SQLITE_DENY;
    }

    if (actionCode === ACTION_PRAGMA) {
      if (SAFE_INTERNAL_PRAGMAS.has(a1) && !arg2) {
        return SQLITE_OK;
      }
      return SQLITE_DENY;
    }

    if (actionCode === ACTION_CREATE_VTABLE) {
      return ALLOWED_VTABLE_MODULES.has(a2) ? SQLITE_OK : SQLITE_DENY;
    }

    if (actionCode === ACTION_FUNCTION) {
      return BLOCKED_FUNCTIONS.has(a2 || a1) ? SQLITE_DENY : SQLITE_OK;
    }

    if (
      (actionCode === ACTION_INSERT ||
        actionCode === ACTION_UPDATE ||
        actionCode === ACTION_DELETE ||
        actionCode === ACTION_DROP_TABLE ||
        actionCode === ACTION_ALTER_TABLE) &&
      a1 === "criativo_shared_metadata"
    ) {
      return SQLITE_DENY;
    }

    if (!asUser) {
      if (
        (actionCode === ACTION_DROP_TABLE ||
          actionCode === ACTION_DROP_VTABLE ||
          actionCode === ACTION_ALTER_TABLE) &&
        protectedTablesLower.has(a1)
      ) {
        return SQLITE_DENY;
      }
      if (actionCode === ACTION_CREATE_TRIGGER && protectedTablesLower.has(a2)) {
        return SQLITE_DENY;
      }
      if (actionCode === ACTION_DROP_TRIGGER && protectedTablesLower.has(a2)) {
        return SQLITE_DENY;
      }
    }

    return SQLITE_OK;
  });
}

function truncateCell(val: unknown, maxCellChars: number): { value: unknown; truncated: boolean } {
  if (val === null || val === undefined) return { value: null, truncated: false };
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    const hex = Buffer.from(val).toString("hex");
    if (hex.length > maxCellChars) {
      return { value: `<blob:${val.byteLength}B ${hex.slice(0, maxCellChars)}...>`, truncated: true };
    }
    return { value: `<blob:${val.byteLength}B ${hex}>`, truncated: false };
  }
  if (typeof val === "bigint") {
    const num = Number(val);
    return { value: Number.isSafeInteger(num) ? num : val.toString(), truncated: false };
  }
  if (typeof val === "string" && val.length > maxCellChars) {
    return { value: `${val.slice(0, maxCellChars)}…`, truncated: true };
  }
  return { value: val, truncated: false };
}

function formatStatementRows(
  rawRows: Array<Record<string, unknown>>,
  explicitCols: string[],
  opts: { maxRows: number; maxBytes: number; maxCellChars: number },
): { columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean; note?: string } {
  const columns =
    explicitCols.length > 0
      ? explicitCols
      : rawRows.length > 0
        ? Object.keys(rawRows[0]!)
        : [];

  const rows: unknown[][] = [];
  let truncated = false;
  let usedBytes = 0;

  for (let i = 0; i < rawRows.length; i += 1) {
    if (rows.length >= opts.maxRows) {
      truncated = true;
      break;
    }
    const rec = rawRows[i]!;
    const tuple: unknown[] = [];
    for (const col of columns) {
      const cell = truncateCell(rec[col], opts.maxCellChars);
      if (cell.truncated) truncated = true;
      tuple.push(cell.value);
    }
    const serializedLen = Buffer.byteLength(JSON.stringify(tuple), "utf8");
    if (rows.length > 0 && usedBytes + serializedLen > opts.maxBytes) {
      truncated = true;
      break;
    }
    usedBytes += serializedLen;
    rows.push(tuple);
  }

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated,
    ...(truncated
      ? {
          note: "Resultado truncado pelos limites de segurança (500 linhas / 256 KB). Refine com WHERE, LIMIT/OFFSET ou SELECT COUNT(*).",
        }
      : {}),
  };
}

function syncCreatedAndDroppedTables(
  dbPath: string,
  callerAgentId: string,
): void {
  const db = new DatabaseSync(dbPath, {
    readOnly: false,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 2000,
  });
  try {
    db.exec("PRAGMA trusted_schema = OFF;");
    const masterTables = listUserMasterTables(db);
    const meta = readMetadataMap(db);
    const now = new Date().toISOString();

    const masterSetLower = new Set(masterTables.map((t) => t.name.toLowerCase()));
    const insertStmt = db.prepare(
      "INSERT OR IGNORE INTO criativo_shared_metadata (table_name, owner_agent_id, created_at) VALUES (?, ?, ?);",
    );
    for (const tbl of masterTables) {
      if (!meta.has(tbl.name.toLowerCase())) {
        insertStmt.run(tbl.name, callerAgentId, now);
      }
    }

    const existingRows = db
      .prepare("SELECT table_name FROM criativo_shared_metadata;")
      .all() as Array<{ table_name: string }>;
    const deleteStmt = db.prepare("DELETE FROM criativo_shared_metadata WHERE table_name = ?;");
    for (const row of existingRows) {
      if (!masterSetLower.has(row.table_name.toLowerCase())) {
        deleteStmt.run(row.table_name);
      }
    }
  } finally {
    db.close();
  }
}

function handleCommand(dbPath: string, req: HostRequestMessage): HostResponseMessage {
  ensureDatabaseProvisioned(dbPath);

  if (req.op === "list") {
    const db = new DatabaseSync(dbPath, {
      readOnly: true,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 2000,
    });
    try {
      db.exec("PRAGMA trusted_schema = OFF;");
      const meta = readMetadataMap(db);
      const tables = listUserMasterTables(db).map((t) => {
        const m = meta.get(t.name.toLowerCase());
        let rowCount: number | null = null;
        try {
          const r = db
            .prepare(`SELECT COUNT(*) AS total FROM ${quoteSqliteIdentifier(t.name)};`)
            .get() as { total?: number | bigint } | undefined;
          rowCount = r?.total !== undefined ? Number(r.total) : 0;
        } catch {
          rowCount = null;
        }
        return {
          name: t.name,
          ownerAgentId: m?.owner ?? null,
          rowCount,
          sql: t.sql,
          createdAt: m?.createdAt ?? null,
        };
      });
      return { id: req.id, ok: true, result: { tables } };
    } finally {
      db.close();
    }
  }

  if (req.op === "query") {
    const sqlCheck = checkAgentSql(req.sql ?? "", "read");
    if (!sqlCheck.ok) {
      return { id: req.id, ok: false, codigo: sqlCheck.codigo, mensagem: sqlCheck.mensagem };
    }
    const paramCheck = checkAgentParameters(req.params);
    if (!paramCheck.ok) {
      return { id: req.id, ok: false, codigo: paramCheck.codigo, mensagem: paramCheck.mensagem };
    }

    const db = new DatabaseSync(dbPath, {
      readOnly: true,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 2000,
    }) as AuthorizableDatabase;
    try {
      db.exec("PRAGMA trusted_schema = OFF;");
      installAuthorizer(db, new Set(), Boolean(req.asUser));
      const stmt = db.prepare(req.sql!);
      const cols = typeof (stmt as { columns?: () => Array<{ name: string }> }).columns === "function"
        ? (stmt as unknown as { columns: () => Array<{ name: string }> }).columns().map((c) => c.name)
        : [];
      const rawRows = stmt.all(...paramCheck.values) as Array<Record<string, unknown>>;
      const formatted = formatStatementRows(rawRows, cols, {
        maxRows: AGENT_DATABASE_LIMITS.maxRows,
        maxBytes: AGENT_DATABASE_LIMITS.maxResultBytes,
        maxCellChars: AGENT_DATABASE_LIMITS.maxCellChars,
      });
      return { id: req.id, ok: true, result: formatted };
    } finally {
      db.close();
    }
  }

  if (req.op === "execute") {
    const sqlCheck = checkAgentSql(req.sql ?? "", "write");
    if (!sqlCheck.ok) {
      return { id: req.id, ok: false, codigo: sqlCheck.codigo, mensagem: sqlCheck.mensagem };
    }
    const paramCheck = checkAgentParameters(req.params);
    if (!paramCheck.ok) {
      return { id: req.id, ok: false, codigo: paramCheck.codigo, mensagem: paramCheck.mensagem };
    }

    const caller = (req.callerAgentId ?? "sistema").trim() || "sistema";
    const asUser = Boolean(req.asUser);

    const db = new DatabaseSync(dbPath, {
      readOnly: false,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 2000,
    }) as AuthorizableDatabase;

    let createdOrDropped = false;
    try {
      db.exec("PRAGMA trusted_schema = OFF;");
      db.exec(`PRAGMA max_page_count = ${AGENT_DATABASE_LIMITS.maxPageCount};`);

      const meta = readMetadataMap(db);
      const currentTables = listUserMasterTables(db);
      const protectedLower = new Set<string>();
      for (const [tblLower, info] of meta.entries()) {
        if (info.owner !== caller) {
          protectedLower.add(tblLower);
        }
      }

      if (sqlCheck.kind === "create") {
        const targetLower = (sqlCheck.targetTable ?? "").toLowerCase();
        const alreadyExists = currentTables.some((t) => t.name.toLowerCase() === targetLower);
        if (!alreadyExists && currentTables.length >= AGENT_DATABASE_LIMITS.maxTables) {
          return {
            id: req.id,
            ok: false,
            codigo: "LIMITE_TABELAS",
            mensagem: `Limite máximo de ${AGENT_DATABASE_LIMITS.maxTables} tabelas compartilhadas atingido.`,
          };
        }
        createdOrDropped = true;
      }

      if ((sqlCheck.kind === "drop" || sqlCheck.kind === "alter") && !asUser) {
        let checkTableLower = (sqlCheck.targetTable ?? "").toLowerCase();
        // Caso DROP TRIGGER sem nome da tabela explícito na sintaxe SQLite, consulta sqlite_master
        if (sqlCheck.effectiveKeyword === "DROP" && checkTableLower && !meta.has(checkTableLower)) {
          const trigOwnerRow = db
            .prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND lower(name) = ? LIMIT 1;")
            .get(checkTableLower) as { tbl_name?: string } | undefined;
          if (trigOwnerRow?.tbl_name) {
            checkTableLower = trigOwnerRow.tbl_name.toLowerCase();
          }
        }
        if (checkTableLower && protectedLower.has(checkTableLower)) {
          const ownerInfo = meta.get(checkTableLower);
          return {
            id: req.id,
            ok: false,
            codigo: "POSSE_NEGADA",
            mensagem: `Operação '${sqlCheck.effectiveKeyword}' negada: a tabela pertence ao agente '${ownerInfo?.owner ?? "outro"}' (apenas o criador ou o usuário humano podem alterar/excluir a estrutura).`,
          };
        }
        if (sqlCheck.kind === "drop") {
          createdOrDropped = true;
        }
      }

      installAuthorizer(db, protectedLower, asUser);

      const stmt = db.prepare(req.sql!);
      const hasReturning = /\bRETURNING\b/i.test(req.sql!);
      if (hasReturning) {
        const rawRows = stmt.all(...paramCheck.values) as Array<Record<string, unknown>>;
        const formatted = formatStatementRows(rawRows, [], {
          maxRows: AGENT_DATABASE_LIMITS.maxRows,
          maxBytes: AGENT_DATABASE_LIMITS.maxResultBytes,
          maxCellChars: AGENT_DATABASE_LIMITS.maxCellChars,
        });
        db.close();
        if (createdOrDropped) {
          syncCreatedAndDroppedTables(dbPath, caller);
        }
        return {
          id: req.id,
          ok: true,
          result: {
            changes: formatted.rowCount,
            lastInsertRowid: null,
            returning: formatted,
            targetTable: sqlCheck.targetTable ?? null,
            kind: sqlCheck.kind,
          },
        };
      }

      const runRes = stmt.run(...paramCheck.values);
      const lastId =
        typeof runRes.lastInsertRowid === "bigint"
          ? Number(runRes.lastInsertRowid)
          : runRes.lastInsertRowid;
      const changes = typeof runRes.changes === "bigint" ? Number(runRes.changes) : runRes.changes;
      db.close();

      if (createdOrDropped) {
        syncCreatedAndDroppedTables(dbPath, caller);
      }

      return {
        id: req.id,
        ok: true,
        result: {
          changes,
          lastInsertRowid: lastId ?? null,
          targetTable: sqlCheck.targetTable ?? null,
          kind: sqlCheck.kind,
        },
      };
    } catch (err) {
      try {
        db.close();
      } catch {
        // já fechado
      }
      throw err;
    }
  }

  if (req.op === "delete" || req.op === "cockpit_delete") {
    const rawName = (req.tableName ?? "").trim();
    if (!rawName || rawName.toLowerCase() === "criativo_shared_metadata" || rawName.toLowerCase().startsWith("sqlite_")) {
      return {
        id: req.id,
        ok: false,
        codigo: "TABELA_INVALIDA",
        mensagem: "Nome de tabela inválido ou reservado.",
      };
    }
    const asUser = req.op === "cockpit_delete" || Boolean(req.asUser);
    const caller = (req.callerAgentId ?? "").trim();

    const db = new DatabaseSync(dbPath, {
      readOnly: false,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 2000,
    });
    try {
      db.exec("PRAGMA trusted_schema = OFF;");
      const tables = listUserMasterTables(db);
      const found = tables.find((t) => t.name.toLowerCase() === rawName.toLowerCase());
      if (!found) {
        return {
          id: req.id,
          ok: false,
          codigo: "NAO_ENCONTRADA",
          mensagem: `Tabela '${rawName}' não encontrada no banco compartilhado.`,
        };
      }
      const meta = readMetadataMap(db);
      const ownerInfo = meta.get(found.name.toLowerCase());
      if (!asUser && ownerInfo && ownerInfo.owner !== caller) {
        return {
          id: req.id,
          ok: false,
          codigo: "POSSE_NEGADA",
          mensagem: `A tabela '${found.name}' pertence ao agente '${ownerInfo.owner}' e não pode ser removida por '${caller || "outro agente"}'.`,
        };
      }

      db.exec(`DROP TABLE ${quoteSqliteIdentifier(found.name)};`);
      db.prepare("DELETE FROM criativo_shared_metadata WHERE lower(table_name) = ?;").run(
        found.name.toLowerCase(),
      );
      return {
        id: req.id,
        ok: true,
        result: {
          deleted: found.name,
          ownerAgentId: ownerInfo?.owner ?? null,
        },
      };
    } finally {
      db.close();
    }
  }

  if (req.op === "cockpit_inspect" || req.op === "cockpit_export") {
    const rawName = (req.tableName ?? "").trim();
    const db = new DatabaseSync(dbPath, {
      readOnly: true,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 2000,
    });
    try {
      db.exec("PRAGMA trusted_schema = OFF;");
      const tables = listUserMasterTables(db);
      const found = tables.find((t) => t.name.toLowerCase() === rawName.toLowerCase());
      if (!found) {
        return {
          id: req.id,
          ok: false,
          codigo: "NAO_ENCONTRADA",
          mensagem: `Tabela '${rawName}' não encontrada.`,
        };
      }
      const meta = readMetadataMap(db);
      const ownerInfo = meta.get(found.name.toLowerCase());
      const quoted = quoteSqliteIdentifier(found.name);

      const pragmaCols = db
        .prepare(`PRAGMA table_info(${quoted});`)
        .all() as Array<{ name: string }>;
      const colNames = pragmaCols.map((c) => c.name);

      if (req.op === "cockpit_export") {
        const rawRows = db
          .prepare(`SELECT * FROM ${quoted} LIMIT ?;`)
          .all(AGENT_DATABASE_LIMITS.maxExportRows + 1) as Array<Record<string, unknown>>;
        const truncated = rawRows.length > AGENT_DATABASE_LIMITS.maxExportRows;
        const sliced = truncated ? rawRows.slice(0, AGENT_DATABASE_LIMITS.maxExportRows) : rawRows;
        const cols = colNames.length > 0 ? colNames : sliced[0] ? Object.keys(sliced[0]) : [];
        const matrix = sliced.map((r) => cols.map((c) => truncateCell(r[c], 32_000).value));
        return {
          id: req.id,
          ok: true,
          result: {
            name: found.name,
            ownerAgentId: ownerInfo?.owner ?? null,
            columns: cols,
            rows: matrix,
            truncated,
          },
        };
      }

      const limit = Math.min(Math.max(1, Number(req.limit ?? 100)), AGENT_DATABASE_LIMITS.maxRows);
      const offset = Math.max(0, Number(req.offset ?? 0));
      const busca = (req.busca ?? "").trim();

      let whereClause = "";
      const whereParams: Array<string | number> = [];
      if (busca && colNames.length > 0) {
        const exprs = colNames.map((c) => `CAST(${quoteSqliteIdentifier(c)} AS TEXT) LIKE ?`);
        whereClause = `WHERE (${exprs.join(" OR ")})`;
        for (let i = 0; i < colNames.length; i += 1) {
          whereParams.push(`%${busca}%`);
        }
      }

      const countRow = db
        .prepare(`SELECT COUNT(*) AS total FROM ${quoted} ${whereClause};`)
        .get(...whereParams) as { total?: number | bigint } | undefined;
      const totalRows = countRow?.total !== undefined ? Number(countRow.total) : 0;

      const rawRows = db
        .prepare(`SELECT * FROM ${quoted} ${whereClause} LIMIT ? OFFSET ?;`)
        .all(...whereParams, limit, offset) as Array<Record<string, unknown>>;

      const formatted = formatStatementRows(rawRows, colNames, {
        maxRows: limit,
        maxBytes: AGENT_DATABASE_LIMITS.maxResultBytes * 2,
        maxCellChars: AGENT_DATABASE_LIMITS.maxCellChars,
      });

      return {
        id: req.id,
        ok: true,
        result: {
          name: found.name,
          ownerAgentId: ownerInfo?.owner ?? null,
          sql: found.sql,
          columns: formatted.columns,
          rows: formatted.rows,
          totalRows,
          truncated: formatted.truncated || offset + formatted.rowCount < totalRows,
        },
      };
    } finally {
      db.close();
    }
  }

  return { id: req.id, ok: false, codigo: "OP_DESCONHECIDA", mensagem: "Operação inválida no host Shared Tables." };
}

function resolveDbArg(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--db");
  if (idx >= 0 && args[idx + 1]) {
    return resolve(args[idx + 1]!);
  }
  return resolve(process.cwd(), "dados", "shared-tables.db");
}

function startJsonlLoop(): void {
  const dbPath = resolveDbArg();
  ensureDatabaseProvisioned(dbPath);
  process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: HostRequestMessage | null = null;
    try {
      parsed = JSON.parse(trimmed) as HostRequestMessage;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ id: "unknown", ok: false, codigo: "JSON_INVALIDO", mensagem: "Linha JSON inválida." })}\n`,
      );
      return;
    }

    try {
      const response = handleCommand(dbPath, parsed);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDenied = /not authorized|authorizer/i.test(msg);
      process.stdout.write(
        `${JSON.stringify({
          id: parsed.id,
          ok: false,
          codigo: isDenied ? "SQL_AUTORIZADOR_NEGADO" : "ERRO_SQLITE",
          mensagem: msg,
        })}\n`,
      );
    }
  });
}

// Executa loop apenas quando invocado como entrypoint do processo filho
if (process.argv[1] && /shared-tables-host\.(ts|js)$/i.test(process.argv[1])) {
  startJsonlLoop();
}
