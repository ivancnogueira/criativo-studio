import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WhatsAppArchiveService,
  WhatsAppMediaService,
  WhatsAppOrchestrator,
  WhatsAppSenderRules,
  WhatsAppSessionManager,
  type AuthorizedWhatsAppMessageEvent,
  type WhatsAppApprovalNotifier,
  type SocketFactory,
} from "@criativo/whatsapp";
import { formatMarkdownForWhatsApp } from "../whatsapp/whatsapp-formatter.ts";
import { executeAgentConversationTurn, tryHandleStudioRoute } from "./studio-routes.ts";
import { QueueControlsService } from "../queue/queue-controls-service.ts";
import { handleBackgroundJobCompletionWakeup } from "../waits/background-job-wakeup-handler.ts";
import type { DaemonServerOptions } from "./daemon-http-utils.ts";
import type { DaemonInfraServices } from "./daemon-infra-services.ts";
import type { DaemonRuntimeServices } from "./daemon-runtime-services.ts";

export function createDaemonLaneScheduler(
  options: DaemonServerOptions,
  infra: DaemonInfraServices,
  rt: DaemonRuntimeServices
) {
  const {
    db,
    queue,
    wsHub,
    whatsappManager,
    whatsappArchiveService,
    sharedTables,
    memoryManager,
    skillLearning,
    historySearch,
    libraryFolders,
    handoffBus,
    visualPreview,
    uiBlockRegistry,
    apiKeysBridge,
    threadStore,
    waitsService,
    wakeupService,
    backgroundJobService,
    queueStore,
    tasksService,
    queueControls,
    approvalNotifier,
    phase13Bundle,
  } = infra;
  const {
    activeExecutor,
    routineStore,
    routineFlowStore,
    routineExecutionService,
    routineFlowsEngine,
    memoryReview,
    phase14Services,
    baseStudioDepsForLanes,
  } = rt;

  let workerTimer: NodeJS.Timeout | null = null;
  const MAX_CONCURRENT_LANE_TURNS = 8;
  const activeFifoTaskIds = new Set<string>();
  const activeLaneKeys = new Set<string>();
  const activeTurnsByAgent = new Map<string, number>();

  const incrementAgentTurn = (agenteId: string): number => {
    const next = (activeTurnsByAgent.get(agenteId) ?? 0) + 1;
    activeTurnsByAgent.set(agenteId, next);
    return next;
  };

  const decrementAgentTurn = (agenteId: string): void => {
    const cur = activeTurnsByAgent.get(agenteId) ?? 0;
    if (cur <= 1) activeTurnsByAgent.delete(agenteId);
    else activeTurnsByAgent.set(agenteId, cur - 1);
  };

  const scheduleLaneDrain = (agenteId: string, threadId: string | null): void => {
    void drainChatLane(agenteId, threadId);
  };

  wakeupService.setOnFire(async (wakeup) => {
    const agente = db.connection
      .prepare(
        `SELECT agente_id, nome, papel, modelo_padrao, config_json, backup_models_json
         FROM projecao_agentes
         WHERE agente_id = ?
         LIMIT 1;`,
      )
      .get(wakeup.agente_id) as
      | {
          agente_id: string;
          nome: string;
          papel: string;
          modelo_padrao: string;
          config_json: string;
          backup_models_json?: string | null;
        }
      | undefined;
    if (!agente) return;

    const wakeupPrompt = `[WAKEUP AUTOMÁTICO #${wakeup.iteracao_atual}/${wakeup.max_iteracoes} — ID: ${wakeup.wakeup_id}]\n${wakeup.instrucao}\n(Se o objetivo do ciclo já foi concluído, invoque cancel_wakeup("${wakeup.wakeup_id}") antes de responder ao usuário.)`;

    const { agentMsg } = await executeAgentConversationTurn({
      deps: {
        ...baseStudioDepsForLanes,
        phase13: phase13Bundle,
        sharedTables,
        memoryManager,
        memoryReview,
        skillLearning,
        historySearch,
        libraryFolders,
        handoffBus,
        visualPreview,
        uiBlockRegistry,
        apiKeysBridge,
        phase14: phase14Services,
      },
      agente,
      userPrompt: wakeupPrompt,
      threadId: wakeup.thread_id,
      turnoId: `wk-${randomUUID().slice(0, 8)}`,
      channelOrigin: wakeup.channel_origin,
      whatsappContaId: wakeup.whatsapp_conta_id,
      whatsappChatJid: wakeup.whatsapp_chat_jid,
      extraMetadados: {
        origem: "wakeup",
        wakeup_id: wakeup.wakeup_id,
        iteracao: wakeup.iteracao_atual,
      },
    });

    const replyText = agentMsg.conteudo_markdown?.trim();
    if (
      wakeup.channel_origin === "whatsapp" &&
      wakeup.whatsapp_chat_jid &&
      replyText
    ) {
      const targetContaId = wakeup.whatsapp_conta_id || DEFAULT_WHATSAPP_ACCOUNT_ID;
      const client = whatsappManager.getClient(targetContaId);
      if (client) {
        const chunks = formatMarkdownForWhatsApp(replyText, {
          maxChunkLength: 1600,
          maxChunks: 4,
        });
        for (const chunk of chunks) {
          try {
            const sent = await client.sendMessage(wakeup.whatsapp_chat_jid, { text: chunk });
            const recorded = whatsappArchiveService.recordMessage({
              mensagemId: sent.messageId,
              contaId: targetContaId,
              chatJid: wakeup.whatsapp_chat_jid,
              remetenteJid: wakeup.whatsapp_chat_jid,
              remetenteNome: agente.nome,
              direcao: "saida",
              tipoConteudo: "texto",
              texto: chunk,
              ehGrupo: wakeup.whatsapp_chat_jid.endsWith("@g.us"),
              ackStatus: sent.ackStatus === "ack" ? "entregue" : "enviado",
              metadados: { agente_id: agente.agente_id, wakeup_id: wakeup.wakeup_id },
            });
            wsHub.broadcast("whatsapp.mensagem_recebida", {
              conta_id: targetContaId,
              mensagem: recorded,
            });
          } catch {
            // Falha isolada de envio no canal não interrompe loop de wakeup
          }
        }
      }
    }
  });

  backgroundJobService.setOnComplete(async (job) => {
    await handleBackgroundJobCompletionWakeup({
      job,
      db,
      wsHub,
      queueControls,
      whatsappManager,
      whatsappArchiveService,
      executeTurn: (args) =>
        executeAgentConversationTurn({
          deps: {
            ...baseStudioDepsForLanes,
            phase13: phase13Bundle,
            sharedTables,
            memoryManager,
            memoryReview,
            skillLearning,
            historySearch,
            libraryFolders,
            handoffBus,
            visualPreview,
            uiBlockRegistry,
            apiKeysBridge,
            phase14: phase14Services,
          },
          ...args,
        }),
    });
  });

  tasksService.setOnLaneWake(scheduleLaneDrain);
  queueControls.setOnLaneWake(scheduleLaneDrain);

  /**
   * LaneDrainScheduler: drena entregas de chat/sub-thread por lane `(agente_id, thread_id)`
   * respeitando o limite de concorrência do agente, lock `editando = 1` e `AbortController` isolado.
   */
  const drainChatLane = async (agenteId: string, threadId: string | null): Promise<void> => {
    const normalizedThread = threadId && !threadId.startsWith("main:") ? threadId : null;
    const laneKey = QueueControlsService.buildLaneKey(agenteId, normalizedThread);
    if (activeLaneKeys.has(laneKey) || queueControls.hasActiveTurn(agenteId, normalizedThread)) return;

    const totalRunning = activeLaneKeys.size + activeFifoTaskIds.size;
    if (totalRunning >= MAX_CONCURRENT_LANE_TURNS) return;

    const agentLimit = tasksService.getConcurrencyLimit(agenteId);
    const agentRunning = activeTurnsByAgent.get(agenteId) ?? 0;
    if (agentRunning >= agentLimit) {
      if (normalizedThread) {
        threadStore.updateRuntimeState(normalizedThread, {
          estado: "enfileirada",
          progresso_atual:
            agentLimit === 1
              ? "Aguardando turno atual (um turno por vez)"
              : `Aguardando vaga paralela (${agentRunning}/${agentLimit})`,
        });
        tasksService.emitAgentSnapshot(agenteId);
      }
      return;
    }

    const delivery = queueStore.dequeueNextForLane(agenteId, normalizedThread);
    if (!delivery) return;

    const threadKey = normalizedThread ?? `main:${agenteId}`;
    const turnoId = `turn-${randomUUID().slice(0, 8)}`;
    const abortCtrl = tasksService.registerTurnAbort(threadKey, turnoId);
    activeLaneKeys.add(laneKey);
    incrementAgentTurn(agenteId);
    queueControls.registerActiveTurn({
      agenteId,
      threadId: normalizedThread,
      turnoId,
      deliveries: [delivery],
      abortController: abortCtrl,
    });
    queueStore.markRunning(delivery.entrega_id, turnoId);

    if (normalizedThread) {
      const th = threadStore.getThread(normalizedThread);
      threadStore.updateRuntimeState(normalizedThread, {
        estado: "executando",
        turno_ativo_id: turnoId,
        progresso_atual: "Executando resposta na thread paralela...",
      });
      if (th?.tarefa_id) {
        const tk = queue.getTask(th.tarefa_id);
        if (tk && tk.status === "pendente") {
          queue.updateTaskStatus(th.tarefa_id, "executando");
        }
      }
      tasksService.emitAgentSnapshot(agenteId);
    }
    queueControls.emitQueueChanged(agenteId, normalizedThread);

    try {
      const agente = db.connection
        .prepare("SELECT * FROM projecao_agentes WHERE agente_id = ?;")
        .get(agenteId) as
        | {
            agente_id: string;
            nome: string;
            papel: string;
            modelo_padrao: string;
            config_json: string;
          }
        | undefined;

      if (!agente) {
        queueStore.markFinished(delivery.entrega_id, "falha", `Agente '${agenteId}' não encontrado.`);
        return;
      }

      const wakePromptBlock =
        delivery.remetente_tipo === "rotina"
          ? waitsService.wakeForRun({
              agenteId,
              rotinaId: delivery.rotina_id ?? null,
              entregaDespertarId: delivery.entrega_id,
            }).promptBlock
          : null;

      const { agentMsg } = await executeAgentConversationTurn({
        deps: { ...baseStudioDepsForLanes, phase13: phase13Bundle },
        agente,
        userPrompt: delivery.conteudo_markdown,
        anexos: delivery.anexos,
        threadId: threadKey,
        turnoId,
        signal: abortCtrl.signal,
        wokenWaitsBlock: wakePromptBlock,
        entregaOrigemId: delivery.entrega_id,
        isRoutine: delivery.remetente_tipo === "rotina",
        respostaParaMensagemId: delivery.resposta_para_mensagem_id ?? delivery.mensagem_id,
      });

      queueStore.markFinished(delivery.entrega_id, "concluida");

      if (normalizedThread) {
        const th = threadStore.getThread(normalizedThread);
        threadStore.updateRuntimeState(normalizedThread, {
          estado: "ociosa",
          desfecho: "concluida",
          erro: null,
          turno_ativo_id: null,
          progresso_atual: "Concluída",
        });
        if (th?.tarefa_id) {
          queue.updateTaskStatus(th.tarefa_id, "concluido", {
            texto: agentMsg.conteudo_markdown,
            thread_id: normalizedThread,
          });
        }
      }
    } catch (error) {
      const isAbort =
        abortCtrl.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      const msg = error instanceof Error ? error.message : String(error);
      queueStore.markFinished(delivery.entrega_id, isAbort ? "interrompida" : "falha", msg);

      if (normalizedThread) {
        const th = threadStore.getThread(normalizedThread);
        threadStore.updateRuntimeState(normalizedThread, {
          estado: "ociosa",
          desfecho: isAbort ? "interrompida" : "falha",
          erro: isAbort ? null : msg,
          turno_ativo_id: null,
          progresso_atual: isAbort ? "Interrompida" : msg.slice(0, 140),
        });
        if (th?.tarefa_id) {
          if (isAbort) {
            queue.cancelTask(th.tarefa_id, msg);
          } else {
            queue.updateTaskStatus(th.tarefa_id, "falha", null, msg);
          }
        }
      }
    } finally {
      activeLaneKeys.delete(laneKey);
      decrementAgentTurn(agenteId);
      queueControls.clearActiveTurn(agenteId, normalizedThread, turnoId);
      tasksService.clearTurnAbort(threadKey, turnoId);
      queueControls.emitQueueChanged(agenteId, normalizedThread);
      if (normalizedThread) {
        tasksService.emitAgentSnapshot(agenteId);
      }
      queueMicrotask(() => {
        void drainChatLane(agenteId, normalizedThread);
      });
    }
  };

  const processNextQueuedTask = async (): Promise<void> => {
    if (activeLaneKeys.size + activeFifoTaskIds.size >= MAX_CONCURRENT_LANE_TURNS) return;
    const nextTask = queue.dequeueNextTask();
    if (!nextTask) return;

    const targetAgentId = nextTask.agente_id ?? "estrategista";
    activeFifoTaskIds.add(nextTask.tarefa_id);
    incrementAgentTurn(targetAgentId);

    const payloadRec = (nextTask.payload ?? {}) as Record<string, unknown>;
    if (
      typeof payloadRec.rotina_id === "string" &&
      typeof payloadRec.woken_waits_block !== "string"
    ) {
      const wakeRes = waitsService.wakeForRun({
        agenteId: targetAgentId,
        rotinaId: payloadRec.rotina_id,
        entregaDespertarId: nextTask.tarefa_id,
        webhookPayload: payloadRec,
      });
      if (wakeRes.promptBlock) {
        nextTask.payload = {
          ...payloadRec,
          woken_waits_block: wakeRes.promptBlock,
          woken_wait_ids: wakeRes.woken.map((w) => w.espera_id),
        };
      }
    }

    wsHub.broadcast("task:started", {
      tarefa_id: nextTask.tarefa_id,
      agente_id: targetAgentId,
    });

    try {
      const execucaoId =
        typeof nextTask.payload?.rotina_execucao_id === "string"
          ? nextTask.payload.rotina_execucao_id
          : null;
      if (options.taskExecutor && execucaoId) {
        routineExecutionService.markExecutionRunning(execucaoId);
      }

      await activeExecutor.execute(nextTask);
      const refreshedTask = queue.getTask(nextTask.tarefa_id);

      if (options.taskExecutor && refreshedTask) {
        if (execucaoId) {
          const currentExec = routineStore.getRun(execucaoId);
          if (currentExec && (currentExec.status === "queued" || currentExec.status === "running")) {
            const outText =
              typeof refreshedTask.resultado?.texto === "string"
                ? refreshedTask.resultado.texto
                : typeof refreshedTask.resultado?.resumo === "string"
                  ? refreshedTask.resultado.resumo
                  : JSON.stringify(refreshedTask.resultado ?? {});
            const failureMsg =
              refreshedTask.status === "falha"
                ? refreshedTask.erro_detalhes ?? "Falha na execução da tarefa."
                : null;
            await routineExecutionService.completeRoutineTaskExecution({
              execucaoId,
              finalText: outText,
              artifacts: [],
              noUpdateCalled: false,
              failureReason: failureMsg,
              erro: failureMsg,
            });
          }
        }
        const flowStepId =
          typeof nextTask.payload?.routine_flow_step_id === "string"
            ? nextTask.payload.routine_flow_step_id
            : null;
        if (flowStepId) {
          const currentStep = routineFlowStore.getStepByTaskId(nextTask.tarefa_id);
          if (currentStep && currentStep.status === "running") {
            const stepStatus =
              refreshedTask.status === "falha"
                ? "failed"
                : refreshedTask.status === "cancelado"
                  ? "cancelled"
                  : "succeeded";
            const outText =
              typeof refreshedTask.resultado?.texto === "string"
                ? refreshedTask.resultado.texto
                : typeof refreshedTask.resultado?.resumo === "string"
                  ? refreshedTask.resultado.resumo
                  : null;
            await routineFlowsEngine.onFlowStepTaskSettled({
              stepId: flowStepId,
              status: stepStatus,
              output: outText,
              erro: refreshedTask.status === "falha" ? refreshedTask.erro_detalhes : null,
            });
          }
        }
      }
      const targetJid =
        typeof nextTask.payload?.remetente_jid === "string"
          ? nextTask.payload.remetente_jid
          : null;
      if (
        refreshedTask &&
        refreshedTask.status === "aguardando_aprovacao" &&
        nextTask.canal_origem === "whatsapp" &&
        targetJid
      ) {
        const previews = Array.isArray(refreshedTask.resultado?.previews)
          ? (refreshedTask.resultado.previews.filter(
              (item): item is string => typeof item === "string"
            ))
          : [];
        const copy =
          typeof refreshedTask.resultado?.copy === "string"
            ? refreshedTask.resultado.copy
            : "";
        await approvalNotifier.notifyReadyForApproval({
          tarefa_id: refreshedTask.tarefa_id,
          tipo: refreshedTask.tipo,
          previews,
          copy,
          targetJid,
        });
      }
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error);
      queue.updateTaskStatus(nextTask.tarefa_id, "falha", null, mensagem);
      wsHub.broadcast("task:failed", {
        tarefa_id: nextTask.tarefa_id,
        erro: mensagem,
        pode_retentar: true,
      });
    } finally {
      activeFifoTaskIds.delete(nextTask.tarefa_id);
      decrementAgentTurn(targetAgentId);
    }
  };

  const drainAllPendingLanes = async (): Promise<void> => {
    const pendingLanes = db.connection
      .prepare(
        `
        SELECT DISTINCT agente_id, thread_id
        FROM projecao_fila_chat
        WHERE status = 'enfileirada' AND editando = 0
        LIMIT 16;
      `,
      )
      .all() as Array<{ agente_id: string; thread_id: string | null }>;

    await Promise.all([
      processNextQueuedTask(),
      ...pendingLanes.map((lane) => drainChatLane(lane.agente_id, lane.thread_id)),
    ]);
  };

  return {
    drainChatLane,
    scheduleLaneDrain,
    processNextQueuedTask,
    drainAllPendingLanes,
    isInteractiveSlotBusy: () => activeLaneKeys.size > 0 || activeFifoTaskIds.size > 0,
    isAgentBusy: (agId: string) => {
      const busy =
        (activeTurnsByAgent.get(agId) ?? 0) > 0 || queueControls.isLaneBusy(agId, null);
      const snap = queueControls.getLaneSnapshot(agId, null);
      return { busy, policy: snap.modo_ocupado };
    },
  };
}
