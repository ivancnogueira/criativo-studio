import {
  randomUUID,
} from "node:crypto";
import {
  canConnectPorts,
  isAnnotationNodeKind,
  normalizeWorkflowNode,
  workflowGraphProblemAt,
  workflowLoopEdges,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowPortType,
} from "@criativo/contracts";
import {
  WorkflowValidationError,
} from "./workflow-store.ts";
import {
  graphOrder,
} from "./workflow-walk.ts";
import { LAYOUT_COL_WIDTH, LAYOUT_ROW_HEIGHT, type WorkflowOpInput } from "./workflow-tool-schemas.ts";

export function boxesOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number }
): boolean {
  return Math.abs(a.x - b.x) < 290 && Math.abs(a.y - b.y) < 160;
}

/**
 * Posiciona um novo nó próximo aos demais sem sobreposição retangular.
 */
export function placeNode(
  existingNodes: readonly WorkflowNo[],
  preferredX?: number,
  preferredY?: number
): { x: number; y: number } {
  let x = typeof preferredX === "number" && Number.isFinite(preferredX) ? preferredX : 100;
  let y = typeof preferredY === "number" && Number.isFinite(preferredY) ? preferredY : 120;

  if (existingNodes.length > 0 && preferredX === undefined && preferredY === undefined) {
    const maxX = Math.max(...existingNodes.map((n) => n.x));
    x = maxX + LAYOUT_COL_WIDTH;
    y = existingNodes[0].y;
  }

  let attempts = 0;
  while (existingNodes.some((n) => boxesOverlap({ x, y }, n)) && attempts < 40) {
    y += LAYOUT_ROW_HEIGHT;
    attempts += 1;
  }

  return { x, y };
}

/**
 * Organiza automaticamente os nós do grafo em camadas topológicas (380px x 220px),
 * evitando colisões de caixas e preservando ordem determinística.
 */
export function layoutNodes(
  nos: readonly WorkflowNo[],
  arestas: readonly WorkflowAresta[]
): WorkflowNo[] {
  const normalized = nos.map(normalizeWorkflowNode);
  const execNodes = normalized.filter((n) => !isAnnotationNodeKind(n.tipo));
  const execIds = new Set(execNodes.map((n) => n.id));
  const scopedEdges = arestas.filter((e) => execIds.has(e.origem) && execIds.has(e.destino));
  const loops = workflowLoopEdges(execNodes, scopedEdges);
  const forward = scopedEdges.filter((e) => !loops.has(e.id));

  const topo = graphOrder(execNodes, forward);
  const incomingByNode = new Map<string, string[]>();
  for (const edge of forward) {
    const list = incomingByNode.get(edge.destino) ?? [];
    list.push(edge.origem);
    incomingByNode.set(edge.destino, list);
  }

  const layerByNode = new Map<string, number>();
  for (const id of topo) {
    const parents = incomingByNode.get(id) ?? [];
    if (parents.length === 0) {
      layerByNode.set(id, 0);
    } else {
      const maxParentLayer = Math.max(...parents.map((p) => layerByNode.get(p) ?? 0));
      layerByNode.set(id, maxParentLayer + 1);
    }
  }

  const nodesByLayer = new Map<number, string[]>();
  for (const id of topo) {
    const layer = layerByNode.get(id) ?? 0;
    const list = nodesByLayer.get(layer) ?? [];
    list.push(id);
    nodesByLayer.set(layer, list);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [layer, ids] of nodesByLayer.entries()) {
    ids.forEach((id, rowIdx) => {
      positions.set(id, {
        x: 100 + layer * LAYOUT_COL_WIDTH,
        y: 120 + rowIdx * LAYOUT_ROW_HEIGHT,
      });
    });
  }

  let annotationIdx = 0;
  return normalized.map((n) => {
    const pos = positions.get(n.id);
    if (pos) {
      return { ...n, x: pos.x, y: pos.y };
    }
    const yFallback = 120 + annotationIdx * LAYOUT_ROW_HEIGHT;
    annotationIdx += 1;
    return isAnnotationNodeKind(n.tipo)
      ? n
      : { ...n, x: 100, y: yFallback };
  });
}

/**
 * Aplica operações incrementais (`add`, `update`, `move`, `remove`, `connect`, `disconnect`)
 * com resolução de `ref` simbólico e validação estrita de portas/condições.
 */
