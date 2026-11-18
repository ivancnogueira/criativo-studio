import { randomBytes, randomUUID } from "node:crypto";
import {
  isEventFilter,
  isRoutineResultDestination,
  isRoutineSchedule,
  isValidIanaTimeZone,
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
  type RoutineSchedule,
  type RoutineWebhookConfig,
  type SaveAgentRoutineInput,
  type UpdateAgentRoutineInput,
  type WebhookReceipt,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

interface RoutineRow {
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

interface WebhookRow {
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

interface RoutineRunRow {
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

interface WebhookReceiptRow {
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

interface DeliveryRow {
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

  public getByName(
    ownerKind: RoutineOwnerKind,
    ownerId: string,
    nome: string
  ): AgentRoutine | null {
    const normalized = nome.trim().toLowerCase();
    const rows = this.listByOwner(ownerKind, ownerId);
    return rows.find((r) => r.nome.trim().toLowerCase() === normalized) ?? null;
  }

  private assertUniqueName(
    ownerKind: RoutineOwnerKind,
    ownerId: string,
    nome: string,
    excludeRotinaId?: string
  ): void {
    const existing = this.getByName(ownerKind, ownerId, nome);
    if (existing && existing.rotina_id !== excludeRotinaId) {
      throw new RoutineStoreError(
        `Já existe uma rotina chamada "${nome.trim()}" neste ${ownerKind}.`,
        "ROUTINE_NAME_CONFLICT",
        409
      );
    }
  }

  public createRoutine(input: CreateRoutineStoreInput): AgentRoutine {
    const nome = input.nome?.trim();
    const instrucao = input.instrucao?.trim();
    if (!nome) {
      throw new RoutineStoreError("Nome da rotina é obrigatório.", "INVALID_ROUTINE_NAME");
    }
    if (!instrucao) {
      throw new RoutineStoreError("Instrução da rotina é obrigatória.", "INVALID_ROUTINE_PROMPT");
    }

    const timezone =
      input.timezone && isValidIanaTimeZone(input.timezone)
        ? input.timezone.trim()
        : "America/Sao_Paulo";

    let schedule: RoutineSchedule | null = null;
    if (input.trigger_kind === "schedule") {
      if (!input.schedule || !isRoutineSchedule(input.schedule)) {
        throw new RoutineStoreError(
          "Agendamento (schedule) inválido ou abaixo do intervalo mínimo de 3 minutos.",
          "INVALID_ROUTINE_SCHEDULE"
        );
      }
      schedule = input.schedule;
    }

    const isOnce = schedule?.kind === "once";
    const limitPolicy: RoutineLimitPolicy = isOnce ? "wait" : (input.limit_policy ?? "wait");
    const missedPolicy: RoutineMissedPolicy =
      input.missed_policy ?? (isOnce ? "run-once" : "skip");
    const runIn: RoutineRunPlace = input.run_in === "side_thread" ? "side_thread" : "chat";
    const ativa = input.ativa === false ? 0 : 1;

    let destinoJson: string | null = null;
    if (input.destino_resultado) {
      if (!isRoutineResultDestination(input.destino_resultado)) {
        throw new RoutineStoreError(
          "Destino de resultado de rotina inválido.",
          "INVALID_DESTINATION"
        );
      }
      destinoJson =
        input.destino_resultado.tipo === "none"
          ? null
          : JSON.stringify(input.destino_resultado);
    }

    const rotinaId = input.rotina_id ?? `rot-${randomUUID()}`;
    const agora = new Date().toISOString();

    return this.db.runInTransaction(() => {
      this.assertUniqueName(input.owner_kind, input.owner_id, nome);

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_agente_rotinas (
            rotina_id, owner_kind, owner_id, nome, instrucao, ativa, timezone,
            trigger_kind, schedule_json, next_run_at, limit_policy, missed_policy,
            run_in, destino_resultado_json, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `
        )
        .run(
          rotinaId,
          input.owner_kind,
          input.owner_id,
          nome,
          instrucao,
          ativa,
          timezone,
          input.trigger_kind,
          schedule ? JSON.stringify(schedule) : null,
          input.trigger_kind === "schedule" ? (input.next_run_at ?? null) : null,
          limitPolicy,
          missedPolicy,
          runIn,
          destinoJson,
          agora,
          agora
        );

      if (input.trigger_kind === "webhook") {
        this.upsertWebhookInternal({
          rotina_id: rotinaId,
          owner_kind: input.owner_kind,
          owner_id: input.owner_id,
          event_type: input.webhook_event_type ?? null,
          filters: input.webhook_filters ?? [],
        });
      }

      const created = this.getById(rotinaId);
      if (!created) {
        throw new RoutineStoreError("Falha ao recuperar rotina recém-criada.", "INTERNAL_ERROR", 500);
      }
      return created;
    });
  }

  public updateRoutine(rotinaId: string, patch: UpdateRoutineStoreInput): AgentRoutine {
    const current = this.getById(rotinaId);
    if (!current) {
      throw new RoutineStoreError(
        `Rotina '${rotinaId}' não encontrada.`,
        "ROUTINE_NOT_FOUND",
        404
      );
    }

    const nextNome = patch.nome !== undefined ? patch.nome.trim() : current.nome;
    const nextInstrucao =
      patch.instrucao !== undefined ? patch.instrucao.trim() : current.instrucao;
    if (!nextNome) {
      throw new RoutineStoreError("Nome da rotina não pode ser vazio.", "INVALID_ROUTINE_NAME");
    }
    if (!nextInstrucao) {
      throw new RoutineStoreError("Instrução da rotina não pode ser vazia.", "INVALID_ROUTINE_PROMPT");
    }

    const nextTriggerKind = patch.trigger_kind ?? current.trigger_kind;
    let nextSchedule: RoutineSchedule | null =
      patch.schedule !== undefined ? patch.schedule : current.schedule;
    if (nextTriggerKind === "schedule") {
      if (!nextSchedule || !isRoutineSchedule(nextSchedule)) {
        throw new RoutineStoreError(
          "Agendamento inválido ou abaixo do intervalo mínimo de 3 minutos.",
          "INVALID_ROUTINE_SCHEDULE"
        );
      }
    } else {
      nextSchedule = null;
    }

    const nextTimezone =
      patch.timezone !== undefined
        ? isValidIanaTimeZone(patch.timezone)
          ? patch.timezone.trim()
          : current.timezone
        : current.timezone;

    const isOnce = nextSchedule?.kind === "once";
    const nextLimitPolicy: RoutineLimitPolicy = isOnce
      ? "wait"
      : (patch.limit_policy ?? current.limit_policy);
    const nextMissedPolicy: RoutineMissedPolicy = patch.missed_policy ?? current.missed_policy;
    const nextRunIn: RoutineRunPlace = patch.run_in ?? current.run_in;
    const nextAtiva = patch.ativa !== undefined ? patch.ativa : current.ativa;

    let nextDestinoJson: string | null = current.destino_resultado
      ? JSON.stringify(current.destino_resultado)
      : null;
    if (patch.destino_resultado !== undefined) {
      if (patch.destino_resultado === null || patch.destino_resultado.tipo === "none") {
        nextDestinoJson = null;
      } else {
        if (!isRoutineResultDestination(patch.destino_resultado)) {
          throw new RoutineStoreError("Destino de entrega inválido.", "INVALID_DESTINATION");
        }
        nextDestinoJson = JSON.stringify(patch.destino_resultado);
      }
    }

    const nextRunAt =
      nextTriggerKind === "schedule"
        ? patch.next_run_at !== undefined
          ? patch.next_run_at
          : current.next_run_at
        : null;

    const agora = new Date().toISOString();

    return this.db.runInTransaction(() => {
      this.assertUniqueName(current.owner_kind, current.owner_id, nextNome, rotinaId);

      this.db.connection
        .prepare(
          `
          UPDATE projecao_agente_rotinas
          SET nome = ?,
              instrucao = ?,
              ativa = ?,
              timezone = ?,
              trigger_kind = ?,
              schedule_json = ?,
              next_run_at = ?,
              limit_policy = ?,
              missed_policy = ?,
              run_in = ?,
              destino_resultado_json = ?,
              atualizado_em = ?
          WHERE rotina_id = ?;
        `
        )
        .run(
          nextNome,
          nextInstrucao,
          nextAtiva ? 1 : 0,
          nextTimezone,
          nextTriggerKind,
          nextSchedule ? JSON.stringify(nextSchedule) : null,
          nextRunAt,
          nextLimitPolicy,
          nextMissedPolicy,
          nextRunIn,
          nextDestinoJson,
          agora,
          rotinaId
        );

      if (nextTriggerKind === "webhook") {
        const existingWh = this.getWebhookByRoutine(rotinaId);
        if (
          !existingWh ||
          patch.webhook_event_type !== undefined ||
          patch.webhook_filters !== undefined
        ) {
          this.upsertWebhookInternal({
            rotina_id: rotinaId,
            owner_kind: current.owner_kind,
            owner_id: current.owner_id,
            event_type:
              patch.webhook_event_type !== undefined
                ? patch.webhook_event_type
                : existingWh?.event_type ?? null,
            filters:
              patch.webhook_filters !== undefined
                ? patch.webhook_filters
                : existingWh?.filters ?? [],
          });
        }
      } else {
        this.deleteWebhookByRoutine(rotinaId);
      }

      const updated = this.getById(rotinaId);
      if (!updated) {
        throw new RoutineStoreError("Rotina não encontrada após atualização.", "INTERNAL_ERROR", 500);
      }
      return updated;
    });
  }

  public deleteRoutine(rotinaId: string): boolean {
    const result = this.db.connection
      .prepare(`DELETE FROM projecao_agente_rotinas WHERE rotina_id = ?;`)
      .run(rotinaId);
    return Number(result.changes ?? 0) > 0;
  }

  public listDueScheduledRoutines(nowIso: string): AgentRoutine[] {
    const webhooks = this.loadWebhooksMap();
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_agente_rotinas
        WHERE ativa = 1
          AND trigger_kind = 'schedule'
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC, rotina_id ASC;
      `
      )
      .all(nowIso) as unknown as RoutineRow[];
    return rows.map((row) => this.mapRoutineRow(row, webhooks.get(row.rotina_id) ?? null));
  }

  public getEarliestNextRunAt(): string | null {
    const row = this.db.connection
      .prepare(
        `
        SELECT next_run_at FROM projecao_agente_rotinas
        WHERE ativa = 1
          AND trigger_kind = 'schedule'
          AND next_run_at IS NOT NULL
        ORDER BY next_run_at ASC
        LIMIT 1;
      `
      )
      .get() as { next_run_at?: string | null } | undefined;
    return row?.next_run_at ?? null;
  }

  public advanceRoutineSchedule(
    rotinaId: string,
    nextRunAt: string | null,
    deactivateOnce = false
  ): void {
    const agora = new Date().toISOString();
    if (deactivateOnce) {
      this.db.connection
        .prepare(
          `
          UPDATE projecao_agente_rotinas
          SET ativa = 0,
              next_run_at = ?,
              atualizado_em = ?
          WHERE rotina_id = ?;
        `
        )
        .run(nextRunAt, agora, rotinaId);
      return;
    }

    this.db.connection
      .prepare(
        `
        UPDATE projecao_agente_rotinas
        SET next_run_at = ?,
            atualizado_em = ?
        WHERE rotina_id = ?;
      `
      )
      .run(nextRunAt, agora, rotinaId);
  }

  // ====================================================================
  // Execuções (`projecao_rotina_execucoes`)
  // ====================================================================

  public createRun(input: CreateRoutineRunInput): RoutineRun | null {
    const execucaoId = input.execucao_id ?? `run-${randomUUID()}`;
    const agora = input.criado_em ?? new Date().toISOString();

    const stmt = this.db.connection.prepare(
      `
      INSERT OR IGNORE INTO projecao_rotina_execucoes (
        execucao_id, rotina_id, owner_kind, owner_id, run_kind, run_source,
        scheduled_for, rotina_nome, instrucao, tarefa_id, thread_id, status,
        silenciada, erro, missed_count, missed_until, resultado_resumo,
        criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `
    );

    const res = stmt.run(
      execucaoId,
      input.rotina_id,
      input.owner_kind,
      input.owner_id,
      input.run_kind,
      input.run_source ?? null,
      input.scheduled_for,
      input.rotina_nome,
      input.instrucao,
      input.tarefa_id ?? null,
      input.thread_id ?? null,
      input.status,
      input.silenciada ? 1 : 0,
      input.erro ?? null,
      input.missed_count ?? null,
      input.missed_until ?? null,
      input.resultado_resumo ?? null,
      agora,
      agora
    );

    if (Number(res.changes ?? 0) === 0) {
      return null;
    }

    return this.getRun(execucaoId);
  }

  public updateRun(execucaoId: string, patch: UpdateRoutineRunPatch): RoutineRun | null {
    const existing = this.getRun(execucaoId);
    if (!existing) return null;

    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        UPDATE projecao_rotina_execucoes
        SET status = ?,
            tarefa_id = ?,
            thread_id = ?,
            silenciada = ?,
            erro = ?,
            resultado_resumo = ?,
            atualizado_em = ?
        WHERE execucao_id = ?;
      `
      )
      .run(
        patch.status ?? existing.status,
        patch.tarefa_id !== undefined ? patch.tarefa_id : existing.tarefa_id,
        patch.thread_id !== undefined ? patch.thread_id : existing.thread_id,
        patch.silenciada !== undefined ? (patch.silenciada ? 1 : 0) : existing.silenciada ? 1 : 0,
        patch.erro !== undefined ? patch.erro : existing.erro,
        patch.resultado_resumo !== undefined ? patch.resultado_resumo : existing.resultado_resumo,
        agora,
        execucaoId
      );

    return this.getRun(execucaoId);
  }

  public getRun(execucaoId: string): RoutineRun | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_rotina_execucoes WHERE execucao_id = ? LIMIT 1;`)
      .get(execucaoId) as unknown as RoutineRunRow | undefined;
    return row ? this.mapRunRow(row) : null;
  }

  public getRunByTaskId(tarefaId: string): RoutineRun | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_rotina_execucoes WHERE tarefa_id = ? LIMIT 1;`)
      .get(tarefaId) as unknown as RoutineRunRow | undefined;
    return row ? this.mapRunRow(row) : null;
  }

  public listRuns(
    rotinaId: string,
    options: { limit?: number; withSkipped?: boolean } = {}
  ): RoutineRun[] {
    const limit = Math.max(1, Math.min(200, options.limit ?? 20));
    const whereMissed = options.withSkipped ? "" : "AND missed_count IS NULL";
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_rotina_execucoes
        WHERE rotina_id = ? ${whereMissed}
        ORDER BY criado_em DESC, execucao_id DESC
        LIMIT ?;
      `
      )
      .all(rotinaId, limit) as unknown as RoutineRunRow[];
    return rows.map((row) => this.mapRunRow(row));
  }

  public listRunsInRange(fromIso: string, toIso: string): RoutineRun[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_rotina_execucoes
        WHERE scheduled_for >= ? AND scheduled_for <= ?
        ORDER BY scheduled_for ASC, criado_em ASC;
      `
      )
      .all(fromIso, toIso) as unknown as RoutineRunRow[];
    return rows.map((row) => this.mapRunRow(row));
  }

  public hasOpenRun(rotinaId: string): boolean {
    const row = this.db.connection
      .prepare(
        `
        SELECT 1 AS aberto FROM projecao_rotina_execucoes
        WHERE rotina_id = ?
          AND status IN ('queued', 'running', 'needs-attention')
        LIMIT 1;
      `
      )
      .get(rotinaId) as { aberto?: number } | undefined;
    return row?.aberto === 1;
  }

  public listOpenRuns(): RoutineRun[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_rotina_execucoes
        WHERE status IN ('queued', 'running', 'needs-attention')
        ORDER BY criado_em ASC;
      `
      )
      .all() as unknown as RoutineRunRow[];
    return rows.map((row) => this.mapRunRow(row));
  }

  // ====================================================================
  // Webhooks e Recibos (`projecao_rotina_webhooks`, `projecao_webhook_recibos`)
  // ====================================================================

  private upsertWebhookInternal(input: UpsertWebhookInput): WebhookRowWithSecretKey {
    const filters = (input.filters ?? []).filter(isEventFilter);
    const agora = new Date().toISOString();
    const existing = this.getWebhookByRoutine(input.rotina_id);

    if (existing) {
      const nextToken = input.route_token ?? existing.route_token;
      const nextEventType =
        input.event_type !== undefined ? input.event_type : existing.event_type;
      const nextFilters = input.filters !== undefined ? filters : existing.filters;
      const nextSecretKey = input.vault_secret_key ?? existing.vault_secret_key;

      this.db.connection
        .prepare(
          `
          UPDATE projecao_rotina_webhooks
          SET route_token = ?,
              event_type = ?,
              filters_json = ?,
              vault_secret_key = ?,
              atualizado_em = ?
          WHERE rotina_id = ?;
        `
        )
        .run(
          nextToken,
          nextEventType,
          JSON.stringify(nextFilters),
          nextSecretKey,
          agora,
          input.rotina_id
        );

      return this.getWebhookByRoutine(input.rotina_id)!;
    }

    const webhookId = `whr-${randomUUID()}`;
    const routeToken = input.route_token ?? randomBytes(24).toString("base64url");
    const vaultSecretKey = input.vault_secret_key ?? `webhook_rotina_${input.rotina_id}`;

    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_rotina_webhooks (
          webhook_id, rotina_id, owner_kind, owner_id, route_token,
          event_type, filters_json, vault_secret_key, ultimo_disparo_em,
          criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);
      `
      )
      .run(
        webhookId,
        input.rotina_id,
        input.owner_kind,
        input.owner_id,
        routeToken,
        input.event_type ?? null,
        JSON.stringify(filters),
        vaultSecretKey,
        agora,
        agora
      );

    return this.getWebhookByRoutine(input.rotina_id)!;
  }

  public upsertWebhook(input: UpsertWebhookInput): WebhookRowWithSecretKey {
    return this.upsertWebhookInternal(input);
  }

  public deleteWebhookByRoutine(rotinaId: string): boolean {
    const res = this.db.connection
      .prepare(`DELETE FROM projecao_rotina_webhooks WHERE rotina_id = ?;`)
      .run(rotinaId);
    return Number(res.changes ?? 0) > 0;
  }

  public getWebhookByRoutine(rotinaId: string): WebhookRowWithSecretKey | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_rotina_webhooks WHERE rotina_id = ? LIMIT 1;`)
      .get(rotinaId) as unknown as WebhookRow | undefined;
    return row ? this.mapWebhookRow(row) : null;
  }

  public getWebhookByToken(routeToken: string): WebhookRowWithSecretKey | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_rotina_webhooks WHERE route_token = ? LIMIT 1;`)
      .get(routeToken) as unknown as WebhookRow | undefined;
    return row ? this.mapWebhookRow(row) : null;
  }

  public touchWebhookLastTrigger(rotinaId: string, iso: string): void {
    this.db.connection
      .prepare(
        `
        UPDATE projecao_rotina_webhooks
        SET ultimo_disparo_em = ?, atualizado_em = ?
        WHERE rotina_id = ?;
      `
      )
      .run(iso, iso, rotinaId);
  }

  public pruneExpiredReceipts(retentionDays = 7): number {
    const cutoffIso = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const res = this.db.connection
      .prepare(`DELETE FROM projecao_webhook_recibos WHERE recebido_em < ?;`)
      .run(cutoffIso);
    return Number(res.changes ?? 0);
  }

  public hasWebhookReceipt(
    ownerKind: RoutineOwnerKind,
    rotinaId: string,
    deliveryId: string
  ): boolean {
    const cutoffIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const row = this.db.connection
      .prepare(
        `
        SELECT 1 AS existe FROM projecao_webhook_recibos
        WHERE owner_kind = ? AND rotina_id = ? AND delivery_id = ? AND recebido_em >= ?
        LIMIT 1;
      `
      )
      .get(ownerKind, rotinaId, deliveryId, cutoffIso) as { existe?: number } | undefined;
    return row?.existe === 1;
  }

  public recordWebhookReceipt(input: RecordWebhookReceiptInput): WebhookReceipt {
    const reciboId = input.recibo_id ?? `rcb-${randomUUID()}`;
    const recebidoEm = input.recebido_em ?? new Date().toISOString();

    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_webhook_recibos (
          recibo_id, rotina_id, owner_kind, delivery_id, event_type,
          status, reason, execucao_id, recebido_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
      )
      .run(
        reciboId,
        input.rotina_id,
        input.owner_kind,
        input.delivery_id,
        input.event_type,
        input.status,
        input.reason ?? null,
        input.execucao_id ?? null,
        recebidoEm
      );

    return {
      recibo_id: reciboId,
      rotina_id: input.rotina_id,
      owner_kind: input.owner_kind,
      delivery_id: input.delivery_id,
      event_type: input.event_type,
      status: input.status,
      reason: input.reason ?? null,
      execucao_id: input.execucao_id ?? null,
      recebido_em: recebidoEm,
    };
  }

  public listWebhookReceipts(rotinaId: string, limit = 25): WebhookReceipt[] {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_webhook_recibos
        WHERE rotina_id = ?
        ORDER BY recebido_em DESC, recibo_id DESC
        LIMIT ?;
      `
      )
      .all(rotinaId, safeLimit) as unknown as WebhookReceiptRow[];
    return rows.map((row) => this.mapReceiptRow(row));
  }

  // ====================================================================
  // Entregas Externas (`projecao_rotina_entregas`)
  // ====================================================================

  public upsertDelivery(input: UpsertDeliveryInput): RoutineResultDelivery {
    const agora = new Date().toISOString();
    const existing = this.getDelivery(input.execucao_id);
    const criadoEm = existing?.criado_em ?? agora;

    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_rotina_entregas (
          execucao_id, rotina_id, owner_id, destino_tipo, destino_id, destino_nome,
          conteudo_texto, status, motivo_falha, tentativas, proximo_envio_em,
          expira_em, enviado_em, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(execucao_id) DO UPDATE SET
          destino_tipo = excluded.destino_tipo,
          destino_id = excluded.destino_id,
          destino_nome = excluded.destino_nome,
          conteudo_texto = COALESCE(excluded.conteudo_texto, projecao_rotina_entregas.conteudo_texto),
          status = excluded.status,
          motivo_falha = excluded.motivo_falha,
          tentativas = excluded.tentativas,
          proximo_envio_em = excluded.proximo_envio_em,
          expira_em = excluded.expira_em,
          enviado_em = excluded.enviado_em,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(
        input.execucao_id,
        input.rotina_id,
        input.owner_id,
        input.destino_tipo,
        input.destino_id,
        input.destino_nome,
        input.conteudo_texto ?? existing?.conteudo_texto ?? null,
        input.status,
        input.motivo_falha ?? null,
        input.tentativas ?? existing?.tentativas ?? 0,
        input.proximo_envio_em ?? null,
        input.expira_em ?? existing?.expira_em ?? new Date(Date.now() + 86_400_000).toISOString(),
        input.enviado_em ?? null,
        criadoEm,
        agora
      );

    return this.getDelivery(input.execucao_id)!;
  }

  public getDelivery(execucaoId: string): RoutineResultDelivery | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_rotina_entregas WHERE execucao_id = ? LIMIT 1;`)
      .get(execucaoId) as unknown as DeliveryRow | undefined;
    return row ? this.mapDeliveryRow(row) : null;
  }

  public listDeliveriesByRoutine(rotinaId: string, limit = 25): RoutineResultDelivery[] {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_rotina_entregas
        WHERE rotina_id = ?
        ORDER BY criado_em DESC
        LIMIT ?;
      `
      )
      .all(rotinaId, safeLimit) as unknown as DeliveryRow[];
    return rows.map((row) => this.mapDeliveryRow(row));
  }

  public listPendingDeliveries(nowIso: string): RoutineResultDelivery[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_rotina_entregas
        WHERE status IN ('pending', 'failed')
          AND tentativas < 3
          AND (proximo_envio_em IS NULL OR proximo_envio_em <= ?)
          AND (expira_em IS NULL OR expira_em >= ?)
        ORDER BY criado_em ASC;
      `
      )
      .all(nowIso, nowIso) as unknown as DeliveryRow[];
    return rows.map((row) => this.mapDeliveryRow(row));
  }
}
