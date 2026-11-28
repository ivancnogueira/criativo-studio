import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type CliEffortLevel = "low" | "medium" | "high";

export interface UniversalTurnPolicyInput {
  turnMode: "light" | "action";
  configuredEffort?: string | null;
  channelOrigin?: "web" | "whatsapp";
  agentName?: string;
  promptBase: string;
  studioToolsPromptGuidance?: string;
}

export interface UniversalTurnPolicy {
  mode: "light" | "action";
  historyLimit: number;
  historyMaxChars: number;
  effectiveEffort: string | undefined;
  cliEffort: CliEffortLevel | undefined;
  systemPrompt: string;
  includeTools: boolean;
  includeMcpServers: boolean;
  isolateCwd: boolean;
  maxOutputTokens?: number;
}

/**
 * Converte níveis de esforço do estúdio (`baixo`/`medio`/`alto` ou equivalentes em inglês)
 * para o padrão aceito pelos executáveis CLI (`low`/`medium`/`high`).
 */
export function mapEffortToCliLevel(raw?: string | null): CliEffortLevel | undefined {
  const clean = String(raw ?? "").trim().toLowerCase();
  if (!clean) return undefined;
  if (clean === "baixo" || clean === "low") return "low";
  if (clean === "medio" || clean === "médio" || clean === "medium") return "medium";
  if (clean === "alto" || clean === "high" || clean === "max" || clean === "xhigh") return "high";
  return undefined;
}

/**
 * Resolve de forma uniforme para todos os motores (Codex, Claude, Antigravity/Gemini,
 * OpenCode, APIs diretas e modelos locais) o orçamento de histórico, esforço de raciocínio,
 * isolamento de diretório, diretriz de prompt e exposição de ferramentas/MCPs.
 */
export function resolveUniversalTurnPolicy(input: UniversalTurnPolicyInput): UniversalTurnPolicy {
  const base = String(input.promptBase ?? "").trim();

  if (input.turnMode === "light") {
    const directive =
      input.channelOrigin === "whatsapp"
        ? "Responda em pt-br de forma breve e natural para celular. Não invente dados ou marcas reais."
        : "Responda em pt-br de forma breve, natural e direta. Não invente dados ou marcas reais.";

    return {
      mode: "light",
      historyLimit: 2,
      historyMaxChars: 300,
      effectiveEffort: "baixo",
      cliEffort: "low",
      systemPrompt: base ? `${base}\n${directive}` : directive,
      includeTools: false,
      includeMcpServers: false,
      isolateCwd: true,
      maxOutputTokens: 384,
    };
  }

  const configured = input.configuredEffort?.trim() || undefined;
  const toolsGuidance = input.studioToolsPromptGuidance ?? "";
  const agentRoleSuffix = input.agentName?.trim() ? ` como ${input.agentName.trim()}` : "";
  const actionDirective =
    input.channelOrigin === "whatsapp"
      ? `Responda em pt-br com objetividade para celular (sem tabelas Markdown e sem cabeçalhos #). Nunca invente handles ou marcas reais.${toolsGuidance}`
      : `Responda em pt-br de forma prática e especializada${agentRoleSuffix}. Use tabelas Markdown quando útil. Nunca invente handles ou marcas reais.${toolsGuidance}`;

  return {
    mode: "action",
    historyLimit: 6,
    historyMaxChars: 1200,
    effectiveEffort: configured,
    cliEffort: mapEffortToCliLevel(configured),
    systemPrompt: base ? `${base}\n${actionDirective}` : actionDirective,
    includeTools: true,
    includeMcpServers: true,
    isolateCwd: false,
    maxOutputTokens: undefined,
  };
}

/**
 * Garante um diretório de trabalho vazio isolado (`.light-cwd`) para que motores CLI/ACP
 * em modo leve não varram arquivos de instruções ou repositórios do workspace.
 */
export function ensureIsolatedLightCwd(baseDir: string): string {
  const dir = join(baseDir, ".light-cwd");
  mkdirSync(dir, { recursive: true });
  return dir;
}
