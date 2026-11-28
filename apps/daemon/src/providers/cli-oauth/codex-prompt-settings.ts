import { createHash } from "node:crypto";

/**
 * Habilidades internas do Codex CLI sem utilidade no CriativoOS (padrão OpenBot).
 * Mantém a janela de entrada enxuta em todos os turnos Codex.
 */
export const CODEX_UNFIT_SKILLS = [
  "openai-docs",
  "plugin-management:plugin-management",
  "work-pets:create-pet",
  "work-pets:pets",
  "work-pets:update-pet",
] as const;

export const CODEX_LIGHT_BASE_INSTRUCTIONS =
  "Você é um assistente criativo do CriativoOS. Responda apenas em texto em pt-br de forma breve, natural e direta. Não execute comandos nem ferramentas.";

export const CODEX_ACTION_BASE_INSTRUCTIONS =
  "Você é um especialista do CriativoOS. Responda em pt-br com objetividade. Use exclusivamente as ferramentas MCP disponibilizadas quando realmente precisar consultar ou agir no estúdio; nunca invente dados ou resultados de ferramentas.";

export const CODEX_LIGHT_FEATURES: Record<string, boolean> = {
  shell_tool: false,
  unified_exec: false,
  apply_patch_freeform: false,
  apps: false,
  plugins: false,
  hooks: false,
  codex_hooks: false,
  multi_agent: false,
  js_repl: false,
  browser_use: false,
  computer_use: false,
  image_generation: false,
  memories: false,
  memory_tool: false,
  view_image: false,
  code_mode: false,
  code_mode_host: false,
  in_app_browser: false,
  in_app_local_automation: false,
  remote_plugin: false,
  collab: false,
  multi_agent_v2: false,
  goals: false,
  tool_search: false,
  tool_suggest: false,
  recommended_plugins: false,
  search_tool: false,
  sleep_tool: false,
  web_search: false,
  standalone_web_search: false,
};

export const CODEX_ACTION_DISABLED_PLUGINS: Record<string, boolean> = {
  "plugins.computer-use@openai-bundled.enabled": false,
  "plugins.unified-computer-use@openai-bundled.enabled": false,
  "plugins.browser@openai-bundled.enabled": false,
  "plugins.chrome@openai-bundled.enabled": false,
  "plugins.chrome-dev@openai-bundled.enabled": false,
  "plugins.chrome-internal@openai-bundled.enabled": false,
};

export const CODEX_TOOL_ITEM_TYPES = new Set<string>([
  "mcpToolCall",
  "mcp_tool_call",
  "toolCall",
  "tool_call",
  "dynamicToolCall",
  "dynamic_tool_call",
  "commandExecution",
  "command_execution",
  "fileChange",
  "file_change",
  "webSearch",
  "web_search",
  "imageView",
  "image_view",
  "collabAgentToolCall",
  "collab_agent_tool_call",
]);

/**
 * Permite exibir apenas itens que representam chamadas reais de ferramenta/execução,
 * filtrando mensagens internas do protocolo (`userMessage`, `reasoning`, `plan`, `contextCompaction`).
 */
export function isCodexToolItemType(itemType: string): boolean {
  return CODEX_TOOL_ITEM_TYPES.has(String(itemType ?? "").trim());
}

/**
 * Monta payload de `thread/start` adaptado para `light` (prompt base compacto, esforço baixo
 * e todas as features/plugins nativos desligados) ou `action` (MCP sob demanda enxuto).
 */
export function buildCodexThreadStartParams(input: {
  modelId: string;
  cwd: string;
  systemPrompt?: string;
  turnMode?: "light" | "action";
  effort?: string | null;
}): Record<string, unknown> {
  const skillsConfig = CODEX_UNFIT_SKILLS.map((name) => ({ name, enabled: false }));
  const developerPart = input.systemPrompt ? { developerInstructions: input.systemPrompt } : {};

  if (input.turnMode === "light") {
    return {
      model: input.modelId,
      cwd: input.cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      effort: "low",
      dynamicTools: [],
      baseInstructions: CODEX_LIGHT_BASE_INSTRUCTIONS,
      ...developerPart,
      config: {
        web_search: "disabled",
        agents: { enabled: false },
        features: CODEX_LIGHT_FEATURES,
        project_doc_max_bytes: 0,
        "skills.include_instructions": false,
        include_permissions_instructions: false,
        include_environment_context: false,
        include_collaboration_mode_instructions: false,
        "tools.update_plan.enabled": false,
        "tools.experimental_request_user_input.enabled": false,
        "skills.config": skillsConfig,
        ...CODEX_ACTION_DISABLED_PLUGINS,
      },
    };
  }

  return {
    model: input.modelId,
    cwd: input.cwd,
    sandbox: "read-only",
    approvalPolicy: "never",
    ...(input.effort ? { effort: input.effort } : {}),
    baseInstructions: CODEX_ACTION_BASE_INSTRUCTIONS,
    ...developerPart,
    config: {
      project_doc_max_bytes: 0,
      include_permissions_instructions: false,
      include_collaboration_mode_instructions: false,
      "features.tool_suggest": false,
      "features.recommended_plugins": false,
      "features.goals": false,
      "features.request_permissions_tool": false,
      "tools.experimental_request_user_input.enabled": false,
      "skills.config": skillsConfig,
      ...CODEX_ACTION_DISABLED_PLUGINS,
    },
  };
}

