import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteEspera,
  AgenteRegistro,
  AgenteThreadBranch,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  ArquivoStudio,
  AvatarShape,
  BackupModelChoice,
  BibliotecasPastasSnapshot,
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserSecretRequest,
  BrowserStatusReport,
  BrowserTabSummary,
  BrowserTakeoverSession,
  CanalEquipe,
  CaptureScreenConsentRequest,
  ConectorIntegracaoInfo,
  DeletedNativeAgentInfo,
  FilaChatEntrega,
  FilaChatSnapshot,
  HabilidadeInstaladaInfo,
  LicenseActivationStatus,
  MensagemChat,
  MensagemFixada,
  NivelEsforco,
  OnboardingEstado,
  PacoteUpgradeInfo,
  PaginaConversaThread,
  PassoChat,
  ProvedorStatusInfo,
  ProviderName,
  RelatorioAnalyticsHost,
  ServerClaimTicket,
  ServerQuotaSummary,
  ShowcaseSiteSummary,
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  StatusMensageria,
  StorageUsageSnapshot,
  StudioServerRecord,
  StudioUserSettings,
  TarefaRegistro,
  UiBlockSubmitPayload,
  UpdateStatusSnapshot,
  UsageLimitAskPayload,
  UserBrowsingStep,
  UsoProvedoresSnapshot,
  WhatsAppContaResumo,
  WhatsNewReleaseInfo,
  WorkflowAresta,
  WorkflowNo,
  WorkflowVisual,
} from "@criativo/contracts";
import { DynamicIsland, type StudioTabItem } from "../components/DynamicIsland";
import { getCriativoDesktopBridge } from "../types/desktop-bridge";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import { getAgentAvatar, mergeUniqueMessages, type AgentCenterMode, type AgenteEnriquecido } from "../utils/studio-storage";
import type { StudioAppState } from "./useStudioState";
import type { StudioBootstrapActions } from "./useStudioBootstrap";

