export interface TelemetrySampleEvent {
  eventId: string;
  eventName: string;
  appVersion: string;
  platform: string;
  errorCode?: string | null;
  durationMs?: number | null;
  meta: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface TelemetryStatusSnapshot {
  telemetryOptIn: boolean;
  bufferedCount: number;
  lastSample: TelemetrySampleEvent | null;
  collectedFields: string[];
  redactedPatterns: string[];
}

export type McpToolConsentDecision = "ask" | "allow_once" | "always_allow" | "deny";

export interface McpToolConsentRule {
  consentId: string;
  agenteId: string;
  mcpId: string;
  toolName: string;
  decision: McpToolConsentDecision;
  argPattern?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpApprovalAuditEntry {
  auditId: string;
  agenteId: string;
  mcpId: string;
  toolName: string;
  decision: McpToolConsentDecision;
  outcome: "allowed" | "blocked" | "prompted";
  reason: string;
  argsPreview: string;
  createdAt: string;
}

export interface ProcessConfinementMetadata {
  platform: string;
  envKeysCount: number;
  removedSecretKeysCount: number;
  confinedCwd: string;
  treeKillEnabled: boolean;
  rlimitApplied: boolean;
}
