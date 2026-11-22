import type {
  AgenteRegistro,
  ArquivoStudio,
  CanalEquipe,
  ProvedorStatusInfo,
  UsoProvedoresSnapshot,
  WorkflowAresta,
  WorkflowDetail,
  WorkflowNo,
  WorkflowRunDetail as WorkflowRunDetailType,
  WorkflowStepRecord,
  WorkflowTraco,
  WorkflowTriggerState,
  WorkflowVersionRecord,
  WorkflowVersionSummary,
  WorkflowVisual,
} from "@criativo/contracts";

export interface CanvasHistorySnapshot {
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  tracos: WorkflowTraco[];
}

export function cloneCanvasSnapshot(
  nos: WorkflowNo[],
  arestas: WorkflowAresta[],
  tracos: WorkflowTraco[]
): CanvasHistorySnapshot {
  return {
    nos: nos.map((n) => ({
      ...n,
      config: { ...(n.config ?? {}) },
    })),
    arestas: arestas.map((a) => ({ ...a })),
    tracos: tracos.map((t) => ({
      ...t,
      points: t.points.map(([x, y]) => [x, y] as [number, number]),
    })),
  };
}

export function canvasSnapshotsEqual(a: CanvasHistorySnapshot, b: CanvasHistorySnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Ordena nós por camadas topológicas esquerda -> direita (colunas x=180+col*340, linhas y=160+row*190).
 */
export function computeWorkflowAutoLayout(
  nos: WorkflowNo[],
  arestas: WorkflowAresta[]
): WorkflowNo[] {
  if (nos.length === 0) return [];
  const nodeIds = new Set(nos.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const layer = new Map<string, number>();

  for (const n of nos) {
    inDegree.set(n.id, 0);
    outgoing.set(n.id, []);
    layer.set(n.id, 0);
  }

  for (const edge of arestas) {
    if (!nodeIds.has(edge.origem) || !nodeIds.has(edge.destino)) continue;
    if (edge.origem === edge.destino) continue;
    outgoing.get(edge.origem)!.push(edge.destino);
    inDegree.set(edge.destino, (inDegree.get(edge.destino) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const n of nos) {
    if ((inDegree.get(n.id) ?? 0) === 0 || n.tipo === "gatilho") {
      queue.push(n.id);
    }
  }

  const processed = new Set<string>();
  let steps = 0;
  const maxSteps = nos.length * Math.max(2, arestas.length + 1);

  while (queue.length > 0 && steps < maxSteps) {
    steps += 1;
    const u = queue.shift()!;
    processed.add(u);
    const baseLayer = layer.get(u) ?? 0;
    for (const v of outgoing.get(u) ?? []) {
      const candidateLayer = baseLayer + 1;
      if (candidateLayer <= nos.length && candidateLayer > (layer.get(v) ?? 0)) {
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
  for (const n of nos) {
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
        x: 180 + col * 340,
        y: 160 + row * 190,
      });
    });
  }

  return nos.map((n) => {
    const nextPos = posById.get(n.id);
    return nextPos ? { ...n, x: nextPos.x, y: nextPos.y } : n;
  });
}

export interface WorkflowEventSignal {
  nonce: number;
  workflowId?: string;
  runId?: string;
  type?: "updated" | "run_updated" | "step_updated";
}

export interface WorkflowsCanvasPageProps {
  workflows: WorkflowVisual[];
  agentes: AgenteRegistro[];
  canais?: CanalEquipe[];
  arquivos?: ArquivoStudio[];
  provedores?: ProvedorStatusInfo[];
  uso: UsoProvedoresSnapshot | null;
  workflowEventSignal?: WorkflowEventSignal;
  onCreateWorkflow?: (input?: {
    nome?: string;
    nos?: WorkflowNo[];
    arestas?: WorkflowAresta[];
    tracos?: WorkflowTraco[];
  }) => Promise<WorkflowVisual>;
  onGetWorkflowDetail?: (workflowId: string) => Promise<WorkflowDetail>;
  onSaveWorkflow: (wf: {
    workflow_id?: string;
    nome: string;
    descricao?: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos?: WorkflowTraco[];
    ativo?: boolean;
    base_revision?: number;
  }) => Promise<WorkflowVisual>;
  onDeleteWorkflow?: (workflowId: string) => Promise<void>;
  onListVersions?: (workflowId: string) => Promise<WorkflowVersionSummary[]>;
  onGetVersion?: (workflowId: string, versionId: string) => Promise<WorkflowVersionRecord>;
  onRestoreVersion?: (workflowId: string, versionId: string) => Promise<WorkflowDetail>;
  onExecuteWorkflow: (
    workflowId: string,
    options?: { from_node_id?: string; trigger_node_id?: string }
  ) => Promise<{ tarefas_criadas: string[]; execucao?: WorkflowRunDetailType }>;
  onExecuteStep?: (workflowId: string, nodeId: string) => Promise<WorkflowStepRecord>;
  onListRuns?: (
    workflowId: string,
    options?: { limit?: number; before?: string }
  ) => Promise<{ execucoes: WorkflowRunDetailType[]; solo_steps: WorkflowStepRecord[] }>;
  onGetRunDetail?: (runId: string) => Promise<WorkflowRunDetailType>;
  onStopRun?: (runId: string) => Promise<WorkflowRunDetailType>;
  onDecideStep?: (stepId: string, approved: boolean) => Promise<unknown>;
  onRetryStep?: (stepId: string) => Promise<unknown>;
  onStopStep?: (stepId: string) => Promise<void>;
  onRotateWebhook?: (
    workflowId: string,
    nodeId: string
  ) => Promise<{ route_id: string; webhook_url: string; secret: string }>;
  onUploadFile?: (file: File) => Promise<void>;
}

export const TRIGGER_PRESETS: Array<{
  titulo: string;
  triggerKind: WorkflowNo["triggerKind"];
  conectorId?: string;
}> = [
  { titulo: "Gatilho Agendado", triggerKind: "schedule" },
  { titulo: "Webhook Externo", triggerKind: "webhook" },
  { titulo: "WhatsApp Recebido", triggerKind: "whatsapp" },
  { titulo: "Menção no Slack", triggerKind: "conector", conectorId: "slack" },
  { titulo: "Comando Discord", triggerKind: "conector", conectorId: "discord" },
  { titulo: "Evento GitHub", triggerKind: "conector", conectorId: "github" },
  { titulo: "Disparo Manual", triggerKind: "manual" },
];
