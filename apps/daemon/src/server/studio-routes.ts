import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, relative, resolve, sep } from "node:path";
import type {
  AgentNotificationLevel,
  AnexoChat,
  AprendizadoConfig,
  ArquivoStudio,
  BackupModelChoice,
  BackupModelsConfig,
  CanalEquipe,
  ChatVisualMeta,
  ConversationMessage,
  ConversationUiBlock,
  MemoriaInclusao,
  MemoryReviewAlteracao,
  MensagemChat,
  OnboardingEstado,
  PassoChat,
  PermissionLevel,
  ProviderName,
  SkillSugestaoItem,
  ToolDefinition,
  UiBlockSubmitPayload,
  UsageLimitAskPayload,
  WorkflowAresta,
  WorkflowNo,
  WorkflowTraco,
  WorkflowVisual,
} from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import { HandoffBus } from "../engine/runner/handoff-bus.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import { SkillLoader } from "../engine/runner/skill-loader.ts";
import type { CatalogService } from "../marketplace/catalog-service.ts";
import type { GithubImporter } from "../marketplace/github-importer.ts";
import type { SkillsManager } from "../marketplace/skills-manager.ts";
import type { McpGateway, McpOAuthRequiredNotice } from "../mcp/mcp-gateway.ts";
import { redactMcpPayload, redactMcpSecrets } from "../mcp/mcp-redaction.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { VaultService } from "../vault/vault-service.ts";
import {
  buildConnectorsList,
  computeHostAnalytics,
  importOpenBotTelemetryIfAvailable,
  listInstalledSkills,
  loadSkillPromptBySlug,
  recordChatTurnUsage,
  recordSkillLoadUsage,
} from "./analytics-skills-service.ts";
import {
  activateUpgradePackage,
  getBrandIdentity,
  listUpgradePackages,
  saveBrandIdentity,
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
  syncWorkspaceFilesToDatabase,
  validateMetaIntegration,
  type Phase14ToolServices,
} from "./studio-tools-bridge.ts";
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

  return {
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

interface ParsedTextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

function parseWorkflowTextToolCalls(text: string): ParsedTextToolCall[] {
  const calls: ParsedTextToolCall[] = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        name?: unknown;
        arguments?: unknown;
      };
      if (
        typeof parsed.name === "string" &&
        (isWorkflowToolName(parsed.name) ||
          isPhase13ToolName(parsed.name) ||
          isPhase14ToolName(parsed.name) ||
          isPhase15ToolName(parsed.name))
      ) {
        calls.push({
          name: parsed.name,
          arguments:
            parsed.arguments && typeof parsed.arguments === "object"
              ? (parsed.arguments as Record<string, unknown>)
              : {},
        });
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
  signal?: AbortSignal;
  steps: PassoChat[];
  onProgress?: (event: {
    fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
    mensagem_status?: string;
    step?: PassoChat;
    delta?: string;
  }) => void;
}): Promise<string> {
  let currentText = params.initialText;
  const hasWorkflow = Boolean(params.deps.workflowStore && params.deps.workflowEngine);
  const hasPhase13 = Boolean(params.deps.phase13);
  const hasPhase14 = Boolean(params.deps.phase14);
  const hasPhase15 = Boolean(
    params.deps.browserService ||
      params.deps.screenCapture ||
      params.deps.showcaseService ||
      params.deps.db,
  );
  if (!hasWorkflow && !hasPhase13 && !hasPhase14 && !hasPhase15) {
    return currentText;
  }

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
      let out: unknown;
      let failed = false;
      try {
        if (isPhase15ToolName(call.name)) {
          const canalId =
            params.threadId && !params.threadId.startsWith("main:")
              ? `thread:${params.threadId}`
              : `agente:${params.agenteId}`;
          out = await executePhase15ChatTool({
            toolName: call.name,
            args: call.arguments,
            agenteId: params.agenteId,
            canalId,
            deps: {
              db: params.deps.db,
              wsHub: params.deps.wsHub,
              workspaceRoot: params.deps.workspaceRoot ?? process.cwd(),
              browserService: params.deps.browserService,
              screenCapture: params.deps.screenCapture,
              showcaseService: params.deps.showcaseService,
              transcription: params.deps.transcription,
            },
          });
        } else if (isPhase14ToolName(call.name) && params.deps.phase14) {
          const canalId =
            params.threadId && !params.threadId.startsWith("main:")
              ? `thread:${params.threadId}`
              : `agente:${params.agenteId}`;
          out = await executePhase14ToolCall(
            call.name,
            call.arguments,
            {
              agenteId: params.agenteId,
              canalId,
              threadId: params.threadId ?? `main:${params.agenteId}`,
              turnId: params.turnId,
              origemTurno: params.isRoutine ? "rotina" : "usuario_local",
              isOneToOneUserChat: !params.isRoutine && canalId === `agente:${params.agenteId}`,
              lastUserMessageId: params.entregaOrigemId ?? null,
            },
            params.deps.phase14,
          );
        } else if (isPhase13ToolName(call.name) && params.deps.phase13) {
          const p13 = await executePhase13Tool(
            call.name,
            call.arguments,
            {
              agenteId: params.agenteId,
              turnoId: params.turnId,
              callId: `${params.turnId}:${round}:${call.name}`,
              threadId: params.threadId ?? `main:${params.agenteId}`,
              canalId:
                params.threadId && !params.threadId.startsWith("main:")
                  ? `thread:${params.threadId}`
                  : `agente:${params.agenteId}`,
              entregaOrigemId: params.entregaOrigemId ?? params.turnId,
              pedidoTexto: params.pedidoTexto ?? "",
              isRoutine: params.isRoutine,
              isResumingWait: params.isResumingWait,
            },
            params.deps.phase13,
          );
          out = p13.result;
        } else if (hasWorkflow) {
          out = await executeChatWorkflowTool(call.name, call.arguments, {
            store: params.deps.workflowStore,
            engine: params.deps.workflowEngine,
            wsHub: params.deps.wsHub,
            agenteId: params.agenteId,
            requestSeed: params.turnId,
          });
        } else {
          failed = true;
          out = { erro: `Serviço indisponível para ferramenta '${call.name}'.` };
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

function extractMentionedAgentIds(text: string, excludeId?: string): string[] {
  const found = new Set<string>();
  const validIds = new Set(ROSTER_15_AGENTES.map((a) => a.agente_id));

  // Detecta [HANDOFF:agente_id] ou @agente_id no texto do usuário
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_]+)\]/gi)) {
    const id = m[1].toLowerCase();
    if (validIds.has(id) && id !== excludeId) found.add(id);
  }
  for (const m of text.matchAll(/@([a-z0-9_]+)/gi)) {
    const id = m[1].toLowerCase();
    if (validIds.has(id) && id !== excludeId) found.add(id);
  }
  return Array.from(found);
}

