import React, { useMemo, useState } from "react";
import type {
  WorkflowNo,
  WorkflowRunDetail as WorkflowRunDetailType,
  WorkflowStepRecord,
} from "@criativo/contracts";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import {
  WORKFLOW_ORIGIN_LABELS,
  WORKFLOW_STATUS_META,
  formatStepDuration,
} from "./workflow-canvas-helpers";

function parseArtifactsList(rawJson: string): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) list.push(item.trim());
      else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const p =
          typeof obj.path === "string"
            ? obj.path
            : typeof obj.caminho === "string"
              ? obj.caminho
              : "";
        if (p) list.push(p);
      }
    }
    return list;
  } catch {
    return [];
  }
}

export interface WorkflowRunDetailProps {
  open: boolean;
  runs: WorkflowRunDetailType[];
  selectedRun: WorkflowRunDetailType | null;
  soloSteps: WorkflowStepRecord[];
  nodes: WorkflowNo[];
  hasMoreRuns?: boolean;
  onSelectRun: (runId: string) => void;
  onLoadMoreRuns?: () => void;
  onFocusNode: (nodeId: string) => void;
  onStopRun: (runId: string) => void;
  onDecideStep: (stepId: string, approved: boolean) => void;
  onRetryStep: (stepId: string) => void;
  onStopStep: (stepId: string) => void;
  onClose: () => void;
}

