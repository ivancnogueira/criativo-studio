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
import { getCriativoDesktopBridge } from "../types/desktop-bridge";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import { DEFAULT_INSPECTOR_WIDTH, DEFAULT_SIDEBAR_WIDTH, INSPECTOR_WIDTH_KEY, SIDEBAR_WIDTH_KEY, writeStoredWidth , getAgentAvatar, mergeUniqueMessages } from "../utils/studio-storage";
import type { StudioAppState } from "./useStudioState";
import type { StudioBootstrapActions } from "./useStudioBootstrap";

export function useStudioServerActions(
  state: StudioAppState,
  boot: StudioBootstrapActions
) {
  const {
    setBootLoading,
    setOnboarding,
    setActiveSection,
    setCenterMode,
    setSidebarOpen,
    setInspectorOpen,
    setSidebarWidth,
    setInspectorWidth,
    setFocusMode,
    agentes,
    setAgentes,
    setUso,
    steps,
    setPrefilledChatPrompt,
    setChatByKey,
    setLiveRunByChat,
    setOpenTabs,
    setActiveTabId,
    setActiveSideThreadId,
    setThreadChatById,
    setLiveRunByThread,
    setUserSettings,
    servers,
    setServers,
    setActiveServerIdState,
    setNewRemoteModalOpen,
    updateStatus,
    setUpdateStatus,
    layoutPersistTimerRef,
    wsRef,
    restoredLastTabRef,
  } = state;
  const { hydrateAll } = boot;

  const handleApplyUpdate = useCallback(async () => {
    const win = typeof window !== "undefined"
      ? (window as Window & {
          criativoDesktop?: {
            isPackagedDesktop?: boolean;
            triggerUpdateInstall?: () => Promise<unknown>;
          };
        })
      : null;

    if (updateStatus?.state === "ready_to_restart") {
      await daemonApi.triggerUpdateRestart().catch(() => {});
      return;
    }

    if (win?.criativoDesktop?.isPackagedDesktop && win.criativoDesktop.triggerUpdateInstall) {
      await win.criativoDesktop.triggerUpdateInstall();
      const refreshed = await daemonApi.obterStatusAtualizacao().catch(() => null);
      if (refreshed) setUpdateStatus(refreshed);
      return;
    }

    const next = await daemonApi.aplicarAtualizacao({ restart: true });
    setUpdateStatus(next);
  }, [updateStatus?.state]);

  const persistLayoutWidths = useCallback(
    (patch: {
      sidebar_width?: number;
      inspector_width?: number;
      sidebar_open?: boolean;
      inspector_open?: boolean;
      focus_mode?: boolean;
    }) => {
      if (layoutPersistTimerRef.current) {
        clearTimeout(layoutPersistTimerRef.current);
      }
      layoutPersistTimerRef.current = setTimeout(() => {
        setUserSettings((prev) => {
          const nextSettings: StudioUserSettings = {
            ...prev,
            aparencia: {
              ...prev.aparencia,
              ...(typeof patch.sidebar_width === "number" ? { sidebar_width: patch.sidebar_width } : {}),
              ...(typeof patch.inspector_width === "number" ? { inspector_width: patch.inspector_width } : {}),
            },
            comportamento: {
              ...prev.comportamento,
              ...(typeof patch.sidebar_open === "boolean" ? { sidebar_open: patch.sidebar_open } : {}),
              ...(typeof patch.inspector_open === "boolean" ? { inspector_open: patch.inspector_open } : {}),
              ...(typeof patch.focus_mode === "boolean" ? { focus_mode: patch.focus_mode } : {}),
            },
          };
          void daemonApi.updateUserSettings(nextSettings).catch(() => {});
          return nextSettings;
        });
      }, 280);
    },
    []
  );

  const handleToggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const nextFocus = !prev;
      const nextSidebar = !nextFocus;
      const nextInspector = !nextFocus;
      setSidebarOpen(nextSidebar);
      setInspectorOpen(nextInspector);
      persistLayoutWidths({
        focus_mode: nextFocus,
        sidebar_open: nextSidebar,
        inspector_open: nextInspector,
      });
      return nextFocus;
    });
  }, [persistLayoutWidths]);

  const handleResetLayoutWidths = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
    setSidebarOpen(true);
    setInspectorOpen(true);
    setFocusMode(false);
    writeStoredWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
    writeStoredWidth(INSPECTOR_WIDTH_KEY, DEFAULT_INSPECTOR_WIDTH);
    persistLayoutWidths({
      sidebar_width: DEFAULT_SIDEBAR_WIDTH,
      inspector_width: DEFAULT_INSPECTOR_WIDTH,
      sidebar_open: true,
      inspector_open: true,
      focus_mode: false,
    });
  }, [persistLayoutWidths]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (evt: KeyboardEvent) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key === "\\") {
        evt.preventDefault();
        handleToggleFocusMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleFocusMode]);

  const handleSwitchServer = useCallback(
    async (serverId: string) => {
      setBootLoading(true);
      try {
        const res = await daemonApi.selecionarServidor(serverId);
        setServers(res.servers);
        setActiveServerIdState(res.active_server_id);
        setOnboarding(null);
        setUso(null);
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
        void getCriativoDesktopBridge()?.dockSyncActiveServer?.(res.active_server_id);
        await hydrateAll();
      } catch {
        // toast/error silencioso; status permanece no servidor atual
      } finally {
        setBootLoading(false);
      }
    },
    [hydrateAll]
  );

  const handleConfigureServerWithAgent = useCallback(
    async (promptText: string, _claim: ServerClaimTicket | null) => {
      setNewRemoteModalOpen(false);
      setActiveSection("agentes");

      let poolAgents = agentes;
      try {
        await daemonApi.setVpsAssistantState("reopen");
        const nextAgents = await daemonApi.listAgents({ includeVps: true });
        if (nextAgents.length > 0) {
          poolAgents = nextAgents;
          setAgentes(nextAgents);
        }
      } catch {
        // segue com lista atual caso backend legado
      }

      const targetAgent =
        poolAgents.find((a) => a.agente_id === "assistente_servidor_vps") ??
        poolAgents.find((a) => a.agente_id === "estrategista") ??
        poolAgents[0];
      const targetAgentId = targetAgent?.agente_id ?? "assistente_servidor_vps";
      const vis = getAgentAvatar(targetAgent);
      setOpenTabs((prev) =>
        prev.some((t) => t.id === `agent:${targetAgentId}`)
          ? prev
          : [
              ...prev,
              {
                id: `agent:${targetAgentId}`,
                titulo: targetAgent?.nome ?? "Especialista em Servidor VPS",
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

  return {
    handleApplyUpdate,
    persistLayoutWidths,
    handleToggleFocusMode,
    handleResetLayoutWidths,
    handleSwitchServer,
    handleConfigureServerWithAgent
  };
}

export type StudioServerActions = ReturnType<typeof useStudioServerActions>;
