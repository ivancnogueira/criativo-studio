/**
 * Contratos compartilhados da Fase 47: Automação Comentário -> Direct (Instagram),
 * Motor de Fluxos Multi-Etapa (estilo ManyChat), 3 Modos de Recepção e Entregáveis Públicos HTTPS.
 */

export type CommentTriggerMatchMode = "exact" | "contains" | "any";

export type CommentRuleScope = "all_posts" | "specific_posts" | "future_posts_only";

export type DmFlowNodeType =
  | "send_message"
  | "delay"
  | "collect_input"
  | "branch_buttons"
  | "send_deliverable_card"
  | "trigger_workflow"
  | "handoff_agent";

export type DmCollectInputKind = "email" | "phone_whatsapp" | "text";

export type MetaReceptionMode = "polling" | "direct_webhook" | "painel_relay";

export type DeliverableSourceType = "github_pages" | "showcase_https" | "external_https";

export type CommentDmApprovalStatus = "pending" | "approved" | "rejected";

export type CommentDmSessionStatus =
  | "awaiting_postback"
  | "running"
  | "waiting_input"
  | "waiting_delay"
  | "completed"
  | "handed_off"
  | "expired"
  | "failed";

export interface CommentDmButton {
  id: string;
  label: string;
  kind: "postback" | "web_url";
  payload?: string;
  url?: string;
  target_node_id?: string | null;
}

export interface CommentDmOpeningMessage {
  text: string;
  button_label: string;
  button_payload?: string;
  quick_reply_mode?: boolean;
  next_node_id?: string | null;
}

export interface CommentDmFlowNode {
  node_id: string;
  type: DmFlowNodeType;
  label?: string;
  next_node_id?: string | null;
  // send_message
  messages?: string[];
  // delay
  delay_seconds?: number;
  // collect_input
  input_kind?: DmCollectInputKind;
  prompt_text?: string;
  invalid_retry_text?: string;
  crm_tags?: string[];
  // branch_buttons
  branch_prompt?: string;
  buttons?: CommentDmButton[];
  // send_deliverable_card
  deliverable_id?: string | null;
  deliverable_url?: string | null;
  card_title?: string;
  card_subtitle?: string;
  button_text?: string;
  // trigger_workflow
  workflow_id?: string | null;
  // handoff_agent
  handoff_agent_id?: string | null;
  handoff_greeting?: string | null;
}

export interface CommentDmRule {
  rule_id: string;
  conta_id: string | null;
  nome: string;
  ativo: boolean;
  match_mode: CommentTriggerMatchMode;
  keywords: string[];
  negative_keywords: string[];
  post_scope: CommentRuleScope;
  target_media_ids: string[];
  include_comment_replies: boolean;
  allow_live_comments: boolean;
  reply_once_per_user_per_post: boolean;
  require_human_approval: boolean;
  public_replies: string[];
  opening_message: CommentDmOpeningMessage;
  flow_nodes: CommentDmFlowNode[];
  crm_tags: string[];
  criado_em: string;
  atualizado_em: string;
}

export interface CreateCommentDmRuleInput {
  conta_id?: string | null;
  nome: string;
  ativo?: boolean;
  match_mode: CommentTriggerMatchMode;
  keywords?: string[];
  negative_keywords?: string[];
  post_scope: CommentRuleScope;
  target_media_ids?: string[];
  include_comment_replies?: boolean;
  allow_live_comments?: boolean;
  reply_once_per_user_per_post?: boolean;
  require_human_approval?: boolean;
  public_replies?: string[];
  opening_message: CommentDmOpeningMessage;
  flow_nodes?: CommentDmFlowNode[];
  crm_tags?: string[];
}

export type UpdateCommentDmRuleInput = Partial<CreateCommentDmRuleInput>;

export interface CommentDmSession {
  session_id: string;
  rule_id: string;
  conta_id: string;
  comment_id: string;
  media_id: string;
  ig_user_id: string;
  ig_username: string | null;
  anchor_spent: boolean;
  window_24h_expires_at: string | null;
  current_node_id: string | null;
  waiting_for: string | null;
  collected_data: Record<string, string>;
  next_run_at: string | null;
  status: CommentDmSessionStatus;
  criado_em: string;
  atualizado_em: string;
}

export interface CommentDmApprovalItem {
  approval_id: string;
  rule_id: string;
  conta_id: string;
  comment_id: string;
  media_id: string;
  sender_ig_id: string;
  sender_username: string | null;
  comment_text: string;
  proposed_public_reply: string | null;
  proposed_dm_text: string;
  status: CommentDmApprovalStatus;
  decided_by: string | null;
  criado_em: string;
  decided_at: string | null;
}

export interface CommentDmActionLog {
  log_id: string;
  conta_id: string;
  rule_id: string | null;
  session_id: string | null;
  comment_id: string | null;
  event_kind: string;
  outcome: string;
  reason: string | null;
  details: Record<string, unknown>;
  criado_em: string;
}

export interface CommentDmAnalyticsSummary {
  conta_id: string | null;
  total_rules: number;
  active_rules: number;
  total_sent: number;
  total_skipped: number;
  skipped_by_reason: Record<string, number>;
  window_24h_opened: number;
  window_24h_open_rate_pct: number;
  hourly_requests_used: number;
  hourly_requests_limit: number;
  pending_approvals: number;
}

export interface PublicDeliverableRecord {
  deliverable_id: string;
  slug: string;
  titulo: string;
  descricao: string;
  source_type: DeliverableSourceType;
  public_https_url: string;
  local_artifact_path: string | null;
  agente_id: string | null;
  github_repo: string | null;
  github_commit_sha: string | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface MetaConnectionConfig {
  conta_id: string;
  reception_mode: MetaReceptionMode;
  poll_interval_sec: number;
  relay_channel_id: string | null;
  relay_verify_token: string | null;
  relay_enabled: boolean;
  public_https_domain: string | null;
  atualizado_em: string;
}

export interface DryRunSimulationInput {
  rule_id: string;
  comment_text: string;
  sender_username?: string;
  media_id?: string;
  is_comment_reply?: boolean;
  is_live_comment?: boolean;
  simulated_button_clicks?: string[];
  simulated_inputs?: string[];
}

export interface DryRunTraceStep {
  step: number;
  stage: string;
  window_required: "7d_private_reply" | "24h_dm_open" | "public_reply" | "system";
  window_open: boolean;
  description: string;
  payload_preview?: Record<string, unknown>;
}

export interface DryRunSimulationResult {
  matched: boolean;
  rule_id: string;
  rule_name: string;
  skip_reason: string | null;
  requires_human_approval: boolean;
  public_reply_preview: string | null;
  opening_dm_preview: CommentDmOpeningMessage | null;
  trace: DryRunTraceStep[];
}
