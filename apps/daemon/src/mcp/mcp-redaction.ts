import type { McpServidorConfig } from "@criativo/contracts";

/**
 * Marcador padrão de redação para logs, saídas de ferramentas e mensagens de erro.
 */
export const SECRET_REDACTED_PLACEHOLDER = "[SEGREDO_REDIGIDO]";

/**
 * Máscara de exibição segura para UI/agentes sem vazar valores reais do Cofre.
 */
export const MASKED_SECRET_VALUE = "••••••••";

const SENSITIVE_QUERY_PARAM_REGEX =
  /^(?:token|key|secret|auth|authorization|password|passwd|pwd|apikey|api_key|access_token|refresh_token|client_secret|sig|signature|credential)$/i;

const SENSITIVE_INLINE_QUERY_REGEX =
  /([?&](?:token|key|secret|auth|authorization|password|passwd|pwd|apikey|api_key|access_token|refresh_token|client_secret|sig|signature|credential)=)([^&\s"'`]+)/gi;

const BEARER_TOKEN_REGEX = /\bBearer\s+(?!\[SEGREDO_REDIGIDO\])[A-Za-z0-9\-._~+/]+=*/gi;

const AUTH_HEADER_VALUE_REGEX =
  /((?:authorization|x-api-key|api-key)\s*:\s*)(?:(?:Bearer|Basic)\s+)?(?!\[SEGREDO_REDIGIDO\])[^\s"'\r\n,;]+/gi;

/**
 * Variáveis de ambiente de sistema/perfil que não devem ser tratadas como credenciais
 * quando apenas herdadas com o mesmo valor do processo atual.
 */
const USER_PROFILE_VARIABLES = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "PATH",
  "SHELL",
  "USERNAME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "WINDIR",
]);

function isInheritedProfileValue(name: string, value: string): boolean {
  return USER_PROFILE_VARIABLES.has(name.toUpperCase()) && process.env[name] === value;
}

function addCandidateSecret(bucket: Set<string>, raw: unknown): void {
  if (typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (trimmed.length < 4) return;
  if (trimmed === MASKED_SECRET_VALUE || trimmed === SECRET_REDACTED_PLACEHOLDER) return;
  if (trimmed.startsWith("vault://")) return;

  bucket.add(trimmed);

  if (/^bearer\s+/i.test(trimmed)) {
    const inner = trimmed.replace(/^bearer\s+/i, "").trim();
    if (inner.length >= 4 && inner !== MASKED_SECRET_VALUE && inner !== SECRET_REDACTED_PLACEHOLDER) {
      bucket.add(inner);
    }
  }
  if (/^basic\s+/i.test(trimmed)) {
    const inner = trimmed.replace(/^basic\s+/i, "").trim();
    if (inner.length >= 4 && inner !== MASKED_SECRET_VALUE && inner !== SECRET_REDACTED_PLACEHOLDER) {
      bucket.add(inner);
    }
  }
}

function extractUrlSecrets(rawUrl: string | null | undefined, bucket: Set<string>): void {
  if (!rawUrl || typeof rawUrl !== "string") return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  if (parsed.password) {
    addCandidateSecret(bucket, parsed.password);
    try {
      addCandidateSecret(bucket, decodeURIComponent(parsed.password));
    } catch {
      // ignora erro de decodificação
    }
  }

  for (const [paramKey, paramValue] of parsed.searchParams.entries()) {
    if (!SENSITIVE_QUERY_PARAM_REGEX.test(paramKey)) continue;
    addCandidateSecret(bucket, paramValue);
    try {
      addCandidateSecret(bucket, decodeURIComponent(paramValue));
    } catch {
      // ignora erro de decodificação
    }
  }
}

/**
 * Extrai valores sensíveis de `env`, `envPassthrough`, `headers`, query params da `url`
 * e eventuais tokens OAuth ativos para uso em redação defensiva.
 */
export function collectSensitiveSecrets(
  config: Partial<McpServidorConfig>,
  extraTokens?: Iterable<string | null | undefined>
): string[] {
  const bucket = new Set<string>();

  if (config.env && typeof config.env === "object") {
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof value !== "string") continue;
      if (!isInheritedProfileValue(key, value)) {
        addCandidateSecret(bucket, value);
      }
    }
  }

  if (Array.isArray(config.envPassthrough)) {
    for (const envName of config.envPassthrough) {
      if (typeof envName !== "string") continue;
      const inherited = process.env[envName];
      if (inherited && !isInheritedProfileValue(envName, inherited)) {
        addCandidateSecret(bucket, inherited);
      }
    }
  }

  if (config.headers && typeof config.headers === "object") {
    for (const value of Object.values(config.headers)) {
      addCandidateSecret(bucket, value);
    }
  }

  extractUrlSecrets(config.url, bucket);

  if (extraTokens) {
    for (const token of extraTokens) {
      addCandidateSecret(bucket, token);
    }
  }

  return Array.from(bucket).sort((a, b) => b.length - a.length);
}

