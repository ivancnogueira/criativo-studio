import { randomUUID } from "node:crypto";
import type {
  MarketplaceAgentPackage,
  MarketplaceAgentRoutineTemplate,
  MarketplaceAppItem,
  MarketplaceAuthKind,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthAccountView,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import type { WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { MetaValidationReport } from "../engine/tools/meta-insights.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import type { McpOAuthProvider } from "../mcp/mcp-oauth-provider.ts";
import type { McpServerStore } from "../mcp/mcp-server-store.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { getBrandIdentity } from "../server/brand-onboarding-service.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { NativeAppConnectionsStore } from "./native-app-connections-store.ts";
import type { CatalogBundleData, SkillsManager } from "./skills-manager.ts";

export class CatalogServiceError extends Error {
  public readonly code: string;

  constructor(message: string, code = "CATALOG_SERVICE_ERROR") {
    super(message);
    this.name = "CatalogServiceError";
    this.code = code;
  }
}

export interface CatalogServiceOptions {
  db: CriativoDatabase;
  vault: VaultService;
  mcpGateway?: McpGateway;
  mcpStore?: McpServerStore;
  nativeStore?: NativeAppConnectionsStore;
  oauthProvider?: McpOAuthProvider;
  skillsManager?: SkillsManager;
  providerConnection?: ProviderConnectionService;
  whatsappManager?: WhatsAppSessionManager;
  workspaceRoot?: string;
  bundlePath?: string;
  fetchImpl?: FetchLike;
}

export interface CatalogSnapshotQuery {
  query?: string;
  q?: string;
  tab?: MarketplaceTab;
  sourceFilter?: MarketplaceSourceFilter;
  fonte?: MarketplaceSourceFilter;
  category?: string;
}

export interface CatalogAppAccountInfo {
  server: McpServidorConfig;
  contaRotulo: string | null;
  oauthStatus: McpOAuthStatus;
  oauthAccounts: McpOAuthAccountView[];
}

export interface CatalogAppDetail {
  app: MarketplaceAppItem;
  accounts: CatalogAppAccountInfo[];
  nativeAccounts?: NativeAppAccountSummary[];
  agents: Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;
  nativeStatus?: {
    configuredKeys: string[];
    missingKeys: string[];
    whatsappAccountsCount?: number;
    whatsappConnectedCount?: number;
  };
}

export interface ConnectCatalogAppInput {
  flowId?: string;
  kind?: MarketplaceAuthKind;
  mcpId?: string;
  contaId?: string;
  contaRotulo?: string;
  fields?: Record<string, string>;
  url?: string;
  comando?: string;
  args?: string[];
  workingDirectory?: string | null;
  acesso?: McpAcessoAgentes;
  callbackBaseUrl?: string;
  useLoopbackListener?: boolean;
  clientIdOverride?: string;
  clientSecretOverride?: string;
  skipProbe?: boolean;
}

export interface ConnectCatalogAppResult {
  ok: boolean;
  kind: MarketplaceAuthKind;
  appSlug: string;
  native?: boolean;
  mcpId?: string;
  contaRotulo?: string;
  contaChave?: string;
  authorizeUrl?: string;
  state?: string;
  redirectUri?: string;
  savedKeys?: string[];
  instructions?: string[];
  server?: McpServidorConfig;
  probe?: McpProbeResultado;
  nativeAccount?: NativeAppAccountSummary;
  validationReport?: MetaValidationReport;
}

export interface InstallAgentOverrides {
  name?: string;
  model?: string;
  pasta?: string;
  customAgenteId?: string;
  activateRoutines?: boolean;
}

export interface InstalledAgentRecord {
  agente_id: string;
  nome: string;
  papel: string;
  modelo_padrao: string;
  status: string;
  skills_paths_json: string;
  ordem_exibicao: number;
  config_json: string;
  atualizado_em: string;
}

export interface InstalledAgentResult {
  agente: InstalledAgentRecord;
  installedSkills: MarketplaceSkillItem[];
  createdRoutines: Array<{
    rotina_id: string;
    titulo: string;
    expressao_cron: string;
    ativa: boolean;
  }>;
}

export interface ExportedAgentTemplate extends MarketplaceAgentPackage {
  schemaVersion: number;
  exportedAt: string;
  exportedFromAgentId: string;
}

export const NATIVE_VAULT_ALIAS_MAP: Record<string, Record<string, string[]>> = {
  instagram: {
    IG_ACCESS_TOKEN: ["instagram_access_token", "META_ACCESS_TOKEN", "IG_ACCESS_TOKEN"],
    IG_USER_ID: ["instagram_business_account_id", "META_IG_USER_ID", "IG_USER_ID"],
  },
  telegram: {
    TELEGRAM_BOT_TOKEN: ["telegram_bot_token", "TELEGRAM_BOT_TOKEN"],
  },
  "fish-audio": {
    FISH_AUDIO_API_KEY: ["fish_audio_api_key", "FISH_AUDIO_API_KEY"],
  },
  elevenlabs: {
    ELEVENLABS_API_KEY: ["elevenlabs_api_key", "ELEVENLABS_API_KEY"],
  },
};

export function sanitizeAgentIdBase(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || `agente_${randomUUID().slice(0, 6)}`;
}

export function sanitizeMcpIdSegment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseScheduleTime(time?: string): { hour: number; minute: number } {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time.trim())) {
    return { hour: 9, minute: 0 };
  }
  const [hStr, mStr] = time.trim().split(":");
  const hour = Math.max(0, Math.min(23, Number.parseInt(hStr, 10) || 0));
  const minute = Math.max(0, Math.min(59, Number.parseInt(mStr, 10) || 0));
  return { hour, minute };
}

