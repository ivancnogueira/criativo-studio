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
  isPhase10ExtensionTool,
  isPhase13ToolName,
  isPhase14ToolName,
  isPhase15ToolName,
  PHASE10_TOOL_DEFINITIONS,
  PHASE13_TOOLS_SCHEMA,
  PHASE14_TOOLS_SCHEMA,
  PHASE15_TOOLS_SCHEMA,
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

export type CustomToolExecutor = (
  args: Record<string, unknown>,
  context: { tarefa: TarefaRegistro; agenteId: string }
) => Promise<unknown>;

export type WorkflowToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  ctx: { tarefa: TarefaRegistro; agenteId: string }
) => Promise<unknown>;

export interface AgentRunnerOptions {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  vault: VaultService;
  providers: ProviderRegistry;
  providerConnection?: ProviderConnectionService;
  wsHub?: WebSocketHub;
  skillLoader?: SkillLoader;
  mcpClients?: McpClient[];
  mcpGateway?: McpGateway;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  catalogService?: CatalogService;
  skillsManager?: SkillsManager;
  workspaceRoot?: string;
  maxTurns?: number;
  customTools?: Record<string, CustomToolExecutor>;
  routineToolsDeps?: RoutineToolsDeps;
  workflowToolExecutor?: WorkflowToolExecutor;
  includeWorkflowTools?: boolean;
  phase13Services?: Phase13ToolServices;
  memoryManager?: MemoryManager;
  handoffBus?: HandoffBus;
  phase14Services?: Phase14ToolServices;
  browserService?: BrowserAutomationService;
  screenCapture?: ScreenCaptureBridge;
  showcaseService?: ShowcaseSiteService;
  transcription?: TranscriptionService;
  backupResolver?: BackupModelsResolver;
}

export interface AgentRunRuntimeContext {
  threadId?: string | null;
  signal?: AbortSignal;
  wokenWaitsBlock?: string | null;
  entregaOrigemId?: string;
}

export interface AgentRunResult {
  tarefaId: string;
  agenteId: string;
  turnsExecuted: number;
  finalText: string;
  generatedArtifacts: string[];
  awaitingApproval: boolean;
  silenciada?: boolean;
  failureReason?: string | null;
}

const NATIVE_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "generate_image",
    description:
      "Dispara a geração de imagem por IA usando Imagen 3 / Gemini / DALL-E / Flux com fotos e referências de entrada",
    parameters: {
      type: "object",
      properties: {
        aspect_ratio: { type: "string", enum: ["3:4", "9:16", "1:1"] },
        prompt: {
          type: "string",
          description:
            "Prompt estético detalhado incluindo iluminação, texturas e estilo da marca",
        },
        image_paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Caminhos locais para referências visuais, foto real do especialista e logo da marca",
        },
        facial_consistency: {
          type: "boolean",
          description:
            "Garante a preservação biométrica do rosto do sujeito de image_paths",
        },
        output_path: { type: "string" },
      },
      required: ["aspect_ratio", "prompt", "output_path"],
    },
  },
  {
    name: "exec_remotion_render",
    description: "Dispara o render do Remotion gerando MP4 1080x1920 a 30fps",
    parameters: {
      type: "object",
      properties: {
        composicao: { type: "string", enum: ["ReelsFaceless", "ReelsTalkingHead"] },
        audio_path: { type: "string" },
        legendas_srt_path: { type: "string" },
        output_path: { type: "string" },
      },
      required: ["composicao", "audio_path", "output_path"],
    },
  },
  {
    name: "crop_margem_segura",
    description:
      "Recorta e ajusta a imagem gerada com Sharp para 1080x1350 (3:4/4:5) ou 1080x1920 (9:16) preservando zonas seguras",
    parameters: {
      type: "object",
      properties: {
        input_path: { type: "string" },
        output_path: { type: "string" },
        aspect: { type: "string", enum: ["3:4", "4:5", "9:16", "1:1"] },
      },
      required: ["input_path", "output_path", "aspect"],
    },
  },
  {
    name: "handoff_agente",
    description:
      "Passa o bastão para outro agente especialista dos 15 disponíveis com instruções e artefatos produzidos",
    parameters: {
      type: "object",
      properties: {
        para_agente_id: { type: "string" },
        instrucao: { type: "string" },
        artefatos: { type: "array", items: { type: "string" } },
        enfileirar_proxima_tarefa: { type: "boolean" },
        tipo_proxima_tarefa: { type: "string" },
      },
      required: ["para_agente_id", "instrucao"],
    },
  },
  {
    name: "inspecionar_url",
    description: "Navega e extrai texto de referência pública usando o controlador browser headless",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "meta_publicar",
    description:
      "Publica criativo aprovado no Instagram via Meta Graph API (bloqueado se approved_by_human != true)",
    parameters: {
      type: "object",
      properties: {
        media_type: { type: "string", enum: ["IMAGE", "CAROUSEL", "REELS", "STORIES"] },
        media_urls: { type: "array", items: { type: "string" } },
        caption: { type: "string" },
        approved_by_human: { type: "boolean" },
      },
      required: ["media_type", "media_urls", "caption", "approved_by_human"],
    },
  },
];

