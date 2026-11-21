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
import {
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
import { DynamicIsland, type StudioTabItem } from "./components/DynamicIsland";
import {
  inferTaskContextFromActivity,
  MascoteAvatar,
  resolveAgentAvatarConfig,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "./components/MascoteAvatar";
import {
  resolveInitialSplashStageFromSearch,
  StudioSplashPreloader,
  type SplashInitialStage,
} from "./components/StudioSplashPreloader";
import { Sidebar } from "./components/Sidebar";
import { SplitResizeHandle } from "./components/ui/SplitResizeHandle";
import { WorkspaceRail, type StudioNavSection } from "./components/WorkspaceRail";
import { NewAgentScreen, type NewAgentPayload } from "./features/agents/NewAgentScreen";
import {
  AgentConversationView,
  type ChatLiveRunState,
  type McpSignInCardState,
} from "./features/chat/AgentConversationView";
import {
  FilePreviewPanel,
  ImageLightbox,
  type PreviewableFileItem,
} from "./features/chat/FilePreviewPanel";
import { SharedTablesModal } from "./features/chat/SharedTablesModal";
import { RightInspectorPanel, type InspectorSubView } from "./features/inspector/RightInspectorPanel";
import { MarketplacePage } from "./features/marketplace/MarketplacePage";
import { OnboardingFlow } from "./features/onboarding/OnboardingFlow";
import { ConnectorsPage } from "./features/pages/ConnectorsPage";
import { FilesVaultPage } from "./features/pages/FilesVaultPage";
import { TasksQueuePage } from "./features/pages/TasksQueuePage";
import { UsageMetricsPage } from "./features/pages/UsageMetricsPage";
import { AgentRoutinesSettings } from "./features/routines/AgentRoutinesSettings";
import { RoutineFlowsCanvas } from "./features/routines/RoutineFlowsCanvas";
import { SchedulePage } from "./features/schedule/SchedulePage";
import type { AgentStepLog } from "./features/trace/AgentStepsWaterfall";
import { WhatsAppPairingModal } from "./features/whatsapp/WhatsAppPairingModal";
import { BrowserTakeoverModal } from "./features/browser/BrowserTakeoverModal";
import {
  InAppBrowserPanel,
  type BrowserLiveFrame,
  type BrowserMouseKeyboardInput,
} from "./features/browser/InAppBrowserPanel";
import { UserBrowsingLogInspector } from "./features/browser/BrowserTeachBar";
import { getCriativoDesktopBridge } from "./types/desktop-bridge";
import {
  LiveVoiceBar,
  QuickAgentDrawer,
} from "./features/settings/LiveVoiceAndQuickDrawer";
import {
  DEFAULT_FRONTEND_DOCK_SETTINGS,
  resolveEffectiveDockAgentIds,
} from "./features/settings/SettingsGeneralTabs";
import {
  DEFAULT_FRONTEND_USER_SETTINGS,
  SettingsModal,
  type SettingsModalTabId,
  applyUserSettingsToDocument,
} from "./features/settings/SettingsModal";
import type { WorkflowEventSignal } from "./features/workflows/WorkflowsCanvasPage";
import { WorkflowsCanvasPage } from "./features/workflows/WorkflowsCanvasPage";
import { LicenseActivationGate } from "./features/license/LicenseActivationGate";
import {
  JoinServerModal,
  NewLocalServerModal,
  NewRemoteServerClaimModal,
  ServerSettingsModal,
} from "./features/servers/ServerModals";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "./services/websocket-client";

const USER_SETTINGS_STORAGE_KEY = "criativo_user_settings";
const LAST_TAB_STORAGE_KEY = "criativo_last_tab_id";
const SIDEBAR_WIDTH_KEY = "criativo_sidebar_width";
const INSPECTOR_WIDTH_KEY = "criativo_inspector_width";
const AGENT_DOCK_PINNED_KEY = "criativo.agent_dock.pinned";
const DEFAULT_SIDEBAR_WIDTH = 276;
const DEFAULT_INSPECTOR_WIDTH = 330;

function clampWidth(val: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function readStoredWidth(key: string, min: number, max: number, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return clampWidth(Number(raw), min, max, fallback);
  } catch {
    return fallback;
  }
}

function writeStoredWidth(key: string, width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // ignora quota de localStorage
  }
}

function readCachedUserSettings(): StudioUserSettings {
  if (typeof window === "undefined") return DEFAULT_FRONTEND_USER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_FRONTEND_USER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioUserSettings>;
    return {
      geral: { ...DEFAULT_FRONTEND_USER_SETTINGS.geral, ...(parsed.geral ?? {}) },
      aparencia: { ...DEFAULT_FRONTEND_USER_SETTINGS.aparencia, ...(parsed.aparencia ?? {}) },
      comportamento: {
        ...DEFAULT_FRONTEND_USER_SETTINGS.comportamento,
        ...(parsed.comportamento ?? {}),
      },
      dock: {
        ...DEFAULT_FRONTEND_DOCK_SETTINGS,
        ...(parsed.dock ?? {}),
      },
      notificacoes: {
        ...DEFAULT_FRONTEND_USER_SETTINGS.notificacoes,
        ...(parsed.notificacoes ?? {}),
      },
      voz: { ...DEFAULT_FRONTEND_USER_SETTINGS.voz, ...(parsed.voz ?? {}) },
      atualizado_em:
        typeof parsed.atualizado_em === "string"
          ? parsed.atualizado_em
          : DEFAULT_FRONTEND_USER_SETTINGS.atualizado_em,
    };
  } catch {
    return DEFAULT_FRONTEND_USER_SETTINGS;
  }
}

type AgenteEnriquecido = AgenteRegistro & {
  nao_lidas?: number;
  ultima_mensagem?: string | null;
  ultima_mensagem_em?: string | null;
};

type AgentCenterMode =
  | { type: "agent"; agenteId: string }
  | { type: "thread"; agenteId: string; threadId: string }
  | { type: "channel"; canalId: string }
  | { type: "new_agent" };

function getThreadLaneKey(agenteId: string, threadId?: string | null): string {
  return `${agenteId}:${threadId ?? "main"}`;
}

function getAgentAvatar(ag?: AgenteRegistro | null) {
  return resolveAgentAvatarConfig(ag);
}

function mergeUniqueMessages(
  current: MensagemChat[],
  incoming: MensagemChat[]
): MensagemChat[] {
  const map = new Map<string, MensagemChat>();
  for (const m of current) map.set(m.mensagem_id, m);
  for (const m of incoming) map.set(m.mensagem_id, m);
  return Array.from(map.values()).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
}

