import type { IncomingMessage } from "node:http";
import type { TeamRole } from "@criativo/contracts";
import type { TeamService } from "./team-service.ts";

const ROLE_WEIGHT: Record<TeamRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export interface ResolvedTeamActor {
  mode: "single_user" | "team_member";
  memberId: string | null;
  label: string;
  role: TeamRole;
}

export class TeamRbacError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "TeamRbacError";
    this.statusCode = statusCode;
  }
}

/**
 * Resolve o ator da requisição HTTP:
 * se o cabeçalho `X-Criativo-Member-Token` estiver ausente, opera em modo `single_user` local
 * mantendo retrocompatibilidade integral (`owner`).
 */
export function resolveTeamActor(
  req: IncomingMessage,
  teamService?: TeamService,
): ResolvedTeamActor {
  const headerVal = req.headers["x-criativo-member-token"];
  const token = Array.isArray(headerVal) ? headerVal[0] : headerVal;

  if (!token || !token.trim() || !teamService) {
    return {
      mode: "single_user",
      memberId: null,
      label: "owner",
      role: "owner",
    };
  }

  const member = teamService.authenticateMemberToken(token);
  if (!member) {
    throw new TeamRbacError("Token de membro da equipe inválido ou revogado.", 401);
  }

  return {
    mode: "team_member",
    memberId: member.memberId,
    label: member.displayName,
    role: member.role,
  };
}

export function assertTeamRoleAtLeast(
  actor: ResolvedTeamActor,
  minimumRole: TeamRole,
): void {
  if (ROLE_WEIGHT[actor.role] < ROLE_WEIGHT[minimumRole]) {
    throw new TeamRbacError(
      `Permissão insuficiente: papel '${actor.role}' não pode executar esta ação (requer '${minimumRole}').`,
      403,
    );
  }
}
