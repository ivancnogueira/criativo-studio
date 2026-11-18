import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgenteRegistro,
  AnexoChat,
  ArquivoStudio,
  AvatarShape,
  CanalEquipe,
  ConectorIntegracaoInfo,
  HabilidadeInstaladaInfo,
  MensagemChat,
  NivelEsforco,
  OnboardingEstado,
  PacoteUpgradeInfo,
  PassoChat,
  ProvedorStatusInfo,
  ProviderName,
  RelatorioAnalyticsHost,
  StatusMensageria,
  TarefaRegistro,
  UsoProvedoresSnapshot,
  WhatsAppContaResumo,
  WorkflowAresta,
  WorkflowNo,
  WorkflowVisual,
} from "@criativo/contracts";
import { Users, X } from "lucide-react";
import { DynamicIsland, type StudioTabItem } from "./components/DynamicIsland";
import { getDefaultMascotForAgent } from "./components/MascoteAvatar";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceRail, type StudioNavSection } from "./components/WorkspaceRail";
import { NewAgentScreen, type NewAgentPayload } from "./features/agents/NewAgentScreen";
import {
  AgentConversationView,
  type McpSignInCardState,
} from "./features/chat/AgentConversationView";
import { RightInspectorPanel } from "./features/inspector/RightInspectorPanel";
import { MarketplacePage } from "./features/marketplace/MarketplacePage";
import { OnboardingFlow } from "./features/onboarding/OnboardingFlow";
import { ConnectorsPage } from "./features/pages/ConnectorsPage";
import { FilesVaultPage } from "./features/pages/FilesVaultPage";
import { TasksQueuePage } from "./features/pages/TasksQueuePage";
import { UsageMetricsPage } from "./features/pages/UsageMetricsPage";
import { RoutineFlowsCanvas } from "./features/routines/RoutineFlowsCanvas";
import { SchedulePage } from "./features/schedule/SchedulePage";
import type { AgentStepLog } from "./features/trace/AgentStepsWaterfall";
import { WhatsAppPairingModal } from "./features/whatsapp/WhatsAppPairingModal";
import { WorkflowsCanvasPage } from "./features/workflows/WorkflowsCanvasPage";
import { daemonApi, WebSocketClient } from "./services/websocket-client";

type AgenteEnriquecido = AgenteRegistro & {
  nao_lidas?: number;
  ultima_mensagem?: string | null;
  ultima_mensagem_em?: string | null;
};

type AgentCenterMode =
  | { type: "agent"; agenteId: string }
  | { type: "channel"; canalId: string }
  | { type: "new_agent" };

