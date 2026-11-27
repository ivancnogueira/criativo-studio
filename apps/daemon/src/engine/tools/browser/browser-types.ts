import type {
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserProxyProtocol,
  BrowserSnapshotResult,
  BrowserStatusReport,
  BrowserTabSummary,
  BrowserTakeoverReason,
  BrowserTakeoverSession,
  BrowserTargetSelector,
  PermissionLevel,
  UserBrowsingStep,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../../database/client.ts";
import type { WebSocketHub } from "../../../server/websocket-hub.ts";
import type { VaultService } from "../../../vault/vault-service.ts";
import {
  BrowserCdpSessionManager,
  type HumanCdpInputEvent,
  type ManagedTabEntry,
} from "../browser-cdp-session.ts";
import { UserBrowsingLogService } from "../user-browsing-log.ts";

export const SHARED_BROWSER_PROFILE_ID = "shared";
export const BROWSER_FILL_FIELDS_MAX_FIELDS = 16;
export const BROWSER_FILL_FIELDS_MAX_TEXT_BYTES = 16_384;

export interface BrowserProfile {
  perfil_id: string;
  nome: string;
  user_data_dir: string;
  proxy_url: string | null;
  ultimo_uso_em: string | null;
  cor_hex?: string;
  cdp_porta?: number | null;
  proxy_json?: string;
  criado_em?: string | null;
}

export interface BrowserNavigationParams {
  url: string;
  perfil_id?: string;
  extract_mode?: "text" | "links" | "screenshot_plan";
}

export interface BrowserNavigationResult {
  url: string;
  status: number;
  title: string;
  textPreview: string;
  perfil_id: string;
}

export type BrowserCdpActionName =
  | "open"
  | "list_tabs"
  | "status"
  | "navigate"
  | "go_back"
  | "go_forward"
  | "reload"
  | "click"
  | "type"
  | "fill_fields"
  | "press"
  | "hover"
  | "scroll"
  | "select_option"
  | "set_checked"
  | "drag"
  | "upload_files"
  | "wait_for"
  | "snapshot"
  | "screenshot"
  | "evaluate"
  | "handle_dialog"
  | "set_environment"
  | "close_tab"
  | "request_takeover"
  | "release_takeover"
  | "submit_secret";

export interface BrowserExecuteActionInput {
  action: BrowserCdpActionName;
  agenteId?: string | null;
  canalId?: string | null;
  perfilId?: string | null;
  permissionLevel?: PermissionLevel;
  tabId?: string;
  url?: string;
  target?: BrowserTargetSelector;
  toTarget?: BrowserTargetSelector;
  text?: string;
  clear?: boolean;
  pressEnter?: boolean;
  key?: string;
  fields?: Array<{ target: BrowserTargetSelector; value: string }>;
  deltaX?: number;
  deltaY?: number;
  values?: string[];
  checked?: boolean;
  paths?: string[];
  waitKind?: "text" | "selector" | "url" | "load";
  waitValue?: string;
  timeoutMs?: number;
  image?: boolean;
  expression?: string;
  accept?: boolean;
  promptText?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  colorScheme?: "dark" | "light";
  reason?: BrowserTakeoverReason;
  waitForTakeover?: boolean;
}

export interface ProxyRow {
  proxy_id: string;
  nome: string;
  servidor: string;
  usuario: string | null;
  senha_vault_chave: string | null;
  ativo: number;
  criado_em: string;
  atualizado_em: string;
}

export interface PendingTakeoverEntry {
  session: BrowserTakeoverSession;
  resolvers: Array<(res: { decision: "complete" | "cancel"; snapshot?: BrowserSnapshotResult }) => void>;
}

export function inferProxyProtocol(server: string): BrowserProxyProtocol {
  const lower = server.trim().toLowerCase();
  if (lower.startsWith("socks5://") || lower.startsWith("socks://")) return "socks5";
  if (lower.startsWith("https://")) return "https";
  return "http";
}

export function normalizeProxyServerUrl(server: string): string {
  const trimmed = server.trim();
  if (!trimmed) throw new Error("Informe o endereço 'servidor' do proxy (ex.: http://host:8080).");
  if (/^(https?|socks5):\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export interface BrowserAutomationRuntimeContext {
  db: CriativoDatabase;
  vault?: VaultService;
  getWsHub: () => WebSocketHub | undefined;
  workspaceRoot: string;
  sessionManager: BrowserCdpSessionManager;
  browsingLog: UserBrowsingLogService;
  activeTakeovers: Map<string, PendingTakeoverEntry>;
  ensureDefaultSharedProfile: () => BrowserProfileInfo;
  sanitizeProxyForClient: (rawJson?: string | null) => BrowserProfileProxyPayload;
  resolveProfileAndLaunchProxy: (
    requestedProfileId?: string | null,
    agenteId?: string | null
  ) => {
    profile: BrowserProfile;
    proxy: { server: string; username?: string; password?: string } | null;
  };
  getStatus: (agenteId?: string) => BrowserStatusReport;
  requireRealTab: (tabId?: string) => ManagedTabEntry;
  ensureRealTabLoaded: (tabId?: string) => Promise<ManagedTabEntry>;
  ensureTabPreviewStream: (tab: ManagedTabEntry) => void;
  broadcastTabsAndFrame: (tab?: ManagedTabEntry | null) => void;
  captureTabSnapshot: (tab: ManagedTabEntry, includeImage?: boolean) => Promise<BrowserSnapshotResult>;
  requestTakeover: (params: {
    tabId: string;
    agenteId: string | null;
    canalId?: string | null;
    reason: BrowserTakeoverReason;
    waitForResolution?: boolean;
    timeoutMs?: number;
  }) => Promise<
    | BrowserTakeoverSession
    | {
        decision: "complete" | "cancel" | "timeout";
        takeoverId: string;
        tabId: string;
        snapshot?: BrowserSnapshotResult;
        note?: string;
      }
  >;
  resolveTakeover: (
    tabId: string,
    decision: "complete" | "cancel"
  ) => Promise<{
    ok: boolean;
    takeoverId: string | null;
    tabId: string;
    decision: "complete" | "cancel";
    snapshot: BrowserSnapshotResult;
  }>;
  broadcastTeachStatus: (tab: ManagedTabEntry) => void;
  stopTeachRecording: (
    tabId: string,
    action?: "save" | "discard"
  ) => {
    ok: boolean;
    action: "save" | "discard";
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  };
}
