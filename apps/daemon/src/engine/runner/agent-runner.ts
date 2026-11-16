import type {
  ConversationMessage,
  TarefaRegistro,
  ToolCallRequest,
  ToolDefinition,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import type { McpClient } from "../providers/mcp-client.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import { BrowserAutomationService } from "../tools/browser-automation.ts";
import { generateImageTool, type GenerateImageParams } from "../tools/generate-image.ts";
import { metaPublishTool, type MetaPublishParams } from "../tools/meta-publish.ts";
import { executeRemotionRender, type RemotionRenderParams } from "../tools/remotion-bridge.ts";
import { processImageMarginsAndCrop, type TargetAspect } from "../tools/sharp-pipeline.ts";
import { HandoffBus } from "./handoff-bus.ts";
import { MemoryManager } from "./memory-manager.ts";
import { seedDefaultAgents } from "./roster-defaults.ts";
import { SkillLoader } from "./skill-loader.ts";

export type CustomToolExecutor = (
  args: Record<string, unknown>,
  context: { tarefa: TarefaRegistro; agenteId: string }
) => Promise<unknown>;

export interface AgentRunnerOptions {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  vault: VaultService;
  providers: ProviderRegistry;
  wsHub?: WebSocketHub;
  skillLoader?: SkillLoader;
  mcpClients?: McpClient[];
  maxTurns?: number;
  customTools?: Record<string, CustomToolExecutor>;
}

export interface AgentRunResult {
  tarefaId: string;
  agenteId: string;
  turnsExecuted: number;
  finalText: string;
  generatedArtifacts: string[];
  awaitingApproval: boolean;
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
  private readonly wsHub?: WebSocketHub;
  private readonly skillLoader: SkillLoader;
  private readonly memoryManager: MemoryManager;
  private readonly handoffBus: HandoffBus;
  private readonly browserService: BrowserAutomationService;
  private readonly mcpClients: McpClient[];
  private readonly maxTurns: number;
  private readonly customTools: Record<string, CustomToolExecutor>;

  constructor(options: AgentRunnerOptions) {
    this.db = options.db;
    this.queue = options.queue;
    this.vault = options.vault;
    this.providers = options.providers;
    this.wsHub = options.wsHub;
    this.skillLoader = options.skillLoader ?? new SkillLoader();
    this.memoryManager = new MemoryManager(options.db);
    this.handoffBus = new HandoffBus(options.db, options.queue);
    this.browserService = new BrowserAutomationService(options.db);
    this.mcpClients = options.mcpClients ?? [];
    this.maxTurns = options.maxTurns ?? 8;
    this.customTools = options.customTools ?? {};

    seedDefaultAgents(this.db);
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
    context: { tarefa: TarefaRegistro; agenteId: string; generatedArtifacts: string[] }
  ): Promise<unknown> {
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

    for (const mcp of this.mcpClients) {
      if (call.name.startsWith(`mcp_${mcp.serverId}_`)) {
        return await mcp.callTool(call.name, call.arguments);
      }
    }

    throw new Error(`Ferramenta desconhecida: ${call.name}`);
  }

  /**
   * Executa uma tarefa completa em loop multi-turn até resposta final ou entrega para aprovação.
   */
  public async runTask(tarefa: TarefaRegistro): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const agenteId = this.resolveTargetAgentId(tarefa);
    this.setAgentStatus(agenteId, "trabalhando");

    const generatedArtifacts: string[] = [];
    let stepIndex = 0;

    try {
      const memories = this.memoryManager.listMemories(agenteId, 10).map((m) => m.texto);
      const compiledSkill = this.skillLoader.loadAgentSkill(agenteId, {
        memoriaContexto: memories,
      });
      const model = this.getAgentModel(agenteId);
      const client = this.providers.getClientForModel(model);

      const mcpTools = this.mcpClients.flatMap((c) => c.tools);
      const availableTools = [...NATIVE_TOOLS_SCHEMA, ...mcpTools];

      const messages: ConversationMessage[] = [
        {
          role: "user",
          content: `Tarefa #${tarefa.tarefa_id} (${tarefa.tipo} via ${tarefa.canal_origem}): ${tarefa.titulo}\nPayload:\n${JSON.stringify(tarefa.payload, null, 2)}`,
        },
      ];

      let finalText = "";
      let turnsExecuted = 0;

      for (let turn = 0; turn < this.maxTurns; turn++) {
        turnsExecuted += 1;

        const turnResult = await client.streamTurn(
          {
            model,
            systemPrompt: compiledSkill.systemPrompt,
            messages,
            tools: availableTools,
          },
          (evt) => {
            if (evt.type === "thought" && evt.tokenChunk) {
              this.wsHub?.broadcast("agent:thought", {
                tarefa_id: tarefa.tarefa_id,
                agente_id: agenteId,
                token_chunk: evt.tokenChunk,
              });
            }
          }
        );

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

      this.memoryManager.addMemory(
        agenteId,
        `Tarefa '${tarefa.titulo}' (${tarefa.tipo}) concluída com ${generatedArtifacts.length} artefatos.`,
        "automatica"
      );

      return {
        tarefaId: tarefa.tarefa_id,
        agenteId,
        turnsExecuted,
        finalText,
        generatedArtifacts,
        awaitingApproval,
      };
    } finally {
      this.setAgentStatus(agenteId, "ocioso");
    }
  }
}
