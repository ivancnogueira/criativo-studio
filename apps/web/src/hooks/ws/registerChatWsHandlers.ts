import {
  daemonApi,
  getActiveServerId,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  WebSocketClient,
} from "../../services/websocket-client";
import { getThreadLaneKey, mergeUniqueMessages, type AgenteEnriquecido } from "../../utils/studio-storage";
import type { StudioAppState } from "../useStudioState";
import type { StudioBootstrapActions } from "../useStudioBootstrap";

export function registerChatWsHandlers(
  ws: WebSocketClient,
  state: StudioAppState,
  boot: StudioBootstrapActions
): () => void {
  const {
    agentes,
    setAgentes,
    setTarefas,
    setWorkflows,
    setWorkflowEventSignal,
    setProvedores,
    setUso,
    setHabilidades,
    setConectores,
    setSelectedTaskId,
    steps,
    setSteps,
    setThoughtStream,
    setWsConnected,
    setWhatsappStatus,
    setWhatsappQr,
    setWhatsappAccounts,
    setPendingMcpSignIn,
    setChatByKey,
    setLiveRunByChat,
    setPendingAuthLink,
    setRoutinesRefreshNonce,
    setFlowRefreshNonce,
    setRoutineNotifications,
    setThreadsByAgent,
    setAllThreads,
    setThreadChatById,
    setLiveRunByThread,
    setWaitsByAgent,
    setQueueByLane,
    setPinsByAgent,
    desktopAssistedProviderRef,
  } = state;
  const { hydrateAll, refreshRoutineCounts } = boot;

    const unsubConn = ws.onConnectionChange((connected, reconnected) => {
      setWsConnected(connected);
      if (connected && reconnected) {
        void hydrateAll();
      }
    });

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
      if (evt.mensagem.thread_id && !evt.mensagem.thread_id.startsWith("main:")) {
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
        const matchedAgentName =
          agentes.find((a) => a.agente_id === evt.agente_id)?.nome ?? "Agente";
        const prevRun = prev[evt.canal_id];
        const agentChanged = Boolean(
          prevRun && evt.agente_id && prevRun.agenteId && prevRun.agenteId !== evt.agente_id
        );
        const existing = prevRun ?? {
          agenteId: evt.agente_id,
          agenteNome: matchedAgentName,
          startedAt: Date.now(),
          statusText: evt.mensagem_status ?? "Processando...",
          steps: [],
          streamingText: "",
        };
        const baseSteps = agentChanged ? [] : existing.steps;
        let nextSteps = baseSteps;
        if (evt.step) {
          const step = evt.step;
          const idx = baseSteps.findIndex((s) => s.id === step.id);
          if (idx >= 0) {
            nextSteps = baseSteps.map((s, sIdx) => (sIdx === idx ? step : s));
          } else {
            nextSteps = [...baseSteps, step];
          }
        }
        return {
          ...prev,
          [evt.canal_id]: {
            ...existing,
            agenteId: evt.agente_id ?? existing.agenteId,
            agenteNome: evt.agente_id ? matchedAgentName : existing.agenteNome,
            statusText: evt.mensagem_status ?? existing.statusText,
            steps: nextSteps,
            streamingText: agentChanged
              ? evt.delta ?? ""
              : evt.delta
                ? existing.streamingText + evt.delta
                : existing.streamingText,
          },
        };
      });
    });
    const unsubProv = ws.on("provider:updated", () => {
      void daemonApi.listProvidersStatus(false).then(setProvedores).catch(() => {});
      void daemonApi.getProvidersUsage(false).then(setUso).catch(() => {});
    });
    const unsubAuthUrl = ws.on("provider:auth_url", (evt) => {
      setPendingAuthLink(evt);
      void (async () => {
        const currentServerId = getActiveServerId();
        if (
          currentServerId &&
          currentServerId !== "primary" &&
          (evt.provedor === "openai" || evt.provedor === "claude") &&
          desktopAssistedProviderRef.current !== evt.provedor
        ) {
          await daemonApi
            .prepararPonteOAuthRemoto(currentServerId, evt.provedor, evt.url)
            .catch(() => null);
        }
        try {
          if (typeof window !== "undefined") {
            window.open(evt.url, "_blank", "noopener,noreferrer");
          }
        } catch {
          // fallback visível pelo botão clicável direto na interface
        }
      })();
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

    const unsubWorkflowUpdated = ws.on("workflow:updated", (evt) => {
      void daemonApi.listWorkflows().then(setWorkflows).catch(() => {});
      setWorkflowEventSignal((prev) => ({
        nonce: prev.nonce + 1,
        workflowId: evt.workflow_id,
        type: "updated",
      }));
    });
    const unsubWorkflowRunUpdated = ws.on("workflow:run_updated", (evt) => {
      setWorkflowEventSignal((prev) => ({
        nonce: prev.nonce + 1,
        workflowId: evt.workflow_id,
        runId: evt.run_id,
        type: "run_updated",
      }));
    });
    const unsubWorkflowStepUpdated = ws.on("workflow:step_updated", (evt) => {
      setWorkflowEventSignal((prev) => ({
        nonce: prev.nonce + 1,
        workflowId: evt.workflow_id,
        runId: evt.run_id ?? undefined,
        type: "step_updated",
      }));
    });

    // Fase 13 — Eventos reativos isolados por thread/fila/espera/fixação/reset
    const unsubThreadsChanged = ws.on("threads:changed", (evt) => {
      setThreadsByAgent((prev) => ({ ...prev, [evt.agente_id]: evt.snapshot }));
      setAllThreads((prev) => {
        const others = prev.filter((t) => t.agente_id !== evt.agente_id);
        return [...others, ...evt.snapshot.threads].sort((a, b) =>
          b.atualizado_em.localeCompare(a.atualizado_em)
        );
      });
    });

    const unsubThreadMessage = ws.on("thread:message", (evt) => {
      setThreadChatById((prev) => {
        const cleaned = (prev[evt.thread_id] ?? []).filter(
          (m) =>
            !(
              m.mensagem_id.startsWith("temp-") &&
              m.autor === evt.mensagem.autor &&
              m.conteudo_markdown === evt.mensagem.conteudo_markdown
            )
        );
        return {
          ...prev,
          [evt.thread_id]: mergeUniqueMessages(cleaned, [evt.mensagem]),
        };
      });
      if (evt.mensagem.autor === "agente") {
        setLiveRunByThread((prev) => {
          if (!prev[evt.thread_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.thread_id];
          return copy;
        });
      }
    });

    const unsubThreadProgress = ws.on("thread:progress", (evt) => {
      setLiveRunByThread((prev) => {
        if (evt.fase === "concluido" || evt.fase === "erro") {
          if (!prev[evt.thread_id]) return prev;
          const copy = { ...prev };
          delete copy[evt.thread_id];
          return copy;
        }
        const existing = prev[evt.thread_id] ?? {
          agenteId: evt.agente_id,
          agenteNome: "Sub-tarefa",
          startedAt: Date.now(),
          statusText: evt.mensagem_status ?? "Executando em paralelo...",
          steps: [],
          streamingText: "",
        };
        let nextSteps = existing.steps;
        if (evt.step) {
          const step = evt.step;
          const idx = existing.steps.findIndex((s) => s.id === step.id);
          nextSteps =
            idx >= 0
              ? existing.steps.map((s, sIdx) => (sIdx === idx ? step : s))
              : [...existing.steps, step];
        }
        return {
          ...prev,
          [evt.thread_id]: {
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

    const unsubWaitsChanged = ws.on("waits:changed", (evt) => {
      setWaitsByAgent((prev) => ({ ...prev, [evt.agente_id]: evt.esperas }));
    });

    const unsubChatQueueChanged = ws.on("chat_queue:changed", (evt) => {
      setQueueByLane((prev) => ({
        ...prev,
        [getThreadLaneKey(evt.agente_id, evt.thread_id)]: evt.snapshot,
      }));
    });

    const unsubPinsChanged = ws.on("pins:changed", (evt) => {
      setPinsByAgent((prev) => ({ ...prev, [evt.agente_id]: evt.pins }));
    });

    const unsubContextReset = ws.on("context:reset", (evt) => {
      const key = `agente:${evt.agente_id}`;
      setChatByKey((prev) => ({
        ...prev,
        [key]: mergeUniqueMessages(prev[key] ?? [], [evt.mensagem_divisor]),
      }));
    });

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
    unsubWorkflowUpdated();
    unsubWorkflowRunUpdated();
    unsubWorkflowStepUpdated();
    unsubThreadsChanged();
    unsubThreadMessage();
    unsubThreadProgress();
    unsubWaitsChanged();
    unsubChatQueueChanged();
    unsubPinsChanged();
    unsubContextReset();
  };
}
