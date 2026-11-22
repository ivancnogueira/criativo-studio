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
import { ensureProviderRuntimeInstalled } from "../../providers/provider-runtime-resolver.ts";
import {
  buildConnectorsList,
  computeHostAnalytics,
  importExternalTelemetryIfAvailable,
  listInstalledSkills,
  loadSkillPromptBySlug,
  recordChatTurnUsage,
  recordSkillLoadUsage,
} from "../analytics-skills-service.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { safeJsonParse } from "./route-helpers.ts";

export async function tryHandleProvidersRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;

  // 2. Provedores, CLIs & Uso
  if (method === "GET" && path === "/api/provedores/status") {
    const force = url.searchParams.get("refresh") === "1";
    const provedores = await providerConnection.getProvidersStatus(force);
    sendJson(res, 200, { provedores });
    return true;
  }

  if (method === "POST" && path === "/api/provedores/conectar") {
    const body = await readJsonBody(req);
    if (typeof body.provedor !== "string") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'provedor'." });
      return true;
    }
    try {
      const status = await providerConnection.connectProvider(body.provedor as ProviderName, {
        apiKey: typeof body.api_key === "string" ? body.api_key : undefined,
        modo:
          typeof body.modo === "string"
            ? (body.modo as "cli" | "api_key" | "local" | "assinatura")
            : undefined,
      });
      wsHub.broadcast("provider:updated", {
        provedor: status.provedor,
        conectado: status.conectado,
        modo: status.modo_conexao,
      });
      sendJson(res, 200, { provedor: status });
    } catch (err) {
      sendJson(res, 400, {
        erro: err instanceof Error ? err.message : "Falha ao conectar provedor.",
      });
    }
    return true;
  }

  if (method === "POST" && path === "/api/provedores/desconectar") {
    const body = await readJsonBody(req);
    if (typeof body.provedor !== "string") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'provedor'." });
      return true;
    }
    const status = await providerConnection.disconnectProvider(body.provedor as ProviderName);
    wsHub.broadcast("provider:updated", {
      provedor: status.provedor,
      conectado: status.conectado,
      modo: status.modo_conexao,
    });
    sendJson(res, 200, { provedor: status });
    return true;
  }

  if (method === "GET" && path === "/api/provedores/uso") {
    const refresh = url.searchParams.get("refresh") === "1";
    const uso = await providerConnection.getUsageSnapshot(refresh);
    sendJson(res, 200, { uso });
    return true;
  }

  if (method === "GET" && path === "/api/uso/analytics") {
    if (url.searchParams.get("importExternal") === "1" || process.env.CRIATIVO_IMPORT_EXTERNAL_DB === "1") {
      importExternalTelemetryIfAvailable(db);
    }
    const dias = Number(url.searchParams.get("dias") ?? "30");
    const agenteId = url.searchParams.get("agente_id");
    const relatorio = computeHostAnalytics(db, {
      dias: Number.isFinite(dias) ? dias : 30,
      agenteId: agenteId || null,
    });
    sendJson(res, 200, { analytics: relatorio });
    return true;
  }


  const browserSignInMatch = path.match(/^\/api\/provedores\/(gemini|claude|openai)\/conectar-navegador$/);
  if (method === "POST" && browserSignInMatch) {
    const provId = browserSignInMatch[1] as "gemini" | "claude" | "openai";
    const body = await readJsonBody(req);
    try {
      const result = await providerConnection.connectProviderViaBrowser(
        provId,
        typeof body.label === "string" ? body.label : undefined,
        (url) => {
          wsHub.broadcast("provider:auth_url", {
            provedor: provId,
            url,
          });
        }
      );
      const uso = await providerConnection.getUsageSnapshot(true);
      wsHub.broadcast("provider:updated", {
        provedor: provId,
        conectado: true,
        modo: "assinatura",
      });
      sendJson(res, 200, { ok: true, conta: result.conta, provedores: result.provedores, uso });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Falha ao concluir autenticação no navegador.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const oauthCallbackRelayMatch = path.match(/^\/api\/provedores\/(claude|openai)\/oauth-callback-relay$/);
  if (method === "POST" && oauthCallbackRelayMatch) {
    const provId = oauthCallbackRelayMatch[1] as "claude" | "openai";
    const body = await readJsonBody(req);
    const rawCallback =
      typeof body.callback_path === "string"
        ? body.callback_path
        : typeof body.callback_url === "string"
          ? body.callback_url
          : "";
    try {
      const relayRes = await providerConnection
        .getCliOAuthService()
        .relayLoopbackCallback(provId, rawCallback);
      if (!relayRes.accepted) {
        sendJson(res, 400, {
          ok: false,
          accepted: false,
          status: relayRes.status,
          erro: relayRes.errorMessage ?? "A CLI rejeitou o callback OAuth.",
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        accepted: true,
        status: relayRes.status,
        body: relayRes.body,
        content_type: relayRes.contentType,
      });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        accepted: false,
        erro: err instanceof Error ? err.message : "Falha ao entregar callback OAuth ao provedor.",
      });
    }
    return true;
  }

  const cancelSignInMatch = path.match(/^\/api\/provedores\/(gemini|claude|openai)\/cancelar-login$/);
  if (method === "POST" && cancelSignInMatch) {
    const provId = cancelSignInMatch[1] as "gemini" | "claude" | "openai";
    const canceled = providerConnection.cancelBrowserSignIn(provId);
    sendJson(res, 200, { ok: true, canceled });
    return true;
  }

  const visibilityMatch = path.match(
    /^\/api\/provedores\/(gemini|claude|openai|opencode|grok|ollama)\/modelos-visibilidade$/
  );
  if (method === "POST" && visibilityMatch) {
    const provId = visibilityMatch[1] as "gemini" | "claude" | "openai" | "opencode" | "grok" | "ollama";
    const body = await readJsonBody(req);
    const ocultos = Array.isArray(body.ocultos)
      ? body.ocultos.filter((item): item is string => typeof item === "string")
      : [];
    const provedores = await providerConnection.setHiddenModels(provId, ocultos);
    const updated = provedores.find((p) => p.provedor === provId);
    wsHub.broadcast("provider:updated", {
      provedor: provId,
      conectado: updated?.conectado ?? false,
      modo: updated?.modo_conexao ?? "nenhum",
    });
    sendJson(res, 200, { ok: true, provedores });
    return true;
  }

  const poolMatch = path.match(/^\/api\/provedores\/([^/]+)\/pool$/);
  if (method === "POST" && poolMatch) {
    const provId = decodeURIComponent(poolMatch[1]);
    const body = await readJsonBody(req);
    const patch = {
      habilitado: typeof body.habilitado === "boolean" ? body.habilitado : undefined,
      contas_excluidas: Array.isArray(body.contas_excluidas) ? (body.contas_excluidas as string[]) : undefined,
      conta_em_uso: typeof body.conta_em_uso === "string" || body.conta_em_uso === null ? body.conta_em_uso : undefined,
    };
    if (provId === "claude" || provId === "openai") {
      providerConnection.getCliOAuthService().setPoolSettings(provId, patch);
    } else {
      providerConnection.getAntigravityService().setPoolSettings(patch);
    }
    const provedores = await providerConnection.getProvidersStatus(true);
    sendJson(res, 200, { ok: true, provedores });
    return true;
  }

  const accountsAddMatch = path.match(/^\/api\/provedores\/([^/]+)\/contas$/);
  if (method === "POST" && accountsAddMatch) {
    const body = await readJsonBody(req);
    if (typeof body.email !== "string" || typeof body.access_token !== "string") {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'email' e 'access_token'." });
      return true;
    }
    const rawAcpModels = Array.isArray(body.acp_models)
      ? body.acp_models.filter(
          (item): item is { modelId: string; name: string; description?: string | null; isDefault?: boolean } =>
            Boolean(item && typeof item === "object" && typeof (item as { modelId?: unknown }).modelId === "string" && typeof (item as { name?: unknown }).name === "string")
        )
      : undefined;
    const conta = providerConnection.getAntigravityService().addManualTokenAccount({
      email: body.email,
      label: typeof body.label === "string" ? body.label : undefined,
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      expiry: typeof body.expiry === "string" ? body.expiry : undefined,
      acpModels: rawAcpModels,
      acpDefaultModelId: typeof body.acp_default_model_id === "string" ? body.acp_default_model_id : null,
    });
    if (
      process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1" &&
      !providerConnection.getAntigravityService().getCliExecutable()
    ) {
      await ensureProviderRuntimeInstalled("antigravity").catch(() => null);
      providerConnection.invalidateCliProbeCache();
    }
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(false);
    const geminiProv = provedores.find((p) => p.provedor === "gemini");
    const enrichedConta = geminiProv?.contas?.find((c) => c.id === conta.id) ?? conta;
    wsHub.broadcast("provider:updated", {
      provedor: "gemini",
      conectado: true,
      modo: "assinatura",
    });
    sendJson(res, 201, { conta: enrichedConta, provedores, uso });
    return true;
  }

  if (method === "POST" && path === "/api/provedores/openai/contas-auth") {
    const body = await readJsonBody(req);
    const authJson = typeof body.auth_json === "string" ? body.auth_json : "";
    if (!authJson.trim()) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'auth_json'." });
      return true;
    }
    const conta = await providerConnection.getCliOAuthService().importCodexAuthAccount({
      authJson,
      email: typeof body.email === "string" ? body.email : null,
      plano: typeof body.plano === "string" ? body.plano : null,
      label: typeof body.label === "string" ? body.label : undefined,
    });
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(false);
    const openaiProv = provedores.find((p) => p.provedor === "openai");
    const enrichedConta = openaiProv?.contas?.find((c) => c.id === conta.id) ?? conta;
    wsHub.broadcast("provider:updated", {
      provedor: "openai",
      conectado: true,
      modo: "assinatura",
    });
    sendJson(res, 201, { ok: true, conta: enrichedConta, provedores, uso });
    return true;
  }

  const accountDelMatch = path.match(/^\/api\/provedores\/([^/]+)\/contas\/([^/]+)$/);
  if (method === "DELETE" && accountDelMatch) {
    const provId = decodeURIComponent(accountDelMatch[1]);
    const contaId = decodeURIComponent(accountDelMatch[2]);
    const removed =
      provId === "claude" || provId === "openai"
        ? providerConnection.getCliOAuthService().removeAccount(provId, contaId)
        : providerConnection.getAntigravityService().removeAccount(contaId);
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(true);
    sendJson(res, removed ? 200 : 404, { ok: removed, provedores, uso });
    return true;
  }

  return false;
}
