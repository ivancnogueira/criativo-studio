import type { ToolDefinition } from "@criativo/contracts";
import { getToolGuidanceForNames } from "./tool-guidance-registry.ts";

export interface IndexedToolSummary {
  name: string;
  origin: "native" | "mcp";
  category: string;
  summary: string;
  definition: ToolDefinition;
}

export const LAZY_META_TOOL_NAMES = new Set(["tool_search", "tool_describe", "tool_call"]);

/**
 * Núcleo mínimo de ferramentas expostas diretamente quando o roteamento preguiçoso está ativo.
 * Mantém ferramentas essenciais de interação, memória e controle assíncrono de longa duração.
 */
export const DEFAULT_CORE_EXPOSED_TOOLS = new Set<string>([
  "load_skill",
  "ask_user",
  "ask_ui",
  "attach_files_to_response",
  "list_agents",
  "send_message",
  "enviar_mensagem_agente",
  "handoff_agente",
  "start_task",
  "wait_for",
  "send_acknowledge_request",
  "send_ui_block",
  "memory_recall",
  "remember",
  "forget_memory",
  "buscar_memorias",
  "salvar_memoria",
  "pesquisar_historico",
  "ler_arquivo",
  "listar_arquivos",
  "generate_image",
  "request_api_key",
  "schedule_wakeup",
  "list_wakeups",
  "cancel_wakeup",
  "start_background_job",
  "list_background_jobs",
  "get_background_job",
  "cancel_background_job",
]);

export const LAZY_META_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "tool_search",
    description:
      "Busca ferramentas secundárias (nativas ou MCP) por palavra-chave (`query` ou `queries`) ou categoria. Retorna resumos curtos e, para os até 3 melhores matches fortes, já inclui `inputSchema` + guia de uso.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Palavra-chave da ação desejada." },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Lista opcional de consultas curtas (alternativa a `query`).",
        },
        categoria: { type: "string", description: "Filtro opcional (browser, meta, workflow, rotina, arquivos, mcp, midia, dados)." },
        limite: { type: "number", description: "Máximo de resultados (padrão 5, máximo 10)." },
      },
    },
  },
  {
    name: "tool_describe",
    description: "Carrega schema JSON completo e guia de uso para 1 ou até 10 ferramentas encontradas via tool_search (`tool_name`, `name` ou `names`).",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Nome exato da ferramenta." },
        name: { type: "string", description: "Alias opcional para tool_name." },
        names: {
          type: "array",
          items: { type: "string" },
          description: "Lista com até 10 nomes exatos de ferramentas.",
        },
      },
    },
  },
  {
    name: "tool_call",
    description:
      "Executa uma ferramenta secundária autorizada pelo nome (`tool_name` ou `name`) e argumentos JSON, respeitando todas as permissões do agente.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Nome exato da ferramenta." },
        name: { type: "string", description: "Alias opcional para tool_name." },
        arguments: { type: "object", description: "Objeto JSON com os parâmetros da ferramenta." },
      },
    },
  },
];

const GENERIC_SEARCH_VERBS = new Set(["get", "list", "read", "run", "set", "update", "create", "delete", "ver", "listar", "ler", "criar", "abrir"]);

function inferToolCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("mcp_")) return "mcp";
  if (lower.includes("browser") || lower.includes("url") || lower.includes("cua_")) return "browser";
  if (lower.includes("meta_") || lower.includes("instagram")) return "meta";
  if (lower.includes("workflow")) return "workflow";
  if (
    lower.includes("rotina") ||
    lower.includes("routine") ||
    lower.includes("wakeup") ||
    lower.includes("background_job")
  ) {
    return "rotina";
  }
  if (lower.includes("whatsapp") || lower.startsWith("messaging_")) return "whatsapp";
  if (lower.includes("tabela") || lower.includes("table") || lower.includes("sql") || lower.includes("_data")) return "dados";
  if (lower.includes("image") || lower.includes("video") || lower.includes("remotion") || lower.includes("ffmpeg")) return "midia";
  return "geral";
}

function summarizeOneLine(text: string): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 120) return clean;
  return `${clean.slice(0, 117)}...`;
}

