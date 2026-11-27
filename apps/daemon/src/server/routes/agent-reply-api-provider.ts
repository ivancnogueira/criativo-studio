import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  resolveMetaGraphApiVersion, type AgentAllowedFolder, type AgentNotificationLevel, type AnexoChat, type AprendizadoConfig, type ArquivoStudio, type AvatarStyle, type BackupModelChoice, type BackupModelsConfig, type CanalEquipe, type CanalMemoria, type CanalNavegadorModo, type ChatVisualMeta, type ConversationMessage, type ConversationUiBlock, type DeletedNativeAgentInfo, type MemoriaInclusao, type MemoryReviewAlteracao, type MensagemChat, type OnboardingEstado, type PassoChat, type PermissionLevel, type ProviderName, type SkillSugestaoItem, type ToolDefinition, type UiBlockSubmitPayload, type UsageLimitAskPayload, type WorkflowAresta, type WorkflowNo, type WorkflowTraco, type WorkflowVisual, } from "@criativo/contracts";
import type { McpGateway, McpOAuthRequiredNotice } from "../../mcp/mcp-gateway.ts";
import { redactMcpPayload, redactMcpSecrets } from "../../mcp/mcp-redaction.ts";
import {
  buildConnectorsList,
  computeHostAnalytics,
  importExternalTelemetryIfAvailable,
  listInstalledSkills,
  loadSkillPromptBySlug,
  recordChatTurnUsage,
  recordSkillLoadUsage,
} from "../analytics-skills-service.ts";
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
import { compactRecentHistory } from "./chat-routing-helpers.ts";
import { LAZY_META_TOOL_NAMES } from "../../engine/tools/lazy-tool-router.ts";
import { buildPortableChatMessages } from "../../engine/runner/handoff-history-builder.ts";
import type { ModelAttemptContext } from "./agent-reply-types.ts";

export async function tryApiKeyOrOllamaAttempt(ctx: ModelAttemptContext): Promise<string | null> {
  const {
    deps,
    agente,
    userPrompt,
    anexos,
    history,
    onProgress,
    options,
    setup,
    visual,
    execState,
    targetModel,
    targetProvider,
    targetVaultOrLocal,
  } = ctx;
  const {
    workspaceRoot,
    promptBase,
    availableChatTools,
    steps,
    turnId,
    assertNotAborted,
    sessionId,
  } = setup;
  const { tarefaCriadaId, anexosGerados } = visual;

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
        const turnMessages: ConversationMessage[] = ctx.handoffNote
          ? buildPortableChatMessages(history, agente.modelo_padrao, targetModel).messages
          : compactRecentHistory(history, 6, 1200).map((item) => ({
              role: item.role,
              content: item.text,
            }));
        if (ctx.handoffNote) {
          turnMessages.push({
            role: "user",
            content: `[Handoff de contexto]: ${ctx.handoffNote}`,
          });
        }
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
              const dispatchChatTool = async (
                tName: string,
                tArgs: Record<string, unknown>
              ): Promise<unknown> => {
                if (isPhase15ToolName(tName)) {
                  return await executePhase15ChatTool({
                    toolName: tName,
                    args: tArgs,
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
                }
                if (isPhase10ExtensionTool(tName)) {
                  return await executeStudioExtensionTool(tName, tArgs, {
                    db: deps.db,
                    vault: deps.vault,
                    wsHub: deps.wsHub,
                    workspaceRoot,
                    agenteId: agente.agente_id,
                    canalId: `agente:${agente.agente_id}`,
                    threadId: options?.threadId ?? `main:${agente.agente_id}`,
                    channelOrigin: options?.channelOrigin,
                    whatsappContaId: options?.whatsappContaId ?? null,
                    whatsappChatJid: options?.whatsappChatJid ?? null,
                    backgroundJobService: deps.phase13?.backgroundJobService,
                    mcpGateway: deps.mcpGateway,
                    catalogService: deps.catalogService,
                    nativeStore: deps.catalogService?.nativeStore,
                    providerConnection: deps.providerConnection,
                    skillsManager: deps.skillsManager,
                    whatsappManager: deps.whatsappManager,
                    whatsappOrchestrator: deps.whatsappOrchestrator,
                  });
                }
                if (isRoutineToolName(tName)) {
                  return await executeStudioRoutineTool(tName, tArgs, {
                    agenteId: agente.agente_id,
                    turnOrigin: "human",
                    routineToolsDeps: deps.routineToolsDeps,
                  });
                }
                if (isWorkflowToolName(tName)) {
                  return await executeChatWorkflowTool(tName, tArgs, {
                    store: deps.workflowStore,
                    engine: deps.workflowEngine,
                    wsHub: deps.wsHub,
                    agenteId: agente.agente_id,
                    requestSeed: turnId,
                  });
                }
                if (isPhase14ToolName(tName) && deps.phase14) {
                  return await executePhase14ToolCall(
                    tName,
                    tArgs,
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
                }
                if (isPhase13ToolName(tName) && deps.phase13) {
                  const p13 = await executePhase13Tool(
                    tName,
                    tArgs,
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
                      workspaceRoot,
                    },
                  );
                  return p13.result;
                }
                if (deps.mcpGateway && tName.startsWith("mcp_")) {
                  return await deps.mcpGateway.callMcpTool(tName, tArgs, {
                    agentId: agente.agente_id,
                  });
                }
                toolFailed = true;
                return { erro: `Ferramenta '${tName}' indisponível no contexto atual.` };
              };

              if (setup.lazyToolRouter && LAZY_META_TOOL_NAMES.has(call.name)) {
                toolOutput = await setup.lazyToolRouter.executeMetaTool(
                  call.name,
                  call.arguments,
                  dispatchChatTool
                );
              } else {
                toolOutput = await dispatchChatTool(call.name, call.arguments);
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

  return null;
}
