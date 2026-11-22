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
  BrowserAutofillConsentRequest,
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
import {
  Crown,
  MessageSquare,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { DynamicIsland, type StudioTabItem } from "../components/DynamicIsland";
import {
  resolveInitialSplashStageFromSearch,
  StudioSplashPreloader,
  type SplashInitialStage,
} from "../components/StudioSplashPreloader";
import { Sidebar } from "../components/Sidebar";
import { WorkspaceRail, type StudioNavSection } from "../components/WorkspaceRail";
import {
  AgentConversationView,
  type ChatLiveRunState,
  type McpSignInCardState,
} from "../features/chat/AgentConversationView";
import {
  FilePreviewPanel,
  ImageLightbox,
  type PreviewableFileItem,
} from "../features/chat/FilePreviewPanel";
import { RightInspectorPanel, type InspectorSubView } from "../features/inspector/RightInspectorPanel";
import type { AgentStepLog } from "../features/trace/AgentStepsWaterfall";
import {
  InAppBrowserPanel,
  type BrowserLiveFrame,
  type BrowserMouseKeyboardInput,
} from "../features/browser/InAppBrowserPanel";
import {
  DEFAULT_FRONTEND_USER_SETTINGS,
  SettingsModal,
  type SettingsModalTabId,
  applyUserSettingsToDocument,
} from "../features/settings/SettingsModal";
import type { WorkflowEventSignal } from "../features/workflows/WorkflowsCanvasPage";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import { AGENT_DOCK_PINNED_KEY, DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, INSPECTOR_WIDTH_KEY, LAST_TAB_STORAGE_KEY, readCachedUserSettings, readStoredWidth, SIDEBAR_WIDTH_KEY, USER_SETTINGS_STORAGE_KEY, type AgentCenterMode, type AgenteEnriquecido } from "../utils/studio-storage";

export function useStudioState() {
  const [bootLoading, setBootLoading] = useState(true);
  const [splashStage, setSplashStage] = useState<SplashInitialStage>(() =>
    typeof window !== "undefined"
      ? resolveInitialSplashStageFromSearch(window.location.search)
      : "scout"
  );
  const [splashDismissed, setSplashDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("fromSplash") || url.searchParams.has("splashElapsed")) {
      url.searchParams.delete("fromSplash");
      url.searchParams.delete("splashElapsed");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  const [onboarding, setOnboarding] = useState<OnboardingEstado | null>(null);
  const [activeSection, setActiveSection] = useState<StudioNavSection>("agentes");
  const [centerMode, setCenterMode] = useState<AgentCenterMode>({
    type: "agent",
    agenteId: "estrategista",
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredWidth(SIDEBAR_WIDTH_KEY, 220, 460, DEFAULT_SIDEBAR_WIDTH)
  );
  const [inspectorWidth, setInspectorWidth] = useState<number>(() =>
    readStoredWidth(INSPECTOR_WIDTH_KEY, 280, 560, DEFAULT_INSPECTOR_WIDTH)
  );
  const [focusMode, setFocusMode] = useState(false);
  const layoutPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [agentes, setAgentes] = useState<AgenteEnriquecido[]>([]);
  const [canais, setCanais] = useState<CanalEquipe[]>([]);
  const [tarefas, setTarefas] = useState<TarefaRegistro[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowVisual[]>([]);
  const [workflowEventSignal, setWorkflowEventSignal] = useState<WorkflowEventSignal>({
    nonce: 0,
  });
  const [arquivos, setArquivos] = useState<ArquivoStudio[]>([]);
  const [provedores, setProvedores] = useState<ProvedorStatusInfo[]>([]);
  const [uso, setUso] = useState<UsoProvedoresSnapshot | null>(null);
  const [analyticsUso, setAnalyticsUso] = useState<RelatorioAnalyticsHost | null>(null);
  const [usoPeriodoDias, setUsoPeriodoDias] = useState<number>(30);
  const [usoAgenteFiltro, setUsoAgenteFiltro] = useState<string | null>(null);
  const [habilidades, setHabilidades] = useState<HabilidadeInstaladaInfo[]>([]);
  const [upgrades, setUpgrades] = useState<PacoteUpgradeInfo[]>([]);
  const [conectores, setConectores] = useState<ConectorIntegracaoInfo[]>([]);
  const [vaultKeys, setVaultKeys] = useState<Array<{ chave_nome: string; atualizado_em: string }>>([]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStepLog[]>([]);
  const [thoughtStream, setThoughtStream] = useState("");
  const [wsConnected, setWsConnected] = useState(false);

  const [whatsappStatus, setWhatsappStatus] = useState<StatusMensageria>("desconectado");
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappAccounts, setWhatsappAccounts] = useState<WhatsAppContaResumo[]>([]);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [pendingMcpSignIn, setPendingMcpSignIn] = useState<McpSignInCardState | null>(null);
  const [lojaInitialAppSlug, setLojaInitialAppSlug] = useState<string | null>(null);
  const [prefilledChatPrompt, setPrefilledChatPrompt] = useState<string | null>(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);

  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newChannelInst, setNewChannelInst] = useState("");
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([
    "estrategista",
    "copywriter",
    "designer_carrossel",
  ]);
  const [newChannelLeader, setNewChannelLeader] = useState<string>("estrategista");

  const [chatByKey, setChatByKey] = useState<Record<string, MensagemChat[]>>({});
  const [liveRunByChat, setLiveRunByChat] = useState<
    Record<
      string,
      {
        agenteId: string | null;
        agenteNome: string;
        startedAt: number;
        statusText: string;
        steps: PassoChat[];
        streamingText: string;
      }
    >
  >({});
  const [sendingChat, setSendingChat] = useState(false);
  const [pendingAuthLink, setPendingAuthLink] = useState<{
    provedor: "gemini" | "claude" | "openai";
    url: string;
  } | null>(null);
  const [openTabs, setOpenTabs] = useState<StudioTabItem[]>([
    { id: "agent:estrategista", titulo: "Estrategista Editorial", shape: "hex", color: "#31cf76" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("agent:estrategista");

  const [sidebarViewMode, setSidebarViewMode] = useState<"agents" | "routines">("agents");
  const [routineCountsByAgent, setRoutineCountsByAgent] = useState<Record<string, number>>({});
  const [routinesRefreshNonce, setRoutinesRefreshNonce] = useState(0);
  const [flowRefreshNonce, setFlowRefreshNonce] = useState(0);
  const [routineInspectorSignal, setRoutineInspectorSignal] = useState<{
    subView?: InspectorSubView;
    rotinaId?: string | null;
    nonce: number;
  } | null>(null);
  const [deletedNativeAgents, setDeletedNativeAgents] = useState<DeletedNativeAgentInfo[]>([]);
  const [routineNotifications, setRoutineNotifications] = useState<
    Array<{ id: string; rotina_nome: string; resumo: string; owner_id: string }>
  >([]);
  const [activeSideThreadId, setActiveSideThreadId] = useState<string | null>(null);

  // Fase 13 — Sub-threads paralelas, branches, esperas, fila, paginação e fixações
  const [threadsByAgent, setThreadsByAgent] = useState<Record<string, AgenteThreadsSnapshot>>({});
  const [allThreads, setAllThreads] = useState<AgenteThreadRegistro[]>([]);
  const [threadChatById, setThreadChatById] = useState<Record<string, MensagemChat[]>>({});
  const [threadPaginationById, setThreadPaginationById] = useState<
    Record<string, PaginaConversaThread & { loading_older?: boolean }>
  >({});
  const [liveRunByThread, setLiveRunByThread] = useState<Record<string, ChatLiveRunState>>({});
  const [waitsByAgent, setWaitsByAgent] = useState<Record<string, AgenteEspera[]>>({});
  const [queueByLane, setQueueByLane] = useState<Record<string, FilaChatSnapshot>>({});
  const [pinsByAgent, setPinsByAgent] = useState<Record<string, MensagemFixada[]>>({});
  const [activeThreadIdByAgent, setActiveThreadIdByAgent] = useState<Record<string, string | null>>({});
  const [editingQueueByLane, setEditingQueueByLane] = useState<
    Record<string, { entrega: FilaChatEntrega; editId: string } | null>
  >({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Fase 14 — Tabelas SQL compartilhadas, Previews ricos e Pastas hierárquicas da Biblioteca
  const [sharedTablesOpen, setSharedTablesOpen] = useState(false);
  const [sharedTablesRefreshNonce, setSharedTablesRefreshNonce] = useState(0);
  const [previewFile, setPreviewFile] = useState<PreviewableFileItem | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt?: string } | null>(null);
  const [foldersSnapshot, setFoldersSnapshot] = useState<BibliotecasPastasSnapshot | null>(null);

  // Fase 15 — Navegador CDP, Takeover, Captura de Tela, Sidebar, Settings, Voz Contínua & Showcase Local
  const [userSettings, setUserSettings] = useState<StudioUserSettings>(() => {
    const initial = readCachedUserSettings();
    applyUserSettingsToDocument(initial);
    return initial;
  });
  const [routinesAgentId, setRoutinesAgentId] = useState<string | null>(null);
  const [routinesAgentSearch, setRoutinesAgentSearch] = useState("");
  const [routinesSelectedRoutineId, setRoutinesSelectedRoutineId] = useState<string | null>(null);
  const [routinesRightOpen, setRoutinesRightOpen] = useState(true);
  const [agentDockPinned, setAgentDockPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = window.localStorage.getItem(AGENT_DOCK_PINNED_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const handleToggleAgentDockPinned = useCallback(() => {
    setAgentDockPinned((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(AGENT_DOCK_PINNED_KEY, String(next));
        } catch {
          // ignora erro de quota
        }
      }
      return next;
    });
  }, []);
  const lastNonSettingsSectionRef = useRef<StudioNavSection>("agentes");
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayoutSnapshot | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatusReport | null>(null);
  const [browserTabs, setBrowserTabs] = useState<BrowserTabSummary[]>([]);
  const [browserFramesByTab, setBrowserFramesByTab] = useState<Record<string, BrowserLiveFrame>>({});
  const [activeBrowserTabId, setActiveBrowserTabId] = useState<string | null>(null);
  const [browserPanelMode, setBrowserPanelMode] = useState<"closed" | "sidebar" | "expanded">("closed");
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfileInfo[]>([]);
  const [browserProxies, setBrowserProxies] = useState<BrowserProxyConfig[]>([]);
  const [takeoverByAgent, setTakeoverByAgent] = useState<Record<string, BrowserTakeoverSession>>({});
  const [secretRequestByAgent, setSecretRequestByAgent] = useState<Record<string, BrowserSecretRequest>>({});
  const [captureByAgent, setCaptureByAgent] = useState<Record<string, CaptureScreenConsentRequest>>({});
  const [usageLimitAskByAgent, setUsageLimitAskByAgent] = useState<Record<string, UsageLimitAskPayload>>({});
  const [activeTakeoverModal, setActiveTakeoverModal] = useState<BrowserTakeoverSession | null>(null);
  const [pendingAutofillRequest, setPendingAutofillRequest] = useState<BrowserAutofillConsentRequest | null>(null);
  const [activeTakeoverFrame, setActiveTakeoverFrame] = useState<{
    tabId: string;
    dataUrl: string;
    width: number;
    height: number;
    url: string;
    title: string;
    userControl: boolean;
    agenteId?: string | null;
    perfilId?: string | null;
  } | null>(null);
  const [teachStatusByTab, setTeachStatusByTab] = useState<
    Record<string, { recording: boolean; startedAt: number | null; stepsCount: number }>
  >({});
  const [browsingLogInspector, setBrowsingLogInspector] = useState<{
    agenteId: string;
    agentName: string;
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  } | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsageSnapshot | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNewReleaseInfo | null>(null);
  const [showcaseSites, setShowcaseSites] = useState<ShowcaseSiteSummary[]>([]);
  const [liveVoiceActive, setLiveVoiceActive] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseActivationStatus | null>(null);
  const isAppBooting = bootLoading;
  useEffect(() => {
    if (isAppBooting && splashDismissed) {
      setSplashStage("jumping");
      setSplashDismissed(false);
    }
  }, [isAppBooting, splashDismissed]);
  const [servers, setServers] = useState<StudioServerRecord[]>([]);
  const [activeServerId, setActiveServerIdState] = useState<string>(() => getActiveServerId());
  const [serverQuota, setServerQuota] = useState<ServerQuotaSummary | null>(null);
  const [newLocalModalOpen, setNewLocalModalOpen] = useState(false);
  const [newRemoteModalOpen, setNewRemoteModalOpen] = useState(false);
  const [joinServerModalOpen, setJoinServerModalOpen] = useState(false);
  const [serverSettingsTarget, setServerSettingsTarget] = useState<StudioServerRecord | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusSnapshot | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsModalTabId>("geral");

  useEffect(() => {
    if (activeSection !== "configuracoes") {
      lastNonSettingsSectionRef.current = activeSection;
    }
  }, [activeSection]);

  const openSettings = useCallback((tab?: SettingsModalTabId) => {
    if (tab) {
      setSettingsInitialTab(tab);
    }
    setActiveSection("configuracoes");
  }, []);

  const closeSettings = useCallback(() => {
    setActiveSection((prev) =>
      prev === "configuracoes" ? lastNonSettingsSectionRef.current : prev
    );
  }, []);
  const wsRef = useRef<WebSocketClient | null>(null);
  const restoredLastTabRef = useRef(false);
  const desktopAssistedProviderRef = useRef<"gemini" | "openai" | null>(null);
  const rehydratingServerRef = useRef<string | null>(null);

  useEffect(() => {
    applyUserSettingsToDocument(userSettings);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(userSettings));
      } catch {
        // Ignore quota errors
      }
    }
  }, [userSettings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!userSettings.comportamento.restaurar_ultima_aba) return;
    try {
      window.localStorage.setItem(LAST_TAB_STORAGE_KEY, activeTabId);
    } catch {
      // Ignore quota errors
    }
  }, [activeTabId, userSettings.comportamento.restaurar_ultima_aba]);
  const navHistoryRef = useRef<AgentCenterMode[]>([{ type: "agent", agenteId: "estrategista" }]);
  const navIndexRef = useRef<number>(0);

  return {
    bootLoading,
    setBootLoading,
    splashStage,
    setSplashStage,
    splashDismissed,
    setSplashDismissed,
    onboarding,
    setOnboarding,
    activeSection,
    setActiveSection,
    centerMode,
    setCenterMode,
    sidebarOpen,
    setSidebarOpen,
    inspectorOpen,
    setInspectorOpen,
    sidebarWidth,
    setSidebarWidth,
    inspectorWidth,
    setInspectorWidth,
    focusMode,
    setFocusMode,
    agentes,
    setAgentes,
    canais,
    setCanais,
    tarefas,
    setTarefas,
    workflows,
    setWorkflows,
    workflowEventSignal,
    setWorkflowEventSignal,
    arquivos,
    setArquivos,
    provedores,
    setProvedores,
    uso,
    setUso,
    analyticsUso,
    setAnalyticsUso,
    usoPeriodoDias,
    setUsoPeriodoDias,
    usoAgenteFiltro,
    setUsoAgenteFiltro,
    habilidades,
    setHabilidades,
    upgrades,
    setUpgrades,
    conectores,
    setConectores,
    vaultKeys,
    setVaultKeys,
    selectedTaskId,
    setSelectedTaskId,
    steps,
    setSteps,
    thoughtStream,
    setThoughtStream,
    wsConnected,
    setWsConnected,
    whatsappStatus,
    setWhatsappStatus,
    whatsappQr,
    setWhatsappQr,
    whatsappAccounts,
    setWhatsappAccounts,
    whatsappModalOpen,
    setWhatsappModalOpen,
    pendingMcpSignIn,
    setPendingMcpSignIn,
    lojaInitialAppSlug,
    setLojaInitialAppSlug,
    prefilledChatPrompt,
    setPrefilledChatPrompt,
    helpModalOpen,
    setHelpModalOpen,
    channelModalOpen,
    setChannelModalOpen,
    newChannelName,
    setNewChannelName,
    newChannelDesc,
    setNewChannelDesc,
    newChannelInst,
    setNewChannelInst,
    newChannelMembers,
    setNewChannelMembers,
    newChannelLeader,
    setNewChannelLeader,
    chatByKey,
    setChatByKey,
    liveRunByChat,
    setLiveRunByChat,
    sendingChat,
    setSendingChat,
    pendingAuthLink,
    setPendingAuthLink,
    openTabs,
    setOpenTabs,
    activeTabId,
    setActiveTabId,
    sidebarViewMode,
    setSidebarViewMode,
    routineCountsByAgent,
    setRoutineCountsByAgent,
    routinesRefreshNonce,
    setRoutinesRefreshNonce,
    flowRefreshNonce,
    setFlowRefreshNonce,
    routineInspectorSignal,
    setRoutineInspectorSignal,
    deletedNativeAgents,
    setDeletedNativeAgents,
    routineNotifications,
    setRoutineNotifications,
    activeSideThreadId,
    setActiveSideThreadId,
    threadsByAgent,
    setThreadsByAgent,
    allThreads,
    setAllThreads,
    threadChatById,
    setThreadChatById,
    threadPaginationById,
    setThreadPaginationById,
    liveRunByThread,
    setLiveRunByThread,
    waitsByAgent,
    setWaitsByAgent,
    queueByLane,
    setQueueByLane,
    pinsByAgent,
    setPinsByAgent,
    activeThreadIdByAgent,
    setActiveThreadIdByAgent,
    editingQueueByLane,
    setEditingQueueByLane,
    highlightedMessageId,
    setHighlightedMessageId,
    sharedTablesOpen,
    setSharedTablesOpen,
    sharedTablesRefreshNonce,
    setSharedTablesRefreshNonce,
    previewFile,
    setPreviewFile,
    lightboxImage,
    setLightboxImage,
    foldersSnapshot,
    setFoldersSnapshot,
    userSettings,
    setUserSettings,
    routinesAgentId,
    setRoutinesAgentId,
    routinesAgentSearch,
    setRoutinesAgentSearch,
    routinesSelectedRoutineId,
    setRoutinesSelectedRoutineId,
    routinesRightOpen,
    setRoutinesRightOpen,
    agentDockPinned,
    setAgentDockPinned,
    sidebarLayout,
    setSidebarLayout,
    browserStatus,
    setBrowserStatus,
    browserTabs,
    setBrowserTabs,
    browserFramesByTab,
    setBrowserFramesByTab,
    activeBrowserTabId,
    setActiveBrowserTabId,
    browserPanelMode,
    setBrowserPanelMode,
    browserProfiles,
    setBrowserProfiles,
    browserProxies,
    setBrowserProxies,
    takeoverByAgent,
    setTakeoverByAgent,
    secretRequestByAgent,
    setSecretRequestByAgent,
    captureByAgent,
    setCaptureByAgent,
    usageLimitAskByAgent,
    setUsageLimitAskByAgent,
    activeTakeoverModal,
    setActiveTakeoverModal,
    pendingAutofillRequest,
    setPendingAutofillRequest,
    activeTakeoverFrame,
    setActiveTakeoverFrame,
    teachStatusByTab,
    setTeachStatusByTab,
    browsingLogInspector,
    setBrowsingLogInspector,
    storageUsage,
    setStorageUsage,
    whatsNew,
    setWhatsNew,
    showcaseSites,
    setShowcaseSites,
    liveVoiceActive,
    setLiveVoiceActive,
    licenseStatus,
    setLicenseStatus,
    servers,
    setServers,
    activeServerId,
    setActiveServerIdState,
    serverQuota,
    setServerQuota,
    newLocalModalOpen,
    setNewLocalModalOpen,
    newRemoteModalOpen,
    setNewRemoteModalOpen,
    joinServerModalOpen,
    setJoinServerModalOpen,
    serverSettingsTarget,
    setServerSettingsTarget,
    updateStatus,
    setUpdateStatus,
    settingsInitialTab,
    setSettingsInitialTab,
    layoutPersistTimerRef,
    handleToggleAgentDockPinned,
    lastNonSettingsSectionRef,
    openSettings,
    closeSettings,
    wsRef,
    restoredLastTabRef,
    desktopAssistedProviderRef,
    rehydratingServerRef,
    isAppBooting,
    navHistoryRef,
    navIndexRef
  };
}

export type StudioAppState = ReturnType<typeof useStudioState>;
