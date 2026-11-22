import type { DeepLinkRoute } from "@criativo/contracts";

const SAFE_ID_REGEX = /^[a-zA-Z0-9._:-]{1,96}$/;

export class DeepLinkSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepLinkSecurityError";
  }
}

/**
 * Parser e validador estrito de Deep Links `criativo://` (G-23).
 * Permite apenas rotas conhecidas e parâmetros sanitizados.
 */
export function parseCriativoDeepLink(rawUrl: string): DeepLinkRoute {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new DeepLinkSecurityError("URL de deep link vazia.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new DeepLinkSecurityError("Formato de URL de deep link inválido.");
  }

  if (parsed.protocol !== "criativo:") {
    throw new DeepLinkSecurityError(`Protocolo não permitido: '${parsed.protocol}'.`);
  }

  const host = parsed.hostname.toLowerCase();
  const pathSegments = parsed.pathname
    .split("/")
    .map((s) => decodeURIComponent(s).trim())
    .filter(Boolean);

  if (host === "agent") {
    const agenteId = pathSegments[0] ?? parsed.searchParams.get("id")?.trim() ?? "";
    if (!agenteId || !SAFE_ID_REGEX.test(agenteId)) {
      throw new DeepLinkSecurityError("Identificador de agente inválido no deep link.");
    }
    return { kind: "agent", agenteId, rawUrl: parsed.toString() };
  }

  if (host === "workflow") {
    const workflowId = pathSegments[0] ?? parsed.searchParams.get("id")?.trim() ?? "";
    if (!workflowId || !SAFE_ID_REGEX.test(workflowId)) {
      throw new DeepLinkSecurityError("Identificador de workflow inválido no deep link.");
    }
    return { kind: "workflow", workflowId, rawUrl: parsed.toString() };
  }

  if (host === "oauth" && (pathSegments[0] ?? "").toLowerCase() === "callback") {
    const provider = (parsed.searchParams.get("provider") ?? pathSegments[1] ?? "unknown").trim();
    if (!SAFE_ID_REGEX.test(provider)) {
      throw new DeepLinkSecurityError("Provedor OAuth inválido no deep link.");
    }
    return {
      kind: "oauth_callback",
      provider,
      code: parsed.searchParams.get("code"),
      state: parsed.searchParams.get("state"),
      rawUrl: parsed.toString(),
    };
  }

  if (host === "server" && (pathSegments[0] ?? "").toLowerCase() === "connect") {
    const rawTarget = (parsed.searchParams.get("url") ?? "").trim();
    if (!rawTarget) {
      throw new DeepLinkSecurityError("Parâmetro 'url' obrigatório em criativo://server/connect.");
    }
    let targetUrl: URL;
    try {
      targetUrl = new URL(rawTarget);
    } catch {
      throw new DeepLinkSecurityError("URL de servidor inválida no deep link.");
    }
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new DeepLinkSecurityError("Esquema de URL de servidor não permitido.");
    }
    return {
      kind: "server_connect",
      url: targetUrl.toString().replace(/\/+$/, ""),
      claim: parsed.searchParams.get("claim")?.trim() || null,
      name: parsed.searchParams.get("name")?.trim()?.slice(0, 64) || null,
      rawUrl: parsed.toString(),
    };
  }

  if (host === "template" && (pathSegments[0] ?? "").toLowerCase() === "install") {
    const sourceUrl = parsed.searchParams.get("url")?.trim() || null;
    const templateJson = parsed.searchParams.get("data")?.trim() || null;
    if (sourceUrl) {
      let src: URL;
      try {
        src = new URL(sourceUrl);
      } catch {
        throw new DeepLinkSecurityError("URL de template inválida.");
      }
      const isLocal = src.hostname === "127.0.0.1" || src.hostname === "localhost";
      if (src.protocol !== "https:" && !(src.protocol === "http:" && isLocal)) {
        throw new DeepLinkSecurityError("URL de template deve usar HTTPS ou localhost.");
      }
    } else if (!templateJson) {
      throw new DeepLinkSecurityError("Informe 'url' ou 'data' para instalar template via deep link.");
    }
    return {
      kind: "template_install",
      sourceUrl,
      templateJson,
      rawUrl: parsed.toString(),
    };
  }

  throw new DeepLinkSecurityError(`Rota criativo:// desconhecida: '${host}/${pathSegments.join("/")}'.`);
}

export function extractCriativoDeepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.trim().toLowerCase().startsWith("criativo://")) {
      return arg.trim();
    }
  }
  return null;
}
