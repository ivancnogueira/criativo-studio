import type {
  McpApprovalAuditEntry,
  McpToolConsentDecision,
  McpToolConsentRule,
  TelemetryStatusSnapshot,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const phase35Api = {
  async getTelemetryStatus(): Promise<TelemetryStatusSnapshot> {
    const res = await apiFetch("/api/telemetria/status");
    return (await res.json()) as TelemetryStatusSnapshot;
  },

  async setTelemetryOptIn(enabled: boolean): Promise<TelemetryStatusSnapshot> {
    const res = await apiFetch("/api/telemetria/opt-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const json = (await res.json()) as { status?: TelemetryStatusSnapshot; erro?: string };
    if (!res.ok || !json.status) {
      throw new Error(json.erro ?? "Falha ao atualizar preferência de telemetria.");
    }
    return json.status;
  },

  async listMcpConsents(agenteId?: string): Promise<McpToolConsentRule[]> {
    const query = agenteId ? `?agenteId=${encodeURIComponent(agenteId)}` : "";
    const res = await apiFetch(`/api/mcp/consents${query}`);
    const json = (await res.json()) as { consents?: McpToolConsentRule[] };
    return json.consents ?? [];
  },

  async upsertMcpConsent(payload: {
    agenteId: string;
    mcpId: string;
    toolName: string;
    decision: McpToolConsentDecision;
    argPattern?: string | null;
  }): Promise<McpToolConsentRule> {
    const res = await apiFetch("/api/mcp/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { consent?: McpToolConsentRule; erro?: string };
    if (!res.ok || !json.consent) {
      throw new Error(json.erro ?? "Falha ao salvar política MCP.");
    }
    return json.consent;
  },

  async revokeMcpConsent(consentId: string): Promise<void> {
    const res = await apiFetch(`/api/mcp/consents/${encodeURIComponent(consentId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error("Falha ao revogar consentimento MCP.");
    }
  },

  async listMcpApprovalAudit(agenteId?: string): Promise<McpApprovalAuditEntry[]> {
    const query = agenteId ? `?agenteId=${encodeURIComponent(agenteId)}` : "";
    const res = await apiFetch(`/api/mcp/approval-audit${query}`);
    const json = (await res.json()) as { audit?: McpApprovalAuditEntry[] };
    return json.audit ?? [];
  },
};
