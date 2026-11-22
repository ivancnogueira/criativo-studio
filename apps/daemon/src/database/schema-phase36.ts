import type { SchemaTableDefinition } from "./schema-core.ts";

export const SCHEMA_PHASE36_TABLES: readonly SchemaTableDefinition[] = [
  {
    nome: "team_members",
    sql: `
      CREATE TABLE IF NOT EXISTS team_members (
        member_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'editor', 'viewer')),
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        last_active_at TEXT
      );
    `,
  },
  {
    nome: "team_invites",
    sql: `
      CREATE TABLE IF NOT EXISTS team_invites (
        invite_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    nome: "team_agent_permissions",
    sql: `
      CREATE TABLE IF NOT EXISTS team_agent_permissions (
        grant_id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE CASCADE,
        agente_id TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1 CHECK(allowed IN (0, 1)),
        updated_at TEXT NOT NULL,
        UNIQUE(member_id, agente_id)
      );
    `,
  },
  {
    nome: "team_mcp_permissions",
    sql: `
      CREATE TABLE IF NOT EXISTS team_mcp_permissions (
        grant_id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE CASCADE,
        mcp_id TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1 CHECK(allowed IN (0, 1)),
        updated_at TEXT NOT NULL,
        UNIQUE(member_id, mcp_id)
      );
    `,
  },
  {
    nome: "server_audit_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS server_audit_logs (
        audit_id TEXT PRIMARY KEY,
        actor_member_id TEXT,
        actor_label TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_server_audit_created
        ON server_audit_logs(created_at DESC);
    `,
  },
  {
    nome: "instance_transfer_history",
    sql: `
      CREATE TABLE IF NOT EXISTS instance_transfer_history (
        job_id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK(direction IN ('export', 'import')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'transferring', 'completed', 'failed', 'rolled_back')),
        target_server_url TEXT,
        total_chunks INTEGER NOT NULL DEFAULT 0,
        completed_chunks INTEGER NOT NULL DEFAULT 0,
        payload_sha256 TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    nome: "crm_contacts",
    sql: `
      CREATE TABLE IF NOT EXISTS crm_contacts (
        contact_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        stage TEXT NOT NULL DEFAULT 'lead' CHECK(stage IN ('lead', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido')),
        tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
        owner_agent_id TEXT,
        source_channel TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage
        ON crm_contacts(stage, updated_at DESC);
    `,
  },
  {
    nome: "crm_activities",
    sql: `
      CREATE TABLE IF NOT EXISTS crm_activities (
        activity_id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES crm_contacts(contact_id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        summary TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_activities_contact
        ON crm_activities(contact_id, created_at DESC);
    `,
  },
  {
    nome: "crm_proposals",
    sql: `
      CREATE TABLE IF NOT EXISTS crm_proposals (
        proposal_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('create_contact', 'update_contact', 'move_stage', 'add_activity')),
        contact_id TEXT,
        summary TEXT NOT NULL,
        diff_json TEXT NOT NULL CHECK(json_valid(diff_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        decided_by TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_crm_proposals_status
        ON crm_proposals(status, created_at DESC);
    `,
  },
];
