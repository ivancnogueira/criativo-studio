import { randomUUID } from "node:crypto";
import type { CriativoDatabase } from "../database/client.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { RoutineExecutionService } from "./routine-execution-service.ts";
import type { RoutineTimer } from "./routine-timer.ts";

export interface RotinaRow {
  rotina_id: string;
  titulo: string;
  expressao_cron: string;
  tipo_tarefa: string;
  ativa: number;
  timezone: string;
  payload_modelo_json: string;
  proxima_execucao_em: string;
  criado_em: string;
}

export interface CreateRotinaInput {
  rotina_id?: string;
  titulo: string;
  expressao_cron: string;
  tipo_tarefa: string;
  ativa?: boolean;
  timezone?: string;
  payload_modelo?: Record<string, unknown>;
  proxima_execucao_em?: string;
}

interface ZonedParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number; // 0 = Domingo .. 6 = Sábado
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedDateParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const lookup = new Map<string, string>();
  for (const part of parts) {
    lookup.set(part.type, part.value);
  }

  return {
    minute: Number(lookup.get("minute") ?? 0),
    hour: Number(lookup.get("hour") ?? 0) % 24,
    day: Number(lookup.get("day") ?? 1),
    month: Number(lookup.get("month") ?? 1),
    weekday: WEEKDAY_MAP[lookup.get("weekday") ?? "Sun"] ?? 0,
  };
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  const tokens = field.split(",");

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (!token) {
      throw new Error(`Campo cron inválido: "${field}"`);
    }

    const [rangePart, stepPart] = token.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Passo cron inválido em "${token}"`);
    }

    let start = min;
    let end = max;

    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [a, b] = rangePart.split("-");
        start = Number.parseInt(a, 10);
        end = Number.parseInt(b, 10);
      } else {
        start = Number.parseInt(rangePart, 10);
        end = start;
      }
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start < min || end > max || start > end) {
      throw new Error(`Intervalo cron fora dos limites [${min}-${max}]: "${token}"`);
    }

    for (let v = start; v <= end; v += step) {
      // Converte 7 para 0 no caso de dia da semana (Domingo)
      result.add(max === 7 && v === 7 ? 0 : v);
    }
  }

  return result;
}

/**
 * Calcula o próximo instante UTC correspondente a uma expressão cron de 5 campos
 * considerando o fuso horário configurado (padrão 'America/Sao_Paulo').
 */
export function computeNextCronExecution(
  expressaoCron: string,
  fromDate: Date = new Date(),
  timezone = "America/Sao_Paulo"
): Date {
  const fields = expressaoCron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Expressão cron inválida (esperados 5 campos: min hora dia mes dia_semana): "${expressaoCron}"`
    );
  }

  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const days = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const weekdays = parseCronField(fields[4], 0, 7);

  // Avança minuto a minuto a partir do próximo minuto inteiro (máximo 366 dias)
  const cursorMs = Math.floor(fromDate.getTime() / 60_000) * 60_000 + 60_000;
  const maxSteps = 366 * 24 * 60;

  for (let i = 0; i < maxSteps; i++) {
    const candidate = new Date(cursorMs + i * 60_000);
    const zoned = getZonedDateParts(candidate, timezone);

    if (!months.has(zoned.month)) continue;
    if (!minutes.has(zoned.minute)) continue;
    if (!hours.has(zoned.hour)) continue;

    const dayWildcard = fields[2].trim() === "*";
    const weekdayWildcard = fields[4].trim() === "*";
    const dayMatches = days.has(zoned.day);
    const weekdayMatches = weekdays.has(zoned.weekday);

    const calendarOk =
      dayWildcard || weekdayWildcard
        ? dayMatches && weekdayMatches
        : dayMatches || weekdayMatches;

    if (calendarOk) {
      return candidate;
    }
  }

  throw new Error(`Não foi possível encontrar próxima execução cron para "${expressaoCron}".`);
}

/**
 * Avalia rotinas periódicas em `projecao_rotinas` e injeta tarefas na fila FIFO.
 */
