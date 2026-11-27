import { useState } from "react";
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
  GranularidadeAnalyticsUso,
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
  FilePreviewPanel,
  ImageLightbox,
  type PreviewableFileItem,
} from "../../features/chat/FilePreviewPanel";
import { MarketplacePage } from "../../features/marketplace/MarketplacePage";
import { ConnectorsPage } from "../../features/pages/ConnectorsPage";
import { FilesVaultPage } from "../../features/pages/FilesVaultPage";
import { TasksQueuePage } from "../../features/pages/TasksQueuePage";
import { UsageMetricsPage } from "../../features/pages/UsageMetricsPage";
import { SchedulePage } from "../../features/schedule/SchedulePage";
import { PublishedGalleryMetricsPage } from "../../features/social-studio/PublishedGalleryMetricsPage";
import { CrmPage } from "../../features/crm/CrmPage";
import {
  DEFAULT_FRONTEND_USER_SETTINGS,
  SettingsModal,
  type SettingsModalTabId,
  applyUserSettingsToDocument,
} from "../../features/settings/SettingsModal";
import { WorkflowsCanvasPage } from "../../features/workflows/WorkflowsCanvasPage";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";
import { StudioRoutinesWorkspace } from "./StudioRoutinesWorkspace";

export function StudioSecondaryPagesSwitch({ ctx }: { ctx: StudioUiCtx }) {
  const { state, boot, serverActions, nav, chatSend, threadActions } = ctx;
  const [usoLoading, setUsoLoading] = useState(false);
  const [usoGranularidade, setUsoGranularidade] = useState<"auto" | GranularidadeAnalyticsUso>("auto");
  const {
    onboarding,
    setOnboarding,
    activeSection,
    setActiveSection,
    setInspectorOpen,
    agentes,
    setAgentes,
    canais,
    tarefas,
    setTarefas,
    workflows,
    setWorkflows,
    workflowEventSignal,
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
    thoughtStream,
    whatsappStatus,
    setWhatsappModalOpen,
    lojaInitialAppSlug,
    setLojaInitialAppSlug,
    setPrefilledChatPrompt,
    pendingAuthLink,
    setSidebarViewMode,
    routinesRefreshNonce,
    setRoutineInspectorSignal,
    deletedNativeAgents,
    allThreads,
    setAllThreads,
    previewFile,
    setPreviewFile,
    setLightboxImage,
    foldersSnapshot,
    userSettings,
    setUserSettings,
    setRoutinesAgentId,
    setRoutinesSelectedRoutineId,
    setRoutinesRightOpen,
    sidebarLayout,
    browserStatus,
    browserProfiles,
    setBrowserProfiles,
    browserProxies,
    setBrowserProxies,
    storageUsage,
    setStorageUsage,
    whatsNew,
    setWhatsNew,
    showcaseSites,
    setShowcaseSites,
    licenseStatus,
    setLicenseStatus,
    servers,
    activeServerId,
    updateStatus,
    setUpdateStatus,
    settingsInitialTab,
    closeSettings,
  } = state;
  const { refreshLibraryFolders, refreshAgentThreadsState, hydrateAll } = boot;
  const { handleApplyUpdate, handleResetLayoutWidths } = serverActions;
  const {
    handleSelectAgent,
    handleRestoreDeletedAgent,
    handleRestoreAllDeletedAgents,
    handleOpenThreadInChat,
    handleSelectChannel,
  } = nav;

  const { handleUploadFile, handleDeleteFile } = chatSend;
  const { handleConnectViaBrowser, handleCancelBrowserSignIn } = threadActions;

  return (
    <>
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
                const uploaded = await daemonApi.uploadFileCategorized(file);
                setArquivos(await daemonApi.listFiles());
                return uploaded.arquivo;
              }}
              onRefreshWorkflows={async () => {
                setWorkflows(await daemonApi.listWorkflows());
              }}
            />
          )}

          {activeSection === "crm" && <CrmPage />}

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
              onOpenAgentChat={(agenteId: string, prefillPrompt?: string) => {
                setActiveSection("agentes");
                setSidebarViewMode("agents");
                handleSelectAgent(agenteId);
                if (prefillPrompt) {
                  setPrefilledChatPrompt(prefillPrompt);
                }
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

          {activeSection === "galeria_ig" && (
            <PublishedGalleryMetricsPage
              onOpenInstagramConfig={() => {
                setLojaInitialAppSlug("instagram");
                setActiveSection("loja");
              }}
              onAnalyzeWithAgent={(prompt) => {
                const analystId =
                  agentes.find((a) => a.agente_id === "estrategista")?.agente_id ??
                  agentes[0]?.agente_id ??
                  "estrategista";
                setActiveSection("agentes");
                setSidebarViewMode("agents");
                handleSelectAgent(analystId);
                setPrefilledChatPrompt(prompt);
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
              granularidade={usoGranularidade}
              loading={usoLoading}
              onChangeFilters={async (dias, agId, gran) => {
                const nextGran = gran ?? usoGranularidade;
                setUsoPeriodoDias(dias);
                setUsoAgenteFiltro(agId);
                setUsoGranularidade(nextGran);
                setUsoLoading(true);
                try {
                  setAnalyticsUso(
                    await daemonApi.getUsageAnalytics({
                      dias,
                      agente_id: agId,
                      granularidade: nextGran,
                    }),
                  );
                } finally {
                  setUsoLoading(false);
                }
              }}
              onRefresh={async () => {
                setUsoLoading(true);
                try {
                  const [provList, usageSnap, analyticsData] = await Promise.all([
                    daemonApi.listProvidersStatus(true),
                    daemonApi.getProvidersUsage(true),
                    daemonApi.getUsageAnalytics({
                      dias: usoPeriodoDias,
                      agente_id: usoAgenteFiltro,
                      granularidade: usoGranularidade,
                    }),
                  ]);
                  setProvedores(provList);
                  setUso(usageSnap);
                  setAnalyticsUso(analyticsData);
                } finally {
                  setUsoLoading(false);
                }
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
              onTogglePool={async (prov, habilitado, estrategia) => {
                const nextProvs = await daemonApi.setProviderPool(prov, {
                  habilitado,
                  ...(estrategia ? { estrategia } : {}),
                });
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

      <StudioRoutinesWorkspace ctx={ctx} />

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

          {previewFile && activeSection !== "agentes" && (
            <FilePreviewPanel
              file={previewFile}
              onClose={() => setPreviewFile(null)}
              onOpenImageLightbox={(url, alt) => setLightboxImage({ url, alt })}
            />
          )}
    </>
  );
}
