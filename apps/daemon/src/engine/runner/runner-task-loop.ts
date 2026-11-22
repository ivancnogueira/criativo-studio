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
  NATIVE_TOOLS_SCHEMA,
  type AgentRunResult,
  type AgentRunRuntimeContext,
  type AgentRunnerDeps,
} from "./runner-types.ts";
import { executeAgentToolCall } from "./runner-tool-executor.ts";

export async function executeAgentRunTask(
  deps: AgentRunnerDeps,
    tarefa: TarefaRegistro,
    runtimeContext?: AgentRunRuntimeContext,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const agenteId = deps.resolveTargetAgentId(tarefa);
    deps.setAgentStatus(agenteId, "trabalhando");

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

    if (rotinaExecucaoId && !flowStepId && deps.routineToolsDeps) {
      deps.routineToolsDeps.executionService.markExecutionRunning(rotinaExecucaoId);
    }
    if (rotinaExecucaoId) {
      deps.providerConnection
        ?.getStudioMcpBridge()
        ?.registerRoutineExecutionFlags(rotinaExecucaoId, routineCtx.flags);
    }

    const generatedArtifacts: string[] = [];
    let stepIndex = 0;

    try {
      const essentialSnap = deps.memoryManager.getEssentialContextSnapshot(agenteId);
      const memories =
        essentialSnap.memorias.length > 0
          ? essentialSnap.memorias.map((m) =>
              m.escopo_site ? `[site:${m.escopo_site}] ${m.texto}` : m.texto,
            )
          : deps.memoryManager.listMemories(agenteId, 10).map((m) => m.texto);
      const linkedSkills = deps.skillLoader.loadLinkedAgentSkills(deps.db, agenteId);
      const compiledSkill = deps.skillLoader.loadAgentSkill(agenteId, {
        db: deps.db,
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
      const systemPrompt = deps.phase13Services || wokenWaitsBlock
        ? `${baseWithMemories}\n\n${buildPhase13SystemGuidance({ allowStartTask: !effectiveThreadId || Boolean(payloadRec.rotina_execucao_id), wokenWaitsBlock })}`
        : baseWithMemories;
      const governance = readAgentGovernance(deps.db, agenteId);
      const model = deps.getAgentModel(agenteId);
      let activeModel = model;

      const legacyMcpTools = deps.mcpClients.flatMap((c) => c.tools);
      const gatewayTools = deps.mcpGateway ? await deps.mcpGateway.getToolsForAgent(agenteId) : [];
      const availableToolsMap = new Map<string, ToolDefinition>();
      for (const tool of [
        ...NATIVE_TOOLS_SCHEMA,
        ...PHASE10_TOOL_DEFINITIONS,
        ...PHASE13_TOOLS_SCHEMA,
        ...PHASE14_TOOLS_SCHEMA,
        ...PHASE15_TOOLS_SCHEMA,
        ...ROUTINE_AGENT_TOOLS_SCHEMA,
        ...(deps.includeWorkflowTools ? WORKFLOW_TOOL_DEFINITIONS : []),
        ...legacyMcpTools,
        ...gatewayTools,
      ]) {
        if (
          !isAgentAuthorizedForStudioTool(tool.name, agenteId, {
            db: deps.db,
            vault: deps.vault,
            catalogService: deps.catalogService,
          })
        ) {
          continue;
        }
        if (!availableToolsMap.has(tool.name)) {
          availableToolsMap.set(tool.name, tool);
        }
      }
      const availableTools = Array.from(availableToolsMap.values());

      let routineHistoryBlock = "";
      if (rotinaExecucaoId) {
        try {
          const cutoffAt = readAgentContextCutoffAt(deps.db, agenteId);
          const recentRows = (cutoffAt
            ? deps.db.connection
                .prepare(
                  `SELECT autor_tipo, agente_id, texto, criado_em
                   FROM projecao_conversas_chat
                   WHERE canal_id = ? AND criado_em >= ?
                   ORDER BY criado_em DESC
                   LIMIT 6;`,
                )
                .all(`agente:${agenteId}`, cutoffAt)
            : deps.db.connection
                .prepare(
                  `SELECT autor_tipo, agente_id, texto, criado_em
                   FROM projecao_conversas_chat
                   WHERE canal_id = ?
                   ORDER BY criado_em DESC
                   LIMIT 6;`,
                )
                .all(`agente:${agenteId}`)) as Array<{
            autor_tipo: string;
            agente_id: string | null;
            texto: string;
            criado_em: string;
          }>;

          if (recentRows.length > 0) {
            const formatted = recentRows
              .reverse()
              .map((m) => {
                const who = m.autor_tipo === "usuario" ? "Usuário" : m.agente_id || "Agente";
                const excerpt = String(m.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
                return `- [${who} @ ${m.criado_em}]: ${excerpt}`;
              })
              .join("\n");
            routineHistoryBlock = `\n\n[Histórico recente da conversa deste agente]\n${formatted}`;
          }
        } catch {
          // Histórico opcional em rotinas
        }
      }

      const messages: ConversationMessage[] = [
        {
          role: "user",
          content: `Tarefa #${tarefa.tarefa_id} (${tarefa.tipo} via ${tarefa.canal_origem}): ${tarefa.titulo}\nPayload:\n${JSON.stringify(tarefa.payload, null, 2)}${routineHistoryBlock}`,
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
          resolvedClient = deps.providers.getClientForModel(targetModel);
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
                  deps.wsHub?.broadcast("thread:progress", {
                    agente_id: agenteId,
                    thread_id: effectiveThreadId,
                    turno_id: tarefa.tarefa_id,
                    fase: "chunk",
                    delta: evt.tokenChunk,
                  });
                } else {
                  deps.wsHub?.broadcast("agent:thought", {
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

        if (deps.providerConnection) {
          const provName = deps.providers.resolveProviderName(targetModel);
          const promptMessages = messages.map((m) => ({
            role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
            text: m.content,
          }));
          const effectiveAgentId = tarefa.agente_id ?? agenteId;
          const poolAcc = await deps.providerConnection
            .pickPoolAccount(provName, preferredAccountId)
            .catch(() => null);
          const effectiveAccId = preferredAccountId ?? poolAcc?.id ?? undefined;

          const endpointOpts = {
            ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
            ...(rotinaExecucaoId ? { execucaoId: rotinaExecucaoId } : {}),
          };

          if (provName === "opencode") {
            const ocRes = await deps.providerConnection.getOpenCodeService().executePrompt({
              modelId: targetModel,
              systemPrompt,
              messages: promptMessages,
              agentId: effectiveAgentId,
              mcpServers: deps.providerConnection.buildCombinedAcpMcpServers(
                effectiveAgentId,
                endpointOpts,
              ),
            });
            return { mode: "cli", text: ocRes.text };
          }
          if (provName === "claude" || provName === "openai") {
            const cliRes = await deps.providerConnection.getCliOAuthService().executeTurn({
              provedor: provName,
              modelId: targetModel,
              systemPrompt,
              messages: promptMessages,
              agentId: effectiveAgentId,
              preferredAccountId: effectiveAccId,
              mcpConfig: deps.providerConnection.buildClaudeMcpConfig(
                effectiveAgentId,
                endpointOpts,
              ),
            });
            return { mode: "cli", text: cliRes.text };
          }
          const agRes = await deps.providerConnection
            .getAntigravityService()
            .executeCodeAssistGenerate({
              model: targetModel,
              systemPrompt,
              messages: promptMessages,
              agentId: effectiveAgentId,
              mcpServers: deps.providerConnection.buildCombinedAcpMcpServers(
                effectiveAgentId,
                endpointOpts,
              ),
            });
          return { mode: "cli", text: agRes.text };
        }

        // Dispara erro original do registry caso não haja providerConnection nem client
        resolvedClient = deps.providers.getClientForModel(targetModel);
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

          deps.backupResolver.markModelCooldown(
            deps.providers.resolveProviderName(activeModel),
            activeModel,
          );
          const statuses = deps.providerConnection
            ? await deps.providerConnection.getProvidersStatus(false).catch(() => [])
            : [];
          const candidates = deps.backupResolver.resolveCandidates({
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
            deps.wsHub?.broadcast("agent:step", {
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
            deps.handoffBus.postChannelMessage({
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
              deps.backupResolver.markModelCooldown(candidate.provedor, candidate.modelo);
            }
          }
          throw lastErr;
        }
      };

      for (let turn = 0; turn < deps.maxTurns; turn++) {
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
          deps.wsHub?.broadcast("agent:step", {
            tarefa_id: tarefa.tarefa_id,
            agente_id: agenteId,
            ferramenta: call.name,
            input: call.arguments,
            step_index: stepIndex,
          });

          deps.handoffBus.postChannelMessage({
            tarefa_id: tarefa.tarefa_id,
            de_agente_id: agenteId,
            para_agente_id: null,
            tipo_mensagem: "ferramenta_log",
            conteudo: `Executou ferramenta ${call.name}`,
            artefatos: generatedArtifacts,
          });

          const output = await executeAgentToolCall(deps, call, {
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
        deps.queue.updateTaskStatus(tarefa.tarefa_id, "aguardando_aprovacao", {
          agente_id: agenteId,
          previews: generatedArtifacts,
          copy: finalText,
          duracao_ms: Date.now() - startedAt,
        });
        deps.wsHub?.broadcast("task:awaiting_approval", {
          tarefa_id: tarefa.tarefa_id,
          tipo: tarefa.tipo,
          previews: generatedArtifacts,
          copy: finalText,
        });
      } else {
        deps.queue.updateTaskStatus(tarefa.tarefa_id, "concluido", {
          agente_id: agenteId,
          texto: finalText,
          artefatos: generatedArtifacts,
          duracao_ms: Date.now() - startedAt,
        });
        deps.wsHub?.broadcast("task:completed", {
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

      if (rotinaExecucaoId && !flowStepId && deps.routineToolsDeps) {
        await deps.routineToolsDeps.executionService.completeRoutineTaskExecution({
          execucaoId: rotinaExecucaoId,
          finalText,
          artifacts: generatedArtifacts,
          noUpdateCalled: noUpdateEffective,
          failureReason,
        });
      }

      if (flowStepId && deps.routineToolsDeps?.flowsEngine) {
        await deps.routineToolsDeps.flowsEngine.onFlowStepTaskSettled({
          stepId: flowStepId,
          status: failureReason ? "failed" : "succeeded",
          output: failureReason || silenciada ? null : finalText,
          erro: failureReason,
        });
      }

      deps.memoryManager.commitTurnMutations(tarefa.tarefa_id, "completed");
      deps.memoryManager.addMemory(
        agenteId,
        `Tarefa '${tarefa.titulo}' (${tarefa.tipo}) concluída com ${generatedArtifacts.length} artefatos.`,
        "automatica"
      );
      deps.phase14Services.memoryReview?.recordCompletedTurn({
        agenteId,
        threadId: effectiveThreadId,
        lastMessageId: tarefa.tarefa_id,
      });

      if (
        (!effectiveThreadId || effectiveThreadId.startsWith("main:")) &&
        deps.phase13Services?.contextReset?.hasPendingReset(agenteId)
      ) {
        deps.phase13Services.contextReset.flushPendingResetIfIdle(
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
      deps.memoryManager.commitTurnMutations(tarefa.tarefa_id, "failed");
      const errMsg = err instanceof Error ? err.message : String(err);
      if (rotinaExecucaoId && !flowStepId && deps.routineToolsDeps) {
        await deps.routineToolsDeps.executionService
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
      if (flowStepId && deps.routineToolsDeps?.flowsEngine) {
        await deps.routineToolsDeps.flowsEngine
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
      if (rotinaExecucaoId) {
        deps.providerConnection
          ?.getStudioMcpBridge()
          ?.clearRoutineExecutionFlags(rotinaExecucaoId);
      }
      deps.setAgentStatus(agenteId, "ocioso");
    }
  }
