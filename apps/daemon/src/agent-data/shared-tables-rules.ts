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

const FORBIDDEN_TOP_KEYWORDS = new Set([
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

const FORBIDDEN_FUNCTIONS = new Set([
  "LOAD_EXTENSION",
  "READFILE",
  "WRITEFILE",
  "EDIT",
  "FTS3_TOKENIZER",
]);

const ALLOWED_VTABLE_MODULES = new Set(["fts5", "fts5vocab", "rtree", "rtreecheck"]);

const READ_KEYWORDS = new Set(["SELECT", "VALUES", "EXPLAIN"]);
const WRITE_KEYWORDS = new Set([
  "INSERT",
  "REPLACE",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
]);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_\u0080-\uFFFF]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$\u0080-\uFFFF]/.test(ch);
}

function unquoteTokenIdent(raw: string): string {
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

export type CheckAgentSqlSuccess = {
  ok: true;
  effectiveKeyword: string;
  kind: "read" | "dml" | "create" | "alter" | "drop";
  targetTable?: string;
};

export type CheckAgentSqlFailure = {
  ok: false;
  codigo: "SQL_PROIBIDO";
  mensagem: string;
};

export type CheckAgentSqlResult = CheckAgentSqlSuccess | CheckAgentSqlFailure;

function extractTargetTable(tokens: ScannedSqlToken[], startIdx: number): {
  kind: "read" | "dml" | "create" | "alter" | "drop";
  targetTable?: string;
  vtableModule?: string;
  isTempTrigger?: boolean;
} {
  const top = tokens.slice(startIdx).filter((t) => t.depth === 0 && t.type !== "semicolon");
  const head = top[0]?.upper ?? "";

  if (head === "SELECT" || head === "VALUES" || head === "EXPLAIN") {
    return { kind: "read" };
  }

  if (head === "CREATE") {
    let idx = 1;
    let isTemp = false;
    if (top[idx]?.upper === "TEMP" || top[idx]?.upper === "TEMPORARY") {
      isTemp = true;
      idx += 1;
    }
    if (top[idx]?.upper === "UNIQUE") {
      idx += 1;
    }
    const isVirtual = top[idx]?.upper === "VIRTUAL";
    if (isVirtual) {
      idx += 1;
    }
    const objType = top[idx]?.upper ?? "";
    idx += 1;

    if (top[idx]?.upper === "IF" && top[idx + 1]?.upper === "NOT" && top[idx + 2]?.upper === "EXISTS") {
      idx += 3;
    }

    if (objType === "TRIGGER") {
      if (isTemp) {
        return { kind: "create", isTempTrigger: true };
      }
      // Avança até ON <tabela>
      while (idx < top.length && top[idx]?.upper !== "ON") {
        idx += 1;
      }
      const onTable = top[idx + 1]?.value;
      return { kind: "alter", targetTable: onTable };
    }

    if (objType === "INDEX") {
      while (idx < top.length && top[idx]?.upper !== "ON") {
        idx += 1;
      }
      return { kind: "alter", targetTable: top[idx + 1]?.value };
    }

    const tableName = top[idx]?.value;
    let vtableModule: string | undefined;
    if (isVirtual) {
      while (idx < top.length && top[idx]?.upper !== "USING") {
        idx += 1;
      }
      vtableModule = top[idx + 1]?.value;
    }
    return { kind: "create", targetTable: tableName, vtableModule };
  }

  if (head === "DROP") {
    let idx = 1;
    const objType = top[idx]?.upper ?? "";
    idx += 1;
    if (top[idx]?.upper === "IF" && top[idx + 1]?.upper === "EXISTS") {
      idx += 2;
    }
    const name = top[idx]?.value;
    return { kind: objType === "TRIGGER" || objType === "INDEX" ? "alter" : "drop", targetTable: name };
  }

  if (head === "ALTER") {
    // ALTER TABLE <name> ...
    const tableName = top[2]?.value;
    return { kind: "alter", targetTable: tableName };
  }

  if (head === "INSERT" || head === "REPLACE") {
    let idx = 1;
    if (head === "INSERT" && top[idx]?.upper === "OR") {
      idx += 2;
    }
    if (top[idx]?.upper === "INTO") {
      idx += 1;
    }
    return { kind: "dml", targetTable: top[idx]?.value };
  }

  if (head === "UPDATE") {
    let idx = 1;
    if (top[idx]?.upper === "OR") {
      idx += 2;
    }
    return { kind: "dml", targetTable: top[idx]?.value };
  }

  if (head === "DELETE") {
    let idx = 1;
    if (top[idx]?.upper === "FROM") {
      idx += 1;
    }
    return { kind: "dml", targetTable: top[idx]?.value };
  }

  return { kind: "dml" };
}

/**
 * Valida instrução SQL de agente contra limites léxicos, proibições de PRAGMA/ATTACH/transações
 * e separação estrita entre leitura (`query_data`) e escrita (`execute_data`).
 */
export function checkAgentSql(sql: string, mode: "read" | "write"): CheckAgentSqlResult {
  if (typeof sql !== "string") {
    return { ok: false, codigo: "SQL_PROIBIDO", mensagem: "A instrução SQL deve ser uma string." };
  }
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return { ok: false, codigo: "SQL_PROIBIDO", mensagem: "A instrução SQL não pode estar vazia." };
  }
  if (trimmed.length > AGENT_DATABASE_LIMITS.maxSqlChars) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: `A instrução SQL excede o limite máximo de ${AGENT_DATABASE_LIMITS.maxSqlChars} caracteres.`,
    };
  }

  const scanned = scanStatement(trimmed);
  if (scanned.unterminatedString) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Literal de texto ou identificador cotado não foi fechado corretamente na instrução SQL.",
    };
  }
  if (scanned.unterminatedComment) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Comentário de bloco /* ... */ não foi fechado na instrução SQL.",
    };
  }
  if (scanned.unbalancedParens) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Parênteses ou blocos BEGIN/END desbalanceados na instrução SQL.",
    };
  }
  if (scanned.hasTrailingStatement) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Apenas uma única instrução SQL por chamada é permitida (múltiplas instruções detectadas após ';').",
    };
  }

  const meaningful = scanned.tokens.filter((t) => t.type !== "semicolon");
  if (meaningful.length === 0) {
    return { ok: false, codigo: "SQL_PROIBIDO", mensagem: "Nenhuma instrução SQL executável encontrada." };
  }

  // Verifica palavras proibidas no nível 0 e funções perigosas em qualquer nível
  let inTriggerBody = false;
  const firstWord = meaningful[0]?.upper;
  const secondWord = meaningful[1]?.upper;
  const thirdWord = meaningful[2]?.upper;
  const isTriggerStmt =
    firstWord === "CREATE" && (secondWord === "TRIGGER" || thirdWord === "TRIGGER");

  for (let idx = 0; idx < meaningful.length; idx += 1) {
    const tok = meaningful[idx]!;
    const nextTok = meaningful[idx + 1];

    if (
      (tok.type === "word" || tok.type === "ident") &&
      nextTok?.value === "(" &&
      FORBIDDEN_FUNCTIONS.has(tok.upper)
    ) {
      return {
        ok: false,
        codigo: "SQL_PROIBIDO",
        mensagem: `Função SQLite '${tok.value}' bloqueada por segurança no banco compartilhado.`,
      };
    }

    if (
      (tok.type === "word" || tok.type === "ident") &&
      tok.upper === "CRIATIVO_SHARED_METADATA"
    ) {
      return {
        ok: false,
        codigo: "SQL_PROIBIDO",
        mensagem: "A tabela interna 'criativo_shared_metadata' é reservada ao supervisor do estúdio.",
      };
    }

    if (tok.depth === 0 && tok.type === "word") {
      if (isTriggerStmt && (tok.upper === "BEGIN" || tok.upper === "END")) {
        inTriggerBody = tok.upper === "BEGIN";
        continue;
      }
      if (!inTriggerBody && FORBIDDEN_TOP_KEYWORDS.has(tok.upper)) {
        return {
          ok: false,
          codigo: "SQL_PROIBIDO",
          mensagem: `Comando '${tok.upper}' proibido no banco SQL compartilhado.`,
        };
      }
    }
  }

  const skipBalancedParens = (pos: number): number => {
    if (meaningful[pos]?.value !== "(") return pos;
    const openDepth = meaningful[pos]!.depth;
    let cur = pos + 1;
    while (cur < meaningful.length) {
      if (meaningful[cur]!.value === ")" && meaningful[cur]!.depth === openDepth) {
        return cur + 1;
      }
      cur += 1;
    }
    return cur;
  };

  // Determina a palavra-chave principal ignorando cláusula CTE `WITH [RECURSIVE] ...`
  let mainIdx = 0;
  if (meaningful[0]?.depth === 0 && meaningful[0]?.upper === "WITH") {
    let idx = 1;
    if (meaningful[idx]?.depth === 0 && meaningful[idx]?.upper === "RECURSIVE") {
      idx += 1;
    }
    while (idx < meaningful.length) {
      // Nome da CTE + lista opcional de colunas (c1, c2)
      idx += 1;
      if (meaningful[idx]?.value === "(") {
        idx = skipBalancedParens(idx);
      }
      if (meaningful[idx]?.depth === 0 && meaningful[idx]?.upper === "AS") {
        idx += 1;
      }
      if (
        meaningful[idx]?.depth === 0 &&
        (meaningful[idx]?.upper === "NOT" || meaningful[idx]?.upper === "MATERIALIZED")
      ) {
        idx += 1;
        if (meaningful[idx]?.depth === 0 && meaningful[idx]?.upper === "MATERIALIZED") {
          idx += 1;
        }
      }
      // Corpo (...) da CTE
      if (meaningful[idx]?.value === "(") {
        idx = skipBalancedParens(idx);
      }
      if (meaningful[idx]?.depth === 0 && meaningful[idx]?.value === ",") {
        idx += 1;
        continue;
      }
      break;
    }
    mainIdx = idx;
  }

  const effectiveToken = meaningful[mainIdx];
  if (!effectiveToken || effectiveToken.depth !== 0 || effectiveToken.type !== "word") {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Não foi possível identificar uma instrução SQL principal válida.",
    };
  }

  let effectiveKeyword = effectiveToken.upper;
  let targetCheckIdx = mainIdx;

  if (effectiveKeyword === "EXPLAIN") {
    let expIdx = mainIdx + 1;
    if (
      meaningful[expIdx]?.upper === "QUERY" &&
      meaningful[expIdx + 1]?.upper === "PLAN"
    ) {
      expIdx += 2;
    }
    const explainedKw = meaningful[expIdx]?.upper ?? "";
    if (FORBIDDEN_TOP_KEYWORDS.has(explainedKw)) {
      return {
        ok: false,
        codigo: "SQL_PROIBIDO",
        mensagem: `Comando '${explainedKw}' não pode ser executado via EXPLAIN.`,
      };
    }
    if (mode === "read" && explainedKw !== "SELECT" && explainedKw !== "VALUES") {
      return {
        ok: false,
        codigo: "SQL_PROIBIDO",
        mensagem: "Em query_data, EXPLAIN só pode inspecionar instruções SELECT ou VALUES.",
      };
    }
    targetCheckIdx = expIdx;
  }

  if (mode === "read") {
    if (!READ_KEYWORDS.has(effectiveKeyword)) {
      return {
        ok: false,
        codigo: "SQL_PROIBIDO",
        mensagem: `Instrução '${effectiveKeyword}' não é permitida em query_data (somente leitura: SELECT, VALUES, EXPLAIN). Use execute_data para mutações.`,
      };
    }
    return { ok: true, effectiveKeyword, kind: "read" };
  }

  if (!WRITE_KEYWORDS.has(effectiveKeyword)) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: `Instrução '${effectiveKeyword}' não é permitida em execute_data. Para consultas SELECT use query_data.`,
    };
  }

  const extracted = extractTargetTable(meaningful, targetCheckIdx);
  if (extracted.isTempTrigger) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Triggers temporários (TEMP TRIGGER) são proibidos no banco compartilhado.",
    };
  }
  if (
    extracted.vtableModule &&
    !ALLOWED_VTABLE_MODULES.has(extracted.vtableModule.toLowerCase())
  ) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: `Módulo de tabela virtual '${extracted.vtableModule}' não permitido (permitidos: fts5, rtree).`,
    };
  }
  if (
    extracted.targetTable &&
    extracted.targetTable.toLowerCase().startsWith("sqlite_")
  ) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Tabelas internas 'sqlite_*' não podem ser criadas ou modificadas.",
    };
  }

  return {
    ok: true,
    effectiveKeyword,
    kind: extracted.kind,
    targetTable: extracted.targetTable,
  };
}

