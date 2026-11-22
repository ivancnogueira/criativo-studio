import { randomUUID } from "node:crypto";
import type {
  McpApprovalAuditEntry,
  McpToolConsentDecision,
  McpToolConsentRule,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

interface ConsentRow {
  consent_id: string;
  agente_id: string;
  mcp_id: string;
  tool_name: string;
  decision: McpToolConsentDecision;
  arg_pattern: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  audit_id: string;
  agente_id: string;
  mcp_id: string;
  tool_name: string;
  decision: McpToolConsentDecision;
  outcome: "allowed" | "blocked" | "prompted";
  reason: string;
  args_preview: string;
  created_at: string;
}

function toConsentRule(row: ConsentRow): McpToolConsentRule {
  return {
    consentId: row.consent_id,
    agenteId: row.agente_id,
    mcpId: row.mcp_id,
    toolName: row.tool_name,
    decision: row.decision,
    argPattern: row.arg_pattern,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAuditEntry(row: AuditRow): McpApprovalAuditEntry {
  return {
    auditId: row.audit_id,
    agenteId: row.agente_id,
    mcpId: row.mcp_id,
    toolName: row.tool_name,
    decision: row.decision,
    outcome: row.outcome,
    reason: row.reason,
    argsPreview: row.args_preview,
    createdAt: row.created_at,
  };
}

/**
 * Gerenciador de consentimento granular e regras auditáveis de auto-aprovação
 * para ferramentas MCP por `(agenteId, mcpId, toolName)`.
 */
export class McpApprovalAutomationService {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public listConsents(agenteId?: string): McpToolConsentRule[] {
    const rows = (
      agenteId
        ? this.db.connection
            .prepare(
              `SELECT * FROM mcp_tool_consents WHERE agente_id = ? ORDER BY updated_at DESC;`,
            )
            .all(agenteId)
        : this.db.connection
            .prepare(`SELECT * FROM mcp_tool_consents ORDER BY updated_at DESC;`)
            .all()
    ) as unknown as ConsentRow[];
    return rows.map(toConsentRule);
  }

  public upsertConsent(params: {
    agenteId: string;
    mcpId: string;
    toolName: string;
    decision: McpToolConsentDecision;
    argPattern?: string | null;
    expiresAt?: string | null;
  }): McpToolConsentRule {
    const now = new Date().toISOString();
    const consentId = `mcpc_${randomUUID().slice(0, 10)}`;
    const agenteId = params.agenteId.trim() || "*";
    const mcpId = params.mcpId.trim();
    const toolName = params.toolName.trim();

    this.db.connection
      .prepare(
        `INSERT INTO mcp_tool_consents (
          consent_id, agente_id, mcp_id, tool_name, decision, arg_pattern, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agente_id, mcp_id, tool_name) DO UPDATE SET
          decision = excluded.decision,
          arg_pattern = excluded.arg_pattern,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at;`,
      )
      .run(
        consentId,
        agenteId,
        mcpId,
        toolName,
        params.decision,
        params.argPattern?.trim() || null,
        params.expiresAt ?? null,
        now,
        now,
      );

    const saved = this.db.connection
      .prepare(
        `SELECT * FROM mcp_tool_consents WHERE agente_id = ? AND mcp_id = ? AND tool_name = ?;`,
      )
      .get(agenteId, mcpId, toolName) as unknown as ConsentRow;
    return toConsentRule(saved);
  }

  public revokeConsent(consentId: string): boolean {
    const info = this.db.connection
      .prepare("DELETE FROM mcp_tool_consents WHERE consent_id = ?;")
      .run(consentId);
    return info.changes > 0;
  }

  public listAudit(agenteId?: string, limit = 50): McpApprovalAuditEntry[] {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = (
      agenteId
        ? this.db.connection
            .prepare(
              `SELECT * FROM mcp_approval_audit WHERE agente_id = ? ORDER BY created_at DESC LIMIT ?;`,
            )
            .all(agenteId, safeLimit)
        : this.db.connection
            .prepare(`SELECT * FROM mcp_approval_audit ORDER BY created_at DESC LIMIT ?;`)
            .all(safeLimit)
    ) as unknown as AuditRow[];
    return rows.map(toAuditEntry);
  }

  private recordAudit(params: {
    agenteId: string;
    mcpId: string;
    toolName: string;
    decision: McpToolConsentDecision;
    outcome: "allowed" | "blocked" | "prompted";
    reason: string;
    args: Record<string, unknown>;
  }): void {
    const now = new Date().toISOString();
    const auditId = `mcpa_${randomUUID().slice(0, 10)}`;
    const argsPreview = JSON.stringify(params.args ?? {}).slice(0, 240);
    this.db.connection
      .prepare(
        `INSERT INTO mcp_approval_audit (
          audit_id, agente_id, mcp_id, tool_name, decision, outcome, reason, args_preview, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      )
      .run(
        auditId,
        params.agenteId,
        params.mcpId,
        params.toolName,
        params.decision,
        params.outcome,
        params.reason,
        argsPreview,
        now,
      );
  }

  private findEffectiveRule(
    agenteId: string,
    mcpId: string,
    toolName: string,
  ): ConsentRow | undefined {
    const candidates = this.db.connection
      .prepare(
        `SELECT * FROM mcp_tool_consents
         WHERE (agente_id = ? OR agente_id = '*')
           AND mcp_id = ?
           AND (tool_name = ? OR tool_name = '*');`,
      )
      .all(agenteId, mcpId, toolName) as unknown as ConsentRow[];

    const nowMs = Date.now();
    const active = candidates.filter((row) => {
      if (!row.expires_at) return true;
      const exp = Date.parse(row.expires_at);
      return Number.isNaN(exp) || exp > nowMs;
    });

    // Prioriza regra específica de agente e ferramenta sobre curingas `*`
    active.sort((a, b) => {
      const scoreA = (a.agente_id !== "*" ? 2 : 0) + (a.tool_name !== "*" ? 1 : 0);
      const scoreB = (b.agente_id !== "*" ? 2 : 0) + (b.tool_name !== "*" ? 1 : 0);
      return scoreB - scoreA;
    });
    return active[0];
  }

  /**
   * Avalia a política efetiva para a invocação MCP, consumindo `allow_once` se aplicável
   * e gravando sempre um evento na trilha de auditoria `mcp_approval_audit`.
   */
  public evaluateExecution(params: {
    agenteId?: string | null;
    mcpId: string;
    toolName: string;
    args: Record<string, unknown>;
    defaultWhenUnset?: "allow" | "ask";
  }): {
    allowed: boolean;
    requiresConsent: boolean;
    decision: McpToolConsentDecision;
    reason: string;
  } {
    const agenteId = params.agenteId?.trim() || "sistema";
    const rule = this.findEffectiveRule(agenteId, params.mcpId, params.toolName);

    if (!rule) {
      if (params.defaultWhenUnset === "ask") {
        this.recordAudit({
          agenteId,
          mcpId: params.mcpId,
          toolName: params.toolName,
          decision: "ask",
          outcome: "prompted",
          reason: "Sem regra explícita; requer confirmação interativa.",
          args: params.args,
        });
        return {
          allowed: false,
          requiresConsent: true,
          decision: "ask",
          reason: "Confirmação interativa requerida para esta ferramenta MCP.",
        };
      }
      return {
        allowed: true,
        requiresConsent: false,
        decision: "always_allow",
        reason: "Execução permitida na política padrão do servidor autorizado.",
      };
    }

    if (rule.arg_pattern) {
      const serialized = JSON.stringify(params.args ?? {});
      if (!serialized.includes(rule.arg_pattern)) {
        this.recordAudit({
          agenteId,
          mcpId: params.mcpId,
          toolName: params.toolName,
          decision: "ask",
          outcome: "prompted",
          reason: `Argumentos não correspondem ao padrão condicional '${rule.arg_pattern}'.`,
          args: params.args,
        });
        return {
          allowed: false,
          requiresConsent: true,
          decision: "ask",
          reason: `Requer aprovação: padrão '${rule.arg_pattern}' não encontrado nos argumentos.`,
        };
      }
    }

    if (rule.decision === "deny") {
      this.recordAudit({
        agenteId,
        mcpId: params.mcpId,
        toolName: params.toolName,
        decision: "deny",
        outcome: "blocked",
        reason: "Ferramenta bloqueada por regra granular de consentimento MCP.",
        args: params.args,
      });
      return {
        allowed: false,
        requiresConsent: false,
        decision: "deny",
        reason: `Acesso bloqueado por política granular para '${params.toolName}'.`,
      };
    }

    if (rule.decision === "ask") {
      this.recordAudit({
        agenteId,
        mcpId: params.mcpId,
        toolName: params.toolName,
        decision: "ask",
        outcome: "prompted",
        reason: "Política configurada para perguntar ao operador.",
        args: params.args,
      });
      return {
        allowed: false,
        requiresConsent: true,
        decision: "ask",
        reason: `Consentimento explícito exigido antes de executar '${params.toolName}'.`,
      };
    }

    if (rule.decision === "allow_once") {
      this.revokeConsent(rule.consent_id);
      this.recordAudit({
        agenteId,
        mcpId: params.mcpId,
        toolName: params.toolName,
        decision: "allow_once",
        outcome: "allowed",
        reason: "Consentimento único (allow_once) consumido e registrado.",
        args: params.args,
      });
      return {
        allowed: true,
        requiresConsent: false,
        decision: "allow_once",
        reason: "Autorizado uma única vez (allow_once).",
      };
    }

    this.recordAudit({
      agenteId,
      mcpId: params.mcpId,
      toolName: params.toolName,
      decision: "always_allow",
      outcome: "allowed",
      reason: "Auto-aprovado por regra always_allow auditável.",
      args: params.args,
    });
    return {
      allowed: true,
      requiresConsent: false,
      decision: "always_allow",
      reason: "Auto-aprovado por política always_allow.",
    };
  }
}
