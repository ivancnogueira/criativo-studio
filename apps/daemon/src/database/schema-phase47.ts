import type { SchemaTableDefinition } from "./schema-core.ts";

/**
 * Tabelas SQLite isoladas da Fase 47 (Automação Comentário -> Direct, Fluxos Multi-Etapa 24h,
 * Rate-Limiter 200 req/h, Aprovação Humana, Logs e Entregáveis Públicos HTTPS).
 * Mantém `apps/daemon/src/database/migrations.ts` estritamente congelado.
 */
export const SCHEMA_PHASE47_TABLES: readonly SchemaTableDefinition[] = [
  {
    nome: "meta_comment_rules",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_rules (
        rule_id TEXT PRIMARY KEY,
        conta_id TEXT,
        nome TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 0,
        match_mode TEXT NOT NULL DEFAULT 'contains',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        negative_keywords_json TEXT NOT NULL DEFAULT '[]',
        post_scope TEXT NOT NULL DEFAULT 'all_posts',
        target_media_ids_json TEXT NOT NULL DEFAULT '[]',
        include_comment_replies INTEGER NOT NULL DEFAULT 0,
        allow_live_comments INTEGER NOT NULL DEFAULT 0,
        reply_once_per_user_per_post INTEGER NOT NULL DEFAULT 1,
        require_human_approval INTEGER NOT NULL DEFAULT 0,
        public_replies_json TEXT NOT NULL DEFAULT '[]',
        opening_message_json TEXT NOT NULL DEFAULT '{}',
        flow_nodes_json TEXT NOT NULL DEFAULT '[]',
        crm_tags_json TEXT NOT NULL DEFAULT '[]',
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_comment_rules_conta_ativo
        ON meta_comment_rules (conta_id, ativo, atualizado_em);
    `,
  },
  {
    nome: "meta_comment_receipts",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_receipts (
        receipt_id TEXT PRIMARY KEY,
        conta_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        sender_ig_id TEXT NOT NULL,
        rule_id TEXT,
        source_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(conta_id, comment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_meta_comment_receipts_user_post
        ON meta_comment_receipts (conta_id, media_id, sender_ig_id, status);
    `,
  },
  {
    nome: "meta_dm_flow_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_dm_flow_sessions (
        session_id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        conta_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        ig_user_id TEXT NOT NULL,
        ig_username TEXT,
        anchor_spent INTEGER NOT NULL DEFAULT 0,
        window_24h_expires_at TEXT,
        current_node_id TEXT,
        waiting_for TEXT,
        collected_data_json TEXT NOT NULL DEFAULT '{}',
        next_run_at TEXT,
        status TEXT NOT NULL,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_dm_sessions_user
        ON meta_dm_flow_sessions (conta_id, ig_user_id, atualizado_em);
      CREATE INDEX IF NOT EXISTS idx_meta_dm_sessions_due
        ON meta_dm_flow_sessions (status, next_run_at);
    `,
  },
  {
    nome: "meta_comment_rate_buckets",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_rate_buckets (
        conta_id TEXT NOT NULL,
        hour_bucket_utc TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        atualizado_em TEXT NOT NULL,
        PRIMARY KEY (conta_id, hour_bucket_utc)
      );
    `,
  },
  {
    nome: "meta_comment_pending_approvals",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_pending_approvals (
        approval_id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        conta_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        sender_ig_id TEXT NOT NULL,
        sender_username TEXT,
        comment_text TEXT NOT NULL,
        proposed_public_reply TEXT,
        proposed_dm_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decided_by TEXT,
        criado_em TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_meta_comment_approvals_status
        ON meta_comment_pending_approvals (status, criado_em);
    `,
  },
  {
    nome: "meta_comment_action_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_action_logs (
        log_id TEXT PRIMARY KEY,
        conta_id TEXT NOT NULL,
        rule_id TEXT,
        session_id TEXT,
        comment_id TEXT,
        event_kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        criado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_comment_logs_created
        ON meta_comment_action_logs (criado_em DESC);
      CREATE INDEX IF NOT EXISTS idx_meta_comment_logs_conta
        ON meta_comment_action_logs (conta_id, outcome, criado_em DESC);
    `,
  },
  {
    nome: "meta_public_deliverables",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_public_deliverables (
        deliverable_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        titulo TEXT NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL,
        public_https_url TEXT NOT NULL,
        local_artifact_path TEXT,
        agente_id TEXT,
        github_repo TEXT,
        github_commit_sha TEXT,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_deliverables_ativo
        ON meta_public_deliverables (ativo, atualizado_em DESC);
    `,
  },
  {
    nome: "meta_comment_sync_cursors",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_sync_cursors (
        conta_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        last_seen_comment_ts TEXT,
        last_cursor TEXT,
        atualizado_em TEXT NOT NULL,
        PRIMARY KEY (conta_id, media_id)
      );
    `,
  },
  {
    nome: "meta_comment_connection_config",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_comment_connection_config (
        conta_id TEXT PRIMARY KEY,
        reception_mode TEXT NOT NULL DEFAULT 'polling',
        poll_interval_sec INTEGER NOT NULL DEFAULT 45,
        relay_channel_id TEXT,
        relay_verify_token TEXT,
        relay_enabled INTEGER NOT NULL DEFAULT 0,
        public_https_domain TEXT,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
];

export const SCHEMA_PHASE47_TABLE_NAMES = [
  "meta_comment_rules",
  "meta_comment_receipts",
  "meta_dm_flow_sessions",
  "meta_comment_rate_buckets",
  "meta_comment_pending_approvals",
  "meta_comment_action_logs",
  "meta_public_deliverables",
  "meta_comment_sync_cursors",
  "meta_comment_connection_config",
] as const;
