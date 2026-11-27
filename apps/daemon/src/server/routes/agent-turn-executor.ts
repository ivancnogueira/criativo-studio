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
import type { StudioRoutesDeps } from "./route-helpers.ts";
import { mapChatRow, safeJsonParse } from "./route-helpers.ts";
import { syncTurnGeneratedMediaAttachments, type ChatProgressReport } from "./agent-enrichment-helpers.ts";
import { prepareAgentReplySetup } from "./agent-reply-setup.ts";
import { prepareAndGenerateVisualAssets } from "./agent-reply-visual-intent.ts";
import { tryCliOrOpenCodeAttempt } from "./agent-reply-cli-opencode.ts";
import { tryApiKeyOrOllamaAttempt } from "./agent-reply-api-provider.ts";
import { tryAntigravityAttempt } from "./agent-reply-antigravity.ts";
import { promisesBackgroundContinuationWithoutHandle } from "../../providers/turn-stall-watchdog.ts";
import type { AgentReplyOptions, AgentReplyTarget } from "./agent-reply-types.ts";
import { generateAgentChatReply } from "./agent-reply-runner.ts";

/**
 * Executa um turno completo conversacional (chat principal ou sub-thread isolada)
 * respeitando `context_cutoff_at`, `AbortSignal`, ferramentas da Fase 13 e emissão WS isolada por `thread_id`.
 */
