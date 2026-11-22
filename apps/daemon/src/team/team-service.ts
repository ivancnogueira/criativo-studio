import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AgentAccessGrant,
  TeamCapabilities,
  TeamInvite,
  TeamMember,
  TeamRole,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { ServerAuditStore } from "./server-audit-store.ts";

interface MemberRow {
  member_id: string;
  email: string;
  display_name: string;
  role: TeamRole;
  token_hash: string;
  status: "active" | "revoked";
  created_at: string;
  last_active_at: string | null;
}

interface InviteRow {
  invite_id: string;
  email: string;
  role: Exclude<TeamRole, "owner">;
  token_hash: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  created_at: string;
}

function hashSecretToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function toTeamMember(row: MemberRow): TeamMember {
  return {
    memberId: row.member_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

export class TeamService {
  private readonly db: CriativoDatabase;
  public readonly audit: ServerAuditStore;

  constructor(db: CriativoDatabase, audit?: ServerAuditStore) {
    this.db = db;
    this.audit = audit ?? new ServerAuditStore(db);
  }

  public getCapabilities(options?: { crmEnabled?: boolean; voiceLocalSupported?: boolean }): TeamCapabilities {
    return {
      apiVersion: "1.0",
      teamEnabled: true,
      crmEnabled: Boolean(options?.crmEnabled),
      voiceLocalSupported: options?.voiceLocalSupported !== false,
      supportedRoles: ["owner", "admin", "editor", "viewer"],
      features: [
        "team.invites",
        "team.rbac",
        "team.agent_permissions",
        "team.mcp_permissions",
        "team.workflow_presence",
        "team.audit",
      ],
    };
  }

  public listMembers(): TeamMember[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM team_members ORDER BY created_at ASC;")
      .all() as unknown as MemberRow[];
    return rows.map(toTeamMember);
  }

  public listInvites(): TeamInvite[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM team_invites ORDER BY created_at DESC;")
      .all() as unknown as InviteRow[];
    return rows.map((r) => ({
      inviteId: r.invite_id,
      email: r.email,
      role: r.role,
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }

  public createInvite(params: {
    email: string;
    role: Exclude<TeamRole, "owner">;
    actorLabel?: string;
    actorMemberId?: string | null;
    ttlHours?: number;
  }): { invite: TeamInvite; inviteToken: string } {
    const email = params.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("Informe um e-mail válido para convidar um membro.");
    }
    const inviteId = `inv_${randomUUID().slice(0, 10)}`;
    const inviteToken = `crv_inv_${randomBytes(18).toString("hex")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.ttlHours ?? 48) * 3600_000).toISOString();

    this.db.connection
      .prepare(
        `INSERT INTO team_invites (invite_id, email, role, token_hash, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?);`,
      )
      .run(inviteId, email, params.role, hashSecretToken(inviteToken), expiresAt, now.toISOString());

    this.audit.record({
      actorMemberId: params.actorMemberId ?? null,
      actorLabel: params.actorLabel ?? "owner",
      action: "team.invite.created",
      resourceType: "team_invite",
      resourceId: inviteId,
      detail: { email, role: params.role },
    });

    return {
      invite: {
        inviteId,
        email,
        role: params.role,
        status: "pending",
        expiresAt,
        createdAt: now.toISOString(),
      },
      inviteToken,
    };
  }

  public acceptInvite(params: {
    inviteToken: string;
    displayName: string;
  }): { member: TeamMember; memberToken: string } {
    const tokenHash = hashSecretToken(params.inviteToken.trim());
    const invite = this.db.connection
      .prepare("SELECT * FROM team_invites WHERE token_hash = ? LIMIT 1;")
      .get(tokenHash) as unknown as InviteRow | undefined;

    if (!invite || invite.status !== "pending") {
      throw new Error("Convite inválido ou já utilizado.");
    }
    if (Date.parse(invite.expires_at) <= Date.now()) {
      this.db.connection
        .prepare("UPDATE team_invites SET status = 'expired' WHERE invite_id = ?;")
        .run(invite.invite_id);
      throw new Error("Convite expirado.");
    }

    const memberId = `mem_${randomUUID().slice(0, 10)}`;
    const memberToken = `crv_mem_${randomBytes(20).toString("hex")}`;
    const now = new Date().toISOString();
    const displayName = params.displayName.trim() || invite.email.split("@")[0] || "Membro";

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare("UPDATE team_invites SET status = 'accepted' WHERE invite_id = ?;")
        .run(invite.invite_id);

      this.db.connection
        .prepare(
          `INSERT INTO team_members (member_id, email, display_name, role, token_hash, status, created_at, last_active_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             display_name = excluded.display_name,
             role = excluded.role,
             token_hash = excluded.token_hash,
             status = 'active',
             last_active_at = excluded.last_active_at;`,
        )
        .run(memberId, invite.email, displayName, invite.role, hashSecretToken(memberToken), now, now);
    });

    const row = this.db.connection
      .prepare("SELECT * FROM team_members WHERE email = ? LIMIT 1;")
      .get(invite.email) as unknown as MemberRow;

    this.audit.record({
      actorMemberId: row.member_id,
      actorLabel: row.display_name,
      action: "team.invite.accepted",
      resourceType: "team_member",
      resourceId: row.member_id,
      detail: { role: row.role },
    });

    return { member: toTeamMember(row), memberToken };
  }

  public authenticateMemberToken(rawToken: string): TeamMember | null {
    const clean = rawToken.trim();
    if (!clean) return null;
    const row = this.db.connection
      .prepare("SELECT * FROM team_members WHERE token_hash = ? AND status = 'active' LIMIT 1;")
      .get(hashSecretToken(clean)) as unknown as MemberRow | undefined;
    if (!row) return null;

    this.db.connection
      .prepare("UPDATE team_members SET last_active_at = ? WHERE member_id = ?;")
      .run(new Date().toISOString(), row.member_id);
    return toTeamMember(row);
  }

  public updateMemberRole(
    memberId: string,
    role: TeamRole,
    actor?: { memberId?: string | null; label?: string },
  ): TeamMember | null {
    const info = this.db.connection
      .prepare("UPDATE team_members SET role = ? WHERE member_id = ?;")
      .run(role, memberId);
    if (info.changes === 0) return null;

    this.audit.record({
      actorMemberId: actor?.memberId ?? null,
      actorLabel: actor?.label ?? "owner",
      action: "team.member.role_updated",
      resourceType: "team_member",
      resourceId: memberId,
      detail: { role },
    });

    const row = this.db.connection
      .prepare("SELECT * FROM team_members WHERE member_id = ?;")
      .get(memberId) as unknown as MemberRow;
    return toTeamMember(row);
  }

  public revokeMember(
    memberId: string,
    actor?: { memberId?: string | null; label?: string },
  ): boolean {
    const info = this.db.connection
      .prepare("UPDATE team_members SET status = 'revoked' WHERE member_id = ?;")
      .run(memberId);
    if (info.changes > 0) {
      this.audit.record({
        actorMemberId: actor?.memberId ?? null,
        actorLabel: actor?.label ?? "owner",
        action: "team.member.revoked",
        resourceType: "team_member",
        resourceId: memberId,
      });
      return true;
    }
    return false;
  }

  public setTargetPermission(params: {
    memberId: string;
    targetKind: "agent" | "mcp";
    targetId: string;
    allowed: boolean;
    actorLabel?: string;
  }): AgentAccessGrant {
    const grantId = `grt_${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const table = params.targetKind === "agent" ? "team_agent_permissions" : "team_mcp_permissions";
    const col = params.targetKind === "agent" ? "agente_id" : "mcp_id";

    this.db.connection
      .prepare(
        `INSERT INTO ${table} (grant_id, member_id, ${col}, allowed, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(member_id, ${col}) DO UPDATE SET
           allowed = excluded.allowed,
           updated_at = excluded.updated_at;`,
      )
      .run(grantId, params.memberId, params.targetId, params.allowed ? 1 : 0, now);

    this.audit.record({
      actorLabel: params.actorLabel ?? "owner",
      action: `team.permission.${params.targetKind}_updated`,
      resourceType: params.targetKind,
      resourceId: params.targetId,
      detail: { memberId: params.memberId, allowed: params.allowed },
    });

    return {
      grantId,
      memberId: params.memberId,
      targetKind: params.targetKind,
      targetId: params.targetId,
      allowed: params.allowed,
      updatedAt: now,
    };
  }

  public listMemberPermissions(memberId: string): AgentAccessGrant[] {
    const agentRows = this.db.connection
      .prepare("SELECT grant_id, member_id, agente_id AS target_id, allowed, updated_at FROM team_agent_permissions WHERE member_id = ?;")
      .all(memberId) as unknown as Array<{
      grant_id: string;
      member_id: string;
      target_id: string;
      allowed: number;
      updated_at: string;
    }>;

    const mcpRows = this.db.connection
      .prepare("SELECT grant_id, member_id, mcp_id AS target_id, allowed, updated_at FROM team_mcp_permissions WHERE member_id = ?;")
      .all(memberId) as unknown as typeof agentRows;

    return [
      ...agentRows.map((r) => ({
        grantId: r.grant_id,
        memberId: r.member_id,
        targetKind: "agent" as const,
        targetId: r.target_id,
        allowed: r.allowed === 1,
        updatedAt: r.updated_at,
      })),
      ...mcpRows.map((r) => ({
        grantId: r.grant_id,
        memberId: r.member_id,
        targetKind: "mcp" as const,
        targetId: r.target_id,
        allowed: r.allowed === 1,
        updatedAt: r.updated_at,
      })),
    ];
  }

  public canMemberAccessTarget(
    memberId: string,
    targetKind: "agent" | "mcp",
    targetId: string,
  ): boolean {
    const member = this.db.connection
      .prepare("SELECT role, status FROM team_members WHERE member_id = ? LIMIT 1;")
      .get(memberId) as unknown as { role: TeamRole; status: string } | undefined;
    if (!member || member.status !== "active") return false;
    if (member.role === "owner" || member.role === "admin") return true;

    const table = targetKind === "agent" ? "team_agent_permissions" : "team_mcp_permissions";
    const col = targetKind === "agent" ? "agente_id" : "mcp_id";
    const grants = this.db.connection
      .prepare(`SELECT ${col} AS target_id, allowed FROM ${table} WHERE member_id = ?;`)
      .all(memberId) as unknown as Array<{ target_id: string; allowed: number }>;

    if (grants.length === 0) return true;
    const specific = grants.find((g) => g.target_id === targetId);
    if (specific) return specific.allowed === 1;
    const wildcard = grants.find((g) => g.target_id === "*");
    return wildcard ? wildcard.allowed === 1 : false;
  }
}
