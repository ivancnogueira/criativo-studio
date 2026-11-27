import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  JanelaCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
} from "@criativo/contracts";
import {
  AntigravityAcpService,
  formatLabeledImageInstruction,
  type AcpDiscoveredModel,
  type LabeledImageInput,
} from "../antigravity-acp-service.ts";

export const CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal";
export const DAILY_CODE_ASSIST_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";
export const DESKTOP_VERSION = "2.24.0";
export const DESKTOP_BUILD = "963137146";
export const QUOTA_TIMEOUT_MS = 10_000;
export const GENERATE_TIMEOUT_MS = 60_000;
export const CACHE_TTL_MS = 45_000;
export const ACP_MODELS_CACHE_TTL_MS = 10 * 60_000;

export interface TokenFilePayload {
  token?: {
    access_token?: string;
    refresh_token?: string;
    expiry?: string;
  };
  id_token_email?: string;
  auth_method?: string;
}

export interface StudioAccountRecord {
  id: string;
  geminiDir: string;
  label: string | null;
  email: string | null;
}

export interface DiscoveredTokenEntry {
  id: string;
  label: string | null;
  geminiDir: string;
  tokenPath: string;
  email: string | null;
  accessToken: string | null;
  hasRefreshToken: boolean;
  expiryIso: string | null;
  tokenValid: boolean;
}


export interface CodeAssistQuotaBucket {
  bucketId?: string;
  displayName?: string;
  window?: string;
  duration?: string;
  modelId?: string;
  tokenType?: string;
  resetTime?: string;
  resetsAt?: string;
  remainingFraction?: number;
  remainingPercent?: number;
  usedFraction?: number;
  usedPercent?: number;
  remainingAmount?: string | number;
  disabled?: boolean;
  isExhausted?: boolean;
}

export interface CodeAssistQuotaGroup {
  displayName?: string;
  description?: string;
  buckets?: CodeAssistQuotaBucket[];
  quotaBuckets?: CodeAssistQuotaBucket[];
}

export interface CodeAssistRetrieveQuotaResponse {
  groups?: CodeAssistQuotaGroup[];
  quotaGroups?: CodeAssistQuotaGroup[];
  buckets?: CodeAssistQuotaBucket[];
  quotaBuckets?: CodeAssistQuotaBucket[];
  response?: {
    groups?: CodeAssistQuotaGroup[];
    quotaGroups?: CodeAssistQuotaGroup[];
    buckets?: CodeAssistQuotaBucket[];
    quotaBuckets?: CodeAssistQuotaBucket[];
  };
}

export interface FetchAvailableModelQuotaSlot {
  remainingFraction?: number;
  remainingPercent?: number;
  usedFraction?: number;
  usedPercent?: number;
  resetTime?: string;
  resetsAt?: string;
  isExhausted?: boolean;
  duration?: string;
  window?: string;
}

export interface FetchAvailableModelEntry {
  displayName?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  recommended?: boolean;
  thinkingLevel?: number;
  modelProvider?: string;
  quotaInfo?: FetchAvailableModelQuotaSlot;
  weeklyQuotaInfo?: FetchAvailableModelQuotaSlot;
}

export interface FetchAvailableModelsResponse {
  models?: Record<string, FetchAvailableModelEntry>;
  defaultAgentModelId?: string;
  agentModelSorts?: Array<{
    displayName?: string;
    groups?: Array<{
      displayName?: string;
      modelIds?: string[];
    }>;
  }>;
  commandModelIds?: string[];
  tabModelIds?: string[];
  imageGenerationModelIds?: string[];
  mqueryModelIds?: string[];
  webSearchModelIds?: string[];
  commitMessageModelIds?: string[];
  deprecatedModelIds?: Record<string, unknown>;
  audioTranscriptionModelIds?: string[];
  tieredModelIds?: {
    flashLite?: string;
    flash?: string;
    pro?: string;
  };
}

export interface AntigravityLiveSnapshot {
  contas: ContaProvedorInfo[];
  pool: PoolContasConfig | null;
  modelos: ModeloProvedorInfo[];
  defaultModelId: string | null;
  imageGenerationModelIds: string[];
  atualizado_em: string;
}

export interface CodeAssistGenerateInput {
  model: string;
  effort?: string;
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  imagePaths?: string[];
  labeledImages?: LabeledImageInput[];
  generateImage?: boolean;
  preferredAccountId?: string | null;
  agentId?: string | null;
  signal?: AbortSignal;
  mcpServers?: unknown[];
  onDelta?: (chunk: string) => void;
}

export interface CodeAssistGenerateOutput {
  text: string;
  images: Array<{ mimeType: string; dataBase64: string }>;
  modelUsed: string;
  accountId: string;
  accountEmail: string | null;
  fallbackReason?: string;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}


export function isInternalHiddenModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith("tab_") ||
    lower.startsWith("chat_") ||
    lower.includes("_tiered") ||
    lower.includes("-tiered") ||
    lower.includes("-sonar")
  );
}

export interface AcpModelsCacheState {
  accountId: string;
  expiresAt: number;
  models: AcpDiscoveredModel[];
  defaultModelId: string | null;
}

export interface SnapshotCacheEntry {
  expiresAt: number;
  data: AntigravityLiveSnapshot;
}

export interface AntigravitySnapshotRuntimeContext {
  appDataDir?: string;
  fetchImpl: typeof fetch;
  acpService: AntigravityAcpService;
  allowAutoAcpDiscovery: boolean;
  getAcpModelsCache: () => AcpModelsCacheState | null;
  setAcpModelsCache: (val: AcpModelsCacheState | null) => void;
  setSnapshotCache: (val: SnapshotCacheEntry | null) => void;
  discoverStudioTokenEntries: () => {
    entries: DiscoveredTokenEntry[];
    poolOverride?: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null } | null;
  };
  loadLastSnapshotCache: () => {
    contas?: ContaProvedorInfo[];
    modelos?: ModeloProvedorInfo[];
    defaultModelId?: string | null;
    imageGenerationModelIds?: string[];
  } | null;
  saveLastSnapshotCache: (data: {
    contas: ContaProvedorInfo[];
    modelos: ModeloProvedorInfo[];
    defaultModelId: string | null;
    imageGenerationModelIds: string[];
  }) => void;
  persistDiscoveredAcpModels: (geminiDir: string, models: AcpDiscoveredModel[], defaultModelId: string | null) => void;
  loadDiscoveredAcpModels: (geminiDir: string) => { models: AcpDiscoveredModel[]; defaultModelId: string | null } | null;
  deduplicateModels: (models: ModeloProvedorInfo[]) => ModeloProvedorInfo[];
}

export interface AntigravityGenerateRuntimeContext {
  workspaceCwd: string;
  fetchImpl: typeof fetch;
  acpService: AntigravityAcpService;
  getLiveSnapshot: (forceRefresh?: boolean) => Promise<AntigravityLiveSnapshot>;
  discoverStudioTokenEntries: () => { entries: DiscoveredTokenEntry[] };
  clearSnapshotCache: () => void;
}
