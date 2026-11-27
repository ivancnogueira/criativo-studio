import type {
  WorkflowAnswerField,
  WorkflowAresta,
  WorkflowNo,
  WorkflowStepRecord,
} from "@criativo/contracts";

const VALID_FIELD_KEY_RE = /^[a-zA-Z0-9_]+$/;

/**
 * Extrai e valida a declaração de campos estruturados (`Answer fields`) de um nó.
 */
export function resolveNodeAnswerFields(node: WorkflowNo): WorkflowAnswerField[] {
  const raw = Array.isArray(node.answerFields)
    ? node.answerFields
    : Array.isArray(node.config?.answerFields)
      ? (node.config.answerFields as WorkflowAnswerField[])
      : [];

  return raw.filter(
    (f): f is WorkflowAnswerField =>
      Boolean(f && typeof f.key === "string" && VALID_FIELD_KEY_RE.test(f.key.trim()))
  ).map((f) => ({
    ...f,
    key: f.key.trim(),
    label: (f.label || f.key).trim(),
    type: f.type || "text",
  }));
}

/**
 * Constrói instrução explícita em pt-BR para orientar LLM ou Agente a responder em JSON estruturado válido.
 */
export function buildAnswerFieldsInstruction(fields: readonly WorkflowAnswerField[]): string {
  if (fields.length === 0) return "";
  const schemaLines = fields.map((f) => {
    const reqTag = f.required ? "obrigatório" : "opcional";
    const optsTag =
      f.type === "select" && Array.isArray(f.options) && f.options.length > 0
        ? `; opções válidas: [${f.options.join(", ")}]`
        : "";
    const descTag = f.description ? ` — ${f.description}` : "";
    return `- "${f.key}" (tipo: ${f.type}, ${reqTag}${optsTag})${descTag}`;
  });
  return [
    "[SAÍDA ESTRUTURADA OBRIGATÓRIA — ANSWER FIELDS]",
    "Retorne um objeto JSON válido contendo exatamente os campos abaixo (sem texto fora do JSON ou dentro de bloco ```json ... ```):",
    ...schemaLines,
  ].join("\n");
}

function extractJsonObjectFromText(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // tenta bloco fenced ou recorte por chaves
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1].trim()) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignora
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function coerceFieldValue(rawVal: unknown, field: WorkflowAnswerField): unknown {
  if (rawVal === undefined || rawVal === null) return undefined;

  if (field.type === "number") {
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) return rawVal;
    const normalized = String(rawVal).trim().replace(",", ".");
    if (!normalized) return undefined;
    const num = Number(normalized);
    if (!Number.isFinite(num)) {
      throw new Error(`Campo '${field.key}' esperava número válido, recebido '${String(rawVal)}'.`);
    }
    return num;
  }

  if (field.type === "boolean") {
    if (typeof rawVal === "boolean") return rawVal;
    if (typeof rawVal === "number") return rawVal !== 0;
    const lower = String(rawVal).trim().toLowerCase();
    if (["true", "sim", "yes", "1", "verdadeiro"].includes(lower)) return true;
    if (["false", "não", "nao", "no", "0", "falso"].includes(lower)) return false;
    throw new Error(`Campo '${field.key}' esperava booleano, recebido '${String(rawVal)}'.`);
  }

  if (field.type === "select") {
    const str = String(rawVal).trim();
    if (!str) return undefined;
    if (Array.isArray(field.options) && field.options.length > 0) {
      const match = field.options.find((opt) => opt.trim().toLowerCase() === str.toLowerCase());
      if (!match) {
        throw new Error(
          `Campo '${field.key}' recebeu opção inválida '${str}'. Opções válidas: ${field.options.join(", ")}.`
        );
      }
      return match;
    }
    return str;
  }

  if (field.type === "json") {
    if (typeof rawVal === "string") {
      const trimmed = rawVal.trim();
      if (!trimmed) return undefined;
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return rawVal;
      }
    }
    return rawVal;
  }

  return typeof rawVal === "string" ? rawVal : JSON.stringify(rawVal);
}

function validateAndCoerceObject(
  sourceObj: Record<string, unknown>,
  fields: readonly WorkflowAnswerField[],
  resolveDotPath = false
): { data: Record<string, unknown>; formattedJson: string; missingRequired: string[] } {
  const data: Record<string, unknown> = {};
  const missingRequired: string[] = [];

  for (const field of fields) {
    let rawVal = sourceObj[field.key];
    if (rawVal === undefined && resolveDotPath) {
      rawVal = lookupFieldInPayload(sourceObj, field.key);
    }
    const coerced = coerceFieldValue(rawVal, field);
    if (coerced === undefined || (typeof coerced === "string" && coerced.trim() === "")) {
      if (field.required) {
        missingRequired.push(field.key);
      }
    } else {
      data[field.key] = coerced;
    }
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `Campos estruturados obrigatórios ausentes na resposta: ${missingRequired.join(", ")}.`
    );
  }

  return {
    data,
    formattedJson: JSON.stringify(data, null, 2),
    missingRequired,
  };
}

/**
 * Faz parsing e coerção tipada da saída JSON retornada por um nó LLM ou Agente.
 */
