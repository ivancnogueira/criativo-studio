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
import { daemonApi } from "../../services/websocket-client";
import type { MarketplacePageController, MarketplacePageProps } from "./useMarketplacePageController";
import { isGithubUrlCandidate } from "./marketplace-helpers";

export function MarketplaceCatalogContent({
  ctrl,
  props,
}: {
  ctrl: MarketplacePageController;
  props: MarketplacePageProps;
}) {
  const { agentes, onRefreshStudio } = props;
  const {
    tab,
    query,
    setQuery,
    expandedCategory,
    setExpandedCategory,
    apps,
    skills,
    yourApps,
    setSelectedAppSlug,
    allNativeAccounts,
    connectedNativeSlugs,
    setCustomMcpModalOpen,
    setEditingServer,
    setCreateSkillModalOpen,
    setBatchSkillTarget,
    setSkillPendingDelete,
    githubPreview,
    githubLoading,
    setGithubModalOpen,
    setFeedbackBanner,
    loadCatalogAndApps,
    appGroups,
    filteredAgents,
    installedSkills,
    catalogSkillGroups,
    totalAgentsCount,
    handleInstallAgentTemplate,
    handleInstallGithubItem,
  } = ctrl;

  return (
    <>
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-[28px] font-semibold leading-[1.2] text-[#F0F0F0]">
                  {tab === "apps" ? "Apps" : tab === "agents" ? "Agentes" : "Habilidades"}
                </h1>
                <p className="mt-1 text-[14px] text-[#979797]">
                  {tab === "apps"
                    ? "Conecte serviços criativos, ferramentas MCP e integrações nativas do estúdio."
                    : tab === "agents"
                      ? "Instale especialistas em 1 clique ou importe agentes públicos de repositórios."
                      : "Gerencie instruções reutilizáveis (SKILL.md) e vincule aos seus agentes."}
                </p>
              </div>

              {tab === "apps" && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingServer(null);
                    setCustomMcpModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  <Plus size={16} /> Adicionar personalizado
                </button>
              )}
              {tab === "agents" && (
                <button
                  type="button"
                  onClick={() => setGithubModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                >
                  <Github size={16} /> Importar repositório
                </button>
              )}
              {tab === "skills" && (
                <button
                  type="button"
                  onClick={() => setCreateSkillModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414] hover:bg-white"
                >
                  <Plus size={16} /> Criar habilidade
                </button>
              )}
            </header>

            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-3 text-[#979797]" />
              <input
                type="search"
                aria-label="Buscar na Loja"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar apps, habilidades ou colar link do GitHub..."
                className="w-full rounded-[12px] border border-[#2A2A2A] bg-[#242424] py-2.5 pl-10 pr-4 text-[14px] text-[#F0F0F0] placeholder-[#979797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              />
            </div>

            {expandedCategory && (
              <div className="flex items-center gap-2 text-[12px] text-[#979797]">
                <button
                  type="button"
                  onClick={() => setExpandedCategory(null)}
                  className="inline-flex items-center gap-1 text-[#42A0FF] hover:underline"
                >
                  <ArrowLeft size={14} /> Apps &gt; {expandedCategory}
                </button>
              </div>
            )}

            {/* Preview de repositório GitHub colado na busca */}
            {(tab === "skills" || tab === "agents") && isGithubUrlCandidate(query) && (
              <section className="space-y-3 rounded-[14px] border border-[#FF9412]/50 bg-[#212121] p-4">
                <div className="flex items-start gap-2 rounded-[10px] border border-[#FF9412]/40 bg-[#FF9412]/10 p-3 text-[12px] text-[#FF9412]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Origem externa do GitHub: este pacote não foi auditado pela equipe do estúdio. Revise as instruções antes de vincular aos seus agentes.
                  </span>
                </div>
                {githubLoading ? (
                  <p className="text-[14px] text-[#979797]">Inspecionando repositório GitHub...</p>
                ) : githubPreview && githubPreview.items.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {githubPreview.items.map((item) => (
                      <div
                        key={item.path}
                        className="flex items-center justify-between gap-3 rounded-[10px] border border-[#2A2A2A] bg-[#1A1A1A] p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                            {item.name}
                          </p>
                          <p className="truncate text-[12px] text-[#979797]">{item.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void handleInstallGithubItem(
                              githubPreview.repositoryUrl,
                              githubPreview.kind,
                              item.path
                            )
                          }
                          className="shrink-0 rounded-full bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
                        >
                          {githubPreview.kind === "agents" ? "Instalar agente" : "Instalar habilidade"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-[#979797]">
                    Nenhum arquivo SKILL.md ou manifesto compatível localizado neste repositório.
                  </p>
                )}
              </section>
            )}

            {/* Conteúdo da Aba Apps */}
            {tab === "apps" && (
              appGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center space-y-3 rounded-[14px] border border-[#2A2A2A] bg-[#212121] py-12 px-4 text-center">
                  <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                    Nenhum resultado encontrado na Loja
                  </h2>
                  <p className="text-[14px] text-[#979797]">
                    Tente outro termo, cole um link do GitHub (owner/repo) ou adicione um servidor MCP personalizado.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setExpandedCategory(null);
                      }}
                      className="rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-[14px] font-semibold text-[#F0F0F0]"
                    >
                      Limpar filtros
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomMcpModalOpen(true)}
                      className="rounded-full bg-[#F0F0F0] px-4 py-2 text-[14px] font-semibold text-[#141414]"
                    >
                      Adicionar personalizado
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  {appGroups.map((group) => {
                    const visible = expandedCategory ? group.items : group.items.slice(0, 6);
                    return (
                      <section key={group.category} className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                              {group.category}
                            </h2>
                            <span className="text-[12px] text-[#979797] tabular-nums">
                              {group.items.length}
                            </span>
                          </div>
                          {!expandedCategory && group.items.length > 6 && (
                            <button
                              type="button"
                              onClick={() => setExpandedCategory(group.category)}
                              className="text-[14px] font-semibold text-[#42A0FF] hover:underline"
                            >
                              Ver todos
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {visible.map((app) => {
                            const nativeAccountsForApp = allNativeAccounts.filter(
                              (a) => a.app_slug === app.slug && a.configurado
                            );
                            const hasNativeConn =
                              nativeAccountsForApp.length > 0 ||
                              connectedNativeSlugs.includes(app.slug);
                            const connected =
                              hasNativeConn ||
                              yourApps.some((s) => s.origemAppSlug === app.slug && s.ativo);
                            return (
                              <button
                                key={app.slug}
                                type="button"
                                onClick={() => setSelectedAppSlug(app.slug)}
                                className={`flex flex-col justify-between gap-3 rounded-[12px] border bg-[#212121] p-4 text-left transition-colors hover:border-[#42A0FF]/50 ${
                                  connected ? "border-[#31CF76]/35" : "border-[#2A2A2A]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <AppBrandIcon slug={app.slug} name={app.name} size={32} />
                                    <div className="min-w-0">
                                      <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                                        {app.name}
                                      </p>
                                      <p className="truncate text-[12px] text-[#979797]">
                                        {app.creatorName}
                                      </p>
                                    </div>
                                  </div>
                                  {connected && (
                                    <span className="shrink-0 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[12px] font-semibold text-[#31CF76]">
                                      {nativeAccountsForApp.length > 1
                                        ? `${nativeAccountsForApp.length} contas`
                                        : "Conectado"}
                                    </span>
                                  )}
                                </div>
                                <p className="line-clamp-2 text-[14px] text-[#DCDCDC]">
                                  {app.tagline}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )
            )}

            {/* Conteúdo da Aba Agentes */}
            {tab === "agents" && (
              <div className="space-y-8">
                <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredAgents.map((pkg) => (
                    <div
                      key={pkg.slug}
                      className="flex flex-col justify-between gap-4 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-[14px] font-semibold text-[#F0F0F0]">{pkg.name}</h3>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                              pkg.verified
                                ? "bg-[#31CF76]/15 text-[#31CF76]"
                                : "bg-[#242424] text-[#979797]"
                            }`}
                          >
                            {pkg.verified ? "Verificado" : "Público"}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#979797]">{pkg.role}</p>
                        <p className="text-[14px] text-[#DCDCDC]">{pkg.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleInstallAgentTemplate(pkg)}
                        className="rounded-full bg-[#F0F0F0] px-4 py-1.5 text-[14px] font-semibold text-[#141414] hover:bg-white"
                      >
                        Instalar agente
                      </button>
                    </div>
                  ))}
                </section>

                {agentes.length > 0 && (
                  <section className="space-y-3 border-t border-[#2A2A2A] pt-6">
                    <h2 className="text-[20px] font-semibold text-[#F0F0F0]">
                      Agentes instalados no estúdio
                    </h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {agentes.map((ag) => (
                        <div
                          key={ag.agente_id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#2A2A2A] bg-[#212121] p-4"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                              {ag.nome}
                            </p>
                            <p className="truncate text-[12px] text-[#979797]">{ag.papel}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void daemonApi.duplicateLojaAgent(ag.agente_id).then(() => onRefreshStudio?.())}
                              className="inline-flex items-center gap-1 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0]"
                            >
                              <Copy size={12} /> Duplicar agente
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void daemonApi.exportLojaAgent(ag.agente_id).then((exp) => {
                                  setFeedbackBanner(`Template "${exp.name}" exportado como JSON.`);
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1 text-[12px] font-semibold text-[#F0F0F0]"
                            >
                              <Download size={12} /> Exportar agente
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* Conteúdo da Aba Habilidades */}
            {tab === "skills" && (
              <div className="space-y-8">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[20px] font-semibold text-[#F0F0F0]">Suas habilidades</h2>
                    <span className="text-[12px] text-[#979797] tabular-nums">
                      {installedSkills.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {installedSkills.map((sk) => (
                      <div
                        key={sk.skillId}
                        className="flex flex-col justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4"
                      >
                        <div className="space-y-1">
                          <p className="text-[14px] font-semibold text-[#F0F0F0]">{sk.name}</p>
                          <p className="text-[12px] text-[#31CF76]">
                            Ativada em {sk.agentIds.length} de {totalAgentsCount}
                          </p>
                          <p className="line-clamp-2 text-[14px] text-[#DCDCDC]">
                            {sk.description}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setBatchSkillTarget(sk)}
                            className="rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                          >
                            Adicionar aos agentes
                          </button>
                          {sk.source !== "nativa" && (
                            <button
                              type="button"
                              aria-label={`Excluir habilidade ${sk.name}`}
                              onClick={() => setSkillPendingDelete(sk)}
                              className="rounded-full border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 p-1.5 text-[#FD2F3B]"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {catalogSkillGroups.map((grp) => (
                  <section key={grp.category} className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[20px] font-semibold text-[#F0F0F0]">{grp.category}</h2>
                      <span className="text-[12px] text-[#979797] tabular-nums">
                        {grp.items.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {grp.items.slice(0, 6).map((sk) => (
                        <div
                          key={sk.skillId}
                          className="flex flex-col justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-4"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[14px] font-semibold text-[#F0F0F0]">
                                {sk.name}
                              </p>
                              <span className="text-[12px] text-[#979797]">
                                {sk.verified ? "Verificada" : "Pública"}
                              </span>
                            </div>
                            <p className="line-clamp-2 text-[14px] text-[#DCDCDC]">
                              {sk.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void daemonApi
                                .installCatalogSkill(sk.slug, [agentes[0]?.agente_id ?? "estrategista"])
                                .then(() => loadCatalogAndApps())
                            }
                            className="self-start rounded-full border border-[#2A2A2A] bg-[#242424] px-4 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                          >
                            Instalar habilidade
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
    </>
  );
}
