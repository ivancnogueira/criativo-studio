import {
  type AgentRoutine,
  type EventFilter,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineOwnerKind,
  type RoutineResultDelivery,
  type RoutineResultDeliveryStatus,
  type RoutineResultDestination,
  type RoutineRun,
  type RoutineRunPlace,
  type RoutineRunStatus,
  type RoutineWebhookConfig,
  type SaveAgentRoutineInput,
  type UpdateAgentRoutineInput,
  type WebhookReceipt,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export interface RoutineRow {
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  nome: string;
  instrucao: string;
  ativa: number;
  timezone: string;
  trigger_kind: "schedule" | "webhook";
  schedule_json: string | null;
  next_run_at: string | null;
  limit_policy: RoutineLimitPolicy;
  missed_policy: RoutineMissedPolicy;
  run_in: RoutineRunPlace;
  destino_resultado_json: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface WebhookRow {
  webhook_id: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  route_token: string;
  event_type: string | null;
  filters_json: string;
  vault_secret_key: string;
  ultimo_disparo_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RoutineRunRow {
  execucao_id: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  run_kind: "scheduled" | "manual";
  run_source: "test" | "script" | "webhook" | null;
  scheduled_for: string;
  rotina_nome: string;
  instrucao: string;
  tarefa_id: string | null;
  thread_id: string | null;
  status: RoutineRunStatus;
  silenciada: number;
  erro: string | null;
  missed_count: number | null;
  missed_until: string | null;
  resultado_resumo: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface WebhookReceiptRow {
  recibo_id: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  delivery_id: string;
  event_type: string;
  status: "started" | "ignored";
  reason: "event-type" | "filter" | "inactive" | null;
  execucao_id: string | null;
  recebido_em: string;
}

export interface DeliveryRow {
  execucao_id: string;
  rotina_id: string;
  owner_id: string;
  destino_tipo: Exclude<RoutineResultDestination["tipo"], "none">;
  destino_id: string;
  destino_nome: string;
  conteudo_texto: string | null;
  status: RoutineResultDeliveryStatus;
  motivo_falha: string | null;
  tentativas: number;
  proximo_envio_em: string | null;
  expira_em: string | null;
  enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export class RoutineStoreError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = "ROUTINE_STORE_ERROR", statusCode = 400) {
    super(message);
    this.name = "RoutineStoreError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CreateRoutineStoreInput extends SaveAgentRoutineInput {
  rotina_id?: string;
  next_run_at?: string | null;
}

export interface UpdateRoutineStoreInput extends UpdateAgentRoutineInput {
  next_run_at?: string | null;
}

export interface CreateRoutineRunInput {
  execucao_id?: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  run_kind: "scheduled" | "manual";
  run_source?: "test" | "script" | "webhook" | null;
  scheduled_for: string;
  rotina_nome: string;
  instrucao: string;
  tarefa_id?: string | null;
  thread_id?: string | null;
  status: RoutineRunStatus;
  silenciada?: boolean;
  erro?: string | null;
  missed_count?: number | null;
  missed_until?: string | null;
  resultado_resumo?: string | null;
  criado_em?: string;
}

export interface UpdateRoutineRunPatch {
  status?: RoutineRunStatus;
  tarefa_id?: string | null;
  thread_id?: string | null;
  silenciada?: boolean;
  erro?: string | null;
  resultado_resumo?: string | null;
}

export interface UpsertWebhookInput {
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  route_token?: string;
  event_type?: string | null;
  filters?: EventFilter[];
  vault_secret_key?: string;
}

export interface RecordWebhookReceiptInput {
  recibo_id?: string;
  rotina_id: string;
  owner_kind: RoutineOwnerKind;
  delivery_id: string;
  event_type: string;
  status: "started" | "ignored";
  reason?: "event-type" | "filter" | "inactive" | null;
  execucao_id?: string | null;
  recebido_em?: string;
}

export interface UpsertDeliveryInput {
  execucao_id: string;
  rotina_id: string;
  owner_id: string;
  destino_tipo: Exclude<RoutineResultDestination["tipo"], "none">;
  destino_id: string;
  destino_nome: string;
  conteudo_texto?: string | null;
  status: RoutineResultDeliveryStatus;
  motivo_falha?: string | null;
  tentativas?: number;
  proximo_envio_em?: string | null;
  expira_em?: string | null;
  enviado_em?: string | null;
}

export interface WebhookRowWithSecretKey extends RoutineWebhookConfig {
  owner_kind: RoutineOwnerKind;
  owner_id: string;
  rotina_id: string;
  vault_secret_key: string;
}

/**
 * Persistência transacional em `node:sqlite` para rotinas por agente/canal,
 * execuções agendadas/manuais, webhooks, recibos e entregas externas.
 */

export interface RoutineStoreDeps {
  db: CriativoDatabase;
  buildWebhookPublicUrl: (routeToken: string) => string;
  mapWebhookRow: (row: WebhookRow) => WebhookRowWithSecretKey;
  mapRoutineRow: (row: RoutineRow, webhook?: RoutineWebhookConfig | null) => AgentRoutine;
  mapRunRow: (row: RoutineRunRow) => RoutineRun;
  mapReceiptRow: (row: WebhookReceiptRow) => WebhookReceipt;
  mapDeliveryRow: (row: DeliveryRow) => RoutineResultDelivery;
  loadWebhooksMap: () => Map<string, RoutineWebhookConfig>;
  listByOwner: (ownerKind: RoutineOwnerKind, ownerId: string) => AgentRoutine[];
  getById: (rotinaId: string) => AgentRoutine | null;
}

export type TailArgs<F> = F extends (deps: RoutineStoreDeps, ...args: infer A) => unknown ? A : never;