export function useStudioTabsAndNavigation(
  state: StudioAppState,
  boot: StudioBootstrapActions
) {
  const {
    setActiveSection,
    centerMode,
    setCenterMode,
    agentes,
    setAgentes,
    canais,
    setOpenTabs,
    activeTabId,
    setActiveTabId,
    setDeletedNativeAgents,
    setActiveSideThreadId,
    threadsByAgent,
    allThreads,
    setAllThreads,
    setThreadChatById,
    setActiveThreadIdByAgent,
    userSettings,
    setSidebarLayout,
    openSettings,
    navHistoryRef,
    navIndexRef,
  } = state;
  const { refreshAgentThreadsState } = boot;

  const pushNavHistory = useCallback((mode: AgentCenterMode) => {
    const hist = navHistoryRef.current;
    const cur = hist[navIndexRef.current];
    const same =
      cur &&
      cur.type === mode.type &&
      ("agenteId" in cur && "agenteId" in mode ? cur.agenteId === mode.agenteId : true) &&
      ("threadId" in cur && "threadId" in mode ? cur.threadId === mode.threadId : true) &&
      ("canalId" in cur && "canalId" in mode ? cur.canalId === mode.canalId : true);
    if (same) return;
    const nextHist = hist.slice(0, navIndexRef.current + 1);
    nextHist.push(mode);
    if (nextHist.length > 40) nextHist.shift();
    navHistoryRef.current = nextHist;
    navIndexRef.current = nextHist.length - 1;
  }, []);

  const ensureAndActivateTab = useCallback(
    (tab: StudioTabItem, mode: AgentCenterMode) => {
      setOpenTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
      setActiveTabId(tab.id);
      setCenterMode(mode);
      setActiveSection("agentes");
      pushNavHistory(mode);
    },
    [pushNavHistory]
  );

  const handleSelectAgent = useCallback(
    (agenteId: string) => {
      setActiveSideThreadId(null);
      setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: null }));
      const ag = agentes.find((a) => a.agente_id === agenteId);
      const vis = getAgentAvatar(ag);
      ensureAndActivateTab(
        { id: `agent:${agenteId}`, titulo: ag?.nome ?? agenteId, shape: vis.shape, color: vis.color },
        { type: "agent", agenteId }
      );
    },
    [agentes, ensureAndActivateTab]
  );

  const handleDeleteAgent = useCallback(
    async (agenteId: string) => {
      await daemonApi.deleteAgent(agenteId);
      const [nextAgents, nextDeleted, nextLayout] = await Promise.all([
        daemonApi.listAgents(),
        daemonApi.listDeletedNativeAgents().catch(() => [] as DeletedNativeAgentInfo[]),
        daemonApi.getSidebarLayout().catch(() => null),
      ]);
      setAgentes(nextAgents);
      setDeletedNativeAgents(nextDeleted);
      if (nextLayout) setSidebarLayout(nextLayout);
      setOpenTabs((prev) =>
        prev.filter((t) => t.id !== `agent:${agenteId}` && !t.id.startsWith(`thread:${agenteId}:`))
      );
      if (
        (centerMode.type === "agent" || centerMode.type === "thread") &&
        centerMode.agenteId === agenteId
      ) {
        const nextAg = nextAgents[0];
        if (nextAg) {
          const vis = getAgentAvatar(nextAg);
          ensureAndActivateTab(
            { id: `agent:${nextAg.agente_id}`, titulo: nextAg.nome, shape: vis.shape, color: vis.color },
            { type: "agent", agenteId: nextAg.agente_id }
          );
        } else {
          setCenterMode({ type: "new_agent" });
          setActiveTabId("new-agent");
        }
      }
    },
    [centerMode, ensureAndActivateTab]
  );

  const handleRestoreDeletedAgent = useCallback(
    async (agenteId: string) => {
      await daemonApi.restoreAgentDefaults(agenteId);
      const [nextAgents, nextDeleted, nextLayout] = await Promise.all([
        daemonApi.listAgents(),
        daemonApi.listDeletedNativeAgents().catch(() => [] as DeletedNativeAgentInfo[]),
        daemonApi.getSidebarLayout().catch(() => null),
      ]);
      setAgentes(nextAgents);
      setDeletedNativeAgents(nextDeleted);
      if (nextLayout) setSidebarLayout(nextLayout);
      const restored = nextAgents.find((a) => a.agente_id === agenteId);
      if (restored) {
        const vis = getAgentAvatar(restored);
        ensureAndActivateTab(
          { id: `agent:${restored.agente_id}`, titulo: restored.nome, shape: vis.shape, color: vis.color },
          { type: "agent", agenteId: restored.agente_id }
        );
      }
    },
    [ensureAndActivateTab]
  );

  const handleRestoreAllDeletedAgents = useCallback(async () => {
    await daemonApi.restoreAllDeletedAgents();
    const [nextAgents, nextDeleted, nextLayout] = await Promise.all([
      daemonApi.listAgents(),
      daemonApi.listDeletedNativeAgents().catch(() => [] as DeletedNativeAgentInfo[]),
      daemonApi.getSidebarLayout().catch(() => null),
    ]);
    setAgentes(nextAgents);
    setDeletedNativeAgents(nextDeleted);
    if (nextLayout) setSidebarLayout(nextLayout);
  }, []);

  const handleToggleUnreadAgent = useCallback(async (agenteId: string, markUnread: boolean) => {
    if (markUnread) {
      await daemonApi.markAgentUnread(agenteId);
      setAgentes((prev) =>
        prev.map((a) =>
          a.agente_id === agenteId
            ? {
                ...a,
                nao_lidas: Math.max(1, a.nao_lidas ?? 0),
                config: { ...(a.config ?? {}), marked_unread: true },
              }
            : a
        )
      );
    } else {
      await daemonApi.markAgentRead(agenteId);
      setAgentes((prev) =>
        prev.map((a) =>
          a.agente_id === agenteId
            ? {
                ...a,
                nao_lidas: 0,
                config: { ...(a.config ?? {}), marked_unread: false },
              }
            : a
        )
      );
    }
  }, []);

  const handleToggleMuteAgent = useCallback(async (agenteId: string, nextLevel: "all" | "muted") => {
    const updated = await daemonApi.updateAgentSettings(agenteId, { notification_level: nextLevel });
    setAgentes((prev) =>
      prev.map((a) => (a.agente_id === updated.agente_id ? { ...a, ...updated } : a))
    );
  }, []);

  const handleOpenAgentNewWindow = useCallback(async (agenteId: string) => {
    const bridge = getCriativoDesktopBridge();
    if (bridge?.openAgentWindow) {
      await bridge.openAgentWindow(agenteId);
      return;
    }
    if (typeof window !== "undefined") {
      window.open(
        `${window.location.origin}/?agent=${encodeURIComponent(agenteId)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
  }, []);

  const handleNewSubconversationForAgent = useCallback(
    async (agenteId: string) => {
      const targetAgent = agentes.find((a) => a.agente_id === agenteId);
      const vis = getAgentAvatar(targetAgent);
      const { thread } = await daemonApi.createEmptyTopic(agenteId);
      setAllThreads((prev) => [
        thread,
        ...prev.filter((t) => t.thread_id !== thread.thread_id),
      ]);
      setThreadChatById((prev) => ({
        ...prev,
        [thread.thread_id]: prev[thread.thread_id] ?? [],
      }));
      setActiveThreadIdByAgent((prev) => ({
        ...prev,
        [agenteId]: thread.thread_id,
      }));
      ensureAndActivateTab(
        {
          id: `thread:${agenteId}:${thread.thread_id}`,
          titulo: thread.titulo || "Nova Subconversa",
          kind: "topic",
          shape: vis.shape,
          color: vis.color,
        },
        { type: "thread", agenteId, threadId: thread.thread_id }
      );
      await refreshAgentThreadsState(agenteId, thread.thread_id).catch(() => {});
    },
    [agentes, ensureAndActivateTab, refreshAgentThreadsState]
  );

  const handleSelectThreadInAgent = useCallback(
    (agenteId: string, threadId: string | null) => {
      setActiveSideThreadId(null);
      if (!threadId || threadId.startsWith("main:")) {
        setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: null }));
        const ag = agentes.find((a) => a.agente_id === agenteId);
        const vis = getAgentAvatar(ag);
        ensureAndActivateTab(
          {
            id: `agent:${agenteId}`,
            titulo: ag?.nome ?? agenteId,
            shape: vis.shape,
            color: vis.color,
          },
          { type: "agent", agenteId }
        );
        return;
      }

      setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: threadId }));
      const ag = agentes.find((a) => a.agente_id === agenteId);
      const vis = getAgentAvatar(ag);
      const th =
        threadsByAgent[agenteId]?.threads.find((t) => t.thread_id === threadId) ??
        allThreads.find((t) => t.thread_id === threadId);
      ensureAndActivateTab(
        {
          id: `thread:${agenteId}:${threadId}`,
          titulo: th?.titulo ?? `Sub-tarefa`,
          shape: vis.shape,
          color: vis.color,
        },
        { type: "thread", agenteId, threadId }
      );
    },
    [agentes, allThreads, ensureAndActivateTab, threadsByAgent]
  );

  const handleOpenThreadInChat = useCallback(
    async (thread: AgenteThreadRegistro) => {
      let targetThread = thread;
      if (thread.arquivada_em) {
        try {
          targetThread = await daemonApi.reopenThread(thread.thread_id);
          await refreshAgentThreadsState(thread.agente_id, thread.thread_id);
        } catch {
          // segue mesmo se já reaberta concorrentemente
        }
      }
      handleSelectThreadInAgent(targetThread.agente_id, targetThread.thread_id);
    },
    [handleSelectThreadInAgent, refreshAgentThreadsState]
  );

  const handleDismissThreadTab = useCallback(
    async (agenteId: string, threadId: string) => {
      try {
        await daemonApi.archiveThread(threadId);
        await refreshAgentThreadsState(agenteId, null);
      } catch {
        // Caso thread ainda esteja em execução, apenas recolhe a aba da DynamicIsland
      }
      const tabId = `thread:${agenteId}:${threadId}`;
      setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (centerMode.type === "thread" && centerMode.threadId === threadId) {
        setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: null }));
        const ag = agentes.find((a) => a.agente_id === agenteId);
        const vis = getAgentAvatar(ag);
        ensureAndActivateTab(
          { id: `agent:${agenteId}`, titulo: ag?.nome ?? agenteId, shape: vis.shape, color: vis.color },
          { type: "agent", agenteId }
        );
      }
    },
    [agentes, centerMode, ensureAndActivateTab, refreshAgentThreadsState]
  );

  const handleSelectChannel = (canalId: string) => {
    setActiveSideThreadId(null);
    const canal = canais.find((c) => c.canal_id === canalId);
    ensureAndActivateTab(
      { id: `channel:${canalId}`, titulo: canal?.nome ?? canalId, shape: "rounded_square", color: "#31cf76" },
      { type: "channel", canalId }
    );
  };

  const handleOpenNewAgentTab = useCallback(() => {
    ensureAndActivateTab(
      { id: "new-agent", titulo: "Novo agente", shape: "rounded_square", color: "#38bdf8" },
      { type: "new_agent" }
    );
  }, [ensureAndActivateTab]);

  // Integração com janela flutuante Electron Always-on-Top
  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge?.onMainNavigate) return;
    return bridge.onMainNavigate((payload) => {
      if (payload.action === "new-agent") {
        handleOpenNewAgentTab();
      } else if (payload.action === "open-dock-settings") {
        openSettings("dock");
      } else if (payload.agenteId) {
        handleSelectAgent(payload.agenteId);
      }
    });
  }, [handleOpenNewAgentTab, handleSelectAgent, openSettings]);

  useEffect(() => {
    const bridge = getCriativoDesktopBridge();
    if (!bridge) return;
    const dock = userSettings.dock;
    const visible =
      (dock?.mostrar_dock ?? true) && userSettings.comportamento.habilitar_drawer_rapido !== false;
    if (bridge.dockConfigure) {
      void bridge.dockConfigure({
        visible,
        side: dock?.borda ?? "right",
        pinned: !(dock?.ocultar_quando_inativo ?? false),
        scalePercent: dock?.tamanho_percentual ?? 100,
        alwaysOnTop: (dock?.posicao ?? "sobre_outros_apps") === "sobre_outros_apps",
        displayId: dock?.tela ?? "principal",
      });
    } else if (bridge.dockSetVisible) {
      void bridge.dockSetVisible(visible);
    }
  }, [userSettings.comportamento.habilitar_drawer_rapido, userSettings.dock]);

  const handleCreateNewTopic = useCallback(async () => {
    const currentAgentId =
      centerMode.type === "agent" || centerMode.type === "thread" ? centerMode.agenteId : null;
    const targetAgent =
      (currentAgentId ? agentes.find((a) => a.agente_id === currentAgentId) : null) ??
      agentes.find((a) => a.agente_id === "estrategista") ??
      agentes[0] ??
      null;
    const targetAgentId = targetAgent?.agente_id ?? "estrategista";
    const vis = getAgentAvatar(targetAgent);
    const { thread } = await daemonApi.createEmptyTopic(targetAgentId);
    setAllThreads((prev) => [
      thread,
      ...prev.filter((t) => t.thread_id !== thread.thread_id),
    ]);
    setThreadChatById((prev) => ({
      ...prev,
      [thread.thread_id]: prev[thread.thread_id] ?? [],
    }));
    setActiveThreadIdByAgent((prev) => ({
      ...prev,
      [targetAgentId]: thread.thread_id,
    }));
    ensureAndActivateTab(
      {
        id: `thread:${targetAgentId}:${thread.thread_id}`,
        titulo: thread.titulo || "Nova Subconversa",
        kind: "topic",
        shape: vis.shape,
        color: vis.color,
      },
      { type: "thread", agenteId: targetAgentId, threadId: thread.thread_id }
    );
    await refreshAgentThreadsState(targetAgentId, thread.thread_id).catch(() => {});
  }, [agentes, centerMode, ensureAndActivateTab, refreshAgentThreadsState]);

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setActiveSection("agentes");
    if (tabId === "new-agent") {
      setCenterMode({ type: "new_agent" });
      pushNavHistory({ type: "new_agent" });
    } else if (tabId.startsWith("channel:")) {
      const canalId = tabId.slice("channel:".length);
      setCenterMode({ type: "channel", canalId });
      pushNavHistory({ type: "channel", canalId });
    } else if (tabId.startsWith("thread:")) {
      const rest = tabId.slice("thread:".length);
      const sep = rest.indexOf(":");
      if (sep > 0) {
        const agenteId = rest.slice(0, sep);
        const threadId = rest.slice(sep + 1);
        setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: threadId }));
        setCenterMode({ type: "thread", agenteId, threadId });
        pushNavHistory({ type: "thread", agenteId, threadId });
      }
    } else if (tabId.startsWith("agent:")) {
      const agenteId = tabId.slice("agent:".length);
      setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: null }));
      setCenterMode({ type: "agent", agenteId });
      pushNavHistory({ type: "agent", agenteId });
    }
  };

  const handleCloseTab = (tabId: string) => {
    if (tabId.startsWith("thread:")) {
      const rest = tabId.slice("thread:".length);
      const sep = rest.indexOf(":");
      if (sep > 0) {
        const agenteId = rest.slice(0, sep);
        const threadId = rest.slice(sep + 1);
        void handleDismissThreadTab(agenteId, threadId);
        return;
      }
    }
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        const target = next[next.length - 1];
        setTimeout(() => handleSelectTab(target.id), 0);
      }
      return next;
    });
  };

  const stepHistoryTab = (delta: number) => {
    const hist = navHistoryRef.current;
    const nextIdx = navIndexRef.current + delta;
    if (nextIdx >= 0 && nextIdx < hist.length) {
      navIndexRef.current = nextIdx;
      const mode = hist[nextIdx]!;
      setActiveSection("agentes");
      setCenterMode(mode);
      if (mode.type === "thread") {
        setActiveThreadIdByAgent((prev) => ({ ...prev, [mode.agenteId]: mode.threadId }));
        setActiveTabId(`thread:${mode.agenteId}:${mode.threadId}`);
      } else if (mode.type === "agent") {
        setActiveThreadIdByAgent((prev) => ({ ...prev, [mode.agenteId]: null }));
        setActiveTabId(`agent:${mode.agenteId}`);
      } else if (mode.type === "channel") {
        setActiveTabId(`channel:${mode.canalId}`);
      } else if (mode.type === "new_agent") {
        setActiveTabId("new-agent");
      }
      return;
    }
  };

  return {
    pushNavHistory,
    ensureAndActivateTab,
    handleSelectAgent,
    handleDeleteAgent,
    handleRestoreDeletedAgent,
    handleRestoreAllDeletedAgents,
    handleToggleUnreadAgent,
    handleToggleMuteAgent,
    handleOpenAgentNewWindow,
    handleNewSubconversationForAgent,
    handleSelectThreadInAgent,
    handleOpenThreadInChat,
    handleDismissThreadTab,
    handleSelectChannel,
    handleOpenNewAgentTab,
    handleCreateNewTopic,
    handleSelectTab,
    handleCloseTab,
    stepHistoryTab
  };
}

export type StudioTabsAndNavActions = ReturnType<typeof useStudioTabsAndNavigation>;
