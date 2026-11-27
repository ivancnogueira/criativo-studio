import {
  isAnnotationNodeKind,
  normalizeWorkflowNode,
  workflowLoopEdges,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowStepRecord,
} from "@criativo/contracts";
import { type WorkflowRunScopeResult, stableSortValue, buildNodeOrderMap } from "./workflow-walk-helpers.ts";

export function graphOrder(
  nos: readonly WorkflowNo[],
  edges: readonly WorkflowAresta[],
  scope?: ReadonlySet<string>
): string[] {
  const orderIndex = buildNodeOrderMap(nos);
  const execNodes = nos
    .map(normalizeWorkflowNode)
    .filter((n) => !isAnnotationNodeKind(n.tipo) && (!scope || scope.has(n.id)));

  const execIds = new Set(execNodes.map((n) => n.id));
  const scopedEdges = edges.filter((e) => execIds.has(e.origem) && execIds.has(e.destino));
  const loops = workflowLoopEdges(execNodes, scopedEdges);
  const forwardEdges = scopedEdges.filter((e) => !loops.has(e.id));

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of execNodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of forwardEdges) {
    adj.get(edge.origem)?.push(edge.destino);
    inDegree.set(edge.destino, (inDegree.get(edge.destino) ?? 0) + 1);
  }

  const ready: string[] = execNodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

  const sorted: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    sorted.push(current);

    for (const nextId of adj.get(current) ?? []) {
      const nextDeg = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg === 0) {
        ready.push(nextId);
        ready.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
      }
    }
  }

  return sorted;
}

/**
 * Serialização canônica do que o nó lê/executa (ignorando coordenadas x/y/width/height e nós de anotação).
 */
export function readsOf(
  node: WorkflowNo,
  nos: readonly WorkflowNo[],
  arestas: readonly WorkflowAresta[]
): string {
  const normalized = normalizeWorkflowNode(node);
  const nonAnnotationIds = new Set(
    nos.map(normalizeWorkflowNode).filter((n) => !isAnnotationNodeKind(n.tipo)).map((n) => n.id)
  );

  const incoming = arestas
    .filter((a) => a.destino === normalized.id && nonAnnotationIds.has(a.origem))
    .map((a) => ({
      origem: a.origem,
      type: a.type ?? "text",
      branch: a.branch ?? null,
    }))
    .sort((a, b) => {
      const cmpOrig = a.origem.localeCompare(b.origem);
      if (cmpOrig !== 0) return cmpOrig;
      const cmpType = a.type.localeCompare(b.type);
      if (cmpType !== 0) return cmpType;
      return String(a.branch ?? "").localeCompare(String(b.branch ?? ""));
    });

  const cleanConfig = { ...(normalized.config ?? {}) };
  delete cleanConfig.x;
  delete cleanConfig.y;
  delete cleanConfig.width;
  delete cleanConfig.height;

  const canonical = {
    tipo: normalized.tipo,
    triggerKind: normalized.triggerKind ?? null,
    trigger: normalized.trigger ?? null,
    prompt: normalized.prompt ?? null,
    systemPrompt: normalized.systemPrompt ?? null,
    model: normalized.model ?? null,
    provider: normalized.provider ?? null,
    effort: normalized.effort ?? null,
    agenteId: normalized.agenteId ?? null,
    fileId: normalized.fileId ?? null,
    rule: normalized.rule ?? null,
    question: normalized.question ?? null,
    target: normalized.target ?? null,
    targetRef: normalized.targetRef ?? null,
    answerFields: normalized.answerFields ?? null,
    conditionMode: normalized.conditionMode ?? null,
    deterministicRule: normalized.deterministicRule ?? null,
    config: cleanConfig,
    incoming,
  };

  return JSON.stringify(stableSortValue(canonical));
}

/**
 * Calcula quais etapas concluídas anteriormente continuam válidas (não ficaram obsoletas
 * por alterações nas configurações executáveis ou entradas de nós a montante).
 */
