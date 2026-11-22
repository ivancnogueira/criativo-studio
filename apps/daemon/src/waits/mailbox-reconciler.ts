import { randomUUID } from "node:crypto";
import type { AgentMailboxItem } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export interface MailboxReconciliationReport {
  recovered: number;
  deadLettered: number;
  pendingByAgent: Record<string, number>;
  scannedAt: string;
}

/**
 * Reconciliador pós-crash para `projecao_agent_mailbox`:
 * recupera mensagens presas em `status = 'leased'` cujo lease expirou (ou que ficaram
 * órfãs em queda abrupta) retornando-as para `pending` ou movendo para `dead_letter`.
 */
export class MailboxReconciler {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public reconcileOnStartup(options: { nowIso?: string; recoverAllLeased?: boolean } = {}): MailboxReconciliationReport {
    const nowIso = options.nowIso ?? new Date().toISOString();

    return this.db.runInTransaction(() => {
      const staleRows = (
        options.recoverAllLeased
          ? this.db.connection
              .prepare("SELECT * FROM projecao_agent_mailbox WHERE status = 'leased';")
              .all()
          : this.db.connection
              .prepare(
                `
                SELECT * FROM projecao_agent_mailbox
                WHERE status = 'leased'
                  AND (lease_expires_at IS NULL OR lease_expires_at <= ?);
              `
              )
              .all(nowIso)
      ) as unknown as AgentMailboxItem[];

      let recovered = 0;
      let deadLettered = 0;

      for (const row of staleRows) {
        const exceeded = row.attempt_count >= row.max_attempts;
        if (exceeded) {
          this.db.connection
            .prepare(
              `
              UPDATE projecao_agent_mailbox
              SET status = 'dead_letter',
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  last_error = COALESCE(last_error, 'Limite máximo de tentativas excedido após queda/reconciliação.')
              WHERE mailbox_id = ?;
            `
            )
            .run(row.mailbox_id);
          deadLettered += 1;
        } else {
          this.db.connection
            .prepare(
              `
              UPDATE projecao_agent_mailbox
              SET status = 'pending',
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  last_error = 'Reconciliado automaticamente após reinício do daemon.'
              WHERE mailbox_id = ?;
            `
            )
            .run(row.mailbox_id);
          recovered += 1;
        }
      }

      if (recovered > 0 || deadLettered > 0) {
        this.db.connection
          .prepare(
            `
            INSERT INTO eventos_orquestracao (
              evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
            ) VALUES (?, ?, 'mailbox', 'reconciler', 'mailbox_reconciliado_startup', ?, ?);
          `
          )
          .run(
            randomUUID(),
            randomUUID(),
            nowIso,
            JSON.stringify({ recovered, deadLettered })
          );
      }

      const pendingRows = this.db.connection
        .prepare(
          "SELECT agente_id, COUNT(*) AS qtd FROM projecao_agent_mailbox WHERE status = 'pending' GROUP BY agente_id;"
        )
        .all() as Array<{ agente_id: string; qtd: number }>;

      const pendingByAgent: Record<string, number> = {};
      for (const r of pendingRows) {
        pendingByAgent[r.agente_id] = Number(r.qtd ?? 0);
      }

      return {
        recovered,
        deadLettered,
        pendingByAgent,
        scannedAt: nowIso,
      };
    });
  }
}
