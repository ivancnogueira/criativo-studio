/**
 * Contratos compartilhados do Estúdio Social Media Avançado (Fase 32 — Domínio Próprio Instagram).
 * Mantém separação estrita entre o domínio editorial/social e as rotinas técnicas do daemon.
 */

export type EditorialPostFormato = "feed_4_5" | "carrossel" | "reels" | "story";

export type MetaTrialGraduationStrategy = "MANUAL" | "SS_PERFORMANCE";

export type MetaFirstCommentStatus =
  | "pending_approval"
  | "scheduled"
  | "processing"
  | "posted"
  | "failed"
  | "cancelled";

export type MetaMediaAuditAction =
  | "publish"
  | "trial_reel"
  | "first_comment"
  | "delete_media"
  | "cache_remove";

export type MetaMediaAuditOutcome =
  | "success"
  | "deleted_remote"
  | "unsupported_by_meta_api"
  | "blocked"
  | "failed";

export interface MetaTrialEligibilityResult {
  ok: boolean;
  eligible: boolean;
  followers_count: number | null;
  min_followers: number;
  username: string | null;
  account_type: string | null;
  reason: string;
  error_code?: string;
}

export interface MetaFirstCommentRecord {
  comment_job_id: string;
  media_id: string;
  editorial_post_id: string | null;
  conta_id: string | null;
  comment_text: string;
  delay_seconds: number;
  scheduled_for: string;
  approved_by_human: boolean;
  approved_at: string | null;
  status: MetaFirstCommentStatus;
  meta_comment_id: string | null;
  attempts: number;
  last_error: string | null;
  criado_em: string;
  atualizado_em: string;
  posted_em: string | null;
}

export interface MetaMediaAuditLogRecord {
  audit_id: string;
  media_id: string;
  editorial_post_id: string | null;
  conta_id: string | null;
  action: MetaMediaAuditAction;
  actor_label: string;
  confirmed_by_human: boolean;
  http_status: number | null;
  graph_error_code: string | null;
  outcome: MetaMediaAuditOutcome;
  reason: string;
  detail_json: string;
  criado_em: string;
}

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
  trial_reel_enabled?: boolean;
  trial_graduation_strategy?: MetaTrialGraduationStrategy;
  primeiro_comentario?: string | null;
  primeiro_comentario_aprovado?: boolean;
  primeiro_comentario_delay_seg?: number;
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
  trial_reel_enabled?: boolean;
  trial_graduation_strategy?: MetaTrialGraduationStrategy;
  primeiro_comentario?: string | null;
  primeiro_comentario_aprovado?: boolean;
  primeiro_comentario_delay_seg?: number;
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
  trial_reel_enabled?: boolean;
  trial_graduation_strategy?: MetaTrialGraduationStrategy;
  primeiro_comentario?: string | null;
  primeiro_comentario_aprovado?: boolean;
  primeiro_comentario_delay_seg?: number;
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
  skip_rate_3s_pct?: number | null;
  hook_retention_3s_pct?: number | null;
  reposts?: number | null;
  sincronizado_em?: string;
  editorial_post_id?: string | null;
}

export interface MetaGalleryFormatSummary {
  quantidade: number;
  avg_salvamento_pct: number | null;
  total_saved: number;
  total_reach: number;
  total_views: number;
  avg_skip_rate_3s_pct?: number | null;
  total_reposts?: number;
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
  reposts_total?: number;
  skip_rate_3s_medio_pct?: number | null;
  retencao_3s_media_pct?: number | null;
  melhor_gancho_skip_rate_pct?: number | null;
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

export type MetaPostingIntelligencePeriod = "30d" | "90d" | "all";
export type MetaPostingConfidence = "alta" | "media" | "baixa";

export interface MetaPostingHourBucket {
  dia_semana: number;
  dia_label: string;
  hora: number;
  faixa_label: string;
  quantidade_posts: number;
  reach_medio: number;
  views_medio: number;
  taxa_salvamento_media_pct: number | null;
  skip_rate_3s_medio_pct: number | null;
  reposts_total: number;
  score_medio: number;
  confianca: MetaPostingConfidence;
}

export interface MetaChampionFormatItem {
  formato: "carrossel" | "reels" | "imagem" | "story";
  editorial_formato: EditorialPostFormato;
  quantidade: number;
  reach_medio: number;
  views_medio: number;
  taxa_salvamento_media_pct: number | null;
  avg_skip_rate_3s_pct: number | null;
  total_reposts: number;
  score_medio: number;
  campeao: boolean;
  motivo_destaque: string;
}

export interface MetaPostingRecommendationItem {
  id: string;
  tipo: "melhor_horario" | "formato_campeao" | "alerta_gancho" | "amostra";
  titulo: string;
  justificativa: string;
}

export interface MetaNextSuggestedSlot {
  data_agendada: string;
  dia_label: string;
  hora_sugerida: string;
  formato_recomendado: EditorialPostFormato;
  motivo: string;
}

export interface MetaPostingIntelligenceReport {
  ok: true;
  periodo: MetaPostingIntelligencePeriod;
  timezone: string;
  total_posts_analisados: number;
  amostra_insuficiente: boolean;
  resumo_retencao: {
    total_reels_com_skip_rate: number;
    avg_skip_rate_3s_pct: number | null;
    avg_hook_retention_3s_pct: number | null;
    total_reposts: number;
  };
  melhores_horarios: MetaPostingHourBucket[];
  heatmap_horarios: MetaPostingHourBucket[];
  formatos_campeoes: MetaChampionFormatItem[];
  proximo_slot_sugerido: MetaNextSuggestedSlot | null;
  recomendacoes: MetaPostingRecommendationItem[];
  ultima_sincronizacao: string | null;
}
