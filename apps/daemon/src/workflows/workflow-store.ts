import { randomBytes, randomUUID } from "node:crypto";
import {
  isValidIanaTimeZone,
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  type RoutineSchedule,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowDetail,
  type WorkflowNo,
  type WorkflowOutputDeliveryRecord,
  type WorkflowOutputTarget,
  type WorkflowPortType,
  type WorkflowRunDetail,
  type WorkflowRunOrigin,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
  type WorkflowScheduleConfig,
  type WorkflowStepRecord,
  type WorkflowStepStatus,
  type WorkflowSummary,
  type WorkflowTraco,
  type WorkflowTriggerKind,
  type WorkflowTriggerState,
  type WorkflowVersionKind,
  type WorkflowVersionRecord,
  type WorkflowVersionSummary,
  type WorkflowVisual,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  collapseMissedOccurrences,
  computeNextRoutineOccurrence,
} from "../routines/routine-schedule-calc.ts";
import type { VaultService } from "../vault/vault-service.ts";

const MAX_WORKFLOW_VERSIONS = 50;
const AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000;

export class WorkflowValidationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "WorkflowValidationError";
    this.statusCode = statusCode;
  }
}

interface WorkflowRow {
  workflow_id: string;
  nome: string;
  descricao: string | null;
  nos_json: string;
  arestas_json: string;
  tracos_json: string;
  ativo: number;
  revisao_grafo: number;
  proximo_numero_run: number;
  ultima_execucao_em: string | null;
  atualizado_em: string;
}

interface TriggerRow {
  workflow_id: string;
  node_id: string;
  tipo: WorkflowTriggerKind;
  timezone: string | null;
  schedule_json: string | null;
  filtro_json: string;
  webhook_route_id: string | null;
  webhook_secret_vault_key: string | null;
  proxima_execucao_em: string | null;
  atualizado_em: string;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function fmtHourMinute(hour = 9, minute = 0): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function resolveSafeTimeZone(tz?: string | null): string {
  const candidate = tz?.trim() || "America/Sao_Paulo";
  return isValidIanaTimeZone(candidate) ? candidate : "America/Sao_Paulo";
}

function toRoutineSchedule(
  schedule: WorkflowScheduleConfig,
  anchorRef: Date
): RoutineSchedule | null {
  switch (schedule.kind) {
    case "hourly":
      return {
        kind: "hourly",
        minute: Math.max(0, Math.min(59, Math.floor(schedule.minute ?? 0))),
      };
    case "daily":
      return {
        kind: "daily",
        time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
      };
    case "weekdays":
      return {
        kind: "weekdays",
        time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
      };
    case "weekly": {
      const days =
        Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0
          ? schedule.daysOfWeek
          : [1];
      if (days.length === 1) {
        return {
          kind: "weekly",
          weekday: Math.max(0, Math.min(6, Math.floor(days[0]))),
          time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
        };
      }
      return {
        kind: "advanced",
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        days: { kind: "days-of-week", days },
        time: { kind: "at-time", time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0) },
      };
    }
    case "monthly":
      return {
        kind: "monthly",
        day: Math.max(1, Math.min(31, Math.floor(schedule.dayOfMonth ?? 1))),
        time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0),
      };
    case "interval": {
      const amount = Math.max(3, Math.floor(schedule.intervalMinutes ?? 15));
      const anchorMs = schedule.runAt ? Date.parse(schedule.runAt) : Number.NaN;
      return {
        kind: "interval",
        amount,
        unit: "minutes",
        anchorAt: Number.isNaN(anchorMs) ? anchorRef.toISOString() : new Date(anchorMs).toISOString(),
      };
    }
    case "advanced": {
      let days: Extract<RoutineSchedule, { kind: "advanced" }>["days"] = { kind: "every-day" };
      if (Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0) {
        days = { kind: "days-of-week", days: [...schedule.daysOfWeek] };
      } else if (typeof schedule.dayOfMonth === "number") {
        days = { kind: "days-of-month", days: [schedule.dayOfMonth] };
      }
      const time: Extract<RoutineSchedule, { kind: "advanced" }>["time"] =
        typeof schedule.intervalMinutes === "number" && schedule.intervalMinutes >= 3
          ? { kind: "every", amount: Math.floor(schedule.intervalMinutes), unit: "minutes" }
          : { kind: "at-time", time: fmtHourMinute(schedule.hour ?? 9, schedule.minute ?? 0) };
      return {
        kind: "advanced",
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        days,
        time,
      };
    }
    case "custom":
      return {
        kind: "custom",
        expression: (schedule.cronExpression ?? "0 9 * * *").trim(),
      };
    case "once": {
      if (!schedule.runAt) return null;
      const dt = new Date(schedule.runAt);
      if (Number.isNaN(dt.getTime())) return null;
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      return {
        kind: "once",
        date: `${yyyy}-${mm}-${dd}`,
        time: fmtHourMinute(dt.getUTCHours(), dt.getUTCMinutes()),
      };
    }
    default:
      return null;
  }
}

/**
 * Calcula a próxima execução UTC (ISO 8601) de um nó gatilho `schedule` em timezone IANA.
 */
