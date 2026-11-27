import {
  resolveMetaGraphApiVersion,
  type MetaGalleryFormatSummary,
  type MetaGalleryPeriod,
  type MetaGalleryPostItem,
  type MetaGalleryResponse,
  type MetaGallerySummary,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  fetchMetaAccountAndMediaInsights,
  resolveMetaCredentials,
  type MetaPostMetricItem,
} from "../engine/tools/meta-insights.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { VaultService } from "../vault/vault-service.ts";

interface MetaCacheRow {
  media_id: string;
  conta_id: string;
  payload_json: string;
  sincronizado_em: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

function normalizeGalleryFormat(item: { media_type?: string; media_product_type?: string }): MetaGalleryPostItem["formato_normalizado"] {
  const product = String(item.media_product_type ?? "").toUpperCase();
  const mediaType = String(item.media_type ?? "").toUpperCase();
  if (product === "REELS" || product === "REEL") return "reels";
  if (product === "STORY" || product === "STORIES") return "story";
  if (mediaType === "CAROUSEL_ALBUM" || mediaType === "CAROUSEL") return "carrossel";
  if (mediaType === "VIDEO") return "reels";
  return "imagem";
}

function periodCutoffMs(periodo: MetaGalleryPeriod): number {
  const days = periodo === "7d" ? 7 : periodo === "28d" ? 28 : periodo === "30d" ? 30 : 90;
  return Date.now() - days * 86_400_000;
}

export function summarizeMetaGalleryPosts(posts: MetaGalleryPostItem[]): MetaGallerySummary {
  let alcanceTotal = 0;
  let reachCount = 0;
  let visualizacoesTotal = 0;
  let salvamentosTotal = 0;
  let interacoesTotal = 0;
  let repostsTotal = 0;
  let melhorTaxa: number | null = null;
  let skipRateSum = 0;
  let skipRateCount = 0;
  let melhorGanchoSkip: number | null = null;
  const resumoPorFormato: Record<string, MetaGalleryFormatSummary> = {};
  const skipPorFormato = new Map<string, { sum: number; count: number }>();

  for (const post of posts) {
    const reach = post.reach ?? 0;
    const views = post.views ?? 0;
    const saved = post.saved ?? 0;
    const likes = post.likes ?? 0;
    const comments = post.comments ?? 0;
    const shares = post.shares ?? 0;
    const reposts = post.reposts ?? 0;
    const interactions = post.total_interactions ?? likes + comments + saved + shares;

    if (post.reach !== null && post.reach !== undefined) {
      alcanceTotal += post.reach;
      reachCount += 1;
    }
    visualizacoesTotal += views;
    salvamentosTotal += saved;
    interacoesTotal += interactions;
    repostsTotal += reposts;

    if (post.taxa_salvamento_pct !== null && (melhorTaxa === null || post.taxa_salvamento_pct > melhorTaxa)) {
      melhorTaxa = post.taxa_salvamento_pct;
    }
    if (typeof post.skip_rate_3s_pct === "number" && Number.isFinite(post.skip_rate_3s_pct)) {
      skipRateSum += post.skip_rate_3s_pct;
      skipRateCount += 1;
      if (melhorGanchoSkip === null || post.skip_rate_3s_pct < melhorGanchoSkip) {
        melhorGanchoSkip = post.skip_rate_3s_pct;
      }
    }

    const fmtKey = post.formato_normalizado;
    if (!resumoPorFormato[fmtKey]) {
      resumoPorFormato[fmtKey] = {
        quantidade: 0,
        avg_salvamento_pct: null,
        total_saved: 0,
        total_reach: 0,
        total_views: 0,
        avg_skip_rate_3s_pct: null,
        total_reposts: 0,
      };
    }
    const bucket = resumoPorFormato[fmtKey];
    bucket.quantidade += 1;
    bucket.total_saved += saved;
    bucket.total_reach += reach;
    bucket.total_views += views;
    bucket.total_reposts = (bucket.total_reposts ?? 0) + reposts;
    if (typeof post.skip_rate_3s_pct === "number" && Number.isFinite(post.skip_rate_3s_pct)) {
      const acc = skipPorFormato.get(fmtKey) ?? { sum: 0, count: 0 };
      acc.sum += post.skip_rate_3s_pct;
      acc.count += 1;
      skipPorFormato.set(fmtKey, acc);
    }
  }

  let melhorFormato: string | null = null;
  let melhorScore = -1;
  for (const [fmt, bucket] of Object.entries(resumoPorFormato)) {
    bucket.avg_salvamento_pct =
      bucket.total_reach > 0 ? Number(((bucket.total_saved / bucket.total_reach) * 100).toFixed(2)) : null;
    const skipAcc = skipPorFormato.get(fmt);
    bucket.avg_skip_rate_3s_pct =
      skipAcc && skipAcc.count > 0 ? Number((skipAcc.sum / skipAcc.count).toFixed(2)) : null;
    const score = bucket.avg_salvamento_pct ?? bucket.total_saved;
    if (score > melhorScore) {
      melhorScore = score;
      melhorFormato = fmt;
    }
  }

  const alcanceMedio = reachCount > 0 ? Math.round(alcanceTotal / reachCount) : 0;
  const taxaMedia =
    alcanceTotal > 0 ? Number(((salvamentosTotal / alcanceTotal) * 100).toFixed(2)) : null;
  const skipMedio = skipRateCount > 0 ? Number((skipRateSum / skipRateCount).toFixed(2)) : null;
  const retencaoMedia = skipMedio !== null ? Number((100 - skipMedio).toFixed(2)) : null;

  return {
    total_posts: posts.length,
    alcance_total: alcanceTotal,
    alcance_medio: alcanceMedio,
    visualizacoes_total: visualizacoesTotal,
    salvamentos_total: salvamentosTotal,
    interacoes_total: interacoesTotal,
    melhor_taxa_salvamento_pct: melhorTaxa,
    taxa_salvamento_media_pct: taxaMedia,
    melhor_formato: melhorFormato,
    reposts_total: repostsTotal,
    skip_rate_3s_medio_pct: skipMedio,
    retencao_3s_media_pct: retencaoMedia,
    melhor_gancho_skip_rate_pct: melhorGanchoSkip,
    resumo_por_formato: resumoPorFormato,
  };
}

/**
 * Serviço de Galeria de Posts Publicados + Métricas Meta Graph API v21.0+ com cache em SQLite.
 */
export class MetaGalleryService {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private readonly nativeStore?: NativeAppConnectionsStore;
  private readonly fetchImpl?: FetchLike;

