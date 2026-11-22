import type { IncomingMessage, ServerResponse } from "node:http";
import type { StudioRoutesDeps } from "./studio-routes.ts";
import type { StudioRouteContext } from "./routes/route-helpers.ts";
import { tryHandleWhatsAppRoutes } from "./routes/whatsapp-routes.ts";
import { tryHandleMcpRoutes } from "./routes/mcp-routes.ts";
import { tryHandleMarketplaceRoutes } from "./routes/marketplace-routes.ts";

/**
 * Roteador modular da Fase 10 (Facade):
 * - WhatsApp multi-número (/api/mensageria/whatsapp/contas/*)
 * - MCP Gateway & OAuth 2.1 (/api/mcps/*)
 * - Loja Unificada (/api/loja/*)
 */
export async function tryHandleWhatsAppMcpStoreRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: StudioRoutesDeps
): Promise<boolean> {
  const ctx: StudioRouteContext = {
    req,
    res,
    path,
    method,
    url,
    deps,
    db: deps.db,
    wsHub: deps.wsHub,
    workspaceRoot: deps.workspaceRoot ?? process.cwd(),
  };

  if (await tryHandleWhatsAppRoutes(ctx)) return true;
  if (await tryHandleMcpRoutes(ctx)) return true;
  if (await tryHandleMarketplaceRoutes(ctx)) return true;

  return false;
}