export const WorkflowRunDetail: React.FC<WorkflowRunDetailProps> = ({
  open,
  runs,
  selectedRun,
  soloSteps,
  nodes,
  hasMoreRuns = false,
  onSelectRun,
  onLoadMoreRuns,
  onFocusNode,
  onStopRun,
  onDecideStep,
  onRetryStep,
  onStopStep,
  onClose,
}) => {
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => new Set());

  const nodeTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.titulo || n.id);
    if (selectedRun?.run.grafo_json) {
      try {
        const parsed = JSON.parse(selectedRun.run.grafo_json) as { nos?: WorkflowNo[] };
        for (const n of parsed.nos ?? []) {
          if (!map.has(n.id)) map.set(n.id, n.titulo || n.id);
        }
      } catch {
        // ignora parse inválido
      }
    }
    return map;
  }, [nodes, selectedRun]);

  if (!open) return null;

  const activeRun = selectedRun?.run ?? null;
  const activeRunStatus = activeRun ? WORKFLOW_STATUS_META[activeRun.status] : null;
  const runCanStop =
    activeRun &&
    (activeRun.status === "running" ||
      activeRun.status === "approval" ||
      activeRun.status === "stopping");

  const toggleExpanded = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  return (
    <aside
      aria-label="Inspetor de execuções do fluxo"
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-white/[0.12] bg-[#212121] shadow-2xl lg:w-[360px]"
    >
      {/* Cabeçalho */}
      <div className="border-b border-white/[0.06] p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[20px] font-semibold text-white">
              {activeRun ? `Execução #${activeRun.numero}` : "Histórico de execuções"}
            </h2>
            {activeRun && activeRunStatus && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#979797]">
                <span>{WORKFLOW_ORIGIN_LABELS[activeRun.origem]}</span>
                <span>·</span>
                <span>{new Date(activeRun.iniciado_em).toLocaleTimeString("pt-BR")}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold ${activeRunStatus.badgeBgClass} ${activeRunStatus.badgeTextClass}`}
                >
                  {activeRunStatus.label}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar inspetor"
            className="flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            <span>Fechar inspetor</span>
          </button>
        </div>

        {runCanStop && activeRun && (
          <button
            type="button"
            onClick={() => onStopRun(activeRun.run_id)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#FD2F3B]/40 bg-[#FD2F3B]/15 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/25"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>Interromper execução</span>
          </button>
        )}

        {/* Popover seletor de runs sem controle nativo */}
        {runs.length > 0 && (
          <div className="relative">
            <button
              type="button"
              aria-expanded={runPickerOpen}
              aria-haspopup="listbox"
              onClick={() => setRunPickerOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-white/[0.12] bg-[#242424] px-2 py-1 text-[12px] text-[#DCDCDC]"
            >
              <span>
                {activeRun
                  ? `Execução #${activeRun.numero} (${WORKFLOW_STATUS_META[activeRun.status].label})`
                  : "Selecionar execução"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[#979797]" />
            </button>
            {runPickerOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-white/[0.12] bg-[#212121] p-1 shadow-2xl"
              >
                {runs.map((entry) => {
                  const st = WORKFLOW_STATUS_META[entry.run.status];
                  const active = entry.run.run_id === activeRun?.run_id;
                  return (
                    <button
                      key={entry.run.run_id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onSelectRun(entry.run.run_id);
                        setRunPickerOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] ${
                        active ? "bg-[#2A2A2A] font-semibold text-white" : "text-[#DCDCDC] hover:bg-[#2A2A2A]/70"
                      }`}
                    >
                      <span>
                        #{entry.run.numero} · {WORKFLOW_ORIGIN_LABELS[entry.run.origem]}
                      </span>
                      <span className={st.badgeTextClass}>{st.label}</span>
                    </button>
                  );
                })}
                {hasMoreRuns && onLoadMoreRuns && (
                  <button
                    type="button"
                    onClick={() => {
                      onLoadMoreRuns();
                      setRunPickerOpen(false);
                    }}
                    className="mt-1 w-full rounded-lg bg-[#242424] px-2 py-1 text-center text-[12px] font-semibold text-[#42A0FF] hover:bg-[#2A2A2A]"
                  >
                    Carregar execuções anteriores
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Corpo com etapas e execuções isoladas */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!selectedRun && soloSteps.length === 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-[#141414] p-4 text-center text-[14px] text-[#979797]">
            Aguardando primeira execução deste fluxo.
          </div>
        )}

        {selectedRun && (
          <div className="space-y-2">
            {selectedRun.steps.map((step) => {
              const st = WORKFLOW_STATUS_META[step.status];
              const isOpen = expandedSteps.has(step.step_id);
              const artifacts = parseArtifactsList(step.artefatos_json);
              const delivery = selectedRun.deliveries.find((d) => d.step_id === step.step_id);

              return (
                <div
                  key={step.step_id}
                  className="rounded-xl border border-white/[0.06] bg-[#242424] p-2 space-y-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onFocusNode(step.node_id);
                      toggleExpanded(step.step_id);
                    }}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#979797]" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#979797]" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-white">
                          {nodeTitleById.get(step.node_id) ?? step.node_id}
                        </p>
                        <p className="text-[12px] text-[#979797]">
                          {step.kind}
                          {step.tentativa > 1 ? ` · Tentativa #${step.tentativa}` : ""} ·{" "}
                          {formatStepDuration(step.iniciado_em, step.encerrado_em)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {step.branch && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${
                            step.branch === "yes"
                              ? "bg-[#31CF76]/20 text-[#31CF76]"
                              : "bg-[#FD2F3B]/20 text-[#FD2F3B]"
                          }`}
                        >
                          {step.branch === "yes" ? "Sim" : "Não"}
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold ${st.badgeBgClass} ${st.badgeTextClass}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  </button>

                  {step.erro && (
                    <p className="rounded-lg bg-[#FD2F3B]/10 p-2 text-[12px] text-[#FD2F3B]">
                      {step.erro}
                    </p>
                  )}

                  {delivery && (
                    <div
                      className={`rounded-lg border p-2 text-[12px] ${
                        delivery.status === "sent"
                          ? "border-[#31CF76]/40 bg-[#31CF76]/10 text-[#31CF76]"
                          : delivery.status === "uncertain"
                            ? "border-[#FF9412]/40 bg-[#FF9412]/10 text-[#FF9412]"
                            : delivery.status === "failed"
                              ? "border-[#FD2F3B]/40 bg-[#FD2F3B]/10 text-[#FD2F3B]"
                              : "border-white/[0.06] bg-[#141414] text-[#DCDCDC]"
                      }`}
                    >
                      {delivery.status === "uncertain" ? (
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Entrega incerta após reinício — confira antes de reenviar ({delivery.destino})
                          </span>
                        </span>
                      ) : (
                        <span>
                          Entrega ({delivery.destino}): {delivery.status}
                          {delivery.motivo ? ` — ${delivery.motivo}` : ""}
                        </span>
                      )}
                    </div>
                  )}

                  {isOpen && (
                    <div className="space-y-2 border-t border-white/[0.06] pt-2 text-[12px]">
                      {step.input && (
                        <div>
                          <span className="font-semibold text-[#979797]">Entrada:</span>
                          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-[#101010] p-2 font-mono text-[12px] text-[#DCDCDC]">
                            {step.input}
                          </pre>
                        </div>
                      )}
                      {step.output && (
                        <div>
                          <span className="font-semibold text-[#979797]">Saída:</span>
                          <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-[#101010] p-2 font-mono text-[12px] text-[#DCDCDC]">
                            {step.output}
                          </pre>
                        </div>
                      )}
                      {artifacts.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {artifacts.map((art) =>
                            /\.(png|jpe?g|webp|gif)$/i.test(art) ? (
                              <img
                                key={art}
                                src={`/api/arquivos/raw?path=${encodeURIComponent(art)}`}
                                alt={art}
                                className="h-16 w-16 rounded-lg border border-white/[0.06] object-cover"
                              />
                            ) : (
                              <span
                                key={art}
                                className="rounded bg-[#101010] px-2 py-1 font-mono text-[12px] text-[#31CF76]"
                              >
                                {art}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {step.status === "approval" && (
                      <>
                        <button
                          type="button"
                          onClick={() => onDecideStep(step.step_id, true)}
                          className="flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-2 py-1 text-[12px] font-semibold text-[#141414]"
                        >
                          <Check className="h-3 w-3" />
                          <span>Aprovar etapa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDecideStep(step.step_id, false)}
                          className="rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-white hover:bg-[#FD2F3B]/30"
                        >
                          Rejeitar etapa
                        </button>
                      </>
                    )}
                    {(step.status === "failed" || step.status === "stopped") && (
                      <button
                        type="button"
                        onClick={() => onRetryStep(step.step_id)}
                        className="flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#FF9412]"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Retentar etapa</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {soloSteps.length > 0 && (
          <div className="space-y-2 border-t border-white/[0.06] pt-4">
            <h3 className="text-[14px] font-semibold text-[#DCDCDC]">
              Execuções Isoladas de Etapas
            </h3>
            {soloSteps.slice(0, 12).map((step) => {
              const st = WORKFLOW_STATUS_META[step.status];
              return (
                <div
                  key={step.step_id}
                  className="rounded-xl border border-white/[0.06] bg-[#242424] p-2 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onFocusNode(step.node_id)}
                      className="truncate text-[12px] font-semibold text-white hover:underline"
                    >
                      {nodeTitleById.get(step.node_id) ?? step.node_id}
                    </button>
                    <span className={`text-[12px] font-semibold ${st.badgeTextClass}`}>
                      {st.label}
                    </span>
                  </div>
                  {step.output && (
                    <p className="line-clamp-2 text-[12px] text-[#979797]">{step.output}</p>
                  )}
                  {step.status === "running" && step.run_id === null && (
                    <button
                      type="button"
                      onClick={() => onStopStep(step.step_id)}
                      className="rounded-lg bg-[#2A2A2A] px-2 py-1 text-[12px] font-semibold text-[#FD2F3B]"
                    >
                      Interromper etapa
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
