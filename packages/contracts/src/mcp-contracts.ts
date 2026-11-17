/**
 * Contratos compartilhados, normalizadores e validadores puros de servidores MCP e OAuth 2.1.
 * Garantem paridade estrita entre os formulários React e a persistência/gateway no daemon.
 */

export type McpTransporte = "stdio" | "http";

export type McpOAuthStatus = "disconnected" | "signing_in" | "connected" | "lost";

export interface McpAcessoAgentes {
  mode: "everyone" | "agents";
  agentIds: string[];
}

export interface McpServidorConfig {
  mcp_id: string;
  nome: string;
  transporte: McpTransporte;
  comando: string;
  args: string[];
  env: Record<string, string>;
  envPassthrough: string[];
  workingDirectory: string | null;
  url: string | null;
  headers: Record<string, string>;
  acesso: McpAcessoAgentes;
  origemAppSlug: string | null;
  contaRotulo: string | null;
  posicao: number;
  ativo: boolean;
  ultimoTesteEm: string | null;
  ultimoErro: string | null;
  qtdFerramentas: number;
  oauthStatus: McpOAuthStatus;
  atualizadoEm: string;
}

export interface McpProbeResultado {
  status: "passed" | "failed" | "needs_sign_in" | "needs_key";
  toolCount: number;
  toolNames: string[];
  needs: "sign_in" | "key" | null;
  error?: string;
  authUrl?: string;
  durationMs?: number;
}

export interface McpOAuthMetadataSummary {
  resource?: string | null;
  authorizationServer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string | null;
  registrationEndpoint?: string | null;
  revocationEndpoint?: string | null;
  scopesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
}

export interface McpOAuthAccountView {
  conta_chave: string;
  mcp_id: string;
  app_slug: string | null;
  servidor_url: string;
  issuer_url: string | null;
  escopos: string[];
  status: McpOAuthStatus;
  expira_em: string | null;
  obtido_em: string;
  perdido_em: string | null;
  atualizado_em: string;
}

function sanitizeStringRecord(record: Record<string, string> | undefined): Record<string, string> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key || typeof rawValue !== "string") {
      continue;
    }
    normalized[key] = rawValue;
  }
  return normalized;
}

function sanitizeStringArray(values: string[] | undefined, deduplicate = false): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const cleaned = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return deduplicate ? Array.from(new Set(cleaned)) : cleaned;
}

function normalizeAcesso(acesso: Partial<McpAcessoAgentes> | undefined): McpAcessoAgentes {
  const mode = acesso?.mode === "agents" ? "agents" : "everyone";
  const agentIds = sanitizeStringArray(acesso?.agentIds, true);
  return {
    mode,
    agentIds: mode === "everyone" ? [] : agentIds,
  };
}

function isValidOAuthStatus(status: unknown): status is McpOAuthStatus {
  return (
    status === "disconnected" ||
    status === "signing_in" ||
    status === "connected" ||
    status === "lost"
  );
}

/**
 * Normaliza um rascunho ou registro parcial de servidor MCP para formato canônico seguro.
 */
