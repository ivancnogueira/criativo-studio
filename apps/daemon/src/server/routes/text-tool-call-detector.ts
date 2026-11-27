/**
 * Parser e detector de tentativas de chamada de ferramentas escritas como texto literal
 * (`<execute>`, `<tool_call>`, `<function_call>`, `<invoke>`, blocos fenced) (SCALE41-03).
 */
import {
  isPhase10ExtensionTool,
  isPhase13ToolName,
  isPhase14ToolName,
  isPhase15ToolName,
  isRoutineToolName,
  isWorkflowToolName,
} from "../studio-tools-bridge.ts";

export interface ParsedTextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export function normalizeStudioToolName(rawName: string): string {
  return rawName
    .replace(/^(?:mcp__criativo_studio__|criativo_studio_|criativo-studio_)/, "")
    .trim();
}

export function isSupportedStudioTextToolName(name: string): boolean {
  const clean = normalizeStudioToolName(name);
  if (!clean) return false;
  return (
    isWorkflowToolName(clean) ||
    isPhase13ToolName(clean) ||
    isPhase14ToolName(clean) ||
    isPhase15ToolName(clean) ||
    isPhase10ExtensionTool(clean) ||
    isRoutineToolName(clean) ||
    clean.startsWith("mcp_")
  );
}

function tryParseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // tenta fallback abaixo
  }
  return null;
}

function parseXmlParameters(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const paramRegex = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(body)) !== null) {
    const key = m[1].trim();
    const rawVal = m[2].trim();
    try {
      args[key] = JSON.parse(rawVal);
    } catch {
      args[key] = rawVal;
    }
  }
  return args;
}

function tryBuildCall(
  rawName: unknown,
  rawArgs: unknown,
): ParsedTextToolCall | null {
  if (typeof rawName !== "string") return null;
  const cleanName = normalizeStudioToolName(rawName);
  if (!isSupportedStudioTextToolName(cleanName)) return null;
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  return { name: cleanName, arguments: args };
}

function tryParseJsonPayloadCall(innerText: string): ParsedTextToolCall | null {
  const obj = tryParseJsonRecord(innerText);
  if (!obj) return null;
  const candidateName = obj.name ?? obj.tool ?? obj.function;
  const candidateArgs = obj.arguments ?? obj.args ?? obj.input ?? obj.parameters ?? {};
  return tryBuildCall(candidateName, candidateArgs);
}

/**
 * Extrai chamadas de ferramenta escritas como texto pelos modelos
 * (`<tool_call>`, `<execute>`, `<function_call>`, `<invoke>` e fenced blocks).
 */
export function parseTextToolCalls(text: string): ParsedTextToolCall[] {
  if (!text || (!text.includes("<") && !text.includes("```"))) {
    return [];
  }

  const hits: Array<{ index: number; call: ParsedTextToolCall }> = [];

  // 1. Tags simples sem atributo nomeado no elemento (<tool_call>{...}</tool_call>, <execute>{...}</execute>, <function_call>{...})
  const jsonTagRegex = /<(tool_call|execute|function_call)\s*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonTagRegex.exec(text)) !== null) {
    const parsed = tryParseJsonPayloadCall(m[2]);
    if (parsed) {
      hits.push({ index: m.index, call: parsed });
    }
  }

  // 2. Tags com atributo name="..." ou tool="..." (<execute name="...">...</execute>, <invoke name="...">...</invoke>)
  const attrTagRegex = /<(execute|invoke|tool_call)\s+(?:name|tool)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = attrTagRegex.exec(text)) !== null) {
    const attrToolName = m[2];
    const body = m[3].trim();
    let argsObj = tryParseJsonRecord(body);
    if (argsObj && typeof argsObj.name === "string" && argsObj.arguments && typeof argsObj.arguments === "object") {
      argsObj = argsObj.arguments as Record<string, unknown>;
    }
    if (!argsObj && /<parameter\s+/i.test(body)) {
      argsObj = parseXmlParameters(body);
    }
    const call = tryBuildCall(attrToolName, argsObj ?? {});
    if (call) {
      hits.push({ index: m.index, call });
    }
  }

  // 3. Blocos fenced markdown ```tool_call ... ``` ou ```execute ... ```
  const fencedRegex = /```(?:tool_call|execute)\s*\r?\n([\s\S]*?)```/gi;
  while ((m = fencedRegex.exec(text)) !== null) {
    const parsed = tryParseJsonPayloadCall(m[1]);
    if (parsed) {
      hits.push({ index: m.index, call: parsed });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => h.call);
}

const UNPARSED_TOOL_TAG_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  { label: "<execute>", regex: /<execute\b[^>]*>[\s\S]*?<\/execute>/gi },
  { label: "<tool_call>", regex: /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi },
  { label: "<function_call>", regex: /<function_call\b[^>]*>[\s\S]*?<\/function_call>/gi },
  { label: "<invoke>", regex: /<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi },
  { label: "```execute", regex: /```(?:tool_call|execute)\b[\s\S]*?```/gi },
  { label: "<execute>", regex: /<(?:execute|tool_call|function_call|invoke)\b[^>]*>/gi },
];

/**
 * Detecta marcações literais de tool (`<execute>`, `<tool_call>`, etc.) que não resultaram
 * em nenhuma chamada executável válida e gera texto sanitizado sem vazar XML ao usuário.
 */
export function detectUnparsedTextToolAttempt(text: string): {
  detected: boolean;
  matchedTag: string | null;
  sanitizedText: string;
} {
  const source = String(text ?? "");
  if (!source.trim() || parseTextToolCalls(source).length > 0) {
    return { detected: false, matchedTag: null, sanitizedText: source };
  }

  let matchedTag: string | null = null;
  let cleaned = source;

  for (const { label, regex } of UNPARSED_TOOL_TAG_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(cleaned)) {
      if (!matchedTag) matchedTag = label;
      regex.lastIndex = 0;
      cleaned = cleaned.replace(regex, " ");
    }
  }

  cleaned = cleaned
    .replace(/<\/(?:execute|tool_call|function_call|invoke|parameter)>/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    detected: matchedTag !== null,
    matchedTag,
    sanitizedText: cleaned,
  };
}
