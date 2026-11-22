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
import { buildPortableChatMessages } from "../../engine/runner/handoff-history-builder.ts";
import type { StudioRoutesDeps } from "./route-helpers.ts";
import { mapChatRow, safeJsonParse } from "./route-helpers.ts";
import { syncTurnGeneratedMediaAttachments, type ChatProgressReport } from "./agent-enrichment-helpers.ts";
import { prepareAgentReplySetup } from "./agent-reply-setup.ts";
import { prepareAndGenerateVisualAssets } from "./agent-reply-visual-intent.ts";
import { tryCliOrOpenCodeAttempt } from "./agent-reply-cli-opencode.ts";
import { tryApiKeyOrOllamaAttempt } from "./agent-reply-api-provider.ts";
import { tryAntigravityAttempt } from "./agent-reply-antigravity.ts";
import type { AgentReplyOptions, AgentReplyTarget } from "./agent-reply-types.ts";

export async function generateAgentChatReply(
  deps: StudioRoutesDeps,
  agente: AgentReplyTarget,
  userPrompt: string,
  anexos: AnexoChat[],
  history: MensagemChat[],
  onProgress?: (evt: ChatProgressReport) => void,
  options?: AgentReplyOptions
): Promise<{
  markdown: string;
  steps: PassoChat[];
  tarefaCriadaId: string | null;
  anexosGerados: AnexoChat[];
  usageLimitAsk?: UsageLimitAskPayload;
}> {
  const setup = await prepareAgentReplySetup(deps, agente, userPrompt, anexos, history, onProgress, options);
  const visual = await prepareAndGenerateVisualAssets({
    deps,
    agente,
    userPrompt,
    anexos,
    history,
    onProgress,
    options,
    setup,
  });

  const {
    turnStartedIso,
    config,
    onboarding,
    skillSlug,
    metaValidationSummary,
    graphVersion,
    governance,
    initialModel,
    providerName,
    agSnapshot,
    statusList,
    opencodeStatus,
    hasAntigravityAccount,
    steps,
  } = setup;
  const { tarefaCriadaId, anexosGerados } = visual;

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
    handoffNote?: string | null,
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

    const attemptCtx = {
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
      targetVaultOrLocal,
      targetOpenCode,
      targetAntigravity,
      handoffNote,
    };
    const cliRes = await tryCliOrOpenCodeAttempt(attemptCtx);
    if (cliRes !== null) return cliRes;

    const apiRes = await tryApiKeyOrOllamaAttempt(attemptCtx);
    if (apiRes !== null) return apiRes;

    const agRes = await tryAntigravityAttempt(attemptCtx);
    if (agRes !== null) return agRes;

    return null;
  };

  const finalizeTurnAnexos = (): AnexoChat[] => {
    syncTurnGeneratedMediaAttachments(deps.db, agente.agente_id, turnStartedIso, anexosGerados);
    return anexosGerados;
  };

  const preferredAcc =
    options?.overrideAccountId !== undefined
      ? options.overrideAccountId
      : typeof config.provider_account_id === "string"
        ? config.provider_account_id
        : null;

  const primaryReplyText = await invokeModelAttempt(initialModel, preferredAcc);
  if (primaryReplyText !== null) {
    return { markdown: primaryReplyText, steps, tarefaCriadaId, anexosGerados: finalizeTurnAnexos() };
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

        const portableHandoff = buildPortableChatMessages(
          history,
          initialModel,
          candidate.modelo,
        );
        const backupText = await invokeModelAttempt(
          candidate.modelo,
          candidate.conta_id ?? null,
          portableHandoff.handoffNotice,
        );
        if (backupText !== null) {
          return { markdown: backupText, steps, tarefaCriadaId, anexosGerados: finalizeTurnAnexos() };
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
        anexosGerados: finalizeTurnAnexos(),
        usageLimitAsk,
      };
    }
  }

  if (metaValidationSummary) {
    const det = metaValidationSummary.detalhes;
    const metaReportMarkdown = [
      `### Diagnóstico Oficial da Integração Meta (Cofre AES-256-GCM + Graph API ${graphVersion})`,
      "",
      `| Componente | Status | Detalhe |`,
      `|---|---|---|`,
      `| Token Meta no Cofre SQLite | ${det.tokenConfigurado ? "✅ Configurado" : "❌ Ausente"} | Criptografado localmente (nunca exposto) |`,
      `| Instagram Business Account ID | ${det.accountIdConfigurado ? "✅ Configurado" : "❌ Ausente"} | ID validado no Cofre |`,
      `| Meta Graph API ${graphVersion} | ${det.graphApiOk ? `✅ HTTP ${det.httpStatus} OK` : `❌ Falha${det.httpStatus ? ` HTTP ${det.httpStatus}` : ""}`} | ${det.graphApiOk ? `Perfil @${det.username ?? "ativo"}` : det.erro ?? "Erro na consulta"} |`,
      "",
      `**Estágio atual:** ${metaValidationSummary.estagio} — ${metaValidationSummary.resumo}`,
    ].join("\n");
    return { markdown: metaReportMarkdown, steps, tarefaCriadaId, anexosGerados: finalizeTurnAnexos() };
  }

  // 5. Resposta honesta: diferencia erro técnico em provedor conectado vs ausência real de conexão
  if (options?.channelOrigin === "whatsapp") {
    const readyAnexos = finalizeTurnAnexos();
    const cleanErr = execState.hadConnectedRoute
      ? `Não consegui concluir a chamada em *${agente.modelo_padrao}* (${providerName}): ${(execState.lastExecutionError ?? "sem resposta do servidor").slice(0, 140)}. Tente novamente em instantes ou revise a conta em Conexões.`
      : `O modelo *${agente.modelo_padrao}* (${providerName}) ainda não está conectado no Criativo Studio. Conecte uma conta em Conexões e tente novamente.`;
    return {
      markdown: `*${agente.nome}*: ${cleanErr}`,
      steps,
      tarefaCriadaId,
      anexosGerados: readyAnexos,
    };
  }

  const readyAnexos = finalizeTurnAnexos();
  const statusLabel = execState.hadConnectedRoute ? "Falha na chamada" : "Não conectado";
  const detailLine = execState.hadConnectedRoute
    ? `Erro técnico ao executar **${agente.modelo_padrao}** (${providerName}): \`${execState.lastExecutionError ?? "sem resposta do servidor"}\`. Tente novamente ou reautentique sua conta em **Conexões**.`
    : readyAnexos.length > 0
      ? `Mídia gerada e salva em \`${readyAnexos[0].caminho_relativo}\`.`
      : `Nenhum provedor conectado para o modelo **${agente.modelo_padrao}** (\`${providerName}\`). Abra **Conexões** e clique para conectar via navegador (Google, Claude ou ChatGPT), utilize modelos gratuitos do **OpenCode** ou salve uma API Key.`;

  const structuredFallback = [
    `**${agente.nome}** recebeu sua solicitação para **${onboarding.marca_nome}** (\`${onboarding.perfil_handle}\`):`,
    "",
    `> ${userPrompt.slice(0, 200)}`,
    "",
    "| Etapa do Plano | Ação | Status |",
    "|---|---|---|",
    `| 1. Diagnóstico | Contexto de \`${skillSlug}\` (${agente.modelo_padrao}) | Pronto |`,
    `| 2. Execução IA | ${readyAnexos.length > 0 ? `Mídia gerada em \`${readyAnexos[0].caminho_relativo}\`` : execState.hadConnectedRoute ? `Falha técnica: ${(execState.lastExecutionError ?? "erro").slice(0, 70)}` : "Aguardando conta conectada ou API Key"} | ${readyAnexos.length > 0 ? "Concluído" : statusLabel} |`,
    `| 3. Segurança Meta | Aprovação humana obrigatória antes da publicação | Ativo |`,
    "",
    detailLine,
  ].join("\n");

  return { markdown: structuredFallback, steps, tarefaCriadaId, anexosGerados: readyAnexos };
}

export { executeAgentConversationTurn } from "./agent-turn-executor.ts";
