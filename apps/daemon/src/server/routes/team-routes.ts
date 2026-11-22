import type { TeamRole } from "@criativo/contracts";
import { assertTeamRoleAtLeast, resolveTeamActor, TeamRbacError } from "../../team/rbac-middleware.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

const VALID_ROLES = new Set<TeamRole>(["owner", "admin", "editor", "viewer"]);

export async function tryHandleTeamAndAuditRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, wsHub } = ctx;
  const { sendJson, readJsonBody, teamService, crmService, voiceHostService } = deps;

  if (method === "GET" && path === "/api/team/capabilities") {
    if (!teamService) {
      sendJson(res, 503, { erro: "TeamService não inicializado." });
      return true;
    }
    sendJson(
      res,
      200,
      teamService.getCapabilities({
        crmEnabled: crmService?.isEnabled() ?? false,
        voiceLocalSupported: Boolean(voiceHostService),
      }),
    );
    return true;
  }

  if (method === "POST" && path === "/api/team/invites/accept") {
    if (!teamService) {
      sendJson(res, 503, { erro: "TeamService não inicializado." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const out = teamService.acceptInvite({
        inviteToken: String(body.inviteToken ?? ""),
        displayName: String(body.displayName ?? ""),
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (path.startsWith("/api/team/") || path === "/api/audit" || path.startsWith("/api/workflows/presence")) {
    let actor;
    try {
      actor = resolveTeamActor(req, teamService);
    } catch (err) {
      const code = err instanceof TeamRbacError ? err.statusCode : 401;
      sendJson(res, code, { erro: err instanceof Error ? err.message : String(err) });
      return true;
    }

    if (!teamService) {
      sendJson(res, 503, { erro: "TeamService não inicializado." });
      return true;
    }

    if (method === "GET" && path === "/api/team/members") {
      sendJson(res, 200, { members: teamService.listMembers(), invites: teamService.listInvites() });
      return true;
    }

    if (method === "POST" && path === "/api/team/invites") {
      try {
        assertTeamRoleAtLeast(actor, "admin");
        const body = await readJsonBody(req);
        const role = String(body.role ?? "editor") as Exclude<TeamRole, "owner">;
        if (!["admin", "editor", "viewer"].includes(role)) {
          sendJson(res, 400, { erro: "Papel de convite inválido (use admin, editor ou viewer)." });
          return true;
        }
        const out = teamService.createInvite({
          email: String(body.email ?? ""),
          role,
          actorLabel: actor.label,
          actorMemberId: actor.memberId,
        });
        sendJson(res, 201, { ok: true, ...out });
      } catch (err) {
        const code = err instanceof TeamRbacError ? err.statusCode : 400;
        sendJson(res, code, { erro: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    const memberRoleMatch = path.match(/^\/api\/team\/members\/([^/]+)\/role$/);
    if (method === "PATCH" && memberRoleMatch) {
      try {
        assertTeamRoleAtLeast(actor, "admin");
        const memberId = decodeURIComponent(memberRoleMatch[1]!);
        const body = await readJsonBody(req);
        const role = String(body.role ?? "") as TeamRole;
        if (!VALID_ROLES.has(role)) {
          sendJson(res, 400, { erro: "Papel inválido." });
          return true;
        }
        const updated = teamService.updateMemberRole(memberId, role, {
          memberId: actor.memberId,
          label: actor.label,
        });
        sendJson(res, updated ? 200 : 404, { ok: Boolean(updated), member: updated });
      } catch (err) {
        const code = err instanceof TeamRbacError ? err.statusCode : 400;
        sendJson(res, code, { erro: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    const memberDeleteMatch = path.match(/^\/api\/team\/members\/([^/]+)$/);
    if (method === "DELETE" && memberDeleteMatch) {
      try {
        assertTeamRoleAtLeast(actor, "admin");
        const memberId = decodeURIComponent(memberDeleteMatch[1]!);
        const ok = teamService.revokeMember(memberId, {
          memberId: actor.memberId,
          label: actor.label,
        });
        sendJson(res, ok ? 200 : 404, { ok });
      } catch (err) {
        const code = err instanceof TeamRbacError ? err.statusCode : 400;
        sendJson(res, code, { erro: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    const permMatch = path.match(/^\/api\/team\/members\/([^/]+)\/permissions$/);
    if (permMatch) {
      const memberId = decodeURIComponent(permMatch[1]!);
      if (method === "GET") {
        sendJson(res, 200, { permissions: teamService.listMemberPermissions(memberId) });
        return true;
      }
      if (method === "POST") {
        try {
          assertTeamRoleAtLeast(actor, "admin");
          const body = await readJsonBody(req);
          const targetKind = body.targetKind === "mcp" ? "mcp" : "agent";
          const targetId = String(body.targetId ?? "").trim();
          if (!targetId) {
            sendJson(res, 400, { erro: "Informe targetId." });
            return true;
          }
          const grant = teamService.setTargetPermission({
            memberId,
            targetKind,
            targetId,
            allowed: Boolean(body.allowed),
            actorLabel: actor.label,
          });
          sendJson(res, 200, { ok: true, grant });
        } catch (err) {
          const code = err instanceof TeamRbacError ? err.statusCode : 400;
          sendJson(res, code, { erro: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }
    }

    if (method === "GET" && path === "/api/audit") {
      try {
        assertTeamRoleAtLeast(actor, "admin");
        const limit = Number(url.searchParams.get("limit") ?? 100);
        const action = url.searchParams.get("action") ?? undefined;
        const actorMemberId = url.searchParams.get("actorMemberId") ?? undefined;
        sendJson(res, 200, {
          logs: teamService.audit.list({
            limit: Number.isFinite(limit) ? limit : 100,
            action,
            actorMemberId,
          }),
        });
      } catch (err) {
        const code = err instanceof TeamRbacError ? err.statusCode : 403;
        sendJson(res, code, { erro: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    if (path === "/api/workflows/presence") {
      if (method === "GET") {
        const workflowId = url.searchParams.get("workflowId") ?? "";
        sendJson(res, 200, { members: wsHub.listWorkflowPresence(workflowId) });
        return true;
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        const workflowId = String(body.workflowId ?? "").trim();
        if (!workflowId) {
          sendJson(res, 400, { erro: "Informe workflowId." });
          return true;
        }
        if (body.action === "leave") {
          const members = wsHub.leaveWorkflowPresence(
            workflowId,
            actor.memberId ?? String(body.memberId ?? "owner"),
          );
          sendJson(res, 200, { ok: true, members });
          return true;
        }
        const members = wsHub.upsertWorkflowPresence({
          workflowId,
          memberId: actor.memberId ?? String(body.memberId ?? "owner"),
          displayName: actor.label || String(body.displayName ?? "Owner"),
          role: actor.role,
          selectedNodeId: typeof body.selectedNodeId === "string" ? body.selectedNodeId : null,
          cursorX: typeof body.cursorX === "number" ? body.cursorX : null,
          cursorY: typeof body.cursorY === "number" ? body.cursorY : null,
        });
        sendJson(res, 200, { ok: true, members });
        return true;
      }
    }
  }

  return false;
}
