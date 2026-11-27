import type { SchemaTableDefinition } from "./schema-core.ts";

/**
 * Tabelas SQLite da Fase 44 (Meta Graph API 2026):
 * - `meta_first_comments_queue`: fila persistente de 1º comentário pós-publicação com trava humana
 * - `meta_media_audit_logs`: trilha auditável de publicação, Trial Reels, comentários e exclusão controlada
 */
export const SCHEMA_PHASE44_TABLES: readonly SchemaTableDefinition[] = [
  {
    nome: "meta_first_comments_queue",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_first_comments_queue (
        comment_job_id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        editorial_post_id TEXT,
        conta_id TEXT,
        comment_text TEXT NOT NULL,
        delay_seconds INTEGER NOT NULL DEFAULT 30,
        scheduled_for TEXT NOT NULL,
        approved_by_human INTEGER NOT NULL DEFAULT 0 CHECK(approved_by_human IN (0, 1)),
        approved_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval', 'scheduled', 'processing', 'posted', 'failed', 'cancelled')),
        meta_comment_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        posted_em TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_meta_first_comments_due
        ON meta_first_comments_queue(status, approved_by_human, scheduled_for);
    `,
  },
  {
    nome: "meta_media_audit_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_media_audit_logs (
        audit_id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        editorial_post_id TEXT,
        conta_id TEXT,
        action TEXT NOT NULL CHECK(action IN ('publish', 'trial_reel', 'first_comment', 'delete_media', 'cache_remove')),
        actor_label TEXT NOT NULL,
        confirmed_by_human INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_by_human IN (0, 1)),
        http_status INTEGER,
        graph_error_code TEXT,
        outcome TEXT NOT NULL CHECK(outcome IN ('success', 'deleted_remote', 'unsupported_by_meta_api', 'blocked', 'failed')),
        reason TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),
        criado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_media_audit_created
        ON meta_media_audit_logs(media_id, criado_em DESC);
    `,
  },
];
