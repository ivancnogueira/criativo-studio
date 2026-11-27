import React, { useCallback, useEffect } from "react";
import {
  canConnectPorts,
  normalizeWorkflowNode,
  type TipoNoWorkflow,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowTraco,
  type WorkflowVisual,
} from "@criativo/contracts";
import {
  WORKFLOW_PORT_META,
  computeGraphBounds,
  defaultTitleForNodeType,
  getWorkflowNodeWidth,
} from "./workflow-canvas-helpers";
import {
  canvasSnapshotsEqual,
  cloneCanvasSnapshot,
  type CanvasHistorySnapshot,
  type WorkflowsCanvasPageProps,
} from "./workflow-canvas-types";
import { resolveFirstConnectedModel } from "./workflow-model-picker";
import { tidyWorkflowLayout } from "./workflow-tidy-layout";

export interface UseWorkflowCanvasGraphActionsParams {
  props: WorkflowsCanvasPageProps;
  currentWf: WorkflowVisual | null;
  displayNos: WorkflowNo[];
  displayTracos: WorkflowTraco[];
  isReadOnly: boolean;
  setLocalNos: React.Dispatch<React.SetStateAction<WorkflowNo[]>>;
  setLocalArestas: React.Dispatch<React.SetStateAction<WorkflowAresta[]>>;
  setLocalTracos: React.Dispatch<React.SetStateAction<WorkflowTraco[]>>;
  selectedNodeId: string | null;
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedEdgeId: string | null;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string | null>>;
  connectingFrom: {
    nodeId: string;
    branch?: WorkflowBranch | null;
    portType?: WorkflowPortType;
  } | null;
  setConnectingFrom: React.Dispatch<
    React.SetStateAction<{
      nodeId: string;
      branch?: WorkflowBranch | null;
      portType?: WorkflowPortType;
    } | null>
  >;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  panOffset: { x: number; y: number };
  setPanOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  activeTool: "select" | "hand" | "draw";
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAddNodeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRunsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTriggerMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStatusFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  setUndoStack: React.Dispatch<React.SetStateAction<CanvasHistorySnapshot[]>>;
  setRedoStack: React.Dispatch<React.SetStateAction<CanvasHistorySnapshot[]>>;
  undoStackRef: React.MutableRefObject<CanvasHistorySnapshot[]>;
  redoStackRef: React.MutableRefObject<CanvasHistorySnapshot[]>;
  localNosRef: React.MutableRefObject<WorkflowNo[]>;
  localArestasRef: React.MutableRefObject<WorkflowAresta[]>;
  localTracosRef: React.MutableRefObject<WorkflowTraco[]>;
  patchCoalesceRef: React.MutableRefObject<{ nodeId: string; ts: number } | null>;
  preStrokeSnapshotRef: React.MutableRefObject<CanvasHistorySnapshot | null>;
  stageRef: React.MutableRefObject<HTMLDivElement | null>;
  draggingNodeRef: React.MutableRefObject<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    startSnapshot: CanvasHistorySnapshot;
  } | null>;
  panningRef: React.MutableRefObject<{
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  } | null>;
  drawingStrokeRef: React.MutableRefObject<WorkflowTraco | null>;
  pendingSavePayloadRef: React.MutableRefObject<{
    workflowId: string;
    nome: string;
    descricao: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos: WorkflowTraco[];
    ativo: boolean;
  } | null>;
  setMouseWorld: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  flushQueuedSave: () => Promise<void>;
  scheduleDebouncedSave: (
    nextNos: WorkflowNo[],
    nextArestas: WorkflowAresta[],
    nextTracos?: WorkflowTraco[],
    overrideName?: string
  ) => void;
}

