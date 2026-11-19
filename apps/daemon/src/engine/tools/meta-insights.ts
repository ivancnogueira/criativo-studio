import { resolveMetaGraphApiBase, resolveMetaGraphApiVersion } from "@criativo/contracts";
import type { FetchLike } from "../providers/provider-interface.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";

export interface MetaCredentialsResolved {
  accessToken: string | null;
  accountId: string | null;
  tokenKeyFound: string | null;
  accountIdKeyFound: string | null;
  contaId: string | null;
  configured: boolean;
}

export interface MetaValidationReport {
  ok: boolean;
  estagio: 3 | 4 | 5 | 7;
  api_version: string;
  resumo: string;
  detalhes: {
    tokenConfigurado: boolean;
    accountIdConfigurado: boolean;
    httpStatus: number | null;
    graphApiOk: boolean;
    idConfere: boolean;
    username: string | null;
    followersCount: number | null;
    mediaCount: number | null;
    erro: string | null;
  };
}

export interface MetaInsightsQueryInput {
  periodo?: "7d" | "28d" | "30d" | "90d";
  limite_posts?: number;
  incluir_reels?: boolean;
  conta_id?: string;
}

export interface MetaPostMetricItem {
  id: string;
  caption_resumo: string;
  media_type: string;
  media_product_type: string;
  permalink: string | null;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  views: number | null;
  saved: number | null;
  shares: number | null;
  total_interactions: number | null;
  avg_watch_time_ms: number | null;
  video_view_total_time_ms: number | null;
  taxa_salvamento_pct: number | null;
}

export interface MetaInsightsReport {
  ok: boolean;
  api_version: string;
  periodo: "7d" | "28d" | "30d" | "90d";
  conta: {
    id: string;
    username: string | null;
    name: string | null;
    followers_count: number | null;
    follows_count: number | null;
    media_count: number | null;
  };
  insights_conta_30d_max: {
    reach: number | null;
    views: number | null;
    profile_views: number | null;
    observacao?: string;
  };
  posts: MetaPostMetricItem[];
  resumo_por_formato: Record<
    string,
    { quantidade: number; avg_salvamento_pct: number | null; total_saved: number; total_reach: number; total_views: number }
  >;
  amostra_insuficiente: boolean;
  avisos: string[];
  sugestao_perfil_handle: string | null;
}

export function resolveMetaCredentials(
  vault?: VaultService,
  nativeStore?: NativeAppConnectionsStore,
  contaId?: string | null
): MetaCredentialsResolved {
  if (nativeStore) {
    const resolved = nativeStore.getResolvedCredentials("instagram", contaId);
    const tok = resolved.values.IG_ACCESS_TOKEN?.trim() || null;
    const uid = resolved.values.IG_USER_ID?.trim() || null;
    if (tok || uid) {
      return {
        accessToken: tok,
        accountId: uid,
        tokenKeyFound: tok ? `native/instagram/${resolved.contaId}/IG_ACCESS_TOKEN` : null,
        accountIdKeyFound: uid ? `native/instagram/${resolved.contaId}/IG_USER_ID` : null,
        contaId: resolved.contaId,
        configured: Boolean(tok && uid),
      };
    }
  }

  if (!vault) {
    return {
      accessToken: null,
      accountId: null,
      tokenKeyFound: null,
      accountIdKeyFound: null,
      contaId: null,
      configured: false,
    };
  }

  let accessToken: string | null = null;
  let tokenKeyFound: string | null = null;
  for (const k of ["instagram_access_token", "META_ACCESS_TOKEN", "IG_ACCESS_TOKEN"]) {
    const val = vault.getSecret(k);
    if (val && val.trim().length > 0) {
      accessToken = val.trim();
      tokenKeyFound = k;
      break;
    }
  }

  let accountId: string | null = null;
  let accountIdKeyFound: string | null = null;
  for (const k of ["instagram_business_account_id", "META_IG_USER_ID", "IG_USER_ID"]) {
    const val = vault.getSecret(k);
    if (val && val.trim().length > 0) {
      accountId = val.trim();
      accountIdKeyFound = k;
      break;
    }
  }

  return {
    accessToken,
    accountId,
    tokenKeyFound,
    accountIdKeyFound,
    contaId: null,
    configured: Boolean(accessToken && accountId),
  };
}

/**
 * Executa validação segura da integração Meta Graph API (padrão v27.0) lendo do Cofre SQLite
 * sem jamais expor o token em logs, retornos ou mensagens ao usuário.
 */
