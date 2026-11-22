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
import { LicenseValidationError, type LicenseClientService } from "../../license/license-service.ts";
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
import type { StudioRouteContext } from "./route-helpers.ts";
import { safeJsonParse } from "./route-helpers.ts";

export async function tryHandleSkillsBrandConnectorsRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;

  // 1. Onboarding
  if (method === "GET" && path === "/api/onboarding") {
    const synced = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);
    sendJson(res, 200, {
      onboarding: synced.onboarding,
      setup_assistant_visible: synced.setup_assistant_visible,
    });
    return true;
  }

  if ((method === "PUT" || method === "PATCH") && path === "/api/onboarding") {
    const body = await readJsonBody(req);
    providerConnection.updateOnboardingState(body as Partial<OnboardingEstado>);
    const synced = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);
    syncBrandPlaceholdersInDatabase(db, getBrandIdentity(providerConnection));
    wsHub.broadcast("onboarding:updated", {
      onboarding: synced.onboarding,
      setup_assistant_visible: synced.setup_assistant_visible,
    });
    sendJson(res, 200, {
      onboarding: synced.onboarding,
      setup_assistant_visible: synced.setup_assistant_visible,
    });
    return true;
  }

  if (method === "POST" && path === "/api/onboarding/setup-assistant") {
    const body = await readJsonBody(req);
    const action = body.action === "reopen" ? "reopen" : "dismiss";
    const result = setSetupAssistantState(db, providerConnection, workspaceRoot, action);
    wsHub.broadcast("onboarding:updated", result);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (method === "POST" && path === "/api/servers/vps-assistant") {
    const body = await readJsonBody(req);
    const action = body.action === "reopen" ? "reopen" : "dismiss";
    const result = setVpsAssistantState(db, providerConnection, action);
    wsHub.broadcast("vps_assistant:updated", result);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (method === "GET" && path === "/api/habilidades") {
    sendJson(res, 200, {
      habilidades: listInstalledSkills(db, undefined, workspaceRoot, deps.licenseService, deps.productRoot),
    });
    return true;
  }

  const skillDetailMatch = path.match(/^\/api\/habilidades\/([^/]+)$/);
  if (method === "GET" && skillDetailMatch) {
    const slug = decodeURIComponent(skillDetailMatch[1]);
    const loaded = loadSkillPromptBySlug(slug, undefined, workspaceRoot, {
      db,
      licenseService: deps.licenseService,
      productRoot: deps.productRoot,
    });
    if (!loaded) {
      sendJson(res, 404, { erro: `Habilidade '${slug}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { slug, caminho: loaded.path, conteudo: loaded.body });
    return true;
  }

  // Marca & Onboarding Estratégico (6 Marcos)
  if (method === "GET" && path === "/api/marca/identidade") {
    sendJson(res, 200, { identidade: getBrandIdentity(providerConnection) });
    return true;
  }

  if (method === "PUT" && path === "/api/marca/identidade") {
    const body = await readJsonBody(req);
    const updated = await saveBrandIdentity(providerConnection, workspaceRoot, body, db);
    sendJson(res, 200, { identidade: updated, onboarding: providerConnection.getOnboardingState() });
    return true;
  }

  // Upgrades Modulares (Bônus & Vídeo em Etapas)
  if (method === "GET" && path === "/api/upgrades") {
    sendJson(res, 200, { upgrades: listUpgradePackages(db, workspaceRoot, deps.licenseService) });
    return true;
  }

  if (method === "POST" && path === "/api/upgrades/instalar") {
    const body = await readJsonBody(req);
    if (body.pacote !== "bonus" && body.pacote !== "video") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'pacote' ('bonus' ou 'video')." });
      return true;
    }
    try {
      const upgrades = await activateUpgradePackage(db, workspaceRoot, body.pacote, deps.licenseService);
      wsHub.broadcast("provider:updated", {
        provedor: "gemini",
        conectado: true,
        modo: "assinatura",
      });
      sendJson(res, 200, { ok: true, upgrades });
    } catch (err) {
      if (err instanceof LicenseValidationError) {
        sendJson(res, err.statusCode, { erro: err.message, code: err.code });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path === "/api/conectores") {
    if (!deps.vault) {
      sendJson(res, 200, { conectores: [] });
      return true;
    }
    sendJson(res, 200, { conectores: buildConnectorsList(db, deps.vault) });
    return true;
  }

  const conectorActionMatch = path.match(/^\/api\/conectores\/([^/]+)\/(configurar|testar)$/);
  if (method === "POST" && conectorActionMatch) {
    const conectorId = decodeURIComponent(conectorActionMatch[1]);
    const acao = conectorActionMatch[2];
    const body = await readJsonBody(req);

    if (acao === "configurar") {
      if (typeof body.agente_orquestrador_id === "string") {
        const curCfg = providerConnection.getStudioConfig<Record<string, string>>("conectores_orquestradores", {});
        curCfg[conectorId] = body.agente_orquestrador_id;
        providerConnection.setStudioConfig("conectores_orquestradores", curCfg);
      }
      if (deps.vault && body.segredos && typeof body.segredos === "object") {
        for (const [k, v] of Object.entries(body.segredos as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim().length > 0) {
            const val = v.trim();
            deps.vault.setSecret(k, val);
            // Sincroniza aliases Meta para compatibilidade entre UI, Chat e CLI
            if (k === "instagram_access_token") deps.vault.setSecret("META_ACCESS_TOKEN", val);
            if (k === "META_ACCESS_TOKEN") deps.vault.setSecret("instagram_access_token", val);
            if (k === "instagram_business_account_id") deps.vault.setSecret("META_IG_USER_ID", val);
            if (k === "META_IG_USER_ID") deps.vault.setSecret("instagram_business_account_id", val);
          }
        }
      }
      if (conectorId === "mcp" && typeof body.nome === "string" && typeof body.comando === "string") {
        const mcpId = `mcp-${randomUUID().slice(0, 8)}`;
        db.connection
          .prepare(
            `INSERT INTO projecao_mcp_servidores (mcp_id, nome, comando, args_json, env_json, ativo, atualizado_em)
             VALUES (?, ?, ?, ?, ?, 1, ?);`
          )
          .run(
            mcpId,
            body.nome.trim(),
            body.comando.trim(),
            JSON.stringify(Array.isArray(body.args) ? body.args : []),
            JSON.stringify(body.env && typeof body.env === "object" ? body.env : {}),
            new Date().toISOString()
          );
      }
      const lista = deps.vault ? buildConnectorsList(db, deps.vault) : [];
      sendJson(res, 200, { ok: true, conectores: lista });
      return true;
    }

    // acao === "testar"
    if (conectorId === "instagram" && deps.vault) {
      const report = await validateMetaIntegration(deps.vault);
      if (!report.detalhes.tokenConfigurado || !report.detalhes.accountIdConfigurado) {
        sendJson(res, 400, { ok: false, mensagem: "Preencha Access Token e Business Account ID antes de testar." });
        return true;
      }
      sendJson(res, 200, {
        ok: report.ok,
        mensagem: report.ok
          ? `Conectado a @${report.detalhes.username ?? "conta_business"}`
          : report.resumo,
        detalhes: report.detalhes,
      });
      return true;
    }

    if (conectorId === "telegram" && deps.vault) {
      const botToken = deps.vault.getSecret("telegram_bot_token");
      if (!botToken) {
        sendJson(res, 400, { ok: false, mensagem: "Salve o Telegram Bot Token antes de testar." });
        return true;
      }
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const tgJson = (await tgRes.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
        sendJson(res, 200, {
          ok: Boolean(tgJson.ok),
          mensagem: tgJson.ok ? `Bot @${tgJson.result?.username ?? "ativo"} respondendo` : tgJson.description ?? "Token rejeitado",
        });
        return true;
      } catch (err) {
        sendJson(res, 200, { ok: false, mensagem: err instanceof Error ? err.message : "Falha na API Telegram" });
        return true;
      }
    }

    sendJson(res, 200, { ok: true, mensagem: "Configuração validada localmente." });
    return true;
  }


  return false;
}
