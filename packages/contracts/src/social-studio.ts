/**
 * Contratos compartilhados do Estúdio Social Media Avançado (Fase 32 — Domínio Próprio Instagram).
 * Mantém separação estrita entre o domínio editorial/social e as rotinas técnicas do daemon.
 */

export type EditorialPostFormato = "feed_4_5" | "carrossel" | "reels" | "story";

export type EditorialPostStatus =
  | "ideia"
  | "rascunho"
  | "em_producao"
  | "aprovacao"
  | "agendado"
  | "publicado";

export interface EditorialSlideItem {
  id: string;
  url: string;
  ordem: number;
  titulo_overlay?: string | null;
  legenda_slide?: string | null;
  aspect_ratio?: "4:5" | "1:1" | "9:16";
}

export interface EditorialPostRecord {
  id: string;
  titulo: string;
  formato: EditorialPostFormato;
  status: EditorialPostStatus;
  pilar: string | null;
  data_agendada: string | null;
  agente_id: string | null;
  tarefa_id: string | null;
  legenda: string;
  slides: EditorialSlideItem[];
  meta_media_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface CreateEditorialPostInput {
  id?: string;
  titulo: string;
  formato?: EditorialPostFormato;
  status?: EditorialPostStatus;
  pilar?: string | null;
  data_agendada?: string | null;
  agente_id?: string | null;
  tarefa_id?: string | null;
  legenda?: string;
  slides?: EditorialSlideItem[];
  meta_media_id?: string | null;
}

export interface UpdateEditorialPostInput {
  titulo?: string;
  formato?: EditorialPostFormato;
  status?: EditorialPostStatus;
  pilar?: string | null;
  data_agendada?: string | null;
  agente_id?: string | null;
  tarefa_id?: string | null;
  legenda?: string;
  slides?: EditorialSlideItem[];
  meta_media_id?: string | null;
}

export interface EditorialPostsFilter {
  mes?: string;
  status?: EditorialPostStatus;
  formato?: EditorialPostFormato;
  pilar?: string;
  busca?: string;
}

export type MetaGalleryPeriod = "7d" | "28d" | "30d" | "90d";

export interface MetaGalleryPostItem {
  id: string;
  caption_resumo: string;
  media_type: string;
  media_product_type: string;
  formato_normalizado: "carrossel" | "reels" | "imagem" | "story";
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
  sincronizado_em?: string;
  editorial_post_id?: string | null;
}

export interface MetaGalleryFormatSummary {
  quantidade: number;
  avg_salvamento_pct: number | null;
  total_saved: number;
  total_reach: number;
  total_views: number;
}

export interface MetaGallerySummary {
  total_posts: number;
  alcance_total: number;
  alcance_medio: number;
  visualizacoes_total: number;
  salvamentos_total: number;
  interacoes_total: number;
  melhor_taxa_salvamento_pct: number | null;
  taxa_salvamento_media_pct: number | null;
  melhor_formato: string | null;
  resumo_por_formato: Record<string, MetaGalleryFormatSummary>;
}

export interface MetaGalleryResponse {
  ok: boolean;
  from_cache: boolean;
  api_version: string;
  periodo: MetaGalleryPeriod;
  conta: {
    id: string;
    username: string | null;
    name: string | null;
    followers_count: number | null;
    follows_count: number | null;
    media_count: number | null;
  } | null;
  summary: MetaGallerySummary;
  posts: MetaGalleryPostItem[];
  avisos: string[];
  ultima_sincronizacao: string | null;
  error_code?: "CRV-META-001" | "CRV-META-002";
  erro?: string | null;
}