function isIterableSecrets(
  input: Iterable<string> | Partial<McpServidorConfig>
): input is Iterable<string> {
  return typeof (input as Iterable<string>)[Symbol.iterator] === "function";
}

/**
 * Redige ocorrências exatas e URL-encoded de segredos (>= 4 chars) e cabeçalhos Bearer
 * substituindo-os por `[SEGREDO_REDIGIDO]`.
 */
export function redactMcpSecrets(
  text: string,
  secrets: Iterable<string> | Partial<McpServidorConfig> = []
): string {
  if (!text) return text;

  const secretList = isIterableSecrets(secrets)
    ? Array.from(new Set(Array.from(secrets).filter((s) => typeof s === "string" && s.length >= 4))).sort(
        (a, b) => b.length - a.length
      )
    : collectSensitiveSecrets(secrets);

  let sanitized = text;

  for (const secret of secretList) {
    if (secret === SECRET_REDACTED_PLACEHOLDER || secret === MASKED_SECRET_VALUE) {
      continue;
    }

    if (sanitized.includes(secret)) {
      sanitized = sanitized.split(secret).join(SECRET_REDACTED_PLACEHOLDER);
    }

    try {
      const encoded = encodeURIComponent(secret);
      if (encoded.length >= 4 && encoded !== secret && sanitized.includes(encoded)) {
        sanitized = sanitized.split(encoded).join(SECRET_REDACTED_PLACEHOLDER);
      }
    } catch {
      // ignora caracteres inválidos para encodeURIComponent
    }
  }

  sanitized = sanitized.replace(BEARER_TOKEN_REGEX, `Bearer ${SECRET_REDACTED_PLACEHOLDER}`);
  sanitized = sanitized.replace(AUTH_HEADER_VALUE_REGEX, `$1${SECRET_REDACTED_PLACEHOLDER}`);
  sanitized = sanitized.replace(SENSITIVE_INLINE_QUERY_REGEX, `$1${SECRET_REDACTED_PLACEHOLDER}`);

  return sanitized;
}

/**
 * Redige recursivamente objetos/arrays retornados por tools MCP antes de entregá-los ao agente ou chat.
 */
export function redactMcpPayload(
  value: unknown,
  secrets: Iterable<string> | Partial<McpServidorConfig> = []
): unknown {
  const secretList = isIterableSecrets(secrets)
    ? Array.from(secrets)
    : collectSensitiveSecrets(secrets);

  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      return redactMcpSecrets(node, secretList);
    }
    if (typeof node === "number" || typeof node === "boolean" || node === null || node === undefined) {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map(visit);
    }
    if (typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>).map(([k, v]) => [
        redactMcpSecrets(k, secretList),
        visit(v),
      ]);
      return Object.fromEntries(entries);
    }
    return node;
  };

  return visit(value);
}

function maskUrlQuerySecrets(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = MASKED_SECRET_VALUE;
    }
    let changed = Boolean(parsed.password);
    for (const [key] of parsed.searchParams.entries()) {
      if (SENSITIVE_QUERY_PARAM_REGEX.test(key)) {
        parsed.searchParams.set(key, MASKED_SECRET_VALUE);
        changed = true;
      }
    }
    return changed ? parsed.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Retorna uma cópia segura de `McpServidorConfig` para UI/agentes preservando apenas nomes de chaves
 * de `env` e `headers` com valores mascarados (`••••••••`).
 */
export function maskMcpServerForClient(config: McpServidorConfig): McpServidorConfig {
  const maskedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.env ?? {})) {
    maskedEnv[key] = value.length > 0 ? MASKED_SECRET_VALUE : "";
  }

  const maskedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.headers ?? {})) {
    maskedHeaders[key] = value.length > 0 ? MASKED_SECRET_VALUE : "";
  }

  return {
    ...config,
    args: [...(config.args ?? [])],
    env: maskedEnv,
    envPassthrough: [...(config.envPassthrough ?? [])],
    headers: maskedHeaders,
    url: maskUrlQuerySecrets(config.url),
    acesso: {
      mode: config.acesso?.mode === "agents" ? "agents" : "everyone",
      agentIds: [...(config.acesso?.agentIds ?? [])],
    },
    ultimoErro: config.ultimoErro
      ? redactMcpSecrets(config.ultimoErro, collectSensitiveSecrets(config))
      : null,
  };
}
