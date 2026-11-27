/**
 * Serviço de retenção e poda indexada de eventos históricos do SQLite (`SCALE41-03`).
 * Executa exclusões em lotes pequenos dentro de transações curtas usando índices de data,
 * evitando full table scan e travamento de I/O em VPS enxutas.
 */
import type { CriativoDatabase } from "./client.ts";

export const DEFAULT_EVENT_RETENTION_DAYS = 30;
export const DEFAULT_RETENTION_BATCH_SIZE = 500;
export const DEFAULT_RETENTION_MAX_BATCHES = 10;
export const DEFAULT_RETENTION_INTERVAL_MS = 6 * 60 * 60_000;

export interface EventRetentionServiceOptions {
  db: CriativoDatabase;
  retentionDays?: number;
  batchSize?: number;
  intervalMs?: number;
}

export interface PruneRetentionOptions {
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
  nowMs?: number;
}

export interface PruneRetentionReport {
  deletedEvents: number;
  deletedWhatsappMessages: number;
  batchesExecuted: number;
}

export class EventRetentionService {
  private readonly db: CriativoDatabase;
  private readonly retentionDays: number;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: EventRetentionServiceOptions) {
    this.db = options.db;
    this.retentionDays = Math.max(1, options.retentionDays ?? DEFAULT_EVENT_RETENTION_DAYS);
    this.batchSize = Math.max(10, options.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE);
    this.intervalMs = Math.max(60_000, options.intervalMs ?? DEFAULT_RETENTION_INTERVAL_MS);
  }

  public pruneExpiredEvents(opts: PruneRetentionOptions = {}): PruneRetentionReport {
    const days = Math.max(1, opts.retentionDays ?? this.retentionDays);
    const batchSize = Math.max(1, opts.batchSize ?? this.batchSize);
    const maxBatches = Math.max(1, opts.maxBatches ?? DEFAULT_RETENTION_MAX_BATCHES);
    const nowMs = opts.nowMs ?? Date.now();
    const cutoffIso = new Date(nowMs - days * 24 * 60 * 60_000).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    let deletedEvents = 0;
    let deletedWhatsappMessages = 0;
    let batchesExecuted = 0;

    for (let i = 0; i < maxBatches; i += 1) {
      let batchEv = 0;
      let batchWpp = 0;

      this.db.runInTransaction(() => {
        const resEv = this.db.connection
          .prepare(
            `DELETE FROM eventos_orquestracao
             WHERE sequencia IN (
               SELECT sequencia FROM eventos_orquestracao
               WHERE ocorrido_em < ?
               ORDER BY ocorrido_em ASC
               LIMIT ?
             );`,
          )
          .run(cutoffIso, batchSize);
        batchEv = Number(resEv.changes ?? 0);

        if (this.db.hasTable("whatsapp_historico_mensagens")) {
          const resWpp = this.db.connection
            .prepare(
              `DELETE FROM whatsapp_historico_mensagens
               WHERE mensagem_id IN (
                 SELECT mensagem_id FROM whatsapp_historico_mensagens
                 WHERE expira_em IS NOT NULL AND expira_em < ?
                 ORDER BY expira_em ASC
                 LIMIT ?
               );`,
            )
            .run(nowIso, batchSize);
          batchWpp = Number(resWpp.changes ?? 0);
        }
      });

      deletedEvents += batchEv;
      deletedWhatsappMessages += batchWpp;
      batchesExecuted += 1;

      if (batchEv < batchSize && batchWpp < batchSize) {
        break;
      }
    }

    return {
      deletedEvents,
      deletedWhatsappMessages,
      batchesExecuted,
    };
  }

  public startPeriodicCleanup(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.pruneExpiredEvents();
      } catch (err) {
        console.warn("[EventRetention] Falha na poda periódica:", err);
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
