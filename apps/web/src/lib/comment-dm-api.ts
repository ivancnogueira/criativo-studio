import type {
  CommentDmActionLog,
  CommentDmAnalyticsSummary,
  CommentDmApprovalItem,
  CommentDmRule,
  CreateCommentDmRuleInput,
  DeliverableSourceType,
  DryRunSimulationInput,
  DryRunSimulationResult,
  MetaConnectionConfig,
  PublicDeliverableRecord,
  UpdateCommentDmRuleInput,
} from "@criativo/contracts";
import { requestJson } from "../services/http-client";

export interface PublishDeliverablePayload {
  titulo: string;
  descricao?: string;
  slug?: string;
  source_type: DeliverableSourceType;
  local_file_path?: string | null;
  html_content?: string | null;
  external_https_url?: string | null;
  public_base_url?: string | null;
  github_owner?: string | null;
  github_repo?: string | null;
  github_branch?: string | null;
  github_token?: string | null;
}

export const commentDmApi = {
  async listRules(contaId?: string): Promise<CommentDmRule[]> {
    const q = contaId ? `?conta_id=${encodeURIComponent(contaId)}` : "";
    const res = await requestJson<{ rules: CommentDmRule[] }>(`/api/instagram/comment-dm/rules${q}`);
    return res.rules ?? [];
  },

  async createRule(input: CreateCommentDmRuleInput): Promise<CommentDmRule> {
    const res = await requestJson<{ rule: CommentDmRule }>("/api/instagram/comment-dm/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.rule;
  },

  async updateRule(ruleId: string, patch: UpdateCommentDmRuleInput): Promise<CommentDmRule> {
    const res = await requestJson<{ rule: CommentDmRule }>(
      `/api/instagram/comment-dm/rules/${encodeURIComponent(ruleId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return res.rule;
  },

  async deleteRule(ruleId: string): Promise<void> {
    await requestJson(`/api/instagram/comment-dm/rules/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
    });
  },

  async simulate(input: DryRunSimulationInput): Promise<DryRunSimulationResult> {
    const res = await requestJson<{ result: DryRunSimulationResult }>("/api/instagram/comment-dm/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.result;
  },

  async listApprovals(status: "pending" | "approved" | "rejected" | "all" = "pending"): Promise<CommentDmApprovalItem[]> {
    const res = await requestJson<{ approvals: CommentDmApprovalItem[] }>(
      `/api/instagram/comment-dm/approvals?status=${encodeURIComponent(status)}`
    );
    return res.approvals ?? [];
  },

  async decideApproval(approvalId: string, approved: boolean): Promise<{ ok: boolean; status: string; erro?: string }> {
    return await requestJson(`/api/instagram/comment-dm/approvals/${encodeURIComponent(approvalId)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
  },

  async listLogs(limit = 60, contaId?: string): Promise<CommentDmActionLog[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (contaId) params.set("conta_id", contaId);
    const res = await requestJson<{ logs: CommentDmActionLog[] }>(
      `/api/instagram/comment-dm/logs?${params.toString()}`
    );
    return res.logs ?? [];
  },

  async getAnalytics(contaId?: string): Promise<CommentDmAnalyticsSummary> {
    const q = contaId ? `?conta_id=${encodeURIComponent(contaId)}` : "";
    const res = await requestJson<{ analytics: CommentDmAnalyticsSummary }>(
      `/api/instagram/comment-dm/analytics${q}`
    );
    return res.analytics;
  },

  async getConnectionConfig(contaId = "principal"): Promise<MetaConnectionConfig> {
    const res = await requestJson<{ config: MetaConnectionConfig }>(
      `/api/instagram/comment-dm/connection-mode?conta_id=${encodeURIComponent(contaId)}`
    );
    return res.config;
  },

  async updateConnectionConfig(
    patch: Partial<MetaConnectionConfig> & { conta_id?: string }
  ): Promise<MetaConnectionConfig> {
    const res = await requestJson<{ config: MetaConnectionConfig }>(
      "/api/instagram/comment-dm/connection-mode",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return res.config;
  },

  async provisionPainelRelay(input: {
    painel_base_url: string;
    license_key?: string;
    conta_id?: string;
    verify_token?: string;
  }): Promise<{ ok: boolean; channel_id?: string; verify_token?: string; webhook_url?: string; erro?: string }> {
    return await requestJson("/api/instagram/comment-dm/relay/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async listDeliverables(): Promise<PublicDeliverableRecord[]> {
    const res = await requestJson<{ deliverables: PublicDeliverableRecord[] }>("/api/instagram/deliverables");
    return res.deliverables ?? [];
  },

  async publishDeliverable(payload: PublishDeliverablePayload): Promise<PublicDeliverableRecord> {
    const res = await requestJson<{ deliverable: PublicDeliverableRecord }>(
      "/api/instagram/deliverables/publish",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return res.deliverable;
  },

  async deleteDeliverable(deliverableId: string): Promise<void> {
    await requestJson(`/api/instagram/deliverables/${encodeURIComponent(deliverableId)}`, {
      method: "DELETE",
    });
  },
};
