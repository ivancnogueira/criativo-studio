import {
  Clock3,
  Minus,
  Play,
  Plus,
  Square,
  UserPlus,
  Webhook,
  X,
} from "lucide-react";
import {
  MascoteAvatar,
} from "../../components/MascoteAvatar";
import {
  daemonApi,
} from "../../services/websocket-client";
import { computeConnectProblem, FOCUS_COLORS, getAgentAvatar, stepBadgeMeta } from "./routine-flows-helpers";
import type { RoutineFlowsController } from "./useRoutineFlowsController";

export function RoutineFlowsStageView({
  ctrl,
  children,
}: {
  ctrl: RoutineFlowsController;
  children?: React.ReactNode;
}) {
  const { agente, allAgentes, canvas, loading, focusRoutineId, setFocusRoutineId, focusMenuOpen, setFocusMenuOpen, addAgentOpen, setAddAgentOpen, zoom, setZoom, pan, setPan, selectedItem, setSelectedItem, connectingFromAgentId, setConnectingFromAgentId, runningAction, setRunningAction, errorMsg, setErrorMsg, dragStateRef, loadCanvas, ownerId, routines, targetRoutineForRun, activeRun, isFlowRunning, visibleLinks, agentNodeIds, computedPositions, handleCanvasPointerMove, handleCanvasPointerUp, focusLinksForConnect, handleConnectAgent, ownerAvatar, availableExtraAgents } = ctrl;
  if (!agente) return null;
  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-[#1A1A1A] text-[#F0F0F0] overflow-hidden">
      {/* Cabeçalho do Canvas (48px) */}
      <header className="h-[48px] shrink-0 px-4 border-b border-white/[0.06] bg-[#1A1A1A] flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MascoteAvatar avatar={ownerAvatar} agentKey={agente.agente_id} size={24} />
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
              <span>Adicionar Criativo ao fluxo</span>
            </button>
            {addAgentOpen && (
              <div className="absolute right-0 mt-1 z-40 w-64 rounded-xl bg-[#212121] border border-white/10 p-1 shadow-2xl max-h-64 overflow-y-auto">
                {availableExtraAgents.length === 0 ? (
                  <p className="px-3 py-2 text-[12px] text-[#979797]">
                    Todos os Criativos já estão no canvas.
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
                        <MascoteAvatar avatar={vis} agentKey={agId} size={24} />
                        <span className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                          {agObj?.nome ?? agId}
                        </span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[12px] ${badge.classes}`}>
                        {badge.label}
                      </span>
                    </div>

                    <p className="text-[12px] font-normal text-[#979797] truncate">
                      {agObj?.modelo_padrao ?? "Criativo especialista"}
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

      {children}
      </div>
    </div>
  );
}
