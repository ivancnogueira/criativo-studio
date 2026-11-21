import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
import type { CriativoDatabase } from "../database/client.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import { HandoffBus } from "../engine/runner/handoff-bus.ts";
import {
  getDeletedNativeAgentsMeta,
  getSetupCompatibleRoster,
  markNativeAgentDeleted,
  ROSTER_15_AGENTES,
  SETUP_ASSISTANT_AGENT_DEF,
  unmarkNativeAgentDeleted,
} from "../engine/runner/roster-defaults.ts";
import { mutateSidebarLayout } from "./sidebar-service.ts";
import { SkillLoader } from "../engine/runner/skill-loader.ts";
import type { CatalogService } from "../marketplace/catalog-service.ts";
import type { GithubImporter } from "../marketplace/github-importer.ts";
import type { SkillsManager } from "../marketplace/skills-manager.ts";
import type { McpGateway, McpOAuthRequiredNotice } from "../mcp/mcp-gateway.ts";
import { redactMcpPayload, redactMcpSecrets } from "../mcp/mcp-redaction.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { LicenseValidationError, type LicenseClientService } from "../license/license-service.ts";
import type { LocalServerManager } from "../servers/local-server-manager.ts";
import type { RemoteClaimService } from "../servers/remote-claim-service.ts";
import type { RemoteOAuthBridgeService } from "../servers/remote-oauth-bridge.ts";
import { ServerQuotaExceededError } from "../servers/server-quota.ts";
import type { AutoUpdateService } from "../updater/auto-update-service.ts";
import {
  buildConnectorsList,
  computeHostAnalytics,
  importExternalTelemetryIfAvailable,
  listInstalledSkills,
  loadSkillPromptBySlug,
  recordChatTurnUsage,
  recordSkillLoadUsage,
} from "./analytics-skills-service.ts";
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
} from "./brand-onboarding-service.ts";
import { tryHandleWhatsAppMcpStoreRoute } from "./routes-whatsapp-mcp-store.ts";
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
} from "./studio-tools-bridge.ts";
export { selectBalancedVisualAssets, type LabeledVisualAsset };
import {
  generateImageTool,
  resolveVaultSecretCaseInsensitive,
} from "../engine/tools/generate-image.ts";
import {
  BackupModelsResolver,
  isRetryableQuotaOrProviderError,
  MAX_BACKUP_MODELS,
  parseBackupModelsJson,
} from "../engine/runner/backup-models-resolver.ts";
import type { BrowserAutomationService } from "../engine/tools/browser-automation.ts";
import type { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import type { ShowcaseSiteService } from "./showcase-service.ts";
import type { ConnectorsWebhookService } from "./connectors-webhook-service.ts";
import type { TranscriptionService } from "../voice/transcription-service.ts";
import { tryHandleThreadsRoute, type Phase13ServicesBundle } from "./threads-routes.ts";
import type { SharedTablesService } from "../agent-data/shared-tables-service.ts";
import { SharedTablesError } from "../agent-data/shared-tables-service.ts";
import { MemoryManager } from "../engine/runner/memory-manager.ts";
import type { MemoryReviewService } from "../engine/runner/memory-review-service.ts";
import type { SkillLearningService } from "../engine/runner/skill-learning-service.ts";
import type { HistorySearchService } from "../engine/runner/history-search-service.ts";
import type { LibraryFoldersService } from "../engine/runner/library-folders-service.ts";
import type { ChatVisualPreviewService } from "../engine/runner/chat-visual-preview-service.ts";
import { UiBlockHttpError, type UiBlockRegistry } from "../engine/runner/ui-block-registry.ts";
import type { ApiKeysBridge } from "../vault/api-keys-bridge.ts";
import type { RoutineToolsDeps } from "../routines/routine-agent-tools.ts";
import type { TelegramNotificationBot } from "../messaging/telegram-bot.ts";
import type { WorkflowEngine } from "../workflows/workflow-engine.ts";
import { WorkflowStore, WorkflowValidationError } from "../workflows/workflow-store.ts";
import type { WorkflowTriggers } from "../workflows/workflow-triggers.ts";
import { resolveAgentRecord } from "./agent-resolver.ts";
import { planTurnContext, toolBelongsToScopes } from "./turn-context-planner.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

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
}

const RAW_MIME_MAP: Record<string, string> = {
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

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeFileName(rawName: string): string {
  const base = basename(rawName || "anexo.png")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || `anexo-${Date.now()}.bin`;
}

function inferTipoUso(mime: string, requested?: string): ArquivoStudio["tipo_uso"] {
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

type BrandSummary = { marca_nome: string; perfil_handle: string };

function applyBrandToMessage(msg: MensagemChat, brand?: BrandSummary | null): MensagemChat {
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

function mapChatRow(
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

async function readRawBodyFallback(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function resolveWorkflowRuntime(deps: StudioRoutesDeps): {
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

export interface ParsedTextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export function compactRecentHistory(
  history: MensagemChat[],
  maxMessages = 6,
  maxCharsPerMessage = 1200
): Array<{ role: "user" | "assistant"; text: string }> {
  return history.slice(-maxMessages).map((item) => {
    const raw = item.conteudo_markdown ?? "";
    const text =
      raw.length > maxCharsPerMessage
        ? `${raw.slice(0, maxCharsPerMessage)}\n...[mensagem compactada]`
        : raw;
    return {
      role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
      text,
    };
  });
}

export function parseWorkflowTextToolCalls(text: string): ParsedTextToolCall[] {
  const calls: ParsedTextToolCall[] = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof parsed.name === "string") {
        const normalizedName = parsed.name
          .replace(/^(?:mcp__criativo_studio__|criativo_studio_|criativo-studio_)/, "")
          .trim();
        if (
          isWorkflowToolName(normalizedName) ||
          isPhase13ToolName(normalizedName) ||
          isPhase14ToolName(normalizedName) ||
          isPhase15ToolName(normalizedName) ||
          isPhase10ExtensionTool(normalizedName)
        ) {
          calls.push({
            name: normalizedName,
            arguments:
              parsed.arguments && typeof parsed.arguments === "object"
                ? (parsed.arguments as Record<string, unknown>)
                : {},
          });
        }
      }
    } catch {
      // ignora bloco inválido
    }
  }
  return calls;
}

async function runTextModelWorkflowToolLoop(params: {
  initialText: string;
  invokeFollowUp: (promptFollowUp: string) => Promise<string>;
  deps: StudioRoutesDeps;
  agenteId: string;
  turnId: string;
  threadId?: string | null;
  entregaOrigemId?: string;
  pedidoTexto?: string;
  isRoutine?: boolean;
  isResumingWait?: boolean;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  signal?: AbortSignal;
  steps: PassoChat[];
  anexosGerados?: AnexoChat[];
  onProgress?: (event: {
    fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
    mensagem_status?: string;
    step?: PassoChat;
    delta?: string;
  }) => void;
}): Promise<string> {
  let currentText = params.initialText;
  const hasWorkflow = Boolean(params.deps.workflowStore && params.deps.workflowEngine);
  const workspaceRoot = params.deps.workspaceRoot ?? process.cwd();

  for (let round = 0; round < 4; round += 1) {
    if (params.signal?.aborted) {
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    const calls = parseWorkflowTextToolCalls(currentText);
    if (calls.length === 0) break;

    const toolResults: Array<{ name: string; output: unknown }> = [];
    for (const call of calls) {
      const t0 = Date.now();
      const toolName = call.name.replace(/^mcp__criativo_studio__/, "").trim();
      let out: unknown;
      let failed = false;
      try {
        const effectiveCanalId =
          params.threadId && !params.threadId.startsWith("main:")
            ? `thread:${params.threadId}`
            : `agente:${params.agenteId}`;

        if (
          !isAgentAuthorizedForStudioTool(toolName, params.agenteId, {
            db: params.deps.db,
            vault: params.deps.vault,
            catalogService: params.deps.catalogService,
          })
        ) {
          throw new Error(
            `Acesso negado: o agente '${params.agenteId}' não possui autorização na Loja para usar '${toolName}'.`
          );
        }

        if (isPhase15ToolName(toolName)) {
          out = await executePhase15ChatTool({
            toolName,
            args: call.arguments,
            agenteId: params.agenteId,
            canalId: effectiveCanalId,
            deps: {
              db: params.deps.db,
              wsHub: params.deps.wsHub,
              workspaceRoot,
              browserService: params.deps.browserService,
              screenCapture: params.deps.screenCapture,
              showcaseService: params.deps.showcaseService,
              transcription: params.deps.transcription,
              remoteClaimService: params.deps.remoteClaimService ?? undefined,
            },
          });
        } else if (isPhase10ExtensionTool(toolName)) {
          out = await executeStudioExtensionTool(toolName, call.arguments, {
            db: params.deps.db,
            vault: params.deps.vault,
            wsHub: params.deps.wsHub,
            workspaceRoot,
            agenteId: params.agenteId,
            canalId: effectiveCanalId,
            mcpGateway: params.deps.mcpGateway,
            catalogService: params.deps.catalogService,
            nativeStore: params.deps.catalogService?.nativeStore,
            providerConnection: params.deps.providerConnection,
            skillsManager: params.deps.skillsManager,
            whatsappManager: params.deps.whatsappManager,
            whatsappOrchestrator: params.deps.whatsappOrchestrator,
            onImageProgress: (evt) => {
              params.onProgress?.({
                fase: "etapa",
                mensagem_status: evt.mensagem,
                step: {
                  id: evt.stepId,
                  ferramenta: toolName,
                  titulo: evt.mensagem,
                  formato: evt.formato,
                  status: evt.status,
                },
              });
            },
          });
          if (
            (toolName === "generate_image" || toolName === "generate_video") &&
            out &&
            typeof out === "object" &&
            "anexo" in out &&
            (out as { anexo?: AnexoChat }).anexo
          ) {
            params.anexosGerados?.push((out as { anexo: AnexoChat }).anexo);
          }
        } else if (isRoutineToolName(toolName)) {
          out = await executeStudioRoutineTool(toolName, call.arguments, {
            agenteId: params.agenteId,
            turnOrigin: "human",
            routineToolsDeps: params.deps.routineToolsDeps,
          });
        } else if (isWorkflowToolName(toolName) && hasWorkflow) {
          out = await executeChatWorkflowTool(toolName, call.arguments, {
            store: params.deps.workflowStore,
            engine: params.deps.workflowEngine,
            wsHub: params.deps.wsHub,
            agenteId: params.agenteId,
            requestSeed: params.turnId,
          });
        } else if (isPhase14ToolName(toolName) && params.deps.phase14) {
          out = await executePhase14ToolCall(
            toolName,
            call.arguments,
            {
              agenteId: params.agenteId,
              canalId: effectiveCanalId,
              threadId: params.threadId ?? `main:${params.agenteId}`,
              turnId: params.turnId,
              origemTurno: params.isRoutine ? "rotina" : "usuario_local",
              isOneToOneUserChat: !params.isRoutine && effectiveCanalId === `agente:${params.agenteId}`,
              lastUserMessageId: params.entregaOrigemId ?? null,
            },
            params.deps.phase14,
          );
        } else if (isPhase13ToolName(toolName) && params.deps.phase13) {
          const p13 = await executePhase13Tool(
            toolName,
            call.arguments,
            {
              agenteId: params.agenteId,
              turnoId: params.turnId,
              callId: `${params.turnId}:${round}:${toolName}`,
              threadId: params.threadId ?? `main:${params.agenteId}`,
              canalId: effectiveCanalId,
              entregaOrigemId: params.entregaOrigemId ?? params.turnId,
              pedidoTexto: params.pedidoTexto ?? "",
              isRoutine: params.isRoutine,
              isResumingWait: params.isResumingWait,
              channelOrigin: params.channelOrigin,
              whatsappContaId: params.whatsappContaId ?? null,
              whatsappChatJid: params.whatsappChatJid ?? null,
            },
            {
              ...params.deps.phase13,
              db: params.deps.db,
            },
          );
          out = p13.result;
        } else if (params.deps.mcpGateway && toolName.startsWith("mcp_")) {
          out = await params.deps.mcpGateway.callMcpTool(toolName, call.arguments, {
            agentId: params.agenteId,
          });
        } else {
          failed = true;
          out = { erro: `Serviço indisponível para ferramenta '${toolName}'.` };
        }
      } catch (err) {
        failed = true;
        out = { erro: err instanceof Error ? err.message : String(err) };
      }

      const step: PassoChat = {
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: call.name,
        titulo: failed ? `Falha em ${call.name}` : `Ferramenta ${call.name} executada`,
        detalhes: JSON.stringify(out).slice(0, 800),
        status: failed ? "erro" : "concluido",
        duracao_ms: Date.now() - t0,
      };
      params.steps.push(step);
      params.onProgress?.({ fase: "etapa", mensagem_status: step.titulo, step });
      toolResults.push({ name: call.name, output: out });
    }

    currentText = await params.invokeFollowUp(
      `Resultados das ferramentas executadas:\n${JSON.stringify(toolResults, null, 2)}\n\nContinue respondendo ao usuário em pt-br com base nesses resultados reais (ou chame nova ferramenta via <tool_call> se necessário).`
    );
  }

  return currentText;
}

function loadResolvableAgentsForRouting(
  db?: CriativoDatabase,
): readonly { agente_id: string; nome?: string | null }[] {
  if (db) {
    try {
      const rows = db.connection
        .prepare("SELECT agente_id, nome FROM projecao_agentes ORDER BY ordem_exibicao ASC;")
        .all() as Array<{ agente_id: string; nome: string }>;
      if (rows.length > 0) return rows;
    } catch {
      // Fallback caso tabela ainda não exista
    }
  }
  return ROSTER_15_AGENTES;
}

export function extractMentionedAgentIds(
  text: string,
  excludeId?: string,
  db?: CriativoDatabase,
): string[] {
  const found = new Set<string>();
  const agentsList = loadResolvableAgentsForRouting(db);

  // Detecta [HANDOFF:agente_id_ou_apelido] ou @agente_id_ou_apelido no texto
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_-]+)\]/gi)) {
    const resolved = resolveAgentRecord(agentsList, m[1]);
    if (resolved && resolved.agente_id !== excludeId) found.add(resolved.agente_id);
  }
  for (const m of text.matchAll(/@([a-z0-9_-]+)/gi)) {
    const resolved = resolveAgentRecord(agentsList, m[1]);
    if (resolved && resolved.agente_id !== excludeId) found.add(resolved.agente_id);
  }
  return Array.from(found);
}

export function extractExplicitAgentHandoffTags(
  text: string,
  excludeId?: string,
  db?: CriativoDatabase,
): string[] {
  const found = new Set<string>();
  const agentsList = loadResolvableAgentsForRouting(db);
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_-]+)\]/gi)) {
    const resolved = resolveAgentRecord(agentsList, m[1]);
    if (resolved && resolved.agente_id !== excludeId) found.add(resolved.agente_id);
  }
  return Array.from(found);
}

const EXPLICIT_CREATION_ACTION_RE =
  /(?:^|\b)(crie|criar|gere|gerar|fa[cç]a|fazer|produza|produzir|monte|montar|desenhe|desenhar|refa[cç]a|refazer|ajuste|ajustar|renderize|renderizar|cria|gera|faz|quero um|quero uma|preciso de um|preciso de uma)\b/i;

const IMPERATIVE_OR_WANT_RE =
  /(?:^|\b)(crie|gere|fa[cç]a|produza|monte|desenhe|refa[cç]a|ajuste|renderize|quero um|quero uma|preciso de um|preciso de uma)\b/i;

const EXPLICIT_VISUAL_ASSET_NOUN_RE =
  /\b(imagem|imagens|arte|artes|banner|capa|post|posts|carrossel|carross[eé]is|slide|slides|l[aâ]mina|l[aâ]minas|storie|stories|story|criativo|criativos|an[uú]ncio|an[uú]ncios)\b/i;

const DIRECT_IMAGE_NOUN_RE =
  /\b(imagem|imagens|arte|artes|foto|fotos|banner|capa|ilustra[cç][aã]o)\b/i;

export function isGreetingOrCapabilityQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const clean = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+$/g, "")
    .trim();

  if (
    /^(oi+|ola+|e ai|opa|eae|hello|hi|bom dia|boa tarde|boa noite|tudo bem|td bem|teste|ok|obrigad[oa]|valeu|tente novamente|novamente)$/i.test(
      clean
    )
  ) {
    return true;
  }

  const isCapabilityOrAccessQuestion =
    /(o que (voce|vc|voces|vcs) (pode|consegue|sabe|faz)|quais (sao )?(as )?(suas )?(funcoes|capacidades|pastas|referencias|arquivos)|como (voce|vc|isso|o studio) funciona|(voce|vc) tem acesso|tem acesso a|pode me explicar|me explique|quem e voce|quem eh voce)/i.test(
      clean
    ) && clean.length < 180;

  if (isCapabilityOrAccessQuestion && !IMPERATIVE_OR_WANT_RE.test(clean)) {
    return true;
  }

  if (EXPLICIT_CREATION_ACTION_RE.test(trimmed)) return false;

  return false;
}

const VISUAL_FOLLOWUP_CORRECTION_RE =
  /(n[aã]o\s+(sou\s+eu|use\s+ess[ae]|eh\s+essa)|esse\s+a[ií]\s+n[aã]o|foto\s+errad[ao]|pasta\s+errad[ao]|minhas?\s+fotos?|recursos\/fotos|refa[cç]a|tenta\s+de\s+novo|tentar\s+novamente|gera\s+outr[ao]|usa\s+a?\s*minha\s+foto|cade\s+a?\s*imagem|^\s*(kd|cad[eê])\??\s*$)/i;

export function hasExplicitVisualGenerationIntent(
  userPrompt: string,
  agentId: string,
  isHandoff = false,
  history: MensagemChat[] = []
): boolean {
  if (isGreetingOrCapabilityQuestion(userPrompt)) return false;

  const isVisualAgent = agentId.startsWith("designer_") || agentId === "consistencia_visual";
  const hasRecentVisualContext =
    isVisualAgent ||
    history.slice(-6).some((m) => {
      const hasGeneratedAnexo = Array.isArray(m.anexos) && m.anexos.some((a) => a?.tipo_uso === "gerado");
      if (hasGeneratedAnexo) return true;
      return /(gerar|processando\s+a\s+arte|arte|imagem|post|storie|carrossel|recursos\/fotos|recursos\/referencias)/i.test(
        m.conteudo_markdown || ""
      );
    });

  if (VISUAL_FOLLOWUP_CORRECTION_RE.test(userPrompt) && hasRecentVisualContext && !isHandoff) {
    return true;
  }

  if (!EXPLICIT_CREATION_ACTION_RE.test(userPrompt)) return false;

  if (isVisualAgent) {
    return EXPLICIT_VISUAL_ASSET_NOUN_RE.test(userPrompt);
  }
  if (isHandoff) {
    return false;
  }
  // Agentes não-visuais (estrategista, copywriter, etc.) só geram imagem se o usuário pedir explicitamente uma imagem/arte
  return DIRECT_IMAGE_NOUN_RE.test(userPrompt);
}

function enrichAgentRow(
  db: CriativoDatabase,
  row: {
    agente_id: string;
    nome: string;
    papel: string;
    modelo_padrao: string;
    status: string;
    skills_paths_json: string;
    memoria_resumo: string | null;
    ordem_exibicao: number;
    config_json: string;
    backup_models_json?: string | null;
    permission_level?: string | null;
    allow_new_chat?: number | null;
    allow_quick_ack?: number | null;
    browser_profile_id?: string | null;
    pinned?: number | null;
    hidden?: number | null;
    section_id?: string | null;
    notification_level?: string | null;
    atualizado_em: string;
  },
  workspaceRoot = process.cwd(),
  licenseService?: LicenseClientService,
  brand?: BrandSummary | null,
) {
  const canalId = `agente:${row.agente_id}`;
  const unreadRow = db.connection
    .prepare(
      `SELECT COUNT(*) as total FROM projecao_conversas_chat WHERE canal_id = ? AND lida = 0;`
    )
    .get(canalId) as { total: number };
  const lastRow = db.connection
    .prepare(
      `SELECT conteudo_markdown, criado_em FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC LIMIT 1;`
    )
    .get(canalId) as { conteudo_markdown: string; criado_em: string } | undefined;

  const def =
    ROSTER_15_AGENTES.find((a) => a.agente_id === row.agente_id) ??
    (row.agente_id === SETUP_ASSISTANT_AGENT_DEF.agente_id ? SETUP_ASSISTANT_AGENT_DEF : undefined);
  const parsedConfig = safeJsonParse<Record<string, unknown>>(row.config_json, {});
  const pacote = (
    parsedConfig.pacote === "bonus" || parsedConfig.pacote === "video"
      ? parsedConfig.pacote
      : def?.pacote ?? "base"
  ) as "base" | "bonus" | "video";
  const upgradeDesbloqueado = isUpgradeUnlocked(db, workspaceRoot, pacote, licenseService);
  const rawPromptBase =
    typeof parsedConfig.prompt_base === "string" && parsedConfig.prompt_base.trim().length > 0
      ? parsedConfig.prompt_base
      : def?.prompt_base ?? "";
  const activeBrand = brand && hasConfiguredBrand(brand) ? brand : null;
  const promptBase = activeBrand
    ? interpolateBrandPlaceholders(rawPromptBase, activeBrand)
    : rawPromptBase;
  const resolvedPapel = activeBrand
    ? interpolateBrandPlaceholders(row.papel, activeBrand)
    : row.papel;

  const backupModels = parseBackupModelsJson(row.backup_models_json);
  const permissionLevel: PermissionLevel =
    row.permission_level === "ask" || row.permission_level === "full"
      ? row.permission_level
      : "workspace";
  const allowNewChat = row.allow_new_chat !== 0;
  const allowQuickAck = row.allow_quick_ack !== 0;
  const browserProfileId = row.browser_profile_id ?? null;
  const notificationLevel: AgentNotificationLevel =
    row.notification_level === "mentions" || row.notification_level === "muted"
      ? row.notification_level
      : "all";
  const pinned = row.pinned === 1;
  const hidden = row.hidden === 1;
  const sectionId = row.section_id ?? null;

  const config = {
    ...parsedConfig,
    pacote,
    upgrade_desbloqueado: upgradeDesbloqueado,
    skill_slug: parsedConfig.skill_slug ?? def?.skill_slug,
    ferramentas: Array.isArray(parsedConfig.ferramentas)
      ? parsedConfig.ferramentas
      : def?.ferramentas ?? ["handoff_agente"],
    prompt_base: promptBase,
    backup_models: backupModels,
    permission_level: permissionLevel,
    allow_new_chat: allowNewChat,
    allow_quick_ack: allowQuickAck,
    allow_quick_acknowledgement: allowQuickAck,
    browser_profile_id: browserProfileId,
    notification_level: notificationLevel,
    pinned,
    hidden,
    section_id: sectionId,
  };

  const rawLastMessage = lastRow
    ? lastRow.conteudo_markdown.replace(/\s+/g, " ").slice(0, 96)
    : null;
  const resolvedLastMessage =
    rawLastMessage && activeBrand
      ? interpolateBrandPlaceholders(rawLastMessage, activeBrand)
      : rawLastMessage;

  const rawUnreadCount = Number(unreadRow?.total ?? 0);
  const naoLidasFinal =
    parsedConfig.marked_unread === true ? Math.max(1, rawUnreadCount) : rawUnreadCount;

  return {
    ...row,
    papel: resolvedPapel,
    config,
    backup_models: backupModels,
    permission_level: permissionLevel,
    allow_new_chat: allowNewChat,
    allow_quick_ack: allowQuickAck,
    browser_profile_id: browserProfileId,
    notification_level: notificationLevel,
    pinned,
    hidden,
    section_id: sectionId,
    nao_lidas: naoLidasFinal,
    ultima_mensagem: resolvedLastMessage,
    ultima_mensagem_em: lastRow?.criado_em ?? row.atualizado_em,
  };
}

interface ChatProgressReport {
  fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
  mensagem_status?: string;
  step?: PassoChat;
  delta?: string;
}

/**
 * Sincroniza anexos gerados pelo agente neste turno no banco (`gerado` ou `video`),
 * garantindo exibição no chat inclusive quando criados via chamada HTTP ao MCP Bridge.
 */
function syncTurnGeneratedMediaAttachments(
  db: CriativoDatabase,
  agenteId: string,
  turnStartedIso: string,
  anexosGerados: AnexoChat[],
): void {
  try {
    const existingIds = new Set(anexosGerados.map((a) => a.arquivo_id));
    const existingPaths = new Set(anexosGerados.map((a) => a.caminho_relativo));
    const rows = db.connection
      .prepare(
        `SELECT arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso
         FROM projecao_arquivos
         WHERE agente_id = ?
           AND tipo_uso IN ('gerado', 'video')
           AND criado_em >= ?
         ORDER BY criado_em ASC;`
      )
      .all(agenteId, turnStartedIso) as Array<{
      arquivo_id: string;
      nome_original: string;
      caminho_relativo: string;
      mime_type: string;
      tamanho_bytes: number;
      tipo_uso: string;
    }>;

    for (const row of rows) {
      if (existingIds.has(row.arquivo_id) || existingPaths.has(row.caminho_relativo)) {
        continue;
      }
      anexosGerados.push({
        arquivo_id: row.arquivo_id,
        nome: row.nome_original,
        caminho_relativo: row.caminho_relativo,
        url: `/api/arquivos/raw?path=${encodeURIComponent(row.caminho_relativo)}`,
        mime_type: row.mime_type,
        tamanho_bytes: row.tamanho_bytes,
        tipo_uso: row.tipo_uso === "video" ? "video" : "gerado",
      });
    }
  } catch {
    // ignora caso tabela não esteja disponível em cenários mínimos
  }
}

