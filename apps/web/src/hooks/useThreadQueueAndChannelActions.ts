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
import { NewAgentScreen, type NewAgentPayload } from "../features/agents/NewAgentScreen";
import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import { getThreadLaneKey, mergeUniqueMessages, type AgenteEnriquecido } from "../utils/studio-storage";
import type { StudioAppState } from "./useStudioState";
import type { StudioBootstrapActions } from "./useStudioBootstrap";
import type { StudioDerivedData } from "./useStudioDerivedData";
import type { StudioTabsAndNavActions } from "./useStudioTabsAndNavigation";

export function useThreadQueueAndChannelActions(
  state: StudioAppState,
  boot: StudioBootstrapActions,
  derived: StudioDerivedData,
  nav: StudioTabsAndNavActions
) {
  const {
    centerMode,
    agentes,
    setAgentes,
    setCanais,
    provedores,
    setProvedores,
    uso,
    setUso,
    setChannelModalOpen,
    newChannelName,
    setNewChannelName,
    newChannelDesc,
    setNewChannelDesc,
    newChannelInst,
    setNewChannelInst,
    newChannelMembers,
    newChannelLeader,
    setChatByKey,
    setPendingAuthLink,
    setOpenTabs,
    setThreadChatById,
    threadPaginationById,
    setThreadPaginationById,
    setQueueByLane,
    setPinsByAgent,
    editingQueueByLane,
    setEditingQueueByLane,
    setHighlightedMessageId,
    servers,
    desktopAssistedProviderRef,
  } = state;
  const { refreshAgentThreadsState } = boot;
  const { activeAgent, activeThreadKey, activeLaneThreadId, activeLaneKeyStr } = derived;
  const { handleSelectAgent, handleSelectChannel, handleSelectThreadInAgent } = nav;

  const handleLoadOlderMessages = async () => {
    if (!activeAgent || !activeThreadKey) return;
    const currentPag = threadPaginationById[activeThreadKey];
    if (!currentPag?.has_older || !currentPag.older_cursor) return;

    setThreadPaginationById((prev) => ({
      ...prev,
      [activeThreadKey]: { ...currentPag, loading_older: true },
    }));
    try {
      const older =
        centerMode.type === "thread"
          ? await daemonApi.readThreadMessages(centerMode.threadId, {
              limit: 50,
              beforeCursor: currentPag.older_cursor,
            })
          : await daemonApi.readAgentMessagesPage(activeAgent.agente_id, {
              limit: 50,
              beforeCursor: currentPag.older_cursor,
            });
      if (centerMode.type === "thread") {
        setThreadChatById((prev) => ({
          ...prev,
          [centerMode.threadId]: mergeUniqueMessages(older.mensagens, prev[centerMode.threadId] ?? []),
        }));
      } else {
        const key = `agente:${activeAgent.agente_id}`;
        setChatByKey((prev) => ({
          ...prev,
          [key]: mergeUniqueMessages(older.mensagens, prev[key] ?? []),
        }));
      }
      setThreadPaginationById((prev) => ({
        ...prev,
        [activeThreadKey]: { ...older, loading_older: false },
      }));
    } catch {
      setThreadPaginationById((prev) => ({
        ...prev,
        [activeThreadKey]: { ...currentPag, loading_older: false },
      }));
    }
  };

  const handleJumpToLatest = async () => {
    if (!activeAgent || !activeThreadKey) return;
    if (centerMode.type === "thread") {
      const pagina = await daemonApi.readThreadMessages(centerMode.threadId, { limit: 50 });
      setThreadChatById((prev) => ({ ...prev, [centerMode.threadId]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [centerMode.threadId]: pagina }));
    } else {
      const pagina = await daemonApi.readAgentMessagesPage(activeAgent.agente_id, { limit: 50 });
      const key = `agente:${activeAgent.agente_id}`;
      setChatByKey((prev) => ({ ...prev, [key]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [activeThreadKey]: pagina }));
    }
    setHighlightedMessageId(null);
  };

  const handleJumpToMessage = async (targetThreadId: string, mensagemId: string) => {
    if (!activeAgent) return;
    const isMain = targetThreadId.startsWith("main:");
    if (isMain) {
      const pagina = await daemonApi.readAgentMessagesPage(activeAgent.agente_id, {
        limit: 50,
        aroundMessageId: mensagemId,
      });
      setChatByKey((prev) => ({ ...prev, [`agente:${activeAgent.agente_id}`]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [targetThreadId]: pagina }));
      handleSelectAgent(activeAgent.agente_id);
    } else {
      const pagina = await daemonApi.readThreadMessages(targetThreadId, {
        limit: 50,
        aroundMessageId: mensagemId,
      });
      setThreadChatById((prev) => ({ ...prev, [targetThreadId]: pagina.mensagens }));
      setThreadPaginationById((prev) => ({ ...prev, [targetThreadId]: pagina }));
      handleSelectThreadInAgent(activeAgent.agente_id, targetThreadId);
    }
    setHighlightedMessageId(mensagemId);
  };

  const handleNavigateBranchOrigin = async (branch: AgenteThreadBranch) => {
    if (branch.origem_excluida) return;
    await handleJumpToMessage(branch.origem_thread_id, branch.origem_mensagem_id);
  };

  const handleBranchFromMessage = async (mensagemId: string) => {
    if (!activeAgent) return;
    const created = await daemonApi.branchConversation(activeAgent.agente_id, {
      thread_id: centerMode.type === "thread" ? centerMode.threadId : null,
      mensagem_id: mensagemId,
      request_id: `branch-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    });
    await refreshAgentThreadsState(activeAgent.agente_id, created.thread_id);
    handleSelectThreadInAgent(activeAgent.agente_id, created.thread_id);
  };

  const handleTogglePinMessage = async (mensagem: MensagemChat, pinned: boolean) => {
    if (!activeAgent) return;
    const threadId = mensagem.thread_id ?? activeThreadKey ?? `main:${activeAgent.agente_id}`;
    const updatedPins = await daemonApi.setMessagePinned(activeAgent.agente_id, {
      thread_id: threadId,
      mensagem_id: mensagem.mensagem_id,
      pinned,
    });
    setPinsByAgent((prev) => ({ ...prev, [activeAgent.agente_id]: updatedPins }));
  };

  const handleAskSideQuestion = async (
    pergunta: string,
    historico: Array<{ pergunta: string; resposta: string }>
  ): Promise<string> => {
    if (!activeAgent) return "Nenhum agente selecionado.";
    const res = await daemonApi.askSideQuestion(activeAgent.agente_id, {
      pergunta,
      historico_lateral: historico,
      thread_id: centerMode.type === "thread" ? centerMode.threadId : null,
    });
    return res.resposta;
  };

  const handleStartNewChat = async () => {
    if (!activeAgent) return;
    const res = await daemonApi.startNewChat(activeAgent.agente_id);
    const key = `agente:${activeAgent.agente_id}`;
    setChatByKey((prev) => ({
      ...prev,
      [key]: mergeUniqueMessages(prev[key] ?? [], [res.mensagem_divisor]),
    }));
  };

  const handleCloseWait = async (esperaId: string) => {
    if (!activeAgent) return;
    await daemonApi.cancelWait(activeAgent.agente_id, esperaId);
    await refreshAgentThreadsState(activeAgent.agente_id, activeLaneThreadId);
  };

  const handleBeginEditQueueItem = async (entrega: FilaChatEntrega) => {
    if (!activeAgent) return;
    const editId = `edit-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const snapshot = await daemonApi.editChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entrega.entrega_id,
      acao: "begin",
      edit_id: editId,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
    setEditingQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: { entrega, editId } }));
  };

  const handleSaveEditQueueItem = async (
    entregaId: string,
    conteudo: string,
    anexos: AnexoChat[]
  ) => {
    if (!activeAgent) return;
    const editId = editingQueueByLane[activeLaneKeyStr]?.editId ?? "";
    const snapshot = await daemonApi.editChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
      acao: "save",
      edit_id: editId,
      conteudo,
      anexos,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
    setEditingQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: null }));
  };

  const handleDiscardEditQueueItem = async (entregaId: string) => {
    if (!activeAgent) return;
    const editId = editingQueueByLane[activeLaneKeyStr]?.editId ?? "";
    try {
      const snapshot = await daemonApi.editChatQueue(activeAgent.agente_id, {
        thread_id: activeLaneThreadId,
        entrega_id: entregaId,
        acao: "cancel",
        edit_id: editId,
      });
      setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
    } finally {
      setEditingQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: null }));
    }
  };

  const handleCancelOrDeleteQueueItem = async (entregaId: string, deleteAfter = false) => {
    if (!activeAgent) return;
    const snapshot = await daemonApi.cancelChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
      delete_after: deleteAfter,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
  };

  const handleReorderQueue = async (ids: string[]) => {
    if (!activeAgent) return;
    const snapshot = await daemonApi.reorderChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_ids: ids,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: snapshot }));
  };

  const handleSteerQueueItem = async (entregaId: string) => {
    if (!activeAgent) return;
    const res = await daemonApi.steerChatQueue(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: res.snapshot }));
  };

  const handleMoveQueueItemToTask = async (entregaId: string) => {
    if (!activeAgent) return;
    const res = await daemonApi.runQueuedAsTask(activeAgent.agente_id, {
      thread_id: activeLaneThreadId,
      entrega_id: entregaId,
    });
    setQueueByLane((prev) => ({ ...prev, [activeLaneKeyStr]: res.snapshot }));
    await refreshAgentThreadsState(activeAgent.agente_id, activeLaneThreadId);
  };

  const handleInterruptTurn = async () => {
    if (!activeAgent) return;
    if (centerMode.type === "thread") {
      await daemonApi.stopThread(centerMode.threadId);
    } else {
      await daemonApi.interruptTurn(activeAgent.agente_id, null);
    }
  };

  const handleCreateCustomAgent = async (payload: NewAgentPayload) => {
    const created = await daemonApi.createAgent(payload);
    setAgentes((prev) => [...prev, created]);
    handleSelectAgent(created.agente_id);
  };

  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    const membros =
      newChannelMembers.length > 0 ? newChannelMembers : ["estrategista", "copywriter"];
    const lider = membros.includes(newChannelLeader) ? newChannelLeader : membros[0];
    const canal = await daemonApi.createChannel({
      nome: newChannelName.trim(),
      descricao: newChannelDesc.trim(),
      instrucoes: newChannelInst.trim(),
      membros_agentes: membros,
      lider_agente_id: lider,
    });
    setCanais((prev) => [canal, ...prev]);
    setNewChannelName("");
    setNewChannelDesc("");
    setNewChannelInst("");
    setChannelModalOpen(false);
    handleSelectChannel(canal.canal_id);
  };

  const handleDeleteChannel = async (canalId: string) => {
    await daemonApi.deleteChannel(canalId);
    setCanais((prev) => prev.filter((c) => c.canal_id !== canalId));
    setOpenTabs((prev) => prev.filter((t) => t.id !== `channel:${canalId}`));
    if (centerMode.type === "channel" && centerMode.canalId === canalId) {
      const fallbackId = agentes[0]?.agente_id ?? "estrategista";
      handleSelectAgent(fallbackId);
    }
  };

  const handleConnectViaBrowser = useCallback(
    async (prov: "gemini" | "claude" | "openai", label?: string) => {
      setPendingAuthLink(null);
      try {
        const currentServerId = getActiveServerId();
        const activeSrv = servers.find((s) => s.server_id === currentServerId);
        const isRemoteTarget = activeSrv?.kind === "remote_vps" || activeSrv?.kind === "joined";
        if (prov === "gemini" && isRemoteTarget) {
          desktopAssistedProviderRef.current = "gemini";
          const remoteRes = await daemonApi.conectarGeminiRemotoViaDesktop(currentServerId, label);
          if (remoteRes.ok && remoteRes.provedores) {
            setProvedores(remoteRes.provedores);
            setUso(remoteRes.uso ?? (await daemonApi.getProvidersUsage(true).catch(() => uso)));
          }
          return {
            ok: Boolean(remoteRes.ok),
            canceled: Boolean(remoteRes.canceled),
            erro: remoteRes.erro,
          };
        }
        if (prov === "openai" && isRemoteTarget) {
          desktopAssistedProviderRef.current = "openai";
          try {
            const remoteRes = await daemonApi.conectarOpenAiRemotoViaDesktop(currentServerId, label);
            if (remoteRes.ok && remoteRes.provedores) {
              setProvedores(remoteRes.provedores);
              setUso(remoteRes.uso ?? (await daemonApi.getProvidersUsage(true).catch(() => uso)));
              return { ok: true, canceled: false };
            }
            if (remoteRes.canceled) {
              return { ok: false, canceled: true, erro: remoteRes.erro };
            }
            if (
              remoteRes.erro &&
              !/Runtime Codex CLI|não encontrado|não pôde ser instalado|404|503/i.test(remoteRes.erro)
            ) {
              return { ok: false, canceled: false, erro: remoteRes.erro };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            if (msg && !/Runtime Codex CLI|não encontrado|não pôde ser instalado|404|503/i.test(msg)) {
              return { ok: false, canceled: false, erro: msg };
            }
          } finally {
            desktopAssistedProviderRef.current = null;
          }
        }
        const res = await daemonApi.connectProviderViaBrowser(prov, label);
        if (res.ok && res.provedores) {
          setProvedores(res.provedores);
          if (res.uso) setUso(res.uso);
        }
        return { ok: Boolean(res.ok), canceled: Boolean(res.canceled), erro: res.erro };
      } finally {
        desktopAssistedProviderRef.current = null;
        setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
      }
    },
    [servers, uso]
  );

  const handleCancelBrowserSignIn = useCallback(
    async (prov: "gemini" | "claude" | "openai") => {
      await daemonApi.cancelProviderBrowserSignIn(prov);
      setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
    },
    []
  );

  return {
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
    handleCreateChannelSubmit,
    handleDeleteChannel,
    handleConnectViaBrowser,
    handleCancelBrowserSignIn
  };
}

export type StudioThreadQueueAndChannelActions = ReturnType<typeof useThreadQueueAndChannelActions>;
