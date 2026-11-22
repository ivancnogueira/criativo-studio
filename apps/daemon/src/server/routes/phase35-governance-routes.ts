import type { McpToolConsentDecision } from "@criativo/contracts";
import type { StudioRouteContext } from "./route-helpers.ts";

const VALID_DECISIONS = new Set<McpToolConsentDecision>([
  "ask",
  "allow_once",
  "always_allow",
  "deny",
]);

export async function tryHandlePhase35GovernanceRoutes(
  ctx: StudioRouteContext,
): Promise<boolean> {
  const { req, res, path, method, url, deps } = ctx;
  const { sendJson, readJsonBody, telemetryService, mcpGateway } = deps;

  // =========================================================================
  // 1. Telemetria Opt-In Redigida (G-19)
  // =========================================================================

  if (method === "GET" && path === "/api/telemetria/status") {
    if (!telemetryService) {
      sendJson(res, 503, { erro: "TelemetryService não inicializado." });
      return true;
    }
    sendJson(res, 200, telemetryService.getStatus());
    return true;
  }

  if (method === "POST" && path === "/api/telemetria/opt-in") {
    if (!telemetryService) {
      sendJson(res, 503, { erro: "TelemetryService não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    const status = telemetryService.setOptIn(Boolean(body.enabled));
    sendJson(res, 200, { ok: true, status });
    return true;
  }

  if (method === "POST" && path === "/api/telemetria/evento") {
    if (!telemetryService) {
      sendJson(res, 503, { erro: "TelemetryService não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    const eventName = String(body.eventName ?? "").trim();
    if (!eventName) {
      sendJson(res, 400, { erro: "Informe eventName para registrar evento de telemetria." });
      return true;
    }
    const recorded = telemetryService.recordEvent({
      eventName,
      errorCode: typeof body.errorCode === "string" ? body.errorCode : null,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
      meta: body.meta && typeof body.meta === "object" ? (body.meta as Record<string, unknown>) : {},
    });
    sendJson(res, 200, { ok: true, recorded, optIn: telemetryService.isEnabled() });
    return true;
  }

  // =========================================================================
  // 2. Consentimentos Granulares & Auditoria de Tools MCP (G-18)
  // =========================================================================

  if (method === "GET" && path === "/api/mcp/consents") {
    if (!mcpGateway) {
      sendJson(res, 503, { erro: "McpGateway não inicializado." });
      return true;
    }
    const agenteId = url.searchParams.get("agenteId") ?? undefined;
    sendJson(res, 200, {
      consents: mcpGateway.approvalService.listConsents(agenteId),
    });
    return true;
  }

  if (method === "POST" && path === "/api/mcp/consents") {
    if (!mcpGateway) {
      sendJson(res, 503, { erro: "McpGateway não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    const agenteId = String(body.agenteId ?? "*").trim();
    const mcpId = String(body.mcpId ?? "").trim();
    const toolName = String(body.toolName ?? "*").trim();
    const decision = String(body.decision ?? "ask") as McpToolConsentDecision;
    if (!mcpId || !VALID_DECISIONS.has(decision)) {
      sendJson(res, 400, { erro: "Informe mcpId e decision válidos (ask|allow_once|always_allow|deny)." });
      return true;
    }
    const rule = mcpGateway.approvalService.upsertConsent({
      agenteId,
      mcpId,
      toolName,
      decision,
      argPattern: typeof body.argPattern === "string" ? body.argPattern : null,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    });
    sendJson(res, 200, { ok: true, consent: rule });
    return true;
  }

  const consentDeleteMatch = path.match(/^\/api\/mcp\/consents\/([^/]+)$/);
  if (method === "DELETE" && consentDeleteMatch) {
    if (!mcpGateway) {
      sendJson(res, 503, { erro: "McpGateway não inicializado." });
      return true;
    }
    const consentId = decodeURIComponent(consentDeleteMatch[1]!);
    const ok = mcpGateway.approvalService.revokeConsent(consentId);
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }

  if (method === "GET" && path === "/api/mcp/approval-audit") {
    if (!mcpGateway) {
      sendJson(res, 503, { erro: "McpGateway não inicializado." });
      return true;
    }
    const agenteId = url.searchParams.get("agenteId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 50);
    sendJson(res, 200, {
      audit: mcpGateway.approvalService.listAudit(agenteId, Number.isFinite(limit) ? limit : 50),
    });
    return true;
  }

  return false;
}
