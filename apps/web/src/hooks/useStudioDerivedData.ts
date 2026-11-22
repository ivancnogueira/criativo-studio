import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DynamicIsland, type StudioTabItem } from "../components/DynamicIsland";
import {
  inferTaskContextFromActivity,
  MascoteAvatar,
  resolveAgentAvatarConfig,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "../components/MascoteAvatar";
import {
  AgentConversationView,
  type ChatLiveRunState,
  type McpSignInCardState,
} from "../features/chat/AgentConversationView";
import { getThreadLaneKey, type AgenteEnriquecido , getAgentAvatar } from "../utils/studio-storage";
import type { StudioAppState } from "./useStudioState";

export function useStudioDerivedData(state: StudioAppState) {
  const {
    centerMode,
    agentes,
    canais,
    tarefas,
    selectedTaskId,
    steps,
    chatByKey,
    liveRunByChat,
    openTabs,
    activeTabId,
    activeSideThreadId,
    threadsByAgent,
    allThreads,
    threadChatById,
    threadPaginationById,
    liveRunByThread,
    queueByLane,
    activeThreadIdByAgent,
    editingQueueByLane,
    takeoverByAgent,
  } = state;

  const activeAgent = useMemo(() => {
    if (centerMode.type !== "agent" && centerMode.type !== "thread") return null;
    return agentes.find((a) => a.agente_id === centerMode.agenteId) ?? agentes[0] ?? null;
  }, [agentes, centerMode]);

  const activeChannel = useMemo(() => {
    if (centerMode.type !== "channel") return null;
    return canais.find((c) => c.canal_id === centerMode.canalId) ?? null;
  }, [canais, centerMode]);

  const activeThread = useMemo(() => {
    if (!activeAgent) return null;
    const threadId =
      centerMode.type === "thread"
        ? centerMode.threadId
        : activeThreadIdByAgent[activeAgent.agente_id] ?? null;
    if (!threadId || threadId.startsWith("main:")) return null;
    return (
      threadsByAgent[activeAgent.agente_id]?.threads.find((t) => t.thread_id === threadId) ??
      allThreads.find((t) => t.thread_id === threadId) ??
      null
    );
  }, [activeAgent, activeThreadIdByAgent, allThreads, centerMode, threadsByAgent]);

  const activeThreadKey =
    centerMode.type === "thread"
      ? centerMode.threadId
      : activeAgent
        ? `main:${activeAgent.agente_id}`
        : "";

  const workingAgentIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const [key, run] of Object.entries(liveRunByChat)) {
      if (run?.agenteId) ids.add(run.agenteId);
      if (key.startsWith("agente:")) ids.add(key.slice("agente:".length));
    }
    for (const [thId, run] of Object.entries(liveRunByThread)) {
      if (run?.agenteId) {
        ids.add(run.agenteId);
        continue;
      }
      const matched = allThreads.find((t) => t.thread_id === thId);
      if (matched?.agente_id) ids.add(matched.agente_id);
    }
    for (const ag of agentes) {
      if (ag.status === "trabalhando") ids.add(ag.agente_id);
    }
    return ids;
  }, [agentes, allThreads, liveRunByChat, liveRunByThread]);

  const agentActivityByAgentId = useMemo<
    Record<string, { mood: MascotEyeMood; activity: AvatarTaskContext }>
  >(() => {
    const out: Record<string, { mood: MascotEyeMood; activity: AvatarTaskContext }> = {};

    for (const ag of agentes) {
      const id = ag.agente_id;
      const runFromChat = liveRunByChat[`agente:${id}`];
      const threadEntry = Object.entries(liveRunByThread).find(([thId, r]) => {
        if (r?.agenteId === id) return true;
        return allThreads.some((t) => t.thread_id === thId && t.agente_id === id);
      });
      const activeRun = runFromChat ?? threadEntry?.[1] ?? null;
      const awaitingTakeover = Boolean(takeoverByAgent[id]);

      const agentTasks = tarefas.filter((t) => t.agente_id === id);
      const runningTask = agentTasks.find((t) => t.status === "executando");
      const waitingTask = agentTasks.find((t) => t.status === "aguardando_aprovacao");
      const recentFailedTask = agentTasks.find((t) => t.status === "falha");

      const isWorking = workingAgentIds.has(id);
      const lastStep = activeRun?.steps?.[activeRun.steps.length - 1];

      let mood: MascotEyeMood = "idle";
      if (recentFailedTask && !isWorking && !activeRun) {
        mood = "failed";
      } else if (awaitingTakeover || waitingTask) {
        mood = "waiting";
      } else if (isWorking || activeRun || runningTask) {
        mood = "working";
      }

      const activity = inferTaskContextFromActivity({
        mood,
        toolName: lastStep?.ferramenta ?? null,
        statusText:
          activeRun?.statusText ??
          lastStep?.titulo ??
          runningTask?.titulo ??
          recentFailedTask?.titulo ??
          null,
        isStreaming: Boolean(activeRun?.streamingText),
        awaitingApproval: awaitingTakeover || Boolean(waitingTask),
        agentStatus: ag.status,
      });

      out[id] = { mood, activity };
    }

    return out;
  }, [agentes, allThreads, liveRunByChat, liveRunByThread, takeoverByAgent, tarefas, workingAgentIds]);

  const dynamicIslandTabs = useMemo<StudioTabItem[]>(() => {
    if (centerMode.type === "channel") {
      const ch = activeChannel;
      return [
        {
          id: `channel:${centerMode.canalId}`,
          titulo: ch?.nome ?? centerMode.canalId,
          kind: "agent",
          closable: false,
          shape: "rounded_square",
          color: "#31cf76",
        },
      ];
    }

    if (centerMode.type === "new_agent") {
      return [
        {
          id: "new-agent",
          titulo: "Novo agente",
          kind: "agent",
          closable: false,
          shape: "rounded_square",
          color: "#38bdf8",
        },
      ];
    }

    const ag = activeAgent;
    if (!ag) return [];
    const vis = getAgentAvatar(ag);
    const live = agentActivityByAgentId[ag.agente_id];
    const agentTab: StudioTabItem = {
      id: `agent:${ag.agente_id}`,
      titulo: ag.nome,
      kind: "agent",
      closable: false,
      style: vis.style,
      shape: vis.shape,
      variant: vis.variant,
      color: vis.color,
      imageUrl: vis.imageUrl,
      working: workingAgentIds.has(ag.agente_id),
      mood: live?.mood,
      activity: live?.activity,
    };

    const agentThreads = (threadsByAgent[ag.agente_id]?.threads ?? allThreads.filter((t) => t.agente_id === ag.agente_id)).filter(
      (t) => !t.arquivada_em
    );

    const topicTabs: StudioTabItem[] = agentThreads.map((th) => {
      const customTab = openTabs.find((o) => o.id === `thread:${ag.agente_id}:${th.thread_id}`);
      const isWorking =
        Boolean(liveRunByThread[th.thread_id]) ||
        th.estado === "executando" ||
        th.turno_ativo_id !== null;
      return {
        id: `thread:${ag.agente_id}:${th.thread_id}`,
        titulo: customTab?.titulo || th.titulo || "Nova Subconversa",
        kind: "topic",
        closable: true,
        shape: vis.shape,
        color: vis.color,
        working: isWorking,
      };
    });

    return [agentTab, ...topicTabs];
  }, [
    activeAgent,
    activeChannel,
    agentActivityByAgentId,
    allThreads,
    centerMode,
    liveRunByThread,
    openTabs,
    threadsByAgent,
    workingAgentIds,
  ]);

  const headerActiveTabId = useMemo(() => {
    if (centerMode.type === "thread") {
      return `thread:${centerMode.agenteId}:${centerMode.threadId}`;
    }
    if (centerMode.type === "agent") {
      return `agent:${activeAgent?.agente_id ?? centerMode.agenteId}`;
    }
    if (centerMode.type === "channel") {
      return `channel:${centerMode.canalId}`;
    }
    if (centerMode.type === "new_agent") {
      return "new-agent";
    }
    return activeTabId;
  }, [activeAgent, activeTabId, centerMode]);

  const activeChatKey =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? activeSideThreadId
      : centerMode.type === "thread"
        ? `thread:${centerMode.threadId}`
        : centerMode.type === "channel"
          ? centerMode.canalId
          : centerMode.type === "agent"
            ? `agente:${activeAgent?.agente_id ?? "estrategista"}`
            : "";

  const activeMessages =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? chatByKey[activeSideThreadId] ?? []
      : centerMode.type === "thread"
        ? threadChatById[centerMode.threadId] ?? []
        : activeChatKey
          ? chatByKey[activeChatKey] ?? []
          : [];

  const activeLiveRun: ChatLiveRunState | null =
    activeSideThreadId && activeSideThreadId.startsWith("rotina:")
      ? liveRunByChat[activeSideThreadId] ?? null
      : centerMode.type === "thread"
        ? liveRunByThread[centerMode.threadId] ?? null
        : activeChatKey
          ? liveRunByChat[activeChatKey] ?? null
          : null;

  const activePaginationState = activeThreadKey ? threadPaginationById[activeThreadKey] : undefined;
  const activeLaneThreadId = centerMode.type === "thread" ? centerMode.threadId : null;
  const activeLaneKeyStr = activeAgent ? getThreadLaneKey(activeAgent.agente_id, activeLaneThreadId) : "";
  const activeQueueSnapshot = activeLaneKeyStr ? queueByLane[activeLaneKeyStr] ?? null : null;
  const activeEditingEntry = activeLaneKeyStr ? editingQueueByLane[activeLaneKeyStr] ?? null : null;

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

  return {
    activeAgent,
    activeChannel,
    activeThread,
    activeThreadKey,
    workingAgentIds,
    agentActivityByAgentId,
    dynamicIslandTabs,
    headerActiveTabId,
    activeChatKey,
    activeMessages,
    activeLiveRun,
    activePaginationState,
    activeLaneThreadId,
    activeLaneKeyStr,
    activeQueueSnapshot,
    activeEditingEntry,
    runningCount,
    pendingCount,
    awaitingApprovalCount,
    previewTarefa
  };
}

export type StudioDerivedData = ReturnType<typeof useStudioDerivedData>;
