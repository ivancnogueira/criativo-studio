import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  JanelaCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import {
  AntigravityAcpService,
  formatLabeledImageInstruction,
  type AcpDiscoveredModel,
  type LabeledImageInput,
} from "./antigravity-acp-service.ts";
export type { LabeledImageInput };
import {
  formatResetCountdownPtBr,
  refreshCachedQuotaGroupCountdowns,
} from "./provider-quota-utils.ts";
import { ensureProviderRuntimeInstalled } from "./provider-runtime-resolver.ts";

const CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal";
const DAILY_CODE_ASSIST_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";
const DESKTOP_VERSION = "2.24.0";
const DESKTOP_BUILD = "963137146";
const QUOTA_TIMEOUT_MS = 10_000;
const GENERATE_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 45_000;
const ACP_MODELS_CACHE_TTL_MS = 10 * 60_000;

interface TokenFilePayload {
  token?: {
    access_token?: string;
    refresh_token?: string;
    expiry?: string;
  };
  id_token_email?: string;
  auth_method?: string;
}

interface StudioAccountRecord {
  id: string;
  geminiDir: string;
  label: string | null;
  email: string | null;
}

interface DiscoveredTokenEntry {
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

function getAntigravityUserAgent(): string {
  const osName = process.platform === "win32" ? "windows" : process.platform;
  const archName = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/hub/${DESKTOP_VERSION} (aidev_client; os_type=${osName}; arch=${archName}; cl=${DESKTOP_BUILD})`;
}

function inferImageMimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function mapAcpEffortSuffix(rawId: string): NivelEsforco | null {
  const lower = rawId.toLowerCase();
  if (lower.endsWith("-low")) return "baixo";
  if (lower.endsWith("-medium")) return "medio";
  if (lower.endsWith("-high") || lower.endsWith("-xhigh")) return "alto";
  return null;
}

function cleanAcpDisplayName(rawName: string): string {
  return rawName
    .replace(/\s*\((?:Low|Medium|High|XHigh|Extra|Standard)\)\s*$/i, "")
    .replace(/\s+(?:Low|Medium|High|XHigh|Extra)\s*$/i, "")
    .trim();
}

function buildGroupedAcpModels(
  acpModels: AcpDiscoveredModel[],
  defaultAcpId: string | null,
  grupos: GrupoCotaConta[],
  httpModels: ModeloProvedorInfo[]
): ModeloProvedorInfo[] {
  const remainingByGroup = new Map<string, { pct: number | null; resetaEm: string | null }>();
  for (const g of grupos) {
    const pct = g.janela_5h?.restante_percentual ?? g.janela_semanal?.restante_percentual ?? null;
    const resetaEm = g.janela_5h?.reseta_em ?? g.janela_semanal?.reseta_em ?? null;
    remainingByGroup.set(g.nome, { pct, resetaEm });
  }

  const grouped = new Map<string, ModeloProvedorInfo>();
  for (const raw of acpModels) {
    const rawId = raw.modelId.trim();
    if (!rawId) continue;

    // Preserva identificadores sem família variável ("gpt-oss-120b-medium", "orchestrator")
    const isFixedVariant = rawId === "gpt-oss-120b-medium" || rawId.includes("orchestrator");
    const familyId = isFixedVariant
      ? rawId
      : rawId.replace(/-(low|medium|high|xhigh)$/i, "");
    const rotulo = isFixedVariant ? raw.name : cleanAcpDisplayName(raw.name || familyId);

    const lowerFamily = familyId.toLowerCase();
    const grupoCota = lowerFamily.includes("argon")
      ? "Gemini 4 Argon"
      : lowerFamily.startsWith("claude") || lowerFamily.startsWith("gpt")
        ? "Claude and GPT models"
        : "Gemini Models";
    const quotaInfo = remainingByGroup.get(grupoCota);
    const effort = mapAcpEffortSuffix(rawId);
    const isDefault =
      Boolean(raw.isDefault) ||
      Boolean(defaultAcpId && (defaultAcpId === rawId || defaultAcpId.startsWith(`${familyId}-`)));

    const existing = grouped.get(familyId);
    if (!existing) {
      grouped.set(familyId, {
        id: familyId,
        rotulo: rotulo || familyId,
        padrao: isDefault,
        suporta_imagem: lowerFamily.includes("gemini"),
        restante_percentual: quotaInfo?.pct ?? null,
        reseta_em: quotaInfo?.resetaEm ?? null,
        esforcos_suportados: effort ? [effort] : ["medio"],
        grupo_cota: grupoCota,
        descoberto_em_conta: true,
      });
    } else {
      existing.padrao = Boolean(existing.padrao || isDefault);
      if (effort && !existing.esforcos_suportados?.includes(effort)) {
        existing.esforcos_suportados = [...(existing.esforcos_suportados ?? []), effort];
      }
    }
  }

  // Preserva modelos dedicados de geração de imagem (ex.: Nano Banana) vindos do Code Assist HTTP
  for (const httpMod of httpModels) {
    const lowerId = httpMod.id.toLowerCase();
    if ((lowerId.includes("-image") || lowerId.includes("imagen")) && !grouped.has(httpMod.id)) {
      grouped.set(httpMod.id, httpMod);
    }
  }

  return [...grouped.values()];
}

function parseGroupModelsDescription(desc: string | undefined): string[] {
  if (!desc) return [];
  const match = /^Models within this group:\s*(.+?)\.?$/iu.exec(desc.trim());
  const raw = match?.[1] ?? "";
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export function extractRemainingPercentage(bucket: CodeAssistQuotaBucket): number | null {
  if (typeof bucket.remainingFraction === "number" && Number.isFinite(bucket.remainingFraction)) {
    const scaled = bucket.remainingFraction <= 1 ? bucket.remainingFraction * 100 : bucket.remainingFraction;
    return Math.max(0, Math.min(100, Math.round(scaled)));
  }
  if (typeof bucket.remainingPercent === "number" && Number.isFinite(bucket.remainingPercent)) {
    return Math.max(0, Math.min(100, Math.round(bucket.remainingPercent)));
  }
  if (typeof bucket.usedFraction === "number" && Number.isFinite(bucket.usedFraction)) {
    const scaled = bucket.usedFraction <= 1 ? bucket.usedFraction * 100 : bucket.usedFraction;
    return Math.max(0, Math.min(100, Math.round(100 - scaled)));
  }
  if (typeof bucket.usedPercent === "number" && Number.isFinite(bucket.usedPercent)) {
    return Math.max(0, Math.min(100, Math.round(100 - bucket.usedPercent)));
  }
  if (bucket.isExhausted === true) {
    return 0;
  }
  const resetStr = bucket.resetTime ?? bucket.resetsAt;
  if (
    resetStr !== undefined &&
    Number.isFinite(Date.parse(resetStr)) &&
    bucket.remainingAmount === undefined &&
    bucket.disabled !== true
  ) {
    return 0;
  }
  return null;
}

export function classifyQuotaWindowKind(
  descriptorRaw: string,
  resetIso: string | null,
  durationRaw?: string | null
): "5h" | "semanal" {
  const trimmedDuration = durationRaw?.trim().toLowerCase() ?? "";
  const exactProtoDuration = trimmedDuration.match(/^(\d+(?:\.\d+)?)s$/);
  if (exactProtoDuration) {
    const seconds = Number(exactProtoDuration[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds >= 18 * 3600 ? "semanal" : "5h";
    }
  }

  const descriptor = `${trimmedDuration} ${descriptorRaw}`.trim().toLowerCase();
  const largeProtoSeconds = descriptor.match(/\b(\d{4,}(?:\.\d+)?)s\b/);
  if (largeProtoSeconds) {
    const seconds = Number(largeProtoSeconds[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds >= 18 * 3600 ? "semanal" : "5h";
    }
  }

  if (/week|semanal|weekly|7\s*d|168\s*h|seven.?day|p7d|long/.test(descriptor)) {
    return "semanal";
  }
  if (/\b5\s*-?\s*h|five.?hour|pt5h|short|hourly|24\s*h|daily/.test(descriptor)) {
    return "5h";
  }
  if (resetIso) {
    const resetMs = Date.parse(resetIso);
    if (Number.isFinite(resetMs)) {
      const diffHours = (resetMs - Date.now()) / 3_600_000;
      if (diffHours > 18) {
        return "semanal";
      }
      if (diffHours >= 0) {
        return "5h";
      }
    }
  }
  return "5h";
}

export function normalizeWindowBucket(bucket: CodeAssistQuotaBucket): JanelaCotaConta | null {
  const remainingPct = extractRemainingPercentage(bucket);
  if (remainingPct === null) return null;
  const usedPct = 100 - remainingPct;
  const resetIso = bucket.resetTime ?? bucket.resetsAt ?? null;
  const janela = classifyQuotaWindowKind(
    `${bucket.window ?? ""} ${bucket.duration ?? ""} ${bucket.displayName ?? ""} ${bucket.bucketId ?? ""}`,
    resetIso,
    bucket.duration ?? null
  );
  const duracaoMinutos = janela === "semanal" ? 10_080 : 300;

  return {
    bucket_id: bucket.bucketId,
    rotulo: bucket.displayName?.trim() || (janela === "semanal" ? "Limite semanal" : "Limite de 5 horas"),
    janela,
    duracao_minutos: duracaoMinutos,
    restante_percentual: remainingPct,
    usado_percentual: usedPct,
    reseta_em: resetIso,
    reseta_em_texto: formatResetCountdownPtBr(resetIso),
  };
}

export function resolveQuotaGroupName(
  modelId: string,
  modelProvider?: string,
  displayName?: string
): "Gemini 4 Argon" | "Claude and GPT models" | "Gemini Models" {
  const lower = `${modelId} ${displayName ?? ""}`.toLowerCase();
  if (lower.includes("argon")) {
    return "Gemini 4 Argon";
  }
  if (
    modelProvider === "MODEL_PROVIDER_ANTHROPIC" ||
    modelProvider === "MODEL_PROVIDER_OPENAI" ||
    lower.includes("claude") ||
    lower.includes("gpt") ||
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    lower.includes("haiku")
  ) {
    return "Claude and GPT models";
  }
  return "Gemini Models";
}

export function extractQuotaGroupsFromResponse(
  res: CodeAssistRetrieveQuotaResponse | null | undefined
): CodeAssistQuotaGroup[] {
  if (!res) return [];
  const candidates = [res.groups, res.quotaGroups, res.response?.groups, res.response?.quotaGroups];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      return list;
    }
  }
  return [];
}

export function extractQuotaBucketsFromResponse(
  res: CodeAssistRetrieveQuotaResponse | null | undefined
): CodeAssistQuotaBucket[] {
  if (!res) return [];
  const out: CodeAssistQuotaBucket[] = [];
  for (const list of [res.buckets, res.quotaBuckets, res.response?.buckets, res.response?.quotaBuckets]) {
    if (Array.isArray(list) && list.length > 0) {
      out.push(...list);
    }
  }
  return out;
}

const QUOTA_GROUP_ORDER: Record<string, number> = {
  "gemini models": 0,
  "claude and gpt models": 1,
  "gemini 4 argon": 2,
};

export function mergeAndSortQuotaGroups(
  primary: GrupoCotaConta[],
  fallback: GrupoCotaConta[]
): GrupoCotaConta[] {
  const merged = new Map<string, { order: number; group: GrupoCotaConta }>();
  let seq = 0;

  const upsert = (src: GrupoCotaConta, preferIncoming: boolean) => {
    const key = src.nome.trim().toLowerCase();
    if (!key) return;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        order: seq++,
        group: {
          nome: src.nome.trim(),
          modelos: [...(src.modelos ?? [])],
          janela_5h: src.janela_5h ?? null,
          janela_semanal: src.janela_semanal ?? null,
        },
      });
      return;
    }
    const target = existing.group;
    target.janela_5h = preferIncoming ? (src.janela_5h ?? target.janela_5h) : (target.janela_5h ?? src.janela_5h);
    target.janela_semanal = preferIncoming
      ? (src.janela_semanal ?? target.janela_semanal)
      : (target.janela_semanal ?? src.janela_semanal);
    if (target.modelos.length === 0 && src.modelos.length > 0) {
      target.modelos = [...src.modelos];
    }
  };

  for (const g of primary) upsert(g, true);
  for (const g of fallback) upsert(g, false);

  return Array.from(merged.values())
    .filter(({ group }) => Boolean(group.janela_5h || group.janela_semanal))
    .sort((a, b) => {
      const rankA = QUOTA_GROUP_ORDER[a.group.nome.toLowerCase()] ?? 100;
      const rankB = QUOTA_GROUP_ORDER[b.group.nome.toLowerCase()] ?? 100;
      if (rankA !== rankB) return rankA - rankB;
      return a.order - b.order;
    })
    .map(({ group }) => group);
}

export function synthesizeQuotaGroupsFromModels(
  models: Record<string, FetchAvailableModelEntry> | undefined,
  rawBuckets?: CodeAssistQuotaBucket[]
): GrupoCotaConta[] {
  const grouped = new Map<
    string,
    { modelos: Set<string>; janela5h: JanelaCotaConta | null; janelaSemanal: JanelaCotaConta | null }
  >();

  const pushBucketForGroup = (groupName: string, modelLabel: string | null, win: JanelaCotaConta) => {
    let acc = grouped.get(groupName);
    if (!acc) {
      acc = { modelos: new Set<string>(), janela5h: null, janelaSemanal: null };
      grouped.set(groupName, acc);
    }
    if (modelLabel) acc.modelos.add(modelLabel);
    if (win.janela === "semanal") {
      if (!acc.janelaSemanal || win.restante_percentual < acc.janelaSemanal.restante_percentual) {
        acc.janelaSemanal = win;
      }
    } else if (!acc.janela5h || win.restante_percentual < acc.janela5h.restante_percentual) {
      acc.janela5h = win;
    }
  };

  for (const bucket of rawBuckets ?? []) {
    const modelId = bucket.modelId?.trim() || "";
    if (modelId && isInternalHiddenModelId(modelId)) continue;
    const win = normalizeWindowBucket(bucket);
    if (!win) continue;
    const groupName = resolveQuotaGroupName(modelId || bucket.displayName || "gemini", undefined, bucket.displayName);
    pushBucketForGroup(groupName, modelId || null, win);
  }

  for (const [mId, meta] of Object.entries(models ?? {})) {
    if (isInternalHiddenModelId(mId) || !meta) continue;
    const groupName = resolveQuotaGroupName(mId, meta.modelProvider, meta.displayName);
    const label = meta.displayName?.trim() || mId;

    const pushSlot = (slot: FetchAvailableModelQuotaSlot | undefined, forceWeekly = false) => {
      if (!slot) return;
      const win = normalizeWindowBucket({
        bucketId: mId,
        displayName: meta.displayName,
        window: forceWeekly ? (slot.window ?? "weekly") : slot.window,
        duration: forceWeekly ? (slot.duration ?? "604800s") : slot.duration,
        remainingFraction: slot.remainingFraction,
        remainingPercent: slot.remainingPercent,
        usedFraction: slot.usedFraction,
        usedPercent: slot.usedPercent,
        resetTime: slot.resetTime,
        resetsAt: slot.resetsAt,
        isExhausted: slot.isExhausted,
      });
      if (!win) return;
      if (forceWeekly && win.janela !== "semanal") {
        win.janela = "semanal";
        win.duracao_minutos = 10_080;
        win.rotulo = "Limite semanal";
      }
      pushBucketForGroup(groupName, label, win);
    };

    pushSlot(meta.quotaInfo, false);
    pushSlot(meta.weeklyQuotaInfo, true);
  }

  const out: GrupoCotaConta[] = [];
  for (const [nome, data] of grouped.entries()) {
    if (!data.janela5h && !data.janelaSemanal) continue;
    out.push({
      nome,
      modelos: Array.from(data.modelos).slice(0, 8),
      janela_5h: data.janela5h,
      janela_semanal: data.janelaSemanal,
    });
  }
  return mergeAndSortQuotaGroups([], out);
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const LEGACY_HTTP_MODEL_RE =
  /^(?:gemini-2\.5-|gemini-3-flash$|gemini-3\.1-flash-lite$|gemini-3\.5-flash-lite$)/i;

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

/**
 * Filtra os modelos retornados por `fetchAvailableModels`, removendo IDs internos, de autocompletar,
 * depreciados e gerações antigas quando modelos atuais estão presentes ou há ordenação `agentModelSorts`.
 */
export function filterHttpAvailableModels(
  modelsRes: FetchAvailableModelsResponse | null | undefined
): Array<[string, FetchAvailableModelEntry]> {
  const rawModels = modelsRes?.models;
  if (!rawModels) return [];

  const blocked = new Set<string>([
    ...Object.keys(modelsRes.deprecatedModelIds ?? {}),
    ...(modelsRes.commandModelIds ?? []),
    ...(modelsRes.tabModelIds ?? []),
    ...(modelsRes.mqueryModelIds ?? []),
    ...(modelsRes.webSearchModelIds ?? []),
    ...(modelsRes.commitMessageModelIds ?? []),
    ...(modelsRes.audioTranscriptionModelIds ?? []),
    ...(modelsRes.tieredModelIds?.flashLite ? [modelsRes.tieredModelIds.flashLite] : []),
    ...(modelsRes.tieredModelIds?.flash ? [modelsRes.tieredModelIds.flash] : []),
    ...(modelsRes.tieredModelIds?.pro ? [modelsRes.tieredModelIds.pro] : []),
  ]);

  const sortedIds: string[] = [];
  for (const sort of modelsRes.agentModelSorts ?? []) {
    for (const grp of sort.groups ?? []) {
      for (const mId of grp.modelIds ?? []) {
        if (mId && !sortedIds.includes(mId)) {
          sortedIds.push(mId);
        }
      }
    }
  }
  const sortedSet = new Set(sortedIds);

  let entries: Array<[string, FetchAvailableModelEntry]>;
  if (sortedIds.length > 0) {
    const orderedIds = Array.from(
      new Set([...sortedIds, ...(modelsRes.imageGenerationModelIds ?? [])])
    );
    entries = [];
    for (const id of orderedIds) {
      const meta = rawModels[id];
      if (!meta || blocked.has(id) || isInternalHiddenModelId(id)) continue;
      entries.push([id, meta]);
    }
  } else {
    entries = Object.entries(rawModels).filter(
      ([id]) => !blocked.has(id) && !isInternalHiddenModelId(id)
    );
  }

  const imageIds = new Set(modelsRes.imageGenerationModelIds ?? []);
  const hasCurrentGen = entries.some(([id]) => {
    const lower = id.toLowerCase();
    return (
      (lower.startsWith("gemini-3.8-") || lower.startsWith("gemini-4-")) &&
      !lower.includes("-image") &&
      !lower.includes("imagen")
    );
  });

  if (hasCurrentGen) {
    entries = entries.filter(([id]) => {
      const lower = id.toLowerCase();
      const isImage =
        imageIds.has(id) || lower.includes("-image") || lower.includes("imagen");
      if (isImage) return true;
      if (sortedSet.has(id)) return true;
      return !LEGACY_HTTP_MODEL_RE.test(id);
    });
  }

  return entries;
}

function normalizeModelFamilyAndEffort(
  rawId: string,
  meta: FetchAvailableModelEntry,
  imageGenIds: Set<string>,
  defaultId: string | null
): ModeloProvedorInfo | null {
  if (isInternalHiddenModelId(rawId)) return null;

  const rawBaseName = meta.displayName?.trim() || rawId;
  const isFixedVariant = rawId === "gpt-oss-120b-medium" || rawId.includes("orchestrator");
  const baseName = isFixedVariant ? rawBaseName : cleanAcpDisplayName(rawBaseName) || rawBaseName;
  const remainingPct = meta.quotaInfo ? extractRemainingPercentage(meta.quotaInfo) : null;

  const isImage =
    imageGenIds.has(rawId) || rawId.toLowerCase().includes("-image") || rawId.toLowerCase().includes("imagen");

  let grupoCota: string | null = null;
  if (
    meta.modelProvider === "MODEL_PROVIDER_ANTHROPIC" ||
    meta.modelProvider === "MODEL_PROVIDER_OPENAI" ||
    meta.modelProvider === "MODEL_PROVIDER_GOOGLE" ||
    `${rawId} ${baseName}`.toLowerCase().includes("argon")
  ) {
    grupoCota = resolveQuotaGroupName(rawId, meta.modelProvider, meta.displayName);
  }

  let esforcos: NivelEsforco[] = ["medio"];
  if (meta.supportsThinking) {
    esforcos = ["baixo", "medio", "alto"];
  }

  return {
    id: rawId,
    rotulo: baseName,
    padrao: defaultId === rawId || Boolean(meta.recommended && rawId.includes("flash-high")),
    suporta_imagem: isImage || Boolean(meta.supportsImages),
    restante_percentual: remainingPct,
    reseta_em: meta.quotaInfo?.resetTime ?? null,
    esforcos_suportados: esforcos,
    grupo_cota: grupoCota,
    descoberto_em_conta: true,
  };
}

/**
 * Gerencia exclusivamente as conexões Google/Antigravity reais criadas pelo usuário
 * dentro do Criativo AI Studio (em `dados/contas/gemini/<id>`), com login oficial
 * no navegador via protocolo ACP, renovação silenciosa de token e consulta de cotas/modelos.
 */
export class AntigravityLiveService {
  private readonly db?: CriativoDatabase;
  private readonly accountsRootDir: string;
  private readonly workspaceCwd: string;
  private readonly appDataDir?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly acpService: AntigravityAcpService;
  private readonly allowAutoAcpDiscovery: boolean;
  private mcpGateway?: McpGateway;
  private extraMcpServersResolver?: (agentId?: string | null) => unknown[];
  private snapshotCache: { expiresAt: number; data: AntigravityLiveSnapshot } | null = null;
  private inFlightSnapshot: Promise<AntigravityLiveSnapshot> | null = null;
  private acpModelsCache: {
    accountId: string;
    expiresAt: number;
    models: AcpDiscoveredModel[];
    defaultModelId: string | null;
  } | null = null;

  constructor(options?: {
    db?: CriativoDatabase;
    accountsRootDir?: string;
    appDataDir?: string;
    workspaceCwd?: string;
    fetchImpl?: typeof fetch;
    acpService?: AntigravityAcpService;
    mcpGateway?: McpGateway;
  }) {
    this.db = options?.db;
    this.appDataDir = options?.appDataDir;
    this.workspaceCwd = resolve(options?.workspaceCwd ?? process.cwd());
    this.accountsRootDir = resolve(
      options?.accountsRootDir ?? join(this.workspaceCwd, "dados", "contas", "gemini")
    );
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.allowAutoAcpDiscovery = Boolean(options?.acpService || !options?.fetchImpl);
    this.mcpGateway = options?.mcpGateway;
    this.acpService =
      options?.acpService ??
      new AntigravityAcpService({
        appDataDir: options?.appDataDir,
        mcpServersResolver: (agentId) => this.resolveCombinedMcpServers(agentId),
      });
    if (options?.mcpGateway && options?.acpService) {
      this.acpService.setMcpServersResolver(
        (agentId) => this.resolveCombinedMcpServers(agentId)
      );
    }
  }

  private persistDiscoveredAcpModels(
    geminiDir: string,
    models: AcpDiscoveredModel[],
    defaultModelId: string | null
  ): void {
    try {
      if (!models || models.length === 0) return;
      const acpDir = join(resolve(geminiDir), "antigravity-acp");
      mkdirSync(acpDir, { recursive: true });
      writeFileSync(
        join(acpDir, "acp-discovered-models.json"),
        JSON.stringify(
          {
            models,
            defaultModelId,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {
      // ignora erro ao gravar cache em disco
    }
  }

  private loadDiscoveredAcpModels(
    geminiDir: string
  ): { models: AcpDiscoveredModel[]; defaultModelId: string | null } | null {
    const filePath = join(resolve(geminiDir), "antigravity-acp", "acp-discovered-models.json");
    const parsed = safeReadJson<{
      models?: AcpDiscoveredModel[];
      defaultModelId?: string | null;
    }>(filePath);
    if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) {
      return null;
    }
    return {
      models: parsed.models,
      defaultModelId: parsed.defaultModelId ?? null,
    };
  }

  private resolveCombinedMcpServers(agentId?: string | null): unknown[] {
    const extra = this.extraMcpServersResolver?.(agentId) ?? [];
    const ext = this.mcpGateway?.getAcpMcpServers(agentId) ?? [];
    return [...extra, ...ext];
  }

  public setMcpGateway(gateway: McpGateway): void {
    this.mcpGateway = gateway;
    this.acpService.setMcpServersResolver(
      (agentId) => this.resolveCombinedMcpServers(agentId)
    );
  }

  public setExtraMcpServersResolver(resolver: (agentId?: string | null) => unknown[]): void {
    this.extraMcpServersResolver = resolver;
    this.acpService.setMcpServersResolver(
      (agentId) => this.resolveCombinedMcpServers(agentId)
    );
  }

  public getCliExecutable(): string | null {
    return this.acpService.getCliExecutable();
  }

  private getStudioRecords(): {
    accounts: StudioAccountRecord[];
    poolOverride?: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null };
  } {
    if (!this.db) return { accounts: [] };
    try {
      const rowAcc = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_contas_studio';`)
        .get() as { valor_json: string } | undefined;
      const rowPool = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_pool';`)
        .get() as { valor_json: string } | undefined;

