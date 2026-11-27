import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { CriativoDatabase, initializeDatabase } from "../database/client.ts";
import { FifoQueueManager } from "../queue/fifo-queue.ts";
import { recoverInterruptedTasks } from "../queue/task-recovery.ts";
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
import { WorkflowTriggers } from "../workflows/workflow-triggers.ts";
import { VaultService } from "../vault/vault-service.ts";
import { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import { AgentRunner, type CustomToolExecutor } from "../engine/runner/agent-runner.ts";
import { seedDefaultStudioExperience } from "../engine/runner/roster-defaults.ts";
import { CatalogService } from "../marketplace/catalog-service.ts";
import { GithubImporter } from "../marketplace/github-importer.ts";
import { SkillsManager } from "../marketplace/skills-manager.ts";
import { McpGateway } from "../mcp/mcp-gateway.ts";
import { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { CustomEndpointsService } from "../providers/custom-endpoints-service.ts";
import { LocalProviderDetector } from "../providers/local-provider-detector.ts";
import { MailboxDeliveryGate } from "../waits/mailbox-delivery-gate.ts";
import { MailboxReconciler } from "../waits/mailbox-reconciler.ts";
import { MailboxStore } from "../waits/mailbox-store.ts";
import { TranscriptionService } from "../voice/transcription-service.ts";
import { importExternalTelemetryIfAvailable } from "./analytics-skills-service.ts";
import { getBrandIdentity, syncBrandPlaceholdersInDatabase } from "./brand-onboarding-service.ts";
import { WebSocketHub } from "./websocket-hub.ts";
import { AgentThreadStore } from "../threads/agent-thread-store.ts";
import { AgentTasksService } from "../threads/agent-tasks-service.ts";
import { ConversationPaginationReader } from "../threads/conversation-pagination.ts";
import { AgentWaitStore } from "../waits/agent-wait-store.ts";
import { AgentWaitsService } from "../waits/agent-waits-service.ts";
import { AgentWakeupService } from "../waits/agent-wakeup-service.ts";
import { BackgroundJobService } from "../waits/background-job-service.ts";
import { ChatQueueStore } from "../queue/chat-queue-store.ts";
import { QueueControlsService } from "../queue/queue-controls-service.ts";
import { SideQuestionService } from "../chat/side-question-service.ts";
import { ContextResetService } from "../chat/context-reset-service.ts";
import { MessagePinsService } from "../chat/message-pins-service.ts";
import { SharedTablesService } from "../agent-data/shared-tables-service.ts";
import { MemoryManager } from "../engine/runner/memory-manager.ts";
import { SkillLearningService } from "../engine/runner/skill-learning-service.ts";
import { HistorySearchService } from "../engine/runner/history-search-service.ts";
import { LibraryFoldersService } from "../engine/runner/library-folders-service.ts";
import { HandoffBus } from "../engine/runner/handoff-bus.ts";
import { ChatVisualPreviewService } from "../engine/runner/chat-visual-preview-service.ts";
import { UiBlockRegistry } from "../engine/runner/ui-block-registry.ts";
import { ApiKeysBridge } from "../vault/api-keys-bridge.ts";
import { BrowserAutomationService } from "../engine/tools/browser-automation.ts";
import { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import { BackupModelsResolver } from "../engine/runner/backup-models-resolver.ts";
import { ConnectorsWebhookService } from "./connectors-webhook-service.ts";
import { ShowcaseSiteService } from "./showcase-service.ts";
import { LicenseClientService } from "../license/license-service.ts";
import { LocalServerManager } from "../servers/local-server-manager.ts";
import { RemoteClaimService } from "../servers/remote-claim-service.ts";
import { RemoteOAuthBridgeService } from "../servers/remote-oauth-bridge.ts";
import { ServerProxyRouter } from "../servers/server-proxy-router.ts";
import {
  bootstrapUserDataDirectory,
  resolveStudioPaths,
  type StudioResolvedPaths,
} from "../config/app-paths.ts";
import { AutoUpdateService } from "../updater/auto-update-service.ts";
import { IdleWaitCoordinator } from "../updater/idle-wait-coordinator.ts";
import { MediaProviderCatalog } from "../workflows/media-provider-catalog.ts";
import type { DaemonServerOptions } from "./daemon-http-utils.ts";
import { StructuredLogger } from "./structured-logger.ts";

export interface DaemonLateCallbacks {
  getActivePort: () => number;
  isAuthorizedWhatsAppTurn: (event: AuthorizedWhatsAppMessageEvent) => Promise<boolean | void>;
  onScheduleLaneDrain: (agenteId: string, threadId: string | null) => void;
}

export async function createDaemonInfraServices(
  options: DaemonServerOptions,
  late: DaemonLateCallbacks
) {
  const studioPaths = resolveStudioPaths({
    workspaceRoot: options.workspaceRoot,
    productRoot: options.productRoot,
    dbPath: options.dbPath,
  });
  if ((studioPaths.separatedRoots || studioPaths.isPackaged) && !options.isChildServer) {
    bootstrapUserDataDirectory(studioPaths);
  }
  const resolvedWorkspaceRoot = options.workspaceRoot
    ? resolve(options.workspaceRoot)
    : studioPaths.userDataRoot;
  const resolvedDbPath =
    options.dbPath ??
    (studioPaths.separatedRoots || studioPaths.isPackaged ? studioPaths.dbPath : undefined);
  const db = initializeDatabase({ dbPath: resolvedDbPath });
  const recoveryReport = recoverInterruptedTasks(db);
  if (recoveryReport.totalInterrompidas > 0) {
    console.info("[Daemon] Crash recovery executado:", recoveryReport);
  }

  const queue = new FifoQueueManager(db);
  const structuredLogger = new StructuredLogger({
    logsDir: join(studioPaths.userDataRoot, "logs"),
  });
  const vault = new VaultService(db, options.vaultMasterKey);
  const wsHub = new WebSocketHub();
  const licenseService = new LicenseClientService({
    db,
    vault,
    wsHub,
    hubBaseUrl: options.licenseHubUrl,
    publicKeyPem: options.licensePublicKeyPem,
    fetchImpl: options.fetchImpl,
    machineSeedOverride: options.machineSeedOverride,
    productRoot: studioPaths.productRoot,
    enforceLicense: options.enforceLicense,
    bypassForTests: options.bypassLicenseForTests,
  });
    const localServerManager = options.isChildServer
    ? null
    : new LocalServerManager({
        db,
        vault,
        licenseService,
        wsHub,
        workspaceRoot: resolvedWorkspaceRoot,
        primaryPortProvider: () => late.getActivePort(),
      });
  const remoteClaimService = localServerManager
    ? new RemoteClaimService({
        localServerManager,
        licenseService,
        wsHub,
        fetchImpl: options.fetchImpl,
      })
    : null;
  const remoteOAuthBridge = localServerManager
    ? new RemoteOAuthBridgeService({
        localServerManager,
        fetchImpl: options.fetchImpl,
      })
    : null;
  const serverProxyRouter = localServerManager
    ? new ServerProxyRouter({
        localServerManager,
        licenseService,
        fetchImpl: options.fetchImpl,
      })
    : null;
  let backgroundJobServiceRef: BackgroundJobService | null = null;
  const idleWaitCoordinator = new IdleWaitCoordinator(() => {
    const runningBg = backgroundJobServiceRef?.getFirstActiveJobSummary();
    if (runningBg) {
      return { busy: true, reason: runningBg };
    }
    const runningTask = db.connection
      .prepare("SELECT titulo FROM projecao_tarefas WHERE status = 'executando' LIMIT 1;")
      .get() as { titulo?: string } | undefined;
    if (runningTask) {
      return { busy: true, reason: `Tarefa em execução: ${runningTask.titulo ?? "ativa"}` };
    }
    const runningWf = db.connection
      .prepare("SELECT run_id FROM projecao_workflow_execucoes WHERE status = 'running' LIMIT 1;")
      .get() as { run_id?: string } | undefined;
    if (runningWf) {
      return { busy: true, reason: `Workflow em andamento (${runningWf.run_id})` };
    }
    return { busy: false };
  });

  const autoUpdateService = new AutoUpdateService({
    licenseService,
    paths: studioPaths,
    wsHub,
    fetchImpl: options.fetchImpl,
    idleWaitCoordinator,
    serverId: options.isChildServer ? (process.env.CRIATIVO_CHILD_SERVER_ID ?? "local_child") : "primary",
    serverKind: options.isChildServer ? "local_child" : "primary",
    onRestartRequested: async (ctx) => {
      if (options.onRestartRequested) {
        await options.onRestartRequested(ctx);
        return;
      }
      if (typeof process.send === "function") {
        process.send({
          type: "criativo:request-update-restart",
          mode: ctx?.mode ?? "hot_bundle",
          stagedArtifactPath: ctx?.stagedArtifactPath ?? null,
          version: ctx?.version ?? null,
        });
      }
    },
  });

  const configuredAccessToken =
    options.accessToken !== undefined
      ? options.accessToken
      : (process.env.CRIATIVO_SERVER_ACCESS_TOKEN ?? null);

  const isAuthorizedByAccessToken = (req: IncomingMessage, urlObj: URL): boolean => {
    if (!configuredAccessToken) return true;
    const authHeader = String(req.headers.authorization ?? "");
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const queryTok = urlObj.searchParams.get("token") ?? "";
    const provided = bearer || queryTok;
    if (!provided) return false;
    const bufA = Buffer.from(provided, "utf8");
    const bufB = Buffer.from(configuredAccessToken, "utf8");
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  };

  const providers = new ProviderRegistry({ vault });
  const customEndpoints = new CustomEndpointsService({
    db,
    vault,
    registry: providers,
    fetchImpl: options.fetchImpl,
  });
  customEndpoints.syncAllIntoRegistry();
  const localProviderDetector = new LocalProviderDetector({
    fetchImpl: options.fetchImpl,
  });
  seedDefaultStudioExperience(db);
  if (process.env.CRIATIVO_IMPORT_EXTERNAL_DB === "1") {
    importExternalTelemetryIfAvailable(db);
  }
  const providerConnection = new ProviderConnectionService({
    db,
    vault,
    workspaceRoot: resolvedWorkspaceRoot,
    sharedAuthDir: options.sharedAuthDir ?? null,
  });
  // Cada servidor (principal, local filho ou VPS) mantém o onboarding da própria marca/workspace;
  // apenas o certificado Ed25519 da licença e os upgrades são sincronizados automaticamente.
  syncBrandPlaceholdersInDatabase(db, getBrandIdentity(providerConnection));
  const mcpGateway = new McpGateway({
    db,
    vault,
    fetchImpl: options.fetchImpl,
    onOAuthRequired: (notice) => {
      wsHub.broadcast("mcp.oauth_solicitado", {
        mcp_id: notice.mcpId,
        nome: notice.nome,
        app_slug: notice.appSlug,
        authorize_url: notice.authorizeUrl ?? null,
        agente_id: notice.agentId ?? null,
        motivo: notice.motivo,
      });
    },
    onServerStatusChanged: (evt) => {
      wsHub.broadcast("mcp.status_atualizado", {
        mcp_id: evt.mcpId,
        ativo: evt.ativo,
        oauth_status: evt.oauthStatus,
        qtd_ferramentas: evt.qtdFerramentas,
        ultimo_erro: evt.ultimoErro ?? null,
      });
    },
  });
  await mcpGateway.start();
  providerConnection.attachMcpGateway(mcpGateway);
  const mediaCatalog = new MediaProviderCatalog({
    vault,
    fetchImpl: options.fetchImpl,
    mcpGateway: {
      listAvailableTools: () => mcpGateway.listDiscoveredTools(),
      callTool: (mcpId, toolName, args) =>
        mcpGateway.callMcpTool(`mcp_${mcpId}_${toolName}`, args),
    },
  });

  const skillsManager = new SkillsManager({
    db,
    workspaceRoot: resolvedWorkspaceRoot,
    productRoot: studioPaths.productRoot,
  });
  skillsManager.syncDiskAndCatalog();

  const catalogService = new CatalogService({
    db,
    vault,
    mcpGateway,
    mcpStore: mcpGateway.store,
    oauthProvider: mcpGateway.oauthProvider,
    skillsManager,
    providerConnection,
    workspaceRoot: resolvedWorkspaceRoot,
    fetchImpl: options.fetchImpl,
  });
  const githubImporter = new GithubImporter({
    skillsManager,
    catalogService,
  });

  const transcription = new TranscriptionService({ vault });
  const whatsappSenderRules = new WhatsAppSenderRules(db.connection);
  const whatsappMediaService = new WhatsAppMediaService({
    db: db.connection,
    workspaceRoot: resolvedWorkspaceRoot,
  });
  const whatsappArchiveService = new WhatsAppArchiveService({
    db: db.connection,
    workspaceRoot: resolvedWorkspaceRoot,
  });

  const whatsappManager = new WhatsAppSessionManager({
    db: db.connection,
    socketFactory: options.whatsappSocketFactory,
    versionFetcher: options.whatsappVersionFetcher,
    onStatusChange: (contaId, snapshot) => {
      wsHub.broadcast("whatsapp.conta_atualizada", {
        conta_id: contaId,
        status: snapshot.status,
        qrcode_base64: snapshot.qrcode_base64,
        pairing_code: snapshot.pairing_code ?? null,
        numero_telefone: snapshot.numero ?? null,
        ultimo_erro: snapshot.ultimo_erro ?? null,
      });
      if (contaId === DEFAULT_WHATSAPP_ACCOUNT_ID) {
        wsHub.broadcast("whatsapp:status", {
          status: snapshot.status,
          qrcode: snapshot.qrcode_base64,
          numero: snapshot.numero ?? null,
        });
      }
    },
  });
  catalogService.attachWhatsAppManager(whatsappManager);

  let whatsappAuthorizedTurnHandler:
    | ((event: AuthorizedWhatsAppMessageEvent) => Promise<boolean | void>)
    | null = null;

  const whatsappOrchestrator = new WhatsAppOrchestrator({
    db: db.connection,
    sessionManager: whatsappManager,
    senderRules: whatsappSenderRules,
    mediaService: whatsappMediaService,
    archiveService: whatsappArchiveService,
    enqueueTask: (input) => {
      const created = queue.enqueueTask(input);
      wsHub.broadcast("task:queued", {
        tarefa_id: created.tarefa_id,
        tipo: created.tipo,
        titulo: created.titulo,
        prioridade: created.prioridade,
        canal_origem: created.canal_origem,
      });
      return created;
    },
    updateTaskStatus: (id, status, result, err) =>
      queue.updateTaskStatus(id, status, result, err),
    onApproveAndPublish: async (tarefaId) => {
      const tarefa = queue.getTask(tarefaId);
      let permalink =
        typeof tarefa?.resultado?.permalink === "string"
          ? tarefa.resultado.permalink
          : undefined;
      if (tarefa && options.onApproveAndPublishHook) {
        const hookRes = await options.onApproveAndPublishHook(tarefa);
        if (hookRes.permalink) {
          permalink = hookRes.permalink;
          queue.updateTaskStatus(tarefaId, "concluido", {
            ...(tarefa.resultado ?? {}),
            aprovado: true,
            aprovado_via: "whatsapp",
            permalink,
          });
        }
      }
      wsHub.broadcast("task:completed", {
        tarefa_id: tarefaId,
        permalink_instagram: permalink ?? null,
        tempo_total_ms: 0,
      });
      return { permalink };
    },
    onRequestAdjustment: async (tarefaId, feedback) => {
      const original = queue.getTask(tarefaId);
      queue.enqueueTask({
        agente_id: original?.agente_id ?? "estrategista",
        canal_origem: "whatsapp",
        tipo: original?.tipo ?? "carrossel",
        titulo: `Ajuste: ${feedback.slice(0, 60)}`,
        prioridade: 2,
        payload: { tarefa_original_id: tarefaId, feedback },
      });
    },
    transcribeAudio: (buf, mime) => transcription.transcribeAudio(buf, mime),
    onAuthorizedMessage: async (event) => {
      return await late.isAuthorizedWhatsAppTurn(event);
    },
    onPairingRequested: (contaId, request) => {
      wsHub.broadcast("whatsapp.pairing_solicitado", {
        conta_id: contaId,
        request,
      });
    },
    onMessageRecorded: (contaId, registro) => {
      wsHub.broadcast("whatsapp.mensagem_recebida", {
        conta_id: contaId,
        mensagem: registro,
      });
    },
  });

  const whatsapp = whatsappManager.getPrimaryClient();
  const approvalNotifier = whatsappOrchestrator.getApprovalNotifier(
    DEFAULT_WHATSAPP_ACCOUNT_ID
  );

  const memoryManager = new MemoryManager(db);
  const handoffBus = new HandoffBus(db, queue, wsHub);
  const apiKeysBridge = new ApiKeysBridge(vault);
  const ephemeralSharedDbPath =
    db.dbPath === ":memory:"
      ? join(tmpdir(), `criativo-shared-tables-${randomUUID()}.db`)
      : null;
  const sharedTables = new SharedTablesService({
    operationalDbPath: db.dbPath,
    ...(ephemeralSharedDbPath ? { sharedDbPath: ephemeralSharedDbPath } : {}),
    onTableChanged: (evt) => {
      wsHub.broadcast("shared_table:changed", evt);
    },
  });
  const skillLearning = new SkillLearningService({
    db,
    workspaceRoot: resolvedWorkspaceRoot,
    providers,
    providerConnection,
    wsHub,
    redactSecrets: (t) => apiKeysBridge.redactSecretValues(t),
  });
  const historySearch = new HistorySearchService({
    db,
    redactSecrets: (t) => apiKeysBridge.redactSecretValues(t),
  });
  const libraryFolders = new LibraryFoldersService({
    db,
    workspaceRoot: resolvedWorkspaceRoot,
    wsHub,
  });
  const visualPreview = new ChatVisualPreviewService({
    db,
    workspaceRoot: resolvedWorkspaceRoot,
  });
  const uiBlockRegistry = new UiBlockRegistry({
    db,
    wsHub,
    apiKeysBridge,
    getDefaultPlanStartAfterMs: () => skillLearning.getLearningConfig().plan_start_after_ms,
  });

  const browserService = new BrowserAutomationService(db, vault, wsHub, resolvedWorkspaceRoot);
  browserService.ensureDefaultSharedProfile();
  const screenCapture = new ScreenCaptureBridge(wsHub);
  const showcaseService = new ShowcaseSiteService({
    db,
    workspaceRoot: resolvedWorkspaceRoot,
    wsHub,
  });
  const backupResolver = new BackupModelsResolver();
  let workflowTriggersRef: WorkflowTriggers | null = null;
  const connectorsWebhook = new ConnectorsWebhookService({
    db,
    vault,
    wsHub,
    onTriggerWorkflow: async (evt) => {
      if (!workflowTriggersRef) return;
      await workflowTriggersRef
        .receiveConnectorTrigger({
          conectorId: evt.conector_id,
          evento: evt.evento,
          dados: evt.dados,
        })
        .catch(() => {});
    },
  });

  const runner = new AgentRunner({
    db,
    queue,
    vault,
    providers,
    providerConnection,
    wsHub,
    mcpGateway,
    whatsappManager,
    whatsappOrchestrator,
    catalogService,
    skillsManager,
    workspaceRoot: resolvedWorkspaceRoot,
    customTools: options.customTools,
    memoryManager,
    handoffBus,
    browserService,
    screenCapture,
    showcaseService,
    transcription,
    backupResolver,
  });
  const threadStore = new AgentThreadStore(db);
  const pagination = new ConversationPaginationReader(db);
  const waitStore = new AgentWaitStore(db);
  const queueStore = new ChatQueueStore(db);
  const tasksService = new AgentTasksService({ db, threadStore, queue, queueStore, wsHub });
  const waitsService = new AgentWaitsService({ db, waitStore, wsHub });
  const mailboxStore = new MailboxStore(db);
  const mailboxReconciler = new MailboxReconciler(db);
  const mailboxRecoveryReport = mailboxReconciler.reconcileOnStartup({ recoverAllLeased: true });
  if (mailboxRecoveryReport.recovered > 0 || mailboxRecoveryReport.deadLettered > 0) {
    console.info("[Daemon] Mailbox reconciliado no startup:", mailboxRecoveryReport);
  }
  const mailboxDeliveryGate = new MailboxDeliveryGate({
    store: mailboxStore,
  });
  handoffBus.attachMailbox(mailboxStore, mailboxDeliveryGate);
  waitsService.attachMailbox(mailboxStore);
  const wakeupService = new AgentWakeupService({ db, wsHub });
  const backgroundJobService = new BackgroundJobService({
    db,
    wsHub,
    workspaceRoot: resolvedWorkspaceRoot,
  });
  backgroundJobServiceRef = backgroundJobService;
  const queueControls = new QueueControlsService({ db, queueStore, tasksService, wsHub });
  const sideQuestion = new SideQuestionService({ db, providers, providerConnection, wsHub });
  const contextReset = new ContextResetService({ db, wsHub, providers, providerConnection });
  const pinsService = new MessagePinsService({ db, wsHub });
  runner.setPhase13Services({
    db,
    tasksService,
    waitsService,
    wakeupService,
    backgroundJobService,
    workspaceRoot: resolvedWorkspaceRoot,
    queueControls,
    contextReset,
    pinsService,
  });
  const scheduleLaneDrain = (agenteId: string, threadId: string | null): void => {
    late.onScheduleLaneDrain(agenteId, threadId);
  };
  const phase13Bundle = {
    threadStore,
    tasksService,
    waitsService,
    wakeupService,
    backgroundJobService,
    queueControls,
    pagination,
    sideQuestion,
    contextReset,
    pinsService,
    onDrainLane: scheduleLaneDrain,
  };
  void whatsappAuthorizedTurnHandler;

  return {
    studioPaths,
    resolvedWorkspaceRoot,
    db,
    structuredLogger,
    recoveryReport,
    queue,
    vault,
    wsHub,
    licenseService,
    localServerManager,
    remoteClaimService,
    remoteOAuthBridge,
    serverProxyRouter,
    autoUpdateService,
    configuredAccessToken,
    isAuthorizedByAccessToken,
    providers,
    providerConnection,
    customEndpoints,
    localProviderDetector,
    mailboxStore,
    mailboxDeliveryGate,
    mailboxReconciler,
    mcpGateway,
    mediaCatalog,
    idleWaitCoordinator,
    skillsManager,
    catalogService,
    githubImporter,
    transcription,
    whatsappSenderRules,
    whatsappMediaService,
    whatsappArchiveService,
    whatsappManager,
    whatsappOrchestrator,
    whatsapp,
    approvalNotifier,
    memoryManager,
    handoffBus,
    apiKeysBridge,
    ephemeralSharedDbPath,
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
    threadStore,
    pagination,
    waitStore,
    queueStore,
    tasksService,
    waitsService,
    wakeupService,
    backgroundJobService,
    queueControls,
    sideQuestion,
    contextReset,
    pinsService,
    phase13Bundle,
    scheduleLaneDrain,
    setWorkflowTriggersRef: (wf: WorkflowTriggers) => { workflowTriggersRef = wf; },
  };
}

export type DaemonInfraServices = Awaited<ReturnType<typeof createDaemonInfraServices>>;
