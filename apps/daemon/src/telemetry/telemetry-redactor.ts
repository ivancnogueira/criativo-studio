const MAX_REDACT_DEPTH = 6;

const BLOCKED_PAYLOAD_KEYS = new Set([
  "prompt",
  "conteudo",
  "content",
  "text",
  "texto",
  "message",
  "mensagem",
  "password",
  "senha",
  "token",
  "secret",
  "segredo",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "username",
  "usuario",
  "brand",
  "marca",
]);

/**
 * Redige caminhos pessoais do SO, segredos, tokens Bearer, e-mails, handles `@usuario`,
 * URLs privadas e IPs locais de uma string antes de compor eventos de telemetria opt-in.
 */
export function redactTelemetryString(raw: string): string {
  let out = String(raw ?? "");
  if (!out) return out;

  // Caminhos Windows e POSIX com usuário
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/gi, "<USER_HOME>");
  out = out.replace(/\/Users\/[^/\s"'`]+/g, "<USER_HOME>");
  out = out.replace(/\/home\/[^/\s"'`]+/g, "<USER_HOME>");

  // Tokens, chaves API e cabeçalhos Authorization
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <REDACTED>");
  out = out.replace(
    /\b(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{12,}|xox[baprs]-[A-Za-z0-9-]{8,}|ghp_[A-Za-z0-9]{12,})\b/g,
    "<SECRET_KEY>",
  );

  // E-mails e handles @usuario
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<REDACTED_EMAIL>");
  out = out.replace(/(^|\s)@[a-zA-Z0-9._-]{2,40}\b/g, "$1<REDACTED_HANDLE>");

  // URLs http(s) e endereços IPv4 privados
  out = out.replace(/https?:\/\/[^\s"'`<>]+/gi, "<REDACTED_URL>");
  out = out.replace(/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, "<PRIVATE_IP>");

  return out;
}

/**
 * Redige recursivamente payloads estruturados de telemetria opt-in garantindo que
 * campos livres (`prompt`, `token`, `password`, etc.) e padrões sensíveis nunca escapem.
 */
export function redactTelemetryPayload(
  input: unknown,
  depth = 0,
): Record<string, string | number | boolean> {
  if (depth > MAX_REDACT_DEPTH || !input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const sanitized: Record<string, string | number | boolean> = {};
  for (const [rawKey, val] of Object.entries(input)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (BLOCKED_PAYLOAD_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "<REDACTED_FIELD>";
      continue;
    }

    if (typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val))) {
      sanitized[key] = val;
    } else if (typeof val === "string") {
      sanitized[key] = redactTelemetryString(val).slice(0, 180);
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = redactTelemetryPayload(val, depth + 1);
      for (const [nk, nv] of Object.entries(nested)) {
        sanitized[`${key}.${nk}`] = nv;
      }
    }
  }
  return sanitized;
}
