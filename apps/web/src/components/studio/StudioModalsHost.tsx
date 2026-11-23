import { BrowserTakeoverModal } from "../../features/browser/BrowserTakeoverModal";
import { BrowserAutofillConsentModal } from "../../features/browser/BrowserAutofillConsentModal";
import { UserBrowsingLogInspector } from "../../features/browser/BrowserTeachBar";
import {
  JoinServerModal,
  NewLocalServerModal,
  NewRemoteServerClaimModal,
  ServerSettingsModal,
} from "../../features/servers/ServerModals";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";
import { StudioQuickModals } from "./StudioQuickModals";

export function StudioModalsHost({ ctx }: { ctx: StudioUiCtx }) {
  const { state, serverActions, nav } = ctx;
  const {
    agentes,
    steps,
    setPrefilledChatPrompt,
    browserProfiles,
    activeTakeoverModal,
    setActiveTakeoverModal,
    pendingAutofillRequest,
    setPendingAutofillRequest,
    activeTakeoverFrame,
    teachStatusByTab,
    setTeachStatusByTab,
    browsingLogInspector,
    setBrowsingLogInspector,
    setServers,
    serverQuota,
    newLocalModalOpen,
    setNewLocalModalOpen,
    newRemoteModalOpen,
    setNewRemoteModalOpen,
    joinServerModalOpen,
    setJoinServerModalOpen,
    serverSettingsTarget,
    setServerSettingsTarget,
    openSettings,
  } = state;

  const { handleSwitchServer, handleConfigureServerWithAgent } = serverActions;
  const { handleSelectAgent } = nav;

  return (
    <>
      <StudioQuickModals ctx={ctx} />
      {activeTakeoverModal && (
        <BrowserTakeoverModal
          open={Boolean(activeTakeoverModal)}
          tabId={activeTakeoverModal.tabId}
          agentName={
            agentes.find((a) => a.agente_id === activeTakeoverModal.agenteId)?.nome ??
            "Criativo de Pesquisa"
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

      <BrowserAutofillConsentModal
        request={pendingAutofillRequest}
        onResolve={async (payload) => {
          await daemonApi.resolveAutofillConsent(payload);
          setPendingAutofillRequest(null);
        }}
      />
    </>
  );
}
