import React, { useEffect, useState } from "react";
import { GitBranch, Instagram, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { WorkflowsCanvasPage, type WorkflowsCanvasPageProps } from "../workflows/WorkflowsCanvasPage";
import { CommentDmAutomationPage } from "../social-studio/comment-dm/CommentDmAutomationPage";

export type AutomationsHubTabId = "creative_flows" | "instagram_dm";

const SUBNAV_COLLAPSED_KEY = "criativo_automations_subnav_collapsed";

export interface AutomationsHubPageProps extends WorkflowsCanvasPageProps {
  initialTab?: AutomationsHubTabId;
  tabSignal?: { tab: AutomationsHubTabId; nonce: number } | null;
  onOpenInstagramConfig?: () => void;
}

/**
 * Hub unificado de Automações (Fase 47):
 * Sub-sidebar recolhível alternando entre `Fluxos Criativos` (workflows IA)
 * e `Fluxos Instagram` com badge `BETA` (Comentário -> Direct).
 */
export const AutomationsHubPage: React.FC<AutomationsHubPageProps> = ({
  initialTab = "creative_flows",
  tabSignal,
  onOpenInstagramConfig,
  ...workflowProps
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<AutomationsHubTabId>(initialTab);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SUBNAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (tabSignal?.tab) {
      setActiveTab(tabSignal.tab);
    }
  }, [tabSignal]);

  useEffect(() => {
    const onSwitchEvent = (evt: Event) => {
      const detail = (evt as CustomEvent<{ tab?: AutomationsHubTabId }>).detail;
      if (detail?.tab) setActiveTab(detail.tab);
    };
    window.addEventListener("criativo:open-automations-tab", onSwitchEvent);
    return () => window.removeEventListener("criativo:open-automations-tab", onSwitchEvent);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SUBNAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignora falha de storage
      }
      return next;
    });
  };

  return (
    <div className="flex h-full w-full min-h-0 bg-[#121212] text-white overflow-hidden">
      <aside
        className={`shrink-0 border-r border-white/[0.08] bg-[#141414] flex flex-col transition-all duration-200 ${
          collapsed ? "w-[54px]" : "w-[228px]"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-white/[0.06]">
          {!collapsed && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {t("nav.automations")}
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapse}
            title={collapsed ? t("automations.expandSubnav") : t("automations.collapseSubnav")}
            aria-label={collapsed ? t("automations.expandSubnav") : t("automations.collapseSubnav")}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab("creative_flows")}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
              activeTab === "creative_flows"
                ? "bg-[#42A0FF]/15 text-[#42A0FF] border border-[#42A0FF]/30"
                : "text-neutral-300 hover:bg-white/[0.05] border border-transparent"
            }`}
          >
            <GitBranch className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{t("automations.creativeFlows")}</span>}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("instagram_dm")}
            className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
              activeTab === "instagram_dm"
                ? "bg-amber-500/15 text-amber-300 border border-amber-400/30"
                : "text-neutral-300 hover:bg-white/[0.05] border border-transparent"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Instagram className="h-4 w-4 shrink-0 text-amber-400" />
              {!collapsed && <span className="truncate">{t("automations.instagramFlows")}</span>}
            </div>
            {!collapsed && (
              <span className="shrink-0 rounded bg-amber-500/20 border border-amber-400/40 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-amber-300">
                {t("automations.betaBadge")}
              </span>
            )}
          </button>
        </nav>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {activeTab === "creative_flows" ? (
          <WorkflowsCanvasPage {...workflowProps} />
        ) : (
          <CommentDmAutomationPage
            agentes={workflowProps.agentes}
            workflows={workflowProps.workflows}
            onOpenInstagramConfig={onOpenInstagramConfig}
          />
        )}
      </div>
    </div>
  );
};
