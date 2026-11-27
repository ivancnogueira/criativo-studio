import {
  isAnnotationNodeKind,
  workflowLoopEdges,
  type WorkflowAresta,
  type WorkflowNo,
} from "@criativo/contracts";

/**
 * Reorganiza nós executáveis em camadas topológicas esquerda -> direita (colunas x=140+col*360, linhas y=140+row*210),
 * filtrando arestas de retorno (ciclos) e preservando anotações livres sem colisão.
 */
export function tidyWorkflowLayout(
  nos: WorkflowNo[],
  arestas: WorkflowAresta[]
): WorkflowNo[] {
  if (nos.length === 0) return [];

  const execNodes = nos.filter((n) => !isAnnotationNodeKind(n.tipo));
  const annotationNodes = nos.filter((n) => isAnnotationNodeKind(n.tipo));
  if (execNodes.length === 0) return nos;

  const execIds = new Set(execNodes.map((n) => n.id));
  const scopedEdges = arestas.filter(
    (e) => execIds.has(e.origem) && execIds.has(e.destino) && e.origem !== e.destino
  );
  const backEdges = workflowLoopEdges(execNodes, scopedEdges);
  const dagEdges = scopedEdges.filter((e) => !backEdges.has(e.id));

  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const layer = new Map<string, number>();

  for (const n of execNodes) {
    inDegree.set(n.id, 0);
    outgoing.set(n.id, []);
    layer.set(n.id, 0);
  }

  for (const edge of dagEdges) {
    outgoing.get(edge.origem)!.push(edge.destino);
    inDegree.set(edge.destino, (inDegree.get(edge.destino) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const n of execNodes) {
    if ((inDegree.get(n.id) ?? 0) === 0 || n.tipo === "gatilho") {
      queue.push(n.id);
    }
  }

  const processed = new Set<string>();
  let steps = 0;
  const maxSteps = execNodes.length * Math.max(2, dagEdges.length + 1);

  while (queue.length > 0 && steps < maxSteps) {
    steps += 1;
    const u = queue.shift()!;
    processed.add(u);
    const baseLayer = layer.get(u) ?? 0;
    for (const v of outgoing.get(u) ?? []) {
      const candidateLayer = baseLayer + 1;
      if (candidateLayer <= execNodes.length && candidateLayer > (layer.get(v) ?? 0)) {
        layer.set(v, candidateLayer);
      }
      const nextDeg = (inDegree.get(v) ?? 0) - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg <= 0 && !processed.has(v)) {
        queue.push(v);
      }
    }
  }

  const cols = new Map<number, WorkflowNo[]>();
  for (const n of execNodes) {
    const col = layer.get(n.id) ?? 0;
    const arr = cols.get(col) ?? [];
    arr.push(n);
    cols.set(col, arr);
  }

  const posById = new Map<string, { x: number; y: number }>();
  for (const [col, group] of cols.entries()) {
    const ordered = [...group].sort((a, b) => a.y - b.y || a.x - b.x);
    ordered.forEach((node, row) => {
      posById.set(node.id, {
        x: 140 + col * 360,
        y: 140 + row * 210,
      });
    });
  }

  const annotationMap = new Map(annotationNodes.map((n) => [n.id, n]));
  return nos.map((n) => {
    if (annotationMap.has(n.id)) return n;
    const nextPos = posById.get(n.id);
    return nextPos ? { ...n, x: nextPos.x, y: nextPos.y } : n;
  });
}