export function applyWorkflowOps(
  currentNos: readonly WorkflowNo[],
  currentArestas: readonly WorkflowAresta[],
  ops: readonly WorkflowOpInput[]
): { nos: WorkflowNo[]; arestas: WorkflowAresta[] } {
  let nos = currentNos.map((n) => ({ ...normalizeWorkflowNode(n) }));
  let arestas = currentArestas.map((a) => ({ ...a }));
  const refToId = new Map<string, string>();

  const resolveRef = (raw: string): string => refToId.get(raw) ?? raw;

  for (const rawOp of ops) {
    if (rawOp.op === "add") {
      const nodePayload = (rawOp.node ?? {}) as Partial<WorkflowNo> & { ref?: string };
      const symbolicRef =
        (rawOp as { ref?: string }).ref ?? nodePayload.ref ?? undefined;
      const newId = nodePayload.id?.trim() || `no_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
      if (symbolicRef) {
        refToId.set(symbolicRef, newId);
      }
      refToId.set(newId, newId);

      const pos =
        typeof nodePayload.x === "number" && typeof nodePayload.y === "number"
          ? { x: nodePayload.x, y: nodePayload.y }
          : placeNode(nos);

      const built = normalizeWorkflowNode({
        ...(nodePayload as WorkflowNo),
        id: newId,
        tipo: (nodePayload.tipo ?? "prompt") as WorkflowNo["tipo"],
        titulo: nodePayload.titulo?.trim() || "Nova Etapa",
        x: pos.x,
        y: pos.y,
        config:
          nodePayload.config && typeof nodePayload.config === "object"
            ? { ...nodePayload.config }
            : {},
      });

      if (nos.some((n) => n.id === built.id)) {
        throw new WorkflowValidationError(`Nó com ID duplicado '${built.id}' ao adicionar.`, 400);
      }
      nos.push(built);
      continue;
    }

    if (rawOp.op === "update") {
      const targetId = resolveRef(rawOp.nodeId);
      const idx = nos.findIndex((n) => n.id === targetId);
      if (idx === -1) {
        throw new WorkflowValidationError(`Nó '${rawOp.nodeId}' não encontrado para update.`, 400);
      }
      const prev = nos[idx];
      const patch = rawOp.patch ?? {};
      const mergedConfig =
        patch.config && typeof patch.config === "object"
          ? { ...prev.config, ...patch.config }
          : prev.config;
      nos[idx] = normalizeWorkflowNode({
        ...prev,
        ...patch,
        id: prev.id,
        config: mergedConfig,
      });
      continue;
    }

    if (rawOp.op === "move") {
      const targetId = resolveRef(rawOp.nodeId);
      const idx = nos.findIndex((n) => n.id === targetId);
      if (idx === -1) {
        throw new WorkflowValidationError(`Nó '${rawOp.nodeId}' não encontrado para move.`, 400);
      }
      nos[idx] = {
        ...nos[idx],
        x: Number.isFinite(rawOp.x) ? rawOp.x : nos[idx].x,
        y: Number.isFinite(rawOp.y) ? rawOp.y : nos[idx].y,
      };
      continue;
    }

    if (rawOp.op === "remove") {
      const targetId = resolveRef(rawOp.nodeId);
      nos = nos.filter((n) => n.id !== targetId);
      arestas = arestas.filter((a) => a.origem !== targetId && a.destino !== targetId);
      continue;
    }

    if (rawOp.op === "connect") {
      const opRec = rawOp as unknown as { edge?: Record<string, unknown> } & Record<string, unknown>;
      const edgeRaw: Record<string, unknown> =
        opRec.edge && typeof opRec.edge === "object" ? opRec.edge : opRec;
      const rawOrig =
        typeof edgeRaw.origem === "string"
          ? edgeRaw.origem
          : typeof edgeRaw.from === "string"
            ? edgeRaw.from
            : "";
      const rawDest =
        typeof edgeRaw.destino === "string"
          ? edgeRaw.destino
          : typeof edgeRaw.to === "string"
            ? edgeRaw.to
            : "";

      const origem = resolveRef(rawOrig);
      const destino = resolveRef(rawDest);
      const srcNode = nos.find((n) => n.id === origem);
      const dstNode = nos.find((n) => n.id === destino);
      if (!srcNode || !dstNode) {
        throw new WorkflowValidationError(
          `Não foi possível conectar '${rawOrig}' -> '${rawDest}': nó inexistente.`,
          400
        );
      }

      const branch =
        (edgeRaw.branch as WorkflowBranch | null | undefined) ?? null;
      const requestedType = edgeRaw.type as WorkflowPortType | undefined;
      const connCheck = canConnectPorts(srcNode, dstNode, requestedType, branch);
      if (!connCheck.ok || !connCheck.resolvedType) {
        throw new WorkflowValidationError(
          connCheck.reason ?? `Conexão incompatível entre '${origem}' e '${destino}'.`,
          400
        );
      }

      const edgeId =
        typeof edgeRaw.id === "string" && edgeRaw.id.trim()
          ? edgeRaw.id.trim()
          : `edge_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

      const duplicate = arestas.some(
        (a) =>
          a.origem === origem &&
          a.destino === destino &&
          (a.branch ?? null) === (branch ?? null)
      );
      if (!duplicate) {
        arestas.push({
          id: edgeId,
          origem,
          destino,
          type: connCheck.resolvedType,
          ...(branch ? { branch } : {}),
        });
      }
      continue;
    }

    if (rawOp.op === "disconnect") {
      if (rawOp.edgeId) {
        arestas = arestas.filter((a) => a.id !== rawOp.edgeId);
      } else if (rawOp.origem || rawOp.destino) {
        const orig = rawOp.origem ? resolveRef(rawOp.origem) : null;
        const dest = rawOp.destino ? resolveRef(rawOp.destino) : null;
        arestas = arestas.filter((a) => {
          if (orig && dest) return !(a.origem === orig && a.destino === dest);
          if (orig) return a.origem !== orig;
          if (dest) return a.destino !== dest;
          return true;
        });
      }
    }
  }

  const finalProblem = workflowGraphProblemAt(nos, arestas);
  if (finalProblem) {
    throw new WorkflowValidationError(finalProblem, 400);
  }

  return { nos, arestas };
}

