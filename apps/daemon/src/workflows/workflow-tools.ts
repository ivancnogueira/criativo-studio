import { randomUUID } from "node:crypto";
import {
  canConnectPorts,
  isAnnotationNodeKind,
  normalizeNodeKind,
  normalizeWorkflowNode,
  workflowGraphProblemAt,
  workflowLoopEdges,
  type ToolDefinition,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowDetail,
  type WorkflowNo,
  type WorkflowOp,
  type WorkflowPortType,
  type WorkflowRunDetail,
} from "@criativo/contracts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { WorkflowEngine } from "./workflow-engine.ts";
import { WorkflowValidationError, type WorkflowStore } from "./workflow-store.ts";
import { graphOrder } from "./workflow-walk.ts";

const LAYOUT_COL_WIDTH = 380;
const LAYOUT_ROW_HEIGHT = 220;
const MAX_STEP_PREVIEW_CHARS = 600;

export const WORKFLOW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_workflows",
    description:
      "Lista todos os workflows disponíveis no estúdio com status ativo, revisão atual e contagem de nós.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_workflow",
    description:
      "Lê a estrutura completa de um workflow (nós, arestas, gatilhos e execuções recentes). Por padrão omite coordenadas x/y para economizar contexto.",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow" },
        layout: {
          type: "boolean",
          description: "Quando true, inclui coordenadas visuais x/y e dimensões dos nós",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "edit_workflow",
    description:
      "Cria ou edita um workflow aplicando operações incrementais no grafo (add, update, move, remove, connect, disconnect) e auto-layout.",
    parameters: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Opcional. Se omitido, cria um novo workflow com os nós e operações informados.",
        },
        nome: { type: "string", description: "Nome do workflow" },
        descricao: { type: "string", description: "Descrição do workflow" },
        ativo: { type: "boolean", description: "Define se o workflow está ativo" },
        tidy: {
          type: "boolean",
          description: "Quando true, reorganiza automaticamente todas as coordenadas sem sobreposição",
        },
        ops: {
          type: "array",
          description: "Lista ordenada de operações de edição de nós e conexões",
          items: {
            type: "object",
          },
        },
      },
    },
  },
  {
    name: "delete_workflow",
    description:
      "Exclui permanentemente um workflow. Exige confirmação humana explícita (`confirmed_by_human: true`).",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow a excluir" },
        confirmed_by_human: {
          type: "boolean",
          description: "Obrigatório ser true após confirmação explícita do usuário no chat.",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "run_workflow",
    description:
      "Dispara a execução de um workflow completo, a partir de um gatilho específico ou parcialmente a partir de qualquer nó (`from_node_id`).",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow" },
        trigger_node_id: {
          type: "string",
          description: "Opcional. ID do nó gatilho inicial quando houver mais de um gatilho.",
        },
        from_node_id: {
          type: "string",
          description: "Opcional. Executa parcialmente a partir deste nó reutilizando saídas anteriores válidas.",
        },
        payload: {
          type: "string",
          description: "Opcional. Texto ou JSON de entrada inicial para o workflow.",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "read_workflow_runs",
    description:
      "Consulta o histórico de execuções de um workflow ou o detalhe nó-a-nó de uma execução (`run_id`) com saídas compactadas.",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow" },
        run_id: { type: "string", description: "Opcional. ID de uma execução específica." },
        limit: { type: "number", description: "Máximo de execuções retornadas (padrão 10)" },
      },
      required: ["workflow_id"],
    },
  },
];

export const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOL_DEFINITIONS.map((t) => t.name));

export function isWorkflowToolName(name: string): boolean {
  return WORKFLOW_TOOL_NAMES.has(name);
}

export type WorkflowOpInput =
  | WorkflowOp
  | {
      op: "add";
      ref?: string;
      node: Partial<WorkflowNo> & { ref?: string };
    }
  | {
      op: "connect";
      edge?: Partial<WorkflowAresta> & { from?: string; to?: string };
      origem?: string;
      destino?: string;
      type?: WorkflowPortType;
      branch?: WorkflowBranch | null;
    };

