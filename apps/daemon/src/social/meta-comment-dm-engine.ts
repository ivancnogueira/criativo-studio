import { randomUUID } from "node:crypto";
import type {
  CommentDmActionLog,
  CommentDmButton,
  CommentDmFlowNode,
  CommentDmRule,
  CommentDmSession,
  DryRunSimulationInput,
  DryRunSimulationResult,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { MetaCommentDmClient } from "./meta-comment-dm-client.ts";
import {
  currentHourBucketUtc,
  isValidEmailInput,
  isValidWhatsappInput,
  mapRuleRow,
  mapSessionRow,
  pickRandomMessage,
  simulateCommentDmFlow,
} from "./meta-comment-dm-helpers.ts";
import { evaluateCommentTrigger, type IncomingCommentEvent } from "./meta-comment-dm-matcher.ts";

export { currentHourBucketUtc, isValidEmailInput, isValidWhatsappInput, mapRuleRow, mapSessionRow };

export const HOURLY_DM_RATE_LIMIT = 200;
const COMMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DM_24H_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface IncomingDmEvent {
  contaId: string;
  senderIgId: string;
  senderUsername?: string | null;
  text?: string | null;
  postbackPayload?: string | null;
  quickReplyPayload?: string | null;
  isEcho?: boolean;
  metadata?: string | null;
  timestamp: string;
}

export interface DeliverableResolveHooks {
  resolveSafeDeliverableUrl: (input: {
    deliverableId?: string | null;
    explicitUrl?: string | null;
  }) => { ok: boolean; url?: string; title?: string; erro?: string };
}

export interface CrmAndHandoffHooks {
  syncLead?: (input: {
    contaId: string;
    igUserId: string;
    igUsername?: string | null;
    email?: string | null;
    phoneWhatsapp?: string | null;
    freeText?: string | null;
    tags: string[];
    ruleName: string;
    commentText?: string;
  }) => Promise<void> | void;
  triggerWorkflow?: (input: {
    workflowId: string;
    session: CommentDmSession;
    rule: CommentDmRule;
  }) => Promise<{ ok: boolean; erro?: string }>;
  handoffToAgent?: (input: {
    agentId: string;
    greeting?: string | null;
    session: CommentDmSession;
    rule: CommentDmRule;
    incomingText?: string | null;
  }) => Promise<{ ok: boolean; replyText?: string | null; erro?: string }>;
}

/** Motor determinístico, idempotente e auditável de Automação Comentário -> Direct (Fase 47). */
export class MetaCommentDmEngine {
  private readonly db: CriativoDatabase;
  private readonly client: MetaCommentDmClient;
  private readonly wsHub?: WebSocketHub;
  private deliverableHooks?: DeliverableResolveHooks;
  private crmHooks?: CrmAndHandoffHooks;

  constructor(deps: {
    db: CriativoDatabase;
    client: MetaCommentDmClient;
    wsHub?: WebSocketHub;
    deliverableHooks?: DeliverableResolveHooks;
    crmHooks?: CrmAndHandoffHooks;
  }) {
    this.db = deps.db;
    this.client = deps.client;
    this.wsHub = deps.wsHub;
    this.deliverableHooks = deps.deliverableHooks;
    this.crmHooks = deps.crmHooks;
  }

  public attachDeliverableHooks(hooks: DeliverableResolveHooks): void {
    this.deliverableHooks = hooks;
  }

  public attachCrmHooks(hooks: CrmAndHandoffHooks): void {
    this.crmHooks = hooks;
  }

  public consumeRateQuota(contaId: string): { allowed: boolean; used: number; limit: number } {
    const bucket = currentHourBucketUtc();
    const nowIso = new Date().toISOString();
    const row = this.db.connection
      .prepare("SELECT request_count FROM meta_comment_rate_buckets WHERE conta_id = ? AND hour_bucket_utc = ? LIMIT 1;")
      .get(contaId, bucket) as { request_count: number } | undefined;
    const used = Number(row?.request_count ?? 0);
    if (used >= HOURLY_DM_RATE_LIMIT) {
      return { allowed: false, used, limit: HOURLY_DM_RATE_LIMIT };
    }
    this.db.connection
      .prepare(
        `INSERT INTO meta_comment_rate_buckets (conta_id, hour_bucket_utc, request_count, atualizado_em)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(conta_id, hour_bucket_utc) DO UPDATE SET
           request_count = meta_comment_rate_buckets.request_count + 1,
           atualizado_em = excluded.atualizado_em;`
      )
      .run(contaId, bucket, nowIso);
    return { allowed: true, used: used + 1, limit: HOURLY_DM_RATE_LIMIT };
  }

  public getHourlyUsage(contaId: string): number {
    const row = this.db.connection
      .prepare("SELECT request_count FROM meta_comment_rate_buckets WHERE conta_id = ? AND hour_bucket_utc = ? LIMIT 1;")
      .get(contaId, currentHourBucketUtc()) as { request_count: number } | undefined;
    return Number(row?.request_count ?? 0);
  }

  public logAction(input: Omit<CommentDmActionLog, "log_id" | "criado_em">): void {
    this.db.connection
      .prepare(
        `INSERT INTO meta_comment_action_logs (
           log_id, conta_id, rule_id, session_id, comment_id, event_kind, outcome, reason, details_json, criado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        `cdlog-${randomUUID().slice(0, 12)}`,
        input.conta_id,
        input.rule_id,
        input.session_id,
        input.comment_id,
        input.event_kind,
        input.outcome,
        input.reason,
        JSON.stringify(input.details ?? {}),
        new Date().toISOString()
      );
  }

  public listActiveRules(): CommentDmRule[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM meta_comment_rules WHERE ativo = 1 ORDER BY atualizado_em DESC;")
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapRuleRow);
  }

  public async handleIncomingComment(event: IncomingCommentEvent): Promise<{
    handled: boolean;
    outcome: string;
    sessionId?: string | null;
    reason?: string | null;
  }> {
    const commentMs = Date.parse(event.timestamp);
    if (Number.isFinite(commentMs) && Date.now() - commentMs > COMMENT_WINDOW_MS) {
      this.logAction({
        conta_id: event.contaId,
        rule_id: null,
        session_id: null,
        comment_id: event.commentId,
        event_kind: "comment",
        outcome: "skipped",
        reason: "comment_older_than_7d",
        details: { timestamp: event.timestamp },
      });
      return { handled: false, outcome: "skipped", reason: "comment_older_than_7d" };
    }

    const receiptRes = this.db.connection
      .prepare(
        `INSERT OR IGNORE INTO meta_comment_receipts (
           receipt_id, conta_id, comment_id, media_id, sender_ig_id, rule_id, source_mode, status, created_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'received', ?);`
      )
      .run(
        `rcpt-${randomUUID().slice(0, 12)}`,
        event.contaId,
        event.commentId,
        event.mediaId,
        event.senderIgId,
        event.sourceMode,
        new Date().toISOString()
      );
    if (Number(receiptRes.changes ?? 0) === 0) {
      return { handled: false, outcome: "skipped", reason: "duplicate_comment_id" };
    }

    const evaluation = evaluateCommentTrigger(event, this.listActiveRules());
    if (!evaluation.matched || !evaluation.rule) {
      this.updateReceiptStatus(event.contaId, event.commentId, "skipped", null);
      this.logAction({
        conta_id: event.contaId,
        rule_id: null,
        session_id: null,
        comment_id: event.commentId,
        event_kind: "comment",
        outcome: "skipped",
        reason: evaluation.skipReason,
        details: { text: event.text.slice(0, 120), isCommentReply: evaluation.isCommentReply },
      });
      return { handled: false, outcome: "skipped", reason: evaluation.skipReason };
    }

    const rule = evaluation.rule;
    if (rule.reply_once_per_user_per_post) {
      const prior = this.db.connection
        .prepare(
          `SELECT receipt_id FROM meta_comment_receipts
           WHERE conta_id = ? AND media_id = ? AND sender_ig_id = ?
             AND comment_id <> ? AND status IN ('sent', 'pending_approval') LIMIT 1;`
        )
        .get(event.contaId, event.mediaId, event.senderIgId, event.commentId);
      if (prior) {
        this.updateReceiptStatus(event.contaId, event.commentId, "skipped", rule.rule_id);
        this.logAction({
          conta_id: event.contaId,
          rule_id: rule.rule_id,
          session_id: null,
          comment_id: event.commentId,
          event_kind: "comment",
          outcome: "skipped",
          reason: "already_replied_user_in_post",
          details: { mediaId: event.mediaId, senderIgId: event.senderIgId },
        });
        return { handled: false, outcome: "skipped", reason: "already_replied_user_in_post" };
      }
    }

    if (rule.require_human_approval) {
      const approvalId = `cdapr-${randomUUID().slice(0, 12)}`;
      const publicReply = evaluation.livePrivateReplyOnly ? null : pickRandomMessage(rule.public_replies, "") || null;
      this.db.connection
        .prepare(
          `INSERT INTO meta_comment_pending_approvals (
             approval_id, rule_id, conta_id, comment_id, media_id, sender_ig_id,
             sender_username, comment_text, proposed_public_reply, proposed_dm_text,
             status, decided_by, criado_em, decided_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL);`
        )
        .run(
          approvalId,
          rule.rule_id,
          event.contaId,
          event.commentId,
          event.mediaId,
          event.senderIgId,
          event.senderUsername ?? null,
          event.text,
          publicReply,
          rule.opening_message.text,
          new Date().toISOString()
        );
      this.updateReceiptStatus(event.contaId, event.commentId, "pending_approval", rule.rule_id);
      this.logAction({
        conta_id: event.contaId,
        rule_id: rule.rule_id,
        session_id: null,
        comment_id: event.commentId,
        event_kind: "comment",
        outcome: "pending_approval",
        reason: "human_approval_required",
        details: { approvalId },
      });
      this.wsHub?.broadcast("comment_dm:updated", { tipo: "approval_pending", approval_id: approvalId, rule_id: rule.rule_id });
      return { handled: true, outcome: "pending_approval" };
    }

    return await this.dispatchOpeningStage({
      rule,
      contaId: event.contaId,
      commentId: event.commentId,
      mediaId: event.mediaId,
      senderIgId: event.senderIgId,
      senderUsername: event.senderUsername ?? null,
      commentText: event.text,
      livePrivateReplyOnly: evaluation.livePrivateReplyOnly,
    });
  }

  public async dispatchOpeningStage(input: {
    rule: CommentDmRule;
    contaId: string;
    commentId: string;
    mediaId: string;
    senderIgId: string;
    senderUsername: string | null;
    commentText: string;
    livePrivateReplyOnly: boolean;
  }): Promise<{ handled: boolean; outcome: string; sessionId?: string | null; reason?: string | null }> {
    const quota = this.consumeRateQuota(input.contaId);
    if (!quota.allowed) {
      this.logAction({
        conta_id: input.contaId,
        rule_id: input.rule.rule_id,
        session_id: null,
        comment_id: input.commentId,
        event_kind: "private_reply",
        outcome: "deferred_rate_limit",
        reason: "hourly_limit_200_reached",
        details: quota,
      });
      return { handled: false, outcome: "deferred_rate_limit", reason: "hourly_limit_200_reached" };
    }

    const sessionId = `dmsess-${randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    const btnPayload = input.rule.opening_message.button_payload?.trim() || `dm_open:${sessionId}`;

    const dmRes = await this.client.sendPrivateReply({
      contaId: input.contaId,
      commentId: input.commentId,
      payload: {
        text: input.rule.opening_message.text,
        ...(input.rule.opening_message.quick_reply_mode
          ? { quickReplies: [{ title: input.rule.opening_message.button_label, payload: btnPayload }] }
          : {
              buttons: [{ id: "open", label: input.rule.opening_message.button_label, kind: "postback", payload: btnPayload }],
            }),
        metadataTag: `criativo_dm:${sessionId}:opening`,
      },
    });

    if (!dmRes.ok) {
      this.updateReceiptStatus(input.contaId, input.commentId, "failed", input.rule.rule_id);
      this.logAction({
        conta_id: input.contaId,
        rule_id: input.rule.rule_id,
        session_id: null,
        comment_id: input.commentId,
        event_kind: "private_reply",
        outcome: "failed",
        reason: dmRes.erro ?? "meta_send_failed",
        details: { endpoint: dmRes.endpointUsed, httpStatus: dmRes.httpStatus },
      });
      return { handled: false, outcome: "failed", reason: dmRes.erro ?? "meta_send_failed" };
    }

    const firstNodeId = input.rule.opening_message.next_node_id ?? input.rule.flow_nodes[0]?.node_id ?? null;
    this.db.connection
      .prepare(
        `INSERT INTO meta_dm_flow_sessions (
           session_id, rule_id, conta_id, comment_id, media_id, ig_user_id, ig_username,
           anchor_spent, window_24h_expires_at, current_node_id, waiting_for,
           collected_data_json, next_run_at, status, criado_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, '{}', NULL, 'awaiting_postback', ?, ?);`
      )
      .run(sessionId, input.rule.rule_id, input.contaId, input.commentId, input.mediaId, input.senderIgId, input.senderUsername, firstNodeId, btnPayload, nowIso, nowIso);

    if (!input.livePrivateReplyOnly) {
      const publicReply = pickRandomMessage(input.rule.public_replies, "");
      if (publicReply) {
        await this.client.sendPublicCommentReply({ contaId: input.contaId, commentId: input.commentId, messageText: publicReply });
      }
    }

    if (input.rule.crm_tags.length > 0 && this.crmHooks?.syncLead) {
      await Promise.resolve(
        this.crmHooks.syncLead({
          contaId: input.contaId,
          igUserId: input.senderIgId,
          igUsername: input.senderUsername,
          tags: input.rule.crm_tags,
          ruleName: input.rule.nome,
          commentText: input.commentText,
        })
      );
    }

    this.updateReceiptStatus(input.contaId, input.commentId, "sent", input.rule.rule_id);
    this.logAction({
      conta_id: input.contaId,
      rule_id: input.rule.rule_id,
      session_id: sessionId,
      comment_id: input.commentId,
      event_kind: "private_reply",
      outcome: "sent",
      reason: null,
      details: { endpoint: dmRes.endpointUsed, messageId: dmRes.messageId },
    });
    this.wsHub?.broadcast("comment_dm:updated", { tipo: "session_started", session_id: sessionId });
    return { handled: true, outcome: "sent", sessionId };
  }

  public async handleIncomingDmInteraction(event: IncomingDmEvent): Promise<{ handled: boolean; outcome: string; sessionId?: string | null }> {
    if (event.isEcho || (event.metadata && event.metadata.startsWith("criativo_dm:"))) {
      return { handled: false, outcome: "ignored_echo" };
    }
    const row = this.db.connection
      .prepare(
        `SELECT * FROM meta_dm_flow_sessions
         WHERE conta_id = ? AND ig_user_id = ?
           AND status IN ('awaiting_postback', 'waiting_input', 'waiting_delay', 'running', 'handed_off')
         ORDER BY atualizado_em DESC LIMIT 1;`
      )
      .get(event.contaId, event.senderIgId) as Record<string, unknown> | undefined;
    if (!row) return { handled: false, outcome: "no_active_session" };

    const session = mapSessionRow(row);
    const rule = this.getRuleById(session.rule_id);
    if (!rule) return { handled: false, outcome: "rule_not_found", sessionId: session.session_id };

    session.window_24h_expires_at = new Date(Date.now() + DM_24H_WINDOW_MS).toISOString();
    this.updateSession(session);

    const payloadToken = (event.postbackPayload ?? event.quickReplyPayload ?? "").trim();

    if (session.status === "handed_off" && session.waiting_for?.startsWith("agent:") && this.crmHooks?.handoffToAgent) {
      const res = await this.crmHooks.handoffToAgent({
        agentId: session.waiting_for.slice("agent:".length),
        session,
        rule,
        incomingText: event.text ?? payloadToken,
      });
      return { handled: res.ok, outcome: res.ok ? "handoff_replied" : (res.erro ?? "handoff_failed"), sessionId: session.session_id };
    }

    if (session.status === "waiting_input") {
      const currentNode = rule.flow_nodes.find((n) => n.node_id === session.current_node_id);
      const userAnswer = (event.text ?? "").trim();
      const kind = currentNode?.input_kind ?? "text";
      const valid =
        kind === "email"
          ? isValidEmailInput(userAnswer)
          : kind === "phone_whatsapp"
            ? isValidWhatsappInput(userAnswer)
            : userAnswer.length > 0;
      if (!valid) {
        await this.sendSafe24hText(session, currentNode?.invalid_retry_text?.trim() || "Formato inválido. Por favor, envie novamente:");
        return { handled: true, outcome: "input_retry_requested", sessionId: session.session_id };
      }
      session.collected_data[kind] = userAnswer;
      if (this.crmHooks?.syncLead) {
        await Promise.resolve(
          this.crmHooks.syncLead({
            contaId: session.conta_id,
            igUserId: session.ig_user_id,
            igUsername: event.senderUsername ?? session.ig_username,
            email: kind === "email" ? userAnswer : undefined,
            phoneWhatsapp: kind === "phone_whatsapp" ? userAnswer : undefined,
            freeText: kind === "text" ? userAnswer : undefined,
            tags: [...rule.crm_tags, ...(currentNode?.crm_tags ?? [])],
            ruleName: rule.nome,
          })
        );
      }
      session.current_node_id = currentNode?.next_node_id ?? this.findSequentialNextId(rule.flow_nodes, currentNode?.node_id);
      session.waiting_for = null;
      session.status = "running";
      this.updateSession(session);
      return await this.runFlowFromCurrentNode(session, rule);
    }

    if (session.status === "awaiting_postback" || payloadToken.startsWith("branch:")) {
      if (payloadToken.startsWith("branch:")) {
        const [, nodeId, btnId] = payloadToken.split(":");
        const branchNode = rule.flow_nodes.find((n) => n.node_id === nodeId);
        const picked = branchNode?.buttons?.find((b) => b.id === btnId);
        session.current_node_id = picked?.target_node_id ?? branchNode?.next_node_id ?? null;
      }
      session.waiting_for = null;
      session.status = "running";
      this.updateSession(session);
      return await this.runFlowFromCurrentNode(session, rule);
    }

    return { handled: true, outcome: "window_24h_refreshed", sessionId: session.session_id };
  }

  public async runFlowFromCurrentNode(session: CommentDmSession, rule: CommentDmRule): Promise<{ handled: boolean; outcome: string; sessionId: string }> {
    if (!session.window_24h_expires_at || Date.parse(session.window_24h_expires_at) <= Date.now()) {
      session.status = "expired";
      this.updateSession(session);
      return { handled: false, outcome: "window_24h_closed", sessionId: session.session_id };
    }

    let guard = 0;
    while (session.current_node_id && guard < 30) {
      guard += 1;
      const node = rule.flow_nodes.find((n) => n.node_id === session.current_node_id);
      if (!node) break;

      if (node.type === "delay") {
        const delayMs = Math.max(1, Math.min(3600, Number(node.delay_seconds ?? 5))) * 1000;
        session.next_run_at = new Date(Date.now() + delayMs).toISOString();
        session.status = "waiting_delay";
        session.current_node_id = this.resolveNextNodeId(rule.flow_nodes, node);
        this.updateSession(session);
        return { handled: true, outcome: "scheduled_delay", sessionId: session.session_id };
      }
      if (node.type === "collect_input") {
        await this.sendSafe24hText(session, node.prompt_text?.trim() || "Por favor, informe seus dados:");
        session.status = "waiting_input";
        session.waiting_for = node.input_kind ?? "text";
        this.updateSession(session);
        return { handled: true, outcome: "waiting_input", sessionId: session.session_id };
      }
      if (node.type === "branch_buttons") {
        const buttons = (node.buttons ?? []).slice(0, 3).map((b) => ({
          ...b,
          payload: b.kind === "postback" ? `branch:${node.node_id}:${b.id}` : b.payload,
        }));
        await this.sendSafe24hText(session, node.branch_prompt?.trim() || "Escolha uma opção:", buttons);
        session.status = "waiting_input";
        session.waiting_for = `branch:${node.node_id}`;
        this.updateSession(session);
        return { handled: true, outcome: "waiting_branch", sessionId: session.session_id };
      }
      if (node.type === "send_message") {
        const msg = pickRandomMessage(node.messages ?? [], "");
        if (msg) await this.sendSafe24hText(session, msg);
      } else if (node.type === "send_deliverable_card") {
        await this.executeDeliverableCardNode(session, rule, node);
      } else if (node.type === "trigger_workflow" && node.workflow_id && this.crmHooks?.triggerWorkflow) {
        await this.crmHooks.triggerWorkflow({ workflowId: node.workflow_id, session, rule });
      } else if (node.type === "handoff_agent" && node.handoff_agent_id) {
        session.status = "handed_off";
        session.waiting_for = `agent:${node.handoff_agent_id}`;
        session.current_node_id = null;
        this.updateSession(session);
        await this.crmHooks?.handoffToAgent?.({ agentId: node.handoff_agent_id, greeting: node.handoff_greeting, session, rule, incomingText: null });
        return { handled: true, outcome: "handed_off", sessionId: session.session_id };
      }
      session.current_node_id = this.resolveNextNodeId(rule.flow_nodes, node);
    }

    session.status = "completed";
    session.current_node_id = null;
    this.updateSession(session);
    return { handled: true, outcome: "flow_completed", sessionId: session.session_id };
  }

  public simulateFlow(rule: CommentDmRule, input: DryRunSimulationInput): DryRunSimulationResult {
    return simulateCommentDmFlow(rule, input);
  }

  private async executeDeliverableCardNode(session: CommentDmSession, rule: CommentDmRule, node: CommentDmFlowNode): Promise<void> {
    const resolved = this.deliverableHooks?.resolveSafeDeliverableUrl({
      deliverableId: node.deliverable_id,
      explicitUrl: node.deliverable_url,
    }) ?? { ok: Boolean(node.deliverable_url?.startsWith("https://")), url: node.deliverable_url ?? undefined, title: node.card_title };

    if (!resolved.ok || !resolved.url) {
      this.logAction({
        conta_id: session.conta_id,
        rule_id: rule.rule_id,
        session_id: session.session_id,
        comment_id: session.comment_id,
        event_kind: "deliverable_card",
        outcome: "blocked",
        reason: resolved.erro ?? "unsafe_or_missing_https_url",
        details: { nodeId: node.node_id },
      });
      return;
    }
    const text = [node.card_title || resolved.title || "Material liberado", node.card_subtitle].filter(Boolean).join("\n");
    await this.sendSafe24hText(session, text, [
      { id: "dl", kind: "web_url", label: node.button_text?.slice(0, 20) || "Acessar Material", url: resolved.url },
    ]);
  }

  private async sendSafe24hText(session: CommentDmSession, text: string, buttons?: CommentDmButton[]): Promise<void> {
    const quota = this.consumeRateQuota(session.conta_id);
    if (!quota.allowed) {
      this.logAction({
        conta_id: session.conta_id,
        rule_id: session.rule_id,
        session_id: session.session_id,
        comment_id: session.comment_id,
        event_kind: "dm_24h",
        outcome: "deferred_rate_limit",
        reason: "hourly_limit_200_reached",
        details: quota,
      });
      return;
    }
    await this.client.sendWindowDm({
      contaId: session.conta_id,
      recipientIgUserId: session.ig_user_id,
      payload: { text, buttons, metadataTag: `criativo_dm:${session.session_id}:${session.current_node_id ?? "step"}` },
    });
  }

  private resolveNextNodeId(nodes: CommentDmFlowNode[], current: CommentDmFlowNode): string | null {
    return current.next_node_id !== undefined ? current.next_node_id || null : this.findSequentialNextId(nodes, current.node_id);
  }

  private findSequentialNextId(nodes: CommentDmFlowNode[], currentId?: string | null): string | null {
    if (!currentId) return null;
    const idx = nodes.findIndex((n) => n.node_id === currentId);
    return idx < 0 || idx + 1 >= nodes.length ? null : nodes[idx + 1]!.node_id;
  }

  private updateReceiptStatus(contaId: string, commentId: string, status: string, ruleId: string | null): void {
    this.db.connection
      .prepare("UPDATE meta_comment_receipts SET status = ?, rule_id = COALESCE(?, rule_id) WHERE conta_id = ? AND comment_id = ?;")
      .run(status, ruleId, contaId, commentId);
  }

  private getRuleById(ruleId: string): CommentDmRule | null {
    const row = this.db.connection.prepare("SELECT * FROM meta_comment_rules WHERE rule_id = ? LIMIT 1;").get(ruleId) as Record<string, unknown> | undefined;
    return row ? mapRuleRow(row) : null;
  }

  private updateSession(session: CommentDmSession): void {
    session.atualizado_em = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE meta_dm_flow_sessions
         SET window_24h_expires_at = ?, current_node_id = ?, waiting_for = ?,
             collected_data_json = ?, next_run_at = ?, status = ?, atualizado_em = ?
         WHERE session_id = ?;`
      )
      .run(
        session.window_24h_expires_at,
        session.current_node_id,
        session.waiting_for,
        JSON.stringify(session.collected_data),
        session.next_run_at,
        session.status,
        session.atualizado_em,
        session.session_id
      );
  }
}
