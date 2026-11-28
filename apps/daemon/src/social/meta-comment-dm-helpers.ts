import type {
  CommentDmRule,
  CommentDmSession,
  DryRunSimulationInput,
  DryRunSimulationResult,
  DryRunTraceStep,
} from "@criativo/contracts";
import { evaluateCommentTrigger } from "./meta-comment-dm-matcher.ts";

export function currentHourBucketUtc(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

export function isValidEmailInput(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export function isValidWhatsappInput(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function pickRandomMessage(items: string[], fallback = ""): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return fallback;
  return clean[Math.floor(Math.random() * clean.length)]!;
}

export function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapRuleRow(row: Record<string, unknown>): CommentDmRule {
  return {
    rule_id: String(row.rule_id),
    conta_id: row.conta_id ? String(row.conta_id) : null,
    nome: String(row.nome),
    ativo: Number(row.ativo) === 1,
    match_mode: String(row.match_mode) as CommentDmRule["match_mode"],
    keywords: safeJsonParse(row.keywords_json, []),
    negative_keywords: safeJsonParse(row.negative_keywords_json, []),
    post_scope: String(row.post_scope) as CommentDmRule["post_scope"],
    target_media_ids: safeJsonParse(row.target_media_ids_json, []),
    include_comment_replies: Number(row.include_comment_replies) === 1,
    allow_live_comments: Number(row.allow_live_comments) === 1,
    reply_once_per_user_per_post: Number(row.reply_once_per_user_per_post) === 1,
    require_human_approval: Number(row.require_human_approval) === 1,
    public_replies: safeJsonParse(row.public_replies_json, []),
    opening_message: safeJsonParse(row.opening_message_json, {
      text: "",
      button_label: "Quero receber",
    }),
    flow_nodes: safeJsonParse(row.flow_nodes_json, []),
    crm_tags: safeJsonParse(row.crm_tags_json, []),
    criado_em: String(row.criado_em),
    atualizado_em: String(row.atualizado_em),
  };
}

export function mapSessionRow(row: Record<string, unknown>): CommentDmSession {
  return {
    session_id: String(row.session_id),
    rule_id: String(row.rule_id),
    conta_id: String(row.conta_id),
    comment_id: String(row.comment_id),
    media_id: String(row.media_id),
    ig_user_id: String(row.ig_user_id),
    ig_username: row.ig_username ? String(row.ig_username) : null,
    anchor_spent: Number(row.anchor_spent) === 1,
    window_24h_expires_at: row.window_24h_expires_at ? String(row.window_24h_expires_at) : null,
    current_node_id: row.current_node_id ? String(row.current_node_id) : null,
    waiting_for: row.waiting_for ? String(row.waiting_for) : null,
    collected_data: safeJsonParse(row.collected_data_json, {}),
    next_run_at: row.next_run_at ? String(row.next_run_at) : null,
    status: String(row.status) as CommentDmSession["status"],
    criado_em: String(row.criado_em),
    atualizado_em: String(row.atualizado_em),
  };
}

export function simulateCommentDmFlow(
  rule: CommentDmRule,
  input: DryRunSimulationInput
): DryRunSimulationResult {
  const evalRes = evaluateCommentTrigger(
    {
      contaId: rule.conta_id ?? "sim-conta",
      commentId: "sim-comment-1",
      mediaId: input.media_id?.trim() || rule.target_media_ids[0] || "sim-media-1",
      mediaCreatedAt: new Date().toISOString(),
      parentId: input.is_comment_reply ? "sim-parent-comment" : null,
      senderIgId: "sim-user-1",
      senderUsername: input.sender_username ?? "@seguidor_exemplo",
      text: input.comment_text,
      timestamp: new Date().toISOString(),
      isLive: Boolean(input.is_live_comment),
      sourceMode: "dry_run",
    },
    [rule],
    { ignoreInactive: true }
  );

  if (!evalRes.matched) {
    return {
      matched: false,
      rule_id: rule.rule_id,
      rule_name: rule.nome,
      skip_reason: evalRes.skipReason,
      requires_human_approval: rule.require_human_approval,
      public_reply_preview: null,
      opening_dm_preview: null,
      trace: [
        {
          step: 1,
          stage: "trigger_evaluation",
          window_required: "system",
          window_open: true,
          description: `Regra não disparada: ${evalRes.skipReason}`,
        },
      ],
    };
  }

  const publicReplyPreview = evalRes.livePrivateReplyOnly
    ? null
    : pickRandomMessage(rule.public_replies, "") || null;
  const trace: DryRunTraceStep[] = [];
  let stepNum = 1;

  if (publicReplyPreview) {
    trace.push({
      step: stepNum++,
      stage: "public_reply",
      window_required: "public_reply",
      window_open: true,
      description: `Resposta pública no comentário: "${publicReplyPreview}"`,
    });
  }

  trace.push({
    step: stepNum++,
    stage: "opening_private_reply",
    window_required: "7d_private_reply",
    window_open: true,
    description: `Etapa 1 (Private Reply · âncora comment_id): "${rule.opening_message.text}" [Botão: ${rule.opening_message.button_label}]`,
  });

  const clickedOpening =
    (input.simulated_button_clicks ?? []).length > 0 || (input.simulated_inputs ?? []).length > 0;
  if (!clickedOpening) {
    trace.push({
      step: stepNum++,
      stage: "awaiting_24h_open",
      window_required: "24h_dm_open",
      window_open: false,
      description:
        "Fluxo pausado aguardando clique no botão pelo seguidor para abrir a janela de 24h.",
    });
  } else {
    trace.push({
      step: stepNum++,
      stage: "window_24h_opened",
      window_required: "24h_dm_open",
      window_open: true,
      description: "Seguidor clicou no botão CTA — janela oficial de 24h aberta.",
    });
    for (const node of rule.flow_nodes) {
      trace.push({
        step: stepNum++,
        stage: node.type,
        window_required: "24h_dm_open",
        window_open: true,
        description: `Bloco '${node.type}' (${node.label || node.node_id}) executado dentro da janela de 24h.`,
      });
    }
  }

  return {
    matched: true,
    rule_id: rule.rule_id,
    rule_name: rule.nome,
    skip_reason: null,
    requires_human_approval: rule.require_human_approval,
    public_reply_preview: publicReplyPreview,
    opening_dm_preview: rule.opening_message,
    trace,
  };
}
