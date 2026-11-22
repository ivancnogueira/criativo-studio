export type TipoNoWorkflowExecutavel =
  | "gatilho"
  | "prompt"
  | "asset"
  | "llm"
  | "agente"
  | "gerar_imagem"
  | "render_video"
  | "condition"
  | "approval"
  | "output";

export type TipoNoWorkflowAnotacao = "nota" | "shape" | "text";

export type TipoNoWorkflowLegado =
  | "aprovacao"
  | "publicar_meta"
  | "slack_notificar"
  | "discord_notificar"
  | "github_acao";

export type TipoNoWorkflow =
  | TipoNoWorkflowExecutavel
  | TipoNoWorkflowAnotacao
  | TipoNoWorkflowLegado;

export type WorkflowPortType = "text" | "image" | "file";

export interface MediaProviderDescriptor {
  id: string;
  label: string;
  kind: "image" | "video";
  source: "native" | "http_custom" | "mcp";
  models: string[];
  requiresVaultKey?: string;
  mcpServerId?: string;
  mcpToolName?: string;
}
export type WorkflowBranch = "yes" | "no";
export type WorkflowShapeKind =
  | "rectangle"
  | "circle"
  | "diamond"
  | "triangle"
  | "inverted"
  | "oval"
  | "star";
export type WorkflowTriggerKind =
  | "manual"
  | "schedule"
  | "webhook"
  | "whatsapp"
  | "telegram"
  | "conector";
export type WorkflowOutputTarget =
  | "canal"
  | "whatsapp"
  | "telegram"
  | "arquivo"
  | "instagram"
  | "notificacao"
  | "slack"
  | "discord"
  | "github";

export type WorkflowScheduleKind =
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "interval"
  | "advanced"
  | "custom"
  | "once";

export interface WorkflowScheduleConfig {
  kind: WorkflowScheduleKind;
  hour?: number;
  minute?: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  intervalMinutes?: number;
  cronExpression?: string;
  runAt?: string;
  timezone?: string;
}

export type WorkflowTriggerConfig =
  | { kind: "manual" }
  | { kind: "schedule"; schedule: WorkflowScheduleConfig }
  | { kind: "webhook"; label?: string; secretHint?: string }
  | {
      kind: "whatsapp";
      connectionId?: string;
      grupoOuNumero?: string;
      palavraChave?: string;
      tipoMidia?: "all" | "text" | "audio" | "image";
    }
  | { kind: "telegram"; chatId?: string; palavraChave?: string }
  | { kind: "conector"; conectorId?: string; evento?: string; filtro?: string };

export interface WorkflowNo {
  id: string;
  tipo: TipoNoWorkflow;
  titulo: string;
  subtitulo?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  config: Record<string, unknown>;
  triggerKind?: WorkflowTriggerKind;
  trigger?: WorkflowTriggerConfig;
  prompt?: string;
  systemPrompt?: string;
  model?: string;
  provider?: string;
  mediaProviderId?: string;
  mediaModelId?: string;
  effort?: "baixo" | "medio" | "alto" | "maximo";
  agenteId?: string;
  fileId?: string;
  rule?: string;
  question?: string;
  target?: WorkflowOutputTarget;
  targetRef?: string;
  shape?: WorkflowShapeKind;
  color?: string;
  locked?: boolean;
  textSize?: "sm" | "md" | "lg";
}

export interface WorkflowAresta {
  id: string;
  origem: string;
  destino: string;
  type?: WorkflowPortType;
  branch?: WorkflowBranch | null;
}

export interface WorkflowTraco {
  id: string;
  color?: string;
  width?: number;
  points: Array<[number, number]>;
}

export type WorkflowRunStatus =
  | "running"
  | "approval"
  | "stopping"
  | "done"
  | "failed"
  | "stopped";

export type WorkflowStepStatus =
  | "running"
  | "approval"
  | "done"
  | "failed"
  | "stopped"
  | "skipped";

export type WorkflowRunOrigin =
  | "manual"
  | "schedule"
  | "webhook"
  | "whatsapp"
  | "telegram"
  | "conector"
  | "agente";

export interface WorkflowRunRecord {
  run_id: string;
  workflow_id: string;
  numero: number;
  trigger_node_id: string | null;
  from_node_id: string | null;
  origem: WorkflowRunOrigin;
  agendado_para: string | null;
  chave_idempotencia: string;
  revisao_grafo: number;
  grafo_json: string;
  payload: string | null;
  status: WorkflowRunStatus;
  erro: string | null;
  iniciado_em: string;
  encerrado_em: string | null;
  atualizado_em: string;
}

