import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { CronScheduler } from "../routines/cron-scheduler.ts";
import { RoutineStore } from "../routines/routine-store.ts";
import { RoutineFlowStore } from "../routines/routine-flow-store.ts";
import { RoutineTimer } from "../routines/routine-timer.ts";
import { RoutineResultDispatcher } from "../routines/routine-result-dispatcher.ts";
import { RoutineExecutionService } from "../routines/routine-execution-service.ts";
import { WebhookRoutineService } from "../routines/webhook-routine-service.ts";
import { RoutineFlowsEngine } from "../routines/routine-flows-engine.ts";
import type { RoutineToolsDeps } from "../routines/routine-agent-tools.ts";
import { DiscordMessagingAdapter } from "../messaging/discord-adapter.ts";
import { MessagingService } from "../messaging/messaging-service.ts";
import { SlackMessagingAdapter } from "../messaging/slack-adapter.ts";
import { TelegramNotificationBot } from "../messaging/telegram-bot.ts";
import { BrowserAutofillService } from "../vault/browser-autofill-service.ts";
import { LoginVaultService } from "../vault/login-vault-service.ts";
import { PasswordManagerRegistry } from "../vault/password-managers/registry.ts";
import { TelemetryService } from "../telemetry/telemetry-service.ts";
import { TeamService } from "../team/team-service.ts";
import { InstanceTransferService } from "../servers/instance-transfer-service.ts";
import { CrmService } from "../crm/crm-service.ts";
import { VoiceHostService } from "../voice/voice-host-service.ts";
import { WorkflowEngine } from "../workflows/workflow-engine.ts";
import { WorkflowStore } from "../workflows/workflow-store.ts";
import { executeWorkflowToolCall } from "../workflows/workflow-tools.ts";
import { WorkflowTriggers } from "../workflows/workflow-triggers.ts";
import {
  CriativoStudioMcpBridge,
  INTERNAL_MCP_ROUTE_PATH,
} from "../mcp/studio-mcp-bridge.ts";
import { executeAgentConversationTurn, tryHandleStudioRoute } from "./studio-routes.ts";
import { MemoryReviewService } from "../engine/runner/memory-review-service.ts";
import type { Phase14ToolServices } from "./studio-tools-bridge.ts";
import { readJsonBody, readRawBody, sendJson, type DaemonServerOptions, type TaskExecutorHook } from "./daemon-http-utils.ts";
import type { DaemonInfraServices } from "./daemon-infra-services.ts";

export interface DaemonRuntimeLateState {
  isInteractiveSlotBusy: () => boolean;
  isAgentBusy: (agId: string) => { busy: boolean; policy: "queue" | "steer" };
}

