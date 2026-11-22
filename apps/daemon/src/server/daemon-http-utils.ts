import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnexoChat, StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import { CriativoDatabase, initializeDatabase } from "../database/client.ts";
import { FifoQueueManager } from "../queue/fifo-queue.ts";
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
import { RoutineStore } from "../routines/routine-store.ts";
import { RoutineFlowStore } from "../routines/routine-flow-store.ts";
import { RoutineTimer } from "../routines/routine-timer.ts";
import { RoutineResultDispatcher } from "../routines/routine-result-dispatcher.ts";
import { RoutineExecutionService } from "../routines/routine-execution-service.ts";
import { WebhookRoutineService } from "../routines/webhook-routine-service.ts";
import { RoutineFlowsEngine } from "../routines/routine-flows-engine.ts";
import { TelegramNotificationBot } from "../messaging/telegram-bot.ts";
import { WorkflowEngine } from "../workflows/workflow-engine.ts";
import { WorkflowStore } from "../workflows/workflow-store.ts";
import { WorkflowTriggers } from "../workflows/workflow-triggers.ts";
import { VaultService } from "../vault/vault-service.ts";
import { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { AgentRunner, type CustomToolExecutor } from "../engine/runner/agent-runner.ts";
import { CatalogService } from "../marketplace/catalog-service.ts";
import { GithubImporter } from "../marketplace/github-importer.ts";
import { SkillsManager } from "../marketplace/skills-manager.ts";
import { McpGateway } from "../mcp/mcp-gateway.ts";
import {
  CriativoStudioMcpBridge,
  INTERNAL_MCP_ROUTE_PATH,
} from "../mcp/studio-mcp-bridge.ts";
import { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { ControlSocketServer } from "./control-socket.ts";
import { WebSocketHub } from "./websocket-hub.ts";
import { AgentThreadStore } from "../threads/agent-thread-store.ts";
import { AgentTasksService } from "../threads/agent-tasks-service.ts";
import { AgentWaitsService } from "../waits/agent-waits-service.ts";
import { AgentWakeupService } from "../waits/agent-wakeup-service.ts";
import { QueueControlsService } from "../queue/queue-controls-service.ts";
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
import { BrowserAutomationService } from "../engine/tools/browser-automation.ts";
import { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import { ConnectorsWebhookService } from "./connectors-webhook-service.ts";
import { ShowcaseSiteService } from "./showcase-service.ts";
import { LicenseClientService } from "../license/license-service.ts";
import { LocalServerManager } from "../servers/local-server-manager.ts";
import { RemoteClaimService } from "../servers/remote-claim-service.ts";
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
  wakeupService: AgentWakeupService;
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

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
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

export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
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

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

export function hasRootMarkers(dir: string): boolean {
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
