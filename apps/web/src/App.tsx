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
  BrowserTakeoverSession,
  CanalEquipe,
  CaptureScreenConsentRequest,
  ConectorIntegracaoInfo,
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
import { PanelLeft, Settings, Users, X } from "lucide-react";
import { DynamicIsland, type StudioTabItem } from "./components/DynamicIsland";
import { getDefaultMascotForAgent } from "./components/MascoteAvatar";
import { Sidebar } from "./components/Sidebar";
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
import { RightInspectorPanel } from "./features/inspector/RightInspectorPanel";
import { MarketplacePage } from "./features/marketplace/MarketplacePage";
import { OnboardingFlow } from "./features/onboarding/OnboardingFlow";
import { ConnectorsPage } from "./features/pages/ConnectorsPage";
import { FilesVaultPage } from "./features/pages/FilesVaultPage";
import { TasksQueuePage } from "./features/pages/TasksQueuePage";
import { UsageMetricsPage } from "./features/pages/UsageMetricsPage";
import { RoutineFlowsCanvas } from "./features/routines/RoutineFlowsCanvas";
import { SchedulePage } from "./features/schedule/SchedulePage";
import type { AgentStepLog } from "./features/trace/AgentStepsWaterfall";
import { WhatsAppPairingModal } from "./features/whatsapp/WhatsAppPairingModal";
import { BrowserTakeoverModal } from "./features/browser/BrowserTakeoverModal";
import { UserBrowsingLogInspector } from "./features/browser/BrowserTeachBar";
import {
  LiveVoiceBar,
  QuickAgentDrawer,
} from "./features/settings/LiveVoiceAndQuickDrawer";
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

