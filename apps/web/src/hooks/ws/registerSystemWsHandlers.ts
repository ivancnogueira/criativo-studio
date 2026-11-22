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
import { Sidebar } from "../../components/Sidebar";
import {
  DEFAULT_FRONTEND_USER_SETTINGS,
  SettingsModal,
  type SettingsModalTabId,
  applyUserSettingsToDocument,
} from "../../features/settings/SettingsModal";
import { applyExternalThemePalette } from "../../theme/theme-palette";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { mergeUniqueMessages, type AgenteEnriquecido } from "../../utils/studio-storage";
import type { StudioAppState } from "../useStudioState";
import type { StudioBootstrapActions } from "../useStudioBootstrap";

export function registerSystemWsHandlers(
  ws: WebSocketClient,
  state: StudioAppState,
  boot: StudioBootstrapActions
): () => void {
  const {
    onboarding,
    setOnboarding,
    setAgentes,
    setCanais,
    setArquivos,
    setHabilidades,
    steps,
    setChatByKey,
    activeTabId,
    setDeletedNativeAgents,
    setThreadChatById,
    setSharedTablesRefreshNonce,
    setFoldersSnapshot,
    setUserSettings,
    setSidebarLayout,
    setBrowserStatus,
    setBrowserTabs,
    setBrowserFramesByTab,
    setActiveBrowserTabId,
    setBrowserPanelMode,
    setTakeoverByAgent,
    setCaptureByAgent,
    setActiveTakeoverModal,
    setPendingAutofillRequest,
    setActiveTakeoverFrame,
    setTeachStatusByTab,
    setShowcaseSites,
    setLicenseStatus,
    servers,
    setServers,
    setServerQuota,
    setUpdateStatus,
  } = state;
  const { hydrateAll, refreshAgentThreadsState } = boot;

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

    const unsubAutofillRequested = ws.on("browser:autofill_requested", (evt) => {
      setPendingAutofillRequest(evt);
    });

    const unsubSidebarUpdated = ws.on("sidebar:updated", () => {
      void daemonApi.getSidebarLayout().then(setSidebarLayout).catch(() => {});
      void daemonApi.listAgents().then(setAgentes).catch(() => {});
      void daemonApi.listChannels().then(setCanais).catch(() => {});
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

    const unsubCuaStatus = ws.on("cua:status", (nextCua) => {
      state.setCuaStatus(nextCua);
    });

    const unsubThemeReloaded = ws.on("theme:reloaded", (evt) => {
      const selectedId = state.userSettings.aparencia.tema_externo_id;
      if (!selectedId) return;
      const found = evt.themes.find((item) => item.id === selectedId);
      if (found) applyExternalThemePalette(found);
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
    unsubAutofillRequested();
    unsubSidebarUpdated();
    unsubSettingsUpdated();
    unsubShowcaseUpdated();
    unsubLicenseUpdated();
    unsubServersUpdated();
    unsubUpdateStatus();
    unsubOnboardingUpdated();
    unsubVpsAssistantUpdated();
    unsubCuaStatus();
    unsubThemeReloaded();
  };
}