export interface WorkflowStepRecord {
  step_id: string;
  workflow_id: string;
  run_id: string | null;
  node_id: string;
  tentativa: number;
  request_id: string;
  kind: string;
  agente_id: string | null;
  status: WorkflowStepStatus;
  tarefa_id: string | null;
  input: string;
  output: string | null;
  output_tipo: WorkflowPortType | null;
  artefatos_json: string;
  branch: WorkflowBranch | null;
  erro: string | null;
  iniciado_em: string | null;
  encerrado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface WorkflowOutputDeliveryRecord {
  step_id: string;
  destino: WorkflowOutputTarget;
  destino_ref: string;
  texto: string;
  anexos_json: string;
  status: "pending" | "sending" | "sent" | "failed" | "uncertain";
  motivo: string | null;
  tentativas: number;
  enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface WorkflowRunDetail {
  run: WorkflowRunRecord;
  steps: WorkflowStepRecord[];
  deliveries: WorkflowOutputDeliveryRecord[];
}

export type WorkflowVersionKind = "auto" | "restore" | "run";

export interface WorkflowVersionSummary {
  version_id: string;
  workflow_id: string;
  revisao_grafo: number;
  kind: WorkflowVersionKind;
  criado_em: string;
}

export interface WorkflowVersionRecord extends WorkflowVersionSummary {
  grafo_json: string;
}

export interface WorkflowTriggerState {
  workflow_id: string;
  node_id: string;
  tipo: WorkflowTriggerKind;
  timezone: string | null;
  schedule_json: string | null;
  filtro_json: string;
  webhook_route_id: string | null;
  webhook_url?: string | null;
  proxima_execucao_em: string | null;
  atualizado_em: string;
}

export interface WorkflowVisual {
  workflow_id: string;
  nome: string;
  descricao: string;
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  ativo: boolean;
  ultima_execucao_em: string | null;
  atualizado_em: string;
  revisao_grafo?: number;
  tracos?: WorkflowTraco[];
  last_run?: WorkflowRunRecord | null;
}

export interface WorkflowSummary extends WorkflowVisual {
  revisao_grafo: number;
  qtd_nos: number;
  qtd_arestas: number;
}

export interface WorkflowDetail {
  workflow: WorkflowVisual;
  versions: WorkflowVersionSummary[];
  triggers: WorkflowTriggerState[];
  runs: WorkflowRunRecord[];
}

export type WorkflowOp =
  | { op: "add"; node: WorkflowNo }
  | { op: "update"; nodeId: string; patch: Partial<WorkflowNo> }
  | { op: "move"; nodeId: string; x: number; y: number }
  | { op: "remove"; nodeId: string }
  | { op: "connect"; edge: WorkflowAresta }
  | { op: "disconnect"; edgeId?: string; origem?: string; destino?: string };

export interface WorkflowRunInput {
  triggerNodeId?: string;
  fromNodeId?: string;
  payload?: unknown;
  origem?: WorkflowRunOrigin;
  idempotencyKey?: string;
  agendadoPara?: string;
}

export interface WorkflowStepRunInput {
  nodeId: string;
  payload?: unknown;
}

export const WORKFLOW_PORTS: Record<
  TipoNoWorkflowExecutavel | TipoNoWorkflowAnotacao,
  { in: readonly WorkflowPortType[]; out: readonly WorkflowPortType[] }
> = {
  gatilho: { in: [], out: ["text"] },
  prompt: { in: ["text"], out: ["text"] },
  asset: { in: [], out: ["text", "image", "file"] },
  llm: { in: ["text", "image", "file"], out: ["text"] },
  agente: { in: ["text", "image", "file"], out: ["text"] },
  gerar_imagem: { in: ["text", "image"], out: ["image"] },
  render_video: { in: ["text", "image", "file"], out: ["file"] },
  condition: { in: ["text"], out: ["text"] },
  approval: { in: ["text", "image", "file"], out: ["text", "image", "file"] },
  output: { in: ["text", "image", "file"], out: [] },
  nota: { in: [], out: [] },
  shape: { in: [], out: [] },
  text: { in: [], out: [] },
};

export function isAnnotationNodeKind(tipo: TipoNoWorkflow): boolean {
  return tipo === "nota" || tipo === "shape" || tipo === "text";
}

export function normalizeNodeKind(tipo: TipoNoWorkflow): TipoNoWorkflowExecutavel | TipoNoWorkflowAnotacao {
  if (tipo === "aprovacao") return "approval";
  if (
    tipo === "publicar_meta" ||
    tipo === "slack_notificar" ||
    tipo === "discord_notificar" ||
    tipo === "github_acao"
  ) {
    return "output";
  }
  return tipo;
}

export function normalizeWorkflowNode(node: WorkflowNo): WorkflowNo {
  const cfg =
    node.config && typeof node.config === "object" && !Array.isArray(node.config)
      ? { ...node.config }
      : {};

  let nextTipo: TipoNoWorkflowExecutavel | TipoNoWorkflowAnotacao;
  if (node.tipo === "aprovacao") {
    nextTipo = "approval";
  } else if (node.tipo === "publicar_meta") {
    nextTipo = "output";
    if (typeof cfg.target !== "string" && !node.target) {
      cfg.target = "instagram";
    }
  } else if (node.tipo === "slack_notificar") {
    nextTipo = "output";
    if (typeof cfg.target !== "string" && !node.target) {
      cfg.target = "slack";
    }
  } else if (node.tipo === "discord_notificar") {
    nextTipo = "output";
    if (typeof cfg.target !== "string" && !node.target) {
      cfg.target = "discord";
    }
  } else if (node.tipo === "github_acao") {
    nextTipo = "output";
    if (typeof cfg.target !== "string" && !node.target) {
      cfg.target = "github";
    }
  } else {
    nextTipo = node.tipo;
  }

  const target: WorkflowOutputTarget | undefined =
    node.target ??
    (typeof cfg.target === "string" ? (cfg.target as WorkflowOutputTarget) : undefined);

  return {
    ...node,
    tipo: nextTipo,
    config: cfg,
    ...(target ? { target } : {}),
  };
}

export function normalizeWorkflowGraph(graph: {
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  tracos?: WorkflowTraco[];
}): { nos: WorkflowNo[]; arestas: WorkflowAresta[]; tracos: WorkflowTraco[] } {
  const nos = (graph.nos ?? []).map((n) => normalizeWorkflowNode(n));
  const arestas = (graph.arestas ?? []).map((edge) => ({
    ...edge,
    type: edge.type ?? "text",
  }));
  const tracos = Array.isArray(graph.tracos) ? graph.tracos : [];
  return { nos, arestas, tracos };
}

export function canConnectPorts(
  sourceNode: WorkflowNo,
  targetNode: WorkflowNo,
  edgeType?: WorkflowPortType,
  branch?: WorkflowBranch | null
): { ok: boolean; resolvedType: WorkflowPortType | null; reason?: string } {
  if (sourceNode.id === targetNode.id) {
    return { ok: false, resolvedType: null, reason: "Não é permitido ligar um nó a ele mesmo." };
  }

  const srcKind = normalizeNodeKind(sourceNode.tipo);
  const dstKind = normalizeNodeKind(targetNode.tipo);

  if (isAnnotationNodeKind(srcKind) || isAnnotationNodeKind(dstKind)) {
    return {
      ok: false,
      resolvedType: null,
      reason: "Nós de anotação não participam de conexões executáveis.",
    };
  }

  const srcOut = WORKFLOW_PORTS[srcKind].out;
  const dstIn = WORKFLOW_PORTS[dstKind].in;

  if (srcOut.length === 0 || dstIn.length === 0) {
    return {
      ok: false,
      resolvedType: null,
      reason: "O nó de origem não possui saída ou o nó de destino não possui entrada.",
    };
  }

  if (srcKind === "condition") {
    if (branch !== "yes" && branch !== "no") {
      return {
        ok: false,
        resolvedType: null,
        reason: "Saídas de um nó condition exigem branch 'yes' ou 'no'.",
      };
    }
  } else if (branch === "yes" || branch === "no") {
    return {
      ok: false,
      resolvedType: null,
      reason: "Apenas arestas saindo de nós 'condition' podem definir branch 'yes'/'no'.",
    };
  }

  const compatibleTypes = srcOut.filter((t) => dstIn.includes(t));
  if (compatibleTypes.length === 0) {
    return {
      ok: false,
      resolvedType: null,
      reason: `Tipos incompatíveis entre '${srcKind}' e '${dstKind}'.`,
    };
  }

  if (edgeType) {
    if (!srcOut.includes(edgeType) || !dstIn.includes(edgeType)) {
      return {
        ok: false,
        resolvedType: null,
        reason: `Tipo de porta '${edgeType}' não compatível entre '${srcKind}' e '${dstKind}'.`,
      };
    }
    return { ok: true, resolvedType: edgeType };
  }

  return { ok: true, resolvedType: compatibleTypes[0] };
}

/**
 * Detecta iterativamente todas as arestas de retorno (ciclos/loops) no grafo usando pilha explícita.
 * Inicia pelos nós executáveis sem entradas e em seguida pelos demais na ordem declarada em `nos`.
 */
export function workflowLoopEdges(
  nos: readonly WorkflowNo[],
  arestas: readonly WorkflowAresta[]
): Set<string> {
  const normalizedNodes = nos.map(normalizeWorkflowNode).filter((n) => !isAnnotationNodeKind(n.tipo));
  const nodeIds = new Set(normalizedNodes.map((n) => n.id));
  const outEdges = new Map<string, WorkflowAresta[]>();
  const inCount = new Map<string, number>();

  for (const n of normalizedNodes) {
    outEdges.set(n.id, []);
    inCount.set(n.id, 0);
  }

  for (const e of arestas) {
    if (!nodeIds.has(e.origem) || !nodeIds.has(e.destino)) continue;
    outEdges.get(e.origem)!.push(e);
    inCount.set(e.destino, (inCount.get(e.destino) ?? 0) + 1);
  }

  const roots = normalizedNodes.filter((n) => (inCount.get(n.id) ?? 0) === 0).map((n) => n.id);
  const visitOrder = [...roots, ...normalizedNodes.map((n) => n.id).filter((id) => !roots.includes(id))];

  const state = new Map<string, 0 | 1 | 2>(); // 0 = unvisited, 1 = visiting, 2 = done
  const loops = new Set<string>();

  for (const startId of visitOrder) {
    if ((state.get(startId) ?? 0) !== 0) continue;

    const stack: Array<{ nodeId: string; idx: number }> = [{ nodeId: startId, idx: 0 }];
    state.set(startId, 1);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const edges = outEdges.get(top.nodeId) ?? [];
      if (top.idx >= edges.length) {
        state.set(top.nodeId, 2);
        stack.pop();
        continue;
      }

      const edge = edges[top.idx];
      top.idx += 1;
      const targetState = state.get(edge.destino) ?? 0;
      if (targetState === 1) {
        loops.add(edge.id);
      } else if (targetState === 0) {
        state.set(edge.destino, 1);
        stack.push({ nodeId: edge.destino, idx: 0 });
      }
    }
  }

  return loops;
}

function isSimpleCronValid(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => p.length > 0);
}

