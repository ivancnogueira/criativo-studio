import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canConnectPorts,
  normalizeWorkflowGraph,
  workflowLoopEdges,
  type AgenteRegistro,
  type ArquivoStudio,
  type CanalEquipe,
  type ProvedorStatusInfo,
  type TipoNoWorkflow,
  type UsoProvedoresSnapshot,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowDetail,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowRunDetail as WorkflowRunDetailType,
  type WorkflowStepRecord,
  type WorkflowTraco,
  type WorkflowTriggerState,
  type WorkflowVersionRecord,
  type WorkflowVersionSummary,
  type WorkflowVisual,
} from "@criativo/contracts";
import {
  Activity,
  ChevronDown,
  Hand,
  ListChecks,
  Map as MapIcon,
  Maximize2,
  Minus,
  MousePointer,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  StickyNote,
  Trash2,
  Type,
  Zap,
} from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";
import { WorkflowRevisionConflictError } from "../../services/websocket-client";
import {
  WorkflowDeleteUndoToast,
  type PendingWorkflowDelete,
} from "./WorkflowDeleteUndoToast";
import { WorkflowMinimap } from "./WorkflowMinimap";
import { WorkflowNodeCard } from "./WorkflowNodes";
import { WorkflowRunDetail } from "./WorkflowRunDetail";
import { WorkflowSearch } from "./WorkflowSearch";
import { WorkflowSwitcher } from "./WorkflowSwitcher";
import { WorkflowTriggerModal } from "./WorkflowTriggerModal";
import { WorkflowVersionBar } from "./WorkflowVersionBar";
import {
  WORKFLOW_NODE_LIBRARY,
  WORKFLOW_PORT_META,
  WORKFLOW_STATUS_META,
  buildNodeRunViewMap,
  computeGraphBounds,
  defaultTitleForNodeType,
  getWorkflowNodeWidth,
} from "./workflow-canvas-helpers";

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

const TRIGGER_PRESETS: Array<{ titulo: string; triggerKind: WorkflowNo["triggerKind"] }> = [
  { titulo: "Gatilho Agendado", triggerKind: "schedule" },
  { titulo: "Webhook Externo", triggerKind: "webhook" },
  { titulo: "WhatsApp Recebido", triggerKind: "whatsapp" },
  { titulo: "Disparo Manual", triggerKind: "manual" },
];

