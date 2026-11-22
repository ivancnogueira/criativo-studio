/**
 * Contratos compartilhados da Fase 33:
 * - G-07: Mailbox Persistente & Reconciliação Pós-Crash
 * - G-08: Provedores Customizados OpenAI-Compatíveis & Detecção Local
 * - G-11: Notificações Nativas SO & Central na UI
 */

export type MailboxEntryStatus = "pending" | "leased" | "delivered" | "acked" | "dead_letter";

export type MailboxSourceKind =
  | "handoff"
  | "wakeup"
  | "wait_event"
  | "webhook"
  | "channel_message";

export interface AgentMailboxItem {
  mailbox_id: string;
  agente_id: string;
  source_kind: MailboxSourceKind;
  idempotency_key: string;
  payload_json: string;
  priority: number;
  status: MailboxEntryStatus;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
}

export interface CustomOpenAIEndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  enabled: boolean;
  headersJson?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface DetectedLocalProvider {
  kind: "ollama" | "lmstudio";
  label: string;
  baseUrl: string;
  online: boolean;
  models: string[];
  latencyMs: number | null;
  checkedAt: string;
}

export type NativeNotificationLevel = "all" | "approvals_only" | "errors_only" | "muted";

export interface StudioNotificationItem {
  id: string;
  kind: "approval" | "error" | "completion" | "update" | "info";
  title: string;
  body: string;
  agentId?: string | null;
  createdAt: string;
  read: boolean;
}
