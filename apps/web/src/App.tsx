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
import { DynamicIsland, type StudioTabItem } from "./components/DynamicIsland";
import {
  resolveInitialSplashStageFromSearch,
  StudioSplashPreloader,
  type SplashInitialStage,
} from "./components/StudioSplashPreloader";
import { WorkspaceRail, type StudioNavSection } from "./components/WorkspaceRail";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "./services/websocket-client";
import { useStudioState } from "./hooks/useStudioState";
import { useStudioBootstrap } from "./hooks/useStudioBootstrap";
import { useStudioWebSocketSync } from "./hooks/useStudioWebSocketSync";
import { useStudioServerActions } from "./hooks/useStudioServerActions";
import { useStudioTabsAndNavigation } from "./hooks/useStudioTabsAndNavigation";
import { useStudioDerivedData } from "./hooks/useStudioDerivedData";
import { useChatSendActions } from "./hooks/useChatSendActions";
import { useThreadQueueAndChannelActions } from "./hooks/useThreadQueueAndChannelActions";
import type { StudioUiCtx } from "./components/studio/studio-ui-ctx";
import { StudioAuthAndOnboardingGate } from "./components/studio/StudioAuthAndOnboardingGate";
import { StudioAgentSidebarPane } from "./components/studio/StudioAgentSidebarPane";
import { StudioAgentCenterPane } from "./components/studio/StudioAgentCenterPane";
import { StudioAgentInspectorPane } from "./components/studio/StudioAgentInspectorPane";
import { StudioSecondaryPagesSwitch } from "./components/studio/StudioSecondaryPagesSwitch";
import { StudioModalsHost } from "./components/studio/StudioModalsHost";

export function App() {
  const state = useStudioState();
  const boot = useStudioBootstrap(state);
  useStudioWebSocketSync(state, boot);
  const serverActions = useStudioServerActions(state, boot);
  const nav = useStudioTabsAndNavigation(state, boot);
  const derived = useStudioDerivedData(state);
  const chatSend = useChatSendActions(state, boot, derived);
  const threadActions = useThreadQueueAndChannelActions(state, boot, derived, nav);

  const ctx: StudioUiCtx = {
    state,
    boot,
    serverActions,
    nav,
    derived,
    chatSend,
    threadActions,
  };

  const {
    activeSection,
    setActiveSection,
    uso,
    setProvedores,
    setUso,
    whatsappStatus,
    setWhatsappModalOpen,
    openSettings,
    setHelpModalOpen,
    servers,
    activeServerId,
    serverQuota,
    setNewLocalModalOpen,
    setNewRemoteModalOpen,
    setJoinServerModalOpen,
    setServerSettingsTarget,
    userSettings,
    wsConnected,
    sidebarOpen,
    setSidebarOpen,
    focusMode,
    setFocusMode,
    isAppBooting,
    licenseStatus,
    onboarding,
    splashDismissed,
    splashStage,
    setSplashDismissed,
  } = state;

  if (isAppBooting || (licenseStatus && !licenseStatus.valid) || (onboarding && !onboarding.onboarding_concluido)) {
    return <StudioAuthAndOnboardingGate ctx={ctx} />;
  }

  return (
    <>
      <div className="h-screen w-screen overflow-hidden bg-[#0D0D0D] text-white flex">
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
          pendingCount={derived.pendingCount + derived.runningCount}
          onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
          onOpenSettings={() => openSettings()}
          onOpenHelp={() => setHelpModalOpen(true)}
          servers={servers}
          activeServerId={activeServerId}
          serverQuota={serverQuota}
          onSelectServer={(sid) => void serverActions.handleSwitchServer(sid)}
          onOpenNewLocalServer={() => setNewLocalModalOpen(true)}
          onOpenNewRemoteServer={() => setNewRemoteModalOpen(true)}
          onOpenJoinServer={() => setJoinServerModalOpen(true)}
          onOpenServerSettings={(srv) => setServerSettingsTarget(srv)}
          onOpenDisplaySettings={() => openSettings("aparencia")}
        />

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {userSettings.comportamento.exibir_dynamic_island !== false ? (
            <DynamicIsland
              wsConnected={wsConnected}
              runningCount={derived.runningCount}
              pendingCount={derived.pendingCount}
              awaitingApprovalCount={derived.awaitingApprovalCount}
              whatsappStatus={whatsappStatus}
              onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
              onOpenVaultModal={() => setActiveSection("conexoes")}
              tabs={derived.dynamicIslandTabs}
              activeTabId={derived.headerActiveTabId}
              onSelectTab={nav.handleSelectTab}
              onCloseTab={nav.handleCloseTab}
              onNewTopic={() => void nav.handleCreateNewTopic()}
              onNewTab={() => void nav.handleCreateNewTopic()}
              sidebarCollapsed={!sidebarOpen}
              onToggleSidebar={() => {
                setSidebarOpen((s) => {
                  const next = !s;
                  serverActions.persistLayoutWidths({ sidebar_open: next, focus_mode: false });
                  if (next) setFocusMode(false);
                  return next;
                });
              }}
              focusMode={focusMode}
              onToggleFocusMode={serverActions.handleToggleFocusMode}
              onNavigateBack={() => nav.stepHistoryTab(-1)}
              onNavigateForward={() => nav.stepHistoryTab(1)}
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

          <main className="flex-1 min-h-0 flex overflow-hidden">
            {activeSection === "agentes" && (
              <>
                <StudioAgentSidebarPane ctx={ctx} />
                <StudioAgentCenterPane ctx={ctx} />
                <StudioAgentInspectorPane ctx={ctx} />
              </>
            )}

            <StudioSecondaryPagesSwitch ctx={ctx} />
          </main>
        </div>

        <StudioModalsHost ctx={ctx} />
      </div>
      {!splashDismissed && (
        <StudioSplashPreloader
          loading={isAppBooting}
          initialStage={splashStage}
          onRevealComplete={() => setSplashDismissed(true)}
        />
      )}
    </>
  );
}