export function useWorkflowCanvasGraphActions({
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
}: UseWorkflowCanvasGraphActionsParams) {
  const { onExecuteStep } = props;

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

  const pushUndoSnapshot = useCallback((snapshot?: CanvasHistorySnapshot) => {
    const snap = snapshot
      ? cloneCanvasSnapshot(snapshot.nos, snapshot.arestas, snapshot.tracos)
      : cloneCanvasSnapshot(
          localNosRef.current,
          localArestasRef.current,
          localTracosRef.current
        );
    const prevUndo = undoStackRef.current;
    const last = prevUndo[prevUndo.length - 1];
    if (last && canvasSnapshotsEqual(last, snap)) return;
    const nextUndo = [...prevUndo.slice(-49), snap];
    undoStackRef.current = nextUndo;
    redoStackRef.current = [];
    setUndoStack(nextUndo);
    setRedoStack([]);
  }, []);

  const handleAddNode = (tipo: TipoNoWorkflow, extra?: Partial<WorkflowNo>) => {
    if (isReadOnly) return;
    pushUndoSnapshot();
    patchCoalesceRef.current = null;
    const x =
      displayNos.length > 0
        ? Math.max(...displayNos.map((n) => n.x)) + 360
        : 220;
    const y = displayNos.length > 0 ? displayNos[0].y : 180;
    const autoViable =
      (tipo === "llm" || tipo === "condition") && !extra?.model
        ? resolveFirstConnectedModel(props.provedores ?? [])
        : null;
    const rawNode: WorkflowNo = {
      id: `no_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tipo,
      titulo: extra?.titulo ?? defaultTitleForNodeType(tipo),
      x,
      y,
      ...(autoViable
        ? {
            model: autoViable.model,
            provider: autoViable.provider,
          }
        : {}),
      config: {
        ...(autoViable
          ? { model: autoViable.model, provider: autoViable.provider }
          : {}),
        ...(extra?.config ?? {}),
      },
      ...extra,
    };
    const newNode = normalizeWorkflowNode(rawNode);
    const nextNos = [...localNosRef.current, newNode];
    localNosRef.current = nextNos;
    setLocalNos(nextNos);
    setSelectedNodeId(newNode.id);
    setAddNodeMenuOpen(false);
    setTriggerMenuOpen(false);
    scheduleDebouncedSave(nextNos, localArestasRef.current);
  };

  const handlePatchNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNo>) => {
      if (isReadOnly) return;
      const now = Date.now();
      const sameBurst =
        patchCoalesceRef.current !== null &&
        patchCoalesceRef.current.nodeId === nodeId &&
        now - patchCoalesceRef.current.ts < 800;
      if (!sameBurst) {
        pushUndoSnapshot();
      }
      patchCoalesceRef.current = { nodeId, ts: now };

      const next = localNosRef.current.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              ...patch,
              config: patch.config ? { ...n.config, ...patch.config } : n.config,
            }
          : n
      );
      localNosRef.current = next;
      setLocalNos(next);
      scheduleDebouncedSave(next, localArestasRef.current);
    },
    [isReadOnly, pushUndoSnapshot, scheduleDebouncedSave]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (isReadOnly) return;
      pushUndoSnapshot();
      patchCoalesceRef.current = null;
      const nextNos = localNosRef.current.filter((n) => n.id !== nodeId);
      const nextArestas = localArestasRef.current.filter(
        (a) => a.origem !== nodeId && a.destino !== nodeId
      );
      localNosRef.current = nextNos;
      localArestasRef.current = nextArestas;
      setLocalNos(nextNos);
      setLocalArestas(nextArestas);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      scheduleDebouncedSave(nextNos, nextArestas);
    },
    [isReadOnly, pushUndoSnapshot, selectedNodeId, scheduleDebouncedSave]
  );

  const handleDuplicateNode = useCallback(
    (node: WorkflowNo) => {
      if (isReadOnly) return;
      pushUndoSnapshot();
      patchCoalesceRef.current = null;
      const clone: WorkflowNo = {
        ...node,
        id: `no_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        x: node.x + 32,
        y: node.y + 32,
        config: { ...(node.config ?? {}) },
      };
      const nextNos = [...localNosRef.current, clone];
      localNosRef.current = nextNos;
      setLocalNos(nextNos);
      setSelectedNodeId(clone.id);
      scheduleDebouncedSave(nextNos, localArestasRef.current);
    },
    [isReadOnly, pushUndoSnapshot, scheduleDebouncedSave]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      if (isReadOnly) return;
      pushUndoSnapshot();
      patchCoalesceRef.current = null;
      const nextEdges = localArestasRef.current.filter((a) => a.id !== edgeId);
      localArestasRef.current = nextEdges;
      setLocalArestas(nextEdges);
      setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
      scheduleDebouncedSave(localNosRef.current, nextEdges);
    },
    [isReadOnly, pushUndoSnapshot, scheduleDebouncedSave]
  );

  const handleFinishConnect = useCallback(
    (targetNodeId: string) => {
      if (!connectingFrom || isReadOnly) return;
      const src = localNosRef.current.find((n) => n.id === connectingFrom.nodeId);
      const dst = localNosRef.current.find((n) => n.id === targetNodeId);
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

      const dup = localArestasRef.current.some(
        (a) =>
          a.origem === src.id &&
          a.destino === dst.id &&
          (a.branch ?? null) === (connectingFrom.branch ?? null)
      );
      if (!dup) {
        pushUndoSnapshot();
        patchCoalesceRef.current = null;
        const edge: WorkflowAresta = {
          id: `edge_${Date.now().toString(36)}`,
          origem: src.id,
          destino: dst.id,
          type: check.resolvedType,
          ...(connectingFrom.branch ? { branch: connectingFrom.branch } : {}),
        };
        const nextEdges = [...localArestasRef.current, edge];
        localArestasRef.current = nextEdges;
        setLocalArestas(nextEdges);
        scheduleDebouncedSave(localNosRef.current, nextEdges);
      }
      setConnectingFrom(null);
    },
    [connectingFrom, isReadOnly, pushUndoSnapshot, scheduleDebouncedSave]
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
      preStrokeSnapshotRef.current = cloneCanvasSnapshot(
        localNosRef.current,
        localArestasRef.current,
        localTracosRef.current
      );
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
      const next = localNosRef.current.map((n) =>
        n.id === nodeId ? { ...n, x: Math.round(origX + dx), y: Math.round(origY + dy) } : n
      );
      localNosRef.current = next;
      setLocalNos(next);
      return;
    }

    if (drawingStrokeRef.current && rect && !isReadOnly) {
      const wx = (e.clientX - rect.left - panOffset.x) / zoom;
      const wy = (e.clientY - rect.top - panOffset.y) / zoom;
      drawingStrokeRef.current.points.push([wx, wy]);
      const liveStroke = { ...drawingStrokeRef.current };
      const nextTracos = [
        ...localTracosRef.current.filter((t) => t.id !== liveStroke.id),
        liveStroke,
      ];
      localTracosRef.current = nextTracos;
      setLocalTracos(nextTracos);
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
      const { nodeId, origX, origY, startSnapshot } = draggingNodeRef.current;
      draggingNodeRef.current = null;
      const movedNode = localNosRef.current.find((n) => n.id === nodeId);
      if (movedNode && (movedNode.x !== origX || movedNode.y !== origY)) {
        pushUndoSnapshot(startSnapshot);
        patchCoalesceRef.current = null;
        scheduleDebouncedSave(localNosRef.current, localArestasRef.current);
      }
    }
    if (drawingStrokeRef.current) {
      drawingStrokeRef.current = null;
      if (preStrokeSnapshotRef.current) {
        pushUndoSnapshot(preStrokeSnapshotRef.current);
        preStrokeSnapshotRef.current = null;
      }
      scheduleDebouncedSave(
        localNosRef.current,
        localArestasRef.current,
        localTracosRef.current
      );
    }
    panningRef.current = null;
  };

  const handleUndo = useCallback(() => {
    if (isReadOnly) return;
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prevSnap = stack[stack.length - 1];
    const currentSnap = cloneCanvasSnapshot(
      localNosRef.current,
      localArestasRef.current,
      localTracosRef.current
    );
    patchCoalesceRef.current = null;
    const nextUndo = stack.slice(0, -1);
    const nextRedo = [...redoStackRef.current.slice(-49), currentSnap];
    undoStackRef.current = nextUndo;
    redoStackRef.current = nextRedo;
    localNosRef.current = prevSnap.nos;
    localArestasRef.current = prevSnap.arestas;
    localTracosRef.current = prevSnap.tracos;
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    setLocalNos(prevSnap.nos);
    setLocalArestas(prevSnap.arestas);
    setLocalTracos(prevSnap.tracos);
    setSelectedEdgeId(null);
    scheduleDebouncedSave(prevSnap.nos, prevSnap.arestas, prevSnap.tracos);
  }, [isReadOnly, scheduleDebouncedSave]);

  const handleRedo = useCallback(() => {
    if (isReadOnly) return;
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const nextSnap = stack[stack.length - 1];
    const currentSnap = cloneCanvasSnapshot(
      localNosRef.current,
      localArestasRef.current,
      localTracosRef.current
    );
    patchCoalesceRef.current = null;
    const nextRedo = stack.slice(0, -1);
    const nextUndo = [...undoStackRef.current.slice(-49), currentSnap];
    redoStackRef.current = nextRedo;
    undoStackRef.current = nextUndo;
    localNosRef.current = nextSnap.nos;
    localArestasRef.current = nextSnap.arestas;
    localTracosRef.current = nextSnap.tracos;
    setRedoStack(nextRedo);
    setUndoStack(nextUndo);
    setLocalNos(nextSnap.nos);
    setLocalArestas(nextSnap.arestas);
    setLocalTracos(nextSnap.tracos);
    setSelectedEdgeId(null);
    scheduleDebouncedSave(nextSnap.nos, nextSnap.arestas, nextSnap.tracos);
  }, [isReadOnly, scheduleDebouncedSave]);

  const handleAutoLayout = useCallback(() => {
    if (isReadOnly || localNosRef.current.length === 0) return;
    pushUndoSnapshot();
    patchCoalesceRef.current = null;
    const arranged = tidyWorkflowLayout(
      localNosRef.current,
      localArestasRef.current
    );
    localNosRef.current = arranged;
    setLocalNos(arranged);
    scheduleDebouncedSave(arranged, localArestasRef.current);
    setStatusFeedback("Nós organizados (Tidy up).");
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => fitView());
    }
  }, [fitView, isReadOnly, pushUndoSnapshot, scheduleDebouncedSave]);

  const handleSaveNow = useCallback(async () => {
    if (isReadOnly || !currentWf) return;
    pendingSavePayloadRef.current = {
      workflowId: currentWf.workflow_id,
      nome: currentWf.nome,
      descricao: currentWf.descricao ?? "",
      nos: localNosRef.current,
      arestas: localArestasRef.current,
      tracos: localTracosRef.current,
      ativo: currentWf.ativo,
    };
    await flushQueuedSave();
    setStatusFeedback("Fluxo salvo no banco local.");
  }, [currentWf, flushQueuedSave, isReadOnly]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "Escape") {
        setConnectingFrom(null);
        setAddNodeMenuOpen(false);
        setRunsMenuOpen(false);
        setTriggerMenuOpen(false);
        setSelectedEdgeId(null);
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const activeEl =
        typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
      const isEditableElement = (el: HTMLElement | null) =>
        Boolean(
          el &&
            (el.tagName === "INPUT" ||
              el.tagName === "TEXTAREA" ||
              el.tagName === "SELECT" ||
              el.isContentEditable)
        );
      if (isEditableElement(targetEl) || isEditableElement(activeEl)) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const lower = e.key.toLowerCase();

      if (mod && lower === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (mod && ((lower === "z" && e.shiftKey) || lower === "y")) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && lower === "d") {
        if (selectedNodeId) {
          const targetNode = localNosRef.current.find((n) => n.id === selectedNodeId);
          if (targetNode) {
            e.preventDefault();
            handleDuplicateNode(targetNode);
          }
        }
        return;
      }
      if (mod && lower === "s") {
        e.preventDefault();
        void handleSaveNow();
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        fitView();
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))));
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.25, Number((z - 0.1).toFixed(2))));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdgeId) {
          e.preventDefault();
          handleDeleteEdge(selectedEdgeId);
        } else if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    fitView,
    handleDeleteEdge,
    handleDeleteNode,
    handleDuplicateNode,
    handleRedo,
    handleSaveNow,
    handleUndo,
    selectedEdgeId,
    selectedNodeId,
  ]);

  return {
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
  };
}
