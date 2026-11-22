import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { CriativoDatabase } from "../src/database/client.ts";
import { TeamService } from "../src/team/team-service.ts";
import { assertTeamRoleAtLeast, resolveTeamActor, TeamRbacError } from "../src/team/rbac-middleware.ts";

test("TeamService + RBAC gerencia convites, papéis, permissões por agente/MCP e trilha auditável", () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-team-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  try {
    const team = new TeamService(db);

    // 1. Modo single-user local sem token opera como owner sem fricção
    const localActor = resolveTeamActor({ headers: {} } as IncomingMessage, team);
    assert.equal(localActor.role, "owner");
    assert.equal(localActor.mode, "single_user");

    // 2. Criação e aceite de convite para viewer
    const { inviteToken } = team.createInvite({
      email: "analista@agencia.exemplo",
      role: "viewer",
    });
    const { member, memberToken } = team.acceptInvite({
      inviteToken,
      displayName: "Analista Convidade",
    });
    assert.equal(member.role, "viewer");

    // 3. Autenticação pelo token de membro bloqueia mutações exigindo admin/editor
    const viewerActor = resolveTeamActor(
      { headers: { "x-criativo-member-token": memberToken } } as unknown as IncomingMessage,
      team,
    );
    assert.equal(viewerActor.role, "viewer");
    assert.throws(() => assertTeamRoleAtLeast(viewerActor, "editor"), TeamRbacError);

    // 4. Permissão granular por agente/MCP
    team.setTargetPermission({
      memberId: member.memberId,
      targetKind: "agent",
      targetId: "estrategista",
      allowed: true,
    });
    team.setTargetPermission({
      memberId: member.memberId,
      targetKind: "agent",
      targetId: "copywriter",
      allowed: false,
    });
    assert.equal(team.canMemberAccessTarget(member.memberId, "agent", "estrategista"), true);
    assert.equal(team.canMemberAccessTarget(member.memberId, "agent", "copywriter"), false);

    // 5. Trilha de auditoria registra todas as ações
    const logs = team.audit.list({ limit: 20 });
    assert.ok(logs.length >= 4);
    assert.ok(logs.some((l) => l.action === "team.invite.created"));
    assert.ok(logs.some((l) => l.action === "team.invite.accepted"));

    // 6. Revogar membro invalida seu token imediatamente
    assert.equal(team.revokeMember(member.memberId), true);
    assert.throws(
      () =>
        resolveTeamActor(
          { headers: { "x-criativo-member-token": memberToken } } as unknown as IncomingMessage,
          team,
        ),
      TeamRbacError,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
