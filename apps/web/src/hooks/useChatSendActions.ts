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
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../services/websocket-client";
import { getThreadLaneKey, mergeUniqueMessages } from "../utils/studio-storage";
import type { StudioAppState } from "./useStudioState";
import type { StudioBootstrapActions } from "./useStudioBootstrap";
import type { StudioDerivedData } from "./useStudioDerivedData";

export function useChatSendActions(
  state: StudioAppState,
  boot: StudioBootstrapActions,
  derived: StudioDerivedData
) {
  const {
    centerMode,
    setTarefas,
    setArquivos,
    setUso,
    setAnalyticsUso,
    usoPeriodoDias,
    usoAgenteFiltro,
    setHabilidades,
    setVaultKeys,
    steps,
    setChatByKey,
    liveRunByChat,
    setLiveRunByChat,
    setSendingChat,
    openTabs,
    setOpenTabs,
    setThreadsByAgent,
    setAllThreads,
    setThreadChatById,
    liveRunByThread,
    setLiveRunByThread,
    setFoldersSnapshot,
    setUsageLimitAskByAgent,
  } = state;
  const { refreshAgentThreadsState, refreshLibraryFolders } = boot;
  const { activeAgent, activeChannel, activeThread } = derived;

  const handleUploadFile = async (
    file: File,
    categoria?: "logo" | "foto" | "referencia" | "personagem" | "ficha_pdf" | "upload"
  ): Promise<AnexoChat> => {
    const uploaded = categoria
      ? (await daemonApi.uploadFileCategorized(file, categoria, activeAgent?.agente_id ?? null)).anexo
      : await daemonApi.uploadFile(file, activeAgent?.agente_id ?? null);
    const [refreshedFiles, refreshedFolders] = await Promise.all([
      daemonApi.listFiles(),
      daemonApi.listLibraryFolders().catch(() => null),
    ]);
    setArquivos(refreshedFiles);
    if (refreshedFolders) setFoldersSnapshot(refreshedFolders);
    return uploaded;
  };

  const handleDeleteFile = async (arquivoId: string): Promise<void> => {
    await daemonApi.deleteFile(arquivoId);
    setArquivos((prev) => prev.filter((a) => a.arquivo_id !== arquivoId));
    await refreshLibraryFolders();
  };

  const handleSubmitUiBlock = async (payload: UiBlockSubmitPayload): Promise<void> => {
    const res = await daemonApi.submitChatUiResponse(payload);
    if (payload.canal_id.startsWith("thread:")) {
      const thId = payload.canal_id.slice("thread:".length);
      setThreadChatById((prev) => ({
        ...prev,
        [thId]: (prev[thId] ?? []).map((m) =>
          m.ui_block?.bloco_id === payload.bloco_id ? { ...m, ui_block: res.bloco } : m
        ),
      }));
    } else {
      setChatByKey((prev) => ({
        ...prev,
        [payload.canal_id]: (prev[payload.canal_id] ?? []).map((m) =>
          m.ui_block?.bloco_id === payload.bloco_id ? { ...m, ui_block: res.bloco } : m
        ),
      }));
    }
    if (payload.api_key_payload) {
      const updatedKeys = await daemonApi.getVaultStatus().catch(() => null);
      if (updatedKeys) setVaultKeys(updatedKeys);
    }
  };

  const handleSaveSkillSuggestion = async (mensagemId: string): Promise<void> => {
    const res = await daemonApi.saveSkillSuggestion(mensagemId);
    setChatByKey((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
    setThreadChatById((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
    const nextSkills = await daemonApi.listSkills().catch(() => null);
    if (nextSkills) setHabilidades(nextSkills);
  };

  const handleDismissSkillSuggestion = async (mensagemId: string): Promise<void> => {
    const res = await daemonApi.dismissSkillSuggestion(mensagemId);
    setChatByKey((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
    setThreadChatById((prev) => {
      const next: Record<string, MensagemChat[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((m) =>
          m.mensagem_id === mensagemId ? { ...m, skill_sugestao: res.sugestao } : m
        );
      }
      return next;
    });
  };

  const handleSendChatMessage = async (
    conteudo: string,
    anexos: AnexoChat[],
    pageContext?: string | null
  ) => {
    const payloadContent =
      pageContext && pageContext.trim().length > 0
        ? [conteudo.trim(), `[Contexto da página visual]\n${pageContext.trim()}`]
            .filter(Boolean)
            .join("\n\n")
        : conteudo;

    if (centerMode.type === "thread" && activeAgent) {
      const threadId = centerMode.threadId;
      const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const optimisticMsg: MensagemChat = {
        mensagem_id: optimisticId,
        canal_id: `thread:${threadId}`,
        thread_id: threadId,
        agente_id: activeAgent.agente_id,
        autor: "usuario",
        autor_nome: "Você",
        conteudo_markdown: conteudo || "Referências enviadas para sub-tarefa.",
        anexos,
        steps: [],
        tarefa_id: null,
        lida: true,
        criado_em: new Date().toISOString(),
      };
      setThreadChatById((prev) => ({
        ...prev,
        [threadId]: mergeUniqueMessages(prev[threadId] ?? [], [optimisticMsg]),
      }));
      const hadExistingRun = Boolean(liveRunByThread[threadId]);
      if (!hadExistingRun) {
        setLiveRunByThread((prev) => ({
          ...prev,
          [threadId]: {
            agenteId: activeAgent.agente_id,
            agenteNome: activeAgent.nome,
            startedAt: Date.now(),
            statusText: "Enviando para sub-thread paralela...",
            steps: [],
            streamingText: "",
          },
        }));
      }
      setSendingChat(true);
      let keepLiveRun = hadExistingRun;
      const currentTopicTitle = activeThread?.titulo;
      const currentTabTitle = openTabs.find(
        (t) => t.id === `thread:${activeAgent.agente_id}:${threadId}`
      )?.titulo;
      const shouldRenameTopicTab =
        (currentTopicTitle === "Nova Subconversa" ||
          currentTopicTitle === "Novo tópico" ||
          currentTabTitle === "Nova Subconversa" ||
          currentTabTitle === "Novo tópico") &&
        conteudo.trim().length > 0;
      if (shouldRenameTopicTab) {
        const cleanTitle = conteudo.trim().replace(/\s+/g, " ");
        const nextTitle = cleanTitle.length > 42 ? `${cleanTitle.slice(0, 39)}...` : cleanTitle;
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.id === `thread:${activeAgent.agente_id}:${threadId}`
              ? { ...tab, titulo: nextTitle }
              : tab
          )
        );
        setAllThreads((prev) =>
          prev.map((t) => (t.thread_id === threadId ? { ...t, titulo: nextTitle } : t))
        );
        setThreadsByAgent((prev) => {
          const snap = prev[activeAgent.agente_id];
          if (!snap) return prev;
          return {
            ...prev,
            [activeAgent.agente_id]: {
              ...snap,
              threads: snap.threads.map((t) =>
                t.thread_id === threadId ? { ...t, titulo: nextTitle } : t
              ),
            },
          };
        });
      }
      try {
        const res = await daemonApi.sendThreadMessage(threadId, payloadContent, anexos);
        if (res.enfileirada || res.steered) {
          keepLiveRun = true;
          setThreadChatById((prev) => ({
            ...prev,
            [threadId]: mergeUniqueMessages(
              (prev[threadId] ?? []).filter((m) => m.mensagem_id !== optimisticId),
              res.mensagem_usuario ? [res.mensagem_usuario] : []
            ),
          }));
          await refreshAgentThreadsState(activeAgent.agente_id, threadId);
        } else {
          setThreadChatById((prev) => ({
            ...prev,
            [threadId]: mergeUniqueMessages(
              (prev[threadId] ?? []).filter((m) => m.mensagem_id !== optimisticId),
              [res.mensagem_usuario, res.mensagem_agente].filter(
                (x): x is MensagemChat => Boolean(x)
              )
            ),
          }));
          if (shouldRenameTopicTab) {
            await refreshAgentThreadsState(activeAgent.agente_id, threadId);
          }
        }
      } finally {
        if (!keepLiveRun) {
          setLiveRunByThread((prev) => {
            if (!prev[threadId]) return prev;
            const copy = { ...prev };
            delete copy[threadId];
            return copy;
          });
        }
        setSendingChat(false);
      }
      return;
    }

    const targetKey =
      centerMode.type === "channel" && activeChannel
        ? activeChannel.canal_id
        : activeAgent
          ? `agente:${activeAgent.agente_id}`
          : "";
    if (!targetKey) return;

    const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const optimisticMsg: MensagemChat = {
      mensagem_id: optimisticId,
      canal_id: targetKey,
      agente_id: activeAgent?.agente_id ?? null,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo || "Referências enviadas para produção.",
      anexos,
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const hadExistingRun = Boolean(liveRunByChat[targetKey]);
    setChatByKey((prev) => ({
      ...prev,
      [targetKey]: mergeUniqueMessages(prev[targetKey] ?? [], [optimisticMsg]),
    }));
    if (!hadExistingRun) {
      setLiveRunByChat((prev) => ({
        ...prev,
        [targetKey]: {
          agenteId: activeAgent?.agente_id ?? null,
          agenteNome:
            centerMode.type === "channel" && activeChannel
              ? activeChannel.nome
              : activeAgent?.nome ?? "Agente",
          startedAt: Date.now(),
          statusText: "Enviando briefing e carregando contexto...",
          steps: [],
          streamingText: "",
        },
      }));
    }

    setSendingChat(true);
    let keepLiveRun = hadExistingRun;
    try {
      if (centerMode.type === "channel" && activeChannel) {
        const res = await daemonApi.sendChannelMessage(
          activeChannel.canal_id,
          payloadContent,
          anexos
        );
        setChatByKey((prev) => {
          const withoutTemp = (prev[targetKey] ?? []).filter((m) => m.mensagem_id !== optimisticId);
          return {
            ...prev,
            [targetKey]: mergeUniqueMessages(withoutTemp, [
              res.mensagem_usuario,
              ...res.mensagens_equipe,
            ]),
          };
        });
      } else if (activeAgent) {
        const res = await daemonApi.sendAgentMessage(
          activeAgent.agente_id,
          payloadContent,
          anexos
        );
        if (res.enfileirada || res.steered) {
          keepLiveRun = true;
          setChatByKey((prev) => {
            const withoutTemp = (prev[targetKey] ?? []).filter(
              (m) => m.mensagem_id !== optimisticId
            );
            return {
              ...prev,
              [targetKey]: mergeUniqueMessages(
                withoutTemp,
                res.mensagem_usuario ? [res.mensagem_usuario] : []
              ),
            };
          });
          await refreshAgentThreadsState(activeAgent.agente_id, null);
        } else {
          setChatByKey((prev) => {
            const withoutTemp = (prev[targetKey] ?? []).filter(
              (m) => m.mensagem_id !== optimisticId
            );
            const extras = [res.mensagem_usuario, res.mensagem_agente, ...(res.mensagens_handoff ?? [])].filter(
              (x): x is MensagemChat => Boolean(x)
            );
            return {
              ...prev,
              [targetKey]: mergeUniqueMessages(withoutTemp, extras),
            };
          });
          const agentReplyMeta = (
            res.mensagem_agente as unknown as { metadados?: { usage_limit_ask?: UsageLimitAskPayload } } | undefined
          )?.metadados;
          if (agentReplyMeta?.usage_limit_ask) {
            const askPayload = agentReplyMeta.usage_limit_ask;
            setUsageLimitAskByAgent((prev) => ({
              ...prev,
              [activeAgent.agente_id]: askPayload,
            }));
          }
        }
      }
      const [nextTasks, nextUsage, nextAnalytics, nextFiles] = await Promise.all([
        daemonApi.listTasks(),
        daemonApi.getProvidersUsage(false),
        daemonApi.getUsageAnalytics({ dias: usoPeriodoDias, agente_id: usoAgenteFiltro }),
        daemonApi.listFiles(),
      ]);
      setTarefas(nextTasks);
      setUso(nextUsage);
      setAnalyticsUso(nextAnalytics);
      setArquivos(nextFiles);
    } finally {
      if (!keepLiveRun) {
        setLiveRunByChat((prev) => {
          if (!prev[targetKey]) return prev;
          const copy = { ...prev };
          delete copy[targetKey];
          return copy;
        });
      }
      setSendingChat(false);
    }
  };

  // Fase 13 — Paginação, Ramificação, Fixação, Pergunta Lateral, Reset, Esperas & Controle da Fila

  return {
    handleUploadFile,
    handleDeleteFile,
    handleSubmitUiBlock,
    handleSaveSkillSuggestion,
    handleDismissSkillSuggestion,
    handleSendChatMessage
  };
}

export type StudioChatSendActions = ReturnType<typeof useChatSendActions>;
