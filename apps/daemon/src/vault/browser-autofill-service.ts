import { randomUUID } from "node:crypto";
import type {
  BrowserAutofillConsentRequest,
  BrowserTargetSelector,
  LoginCredentialSummary,
} from "@criativo/contracts";
import type { BrowserAutomationService } from "../engine/tools/browser-automation.ts";
import { resolveBrowserTarget } from "../engine/tools/browser-snapshot.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import { normalizeLoginDomain, type LoginVaultService } from "./login-vault-service.ts";
import type { PasswordManagerRegistry } from "./password-managers/registry.ts";

interface PendingAutofillEntry {
  request: BrowserAutofillConsentRequest;
  targetUser?: BrowserTargetSelector | null;
  targetPassword?: BrowserTargetSelector | null;
  submitTarget?: BrowserTargetSelector | null;
  submission: "enter" | "click" | "none";
}

export interface BrowserAutofillServiceDeps {
  loginVault: LoginVaultService;
  passwordManagers: PasswordManagerRegistry;
  browserService: BrowserAutomationService;
  wsHub?: WebSocketHub;
}

/**
 * Orquestra o preenchimento seguro de credenciais no navegador:
 * nunca envia senhas para o modelo de linguagem e sempre exige aprovação humana explícita.
 */
export class BrowserAutofillService {
  private readonly loginVault: LoginVaultService;
  private readonly passwordManagers: PasswordManagerRegistry;
  private readonly browserService: BrowserAutomationService;
  private readonly wsHub?: WebSocketHub;
  private readonly pending = new Map<string, PendingAutofillEntry>();

  constructor(deps: BrowserAutofillServiceDeps) {
    this.loginVault = deps.loginVault;
    this.passwordManagers = deps.passwordManagers;
    this.browserService = deps.browserService;
    this.wsHub = deps.wsHub;
  }

  public listPendingRequests(): BrowserAutofillConsentRequest[] {
    return Array.from(this.pending.values()).map((entry) => entry.request);
  }

  public async requestAutofill(params: {
    tabId: string;
    agenteId?: string | null;
    url?: string;
    targetUser?: BrowserTargetSelector | null;
    targetPassword?: BrowserTargetSelector | null;
    submitTarget?: BrowserTargetSelector | null;
    submission?: "enter" | "click" | "none";
  }): Promise<{
    ok: boolean;
    requiresApproval: boolean;
    requestId: string | null;
    domain: string;
    candidatesCount: number;
    candidates: BrowserAutofillConsentRequest["candidates"];
    mensagem: string;
  }> {
    const tab = this.browserService.sessionManager.getTab(params.tabId);
    if (!tab) {
      throw new Error(`Aba '${params.tabId}' não encontrada para autopreenchimento de login.`);
    }

    const currentUrl =
      params.url?.trim() || (tab.page ? tab.page.url() : tab.virtualUrl) || "https://example.invalid";
    const domain = normalizeLoginDomain(currentUrl);

    const localMatches: LoginCredentialSummary[] = this.loginVault.findMatchingForUrl(currentUrl);
    const externalMatches: LoginCredentialSummary[] =
      await this.passwordManagers.findExternalMatchesForDomain(domain).catch(() => []);

    const allMatches = [...localMatches, ...externalMatches];
    if (allMatches.length === 0) {
      return {
        ok: false,
        requiresApproval: false,
        requestId: null,
        domain,
        candidatesCount: 0,
        candidates: [],
        mensagem: `Nenhuma credencial elegível encontrada para o domínio '${domain}'.`,
      };
    }

    const candidates: BrowserAutofillConsentRequest["candidates"] = allMatches.map((item) => ({
      id: item.id,
      title: item.title,
      domain: item.domain,
      username: item.username,
      source: item.source,
    }));

    const request: BrowserAutofillConsentRequest = {
      requestId: `af_${randomUUID().slice(0, 10)}`,
      tabId: tab.tabId,
      agenteId: params.agenteId ?? tab.agenteId ?? null,
      domain,
      url: currentUrl,
      candidates,
      createdAt: new Date().toISOString(),
    };

    this.pending.set(request.requestId, {
      request,
      targetUser: params.targetUser ?? null,
      targetPassword: params.targetPassword ?? null,
      submitTarget: params.submitTarget ?? null,
      submission: params.submission ?? "none",
    });

    this.wsHub?.broadcast("browser:autofill_requested", request);

    return {
      ok: true,
      requiresApproval: true,
      requestId: request.requestId,
      domain,
      candidatesCount: candidates.length,
      candidates,
      mensagem:
        "Solicitação de autopreenchimento enviada ao operador. Aguarde aprovação humana na interface antes de prosseguir.",
    };
  }

