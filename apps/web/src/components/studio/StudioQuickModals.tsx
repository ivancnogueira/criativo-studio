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
import {
  FilePreviewPanel,
  ImageLightbox,
  type PreviewableFileItem,
} from "../../features/chat/FilePreviewPanel";
import { SharedTablesModal } from "../../features/chat/SharedTablesModal";
import { WhatsAppPairingModal } from "../../features/whatsapp/WhatsAppPairingModal";
import {
  InAppBrowserPanel,
  type BrowserLiveFrame,
  type BrowserMouseKeyboardInput,
} from "../../features/browser/InAppBrowserPanel";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";
import {
  LiveVoiceBar,
  QuickAgentDrawer,
} from "../../features/settings/LiveVoiceAndQuickDrawer";
import {
  DEFAULT_FRONTEND_DOCK_SETTINGS,
  resolveEffectiveDockAgentIds,
} from "../../features/settings/SettingsGeneralTabs";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";

export function StudioQuickModals({ ctx }: { ctx: StudioUiCtx }) {
  const { state, nav, derived, chatSend, threadActions } = ctx;
  const {
    agentes,
    steps,
    whatsappStatus,
    setWhatsappStatus,
    whatsappQr,
    setWhatsappQr,
    whatsappAccounts,
    setWhatsappAccounts,
    whatsappModalOpen,
    setWhatsappModalOpen,
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
    activeTabId,
    setSidebarViewMode,
    routineNotifications,
    setRoutineNotifications,
    sharedTablesOpen,
    setSharedTablesOpen,
    sharedTablesRefreshNonce,
    lightboxImage,
    setLightboxImage,
    userSettings,
    setUserSettings,
    agentDockPinned,
    sidebarLayout,
    browserTabs,
    browserFramesByTab,
    activeBrowserTabId,
    setActiveBrowserTabId,
    browserPanelMode,
    setBrowserPanelMode,
    browserProfiles,
    takeoverByAgent,
    activeTakeoverModal,
    teachStatusByTab,
    setTeachStatusByTab,
    setBrowsingLogInspector,
    handleToggleAgentDockPinned,
    openSettings,
  } = state;

  const { handleSelectAgent, handleOpenNewAgentTab } = nav;
  const { activeAgent, workingAgentIds } = derived;
  const { handleSendChatMessage } = chatSend;
  const { handleCreateChannelSubmit } = threadActions;

  return (
    <>
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
                placeholder="Equipe de Lançamento Semanal"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[13px] text-white"
              />
            </div>

            <div>
              <label htmlFor="new-channel-desc" className="block text-[11.5px] text-[#979797] mb-1">
                Título / Objetivo
              </label>
              <input
                id="new-channel-desc"
                name="new_channel_desc"
                aria-label="Objetivo da equipe"
                type="text"
                value={newChannelDesc}
                onChange={(e) => setNewChannelDesc(e.target.value)}
                placeholder="Descreva o que esta equipe faz"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[13px] text-white"
              />
            </div>

            <div>
              <label htmlFor="new-channel-inst" className="block text-[11.5px] text-[#979797] mb-1">
                Instruções (opcional)
              </label>
              <textarea
                id="new-channel-inst"
                name="new_channel_inst"
                aria-label="Instruções da equipe"
                rows={2}
                value={newChannelInst}
                onChange={(e) => setNewChannelInst(e.target.value)}
                placeholder="Em que esta equipe vai trabalhar?"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white resize-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11.5px] text-[#979797]">
                  Membros ({newChannelMembers.length}) · cada Criativo usa seu próprio provedor
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                {agentes
                  .filter(
                    (ag) =>
                      ag.agente_id !== "assistente_setup" &&
                      ag.agente_id !== "assistente_servidor_vps" &&
                      (ag.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
                  )
                  .map((ag) => {
                    const checked = newChannelMembers.includes(ag.agente_id);
                    const isLeader = checked && newChannelLeader === ag.agente_id;
                    return (
                      <div
                        key={ag.agente_id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[#1A1A1A] px-2.5 py-1.5 text-[12px] text-white"
                      >
                        <label
                          htmlFor={`ch-member-${ag.agente_id}`}
                          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                        >
                          <input
                            id={`ch-member-${ag.agente_id}`}
                            name={`member_${ag.agente_id}`}
                            aria-label={`Incluir ${ag.nome}`}
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setNewChannelMembers((prev) => {
                                const next = checked
                                  ? prev.filter((id) => id !== ag.agente_id)
                                  : [...prev, ag.agente_id];
                                if (!next.includes(newChannelLeader)) {
                                  setNewChannelLeader(next[0] ?? "");
                                } else if (!checked && !newChannelLeader) {
                                  setNewChannelLeader(ag.agente_id);
                                }
                                return next;
                              });
                            }}
                            className="accent-[#31CF76]"
                          />
                          <span className="truncate">{ag.nome}</span>
                          <span className="text-[10.5px] text-[#787878] truncate ml-auto">
                            {ag.modelo_padrao}
                          </span>
                        </label>
                        {checked && (
                          <button
                            type="button"
                            title={isLeader ? "Líder da equipe" : "Definir como líder"}
                            aria-label={`Definir ${ag.nome} como líder`}
                            onClick={() => setNewChannelLeader(ag.agente_id)}
                            className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                              isLeader
                                ? "text-[#FDCB6E] bg-[#FDCB6E]/15"
                                : "text-[#6A6A6A] hover:text-white"
                            }`}
                          >
                            <Crown className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
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
          aria-label="Ajuda e arquitetura CriativoOS"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white">
                CriativoOS — Guia Rápido
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
                  Abrir Criativo
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
          agentName={activeAgent?.nome ?? "Criativo"}
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
    </>
  );
}
