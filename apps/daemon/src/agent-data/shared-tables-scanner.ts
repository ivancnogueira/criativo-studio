

/**
 * Regras léxicas, limites e sanitização SQL para o banco colaborativo isolado (Shared Tables).
 * Implementa scanner inspirado no sqlite3_complete sem dependências externas.
 */

export const AGENT_DATABASE_LIMITS = {
  maxSqlChars: 20_000,
  maxParams: 100,
  maxParamBytes: 1_000_000,
  maxRows: 500,
  maxExportRows: 50_000,
  maxResultBytes: 256_000,
  maxCellChars: 2_000,
  maxTables: 100,
  queryTimeoutMs: 5_000,
  hostStartDeadlineMs: 15_000,
  queueWaitMs: 20_000,
  maxPageCount: 65_536,
} as const;

export interface ScannedSqlToken {
  type: "word" | "ident" | "string" | "symbol" | "semicolon";
  value: string;
  upper: string;
  depth: number;
}

export interface ScannedStatementResult {
  tokens: ScannedSqlToken[];
  unterminatedString: boolean;
  unterminatedComment: boolean;
  unbalancedParens: boolean;
  hasTrailingStatement: boolean;
}

export const FORBIDDEN_TOP_KEYWORDS = new Set([
  "ATTACH",
  "DETACH",
  "VACUUM",
  "PRAGMA",
  "ANALYZE",
  "REINDEX",
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
]);

export const FORBIDDEN_FUNCTIONS = new Set([
  "LOAD_EXTENSION",
  "READFILE",
  "WRITEFILE",
  "EDIT",
  "FTS3_TOKENIZER",
]);

export const ALLOWED_VTABLE_MODULES = new Set(["fts5", "fts5vocab", "rtree", "rtreecheck"]);

export const READ_KEYWORDS = new Set(["SELECT", "VALUES", "EXPLAIN"]);
export const WRITE_KEYWORDS = new Set([
  "INSERT",
  "REPLACE",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
]);

export function isIdentStart(ch: string): boolean {
  return /[A-Za-z_\u0080-\uFFFF]/.test(ch);
}

export function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$\u0080-\uFFFF]/.test(ch);
}

export function unquoteTokenIdent(raw: string): string {
  if (raw.length >= 2) {
    if (raw.startsWith('"') && raw.endsWith('"')) {
      return raw.slice(1, -1).replace(/""/g, '"');
    }
    if (raw.startsWith("`") && raw.endsWith("`")) {
      return raw.slice(1, -1).replace(/``/g, "`");
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/**
 * Scanner léxico SQL que respeita strings, identificadores cotados, blobs, comentários,
 * profundidade de parênteses e blocos `CREATE TRIGGER ... BEGIN ... END;`.
 */
export function scanStatement(sql: string): ScannedStatementResult {
  const tokens: ScannedSqlToken[] = [];
  const len = sql.length;
  let i = 0;
  let depth = 0;
  let unbalancedParens = false;
  let unterminatedString = false;
  let unterminatedComment = false;
  let statementEnded = false;
  let hasTrailingStatement = false;

  let seenCreate = false;
  let isCreateTrigger = false;
  let triggerBlockDepth = 0;

  const markNonTriviaIfEnded = (): boolean => {
    if (statementEnded) {
      hasTrailingStatement = true;
      return true;
    }
    return false;
  };

  while (i < len) {
    const ch = sql[i]!;
    const next = i + 1 < len ? sql[i + 1]! : "";

    // Espaços em branco
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Comentário de linha --
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < len && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    // Comentário de bloco /* ... */
    if (ch === "/" && next === "*") {
      i += 2;
      let closed = false;
      while (i < len) {
        if (sql[i] === "*" && i + 1 < len && sql[i + 1] === "/") {
          i += 2;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        unterminatedComment = true;
        break;
      }
      continue;
    }

    if (markNonTriviaIfEnded()) {
      break;
    }

    // Blob literal X'...' ou x'...'
    if ((ch === "x" || ch === "X") && next === "'") {
      const start = i;
      i += 2;
      let closed = false;
      while (i < len) {
        if (sql[i] === "'") {
          if (i + 1 < len && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        unterminatedString = true;
        break;
      }
      const raw = sql.slice(start, i);
      tokens.push({ type: "string", value: raw, upper: raw.toUpperCase(), depth });
      continue;
    }

    // Literal de string '...'
    if (ch === "'") {
      const start = i;
      i += 1;
      let closed = false;
      while (i < len) {
        if (sql[i] === "'") {
          if (i + 1 < len && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        unterminatedString = true;
        break;
      }
      const raw = sql.slice(start, i);
      tokens.push({ type: "string", value: raw, upper: "", depth });
      continue;
    }

    // Identificadores cotados "...", `...`, [...]
    if (ch === '"' || ch === "`" || ch === "[") {
      const closeChar = ch === "[" ? "]" : ch;
      const start = i;
      i += 1;
      let closed = false;
      while (i < len) {
        if (sql[i] === closeChar) {
          if (ch !== "[" && i + 1 < len && sql[i + 1] === closeChar) {
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        unterminatedString = true;
        break;
      }
      const raw = sql.slice(start, i);
      const clean = unquoteTokenIdent(raw);
      tokens.push({ type: "ident", value: clean, upper: clean.toUpperCase(), depth });
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "symbol", value: "(", upper: "(", depth });
      depth += 1;
      i += 1;
      continue;
    }

    if (ch === ")") {
      if (depth === 0) {
        unbalancedParens = true;
      } else {
        depth -= 1;
      }
      tokens.push({ type: "symbol", value: ")", upper: ")", depth });
      i += 1;
      continue;
    }

    if (ch === ";") {
      tokens.push({ type: "semicolon", value: ";", upper: ";", depth });
      i += 1;
      if (depth === 0 && (!isCreateTrigger || triggerBlockDepth === 0)) {
        statementEnded = true;
      }
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < len && isIdentPart(sql[i]!)) {
        i += 1;
      }
      const word = sql.slice(start, i);
      const upper = word.toUpperCase();

      if (depth === 0) {
        if (tokens.length === 0 && upper === "CREATE") {
          seenCreate = true;
        } else if (seenCreate && !isCreateTrigger && upper === "TRIGGER") {
          isCreateTrigger = true;
        } else if (isCreateTrigger && (upper === "BEGIN" || upper === "CASE")) {
          triggerBlockDepth += 1;
        } else if (isCreateTrigger && upper === "END" && triggerBlockDepth > 0) {
          triggerBlockDepth -= 1;
        }
      }

      tokens.push({ type: "word", value: word, upper, depth });
      continue;
    }

    // Números e operadores diversos
    tokens.push({ type: "symbol", value: ch, upper: ch, depth });
    i += 1;
  }

  if (depth !== 0 || triggerBlockDepth !== 0) {
    unbalancedParens = true;
  }

  return {
    tokens,
    unterminatedString,
    unterminatedComment,
    unbalancedParens,
    hasTrailingStatement,
  };
}

