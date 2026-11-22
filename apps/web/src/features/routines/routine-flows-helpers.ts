import type {
  AgenteRegistro,
  RoutineFlowCanvas,
  RoutineFlowConnectProblem,
  RoutineFlowLink,
  RoutineFlowStep,
} from "@criativo/contracts";
import {
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";

export interface RoutineFlowsCanvasProps {
  agente: AgenteRegistro | null;
  allAgentes: AgenteRegistro[];
  initialCanvas?: RoutineFlowCanvas | null;
  refreshSignal?: number;
  onOpenRoutineSettings: (rotinaId?: string | null) => void;
  onOpenAgentChat: (agenteId: string) => void;
}

export const FOCUS_COLORS = ["#007CF7", "#31CF76", "#FF9412", "#A855F7", "#EC4899"];

export function computeConnectProblem(
  ownerId: string,
  fromAgentId: string,
  toAgentId: string,
  routineLinks: readonly RoutineFlowLink[]
): RoutineFlowConnectProblem | null {
  if (fromAgentId === toAgentId) return "same-agent";
  if (toAgentId === ownerId) return "into-owner";

  // Calcula alcançáveis a partir de ownerId
  const adj = new Map<string, string[]>();
  for (const link of routineLinks) {
    const arr = adj.get(link.from_agent_id) ?? [];
    arr.push(link.to_agent_id);
    adj.set(link.from_agent_id, arr);
  }

  const reachable = new Set<string>([ownerId]);
  const q = [ownerId];
  while (q.length > 0) {
    const curr = q.shift()!;
    for (const nxt of adj.get(curr) ?? []) {
      if (!reachable.has(nxt)) {
        reachable.add(nxt);
        q.push(nxt);
      }
    }
  }
  if (!reachable.has(fromAgentId)) return "not-on-path";

  if (
    routineLinks.some((l) => l.from_agent_id === fromAgentId && l.to_agent_id === toAgentId)
  ) {
    return "duplicate";
  }

  // Verifica ciclo: se a partir de toAgentId for possível alcançar fromAgentId
  const revQ = [toAgentId];
  const visited = new Set<string>([toAgentId]);
  while (revQ.length > 0) {
    const curr = revQ.shift()!;
    if (curr === fromAgentId) return "cycle";
    for (const nxt of adj.get(curr) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt);
        revQ.push(nxt);
      }
    }
  }

  return null;
}

export function getAgentAvatar(ag: AgenteRegistro | undefined, id: string) {
  return resolveAgentAvatarConfig(ag, id);
}

export function stepBadgeMeta(status: RoutineFlowStep["status"] | "waiting" | "unreachable"): {
  label: string;
  classes: string;
} {
  switch (status) {
    case "running":
      return { label: "Executando", classes: "bg-[#007CF7]/15 text-[#42A0FF]" };
    case "succeeded":
      return { label: "Concluído", classes: "bg-[#31CF76]/15 text-[#31CF76]" };
    case "failed":
      return { label: "Falha", classes: "bg-[#FD2F3B]/15 text-[#FD2F3B]" };
    case "skipped":
    case "cancelled":
      return { label: "Ignorado", classes: "bg-[#FF9412]/15 text-[#FF9412]" };
    case "unreachable":
      return { label: "Inalcançável", classes: "bg-white/[0.06] text-[#979797]" };
    default:
      return { label: "Aguardando", classes: "bg-white/[0.06] text-[#DCDCDC]" };
  }
}

