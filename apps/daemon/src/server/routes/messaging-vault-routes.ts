import type {
  CreateLoginCredentialInput,
  LoginAutofillPolicy,
  MessagingChannelPolicy,
  MessagingPlatform,
  UpdateLoginCredentialInput,
} from "@criativo/contracts";
import { importCsvLogins } from "../../vault/csv-login-importer.ts";
import type { TelegramUpdate } from "../../messaging/telegram-bot.ts";
import type { StudioRouteContext } from "./route-helpers.ts";

const VALID_PLATFORMS = new Set<MessagingPlatform>(["telegram", "slack", "discord"]);
const VALID_POLICIES = new Set<LoginAutofillPolicy>(["anywhere", "exact", "never"]);

export async function tryHandleMessagingAndVaultRoutes(
  ctx: StudioRouteContext,
): Promise<boolean> {
  const { req, res, path, method, deps } = ctx;
  const {
    sendJson,
    readJsonBody,
    messagingService,
    telegramBot,
    loginVault,
    passwordManagerRegistry,
    browserAutofillService,
  } = deps;

  // =========================================================================
  // 1. Mensageria Unificada Conversacional (Telegram, Slack, Discord)
  // =========================================================================

  if (method === "GET" && path === "/api/mensageria/politicas") {
    if (!messagingService) {
      sendJson(res, 503, { erro: "MessagingService não inicializado." });
      return true;
    }
    sendJson(res, 200, { politicas: messagingService.listPolicies() });
    return true;
  }

  const policyMatch = path.match(/^\/api\/mensageria\/politicas\/([^/]+)$/);
  if (policyMatch) {
    const channelKind = decodeURIComponent(policyMatch[1]!) as MessagingPlatform;
    if (!VALID_PLATFORMS.has(channelKind)) {
      sendJson(res, 400, { erro: `Canal de mensageria inválido: '${channelKind}'.` });
      return true;
    }
    if (!messagingService) {
      sendJson(res, 503, { erro: "MessagingService não inicializado." });
      return true;
    }

    if (method === "GET") {
      sendJson(res, 200, { politica: messagingService.getPolicy(channelKind) });
      return true;
    }

    if (method === "PUT" || method === "PATCH") {
      const body = await readJsonBody(req);
      const current = messagingService.getPolicy(channelKind);
      const nextPolicy: MessagingChannelPolicy = {
        channelKind,
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        orchestratorAgentId:
          typeof body.orchestratorAgentId === "string" && body.orchestratorAgentId.trim()
            ? body.orchestratorAgentId.trim()
            : current.orchestratorAgentId,
        replyInThreads:
          typeof body.replyInThreads === "boolean"
            ? body.replyInThreads
            : current.replyInThreads,
        allowlist: Array.isArray(body.allowlist) ? body.allowlist : current.allowlist,
        allowedChannelIds: Array.isArray(body.allowedChannelIds)
          ? body.allowedChannelIds.map(String)
          : current.allowedChannelIds,
      };
      const saved = messagingService.savePolicy(nextPolicy);
      sendJson(res, 200, { ok: true, politica: saved });
      return true;
    }
  }

  if (method === "POST" && path === "/api/webhooks/telegram") {
    if (!telegramBot) {
      sendJson(res, 503, { erro: "TelegramNotificationBot não inicializado." });
      return true;
    }
    const body = (await readJsonBody(req)) as unknown as TelegramUpdate;
    const outcome = await telegramBot.handleUpdate(body);
    sendJson(res, 200, { ok: true, outcome });
    return true;
  }

  // =========================================================================
  // 2. Cofre Estruturado de Logins, Importação CSV e Drivers CLIs
  // =========================================================================

  if (method === "GET" && path === "/api/cofre/logins") {
    if (!loginVault) {
      sendJson(res, 503, { erro: "LoginVaultService não inicializado." });
      return true;
    }
    sendJson(res, 200, { logins: loginVault.listLogins() });
    return true;
  }

  if (method === "POST" && path === "/api/cofre/logins") {
    if (!loginVault) {
      sendJson(res, 503, { erro: "LoginVaultService não inicializado." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const policy = VALID_POLICIES.has(body.autofillPolicy as LoginAutofillPolicy)
        ? (body.autofillPolicy as LoginAutofillPolicy)
        : "exact";
      const input: CreateLoginCredentialInput = {
        title: String(body.title ?? ""),
        domain: String(body.domain ?? ""),
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
        totpSecret: typeof body.totpSecret === "string" ? body.totpSecret : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        autofillPolicy: policy,
      };
      const login = loginVault.createLogin(input);
      sendJson(res, 201, { ok: true, login });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/cofre/logins/import-csv") {
    if (!loginVault) {
      sendJson(res, 503, { erro: "LoginVaultService não inicializado." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const mode = body.mode === "commit" ? "commit" : "preview";
      const csvText = String(body.csvText ?? "");
      const defaultPolicy = VALID_POLICIES.has(body.defaultPolicy as LoginAutofillPolicy)
        ? (body.defaultPolicy as LoginAutofillPolicy)
        : "exact";
      const result = importCsvLogins({ vault: loginVault, csvText, mode, defaultPolicy });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const loginItemMatch = path.match(/^\/api\/cofre\/logins\/([^/]+)$/);
  if (loginItemMatch) {
    if (!loginVault) {
      sendJson(res, 503, { erro: "LoginVaultService não inicializado." });
      return true;
    }
    const loginId = decodeURIComponent(loginItemMatch[1]!);

    if (method === "PATCH" || method === "PUT") {
      const body = await readJsonBody(req);
      const patch: UpdateLoginCredentialInput = {
        title: typeof body.title === "string" ? body.title : undefined,
        domain: typeof body.domain === "string" ? body.domain : undefined,
        username: typeof body.username === "string" ? body.username : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
        totpSecret:
          body.totpSecret === null || typeof body.totpSecret === "string"
            ? body.totpSecret
            : undefined,
        notes:
          body.notes === null || typeof body.notes === "string" ? body.notes : undefined,
        autofillPolicy: VALID_POLICIES.has(body.autofillPolicy as LoginAutofillPolicy)
          ? (body.autofillPolicy as LoginAutofillPolicy)
          : undefined,
      };
      const updated = loginVault.updateLogin(loginId, patch);
      if (!updated) {
        sendJson(res, 404, { erro: "Login não encontrado." });
        return true;
      }
      sendJson(res, 200, { ok: true, login: updated });
      return true;
    }

    if (method === "DELETE") {
      const deleted = loginVault.deleteLogin(loginId);
      sendJson(res, deleted ? 200 : 404, { ok: deleted });
      return true;
    }
  }

  if (method === "GET" && path === "/api/cofre/password-managers/status") {
    if (!passwordManagerRegistry) {
      sendJson(res, 503, { erro: "PasswordManagerRegistry não inicializado." });
      return true;
    }
    const drivers = await passwordManagerRegistry.getStatuses();
    sendJson(res, 200, { drivers });
    return true;
  }

  // =========================================================================
  // 3. Consentimento Humano de Autopreenchimento no Navegador
  // =========================================================================

  if (path === "/api/browser/autofill-consent") {
    if (!browserAutofillService) {
      sendJson(res, 503, { erro: "BrowserAutofillService não inicializado." });
      return true;
    }

    if (method === "GET") {
      sendJson(res, 200, { pending: browserAutofillService.listPendingRequests() });
      return true;
    }

    if (method === "POST") {
      try {
        const body = await readJsonBody(req);
        const requestId = String(body.requestId ?? "").trim();
        if (!requestId) {
          sendJson(res, 400, { erro: "Informe requestId para decidir o autopreenchimento." });
          return true;
        }
        const out = await browserAutofillService.resolveConsent({
          requestId,
          approved: Boolean(body.approved),
          selectedLoginId:
            typeof body.selectedLoginId === "string" ? body.selectedLoginId : undefined,
        });
        sendJson(res, 200, out);
      } catch (err) {
        sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }
  }

  return false;
}
