import type {
  TarefaRegistro,
  ToolDefinition,
} from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../../database/client.ts";
import type { CatalogService } from "../../marketplace/catalog-service.ts";
import type { SkillsManager } from "../../marketplace/skills-manager.ts";
import type { McpGateway } from "../../mcp/mcp-gateway.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";
import type {
  Phase13ToolServices,
  Phase14ToolServices,
} from "../../server/studio-tools-bridge.ts";
import type { RoutineToolsDeps } from "../../routines/routine-agent-tools.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import type { McpClient } from "../providers/mcp-client.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { BrowserAutomationService } from "../tools/browser-automation.ts";
import type { ScreenCaptureBridge } from "../tools/screen-capture-bridge.ts";
import type { ShowcaseSiteService } from "../../server/showcase-service.ts";
import type { TranscriptionService } from "../../voice/transcription-service.ts";
import type { BackupModelsResolver } from "./backup-models-resolver.ts";
import type { HandoffBus } from "./handoff-bus.ts";
import type { MemoryManager } from "./memory-manager.ts";
import type { SkillLoader } from "./skill-loader.ts";

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

export const NATIVE_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "generate_image",
    description:
      "Dispara a geração de imagem por IA usando Gemini Nano Banana 2.1, OpenAI GPT Image 2.6/2.5 ou Flux com quantas referências você decidir enviar",
    parameters: {
      type: "object",
      properties: {
        aspect_ratio: { type: "string", enum: ["3:4", "9:16", "1:1", "16:9"] },
        prompt: {
          type: "string",
          description:
            "Prompt estético detalhado incluindo iluminação, texturas e estilo da marca",
        },
        image_paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Caminhos locais para quantas referências visuais desejar (fotos reais, referências estéticas e logo da marca)",
        },
        facial_consistency: {
          type: "boolean",
          description:
            "Garante a preservação biométrica do rosto do sujeito de image_paths",
        },
        engine: { type: "string", enum: ["gemini", "openai", "flux"] },
        model: { type: "string" },
        resolution: { type: "string", enum: ["1K", "2K", "4K"] },
        quality: { type: "string", enum: ["low", "medium", "high"] },
        output_path: { type: "string" },
      },
      required: ["aspect_ratio", "prompt", "output_path"],
    },
  },
  {
    name: "generate_video",
    description:
      "Gera vídeo MP4 com áudio nativo sincronizado via Gemini Omni 1.2 Flash (3 a 15s, até 6 imagens de referência)",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Direção de cena, movimento de câmera, ação e áudio/fala desejada" },
        aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
        duration_seconds: { type: "number", description: "Duração em segundos (3 a 15)" },
        resolution: { type: "string", enum: ["360p", "720p", "1080p", "4k"] },
        image_paths: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos locais de até 6 imagens de referência para consistência",
        },
        model: { type: "string" },
        output_path: { type: "string" },
      },
      required: ["prompt", "output_path"],
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

export interface AgentRunnerDeps {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  vault: VaultService;
  providers: ProviderRegistry;
  providerConnection?: ProviderConnectionService;
  wsHub?: WebSocketHub;
  skillLoader: SkillLoader;
  memoryManager: MemoryManager;
  handoffBus: HandoffBus;
  browserService: BrowserAutomationService;
  screenCapture?: ScreenCaptureBridge;
  showcaseService?: ShowcaseSiteService;
  transcription?: TranscriptionService;
  backupResolver: BackupModelsResolver;
  mcpClients: McpClient[];
  mcpGateway?: McpGateway;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  catalogService?: CatalogService;
  skillsManager?: SkillsManager;
  workspaceRoot?: string;
  maxTurns: number;
  customTools: Record<string, CustomToolExecutor>;
  routineToolsDeps?: RoutineToolsDeps;
  workflowToolExecutor?: WorkflowToolExecutor;
  includeWorkflowTools: boolean;
  phase13Services?: Phase13ToolServices;
  phase14Services: Phase14ToolServices;
  resolveTargetAgentId: (tarefa: TarefaRegistro) => string;
  setAgentStatus: (agenteId: string, status: "ocioso" | "trabalhando" | "pausado") => void;
  getAgentModel: (agenteId: string) => string;
  executeToolCall?: (
    call: import("@criativo/contracts").ToolCallRequest,
    context: any
  ) => Promise<unknown>;
}
