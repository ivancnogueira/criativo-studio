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
import { NewAgentScreen, type NewAgentPayload } from "../../features/agents/NewAgentScreen";
import {
  AgentConversationView,
  type ChatLiveRunState,
  type McpSignInCardState,
} from "../../features/chat/AgentConversationView";
import { RoutineFlowsCanvas } from "../../features/routines/RoutineFlowsCanvas";
import {
  LiveVoiceBar,
  QuickAgentDrawer,
} from "../../features/settings/LiveVoiceAndQuickDrawer";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";

export function StudioAgentCenterPane({ ctx }: { ctx: StudioUiCtx }) {
  const { state, boot, nav, derived, chatSend, threadActions } = ctx;
  const {
    setActiveSection,
    centerMode,
    inspectorOpen,
    setInspectorOpen,
    agentes,
    setAgentes,
    setCanais,
    arquivos,
    provedores,
    pendingMcpSignIn,
    setPendingMcpSignIn,
    setLojaInitialAppSlug,
    prefilledChatPrompt,
    setPrefilledChatPrompt,
    setChatByKey,
    sendingChat,
    sidebarViewMode,
    setSidebarViewMode,
    flowRefreshNonce,
    setRoutineInspectorSignal,
    activeSideThreadId,
    setActiveSideThreadId,
    threadsByAgent,
    waitsByAgent,
    pinsByAgent,
    highlightedMessageId,
    setSharedTablesOpen,
    setPreviewFile,
    setLightboxImage,
    userSettings,
    setActiveBrowserTabId,
    setBrowserPanelMode,
    takeoverByAgent,
    setTakeoverByAgent,
    secretRequestByAgent,
    setSecretRequestByAgent,
    captureByAgent,
    setCaptureByAgent,
    usageLimitAskByAgent,
    setUsageLimitAskByAgent,
    liveVoiceActive,
    setLiveVoiceActive,
  } = state;
  const { refreshAgentThreadsState } = boot;

  const { handleSelectAgent, handleSelectThreadInAgent, handleDismissThreadTab, handleCreateNewTopic } = nav;
  const {
    activeAgent,
    activeChannel,
    activeThread,
    activeMessages,
    activeLiveRun,
    activePaginationState,
    activeQueueSnapshot,
    activeEditingEntry,
  } = derived;
  const {
    handleUploadFile,
    handleSubmitUiBlock,
    handleSaveSkillSuggestion,
    handleDismissSkillSuggestion,
    handleSendChatMessage,
  } = chatSend;
  const {
    handleLoadOlderMessages,
    handleJumpToLatest,
    handleJumpToMessage,
    handleNavigateBranchOrigin,
    handleBranchFromMessage,
    handleTogglePinMessage,
    handleAskSideQuestion,
    handleStartNewChat,
    handleCloseWait,
    handleBeginEditQueueItem,
    handleSaveEditQueueItem,
    handleDiscardEditQueueItem,
    handleCancelOrDeleteQueueItem,
    handleReorderQueue,
    handleSteerQueueItem,
    handleMoveQueueItemToTask,
    handleInterruptTurn,
    handleCreateCustomAgent,
  } = threadActions;

  if (centerMode.type === "new_agent") {
    return (
      <NewAgentScreen
        provedores={provedores}
        onCreateAgent={handleCreateCustomAgent}
        onOpenConnectors={() => setActiveSection("conexoes")}
      />
    );
  }

  return (
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
                        onOpenChannelSettings={() => {
                          setInspectorOpen(true);
                          setRoutineInspectorSignal({
                            subView: "channel_config",
                            nonce: Date.now(),
                          });
                        }}
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
    </>
  );
}
