import { randomUUID, } from "node:crypto";
import {
  isRoutineResultDestination, isRoutineSchedule, isValidIanaTimeZone, type AgentRoutine, type RoutineLimitPolicy, type RoutineMissedPolicy, type RoutineOwnerKind, type RoutineRunPlace, type RoutineSchedule, } from "@criativo/contracts";
import type { RoutineStoreDeps, RoutineRow, CreateRoutineStoreInput, UpdateRoutineStoreInput } from "./routine-store-types.ts";
import { RoutineStoreError } from "./routine-store-types.ts";
import { upsertWebhookInternalOp, deleteWebhookByRoutineOp, getWebhookByRoutineOp } from "./routine-runs-deliveries-ops.ts";

export function getByNameOp(deps: RoutineStoreDeps, ownerKind: RoutineOwnerKind,
    ownerId: string,
    nome: string): AgentRoutine | null {
  const normalized = nome.trim().toLowerCase();
  const rows = deps.listByOwner(ownerKind, ownerId);
  return rows.find((r) => r.nome.trim().toLowerCase() === normalized) ?? null;
}

export function assertUniqueNameOp(deps: RoutineStoreDeps, ownerKind: RoutineOwnerKind,
    ownerId: string,
    nome: string,
    excludeRotinaId?: string): void {
  const existing = getByNameOp(deps, ownerKind, ownerId, nome);
  if (existing && existing.rotina_id !== excludeRotinaId) {
    throw new RoutineStoreError(
      `Já existe uma rotina chamada "${nome.trim()}" neste ${ownerKind}.`,
      "ROUTINE_NAME_CONFLICT",
      409
    );
  }
}

export function createRoutineOp(deps: RoutineStoreDeps, input: CreateRoutineStoreInput): AgentRoutine {
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

  return deps.db.runInTransaction(() => {
    assertUniqueNameOp(deps, input.owner_kind, input.owner_id, nome);

    deps.db.connection
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
      upsertWebhookInternalOp(deps, {
        rotina_id: rotinaId,
        owner_kind: input.owner_kind,
        owner_id: input.owner_id,
        event_type: input.webhook_event_type ?? null,
        filters: input.webhook_filters ?? [],
      });
    }

    const created = deps.getById(rotinaId);
    if (!created) {
      throw new RoutineStoreError("Falha ao recuperar rotina recém-criada.", "INTERNAL_ERROR", 500);
    }
    return created;
  });
}

export function updateRoutineOp(deps: RoutineStoreDeps, rotinaId: string, patch: UpdateRoutineStoreInput): AgentRoutine {
  const current = deps.getById(rotinaId);
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

  return deps.db.runInTransaction(() => {
    assertUniqueNameOp(deps, current.owner_kind, current.owner_id, nextNome, rotinaId);

    deps.db.connection
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
      const existingWh = getWebhookByRoutineOp(deps, rotinaId);
      if (
        !existingWh ||
        patch.webhook_event_type !== undefined ||
        patch.webhook_filters !== undefined
      ) {
        upsertWebhookInternalOp(deps, {
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
      deleteWebhookByRoutineOp(deps, rotinaId);
    }

    const updated = deps.getById(rotinaId);
    if (!updated) {
      throw new RoutineStoreError("Rotina não encontrada após atualização.", "INTERNAL_ERROR", 500);
    }
    return updated;
  });
}

export function deleteRoutineOp(deps: RoutineStoreDeps, rotinaId: string): boolean {
  const result = deps.db.connection
    .prepare(`DELETE FROM projecao_agente_rotinas WHERE rotina_id = ?;`)
    .run(rotinaId);
  return Number(result.changes ?? 0) > 0;
}

export function listDueScheduledRoutinesOp(deps: RoutineStoreDeps, nowIso: string): AgentRoutine[] {
  const webhooks = deps.loadWebhooksMap();
  const rows = deps.db.connection
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
  return rows.map((row) => deps.mapRoutineRow(row, webhooks.get(row.rotina_id) ?? null));
}

export function getEarliestNextRunAtOp(deps: RoutineStoreDeps): string | null {
  const row = deps.db.connection
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

export function advanceRoutineScheduleOp(deps: RoutineStoreDeps, rotinaId: string,
    nextRunAt: string | null,
    deactivateOnce = false): void {
  const agora = new Date().toISOString();
  if (deactivateOnce) {
    deps.db.connection
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

  deps.db.connection
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

