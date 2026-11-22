import { randomUUID } from "node:crypto";
import type {
  AgentMailboxItem,
  MailboxEntryStatus,
  MailboxSourceKind,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export interface EnqueueMailboxInput {
  mailbox_id?: string;
  agente_id: string;
  source_kind: MailboxSourceKind;
  idempotency_key: string;
  payload: Record<string, unknown>;
  priority?: number;
  max_attempts?: number;
}

interface MailboxRow {
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

function mapMailboxRow(row: MailboxRow): AgentMailboxItem {
  return {
    mailbox_id: row.mailbox_id,
    agente_id: row.agente_id,
    source_kind: row.source_kind,
    idempotency_key: row.idempotency_key,
    payload_json: row.payload_json,
    priority: row.priority,
    status: row.status,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    lease_owner: row.lease_owner ?? null,
    lease_expires_at: row.lease_expires_at ?? null,
    last_error: row.last_error ?? null,
    created_at: row.created_at,
    delivered_at: row.delivered_at ?? null,
    acked_at: row.acked_at ?? null,
  };
}

/**
 * Caixa de entrada persistente transacional por agente (`projecao_agent_mailbox`).
 * Garante deduplicação via `idempotency_key` e lease exclusivo para despacho ordenado.
 */
export class MailboxStore {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public enqueue(input: EnqueueMailboxInput): { item: AgentMailboxItem; inserted: boolean } {
    const id = input.mailbox_id?.trim() || `mbx-${randomUUID()}`;
    const agora = new Date().toISOString();
    const priority = Math.max(1, Math.min(10, Math.round(input.priority ?? 5)));
    const maxAttempts = Math.max(1, Math.min(20, Math.round(input.max_attempts ?? 5)));
    const payloadJson = JSON.stringify(input.payload ?? {});

    return this.db.runInTransaction(() => {
      const info = this.db.connection
        .prepare(
          `
          INSERT INTO projecao_agent_mailbox (
            mailbox_id, agente_id, source_kind, idempotency_key, payload_json,
            priority, status, attempt_count, max_attempts, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING;
        `
        )
        .run(
          id,
          input.agente_id,
          input.source_kind,
          input.idempotency_key,
          payloadJson,
          priority,
          maxAttempts,
          agora
        );

      const inserted = Number(info.changes ?? 0) > 0;
      const row = this.db.connection
        .prepare("SELECT * FROM projecao_agent_mailbox WHERE idempotency_key = ? LIMIT 1;")
        .get(input.idempotency_key) as unknown as MailboxRow;

      return { item: mapMailboxRow(row), inserted };
    });
  }

  public getById(mailboxId: string): AgentMailboxItem | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_agent_mailbox WHERE mailbox_id = ? LIMIT 1;")
      .get(mailboxId) as unknown as MailboxRow | undefined;
    return row ? mapMailboxRow(row) : null;
  }

  public claimNextForAgent(
    agenteId: string,
    leaseOwner: string,
    leaseMs = 60_000
  ): AgentMailboxItem | null {
    return this.db.runInTransaction(() => {
      const row = this.db.connection
        .prepare(
          `
          SELECT * FROM projecao_agent_mailbox
          WHERE agente_id = ? AND status = 'pending'
          ORDER BY priority ASC, created_at ASC
          LIMIT 1;
        `
        )
        .get(agenteId) as unknown as MailboxRow | undefined;
      if (!row) return null;

      const leaseExpiresAt = new Date(Date.now() + Math.max(1000, leaseMs)).toISOString();
      this.db.connection
        .prepare(
          `
          UPDATE projecao_agent_mailbox
          SET status = 'leased',
              lease_owner = ?,
              lease_expires_at = ?,
              attempt_count = attempt_count + 1
          WHERE mailbox_id = ? AND status = 'pending';
        `
        )
        .run(leaseOwner, leaseExpiresAt, row.mailbox_id);

      return this.getById(row.mailbox_id);
    });
  }

  public markDelivered(mailboxId: string): AgentMailboxItem | null {
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        UPDATE projecao_agent_mailbox
        SET status = 'delivered',
            lease_owner = NULL,
            lease_expires_at = NULL,
            delivered_at = ?
        WHERE mailbox_id = ? AND status IN ('pending', 'leased');
      `
      )
      .run(agora, mailboxId);
    return this.getById(mailboxId);
  }

  public ack(mailboxId: string): AgentMailboxItem | null {
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        UPDATE projecao_agent_mailbox
        SET status = 'acked',
            lease_owner = NULL,
            lease_expires_at = NULL,
            delivered_at = COALESCE(delivered_at, ?),
            acked_at = ?
        WHERE mailbox_id = ?;
      `
      )
      .run(agora, agora, mailboxId);
    return this.getById(mailboxId);
  }

  public failOrDeadLetter(mailboxId: string, errorMsg: string): AgentMailboxItem | null {
    return this.db.runInTransaction(() => {
      const item = this.getById(mailboxId);
      if (!item) return null;
      const nextStatus: MailboxEntryStatus =
        item.attempt_count >= item.max_attempts ? "dead_letter" : "pending";
      this.db.connection
        .prepare(
          `
          UPDATE projecao_agent_mailbox
          SET status = ?,
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error = ?
          WHERE mailbox_id = ?;
        `
        )
        .run(nextStatus, errorMsg.slice(0, 1000), mailboxId);
      return this.getById(mailboxId);
    });
  }

  public listByAgent(agenteId: string, status?: MailboxEntryStatus): AgentMailboxItem[] {
    const rows = (
      status
        ? this.db.connection
            .prepare(
              "SELECT * FROM projecao_agent_mailbox WHERE agente_id = ? AND status = ? ORDER BY priority ASC, created_at ASC;"
            )
            .all(agenteId, status)
        : this.db.connection
            .prepare(
              "SELECT * FROM projecao_agent_mailbox WHERE agente_id = ? ORDER BY priority ASC, created_at ASC;"
            )
            .all(agenteId)
    ) as unknown as MailboxRow[];
    return rows.map(mapMailboxRow);
  }
}
