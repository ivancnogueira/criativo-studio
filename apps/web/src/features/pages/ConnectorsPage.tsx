import React from "react";
import {
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { ProvidersCatalogView } from "./ProvidersCatalogView";
import type { ConnectorsPageProps } from "./connectors/connectors-types";
export type { ConnectorsPageProps };
import { useConnectorsController } from "./connectors/useConnectorsController";
import { ConnectorsAppsTab } from "./connectors/ConnectorsAppsTab";
import { ConnectorsSkillsTab } from "./connectors/ConnectorsSkillsTab";
import { ConnectorsShowcaseTab } from "./connectors/ConnectorsShowcaseTab";
import { ConnectorsVaultTab } from "./connectors/ConnectorsVaultTab";

export const ConnectorsPage: React.FC<ConnectorsPageProps> = (props) => {
  const ctrl = useConnectorsController(props);
  const {
    provedores,
    onConnectProvider,
    onDisconnectProvider,
    onReopenOnboarding,
    defaultProvider = "gemini",
    initialDetailProviderId = null,
    onSelectDefaultProvider,
    onRefreshProviders,
    onTogglePool,
    onSetAccountActive,
    onToggleAccountExcluded,
    onConnectProviderViaBrowser,
    onCancelProviderBrowserSignIn,
    pendingAuthUrl,
    activeServerName,
    activeServerKind,
    onSubmitManualOAuthCallback,
    onAddProviderAccount,
    onRemoveProviderAccount,
    onSetModelsVisibility
  } = props;
  const {
    hubTab,
    setHubTab,
    sidebarSearch,
    setSidebarSearch,
    setSelectedConnectorId,
    activeDetailProvider,
    setActiveDetailProvider,
    authorizingProvider,
    setAuthorizingProvider,
    authError,
    setAuthError,
    refreshingLive,
    toast,
    showToast,
    activeConnector,
    handleRefreshLive,
    visibleNavSections,
    activeSectionTitle
  } = ctrl;

  return (
    <div className="flex-1 h-full w-full flex flex-col md:flex-row bg-[#171719] overflow-hidden">
      {/* Subsidebar esquerda estilo Configurações do Studio */}
      <aside
        aria-label="Navegação de Configurações"
        className="w-full md:w-[244px] shrink-0 bg-[#121214] border-b md:border-b-0 md:border-r border-white/[0.06] flex flex-col p-3.5 gap-3"
      >
        <div className="flex items-center gap-2.5 px-1 pt-0.5">
          <div className="h-5 w-5 rounded-md bg-gradient-to-br from-[#FF9412] to-[#E67E22] flex items-center justify-center shrink-0">
            <Plug className="h-3 w-3 text-[#141414]" />
          </div>
          <span className="text-[13px] font-semibold text-white truncate">
            Criativo AI Studio
          </span>
        </div>

        <div className="relative">
          <Search className="h-3.5 w-3.5 text-[#78787D] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            id="conn-settings-search"
            name="conn_settings_search"
            aria-label="Pesquisar configurações"
            type="text"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Pesquisar configurações..."
            className="w-full rounded-xl bg-[#1A1A1D] border border-white/[0.07] pl-8 pr-3 py-1.5 text-[12px] text-white placeholder-[#78787D] focus:outline-none focus:border-white/20"
          />
        </div>

        <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
          {visibleNavSections.map((tab) => {
            const active = hubTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setHubTab(tab.key);
                  setSelectedConnectorId(null);
                  if (tab.key !== "provedores") setActiveDetailProvider(null);
                }}
                className={`w-full px-2.5 py-2 rounded-xl text-[12.5px] font-medium flex items-center justify-between gap-2 transition-colors shrink-0 md:shrink ${
                  active
                    ? "bg-[#242428] text-white"
                    : "text-[#9E9EA6] hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className={active ? "text-white" : "text-[#8E8E93]"}>{tab.icone}</span>
                  <span className="truncate">{tab.rotulo}</span>
                </span>
                <span className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[#9E9EA6] tabular-nums shrink-0">
                  {tab.contagem}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="hidden md:flex flex-col gap-1 mt-auto pt-3 border-t border-white/[0.06]">
          {onRefreshProviders && (
            <button
              type="button"
              onClick={() => void handleRefreshLive()}
              className="w-full px-2.5 py-1.5 rounded-xl text-[12px] text-[#9E9EA6] hover:text-white hover:bg-white/[0.04] flex items-center gap-2 transition-colors text-left"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${refreshingLive ? "animate-spin" : ""}`} />
              <span>Atualizar detecção</span>
            </button>
          )}
          <button
            type="button"
            onClick={onReopenOnboarding}
            className="w-full px-2.5 py-1.5 rounded-xl text-[12px] text-[#9E9EA6] hover:text-white hover:bg-white/[0.04] flex items-center gap-2 transition-colors text-left"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span>Refazer Onboarding</span>
          </button>
        </div>
      </aside>

      {/* Painel direito Carbon Dark */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[#171719]">
        <header className="h-12 px-6 border-b border-white/[0.06] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-white min-w-0">
            <span className="truncate">{activeSectionTitle}</span>
            {hubTab === "provedores" && activeDetailProvider && (
              <>
                <span className="text-[#6E6E73]">›</span>
                <span className="text-[#DCDCDC] truncate">{activeDetailProvider.rotulo}</span>
              </>
            )}
            {hubTab === "apps" && activeConnector && (
              <>
                <span className="text-[#6E6E73]">›</span>
                <span className="text-[#DCDCDC] truncate">{activeConnector.nome}</span>
              </>
            )}
          </div>
          <div className="flex md:hidden items-center gap-2 shrink-0">
            {onRefreshProviders && (
              <button
                type="button"
                onClick={() => void handleRefreshLive()}
                className="studio-btn-secondary px-2.5 py-1 text-[11.5px]"
              >
                Atualizar
              </button>
            )}
            <button
              type="button"
              onClick={onReopenOnboarding}
              className="studio-btn-secondary px-2.5 py-1 text-[11.5px]"
            >
              Onboarding
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className={`${hubTab === "provedores" || hubTab === "cofre" ? "max-w-[780px]" : "max-w-[960px]"} mx-auto space-y-5`}>
            {toast && (
              <div className="rounded-xl bg-[#31CF76]/15 border border-[#31CF76]/30 px-4 py-2.5 text-[12.5px] text-[#31CF76]">
                {toast}
              </div>
            )}

            {/* ABA 1: PROVEDORES DE IA (Layout Master/Detail no padrão Carbon Dark) */}
            {hubTab === "provedores" && (
              <ProvidersCatalogView
                provedores={provedores}
                defaultProvider={defaultProvider}
                initialDetailProviderId={initialDetailProviderId}
                authorizingProvider={authorizingProvider}
                authError={
                  authError &&
                  activeDetailProvider &&
                  authError.provedor === activeDetailProvider.provedor
                    ? authError.message
                    : null
                }
                pendingAuthUrl={pendingAuthUrl}
                onSelectDefaultProvider={onSelectDefaultProvider}
                onActiveProviderChange={(prov) => {
                  setActiveDetailProvider(prov);
                  setAuthError(null);
                }}
                onStartBrowserSignIn={async (provTarget, label) => {
                  if (!onConnectProviderViaBrowser) return;
                  setAuthError(null);
                  setAuthorizingProvider(provTarget);
                  try {
                    const res = await onConnectProviderViaBrowser(provTarget, label);
                    if (!res.ok) {
                      if (!res.canceled) {
                        setAuthError({
                          provedor: provTarget,
                          message: res.erro ?? "Não foi possível concluir o login no navegador.",
                        });
                      }
                    } else {
                      showToast(`Conta ${provTarget} conectada com sucesso!`);
                    }
                  } finally {
                    setAuthorizingProvider(null);
                  }
                }}
                onCancelBrowserSignIn={async (provTarget) => {
                  await onCancelProviderBrowserSignIn?.(provTarget);
                  setAuthorizingProvider(null);
                  showToast("Login no navegador cancelado.");
                }}
                onConnectApiKey={async (prov, apiKey) => {
                  await onConnectProvider(prov, apiKey);
                }}
                onDisconnectProvider={onDisconnectProvider}
                onRefreshProviders={onRefreshProviders}
                onTogglePool={onTogglePool}
                onSetAccountActive={onSetAccountActive}
                onToggleAccountExcluded={onToggleAccountExcluded}
                onRemoveAccount={onRemoveProviderAccount}
                onAddManualAccount={onAddProviderAccount}
                onSetModelsVisibility={onSetModelsVisibility}
                activeServerName={activeServerName}
                activeServerKind={activeServerKind}
                onSubmitManualOAuthCallback={onSubmitManualOAuthCallback}
                onShowToast={showToast}
              />
            )}
            <ConnectorsAppsTab ctrl={ctrl} props={props} />
            <ConnectorsSkillsTab ctrl={ctrl} props={props} />
            <ConnectorsShowcaseTab ctrl={ctrl} props={props} />
            <ConnectorsVaultTab ctrl={ctrl} props={props} />
          </div>
        </div>
      </div>
    </div>
  );
};