export class CronScheduler {
  private readonly db: CriativoDatabase;
  private readonly queue: FifoQueueManager;
  private readonly onEnqueued?: (tarefaId: string, rotinaId: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private attachedRoutineTimer: RoutineTimer | null = null;
  private attachedExecutionService: RoutineExecutionService | null = null;

  constructor(
    db: CriativoDatabase,
    queue: FifoQueueManager,
    onEnqueued?: (tarefaId: string, rotinaId: string) => void
  ) {
    this.db = db;
    this.queue = queue;
    this.onEnqueued = onEnqueued;
  }

  public attachRoutineEngine(
    routineTimer: RoutineTimer,
    executionService: RoutineExecutionService
  ): void {
    this.attachedRoutineTimer = routineTimer;
    this.attachedExecutionService = executionService;
  }

  public createRoutine(input: CreateRotinaInput): RotinaRow {
    const rotinaId = input.rotina_id ?? randomUUID();
    const timezone = input.timezone ?? "America/Sao_Paulo";
    const agora = new Date();
    const proxima =
      input.proxima_execucao_em ??
      computeNextCronExecution(input.expressao_cron, agora, timezone).toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_rotinas (
            rotina_id, titulo, expressao_cron, tipo_tarefa, ativa, timezone,
            payload_modelo_json, proxima_execucao_em, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        `
        )
        .run(
          rotinaId,
          input.titulo,
          input.expressao_cron,
          input.tipo_tarefa,
          input.ativa === false ? 0 : 1,
          timezone,
          JSON.stringify(input.payload_modelo ?? {}),
          proxima,
          agora.toISOString()
        );
    });

    return this.db.connection
      .prepare(`SELECT * FROM projecao_rotinas WHERE rotina_id = ?;`)
      .get(rotinaId) as unknown as RotinaRow;
  }

  public listRoutines(): RotinaRow[] {
    return this.db.connection
      .prepare(`SELECT * FROM projecao_rotinas ORDER BY proxima_execucao_em ASC;`)
      .all() as unknown as RotinaRow[];
  }

  /**
   * Verifica rotinas ativas cujo horário já venceu e as enfileira na Fila FIFO.
   */
  public checkAndEnqueueDueRoutines(now: Date = new Date()): string[] {
    const nowIso = now.toISOString();
    const dueRoutines = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_rotinas
        WHERE ativa = 1 AND proxima_execucao_em <= ?
        ORDER BY proxima_execucao_em ASC;
      `
      )
      .all(nowIso) as unknown as RotinaRow[];

    const createdTaskIds: string[] = [];

    for (const routine of dueRoutines) {
      const payloadModelo = JSON.parse(routine.payload_modelo_json) as Record<string, unknown>;
      const task = this.queue.enqueueTask({
        canal_origem: "rotina_cron",
        tipo: routine.tipo_tarefa,
        titulo: routine.titulo,
        prioridade: 4,
        payload: {
          ...payloadModelo,
          rotina_id: routine.rotina_id,
          disparado_em: nowIso,
        },
      });

      const nextRun = computeNextCronExecution(
        routine.expressao_cron,
        now,
        routine.timezone || "America/Sao_Paulo"
      ).toISOString();

      this.db.runInTransaction(() => {
        this.db.connection
          .prepare(
            `UPDATE projecao_rotinas SET proxima_execucao_em = ? WHERE rotina_id = ?;`
          )
          .run(nextRun, routine.rotina_id);
      });

      createdTaskIds.push(task.tarefa_id);
      this.onEnqueued?.(task.tarefa_id, routine.rotina_id);
    }

    return createdTaskIds;
  }

  public start(intervalMs = 60_000): void {
    if (this.attachedExecutionService && this.attachedRoutineTimer) {
      void this.attachedExecutionService
        .skipMissed()
        .then(() => {
          this.attachedRoutineTimer?.arm();
        })
        .catch((error) => {
          console.error("[CronScheduler] Falha ao iniciar RoutineTimer:", error);
        });
    }

    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.checkAndEnqueueDueRoutines();
      } catch (error) {
        console.error("[CronScheduler] Erro ao processar rotinas agendadas:", error);
      }
    }, intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.attachedRoutineTimer) {
      this.attachedRoutineTimer.dispose();
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