/**
 * Executor Headless de Agentes: consome tarefas, carrega skill + memórias,
 * executa loop multi-turn com tool calling e emite eventos em tempo real no WebSocket.
 */
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

  private async executeToolCall(
    call: ToolCallRequest,
    context: {
      tarefa: TarefaRegistro;
      agenteId: string;
      generatedArtifacts: string[];
      routineCtx?: RoutineToolExecutionContext;
      runtimeContext?: AgentRunRuntimeContext;
      wokenWaitsBlock?: string | null;
    }
  ): Promise<unknown> {
    if (isPhase15ToolName(call.name)) {
      const payloadRec = (context.tarefa.payload ?? {}) as Record<string, unknown>;
      const resolvedThread =
        context.runtimeContext?.threadId ??
        context.tarefa.thread_id ??
        (typeof payloadRec.thread_id === "string" ? payloadRec.thread_id : null);
      const canalId =
        resolvedThread && !resolvedThread.startsWith("main:")
          ? `thread:${resolvedThread}`
          : `agente:${context.agenteId}`;
      const governance = readAgentGovernance(this.db, context.agenteId);
      const effectiveRoot = this.workspaceRoot ?? process.cwd();

      return await executePhase15ToolCall(
        call.name,
        call.arguments,
        {
          agenteId: context.agenteId,
          canalId,
          permissionLevel: governance.permissionLevel,
          browserProfileId: governance.browserProfileId,
          aprovadoPorHumano: Boolean(payloadRec.aprovadoPorHumano),
          generatedArtifacts: context.generatedArtifacts,
        },
        {
          db: this.db,
          wsHub: this.wsHub,
          workspaceRoot: effectiveRoot,
          browserService: this.browserService,
          screenCapture: this.screenCapture,
          showcaseService: this.showcaseService,
          transcription: this.transcription,
        },
      );
    }

    if (isPhase14ToolName(call.name)) {
      const payloadRec = (context.tarefa.payload ?? {}) as Record<string, unknown>;
      const resolvedThread =
        context.runtimeContext?.threadId ??
        context.tarefa.thread_id ??
        (typeof payloadRec.thread_id === "string" ? payloadRec.thread_id : null);
      const canalId =
        resolvedThread && !resolvedThread.startsWith("main:")
          ? `thread:${resolvedThread}`
          : `agente:${context.agenteId}`;
      const origemTurno =
        context.routineCtx?.turnOrigin === "webhook"
          ? "webhook"
          : context.routineCtx?.turnOrigin === "routine" ||
              context.routineCtx?.turnOrigin === "flow"
            ? "rotina"
            : payloadRec.inter_agent_origin
              ? "inter_agente"
              : "usuario_local";
      const hopDepth =
        typeof payloadRec.hop_depth === "number" ? payloadRec.hop_depth : 0;

      return await executePhase14ToolCall(
        call.name,
        call.arguments,
        {
          agenteId: context.agenteId,
          canalId,
          threadId: resolvedThread ?? `main:${context.agenteId}`,
          tarefaId: context.tarefa.tarefa_id,
          turnId: context.tarefa.tarefa_id,
          origemTurno,
          isOneToOneUserChat: canalId === `agente:${context.agenteId}` && origemTurno === "usuario_local",
          hopDepth,
          generatedArtifacts: context.generatedArtifacts,
        },
        this.phase14Services,
      );
    }
    if (isPhase13ToolName(call.name) && this.phase13Services) {
      const payloadRec = (context.tarefa.payload ?? {}) as Record<string, unknown>;
      const pedidoTexto =
        typeof payloadRec.tema === "string"
          ? payloadRec.tema
          : context.tarefa.titulo;
      const res = await executePhase13Tool(
        call.name,
        call.arguments,
        {
          agenteId: context.agenteId,
          turnoId: context.tarefa.tarefa_id,
          callId: call.id,
          threadId:
            context.runtimeContext?.threadId ??
            context.tarefa.thread_id ??
            `main:${context.agenteId}`,
          canalId: context.tarefa.thread_id
            ? `thread:${context.tarefa.thread_id}`
            : `agente:${context.agenteId}`,
          entregaOrigemId: context.runtimeContext?.entregaOrigemId ?? context.tarefa.tarefa_id,
          pedidoTexto,
          isRoutine: context.routineCtx?.turnOrigin === "routine",
          isResumingWait: Boolean(context.wokenWaitsBlock),
        },
        this.phase13Services,
      );
      if (res.handled) {
        return res.result;
      }
    }
    if (isRoutineToolName(call.name)) {
      if (!this.routineToolsDeps) {
        throw new Error("Sistema de rotinas ainda não inicializado neste runner.");
      }
      const ctx: RoutineToolExecutionContext = context.routineCtx ?? {
        agenteId: context.agenteId,
        turnOrigin: "human",
        execucaoId: null,
        flags: { noUpdateCalled: false, failureReason: null },
      };
      return await executeRoutineToolCall(call, ctx, this.routineToolsDeps);
    }
    if (isWorkflowToolName(call.name)) {
      if (!this.workflowToolExecutor) {
        throw new Error("Sistema de workflows ainda não inicializado neste runner.");
      }
      return await this.workflowToolExecutor(call.name, call.arguments, {
        tarefa: context.tarefa,
        agenteId: context.agenteId,
      });
    }
    if (this.customTools[call.name]) {
      const customResult = await this.customTools[call.name](call.arguments, {
        tarefa: context.tarefa,
        agenteId: context.agenteId,
      });
      if (
        customResult &&
        typeof customResult === "object" &&
        "output_path" in customResult &&
        typeof (customResult as { output_path: unknown }).output_path === "string"
      ) {
        context.generatedArtifacts.push(
          (customResult as { output_path: string }).output_path
        );
      }
      return customResult;
    }

    if (call.name === "generate_image") {
      const args = call.arguments as unknown as GenerateImageParams;
      const governance = readAgentGovernance(this.db, context.agenteId);
      const effectiveRoot = this.workspaceRoot ?? process.cwd();
      if (args.output_path) {
        assertAgentPermissionForPath({
          rawPath: args.output_path,
          workspaceRoot: effectiveRoot,
          permissionLevel: governance.permissionLevel,
          agenteId: context.agenteId,
          operation: "write",
        });
      }
      const res = await generateImageTool(args, { vault: this.vault });
      context.generatedArtifacts.push(res.output_path);
      return res;
    }

    if (call.name === "crop_margem_segura") {
      const args = call.arguments as {
        input_path: string;
        output_path: string;
        aspect: TargetAspect;
      };
      const governance = readAgentGovernance(this.db, context.agenteId);
      const effectiveRoot = this.workspaceRoot ?? process.cwd();
      assertAgentPermissionForPath({
        rawPath: args.output_path,
        workspaceRoot: effectiveRoot,
        permissionLevel: governance.permissionLevel,
        agenteId: context.agenteId,
        operation: "write",
      });
      const res = await processImageMarginsAndCrop({
        inputPath: args.input_path,
        outputPath: args.output_path,
        aspect: args.aspect,
      });
      context.generatedArtifacts.push(res.outputPath);
      return res;
    }

    if (call.name === "exec_remotion_render") {
      const args = call.arguments as unknown as RemotionRenderParams;
      const governance = readAgentGovernance(this.db, context.agenteId);
      const effectiveRoot = this.workspaceRoot ?? process.cwd();
      if (args.output_path) {
        assertAgentPermissionForPath({
          rawPath: args.output_path,
          workspaceRoot: effectiveRoot,
          permissionLevel: governance.permissionLevel,
          agenteId: context.agenteId,
          operation: "write",
        });
      }
      const res = await executeRemotionRender(args);
      context.generatedArtifacts.push(res.output_path);
      return res;
    }

    if (call.name === "handoff_agente") {
      const args = call.arguments as {
        para_agente_id: string;
        instrucao: string;
        artefatos?: string[];
        enfileirar_proxima_tarefa?: boolean;
        tipo_proxima_tarefa?: string;
      };
      return this.handoffBus.dispatchHandoff({
        tarefa_id: context.tarefa.tarefa_id,
        de_agente_id: context.agenteId,
        para_agente_id: args.para_agente_id,
        instrucao: args.instrucao,
        artefatos: args.artefatos ?? context.generatedArtifacts,
        enfileirarNovaTarefa: args.enfileirar_proxima_tarefa,
        tipoProximaTarefa: args.tipo_proxima_tarefa,
      });
    }

    if (call.name === "inspecionar_url") {
      const args = call.arguments as { url: string };
      return await this.browserService.inspectPublicPage({ url: args.url });
    }

    if (call.name === "meta_publicar") {
      const args = call.arguments as unknown as MetaPublishParams;
      return await metaPublishTool(args, { vault: this.vault });
    }

    if (isPhase10ExtensionTool(call.name)) {
      return await executeStudioExtensionTool(call.name, call.arguments, {
        db: this.db,
        vault: this.vault,
        wsHub: this.wsHub,
        workspaceRoot: this.workspaceRoot,
        agenteId: context.agenteId,
        canalId: null,
        mcpGateway: this.mcpGateway,
        catalogService: this.catalogService,
        skillsManager: this.skillsManager,
        whatsappManager: this.whatsappManager,
        whatsappOrchestrator: this.whatsappOrchestrator,
      });
    }

    for (const mcp of this.mcpClients) {
      if (call.name.startsWith(`mcp_${mcp.serverId}_`)) {
        return await mcp.callTool(call.name, call.arguments);
      }
    }

    if (call.name.startsWith("mcp_") && this.mcpGateway) {
      const gatewayResult = await this.mcpGateway.callMcpTool(call.name, call.arguments, {
        agentId: context.agenteId,
      });

      if (
        gatewayResult &&
        typeof gatewayResult === "object" &&
        (gatewayResult as { action?: unknown }).action === "sign_in"
      ) {
        const notice = gatewayResult as McpOAuthRequiredNotice;
        const sanitizedReason = redactMcpSecrets(notice.motivo, []);
        this.wsHub?.broadcast("mcp.oauth_solicitado", {
          mcp_id: notice.mcpId,
          nome: notice.nome,
          app_slug: notice.appSlug ?? null,
          authorize_url: notice.authorizeUrl ?? null,
          canal_id: null,
          agente_id: context.agenteId,
          motivo: sanitizedReason,
        });
        return redactMcpPayload(
          {
            ok: false,
            action: "sign_in",
            mcpId: notice.mcpId,
            nome: notice.nome,
            appSlug: notice.appSlug ?? null,
            authorizeUrl: notice.authorizeUrl ?? null,
            motivo: sanitizedReason,
            instrucao:
              "Oriente o usuário a clicar no cartão de autenticação OAuth no chat para conectar este servidor MCP.",
          },
          []
        );
      }

      return redactMcpPayload(gatewayResult, []);
    }

    throw new Error(`Ferramenta desconhecida: ${call.name}`);
  }

  /**
   * Executa uma tarefa completa em loop multi-turn até resposta final ou entrega para aprovação.
   */
  public async runTask(
    tarefa: TarefaRegistro,
    runtimeContext?: AgentRunRuntimeContext,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const agenteId = this.resolveTargetAgentId(tarefa);
    this.setAgentStatus(agenteId, "trabalhando");

    const payloadRec = (tarefa.payload ?? {}) as Record<string, unknown>;
    const effectiveThreadId =
      runtimeContext?.threadId ??
      tarefa.thread_id ??
      (typeof payloadRec.thread_id === "string" ? payloadRec.thread_id : null);
    const wokenWaitsBlock =
      runtimeContext?.wokenWaitsBlock ??
      (typeof payloadRec.woken_waits_block === "string" ? payloadRec.woken_waits_block : null);
    const assertNotAborted = (): void => {
      if (runtimeContext?.signal?.aborted) {
        const abortErr = new Error("Turno interrompido via AbortSignal.");
        abortErr.name = "AbortError";
        throw abortErr;
      }
    };
    const rotinaExecucaoId =
      typeof payloadRec.rotina_execucao_id === "string"
        ? payloadRec.rotina_execucao_id
        : null;
    const flowStepId =
      typeof payloadRec.routine_flow_step_id === "string"
        ? payloadRec.routine_flow_step_id
        : null;
    const turnOrigin: RoutineToolExecutionContext["turnOrigin"] =
      tarefa.canal_origem === "webhook"
        ? "webhook"
        : flowStepId
          ? "flow"
          : tarefa.canal_origem === "rotina_cron" || Boolean(rotinaExecucaoId)
            ? "routine"
            : "human";

    const routineCtx: RoutineToolExecutionContext = {
      agenteId,
      turnOrigin,
      execucaoId: rotinaExecucaoId,
      flags: {
        noUpdateCalled: false,
        failureReason: null,
      },
    };

    if (rotinaExecucaoId && !flowStepId && this.routineToolsDeps) {
      this.routineToolsDeps.executionService.markExecutionRunning(rotinaExecucaoId);
    }

    const generatedArtifacts: string[] = [];
    let stepIndex = 0;

    try {
      const essentialSnap = this.memoryManager.getEssentialContextSnapshot(agenteId);
      const memories =
        essentialSnap.memorias.length > 0
          ? essentialSnap.memorias.map((m) =>
              m.escopo_site ? `[site:${m.escopo_site}] ${m.texto}` : m.texto,
            )
          : this.memoryManager.listMemories(agenteId, 10).map((m) => m.texto);
      const linkedSkills = this.skillLoader.loadLinkedAgentSkills(this.db, agenteId);
      const compiledSkill = this.skillLoader.loadAgentSkill(agenteId, {
        db: this.db,
        memoriaContexto: memories,
      });
      const baseCompiledPrompt =
        linkedSkills.length > 0 && !compiledSkill.linkedSkills
          ? `${compiledSkill.systemPrompt}\n\n${linkedSkills
              .map((s) => `## Habilidade Vinculada: ${s.name} (${s.slug})\n${s.body}`)
              .join("\n\n")}`
          : compiledSkill.systemPrompt;
      const baseWithMemories = essentialSnap.contextBlock
        ? `${baseCompiledPrompt}\n\n${essentialSnap.contextBlock}`
        : baseCompiledPrompt;
      const systemPrompt = this.phase13Services || wokenWaitsBlock
        ? `${baseWithMemories}\n\n${buildPhase13SystemGuidance({ allowStartTask: !effectiveThreadId || Boolean(payloadRec.rotina_execucao_id), wokenWaitsBlock })}`
        : baseWithMemories;
      const governance = readAgentGovernance(this.db, agenteId);
      const model = this.getAgentModel(agenteId);
      let activeModel = model;

      const legacyMcpTools = this.mcpClients.flatMap((c) => c.tools);
      const gatewayTools = this.mcpGateway ? await this.mcpGateway.getToolsForAgent(agenteId) : [];
      const availableToolsMap = new Map<string, ToolDefinition>();
      for (const tool of [
        ...NATIVE_TOOLS_SCHEMA,
        ...PHASE10_TOOL_DEFINITIONS,
        ...PHASE13_TOOLS_SCHEMA,
        ...PHASE14_TOOLS_SCHEMA,
        ...PHASE15_TOOLS_SCHEMA,
        ...ROUTINE_AGENT_TOOLS_SCHEMA,
        ...(this.includeWorkflowTools ? WORKFLOW_TOOL_DEFINITIONS : []),
        ...legacyMcpTools,
        ...gatewayTools,
      ]) {
        if (!availableToolsMap.has(tool.name)) {
          availableToolsMap.set(tool.name, tool);
        }
      }
      const availableTools = Array.from(availableToolsMap.values());

      const messages: ConversationMessage[] = [
        {
          role: "user",
          content: `Tarefa #${tarefa.tarefa_id} (${tarefa.tipo} via ${tarefa.canal_origem}): ${tarefa.titulo}\nPayload:\n${JSON.stringify(tarefa.payload, null, 2)}`,
        },
      ];

      let finalText = "";
      let turnsExecuted = 0;

      const runSingleModelAttempt = async (
        targetModel: string,
        preferredAccountId?: string | null,
      ): Promise<
        | { mode: "provider"; result: Awaited<ReturnType<ReturnType<ProviderRegistry["getClientForModel"]>["streamTurn"]>> }
        | { mode: "cli"; text: string }
      > => {
        let resolvedClient: ReturnType<ProviderRegistry["getClientForModel"]> | null = null;
        try {
          resolvedClient = this.providers.getClientForModel(targetModel);
        } catch {
          resolvedClient = null;
        }

        if (resolvedClient) {
          const result = await resolvedClient.streamTurn(
            {
              model: targetModel,
              systemPrompt,
              messages,
              tools: availableTools,
            },
            (evt) => {
              if (evt.type === "thought" && evt.tokenChunk) {
                if (effectiveThreadId && !effectiveThreadId.startsWith("main:")) {
                  this.wsHub?.broadcast("thread:progress", {
                    agente_id: agenteId,
                    thread_id: effectiveThreadId,
                    turno_id: tarefa.tarefa_id,
                    fase: "chunk",
                    delta: evt.tokenChunk,
                  });
                } else {
                  this.wsHub?.broadcast("agent:thought", {
                    tarefa_id: tarefa.tarefa_id,
                    agente_id: agenteId,
                    token_chunk: evt.tokenChunk,
                  });
                }
              }
            },
          );
          return { mode: "provider", result };
        }

        if (this.providerConnection) {
          const provName = this.providers.resolveProviderName(targetModel);
          const promptMessages = messages.map((m) => ({
            role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
            text: m.content,
          }));
          const effectiveAgentId = tarefa.agente_id ?? agenteId;
          const poolAcc = await this.providerConnection
            .pickPoolAccount(provName, preferredAccountId)
            .catch(() => null);
          const effectiveAccId = preferredAccountId ?? poolAcc?.id ?? undefined;

          if (provName === "opencode") {
            const ocRes = await this.providerConnection.getOpenCodeService().executePrompt({
              modelId: targetModel,
              systemPrompt,
              messages: promptMessages,
              agentId: effectiveAgentId,
            });
            return { mode: "cli", text: ocRes.text };
          }
          if (provName === "claude" || provName === "openai") {
            const cliRes = await this.providerConnection.getCliOAuthService().executeTurn({
              provedor: provName,
              modelId: targetModel,
              systemPrompt,
              messages: promptMessages,
              preferredAccountId: effectiveAccId,
            });
            return { mode: "cli", text: cliRes.text };
          }
          const agRes = await this.providerConnection
            .getAntigravityService()
            .executeCodeAssistGenerate({
              model: targetModel,
              systemPrompt,
              messages: promptMessages,
              agentId: effectiveAgentId,
            });
          return { mode: "cli", text: agRes.text };
        }

        // Dispara erro original do registry caso não haja providerConnection nem client
        resolvedClient = this.providers.getClientForModel(targetModel);
        throw new Error(`Provedor indisponível para modelo ${resolvedClient ? targetModel : model}.`);
      };

      const executeWithBackupCascade = async (): Promise<
        | { mode: "provider"; result: Awaited<ReturnType<ReturnType<ProviderRegistry["getClientForModel"]>["streamTurn"]>> }
        | { mode: "cli"; text: string }
      > => {
        try {
          return await runSingleModelAttempt(activeModel, null);
        } catch (primaryErr) {
          const classified = isRetryableQuotaOrProviderError(primaryErr);
          if (
            !classified.retryable ||
            !governance.backupModels.automatic ||
            governance.backupModels.order.length === 0
          ) {
            throw primaryErr;
          }

          this.backupResolver.markModelCooldown(
            this.providers.resolveProviderName(activeModel),
            activeModel,
          );
          const statuses = this.providerConnection
            ? await this.providerConnection.getProvidersStatus(false).catch(() => [])
            : [];
          const candidates = this.backupResolver.resolveCandidates({
            primaryModel: activeModel,
            backupConfig: governance.backupModels,
            statuses,
          });

          if (candidates.length === 0) {
            throw primaryErr;
          }

          let lastErr: unknown = primaryErr;
          for (const candidate of candidates) {
            stepIndex += 1;
            const switchMsg = `Alternou para modelo reserva: ${candidate.modelo} (${candidate.provedor})`;
            this.wsHub?.broadcast("agent:step", {
              tarefa_id: tarefa.tarefa_id,
              agente_id: agenteId,
              ferramenta: "backup_model_failover",
              input: {
                de: activeModel,
                para: candidate.modelo,
                provedor: candidate.provedor,
                motivo: classified.reasonCode,
              },
              step_index: stepIndex,
            });
            this.handoffBus.postChannelMessage({
              tarefa_id: tarefa.tarefa_id,
              de_agente_id: agenteId,
              para_agente_id: null,
              tipo_mensagem: "ferramenta_log",
              conteudo: switchMsg,
              artefatos: generatedArtifacts,
            });

            try {
              const res = await runSingleModelAttempt(candidate.modelo, candidate.conta_id ?? null);
              activeModel = candidate.modelo;
              return res;
            } catch (candidateErr) {
              lastErr = candidateErr;
              this.backupResolver.markModelCooldown(candidate.provedor, candidate.modelo);
            }
          }
          throw lastErr;
        }
      };

      for (let turn = 0; turn < this.maxTurns; turn++) {
        assertNotAborted();
        turnsExecuted += 1;

        const attemptOut = await executeWithBackupCascade();
        assertNotAborted();

        if (attemptOut.mode === "cli") {
          finalText = attemptOut.text;
          break;
        }

        const turnResult = attemptOut.result;
        finalText = turnResult.text;

        if (turnResult.toolCalls.length === 0) {
          break;
        }

        messages.push({
          role: "assistant",
          content: turnResult.text,
          toolCalls: turnResult.toolCalls,
        });

        for (const call of turnResult.toolCalls) {
          stepIndex += 1;
          this.wsHub?.broadcast("agent:step", {
            tarefa_id: tarefa.tarefa_id,
            agente_id: agenteId,
            ferramenta: call.name,
            input: call.arguments,
            step_index: stepIndex,
          });

          this.handoffBus.postChannelMessage({
            tarefa_id: tarefa.tarefa_id,
            de_agente_id: agenteId,
            para_agente_id: null,
            tipo_mensagem: "ferramenta_log",
            conteudo: `Executou ferramenta ${call.name}`,
            artefatos: generatedArtifacts,
          });

          const output = await this.executeToolCall(call, {
            tarefa,
            agenteId,
            generatedArtifacts,
            routineCtx,
            runtimeContext,
            wokenWaitsBlock,
          });

          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify(output),
          });
        }
      }

      const awaitingApproval =
        generatedArtifacts.length > 0 ||
        ["carrossel", "post_individual", "stories", "reels", "anuncio"].includes(tarefa.tipo);

      if (awaitingApproval) {
        this.queue.updateTaskStatus(tarefa.tarefa_id, "aguardando_aprovacao", {
          agente_id: agenteId,
          previews: generatedArtifacts,
          copy: finalText,
          duracao_ms: Date.now() - startedAt,
        });
        this.wsHub?.broadcast("task:awaiting_approval", {
          tarefa_id: tarefa.tarefa_id,
          tipo: tarefa.tipo,
          previews: generatedArtifacts,
          copy: finalText,
        });
      } else {
        this.queue.updateTaskStatus(tarefa.tarefa_id, "concluido", {
          agente_id: agenteId,
          texto: finalText,
          artefatos: generatedArtifacts,
          duracao_ms: Date.now() - startedAt,
        });
        this.wsHub?.broadcast("task:completed", {
          tarefa_id: tarefa.tarefa_id,
          tempo_total_ms: Date.now() - startedAt,
        });
      }

      const trimmedLower = finalText.trim().toLowerCase();
      const silentMarker =
        trimmedLower === "[[no-update]]" || trimmedLower === "[silent]";
      const noUpdateEffective = routineCtx.flags.noUpdateCalled || silentMarker;
      const silenciada = noUpdateEffective && generatedArtifacts.length === 0;
      const failureReason = routineCtx.flags.failureReason;

      if (rotinaExecucaoId && !flowStepId && this.routineToolsDeps) {
        await this.routineToolsDeps.executionService.completeRoutineTaskExecution({
          execucaoId: rotinaExecucaoId,
          finalText,
          artifacts: generatedArtifacts,
          noUpdateCalled: noUpdateEffective,
          failureReason,
        });
      }

      if (flowStepId && this.routineToolsDeps?.flowsEngine) {
        await this.routineToolsDeps.flowsEngine.onFlowStepTaskSettled({
          stepId: flowStepId,
          status: failureReason ? "failed" : "succeeded",
          output: failureReason || silenciada ? null : finalText,
          erro: failureReason,
        });
      }

      this.memoryManager.commitTurnMutations(tarefa.tarefa_id, "completed");
      this.memoryManager.addMemory(
        agenteId,
        `Tarefa '${tarefa.titulo}' (${tarefa.tipo}) concluída com ${generatedArtifacts.length} artefatos.`,
        "automatica"
      );
      this.phase14Services.memoryReview?.recordCompletedTurn({
        agenteId,
        threadId: effectiveThreadId,
        lastMessageId: tarefa.tarefa_id,
      });

      if (
        (!effectiveThreadId || effectiveThreadId.startsWith("main:")) &&
        this.phase13Services?.contextReset?.hasPendingReset(agenteId)
      ) {
        this.phase13Services.contextReset.flushPendingResetIfIdle(
          agenteId,
          runtimeContext?.entregaOrigemId,
        );
      }

      return {
        tarefaId: tarefa.tarefa_id,
        agenteId,
        turnsExecuted,
        finalText,
        generatedArtifacts,
        awaitingApproval,
        silenciada,
        failureReason,
      };
    } catch (err) {
      this.memoryManager.commitTurnMutations(tarefa.tarefa_id, "failed");
      const errMsg = err instanceof Error ? err.message : String(err);
      if (rotinaExecucaoId && !flowStepId && this.routineToolsDeps) {
        await this.routineToolsDeps.executionService
          .completeRoutineTaskExecution({
            execucaoId: rotinaExecucaoId,
            finalText: "",
            artifacts: [],
            noUpdateCalled: false,
            failureReason: null,
            erro: errMsg,
          })
          .catch(() => {});
      }
      if (flowStepId && this.routineToolsDeps?.flowsEngine) {
        await this.routineToolsDeps.flowsEngine
          .onFlowStepTaskSettled({
            stepId: flowStepId,
            status: "failed",
            output: null,
            erro: errMsg,
          })
          .catch(() => {});
      }
      throw err;
    } finally {
      this.setAgentStatus(agenteId, "ocioso");
    }
  }
}
