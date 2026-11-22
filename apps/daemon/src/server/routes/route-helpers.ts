import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, relative, resolve, sep } from "node:path";
import {
  resolveMetaGraphApiVersion,
  type AgentAllowedFolder,
  type AgentNotificationLevel,
  type AnexoChat,
  type AprendizadoConfig,
  type ArquivoStudio,
  type AvatarStyle,
  type BackupModelChoice,
  type BackupModelsConfig,
  type CanalEquipe,
  type CanalMemoria,
  type CanalNavegadorModo,
  type ChatVisualMeta,
  type ConversationMessage,
  type ConversationUiBlock,
  type DeletedNativeAgentInfo,
  type MemoriaInclusao,
  type MemoryReviewAlteracao,
  type MensagemChat,
  type OnboardingEstado,
  type PassoChat,
  type PermissionLevel,
  type ProviderName,
  type SkillSugestaoItem,
  type ToolDefinition,
  type UiBlockSubmitPayload,
  type UsageLimitAskPayload,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTraco,
  type WorkflowVisual,
} from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../../database/client.ts";
import type { ProviderRegistry } from "../../engine/providers/provider-registry.ts";
import { HandoffBus } from "../../engine/runner/handoff-bus.ts";
import type { CatalogService } from "../../marketplace/catalog-service.ts";
import type { GithubImporter } from "../../marketplace/github-importer.ts";
import type { SkillsManager } from "../../marketplace/skills-manager.ts";
import type { McpGateway, McpOAuthRequiredNotice } from "../../mcp/mcp-gateway.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import { LicenseValidationError, type LicenseClientService } from "../../license/license-service.ts";
import type { LocalServerManager } from "../../servers/local-server-manager.ts";
import type { RemoteClaimService } from "../../servers/remote-claim-service.ts";
import type { RemoteOAuthBridgeService } from "../../servers/remote-oauth-bridge.ts";
import type { AutoUpdateService } from "../../updater/auto-update-service.ts";
import type { CustomEndpointsService } from "../../providers/custom-endpoints-service.ts";
import type { LocalProviderDetector } from "../../providers/local-provider-detector.ts";
import type { MediaProviderCatalog } from "../../workflows/media-provider-catalog.ts";
import type { MessagingService } from "../../messaging/messaging-service.ts";
import type { BrowserAutofillService } from "../../vault/browser-autofill-service.ts";
import type { LoginVaultService } from "../../vault/login-vault-service.ts";
import type { PasswordManagerRegistry } from "../../vault/password-managers/registry.ts";
import {
  activateUpgradePackage,
  computeUnlockedAgentsSummary,
  evaluateAndSyncSetupCompletion,
  getBrandIdentity,
  hasConfiguredBrand,
  importBrandPdfFromBuffer,
  interpolateBrandPlaceholders,
  isSetupAssistantVisible,
  isVpsAssistantVisible,
  listUpgradePackages,
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
  syncBrandPlaceholdersInDatabase,
} from "../brand-onboarding-service.ts";
import {
  buildPhase13SystemGuidance,
  buildStudioLiveContext,
  executeChatWorkflowTool,
  executePhase13Tool,
  executePhase14ToolCall,
  executePhase15ChatTool,
  executeStudioExtensionTool,
  executeStudioRoutineTool,
  getChatWorkflowToolCatalog,
  HIDDEN_CATALOG_TOOL_NAMES,
  isAgentAuthorizedForStudioTool,
  isPhase10ExtensionTool,
  isPhase13ToolName,
  isPhase14ToolName,
  isPhase15ToolName,
  isRoutineToolName,
  isUpgradeUnlocked,
  isWorkflowToolName,
  PHASE10_TOOL_DEFINITIONS,
  PHASE13_TOOLS_SCHEMA,
  PHASE14_TOOLS_SCHEMA,
  PHASE15_TOOLS_SCHEMA,
  readAgentContextCutoffAt,
  readAgentGovernance,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  sanitizeAllowedFoldersList,
  selectBalancedVisualAssets,
  syncWorkspaceFilesToDatabase,
  validateMetaIntegration,
  type LabeledVisualAsset,
  type Phase14ToolServices,
} from "../studio-tools-bridge.ts";
import {
  BackupModelsResolver,
  isRetryableQuotaOrProviderError,
  MAX_BACKUP_MODELS,
  parseBackupModelsJson,
} from "../../engine/runner/backup-models-resolver.ts";
import type { BrowserAutomationService } from "../../engine/tools/browser-automation.ts";
import type { ScreenCaptureBridge } from "../../engine/tools/screen-capture-bridge.ts";
import type { ShowcaseSiteService } from "../showcase-service.ts";
import type { ConnectorsWebhookService } from "../connectors-webhook-service.ts";
import type { TranscriptionService } from "../../voice/transcription-service.ts";
import { tryHandleThreadsRoute, type Phase13ServicesBundle } from "../threads-routes.ts";
import type { SharedTablesService } from "../../agent-data/shared-tables-service.ts";
import { MemoryManager } from "../../engine/runner/memory-manager.ts";
import type { MemoryReviewService } from "../../engine/runner/memory-review-service.ts";
import type { SkillLearningService } from "../../engine/runner/skill-learning-service.ts";
import type { HistorySearchService } from "../../engine/runner/history-search-service.ts";
import type { LibraryFoldersService } from "../../engine/runner/library-folders-service.ts";
import type { ChatVisualPreviewService } from "../../engine/runner/chat-visual-preview-service.ts";
import { UiBlockHttpError, type UiBlockRegistry } from "../../engine/runner/ui-block-registry.ts";
import type { ApiKeysBridge } from "../../vault/api-keys-bridge.ts";
import type { RoutineToolsDeps } from "../../routines/routine-agent-tools.ts";
import type { TelegramNotificationBot } from "../../messaging/telegram-bot.ts";
import type { WorkflowEngine } from "../../workflows/workflow-engine.ts";
import { WorkflowStore, WorkflowValidationError } from "../../workflows/workflow-store.ts";
import type { WorkflowTriggers } from "../../workflows/workflow-triggers.ts";
import type { WebSocketHub } from "../websocket-hub.ts";

