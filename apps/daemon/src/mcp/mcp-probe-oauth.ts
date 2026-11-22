import {
  join,
} from "node:path";
import type {
  FetchLike,
} from "../engine/providers/provider-interface.ts";
import { type OAuthDiscoveryResult, type JsonRpcEnvelope, isLoopbackHostname, validateSafeHttpUrl, stripUrlFragment, extractResourceMetadataFromHeader, fetchJsonSafe } from "./mcp-probe-helpers.ts";

export async function discoverOAuthMetadata(
  resourceUrl: string,
  wwwAuthenticateHeader?: string | null,
  fetchImpl?: FetchLike
): Promise<OAuthDiscoveryResult> {
  const fetchFn = fetchImpl ?? fetch;
  const cleanResource = stripUrlFragment(resourceUrl);
  let parsedResource: URL;
  try {
    parsedResource = new URL(cleanResource);
  } catch {
    throw new Error("URL de servidor MCP inválida para descoberta OAuth.");
  }

  if (parsedResource.protocol !== "http:" && parsedResource.protocol !== "https:") {
    throw new Error("Protocolo inválido para descoberta OAuth (permitido apenas http/https).");
  }

  const allowLoopbackHttp = isLoopbackHostname(parsedResource.hostname);
  if (parsedResource.protocol === "http:" && !allowLoopbackHttp) {
    throw new Error("Servidores MCP OAuth externos exigem HTTPS.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timeout na descoberta OAuth")), 10_000);
  timer.unref?.();

  try {
    const headerMetadataRaw = extractResourceMetadataFromHeader(wwwAuthenticateHeader);
    const prCandidates: string[] = [];

    if (headerMetadataRaw) {
      try {
        const resolved = new URL(headerMetadataRaw, parsedResource.origin).toString();
        if (validateSafeHttpUrl(resolved, allowLoopbackHttp)) {
          prCandidates.push(resolved);
        }
      } catch {
        // ignora URL inválida no cabeçalho
      }
    }

    const pathname = parsedResource.pathname.replace(/\/+$/, "");
    if (pathname && pathname !== "/") {
      prCandidates.push(`${parsedResource.origin}/.well-known/oauth-protected-resource${pathname}`);
    }
    prCandidates.push(`${parsedResource.origin}/.well-known/oauth-protected-resource`);

    let resourceMetadataUrl: string | null = null;
    let protectedResourceDoc: Record<string, unknown> | null = null;

    for (const candidate of Array.from(new Set(prCandidates))) {
      if (!validateSafeHttpUrl(candidate, allowLoopbackHttp)) continue;
      const doc = await fetchJsonSafe(candidate, fetchFn, controller.signal);
      if (doc) {
        resourceMetadataUrl = candidate;
        protectedResourceDoc = doc;
        break;
      }
    }

    const authServersRaw = Array.isArray(protectedResourceDoc?.authorization_servers)
      ? (protectedResourceDoc.authorization_servers as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        )
      : [];

    let authServerUrl: string = parsedResource.origin;
    for (const candidateAuth of authServersRaw) {
      const valid = validateSafeHttpUrl(candidateAuth.trim(), allowLoopbackHttp);
      if (valid) {
        authServerUrl = valid.toString().replace(/\/+$/, "");
        break;
      }
    }

    const parsedAuth = new URL(authServerUrl);
    const authPath = parsedAuth.pathname.replace(/\/+$/, "");
    const asCandidates: string[] = [];
    if (authPath && authPath !== "/") {
      asCandidates.push(`${parsedAuth.origin}/.well-known/oauth-authorization-server${authPath}`);
      asCandidates.push(`${parsedAuth.origin}${authPath}/.well-known/oauth-authorization-server`);
    }
    asCandidates.push(`${parsedAuth.origin}/.well-known/oauth-authorization-server`);
    asCandidates.push(`${parsedAuth.origin}/.well-known/openid-configuration`);

    let authDoc: Record<string, unknown> | null = null;
    for (const candidate of Array.from(new Set(asCandidates))) {
      if (!validateSafeHttpUrl(candidate, allowLoopbackHttp)) continue;
      const doc = await fetchJsonSafe(candidate, fetchFn, controller.signal);
      if (doc && (typeof doc.authorization_endpoint === "string" || typeof doc.token_endpoint === "string")) {
        authDoc = doc;
        break;
      }
    }

    const validateEndpoint = (val: unknown): string | null => {
      if (typeof val !== "string" || !val.trim()) return null;
      const valid = validateSafeHttpUrl(val.trim(), allowLoopbackHttp);
      return valid ? valid.toString() : null;
    };

    const scopesFromPr = Array.isArray(protectedResourceDoc?.scopes_supported)
      ? (protectedResourceDoc.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const scopesFromAs = Array.isArray(authDoc?.scopes_supported)
      ? (authDoc.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : [];

    const codeChallengeMethods = Array.isArray(authDoc?.code_challenge_methods_supported)
      ? (authDoc.code_challenge_methods_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : [];

    return {
      resource:
        typeof protectedResourceDoc?.resource === "string"
          ? protectedResourceDoc.resource
          : cleanResource,
      authorizationServer:
        typeof authDoc?.issuer === "string" ? authDoc.issuer : authServerUrl,
      authorizationServerUrl: authServerUrl,
      resourceMetadataUrl,
      authorizationEndpoint: validateEndpoint(authDoc?.authorization_endpoint),
      tokenEndpoint: validateEndpoint(authDoc?.token_endpoint),
      registrationEndpoint: validateEndpoint(authDoc?.registration_endpoint),
      revocationEndpoint: validateEndpoint(authDoc?.revocation_endpoint),
      scopesSupported: scopesFromPr.length > 0 ? scopesFromPr : scopesFromAs,
      codeChallengeMethodsSupported: codeChallengeMethods,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseSseJsonRpcMessages(rawText: string): JsonRpcEnvelope[] {
  const results: JsonRpcEnvelope[] = [];
  const blocks = rawText.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            results.push(item as JsonRpcEnvelope);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        results.push(parsed as JsonRpcEnvelope);
      }
    } catch {
      // ignora blocos SSE que não sejam JSON-RPC
    }
  }

  return results;
}

export function extractSseEndpointEvent(rawChunk: string): string | null {
  const blocks = rawChunk.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (eventName === "endpoint" && dataLines.length > 0) {
      return dataLines.join("\n").trim();
    }
  }
  return null;
}

