import { randomUUID } from "node:crypto";
import type {
  CommentDmActionLog,
  CommentDmAnalyticsSummary,
  CommentDmApprovalItem,
  CommentDmRule,
  CreateCommentDmRuleInput,
  DryRunSimulationInput,
  DryRunSimulationResult,
  MetaConnectionConfig,
  UpdateCommentDmRuleInput,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { MetaCommentDmEngine } from "./meta-comment-dm-engine.ts";
import { HOURLY_DM_RATE_LIMIT } from "./meta-comment-dm-engine.ts";
import { mapRuleRow, mapSessionRow } from "./meta-comment-dm-helpers.ts";

/**
 * Serviço de gerenciamento de regras, aprovações, logs, analytics e varredura
 * de delays agendados da Automação Comentário -> Direct (Fase 47).
 */
export class MetaCommentDmService {
  private readonly db: CriativoDatabase;
  private readonly engine: MetaCommentDmEngine;
  private readonly wsHub?: WebSocketHub;
  private delayTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(deps: {
    db: CriativoDatabase;
    engine: MetaCommentDmEngine;
    wsHub?: WebSocketHub;
  }) {
    this.db = deps.db;
    this.engine = deps.engine;
    this.wsHub = deps.wsHub;
  }

  public startDelayScheduler(intervalMs = 5_000): void {
    this.dispose();
    this.delayTimer = setInterval(() => {
      void this.processDueScheduledNodes();
    }, Math.max(1_000, intervalMs));
    this.delayTimer.unref?.();
  }

  public dispose(): void {
    if (this.delayTimer) {
      clearInterval(this.delayTimer);
      this.delayTimer = null;
    }
  }

  public listRules(contaId?: string | null): CommentDmRule[] {
    const rows = contaId
      ? (this.db.connection
          .prepare("SELECT * FROM meta_comment_rules WHERE conta_id = ? OR conta_id IS NULL ORDER BY atualizado_em DESC;")
          .all(contaId) as Array<Record<string, unknown>>)
      : (this.db.connection
          .prepare("SELECT * FROM meta_comment_rules ORDER BY atualizado_em DESC;")
          .all() as Array<Record<string, unknown>>);
    return rows.map(mapRuleRow);
  }

  public getRule(ruleId: string): CommentDmRule | null {
    const row = this.db.connection
      .prepare("SELECT * FROM meta_comment_rules WHERE rule_id = ? LIMIT 1;")
      .get(ruleId) as Record<string, unknown> | undefined;
    return row ? mapRuleRow(row) : null;
  }

  public createRule(input: CreateCommentDmRuleInput): CommentDmRule {
    const nome = String(input.nome ?? "").trim();
    if (!nome) throw new Error("Nome da regra é obrigatório.");
    if (!input.opening_message?.text?.trim()) {
      throw new Error("Texto da mensagem inicial de Private Reply é obrigatório.");
    }
    if (!input.opening_message?.button_label?.trim()) {
      throw new Error("Rótulo do botão inicial de abertura 24h é obrigatório.");
    }

    const ruleId = `dmrule-${randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO meta_comment_rules (
           rule_id, conta_id, nome, ativo, match_mode, keywords_json, negative_keywords_json,
           post_scope, target_media_ids_json, include_comment_replies, allow_live_comments,
           reply_once_per_user_per_post, require_human_approval, public_replies_json,
           opening_message_json, flow_nodes_json, crm_tags_json, criado_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        ruleId,
        input.conta_id?.trim() || null,
        nome,
        input.ativo === true ? 1 : 0,
        input.match_mode ?? "contains",
        JSON.stringify(input.keywords ?? []),
        JSON.stringify(input.negative_keywords ?? []),
        input.post_scope ?? "all_posts",
        JSON.stringify(input.target_media_ids ?? []),
        input.include_comment_replies === true ? 1 : 0,
        input.allow_live_comments === true ? 1 : 0,
        input.reply_once_per_user_per_post === false ? 0 : 1,
        input.require_human_approval === true ? 1 : 0,
        JSON.stringify(input.public_replies ?? []),
        JSON.stringify(input.opening_message),
        JSON.stringify(input.flow_nodes ?? []),
        JSON.stringify(input.crm_tags ?? []),
        nowIso,
        nowIso
      );

    const created = this.getRule(ruleId)!;
    this.wsHub?.broadcast("comment_dm:updated", { tipo: "rule_created", rule_id: ruleId });
    return created;
  }

  public updateRule(ruleId: string, patch: UpdateCommentDmRuleInput): CommentDmRule {
    const existing = this.getRule(ruleId);
    if (!existing) throw new Error(`Regra '${ruleId}' não encontrada.`);

    const next: CommentDmRule = {
      ...existing,
      ...patch,
      nome: patch.nome !== undefined ? String(patch.nome).trim() : existing.nome,
      opening_message: patch.opening_message ?? existing.opening_message,
      flow_nodes: patch.flow_nodes ?? existing.flow_nodes,
      keywords: patch.keywords ?? existing.keywords,
      negative_keywords: patch.negative_keywords ?? existing.negative_keywords,
      target_media_ids: patch.target_media_ids ?? existing.target_media_ids,
      public_replies: patch.public_replies ?? existing.public_replies,
      crm_tags: patch.crm_tags ?? existing.crm_tags,
      atualizado_em: new Date().toISOString(),
    };

    this.db.connection
      .prepare(
        `UPDATE meta_comment_rules SET
           conta_id = ?, nome = ?, ativo = ?, match_mode = ?, keywords_json = ?,
           negative_keywords_json = ?, post_scope = ?, target_media_ids_json = ?,
           include_comment_replies = ?, allow_live_comments = ?,
           reply_once_per_user_per_post = ?, require_human_approval = ?,
           public_replies_json = ?, opening_message_json = ?, flow_nodes_json = ?,
           crm_tags_json = ?, atualizado_em = ?
         WHERE rule_id = ?;`
      )
      .run(
        next.conta_id,
        next.nome,
        next.ativo ? 1 : 0,
        next.match_mode,
        JSON.stringify(next.keywords),
        JSON.stringify(next.negative_keywords),
        next.post_scope,
        JSON.stringify(next.target_media_ids),
        next.include_comment_replies ? 1 : 0,
        next.allow_live_comments ? 1 : 0,
        next.reply_once_per_user_per_post ? 1 : 0,
        next.require_human_approval ? 1 : 0,
        JSON.stringify(next.public_replies),
        JSON.stringify(next.opening_message),
        JSON.stringify(next.flow_nodes),
        JSON.stringify(next.crm_tags),
        next.atualizado_em,
        ruleId
      );

    const updated = this.getRule(ruleId)!;
    this.wsHub?.broadcast("comment_dm:updated", { tipo: "rule_updated", rule_id: ruleId });
    return updated;
  }

  public deleteRule(ruleId: string): boolean {
    const res = this.db.connection
      .prepare("DELETE FROM meta_comment_rules WHERE rule_id = ?;")
      .run(ruleId);
    const ok = Number(res.changes ?? 0) > 0;
    if (ok) {
      this.wsHub?.broadcast("comment_dm:updated", { tipo: "rule_deleted", rule_id: ruleId });
    }
    return ok;
  }

  public listApprovals(status: "pending" | "approved" | "rejected" | "all" = "pending"): CommentDmApprovalItem[] {
    const rows =
      status === "all"
        ? (this.db.connection
            .prepare("SELECT * FROM meta_comment_pending_approvals ORDER BY criado_em DESC LIMIT 100;")
            .all() as Array<Record<string, unknown>>)
        : (this.db.connection
            .prepare("SELECT * FROM meta_comment_pending_approvals WHERE status = ? ORDER BY criado_em DESC LIMIT 100;")
            .all(status) as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      approval_id: String(r.approval_id),
      rule_id: String(r.rule_id),
      conta_id: String(r.conta_id),
      comment_id: String(r.comment_id),
      media_id: String(r.media_id),
      sender_ig_id: String(r.sender_ig_id),
      sender_username: r.sender_username ? String(r.sender_username) : null,
      comment_text: String(r.comment_text),
      proposed_public_reply: r.proposed_public_reply ? String(r.proposed_public_reply) : null,
      proposed_dm_text: String(r.proposed_dm_text),
      status: String(r.status) as CommentDmApprovalItem["status"],
      decided_by: r.decided_by ? String(r.decided_by) : null,
      criado_em: String(r.criado_em),
      decided_at: r.decided_at ? String(r.decided_at) : null,
    }));
  }

  public async decideApproval(input: {
    approvalId: string;
    approved: boolean;
    decidedBy?: string;
  }): Promise<{ ok: boolean; status: string; erro?: string }> {
    const row = this.db.connection
      .prepare("SELECT * FROM meta_comment_pending_approvals WHERE approval_id = ? LIMIT 1;")
      .get(input.approvalId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Aprovação '${input.approvalId}' não encontrada.`);
    }
    if (String(row.status) !== "pending") {
      return { ok: false, status: String(row.status), erro: "Aprovação já decidida anteriormente." };
    }

    const nowIso = new Date().toISOString();
    const nextStatus = input.approved ? "approved" : "rejected";
    this.db.connection
      .prepare("UPDATE meta_comment_pending_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE approval_id = ?;")
      .run(nextStatus, input.decidedBy ?? "operador", nowIso, input.approvalId);

    if (!input.approved) {
      this.db.connection
        .prepare("UPDATE meta_comment_receipts SET status = 'rejected' WHERE conta_id = ? AND comment_id = ?;")
        .run(String(row.conta_id), String(row.comment_id));
      this.wsHub?.broadcast("comment_dm:updated", { tipo: "approval_rejected", approval_id: input.approvalId });
      return { ok: true, status: "rejected" };
    }

    const rule = this.getRule(String(row.rule_id));
    if (!rule) {
      return { ok: false, status: "failed", erro: "Regra original não existe mais." };
    }
    const dispatched = await this.engine.dispatchOpeningStage({
      rule,
      contaId: String(row.conta_id),
      commentId: String(row.comment_id),
      mediaId: String(row.media_id),
      senderIgId: String(row.sender_ig_id),
      senderUsername: row.sender_username ? String(row.sender_username) : null,
      commentText: String(row.comment_text),
      livePrivateReplyOnly: row.proposed_public_reply === null,
    });
    return {
      ok: dispatched.handled,
      status: dispatched.outcome,
      erro: dispatched.reason ?? undefined,
    };
  }

  public simulateDryRun(input: DryRunSimulationInput): DryRunSimulationResult {
    const rule = this.getRule(input.rule_id);
    if (!rule) throw new Error(`Regra '${input.rule_id}' não encontrada para simulação.`);
    return this.engine.simulateFlow(rule, input);
  }

  public listLogs(limit = 50, contaId?: string | null): CommentDmActionLog[] {
    const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
    const rows = contaId
      ? (this.db.connection
          .prepare("SELECT * FROM meta_comment_action_logs WHERE conta_id = ? ORDER BY criado_em DESC LIMIT ?;")
          .all(contaId, safeLimit) as Array<Record<string, unknown>>)
      : (this.db.connection
          .prepare("SELECT * FROM meta_comment_action_logs ORDER BY criado_em DESC LIMIT ?;")
          .all(safeLimit) as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      log_id: String(r.log_id),
      conta_id: String(r.conta_id),
      rule_id: r.rule_id ? String(r.rule_id) : null,
      session_id: r.session_id ? String(r.session_id) : null,
      comment_id: r.comment_id ? String(r.comment_id) : null,
      event_kind: String(r.event_kind),
      outcome: String(r.outcome),
      reason: r.reason ? String(r.reason) : null,
      details: (() => {
        try {
          return JSON.parse(String(r.details_json ?? "{}")) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
      criado_em: String(r.criado_em),
    }));
  }

  public getAnalytics(contaId?: string | null): CommentDmAnalyticsSummary {
    const rules = this.listRules(contaId);
    const logs = this.listLogs(200, contaId);
    const skippedByReason: Record<string, number> = {};
    let totalSent = 0;
    let totalSkipped = 0;

    for (const l of logs) {
      if (l.outcome === "sent") totalSent += 1;
      if (l.outcome === "skipped" || l.outcome === "deferred_rate_limit") {
        totalSkipped += 1;
        const key = l.reason || l.outcome;
        skippedByReason[key] = (skippedByReason[key] ?? 0) + 1;
      }
    }

    const totalSessionsRow = this.db.connection
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN window_24h_expires_at IS NOT NULL THEN 1 ELSE 0 END) AS opened FROM meta_dm_flow_sessions;")
      .get() as { total: number; opened: number | null };
    const totalSess = Number(totalSessionsRow.total ?? 0);
    const opened24h = Number(totalSessionsRow.opened ?? 0);

    const pendingRow = this.db.connection
      .prepare("SELECT COUNT(*) AS cnt FROM meta_comment_pending_approvals WHERE status = 'pending';")
      .get() as { cnt: number };

    return {
      conta_id: contaId ?? null,
      total_rules: rules.length,
      active_rules: rules.filter((r) => r.ativo).length,
      total_sent: totalSent,
      total_skipped: totalSkipped,
      skipped_by_reason: skippedByReason,
      window_24h_opened: opened24h,
      window_24h_open_rate_pct: totalSess > 0 ? Math.round((opened24h / totalSess) * 100) : 0,
      hourly_requests_used: this.engine.getHourlyUsage(contaId ?? "principal"),
      hourly_requests_limit: HOURLY_DM_RATE_LIMIT,
      pending_approvals: Number(pendingRow.cnt ?? 0),
    };
  }

  public getConnectionConfig(contaId = "principal"): MetaConnectionConfig {
    const row = this.db.connection
      .prepare("SELECT * FROM meta_comment_connection_config WHERE conta_id = ? LIMIT 1;")
      .get(contaId) as Record<string, unknown> | undefined;
    if (!row) {
      return {
        conta_id: contaId,
        reception_mode: "polling",
        poll_interval_sec: 45,
        relay_channel_id: null,
        relay_verify_token: null,
        relay_enabled: false,
        public_https_domain: null,
        atualizado_em: new Date().toISOString(),
      };
    }
    return {
      conta_id: String(row.conta_id),
      reception_mode: String(row.reception_mode) as MetaConnectionConfig["reception_mode"],
      poll_interval_sec: Number(row.poll_interval_sec ?? 45),
      relay_channel_id: row.relay_channel_id ? String(row.relay_channel_id) : null,
      relay_verify_token: row.relay_verify_token ? String(row.relay_verify_token) : null,
      relay_enabled: Number(row.relay_enabled) === 1,
      public_https_domain: row.public_https_domain ? String(row.public_https_domain) : null,
      atualizado_em: String(row.atualizado_em),
    };
  }

  public saveConnectionConfig(patch: Partial<MetaConnectionConfig> & { conta_id?: string }): MetaConnectionConfig {
    const contaId = patch.conta_id?.trim() || "principal";
    const cur = this.getConnectionConfig(contaId);
    const next: MetaConnectionConfig = {
      ...cur,
      ...patch,
      conta_id: contaId,
      poll_interval_sec: Math.max(15, Math.min(300, Number(patch.poll_interval_sec ?? cur.poll_interval_sec))),
      atualizado_em: new Date().toISOString(),
    };
    this.db.connection
      .prepare(
        `INSERT INTO meta_comment_connection_config (
           conta_id, reception_mode, poll_interval_sec, relay_channel_id,
           relay_verify_token, relay_enabled, public_https_domain, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conta_id) DO UPDATE SET
           reception_mode = excluded.reception_mode,
           poll_interval_sec = excluded.poll_interval_sec,
           relay_channel_id = excluded.relay_channel_id,
           relay_verify_token = excluded.relay_verify_token,
           relay_enabled = excluded.relay_enabled,
           public_https_domain = excluded.public_https_domain,
           atualizado_em = excluded.atualizado_em;`
      )
      .run(
        next.conta_id,
        next.reception_mode,
        next.poll_interval_sec,
        next.relay_channel_id,
        next.relay_verify_token,
        next.relay_enabled ? 1 : 0,
        next.public_https_domain,
        next.atualizado_em
      );
    return next;
  }

  public async processDueScheduledNodes(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const nowIso = new Date().toISOString();
      const dueRows = this.db.connection
        .prepare(
          `SELECT * FROM meta_dm_flow_sessions
           WHERE status = 'waiting_delay' AND next_run_at IS NOT NULL AND next_run_at <= ?
           LIMIT 25;`
        )
        .all(nowIso) as Array<Record<string, unknown>>;

      let count = 0;
      for (const raw of dueRows) {
        const session = mapSessionRow(raw);
        const rule = this.getRule(session.rule_id);
        if (!rule) continue;
        session.status = "running";
        session.next_run_at = null;
        await this.engine.runFlowFromCurrentNode(session, rule);
        count += 1;
      }
      return count;
    } finally {
      this.sweeping = false;
    }
  }
}
