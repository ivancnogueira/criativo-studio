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
  getDeletedNativeAgentsMeta,
  getSetupCompatibleRoster,
  markNativeAgentDeleted,
  ROSTER_15_AGENTES,
  SETUP_ASSISTANT_AGENT_DEF,
  unmarkNativeAgentDeleted,
} from "../../engine/runner/roster-defaults.ts";
import { mutateSidebarLayout } from "../sidebar-service.ts";
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
import type { StudioRouteContext } from "./route-helpers.ts";
import { sanitizeAvatarStyle, safeJsonParse, type BrandSummary } from "./route-helpers.ts";
import { enrichAgentRow } from "./agent-enrichment-helpers.ts";

export async function tryHandleAgentsLifecycleRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

  const agentUpdateMatch = path.match(/^\/api\/agentes\/([^/]+)$/);
  if (agentUpdateMatch && (method === "PUT" || method === "PATCH")) {
    const agenteId = decodeURIComponent(agentUpdateMatch[1]);
    const body = await readJsonBody(req);
    const existing = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1] | undefined;

    if (!existing) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const currentConfig = safeJsonParse<Record<string, unknown>>(existing.config_json, {});
    const incomingConfig =
      body.config && typeof body.config === "object"
        ? (body.config as Record<string, unknown>)
        : {};

    // Validação de pastas autorizadas fora do workspace (FS23-01)
    let nextAllowedFolders: AgentAllowedFolder[] | undefined;
    const rawFoldersInput =
      body.allowed_folders !== undefined
        ? body.allowed_folders
        : incomingConfig.allowed_folders !== undefined
          ? incomingConfig.allowed_folders
          : undefined;
    if (rawFoldersInput !== undefined) {
      const sanitized = sanitizeAllowedFoldersList(rawFoldersInput);
      if (!sanitized.ok) {
        sendJson(res, 400, { erro: sanitized.error });
        return true;
      }
      nextAllowedFolders = sanitized.folders;
    }

    // Validação de cor personalizada do balão de chat do agente
    const hasExplicitChatColor =
      body.chat_color !== undefined || incomingConfig.chat_color !== undefined;
    const rawChatColor =
      body.chat_color !== undefined ? body.chat_color : incomingConfig.chat_color;
    const nextChatColor =
      typeof rawChatColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(rawChatColor.trim())
        ? rawChatColor.trim().toUpperCase()
        : null;

    const rawAutoMem =
      body.auto_memory_enabled !== undefined
        ? body.auto_memory_enabled
        : incomingConfig.auto_memory_enabled;
    const hasExplicitAutoMem = typeof rawAutoMem === "boolean";

    const rawMarkedUnread =
      body.marked_unread !== undefined
        ? body.marked_unread
        : incomingConfig.marked_unread;
    const hasExplicitMarkedUnread = typeof rawMarkedUnread === "boolean";

    const rawBackupInput =
      body.backup_models && typeof body.backup_models === "object"
        ? (body.backup_models as Partial<BackupModelsConfig>)
        : incomingConfig.backup_models && typeof incomingConfig.backup_models === "object"
          ? (incomingConfig.backup_models as Partial<BackupModelsConfig>)
          : null;

    let nextBackupModelsJson = existing.backup_models_json ?? '{"automatic":false,"order":[]}';
    if (rawBackupInput) {
      const normalizedOrder: BackupModelChoice[] = [];
      if (Array.isArray(rawBackupInput.order)) {
        for (const item of rawBackupInput.order.slice(0, MAX_BACKUP_MODELS)) {
          if (item && typeof item === "object" && typeof item.modelo === "string" && item.modelo.trim()) {
            normalizedOrder.push({
              provedor: (typeof item.provedor === "string"
                ? item.provedor
                : deps.providers.resolveProviderName(item.modelo)) as ProviderName,
              modelo: item.modelo.trim(),
              conta_id: typeof item.conta_id === "string" ? item.conta_id : null,
            });
          }
        }
      }
      const prevParsed = parseBackupModelsJson(existing.backup_models_json);
      nextBackupModelsJson = JSON.stringify({
        automatic:
          typeof rawBackupInput.automatic === "boolean"
            ? rawBackupInput.automatic
            : prevParsed.automatic,
        order: Array.isArray(rawBackupInput.order) ? normalizedOrder : prevParsed.order,
      });
    }

    const rawPerm = body.permission_level ?? incomingConfig.permission_level ?? existing.permission_level;
    const nextPermissionLevel: PermissionLevel =
      rawPerm === "ask" || rawPerm === "full" || rawPerm === "workspace"
        ? rawPerm
        : "workspace";

    const nextAllowNewChat =
      typeof body.allow_new_chat === "boolean"
        ? body.allow_new_chat
        : typeof incomingConfig.allow_new_chat === "boolean"
          ? incomingConfig.allow_new_chat
          : existing.allow_new_chat !== 0;

    const rawAllowQuickAck =
      body.allow_quick_ack ??
      body.allow_quick_acknowledgement ??
      incomingConfig.allow_quick_ack ??
      incomingConfig.allow_quick_acknowledgement;
    const nextAllowQuickAck =
      typeof rawAllowQuickAck === "boolean" ? rawAllowQuickAck : existing.allow_quick_ack !== 0;

    const nextBrowserProfileId =
      body.browser_profile_id !== undefined
        ? typeof body.browser_profile_id === "string" && body.browser_profile_id.trim()
          ? body.browser_profile_id.trim()
          : null
        : incomingConfig.browser_profile_id !== undefined
          ? typeof incomingConfig.browser_profile_id === "string" &&
            incomingConfig.browser_profile_id.trim()
            ? incomingConfig.browser_profile_id.trim()
            : null
          : (existing.browser_profile_id ?? null);

    const rawNotif =
      body.notification_level ?? incomingConfig.notification_level ?? existing.notification_level;
    const nextNotificationLevel: AgentNotificationLevel =
      rawNotif === "mentions" || rawNotif === "muted" ? rawNotif : "all";

    const nextPinned =
      typeof body.pinned === "boolean"
        ? body.pinned
        : typeof incomingConfig.pinned === "boolean"
          ? incomingConfig.pinned
          : existing.pinned === 1;

    const nextHidden =
      typeof body.hidden === "boolean"
        ? body.hidden
        : typeof incomingConfig.hidden === "boolean"
          ? incomingConfig.hidden
          : existing.hidden === 1;

    const nextSectionId =
      body.section_id !== undefined
        ? typeof body.section_id === "string" && body.section_id.trim()
          ? body.section_id.trim()
          : null
        : incomingConfig.section_id !== undefined
          ? typeof incomingConfig.section_id === "string" && incomingConfig.section_id.trim()
            ? incomingConfig.section_id.trim()
            : null
          : (existing.section_id ?? null);

    const nextAvatarStyle =
      sanitizeAvatarStyle(body.avatar_style) ?? sanitizeAvatarStyle(incomingConfig.avatar_style);
    const nextAvatarVariant =
      typeof body.avatar_variant === "string" && body.avatar_variant.trim()
        ? body.avatar_variant.trim()
        : typeof incomingConfig.avatar_variant === "string" && incomingConfig.avatar_variant.trim()
          ? incomingConfig.avatar_variant.trim()
          : undefined;
    const hasExplicitAvatarImage =
      body.avatar_image_url !== undefined || incomingConfig.avatar_image_url !== undefined;
    const rawAvatarImage =
      body.avatar_image_url !== undefined ? body.avatar_image_url : incomingConfig.avatar_image_url;
    const nextAvatarImageUrl =
      typeof rawAvatarImage === "string" && rawAvatarImage.trim() ? rawAvatarImage.trim() : null;

    const nextConfig = {
      ...currentConfig,
      ...incomingConfig,
      ...(typeof body.effort === "string" ? { effort: body.effort } : {}),
      ...(typeof body.avatar_shape === "string" ? { avatar_shape: body.avatar_shape } : {}),
      ...(typeof body.avatar_color === "string" ? { avatar_color: body.avatar_color } : {}),
      ...(nextAvatarStyle ? { avatar_style: nextAvatarStyle } : {}),
      ...(nextAvatarVariant ? { avatar_variant: nextAvatarVariant } : {}),
      ...(hasExplicitAvatarImage ? { avatar_image_url: nextAvatarImageUrl } : {}),
      ...(hasExplicitChatColor ? { chat_color: nextChatColor } : {}),
      ...(nextAllowedFolders !== undefined ? { allowed_folders: nextAllowedFolders } : {}),
      ...(hasExplicitAutoMem ? { auto_memory_enabled: Boolean(rawAutoMem) } : {}),
      ...(hasExplicitMarkedUnread ? { marked_unread: Boolean(rawMarkedUnread) } : {}),
      ...(typeof body.prompt_base === "string" ? { prompt_base: body.prompt_base } : {}),
      ...(body.modo_ocupado === "steer" || body.modo_ocupado === "queue"
        ? { modo_ocupado: body.modo_ocupado }
        : {}),
      allow_new_chat: nextAllowNewChat,
      allow_quick_ack: nextAllowQuickAck,
      allow_quick_acknowledgement: nextAllowQuickAck,
      backup_models: parseBackupModelsJson(nextBackupModelsJson),
      permission_level: nextPermissionLevel,
      browser_profile_id: nextBrowserProfileId,
      notification_level: nextNotificationLevel,
      pinned: nextPinned,
      hidden: nextHidden,
      section_id: nextSectionId,
      ...(typeof body.task_limit === "number" && Number.isFinite(body.task_limit)
        ? { task_limit: Math.max(1, Math.min(4, Math.floor(body.task_limit))) }
        : {}),
    };

    const nextModel =
      typeof body.modelo_padrao === "string" ? body.modelo_padrao : existing.modelo_padrao;
    const nextNome = typeof body.nome === "string" ? body.nome : existing.nome;
    const nextPapel = typeof body.papel === "string" ? body.papel : existing.papel;

    db.connection
      .prepare(
        `UPDATE projecao_agentes SET
           nome = ?,
           papel = ?,
           modelo_padrao = ?,
           config_json = ?,
           backup_models_json = ?,
           permission_level = ?,
           allow_new_chat = ?,
           allow_quick_ack = ?,
           browser_profile_id = ?,
           notification_level = ?,
           pinned = ?,
           hidden = ?,
           section_id = ?,
           atualizado_em = ?
         WHERE agente_id = ?;`
      )
      .run(
        nextNome,
        nextPapel,
        nextModel,
        JSON.stringify(nextConfig),
        nextBackupModelsJson,
        nextPermissionLevel,
        nextAllowNewChat ? 1 : 0,
        nextAllowQuickAck ? 1 : 0,
        nextBrowserProfileId,
        nextNotificationLevel,
        nextPinned ? 1 : 0,
        nextHidden ? 1 : 0,
        nextSectionId,
        new Date().toISOString(),
        agenteId
      );

    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];

    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot, deps.licenseService) });
    return true;
  }

  if (method === "DELETE" && agentUpdateMatch) {
    const agenteId = decodeURIComponent(agentUpdateMatch[1]);
    const existing = db.connection
      .prepare(`SELECT agente_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { agente_id: string } | undefined;
    if (!existing) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const isNative = getSetupCompatibleRoster().some((a) => a.agente_id === agenteId);
    try {
      mutateSidebarLayout(db, { op: "set_pin", agentId: agenteId, pinned: false });
    } catch {
      // ignora caso agente não esteja nos pins
    }

    db.runInTransaction(() => {
      db.connection.prepare(`DELETE FROM projecao_agentes WHERE agente_id = ?;`).run(agenteId);
      if (isNative) {
        markNativeAgentDeleted(db, agenteId);
      }
    });

    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, agente_id: agenteId, nativo: isNative });
    return true;
  }

  const agentRestoreMatch = path.match(/^\/api\/agentes\/([^/]+)\/restaurar$/);
  if (method === "POST" && agentRestoreMatch) {
    const agenteId = decodeURIComponent(agentRestoreMatch[1]);
    const def = getSetupCompatibleRoster().find((a) => a.agente_id === agenteId);
    if (!def) {
      sendJson(res, 404, { erro: `Agente padrão '${agenteId}' não encontrado.` });
      return true;
    }
    const now = new Date().toISOString();
    const restoredConfig = {
      frente: def.frente,
      pacote: def.pacote,
      pasta: def.pasta,
      skill_slug: def.skill_slug,
      avatar_shape: def.avatar_shape,
      avatar_color: def.avatar_color,
      avatar_style: "classic" as const,
      avatar_variant: def.avatar_shape,
      avatar_image_url: null,
      chat_color: null,
      allowed_folders: [],
      auto_memory_enabled: true,
      marked_unread: false,
      effort: def.effort,
      ferramentas: def.ferramentas,
      prompt_base: def.prompt_base,
      customizado: false,
    };
    db.runInTransaction(() => {
      unmarkNativeAgentDeleted(db, agenteId);
      db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status,
             skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
           ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?)
           ON CONFLICT(agente_id) DO UPDATE SET
             nome = excluded.nome,
             papel = excluded.papel,
             modelo_padrao = excluded.modelo_padrao,
             config_json = excluded.config_json,
             atualizado_em = excluded.atualizado_em;`,
        )
        .run(
          def.agente_id,
          def.nome,
          def.papel,
          def.modelo_padrao,
          JSON.stringify(def.skills_paths),
          def.ordem_exibicao,
          JSON.stringify(restoredConfig),
          now,
        );
    });
    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot, deps.licenseService) });
    return true;
  }

  return false;
}
