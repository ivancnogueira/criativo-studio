import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnexoChat, StatusTarefa, TarefaRegistro } from "@criativo/contracts";
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
import { CronScheduler } from "../routines/cron-scheduler.ts";
import { formatMarkdownForWhatsApp } from "../whatsapp/whatsapp-formatter.ts";
import { RoutineStore } from "../routines/routine-store.ts";
import { RoutineFlowStore } from "../routines/routine-flow-store.ts";
import { RoutineTimer } from "../routines/routine-timer.ts";
import { RoutineResultDispatcher } from "../routines/routine-result-dispatcher.ts";
import { RoutineExecutionService } from "../routines/routine-execution-service.ts";
import { WebhookRoutineService } from "../routines/webhook-routine-service.ts";
import { RoutineFlowsEngine } from "../routines/routine-flows-engine.ts";
import type { RoutineToolsDeps } from "../routines/routine-agent-tools.ts";
import { TelegramNotificationBot } from "../messaging/telegram-bot.ts";
import { WorkflowEngine } from "../workflows/workflow-engine.ts";
import { WorkflowStore } from "../workflows/workflow-store.ts";
import { executeWorkflowToolCall } from "../workflows/workflow-tools.ts";
import { WorkflowTriggers } from "../workflows/workflow-triggers.ts";
import { VaultService } from "../vault/vault-service.ts";
import { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { AgentRunner, type CustomToolExecutor } from "../engine/runner/agent-runner.ts";
import { seedDefaultStudioExperience } from "../engine/runner/roster-defaults.ts";
import { CatalogService } from "../marketplace/catalog-service.ts";
import { GithubImporter } from "../marketplace/github-importer.ts";
import { SkillsManager } from "../marketplace/skills-manager.ts";
import { McpGateway } from "../mcp/mcp-gateway.ts";
import {
  CriativoStudioMcpBridge,
  INTERNAL_MCP_ROUTE_PATH,
} from "../mcp/studio-mcp-bridge.ts";
import { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { TranscriptionService } from "../voice/transcription-service.ts";
import { ControlSocketServer } from "./control-socket.ts";
import { importExternalTelemetryIfAvailable } from "./analytics-skills-service.ts";
import { tryHandleRoutineRoute } from "./routine-routes.ts";
import { executeAgentConversationTurn, tryHandleStudioRoute } from "./studio-routes.ts";
import { getBrandIdentity, syncBrandPlaceholdersInDatabase } from "./brand-onboarding-service.ts";
import { WebSocketHub } from "./websocket-hub.ts";
import { AgentThreadStore } from "../threads/agent-thread-store.ts";
import { AgentTasksService } from "../threads/agent-tasks-service.ts";
import { ConversationPaginationReader } from "../threads/conversation-pagination.ts";
import { AgentWaitStore } from "../waits/agent-wait-store.ts";
import { AgentWaitsService } from "../waits/agent-waits-service.ts";
import { ChatQueueStore } from "../queue/chat-queue-store.ts";
import { QueueControlsService } from "../queue/queue-controls-service.ts";
import { SideQuestionService } from "../chat/side-question-service.ts";
import { ContextResetService } from "../chat/context-reset-service.ts";
import { MessagePinsService } from "../chat/message-pins-service.ts";
import { SharedTablesService } from "../agent-data/shared-tables-service.ts";
import { MemoryManager } from "../engine/runner/memory-manager.ts";
import { MemoryReviewService } from "../engine/runner/memory-review-service.ts";
import { SkillLearningService } from "../engine/runner/skill-learning-service.ts";
import { HistorySearchService } from "../engine/runner/history-search-service.ts";
import { LibraryFoldersService } from "../engine/runner/library-folders-service.ts";
import { HandoffBus } from "../engine/runner/handoff-bus.ts";
import { ChatVisualPreviewService } from "../engine/runner/chat-visual-preview-service.ts";
import { UiBlockRegistry } from "../engine/runner/ui-block-registry.ts";
import { ApiKeysBridge } from "../vault/api-keys-bridge.ts";
import type { Phase14ToolServices } from "./studio-tools-bridge.ts";
import { BrowserAutomationService } from "../engine/tools/browser-automation.ts";
import { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import { BackupModelsResolver } from "../engine/runner/backup-models-resolver.ts";
import { ConnectorsWebhookService } from "./connectors-webhook-service.ts";
import { ShowcaseSiteService } from "./showcase-service.ts";
import { tryHandlePhase15Route } from "./phase15-routes.ts";
import { LicenseClientService } from "../license/license-service.ts";
import { LocalServerManager } from "../servers/local-server-manager.ts";
import { RemoteClaimService } from "../servers/remote-claim-service.ts";
import { ServerProxyRouter } from "../servers/server-proxy-router.ts";
import {
  bootstrapUserDataDirectory,
  resolveStudioPaths,
  type StudioResolvedPaths,
} from "../config/app-paths.ts";
import { AutoUpdateService } from "../updater/auto-update-service.ts";
import type { WaVersionFetcher, WhatsAppStudioClient } from "@criativo/whatsapp";

export interface TaskExecutorHook {
  execute(tarefa: TarefaRegistro): Promise<void>;
}

export interface DaemonServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  workspaceRoot?: string;
  productRoot?: string;
  vaultMasterKey?: string;
  cronIntervalMs?: number;
  workerPollMs?: number;
  autoStartLoops?: boolean;
  autoBootWhatsApp?: boolean;
  controlSocketPath?: string | null;
  fetchImpl?: FetchLike;
  customTools?: Record<string, CustomToolExecutor>;
  onApproveAndPublishHook?: (tarefa: TarefaRegistro) => Promise<{ permalink?: string }>;
  taskExecutor?: TaskExecutorHook;
  whatsappSocketFactory?: SocketFactory;
  whatsappVersionFetcher?: WaVersionFetcher;
  licenseHubUrl?: string;
  licensePublicKeyPem?: string;
  enforceLicense?: boolean;
  bypassLicenseForTests?: boolean;
  machineSeedOverride?: string;
  accessToken?: string | null;
  isChildServer?: boolean;
  sharedAuthDir?: string | null;
  onRestartRequested?: (ctx?: {
    mode: "hot_bundle" | "native_installer";
    stagedArtifactPath: string | null;
    version: string;
  }) => Promise<void> | void;
}

export interface DaemonRuntime {
  httpServer: Server;
  wsHub: WebSocketHub;
  controlSocket: ControlSocketServer | null;
  db: CriativoDatabase;
  paths: StudioResolvedPaths;
  queue: FifoQueueManager;
  vault: VaultService;
  licenseService: LicenseClientService;
  localServerManager: LocalServerManager | null;
  remoteClaimService: RemoteClaimService | null;
  autoUpdateService: AutoUpdateService;
  cron: CronScheduler;
  routineStore: RoutineStore;
  routineFlowStore: RoutineFlowStore;
  routineTimer: RoutineTimer;
  routineResultDispatcher: RoutineResultDispatcher;
  routineExecutionService: RoutineExecutionService;
  routineWebhookService: WebhookRoutineService;
  routineFlowsEngine: RoutineFlowsEngine;
  workflowStore: WorkflowStore;
  workflowEngine: WorkflowEngine;
  workflowTriggers: WorkflowTriggers;
  telegramBot: TelegramNotificationBot;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  runner: AgentRunner;
  mcpGateway: McpGateway;
  studioMcpBridge: CriativoStudioMcpBridge;
  catalogService: CatalogService;
  githubImporter: GithubImporter;
  skillsManager: SkillsManager;
  whatsappManager: WhatsAppSessionManager;
  whatsappOrchestrator: WhatsAppOrchestrator;
  whatsapp: WhatsAppStudioClient;
  approvalNotifier: WhatsAppApprovalNotifier;
  threadStore: AgentThreadStore;
  tasksService: AgentTasksService;
  waitsService: AgentWaitsService;
  queueControls: QueueControlsService;
  pinsService: MessagePinsService;
  contextReset: ContextResetService;
  sharedTables: SharedTablesService;
  memoryManager: MemoryManager;
  memoryReview: MemoryReviewService;
  skillLearning: SkillLearningService;
  historySearch: HistorySearchService;
  libraryFolders: LibraryFoldersService;
  handoffBus: HandoffBus;
  visualPreview: ChatVisualPreviewService;
  uiBlockRegistry: UiBlockRegistry;
  apiKeysBridge: ApiKeysBridge;
  browserService: BrowserAutomationService;
  screenCapture: ScreenCaptureBridge;
  showcaseService: ShowcaseSiteService;
  connectorsWebhook: ConnectorsWebhookService;
  port: number;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Criativo-Server-Id",
  });
  res.end(payload);
}

