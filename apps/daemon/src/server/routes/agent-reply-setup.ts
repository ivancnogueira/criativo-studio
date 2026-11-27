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
import { SkillLoader } from "../../engine/runner/skill-loader.ts";
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
  estimateTurnContextTokens,
  planTurnContext,
  resolveModelContextBudget,
  toolBelongsToScopes,
} from "../turn-context-planner.ts";
import { LazyToolRouter } from "../../engine/tools/lazy-tool-router.ts";
import type { StudioRoutesDeps } from "./route-helpers.ts";
import { safeJsonParse } from "./route-helpers.ts";
import type { ChatProgressReport } from "./agent-enrichment-helpers.ts";
import { isGreetingOrCapabilityQuestion } from "./chat-routing-helpers.ts";
import type { AgentReplyOptions, AgentReplyTarget, PreparedAgentReplySetup } from "./agent-reply-types.ts";

export async function prepareAgentReplySetup(
  deps: StudioRoutesDeps,
  agente: AgentReplyTarget,
  userPrompt: string,
  anexos: AnexoChat[],
  history: MensagemChat[],
  onProgress?: (evt: ChatProgressReport) => void,
  options?: AgentReplyOptions
): Promise<PreparedAgentReplySetup> {
  const turnStartedIso = new Date().toISOString();
  onProgress?.({
    fase: "iniciado",
    mensagem_status: `Preparando contexto para ${agente.nome}...`,
  });
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const config = safeJsonParse<Record<string, unknown>>(agente.config_json, {});
  const onboarding = deps.providerConnection.getOnboardingState();
  const skillSlug = typeof config.skill_slug === "string" ? config.skill_slug : agente.agente_id;
  const intentSourcePrompt = options?.originalUserPrompt ?? userPrompt;
  const greetingOrCapability = isGreetingOrCapabilityQuestion(intentSourcePrompt);

  const mcpTools = deps.mcpGateway
    ? await deps.mcpGateway.getToolsForAgent(agente.agente_id).catch(() => [])
    : [];
  const hasOpenBrowserTabs =
    (deps.browserService?.sessionManager?.listTabSummaries(agente.agente_id)?.length ?? 0) > 0;
  const hasActiveWakeups = Boolean(deps.phase13?.wakeupService?.hasActiveWakeups(agente.agente_id));
  const recentHistoryText = history
    .slice(-3)
    .map((m) => m.conteudo_markdown ?? "")
    .join("\n");

  const turnPlan = planTurnContext({
    userPrompt: intentSourcePrompt,
    agenteId: agente.agente_id,
    isGreetingOrCapability: greetingOrCapability,
    anexosCount: anexos.length,
    hasOpenBrowserTabs,
    hasActiveWakeups,
    hasWokenWaits: Boolean(options?.wokenWaitsBlock),
    isHandoff: Boolean(options?.isHandoff),
    isRoutine: Boolean(options?.isRoutine),
    channelOrigin: options?.channelOrigin,
    recentHistoryText,
    hasExternalMcps: mcpTools.length > 0,
  });

  const loadedSkill =
    !turnPlan.loadFullSkill || process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1"
      ? null
      : loadSkillPromptBySlug(skillSlug, undefined, workspaceRoot, {
          db: deps.db,
          licenseService: deps.licenseService,
          productRoot: deps.productRoot,
        });
  const linkedSkills = turnPlan.loadFullSkill
    ? new SkillLoader([], workspaceRoot).loadLinkedAgentSkills(deps.db, agente.agente_id)
    : [];

  // Em modo light, pula leitura de memórias e snippets pesados para evitar inchaço de tokens
  const memories =
    turnPlan.mode === "light"
      ? []
      : (deps.db.connection
          .prepare(`SELECT texto FROM projecao_agente_memorias WHERE agente_id = ? ORDER BY criado_em DESC LIMIT 8;`)
          .all(agente.agente_id) as Array<{ texto: string }>);

  const liveStudioContext = buildStudioLiveContext({
    db: deps.db,
    vault: deps.vault,
    providerConnection: deps.providerConnection,
    workspaceRoot,
    agenteId: agente.agente_id,
    memoryManager: deps.memoryManager,
    userPrompt,
    compact: turnPlan.compactLiveContext,
  });

  const promptBaseParts = [
    typeof config.prompt_base === "string" && config.prompt_base.length > 0
      ? config.prompt_base
      : `Você é ${agente.nome} (${agente.papel}) do CriativoOS para ${onboarding.marca_nome} (${onboarding.perfil_handle}).`,
    liveStudioContext,
  ];
  if (loadedSkill) {
    promptBaseParts.push(`Instruções oficiais da habilidade ${skillSlug}:\n${loadedSkill.body.slice(0, 2800)}`);
  }
  const extraLinkedSkills = linkedSkills.filter((s) => s.slug !== skillSlug || !loadedSkill);
  if (extraLinkedSkills.length > 0) {
    promptBaseParts.push(
      extraLinkedSkills
        .map((s) => `Habilidade vinculada ${s.name} (${s.slug}):\n${s.body.slice(0, 1800)}`)
        .join("\n\n")
    );
  }
  if (memories.length > 0) {
    promptBaseParts.push(`Memórias do agente:\n${memories.map((m) => `- ${m.texto}`).join("\n")}`);
  }
  if (agente.agente_id.startsWith("designer_") || agente.agente_id === "consistencia_visual") {
    promptBaseParts.push(
      "REGRA ANTI-ALUCINAÇÃO VISUAL: NUNCA responda ao usuário dizendo 'já estou processando/gerando a arte' ou prometendo mostrar a imagem em instantes sem realmente invocar a ferramenta `generate_image`. Se nenhuma arte nova foi gerada neste turno, invoque `generate_image` agora ou explique exatamente o impedimento técnico."
    );
  }

  // Ponte nativa para validação real da Meta Graph API (sem expor tokens)
  const lowerCheck = userPrompt.toLowerCase();
  const asksMetaValidation =
    agente.agente_id === "engenheiro_meta" &&
    /(validar|valida|valide|testar|teste|status|diagn[oó]stico|integra[cç][aã]o|meta|instagram|credencia)/i.test(
      lowerCheck
    );

  const graphVersion = resolveMetaGraphApiVersion();
  const canUseMetaTools = isAgentAuthorizedForStudioTool("validar_integracao_meta", agente.agente_id, {
    db: deps.db,
    vault: deps.vault,
    catalogService: deps.catalogService,
  });
  let metaValidationSummary: Awaited<ReturnType<typeof validateMetaIntegration>> | null = null;
  if (asksMetaValidation && deps.vault && canUseMetaTools) {
    const tMeta0 = Date.now();
    metaValidationSummary = await validateMetaIntegration(deps.vault, undefined, {
      nativeStore: deps.catalogService?.nativeStore,
    });
    const metaStep: PassoChat = {
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API ${graphVersion} validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · Estágio ${metaValidationSummary.estagio})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 80)}`,
      detalhes: JSON.stringify({
        tokenConfigurado: metaValidationSummary.detalhes.tokenConfigurado,
        accountIdConfigurado: metaValidationSummary.detalhes.accountIdConfigurado,
        graphApiOk: metaValidationSummary.detalhes.graphApiOk,
        username: metaValidationSummary.detalhes.username,
        followersCount: metaValidationSummary.detalhes.followersCount,
        mediaCount: metaValidationSummary.detalhes.mediaCount,
      }),
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: Date.now() - tMeta0,
    };
    onProgress?.({
      fase: "etapa",
      mensagem_status: metaValidationSummary.resumo,
      step: metaStep,
    });
    promptBaseParts.push(
      `## Resultado Real Executado Agora por validar_integracao_meta (Cofre SQLite + Graph API ${graphVersion})\n${JSON.stringify(
        metaValidationSummary,
        null,
        2
      )}\nBaseie sua resposta exclusivamente neste diagnóstico real sem jamais pedir ou exibir tokens.`
    );
  }

  if (
    deps.workflowStore &&
    deps.workflowEngine &&
    turnPlan.mode === "action" &&
    turnPlan.mcpScopes.includes("workflows")
  ) {
    promptBaseParts.push(
      `## Ferramentas de Workflow em Grafo Disponíveis\nVocê pode inspecionar, criar/editar, executar (completo ou parcial a partir de um nó) e consultar histórico de workflows pelas ferramentas: list_workflows, read_workflow, edit_workflow, delete_workflow, run_workflow e read_workflow_runs. Regra crítica de segurança: JAMAIS execute delete_workflow sem confirmação humana explícita prévia (confirmed_by_human: true).`
    );
  }
  if (
    (deps.phase13 || options?.wokenWaitsBlock) &&
    turnPlan.mode === "action" &&
    (turnPlan.mcpScopes.includes("schedule") || Boolean(options?.wokenWaitsBlock))
  ) {
    promptBaseParts.push(
      buildPhase13SystemGuidance({
        allowStartTask:
          !options?.threadId || options.threadId.startsWith("main:") || Boolean(options?.isRoutine),
        wokenWaitsBlock: options?.wokenWaitsBlock,
      }),
    );
  }
  if (options?.channelOrigin === "whatsapp") {
    promptBaseParts.push(
      "[CANAL WHATSAPP ATIVO] Você está respondendo no WhatsApp (tela de celular). Seja natural, direto e conciso (máximo 1 a 4 parágrafos curtos ou lista breve com •). NUNCA use tabelas Markdown (|...|), NUNCA use títulos com # ou ##, e evite blocos longos de texto. Use apenas *negrito* simples quando necessário. Se o conteúdo completo for extenso, envie primeiro o resumo objetivo e pergunte se deseja os detalhes.",
    );
  }

  const promptBase = promptBaseParts.join("\n\n");
  const activeScopeSet = new Set(turnPlan.mcpScopes);
  const effectiveMcpTools = turnPlan.includeExternalMcps ? mcpTools : [];
  const availableChatToolsMap = new Map<string, ToolDefinition>();
  if (turnPlan.mode === "action") {
    const studioRoutineTools = deps.routineToolsDeps ? ROUTINE_AGENT_TOOLS_SCHEMA : [];
    const studioWorkflowTools =
      deps.workflowStore && deps.workflowEngine ? getChatWorkflowToolCatalog() : [];
    const studioPhase13Tools = deps.phase13 ? PHASE13_TOOLS_SCHEMA : [];
    const studioPhase14Tools = deps.phase14 ? PHASE14_TOOLS_SCHEMA : [];
    const studioPhase15Tools =
      deps.browserService || deps.screenCapture || deps.showcaseService || deps.remoteClaimService
        ? PHASE15_TOOLS_SCHEMA
        : [];
    for (const t of [
      ...PHASE10_TOOL_DEFINITIONS,
      ...studioRoutineTools,
      ...studioWorkflowTools,
      ...studioPhase13Tools,
      ...studioPhase14Tools,
      ...studioPhase15Tools,
      ...effectiveMcpTools,
    ]) {
      if (HIDDEN_CATALOG_TOOL_NAMES.has(t.name)) {
        continue;
      }
      if (!toolBelongsToScopes(t.name, activeScopeSet)) {
        continue;
      }
      if (
        !isAgentAuthorizedForStudioTool(t.name, agente.agente_id, {
          db: deps.db,
          vault: deps.vault,
          catalogService: deps.catalogService,
          licenseService: deps.licenseService,
          workspaceRoot,
          productRoot: deps.productRoot,
        })
      ) {
        continue;
      }
      if (!availableChatToolsMap.has(t.name)) {
        availableChatToolsMap.set(t.name, t);
      }
    }
  }
  const rawAvailableChatTools = Array.from(availableChatToolsMap.values());
  const lazyToolsEnabled = config.lazy_tools_enabled !== false;
  const lazyToolRouter = new LazyToolRouter(rawAvailableChatTools, {
    enabled: lazyToolsEnabled,
    threshold: 20,
  });
  const availableChatTools = lazyToolRouter.selectExposedTools();
  const toolFallbackNames = availableChatTools.map((t) => t.name);
  const studioToolsPromptGuidance =
    availableChatTools.length > 0
      ? `\n\n## Ferramentas Nativas & MCP (${toolFallbackNames.length}${lazyToolRouter.isLazyActive() ? ` expostas de ${lazyToolRouter.getTotalIndexed()} indexadas` : ""})\nFerramentas autorizadas: ${toolFallbackNames.join(", ")}.${lazyToolRouter.isLazyActive() ? "\nUse `tool_search`, `tool_describe` e `tool_call` para descobrir e invocar ferramentas secundárias sob demanda." : ""}\nPrefira chamar diretamente via MCP \`criativo_studio\` quando expostas no runtime; se apenas texto estiver ativo, emita \`<tool_call>{"name":"nome","arguments":{...}}</tool_call>\`. Nunca invente dados ou negue acesso a uma ferramenta listada acima.`
      : "";

  const turnMcpEndpointOpts = {
    scopes: turnPlan.mcpScopes,
    includeExternalMcps: turnPlan.includeExternalMcps,
    threadId: options?.threadId ?? `main:${agente.agente_id}`,
    channelOrigin: options?.channelOrigin,
    whatsappContaId: options?.whatsappContaId ?? null,
    whatsappChatJid: options?.whatsappChatJid ?? null,
  };
  const turnAcpMcpServers =
    turnPlan.mode === "light"
      ? []
      : deps.providerConnection.buildCombinedAcpMcpServers(
          agente.agente_id,
          turnMcpEndpointOpts,
        );
  const turnCliMcpConfig =
    turnPlan.mode === "light"
      ? null
      : deps.providerConnection.buildClaudeMcpConfig(
          agente.agente_id,
          turnMcpEndpointOpts,
        );

  const governance = readAgentGovernance(deps.db, agente.agente_id);
  const initialModel = options?.overrideModel?.trim() || agente.modelo_padrao;
  const providerName = deps.providers.resolveProviderName(initialModel);

  let effectivePromptBase = promptBase;
  if (deps.phase13?.contextReset && config.auto_compact_enabled !== false) {
    const estTokens = estimateTurnContextTokens({
      systemPrompt: promptBase,
      historyTexts: history.map((m) => m.conteudo_markdown ?? ""),
      userPrompt,
      toolsCount: availableChatTools.length,
    });
    const compactOutcome = deps.phase13.contextReset.autoCompactIfNeeded({
      agenteId: agente.agente_id,
      threadId: options?.threadId ?? null,
      estimatedTokens: estTokens,
      maxContextTokens: resolveModelContextBudget(initialModel),
      thresholdRatio: 0.8,
    });
    if (compactOutcome.compacted && compactOutcome.summaryText) {
      effectivePromptBase = `${promptBase}\n\n[Resumo da Auto-Compactação]: ${compactOutcome.summaryText}`;
    }
  }
  const agService = deps.providerConnection.getAntigravityService();
  const [statusList, agSnapshot] = await Promise.all([
    deps.providerConnection.getProvidersStatus(false),
    agService.getLiveSnapshot(false),
  ]);
  const claudeOAuthStatus = statusList.find((item) => item.provedor === "claude");
  const openaiOAuthStatus = statusList.find((item) => item.provedor === "openai");
  const opencodeStatus = statusList.find((item) => item.provedor === "opencode");

  const hasAntigravityAccount = agSnapshot.contas.some((c) => c.estado === "conectado" || Boolean(c.token_valido));
  const hasClaudeOAuthAccount = Boolean(claudeOAuthStatus?.contas && claudeOAuthStatus.contas.length > 0);
  const hasOpenAIOAuthAccount = Boolean(openaiOAuthStatus?.contas && openaiOAuthStatus.contas.length > 0);

  const skillStep: PassoChat = {
    id: `step-${randomUUID().slice(0, 8)}`,
    ferramenta: `skill:${skillSlug}`,
    titulo:
      turnPlan.mode === "light"
        ? "Contexto leve carregado — skills e MCPs sob demanda"
        : loadedSkill
          ? `Habilidade ${skillSlug} carregada de SKILL.md (${loadedSkill.tokensEst} tokens)`
          : `Contexto do especialista ${agente.nome} carregado (${agente.modelo_padrao})`,
    status: "concluido",
    duracao_ms: 45,
  };
  const steps: PassoChat[] = [skillStep];
  if (metaValidationSummary) {
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API ${graphVersion} validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · @${metaValidationSummary.detalhes.username ?? "conectado"})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 90)}`,
      detalhes: metaValidationSummary.resumo,
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: 95,
    });
  }
  onProgress?.({
    fase: "etapa",
    mensagem_status:
      turnPlan.mode === "light"
        ? "Contexto leve carregado — preparando resposta..."
        : loadedSkill
          ? `Habilidade ${skillSlug} carregada — preparando execução...`
          : `Contexto de ${agente.nome} carregado...`,
    step: skillStep,
  });

  const turnId = options?.turnoId ?? `turn-${randomUUID().slice(0, 8)}`;
  const assertNotAborted = (): void => {
    if (options?.signal?.aborted) {
      const abortErr = new Error("Turno interrompido via AbortSignal.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
  };
  assertNotAborted();
  const sessionId = `chat:${agente.agente_id}`;

  if (loadedSkill) {
    recordSkillLoadUsage(deps.db, {
      agentId: agente.agente_id,
      sessionId,
      turnId,
      provider: hasAntigravityAccount ? "antigravity" : providerName,
      model: agente.modelo_padrao,
      skill: skillSlug,
      tokens: loadedSkill.tokensEst,
    });
  }

  if (anexos.length > 0) {
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "image_paths_attach",
      titulo: `${anexos.length} arquivo(s) anexado(s) para referência visual / ImagePaths`,
      detalhes: anexos.map((a) => a.caminho_relativo).join(", "),
      status: "concluido",
      duracao_ms: 28,
    });
  }
  return {
    turnStartedIso,
    workspaceRoot,
    config,
    onboarding,
    skillSlug,
    intentSourcePrompt,
    greetingOrCapability,
    loadedSkill,
    metaValidationSummary,
    graphVersion,
    promptBase: effectivePromptBase,
    availableChatTools,
    lazyToolRouter,
    studioToolsPromptGuidance,
    turnAcpMcpServers,
    turnCliMcpConfig,
    governance,
    initialModel,
    providerName,
    agService,
    statusList,
    agSnapshot,
    opencodeStatus,
    hasAntigravityAccount,
    hasClaudeOAuthAccount,
    hasOpenAIOAuthAccount,
    steps,
    turnId,
    assertNotAborted,
    sessionId,
  };
}