function boxesOverlap(
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

function truncateText(value: string | null, max = MAX_STEP_PREVIEW_CHARS): string | null {
  if (value === null || value === undefined) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncado]`;
}

export function compactGraphForAgent(
  detail: WorkflowDetail,
  includeLayout = false
): Record<string, unknown> {
  return {
    workflow_id: detail.workflow.workflow_id,
    nome: detail.workflow.nome,
    descricao: detail.workflow.descricao,
    ativo: detail.workflow.ativo,
    revisao_grafo: detail.workflow.revisao_grafo ?? 0,
    atualizado_em: detail.workflow.atualizado_em,
    nos: detail.workflow.nos.map((n) => {
      const base: Record<string, unknown> = {
        id: n.id,
        tipo: normalizeNodeKind(n.tipo),
        titulo: n.titulo,
        ...(n.subtitulo ? { subtitulo: n.subtitulo } : {}),
        ...(n.triggerKind ? { triggerKind: n.triggerKind } : {}),
        ...(n.agenteId ? { agenteId: n.agenteId } : {}),
        ...(n.model ? { model: n.model } : {}),
        ...(n.rule ? { rule: n.rule } : {}),
        ...(n.question ? { question: n.question } : {}),
        ...(n.target ? { target: n.target } : {}),
        ...(n.targetRef ? { targetRef: n.targetRef } : {}),
        ...(n.fileId ? { fileId: n.fileId } : {}),
        ...(n.prompt ? { prompt: truncateText(n.prompt, 400) } : {}),
      };
      if (includeLayout) {
        base.x = n.x;
        base.y = n.y;
        if (n.width !== undefined) base.width = n.width;
        if (n.height !== undefined) base.height = n.height;
      }
      return base;
    }),
    arestas: detail.workflow.arestas.map((a) => ({
      id: a.id,
      origem: a.origem,
      destino: a.destino,
      type: a.type ?? "text",
      ...(a.branch ? { branch: a.branch } : {}),
    })),
    gatilhos: detail.triggers.map((t) => ({
      node_id: t.node_id,
      tipo: t.tipo,
      timezone: t.timezone,
      proxima_execucao_em: t.proxima_execucao_em,
      webhook_url: t.webhook_url ?? null,
    })),
    ultimas_execucoes: detail.runs.slice(0, 5).map((r) => ({
      run_id: r.run_id,
      numero: r.numero,
      status: r.status,
      origem: r.origem,
      iniciado_em: r.iniciado_em,
      encerrado_em: r.encerrado_em,
    })),
  };
}

export function compactRunForAgent(detail: WorkflowRunDetail): Record<string, unknown> {
  return {
    run_id: detail.run.run_id,
    workflow_id: detail.run.workflow_id,
    numero: detail.run.numero,
    status: detail.run.status,
    origem: detail.run.origem,
    trigger_node_id: detail.run.trigger_node_id,
    from_node_id: detail.run.from_node_id,
    erro: detail.run.erro,
    iniciado_em: detail.run.iniciado_em,
    encerrado_em: detail.run.encerrado_em,
    steps: detail.steps.map((s) => ({
      step_id: s.step_id,
      node_id: s.node_id,
      kind: s.kind,
      tentativa: s.tentativa,
      status: s.status,
      branch: s.branch,
      erro: s.erro,
      input: truncateText(s.input, MAX_STEP_PREVIEW_CHARS),
      output: truncateText(s.output, MAX_STEP_PREVIEW_CHARS),
      output_tipo: s.output_tipo,
      tarefa_id: s.tarefa_id,
    })),
    deliveries: detail.deliveries.map((d) => ({
      step_id: d.step_id,
      destino: d.destino,
      destino_ref: d.destino_ref,
      status: d.status,
      motivo: d.motivo,
      enviado_em: d.enviado_em,
    })),
  };
}

export async function executeWorkflowToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    store: WorkflowStore;
    engine: WorkflowEngine;
    wsHub?: WebSocketHub;
    agenteId?: string;
    requestSeed?: string;
  }
): Promise<unknown> {
  switch (name) {
    case "list_workflows": {
      const list = ctx.store.listWorkflows();
      return {
        ok: true,
        total: list.length,
        workflows: list.map((w) => ({
          workflow_id: w.workflow_id,
          nome: w.nome,
          descricao: w.descricao,
          ativo: w.ativo,
          revisao_grafo: w.revisao_grafo,
          qtd_nos: w.qtd_nos,
          qtd_arestas: w.qtd_arestas,
          ultimo_run: w.last_run
            ? {
                run_id: w.last_run.run_id,
                numero: w.last_run.numero,
                status: w.last_run.status,
              }
            : null,
        })),
      };
    }

    case "read_workflow": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      const detail = ctx.store.getWorkflowDetail(workflowId);
      if (!detail) {
        return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
      }
      return {
        ok: true,
        workflow: compactGraphForAgent(detail, args.layout === true),
      };
    }

    case "edit_workflow": {
      const workflowId =
        typeof args.workflow_id === "string" && args.workflow_id.trim()
          ? args.workflow_id.trim()
          : undefined;
      const ops = Array.isArray(args.ops) ? (args.ops as WorkflowOpInput[]) : [];
      const tidy = args.tidy === true;

      try {
        if (!workflowId) {
          const applied = applyWorkflowOps([], [], ops);
          const arrangedNos =
            applied.nos.length > 0 ? layoutNodes(applied.nos, applied.arestas) : [];
          const created = ctx.store.createWorkflow({
            nome: typeof args.nome === "string" ? args.nome : "Novo Workflow",
            descricao: typeof args.descricao === "string" ? args.descricao : "",
            nos: arrangedNos,
            arestas: applied.arestas,
            ativo: typeof args.ativo === "boolean" ? args.ativo : true,
          });
          ctx.wsHub?.broadcast("workflow:updated", {
            workflow_id: created.workflow.workflow_id,
            revisao_grafo: created.workflow.revisao_grafo ?? 0,
            agente_id: ctx.agenteId ?? null,
            acao: "created",
          });
          return {
            ok: true,
            acao: "created",
            workflow: compactGraphForAgent(created, false),
          };
        }

        // Edição existente com até 2 tentativas em conflito de revisão otimista
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = ctx.store.getWorkflowDetail(workflowId);
          if (!current) {
            return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
          }
          const applied = applyWorkflowOps(current.workflow.nos, current.workflow.arestas, ops);
          const finalNos = tidy ? layoutNodes(applied.nos, applied.arestas) : applied.nos;

          const saved = ctx.store.saveWorkflow(workflowId, {
            nome: typeof args.nome === "string" ? args.nome : undefined,
            descricao: typeof args.descricao === "string" ? args.descricao : undefined,
            ativo: typeof args.ativo === "boolean" ? args.ativo : undefined,
            nos: finalNos,
            arestas: applied.arestas,
            base_revision: current.workflow.revisao_grafo ?? 0,
          });

          if (!saved) {
            return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
          }

          if (saved.ok) {
            ctx.wsHub?.broadcast("workflow:updated", {
              workflow_id: saved.detail.workflow.workflow_id,
              revisao_grafo: saved.detail.workflow.revisao_grafo ?? 0,
              agente_id: ctx.agenteId ?? null,
              acao: "saved",
            });
            return {
              ok: true,
              acao: "saved",
              workflow: compactGraphForAgent(saved.detail, false),
            };
          }
        }

        return {
          ok: false,
          erro: "Conflito de concorrência ao editar o workflow após 2 tentativas. Releia com read_workflow e tente novamente.",
        };
      } catch (err) {
        if (err instanceof WorkflowValidationError) {
          return {
            ok: false,
            validation_error: true,
            erro: err.message,
          };
        }
        throw err;
      }
    }

    case "delete_workflow": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      if (args.confirmed_by_human !== true) {
        return {
          ok: false,
          requires_confirmation: true,
          mensagem: "Confirmação humana obrigatória antes de excluir este workflow.",
        };
      }
      const detail = ctx.store.getWorkflowDetail(workflowId);
      if (!detail) {
        return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
      }
      const deleted = ctx.store.deleteWorkflow(workflowId);
      if (deleted) {
        ctx.wsHub?.broadcast("workflow:updated", {
          workflow_id: workflowId,
          revisao_grafo: detail.workflow.revisao_grafo ?? 0,
          agente_id: ctx.agenteId ?? null,
          acao: "deleted",
        });
      }
      return { ok: deleted, workflow_id: workflowId };
    }

    case "run_workflow": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      const runDetail = await ctx.engine.startRun({
        workflowId,
        origem: "agente",
        triggerNodeId:
          typeof args.trigger_node_id === "string" ? args.trigger_node_id.trim() : undefined,
        fromNodeId:
          typeof args.from_node_id === "string" ? args.from_node_id.trim() : undefined,
        payload: args.payload,
        requestId: ctx.requestSeed
          ? `agent:${ctx.agenteId ?? "agent"}:${ctx.requestSeed}:${randomUUID().slice(0, 8)}`
          : undefined,
      });

      return {
        ok: true,
        execucao: compactRunForAgent(runDetail),
      };
    }

    case "read_workflow_runs": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
      if (runId) {
        const detail = ctx.store.getRunDetail(runId);
        if (!detail || detail.run.workflow_id !== workflowId) {
          return { ok: false, erro: `Execução não encontrada para o workflow: ${runId}` };
        }
        return {
          ok: true,
          execucao: compactRunForAgent(detail),
        };
      }

      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(30, Math.floor(args.limit)))
          : 10;
      const runs = ctx.store.listRunsPaginated(workflowId, limit, 0);
      return {
        ok: true,
        total: runs.length,
        execucoes: runs.map((r) => ({
          run_id: r.run_id,
          numero: r.numero,
          status: r.status,
          origem: r.origem,
          trigger_node_id: r.trigger_node_id,
          from_node_id: r.from_node_id,
          erro: r.erro,
          iniciado_em: r.iniciado_em,
          encerrado_em: r.encerrado_em,
        })),
      };
    }

    default:
      throw new Error(`Ferramenta de workflow desconhecida: ${name}`);
  }
}