const MAX_RAW_BODY_BYTES = 2 * 1024 * 1024;

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let exceeded = false;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_RAW_BODY_BYTES) {
      exceeded = true;
      continue;
    }
    chunks.push(buf);
  }

  if (exceeded) {
    const err = new Error("Payload excede o limite máximo de 2 MB.") as Error & {
      statusCode?: number;
    };
    err.statusCode = 413;
    throw err;
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readRawBody(req);
  const raw = buf.toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const err = new Error("Corpo JSON malformado.") as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
}

function hasRootMarkers(dir: string): boolean {
  return (
    existsSync(join(dir, "produto.json")) ||
    existsSync(join(dir, "templates", "marca")) ||
    (existsSync(join(dir, ".agents", "skills")) && existsSync(join(dir, "apps", "daemon")))
  );
}

/**
 * Resolve a raiz da instalação (monorepo) mesmo quando o daemon inicia via `npm --workspace=apps/daemon`.
 */
export function resolveDefaultWorkspaceRoot(cwd = process.cwd()): string {
  let cursor = resolve(cwd);
  for (let i = 0; i < 5; i += 1) {
    if (hasRootMarkers(cursor)) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  let modCursor = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (hasRootMarkers(modCursor)) return modCursor;
    const parent = dirname(modCursor);
    if (parent === modCursor) break;
    modCursor = parent;
  }

  return resolve(cwd);
}

