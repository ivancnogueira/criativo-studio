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
import type { CriativoDatabase } from "../../database/client.ts";
import {
  getDeletedNativeAgentsMeta,
  getSetupCompatibleRoster,
  markNativeAgentDeleted,
  ROSTER_15_AGENTES,
  SETUP_ASSISTANT_AGENT_DEF,
  unmarkNativeAgentDeleted,
} from "../../engine/runner/roster-defaults.ts";
import { LicenseValidationError, type LicenseClientService } from "../../license/license-service.ts";
import {
  activateUpgradePackage,
  computeUnlockedAgentsSummary,
  evaluateAndSyncSetupCompletion,
  getBrandIdentity,
  hasConfiguredBrand,
  importBrandPdfFromBuffer,
  interpolateBrandPlaceholders,
  isSetupAssistantVisible,
  isVpsAssistantVisible,
  listUpgradePackages,
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
  syncBrandPlaceholdersInDatabase,
} from "../brand-onboarding-service.ts";
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
import { inferTipoUso, safeJsonParse, type BrandSummary, type StudioRoutesDeps } from "./route-helpers.ts";

export function enrichAgentRow(
  db: CriativoDatabase,
  row: {
    agente_id: string;
    nome: string;
    papel: string;
    modelo_padrao: string;
    status: string;
    skills_paths_json: string;
    memoria_resumo: string | null;
    ordem_exibicao: number;
    config_json: string;
    backup_models_json?: string | null;
    permission_level?: string | null;
    allow_new_chat?: number | null;
    allow_quick_ack?: number | null;
    browser_profile_id?: string | null;
    pinned?: number | null;
    hidden?: number | null;
    section_id?: string | null;
    notification_level?: string | null;
    atualizado_em: string;
  },
  workspaceRoot = process.cwd(),
  licenseService?: LicenseClientService,
  brand?: BrandSummary | null,
) {
  const canalId = `agente:${row.agente_id}`;
  const unreadRow = db.connection
    .prepare(
      `SELECT COUNT(*) as total FROM projecao_conversas_chat WHERE canal_id = ? AND lida = 0;`
    )
    .get(canalId) as { total: number };
  const lastRow = db.connection
    .prepare(
      `SELECT conteudo_markdown, criado_em FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC LIMIT 1;`
    )
    .get(canalId) as { conteudo_markdown: string; criado_em: string } | undefined;

  const def =
    ROSTER_15_AGENTES.find((a) => a.agente_id === row.agente_id) ??
    (row.agente_id === SETUP_ASSISTANT_AGENT_DEF.agente_id ? SETUP_ASSISTANT_AGENT_DEF : undefined);
  const parsedConfig = safeJsonParse<Record<string, unknown>>(row.config_json, {});
  const pacote = (
    parsedConfig.pacote === "bonus" || parsedConfig.pacote === "video"
      ? parsedConfig.pacote
      : def?.pacote ?? "base"
  ) as "base" | "bonus" | "video";
  const upgradeDesbloqueado = isUpgradeUnlocked(db, workspaceRoot, pacote, licenseService);
  const rawPromptBase =
    typeof parsedConfig.prompt_base === "string" && parsedConfig.prompt_base.trim().length > 0
      ? parsedConfig.prompt_base
      : def?.prompt_base ?? "";
  const activeBrand = brand && hasConfiguredBrand(brand) ? brand : null;
  const promptBase = activeBrand
    ? interpolateBrandPlaceholders(rawPromptBase, activeBrand)
    : rawPromptBase;
  const resolvedPapel = activeBrand
    ? interpolateBrandPlaceholders(row.papel, activeBrand)
    : row.papel;

  const backupModels = parseBackupModelsJson(row.backup_models_json);
  const permissionLevel: PermissionLevel =
    row.permission_level === "ask" || row.permission_level === "full"
      ? row.permission_level
      : "workspace";
  const allowNewChat = row.allow_new_chat !== 0;
  const allowQuickAck = row.allow_quick_ack !== 0;
  const browserProfileId = row.browser_profile_id ?? null;
  const notificationLevel: AgentNotificationLevel =
    row.notification_level === "mentions" || row.notification_level === "muted"
      ? row.notification_level
      : "all";
  const pinned = row.pinned === 1;
  const hidden = row.hidden === 1;
  const sectionId = row.section_id ?? null;

  const config = {
    ...parsedConfig,
    pacote,
    upgrade_desbloqueado: upgradeDesbloqueado,
    skill_slug: parsedConfig.skill_slug ?? def?.skill_slug,
    ferramentas: Array.isArray(parsedConfig.ferramentas)
      ? parsedConfig.ferramentas
      : def?.ferramentas ?? ["handoff_agente"],
    prompt_base: promptBase,
    backup_models: backupModels,
    permission_level: permissionLevel,
    allow_new_chat: allowNewChat,
    allow_quick_ack: allowQuickAck,
    allow_quick_acknowledgement: allowQuickAck,
    browser_profile_id: browserProfileId,
    notification_level: notificationLevel,
    pinned,
    hidden,
    section_id: sectionId,
  };

  const rawLastMessage = lastRow
    ? lastRow.conteudo_markdown.replace(/\s+/g, " ").slice(0, 96)
    : null;
  const resolvedLastMessage =
    rawLastMessage && activeBrand
      ? interpolateBrandPlaceholders(rawLastMessage, activeBrand)
      : rawLastMessage;

  const rawUnreadCount = Number(unreadRow?.total ?? 0);
  const naoLidasFinal =
    parsedConfig.marked_unread === true ? Math.max(1, rawUnreadCount) : rawUnreadCount;

  return {
    ...row,
    papel: resolvedPapel,
    config,
    backup_models: backupModels,
    permission_level: permissionLevel,
    allow_new_chat: allowNewChat,
    allow_quick_ack: allowQuickAck,
    browser_profile_id: browserProfileId,
    notification_level: notificationLevel,
    pinned,
    hidden,
    section_id: sectionId,
    nao_lidas: naoLidasFinal,
    ultima_mensagem: resolvedLastMessage,
    ultima_mensagem_em: lastRow?.criado_em ?? row.atualizado_em,
  };
}

