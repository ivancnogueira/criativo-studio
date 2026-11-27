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
import { getCriativoDesktopBridge } from "../types/desktop-bridge";
import {
  DEFAULT_FRONTEND_USER_SETTINGS,
  SettingsModal,
  type SettingsModalTabId,
  applyUserSettingsToDocument,
} from "../features/settings/SettingsModal";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import { getThreadLaneKey, LAST_TAB_STORAGE_KEY, readStoredWidth, SIDEBAR_WIDTH_KEY, INSPECTOR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH, DEFAULT_INSPECTOR_WIDTH, type AgenteEnriquecido, type AgentCenterMode , clampWidth, writeStoredWidth, getAgentAvatar, readCachedUserSettings } from "../utils/studio-storage";
import type { StudioAppState } from "./useStudioState";

export function useStudioBootstrap(state: StudioAppState) {
  const {
    setBootLoading,
    setOnboarding,
    centerMode,
    setCenterMode,
    setSidebarOpen,
    setInspectorOpen,
    setSidebarWidth,
    setInspectorWidth,
    setFocusMode,
    setAgentes,
    setCanais,
    setTarefas,
    setWorkflows,
    setArquivos,
    setProvedores,
    setUso,
    setAnalyticsUso,
    setHabilidades,
    setUpgrades,
    setConectores,
    setVaultKeys,
    setSelectedTaskId,
    setWhatsappStatus,
    setWhatsappQr,
    setWhatsappAccounts,
    setChatByKey,
    setOpenTabs,
    setActiveTabId,
    setRoutineCountsByAgent,
    setDeletedNativeAgents,
    activeSideThreadId,
    setThreadsByAgent,
    setAllThreads,
    setThreadChatById,
    setThreadPaginationById,
    setWaitsByAgent,
    setQueueByLane,
    setPinsByAgent,
    setFoldersSnapshot,
    setUserSettings,
    setSidebarLayout,
    setBrowserStatus,
    setBrowserTabs,
    setActiveBrowserTabId,
    setBrowserProfiles,
    setBrowserProxies,
    setStorageUsage,
    setWhatsNew,
    setShowcaseSites,
    setLicenseStatus,
    servers,
    setServers,
    setActiveServerIdState,
    setServerQuota,
    setUpdateStatus,
    wsRef,
    restoredLastTabRef,
    rehydratingServerRef,
  } = state;

  const refreshLibraryFolders = useCallback(async () => {
    try {
      const [snap, fileList] = await Promise.all([
        daemonApi.listLibraryFolders(),
        daemonApi.listFiles(),
      ]);
      setFoldersSnapshot(snap);
      setArquivos(fileList);
    } catch {
      // silencioso
    }
  }, []);

  const refreshRoutineCounts = useCallback(async () => {
    try {
      const all = await daemonApi.listAllRoutines();
      const counts: Record<string, number> = {};
      for (const item of all) {
        if (item.owner_kind === "agente") {
          counts[item.owner_id] = (counts[item.owner_id] ?? 0) + 1;
        }
      }
      setRoutineCountsByAgent(counts);
    } catch {
      // Silencioso caso endpoint ainda não responda
    }
  }, []);

  const refreshAgentThreadsState = useCallback(async (agenteId: string, threadId: string | null = null) => {
    try {
      const [threadsSnap, waits, pins, queueSnap] = await Promise.all([
        daemonApi.listAgentThreads(agenteId).catch(() => null),
        daemonApi.listWaits(agenteId).catch(() => null),
        daemonApi.listPins(agenteId).catch(() => null),
        daemonApi.listChatQueue(agenteId, threadId).catch(() => null),
      ]);
      if (threadsSnap) {
        setThreadsByAgent((prev) => ({ ...prev, [agenteId]: threadsSnap }));
        setAllThreads((prev) => {
          const others = prev.filter((t) => t.agente_id !== agenteId);
          return [...others, ...threadsSnap.threads].sort((a, b) =>
            b.atualizado_em.localeCompare(a.atualizado_em)
          );
        });
      }
      if (waits) {
        setWaitsByAgent((prev) => ({ ...prev, [agenteId]: waits }));
      }
      if (pins) {
        setPinsByAgent((prev) => ({ ...prev, [agenteId]: pins }));
      }
      if (queueSnap) {
        setQueueByLane((prev) => ({
          ...prev,
          [getThreadLaneKey(agenteId, threadId)]: queueSnap,
        }));
      }
    } catch {
      // silencioso
    }
  }, []);

  const hydrateAll = useCallback(async () => {
    try {
      const serverIdAtStart = getActiveServerId();
      const licStatus = await daemonApi.obterStatusLicenca().catch(() => null);
      if (licStatus) {
        setLicenseStatus(licStatus);
        if (!licStatus.valid) {
          return;
        }
      }

      const [
        onb,
        agList,
        chList,
        tList,
        wa,
        provList,
        usageSnap,
        analyticsData,
        skillsList,
        upgradeList,
        connList,
        wfList,
        fileList,
        keys,
        waAccountsList,
        threadsList,
        foldersSnap,
        remoteUserSettings,
        remoteSidebarLayout,
        remoteBrowserProfiles,
        remoteBrowserProxies,
        remoteBrowserStatus,
        remoteShowcaseSites,
        remoteStorageUsage,
        remoteWhatsNew,
        remoteServersSnap,
        remoteUpdateStatus,
        remoteDeletedAgents,
      ] = await Promise.all([
        daemonApi.getOnboarding().catch(() => null),
        daemonApi.listAgents().catch(() => [] as AgenteEnriquecido[]),
        daemonApi.listChannels().catch(() => [] as CanalEquipe[]),
        daemonApi.listTasks().catch(() => [] as TarefaRegistro[]),
        daemonApi
          .getWhatsAppStatus()
          .catch(() => ({ status: "desconectado" as StatusMensageria, qrcode_base64: null })),
        daemonApi.listProvidersStatus(false).catch(() => [] as ProvedorStatusInfo[]),
        daemonApi.getProvidersUsage(false).catch(() => null),
        daemonApi.getUsageAnalytics({ dias: 30, agente_id: null }).catch(() => null),
        daemonApi.listSkills().catch(() => [] as HabilidadeInstaladaInfo[]),
        daemonApi.listUpgrades().catch(() => [] as PacoteUpgradeInfo[]),
        daemonApi.listConnectors().catch(() => [] as ConectorIntegracaoInfo[]),
        daemonApi.listWorkflows().catch(() => []),
        daemonApi.listFiles().catch(() => [] as ArquivoStudio[]),
        daemonApi
          .getVaultStatus()
          .catch(() => [] as Array<{ chave_nome: string; atualizado_em: string }>),
        daemonApi.listWhatsAppAccounts().catch(() => [] as WhatsAppContaResumo[]),
        daemonApi.listAllThreads().catch(() => [] as AgenteThreadRegistro[]),
        daemonApi.listLibraryFolders().catch(() => null),
        daemonApi.getUserSettings().catch(() => null),
        daemonApi.getSidebarLayout().catch(() => null),
        daemonApi.listBrowserProfiles().catch(() => [] as BrowserProfileInfo[]),
        daemonApi.listBrowserProxies().catch(() => [] as BrowserProxyConfig[]),
        daemonApi.getBrowserStatus().catch(() => null),
        daemonApi.listShowcaseSites().catch(() => [] as ShowcaseSiteSummary[]),
        daemonApi.getStorageUsage().catch(() => null),
        daemonApi.getWhatsNew().catch(() => null),
        daemonApi.listarServidores().catch(() => null),
        daemonApi.obterStatusAtualizacao().catch(() => null),
        daemonApi.listDeletedNativeAgents().catch(() => [] as DeletedNativeAgentInfo[]),
      ]);

      setDeletedNativeAgents(remoteDeletedAgents);

      if (remoteUpdateStatus) {
        setUpdateStatus(remoteUpdateStatus);
      }

      if (remoteServersSnap) {
        setServers(remoteServersSnap.servers);
        setServerQuota(remoteServersSnap.quota);
        const resolvedServerId = remoteServersSnap.active_server_id || "primary";
        void getCriativoDesktopBridge()?.dockSyncActiveServer?.(resolvedServerId);
        if (resolvedServerId !== serverIdAtStart && rehydratingServerRef.current !== resolvedServerId) {
          rehydratingServerRef.current = resolvedServerId;
          setActiveServerId(resolvedServerId);
          setActiveServerIdState(resolvedServerId);
          wsRef.current?.reconnectForServer(resolvedServerId);
          await hydrateAll();
          return;
        }
        rehydratingServerRef.current = null;
      }

      if (onb) setOnboarding(onb);
      setAgentes(agList);
      setCanais(chList);
      setTarefas(tList);
      setWhatsappStatus(wa.status);
      setWhatsappQr(wa.qrcode_base64);
      setProvedores(provList);
      if (usageSnap) setUso(usageSnap);
      if (analyticsData) setAnalyticsUso(analyticsData);
      setHabilidades(skillsList);
      setUpgrades(upgradeList);
      setConectores(connList);
      setWorkflows(wfList);
      setArquivos(fileList);
      setVaultKeys(keys);
      setWhatsappAccounts(waAccountsList);
      setAllThreads(threadsList);
      if (foldersSnap) setFoldersSnapshot(foldersSnap);
      if (remoteUserSettings) {
        setUserSettings(remoteUserSettings);
        applyUserSettingsToDocument(remoteUserSettings);
        const ap = remoteUserSettings.aparencia;
        if (typeof ap.sidebar_width === "number") {
          const sw = clampWidth(ap.sidebar_width, 220, 460, DEFAULT_SIDEBAR_WIDTH);
          setSidebarWidth(sw);
          writeStoredWidth(SIDEBAR_WIDTH_KEY, sw);
        }
        if (typeof ap.inspector_width === "number") {
          const iw = clampWidth(ap.inspector_width, 280, 560, DEFAULT_INSPECTOR_WIDTH);
          setInspectorWidth(iw);
          writeStoredWidth(INSPECTOR_WIDTH_KEY, iw);
        }
        const cp = remoteUserSettings.comportamento;
        if (typeof cp.sidebar_open === "boolean") setSidebarOpen(cp.sidebar_open);
        if (typeof cp.inspector_open === "boolean") setInspectorOpen(cp.inspector_open);
        if (typeof cp.focus_mode === "boolean") setFocusMode(cp.focus_mode);
      }
      if (remoteSidebarLayout) setSidebarLayout(remoteSidebarLayout);
      setBrowserProfiles(remoteBrowserProfiles);
      setBrowserProxies(remoteBrowserProxies);
      if (remoteBrowserStatus) {
        setBrowserStatus(remoteBrowserStatus);
        const initialTabs = remoteBrowserStatus.tabs ?? [];
        setBrowserTabs(initialTabs);
        if (initialTabs.length > 0) {
          setActiveBrowserTabId((prev) => prev ?? initialTabs[0]!.tabId);
        }
      }
      setShowcaseSites(remoteShowcaseSites);
      if (remoteStorageUsage) setStorageUsage(remoteStorageUsage);
      if (remoteWhatsNew) setWhatsNew(remoteWhatsNew);
      void refreshRoutineCounts();

      if (tList.length > 0) {
        const pending =
          tList.find((t) => t.status === "aguardando_aprovacao") ??
          tList.find((t) => t.status === "executando") ??
          tList[0];
        setSelectedTaskId((prev) => prev ?? pending.tarefa_id);
      }

      if (!restoredLastTabRef.current && typeof window !== "undefined") {
        restoredLastTabRef.current = true;
        const urlAgentId = new URLSearchParams(window.location.search).get("agent");
        const urlMatch = urlAgentId ? agList.find((a) => a.agente_id === urlAgentId) : undefined;
        if (urlMatch) {
          const vis = getAgentAvatar(urlMatch);
          const tabId = `agent:${urlMatch.agente_id}`;
          setOpenTabs((prev) =>
            prev.some((t) => t.id === tabId)
              ? prev
              : [
                  ...prev,
                  {
                    id: tabId,
                    titulo: urlMatch.nome,
                    shape: vis.shape,
                    color: vis.color,
                  },
                ]
          );
          setActiveTabId(tabId);
          setCenterMode({ type: "agent", agenteId: urlMatch.agente_id });
        } else {
          const shouldRestore =
            (remoteUserSettings ?? readCachedUserSettings()).comportamento.restaurar_ultima_aba;
          const savedTabId = shouldRestore ? window.localStorage.getItem(LAST_TAB_STORAGE_KEY) : null;
          if (savedTabId && savedTabId.startsWith("agent:")) {
            const agId = savedTabId.slice("agent:".length);
            const agMatch = agList.find((a) => a.agente_id === agId);
            if (agMatch) {
              const vis = getAgentAvatar(agMatch);
              setOpenTabs((prev) =>
                prev.some((t) => t.id === savedTabId)
                  ? prev
                  : [
                      ...prev,
                      {
                        id: savedTabId,
                        titulo: agMatch.nome,
                        shape: vis.shape,
                        color: vis.color,
                      },
                    ]
              );
              setActiveTabId(savedTabId);
              setCenterMode({ type: "agent", agenteId: agId });
            } else if (agList.length > 0 && !agList.some((a) => a.agente_id === "estrategista")) {
              const firstAg = agList[0]!;
              const vis = getAgentAvatar(firstAg);
              const fallbackTab = `agent:${firstAg.agente_id}`;
              setOpenTabs([{ id: fallbackTab, titulo: firstAg.nome, shape: vis.shape, color: vis.color }]);
              setActiveTabId(fallbackTab);
              setCenterMode({ type: "agent", agenteId: firstAg.agente_id });
            }
          } else if (savedTabId && savedTabId.startsWith("channel:")) {
            const cId = savedTabId.slice("channel:".length);
            const chMatch = chList.find((c) => c.canal_id === cId);
            if (chMatch) {
              setOpenTabs((prev) =>
                prev.some((t) => t.id === savedTabId)
                  ? prev
                  : [
                      ...prev,
                      {
                        id: savedTabId,
                        titulo: chMatch.nome,
                        shape: "hex",
                        color: "#42A0FF",
                      },
                    ]
              );
              setActiveTabId(savedTabId);
              setCenterMode({ type: "channel", canalId: cId });
            }
          } else if (agList.length > 0 && !agList.some((a) => a.agente_id === "estrategista")) {
            const firstAg = agList[0]!;
            const vis = getAgentAvatar(firstAg);
            const fallbackTab = `agent:${firstAg.agente_id}`;
            setOpenTabs([{ id: fallbackTab, titulo: firstAg.nome, shape: vis.shape, color: vis.color }]);
            setActiveTabId(fallbackTab);
            setCenterMode({ type: "agent", agenteId: firstAg.agente_id });
          }
        }
      }
    } finally {
      setBootLoading(false);
    }
  }, [refreshRoutineCounts]);

  useEffect(() => {
    void hydrateAll();
  }, [hydrateAll]);

  // Re-checa atualizações silenciosamente ao retornar para a janela (throttle de 5 min)
  const lastAutoUpdateCheckRef = useRef<number>(0);
  useEffect(() => {
    const CHECK_THROTTLE_MS = 5 * 60_000;
    const triggerCheckIfDue = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const now = Date.now();
      if (now - lastAutoUpdateCheckRef.current < CHECK_THROTTLE_MS) {
        return;
      }
      lastAutoUpdateCheckRef.current = now;
      void daemonApi
        .verificarAtualizacoes()
        .then((nextStatus) => {
          setUpdateStatus(nextStatus);
        })
        .catch(() => {});
    };

    const initialTimer = window.setTimeout(triggerCheckIfDue, 10_000);
    window.addEventListener("focus", triggerCheckIfDue);
    document.addEventListener("visibilitychange", triggerCheckIfDue);
    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener("focus", triggerCheckIfDue);
      document.removeEventListener("visibilitychange", triggerCheckIfDue);
    };
  }, [setUpdateStatus]);

  // Carrega mensagens e metadados Fase 13 da conversa ativa
  useEffect(() => {
    if (
      activeSideThreadId &&
      activeSideThreadId.startsWith("rotina:") &&
      (centerMode.type === "agent" || centerMode.type === "thread")
    ) {
      const rotinaId = activeSideThreadId.slice("rotina:".length);
      void daemonApi.listRoutineThreadMessages(centerMode.agenteId, rotinaId).then((msgs) => {
        setChatByKey((prev) => ({ ...prev, [activeSideThreadId]: msgs }));
      });
      return;
    }

    if (centerMode.type === "thread") {
      const { agenteId, threadId } = centerMode;
      void daemonApi
        .readThreadMessages(threadId)
        .then((pagina) => {
          setThreadChatById((prev) => ({ ...prev, [threadId]: pagina.mensagens }));
          setThreadPaginationById((prev) => ({ ...prev, [threadId]: pagina }));
          const lastId = pagina.mensagens[pagina.mensagens.length - 1]?.mensagem_id;
          void daemonApi.markThreadRead(threadId, lastId).catch(() => null);
        })
        .catch(() => {});
      void refreshAgentThreadsState(agenteId, threadId);
    } else if (centerMode.type === "agent") {
      const key = `agente:${centerMode.agenteId}`;
      const mainKey = `main:${centerMode.agenteId}`;
      void daemonApi
        .readAgentMessagesPage(centerMode.agenteId)
        .then((pagina) => {
          setChatByKey((prev) => ({ ...prev, [key]: pagina.mensagens }));
          setThreadPaginationById((prev) => ({ ...prev, [mainKey]: pagina }));
        })
        .catch(() => {
          void daemonApi.listAgentMessages(centerMode.agenteId).then((msgs) => {
            setChatByKey((prev) => ({ ...prev, [key]: msgs }));
          });
        });
      void daemonApi.markAgentRead(centerMode.agenteId).then(() => {
        setAgentes((prev) =>
          prev.map((a) => (a.agente_id === centerMode.agenteId ? { ...a, nao_lidas: 0 } : a))
        );
      });
      void refreshAgentThreadsState(centerMode.agenteId, null);
    } else if (centerMode.type === "channel") {
      const key = centerMode.canalId;
      void daemonApi.listChannelMessages(centerMode.canalId).then((msgs) => {
        setChatByKey((prev) => ({ ...prev, [key]: msgs }));
      });
    }
  }, [centerMode, activeSideThreadId, refreshAgentThreadsState]);

  return {
    refreshLibraryFolders,
    refreshRoutineCounts,
    refreshAgentThreadsState,
    hydrateAll,
  };
}

export type StudioBootstrapActions = ReturnType<typeof useStudioBootstrap>;