export function App() {
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
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([
    "estrategista",
    "copywriter",
    "designer_carrossel",
  ]);

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
        .readThreadMessages(threadId, { limit: 50 })
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
        .readAgentMessagesPage(centerMode.agenteId, { limit: 50 })
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

  // Assinatura WebSocket ao vivo
  useEffect(() => {
    const ws = new WebSocketClient();
    wsRef.current = ws;
    const unsubConn = ws.onConnectionChange((connected, reconnected) => {
      setWsConnected(connected);
      if (connected && reconnected) {
        void hydrateAll();
      }
    });

    const unsubQueued = ws.on("task:queued", () => {
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubStarted = ws.on("task:started", (evt) => {
      setSelectedTaskId(evt.tarefa_id);
      setThoughtStream("");
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubStep = ws.on("agent:step", (evt) => {
      setSteps((prev) => [
        ...prev.slice(-80),
        {
          id: `${evt.tarefa_id}-${evt.step_index}-${Date.now()}`,
          tarefa_id: evt.tarefa_id,
          agente_id: evt.agente_id,
          step_index: evt.step_index,
          ferramenta: evt.ferramenta,
          input: evt.input,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
    const unsubThought = ws.on("agent:thought", (evt) => {
      setThoughtStream((prev) => (prev + evt.token_chunk).slice(-2400));
    });
    const unsubApproval = ws.on("task:awaiting_approval", (evt) => {
      setSelectedTaskId(evt.tarefa_id);
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubCompleted = ws.on("task:completed", () => {
      void daemonApi.listTasks().then(setTarefas);
      void daemonApi.getProvidersUsage().then(setUso);
    });
    const unsubFailed = ws.on("task:failed", () => {
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubWa = ws.on("whatsapp:status", (evt) => {
      setWhatsappStatus(evt.status);
      setWhatsappQr(evt.qrcode);
    });
    const unsubChat = ws.on("chat:message", (evt) => {
      if (evt.canal_id.startsWith("rotina:")) {
        setChatByKey((prev) => ({
          ...prev,
          [evt.canal_id]: mergeUniqueMessages(prev[evt.canal_id] ?? [], [evt.mensagem]),
        }));
        return;
      }
      if (evt.mensagem.thread_id && !evt.mensagem.thread_id.startsWith("main:")) {
        return;
      }
      setChatByKey((prev) => {
        const cleaned = (prev[evt.canal_id] ?? []).filter(
          (m) =>
            !(
              m.mensagem_id.startsWith("temp-") &&
              m.autor === evt.mensagem.autor &&
              m.conteudo_markdown === evt.mensagem.conteudo_markdown
            )
        );
        return {
          ...prev,
          [evt.canal_id]: mergeUniqueMessages(cleaned, [evt.mensagem]),
        };
      });
      if (evt.mensagem.autor === "agente") {
        setLiveRunByChat((prev) => {
          if (!prev[evt.canal_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.canal_id];
          return copy;
        });
      }
    });
    const unsubChatProgress = ws.on("chat:progress", (evt) => {
      setLiveRunByChat((prev) => {
        if (evt.fase === "concluido" || evt.fase === "erro") {
          if (!prev[evt.canal_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.canal_id];
          return copy;
        }
        const existing = prev[evt.canal_id] ?? {
          agenteId: evt.agente_id,
          agenteNome:
            agentes.find((a) => a.agente_id === evt.agente_id)?.nome ?? "Agente",
          startedAt: Date.now(),
          statusText: evt.mensagem_status ?? "Processando...",
          steps: [],
          streamingText: "",
        };
        let nextSteps = existing.steps;
        if (evt.step) {
          const step = evt.step;
          const idx = existing.steps.findIndex((s) => s.id === step.id);
          if (idx >= 0) {
            nextSteps = existing.steps.map((s, sIdx) => (sIdx === idx ? step : s));
          } else {
            nextSteps = [...existing.steps, step];
          }
        }
        return {
          ...prev,
          [evt.canal_id]: {
            ...existing,
            statusText: evt.mensagem_status ?? existing.statusText,
            steps: nextSteps,
            streamingText: evt.delta
              ? existing.streamingText + evt.delta
              : existing.streamingText,
          },
        };
      });
    });
    const unsubProv = ws.on("provider:updated", () => {
      void daemonApi.listProvidersStatus(false).then(setProvedores).catch(() => {});
      void daemonApi.getProvidersUsage(false).then(setUso).catch(() => {});
    });
    const unsubAuthUrl = ws.on("provider:auth_url", (evt) => {
      setPendingAuthLink(evt);
      void (async () => {
        const currentServerId = getActiveServerId();
        if (
          currentServerId &&
          currentServerId !== "primary" &&
          (evt.provedor === "openai" || evt.provedor === "claude") &&
          desktopAssistedProviderRef.current !== evt.provedor
        ) {
          await daemonApi
            .prepararPonteOAuthRemoto(currentServerId, evt.provedor, evt.url)
            .catch(() => null);
        }
        try {
          if (typeof window !== "undefined") {
            window.open(evt.url, "_blank", "noopener,noreferrer");
          }
        } catch {
          // fallback visível pelo botão clicável direto na interface
        }
      })();
    });

    const unsubWaConta = ws.on("whatsapp.conta_atualizada", () => {
      void daemonApi.listWhatsAppAccounts().then(setWhatsappAccounts).catch(() => {});
    });
    const unsubMcpOAuthReq = ws.on("mcp.oauth_solicitado", (evt) => {
      setPendingMcpSignIn({
        mcpId: evt.mcp_id,
        nome: evt.nome,
        appSlug: evt.app_slug ?? null,
        status: "pending",
        errorMessage: null,
      });
    });
    const unsubMcpOAuthDone = ws.on("mcp.oauth_concluido", (evt) => {
      setPendingMcpSignIn((prev) =>
        prev && prev.mcpId === evt.mcp_id
          ? {
              ...prev,
              status: evt.sucesso ? "connected" : "error",
              errorMessage: evt.sucesso ? null : evt.erro ?? "Autenticação falhou.",
            }
          : prev
      );
      void daemonApi.listConnectors().then(setConectores).catch(() => {});
    });
    const unsubLojaSkill = ws.on("loja.skill_atualizada", () => {
      void daemonApi.listSkills().then(setHabilidades).catch(() => {});
    });
    const unsubLojaAgente = ws.on("loja.agente_instalado", () => {
      void daemonApi.listAgents().then(setAgentes).catch(() => {});
    });

    const unsubRoutineUpdated = ws.on("routine:updated", () => {
      setRoutinesRefreshNonce((n) => n + 1);
      void refreshRoutineCounts();
    });
    const unsubRoutineRunUpdated = ws.on("routine:run_updated", () => {
      setRoutinesRefreshNonce((n) => n + 1);
      setFlowRefreshNonce((n) => n + 1);
    });
    const unsubRoutineWebhook = ws.on("routine:webhook_received", () => {
      setRoutinesRefreshNonce((n) => n + 1);
    });
    const unsubRoutineFlowUpdated = ws.on("routine_flow:updated", () => {
      setFlowRefreshNonce((n) => n + 1);
    });
    const unsubRoutineNotification = ws.on("routine:notification", (evt) => {
      setRoutineNotifications((prev) => [
        ...prev.slice(-3),
        {
          id: `${evt.rotina_id}-${evt.execucao_id}-${Date.now()}`,
          rotina_nome: evt.rotina_nome,
          resumo: evt.resumo,
          owner_id: evt.owner_id,
        },
      ]);
    });

    const unsubWorkflowUpdated = ws.on("workflow:updated", (evt) => {
      void daemonApi.listWorkflows().then(setWorkflows).catch(() => {});
      setWorkflowEventSignal((prev) => ({
        nonce: prev.nonce + 1,
        workflowId: evt.workflow_id,
        type: "updated",
      }));
    });
    const unsubWorkflowRunUpdated = ws.on("workflow:run_updated", (evt) => {
      setWorkflowEventSignal((prev) => ({
        nonce: prev.nonce + 1,
        workflowId: evt.workflow_id,
        runId: evt.run_id,
        type: "run_updated",
      }));
    });
    const unsubWorkflowStepUpdated = ws.on("workflow:step_updated", (evt) => {
      setWorkflowEventSignal((prev) => ({
        nonce: prev.nonce + 1,
        workflowId: evt.workflow_id,
        runId: evt.run_id ?? undefined,
        type: "step_updated",
      }));
    });

    // Fase 13 — Eventos reativos isolados por thread/fila/espera/fixação/reset
    const unsubThreadsChanged = ws.on("threads:changed", (evt) => {
      setThreadsByAgent((prev) => ({ ...prev, [evt.agente_id]: evt.snapshot }));
      setAllThreads((prev) => {
        const others = prev.filter((t) => t.agente_id !== evt.agente_id);
        return [...others, ...evt.snapshot.threads].sort((a, b) =>
          b.atualizado_em.localeCompare(a.atualizado_em)
        );
      });
    });

    const unsubThreadMessage = ws.on("thread:message", (evt) => {
      setThreadChatById((prev) => {
        const cleaned = (prev[evt.thread_id] ?? []).filter(
          (m) =>
            !(
              m.mensagem_id.startsWith("temp-") &&
              m.autor === evt.mensagem.autor &&
              m.conteudo_markdown === evt.mensagem.conteudo_markdown
            )
        );
        return {
          ...prev,
          [evt.thread_id]: mergeUniqueMessages(cleaned, [evt.mensagem]),
        };
      });
      if (evt.mensagem.autor === "agente") {
        setLiveRunByThread((prev) => {
          if (!prev[evt.thread_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.thread_id];
          return copy;
        });
      }
    });

    const unsubThreadProgress = ws.on("thread:progress", (evt) => {
      setLiveRunByThread((prev) => {
        if (evt.fase === "concluido" || evt.fase === "erro") {
          if (!prev[evt.thread_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.thread_id];
          return copy;
        }
        const existing = prev[evt.thread_id] ?? {
          agenteId: evt.agente_id,
          agenteNome: "Sub-tarefa",
          startedAt: Date.now(),
          statusText: evt.mensagem_status ?? "Executando em paralelo...",
          steps: [],
          streamingText: "",
        };
        let nextSteps = existing.steps;
        if (evt.step) {
          const step = evt.step;
          const idx = existing.steps.findIndex((s) => s.id === step.id);
          nextSteps =
            idx >= 0
              ? existing.steps.map((s, sIdx) => (sIdx === idx ? step : s))
              : [...existing.steps, step];
        }
        return {
          ...prev,
          [evt.thread_id]: {
            ...existing,
            statusText: evt.mensagem_status ?? existing.statusText,
            steps: nextSteps,
            streamingText: evt.delta
              ? existing.streamingText + evt.delta
              : existing.streamingText,
          },
        };
      });
    });

    const unsubWaitsChanged = ws.on("waits:changed", (evt) => {
      setWaitsByAgent((prev) => ({ ...prev, [evt.agente_id]: evt.esperas }));
    });

    const unsubChatQueueChanged = ws.on("chat_queue:changed", (evt) => {
      setQueueByLane((prev) => ({
        ...prev,
        [getThreadLaneKey(evt.agente_id, evt.thread_id)]: evt.snapshot,
      }));
    });

    const unsubPinsChanged = ws.on("pins:changed", (evt) => {
      setPinsByAgent((prev) => ({ ...prev, [evt.agente_id]: evt.pins }));
    });

    const unsubContextReset = ws.on("context:reset", (evt) => {
      const key = `agente:${evt.agente_id}`;
      setChatByKey((prev) => ({
        ...prev,
        [key]: mergeUniqueMessages(prev[key] ?? [], [evt.mensagem_divisor]),
      }));
    });

    // Fase 14 — Eventos reativos de UI Blocks, Reações, Memórias, Skills, Pastas, SQL e Handoffs
    const unsubChatUiBlock = ws.on("chat:ui_block", (evt) => {
      const upsertBlockInList = (list: MensagemChat[]): MensagemChat[] => {
        const exists = list.some((m) => m.mensagem_id === evt.mensagem_id);
        if (exists) {
          return list.map((m) =>
            m.mensagem_id === evt.mensagem_id
              ? { ...m, item_type: "ui-block", ui_block: evt.bloco }
              : m
          );
        }
        const syntheticMsg: MensagemChat = {
          mensagem_id: evt.mensagem_id,
          canal_id: evt.canal_id,
          agente_id: evt.agente_id,
          autor: "agente",
          conteudo_markdown: "",
          anexos: [],
          steps: [],
          item_type: "ui-block",
          ui_block: evt.bloco,
          lida: true,
          criado_em: evt.bloco.criado_em,
        };
        return mergeUniqueMessages(list, [syntheticMsg]);
      };

      if (evt.canal_id.startsWith("thread:")) {
        const thId = evt.canal_id.slice("thread:".length);
        setThreadChatById((prev) => ({
          ...prev,
          [thId]: upsertBlockInList(prev[thId] ?? []),
        }));
      } else {
        setChatByKey((prev) => ({
          ...prev,
          [evt.canal_id]: upsertBlockInList(prev[evt.canal_id] ?? []),
        }));
      }
    });

    const unsubChatReaction = ws.on("chat:reaction", (evt) => {
      if (evt.canal_id.startsWith("thread:")) {
        const thId = evt.canal_id.slice("thread:".length);
        setThreadChatById((prev) => ({
          ...prev,
          [thId]: (prev[thId] ?? []).map((m) =>
            m.mensagem_id === evt.mensagem_id ? { ...m, reacao_emoji: evt.emoji } : m
          ),
        }));
      } else {
        setChatByKey((prev) => ({
          ...prev,
          [evt.canal_id]: (prev[evt.canal_id] ?? []).map((m) =>
            m.mensagem_id === evt.mensagem_id ? { ...m, reacao_emoji: evt.emoji } : m
          ),
        }));
      }
    });

    const unsubMemoryReviewed = ws.on("memory:reviewed", (evt) => {
      const key = `agente:${evt.agente_id}`;
      void daemonApi
        .readAgentMessagesPage(evt.agente_id, { limit: 50 })
        .then((pagina) => {
          setChatByKey((prev) =>
            prev[key] ? { ...prev, [key]: mergeUniqueMessages(prev[key], pagina.mensagens) } : prev
          );
        })
        .catch(() => {});
    });

    const unsubSkillSuggested = ws.on("skill:suggested", (evt) => {
      const key = `agente:${evt.agente_id}`;
      void daemonApi
        .readAgentMessagesPage(evt.agente_id, { limit: 50 })
        .then((pagina) => {
          setChatByKey((prev) => ({
            ...prev,
            [key]: mergeUniqueMessages(prev[key] ?? [], pagina.mensagens),
          }));
        })
        .catch(() => {});
      void daemonApi.listSkills().then(setHabilidades).catch(() => {});
    });

    const unsubLibraryFoldersChanged = ws.on("library:folders_changed", () => {
      void daemonApi.listLibraryFolders().then(setFoldersSnapshot).catch(() => {});
      void daemonApi.listFiles().then(setArquivos).catch(() => {});
    });

    const unsubSharedTableChanged = ws.on("shared_table:changed", () => {
      setSharedTablesRefreshNonce((n) => n + 1);
    });

    const unsubAgentMessageQueued = ws.on("agent:message_queued", (evt) => {
      void refreshAgentThreadsState(evt.para_agente_id, null);
      const targetKey = `agente:${evt.para_agente_id}`;
      void daemonApi
        .readAgentMessagesPage(evt.para_agente_id, { limit: 50 })
        .then((pagina) => {
          setChatByKey((prev) =>
            prev[targetKey]
              ? { ...prev, [targetKey]: mergeUniqueMessages(prev[targetKey], pagina.mensagens) }
              : prev
          );
        })
        .catch(() => {});
    });

    // Fase 15 — Navegador CDP, Takeover, Captura de Tela, Sidebar, Settings & Showcase
    const unsubBrowserFrame = ws.on("browser:frame", (evt) => {
      setActiveTakeoverFrame(evt);
      setBrowserFramesByTab((prev) => ({
        ...prev,
        [evt.tabId]: {
          tabId: evt.tabId,
          dataUrl: evt.dataUrl,
          width: evt.width,
          height: evt.height,
          url: evt.url,
          title: evt.title,
          userControl: evt.userControl,
        },
      }));
      setBrowserTabs((prev) =>
        prev.map((t) =>
          t.tabId === evt.tabId
            ? { ...t, url: evt.url, title: evt.title, userControl: evt.userControl }
            : t
        )
      );
      setActiveTakeoverModal((prev) =>
        prev && prev.tabId === evt.tabId
          ? { ...prev, url: evt.url, title: evt.title, previewDataUrl: evt.dataUrl }
          : prev
      );
    });

    const unsubBrowserTabs = ws.on("browser:tabs_updated", (evt) => {
      const nextTabs = Array.isArray(evt.tabs) ? evt.tabs : [];
      setBrowserTabs(nextTabs);
      setBrowserStatus((prev) =>
        prev
          ? { ...prev, activeTabs: nextTabs.length, tabs: nextTabs }
          : { available: true, executablePath: null, activeContexts: nextTabs.length > 0 ? 1 : 0, activeTabs: nextTabs.length, tabs: nextTabs }
      );
      if (nextTabs.length === 0) {
        setActiveBrowserTabId(null);
        setBrowserPanelMode("closed");
      } else {
        setActiveBrowserTabId((prev) => {
          if (evt.activeTabId && nextTabs.some((t) => t.tabId === evt.activeTabId)) {
            return evt.activeTabId;
          }
          if (prev && nextTabs.some((t) => t.tabId === prev)) {
            return prev;
          }
          return nextTabs[0]!.tabId;
        });
        setBrowserPanelMode((cur) => (cur === "closed" ? "sidebar" : cur));
      }
    });

    const unsubTakeoverReq = ws.on("browser:takeover_requested", (evt) => {
      const agKey = evt.agenteId ?? "global";
      setTakeoverByAgent((prev) => ({ ...prev, [agKey]: evt }));
      setActiveBrowserTabId(evt.tabId);
      setBrowserPanelMode((cur) => (cur === "closed" ? "sidebar" : cur));
    });

    const unsubTakeoverRes = ws.on("browser:takeover_resolved", (evt) => {
      setTakeoverByAgent((prev) => {
        const next: Record<string, BrowserTakeoverSession> = {};
        for (const [k, s] of Object.entries(prev)) {
          if (s.tabId !== evt.tabId) next[k] = s;
        }
        return next;
      });
      setBrowserTabs((prev) =>
        prev.map((t) => (t.tabId === evt.tabId ? { ...t, userControl: false } : t))
      );
      setBrowserFramesByTab((prev) =>
        prev[evt.tabId]
          ? { ...prev, [evt.tabId]: { ...prev[evt.tabId]!, userControl: false } }
          : prev
      );
      setActiveTakeoverModal((prev) => (prev && prev.tabId === evt.tabId ? null : prev));
    });

    const unsubTeachStatus = ws.on("browser:teach_status", (evt) => {
      setTeachStatusByTab((prev) => ({
        ...prev,
        [evt.tabId]: {
          recording: evt.recording,
          startedAt: evt.startedAt,
          stepsCount: evt.stepsCount,
        },
      }));
    });

    const unsubScreenCapture = ws.on("screen:capture_requested", (evt) => {
      setCaptureByAgent((prev) => ({ ...prev, [evt.agenteId]: evt }));
    });

    const unsubSidebarUpdated = ws.on("sidebar:updated", () => {
      void daemonApi.getSidebarLayout().then(setSidebarLayout).catch(() => {});
      void daemonApi.listAgents().then(setAgentes).catch(() => {});
      void daemonApi.listDeletedNativeAgents().then(setDeletedNativeAgents).catch(() => {});
    });

    const unsubSettingsUpdated = ws.on("settings:updated", () => {
      void daemonApi
        .getUserSettings()
        .then((s) => {
          setUserSettings(s);
          applyUserSettingsToDocument(s);
        })
        .catch(() => {});
    });

    const unsubShowcaseUpdated = ws.on("showcase:updated", () => {
      void daemonApi.listShowcaseSites().then(setShowcaseSites).catch(() => {});
    });

    const unsubLicenseUpdated = ws.on("license:updated", (evt) => {
      setLicenseStatus(evt);
      if (evt.valid) {
        void hydrateAll();
      }
    });

    const unsubServersUpdated = ws.on("servers:updated", () => {
      void daemonApi
        .listarServidores()
        .then((snap) => {
          setServers(snap.servers);
          setServerQuota(snap.quota);
        })
        .catch(() => {});
    });

    const unsubUpdateStatus = ws.on("update:status", (nextStatus) => {
      setUpdateStatus(nextStatus);
    });

    const unsubOnboardingUpdated = ws.on("onboarding:updated", (evt) => {
      setOnboarding(evt.onboarding);
      void daemonApi.listAgents().then(setAgentes).catch(() => {});
    });

    const unsubVpsAssistantUpdated = ws.on("vps_assistant:updated", () => {
      void daemonApi.listAgents().then(setAgentes).catch(() => {});
    });

    setOnLicenseRequiredHandler((status) => {
      if (status) {
        setLicenseStatus(status);
      } else {
        void daemonApi.obterStatusLicenca().then(setLicenseStatus).catch(() => {});
      }
    });

    ws.connect();
    return () => {
      setOnLicenseRequiredHandler(null);
      unsubConn();
      unsubQueued();
      unsubStarted();
      unsubStep();
      unsubThought();
      unsubApproval();
      unsubCompleted();
      unsubFailed();
      unsubWa();
      unsubChat();
      unsubChatProgress();
      unsubProv();
      unsubAuthUrl();
      unsubWaConta();
      unsubMcpOAuthReq();
      unsubMcpOAuthDone();
      unsubLojaSkill();
      unsubLojaAgente();
      unsubRoutineUpdated();
      unsubRoutineRunUpdated();
      unsubRoutineWebhook();
      unsubRoutineFlowUpdated();
      unsubRoutineNotification();
      unsubWorkflowUpdated();
      unsubWorkflowRunUpdated();
      unsubWorkflowStepUpdated();
      unsubThreadsChanged();
      unsubThreadMessage();
      unsubThreadProgress();
      unsubWaitsChanged();
      unsubChatQueueChanged();
      unsubPinsChanged();
      unsubContextReset();
      unsubChatUiBlock();
      unsubChatReaction();
      unsubMemoryReviewed();
      unsubSkillSuggested();
      unsubLibraryFoldersChanged();
      unsubSharedTableChanged();
      unsubAgentMessageQueued();
      unsubBrowserFrame();
      unsubBrowserTabs();
      unsubTakeoverReq();
      unsubTakeoverRes();
      unsubTeachStatus();
      unsubScreenCapture();
      unsubSidebarUpdated();
      unsubSettingsUpdated();
      unsubShowcaseUpdated();
      unsubLicenseUpdated();
      unsubServersUpdated();
      unsubUpdateStatus();
      unsubOnboardingUpdated();
      unsubVpsAssistantUpdated();
      wsRef.current = null;
      ws.disconnect();
    };
  }, [hydrateAll, refreshAgentThreadsState, refreshRoutineCounts]);

  const handleApplyUpdate = useCallback(async () => {
    const win = typeof window !== "undefined"
      ? (window as Window & {
          criativoDesktop?: {
            isPackagedDesktop?: boolean;
            triggerUpdateInstall?: () => Promise<unknown>;
          };
        })
      : null;

    if (updateStatus?.state === "ready_to_restart") {
      await daemonApi.triggerUpdateRestart().catch(() => {});
      return;
    }

    if (win?.criativoDesktop?.isPackagedDesktop && win.criativoDesktop.triggerUpdateInstall) {
      await win.criativoDesktop.triggerUpdateInstall();
      const refreshed = await daemonApi.obterStatusAtualizacao().catch(() => null);
      if (refreshed) setUpdateStatus(refreshed);
      return;
    }

    const next = await daemonApi.aplicarAtualizacao({ restart: true });
    setUpdateStatus(next);
  }, [updateStatus?.state]);

  const persistLayoutWidths = useCallback(
    (patch: {
      sidebar_width?: number;
      inspector_width?: number;
      sidebar_open?: boolean;
      inspector_open?: boolean;
      focus_mode?: boolean;
    }) => {
      if (layoutPersistTimerRef.current) {
        clearTimeout(layoutPersistTimerRef.current);
      }
      layoutPersistTimerRef.current = setTimeout(() => {
        setUserSettings((prev) => {
          const nextSettings: StudioUserSettings = {
            ...prev,
            aparencia: {
              ...prev.aparencia,
              ...(typeof patch.sidebar_width === "number" ? { sidebar_width: patch.sidebar_width } : {}),
              ...(typeof patch.inspector_width === "number" ? { inspector_width: patch.inspector_width } : {}),
            },
            comportamento: {
              ...prev.comportamento,
              ...(typeof patch.sidebar_open === "boolean" ? { sidebar_open: patch.sidebar_open } : {}),
              ...(typeof patch.inspector_open === "boolean" ? { inspector_open: patch.inspector_open } : {}),
              ...(typeof patch.focus_mode === "boolean" ? { focus_mode: patch.focus_mode } : {}),
            },
          };
          void daemonApi.updateUserSettings(nextSettings).catch(() => {});
          return nextSettings;
        });
      }, 280);
    },
    []
  );

  const handleToggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const nextFocus = !prev;
      const nextSidebar = !nextFocus;
      const nextInspector = !nextFocus;
      setSidebarOpen(nextSidebar);
      setInspectorOpen(nextInspector);
      persistLayoutWidths({
        focus_mode: nextFocus,
        sidebar_open: nextSidebar,
        inspector_open: nextInspector,
      });
      return nextFocus;
    });
  }, [persistLayoutWidths]);

  const handleResetLayoutWidths = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
    setSidebarOpen(true);
    setInspectorOpen(true);
    setFocusMode(false);
    writeStoredWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
    writeStoredWidth(INSPECTOR_WIDTH_KEY, DEFAULT_INSPECTOR_WIDTH);
    persistLayoutWidths({
      sidebar_width: DEFAULT_SIDEBAR_WIDTH,
      inspector_width: DEFAULT_INSPECTOR_WIDTH,
      sidebar_open: true,
      inspector_open: true,
      focus_mode: false,
    });
  }, [persistLayoutWidths]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (evt: KeyboardEvent) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key === "\\") {
        evt.preventDefault();
        handleToggleFocusMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleFocusMode]);

  const handleSwitchServer = useCallback(
    async (serverId: string) => {
      setBootLoading(true);
      try {
        const res = await daemonApi.selecionarServidor(serverId);
        setServers(res.servers);
        setActiveServerIdState(res.active_server_id);
        setOnboarding(null);
        setUso(null);
        setActiveSideThreadId(null);
        setChatByKey({});
        setThreadChatById({});
        setLiveRunByChat({});
        setLiveRunByThread({});
        setOpenTabs([
          { id: "agent:estrategista", titulo: "Estrategista Editorial", shape: "hex", color: "#31cf76" },
        ]);
        setActiveTabId("agent:estrategista");
        setCenterMode({ type: "agent", agenteId: "estrategista" });
        setActiveSection("agentes");
        restoredLastTabRef.current = false;
        wsRef.current?.reconnectForServer(res.active_server_id);
        void getCriativoDesktopBridge()?.dockSyncActiveServer?.(res.active_server_id);
        await hydrateAll();
      } catch {
        // toast/error silencioso; status permanece no servidor atual
      } finally {
        setBootLoading(false);
      }
    },
    [hydrateAll]
  );

  const handleConfigureServerWithAgent = useCallback(
    async (promptText: string, _claim: ServerClaimTicket | null) => {
      setNewRemoteModalOpen(false);
      setActiveSection("agentes");

      let poolAgents = agentes;
      try {
        await daemonApi.setVpsAssistantState("reopen");
        const nextAgents = await daemonApi.listAgents({ includeVps: true });
        if (nextAgents.length > 0) {
          poolAgents = nextAgents;
          setAgentes(nextAgents);
        }
      } catch {
        // segue com lista atual caso backend legado
      }

      const targetAgent =
        poolAgents.find((a) => a.agente_id === "assistente_servidor_vps") ??
        poolAgents.find((a) => a.agente_id === "estrategista") ??
        poolAgents[0];
      const targetAgentId = targetAgent?.agente_id ?? "assistente_servidor_vps";
      const vis = getAgentAvatar(targetAgent);
      setOpenTabs((prev) =>
        prev.some((t) => t.id === `agent:${targetAgentId}`)
          ? prev
          : [
              ...prev,
              {
                id: `agent:${targetAgentId}`,
                titulo: targetAgent?.nome ?? "Especialista em Servidor VPS",
                shape: vis.shape,
                color: vis.color,
              },
            ]
      );
      setActiveTabId(`agent:${targetAgentId}`);
      setCenterMode({ type: "agent", agenteId: targetAgentId });

      const targetKey = `agente:${targetAgentId}`;
      const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const optimisticMsg: MensagemChat = {
        mensagem_id: optimisticId,
        canal_id: targetKey,
        agente_id: targetAgentId,
        autor: "usuario",
        autor_nome: "Você",
        conteudo_markdown: promptText,
        anexos: [],
        steps: [],
        tarefa_id: null,
        lida: true,
        criado_em: new Date().toISOString(),
      };
      setChatByKey((prev) => ({
        ...prev,
        [targetKey]: mergeUniqueMessages(prev[targetKey] ?? [], [optimisticMsg]),
      }));
      try {
        const res = await daemonApi.sendAgentMessage(targetAgentId, promptText, []);
        setChatByKey((prev) => {
          const withoutTemp = (prev[targetKey] ?? []).filter((m) => m.mensagem_id !== optimisticId);
          const extras = [res.mensagem_usuario, res.mensagem_agente, ...(res.mensagens_handoff ?? [])].filter(
            (x): x is MensagemChat => Boolean(x)
          );
          return {
            ...prev,
            [targetKey]: mergeUniqueMessages(withoutTemp, extras),
          };
        });
      } catch {
        setPrefilledChatPrompt(promptText);
      }
    },
    [agentes]
  );

  const navHistoryRef = useRef<AgentCenterMode[]>([{ type: "agent", agenteId: "estrategista" }]);
  const navIndexRef = useRef<number>(0);

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

  const activeAgent = useMemo(() => {
    if (centerMode.type !== "agent" && centerMode.type !== "thread") return null;
    return agentes.find((a) => a.agente_id === centerMode.agenteId) ?? agentes[0] ?? null;
  }, [agentes, centerMode]);

  const activeChannel = useMemo(() => {
    if (centerMode.type !== "channel") return null;
    return canais.find((c) => c.canal_id === centerMode.canalId) ?? null;
  }, [canais, centerMode]);

  const activeThread = useMemo(() => {
    if (!activeAgent) return null;
    const threadId =
      centerMode.type === "thread"
        ? centerMode.threadId
        : activeThreadIdByAgent[activeAgent.agente_id] ?? null;
    if (!threadId || threadId.startsWith("main:")) return null;
    return (
      threadsByAgent[activeAgent.agente_id]?.threads.find((t) => t.thread_id === threadId) ??
      allThreads.find((t) => t.thread_id === threadId) ??
      null
    );
  }, [activeAgent, activeThreadIdByAgent, allThreads, centerMode, threadsByAgent]);

  const activeThreadKey =
    centerMode.type === "thread"
      ? centerMode.threadId
      : activeAgent
        ? `main:${activeAgent.agente_id}`
        : "";

  const workingAgentIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const [key, run] of Object.entries(liveRunByChat)) {
      if (run?.agenteId) ids.add(run.agenteId);
      if (key.startsWith("agente:")) ids.add(key.slice("agente:".length));
    }
    for (const [thId, run] of Object.entries(liveRunByThread)) {
      if (run?.agenteId) {
        ids.add(run.agenteId);
        continue;
      }
      const matched = allThreads.find((t) => t.thread_id === thId);
      if (matched?.agente_id) ids.add(matched.agente_id);
    }
    for (const ag of agentes) {
      if (ag.status === "trabalhando") ids.add(ag.agente_id);
    }
    return ids;
  }, [agentes, allThreads, liveRunByChat, liveRunByThread]);

  const agentActivityByAgentId = useMemo<
    Record<string, { mood: MascotEyeMood; activity: AvatarTaskContext }>
  >(() => {
    const out: Record<string, { mood: MascotEyeMood; activity: AvatarTaskContext }> = {};

    for (const ag of agentes) {
      const id = ag.agente_id;
      const runFromChat = liveRunByChat[`agente:${id}`];
      const threadEntry = Object.entries(liveRunByThread).find(([thId, r]) => {
        if (r?.agenteId === id) return true;
        return allThreads.some((t) => t.thread_id === thId && t.agente_id === id);
      });
      const activeRun = runFromChat ?? threadEntry?.[1] ?? null;
      const awaitingTakeover = Boolean(takeoverByAgent[id]);

      const agentTasks = tarefas.filter((t) => t.agente_id === id);
      const runningTask = agentTasks.find((t) => t.status === "executando");
      const waitingTask = agentTasks.find((t) => t.status === "aguardando_aprovacao");
      const recentFailedTask = agentTasks.find((t) => t.status === "falha");

      const isWorking = workingAgentIds.has(id);
      const lastStep = activeRun?.steps?.[activeRun.steps.length - 1];

      let mood: MascotEyeMood = "idle";
      if (recentFailedTask && !isWorking && !activeRun) {
        mood = "failed";
      } else if (awaitingTakeover || waitingTask) {
        mood = "waiting";
      } else if (isWorking || activeRun || runningTask) {
        mood = "working";
      }

      const activity = inferTaskContextFromActivity({
        mood,
        toolName: lastStep?.ferramenta ?? null,
        statusText:
          activeRun?.statusText ??
          lastStep?.titulo ??
          runningTask?.titulo ??
          recentFailedTask?.titulo ??
          null,
        isStreaming: Boolean(activeRun?.streamingText),
        awaitingApproval: awaitingTakeover || Boolean(waitingTask),
        agentStatus: ag.status,
      });

      out[id] = { mood, activity };
    }

    return out;
  }, [agentes, allThreads, liveRunByChat, liveRunByThread, takeoverByAgent, tarefas, workingAgentIds]);

  const dynamicIslandTabs = useMemo<StudioTabItem[]>(() => {
    if (centerMode.type === "channel") {
      const ch = activeChannel;
      return [
        {
          id: `channel:${centerMode.canalId}`,
          titulo: ch?.nome ?? centerMode.canalId,
          kind: "agent",
          closable: false,
          shape: "rounded_square",
          color: "#31cf76",
        },
      ];
    }

    if (centerMode.type === "new_agent") {
      return [
        {
          id: "new-agent",
          titulo: "Novo agente",
          kind: "agent",
          closable: false,
          shape: "rounded_square",
          color: "#38bdf8",
        },
      ];
    }

    const ag = activeAgent;
    if (!ag) return [];
    const vis = getAgentAvatar(ag);
    const live = agentActivityByAgentId[ag.agente_id];
    const agentTab: StudioTabItem = {
      id: `agent:${ag.agente_id}`,
      titulo: ag.nome,
      kind: "agent",
      closable: false,
      style: vis.style,
      shape: vis.shape,
      variant: vis.variant,
      color: vis.color,
      imageUrl: vis.imageUrl,
      working: workingAgentIds.has(ag.agente_id),
      mood: live?.mood,
      activity: live?.activity,
    };

    const agentThreads = (threadsByAgent[ag.agente_id]?.threads ?? allThreads.filter((t) => t.agente_id === ag.agente_id)).filter(
      (t) => !t.arquivada_em
    );

    const topicTabs: StudioTabItem[] = agentThreads.map((th) => {
      const customTab = openTabs.find((o) => o.id === `thread:${ag.agente_id}:${th.thread_id}`);
      const isWorking =
        Boolean(liveRunByThread[th.thread_id]) ||
        th.estado === "executando" ||
        th.turno_ativo_id !== null;
      return {
        id: `thread:${ag.agente_id}:${th.thread_id}`,
        titulo: customTab?.titulo || th.titulo || "Nova Subconversa",
        kind: "topic",
        closable: true,
        shape: vis.shape,
        color: vis.color,
        working: isWorking,
      };
    });

    return [agentTab, ...topicTabs];
  }, [
    activeAgent,
    activeChannel,
    agentActivityByAgentId,
    allThreads,
    centerMode,
    liveRunByThread,
    openTabs,
    threadsByAgent,
    workingAgentIds,
  ]);

  const headerActiveTabId = useMemo(() => {
    if (centerMode.type === "thread") {
      return `thread:${centerMode.agenteId}:${centerMode.threadId}`;
    }
    if (centerMode.type === "agent") {
      return `agent:${activeAgent?.agente_id ?? centerMode.agenteId}`;
    }
    if (centerMode.type === "channel") {
      return `channel:${centerMode.canalId}`;
    }
    if (centerMode.type === "new_agent") {
      return "new-agent";
    }
    return activeTabId;
  }, [activeAgent, activeTabId, centerMode]);

  const activeChatKey =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? activeSideThreadId
      : centerMode.type === "thread"
        ? `thread:${centerMode.threadId}`
        : centerMode.type === "channel"
          ? centerMode.canalId
          : centerMode.type === "agent"
            ? `agente:${activeAgent?.agente_id ?? "estrategista"}`
            : "";

  const activeMessages =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? chatByKey[activeSideThreadId] ?? []
      : centerMode.type === "thread"
        ? threadChatById[centerMode.threadId] ?? []
        : activeChatKey
          ? chatByKey[activeChatKey] ?? []
          : [];

  const activeLiveRun: ChatLiveRunState | null =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? liveRunByChat[activeSideThreadId] ?? null
      : centerMode.type === "thread"
        ? liveRunByThread[centerMode.threadId] ?? null
        : activeChatKey
          ? liveRunByChat[activeChatKey] ?? null
          : null;

  const activePaginationState = activeThreadKey ? threadPaginationById[activeThreadKey] : undefined;
  const activeLaneThreadId = centerMode.type === "thread" ? centerMode.threadId : null;
  const activeLaneKeyStr = activeAgent ? getThreadLaneKey(activeAgent.agente_id, activeLaneThreadId) : "";
  const activeQueueSnapshot = activeLaneKeyStr ? queueByLane[activeLaneKeyStr] ?? null : null;
  const activeEditingEntry = activeLaneKeyStr ? editingQueueByLane[activeLaneKeyStr] ?? null : null;

  const runningCount = useMemo(
    () => tarefas.filter((t) => t.status === "executando").length,
    [tarefas]
  );
  const pendingCount = useMemo(
    () => tarefas.filter((t) => t.status === "pendente").length,
    [tarefas]
  );
  const awaitingApprovalCount = useMemo(
    () => tarefas.filter((t) => t.status === "aguardando_aprovacao").length,
    [tarefas]
  );

  const previewTarefa = useMemo(
    () =>
      tarefas.find((t) => t.tarefa_id === selectedTaskId) ??
      tarefas.find((t) => t.status === "aguardando_aprovacao") ??
      tarefas[0] ??
      null,
    [tarefas, selectedTaskId]
  );

  const handleUploadFile = async (
    file: File,
    categoria?: "logo" | "foto" | "referencia" | "personagem" | "ficha_pdf" | "upload"
  ): Promise<AnexoChat> => {
    const uploaded = categoria
      ? (await daemonApi.uploadFileCategorized(file, categoria, activeAgent?.agente_id ?? null)).anexo
      : await daemonApi.uploadFile(file, activeAgent?.agente_id ?? null);
    const [refreshedFiles, refreshedFolders] = await Promise.all([
      daemonApi.listFiles(),
      daemonApi.listLibraryFolders().catch(() => null),
    ]);
    setArquivos(refreshedFiles);
    if (refreshedFolders) setFoldersSnapshot(refreshedFolders);
    return uploaded;
  };

  const handleDeleteFile = async (arquivoId: string): Promise<void> => {
    await daemonApi.deleteFile(arquivoId);
    setArquivos((prev) => prev.filter((a) => a.arquivo_id !== arquivoId));
    await refreshLibraryFolders();
  };

  const handleSubmitUiBlock = async (payload: UiBlockSubmitPayload): Promise<void> => {
    const res = await daemonApi.submitChatUiResponse(payload);
    if (payload.canal_id.startsWith("thread:")) {
      const thId = payload.canal_id.slice("thread:".length);
      setThreadChatById((prev) => ({
        ...prev,
        [thId]: (prev[thId] ?? []).map((m) =>
          m.ui_block?.bloco_id === payload.bloco_id ? { ...m, ui_block: res.bloco } : m
        ),
      }));
    } else {
      setChatByKey((prev) => ({
        ...prev,
        [payload.canal_id]: (prev[payload.canal_id] ?? []).map((m) =>
          m.ui_block?.bloco_id === payload.bloco_id ? { ...m, ui_block: res.bloco } : m
        ),
      }));
    }
    if (payload.api_key_payload) {
      const updatedKeys = await daemonApi.getVaultStatus().catch(() => null);
      if (updatedKeys) setVaultKeys(updatedKeys);
    }
  };

  const handleSaveSkillSuggestion = async (mensagemId: string): Promise<void> => {
    const res = await daemonApi.saveSkillSuggestion(mensagemId);
    setChatByKey((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
    setThreadChatById((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
    const nextSkills = await daemonApi.listSkills().catch(() => null);
    if (nextSkills) setHabilidades(nextSkills);
  };

  const handleDismissSkillSuggestion = async (mensagemId: string): Promise<void> => {
    const res = await daemonApi.dismissSkillSuggestion(mensagemId);
    setChatByKey((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
    setThreadChatById((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
  };

  const handleSendChatMessage = async (
    conteudo: string,
    anexos: AnexoChat[],
    pageContext?: string | null
  ) => {
    const payloadContent =
      pageContext && pageContext.trim().length > 0
        ? [conteudo.trim(), `[Contexto da página visual]\n${pageContext.trim()}`]
            .filter(Boolean)
            .join("\n\n")
        : conteudo;

    if (centerMode.type === "thread" && activeAgent) {
      const threadId = centerMode.threadId;
      const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const optimisticMsg: MensagemChat = {
        mensagem_id: optimisticId,
        canal_id: `thread:${threadId}`,
        thread_id: threadId,
        agente_id: activeAgent.agente_id,
        autor: "usuario",
        autor_nome: "Você",
        conteudo_markdown: conteudo || "Referências enviadas para sub-tarefa.",
        anexos,
        steps: [],
        tarefa_id: null,
        lida: true,
        criado_em: new Date().toISOString(),
      };
      setThreadChatById((prev) => ({
        ...prev,
        [threadId]: mergeUniqueMessages(prev[threadId] ?? [], [optimisticMsg]),
      }));
      const hadExistingRun = Boolean(liveRunByThread[threadId]);
      if (!hadExistingRun) {
        setLiveRunByThread((prev) => ({
          ...prev,
          [threadId]: {
            agenteId: activeAgent.agente_id,
            agenteNome: activeAgent.nome,
            startedAt: Date.now(),
            statusText: "Enviando para sub-thread paralela...",
            steps: [],
            streamingText: "",
          },
        }));
      }
      setSendingChat(true);
      let keepLiveRun = hadExistingRun;
      const currentTopicTitle = activeThread?.titulo;
      const currentTabTitle = openTabs.find(
        (t) => t.id === `thread:${activeAgent.agente_id}:${threadId}`
      )?.titulo;
      const shouldRenameTopicTab =
        (currentTopicTitle === "Nova Subconversa" ||
          currentTopicTitle === "Novo tópico" ||
          currentTabTitle === "Nova Subconversa" ||
          currentTabTitle === "Novo tópico") &&
        conteudo.trim().length > 0;
      if (shouldRenameTopicTab) {
        const cleanTitle = conteudo.trim().replace(/\s+/g, " ");
        const nextTitle = cleanTitle.length > 42 ? `${cleanTitle.slice(0, 39)}...` : cleanTitle;
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.id === `thread:${activeAgent.agente_id}:${threadId}`
              ? { ...tab, titulo: nextTitle }
              : tab
          )
        );
        setAllThreads((prev) =>
          prev.map((t) => (t.thread_id === threadId ? { ...t, titulo: nextTitle } : t))
        );
        setThreadsByAgent((prev) => {
          const snap = prev[activeAgent.agente_id];
          if (!snap) return prev;
          return {
            ...prev,
            [activeAgent.agente_id]: {
              ...snap,
              threads: snap.threads.map((t) =>
                t.thread_id === threadId ? { ...t, titulo: nextTitle } : t
              ),
            },
          };
        });
      }
      try {
        const res = await daemonApi.sendThreadMessage(threadId, payloadContent, anexos);
        if (res.enfileirada || res.steered) {
          keepLiveRun = true;
          setThreadChatById((prev) => ({
            ...prev,
            [threadId]: mergeUniqueMessages(
              (prev[threadId] ?? []).filter((m) => m.mensagem_id !== optimisticId),
              res.mensagem_usuario ? [res.mensagem_usuario] : []
            ),
          }));
          await refreshAgentThreadsState(activeAgent.agente_id, threadId);
        } else {
          setThreadChatById((prev) => ({
            ...prev,
            [threadId]: mergeUniqueMessages(
              (prev[threadId] ?? []).filter((m) => m.mensagem_id !== optimisticId),
              [res.mensagem_usuario, res.mensagem_agente].filter(
                (x): x is MensagemChat => Boolean(x)
              )
            ),
          }));
          if (shouldRenameTopicTab) {
            await refreshAgentThreadsState(activeAgent.agente_id, threadId);
          }
        }
      } finally {
        if (!keepLiveRun) {
          setLiveRunByThread((prev) => {
            if (!prev[threadId]) return prev;
            const copy = { ...prev };
            delete copy[threadId];
            return copy;
          });
        }
        setSendingChat(false);
      }
      return;
    }

    const targetKey =
      centerMode.type === "channel" && activeChannel
        ? activeChannel.canal_id
        : activeAgent
          ? `agente:${activeAgent.agente_id}`
          : "";
    if (!targetKey) return;

    const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const optimisticMsg: MensagemChat = {
      mensagem_id: optimisticId,
      canal_id: targetKey,
      agente_id: activeAgent?.agente_id ?? null,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo || "Referências enviadas para produção.",
      anexos,
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const hadExistingRun = Boolean(liveRunByChat[targetKey]);
    setChatByKey((prev) => ({
      ...prev,
      [targetKey]: mergeUniqueMessages(prev[targetKey] ?? [], [optimisticMsg]),
    }));
    if (!hadExistingRun) {
      setLiveRunByChat((prev) => ({
        ...prev,
        [targetKey]: {
          agenteId: activeAgent?.agente_id ?? null,
          agenteNome:
            centerMode.type === "channel" && activeChannel
              ? activeChannel.nome
              : activeAgent?.nome ?? "Agente",
          startedAt: Date.now(),
          statusText: "Enviando briefing e carregando contexto...",
          steps: [],
          streamingText: "",
        },
      }));
    }

    setSendingChat(true);
    let keepLiveRun = hadExistingRun;
    try {
      if (centerMode.type === "channel" && activeChannel) {
        const res = await daemonApi.sendChannelMessage(
          activeChannel.canal_id,
          payloadContent,
          anexos
        );
        setChatByKey((prev) => {
          const withoutTemp = (prev[targetKey] ?? []).filter((m) => m.mensagem_id !== optimisticId);
          return {
            ...prev,
            [targetKey]: mergeUniqueMessages(withoutTemp, [
              res.mensagem_usuario,
              ...res.mensagens_equipe,
            ]),
          };
        });
      } else if (activeAgent) {
        const res = await daemonApi.sendAgentMessage(
          activeAgent.agente_id,
          payloadContent,
          anexos
        );
        if (res.enfileirada || res.steered) {
          keepLiveRun = true;
          setChatByKey((prev) => {
            const withoutTemp = (prev[targetKey] ?? []).filter(
              (m) => m.mensagem_id !== optimisticId
            );
            return {
              ...prev,
              [targetKey]: mergeUniqueMessages(
                withoutTemp,
                res.mensagem_usuario ? [res.mensagem_usuario] : []
              ),
            };
          });
          await refreshAgentThreadsState(activeAgent.agente_id, null);
        } else {
          setChatByKey((prev) => {
            const withoutTemp = (prev[targetKey] ?? []).filter(
              (m) => m.mensagem_id !== optimisticId
            );
            const extras = [res.mensagem_usuario, res.mensagem_agente, ...(res.mensagens_handoff ?? [])].filter(
              (x): x is MensagemChat => Boolean(x)
            );
            return {
              ...prev,
              [targetKey]: mergeUniqueMessages(withoutTemp, extras),
            };
          });
          const agentReplyMeta = (
            res.mensagem_agente as unknown as { metadados?: { usage_limit_ask?: UsageLimitAskPayload } } | undefined
          )?.metadados;
          if (agentReplyMeta?.usage_limit_ask) {
            const askPayload = agentReplyMeta.usage_limit_ask;
            setUsageLimitAskByAgent((prev) => ({
              ...prev,
              [activeAgent.agente_id]: askPayload,
            }));
          }
        }
      }
      const [nextTasks, nextUsage, nextAnalytics, nextFiles] = await Promise.all([
        daemonApi.listTasks(),
        daemonApi.getProvidersUsage(false),
        daemonApi.getUsageAnalytics({ dias: usoPeriodoDias, agente_id: usoAgenteFiltro }),
        daemonApi.listFiles(),
      ]);
      setTarefas(nextTasks);
      setUso(nextUsage);
      setAnalyticsUso(nextAnalytics);
      setArquivos(nextFiles);
    } finally {
      if (!keepLiveRun) {
        setLiveRunByChat((prev) => {
          if (!prev[targetKey]) return prev;
          const copy = { ...prev };
          delete copy[targetKey];
          return copy;
        });
      }
      setSendingChat(false);
    }
  };

  // Fase 13 — Paginação, Ramificação, Fixação, Pergunta Lateral, Reset, Esperas & Controle da Fila
  const handleLoadOlderMessages = async () => {
    if (!activeAgent || !activeThreadKey) return;
    const currentPag = threadPaginationById[activeThreadKey];
    if (!currentPag?.has_older || !currentPag.older_cursor) return;

    setThreadPaginationById((prev) => ({
      ...prev,
      [activeThreadKey]: { ...currentPag, loading_older: true },
    }));
    try {
      const older =
        centerMode.type === "thread"
          ? await daemonApi.readThreadMessages(centerMode.threadId, {
              limit: 50,
              beforeCursor: currentPag.older_cursor,
            })
          : await daemonApi.readAgentMessagesPage(activeAgent.agente_id, {
              limit: 50,
              beforeCursor: currentPag.older_cursor,
            });
      if (centerMode.type === "thread") {
        setThreadChatById((prev) => ({
          ...prev,
          [centerMode.threadId]: mergeUniqueMessages(older.mensagens, prev[centerMode.threadId] ?? []),
        }));
      } else {
        const key = `agente:${activeAgent.agente_id}`;
        setChatByKey((prev) => ({
          ...prev,
          [key]: mergeUniqueMessages(older.mensagens, prev[key] ?? []),
        }));
      }
      setThreadPaginationById((prev) => ({
        ...prev,
        [activeThreadKey]: { ...older, loading_older: false },
      }));
    } catch {
      setThreadPaginationById((prev) => ({
        ...prev,
        [activeThreadKey]: { ...currentPag, loading_older: false },
      }));
    }
  };

  const handleJumpToLatest = async () => {
    if (!activeAgent || !activeThreadKey) return;
    if (centerMode.type === "thread") {
      const pagina = await daemonApi.readThreadMessages(centerMode.threadId, { limit: 50 });
      setThreadChatById((prev) => ({ ...prev, [centerMode.threadId]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [centerMode.threadId]: pagina }));
    } else {
      const pagina = await daemonApi.readAgentMessagesPage(activeAgent.agente_id, { limit: 50 });
      const key = `agente:${activeAgent.agente_id}`;
      setChatByKey((prev) => ({ ...prev, [key]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [activeThreadKey]: pagina }));
    }
    setHighlightedMessageId(null);
  };

  const handleJumpToMessage = async (targetThreadId: string, mensagemId: string) => {
    if (!activeAgent) return;
    const isMain = targetThreadId.startsWith("main:");
    if (isMain) {
      const pagina = await daemonApi.readAgentMessagesPage(activeAgent.agente_id, {
        limit: 50,
        aroundMessageId: mensagemId,
      });
      setChatByKey((prev) => ({ ...prev, [`agente:${activeAgent.agente_id}`]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [targetThreadId]: pagina }));
      handleSelectAgent(activeAgent.agente_id);
    } else {
      const pagina = await daemonApi.readThreadMessages(targetThreadId, {
        limit: 50,
        aroundMessageId: mensagemId,
      });
      setThreadChatById((prev) => ({ ...prev, [targetThreadId]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [targetThreadId]: pagina }));
      handleSelectThreadInAgent(activeAgent.agente_id, targetThreadId);
    }
    setHighlightedMessageId(mensagemId);
  };

  const handleNavigateBranchOrigin = async (branch: AgenteThreadBranch) => {
    if (branch.origem_excluida) return;
    await handleJumpToMessage(branch.origem_thread_id, branch.origem_mensagem_id);
  };

  const handleBranchFromMessage = async (mensagemId: string) => {
    if (!activeAgent) return;
    const created = await daemonApi.branchConversation(activeAgent.agente_id, {
      thread_id: centerMode.type === "thread" ? centerMode.threadId : null,
      mensagem_id: mensagemId,
      request_id: `branch-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    });
    await refreshAgentThreadsState(activeAgent.agente_id, created.thread_id);
    handleSelectThreadInAgent(activeAgent.agente_id, created.thread_id);
  };

  const handleTogglePinMessage = async (mensagem: MensagemChat, pinned: boolean) => {
    if (!activeAgent) return;
    const threadId = mensagem.thread_id ?? activeThreadKey ?? `main:${activeAgent.agente_id}`;
    const updatedPins = await daemonApi.setMessagePinned(activeAgent.agente_id, {
      thread_id: threadId,
      mensagem_id: mensagem.mensagem_id,
      pinned,
    });
    setPinsByAgent((prev) => ({ ...prev, [activeAgent.agente_id]: updatedPins }));
  };

  const handleAskSideQuestion = async (
    pergunta: string,
    historico: Array<{ pergunta: string; resposta: string }>
  ): Promise<string> => {
    if (!activeAgent) return "Nenhum agente selecionado.";
    const res = await daemonApi.askSideQuestion(activeAgent.agente_id, {
      pergunta,
      historico_lateral: historico,
      thread_id: centerMode.type === "thread" ? centerMode.threadId : null,
    });
    return res.resposta;
  };

  const handleStartNewChat = async () => {
    if (!activeAgent) return;
    const res = await daemonApi.startNewChat(activeAgent.agente_id);
    const key = `agente:${activeAgent.agente_id}`;
    setChatByKey((prev) => ({
      ...prev,
      [key]: mergeUniqueMessages(prev[key] ?? [], [res.mensagem_divisor]),
    }));
  };

  const handleCloseWait = async (esperaId: string) => {
    if (!activeAgent) return;
    await daemonApi.cancelWait(activeAgent.agente_id, esperaId);
    await refreshAgentThreadsState(activeAgent.agente_id, activeLaneThreadId);
  };

  const handleBeginEditQueueItem = async (entrega: FilaChatEntrega) => {
    if (!activeAgent) return;
    const editId = `edit-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const snapshot = await daemonApi.editChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entrega.entrega_id,
      acao: "begin",
      edit_id: editId,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
    setEditingQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: { entrega, editId } }));
  };

  const handleSaveEditQueueItem = async (
    entregaId: string,
    conteudo: string,
    anexos: AnexoChat[]
  ) => {
    if (!activeAgent) return;
    const editId = editingQueueByLane[activeLaneKeyStr]?.editId ?? "";
    const snapshot = await daemonApi.editChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
      acao: "save",
      edit_id: editId,
      conteudo,
      anexos,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
    setEditingQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: null }));
  };

  const handleDiscardEditQueueItem = async (entregaId: string) => {
    if (!activeAgent) return;
    const editId = editingQueueByLane[activeLaneKeyStr]?.editId ?? "";
    try {
      const snapshot = await daemonApi.editChatQueue(activeAgent.agente_id, {
        thread_id: activeLaneThreadId,
        entrega_id: entregaId,
        acao: "cancel",
        edit_id: editId,
      });
      setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
    } finally {
      setEditingQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: null }));
    }
  };

  const handleCancelOrDeleteQueueItem = async (entregaId: string, deleteAfter = false) => {
    if (!activeAgent) return;
    const snapshot = await daemonApi.cancelChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
      delete_after: deleteAfter,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
  };

  const handleReorderQueue = async (ids: string[]) => {
    if (!activeAgent) return;
    const snapshot = await daemonApi.reorderChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_ids: ids,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
  };

  const handleSteerQueueItem = async (entregaId: string) => {
    if (!activeAgent) return;
    const res = await daemonApi.steerChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: res.snapshot }));
  };

  const handleMoveQueueItemToTask = async (entregaId: string) => {
    if (!activeAgent) return;
    const res = await daemonApi.runQueuedAsTask(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: res.snapshot }));
    await refreshAgentThreadsState(activeAgent.agente_id, activeLaneThreadId);
  };

  const handleInterruptTurn = async () => {
    if (!activeAgent) return;
    if (centerMode.type === "thread") {
      await daemonApi.stopThread(centerMode.threadId);
    } else {
      await daemonApi.interruptTurn(activeAgent.agente_id, null);
    }
  };

  const handleCreateCustomAgent = async (payload: NewAgentPayload) => {
    const created = await daemonApi.createAgent(payload);
    setAgentes((prev) => [...prev, created]);
    handleSelectAgent(created.agente_id);
  };

  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    const canal = await daemonApi.createChannel({
      nome: newChannelName.trim(),
      descricao: newChannelDesc.trim() || "Canal colaborativo de criação",
      membros_agentes:
        newChannelMembers.length > 0 ? newChannelMembers : ["estrategista", "copywriter"],
    });
    setCanais((prev) => [canal, ...prev]);
    setNewChannelName("");
    setNewChannelDesc("");
    setChannelModalOpen(false);
    handleSelectChannel(canal.canal_id);
  };

  const handleConnectViaBrowser = useCallback(
    async (prov: "gemini" | "claude" | "openai", label?: string) => {
      setPendingAuthLink(null);
      try {
        const currentServerId = getActiveServerId();
        const activeSrv = servers.find((s) => s.server_id === currentServerId);
        const isRemoteTarget = activeSrv?.kind === "remote_vps" || activeSrv?.kind === "joined";
        if (prov === "gemini" && isRemoteTarget) {
          desktopAssistedProviderRef.current = "gemini";
          const remoteRes = await daemonApi.conectarGeminiRemotoViaDesktop(currentServerId, label);
          if (remoteRes.ok && remoteRes.provedores) {
            setProvedores(remoteRes.provedores);
            setUso(remoteRes.uso ?? (await daemonApi.getProvidersUsage(true).catch(() => uso)));
          }
          return {
            ok: Boolean(remoteRes.ok),
            canceled: Boolean(remoteRes.canceled),
            erro: remoteRes.erro,
          };
        }
        if (prov === "openai" && isRemoteTarget) {
          desktopAssistedProviderRef.current = "openai";
          try {
            const remoteRes = await daemonApi.conectarOpenAiRemotoViaDesktop(currentServerId, label);
            if (remoteRes.ok && remoteRes.provedores) {
              setProvedores(remoteRes.provedores);
              setUso(remoteRes.uso ?? (await daemonApi.getProvidersUsage(true).catch(() => uso)));
              return { ok: true, canceled: false };
            }
            if (remoteRes.canceled) {
              return { ok: false, canceled: true, erro: remoteRes.erro };
            }
            if (
              remoteRes.erro &&
              !/Runtime Codex CLI|não encontrado|não pôde ser instalado|404|503/i.test(remoteRes.erro)
            ) {
              return { ok: false, canceled: false, erro: remoteRes.erro };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            if (msg && !/Runtime Codex CLI|não encontrado|não pôde ser instalado|404|503/i.test(msg)) {
              return { ok: false, canceled: false, erro: msg };
            }
          } finally {
            desktopAssistedProviderRef.current = null;
          }
        }
        const res = await daemonApi.connectProviderViaBrowser(prov, label);
        if (res.ok && res.provedores) {
          setProvedores(res.provedores);
          if (res.uso) setUso(res.uso);
        }
        return { ok: Boolean(res.ok), canceled: Boolean(res.canceled), erro: res.erro };
      } finally {
        desktopAssistedProviderRef.current = null;
        setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
      }
    },
    [servers, uso]
  );

  const handleCancelBrowserSignIn = useCallback(
    async (prov: "gemini" | "claude" | "openai") => {
      await daemonApi.cancelProviderBrowserSignIn(prov);
      setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
    },
    []
  );

  const renderSplashOverlay = () =>
    !splashDismissed ? (
      <StudioSplashPreloader
        loading={isAppBooting}
        initialStage={splashStage}
        onRevealComplete={() => setSplashDismissed(true)}
      />
    ) : null;

  if (isAppBooting) {
    return (
      <>
        <div className="min-h-screen w-full bg-[#0D0D0D]" />
        {renderSplashOverlay()}
      </>
    );
  }

  // Gatekeeper de Licença Comercial (Fase 16)
  if (licenseStatus && !licenseStatus.valid) {
    return (
      <>
        <LicenseActivationGate
          status={licenseStatus}
          onActivate={async (payload) => {
            const next = await daemonApi.ativarLicenca(payload);
            if (next.valid) {
              setBootLoading(true);
              setLicenseStatus(next);
              try {
                await hydrateAll();
              } finally {
                setBootLoading(false);
              }
            } else {
              setLicenseStatus(next);
            }
            return next;
          }}
          onDeactivateDevice={async (payload) => {
            const res = await daemonApi.desvincularDispositivoLicenca(payload);
            if (res.status) setLicenseStatus(res.status);
            return res;
          }}
          onRefreshStatus={async () => {
            const next = await daemonApi.sincronizarLicenca();
            if (next.valid) {
              setBootLoading(true);
              setLicenseStatus(next);
              try {
                await hydrateAll();
              } finally {
                setBootLoading(false);
              }
            } else {
              setLicenseStatus(next);
            }
          }}
        />
        {renderSplashOverlay()}
      </>
    );
  }

  // Etapa de Onboarding híbrido 4 etapas (com opções puláveis em marca/canais)
  if (onboarding && !onboarding.onboarding_concluido) {
    return (
      <>
        <OnboardingFlow
          initialState={onboarding}
          provedores={provedores}
          activeServerName={
            servers.find((s) => s.server_id === activeServerId)?.nome ?? "Servidor"
          }
          isSecondaryServer={activeServerId !== "primary"}
          onBackToPrimaryServer={() => void handleSwitchServer("primary")}
          unlockedAgentsCount={
            licenseStatus?.unlocked_agents_count ??
            agentes.filter(
              (a) =>
                a.agente_id !== "assistente_setup" &&
                a.agente_id !== "assistente_servidor_vps" &&
                (a.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
            ).length
          }
          onConnectProvider={async (prov, key) => {
            await daemonApi.connectProvider(prov, key);
            setProvedores(await daemonApi.listProvidersStatus(false));
          }}
          onConnectProviderViaBrowser={handleConnectViaBrowser}
          onCancelProviderBrowserSignIn={handleCancelBrowserSignIn}
          pendingAuthUrl={pendingAuthLink}
          onUploadCategorizedFile={async (file, categoria) => {
            const res = await daemonApi.uploadFileCategorized(file, categoria);
            setArquivos(await daemonApi.listFiles());
            if (res.onboarding) setOnboarding(res.onboarding);
            return res;
          }}
          onSaveBrandIdentity={async (patch) => {
            await daemonApi.saveBrandIdentity(patch);
          }}
          onTestInstagram={async (payload) => {
            const saved = await daemonApi.connectLojaApp("instagram", {
              flowId: "instagram-vault-keys",
              kind: "key",
              contaRotulo: payload.contaRotulo?.trim() || "Principal",
              fields: {
                IG_USER_ID: payload.igUserId.trim(),
                IG_ACCESS_TOKEN: payload.accessToken.trim(),
              },
            });
            return {
              ok: Boolean(saved.validationReport?.ok ?? saved.nativeAccount?.testado_ok),
              resumo:
                saved.validationReport?.resumo ??
                (saved.nativeAccount?.ultimo_erro || "Credenciais Meta salvas no Cofre."),
              username: saved.nativeAccount?.perfil_conectado?.username ?? null,
            };
          }}
          onComplete={async (patch) => {
            if (patch.marca_nome || patch.perfil_handle) {
              await daemonApi.saveBrandIdentity({
                marca_nome: patch.marca_nome,
                perfil_handle: patch.perfil_handle,
              });
            }
            const updated = await daemonApi.updateOnboarding(patch);
            setOnboarding(updated);
            const [provList, usageSnap, agList, filesList] = await Promise.all([
              daemonApi.listProvidersStatus(false),
              daemonApi.getProvidersUsage(),
              daemonApi.listAgents(),
              daemonApi.listFiles(),
            ]);
            setProvedores(provList);
            setUso(usageSnap);
            setAgentes(agList);
            setArquivos(filesList);
          }}
        />
        {renderSplashOverlay()}
      </>
    );
  }

  return (
    <>
      <div className="h-screen w-screen overflow-hidden bg-[#0D0D0D] text-white flex">
      {/* Trilho estreito à esquerda (52px) */}
      <WorkspaceRail
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        quotaPercent={uso?.provedores?.[0]?.janelas?.[0]?.restante_percentual ?? 100}
        uso={uso}
        onRefreshUsage={async () => {
          const [provList, usageSnap] = await Promise.all([
            daemonApi.listProvidersStatus(true),
            daemonApi.getProvidersUsage(true),
          ]);
          setProvedores(provList);
          setUso(usageSnap);
        }}
        whatsappStatus={whatsappStatus}
        pendingCount={pendingCount + runningCount}
        onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
        onOpenSettings={() => openSettings()}
        onOpenHelp={() => setHelpModalOpen(true)}
        servers={servers}
        activeServerId={activeServerId}
        serverQuota={serverQuota}
        onSelectServer={(sid) => void handleSwitchServer(sid)}
        onOpenNewLocalServer={() => setNewLocalModalOpen(true)}
        onOpenNewRemoteServer={() => setNewRemoteModalOpen(true)}
        onOpenJoinServer={() => setJoinServerModalOpen(true)}
        onOpenServerSettings={(srv) => setServerSettingsTarget(srv)}
        onOpenDisplaySettings={() => openSettings("aparencia")}
      />

      {/* Shell principal à direita do Rail */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {userSettings.comportamento.exibir_dynamic_island !== false ? (
          <DynamicIsland
            wsConnected={wsConnected}
            runningCount={runningCount}
            pendingCount={pendingCount}
            awaitingApprovalCount={awaitingApprovalCount}
            whatsappStatus={whatsappStatus}
            onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
            onOpenVaultModal={() => setActiveSection("conexoes")}
            tabs={dynamicIslandTabs}
            activeTabId={headerActiveTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTopic={() => void handleCreateNewTopic()}
            onNewTab={() => void handleCreateNewTopic()}
            sidebarCollapsed={!sidebarOpen}
            onToggleSidebar={() => {
              setSidebarOpen((s) => {
                const next = !s;
                persistLayoutWidths({ sidebar_open: next, focus_mode: false });
                if (next) setFocusMode(false);
                return next;
              });
            }}
            focusMode={focusMode}
            onToggleFocusMode={handleToggleFocusMode}
            onNavigateBack={() => stepHistoryTab(-1)}
            onNavigateForward={() => stepHistoryTab(1)}
          />
        ) : (
          <div className="h-[36px] shrink-0 border-b border-white/[0.06] bg-[#0D0D0D] px-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((s) => !s)}
              aria-label="Alternar barra lateral"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#212121] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#2A2A2A]"
            >
              <PanelLeft className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>{sidebarOpen ? "Recolher barra" : "Mostrar barra"}</span>
            </button>
            <button
              type="button"
              onClick={() => openSettings()}
              aria-label="Abrir configurações"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#212121] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#2A2A2A]"
            >
              <Settings className="h-3.5 w-3.5 text-[#979797]" />
              <span>Configurações</span>
            </button>
          </div>
        )}

        {/* Área de conteúdo por seção da Rail */}
        <main className="flex-1 min-h-0 flex overflow-hidden">
          {activeSection === "agentes" && (
            <>
              {sidebarOpen && (
                <>
                  <Sidebar
                    widthPx={sidebarWidth}
                    showModeTabs={false}
                    agentes={agentes}
                    canais={canais}
                    deletedNativeAgents={deletedNativeAgents}
                    workingAgentIds={workingAgentIds}
                    agentActivityByAgentId={agentActivityByAgentId}
                  selectedAgentId={
                    centerMode.type === "agent" || centerMode.type === "thread"
                      ? activeAgent?.agente_id ?? null
                      : null
                  }
                  selectedChannelId={centerMode.type === "channel" ? activeChannel?.canal_id ?? null : null}
                  onSelectAgent={handleSelectAgent}
                  onSelectChannel={handleSelectChannel}
                  onCreateAgent={handleOpenNewAgentTab}
                  onCreateChannel={() => setChannelModalOpen(true)}
                  whatsappStatus={whatsappStatus}
                  onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
                  viewMode={sidebarViewMode}
                  onChangeViewMode={setSidebarViewMode}
                  routineCountsByAgent={routineCountsByAgent}
                  sidebarLayout={sidebarLayout}
                  sortMode={
                    userSettings.geral.ordenacao_sidebar === "alfabetica"
                      ? "alphabetical"
                      : userSettings.geral.ordenacao_sidebar === "recente"
                        ? "recent"
                        : "custom"
                  }
                  onMutateSidebar={async (mutation: SidebarLayoutMutation) => {
                    const nextLayout = await daemonApi.mutateSidebarLayout(mutation);
                    setSidebarLayout(nextLayout);
                  }}
                  onReorderPins={async (pins: string[]) => {
                    const nextLayout = await daemonApi.updateSidebarPins(pins);
                    setSidebarLayout(nextLayout);
                  }}
                  onDuplicateAgent={async (agenteId: string) => {
                    const res = await daemonApi.duplicateAgent(agenteId);
                    setSidebarLayout(res.layout);
                    setAgentes(await daemonApi.listAgents());
                    handleSelectAgent(res.agente.agente_id);
                  }}
                  onRestoreDeletedAgent={handleRestoreDeletedAgent}
                  onRestoreAllDeletedAgents={handleRestoreAllDeletedAgents}
                  onToggleUnreadAgent={handleToggleUnreadAgent}
                  onToggleMuteAgent={handleToggleMuteAgent}
                  onNewSubconversation={handleNewSubconversationForAgent}
                  onOpenAgentNewWindow={handleOpenAgentNewWindow}
                  onEditAgent={(agenteId) => {
                    handleSelectAgent(agenteId);
                    setInspectorOpen(true);
                    setRoutineInspectorSignal({ subView: "config", nonce: Date.now() });
                  }}
                  onDeleteAgent={handleDeleteAgent}
                    updateStatus={updateStatus}
                    onApplyUpdate={() => void handleApplyUpdate()}
                    onOpenUpdateSettings={() => openSettings("atualizacoes")}
                    onDismissSetupAssistant={async () => {
                      const res = await daemonApi.setSetupAssistantState("dismiss");
                      setOnboarding(res.onboarding);
                      const nextAgents = await daemonApi.listAgents();
                      setAgentes(nextAgents);
                      if (centerMode.type === "agent" && centerMode.agenteId === "assistente_setup") {
                        const fallbackId = nextAgents[0]?.agente_id ?? "estrategista";
                        handleSelectAgent(fallbackId);
                      }
                    }}
                    onDismissVpsAssistant={async () => {
                      await daemonApi.setVpsAssistantState("dismiss");
                      const nextAgents = await daemonApi.listAgents();
                      setAgentes(nextAgents);
                      if (
                        centerMode.type === "agent" &&
                        centerMode.agenteId === "assistente_servidor_vps"
                      ) {
                        const fallbackId = nextAgents[0]?.agente_id ?? "estrategista";
                        handleSelectAgent(fallbackId);
                      }
                    }}
                  />
                  <SplitResizeHandle
                    ariaLabel="Redimensionar painel lateral esquerdo"
                    currentWidth={sidebarWidth}
                    minWidth={220}
                    maxWidth={460}
                    onResize={(nextW) => {
                      setSidebarWidth(nextW);
                      writeStoredWidth(SIDEBAR_WIDTH_KEY, nextW);
                    }}
                    onCollapse={() => {
                      setSidebarOpen(false);
                      persistLayoutWidths({ sidebar_open: false });
                    }}
                    onReset={() => {
                      setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
                      writeStoredWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
                      persistLayoutWidths({ sidebar_width: DEFAULT_SIDEBAR_WIDTH });
                    }}
                    onResizeEnd={(finalW) => persistLayoutWidths({ sidebar_width: finalW })}
                  />
                </>
              )}

              {centerMode.type === "new_agent" ? (
                <NewAgentScreen
                  provedores={provedores}
                  onCreateAgent={handleCreateCustomAgent}
                  onOpenConnectors={() => setActiveSection("conexoes")}
                />
              ) : (
                <>
                  {sidebarViewMode === "routines" ? (
                    <RoutineFlowsCanvas
                      agente={activeAgent ?? agentes[0] ?? null}
                      allAgentes={agentes}
                      refreshSignal={flowRefreshNonce}
                      onOpenRoutineSettings={(rotinaId) => {
                        setInspectorOpen(true);
                        setRoutineInspectorSignal({
                          subView: "routines",
                          rotinaId: rotinaId ?? null,
                          nonce: Date.now(),
                        });
                      }}
                      onOpenAgentChat={(agenteId) => {
                        setSidebarViewMode("agents");
                        handleSelectAgent(agenteId);
                      }}
                    />
                  ) : (
                    <div className="flex-1 min-w-[360px] flex flex-col overflow-hidden">
                      {activeSideThreadId && (
                        <div className="shrink-0 px-4 py-2 bg-[#212121] border-b border-white/[0.06] flex items-center justify-between gap-2 text-[12px]">
                          <span className="text-[#42A0FF] font-semibold">
                            Visualizando conversa isolada da rotina ({activeSideThreadId})
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveSideThreadId(null)}
                            className="rounded-lg bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1 font-semibold text-[#F0F0F0]"
                          >
                            Voltar ao chat principal
                          </button>
                        </div>
                      )}
                      <AgentConversationView
                        mode={centerMode.type === "channel" ? "channel" : "agent"}
                        agente={activeAgent}
                        canal={activeChannel}
                        allAgentes={agentes}
                        arquivos={arquivos}
                        mensagens={activeMessages}
                        provedores={provedores}
                        sending={sendingChat}
                        liveRun={activeLiveRun}
                        inspectorOpen={inspectorOpen}
                        onToggleInspector={() => setInspectorOpen((o) => !o)}
                        onSendMessage={async (conteudo, anexos, pageContext) => {
                          setPrefilledChatPrompt(null);
                          await handleSendChatMessage(conteudo, anexos, pageContext);
                        }}
                        onUploadFile={handleUploadFile}
                        onSubmitUiBlock={handleSubmitUiBlock}
                        onSaveSkillSuggestion={handleSaveSkillSuggestion}
                        onDismissSkillSuggestion={handleDismissSkillSuggestion}
                        onOpenSharedTables={() => setSharedTablesOpen(true)}
                        onOpenFilePreview={(anexo) => setPreviewFile(anexo)}
                        onOpenImageLightbox={(url, alt) => setLightboxImage({ url, alt })}
                        pendingMcpSignIn={pendingMcpSignIn}
                        prefilledDraft={prefilledChatPrompt}
                        onAuthenticateMcp={async (mcpId) => {
                          setPendingMcpSignIn((prev) =>
                            prev ? { ...prev, status: "signing_in", errorMessage: null } : prev
                          );
                          try {
                            const res = await daemonApi.startMcpOAuth(mcpId);
                            if (typeof window !== "undefined") {
                              window.open(res.authorizeUrl, "_blank", "noopener,noreferrer");
                            }
                          } catch (err) {
                            setPendingMcpSignIn((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    status: "error",
                                    errorMessage:
                                      err instanceof Error ? err.message : "Falha ao iniciar OAuth.",
                                  }
                                : prev
                            );
                          }
                        }}
                        onOpenStoreApp={(slug) => {
                          setLojaInitialAppSlug(slug);
                          setActiveSection("loja");
                        }}
                        onRetryMcpContinue={async () => {
                          setPendingMcpSignIn(null);
                          await handleSendChatMessage("Pode continuar utilizando as ferramentas conectadas.", []);
                        }}
                        onUpdateModelAndEffort={async (modelo: string, effort: NivelEsforco) => {
                          if (!activeAgent) return;
                          const targetId = activeAgent.agente_id;
                          setAgentes((prev) =>
                            prev.map((a) =>
                              a.agente_id === targetId
                                ? {
                                    ...a,
                                    modelo_padrao: modelo,
                                    config: { ...(a.config ?? {}), effort },
                                  }
                                : a
                            )
                          );
                          const updated = await daemonApi.updateAgentSettings(targetId, {
                            modelo_padrao: modelo,
                            effort,
                          });
                          setAgentes((prev) =>
                            prev.map((a) => (a.agente_id === updated.agente_id ? updated : a))
                          );
                        }}
                        onOpenConnectors={() => setActiveSection("conexoes")}
                        threads={activeAgent ? threadsByAgent[activeAgent.agente_id]?.threads ?? [] : []}
                        activeThread={activeThread}
                        onSelectThread={(threadId) => {
                          if (!activeAgent) return;
                          handleSelectThreadInAgent(activeAgent.agente_id, threadId);
                        }}
                        onCreateQuickThread={() => void handleCreateNewTopic()}
                        hideInlineThreadTabs={true}
                        onDismissThreadTab={(threadId) => {
                          if (!activeAgent) return;
                          void handleDismissThreadTab(activeAgent.agente_id, threadId);
                        }}
                        pagination={
                          activePaginationState
                            ? {
                                has_older: activePaginationState.has_older,
                                older_count: activePaginationState.older_count,
                                has_newer: activePaginationState.has_newer,
                                loading_older: activePaginationState.loading_older,
                              }
                            : undefined
                        }
                        highlightedMessageId={highlightedMessageId}
                        onLoadOlderMessages={handleLoadOlderMessages}
                        onJumpToLatest={handleJumpToLatest}
                        onJumpToMessage={handleJumpToMessage}
                        onNavigateBranchOrigin={handleNavigateBranchOrigin}
                        esperas={activeAgent ? waitsByAgent[activeAgent.agente_id] ?? [] : []}
                        filaSnapshot={activeQueueSnapshot}
                        editingQueueItem={activeEditingEntry?.entrega ?? null}
                        onCloseWait={handleCloseWait}
                        onBeginEditQueueItem={handleBeginEditQueueItem}
                        onSaveEditQueueItem={handleSaveEditQueueItem}
                        onDiscardEditQueueItem={handleDiscardEditQueueItem}
                        onCancelOrDeleteQueueItem={handleCancelOrDeleteQueueItem}
                        onReorderQueue={handleReorderQueue}
                        onSteerQueueItem={handleSteerQueueItem}
                        onMoveQueueItemToTask={handleMoveQueueItemToTask}
                        onInterruptTurn={handleInterruptTurn}
                        pins={activeAgent ? pinsByAgent[activeAgent.agente_id] ?? [] : []}
                        onBranchFromMessage={handleBranchFromMessage}
                        onTogglePinMessage={handleTogglePinMessage}
                        onAskSideQuestion={handleAskSideQuestion}
                        onStartNewChat={handleStartNewChat}
                        takeoverSession={
                          activeAgent ? takeoverByAgent[activeAgent.agente_id] ?? null : null
                        }
                        secretRequest={
                          activeAgent ? secretRequestByAgent[activeAgent.agente_id] ?? null : null
                        }
                        captureRequest={
                          activeAgent && captureByAgent[activeAgent.agente_id]
                            ? {
                                captureId: captureByAgent[activeAgent.agente_id].captureId,
                                purpose: captureByAgent[activeAgent.agente_id].purpose,
                                targetHint:
                                  captureByAgent[activeAgent.agente_id].targetHint ?? undefined,
                              }
                            : null
                        }
                        usageLimitAsk={
                          activeAgent ? usageLimitAskByAgent[activeAgent.agente_id] ?? null : null
                        }
                        sendShortcut={userSettings.geral.atalho_envio}
                        compactActions={userSettings.geral.acoes_compactas}
                        showAgentSteps={userSettings.geral.exibir_passos_agente}
                        userBubbleColor={userSettings.aparencia.cor_balao_usuario}
                        solidBubbles={userSettings.aparencia.baloes_solidos !== false}
                        onClearHistory={async () => {
                          if (centerMode.type === "channel" && activeChannel) {
                            await daemonApi.clearChannelHistory(activeChannel.canal_id);
                            setChatByKey((prev) => ({
                              ...prev,
                              [activeChannel.canal_id]: [],
                            }));
                            setCanais((prev) =>
                              prev.map((c) =>
                                c.canal_id === activeChannel.canal_id
                                  ? { ...c, ultima_mensagem: null }
                                  : c
                              )
                            );
                            return;
                          }
                          if (!activeAgent) return;
                          await daemonApi.clearAgentHistory(activeAgent.agente_id);
                          setChatByKey((prev) => ({
                            ...prev,
                            [`agente:${activeAgent.agente_id}`]: [],
                          }));
                          setAgentes((prev) =>
                            prev.map((a) =>
                              a.agente_id === activeAgent.agente_id
                                ? { ...a, nao_lidas: 0, ultima_mensagem: null }
                                : a
                            )
                          );
                          await refreshAgentThreadsState(activeAgent.agente_id, null).catch(() => {});
                        }}
                        liveVoiceEnabled={userSettings.voz.live_voice_habilitada}
                        liveVoiceActive={liveVoiceActive}
                        onOpenTakeover={(tabId) => {
                          setActiveBrowserTabId(tabId);
                          setBrowserPanelMode("expanded");
                          void daemonApi
                            .startBrowserTakeover(tabId, {
                              agenteId: activeAgent?.agente_id ?? null,
                              reason: "manual",
                            })
                            .catch(() => {});
                        }}
                        onCancelTakeover={async (tabId) => {
                          await daemonApi.respondBrowserTakeover(tabId, "cancel");
                          setTakeoverByAgent((prev) => {
                            const next: Record<string, BrowserTakeoverSession> = {};
                            for (const [k, s] of Object.entries(prev)) {
                              if (s.tabId !== tabId) next[k] = s;
                            }
                            return next;
                          });
                        }}
                        onSubmitSecret={async (tabId, payload) => {
                          const req = activeAgent
                            ? secretRequestByAgent[activeAgent.agente_id]
                            : undefined;
                          await daemonApi.submitBrowserSecret(tabId, {
                            method: req?.method ?? "password",
                            targets: req?.targets ?? [],
                            loginId: req?.loginId ?? null,
                            username: payload.username ?? req?.username ?? null,
                            secret: payload.secret,
                            saveToVault: payload.saveToVault,
                            loginLabel: payload.loginLabel,
                            submission: req?.submission ?? "enter",
                            submitTarget: req?.submitTarget ?? null,
                          });
                          if (activeAgent) {
                            setSecretRequestByAgent((prev) => {
                              const copy = { ...prev };
                              delete copy[activeAgent.agente_id];
                              return copy;
                            });
                          }
                        }}
                        onAuthorizeScreenCapture={async (captureId, payload) => {
                          await daemonApi.respondScreenCapture(captureId, {
                            decision: "granted",
                            dataUrl: payload.dataUrl,
                            width: payload.width,
                            height: payload.height,
                          });
                          setCaptureByAgent((prev) => {
                            const next: Record<string, CaptureScreenConsentRequest> = {};
                            for (const [k, c] of Object.entries(prev)) {
                              if (c.captureId !== captureId) next[k] = c;
                            }
                            return next;
                          });
                        }}
                        onDeclineScreenCapture={async (captureId, reason) => {
                          await daemonApi.respondScreenCapture(captureId, {
                            decision: "declined",
                            reason,
                          });
                          setCaptureByAgent((prev) => {
                            const next: Record<string, CaptureScreenConsentRequest> = {};
                            for (const [k, c] of Object.entries(prev)) {
                              if (c.captureId !== captureId) next[k] = c;
                            }
                            return next;
                          });
                        }}
                        onResolveUsageLimit={async (payload) => {
                          if (!activeAgent) return;
                          if (payload.action === "switch" && payload.choice) {
                            const res = await daemonApi.respondUsageLimit(activeAgent.agente_id, {
                              askId: payload.askId,
                              choice: payload.choice,
                              remember: payload.remember,
                            });
                            if (res.mensagem) {
                              const targetKey = `agente:${activeAgent.agente_id}`;
                              setChatByKey((prev) => ({
                                ...prev,
                                [targetKey]: mergeUniqueMessages(prev[targetKey] ?? [], [
                                  res.mensagem as MensagemChat,
                                ]),
                              }));
                            }
                          }
                          setUsageLimitAskByAgent((prev) => {
                            const copy = { ...prev };
                            delete copy[activeAgent.agente_id];
                            return copy;
                          });
                        }}
                        onToggleLiveVoice={() => setLiveVoiceActive((v) => !v)}
                      />

                      <LiveVoiceBar
                        active={liveVoiceActive}
                        agentName={activeAgent?.nome ?? activeChannel?.nome ?? "Agente"}
                        processing={sendingChat || Boolean(activeLiveRun)}
                        lastAssistantReply={
                          activeMessages
                            .slice()
                            .reverse()
                            .find((m) => m.autor === "agente")?.conteudo_markdown ?? null
                        }
                        speechRate={userSettings.voz.velocidade}
                        autoRead={userSettings.voz.leitura_automatica}
                        onSendTranscript={async (texto) => {
                          await handleSendChatMessage(texto, []);
                        }}
                        onClose={() => setLiveVoiceActive(false)}
                      />
                    </div>
                  )}

                  {(inspectorOpen || (browserPanelMode === "sidebar" && browserTabs.length > 0)) && (
                    <SplitResizeHandle
                      ariaLabel="Redimensionar inspetor direito"
                      currentWidth={inspectorWidth}
                      minWidth={280}
                      maxWidth={560}
                      invertDirection
                      onResize={(nextW) => {
                        setInspectorWidth(nextW);
                        writeStoredWidth(INSPECTOR_WIDTH_KEY, nextW);
                      }}
                      onCollapse={() => {
                        if (browserPanelMode === "sidebar" && browserTabs.length > 0) {
                          setBrowserPanelMode("closed");
                        } else {
                          setInspectorOpen(false);
                          persistLayoutWidths({ inspector_open: false });
                        }
                      }}
                      onReset={() => {
                        setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
                        writeStoredWidth(INSPECTOR_WIDTH_KEY, DEFAULT_INSPECTOR_WIDTH);
                        persistLayoutWidths({ inspector_width: DEFAULT_INSPECTOR_WIDTH });
                      }}
                      onResizeEnd={(finalW) => persistLayoutWidths({ inspector_width: finalW })}
                    />
                  )}
                  {browserPanelMode === "sidebar" && browserTabs.length > 0 ? (
                    <div
                      style={{ width: `${inspectorWidth}px` }}
                      className="shrink-0 h-full overflow-hidden flex flex-col"
                    >
                      <InAppBrowserPanel
                        mode="sidebar"
                        tabs={browserTabs}
                        activeTabId={activeBrowserTabId}
                        framesByTab={browserFramesByTab}
                        agentName={activeAgent?.nome ?? "Agente"}
                        agentAvatar={getAgentAvatar(activeAgent)}
                        agentAvatarShape={getAgentAvatar(activeAgent).shape}
                        agentAvatarColor={getAgentAvatar(activeAgent).color}
                        agentWorking={activeAgent ? workingAgentIds.has(activeAgent.agente_id) : false}
                        takeoverPending={Boolean(
                          (activeAgent && takeoverByAgent[activeAgent.agente_id]) ||
                            browserTabs.some((t) => t.tabId === activeBrowserTabId && t.userControl)
                        )}
                        profileLabel={
                          browserProfiles.find(
                            (p) =>
                              p.perfil_id ===
                              browserTabs.find((t) => t.tabId === activeBrowserTabId)?.perfilId
                          )?.nome ?? "Perfil Compartilhado"
                        }
                        teachRecording={Boolean(
                          activeBrowserTabId && teachStatusByTab[activeBrowserTabId]?.recording
                        )}
                        teachStartedAt={
                          activeBrowserTabId
                            ? teachStatusByTab[activeBrowserTabId]?.startedAt ?? null
                            : null
                        }
                        teachStepsCount={
                          activeBrowserTabId
                            ? teachStatusByTab[activeBrowserTabId]?.stepsCount ?? 0
                            : 0
                        }
                        onSelectTab={(tId) => setActiveBrowserTabId(tId)}
                        onNewTab={async () => {
                          const res = (await daemonApi.runBrowserSessionAction({
                            action: "open",
                            agenteId: activeAgent?.agente_id ?? undefined,
                            url: "https://www.google.com",
                          })) as { tabId?: string; result?: { tabId?: string } };
                          const newId = res?.result?.tabId ?? res?.tabId;
                          if (newId) setActiveBrowserTabId(newId);
                        }}
                        onCloseTab={async (tId) => {
                          await daemonApi.runBrowserSessionAction({ action: "close_tab", tabId: tId });
                        }}
                        onNavigate={async (tId, url) => {
                          await daemonApi.runBrowserSessionAction({
                            action: "navigate",
                            tabId: tId,
                            url,
                          });
                        }}
                        onGoBack={async (tId) => {
                          await daemonApi.runBrowserSessionAction({ action: "go_back", tabId: tId });
                        }}
                        onGoForward={async (tId) => {
                          await daemonApi.runBrowserSessionAction({
                            action: "go_forward",
                            tabId: tId,
                          });
                        }}
                        onReload={async (tId) => {
                          await daemonApi.runBrowserSessionAction({ action: "reload", tabId: tId });
                        }}
                        onExpand={() => setBrowserPanelMode("expanded")}
                        onCollapseToChat={() => setBrowserPanelMode("sidebar")}
                        onClosePanel={() => setBrowserPanelMode("closed")}
                        onAssumeControl={async (tId) => {
                          await daemonApi.startBrowserTakeover(tId, {
                            agenteId: activeAgent?.agente_id ?? null,
                            reason: "manual",
                          });
                        }}
                        onCompleteControl={async (tId) => {
                          await daemonApi.respondBrowserTakeover(tId, "complete");
                        }}
                        onSendInput={async (tId, input, autoAssume) => {
                          await daemonApi.sendBrowserInput(tId, { ...input, autoAssume });
                        }}
                        onSendQuickChat={async (text) => {
                          await handleSendChatMessage(text, []);
                        }}
                      />
                    </div>
                  ) : (
                    <RightInspectorPanel
                    open={inspectorOpen}
                    widthPx={inspectorWidth}
                    agente={activeAgent}
                      arquivos={arquivos}
                      canais={canais}
                      threads={
                        activeAgent
                          ? (
                              threadsByAgent[activeAgent.agente_id]?.threads ??
                              allThreads.filter(
                                (t) => t.agente_id === activeAgent.agente_id && !t.arquivada_em
                              )
                            )
                          : []
                      }
                      activeThreadId={activeThread?.thread_id ?? null}
                      skillsCount={
                        activeAgent
                          ? habilidades.filter((h) =>
                              h.agentes_vinculados.includes(activeAgent.agente_id)
                            ).length
                          : habilidades.length
                      }
                      provedores={provedores}
                      browserProfiles={browserProfiles}
                      browserProxies={browserProxies}
                      activeBrowserTabsCount={browserStatus?.activeTabs ?? 0}
                      routineCount={
                        activeAgent ? routineCountsByAgent[activeAgent.agente_id] ?? 0 : 0
                      }
                      routineFocusSignal={routineInspectorSignal}
                      previewTarefa={previewTarefa}
                      onClose={() => setInspectorOpen(false)}
                      onOpenFilesPage={() => setActiveSection("arquivos")}
                      onOpenUsagePage={() => setActiveSection("uso")}
                      onOpenStorePage={() => setActiveSection("loja")}
                      onOpenTablesModal={() => setSharedTablesOpen(true)}
                      onSelectThread={(threadId) => {
                        if (!activeAgent) return;
                        handleSelectThreadInAgent(activeAgent.agente_id, threadId);
                      }}
                      onCreateSubconversation={() => void handleCreateNewTopic()}
                      onClearChatHistory={async (agenteId) => {
                        await daemonApi.clearAgentHistory(agenteId);
                        setChatByKey((prev) => ({ ...prev, [`agente:${agenteId}`]: [] }));
                        setAgentes((prev) =>
                          prev.map((a) =>
                            a.agente_id === agenteId
                              ? { ...a, nao_lidas: 0, ultima_mensagem: null }
                              : a
                          )
                        );
                        await refreshAgentThreadsState(agenteId, null).catch(() => {});
                      }}
                      onDeleteFile={handleDeleteFile}
                      onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
                      onCreateBrowserProfile={async (input) => {
                        await daemonApi.createBrowserProfile(input);
                        setBrowserProfiles(await daemonApi.listBrowserProfiles());
                      }}
                      onUpdateBrowserProfile={async (perfilId, patch) => {
                        await daemonApi.updateBrowserProfile(perfilId, patch);
                        setBrowserProfiles(await daemonApi.listBrowserProfiles());
                      }}
                      onClearBrowserProfile={async (perfilId) => {
                        await daemonApi.clearBrowserProfile(perfilId);
                        setBrowserProfiles(await daemonApi.listBrowserProfiles());
                      }}
                      onDeleteBrowserProfile={async (perfilId) => {
                        await daemonApi.deleteBrowserProfile(perfilId);
                        const [nextProfiles, nextAgents] = await Promise.all([
                          daemonApi.listBrowserProfiles(),
                          daemonApi.listAgents(),
                        ]);
                        setBrowserProfiles(nextProfiles);
                        setAgentes(nextAgents);
                      }}
                      onSaveBrowserProxy={async (input) => {
                        const saved = await daemonApi.saveBrowserProxy(input);
                        setBrowserProxies(await daemonApi.listBrowserProxies());
                        return saved;
                      }}
                      onDeleteBrowserProxy={async (proxyId) => {
                        await daemonApi.deleteBrowserProxy(proxyId);
                        setBrowserProxies(await daemonApi.listBrowserProxies());
                      }}
                      onOpenAgentBrowserTakeover={async (agenteId) => {
                        let tabId =
                          browserTabs.find((t) => t.agenteId === agenteId)?.tabId ??
                          browserStatus?.tabs.find((t) => t.agenteId === agenteId)?.tabId ??
                          null;
                        if (!tabId) {
                          const openRes = (await daemonApi.runBrowserSessionAction({
                            action: "open",
                            agenteId,
                            url: "https://web.whatsapp.com",
                          })) as {
                            tabId?: string;
                            tab?: { tabId?: string };
                            result?: { tabId?: string; tab?: { tabId?: string } };
                          };
                          tabId =
                            openRes?.result?.tabId ??
                            openRes?.result?.tab?.tabId ??
                            openRes?.tabId ??
                            openRes?.tab?.tabId ??
                            null;
                        }
                        if (!tabId) return;
                        setActiveBrowserTabId(tabId);
                        setBrowserPanelMode("expanded");
                        await daemonApi.startBrowserTakeover(tabId, {
                          agenteId,
                          reason: "manual",
                        });
                      }}
                      onInspectAgentBrowsingLog={async (agenteId) => {
                        const data = await daemonApi.listUserBrowsingLog(agenteId);
                        const agName =
                          agentes.find((a) => a.agente_id === agenteId)?.nome ?? agenteId;
                        setBrowsingLogInspector({
                          agenteId,
                          agentName: agName,
                          steps: data.steps,
                          recordedTaskText: data.recordedTaskText,
                        });
                      }}
                      onOpenRoutineThread={(canalId) => {
                        setSidebarViewMode("agents");
                        if (canalId.startsWith("rotina:")) {
                          setActiveSideThreadId(canalId);
                        } else if (canalId.startsWith("agente:")) {
                          handleSelectAgent(canalId.slice("agente:".length));
                        } else {
                          handleSelectChannel(canalId);
                        }
                      }}
                      onRoutinesChanged={() => {
                        void refreshRoutineCounts();
                        setRoutinesRefreshNonce((n) => n + 1);
                        setFlowRefreshNonce((n) => n + 1);
                      }}
                      onSaveAgentSettings={async (agenteId, patch) => {
                        const updated = await daemonApi.updateAgentSettings(agenteId, patch);
                        setAgentes((prev) =>
                          prev.map((a) => (a.agente_id === updated.agente_id ? updated : a))
                        );
                      }}
                      onRestoreAgentDefaults={async (agenteId) => {
                        const restored = await daemonApi.restoreAgentDefaults(agenteId);
                        setAgentes((prev) =>
                          prev.map((a) => (a.agente_id === restored.agente_id ? restored : a))
                        );
                      }}
                      onLoadMemories={daemonApi.listAgentMemories}
                      onAddMemory={daemonApi.addAgentMemory}
                      onApproveTask={async (tarefaId) => {
                        await daemonApi.approveTask(tarefaId);
                        setTarefas(await daemonApi.listTasks());
                      }}
                      onRequestRevision={async (tarefa) => {
                        await daemonApi.createTask({
                          titulo: `Ajuste: ${tarefa.titulo}`,
                          tipo: tarefa.tipo,
                          prioridade: 2,
                          agente_id: tarefa.agente_id,
                          payload: { revisao_de: tarefa.tarefa_id },
                        });
                        setTarefas(await daemonApi.listTasks());
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}

          {activeSection === "fluxos" && (
            <WorkflowsCanvasPage
              workflows={workflows}
              agentes={agentes}
              canais={canais}
              arquivos={arquivos}
              provedores={provedores}
              uso={uso}
              workflowEventSignal={workflowEventSignal}
              onCreateWorkflow={async (input) => {
                const created = await daemonApi.saveWorkflow({
                  nome: input?.nome ?? "Novo fluxo criativo",
                  nos: input?.nos ?? [],
                  arestas: input?.arestas ?? [],
                  tracos: input?.tracos ?? [],
                });
                setWorkflows(await daemonApi.listWorkflows());
                return created;
              }}
              onGetWorkflowDetail={daemonApi.getWorkflowDetail}
              onSaveWorkflow={async (wf) => {
                const saved = await daemonApi.saveWorkflow(wf);
                setWorkflows(await daemonApi.listWorkflows());
                return saved;
              }}
              onDeleteWorkflow={async (wfId) => {
                await daemonApi.deleteWorkflow(wfId);
                setWorkflows(await daemonApi.listWorkflows());
              }}
              onListVersions={daemonApi.listWorkflowVersions}
              onGetVersion={daemonApi.getWorkflowVersion}
              onRestoreVersion={async (wfId, versionId) => {
                const det = await daemonApi.restoreWorkflowVersion(wfId, versionId);
                setWorkflows(await daemonApi.listWorkflows());
                return det;
              }}
              onExecuteWorkflow={async (wfId, options) => {
                const res = await daemonApi.executeWorkflow(wfId, options);
                setTarefas(await daemonApi.listTasks());
                return res;
              }}
              onExecuteStep={daemonApi.executeWorkflowStep}
              onListRuns={daemonApi.listWorkflowRuns}
              onGetRunDetail={daemonApi.getWorkflowRunDetail}
              onStopRun={daemonApi.stopWorkflowRun}
              onDecideStep={daemonApi.decideWorkflowStep}
              onRetryStep={daemonApi.retryWorkflowStep}
              onStopStep={daemonApi.stopWorkflowStep}
              onRotateWebhook={daemonApi.rotateWorkflowWebhookSecret}
              onUploadFile={async (file) => {
                await daemonApi.uploadFile(file);
                setArquivos(await daemonApi.listFiles());
              }}
            />
          )}

          {activeSection === "tarefas" && (
            <TasksQueuePage
              tarefas={tarefas}
              agentes={agentes}
              threads={allThreads}
              selectedTaskId={selectedTaskId}
              steps={steps}
              thoughtStream={thoughtStream}
              onSelectTask={setSelectedTaskId}
              onCreateTask={async (input) => {
                await daemonApi.createTask({
                  titulo: input.titulo,
                  tipo: input.tipo,
                  prioridade: input.prioridade,
                  payload: { prompt: input.prompt },
                });
                setTarefas(await daemonApi.listTasks());
              }}
              onCreateThread={async (input) => {
                const res = await daemonApi.createAgentThread(input.agenteId, {
                  titulo: input.titulo,
                  conteudo: input.conteudo,
                  anexos: input.anexos,
                  client_message_id: input.clientMessageId,
                });
                await refreshAgentThreadsState(input.agenteId, res.thread.thread_id);
                setTarefas(await daemonApi.listTasks());
                return res.thread;
              }}
              onOpenInChat={(thread) => {
                void handleOpenThreadInChat(thread);
              }}
              onUploadFile={handleUploadFile}
              onRefreshThreads={async () => {
                const threadsList = await daemonApi.listAllThreads();
                setAllThreads(threadsList);
                setTarefas(await daemonApi.listTasks());
              }}
              onRetryTask={(id) => {
                void daemonApi.retryTask(id).then(() => daemonApi.listTasks().then(setTarefas));
              }}
              onCancelTask={(id) => {
                void daemonApi.cancelTask(id).then(() => daemonApi.listTasks().then(setTarefas));
              }}
              onApproveTask={async (id) => {
                await daemonApi.approveTask(id);
                setTarefas(await daemonApi.listTasks());
              }}
              onRequestRevision={async (t) => {
                await daemonApi.createTask({
                  titulo: `Ajuste: ${t.titulo}`,
                  tipo: t.tipo,
                  prioridade: 2,
                  agente_id: t.agente_id,
                });
                setTarefas(await daemonApi.listTasks());
              }}
            />
          )}

          {activeSection === "agenda" && (
            <SchedulePage
              agentes={agentes}
              canais={canais}
              refreshNonce={routinesRefreshNonce}
              onOpenRoutine={(ownerKind, ownerId, rotinaId) => {
                setSidebarViewMode("agents");
                if (ownerKind === "agente") {
                  setRoutinesAgentId(ownerId);
                  setRoutinesSelectedRoutineId(rotinaId ?? null);
                  setRoutinesRightOpen(true);
                  setActiveSection("rotinas");
                  return;
                }
                handleSelectChannel(ownerId);
                setInspectorOpen(true);
                setRoutineInspectorSignal({
                  subView: "routines",
                  rotinaId,
                  nonce: Date.now(),
                });
              }}
              onOpenAgentChat={(agenteId) => {
                setActiveSection("agentes");
                setSidebarViewMode("agents");
                handleSelectAgent(agenteId);
              }}
              onCreateFirstRoutine={(defaultAgentId) => {
                setSidebarViewMode("agents");
                setRoutinesAgentId(defaultAgentId);
                setRoutinesSelectedRoutineId("__new__");
                setRoutinesRightOpen(true);
                setActiveSection("rotinas");
              }}
            />
          )}

          {activeSection === "uso" && (
            <UsageMetricsPage
              uso={uso}
              provedores={provedores}
              analytics={analyticsUso}
              agentes={agentes}
              periodoDias={usoPeriodoDias}
              agenteFiltroId={usoAgenteFiltro}
              onChangeFilters={async (dias, agId) => {
                setUsoPeriodoDias(dias);
                setUsoAgenteFiltro(agId);
                setAnalyticsUso(await daemonApi.getUsageAnalytics({ dias, agente_id: agId }));
              }}
              onRefresh={async () => {
                const [provList, usageSnap, analyticsData] = await Promise.all([
                  daemonApi.listProvidersStatus(true),
                  daemonApi.getProvidersUsage(true),
                  daemonApi.getUsageAnalytics({ dias: usoPeriodoDias, agente_id: usoAgenteFiltro }),
                ]);
                setProvedores(provList);
                setUso(usageSnap);
                setAnalyticsUso(analyticsData);
              }}
            />
          )}

          {activeSection === "arquivos" && (
            <FilesVaultPage
              arquivos={arquivos}
              onUploadFile={handleUploadFile}
              onDeleteFile={handleDeleteFile}
              agentes={agentes}
              foldersSnapshot={foldersSnapshot}
              onRefreshFolders={refreshLibraryFolders}
              onPreviewFile={(arq) => setPreviewFile(arq)}
            />
          )}

          {activeSection === "loja" && (
            <MarketplacePage
              agentes={agentes}
              initialAppSlug={lojaInitialAppSlug}
              onRefreshStudio={hydrateAll}
              onTryPromptInChat={(agentId, prompt) => {
                handleSelectAgent(agentId);
                setPrefilledChatPrompt(prompt);
              }}
              onCreateSkillWithAgent={(agentId, prompt) => {
                handleSelectAgent(agentId);
                setPrefilledChatPrompt(prompt);
              }}
              onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
            />
          )}

          {activeSection === "conexoes" && (
            <ConnectorsPage
              provedores={provedores}
              vaultKeys={vaultKeys}
              whatsappStatus={whatsappStatus}
              agentes={agentes}
              habilidades={habilidades}
              upgrades={upgrades}
              conectores={conectores}
              showcaseSites={showcaseSites}
              onPublishShowcase={async (payload) => {
                const res = await daemonApi.publishShowcaseSite(payload);
                if (res.ok) {
                  setShowcaseSites(await daemonApi.listShowcaseSites());
                }
                return res;
              }}
              onReplaceShowcase={async (siteId, payload) => {
                const res = await daemonApi.replaceShowcaseSite(siteId, payload);
                if (res.ok) {
                  setShowcaseSites(await daemonApi.listShowcaseSites());
                }
                return res;
              }}
              onDeleteShowcase={async (siteId) => {
                await daemonApi.deleteShowcaseSite(siteId, true);
                setShowcaseSites(await daemonApi.listShowcaseSites());
              }}
              onInstallUpgrade={async (pacote) => {
                const nextUpgrades = await daemonApi.installUpgrade(pacote);
                setUpgrades(nextUpgrades);
                setAgentes(await daemonApi.listAgents());
                setHabilidades(await daemonApi.listSkills());
              }}
              defaultProvider={onboarding?.provedor_selecionado ?? "gemini"}
              onSelectDefaultProvider={async (prov) => {
                const updated = await daemonApi.updateOnboarding({ provedor_selecionado: prov });
                setOnboarding(updated);
              }}
              onRefreshProviders={async () => {
                const [provList, usageSnap, connList, skillsList] = await Promise.all([
                  daemonApi.listProvidersStatus(true),
                  daemonApi.getProvidersUsage(true),
                  daemonApi.listConnectors(),
                  daemonApi.listSkills(),
                ]);
                setProvedores(provList);
                setUso(usageSnap);
                setConectores(connList);
                setHabilidades(skillsList);
              }}
              onTogglePool={async (prov, habilitado) => {
                const nextProvs = await daemonApi.setProviderPool(prov, { habilitado });
                setProvedores(nextProvs);
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onSetAccountActive={async (prov, contaId) => {
                const nextProvs = await daemonApi.setProviderPool(prov, { conta_em_uso: contaId });
                setProvedores(nextProvs);
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onToggleAccountExcluded={async (prov, contaId, exclude) => {
                const currentExcl =
                  provedores.find((p) => p.provedor === prov)?.pool?.contas_excluidas ?? [];
                const nextExcl = exclude
                  ? Array.from(new Set([...currentExcl, contaId]))
                  : currentExcl.filter((id) => id !== contaId);
                const nextProvs = await daemonApi.setProviderPool(prov, {
                  contas_excluidas: nextExcl,
                });
                setProvedores(nextProvs);
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onSetModelsVisibility={async (prov, hiddenIds) => {
                const nextProvs = await daemonApi.setProviderModelsVisibility(prov, hiddenIds);
                setProvedores(nextProvs);
              }}
              onConnectProviderViaBrowser={handleConnectViaBrowser}
              onCancelProviderBrowserSignIn={handleCancelBrowserSignIn}
              pendingAuthUrl={pendingAuthLink}
              activeServerName={
                servers.find((s) => s.server_id === activeServerId)?.nome ?? "Servidor Principal"
              }
              activeServerKind={
                servers.find((s) => s.server_id === activeServerId)?.kind ?? "primary"
              }
              onSubmitManualOAuthCallback={async (prov, callbackUrl) => {
                const relay = await daemonApi.enviarCallbackOAuthManual(prov, callbackUrl);
                if (!relay.ok) {
                  throw new Error(relay.erro ?? "Não foi possível entregar o callback OAuth.");
                }
              }}
              onAddProviderAccount={async (prov, payload) => {
                const res = await daemonApi.addProviderAccount(prov, payload);
                setProvedores(res.provedores);
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onRemoveProviderAccount={async (prov, contaId) => {
                const nextProvs = await daemonApi.removeProviderAccount(prov, contaId);
                setProvedores(nextProvs);
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onConfigureConnector={async (conectorId, payload) => {
                const res = await daemonApi.configureConnector(conectorId, payload);
                setConectores(res.conectores);
                setVaultKeys(await daemonApi.getVaultStatus());
              }}
              onTestConnector={(conectorId) => daemonApi.testConnector(conectorId)}
              onConnectProvider={async (prov: ProviderName, key?: string) => {
                await daemonApi.connectProvider(prov, key);
                setProvedores(await daemonApi.listProvidersStatus(false));
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onDisconnectProvider={async (prov: ProviderName) => {
                await daemonApi.disconnectProvider(prov);
                setProvedores(await daemonApi.listProvidersStatus(false));
                setUso(await daemonApi.getProvidersUsage(true));
              }}
              onSaveVaultSecret={async (chave, valor) => {
                await daemonApi.saveVaultSecret(chave, valor);
                setVaultKeys(await daemonApi.getVaultStatus());
                setConectores(await daemonApi.listConnectors());
              }}
              onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
              onReopenOnboarding={async () => {
                const reset = await daemonApi.updateOnboarding({ onboarding_concluido: false });
                setOnboarding(reset);
              }}
            />
          )}

          {activeSection === "rotinas" && (() => {
            const unlockedAgents = agentes.filter(
              (a) =>
                a.agente_id !== "assistente_setup" &&
                a.agente_id !== "assistente_servidor_vps" &&
                (a.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
            );
            const poolAgents = unlockedAgents.length > 0 ? unlockedAgents : agentes;
            const query = routinesAgentSearch.trim().toLowerCase();
            const visibleAgents = query
              ? poolAgents.filter(
                  (a) =>
                    a.nome.toLowerCase().includes(query) ||
                    (a.papel ?? "").toLowerCase().includes(query)
                )
              : poolAgents;
            const selectedRoutineAgent =
              poolAgents.find((a) => a.agente_id === routinesAgentId) ??
              poolAgents.find((a) => a.agente_id === activeAgent?.agente_id) ??
              poolAgents[0] ??
              null;

            return (
              <div className="flex-1 min-w-0 flex overflow-hidden bg-[#0F0F11]">
                {/* Lista lateral de agentes para navegação entre rotinas */}
                <aside className="w-[264px] shrink-0 border-r border-white/[0.06] bg-[#141416] flex flex-col overflow-hidden">
                  <div className="px-4 py-3.5 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Workflow className="h-4 w-4 text-[#42A0FF]" />
                        <h2 className="text-[13.5px] font-semibold text-[#F4F4F5]">Rotinas</h2>
                      </div>
                      <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold text-[#A1A1AA]">
                        {Object.values(routineCountsByAgent).reduce((acc, n) => acc + n, 0)} ativas
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#7A7A85]">
                      Automações e gatilhos organizados por especialista.
                    </p>
                    <div className="mt-2.5 relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#7A7A85]" />
                      <input
                        type="text"
                        value={routinesAgentSearch}
                        onChange={(e) => setRoutinesAgentSearch(e.target.value)}
                        placeholder="Filtrar agentes..."
                        className="w-full rounded-lg border border-white/[0.08] bg-[#1B1B1F] pl-8 pr-3 py-1.5 text-[12px] text-[#E4E4E7] placeholder:text-[#6B6B76] focus:border-[#42A0FF]/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                    {visibleAgents.length === 0 ? (
                      <div className="px-3 py-6 text-center text-[12px] text-[#7A7A85]">
                        Nenhum agente encontrado para "{routinesAgentSearch}".
                      </div>
                    ) : (
                      visibleAgents.map((ag) => {
                        const isSelected = selectedRoutineAgent?.agente_id === ag.agente_id;
                        const count = routineCountsByAgent[ag.agente_id] ?? 0;
                        const av = getAgentAvatar(ag);
                        return (
                          <button
                            key={ag.agente_id}
                            type="button"
                            onClick={() => {
                              setRoutinesAgentId(ag.agente_id);
                              setRoutinesSelectedRoutineId(null);
                            }}
                            className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                              isSelected
                                ? "bg-white/[0.09] text-[#F4F4F5] ring-1 ring-white/[0.12]"
                                : "text-[#B4B4BE] hover:bg-white/[0.04] hover:text-[#F4F4F5]"
                            }`}
                          >
                            <MascoteAvatar
                              avatar={av}
                              agentKey={ag.agente_id}
                              size={26}
                              label={ag.nome}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-medium">{ag.nome}</div>
                              <div className="truncate text-[10.5px] text-[#7A7A85]">
                                {ag.papel ?? "Especialista"}
                              </div>
                            </div>
                            {count > 0 && (
                              <span
                                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                                  isSelected
                                    ? "bg-[#42A0FF]/20 text-[#60B4FF]"
                                    : "bg-white/[0.06] text-[#9E9EA8]"
                                }`}
                              >
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>

                {/* Canvas central de fluxos de rotina */}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                  {selectedRoutineAgent ? (
                    <>
                      <div className="h-[46px] shrink-0 border-b border-white/[0.06] bg-[#141416] px-4 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <MascoteAvatar
                            avatar={getAgentAvatar(selectedRoutineAgent)}
                            agentKey={selectedRoutineAgent.agente_id}
                            size={24}
                            label={selectedRoutineAgent.nome}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-[#F4F4F5]">
                              {selectedRoutineAgent.nome}
                            </div>
                          </div>
                          <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[#9E9EA8]">
                            {routineCountsByAgent[selectedRoutineAgent.agente_id] ?? 0} rotina(s)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSection("agentes");
                              setSidebarViewMode("agents");
                              handleSelectAgent(selectedRoutineAgent.agente_id);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#1E1E22] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#27272C]"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-[#42A0FF]" />
                            <span>Abrir chat</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRoutinesRightOpen((o) => !o)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#1E1E22] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#27272C]"
                          >
                            {routinesRightOpen ? (
                              <>
                                <PanelRightClose className="h-3.5 w-3.5 text-[#9E9EA8]" />
                                <span>Ocultar painel</span>
                              </>
                            ) : (
                              <>
                                <PanelRightOpen className="h-3.5 w-3.5 text-[#42A0FF]" />
                                <span>Configurar rotinas</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 min-h-0 flex overflow-hidden">
                        <RoutineFlowsCanvas
                          agente={selectedRoutineAgent}
                          allAgentes={agentes}
                          refreshSignal={flowRefreshNonce}
                          onOpenRoutineSettings={(rotinaId) => {
                            setRoutinesSelectedRoutineId(rotinaId ?? "__new__");
                            setRoutinesRightOpen(true);
                          }}
                          onOpenAgentChat={(agenteId) => {
                            setActiveSection("agentes");
                            setSidebarViewMode("agents");
                            handleSelectAgent(agenteId);
                          }}
                        />

                        {routinesRightOpen && (
                          <div
                            data-testid="routines-right-panel"
                            className={`w-[380px] xl:w-[420px] shrink-0 border-l border-white/[0.06] bg-[#141416] flex flex-col min-h-0 overflow-y-auto px-5 py-5 pb-12 ${
                              agentDockPinned ? "pr-16" : ""
                            }`}
                          >
                            <AgentRoutinesSettings
                              key={selectedRoutineAgent.agente_id}
                              ownerKind="agente"
                              ownerId={selectedRoutineAgent.agente_id}
                              ownerName={selectedRoutineAgent.nome}
                              canais={canais}
                              initialSelectedRoutineId={routinesSelectedRoutineId}
                              onBackToHub={() => setRoutinesSelectedRoutineId(null)}
                              onOpenThreadOrChat={(canalId) => {
                                setActiveSection("agentes");
                                setSidebarViewMode("agents");
                                if (canalId.startsWith("rotina:")) {
                                  setActiveSideThreadId(canalId);
                                } else if (canalId.startsWith("agente:")) {
                                  handleSelectAgent(canalId.slice("agente:".length));
                                } else {
                                  handleSelectChannel(canalId);
                                }
                              }}
                              onRoutinesChanged={() => {
                                void refreshRoutineCounts();
                                setRoutinesRefreshNonce((n) => n + 1);
                                setFlowRefreshNonce((n) => n + 1);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[13px] text-[#7A7A85]">
                      Nenhum agente disponível para configurar rotinas.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {activeSection === "configuracoes" && (
            <SettingsModal
              variant="page"
              open={true}
              initialTab={settingsInitialTab}
              settings={userSettings}
              storageUsage={storageUsage}
              whatsNew={whatsNew}
              browserProfiles={browserProfiles}
              browserProxies={browserProxies}
              browserStatus={browserStatus}
              agentes={agentes}
              canais={canais}
              onClose={closeSettings}
              onSaveSettings={async (nextSettings) => {
                const saved = await daemonApi.updateUserSettings(nextSettings);
                setUserSettings(saved);
                applyUserSettingsToDocument(saved);
              }}
              onRefreshStorage={async () => {
                setStorageUsage(await daemonApi.getStorageUsage());
              }}
              onClearStorage={async (category) => {
                const res = await daemonApi.clearStorageCategory(category);
                setStorageUsage(res.snapshot);
              }}
              onDeleteStorageFile={async (arquivoId) => {
                const res = await daemonApi.deleteStorageFile(arquivoId);
                setStorageUsage(res.snapshot);
                setArquivos(await daemonApi.listFiles());
              }}
              onCheckUpdates={async () => {
                const [wn, up] = await Promise.all([
                  daemonApi.getWhatsNew().catch(() => null),
                  daemonApi.verificarAtualizacoes().catch(() => null),
                ]);
                if (wn) setWhatsNew(wn);
                if (up) setUpdateStatus(up);
              }}
              updateStatus={updateStatus}
              activeServerName={
                servers.find((s) => s.server_id === activeServerId)?.nome ?? "Servidor Principal"
              }
              onApplyUpdate={handleApplyUpdate}
              onRestartForUpdate={async () => {
                await daemonApi.triggerUpdateRestart();
              }}
              onResetLayoutWidths={handleResetLayoutWidths}
              pinnedAgentIds={sidebarLayout?.pins ?? []}
              onReopenSetupAssistant={async () => {
                const res = await daemonApi.setSetupAssistantState("reopen");
                setOnboarding(res.onboarding);
                const nextAgents = await daemonApi.listAgents({ includeSetup: true });
                setAgentes(nextAgents);
                setActiveSection("agentes");
                handleSelectAgent("assistente_setup");
              }}
              deletedNativeAgents={deletedNativeAgents}
              onRestoreDeletedAgent={handleRestoreDeletedAgent}
              onRestoreAllDeletedAgents={handleRestoreAllDeletedAgents}
              licenseStatus={licenseStatus}
              onRefreshLicense={async () => {
                const next = await daemonApi.sincronizarLicenca();
                setLicenseStatus(next);
              }}
              onDeactivateLicenseDevice={async (payload) => {
                const res = await daemonApi.desvincularDispositivoLicenca(payload);
                if (res.status) setLicenseStatus(res.status);
                return res;
              }}
              onCreateBrowserProfile={async (input) => {
                await daemonApi.createBrowserProfile(input);
                setBrowserProfiles(await daemonApi.listBrowserProfiles());
              }}
              onUpdateBrowserProfile={async (perfilId, patch) => {
                await daemonApi.updateBrowserProfile(perfilId, patch);
                setBrowserProfiles(await daemonApi.listBrowserProfiles());
              }}
              onOpenBrowserProfile={async (perfilId) => {
                await daemonApi.openBrowserProfileWindow(perfilId);
                setBrowserProfiles(await daemonApi.listBrowserProfiles());
              }}
              onClearBrowserProfile={async (perfilId) => {
                await daemonApi.clearBrowserProfile(perfilId);
                setBrowserProfiles(await daemonApi.listBrowserProfiles());
              }}
              onDeleteBrowserProfile={async (perfilId) => {
                await daemonApi.deleteBrowserProfile(perfilId);
                const [nextProfiles, nextAgents] = await Promise.all([
                  daemonApi.listBrowserProfiles(),
                  daemonApi.listAgents(),
                ]);
                setBrowserProfiles(nextProfiles);
                setAgentes(nextAgents);
              }}
              onSaveBrowserProxy={async (input) => {
                const saved = await daemonApi.saveBrowserProxy(input);
                setBrowserProxies(await daemonApi.listBrowserProxies());
                return saved;
              }}
              onDeleteBrowserProxy={async (proxyId) => {
                await daemonApi.deleteBrowserProxy(proxyId);
                setBrowserProxies(await daemonApi.listBrowserProxies());
              }}
            />
          )}

          {previewFile && (
            <FilePreviewPanel
              file={previewFile}
              onClose={() => setPreviewFile(null)}
              onOpenImageLightbox={(url, alt) => setLightboxImage({ url, alt })}
            />
          )}
        </main>
      </div>

      <SharedTablesModal
        open={sharedTablesOpen}
        onClose={() => setSharedTablesOpen(false)}
        refreshToken={sharedTablesRefreshNonce}
      />

      <ImageLightbox
        open={Boolean(lightboxImage)}
        url={lightboxImage?.url ?? ""}
        alt={lightboxImage?.alt}
        onClose={() => setLightboxImage(null)}
      />

      {/* Modal Pareamento WhatsApp */}
      <WhatsAppPairingModal
        open={whatsappModalOpen}
        status={whatsappStatus}
        qrcodeBase64={whatsappQr}
        accounts={whatsappAccounts}
        agentes={agentes}
        onRefreshAccounts={async () => {
          setWhatsappAccounts(await daemonApi.listWhatsAppAccounts());
        }}
        onClose={() => setWhatsappModalOpen(false)}
        onConnect={async () => {
          const snap = await daemonApi.connectWhatsApp();
          setWhatsappStatus(snap.status);
          setWhatsappQr(snap.qrcode_base64);
          setWhatsappAccounts(await daemonApi.listWhatsAppAccounts().catch(() => whatsappAccounts));
        }}
        onDisconnect={async () => {
          await daemonApi.disconnectWhatsApp();
          setWhatsappStatus("desconectado");
          setWhatsappQr(null);
          setWhatsappAccounts(await daemonApi.listWhatsAppAccounts().catch(() => whatsappAccounts));
        }}
      />

      {/* Modal Nova equipe */}
      {channelModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nova equipe"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateChannelSubmit}
            className="w-full max-w-md rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white flex items-center gap-2">
                <Users className="h-4 w-4 text-[#31CF76]" />
                <span>Nova equipe</span>
              </h3>
              <button
                type="button"
                onClick={() => setChannelModalOpen(false)}
                className="text-[#979797] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label htmlFor="new-channel-name" className="block text-[11.5px] text-[#979797] mb-1">
                Nome da equipe
              </label>
              <input
                id="new-channel-name"
                name="new_channel_name"
                aria-label="Nome da equipe"
                required
                type="text"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="#lancamento-semanal"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[13px] text-white"
              />
            </div>

            <div>
              <label htmlFor="new-channel-desc" className="block text-[11.5px] text-[#979797] mb-1">
                Objetivo
              </label>
              <input
                id="new-channel-desc"
                name="new_channel_desc"
                aria-label="Objetivo da equipe"
                type="text"
                value={newChannelDesc}
                onChange={(e) => setNewChannelDesc(e.target.value)}
                placeholder="Coordenar pauta, copy e carrosséis da semana"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[13px] text-white"
              />
            </div>

            <div>
              <span className="block text-[11.5px] text-[#979797] mb-1.5">
                Agentes participantes ({newChannelMembers.length})
              </span>
              <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                {agentes.map((ag) => {
                  const checked = newChannelMembers.includes(ag.agente_id);
                  return (
                    <label
                      key={ag.agente_id}
                      htmlFor={`ch-member-${ag.agente_id}`}
                      className="flex items-center gap-2 rounded-lg bg-[#1A1A1A] px-2.5 py-1.5 text-[12px] text-white cursor-pointer"
                    >
                      <input
                        id={`ch-member-${ag.agente_id}`}
                        name={`member_${ag.agente_id}`}
                        aria-label={`Incluir ${ag.nome}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setNewChannelMembers((prev) =>
                            checked
                              ? prev.filter((id) => id !== ag.agente_id)
                              : [...prev, ag.agente_id]
                          )
                        }
                        className="accent-[#31CF76]"
                      />
                      <span className="truncate">{ag.nome}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setChannelModalOpen(false)}
                className="studio-btn-secondary px-4 py-1.5 text-[12.5px]"
              >
                Cancelar
              </button>
              <button type="submit" className="studio-btn-primary px-5 py-1.5 text-[12.5px]">
                Criar equipe
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Guia Rápido */}
      {helpModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ajuda e arquitetura Criativo AI Studio"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white">
                Criativo AI Studio Online — Guia Rápido
              </h3>
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="text-[#979797] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-2 text-[12.5px] text-[#DCDCDC] list-disc pl-5">
              <li>Use o trilho esquerdo para alternar entre <strong>Estúdio</strong>, <strong>Automações</strong>, <strong>Tarefas</strong>, <strong>Calendário</strong>, <strong>Consumo</strong>, <strong>Biblioteca</strong>, <strong>Catálogo</strong> e <strong>Integrações</strong>.</li>
              <li>Nos chats, anexe fotos reais ou logos pelo botão <strong>+</strong>; designers usam modelos generativos de imagem nativamente e o Remotion gera Reels 9:16 MP4.</li>
              <li>Toda publicação Instagram passa por <strong>Aprovação Humana obrigatória</strong> no Cockpit ou via resposta &ldquo;1&rdquo; no WhatsApp pareado.</li>
            </ul>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="studio-btn-primary px-4 py-1.5 text-[12.5px]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts de notificações de rotinas */}
      {routineNotifications.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 w-80 space-y-2"
        >
          {routineNotifications.map((toast) => (
            <div
              key={toast.id}
              className="rounded-xl bg-[#212121] border border-[#007CF7] p-3.5 shadow-2xl space-y-2"
            >
              <p className="text-[13px] font-semibold text-[#F0F0F0]">
                {toast.rotina_nome}
              </p>
              <p className="text-[12px] font-normal text-[#DCDCDC] line-clamp-3">
                {toast.resumo}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSidebarViewMode("agents");
                    handleSelectAgent(toast.owner_id);
                    setRoutineNotifications((prev) =>
                      prev.filter((item) => item.id !== toast.id)
                    );
                  }}
                  className="rounded-lg bg-[#007CF7] px-2.5 py-1 text-[12px] font-semibold text-white"
                >
                  Abrir agente
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRoutineNotifications((prev) =>
                      prev.filter((item) => item.id !== toast.id)
                    )
                  }
                  className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[12px] font-normal text-[#DCDCDC]"
                >
                  Fechar aviso
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!getCriativoDesktopBridge()?.dockSetVisible && (
        <QuickAgentDrawer
          enabled={userSettings.comportamento.habilitar_drawer_rapido}
          agentes={agentes}
          pinnedIds={sidebarLayout?.pins ?? []}
          selectedAgentId={activeAgent?.agente_id ?? null}
          workingAgentIds={workingAgentIds}
          pinned={agentDockPinned}
          onTogglePinned={handleToggleAgentDockPinned}
          onCreateAgent={handleOpenNewAgentTab}
          onSelectAgent={handleSelectAgent}
          dockSettings={userSettings.dock ?? null}
          onOpenDockSettings={() => openSettings("dock")}
          onToggleAgentInDock={async (agenteId, included) => {
            const currentDock = {
              ...DEFAULT_FRONTEND_DOCK_SETTINGS,
              ...(userSettings.dock ?? {}),
            };
            const currentIds = Array.isArray(currentDock.agentes_ids)
              ? currentDock.agentes_ids
              : resolveEffectiveDockAgentIds(agentes, currentDock.agentes_ids, sidebarLayout?.pins ?? []);
            const nextIds = included
              ? Array.from(new Set([...currentIds, agenteId]))
              : currentIds.filter((id) => id !== agenteId);
            const nextSettings: StudioUserSettings = {
              ...userSettings,
              dock: { ...currentDock, agentes_ids: nextIds },
            };
            setUserSettings(nextSettings);
            const saved = await daemonApi.updateUserSettings({ dock: nextSettings.dock });
            setUserSettings(saved);
          }}
        />
      )}

      {browserPanelMode === "expanded" && browserTabs.length > 0 && (
        <InAppBrowserPanel
          mode="expanded"
          tabs={browserTabs}
          activeTabId={activeBrowserTabId}
          framesByTab={browserFramesByTab}
          agentName={activeAgent?.nome ?? "Agente"}
          agentAvatar={getAgentAvatar(activeAgent)}
          agentAvatarShape={getAgentAvatar(activeAgent).shape}
          agentAvatarColor={getAgentAvatar(activeAgent).color}
          agentWorking={activeAgent ? workingAgentIds.has(activeAgent.agente_id) : false}
          takeoverPending={Boolean(
            (activeAgent && takeoverByAgent[activeAgent.agente_id]) ||
              browserTabs.some((t) => t.tabId === activeBrowserTabId && t.userControl)
          )}
          profileLabel={
            browserProfiles.find(
              (p) =>
                p.perfil_id ===
                browserTabs.find((t) => t.tabId === activeBrowserTabId)?.perfilId
            )?.nome ?? "Perfil Compartilhado"
          }
          teachRecording={Boolean(
            activeBrowserTabId && teachStatusByTab[activeBrowserTabId]?.recording
          )}
          teachStartedAt={
            activeBrowserTabId ? teachStatusByTab[activeBrowserTabId]?.startedAt ?? null : null
          }
          teachStepsCount={
            activeBrowserTabId ? teachStatusByTab[activeBrowserTabId]?.stepsCount ?? 0 : 0
          }
          onSelectTab={(tId) => setActiveBrowserTabId(tId)}
          onNewTab={async () => {
            const res = (await daemonApi.runBrowserSessionAction({
              action: "open",
              agenteId: activeAgent?.agente_id ?? undefined,
              url: "https://www.google.com",
            })) as { tabId?: string; result?: { tabId?: string } };
            const newId = res?.result?.tabId ?? res?.tabId;
            if (newId) setActiveBrowserTabId(newId);
          }}
          onCloseTab={async (tId) => {
            await daemonApi.runBrowserSessionAction({ action: "close_tab", tabId: tId });
          }}
          onNavigate={async (tId, url) => {
            await daemonApi.runBrowserSessionAction({
              action: "navigate",
              tabId: tId,
              url,
            });
          }}
          onGoBack={async (tId) => {
            await daemonApi.runBrowserSessionAction({ action: "go_back", tabId: tId });
          }}
          onGoForward={async (tId) => {
            await daemonApi.runBrowserSessionAction({ action: "go_forward", tabId: tId });
          }}
          onReload={async (tId) => {
            await daemonApi.runBrowserSessionAction({ action: "reload", tabId: tId });
          }}
          onExpand={() => setBrowserPanelMode("expanded")}
          onCollapseToChat={() => setBrowserPanelMode("sidebar")}
          onClosePanel={() => setBrowserPanelMode("closed")}
          onAssumeControl={async (tId) => {
            await daemonApi.startBrowserTakeover(tId, {
              agenteId: activeAgent?.agente_id ?? null,
              reason: "manual",
            });
          }}
          onCompleteControl={async (tId) => {
            await daemonApi.respondBrowserTakeover(tId, "complete");
          }}
          onSendInput={async (tId, input, autoAssume) => {
            await daemonApi.sendBrowserInput(tId, { ...input, autoAssume });
          }}
          onSendQuickChat={async (text) => {
            await handleSendChatMessage(text, []);
          }}
          onStartTeach={async () => {
            if (!activeBrowserTabId) return;
            const started = await daemonApi.startTeachRecording(
              activeBrowserTabId,
              activeAgent?.agente_id ?? null
            );
            setTeachStatusByTab((prev) => ({
              ...prev,
              [activeBrowserTabId]: {
                recording: true,
                startedAt: started.startedAt,
                stepsCount: 0,
              },
            }));
          }}
          onStopTeach={async (action) => {
            if (!activeBrowserTabId) return;
            const stopped = await daemonApi.stopTeachRecording(activeBrowserTabId, action);
            setTeachStatusByTab((prev) => ({
              ...prev,
              [activeBrowserTabId]: {
                recording: false,
                startedAt: null,
                stepsCount: stopped.steps.length,
              },
            }));
            if (action === "save" && stopped.recordedTaskText && activeAgent) {
              setBrowsingLogInspector({
                agenteId: activeAgent.agente_id,
                agentName: activeAgent.nome,
                steps: stopped.steps,
                recordedTaskText: stopped.recordedTaskText,
              });
            }
          }}
        />
      )}

      {activeTakeoverModal && (
        <BrowserTakeoverModal
          open={Boolean(activeTakeoverModal)}
          tabId={activeTakeoverModal.tabId}
          agentName={
            agentes.find((a) => a.agente_id === activeTakeoverModal.agenteId)?.nome ??
            "Agente de Pesquisa"
          }
          url={
            activeTakeoverFrame?.tabId === activeTakeoverModal.tabId
              ? activeTakeoverFrame.url
              : activeTakeoverModal.url
          }
          title={
            activeTakeoverFrame?.tabId === activeTakeoverModal.tabId
              ? activeTakeoverFrame.title
              : activeTakeoverModal.title
          }
          profileLabel={
            browserProfiles.find((p) => p.perfil_id === activeTakeoverModal.perfilId)?.nome ??
            "Perfil Compartilhado"
          }
          frameDataUrl={
            activeTakeoverFrame?.tabId === activeTakeoverModal.tabId
              ? activeTakeoverFrame.dataUrl
              : activeTakeoverModal.previewDataUrl ?? null
          }
          frameWidth={
            activeTakeoverFrame?.tabId === activeTakeoverModal.tabId
              ? activeTakeoverFrame.width
              : 1280
          }
          frameHeight={
            activeTakeoverFrame?.tabId === activeTakeoverModal.tabId
              ? activeTakeoverFrame.height
              : 720
          }
          teachRecording={Boolean(teachStatusByTab[activeTakeoverModal.tabId]?.recording)}
          teachStartedAt={teachStatusByTab[activeTakeoverModal.tabId]?.startedAt ?? null}
          teachStepsCount={teachStatusByTab[activeTakeoverModal.tabId]?.stepsCount ?? 0}
          onClose={() => setActiveTakeoverModal(null)}
          onCompleteSession={async (tId) => {
            await daemonApi.respondBrowserTakeover(tId, "complete");
            setActiveTakeoverModal(null);
          }}
          onCancelSession={async (tId) => {
            await daemonApi.respondBrowserTakeover(tId, "cancel");
            setActiveTakeoverModal(null);
          }}
          onSendInput={async (tId, input) => {
            await daemonApi.sendBrowserInput(tId, input);
          }}
          onStartTeach={async () => {
            const started = await daemonApi.startTeachRecording(
              activeTakeoverModal.tabId,
              activeTakeoverModal.agenteId
            );
            setTeachStatusByTab((prev) => ({
              ...prev,
              [activeTakeoverModal.tabId]: {
                recording: true,
                startedAt: started.startedAt,
                stepsCount: 0,
              },
            }));
          }}
          onStopTeach={async (action) => {
            const stopped = await daemonApi.stopTeachRecording(
              activeTakeoverModal.tabId,
              action
            );
            setTeachStatusByTab((prev) => ({
              ...prev,
              [activeTakeoverModal.tabId]: {
                recording: false,
                startedAt: null,
                stepsCount: stopped.steps.length,
              },
            }));
            if (action === "save" && stopped.recordedTaskText && activeTakeoverModal.agenteId) {
              setBrowsingLogInspector({
                agenteId: activeTakeoverModal.agenteId,
                agentName:
                  agentes.find((a) => a.agente_id === activeTakeoverModal.agenteId)?.nome ??
                  activeTakeoverModal.agenteId,
                steps: stopped.steps,
                recordedTaskText: stopped.recordedTaskText,
              });
            }
          }}
        />
      )}

      {browsingLogInspector && (
        <UserBrowsingLogInspector
          open={Boolean(browsingLogInspector)}
          agentName={browsingLogInspector.agentName}
          steps={browsingLogInspector.steps}
          recordedTaskText={browsingLogInspector.recordedTaskText}
          onClose={() => setBrowsingLogInspector(null)}
          onAttachRecordedTask={(taskText) => {
            setPrefilledChatPrompt(taskText);
            handleSelectAgent(browsingLogInspector.agenteId);
            setBrowsingLogInspector(null);
          }}
          onClearLog={async () => {
            await daemonApi.clearUserBrowsingLog(browsingLogInspector.agenteId);
            setBrowsingLogInspector((prev) =>
              prev ? { ...prev, steps: [], recordedTaskText: "" } : null
            );
          }}
        />
      )}

      <NewLocalServerModal
        open={newLocalModalOpen}
        quota={serverQuota}
        onClose={() => setNewLocalModalOpen(false)}
        onOpenLicenseSettings={() => openSettings("licenca")}
        onCreated={async (srv, nextList) => {
          setServers(nextList);
          await handleSwitchServer(srv.server_id);
        }}
      />

      <NewRemoteServerClaimModal
        open={newRemoteModalOpen}
        quota={serverQuota}
        onClose={() => setNewRemoteModalOpen(false)}
        onOpenLicenseSettings={() => openSettings("licenca")}
        onConfigureWithAgent={(promptText, claimTicket) => {
          void handleConfigureServerWithAgent(promptText, claimTicket);
        }}
        onOpenPairedServer={async (srv) => {
          await handleSwitchServer(srv.server_id);
        }}
      />

      <JoinServerModal
        open={joinServerModalOpen}
        onClose={() => setJoinServerModalOpen(false)}
        onJoined={async (srv, nextList) => {
          setServers(nextList);
          await handleSwitchServer(srv.server_id);
        }}
      />

      <ServerSettingsModal
        open={Boolean(serverSettingsTarget)}
        server={serverSettingsTarget}
        onClose={() => setServerSettingsTarget(null)}
        onUpdated={async (nextList, updatedSrv) => {
          setServers(nextList);
          setServerSettingsTarget(updatedSrv);
        }}
        onRemoved={async (nextList, nextActiveId) => {
          setServers(nextList);
          await handleSwitchServer(nextActiveId);
        }}
      />
      </div>
      {renderSplashOverlay()}
    </>
  );
}