export class LazyToolRouter {
  private readonly index = new Map<string, IndexedToolSummary>();
  private readonly orderedEntries: IndexedToolSummary[] = [];
  private readonly coreNames: Set<string>;
  private readonly threshold: number;
  private readonly enabled: boolean;

  constructor(
    authorizedTools: ToolDefinition[],
    options: {
      coreNames?: Set<string>;
      threshold?: number;
      enabled?: boolean;
    } = {}
  ) {
    this.coreNames = options.coreNames ?? DEFAULT_CORE_EXPOSED_TOOLS;
    this.threshold = Math.max(1, options.threshold ?? 12);
    this.enabled = options.enabled !== false;

    for (const tool of authorizedTools) {
      if (!tool?.name || LAZY_META_TOOL_NAMES.has(tool.name) || this.index.has(tool.name)) {
        continue;
      }
      const entry: IndexedToolSummary = {
        name: tool.name,
        origin: tool.name.startsWith("mcp_") ? "mcp" : "native",
        category: inferToolCategory(tool.name),
        summary: summarizeOneLine(tool.description || tool.name),
        definition: tool,
      };
      this.index.set(tool.name, entry);
      this.orderedEntries.push(entry);
    }
  }

  public isLazyActive(): boolean {
    return this.enabled && this.orderedEntries.length > this.threshold;
  }

  public getTotalIndexed(): number {
    return this.orderedEntries.length;
  }

  /**
   * Retorna todas as tools se estiver abaixo do limiar (ou desativado),
   * ou apenas o conjunto core + (`tool_search`, `tool_describe`, `tool_call`).
   */
  public selectExposedTools(): ToolDefinition[] {
    if (!this.isLazyActive()) {
      return this.orderedEntries.map((e) => e.definition);
    }

    const exposed: ToolDefinition[] = [];
    for (const entry of this.orderedEntries) {
      if (this.coreNames.has(entry.name)) {
        exposed.push(entry.definition);
      }
    }
    return [...exposed, ...LAZY_META_TOOLS_SCHEMA];
  }

  public search(params: {
    query?: string;
    queries?: string[];
    categoria?: string;
    limite?: number;
  }): Array<{
    name: string;
    origin: "native" | "mcp";
    category: string;
    summary: string;
    inputSchema?: ToolDefinition["parameters"];
  }> {
    const queryStrings = [
      ...(typeof params.query === "string" ? [params.query] : []),
      ...(Array.isArray(params.queries) ? params.queries.filter((q): q is string => typeof q === "string") : []),
    ];
    const tokens = Array.from(
      new Set(
        queryStrings
          .join(" ")
          .toLowerCase()
          .split(/[^a-z0-9_áàãâéêíóôõúç]+/i)
          .filter(Boolean)
      )
    );
    const catFilter = params.categoria?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(10, Number(params.limite) || 5));

