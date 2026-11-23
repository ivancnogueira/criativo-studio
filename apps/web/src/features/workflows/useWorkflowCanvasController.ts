import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeWorkflowGraph,
  workflowLoopEdges,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowRunDetail as WorkflowRunDetailType,
  type WorkflowStepRecord,
  type WorkflowTraco,
  type WorkflowTriggerState,
  type WorkflowVersionRecord,
  type WorkflowVersionSummary,
} from "@criativo/contracts";
import { WorkflowRevisionConflictError } from "../../services/websocket-client";
import type { PendingWorkflowDelete } from "./WorkflowDeleteUndoToast";
import { buildNodeRunViewMap } from "./workflow-canvas-helpers";
import type { CanvasHistorySnapshot, WorkflowsCanvasPageProps } from "./workflow-canvas-types";
import { useWorkflowCanvasGraphActions } from "./useWorkflowCanvasGraphActions";

export function useWorkflowCanvasController(props: WorkflowsCanvasPageProps) {
  const {
    workflows,
    uso,
    workflowEventSignal,
    onCreateWorkflow,
    onGetWorkflowDetail,
    onSaveWorkflow,
    onListVersions,
    onExecuteWorkflow,
    onListRuns
  } = props;

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
  const [undoStack, setUndoStack] = useState<CanvasHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasHistorySnapshot[]>([]);

  const undoStackRef = useRef<CanvasHistorySnapshot[]>([]);
  const redoStackRef = useRef<CanvasHistorySnapshot[]>([]);
  const localNosRef = useRef<WorkflowNo[]>(localNos);
  const localArestasRef = useRef<WorkflowAresta[]>(localArestas);
  const localTracosRef = useRef<WorkflowTraco[]>(localTracos);
  const patchCoalesceRef = useRef<{ nodeId: string; ts: number } | null>(null);
  const preStrokeSnapshotRef = useRef<CanvasHistorySnapshot | null>(null);

  useEffect(() => {
    localNosRef.current = localNos;
  }, [localNos]);
  useEffect(() => {
    localArestasRef.current = localArestas;
  }, [localArestas]);
  useEffect(() => {
    localTracosRef.current = localTracos;
  }, [localTracos]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingNodeRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    startSnapshot: CanvasHistorySnapshot;
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
    undoStackRef.current = [];
    redoStackRef.current = [];
    patchCoalesceRef.current = null;
    preStrokeSnapshotRef.current = null;
    setUndoStack([]);
    setRedoStack([]);
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

  // Atalhos globais de teclado (Ctrl+F, Ctrl+Z/Y, Delete, etc.) registrados após handlers do grafo.

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
          "Fluxo atualizado por outra sessão ou Criativo; grafo sincronizado."
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

  const graphActions = useWorkflowCanvasGraphActions({
    props,
    currentWf,
    setLocalNos,
    setLocalArestas,
    setLocalTracos,
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    connectingFrom,
    setConnectingFrom,
    zoom,
    setZoom,
    panOffset,
    setPanOffset,
    activeTool,
    setSearchOpen,
    setAddNodeMenuOpen,
    setRunsMenuOpen,
    setTriggerMenuOpen,
    setStatusFeedback,
    setUndoStack,
    setRedoStack,
    undoStackRef,
    redoStackRef,
    localNosRef,
    localArestasRef,
    localTracosRef,
    patchCoalesceRef,
    preStrokeSnapshotRef,
    stageRef,
    draggingNodeRef,
    panningRef,
    drawingStrokeRef,
    pendingSavePayloadRef,
    setMouseWorld,
    flushQueuedSave,
    scheduleDebouncedSave,
    displayNos,
    displayTracos,
    isReadOnly
  });

  const {
    centerOnNode,
    fitView,
    pushUndoSnapshot,
    handleAddNode,
    handlePatchNode,
    handleDeleteNode,
    handleDuplicateNode,
    handleDeleteEdge,
    handleFinishConnect,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
    handleUndo,
    handleRedo,
    handleAutoLayout,
    handleSaveNow
  } = graphActions;

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

  return {
    hiddenDeletedIds,
    setHiddenDeletedIds,
    visibleWorkflows,
    activeWfId,
    setActiveWfId,
    currentWf,
    localNos,
    setLocalNos,
    localArestas,
    setLocalArestas,
    localTracos,
    setLocalTracos,
    localRevision,
    setLocalRevision,
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    connectingFrom,
    setConnectingFrom,
    zoom,
    setZoom,
    panOffset,
    setPanOffset,
    activeTool,
    setActiveTool,
    showMinimap,
    setShowMinimap,
    searchOpen,
    setSearchOpen,
    addNodeMenuOpen,
    setAddNodeMenuOpen,
    runsMenuOpen,
    setRunsMenuOpen,
    inspectorOpen,
    setInspectorOpen,
    triggerMenuOpen,
    setTriggerMenuOpen,
    triggerModalNode,
    setTriggerModalNode,
    versions,
    setVersions,
    triggers,
    setTriggers,
    runs,
    setRuns,
    selectedRunId,
    setSelectedRunId,
    soloSteps,
    setSoloSteps,
    hasMoreRuns,
    setHasMoreRuns,
    previewVersion,
    setPreviewVersion,
    restoringVersion,
    setRestoringVersion,
    pendingDelete,
    setPendingDelete,
    statusFeedback,
    setStatusFeedback,
    executing,
    setExecuting,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    undoStackRef,
    redoStackRef,
    localNosRef,
    localArestasRef,
    localTracosRef,
    patchCoalesceRef,
    preStrokeSnapshotRef,
    stageRef,
    draggingNodeRef,
    panningRef,
    drawingStrokeRef,
    saveTimerRef,
    inFlightSaveRef,
    pendingSavePayloadRef,
    localRevRef,
    mouseWorld,
    setMouseWorld,
    hydrateWorkflowSideData,
    flushQueuedSave,
    scheduleDebouncedSave,
    previewGraph,
    displayNos,
    displayArestas,
    displayTracos,
    isReadOnly,
    loopEdges,
    selectedRun,
    liveRun,
    nodeRunViewMap,
    centerOnNode,
    fitView,
    pushUndoSnapshot,
    handleAddNode,
    handlePatchNode,
    handleDeleteNode,
    handleDuplicateNode,
    handleDeleteEdge,
    handleFinishConnect,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
    handleUndo,
    handleRedo,
    handleAutoLayout,
    handleSaveNow,
    handleRunWorkflow,
    handleCreateFlow,
    doneCount,
    totalExecCount,
    totalTokens30d
  };
}

export type WorkflowCanvasController = ReturnType<typeof useWorkflowCanvasController>;