export interface StudioRoutesDeps {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  vault?: VaultService;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  wsHub: WebSocketHub;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  readRawBody?: (req: IncomingMessage) => Promise<Buffer>;
  workspaceRoot?: string;
  productRoot?: string;
  mcpGateway?: McpGateway;
  catalogService?: CatalogService;
  githubImporter?: GithubImporter;
  skillsManager?: SkillsManager;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  routineToolsDeps?: RoutineToolsDeps;
  workflowStore?: WorkflowStore;
  workflowEngine?: WorkflowEngine;
  workflowTriggers?: WorkflowTriggers;
  telegramBot?: TelegramNotificationBot;
  phase13?: Phase13ServicesBundle;
  sharedTables?: SharedTablesService;
  memoryManager?: MemoryManager;
  memoryReview?: MemoryReviewService;
  skillLearning?: SkillLearningService;
  historySearch?: HistorySearchService;
  libraryFolders?: LibraryFoldersService;
  handoffBus?: HandoffBus;
  uiBlockRegistry?: UiBlockRegistry;
  apiKeysBridge?: ApiKeysBridge;
  visualPreview?: ChatVisualPreviewService;
  phase14?: Phase14ToolServices;
  browserService?: BrowserAutomationService;
  screenCapture?: ScreenCaptureBridge;
  showcaseService?: ShowcaseSiteService;
  connectorsWebhook?: ConnectorsWebhookService;
  transcription?: TranscriptionService;
  backupResolver?: BackupModelsResolver;
  licenseService?: LicenseClientService;
  localServerManager?: LocalServerManager | null;
  remoteClaimService?: RemoteClaimService | null;
  remoteOAuthBridge?: RemoteOAuthBridgeService | null;
  autoUpdateService?: AutoUpdateService;
  customEndpoints?: CustomEndpointsService;
  localProviderDetector?: LocalProviderDetector;
  mediaCatalog?: MediaProviderCatalog;
  messagingService?: MessagingService;
  loginVault?: LoginVaultService;
  passwordManagerRegistry?: PasswordManagerRegistry;
  browserAutofillService?: BrowserAutofillService;
}

export interface StudioRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  method: string;
  url: URL;
  deps: StudioRoutesDeps;
  db: StudioRoutesDeps["db"];
  wsHub: StudioRoutesDeps["wsHub"];
  workspaceRoot: string;
}

export const RAW_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mmd": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeFileName(rawName: string): string {
  const base = basename(rawName || "anexo.png")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || `anexo-${Date.now()}.bin`;
}

export function inferTipoUso(mime: string, requested?: string): ArquivoStudio["tipo_uso"] {
  if (
    requested === "referencia" ||
    requested === "logo" ||
    requested === "personagem" ||
    requested === "gerado" ||
    requested === "video" ||
    requested === "documento"
  ) {
    return requested;
  }
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "referencia";
  return "documento";
}

export const VALID_AVATAR_STYLES = new Set<AvatarStyle>([
  "classic",
  "plush",
  "cartoon",
  "robots",
  "personas",
  "pets",
  "monsters",
  "image",
]);

export function sanitizeAvatarStyle(raw: unknown): AvatarStyle | undefined {
  return typeof raw === "string" && VALID_AVATAR_STYLES.has(raw as AvatarStyle)
    ? (raw as AvatarStyle)
    : undefined;
}

export type BrandSummary = { marca_nome: string; perfil_handle: string };

export function applyBrandToMessage(msg: MensagemChat, brand?: BrandSummary | null): MensagemChat {
  if (!brand || !hasConfiguredBrand(brand) || msg.autor !== "agente") {
    return msg;
  }
  return {
    ...msg,
    conteudo_markdown: interpolateBrandPlaceholders(msg.conteudo_markdown, brand),
    steps: msg.steps.map((s) =>
      typeof s.detalhes === "string"
        ? { ...s, detalhes: interpolateBrandPlaceholders(s.detalhes, brand) }
        : s
    ),
  };
}

