import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  AgenteThreadRegistro,
  AnexoChat,
  AvatarShape,
  FilaChatSnapshot,
  PaginaConversaThread,
  TarefaRegistro,
} from "@criativo/contracts";
import { Archive, ChevronDown, ChevronRight, Clock, Loader2, Sparkles } from "lucide-react";
import { getDefaultMascotForAgent, MascoteAvatar } from "../../components/MascoteAvatar";
import { daemonApi } from "../../services/websocket-client";
import type { AgentStepLog } from "../trace/AgentStepsWaterfall";
import { TASK_UNDO_WINDOW_MS, TasksComposer, TaskTookLine, type PendingUndoTask } from "../tasks/TasksComposer";
import { TasksSidePanel } from "../tasks/TasksSidePanel";

export interface TasksQueuePageProps {
  tarefas: TarefaRegistro[];
  agentes?: AgenteRegistro[];
  threads?: AgenteThreadRegistro[];
  selectedTaskId: string | null;
  selectedThreadId?: string | null;
  steps: AgentStepLog[];
  thoughtStream: string;
  onSelectTask: (tarefaId: string) => void;
  onSelectThread?: (threadId: string | null) => void;
  onCreateTask?: (input: {
    titulo: string;
    tipo: string;
    prioridade: number;
    prompt: string;
  }) => Promise<void>;
  onCreateThread?: (input: {
    agenteId: string;
    titulo?: string;
    conteudo: string;
    anexos: AnexoChat[];
    clientMessageId: string;
  }) => Promise<AgenteThreadRegistro | null>;
  onOpenInChat?: (thread: AgenteThreadRegistro) => void;
  onUploadFile?: (file: File) => Promise<AnexoChat>;
  onRetryTask: (tarefaId: string) => void;
  onCancelTask: (tarefaId: string) => void;
  onApproveTask: (tarefaId: string) => Promise<void>;
  onRequestRevision: (tarefa: TarefaRegistro) => Promise<void>;
  onRefreshThreads?: () => Promise<void>;
}

interface UnifiedTaskItem {
  key: string;
  thread: AgenteThreadRegistro | null;
  tarefa: TarefaRegistro | null;
  agenteId: string;
  titulo: string;
  progresso: string | null;
  atualizadoEm: string;
  section: "needs_you" | "running" | "waiting" | "unread" | "read" | "archived";
  isPendingUndo?: boolean;
}

/**
 * Cockpit interativo "Sub-tarefas Paralelas & Fila" em split responsivo:
 * composer rápido com Undo de 6.000ms, 6 seções agrupadas à esquerda e `TasksSidePanel` redimensionável à direita.
 */
