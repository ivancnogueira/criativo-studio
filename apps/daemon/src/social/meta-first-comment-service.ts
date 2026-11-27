import { randomUUID } from "node:crypto";
import {
  resolveMetaGraphApiBase,
  type MetaFirstCommentRecord,
  type MetaFirstCommentStatus,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { resolveMetaCredentials } from "../engine/tools/meta-insights.ts";
import { redactMetaSecrets } from "../engine/tools/meta-trial-eligibility.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { VaultService } from "../vault/vault-service.ts";

interface FirstCommentRow {
  comment_job_id: string;
  media_id: string;
  editorial_post_id: string | null;
  conta_id: string | null;
  comment_text: string;
  delay_seconds: number;
  scheduled_for: string;
  approved_by_human: number;
  approved_at: string | null;
  status: MetaFirstCommentStatus;
  meta_comment_id: string | null;
  attempts: number;
  last_error: string | null;
  criado_em: string;
  atualizado_em: string;
  posted_em: string | null;
}

const VALID_COMMENT_STATUSES = new Set<MetaFirstCommentStatus>([
  "pending_approval",
  "scheduled",
  "processing",
  "posted",
  "failed",
  "cancelled",
]);

function normalizeDelaySeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 30;
  return Math.max(0, Math.min(3600, Math.round(value)));
}

function mapFirstCommentRow(row: FirstCommentRow): MetaFirstCommentRecord {
  return {
    comment_job_id: row.comment_job_id,
    media_id: row.media_id,
    editorial_post_id: row.editorial_post_id ?? null,
    conta_id: row.conta_id ?? null,
    comment_text: row.comment_text,
    delay_seconds: Number(row.delay_seconds ?? 30),
    scheduled_for: row.scheduled_for,
    approved_by_human: Number(row.approved_by_human) === 1,
    approved_at: row.approved_at ?? null,
    status: row.status,
    meta_comment_id: row.meta_comment_id ?? null,
    attempts: Number(row.attempts ?? 0),
    last_error: row.last_error ?? null,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    posted_em: row.posted_em ?? null,
  };
}

export interface MetaFirstCommentServiceDeps {
  db: CriativoDatabase;
  vault?: VaultService;
  nativeStore?: NativeAppConnectionsStore;
  wsHub?: WebSocketHub;
  fetchImpl?: FetchLike;
}

/**
 * Fila persistente crash-safe para 1º Comentário pós-publicação na Meta Graph API v27.0.
 * Invariante crítica: nenhum comentário é enviado sem `approved_by_human === 1`.
 */
export class MetaFirstCommentService {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private readonly nativeStore?: NativeAppConnectionsStore;
  private readonly wsHub?: WebSocketHub;
  private readonly fetchImpl?: FetchLike;
  private timer: NodeJS.Timeout | null = null;
  private runningSweep = false;

