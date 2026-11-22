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
import { Sidebar } from "../../components/Sidebar";
import { SplitResizeHandle } from "../../components/ui/SplitResizeHandle";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";

export function StudioAgentSidebarPane({ ctx }: { ctx: StudioUiCtx }) {
  const { state, serverActions, nav, derived, threadActions } = ctx;
  const {
    onboarding,
    setOnboarding,
    centerMode,
    sidebarOpen,
    setSidebarOpen,
    setInspectorOpen,
    sidebarWidth,
    setSidebarWidth,
    agentes,
    setAgentes,
    canais,
    whatsappStatus,
    setWhatsappModalOpen,
    setChannelModalOpen,
    sidebarViewMode,
    setSidebarViewMode,
    routineCountsByAgent,
    setRoutineInspectorSignal,
    deletedNativeAgents,
    userSettings,
    sidebarLayout,
    setSidebarLayout,
    updateStatus,
    openSettings,
  } = state;

  const { handleApplyUpdate, persistLayoutWidths } = serverActions;
  const {
    handleSelectAgent,
    handleDeleteAgent,
    handleRestoreDeletedAgent,
    handleRestoreAllDeletedAgents,
    handleToggleUnreadAgent,
    handleToggleMuteAgent,
    handleOpenAgentNewWindow,
    handleNewSubconversationForAgent,
    handleSelectChannel,
    handleOpenNewAgentTab,
  } = nav;
  const { activeAgent, activeChannel, workingAgentIds, agentActivityByAgentId } = derived;

  const { handleDeleteChannel } = threadActions;

  if (!sidebarOpen) return null;

  return (
    <>
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
                  onEditChannel={(canalId) => {
                    handleSelectChannel(canalId);
                    setInspectorOpen(true);
                    setRoutineInspectorSignal({ subView: "channel_config", nonce: Date.now() });
                  }}
                  onDeleteChannel={handleDeleteChannel}
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
    </>
  );
}