export async function generateAgentChatReply(
  deps: StudioRoutesDeps,
  agente: {
    agente_id: string;
    nome: string;
    papel: string;
    modelo_padrao: string;
    config_json: string;
    backup_models_json?: string | null;
  },
  userPrompt: string,
  anexos: AnexoChat[],
  history: MensagemChat[],
  onProgress?: (evt: ChatProgressReport) => void,
  options?: {
    isHandoff?: boolean;
    originalUserPrompt?: string;
    threadId?: string | null;
    turnoId?: string;
    signal?: AbortSignal;
    wokenWaitsBlock?: string | null;
    entregaOrigemId?: string;
    isRoutine?: boolean;
    overrideModel?: string;
    overrideAccountId?: string | null;
    channelOrigin?: "web" | "whatsapp";
    whatsappContaId?: string | null;
    whatsappChatJid?: string | null;
  }
): Promise<{
  markdown: string;
  steps: PassoChat[];
  tarefaCriadaId: string | null;
  anexosGerados: AnexoChat[];
  usageLimitAsk?: UsageLimitAskPayload;
}> {
  const turnStartedIso = new Date().toISOString();
  onProgress?.({
    fase: "iniciado",
    mensagem_status: `Preparando contexto para ${agente.nome}...`,
  });
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const config = safeJsonParse<Record<string, unknown>>(agente.config_json, {});
  const onboarding = deps.providerConnection.getOnboardingState();
  const skillSlug = typeof config.skill_slug === "string" ? config.skill_slug : agente.agente_id;
  const intentSourcePrompt = options?.originalUserPrompt ?? userPrompt;
  const greetingOrCapability = isGreetingOrCapabilityQuestion(intentSourcePrompt);

  const mcpTools = deps.mcpGateway
    ? await deps.mcpGateway.getToolsForAgent(agente.agente_id).catch(() => [])
    : [];
  const hasOpenBrowserTabs =
    (deps.browserService?.sessionManager?.listTabSummaries(agente.agente_id)?.length ?? 0) > 0;
  const hasActiveWakeups = Boolean(deps.phase13?.wakeupService?.hasActiveWakeups(agente.agente_id));
  const recentHistoryText = history
    .slice(-3)
    .map((m) => m.conteudo_markdown ?? "")
    .join("\n");

  const turnPlan = planTurnContext({
    userPrompt: intentSourcePrompt,
    agenteId: agente.agente_id,
    isGreetingOrCapability: greetingOrCapability,
    anexosCount: anexos.length,
    hasOpenBrowserTabs,
    hasActiveWakeups,
    hasWokenWaits: Boolean(options?.wokenWaitsBlock),
    isHandoff: Boolean(options?.isHandoff),
    isRoutine: Boolean(options?.isRoutine),
    channelOrigin: options?.channelOrigin,
    recentHistoryText,
    hasExternalMcps: mcpTools.length > 0,
  });

  const loadedSkill =
    !turnPlan.loadFullSkill || process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1"
      ? null
      : loadSkillPromptBySlug(skillSlug, undefined, workspaceRoot, {
          db: deps.db,
          licenseService: deps.licenseService,
          productRoot: deps.productRoot,
        });
  const linkedSkills = turnPlan.loadFullSkill
    ? new SkillLoader([], workspaceRoot).loadLinkedAgentSkills(deps.db, agente.agente_id)
    : [];

  // Em modo light, pula leitura de memórias e snippets pesados para evitar inchaço de tokens
  const memories =
    turnPlan.mode === "light"
      ? []
      : (deps.db.connection
          .prepare(`SELECT texto FROM projecao_agente_memorias WHERE agente_id = ? ORDER BY criado_em DESC LIMIT 8;`)
          .all(agente.agente_id) as Array<{ texto: string }>);

  const liveStudioContext = buildStudioLiveContext({
    db: deps.db,
    vault: deps.vault,
    providerConnection: deps.providerConnection,
    workspaceRoot,
    agenteId: agente.agente_id,
    memoryManager: deps.memoryManager,
    userPrompt,
    compact: turnPlan.compactLiveContext,
  });

  const promptBaseParts = [
    typeof config.prompt_base === "string" && config.prompt_base.length > 0
      ? config.prompt_base
      : `Você é ${agente.nome} (${agente.papel}) do Criativo AI Studio para ${onboarding.marca_nome} (${onboarding.perfil_handle}).`,
    liveStudioContext,
  ];
  if (loadedSkill) {
    promptBaseParts.push(`Instruções oficiais da habilidade ${skillSlug}:\n${loadedSkill.body.slice(0, 2800)}`);
  }
  const extraLinkedSkills = linkedSkills.filter((s) => s.slug !== skillSlug || !loadedSkill);
  if (extraLinkedSkills.length > 0) {
    promptBaseParts.push(
      extraLinkedSkills
        .map((s) => `Habilidade vinculada ${s.name} (${s.slug}):\n${s.body.slice(0, 1800)}`)
        .join("\n\n")
    );
  }
  if (memories.length > 0) {
    promptBaseParts.push(`Memórias do agente:\n${memories.map((m) => `- ${m.texto}`).join("\n")}`);
  }
  if (agente.agente_id.startsWith("designer_") || agente.agente_id === "consistencia_visual") {
    promptBaseParts.push(
      "REGRA ANTI-ALUCINAÇÃO VISUAL: NUNCA responda ao usuário dizendo 'já estou processando/gerando a arte' ou prometendo mostrar a imagem em instantes sem realmente invocar a ferramenta `generate_image`. Se nenhuma arte nova foi gerada neste turno, invoque `generate_image` agora ou explique exatamente o impedimento técnico."
    );
  }

  // Ponte nativa para validação real da Meta Graph API (sem expor tokens)
  const lowerCheck = userPrompt.toLowerCase();
  const asksMetaValidation =
    agente.agente_id === "engenheiro_meta" &&
    /(validar|valida|valide|testar|teste|status|diagn[oó]stico|integra[cç][aã]o|meta|instagram|credencia)/i.test(
      lowerCheck
    );

  const graphVersion = resolveMetaGraphApiVersion();
  const canUseMetaTools = isAgentAuthorizedForStudioTool("validar_integracao_meta", agente.agente_id, {
    db: deps.db,
    vault: deps.vault,
    catalogService: deps.catalogService,
  });
  let metaValidationSummary: Awaited<ReturnType<typeof validateMetaIntegration>> | null = null;
  if (asksMetaValidation && deps.vault && canUseMetaTools) {
    const tMeta0 = Date.now();
    metaValidationSummary = await validateMetaIntegration(deps.vault, undefined, {
      nativeStore: deps.catalogService?.nativeStore,
    });
    const metaStep: PassoChat = {
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API ${graphVersion} validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · Estágio ${metaValidationSummary.estagio})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 80)}`,
      detalhes: JSON.stringify({
        tokenConfigurado: metaValidationSummary.detalhes.tokenConfigurado,
        accountIdConfigurado: metaValidationSummary.detalhes.accountIdConfigurado,
        graphApiOk: metaValidationSummary.detalhes.graphApiOk,
        username: metaValidationSummary.detalhes.username,
        followersCount: metaValidationSummary.detalhes.followersCount,
        mediaCount: metaValidationSummary.detalhes.mediaCount,
      }),
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: Date.now() - tMeta0,
    };
    onProgress?.({
      fase: "etapa",
      mensagem_status: metaValidationSummary.resumo,
      step: metaStep,
    });
    promptBaseParts.push(
      `## Resultado Real Executado Agora por validar_integracao_meta (Cofre SQLite + Graph API ${graphVersion})\n${JSON.stringify(
        metaValidationSummary,
        null,
        2
      )}\nBaseie sua resposta exclusivamente neste diagnóstico real sem jamais pedir ou exibir tokens.`
    );
  }

  if (
    deps.workflowStore &&
    deps.workflowEngine &&
    turnPlan.mode === "action" &&
    turnPlan.mcpScopes.includes("workflows")
  ) {
    promptBaseParts.push(
      `## Ferramentas de Workflow em Grafo Disponíveis\nVocê pode inspecionar, criar/editar, executar (completo ou parcial a partir de um nó) e consultar histórico de workflows pelas ferramentas: list_workflows, read_workflow, edit_workflow, delete_workflow, run_workflow e read_workflow_runs. Regra crítica de segurança: JAMAIS execute delete_workflow sem confirmação humana explícita prévia (confirmed_by_human: true).`
    );
  }
  if (
    (deps.phase13 || options?.wokenWaitsBlock) &&
    turnPlan.mode === "action" &&
    (turnPlan.mcpScopes.includes("schedule") || Boolean(options?.wokenWaitsBlock))
  ) {
    promptBaseParts.push(
      buildPhase13SystemGuidance({
        allowStartTask:
          !options?.threadId || options.threadId.startsWith("main:") || Boolean(options?.isRoutine),
        wokenWaitsBlock: options?.wokenWaitsBlock,
      }),
    );
  }
  if (options?.channelOrigin === "whatsapp") {
    promptBaseParts.push(
      "[CANAL WHATSAPP ATIVO] Você está respondendo no WhatsApp (tela de celular). Seja natural, direto e conciso (máximo 1 a 4 parágrafos curtos ou lista breve com •). NUNCA use tabelas Markdown (|...|), NUNCA use títulos com # ou ##, e evite blocos longos de texto. Use apenas *negrito* simples quando necessário. Se o conteúdo completo for extenso, envie primeiro o resumo objetivo e pergunte se deseja os detalhes.",
    );
  }

  const promptBase = promptBaseParts.join("\n\n");
  const activeScopeSet = new Set(turnPlan.mcpScopes);
  const effectiveMcpTools = turnPlan.includeExternalMcps ? mcpTools : [];
  const availableChatToolsMap = new Map<string, ToolDefinition>();
  if (turnPlan.mode === "action") {
    const studioRoutineTools = deps.routineToolsDeps ? ROUTINE_AGENT_TOOLS_SCHEMA : [];
    const studioWorkflowTools =
      deps.workflowStore && deps.workflowEngine ? getChatWorkflowToolCatalog() : [];
    const studioPhase13Tools = deps.phase13 ? PHASE13_TOOLS_SCHEMA : [];
    const studioPhase14Tools = deps.phase14 ? PHASE14_TOOLS_SCHEMA : [];
    const studioPhase15Tools =
      deps.browserService || deps.screenCapture || deps.showcaseService || deps.remoteClaimService
        ? PHASE15_TOOLS_SCHEMA
        : [];
    for (const t of [
      ...PHASE10_TOOL_DEFINITIONS,
      ...studioRoutineTools,
      ...studioWorkflowTools,
      ...studioPhase13Tools,
      ...studioPhase14Tools,
      ...studioPhase15Tools,
      ...effectiveMcpTools,
    ]) {
      if (HIDDEN_CATALOG_TOOL_NAMES.has(t.name)) {
        continue;
      }
      if (!toolBelongsToScopes(t.name, activeScopeSet)) {
        continue;
      }
      if (
        !isAgentAuthorizedForStudioTool(t.name, agente.agente_id, {
          db: deps.db,
          vault: deps.vault,
          catalogService: deps.catalogService,
        })
      ) {
        continue;
      }
      if (!availableChatToolsMap.has(t.name)) {
        availableChatToolsMap.set(t.name, t);
      }
    }
  }
  const availableChatTools = Array.from(availableChatToolsMap.values());
  const toolFallbackNames = availableChatTools.map((t) => t.name);
  const studioToolsPromptGuidance =
    availableChatTools.length > 0
      ? `\n\n## Ferramentas Nativas & MCP (${toolFallbackNames.length})\nFerramentas autorizadas: ${toolFallbackNames.join(", ")}.\nPrefira chamar diretamente via MCP \`criativo_studio\` quando expostas no runtime; se apenas texto estiver ativo, emita \`<tool_call>{"name":"nome","arguments":{...}}</tool_call>\`. Nunca invente dados ou negue acesso a uma ferramenta listada acima.`
      : "";

  const turnMcpEndpointOpts = {
    scopes: turnPlan.mcpScopes,
    includeExternalMcps: turnPlan.includeExternalMcps,
    threadId: options?.threadId ?? `main:${agente.agente_id}`,
    channelOrigin: options?.channelOrigin,
    whatsappContaId: options?.whatsappContaId ?? null,
    whatsappChatJid: options?.whatsappChatJid ?? null,
  };
  const turnAcpMcpServers =
    turnPlan.mode === "light"
      ? []
      : deps.providerConnection.buildCombinedAcpMcpServers(
          agente.agente_id,
          turnMcpEndpointOpts,
        );
  const turnCliMcpConfig =
    turnPlan.mode === "light"
      ? null
      : deps.providerConnection.buildClaudeMcpConfig(
          agente.agente_id,
          turnMcpEndpointOpts,
        );

  const governance = readAgentGovernance(deps.db, agente.agente_id);
  const initialModel = options?.overrideModel?.trim() || agente.modelo_padrao;
  const providerName = deps.providers.resolveProviderName(initialModel);
  const agService = deps.providerConnection.getAntigravityService();
  const [statusList, agSnapshot] = await Promise.all([
    deps.providerConnection.getProvidersStatus(false),
    agService.getLiveSnapshot(false),
  ]);
  const claudeOAuthStatus = statusList.find((item) => item.provedor === "claude");
  const openaiOAuthStatus = statusList.find((item) => item.provedor === "openai");
  const opencodeStatus = statusList.find((item) => item.provedor === "opencode");

  const hasAntigravityAccount = agSnapshot.contas.some((c) => c.estado === "conectado" || Boolean(c.token_valido));
  const hasClaudeOAuthAccount = Boolean(claudeOAuthStatus?.contas && claudeOAuthStatus.contas.length > 0);
  const hasOpenAIOAuthAccount = Boolean(openaiOAuthStatus?.contas && openaiOAuthStatus.contas.length > 0);

  const skillStep: PassoChat = {
    id: `step-${randomUUID().slice(0, 8)}`,
    ferramenta: `skill:${skillSlug}`,
    titulo:
      turnPlan.mode === "light"
        ? "Contexto leve carregado — skills e MCPs sob demanda"
        : loadedSkill
          ? `Habilidade ${skillSlug} carregada de SKILL.md (${loadedSkill.tokensEst} tokens)`
          : `Contexto do especialista ${agente.nome} carregado (${agente.modelo_padrao})`,
    status: "concluido",
    duracao_ms: 45,
  };
  const steps: PassoChat[] = [skillStep];
  if (metaValidationSummary) {
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API ${graphVersion} validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · @${metaValidationSummary.detalhes.username ?? "conectado"})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 90)}`,
      detalhes: metaValidationSummary.resumo,
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: 95,
    });
  }
  onProgress?.({
    fase: "etapa",
    mensagem_status:
      turnPlan.mode === "light"
        ? "Contexto leve carregado — preparando resposta..."
        : loadedSkill
          ? `Habilidade ${skillSlug} carregada — preparando execução...`
          : `Contexto de ${agente.nome} carregado...`,
    step: skillStep,
  });

  const turnId = options?.turnoId ?? `turn-${randomUUID().slice(0, 8)}`;
  const assertNotAborted = (): void => {
    if (options?.signal?.aborted) {
      const abortErr = new Error("Turno interrompido via AbortSignal.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
  };
  assertNotAborted();
  const sessionId = `chat:${agente.agente_id}`;

  if (loadedSkill) {
    recordSkillLoadUsage(deps.db, {
      agentId: agente.agente_id,
      sessionId,
      turnId,
      provider: hasAntigravityAccount ? "antigravity" : providerName,
      model: agente.modelo_padrao,
      skill: skillSlug,
      tokens: loadedSkill.tokensEst,
    });
  }

  if (anexos.length > 0) {
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "image_paths_attach",
      titulo: `${anexos.length} arquivo(s) anexado(s) para referência visual / ImagePaths`,
      detalhes: anexos.map((a) => a.caminho_relativo).join(", "),
      status: "concluido",
      duracao_ms: 28,
    });
  }

  // Verifica intenção explícita de produção / geração visual sem disparar em saudações ou dúvidas
  const lower = intentSourcePrompt.toLowerCase();
  let tarefaCriadaId: string | null = null;

  const asksProduction =
    !greetingOrCapability &&
    EXPLICIT_CREATION_ACTION_RE.test(intentSourcePrompt) &&
    EXPLICIT_VISUAL_ASSET_NOUN_RE.test(intentSourcePrompt);
  const asksVisualAsset = hasExplicitVisualGenerationIntent(
    intentSourcePrompt,
    agente.agente_id,
    Boolean(options?.isHandoff),
    history
  );

  if (asksProduction) {
    const tipoInferido = lower.includes("carrossel")
      ? "carrossel"
      : lower.includes("reel") || /v[ií]deo/.test(lower)
        ? "reels"
        : lower.includes("storie")
          ? "stories"
          : "post_individual";

    const tarefa = deps.queue.enqueueTask({
      agente_id: agente.agente_id,
      canal_origem: "web",
      tipo: tipoInferido,
      titulo: userPrompt.slice(0, 80),
      prioridade: 3,
      payload: {
        tema: userPrompt,
        modelo: agente.modelo_padrao,
        effort: config.effort ?? "medio",
        image_paths: anexos.map((a) => a.caminho_relativo),
      },
    });
    tarefaCriadaId = tarefa.tarefa_id;
    deps.wsHub.broadcast("task:queued", {
      tarefa_id: tarefa.tarefa_id,
      tipo: tarefa.tipo,
      titulo: tarefa.titulo,
      prioridade: tarefa.prioridade,
      canal_origem: tarefa.canal_origem,
    });
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "fifo_queue_enqueue",
      titulo: `Tarefa #${tarefa.tarefa_id.slice(0, 8)} enviada à Fila FIFO (${tipoInferido})`,
      status: "concluido",
      duracao_ms: 35,
    });
  }

  const anexosGerados: AnexoChat[] = [];
  let labeledVisualAssets: LabeledVisualAsset[] = [];

  if (asksVisualAsset || anexos.length > 0) {
    labeledVisualAssets = selectBalancedVisualAssets(deps.db, workspaceRoot, {
      explicitAttachments: anexos,
      maxFotos: 6,
      maxReferencias: 4,
      maxLogos: 1,
      maxTotal: 14,
    });
  }

  let resolvedImageDiskPaths =
    labeledVisualAssets.length > 0
      ? labeledVisualAssets.map((a) => a.path)
      : anexos.map((a) => resolve(workspaceRoot, a.caminho_relativo)).filter((p) => existsSync(p));

  const formatoVisualPedido: "3:4" | "9:16" | "1:1" | "16:9" = lower.includes("storie")
    ? "9:16"
    : lower.includes("quadrad") || lower.includes("1:1")
      ? "1:1"
      : lower.includes("16:9")
        ? "16:9"
        : "3:4";

  const hasGeminiImgKey = Boolean(
    deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key")
  );
  const hasOpenAiImgKey = Boolean(
    deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "openai_api_key")
  );
  const hasFalImgKey = Boolean(
    deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "fal_api_key", "flux_api_key")
  );
  const hasImgApiKey = hasGeminiImgKey || hasOpenAiImgKey || hasFalImgKey;

  // Se houver API Key (Nano Banana 2.1 / GPT Image 2.6 / Flux) ou conta Google/Antigravity, gera arte real
  if ((hasAntigravityAccount || hasImgApiKey) && asksVisualAsset) {
    const tImgStart = Date.now();
    const imgStepId = `step-img-${randomUUID().slice(0, 8)}`;
    onProgress?.({
      fase: "etapa",
      mensagem_status: `Gerando arte ${formatoVisualPedido} com ${resolvedImageDiskPaths.length} referência(s)...`,
      step: {
        id: imgStepId,
        ferramenta: "generate_image",
        titulo: `Gerando arte visual (${formatoVisualPedido})...`,
        formato: formatoVisualPedido,
        status: "executando",
      },
    });
    try {
      const visualPromptText = `Crie uma arte profissional de Instagram (${formatoVisualPedido}) para ${onboarding.marca_nome} (${onboarding.perfil_handle}). Preserve fielmente o rosto e características da pessoa nas fotos rotuladas como [FOTO REAL DO USUÁRIO], utilizando [REFERÊNCIA DE ESTILO] somente como inspiração estética. Solicitação do usuário: ${userPrompt}. Estética editorial contemporânea, alta legibilidade e contraste, sem marcas d'água.`;

      let generatedArtifact:
        | {
            arquivoId: string;
            fileName: string;
            relPath: string;
            mimeType: string;
            bufLength: number;
            modelUsed: string;
            providerUsed: string;
            usage: { uncachedInput: number; cachedInput: number; output: number };
          }
        | null = null;

      if (hasImgApiKey && deps.vault) {
        try {
          const dirArtes = resolve(workspaceRoot, "saidas", "artes");
          mkdirSync(dirArtes, { recursive: true });
          const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
          const fileName = `${arquivoId}.png`;
          const diskPath = resolve(dirArtes, fileName);
          const apiImgRes = await generateImageTool(
            {
              aspect_ratio: formatoVisualPedido,
              prompt: visualPromptText,
              image_paths: resolvedImageDiskPaths,
              facial_consistency: labeledVisualAssets.some((a) => a.role === "foto_real"),
              output_path: diskPath,
            },
            { vault: deps.vault }
          );
          const buf = readFileSync(diskPath);
          generatedArtifact = {
            arquivoId,
            fileName,
            relPath: `saidas/artes/${fileName}`,
            mimeType: apiImgRes.mime_type,
            bufLength: buf.length,
            modelUsed: apiImgRes.model_used,
            providerUsed: apiImgRes.engine_used,
            usage: { uncachedInput: 0, cachedInput: 0, output: 1290 },
          };
        } catch (apiImgErr) {
          if (!hasAntigravityAccount) {
            throw apiImgErr;
          }
        }
      }

      if (!generatedArtifact && hasAntigravityAccount) {
        const imgGen = await agService.executeCodeAssistGenerate({
          model: agSnapshot.imageGenerationModelIds[0] ?? "gemini-3.1-flash-image",
          messages: [{ role: "user", text: visualPromptText }],
          imagePaths: resolvedImageDiskPaths,
          labeledImages: labeledVisualAssets,
          generateImage: true,
          agentId: agente.agente_id,
          preferredAccountId: typeof config.provider_account_id === "string" ? config.provider_account_id : null,
        });

        if (imgGen.images.length > 0) {
          const firstImg = imgGen.images[0]!;
          const ext = firstImg.mimeType.includes("png") ? ".png" : firstImg.mimeType.includes("webp") ? ".webp" : ".jpg";
          const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
          const dirArtes = resolve(workspaceRoot, "saidas", "artes");
          mkdirSync(dirArtes, { recursive: true });
          const fileName = `${arquivoId}${ext}`;
          const diskPath = resolve(dirArtes, fileName);
          const buf = Buffer.from(firstImg.dataBase64, "base64");
          writeFileSync(diskPath, buf);
          generatedArtifact = {
            arquivoId,
            fileName,
            relPath: `saidas/artes/${fileName}`,
            mimeType: firstImg.mimeType,
            bufLength: buf.length,
            modelUsed: imgGen.modelUsed,
            providerUsed: "antigravity",
            usage: imgGen.usage,
          };
        }
      }

      if (generatedArtifact) {
        const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(generatedArtifact.relPath)}`;
        const agora = new Date().toISOString();

        deps.db.connection
          .prepare(
            `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
             VALUES (?, ?, ?, ?, ?, 'gerado', ?, ?, ?);`
          )
          .run(
            generatedArtifact.arquivoId,
            generatedArtifact.fileName,
            generatedArtifact.relPath,
            generatedArtifact.mimeType,
            generatedArtifact.bufLength,
            agente.agente_id,
            tarefaCriadaId,
            agora
          );

        anexosGerados.push({
          arquivo_id: generatedArtifact.arquivoId,
          nome: generatedArtifact.fileName,
          caminho_relativo: generatedArtifact.relPath,
          url: urlRaw,
          mime_type: generatedArtifact.mimeType,
          tamanho_bytes: generatedArtifact.bufLength,
          tipo_uso: "gerado",
        });

        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId: `${turnId}:img`,
          provider: generatedArtifact.providerUsed,
          model: generatedArtifact.modelUsed,
          uncachedInput: generatedArtifact.usage.uncachedInput,
          cachedInput: generatedArtifact.usage.cachedInput,
          output: generatedArtifact.usage.output,
        });

        if (tarefaCriadaId) {
          deps.queue.updateTaskStatus(tarefaCriadaId, "aguardando_aprovacao", {
            preview_url: urlRaw,
            imagem_caminho: generatedArtifact.relPath,
            titulo: userPrompt.slice(0, 80),
            formato: lower.includes("storie") ? "9:16" : "4:5",
            aprovado: false,
          });
          const tipoAprovacao = lower.includes("storie")
            ? "storie"
            : lower.includes("carrossel")
              ? "carrossel"
              : lower.includes("reel")
                ? "video_reels"
                : lower.includes("anuncio") || lower.includes("anúncio")
                  ? "post_anuncio"
                  : "post_individual";
          deps.wsHub.broadcast("task:awaiting_approval", {
            tarefa_id: tarefaCriadaId,
            tipo: tipoAprovacao,
            previews: [urlRaw],
            copy: userPrompt.slice(0, 80),
          });
        }

        const imgDoneStep: PassoChat = {
          id: imgStepId,
          ferramenta: `generate_image:${generatedArtifact.modelUsed}`,
          titulo: `Arte real gerada (${(generatedArtifact.bufLength / 1024).toFixed(0)} KB · ${generatedArtifact.modelUsed})`,
          detalhes: generatedArtifact.relPath,
          formato: formatoVisualPedido,
          status: "concluido",
          duracao_ms: Date.now() - tImgStart,
        };
        steps.push(imgDoneStep);
        onProgress?.({
          fase: "etapa",
          mensagem_status: imgDoneStep.titulo,
          step: imgDoneStep,
        });
      } else {
        const imgEmptyStep: PassoChat = {
          id: imgStepId,
          ferramenta: "generate_image",
          titulo: "Gerador não retornou imagem neste turno",
          formato: formatoVisualPedido,
          status: "erro",
          duracao_ms: Date.now() - tImgStart,
        };
        steps.push(imgEmptyStep);
        onProgress?.({
          fase: "etapa",
          mensagem_status: imgEmptyStep.titulo,
          step: imgEmptyStep,
        });
      }
    } catch (imgErr) {
      const imgErrStep: PassoChat = {
        id: imgStepId,
        ferramenta: "generate_image",
        titulo: `Aviso na geração de imagem: ${imgErr instanceof Error ? imgErr.message.slice(0, 90) : "falha na chamada"}`,
        formato: formatoVisualPedido,
        status: "erro",
        duracao_ms: Date.now() - tImgStart,
      };
      steps.push(imgErrStep);
      onProgress?.({
        fase: "etapa",
        mensagem_status: imgErrStep.titulo,
        step: imgErrStep,
      });
    }
  }

  const execState: {
    lastExecutionError: string | null;
    lastErrorRetryable: boolean;
    hadConnectedRoute: boolean;
  } = {
    lastExecutionError: null,
    lastErrorRetryable: false,
    hadConnectedRoute: false,
  };

  const invokeModelAttempt = async (
    targetModel: string,
    preferredAccId: string | null,
  ): Promise<string | null> => {
    const targetProvider = deps.providers.resolveProviderName(targetModel);
    const targetProvStatus = statusList.find((item) => item.provedor === targetProvider);
    const targetVaultOrLocal =
      Boolean(targetProvStatus?.vault_configurado) ||
      (targetProvider === "ollama" && Boolean(targetProvStatus?.conectado));
    const targetOpenCode = targetProvider === "opencode" && Boolean(opencodeStatus?.conectado);
    const targetAntigravity =
      hasAntigravityAccount &&
      (targetProvider === "gemini" || agSnapshot.modelos.some((m) => m.id === targetModel));

    // 1. Execução via Claude OAuth / ChatGPT (Codex) OAuth conectados no navegador
    if (
      ((targetProvider === "claude" && hasClaudeOAuthAccount) ||
        (targetProvider === "openai" && hasOpenAIOAuthAccount)) &&
      !targetProvStatus?.vault_configurado
    ) {
      execState.hadConnectedRoute = true;
      const providerLabel = targetProvider === "claude" ? "Claude" : "ChatGPT";
      const activeCliStepId = `step-${randomUUID().slice(0, 8)}`;
      onProgress?.({
        fase: "etapa",
        mensagem_status: `Consultando ${providerLabel} (${targetModel})...`,
        step: {
          id: activeCliStepId,
          ferramenta: `${targetProvider}:${targetModel}`,
          titulo: `Executando via ${providerLabel} (${targetModel})...`,
          status: "executando",
        },
      });
      const t0 = Date.now();
      try {
        const cliMsgs = compactRecentHistory(history, 6, 1200);
        cliMsgs.push({
          role: "user",
          text:
            anexos.length > 0
              ? `${userPrompt}\n\n[Anexos ImagePaths disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
              : userPrompt,
        });

        const cliSystemPrompt = `${promptBase}\nResponda em pt-br de forma prática e objetiva. Nunca invente handles ou marcas reais.${studioToolsPromptGuidance}`;
        const poolAccount = await deps.providerConnection
          .pickPoolAccount(targetProvider, preferredAccId)
          .catch(() => null);
        const effAccountId = preferredAccId ?? poolAccount?.id ?? null;

        const cliResult = await deps.providerConnection.getCliOAuthService().executeTurn({
          provedor: targetProvider as "claude" | "openai",
          modelId: targetModel,
          systemPrompt: cliSystemPrompt,
          messages: cliMsgs,
          agentId: agente.agente_id,
          preferredAccountId: effAccountId,
          mcpConfig: turnCliMcpConfig,
        });

        const cliFinalText = await runTextModelWorkflowToolLoop({
          initialText: cliResult.text,
          invokeFollowUp: async (followUpPrompt) => {
            const next = await deps.providerConnection.getCliOAuthService().executeTurn({
              provedor: targetProvider as "claude" | "openai",
              modelId: targetModel,
              systemPrompt: cliSystemPrompt,
              messages: [
                ...cliMsgs,
                { role: "assistant", text: cliResult.text },
                { role: "user", text: followUpPrompt },
              ],
              agentId: agente.agente_id,
              preferredAccountId: effAccountId,
              mcpConfig: turnCliMcpConfig,
            });
            return next.text;
          },
          deps,
          agenteId: agente.agente_id,
          turnId,
          threadId: options?.threadId,
          entregaOrigemId: options?.entregaOrigemId,
          pedidoTexto: userPrompt,
          isRoutine: options?.isRoutine,
          isResumingWait: Boolean(options?.wokenWaitsBlock),
          channelOrigin: options?.channelOrigin,
          whatsappContaId: options?.whatsappContaId ?? null,
          whatsappChatJid: options?.whatsappChatJid ?? null,
          signal: options?.signal,
          steps,
          anexosGerados,
          onProgress,
        });

        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId,
          provider: targetProvider,
          model: cliResult.modelUsed,
          uncachedInput: cliResult.usage.uncachedInput,
          cachedInput: cliResult.usage.cachedInput,
          output: cliResult.usage.output,
        });

        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `${targetProvider}:${cliResult.modelUsed}`,
          titulo: `Executado via ${cliResult.modelUsed}${cliResult.accountEmail ? ` (${cliResult.accountEmail})` : ""} · ${cliResult.usage.uncachedInput + cliResult.usage.cachedInput + cliResult.usage.output} tokens`,
          status: "concluido",
          duracao_ms: Date.now() - t0,
        });
        return cliFinalText;
      } catch (cliErr) {
        const classified = isRetryableQuotaOrProviderError(cliErr);
        execState.lastExecutionError = classified.message;
        execState.lastErrorRetryable = classified.retryable;
        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `${targetProvider}:erro`,
          titulo: `Falha na execução ${targetProvider}: ${classified.message.slice(0, 120)}`,
          status: "erro",
          duracao_ms: Date.now() - t0,
        });
        return null;
      }
    }

    // 2. Execução via OpenCode local (modelos gratuitos ou com API key opencode_api_key)
    if (targetOpenCode) {
      execState.hadConnectedRoute = true;
      const activeOcStepId = `step-${randomUUID().slice(0, 8)}`;
      onProgress?.({
        fase: "etapa",
        mensagem_status: `Executando ${targetModel} via OpenCode...`,
        step: {
          id: activeOcStepId,
          ferramenta: `opencode:${targetModel}`,
          titulo: `Gerando resposta em tempo real (${targetModel})...`,
          status: "executando",
        },
      });
      const t0 = Date.now();
      try {
        const ocMsgs = compactRecentHistory(history, 6, 1200);
        ocMsgs.push({
          role: "user",
          text:
            anexos.length > 0
              ? `${userPrompt}\n\n[Anexos disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
              : userPrompt,
        });

        const ocSystemPrompt = `${promptBase}\nResponda em pt-br de forma prática e especializada.${studioToolsPromptGuidance}`;
        const ocResult = await deps.providerConnection.getOpenCodeService().executePrompt({
          modelId: targetModel,
          systemPrompt: ocSystemPrompt,
          messages: ocMsgs,
          agentId: agente.agente_id,
          channelOrigin: options?.channelOrigin,
          mcpServers: turnAcpMcpServers,
          onDelta: (delta) => {
            onProgress?.({
              fase: "chunk",
              mensagem_status: `Escrevendo resposta (${targetModel})...`,
              delta,
            });
          },
        });

        if (ocResult.text) {
          const ocFinalText = await runTextModelWorkflowToolLoop({
            initialText: ocResult.text,
            invokeFollowUp: async (followUpPrompt) => {
              const next = await deps.providerConnection.getOpenCodeService().executePrompt({
                modelId: targetModel,
                systemPrompt: ocSystemPrompt,
                messages: [
                  ...ocMsgs,
                  { role: "assistant", text: ocResult.text },
                  { role: "user", text: followUpPrompt },
                ],
                agentId: agente.agente_id,
                channelOrigin: options?.channelOrigin,
                mcpServers: turnAcpMcpServers,
              });
              return next.text;
            },
            deps,
            agenteId: agente.agente_id,
            turnId,
            threadId: options?.threadId,
            entregaOrigemId: options?.entregaOrigemId,
            pedidoTexto: userPrompt,
            isRoutine: options?.isRoutine,
            isResumingWait: Boolean(options?.wokenWaitsBlock),
            channelOrigin: options?.channelOrigin,
            whatsappContaId: options?.whatsappContaId ?? null,
            whatsappChatJid: options?.whatsappChatJid ?? null,
            signal: options?.signal,
            steps,
            anexosGerados,
            onProgress,
          });

          recordChatTurnUsage(deps.db, {
            agentId: agente.agente_id,
            sessionId,
            turnId,
            provider: "opencode",
            model: ocResult.modelUsed,
            uncachedInput: ocResult.usage.uncachedInput,
            cachedInput: ocResult.usage.cachedInput,
            output: ocResult.usage.output,
          });

          const doneStep: PassoChat = {
            id: activeOcStepId,
            ferramenta: `opencode:${ocResult.modelUsed}`,
            titulo: `Executado via OpenCode (${ocResult.modelUsed}) · ${ocResult.usage.uncachedInput + ocResult.usage.output} tokens`,
            status: "concluido",
            duracao_ms: Date.now() - t0,
          };
          steps.push(doneStep);
          onProgress?.({ fase: "etapa", step: doneStep });
          return ocFinalText;
        }
      } catch (ocErr) {
        const classified = isRetryableQuotaOrProviderError(ocErr);
        execState.lastExecutionError = classified.message;
        execState.lastErrorRetryable = classified.retryable;
        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: "opencode:erro",
          titulo: `Falha ao executar modelo OpenCode: ${classified.message.slice(0, 120)}`,
          status: "erro",
          duracao_ms: Date.now() - t0,
        });
        return null;
      }
    }

    // 3. Execução via API Key cadastrada no Cofre ou Ollama local
    if (targetVaultOrLocal) {
      execState.hadConnectedRoute = true;
      onProgress?.({
        fase: "etapa",
        mensagem_status: `Consultando ${targetProvider} (${targetModel})...`,
      });
      const t0 = Date.now();
      try {
        const client = deps.providers.getClientForModel(targetModel);
        const turnMessages: ConversationMessage[] = compactRecentHistory(history, 6, 1200).map((item) => ({
          role: item.role,
          content: item.text,
        }));
        turnMessages.push({
          role: "user",
          content:
            anexos.length > 0
              ? `${userPrompt}\n\n[Anexos ImagePaths disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
              : userPrompt,
        });

        const systemPromptChat =
          options?.channelOrigin === "whatsapp"
            ? `${promptBase}\nResponda sempre em pt-br com objetividade para celular (sem tabelas Markdown e sem cabeçalhos #) e zero dados fictícios de clientes reais.`
            : `${promptBase}\nResponda sempre em pt-br com objetividade, tabelas Markdown quando útil e zero dados fictícios de clientes reais.`;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let finalReplyText = "";

        for (let iter = 0; iter < 8; iter += 1) {
          assertNotAborted();
          const llmResult = await client.executeTurn({
            model: targetModel,
            systemPrompt: systemPromptChat,
            messages: turnMessages,
            tools: availableChatTools,
          });
          assertNotAborted();

          totalInputTokens += llmResult.usage?.inputTokens ?? 0;
          totalOutputTokens += llmResult.usage?.outputTokens ?? 0;

          if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
            finalReplyText = llmResult.text?.trim() ?? "";
            break;
          }

          turnMessages.push({
            role: "assistant",
            content: llmResult.text ?? "",
            toolCalls: llmResult.toolCalls,
          });

          for (const call of llmResult.toolCalls) {
            const stepStart = Date.now();
            const runningStep: PassoChat = {
              id: `step-${randomUUID().slice(0, 8)}`,
              ferramenta: call.name,
              titulo: `Executando ${call.name}...`,
              status: "executando",
            };
            onProgress?.({
              fase: "etapa",
              mensagem_status: `Executando ferramenta ${call.name}...`,
              step: runningStep,
            });

            let toolOutput: unknown;
            let toolFailed = false;
            try {
              const effectiveCanal =
                options?.threadId && !options.threadId.startsWith("main:")
                  ? `thread:${options.threadId}`
                  : `agente:${agente.agente_id}`;
              if (isPhase15ToolName(call.name)) {
                toolOutput = await executePhase15ChatTool({
                  toolName: call.name,
                  args: call.arguments,
                  agenteId: agente.agente_id,
                  canalId: effectiveCanal,
                  deps: {
                    db: deps.db,
                    wsHub: deps.wsHub,
                    workspaceRoot,
                    browserService: deps.browserService,
                    screenCapture: deps.screenCapture,
                    showcaseService: deps.showcaseService,
                    transcription: deps.transcription,
                    remoteClaimService: deps.remoteClaimService ?? undefined,
                  },
                });
              } else if (isPhase10ExtensionTool(call.name)) {
                toolOutput = await executeStudioExtensionTool(call.name, call.arguments, {
                  db: deps.db,
                  vault: deps.vault,
                  wsHub: deps.wsHub,
                  workspaceRoot,
                  agenteId: agente.agente_id,
                  canalId: `agente:${agente.agente_id}`,
                  mcpGateway: deps.mcpGateway,
                  catalogService: deps.catalogService,
                  nativeStore: deps.catalogService?.nativeStore,
                  providerConnection: deps.providerConnection,
                  skillsManager: deps.skillsManager,
                  whatsappManager: deps.whatsappManager,
                  whatsappOrchestrator: deps.whatsappOrchestrator,
                });
              } else if (isRoutineToolName(call.name)) {
                toolOutput = await executeStudioRoutineTool(call.name, call.arguments, {
                  agenteId: agente.agente_id,
                  turnOrigin: "human",
                  routineToolsDeps: deps.routineToolsDeps,
                });
              } else if (isWorkflowToolName(call.name)) {
                toolOutput = await executeChatWorkflowTool(call.name, call.arguments, {
                  store: deps.workflowStore,
                  engine: deps.workflowEngine,
                  wsHub: deps.wsHub,
                  agenteId: agente.agente_id,
                  requestSeed: turnId,
                });
              } else if (isPhase14ToolName(call.name) && deps.phase14) {
                toolOutput = await executePhase14ToolCall(
                  call.name,
                  call.arguments,
                  {
                    agenteId: agente.agente_id,
                    canalId: effectiveCanal,
                    threadId: options?.threadId ?? `main:${agente.agente_id}`,
                    tarefaId: tarefaCriadaId,
                    turnId,
                    origemTurno: options?.isRoutine
                      ? "rotina"
                      : options?.isHandoff
                        ? "inter_agente"
                        : "usuario_local",
                    isOneToOneUserChat:
                      !options?.isRoutine &&
                      !options?.isHandoff &&
                      effectiveCanal === `agente:${agente.agente_id}`,
                    lastUserMessageId: options?.entregaOrigemId ?? null,
                    generatedAnexos: anexosGerados,
                  },
                  deps.phase14,
                );
              } else if (isPhase13ToolName(call.name) && deps.phase13) {
                const p13 = await executePhase13Tool(
                  call.name,
                  call.arguments,
                  {
                    agenteId: agente.agente_id,
                    turnoId: turnId,
                    callId: call.id,
                    threadId: options?.threadId ?? `main:${agente.agente_id}`,
                    canalId: effectiveCanal,
                    entregaOrigemId: options?.entregaOrigemId ?? turnId,
                    pedidoTexto: userPrompt,
                    isRoutine: options?.isRoutine,
                    isResumingWait: Boolean(options?.wokenWaitsBlock),
                    channelOrigin: options?.channelOrigin,
                    whatsappContaId: options?.whatsappContaId ?? null,
                    whatsappChatJid: options?.whatsappChatJid ?? null,
                  },
                  {
                    ...deps.phase13,
                    db: deps.db,
                  },
                );
                toolOutput = p13.result;
              } else if (deps.mcpGateway && call.name.startsWith("mcp_")) {
                toolOutput = await deps.mcpGateway.callMcpTool(call.name, call.arguments, {
                  agentId: agente.agente_id,
                });
              } else {
                toolFailed = true;
                toolOutput = { erro: `Ferramenta '${call.name}' indisponível no contexto atual.` };
              }
            } catch (toolErr) {
              toolFailed = true;
              const rawErrMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
              toolOutput = { erro: redactMcpSecrets(rawErrMsg, []) };
            }

            if (
              toolOutput &&
              typeof toolOutput === "object" &&
              (toolOutput as { action?: unknown }).action === "sign_in"
            ) {
              const notice = toolOutput as McpOAuthRequiredNotice;
              const safeReason = redactMcpSecrets(notice.motivo, []);
              deps.wsHub.broadcast("mcp.oauth_solicitado", {
                mcp_id: notice.mcpId,
                nome: notice.nome,
                app_slug: notice.appSlug ?? null,
                authorize_url: notice.authorizeUrl ?? null,
                canal_id: `agente:${agente.agente_id}`,
                agente_id: agente.agente_id,
                motivo: safeReason,
              });
              const promptPayload = {
                type: "mcp_oauth_prompt",
                mcpId: notice.mcpId,
                nome: notice.nome,
                appSlug: notice.appSlug ?? null,
                authorizeUrl: notice.authorizeUrl ?? null,
                motivo: safeReason,
              };
              steps.push({
                id: `step-${randomUUID().slice(0, 8)}`,
                ferramenta: "mcp_oauth_prompt",
                titulo: `Autenticação OAuth solicitada: ${notice.nome}`,
                detalhes: JSON.stringify(promptPayload),
                status: "erro",
                duracao_ms: Date.now() - stepStart,
              });
              anexosGerados.push({
                arquivo_id: `oauth-${notice.mcpId}`,
                nome: notice.nome,
                caminho_relativo: notice.mcpId,
                url: notice.authorizeUrl ?? "",
                mime_type: "application/vnd.criativo.mcp-oauth+json",
                tipo_uso: "mcp_oauth_prompt",
              });
            } else if (
              toolOutput &&
              typeof toolOutput === "object" &&
              (toolOutput as { type?: unknown }).type === "marketplace_app_suggestion" &&
              (toolOutput as { app?: { slug?: string; name?: string } | null }).app
            ) {
              const appInfo = (toolOutput as { app: { slug: string; name: string } }).app;
              steps.push({
                id: `step-${randomUUID().slice(0, 8)}`,
                ferramenta: "marketplace_app_suggestion",
                titulo: `App sugerido da Loja: ${appInfo.name}`,
                detalhes: JSON.stringify(toolOutput),
                status: "concluido",
                duracao_ms: Date.now() - stepStart,
              });
              anexosGerados.push({
                arquivo_id: `app-${appInfo.slug}`,
                nome: appInfo.name,
                caminho_relativo: appInfo.slug,
                url: `/loja/apps/${encodeURIComponent(appInfo.slug)}`,
                mime_type: "application/vnd.criativo.marketplace-app+json",
                tipo_uso: "marketplace_app_suggestion",
              });
            }

            const redactedOut = redactMcpPayload(toolOutput, []);
            const doneToolStep: PassoChat = {
              id: runningStep.id,
              ferramenta: call.name,
              titulo: toolFailed
                ? `Falha em ${call.name}`
                : `Ferramenta ${call.name} executada`,
              detalhes: JSON.stringify(redactedOut).slice(0, 800),
              status: toolFailed ? "erro" : "concluido",
              duracao_ms: Date.now() - stepStart,
            };
            steps.push(doneToolStep);
            onProgress?.({
              fase: "etapa",
              mensagem_status: doneToolStep.titulo,
              step: doneToolStep,
            });

            turnMessages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify(redactedOut),
            });
          }

          if (iter === 7 && !finalReplyText) {
            const finalTurn = await client.executeTurn({
              model: targetModel,
              systemPrompt: systemPromptChat,
              messages: turnMessages,
            });
            totalInputTokens += finalTurn.usage?.inputTokens ?? 0;
            totalOutputTokens += finalTurn.usage?.outputTokens ?? 0;
            finalReplyText = finalTurn.text?.trim() ?? "";
          }
        }

        if (finalReplyText.length > 0) {
          const estIn = Math.max(50, Math.round((promptBase.length + userPrompt.length) / 4));
          const estOut = Math.max(20, Math.round(finalReplyText.length / 4));
          recordChatTurnUsage(deps.db, {
            agentId: agente.agente_id,
            sessionId,
            turnId,
            provider: targetProvider,
            model: targetModel,
            uncachedInput: totalInputTokens > 0 ? totalInputTokens : estIn,
            cachedInput: 0,
            output: totalOutputTokens > 0 ? totalOutputTokens : estOut,
          });

          steps.push({
            id: `step-${randomUUID().slice(0, 8)}`,
            ferramenta: `${targetProvider}:chat`,
            titulo: `Resposta gerada via ${targetModel}`,
            status: "concluido",
            duracao_ms: Date.now() - t0,
          });
          return finalReplyText;
        }
      } catch (vaultErr) {
        const classified = isRetryableQuotaOrProviderError(vaultErr);
        execState.lastExecutionError = classified.message;
        execState.lastErrorRetryable = classified.retryable;
        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `${targetProvider}:erro`,
          titulo: `Falha API Key / Ollama: ${classified.message.slice(0, 120)}`,
          status: "erro",
          duracao_ms: Date.now() - t0,
        });
        return null;
      }
    }

    // 4. Execução real via Conta Google/Antigravity conectada no navegador
    if (targetAntigravity && hasAntigravityAccount) {
      execState.hadConnectedRoute = true;
      const activeAgStepId = `step-${randomUUID().slice(0, 8)}`;
      onProgress?.({
        fase: "etapa",
        mensagem_status: `Executando ${targetModel} via Google Antigravity...`,
        step: {
          id: activeAgStepId,
          ferramenta: `antigravity:${targetModel}`,
          titulo: `Consultando ${targetModel} em tempo real...`,
          status: "executando",
        },
      });
      const t0 = Date.now();
      try {
        const historyMsgs = compactRecentHistory(history, 6, 1200);
        historyMsgs.push({
          role: "user",
          text:
            anexosGerados.length > 0
              ? `${userPrompt}\n\n[Uma imagem acabou de ser gerada e salva em: ${anexosGerados.map((a) => a.caminho_relativo).join(", ")}. Descreva o resultado e proponha legenda/próximos passos.]`
              : userPrompt,
        });

        const agEffort = typeof config.effort === "string" ? config.effort : undefined;
        const skipExtraImagesOnFollowUp = anexosGerados.length > 0;
        const agSystemPrompt = `${promptBase}\nResponda em pt-br de forma prática e especializada como ${agente.nome}. Use tabelas Markdown quando ajudar na organização. Nunca invente handles ou marcas reais: utilize apenas os informados pelo usuário.${studioToolsPromptGuidance}`;
        const liveResult = await agService.executeCodeAssistGenerate({
          model: targetModel,
          effort: agEffort,
          systemPrompt: agSystemPrompt,
          messages: historyMsgs,
          imagePaths: skipExtraImagesOnFollowUp ? [] : resolvedImageDiskPaths,
          labeledImages: skipExtraImagesOnFollowUp ? [] : labeledVisualAssets,
          agentId: agente.agente_id,
          preferredAccountId: preferredAccId,
          mcpServers: turnAcpMcpServers,
          onDelta: (delta) => {
            onProgress?.({
              fase: "chunk",
              mensagem_status: `Escrevendo resposta (${targetModel})...`,
              delta,
            });
          },
        });

        if (liveResult.text && liveResult.text.length > 0) {
          const liveFinalText = await runTextModelWorkflowToolLoop({
            initialText: liveResult.text,
            invokeFollowUp: async (followUpPrompt) => {
              const next = await agService.executeCodeAssistGenerate({
                model: targetModel,
                effort: agEffort,
                systemPrompt: agSystemPrompt,
                messages: [
                  ...historyMsgs,
                  { role: "assistant", text: liveResult.text },
                  { role: "user", text: followUpPrompt },
                ],
                imagePaths: [],
                labeledImages: [],
                agentId: agente.agente_id,
                preferredAccountId: preferredAccId,
                mcpServers: turnAcpMcpServers,
              });
              return next.text;
            },
            deps,
            agenteId: agente.agente_id,
            turnId,
            threadId: options?.threadId,
            entregaOrigemId: options?.entregaOrigemId,
            pedidoTexto: userPrompt,
            isRoutine: options?.isRoutine,
            isResumingWait: Boolean(options?.wokenWaitsBlock),
            channelOrigin: options?.channelOrigin,
            whatsappContaId: options?.whatsappContaId ?? null,
            whatsappChatJid: options?.whatsappChatJid ?? null,
            signal: options?.signal,
            steps,
            anexosGerados,
            onProgress,
          });

          recordChatTurnUsage(deps.db, {
            agentId: agente.agente_id,
            sessionId,
            turnId,
            provider: "antigravity",
            model: liveResult.modelUsed,
            uncachedInput: liveResult.usage.uncachedInput,
            cachedInput: liveResult.usage.cachedInput,
            output: liveResult.usage.output,
          });

          steps.push({
            id: `step-${randomUUID().slice(0, 8)}`,
            ferramenta: `antigravity:${liveResult.modelUsed}`,
            titulo: `Executado via ${liveResult.modelUsed}${liveResult.accountEmail ? ` (${liveResult.accountEmail})` : ""} · ${liveResult.usage.uncachedInput + liveResult.usage.cachedInput + liveResult.usage.output} tokens`,
            ...(liveResult.fallbackReason ? { detalhes: liveResult.fallbackReason } : {}),
            status: "concluido",
            duracao_ms: Date.now() - t0,
          });
          return liveFinalText;
        }
      } catch (liveErr) {
        const classified = isRetryableQuotaOrProviderError(liveErr);
        execState.lastExecutionError = classified.message;
        execState.lastErrorRetryable = classified.retryable;
        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: "antigravity:erro",
          titulo: `Falha ao consultar conta Google conectada: ${classified.message.slice(0, 120)}`,
          status: "erro",
          duracao_ms: Date.now() - t0,
        });
        return null;
      }
    }

    return null;
  };

  const finalizeTurnAnexos = (): AnexoChat[] => {
    syncTurnGeneratedMediaAttachments(deps.db, agente.agente_id, turnStartedIso, anexosGerados);
    return anexosGerados;
  };

  const preferredAcc =
    options?.overrideAccountId !== undefined
      ? options.overrideAccountId
      : typeof config.provider_account_id === "string"
        ? config.provider_account_id
        : null;

  const primaryReplyText = await invokeModelAttempt(initialModel, preferredAcc);
  if (primaryReplyText !== null) {
    return { markdown: primaryReplyText, steps, tarefaCriadaId, anexosGerados: finalizeTurnAnexos() };
  }

  // Cascade / Ask via BackupModelsResolver quando ocorrer erro retentável (rate limit, cota, 5xx)
  const backupResolver = deps.backupResolver ?? new BackupModelsResolver();
  const backupCfg = parseBackupModelsJson(agente.backup_models_json ?? null);
  const effectiveBackupCfg =
    backupCfg.order.length > 0 ? backupCfg : governance.backupModels;

  if (execState.lastErrorRetryable) {
    backupResolver.markModelCooldown(providerName, initialModel);

    if (effectiveBackupCfg.automatic && !options?.overrideModel) {
      const candidates = backupResolver.resolveCandidates({
        primaryModel: initialModel,
        backupConfig: effectiveBackupCfg,
        statuses: statusList,
      });

      for (const candidate of candidates) {
        const failoverStep: PassoChat = {
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: "backup_model_failover",
          titulo: `Alternou para modelo reserva: ${candidate.modelo} (${candidate.provedor})`,
          detalhes: `Failover automático após ${execState.lastExecutionError?.slice(0, 90) ?? "limite de uso"}`,
          status: "concluido",
          duracao_ms: 15,
        };
        steps.push(failoverStep);
        onProgress?.({
          fase: "etapa",
          mensagem_status: failoverStep.titulo,
          step: failoverStep,
        });

        const backupText = await invokeModelAttempt(candidate.modelo, candidate.conta_id ?? null);
        if (backupText !== null) {
          return { markdown: backupText, steps, tarefaCriadaId, anexosGerados: finalizeTurnAnexos() };
        }
        backupResolver.markModelCooldown(candidate.provedor, candidate.modelo);
      }
    }

    const canalIdForAsk =
      options?.threadId && !options.threadId.startsWith("main:")
        ? `thread:${options.threadId}`
        : `agente:${agente.agente_id}`;
    const usageLimitAsk = backupResolver.buildUsageLimitAsk({
      agenteId: agente.agente_id,
      canalId: canalIdForAsk,
      currentModel: initialModel,
      currentProvider: providerName,
      reason: execState.lastExecutionError ?? "Limite temporário ou cota atingida.",
      backupConfig: effectiveBackupCfg,
      statuses: statusList,
    });

    if (usageLimitAsk.opcoes.length > 0) {
      deps.db.connection
        .prepare(
          `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
           VALUES (?, ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`,
        )
        .run(
          `usage_limit_ask:${usageLimitAsk.ask_id}`,
          JSON.stringify({
            ask: usageLimitAsk,
            agenteId: agente.agente_id,
            canalId: canalIdForAsk,
            threadId: options?.threadId ?? `main:${agente.agente_id}`,
            userPrompt,
            anexos,
          }),
          new Date().toISOString(),
        );

      return {
        markdown: `O modelo **${initialModel}** atingiu seu limite ou retornou indisponibilidade temporária (\`${(execState.lastExecutionError ?? "quota_exceeded").slice(0, 120)}\`). Escolha abaixo um modelo reserva para continuar sem alterar seu modelo padrão:`,
        steps,
        tarefaCriadaId,
        anexosGerados: finalizeTurnAnexos(),
        usageLimitAsk,
      };
    }
  }

  if (metaValidationSummary) {
    const det = metaValidationSummary.detalhes;
    const metaReportMarkdown = [
      `### Diagnóstico Oficial da Integração Meta (Cofre AES-256-GCM + Graph API ${graphVersion})`,
      "",
      `| Componente | Status | Detalhe |`,
      `|---|---|---|`,
      `| Token Meta no Cofre SQLite | ${det.tokenConfigurado ? "✅ Configurado" : "❌ Ausente"} | Criptografado localmente (nunca exposto) |`,
      `| Instagram Business Account ID | ${det.accountIdConfigurado ? "✅ Configurado" : "❌ Ausente"} | ID validado no Cofre |`,
      `| Meta Graph API ${graphVersion} | ${det.graphApiOk ? `✅ HTTP ${det.httpStatus} OK` : `❌ Falha${det.httpStatus ? ` HTTP ${det.httpStatus}` : ""}`} | ${det.graphApiOk ? `Perfil @${det.username ?? "ativo"}` : det.erro ?? "Erro na consulta"} |`,
      "",
      `**Estágio atual:** ${metaValidationSummary.estagio} — ${metaValidationSummary.resumo}`,
    ].join("\n");
    return { markdown: metaReportMarkdown, steps, tarefaCriadaId, anexosGerados: finalizeTurnAnexos() };
  }

  // 5. Resposta honesta: diferencia erro técnico em provedor conectado vs ausência real de conexão
  if (options?.channelOrigin === "whatsapp") {
    const readyAnexos = finalizeTurnAnexos();
    const cleanErr = execState.hadConnectedRoute
      ? `Não consegui concluir a chamada em *${agente.modelo_padrao}* (${providerName}): ${(execState.lastExecutionError ?? "sem resposta do servidor").slice(0, 140)}. Tente novamente em instantes ou revise a conta em Conexões.`
      : `O modelo *${agente.modelo_padrao}* (${providerName}) ainda não está conectado no Criativo Studio. Conecte uma conta em Conexões e tente novamente.`;
    return {
      markdown: `*${agente.nome}*: ${cleanErr}`,
      steps,
      tarefaCriadaId,
      anexosGerados: readyAnexos,
    };
  }

  const readyAnexos = finalizeTurnAnexos();
  const statusLabel = execState.hadConnectedRoute ? "Falha na chamada" : "Não conectado";
  const detailLine = execState.hadConnectedRoute
    ? `Erro técnico ao executar **${agente.modelo_padrao}** (${providerName}): \`${execState.lastExecutionError ?? "sem resposta do servidor"}\`. Tente novamente ou reautentique sua conta em **Conexões**.`
    : readyAnexos.length > 0
      ? `Mídia gerada e salva em \`${readyAnexos[0].caminho_relativo}\`.`
      : `Nenhum provedor conectado para o modelo **${agente.modelo_padrao}** (\`${providerName}\`). Abra **Conexões** e clique para conectar via navegador (Google, Claude ou ChatGPT), utilize modelos gratuitos do **OpenCode** ou salve uma API Key.`;

  const structuredFallback = [
    `**${agente.nome}** recebeu sua solicitação para **${onboarding.marca_nome}** (\`${onboarding.perfil_handle}\`):`,
    "",
    `> ${userPrompt.slice(0, 200)}`,
    "",
    "| Etapa do Plano | Ação | Status |",
    "|---|---|---|",
    `| 1. Diagnóstico | Contexto de \`${skillSlug}\` (${agente.modelo_padrao}) | Pronto |`,
    `| 2. Execução IA | ${readyAnexos.length > 0 ? `Mídia gerada em \`${readyAnexos[0].caminho_relativo}\`` : execState.hadConnectedRoute ? `Falha técnica: ${(execState.lastExecutionError ?? "erro").slice(0, 70)}` : "Aguardando conta conectada ou API Key"} | ${readyAnexos.length > 0 ? "Concluído" : statusLabel} |`,
    `| 3. Segurança Meta | Aprovação humana obrigatória antes da publicação | Ativo |`,
    "",
    detailLine,
  ].join("\n");

  return { markdown: structuredFallback, steps, tarefaCriadaId, anexosGerados: readyAnexos };
}

/**
 * Executa um turno completo conversacional (chat principal ou sub-thread isolada)
 * respeitando `context_cutoff_at`, `AbortSignal`, ferramentas da Fase 13 e emissão WS isolada por `thread_id`.
 */
export async function executeAgentConversationTurn(params: {
  deps: StudioRoutesDeps;
  agente: Parameters<typeof generateAgentChatReply>[1];
  userPrompt: string;
  anexos?: AnexoChat[];
  threadId?: string | null;
  turnoId: string;
  signal?: AbortSignal;
  wokenWaitsBlock?: string | null;
  entregaOrigemId?: string;
  isRoutine?: boolean;
  isHandoff?: boolean;
  originalUserPrompt?: string;
  respostaParaMensagemId?: string | null;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  extraMetadados?: Record<string, unknown>;
  onProgress?: (prog: ChatProgressReport) => void;
}): Promise<{
  agentMsg: MensagemChat;
  reply: Awaited<ReturnType<typeof generateAgentChatReply>>;
}> {
  const { deps, agente } = params;
  const rawThread = params.threadId;
  const isSubThread = Boolean(rawThread && !rawThread.startsWith("main:"));
  const effectiveThreadId = isSubThread ? rawThread! : `main:${agente.agente_id}`;
  const canalId = isSubThread ? `thread:${effectiveThreadId}` : `agente:${agente.agente_id}`;

  const cutoffAt = isSubThread ? null : readAgentContextCutoffAt(deps.db, agente.agente_id);

  const historyRows = (isSubThread
    ? deps.db.connection
        .prepare(
          `
          SELECT * FROM projecao_conversas_chat
          WHERE thread_id = ?
            AND COALESCE(item_type, 'mensagem') = 'mensagem'
            AND COALESCE(status, 'completed') != 'streaming'
          ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC
          LIMIT 30;
        `,
        )
        .all(effectiveThreadId)
    : deps.db.connection
        .prepare(
          `
          SELECT * FROM projecao_conversas_chat
          WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
            AND COALESCE(item_type, 'mensagem') = 'mensagem'
            AND COALESCE(status, 'completed') != 'streaming'
            AND (? IS NULL OR criado_em > ?)
          ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC
          LIMIT 30;
        `,
        )
        .all(effectiveThreadId, canalId, cutoffAt, cutoffAt)) as Array<Parameters<typeof mapChatRow>[0]>;

  const history = historyRows.reverse().map((r) => mapChatRow(r, deps.db));
  const progressEmitter = (prog: ChatProgressReport): void => {
    params.onProgress?.(prog);
    if (isSubThread) {
      deps.wsHub.broadcast("thread:progress", {
        agente_id: agente.agente_id,
        thread_id: effectiveThreadId,
        turno_id: params.turnoId,
        ...prog,
      });
    } else {
      deps.wsHub.broadcast("chat:progress", {
        canal_id: canalId,
        agente_id: agente.agente_id,
        turno_id: params.turnoId,
        ...prog,
      });
    }
  };

  let reply: Awaited<ReturnType<typeof generateAgentChatReply>>;
  try {
    reply = await generateAgentChatReply(
      deps,
      agente,
      params.userPrompt,
      params.anexos ?? [],
      history,
      progressEmitter,
      {
        isHandoff: params.isHandoff,
        originalUserPrompt: params.originalUserPrompt,
        threadId: effectiveThreadId,
        turnoId: params.turnoId,
        signal: params.signal,
        wokenWaitsBlock: params.wokenWaitsBlock,
        entregaOrigemId: params.entregaOrigemId,
        isRoutine: params.isRoutine,
        channelOrigin: params.channelOrigin,
        whatsappContaId: params.whatsappContaId,
        whatsappChatJid: params.whatsappChatJid,
      },
    );
  } catch (err) {
    deps.memoryManager?.commitTurnMutations(params.turnoId, "failed");
    throw err;
  }

  if (isSubThread) {
    deps.wsHub.broadcast("thread:progress", {
      agente_id: agente.agente_id,
      thread_id: effectiveThreadId,
      turno_id: params.turnoId,
      fase: "concluido",
    });
  } else {
    deps.wsHub.broadcast("chat:progress", {
      canal_id: canalId,
      agente_id: agente.agente_id,
      turno_id: params.turnoId,
      fase: "concluido",
    });
  }

  const maxOrdRow = deps.db.connection
    .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
    .get(effectiveThreadId) as { max_ord: number };
  const nextOrdinal = maxOrdRow.max_ord + 1;
  const nowIso = new Date(Date.now() + 2).toISOString();

  const mergedMeta: Record<string, unknown> = {
    ...(params.extraMetadados ?? {}),
    ...(reply.usageLimitAsk ? { usage_limit_ask: reply.usageLimitAsk } : {}),
  };
  const replyMetadados: Record<string, unknown> | undefined =
    Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined;

  const agentMsg: MensagemChat = {
    mensagem_id: `msg-${randomUUID()}`,
    canal_id: canalId,
    agente_id: agente.agente_id,
    autor: "agente",
    autor_nome: agente.nome,
    conteudo_markdown: reply.markdown,
    anexos: reply.anexosGerados,
    steps: reply.steps,
    tarefa_id: reply.tarefaCriadaId,
    thread_id: effectiveThreadId,
    turno_id: params.turnoId,
    item_type: "mensagem",
    status: "completed",
    resposta_para_mensagem_id: params.respostaParaMensagemId ?? null,
    ordinal: nextOrdinal,
    ...(replyMetadados ? { metadados: replyMetadados } : {}),
    lida: true,
    criado_em: nowIso,
  };

  deps.db.connection
    .prepare(
      `
      INSERT INTO projecao_conversas_chat (
        mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
        anexos_json, steps_json, tarefa_id, lida, criado_em,
        thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
        ordinal, branch_origem_mensagem_id, metadados_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mensagem', 'completed', ?, ?, NULL, ?);
    `,
    )
    .run(
      agentMsg.mensagem_id,
      agentMsg.canal_id,
      agentMsg.agente_id,
      agentMsg.autor,
      agentMsg.autor_nome ?? agente.nome,
      agentMsg.conteudo_markdown,
      JSON.stringify(agentMsg.anexos),
      JSON.stringify(agentMsg.steps),
      agentMsg.tarefa_id ?? null,
      1,
      agentMsg.criado_em,
      effectiveThreadId,
      params.turnoId,
      agentMsg.resposta_para_mensagem_id ?? null,
      nextOrdinal,
      JSON.stringify(replyMetadados ?? {}),
    );

  if (isSubThread) {
    deps.wsHub.broadcast("thread:message", {
      agente_id: agente.agente_id,
      thread_id: effectiveThreadId,
      mensagem: agentMsg,
    });
  } else {
    deps.wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agente.agente_id,
      mensagem: agentMsg,
    });
  }

  deps.memoryManager?.commitTurnMutations(params.turnoId, "completed");
  deps.memoryReview?.recordCompletedTurn({
    agenteId: agente.agente_id,
    threadId: isSubThread ? effectiveThreadId : null,
    canalId,
    lastMessageId: agentMsg.mensagem_id,
    workSteps: reply.steps,
  });

  if (!isSubThread && deps.phase13?.contextReset.hasPendingReset(agente.agente_id)) {
    deps.phase13.contextReset.flushPendingResetIfIdle(agente.agente_id, params.entregaOrigemId);
  }

  return { agentMsg, reply };
}

export async function tryHandleStudioRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: StudioRoutesDeps
): Promise<boolean> {
  if (await tryHandleWhatsAppMcpStoreRoute(req, res, path, method, url, deps)) {
    return true;
  }
  if (
    deps.phase13 &&
    (await tryHandleThreadsRoute(req, res, path, method, url, {
      ...deps,
      ...deps.phase13,
    }))
  ) {
    return true;
  }

  const { db, sendJson, readJsonBody, providerConnection, wsHub } = deps;
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();

  // 0. Licenciamento Comercial (Fase 16)
  if (method === "GET" && path === "/api/studio/license/status") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const unlockedSummary = computeUnlockedAgentsSummary(db, workspaceRoot, deps.licenseService);
    sendJson(res, 200, {
      license: {
        ...deps.licenseService.getStatus(),
        unlocked_agents_count: unlockedSummary.unlocked_agents_count,
      },
    });
    return true;
  }

  if (method === "POST" && path === "/api/studio/license/activate") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const license = await deps.licenseService.activate({
        license_key: String(body.license_key ?? ""),
        email: String(body.email ?? ""),
      });
      sendJson(res, 200, { ok: true, license });
    } catch (err) {
      if (err instanceof LicenseValidationError) {
        sendJson(res, err.statusCode, {
          erro: err.message,
          code: err.code,
          ...(err.details ?? {}),
        });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "POST" && path === "/api/studio/license/heartbeat") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const license = await deps.licenseService.heartbeat();
    sendJson(res, 200, { ok: license.valid, license });
    return true;
  }

  if (method === "POST" && path === "/api/studio/license/deactivate") {
    if (!deps.licenseService) {
      sendJson(res, 503, { erro: "Serviço de licenciamento não inicializado." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const result = await deps.licenseService.deactivateDevice({
        target_machine_id: String(body.target_machine_id ?? ""),
        license_key: typeof body.license_key === "string" ? body.license_key : undefined,
        email: typeof body.email === "string" ? body.email : undefined,
      });
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof LicenseValidationError) {
        sendJson(res, err.statusCode, {
          erro: err.message,
          code: err.code,
          ...(err.details ?? {}),
        });
        return true;
      }
      throw err;
    }
    return true;
  }

  // 0.5 Multi-Servidores Local & Pareamento VPS (Fase 17)
  if (method === "GET" && path === "/api/studio/servers") {
    if (!deps.localServerManager) {
      sendJson(res, 200, { servers: [], active_server_id: "primary", quota: null });
      return true;
    }
    sendJson(res, 200, {
      servers: deps.localServerManager.listServers(),
      active_server_id: deps.localServerManager.getActiveServerId(),
      quota: deps.localServerManager.getQuotaSummary(),
    });
    return true;
  }

  if (method === "POST" && path === "/api/studio/servers/local") {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível em processo filho." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const server = await deps.localServerManager.createLocalServer({
        nome: String(body.nome ?? ""),
        cor_hex: typeof body.cor_hex === "string" ? body.cor_hex : undefined,
      });
      sendJson(res, 201, {
        ok: true,
        server,
        servers: deps.localServerManager.listServers(),
        quota: deps.localServerManager.getQuotaSummary(),
      });
    } catch (err) {
      if (err instanceof ServerQuotaExceededError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code, quota: err.quota });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "POST" && path === "/api/studio/servers/claims") {
    if (!deps.remoteClaimService) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const claim = await deps.remoteClaimService.createRemoteClaim(
        typeof body.server_name === "string" && body.server_name.trim()
          ? body.server_name.trim()
          : "Servidor VPS",
      );
      sendJson(res, 201, { ok: true, claim });
    } catch (err) {
      if (err instanceof ServerQuotaExceededError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code, quota: err.quota });
        return true;
      }
      throw err;
    }
    return true;
  }

  const claimPollMatch = path.match(/^\/api\/studio\/servers\/claims\/([^/]+)$/);
  if (method === "GET" && claimPollMatch) {
    if (!deps.remoteClaimService) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const claim = await deps.remoteClaimService.pollRemoteClaim(decodeURIComponent(claimPollMatch[1]));
    sendJson(res, 200, { ok: true, claim });
    return true;
  }

  if (method === "POST" && path === "/api/studio/servers/join") {
    if (!deps.remoteClaimService || !deps.localServerManager) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const server = await deps.remoteClaimService.joinServerByInviteOrDirect({
        invite_url: typeof body.invite_url === "string" ? body.invite_url : undefined,
        nome: typeof body.nome === "string" ? body.nome : undefined,
        base_url: typeof body.base_url === "string" ? body.base_url : undefined,
        access_token: typeof body.access_token === "string" ? body.access_token : undefined,
      });
      sendJson(res, 201, {
        ok: true,
        server,
        servers: deps.localServerManager.listServers(),
        quota: deps.localServerManager.getQuotaSummary(),
      });
    } catch (err) {
      if (err instanceof ServerQuotaExceededError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code, quota: err.quota });
        return true;
      }
      throw err;
    }
    return true;
  }

  const serverSelectMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/select$/);
  if (method === "POST" && serverSelectMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const server = await deps.localServerManager.selectActiveServer(decodeURIComponent(serverSelectMatch[1]));
    sendJson(res, 200, {
      ok: true,
      server,
      active_server_id: server.server_id,
      servers: deps.localServerManager.listServers(),
    });
    return true;
  }

  const serverRestartMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/restart$/);
  if (method === "POST" && serverRestartMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(serverRestartMatch[1]);
    await deps.localServerManager.stopLocalChild(srvId);
    const server = await deps.localServerManager.ensureRunning(srvId);
    sendJson(res, 200, { ok: true, server });
    return true;
  }

  const serverInviteMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/invite$/);
  if (method === "POST" && serverInviteMatch) {
    if (!deps.remoteClaimService) {
      sendJson(res, 503, { erro: "RemoteClaimService indisponível." });
      return true;
    }
    const invite = deps.remoteClaimService.createServerInvite(decodeURIComponent(serverInviteMatch[1]));
    sendJson(res, 200, { ok: true, invite });
    return true;
  }

  const oauthBridgeMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/oauth-bridge$/);
  if (method === "POST" && oauthBridgeMatch) {
    if (!deps.remoteOAuthBridge) {
      sendJson(res, 503, { erro: "RemoteOAuthBridgeService indisponível neste servidor." });
      return true;
    }
    const srvId = decodeURIComponent(oauthBridgeMatch[1]);
    const body = await readJsonBody(req);
    const provedor = body.provedor === "claude" || body.provedor === "openai" ? body.provedor : null;
    const authUrl = typeof body.auth_url === "string" ? body.auth_url.trim() : "";
    if (!provedor || !authUrl) {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'provedor' ('claude' | 'openai') e 'auth_url'." });
      return true;
    }
    const prepared = await deps.remoteOAuthBridge.prepareBridgeForAuthUrl({
      serverId: srvId,
      provedor,
      authUrl,
    });
    sendJson(res, 200, prepared);
    return true;
  }

  const remoteGeminiMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/connect-gemini-via-desktop$/);
  if (method === "POST" && remoteGeminiMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(remoteGeminiMatch[1]);
    const targetSrv = deps.localServerManager.getServer(srvId);
    if (!targetSrv) {
      sendJson(res, 404, { erro: `Servidor '${srvId}' não encontrado.` });
      return true;
    }
    const body = await readJsonBody(req);
    const label = typeof body.label === "string" ? body.label : undefined;

    try {
      const exported = await providerConnection
        .getAntigravityService()
        .signInIsolatedForRemoteExport(label, (url) => {
          wsHub.broadcast("provider:auth_url", { provedor: "gemini", url });
        });

      const accessToken = deps.localServerManager.getServerAccessToken(targetSrv.server_id);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const syncedCertB64 = deps.licenseService?.exportCertificateForPeerSync();
      if (syncedCertB64) {
        headers["X-Criativo-Synced-License"] = syncedCertB64;
      }

      const upstreamRes = await fetch(
        `${targetSrv.base_url.replace(/\/+$/, "")}/api/provedores/gemini/contas`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: exported.email,
            label: exported.label,
            access_token: exported.accessToken,
            refresh_token: exported.refreshToken,
            expiry: exported.expiry,
          }),
        }
      );
      const upstreamPayload = (await upstreamRes.json().catch(() => ({}))) as {
        conta?: unknown;
        provedores?: unknown;
        uso?: unknown;
        erro?: string;
      };
      if (!upstreamRes.ok) {
        sendJson(res, upstreamRes.status, {
          ok: false,
          erro: upstreamPayload.erro ?? `Falha ao enviar conta Google para '${targetSrv.nome}'.`,
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        conta: upstreamPayload.conta,
        provedores: upstreamPayload.provedores,
        uso: upstreamPayload.uso,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível autenticar sua conta Google pelo Desktop para o servidor remoto.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const remoteOpenAiMatch = path.match(/^\/api\/studio\/servers\/([^/]+)\/connect-openai-via-desktop$/);
  if (method === "POST" && remoteOpenAiMatch) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(remoteOpenAiMatch[1]);
    const targetSrv = deps.localServerManager.getServer(srvId);
    if (!targetSrv) {
      sendJson(res, 404, { erro: `Servidor '${srvId}' não encontrado.` });
      return true;
    }
    const body = await readJsonBody(req);
    const label = typeof body.label === "string" ? body.label : undefined;

    try {
      const exported = await providerConnection
        .getCliOAuthService()
        .signInCodexIsolatedForRemoteExport(label, (url) => {
          wsHub.broadcast("provider:auth_url", { provedor: "openai", url });
        });

      const accessToken = deps.localServerManager.getServerAccessToken(targetSrv.server_id);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const syncedCertB64 = deps.licenseService?.exportCertificateForPeerSync();
      if (syncedCertB64) {
        headers["X-Criativo-Synced-License"] = syncedCertB64;
      }

      const upstreamRes = await fetch(
        `${targetSrv.base_url.replace(/\/+$/, "")}/api/provedores/openai/contas-auth`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            auth_json: exported.authJson,
            email: exported.email,
            plano: exported.plano,
            label: exported.label,
          }),
        }
      );
      const upstreamPayload = (await upstreamRes.json().catch(() => ({}))) as {
        conta?: unknown;
        provedores?: unknown;
        uso?: unknown;
        erro?: string;
      };
      if (!upstreamRes.ok) {
        sendJson(res, upstreamRes.status, {
          ok: false,
          erro: upstreamPayload.erro ?? `Falha ao enviar sessão ChatGPT para '${targetSrv.nome}'.`,
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        conta: upstreamPayload.conta,
        provedores: upstreamPayload.provedores,
        uso: upstreamPayload.uso,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível autenticar sua conta ChatGPT pelo Desktop para o servidor remoto.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const serverSingleMatch = path.match(/^\/api\/studio\/servers\/([^/]+)$/);
  if (serverSingleMatch && (method === "PATCH" || method === "DELETE")) {
    if (!deps.localServerManager) {
      sendJson(res, 503, { erro: "Gerenciador de servidores indisponível." });
      return true;
    }
    const srvId = decodeURIComponent(serverSingleMatch[1]);
    if (method === "PATCH") {
      const body = await readJsonBody(req);
      const server = deps.localServerManager.renameOrUpdateServer(srvId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        cor_hex: typeof body.cor_hex === "string" ? body.cor_hex : undefined,
      });
      sendJson(res, 200, { ok: true, server, servers: deps.localServerManager.listServers() });
      return true;
    }
    const deleteFiles = url.searchParams.get("delete_files") === "1";
    await deps.localServerManager.deleteServer(srvId, deleteFiles);
    sendJson(res, 200, {
      ok: true,
      servers: deps.localServerManager.listServers(),
      active_server_id: deps.localServerManager.getActiveServerId(),
    });
    return true;
  }

  // Fase 18 — Auto-Update (Desktop e VPS)
  if (method === "GET" && path === "/api/studio/updates/status") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    sendJson(res, 200, { ok: true, status: deps.autoUpdateService.getStatus() });
    return true;
  }

  if (method === "POST" && path === "/api/studio/updates/check") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    const status = await deps.autoUpdateService.checkForUpdates();
    sendJson(res, 200, { ok: true, status });
    return true;
  }

  if (method === "POST" && path === "/api/studio/updates/apply") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    const body = await readJsonBody(req);
    const status = await deps.autoUpdateService.downloadAndApplyUpdate({
      platform:
        typeof body.platform === "string"
          ? (body.platform as "win32" | "darwin" | "linux" | "vps-tarball")
          : undefined,
      targetProductDir: typeof body.target_product_dir === "string" ? body.target_product_dir : undefined,
      restartAfterApply: body.restart === true,
    });
    sendJson(res, 200, { ok: true, status });
    return true;
  }

  if (method === "POST" && path === "/api/studio/updates/restart") {
    if (!deps.autoUpdateService) {
      sendJson(res, 503, { erro: "AutoUpdateService indisponível." });
      return true;
    }
    const restartInfo = await deps.autoUpdateService.triggerRestart();
    sendJson(res, 200, restartInfo);
    return true;
  }

  // 1. Onboarding
  if (method === "GET" && path === "/api/onboarding") {
    const synced = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);
    sendJson(res, 200, {
      onboarding: synced.onboarding,
      setup_assistant_visible: synced.setup_assistant_visible,
    });
    return true;
  }

  if ((method === "PUT" || method === "PATCH") && path === "/api/onboarding") {
    const body = await readJsonBody(req);
    providerConnection.updateOnboardingState(body as Partial<OnboardingEstado>);
    const synced = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);
    syncBrandPlaceholdersInDatabase(db, getBrandIdentity(providerConnection));
    wsHub.broadcast("onboarding:updated", {
      onboarding: synced.onboarding,
      setup_assistant_visible: synced.setup_assistant_visible,
    });
    sendJson(res, 200, {
      onboarding: synced.onboarding,
      setup_assistant_visible: synced.setup_assistant_visible,
    });
    return true;
  }

  if (method === "POST" && path === "/api/onboarding/setup-assistant") {
    const body = await readJsonBody(req);
    const action = body.action === "reopen" ? "reopen" : "dismiss";
    const result = setSetupAssistantState(db, providerConnection, workspaceRoot, action);
    wsHub.broadcast("onboarding:updated", result);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (method === "POST" && path === "/api/servers/vps-assistant") {
    const body = await readJsonBody(req);
    const action = body.action === "reopen" ? "reopen" : "dismiss";
    const result = setVpsAssistantState(db, providerConnection, action);
    wsHub.broadcast("vps_assistant:updated", result);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  // 2. Provedores, CLIs & Uso
  if (method === "GET" && path === "/api/provedores/status") {
    const force = url.searchParams.get("refresh") === "1";
    const provedores = await providerConnection.getProvidersStatus(force);
    sendJson(res, 200, { provedores });
    return true;
  }

  if (method === "POST" && path === "/api/provedores/conectar") {
    const body = await readJsonBody(req);
    if (typeof body.provedor !== "string") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'provedor'." });
      return true;
    }
    try {
      const status = await providerConnection.connectProvider(body.provedor as ProviderName, {
        apiKey: typeof body.api_key === "string" ? body.api_key : undefined,
        modo:
          typeof body.modo === "string"
            ? (body.modo as "cli" | "api_key" | "local" | "assinatura")
            : undefined,
      });
      wsHub.broadcast("provider:updated", {
        provedor: status.provedor,
        conectado: status.conectado,
        modo: status.modo_conexao,
      });
      sendJson(res, 200, { provedor: status });
    } catch (err) {
      sendJson(res, 400, {
        erro: err instanceof Error ? err.message : "Falha ao conectar provedor.",
      });
    }
    return true;
  }

  if (method === "POST" && path === "/api/provedores/desconectar") {
    const body = await readJsonBody(req);
    if (typeof body.provedor !== "string") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'provedor'." });
      return true;
    }
    const status = await providerConnection.disconnectProvider(body.provedor as ProviderName);
    wsHub.broadcast("provider:updated", {
      provedor: status.provedor,
      conectado: status.conectado,
      modo: status.modo_conexao,
    });
    sendJson(res, 200, { provedor: status });
    return true;
  }

  if (method === "GET" && path === "/api/provedores/uso") {
    const refresh = url.searchParams.get("refresh") === "1";
    const uso = await providerConnection.getUsageSnapshot(refresh);
    sendJson(res, 200, { uso });
    return true;
  }

  if (method === "GET" && path === "/api/uso/analytics") {
    if (url.searchParams.get("importExternal") === "1" || process.env.CRIATIVO_IMPORT_EXTERNAL_DB === "1") {
      importExternalTelemetryIfAvailable(db);
    }
    const dias = Number(url.searchParams.get("dias") ?? "30");
    const agenteId = url.searchParams.get("agente_id");
    const relatorio = computeHostAnalytics(db, {
      dias: Number.isFinite(dias) ? dias : 30,
      agenteId: agenteId || null,
    });
    sendJson(res, 200, { analytics: relatorio });
    return true;
  }

  if (method === "GET" && path === "/api/habilidades") {
    sendJson(res, 200, {
      habilidades: listInstalledSkills(db, undefined, workspaceRoot, deps.licenseService, deps.productRoot),
    });
    return true;
  }

  const skillDetailMatch = path.match(/^\/api\/habilidades\/([^/]+)$/);
  if (method === "GET" && skillDetailMatch) {
    const slug = decodeURIComponent(skillDetailMatch[1]);
    const loaded = loadSkillPromptBySlug(slug, undefined, workspaceRoot, {
      db,
      licenseService: deps.licenseService,
      productRoot: deps.productRoot,
    });
    if (!loaded) {
      sendJson(res, 404, { erro: `Habilidade '${slug}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { slug, caminho: loaded.path, conteudo: loaded.body });
    return true;
  }

  // Marca & Onboarding Estratégico (6 Marcos)
  if (method === "GET" && path === "/api/marca/identidade") {
    sendJson(res, 200, { identidade: getBrandIdentity(providerConnection) });
    return true;
  }

  if (method === "PUT" && path === "/api/marca/identidade") {
    const body = await readJsonBody(req);
    const updated = await saveBrandIdentity(providerConnection, workspaceRoot, body, db);
    sendJson(res, 200, { identidade: updated, onboarding: providerConnection.getOnboardingState() });
    return true;
  }

  // Upgrades Modulares (Bônus & Vídeo em Etapas)
  if (method === "GET" && path === "/api/upgrades") {
    sendJson(res, 200, { upgrades: listUpgradePackages(db, workspaceRoot, deps.licenseService) });
    return true;
  }

  if (method === "POST" && path === "/api/upgrades/instalar") {
    const body = await readJsonBody(req);
    if (body.pacote !== "bonus" && body.pacote !== "video") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'pacote' ('bonus' ou 'video')." });
      return true;
    }
    try {
      const upgrades = await activateUpgradePackage(db, workspaceRoot, body.pacote, deps.licenseService);
      wsHub.broadcast("provider:updated", {
        provedor: "gemini",
        conectado: true,
        modo: "assinatura",
      });
      sendJson(res, 200, { ok: true, upgrades });
    } catch (err) {
      if (err instanceof LicenseValidationError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path === "/api/conectores") {
    if (!deps.vault) {
      sendJson(res, 200, { conectores: [] });
      return true;
    }
    sendJson(res, 200, { conectores: buildConnectorsList(db, deps.vault) });
    return true;
  }

  const conectorActionMatch = path.match(/^\/api\/conectores\/([^/]+)\/(configurar|testar)$/);
  if (method === "POST" && conectorActionMatch) {
    const conectorId = decodeURIComponent(conectorActionMatch[1]);
    const acao = conectorActionMatch[2];
    const body = await readJsonBody(req);

    if (acao === "configurar") {
      if (typeof body.agente_orquestrador_id === "string") {
        const curCfg = providerConnection.getStudioConfig<Record<string, string>>("conectores_orquestradores", {});
        curCfg[conectorId] = body.agente_orquestrador_id;
        providerConnection.setStudioConfig("conectores_orquestradores", curCfg);
      }
      if (deps.vault && body.segredos && typeof body.segredos === "object") {
        for (const [k, v] of Object.entries(body.segredos as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim().length > 0) {
            const val = v.trim();
            deps.vault.setSecret(k, val);
            // Sincroniza aliases Meta para compatibilidade entre UI, Chat e CLI
            if (k === "instagram_access_token") deps.vault.setSecret("META_ACCESS_TOKEN", val);
            if (k === "META_ACCESS_TOKEN") deps.vault.setSecret("instagram_access_token", val);
            if (k === "instagram_business_account_id") deps.vault.setSecret("META_IG_USER_ID", val);
            if (k === "META_IG_USER_ID") deps.vault.setSecret("instagram_business_account_id", val);
          }
        }
      }
      if (conectorId === "mcp" && typeof body.nome === "string" && typeof body.comando === "string") {
        const mcpId = `mcp-${randomUUID().slice(0, 8)}`;
        db.connection
          .prepare(
            `INSERT INTO projecao_mcp_servidores (mcp_id, nome, comando, args_json, env_json, ativo, atualizado_em)
             VALUES (?, ?, ?, ?, ?, 1, ?);`
          )
          .run(
            mcpId,
            body.nome.trim(),
            body.comando.trim(),
            JSON.stringify(Array.isArray(body.args) ? body.args : []),
            JSON.stringify(body.env && typeof body.env === "object" ? body.env : {}),
            new Date().toISOString()
          );
      }
      const lista = deps.vault ? buildConnectorsList(db, deps.vault) : [];
      sendJson(res, 200, { ok: true, conectores: lista });
      return true;
    }

    // acao === "testar"
    if (conectorId === "instagram" && deps.vault) {
      const report = await validateMetaIntegration(deps.vault);
      if (!report.detalhes.tokenConfigurado || !report.detalhes.accountIdConfigurado) {
        sendJson(res, 400, { ok: false, mensagem: "Preencha Access Token e Business Account ID antes de testar." });
        return true;
      }
      sendJson(res, 200, {
        ok: report.ok,
        mensagem: report.ok
          ? `Conectado a @${report.detalhes.username ?? "conta_business"}`
          : report.resumo,
        detalhes: report.detalhes,
      });
      return true;
    }

    if (conectorId === "telegram" && deps.vault) {
      const botToken = deps.vault.getSecret("telegram_bot_token");
      if (!botToken) {
        sendJson(res, 400, { ok: false, mensagem: "Salve o Telegram Bot Token antes de testar." });
        return true;
      }
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const tgJson = (await tgRes.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
        sendJson(res, 200, {
          ok: Boolean(tgJson.ok),
          mensagem: tgJson.ok ? `Bot @${tgJson.result?.username ?? "ativo"} respondendo` : tgJson.description ?? "Token rejeitado",
        });
        return true;
      } catch (err) {
        sendJson(res, 200, { ok: false, mensagem: err instanceof Error ? err.message : "Falha na API Telegram" });
        return true;
      }
    }

    sendJson(res, 200, { ok: true, mensagem: "Configuração validada localmente." });
    return true;
  }

  const browserSignInMatch = path.match(/^\/api\/provedores\/(gemini|claude|openai)\/conectar-navegador$/);
  if (method === "POST" && browserSignInMatch) {
    const provId = browserSignInMatch[1] as "gemini" | "claude" | "openai";
    const body = await readJsonBody(req);
    try {
      const result = await providerConnection.connectProviderViaBrowser(
        provId,
        typeof body.label === "string" ? body.label : undefined,
        (url) => {
          wsHub.broadcast("provider:auth_url", {
            provedor: provId,
            url,
          });
        }
      );
      const uso = await providerConnection.getUsageSnapshot(true);
      wsHub.broadcast("provider:updated", {
        provedor: provId,
        conectado: true,
        modo: "assinatura",
      });
      sendJson(res, 200, { ok: true, conta: result.conta, provedores: result.provedores, uso });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Falha ao concluir autenticação no navegador.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const oauthCallbackRelayMatch = path.match(/^\/api\/provedores\/(claude|openai)\/oauth-callback-relay$/);
  if (method === "POST" && oauthCallbackRelayMatch) {
    const provId = oauthCallbackRelayMatch[1] as "claude" | "openai";
    const body = await readJsonBody(req);
    const rawCallback =
      typeof body.callback_path === "string"
        ? body.callback_path
        : typeof body.callback_url === "string"
          ? body.callback_url
          : "";
    try {
      const relayRes = await providerConnection
        .getCliOAuthService()
        .relayLoopbackCallback(provId, rawCallback);
      if (!relayRes.accepted) {
        sendJson(res, 400, {
          ok: false,
          accepted: false,
          status: relayRes.status,
          erro: relayRes.errorMessage ?? "A CLI rejeitou o callback OAuth.",
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        accepted: true,
        status: relayRes.status,
        body: relayRes.body,
        content_type: relayRes.contentType,
      });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        accepted: false,
        erro: err instanceof Error ? err.message : "Falha ao entregar callback OAuth ao provedor.",
      });
    }
    return true;
  }

  const cancelSignInMatch = path.match(/^\/api\/provedores\/(gemini|claude|openai)\/cancelar-login$/);
  if (method === "POST" && cancelSignInMatch) {
    const provId = cancelSignInMatch[1] as "gemini" | "claude" | "openai";
    const canceled = providerConnection.cancelBrowserSignIn(provId);
    sendJson(res, 200, { ok: true, canceled });
    return true;
  }

  const visibilityMatch = path.match(
    /^\/api\/provedores\/(gemini|claude|openai|opencode|grok|ollama)\/modelos-visibilidade$/
  );
  if (method === "POST" && visibilityMatch) {
    const provId = visibilityMatch[1] as "gemini" | "claude" | "openai" | "opencode" | "grok" | "ollama";
    const body = await readJsonBody(req);
    const ocultos = Array.isArray(body.ocultos)
      ? body.ocultos.filter((item): item is string => typeof item === "string")
      : [];
    const provedores = await providerConnection.setHiddenModels(provId, ocultos);
    const updated = provedores.find((p) => p.provedor === provId);
    wsHub.broadcast("provider:updated", {
      provedor: provId,
      conectado: updated?.conectado ?? false,
      modo: updated?.modo_conexao ?? "nenhum",
    });
    sendJson(res, 200, { ok: true, provedores });
    return true;
  }

  const poolMatch = path.match(/^\/api\/provedores\/([^/]+)\/pool$/);
  if (method === "POST" && poolMatch) {
    const provId = decodeURIComponent(poolMatch[1]);
    const body = await readJsonBody(req);
    const patch = {
      habilitado: typeof body.habilitado === "boolean" ? body.habilitado : undefined,
      contas_excluidas: Array.isArray(body.contas_excluidas) ? (body.contas_excluidas as string[]) : undefined,
      conta_em_uso: typeof body.conta_em_uso === "string" || body.conta_em_uso === null ? body.conta_em_uso : undefined,
    };
    if (provId === "claude" || provId === "openai") {
      providerConnection.getCliOAuthService().setPoolSettings(provId, patch);
    } else {
      providerConnection.getAntigravityService().setPoolSettings(patch);
    }
    const provedores = await providerConnection.getProvidersStatus(true);
    sendJson(res, 200, { ok: true, provedores });
    return true;
  }

  const accountsAddMatch = path.match(/^\/api\/provedores\/([^/]+)\/contas$/);
  if (method === "POST" && accountsAddMatch) {
    const body = await readJsonBody(req);
    if (typeof body.email !== "string" || typeof body.access_token !== "string") {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'email' e 'access_token'." });
      return true;
    }
    const conta = providerConnection.getAntigravityService().addManualTokenAccount({
      email: body.email,
      label: typeof body.label === "string" ? body.label : undefined,
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      expiry: typeof body.expiry === "string" ? body.expiry : undefined,
    });
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(false);
    const geminiProv = provedores.find((p) => p.provedor === "gemini");
    const enrichedConta = geminiProv?.contas?.find((c) => c.id === conta.id) ?? conta;
    wsHub.broadcast("provider:updated", {
      provedor: "gemini",
      conectado: true,
      modo: "assinatura",
    });
    sendJson(res, 201, { conta: enrichedConta, provedores, uso });
    return true;
  }

  if (method === "POST" && path === "/api/provedores/openai/contas-auth") {
    const body = await readJsonBody(req);
    const authJson = typeof body.auth_json === "string" ? body.auth_json : "";
    if (!authJson.trim()) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'auth_json'." });
      return true;
    }
    const conta = await providerConnection.getCliOAuthService().importCodexAuthAccount({
      authJson,
      email: typeof body.email === "string" ? body.email : null,
      plano: typeof body.plano === "string" ? body.plano : null,
      label: typeof body.label === "string" ? body.label : undefined,
    });
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(false);
    const openaiProv = provedores.find((p) => p.provedor === "openai");
    const enrichedConta = openaiProv?.contas?.find((c) => c.id === conta.id) ?? conta;
    wsHub.broadcast("provider:updated", {
      provedor: "openai",
      conectado: true,
      modo: "assinatura",
    });
    sendJson(res, 201, { ok: true, conta: enrichedConta, provedores, uso });
    return true;
  }

  const accountDelMatch = path.match(/^\/api\/provedores\/([^/]+)\/contas\/([^/]+)$/);
  if (method === "DELETE" && accountDelMatch) {
    const provId = decodeURIComponent(accountDelMatch[1]);
    const contaId = decodeURIComponent(accountDelMatch[2]);
    const removed =
      provId === "claude" || provId === "openai"
        ? providerConnection.getCliOAuthService().removeAccount(provId, contaId)
        : providerConnection.getAntigravityService().removeAccount(contaId);
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(true);
    sendJson(res, removed ? 200 : 404, { ok: removed, provedores, uso });
    return true;
  }

  // 3. Agentes enriquecidos + criação de customizado + edição completa
  if (method === "GET" && path === "/api/agentes") {
    const apenasDesbloqueados =
      url.searchParams.get("apenas_desbloqueados") === "1" ||
      url.searchParams.get("onlyUnlocked") === "1";
    const includeSetupExplicit = url.searchParams.get("incluir_setup") === "1";
    const includeVpsExplicit = url.searchParams.get("incluir_vps") === "1";
    const setupVisible = includeSetupExplicit || isSetupAssistantVisible(db, providerConnection);
    const vpsVisible = includeVpsExplicit || isVpsAssistantVisible(db);
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
      .all() as Array<Parameters<typeof enrichAgentRow>[1]>;
    const currentBrand = getBrandIdentity(providerConnection);
    const enriched = rows
      .filter((row) => row.agente_id !== SETUP_ASSISTANT_AGENT_DEF.agente_id || setupVisible)
      .filter((row) => row.agente_id !== "assistente_servidor_vps" || vpsVisible)
      .map((row) => enrichAgentRow(db, row, workspaceRoot, deps.licenseService, currentBrand));
    const filtered = apenasDesbloqueados
      ? enriched.filter((a) => a.config.upgrade_desbloqueado !== false)
      : enriched;
    const unlockedSummary = computeUnlockedAgentsSummary(db, workspaceRoot, deps.licenseService);
    sendJson(res, 200, {
      agentes: filtered,
      unlocked_agents_count: unlockedSummary.unlocked_agents_count,
      setup_assistant_visible: isSetupAssistantVisible(db, providerConnection),
      vps_assistant_visible: isVpsAssistantVisible(db),
    });
    return true;
  }

  if (method === "GET" && path === "/api/agentes/excluidos") {
    const metaList = getDeletedNativeAgentsMeta(db);
    const allRoster = getSetupCompatibleRoster();
    const excluidos: DeletedNativeAgentInfo[] = [];
    for (const meta of metaList) {
      const def = allRoster.find((a) => a.agente_id === meta.agente_id);
      if (!def) continue;
      excluidos.push({
        agente_id: def.agente_id,
        nome: def.nome,
        papel: def.papel,
        pasta: def.pasta,
        avatar_shape: def.avatar_shape,
        avatar_color: def.avatar_color,
        pacote: def.pacote,
        deleted_at: meta.deleted_at || undefined,
      });
    }
    sendJson(res, 200, { excluidos });
    return true;
  }

  if (method === "POST" && path === "/api/agentes/restaurar-excluidos") {
    const metaList = getDeletedNativeAgentsMeta(db);
    const allRoster = getSetupCompatibleRoster();
    const now = new Date().toISOString();
    const restoredIds: string[] = [];

    db.runInTransaction(() => {
      for (const meta of metaList) {
        const def = allRoster.find((a) => a.agente_id === meta.agente_id);
        unmarkNativeAgentDeleted(db, meta.agente_id);
        if (!def) continue;
        const restoredConfig = {
          frente: def.frente,
          pacote: def.pacote,
          pasta: def.pasta,
          skill_slug: def.skill_slug,
          avatar_shape: def.avatar_shape,
          avatar_color: def.avatar_color,
          avatar_style: "classic" as const,
          avatar_variant: def.avatar_shape,
          avatar_image_url: null,
          effort: def.effort,
          ferramentas: def.ferramentas,
          prompt_base: def.prompt_base,
          customizado: false,
        };
        db.connection
          .prepare(
            `INSERT INTO projecao_agentes (
               agente_id, nome, papel, modelo_padrao, status,
               skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
             ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?)
             ON CONFLICT(agente_id) DO UPDATE SET
               nome = excluded.nome,
               papel = excluded.papel,
               modelo_padrao = excluded.modelo_padrao,
               config_json = excluded.config_json,
               atualizado_em = excluded.atualizado_em;`,
          )
          .run(
            def.agente_id,
            def.nome,
            def.papel,
            def.modelo_padrao,
            JSON.stringify(def.skills_paths),
            def.ordem_exibicao,
            JSON.stringify(restoredConfig),
            now,
          );
        restoredIds.push(def.agente_id);
      }
    });

    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, restored_ids: restoredIds });
    return true;
  }

  if (method === "POST" && path === "/api/agentes/avatar/upload") {
    const body = await readJsonBody(req);
    const rawBase64 =
      typeof body.conteudo_base64 === "string"
        ? body.conteudo_base64
        : typeof body.data_base64 === "string"
          ? body.data_base64
          : "";
    if (!rawBase64.trim()) {
      sendJson(res, 400, { ok: false, erro: "Campo obrigatório: 'conteudo_base64'." });
      return true;
    }

    const dataUriMatch = rawBase64.match(/^data:([^;]+);base64,/i);
    const rawMime = (
      dataUriMatch?.[1] ??
      (typeof body.mime_type === "string" ? body.mime_type : "")
    )
      .trim()
      .toLowerCase();

    const extFromMime =
      rawMime === "image/png"
        ? ".png"
        : rawMime === "image/jpeg" || rawMime === "image/jpg"
          ? ".jpg"
          : rawMime === "image/webp"
            ? ".webp"
            : null;

    if (!extFromMime) {
      sendJson(res, 400, {
        ok: false,
        erro: "Formato inválido. Envie uma imagem PNG, JPG/JPEG ou WebP.",
      });
      return true;
    }

    const base64Clean = rawBase64.replace(/^data:[^;]+;base64,/i, "").trim();
    const buffer = Buffer.from(base64Clean, "base64");
    if (buffer.length === 0) {
      sendJson(res, 400, { ok: false, erro: "Imagem base64 vazia ou inválida." });
      return true;
    }
    if (buffer.length > 5 * 1024 * 1024) {
      sendJson(res, 413, { ok: false, erro: "A foto do avatar excede o limite de 5 MB." });
      return true;
    }

    const avatarDir = resolve(workspaceRoot, "recursos", "avatares");
    mkdirSync(avatarDir, { recursive: true });
    const fileName = `avatar-${randomUUID().slice(0, 12)}${extFromMime}`;
    const targetPath = resolve(avatarDir, fileName);
    writeFileSync(targetPath, buffer);

    const relPath = `recursos/avatares/${fileName}`;
    const normalizedMime = extFromMime === ".jpg" ? "image/jpeg" : `image/${extFromMime.slice(1)}`;
    sendJson(res, 201, {
      ok: true,
      avatar_image_url: `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`,
      caminho_relativo: relPath,
      mime_type: normalizedMime,
      tamanho_bytes: buffer.length,
    });
    return true;
  }

  if (method === "POST" && path === "/api/agentes/avatar/gerar") {
    const body = await readJsonBody(req);
    const rawPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (rawPrompt.length < 3) {
      sendJson(res, 400, {
        ok: false,
        erro: "Descreva o avatar com pelo menos 3 caracteres antes de gerar.",
      });
      return true;
    }

    const estiloPrompt = typeof body.estilo === "string" ? body.estilo.trim() : "";
    const nomeAgente = typeof body.nome_agente === "string" ? body.nome_agente.trim() : "";
    const styleClause = estiloPrompt ? `Estilo visual desejado: ${estiloPrompt}. ` : "";
    const roleClause = nomeAgente ? `Personagem/Agente: ${nomeAgente}. ` : "";
    const avatarPrompt = `Crie um avatar quadrado 1:1 para ícone de perfil circular de aplicativo. ${roleClause}${styleClause}Composição: rosto ou personagem perfeitamente centralizado no quadro, enquadramento fechado de busto/cabeça com respiro nas bordas para recorte redondo, iluminação expressiva, alta nitidez e fundo limpo/harmonioso em baixa complexidade visual. Descrição do usuário: ${rawPrompt}. Sem textos, letras, números ou marcas d'água.`;

    const hasGeminiImgKey = Boolean(
      deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key")
    );
    const hasOpenAiImgKey = Boolean(
      deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "openai_api_key")
    );
    const hasFalImgKey = Boolean(
      deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "fal_api_key", "flux_api_key")
    );
    const hasImgApiKey = hasGeminiImgKey || hasOpenAiImgKey || hasFalImgKey;

    const agService = providerConnection.getAntigravityService();
    const agSnapshot = await agService.getLiveSnapshot(false).catch(() => null);
    const hasAntigravityAccount = Boolean(
      agSnapshot?.contas.some((c) => c.estado === "conectado" || Boolean(c.token_valido))
    );

    if (!hasImgApiKey && !hasAntigravityAccount) {
      sendJson(res, 400, {
        ok: false,
        erro: "Nenhuma chave de geração de imagem (Gemini/OpenAI/Flux no Cofre) ou conta Google/Antigravity conectada. Conecte um provedor ou envie uma foto do seu computador.",
      });
      return true;
    }

    const avatarDir = resolve(workspaceRoot, "recursos", "avatares");
    mkdirSync(avatarDir, { recursive: true });
    let generatedResult:
      | { relPath: string; engine: string; model: string }
      | null = null;
    let lastGenError: unknown = null;

    if (hasImgApiKey && deps.vault) {
      try {
        const fileName = `avatar-ia-${randomUUID().slice(0, 10)}.png`;
        const diskPath = resolve(avatarDir, fileName);
        const imgRes = await generateImageTool(
          {
            aspect_ratio: "1:1",
            prompt: avatarPrompt,
            output_path: diskPath,
          },
          { vault: deps.vault }
        );
        generatedResult = {
          relPath: `recursos/avatares/${fileName}`,
          engine: imgRes.engine_used,
          model: imgRes.model_used,
        };
      } catch (err) {
        lastGenError = err;
      }
    }

    if (!generatedResult && hasAntigravityAccount && agSnapshot) {
      try {
        const imgGen = await agService.executeCodeAssistGenerate({
          model: agSnapshot.imageGenerationModelIds[0] ?? "gemini-3.1-flash-image",
          messages: [{ role: "user", text: avatarPrompt }],
          generateImage: true,
        });
        if (imgGen.images.length > 0) {
          const firstImg = imgGen.images[0]!;
          const ext = firstImg.mimeType.includes("png")
            ? ".png"
            : firstImg.mimeType.includes("webp")
              ? ".webp"
              : ".jpg";
          const fileName = `avatar-ia-${randomUUID().slice(0, 10)}${ext}`;
          const diskPath = resolve(avatarDir, fileName);
          writeFileSync(diskPath, Buffer.from(firstImg.dataBase64, "base64"));
          generatedResult = {
            relPath: `recursos/avatares/${fileName}`,
            engine: "antigravity",
            model: imgGen.modelUsed,
          };
        }
      } catch (err) {
        lastGenError = err;
      }
    }

    if (!generatedResult) {
      const msg =
        lastGenError instanceof Error
          ? lastGenError.message
          : "O provedor de imagem não retornou arquivo válido.";
      sendJson(res, 502, {
        ok: false,
        erro: `Falha ao gerar avatar com IA: ${msg}`,
      });
      return true;
    }

    sendJson(res, 201, {
      ok: true,
      avatar_image_url: `/api/arquivos/raw?path=${encodeURIComponent(generatedResult.relPath)}`,
      caminho_relativo: generatedResult.relPath,
      engine: generatedResult.engine,
      model: generatedResult.model,
    });
    return true;
  }

  const VALID_AVATAR_STYLES = new Set<AvatarStyle>([
    "classic",
    "plush",
    "cartoon",
    "robots",
    "personas",
    "pets",
    "monsters",
    "image",
  ]);
  const sanitizeAvatarStyle = (raw: unknown): AvatarStyle | undefined =>
    typeof raw === "string" && VALID_AVATAR_STYLES.has(raw as AvatarStyle)
      ? (raw as AvatarStyle)
      : undefined;

  if (method === "POST" && path === "/api/agentes") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'nome'." });
      return true;
    }
    const nome = body.nome.trim();
    const slugBase = nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const agenteId = `custom_${slugBase || "agente"}_${randomUUID().slice(0, 4)}`;
    const maxOrderRow = db.connection
      .prepare(`SELECT COALESCE(MAX(ordem_exibicao), 15) as max_ordem FROM projecao_agentes;`)
      .get() as { max_ordem: number };
    const agora = new Date().toISOString();

    const currentBrand = getBrandIdentity(providerConnection);
    const hasBrand = hasConfiguredBrand(currentBrand);
    const rawPromptBase =
      typeof body.prompt_base === "string" && body.prompt_base.trim().length > 0
        ? body.prompt_base.trim()
        : `Você é ${nome}, agente customizado do Criativo AI Studio para [NOME_DA_MARCA].`;
    const resolvedPromptBase = hasBrand
      ? interpolateBrandPlaceholders(rawPromptBase, currentBrand)
      : rawPromptBase;

    const incomingBodyConfig =
      body.config && typeof body.config === "object"
        ? (body.config as Record<string, unknown>)
        : {};
    const resolvedAvatarStyle =
      sanitizeAvatarStyle(body.avatar_style) ??
      sanitizeAvatarStyle(incomingBodyConfig.avatar_style) ??
      "classic";
    const resolvedAvatarVariant =
      typeof body.avatar_variant === "string" && body.avatar_variant.trim()
        ? body.avatar_variant.trim()
        : typeof incomingBodyConfig.avatar_variant === "string" && incomingBodyConfig.avatar_variant.trim()
          ? incomingBodyConfig.avatar_variant.trim()
          : undefined;
    const resolvedAvatarImageUrl =
      typeof body.avatar_image_url === "string" && body.avatar_image_url.trim()
        ? body.avatar_image_url.trim()
        : typeof incomingBodyConfig.avatar_image_url === "string" && incomingBodyConfig.avatar_image_url.trim()
          ? incomingBodyConfig.avatar_image_url.trim()
          : null;

    const config = {
      frente: "custom",
      pasta: typeof body.pasta === "string" ? body.pasta : "Agentes Customizados",
      skill_slug: "custom-agent",
      avatar_shape: typeof body.avatar_shape === "string" ? body.avatar_shape : "rounded_square",
      avatar_color: typeof body.avatar_color === "string" ? body.avatar_color : "#38bdf8",
      avatar_style: resolvedAvatarStyle,
      ...(resolvedAvatarVariant ? { avatar_variant: resolvedAvatarVariant } : {}),
      ...(resolvedAvatarImageUrl ? { avatar_image_url: resolvedAvatarImageUrl } : {}),
      effort: typeof body.effort === "string" ? body.effort : "alto",
      prompt_base: resolvedPromptBase,
      customizado: true,
    };

    const rawPapel =
      typeof body.papel === "string" && body.papel.trim().length > 0
        ? body.papel.trim()
        : resolvedPromptBase.slice(0, 120);
    const papel = hasBrand ? interpolateBrandPlaceholders(rawPapel, currentBrand) : rawPapel;
    const modeloPadrao =
      typeof body.modelo_padrao === "string" && body.modelo_padrao.trim().length > 0
        ? body.modelo_padrao.trim()
        : "gemini-2.5-flash";

    db.connection
      .prepare(
        `INSERT INTO projecao_agentes (
          agente_id, nome, papel, modelo_padrao, status,
          skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
        ) VALUES (?, ?, ?, ?, 'ocioso', '[]', NULL, ?, ?, ?);`
      )
      .run(
        agenteId,
        nome,
        papel,
        modeloPadrao,
        Number(maxOrderRow.max_ordem) + 1,
        JSON.stringify(config),
        agora
      );

    // Mensagem inicial de apresentação na conversa
    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
         VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', NULL, 0, ?);`
      )
      .run(
        `msg-${randomUUID()}`,
        `agente:${agenteId}`,
        agenteId,
        nome,
        `Olá! Sou **${nome}**. ${config.prompt_base}\n\nEnvie sua instrução abaixo ou anexe imagens no botão **+**.`,
        agora
      );

    const createdRow = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];

    sendJson(res, 201, {
      agente: enrichAgentRow(db, createdRow, workspaceRoot, deps.licenseService, currentBrand),
    });
    return true;
  }

  const agentUpdateMatch = path.match(/^\/api\/agentes\/([^/]+)$/);
  if (agentUpdateMatch && (method === "PUT" || method === "PATCH")) {
    const agenteId = decodeURIComponent(agentUpdateMatch[1]);
    const body = await readJsonBody(req);
    const existing = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1] | undefined;

    if (!existing) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const currentConfig = safeJsonParse<Record<string, unknown>>(existing.config_json, {});
    const incomingConfig =
      body.config && typeof body.config === "object"
        ? (body.config as Record<string, unknown>)
        : {};

    // Validação de pastas autorizadas fora do workspace (FS23-01)
    let nextAllowedFolders: AgentAllowedFolder[] | undefined;
    const rawFoldersInput =
      body.allowed_folders !== undefined
        ? body.allowed_folders
        : incomingConfig.allowed_folders !== undefined
          ? incomingConfig.allowed_folders
          : undefined;
    if (rawFoldersInput !== undefined) {
      const sanitized = sanitizeAllowedFoldersList(rawFoldersInput);
      if (!sanitized.ok) {
        sendJson(res, 400, { erro: sanitized.error });
        return true;
      }
      nextAllowedFolders = sanitized.folders;
    }

    // Validação de cor personalizada do balão de chat do agente
    const hasExplicitChatColor =
      body.chat_color !== undefined || incomingConfig.chat_color !== undefined;
    const rawChatColor =
      body.chat_color !== undefined ? body.chat_color : incomingConfig.chat_color;
    const nextChatColor =
      typeof rawChatColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(rawChatColor.trim())
        ? rawChatColor.trim().toUpperCase()
        : null;

    const rawAutoMem =
      body.auto_memory_enabled !== undefined
        ? body.auto_memory_enabled
        : incomingConfig.auto_memory_enabled;
    const hasExplicitAutoMem = typeof rawAutoMem === "boolean";

    const rawMarkedUnread =
      body.marked_unread !== undefined
        ? body.marked_unread
        : incomingConfig.marked_unread;
    const hasExplicitMarkedUnread = typeof rawMarkedUnread === "boolean";

    const rawBackupInput =
      body.backup_models && typeof body.backup_models === "object"
        ? (body.backup_models as Partial<BackupModelsConfig>)
        : incomingConfig.backup_models && typeof incomingConfig.backup_models === "object"
          ? (incomingConfig.backup_models as Partial<BackupModelsConfig>)
          : null;

    let nextBackupModelsJson = existing.backup_models_json ?? '{"automatic":false,"order":[]}';
    if (rawBackupInput) {
      const normalizedOrder: BackupModelChoice[] = [];
      if (Array.isArray(rawBackupInput.order)) {
        for (const item of rawBackupInput.order.slice(0, MAX_BACKUP_MODELS)) {
          if (item && typeof item === "object" && typeof item.modelo === "string" && item.modelo.trim()) {
            normalizedOrder.push({
              provedor: (typeof item.provedor === "string"
                ? item.provedor
                : deps.providers.resolveProviderName(item.modelo)) as ProviderName,
              modelo: item.modelo.trim(),
              conta_id: typeof item.conta_id === "string" ? item.conta_id : null,
            });
          }
        }
      }
      const prevParsed = parseBackupModelsJson(existing.backup_models_json);
      nextBackupModelsJson = JSON.stringify({
        automatic:
          typeof rawBackupInput.automatic === "boolean"
            ? rawBackupInput.automatic
            : prevParsed.automatic,
        order: Array.isArray(rawBackupInput.order) ? normalizedOrder : prevParsed.order,
      });
    }

    const rawPerm = body.permission_level ?? incomingConfig.permission_level ?? existing.permission_level;
    const nextPermissionLevel: PermissionLevel =
      rawPerm === "ask" || rawPerm === "full" || rawPerm === "workspace"
        ? rawPerm
        : "workspace";

    const nextAllowNewChat =
      typeof body.allow_new_chat === "boolean"
        ? body.allow_new_chat
        : typeof incomingConfig.allow_new_chat === "boolean"
          ? incomingConfig.allow_new_chat
          : existing.allow_new_chat !== 0;

    const rawAllowQuickAck =
      body.allow_quick_ack ??
      body.allow_quick_acknowledgement ??
      incomingConfig.allow_quick_ack ??
      incomingConfig.allow_quick_acknowledgement;
    const nextAllowQuickAck =
      typeof rawAllowQuickAck === "boolean" ? rawAllowQuickAck : existing.allow_quick_ack !== 0;

    const nextBrowserProfileId =
      body.browser_profile_id !== undefined
        ? typeof body.browser_profile_id === "string" && body.browser_profile_id.trim()
          ? body.browser_profile_id.trim()
          : null
        : incomingConfig.browser_profile_id !== undefined
          ? typeof incomingConfig.browser_profile_id === "string" &&
            incomingConfig.browser_profile_id.trim()
            ? incomingConfig.browser_profile_id.trim()
            : null
          : (existing.browser_profile_id ?? null);

    const rawNotif =
      body.notification_level ?? incomingConfig.notification_level ?? existing.notification_level;
    const nextNotificationLevel: AgentNotificationLevel =
      rawNotif === "mentions" || rawNotif === "muted" ? rawNotif : "all";

    const nextPinned =
      typeof body.pinned === "boolean"
        ? body.pinned
        : typeof incomingConfig.pinned === "boolean"
          ? incomingConfig.pinned
          : existing.pinned === 1;

    const nextHidden =
      typeof body.hidden === "boolean"
        ? body.hidden
        : typeof incomingConfig.hidden === "boolean"
          ? incomingConfig.hidden
          : existing.hidden === 1;

    const nextSectionId =
      body.section_id !== undefined
        ? typeof body.section_id === "string" && body.section_id.trim()
          ? body.section_id.trim()
          : null
        : incomingConfig.section_id !== undefined
          ? typeof incomingConfig.section_id === "string" && incomingConfig.section_id.trim()
            ? incomingConfig.section_id.trim()
            : null
          : (existing.section_id ?? null);

    const nextAvatarStyle =
      sanitizeAvatarStyle(body.avatar_style) ?? sanitizeAvatarStyle(incomingConfig.avatar_style);
    const nextAvatarVariant =
      typeof body.avatar_variant === "string" && body.avatar_variant.trim()
        ? body.avatar_variant.trim()
        : typeof incomingConfig.avatar_variant === "string" && incomingConfig.avatar_variant.trim()
          ? incomingConfig.avatar_variant.trim()
          : undefined;
    const hasExplicitAvatarImage =
      body.avatar_image_url !== undefined || incomingConfig.avatar_image_url !== undefined;
    const rawAvatarImage =
      body.avatar_image_url !== undefined ? body.avatar_image_url : incomingConfig.avatar_image_url;
    const nextAvatarImageUrl =
      typeof rawAvatarImage === "string" && rawAvatarImage.trim() ? rawAvatarImage.trim() : null;

    const nextConfig = {
      ...currentConfig,
      ...incomingConfig,
      ...(typeof body.effort === "string" ? { effort: body.effort } : {}),
      ...(typeof body.avatar_shape === "string" ? { avatar_shape: body.avatar_shape } : {}),
      ...(typeof body.avatar_color === "string" ? { avatar_color: body.avatar_color } : {}),
      ...(nextAvatarStyle ? { avatar_style: nextAvatarStyle } : {}),
      ...(nextAvatarVariant ? { avatar_variant: nextAvatarVariant } : {}),
      ...(hasExplicitAvatarImage ? { avatar_image_url: nextAvatarImageUrl } : {}),
      ...(hasExplicitChatColor ? { chat_color: nextChatColor } : {}),
      ...(nextAllowedFolders !== undefined ? { allowed_folders: nextAllowedFolders } : {}),
      ...(hasExplicitAutoMem ? { auto_memory_enabled: Boolean(rawAutoMem) } : {}),
      ...(hasExplicitMarkedUnread ? { marked_unread: Boolean(rawMarkedUnread) } : {}),
      ...(typeof body.prompt_base === "string" ? { prompt_base: body.prompt_base } : {}),
      ...(body.modo_ocupado === "steer" || body.modo_ocupado === "queue"
        ? { modo_ocupado: body.modo_ocupado }
        : {}),
      allow_new_chat: nextAllowNewChat,
      allow_quick_ack: nextAllowQuickAck,
      allow_quick_acknowledgement: nextAllowQuickAck,
      backup_models: parseBackupModelsJson(nextBackupModelsJson),
      permission_level: nextPermissionLevel,
      browser_profile_id: nextBrowserProfileId,
      notification_level: nextNotificationLevel,
      pinned: nextPinned,
      hidden: nextHidden,
      section_id: nextSectionId,
      ...(typeof body.task_limit === "number" && Number.isFinite(body.task_limit)
        ? { task_limit: Math.max(1, Math.min(4, Math.floor(body.task_limit))) }
        : {}),
    };

    const nextModel =
      typeof body.modelo_padrao === "string" ? body.modelo_padrao : existing.modelo_padrao;
    const nextNome = typeof body.nome === "string" ? body.nome : existing.nome;
    const nextPapel = typeof body.papel === "string" ? body.papel : existing.papel;

    db.connection
      .prepare(
        `UPDATE projecao_agentes SET
           nome = ?,
           papel = ?,
           modelo_padrao = ?,
           config_json = ?,
           backup_models_json = ?,
           permission_level = ?,
           allow_new_chat = ?,
           allow_quick_ack = ?,
           browser_profile_id = ?,
           notification_level = ?,
           pinned = ?,
           hidden = ?,
           section_id = ?,
           atualizado_em = ?
         WHERE agente_id = ?;`
      )
      .run(
        nextNome,
        nextPapel,
        nextModel,
        JSON.stringify(nextConfig),
        nextBackupModelsJson,
        nextPermissionLevel,
        nextAllowNewChat ? 1 : 0,
        nextAllowQuickAck ? 1 : 0,
        nextBrowserProfileId,
        nextNotificationLevel,
        nextPinned ? 1 : 0,
        nextHidden ? 1 : 0,
        nextSectionId,
        new Date().toISOString(),
        agenteId
      );

    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];

    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot, deps.licenseService) });
    return true;
  }

  if (method === "DELETE" && agentUpdateMatch) {
    const agenteId = decodeURIComponent(agentUpdateMatch[1]);
    const existing = db.connection
      .prepare(`SELECT agente_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { agente_id: string } | undefined;
    if (!existing) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const isNative = getSetupCompatibleRoster().some((a) => a.agente_id === agenteId);
    try {
      mutateSidebarLayout(db, { op: "set_pin", agentId: agenteId, pinned: false });
    } catch {
      // ignora caso agente não esteja nos pins
    }

    db.runInTransaction(() => {
      db.connection.prepare(`DELETE FROM projecao_agentes WHERE agente_id = ?;`).run(agenteId);
      if (isNative) {
        markNativeAgentDeleted(db, agenteId);
      }
    });

    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, agente_id: agenteId, nativo: isNative });
    return true;
  }

  const agentRestoreMatch = path.match(/^\/api\/agentes\/([^/]+)\/restaurar$/);
  if (method === "POST" && agentRestoreMatch) {
    const agenteId = decodeURIComponent(agentRestoreMatch[1]);
    const def = getSetupCompatibleRoster().find((a) => a.agente_id === agenteId);
    if (!def) {
      sendJson(res, 404, { erro: `Agente padrão '${agenteId}' não encontrado.` });
      return true;
    }
    const now = new Date().toISOString();
    const restoredConfig = {
      frente: def.frente,
      pacote: def.pacote,
      pasta: def.pasta,
      skill_slug: def.skill_slug,
      avatar_shape: def.avatar_shape,
      avatar_color: def.avatar_color,
      avatar_style: "classic" as const,
      avatar_variant: def.avatar_shape,
      avatar_image_url: null,
      chat_color: null,
      allowed_folders: [],
      auto_memory_enabled: true,
      marked_unread: false,
      effort: def.effort,
      ferramentas: def.ferramentas,
      prompt_base: def.prompt_base,
      customizado: false,
    };
    db.runInTransaction(() => {
      unmarkNativeAgentDeleted(db, agenteId);
      db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status,
             skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
           ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?)
           ON CONFLICT(agente_id) DO UPDATE SET
             nome = excluded.nome,
             papel = excluded.papel,
             modelo_padrao = excluded.modelo_padrao,
             config_json = excluded.config_json,
             atualizado_em = excluded.atualizado_em;`,
        )
        .run(
          def.agente_id,
          def.nome,
          def.papel,
          def.modelo_padrao,
          JSON.stringify(def.skills_paths),
          def.ordem_exibicao,
          JSON.stringify(restoredConfig),
          now,
        );
    });
    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot, deps.licenseService) });
    return true;
  }

  // Páginas visuais interativas (Generative UI — html_render)
  const visualPageMatch = path.match(/^\/api\/agentes\/([^/]+)\/visual-pages\/([^/]+)$/);
  if (method === "GET" && visualPageMatch) {
    const arquivoId = decodeURIComponent(visualPageMatch[2]);
    if (!deps.visualPreview) {
      sendJson(res, 503, { erro: "ChatVisualPreviewService não inicializado neste daemon." });
      return true;
    }
    const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
    const page = deps.visualPreview.getCompiledPage(arquivoId, theme);
    if (!page) {
      sendJson(res, 404, { erro: `Página visual '${arquivoId}' não encontrada.` });
      return true;
    }
    if (url.searchParams.get("raw") === "1") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy": "sandbox allow-scripts allow-forms;",
      });
      res.end(page.html);
      return true;
    }
    sendJson(res, 200, { ok: true, ...page });
    return true;
  }

  // Memórias do agente (Fase 14 — FTS5, orçamento 8.192 bytes, edição manual e revisão imediata)
  const agentMemoriesReviewMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias\/revisar$/);
  if (method === "POST" && agentMemoriesReviewMatch) {
    const agenteId = decodeURIComponent(agentMemoriesReviewMatch[1]);
    if (!deps.memoryReview) {
      sendJson(res, 503, { erro: "MemoryReviewService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
    const alteracoes = await deps.memoryReview.triggerNow(agenteId, threadId);
    sendJson(res, 200, { ok: true, alteracoes });
    return true;
  }

  const agentMemoryItemMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias\/([^/]+)$/);
  if (agentMemoryItemMatch && (method === "PUT" || method === "DELETE")) {
    const agenteId = decodeURIComponent(agentMemoryItemMatch[1]);
    const memoriaId = decodeURIComponent(agentMemoryItemMatch[2]);
    const memMgr = deps.memoryManager ?? new MemoryManager(db);

    if (method === "DELETE") {
      const removed = memMgr.deleteMemory(agenteId, memoriaId, true);
      if (!removed) {
        sendJson(res, 404, { erro: `Memória '${memoriaId}' não encontrada.` });
        return true;
      }
      sendJson(res, 200, { ok: true, memoria_id: memoriaId, snapshot: memMgr.getMemoriesSnapshot(agenteId) });
      return true;
    }

    const body = await readJsonBody(req);
    try {
      const updated = memMgr.updateManualMemory(agenteId, memoriaId, {
        texto: typeof body.texto === "string" ? body.texto : undefined,
        categoria:
          body.categoria === "essential" || body.categoria === "searchable"
            ? body.categoria
            : undefined,
        escopo_site:
          typeof body.escopo_site === "string" || body.escopo_site === null
            ? body.escopo_site
            : undefined,
      });
      sendJson(res, 200, { ok: true, memoria: updated, snapshot: memMgr.getMemoriesSnapshot(agenteId) });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const agentMemoriesMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias$/);
  if (agentMemoriesMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMemoriesMatch[1]);
    const memMgr = deps.memoryManager ?? new MemoryManager(db);

    if (method === "GET") {
      const snap = memMgr.getMemoriesSnapshot(agenteId);
      const rawCat = url.searchParams.get("categoria");
      const categoria: MemoriaInclusao | undefined =
        rawCat === "essential" || rawCat === "searchable" ? rawCat : undefined;
      const site = url.searchParams.get("site");
      const busca = url.searchParams.get("busca") ?? undefined;
      const after = url.searchParams.get("after") ?? undefined;

      if (categoria || site || busca || after) {
        const filtered = memMgr.listMemoriesPaginated(agenteId, {
          categoria,
          site,
          busca,
          after,
          limit: 100,
        });
        sendJson(res, 200, {
          memorias: filtered.items,
          nextCursor: filtered.nextCursor,
          usedBytes: snap.usedBytes,
          budgetBytes: snap.budgetBytes,
          total: snap.total,
          limit: snap.limit,
        });
        return true;
      }

      sendJson(res, 200, snap);
      return true;
    }

    const body = await readJsonBody(req);
    if (typeof body.texto !== "string" || body.texto.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'texto'." });
      return true;
    }
    const rawCat = body.categoria;
    const categoria: MemoriaInclusao =
      rawCat === "searchable" ? "searchable" : "essential";
    const escopoSite = typeof body.escopo_site === "string" ? body.escopo_site : null;
    const added = memMgr.addMemory(agenteId, body.texto.trim(), "manual", {
      categoria,
      escopoSite,
    });
    if (!added) {
      sendJson(res, 400, { erro: "Não foi possível registrar a memória." });
      return true;
    }
    sendJson(res, 201, {
      memoria_id: added.memoria_id,
      texto: added.texto,
      criado_em: added.criado_em,
      memoria: added,
      snapshot: memMgr.getMemoriesSnapshot(agenteId),
    });
    return true;
  }

  // Mensagens do Agente (GET / POST / DELETE / lidas / nao-lida)
  const agentReadMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens\/lidas$/);
  if (method === "POST" && agentReadMatch) {
    const agenteId = decodeURIComponent(agentReadMatch[1]);
    db.connection
      .prepare(`UPDATE projecao_conversas_chat SET lida = 1 WHERE canal_id = ?;`)
      .run(`agente:${agenteId}`);
    const row = db.connection
      .prepare(`SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { config_json?: string } | undefined;
    if (row?.config_json) {
      const cfg = safeJsonParse<Record<string, unknown>>(row.config_json, {});
      if (cfg.marked_unread === true) {
        cfg.marked_unread = false;
        db.connection
          .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`)
          .run(JSON.stringify(cfg), agenteId);
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  const agentUnreadMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens\/nao-lida$/);
  if (method === "POST" && agentUnreadMatch) {
    const agenteId = decodeURIComponent(agentUnreadMatch[1]);
    const row = db.connection
      .prepare(`SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { config_json?: string } | undefined;
    if (!row) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }
    const lastMsg = db.connection
      .prepare(
        `SELECT mensagem_id FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC LIMIT 1;`,
      )
      .get(`agente:${agenteId}`) as { mensagem_id?: string } | undefined;
    if (lastMsg?.mensagem_id) {
      db.connection
        .prepare(`UPDATE projecao_conversas_chat SET lida = 0 WHERE mensagem_id = ?;`)
        .run(lastMsg.mensagem_id);
    }
    const cfg = safeJsonParse<Record<string, unknown>>(row.config_json ?? "{}", {});
    cfg.marked_unread = true;
    db.connection
      .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`)
      .run(JSON.stringify(cfg), agenteId);
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, nao_lidas: 1 });
    return true;
  }

  const agentRoutineMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/rotinas\/([^/]+)\/mensagens$/);
  if (agentRoutineMsgMatch && method === "GET") {
    const rotinaId = decodeURIComponent(agentRoutineMsgMatch[2]);
    const canalId = `rotina:${rotinaId}`;
    const currentBrand = getBrandIdentity(providerConnection);
    const rows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 120;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db, currentBrand)) });
    return true;
  }

  const agentMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens$/);
  if (agentMsgMatch && method === "DELETE") {
    const agenteId = decodeURIComponent(agentMsgMatch[1]);
    const canalId = `agente:${agenteId}`;
    const delRes = db.connection
      .prepare(`DELETE FROM projecao_conversas_chat WHERE canal_id = ?;`)
      .run(canalId);
    const row = db.connection
      .prepare(`SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { config_json?: string } | undefined;
    if (row?.config_json) {
      const cfg = safeJsonParse<Record<string, unknown>>(row.config_json, {});
      if (cfg.marked_unread === true) {
        cfg.marked_unread = false;
        db.connection
          .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`)
          .run(JSON.stringify(cfg), agenteId);
      }
    }
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, removidas: Number(delRes.changes) });
    return true;
  }

  if (agentMsgMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMsgMatch[1]);
    const canalIdQuery = url.searchParams.get("canal_id");
    const canalId =
      method === "GET" && canalIdQuery && canalIdQuery.startsWith("rotina:")
        ? canalIdQuery
        : `agente:${agenteId}`;

    if (method === "GET") {
      const currentBrand = getBrandIdentity(providerConnection);
      const beforeCursor = url.searchParams.get("beforeCursor");
      const aroundMessageId = url.searchParams.get("aroundMessageId");
      const limitParam = url.searchParams.get("limit");
      if (
        deps.phase13?.pagination &&
        !canalIdQuery?.startsWith("rotina:") &&
        (beforeCursor || aroundMessageId || limitParam)
      ) {
        try {
          const limitNum = limitParam ? Number(limitParam) : 50;
          const mainThreadId = `main:${agenteId}`;
          const pagina = aroundMessageId
            ? deps.phase13.pagination.readAround({
                threadId: mainThreadId,
                agenteId,
                aroundMessageId,
                limit: Number.isFinite(limitNum) ? limitNum : 50,
              })
            : deps.phase13.pagination.readPage({
                threadId: mainThreadId,
                agenteId,
                beforeCursor,
                limit: Number.isFinite(limitNum) ? limitNum : 50,
              });
          sendJson(res, 200, {
            mensagens: pagina.mensagens.map((m) => applyBrandToMessage(m, currentBrand)),
            pagina: {
              ...pagina,
              mensagens: pagina.mensagens.map((m) => applyBrandToMessage(m, currentBrand)),
            },
          });
        } catch (err) {
          sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC, mensagem_id ASC LIMIT 120;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db, currentBrand)) });
      return true;
    }

    deps.uiBlockRegistry?.expirePendingBlocksForCanal(canalId, "skipped");

    const agente = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof generateAgentChatReply>[1] | undefined;

    if (!agente) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const body = await readJsonBody(req);
    const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
    const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
    if (!conteudo && anexos.length === 0) {
      sendJson(res, 400, { erro: "Envie 'conteudo' ou ao menos um anexo." });
      return true;
    }

    const mainThreadId = `main:${agenteId}`;
    const liveTurnId = `turn-${randomUUID().slice(0, 8)}`;
    const maxOrdUserRow = db.connection
      .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
      .get(mainThreadId) as { max_ord: number };
    const userOrdinal = maxOrdUserRow.max_ord + 1;

    const userMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: agenteId,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo || "Referências enviadas para produção.",
      anexos,
      steps: [],
      tarefa_id: null,
      thread_id: mainThreadId,
      turno_id: liveTurnId,
      item_type: "mensagem",
      status: "completed",
      resposta_para_mensagem_id:
        typeof body.resposta_para_mensagem_id === "string" ? body.resposta_para_mensagem_id : null,
      ordinal: userOrdinal,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const insertMsgStmt = db.connection.prepare(
      `INSERT INTO projecao_conversas_chat (
         mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
         anexos_json, steps_json, tarefa_id, lida, criado_em,
         thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
         ordinal, branch_origem_mensagem_id, metadados_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mensagem', 'completed', ?, ?, NULL, '{}');`
    );

    insertMsgStmt.run(
      userMsg.mensagem_id,
      userMsg.canal_id,
      userMsg.agente_id,
      userMsg.autor,
      userMsg.autor_nome ?? "Você",
      userMsg.conteudo_markdown,
      JSON.stringify(userMsg.anexos),
      "[]",
      null,
      1,
      userMsg.criado_em,
      mainThreadId,
      liveTurnId,
      userMsg.resposta_para_mensagem_id ?? null,
      userOrdinal,
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agenteId,
      mensagem: userMsg,
    });

    if (deps.phase13?.queueControls.isLaneBusy(agenteId, null)) {
      const entrega = deps.phase13.queueControls.enqueueMessage({
        mensagemId: userMsg.mensagem_id,
        agenteId,
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: userMsg.conteudo_markdown,
        anexos,
        respostaParaMensagemId: userMsg.resposta_para_mensagem_id,
        chaveIdempotencia:
          typeof body.client_message_id === "string" ? `chat-msg:${body.client_message_id}` : null,
        skipWake: true,
      });
      const snapshot = deps.phase13.queueControls.getLaneSnapshot(agenteId, null);
      if (snapshot.modo_ocupado === "steer" && snapshot.suporta_steer_nativo) {
        try {
          const steerRes = deps.phase13.queueControls.steerDelivery(agenteId, null, entrega.entrega_id);
          if (steerRes.mode === "steered") {
            sendJson(res, 202, {
              enfileirada: false,
              steered: true,
              entrega: steerRes.entrega,
              mensagem_usuario: userMsg,
            });
            return true;
          }
        } catch {
          // segue enfileirada na lane
        }
      }
      deps.phase13.onDrainLane(agenteId, null);
      sendJson(res, 202, {
        enfileirada: true,
        entrega,
        mensagem_usuario: userMsg,
      });
      return true;
    }

    const abortController = deps.phase13
      ? deps.phase13.tasksService.registerTurnAbort(mainThreadId, liveTurnId)
      : new AbortController();
    if (deps.phase13) {
      deps.phase13.queueControls.registerActiveTurn({
        agenteId,
        threadId: null,
        turnoId: liveTurnId,
        deliveries: [
          {
            entrega_id: `direct-${liveTurnId}`,
            mensagem_id: userMsg.mensagem_id,
            agente_id: agenteId,
            thread_id: null,
            remetente_tipo: "usuario",
            conteudo_markdown: userMsg.conteudo_markdown,
            anexos,
            resposta_para_mensagem_id: userMsg.resposta_para_mensagem_id ?? null,
            status: "executando",
            posicao: 0,
            turno_id: liveTurnId,
            erro: null,
            editando: false,
            espera_resposta: true,
            criado_em: userMsg.criado_em,
          },
        ],
        abortController,
      });
    }

    let agentMsg: MensagemChat;
    try {
      const turnOut = await executeAgentConversationTurn({
        deps,
        agente,
        userPrompt: userMsg.conteudo_markdown,
        anexos,
        threadId: mainThreadId,
        turnoId: liveTurnId,
        signal: abortController.signal,
        entregaOrigemId: userMsg.mensagem_id,
        respostaParaMensagemId: userMsg.mensagem_id,
      });
      agentMsg = turnOut.agentMsg;
    } finally {
      if (deps.phase13) {
        deps.phase13.queueControls.clearActiveTurn(agenteId, null, liveTurnId);
        deps.phase13.tasksService.clearTurnAbort(mainThreadId, liveTurnId);
        deps.phase13.onDrainLane(agenteId, null);
      }
    }

    const historyRows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC LIMIT 20;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    const history = historyRows.map((r) => mapChatRow(r, db));

    // Handoff 1:1 somente quando não for saudação/dúvida:
    // - do usuário: aceita @agente_id ou [HANDOFF:agente_id]
    // - da resposta do agente: exige [HANDOFF:agente_id] explícito (nunca @mencao em explicação)
    const isSimpleGreeting = isGreetingOrCapabilityQuestion(userMsg.conteudo_markdown);
    const handoffTargets = isSimpleGreeting
      ? []
      : Array.from(
          new Set([
            ...extractMentionedAgentIds(userMsg.conteudo_markdown, agenteId, db),
            ...extractExplicitAgentHandoffTags(agentMsg.conteudo_markdown, agenteId, db),
          ])
        ).slice(0, 2);
    const mensagensHandoff: MensagemChat[] = [];

    if (handoffTargets.length > 0) {
      const handoffBus = new HandoffBus(db, deps.queue);
      let chainHistory = [...history, agentMsg];
      for (let hIdx = 0; hIdx < handoffTargets.length; hIdx += 1) {
        const targetId = handoffTargets[hIdx];
        const targetAg = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(targetId) as Parameters<typeof generateAgentChatReply>[1] | undefined;
        if (!targetAg) continue;

        handoffBus.dispatchHandoff({
          tarefa_id: agentMsg.tarefa_id ?? null,
          de_agente_id: agenteId,
          para_agente_id: targetId,
          instrucao: `Handoff de ${agente.nome}: ${userMsg.conteudo_markdown}`,
          artefatos: agentMsg.anexos.map((a) => a.caminho_relativo),
          enfileirarNovaTarefa: false,
        });

        const hReply = await generateAgentChatReply(
          deps,
          targetAg,
          `[Handoff recebido de ${agente.nome} (@${agenteId})]\nSolicitação original: ${userMsg.conteudo_markdown}\nEntrega do colega anterior:\n${agentMsg.conteudo_markdown}`,
          anexos,
          chainHistory,
          (prog) => {
            wsHub.broadcast("chat:progress", {
              canal_id: canalId,
              agente_id: targetId,
              turno_id: `${liveTurnId}-h${hIdx}`,
              ...prog,
            });
          },
          {
            isHandoff: true,
            originalUserPrompt: userMsg.conteudo_markdown,
          }
        );

        const hMsg: MensagemChat = {
          mensagem_id: `msg-${randomUUID()}`,
          canal_id: canalId,
          agente_id: targetId,
          autor: "agente",
          autor_nome: targetAg.nome,
          conteudo_markdown: hReply.markdown,
          anexos: hReply.anexosGerados,
          steps: [
            {
              id: `step-${randomUUID().slice(0, 8)}`,
              ferramenta: "handoff_agente",
              titulo: `Recebeu o bastão de ${agente.nome}`,
              status: "concluido",
              duracao_ms: 20,
            },
            ...hReply.steps,
          ],
          tarefa_id: hReply.tarefaCriadaId,
          thread_id: mainThreadId,
          turno_id: liveTurnId,
          item_type: "mensagem",
          status: "completed",
          resposta_para_mensagem_id: agentMsg.mensagem_id,
          ordinal: userOrdinal + 2 + hIdx,
          lida: true,
          criado_em: new Date(Date.now() + 10 + hIdx * 10).toISOString(),
        };

        insertMsgStmt.run(
          hMsg.mensagem_id,
          canalId,
          targetId,
          "agente",
          targetAg.nome,
          hMsg.conteudo_markdown,
          JSON.stringify(hMsg.anexos),
          JSON.stringify(hMsg.steps),
          hMsg.tarefa_id ?? null,
          1,
          hMsg.criado_em,
          mainThreadId,
          liveTurnId,
          agentMsg.mensagem_id,
          userOrdinal + 2 + hIdx,
        );
        wsHub.broadcast("chat:message", {
          canal_id: canalId,
          agente_id: targetId,
          mensagem: hMsg,
        });
        mensagensHandoff.push(hMsg);
        chainHistory = [...chainHistory, hMsg];
      }
    }

    sendJson(res, 201, {
      mensagem_usuario: userMsg,
      mensagem_agente: agentMsg,
      mensagens_handoff: mensagensHandoff,
    });
    return true;
  }

  // 4. Canais em Equipe
  if (method === "GET" && path === "/api/canais") {
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_grupos_equipe ORDER BY atualizado_em DESC;`)
      .all() as Array<{
      canal_id: string;
      nome: string;
      descricao: string | null;
      pasta: string;
      membros_agentes_json: string;
      criado_em: string;
      atualizado_em: string;
    }>;

    const canais: CanalEquipe[] = rows.map((row) => {
      const unreadRow = db.connection
        .prepare(
          `SELECT COUNT(*) as total FROM projecao_conversas_chat WHERE canal_id = ? AND lida = 0;`
        )
        .get(row.canal_id) as { total: number };
      const lastRow = db.connection
        .prepare(
          `SELECT conteudo_markdown FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC LIMIT 1;`
        )
        .get(row.canal_id) as { conteudo_markdown: string } | undefined;

      return {
        canal_id: row.canal_id,
        nome: row.nome,
        descricao: row.descricao ?? "",
        pasta: row.pasta,
        membros_agentes: safeJsonParse<string[]>(row.membros_agentes_json, []),
        nao_lidas: Number(unreadRow?.total ?? 0),
        ultima_mensagem: lastRow ? lastRow.conteudo_markdown.slice(0, 90) : row.descricao,
        criado_em: row.criado_em,
        atualizado_em: row.atualizado_em,
      };
    });

    sendJson(res, 200, { canais });
    return true;
  }

  if (method === "POST" && path === "/api/canais") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'nome'." });
      return true;
    }
    const rawName = body.nome.trim();
    const formattedName = rawName.startsWith("#") ? rawName : `#${rawName}`;
    const membros = Array.isArray(body.membros_agentes)
      ? body.membros_agentes.filter((m): m is string => typeof m === "string")
      : ["estrategista", "copywriter", "designer_carrossel"];

    const canalId = `canal-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_grupos_equipe (canal_id, nome, descricao, pasta, membros_agentes_json, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        canalId,
        formattedName,
        typeof body.descricao === "string" ? body.descricao : "Canal colaborativo de agentes",
        typeof body.pasta === "string" ? body.pasta : "Canais em Equipe",
        JSON.stringify(membros),
        agora,
        agora
      );

    sendJson(res, 201, {
      canal: {
        canal_id: canalId,
        nome: formattedName,
        descricao: typeof body.descricao === "string" ? body.descricao : "Canal colaborativo de agentes",
        pasta: typeof body.pasta === "string" ? body.pasta : "Canais em Equipe",
        membros_agentes: membros,
        nao_lidas: 0,
        ultima_mensagem: null,
        criado_em: agora,
        atualizado_em: agora,
      },
    });
    return true;
  }

  const canalMsgMatch = path.match(/^\/api\/canais\/([^/]+)\/mensagens$/);
  if (canalMsgMatch && method === "DELETE") {
    const canalId = decodeURIComponent(canalMsgMatch[1]);
    const delRes = db.connection
      .prepare(`DELETE FROM projecao_conversas_chat WHERE canal_id = ?;`)
      .run(canalId);
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, removidas: Number(delRes.changes) });
    return true;
  }

  if (canalMsgMatch && (method === "GET" || method === "POST")) {
    const canalId = decodeURIComponent(canalMsgMatch[1]);
    if (method === "GET") {
      const currentBrand = getBrandIdentity(providerConnection);
      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 150;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db, currentBrand)) });
      return true;
    }

    const canal = db.connection
      .prepare(`SELECT * FROM projecao_grupos_equipe WHERE canal_id = ?;`)
      .get(canalId) as { canal_id: string; nome: string; membros_agentes_json: string } | undefined;
    if (!canal) {
      sendJson(res, 404, { erro: `Canal '${canalId}' não encontrado.` });
      return true;
    }

    const body = await readJsonBody(req);
    const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
    const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
    if (!conteudo && anexos.length === 0) {
      sendJson(res, 400, { erro: "Envie 'conteudo' para o canal." });
      return true;
    }

    const userMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: null,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo,
      anexos,
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const insertStmt = db.connection.prepare(
      `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    );

    insertStmt.run(
      userMsg.mensagem_id,
      userMsg.canal_id,
      null,
      "usuario",
      "Você",
      userMsg.conteudo_markdown,
      JSON.stringify(anexos),
      "[]",
      null,
      1,
      userMsg.criado_em
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: null,
      mensagem: userMsg,
    });

    const membrosConfig = safeJsonParse<string[]>(canal.membros_agentes_json, ["estrategista"]);
    const mencionados = extractMentionedAgentIds(userMsg.conteudo_markdown, undefined, db);
    const membrosAtivos =
      mencionados.length > 0
        ? Array.from(new Set([...mencionados, ...membrosConfig.filter((m) => mencionados.includes(m))]))
        : membrosConfig.slice(0, 4);

    // Carrega histórico recente real do canal em ordem cronológica
    const prevRowsDesc = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? AND mensagem_id != ? ORDER BY criado_em DESC LIMIT 16;`
      )
      .all(canalId, userMsg.mensagem_id) as Array<Parameters<typeof mapChatRow>[0]>;
    const runningHistory: MensagemChat[] = [
      ...prevRowsDesc.reverse().map((r) => mapChatRow(r, db)),
      userMsg,
    ];

    const respostas: MensagemChat[] = [];
    const liveTurnId = `turn-${randomUUID().slice(0, 8)}`;
    const handoffBus = new HandoffBus(db, deps.queue);

    for (let idx = 0; idx < membrosAtivos.length; idx += 1) {
      const mId = membrosAtivos[idx];
      const ag = db.connection
        .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
        .get(mId) as Parameters<typeof generateAgentChatReply>[1] | undefined;
      if (!ag) continue;

      const colegasAnteriores = respostas
        .map((r) => `### Contribuição anterior de ${r.autor_nome ?? r.agente_id} (@${r.agente_id}):\n${r.conteudo_markdown}`)
        .join("\n\n");

      const promptCanal =
        idx === 0 || !colegasAnteriores
          ? `[Canal ${canal.nome}] Pedido do usuário: ${userMsg.conteudo_markdown}\n(Sua equipe neste canal: ${membrosAtivos.map((id) => `@${id}`).join(", ")}. Entregue a parte da sua especialidade para o próximo colega continuar.)`
          : `[Canal ${canal.nome}] Pedido original: ${userMsg.conteudo_markdown}\n\n${colegasAnteriores}\n\nAgora é a sua vez (${ag.nome} / @${ag.agente_id}). Leia o que seus colegas produziram acima e execute a sua etapa especializada complementando e avançando a produção sem repetir o que já foi feito.`;

      if (idx > 0 && respostas[idx - 1]?.agente_id) {
        handoffBus.dispatchHandoff({
          tarefa_id: respostas[idx - 1].tarefa_id ?? null,
          de_agente_id: respostas[idx - 1].agente_id!,
          para_agente_id: ag.agente_id,
          instrucao: `Passagem de bastão no canal ${canal.nome}`,
          artefatos: respostas[idx - 1].anexos.map((a) => a.caminho_relativo),
          enfileirarNovaTarefa: false,
        });
      }

      const reply = await generateAgentChatReply(
        deps,
        ag,
        promptCanal,
        anexos,
        runningHistory,
        (prog) => {
          wsHub.broadcast("chat:progress", {
            canal_id: canalId,
            agente_id: ag.agente_id,
            turno_id: liveTurnId,
            ...prog,
          });
        },
        {
          isHandoff: idx > 0,
          originalUserPrompt: userMsg.conteudo_markdown,
        }
      );

      const agentMsg: MensagemChat = {
        mensagem_id: `msg-${randomUUID()}`,
        canal_id: canalId,
        agente_id: ag.agente_id,
        autor: "agente",
        autor_nome: ag.nome,
        conteudo_markdown: reply.markdown,
        anexos: reply.anexosGerados,
        steps:
          idx > 0 && respostas[idx - 1]
            ? [
                {
                  id: `step-${randomUUID().slice(0, 8)}`,
                  ferramenta: "handoff_agente",
                  titulo: `Recebeu contexto de ${respostas[idx - 1].autor_nome ?? respostas[idx - 1].agente_id}`,
                  status: "concluido",
                  duracao_ms: 18,
                },
                ...reply.steps,
              ]
            : reply.steps,
        tarefa_id: reply.tarefaCriadaId,
        lida: true,
        criado_em: new Date(Date.now() + 5 + idx * 5).toISOString(),
      };

      insertStmt.run(
        agentMsg.mensagem_id,
        canalId,
        ag.agente_id,
        "agente",
        ag.nome,
        agentMsg.conteudo_markdown,
        JSON.stringify(agentMsg.anexos),
        JSON.stringify(agentMsg.steps),
        agentMsg.tarefa_id ?? null,
        1,
        agentMsg.criado_em
      );
      wsHub.broadcast("chat:message", {
        canal_id: canalId,
        agente_id: ag.agente_id,
        mensagem: agentMsg,
      });
      respostas.push(agentMsg);
      runningHistory.push(agentMsg);
    }

    db.connection
      .prepare(`UPDATE projecao_grupos_equipe SET atualizado_em = ? WHERE canal_id = ?;`)
      .run(new Date().toISOString(), canalId);

    sendJson(res, 201, { mensagem_usuario: userMsg, mensagens_equipe: respostas });
    return true;
  }

  // 5. Fluxos de Trabalho Visuais & Motor em Grafo (Fase 12)
  const wfWebhookMatch = path.match(/^\/api\/workflows\/webhook\/([^/]+)$/);
  if (method === "POST" && wfWebhookMatch) {
    const routeId = decodeURIComponent(wfWebhookMatch[1]);
    if (!deps.workflowTriggers) {
      sendJson(res, 503, { erro: "WorkflowTriggers não inicializado neste daemon." });
      return true;
    }
    const rawBody = deps.readRawBody
      ? await deps.readRawBody(req)
      : await readRawBodyFallback(req);
    const sigHeader =
      (typeof req.headers["x-criativo-signature"] === "string"
        ? req.headers["x-criativo-signature"]
        : undefined) ??
      (typeof req.headers["x-hub-signature-256"] === "string"
        ? req.headers["x-hub-signature-256"]
        : undefined);
    const deliveryIdHeader =
      (typeof req.headers["x-delivery-id"] === "string"
        ? req.headers["x-delivery-id"]
        : undefined) ??
      (typeof req.headers["x-request-id"] === "string"
        ? req.headers["x-request-id"]
        : undefined);

    const result = await deps.workflowTriggers.handleWebhookRequest({
      routeId,
      rawBody,
      signatureHeader: sigHeader,
      deliveryIdHeader,
    });
    sendJson(res, result.httpStatus, result.body);
    return true;
  }

  if (method === "POST" && path === "/api/workflows/conector-evento") {
    if (!deps.workflowTriggers) {
      sendJson(res, 503, { erro: "WorkflowTriggers não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const conectorId = typeof body.conector_id === "string" ? body.conector_id : "";
    const evento = typeof body.evento === "string" ? body.evento : "";
    if (!conectorId || !evento) {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'conector_id' e 'evento'." });
      return true;
    }
    const triggeredRuns = await deps.workflowTriggers.receiveConnectorTrigger({
      conectorId,
      evento,
      dados: body.dados ?? {},
      eventId: typeof body.event_id === "string" ? body.event_id : undefined,
    });
    sendJson(res, 202, { ok: true, triggered_runs: triggeredRuns });
    return true;
  }

  if (method === "POST" && path === "/api/mensageria/telegram/webhook") {
    const expectedSecret =
      deps.vault?.getSecret("TELEGRAM_WEBHOOK_SECRET") ??
      deps.vault?.getSecret("telegram_webhook_secret");
    if (expectedSecret) {
      const provided =
        typeof req.headers["x-telegram-bot-api-secret-token"] === "string"
          ? req.headers["x-telegram-bot-api-secret-token"]
          : "";
      const a = Buffer.from(provided, "utf8");
      const b = Buffer.from(expectedSecret, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        sendJson(res, 401, { erro: "Secret token Telegram inválido." });
        return true;
      }
    }

    const body = await readJsonBody(req);
    if (body.callback_query && typeof body.callback_query === "object") {
      const cq = body.callback_query as { id?: unknown; data?: unknown };
      if (typeof cq.id === "string") {
        await deps.telegramBot?.handleCallbackQuery({
          id: cq.id,
          data: typeof cq.data === "string" ? cq.data : undefined,
        });
      }
    }
    if (body.message && typeof body.message === "object") {
      const msg = body.message as {
        message_id?: unknown;
        text?: unknown;
        chat?: { id?: unknown; username?: unknown };
        from?: { username?: unknown };
      };
      if (msg.chat?.id !== undefined && typeof msg.text === "string") {
        await deps.workflowTriggers?.receiveTelegramTrigger({
          chatId: String(msg.chat.id),
          username:
            typeof msg.from?.username === "string"
              ? msg.from.username
              : typeof msg.chat.username === "string"
                ? msg.chat.username
                : undefined,
          text: msg.text,
          messageId: String(msg.message_id ?? randomUUID()),
        });
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  const wfRunDetailMatch = path.match(/^\/api\/workflows\/execucoes\/([^/]+)$/);
  if (method === "GET" && wfRunDetailMatch) {
    const runId = decodeURIComponent(wfRunDetailMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    const execucao = store.getRunDetail(runId);
    if (!execucao) {
      sendJson(res, 404, { erro: `Execução '${runId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { execucao });
    return true;
  }

  const wfRunStopMatch = path.match(/^\/api\/workflows\/execucoes\/([^/]+)\/parar$/);
  if (method === "POST" && wfRunStopMatch) {
    const runId = decodeURIComponent(wfRunStopMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const execucao = await deps.workflowEngine.stopRun(runId);
    if (!execucao) {
      sendJson(res, 404, { erro: `Execução '${runId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { ok: true, execucao });
    return true;
  }

  const wfStepDecideMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/decidir$/);
  if (method === "POST" && wfStepDecideMatch) {
    const stepId = decodeURIComponent(wfStepDecideMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    if (typeof body.approved !== "boolean") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'approved' (boolean)." });
      return true;
    }
    try {
      await deps.workflowEngine.decideStep(stepId, body.approved, "web");
      sendJson(res, 200, { ok: true, step_id: stepId, approved: body.approved });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfStepRetryMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/retentar$/);
  if (method === "POST" && wfStepRetryMatch) {
    const stepId = decodeURIComponent(wfStepRetryMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    try {
      const resultado = await deps.workflowEngine.retryStep(stepId);
      sendJson(res, 200, { ok: true, resultado });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfStepStopMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/parar$/);
  if (method === "POST" && wfStepStopMatch) {
    const stepId = decodeURIComponent(wfStepStopMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    await deps.workflowEngine.stopStep(stepId);
    sendJson(res, 200, { ok: true, step_id: stepId });
    return true;
  }

  if (method === "GET" && path === "/api/workflows") {
    const { store } = resolveWorkflowRuntime(deps);
    sendJson(res, 200, { workflows: store.listWorkflows() });
    return true;
  }

  if (method === "POST" && path === "/api/workflows") {
    const body = await readJsonBody(req);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const detail = store.createWorkflow({
        workflow_id: typeof body.workflow_id === "string" ? body.workflow_id : undefined,
        nome: typeof body.nome === "string" ? body.nome : undefined,
        descricao: typeof body.descricao === "string" ? body.descricao : undefined,
        nos: Array.isArray(body.nos) ? (body.nos as WorkflowNo[]) : [],
        arestas: Array.isArray(body.arestas) ? (body.arestas as WorkflowAresta[]) : [],
        tracos: Array.isArray(body.tracos) ? (body.tracos as WorkflowTraco[]) : [],
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
      });
      wsHub.broadcast("workflow:updated", {
        workflow_id: detail.workflow.workflow_id,
        revisao_grafo: detail.workflow.revisao_grafo ?? 0,
        acao: "created",
      });
      sendJson(res, 201, { workflow: detail.workflow, detail });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfVersionsMatch = path.match(/^\/api\/workflows\/([^/]+)\/versoes$/);
  if (method === "GET" && wfVersionsMatch) {
    const wfId = decodeURIComponent(wfVersionsMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    sendJson(res, 200, { versoes: store.listVersions(wfId) });
    return true;
  }

  const wfVersionRestoreMatch = path.match(
    /^\/api\/workflows\/([^/]+)\/versoes\/([^/]+)\/restaurar$/
  );
  if (method === "POST" && wfVersionRestoreMatch) {
    const wfId = decodeURIComponent(wfVersionRestoreMatch[1]);
    const versionId = decodeURIComponent(wfVersionRestoreMatch[2]);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const detail = store.restoreVersion(wfId, versionId);
      if (!detail) {
        sendJson(res, 404, { erro: "Workflow ou versão não encontrados." });
        return true;
      }
      wsHub.broadcast("workflow:updated", {
        workflow_id: detail.workflow.workflow_id,
        revisao_grafo: detail.workflow.revisao_grafo ?? 0,
        acao: "restored",
      });
      sendJson(res, 200, { workflow: detail.workflow, detail });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfVersionGetMatch = path.match(/^\/api\/workflows\/([^/]+)\/versoes\/([^/]+)$/);
  if (method === "GET" && wfVersionGetMatch) {
    const wfId = decodeURIComponent(wfVersionGetMatch[1]);
    const versionId = decodeURIComponent(wfVersionGetMatch[2]);
    const { store } = resolveWorkflowRuntime(deps);
    const versao = store.getVersion(wfId, versionId);
    if (!versao) {
      sendJson(res, 404, { erro: `Versão '${versionId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { versao });
    return true;
  }

  const wfExecMatch = path.match(/^\/api\/workflows\/([^/]+)\/executar$/);
  if (method === "POST" && wfExecMatch) {
    const wfId = decodeURIComponent(wfExecMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const execucao = await deps.workflowEngine.startRun({
        workflowId: wfId,
        origem: "manual",
        fromNodeId: typeof body.from_node_id === "string" ? body.from_node_id : undefined,
        triggerNodeId:
          typeof body.trigger_node_id === "string" ? body.trigger_node_id : undefined,
        payload: body.payload,
        requestId: typeof body.request_id === "string" ? body.request_id : undefined,
      });
      const tarefasCriadas = execucao.steps
        .map((s) => s.tarefa_id)
        .filter((id): id is string => Boolean(id));
      sendJson(res, 200, {
        ok: true,
        execucao,
        workflow_id: wfId,
        run_id: execucao.run.run_id,
        numero: execucao.run.numero,
        status: execucao.run.status,
        tarefas_criadas: tarefasCriadas,
      });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfNodeRunMatch = path.match(/^\/api\/workflows\/([^/]+)\/nos\/([^/]+)\/executar$/);
  if (method === "POST" && wfNodeRunMatch) {
    const wfId = decodeURIComponent(wfNodeRunMatch[1]);
    const nodeId = decodeURIComponent(wfNodeRunMatch[2]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const step = await deps.workflowEngine.runStep({
        workflowId: wfId,
        nodeId,
        requestId: typeof body.request_id === "string" ? body.request_id : undefined,
        payload: body.payload,
      });
      sendJson(res, 200, { ok: true, step });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfRunsListMatch = path.match(/^\/api\/workflows\/([^/]+)\/execucoes$/);
  if (method === "GET" && wfRunsListMatch) {
    const wfId = decodeURIComponent(wfRunsListMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;
    const rawBefore = url.searchParams.get("before");
    const offset = rawBefore ? Math.max(0, Number.parseInt(rawBefore, 10) || 0) : 0;
    const runs = store.listRunsPaginated(wfId, limit, offset);
    const execucoes = runs
      .map((r) => store.getRunDetail(r.run_id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    const soloSteps = store.listSoloSteps(wfId, 50);
    sendJson(res, 200, { execucoes, solo_steps: soloSteps });
    return true;
  }

  const wfRotateWebhookMatch = path.match(
    /^\/api\/workflows\/([^/]+)\/gatilhos\/([^/]+)\/rotacionar-webhook$/
  );
  if (method === "POST" && wfRotateWebhookMatch) {
    const wfId = decodeURIComponent(wfRotateWebhookMatch[1]);
    const nodeId = decodeURIComponent(wfRotateWebhookMatch[2]);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const rotated = store.rotateWebhookSecret(wfId, nodeId);
      sendJson(res, 200, {
        ok: true,
        route_id: rotated.routeId,
        webhook_url: rotated.webhookUrl,
        secret: rotated.secret,
      });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
  if (wfMatch && (method === "GET" || method === "PUT" || method === "DELETE")) {
    const wfId = decodeURIComponent(wfMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);

    if (method === "GET") {
      const detail = store.getWorkflowDetail(wfId);
      if (!detail) {
        sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }

    if (method === "DELETE") {
      if (deps.workflowEngine) {
        const activeRuns = store
          .listRunsPaginated(wfId, 50, 0)
          .filter(
            (r) => r.status === "running" || r.status === "approval" || r.status === "stopping"
          );
        for (const r of activeRuns) {
          await deps.workflowEngine.stopRun(r.run_id);
        }
      }
      const deleted = store.deleteWorkflow(wfId);
      if (!deleted) {
        sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
        return true;
      }
      wsHub.broadcast("workflow:updated", {
        workflow_id: wfId,
        revisao_grafo: 0,
        acao: "deleted",
      });
      sendJson(res, 200, { ok: true, workflow_id: wfId });
      return true;
    }

    const body = await readJsonBody(req);
    try {
      const saved = store.saveWorkflow(wfId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        descricao: typeof body.descricao === "string" ? body.descricao : undefined,
        nos: Array.isArray(body.nos) ? (body.nos as WorkflowNo[]) : undefined,
        arestas: Array.isArray(body.arestas) ? (body.arestas as WorkflowAresta[]) : undefined,
        tracos: Array.isArray(body.tracos) ? (body.tracos as WorkflowTraco[]) : undefined,
        ativo: typeof body.ativo === "boolean" ? body.ativo : undefined,
        base_revision:
          typeof body.base_revision === "number" ? body.base_revision : undefined,
      });

      if (!saved) {
        sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
        return true;
      }

      if (!saved.ok) {
        sendJson(res, 409, {
          ok: false,
          erro: "O fluxo foi atualizado em outra sessão ou por um agente.",
          conflict: saved.conflict,
        });
        return true;
      }

      wsHub.broadcast("workflow:updated", {
        workflow_id: saved.detail.workflow.workflow_id,
        revisao_grafo: saved.detail.workflow.revisao_grafo ?? 0,
        acao: "saved",
      });
      sendJson(res, 200, { workflow: saved.detail.workflow, detail: saved.detail });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  // 6. Arquivos, Uploads (ImagePaths) & Leitura Segura
  if (method === "GET" && path === "/api/arquivos") {
    syncWorkspaceFilesToDatabase(db, workspaceRoot);
    const tipo = url.searchParams.get("tipo");
    const rows = tipo
      ? (db.connection
          .prepare(`SELECT * FROM projecao_arquivos WHERE tipo_uso = ? ORDER BY criado_em DESC LIMIT 100;`)
          .all(tipo) as Array<{
          arquivo_id: string;
          nome_original: string;
          caminho_relativo: string;
          mime_type: string;
          tamanho_bytes: number;
          tipo_uso: ArquivoStudio["tipo_uso"];
          agente_id: string | null;
          tarefa_id: string | null;
          criado_em: string;
        }>)
      : (db.connection
          .prepare(`SELECT * FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 100;`)
          .all() as Array<{
          arquivo_id: string;
          nome_original: string;
          caminho_relativo: string;
          mime_type: string;
          tamanho_bytes: number;
          tipo_uso: ArquivoStudio["tipo_uso"];
          agente_id: string | null;
          tarefa_id: string | null;
          criado_em: string;
        }>);

    const arquivos: ArquivoStudio[] = rows.map((row) => ({
      ...row,
      url: `/api/arquivos/raw?path=${encodeURIComponent(row.caminho_relativo)}`,
    }));

    sendJson(res, 200, { arquivos });
    return true;
  }

  if (method === "POST" && path === "/api/arquivos/upload") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || typeof body.conteudo_base64 !== "string") {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'nome' e 'conteudo_base64'." });
      return true;
    }

    const base64Clean = body.conteudo_base64.replace(/^data:[^;]+;base64,/, "").trim();
    const buffer = Buffer.from(base64Clean, "base64");
    if (buffer.length === 0) {
      sendJson(res, 400, { erro: "Conteúdo base64 vazio ou inválido." });
      return true;
    }
    if (buffer.length > 15 * 1024 * 1024) {
      sendJson(res, 413, { erro: "Arquivo excede o limite de 15 MB por upload." });
      return true;
    }

    const cleanName = sanitizeFileName(body.nome);
    const arquivoId = `arq-${randomUUID().slice(0, 8)}`;
    const storedName = `${arquivoId}-${cleanName}`;
    const mimeType =
      typeof body.mime_type === "string" && body.mime_type.length > 0
        ? body.mime_type
        : RAW_MIME_MAP[extname(cleanName).toLowerCase()] ?? "application/octet-stream";
    const rawCategoria =
      (typeof body.categoria === "string" ? body.categoria : null) ??
      url.searchParams.get("categoria") ??
      (typeof body.tipo_uso === "string" ? body.tipo_uso : "");
    const categoria = rawCategoria.trim().toLowerCase();
    const mappedRequestedTipoUso =
      categoria === "foto"
        ? "personagem"
        : categoria === "ficha_pdf"
          ? "documento"
          : typeof body.tipo_uso === "string"
            ? body.tipo_uso
            : undefined;
    const tipoUso = inferTipoUso(mimeType, mappedRequestedTipoUso);

    const relFolder =
      categoria === "ficha_pdf" || categoria === "ficha"
        ? "conteudos/ficha"
        : categoria === "foto" || categoria === "fotos"
          ? "recursos/fotos"
          : categoria === "logo" || categoria === "logos"
            ? "recursos/logos"
            : categoria === "personagem" || categoria === "personagens"
              ? "recursos/personagens"
              : categoria === "referencia" || categoria === "referencias"
                ? "recursos/referencias"
                : tipoUso === "logo"
                  ? "recursos/logos"
                  : tipoUso === "personagem"
                    ? "recursos/personagens"
                    : tipoUso === "referencia"
                      ? "recursos/referencias"
                      : "recursos/uploads";
    const targetDir = resolve(workspaceRoot, relFolder);
    mkdirSync(targetDir, { recursive: true });

    const targetPath = resolve(targetDir, storedName);
    writeFileSync(targetPath, buffer);

    const relPath = `${relFolder}/${storedName}`;
    const agenteId = typeof body.agente_id === "string" ? body.agente_id : null;
    const tarefaId = typeof body.tarefa_id === "string" ? body.tarefa_id : null;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        arquivoId,
        body.nome.slice(0, 140),
        relPath,
        mimeType,
        buffer.length,
        tipoUso,
        agenteId,
        tarefaId,
        agora
      );

    let brandExtraction: Awaited<ReturnType<typeof importBrandPdfFromBuffer>> | undefined;
    if (categoria === "ficha_pdf" || (mimeType === "application/pdf" && relFolder === "conteudos/ficha")) {
      brandExtraction = await importBrandPdfFromBuffer(
        providerConnection,
        workspaceRoot,
        buffer,
        db
      ).catch(() => undefined);
    }

    const syncedSetup = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);

    const arquivo: ArquivoStudio = {
      arquivo_id: arquivoId,
      nome_original: body.nome.slice(0, 140),
      caminho_relativo: relPath,
      url: `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`,
      mime_type: mimeType,
      tamanho_bytes: buffer.length,
      tipo_uso: tipoUso,
      agente_id: agenteId,
      tarefa_id: tarefaId,
      criado_em: agora,
    };

    sendJson(res, 201, {
      arquivo,
      ...(brandExtraction ? { brandExtraction } : {}),
      onboarding: syncedSetup.onboarding,
    });
    return true;
  }

  const deleteArquivoMatch = path.match(/^\/api\/arquivos\/([^/]+)$/);
  if (
    method === "DELETE" &&
    deleteArquivoMatch &&
    deleteArquivoMatch[1] !== "raw" &&
    deleteArquivoMatch[1] !== "upload"
  ) {
    const arquivoId = decodeURIComponent(deleteArquivoMatch[1]);
    const row = db.connection
      .prepare(`SELECT arquivo_id, caminho_relativo FROM projecao_arquivos WHERE arquivo_id = ? LIMIT 1;`)
      .get(arquivoId) as { arquivo_id: string; caminho_relativo: string } | undefined;

    if (!row) {
      sendJson(res, 404, { erro: "Arquivo não encontrado." });
      return true;
    }

    const relClean = row.caminho_relativo.replaceAll("\\", "/");
    if (
      !relClean ||
      relClean.includes("..") ||
      relClean.startsWith("/") ||
      relClean.startsWith("\\")
    ) {
      sendJson(res, 403, { erro: "Caminho não permitido para exclusão." });
      return true;
    }

    const deleteRoots = [
      resolve(workspaceRoot, "recursos"),
      resolve(workspaceRoot, "saidas"),
    ];
    const resolvedTarget = resolve(workspaceRoot, relClean);
    const isDeleteAllowed = deleteRoots.some((root) => {
      const rel = relative(root, resolvedTarget);
      return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
    });

    if (!isDeleteAllowed) {
      sendJson(res, 403, { erro: "Exclusão permitida apenas dentro de recursos/ ou saidas/." });
      return true;
    }

    try {
      if (existsSync(resolvedTarget)) {
        unlinkSync(resolvedTarget);
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "ENOENT") {
        sendJson(res, 500, { erro: err instanceof Error ? err.message : "Erro ao remover arquivo físico." });
        return true;
      }
    }

    db.connection
      .prepare(`DELETE FROM projecao_arquivos WHERE arquivo_id = ?;`)
      .run(row.arquivo_id);

    sendJson(res, 200, {
      ok: true,
      arquivo_id: row.arquivo_id,
      caminho_relativo: row.caminho_relativo,
    });
    return true;
  }

  if (method === "GET" && (path === "/api/arquivos/raw" || path.startsWith("/api/arquivos/raw/"))) {
    const requestedRel = path.startsWith("/api/arquivos/raw/")
      ? decodeURIComponent(path.slice("/api/arquivos/raw/".length))
      : (url.searchParams.get("path") ?? "");
    if (!requestedRel || requestedRel.includes("..") || requestedRel.startsWith("/") || requestedRel.startsWith("\\")) {
      sendJson(res, 403, { erro: "Caminho não permitido." });
      return true;
    }

    const allowedRoots = [
      resolve(workspaceRoot, "recursos"),
      resolve(workspaceRoot, "conteudos"),
      resolve(workspaceRoot, "saidas"),
      resolve(workspaceRoot, "previas"),
    ];
    const resolvedTarget = resolve(workspaceRoot, requestedRel);
    const isAllowed = allowedRoots.some((root) => {
      const rel = relative(root, resolvedTarget);
      return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
    });

    if (!isAllowed) {
      sendJson(res, 403, { erro: "Acesso negado fora dos diretórios de mídia permitidos." });
      return true;
    }

    if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
      sendJson(res, 404, { erro: "Arquivo não encontrado." });
      return true;
    }

    const mime = RAW_MIME_MAP[extname(resolvedTarget).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, max-age=300",
    });
    res.end(readFileSync(resolvedTarget));
    return true;
  }

  // =========================================================================
  // 7. Fase 14 — Shared Tables, Biblioteca Hierárquica, UI Blocks, SSE & Cofre
  // =========================================================================

  // 7.1 Shared Tables (/api/tabelas-compartilhadas)
  if (method === "GET" && path === "/api/tabelas-compartilhadas") {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const tables = await deps.sharedTables.listTablesForCockpit();
    sendJson(res, 200, { tables });
    return true;
  }

  if (method === "POST" && path === "/api/tabelas-compartilhadas/query") {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const sql = typeof body.sql === "string" ? body.sql : "";
    const params = Array.isArray(body.params) ? body.params : undefined;
    try {
      const result = await deps.sharedTables.runCockpitReadQuery(sql, params);
      sendJson(res, 200, result);
    } catch (err) {
      const status = err instanceof SharedTablesError ? 400 : 500;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const sharedTableExportMatch = path.match(/^\/api\/tabelas-compartilhadas\/([^/]+)\/export$/);
  if (method === "GET" && sharedTableExportMatch) {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const tableName = decodeURIComponent(sharedTableExportMatch[1]);
    const formato = url.searchParams.get("formato") === "json" ? "json" : "csv";
    try {
      const exported = await deps.sharedTables.exportTable(tableName, formato);
      res.writeHead(200, {
        "Content-Type": exported.mimeType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "X-Truncated": exported.truncated ? "1" : "0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Disposition, X-Truncated",
      });
      res.end(exported.content);
    } catch (err) {
      const status = err instanceof SharedTablesError ? 400 : 500;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const sharedTableItemMatch = path.match(/^\/api\/tabelas-compartilhadas\/([^/]+)$/);
  if (sharedTableItemMatch && (method === "GET" || method === "DELETE")) {
    if (!deps.sharedTables) {
      sendJson(res, 503, { erro: "SharedTablesService não inicializado neste daemon." });
      return true;
    }
    const tableName = decodeURIComponent(sharedTableItemMatch[1]);
    try {
      if (method === "DELETE") {
        const deleted = await deps.sharedTables.removeTableAsUser(tableName);
        sendJson(res, 200, { ok: true, ...deleted });
        return true;
      }
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const busca = url.searchParams.get("busca") ?? "";
      const detail = await deps.sharedTables.inspectTableForCockpit(tableName, {
        limit: Number.isFinite(limit) ? limit : 100,
        offset: Number.isFinite(offset) ? offset : 0,
        busca,
      });
      sendJson(res, 200, detail);
    } catch (err) {
      const status = err instanceof SharedTablesError ? 400 : 500;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // 7.2 Biblioteca Hierárquica de Pastas (/api/bibliotecas/pastas)
  if (method === "GET" && path === "/api/bibliotecas/pastas") {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    sendJson(res, 200, deps.libraryFolders.getSnapshot());
    return true;
  }

  if (method === "POST" && path === "/api/bibliotecas/pastas/mover") {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const arquivoIds = Array.isArray(body.arquivo_ids)
      ? body.arquivo_ids.filter((id): id is string => typeof id === "string")
      : [];
    const pastaId = typeof body.pasta_id === "string" && body.pasta_id.trim() ? body.pasta_id.trim() : null;
    try {
      const moved = deps.libraryFolders.moveFilesToFolder(arquivoIds, pastaId);
      sendJson(res, 200, { ok: true, ...moved, snapshot: deps.libraryFolders.getSnapshot() });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/bibliotecas/pastas") {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const agenteId = typeof body.agente_id === "string" ? body.agente_id.trim() : "";
    const nome = typeof body.nome === "string" ? body.nome : "";
    const parentId = typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;
    if (!agenteId || !nome.trim()) {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'agente_id' e 'nome'." });
      return true;
    }
    try {
      const pasta = deps.libraryFolders.createFolder({ agenteId, nome, parentId });
      sendJson(res, 201, { ok: true, pasta, snapshot: deps.libraryFolders.getSnapshot() });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const libraryFolderItemMatch = path.match(/^\/api\/bibliotecas\/pastas\/([^/]+)$/);
  if (libraryFolderItemMatch && (method === "PATCH" || method === "DELETE")) {
    if (!deps.libraryFolders) {
      sendJson(res, 503, { erro: "LibraryFoldersService não inicializado neste daemon." });
      return true;
    }
    const pastaId = decodeURIComponent(libraryFolderItemMatch[1]);
    try {
      if (method === "DELETE") {
        const out = deps.libraryFolders.deleteFolder(pastaId);
        sendJson(res, 200, { ok: true, ...out, snapshot: deps.libraryFolders.getSnapshot() });
        return true;
      }
      const body = await readJsonBody(req);
      const pasta = deps.libraryFolders.renameOrMoveFolder(pastaId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        parentId:
          body.parent_id === null || typeof body.parent_id === "string"
            ? body.parent_id
            : undefined,
      });
      sendJson(res, 200, { ok: true, pasta, snapshot: deps.libraryFolders.getSnapshot() });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // 7.3 Chat Interativo, UI Blocks, SSE & Skill Learning (/api/chat/...)
  if (method === "GET" && path === "/api/chat/stream") {
    wsHub.registerSseClient(res, {
      canalId: url.searchParams.get("canal_id"),
      agenteId: url.searchParams.get("agente_id"),
      threadId: url.searchParams.get("thread_id"),
    });
    return true;
  }

  if (method === "POST" && path === "/api/chat/ui-response") {
    if (!deps.uiBlockRegistry) {
      sendJson(res, 503, { erro: "UiBlockRegistry não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const outcome = deps.uiBlockRegistry.submitUiResponse(
        body as unknown as UiBlockSubmitPayload,
      );
      sendJson(res, 200, { ok: true, ...outcome });
    } catch (err) {
      const status = err instanceof UiBlockHttpError ? err.statusCode : 400;
      sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const skillSuggestionActionMatch = path.match(
    /^\/api\/chat\/skill-sugestao\/([^/]+)\/(salvar|dispensar)$/,
  );
  if (method === "POST" && skillSuggestionActionMatch) {
    if (!deps.skillLearning) {
      sendJson(res, 503, { erro: "SkillLearningService não inicializado neste daemon." });
      return true;
    }
    const mensagemId = decodeURIComponent(skillSuggestionActionMatch[1]);
    const acao = skillSuggestionActionMatch[2];
    if (acao === "dispensar") {
      const sugestao = deps.skillLearning.dismissSuggestionByMessageId(mensagemId);
      if (!sugestao) {
        sendJson(res, 404, { erro: "Sugestão de habilidade não encontrada." });
        return true;
      }
      sendJson(res, 200, { ok: true, sugestao });
      return true;
    }

    const saved = await deps.skillLearning.saveSuggestionByMessageId(mensagemId);
    sendJson(res, saved.ok ? 200 : 400, saved);
    return true;
  }

  // 7.4 Cofre de API Keys (/api/cofre/api-keys)
  if (method === "GET" && path === "/api/cofre/api-keys") {
    if (!deps.apiKeysBridge) {
      sendJson(res, 503, { erro: "ApiKeysBridge não inicializado neste daemon." });
      return true;
    }
    const agenteId = url.searchParams.get("agente_id");
    sendJson(res, 200, { keys: deps.apiKeysBridge.listApiKeys(agenteId) });
    return true;
  }

  if (method === "POST" && path === "/api/cofre/api-keys") {
    if (!deps.apiKeysBridge) {
      sendJson(res, 503, { erro: "ApiKeysBridge não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const name = typeof body.name === "string" ? body.name : typeof body.nome === "string" ? body.nome : "";
    const value = typeof body.value === "string" ? body.value : typeof body.valor === "string" ? body.valor : "";
    const scope = body.scope === "agente_especifico" ? "agente_especifico" : "todos_agentes";
    const agenteId = typeof body.agente_id === "string" ? body.agente_id : null;
    try {
      const saved = deps.apiKeysBridge.saveApiKey({
        name,
        value,
        scope,
        agenteId,
        origemTurno: "usuario_local",
      });
      sendJson(res, 201, { ok: true, ...saved });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const cofreKeyDeleteMatch = path.match(/^\/api\/cofre\/api-keys\/([^/]+)$/);
  if (method === "DELETE" && cofreKeyDeleteMatch) {
    if (!deps.apiKeysBridge) {
      sendJson(res, 503, { erro: "ApiKeysBridge não inicializado neste daemon." });
      return true;
    }
    const keyName = decodeURIComponent(cofreKeyDeleteMatch[1]);
    const rawScope = url.searchParams.get("scope");
    const scope =
      rawScope === "agente_especifico"
        ? "agente_especifico"
        : rawScope === "todos_agentes"
          ? "todos_agentes"
          : undefined;
    const agenteId = url.searchParams.get("agente_id");
    try {
      const out = deps.apiKeysBridge.removeApiKey({
        name: keyName,
        scope,
        agenteId,
        byUser: true,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // 7.5 Configurações Globais de Aprendizado (/api/configuracoes/aprendizado)
  if (path === "/api/configuracoes/aprendizado" && (method === "GET" || method === "PUT")) {
    if (!deps.skillLearning) {
      sendJson(res, 503, { erro: "SkillLearningService não inicializado neste daemon." });
      return true;
    }
    if (method === "GET") {
      sendJson(res, 200, { configuracao: deps.skillLearning.getLearningConfig() });
      return true;
    }
    const body = await readJsonBody(req);
    const updated = deps.skillLearning.updateLearningConfig(body as Partial<AprendizadoConfig>);
    sendJson(res, 200, { ok: true, configuracao: updated });
    return true;
  }

  return false;
}
