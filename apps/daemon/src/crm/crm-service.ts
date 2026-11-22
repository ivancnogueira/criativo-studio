import { randomUUID } from "node:crypto";
import type {
  CrmActivity,
  CrmContact,
  CrmProposal,
  CrmStage,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

const CRM_ENABLED_KEY = "crm_module_enabled";

interface CrmContactRow {
  contact_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: CrmStage;
  tags_json: string;
  owner_agent_id: string | null;
  source_channel: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface CrmProposalRow {
  proposal_id: string;
  agente_id: string;
  operation: CrmProposal["operation"];
  contact_id: string | null;
  summary: string;
  diff_json: string;
  status: CrmProposal["status"];
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

function toContact(row: CrmContactRow): CrmContact {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json);
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    contactId: row.contact_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    stage: row.stage,
    tags,
    ownerAgentId: row.owner_agent_id,
    sourceChannel: row.source_channel,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProposal(row: CrmProposalRow): CrmProposal {
  let diffJson: Record<string, unknown> = {};
  try {
    diffJson = JSON.parse(row.diff_json) as Record<string, unknown>;
  } catch {
    diffJson = {};
  }
  return {
    proposalId: row.proposal_id,
    agenteId: row.agente_id,
    operation: row.operation,
    contactId: row.contact_id,
    summary: row.summary,
    diffJson,
    status: row.status,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class CrmService {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public isEnabled(): boolean {
    try {
      const row = this.db.connection
        .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ?;")
        .get(CRM_ENABLED_KEY) as { valor_json: string } | undefined;
      if (!row?.valor_json) return false;
      const parsed = JSON.parse(row.valor_json) as { enabled?: unknown };
      return parsed.enabled === true;
    } catch {
      return false;
    }
  }

  public setEnabled(enabled: boolean): boolean {
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET
           valor_json = excluded.valor_json,
           atualizado_em = excluded.atualizado_em;`,
      )
      .run(CRM_ENABLED_KEY, JSON.stringify({ enabled: Boolean(enabled) }), now);
    return this.isEnabled();
  }

  public listContacts(search?: string): CrmContact[] {
    const q = search?.trim().toLowerCase() ?? "";
    const rows = this.db.connection
      .prepare("SELECT * FROM crm_contacts ORDER BY updated_at DESC;")
      .all() as unknown as CrmContactRow[];
    const list = rows.map(toContact);
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q),
    );
  }

  public createContact(input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    stage?: CrmStage;
    tags?: string[];
    ownerAgentId?: string | null;
    sourceChannel?: string | null;
    notes?: string;
  }): CrmContact {
    const contactId = `crmc_${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO crm_contacts (
          contact_id, name, email, phone, company, stage, tags_json, owner_agent_id, source_channel, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      )
      .run(
        contactId,
        input.name.trim(),
        input.email?.trim() || null,
        input.phone?.trim() || null,
        input.company?.trim() || null,
        input.stage ?? "lead",
        JSON.stringify(input.tags ?? []),
        input.ownerAgentId ?? null,
        input.sourceChannel ?? null,
        input.notes ?? "",
        now,
        now,
      );

    const row = this.db.connection
      .prepare("SELECT * FROM crm_contacts WHERE contact_id = ?;")
      .get(contactId) as unknown as CrmContactRow;
    return toContact(row);
  }

  public updateContact(
    contactId: string,
    patch: Partial<{
      name: string;
      email: string | null;
      phone: string | null;
      company: string | null;
      stage: CrmStage;
      tags: string[];
      notes: string;
    }>,
  ): CrmContact | null {
    const existing = this.db.connection
      .prepare("SELECT * FROM crm_contacts WHERE contact_id = ?;")
      .get(contactId) as unknown as CrmContactRow | undefined;
    if (!existing) return null;

    const current = toContact(existing);
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE crm_contacts
         SET name = ?, email = ?, phone = ?, company = ?, stage = ?, tags_json = ?, notes = ?, updated_at = ?
         WHERE contact_id = ?;`,
      )
      .run(
        patch.name !== undefined ? patch.name.trim() : current.name,
        patch.email !== undefined ? patch.email : current.email,
        patch.phone !== undefined ? patch.phone : current.phone,
        patch.company !== undefined ? patch.company : current.company,
        patch.stage ?? current.stage,
        JSON.stringify(patch.tags ?? current.tags),
        patch.notes !== undefined ? patch.notes : current.notes,
        now,
        contactId,
      );

    const row = this.db.connection
      .prepare("SELECT * FROM crm_contacts WHERE contact_id = ?;")
      .get(contactId) as unknown as CrmContactRow;
    return toContact(row);
  }

  public addActivity(input: {
    contactId: string;
    channel: string;
    summary: string;
    author: string;
  }): CrmActivity {
    const activityId = `crma_${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO crm_activities (activity_id, contact_id, channel, summary, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
      )
      .run(activityId, input.contactId, input.channel, input.summary, input.author, now);
    return {
      activityId,
      contactId: input.contactId,
      channel: input.channel,
      summary: input.summary,
      author: input.author,
      createdAt: now,
    };
  }

  public listActivities(contactId?: string): CrmActivity[] {
    const rows = (
      contactId
        ? this.db.connection
            .prepare("SELECT * FROM crm_activities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 100;")
            .all(contactId)
        : this.db.connection
            .prepare("SELECT * FROM crm_activities ORDER BY created_at DESC LIMIT 100;")
            .all()
    ) as unknown as Array<{
      activity_id: string;
      contact_id: string;
      channel: string;
      summary: string;
      author: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      activityId: r.activity_id,
      contactId: r.contact_id,
      channel: r.channel,
      summary: r.summary,
      author: r.author,
      createdAt: r.created_at,
    }));
  }

  public proposeMutation(params: {
    agenteId: string;
    operation: CrmProposal["operation"];
    contactId?: string | null;
    summary: string;
    diff: Record<string, unknown>;
  }): CrmProposal {
    const proposalId = `crmp_${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO crm_proposals (
          proposal_id, agente_id, operation, contact_id, summary, diff_json, status, decided_by, created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL);`,
      )
      .run(
        proposalId,
        params.agenteId,
        params.operation,
        params.contactId ?? null,
        params.summary,
        JSON.stringify(params.diff ?? {}),
        now,
      );

    const row = this.db.connection
      .prepare("SELECT * FROM crm_proposals WHERE proposal_id = ?;")
      .get(proposalId) as unknown as CrmProposalRow;
    return toProposal(row);
  }

  public listProposals(status?: CrmProposal["status"]): CrmProposal[] {
    const rows = (
      status
        ? this.db.connection
            .prepare("SELECT * FROM crm_proposals WHERE status = ? ORDER BY created_at DESC;")
            .all(status)
        : this.db.connection
            .prepare("SELECT * FROM crm_proposals ORDER BY created_at DESC;")
            .all()
    ) as unknown as CrmProposalRow[];
    return rows.map(toProposal);
  }

  public decideProposal(params: {
    proposalId: string;
    approved: boolean;
    decidedBy?: string;
    editedDiff?: Record<string, unknown>;
  }): { proposal: CrmProposal; appliedContact?: CrmContact | null } {
    const row = this.db.connection
      .prepare("SELECT * FROM crm_proposals WHERE proposal_id = ? LIMIT 1;")
      .get(params.proposalId) as unknown as CrmProposalRow | undefined;
    if (!row) {
      throw new Error(`Proposta CRM '${params.proposalId}' não encontrada.`);
    }
    if (row.status !== "pending") {
      throw new Error(`Proposta CRM '${params.proposalId}' já foi decidida (${row.status}).`);
    }

    const proposal = toProposal(row);
    const diff = params.editedDiff ?? proposal.diffJson;
    const now = new Date().toISOString();
    const decidedBy = params.decidedBy ?? "operador";
    let appliedContact: CrmContact | null = null;

    this.db.runInTransaction(() => {
      if (params.approved) {
        if (proposal.operation === "create_contact") {
          appliedContact = this.createContact({
            name: String(diff.name ?? "Novo Contato"),
            email: typeof diff.email === "string" ? diff.email : null,
            phone: typeof diff.phone === "string" ? diff.phone : null,
            company: typeof diff.company === "string" ? diff.company : null,
            stage: (diff.stage as CrmStage) ?? "lead",
            tags: Array.isArray(diff.tags) ? diff.tags.map(String) : [],
            ownerAgentId: proposal.agenteId,
            sourceChannel: typeof diff.sourceChannel === "string" ? diff.sourceChannel : null,
            notes: typeof diff.notes === "string" ? diff.notes : "",
          });
        } else if (
          (proposal.operation === "update_contact" || proposal.operation === "move_stage") &&
          proposal.contactId
        ) {
          appliedContact = this.updateContact(proposal.contactId, {
            name: typeof diff.name === "string" ? diff.name : undefined,
            email: diff.email === null || typeof diff.email === "string" ? diff.email : undefined,
            phone: diff.phone === null || typeof diff.phone === "string" ? diff.phone : undefined,
            company: diff.company === null || typeof diff.company === "string" ? diff.company : undefined,
            stage: typeof diff.stage === "string" ? (diff.stage as CrmStage) : undefined,
            notes: typeof diff.notes === "string" ? diff.notes : undefined,
            tags: Array.isArray(diff.tags) ? diff.tags.map(String) : undefined,
          });
        } else if (proposal.operation === "add_activity" && proposal.contactId) {
          this.addActivity({
            contactId: proposal.contactId,
            channel: typeof diff.channel === "string" ? diff.channel : "chat",
            summary: String(diff.summary ?? proposal.summary),
            author: proposal.agenteId,
          });
        }
      }

      this.db.connection
        .prepare(
          `UPDATE crm_proposals
           SET status = ?, decided_by = ?, decided_at = ?, diff_json = ?
           WHERE proposal_id = ?;`,
        )
        .run(
          params.approved ? "approved" : "rejected",
          decidedBy,
          now,
          JSON.stringify(diff),
          params.proposalId,
        );
    });

    const updated = this.db.connection
      .prepare("SELECT * FROM crm_proposals WHERE proposal_id = ?;")
      .get(params.proposalId) as unknown as CrmProposalRow;

    return {
      proposal: toProposal(updated),
      appliedContact,
    };
  }
}
