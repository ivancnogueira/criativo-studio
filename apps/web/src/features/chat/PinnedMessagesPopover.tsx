import React, { useEffect, useRef, useState } from "react";
import type { MensagemFixada } from "@criativo/contracts";
import { Pin, PinOff } from "lucide-react";

export interface PinnedMessagesPopoverProps {
  pins: MensagemFixada[];
  currentThreadId: string;
  onJumpToPin: (pin: MensagemFixada) => Promise<void>;
  onUnpin: (pin: MensagemFixada) => Promise<void>;
  defaultOpen?: boolean;
}

/**
 * Popover Carbon Dark para inspecionar mensagens fixadas (`projecao_mensagens_fixadas`)
 * do chat principal e sub-threads do agente, com salto por `aroundMessageId` e ação `Desafixar mensagem`.
 */
export const PinnedMessagesPopover: React.FC<PinnedMessagesPopoverProps> = ({
  pins,
  currentThreadId,
  onJumpToPin,
  onUnpin,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onOutside = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label="Abrir mensagens fixadas"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
          open
            ? "border-[#007CF7] bg-[#2A2A2A] text-white"
            : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#242424] hover:text-white"
        }`}
      >
        <Pin className="h-3.5 w-3.5" />
        {pins.length > 0 && <span>{pins.length}</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Mensagens fixadas"
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-white/[0.06] bg-[#141414] p-2 shadow-2xl"
        >
          <div className="mb-2 border-b border-white/[0.06] px-2 py-1 text-[14px] font-semibold text-white">
            Mensagens fixadas
          </div>

          {pins.length === 0 ? (
            <div className="p-8 text-center">
              <Pin className="mx-auto mb-2 h-6 w-6 text-[#979797]" />
              <p className="text-[12px] font-normal text-[#979797]">
                Nenhuma mensagem fixada nesta conversa. Use Fixar mensagem no menu de qualquer resposta importante para encontrá-la em um clique.
              </p>
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto p-1">
              {pins.map((pin) => {
                const timeLabel = new Date(pin.criado_em).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const isOtherThread = pin.thread_id !== currentThreadId;
                return (
                  <div
                    key={`${pin.thread_id}:${pin.mensagem_id}`}
                    className="rounded-lg border border-white/[0.06] bg-[#212121] p-2 transition hover:bg-[#242424]"
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        setOpen(false);
                        await onJumpToPin(pin);
                      }}
                      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[12px] font-normal text-[#979797]">
                        <span className="font-semibold text-[#DCDCDC]">{pin.autor_nome}</span>
                        <span>{timeLabel}</span>
                      </div>
                      <p className="line-clamp-2 text-[12px] font-normal text-white">
                        {pin.conteudo_resumo}
                      </p>
                    </button>

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-1">
                      <div className="flex items-center gap-2 text-[12px] font-normal text-[#979797]">
                        <span>
                          {pin.fixado_por_tipo === "usuario"
                            ? "Fixada por você"
                            : "Fixada pelo Criativo"}
                        </span>
                        {isOtherThread && pin.thread_titulo && (
                          <span className="truncate rounded bg-[#141414] px-1 text-[#42A0FF] max-w-[90px]">
                            {pin.thread_titulo}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={busyId === pin.mensagem_id}
                        onClick={async () => {
                          setBusyId(pin.mensagem_id);
                          try {
                            await onUnpin(pin);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded px-1 py-1 text-[12px] font-semibold text-[#979797] hover:text-[#FD2F3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                      >
                        <PinOff className="h-3 w-3" />
                        <span>Desafixar mensagem</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