export function parseAndValidateAnswerFields(
  rawText: string,
  fields: readonly WorkflowAnswerField[]
): { data: Record<string, unknown>; formattedJson: string; missingRequired: string[] } {
  const parsed = extractJsonObjectFromText(rawText);
  if (!parsed) {
    throw new Error(
      "A etapa exige Answer fields em JSON válido, mas nenhum objeto JSON estruturado foi encontrado na resposta."
    );
  }
  return validateAndCoerceObject(parsed, fields, false);
}

function unwrapExternalPayloadObject(rawPayload: string | null): Record<string, unknown> | null {
  if (!rawPayload || !rawPayload.trim()) return null;
  let candidate = rawPayload.trim();
  const startMarker = "[EVENTO_EXTERNO_INICIO]";
  const endMarker = "[EVENTO_EXTERNO_FIM]";
  const startIdx = candidate.indexOf(startMarker);
  const endIdx = candidate.indexOf(endMarker);
  if (startIdx >= 0 && endIdx > startIdx) {
    candidate = candidate.slice(startIdx + startMarker.length, endIdx).trim();
  }
  return extractJsonObjectFromText(candidate);
}

function lookupDotPath(obj: unknown, dotPath: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = dotPath.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function lookupFieldInPayload(payloadObj: Record<string, unknown>, key: string): unknown {
  const queue: Record<string, unknown>[] = [payloadObj];
  const visited = new Set<object>([payloadObj]);
  const nestedScopes = ["payload", "evento", "body", "data"];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (key in cur && cur[key] !== undefined) {
      return cur[key];
    }
    const dotted = lookupDotPath(cur, key);
    if (dotted !== undefined) {
      return dotted;
    }
    for (const scope of nestedScopes) {
      const inner = cur[scope];
      if (inner && typeof inner === "object" && !Array.isArray(inner) && !visited.has(inner)) {
        visited.add(inner);
        queue.push(inner as Record<string, unknown>);
      }
    }
  }
  return undefined;
}

/**
 * Extrai Answer fields tipados diretamente do payload de um gatilho Webhook, sem chamar IA.
 */
export function extractWebhookAnswerFields(
  runPayload: string | null,
  fields: readonly WorkflowAnswerField[]
): Record<string, unknown> {
  if (fields.length === 0) return {};
  const obj = unwrapExternalPayloadObject(runPayload) ?? {};
  const data: Record<string, unknown> = {};
  const missingRequired: string[] = [];

  for (const field of fields) {
    const rawVal = lookupFieldInPayload(obj, field.key);
    const coerced = coerceFieldValue(rawVal, field);
    if (coerced === undefined || (typeof coerced === "string" && coerced.trim() === "")) {
      if (field.required) {
        missingRequired.push(field.key);
      }
    } else {
      data[field.key] = coerced;
    }
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `Payload webhook não forneceu os campos obrigatórios: ${missingRequired.join(", ")}.`
    );
  }
  return data;
}

/**
 * Coleta todas as variáveis estruturadas produzidas pelos predecessores diretos e ancestrais de `node`
 * via busca em largura reversa (mais próximos têm prioridade nos nomes sem prefixo).
 */
export function collectUpstreamStructuredVariables(
  node: WorkflowNo,
  arestas: readonly WorkflowAresta[],
  latestSteps: ReadonlyMap<string, WorkflowStepRecord>,
  rawInputText?: string
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  if (rawInputText !== undefined) {
    vars.input = rawInputText;
  }

  const visited = new Set<string>([node.id]);
  const queue: string[] = arestas
    .filter((e) => e.destino === node.id)
    .map((e) => e.origem);

  while (queue.length > 0) {
    const srcId = queue.shift()!;
    if (visited.has(srcId)) continue;
    visited.add(srcId);

    for (const parentEdge of arestas) {
      if (parentEdge.destino === srcId && !visited.has(parentEdge.origem)) {
        queue.push(parentEdge.origem);
      }
    }

    const prevStep = latestSteps.get(srcId);
    if (!prevStep || prevStep.status !== "done") continue;
    if (!prevStep.structured_output_json) continue;
    try {
      const parsed = JSON.parse(prevStep.structured_output_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (!(k in vars)) {
            vars[k] = v;
          }
          vars[`${prevStep.node_id}.${k}`] = v;
        }
      }
    } catch {
      // ignora JSON inválido legado
    }
  }

  return vars;
}

/**
 * Interpola tokens `{{input}}`, `{{campo}}` e `{{noId.campo}}` sem alterar placeholders de marca (`[NOME_DA_MARCA]`).
 */
export function interpolateWorkflowVariables(
  template: string,
  vars: Record<string, unknown>,
  fallbackInput = ""
): string {
  if (!template) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (full, token: string) => {
    if (token === "input") {
      const val = vars.input !== undefined ? vars.input : fallbackInput;
      return typeof val === "string" ? val : JSON.stringify(val ?? "");
    }
    if (token in vars && vars[token] !== undefined) {
      const val = vars[token];
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      return JSON.stringify(val);
    }
    return full;
  });
}
