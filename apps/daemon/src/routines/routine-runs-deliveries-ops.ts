import { randomBytes, randomUUID, } from "node:crypto";
import {
  isEventFilter, type RoutineOwnerKind, type RoutineResultDelivery, type RoutineRun, type WebhookReceipt, } from "@criativo/contracts";
import type { RoutineStoreDeps, WebhookRow, RoutineRunRow, WebhookReceiptRow, DeliveryRow, CreateRoutineRunInput, UpdateRoutineRunPatch, UpsertWebhookInput, RecordWebhookReceiptInput, UpsertDeliveryInput, WebhookRowWithSecretKey } from "./routine-store-types.ts";

export function createRunOp(deps: RoutineStoreDeps, input: CreateRoutineRunInput): RoutineRun | null {
  const execucaoId = input.execucao_id ?? `run-${randomUUID()}`;
  const agora = input.criado_em ?? new Date().toISOString();

  const stmt = deps.db.connection.prepare(
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

  return getRunOp(deps, execucaoId);
}

export function updateRunOp(deps: RoutineStoreDeps, execucaoId: string, patch: UpdateRoutineRunPatch): RoutineRun | null {
  const existing = getRunOp(deps, execucaoId);
  if (!existing) return null;

  const agora = new Date().toISOString();
  deps.db.connection
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

  return getRunOp(deps, execucaoId);
}

export function getRunOp(deps: RoutineStoreDeps, execucaoId: string): RoutineRun | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_rotina_execucoes WHERE execucao_id = ? LIMIT 1;`)
    .get(execucaoId) as unknown as RoutineRunRow | undefined;
  return row ? deps.mapRunRow(row) : null;
}

export function getRunByTaskIdOp(deps: RoutineStoreDeps, tarefaId: string): RoutineRun | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_rotina_execucoes WHERE tarefa_id = ? LIMIT 1;`)
    .get(tarefaId) as unknown as RoutineRunRow | undefined;
  return row ? deps.mapRunRow(row) : null;
}

export function listRunsOp(deps: RoutineStoreDeps, rotinaId: string,
    options: { limit?: number; withSkipped?: boolean } = {}): RoutineRun[] {
  const limit = Math.max(1, Math.min(200, options.limit ?? 20));
  const whereMissed = options.withSkipped ? "" : "AND missed_count IS NULL";
  const rows = deps.db.connection
    .prepare(
      `
      SELECT * FROM projecao_rotina_execucoes
      WHERE rotina_id = ? ${whereMissed}
      ORDER BY criado_em DESC, execucao_id DESC
      LIMIT ?;
    `
    )
    .all(rotinaId, limit) as unknown as RoutineRunRow[];
  return rows.map((row) => deps.mapRunRow(row));
}

export function listRunsInRangeOp(deps: RoutineStoreDeps, fromIso: string, toIso: string): RoutineRun[] {
  const rows = deps.db.connection
    .prepare(
      `
      SELECT * FROM projecao_rotina_execucoes
      WHERE scheduled_for >= ? AND scheduled_for <= ?
      ORDER BY scheduled_for ASC, criado_em ASC;
    `
    )
    .all(fromIso, toIso) as unknown as RoutineRunRow[];
  return rows.map((row) => deps.mapRunRow(row));
}

export function hasOpenRunOp(deps: RoutineStoreDeps, rotinaId: string): boolean {
  const row = deps.db.connection
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

export function listOpenRunsOp(deps: RoutineStoreDeps): RoutineRun[] {
  const rows = deps.db.connection
    .prepare(
      `
      SELECT * FROM projecao_rotina_execucoes
      WHERE status IN ('queued', 'running', 'needs-attention')
      ORDER BY criado_em ASC;
    `
    )
    .all() as unknown as RoutineRunRow[];
  return rows.map((row) => deps.mapRunRow(row));
}

// ====================================================================
// Webhooks e Recibos (`projecao_rotina_webhooks`, `projecao_webhook_recibos`)
// ====================================================================

export function upsertWebhookInternalOp(deps: RoutineStoreDeps, input: UpsertWebhookInput): WebhookRowWithSecretKey {
  const filters = (input.filters ?? []).filter(isEventFilter);
  const agora = new Date().toISOString();
  const existing = getWebhookByRoutineOp(deps, input.rotina_id);

  if (existing) {
    const nextToken = input.route_token ?? existing.route_token;
    const nextEventType =
      input.event_type !== undefined ? input.event_type : existing.event_type;
    const nextFilters = input.filters !== undefined ? filters : existing.filters;
    const nextSecretKey = input.vault_secret_key ?? existing.vault_secret_key;

    deps.db.connection
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

    return getWebhookByRoutineOp(deps, input.rotina_id)!;
  }

  const webhookId = `whr-${randomUUID()}`;
  const routeToken = input.route_token ?? randomBytes(24).toString("base64url");
  const vaultSecretKey = input.vault_secret_key ?? `webhook_rotina_${input.rotina_id}`;

  deps.db.connection
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

  return getWebhookByRoutineOp(deps, input.rotina_id)!;
}

export function upsertWebhookOp(deps: RoutineStoreDeps, input: UpsertWebhookInput): WebhookRowWithSecretKey {
  return upsertWebhookInternalOp(deps, input);
}

export function deleteWebhookByRoutineOp(deps: RoutineStoreDeps, rotinaId: string): boolean {
  const res = deps.db.connection
    .prepare(`DELETE FROM projecao_rotina_webhooks WHERE rotina_id = ?;`)
    .run(rotinaId);
  return Number(res.changes ?? 0) > 0;
}

export function getWebhookByRoutineOp(deps: RoutineStoreDeps, rotinaId: string): WebhookRowWithSecretKey | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_rotina_webhooks WHERE rotina_id = ? LIMIT 1;`)
    .get(rotinaId) as unknown as WebhookRow | undefined;
  return row ? deps.mapWebhookRow(row) : null;
}

export function getWebhookByTokenOp(deps: RoutineStoreDeps, routeToken: string): WebhookRowWithSecretKey | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_rotina_webhooks WHERE route_token = ? LIMIT 1;`)
    .get(routeToken) as unknown as WebhookRow | undefined;
  return row ? deps.mapWebhookRow(row) : null;
}