export const TasksQueuePage: React.FC<TasksQueuePageProps> = ({
  tarefas,
  agentes = [],
  threads = [],
  selectedTaskId,
  selectedThreadId: controlledThreadId,
  steps,
  thoughtStream,
  onSelectTask,
  onSelectThread,
  onCreateThread,
  onOpenInChat,
  onUploadFile,
  onRetryTask,
  onApproveTask,
  onRequestRevision,
  onRefreshThreads,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    () => agentes[0]?.agente_id ?? "estrategista"
  );
  const [draft, setDraft] = useState("");
  const [tituloDraft, setTituloDraft] = useState("");
  const [anexos, setAnexos] = useState<AnexoChat[]>([]);
  const [focusNonce, setFocusNonce] = useState(0);

  const [pendingTask, setPendingTask] = useState<PendingUndoTask | null>(null);
  const [remainingSec, setRemainingSec] = useState(6);
  const pendingTimerRef = useRef<number | null>(null);
  const pendingIntervalRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingUndoTask | null>(null);

  const [localThreadId, setLocalThreadId] = useState<string | null>(controlledThreadId ?? null);
  const [panelOpen, setPanelOpen] = useState(Boolean(controlledThreadId || selectedTaskId));
  const [showAllArchived, setShowAllArchived] = useState(false);
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [panelPage, setPanelPage] = useState<PaginaConversaThread | null>(null);
  const [panelQueue, setPanelQueue] = useState<FilaChatSnapshot | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  const activeThreadId = controlledThreadId !== undefined ? controlledThreadId : localThreadId;

  useEffect(() => {
    if (!agentes.some((a) => a.agente_id === selectedAgentId) && agentes[0]) {
      setSelectedAgentId(agentes[0].agente_id);
    }
  }, [agentes, selectedAgentId]);

  const clearPendingTimers = useCallback(() => {
    if (pendingTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (pendingIntervalRef.current !== null && typeof window !== "undefined") {
      window.clearInterval(pendingIntervalRef.current);
      pendingIntervalRef.current = null;
    }
  }, []);

  const commitPendingNow = useCallback(
    async (openAfter = false) => {
      const current = pendingRef.current;
      if (!current) return null;
      pendingRef.current = null;
      setPendingTask(null);
      clearPendingTimers();

      let created: AgenteThreadRegistro | null = null;
      if (onCreateThread) {
        created = await onCreateThread({
          agenteId: current.agenteId,
          titulo: current.titulo,
          conteudo: current.conteudo,
          anexos: current.anexos,
          clientMessageId: current.clientMessageId,
        });
      } else {
        const res = await daemonApi.createAgentThread(current.agenteId, {
          titulo: current.titulo,
          conteudo: current.conteudo,
          anexos: current.anexos,
          client_message_id: current.clientMessageId,
        });
        created = res.thread;
      }
      await onRefreshThreads?.();
      if (openAfter && created) {
        setLocalThreadId(created.thread_id);
        onSelectThread?.(created.thread_id);
        setPanelOpen(true);
      }
      return created;
    },
    [clearPendingTimers, onCreateThread, onRefreshThreads, onSelectThread]
  );

  // Garante commit imediato ao navegar/desmontar quando há envio pendente não desfeito
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        void commitPendingNow(false);
      } else {
        clearPendingTimers();
      }
    };
  }, [commitPendingNow, clearPendingTimers]);

  const handleScheduleTaskWithUndo = () => {
    const cleanText = draft.trim();
    if (!cleanText && anexos.length === 0) return;

    if (pendingRef.current) {
      void commitPendingNow(false);
    }

    const clientId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const nextPending: PendingUndoTask = {
      clientMessageId: clientId,
      agenteId: selectedAgentId,
      titulo:
        tituloDraft.trim() ||
        cleanText.replace(/\s+/g, " ").slice(0, 72) ||
        "Sub-tarefa paralela",
      conteudo: cleanText || "Referências anexadas",
      anexos,
      expiresAt: Date.now() + TASK_UNDO_WINDOW_MS,
    };

    pendingRef.current = nextPending;
    setPendingTask(nextPending);
    setRemainingSec(Math.ceil(TASK_UNDO_WINDOW_MS / 1000));
    setDraft("");
    setTituloDraft("");
    setAnexos([]);

    if (typeof window !== "undefined") {
      pendingIntervalRef.current = window.setInterval(() => {
        if (!pendingRef.current) return;
        const left = Math.max(0, Math.ceil((pendingRef.current.expiresAt - Date.now()) / 1000));
        setRemainingSec(left);
      }, 250);

      pendingTimerRef.current = window.setTimeout(() => {
        void commitPendingNow(false);
      }, TASK_UNDO_WINDOW_MS);
    }
  };

  const handleUndo = () => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPendingTask(null);
    clearPendingTimers();
    setSelectedAgentId(current.agenteId);
    setDraft(current.conteudo);
    setTituloDraft(current.titulo);
    setAnexos(current.anexos);
    setFocusNonce((n) => n + 1);
  };

  const loadPanelDetails = useCallback(async (threadObj: AgenteThreadRegistro | null) => {
    if (!threadObj) {
      setPanelPage(null);
      setPanelQueue(null);
      return;
    }
    setPanelLoading(true);
    try {
      const [pag, qSnap] = await Promise.all([
        daemonApi.readThreadMessages(threadObj.thread_id, { limit: 50 }).catch(() => null),
        daemonApi.listChatQueue(threadObj.agente_id, threadObj.thread_id).catch(() => null),
      ]);
      setPanelPage(pag);
      setPanelQueue(qSnap);
      await daemonApi.markThreadRead(threadObj.thread_id).catch(() => null);
    } finally {
      setPanelLoading(false);
    }
  }, []);

  const selectedThread = useMemo(
    () => threads.find((t) => t.thread_id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const selectedTask = useMemo(() => {
    if (selectedThread?.tarefa_id) {
      return tarefas.find((t) => t.tarefa_id === selectedThread.tarefa_id) ?? null;
    }
    return tarefas.find((t) => t.tarefa_id === selectedTaskId) ?? null;
  }, [selectedThread, tarefas, selectedTaskId]);

  useEffect(() => {
    if (panelOpen && selectedThread) {
      void loadPanelDetails(selectedThread);
    }
  }, [panelOpen, selectedThread, loadPanelDetails]);

  const items: UnifiedTaskItem[] = useMemo(() => {
    const mapByTask = new Map<string, TarefaRegistro>(tarefas.map((t) => [t.tarefa_id, t]));
    const consumedTaskIds = new Set<string>();
    const list: UnifiedTaskItem[] = [];

    if (pendingTask) {
      list.push({
        key: `pending:${pendingTask.clientMessageId}`,
        thread: null,
        tarefa: null,
        agenteId: pendingTask.agenteId,
        titulo: pendingTask.titulo,
        progresso: "Iniciando em instantes (clique Desfazer envio para cancelar)",
        atualizadoEm: new Date(pendingTask.expiresAt).toISOString(),
        section: "waiting",
        isPendingUndo: true,
      });
    }

    for (const th of threads) {
      const tk = th.tarefa_id ? (mapByTask.get(th.tarefa_id) ?? null) : null;
      if (tk) consumedTaskIds.add(tk.tarefa_id);

      let section: UnifiedTaskItem["section"] = "read";
      if (th.arquivada_em) {
        section = "archived";
      } else if (tk?.status === "aguardando_aprovacao" || th.desfecho === "falha" || th.hold !== null) {
        section = "needs_you";
      } else if (th.estado === "executando" || th.turno_ativo_id !== null) {
        section = "running";
      } else if (th.estado === "enfileirada" || th.mensagens_enfileiradas.length > 0) {
        section = "waiting";
      } else if (th.desfecho !== null && !th.ultima_mensagem_lida_id) {
        section = "unread";
      }

      list.push({
        key: th.thread_id,
        thread: th,
        tarefa: tk,
        agenteId: th.agente_id,
        titulo: th.titulo,
        progresso: th.progresso,
        atualizadoEm: th.atualizado_em,
        section,
      });
    }

    for (const tk of tarefas) {
      if (consumedTaskIds.has(tk.tarefa_id) || tk.thread_id) continue;
      let section: UnifiedTaskItem["section"] = "read";
      if (tk.status === "aguardando_aprovacao" || tk.status === "falha") {
        section = "needs_you";
      } else if (tk.status === "executando") {
        section = "running";
      } else if (tk.status === "pendente") {
        section = "waiting";
      } else if (tk.status === "cancelado") {
        section = "archived";
      }

      list.push({
        key: tk.tarefa_id,
        thread: null,
        tarefa: tk,
        agenteId: tk.agente_id ?? "estrategista",
        titulo: tk.titulo,
        progresso: tk.erro_detalhes ?? null,
        atualizadoEm: tk.atualizado_em,
        section,
      });
    }

    return list;
  }, [pendingTask, threads, tarefas]);

  const sections: Array<{
    id: UnifiedTaskItem["section"];
    title: string;
    items: UnifiedTaskItem[];
  }> = [
    { id: "needs_you", title: "Precisa de você", items: items.filter((i) => i.section === "needs_you") },
    { id: "running", title: "Em execução", items: items.filter((i) => i.section === "running") },
    { id: "waiting", title: "Aguardando", items: items.filter((i) => i.section === "waiting") },
    { id: "unread", title: "Não lidas", items: items.filter((i) => i.section === "unread") },
    { id: "read", title: "Lidas", items: items.filter((i) => i.section === "read") },
    { id: "archived", title: "Arquivadas", items: items.filter((i) => i.section === "archived") },
  ];

  const handleOpenItem = async (item: UnifiedTaskItem) => {
    if (item.isPendingUndo) {
      await commitPendingNow(true);
      return;
    }
    if (item.thread) {
      setLocalThreadId(item.thread.thread_id);
      onSelectThread?.(item.thread.thread_id);
    } else {
      setLocalThreadId(null);
      onSelectThread?.(null);
    }
    if (item.tarefa) {
      onSelectTask(item.tarefa.tarefa_id);
    }
    setPanelOpen(true);
  };

  const resolveAgentVisual = (agenteId: string) => {
    const ag = agentes.find((a) => a.agente_id === agenteId);
    const cfg = (ag?.config ?? {}) as Record<string, unknown>;
    const fb = getDefaultMascotForAgent(agenteId);
    return {
      nome: ag?.nome ?? agenteId,
      shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape,
      color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color,
    };
  };

  const selectedAgent =
    agentes.find((a) => a.agente_id === (selectedThread?.agente_id ?? selectedTask?.agente_id ?? selectedAgentId)) ??
    null;

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-[#1A1A1A]">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[960px] space-y-6">
          <header>
            <h1 className="text-[20px] font-semibold text-white">Sub-tarefas Paralelas &amp; Fila</h1>
            <p className="text-[12px] font-normal text-[#979797]">
              Dispare entregas paralelas por agente, acompanhe progresso isolado e aprove saídas para [NOME_DA_MARCA].
            </p>
          </header>

          <TasksComposer
            agentes={agentes}
            selectedAgentId={selectedAgentId}
            onChangeAgent={setSelectedAgentId}
            draft={draft}
            onChangeDraft={setDraft}
            tituloDraft={tituloDraft}
            onChangeTituloDraft={setTituloDraft}
            anexos={anexos}
            onChangeAnexos={setAnexos}
            onUploadFile={onUploadFile}
            onStartTask={handleScheduleTaskWithUndo}
            focusNonce={focusNonce}
          />

          {pendingTask && (
            <TaskTookLine
              pending={pendingTask}
              agentes={agentes}
              remainingSeconds={remainingSec}
              onChangePendingAgent={(id) => {
                const updated = { ...pendingTask, agenteId: id };
                pendingRef.current = updated;
                setPendingTask(updated);
              }}
              onUndo={handleUndo}
              onOpenNow={() => void commitPendingNow(true)}
              onDismiss={() => void commitPendingNow(false)}
            />
          )}

          {items.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] bg-[#141414] px-6 py-16 text-center">
              <Sparkles className="mb-4 h-8 w-8 text-[#979797]" />
              <h2 className="max-w-xl text-[28px] font-semibold leading-tight text-white">
                Nenhuma sub-tarefa ativa no momento.
              </h2>
              <p className="mt-2 max-w-lg text-[14px] font-normal text-[#979797]">
                Escolha um especialista abaixo, descreva a entrega para [NOME_DA_MARCA] e inicie uma thread paralela.
              </p>
            </section>
          ) : (
            <div className="space-y-6">
              {sections.map((sec) => {
                if (sec.items.length === 0) return null;
                const isArchivedSec = sec.id === "archived";
                const visibleItems =
                  isArchivedSec && archivedCollapsed
                    ? []
                    : isArchivedSec && !showAllArchived
                      ? sec.items.slice(0, 5)
                      : sec.items;

                return (
                  <section key={sec.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      {isArchivedSec ? (
                        <button
                          type="button"
                          onClick={() => setArchivedCollapsed((c) => !c)}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#979797] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                        >
                          {archivedCollapsed ? (
                            <ChevronRight className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                          <Archive className="h-3 w-3" />
                          <span>
                            {sec.title} ({sec.items.length})
                          </span>
                        </button>
                      ) : (
                        <h2 className="text-[12px] font-semibold text-[#DCDCDC]">
                          {sec.title} ({sec.items.length})
                        </h2>
                      )}

                      {isArchivedSec && archivedCollapsed && (
                        <button
                          type="button"
                          onClick={() => setArchivedCollapsed(false)}
                          className="text-[12px] font-semibold text-[#42A0FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                        >
                          Mostrar arquivadas
                        </button>
                      )}
                    </div>

                    {visibleItems.length > 0 && (
                      <div className="space-y-2">
                        {visibleItems.map((item) => {
                          const visual = resolveAgentVisual(item.agenteId);
                          const isSelected =
                            (item.thread && item.thread.thread_id === activeThreadId) ||
                            (item.tarefa && item.tarefa.tarefa_id === selectedTaskId);
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => void handleOpenItem(item)}
                              className={`flex w-full items-center justify-between gap-4 rounded-xl border bg-[#212121] p-4 text-left transition hover:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                                isSelected ? "border-[#007CF7]" : "border-white/[0.06]"
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-4">
                                <MascoteAvatar
                                  shape={visual.shape}
                                  color={visual.color}
                                  size={28}
                                  mood={item.section === "running" ? "working" : "idle"}
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-[14px] font-semibold text-white">
                                    {item.titulo}
                                  </div>
                                  <div className="truncate text-[12px] font-normal text-[#979797]">
                                    {visual.nome}
                                    {item.progresso ? ` · ${item.progresso}` : ""}
                                  </div>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                {item.section === "running" && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#007CF7]/15 px-2 py-1 text-[12px] font-semibold text-[#42A0FF]">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Executando</span>
                                  </span>
                                )}
                                {item.section === "needs_you" && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#FF9412]/15 px-2 py-1 text-[12px] font-semibold text-[#FF9412]">
                                    <Clock className="h-3 w-3" />
                                    <span>Atenção</span>
                                  </span>
                                )}
                                {item.section === "waiting" && (
                                  <span className="rounded-full bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#979797]">
                                    Na fila
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}

                        {isArchivedSec && !showAllArchived && sec.items.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setShowAllArchived(true)}
                            className="text-[12px] font-semibold text-[#42A0FF] hover:underline"
                          >
                            Ver mais arquivadas ({sec.items.length - 5})
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <TasksSidePanel
        open={panelOpen && Boolean(selectedThread || selectedTask)}
        thread={selectedThread}
        tarefa={selectedTask}
        agente={selectedAgent}
        pagina={panelPage}
        queueSnapshot={panelQueue}
        steps={steps}
        thoughtStream={thoughtStream}
        loading={panelLoading}
        onClose={() => setPanelOpen(false)}
        onOpenInChat={(th) => {
          onOpenInChat?.(th);
        }}
        onToggleArchive={async (th) => {
          if (th.arquivada_em) {
            await daemonApi.reopenThread(th.thread_id);
          } else {
            await daemonApi.archiveThread(th.thread_id);
          }
          await onRefreshThreads?.();
        }}
        onRenameThread={async (threadId, titulo) => {
          await daemonApi.renameThread(threadId, titulo);
          await onRefreshThreads?.();
        }}
        onLoadOlder={async (threadId, cursor) => {
          const older = await daemonApi.readThreadMessages(threadId, {
            limit: 50,
            beforeCursor: cursor,
          });
          setPanelPage((prev) =>
            prev
              ? {
                  ...older,
                  mensagens: [...older.mensagens, ...prev.mensagens],
                  has_newer: prev.has_newer,
                }
              : older
          );
        }}
        onSendMessage={async (threadId, conteudo, anexosMsg) => {
          await daemonApi.sendThreadMessage(threadId, conteudo, anexosMsg);
          await loadPanelDetails(selectedThread);
          await onRefreshThreads?.();
        }}
        onStopThread={async (threadId) => {
          await daemonApi.stopThread(threadId);
          await onRefreshThreads?.();
        }}
        onUploadFile={onUploadFile}
        onApproveTask={onApproveTask}
        onRequestRevision={onRequestRevision}
        onRetryTask={onRetryTask}
        onQueueSteer={async (entregaId) => {
          if (!selectedThread) return;
          await daemonApi.steerChatQueue(selectedThread.agente_id, {
            thread_id: selectedThread.thread_id,
            entrega_id: entregaId,
          });
          await loadPanelDetails(selectedThread);
        }}
        onQueueCancel={async (entregaId) => {
          if (!selectedThread) return;
          await daemonApi.cancelChatQueue(selectedThread.agente_id, {
            thread_id: selectedThread.thread_id,
            entrega_id: entregaId,
          });
          await loadPanelDetails(selectedThread);
        }}
        onQueueReorder={async (ids) => {
          if (!selectedThread) return;
          await daemonApi.reorderChatQueue(selectedThread.agente_id, {
            thread_id: selectedThread.thread_id,
            entrega_ids: ids,
          });
          await loadPanelDetails(selectedThread);
        }}
        onQueueMoveToTask={async (entregaId) => {
          if (!selectedThread) return;
          await daemonApi.runQueuedAsTask(selectedThread.agente_id, {
            thread_id: selectedThread.thread_id,
            entrega_id: entregaId,
          });
          await loadPanelDetails(selectedThread);
          await onRefreshThreads?.();
        }}
      />
    </div>
  );
};