    const scored: Array<{ entry: IndexedToolSummary; score: number; strong: boolean }> = [];
    for (const entry of this.orderedEntries) {
      if (catFilter && entry.category !== catFilter) continue;
      if (tokens.length === 0) {
        scored.push({ entry, score: 1, strong: false });
        continue;
      }
      const lowerName = entry.name.toLowerCase();
      const nameParts = lowerName.split("_").filter(Boolean);
      const hay = `${entry.name} ${entry.category} ${entry.summary}`.toLowerCase();

      const exactNameHit = queryStrings.some((q) => q.trim().toLowerCase() === lowerName);
      let matches = exactNameHit ? 20 : 0;
      let nonGenericNameHits = 0;

      for (const tok of tokens) {
        if (hay.includes(tok)) {
          const inName = lowerName.includes(tok);
          matches += inName ? 4 : 1;
          if (inName && !GENERIC_SEARCH_VERBS.has(tok)) {
            nonGenericNameHits += 1;
          }
        }
      }

      const allNameWordsMatched =
        tokens.length >= 1 &&
        nonGenericNameHits > 0 &&
        nameParts.every((part) => GENERIC_SEARCH_VERBS.has(part) || tokens.some((tok) => part.includes(tok)));

      if (matches > 0) {
        scored.push({
          entry,
          score: matches,
          strong: exactNameHit || allNameWordsMatched || nonGenericNameHits >= 2,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
    let strongIncluded = 0;
    return scored.slice(0, limit).map(({ entry, strong }) => {
      const includeSchema = (strong || strongIncluded === 0) && strongIncluded < 3;
      if (includeSchema) {
        strongIncluded += 1;
      }
      return {
        name: entry.name,
        origin: entry.origin,
        category: entry.category,
        summary: entry.summary,
        ...(includeSchema ? { inputSchema: entry.definition.parameters } : {}),
      };
    });
  }

  public describe(toolName: string): ToolDefinition {
    const clean = String(toolName ?? "").trim();
    const found = this.index.get(clean);
    if (!found) {
      throw new Error(
        `[CRV-AUTH-002] Ferramenta '${clean}' não está disponível ou não autorizada para este agente.`
      );
    }
    return found.definition;
  }

  public describeMany(toolNames: string[]): {
    schemas: ToolDefinition[];
    guidance: string[];
  } {
    const uniqueNames = Array.from(
      new Set(toolNames.map((n) => String(n ?? "").trim()).filter(Boolean))
    ).slice(0, 10);
    const schemas = uniqueNames.map((n) => this.describe(n));
    return {
      schemas,
      guidance: getToolGuidanceForNames(uniqueNames),
    };
  }

  public validateCall(toolName: string, rawArgs: unknown): {
    toolName: string;
    arguments: Record<string, unknown>;
  } {
    const cleanTarget = String(toolName ?? "").trim();
    if (LAZY_META_TOOL_NAMES.has(cleanTarget)) {
      throw new Error(`Chamada recursiva proibida para meta-ferramenta '${cleanTarget}'.`);
    }
    const def = this.describe(cleanTarget);
    const args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const requiredFields = Array.isArray((def.parameters as { required?: unknown })?.required)
      ? ((def.parameters as { required: string[] }).required)
      : [];
    for (const reqField of requiredFields) {
      if (args[reqField] === undefined) {
        throw new Error(`Parâmetro obrigatório ausente para '${def.name}': '${reqField}'.`);
      }
    }
    return { toolName: def.name, arguments: args };
  }

  public async executeMetaTool(
    metaName: string,
    rawArgs: Record<string, unknown>,
    dispatchFn: (targetToolName: string, targetArgs: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    if (metaName === "tool_search") {
      const results = this.search({
        query: typeof rawArgs.query === "string" ? rawArgs.query : undefined,
        queries: Array.isArray(rawArgs.queries)
          ? rawArgs.queries.filter((q): q is string => typeof q === "string")
          : undefined,
        categoria: typeof rawArgs.categoria === "string" ? rawArgs.categoria : undefined,
        limite: typeof rawArgs.limite === "number" ? rawArgs.limite : undefined,
      });
      const schemaNames = results.filter((r) => Boolean(r.inputSchema)).map((r) => r.name);
      const guidance = getToolGuidanceForNames(schemaNames);
      return {
        ok: true,
        total_indexed: this.orderedEntries.length,
        resultados: results,
        ...(guidance.length > 0 ? { guidance } : {}),
        call_instruction: "Execute ferramentas encontradas usando `tool_call` com `tool_name` (ou `name`) e `arguments`.",
      };
    }

    if (metaName === "tool_describe") {
      const rawNames = Array.isArray(rawArgs.names)
        ? rawArgs.names.map(String)
        : [String(rawArgs.tool_name ?? rawArgs.name ?? "")];
      if (rawNames.length === 1) {
        const schema = this.describe(rawNames[0]!);
        const guidance = getToolGuidanceForNames([schema.name]);
        return { ok: true, schema, ...(guidance.length > 0 ? { guidance } : {}) };
      }
      const multi = this.describeMany(rawNames);
      return { ok: true, schemas: multi.schemas, ...(multi.guidance.length > 0 ? { guidance: multi.guidance } : {}) };
    }

    if (metaName === "tool_call") {
      const targetName = String(rawArgs.tool_name ?? rawArgs.name ?? rawArgs.tool ?? "");
      const validated = this.validateCall(targetName, rawArgs.arguments);
      return await dispatchFn(validated.toolName, validated.arguments);
    }

    throw new Error(`Meta-ferramenta desconhecida: ${metaName}`);
  }
}
