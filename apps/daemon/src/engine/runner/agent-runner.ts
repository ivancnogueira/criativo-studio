import type {
  ConversationMessage,
  TarefaRegistro,
  ToolCallRequest,
  ToolDefinition,
} from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../../database/client.ts";
import type { CatalogService } from "../../marketplace/catalog-service.ts";
import type { SkillsManager } from "../../marketplace/skills-manager.ts";
import type { McpGateway, McpOAuthRequiredNotice } from "../../mcp/mcp-gateway.ts";
import { redactMcpPayload, redactMcpSecrets } from "../../mcp/mcp-redaction.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";
import {
  assertAgentPermissionForPath,
  buildPhase13SystemGuidance,
  executePhase13Tool,
  executePhase14ToolCall,
  executePhase15ToolCall,
  executeStudioExtensionTool,
  isAgentAuthorizedForStudioTool,
  isPhase10ExtensionTool,
  isPhase13ToolName,
  isPhase14ToolName,
  isPhase15ToolName,
  PHASE10_TOOL_DEFINITIONS,
  PHASE13_TOOLS_SCHEMA,
  PHASE14_TOOLS_SCHEMA,
  PHASE15_TOOLS_SCHEMA,
  readAgentContextCutoffAt,
  readAgentGovernance,
  type Phase13ToolServices,
  type Phase14ToolServices,
} from "../../server/studio-tools-bridge.ts";
import {
  executeRoutineToolCall,
  isRoutineToolName,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  type RoutineToolExecutionContext,
  type RoutineToolsDeps,
} from "../../routines/routine-agent-tools.ts";
import {
  isWorkflowToolName,
  WORKFLOW_TOOL_DEFINITIONS,
} from "../../workflows/workflow-tools.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import type { McpClient } from "../providers/mcp-client.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import { BrowserAutomationService } from "../tools/browser-automation.ts";
import { ScreenCaptureBridge } from "../tools/screen-capture-bridge.ts";
import { ShowcaseSiteService } from "../../server/showcase-service.ts";
import { TranscriptionService } from "../../voice/transcription-service.ts";
import {
  BackupModelsResolver,
  isRetryableQuotaOrProviderError,
} from "./backup-models-resolver.ts";
import { generateImageTool, type GenerateImageParams } from "../tools/generate-image.ts";
import { generateVideoTool, type GenerateVideoParams } from "../tools/generate-video.ts";
import { metaPublishTool, type MetaPublishParams } from "../tools/meta-publish.ts";
import { executeRemotionRender, type RemotionRenderParams } from "../tools/remotion-bridge.ts";
import { processImageMarginsAndCrop, type TargetAspect } from "../tools/sharp-pipeline.ts";
import { HandoffBus } from "./handoff-bus.ts";
import { HistorySearchService } from "./history-search-service.ts";
import { LibraryFoldersService } from "./library-folders-service.ts";
import { MemoryManager } from "./memory-manager.ts";
import { ChatVisualPreviewService } from "./chat-visual-preview-service.ts";
import { UiBlockRegistry } from "./ui-block-registry.ts";
import { ApiKeysBridge } from "../../vault/api-keys-bridge.ts";
import { seedDefaultAgents } from "./roster-defaults.ts";
import { SkillLoader } from "./skill-loader.ts";

import {
  type AgentRunResult,
  type AgentRunRuntimeContext,
  type AgentRunnerDeps,
  type AgentRunnerOptions,
  type CustomToolExecutor,
  type WorkflowToolExecutor,
} from "./runner-types.ts";
import { executeAgentRunTask } from "./runner-task-loop.ts";

export type {
  CustomToolExecutor,
  WorkflowToolExecutor,
  AgentRunnerOptions,
  AgentRunRuntimeContext,
  AgentRunResult,
};

export class AgentRunner {
  private readonly db: CriativoDatabase;
  private readonly queue: FifoQueueManager;
  private readonly vault: VaultService;
  private readonly providers: ProviderRegistry;
  private readonly providerConnection?: ProviderConnectionService;
  private readonly wsHub?: WebSocketHub;
  private readonly skillLoader: SkillLoader;
  private readonly memoryManager: MemoryManager;
  private readonly handoffBus: HandoffBus;
  private readonly browserService: BrowserAutomationService;
  private readonly screenCapture?: ScreenCaptureBridge;
  private readonly showcaseService?: ShowcaseSiteService;
  private readonly transcription?: TranscriptionService;
  private readonly backupResolver: BackupModelsResolver;
  private readonly mcpClients: McpClient[];
  private readonly mcpGateway?: McpGateway;
  private readonly whatsappManager?: WhatsAppSessionManager;
  private readonly whatsappOrchestrator?: WhatsAppOrchestrator;
  private readonly catalogService?: CatalogService;
  private readonly skillsManager?: SkillsManager;
  private readonly workspaceRoot?: string;
  private readonly maxTurns: number;
  private readonly customTools: Record<string, CustomToolExecutor>;
  private routineToolsDeps?: RoutineToolsDeps;
  private workflowToolExecutor?: WorkflowToolExecutor;
  private readonly includeWorkflowTools: boolean;
  private phase13Services?: Phase13ToolServices;
  private phase14Services: Phase14ToolServices;

