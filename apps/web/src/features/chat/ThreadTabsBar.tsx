import React from "react";
import type { AgenteThreadRegistro } from "@criativo/contracts";
import { Loader2, Plus, X } from "lucide-react";

export interface ThreadTabsBarProps {
  threads: AgenteThreadRegistro[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onStartNewTaskTab: () => void;
  onDismissThreadTab?: (threadId: string) => void;
}

/**
 * Faixa horizontal de abas abaixo da barra principal permitindo navegar entre
 * a Conversa principal e as sub-threads paralelas abertas do agente.
 */
export const ThreadTabsBar: React.FC<ThreadTabsBarProps> = ({
  threads,
  activeThreadId,
  onSelectThread,
  onStartNewTaskTab,
  onDismissThreadTab,
}) => {
  const openThreads = threads.filter((t) => !t.arquivada_em);

  return (
    <nav
      aria-label="Sub-threads da conversa"
      className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-white/[0.06] bg-[#0D0D0D] px-4"
    >
      <button
        type="button"
        onClick={() => onSelectThread(null)}
        className={`shrink-0 rounded-lg border px-4 py-1 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
          activeThreadId === null
            ? "border-[#007CF7] bg-[#1A1A1A] text-white"
            : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#242424]"
        }`}
      >
        Conversa principal
      </button>

      {openThreads.map((th) => {
        const isActive = activeThreadId === th.thread_id;
        const isRunning = th.estado === "executando" || th.turno_ativo_id !== null;
        const isUnread = th.desfecho !== null && !th.ultima_mensagem_lida_id;

        return (
          <div
            key={th.thread_id}
            className={`group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 transition ${
              isActive
                ? "border-[#007CF7] bg-[#1A1A1A] text-white"
                : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#242424]"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectThread(th.thread_id)}
              className="flex max-w-[180px] items-center gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#007CF7]" />
              ) : (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    isUnread
                      ? "bg-[#007CF7]"
                      : th.desfecho === "falha"
                        ? "bg-[#FD2F3B]"
                        : th.desfecho === "concluida"
                          ? "bg-[#31CF76]"
                          : "bg-[#979797]"
                  }`}
                />
              )}
              <span className="truncate text-[12px] font-semibold">{th.titulo}</span>
            </button>

            {onDismissThreadTab && (
              <button
                type="button"
                aria-label={`Recolher aba ${th.titulo}`}
                onClick={() => onDismissThreadTab(th.thread_id)}
                className="rounded p-1 text-[#979797] opacity-80 hover:bg-[#2A2A2A] hover:text-white group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onStartNewTaskTab}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-white/[0.06] bg-transparent px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#212121] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
      >
        <Plus className="h-3 w-3" />
        <span>Novo tópico</span>
      </button>
    </nav>
  );
};
