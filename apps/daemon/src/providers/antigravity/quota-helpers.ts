import { extname, join, resolve } from "node:path";
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
import {
  formatResetCountdownPtBr,
  refreshCachedQuotaGroupCountdowns,
} from "../provider-quota-utils.ts";
import { DESKTOP_BUILD, DESKTOP_VERSION, isInternalHiddenModelId, type CodeAssistQuotaBucket, type CodeAssistQuotaGroup, type CodeAssistRetrieveQuotaResponse, type FetchAvailableModelEntry, type FetchAvailableModelQuotaSlot } from "./live-types.ts";

export function getAntigravityUserAgent(): string {
  const osName = process.platform === "win32" ? "windows" : process.platform;
  const archName = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/hub/${DESKTOP_VERSION} (aidev_client; os_type=${osName}; arch=${archName}; cl=${DESKTOP_BUILD})`;
}

export function inferImageMimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export function mapAcpEffortSuffix(rawId: string): NivelEsforco | null {
  const lower = rawId.toLowerCase();
  if (lower.endsWith("-low")) return "baixo";
  if (lower.endsWith("-medium")) return "medio";
  if (lower.endsWith("-high") || lower.endsWith("-xhigh")) return "alto";
  return null;
}

export function cleanAcpDisplayName(rawName: string): string {
  return rawName
    .replace(/\s*\((?:Low|Medium|High|XHigh|Extra|Standard)\)\s*$/i, "")
    .replace(/\s+(?:Low|Medium|High|XHigh|Extra)\s*$/i, "")
    .trim();
}

export function buildGroupedAcpModels(
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

export function parseGroupModelsDescription(desc: string | undefined): string[] {
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
