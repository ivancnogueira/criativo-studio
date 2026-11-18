import type {
  LicenseActivationStatus,
  ServerConnectionKind,
  ServerQuotaSummary,
  StudioServerRecord,
} from "@criativo/contracts";
import { getPlanLimits } from "@criativo/contracts";

export class ServerQuotaExceededError extends Error {
  readonly statusCode = 403;
  readonly code = "server_quota_exceeded";
  readonly quota: ServerQuotaSummary;

  constructor(message: string, quota: ServerQuotaSummary) {
    super(message);
    this.name = "ServerQuotaExceededError";
    this.quota = quota;
  }
}

export function evaluateServerQuota(
  licenseStatus: LicenseActivationStatus,
  servers: StudioServerRecord[],
  requestedKind?: Exclude<ServerConnectionKind, "primary">,
): ServerQuotaSummary {
  const planTier = licenseStatus.plan_tier;
  if (!licenseStatus.valid || !planTier) {
    return {
      allowed: false,
      servers_used: servers.length,
      max_servers: 0,
      local_used: 0,
      max_local_servers: 0,
      remote_used: 0,
      max_remote_servers: 0,
      reason: "Licença ativa necessária para gerenciar servidores.",
    };
  }

  const limits = getPlanLimits(planTier);
  const localUsed = servers.filter((s) => s.kind === "primary" || s.kind === "local_child").length;
  const remoteUsed = servers.filter((s) => s.kind === "remote_vps" || s.kind === "joined").length;
  const serversUsed = servers.length;

  const isUnlimitedTotal = limits.max_servers < 0;
  const withinTotal = isUnlimitedTotal || serversUsed < limits.max_servers;

  let withinKind = true;
  let reason: string | undefined;

  if (!withinTotal) {
    withinKind = false;
    reason = `Limite de ${limits.max_servers} servidores atingido no plano ${limits.nome_exibicao}. Faça upgrade para Agência 10 ou Agência Ilimitada.`;
  } else if (requestedKind === "local_child" && limits.max_local_servers >= 0 && localUsed >= limits.max_local_servers) {
    withinKind = false;
    reason =
      planTier === "individual"
        ? "Na Licença Individual você pode ter 1 servidor local (este PC) + 1 VPS remota. Múltiplos servidores locais estão disponíveis na Licença Agência 10 e Agência Ilimitada."
        : `Limite de ${limits.max_local_servers} servidor(es) local(is) atingido.`;
  } else if (
    (requestedKind === "remote_vps" || requestedKind === "joined") &&
    limits.max_remote_servers >= 0 &&
    remoteUsed >= limits.max_remote_servers
  ) {
    withinKind = false;
    reason = `Limite de ${limits.max_remote_servers} servidor(es) remoto(s) atingido no plano ${limits.nome_exibicao}.`;
  }

  return {
    allowed: withinTotal && withinKind,
    servers_used: serversUsed,
    max_servers: limits.max_servers,
    local_used: localUsed,
    max_local_servers: limits.max_local_servers,
    remote_used: remoteUsed,
    max_remote_servers: limits.max_remote_servers,
    reason,
  };
}

export function assertServerCreationAllowed(
  licenseStatus: LicenseActivationStatus,
  servers: StudioServerRecord[],
  requestedKind: Exclude<ServerConnectionKind, "primary">,
): ServerQuotaSummary {
  const summary = evaluateServerQuota(licenseStatus, servers, requestedKind);
  if (!summary.allowed) {
    throw new ServerQuotaExceededError(
      summary.reason ?? "Limite de servidores do plano atingido.",
      summary,
    );
  }
  return summary;
}
