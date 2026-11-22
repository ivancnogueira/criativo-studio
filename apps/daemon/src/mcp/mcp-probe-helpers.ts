import {
  type McpOAuthMetadataSummary,
  type McpServidorConfig,
} from "@criativo/contracts";
import type {
  FetchLike,
} from "../engine/providers/provider-interface.ts";

export const MCP_PROBE_TIMEOUT_MS = 30_000;
export const MCP_STDIO_PROBE_TIMEOUT_MS = 60_000;
export const MAX_CAPTURED_TOOLS = 50;
export const STDIO_KILL_GRACE_MS = 1_500;
export const MAX_STDERR_BYTES = 16 * 1024;

export interface McpProbeOptions {
  accessToken?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  extraSecrets?: Iterable<string>;
  signal?: AbortSignal;
}

export interface OAuthDiscoveryResult extends McpOAuthMetadataSummary {
  resourceMetadataUrl: string | null;
  authorizationServerUrl: string | null;
}

export interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
}

export function isLoopbackHostname(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1";
}

export function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map((n) => Number(n));
  if (octets.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isPrivateHostname(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!clean) return true;
  if (isLoopbackHostname(clean)) return true;
  if (isPrivateIpv4(clean)) return true;
  if (clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd") || clean === "::") {
    return true;
  }
  return false;
}

/**
 * Valida URL de servidor MCP ou endpoint OAuth evitando esquemas perigosos e SSRF em metadados externos.
 */
export function validateSafeHttpUrl(rawUrl: string, allowLoopbackHttp: boolean): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const local = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol === "http:" && !(allowLoopbackHttp && local)) {
    return null;
  }

  if (!allowLoopbackHttp && isPrivateHostname(parsed.hostname)) {
    return null;
  }

  return parsed;
}

export function stripUrlFragment(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function extractResourceMetadataFromHeader(wwwAuthenticateHeader?: string | null): string | null {
  if (!wwwAuthenticateHeader) return null;
  const quoted = /\bresource_metadata="([^"]+)"/i.exec(wwwAuthenticateHeader);
  if (quoted?.[1]) return quoted[1].trim();
  const unquoted = /\bresource_metadata=([^\s,;]+)/i.exec(wwwAuthenticateHeader);
  return unquoted?.[1]?.trim() ?? null;
}

export function hasManualCredentialHeader(config: McpServidorConfig): boolean {
  return Object.entries(config.headers ?? {}).some(
    ([key, value]) =>
      /^(?:authorization|x-api-key|api-key|x-auth-token|x-access-token)$/i.test(key.trim()) &&
      value.trim().length > 0
  );
}

export async function fetchJsonSafe(
  url: string,
  fetchFn: FetchLike,
  signal: AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json") && contentType.trim().length > 0) {
      // Alguns servidores devolvem JSON com text/plain; tentamos parsear mesmo assim se não for HTML
      if (contentType.toLowerCase().includes("html")) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
    }
    const payload = (await res.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Descobre metadados OAuth 2.1 conforme RFC 9728 (Protected Resource Metadata)
 * e RFC 8414 (Authorization Server Metadata), validando HTTPS e bloqueando SSRF.
 */
