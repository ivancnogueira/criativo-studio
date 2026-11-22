/**
 * Contratos de licenciamento Ed25519, multi-servidor local/VPS e auto-update.
 */

export type LicensePlanTier = "individual" | "agencia_10" | "agencia_ilimitada";
export type LicenseUpgradeSlug = "bonus" | "video";
export type LicenseStatusCode =
  | "active"
  | "grace_offline"
  | "missing"
  | "revoked"
  | "expired"
  | "machine_limit"
  | "grace_exceeded"
  | "invalid_signature";

export interface LicenseLimitsConfig {
  plan_tier: LicensePlanTier;
  nome_exibicao: string;
  max_servers: number;
  max_local_servers: number;
  max_remote_servers: number;
  max_machines: number;
  permite_multimarca: boolean;
}

export interface LicensePayload {
  version: number;
  license_id: string;
  license_key: string;
  customer_email: string;
  customer_name?: string;
  plan_tier: LicensePlanTier;
  status: "active" | "suspended" | "revoked" | "expired";
  max_servers: number;
  max_machines: number;
  upgrades: LicenseUpgradeSlug[];
  machine_id: string;
  issued_at: string;
  last_verified_at: string;
  grace_until: string;
  expires_at: string | null;
}

export interface LicenseCertificate {
  payload: LicensePayload;
  signature: string;
  key_id: string;
}

export interface LicenseDeviceRecord {
  machine_id: string;
  hostname: string;
  os_platform: string;
  app_version?: string;
  first_activated_at: string;
  last_heartbeat_at: string;
  is_current_machine?: boolean;
}

export interface LicenseActivationStatus {
  valid: boolean;
  status_code: LicenseStatusCode;
  plan_tier: LicensePlanTier | null;
  plan_label: string;
  customer_email?: string;
  masked_key?: string;
  max_servers: number;
  servers_used: number;
  max_machines: number;
  machines_used: number;
  upgrades: LicenseUpgradeSlug[];
  unlocked_agents_count?: number;
  last_verified_at?: string;
  grace_until?: string;
  offline_days_remaining?: number;
  devices: LicenseDeviceRecord[];
  message?: string;
  hub_url: string;
}

export type ServerConnectionKind = "primary" | "local_child" | "remote_vps" | "joined";
export type ServerRuntimeStatus = "online" | "starting" | "offline" | "error";

export interface StudioServerRecord {
  server_id: string;
  nome: string;
  slug: string;
  kind: ServerConnectionKind;
  status: ServerRuntimeStatus;
  cor_hex: string;
  base_url: string;
  workspace_path?: string | null;
  port?: number | null;
  remote_ip?: string | null;
  version?: string | null;
  is_active: boolean;
  created_at: string;
  last_seen_at?: string | null;
  last_error?: string | null;
}

export interface ServerClaimTicket {
  claim_id: string;
  server_name: string;
  command_bash: string;
  command_agent_prompt: string;
  expires_at: string;
  ttl_seconds: number;
  status: "pending" | "redeemed" | "expired";
  paired_server?: StudioServerRecord | null;
}

export interface ServerInviteToken {
  server_id: string;
  invite_url: string;
  token_masked: string;
  expires_at: string;
}

export interface ServerQuotaSummary {
  allowed: boolean;
  servers_used: number;
  max_servers: number;
  local_used: number;
  max_local_servers: number;
  remote_used: number;
  max_remote_servers: number;
  reason?: string;
}

export type UpdateChannel = "stable" | "beta";
export type UpdatePhaseState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "applying"
  | "ready_to_restart"
  | "up_to_date"
  | "error"
  | "license_blocked";

export interface ReleaseArtifactInfo {
  platform: "win32" | "darwin" | "linux" | "vps-tarball";
  arch: "x64" | "arm64" | "universal";
  filename: string;
  sha256: string;
  size_bytes: number;
  download_path: string;
  external_url?: string;
  install_mode?: "hot_bundle" | "native_installer";
}

export interface UpdateBundlePayloadV2 {
  format: "criativo-update-bundle-v2";
  version: string;
  files: Array<{
    path: string;
    encoding: "utf8" | "base64";
    content: string;
  }>;
}

export interface ReleaseManifest {
  version: string;
  published_at: string;
  channel: UpdateChannel;
  changelog_markdown: string;
  min_compatible_version?: string;
  artifacts: ReleaseArtifactInfo[];
}

export interface UpdateStatusSnapshot {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  state: UpdatePhaseState;
  progress_percent: number;
  changelog_markdown?: string | null;
  requires_active_license: boolean;
  can_apply_in_app: boolean;
  is_desktop_packaged: boolean;
  install_mode?: "hot_bundle" | "native_installer" | null;
  staged_artifact_name?: string | null;
  server_id: string;
  server_kind: ServerConnectionKind;
  last_checked_at: string | null;
  error_message?: string | null;
}
