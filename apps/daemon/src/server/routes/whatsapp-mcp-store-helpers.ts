import type { IncomingMessage, ServerResponse } from "node:http";
import {
  normalizeWhatsAppPairingPhone,
  type MarketplaceSourceFilter,
  type MarketplaceTab,
  type McpAcessoAgentes,
  type McpServidorConfig,
  type WhatsAppConfigPayload,
  type WhatsAppMetodoPareamento,
  type WhatsAppModoOperacao,
  type WhatsAppPairingStatus,
} from "@criativo/contracts";
import { CatalogServiceError, type ConnectCatalogAppInput } from "../../marketplace/catalog-service.ts";
import { GithubImportError } from "../../marketplace/github-importer.ts";
import { SkillsManagerError } from "../../marketplace/skills-manager.ts";
import { McpServerStoreError } from "../../mcp/mcp-server-store.ts";
import type { StudioRoutesDeps } from "../studio-routes.ts";

const RESERVED_MCP_PATH_SEGMENTS = new Set(["oauth", "testar-rascunho", "servidores"]);

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  res.end(html);
}

export function resolveCallbackBaseUrl(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protoRaw = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = protoRaw?.split(",")[0]?.trim().toLowerCase() === "https" ? "https" : "http";

  const forwardedHost = req.headers["x-forwarded-host"];
  const hostRaw = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const host = (hostRaw?.split(",")[0]?.trim() || req.headers.host || "127.0.0.1:3000").trim();

  return `${proto}://${host}`;
}

export function normalizeMcpRequestBody(
  body: Record<string, unknown>,
  existing?: McpServidorConfig | null
): Partial<McpServidorConfig> {
  const rawAcesso = (body.acesso ?? body.access ?? body.acesso_json) as
    | Partial<McpAcessoAgentes>
    | undefined;

  const transporte =
    body.transporte === "http" || body.transport === "http"
      ? "http"
      : body.transporte === "stdio" || body.transport === "stdio"
        ? "stdio"
        : existing?.transporte;

  return {
    ...(existing ?? {}),
    ...(typeof body.mcp_id === "string" ? { mcp_id: body.mcp_id } : {}),
    ...(typeof body.nome === "string"
      ? { nome: body.nome }
      : typeof body.name === "string"
        ? { nome: body.name }
        : {}),
    ...(transporte ? { transporte } : {}),
    ...(typeof body.comando === "string"
      ? { comando: body.comando }
      : typeof body.command === "string"
        ? { comando: body.command }
        : {}),
    ...(Array.isArray(body.args)
      ? { args: body.args.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(body.env && typeof body.env === "object" && !Array.isArray(body.env)
      ? { env: body.env as Record<string, string> }
      : {}),
    ...(Array.isArray(body.envPassthrough ?? body.env_passthrough)
      ? {
          envPassthrough: ((body.envPassthrough ?? body.env_passthrough) as unknown[]).filter(
            (item): item is string => typeof item === "string"
          ),
        }
      : {}),
    ...(body.workingDirectory !== undefined || body.working_directory !== undefined
      ? {
          workingDirectory:
            typeof (body.workingDirectory ?? body.working_directory) === "string"
              ? String(body.workingDirectory ?? body.working_directory)
              : null,
        }
      : {}),
    ...(body.url !== undefined ? { url: typeof body.url === "string" ? body.url : null } : {}),
    ...(body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
      ? { headers: body.headers as Record<string, string> }
      : {}),
    ...(rawAcesso && typeof rawAcesso === "object"
      ? {
          acesso: {
            mode: rawAcesso.mode === "agents" ? "agents" : "everyone",
            agentIds: Array.isArray(rawAcesso.agentIds)
              ? rawAcesso.agentIds.filter((id): id is string => typeof id === "string")
              : [],
          },
        }
      : {}),
    ...(typeof body.ativo === "boolean" ? { ativo: body.ativo } : {}),
  };
}

export function mapDomainErrorStatus(err: unknown): { statusCode: number; message: string; code?: string; fieldErrors?: Record<string, string> } {
  if (err instanceof McpServerStoreError) {
    return { statusCode: 400, message: err.message, fieldErrors: err.fieldErrors };
  }
  if (err instanceof SkillsManagerError) {
    const statusCode =
      err.code === "SKILL_NOT_FOUND" || err.code === "AGENT_NOT_FOUND"
        ? 404
        : err.code === "SKILL_ALREADY_EXISTS"
          ? 409
          : 400;
    return { statusCode, message: err.message, code: err.code };
  }
  if (err instanceof CatalogServiceError) {
    const statusCode =
      err.code === "APP_NOT_FOUND" ||
      err.code === "AGENT_NOT_FOUND" ||
      err.code === "AGENT_PACKAGE_NOT_FOUND" ||
      err.code === "ACCOUNT_NOT_FOUND"
        ? 404
        : 400;
    return { statusCode, message: err.message, code: err.code };
  }
  if (err instanceof GithubImportError) {
    return { statusCode: 400, message: err.message, code: err.code };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const statusCode = /não encontrad[oa]/i.test(msg) ? 404 : 400;
  return { statusCode, message: msg };
}

export function sendError(res: ServerResponse, sendJson: StudioRoutesDeps["sendJson"], err: unknown): void {
  const mapped = mapDomainErrorStatus(err);
  sendJson(res, mapped.statusCode, {
    erro: mapped.message,
    ...(mapped.code ? { codigo: mapped.code } : {}),
    ...(mapped.fieldErrors ? { fieldErrors: mapped.fieldErrors } : {}),
  });
}

export function extractMcpIdSegment(
  path: string,
  suffix = ""
): string | null {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const primaryMatch = path.match(new RegExp(`^/api/mcps/servidores/([^/]+)${escapedSuffix}$`));
  if (primaryMatch) {
    return decodeURIComponent(primaryMatch[1]);
  }
  const aliasMatch = path.match(new RegExp(`^/api/mcps/([^/]+)${escapedSuffix}$`));
  if (aliasMatch) {
    const candidate = decodeURIComponent(aliasMatch[1]);
    if (!RESERVED_MCP_PATH_SEGMENTS.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

