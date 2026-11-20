import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  AvatarShape,
  RoutineFlowCanvas,
  RoutineFlowConnectProblem,
  RoutineFlowLink,
  RoutineFlowStep,
} from "@criativo/contracts";
import {
  Clock3,
  Link2,
  Minus,
  Play,
  Plus,
  Square,
  Trash2,
  UserPlus,
  Webhook,
  X,
} from "lucide-react";
import { getDefaultMascotForAgent, MascoteAvatar } from "../../components/MascoteAvatar";
import { daemonApi } from "../../services/websocket-client";

interface RoutineFlowsCanvasProps {
  agente: AgenteRegistro | null;
  allAgentes: AgenteRegistro[];
  initialCanvas?: RoutineFlowCanvas | null;
  refreshSignal?: number;
  onOpenRoutineSettings: (rotinaId?: string | null) => void;
  onOpenAgentChat: (agenteId: string) => void;
}

const FOCUS_COLORS = ["#007CF7", "#31CF76", "#FF9412", "#A855F7", "#EC4899"];

export function computeConnectProblem(
  ownerId: string,
  fromAgentId: string,
  toAgentId: string,
  routineLinks: readonly RoutineFlowLink[]
): RoutineFlowConnectProblem | null {
  if (fromAgentId === toAgentId) return "same-agent";
  if (toAgentId === ownerId) return "into-owner";

  // Calcula alcançáveis a partir de ownerId
  const adj = new Map<string, string[]>();
  for (const link of routineLinks) {
    const arr = adj.get(link.from_agent_id) ?? [];
    arr.push(link.to_agent_id);
    adj.set(link.from_agent_id, arr);
  }

  const reachable = new Set<string>([ownerId]);
  const q = [ownerId];
  while (q.length > 0) {
    const curr = q.shift()!;
    for (const nxt of adj.get(curr) ?? []) {
      if (!reachable.has(nxt)) {
        reachable.add(nxt);
        q.push(nxt);
      }
    }
  }
  if (!reachable.has(fromAgentId)) return "not-on-path";

  if (
    routineLinks.some((l) => l.from_agent_id === fromAgentId && l.to_agent_id === toAgentId)
  ) {
    return "duplicate";
  }

  // Verifica ciclo: se a partir de toAgentId for possível alcançar fromAgentId
  const revQ = [toAgentId];
  const visited = new Set<string>([toAgentId]);
  while (revQ.length > 0) {
    const curr = revQ.shift()!;
    if (curr === fromAgentId) return "cycle";
    for (const nxt of adj.get(curr) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt);
        revQ.push(nxt);
      }
    }
  }

  return null;
}

function getAgentAvatar(ag: AgenteRegistro | undefined, id: string): {
  shape: AvatarShape;
  color: string;
} {
  const cfg = (ag?.config ?? {}) as Record<string, unknown>;
  const fb = getDefaultMascotForAgent(id);
  return {
    shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape,
    color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color,
  };
}

function stepBadgeMeta(status: RoutineFlowStep["status"] | "waiting" | "unreachable"): {
  label: string;
  classes: string;
} {
  switch (status) {
    case "running":
      return { label: "Executando", classes: "bg-[#007CF7]/15 text-[#42A0FF]" };
    case "succeeded":
      return { label: "Concluído", classes: "bg-[#31CF76]/15 text-[#31CF76]" };
    case "failed":
      return { label: "Falha", classes: "bg-[#FD2F3B]/15 text-[#FD2F3B]" };
    case "skipped":
    case "cancelled":
      return { label: "Ignorado", classes: "bg-[#FF9412]/15 text-[#FF9412]" };
    case "unreachable":
      return { label: "Inalcançável", classes: "bg-white/[0.06] text-[#979797]" };
    default:
      return { label: "Aguardando", classes: "bg-white/[0.06] text-[#DCDCDC]" };
  }
}

