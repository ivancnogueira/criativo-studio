import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MetaGalleryPeriod,
  MetaGalleryPostItem,
  MetaGalleryResponse,
} from "@criativo/contracts";
import {
  BarChart3,
  Bookmark,
  ExternalLink,
  Eye,
  Film,
  Heart,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageCircle,
  Plug,
  RefreshCw,
  Share2,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

export interface PublishedGalleryMetricsPageProps {
  onOpenInstagramConfig: () => void;
  onAnalyzeWithAgent: (prompt: string) => void;
}

type SortKey = "recent" | "reach" | "saved" | "save_rate";
type FormatFilter = "todos" | "carrossel" | "reels" | "imagem";

function formatNumberPt(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  return val.toLocaleString("pt-BR");
}

function formatDatePt(iso: string | null): string {
  if (!iso) return "Data indisponível";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatBadgeMeta(fmt: MetaGalleryPostItem["formato_normalizado"]) {
  switch (fmt) {
    case "carrossel":
      return { label: "Carrossel", className: "bg-[#31CF76]/20 text-[#31CF76]", Icon: Layers };
    case "reels":
      return { label: "Reels", className: "bg-[#D97757]/20 text-[#F4A286]", Icon: Film };
    case "story":
      return { label: "Story", className: "bg-[#FDCB6E]/20 text-[#FDCB6E]", Icon: ImageIcon };
    default:
      return { label: "Imagem", className: "bg-[#42A0FF]/20 text-[#42A0FF]", Icon: ImageIcon };
  }
}

export const PublishedGalleryMetricsPage: React.FC<PublishedGalleryMetricsPageProps> = ({
  onOpenInstagramConfig,
  onAnalyzeWithAgent,
}) => {
  const [periodo, setPeriodo] = useState<MetaGalleryPeriod>("30d");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MetaGalleryResponse | null>(null);

  const loadGallery = useCallback(async (targetPeriod: MetaGalleryPeriod, refresh: boolean) => {
    if (refresh) {
      setSyncing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await daemonApi.getInstagramMetricsGallery({
        periodo: targetPeriod,
        refresh,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao consultar galeria de métricas.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void loadGallery(periodo, false);
  }, [periodo, loadGallery]);

  const visiblePosts = useMemo(() => {
    const raw = data?.posts ?? [];
    const filtered =
      formatFilter === "todos" ? raw : raw.filter((p) => p.formato_normalizado === formatFilter);

    return [...filtered].sort((a, b) => {
      if (sortKey === "reach") return (b.reach ?? -1) - (a.reach ?? -1);
      if (sortKey === "saved") return (b.saved ?? -1) - (a.saved ?? -1);
      if (sortKey === "save_rate") {
        return (b.taxa_salvamento_pct ?? -1) - (a.taxa_salvamento_pct ?? -1);
      }
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return tb - ta;
    });
  }, [data?.posts, formatFilter, sortKey]);

  const handleAnalyzePost = (post: MetaGalleryPostItem) => {
    const summaryPrompt = [
      `Analise este post publicado no Instagram (${post.formato_normalizado.toUpperCase()}) e crie 3 variações de gancho e estrutura para superar os resultados atuais:`,
      `- Resumo da legenda: "${post.caption_resumo || "Sem legenda"}"`,
      `- Alcance: ${post.reach ?? "N/D"} · Visualizações: ${post.views ?? "N/D"}`,
      `- Curtidas: ${post.likes ?? "N/D"} · Comentários: ${post.comments ?? "N/D"}`,
      `- Salvamentos: ${post.saved ?? "N/D"} · Taxa de salvamento: ${post.taxa_salvamento_pct ?? "N/D"}%`,
      `- Compartilhamentos: ${post.shares ?? "N/D"}`,
    ].join("\n");
    onAnalyzeWithAgent(summaryPrompt);
  };

  const summary = data?.summary;
  const missingCredentials = data?.error_code === "CRV-META-001" && (data?.posts.length ?? 0) === 0;

  return (
    <section
      aria-label="Galeria de Posts Publicados com Métricas Meta"
      className="flex-1 h-full overflow-y-auto bg-[#0D0D0D] p-6 text-[#F0F0F0]"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Cabeçalho */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[#31CF76]" />
              <h1 className="text-2xl font-semibold text-white">
                Galeria & Métricas Instagram
              </h1>
            </div>
            <p className="mt-1 text-xs text-[#979797]">
              Performance real por post via Meta Graph API{" "}
              {data?.api_version ? `(${data.api_version})` : ""}
              {data?.conta?.username ? ` · @${data.conta.username}` : ""}
              {data?.from_cache ? " · Cache local SQLite" : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#141414] p-1">
              {(["7d", "28d", "30d", "90d"] as MetaGalleryPeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriodo(p)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                    periodo === p ? "bg-[#242424] text-white" : "text-[#979797] hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={syncing}
              onClick={() => void loadGallery(periodo, true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#31CF76] px-3.5 py-2 text-xs font-semibold text-[#0D0D0D] hover:bg-[#3CE084] disabled:opacity-60"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>Sincronizar Meta API</span>
            </button>
          </div>
        </header>

        {/* Barra de 4 KPIs do Período */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.06] bg-[#141414] p-4">
            <p className="text-[11.5px] text-[#979797]">Alcance Total ({periodo})</p>
            <p className="mt-1 text-2xl font-semibold text-white tabular-nums">
              {formatNumberPt(summary?.alcance_total ?? 0)}
            </p>
            <p className="mt-1 text-[11px] text-[#6A6A6A]">
              Média por post: {formatNumberPt(summary?.alcance_medio ?? 0)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#141414] p-4">
            <p className="text-[11.5px] text-[#979797]">Salvamentos Totais</p>
            <p className="mt-1 text-2xl font-semibold text-[#31CF76] tabular-nums">
              {formatNumberPt(summary?.salvamentos_total ?? 0)}
            </p>
            <p className="mt-1 text-[11px] text-[#6A6A6A]">
              Interações totais: {formatNumberPt(summary?.interacoes_total ?? 0)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#141414] p-4">
            <p className="text-[11.5px] text-[#979797]">Taxa Média de Salvamento</p>
            <p className="mt-1 text-2xl font-semibold text-[#42A0FF] tabular-nums">
              {summary?.taxa_salvamento_media_pct !== null && summary?.taxa_salvamento_media_pct !== undefined
                ? `${summary.taxa_salvamento_media_pct}%`
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-[#6A6A6A]">
              Melhor taxa:{" "}
              {summary?.melhor_taxa_salvamento_pct !== null && summary?.melhor_taxa_salvamento_pct !== undefined
                ? `${summary.melhor_taxa_salvamento_pct}%`
                : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#141414] p-4">
            <p className="text-[11.5px] text-[#979797]">Formato Vencedor</p>
            <p className="mt-1 flex items-center gap-2 text-2xl font-semibold capitalize text-white">
              <TrendingUp className="h-5 w-5 text-[#FDCB6E]" />
              <span>{summary?.melhor_formato ?? "—"}</span>
            </p>
            <p className="mt-1 text-[11px] text-[#6A6A6A]">
              Posts analisados: {summary?.total_posts ?? 0}
            </p>
          </div>
        </div>

        {/* Avisos / Erro */}
        {error && (
          <div className="rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-4 py-3 text-xs text-[#FF8A90]">
            {error}
          </div>
        )}
        {data?.avisos && data.avisos.length > 0 && !missingCredentials && (
          <div className="rounded-xl border border-[#FF9412]/30 bg-[#FF9412]/10 px-4 py-2.5 text-xs text-[#FDCB6E]">
            {data.avisos[0]}
          </div>
        )}

        {/* Estado Vazio Orientativo quando Conta Meta não configurada */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-[#141414] py-16 text-xs text-[#979797]">
            <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
            <span>Carregando galeria de métricas do Instagram...</span>
          </div>
        ) : missingCredentials ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-[#141414] px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#212121] text-[#42A0FF]">
              <Plug className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-white">
              Conecte sua conta Instagram / Meta para ver métricas reais
            </h2>
            <p className="max-w-lg text-xs leading-relaxed text-[#979797]">
              Configure seu Access Token e Business Account ID com segurança no Cofre AES-256-GCM para sincronizar alcance, salvamentos, retenção de Reels e gerar variações vencedoras com seus Criativos.
            </p>
            <button
              type="button"
              onClick={onOpenInstagramConfig}
              className="mt-1 inline-flex items-center gap-2 rounded-xl bg-[#42A0FF] px-4 py-2 text-xs font-semibold text-[#0D0D0D] hover:bg-[#66B2FF]"
            >
              <Plug className="h-3.5 w-3.5" />
              <span>Abrir Integrações → Instagram / Meta</span>
            </button>
          </div>
        ) : (
          <>
            {/* Barra de filtros e ordenação da grade */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                {(["todos", "carrossel", "reels", "imagem"] as FormatFilter[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormatFilter(fmt)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      formatFilter === fmt
                        ? "bg-[#242424] text-white"
                        : "bg-[#141414] text-[#979797] hover:text-white"
                    }`}
                  >
                    {fmt === "todos" ? "Todos" : fmt}
                  </button>
                ))}
              </div>

              <div className="w-56">
                <CarbonSelect<SortKey>
                  ariaLabel="Ordenar posts da galeria"
                  value={sortKey}
                  onChange={setSortKey}
                  options={[
                    { value: "recent", label: "Mais recentes" },
                    { value: "reach", label: "Maior alcance" },
                    { value: "saved", label: "Mais salvos" },
                    { value: "save_rate", label: "Maior taxa de salvamento" },
                  ]}
                />
              </div>
            </div>

            {visiblePosts.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-[#141414] py-12 text-center text-xs text-[#979797]">
                Nenhum post encontrado para o período e filtro selecionados.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visiblePosts.map((post) => {
                  const badge = formatBadgeMeta(post.formato_normalizado);
                  const BadgeIcon = badge.Icon;
                  return (
                    <article
                      key={post.id}
                      className="flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141414] transition-colors hover:border-white/20"
                    >
                      <div>
                        {/* Cabeçalho visual estilo card Instagram */}
                        <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#181818] px-3.5 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${badge.className}`}>
                            <BadgeIcon className="h-3 w-3" />
                            {badge.label}
                          </span>
                          <span className="text-[10.5px] text-[#979797]">
                            {formatDatePt(post.timestamp)}
                          </span>
                        </div>

                        <div className="p-3.5 space-y-3">
                          <p className="line-clamp-3 min-h-[48px] text-xs leading-relaxed text-[#DCDCDC]">
                            {post.caption_resumo || "Post publicado sem legenda resumida."}
                          </p>

                          {/* Grade compacta com as 5 métricas Meta */}
                          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.05] bg-[#101010] p-2.5 text-center">
                            <div>
                              <p className="flex items-center justify-center gap-1 text-[10px] text-[#979797]">
                                <Eye className="h-3 w-3 text-[#42A0FF]" />
                                Alcance
                              </p>
                              <p className="mt-0.5 text-xs font-semibold text-white tabular-nums">
                                {formatNumberPt(post.reach)}
                              </p>
                            </div>
                            <div>
                              <p className="flex items-center justify-center gap-1 text-[10px] text-[#979797]">
                                <Bookmark className="h-3 w-3 text-[#31CF76]" />
                                Salvos
                              </p>
                              <p className="mt-0.5 text-xs font-semibold text-[#31CF76] tabular-nums">
                                {formatNumberPt(post.saved)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[#979797]">Taxa Salv.</p>
                              <p className="mt-0.5 text-xs font-semibold text-[#FDCB6E] tabular-nums">
                                {post.taxa_salvamento_pct !== null ? `${post.taxa_salvamento_pct}%` : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="flex items-center justify-center gap-1 text-[10px] text-[#979797]">
                                <Heart className="h-3 w-3 text-[#FD2F3B]" />
                                Curtidas
                              </p>
                              <p className="mt-0.5 text-xs font-medium text-[#DCDCDC] tabular-nums">
                                {formatNumberPt(post.likes)}
                              </p>
                            </div>
                            <div>
                              <p className="flex items-center justify-center gap-1 text-[10px] text-[#979797]">
                                <MessageCircle className="h-3 w-3" />
                                Coment.
                              </p>
                              <p className="mt-0.5 text-xs font-medium text-[#DCDCDC] tabular-nums">
                                {formatNumberPt(post.comments)}
                              </p>
                            </div>
                            <div>
                              <p className="flex items-center justify-center gap-1 text-[10px] text-[#979797]">
                                <Share2 className="h-3 w-3" />
                                Compart.
                              </p>
                              <p className="mt-0.5 text-xs font-medium text-[#DCDCDC] tabular-nums">
                                {formatNumberPt(post.shares)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Ações do Card */}
                      <div className="flex items-center gap-2 border-t border-white/[0.06] bg-[#111111] px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleAnalyzePost(post)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#212121] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2B2B2B]"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-[#31CF76]" />
                          <span>Analisar com Criativo</span>
                        </button>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir publicação"
                            className="rounded-xl border border-white/10 p-1.5 text-[#979797] hover:bg-[#212121] hover:text-white"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
