import type {
  AgentAccessGrant,
  CrmActivity,
  CrmContact,
  CrmProposal,
  CrmStage,
  InstanceTransferJob,
  InstanceTransferManifest,
  InstanceTransferScope,
  ServerAuditEntry,
  TeamCapabilities,
  TeamInvite,
  TeamMember,
  TeamRole,
  VoiceExecutionMode,
  VoiceHostStatusSnapshot,
  WorkflowPresenceMember,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const phase36Api = {
  async getTeamCapabilities(): Promise<TeamCapabilities> {
    const res = await apiFetch("/api/team/capabilities");
    return (await res.json()) as TeamCapabilities;
  },

  async listTeamMembers(): Promise<{ members: TeamMember[]; invites: TeamInvite[] }> {
    const res = await apiFetch("/api/team/members");
    const json = (await res.json()) as { members?: TeamMember[]; invites?: TeamInvite[] };
    return { members: json.members ?? [], invites: json.invites ?? [] };
  },

  async createTeamInvite(payload: {
    email: string;
    role: Exclude<TeamRole, "owner">;
  }): Promise<{ invite: TeamInvite; inviteToken: string }> {
    const res = await apiFetch("/api/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      invite?: TeamInvite;
      inviteToken?: string;
      erro?: string;
    };
    if (!res.ok || !json.invite || !json.inviteToken) {
      throw new Error(json.erro ?? "Falha ao criar convite.");
    }
    return { invite: json.invite, inviteToken: json.inviteToken };
  },

  async updateTeamMemberRole(memberId: string, role: TeamRole): Promise<TeamMember> {
    const res = await apiFetch(`/api/team/members/${encodeURIComponent(memberId)}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const json = (await res.json()) as { member?: TeamMember; erro?: string };
    if (!res.ok || !json.member) {
      throw new Error(json.erro ?? "Falha ao atualizar papel.");
    }
    return json.member;
  },

  async revokeTeamMember(memberId: string): Promise<void> {
    await apiFetch(`/api/team/members/${encodeURIComponent(memberId)}`, {
      method: "DELETE",
    });
  },

  async listMemberPermissions(memberId: string): Promise<AgentAccessGrant[]> {
    const res = await apiFetch(`/api/team/members/${encodeURIComponent(memberId)}/permissions`);
    const json = (await res.json()) as { permissions?: AgentAccessGrant[] };
    return json.permissions ?? [];
  },

  async setMemberPermission(
    memberId: string,
    payload: { targetKind: "agent" | "mcp"; targetId: string; allowed: boolean },
  ): Promise<void> {
    await apiFetch(`/api/team/members/${encodeURIComponent(memberId)}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async listServerAuditLogs(limit = 50): Promise<ServerAuditEntry[]> {
    const res = await apiFetch(`/api/audit?limit=${limit}`);
    const json = (await res.json()) as { logs?: ServerAuditEntry[] };
    return json.logs ?? [];
  },

  async listWorkflowPresence(workflowId: string): Promise<WorkflowPresenceMember[]> {
    const res = await apiFetch(
      `/api/workflows/presence?workflowId=${encodeURIComponent(workflowId)}`,
    );
    const json = (await res.json()) as { members?: WorkflowPresenceMember[] };
    return json.members ?? [];
  },

  async updateWorkflowPresence(
    workflowId: string,
    action: "join" | "leave" | "heartbeat" = "join",
    opts?: { selectedNodeId?: string | null; cursorX?: number | null; cursorY?: number | null },
  ): Promise<WorkflowPresenceMember[]> {
    const res = await apiFetch("/api/workflows/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        action,
        ...(opts?.selectedNodeId !== undefined ? { selectedNodeId: opts.selectedNodeId } : {}),
        ...(opts?.cursorX !== undefined ? { cursorX: opts.cursorX } : {}),
        ...(opts?.cursorY !== undefined ? { cursorY: opts.cursorY } : {}),
      }),
    });
    const json = (await res.json()) as { members?: WorkflowPresenceMember[] };
    return json.members ?? [];
  },

  async listTransferHistory(): Promise<InstanceTransferJob[]> {
    const res = await apiFetch("/api/transfer/history");
    const json = (await res.json()) as { history?: InstanceTransferJob[] };
    return json.history ?? [];
  },

  async exportInstanceBundle(scope: InstanceTransferScope): Promise<{
    manifest: InstanceTransferManifest;
    chunks: Array<{ index: number; totalChunks: number; chunkSha256: string; dataBase64: string }>;
  }> {
    const res = await apiFetch("/api/transfer/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const json = (await res.json()) as {
      manifest?: InstanceTransferManifest;
      chunks?: Array<{ index: number; totalChunks: number; chunkSha256: string; dataBase64: string }>;
      erro?: string;
    };
    if (!res.ok || !json.manifest || !json.chunks) {
      throw new Error(json.erro ?? "Falha ao exportar pacote da instância.");
    }
    return { manifest: json.manifest, chunks: json.chunks };
  },

  async getCrmStatus(): Promise<boolean> {
    const res = await apiFetch("/api/crm/status");
    const json = (await res.json()) as { enabled?: boolean };
    return Boolean(json.enabled);
  },

  async toggleCrm(enabled: boolean): Promise<boolean> {
    const res = await apiFetch("/api/crm/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const json = (await res.json()) as { enabled?: boolean };
    return Boolean(json.enabled);
  },

  async listCrmContacts(q = ""): Promise<{ enabled: boolean; contacts: CrmContact[] }> {
    const res = await apiFetch(`/api/crm/contacts?q=${encodeURIComponent(q)}`);
    const json = (await res.json()) as { enabled?: boolean; contacts?: CrmContact[] };
    return { enabled: Boolean(json.enabled), contacts: json.contacts ?? [] };
  },

  async createCrmContact(payload: {
    name: string;
    email?: string | null;
    company?: string | null;
    stage?: CrmStage;
  }): Promise<CrmContact> {
    const res = await apiFetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { contact?: CrmContact; erro?: string };
    if (!res.ok || !json.contact) {
      throw new Error(json.erro ?? "Falha ao criar contato CRM.");
    }
    return json.contact;
  },

  async listCrmActivities(contactId?: string): Promise<CrmActivity[]> {
    const q = contactId ? `?contactId=${encodeURIComponent(contactId)}` : "";
    const res = await apiFetch(`/api/crm/activities${q}`);
    const json = (await res.json()) as { activities?: CrmActivity[] };
    return json.activities ?? [];
  },

  async listCrmProposals(): Promise<CrmProposal[]> {
    const res = await apiFetch("/api/crm/proposals");
    const json = (await res.json()) as { proposals?: CrmProposal[] };
    return json.proposals ?? [];
  },

  async decideCrmProposal(proposalId: string, approved: boolean): Promise<CrmProposal> {
    const action = approved ? "approve" : "reject";
    const res = await apiFetch(
      `/api/crm/proposals/${encodeURIComponent(proposalId)}/${action}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    const json = (await res.json()) as { proposal?: CrmProposal; erro?: string };
    if (!res.ok || !json.proposal) {
      throw new Error(json.erro ?? "Falha ao decidir proposta CRM.");
    }
    return json.proposal;
  },

  async getVoiceHostStatus(): Promise<VoiceHostStatusSnapshot> {
    const res = await apiFetch("/api/voice/status");
    return (await res.json()) as VoiceHostStatusSnapshot;
  },

  async updateVoiceHostMode(payload: {
    mode: VoiceExecutionMode;
    activeSttModel?: string;
    activeTtsVoice?: string;
  }): Promise<VoiceHostStatusSnapshot> {
    const res = await apiFetch("/api/voice/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { status?: VoiceHostStatusSnapshot };
    if (!res.ok || !json.status) {
      throw new Error("Falha ao atualizar modo de voz.");
    }
    return json.status;
  },

  async installLocalVoiceModel(modelId: string): Promise<void> {
    await apiFetch("/api/voice/models/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
    });
  },

  async removeLocalVoiceModel(modelId: string): Promise<void> {
    await apiFetch(`/api/voice/models/${encodeURIComponent(modelId)}`, {
      method: "DELETE",
    });
  },
};
