/**
 * Processo filho isolado Node 22 para operar exclusivamente sobre `dados/shared-tables.db`
 * via protocolo JSON line-delimited (stdin/stdout) com `readOnly`, `PRAGMA trusted_schema = OFF`,
 * `max_page_count = 65536`, `DatabaseSync.setAuthorizer` (quando exposto pelo runtime) e proteção
 * estrita de posse (`criativo_shared_metadata`).
 */
import { mkdirSync } from "node:fs";
import {
  dirname,
} from "node:path";
import * as nodeSqlite from "node:sqlite";
import {
  AGENT_DATABASE_LIMITS,
} from "./shared-tables-rules.ts";

export const { DatabaseSync } = nodeSqlite;
export const sqliteConstants = (nodeSqlite.constants ?? {}) as Record<string, number>;

export const SQLITE_OK = sqliteConstants.SQLITE_OK ?? 0;
export const SQLITE_DENY = sqliteConstants.SQLITE_DENY ?? 1;

export const ACTION_CREATE_TEMP_TRIGGER = sqliteConstants.SQLITE_CREATE_TEMP_TRIGGER ?? 5;
export const ACTION_CREATE_TRIGGER = sqliteConstants.SQLITE_CREATE_TRIGGER ?? 7;
export const ACTION_DELETE = sqliteConstants.SQLITE_DELETE ?? 9;
export const ACTION_DROP_TABLE = sqliteConstants.SQLITE_DROP_TABLE ?? 11;
export const ACTION_DROP_TRIGGER = sqliteConstants.SQLITE_DROP_TRIGGER ?? 16;
export const ACTION_INSERT = sqliteConstants.SQLITE_INSERT ?? 18;
export const ACTION_PRAGMA = sqliteConstants.SQLITE_PRAGMA ?? 19;
export const ACTION_UPDATE = sqliteConstants.SQLITE_UPDATE ?? 23;
export const ACTION_ATTACH = sqliteConstants.SQLITE_ATTACH ?? 24;
export const ACTION_DETACH = sqliteConstants.SQLITE_DETACH ?? 25;
export const ACTION_ALTER_TABLE = sqliteConstants.SQLITE_ALTER_TABLE ?? 26;
export const ACTION_REINDEX = sqliteConstants.SQLITE_REINDEX ?? 27;
export const ACTION_ANALYZE = sqliteConstants.SQLITE_ANALYZE ?? 28;
export const ACTION_CREATE_VTABLE = sqliteConstants.SQLITE_CREATE_VTABLE ?? 29;
export const ACTION_DROP_VTABLE = sqliteConstants.SQLITE_DROP_VTABLE ?? 30;
export const ACTION_FUNCTION = sqliteConstants.SQLITE_FUNCTION ?? 31;

export const ALLOWED_VTABLE_MODULES = new Set(["fts5", "fts5vocab", "rtree", "rtreecheck"]);
export const BLOCKED_FUNCTIONS = new Set([
  "load_extension",
  "readfile",
  "writefile",
  "edit",
  "fts3_tokenizer",
]);
export const SAFE_INTERNAL_PRAGMAS = new Set(["data_version", "page_size"]);

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

export type AuthorizableDatabase = InstanceType<typeof DatabaseSync> & {
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

export function isFtsOrRtreeShadowTable(name: string, baseTables: Set<string>): boolean {
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

export function ensureDatabaseProvisioned(dbPath: string): void {
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

export function readMetadataMap(db: InstanceType<typeof DatabaseSync>): Map<string, { owner: string; createdAt: string }> {
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

export function listUserMasterTables(db: InstanceType<typeof DatabaseSync>): Array<{ name: string; sql: string }> {
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

export function installAuthorizer(
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

export function truncateCell(val: unknown, maxCellChars: number): { value: unknown; truncated: boolean } {
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

export function formatStatementRows(
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

export function syncCreatedAndDroppedTables(
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

