import { randomUUID, timingSafeEqual } from "node:crypto";
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

export async function tryAntigravityAttempt(ctx: ModelAttemptContext): Promise<string | null> {
  const {
    deps,
    agente,
    userPrompt,
    history,
    onProgress,
    options,
    setup,
    visual,
    execState,
    targetModel,
    preferredAccId,
    targetAntigravity,
  } = ctx;
  const {
    config,
    promptBase,
    studioToolsPromptGuidance,
    turnAcpMcpServers,
    agService,
    hasAntigravityAccount,
    steps,
    turnId,
    sessionId,
  } = setup;
  const { anexosGerados, labeledVisualAssets, resolvedImageDiskPaths } = visual;

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
}
