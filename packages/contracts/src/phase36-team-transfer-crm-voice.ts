// ============================================================================
// G-15: Colaboração Multiusuário (Team API, RBAC, Presença & Auditoria)
// ============================================================================

export type TeamRole = "owner" | "admin" | "editor" | "viewer";

export interface TeamCapabilities {
  apiVersion: string;
  teamEnabled: boolean;
  crmEnabled: boolean;
  voiceLocalSupported: boolean;
  supportedRoles: TeamRole[];
  features: string[];
}

export interface TeamMember {
  memberId: string;
  email: string;
  displayName: string;
  role: TeamRole;
  status: "active" | "revoked";
  createdAt: string;
  lastActiveAt: string | null;
}

export interface TeamInvite {
  inviteId: string;
  email: string;
  role: Exclude<TeamRole, "owner">;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface AgentAccessGrant {
  grantId: string;
  memberId: string;
  targetKind: "agent" | "mcp";
  targetId: string;
  allowed: boolean;
  updatedAt: string;
}

export interface ServerAuditEntry {
  auditId: string;
  actorMemberId: string | null;
  actorLabel: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detailJson: string;
  createdAt: string;
}

export interface WorkflowPresenceMember {
  memberId: string;
  displayName: string;
  role: TeamRole;
  workflowId: string;
  selectedNodeId?: string | null;
  cursorX?: number | null;
  cursorY?: number | null;
  updatedAt: string;
}

// ============================================================================
// G-16: Migração / Transferência de Instância (`instance-transfer`)
// ============================================================================

export interface InstanceTransferScope {
  agents: boolean;
  memories: boolean;
  workflows: boolean;
  routines: boolean;
  library: boolean;
  preferences: boolean;
}

export interface InstanceTransferManifest {
  version: "1.0";
  jobId: string;
  sourceServerName: string;
  createdAt: string;
  scope: InstanceTransferScope;
  counts: {
    agents: number;
    memories: number;
    workflows: number;
    routines: number;
    libraryFiles: number;
    preferences: number;
  };
  secretsExcluded: true;
  totalBytes: number;
  totalChunks: number;
  payloadSha256: string;
}

export interface InstanceTransferJob {
  jobId: string;
  direction: "export" | "import";
  status: "pending" | "transferring" | "completed" | "failed" | "rolled_back";
  targetServerUrl?: string | null;
  totalChunks: number;
  completedChunks: number;
  payloadSha256: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// G-17: CRM Leve Opcional com Propostas Aprovadas (`crm_propose`)
// ============================================================================

export type CrmStage = "lead" | "qualificado" | "proposta" | "negociacao" | "ganho" | "perdido";

export interface CrmContact {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: CrmStage;
  tags: string[];
  ownerAgentId: string | null;
  sourceChannel: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivity {
  activityId: string;
  contactId: string;
  channel: string;
  summary: string;
  author: string;
  createdAt: string;
}

export interface CrmProposal {
  proposalId: string;
  agenteId: string;
  operation: "create_contact" | "update_contact" | "move_stage" | "add_activity";
  contactId: string | null;
  summary: string;
  diffJson: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

// ============================================================================
// G-20: Voz Local Isolada (`voice-host`)
// ============================================================================

export type VoiceExecutionMode = "cloud" | "local" | "auto";

export interface VoiceModelDescriptor {
  modelId: string;
  kind: "stt" | "tts";
  label: string;
  installed: boolean;
  sizeMb: number;
}

export interface VoiceHostStatusSnapshot {
  running: boolean;
  pid: number | null;
  mode: VoiceExecutionMode;
  activeSttModel: string;
  activeTtsVoice: string;
  models: VoiceModelDescriptor[];
  lastError: string | null;
}