export async function validateMetaIntegration(
  vault?: VaultService,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  options?: { nativeStore?: NativeAppConnectionsStore; contaId?: string | null; apiVersion?: string }
): Promise<MetaValidationReport> {
  const apiVersion = resolveMetaGraphApiVersion(options?.apiVersion);
  const graphBase = resolveMetaGraphApiBase(apiVersion);
  const creds = resolveMetaCredentials(vault, options?.nativeStore, options?.contaId);

  if (!creds.configured || !creds.accessToken || !creds.accountId) {
    return {
      ok: false,
      estagio: 3,
      api_version: apiVersion,
      resumo:
        "Credenciais Meta ausentes no Cofre AES-256-GCM. Salve Access Token e Business Account ID em Loja → Apps → Instagram / Meta.",
      detalhes: {
        tokenConfigurado: Boolean(creds.accessToken),
        accountIdConfigurado: Boolean(creds.accountId),
        httpStatus: null,
        graphApiOk: false,
        idConfere: false,
        username: null,
        followersCount: null,
        mediaCount: null,
        erro: "Credenciais não cadastradas no Cofre.",
      },
    };
  }

  try {
    const url = `${graphBase}/${encodeURIComponent(
      creds.accountId
    )}?fields=id,username,followers_count,media_count&access_token=${encodeURIComponent(
      creds.accessToken
    )}`;
    const res = await fetchImpl(url, { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      username?: string;
      followers_count?: number;
      media_count?: number;
      error?: { message?: string; code?: number };
    };

    if (!res.ok) {
      const msgErro = data.error?.message ?? `Meta Graph API ${apiVersion} respondeu HTTP ${res.status}`;
      return {
        ok: false,
        estagio: 7,
        api_version: apiVersion,
        resumo: `Falha na validação Meta Graph API ${apiVersion} (HTTP ${res.status}): ${msgErro}`,
        detalhes: {
          tokenConfigurado: true,
          accountIdConfigurado: true,
          httpStatus: res.status,
          graphApiOk: false,
          idConfere: false,
          username: null,
          followersCount: null,
          mediaCount: null,
          erro: msgErro,
        },
      };
    }

    const idConfere = String(data.id ?? "") === String(creds.accountId);
    const username = typeof data.username === "string" ? data.username : null;
    const followersCount = typeof data.followers_count === "number" ? data.followers_count : null;
    const mediaCount = typeof data.media_count === "number" ? data.media_count : null;

    return {
      ok: true,
      estagio: 5,
      api_version: apiVersion,
      resumo: `Integração Meta ${apiVersion} validada com sucesso (HTTP ${res.status} · Perfil conectado${
        username ? `: @${username}` : ""
      }).`,
      detalhes: {
        tokenConfigurado: true,
        accountIdConfigurado: true,
        httpStatus: res.status,
        graphApiOk: true,
        idConfere,
        username,
        followersCount,
        mediaCount,
        erro: null,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : `Falha de rede ao consultar Meta Graph API ${apiVersion}.`;
    return {
      ok: false,
      estagio: 7,
      api_version: apiVersion,
      resumo: `Erro ao consultar Meta Graph API ${apiVersion}: ${msg}`,
      detalhes: {
        tokenConfigurado: true,
        accountIdConfigurado: true,
        httpStatus: null,
        graphApiOk: false,
        idConfere: false,
        username: null,
        followersCount: null,
        mediaCount: null,
        erro: msg,
      },
    };
  }
}

function sumInsightValues(entries: Array<{ value?: unknown; total_value?: { value?: unknown } }>): number | null {
  let acc = 0;
  let found = false;
  for (const item of entries) {
    if (typeof item.total_value?.value === "number") {
      acc += item.total_value.value;
      found = true;
    } else if (typeof item.value === "number") {
      acc += item.value;
      found = true;
    }
  }
  return found ? acc : null;
}

function extractInsightEntryMap(
  dataArray: Array<{
    name?: string;
    total_value?: { value?: unknown };
    values?: Array<{ value?: unknown }>;
  }>
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const row of dataArray) {
    if (!row || typeof row.name !== "string") continue;
    if (typeof row.total_value?.value === "number") {
      out[row.name] = row.total_value.value;
    } else if (Array.isArray(row.values) && row.values.length > 0) {
      out[row.name] = sumInsightValues(row.values);
    } else {
      out[row.name] = null;
    }
  }
  return out;
}

/**
 * Consulta métricas reais da conta e posts/Reels na Instagram Graph API v27.0
 * utilizando as métricas atuais (`views`, `reach`, `saved`, `shares`, `ig_reels_avg_watch_time`)
 * sem enviar métricas descontinuadas (`impressions` / `plays`).
 */
export async function fetchMetaAccountAndMediaInsights(
  input: MetaInsightsQueryInput,
  deps: {
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    fetchImpl?: FetchLike;
    apiVersion?: string;
  }
): Promise<MetaInsightsReport> {
  const periodo: "7d" | "28d" | "30d" | "90d" =
    input.periodo === "7d" || input.periodo === "28d" || input.periodo === "90d" ? input.periodo : "30d";
  const limitPosts = Math.max(1, Math.min(30, Number(input.limite_posts) || 15));
  const includeReels = input.incluir_reels !== false;
  const fetchFn = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const apiVersion = resolveMetaGraphApiVersion(deps.apiVersion);
  const graphBase = resolveMetaGraphApiBase(apiVersion);

  const creds = resolveMetaCredentials(deps.vault, deps.nativeStore, input.conta_id);
  if (!creds.configured || !creds.accessToken || !creds.accountId) {
    throw new Error(
      "Credenciais Meta/Instagram ausentes no Cofre AES-256-GCM. Configure em Loja → Apps → Instagram / Meta."
    );
  }

  const avisos: string[] = [];

  // 1. Perfil básico da conta
  const profileUrl = `${graphBase}/${encodeURIComponent(
    creds.accountId
  )}?fields=id,username,name,followers_count,follows_count,media_count&access_token=${encodeURIComponent(
    creds.accessToken
  )}`;
  const profileRes = await fetchFn(profileUrl, { method: "GET" });
  const profileJson = (await profileRes.json().catch(() => ({}))) as {
    id?: string;
    username?: string;
    name?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    error?: { message?: string; code?: number };
  };
  if (!profileRes.ok || !profileJson.id) {
    throw new Error(
      profileJson.error?.message ||
        `Meta Graph API ${apiVersion} rejeitou a consulta de perfil (HTTP ${profileRes.status}).`
    );
  }

  // 2. Insights de nível conta (Graph API limita janela de métricas diárias em até 30 dias)
  const accountDays = periodo === "7d" ? 7 : periodo === "28d" ? 28 : 30;
  if (periodo === "90d") {
    avisos.push(
      "A Meta Graph API v27.0 limita métricas diárias de conta (reach/views/profile_views) a janelas de até 30 dias; as postagens abaixo cobrem os últimos 90 dias."
    );
  }
  const untilSec = Math.floor(Date.now() / 1000);
  const sinceSec = untilSec - accountDays * 86_400;

  let acctReach: number | null = null;
  let acctViews: number | null = null;
  let acctProfileViews: number | null = null;

  const queryAccountMetric = async (metricsParam: string) => {
    const url = `${graphBase}/${encodeURIComponent(
      creds.accountId!
    )}/insights?metric=${encodeURIComponent(
      metricsParam
    )}&metric_type=total_value&period=day&since=${sinceSec}&until=${untilSec}&access_token=${encodeURIComponent(
      creds.accessToken!
    )}`;
    const r = await fetchFn(url, { method: "GET" });
    const j = (await r.json().catch(() => ({}))) as {
      data?: Array<{ name?: string; total_value?: { value?: unknown }; values?: Array<{ value?: unknown }> }>;
      error?: { message?: string };
    };
    return { ok: r.ok, data: j.data ?? [], error: j.error?.message ?? null };
  };

  const bulkAcct = await queryAccountMetric("reach,profile_views,views");
  if (bulkAcct.ok) {
    const m = extractInsightEntryMap(bulkAcct.data);
    acctReach = m.reach ?? null;
    acctViews = m.views ?? null;
    acctProfileViews = m.profile_views ?? null;
  } else {
    // Fallback individual caso alguma métrica exija permissão ou não esteja disponível no tipo de conta
    for (const metricName of ["reach", "views", "profile_views"] as const) {
      const single = await queryAccountMetric(metricName);
      if (single.ok) {
        const m = extractInsightEntryMap(single.data);
        if (metricName === "reach") acctReach = m.reach ?? null;
        if (metricName === "views") acctViews = m.views ?? null;
        if (metricName === "profile_views") acctProfileViews = m.profile_views ?? null;
      } else if (single.error) {
        avisos.push(`Métrica de conta '${metricName}' indisponível: ${single.error}`);
      }
    }
  }

  // 3. Mídias recentes filtradas pela janela escolhida
  const cutoffDays = periodo === "7d" ? 7 : periodo === "28d" ? 28 : periodo === "30d" ? 30 : 90;
  const cutoffMs = Date.now() - cutoffDays * 86_400_000;

  const mediaUrl = `${graphBase}/${encodeURIComponent(
    creds.accountId
  )}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=${limitPosts}&access_token=${encodeURIComponent(
    creds.accessToken
  )}`;
  const mediaRes = await fetchFn(mediaUrl, { method: "GET" });
  const mediaJson = (await mediaRes.json().catch(() => ({}))) as {
    data?: Array<{
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      permalink?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
    }>;
    error?: { message?: string };
  };

  if (!mediaRes.ok && mediaJson.error?.message) {
    avisos.push(`Não foi possível listar mídias recentes: ${mediaJson.error.message}`);
  }

  const rawMedia = Array.isArray(mediaJson.data) ? mediaJson.data : [];
  const filteredMedia = rawMedia.filter((m) => {
    if (!m.timestamp) return true;
    const ts = Date.parse(m.timestamp);
    return Number.isNaN(ts) || ts >= cutoffMs;
  });

  const posts: MetaPostMetricItem[] = [];
  for (const item of filteredMedia) {
    const productType = (item.media_product_type || item.media_type || "FEED").toUpperCase();
    const isReel = productType === "REELS" || productType === "REEL";
    if (!includeReels && isReel) continue;

    const candidateMetricSets = isReel
      ? [
          "views,reach,saved,shares,likes,comments,ig_reels_avg_watch_time,ig_reels_video_view_total_time",
          "views,reach,saved,shares,likes,comments",
          "reach,saved,likes,comments",
        ]
      : [
          "views,reach,saved,shares,total_interactions",
          "views,reach,saved,shares",
          "reach,saved",
        ];

    let metricMap: Record<string, number | null> = {};
    for (const metricSet of candidateMetricSets) {
      const mUrl = `${graphBase}/${encodeURIComponent(item.id)}/insights?metric=${encodeURIComponent(
        metricSet
      )}&access_token=${encodeURIComponent(creds.accessToken)}`;
      const r = await fetchFn(mUrl, { method: "GET" });
      if (r.ok) {
        const j = (await r.json().catch(() => ({}))) as {
          data?: Array<{ name?: string; total_value?: { value?: unknown }; values?: Array<{ value?: unknown }> }>;
        };
        metricMap = extractInsightEntryMap(j.data ?? []);
        break;
      }
    }

    const reach = metricMap.reach ?? null;
    const saved = metricMap.saved ?? null;
    const taxaSalvamento =
      reach !== null && reach > 0 && saved !== null ? Number(((saved / reach) * 100).toFixed(2)) : null;

    posts.push({
      id: item.id,
      caption_resumo: String(item.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      media_type: item.media_type ?? "IMAGE",
      media_product_type: productType,
      permalink: item.permalink ?? null,
      timestamp: item.timestamp ?? null,
      likes: typeof item.like_count === "number" ? item.like_count : metricMap.likes ?? null,
      comments: typeof item.comments_count === "number" ? item.comments_count : metricMap.comments ?? null,
      reach,
      views: metricMap.views ?? null,
      saved,
      shares: metricMap.shares ?? null,
      total_interactions: metricMap.total_interactions ?? null,
      avg_watch_time_ms: metricMap.ig_reels_avg_watch_time ?? null,
      video_view_total_time_ms: metricMap.ig_reels_video_view_total_time ?? null,
      taxa_salvamento_pct: taxaSalvamento,
    });
  }

  const resumoPorFormato: MetaInsightsReport["resumo_por_formato"] = {};
  for (const p of posts) {
    const key = p.media_product_type || p.media_type;
    if (!resumoPorFormato[key]) {
      resumoPorFormato[key] = {
        quantidade: 0,
        avg_salvamento_pct: null,
        total_saved: 0,
        total_reach: 0,
        total_views: 0,
      };
    }
    const bucket = resumoPorFormato[key];
    bucket.quantidade += 1;
    bucket.total_saved += p.saved ?? 0;
    bucket.total_reach += p.reach ?? 0;
    bucket.total_views += p.views ?? 0;
  }

  for (const bucket of Object.values(resumoPorFormato)) {
    bucket.avg_salvamento_pct =
      bucket.total_reach > 0 ? Number(((bucket.total_saved / bucket.total_reach) * 100).toFixed(2)) : null;
  }

  return {
    ok: true,
    api_version: apiVersion,
    periodo,
    conta: {
      id: profileJson.id,
      username: profileJson.username ?? null,
      name: profileJson.name ?? null,
      followers_count: typeof profileJson.followers_count === "number" ? profileJson.followers_count : null,
      follows_count: typeof profileJson.follows_count === "number" ? profileJson.follows_count : null,
      media_count: typeof profileJson.media_count === "number" ? profileJson.media_count : null,
    },
    insights_conta_30d_max: {
      reach: acctReach,
      views: acctViews,
      profile_views: acctProfileViews,
      ...(avisos.length > 0 ? { observacao: avisos[0] } : {}),
    },
    posts,
    resumo_por_formato: resumoPorFormato,
    amostra_insuficiente: posts.length < 5,
    avisos,
    sugestao_perfil_handle: profileJson.username ? `@${profileJson.username.replace(/^@/, "")}` : null,
  };
}
