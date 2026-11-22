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

import type {
  AgentRunRuntimeContext,
  AgentRunnerDeps,
} from "./runner-types.ts";

export async function executeAgentToolCall(
  deps: AgentRunnerDeps,
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
      const governance = readAgentGovernance(deps.db, context.agenteId);
      const effectiveRoot = deps.workspaceRoot ?? process.cwd();

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
          db: deps.db,
          wsHub: deps.wsHub,
          workspaceRoot: effectiveRoot,
          browserService: deps.browserService,
          screenCapture: deps.screenCapture,
          showcaseService: deps.showcaseService,
          transcription: deps.transcription,
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
        deps.phase14Services,
      );
    }
    if (isPhase13ToolName(call.name) && deps.phase13Services) {
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
          channelOrigin:
            context.tarefa.canal_origem === "whatsapp" ? "whatsapp" : "web",
        },
        {
          ...deps.phase13Services,
          db: deps.db,
        },
      );
      if (res.handled) {
        return res.result;
      }
    }
    if (isRoutineToolName(call.name)) {
      if (!deps.routineToolsDeps) {
        throw new Error("Sistema de rotinas ainda não inicializado neste runner.");
      }
      const ctx: RoutineToolExecutionContext = context.routineCtx ?? {
        agenteId: context.agenteId,
        turnOrigin: "human",
        execucaoId: null,
        flags: { noUpdateCalled: false, failureReason: null },
      };
      return await executeRoutineToolCall(call, ctx, deps.routineToolsDeps);
    }
    if (isWorkflowToolName(call.name)) {
      if (!deps.workflowToolExecutor) {
        throw new Error("Sistema de workflows ainda não inicializado neste runner.");
      }
      return await deps.workflowToolExecutor(call.name, call.arguments, {
        tarefa: context.tarefa,
        agenteId: context.agenteId,
      });
    }
    if (deps.customTools[call.name]) {
      const customResult = await deps.customTools[call.name](call.arguments, {
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
      const governance = readAgentGovernance(deps.db, context.agenteId);
      const effectiveRoot = deps.workspaceRoot ?? process.cwd();
      if (args.output_path) {
        assertAgentPermissionForPath({
          rawPath: args.output_path,
          workspaceRoot: effectiveRoot,
          permissionLevel: governance.permissionLevel,
          agenteId: context.agenteId,
          operation: "write",
          allowedFolders: governance.allowedFolders,
        });
      }
      const res = await generateImageTool(args, { vault: deps.vault });
      context.generatedArtifacts.push(res.output_path);
      return res;
    }

    if (call.name === "generate_video") {
      const args = call.arguments as unknown as GenerateVideoParams;
      const governance = readAgentGovernance(deps.db, context.agenteId);
      const effectiveRoot = deps.workspaceRoot ?? process.cwd();
      if (args.output_path) {
        assertAgentPermissionForPath({
          rawPath: args.output_path,
          workspaceRoot: effectiveRoot,
          permissionLevel: governance.permissionLevel,
          agenteId: context.agenteId,
          operation: "write",
          allowedFolders: governance.allowedFolders,
        });
      }
      const res = await generateVideoTool(args, { vault: deps.vault });
      context.generatedArtifacts.push(res.output_path);
      return res;
    }

    if (call.name === "crop_margem_segura") {
      const args = call.arguments as {
        input_path: string;
        output_path: string;
        aspect: TargetAspect;
      };
      const governance = readAgentGovernance(deps.db, context.agenteId);
      const effectiveRoot = deps.workspaceRoot ?? process.cwd();
      assertAgentPermissionForPath({
        rawPath: args.output_path,
        workspaceRoot: effectiveRoot,
        permissionLevel: governance.permissionLevel,
        agenteId: context.agenteId,
        operation: "write",
        allowedFolders: governance.allowedFolders,
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
      const governance = readAgentGovernance(deps.db, context.agenteId);
      const effectiveRoot = deps.workspaceRoot ?? process.cwd();
      if (args.output_path) {
        assertAgentPermissionForPath({
          rawPath: args.output_path,
          workspaceRoot: effectiveRoot,
          permissionLevel: governance.permissionLevel,
          agenteId: context.agenteId,
          operation: "write",
          allowedFolders: governance.allowedFolders,
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
      return deps.handoffBus.dispatchHandoff({
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
      return await deps.browserService.inspectPublicPage({ url: args.url });
    }

    if (call.name === "meta_publicar") {
      if (
        !isAgentAuthorizedForStudioTool("meta_publicar", context.agenteId, {
          db: deps.db,
          vault: deps.vault,
          catalogService: deps.catalogService,
        })
      ) {
        throw new Error(
          `Acesso bloqueado: o agente '${context.agenteId}' não tem permissão ao aplicativo nativo 'Instagram / Meta' na Loja.`
        );
      }
      const args = call.arguments as unknown as MetaPublishParams;
      return await metaPublishTool(args, {
        vault: deps.vault,
        db: deps.db,
        nativeStore: deps.catalogService?.nativeStore,
      });
    }

    if (isPhase10ExtensionTool(call.name)) {
      return await executeStudioExtensionTool(call.name, call.arguments, {
        db: deps.db,
        vault: deps.vault,
        wsHub: deps.wsHub,
        workspaceRoot: deps.workspaceRoot,
        agenteId: context.agenteId,
        canalId: null,
        mcpGateway: deps.mcpGateway,
        catalogService: deps.catalogService,
        nativeStore: deps.catalogService?.nativeStore,
        providerConnection: deps.providerConnection,
        skillsManager: deps.skillsManager,
        whatsappManager: deps.whatsappManager,
        whatsappOrchestrator: deps.whatsappOrchestrator,
      });
    }

    for (const mcp of deps.mcpClients) {
      if (call.name.startsWith(`mcp_${mcp.serverId}_`)) {
        return await mcp.callTool(call.name, call.arguments);
      }
    }

    if (call.name.startsWith("mcp_") && deps.mcpGateway) {
      const gatewayResult = await deps.mcpGateway.callMcpTool(call.name, call.arguments, {
        agentId: context.agenteId,
      });

      if (
        gatewayResult &&
        typeof gatewayResult === "object" &&
        (gatewayResult as { action?: unknown }).action === "sign_in"
      ) {
        const notice = gatewayResult as McpOAuthRequiredNotice;
        const sanitizedReason = redactMcpSecrets(notice.motivo, []);
        deps.wsHub?.broadcast("mcp.oauth_solicitado", {
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
