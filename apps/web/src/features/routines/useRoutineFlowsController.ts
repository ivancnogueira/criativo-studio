import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  RoutineFlowCanvas,
} from "@criativo/contracts";
import {
  daemonApi,
} from "../../services/websocket-client";
import { computeConnectProblem, getAgentAvatar, type RoutineFlowsCanvasProps } from "./routine-flows-helpers";

export function useRoutineFlowsController(props: RoutineFlowsCanvasProps) {
  const {
  agente,
  allAgentes,
  initialCanvas = null,
  refreshSignal = 0,
  onOpenRoutineSettings,
  onOpenAgentChat,
} = props;
  const [canvas, setCanvas] = useState<RoutineFlowCanvas | null>(initialCanvas);
  const [loading, setLoading] = useState<boolean>(initialCanvas === null && Boolean(agente));
  const [focusRoutineId, setFocusRoutineId] = useState<string>("all");
  const [focusMenuOpen, setFocusMenuOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedItem, setSelectedItem] = useState<
    | { kind: "routine"; id: string }
    | { kind: "agent"; id: string }
    | { kind: "link"; id: string }
    | null
  >(null);
  const [connectingFromAgentId, setConnectingFromAgentId] = useState<string | null>(null);
  const [edgeInstructionDraft, setEdgeInstructionDraft] = useState("");
  const [savingInstruction, setSavingInstruction] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>(
    {}
  );

  const posDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dragStateRef = useRef<{
    kind: "node" | "pan";
    nodeKey?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const loadCanvas = useCallback(async (agenteId: string) => {
    setErrorMsg(null);
    try {
      const data = await daemonApi.getRoutineFlowCanvas(agenteId);
      setCanvas(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao carregar canvas de fluxos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!agente) return;
    if (initialCanvas && initialCanvas.agente_id === agente.agente_id && refreshSignal === 0) {
      return;
    }
    const timer = setTimeout(() => {
      void loadCanvas(agente.agente_id);
    }, refreshSignal === 0 ? 0 : 250);
    return () => clearTimeout(timer);
  }, [agente, initialCanvas, refreshSignal, loadCanvas]);

  useEffect(() => {
    if (!canvas) return;
    const next: Record<string, { x: number; y: number }> = {};
    for (const p of canvas.positions) {
      next[p.node_key] = { x: p.x, y: p.y };
    }
    setLocalPositions(next);
  }, [canvas]);

  const ownerId = agente?.agente_id ?? canvas?.agente_id ?? "estrategista";

  const routines = canvas?.rotinas ?? [];
  const activeFocusRoutine = useMemo(() => {
    if (focusRoutineId !== "all") {
      return routines.find((r) => r.rotina.rotina_id === focusRoutineId) ?? routines[0] ?? null;
    }
    return routines[0] ?? null;
  }, [routines, focusRoutineId]);

  const targetRoutineForRun = activeFocusRoutine;
  const activeRun = targetRoutineForRun?.active_flow_run ?? null;
  const isFlowRunning = activeRun?.status === "running";

  const visibleLinks = useMemo(() => {
    const allLinks = canvas?.links ?? [];
    if (focusRoutineId === "all") return allLinks;
    return allLinks.filter((l) => l.rotina_id === focusRoutineId);
  }, [canvas?.links, focusRoutineId]);

  const agentNodeIds = useMemo(() => {
    const set = new Set<string>([ownerId]);
    for (const id of canvas?.placed_agent_ids ?? []) set.add(id);
    for (const link of visibleLinks) {
      set.add(link.from_agent_id);
      set.add(link.to_agent_id);
    }
    return Array.from(set);
  }, [ownerId, canvas?.placed_agent_ids, visibleLinks]);

  const computedPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    routines.forEach((entry, idx) => {
      const key = `routine:${entry.rotina.rotina_id}`;
      map.set(key, localPositions[key] ?? { x: 40, y: 48 + idx * 145 });
    });

    // Calcula posição padrão por profundidade topológica a partir do owner
    const depth = new Map<string, number>([[ownerId, 0]]);
    for (let pass = 0; pass < agentNodeIds.length; pass += 1) {
      for (const link of visibleLinks) {
        const dFrom = depth.get(link.from_agent_id);
        if (dFrom !== undefined) {
          const prev = depth.get(link.to_agent_id);
          if (prev === undefined || prev < dFrom + 1) {
            depth.set(link.to_agent_id, dFrom + 1);
          }
        }
      }
    }

    const rowByCol = new Map<number, number>();
    agentNodeIds.forEach((agId) => {
      const key = `agent:${agId}`;
      if (localPositions[key]) {
        map.set(key, localPositions[key]);
        return;
      }
      const col = depth.get(agId) ?? 1;
      const row = rowByCol.get(col) ?? 0;
      rowByCol.set(col, row + 1);
      map.set(key, { x: 350 + col * 300, y: 60 + row * 170 });
    });
    return map;
  }, [routines, agentNodeIds, visibleLinks, localPositions, ownerId]);

  const scheduleSavePosition = (nodeKey: string, x: number, y: number) => {
    if (posDebounceRef.current[nodeKey]) {
      clearTimeout(posDebounceRef.current[nodeKey]);
    }
    posDebounceRef.current[nodeKey] = setTimeout(() => {
      void daemonApi.saveRoutineFlowPosition(ownerId, nodeKey, Math.round(x), Math.round(y));
    }, 400);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    const dx = (e.clientX - ds.startX) / zoom;
    const dy = (e.clientY - ds.startY) / zoom;
    if (ds.kind === "pan") {
      setPan({ x: ds.origX + (e.clientX - ds.startX), y: ds.origY + (e.clientY - ds.startY) });
      return;
    }
    if (ds.kind === "node" && ds.nodeKey) {
      const nx = Math.max(10, ds.origX + dx);
      const ny = Math.max(10, ds.origY + dy);
      setLocalPositions((prev) => ({ ...prev, [ds.nodeKey!]: { x: nx, y: ny } }));
    }
  };

  const handleCanvasPointerUp = () => {
    const ds = dragStateRef.current;
    if (ds && ds.kind === "node" && ds.nodeKey) {
      const pos = localPositions[ds.nodeKey];
      if (pos) {
        scheduleSavePosition(ds.nodeKey, pos.x, pos.y);
      }
    }
    dragStateRef.current = null;
  };

  const focusLinksForConnect = useMemo(() => {
    if (!targetRoutineForRun) return [];
    const targetId = targetRoutineForRun.rotina.rotina_id;
    return (canvas?.links ?? []).filter((l) => l.rotina_id === targetId);
  }, [canvas?.links, targetRoutineForRun]);

  const handleConnectAgent = async (toAgentId: string) => {
    if (!connectingFromAgentId || !targetRoutineForRun) return;
    const problem = computeConnectProblem(
      ownerId,
      connectingFromAgentId,
      toAgentId,
      focusLinksForConnect
    );
    if (problem) {
      setConnectingFromAgentId(null);
      return;
    }
    try {
      await daemonApi.createRoutineFlowLink({
        rotina_id: targetRoutineForRun.rotina.rotina_id,
        owner_id: ownerId,
        from_agent_id: connectingFromAgentId,
        to_agent_id: toAgentId,
        instrucao: "",
      });
      setConnectingFromAgentId(null);
      await loadCanvas(ownerId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao conectar agentes.");
      setConnectingFromAgentId(null);
    }
  };

  const selectedLink =
    selectedItem?.kind === "link"
      ? (canvas?.links ?? []).find((l) => l.link_id === selectedItem.id) ?? null
      : null;

  useEffect(() => {
    if (selectedLink) {
      setEdgeInstructionDraft(selectedLink.instrucao);
    } else if (selectedItem?.kind === "routine") {
      const r = routines.find((x) => x.rotina.rotina_id === selectedItem.id);
      setEdgeInstructionDraft(r?.rotina.instrucao ?? "");
    }
  }, [selectedLink, selectedItem, routines]);

  const ownerAvatar = getAgentAvatar(agente ?? undefined, ownerId);
  const availableExtraAgents = allAgentes.filter((a) => !agentNodeIds.includes(a.agente_id));



  return {
    agente,
    allAgentes,
    initialCanvas,
    refreshSignal,
    onOpenRoutineSettings,
    onOpenAgentChat,
    canvas,
    setCanvas,
    loading,
    setLoading,
    focusRoutineId,
    setFocusRoutineId,
    focusMenuOpen,
    setFocusMenuOpen,
    addAgentOpen,
    setAddAgentOpen,
    zoom,
    setZoom,
    pan,
    setPan,
    selectedItem,
    setSelectedItem,
    connectingFromAgentId,
    setConnectingFromAgentId,
    edgeInstructionDraft,
    setEdgeInstructionDraft,
    savingInstruction,
    setSavingInstruction,
    runningAction,
    setRunningAction,
    errorMsg,
    setErrorMsg,
    localPositions,
    setLocalPositions,
    posDebounceRef,
    dragStateRef,
    loadCanvas,
    ownerId,
    routines,
    activeFocusRoutine,
    targetRoutineForRun,
    activeRun,
    isFlowRunning,
    visibleLinks,
    agentNodeIds,
    computedPositions,
    scheduleSavePosition,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    focusLinksForConnect,
    handleConnectAgent,
    selectedLink,
    ownerAvatar,
    availableExtraAgents,
  };
}

export type RoutineFlowsController = ReturnType<typeof useRoutineFlowsController>;