export function computeNextWorkflowScheduleAt(
  schedule: WorkflowScheduleConfig | null | undefined,
  timezone?: string | null,
  fromDate: Date = new Date()
): string | null {
  if (!schedule || !schedule.kind) return null;

  if (schedule.kind === "once") {
    if (!schedule.runAt) return null;
    const targetMs = Date.parse(schedule.runAt);
    if (Number.isNaN(targetMs) || targetMs <= fromDate.getTime()) {
      return null;
    }
    return new Date(targetMs).toISOString();
  }

  const tz = resolveSafeTimeZone(timezone ?? schedule.timezone);
  const routineSched = toRoutineSchedule(schedule, fromDate);
  if (!routineSched) return null;

  try {
    const next = computeNextRoutineOccurrence(routineSched, tz, fromDate);
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Colapsa múltiplas janelas vencidas no passado em uma única execução imediata (`runDueAt`)
 * e calcula o próximo horário futuro (`nextRunAt > now`) sem gerar rajada.
 */
export function collapseMissedWorkflowDue(params: {
  schedule: WorkflowScheduleConfig;
  timezone?: string | null;
  dueAtIso: string;
  now?: Date;
}): {
  missedCount: number;
  runDueAt: string | null;
  nextRunAt: string | null;
} {
  const now = params.now ?? new Date();
  const dueMs = Date.parse(params.dueAtIso);
  if (Number.isNaN(dueMs)) {
    return {
      missedCount: 0,
      runDueAt: null,
      nextRunAt: computeNextWorkflowScheduleAt(params.schedule, params.timezone, now),
    };
  }

  const dueDate = new Date(dueMs);
  if (params.schedule.kind === "once") {
    return {
      missedCount: 0,
      runDueAt: dueMs <= now.getTime() ? dueDate.toISOString() : null,
      nextRunAt: dueMs > now.getTime() ? dueDate.toISOString() : null,
    };
  }

  const tz = resolveSafeTimeZone(params.timezone ?? params.schedule.timezone);
  const routineSched = toRoutineSchedule(params.schedule, dueDate);
  if (!routineSched) {
    return { missedCount: 0, runDueAt: null, nextRunAt: null };
  }

  const collapsed = collapseMissedOccurrences({
    schedule: routineSched,
    timezone: tz,
    currentDueAt: dueDate,
    now,
    missedPolicy: "run-once",
  });

  return {
    missedCount: collapsed.missedCount,
    runDueAt: collapsed.runDueAt ? collapsed.runDueAt.toISOString() : null,
    nextRunAt: collapsed.nextRunAt ? collapsed.nextRunAt.toISOString() : null,
  };
}

function extractNodeTriggerMeta(node: WorkflowNo): {
  tipo: WorkflowTriggerKind;
  timezone: string;
  schedule: WorkflowScheduleConfig | null;
  filtro: Record<string, unknown>;
} {
  const cfg = node.config ?? {};
  const triggerKind =
    node.triggerKind ??
    node.trigger?.kind ??
    (typeof cfg.triggerKind === "string" ? (cfg.triggerKind as WorkflowTriggerKind) : undefined) ??
    "manual";

  const schedule =
    node.trigger?.kind === "schedule"
      ? node.trigger.schedule
      : cfg.schedule && typeof cfg.schedule === "object"
        ? (cfg.schedule as WorkflowScheduleConfig)
        : null;

  const timezone = resolveSafeTimeZone(
    schedule?.timezone ??
      (typeof cfg.timezone === "string" ? cfg.timezone : undefined) ??
      "America/Sao_Paulo"
  );

  const filtro: Record<string, unknown> = {};
  if (node.trigger?.kind === "whatsapp") {
    filtro.connectionId = node.trigger.connectionId ?? null;
    filtro.grupoOuNumero = node.trigger.grupoOuNumero ?? null;
    filtro.palavraChave = node.trigger.palavraChave ?? null;
    filtro.tipoMidia = node.trigger.tipoMidia ?? "all";
  } else if (node.trigger?.kind === "telegram") {
    filtro.chatId = node.trigger.chatId ?? null;
    filtro.palavraChave = node.trigger.palavraChave ?? null;
  } else if (node.trigger?.kind === "conector") {
    filtro.conectorId = node.trigger.conectorId ?? null;
    filtro.evento = node.trigger.evento ?? null;
    filtro.filtro = node.trigger.filtro ?? null;
  } else {
    for (const key of [
      "connectionId",
      "grupoOuNumero",
      "palavraChave",
      "tipoMidia",
      "chatId",
      "conectorId",
      "evento",
      "filtro",
    ]) {
      if (cfg[key] !== undefined) {
        filtro[key] = cfg[key];
      }
    }
  }

  return {
    tipo: triggerKind,
    timezone,
    schedule,
    filtro,
  };
}

export class WorkflowStore {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;

  constructor(deps: { db: CriativoDatabase; vault?: VaultService }) {
    this.db = deps.db;
    this.vault = deps.vault;
  }

  private getLatestRunForWorkflow(workflowId: string): WorkflowRunRecord | null {
    const row = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_execucoes
        WHERE workflow_id = ?
        ORDER BY numero DESC, iniciado_em DESC
        LIMIT 1;
      `
      )
      .get(workflowId) as WorkflowRunRecord | undefined;
    return row ?? null;
  }

  private rowToVisual(row: WorkflowRow): WorkflowVisual {
    const rawNos = safeJsonParse<WorkflowNo[]>(row.nos_json, []);
    const rawArestas = safeJsonParse<WorkflowAresta[]>(row.arestas_json, []);
    const rawTracos = safeJsonParse<WorkflowTraco[]>(row.tracos_json, []);
    const normalized = normalizeWorkflowGraph({
      nos: rawNos,
      arestas: rawArestas,
      tracos: rawTracos,
    });
    return {
      workflow_id: row.workflow_id,
      nome: row.nome,
      descricao: row.descricao ?? "",
      nos: normalized.nos,
      arestas: normalized.arestas,
      tracos: normalized.tracos,
      ativo: row.ativo === 1,
      revisao_grafo: Number(row.revisao_grafo ?? 0),
      ultima_execucao_em: row.ultima_execucao_em,
      atualizado_em: row.atualizado_em,
      last_run: this.getLatestRunForWorkflow(row.workflow_id),
    };
  }

  private sanitizeTriggerRow(row: TriggerRow): WorkflowTriggerState {
    return {
      workflow_id: row.workflow_id,
      node_id: row.node_id,
      tipo: row.tipo,
      timezone: row.timezone,
      schedule_json: row.schedule_json,
      filtro_json: row.filtro_json,
      webhook_route_id: row.webhook_route_id,
      webhook_url: row.webhook_route_id
        ? `/api/workflows/webhook/${row.webhook_route_id}`
        : null,
      proxima_execucao_em: row.proxima_execucao_em,
      atualizado_em: row.atualizado_em,
    };
  }

  private pruneVersions(workflowId: string): void {
    this.db.connection
      .prepare(
        `
        DELETE FROM projecao_workflow_versoes
        WHERE workflow_id = ?
          AND version_id NOT IN (
            SELECT version_id FROM projecao_workflow_versoes
            WHERE workflow_id = ?
            ORDER BY criado_em DESC, version_id DESC
            LIMIT ?
          );
      `
      )
      .run(workflowId, workflowId, MAX_WORKFLOW_VERSIONS);
  }

  private insertVersionSnapshot(params: {
    workflowId: string;
    revisaoGrafo: number;
    kind: WorkflowVersionKind;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos: WorkflowTraco[];
    criadoEm?: string;
  }): WorkflowVersionSummary {
    const versionId = `wfv_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const criadoEm = params.criadoEm ?? new Date().toISOString();
    const grafoJson = JSON.stringify({
      nos: params.nos,
      arestas: params.arestas,
      tracos: params.tracos,
    });

    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_workflow_versoes (
          version_id, workflow_id, revisao_grafo, kind, grafo_json, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?);
      `
      )
      .run(versionId, params.workflowId, params.revisaoGrafo, params.kind, grafoJson, criadoEm);

    this.pruneVersions(params.workflowId);

    return {
      version_id: versionId,
      workflow_id: params.workflowId,
      revisao_grafo: params.revisaoGrafo,
      kind: params.kind,
      criado_em: criadoEm,
    };
  }

  private syncTriggersInTx(
    workflowId: string,
    nos: WorkflowNo[],
    ativo: boolean,
    nowIso: string
  ): void {
    const existingRows = this.db.connection
      .prepare(`SELECT * FROM projecao_workflow_gatilhos WHERE workflow_id = ?;`)
      .all(workflowId) as unknown as TriggerRow[];
    const existingByNode = new Map(existingRows.map((r) => [r.node_id, r]));

    const currentTriggers = nos.filter((n) => n.tipo === "gatilho");
    const keepIds = new Set(currentTriggers.map((n) => n.id));
    const keysToDelete: string[] = [];

    for (const oldRow of existingRows) {
      if (!keepIds.has(oldRow.node_id)) {
        if (oldRow.webhook_secret_vault_key) {
          keysToDelete.push(oldRow.webhook_secret_vault_key);
        }
        this.db.connection
          .prepare(`DELETE FROM projecao_workflow_gatilhos WHERE workflow_id = ? AND node_id = ?;`)
          .run(workflowId, oldRow.node_id);
      }
    }

    for (const node of currentTriggers) {
      const prev = existingByNode.get(node.id);
      const meta = extractNodeTriggerMeta(node);
      const scheduleJson = meta.schedule ? JSON.stringify(meta.schedule) : null;
      const filtroJson = JSON.stringify(meta.filtro);

      let webhookRouteId: string | null = null;
      let webhookVaultKey: string | null = null;
      if (meta.tipo === "webhook") {
        webhookRouteId =
          prev?.webhook_route_id ?? `whk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        webhookVaultKey = prev?.webhook_secret_vault_key ?? null;
      } else if (prev?.webhook_secret_vault_key) {
        keysToDelete.push(prev.webhook_secret_vault_key);
      }

      let proximaExecucaoEm: string | null = null;
      if (meta.tipo === "schedule" && ativo && meta.schedule) {
        const unchangedSchedule =
          prev &&
          prev.tipo === "schedule" &&
          prev.schedule_json === scheduleJson &&
          prev.timezone === meta.timezone &&
          prev.proxima_execucao_em !== null;
        proximaExecucaoEm = unchangedSchedule
          ? prev.proxima_execucao_em
          : computeNextWorkflowScheduleAt(meta.schedule, meta.timezone, new Date(nowIso));
      }

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_gatilhos (
            workflow_id, node_id, tipo, timezone, schedule_json, filtro_json,
            webhook_route_id, webhook_secret_vault_key, proxima_execucao_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workflow_id, node_id) DO UPDATE SET
            tipo = excluded.tipo,
            timezone = excluded.timezone,
            schedule_json = excluded.schedule_json,
            filtro_json = excluded.filtro_json,
            webhook_route_id = excluded.webhook_route_id,
            webhook_secret_vault_key = excluded.webhook_secret_vault_key,
            proxima_execucao_em = excluded.proxima_execucao_em,
            atualizado_em = excluded.atualizado_em;
        `
        )
        .run(
          workflowId,
          node.id,
          meta.tipo,
          meta.timezone,
          scheduleJson,
          filtroJson,
          webhookRouteId,
          webhookVaultKey,
          proximaExecucaoEm,
          nowIso
        );
    }

    if (this.vault) {
      for (const secretKey of keysToDelete) {
        this.vault.deleteSecret(secretKey);
      }
    }
  }

  public listWorkflows(): WorkflowSummary[] {
    const rows = this.db.connection
      .prepare(`SELECT * FROM projecao_workflows ORDER BY atualizado_em DESC, workflow_id ASC;`)
      .all() as unknown as WorkflowRow[];

    return rows.map((row) => {
      const visual = this.rowToVisual(row);
      const execCount = visual.nos.filter(
        (n) => n.tipo !== "nota" && n.tipo !== "shape" && n.tipo !== "text"
      ).length;
      return {
        ...visual,
        revisao_grafo: visual.revisao_grafo ?? 0,
        qtd_nos: execCount,
        qtd_arestas: visual.arestas.length,
      };
    });
  }

  public getWorkflowVisual(workflowId: string): WorkflowVisual | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as unknown as WorkflowRow | undefined;
    if (!row) return null;
    return this.rowToVisual(row);
  }

  public getWorkflowDetail(workflowId: string): WorkflowDetail | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as unknown as WorkflowRow | undefined;
    if (!row) return null;

    const workflow = this.rowToVisual(row);
    const versions = this.listVersions(workflowId);
    const triggers = this.listTriggers(workflowId);
    const runs = this.listRunsPaginated(workflowId, 30, 0);

    return {
      workflow,
      versions,
      triggers,
      runs,
    };
  }

  public listTriggers(workflowId?: string): WorkflowTriggerState[] {
    const rows = workflowId
      ? (this.db.connection
          .prepare(
            `SELECT * FROM projecao_workflow_gatilhos WHERE workflow_id = ? ORDER BY node_id ASC;`
          )
          .all(workflowId) as unknown as TriggerRow[])
      : (this.db.connection
          .prepare(`SELECT * FROM projecao_workflow_gatilhos ORDER BY workflow_id ASC, node_id ASC;`)
          .all() as unknown as TriggerRow[]);

    return rows.map((r) => this.sanitizeTriggerRow(r));
  }

  public createWorkflow(input: {
    workflow_id?: string;
    nome?: string;
    descricao?: string;
    nos?: WorkflowNo[];
    arestas?: WorkflowAresta[];
    tracos?: WorkflowTraco[];
    ativo?: boolean;
  }): WorkflowDetail {
    const workflowId = input.workflow_id?.trim() || `wf_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const nome = input.nome?.trim() || "Novo Workflow";
    const descricao = input.descricao?.trim() || "";
    const normalized = normalizeWorkflowGraph({
      nos: input.nos ?? [],
      arestas: input.arestas ?? [],
      tracos: input.tracos ?? [],
    });

    const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
    if (problem) {
      throw new WorkflowValidationError(problem, 400);
    }

    const ativo = input.ativo ?? true;
    const nowIso = new Date().toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflows (
            workflow_id, nome, descricao, nos_json, arestas_json, tracos_json,
            ativo, revisao_grafo, proximo_numero_run, ultima_execucao_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, NULL, ?);
        `
        )
        .run(
          workflowId,
          nome,
          descricao,
          JSON.stringify(normalized.nos),
          JSON.stringify(normalized.arestas),
          JSON.stringify(normalized.tracos),
          ativo ? 1 : 0,
          nowIso
        );

      this.syncTriggersInTx(workflowId, normalized.nos, ativo, nowIso);
    });

    const detail = this.getWorkflowDetail(workflowId);
    if (!detail) {
      throw new Error(`Falha ao carregar workflow recém-criado: ${workflowId}`);
    }
    return detail;
  }

  public saveWorkflow(
    workflowId: string,
    patch: {
      nome?: string;
      descricao?: string;
      nos?: WorkflowNo[];
      arestas?: WorkflowAresta[];
      tracos?: WorkflowTraco[];
      ativo?: boolean;
      base_revision?: number;
    }
  ):
    | { ok: true; detail: WorkflowDetail }
    | { ok: false; conflict: WorkflowDetail }
    | null {
    const existingCheck = this.db.connection
      .prepare(`SELECT workflow_id FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as { workflow_id: string } | undefined;
    if (!existingCheck) {
      return null;
    }

    let conflictFound = false;

    this.db.runInTransaction(() => {
      const current = this.db.connection
        .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
        .get(workflowId) as unknown as WorkflowRow | undefined;
      if (!current) {
        return;
      }

      const currentRev = Number(current.revisao_grafo ?? 0);
      if (patch.base_revision !== undefined && patch.base_revision !== currentRev) {
        conflictFound = true;
        return;
      }

      const prevVisual = this.rowToVisual(current);
      const nextNosRaw = patch.nos ?? prevVisual.nos;
      const nextArestasRaw = patch.arestas ?? prevVisual.arestas;
      const nextTracosRaw = patch.tracos ?? prevVisual.tracos ?? [];
      const normalized = normalizeWorkflowGraph({
        nos: nextNosRaw,
        arestas: nextArestasRaw,
        tracos: nextTracosRaw,
      });

      const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
      if (problem) {
        throw new WorkflowValidationError(problem, 400);
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const graphChanged =
        JSON.stringify(prevVisual.nos) !== JSON.stringify(normalized.nos) ||
        JSON.stringify(prevVisual.arestas) !== JSON.stringify(normalized.arestas) ||
        JSON.stringify(prevVisual.tracos ?? []) !== JSON.stringify(normalized.tracos);

      if (graphChanged) {
        const lastAuto = this.db.connection
          .prepare(
            `
            SELECT criado_em FROM projecao_workflow_versoes
            WHERE workflow_id = ? AND kind = 'auto'
            ORDER BY criado_em DESC, version_id DESC
            LIMIT 1;
          `
          )
          .get(workflowId) as { criado_em: string } | undefined;

        const elapsedMs = lastAuto ? now.getTime() - Date.parse(lastAuto.criado_em) : Number.POSITIVE_INFINITY;
        if (!lastAuto || Number.isNaN(elapsedMs) || elapsedMs >= AUTO_VERSION_INTERVAL_MS) {
          this.insertVersionSnapshot({
            workflowId,
            revisaoGrafo: currentRev,
            kind: "auto",
            nos: prevVisual.nos,
            arestas: prevVisual.arestas,
            tracos: prevVisual.tracos ?? [],
            criadoEm: nowIso,
          });
        }
      }

      const nextNome = patch.nome !== undefined ? patch.nome.trim() || prevVisual.nome : prevVisual.nome;
      const nextDescricao = patch.descricao !== undefined ? patch.descricao : prevVisual.descricao;
      const nextAtivo = patch.ativo !== undefined ? patch.ativo : prevVisual.ativo;
      const nextRev = currentRev + 1;

      this.db.connection
        .prepare(
          `
          UPDATE projecao_workflows
          SET nome = ?,
              descricao = ?,
              nos_json = ?,
              arestas_json = ?,
              tracos_json = ?,
              ativo = ?,
              revisao_grafo = ?,
              atualizado_em = ?
          WHERE workflow_id = ?;
        `
        )
        .run(
          nextNome,
          nextDescricao,
          JSON.stringify(normalized.nos),
          JSON.stringify(normalized.arestas),
          JSON.stringify(normalized.tracos),
          nextAtivo ? 1 : 0,
          nextRev,
          nowIso,
          workflowId
        );

      this.syncTriggersInTx(workflowId, normalized.nos, nextAtivo, nowIso);
    });

    const detail = this.getWorkflowDetail(workflowId);
    if (!detail) return null;
    if (conflictFound) {
      return { ok: false, conflict: detail };
    }
    return { ok: true, detail };
  }

  public deleteWorkflow(workflowId: string): boolean {
    const triggers = this.db.connection
      .prepare(`SELECT webhook_secret_vault_key FROM projecao_workflow_gatilhos WHERE workflow_id = ?;`)
      .all(workflowId) as Array<{ webhook_secret_vault_key: string | null }>;

    let deleted = false;
    this.db.runInTransaction(() => {
      const info = this.db.connection
        .prepare(`DELETE FROM projecao_workflows WHERE workflow_id = ?;`)
        .run(workflowId);
      deleted = Number(info.changes) > 0;
    });

    if (deleted && this.vault) {
      for (const row of triggers) {
        if (row.webhook_secret_vault_key) {
          this.vault.deleteSecret(row.webhook_secret_vault_key);
        }
      }
    }

    return deleted;
  }

  public listVersions(workflowId: string): WorkflowVersionSummary[] {
    return this.db.connection
      .prepare(
        `
        SELECT version_id, workflow_id, revisao_grafo, kind, criado_em
        FROM projecao_workflow_versoes
        WHERE workflow_id = ?
        ORDER BY criado_em DESC, version_id DESC
        LIMIT ?;
      `
      )
      .all(workflowId, MAX_WORKFLOW_VERSIONS) as unknown as WorkflowVersionSummary[];
  }

  public getVersion(workflowId: string, versionId: string): WorkflowVersionRecord | null {
    const row = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_versoes
        WHERE workflow_id = ? AND version_id = ?;
      `
      )
      .get(workflowId, versionId) as WorkflowVersionRecord | undefined;
    return row ?? null;
  }

  public restoreVersion(workflowId: string, versionId: string): WorkflowDetail | null {
    let restored = false;

    this.db.runInTransaction(() => {
      const current = this.db.connection
        .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
        .get(workflowId) as unknown as WorkflowRow | undefined;
      const version = this.db.connection
        .prepare(
          `SELECT * FROM projecao_workflow_versoes WHERE workflow_id = ? AND version_id = ?;`
        )
        .get(workflowId, versionId) as WorkflowVersionRecord | undefined;

      if (!current || !version) {
        return;
      }

      const prevVisual = this.rowToVisual(current);
      const nowIso = new Date().toISOString();

      this.insertVersionSnapshot({
        workflowId,
        revisaoGrafo: Number(current.revisao_grafo ?? 0),
        kind: "restore",
        nos: prevVisual.nos,
        arestas: prevVisual.arestas,
        tracos: prevVisual.tracos ?? [],
        criadoEm: nowIso,
      });

      const parsedGraph = safeJsonParse<{
        nos?: WorkflowNo[];
        arestas?: WorkflowAresta[];
        tracos?: WorkflowTraco[];
      }>(version.grafo_json, {});
      const normalized = normalizeWorkflowGraph({
        nos: parsedGraph.nos ?? [],
        arestas: parsedGraph.arestas ?? [],
        tracos: parsedGraph.tracos ?? [],
      });

      const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
      if (problem) {
        throw new WorkflowValidationError(`Versão contém grafo inválido: ${problem}`, 400);
      }

      const nextRev = Number(current.revisao_grafo ?? 0) + 1;
      this.db.connection
        .prepare(
          `
          UPDATE projecao_workflows
          SET nos_json = ?,
              arestas_json = ?,
              tracos_json = ?,
              revisao_grafo = ?,
              atualizado_em = ?
          WHERE workflow_id = ?;
        `
        )
        .run(
          JSON.stringify(normalized.nos),
          JSON.stringify(normalized.arestas),
          JSON.stringify(normalized.tracos),
          nextRev,
          nowIso,
          workflowId
        );

      this.syncTriggersInTx(workflowId, normalized.nos, current.ativo === 1, nowIso);
      restored = true;
    });

    return restored ? this.getWorkflowDetail(workflowId) : null;
  }

  public saveRunVersionSnapshot(workflowId: string): WorkflowVersionSummary | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as unknown as WorkflowRow | undefined;
    if (!row) return null;

    const visual = this.rowToVisual(row);
    const currentGrafoJson = JSON.stringify({
      nos: visual.nos,
      arestas: visual.arestas,
      tracos: visual.tracos ?? [],
    });

    const lastRunVersion = this.db.connection
      .prepare(
        `
        SELECT grafo_json FROM projecao_workflow_versoes
        WHERE workflow_id = ? AND kind = 'run'
        ORDER BY criado_em DESC, version_id DESC
        LIMIT 1;
      `
      )
      .get(workflowId) as { grafo_json: string } | undefined;

    if (lastRunVersion && lastRunVersion.grafo_json === currentGrafoJson) {
      return null;
    }

    return this.db.runInTransaction(() =>
      this.insertVersionSnapshot({
        workflowId,
        revisaoGrafo: Number(row.revisao_grafo ?? 0),
        kind: "run",
        nos: visual.nos,
        arestas: visual.arestas,
        tracos: visual.tracos ?? [],
      })
    );
  }

  public rotateWebhookSecret(
    workflowId: string,
    nodeId: string
  ): { routeId: string; webhookUrl: string; secret: string } {
    if (!this.vault) {
      throw new Error("VaultService indisponível para rotacionar segredo de webhook.");
    }

    const visual = this.getWorkflowVisual(workflowId);
    if (!visual) {
      throw new WorkflowValidationError(`Workflow não encontrado: ${workflowId}`, 404);
    }

    const node = visual.nos.find((n) => n.id === nodeId);
    if (!node || node.tipo !== "gatilho") {
      throw new WorkflowValidationError(`Nó gatilho não encontrado: ${nodeId}`, 404);
    }

    const meta = extractNodeTriggerMeta(node);
    if (meta.tipo !== "webhook") {
      throw new WorkflowValidationError(`O nó '${nodeId}' não é um gatilho do tipo webhook.`, 400);
    }

    const secret = randomBytes(32).toString("hex");
    const vaultKey = `wf_webhook_secret:${workflowId}:${nodeId}`;
    this.vault.setSecret(vaultKey, secret);

    let routeId = "";
    const nowIso = new Date().toISOString();

    this.db.runInTransaction(() => {
      const existing = this.db.connection
        .prepare(
          `SELECT webhook_route_id FROM projecao_workflow_gatilhos WHERE workflow_id = ? AND node_id = ?;`
        )
        .get(workflowId, nodeId) as { webhook_route_id: string | null } | undefined;

      routeId =
        existing?.webhook_route_id ?? `whk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_gatilhos (
            workflow_id, node_id, tipo, timezone, schedule_json, filtro_json,
            webhook_route_id, webhook_secret_vault_key, proxima_execucao_em, atualizado_em
          ) VALUES (?, ?, 'webhook', ?, NULL, ?, ?, ?, NULL, ?)
          ON CONFLICT(workflow_id, node_id) DO UPDATE SET
            tipo = 'webhook',
            webhook_route_id = excluded.webhook_route_id,
            webhook_secret_vault_key = excluded.webhook_secret_vault_key,
            atualizado_em = excluded.atualizado_em;
        `
        )
        .run(
          workflowId,
          nodeId,
          meta.timezone,
          JSON.stringify(meta.filtro),
          routeId,
          vaultKey,
          nowIso
        );
    });

    return {
      routeId,
      webhookUrl: `/api/workflows/webhook/${routeId}`,
      secret,
    };
  }

  public getTriggerByWebhookRouteId(routeId: string): TriggerRow | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflow_gatilhos WHERE webhook_route_id = ?;`)
      .get(routeId) as unknown as TriggerRow | undefined;
    return row ?? null;
  }

  public listWebhookReceipts(
    workflowId: string,
    limit = 30
  ): Array<{
    receipt_id: string;
    workflow_id: string;
    node_id: string;
    delivery_id: string;
    status: "started" | "ignored";
    motivo: "busy" | "refused" | "unauthorized" | null;
    run_id: string | null;
    recebido_em: string;
  }> {
    return this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_webhook_recibos
        WHERE workflow_id = ?
        ORDER BY recebido_em DESC
        LIMIT ?;
      `
      )
      .all(workflowId, Math.max(1, Math.min(200, limit))) as Array<{
      receipt_id: string;
      workflow_id: string;
      node_id: string;
      delivery_id: string;
      status: "started" | "ignored";
      motivo: "busy" | "refused" | "unauthorized" | null;
      run_id: string | null;
      recebido_em: string;
    }>;
  }

  public insertWebhookReceipt(params: {
    workflowId: string;
    nodeId: string;
    deliveryId: string;
    status: "started" | "ignored";
    motivo?: "busy" | "refused" | "unauthorized" | null;
    runId?: string | null;
  }): { inserted: boolean; receiptId: string } {
    const existing = this.db.connection
      .prepare(
        `
        SELECT receipt_id FROM projecao_workflow_webhook_recibos
        WHERE workflow_id = ? AND node_id = ? AND delivery_id = ?;
      `
      )
      .get(params.workflowId, params.nodeId, params.deliveryId) as
      | { receipt_id: string }
      | undefined;
    if (existing) {
      return { inserted: false, receiptId: existing.receipt_id };
    }

    const receiptId = `wfr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_workflow_webhook_recibos (
          receipt_id, workflow_id, node_id, delivery_id, status, motivo, run_id, recebido_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `
      )
      .run(
        receiptId,
        params.workflowId,
        params.nodeId,
        params.deliveryId,
        params.status,
        params.motivo ?? null,
        params.runId ?? null,
        new Date().toISOString()
      );
    return { inserted: true, receiptId };
  }

  public hasOpenRun(workflowId: string): boolean {
    const row = this.db.connection
      .prepare(
        `
        SELECT 1 FROM projecao_workflow_execucoes
        WHERE workflow_id = ? AND status IN ('running', 'approval', 'stopping')
        LIMIT 1;
      `
      )
      .get(workflowId);
    return Boolean(row);
  }

  public createRunWithReusedSteps(params: {
    workflowId: string;
    triggerNodeId?: string | null;
    fromNodeId?: string | null;
    origem: WorkflowRunOrigin;
    scheduledFor?: string | null;
    idempotencyKey: string;
    payload?: string | null;
    reusedSteps: WorkflowStepRecord[];
  }): { detail: WorkflowRunDetail; deduplicated: boolean } {
    const existingRun = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_execucoes
        WHERE workflow_id = ? AND chave_idempotencia = ?;
      `
      )
      .get(params.workflowId, params.idempotencyKey) as WorkflowRunRecord | undefined;

    if (existingRun) {
      const detail = this.getRunDetail(existingRun.run_id);
      if (detail) {
        return { detail, deduplicated: true };
      }
    }

    let createdRunId = "";

    this.db.runInTransaction(() => {
      const wf = this.db.connection
        .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
        .get(params.workflowId) as unknown as WorkflowRow | undefined;
      if (!wf) {
        throw new WorkflowValidationError(`Workflow não encontrado: ${params.workflowId}`, 404);
      }

      const visual = this.rowToVisual(wf);
      const numero = Number(wf.proximo_numero_run ?? 1);
      const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      createdRunId = runId;
      const nowIso = new Date().toISOString();
      const grafoJson = JSON.stringify({
        nos: visual.nos,
        arestas: visual.arestas,
        tracos: visual.tracos ?? [],
      });

      this.db.connection
        .prepare(`UPDATE projecao_workflows SET proximo_numero_run = ?, ultima_execucao_em = ? WHERE workflow_id = ?;`)
        .run(numero + 1, nowIso, params.workflowId);

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_execucoes (
            run_id, workflow_id, numero, trigger_node_id, from_node_id, origem,
            agendado_para, chave_idempotencia, revisao_grafo, grafo_json, payload,
            status, erro, iniciado_em, encerrado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, NULL, ?);
        `
        )
        .run(
          runId,
          params.workflowId,
          numero,
          params.triggerNodeId ?? null,
          params.fromNodeId ?? null,
          params.origem,
          params.scheduledFor ?? null,
          params.idempotencyKey,
          Number(wf.revisao_grafo ?? 0),
          grafoJson,
          params.payload ?? null,
          nowIso,
          nowIso
        );

      for (const reused of params.reusedSteps) {
        const clonedStepId = `stp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const reqId = `reuse:${runId}:${reused.node_id}`;
        this.db.connection
          .prepare(
            `
            INSERT INTO projecao_workflow_etapas (
              step_id, workflow_id, run_id, node_id, tentativa, request_id, kind, agente_id,
              status, tarefa_id, input, output, output_tipo, artefatos_json, branch, erro,
              iniciado_em, encerrado_em, criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `
          )
          .run(
            clonedStepId,
            params.workflowId,
            runId,
            reused.node_id,
            reqId,
            reused.kind,
            reused.agente_id,
            reused.status,
            reused.tarefa_id,
            reused.input,
            reused.output,
            reused.output_tipo,
            reused.artefatos_json,
            reused.branch,
            reused.erro,
            reused.iniciado_em ?? nowIso,
            reused.encerrado_em ?? nowIso,
            nowIso,
            nowIso
          );
      }
    });

    const detail = this.getRunDetail(createdRunId);
    if (!detail) {
      throw new Error(`Falha ao carregar execução criada: ${createdRunId}`);
    }
    return { detail, deduplicated: false };
  }

  public getRunRecord(runId: string): WorkflowRunRecord | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflow_execucoes WHERE run_id = ?;`)
      .get(runId) as WorkflowRunRecord | undefined;
    return row ?? null;
  }

  public getRunDetail(runId: string): WorkflowRunDetail | null {
    const run = this.getRunRecord(runId);
    if (!run) return null;

    const steps = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_etapas
        WHERE run_id = ?
        ORDER BY criado_em ASC, tentativa ASC, step_id ASC;
      `
      )
      .all(runId) as unknown as WorkflowStepRecord[];

    const deliveries = this.db.connection
      .prepare(
        `
        SELECT d.* FROM projecao_workflow_entregas d
        INNER JOIN projecao_workflow_etapas s ON s.step_id = d.step_id
        WHERE s.run_id = ?
        ORDER BY d.criado_em ASC;
      `
      )
      .all(runId) as unknown as WorkflowOutputDeliveryRecord[];

    return { run, steps, deliveries };
  }

  public listRunsPaginated(
    workflowId: string,
    limit = 20,
    offset = 0
  ): WorkflowRunRecord[] {
    return this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_execucoes
        WHERE workflow_id = ?
        ORDER BY numero DESC, iniciado_em DESC
        LIMIT ? OFFSET ?;
      `
      )
      .all(
        workflowId,
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset)
      ) as unknown as WorkflowRunRecord[];
  }

  public updateRunStatus(
    runId: string,
    status: WorkflowRunStatus,
    erro: string | null = null
  ): WorkflowRunRecord | null {
    const nowIso = new Date().toISOString();
    const isTerminal = status === "done" || status === "failed" || status === "stopped";
    this.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_execucoes
        SET status = ?,
            erro = COALESCE(?, erro),
            encerrado_em = CASE WHEN ? THEN COALESCE(encerrado_em, ?) ELSE NULL END,
            atualizado_em = ?
        WHERE run_id = ?;
      `
      )
      .run(status, erro, isTerminal ? 1 : 0, nowIso, nowIso, runId);

    return this.getRunRecord(runId);
  }

  public getStep(stepId: string): WorkflowStepRecord | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_workflow_etapas WHERE step_id = ?;`)
      .get(stepId) as WorkflowStepRecord | undefined;
    return row ?? null;
  }

  public listSoloSteps(workflowId: string, limit = 50): WorkflowStepRecord[] {
    return this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_etapas
        WHERE workflow_id = ? AND run_id IS NULL
        ORDER BY criado_em DESC, step_id DESC
        LIMIT ?;
      `
      )
      .all(workflowId, Math.max(1, Math.min(200, limit))) as unknown as WorkflowStepRecord[];
  }

  public listLatestDoneStepsByNode(workflowId: string): {
    stepsByNode: Map<string, WorkflowStepRecord>;
    ranWithGraph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] } | null;
  } {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_workflow_etapas
        WHERE workflow_id = ? AND status = 'done'
        ORDER BY COALESCE(encerrado_em, criado_em) DESC, criado_em DESC, step_id DESC;
      `
      )
      .all(workflowId) as unknown as WorkflowStepRecord[];

    const map = new Map<string, WorkflowStepRecord>();
    for (const row of rows) {
      if (!map.has(row.node_id)) {
        map.set(row.node_id, row);
      }
    }

    const lastRun = this.getLatestRunForWorkflow(workflowId);
    let ranWithGraph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] } | null = null;
    if (lastRun?.grafo_json) {
      const parsed = safeJsonParse<{ nos?: WorkflowNo[]; arestas?: WorkflowAresta[] }>(
        lastRun.grafo_json,
        {}
      );
      if (Array.isArray(parsed.nos) && Array.isArray(parsed.arestas)) {
        ranWithGraph = { nos: parsed.nos, arestas: parsed.arestas };
      }
    }

    return { stepsByNode: map, ranWithGraph };
  }

  public createOrGetStep(params: {
    workflowId: string;
    runId: string | null;
    nodeId: string;
    requestId: string;
    kind: string;
    agenteId?: string | null;
    status: WorkflowStepStatus;
    input: string;
    output?: string | null;
    outputTipo?: WorkflowPortType | null;
    artefatos?: unknown[];
    branch?: WorkflowBranch | null;
    erro?: string | null;
    tarefaId?: string | null;
  }): { step: WorkflowStepRecord; created: boolean } {
    const byReq = this.db.connection
      .prepare(
        `SELECT * FROM projecao_workflow_etapas WHERE workflow_id = ? AND request_id = ?;`
      )
      .get(params.workflowId, params.requestId) as WorkflowStepRecord | undefined;
    if (byReq) {
      return { step: byReq, created: false };
    }

    let stepId = "";
    this.db.runInTransaction(() => {
      const countRow = params.runId
        ? (this.db.connection
            .prepare(
              `SELECT COALESCE(MAX(tentativa), 0) AS max_t FROM projecao_workflow_etapas WHERE run_id = ? AND node_id = ?;`
            )
            .get(params.runId, params.nodeId) as { max_t: number })
        : ({ max_t: 0 } as { max_t: number });

      const tentativa = Number(countRow.max_t ?? 0) + 1;
      stepId = `stp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const nowIso = new Date().toISOString();
      const isTerminal =
        params.status === "done" ||
        params.status === "failed" ||
        params.status === "stopped" ||
        params.status === "skipped";

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_workflow_etapas (
            step_id, workflow_id, run_id, node_id, tentativa, request_id, kind, agente_id,
            status, tarefa_id, input, output, output_tipo, artefatos_json, branch, erro,
            iniciado_em, encerrado_em, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `
        )
        .run(
          stepId,
          params.workflowId,
          params.runId,
          params.nodeId,
          tentativa,
          params.requestId,
          params.kind,
          params.agenteId ?? null,
          params.status,
          params.tarefaId ?? null,
          params.input,
          params.output ?? null,
          params.outputTipo ?? null,
          JSON.stringify(params.artefatos ?? []),
          params.branch ?? null,
          params.erro ?? null,
          nowIso,
          isTerminal ? nowIso : null,
          nowIso,
          nowIso
        );
    });

    const created = this.getStep(stepId);
    if (!created) {
      throw new Error(`Falha ao carregar etapa criada: ${stepId}`);
    }
    return { step: created, created: true };
  }

  public updateStep(
    stepId: string,
    patch: {
      status?: WorkflowStepStatus;
      tarefaId?: string | null;
      output?: string | null;
      outputTipo?: WorkflowPortType | null;
      artefatos?: unknown[];
      branch?: WorkflowBranch | null;
      erro?: string | null;
    }
  ): WorkflowStepRecord | null {
    const current = this.getStep(stepId);
    if (!current) return null;

    const nowIso = new Date().toISOString();
    const nextStatus = patch.status ?? current.status;
    const isTerminal =
      nextStatus === "done" ||
      nextStatus === "failed" ||
      nextStatus === "stopped" ||
      nextStatus === "skipped";

    this.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_etapas
        SET status = ?,
            tarefa_id = ?,
            output = ?,
            output_tipo = ?,
            artefatos_json = ?,
            branch = ?,
            erro = ?,
            encerrado_em = CASE WHEN ? THEN COALESCE(encerrado_em, ?) ELSE NULL END,
            atualizado_em = ?
        WHERE step_id = ?;
      `
      )
      .run(
        nextStatus,
        patch.tarefaId !== undefined ? patch.tarefaId : current.tarefa_id,
        patch.output !== undefined ? patch.output : current.output,
        patch.outputTipo !== undefined ? patch.outputTipo : current.output_tipo,
        patch.artefatos !== undefined ? JSON.stringify(patch.artefatos) : current.artefatos_json,
        patch.branch !== undefined ? patch.branch : current.branch,
        patch.erro !== undefined ? patch.erro : current.erro,
        isTerminal ? 1 : 0,
        nowIso,
        nowIso,
        stepId
      );

    return this.getStep(stepId);
  }

  public upsertDelivery(params: {
    stepId: string;
    destino: WorkflowOutputTarget;
    destinoRef: string;
    texto: string;
    anexos?: unknown[];
  }): WorkflowOutputDeliveryRecord {
    const nowIso = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_workflow_entregas (
          step_id, destino, destino_ref, texto, anexos_json,
          status, motivo, tentativas, enviado_em, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0, NULL, ?, ?)
        ON CONFLICT(step_id) DO UPDATE SET
          destino = excluded.destino,
          destino_ref = excluded.destino_ref,
          texto = excluded.texto,
          anexos_json = excluded.anexos_json,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(
        params.stepId,
        params.destino,
        params.destinoRef,
        params.texto,
        JSON.stringify(params.anexos ?? []),
        nowIso,
        nowIso
      );

    return this.db.connection
      .prepare(`SELECT * FROM projecao_workflow_entregas WHERE step_id = ?;`)
      .get(params.stepId) as unknown as WorkflowOutputDeliveryRecord;
  }

  public claimDeliveryForSending(stepId: string): boolean {
    const nowIso = new Date().toISOString();
    const info = this.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_entregas
        SET status = 'sending',
            tentativas = tentativas + 1,
            atualizado_em = ?
        WHERE step_id = ? AND status = 'pending';
      `
      )
      .run(nowIso, stepId);
    return Number(info.changes) > 0;
  }

  public markDeliveryResult(
    stepId: string,
    status: "sent" | "failed" | "uncertain",
    motivo: string | null = null
  ): void {
    const nowIso = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_entregas
        SET status = ?,
            motivo = ?,
            enviado_em = CASE WHEN ? = 'sent' THEN COALESCE(enviado_em, ?) ELSE enviado_em END,
            atualizado_em = ?
        WHERE step_id = ?;
      `
      )
      .run(status, motivo, status, nowIso, nowIso, stepId);
  }
}
