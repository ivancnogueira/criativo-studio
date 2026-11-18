import React, { useEffect, useState } from "react";
import type { AgenteEspera } from "@criativo/contracts";
import { ChevronDown, ChevronRight, Clock, Loader2, MoreHorizontal } from "lucide-react";

export interface OpenWaitsCardProps {
  esperas: AgenteEspera[];
  onViewOriginPedido: (espera: AgenteEspera) => void;
  onCloseWait: (esperaId: string) => Promise<void>;
}

/**
 * Card colapsável exibido acima do composer no chat quando há esperas longas (`agent_waits`) abertas.
 */
export const OpenWaitsCard: React.FC<OpenWaitsCardProps> = ({
  esperas,
  onViewOriginPedido,
  onCloseWait,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuId || typeof window === "undefined") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpenMenuId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMenuId]);

  if (esperas.length === 0) {
    return null;
  }

  const wokenCount = esperas.filter((e) => e.estado === "woken" || e.despertada_em !== null).length;

  return (
    <div className="mb-2 rounded-xl border border-white/[0.06] bg-[#212121] px-4 py-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[#979797]" />
          <span className="text-[12px] font-semibold text-white">
            Esperas abertas ({esperas.length})
          </span>
          {wokenCount > 0 && (
            <span className="rounded bg-[#FF9412]/15 px-2 py-1 text-[12px] font-semibold text-[#FF9412]">
              {wokenCount} despertada{wokenCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[#979797]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#979797]" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-white/[0.06] pt-2">
          {esperas.map((wait) => {
            const visualState =
              wait.estado ?? (wait.despertada_em ? "woken" : "waiting");
            const timeLabel = new Date(wait.criado_em).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={wait.espera_id}
                className="relative flex items-start justify-between gap-2 rounded-lg bg-[#242424] p-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {visualState === "resuming" ? (
                      <Loader2 className="h-3 w-3 animate-spin text-[#007CF7]" />
                    ) : (
                      <span
                        className={`h-2 w-2 rounded-full ${
                          visualState === "woken" ? "bg-[#FF9412]" : "bg-[#979797]"
                        }`}
                      />
                    )}
                    <span className="text-[12px] font-semibold text-[#DCDCDC]">
                      {visualState === "resuming"
                        ? "Retomando agora"
                        : visualState === "woken"
                          ? "Despertada — ainda aberta"
                          : "Aguardando evento"}
                    </span>
                    <span className="text-[12px] font-normal text-[#979797]">· {timeLabel}</span>
                  </div>

                  <p className="text-[14px] font-normal text-white">{wait.nota}</p>
                  <p className="truncate text-[12px] font-normal text-[#979797]">
                    Pedido: {wait.pedido_texto}
                  </p>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    aria-label="Abrir opções da espera"
                    onClick={() =>
                      setOpenMenuId((cur) => (cur === wait.espera_id ? null : wait.espera_id))
                    }
                    className="rounded-lg p-1 text-[#979797] transition hover:bg-[#2A2A2A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {openMenuId === wait.espera_id && (
                    <div
                      role="dialog"
                      aria-label="Opções da espera"
                      className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-white/[0.06] bg-[#141414] p-1 shadow-xl"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          onViewOriginPedido(wait);
                        }}
                        className="block w-full rounded-lg px-2 py-2 text-left text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
                      >
                        Ver pedido
                      </button>
                      <button
                        type="button"
                        disabled={closingId === wait.espera_id}
                        onClick={async () => {
                          setClosingId(wait.espera_id);
                          setOpenMenuId(null);
                          try {
                            await onCloseWait(wait.espera_id);
                          } finally {
                            setClosingId(null);
                          }
                        }}
                        className="block w-full rounded-lg px-2 py-2 text-left text-[12px] font-semibold text-[#FD2F3B] hover:bg-[#242424]"
                      >
                        Encerrar espera
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