export function currentAnswers(
  graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] },
  latestDoneSteps: ReadonlyMap<string, WorkflowStepRecord>,
  ranWithGraph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] } | null
): Map<string, WorkflowStepRecord> {
  const valid = new Map<string, WorkflowStepRecord>();
  const curExecNodes = graph.nos.map(normalizeWorkflowNode).filter((n) => !isAnnotationNodeKind(n.tipo));
  const curExecById = new Map(curExecNodes.map((n) => [n.id, n]));

  if (!ranWithGraph) {
    for (const [nodeId, step] of latestDoneSteps.entries()) {
      if (step.status === "done" && curExecById.has(nodeId)) {
        valid.set(nodeId, step);
      }
    }
    return valid;
  }

  const ranExecById = new Map(
    ranWithGraph.nos
      .map(normalizeWorkflowNode)
      .filter((n) => !isAnnotationNodeKind(n.tipo))
      .map((n) => [n.id, n])
  );

  const curLoops = workflowLoopEdges(curExecNodes, graph.arestas);
  const forwardAdj = new Map<string, string[]>();
  for (const edge of graph.arestas) {
    if (curLoops.has(edge.id)) continue;
    if (!curExecById.has(edge.origem) || !curExecById.has(edge.destino)) continue;
    const list = forwardAdj.get(edge.origem) ?? [];
    list.push(edge.destino);
    forwardAdj.set(edge.origem, list);
  }

  const stale = new Set<string>();
  const queue: string[] = [];

  for (const curNode of curExecNodes) {
    const prevNode = ranExecById.get(curNode.id);
    if (!prevNode) {
      stale.add(curNode.id);
      queue.push(curNode.id);
      continue;
    }
    const curSig = readsOf(curNode, graph.nos, graph.arestas);
    const prevSig = readsOf(prevNode, ranWithGraph.nos, ranWithGraph.arestas);
    if (curSig !== prevSig) {
      stale.add(curNode.id);
      queue.push(curNode.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const childId of forwardAdj.get(id) ?? []) {
      if (!stale.has(childId)) {
        stale.add(childId);
        queue.push(childId);
      }
    }
  }

  for (const [nodeId, step] of latestDoneSteps.entries()) {
    if (step.status === "done" && curExecById.has(nodeId) && !stale.has(nodeId)) {
      valid.set(nodeId, step);
    }
  }

  return valid;
}

/**
 * Calcula o escopo exato de nós para uma execução completa, por gatilho ou parcial (`fromNodeId`),
 * aproveitando etapas ainda válidas de ancestrais em `reused`.
 */
export function runScope(
  graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] },
  options: {
    triggerNodeId?: string;
    fromNodeId?: string;
    answers: ReadonlyMap<string, WorkflowStepRecord>;
  }
): WorkflowRunScopeResult {
  const execNodes = graph.nos.map(normalizeWorkflowNode).filter((n) => !isAnnotationNodeKind(n.tipo));
  const execById = new Map(execNodes.map((n) => [n.id, n]));
  const execEdges = graph.arestas.filter((e) => execById.has(e.origem) && execById.has(e.destino));
  const loops = workflowLoopEdges(execNodes, execEdges);
  const forward = execEdges.filter((e) => !loops.has(e.id));

  const forwardAdj = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();
  for (const edge of forward) {
    const outList = forwardAdj.get(edge.origem) ?? [];
    outList.push(edge.destino);
    forwardAdj.set(edge.origem, outList);

    const inList = reverseAdj.get(edge.destino) ?? [];
    inList.push(edge.origem);
    reverseAdj.set(edge.destino, inList);
  }

  const reachForward = (startId: string): Set<string> => {
    const visited = new Set<string>();
    if (!execById.has(startId)) return visited;
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const nextId of forwardAdj.get(id) ?? []) {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      }
    }
    return visited;
  };

  if (options.fromNodeId) {
    const ahead = reachForward(options.fromNodeId);
    const needed = new Set<string>();
    const revQueue = [...ahead];
    while (revQueue.length > 0) {
      const id = revQueue.shift()!;
      for (const parentId of reverseAdj.get(id) ?? []) {
        if (!ahead.has(parentId) && !needed.has(parentId)) {
          needed.add(parentId);
          revQueue.push(parentId);
        }
      }
    }

    const reused: WorkflowStepRecord[] = [];
    for (const id of needed) {
      const ans = options.answers.get(id);
      if (ans) {
        reused.push(ans);
      }
    }

    return {
      scope: ahead,
      reused,
      loops,
      forward,
      entryNodeIds: execById.has(options.fromNodeId) ? [options.fromNodeId] : [],
    };
  }

  if (options.triggerNodeId) {
    const after = reachForward(options.triggerNodeId);
    const scope = new Set<string>(after);
    const upstreamQueue = [...after];

    // Inclui predecessores estáticos não-gatilho necessários (ex.: prompt/asset ligados a agente downstream)
    while (upstreamQueue.length > 0) {
      const id = upstreamQueue.shift()!;
      for (const parentId of reverseAdj.get(id) ?? []) {
        const parentNode = execById.get(parentId);
        if (!parentNode) continue;
        if (parentNode.tipo === "gatilho" && parentId !== options.triggerNodeId) {
          continue;
        }
        if (!scope.has(parentId)) {
          scope.add(parentId);
          upstreamQueue.push(parentId);
        }
      }
    }

    // Exclui outros gatilhos caso tenham ficado alcançáveis
    for (const id of [...scope]) {
      const n = execById.get(id);
      if (n?.tipo === "gatilho" && id !== options.triggerNodeId) {
        scope.delete(id);
      }
    }

    return {
      scope,
      reused: [],
      loops,
      forward,
      entryNodeIds: execById.has(options.triggerNodeId) ? [options.triggerNodeId] : [],
    };
  }

  const scope = new Set(execNodes.map((n) => n.id));
  const entryNodeIds = execNodes
    .filter((n) => (reverseAdj.get(n.id)?.length ?? 0) === 0)
    .map((n) => n.id);

  return {
    scope,
    reused: [],
    loops,
    forward,
    entryNodeIds,
  };
}

/**
 * Decide quais nós estão prontos para iniciar (`run`) ou devem ser marcados como pulados (`skip`)
 * no estado atual de um run em andamento.
 */