  constructor(deps: MetaFirstCommentServiceDeps) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.nativeStore = deps.nativeStore;
    this.wsHub = deps.wsHub;
    this.fetchImpl = deps.fetchImpl;
  }

  public getCommentJob(commentJobId: string): MetaFirstCommentRecord | null {
    const row = this.db.connection
      .prepare("SELECT * FROM meta_first_comments_queue WHERE comment_job_id = ? LIMIT 1;")
      .get(commentJobId) as FirstCommentRow | undefined;
    return row ? mapFirstCommentRow(row) : null;
  }

  public enqueueFirstComment(input: {
    mediaId: string;
    commentText: string;
    approvedByHuman: boolean;
    delaySeconds?: number;
    editorialPostId?: string | null;
    contaId?: string | null;
  }): MetaFirstCommentRecord {
    const mediaId = String(input.mediaId ?? "").trim();
    if (!mediaId) throw new Error("Parâmetro 'media_id' é obrigatório para agendar o 1º comentário.");
    const commentText = String(input.commentText ?? "").trim();
    if (!commentText) throw new Error("O texto do 1º comentário não pode ficar vazio.");
    if (commentText.length > 2200) {
      throw new Error("O texto do 1º comentário excede o limite de 2.200 caracteres da Meta.");
    }

    const delaySeconds = normalizeDelaySeconds(input.delaySeconds);
    const approved = input.approvedByHuman === true;
    const agoraMs = Date.now();
    const agora = new Date(agoraMs).toISOString();
    const scheduledFor = new Date(agoraMs + delaySeconds * 1000).toISOString();
    const commentJobId = `fc-${randomUUID().slice(0, 12)}`;
    const status: MetaFirstCommentStatus = approved ? "scheduled" : "pending_approval";

    this.db.connection
      .prepare(
        `INSERT INTO meta_first_comments_queue (
          comment_job_id, media_id, editorial_post_id, conta_id, comment_text,
          delay_seconds, scheduled_for, approved_by_human, approved_at, status,
          meta_comment_id, attempts, last_error, criado_em, atualizado_em, posted_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?, NULL);`
      )
      .run(
        commentJobId, mediaId, input.editorialPostId?.trim() || null, input.contaId?.trim() || null,
        commentText, delaySeconds, scheduledFor, approved ? 1 : 0, approved ? agora : null,
        status, agora, agora
      );

    const record = this.getCommentJob(commentJobId)!;
    this.broadcastUpdate(record);
    return record;
  }

  public approveFirstComment(commentJobId: string, delaySecondsOverride?: number): MetaFirstCommentRecord {
    const existing = this.getCommentJob(commentJobId);
    if (!existing) throw new Error(`Job de 1º comentário '${commentJobId}' não encontrado.`);
    if (existing.status !== "pending_approval" && existing.status !== "failed") {
      throw new Error(`Job '${commentJobId}' está com status '${existing.status}' e não pode ser aprovado novamente.`);
    }

    const delay =
      delaySecondsOverride !== undefined ? normalizeDelaySeconds(delaySecondsOverride) : existing.delay_seconds;
    const agoraMs = Date.now();
    const agora = new Date(agoraMs).toISOString();
    const scheduledFor = new Date(agoraMs + delay * 1000).toISOString();

    this.db.connection
      .prepare(
        `UPDATE meta_first_comments_queue
         SET approved_by_human = 1, approved_at = ?, status = 'scheduled',
             delay_seconds = ?, scheduled_for = ?, last_error = NULL, atualizado_em = ?
         WHERE comment_job_id = ?;`
      )
      .run(agora, delay, scheduledFor, agora, commentJobId);

    const updated = this.getCommentJob(commentJobId)!;
    this.broadcastUpdate(updated);
    return updated;
  }

  public cancelFirstComment(commentJobId: string): MetaFirstCommentRecord {
    const existing = this.getCommentJob(commentJobId);
    if (!existing) throw new Error(`Job de 1º comentário '${commentJobId}' não encontrado.`);
    if (existing.status === "posted" || existing.status === "cancelled") {
      throw new Error(`Job '${commentJobId}' já está finalizado ('${existing.status}') e não pode ser cancelado.`);
    }

    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE meta_first_comments_queue SET status = 'cancelled', atualizado_em = ?
         WHERE comment_job_id = ? AND status NOT IN ('posted', 'cancelled');`
      )
      .run(agora, commentJobId);

    const updated = this.getCommentJob(commentJobId)!;
    this.broadcastUpdate(updated);
    return updated;
  }

  public listComments(filters?: {
    mediaId?: string;
    editorialPostId?: string;
    status?: MetaFirstCommentStatus;
  }): MetaFirstCommentRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filters?.mediaId?.trim()) {
      clauses.push("media_id = ?");
      params.push(filters.mediaId.trim());
    }
    if (filters?.editorialPostId?.trim()) {
      clauses.push("editorial_post_id = ?");
      params.push(filters.editorialPostId.trim());
    }
    if (filters?.status && VALID_COMMENT_STATUSES.has(filters.status)) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.connection
      .prepare(`SELECT * FROM meta_first_comments_queue ${where} ORDER BY criado_em DESC;`)
      .all(...params) as unknown as FirstCommentRow[];
    return rows.map(mapFirstCommentRow);
  }

  public async dispatchDueComments(
    nowIso?: string
  ): Promise<{ processed: number; posted: number; failed: number }> {
    if (this.runningSweep) return { processed: 0, posted: 0, failed: 0 };
    this.runningSweep = true;
    try {
      const cutoff = nowIso ?? new Date().toISOString();
      const dueRows = this.db.connection
        .prepare(
          `SELECT * FROM meta_first_comments_queue
           WHERE status = 'scheduled' AND approved_by_human = 1 AND scheduled_for <= ?
           ORDER BY scheduled_for ASC;`
        )
        .all(cutoff) as unknown as FirstCommentRow[];

      let processed = 0;
      let posted = 0;
      let failed = 0;
      for (const row of dueRows) {
        const outcome = await this.processSingleCommentRow(row);
        processed += 1;
        if (outcome === "posted") posted += 1;
        if (outcome === "failed") failed += 1;
      }
      return { processed, posted, failed };
    } finally {
      this.runningSweep = false;
    }
  }

  private async processSingleCommentRow(
    row: FirstCommentRow
  ): Promise<"posted" | "retrying" | "failed" | "skipped"> {
    if (Number(row.approved_by_human) !== 1) {
      this.db.connection
        .prepare(`UPDATE meta_first_comments_queue SET status = 'failed', last_error = ?, atualizado_em = ? WHERE comment_job_id = ?;`)
        .run("Bloqueio de segurança: aprovação humana ausente.", new Date().toISOString(), row.comment_job_id);
      return "failed";
    }

    const claim = this.db.connection
      .prepare(
        `UPDATE meta_first_comments_queue SET status = 'processing', atualizado_em = ?
         WHERE comment_job_id = ? AND status = 'scheduled' AND approved_by_human = 1;`
      )
      .run(new Date().toISOString(), row.comment_job_id);
    if (Number(claim.changes ?? 0) === 0) return "skipped";

    const creds = resolveMetaCredentials(this.vault, this.nativeStore, row.conta_id);
    if (!creds.accessToken) {
      this.markFinalFailure(row, row.attempts + 1, "Credenciais Meta ausentes no Cofre AES-256-GCM.", null, "CRV-META-001");
      return "failed";
    }

    const fetchFn = this.fetchImpl ?? fetch;
    const graphBase = resolveMetaGraphApiBase();
    let httpStatus: number | null = null;
    let graphErrorCode: string | null = null;
    let errorMessage = "";
    let transient = false;

    try {
      const res = await fetchFn(`${graphBase}/${encodeURIComponent(row.media_id)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: row.comment_text, access_token: creds.accessToken }),
      });
      httpStatus = res.status;
      const rawText = await res.text();
      let parsed: { id?: string; error?: { message?: string; code?: number } } = {};
      try {
        parsed = rawText ? (JSON.parse(rawText) as typeof parsed) : {};
      } catch {
        parsed = {};
      }

      if (res.ok && parsed.id) {
        const agora = new Date().toISOString();
        this.db.connection
          .prepare(
            `UPDATE meta_first_comments_queue
             SET status = 'posted', meta_comment_id = ?, posted_em = ?, atualizado_em = ?, last_error = NULL
             WHERE comment_job_id = ?;`
          )
          .run(parsed.id, agora, agora, row.comment_job_id);
        this.recordAuditLog(row, "success", res.status, null, `1º comentário publicado (comment_id=${parsed.id}).`, {
          comment_job_id: row.comment_job_id,
          meta_comment_id: parsed.id,
        });
        const updated = this.getCommentJob(row.comment_job_id);
        if (updated) this.broadcastUpdate(updated);
        return "posted";
      }

      graphErrorCode = parsed.error?.code !== undefined ? String(parsed.error.code) : null;
      errorMessage = redactMetaSecrets(
        parsed.error?.message ?? `Erro Meta API ao publicar 1º comentário: HTTP ${res.status}`,
        creds.accessToken
      );
      transient = res.status >= 500 || res.status === 429;
    } catch (err) {
      transient = true;
      errorMessage = redactMetaSecrets(
        err instanceof Error ? err.message : "Erro de rede ao publicar 1º comentário.",
        creds.accessToken
      );
    }

    const nextAttempts = Number(row.attempts ?? 0) + 1;
    if (transient && nextAttempts < 3) {
      const agoraMs = Date.now();
      this.db.connection
        .prepare(
          `UPDATE meta_first_comments_queue
           SET status = 'scheduled', attempts = ?, scheduled_for = ?, last_error = ?, atualizado_em = ?
           WHERE comment_job_id = ?;`
        )
        .run(nextAttempts, new Date(agoraMs + 30_000).toISOString(), errorMessage, new Date(agoraMs).toISOString(), row.comment_job_id);
      const updated = this.getCommentJob(row.comment_job_id);
      if (updated) this.broadcastUpdate(updated);
      return "retrying";
    }

    this.markFinalFailure(row, nextAttempts, errorMessage, httpStatus, graphErrorCode);
    return "failed";
  }

  private markFinalFailure(
    row: FirstCommentRow,
    attempts: number,
    errorMessage: string,
    httpStatus: number | null,
    graphErrorCode: string | null
  ): void {
    this.db.connection
      .prepare(
        `UPDATE meta_first_comments_queue SET status = 'failed', attempts = ?, last_error = ?, atualizado_em = ?
         WHERE comment_job_id = ?;`
      )
      .run(attempts, errorMessage, new Date().toISOString(), row.comment_job_id);

    this.recordAuditLog(row, "failed", httpStatus, graphErrorCode, errorMessage, {
      comment_job_id: row.comment_job_id,
      attempts,
    });
    const updated = this.getCommentJob(row.comment_job_id);
    if (updated) this.broadcastUpdate(updated);
  }

  private recordAuditLog(
    row: FirstCommentRow,
    outcome: "success" | "failed",
    httpStatus: number | null,
    graphErrorCode: string | null,
    reason: string,
    detail: Record<string, unknown>
  ): void {
    const auditId = `aud-${randomUUID().slice(0, 12)}`;
    this.db.connection
      .prepare(
        `INSERT INTO meta_media_audit_logs (
          audit_id, media_id, editorial_post_id, conta_id, action, actor_label,
          confirmed_by_human, http_status, graph_error_code, outcome, reason, detail_json, criado_em
        ) VALUES (?, ?, ?, ?, 'first_comment', 'meta_first_comment_worker', ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        auditId, row.media_id, row.editorial_post_id, row.conta_id,
        Number(row.approved_by_human) === 1 ? 1 : 0, httpStatus, graphErrorCode,
        outcome, reason, JSON.stringify(detail), new Date().toISOString()
      );
    this.wsHub?.broadcast("meta:media_audit_updated", {
      audit_id: auditId,
      media_id: row.media_id,
      action: "first_comment",
      outcome,
    });
  }

  private broadcastUpdate(record: MetaFirstCommentRecord): void {
    this.wsHub?.broadcast("meta:first_comment_updated", {
      comment_job_id: record.comment_job_id,
      media_id: record.media_id,
      status: record.status,
      editorial_post_id: record.editorial_post_id,
    });
  }

  public start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.dispatchDueComments().catch(() => null);
    }, intervalMs);
    this.timer.unref?.();
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
