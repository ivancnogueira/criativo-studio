import {
  normalizeNodeKind,
  type WorkflowAresta,
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

export function stableSortValue(value: unknown): unknown {
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

export function buildNodeOrderMap(nos: readonly WorkflowNo[]): Map<string, number> {
  const order = new Map<string, number>();
  nos.forEach((n, idx) => {
    order.set(n.id, idx);
  });
  return order;
}

export function stepChronoKey(step: WorkflowStepRecord, indexInRun: number): number {
  return indexInRun;
}

export function edgeActiveForStep(
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

export function isStepDue(
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
