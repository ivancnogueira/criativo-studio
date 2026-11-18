import {
  WORKFLOW_PORTS,
  isAnnotationNodeKind,
  normalizeNodeKind,
  normalizeWorkflowNode,
  workflowLoopEdges,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowStepRecord,
} from "@criativo/contracts";

export const MAX_LOOP_PASSES = 10;

export interface WorkflowMediaInput {
  path: string;
  arquivoId?: string;
  mimeType?: string;
  portType: WorkflowPortType;
}

export interface WorkflowBuiltInputs {
  inputText: string;
  mediaInputs: WorkflowMediaInput[];
  sourceSummaries: Array<{ origem: string; status: string }>;
}

export interface WorkflowRunScopeResult {
  scope: Set<string>;
  reused: WorkflowStepRecord[];
  loops: Set<string>;
  forward: WorkflowAresta[];
  entryNodeIds: string[];
}

export interface WorkflowNextAction {
  nodeId: string;
  action: "run" | "skip";
  reason?: string;
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortValue(item));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const entry = obj[key];
      if (entry !== undefined) {
        sorted[key] = stableSortValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

function buildNodeOrderMap(nos: readonly WorkflowNo[]): Map<string, number> {
  const order = new Map<string, number>();
  nos.forEach((n, idx) => {
    order.set(n.id, idx);
  });
  return order;
}

function stepChronoKey(step: WorkflowStepRecord, indexInRun: number): number {
  return indexInRun;
}

function edgeActiveForStep(
  edge: WorkflowAresta,
  sourceNode: WorkflowNo | undefined,
  sourceStep: WorkflowStepRecord | undefined
): boolean {
  if (!sourceStep || sourceStep.status !== "done") {
    return false;
  }
  if (sourceNode && normalizeNodeKind(sourceNode.tipo) === "condition") {
    return Boolean(edge.branch && sourceStep.branch === edge.branch);
  }
  return true;
}

function isStepDue(
  node: WorkflowNo,
  scope: Set<string>,
  forwardIn: Map<string, WorkflowAresta[]>,
  backIn: Map<string, WorkflowAresta[]>,
  nodeById: Map<string, WorkflowNo>,
  latestByNode: Map<string, WorkflowStepRecord>,
  latestIndexByNode: Map<string, number>,
  attemptCountByNode: Map<string, number>,
  maxLoopPasses: number
): boolean {
  const attempts = attemptCountByNode.get(node.id) ?? 0;
  const ownStep = latestByNode.get(node.id);
  const ownOrder = ownStep ? (latestIndexByNode.get(node.id) ?? -1) : -1;

  if (attempts === 0) {
    return true;
  }

  if (attempts >= maxLoopPasses) {
    return false;
  }

  // Se uma aresta de retorno (loop) produziu conclusão mais recente que a última etapa deste nó
  const backEdges = backIn.get(node.id) ?? [];
  for (const edge of backEdges) {
    if (!scope.has(edge.origem)) continue;
    const srcStep = latestByNode.get(edge.origem);
    const srcOrder = latestIndexByNode.get(edge.origem) ?? -1;
    if (
      srcOrder > ownOrder &&
      edgeActiveForStep(edge, nodeById.get(edge.origem), srcStep)
    ) {
      return true;
    }
  }

  // Ou se algum predecessor forward foi concluído/finalizado depois da última tentativa deste nó
  const fwdEdges = forwardIn.get(node.id) ?? [];
  for (const edge of fwdEdges) {
    if (!scope.has(edge.origem)) continue;
    const srcStep = latestByNode.get(edge.origem);
    const srcOrder = latestIndexByNode.get(edge.origem) ?? -1;
    if (
      srcStep &&
      (srcStep.status === "done" || srcStep.status === "failed" || srcStep.status === "skipped") &&
      srcOrder > ownOrder
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Ordenação topológica determinística (algoritmo de Kahn) sobre nós executáveis em escopo.
 * Desempata empates pela ordem original em `nos`.
 */
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
export function nextActions(params: {
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  scope: ReadonlySet<string>;
  steps: WorkflowStepRecord[];
  maxLoopPasses?: number;
}): WorkflowNextAction[] {
  const maxLoopPasses = params.maxLoopPasses ?? MAX_LOOP_PASSES;
  const execNodes = params.nos
    .map(normalizeWorkflowNode)
    .filter((n) => !isAnnotationNodeKind(n.tipo) && params.scope.has(n.id));

  const nodeById = new Map(execNodes.map((n) => [n.id, n]));
  const scopedEdges = params.arestas.filter(
    (e) => params.scope.has(e.origem) && params.scope.has(e.destino)
  );
  const loops = workflowLoopEdges(execNodes, scopedEdges);
  const forwardEdges = scopedEdges.filter((e) => !loops.has(e.id));
  const backEdges = scopedEdges.filter((e) => loops.has(e.id));

  const forwardIn = new Map<string, WorkflowAresta[]>();
  const backIn = new Map<string, WorkflowAresta[]>();
  for (const edge of forwardEdges) {
    const list = forwardIn.get(edge.destino) ?? [];
    list.push(edge);
    forwardIn.set(edge.destino, list);
  }
  for (const edge of backEdges) {
    const list = backIn.get(edge.destino) ?? [];
    list.push(edge);
    backIn.set(edge.destino, list);
  }

  const latestByNode = new Map<string, WorkflowStepRecord>();
  const latestIndexByNode = new Map<string, number>();
  const attemptCountByNode = new Map<string, number>();

  params.steps.forEach((step, idx) => {
    const key = stepChronoKey(step, idx);
    latestByNode.set(step.node_id, step);
    latestIndexByNode.set(step.node_id, key);
    attemptCountByNode.set(step.node_id, (attemptCountByNode.get(step.node_id) ?? 0) + 1);
  });

  const openNodes = new Set<string>();
  const dueNodes = new Set<string>();

  for (const node of execNodes) {
    const ownStep = latestByNode.get(node.id);
    if (ownStep && (ownStep.status === "running" || ownStep.status === "approval")) {
      openNodes.add(node.id);
      continue;
    }

    if (
      isStepDue(
        node,
        params.scope as Set<string>,
        forwardIn,
        backIn,
        nodeById,
        latestByNode,
        latestIndexByNode,
        attemptCountByNode,
        maxLoopPasses
      )
    ) {
      dueNodes.add(node.id);
    }
  }

  const topo = graphOrder(execNodes, forwardEdges, params.scope);
  const actions: WorkflowNextAction[] = [];
  const willChangeThisTick = new Set<string>(openNodes);

  for (const nodeId of topo) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    if (openNodes.has(nodeId) || !dueNodes.has(nodeId)) {
      continue;
    }

    const inEdges = forwardIn.get(nodeId) ?? [];
    const backEdgesForNode = backIn.get(nodeId) ?? [];
    const attempts = attemptCountByNode.get(nodeId) ?? 0;
    const ownOrder = latestIndexByNode.get(nodeId) ?? -1;

    // Se reativado por aresta de retorno (loop) ativa mais recente
    const triggeredByActiveLoop =
      attempts > 0 &&
      attempts < maxLoopPasses &&
      backEdgesForNode.some((e) => {
        const srcStep = latestByNode.get(e.origem);
        const srcOrder = latestIndexByNode.get(e.origem) ?? -1;
        return (
          srcOrder > ownOrder &&
          edgeActiveForStep(e, nodeById.get(e.origem), srcStep)
        );
      });

    if (triggeredByActiveLoop) {
      actions.push({ nodeId, action: "run" });
      willChangeThisTick.add(nodeId);
      continue;
    }

    // Aguarda se algum predecessor em forward estiver aberto, due ou agendado nesta rodada
    const waitingOnUpstream = inEdges.some((edge) => {
      if (willChangeThisTick.has(edge.origem) || dueNodes.has(edge.origem)) {
        return true;
      }
      const srcStep = latestByNode.get(edge.origem);
      return !srcStep;
    });

    if (waitingOnUpstream) {
      continue;
    }

    if (inEdges.length === 0) {
      if (attempts === 0) {
        actions.push({ nodeId, action: "run" });
        willChangeThisTick.add(nodeId);
      }
      continue;
    }

    let activeCount = 0;
    let failedCount = 0;
    let skippedOrInactiveCount = 0;

    for (const edge of inEdges) {
      const srcNode = nodeById.get(edge.origem);
      const srcStep = latestByNode.get(edge.origem);
      if (edgeActiveForStep(edge, srcNode, srcStep)) {
        activeCount += 1;
      } else if (srcStep && (srcStep.status === "failed" || srcStep.status === "stopped")) {
        failedCount += 1;
      } else {
        skippedOrInactiveCount += 1;
      }
    }

    const kind = normalizeNodeKind(node.tipo);
    const isJoin = inEdges.length > 1 && (kind === "llm" || kind === "agente");

    if (isJoin) {
      if (activeCount > 0 || failedCount > 0) {
        actions.push({ nodeId, action: "run" });
        willChangeThisTick.add(nodeId);
      } else {
        actions.push({
          nodeId,
          action: "skip",
          reason:
            skippedOrInactiveCount > 0
              ? "Todas as entradas de convergência foram puladas ou desativadas."
              : "Sem entradas ativas.",
        });
        willChangeThisTick.add(nodeId);
      }
      continue;
    }

    if (activeCount > 0 && failedCount === 0) {
      actions.push({ nodeId, action: "run" });
      willChangeThisTick.add(nodeId);
    } else {
      actions.push({
        nodeId,
        action: "skip",
        reason:
          failedCount > 0
            ? "Predecessor obrigatório falhou."
            : "Ramo upstream inativo ou pulado.",
      });
      willChangeThisTick.add(nodeId);
    }
  }

  return actions;
}

function parseStepArtifacts(rawJson: string): Array<{
  path: string;
  arquivoId?: string;
  mimeType?: string;
}> {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const results: Array<{ path: string; arquivoId?: string; mimeType?: string }> = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) {
        results.push({ path: item.trim() });
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const path =
          typeof obj.path === "string"
            ? obj.path
            : typeof obj.caminho === "string"
              ? obj.caminho
              : typeof obj.url === "string"
                ? obj.url
                : "";
        if (path) {
          results.push({
            path,
            arquivoId:
              typeof obj.arquivo_id === "string"
                ? obj.arquivo_id
                : typeof obj.arquivoId === "string"
                  ? obj.arquivoId
                  : undefined,
            mimeType:
              typeof obj.mime_type === "string"
                ? obj.mime_type
                : typeof obj.mimeType === "string"
                  ? obj.mimeType
                  : undefined,
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

function collectInputsFromEdges(
  node: WorkflowNo,
  nos: readonly WorkflowNo[],
  incomingEdges: readonly WorkflowAresta[],
  latestSteps: ReadonlyMap<string, WorkflowStepRecord>
): WorkflowBuiltInputs {
  const nodeById = new Map(nos.map(normalizeWorkflowNode).map((n) => [n.id, n]));
  const destKind = normalizeNodeKind(node.tipo);
  const destAcceptedPorts = WORKFLOW_PORTS[destKind].in;

  const textBlocks: string[] = [];
  const mediaInputs: WorkflowMediaInput[] = [];
  const sourceSummaries: Array<{ origem: string; status: string }> = [];
  const seenMediaKeys = new Set<string>();

  for (const edge of incomingEdges) {
    const srcNode = nodeById.get(edge.origem);
    const srcStep = latestSteps.get(edge.origem);
    if (!srcStep) continue;

    sourceSummaries.push({ origem: edge.origem, status: srcStep.status });

    if (srcStep.status === "failed" || srcStep.status === "stopped") {
      if (incomingEdges.length > 1 && (destKind === "llm" || destKind === "agente")) {
        const erroMsg = srcStep.erro?.trim() || "erro desconhecido";
        textBlocks.push(`Sem resposta: esta etapa falhou. Erro: ${erroMsg}`);
      }
      continue;
    }

    if (srcStep.status !== "done") {
      continue;
    }

    if (srcNode && normalizeNodeKind(srcNode.tipo) === "condition") {
      if (edge.branch !== srcStep.branch) {
        continue;
      }
    }

    const edgePort: WorkflowPortType = edge.type ?? "text";
    const artifacts = parseStepArtifacts(srcStep.artefatos_json);

    if (edgePort === "image" || edgePort === "file") {
      for (const art of artifacts) {
        const key = `${edgePort}:${art.path}:${art.arquivoId ?? ""}`;
        if (!seenMediaKeys.has(key)) {
          seenMediaKeys.add(key);
          mediaInputs.push({
            path: art.path,
            arquivoId: art.arquivoId,
            mimeType: art.mimeType,
            portType: edgePort,
          });
        }
      }
      if (srcStep.output && srcStep.output.trim() && (edgePort === "file" || destKind === "output" || destKind === "llm" || destKind === "agente")) {
        textBlocks.push(srcStep.output.trim());
      }
      continue;
    }

    // Porta text (ou padrão)
    const outText = srcStep.output?.trim() ?? "";
    if (outText) {
      textBlocks.push(outText);
    }

    // Se o predecessor também produziu mídia e o destino aceita image/file (ex: asset/approval -> gerar_imagem/output)
    if (artifacts.length > 0 && (destAcceptedPorts.includes("image") || destAcceptedPorts.includes("file"))) {
      for (const art of artifacts) {
        const inferredPort: WorkflowPortType =
          srcStep.output_tipo === "image" || art.mimeType?.startsWith("image/")
            ? "image"
            : "file";
        if (!destAcceptedPorts.includes(inferredPort)) continue;
        const key = `${inferredPort}:${art.path}:${art.arquivoId ?? ""}`;
        if (!seenMediaKeys.has(key)) {
          seenMediaKeys.add(key);
          mediaInputs.push({
            path: art.path,
            arquivoId: art.arquivoId,
            mimeType: art.mimeType,
            portType: inferredPort,
          });
        }
      }
    }
  }

  const inputText =
    textBlocks.length > 1
      ? textBlocks.map((block, index) => `Input ${index + 1}:\n\n${block}`).join("\n\n")
      : (textBlocks[0] ?? "");

  return {
    inputText,
    mediaInputs,
    sourceSummaries,
  };
}

/**
 * Consolida entradas de texto e artefatos de mídia/arquivo para execução de um nó em run ativo.
 */
export function buildNodeInputs(params: {
  node: WorkflowNo;
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  latestSteps: ReadonlyMap<string, WorkflowStepRecord>;
  loops: ReadonlySet<string>;
}): WorkflowBuiltInputs {
  const incoming = params.arestas.filter((edge) => {
    if (edge.destino !== params.node.id) return false;
    if (!params.loops.has(edge.id)) return true;
    const loopSrc = params.latestSteps.get(edge.origem);
    return Boolean(loopSrc && loopSrc.status === "done");
  });

  return collectInputsFromEdges(params.node, params.nos, incoming, params.latestSteps);
}

/**
 * Consolida entradas de predecessores já concluídos para execução isolada (`runStep`).
 */
export function soloInputs(params: {
  node: WorkflowNo;
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  latestDoneSteps: ReadonlyMap<string, WorkflowStepRecord>;
}): WorkflowBuiltInputs {
  const execNodes = params.nos.map(normalizeWorkflowNode).filter((n) => !isAnnotationNodeKind(n.tipo));
  const loops = workflowLoopEdges(execNodes, params.arestas);
  const incoming = params.arestas.filter(
    (edge) => edge.destino === params.node.id && !loops.has(edge.id)
  );
  return collectInputsFromEdges(params.node, params.nos, incoming, params.latestDoneSteps);
}

/**
 * Gera prompt determinístico para avaliação booleana de um nó `condition`.
 */
export function conditionPrompt(rule: string, inputText: string): string {
  const safeRule = rule.trim() || "A entrada atende ao critério especificado?";
  const safeInput = inputText.trim() || "(vazio)";
  return [
    "Você é um avaliador de condição booleana em um workflow automatizado.",
    "Avalie a REGRA abaixo sobre a ENTRADA e responda ESTRITAMENTE com uma única palavra: yes ou no.",
    "Não inclua explicações, pontuação ou formatação markdown.",
    "",
    `REGRA: ${safeRule}`,
    "",
    "ENTRADA:",
    safeInput,
  ].join("\n");
}

/**
 * Normaliza a resposta textual de um LLM para `"yes"`, `"no"` ou `null` (ambíguo).
 */
export function conditionAnswer(rawText: string): WorkflowBranch | null {
  const cleaned = rawText
    .trim()
    .toLowerCase()
    .replace(/[`*_~"'.,:;!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  const firstToken = cleaned.split(" ")[0] ?? "";
  if (firstToken === "yes" || firstToken === "true" || firstToken === "sim") {
    return "yes";
  }
  if (
    firstToken === "no" ||
    firstToken === "false" ||
    firstToken === "nao" ||
    firstToken === "não"
  ) {
    return "no";
  }
  return null;
}

/**
 * Verifica por BFS reversa (ignorando loop edges) se existe ao menos um nó `approval`
 * já aprovado (`status === "done"`) a montante de `nodeId` (proteção para publicação Meta).
 */
export function hasUpstreamApprovedStep(
  nodeId: string,
  arestas: readonly WorkflowAresta[],
  stepsByNode: ReadonlyMap<string, WorkflowStepRecord>,
  loops: ReadonlySet<string>,
  nos?: readonly WorkflowNo[]
): boolean {
  const nodeKindById = new Map<string, string>();
  if (nos) {
    for (const n of nos) {
      nodeKindById.set(n.id, normalizeNodeKind(n.tipo));
    }
  }

  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of arestas) {
      if (loops.has(edge.id) || edge.destino !== current) continue;
      const parentId = edge.origem;
      if (visited.has(parentId)) continue;
      visited.add(parentId);

      const step = stepsByNode.get(parentId);
      const kind = nodeKindById.get(parentId) ?? step?.kind;
      if (kind === "approval" && step?.status === "done") {
        return true;
      }

      queue.push(parentId);
    }
  }

  return false;
}
