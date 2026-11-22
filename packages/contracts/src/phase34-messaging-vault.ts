/**
 * Contratos compartilhados da Fase 34:
 * - G-09: Mensageria Unificada Conversacional (Telegram, Slack, Discord)
 * - G-10: Cofre Estruturado de Logins, CSV & Drivers Externos (1Password, Bitwarden, Proton Pass)
 */

export type MessagingPlatform = "telegram" | "slack" | "discord";

export type MessagingAllowlistRole = "admin" | "operator" | "viewer";

export interface MessagingAllowlistEntry {
  senderId: string;
  role: MessagingAllowlistRole;
  label?: string | null;
}

export interface MessagingChannelPolicy {
  channelKind: MessagingPlatform;
  enabled: boolean;
  orchestratorAgentId: string;
  replyInThreads: boolean;
  allowlist: MessagingAllowlistEntry[];
  allowedChannelIds: string[];
  updatedAt?: string;
}

export interface InboundMessagingEvent {
  platform: MessagingPlatform;
  messageId: string;
  channelId: string;
  senderId: string;
  senderName?: string | null;
  text: string;
  threadId?: string | null;
  replyToMessageId?: string | null;
  raw?: unknown;
}

export type LoginAutofillPolicy = "anywhere" | "exact" | "never";

export type LoginCredentialSource = "local" | "1password" | "bitwarden" | "protonpass";

export interface LoginCredentialSummary {
  id: string;
  title: string;
  domain: string;
  username: string;
  autofillPolicy: LoginAutofillPolicy;
  source: LoginCredentialSource;
  hasTotp?: boolean;
  hasNotes?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface CreateLoginCredentialInput {
  title: string;
  domain: string;
  username: string;
  password: string;
  totpSecret?: string | null;
  notes?: string | null;
  autofillPolicy?: LoginAutofillPolicy;
}

export interface UpdateLoginCredentialInput {
  title?: string;
  domain?: string;
  username?: string;
  password?: string;
  totpSecret?: string | null;
  notes?: string | null;
  autofillPolicy?: LoginAutofillPolicy;
}

export interface CsvLoginImportPreviewItem {
  title: string;
  domain: string;
  username: string;
  duplicate: boolean;
  autofillPolicy: LoginAutofillPolicy;
}

export interface CsvLoginImportPreview {
  mode: "preview" | "commit";
  totalParsed: number;
  newCount: number;
  duplicateCount: number;
  importedCount: number;
  items: CsvLoginImportPreviewItem[];
}

export interface PasswordManagerDriverStatus {
  id: "1password" | "bitwarden" | "protonpass";
  label: string;
  cliBinary: string;
  installed: boolean;
  authenticated: boolean;
  detail: string;
}

export interface BrowserAutofillConsentRequest {
  requestId: string;
  tabId: string;
  agenteId: string | null;
  domain: string;
  url: string;
  candidates: Array<{
    id: string;
    title: string;
    domain: string;
    username: string;
    source: LoginCredentialSource;
  }>;
  createdAt: string;
}