function extractExplicitAgentHandoffTags(text: string, excludeId?: string): string[] {
  const found = new Set<string>();
  const validIds = new Set(ROSTER_15_AGENTES.map((a) => a.agente_id));
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_]+)\]/gi)) {
    const id = m[1].toLowerCase();
    if (validIds.has(id) && id !== excludeId) found.add(id);
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

export function hasExplicitVisualGenerationIntent(
  userPrompt: string,
  agentId: string,
  isHandoff = false
): boolean {
  if (isGreetingOrCapabilityQuestion(userPrompt)) return false;
  if (!EXPLICIT_CREATION_ACTION_RE.test(userPrompt)) return false;

  const isVisualAgent = agentId.startsWith("designer_") || agentId === "consistencia_visual";
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
  workspaceRoot = process.cwd()
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

  const def = ROSTER_15_AGENTES.find((a) => a.agente_id === row.agente_id);
  const parsedConfig = safeJsonParse<Record<string, unknown>>(row.config_json, {});
  const pacote = (
    parsedConfig.pacote === "bonus" || parsedConfig.pacote === "video"
      ? parsedConfig.pacote
      : def?.pacote ?? "base"
  ) as "base" | "bonus" | "video";
  const upgradeDesbloqueado = isUpgradeUnlocked(db, workspaceRoot, pacote);
  const promptBase =
    typeof parsedConfig.prompt_base === "string" && parsedConfig.prompt_base.trim().length > 0
      ? parsedConfig.prompt_base
      : def?.prompt_base ?? "";

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

  return {
    ...row,
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
    nao_lidas: Number(unreadRow?.total ?? 0),
    ultima_mensagem: lastRow ? lastRow.conteudo_markdown.replace(/\s+/g, " ").slice(0, 96) : null,
    ultima_mensagem_em: lastRow?.criado_em ?? row.atualizado_em,
  };
}

interface ChatProgressReport {
  fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
  mensagem_status?: string;
  step?: PassoChat;
  delta?: string;
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
  }
): Promise<{
  markdown: string;
  steps: PassoChat[];
  tarefaCriadaId: string | null;
  anexosGerados: AnexoChat[];
  usageLimitAsk?: UsageLimitAskPayload;
}> {
  onProgress?.({
    fase: "iniciado",
    mensagem_status: `Carregando habilidade e memórias de ${agente.nome}...`,
  });
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const config = safeJsonParse<Record<string, unknown>>(agente.config_json, {});
  const onboarding = deps.providerConnection.getOnboardingState();
  const skillSlug = typeof config.skill_slug === "string" ? config.skill_slug : agente.agente_id;
  const loadedSkill =
    process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1"
      ? null
      : loadSkillPromptBySlug(skillSlug, undefined, workspaceRoot);
  const chatSkillLoader = new SkillLoader([], workspaceRoot);
  const linkedSkills = chatSkillLoader.loadLinkedAgentSkills(deps.db, agente.agente_id);

  // Carrega memórias persistidas do agente para contextualizar respostas reais
  const memories = deps.db.connection
    .prepare(`SELECT texto FROM projecao_agente_memorias WHERE agente_id = ? ORDER BY criado_em DESC LIMIT 8;`)
    .all(agente.agente_id) as Array<{ texto: string }>;

  const liveStudioContext = buildStudioLiveContext({
    db: deps.db,
    vault: deps.vault,
    providerConnection: deps.providerConnection,
    workspaceRoot,
    agenteId: agente.agente_id,
    memoryManager: deps.memoryManager,
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

  // Ponte nativa para validação real da Meta Graph API (sem expor tokens)
  const lowerCheck = userPrompt.toLowerCase();
  const asksMetaValidation =
    agente.agente_id === "engenheiro_meta" &&
    /(validar|valida|valide|testar|teste|status|diagn[oó]stico|integra[cç][aã]o|meta|instagram|credencia)/i.test(
      lowerCheck
    );

  let metaValidationSummary: Awaited<ReturnType<typeof validateMetaIntegration>> | null = null;
  if (asksMetaValidation && deps.vault) {
    const tMeta0 = Date.now();
    metaValidationSummary = await validateMetaIntegration(deps.vault);
    const metaStep: PassoChat = {
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API v21.0 validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · Estágio ${metaValidationSummary.estagio})`
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
      `## Resultado Real Executado Agora por validar_integracao_meta (Cofre SQLite + Graph API v21.0)\n${JSON.stringify(
        metaValidationSummary,
        null,
        2
      )}\nBaseie sua resposta exclusivamente neste diagnóstico real sem jamais pedir ou exibir tokens.`
    );
  }

  if (deps.workflowStore && deps.workflowEngine) {
    promptBaseParts.push(
      `## Ferramentas de Workflow em Grafo Disponíveis\nVocê pode inspecionar, criar/editar, executar (completo ou parcial a partir de um nó) e consultar histórico de workflows pelas ferramentas: list_workflows, read_workflow, edit_workflow, delete_workflow, run_workflow e read_workflow_runs. Regra crítica de segurança: JAMAIS execute delete_workflow sem confirmação humana explícita prévia (confirmed_by_human: true).`
    );
  }
  if (deps.phase13 || options?.wokenWaitsBlock) {
    promptBaseParts.push(
      buildPhase13SystemGuidance({
        allowStartTask:
          !options?.threadId || options.threadId.startsWith("main:") || Boolean(options?.isRoutine),
        wokenWaitsBlock: options?.wokenWaitsBlock,
      }),
    );
  }

  const promptBase = promptBaseParts.join("\n\n");
  const mcpTools = deps.mcpGateway
    ? await deps.mcpGateway.getToolsForAgent(agente.agente_id).catch(() => [])
    : [];
  const availableChatToolsMap = new Map<string, ToolDefinition>();
  const studioRoutineTools = deps.routineToolsDeps ? ROUTINE_AGENT_TOOLS_SCHEMA : [];
  const studioWorkflowTools =
    deps.workflowStore && deps.workflowEngine ? getChatWorkflowToolCatalog() : [];
  const studioPhase13Tools = deps.phase13 ? PHASE13_TOOLS_SCHEMA : [];
  const studioPhase14Tools = deps.phase14 ? PHASE14_TOOLS_SCHEMA : [];
  const studioPhase15Tools =
    deps.browserService || deps.screenCapture || deps.showcaseService
      ? PHASE15_TOOLS_SCHEMA
      : [];
  for (const t of [
    ...PHASE10_TOOL_DEFINITIONS,
    ...studioRoutineTools,
    ...studioWorkflowTools,
    ...studioPhase13Tools,
    ...studioPhase14Tools,
    ...studioPhase15Tools,
    ...mcpTools,
  ]) {
    if (!availableChatToolsMap.has(t.name)) {
      availableChatToolsMap.set(t.name, t);
    }
  }
  const availableChatTools = Array.from(availableChatToolsMap.values());

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
    titulo: loadedSkill
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
        ? `Meta Graph API v21.0 validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · @${metaValidationSummary.detalhes.username ?? "conectado"})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 90)}`,
      detalhes: metaValidationSummary.resumo,
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: 95,
    });
  }
  onProgress?.({
    fase: "etapa",
    mensagem_status: loadedSkill
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
  const intentSourcePrompt = options?.originalUserPrompt ?? userPrompt;
  const greetingOrCapability = isGreetingOrCapabilityQuestion(intentSourcePrompt);
  const lower = intentSourcePrompt.toLowerCase();
  let tarefaCriadaId: string | null = null;

  const asksProduction =
    !greetingOrCapability &&
    EXPLICIT_CREATION_ACTION_RE.test(intentSourcePrompt) &&
    EXPLICIT_VISUAL_ASSET_NOUN_RE.test(intentSourcePrompt);
  const asksVisualAsset = hasExplicitVisualGenerationIntent(
    intentSourcePrompt,
    agente.agente_id,
    Boolean(options?.isHandoff)
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
  let resolvedImageDiskPaths = anexos
    .map((a) => resolve(workspaceRoot, a.caminho_relativo))
    .filter((p) => existsSync(p));

  // Quando o usuário não anexou na mensagem e é um turno visual/designer, carrega referências da marca do disco/SQLite
  if (
    resolvedImageDiskPaths.length === 0 &&
    (asksVisualAsset || agente.agente_id.startsWith("designer_") || agente.agente_id === "consistencia_visual") &&
    process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1"
  ) {
    const refRows = deps.db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE tipo_uso IN ('referencia', 'logo', 'personagem')
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY CASE
           WHEN caminho_relativo LIKE 'recursos/referencias/%' THEN 0
           WHEN caminho_relativo LIKE 'recursos/fotos/%' THEN 1
           WHEN caminho_relativo LIKE 'recursos/logos/%' THEN 2
           ELSE 3
         END, criado_em DESC
         LIMIT 4;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    resolvedImageDiskPaths = refRows
      .map((r) => resolve(workspaceRoot, r.caminho_relativo))
      .filter((p) => existsSync(p));
  }

  // Se houver conta conectada e pedido visual explícito, gera arte real via gemini-3.1-flash-image
  if (hasAntigravityAccount && asksVisualAsset) {
    const tImgStart = Date.now();
    try {
      const imgGen = await agService.executeCodeAssistGenerate({
        model: agSnapshot.imageGenerationModelIds[0] ?? "gemini-3.1-flash-image",
        messages: [
          {
            role: "user",
            text: `Crie uma arte profissional de Instagram para ${onboarding.marca_nome} (${onboarding.perfil_handle}). Solicitação do usuário: ${userPrompt}. Estética editorial contemporânea, alta legibilidade e contraste, sem marcas d'água.`,
          },
        ],
        imagePaths: resolvedImageDiskPaths,
        generateImage: true,
        agentId: agente.agente_id,
        preferredAccountId: typeof config.provider_account_id === "string" ? config.provider_account_id : null,
      });

      if (imgGen.images.length > 0) {
        const firstImg = imgGen.images[0];
        const ext = firstImg.mimeType.includes("png") ? ".png" : firstImg.mimeType.includes("webp") ? ".webp" : ".jpg";
        const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
        const dirArtes = resolve(workspaceRoot, "saidas", "artes");
        mkdirSync(dirArtes, { recursive: true });
        const fileName = `${arquivoId}${ext}`;
        const diskPath = resolve(dirArtes, fileName);
        const buf = Buffer.from(firstImg.dataBase64, "base64");
        writeFileSync(diskPath, buf);

        const relPath = `saidas/artes/${fileName}`;
        const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`;
        const agora = new Date().toISOString();

        deps.db.connection
          .prepare(
            `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
             VALUES (?, ?, ?, ?, ?, 'gerado', ?, ?, ?);`
          )
          .run(arquivoId, fileName, relPath, firstImg.mimeType, buf.length, agente.agente_id, tarefaCriadaId, agora);

        anexosGerados.push({
          arquivo_id: arquivoId,
          nome: fileName,
          caminho_relativo: relPath,
          url: urlRaw,
          mime_type: firstImg.mimeType,
          tamanho_bytes: buf.length,
          tipo_uso: "gerado",
        });

        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId: `${turnId}:img`,
          provider: "antigravity",
          model: imgGen.modelUsed,
          uncachedInput: imgGen.usage.uncachedInput,
          cachedInput: imgGen.usage.cachedInput,
          output: imgGen.usage.output,
        });

        if (tarefaCriadaId) {
          deps.queue.updateTaskStatus(tarefaCriadaId, "aguardando_aprovacao", {
            preview_url: urlRaw,
            imagem_caminho: relPath,
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

        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `generate_image:${imgGen.modelUsed}`,
          titulo: `Arte real gerada (${(buf.length / 1024).toFixed(0)} KB · ${imgGen.modelUsed})`,
          detalhes: relPath,
          status: "concluido",
          duracao_ms: Date.now() - tImgStart,
        });
      }
    } catch (imgErr) {
      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: "generate_image",
        titulo: `Aviso na geração de imagem: ${imgErr instanceof Error ? imgErr.message.slice(0, 90) : "falha na chamada"}`,
        status: "erro",
        duracao_ms: Date.now() - tImgStart,
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
        const cliMsgs = history.slice(-8).map((item) => ({
          role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
          text: item.conteudo_markdown,
        }));
        cliMsgs.push({
          role: "user",
          text:
            anexos.length > 0
              ? `${userPrompt}\n\n[Anexos ImagePaths disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
              : userPrompt,
        });

        const cliSystemPrompt = `${promptBase}\nResponda em pt-br de forma prática e objetiva. Nunca invente handles ou marcas reais.${
          deps.workflowStore && deps.workflowEngine
            ? "\nQuando precisar consultar/editar/executar workflows em grafo, responda contendo <tool_call>{\"name\":\"...\",\"arguments\":{...}}</tool_call>."
            : ""
        }`;
        const poolAccount = await deps.providerConnection
          .pickPoolAccount(targetProvider, preferredAccId)
          .catch(() => null);
        const effAccountId = preferredAccId ?? poolAccount?.id ?? null;

        const cliResult = await deps.providerConnection.getCliOAuthService().executeTurn({
          provedor: targetProvider as "claude" | "openai",
          modelId: targetModel,
          systemPrompt: cliSystemPrompt,
          messages: cliMsgs,
          preferredAccountId: effAccountId,
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
              preferredAccountId: effAccountId,
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
          signal: options?.signal,
          steps,
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
        const ocMsgs = history.slice(-8).map((item) => ({
          role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
          text: item.conteudo_markdown,
        }));
        ocMsgs.push({
          role: "user",
          text:
            anexos.length > 0
              ? `${userPrompt}\n\n[Anexos disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
              : userPrompt,
        });

        const ocSystemPrompt = `${promptBase}\nResponda em pt-br de forma prática e especializada.${
          deps.workflowStore && deps.workflowEngine
            ? "\nQuando precisar consultar/editar/executar workflows em grafo, responda contendo <tool_call>{\"name\":\"...\",\"arguments\":{...}}</tool_call>."
            : ""
        }`;
        const ocResult = await deps.providerConnection.getOpenCodeService().executePrompt({
          modelId: targetModel,
          systemPrompt: ocSystemPrompt,
          messages: ocMsgs,
          agentId: agente.agente_id,
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
            signal: options?.signal,
            steps,
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
        const turnMessages: ConversationMessage[] = history.slice(-8).map((item) => ({
          role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
          content: item.conteudo_markdown,
        }));
        turnMessages.push({
          role: "user",
          content:
            anexos.length > 0
              ? `${userPrompt}\n\n[Anexos ImagePaths disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
              : userPrompt,
        });

        const systemPromptChat = `${promptBase}\nResponda sempre em pt-br com objetividade, tabelas Markdown quando útil e zero dados fictícios de clientes reais.`;
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
                  },
                  deps.phase13,
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
        const historyMsgs = history.slice(-8).map((item) => ({
          role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
          text: item.conteudo_markdown,
        }));
        historyMsgs.push({
          role: "user",
          text:
            anexosGerados.length > 0
              ? `${userPrompt}\n\n[Uma imagem acabou de ser gerada e salva em: ${anexosGerados.map((a) => a.caminho_relativo).join(", ")}. Descreva o resultado e proponha legenda/próximos passos.]`
              : userPrompt,
        });

        const agSystemPrompt = `${promptBase}\nResponda em pt-br de forma prática e especializada como ${agente.nome}. Use tabelas Markdown quando ajudar na organização. Nunca invente handles ou marcas reais: utilize apenas os informados pelo usuário.${
          deps.workflowStore && deps.workflowEngine
            ? "\nQuando precisar consultar/editar/executar workflows em grafo, responda contendo <tool_call>{\"name\":\"...\",\"arguments\":{...}}</tool_call>."
            : ""
        }`;
        const liveResult = await agService.executeCodeAssistGenerate({
          model: targetModel,
          systemPrompt: agSystemPrompt,
          messages: historyMsgs,
          imagePaths: resolvedImageDiskPaths,
          agentId: agente.agente_id,
          preferredAccountId: preferredAccId,
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
                systemPrompt: agSystemPrompt,
                messages: [
                  ...historyMsgs,
                  { role: "assistant", text: liveResult.text },
                  { role: "user", text: followUpPrompt },
                ],
                agentId: agente.agente_id,
                preferredAccountId: preferredAccId,
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
            signal: options?.signal,
            steps,
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

  const preferredAcc =
    options?.overrideAccountId !== undefined
      ? options.overrideAccountId
      : typeof config.provider_account_id === "string"
        ? config.provider_account_id
        : null;

  const primaryReplyText = await invokeModelAttempt(initialModel, preferredAcc);
  if (primaryReplyText !== null) {
    return { markdown: primaryReplyText, steps, tarefaCriadaId, anexosGerados };
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
          return { markdown: backupText, steps, tarefaCriadaId, anexosGerados };
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
        anexosGerados,
        usageLimitAsk,
      };
    }
  }

  if (metaValidationSummary) {
    const det = metaValidationSummary.detalhes;
    const metaReportMarkdown = [
      `### Diagnóstico Oficial da Integração Meta (Cofre AES-256-GCM + Graph API v21.0)`,
      "",
      `| Componente | Status | Detalhe |`,
      `|---|---|---|`,
      `| Token Meta no Cofre SQLite | ${det.tokenConfigurado ? "✅ Configurado" : "❌ Ausente"} | Criptografado localmente (nunca exposto) |`,
      `| Instagram Business Account ID | ${det.accountIdConfigurado ? "✅ Configurado" : "❌ Ausente"} | ID validado no Cofre |`,
      `| Meta Graph API v21.0 | ${det.graphApiOk ? `✅ HTTP ${det.httpStatus} OK` : `❌ Falha${det.httpStatus ? ` HTTP ${det.httpStatus}` : ""}`} | ${det.graphApiOk ? `Perfil @${det.username ?? "ativo"}` : det.erro ?? "Erro na consulta"} |`,
      "",
      `**Estágio atual:** ${metaValidationSummary.estagio} — ${metaValidationSummary.resumo}`,
    ].join("\n");
    return { markdown: metaReportMarkdown, steps, tarefaCriadaId, anexosGerados };
  }

  // 5. Resposta honesta: diferencia erro técnico em provedor conectado vs ausência real de conexão
  const statusLabel = execState.hadConnectedRoute ? "Falha na chamada" : "Não conectado";
  const detailLine = execState.hadConnectedRoute
    ? `Erro técnico ao executar **${agente.modelo_padrao}** (${providerName}): \`${execState.lastExecutionError ?? "sem resposta do servidor"}\`. Tente novamente ou reautentique sua conta em **Conexões**.`
    : anexosGerados.length > 0
      ? `Arte gerada e salva em \`${anexosGerados[0].caminho_relativo}\`.`
      : `Nenhum provedor conectado para o modelo **${agente.modelo_padrao}** (\`${providerName}\`). Abra **Conexões** e clique para conectar via navegador (Google, Claude ou ChatGPT), utilize modelos gratuitos do **OpenCode** ou salve uma API Key.`;

  const structuredFallback = [
    `**${agente.nome}** recebeu sua solicitação para **${onboarding.marca_nome}** (\`${onboarding.perfil_handle}\`):`,
    "",
    `> ${userPrompt.slice(0, 200)}`,
    "",
    "| Etapa do Plano | Ação | Status |",
    "|---|---|---|",
    `| 1. Diagnóstico | Contexto de \`${skillSlug}\` (${agente.modelo_padrao}) | Pronto |`,
    `| 2. Execução IA | ${anexosGerados.length > 0 ? `Arte gerada em \`${anexosGerados[0].caminho_relativo}\`` : execState.hadConnectedRoute ? `Falha técnica: ${(execState.lastExecutionError ?? "erro").slice(0, 70)}` : "Aguardando conta conectada ou API Key"} | ${anexosGerados.length > 0 ? "Concluído" : statusLabel} |`,
    `| 3. Segurança Meta | Aprovação humana obrigatória antes da publicação | Ativo |`,
    "",
    detailLine,
  ].join("\n");

  return { markdown: structuredFallback, steps, tarefaCriadaId, anexosGerados };
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

  const history = historyRows.reverse().map(mapChatRow);
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

  const replyMetadados: Record<string, unknown> | undefined = reply.usageLimitAsk
    ? { usage_limit_ask: reply.usageLimitAsk }
    : undefined;

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

  // 1. Onboarding
  if (method === "GET" && path === "/api/onboarding") {
    sendJson(res, 200, { onboarding: providerConnection.getOnboardingState() });
    return true;
  }

  if (method === "PUT" && path === "/api/onboarding") {
    const body = await readJsonBody(req);
    const updated = providerConnection.updateOnboardingState(body as Partial<OnboardingEstado>);
    sendJson(res, 200, { onboarding: updated });
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
    if (url.searchParams.get("importOpenBot") === "1" || process.env.CRIATIVO_IMPORT_OPENBOT_DB === "1") {
      importOpenBotTelemetryIfAvailable(db);
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
    sendJson(res, 200, { habilidades: listInstalledSkills(db, undefined, workspaceRoot) });
    return true;
  }

  const skillDetailMatch = path.match(/^\/api\/habilidades\/([^/]+)$/);
  if (method === "GET" && skillDetailMatch) {
    const slug = decodeURIComponent(skillDetailMatch[1]);
    const loaded = loadSkillPromptBySlug(slug, undefined, workspaceRoot);
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
    const updated = await saveBrandIdentity(providerConnection, workspaceRoot, body);
    sendJson(res, 200, { identidade: updated, onboarding: providerConnection.getOnboardingState() });
    return true;
  }

  // Upgrades Modulares (Bônus & Vídeo em Etapas)
  if (method === "GET" && path === "/api/upgrades") {
    sendJson(res, 200, { upgrades: listUpgradePackages(db, workspaceRoot) });
    return true;
  }

  if (method === "POST" && path === "/api/upgrades/instalar") {
    const body = await readJsonBody(req);
    if (body.pacote !== "bonus" && body.pacote !== "video") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'pacote' ('bonus' ou 'video')." });
      return true;
    }
    const upgrades = activateUpgradePackage(db, workspaceRoot, body.pacote);
    wsHub.broadcast("provider:updated", {
      provedor: "gemini",
      conectado: true,
      modo: "assinatura",
    });
    sendJson(res, 200, { ok: true, upgrades });
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
    });
    const provedores = await providerConnection.getProvidersStatus(true);
    sendJson(res, 201, { conta, provedores });
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
    const apenasDesbloqueados = url.searchParams.get("apenas_desbloqueados") === "1";
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
      .all() as Array<Parameters<typeof enrichAgentRow>[1]>;
    const enriched = rows.map((row) => enrichAgentRow(db, row, workspaceRoot));
    const filtered = apenasDesbloqueados
      ? enriched.filter((a) => a.config.upgrade_desbloqueado !== false)
      : enriched;
    sendJson(res, 200, { agentes: filtered });
    return true;
  }

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

    const config = {
      frente: "custom",
      pasta: typeof body.pasta === "string" ? body.pasta : "Agentes Customizados",
      skill_slug: "custom-agent",
      avatar_shape: typeof body.avatar_shape === "string" ? body.avatar_shape : "rounded_square",
      avatar_color: typeof body.avatar_color === "string" ? body.avatar_color : "#38bdf8",
      effort: typeof body.effort === "string" ? body.effort : "alto",
      prompt_base:
        typeof body.prompt_base === "string" && body.prompt_base.trim().length > 0
          ? body.prompt_base.trim()
          : `Você é ${nome}, agente customizado do Criativo AI Studio para [NOME_DA_MARCA].`,
      customizado: true,
    };

    const papel =
      typeof body.papel === "string" && body.papel.trim().length > 0
        ? body.papel.trim()
        : config.prompt_base.slice(0, 120);
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

    sendJson(res, 201, { agente: enrichAgentRow(db, createdRow) });
    return true;
  }

  const agentUpdateMatch = path.match(/^\/api\/agentes\/([^/]+)$/);
  if (method === "PUT" && agentUpdateMatch) {
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

    const nextConfig = {
      ...currentConfig,
      ...incomingConfig,
      ...(typeof body.effort === "string" ? { effort: body.effort } : {}),
      ...(typeof body.avatar_shape === "string" ? { avatar_shape: body.avatar_shape } : {}),
      ...(typeof body.avatar_color === "string" ? { avatar_color: body.avatar_color } : {}),
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

    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot) });
    return true;
  }

  const agentRestoreMatch = path.match(/^\/api\/agentes\/([^/]+)\/restaurar$/);
  if (method === "POST" && agentRestoreMatch) {
    const agenteId = decodeURIComponent(agentRestoreMatch[1]);
    const def = ROSTER_15_AGENTES.find((a) => a.agente_id === agenteId);
    if (!def) {
      sendJson(res, 404, { erro: `Agente padrão '${agenteId}' não encontrado.` });
      return true;
    }
    const restoredConfig = {
      frente: def.frente,
      pacote: def.pacote,
      pasta: def.pasta,
      skill_slug: def.skill_slug,
      avatar_shape: def.avatar_shape,
      avatar_color: def.avatar_color,
      effort: def.effort,
      ferramentas: def.ferramentas,
      prompt_base: def.prompt_base,
      customizado: false,
    };
    db.connection
      .prepare(
        `UPDATE projecao_agentes SET nome = ?, papel = ?, modelo_padrao = ?, config_json = ?, atualizado_em = ? WHERE agente_id = ?;`
      )
      .run(
        def.nome,
        def.papel,
        def.modelo_padrao,
        JSON.stringify(restoredConfig),
        new Date().toISOString(),
        agenteId
      );
    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];
    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot) });
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

  // Mensagens do Agente (GET / POST / lidas)
  const agentReadMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens\/lidas$/);
  if (method === "POST" && agentReadMatch) {
    const agenteId = decodeURIComponent(agentReadMatch[1]);
    db.connection
      .prepare(`UPDATE projecao_conversas_chat SET lida = 1 WHERE canal_id = ?;`)
      .run(`agente:${agenteId}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const agentRoutineMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/rotinas\/([^/]+)\/mensagens$/);
  if (agentRoutineMsgMatch && method === "GET") {
    const rotinaId = decodeURIComponent(agentRoutineMsgMatch[2]);
    const canalId = `rotina:${rotinaId}`;
    const rows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 120;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    sendJson(res, 200, { mensagens: rows.map(mapChatRow) });
    return true;
  }

  const agentMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens$/);
  if (agentMsgMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMsgMatch[1]);
    const canalIdQuery = url.searchParams.get("canal_id");
    const canalId =
      method === "GET" && canalIdQuery && canalIdQuery.startsWith("rotina:")
        ? canalIdQuery
        : `agente:${agenteId}`;

    if (method === "GET") {
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
          sendJson(res, 200, { mensagens: pagina.mensagens, pagina });
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
      sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db)) });
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
    const history = historyRows.map(mapChatRow);

    // Handoff 1:1 somente quando não for saudação/dúvida:
    // - do usuário: aceita @agente_id ou [HANDOFF:agente_id]
    // - da resposta do agente: exige [HANDOFF:agente_id] explícito (nunca @mencao em explicação)
    const isSimpleGreeting = isGreetingOrCapabilityQuestion(userMsg.conteudo_markdown);
    const handoffTargets = isSimpleGreeting
      ? []
      : Array.from(
          new Set([
            ...extractMentionedAgentIds(userMsg.conteudo_markdown, agenteId),
            ...extractExplicitAgentHandoffTags(agentMsg.conteudo_markdown, agenteId),
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
  if (canalMsgMatch && (method === "GET" || method === "POST")) {
    const canalId = decodeURIComponent(canalMsgMatch[1]);
    if (method === "GET") {
      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 150;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map(mapChatRow) });
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
    const mencionados = extractMentionedAgentIds(userMsg.conteudo_markdown);
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
      ...prevRowsDesc.reverse().map(mapChatRow),
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
    const tipoUso = inferTipoUso(mimeType, typeof body.tipo_uso === "string" ? body.tipo_uso : undefined);

    const relFolder =
      tipoUso === "referencia"
        ? "recursos/referencias"
        : tipoUso === "logo"
          ? "recursos/logos"
          : tipoUso === "personagem"
            ? "recursos/personagens"
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

    sendJson(res, 201, { arquivo });
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