export async function createDaemonServer(
  options: DaemonServerOptions = {}
): Promise<DaemonRuntime> {
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
  let activeServerPort = 0;
  const localServerManager = options.isChildServer
    ? null
    : new LocalServerManager({
        db,
        vault,
        licenseService,
        wsHub,
        workspaceRoot: resolvedWorkspaceRoot,
        primaryPortProvider: () => activeServerPort,
      });
  const remoteClaimService = localServerManager
    ? new RemoteClaimService({
        localServerManager,
        licenseService,
        wsHub,
        fetchImpl: options.fetchImpl,
      })
    : null;
  const serverProxyRouter = localServerManager
    ? new ServerProxyRouter({
        localServerManager,
        fetchImpl: options.fetchImpl,
      })
    : null;
  const autoUpdateService = new AutoUpdateService({
    licenseService,
    paths: studioPaths,
    wsHub,
    fetchImpl: options.fetchImpl,
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
      if (!whatsappAuthorizedTurnHandler) return false;
      return await whatsappAuthorizedTurnHandler(event);
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
  const queueControls = new QueueControlsService({ db, queueStore, tasksService, wsHub });
  const sideQuestion = new SideQuestionService({ db, providers, providerConnection, wsHub });
  const contextReset = new ContextResetService({ db, wsHub, providers, providerConnection });
  const pinsService = new MessagePinsService({ db, wsHub });
  runner.setPhase13Services({ tasksService, waitsService, queueControls, contextReset, pinsService });

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
  const telegramBot = new TelegramNotificationBot({
    vault,
    fetchImpl: options.fetchImpl,
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
  workflowTriggersRef = workflowTriggers;

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

  const memoryReview = new MemoryReviewService({
    db,
    memoryManager,
    skillLearning,
    providers,
    providerConnection,
    wsHub,
    redactSecrets: (t) => apiKeysBridge.redactSecretValues(t),
    isInteractiveSlotBusy: () => activeLaneKeys.size > 0 || activeFifoTaskIds.size > 0,
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
    isAgentBusy: (agId) => {
      const busy =
        (activeTurnsByAgent.get(agId) ?? 0) > 0 || queueControls.isLaneBusy(agId, null);
      const snap = queueControls.getLaneSnapshot(agId, null);
      return { busy, policy: snap.modo_ocupado };
    },
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
  };

  const scheduleLaneDrain = (agenteId: string, threadId: string | null): void => {
    void drainChatLane(agenteId, threadId);
  };

  const phase13Bundle = {
    threadStore,
    tasksService,
    waitsService,
    queueControls,
    pagination,
    sideQuestion,
    contextReset,
    pinsService,
    onDrainLane: scheduleLaneDrain,
  };

  tasksService.setOnLaneWake(scheduleLaneDrain);
  queueControls.setOnLaneWake(scheduleLaneDrain);

  whatsappAuthorizedTurnHandler = async (event) => {
    const rawPrompt = event.text?.trim() ?? "";
    const hasMediaAttachment = Boolean(event.media && event.media.diskPath);
    if (!rawPrompt && !hasMediaAttachment) {
      return false;
    }

    const accountRow = db.connection
      .prepare(`SELECT agente_orquestrador_id FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
      .get(event.contaId) as { agente_orquestrador_id?: string | null } | undefined;

    const allAgents = db.connection
      .prepare(`SELECT agente_id, nome, papel, modelo_padrao, config_json FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
      .all() as Array<{
      agente_id: string;
      nome: string;
      papel: string;
      modelo_padrao: string;
      config_json: string;
    }>;

    const mentionMatch = rawPrompt.match(/@([a-z0-9_-]+)/i);
    const mentionedAgent = mentionMatch
      ? allAgents.find((a) => a.agente_id.toLowerCase() === mentionMatch[1].toLowerCase())
      : undefined;
    const defaultAgentId = accountRow?.agente_orquestrador_id || "estrategista";
    const agente =
      mentionedAgent ??
      allAgents.find((a) => a.agente_id === defaultAgentId) ??
      allAgents[0];

    if (!agente) {
      return false;
    }

    const incomingAnexos: AnexoChat[] =
      event.media && event.media.caminhoRelativo
        ? [
            {
              arquivo_id: event.media.arquivoId,
              nome: event.media.nomeOriginal,
              caminho_relativo: event.media.caminhoRelativo,
              url: `/api/arquivos/raw?path=${encodeURIComponent(event.media.caminhoRelativo)}`,
              mime_type: event.media.mimeType,
              tamanho_bytes: event.media.tamanhoBytes,
              tipo_uso: "anexo",
            },
          ]
        : [];

    const turnoId = `wpp-${randomUUID().slice(0, 8)}`;
    const mainThreadId = `main:${agente.agente_id}`;
    const canalId = `agente:${agente.agente_id}`;
    const whatsappUserText = rawPrompt || "📎 Mídia enviada pelo WhatsApp";
    const whatsappMeta = {
      origem: "whatsapp",
      chat_jid: event.msg.remoteJid,
      conta_id: event.contaId,
      self_chat: Boolean(event.msg.fromMe),
    };

    const maxOrdRow = db.connection
      .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
      .get(mainThreadId) as { max_ord: number } | undefined;
    const userOrdinal = (maxOrdRow?.max_ord ?? 0) + 1;
    const incomingMsgId = `msg-${randomUUID()}`;
    const incomingCreatedAt = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, lida, criado_em,
          thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
          ordinal, branch_origem_mensagem_id, metadados_json
        ) VALUES (?, ?, ?, 'usuario', ?, ?, ?, '[]', NULL, 1, ?, ?, ?, 'mensagem', 'completed', NULL, ?, NULL, ?);`,
      )
      .run(
        incomingMsgId,
        canalId,
        agente.agente_id,
        event.msg.pushName?.trim() || "Você",
        whatsappUserText,
        JSON.stringify(incomingAnexos),
        incomingCreatedAt,
        mainThreadId,
        turnoId,
        userOrdinal,
        JSON.stringify(whatsappMeta),
      );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agente.agente_id,
      mensagem: {
        mensagem_id: incomingMsgId,
        canal_id: canalId,
        agente_id: agente.agente_id,
        autor: "usuario",
        autor_nome: event.msg.pushName?.trim() || "Você",
        conteudo_markdown: whatsappUserText,
        anexos: incomingAnexos,
        steps: [],
        tarefa_id: null,
        thread_id: mainThreadId,
        turno_id: turnoId,
        item_type: "mensagem",
        status: "completed",
        ordinal: userOrdinal,
        metadados: whatsappMeta,
        lida: true,
        criado_em: incomingCreatedAt,
      },
    });

    try {
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
        userPrompt: rawPrompt || "Analise este arquivo enviado pelo WhatsApp.",
        anexos: incomingAnexos,
        turnoId,
        originalUserPrompt: rawPrompt,
        respostaParaMensagemId: incomingMsgId,
        channelOrigin: "whatsapp",
        extraMetadados: whatsappMeta,
      });

      const replyText = agentMsg.conteudo_markdown?.trim();
      if (replyText) {
        const chunks = formatMarkdownForWhatsApp(replyText, { maxChunkLength: 1600, maxChunks: 4 });
        for (const chunk of chunks) {
          const sent = await event.client.sendMessage(event.msg.remoteJid, {
            text: chunk,
          });
          const recordedReply = whatsappArchiveService.recordMessage({
            mensagemId: sent.messageId,
            contaId: event.contaId,
            chatJid: event.msg.remoteJid,
            remetenteJid: event.msg.remoteJid,
            remetenteNome: agente.nome,
            direcao: "saida",
            tipoConteudo: "texto",
            texto: chunk,
            ehGrupo: Boolean(event.msg.isGroup),
            ackStatus: sent.ackStatus === "ack" ? "entregue" : "enviado",
            metadados: { agente_id: agente.agente_id, self_chat: true },
          });
          wsHub.broadcast("whatsapp.mensagem_recebida", {
            conta_id: event.contaId,
            mensagem: recordedReply,
          });
        }
      }

      for (const anexo of agentMsg.anexos ?? []) {
        const absImg = resolve(resolvedWorkspaceRoot, anexo.caminho_relativo);
        if (anexo.mime_type?.startsWith("image/") && existsSync(absImg)) {
          await event.client.sendMessage(event.msg.remoteJid, {
            image: readFileSync(absImg),
            caption: `${agente.nome} · ${anexo.nome}`.slice(0, 500),
          });
        }
      }
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      try {
        await event.client.sendMessage(event.msg.remoteJid, {
          text: `Não consegui processar sua solicitação agora (${errMsg.slice(0, 180)}). Verifique a conexão do provedor de IA no Criativo Studio.`,
        });
      } catch {
        // Ignora falha secundária de envio caso o socket esteja desconectado
      }
      return true;
    }
  };

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
    fetchImpl: options.fetchImpl,
  });
  providerConnection.attachStudioMcpBridge(studioMcpBridge);

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

  const httpServer = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Criativo-Server-Id,X-Criativo-Mcp-Token",
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (path === INTERNAL_MCP_ROUTE_PATH) {
        await studioMcpBridge.handleHttpRequest(req, res, path, method, url, readJsonBody);
        return;
      }

      if (
        configuredAccessToken &&
        !(method === "GET" && (path === "/health" || path === "/api/health")) &&
        path.startsWith("/api/") &&
        !isAuthorizedByAccessToken(req, url)
      ) {
        sendJson(res, 401, { erro: "Token de acesso do servidor ausente ou inválido." });
        return;
      }

      const isLicenseExemptRoute =
        (method === "GET" && (path === "/health" || path === "/api/health")) ||
        path.startsWith("/api/studio/license/") ||
        (method === "GET" && !path.startsWith("/api/") && path !== "/ws");

      if (!isLicenseExemptRoute && path.startsWith("/api/")) {
        const opCheck = licenseService.assertOperational();
        if (!opCheck.ok) {
          sendJson(res, 402, {
            error: "license_required",
            erro: opCheck.status.message ?? "Licença ativa necessária para operar o Criativo AI Studio.",
            status: opCheck.status,
          });
          return;
        }
      }

      if (serverProxyRouter && (await serverProxyRouter.tryProxyHttpRequest(req, res, url, method))) {
        return;
      }

      if (
        await tryHandleRoutineRoute(req, res, path, method, url, {
          db,
          routineStore,
          flowStore: routineFlowStore,
          timer: routineTimer,
          resultDispatcher: routineResultDispatcher,
          executionService: routineExecutionService,
          webhookService: routineWebhookService,
          flowsEngine: routineFlowsEngine,
          wsHub,
          sendJson,
          readJsonBody,
        })
      ) {
        return;
      }

      const studioDepsForRequest = {
        db,
        queue,
        vault,
        providers,
        providerConnection,
        wsHub,
        sendJson,
        readJsonBody,
        workspaceRoot: resolvedWorkspaceRoot,
        productRoot: studioPaths.productRoot,
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
        browserService,
        screenCapture,
        showcaseService,
        connectorsWebhook,
        transcription,
        backupResolver,
        licenseService,
        localServerManager,
        remoteClaimService,
        autoUpdateService,
      };

      if (
        await tryHandlePhase15Route(req, res, path, method, url, {
          db,
          wsHub,
          workspaceRoot: resolvedWorkspaceRoot,
          providers,
          providerConnection,
          browserService,
          screenCapture,
          showcaseService,
          connectorsWebhook,
          transcription,
          backupResolver,
          studioRoutesDeps: studioDepsForRequest,
          sendJson,
          readJsonBody,
          readRawBody,
        })
      ) {
        return;
      }

      if (await tryHandleStudioRoute(req, res, path, method, url, studioDepsForRequest)) {
        return;
      }

      // Healthcheck
      if (method === "GET" && path === "/health") {
        sendJson(res, 200, {
          status: "ok",
          service: "criativo-daemon",
          dbPath: db.dbPath,
          websocketClients: wsHub.connectedCount,
          crashRecovery: recoveryReport,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Fila & Tarefas
      if (method === "GET" && path === "/api/tarefas") {
        const statusParam = url.searchParams.get("status") as StatusTarefa | null;
        const tarefas = queue.listTasks(statusParam ?? undefined);
        sendJson(res, 200, { tarefas });
        return;
      }

      if (method === "POST" && path === "/api/tarefas") {
        const body = await readJsonBody(req);
        if (typeof body.titulo !== "string" || typeof body.tipo !== "string") {
          sendJson(res, 400, { erro: "Campos obrigatórios: 'titulo' e 'tipo'." });
          return;
        }
        const tarefa = queue.enqueueTask({
          titulo: body.titulo,
          tipo: body.tipo,
          prioridade: typeof body.prioridade === "number" ? body.prioridade : 5,
          agente_id: typeof body.agente_id === "string" ? body.agente_id : null,
          canal_origem:
            typeof body.canal_origem === "string"
              ? (body.canal_origem as TarefaRegistro["canal_origem"])
              : "web",
          payload:
            body.payload && typeof body.payload === "object"
              ? (body.payload as Record<string, unknown>)
              : {},
        });
        wsHub.broadcast("task:queued", {
          tarefa_id: tarefa.tarefa_id,
          tipo: tarefa.tipo,
          titulo: tarefa.titulo,
          prioridade: tarefa.prioridade,
          canal_origem: tarefa.canal_origem,
        });
        sendJson(res, 201, { tarefa });
        return;
      }

      const tarefaActionMatch = path.match(/^\/api\/tarefas\/([^/]+)\/(aprovar|cancelar|retentar)$/);
      if (method === "POST" && tarefaActionMatch) {
        const tarefaId = decodeURIComponent(tarefaActionMatch[1]);
        const acao = tarefaActionMatch[2];
        const existing = queue.getTask(tarefaId);
        if (!existing) {
          sendJson(res, 404, { erro: `Tarefa ${tarefaId} não encontrada.` });
          return;
        }

        if (acao === "cancelar") {
          const updated = queue.cancelTask(tarefaId);
          sendJson(res, 200, { tarefa: updated });
          return;
        }
        if (acao === "retentar") {
          const updated = queue.retryTask(tarefaId);
          wsHub.broadcast("task:queued", {
            tarefa_id: updated.tarefa_id,
            tipo: updated.tipo,
            titulo: updated.titulo,
            prioridade: updated.prioridade,
            canal_origem: updated.canal_origem,
          });
          sendJson(res, 200, { tarefa: updated });
          return;
        }
        if (acao === "aprovar") {
          const updated = queue.updateTaskStatus(tarefaId, "concluido", {
            ...(existing.resultado ?? {}),
            aprovado: true,
            aprovado_em: new Date().toISOString(),
          });
          wsHub.broadcast("task:completed", {
            tarefa_id: updated.tarefa_id,
            permalink_instagram:
              typeof updated.resultado?.permalink === "string"
                ? updated.resultado.permalink
                : null,
            tempo_total_ms: 0,
          });
          sendJson(res, 200, { tarefa: updated });
          return;
        }
      }

      // Roster de Agentes
      if (method === "GET" && path === "/api/agentes") {
        const agentes = db.connection
          .prepare(`SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
          .all();
        sendJson(res, 200, { agentes });
        return;
      }

      const agentUpdateMatch = path.match(/^\/api\/agentes\/([^/]+)$/);
      if (method === "PUT" && agentUpdateMatch) {
        const agenteId = decodeURIComponent(agentUpdateMatch[1]);
        const body = await readJsonBody(req);
        const existing = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(agenteId) as { agente_id: string; modelo_padrao: string } | undefined;
        if (!existing) {
          sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
          return;
        }
        const novoModelo =
          typeof body.modelo_padrao === "string" ? body.modelo_padrao : existing.modelo_padrao;
        db.connection
          .prepare(
            `UPDATE projecao_agentes SET modelo_padrao = ?, atualizado_em = ? WHERE agente_id = ?;`
          )
          .run(novoModelo, new Date().toISOString(), agenteId);
        const updated = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(agenteId);
        sendJson(res, 200, { agente: updated });
        return;
      }

      const agentLogsMatch = path.match(/^\/api\/agentes\/([^/]+)\/logs$/);
      if (method === "GET" && agentLogsMatch) {
        const agenteId = decodeURIComponent(agentLogsMatch[1]);
        const logs = db.connection
          .prepare(
            `SELECT * FROM projecao_canal_mensagens WHERE de_agente_id = ? OR para_agente_id = ? ORDER BY enviado_em DESC LIMIT 50;`
          )
          .all(agenteId, agenteId);
        sendJson(res, 200, { logs });
        return;
      }

      // Mensageria WhatsApp & Webhooks
      if (method === "GET" && path === "/api/mensageria/whatsapp/status") {
        sendJson(res, 200, whatsapp.getStatus());
        return;
      }

      if (method === "POST" && path === "/api/mensageria/whatsapp/conectar") {
        try {
          await whatsapp.connect();
          sendJson(res, 200, whatsapp.getStatus());
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { erro: msg, status: whatsapp.getStatus() });
        }
        return;
      }

      if (method === "POST" && path === "/api/mensageria/whatsapp/desconectar") {
        await whatsapp.disconnect();
        sendJson(res, 200, { status: "desconectado" });
        return;
      }

      const webhookMatch = path.match(/^\/api\/webhooks\/disparo\/([^/]+)$/);
      if (method === "POST" && webhookMatch) {
        const token = decodeURIComponent(webhookMatch[1]);
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const webhook = db.connection
          .prepare(
            `SELECT * FROM projecao_webhooks WHERE chave_secreta_hash = ? AND ativo = 1;`
          )
          .get(tokenHash) as { webhook_id: string; tipo_evento: string } | undefined;

        if (!webhook) {
          sendJson(res, 401, { erro: "Token de webhook inválido ou inativo." });
          return;
        }

        const body = await readJsonBody(req);
        const requestedWaitId =
          typeof body.waitId === "string"
            ? body.waitId
            : typeof body.wait_id === "string"
              ? body.wait_id
              : null;
        const matchedWait = requestedWaitId ? waitStore.getWait(requestedWaitId) : null;
        const waitEntregaId = `wh-${randomUUID().slice(0, 8)}`;
        const wakeResult = matchedWait
          ? waitsService.wakeForRun({
              agenteId: matchedWait.agente_id,
              waitId: matchedWait.espera_id,
              entregaDespertarId: waitEntregaId,
              webhookPayload: body,
            })
          : null;

        const tarefa = queue.enqueueTask({
          agente_id:
            matchedWait?.agente_id ??
            (typeof body.agente_id === "string" ? body.agente_id : null),
          canal_origem: "webhook",
          tipo: typeof body.tipo === "string" ? body.tipo : webhook.tipo_evento,
          titulo:
            typeof body.titulo === "string"
              ? body.titulo
              : matchedWait
                ? `Webhook despertou espera (${matchedWait.espera_id})`
                : `Disparo externo via webhook (${webhook.webhook_id})`,
          prioridade: typeof body.prioridade === "number" ? body.prioridade : 4,
          payload: {
            ...body,
            ...(wakeResult?.promptBlock
              ? {
                  woken_waits_block: wakeResult.promptBlock,
                  woken_wait_ids: wakeResult.woken.map((w) => w.espera_id),
                }
              : {}),
          },
        });

        db.connection
          .prepare(`UPDATE projecao_webhooks SET ultimo_disparo_em = ? WHERE webhook_id = ?;`)
          .run(new Date().toISOString(), webhook.webhook_id);

        wsHub.broadcast("task:queued", {
          tarefa_id: tarefa.tarefa_id,
          tipo: tarefa.tipo,
          titulo: tarefa.titulo,
          prioridade: tarefa.prioridade,
          canal_origem: tarefa.canal_origem,
        });
        sendJson(res, 202, { tarefa });
        return;
      }

      // Rotinas
      if (method === "GET" && path === "/api/rotinas") {
        sendJson(res, 200, { rotinas: cron.listRoutines() });
        return;
      }

      if (method === "POST" && path === "/api/rotinas") {
        const body = await readJsonBody(req);
        if (
          typeof body.titulo !== "string" ||
          typeof body.expressao_cron !== "string" ||
          typeof body.tipo_tarefa !== "string"
        ) {
          sendJson(res, 400, {
            erro: "Campos obrigatórios: 'titulo', 'expressao_cron' e 'tipo_tarefa'.",
          });
          return;
        }
        const rotina = cron.createRoutine({
          titulo: body.titulo,
          expressao_cron: body.expressao_cron,
          tipo_tarefa: body.tipo_tarefa,
          timezone: typeof body.timezone === "string" ? body.timezone : "America/Sao_Paulo",
          payload_modelo:
            body.payload_modelo && typeof body.payload_modelo === "object"
              ? (body.payload_modelo as Record<string, unknown>)
              : {},
        });
        sendJson(res, 201, { rotina });
        return;
      }

      // Vault
      if (method === "GET" && path === "/api/vault/status") {
        sendJson(res, 200, { chaves: vault.listSecretsMetadata() });
        return;
      }

      if (method === "POST" && path === "/api/vault/salvar") {
        const body = await readJsonBody(req);
        if (typeof body.chave_nome !== "string" || typeof body.valor !== "string") {
          sendJson(res, 400, { erro: "Campos obrigatórios: 'chave_nome' e 'valor'." });
          return;
        }
        vault.setSecret(body.chave_nome, body.valor);
        sendJson(res, 200, { ok: true, chave_nome: body.chave_nome });
        return;
      }

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

function resolveWebDistDir(preferredDistDir?: string, productRoot?: string): string {
  if (preferredDistDir && existsSync(resolve(preferredDistDir, "index.html"))) {
    return preferredDistDir;
  }
  const currentDir = resolve(fileURLToPath(import.meta.url), "..");
  const candidates = [
    productRoot ? resolve(productRoot, "apps/web/dist") : null,
    productRoot ? resolve(productRoot, "web-dist") : null,
    resolve(currentDir, "../../../../apps/web/dist"),
    resolve(process.cwd(), "apps/web/dist"),
    resolve(process.cwd(), "../web/dist"),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) {
      return dir;
    }
  }
  return candidates[0] ?? resolve(currentDir, "../../../../apps/web/dist");
}

function tryServeWebStatic(
  pathName: string,
  res: ServerResponse,
  preferredDistDir?: string,
  productRoot?: string
): boolean {
  if (pathName.startsWith("/api/") || pathName === "/health" || pathName === "/ws") {
    return false;
  }
  const distDir = resolveWebDistDir(preferredDistDir, productRoot);
  const indexHtml = resolve(distDir, "index.html");
  if (!existsSync(indexHtml)) {
    return false;
  }

  const relativePath = pathName === "/" ? "index.html" : pathName.replace(/^\/+/, "");
  const resolvedTarget = resolve(distDir, relativePath);
  if (resolvedTarget !== distDir && !resolvedTarget.startsWith(distDir + sep)) {
    return false;
  }

  const fileToServe =
    existsSync(resolvedTarget) && statSync(resolvedTarget).isFile()
      ? resolvedTarget
      : indexHtml;
  const mime = STATIC_MIME_TYPES[extname(fileToServe).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control":
      fileToServe === indexHtml
        ? "no-store, no-cache, must-revalidate"
        : "public, max-age=31536000, immutable",
  });
  res.end(readFileSync(fileToServe));
  return true;
}

      if (
        method === "GET" &&
        (path === "/showcase" || path.startsWith("/showcase/")) &&
        showcaseService.tryServePublicRoute(path, res)
      ) {
        return;
      }

      if (method === "GET" && tryServeWebStatic(path, res, studioPaths.webDistDir, studioPaths.productRoot)) {
        return;
      }

      sendJson(res, 404, { erro: `Rota não encontrada: ${method} ${path}` });
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error);
      const statusCode =
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      sendJson(res, statusCode, { erro: mensagem });
    }
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    if (configuredAccessToken && !isAuthorizedByAccessToken(req, reqUrl)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (serverProxyRouter && reqUrl.pathname === "/ws") {
      const targetSid = reqUrl.searchParams.get("serverId")?.trim();
      if (targetSid && targetSid !== "primary") {
        void serverProxyRouter.tryProxyWebSocketUpgrade(req, socket, head, reqUrl);
        return;
      }
    }
    const handled = wsHub.handleUpgrade(req, socket, "/ws");
    if (!handled) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  const listenHost = options.host ?? process.env.HOST ?? "127.0.0.1";
  const listenPort = options.port ?? Number(process.env.PORT ?? 3000);

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(listenPort, listenHost, () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address();
  const resolvedPort = typeof address === "object" && address ? address.port : listenPort;
  activeServerPort = resolvedPort;
  studioMcpBridge.setPort(resolvedPort);
  routineStore.setPublicBaseUrl(`http://${listenHost}:${resolvedPort}`);

  const resolvedControlSocketPath =
    options.controlSocketPath === null
      ? null
      : (options.controlSocketPath ?? process.env.CRIATIVO_SOCKET_PATH ?? null);

  let controlSocket: ControlSocketServer | null = null;
  if (resolvedControlSocketPath) {
    controlSocket = new ControlSocketServer({
      socketPath: resolvedControlSocketPath,
      db,
      queue,
      getWhatsAppStatus: () => whatsapp.getStatus(),
      onRestartRequested: () => {
        console.info("[Criativo Daemon] Reinicialização solicitada via Control Socket.");
      },
    });
    await controlSocket.listen();
  }

  if (options.autoStartLoops !== false) {
    licenseService.startHeartbeatTimer();
    cron.start(options.cronIntervalMs ?? 60_000);
    await routineExecutionService.skipMissed();
    routineTimer.arm();
    await routineFlowsEngine.sweep();
    whatsappArchiveService.startPeriodicCleanup();
    workerTimer = setInterval(() => {
      void drainAllPendingLanes();
    }, options.workerPollMs ?? 500);
    workerTimer.unref?.();
  }

  const shouldAutoBootWhatsApp =
    options.autoBootWhatsApp ?? options.autoStartLoops !== false;
  if (shouldAutoBootWhatsApp) {
    void whatsappManager.bootSavedAccounts().catch((err) => {
      console.warn("[Daemon] Falha no auto-boot WhatsApp:", err);
    });
  }

  return {
    httpServer,
    wsHub,
    controlSocket,
    db,
    paths: studioPaths,
    queue,
    vault,
    licenseService,
    localServerManager,
    remoteClaimService,
    autoUpdateService,
    cron,
    routineStore,
    routineFlowStore,
    routineTimer,
    routineResultDispatcher,
    routineExecutionService,
    routineWebhookService,
    routineFlowsEngine,
    workflowStore,
    workflowEngine,
    workflowTriggers,
    telegramBot,
    providers,
    providerConnection,
    runner,
    mcpGateway,
    studioMcpBridge,
    catalogService,
    githubImporter,
    skillsManager,
    whatsappManager,
    whatsappOrchestrator,
    whatsapp,
    approvalNotifier,
    threadStore,
    tasksService,
    waitsService,
    queueControls,
    pinsService,
    contextReset,
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
    browserService,
    screenCapture,
    showcaseService,
    connectorsWebhook,
    port: resolvedPort,
    async close(): Promise<void> {
      licenseService.stopHeartbeatTimer();
      if (localServerManager) {
        await localServerManager.stopAll();
      }
      cron.stop();
      routineTimer.dispose();
      memoryReview.dispose();
      uiBlockRegistry.dispose();
      screenCapture.dispose();
      await browserService.closeAll();
      await workflowEngine.dispose();
      whatsappArchiveService.stopPeriodicCleanup();
      whatsappOrchestrator.stop();
      if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
      }
      if (controlSocket) {
        await controlSocket.close();
      }
      await whatsappManager.shutdownAll();
      await mcpGateway.close();
      await sharedTables.close();
      if (ephemeralSharedDbPath) {
        for (const suffix of ["", "-wal", "-shm"]) {
          try {
            rmSync(`${ephemeralSharedDbPath}${suffix}`, { force: true });
          } catch {
            // ignora falha de limpeza efêmera
          }
        }
      }
      providerConnection.close();
      wsHub.closeAll();
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolveClose) => {
        httpServer.close(() => resolveClose());
      });
      db.close();
    },
  };
}

const isEntryPoint =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]) &&
  !/local-child-entry\.(ts|js)$/i.test(process.argv[1]) &&
  process.env.CRIATIVO_LOCAL_CHILD !== "1";

if (isEntryPoint) {
  process.on("unhandledRejection", (reason) => {
    console.error("[Criativo Daemon] unhandledRejection capturada:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[Criativo Daemon] uncaughtException capturada:", err);
  });

  createDaemonServer()
    .then((runtime) => {
      console.info(
        `[Criativo Daemon] Servidor HTTP + WebSocket ativo em http://127.0.0.1:${runtime.port}`
      );
    })
    .catch((err) => {
      console.error("[Criativo Daemon] Falha crítica ao iniciar:", err);
      process.exit(1);
    });
}
