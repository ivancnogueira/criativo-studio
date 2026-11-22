import {
  resolveInitialSplashStageFromSearch,
  StudioSplashPreloader,
  type SplashInitialStage,
} from "../../components/StudioSplashPreloader";
import { OnboardingFlow } from "../../features/onboarding/OnboardingFlow";
import { LicenseActivationGate } from "../../features/license/LicenseActivationGate";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, getAgentAvatar, getThreadLaneKey, INSPECTOR_WIDTH_KEY, mergeUniqueMessages, SIDEBAR_WIDTH_KEY, writeStoredWidth } from "../../utils/studio-storage";
import type { StudioUiCtx } from "./studio-ui-ctx";

export function StudioAuthAndOnboardingGate({ ctx }: { ctx: StudioUiCtx }) {
  const { state, boot, serverActions, threadActions } = ctx;
  const {
    setBootLoading,
    splashStage,
    splashDismissed,
    setSplashDismissed,
    onboarding,
    setOnboarding,
    agentes,
    setAgentes,
    canais,
    setArquivos,
    provedores,
    setProvedores,
    setUso,
    pendingAuthLink,
    licenseStatus,
    setLicenseStatus,
    servers,
    activeServerId,
    isAppBooting,
  } = state;
  const { hydrateAll } = boot;
  const { handleSwitchServer } = serverActions;

  const { handleConnectViaBrowser, handleCancelBrowserSignIn } = threadActions;

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

  return null;
}
