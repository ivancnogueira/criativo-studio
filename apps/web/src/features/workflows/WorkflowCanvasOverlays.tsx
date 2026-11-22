import {
  Hand,
  Map as MapIcon,
  Maximize2,
  Minus,
  MousePointer,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Type,
} from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";
import { WorkflowSearch } from "./WorkflowSearch";
import { WorkflowMinimap } from "./WorkflowMinimap";
import { WorkflowTriggerModal } from "./WorkflowTriggerModal";
import { WorkflowRunDetail } from "./WorkflowRunDetail";
import { WorkflowDeleteUndoToast } from "./WorkflowDeleteUndoToast";
import { WORKFLOW_NODE_LIBRARY } from "./workflow-canvas-helpers";
import type { WorkflowsCanvasPageProps } from "./workflow-canvas-types";
import type { WorkflowCanvasController } from "./useWorkflowCanvasController";

export function WorkflowCanvasOverlays({
  ctrl,
  props,
}: {
  ctrl: WorkflowCanvasController;
  props: WorkflowsCanvasPageProps;
}) {
  const {
    onDeleteWorkflow,
    onListRuns,
    onGetRunDetail,
    onStopRun,
    onDecideStep,
    onRetryStep,
    onStopStep,
    onRotateWebhook,
  } = props;
  const {
    setHiddenDeletedIds,
    currentWf,
    selectedNodeId,
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
    inspectorOpen,
    setInspectorOpen,
    triggerModalNode,
    setTriggerModalNode,
    triggers,
    runs,
    setRuns,
    setSelectedRunId,
    soloSteps,
    hasMoreRuns,
    setHasMoreRuns,
    pendingDelete,
    setPendingDelete,
    statusFeedback,
    stageRef,
    hydrateWorkflowSideData,
    displayNos,
    displayTracos,
    isReadOnly,
    selectedRun,
    nodeRunViewMap,
    centerOnNode,
    fitView,
    handleAddNode,
    handlePatchNode,
    totalTokens30d,
  } = ctrl;

  return (
    <>
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
    </>
  );
}