export const RoutineFlowsCanvas: React.FC<RoutineFlowsCanvasProps> = ({
  agente,
  allAgentes,
  initialCanvas = null,
  refreshSignal = 0,
  onOpenRoutineSettings,
  onOpenAgentChat,
}) => {
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

  if (!agente) {
    return (
      <div className="flex-1 h-full flex items-center justify-center bg-[#1A1A1A] text-[#979797] text-[14px]">
        Selecione um agente na barra lateral para visualizar os fluxos de rotinas.
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-[#1A1A1A] text-[#F0F0F0] overflow-hidden">
      {/* Cabeçalho do Canvas (48px) */}
      <header className="h-[48px] shrink-0 px-4 border-b border-white/[0.06] bg-[#1A1A1A] flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MascoteAvatar shape={ownerAvatar.shape} color={ownerAvatar.color} size={24} />
          <h1 className="text-[20px] font-semibold text-[#F0F0F0] truncate">{agente.nome}</h1>

          {/* Seletor customizado de lente de foco (zero elemento select HTML) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFocusMenuOpen((o) => !o)}
              className="rounded-lg bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.08] px-3 py-1 text-[12px] font-semibold text-[#DCDCDC]"
            >
              {focusRoutineId === "all"
                ? "Todas as rotinas"
                : routines.find((r) => r.rotina.rotina_id === focusRoutineId)?.rotina.nome ??
                  "Rotina em foco"}
            </button>
            {focusMenuOpen && (
              <div
                role="listbox"
                aria-label="Lente de foco por rotina"
                className="absolute left-0 mt-1 z-40 w-60 rounded-xl bg-[#212121] border border-white/10 p-1 shadow-2xl"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={focusRoutineId === "all"}
                  onClick={() => {
                    setFocusRoutineId("all");
                    setFocusMenuOpen(false);
                  }}
                  className="w-full text-left rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  Todas as rotinas
                </button>
                {routines.map((entry, idx) => (
                  <button
                    key={entry.rotina.rotina_id}
                    type="button"
                    role="option"
                    aria-selected={focusRoutineId === entry.rotina.rotina_id}
                    onClick={() => {
                      setFocusRoutineId(entry.rotina.rotina_id);
                      setFocusMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: FOCUS_COLORS[idx % FOCUS_COLORS.length] }}
                    />
                    <span className="truncate">{entry.rotina.nome}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddAgentOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.08] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
            >
              <UserPlus className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>Adicionar agente ao fluxo</span>
            </button>
            {addAgentOpen && (
              <div className="absolute right-0 mt-1 z-40 w-64 rounded-xl bg-[#212121] border border-white/10 p-1 shadow-2xl max-h-64 overflow-y-auto">
                {availableExtraAgents.length === 0 ? (
                  <p className="px-3 py-2 text-[12px] text-[#979797]">
                    Todos os agentes já estão no canvas.
                  </p>
                ) : (
                  availableExtraAgents.map((candidate) => (
                    <button
                      key={candidate.agente_id}
                      type="button"
                      onClick={async () => {
                        setAddAgentOpen(false);
                        await daemonApi.saveRoutineFlowPosition(
                          ownerId,
                          `agent:${candidate.agente_id}`,
                          650,
                          120 + agentNodeIds.length * 140
                        );
                        await loadCanvas(ownerId);
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-2 text-[12px] text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      {candidate.nome}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {isFlowRunning && activeRun ? (
            <button
              type="button"
              disabled={runningAction}
              onClick={async () => {
                setRunningAction(true);
                try {
                  await daemonApi.stopRoutineFlowRun(activeRun.execucao_id);
                  await loadCanvas(ownerId);
                } finally {
                  setRunningAction(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FD2F3B] hover:opacity-90 px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              <Square className="h-3.5 w-3.5" />
              <span>Parar execução</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={runningAction || !targetRoutineForRun}
              onClick={async () => {
                if (!targetRoutineForRun) return;
                setRunningAction(true);
                try {
                  await daemonApi.testRoutine(targetRoutineForRun.rotina.rotina_id);
                  await loadCanvas(ownerId);
                } finally {
                  setRunningAction(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F0F0F0] hover:bg-white px-3 py-1.5 text-[12px] font-semibold text-[#141414] disabled:opacity-45"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Executar rotina agora</span>
            </button>
          )}
        </div>
      </header>

      {errorMsg && (
        <div className="px-4 py-2 bg-[#FD2F3B]/15 border-b border-[#FD2F3B]/40 text-[12px] text-[#FD2F3B] flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} aria-label="Fechar erro">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Área central + Inspetor lateral do canvas */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div
          className="relative flex-1 overflow-hidden studio-dot-grid"
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              dragStateRef.current = {
                kind: "pan",
                startX: e.clientX,
                startY: e.clientY,
                origX: pan.x,
                origY: pan.y,
              };
            }
          }}
        >
          {/* Controles de Zoom */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-xl bg-[#212121] border border-white/[0.08] p-1">
            <button
              type="button"
              aria-label="Reduzir zoom"
              onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.1).toFixed(2))))}
              className="h-7 w-7 rounded-lg hover:bg-[#2A2A2A] flex items-center justify-center text-[#DCDCDC]"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="px-2 text-[12px] font-semibold text-[#DCDCDC] tabular-nums"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="Aumentar zoom"
              onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
              className="h-7 w-7 rounded-lg hover:bg-[#2A2A2A] flex items-center justify-center text-[#DCDCDC]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-[14px] text-[#979797]">Carregando fluxo de rotinas...</div>
          ) : (
            <div
              className="absolute inset-0 origin-top-left"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {/* Camada SVG das Arestas Bézier */}
              <svg className="absolute inset-0 w-[2400px] h-[1600px] pointer-events-none">
                {/* Ligações fixas rotina -> dono */}
                {routines.map((entry, idx) => {
                  const fromPos = computedPositions.get(`routine:${entry.rotina.rotina_id}`);
                  const toPos = computedPositions.get(`agent:${ownerId}`);
                  if (!fromPos || !toPos) return null;
                  const x1 = fromPos.x + 256;
                  const y1 = fromPos.y + 52;
                  const x2 = toPos.x;
                  const y2 = toPos.y + 62;
                  const cx = (x1 + x2) / 2;
                  return (
                    <path
                      key={`owner-edge-${entry.rotina.rotina_id}`}
                      d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={FOCUS_COLORS[idx % FOCUS_COLORS.length]}
                      strokeWidth={2}
                      strokeOpacity={0.65}
                    />
                  );
                })}

                {/* Ligações agente -> agente */}
                {visibleLinks.map((link) => {
                  const fromPos = computedPositions.get(`agent:${link.from_agent_id}`);
                  const toPos = computedPositions.get(`agent:${link.to_agent_id}`);
                  if (!fromPos || !toPos) return null;
                  const x1 = fromPos.x + 256;
                  const y1 = fromPos.y + 62;
                  const x2 = toPos.x;
                  const y2 = toPos.y + 62;
                  const cx = (x1 + x2) / 2;
                  const isSel = selectedItem?.kind === "link" && selectedItem.id === link.link_id;
                  return (
                    <path
                      key={link.link_id}
                      d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={isSel ? "#007CF7" : "#31CF76"}
                      strokeWidth={isSel ? 3 : 2}
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => setSelectedItem({ kind: "link", id: link.link_id })}
                    />
                  );
                })}
              </svg>

              {/* Nós Rotina (routine:<id>) */}
              {routines.map((entry) => {
                const nodeKey = `routine:${entry.rotina.rotina_id}`;
                const pos = computedPositions.get(nodeKey) ?? { x: 40, y: 48 };
                const isSelected =
                  selectedItem?.kind === "routine" && selectedItem.id === entry.rotina.rotina_id;
                return (
                  <div
                    key={nodeKey}
                    data-node-key={nodeKey}
                    data-selected={isSelected ? "true" : "false"}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedItem({ kind: "routine", id: entry.rotina.rotina_id });
                      dragStateRef.current = {
                        kind: "node",
                        nodeKey,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: pos.x,
                        origY: pos.y,
                      };
                    }}
                    style={{ left: pos.x, top: pos.y }}
                    className={`absolute w-[256px] rounded-xl bg-[#212121] p-4 border cursor-grab select-none shadow-lg ${
                      isSelected ? "border-[#007CF7]" : "border-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[12px] text-[#979797]">
                      <span className="inline-flex items-center gap-1.5">
                        {entry.rotina.trigger_kind === "webhook" ? (
                          <Webhook className="h-3.5 w-3.5 text-[#42A0FF]" />
                        ) : (
                          <Clock3 className="h-3.5 w-3.5" />
                        )}
                        {entry.rotina.ativa ? "Ativa" : "Pausada"}
                      </span>
                      <div className="flex items-center gap-1">
                        {entry.recent_runs.slice(0, 4).map((run) => (
                          <span
                            key={run.execucao_id}
                            className={`h-2 w-2 rounded-full ${
                              run.status === "succeeded"
                                ? "bg-[#31CF76]"
                                : run.status === "failed"
                                  ? "bg-[#FD2F3B]"
                                  : run.status === "running"
                                    ? "bg-[#007CF7]"
                                    : "bg-[#FF9412]"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-[14px] font-semibold text-[#F0F0F0] truncate">
                      {entry.rotina.nome}
                    </p>
                    <span
                      aria-hidden="true"
                      className="absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-[#007CF7] border-2 border-[#1A1A1A]"
                    />
                  </div>
                );
              })}

              {/* Nós Agente (agent:<id>) */}
              {agentNodeIds.map((agId) => {
                const nodeKey = `agent:${agId}`;
                const pos = computedPositions.get(nodeKey) ?? { x: 350, y: 60 };
                const agObj = allAgentes.find((a) => a.agente_id === agId);
                const vis = getAgentAvatar(agObj, agId);
                const isSelected = selectedItem?.kind === "agent" && selectedItem.id === agId;
                const step = activeRun?.steps.find((s) => s.agente_id === agId);
                const stepProblem =
                  connectingFromAgentId && targetRoutineForRun
                    ? computeConnectProblem(
                        ownerId,
                        connectingFromAgentId,
                        agId,
                        focusLinksForConnect
                      )
                    : null;
                const canAcceptTarget = Boolean(connectingFromAgentId && stepProblem === null);
                const badge = stepBadgeMeta(step ? step.status : "waiting");

                return (
                  <div
                    key={nodeKey}
                    data-node-key={nodeKey}
                    data-selected={isSelected ? "true" : "false"}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedItem({ kind: "agent", id: agId });
                      dragStateRef.current = {
                        kind: "node",
                        nodeKey,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: pos.x,
                        origY: pos.y,
                      };
                    }}
                    style={{ left: pos.x, top: pos.y }}
                    className={`absolute w-[256px] rounded-xl bg-[#212121] p-4 border cursor-grab select-none shadow-lg space-y-2 ${
                      isSelected ? "border-[#007CF7]" : "border-white/[0.06]"
                    }`}
                  >
                    {/* Porta de Entrada esquerda */}
                    <button
                      type="button"
                      aria-label={`Conectar em ${agObj?.nome ?? agId}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleConnectAgent(agId);
                      }}
                      className={`absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-[#1A1A1A] transition-colors ${
                        connectingFromAgentId
                          ? canAcceptTarget
                            ? "bg-[#31CF76]"
                            : "bg-[#FD2F3B]"
                          : "bg-[#979797]"
                      }`}
                    />

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <MascoteAvatar shape={vis.shape} color={vis.color} size={24} />
                        <span className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                          {agObj?.nome ?? agId}
                        </span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[12px] ${badge.classes}`}>
                        {badge.label}
                      </span>
                    </div>

                    <p className="text-[12px] font-normal text-[#979797] truncate">
                      {agObj?.modelo_padrao ?? "Agente especialista"}
                    </p>

                    {step?.output && (
                      <p className="text-[12px] font-normal text-[#DCDCDC] line-clamp-2">
                        {step.output}
                      </p>
                    )}

                    {/* Porta de Saída direita */}
                    <button
                      type="button"
                      aria-label={`Iniciar conexão a partir de ${agObj?.nome ?? agId}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnectingFromAgentId((prev) => (prev === agId ? null : agId));
                      }}
                      className={`absolute -right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-[#1A1A1A] ${
                        connectingFromAgentId === agId ? "bg-[#007CF7]" : "bg-[#DCDCDC]"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Inspetor Lateral do Canvas */}
        {selectedItem && (
          <aside className="w-[300px] shrink-0 bg-[#1A1A1A] border-l border-white/[0.06] p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[#F0F0F0]">
                {selectedItem.kind === "link"
                  ? "Conexão do Fluxo"
                  : selectedItem.kind === "routine"
                    ? "Detalhes da Rotina"
                    : "Agente no Fluxo"}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                aria-label="Fechar detalhes"
                className="text-[#979797] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedItem.kind === "link" && selectedLink && (
              <div className="space-y-3">
                <p className="text-[12px] text-[#979797]">
                  <Link2 className="inline h-3.5 w-3.5 mr-1 text-[#31CF76]" />
                  {selectedLink.from_agent_id} → {selectedLink.to_agent_id}
                </p>
                <textarea
                  rows={4}
                  value={edgeInstructionDraft}
                  onChange={(e) => setEdgeInstructionDraft(e.target.value)}
                  placeholder="Instrução específica para este passo..."
                  className="w-full rounded-xl bg-[#212121] border border-white/10 focus:border-[#007CF7] p-2.5 text-[12px] text-[#F0F0F0] focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingInstruction}
                    onClick={async () => {
                      setSavingInstruction(true);
                      try {
                        await daemonApi.updateRoutineFlowLink(
                          selectedLink.link_id,
                          edgeInstructionDraft
                        );
                        await loadCanvas(ownerId);
                      } finally {
                        setSavingInstruction(false);
                      }
                    }}
                    className="rounded-xl bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
                  >
                    Salvar instrução
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await daemonApi.deleteRoutineFlowLink(selectedLink.link_id, ownerId);
                      setSelectedItem(null);
                      await loadCanvas(ownerId);
                    }}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#FD2F3B]/15 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remover conexão</span>
                  </button>
                </div>
              </div>
            )}

            {selectedItem.kind === "routine" && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => onOpenRoutineSettings(selectedItem.id)}
                  className="w-full rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.08] py-2 text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Configurar rotina
                </button>
              </div>
            )}

            {selectedItem.kind === "agent" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onOpenAgentChat(selectedItem.id)}
                  className="w-full rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.08] py-2 text-[14px] font-semibold text-[#42A0FF]"
                >
                  Abrir chat
                </button>
                {selectedItem.id !== ownerId && (
                  <button
                    type="button"
                    onClick={async () => {
                      await daemonApi.deleteRoutineFlowPosition(
                        ownerId,
                        `agent:${selectedItem.id}`
                      );
                      setSelectedItem(null);
                      await loadCanvas(ownerId);
                    }}
                    className="w-full rounded-xl bg-[#FD2F3B]/15 py-2 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    Remover agente do fluxo
                  </button>
                )}
              </div>
            )}

            {activeRun && (
              <div className="pt-3 border-t border-white/[0.06] space-y-2">
                <h3 className="text-[12px] font-semibold text-[#979797]">
                  Linha do tempo da execução
                </h3>
                {activeRun.steps.map((st) => {
                  const stBadge = stepBadgeMeta(st.status);
                  return (
                    <div
                      key={st.step_id}
                      className="rounded-xl bg-[#212121] border border-white/[0.06] p-2.5 space-y-1 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-[#F0F0F0]">{st.agente_id}</span>
                        <span className={`rounded-full px-2 py-0.5 ${stBadge.classes}`}>
                          {stBadge.label}
                        </span>
                      </div>
                      {st.output && <p className="text-[#DCDCDC] line-clamp-3">{st.output}</p>}
                      {st.erro && <p className="text-[#FD2F3B]">{st.erro}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};
