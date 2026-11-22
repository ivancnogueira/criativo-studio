import { randomUUID } from "node:crypto";
import type { ServerAuditEntry } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

interface AuditDbRow {
  audit_id: string;
  actor_member_id: string | null;
  actor_label: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  detail_json: string;
  created_at: string;
}

export class ServerAuditStore {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public record(params: {
    actorMemberId?: string | null;
    actorLabel: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    detail?: Record<string, unknown>;
  }): ServerAuditEntry {
    const auditId = `aud_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const detailJson = JSON.stringify(params.detail ?? {});

    this.db.connection
      .prepare(
        `INSERT INTO server_audit_logs (
          audit_id, actor_member_id, actor_label, action, resource_type, resource_id, detail_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      )
      .run(
        auditId,
        params.actorMemberId ?? null,
        params.actorLabel,
        params.action,
        params.resourceType,
        params.resourceId ?? null,
        detailJson,
        now,
      );

    return {
      auditId,
      actorMemberId: params.actorMemberId ?? null,
      actorLabel: params.actorLabel,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      detailJson,
      createdAt: now,
    };
  }

  public list(filter?: {
    actorMemberId?: string;
    action?: string;
    limit?: number;
  }): ServerAuditEntry[] {
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 100));
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter?.actorMemberId?.trim()) {
      conditions.push("actor_member_id = ?");
      params.push(filter.actorMemberId.trim());
    }
    if (filter?.action?.trim()) {
      conditions.push("action = ?");
      params.push(filter.action.trim());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM server_audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ?;`,
      )
      .all(...params, limit) as unknown as AuditDbRow[];

    return rows.map((r) => ({
      auditId: r.audit_id,
      actorMemberId: r.actor_member_id,
      actorLabel: r.actor_label,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      detailJson: r.detail_json,
      createdAt: r.created_at,
    }));
  }
}
