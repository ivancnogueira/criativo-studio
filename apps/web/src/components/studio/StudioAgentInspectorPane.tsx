import { SplitResizeHandle } from "../../components/ui/SplitResizeHandle";
import { RightInspectorPanel, type InspectorSubView } from "../../features/inspector/RightInspectorPanel";
import {
  InAppBrowserPanel,
  type BrowserLiveFrame,
  type BrowserMouseKeyboardInput,
} from "../../features/browser/InAppBrowserPanel";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";

export function StudioAgentInspectorPane({ ctx }: { ctx: StudioUiCtx }) {
  const { state, boot, serverActions, nav, derived, chatSend, threadActions } = ctx;
  const {
    centerMode,
    setActiveSection,
    inspectorOpen,
    setInspectorOpen,
    inspectorWidth,
    setInspectorWidth,
    agentes,
    setAgentes,
    canais,
    setCanais,
    setTarefas,
    arquivos,
    provedores,
    uso,
    habilidades,
    steps,
    setWhatsappModalOpen,
    setChatByKey,
    setOpenTabs,
    activeTabId,
    setSidebarViewMode,
    routineCountsByAgent,
    setRoutinesRefreshNonce,
    setFlowRefreshNonce,
    routineInspectorSignal,
    setActiveSideThreadId,
    threadsByAgent,
    allThreads,
    setSharedTablesOpen,
    browserStatus,
    browserTabs,
    browserFramesByTab,
    activeBrowserTabId,
    setActiveBrowserTabId,
    browserPanelMode,
    setBrowserPanelMode,
    browserProfiles,
    setBrowserProfiles,
    browserProxies,
    setBrowserProxies,
    takeoverByAgent,
    teachStatusByTab,
    setBrowsingLogInspector,
  } = state;
  const { refreshRoutineCounts, refreshAgentThreadsState } = boot;
  const { persistLayoutWidths } = serverActions;
  const { handleSelectAgent, handleSelectThreadInAgent, handleSelectChannel, handleCreateNewTopic } = nav;
  const {
    activeAgent,
    activeChannel,
    activeThread,
    workingAgentIds,
    previewTarefa,
  } = derived;
  const { handleDeleteFile, handleSendChatMessage } = chatSend;
  const { handleDeleteChannel } = threadActions;

  if (centerMode.type === "new_agent") {
    return null;
  }

  return (
    <>
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
                      canal={activeChannel}
                      allAgentes={agentes}
                      arquivos={arquivos}
                      canais={canais}
                      channelRoutineCount={activeChannel?.rotinas_count ?? 0}
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
                      onSaveChannelSettings={async (canalId, patch) => {
                        const updated = await daemonApi.updateChannel(canalId, patch);
                        setCanais((prev) =>
                          prev.map((c) => (c.canal_id === updated.canal_id ? updated : c))
                        );
                        setOpenTabs((prev) =>
                          prev.map((t) =>
                            t.id === `channel:${updated.canal_id}`
                              ? { ...t, titulo: updated.nome }
                              : t
                          )
                        );
                      }}
                      onDeleteChannel={handleDeleteChannel}
                      onNewChannelConversation={async (canalId) => {
                        const res = await daemonApi.startNewChannelConversation(canalId);
                        if (res.canal) {
                          setCanais((prev) =>
                            prev.map((c) => (c.canal_id === res.canal!.canal_id ? res.canal! : c))
                          );
                        }
                        if (res.mensagem_divisor) {
                          setChatByKey((prev) => ({
                            ...prev,
                            [canalId]: mergeUniqueMessages(prev[canalId] ?? [], [
                              res.mensagem_divisor,
                            ]),
                          }));
                        }
                      }}
                      onCompactChannelContext={async (canalId) => {
                        const res = await daemonApi.compactChannelContext(canalId);
                        if (res.canal) {
                          setCanais((prev) =>
                            prev.map((c) => (c.canal_id === res.canal!.canal_id ? res.canal! : c))
                          );
                        }
                        if (res.mensagem_divisor) {
                          setChatByKey((prev) => ({
                            ...prev,
                            [canalId]: mergeUniqueMessages(prev[canalId] ?? [], [
                              res.mensagem_divisor,
                            ]),
                          }));
                        }
                      }}
                      onClearChannelHistory={async (canalId) => {
                        await daemonApi.clearChannelHistory(canalId);
                        setChatByKey((prev) => ({ ...prev, [canalId]: [] }));
                        setCanais((prev) =>
                          prev.map((c) =>
                            c.canal_id === canalId
                              ? { ...c, ultima_mensagem: null, nao_lidas: 0 }
                              : c
                          )
                        );
                      }}
                      onLoadChannelMemories={daemonApi.listChannelMemories}
                      onAddChannelMemory={async (canalId, texto) => {
                        const list = await daemonApi.addChannelMemory(canalId, texto);
                        setCanais((prev) =>
                          prev.map((c) =>
                            c.canal_id === canalId ? { ...c, memorias_count: list.length } : c
                          )
                        );
                        return list;
                      }}
                      onDeleteChannelMemory={async (canalId, memId) => {
                        await daemonApi.deleteChannelMemory(canalId, memId);
                        setCanais((prev) =>
                          prev.map((c) =>
                            c.canal_id === canalId
                              ? { ...c, memorias_count: Math.max(0, (c.memorias_count ?? 1) - 1) }
                              : c
                          )
                        );
                      }}
                    />
                  )}
    </>
  );
}
