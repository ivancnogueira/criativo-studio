import React, { useState } from "react";
import type { FilaChatEntrega } from "@criativo/contracts";
import { ListOrdered, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";

export interface QueuePanelProps {
  entregas: FilaChatEntrega[];
  suportaSteerNativo: boolean;
  onBeginEdit: (entrega: FilaChatEntrega) => Promise<void>;
  onCancelOrDelete: (entregaId: string, deleteAfter?: boolean) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onSteer: (entregaId: string) => Promise<void>;
  onMoveToTask: (entregaId: string) => Promise<void>;
  initialConfirmRemoveId?: string | null;
}

/**
 * Painel interativo de fila granular exibido acima do composer quando há entregas aguardando turno,
 * com suporte a drag-and-drop, reordenação por teclado (`Alt+ArrowUp`/`ArrowDown`), `steer`, edição e mover para tarefa.
 */
export const QueuePanel: React.FC<QueuePanelProps> = ({
  entregas,
  suportaSteerNativo,
  onBeginEdit,
  onCancelOrDelete,
  onReorder,
  onSteer,
  onMoveToTask,
  initialConfirmRemoveId = null,
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(initialConfirmRemoveId);
  const [announcement, setAnnouncement] = useState("");

  const activeItems = entregas.filter(
    (e) => e.status === "enfileirada" || e.status === "iniciando"
  );

  if (activeItems.length === 0) {
    return null;
  }

  const moveIndex = async (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= activeItems.length) return;
    const nextOrder = activeItems.map((item) => item.entrega_id);
    const [moved] = nextOrder.splice(index, 1);
    if (!moved) return;
    nextOrder.splice(nextIndex, 0, moved);
    setAnnouncement(
      `Mensagem movida para a posição ${nextIndex + 1} de ${activeItems.length}`
    );
    await onReorder(nextOrder);
  };

  return (
    <div className="mb-2 space-y-1 rounded-xl border border-white/[0.06] bg-[#212121] p-2">
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      {activeItems.map((item, idx) => (
        <div
          key={item.entrega_id}
          draggable={item.status === "enfileirada"}
          tabIndex={0}
          onDragStart={() => setDraggedId(item.entrega_id)}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            if (!draggedId || draggedId === item.entrega_id) return;
            const ids = activeItems.map((it) => it.entrega_id);
            const fromIdx = ids.indexOf(draggedId);
            const toIdx = ids.indexOf(item.entrega_id);
            if (fromIdx < 0 || toIdx < 0) return;
            const [moved] = ids.splice(fromIdx, 1);
            if (moved) ids.splice(toIdx, 0, moved);
            setDraggedId(null);
            setAnnouncement(`Mensagem movida para a posição ${toIdx + 1} de ${activeItems.length}`);
            await onReorder(ids);
          }}
          onKeyDown={(e) => {
            if (e.altKey && e.key === "ArrowUp") {
              e.preventDefault();
              void moveIndex(idx, -1);
            } else if (e.altKey && e.key === "ArrowDown") {
              e.preventDefault();
              void moveIndex(idx, 1);
            }
          }}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#242424] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ListOrdered className="h-4 w-4 shrink-0 text-[#979797]" />
            {item.anexos.length > 0 && (
              <Paperclip className="h-3 w-3 shrink-0 text-[#979797]" />
            )}
            <span className="truncate text-[12px] font-normal text-[#DCDCDC]">
              {item.conteudo_markdown}
            </span>
            {item.editando && (
              <span className="shrink-0 rounded bg-[#007CF7]/20 px-2 py-1 text-[12px] font-semibold text-[#42A0FF]">
                Editando na caixa
              </span>
            )}
            {item.steer_fallback && (
              <span className="shrink-0 rounded bg-[#FF9412]/15 px-2 py-1 text-[12px] font-semibold text-[#FF9412]">
                Não direcionado
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {confirmRemoveId === item.entrega_id ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmRemoveId(null);
                    void onCancelOrDelete(item.entrega_id, true);
                  }}
                  className="rounded-lg bg-[#FD2F3B]/15 px-2 py-1 text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#FD2F3B]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  Confirmar remoção
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveId(null)}
                  className="rounded-lg bg-[#141414] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  Manter na fila
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void onSteer(item.entrega_id)}
                  className="rounded-lg px-2 py-1 text-[12px] font-semibold text-[#42A0FF] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  {suportaSteerNativo ? "Direcionar agora" : "Enviar agora"}
                </button>

                <button
                  type="button"
                  aria-label="Mover para tarefa"
                  onClick={() => void onMoveToTask(item.entrega_id)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  <Plus className="h-3 w-3" />
                  <span>Mover para tarefa</span>
                </button>

                <button
                  type="button"
                  aria-label="Editar mensagem"
                  onClick={() => void onBeginEdit(item)}
                  className="rounded-lg p-1 text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  <Pencil className="h-3 w-3" />
                  <span className="sr-only">Editar mensagem</span>
                </button>

                <button
                  type="button"
                  aria-label="Remover da fila"
                  onClick={() => {
                    if (item.editando) {
                      setConfirmRemoveId(item.entrega_id);
                    } else {
                      void onCancelOrDelete(item.entrega_id, false);
                    }
                  }}
                  className="rounded-lg p-1 text-[#979797] transition hover:bg-[#2A2A2A] hover:text-[#FD2F3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  <Trash2 className="h-3 w-3" />
                  <span className="sr-only">Remover da fila</span>
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