export function mapChatRow(
  row: {
    mensagem_id: string;
    canal_id: string;
    agente_id: string | null;
    autor: string;
    autor_nome: string | null;
    conteudo_markdown: string;
    anexos_json: string | null;
    steps_json: string | null;
    tarefa_id: string | null;
    lida: number;
    criado_em: string;
    thread_id?: string | null;
    turno_id?: string | null;
    item_type?: string | null;
    status?: string | null;
    resposta_para_mensagem_id?: string | null;
    ordinal?: number | null;
    branch_origem_mensagem_id?: string | null;
    metadados_json?: string | null;
    ui_block_json?: string | null;
    reacao_emoji?: string | null;
  },
  db?: CriativoDatabase | number,
  brand?: BrandSummary | null,
): MensagemChat {
  const metadados = row.metadados_json
    ? safeJsonParse<Record<string, unknown>>(row.metadados_json, {})
    : undefined;
  const uiBlock = row.ui_block_json
    ? safeJsonParse<ConversationUiBlock | null>(row.ui_block_json, null)
    : null;

  let skillSugestao: SkillSugestaoItem | null =
    metadados?.skill_sugestao && typeof metadados.skill_sugestao === "object"
      ? (metadados.skill_sugestao as SkillSugestaoItem)
      : null;

  const validDb =
    db && typeof db === "object" && "connection" in db ? (db as CriativoDatabase) : undefined;

  if (validDb && (skillSugestao || row.item_type?.startsWith("skill-suggestion:"))) {
    try {
      const sugRow = validDb.connection
        .prepare("SELECT * FROM projecao_skill_sugestoes WHERE mensagem_id = ? LIMIT 1;")
        .get(row.mensagem_id) as SkillSugestaoItem | undefined;
      if (sugRow) {
        skillSugestao = sugRow;
      }
    } catch {
      // ignora caso tabela ainda não exista
    }
  }

  let visualPage: ChatVisualMeta | null =
    metadados?.visual_page && typeof metadados.visual_page === "object"
      ? (metadados.visual_page as ChatVisualMeta)
      : null;
  if (!visualPage && row.item_type?.startsWith("visual-reply:") && metadados) {
    const heightNum = Number(row.item_type.split(":")[1]);
    if (typeof metadados.arquivo_id === "string") {
      visualPage = {
        arquivo_id: metadados.arquivo_id,
        titulo: typeof metadados.titulo === "string" ? metadados.titulo : "Painel Interativo",
        altura_inicial: Number.isFinite(heightNum) ? heightNum : undefined,
      };
    }
  }

  const memoryChanges: MemoryReviewAlteracao[] | null = Array.isArray(metadados?.memory_changes)
    ? (metadados.memory_changes as MemoryReviewAlteracao[])
    : null;

  const rawMsg: MensagemChat = {
    mensagem_id: row.mensagem_id,
    canal_id: row.canal_id,
    agente_id: row.agente_id,
    autor: (row.autor as MensagemChat["autor"]) ?? "agente",
    autor_nome: row.autor_nome ?? undefined,
    conteudo_markdown: row.conteudo_markdown,
    anexos: safeJsonParse<AnexoChat[]>(row.anexos_json, []),
    steps: safeJsonParse<PassoChat[]>(row.steps_json, []),
    tarefa_id: row.tarefa_id,
    ...(row.thread_id !== undefined ? { thread_id: row.thread_id } : {}),
    ...(row.turno_id !== undefined ? { turno_id: row.turno_id } : {}),
    ...(row.item_type ? { item_type: row.item_type as MensagemChat["item_type"] } : {}),
    ...(row.status ? { status: row.status as MensagemChat["status"] } : {}),
    ...(row.resposta_para_mensagem_id !== undefined
      ? { resposta_para_mensagem_id: row.resposta_para_mensagem_id }
      : {}),
    ...(typeof row.ordinal === "number" ? { ordinal: row.ordinal } : {}),
    ...(row.branch_origem_mensagem_id !== undefined
      ? { branch_origem_mensagem_id: row.branch_origem_mensagem_id }
      : {}),
    ...(metadados ? { metadados } : {}),
    ...(uiBlock ? { ui_block: uiBlock } : {}),
    ...(row.reacao_emoji ? { reacao_emoji: row.reacao_emoji } : {}),
    ...(skillSugestao ? { skill_sugestao: skillSugestao } : {}),
    ...(visualPage ? { visual_page: visualPage } : {}),
    ...(memoryChanges ? { memory_changes: memoryChanges } : {}),
    lida: row.lida !== 0,
    criado_em: row.criado_em,
  };

  return applyBrandToMessage(rawMsg, brand);
}

export async function readRawBodyFallback(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function resolveWorkflowRuntime(deps: StudioRoutesDeps): {
  store: WorkflowStore;
  engine?: WorkflowEngine;
  triggers?: WorkflowTriggers;
} {
  const store = deps.workflowStore ?? new WorkflowStore({ db: deps.db, vault: deps.vault });
  return {
    store,
    engine: deps.workflowEngine,
    triggers: deps.workflowTriggers,
  };
}
