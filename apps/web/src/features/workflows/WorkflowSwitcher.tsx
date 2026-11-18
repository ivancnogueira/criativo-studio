import React, { useEffect, useRef, useState } from "react";
import type { WorkflowVersionSummary, WorkflowVisual } from "@criativo/contracts";
import { Check, ChevronDown, ChevronRight, Copy, Edit3, History, Plus, Trash2 } from "lucide-react";

const VERSION_KIND_LABELS: Record<WorkflowVersionSummary["kind"], string> = {
  auto: "Automática",
  run: "Pré-execução",
  restore: "Restauração",
};

export interface WorkflowSwitcherProps {
  workflows: WorkflowVisual[];
  activeWorkflow: WorkflowVisual | null;
  versions: WorkflowVersionSummary[];
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onRenameWorkflow: (workflowId: string, nextName: string) => void;
  onDuplicateWorkflow: (workflow: WorkflowVisual) => void;
  onDeleteWorkflow: (workflow: WorkflowVisual) => void;
  onPreviewVersion: (versionId: string) => void;
}

export const WorkflowSwitcher: React.FC<WorkflowSwitcherProps> = ({
  workflows,
  activeWorkflow,
  versions,
  onSelectWorkflow,
  onCreateWorkflow,
  onRenameWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onPreviewVersion,
}) => {
  const [open, setOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setRenaming(false);
      }
    };
    const onDocDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDocDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDocDown);
    };
  }, [open]);

  const activeExecSteps =
    activeWorkflow?.nos.filter((n) => n.tipo !== "nota" && n.tipo !== "shape" && n.tipo !== "text")
      .length ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Alternar fluxo de trabalho"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-[#212121] px-4 py-2 text-left shadow-2xl hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
      >
        <div className="min-w-0">
          <span className="block max-w-[220px] truncate text-[14px] font-semibold text-white">
            {activeWorkflow?.nome ?? "Selecionar fluxo"}
          </span>
          <span className="block text-[12px] font-normal text-[#979797]">
            {activeExecSteps} etapa(s) · rev. {activeWorkflow?.revisao_grafo ?? 0}
          </span>
        </div>
        <ChevronDown className="h-4 w-4 text-[#979797]" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-80 rounded-xl border border-white/[0.12] bg-[#212121] p-2 shadow-2xl"
        >
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {workflows.map((wf) => {
              const isSelected = wf.workflow_id === activeWorkflow?.workflow_id;
              const etapasCount = wf.nos.filter(
                (n) => n.tipo !== "nota" && n.tipo !== "shape" && n.tipo !== "text"
              ).length;
              return (
                <button
                  key={wf.workflow_id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectWorkflow(wf.workflow_id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[14px] ${
                    isSelected
                      ? "bg-[#2A2A2A] font-semibold text-white"
                      : "font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]/70"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0">
                      {isSelected && <Check className="h-4 w-4 text-[#42A0FF]" />}
                    </span>
                    <span className="truncate">{wf.nome}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-normal text-[#979797]">
                    {etapasCount} etapas
                  </span>
                </button>
              );
            })}
          </div>

          <div className="my-2 h-px bg-white/[0.06]" />

          <div className="space-y-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCreateWorkflow();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[14px] font-semibold text-[#42A0FF] hover:bg-[#2A2A2A]"
            >
              <Plus className="h-4 w-4" />
              <span>Criar fluxo</span>
            </button>

            {activeWorkflow && !renaming && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDraftName(activeWorkflow.nome);
                  setRenaming(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[14px] font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]"
              >
                <Edit3 className="h-4 w-4 text-[#979797]" />
                <span>Renomear fluxo</span>
              </button>
            )}

            {activeWorkflow && renaming && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draftName.trim()) {
                    onRenameWorkflow(activeWorkflow.workflow_id, draftName.trim());
                  }
                  setRenaming(false);
                  setOpen(false);
                }}
                className="flex items-center gap-1 px-1 py-1"
              >
                <input
                  autoFocus
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="flex-1 rounded-lg border border-[#007CF7] bg-[#242424] px-2 py-1 text-[14px] text-white focus-visible:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-[#F0F0F0] px-2 py-1 text-[12px] font-semibold text-[#141414]"
                >
                  Aplicar nome
                </button>
              </form>
            )}

            {activeWorkflow && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDuplicateWorkflow(activeWorkflow);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[14px] font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]"
              >
                <Copy className="h-4 w-4 text-[#979797]" />
                <span>Duplicar fluxo</span>
              </button>
            )}

            {activeWorkflow && (
              <div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setVersionsOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[14px] font-normal text-[#DCDCDC] hover:bg-[#2A2A2A]"
                >
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4 text-[#979797]" />
                    <span>Histórico de versões</span>
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 text-[#979797] transition-transform ${
                      versionsOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {versionsOpen && (
                  <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-[#141414] p-1">
                    {versions.length === 0 ? (
                      <p className="px-2 py-1 text-[12px] text-[#979797]">
                        Nenhuma versão gravada ainda.
                      </p>
                    ) : (
                      versions.slice(0, 50).map((ver) => (
                        <button
                          key={ver.version_id}
                          type="button"
                          onClick={() => {
                            onPreviewVersion(ver.version_id);
                            setOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] text-[#DCDCDC] hover:bg-[#2A2A2A]"
                        >
                          <span>
                            {VERSION_KIND_LABELS[ver.kind]} · rev. #{ver.revisao_grafo}
                          </span>
                          <span className="text-[#979797]">
                            {new Date(ver.criado_em).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {activeWorkflow && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDeleteWorkflow(activeWorkflow);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[14px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/10"
              >
                <Trash2 className="h-4 w-4" />
                <span>Excluir fluxo</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
