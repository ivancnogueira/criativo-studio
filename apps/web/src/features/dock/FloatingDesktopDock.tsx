import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  MensagemChat,
  StudioDockSettings,
} from "@criativo/contracts";
import {
  ArrowUp,
  Check,
  ExternalLink,
  Pin,
  PinOff,
  Plus,
  Settings,
  Smartphone,
  X,
} from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { daemonApi, WebSocketClient } from "../../services/websocket-client";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";
import {
  DEFAULT_FRONTEND_DOCK_SETTINGS,
  resolveEffectiveDockAgentIds,
} from "../settings/SettingsGeneralTabs";

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
  const [dockSettings, setDockSettings] = useState<StudioDockSettings>(
    DEFAULT_FRONTEND_DOCK_SETTINGS,
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialSelectedAgentId);
  const [pickerOpen, setPickerOpen] = useState(false);
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
      const [ags, layout, settings] = await Promise.all([
        daemonApi.listAgents(),
        daemonApi.getSidebarLayout().catch(() => null),
        daemonApi.getUserSettings().catch(() => null),
      ]);
      setAgentes(ags);
      if (layout?.pins) setPinnedIds(layout.pins);
      if (settings?.dock) {
        setDockSettings({ ...DEFAULT_FRONTEND_DOCK_SETTINGS, ...settings.dock });
      }
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

    const unsubLicense = ws.on("license:updated", () => {
      void refreshRoster();
    });

    const unsubServers = ws.on("servers:updated", () => {
      void refreshRoster();
    });

    const unsubSettings = ws.on("settings:updated", () => {
      void daemonApi
        .getUserSettings()
        .then((settings) => {
          if (settings?.dock) {
            setDockSettings({ ...DEFAULT_FRONTEND_DOCK_SETTINGS, ...settings.dock });
          }
        })
        .catch(() => {});
    });

    const unsubStatus = ws.onConnectionChange((connected) => {
      if (connected) {
        void refreshRoster();
      }
    });

    const handleFocus = () => {
      void refreshRoster();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      if (hidePeekTimerRef.current) window.clearTimeout(hidePeekTimerRef.current);
      unsubDock?.();
      unsubMsg();
      unsubProg();
      unsubSidebar();
      unsubLicense();
      unsubServers();
      unsubSettings();
      unsubStatus();
      window.removeEventListener("focus", handleFocus);
      ws.disconnect();
    };
  }, [initialAgentes.length, refreshRoster]);

  useEffect(() => {
    if (initialAgentes.length > 0 || agentes.length > 0) return;
    const retryTimer = window.setInterval(() => {
      void refreshRoster();
    }, 2500);
    return () => window.clearInterval(retryTimer);
  }, [agentes.length, initialAgentes.length, refreshRoster]);

  useEffect(() => {
    if (selectedAgentId) {
      void loadAgentMessages(selectedAgentId);
    }
  }, [loadAgentMessages, selectedAgentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesByAgent, selectedAgentId]);

  const eligibleAgents = useMemo(() => {
    const visible = agentes.filter(
      (a) =>
        !a.hidden &&
        (a.config as Record<string, unknown> | undefined)?.upgrade_desbloqueado !== false,
    );
    return visible.length > 0 ? visible : agentes;
  }, [agentes]);

  const includedIds = useMemo(
    () => resolveEffectiveDockAgentIds(eligibleAgents, dockSettings.agentes_ids, pinnedIds),
    [eligibleAgents, dockSettings.agentes_ids, pinnedIds],
  );

  const dockAgents = useMemo(() => {
    const byId = new Map(eligibleAgents.map((a) => [a.agente_id, a]));
    const base = includedIds
      .map((id) => byId.get(id))
      .filter((a): a is AgenteRegistro => Boolean(a));
    if (!dockSettings.mostrar_agentes_com_novidades) {
      return base;
    }
    const baseSet = new Set(base.map((a) => a.agente_id));
    const withNews = eligibleAgents.filter(
      (a) =>
        !baseSet.has(a.agente_id) &&
        (workingAgentIds.has(a.agente_id) || a.status === "trabalhando"),
    );
    return [...base, ...withNews];
  }, [eligibleAgents, includedIds, dockSettings.mostrar_agentes_com_novidades, workingAgentIds]);

  const scaleFactor = useMemo(
    () => Math.max(0.8, Math.min(1.5, (dockSettings.tamanho_percentual ?? 100) / 100)),
    [dockSettings.tamanho_percentual],
  );

  const desiredHeight = useMemo(
    () => Math.max(180, Math.round((dockAgents.length * 46 + 86) * scaleFactor)),
    [dockAgents.length, scaleFactor],
  );

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.dockSetExpanded || selectedAgentId !== null || pickerOpen) return;
    void bridge.dockSetExpanded(false, desiredHeight).then((res) => {
      if (res?.side) setSide(res.side);
    });
  }, [desiredHeight, pickerOpen, selectedAgentId]);

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
    if (dockPinned || selectedAgentId !== null || pickerOpen || draggingRef.current) return;
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
    setPickerOpen(false);
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

  const handleToggleAgentPicker = async () => {
    if (movedDuringDragRef.current) return;
    cancelScheduledCollapse();
    const nextOpen = !pickerOpen;
    setPickerOpen(nextOpen);
    if (nextOpen) {
      setSelectedAgentId(null);
      setDockPeeked(true);
    }
    const bridge = getCriativoDesktopBridge();
    if (bridge?.dockSetExpanded) {
      const res = await bridge.dockSetExpanded(nextOpen, desiredHeight);
      if (res?.side) setSide(res.side);
      if (typeof res?.pinned === "boolean") setDockPinned(res.pinned);
      if (typeof res?.peeked === "boolean") setDockPeeked(res.peeked);
    }
  };

  const handleToggleAgentInDock = async (agenteId: string, included: boolean) => {
    const baseIds = Array.isArray(dockSettings.agentes_ids)
      ? [...dockSettings.agentes_ids]
      : [...includedIds];
    const nextIds = included
      ? Array.from(new Set([...baseIds, agenteId]))
      : baseIds.filter((id) => id !== agenteId);
    const nextDockSettings: StudioDockSettings = {
      ...dockSettings,
      agentes_ids: nextIds,
    };
    setDockSettings(nextDockSettings);
    try {
      await daemonApi.updateUserSettings({ dock: nextDockSettings });
    } catch {
      // mantém estado local até próxima sincronização
    }
  };

  const handleCloseDrawer = async () => {
    setSelectedAgentId(null);
    setPickerOpen(false);
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
    return resolveAgentAvatarConfig(selectedAgent, selectedAgent?.agente_id ?? "estrategista");
  }, [selectedAgent]);

  const showExpandedPill = dockPinned || dockPeeked || selectedAgent !== null || pickerOpen;
  const edgeRoundedClass =
    side === "right" ? "rounded-l-[22px] border-r-0" : "rounded-r-[22px] border-l-0";
  const avatarSizePx = Math.max(26, Math.min(48, Math.round(34 * scaleFactor)));
  const pillWidthPx = Math.max(52, Math.min(92, Math.round(62 * scaleFactor)));

  return (
    <div
      data-testid="floating-desktop-dock"
      onMouseEnter={cancelScheduledCollapse}
      onMouseLeave={handleLeaveDock}
      className={`h-screen w-screen bg-transparent flex items-center justify-end p-0 gap-2 select-none overflow-hidden ${
        side === "left" ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {/* Seletor de agentes existentes no dock (+) */}
      {pickerOpen && !selectedAgent && (
        <div
          data-testid="floating-dock-agent-picker"
          onPointerDown={(e) => e.stopPropagation()}
          className="w-[300px] max-h-[440px] rounded-[20px] border border-white/[0.08] bg-[#0F1012] flex flex-col overflow-hidden text-[#F0F0F0]"
        >
          <div className="h-[46px] shrink-0 px-3.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold text-white leading-tight">
                Agentes no dock
              </div>
              <div className="text-[10.5px] text-[#8E8E93]">
                Adicionar ou remover agentes existentes
              </div>
            </div>
            <button
              type="button"
              title="Fechar seletor"
              aria-label="Fechar seletor de agentes"
              onClick={() => void handleCloseDrawer()}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#242429] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {eligibleAgents.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-[#8E8E93]">
                Nenhum agente disponível neste servidor.
              </div>
            ) : (
              eligibleAgents.map((ag) => {
                const vis = resolveAgentAvatarConfig(ag);
                const included = includedIds.includes(ag.agente_id);
                return (
                  <button
                    key={ag.agente_id}
                    type="button"
                    onClick={() => void handleToggleAgentInDock(ag.agente_id, !included)}
                    className="w-full flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white/[0.06] transition-colors text-left"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <MascoteAvatar
                        avatar={vis}
                        agentKey={ag.agente_id}
                        size={28}
                        hoverAnimate={false}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium text-white truncate">
                          {ag.nome}
                        </span>
                        <span className="block text-[10.5px] text-[#8E8E93] truncate">
                          {ag.papel}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        included
                          ? "border-[#007CF7] bg-[#007CF7] text-white"
                          : "border-white/20 bg-transparent text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              void getCriativoDesktopBridge()?.openMainWindow?.({ action: "open-dock-settings" })
            }
            className="shrink-0 px-3.5 py-2.5 border-t border-white/[0.06] bg-[#141519] hover:bg-[#1D1E24] text-[12px] font-medium text-[#A8A8B2] hover:text-white flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings className="h-3.5 w-3.5" />
              <span>Configurações do dock</span>
            </span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
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
                avatar={selectedVis}
                agentKey={selectedAgent.agente_id}
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
                activity={progressByAgent[selectedAgent.agente_id] ?? null}
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
                  avatar={selectedVis}
                  agentKey={selectedAgent.agente_id}
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
          className={`h-24 ${
            dockSettings.mostrar_faixa_borda !== false
              ? "w-4 border border-white/[0.07] bg-[#0E0F12] hover:w-5"
              : "w-2 border-transparent bg-transparent opacity-10 hover:opacity-100 hover:w-4 hover:bg-[#0E0F12]"
          } ${edgeRoundedClass} flex items-center justify-center transition-all cursor-pointer`}
        >
          {dockSettings.mostrar_faixa_borda !== false && (
            <span
              className={`h-9 w-1 rounded-full ${
                workingAgentIds.size > 0 ? "bg-[#31CF76] animate-pulse" : "bg-[#42A0FF]/70"
              }`}
            />
          )}
        </button>
      ) : (
        /* Aba Lateral Limpa colada à borda (sem barra de nome, sem grip ruidoso e sem sombra difusa) */
        <div
          ref={pillRef}
          data-testid="floating-dock-pill"
          style={{ width: `${pillWidthPx}px` }}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => void endDrag()}
          className={`${edgeRoundedClass} border border-white/[0.06] bg-[#0E0F12] py-2.5 px-1.5 flex flex-col items-center gap-2 cursor-grab active:cursor-grabbing`}
        >
          <div className="flex flex-col items-center gap-1.5">
            {dockAgents.map((ag) => {
              const vis = resolveAgentAvatarConfig(ag);
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
                    avatar={vis}
                    agentKey={ag.agente_id}
                    size={avatarSizePx}
                    animated={working}
                    mood={working ? "working" : "idle"}
                    activity={progressByAgent[ag.agente_id] ?? null}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            data-testid="floating-dock-add-agents-btn"
            title="Adicionar agentes ao dock"
            aria-label="Adicionar agentes ao dock"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleToggleAgentPicker()}
            className={`h-8 w-8 rounded-xl flex items-center justify-center transition-colors ${
              pickerOpen
                ? "bg-[#007CF7]/25 text-white ring-1 ring-[#007CF7]"
                : "text-[#9A9AA2] hover:bg-white/[0.06] hover:text-white"
            }`}
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