export function workflowGraphProblemAt(
  nos: readonly WorkflowNo[],
  arestas: readonly WorkflowAresta[]
): string | null {
  const nodeMap = new Map<string, WorkflowNo>();
  for (const n of nos) {
    if (!n.id || !n.id.trim()) {
      return "Todos os nós devem possuir um identificador não vazio.";
    }
    if (nodeMap.has(n.id)) {
      return `Identificador de nó duplicado: '${n.id}'.`;
    }
    const normalized = normalizeWorkflowNode(n);
    nodeMap.set(n.id, normalized);

    if (normalized.tipo === "gatilho") {
      const tKind =
        normalized.triggerKind ??
        normalized.trigger?.kind ??
        (typeof normalized.config.triggerKind === "string"
          ? (normalized.config.triggerKind as WorkflowTriggerKind)
          : undefined);
      if (tKind === "schedule") {
        const sched =
          (normalized.trigger?.kind === "schedule" ? normalized.trigger.schedule : undefined) ??
          (normalized.config.schedule as WorkflowScheduleConfig | undefined);
        if (!sched || !sched.kind) {
          return `Gatilho '${normalized.titulo || normalized.id}' com agenda vazia.`;
        }
        if (
          sched.kind === "interval" &&
          (typeof sched.intervalMinutes !== "number" || sched.intervalMinutes < 3)
        ) {
          return `Gatilho '${normalized.titulo || normalized.id}' exige intervalo mínimo de 3 minutos.`;
        }
        if (
          sched.kind === "custom" &&
          (!sched.cronExpression || !isSimpleCronValid(sched.cronExpression))
        ) {
          return `Gatilho '${normalized.titulo || normalized.id}' possui expressão cron inválida.`;
        }
      }
    }
  }

  const edgeKeys = new Set<string>();
  for (const e of arestas) {
    const src = nodeMap.get(e.origem);
    const dst = nodeMap.get(e.destino);
    if (!src || !dst) {
      return `Aresta '${e.id}' referencia nó inexistente ('${e.origem}' -> '${e.destino}').`;
    }
    const check = canConnectPorts(src, dst, e.type, e.branch);
    if (!check.ok) {
      return check.reason ?? `Conexão inválida na aresta '${e.id}'.`;
    }
    const dupKey = `${e.origem}->${e.destino}:${e.branch ?? ""}`;
    if (edgeKeys.has(dupKey)) {
      return `Aresta duplicada entre '${e.origem}' e '${e.destino}'.`;
    }
    edgeKeys.add(dupKey);
  }

  return null;
}
