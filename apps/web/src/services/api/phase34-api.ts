import type {
  BrowserAutofillConsentRequest,
  CreateLoginCredentialInput,
  CsvLoginImportPreview,
  LoginAutofillPolicy,
  LoginCredentialSummary,
  MessagingChannelPolicy,
  MessagingPlatform,
  PasswordManagerDriverStatus,
  UpdateLoginCredentialInput,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const phase34Api = {
  async listMessagingPolicies(): Promise<MessagingChannelPolicy[]> {
    const res = await apiFetch("/api/mensageria/politicas");
    const json = (await res.json()) as { politicas?: MessagingChannelPolicy[] };
    return json.politicas ?? [];
  },

  async saveMessagingPolicy(
    platform: MessagingPlatform,
    policy: Omit<MessagingChannelPolicy, "channelKind" | "updatedAt">,
  ): Promise<MessagingChannelPolicy> {
    const res = await apiFetch(`/api/mensageria/politicas/${encodeURIComponent(platform)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    const json = (await res.json()) as { politica?: MessagingChannelPolicy; erro?: string };
    if (!res.ok || !json.politica) {
      throw new Error(json.erro ?? "Falha ao salvar política conversacional.");
    }
    return json.politica;
  },

  async listLogins(): Promise<LoginCredentialSummary[]> {
    const res = await apiFetch("/api/cofre/logins");
    const json = (await res.json()) as { logins?: LoginCredentialSummary[] };
    return json.logins ?? [];
  },

  async createLogin(input: CreateLoginCredentialInput): Promise<LoginCredentialSummary> {
    const res = await apiFetch("/api/cofre/logins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { login?: LoginCredentialSummary; erro?: string };
    if (!res.ok || !json.login) {
      throw new Error(json.erro ?? "Falha ao criar login no cofre.");
    }
    return json.login;
  },

  async updateLogin(
    id: string,
    patch: UpdateLoginCredentialInput,
  ): Promise<LoginCredentialSummary> {
    const res = await apiFetch(`/api/cofre/logins/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { login?: LoginCredentialSummary; erro?: string };
    if (!res.ok || !json.login) {
      throw new Error(json.erro ?? "Falha ao atualizar login.");
    }
    return json.login;
  },

  async deleteLogin(id: string): Promise<void> {
    const res = await apiFetch(`/api/cofre/logins/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error("Falha ao remover login.");
    }
  },

  async importCsvLogins(payload: {
    csvText: string;
    mode: "preview" | "commit";
    defaultPolicy?: LoginAutofillPolicy;
  }): Promise<CsvLoginImportPreview> {
    const res = await apiFetch("/api/cofre/logins/import-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as CsvLoginImportPreview & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao processar CSV de logins.");
    }
    return json;
  },

  async getPasswordManagersStatus(): Promise<PasswordManagerDriverStatus[]> {
    const res = await apiFetch("/api/cofre/password-managers/status");
    const json = (await res.json()) as { drivers?: PasswordManagerDriverStatus[] };
    return json.drivers ?? [];
  },

  async listPendingAutofillRequests(): Promise<BrowserAutofillConsentRequest[]> {
    const res = await apiFetch("/api/browser/autofill-consent");
    const json = (await res.json()) as { pending?: BrowserAutofillConsentRequest[] };
    return json.pending ?? [];
  },

  async resolveAutofillConsent(payload: {
    requestId: string;
    approved: boolean;
    selectedLoginId?: string;
  }): Promise<{ ok: boolean; approved: boolean; filledFields: number; mensagem: string }> {
    const res = await apiFetch("/api/browser/autofill-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      approved?: boolean;
      filledFields?: number;
      mensagem?: string;
      erro?: string;
    };
    if (!res.ok && !json.mensagem) {
      throw new Error(json.erro ?? "Falha ao resolver consentimento de autopreenchimento.");
    }
    return {
      ok: Boolean(json.ok),
      approved: Boolean(json.approved),
      filledFields: Number(json.filledFields ?? 0),
      mensagem: String(json.mensagem ?? ""),
    };
  },
};
