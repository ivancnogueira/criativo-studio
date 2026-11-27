import type {
  WorkflowBranch,
  WorkflowDeterministicClause,
  WorkflowDeterministicRule,
} from "@criativo/contracts";

function resolveFieldValue(
  fieldRef: string,
  vars: Record<string, unknown>,
  rawInputText: string
): unknown {
  const cleanRef = fieldRef.trim().replace(/^\{\{\s*|\s*\}\}$/g, "");
  if (!cleanRef || cleanRef === "input") {
    return vars.input !== undefined ? vars.input : rawInputText;
  }
  if (cleanRef in vars) {
    return vars[cleanRef];
  }
  if (cleanRef.includes(".")) {
    const [head, ...rest] = cleanRef.split(".");
    const base = vars[head];
    if (base && typeof base === "object") {
      let cur: unknown = base;
      for (const part of rest) {
        if (!cur || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur;
    }
  }
  return undefined;
}

function normalizeStringValue(val: unknown, caseSensitive: boolean): string {
  if (val === undefined || val === null) return "";
  const str = typeof val === "string" ? val : JSON.stringify(val);
  return caseSensitive ? str : str.toLowerCase();
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (typeof val === "string") {
    const cleaned = val.trim().replace(",", ".");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isValueEmpty(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string") return val.trim().length === 0;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === "object") return Object.keys(val as Record<string, unknown>).length === 0;
  return false;
}

function toBooleanCoerced(val: unknown): boolean | null {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (["true", "sim", "yes", "1", "verdadeiro"].includes(lower)) return true;
    if (["false", "não", "nao", "no", "0", "falso"].includes(lower)) return false;
  }
  return null;
}

/**
 * Avalia uma única cláusula determinística sobre variáveis estruturadas ou entrada textual.
 */
export function evaluateDeterministicClause(
  clause: WorkflowDeterministicClause,
  vars: Record<string, unknown>,
  rawInputText: string
): boolean {
  const actual = resolveFieldValue(clause.fieldRef, vars, rawInputText);
  const caseSensitive = Boolean(clause.caseSensitive);
  const expectedRaw = clause.value ?? "";

  switch (clause.operator) {
    case "is_empty":
      return isValueEmpty(actual);
    case "not_empty":
      return !isValueEmpty(actual);
    case "is_true":
      return toBooleanCoerced(actual) === true;
    case "is_false":
      return toBooleanCoerced(actual) === false;
    case "equals":
      return (
        normalizeStringValue(actual, caseSensitive) ===
        (caseSensitive ? expectedRaw : expectedRaw.toLowerCase())
      );
    case "not_equals":
      return (
        normalizeStringValue(actual, caseSensitive) !==
        (caseSensitive ? expectedRaw : expectedRaw.toLowerCase())
      );
    case "contains": {
      const hay = normalizeStringValue(actual, caseSensitive);
      const needle = caseSensitive ? expectedRaw : expectedRaw.toLowerCase();
      return needle.length > 0 && hay.includes(needle);
    }
    case "not_contains": {
      const hay = normalizeStringValue(actual, caseSensitive);
      const needle = caseSensitive ? expectedRaw : expectedRaw.toLowerCase();
      return needle.length === 0 || !hay.includes(needle);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = toFiniteNumber(actual);
      const right = toFiniteNumber(expectedRaw);
      if (left === null || right === null) return false;
      if (clause.operator === "gt") return left > right;
      if (clause.operator === "gte") return left >= right;
      if (clause.operator === "lt") return left < right;
      return left <= right;
    }
    case "regex": {
      if (!expectedRaw) return false;
      try {
        const flags = caseSensitive ? "" : "i";
        const re = new RegExp(expectedRaw, flags);
        const text = typeof actual === "string" ? actual : String(actual ?? "");
        return re.test(text);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Avalia uma regra determinística composta (E / OU) sem invocar nenhum modelo de IA.
 */
export function evaluateDeterministicCondition(
  rule: WorkflowDeterministicRule,
  vars: Record<string, unknown>,
  rawInputText: string
): WorkflowBranch {
  const clauses = Array.isArray(rule.clauses) ? rule.clauses : [];
  if (clauses.length === 0) return "no";

  const matched =
    rule.combine === "or"
      ? clauses.some((c) => evaluateDeterministicClause(c, vars, rawInputText))
      : clauses.every((c) => evaluateDeterministicClause(c, vars, rawInputText));

  return matched ? "yes" : "no";
}
