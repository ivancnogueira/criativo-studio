import type {
  RoutineFlowConnectProblem,
  RoutineFlowLink,
} from "@criativo/contracts";

/**
 * Calcula todos os agentes alcançáveis a partir de `ownerId` percorrendo o grafo direcionado.
 */
export function reachableFromOwner(
  ownerId: string,
  links: readonly RoutineFlowLink[]
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const link of links) {
    const bucket = adj.get(link.from_agent_id);
    if (bucket) {
      bucket.push(link.to_agent_id);
    } else {
      adj.set(link.from_agent_id, [link.to_agent_id]);
    }
  }

  const visited = new Set<string>([ownerId]);
  const queue: string[] = [ownerId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

/**
 * Calcula a profundidade mínima por BFS a partir do agente dono da rotina (`depth = 0`).
 */
export function routineFlowDepths(
  ownerId: string,
  links: readonly RoutineFlowLink[]
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const link of links) {
    const bucket = adj.get(link.from_agent_id);
    if (bucket) {
      bucket.push(link.to_agent_id);
    } else {
      adj.set(link.from_agent_id, [link.to_agent_id]);
    }
  }

  const depths = new Map<string, number>([[ownerId, 0]]);
  const queue: string[] = [ownerId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depths.get(current) ?? 0;
    for (const next of adj.get(current) ?? []) {
      if (!depths.has(next)) {
        depths.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }
  return depths;
}

function reachesTarget(
  startAgentId: string,
  targetAgentId: string,
  links: readonly RoutineFlowLink[]
): boolean {
  if (startAgentId === targetAgentId) return true;
  const adj = new Map<string, string[]>();
  for (const link of links) {
    const bucket = adj.get(link.from_agent_id);
    if (bucket) {
      bucket.push(link.to_agent_id);
    } else {
      adj.set(link.from_agent_id, [link.to_agent_id]);
    }
  }

  const visited = new Set<string>([startAgentId]);
  const queue: string[] = [startAgentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adj.get(current) ?? []) {
      if (next === targetAgentId) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Valida se uma nova aresta `(fromAgentId -> toAgentId)` preserva as invariantes de DAG
 * partindo do `ownerId` (`same-agent`, `into-owner`, `not-on-path`, `duplicate`, `cycle`).
 */
export function routineFlowConnectProblem(
  ownerId: string,
  fromAgentId: string,
  toAgentId: string,
  links: readonly RoutineFlowLink[]
): RoutineFlowConnectProblem | null {
  if (fromAgentId === toAgentId) {
    return "same-agent";
  }
  if (toAgentId === ownerId) {
    return "into-owner";
  }

  const reachable = reachableFromOwner(ownerId, links);
  if (!reachable.has(fromAgentId)) {
    return "not-on-path";
  }

  if (
    links.some(
      (link) => link.from_agent_id === fromAgentId && link.to_agent_id === toAgentId
    )
  ) {
    return "duplicate";
  }

  if (reachesTarget(toAgentId, fromAgentId, links)) {
    return "cycle";
  }

  return null;
}

/**
 * Identifica arestas que perderam alcançabilidade a partir de `ownerId` após remoção de um nó/aresta.
 */
export function strandedLinks(
  ownerId: string,
  links: readonly RoutineFlowLink[]
): RoutineFlowLink[] {
  const reachable = reachableFromOwner(ownerId, links);
  return links.filter((link) => !reachable.has(link.from_agent_id));
}

/**
 * Coleta ordenadamente todos os agentes envolvidos (origem e destino) em um conjunto de arestas.
 */
export function collectAffectedAgents(
  ownerId: string,
  links: readonly RoutineFlowLink[]
): string[] {
  const set = new Set<string>([ownerId]);
  for (const link of links) {
    set.add(link.from_agent_id);
    set.add(link.to_agent_id);
  }
  return Array.from(set);
}
