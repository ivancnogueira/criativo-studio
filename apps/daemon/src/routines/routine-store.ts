import {
  isEventFilter,
  isRoutineResultDestination,
  isRoutineSchedule,
  type AgentRoutine,
  type EventFilter,
  type RoutineOwnerKind,
  type RoutineResultDelivery,
  type RoutineResultDestination,
  type RoutineRun,
  type RoutineSchedule,
  type RoutineWebhookConfig,
  type WebhookReceipt,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type { RoutineStoreDeps, TailArgs, RoutineRow, WebhookRow, RoutineRunRow, WebhookReceiptRow, DeliveryRow, WebhookRowWithSecretKey } from "./routine-store-types.ts";

import * as crudOps from "./routine-crud-ops.ts";
import * as runsOps from "./routine-runs-deliveries-ops.ts";

export * from "./routine-store-types.ts";

export class RoutineStore {
  private readonly db: CriativoDatabase;
  private publicBaseUrl: string;

  constructor(db: CriativoDatabase, publicBaseUrl?: string) {
    this.db = db;
    this.publicBaseUrl =
      publicBaseUrl?.replace(/\/+$/, "") ||
      process.env.CRIATIVO_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
      "http://127.0.0.1:3000";
  }

  public setPublicBaseUrl(baseUrl: string): void {
    const clean = baseUrl.trim().replace(/\/+$/, "");
    if (clean) {
      this.publicBaseUrl = clean;
    }
  }

  public buildWebhookPublicUrl(routeToken: string): string {
    return `${this.publicBaseUrl}/api/webhooks/rotina/${encodeURIComponent(routeToken)}`;
  }

  private mapWebhookRow(row: WebhookRow): WebhookRowWithSecretKey {
    let filters: EventFilter[] = [];
    try {
      const parsed = JSON.parse(row.filters_json);
      if (Array.isArray(parsed)) {
        filters = parsed.filter(isEventFilter);
      }
    } catch {
      filters = [];
    }
    return {
      webhook_id: row.webhook_id,
      rotina_id: row.rotina_id,
      owner_kind: row.owner_kind,
      owner_id: row.owner_id,
      route_token: row.route_token,
      url: this.buildWebhookPublicUrl(row.route_token),
      event_type: row.event_type,
      filters,
      ultimo_disparo_em: row.ultimo_disparo_em,
      vault_secret_key: row.vault_secret_key,
    };
  }

  private mapRoutineRow(row: RoutineRow, webhook?: RoutineWebhookConfig | null): AgentRoutine {
    let schedule: RoutineSchedule | null = null;
    if (row.schedule_json) {
      try {
        const parsed = JSON.parse(row.schedule_json);
        if (isRoutineSchedule(parsed)) {
          schedule = parsed;
        }
      } catch {
        schedule = null;
      }
    }

    let destino: RoutineResultDestination | null = null;
    if (row.destino_resultado_json) {
      try {
        const parsed = JSON.parse(row.destino_resultado_json);
        if (isRoutineResultDestination(parsed)) {
          destino = parsed;
        }
      } catch {
        destino = null;
      }
    }

    return {
      rotina_id: row.rotina_id,
      owner_kind: row.owner_kind,
      owner_id: row.owner_id,
      nome: row.nome,
      instrucao: row.instrucao,
      ativa: row.ativa === 1,
      timezone: row.timezone,
      trigger_kind: row.trigger_kind,
      schedule,
      next_run_at: row.next_run_at,
      webhook: webhook ?? null,
      limit_policy: row.limit_policy,
      missed_policy: row.missed_policy,
      run_in: row.run_in,
      destino_resultado: destino,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  private mapRunRow(row: RoutineRunRow): RoutineRun {
    return {
      execucao_id: row.execucao_id,
      rotina_id: row.rotina_id,
      owner_kind: row.owner_kind,
      owner_id: row.owner_id,
      run_kind: row.run_kind,
      run_source: row.run_source,
      scheduled_for: row.scheduled_for,
      rotina_nome: row.rotina_nome,
      instrucao: row.instrucao,
      tarefa_id: row.tarefa_id,
      thread_id: row.thread_id,
      status: row.status,
      silenciada: row.silenciada === 1,
      erro: row.erro,
      missed_count: row.missed_count,
      missed_until: row.missed_until,
      resultado_resumo: row.resultado_resumo,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  private mapReceiptRow(row: WebhookReceiptRow): WebhookReceipt {
    return {
      recibo_id: row.recibo_id,
      rotina_id: row.rotina_id,
      owner_kind: row.owner_kind,
      delivery_id: row.delivery_id,
      event_type: row.event_type,
      status: row.status,
      reason: row.reason,
      execucao_id: row.execucao_id,
      recebido_em: row.recebido_em,
    };
  }

  private mapDeliveryRow(row: DeliveryRow): RoutineResultDelivery {
    return {
      execucao_id: row.execucao_id,
      rotina_id: row.rotina_id,
      owner_id: row.owner_id,
      destino_tipo: row.destino_tipo,
      destino_id: row.destino_id,
      destino_nome: row.destino_nome,
      conteudo_texto: row.conteudo_texto,
      status: row.status,
      motivo_falha: row.motivo_falha,
      tentativas: row.tentativas,
      proximo_envio_em: row.proximo_envio_em,
      expira_em: row.expira_em,
      enviado_em: row.enviado_em,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  private loadWebhooksMap(): Map<string, RoutineWebhookConfig> {
    const rows = this.db.connection
      .prepare(`SELECT * FROM projecao_rotina_webhooks;`)
      .all() as unknown as WebhookRow[];
    const map = new Map<string, RoutineWebhookConfig>();
    for (const row of rows) {
      const mapped = this.mapWebhookRow(row);
      map.set(row.rotina_id, {
        webhook_id: mapped.webhook_id,
        route_token: mapped.route_token,
        url: mapped.url,
        event_type: mapped.event_type,
        filters: mapped.filters,
        ultimo_disparo_em: mapped.ultimo_disparo_em,
      });
    }
    return map;
  }

  public listAll(): AgentRoutine[] {
    const webhooks = this.loadWebhooksMap();
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_agente_rotinas
        ORDER BY atualizado_em DESC, rotina_id ASC;
      `
      )
      .all() as unknown as RoutineRow[];
    return rows.map((row) => this.mapRoutineRow(row, webhooks.get(row.rotina_id) ?? null));
  }

  public listByOwner(ownerKind: RoutineOwnerKind, ownerId: string): AgentRoutine[] {
    const webhooks = this.loadWebhooksMap();
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_agente_rotinas
        WHERE owner_kind = ? AND owner_id = ?
        ORDER BY atualizado_em DESC, rotina_id ASC;
      `
      )
      .all(ownerKind, ownerId) as unknown as RoutineRow[];
    return rows.map((row) => this.mapRoutineRow(row, webhooks.get(row.rotina_id) ?? null));
  }

  public getById(rotinaId: string): AgentRoutine | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_agente_rotinas WHERE rotina_id = ? LIMIT 1;`)
      .get(rotinaId) as unknown as RoutineRow | undefined;
    if (!row) return null;
    const wh = this.getWebhookByRoutine(rotinaId);
    const publicWh: RoutineWebhookConfig | null = wh
      ? {
          webhook_id: wh.webhook_id,
          route_token: wh.route_token,
          url: wh.url,
          event_type: wh.event_type,
          filters: wh.filters,
          ultimo_disparo_em: wh.ultimo_disparo_em,
        }
      : null;
    return this.mapRoutineRow(row, publicWh);
  }


  private deps(): RoutineStoreDeps {
    return {
      db: this.db,
      buildWebhookPublicUrl: this.buildWebhookPublicUrl.bind(this),
      mapWebhookRow: this.mapWebhookRow.bind(this),
      mapRoutineRow: this.mapRoutineRow.bind(this),
      mapRunRow: this.mapRunRow.bind(this),
      mapReceiptRow: this.mapReceiptRow.bind(this),
      mapDeliveryRow: this.mapDeliveryRow.bind(this),
      loadWebhooksMap: this.loadWebhooksMap.bind(this),
      listByOwner: this.listByOwner.bind(this),
      getById: this.getById.bind(this),
    };
  }

  public getByName(...args: TailArgs<typeof crudOps.getByNameOp>): AgentRoutine | null {
    return crudOps.getByNameOp(this.deps(), ...args);
  }

  public createRoutine(...args: TailArgs<typeof crudOps.createRoutineOp>): AgentRoutine {
    return crudOps.createRoutineOp(this.deps(), ...args);
  }

  public updateRoutine(...args: TailArgs<typeof crudOps.updateRoutineOp>): AgentRoutine {
    return crudOps.updateRoutineOp(this.deps(), ...args);
  }

  public deleteRoutine(...args: TailArgs<typeof crudOps.deleteRoutineOp>): boolean {
    return crudOps.deleteRoutineOp(this.deps(), ...args);
  }

  public listDueScheduledRoutines(...args: TailArgs<typeof crudOps.listDueScheduledRoutinesOp>): AgentRoutine[] {
    return crudOps.listDueScheduledRoutinesOp(this.deps(), ...args);
  }

  public getEarliestNextRunAt(...args: TailArgs<typeof crudOps.getEarliestNextRunAtOp>): string | null {
    return crudOps.getEarliestNextRunAtOp(this.deps(), ...args);
  }

  public advanceRoutineSchedule(...args: TailArgs<typeof crudOps.advanceRoutineScheduleOp>): void {
    return crudOps.advanceRoutineScheduleOp(this.deps(), ...args);
  }

  public createRun(...args: TailArgs<typeof runsOps.createRunOp>): RoutineRun | null {
    return runsOps.createRunOp(this.deps(), ...args);
  }

  public updateRun(...args: TailArgs<typeof runsOps.updateRunOp>): RoutineRun | null {
    return runsOps.updateRunOp(this.deps(), ...args);
  }

  public getRun(...args: TailArgs<typeof runsOps.getRunOp>): RoutineRun | null {
    return runsOps.getRunOp(this.deps(), ...args);
  }

  public getRunByTaskId(...args: TailArgs<typeof runsOps.getRunByTaskIdOp>): RoutineRun | null {
    return runsOps.getRunByTaskIdOp(this.deps(), ...args);
  }

  public listRuns(...args: TailArgs<typeof runsOps.listRunsOp>): RoutineRun[] {
    return runsOps.listRunsOp(this.deps(), ...args);
  }

  public listRunsInRange(...args: TailArgs<typeof runsOps.listRunsInRangeOp>): RoutineRun[] {
    return runsOps.listRunsInRangeOp(this.deps(), ...args);
  }

  public hasOpenRun(...args: TailArgs<typeof runsOps.hasOpenRunOp>): boolean {
    return runsOps.hasOpenRunOp(this.deps(), ...args);
  }

  public listOpenRuns(...args: TailArgs<typeof runsOps.listOpenRunsOp>): RoutineRun[] {
    return runsOps.listOpenRunsOp(this.deps(), ...args);
  }

  public upsertWebhook(...args: TailArgs<typeof runsOps.upsertWebhookOp>): WebhookRowWithSecretKey {
    return runsOps.upsertWebhookOp(this.deps(), ...args);
  }

  public deleteWebhookByRoutine(...args: TailArgs<typeof runsOps.deleteWebhookByRoutineOp>): boolean {
    return runsOps.deleteWebhookByRoutineOp(this.deps(), ...args);
  }

  public getWebhookByRoutine(...args: TailArgs<typeof runsOps.getWebhookByRoutineOp>): WebhookRowWithSecretKey | null {
    return runsOps.getWebhookByRoutineOp(this.deps(), ...args);
  }

  public getWebhookByToken(...args: TailArgs<typeof runsOps.getWebhookByTokenOp>): WebhookRowWithSecretKey | null {
    return runsOps.getWebhookByTokenOp(this.deps(), ...args);
  }

  public touchWebhookLastTrigger(...args: TailArgs<typeof runsOps.touchWebhookLastTriggerOp>): void {
    return runsOps.touchWebhookLastTriggerOp(this.deps(), ...args);
  }

  public pruneExpiredReceipts(...args: TailArgs<typeof runsOps.pruneExpiredReceiptsOp>): number {
    return runsOps.pruneExpiredReceiptsOp(this.deps(), ...args);
  }

  public hasWebhookReceipt(...args: TailArgs<typeof runsOps.hasWebhookReceiptOp>): boolean {
    return runsOps.hasWebhookReceiptOp(this.deps(), ...args);
  }

  public recordWebhookReceipt(...args: TailArgs<typeof runsOps.recordWebhookReceiptOp>): WebhookReceipt {
    return runsOps.recordWebhookReceiptOp(this.deps(), ...args);
  }

  public listWebhookReceipts(...args: TailArgs<typeof runsOps.listWebhookReceiptsOp>): WebhookReceipt[] {
    return runsOps.listWebhookReceiptsOp(this.deps(), ...args);
  }

  public upsertDelivery(...args: TailArgs<typeof runsOps.upsertDeliveryOp>): RoutineResultDelivery {
    return runsOps.upsertDeliveryOp(this.deps(), ...args);
  }

  public getDelivery(...args: TailArgs<typeof runsOps.getDeliveryOp>): RoutineResultDelivery | null {
    return runsOps.getDeliveryOp(this.deps(), ...args);
  }

  public listDeliveriesByRoutine(...args: TailArgs<typeof runsOps.listDeliveriesByRoutineOp>): RoutineResultDelivery[] {
    return runsOps.listDeliveriesByRoutineOp(this.deps(), ...args);
  }

  public listPendingDeliveries(...args: TailArgs<typeof runsOps.listPendingDeliveriesOp>): RoutineResultDelivery[] {
    return runsOps.listPendingDeliveriesOp(this.deps(), ...args);
  }
}
