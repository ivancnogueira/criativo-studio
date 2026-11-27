import type { ToolDefinition } from "@criativo/contracts";

export interface IndexedToolSummary {
  name: string;
  origin: "native" | "mcp";
  category: string;
  summary: string;
  definition: ToolDefinition;
}

export const LAZY_META_TOOL_NAMES = new Set(["tool_search", "tool_describe", "tool_call"]);

export const DEFAULT_CORE_EXPOSED_TOOLS = new Set<string>([
  "enviar_mensagem_agente",
  "handoff_agente",
  "start_task",
  "wait_for",
  "ask_user",
  "send_acknowledge_request",
  "send_ui_block",
  "buscar_memorias",
  "salvar_memoria",
  "pesquisar_historico",
  "ler_arquivo",
  "listar_arquivos",
  "meta_publicar",
  "generate_image",
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
      "Busca ferramentas secundárias (nativas ou MCP) por palavra-chave ou categoria, retornando apenas nome e resumo curto para economizar tokens.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Palavra-chave da ação desejada." },
        categoria: { type: "string", description: "Filtro opcional (browser, meta, workflow, rotina, arquivos, mcp, etc.)." },
        limite: { type: "number", description: "Máximo de resultados (padrão 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_describe",
    description: "Retorna o schema completo de parâmetros JSON de uma ferramenta autorizada encontrada via tool_search.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Nome exato da ferramenta." },
      },
      required: ["tool_name"],
    },
  },
  {
    name: "tool_call",
    description:
      "Executa uma ferramenta secundária autorizada após validar parâmetros, respeitando todas as permissões do agente.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Nome exato da ferramenta." },
        arguments: { type: "object", description: "Objeto JSON com os parâmetros da ferramenta." },
      },
      required: ["tool_name"],
    },
  },
];

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
  )
    return "rotina";
  if (lower.includes("whatsapp")) return "whatsapp";
  if (lower.includes("tabela") || lower.includes("sql")) return "dados";
  if (lower.includes("image") || lower.includes("video") || lower.includes("remotion")) return "midia";
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
    this.threshold = Math.max(1, options.threshold ?? 20);
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

  public search(params: { query?: string; categoria?: string; limite?: number }): Array<{
    name: string;
    origin: "native" | "mcp";
    category: string;
    summary: string;
  }> {
    const tokens = String(params.query ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const catFilter = params.categoria?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(25, Number(params.limite) || 8));

    const scored: Array<{ entry: IndexedToolSummary; score: number }> = [];
    for (const entry of this.orderedEntries) {
      if (catFilter && entry.category !== catFilter) continue;
      if (tokens.length === 0) {
        scored.push({ entry, score: 1 });
        continue;
      }
      const hay = `${entry.name} ${entry.category} ${entry.summary}`.toLowerCase();
      let matches = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) {
          matches += entry.name.toLowerCase().includes(tok) ? 3 : 1;
        }
      }
      if (matches > 0) {
        scored.push({ entry, score: matches });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
    return scored.slice(0, limit).map(({ entry }) => ({
      name: entry.name,
      origin: entry.origin,
      category: entry.category,
      summary: entry.summary,
    }));
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

  public validateCall(toolName: string, rawArgs: unknown): {
    toolName: string;
    arguments: Record<string, unknown>;
  } {
    const def = this.describe(toolName);
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
        query: typeof rawArgs.query === "string" ? rawArgs.query : "",
        categoria: typeof rawArgs.categoria === "string" ? rawArgs.categoria : undefined,
        limite: typeof rawArgs.limite === "number" ? rawArgs.limite : undefined,
      });
      return {
        ok: true,
        total_indexed: this.orderedEntries.length,
        resultados: results,
      };
    }

    if (metaName === "tool_describe") {
      const toolName = String(rawArgs.tool_name ?? rawArgs.name ?? "");
      const schema = this.describe(toolName);
      return { ok: true, schema };
    }

    if (metaName === "tool_call") {
      const targetName = String(rawArgs.tool_name ?? rawArgs.name ?? "");
      const validated = this.validateCall(targetName, rawArgs.arguments);
      return await dispatchFn(validated.toolName, validated.arguments);
    }

    throw new Error(`Meta-ferramenta desconhecida: ${metaName}`);
  }
}