  constructor(options: AgentRunnerOptions) {
    this.db = options.db;
    this.queue = options.queue;
    this.vault = options.vault;
    this.providers = options.providers;
    this.providerConnection = options.providerConnection;
    this.wsHub = options.wsHub;
    this.skillLoader = options.skillLoader ?? new SkillLoader([], options.workspaceRoot);
    this.memoryManager = options.memoryManager ?? new MemoryManager(options.db);
    this.handoffBus = options.handoffBus ?? new HandoffBus(options.db, options.queue, options.wsHub);
    this.browserService =
      options.browserService ??
      new BrowserAutomationService(
        options.db,
        options.vault,
        options.wsHub,
        options.workspaceRoot,
      );
    this.screenCapture = options.screenCapture;
    this.showcaseService = options.showcaseService;
    this.transcription = options.transcription;
    this.backupResolver = options.backupResolver ?? new BackupModelsResolver();
    this.mcpClients = options.mcpClients ?? [];
    this.mcpGateway = options.mcpGateway;
    this.whatsappManager = options.whatsappManager;
    this.whatsappOrchestrator = options.whatsappOrchestrator;
    this.catalogService = options.catalogService;
    this.skillsManager = options.skillsManager;
    this.workspaceRoot = options.workspaceRoot;
    this.maxTurns = options.maxTurns ?? 8;
    this.customTools = options.customTools ?? {};
    this.routineToolsDeps = options.routineToolsDeps;
    this.workflowToolExecutor = options.workflowToolExecutor;
    this.includeWorkflowTools = options.includeWorkflowTools ?? true;
    this.phase13Services = options.phase13Services;

    const defaultApiKeysBridge =
      options.phase14Services?.apiKeysBridge ?? new ApiKeysBridge(this.vault);
    const effectiveWorkspaceRoot = options.workspaceRoot ?? process.cwd();
    this.phase14Services = options.phase14Services ?? {
      db: this.db,
      wsHub: this.wsHub,
      memoryManager: this.memoryManager,
      handoffBus: this.handoffBus,
      apiKeysBridge: defaultApiKeysBridge,
      historySearch: new HistorySearchService({
        db: this.db,
        redactSecrets: (t) => defaultApiKeysBridge.redactSecretValues(t),
      }),
      libraryFolders: new LibraryFoldersService({
        db: this.db,
        workspaceRoot: effectiveWorkspaceRoot,
        wsHub: this.wsHub,
      }),
      visualPreview: new ChatVisualPreviewService({
        db: this.db,
        workspaceRoot: effectiveWorkspaceRoot,
      }),
      uiBlockRegistry: new UiBlockRegistry({
        db: this.db,
        wsHub: this.wsHub,
        apiKeysBridge: defaultApiKeysBridge,
      }),
    };

    seedDefaultAgents(this.db);
  }

  public setPhase13Services(services: Phase13ToolServices): void {
    this.phase13Services = services;
  }

  public setPhase14Services(services: Phase14ToolServices): void {
    this.phase14Services = services;
  }

  public setRoutineToolsDeps(deps: RoutineToolsDeps): void {
    this.routineToolsDeps = deps;
  }

  public setWorkflowToolExecutor(executor: WorkflowToolExecutor): void {
    this.workflowToolExecutor = executor;
  }

  private resolveTargetAgentId(tarefa: TarefaRegistro): string {
    if (tarefa.agente_id) return tarefa.agente_id;
    const mapaTipo: Record<string, string> = {
      planejamento: "estrategista",
      copy: "copywriter",
      post_individual: "designer_individual",
      carrossel: "designer_carrossel",
      anuncio: "designer_ads",
      stories: "designer_stories",
      identidade: "diretor_identidade",
      publicacao: "engenheiro_meta",
      metricas: "analista_metricas",
      entregaveis: "diretor_entregaveis",
      concorrentes: "inteligencia_competitiva",
      consistencia: "consistencia_visual",
      reels: "editor_video",
      faceless: "roteirista_faceless",
      talking_head: "roteirista_talking_head",
    };
    return mapaTipo[tarefa.tipo] ?? "estrategista";
  }

  private setAgentStatus(agenteId: string, status: "ocioso" | "trabalhando" | "pausado"): void {
    this.db.connection
      .prepare(`UPDATE projecao_agentes SET status = ?, atualizado_em = ? WHERE agente_id = ?;`)
      .run(status, new Date().toISOString(), agenteId);
  }

  private getAgentModel(agenteId: string): string {
    const row = this.db.connection
      .prepare(`SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as { modelo_padrao: string } | undefined;
    return row?.modelo_padrao ?? "gemini-2.5-pro";
  }

  private getDeps(): AgentRunnerDeps {
    return {
      db: this.db,
      queue: this.queue,
      vault: this.vault,
      providers: this.providers,
      providerConnection: this.providerConnection,
      wsHub: this.wsHub,
      skillLoader: this.skillLoader,
      memoryManager: this.memoryManager,
      handoffBus: this.handoffBus,
      browserService: this.browserService,
      screenCapture: this.screenCapture,
      showcaseService: this.showcaseService,
      transcription: this.transcription,
      backupResolver: this.backupResolver,
      mcpClients: this.mcpClients,
      mcpGateway: this.mcpGateway,
      whatsappManager: this.whatsappManager,
      whatsappOrchestrator: this.whatsappOrchestrator,
      catalogService: this.catalogService,
      skillsManager: this.skillsManager,
      workspaceRoot: this.workspaceRoot,
      maxTurns: this.maxTurns,
      customTools: this.customTools,
      routineToolsDeps: this.routineToolsDeps,
      workflowToolExecutor: this.workflowToolExecutor,
      includeWorkflowTools: this.includeWorkflowTools,
      phase13Services: this.phase13Services,
      phase14Services: this.phase14Services,
      resolveTargetAgentId: (t) => this.resolveTargetAgentId(t),
      setAgentStatus: (id, st) => this.setAgentStatus(id, st),
      getAgentModel: (id) => this.getAgentModel(id),
    };
  }

  public async runTask(
    tarefa: TarefaRegistro,
    runtimeContext?: AgentRunRuntimeContext
  ): Promise<AgentRunResult> {
    return await executeAgentRunTask(this.getDeps(), tarefa, runtimeContext);
  }
}