export type CheckParamsResult =
  | { ok: true; values: Array<string | number | null> }
  | { ok: false; codigo: "SQL_PROIBIDO"; mensagem: string };

/**
 * Valida parâmetros posicionais `?` passados pelo agente.
 */
export function checkAgentParameters(params: unknown): CheckParamsResult {
  if (params === undefined || params === null) {
    return { ok: true, values: [] };
  }
  if (!Array.isArray(params)) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: "Os parâmetros SQL devem ser informados como um array posicional.",
    };
  }
  if (params.length > AGENT_DATABASE_LIMITS.maxParams) {
    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: `Máximo de ${AGENT_DATABASE_LIMITS.maxParams} parâmetros posicionais excedido.`,
    };
  }

  const normalized: Array<string | number | null> = [];
  let totalBytes = 0;

  for (let idx = 0; idx < params.length; idx += 1) {
    const item = params[idx];
    if (item === null || item === undefined) {
      normalized.push(null);
      totalBytes += 4;
      continue;
    }
    if (typeof item === "boolean") {
      normalized.push(item ? 1 : 0);
      totalBytes += 1;
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        return {
          ok: false,
          codigo: "SQL_PROIBIDO",
          mensagem: `Parâmetro na posição ${idx} contém número inválido (NaN ou Infinity).`,
        };
      }
      normalized.push(item);
      totalBytes += 8;
      continue;
    }
    if (typeof item === "string") {
      const bytes = Buffer.byteLength(item, "utf8");
      totalBytes += bytes;
      if (totalBytes > AGENT_DATABASE_LIMITS.maxParamBytes) {
        return {
          ok: false,
          codigo: "SQL_PROIBIDO",
          mensagem: `Tamanho total dos parâmetros excede ${AGENT_DATABASE_LIMITS.maxParamBytes} bytes.`,
        };
      }
      normalized.push(item);
      continue;
    }

    return {
      ok: false,
      codigo: "SQL_PROIBIDO",
      mensagem: `Tipo não suportado no parâmetro ${idx}: apenas string, number, boolean ou null são aceitos.`,
    };
  }

  return { ok: true, values: normalized };
}

/**
 * Escapa identificador SQLite entre aspas duplas dobrando eventuais `"` internos.
 */
export function quoteSqliteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Formata célula para exportação RFC 4180 CSV.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
