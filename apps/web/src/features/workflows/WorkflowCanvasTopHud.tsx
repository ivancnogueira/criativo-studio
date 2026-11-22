import React, { useEffect, useState } from "react";
import {
  Activity,
  ChevronDown,
  LayoutGrid,
  ListChecks,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { normalizeWorkflowGraph, type WorkflowPresenceMember } from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import { WorkflowSwitcher } from "./WorkflowSwitcher";
import { WorkflowVersionBar } from "./WorkflowVersionBar";
import { WORKFLOW_STATUS_META } from "./workflow-canvas-helpers";
import type { WorkflowsCanvasPageProps } from "./workflow-canvas-types";
import type { WorkflowCanvasController } from "./useWorkflowCanvasController";

export function WorkflowCanvasTopHud({
  ctrl,
  props,
}: {
  ctrl: WorkflowCanvasController;
  props: WorkflowsCanvasPageProps;
}) {
  const {
    workflows,
    onCreateWorkflow,
    onSaveWorkflow,
    onDeleteWorkflow,
    onGetVersion,
    onRestoreVersion,
    onStopRun,
  } = props;
  const {
    setHiddenDeletedIds,
    visibleWorkflows,
    setActiveWfId,
    currentWf,
    localNos,
    setLocalNos,
    localArestas,
    setLocalArestas,
    localTracos,
    setLocalTracos,
    setLocalRevision,
    selectedEdgeId,
    runsMenuOpen,
    setRunsMenuOpen,
    setInspectorOpen,
    versions,
    setVersions,
    runs,
    setSelectedRunId,
    previewVersion,
    setPreviewVersion,
    restoringVersion,
    setRestoringVersion,
    setPendingDelete,
    setStatusFeedback,
    executing,
    undoStack,
    redoStack,
    localRevRef,
    hydrateWorkflowSideData,
    isReadOnly,
    liveRun,
    handleDeleteEdge,
    handleUndo,
    handleRedo,
    handleAutoLayout,
    handleSaveNow,
    handleRunWorkflow,
    handleCreateFlow,
    doneCount,
    totalExecCount,
  } = ctrl;

  const [presenceMembers, setPresenceMembers] = useState<WorkflowPresenceMember[]>([]);

  useEffect(() => {
    if (!currentWf?.workflow_id) return;
    void daemonApi
      .listWorkflowPresence(currentWf.workflow_id)
      .then(setPresenceMembers)
      .catch(() => {});
  }, [currentWf?.workflow_id]);

  return (
    <>
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
          {!isReadOnly && currentWf && (
            <div className="flex items-center gap-1 rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl">
              <button
                type="button"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                title="Desfazer (Ctrl+Z)"
                aria-label="Desfazer (Ctrl+Z)"
                className="rounded-lg p-1.5 text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
                title="Refazer (Ctrl+Shift+Z / Ctrl+Y)"
                aria-label="Refazer (Ctrl+Y)"
                className="rounded-lg p-1.5 text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <div className="mx-0.5 h-4 w-px bg-white/[0.08]" />
              <button
                type="button"
                disabled={localNos.length === 0}
                onClick={handleAutoLayout}
                title="Organizar nós automaticamente"
                aria-label="Organizar nós"
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[#42A0FF]" />
                <span className="hidden xl:inline">Organizar nós</span>
              </button>
            </div>
          )}

          {selectedEdgeId && !isReadOnly && (
            <button
              type="button"
              onClick={() => handleDeleteEdge(selectedEdgeId)}
              className="flex items-center gap-1 rounded-xl border border-[#FD2F3B]/40 bg-[#212121] px-3 py-2 text-[12px] font-semibold text-[#FD2F3B] shadow-2xl"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remover conexão</span>
            </button>
          )}

          {presenceMembers.length > 0 && (
            <div
              data-testid="workflow-presence-badge"
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-[#212121] px-2.5 py-2 text-[12px] text-[#31CF76]"
            >
              <Users className="h-3.5 w-3.5" />
              <span>{presenceMembers.length} ativo(s)</span>
            </div>
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

          {!isReadOnly && currentWf && (
            <button
              type="button"
              onClick={() => void handleSaveNow()}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-[#212121] px-3 py-2 text-[14px] font-semibold text-[#DCDCDC] shadow-2xl hover:bg-[#2A2A2A]"
            >
              <Save className="h-4 w-4 text-[#31CF76]" />
              <span>Salvar fluxo</span>
            </button>
          )}

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
    </>
  );
}