export async function executeAgentConversationTurn(params: {
  deps: StudioRoutesDeps;
  agente: Parameters<typeof generateAgentChatReply>[1];
  userPrompt: string;
  anexos?: AnexoChat[];
  threadId?: string | null;
  turnoId: string;
  signal?: AbortSignal;
  wokenWaitsBlock?: string | null;
  entregaOrigemId?: string;
  isRoutine?: boolean;
  isHandoff?: boolean;
  originalUserPrompt?: string;
  respostaParaMensagemId?: string | null;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  extraMetadados?: Record<string, unknown>;
  onProgress?: (prog: ChatProgressReport) => void;
}): Promise<{
  agentMsg: MensagemChat;
  reply: Awaited<ReturnType<typeof generateAgentChatReply>>;
}> {
  const { deps, agente } = params;
  const rawThread = params.threadId;
  const isSubThread = Boolean(rawThread && !rawThread.startsWith("main:"));
  const effectiveThreadId = isSubThread ? rawThread! : `main:${agente.agente_id}`;
  const canalId = isSubThread ? `thread:${effectiveThreadId}` : `agente:${agente.agente_id}`;

  const cutoffAt = isSubThread ? null : readAgentContextCutoffAt(deps.db, agente.agente_id);

  const historyRows = (isSubThread
    ? deps.db.connection
        .prepare(
          `
          SELECT * FROM projecao_conversas_chat
          WHERE thread_id = ?
            AND COALESCE(item_type, 'mensagem') = 'mensagem'
            AND COALESCE(status, 'completed') != 'streaming'
          ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC
          LIMIT 30;
        `,
        )
        .all(effectiveThreadId)
    : deps.db.connection
        .prepare(
          `
          SELECT * FROM projecao_conversas_chat
          WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
            AND COALESCE(item_type, 'mensagem') = 'mensagem'
            AND COALESCE(status, 'completed') != 'streaming'
            AND (? IS NULL OR criado_em > ?)
          ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC
          LIMIT 30;
        `,
        )
        .all(effectiveThreadId, canalId, cutoffAt, cutoffAt)) as Array<Parameters<typeof mapChatRow>[0]>;

  const history = historyRows.reverse().map((r) => mapChatRow(r, deps.db));
  const progressEmitter = (prog: ChatProgressReport): void => {
    params.onProgress?.(prog);
    if (isSubThread) {
      deps.wsHub.broadcast("thread:progress", {
        agente_id: agente.agente_id,
        thread_id: effectiveThreadId,
        turno_id: params.turnoId,
        ...prog,
      });
    } else {
      deps.wsHub.broadcast("chat:progress", {
        canal_id: canalId,
        agente_id: agente.agente_id,
        turno_id: params.turnoId,
        ...prog,
      });
    }
  };

  let reply: Awaited<ReturnType<typeof generateAgentChatReply>>;
  try {
    reply = await generateAgentChatReply(
      deps,
      agente,
      params.userPrompt,
      params.anexos ?? [],
      history,
      progressEmitter,
      {
        isHandoff: params.isHandoff,
        originalUserPrompt: params.originalUserPrompt,
        threadId: effectiveThreadId,
        turnoId: params.turnoId,
        signal: params.signal,
        wokenWaitsBlock: params.wokenWaitsBlock,
        entregaOrigemId: params.entregaOrigemId,
        isRoutine: params.isRoutine,
        channelOrigin: params.channelOrigin,
        whatsappContaId: params.whatsappContaId,
        whatsappChatJid: params.whatsappChatJid,
      },
    );
  } catch (err) {
    deps.memoryManager?.commitTurnMutations(params.turnoId, "failed");
    throw err;
  }

  if (isSubThread) {
    deps.wsHub.broadcast("thread:progress", {
      agente_id: agente.agente_id,
      thread_id: effectiveThreadId,
      turno_id: params.turnoId,
      fase: "concluido",
    });
  } else {
    deps.wsHub.broadcast("chat:progress", {
      canal_id: canalId,
      agente_id: agente.agente_id,
      turno_id: params.turnoId,
      fase: "concluido",
    });
  }

  const maxOrdRow = deps.db.connection
    .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
    .get(effectiveThreadId) as { max_ord: number };
  const nextOrdinal = maxOrdRow.max_ord + 1;
  const nowIso = new Date(Date.now() + 2).toISOString();

  const mergedMeta: Record<string, unknown> = {
    ...(params.extraMetadados ?? {}),
    ...(reply.usageLimitAsk ? { usage_limit_ask: reply.usageLimitAsk } : {}),
  };
  const replyMetadados: Record<string, unknown> | undefined =
    Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined;

  const agentMsg: MensagemChat = {
    mensagem_id: `msg-${randomUUID()}`,
    canal_id: canalId,
    agente_id: agente.agente_id,
    autor: "agente",
    autor_nome: agente.nome,
    conteudo_markdown: reply.markdown,
    anexos: reply.anexosGerados,
    steps: reply.steps,
    tarefa_id: reply.tarefaCriadaId,
    thread_id: effectiveThreadId,
    turno_id: params.turnoId,
    item_type: "mensagem",
    status: "completed",
    resposta_para_mensagem_id: params.respostaParaMensagemId ?? null,
    ordinal: nextOrdinal,
    ...(replyMetadados ? { metadados: replyMetadados } : {}),
    lida: true,
    criado_em: nowIso,
  };

  deps.db.connection
    .prepare(
      `
      INSERT INTO projecao_conversas_chat (
        mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
        anexos_json, steps_json, tarefa_id, lida, criado_em,
        thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
        ordinal, branch_origem_mensagem_id, metadados_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mensagem', 'completed', ?, ?, NULL, ?);
    `,
    )
    .run(
      agentMsg.mensagem_id,
      agentMsg.canal_id,
      agentMsg.agente_id,
      agentMsg.autor,
      agentMsg.autor_nome ?? agente.nome,
      agentMsg.conteudo_markdown,
      JSON.stringify(agentMsg.anexos),
      JSON.stringify(agentMsg.steps),
      agentMsg.tarefa_id ?? null,
      1,
      agentMsg.criado_em,
      effectiveThreadId,
      params.turnoId,
      agentMsg.resposta_para_mensagem_id ?? null,
      nextOrdinal,
      JSON.stringify(replyMetadados ?? {}),
    );

  if (isSubThread) {
    deps.wsHub.broadcast("thread:message", {
      agente_id: agente.agente_id,
      thread_id: effectiveThreadId,
      mensagem: agentMsg,
    });
  } else {
    deps.wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agente.agente_id,
      mensagem: agentMsg,
    });
  }

  deps.memoryManager?.commitTurnMutations(params.turnoId, "completed");
  deps.memoryReview?.recordCompletedTurn({
    agenteId: agente.agente_id,
    threadId: isSubThread ? effectiveThreadId : null,
    canalId,
    lastMessageId: agentMsg.mensagem_id,
    workSteps: reply.steps,
  });

  if (!isSubThread && deps.phase13?.contextReset.hasPendingReset(agente.agente_id)) {
    deps.phase13.contextReset.flushPendingResetIfIdle(agente.agente_id, params.entregaOrigemId);
  }

  const originTag = typeof params.extraMetadados?.origem === "string" ? params.extraMetadados.origem : "";
  const isAlreadySafetyWakeup =
    originTag === "background_safety_wakeup" ||
    params.userPrompt.includes("Verificação automática de continuidade:");
  if (
    !isAlreadySafetyWakeup &&
    originTag !== "background_job" &&
    deps.phase13?.wakeupService &&
    promisesBackgroundContinuationWithoutHandle(reply.markdown) &&
    !deps.phase13.backgroundJobService?.hasActiveJobs(agente.agente_id) &&
    !deps.phase13.wakeupService.hasActiveWakeups(agente.agente_id)
  ) {
    try {
      deps.phase13.wakeupService.scheduleWakeup(
        {
          agenteId: agente.agente_id,
          canalId,
          threadId: effectiveThreadId,
          channelOrigin: params.channelOrigin ?? "web",
          whatsappContaId: params.whatsappContaId ?? null,
          whatsappChatJid: params.whatsappChatJid ?? null,
        },
        {
          delaySeconds: 45,
          recurring: false,
          instruction:
            "Verificação automática de continuidade: na sua última resposta você indicou aguardar um processo em background concluir para prosseguir. Verifique agora se o processo ou arquivo já concluiu; se já terminou, continue imediatamente os próximos passos. Se ainda estiver rodando, use `start_background_job` ou `schedule_wakeup(delaySeconds: 60)` para monitorar até concluir.",
        },
      );
    } catch {
      // Rede de segurança não deve falhar o retorno do turno
    }
  }

  return { agentMsg, reply };
}