export function normalizeMcpConfig(input: Partial<McpServidorConfig>): McpServidorConfig {
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  const rawComando = typeof input.comando === "string" ? input.comando.trim() : "";
  const transporte: McpTransporte =
    input.transporte === "http"
      ? "http"
      : input.transporte === "stdio"
        ? "stdio"
        : rawUrl.length > 0 && rawComando.length === 0
          ? "http"
          : "stdio";

  const workingDirectory =
    typeof input.workingDirectory === "string" && input.workingDirectory.trim().length > 0
      ? input.workingDirectory.trim()
      : null;

  const origemAppSlug =
    typeof input.origemAppSlug === "string" && input.origemAppSlug.trim().length > 0
      ? input.origemAppSlug.trim()
      : null;

  const contaRotulo =
    typeof input.contaRotulo === "string" && input.contaRotulo.trim().length > 0
      ? input.contaRotulo.trim()
      : null;

  const ultimoTesteEm =
    typeof input.ultimoTesteEm === "string" && input.ultimoTesteEm.trim().length > 0
      ? input.ultimoTesteEm.trim()
      : null;

  const ultimoErro =
    typeof input.ultimoErro === "string" && input.ultimoErro.trim().length > 0
      ? input.ultimoErro.trim()
      : null;

  return {
    mcp_id: typeof input.mcp_id === "string" ? input.mcp_id.trim() : "",
    nome: typeof input.nome === "string" ? input.nome.trim() : "",
    transporte,
    comando: transporte === "stdio" ? rawComando : "",
    args: transporte === "stdio" ? sanitizeStringArray(input.args, false) : [],
    env: sanitizeStringRecord(input.env),
    envPassthrough: sanitizeStringArray(input.envPassthrough, true),
    workingDirectory: transporte === "stdio" ? workingDirectory : null,
    url: transporte === "http" ? (rawUrl.length > 0 ? rawUrl : null) : null,
    headers: transporte === "http" ? sanitizeStringRecord(input.headers) : {},
    acesso: normalizeAcesso(input.acesso),
    origemAppSlug,
    contaRotulo,
    posicao:
      typeof input.posicao === "number" && Number.isFinite(input.posicao)
        ? Math.max(0, Math.trunc(input.posicao))
        : 0,
    ativo: typeof input.ativo === "boolean" ? input.ativo : true,
    ultimoTesteEm,
    ultimoErro,
    qtdFerramentas:
      typeof input.qtdFerramentas === "number" && Number.isFinite(input.qtdFerramentas)
        ? Math.max(0, Math.trunc(input.qtdFerramentas))
        : 0,
    oauthStatus: isValidOAuthStatus(input.oauthStatus) ? input.oauthStatus : "disconnected",
    atualizadoEm:
      typeof input.atualizadoEm === "string" && input.atualizadoEm.trim().length > 0
        ? input.atualizadoEm.trim()
        : new Date().toISOString(),
  };
}

/**
 * Valida campos obrigatórios de configuração MCP STDIO/HTTP e escopo de agentes.
 * Retorna mapa campo -> mensagem amigável em pt-BR (vazio quando válido).
 */
export function mcpConfigErrors(config: Partial<McpServidorConfig>): Record<string, string> {
  const errors: Record<string, string> = {};
  const nome = typeof config.nome === "string" ? config.nome.trim() : "";
  const rawComando = typeof config.comando === "string" ? config.comando.trim() : "";
  const rawUrl = typeof config.url === "string" ? config.url.trim() : "";
  const transporte: McpTransporte =
    config.transporte === "http"
      ? "http"
      : config.transporte === "stdio"
        ? "stdio"
        : rawUrl.length > 0 && rawComando.length === 0
          ? "http"
          : "stdio";

  if (!nome) {
    errors.nome = "Informe um nome identificador para o servidor MCP.";
  }

  if (transporte === "stdio") {
    if (!rawComando) {
      errors.comando = "Informe o comando executável para o transporte STDIO (ex.: npx ou node).";
    } else if (/^https?:\/\//i.test(rawComando)) {
      errors.comando =
        "URLs http:// ou https:// não são comandos STDIO válidos. Selecione o transporte Streamable HTTP.";
    }
  } else {
    if (!rawUrl) {
      errors.url = "Informe a URL do endpoint MCP Streamable HTTP.";
    } else {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.url = "A URL do servidor MCP deve usar o protocolo http:// ou https://.";
        }
      } catch {
        errors.url = "Informe uma URL HTTP/HTTPS válida (ex.: https://mcp.exemplo.com/mcp).";
      }
    }
  }

  if (config.acesso?.mode === "agents") {
    const validIds = sanitizeStringArray(config.acesso.agentIds, true);
    if (validIds.length === 0) {
      errors.acesso =
        "Selecione pelo menos um agente autorizado ou altere o acesso para todos os agentes.";
    }
  }

  return errors;
}

/**
 * Indica se a configuração MCP está pronta para ser testada ou salva.
 */
export function mcpConfigIsValid(config: Partial<McpServidorConfig>): boolean {
  return Object.keys(mcpConfigErrors(config)).length === 0;
}
