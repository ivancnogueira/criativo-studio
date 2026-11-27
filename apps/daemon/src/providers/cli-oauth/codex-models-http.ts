import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeloProvedorInfo } from "@criativo/contracts";
import {
  compareSemverStrings,
  readManagedNpmPackageVersion,
  resolveManagedProviderRuntime,
} from "../provider-runtime-resolver.ts";
import { decodeJwtPayload, mapEffortList } from "./cli-types-and-helpers.ts";

export const MIN_CODEX_CLIENT_VERSION = "0.172.0";

export function isInternalHiddenCodexModel(id: string): boolean {
  const clean = id.trim().toLowerCase();
  if (!clean) return true;
  if (
    /^(codex[-_]?auto[-_]?review|auto[-_]?review|guardian|internal[-_])/i.test(clean) ||
    clean.includes("auto-review")
  ) {
    return true;
  }
  return false;
}

/**
 * Marca geração de imagem apenas para modelos dedicados à criação de imagens (`gpt-image-*`, `dall-e-*`),
 * sem confundir com modelos de chat multimodais que apenas leem imagens (`input_modalities: ["image"]`).
 */
export function isImageGenerationCodexModel(id: string): boolean {
  return /^(gpt-image|dall-e|chatgpt-image)|-image(?:-|$)/i.test(id.trim());
}

/**
 * Determina se um modelo ChatGPT/Codex aceita/suporta imagem via `input_modalities`
 * ou capacidades conhecidas da família multimodal GPT (em paridade com os Gemini no seletor).
 */
export function modelSupportsImageCodex(params: {
  id: string;
  input_modalities?: unknown[];
  inputModalities?: unknown[];
}): boolean {
  if (isImageGenerationCodexModel(params.id)) return true;
  const rawModalities = Array.isArray(params.input_modalities)
    ? params.input_modalities
    : Array.isArray(params.inputModalities)
      ? params.inputModalities
      : null;
  if (rawModalities && rawModalities.length > 0) {
    return rawModalities.some((m) => String(m ?? "").trim().toLowerCase() === "image");
  }
  const clean = params.id.trim().toLowerCase();
  if (/\b(audio|realtime|tts|transcribe|whisper|embedding)\b/i.test(clean)) {
    return false;
  }
  return /^gpt-(?:4o|4\.1|5|6)/i.test(clean);
}