function getAgentAvatar(ag?: AgenteRegistro | null): { shape: AvatarShape; color: string } {
  if (!ag) return { shape: "blob", color: "#38bdf8" };
  const cfg = (ag.config ?? {}) as Record<string, unknown>;
  const fb = getDefaultMascotForAgent(ag.agente_id);
  return {
    shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape,
    color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color,
  };
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
  const [onboarding, setOnboarding] = useState<OnboardingEstado | null>(null);
  const [activeSection, setActiveSection] = useState<StudioNavSection>("agentes");
  const [centerMode, setCenterMode] = useState<AgentCenterMode>({
    type: "agent",
    agenteId: "estrategista",
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

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
    subView?: "routines";
    rotinaId?: string | null;
    nonce: number;
  } | null>(null);
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
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayoutSnapshot | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatusReport | null>(null);
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
  const [servers, setServers] = useState<StudioServerRecord[]>([]);
  const [activeServerId, setActiveServerIdState] = useState<string>(() => getActiveServerId());
  const [serverQuota, setServerQuota] = useState<ServerQuotaSummary | null>(null);
  const [newLocalModalOpen, setNewLocalModalOpen] = useState(false);
  const [newRemoteModalOpen, setNewRemoteModalOpen] = useState(false);
  const [joinServerModalOpen, setJoinServerModalOpen] = useState(false);
  const [serverSettingsTarget, setServerSettingsTarget] = useState<StudioServerRecord | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusSnapshot | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsModalTabId>("geral");
  const wsRef = useRef<WebSocketClient | null>(null);
  const restoredLastTabRef = useRef(false);

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
      ] = await Promise.all([
        daemonApi.getOnboarding(),
        daemonApi.listAgents(),
        daemonApi.listChannels(),
        daemonApi.listTasks(),
        daemonApi.getWhatsAppStatus(),
        daemonApi.listProvidersStatus(false),
        daemonApi.getProvidersUsage(false),
        daemonApi.getUsageAnalytics({ dias: 30, agente_id: null }),
        daemonApi.listSkills(),
        daemonApi.listUpgrades(),
        daemonApi.listConnectors(),
        daemonApi.listWorkflows(),
        daemonApi.listFiles(),
        daemonApi.getVaultStatus(),
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
      ]);

      if (remoteUpdateStatus) {
        setUpdateStatus(remoteUpdateStatus);
      }

      if (remoteServersSnap) {
        setServers(remoteServersSnap.servers);
        setServerQuota(remoteServersSnap.quota);
        const resolvedServerId = remoteServersSnap.active_server_id || "primary";
        if (resolvedServerId !== getActiveServerId()) {
          setActiveServerId(resolvedServerId);
          setActiveServerIdState(resolvedServerId);
        }
      }

      setOnboarding(onb);
      setAgentes(agList);
      setCanais(chList);
      setTarefas(tList);
      setWhatsappStatus(wa.status);
      setWhatsappQr(wa.qrcode_base64);
      setProvedores(provList);
      setUso(usageSnap);
      setAnalyticsUso(analyticsData);
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
      }
      if (remoteSidebarLayout) setSidebarLayout(remoteSidebarLayout);
      setBrowserProfiles(remoteBrowserProfiles);
      setBrowserProxies(remoteBrowserProxies);
      if (remoteBrowserStatus) setBrowserStatus(remoteBrowserStatus);
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
        const shouldRestore =
          (remoteUserSettings ?? readCachedUserSettings()).comportamento.restaurar_ultima_aba;
        if (shouldRestore) {
          const savedTabId = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
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
    const unsubConn = ws.onConnectionChange(setWsConnected);

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
      void daemonApi.listProvidersStatus(false).then(setProvedores);
    });
    const unsubAuthUrl = ws.on("provider:auth_url", (evt) => {
      setPendingAuthLink(evt);
      try {
        if (typeof window !== "undefined") {
          window.open(evt.url, "_blank", "noopener,noreferrer");
        }
      } catch {
        // fallback visível pelo botão clicável direto na interface
      }
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
      setActiveTakeoverModal((prev) =>
        prev && prev.tabId === evt.tabId
          ? { ...prev, url: evt.url, title: evt.title, previewDataUrl: evt.dataUrl }
          : prev
      );
    });

    const unsubTakeoverReq = ws.on("browser:takeover_requested", (evt) => {
      const agKey = evt.agenteId ?? "global";
      setTakeoverByAgent((prev) => ({ ...prev, [agKey]: evt }));
    });

    const unsubTakeoverRes = ws.on("browser:takeover_resolved", (evt) => {
      setTakeoverByAgent((prev) => {
        const next: Record<string, BrowserTakeoverSession> = {};
        for (const [k, s] of Object.entries(prev)) {
          if (s.tabId !== evt.tabId) next[k] = s;
        }
        return next;
      });
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

    if (win?.criativoDesktop?.isPackagedDesktop && win.criativoDesktop.triggerUpdateInstall) {
      await win.criativoDesktop.triggerUpdateInstall();
      const refreshed = await daemonApi.obterStatusAtualizacao().catch(() => null);
      if (refreshed) setUpdateStatus(refreshed);
      return;
    }

    const next = await daemonApi.aplicarAtualizacao({ restart: true });
    setUpdateStatus(next);
  }, []);

  const handleSwitchServer = useCallback(
    async (serverId: string) => {
      try {
        const res = await daemonApi.selecionarServidor(serverId);
        setServers(res.servers);
        setActiveServerIdState(res.active_server_id);
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
        await hydrateAll();
      } catch {
        // toast/error silencioso; status permanece no servidor atual
      }
    },
    [hydrateAll]
  );

  const handleConfigureServerWithAgent = useCallback(
    async (promptText: string, _claim: ServerClaimTicket | null) => {
      setNewRemoteModalOpen(false);
      setActiveSection("agentes");
      const targetAgent = agentes.find((a) => a.agente_id === "estrategista") ?? agentes[0];
      const targetAgentId = targetAgent?.agente_id ?? "estrategista";
      const vis = getAgentAvatar(targetAgent);
      setOpenTabs((prev) =>
        prev.some((t) => t.id === `agent:${targetAgentId}`)
          ? prev
          : [
              ...prev,
              {
                id: `agent:${targetAgentId}`,
                titulo: targetAgent?.nome ?? "Estrategista",
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

  const ensureAndActivateTab = useCallback((tab: StudioTabItem, mode: AgentCenterMode) => {
    setOpenTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
    setCenterMode(mode);
    setActiveSection("agentes");
  }, []);

  const handleSelectAgent = (agenteId: string) => {
    setActiveSideThreadId(null);
    setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: null }));
    const ag = agentes.find((a) => a.agente_id === agenteId);
    const vis = getAgentAvatar(ag);
    ensureAndActivateTab(
      { id: `agent:${agenteId}`, titulo: ag?.nome ?? agenteId, shape: vis.shape, color: vis.color },
      { type: "agent", agenteId }
    );
  };

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

  const handleOpenNewAgentTab = () => {
    ensureAndActivateTab(
      { id: "new-agent", titulo: "Novo agente", shape: "rounded_square", color: "#38bdf8" },
      { type: "new_agent" }
    );
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setActiveSection("agentes");
    if (tabId === "new-agent") {
      setCenterMode({ type: "new_agent" });
    } else if (tabId.startsWith("channel:")) {
      setCenterMode({ type: "channel", canalId: tabId.slice("channel:".length) });
    } else if (tabId.startsWith("thread:")) {
      const rest = tabId.slice("thread:".length);
      const sep = rest.indexOf(":");
      if (sep > 0) {
        const agenteId = rest.slice(0, sep);
        const threadId = rest.slice(sep + 1);
        setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: threadId }));
        setCenterMode({ type: "thread", agenteId, threadId });
      }
    } else if (tabId.startsWith("agent:")) {
      const agenteId = tabId.slice("agent:".length);
      setActiveThreadIdByAgent((prev) => ({ ...prev, [agenteId]: null }));
      setCenterMode({ type: "agent", agenteId });
    }
  };

  const handleCloseTab = (tabId: string) => {
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
    if (openTabs.length <= 1) return;
    const idx = openTabs.findIndex((t) => t.id === activeTabId);
    const nextIdx = (idx + delta + openTabs.length) % openTabs.length;
    handleSelectTab(openTabs[nextIdx].id);
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

  const handleUploadFile = async (file: File): Promise<AnexoChat> => {
    const uploaded = await daemonApi.uploadFile(file, activeAgent?.agente_id ?? null);
    const [refreshedFiles, refreshedFolders] = await Promise.all([
      daemonApi.listFiles(),
      daemonApi.listLibraryFolders().catch(() => null),
    ]);
    setArquivos(refreshedFiles);
    if (refreshedFolders) setFoldersSnapshot(refreshedFolders);
    return uploaded;
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
        const res = await daemonApi.connectProviderViaBrowser(prov, label);
        if (res.ok && res.provedores) {
          setProvedores(res.provedores);
          if (res.uso) setUso(res.uso);
        }
        return { ok: Boolean(res.ok), canceled: Boolean(res.canceled), erro: res.erro };
      } finally {
        setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
      }
    },
    []
  );

  const handleCancelBrowserSignIn = useCallback(
    async (prov: "gemini" | "claude" | "openai") => {
      await daemonApi.cancelProviderBrowserSignIn(prov);
      setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
    },
    []
  );

  if (bootLoading) {
    return (
      <div className="min-h-screen w-full bg-[#141414] flex items-center justify-center text-[#979797] text-[13px]">
        Iniciando Criativo AI Studio...
      </div>
    );
  }

  // Gatekeeper de Licença Comercial (Fase 16)
  if (licenseStatus && !licenseStatus.valid) {
    return (
      <LicenseActivationGate
        status={licenseStatus}
        onActivate={async (payload) => {
          const next = await daemonApi.ativarLicenca(payload);
          setLicenseStatus(next);
          if (next.valid) {
            await hydrateAll();
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
          setLicenseStatus(next);
          if (next.valid) {
            await hydrateAll();
          }
        }}
      />
    );
  }

  // Etapa de Onboarding fiel às Screenshots 1 & 2 quando ainda não concluído
  if (onboarding && !onboarding.onboarding_concluido) {
    return (
      <OnboardingFlow
        initialState={onboarding}
        provedores={provedores}
        onConnectProvider={async (prov, key) => {
          await daemonApi.connectProvider(prov, key);
          setProvedores(await daemonApi.listProvidersStatus(false));
        }}
        onConnectProviderViaBrowser={handleConnectViaBrowser}
        onCancelProviderBrowserSignIn={handleCancelBrowserSignIn}
        pendingAuthUrl={pendingAuthLink}
        onComplete={async (patch) => {
          const updated = await daemonApi.updateOnboarding(patch);
          if (patch.marca_nome || patch.perfil_handle) {
            await daemonApi.saveBrandIdentity({
              marca_nome: patch.marca_nome,
              perfil_handle: patch.perfil_handle,
            });
          }
          setOnboarding(updated);
          setProvedores(await daemonApi.listProvidersStatus(false));
          setUso(await daemonApi.getProvidersUsage());
        }}
      />
    );
  }

  return (
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
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenHelp={() => setHelpModalOpen(true)}
        servers={servers}
        activeServerId={activeServerId}
        serverQuota={serverQuota}
        onSelectServer={(sid) => void handleSwitchServer(sid)}
        onOpenNewLocalServer={() => setNewLocalModalOpen(true)}
        onOpenNewRemoteServer={() => setNewRemoteModalOpen(true)}
        onOpenJoinServer={() => setJoinServerModalOpen(true)}
        onOpenServerSettings={(srv) => setServerSettingsTarget(srv)}
        onOpenDisplaySettings={() => setSettingsModalOpen(true)}
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
            tabs={openTabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTab={handleOpenNewAgentTab}
            sidebarCollapsed={!sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((s) => !s)}
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
              onClick={() => setSettingsModalOpen(true)}
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
                <Sidebar
                  agentes={agentes}
                  canais={canais}
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
                  updateStatus={updateStatus}
                  onApplyUpdate={() => void handleApplyUpdate()}
                  onOpenUpdateSettings={() => {
                    setSettingsInitialTab("atualizacoes");
                    setSettingsModalOpen(true);
                  }}
                />
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
                    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
                        onCreateQuickThread={() => setActiveSection("tarefas")}
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
                        liveVoiceEnabled={userSettings.voz.live_voice_habilitada}
                        liveVoiceActive={liveVoiceActive}
                        onOpenTakeover={(tabId) => {
                          const existing =
                            (activeAgent && takeoverByAgent[activeAgent.agente_id]) ||
                            Object.values(takeoverByAgent).find((s) => s.tabId === tabId);
                          setActiveTakeoverModal(
                            existing ?? {
                              takeoverId: `tk_${tabId}`,
                              tabId,
                              agenteId: activeAgent?.agente_id ?? null,
                              reason: "manual",
                              url: activeTakeoverFrame?.url ?? "about:blank",
                              title: activeTakeoverFrame?.title ?? "Navegador Assistido",
                              status: "active",
                              previewDataUrl: activeTakeoverFrame?.dataUrl ?? null,
                              criadoEm: new Date().toISOString(),
                            }
                          );
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

                  <div className="hidden xl:flex">
                    <RightInspectorPanel
                      open={inspectorOpen}
                      agente={activeAgent}
                      arquivos={arquivos}
                      canais={canais}
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
                          browserStatus?.tabs.find((t) => t.agenteId === agenteId)?.tabId ?? null;
                        if (!tabId) {
                          const openRes = (await daemonApi.runBrowserSessionAction({
                            action: "open",
                            agenteId,
                            url: "about:blank",
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
                        const tkRes = await daemonApi.startBrowserTakeover(tabId, {
                          agenteId,
                          reason: "manual",
                        });
                        setActiveTakeoverModal(tkRes.session);
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
                  </div>
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
                  handleSelectAgent(ownerId);
                } else {
                  handleSelectChannel(ownerId);
                }
                setInspectorOpen(true);
                setRoutineInspectorSignal({
                  subView: "routines",
                  rotinaId,
                  nonce: Date.now(),
                });
              }}
              onOpenAgentChat={(agenteId) => {
                setSidebarViewMode("agents");
                handleSelectAgent(agenteId);
              }}
              onCreateFirstRoutine={(defaultAgentId) => {
                setSidebarViewMode("agents");
                handleSelectAgent(defaultAgentId);
                setInspectorOpen(true);
                setRoutineInspectorSignal({
                  subView: "routines",
                  rotinaId: "__new__",
                  nonce: Date.now(),
                });
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

      {/* Modal Criar Canal em Equipe */}
      {channelModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Novo canal em equipe"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateChannelSubmit}
            className="w-full max-w-md rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white flex items-center gap-2">
                <Users className="h-4 w-4 text-[#31CF76]" />
                <span>Criar Canal em Equipe</span>
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
                Nome do Canal
              </label>
              <input
                id="new-channel-name"
                name="new_channel_name"
                aria-label="Nome do canal em equipe"
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
                aria-label="Objetivo do canal"
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
                className="openbot-btn-secondary px-4 py-1.5 text-[12.5px]"
              >
                Cancelar
              </button>
              <button type="submit" className="openbot-btn-primary px-5 py-1.5 text-[12.5px]">
                Criar Canal
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
              <li>Use o trilho esquerdo para alternar entre <strong>Agentes</strong>, <strong>Fluxos Dot-Grid</strong>, <strong>Fila FIFO</strong>, <strong>Uso &amp; Cotas</strong>, <strong>Arquivos ImagePaths</strong> e <strong>Conexões</strong>.</li>
              <li>Nos chats, anexe fotos reais ou logos pelo botão <strong>+</strong>; designers usam modelos generativos de imagem nativamente e o Remotion gera Reels 9:16 MP4.</li>
              <li>Toda publicação Instagram passa por <strong>Aprovação Humana obrigatória</strong> no Cockpit ou via resposta &ldquo;1&rdquo; no WhatsApp pareado.</li>
            </ul>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="openbot-btn-primary px-4 py-1.5 text-[12.5px]"
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

      <QuickAgentDrawer
        enabled={userSettings.comportamento.habilitar_drawer_rapido}
        agentes={agentes}
        pinnedIds={sidebarLayout?.pins ?? []}
        selectedAgentId={activeAgent?.agente_id ?? null}
        onSelectAgent={handleSelectAgent}
      />

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

      <SettingsModal
        open={settingsModalOpen}
        initialTab={settingsInitialTab}
        settings={userSettings}
        storageUsage={storageUsage}
        whatsNew={whatsNew}
        browserProfiles={browserProfiles}
        browserProxies={browserProxies}
        browserStatus={browserStatus}
        agentes={agentes}
        canais={canais}
        onClose={() => setSettingsModalOpen(false)}
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

      <NewLocalServerModal
        open={newLocalModalOpen}
        quota={serverQuota}
        onClose={() => setNewLocalModalOpen(false)}
        onOpenLicenseSettings={() => setSettingsModalOpen(true)}
        onCreated={async (srv, nextList) => {
          setServers(nextList);
          await handleSwitchServer(srv.server_id);
        }}
      />

      <NewRemoteServerClaimModal
        open={newRemoteModalOpen}
        quota={serverQuota}
        onClose={() => setNewRemoteModalOpen(false)}
        onOpenLicenseSettings={() => setSettingsModalOpen(true)}
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
  );
}
