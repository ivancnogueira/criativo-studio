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
import { MAX_LOOP_PASSES, type WorkflowMediaInput, type WorkflowBuiltInputs, type WorkflowNextAction, stepChronoKey, edgeActiveForStep, isStepDue } from "./workflow-walk-helpers.ts";
import { graphOrder } from "./workflow-walk-scope.ts";

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

export function parseStepArtifacts(rawJson: string): Array<{
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

export function collectInputsFromEdges(
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