export interface CodexOverridesOptions {
  mcpConfig?: Record<string, unknown> | null;
  turnMode?: "light" | "action";
  disableAgents?: boolean;
}

/**
 * Constrói argumentos `-c` oficiais do Codex CLI para:
 * 1) desativar sugestões de plugins/apps internos (`tool_suggest`, `recommended_plugins`);
 * 2) desabilitar descoberta pesada de `AGENTS.md` (`project_doc_max_bytes=0`) e multi-agente/tools em modo `light`;
 * 3) registrar servidores MCP apenas quando o turno precisa de ferramentas (`turnMode !== "light"`).
 */
export function buildCodexConfigOverrideArgs(options: CodexOverridesOptions): string[] {
  const args: string[] = [
    "-c",
    "features.tool_suggest=false",
    "-c",
    "features.recommended_plugins=false",
    "-c",
    "project_doc_max_bytes=0",
  ];

  if (options.turnMode === "light" || options.disableAgents) {
    args.push("-c", "agents.enabled=false");
  }

  if (options.turnMode === "light") {
    args.push(
      "-c",
      'web_search="disabled"',
      "-c",
      "features.apps=false",
      "-c",
      "features.plugins=false",
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.unified_exec=false",
      "-c",
      "features.apply_patch_freeform=false",
      "-c",
      "features.code_mode=false",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.memories=false"
    );
    return args;
  }

  args.push("-c", "features.goals=false", "-c", "features.request_permissions_tool=false");

  const rawMcpServers =
    options.mcpConfig &&
    typeof options.mcpConfig === "object" &&
    options.mcpConfig.mcpServers &&
    typeof options.mcpConfig.mcpServers === "object"
      ? (options.mcpConfig.mcpServers as Record<string, Record<string, unknown>>)
      : null;

  if (!rawMcpServers) {
    return args;
  }

  for (const [srvName, srvSpec] of Object.entries(rawMcpServers)) {
    const safeKey = srvName.replace(/[^a-zA-Z0-9_]/g, "_");
    if (!safeKey || !srvSpec || typeof srvSpec !== "object") continue;
    if (typeof srvSpec.url === "string" && srvSpec.url.trim()) {
      args.push("-c", `mcp_servers.${safeKey}.url=${JSON.stringify(srvSpec.url.trim())}`);
      if (srvSpec.headers && typeof srvSpec.headers === "object" && !Array.isArray(srvSpec.headers)) {
        const entries = Object.entries(srvSpec.headers as Record<string, unknown>).filter(
          ([k, v]) => k.trim().length > 0 && typeof v === "string"
        );
        if (entries.length > 0) {
          const headerToml = entries
            .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(String(v))}`)
            .join(", ");
          args.push("-c", `mcp_servers.${safeKey}.http_headers={ ${headerToml} }`);
        }
      }
    } else if (typeof srvSpec.command === "string" && srvSpec.command.trim()) {
      args.push("-c", `mcp_servers.${safeKey}.command=${JSON.stringify(srvSpec.command.trim())}`);
      if (Array.isArray(srvSpec.args)) {
        args.push("-c", `mcp_servers.${safeKey}.args=${JSON.stringify(srvSpec.args.map(String))}`);
      }
    }
  }

  return args;
}

/**
 * Gera impressão digital determinística da configuração ativa do Codex.
 * Mudanças de modelo, modo (`light`/`action`), prompt base ou MCPs renovam a sessão limpa.
 */
export function computeCodexSessionFingerprint(input: {
  modelId: string;
  systemPrompt?: string;
  mcpConfig?: Record<string, unknown> | null;
  turnMode?: "light" | "action";
}): string {
  const hash = createHash("sha256");
  hash.update(String(input.modelId ?? "").trim());
  hash.update("\0");
  hash.update(String(input.turnMode ?? "action"));
  hash.update("\0");
  hash.update(String(input.systemPrompt ?? ""));
  hash.update("\0");
  hash.update(JSON.stringify(input.turnMode === "light" ? null : (input.mcpConfig ?? null)));
  return hash.digest("hex").slice(0, 16);
}