export function convertRoutineScheduleToCron(
  schedule?: MarketplaceAgentRoutineTemplate["schedule"]
): string {
  if (!schedule || typeof schedule !== "object") {
    return "0 9 * * 1-5";
  }

  if (schedule.kind === "cron" && typeof schedule.cron === "string" && schedule.cron.trim()) {
    return schedule.cron.trim();
  }

  const { hour, minute } = parseScheduleTime(schedule.time);

  if (schedule.kind === "weekdays") {
    return `${minute} ${hour} * * 1-5`;
  }

  if (schedule.kind === "weekly") {
    const weekday =
      typeof schedule.weekday === "number" && Number.isInteger(schedule.weekday)
        ? Math.max(0, Math.min(7, schedule.weekday))
        : 1;
    return `${minute} ${hour} * * ${weekday}`;
  }

  if (schedule.kind === "monthly") {
    const day =
      typeof schedule.day === "number" && Number.isInteger(schedule.day)
        ? Math.max(1, Math.min(31, schedule.day))
        : 1;
    return `${minute} ${hour} ${day} * *`;
  }

  if (schedule.kind === "daily") {
    return `${minute} ${hour} * * *`;
  }

  return `${minute} ${hour} * * 1-5`;
}

export function uniqueSortedCategories(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );
}

export interface CatalogServiceDeps {
  db: CriativoDatabase;
  vault: VaultService;
  mcpGateway?: McpGateway;
  mcpStore: McpServerStore;
  nativeStore: NativeAppConnectionsStore;
  oauthProvider?: McpOAuthProvider;
  skillsManager: SkillsManager;
  providerConnection?: ProviderConnectionService;
  getWhatsappManager: () => WhatsAppSessionManager | undefined;
  workspaceRoot: string;
  bundlePath?: string;
  fetchImpl?: FetchLike;
  getBundle: () => CatalogBundleData;
  findAppBySlug: (slug: string) => MarketplaceAppItem | null;
  resolveConfiguredBrand: () => ReturnType<typeof getBrandIdentity> | null;
}
