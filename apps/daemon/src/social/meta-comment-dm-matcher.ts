import type { CommentDmRule } from "@criativo/contracts";

export interface IncomingCommentEvent {
  contaId: string;
  commentId: string;
  mediaId: string;
  mediaCreatedAt?: string | null;
  parentId?: string | null;
  senderIgId: string;
  senderUsername?: string | null;
  text: string;
  timestamp: string;
  isLive?: boolean;
  sourceMode: "polling" | "direct_webhook" | "painel_relay" | "dry_run";
}

export interface CommentMatchEvaluation {
  matched: boolean;
  rule: CommentDmRule | null;
  skipReason: string | null;
  isCommentReply: boolean;
  livePrivateReplyOnly: boolean;
}

export function normalizeTriggerText(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function detectIsCommentReply(event: Pick<IncomingCommentEvent, "parentId" | "mediaId">): boolean {
  const parent = event.parentId?.trim();
  if (!parent) return false;
  return parent !== event.mediaId.trim();
}

function matchesScope(rule: CommentDmRule, event: IncomingCommentEvent): boolean {
  if (rule.post_scope === "specific_posts") {
    return rule.target_media_ids.includes(event.mediaId);
  }
  if (rule.post_scope === "future_posts_only") {
    if (!event.mediaCreatedAt) return false;
    return Date.parse(event.mediaCreatedAt) >= Date.parse(rule.criado_em);
  }
  return true;
}

function matchesKeywords(rule: CommentDmRule, normalizedText: string): boolean {
  if (rule.match_mode === "any") {
    return normalizedText.length > 0;
  }
  const cleanKeywords = rule.keywords
    .map(normalizeTriggerText)
    .filter((k) => k.length > 0);
  if (cleanKeywords.length === 0) return false;

  if (rule.match_mode === "exact") {
    return cleanKeywords.some((k) => normalizedText === k);
  }
  return cleanKeywords.some((k) => normalizedText.includes(k));
}

function matchesNegativeKeyword(rule: CommentDmRule, normalizedText: string): boolean {
  return rule.negative_keywords
    .map(normalizeTriggerText)
    .filter((k) => k.length > 0)
    .some((neg) => normalizedText.includes(neg));
}

/**
 * Avalia regras ordenadas para um comentário normalizado, protegendo conta, respostas,
 * lives, exclusões negativas e escopo de mídia.
 */
export function evaluateCommentTrigger(
  event: IncomingCommentEvent,
  rules: CommentDmRule[],
  options?: { ignoreInactive?: boolean }
): CommentMatchEvaluation {
  const isCommentReply = detectIsCommentReply(event);
  const normalizedText = normalizeTriggerText(event.text);
  let lastReason: string | null = "no_rule_matched";

  const scopedRules = rules.filter((r) => {
    if (options?.ignoreInactive !== true && !r.ativo) return false;
    if (r.conta_id && r.conta_id.trim() !== event.contaId.trim()) return false;
    return true;
  });

  if (scopedRules.length === 0) {
    return {
      matched: false,
      rule: null,
      skipReason: "no_active_rule_for_account",
      isCommentReply,
      livePrivateReplyOnly: false,
    };
  }

  for (const rule of scopedRules) {
    if (isCommentReply && !rule.include_comment_replies) {
      lastReason = "comment_reply_ignored";
      continue;
    }
    if (event.isLive && !rule.allow_live_comments) {
      lastReason = "live_comment_disabled";
      continue;
    }
    if (!matchesScope(rule, event)) {
      lastReason = "media_out_of_scope";
      continue;
    }
    if (matchesNegativeKeyword(rule, normalizedText)) {
      lastReason = "negative_keyword_matched";
      continue;
    }
    if (!matchesKeywords(rule, normalizedText)) {
      lastReason = "keyword_not_matched";
      continue;
    }

    return {
      matched: true,
      rule,
      skipReason: null,
      isCommentReply,
      livePrivateReplyOnly: Boolean(event.isLive),
    };
  }

  return {
    matched: false,
    rule: null,
    skipReason: lastReason,
    isCommentReply,
    livePrivateReplyOnly: false,
  };
}
