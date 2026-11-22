import type {
  McpAcessoAgentes,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import {
  type MetaValidationReport,
  validateMetaIntegration,
} from "../engine/tools/meta-insights.ts";
import {
  CatalogServiceError,
  type CatalogServiceDeps,
} from "./catalog-types.ts";

export async function catalog_testNativeApp(
  deps: CatalogServiceDeps,
    slug: string,
    contaId?: string
  ): Promise<{
    ok: boolean;
    appSlug: string;
    contaId: string | null;
    resumo: string;
    account?: NativeAppAccountSummary | null;
    validationReport?: MetaValidationReport;
    nativeAccounts: NativeAppAccountSummary[];
  }> {
    const app = deps.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }

    const accounts = deps.nativeStore.listAccounts(app.slug);
    const targetContaId = contaId?.trim() || accounts[0]?.conta_id || null;

    if (app.slug === "instagram") {
      const validationReport = await validateMetaIntegration(deps.vault, deps.fetchImpl, {
        nativeStore: deps.nativeStore,
        contaId: targetContaId,
      });

      let updatedAcc: NativeAppAccountSummary | null = null;
      if (targetContaId) {
        updatedAcc = deps.nativeStore.recordTestResult(targetContaId, {
          ok: validationReport.ok,
          error: validationReport.detalhes.erro,
          perfilConectado: validationReport.detalhes.username
            ? {
                username: validationReport.detalhes.username,
                followers_count: validationReport.detalhes.followersCount,
                media_count: validationReport.detalhes.mediaCount,
              }
            : null,
        });
      }

      return {
        ok: validationReport.ok,
        appSlug: app.slug,
        contaId: targetContaId,
        resumo: validationReport.resumo,
        account: updatedAcc,
        validationReport,
        nativeAccounts: deps.nativeStore.listAccounts(app.slug),
      };
    }

    if (app.slug === "telegram") {
      const creds = deps.nativeStore.getResolvedCredentials("telegram", targetContaId);
      const token = creds.values.TELEGRAM_BOT_TOKEN?.trim() || "";
      if (!token) {
        if (targetContaId) {
          deps.nativeStore.recordTestResult(targetContaId, {
            ok: false,
            error: "Token do bot Telegram não configurado no Cofre.",
          });
        }
        const refreshed = deps.nativeStore.listAccounts(app.slug);
        return {
          ok: false,
          appSlug: app.slug,
          contaId: targetContaId,
          resumo: "Token do bot Telegram não configurado no Cofre.",
          account: targetContaId ? deps.nativeStore.getAccount(targetContaId) : null,
          nativeAccounts: refreshed,
        };
      }

      let ok = false;
      let errMsg: string | null = null;
      let botUsername: string | null = null;
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
          method: "GET",
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await res.json()) as { ok?: boolean; description?: string; result?: { username?: string } };
        if (res.ok && data.ok) {
          ok = true;
          botUsername = data.result?.username ?? null;
        } else {
          errMsg = data.description || `HTTP ${res.status} na Telegram Bot API.`;
        }
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }

      const updatedAcc = targetContaId
        ? deps.nativeStore.recordTestResult(targetContaId, {
            ok,
            error: errMsg,
            perfilConectado: botUsername ? { username: botUsername } : null,
          })
        : null;

      return {
        ok,
        appSlug: app.slug,
        contaId: targetContaId,
        resumo: ok
          ? `Bot Telegram conectado${botUsername ? ` (@${botUsername})` : ""}.`
          : errMsg || "Falha ao validar token do Telegram.",
        account: updatedAcc,
        nativeAccounts: deps.nativeStore.listAccounts(app.slug),
      };
    }

    if (app.slug === "whatsapp") {
      let total = 0;
      let conectadas = 0;
      try {
        const row = deps.db.connection
          .prepare(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'conectado' THEN 1 ELSE 0 END), 0) AS conectadas
             FROM whatsapp_contas;`
          )
          .get() as { total?: number; conectadas?: number } | undefined;
        total = Number(row?.total ?? 0);
        conectadas = Number(row?.conectadas ?? 0);
      } catch {
        // Ignora caso a tabela ainda esteja vazia
      }
      const ok = conectadas > 0;
      const resumo = ok
        ? `${conectadas} conta(s) WhatsApp conectada(s) (total: ${total}).`
        : "Nenhuma conta WhatsApp conectada no momento.";
      const updatedAcc = targetContaId
        ? deps.nativeStore.recordTestResult(targetContaId, { ok, error: ok ? null : resumo })
        : null;
      return {
        ok,
        appSlug: app.slug,
        contaId: targetContaId,
        resumo,
        account: updatedAcc,
        nativeAccounts: deps.nativeStore.listAccounts(app.slug),
      };
    }

    const creds = deps.nativeStore.getResolvedCredentials(app.slug, targetContaId);
    const hasValues = Object.values(creds.values).some((v) => v.trim().length > 0);
    const updatedAcc = targetContaId
      ? deps.nativeStore.recordTestResult(targetContaId, {
          ok: hasValues,
          error: hasValues ? null : "Credenciais não configuradas no Cofre.",
        })
      : null;

    return {
      ok: hasValues,
      appSlug: app.slug,
      contaId: targetContaId,
      resumo: hasValues
        ? "Credenciais localizadas no Cofre AES-256-GCM."
        : "Credenciais não configuradas no Cofre.",
      account: updatedAcc,
      nativeAccounts: deps.nativeStore.listAccounts(app.slug),
    };
  }

  /**
   * Persiste as regras de acesso de agentes (`everyone` ou `agents`) para um App Nativo da Loja.
   */
export function catalog_updateNativeAppAccess(
  deps: CatalogServiceDeps,
    slug: string,
    acesso: Partial<McpAcessoAgentes>,
    contaId?: string | null
  ): {
    ok: boolean;
    appSlug: string;
    nativeAccounts: NativeAppAccountSummary[];
  } {
    const app = deps.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }
    const nativeAccounts = deps.nativeStore.updateAccess(app.slug, acesso, contaId);
    return {
      ok: true,
      appSlug: app.slug,
      nativeAccounts,
    };
  }

  /**
   * Remove uma conta nativa salva do SQLite e apaga suas chaves correspondentes no Cofre.
   */
export function catalog_deleteNativeAppAccount(
  deps: CatalogServiceDeps,
    slug: string,
    contaId: string
  ): {
    ok: boolean;
    appSlug: string;
    contaId: string;
    nativeAccounts: NativeAppAccountSummary[];
  } {
    const app = deps.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }
    const removed = deps.nativeStore.deleteAccount(app.slug, contaId);
    if (!removed) {
      throw new CatalogServiceError(
        `Conta nativa '${contaId}' não encontrada para '${app.slug}'.`,
        "ACCOUNT_NOT_FOUND"
      );
    }
    return {
      ok: true,
      appSlug: app.slug,
      contaId,
      nativeAccounts: deps.nativeStore.listAccounts(app.slug),
    };
  }
