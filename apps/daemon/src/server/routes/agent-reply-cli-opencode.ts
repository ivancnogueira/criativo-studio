import { randomUUID, timingSafeEqual } from "node:crypto";
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
  BackupModelsResolver,
  isRetryableQuotaOrProviderError,
  MAX_BACKUP_MODELS,
  parseBackupModelsJson,
} from "../../engine/runner/backup-models-resolver.ts";
import { compactRecentHistory, runTextModelWorkflowToolLoop } from "./chat-routing-helpers.ts";
import type { ModelAttemptContext } from "./agent-reply-types.ts";

export async function tryCliOrOpenCodeAttempt(ctx: ModelAttemptContext): Promise<string | null> {
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
    preferredAccId,
    targetProvStatus,
    targetOpenCode,
  } = ctx;
  const {
    workspaceRoot,
    promptBase,
    studioToolsPromptGuidance,
    turnAcpMcpServers,
    turnCliMcpConfig,
    hasClaudeOAuthAccount,
    hasOpenAIOAuthAccount,
    steps,
    turnId,
    sessionId,
  } = setup;
  const { anexosGerados } = visual;

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
          signal: options?.signal,
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
              signal: options?.signal,
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
        if ((cliErr instanceof Error && cliErr.name === "AbortError") || options?.signal?.aborted) {
          throw cliErr;
        }
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
          signal: options?.signal,
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
                signal: options?.signal,
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
        if ((ocErr instanceof Error && ocErr.name === "AbortError") || options?.signal?.aborted) {
          throw ocErr;
        }
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

  return null;
}
