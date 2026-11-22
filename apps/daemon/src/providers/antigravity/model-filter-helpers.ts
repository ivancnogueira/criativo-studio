import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  JanelaCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
} from "@criativo/contracts";
import { QUOTA_TIMEOUT_MS, isInternalHiddenModelId, type FetchAvailableModelEntry, type FetchAvailableModelsResponse } from "./live-types.ts";
import { cleanAcpDisplayName, extractRemainingPercentage, getAntigravityUserAgent, resolveQuotaGroupName } from "./quota-helpers.ts";

export function safeReadJson<T>(filePath: string): T | null {
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

export function normalizeModelFamilyAndEffort(
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

export async function callCodeAssistEndpoint<T>(
  fetchImpl: typeof fetch,
  endpoint: string,
  method: string,
  accessToken: string,
  body: unknown,
  timeoutMs = QUOTA_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}:${method}`, {
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