export function isCodexSchemaMismatchError(text: string): boolean {
  return /failed to decode models response|unknown variant\s+[`'"a-z0-9_-]+.*expected one of/i.test(
    text
  );
}

/**
 * Extrai apenas a causa real de erros da Codex CLI sem despejar dumps de JSON de modelos
 * ou banners de stdin no chat do usuário.
 */
export function extractCleanCodexError(stderr: string, stdout = ""): string {
  const raw = `${stderr}\n${stdout}`
    .replace(/;\s*body:\s*\{[\s\S]*$/i, "")
    .replace(/\r/g, "");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^Reading prompt from stdin\.{0,3}$/i.test(l) &&
        !/^operable program or batch file\.?$/i.test(l)
    );

  const prioritized =
    lines.find((l) => /\b(ERROR|fatal|unauthorized|401|429|quota|expired|unknown variant|not recognized)\b/i.test(l)) ??
    lines[0] ??
    "Codex CLI retornou erro.";

  const cleaned = prioritized
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+ERROR\s+[^\s:]+:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (isCodexSchemaMismatchError(cleaned)) {
    return "Codex CLI desatualizada para o catálogo atual da OpenAI (tentando atualização automática).";
  }
  return cleaned.length > 260 ? `${cleaned.slice(0, 257)}...` : cleaned;
}

export function readCodexAuthCredentials(codexHome: string): {
  accessToken: string | null;
  accountId: string | null;
  hasRefreshToken: boolean;
} {
  const authPath = join(codexHome, "auth.json");
  if (!existsSync(authPath)) {
    return { accessToken: null, accountId: null, hasRefreshToken: false };
  }
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as {
      tokens?: {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        account_id?: string;
      };
    };
    const accessToken = raw.tokens?.access_token?.trim() || null;
    const hasRefreshToken = Boolean(raw.tokens?.refresh_token?.trim());
    let accountId = raw.tokens?.account_id?.trim() || null;
    if (!accountId && raw.tokens?.id_token) {
      const jwt = decodeJwtPayload(raw.tokens.id_token);
      const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined;
      if (typeof authMeta?.chatgpt_account_id === "string" && authMeta.chatgpt_account_id.trim()) {
        accountId = authMeta.chatgpt_account_id.trim();
      }
    }
    if (!accountId && accessToken) {
      const jwt = decodeJwtPayload(accessToken);
      const authMeta = jwt?.["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined;
      if (typeof authMeta?.chatgpt_account_id === "string" && authMeta.chatgpt_account_id.trim()) {
        accountId = authMeta.chatgpt_account_id.trim();
      }
    }
    return { accessToken, accountId, hasRefreshToken };
  } catch {
    return { accessToken: null, accountId: null, hasRefreshToken: false };
  }
}

interface RawCodexHttpModel {
  slug?: string;
  model?: string;
  display_name?: string;
  displayName?: string;
  visibility?: string;
  hidden?: boolean;
  is_default?: boolean;
  isDefault?: boolean;
  priority?: number;
  default_reasoning_level?: string;
  input_modalities?: unknown[];
  inputModalities?: unknown[];
  supported_reasoning_levels?: Array<{ effort?: string; reasoningEffort?: string } | string>;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
}

export function mapCodexModelsResponseToInfo(rawModels: unknown[]): ModeloProvedorInfo[] {
  const visible = rawModels
    .filter((item): item is RawCodexHttpModel => Boolean(item && typeof item === "object"))
    .filter((item) => {
      const slug = (item.slug ?? item.model ?? "").trim();
      if (!slug || isInternalHiddenCodexModel(slug)) return false;
      if (item.hidden === true) return false;
      if (typeof item.visibility === "string" && item.visibility.trim().toLowerCase() !== "list") {
        return false;
      }
      return true;
    })
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const pa = typeof a.item.priority === "number" ? a.item.priority : Number.MAX_SAFE_INTEGER;
      const pb = typeof b.item.priority === "number" ? b.item.priority : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.idx - b.idx;
    });

  const mapped: ModeloProvedorInfo[] = [];
  const seen = new Set<string>();

  for (const { item } of visible) {
    const id = (item.slug ?? item.model ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const rawEfforts = [
      ...(item.supported_reasoning_levels ?? []).map((e) =>
        typeof e === "string" ? e : String(e?.effort ?? e?.reasoningEffort ?? "")
      ),
      ...(item.supportedReasoningEfforts ?? []).map((e) => String(e?.reasoningEffort ?? "")),
    ].filter(Boolean);

    mapped.push({
      id,
      rotulo: (item.display_name ?? item.displayName)?.trim() || id,
      padrao: Boolean(item.is_default || item.isDefault),
      suporta_imagem: modelSupportsImageCodex({
        id,
        input_modalities: item.input_modalities,
        inputModalities: item.inputModalities,
      }),
      esforcos_suportados: mapEffortList(rawEfforts),
      descoberto_em_conta: true,
    });
  }

  if (mapped.length > 0 && !mapped.some((m) => m.padrao)) {
    mapped[0].padrao = true;
  }

  return mapped;
}

export async function fetchCodexAccountModelsHttp(options: {
  codexHome: string;
  fetchImpl: typeof fetch;
  appDataDir?: string;
  clientVersion?: string;
  onUnauthorizedRefresh?: () => Promise<void>;
}): Promise<ModeloProvedorInfo[]> {
  let creds = readCodexAuthCredentials(options.codexHome);
  if (!creds.accessToken) return [];

  const installedNpmVer = readManagedNpmPackageVersion("codex", options.appDataDir);
  const installedStandaloneVer = resolveManagedProviderRuntime("codex", {
    appDataDir: options.appDataDir,
    includeSystemPaths: false,
  }).version;
  let clientVersion = MIN_CODEX_CLIENT_VERSION;
  for (const candidate of [installedNpmVer, installedStandaloneVer, options.clientVersion]) {
    if (
      candidate &&
      /^[0-9]+\.[0-9]+\.[0-9]+/.test(candidate) &&
      compareSemverStrings(candidate, clientVersion) > 0
    ) {
      clientVersion = candidate;
    }
  }

  const requestOnce = async (token: string, accountId: string | null) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": `codex-cli/${clientVersion}`,
    };
    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId;
    }
    return options.fetchImpl(
      `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`,
      {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8_000),
      }
    );
  };

  try {
    let res = await requestOnce(creds.accessToken, creds.accountId);
    if (res.status === 401 && creds.hasRefreshToken && options.onUnauthorizedRefresh) {
      await options.onUnauthorizedRefresh().catch(() => {});
      creds = readCodexAuthCredentials(options.codexHome);
      if (creds.accessToken) {
        res = await requestOnce(creds.accessToken, creds.accountId);
      }
    }
    if (!res.ok) return [];
    const payload = (await res.json().catch(() => null)) as {
      models?: unknown[];
      data?: unknown[];
    } | null;
    const rawList = Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    return mapCodexModelsResponseToInfo(rawList);
  } catch {
    return [];
  }
}