export async function createDaemonRuntimeServices(
  options: DaemonServerOptions,
  infra: DaemonInfraServices,
  runtimeState: DaemonRuntimeLateState
) {
  const {
    studioPaths,
    resolvedWorkspaceRoot,
    db,
    queue,
    vault,
    wsHub,
    licenseService,
    remoteClaimService,
    providers,
    providerConnection,
    mcpGateway,
    mediaCatalog,
    skillsManager,
    catalogService,
    githubImporter,
    transcription,
    whatsappManager,
    whatsappOrchestrator,
    whatsapp,
    memoryManager,
    handoffBus,
    apiKeysBridge,
    sharedTables,
    skillLearning,
    historySearch,
    libraryFolders,
    visualPreview,
    uiBlockRegistry,
    browserService,
    screenCapture,
    showcaseService,
    backupResolver,
    connectorsWebhook,
    runner,
    waitsService,
    phase13Bundle,
  } = infra;

  const activeExecutor: TaskExecutorHook = options.taskExecutor ?? {
    execute: async (tarefa) => {
      await runner.runTask(tarefa);
    },
  };

  const cron = new CronScheduler(db, queue, (tarefaId, rotinaId) => {
    const tarefa = queue.getTask(tarefaId);
    if (tarefa) {
      const payloadRec = (tarefa.payload ?? {}) as Record<string, unknown>;
      const targetAg =
        tarefa.agente_id ??
        (typeof payloadRec.owner_id === "string"
          ? payloadRec.owner_id
          : typeof payloadRec.agente_id === "string"
            ? payloadRec.agente_id
            : "estrategista");
      const wakeRes = waitsService.wakeForRun({
        agenteId: targetAg,
        rotinaId: rotinaId ?? null,
        entregaDespertarId: tarefa.tarefa_id,
        webhookPayload: payloadRec,
      });
      if (wakeRes.promptBlock) {
        const nextPayload = {
          ...payloadRec,
          woken_waits_block: wakeRes.promptBlock,
          woken_wait_ids: wakeRes.woken.map((w) => w.espera_id),
        };
        db.connection
          .prepare("UPDATE projecao_tarefas SET payload_json = ? WHERE tarefa_id = ?;")
          .run(JSON.stringify(nextPayload), tarefa.tarefa_id);
      }

      wsHub.broadcast("task:queued", {
        tarefa_id: tarefa.tarefa_id,
        tipo: tarefa.tipo,
        titulo: tarefa.titulo,
        prioridade: tarefa.prioridade,
        canal_origem: tarefa.canal_origem,
      });
    }
  });

  const routineStore = new RoutineStore(db);
  const routineFlowStore = new RoutineFlowStore(db);
  const workflowStore = new WorkflowStore({ db, vault });
  let workflowEngineRef: WorkflowEngine | null = null;
  let messagingDepsReady = false;
  const messagingService = new MessagingService({
    db,
    agentExecutor: async ({ agentId, prompt, event }) => {
      if (!messagingDepsReady) {
        return "Serviço do estúdio ainda inicializando; tente novamente em instantes.";
      }
      const agRow = (db.connection
        .prepare("SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(agentId) ??
        db.connection
          .prepare("SELECT * FROM projecao_agentes WHERE agente_id = 'orquestrador_estrategista' LIMIT 1;")
          .get()) as
        | {
            agente_id: string;
            nome: string;
            papel: string;
            modelo_padrao: string;
            config_json: string;
          }
        | undefined;
      if (!agRow) {
        return "Nenhum agente configurado no estúdio para processar esta mensagem.";
      }
      const res = await executeAgentConversationTurn({
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
          messagingService,
          loginVault,
          passwordManagerRegistry,
          browserAutofillService,
        },
        agente: agRow,
        userPrompt: `[Canal externo ${event.platform} · ${event.senderName ?? event.senderId}]\n${prompt}`,
        threadId: `msg:${event.platform}:${event.channelId}:${event.threadId ?? "root"}`,
        turnoId: `msg-${randomUUID().slice(0, 8)}`,
        originalUserPrompt: prompt,
      });
      return res.agentMsg.conteudo_markdown;
    },
  });

  const slackAdapter = new SlackMessagingAdapter({
    connectorsWebhook,
    messagingService,
    fetchImpl: options.fetchImpl,
  });
  const discordAdapter = new DiscordMessagingAdapter({
    connectorsWebhook,
    messagingService,
    fetchImpl: options.fetchImpl,
  });
  connectorsWebhook.attachMessagingHandlers({
    onSlackEvent: (payload) => slackAdapter.handleVerifiedEventPayload(payload),
    onDiscordEvent: (payload) => discordAdapter.handleVerifiedInteractionOrMessage(payload),
  });

  const loginVault = new LoginVaultService(db, vault);
  const passwordManagerRegistry = new PasswordManagerRegistry();
  const telemetryService = new TelemetryService(db);
  const teamService = new TeamService(db);
  const instanceTransferService = new InstanceTransferService(db);
  const crmService = new CrmService(db);
  const voiceHostService = new VoiceHostService({ db });
  transcription.attachVoiceHost(voiceHostService);
  const browserAutofillService = new BrowserAutofillService({
    loginVault,
    passwordManagers: passwordManagerRegistry,
    browserService,
    wsHub,
  });

  const telegramBot = new TelegramNotificationBot({
    vault,
    fetchImpl: options.fetchImpl,
    messagingService,
    onApproveTask: async (tarefaId) => {
      if (options.onApproveAndPublishHook) {
        const tarefa = queue.getTask(tarefaId);
        if (tarefa) await options.onApproveAndPublishHook(tarefa);
      }
    },
    onWorkflowApproval: async (stepId, approved) => {
      if (workflowEngineRef) {
        await workflowEngineRef.decideStep(stepId, approved, "telegram");
      }
    },
  });
  const workflowEngine = new WorkflowEngine({
    db,
    store: workflowStore,
    queue,
    vault,
    providers,
    providerConnection,
    wsHub,
    whatsapp,
    telegramBot,
    workspaceRoot: resolvedWorkspaceRoot,
    fetchImpl: options.fetchImpl,
    mediaCatalog,
  });
  workflowEngineRef = workflowEngine;
  workflowEngine.setRunner(runner);
  runner.setWorkflowToolExecutor((name, args, ctx) =>
    executeWorkflowToolCall(name, args, {
      store: workflowStore,
      engine: workflowEngine,
      wsHub,
      agenteId: ctx.agenteId,
      requestSeed: ctx.tarefa.tarefa_id,
    })
  );
  const workflowTriggers = new WorkflowTriggers({
    db,
    store: workflowStore,
    engine: workflowEngine,
    vault,
  });

  const routineResultDispatcher = new RoutineResultDispatcher({
    db,
    routineStore,
    wsHub,
    vault,
    whatsapp,
    fetchImpl: options.fetchImpl,
  });
  const routineExecutionService = new RoutineExecutionService({
    db,
    queue,
    routineStore,
    dispatcher: routineResultDispatcher,
    wsHub,
    providerConnection,
  });
  const routineTimer = new RoutineTimer({
    getEarliestDue: () => {
      const rIso = routineStore.getEarliestNextRunAt();
      const wIso = workflowTriggers.nextDueAt();
      if (!rIso) return wIso ? new Date(wIso) : null;
      if (!wIso) return new Date(rIso);
      return Date.parse(rIso) <= Date.parse(wIso) ? new Date(rIso) : new Date(wIso);
    },
    onTick: async (now) => {
      await routineExecutionService.processDueRoutines(now);
      await workflowTriggers.processDue(now);
    },
  });
  const routineWebhookService = new WebhookRoutineService({
    routineStore,
    vault,
    executionService: routineExecutionService,
    wsHub,
  });
  const routineFlowsEngine = new RoutineFlowsEngine({
    db,
    queue,
    routineStore,
    flowStore: routineFlowStore,
    wsHub,
  });
  routineExecutionService.setTimer(routineTimer);
  routineExecutionService.setOnRunSettled(async () => {
    await routineFlowsEngine.sweep();
  });

  const routineToolsDeps: RoutineToolsDeps = {
    db,
    routineStore,
    timer: routineTimer,
    executionService: routineExecutionService,
    webhookService: routineWebhookService,
    flowsEngine: routineFlowsEngine,
    wsHub,
  };
  runner.setRoutineToolsDeps(routineToolsDeps);
  cron.attachRoutineEngine(routineTimer, routineExecutionService);
  cron.registerDueProcessor(async (now) => {
    await workflowTriggers.processDue(now);
  });

  whatsapp.onMessage(async (msg) => {
    if (whatsapp.isEchoMessageId(msg.messageId)) return;
    const isGroup = msg.isGroup ?? msg.remoteJid.endsWith("@g.us");
    if (msg.fromMe && isGroup) return;
    try {
      await workflowTriggers.receiveWhatsAppTrigger({
        jid: msg.remoteJid,
        sender: msg.pushName,
        isGroup,
        text: msg.text,
        messageId: msg.messageId,
      });
    } catch (err) {
      console.warn("[Daemon] Erro ao avaliar gatilho WhatsApp de workflow:", err);
    }
  });

  const wfRecovery = await workflowEngine.recoverAndSweep();
  if (wfRecovery.recoveredRuns > 0 || wfRecovery.uncertainDeliveries > 0) {
    console.info("[Daemon] Workflow crash recovery:", wfRecovery);
  }

  infra.setWorkflowTriggersRef(workflowTriggers);

  const memoryReview = new MemoryReviewService({
    db,
    memoryManager,
    skillLearning,
    providers,
    providerConnection,
    wsHub,
    redactSecrets: (t) => apiKeysBridge.redactSecretValues(t),
    isInteractiveSlotBusy: () => runtimeState.isInteractiveSlotBusy(),
  });

  const phase14Services: Phase14ToolServices = {
    db,
    wsHub,
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
    licenseService,
    workspaceRoot: resolvedWorkspaceRoot,
    productRoot: studioPaths.productRoot,
    isAgentBusy: (agId) => runtimeState.isAgentBusy(agId),
    onDispatchQueuedInterAgent: (recipientId, row, _nextHopDepth) => {
      queueMicrotask(() => {
        void (async () => {
          const targetAg = db.connection
            .prepare("SELECT * FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
            .get(recipientId) as
            | {
                agente_id: string;
                nome: string;
                papel: string;
                modelo_padrao: string;
                config_json: string;
              }
            | undefined;
          if (!targetAg) return;

          try {
            const turnOut = await executeAgentConversationTurn({
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
              agente: targetAg,
              userPrompt: `[Mensagem assíncrona de @${row.de_agente_id} — ID: ${row.mensagem_id}]\n${row.conteudo}`,
              threadId: `main:${recipientId}`,
              turnoId: `ia-${randomUUID().slice(0, 8)}`,
              isHandoff: true,
              originalUserPrompt: row.conteudo,
            });

            if (row.expects_reply === 1 && row.thread_origem_id) {
              handoffBus.markRequestAnswered(row.mensagem_id);
              const originCanalId = row.thread_origem_id.startsWith("agente:") ||
                row.thread_origem_id.startsWith("canal-") ||
                row.thread_origem_id.startsWith("thread:")
                ? row.thread_origem_id
                : row.thread_origem_id.startsWith("main:")
                  ? `agente:${row.thread_origem_id.slice(5)}`
                  : `thread:${row.thread_origem_id}`;

              const returnMsgId = `msg-${randomUUID()}`;
              const returnIso = new Date().toISOString();
              const returnMarkdown = `**Retorno de ${targetAg.nome} (\`@${recipientId}\`):**\n\n${turnOut.agentMsg.conteudo_markdown}`;

              db.connection
                .prepare(
                  `INSERT INTO projecao_conversas_chat (
                    mensagem_id, canal_id, agente_id, autor, autor_nome,
                    conteudo_markdown, anexos_json, steps_json, tarefa_id,
                    lida, criado_em, thread_id, item_type, status, resposta_para_mensagem_id
                  ) VALUES (?, ?, ?, 'agente', ?, ?, ?, '[]', NULL, 1, ?, ?, 'mensagem', 'completed', ?);`,
                )
                .run(
                  returnMsgId,
                  originCanalId,
                  recipientId,
                  targetAg.nome,
                  returnMarkdown,
                  JSON.stringify(turnOut.agentMsg.anexos ?? []),
                  returnIso,
                  row.thread_origem_id,
                  row.mensagem_id,
                );

              wsHub.broadcast("chat:message", {
                canal_id: originCanalId,
                agente_id: recipientId,
                mensagem: {
                  mensagem_id: returnMsgId,
                  canal_id: originCanalId,
                  agente_id: recipientId,
                  autor: "agente",
                  autor_nome: targetAg.nome,
                  conteudo_markdown: returnMarkdown,
                  anexos: turnOut.agentMsg.anexos ?? [],
                  steps: [],
                  thread_id: row.thread_origem_id,
                  item_type: "mensagem",
                  status: "completed",
                  resposta_para_mensagem_id: row.mensagem_id,
                  lida: true,
                  criado_em: returnIso,
                },
              });
            }
          } catch {
            // Falha isolada não derruba o loop principal do daemon
          }
        })();
      });
    },
  };
  runner.setPhase14Services(phase14Services);

  const baseStudioDepsForLanes = {
    db,
    queue,
    vault,
    providers,
    providerConnection,
    wsHub,
    sendJson,
    readJsonBody,
    workspaceRoot: resolvedWorkspaceRoot,
    mcpGateway,
    catalogService,
    githubImporter,
    skillsManager,
    whatsappManager,
    whatsappOrchestrator,
    routineToolsDeps,
    workflowStore,
    workflowEngine,
    workflowTriggers,
    telegramBot,
    readRawBody,
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
    browserService,
    screenCapture,
    showcaseService,
    connectorsWebhook,
    transcription,
    backupResolver,
    messagingService,
    loginVault,
    passwordManagerRegistry,
    browserAutofillService,
  };
  messagingDepsReady = true;

  const studioMcpBridge = new CriativoStudioMcpBridge({
    db,
    vault,
    wsHub,
    workspaceRoot: resolvedWorkspaceRoot,
    mcpGateway,
    catalogService,
    nativeStore: catalogService.nativeStore,
    providerConnection,
    skillsManager,
    whatsappManager,
    whatsappOrchestrator,
    routineToolsDeps,
    workflowStore,
    workflowEngine,
    phase13: phase13Bundle,
    phase14: phase14Services,
    browserService,
    screenCapture,
    showcaseService,
    transcription,
    remoteClaimService,
    browserAutofillService,
    crmService,
    fetchImpl: options.fetchImpl,
  });
  providerConnection.attachStudioMcpBridge(studioMcpBridge);

  return {
    activeExecutor,
    cron,
    routineStore,
    routineFlowStore,
    workflowStore,
    telegramBot,
    messagingService,
    slackAdapter,
    discordAdapter,
    loginVault,
    passwordManagerRegistry,
    browserAutofillService,
    telemetryService,
    teamService,
    instanceTransferService,
    crmService,
    voiceHostService,
    workflowEngine,
    workflowTriggers,
    routineResultDispatcher,
    routineExecutionService,
    routineTimer,
    routineWebhookService,
    routineFlowsEngine,
    routineToolsDeps,
    memoryReview,
    phase14Services,
    baseStudioDepsForLanes,
    studioMcpBridge,
  };
}

export type DaemonRuntimeServices = Awaited<ReturnType<typeof createDaemonRuntimeServices>>;