      const parsedAcc = rowAcc ? (JSON.parse(rowAcc.valor_json) as StudioAccountRecord[]) : [];
      const parsedPool = rowPool
        ? (JSON.parse(rowPool.valor_json) as {
            habilitado?: boolean;
            contas_excluidas?: string[];
            conta_em_uso?: string | null;
          })
        : undefined;

      return { accounts: Array.isArray(parsedAcc) ? parsedAcc : [], poolOverride: parsedPool };
    } catch {
      return { accounts: [] };
    }
  }

  private saveStudioRecords(accounts: StudioAccountRecord[]): void {
    if (!this.db) return;
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('antigravity_contas_studio', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(accounts), new Date().toISOString());
    this.snapshotCache = null;
    this.acpModelsCache = null;
  }

  private saveLastSnapshotCache(data: {
    contas: ContaProvedorInfo[];
    modelos: ModeloProvedorInfo[];
    defaultModelId: string | null;
    imageGenerationModelIds: string[];
  }): void {
    if (!this.db) return;
    try {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
           VALUES ('antigravity_last_snapshot', ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
        )
        .run(JSON.stringify(data), new Date().toISOString());
    } catch {
      // ignora erro ao gravar cache local
    }
  }

  private loadLastSnapshotCache(): {
    contas?: ContaProvedorInfo[];
    modelos?: ModeloProvedorInfo[];
    defaultModelId?: string | null;
    imageGenerationModelIds?: string[];
  } | null {
    if (!this.db) return null;
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_last_snapshot';`)
        .get() as { valor_json: string } | undefined;
      return row
        ? (JSON.parse(row.valor_json) as {
            contas?: ContaProvedorInfo[];
            modelos?: ModeloProvedorInfo[];
            defaultModelId?: string | null;
            imageGenerationModelIds?: string[];
          })
        : null;
    } catch {
      return null;
    }
  }

  private deduplicateModels(models: ModeloProvedorInfo[]): ModeloProvedorInfo[] {
    const byLabel = new Map<string, ModeloProvedorInfo>();
    for (const m of models) {
      const key = `${m.rotulo.trim().toLowerCase()}::${m.grupo_cota ?? ""}`;
      const existing = byLabel.get(key);
      if (!existing) {
        byLabel.set(key, { ...m });
        continue;
      }
      const existingScore =
        (existing.padrao ? 4 : 0) +
        (existing.id.includes("-high") ? 2 : existing.id.includes("-medium") ? 1 : 0);
      const nextScore =
        (m.padrao ? 4 : 0) + (m.id.includes("-high") ? 2 : m.id.includes("-medium") ? 1 : 0);
      const mergedEfforts = Array.from(
        new Set([...(existing.esforcos_suportados ?? []), ...(m.esforcos_suportados ?? []), "baixo", "medio", "alto"])
      ) as NivelEsforco[];

      if (nextScore > existingScore) {
        byLabel.set(key, {
          ...m,
          padrao: Boolean(existing.padrao || m.padrao),
          suporta_imagem: Boolean(existing.suporta_imagem || m.suporta_imagem),
          esforcos_suportados: mergedEfforts,
        });
      } else {
        existing.padrao = Boolean(existing.padrao || m.padrao);
        existing.suporta_imagem = Boolean(existing.suporta_imagem || m.suporta_imagem);
        existing.esforcos_suportados = mergedEfforts;
        if (
          typeof m.restante_percentual === "number" &&
          (existing.restante_percentual === null ||
            existing.restante_percentual === undefined ||
            m.restante_percentual > existing.restante_percentual)
        ) {
          existing.restante_percentual = m.restante_percentual;
        }
      }
    }
    return [...byLabel.values()].sort((a, b) => {
      if (a.padrao && !b.padrao) return -1;
      if (!a.padrao && b.padrao) return 1;
      return a.rotulo.localeCompare(b.rotulo, "pt-BR");
    });
  }

  private discoverStudioTokenEntries(): {
    entries: DiscoveredTokenEntry[];
    poolOverride?: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null };
  } {
    const { accounts, poolOverride } = this.getStudioRecords();
    const entries: DiscoveredTokenEntry[] = [];
    const seenEmails = new Set<string>();

    for (const acc of accounts) {
      if (!acc.geminiDir) continue;
      const absDir = resolve(acc.geminiDir);
      const tokenPath = join(absDir, "antigravity-acp", "antigravity-oauth-token");
      if (!existsSync(tokenPath)) continue;

      const payload = safeReadJson<TokenFilePayload>(tokenPath);
      const email = payload?.id_token_email?.trim() || acc.email || null;
      if (email) {
        const lowerEmail = email.toLowerCase();
        if (seenEmails.has(lowerEmail)) continue;
        seenEmails.add(lowerEmail);
      }

      const accessToken = payload?.token?.access_token?.trim() || null;
      const expiryIso = payload?.token?.expiry ?? null;
      const expiryMs = expiryIso ? Date.parse(expiryIso) : Number.NaN;
      const tokenValid = Boolean(accessToken && (!expiryIso || expiryMs > Date.now() + 60_000));

      entries.push({
        id: acc.id,
        label: acc.label ?? null,
        geminiDir: absDir,
        tokenPath,
        email,
        accessToken,
        hasRefreshToken: Boolean(payload?.token?.refresh_token?.trim()),
        expiryIso,
        tokenValid,
      });
    }

    return { entries, poolOverride };
  }

  private async callCodeAssist<T>(
    endpoint: string,
    method: string,
    accessToken: string,
    body: unknown,
    timeoutMs = QUOTA_TIMEOUT_MS
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${endpoint}:${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": getAntigravityUserAgent(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Code Assist (${method}) respondeu HTTP ${response.status}: ${errText.slice(0, 180)}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async getLiveSnapshot(forceRefresh = false): Promise<AntigravityLiveSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.snapshotCache && this.snapshotCache.expiresAt > now) {
      return this.snapshotCache.data;
    }
    if (!forceRefresh && this.inFlightSnapshot) {
      return await this.inFlightSnapshot;
    }

    const promise = this.computeLiveSnapshot(forceRefresh).finally(() => {
      if (this.inFlightSnapshot === promise) {
        this.inFlightSnapshot = null;
      }
    });
    this.inFlightSnapshot = promise;
    return await promise;
  }

  private async computeLiveSnapshot(forceRefresh = false): Promise<AntigravityLiveSnapshot> {
    const now = Date.now();
    const SHORT_MISSING_QUOTA_TTL_MS = 5_000;

    const { entries, poolOverride } = this.discoverStudioTokenEntries();
    if (entries.length === 0) {
      const emptySnap: AntigravityLiveSnapshot = {
        contas: [],
        pool: null,
        modelos: [],
        defaultModelId: null,
        imageGenerationModelIds: [],
        atualizado_em: new Date().toISOString(),
      };
      this.snapshotCache = { expiresAt: now + CACHE_TTL_MS, data: emptySnap };
      return emptySnap;
    }

    let cliExe = this.acpService.getCliExecutable();
    if (
      !cliExe &&
      this.allowAutoAcpDiscovery &&
      process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1"
    ) {
      if (forceRefresh) {
        const installed = await ensureProviderRuntimeInstalled("antigravity", {
          appDataDir: this.appDataDir,
        }).catch(() => null);
        if (installed?.executable) {
          cliExe = installed.executable;
        }
      } else {
        void ensureProviderRuntimeInstalled("antigravity", {
          appDataDir: this.appDataDir,
        }).catch(() => {});
      }
    }
    const cachedPrev = this.loadLastSnapshotCache();

    const contas: ContaProvedorInfo[] = [];
    const modelMap = new Map<string, ModeloProvedorInfo>();
    let defaultModelId: string | null = cachedPrev?.defaultModelId ?? null;
    const imageGenerationModelIds = new Set<string>(cachedPrev?.imageGenerationModelIds ?? []);
    let anyFreshLiveSuccess = false;

    await Promise.all(
      entries.map(async (entry) => {
        const cachedAccount = cachedPrev?.contas?.find(
          (c) => c.id === entry.id || (entry.email && c.email === entry.email)
        );
        const grupos: GrupoCotaConta[] = [];
        let modelosConta: string[] = [];
        let activeAccessToken = entry.accessToken;
        let tokenValidNow = entry.tokenValid;
        let expiryIsoNow = entry.expiryIso;

        // Se o token JWT em disco venceu e o motor ACP está disponível, renova silenciosamente em qualquer leitura
        if (!tokenValidNow && entry.hasRefreshToken && cliExe) {
          try {
            const refreshed = await this.acpService.refreshAccountToken(entry.id, entry.geminiDir);
            if (refreshed?.accessToken) {
              activeAccessToken = refreshed.accessToken;
              expiryIsoNow = refreshed.expiryIso;
              tokenValidNow = true;
            }
          } catch {
            // fallback para cache ou estado autenticado via ACP
          }
        }

        let estado: ContaProvedorInfo["estado"] =
          tokenValidNow || (entry.hasRefreshToken && Boolean(cliExe)) ? "conectado" : "desconectado";
        let plano: string | null = cachedAccount?.plano ?? null;

        const fetchLiveQuotaAndModels = async (tokenToUse: string) => {
          const loadBody = {
            metadata: {
              ideType: "ANTIGRAVITY",
              platform:
                process.platform === "win32"
                  ? "WINDOWS"
                  : process.platform === "darwin"
                    ? "MACOS"
                    : "LINUX",
              pluginType: "GEMINI",
            },
          };

          let codeAssistInfo = await this.callCodeAssist<{
            cloudaicompanionProject?: string;
            currentTier?: { name?: string };
          }>(CODE_ASSIST_URL, "loadCodeAssist", tokenToUse, loadBody).catch(() => null);

          if (!codeAssistInfo?.cloudaicompanionProject) {
            const dailyLoad = await this.callCodeAssist<{
              cloudaicompanionProject?: string;
              currentTier?: { name?: string };
            }>(DAILY_CODE_ASSIST_URL, "loadCodeAssist", tokenToUse, loadBody).catch(() => null);
            if (dailyLoad?.cloudaicompanionProject || !codeAssistInfo) {
              codeAssistInfo = dailyLoad;
            }
          }

          if (!codeAssistInfo) {
            codeAssistInfo = await this.callCodeAssist<{
              cloudaicompanionProject?: string;
              currentTier?: { name?: string };
            }>(CODE_ASSIST_URL, "loadCodeAssist", tokenToUse, {});
          }

          if (codeAssistInfo.currentTier?.name) {
            plano = codeAssistInfo.currentTier.name;
          }

          const project = codeAssistInfo.cloudaicompanionProject;
          const queryPayload = project ? { project } : {};

          const [dailyQuotaRes, dailyModelsRes] = await Promise.all([
            this.callCodeAssist<CodeAssistRetrieveQuotaResponse>(
              DAILY_CODE_ASSIST_URL,
              "retrieveUserQuotaSummary",
              tokenToUse,
              queryPayload
            ).catch(() => null),
            this.callCodeAssist<FetchAvailableModelsResponse>(
              DAILY_CODE_ASSIST_URL,
              "fetchAvailableModels",
              tokenToUse,
              queryPayload
            ).catch(() => null),
          ]);

          let quotaRes = dailyQuotaRes;
          if (extractQuotaGroupsFromResponse(quotaRes).length === 0) {
            const prodQuotaRes = await this.callCodeAssist<CodeAssistRetrieveQuotaResponse>(
              CODE_ASSIST_URL,
              "retrieveUserQuotaSummary",
              tokenToUse,
              queryPayload
            ).catch(() => null);
            if (
              extractQuotaGroupsFromResponse(prodQuotaRes).length > 0 ||
              extractQuotaBucketsFromResponse(prodQuotaRes).length > 0
            ) {
              quotaRes = prodQuotaRes;
            }
          }

          let modelsRes = dailyModelsRes;
          if (!modelsRes?.models || Object.keys(modelsRes.models).length === 0) {
            const prodModelsRes = await this.callCodeAssist<FetchAvailableModelsResponse>(
              CODE_ASSIST_URL,
              "fetchAvailableModels",
              tokenToUse,
              queryPayload
            ).catch(() => null);
            if (prodModelsRes?.models && Object.keys(prodModelsRes.models).length > 0) {
              modelsRes = prodModelsRes;
            }
          }

          if (project || quotaRes || modelsRes) {
            anyFreshLiveSuccess = true;
          }

          for (const rawGroup of extractQuotaGroupsFromResponse(quotaRes)) {
            const nome = rawGroup.displayName?.trim();
            if (!nome) continue;
            let janela5h: JanelaCotaConta | null = null;
            let janelaSemanal: JanelaCotaConta | null = null;
            for (const b of rawGroup.quotaBuckets ?? rawGroup.buckets ?? []) {
              const win = normalizeWindowBucket(b);
              if (!win) continue;
              if (win.janela === "5h") {
                if (!janela5h || win.restante_percentual < janela5h.restante_percentual) janela5h = win;
              } else if (win.janela === "semanal") {
                if (!janelaSemanal || win.restante_percentual < janelaSemanal.restante_percentual) janelaSemanal = win;
              } else if (!janela5h) {
                janela5h = win;
              } else if (!janelaSemanal) {
                janelaSemanal = win;
              }
            }
            if (janela5h || janelaSemanal) {
              grupos.push({
                nome,
                modelos: parseGroupModelsDescription(rawGroup.description),
                janela_5h: janela5h,
                janela_semanal: janelaSemanal,
              });
            }
          }

          const rawBuckets = extractQuotaBucketsFromResponse(quotaRes);
          const needsFlatBuckets =
            grupos.length === 0 ||
            rawBuckets.length === 0 ||
            grupos.some((g) => !g.janela_semanal) ||
            !grupos.some((g) => g.nome.toLowerCase().includes("argon"));
          if (needsFlatBuckets && project) {
            const flatQuota =
              (await this.callCodeAssist<CodeAssistRetrieveQuotaResponse>(
                CODE_ASSIST_URL,
                "retrieveUserQuota",
                tokenToUse,
                queryPayload
              ).catch(() => null)) ??
              (await this.callCodeAssist<CodeAssistRetrieveQuotaResponse>(
                DAILY_CODE_ASSIST_URL,
                "retrieveUserQuota",
                tokenToUse,
                queryPayload
              ).catch(() => null));
            const flatBuckets = extractQuotaBucketsFromResponse(flatQuota);
            if (flatBuckets.length > 0) {
              rawBuckets.push(...flatBuckets);
              anyFreshLiveSuccess = true;
            }
          }

          const synthesized = synthesizeQuotaGroupsFromModels(modelsRes?.models, rawBuckets);
          const mergedGroups = mergeAndSortQuotaGroups(grupos, synthesized);
          grupos.length = 0;
          grupos.push(...mergedGroups);

          if (modelsRes?.models) {
            if (modelsRes.defaultAgentModelId) {
              defaultModelId = modelsRes.defaultAgentModelId;
            }
            for (const imgId of modelsRes.imageGenerationModelIds ?? []) {
              imageGenerationModelIds.add(imgId);
            }
            for (const [mId, mMeta] of filterHttpAvailableModels(modelsRes)) {
              const normalized = normalizeModelFamilyAndEffort(
                mId,
                mMeta,
                imageGenerationModelIds,
                defaultModelId
              );
              if (!normalized) continue;
              modelosConta.push(normalized.id);
              const existing = modelMap.get(normalized.id);
              if (
                !existing ||
                (normalized.restante_percentual ?? 0) > (existing.restante_percentual ?? -1)
              ) {
                modelMap.set(normalized.id, normalized);
              }
            }
          }
        };

        if (activeAccessToken && (tokenValidNow || entry.hasRefreshToken || !cliExe)) {
          try {
            await fetchLiveQuotaAndModels(activeAccessToken);
            if (anyFreshLiveSuccess) {
              tokenValidNow = true;
              estado = "conectado";
            }
          } catch (liveErr) {
            const msg = liveErr instanceof Error ? liveErr.message : String(liveErr);
            if (/\b401\b|\b403\b/i.test(msg) && entry.hasRefreshToken && cliExe) {
              try {
                const refreshed = await this.acpService.refreshAccountToken(entry.id, entry.geminiDir);
                if (refreshed?.accessToken) {
                  activeAccessToken = refreshed.accessToken;
                  expiryIsoNow = refreshed.expiryIso;
                  tokenValidNow = true;
                  estado = "conectado";
                  await fetchLiveQuotaAndModels(activeAccessToken);
                }
              } catch {
                // preserva último snapshot da conta caso renovação ou consulta falhe
              }
            }
          }
        }

        if (grupos.length === 0 && cachedAccount?.grupos_cota?.length) {
          grupos.push(...refreshCachedQuotaGroupCountdowns(cachedAccount.grupos_cota));
        }
        if (modelosConta.length === 0 && cachedAccount?.modelos_disponiveis?.length) {
          modelosConta = cachedAccount.modelos_disponiveis;
        }

        contas.push({
          id: entry.id,
          provedor: "gemini",
          rotulo: entry.label,
          email: entry.email,
          plano: plano ?? "Google AI",
          estado,
          padrao: contas.length === 0,
          token_valido: tokenValidNow,
          token_expira_em: expiryIsoNow,
          grupos_cota: grupos,
          modelos_disponiveis: modelosConta,
          origem: "criativo",
        });
      })
    );

    // Garante que somente a primeira conta conectada tenha flag padrao: true
    contas.forEach((c, idx) => {
      c.padrao = idx === 0;
    });

    const excluidas = poolOverride?.contas_excluidas ?? [];
    const habilitado =
      poolOverride?.habilitado !== undefined ? poolOverride.habilitado : contas.length > 1;

    const contaElegivel =
      contas.find((c) => poolOverride?.conta_em_uso && c.id === poolOverride.conta_em_uso && c.estado === "conectado") ??
      contas
        .filter((c) => c.estado === "conectado" && !excluidas.includes(c.id))
        .sort((a, b) => {
          const minA = Math.min(
            ...a.grupos_cota.flatMap((g) => [g.janela_5h?.restante_percentual ?? 100, g.janela_semanal?.restante_percentual ?? 100])
          );
          const minB = Math.min(
            ...b.grupos_cota.flatMap((g) => [g.janela_5h?.restante_percentual ?? 100, g.janela_semanal?.restante_percentual ?? 100])
          );
          return minB - minA;
        })[0] ??
      contas[0] ??
      null;

    const pool: PoolContasConfig | null =
      contas.length > 0
        ? {
            habilitado,
            contas_excluidas: excluidas,
            conta_em_uso: contaElegivel?.id ?? null,
          }
        : null;

    const eligibleEntry = entries.find(
      (e) => e.id === (contaElegivel?.id ?? "") && e.hasRefreshToken
    );
    const acpTargetEntry = eligibleEntry ?? entries.find((e) => e.hasRefreshToken) ?? null;

    if (this.allowAutoAcpDiscovery && cliExe && acpTargetEntry) {
      const cacheValid =
        !forceRefresh &&
        this.acpModelsCache &&
        this.acpModelsCache.accountId === acpTargetEntry.id &&
        this.acpModelsCache.expiresAt > now &&
        this.acpModelsCache.models.length > 0;

      if (!cacheValid) {
        const acpResult = await this.acpService
          .listAvailableModels(acpTargetEntry.id, acpTargetEntry.geminiDir)
          .catch(() => null);
        if (acpResult && acpResult.models.length > 0) {
          this.acpModelsCache = {
            accountId: acpTargetEntry.id,
            expiresAt: now + ACP_MODELS_CACHE_TTL_MS,
            models: acpResult.models,
            defaultModelId: acpResult.defaultModelId,
          };
          this.persistDiscoveredAcpModels(
            acpTargetEntry.geminiDir,
            acpResult.models,
            acpResult.defaultModelId
          );
          anyFreshLiveSuccess = true;
        }
      }
    }

    if (!this.acpModelsCache || this.acpModelsCache.models.length === 0) {
      for (const candidate of [acpTargetEntry, ...entries].filter(
        (e): e is DiscoveredTokenEntry => Boolean(e)
      )) {
        const diskAcp = this.loadDiscoveredAcpModels(candidate.geminiDir);
        if (diskAcp && diskAcp.models.length > 0) {
          this.acpModelsCache = {
            accountId: candidate.id,
            expiresAt: now + ACP_MODELS_CACHE_TTL_MS,
            models: diskAcp.models,
            defaultModelId: diskAcp.defaultModelId,
          };
          break;
        }
      }
    }

    if (modelMap.size === 0 && cachedPrev?.modelos?.length) {
      for (const m of cachedPrev.modelos) {
        modelMap.set(m.id, m);
      }
    }

    let modelos: ModeloProvedorInfo[];
    if (this.acpModelsCache && this.acpModelsCache.models.length > 0) {
      const targetGrupos = contaElegivel?.grupos_cota?.length
        ? contaElegivel.grupos_cota
        : contas.find((c) => c.grupos_cota.length > 0)?.grupos_cota ?? [];
      modelos = buildGroupedAcpModels(
        this.acpModelsCache.models,
        this.acpModelsCache.defaultModelId,
        targetGrupos,
        [...modelMap.values()]
      );
      if (this.acpModelsCache.defaultModelId) {
        defaultModelId =
          modelos.find((m) => m.padrao)?.id ??
          this.acpModelsCache.defaultModelId.replace(/-(low|medium|high|xhigh)$/i, "");
      }
      const acpIds = modelos.map((m) => m.id);
      for (const conta of contas) {
        conta.modelos_disponiveis = acpIds;
      }
    } else {
      modelos = this.deduplicateModels([...modelMap.values()]);
    }

    if (anyFreshLiveSuccess) {
      const contasForCache = contas.map((c) => {
        if (c.grupos_cota.length > 0) return c;
        const prevAcc = cachedPrev?.contas?.find(
          (p) => p.id === c.id || (c.email && p.email === c.email)
        );
        return prevAcc?.grupos_cota?.length
          ? { ...c, grupos_cota: refreshCachedQuotaGroupCountdowns(prevAcc.grupos_cota) }
          : c;
      });
      this.saveLastSnapshotCache({
        contas: contasForCache,
        modelos,
        defaultModelId,
        imageGenerationModelIds: [...imageGenerationModelIds],
      });
    }

    const snapshot: AntigravityLiveSnapshot = {
      contas,
      pool,
      modelos,
      defaultModelId,
      imageGenerationModelIds: [...imageGenerationModelIds],
      atualizado_em: new Date().toISOString(),
    };
    const hasMissingQuotaForConnected = contas.some(
      (c) => c.estado === "conectado" && c.grupos_cota.length === 0
    );
    const cacheTtl = hasMissingQuotaForConnected ? SHORT_MISSING_QUOTA_TTL_MS : CACHE_TTL_MS;
    this.snapshotCache = { expiresAt: Date.now() + cacheTtl, data: snapshot };
    return snapshot;
  }

  public setPoolSettings(patch: {
    habilitado?: boolean;
    contas_excluidas?: string[];
    conta_em_uso?: string | null;
  }): void {
    if (!this.db) return;
    const { poolOverride } = this.getStudioRecords();
    const next = {
      habilitado: patch.habilitado ?? poolOverride?.habilitado ?? true,
      contas_excluidas: patch.contas_excluidas ?? poolOverride?.contas_excluidas ?? [],
      conta_em_uso: patch.conta_em_uso !== undefined ? patch.conta_em_uso : poolOverride?.conta_em_uso ?? null,
    };
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('antigravity_pool', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(next), new Date().toISOString());
    this.snapshotCache = null;
    this.acpModelsCache = null;
  }

  public cancelPendingSignIn(): boolean {
    return this.acpService.cancelPendingSignIn();
  }

  /**
   * Abre o fluxo oficial Google OAuth no navegador via `antigravity acp --gemini-dir=<pasta_isolada>`
   * e salva a conta exclusivamente no armazenamento local do Criativo AI Studio.
   */
  public async connectGoogleViaBrowser(
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<ContaProvedorInfo> {
    const id = `ag-${randomUUID().slice(0, 8)}`;
    const geminiDir = resolve(this.accountsRootDir, id);

    try {
      const tokenSnap = await this.acpService.signInWithGoogleBrowser({
        geminiDir,
        onAuthUrl,
      });
      const email = tokenSnap.email;
      const { accounts } = this.getStudioRecords();

      // Deduplica automaticamente se o usuário reautenticar com o mesmo e-mail Google
      const dupIdx = email
        ? accounts.findIndex((a) => a.email && a.email.toLowerCase() === email.toLowerCase())
        : -1;

      if (dupIdx >= 0) {
        const old = accounts[dupIdx];
        this.acpService.disposeAccount(old.id);
        if (old.geminiDir && resolve(old.geminiDir) !== geminiDir) {
          try {
            rmSync(resolve(old.geminiDir), { recursive: true, force: true });
          } catch {
            // ignora remoção da pasta antiga
          }
        }
        accounts.splice(dupIdx, 1);
      }

      const nextAccounts: StudioAccountRecord[] = [
        ...accounts,
        {
          id,
          geminiDir,
          label: label?.trim() || null,
          email,
        },
      ];
      this.saveStudioRecords(nextAccounts);

      const snapshot = await this.getLiveSnapshot(true);
      const found = snapshot.contas.find((c) => c.id === id);
      return (
        found ?? {
          id,
          provedor: "gemini",
          rotulo: label?.trim() || null,
          email,
          estado: "conectado",
          padrao: nextAccounts.length === 1,
          token_valido: true,
          token_expira_em: tokenSnap.expiryIso,
          grupos_cota: [],
          origem: "criativo",
        }
      );
    } catch (err) {
      try {
        rmSync(geminiDir, { recursive: true, force: true });
      } catch {
        // ignora limpeza em erro
      }
      throw err;
    }
  }

  /**
   * Executa login Google OAuth em pasta temporária isolada apenas para exportar os tokens
   * ao servidor remoto (VPS), sem gravar nem alterar contas no servidor principal do Desktop.
   */
  public async signInIsolatedForRemoteExport(
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<{
    email: string;
    accessToken: string;
    refreshToken: string;
    expiry: string;
    label?: string;
    acpModels?: AcpDiscoveredModel[];
    acpDefaultModelId?: string | null;
  }> {
    const tempId = `ag-remote-${randomUUID().slice(0, 8)}`;
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-gemini-remote-"));

    try {
      const tokenSnap = await this.acpService.signInWithGoogleBrowser({
        geminiDir: tempDir,
        onAuthUrl,
      });
      const tokenPath = join(tempDir, "antigravity-acp", "antigravity-oauth-token");
      const raw = safeReadJson<TokenFilePayload>(tokenPath);
      const accessToken = tokenSnap.accessToken ?? raw?.token?.access_token?.trim() ?? "";
      const refreshToken = tokenSnap.refreshToken ?? raw?.token?.refresh_token?.trim() ?? "";
      const email = tokenSnap.email ?? raw?.id_token_email?.trim() ?? "";
      const expiry =
        tokenSnap.expiryIso ?? raw?.token?.expiry?.trim() ?? new Date(Date.now() + 55 * 60_000).toISOString();

      if (!accessToken || !email) {
        throw new Error(
          "Login Google concluído, porém o token OAuth ou e-mail da conta não puderam ser exportados."
        );
      }

      const acpCatalog = await this.acpService
        .listAvailableModels(tempId, tempDir)
        .catch(() => null);

      return {
        email,
        accessToken,
        refreshToken,
        expiry,
        ...(label?.trim() ? { label: label.trim() } : {}),
        ...(acpCatalog && acpCatalog.models.length > 0
          ? {
              acpModels: acpCatalog.models,
              acpDefaultModelId: acpCatalog.defaultModelId,
            }
          : {}),
      };
    } finally {
      this.acpService.disposeAccount(tempId);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignora erro na limpeza temporária
      }
    }
  }

  public addManualTokenAccount(input: {
    email: string;
    label?: string;
    accessToken: string;
    refreshToken?: string;
    expiry?: string;
    acpModels?: AcpDiscoveredModel[];
    acpDefaultModelId?: string | null;
  }): ContaProvedorInfo {
    if (!this.db) throw new Error("Banco indisponível para salvar conta.");
    const id = `ag-${Date.now().toString(36)}`;
    const geminiDir = resolve(this.accountsRootDir, id);
    const acpDir = join(geminiDir, "antigravity-acp");
    mkdirSync(acpDir, { recursive: true });
    const tokenPath = join(acpDir, "antigravity-oauth-token");
    const expiry = input.expiry?.trim() || new Date(Date.now() + 55 * 60_000).toISOString();

    writeFileSync(
      tokenPath,
      JSON.stringify(
        {
          token: {
            access_token: input.accessToken.trim(),
            token_type: "Bearer",
            refresh_token: input.refreshToken?.trim() || "",
            expiry,
          },
          auth_method: "consumer",
          id_token_email: input.email.trim(),
        },
        null,
        2
      ),
      "utf8"
    );

    const { accounts } = this.getStudioRecords();
    const filtered = accounts.filter(
      (a) => !a.email || a.email.toLowerCase() !== input.email.trim().toLowerCase()
    );
    const nextAccounts: StudioAccountRecord[] = [
      ...filtered,
      {
        id,
        geminiDir,
        label: input.label?.trim() || null,
        email: input.email.trim(),
      },
    ];
    this.saveStudioRecords(nextAccounts);
    this.snapshotCache = null;

    if (Array.isArray(input.acpModels) && input.acpModels.length > 0) {
      const defaultId = input.acpDefaultModelId ?? null;
      this.persistDiscoveredAcpModels(geminiDir, input.acpModels, defaultId);
      this.acpModelsCache = {
        accountId: id,
        expiresAt: Date.now() + ACP_MODELS_CACHE_TTL_MS,
        models: input.acpModels,
        defaultModelId: defaultId,
      };
    }

    return {
      id,
      provedor: "gemini",
      rotulo: input.label?.trim() || null,
      email: input.email.trim(),
      estado: "conectado",
      padrao: nextAccounts.length === 1,
      token_valido: true,
      token_expira_em: expiry,
      grupos_cota: [],
      origem: "criativo",
    };
  }

  public removeAccount(accountId: string): boolean {
    if (!this.db) return false;
    const { accounts } = this.getStudioRecords();
    const target = accounts.find((a) => a.id === accountId);
    if (!target) return false;

    this.acpService.disposeAccount(accountId);
    try {
      rmSync(resolve(target.geminiDir), { recursive: true, force: true });
    } catch {
      // ignora erro ao apagar pasta da conta
    }

    const next = accounts.filter((a) => a.id !== accountId);
    this.saveStudioRecords(next);
    if (next.length === 0) {
      this.db.connection.prepare(`DELETE FROM projecao_studio_config WHERE chave = 'antigravity_last_snapshot';`).run();
    }
    return true;
  }

  public removeExtraAccount(accountId: string): boolean {
    return this.removeAccount(accountId);
  }

  public async executeCodeAssistGenerate(input: CodeAssistGenerateInput): Promise<CodeAssistGenerateOutput> {
    const snapshot = await this.getLiveSnapshot(false);
    const { entries } = this.discoverStudioTokenEntries();

    if (entries.length === 0) {
      throw new Error("Nenhuma conta Google conectada no Studio.");
    }

    const poolExcluded = new Set(snapshot.pool?.contas_excluidas ?? []);
    const candidateAccountIds = [
      input.preferredAccountId,
      snapshot.pool?.conta_em_uso,
      ...snapshot.contas.filter((c) => !poolExcluded.has(c.id)).map((c) => c.id),
      ...snapshot.contas.map((c) => c.id),
    ].filter((v): v is string => Boolean(v));

    const uniqueAccountIds = [...new Set(candidateAccountIds)];
    const chosenEntry =
      uniqueAccountIds
        .map((id) => entries.find((e) => e.id === id))
        .find((e): e is DiscoveredTokenEntry => Boolean(e)) ?? entries[0];

    const cliAvailable = Boolean(this.acpService.getCliExecutable());

    // 1. Chamadas de TEXTO/CHAT preferem o protocolo ACP aquecido (renova token sozinho e injeta MCPs autorizados ao agente)
    //    com retry automático e fallback transparente para Code Assist REST se a sessão ACP oscilar.
    let acpLastError: unknown = null;
    if (!input.generateImage && cliAvailable && (chosenEntry.hasRefreshToken || !chosenEntry.tokenValid)) {
      const promptParts: string[] = [];
      if (input.systemPrompt) {
        promptParts.push(input.systemPrompt);
      }
      if (input.messages.length > 1) {
        promptParts.push(
          `[Contexto recente da conversa]\n${input.messages
            .slice(-7, -1)
            .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
            .join("\n")}`
        );
      }
      promptParts.push(input.messages[input.messages.length - 1]?.text ?? "");

      const sandboxCwd = resolve(this.workspaceCwd, "dados", "agent-sandbox");
      mkdirSync(sandboxCwd, { recursive: true });
      const combinedPrompt = promptParts.join("\n\n");

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const acpOut = await this.acpService.executePrompt(chosenEntry.id, {
            geminiDir: chosenEntry.geminiDir,
            cwd: sandboxCwd,
            promptText: combinedPrompt,
            modelId: input.model,
            effort: input.effort,
            imagePaths: input.imagePaths,
            labeledImages: input.labeledImages,
            agentId: input.agentId,
            mcpServers: input.mcpServers,
            onDelta: attempt === 0 ? input.onDelta : undefined,
          });

          if (acpOut.text && acpOut.text.trim().length > 0) {
            this.snapshotCache = null;
            return {
              text: acpOut.text,
              images: [],
              modelUsed: acpOut.modelUsed,
              accountId: chosenEntry.id,
              accountEmail: chosenEntry.email,
              usage: acpOut.usage,
            };
          }
          acpLastError = new Error("Sessão ACP retornou resposta vazia.");
        } catch (err) {
          acpLastError = err;
          const errMsg = err instanceof Error ? err.message : String(err);
          // Não repete em caso de timeout/aborto para evitar espera duplicada
          if (/timeout|timed out|abort|cancel/i.test(errMsg)) {
            break;
          }
        }
        this.acpService.disposeAccount(chosenEntry.id);
      }
    }

    const isInternalAcpModel = /orchestrator|argon|neon|g1-/i.test(input.model);
    const acpErrorMessage =
      acpLastError instanceof Error
        ? acpLastError.message
        : acpLastError
          ? String(acpLastError)
          : "";
    if (!input.generateImage && cliAvailable && isInternalAcpModel) {
      throw new Error(
        acpErrorMessage
          ? `Falha no runtime Antigravity ACP para o modelo ${input.model}: ${acpErrorMessage}`
          : `O modelo ${input.model} requer sessão Antigravity ACP ativa e não pôde ser executado sem rebaixamento.`
      );
    }

    // 2. Geração de IMAGEM ou ambientes HTTP puros (e.g. testes unitários sem CLI) via Code Assist REST
    let accessToken = chosenEntry.accessToken;
    if ((!chosenEntry.tokenValid || !accessToken) && cliAvailable && chosenEntry.hasRefreshToken) {
      const refreshed = await this.acpService.refreshAccountToken(chosenEntry.id, chosenEntry.geminiDir);
      accessToken = refreshed?.accessToken ?? null;
    }
    if (!accessToken) {
      throw new Error("Token OAuth da conta Google expirou e precisa ser reautenticado em Conexões.");
    }

    const codeAssistInfo = await this.callCodeAssist<{ cloudaicompanionProject?: string }>(
      CODE_ASSIST_URL,
      "loadCodeAssist",
      accessToken,
      {}
    );
    const project = codeAssistInfo.cloudaicompanionProject;
    if (!project) {
      throw new Error("Projeto Code Assist indisponível para a conta Google conectada.");
    }

    const contents = input.messages.map((msg, idx) => {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: msg.text },
      ];
      const restImages: Array<{ item: LabeledImageInput; labeled: boolean }> =
        input.labeledImages && input.labeledImages.length > 0
          ? input.labeledImages.map((item) => ({ item, labeled: true }))
          : (input.imagePaths ?? []).map((p) => ({
              item: { path: p, role: "anexo_usuario", label: p },
              labeled: false,
            }));
      if (idx === input.messages.length - 1 && restImages.length > 0) {
        for (const { item, labeled } of restImages) {
          try {
            if (existsSync(item.path)) {
              if (labeled) {
                parts.push({ text: formatLabeledImageInstruction(item) });
              }
              parts.push({
                inlineData: {
                  mimeType: inferImageMimeFromPath(item.path),
                  data: readFileSync(item.path).toString("base64"),
                },
              });
            }
          } catch {
            // ignora arquivo ilegível
          }
        }
      }
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      };
    });

    const normalizeRestCandidates = (requested: string, defModel: string | null): string[] => {
      const isInternalAcp = /orchestrator|argon|neon|g1-/i.test(requested);
      const list = isInternalAcp
        ? ["gemini-2.5-pro", "gemini-2.5-flash", defModel || "gemini-3.8-flash-high"]
        : [requested, defModel || "gemini-3.8-flash-high", "gemini-2.5-pro", "gemini-2.5-flash"];
      return [...new Set(list.filter(Boolean))];
    };

    const candidateModels = input.generateImage
      ? [
          ...(snapshot.imageGenerationModelIds.length > 0
            ? snapshot.imageGenerationModelIds
            : ["gemini-3.1-flash-image"]),
        ]
      : normalizeRestCandidates(input.model, snapshot.defaultModelId);

    let lastError: unknown = acpLastError;
    for (const modelToTry of candidateModels) {
      try {
        const requestBody: Record<string, unknown> = {
          model: modelToTry,
          project,
          request: {
            ...(input.systemPrompt
              ? { systemInstruction: { parts: [{ text: input.systemPrompt }] } }
              : {}),
            contents,
            ...(input.generateImage
              ? { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }
              : {}),
          },
        };

        const result = await this.callCodeAssist<{
          response?: {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  text?: string;
                  thought?: boolean;
                  inlineData?: { mimeType?: string; data?: string };
                }>;
              };
            }>;
            usageMetadata?: {
              promptTokenCount?: number;
              cachedContentTokenCount?: number;
              candidatesTokenCount?: number;
              thoughtsTokenCount?: number;
              totalTokenCount?: number;
            };
          };
        }>(DAILY_CODE_ASSIST_URL, "generateContent", accessToken, requestBody, GENERATE_TIMEOUT_MS);

        const parts = result.response?.candidates?.[0]?.content?.parts ?? [];
        const textParts = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text!);
        const images = parts
          .filter((p) => p.inlineData?.data && p.inlineData?.mimeType)
          .map((p) => ({
            mimeType: p.inlineData!.mimeType!,
            dataBase64: p.inlineData!.data!,
          }));

        const um = result.response?.usageMetadata;
        const promptTokens = Number(um?.promptTokenCount ?? 0);
        const cachedInput = Number(um?.cachedContentTokenCount ?? 0);
        const uncachedInput = Math.max(0, promptTokens - cachedInput);
        const output = Number(um?.candidatesTokenCount ?? 0) + Number(um?.thoughtsTokenCount ?? 0);

        const fallbackReason = !input.generateImage
          ? acpErrorMessage
            ? `Fallback REST após falha ACP: ${acpErrorMessage.slice(0, 160)}`
            : modelToTry !== input.model
              ? `Modelo solicitado (${input.model}) redirecionado para ${modelToTry} via Code Assist REST.`
              : undefined
          : undefined;

        return {
          text: textParts.join("\n").trim(),
          images,
          modelUsed: modelToTry,
          accountId: chosenEntry.id,
          accountEmail: chosenEntry.email,
          ...(fallbackReason ? { fallbackReason } : {}),
          usage: {
            uncachedInput,
            cachedInput,
            output,
          },
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha ao executar Code Assist.");
  }

  public close(): void {
    this.acpService.closeAll();
  }
}
