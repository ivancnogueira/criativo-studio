import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgenteRegistro,
  MensagemChat,
  StudioDockSettings,
} from "@criativo/contracts";
import {
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  subscribeActiveServerChanges,
  WebSocketClient,
} from "../../services/websocket-client";
import {
  getCriativoDesktopBridge,
} from "../../types/desktop-bridge";
import {
  DEFAULT_FRONTEND_DOCK_SETTINGS,
  resolveEffectiveDockAgentIds,
} from "../settings/SettingsGeneralTabs";
import type { FloatingDesktopDockProps } from "./floating-dock-helpers";

export function useFloatingDockController(props: FloatingDesktopDockProps) {
  const {
  initialAgentes = [],
  initialMessagesByAgent = {},
  initialSelectedAgentId = null,
  initialPinned = true,
  initialPeeked = false,
  initialSide = "right",
} = props;
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
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [activeServerName, setActiveServerName] = useState("Servidor Principal");

  const wsRef = useRef<WebSocketClient | null>(null);
  const draggingRef = useRef(false);
  const movedDuringDragRef = useRef(false);
  const dragStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const hidePeekTimerRef = useRef<number | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refreshRoster = useCallback(async (opts?: { syncServer?: boolean }) => {
    try {
      const srvSnap = opts?.syncServer === false ? null : await daemonApi.listarServidores().catch(() => null);
      if (srvSnap) {
        const targetSid = srvSnap.active_server_id || "primary";
        const matchedSrv = srvSnap.servers.find((s) => s.server_id === targetSid);
        if (matchedSrv?.nome) {
          setActiveServerName(matchedSrv.nome);
        }
        if (targetSid !== getActiveServerId()) {
          setActiveServerId(targetSid);
          wsRef.current?.reconnectForServer(targetSid);
          setSelectedAgentId(null);
        }
      }

      let ags: AgenteRegistro[];
      let layout: Awaited<ReturnType<typeof daemonApi.getSidebarLayout>> | null = null;
      let settings: Awaited<ReturnType<typeof daemonApi.getUserSettings>> | null = null;

      try {
        [ags, layout, settings] = await Promise.all([
          daemonApi.listAgents(),
          daemonApi.getSidebarLayout().catch(() => null),
          daemonApi.getUserSettings().catch(() => null),
        ]);
      } catch (agentErr) {
        const curSid = getActiveServerId();
        if (curSid !== "primary") {
          const checkSnap = srvSnap ?? (await daemonApi.listarServidores().catch(() => null));
          const exists = checkSnap?.servers?.some((s) => s.server_id === curSid);
          const fallbackSid = checkSnap?.active_server_id && checkSnap.active_server_id !== curSid
            ? checkSnap.active_server_id
            : "primary";
          if (!exists || checkSnap?.active_server_id === "primary") {
            setActiveServerId(fallbackSid);
            wsRef.current?.reconnectForServer(fallbackSid);
            [ags, layout, settings] = await Promise.all([
              daemonApi.listAgents(),
              daemonApi.getSidebarLayout().catch(() => null),
              daemonApi.getUserSettings().catch(() => null),
            ]);
          } else {
            throw agentErr;
          }
        } else {
          throw agentErr;
        }
      }

      setRosterError(null);
      setAgentes(ags);
      setPinnedIds(layout?.pins ?? []);
      setDockSettings(
        settings?.dock ? { ...DEFAULT_FRONTEND_DOCK_SETTINGS, ...settings.dock } : DEFAULT_FRONTEND_DOCK_SETTINGS,
      );
      setSelectedAgentId((prev) =>
        prev && ags.some((a) => a.agente_id === prev) ? prev : null,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setRosterError(
        msg || "Não foi possível carregar os agentes deste servidor.",
      );
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
    wsRef.current = ws;
    ws.connect();

    const unsubActiveStorage = subscribeActiveServerChanges((nextServerId) => {
      if (nextServerId !== getActiveServerId()) {
        setActiveServerId(nextServerId);
      }
      ws.reconnectForServer(nextServerId);
      setSelectedAgentId(null);
      void refreshRoster({ syncServer: true });
    });

    const unsubDockServer = bridge?.onDockActiveServerChanged?.((nextServerId) => {
      setActiveServerId(nextServerId);
      ws.reconnectForServer(nextServerId);
      setSelectedAgentId(null);
      void refreshRoster({ syncServer: true });
    });

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

    const unsubServers = ws.on("servers:updated", (evt) => {
      const targetSid = evt?.active_server_id || "primary";
      const matched = evt?.servers?.find((s) => s.server_id === targetSid);
      if (matched?.nome) {
        setActiveServerName(matched.nome);
      }
      if (targetSid !== getActiveServerId()) {
        setActiveServerId(targetSid);
        ws.reconnectForServer(targetSid);
        setSelectedAgentId(null);
      }
      void refreshRoster({ syncServer: false });
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
      unsubActiveStorage();
      unsubDockServer?.();
      unsubMsg();
      unsubProg();
      unsubSidebar();
      unsubLicense();
      unsubServers();
      unsubSettings();
      unsubStatus();
      window.removeEventListener("focus", handleFocus);
      ws.disconnect();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
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
      void refreshRoster();
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


  return {
    initialAgentes,
    initialMessagesByAgent,
    initialSelectedAgentId,
    initialPinned,
    initialPeeked,
    initialSide,
    agentes,
    setAgentes,
    pinnedIds,
    setPinnedIds,
    dockSettings,
    setDockSettings,
    selectedAgentId,
    setSelectedAgentId,
    pickerOpen,
    setPickerOpen,
    side,
    setSide,
    dockPinned,
    setDockPinned,
    dockPeeked,
    setDockPeeked,
    messagesByAgent,
    setMessagesByAgent,
    workingAgentIds,
    setWorkingAgentIds,
    progressByAgent,
    setProgressByAgent,
    draft,
    setDraft,
    sending,
    setSending,
    rosterError,
    setRosterError,
    activeServerName,
    setActiveServerName,
    wsRef,
    draggingRef,
    movedDuringDragRef,
    dragStartClientRef,
    hidePeekTimerRef,
    pillRef,
    messagesEndRef,
    refreshRoster,
    loadAgentMessages,
    eligibleAgents,
    includedIds,
    dockAgents,
    scaleFactor,
    desiredHeight,
    cancelScheduledCollapse,
    handleExpandPeek,
    handleLeaveDock,
    handleToggleDockPin,
    handleToggleAgentChat,
    handleToggleAgentPicker,
    handleToggleAgentInDock,
    handleCloseDrawer,
    beginDrag,
    moveDrag,
    endDrag,
    selectedAgent,
    selectedMessages,
    handleSendMessage,
    selectedVis,
    showExpandedPill,
    edgeRoundedClass,
    avatarSizePx,
    pillWidthPx,
  };
}

export type FloatingDockController = ReturnType<typeof useFloatingDockController>;
