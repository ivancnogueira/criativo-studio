import {
  Zap,
} from "lucide-react";
import { WorkflowNodeCard } from "./WorkflowNodes";
import { WORKFLOW_PORT_META, getWorkflowNodeWidth } from "./workflow-canvas-helpers";
import { TRIGGER_PRESETS, cloneCanvasSnapshot } from "./workflow-canvas-types";
import type { WorkflowsCanvasPageProps } from "./workflow-canvas-types";
import type { WorkflowCanvasController } from "./useWorkflowCanvasController";

export function WorkflowCanvasStage({
  ctrl,
  props,
}: {
  ctrl: WorkflowCanvasController;
  props: WorkflowsCanvasPageProps;
}) {
  const {
    agentes,
    canais = [],
    arquivos = [],
    provedores = [],
    onExecuteStep,
    onDecideStep,
    onRetryStep,
    onUploadFile,
  } = props;
  const {
    currentWf,
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    connectingFrom,
    setConnectingFrom,
    zoom,
    panOffset,
    activeTool,
    triggerMenuOpen,
    setTriggerMenuOpen,
    setTriggerModalNode,
    triggers,
    setSoloSteps,
    localNosRef,
    localArestasRef,
    localTracosRef,
    stageRef,
    draggingNodeRef,
    mouseWorld,
    hydrateWorkflowSideData,
    displayNos,
    displayArestas,
    displayTracos,
    isReadOnly,
    loopEdges,
    nodeRunViewMap,
    handleAddNode,
    handlePatchNode,
    handleDeleteNode,
    handleDuplicateNode,
    handleFinishConnect,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
    handleRunWorkflow,
  } = ctrl;

  return (
    <>
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
        className={`studio-dot-grid relative h-full w-full overflow-hidden ${
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
                    style={{ pointerEvents: "stroke" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNodeId(null);
                      setSelectedEdgeId(edge.id);
                    }}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={selectedEdgeId === edge.id ? 3 : 2}
                    strokeDasharray={isLoop ? "6 4" : undefined}
                    style={{ pointerEvents: "stroke" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNodeId(null);
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
                setSelectedEdgeId(null);
                setSelectedNodeId(n.id);
                if (activeTool === "select" && !n.locked && !isReadOnly) {
                  draggingNodeRef.current = {
                    nodeId: n.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origX: n.x,
                    origY: n.y,
                    startSnapshot: cloneCanvasSnapshot(
                      localNosRef.current,
                      localArestasRef.current,
                      localTracosRef.current
                    ),
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
                            config: preset.conectorId
                              ? {
                                  triggerKind: preset.triggerKind,
                                  conectorId: preset.conectorId,
                                }
                              : { triggerKind: preset.triggerKind },
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
    </>
  );
}