export function touchWebhookLastTriggerOp(deps: RoutineStoreDeps, rotinaId: string, iso: string): void {
  deps.db.connection
    .prepare(
      `
      UPDATE projecao_rotina_webhooks
      SET ultimo_disparo_em = ?, atualizado_em = ?
      WHERE rotina_id = ?;
    `
    )
    .run(iso, iso, rotinaId);
}

export function pruneExpiredReceiptsOp(deps: RoutineStoreDeps, retentionDays = 7): number {
  const cutoffIso = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const res = deps.db.connection
    .prepare(`DELETE FROM projecao_webhook_recibos WHERE recebido_em < ?;`)
    .run(cutoffIso);
  return Number(res.changes ?? 0);
}

export function hasWebhookReceiptOp(deps: RoutineStoreDeps, ownerKind: RoutineOwnerKind,
    rotinaId: string,
    deliveryId: string): boolean {
  const cutoffIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const row = deps.db.connection
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

export function recordWebhookReceiptOp(deps: RoutineStoreDeps, input: RecordWebhookReceiptInput): WebhookReceipt {
  const reciboId = input.recibo_id ?? `rcb-${randomUUID()}`;
  const recebidoEm = input.recebido_em ?? new Date().toISOString();

  deps.db.connection
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

export function listWebhookReceiptsOp(deps: RoutineStoreDeps, rotinaId: string, limit = 25): WebhookReceipt[] {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const rows = deps.db.connection
    .prepare(
      `
      SELECT * FROM projecao_webhook_recibos
      WHERE rotina_id = ?
      ORDER BY recebido_em DESC, recibo_id DESC
      LIMIT ?;
    `
    )
    .all(rotinaId, safeLimit) as unknown as WebhookReceiptRow[];
  return rows.map((row) => deps.mapReceiptRow(row));
}

// ====================================================================
// Entregas Externas (`projecao_rotina_entregas`)
// ====================================================================

export function upsertDeliveryOp(deps: RoutineStoreDeps, input: UpsertDeliveryInput): RoutineResultDelivery {
  const agora = new Date().toISOString();
  const existing = getDeliveryOp(deps, input.execucao_id);
  const criadoEm = existing?.criado_em ?? agora;

  deps.db.connection
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

  return getDeliveryOp(deps, input.execucao_id)!;
}

export function getDeliveryOp(deps: RoutineStoreDeps, execucaoId: string): RoutineResultDelivery | null {
  const row = deps.db.connection
    .prepare(`SELECT * FROM projecao_rotina_entregas WHERE execucao_id = ? LIMIT 1;`)
    .get(execucaoId) as unknown as DeliveryRow | undefined;
  return row ? deps.mapDeliveryRow(row) : null;
}

export function listDeliveriesByRoutineOp(deps: RoutineStoreDeps, rotinaId: string, limit = 25): RoutineResultDelivery[] {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const rows = deps.db.connection
    .prepare(
      `
      SELECT * FROM projecao_rotina_entregas
      WHERE rotina_id = ?
      ORDER BY criado_em DESC
      LIMIT ?;
    `
    )
    .all(rotinaId, safeLimit) as unknown as DeliveryRow[];
  return rows.map((row) => deps.mapDeliveryRow(row));
}

export function listPendingDeliveriesOp(deps: RoutineStoreDeps, nowIso: string): RoutineResultDelivery[] {
  const rows = deps.db.connection
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
  return rows.map((row) => deps.mapDeliveryRow(row));
}