function getAgentAvatar(ag?: AgenteRegistro | null): { shape: AvatarShape; color: string } {
  if (!ag) return { shape: "blob", color: "#38bdf8" };
  const cfg = (ag.config ?? {}) as Record<string, unknown>;
  const fb = getDefaultMascotForAgent(ag.agente_id);
  return {
    shape: (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape,
    color: typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color,
  };
}

function mergeUniqueMessages(
  current: MensagemChat[],
  incoming: MensagemChat[]
): MensagemChat[] {
  const map = new Map<string, MensagemChat>();
  for (const m of current) map.set(m.mensagem_id, m);
  for (const m of incoming) map.set(m.mensagem_id, m);
  return Array.from(map.values()).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
}

export function App() {
  const [bootLoading, setBootLoading] = useState(true);
  const [onboarding, setOnboarding] = useState<OnboardingEstado | null>(null);
  const [activeSection, setActiveSection] = useState<StudioNavSection>("agentes");
  const [centerMode, setCenterMode] = useState<AgentCenterMode>({
    type: "agent",
    agenteId: "estrategista",
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [agentes, setAgentes] = useState<AgenteEnriquecido[]>([]);
  const [canais, setCanais] = useState<CanalEquipe[]>([]);
  const [tarefas, setTarefas] = useState<TarefaRegistro[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowVisual[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoStudio[]>([]);
  const [provedores, setProvedores] = useState<ProvedorStatusInfo[]>([]);
  const [uso, setUso] = useState<UsoProvedoresSnapshot | null>(null);
  const [analyticsUso, setAnalyticsUso] = useState<RelatorioAnalyticsHost | null>(null);
  const [usoPeriodoDias, setUsoPeriodoDias] = useState<number>(30);
  const [usoAgenteFiltro, setUsoAgenteFiltro] = useState<string | null>(null);
  const [habilidades, setHabilidades] = useState<HabilidadeInstaladaInfo[]>([]);
  const [upgrades, setUpgrades] = useState<PacoteUpgradeInfo[]>([]);
  const [conectores, setConectores] = useState<ConectorIntegracaoInfo[]>([]);
  const [vaultKeys, setVaultKeys] = useState<Array<{ chave_nome: string; atualizado_em: string }>>([]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStepLog[]>([]);
  const [thoughtStream, setThoughtStream] = useState("");
  const [wsConnected, setWsConnected] = useState(false);

  const [whatsappStatus, setWhatsappStatus] = useState<StatusMensageria>("desconectado");
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappAccounts, setWhatsappAccounts] = useState<WhatsAppContaResumo[]>([]);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [pendingMcpSignIn, setPendingMcpSignIn] = useState<McpSignInCardState | null>(null);
  const [lojaInitialAppSlug, setLojaInitialAppSlug] = useState<string | null>(null);
  const [prefilledChatPrompt, setPrefilledChatPrompt] = useState<string | null>(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);

  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([
    "estrategista",
    "copywriter",
    "designer_carrossel",
  ]);

  const [chatByKey, setChatByKey] = useState<Record<string, MensagemChat[]>>({});
  const [liveRunByChat, setLiveRunByChat] = useState<
    Record<
      string,
      {
        agenteId: string | null;
        agenteNome: string;
        startedAt: number;
        statusText: string;
        steps: PassoChat[];
        streamingText: string;
      }
    >
  >({});
  const [sendingChat, setSendingChat] = useState(false);
  const [pendingAuthLink, setPendingAuthLink] = useState<{
    provedor: "gemini" | "claude" | "openai";
    url: string;
  } | null>(null);
  const [openTabs, setOpenTabs] = useState<StudioTabItem[]>([
    { id: "agent:estrategista", titulo: "Estrategista Editorial", shape: "hex", color: "#31cf76" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("agent:estrategista");

  const [sidebarViewMode, setSidebarViewMode] = useState<"agents" | "routines">("agents");
  const [routineCountsByAgent, setRoutineCountsByAgent] = useState<Record<string, number>>({});
  const [routinesRefreshNonce, setRoutinesRefreshNonce] = useState(0);
  const [flowRefreshNonce, setFlowRefreshNonce] = useState(0);
  const [routineInspectorSignal, setRoutineInspectorSignal] = useState<{
    subView?: "routines";
    rotinaId?: string | null;
    nonce: number;
  } | null>(null);
  const [routineNotifications, setRoutineNotifications] = useState<
    Array<{ id: string; rotina_nome: string; resumo: string; owner_id: string }>
  >([]);
  const [activeSideThreadId, setActiveSideThreadId] = useState<string | null>(null);

  const refreshRoutineCounts = useCallback(async () => {
    try {
      const all = await daemonApi.listAllRoutines();
      const counts: Record<string, number> = {};
      for (const item of all) {
        if (item.owner_kind === "agente") {
          counts[item.owner_id] = (counts[item.owner_id] ?? 0) + 1;
        }
      }
      setRoutineCountsByAgent(counts);
    } catch {
      // Silencioso caso endpoint ainda não responda
    }
  }, []);

  const hydrateAll = useCallback(async () => {
    try {
      const [
        onb,
        agList,
        chList,
        tList,
        wa,
        provList,
        usageSnap,
        analyticsData,
        skillsList,
        upgradeList,
        connList,
        wfList,
        fileList,
        keys,
        waAccountsList,
      ] = await Promise.all([
        daemonApi.getOnboarding(),
        daemonApi.listAgents(),
        daemonApi.listChannels(),
        daemonApi.listTasks(),
        daemonApi.getWhatsAppStatus(),
        daemonApi.listProvidersStatus(false),
        daemonApi.getProvidersUsage(false),
        daemonApi.getUsageAnalytics({ dias: 30, agente_id: null }),
        daemonApi.listSkills(),
        daemonApi.listUpgrades(),
        daemonApi.listConnectors(),
        daemonApi.listWorkflows(),
        daemonApi.listFiles(),
        daemonApi.getVaultStatus(),
        daemonApi.listWhatsAppAccounts().catch(() => [] as WhatsAppContaResumo[]),
      ]);

      setOnboarding(onb);
      setAgentes(agList);
      setCanais(chList);
      setTarefas(tList);
      setWhatsappStatus(wa.status);
      setWhatsappQr(wa.qrcode_base64);
      setProvedores(provList);
      setUso(usageSnap);
      setAnalyticsUso(analyticsData);
      setHabilidades(skillsList);
      setUpgrades(upgradeList);
      setConectores(connList);
      setWorkflows(wfList);
      setArquivos(fileList);
      setVaultKeys(keys);
      setWhatsappAccounts(waAccountsList);
      void refreshRoutineCounts();

      if (tList.length > 0) {
        const pending =
          tList.find((t) => t.status === "aguardando_aprovacao") ??
          tList.find((t) => t.status === "executando") ??
          tList[0];
        setSelectedTaskId((prev) => prev ?? pending.tarefa_id);
      }
    } finally {
      setBootLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrateAll();
  }, [hydrateAll]);

  // Carrega mensagens da conversa ativa
  useEffect(() => {
    if (activeSideThreadId && activeSideThreadId.startsWith("rotina:") && centerMode.type === "agent") {
      const rotinaId = activeSideThreadId.slice("rotina:".length);
      void daemonApi.listRoutineThreadMessages(centerMode.agenteId, rotinaId).then((msgs) => {
        setChatByKey((prev) => ({ ...prev, [activeSideThreadId]: msgs }));
      });
      return;
    }

    if (centerMode.type === "agent") {
      const key = `agente:${centerMode.agenteId}`;
      void daemonApi.listAgentMessages(centerMode.agenteId).then((msgs) => {
        setChatByKey((prev) => ({ ...prev, [key]: msgs }));
      });
      void daemonApi.markAgentRead(centerMode.agenteId).then(() => {
        setAgentes((prev) =>
          prev.map((a) => (a.agente_id === centerMode.agenteId ? { ...a, nao_lidas: 0 } : a))
        );
      });
    } else if (centerMode.type === "channel") {
      const key = centerMode.canalId;
      void daemonApi.listChannelMessages(centerMode.canalId).then((msgs) => {
        setChatByKey((prev) => ({ ...prev, [key]: msgs }));
      });
    }
  }, [centerMode, activeSideThreadId]);

  // Assinatura WebSocket ao vivo
  useEffect(() => {
    const ws = new WebSocketClient();
    const unsubConn = ws.onConnectionChange(setWsConnected);

    const unsubQueued = ws.on("task:queued", () => {
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubStarted = ws.on("task:started", (evt) => {
      setSelectedTaskId(evt.tarefa_id);
      setThoughtStream("");
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubStep = ws.on("agent:step", (evt) => {
      setSteps((prev) => [
        ...prev.slice(-80),
        {
          id: `${evt.tarefa_id}-${evt.step_index}-${Date.now()}`,
          tarefa_id: evt.tarefa_id,
          agente_id: evt.agente_id,
          step_index: evt.step_index,
          ferramenta: evt.ferramenta,
          input: evt.input,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
    const unsubThought = ws.on("agent:thought", (evt) => {
      setThoughtStream((prev) => (prev + evt.token_chunk).slice(-2400));
    });
    const unsubApproval = ws.on("task:awaiting_approval", (evt) => {
      setSelectedTaskId(evt.tarefa_id);
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubCompleted = ws.on("task:completed", () => {
      void daemonApi.listTasks().then(setTarefas);
      void daemonApi.getProvidersUsage().then(setUso);
    });
    const unsubFailed = ws.on("task:failed", () => {
      void daemonApi.listTasks().then(setTarefas);
    });
    const unsubWa = ws.on("whatsapp:status", (evt) => {
      setWhatsappStatus(evt.status);
      setWhatsappQr(evt.qrcode);
    });
    const unsubChat = ws.on("chat:message", (evt) => {
      if (evt.canal_id.startsWith("rotina:")) {
        setChatByKey((prev) => ({
          ...prev,
          [evt.canal_id]: mergeUniqueMessages(prev[evt.canal_id] ?? [], [evt.mensagem]),
        }));
        return;
      }
      setChatByKey((prev) => {
        const cleaned = (prev[evt.canal_id] ?? []).filter(
          (m) =>
            !(
              m.mensagem_id.startsWith("temp-") &&
              m.autor === evt.mensagem.autor &&
              m.conteudo_markdown === evt.mensagem.conteudo_markdown
            )
        );
        return {
          ...prev,
          [evt.canal_id]: mergeUniqueMessages(cleaned, [evt.mensagem]),
        };
      });
      if (evt.mensagem.autor === "agente") {
        setLiveRunByChat((prev) => {
          if (!prev[evt.canal_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.canal_id];
          return copy;
        });
      }
    });
    const unsubChatProgress = ws.on("chat:progress", (evt) => {
      setLiveRunByChat((prev) => {
        if (evt.fase === "concluido" || evt.fase === "erro") {
          if (!prev[evt.canal_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.canal_id];
          return copy;
        }
        const existing = prev[evt.canal_id] ?? {
          agenteId: evt.agente_id,
          agenteNome:
            agentes.find((a) => a.agente_id === evt.agente_id)?.nome ?? "Agente",
          startedAt: Date.now(),
          statusText: evt.mensagem_status ?? "Processando...",
          steps: [],
          streamingText: "",
        };
        let nextSteps = existing.steps;
        if (evt.step) {
          const step = evt.step;
          const idx = existing.steps.findIndex((s) => s.id === step.id);
          if (idx >= 0) {
            nextSteps = existing.steps.map((s, sIdx) => (sIdx === idx ? step : s));
          } else {
            nextSteps = [...existing.steps, step];
          }
        }
        return {
          ...prev,
          [evt.canal_id]: {
            ...existing,
            statusText: evt.mensagem_status ?? existing.statusText,
            steps: nextSteps,
            streamingText: evt.delta
              ? existing.streamingText + evt.delta
              : existing.streamingText,
          },
        };
      });
    });
    const unsubProv = ws.on("provider:updated", () => {
      void daemonApi.listProvidersStatus(false).then(setProvedores);
    });
    const unsubAuthUrl = ws.on("provider:auth_url", (evt) => {
      setPendingAuthLink(evt);
      try {
        if (typeof window !== "undefined") {
          window.open(evt.url, "_blank", "noopener,noreferrer");
        }
      } catch {
        // fallback visível pelo botão clicável direto na interface
      }
    });

    const unsubWaConta = ws.on("whatsapp.conta_atualizada", () => {
      void daemonApi.listWhatsAppAccounts().then(setWhatsappAccounts).catch(() => {});
    });
    const unsubMcpOAuthReq = ws.on("mcp.oauth_solicitado", (evt) => {
      setPendingMcpSignIn({
        mcpId: evt.mcp_id,
        nome: evt.nome,
        appSlug: evt.app_slug ?? null,
        status: "pending",
        errorMessage: null,
      });
    });
    const unsubMcpOAuthDone = ws.on("mcp.oauth_concluido", (evt) => {
      setPendingMcpSignIn((prev) =>
        prev && prev.mcpId === evt.mcp_id
          ? {
              ...prev,
              status: evt.sucesso ? "connected" : "error",
              errorMessage: evt.sucesso ? null : evt.erro ?? "Autenticação falhou.",
            }
          : prev
      );
      void daemonApi.listConnectors().then(setConectores).catch(() => {});
    });
    const unsubLojaSkill = ws.on("loja.skill_atualizada", () => {
      void daemonApi.listSkills().then(setHabilidades).catch(() => {});
    });
    const unsubLojaAgente = ws.on("loja.agente_instalado", () => {
      void daemonApi.listAgents().then(setAgentes).catch(() => {});
    });

    const unsubRoutineUpdated = ws.on("routine:updated", () => {
      setRoutinesRefreshNonce((n) => n + 1);
      void refreshRoutineCounts();
    });
    const unsubRoutineRunUpdated = ws.on("routine:run_updated", () => {
      setRoutinesRefreshNonce((n) => n + 1);
      setFlowRefreshNonce((n) => n + 1);
    });
    const unsubRoutineWebhook = ws.on("routine:webhook_received", () => {
      setRoutinesRefreshNonce((n) => n + 1);
    });
    const unsubRoutineFlowUpdated = ws.on("routine_flow:updated", () => {
      setFlowRefreshNonce((n) => n + 1);
    });
    const unsubRoutineNotification = ws.on("routine:notification", (evt) => {
      setRoutineNotifications((prev) => [
        ...prev.slice(-3),
        {
          id: `${evt.rotina_id}-${evt.execucao_id}-${Date.now()}`,
          rotina_nome: evt.rotina_nome,
          resumo: evt.resumo,
          owner_id: evt.owner_id,
        },
      ]);
    });

    ws.connect();
    return () => {
      unsubConn();
      unsubQueued();
      unsubStarted();
      unsubStep();
      unsubThought();
      unsubApproval();
      unsubCompleted();
      unsubFailed();
      unsubWa();
      unsubChat();
      unsubChatProgress();
      unsubProv();
      unsubAuthUrl();
      unsubWaConta();
      unsubMcpOAuthReq();
      unsubMcpOAuthDone();
      unsubLojaSkill();
      unsubLojaAgente();
      unsubRoutineUpdated();
      unsubRoutineRunUpdated();
      unsubRoutineWebhook();
      unsubRoutineFlowUpdated();
      unsubRoutineNotification();
      ws.disconnect();
    };
  }, [refreshRoutineCounts]);

  const ensureAndActivateTab = useCallback((tab: StudioTabItem, mode: AgentCenterMode) => {
    setOpenTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
    setCenterMode(mode);
    setActiveSection("agentes");
  }, []);

  const handleSelectAgent = (agenteId: string) => {
    setActiveSideThreadId(null);
    const ag = agentes.find((a) => a.agente_id === agenteId);
    const vis = getAgentAvatar(ag);
    ensureAndActivateTab(
      { id: `agent:${agenteId}`, titulo: ag?.nome ?? agenteId, shape: vis.shape, color: vis.color },
      { type: "agent", agenteId }
    );
  };

  const handleSelectChannel = (canalId: string) => {
    setActiveSideThreadId(null);
    const canal = canais.find((c) => c.canal_id === canalId);
    ensureAndActivateTab(
      { id: `channel:${canalId}`, titulo: canal?.nome ?? canalId, shape: "rounded_square", color: "#31cf76" },
      { type: "channel", canalId }
    );
  };

  const handleOpenNewAgentTab = () => {
    ensureAndActivateTab(
      { id: "new-agent", titulo: "Novo agente", shape: "rounded_square", color: "#38bdf8" },
      { type: "new_agent" }
    );
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setActiveSection("agentes");
    if (tabId === "new-agent") {
      setCenterMode({ type: "new_agent" });
    } else if (tabId.startsWith("channel:")) {
      setCenterMode({ type: "channel", canalId: tabId.slice("channel:".length) });
    } else if (tabId.startsWith("agent:")) {
      setCenterMode({ type: "agent", agenteId: tabId.slice("agent:".length) });
    }
  };

  const handleCloseTab = (tabId: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        const target = next[next.length - 1];
        setTimeout(() => handleSelectTab(target.id), 0);
      }
      return next;
    });
  };

  const stepHistoryTab = (delta: number) => {
    if (openTabs.length <= 1) return;
    const idx = openTabs.findIndex((t) => t.id === activeTabId);
    const nextIdx = (idx + delta + openTabs.length) % openTabs.length;
    handleSelectTab(openTabs[nextIdx].id);
  };

  const activeAgent = useMemo(() => {
    if (centerMode.type !== "agent") return null;
    return agentes.find((a) => a.agente_id === centerMode.agenteId) ?? agentes[0] ?? null;
  }, [agentes, centerMode]);

  const activeChannel = useMemo(() => {
    if (centerMode.type !== "channel") return null;
    return canais.find((c) => c.canal_id === centerMode.canalId) ?? null;
  }, [canais, centerMode]);

  const activeChatKey =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? activeSideThreadId
      : centerMode.type === "channel"
        ? centerMode.canalId
        : centerMode.type === "agent"
          ? `agente:${activeAgent?.agente_id ?? "estrategista"}`
          : "";

  const activeMessages = activeChatKey ? chatByKey[activeChatKey] ?? [] : [];

  const runningCount = useMemo(
    () => tarefas.filter((t) => t.status === "executando").length,
    [tarefas]
  );
  const pendingCount = useMemo(
    () => tarefas.filter((t) => t.status === "pendente").length,
    [tarefas]
  );
  const awaitingApprovalCount = useMemo(
    () => tarefas.filter((t) => t.status === "aguardando_aprovacao").length,
    [tarefas]
  );

  const previewTarefa = useMemo(
    () =>
      tarefas.find((t) => t.tarefa_id === selectedTaskId) ??
      tarefas.find((t) => t.status === "aguardando_aprovacao") ??
      tarefas[0] ??
      null,
    [tarefas, selectedTaskId]
  );

  const handleUploadFile = async (file: File): Promise<AnexoChat> => {
    const uploaded = await daemonApi.uploadFile(file, activeAgent?.agente_id ?? null);
    const refreshedFiles = await daemonApi.listFiles();
    setArquivos(refreshedFiles);
    return uploaded;
  };

  const handleSendChatMessage = async (conteudo: string, anexos: AnexoChat[]) => {
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

    // Mostra imediatamente a mensagem enviada e o feedback visual do agente trabalhando
    setChatByKey((prev) => ({
      ...prev,
      [targetKey]: mergeUniqueMessages(prev[targetKey] ?? [], [optimisticMsg]),
    }));
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

    setSendingChat(true);
    try {
      if (centerMode.type === "channel" && activeChannel) {
        const res = await daemonApi.sendChannelMessage(activeChannel.canal_id, conteudo, anexos);
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
        const res = await daemonApi.sendAgentMessage(activeAgent.agente_id, conteudo, anexos);
        setChatByKey((prev) => {
          const withoutTemp = (prev[targetKey] ?? []).filter((m) => m.mensagem_id !== optimisticId);
          return {
            ...prev,
            [targetKey]: mergeUniqueMessages(withoutTemp, [
              res.mensagem_usuario,
              res.mensagem_agente,
              ...(res.mensagens_handoff ?? []),
            ]),
          };
        });
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
      setLiveRunByChat((prev) => {
        if (!prev[targetKey]) return prev;
        const copy = { ...prev };
        delete copy[targetKey];
        return copy;
      });
      setSendingChat(false);
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
    const canal = await daemonApi.createChannel({
      nome: newChannelName.trim(),
      descricao: newChannelDesc.trim() || "Canal colaborativo de criação",
      membros_agentes:
        newChannelMembers.length > 0 ? newChannelMembers : ["estrategista", "copywriter"],
    });
    setCanais((prev) => [canal, ...prev]);
    setNewChannelName("");
    setNewChannelDesc("");
    setChannelModalOpen(false);
    handleSelectChannel(canal.canal_id);
  };

  const handleConnectViaBrowser = useCallback(
    async (prov: "gemini" | "claude" | "openai", label?: string) => {
      setPendingAuthLink(null);
      try {
        const res = await daemonApi.connectProviderViaBrowser(prov, label);
        if (res.ok && res.provedores) {
          setProvedores(res.provedores);
          if (res.uso) setUso(res.uso);
        }
        return { ok: Boolean(res.ok), canceled: Boolean(res.canceled), erro: res.erro };
      } finally {
        setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
      }
    },
    []
  );

  const handleCancelBrowserSignIn = useCallback(
    async (prov: "gemini" | "claude" | "openai") => {
      await daemonApi.cancelProviderBrowserSignIn(prov);
      setPendingAuthLink((cur) => (cur?.provedor === prov ? null : cur));
    },
    []
  );

  if (bootLoading) {
    return (
      <div className="min-h-screen w-full bg-[#141414] flex items-center justify-center text-[#979797] text-[13px]">
        Iniciando Criativo AI Studio...
      </div>
    );
  }

  // Etapa de Onboarding fiel às Screenshots 1 & 2 quando ainda não concluído
  if (onboarding && !onboarding.onboarding_concluido) {
    return (
      <OnboardingFlow
        initialState={onboarding}
        provedores={provedores}
        onConnectProvider={async (prov, key) => {
          await daemonApi.connectProvider(prov, key);
          setProvedores(await daemonApi.listProvidersStatus(false));
        }}
        onConnectProviderViaBrowser={handleConnectViaBrowser}
        onCancelProviderBrowserSignIn={handleCancelBrowserSignIn}
        pendingAuthUrl={pendingAuthLink}
        onComplete={async (patch) => {
          const updated = await daemonApi.updateOnboarding(patch);
          if (patch.marca_nome || patch.perfil_handle) {
            await daemonApi.saveBrandIdentity({
              marca_nome: patch.marca_nome,
              perfil_handle: patch.perfil_handle,
            });
          }
          setOnboarding(updated);
          setProvedores(await daemonApi.listProvidersStatus(false));
          setUso(await daemonApi.getProvidersUsage());
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0D0D0D] text-white flex">
      {/* Trilho estreito à esquerda (52px) */}
      <WorkspaceRail
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        quotaPercent={uso?.provedores?.[0]?.janelas?.[0]?.restante_percentual ?? 100}
        uso={uso}
        onRefreshUsage={async () => {
          const [provList, usageSnap] = await Promise.all([
            daemonApi.listProvidersStatus(true),
            daemonApi.getProvidersUsage(true),
          ]);
          setProvedores(provList);
          setUso(usageSnap);
        }}
        whatsappStatus={whatsappStatus}
        pendingCount={pendingCount + runningCount}
        onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
        onOpenSettings={() => setActiveSection("conexoes")}
        onOpenHelp={() => setHelpModalOpen(true)}
      />

      {/* Shell principal à direita do Rail */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <DynamicIsland
          wsConnected={wsConnected}
          runningCount={runningCount}
          pendingCount={pendingCount}
          awaitingApprovalCount={awaitingApprovalCount}
          whatsappStatus={whatsappStatus}
          onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
          onOpenVaultModal={() => setActiveSection("conexoes")}
          tabs={openTabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleOpenNewAgentTab}
          sidebarCollapsed={!sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((s) => !s)}
          onNavigateBack={() => stepHistoryTab(-1)}
          onNavigateForward={() => stepHistoryTab(1)}
        />

        {/* Área de conteúdo por seção da Rail */}
        <main className="flex-1 min-h-0 flex overflow-hidden">
          {activeSection === "agentes" && (
            <>
              {sidebarOpen && (
                <Sidebar
                  agentes={agentes}
                  canais={canais}
                  selectedAgentId={centerMode.type === "agent" ? activeAgent?.agente_id ?? null : null}
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
                />
              )}

              {centerMode.type === "new_agent" ? (
                <NewAgentScreen
                  provedores={provedores}
                  onCreateAgent={handleCreateCustomAgent}
                  onOpenConnectors={() => setActiveSection("conexoes")}
                />
              ) : (
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
                    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
                        mensagens={activeMessages}
                        provedores={provedores}
                        sending={sendingChat}
                        liveRun={activeChatKey ? liveRunByChat[activeChatKey] ?? null : null}
                        inspectorOpen={inspectorOpen}
                        onToggleInspector={() => setInspectorOpen((o) => !o)}
                        onSendMessage={async (conteudo, anexos) => {
                          setPrefilledChatPrompt(null);
                          await handleSendChatMessage(conteudo, anexos);
                        }}
                        onUploadFile={handleUploadFile}
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
                      />
                    </div>
                  )}

                  <div className="hidden xl:flex">
                    <RightInspectorPanel
                      open={inspectorOpen}
                      agente={activeAgent}
                      arquivos={arquivos}
                      canais={canais}
                      routineCount={
                        activeAgent ? routineCountsByAgent[activeAgent.agente_id] ?? 0 : 0
                      }
                      routineFocusSignal={routineInspectorSignal}
                      previewTarefa={previewTarefa}
                      onClose={() => setInspectorOpen(false)}
                      onOpenFilesPage={() => setActiveSection("arquivos")}
                      onOpenWhatsAppModal={() => setWhatsappModalOpen(true)}
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
                    />
                  </div>
                </>
              )}
            </>
          )}

          {activeSection === "fluxos" && (
            <WorkflowsCanvasPage
              workflows={workflows}
              agentes={agentes}
              uso={uso}
              onSaveWorkflow={async (wf) => {
                const saved = await daemonApi.saveWorkflow(wf);
                setWorkflows(await daemonApi.listWorkflows());
                return saved;
              }}
              onExecuteWorkflow={async (wfId) => {
                const res = await daemonApi.executeWorkflow(wfId);
                setTarefas(await daemonApi.listTasks());
                return res;
              }}
            />
          )}

          {activeSection === "tarefas" && (
            <TasksQueuePage
              tarefas={tarefas}
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
                  handleSelectAgent(ownerId);
                } else {
                  handleSelectChannel(ownerId);
                }
                setInspectorOpen(true);
                setRoutineInspectorSignal({
                  subView: "routines",
                  rotinaId,
                  nonce: Date.now(),
                });
              }}
              onOpenAgentChat={(agenteId) => {
                setSidebarViewMode("agents");
                handleSelectAgent(agenteId);
              }}
              onCreateFirstRoutine={(defaultAgentId) => {
                setSidebarViewMode("agents");
                handleSelectAgent(defaultAgentId);
                setInspectorOpen(true);
                setRoutineInspectorSignal({
                  subView: "routines",
                  rotinaId: "__new__",
                  nonce: Date.now(),
                });
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
              onChangeFilters={async (dias, agId) => {
                setUsoPeriodoDias(dias);
                setUsoAgenteFiltro(agId);
                setAnalyticsUso(await daemonApi.getUsageAnalytics({ dias, agente_id: agId }));
              }}
              onRefresh={async () => {
                const [provList, usageSnap, analyticsData] = await Promise.all([
                  daemonApi.listProvidersStatus(true),
                  daemonApi.getProvidersUsage(true),
                  daemonApi.getUsageAnalytics({ dias: usoPeriodoDias, agente_id: usoAgenteFiltro }),
                ]);
                setProvedores(provList);
                setUso(usageSnap);
                setAnalyticsUso(analyticsData);
              }}
            />
          )}

          {activeSection === "arquivos" && (
            <FilesVaultPage arquivos={arquivos} onUploadFile={handleUploadFile} />
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
              onTogglePool={async (prov, habilitado) => {
                const nextProvs = await daemonApi.setProviderPool(prov, { habilitado });
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
        </main>
      </div>

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

      {/* Modal Criar Canal em Equipe */}
      {channelModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Novo canal em equipe"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateChannelSubmit}
            className="w-full max-w-md rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white flex items-center gap-2">
                <Users className="h-4 w-4 text-[#31CF76]" />
                <span>Criar Canal em Equipe</span>
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
                Nome do Canal
              </label>
              <input
                id="new-channel-name"
                name="new_channel_name"
                aria-label="Nome do canal em equipe"
                required
                type="text"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="#lancamento-semanal"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[13px] text-white"
              />
            </div>

            <div>
              <label htmlFor="new-channel-desc" className="block text-[11.5px] text-[#979797] mb-1">
                Objetivo
              </label>
              <input
                id="new-channel-desc"
                name="new_channel_desc"
                aria-label="Objetivo do canal"
                type="text"
                value={newChannelDesc}
                onChange={(e) => setNewChannelDesc(e.target.value)}
                placeholder="Coordenar pauta, copy e carrosséis da semana"
                className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[13px] text-white"
              />
            </div>

            <div>
              <span className="block text-[11.5px] text-[#979797] mb-1.5">
                Agentes participantes ({newChannelMembers.length})
              </span>
              <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                {agentes.map((ag) => {
                  const checked = newChannelMembers.includes(ag.agente_id);
                  return (
                    <label
                      key={ag.agente_id}
                      htmlFor={`ch-member-${ag.agente_id}`}
                      className="flex items-center gap-2 rounded-lg bg-[#1A1A1A] px-2.5 py-1.5 text-[12px] text-white cursor-pointer"
                    >
                      <input
                        id={`ch-member-${ag.agente_id}`}
                        name={`member_${ag.agente_id}`}
                        aria-label={`Incluir ${ag.nome}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setNewChannelMembers((prev) =>
                            checked
                              ? prev.filter((id) => id !== ag.agente_id)
                              : [...prev, ag.agente_id]
                          )
                        }
                        className="accent-[#31CF76]"
                      />
                      <span className="truncate">{ag.nome}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setChannelModalOpen(false)}
                className="openbot-btn-secondary px-4 py-1.5 text-[12.5px]"
              >
                Cancelar
              </button>
              <button type="submit" className="openbot-btn-primary px-5 py-1.5 text-[12.5px]">
                Criar Canal
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
          aria-label="Ajuda e arquitetura Criativo AI Studio"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white">
                Criativo AI Studio Online — Guia Rápido
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
              <li>Use o trilho esquerdo para alternar entre <strong>Agentes</strong>, <strong>Fluxos Dot-Grid</strong>, <strong>Fila FIFO</strong>, <strong>Uso &amp; Cotas</strong>, <strong>Arquivos ImagePaths</strong> e <strong>Conexões</strong>.</li>
              <li>Nos chats, anexe fotos reais ou logos pelo botão <strong>+</strong>; designers usam modelos generativos de imagem nativamente e o Remotion gera Reels 9:16 MP4.</li>
              <li>Toda publicação Instagram passa por <strong>Aprovação Humana obrigatória</strong> no Cockpit ou via resposta &ldquo;1&rdquo; no WhatsApp pareado.</li>
            </ul>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="openbot-btn-primary px-4 py-1.5 text-[12.5px]"
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
                  Abrir agente
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
    </div>
  );
}
