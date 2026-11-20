import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgenteRegistro, AvatarShape, MensagemChat } from "@criativo/contracts";
import {
  ArrowUp,
  ExternalLink,
  Pin,
  PinOff,
  Plus,
  Smartphone,
  X,
} from "lucide-react";
import { getDefaultMascotForAgent, MascoteAvatar } from "../../components/MascoteAvatar";
import { daemonApi, WebSocketClient } from "../../services/websocket-client";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";

function renderCompactLine(line: string, keyPrefix: string): React.ReactNode {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${idx}`} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-${idx}`}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-[#E5E5EA]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${idx}`}>{part}</React.Fragment>;
  });
}

function CompactDockMarkdown({ text }: { text: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="space-y-1 break-words">
      {lines.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) return <div key={`sp-${i}`} className="h-1" />;
        const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
        if (heading) {
          return (
            <p key={`h-${i}`} className="font-semibold text-white">
              {renderCompactLine(heading[1]!, `h-${i}`)}
            </p>
          );
        }
        const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <p key={`li-${i}`} className="pl-2 flex gap-1.5">
              <span className="text-[#8E8E93]">•</span>
              <span>{renderCompactLine(bullet[1]!, `li-${i}`)}</span>
            </p>
          );
        }
        return <p key={`p-${i}`}>{renderCompactLine(raw, `p-${i}`)}</p>;
      })}
    </div>
  );
}

export interface FloatingDesktopDockProps {
  initialAgentes?: AgenteRegistro[];
  initialMessagesByAgent?: Record<string, MensagemChat[]>;
  initialSelectedAgentId?: string | null;
  initialPinned?: boolean;
  initialPeeked?: boolean;
  initialSide?: "left" | "right";
}