  constructor(deps: {
    db: CriativoDatabase;
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    fetchImpl?: FetchLike;
  }) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.nativeStore = deps.nativeStore;
    this.fetchImpl = deps.fetchImpl;
  }

  private findEditorialLinks(): Map<string, string> {
    const rows = this.db.connection
      .prepare(
        "SELECT id, meta_media_id FROM calendario_editorial_posts WHERE meta_media_id IS NOT NULL;"
      )
      .all() as Array<{ id: string; meta_media_id: string }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.meta_media_id) {
        map.set(r.meta_media_id, r.id);
      }
    }
    return map;
  }

  private mapMetricToGalleryItem(
    item: MetaPostMetricItem,
    sincronizadoEm: string,
    editorialLinks: Map<string, string>
  ): MetaGalleryPostItem {
    const skipRate =
      typeof item.skip_rate_3s_pct === "number" && Number.isFinite(item.skip_rate_3s_pct)
        ? item.skip_rate_3s_pct
        : null;
    const hookRetention =
      typeof item.hook_retention_3s_pct === "number" && Number.isFinite(item.hook_retention_3s_pct)
        ? item.hook_retention_3s_pct
        : skipRate !== null
          ? Number((100 - skipRate).toFixed(2))
          : null;
    const reposts =
      typeof item.reposts === "number" && Number.isFinite(item.reposts) ? item.reposts : null;

    return {
      ...item,
      skip_rate_3s_pct: skipRate,
      hook_retention_3s_pct: hookRetention,
      reposts,
      formato_normalizado: normalizeGalleryFormat(item),
      sincronizado_em: sincronizadoEm,
      editorial_post_id: editorialLinks.get(item.id) ?? null,
    };
  }

  public readCachedPosts(contaId: string | null, periodo: MetaGalleryPeriod): {
    posts: MetaGalleryPostItem[];
    ultimaSincronizacao: string | null;
    isFresh: boolean;
  } {
    const rows = (
      contaId
        ? this.db.connection
            .prepare(
              "SELECT * FROM meta_posts_cache WHERE conta_id = ? ORDER BY sincronizado_em DESC LIMIT 60;"
            )
            .all(contaId)
        : this.db.connection
            .prepare("SELECT * FROM meta_posts_cache ORDER BY sincronizado_em DESC LIMIT 60;")
            .all()
    ) as unknown as MetaCacheRow[];

    if (rows.length === 0) {
      return { posts: [], ultimaSincronizacao: null, isFresh: false };
    }

    const links = this.findEditorialLinks();
    const cutoff = periodCutoffMs(periodo);
    let newestSync: string | null = null;
    const posts: MetaGalleryPostItem[] = [];

    for (const row of rows) {
      if (!newestSync || row.sincronizado_em > newestSync) {
        newestSync = row.sincronizado_em;
      }
      try {
        const parsed = JSON.parse(row.payload_json) as MetaPostMetricItem;
        if (parsed.timestamp) {
          const ts = Date.parse(parsed.timestamp);
          if (!Number.isNaN(ts) && ts < cutoff) continue;
        }
        posts.push(this.mapMetricToGalleryItem(parsed, row.sincronizado_em, links));
      } catch {
        // ignora linha corrompida em cache
      }
    }

    const isFresh = newestSync !== null && Date.now() - Date.parse(newestSync) < CACHE_TTL_MS;
    return { posts, ultimaSincronizacao: newestSync, isFresh };
  }

  private savePostsToCache(contaId: string, posts: MetaPostMetricItem[], syncedAt: string): void {
    this.db.runInTransaction(() => {
      const stmt = this.db.connection.prepare(
        `
        INSERT INTO meta_posts_cache (media_id, conta_id, payload_json, sincronizado_em)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          conta_id = excluded.conta_id,
          payload_json = excluded.payload_json,
          sincronizado_em = excluded.sincronizado_em;
      `
      );
      for (const post of posts) {
        stmt.run(post.id, contaId, JSON.stringify(post), syncedAt);
      }
    });
  }

  public async getGallery(options: {
    periodo?: MetaGalleryPeriod;
    refresh?: boolean;
    contaId?: string;
    limitePosts?: number;
  } = {}): Promise<MetaGalleryResponse> {
    const periodo: MetaGalleryPeriod =
      options.periodo === "7d" || options.periodo === "28d" || options.periodo === "90d"
        ? options.periodo
        : "30d";
    const apiVersion = resolveMetaGraphApiVersion();
    const creds = resolveMetaCredentials(this.vault, this.nativeStore, options.contaId);
    const cacheAccountKey = creds.accountId ?? options.contaId ?? null;
    const cached = this.readCachedPosts(cacheAccountKey, periodo);

    if (!options.refresh && cached.isFresh && cached.posts.length > 0) {
      return {
        ok: true,
        from_cache: true,
        api_version: apiVersion,
        periodo,
        conta: cacheAccountKey
          ? {
              id: cacheAccountKey,
              username: null,
              name: null,
              followers_count: null,
              follows_count: null,
              media_count: cached.posts.length,
            }
          : null,
        summary: summarizeMetaGalleryPosts(cached.posts),
        posts: cached.posts,
        avisos: [],
        ultima_sincronizacao: cached.ultimaSincronizacao,
      };
    }

    if (!creds.configured || !creds.accessToken || !creds.accountId) {
      return {
        ok: cached.posts.length > 0,
        from_cache: true,
        api_version: apiVersion,
        periodo,
        conta: null,
        summary: summarizeMetaGalleryPosts(cached.posts),
        posts: cached.posts,
        avisos: [
          "Credenciais Instagram / Meta não configuradas no Cofre AES-256-GCM. Configure Access Token e Business Account ID em Integrações / Loja → Instagram.",
        ],
        ultima_sincronizacao: cached.ultimaSincronizacao,
        error_code: "CRV-META-001",
        erro: "Credenciais Meta ausentes no Cofre.",
      };
    }

    try {
      const report = await fetchMetaAccountAndMediaInsights(
        {
          periodo,
          limite_posts: options.limitePosts ?? 24,
          incluir_reels: true,
          conta_id: options.contaId,
        },
        {
          vault: this.vault,
          nativeStore: this.nativeStore,
          fetchImpl: this.fetchImpl,
          apiVersion,
        }
      );

      const syncedAt = new Date().toISOString();
      this.savePostsToCache(report.conta.id || creds.accountId, report.posts, syncedAt);
      const links = this.findEditorialLinks();
      const galleryPosts = report.posts.map((item) =>
        this.mapMetricToGalleryItem(item, syncedAt, links)
      );

      return {
        ok: true,
        from_cache: false,
        api_version: report.api_version,
        periodo,
        conta: report.conta,
        summary: summarizeMetaGalleryPosts(galleryPosts),
        posts: galleryPosts,
        avisos: report.avisos,
        ultima_sincronizacao: syncedAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao consultar métricas Meta Graph API.";
      return {
        ok: cached.posts.length > 0,
        from_cache: true,
        api_version: apiVersion,
        periodo,
        conta: cacheAccountKey
          ? {
              id: cacheAccountKey,
              username: null,
              name: null,
              followers_count: null,
              follows_count: null,
              media_count: cached.posts.length,
            }
          : null,
        summary: summarizeMetaGalleryPosts(cached.posts),
        posts: cached.posts,
        avisos: [
          cached.posts.length > 0
            ? `Falha ao atualizar via Meta API (${msg}). Exibindo último snapshot em cache.`
            : msg,
        ],
        ultima_sincronizacao: cached.ultimaSincronizacao,
        error_code: "CRV-META-002",
        erro: msg,
      };
    }
  }
}