export interface ChatProgressReport {
  fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
  mensagem_status?: string;
  step?: PassoChat;
  delta?: string;
}

/**
 * Sincroniza anexos gerados pelo agente neste turno no banco (`gerado` ou `video`),
 * garantindo exibição no chat inclusive quando criados via chamada HTTP ao MCP Bridge.
 */
export function syncTurnGeneratedMediaAttachments(
  db: CriativoDatabase,
  agenteId: string,
  turnStartedIso: string,
  anexosGerados: AnexoChat[],
): void {
  try {
    const existingIds = new Set(anexosGerados.map((a) => a.arquivo_id));
    const existingPaths = new Set(anexosGerados.map((a) => a.caminho_relativo));
    const rows = db.connection
      .prepare(
        `SELECT arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso
         FROM projecao_arquivos
         WHERE agente_id = ?
           AND tipo_uso IN ('gerado', 'video')
           AND criado_em >= ?
         ORDER BY criado_em ASC;`
      )
      .all(agenteId, turnStartedIso) as Array<{
      arquivo_id: string;
      nome_original: string;
      caminho_relativo: string;
      mime_type: string;
      tamanho_bytes: number;
      tipo_uso: string;
    }>;

    for (const row of rows) {
      if (existingIds.has(row.arquivo_id) || existingPaths.has(row.caminho_relativo)) {
        continue;
      }
      anexosGerados.push({
        arquivo_id: row.arquivo_id,
        nome: row.nome_original,
        caminho_relativo: row.caminho_relativo,
        url: `/api/arquivos/raw?path=${encodeURIComponent(row.caminho_relativo)}`,
        mime_type: row.mime_type,
        tamanho_bytes: row.tamanho_bytes,
        tipo_uso: row.tipo_uso === "video" ? "video" : "gerado",
      });
    }
  } catch {
    // ignora caso tabela não esteja disponível em cenários mínimos
  }
}
