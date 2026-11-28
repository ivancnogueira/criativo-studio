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

export interface CodexOverridesOptions {
  mcpConfig?: Record<string, unknown> | null;
  turnMode?: "light" | "action";
  disableAgents?: boolean;
}

/**
 * Constrói argumentos `-c` oficiais do Codex CLI para:
 * 1) desativar sugestões de plugins/apps internos (`tool_suggest`, `recommended_plugins`);
 * 2) desabilitar multi-agente nativo em modo `light` (`agents.enabled=false`);
 * 3) registrar servidores MCP apenas quando o turno precisa de ferramentas (`turnMode !== "light"`).
 */
export function buildCodexConfigOverrideArgs(options: CodexOverridesOptions): string[] {
  const args: string[] = [
    "-c",
    "features.tool_suggest=false",
    "-c",
    "features.recommended_plugins=false",
  ];

  if (options.turnMode === "light" || options.disableAgents) {
    args.push("-c", "agents.enabled=false");
  }

  if (options.turnMode === "light") {
    return args;
  }

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
