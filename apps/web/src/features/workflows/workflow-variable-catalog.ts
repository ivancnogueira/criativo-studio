import {
  normalizeNodeKind,
  type WorkflowAnswerField,
  type WorkflowAnswerFieldType,
  type WorkflowAresta,
  type WorkflowNo,
} from "@criativo/contracts";

export interface AvailableWorkflowToken {
  token: string;
  insertText: string;
  label: string;
  sourceTitle: string;
  type: WorkflowAnswerFieldType | "text";
}

function readAnswerFields(node: WorkflowNo): WorkflowAnswerField[] {
  const raw = Array.isArray(node.answerFields)
    ? node.answerFields
    : Array.isArray(node.config?.answerFields)
      ? (node.config.answerFields as WorkflowAnswerField[])
      : [];
  return raw.filter((f) => Boolean(f && typeof f.key === "string" && f.key.trim().length > 0));
}

/**
 * Faz BFS reversa sobre `arestas` a partir de `targetNodeId` e lista todos os tokens `{{campo}}`
 * disponíveis dos nós predecessores e da identidade da marca.
 */
export function collectAvailableNodeTokens(
  targetNodeId: string,
  nos: readonly WorkflowNo[],
  arestas: readonly WorkflowAresta[]
): AvailableWorkflowToken[] {
  const nodeMap = new Map(nos.map((n) => [n.id, n]));
  const reverseAdj = new Map<string, string[]>();
  for (const e of arestas) {
    const arr = reverseAdj.get(e.destino) ?? [];
    arr.push(e.origem);
    reverseAdj.set(e.destino, arr);
  }

  const visited = new Set<string>([targetNodeId]);
  const queue: string[] = [...(reverseAdj.get(targetNodeId) ?? [])];
  const upstreamOrder: WorkflowNo[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const n = nodeMap.get(id);
    if (n) {
      upstreamOrder.push(n);
      for (const prevId of reverseAdj.get(id) ?? []) {
        if (!visited.has(prevId)) queue.push(prevId);
      }
    }
  }

  const results: AvailableWorkflowToken[] = [
    {
      token: "input",
      insertText: "{{input}}",
      label: "Entrada consolidada da etapa anterior",
      sourceTitle: "Fluxo anterior",
      type: "text",
    },
  ];

  const seenTokens = new Set<string>(["input"]);

  for (const up of upstreamOrder) {
    const kind = normalizeNodeKind(up.tipo);
    if (kind !== "llm" && kind !== "agente" && kind !== "gatilho") continue;
    const fields = readAnswerFields(up);
    for (const f of fields) {
      const cleanKey = f.key.trim();
      if (!seenTokens.has(cleanKey)) {
        seenTokens.add(cleanKey);
        results.push({
          token: cleanKey,
          insertText: `{{${cleanKey}}}`,
          label: f.label || cleanKey,
          sourceTitle: up.titulo || up.id,
          type: f.type,
        });
      }
      const qualified = `${up.id}.${cleanKey}`;
      if (!seenTokens.has(qualified)) {
        seenTokens.add(qualified);
        results.push({
          token: qualified,
          insertText: `{{${qualified}}}`,
          label: `${f.label || cleanKey} (${up.titulo || up.id})`,
          sourceTitle: up.titulo || up.id,
          type: f.type,
        });
      }
    }
  }

  const brandTokens: Array<{ token: string; label: string }> = [
    { token: "marca_nome", label: "Nome da marca ([NOME_DA_MARCA])" },
    { token: "perfil_handle", label: "Handle do perfil ([@SEU_PERFIL])" },
    { token: "nicho", label: "Nicho do negócio ([NICHO])" },
    { token: "tom_voz", label: "Tom de voz ([TOM_DE_VOZ])" },
  ];
  for (const bt of brandTokens) {
    if (!seenTokens.has(bt.token)) {
      results.push({
        token: bt.token,
        insertText: `{{${bt.token}}}`,
        label: bt.label,
        sourceTitle: "Identidade da Marca",
        type: "text",
      });
    }
  }

  return results;
}