  public async resolveConsent(params: {
    requestId: string;
    approved: boolean;
    selectedLoginId?: string;
  }): Promise<{
    ok: boolean;
    approved: boolean;
    requestId: string;
    tabId: string;
    loginId?: string;
    filledFields: number;
    mensagem: string;
  }> {
    const entry = this.pending.get(params.requestId);
    if (!entry) {
      throw new Error(`Solicitação de autopreenchimento '${params.requestId}' não encontrada ou já expirada.`);
    }

    this.pending.delete(params.requestId);
    const { request } = entry;

    if (!params.approved) {
      return {
        ok: false,
        approved: false,
        requestId: request.requestId,
        tabId: request.tabId,
        filledFields: 0,
        mensagem: "Autopreenchimento recusado pelo operador.",
      };
    }

    const chosen =
      (params.selectedLoginId
        ? request.candidates.find((c) => c.id === params.selectedLoginId)
        : request.candidates[0]) ?? null;

    if (!chosen) {
      throw new Error("Nenhuma credencial válida selecionada para aprovação.");
    }

    const isExternal =
      chosen.id.startsWith("1password:") ||
      chosen.id.startsWith("bitwarden:") ||
      chosen.id.startsWith("protonpass:");

    const secretPayload = isExternal
      ? await this.passwordManagers.revealExternalSecret(chosen.id)
      : this.loginVault.revealForAuthorizedAutofill(chosen.id, request.url);

    if (!secretPayload || !secretPayload.password) {
      throw new Error("Credencial aprovada não retornou senha válida no Cofre.");
    }

    const tab = this.browserService.sessionManager.getTab(request.tabId);
    let filledFields = 0;

    if (tab?.page) {
      const userTarget: BrowserTargetSelector = entry.targetUser ?? {
        kind: "css",
        selector: 'input[type="email"], input[name*="user"], input[name*="email"], input[type="text"]',
      };
      const passTarget: BrowserTargetSelector = entry.targetPassword ?? {
        kind: "css",
        selector: 'input[type="password"]',
      };

      if (secretPayload.username) {
        try {
          const resolvedUser = resolveBrowserTarget(
            tab.page,
            userTarget,
            tab.snapshotRefs,
            tab.revision,
          );
          if (resolvedUser.locator) {
            await resolvedUser.locator.fill(secretPayload.username, { timeout: 6_000 });
            filledFields += 1;
          }
        } catch {
          // Alguns formulários já estão na etapa de senha apenas.
        }
      }

      const resolvedPass = resolveBrowserTarget(
        tab.page,
        passTarget,
        tab.snapshotRefs,
        tab.revision,
      );
      if (resolvedPass.locator) {
        await resolvedPass.locator.fill(secretPayload.password, { timeout: 6_000 });
        filledFields += 1;
        if (entry.submission === "enter") {
          await resolvedPass.locator.press("Enter");
        }
      }

      if (entry.submission === "click" && entry.submitTarget) {
        const btn = resolveBrowserTarget(
          tab.page,
          entry.submitTarget,
          tab.snapshotRefs,
          tab.revision,
        );
        await btn.locator?.click({ timeout: 6_000 });
      }
      tab.revision += 1;
    } else {
      // Modo virtual/teste sem Playwright conectado
      filledFields = secretPayload.username ? 2 : 1;
    }

    return {
      ok: true,
      approved: true,
      requestId: request.requestId,
      tabId: request.tabId,
      loginId: chosen.id,
      filledFields,
      mensagem: "Credencial preenchida com sucesso após consentimento humano.",
    };
  }
}