export const FloatingDesktopDock: React.FC<FloatingDesktopDockProps> = ({
  initialAgentes = [],
  initialMessagesByAgent = {},
  initialSelectedAgentId = null,
  initialPinned = true,
  initialPeeked = false,
  initialSide = "right",
}) => {
  const [agentes, setAgentes] = useState<AgenteRegistro[]>(initialAgentes);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialSelectedAgentId);
  const [side, setSide] = useState<"left" | "right">(initialSide);
  const [dockPinned, setDockPinned] = useState<boolean>(initialPinned);
  const [dockPeeked, setDockPeeked] = useState<boolean>(initialPeeked);
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, MensagemChat[]>>(
    initialMessagesByAgent,
  );
  const [workingAgentIds, setWorkingAgentIds] = useState<Set<string>>(() => new Set());
  const [progressByAgent, setProgressByAgent] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const draggingRef = useRef(false);
  const movedDuringDragRef = useRef(false);
  const dragStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const hidePeekTimerRef = useRef<number | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refreshRoster = useCallback(async () => {
    try {
      const [ags, layout] = await Promise.all([
        daemonApi.listAgents(),
        daemonApi.getSidebarLayout().catch(() => null),
      ]);
      setAgentes(ags);
      if (layout?.pins) setPinnedIds(layout.pins);
    } catch {
      // Ignora erro transitório se daemon ainda estiver inicializando
    }
  }, []);

  const loadAgentMessages = useCallback(async (agenteId: string) => {
    try {
      const msgs = await daemonApi.listAgentMessages(agenteId);
      setMessagesByAgent((prev) => ({
        ...prev,
        [agenteId]: msgs.slice(-30),
      }));
    } catch {
      // ignora erro de leitura
    }
  }, []);

  useEffect(() => {
    if (initialAgentes.length > 0) return;
    void refreshRoster();

    const bridge = getCriativoDesktopBridge();
    void bridge?.dockGetState?.().then((st) => {
      if (st?.side) setSide(st.side);
      if (typeof st?.pinned === "boolean") setDockPinned(st.pinned);
      if (typeof st?.peeked === "boolean") setDockPeeked(st.peeked);
    });

    const unsubDock = bridge?.onDockStateChanged?.((st) => {
      if (st?.side) setSide(st.side);
      if (typeof st?.pinned === "boolean") setDockPinned(st.pinned);
      if (typeof st?.peeked === "boolean") setDockPeeked(st.peeked);
    });

    const ws = new WebSocketClient();
    ws.connect();

    const unsubMsg = ws.on("chat:message", (evt) => {
      if (!evt?.agente_id || !evt?.mensagem) return;
      const agId = evt.agente_id;
      setMessagesByAgent((prev) => {
        const cur = prev[agId] ?? [];
        if (cur.some((m) => m.mensagem_id === evt.mensagem.mensagem_id)) {
          return prev;
        }
        return {
          ...prev,
          [agId]: [...cur, evt.mensagem].slice(-30),
        };
      });
    });

    const unsubProg = ws.on("chat:progress", (evt) => {
      if (!evt?.agente_id) return;
      const agId = evt.agente_id;
      if (evt.fase === "concluido" || evt.fase === "erro") {
        setWorkingAgentIds((prev) => {
          const next = new Set(prev);
          next.delete(agId);
          return next;
        });
        setProgressByAgent((prev) => {
          const next = { ...prev };
          delete next[agId];
          return next;
        });
      } else {
        setWorkingAgentIds((prev) => new Set(prev).add(agId));
        if (evt.mensagem_status) {
          setProgressByAgent((prev) => ({ ...prev, [agId]: evt.mensagem_status! }));
        }
      }
    });

    const unsubSidebar = ws.on("sidebar:updated", () => {
      void refreshRoster();
    });

    return () => {
      if (hidePeekTimerRef.current) window.clearTimeout(hidePeekTimerRef.current);
      unsubDock?.();
      unsubMsg();
      unsubProg();
      unsubSidebar();
      ws.disconnect();
    };
  }, [initialAgentes.length, refreshRoster]);

  useEffect(() => {
    if (selectedAgentId) {
      void loadAgentMessages(selectedAgentId);
    }
  }, [loadAgentMessages, selectedAgentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesByAgent, selectedAgentId]);

  const dockAgents = useMemo(() => {
    const byId = new Map(agentes.map((a) => [a.agente_id, a]));
    const pinned = pinnedIds
      .map((id) => byId.get(id))
      .filter((a): a is AgenteRegistro => Boolean(a));
    if (pinned.length > 0) return pinned.slice(0, 6);
    return agentes.slice(0, 6);
  }, [agentes, pinnedIds]);

  const desiredHeight = useMemo(
    () => Math.max(180, dockAgents.length * 48 + 76),
    [dockAgents.length],
  );

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.dockSetExpanded || selectedAgentId !== null) return;
    void bridge.dockSetExpanded(false, desiredHeight).then((res) => {
      if (res?.side) setSide(res.side);
    });
  }, [desiredHeight, selectedAgentId]);

  const cancelScheduledCollapse = () => {
    if (hidePeekTimerRef.current) {
      window.clearTimeout(hidePeekTimerRef.current);
      hidePeekTimerRef.current = null;
    }
  };

  const handleExpandPeek = async () => {
    cancelScheduledCollapse();
    if (dockPinned || dockPeeked) return;
    setDockPeeked(true);
    const bridge = getCriativoDesktopBridge();
    const res = await bridge?.dockSetPeeked?.(true, desiredHeight);
    if (res?.side) setSide(res.side);
  };

  const handleLeaveDock = () => {
    if (dockPinned || selectedAgentId !== null || draggingRef.current) return;
    cancelScheduledCollapse();
    hidePeekTimerRef.current = window.setTimeout(() => {
      setDockPeeked(false);
      void getCriativoDesktopBridge()?.dockSetPeeked?.(false, desiredHeight);
    }, 180);
  };

  const handleToggleDockPin = async () => {
    if (movedDuringDragRef.current) return;
    const nextPinned = !dockPinned;
    setDockPinned(nextPinned);
    setDockPeeked(nextPinned);
    const bridge = getCriativoDesktopBridge();
    const res = await bridge?.dockSetPinned?.(nextPinned, desiredHeight);
    if (res?.side) setSide(res.side);
  };

  const handleToggleAgentChat = async (agenteId: string) => {
    if (movedDuringDragRef.current) return;
    cancelScheduledCollapse();
    const bridge = getCriativoDesktopBridge();
    const isClosing = selectedAgentId === agenteId;
    const nextSelected = isClosing ? null : agenteId;
    setSelectedAgentId(nextSelected);
    if (nextSelected !== null) setDockPeeked(true);

    if (bridge?.dockSetExpanded) {
      const res = await bridge.dockSetExpanded(nextSelected !== null, desiredHeight);
      if (res?.side) setSide(res.side);
      if (typeof res?.pinned === "boolean") setDockPinned(res.pinned);
      if (typeof res?.peeked === "boolean") setDockPeeked(res.peeked);
    }
  };

  const handleCloseDrawer = async () => {
    setSelectedAgentId(null);
    const bridge = getCriativoDesktopBridge();
    if (bridge?.dockSetExpanded) {
      const res = await bridge.dockSetExpanded(false, desiredHeight);
      if (res?.side) setSide(res.side);
      if (typeof res?.peeked === "boolean") setDockPeeked(res.peeked);
    }
  };

  const beginDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    movedDuringDragRef.current = false;
    dragStartClientRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    void getCriativoDesktopBridge()?.dockStartDrag?.();
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current || !dragStartClientRef.current) return;
    const dx = Math.abs(e.clientX - dragStartClientRef.current.x);
    const dy = Math.abs(e.clientY - dragStartClientRef.current.y);
    if (dx > 4 || dy > 4) {
      movedDuringDragRef.current = true;
    }
    void getCriativoDesktopBridge()?.dockMoveDrag?.();
  };

  const endDrag = async () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragStartClientRef.current = null;
    const res = await getCriativoDesktopBridge()?.dockEndDrag?.();
    if (res?.side) setSide(res.side);
    window.setTimeout(() => {
      movedDuringDragRef.current = false;
    }, 60);
  };

  const selectedAgent = useMemo(
    () => agentes.find((a) => a.agente_id === selectedAgentId) ?? null,
    [agentes, selectedAgentId],
  );

  const selectedMessages = selectedAgent
    ? messagesByAgent[selectedAgent.agente_id] ?? []
    : [];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !draft.trim() || sending) return;
    const content = draft.trim();
    const agId = selectedAgent.agente_id;
    setDraft("");
    setSending(true);

    const optimisticId = `dock-tmp-${Date.now()}`;
    const optimisticMsg: MensagemChat = {
      mensagem_id: optimisticId,
      canal_id: `agente:${agId}`,
      agente_id: agId,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: content,
      anexos: [],
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };
    setMessagesByAgent((prev) => ({
      ...prev,
      [agId]: [...(prev[agId] ?? []), optimisticMsg].slice(-30),
    }));

    try {
      const res = await daemonApi.sendAgentMessage(agId, content, []);
      setMessagesByAgent((prev) => {
        const cleaned = (prev[agId] ?? []).filter((m) => m.mensagem_id !== optimisticId);
        const extras = [res.mensagem_usuario, res.mensagem_agente].filter(
          (x): x is MensagemChat => Boolean(x),
        );
        const byId = new Map(cleaned.map((m) => [m.mensagem_id, m]));
        for (const m of extras) byId.set(m.mensagem_id, m);
        return { ...prev, [agId]: Array.from(byId.values()).slice(-30) };
      });
    } catch {
      // Mantém mensagem otimista visível
    } finally {
      setSending(false);
    }
  };

  const selectedVis = useMemo(() => {
    if (!selectedAgent) return { shape: "blob" as AvatarShape, color: "#38bdf8" };
    const cfg = (selectedAgent.config ?? {}) as Record<string, unknown>;
    const fb = getDefaultMascotForAgent(selectedAgent.agente_id);
    return {
      shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape,
      color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color,
    };
  }, [selectedAgent]);

  const showExpandedPill = dockPinned || dockPeeked || selectedAgent !== null;
  const edgeRoundedClass =
    side === "right" ? "rounded-l-[22px] border-r-0" : "rounded-r-[22px] border-l-0";

  return (
    <div
      data-testid="floating-desktop-dock"
      onMouseEnter={cancelScheduledCollapse}
      onMouseLeave={handleLeaveDock}
      className={`h-screen w-screen bg-transparent flex items-center justify-end p-0 gap-2 select-none overflow-hidden ${
        side === "left" ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {/* Card Flutuante de Chat Inline (limpo, sem halo de sombra DWM) */}
      {selectedAgent && (
        <div
          data-testid="floating-dock-chat-card"
          className="w-[370px] h-[556px] rounded-[20px] border border-white/[0.08] bg-[#0F1012] flex flex-col overflow-hidden text-[#F0F0F0]"
        >
          {/* Header do Card */}
          <div
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => void endDrag()}
            className="h-[46px] shrink-0 px-3.5 border-b border-white/[0.06] flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-2 min-w-0">
              <MascoteAvatar
                shape={selectedVis.shape}
                color={selectedVis.color}
                size={26}
                animated={
                  workingAgentIds.has(selectedAgent.agente_id) ||
                  selectedAgent.status === "trabalhando"
                }
                mood={
                  workingAgentIds.has(selectedAgent.agente_id) ||
                  selectedAgent.status === "trabalhando"
                    ? "working"
                    : "idle"
                }
              />
              <span className="text-[13px] font-semibold truncate">{selectedAgent.nome}</span>
            </div>

            <div
              className="flex items-center gap-1 shrink-0"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title="Abrir na janela principal"
                aria-label="Abrir na janela principal"
                onClick={() =>
                  void getCriativoDesktopBridge()?.openMainWindow?.({
                    agenteId: selectedAgent.agente_id,
                  })
                }
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242429] hover:text-white transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Recolher chat flutuante"
                aria-label="Recolher chat flutuante"
                onClick={() => void handleCloseDrawer()}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242429] hover:text-white transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Lista de mensagens */}
          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5 select-text">
            {selectedMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <MascoteAvatar
                  shape={selectedVis.shape}
                  color={selectedVis.color}
                  size={44}
                  mood="idle"
                />
                <p className="mt-2.5 text-[13px] font-semibold text-white">
                  {selectedAgent.nome}
                </p>
                <p className="mt-1 text-[11.5px] text-[#979797]">
                  Envie uma mensagem rápida sem abrir a janela principal.
                </p>
              </div>
            ) : (
              selectedMessages.map((msg) => {
                const isUser = msg.autor === "usuario";
                const isWpp =
                  (msg.metadados as Record<string, unknown> | undefined)?.origem === "whatsapp";
                return (
                  <div
                    key={msg.mensagem_id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${
                        isUser
                          ? "bg-[#262629] text-white border border-white/[0.08]"
                          : "bg-[#1A1B1F] text-[#E8E8ED] border border-white/[0.05]"
                      }`}
                    >
                      {isWpp && (
                        <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#31CF76]">
                          <Smartphone className="h-2.5 w-2.5" />
                          <span>WhatsApp</span>
                        </div>
                      )}
                      {isUser ? (
                        <p className="whitespace-pre-wrap break-words">{msg.conteudo_markdown}</p>
                      ) : (
                        <CompactDockMarkdown text={msg.conteudo_markdown} />
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {(workingAgentIds.has(selectedAgent.agente_id) ||
              progressByAgent[selectedAgent.agente_id]) && (
              <div className="flex items-center gap-2 text-[11.5px] text-[#979797] px-1">
                <span className="h-2 w-2 rounded-full bg-[#31CF76] animate-pulse" />
                <span className="truncate">
                  {progressByAgent[selectedAgent.agente_id] || "Processando resposta..."}
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input de envio rápido */}
          <form
            onSubmit={(e) => void handleSendMessage(e)}
            className="shrink-0 p-3 pt-2 border-t border-white/[0.06] bg-[#121316]"
          >
            <div className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#1C1C20] px-3 py-1.5 focus-within:border-[#007CF7]">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Mensagem para ${selectedAgent.nome}`}
                className="flex-1 min-w-0 bg-transparent text-[12.5px] text-white outline-none placeholder:text-[#7E7E85]"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label={`Enviar para ${selectedAgent.nome}`}
                className="h-7 w-7 rounded-full bg-[#F0F0F0] hover:bg-white text-[#141414] flex items-center justify-center transition disabled:opacity-35 shrink-0"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lingueta discreta colada à borda quando configurada para recolher */}
      {!showExpandedPill ? (
        <button
          type="button"
          data-testid="floating-dock-peek-handle"
          aria-label="Expandir ilha de agentes"
          title="Expandir ilha de agentes"
          onMouseEnter={() => void handleExpandPeek()}
          onClick={() => void handleExpandPeek()}
          className={`h-24 w-4 ${edgeRoundedClass} border border-white/[0.07] bg-[#0E0F12] flex items-center justify-center hover:w-5 transition-all cursor-pointer`}
        >
          <span className="h-9 w-1 rounded-full bg-[#42A0FF]/70" />
        </button>
      ) : (
        /* Aba Lateral Limpa colada à borda (sem barra de nome, sem grip ruidoso e sem sombra difusa) */
        <div
          ref={pillRef}
          data-testid="floating-dock-pill"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => void endDrag()}
          className={`w-[62px] ${edgeRoundedClass} border border-white/[0.06] bg-[#0E0F12] py-2.5 px-1.5 flex flex-col items-center gap-2 cursor-grab active:cursor-grabbing`}
        >
          <div className="flex flex-col items-center gap-1.5">
            {dockAgents.map((ag) => {
              const cfg = (ag.config ?? {}) as Record<string, unknown>;
              const fb = getDefaultMascotForAgent(ag.agente_id);
              const shape = (typeof cfg.avatar_shape === "string"
                ? cfg.avatar_shape
                : fb.shape) as AvatarShape;
              const color = typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color;
              const working = workingAgentIds.has(ag.agente_id) || ag.status === "trabalhando";
              const isSelected = selectedAgentId === ag.agente_id;

              return (
                <button
                  key={ag.agente_id}
                  type="button"
                  title={ag.nome}
                  aria-label={`Conversar com ${ag.nome}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(e);
                  }}
                  onPointerMove={moveDrag}
                  onPointerUp={() => void endDrag()}
                  onClick={() => void handleToggleAgentChat(ag.agente_id)}
                  className={`relative rounded-xl p-1 transition-colors ${
                    isSelected ? "bg-[#007CF7]/20 ring-1 ring-[#007CF7]" : "hover:bg-white/[0.06]"
                  }`}
                >
                  <MascoteAvatar
                    shape={shape}
                    color={color}
                    size={34}
                    animated={working}
                    mood={working ? "working" : "idle"}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            title="Criar novo agente"
            aria-label="Criar novo agente"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() =>
              void getCriativoDesktopBridge()?.openMainWindow?.({ action: "new-agent" })
            }
            className="h-8 w-8 rounded-xl flex items-center justify-center text-[#9A9AA2] hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>

          <button
            type="button"
            data-testid="floating-dock-pin-toggle"
            title={dockPinned ? "Recolher ilha na borda" : "Manter ilha fixa na borda"}
            aria-label={dockPinned ? "Recolher ilha na borda" : "Manter ilha fixa na borda"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleToggleDockPin()}
            className="h-6 w-6 rounded-lg flex items-center justify-center text-[#7E7E85] hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            {dockPinned ? (
              <PinOff className="h-3 w-3" />
            ) : (
              <Pin className="h-3 w-3 text-[#42A0FF]" />
            )}
          </button>
        </div>
      )}
    </div>
  );
};
