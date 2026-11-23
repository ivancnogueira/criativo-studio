import type {
  AgenteRegistro,
  GithubImportPreview,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceAuthFlow,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  McpTransporte,
  NativeAppAccountSummary,
} from "@criativo/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  AppBrandIcon,
  CarbonSelect,
  SlidingTabs,
  type CarbonSelectOption,
} from "../../components/ui/CarbonControls";
import { statusDotColor } from "./marketplace-helpers";
import { useMarketplacePageController, type MarketplacePageProps } from "./useMarketplacePageController";
import { MarketplaceAppDetailView } from "./MarketplaceAppDetailView";
import { MarketplaceCatalogContent } from "./MarketplaceCatalogContent";
import { MarketplaceModalsAndToasts } from "./MarketplaceModalsAndToasts";

export { type MarketplaceYourAppEntry } from "./marketplace-helpers";
export { CustomMcpModal, type CustomMcpModalProps } from "./CustomMcpModal";
export { CreateSkillModal, type CreateSkillModalProps } from "./CreateSkillModal";
export { type MarketplacePageProps } from "./useMarketplacePageController";

export function MarketplacePage(props: MarketplacePageProps) {
  const ctrl = useMarketplacePageController(props);
  const {
    tab,
    setTab,
    sourceFilter,
    setSourceFilter,
    apps,
    agentTemplates,
    skills,
    yourApps,
    selectedAppSlug,
    setSelectedAppSlug,
    setExpandedCategory,
    nativeSidebarEntries,
    feedbackBanner,
    setFeedbackBanner,
    setEditingServer,
    setCustomMcpModalOpen,
  } = ctrl;

  return (
    <div className="flex h-full min-h-0 flex-1 bg-[#1A1A1A] text-[#F0F0F0]">
      {/* Barra Lateral Interna da Loja (224px, #141414) */}
      <aside
        aria-label="Navegação da Loja"
        className="flex w-[224px] shrink-0 flex-col border-r border-[#2A2A2A] bg-[#141414] p-4 space-y-6 overflow-y-auto"
      >
        <div className="space-y-1">
          <p className="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[#979797]">
            Loja
          </p>
          {[
            { id: "apps" as const, label: "Apps", count: apps.length, Icon: Blocks },
            { id: "agents" as const, label: "Criativos", count: agentTemplates.length, Icon: Bot },
            { id: "skills" as const, label: "Habilidades", count: skills.length, Icon: Sparkles },
          ].map(({ id, label, count, Icon }) => {
            const active = tab === id && !selectedAppSlug;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setSelectedAppSlug(null);
                  setExpandedCategory(null);
                }}
                className={`relative flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-[14px] transition-colors ${
                  active
                    ? "bg-[#212121] font-semibold text-[#F0F0F0]"
                    : "text-[#979797] hover:bg-[#1A1A1A] hover:text-[#F0F0F0]"
                }`}
              >
                {tab === id && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#007CF7]" />
                )}
                <span className="flex items-center gap-2">
                  <Icon size={16} />
                  <span>{label}</span>
                </span>
                <span className="text-[12px] tabular-nums text-[#979797]">{count}</span>
              </button>
            );
          })}
        </div>

        {(tab === "agents" || tab === "skills") && (
          <div className="space-y-2">
            <p className="px-2 text-[12px] font-semibold text-[#979797]">Origem</p>
            <SlidingTabs<MarketplaceSourceFilter>
              ariaLabel="Filtro de origem"
              value={sourceFilter}
              onChange={setSourceFilter}
              variant="subtle"
              className="flex-wrap"
              tabs={[
                { id: "all", label: "Todos" },
                { id: "verified", label: "Verificados" },
                { id: "public", label: "Públicos" },
              ]}
            />
          </div>
        )}

        <div className="space-y-2 border-t border-[#2A2A2A] pt-4">
          <p className="px-2 text-[12px] font-semibold text-[#979797]">Seus apps</p>
          {yourApps.length === 0 && nativeSidebarEntries.length === 0 ? (
            <div className="space-y-2 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3">
              <p className="text-[12px] font-semibold text-[#F0F0F0]">
                Nenhum aplicativo conectado ainda
              </p>
              <p className="text-[12px] text-[#979797]">
                Conecte Canva, Figma ou registre um servidor MCP personalizado.
              </p>
              <button
                type="button"
                onClick={() => {
                  setTab("apps");
                  setSelectedAppSlug(null);
                }}
                className="text-[12px] font-semibold text-[#42A0FF] hover:underline"
              >
                Explorar aplicativos
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {nativeSidebarEntries.map((entry) => (
                <button
                  key={`native:${entry.slug}`}
                  type="button"
                  onClick={() => {
                    setTab("apps");
                    setSelectedAppSlug(entry.slug);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-[#DCDCDC] hover:bg-[#212121]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AppBrandIcon slug={entry.slug} name={entry.name} size={20} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#F0F0F0]">{entry.name}</span>
                      <span className="block truncate text-[10.5px] text-[#979797]">
                        {entry.subtitle}
                      </span>
                    </span>
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.allOk ? "#31CF76" : "#FF9412" }}
                  />
                </button>
              ))}
              {yourApps.map((srv) => (
                <button
                  key={srv.mcp_id}
                  type="button"
                  onClick={() => {
                    if (srv.origemAppSlug) {
                      setTab("apps");
                      setSelectedAppSlug(srv.origemAppSlug);
                    } else {
                      setEditingServer(srv);
                      setCustomMcpModalOpen(true);
                    }
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-[#DCDCDC] hover:bg-[#212121]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AppBrandIcon slug={srv.origemAppSlug} name={srv.nome} size={20} kind="mcp" />
                    <span className="truncate">{srv.nome}</span>
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: statusDotColor(srv) }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Conteúdo Principal (#1A1A1A) */}
      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 space-y-6 pb-16">
        {feedbackBanner && (
          <div className="flex items-center justify-between rounded-[12px] border border-[#31CF76]/40 bg-[#31CF76]/10 px-4 py-2 text-[14px] text-[#31CF76]">
            <span>{feedbackBanner}</span>
            <button type="button" onClick={() => setFeedbackBanner(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {selectedAppSlug ? (
          <MarketplaceAppDetailView ctrl={ctrl} props={props} />
        ) : (
          <MarketplaceCatalogContent ctrl={ctrl} props={props} />
        )}
      </div>

      <MarketplaceModalsAndToasts ctrl={ctrl} props={props} />
    </div>
  );
}
