import { useEffect, useState } from "react";
import type { WorkflowTemplateDefinition } from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import { WorkflowEmptyTemplates } from "./WorkflowEmptyTemplates";
import { WorkflowNodeCard } from "./WorkflowNodes";
import { WORKFLOW_PORT_META, getWorkflowNodeWidth } from "./workflow-canvas-helpers";
import { cloneCanvasSnapshot } from "./workflow-canvas-types";
import type { WorkflowsCanvasPageProps } from "./workflow-canvas-types";
import { useWorkflowCanvasMediaDrop } from "./useWorkflowCanvasMediaDrop";
import { useWorkflowPresence } from "./useWorkflowPresence";
import { WorkflowCollaborativeCursors } from "./WorkflowCollaborativeCursors";
import { instantiateWorkflowTemplate } from "./workflow-templates";
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
    onCreateWorkflow,
    onExecuteStep,
    onDecideStep,
    onRetryStep,
    onUploadFile,
  } = props;
  const {
    currentWf,
    setActiveWfId,
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
    setLocalNos,
    setLocalArestas,
    setStatusFeedback,
    scheduleDebouncedSave,
    pushUndoSnapshot,
    fitView,
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

  const [remoteTemplates, setRemoteTemplates] = useState<WorkflowTemplateDefinition[]>([]);

  const { remoteMembers, collaboratorByNodeId, reportCursor } = useWorkflowPresence({
    workflowId: currentWf?.workflow_id ?? null,
    selectedNodeId,
  });

  useEffect(() => {
    if (displayNos.length > 0) return;
    let active = true;
    void daemonApi
      .listWorkflowTemplates()
      .then((res) => {
        if (active && Array.isArray(res.templates) && res.templates.length > 0) {
          setRemoteTemplates(res.templates);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [displayNos.length]);

  const {
    isDraggingMedia,
    uploadingDropCount,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useWorkflowCanvasMediaDrop({
    stageRef,
    zoom,
    panOffset,
    isReadOnly,
    onUploadFile,
    onCreateAssetNodeAt: (arquivo, x, y) => {
      handleAddNode("asset", {
        titulo: arquivo.nome_original,
        x,
        y,
        fileId: arquivo.arquivo_id,
        config: { fileId: arquivo.arquivo_id },
      });
    },
    setStatusFeedback,
  });

  const handleApplyTemplate = (templateId: WorkflowTemplateDefinition["id"]) => {
    const built = instantiateWorkflowTemplate(templateId, provedores, remoteTemplates);
    if (!currentWf && onCreateWorkflow) {
      void onCreateWorkflow({
        nome: built.template.nome,
        nos: built.nos,
        arestas: built.arestas,
      }).then((created) => {
        setActiveWfId(created.workflow_id);
        setStatusFeedback(`Template "${built.template.nome}" criado.`);
      });
      return;
    }
    if (isReadOnly) return;
    pushUndoSnapshot();
    localNosRef.current = built.nos;
    localArestasRef.current = built.arestas;
    setLocalNos(built.nos);
    setLocalArestas(built.arestas);
    setSelectedNodeId(built.nos[0]?.id ?? null);
    setTriggerMenuOpen(false);
    scheduleDebouncedSave(built.nos, built.arestas);
    setStatusFeedback(`Template "${built.template.nome}" aplicado ao fluxo.`);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => fitView());
    }
  };

  return (
    <>
      {/* Fundo infinito dot-grid */}
      <div
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={(e) => {
          handleStagePointerMove(e);
          if (!currentWf) return;
          const rect = stageRef.current?.getBoundingClientRect();
          if (!rect) return;
          const worldX = (e.clientX - rect.left - panOffset.x) / zoom;
          const worldY = (e.clientY - rect.top - panOffset.y) / zoom;
          reportCursor(worldX, worldY);
        }}
        onPointerUp={handleStagePointerUp}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
              allNodes={displayNos}
              allEdges={displayArestas}
              selected={selectedNodeId === node.id}
              collaboratorSelection={collaboratorByNodeId.get(node.id) ?? null}
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
              onRefreshRunData={
                currentWf ? () => hydrateWorkflowSideData(currentWf.workflow_id) : undefined
              }
            />
          ))}

          {/* Cursores colaborativos ao vivo na camada transformada */}
          <WorkflowCollaborativeCursors members={remoteMembers} />
        </div>

        {/* Estado vazio quando não há nós */}
        {displayNos.length === 0 && (
          <WorkflowEmptyTemplates
            templates={remoteTemplates}
            triggerMenuOpen={triggerMenuOpen}
            onToggleTriggerMenu={() => setTriggerMenuOpen((v) => !v)}
            onApplyTemplate={handleApplyTemplate}
            onAddTriggerNode={(tipo, extra) => handleAddNode(tipo, extra)}
          />
        )}

        {(isDraggingMedia || uploadingDropCount > 0) && (
          <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#007CF7] bg-[#007CF7]/10 backdrop-blur-xs">
            <div className="rounded-xl border border-[#007CF7]/40 bg-[#181818] px-4 py-2 text-[13px] font-semibold text-white shadow-2xl">
              {uploadingDropCount > 0
                ? `Enviando ${uploadingDropCount} mídia(s) para o fluxo...`
                : "Solte vídeo (MP4/MOV), áudio (MP3/WAV) ou imagem para adicionar ao fluxo"}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
