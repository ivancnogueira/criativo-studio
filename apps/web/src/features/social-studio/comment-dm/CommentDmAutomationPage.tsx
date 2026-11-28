import React, { useCallback, useEffect, useState } from "react";
import type {
  AgenteRegistro,
  CommentDmActionLog,
  CommentDmAnalyticsSummary,
  CommentDmApprovalItem,
  CommentDmRule,
  CreateCommentDmRuleInput,
  MetaConnectionConfig,
  PublicDeliverableRecord,
  WorkflowVisual,
} from "@criativo/contracts";
import {
  Activity,
  CheckCircle2,
  FlaskConical,
  Link2,
  Package,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useI18n } from "../../../i18n/I18nContext";
import { commentDmApi } from "../../../lib/comment-dm-api";
import { CommentDmConnectionAndSimulator } from "./CommentDmConnectionAndSimulator";
import { CommentDmDeliverablesPanel } from "./CommentDmDeliverablesPanel";
import { CommentDmRuleEditorModal } from "./CommentDmRuleEditorModal";

type InnerTab = "rules" | "deliverables" | "connection" | "simulator" | "approvals";

export interface CommentDmAutomationPageProps {
  agentes: AgenteRegistro[];
  workflows: WorkflowVisual[];
  onOpenInstagramConfig?: () => void;
}