export const WorkflowsCanvasPage: React.FC<WorkflowsCanvasPageProps> = ({
  workflows,
  agentes,
  canais = [],
  arquivos = [],
  provedores = [],
  uso,
  workflowEventSignal,
  onCreateWorkflow,
  onGetWorkflowDetail,
  onSaveWorkflow,
  onDeleteWorkflow,
  onListVersions,
  onGetVersion,
  onRestoreVersion,
  onExecuteWorkflow,
  onExecuteStep,
  onListRuns,
  onGetRunDetail,
  onStopRun,
  onDecideStep,
  onRetryStep,
  onStopStep,
  onRotateWebhook,
  onUploadFile,
}) => {
  const [hiddenDeletedIds, setHiddenDeletedIds] = useState<Set<string>>(() => new Set());
  const visibleWorkflows = useMemo(
    () => workflows.filter((w) => !hiddenDeletedIds.has(w.workflow_id)),
    [workflows, hiddenDeletedIds]
  );

  const [activeWfId, setActiveWfId] = useState<string | null>(
    visibleWorkflows[0]?.workflow_id ?? null
  );
  const currentWf = useMemo(
    () =>
      visibleWorkflows.find((w) => w.workflow_id === activeWfId) ??
      visibleWorkflows[0] ??
      null,
    [visibleWorkflows, activeWfId]
  );

  const [localNos, setLocalNos] = useState<WorkflowNo[]>(() =>
    currentWf ? normalizeWorkflowGraph(currentWf).nos : []
  );
  const [localArestas, setLocalArestas] = useState<WorkflowAresta[]>(() =>
    currentWf ? normalizeWorkflowGraph(currentWf).arestas : []
  );
  const [localTracos, setLocalTracos] = useState<WorkflowTraco[]>(() =>
    currentWf ? normalizeWorkflowGraph(currentWf).tracos : []
  );
  const [localRevision, setLocalRevision] = useState<number>(
    () => currentWf?.revisao_grafo ?? 0
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    branch?: WorkflowBranch | null;
    portType?: WorkflowPortType;
  } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [activeTool, setActiveTool] = useState<"select" | "hand" | "draw">("select");
  const [showMinimap, setShowMinimap] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addNodeMenuOpen, setAddNodeMenuOpen] = useState(false);
  const [runsMenuOpen, setRunsMenuOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [triggerMenuOpen, setTriggerMenuOpen] = useState(false);
  const [triggerModalNode, setTriggerModalNode] = useState<WorkflowNo | null>(null);

  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [triggers, setTriggers] = useState<WorkflowTriggerState[]>([]);
  const [runs, setRuns] = useState<WorkflowRunDetailType[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [soloSteps, setSoloSteps] = useState<WorkflowStepRecord[]>([]);
  const [hasMoreRuns, setHasMoreRuns] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<WorkflowVersionRecord | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingWorkflowDelete | null>(null);

  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingNodeRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const panningRef = useRef<{
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  } | null>(null);
  const drawingStrokeRef = useRef<WorkflowTraco | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const inFlightSaveRef = useRef(false);
  const pendingSavePayloadRef = useRef<{
    workflowId: string;
    nome: string;
    descricao: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos: WorkflowTraco[];
    ativo: boolean;
  } | null>(null);
  const localRevRef = useRef<number>(0);
  useEffect(() => {
    localRevRef.current = localRevision;
  }, [localRevision]);

  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 });

  const hydrateWorkflowSideData = useCallback(
    async (wfId: string) => {
      try {
        if (onGetWorkflowDetail) {
          const det = await onGetWorkflowDetail(wfId);
          setVersions(det.versions ?? []);
          setTriggers(det.triggers ?? []);
          if (!pendingSavePayloadRef.current && !inFlightSaveRef.current) {
            const norm = normalizeWorkflowGraph(det.workflow);
            setLocalNos(norm.nos);
            setLocalArestas(norm.arestas);
            setLocalTracos(norm.tracos);
            setLocalRevision(det.workflow.revisao_grafo ?? 0);
          }
        } else if (onListVersions) {
          setVersions(await onListVersions(wfId));
        }

        if (onListRuns) {
          const runData = await onListRuns(wfId, { limit: 20 });
          setRuns(runData.execucoes ?? []);
          setSoloSteps(runData.solo_steps ?? []);
          setHasMoreRuns((runData.execucoes?.length ?? 0) >= 20);
          if (runData.execucoes.length > 0) {
            setSelectedRunId((prev) =>
              prev && runData.execucoes.some((e) => e.run.run_id === prev)
                ? prev
                : runData.execucoes[0].run.run_id
            );
          } else {
            setSelectedRunId(null);
          }
        }
      } catch {
        // tolerante em ambientes sem daemon ativo (SSR)
      }
    },
    [onGetWorkflowDetail, onListVersions, onListRuns]
  );

  // Hidrata grafo ao trocar de workflow
  useEffect(() => {
    if (!currentWf) {
      setLocalNos([]);
      setLocalArestas([]);
      setLocalTracos([]);
      setLocalRevision(0);
      setVersions([]);
      setTriggers([]);
      setRuns([]);
      setSoloSteps([]);
      return;
    }

    const norm = normalizeWorkflowGraph({
      nos: currentWf.nos,
      arestas: currentWf.arestas,
      tracos: currentWf.tracos ?? [],
    });
    setLocalNos(norm.nos);
    setLocalArestas(norm.arestas);
    setLocalTracos(norm.tracos);
    setLocalRevision(currentWf.revisao_grafo ?? 0);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPreviewVersion(null);
    void hydrateWorkflowSideData(currentWf.workflow_id);
  }, [currentWf?.workflow_id]);

  // Reage a eventos WebSocket em tempo real
  useEffect(() => {
    if (!workflowEventSignal || workflowEventSignal.nonce === 0 || !currentWf) return;
    if (
      workflowEventSignal.workflowId &&
      workflowEventSignal.workflowId !== currentWf.workflow_id
    ) {
      return;
    }
    void hydrateWorkflowSideData(currentWf.workflow_id);
  }, [workflowEventSignal?.nonce, currentWf?.workflow_id, hydrateWorkflowSideData]);

  // Atalho Ctrl/Cmd + F para busca no canvas
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setConnectingFrom(null);
        setAddNodeMenuOpen(false);
        setRunsMenuOpen(false);
        setTriggerMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const flushQueuedSave = useCallback(async () => {
    if (inFlightSaveRef.current || !pendingSavePayloadRef.current) return;
    const payload = pendingSavePayloadRef.current;
    pendingSavePayloadRef.current = null;
    inFlightSaveRef.current = true;

    try {
      const saved = await onSaveWorkflow({
        workflow_id: payload.workflowId,
        nome: payload.nome,
        descricao: payload.descricao,
        nos: payload.nos,
        arestas: payload.arestas,
        tracos: payload.tracos,
        ativo: payload.ativo,
        base_revision: localRevRef.current,
      });
      setLocalRevision(saved.revisao_grafo ?? localRevRef.current + 1);
    } catch (err) {
      if (err instanceof WorkflowRevisionConflictError) {
        const norm = normalizeWorkflowGraph(err.conflict.workflow);
        setLocalNos(norm.nos);
        setLocalArestas(norm.arestas);
        setLocalTracos(norm.tracos);
        setLocalRevision(err.conflict.workflow.revisao_grafo ?? 0);
        setVersions(err.conflict.versions ?? []);
        setTriggers(err.conflict.triggers ?? []);
        setStatusFeedback(
          "Fluxo atualizado por outra sessão ou agente; grafo sincronizado."
        );
      } else {
        setStatusFeedback(
          err instanceof Error ? err.message : "Falha ao gravar alterações do fluxo."
        );
      }
    } finally {
      inFlightSaveRef.current = false;
      if (pendingSavePayloadRef.current) {
        void flushQueuedSave();
      }
    }
  }, [onSaveWorkflow]);

  const scheduleDebouncedSave = useCallback(
    (
      nextNos: WorkflowNo[],
      nextArestas: WorkflowAresta[],
      nextTracos: WorkflowTraco[] = localTracos,
      overrideName?: string
    ) => {
      if (!currentWf || previewVersion) return;
      pendingSavePayloadRef.current = {
        workflowId: currentWf.workflow_id,
        nome: overrideName ?? currentWf.nome,
        descricao: currentWf.descricao ?? "",
        nos: nextNos,
        arestas: nextArestas,
        tracos: nextTracos,
        ativo: currentWf.ativo,
      };

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushQueuedSave();
      }, 400);
    },
    [currentWf, previewVersion, localTracos, flushQueuedSave]
  );

  // Dados ativos considerando modo preview somente-leitura
  const previewGraph = useMemo(() => {
    if (!previewVersion) return null;
    try {
      const parsed = JSON.parse(previewVersion.grafo_json) as {
        nos?: WorkflowNo[];
        arestas?: WorkflowAresta[];
        tracos?: WorkflowTraco[];
      };
      return normalizeWorkflowGraph({
        nos: parsed.nos ?? [],
        arestas: parsed.arestas ?? [],
        tracos: parsed.tracos ?? [],
      });
    } catch {
      return null;
    }
  }, [previewVersion]);

  const displayNos = previewGraph ? previewGraph.nos : localNos;
  const displayArestas = previewGraph ? previewGraph.arestas : localArestas;
  const displayTracos = previewGraph ? previewGraph.tracos : localTracos;
  const isReadOnly = Boolean(previewVersion);

  const loopEdges = useMemo(
    () => workflowLoopEdges(displayNos, displayArestas),
    [displayNos, displayArestas]
  );

  const selectedRun = useMemo(
    () => runs.find((r) => r.run.run_id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  );

  const liveRun = useMemo(
    () =>
      runs.find(
        (r) =>
          r.run.status === "running" ||
          r.run.status === "approval" ||
          r.run.status === "stopping"
      ) ?? null,
    [runs]
  );

  const nodeRunViewMap = useMemo(
    () => buildNodeRunViewMap(selectedRun, soloSteps),
    [selectedRun, soloSteps]
  );

  const centerOnNode = useCallback(
    (nodeId: string) => {
      const target = displayNos.find((n) => n.id === nodeId);
      if (!target) return;
      const rect = stageRef.current?.getBoundingClientRect();
      const vw = rect?.width ?? 1200;
      const vh = rect?.height ?? 720;
      const nodeW = getWorkflowNodeWidth(target);
      setPanOffset({
        x: vw / 2 - (target.x + nodeW / 2) * zoom,
        y: vh / 2 - (target.y + 80) * zoom,
      });
      setSelectedNodeId(nodeId);
    },
    [displayNos, zoom]
  );

  const fitView = useCallback(() => {
    if (displayNos.length === 0) {
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
      return;
    }
    const bounds = computeGraphBounds(displayNos, displayTracos);
    const rect = stageRef.current?.getBoundingClientRect();
    const vw = rect?.width ?? 1200;
    const vh = rect?.height ?? 720;
    const margin = 64;
    const scaleX = (vw - margin * 2) / Math.max(200, bounds.width);
    const scaleY = (vh - margin * 2) / Math.max(200, bounds.height);
    const nextZoom = Math.max(0.5, Math.min(1.2, Math.min(scaleX, scaleY)));
    setZoom(nextZoom);
    setPanOffset({
      x: vw / 2 - (bounds.minX + bounds.width / 2) * nextZoom,
      y: vh / 2 - (bounds.minY + bounds.height / 2) * nextZoom,
    });
  }, [displayNos, displayTracos]);

  const handleAddNode = (tipo: TipoNoWorkflow, extra?: Partial<WorkflowNo>) => {
    if (isReadOnly) return;
    const x =
      displayNos.length > 0
        ? Math.max(...displayNos.map((n) => n.x)) + 360
        : 220;
    const y = displayNos.length > 0 ? displayNos[0].y : 180;
    const newNode: WorkflowNo = {
      id: `no_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tipo,
      titulo: extra?.titulo ?? defaultTitleForNodeType(tipo),
      x,
      y,
      config: extra?.config ?? {},
      ...extra,
    };
    const nextNos = [...localNos, newNode];
    setLocalNos(nextNos);
    setSelectedNodeId(newNode.id);
    setAddNodeMenuOpen(false);
    setTriggerMenuOpen(false);
    scheduleDebouncedSave(nextNos, localArestas);
  };

  const handlePatchNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNo>) => {
      if (isReadOnly) return;
      setLocalNos((prev) => {
        const next = prev.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                ...patch,
                config: patch.config ? { ...n.config, ...patch.config } : n.config,
              }
            : n
        );
        scheduleDebouncedSave(next, localArestas);
        return next;
      });
    },
    [isReadOnly, localArestas, scheduleDebouncedSave]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (isReadOnly) return;
      const nextNos = localNos.filter((n) => n.id !== nodeId);
      const nextArestas = localArestas.filter(
        (a) => a.origem !== nodeId && a.destino !== nodeId
      );
      setLocalNos(nextNos);
      setLocalArestas(nextArestas);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      scheduleDebouncedSave(nextNos, nextArestas);
    },
    [isReadOnly, localNos, localArestas, selectedNodeId, scheduleDebouncedSave]
  );

  const handleDuplicateNode = useCallback(
    (node: WorkflowNo) => {
      if (isReadOnly) return;
      const clone: WorkflowNo = {
        ...node,
        id: `no_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        x: node.x + 32,
        y: node.y + 32,
        config: { ...(node.config ?? {}) },
      };
      const nextNos = [...localNos, clone];
      setLocalNos(nextNos);
      setSelectedNodeId(clone.id);
      scheduleDebouncedSave(nextNos, localArestas);
    },
    [isReadOnly, localNos, localArestas, scheduleDebouncedSave]
  );

  const handleFinishConnect = useCallback(
    (targetNodeId: string) => {
      if (!connectingFrom || isReadOnly) return;
      const src = localNos.find((n) => n.id === connectingFrom.nodeId);
      const dst = localNos.find((n) => n.id === targetNodeId);
      if (!src || !dst) {
        setConnectingFrom(null);
        return;
      }
      const check = canConnectPorts(
        src,
        dst,
        connectingFrom.portType,
        connectingFrom.branch
      );
      if (!check.ok || !check.resolvedType) {
        setStatusFeedback(check.reason ?? "Porta incompatível com este destino.");
        setConnectingFrom(null);
        return;
      }

      const dup = localArestas.some(
        (a) =>
          a.origem === src.id &&
          a.destino === dst.id &&
          (a.branch ?? null) === (connectingFrom.branch ?? null)
      );
      if (!dup) {
        const edge: WorkflowAresta = {
          id: `edge_${Date.now().toString(36)}`,
          origem: src.id,
          destino: dst.id,
          type: check.resolvedType,
          ...(connectingFrom.branch ? { branch: connectingFrom.branch } : {}),
        };
        const nextEdges = [...localArestas, edge];
        setLocalArestas(nextEdges);
        scheduleDebouncedSave(localNos, nextEdges);
      }
      setConnectingFrom(null);
    },
    [connectingFrom, isReadOnly, localNos, localArestas, scheduleDebouncedSave]
  );

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (connectingFrom) {
      setConnectingFrom(null);
      return;
    }

    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const wx = (e.clientX - rect.left - panOffset.x) / zoom;
    const wy = (e.clientY - rect.top - panOffset.y) / zoom;

    if (activeTool === "draw" && !isReadOnly) {
      drawingStrokeRef.current = {
        id: `tr_${Date.now().toString(36)}`,
        color: "#42A0FF",
        width: 3,
        points: [[wx, wy]],
      };
      return;
    }

    panningRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: panOffset.x,
      origPanY: panOffset.y,
    };
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) {
      setMouseWorld({
        x: (e.clientX - rect.left - panOffset.x) / zoom,
        y: (e.clientY - rect.top - panOffset.y) / zoom,
      });
    }

    if (draggingNodeRef.current && !isReadOnly) {
      const { nodeId, startClientX, startClientY, origX, origY } = draggingNodeRef.current;
      const dx = (e.clientX - startClientX) / zoom;
      const dy = (e.clientY - startClientY) / zoom;
      setLocalNos((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, x: Math.round(origX + dx), y: Math.round(origY + dy) } : n
        )
      );
      return;
    }

    if (drawingStrokeRef.current && rect && !isReadOnly) {
      const wx = (e.clientX - rect.left - panOffset.x) / zoom;
      const wy = (e.clientY - rect.top - panOffset.y) / zoom;
      drawingStrokeRef.current.points.push([wx, wy]);
      const liveStroke = { ...drawingStrokeRef.current };
      setLocalTracos((prev) => [
        ...prev.filter((t) => t.id !== liveStroke.id),
        liveStroke,
      ]);
      return;
    }

    if (panningRef.current) {
      const { startClientX, startClientY, origPanX, origPanY } = panningRef.current;
      setPanOffset({
        x: origPanX + (e.clientX - startClientX),
        y: origPanY + (e.clientY - startClientY),
      });
    }
  };

  const handleStagePointerUp = () => {
    if (draggingNodeRef.current) {
      draggingNodeRef.current = null;
      scheduleDebouncedSave(localNos, localArestas);
    }
    if (drawingStrokeRef.current) {
      drawingStrokeRef.current = null;
      scheduleDebouncedSave(localNos, localArestas, localTracos);
    }
    panningRef.current = null;
  };

  const handleRunWorkflow = async (fromNodeId?: string) => {
    if (!currentWf || executing) return;
    setExecuting(true);
    try {
      const res = await onExecuteWorkflow(
        currentWf.workflow_id,
        fromNodeId ? { from_node_id: fromNodeId } : undefined
      );
      if (res.execucao) {
        setRuns((prev) => [
          res.execucao!,
          ...prev.filter((r) => r.run.run_id !== res.execucao!.run.run_id),
        ]);
        setSelectedRunId(res.execucao.run.run_id);
        setInspectorOpen(true);
      } else {
        await hydrateWorkflowSideData(currentWf.workflow_id);
      }
      setStatusFeedback(
        fromNodeId
          ? "Reaproveitando etapas anteriores e executando a partir do nó."
          : "Fluxo iniciado no motor em grafo."
      );
    } catch (err) {
      setStatusFeedback(err instanceof Error ? err.message : "Erro ao executar fluxo.");
    } finally {
      setExecuting(false);
    }
  };

  const handleCreateFlow = async () => {
    if (onCreateWorkflow) {
      const created = await onCreateWorkflow({
        nome: "Novo fluxo criativo",
        nos: [],
        arestas: [],
      });
      setActiveWfId(created.workflow_id);
    } else {
      const created = await onSaveWorkflow({
        nome: "Novo fluxo criativo",
        nos: [],
        arestas: [],
      });
      setActiveWfId(created.workflow_id);
    }
  };

  const doneCount = liveRun
    ? liveRun.steps.filter((s) => s.status === "done").length
    : 0;
  const totalExecCount = displayNos.filter(
    (n) => n.tipo !== "nota" && n.tipo !== "shape" && n.tipo !== "text"
  ).length;

  const totalTokens30d = uso?.total_tokens_estimados ?? 0;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1A1A1A] text-white">
      {/* Fundo infinito dot-grid */}
      <div
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)",
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
        }}
        className={`openbot-dot-grid relative h-full w-full overflow-hidden ${
          activeTool === "hand"
            ? "cursor-grab active:cursor-grabbing"
            : activeTool === "draw"
              ? "cursor-crosshair"
              : "cursor-default"
        }`}
      >
        {/* Camada transformada do mundo do grafo */}
        <div
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
          className="absolute inset-0"
        >
          {/* SVG de arestas Bézier e traços livres */}
          <svg className="pointer-events-none absolute inset-0 h-[4000px] w-[4000px] overflow-visible">
            {displayTracos.map((tr) => (
              <polyline
                key={tr.id}
                fill="none"
                stroke={tr.color ?? "#42A0FF"}
                strokeWidth={tr.width ?? 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={tr.points.map(([px, py]) => `${px},${py}`).join(" ")}
              />
            ))}

            {displayArestas.map((edge) => {
              const src = displayNos.find((n) => n.id === edge.origem);
              const dst = displayNos.find((n) => n.id === edge.destino);
              if (!src || !dst) return null;

              const srcW = getWorkflowNodeWidth(src);
              const x1 = src.x + srcW;
              const yOffsetBranch =
                edge.branch === "yes" ? 135 : edge.branch === "no" ? 168 : 78;
              const y1 = src.y + yOffsetBranch;
              const x2 = dst.x;
              const y2 = dst.y + 78;
              const dx = Math.max(60, Math.abs(x2 - x1) * 0.45);
              const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

              const isYes = edge.branch === "yes";
              const isNo = edge.branch === "no";
              const isLoop = loopEdges.has(edge.id);
              const portColor = edge.type
                ? WORKFLOW_PORT_META[edge.type].color
                : "#DCDCDC";
              const strokeColor =
                selectedEdgeId === edge.id
                  ? "#007CF7"
                  : isYes
                    ? "#31CF76"
                    : isNo
                      ? "#FD2F3B"
                      : portColor;
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;

              return (
                <g key={edge.id} className="pointer-events-auto cursor-pointer">
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId(edge.id);
                    }}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={selectedEdgeId === edge.id ? 3 : 2}
                    strokeDasharray={isLoop ? "6 4" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId(edge.id);
                    }}
                  />
                  {(isYes || isNo) && (
                    <g transform={`translate(${midX - 18}, ${midY - 10})`}>
                      <rect
                        width={36}
                        height={20}
                        rx={10}
                        fill="#212121"
                        stroke={isYes ? "#31CF76" : "#FD2F3B"}
                      />
                      <text
                        x={18}
                        y={14}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={600}
                        fill={isYes ? "#31CF76" : "#FD2F3B"}
                      >
                        {isYes ? "Sim" : "Não"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {connectingFrom &&
              (() => {
                const src = displayNos.find((n) => n.id === connectingFrom.nodeId);
                if (!src) return null;
                const x1 = src.x + getWorkflowNodeWidth(src);
                const y1 =
                  src.y +
                  (connectingFrom.branch === "yes"
                    ? 135
                    : connectingFrom.branch === "no"
                      ? 168
                      : 78);
                const x2 = mouseWorld.x;
                const y2 = mouseWorld.y;
                const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
                return (
                  <path
                    d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#007CF7"
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                  />
                );
              })()}
          </svg>

          {/* Cards de nós */}
          {displayNos.map((node) => (
            <WorkflowNodeCard
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              readOnly={isReadOnly}
              agentes={agentes}
              canais={canais}
              arquivos={arquivos}
              provedores={provedores}
              nodeRunView={nodeRunViewMap.get(node.id)}
              triggerState={triggers.find((t) => t.node_id === node.id) ?? null}
              connectingFrom={connectingFrom}
              onPointerDownNode={(e, n) => {
                e.stopPropagation();
                setSelectedNodeId(n.id);
                if (activeTool === "select" && !n.locked && !isReadOnly) {
                  draggingNodeRef.current = {
                    nodeId: n.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origX: n.x,
                    origY: n.y,
                  };
                }
              }}
              onSelectNode={(id) => setSelectedNodeId(id)}
              onPatchNode={handlePatchNode}
              onDeleteNode={handleDeleteNode}
              onDuplicateNode={handleDuplicateNode}
              onToggleLockNode={(n) =>
                handlePatchNode(n.id, { locked: !n.locked })
              }
              onStartConnect={(nodeId, branch, portType) =>
                setConnectingFrom({ nodeId, branch, portType })
              }
              onFinishConnect={handleFinishConnect}
              onExecuteStep={
                onExecuteStep && currentWf
                  ? async (nodeId) => {
                      const st = await onExecuteStep(currentWf.workflow_id, nodeId);
                      setSoloSteps((prev) => [
                        st,
                        ...prev.filter((item) => item.step_id !== st.step_id),
                      ]);
                    }
                  : undefined
              }
              onStartFromNode={(nodeId) => void handleRunWorkflow(nodeId)}
              onRetryStep={
                onRetryStep && currentWf
                  ? async (stepId) => {
                      await onRetryStep(stepId);
                      await hydrateWorkflowSideData(currentWf.workflow_id);
                    }
                  : undefined
              }
              onDecideStep={
                onDecideStep && currentWf
                  ? async (stepId, approved) => {
                      await onDecideStep(stepId, approved);
                      await hydrateWorkflowSideData(currentWf.workflow_id);
                    }
                  : undefined
              }
              onOpenTriggerModal={(n) => setTriggerModalNode(n)}
              onUploadFile={onUploadFile}
            />
          ))}
        </div>

        {/* Estado vazio quando não há nós */}
        {displayNos.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto max-w-md rounded-2xl border border-white/[0.12] bg-[#212121] p-6 text-center shadow-2xl space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#FF9412]/15 text-[#FF9412]">
                <Zap className="h-6 w-6" />
              </div>
              <h2 className="text-[20px] font-semibold text-white">Comece com um gatilho</h2>
              <p className="text-[14px] text-[#979797]">
                Defina como este fluxo será disparado automaticamente ou sob demanda.
              </p>
              <div className="relative flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setTriggerMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-lg bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white"
                >
                  <Zap className="h-4 w-4" />
                  <span>Adicionar gatilho</span>
                </button>
                {triggerMenuOpen && (
                  <div className="absolute top-full z-40 mt-2 w-60 rounded-xl border border-white/[0.12] bg-[#212121] p-1 text-left shadow-2xl">
                    {TRIGGER_PRESETS.map((preset) => (
                      <button
                        key={preset.titulo}
                        type="button"
                        onClick={() =>
                          handleAddNode("gatilho", {
                            titulo: preset.titulo,
                            triggerKind: preset.triggerKind,
                            config: { triggerKind: preset.triggerKind },
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                      >
                        <Zap className="h-3.5 w-3.5 text-[#FF9412]" />
                        <span>{preset.titulo}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* HUD Superior */}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-20 flex flex-wrap items-start justify-between gap-2 md:left-[72px]">
        <div className="pointer-events-auto">
          <WorkflowSwitcher
            workflows={visibleWorkflows}
            activeWorkflow={currentWf}
            versions={versions}
            onSelectWorkflow={(wfId) => setActiveWfId(wfId)}
            onCreateWorkflow={() => void handleCreateFlow()}
            onRenameWorkflow={(wfId, nextName) => {
              const target = visibleWorkflows.find((w) => w.workflow_id === wfId);
              if (!target) return;
              void onSaveWorkflow({
                workflow_id: wfId,
                nome: nextName,
                descricao: target.descricao,
                nos: localNos,
                arestas: localArestas,
                tracos: localTracos,
                base_revision: localRevRef.current,
              }).then((saved) => setLocalRevision(saved.revisao_grafo ?? localRevRef.current + 1));
            }}
            onDuplicateWorkflow={(wf) => {
              if (onCreateWorkflow) {
                void onCreateWorkflow({
                  nome: `${wf.nome} (Cópia)`,
                  nos: localNos,
                  arestas: localArestas,
                  tracos: localTracos,
                }).then((c) => setActiveWfId(c.workflow_id));
              }
            }}
            onDeleteWorkflow={(wf) => {
              setHiddenDeletedIds((prev) => new Set([...prev, wf.workflow_id]));
              setPendingDelete({ workflowId: wf.workflow_id, nome: wf.nome });
            }}
            onPreviewVersion={async (verId) => {
              if (!currentWf || !onGetVersion) return;
              const rec = await onGetVersion(currentWf.workflow_id, verId);
              setPreviewVersion(rec);
            }}
          />
        </div>

        {/* Barra de versão somente leitura centrada */}
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <WorkflowVersionBar
            previewVersion={previewVersion}
            restoring={restoringVersion}
            onExitPreview={() => setPreviewVersion(null)}
            onRestoreVersion={async (verId) => {
              if (!currentWf || !onRestoreVersion) return;
              setRestoringVersion(true);
              try {
                const det = await onRestoreVersion(currentWf.workflow_id, verId);
                const norm = normalizeWorkflowGraph(det.workflow);
                setLocalNos(norm.nos);
                setLocalArestas(norm.arestas);
                setLocalTracos(norm.tracos);
                setLocalRevision(det.workflow.revisao_grafo ?? 0);
                setVersions(det.versions ?? []);
                setPreviewVersion(null);
                setStatusFeedback("Versão restaurada para revisão atual.");
              } finally {
                setRestoringVersion(false);
              }
            }}
          />

          {liveRun && (
            <button
              type="button"
              onClick={() => {
                setSelectedRunId(liveRun.run.run_id);
                setInspectorOpen(true);
              }}
              className="flex items-center gap-2 rounded-full border border-[#007CF7]/40 bg-[#212121] px-3 py-1 text-[12px] font-semibold text-white shadow-xl"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: WORKFLOW_STATUS_META[liveRun.run.status].color }}
              />
              <span>
                Execução #{liveRun.run.numero} · {WORKFLOW_STATUS_META[liveRun.run.status].label} ({doneCount}/
                {Math.max(1, totalExecCount)})
              </span>
            </button>
          )}
        </div>

        {/* Controles à direita do HUD */}
        <div className="pointer-events-auto flex items-center gap-2">
          {selectedEdgeId && !isReadOnly && (
            <button
              type="button"
              onClick={() => {
                const nextEdges = localArestas.filter((a) => a.id !== selectedEdgeId);
                setLocalArestas(nextEdges);
                setSelectedEdgeId(null);
                scheduleDebouncedSave(localNos, nextEdges);
              }}
              className="flex items-center gap-1 rounded-xl border border-[#FD2F3B]/40 bg-[#212121] px-3 py-2 text-[12px] font-semibold text-[#FD2F3B] shadow-2xl"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remover conexão</span>
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setRunsMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded-xl border border-white/[0.12] bg-[#212121] px-3 py-2 text-[14px] font-normal text-[#DCDCDC] shadow-2xl hover:bg-[#2A2A2A]"
            >
              <ListChecks className="h-4 w-4 text-[#979797]" />
              <span>Histórico de execuções</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#979797]" />
            </button>
            {runsMenuOpen && (
              <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-white/[0.12] bg-[#212121] p-2 shadow-2xl">
                {runs.length === 0 ? (
                  <p className="p-2 text-[12px] text-[#979797]">
                    Aguardando primeira execução deste fluxo.
                  </p>
                ) : (
                  <div className="max-h-60 space-y-1 overflow-y-auto">
                    {runs.slice(0, 15).map((r) => (
                      <button
                        key={r.run.run_id}
                        type="button"
                        onClick={() => {
                          setSelectedRunId(r.run.run_id);
                          setInspectorOpen(true);
                          setRunsMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                      >
                        <span>Execução #{r.run.numero}</span>
                        <span className={WORKFLOW_STATUS_META[r.run.status].badgeTextClass}>
                          {WORKFLOW_STATUS_META[r.run.status].label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            className="flex items-center gap-1 rounded-xl border border-white/[0.12] bg-[#212121] px-3 py-2 text-[14px] font-normal text-[#DCDCDC] shadow-2xl hover:bg-[#2A2A2A]"
          >
            <Activity className="h-4 w-4 text-[#42A0FF]" />
            <span>Abrir inspetor</span>
          </button>

          {liveRun && onStopRun ? (
            <button
              type="button"
              onClick={() => void onStopRun(liveRun.run.run_id).then(() => currentWf && hydrateWorkflowSideData(currentWf.workflow_id))}
              className="flex items-center gap-2 rounded-xl border border-[#FD2F3B]/50 bg-[#FD2F3B]/15 px-4 py-2 text-[14px] font-semibold text-[#FD2F3B] shadow-2xl hover:bg-[#FD2F3B]/25"
            >
              <Square className="h-4 w-4 fill-current" />
              <span>Interromper execução</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!currentWf || executing}
              onClick={() => void handleRunWorkflow()}
              className="flex items-center gap-2 rounded-xl bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] shadow-2xl hover:bg-white disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>{executing ? "Executando fluxo..." : "Executar fluxo"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Overlay de busca Ctrl/Cmd+F */}
      {searchOpen && (
        <div className="fixed right-4 top-20 z-30">
          <WorkflowSearch
            open={searchOpen}
            nos={displayNos}
            runViewMap={nodeRunViewMap}
            onSelectResult={(nodeId) => centerOnNode(nodeId)}
            onClose={() => setSearchOpen(false)}
          />
        </div>
      )}

      {/* Aviso discreto de validação / feedback */}
      {statusFeedback && (
        <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-white/[0.12] bg-[#212121] px-4 py-2 text-[12px] text-[#DCDCDC] shadow-2xl">
          <span>{statusFeedback}</span>
        </div>
      )}

      {/* Barra flutuante inferior esquerda: Widget Uso */}
      <div className="fixed bottom-4 left-4 z-20 rounded-xl border border-white/[0.12] bg-[#212121] px-3 py-2 shadow-2xl md:left-[72px]">
        <div className="flex items-center gap-2 text-[12px]">
          <ProviderLogo provider="gemini" size={14} />
          <span className="font-semibold text-white">Uso</span>
          <span className="text-[#979797]">
            {totalTokens30d.toLocaleString("pt-BR")} tokens · 30 dias
          </span>
        </div>
      </div>

      {/* Barra de ferramentas central inferior */}
      <div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl">
        <button
          type="button"
          aria-label="Selecionar etapa"
          onClick={() => setActiveTool("select")}
          className={`rounded-lg p-2 ${
            activeTool === "select" ? "bg-[#2A2A2A] text-white" : "text-[#979797] hover:text-white"
          }`}
        >
          <MousePointer className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Mover canvas"
          onClick={() => setActiveTool("hand")}
          className={`rounded-lg p-2 ${
            activeTool === "hand" ? "bg-[#2A2A2A] text-white" : "text-[#979797] hover:text-white"
          }`}
        >
          <Hand className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Desenhar traço"
          onClick={() => setActiveTool("draw")}
          className={`rounded-lg p-2 ${
            activeTool === "draw" ? "bg-[#2A2A2A] text-[#42A0FF]" : "text-[#979797] hover:text-white"
          }`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Adicionar nota adesiva"
          onClick={() => handleAddNode("nota", { titulo: "Nota visual" })}
          className="rounded-lg p-2 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
        >
          <StickyNote className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Inserir rótulo de texto"
          onClick={() => handleAddNode("text", { titulo: "Seção do Fluxo" })}
          className="rounded-lg p-2 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
        >
          <Type className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Buscar nó"
          onClick={() => setSearchOpen((v) => !v)}
          className="rounded-lg p-2 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
        >
          <Search className="h-4 w-4" />
        </button>

        <div className="mx-1 h-5 w-px bg-white/[0.06]" />

        <div className="relative">
          <button
            type="button"
            disabled={isReadOnly}
            onClick={() => setAddNodeMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Adicionar nó</span>
          </button>

          {addNodeMenuOpen && (
            <div className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-xl border border-white/[0.12] bg-[#212121] p-2 shadow-2xl">
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {WORKFLOW_NODE_LIBRARY.map((item) => (
                  <button
                    key={item.tipo}
                    type="button"
                    onClick={() => handleAddNode(item.tipo)}
                    className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-[#2A2A2A]"
                  >
                    <span className="block text-[14px] font-semibold text-white">
                      {item.titulo}
                    </span>
                    <span className="block text-[12px] text-[#979797]">{item.descricao}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Minimapa + Cápsula de Zoom no canto inferior direito */}
      <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-2">
        {showMinimap && (
          <WorkflowMinimap
            nos={displayNos}
            tracos={displayTracos}
            selectedNodeId={selectedNodeId}
            viewport={{
              x: -panOffset.x / zoom,
              y: -panOffset.y / zoom,
              width: 1100,
              height: 680,
              zoom,
            }}
            onPanToWorld={(wx, wy) => {
              const rect = stageRef.current?.getBoundingClientRect();
              const vw = rect?.width ?? 1100;
              const vh = rect?.height ?? 680;
              setPanOffset({
                x: vw / 2 - wx * zoom,
                y: vh / 2 - wy * zoom,
              });
            }}
          />
        )}

        <div className="flex items-center gap-1 rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl">
          <button
            type="button"
            aria-label="Alternar minimapa"
            onClick={() => setShowMinimap((v) => !v)}
            className={`rounded-lg p-1.5 ${
              showMinimap ? "bg-[#2A2A2A] text-[#42A0FF]" : "text-[#979797] hover:text-white"
            }`}
          >
            <MapIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reduzir zoom"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
            className="rounded-lg p-1.5 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center text-[12px] font-semibold text-[#DCDCDC]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Ampliar zoom"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))}
            className="rounded-lg p-1.5 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Ajustar visualização"
            onClick={fitView}
            className="rounded-lg p-1.5 text-[#979797] hover:bg-[#2A2A2A] hover:text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Modal de configuração de gatilho */}
      {triggerModalNode && currentWf && onRotateWebhook && (
        <WorkflowTriggerModal
          workflowId={currentWf.workflow_id}
          node={triggerModalNode}
          triggerState={triggers.find((t) => t.node_id === triggerModalNode.id) ?? null}
          onApply={(nodeId, patch) => handlePatchNode(nodeId, patch)}
          onRotateWebhook={async (nodeId) => {
            const rot = await onRotateWebhook(currentWf.workflow_id, nodeId);
            await hydrateWorkflowSideData(currentWf.workflow_id);
            return rot;
          }}
          onClose={() => setTriggerModalNode(null)}
        />
      )}

      {/* Drawer lateral do inspetor de execução */}
      <WorkflowRunDetail
        open={inspectorOpen}
        runs={runs}
        selectedRun={selectedRun}
        soloSteps={soloSteps}
        nodes={displayNos}
        hasMoreRuns={hasMoreRuns}
        onSelectRun={async (runId) => {
          setSelectedRunId(runId);
          if (onGetRunDetail) {
            const det = await onGetRunDetail(runId);
            setRuns((prev) =>
              prev.map((r) => (r.run.run_id === runId ? det : r))
            );
          }
        }}
        onLoadMoreRuns={async () => {
          if (!currentWf || !onListRuns) return;
          const nextPage = await onListRuns(currentWf.workflow_id, {
            limit: 20,
            before: String(runs.length),
          });
          setRuns((prev) => [...prev, ...(nextPage.execucoes ?? [])]);
          setHasMoreRuns((nextPage.execucoes?.length ?? 0) >= 20);
        }}
        onFocusNode={(nodeId) => centerOnNode(nodeId)}
        onStopRun={(runId) => {
          if (onStopRun && currentWf) {
            void onStopRun(runId).then(() => hydrateWorkflowSideData(currentWf.workflow_id));
          }
        }}
        onDecideStep={(stepId, approved) => {
          if (onDecideStep && currentWf) {
            void onDecideStep(stepId, approved).then(() =>
              hydrateWorkflowSideData(currentWf.workflow_id)
            );
          }
        }}
        onRetryStep={(stepId) => {
          if (onRetryStep && currentWf) {
            void onRetryStep(stepId).then(() =>
              hydrateWorkflowSideData(currentWf.workflow_id)
            );
          }
        }}
        onStopStep={(stepId) => {
          if (onStopStep && currentWf) {
            void onStopStep(stepId).then(() =>
              hydrateWorkflowSideData(currentWf.workflow_id)
            );
          }
        }}
        onClose={() => setInspectorOpen(false)}
      />

      {/* Toast Undo 6s para exclusão de fluxo */}
      <WorkflowDeleteUndoToast
        pending={pendingDelete}
        onUndoDelete={(wfId) => {
          setHiddenDeletedIds((prev) => {
            const next = new Set(prev);
            next.delete(wfId);
            return next;
          });
          setPendingDelete(null);
        }}
        onCommitDelete={async (wfId) => {
          if (onDeleteWorkflow) {
            await onDeleteWorkflow(wfId);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
};