export const CommentDmAutomationPage: React.FC<CommentDmAutomationPageProps> = ({
  agentes,
  workflows,
  onOpenInstagramConfig,
}) => {
  const { t } = useI18n();
  const [innerTab, setInnerTab] = useState<InnerTab>("rules");
  const [rules, setRules] = useState<CommentDmRule[]>([]);
  const [deliverables, setDeliverables] = useState<PublicDeliverableRecord[]>([]);
  const [approvals, setApprovals] = useState<CommentDmApprovalItem[]>([]);
  const [logs, setLogs] = useState<CommentDmActionLog[]>([]);
  const [analytics, setAnalytics] = useState<CommentDmAnalyticsSummary | null>(null);
  const [connConfig, setConnConfig] = useState<MetaConnectionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<CommentDmRule | "new" | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [r, d, a, l, an, cfg] = await Promise.all([
        commentDmApi.listRules().catch(() => []),
        commentDmApi.listDeliverables().catch(() => []),
        commentDmApi.listApprovals("pending").catch(() => []),
        commentDmApi.listLogs(60).catch(() => []),
        commentDmApi.getAnalytics().catch(() => null),
        commentDmApi.getConnectionConfig().catch(() => null),
      ]);
      setRules(r);
      setDeliverables(d);
      setApprovals(a);
      setLogs(l);
      setAnalytics(an);
      setConnConfig(cfg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveRule = async (payload: CreateCommentDmRuleInput, ruleId?: string) => {
    if (ruleId) {
      await commentDmApi.updateRule(ruleId, payload);
    } else {
      await commentDmApi.createRule(payload);
    }
    setEditingRule(null);
    await loadAll();
  };

  const handleToggleRule = async (rule: CommentDmRule) => {
    await commentDmApi.updateRule(rule.rule_id, { ativo: !rule.ativo });
    await loadAll();
  };

  const handleDeleteRule = async (ruleId: string) => {
    await commentDmApi.deleteRule(ruleId);
    await loadAll();
  };

  const handleDecideApproval = async (approvalId: string, approved: boolean) => {
    await commentDmApi.decideApproval(approvalId, approved);
    await loadAll();
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-[#121212] p-6 text-white">
      <div className="max-w-6xl w-full mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{t("commentDm.title")}</h1>
              <span className="rounded-md bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-300">
                {t("automations.betaBadge")}
              </span>
            </div>
            <p className="text-xs text-neutral-400">{t("commentDm.betaNotice")}</p>
          </div>

          <div className="flex items-center gap-2">
            {onOpenInstagramConfig && (
              <button
                type="button"
                onClick={onOpenInstagramConfig}
                className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-xs text-neutral-200 hover:bg-white/[0.08]"
              >
                Credenciais Meta
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadAll()}
              className="rounded-lg border border-white/15 bg-white/[0.04] p-2 text-neutral-300 hover:bg-white/[0.08]"
              title="Atualizar dados"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setEditingRule("new")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#31CF76] px-3.5 py-2 text-xs font-semibold text-[#08120C] hover:brightness-105"
            >
              <Plus className="h-4 w-4" />
              Nova Automação
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-[#181818] p-3.5">
            <div className="text-[11px] text-neutral-400">DMs Enviadas</div>
            <div className="mt-1 text-xl font-semibold text-[#31CF76]">{analytics?.total_sent ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#181818] p-3.5">
            <div className="text-[11px] text-neutral-400">Abertura Janela 24h</div>
            <div className="mt-1 text-xl font-semibold text-[#42A0FF]">
              {analytics?.window_24h_open_rate_pct ?? 0}% ({analytics?.window_24h_opened ?? 0})
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#181818] p-3.5">
            <div className="text-[11px] text-neutral-400">Cota Horária Meta</div>
            <div className="mt-1 text-xl font-semibold text-white">
              {analytics?.hourly_requests_used ?? 0} / {analytics?.hourly_requests_limit ?? 200}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#181818] p-3.5">
            <div className="text-[11px] text-neutral-400">Puladas / Aprovações</div>
            <div className="mt-1 text-xl font-semibold text-amber-300">
              {analytics?.total_skipped ?? 0} / {approvals.length} pend.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-2">
          {[
            { id: "rules" as const, label: t("commentDm.tab.rules"), Icon: Sparkles },
            { id: "deliverables" as const, label: t("commentDm.tab.deliverables"), Icon: Package },
            { id: "connection" as const, label: t("commentDm.tab.connection"), Icon: Link2 },
            { id: "simulator" as const, label: t("commentDm.tab.simulator"), Icon: FlaskConical },
            { id: "approvals" as const, label: `${t("commentDm.tab.approvalsLogs")} (${approvals.length})`, Icon: Activity },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setInnerTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                innerTab === id
                  ? "bg-white/10 text-white border border-white/15"
                  : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200 border border-transparent"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {innerTab === "rules" && (
          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 bg-[#161616] p-8 text-center">
                <p className="text-sm text-neutral-300">Nenhuma regra Comentário → Direct configurada ainda.</p>
                <p className="mt-1 text-xs text-neutral-500">
                  Crie sua primeira regra para responder comentários com abertura de fluxo DM multi-etapa.
                </p>
              </div>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.rule_id}
                  className="rounded-xl border border-white/[0.08] bg-[#171717] p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${rule.ativo ? "bg-[#31CF76]" : "bg-neutral-600"}`}
                      />
                      <span className="text-sm font-semibold">{rule.nome}</span>
                      <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] text-neutral-300">
                        {rule.match_mode === "any"
                          ? "Qualquer comentário"
                          : `${rule.match_mode}: ${rule.keywords.join(", ")}`}
                      </span>
                      <span className="rounded bg-[#42A0FF]/15 px-2 py-0.5 text-[10px] text-[#42A0FF]">
                        {rule.flow_nodes.length} bloco(s) 24h
                      </span>
                      {rule.require_human_approval && (
                        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                          Aprovação humana
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 truncate max-w-2xl">
                      Etapa 1: “{rule.opening_message.text}” · Botão: [{rule.opening_message.button_label}]
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleRule(rule)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs border ${
                        rule.ativo
                          ? "border-[#31CF76]/30 bg-[#31CF76]/10 text-[#31CF76]"
                          : "border-white/10 bg-white/[0.04] text-neutral-300"
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {rule.ativo ? "Ativa" : "Pausada"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingRule(rule)}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs hover:bg-white/[0.08]"
                    >
                      Editar Fluxo
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRule(rule.rule_id)}
                      className="rounded-lg border border-red-500/20 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {innerTab === "deliverables" && (
          <CommentDmDeliverablesPanel deliverables={deliverables} onChanged={loadAll} />
        )}

        {(innerTab === "connection" || innerTab === "simulator") && (
          <CommentDmConnectionAndSimulator
            mode={innerTab === "connection" ? "connection" : "simulator"}
            config={connConfig}
            rules={rules}
            onSaved={loadAll}
          />
        )}

        {innerTab === "approvals" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-[#171717] p-4 space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                Fila de Aprovação Humana ({approvals.length})
              </h2>
              {approvals.length === 0 ? (
                <p className="text-xs text-neutral-500">Nenhuma resposta aguardando aprovação.</p>
              ) : (
                approvals.map((apr) => (
                  <div
                    key={apr.approval_id}
                    className="rounded-lg border border-white/10 bg-[#121212] p-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 text-xs">
                      <div className="font-medium text-white">
                        {apr.sender_username || apr.sender_ig_id}: “{apr.comment_text}”
                      </div>
                      <div className="text-neutral-400">Proposta DM: {apr.proposed_dm_text}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDecideApproval(apr.approval_id, true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#31CF76]/20 border border-[#31CF76]/40 px-3 py-1.5 text-xs text-[#31CF76]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar & Enviar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDecideApproval(apr.approval_id, false)}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 border border-red-500/30 px-3 py-1.5 text-xs text-red-400"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Rejeitar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#171717] p-4 space-y-2">
              <h2 className="text-sm font-semibold">Logs Auditados Recentes ({logs.length})</h2>
              <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05] text-xs">
                {logs.map((l) => (
                  <div key={l.log_id} className="py-2 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <span className="font-mono text-[10.5px] text-neutral-500 mr-2">{l.event_kind}</span>
                      <span className="text-neutral-200">{l.outcome}</span>
                      {l.reason && <span className="text-amber-300 ml-2">({l.reason})</span>}
                    </div>
                    <span className="text-[11px] text-neutral-500 shrink-0">
                      {new Date(l.criado_em).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {editingRule !== null && (
        <CommentDmRuleEditorModal
          initialRule={editingRule === "new" ? null : editingRule}
          deliverables={deliverables}
          agentes={agentes}
          workflows={workflows}
          onClose={() => setEditingRule(null)}
          onSave={handleSaveRule}
        />
      )}
    </div>
  );
};
