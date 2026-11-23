import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  Search,
} from "lucide-react";
import {
  ProviderLogo,
} from "../../components/ProviderLogo";
import { formatAccountSummary } from "./providers-catalog-helpers";
import type { ProvidersCatalogController } from "./useProvidersCatalogController";
import { CustomAndLocalProvidersSection } from "./CustomAndLocalProvidersSection";

export function ProvidersMasterView({ ctrl }: { ctrl: ProvidersCatalogController }) {
  const {
    provedores,
    defaultProvider,
    authorizingProvider,
    onSelectDefaultProvider,
    activeServerName,
    activeServerKind,
    onShowToast,
    selectDetailProvider,
    providerQuery,
    setProviderQuery,
    defaultMenuOpen,
    setDefaultMenuOpen,
    activeDefaultInfo,
    connectedProviders,
    otherProviders,
  } = ctrl;
  return (
    <div className="max-w-[780px] mx-auto space-y-6 pb-6">
      {/* Card Provedor padrão */}
      <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] px-4 py-3.5 flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-white">Provedor padrão</div>
          <p className="text-[11.5px] text-[#8E8E93] mt-0.5">
            Novos Criativos começam com este provedor.
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Selecionar provedor padrão"
            onClick={() => setDefaultMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#222226] hover:bg-[#2B2B30] border border-white/[0.08] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors"
          >
            {activeDefaultInfo && <ProviderLogo provider={activeDefaultInfo.provedor} size={15} />}
            <span>{activeDefaultInfo?.rotulo ?? defaultProvider}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-[#8E8E93]" />
          </button>

          {defaultMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-52 rounded-xl bg-[#222226] border border-white/[0.12] shadow-2xl p-1 z-30">
              {provedores.map((prov) => {
                const selected = prov.provedor === defaultProvider;
                return (
                  <button
                    key={prov.provedor}
                    type="button"
                    onClick={async () => {
                      setDefaultMenuOpen(false);
                      await onSelectDefaultProvider?.(prov.provedor);
                      onShowToast(`${prov.rotulo} definido como provedor padrão.`);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[12.5px] flex items-center justify-between gap-2 transition-colors ${
                      selected
                        ? "bg-white/[0.1] text-white font-medium"
                        : "text-[#D4D4D8] hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <ProviderLogo provider={prov.provedor} size={14} />
                      <span className="truncate">{prov.rotulo}</span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 text-[#31CF76] shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Conectados + Buscar provedores */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium text-[#E5E5E7]">Conectados</h3>
          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 text-[#78787D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="studio-search-providers"
              name="studio_search_providers"
              aria-label="Buscar provedores"
              type="text"
              value={providerQuery}
              onChange={(e) => setProviderQuery(e.target.value)}
              placeholder="Buscar provedores"
              className="w-full rounded-xl bg-[#18181A] border border-white/[0.08] pl-8 pr-3 py-1.5 text-[12px] text-white placeholder-[#78787D] focus:outline-none focus:border-white/25"
            />
          </div>
        </div>

        <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
          {connectedProviders.map((prov) => {
            const isConn = authorizingProvider === prov.provedor;
            return (
              <button
                key={prov.provedor}
                type="button"
                onClick={() => selectDetailProvider(prov.provedor)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors first:rounded-t-2xl last:rounded-b-2xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
                    <ProviderLogo provider={prov.provedor} size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">
                      {prov.rotulo}
                    </div>
                    <div className="text-[11.5px] text-[#8E8E93] truncate">
                      {formatAccountSummary(
                        prov,
                        authorizingProvider,
                        activeServerName,
                        activeServerKind
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isConn && (
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-[#74B9FF] border-t-transparent animate-spin" />
                  )}
                  <ChevronRight className="h-4 w-4 text-[#6E6E73]" />
                </div>
              </button>
            );
          })}
          {connectedProviders.length === 0 && (
            <div className="px-4 py-4 text-[12px] text-[#7D7D85]">
              Nenhum provedor conectado no momento. Selecione um abaixo para conectar.
            </div>
          )}
        </div>
      </section>

      {/* Outros provedores */}
      {otherProviders.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-[13px] font-medium text-[#E5E5E7]">Outros provedores</h3>
          <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
            {otherProviders.map((prov) => (
              <button
                key={prov.provedor}
                type="button"
                onClick={() => selectDetailProvider(prov.provedor)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors first:rounded-t-2xl last:rounded-b-2xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
                    <ProviderLogo provider={prov.provedor} size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">
                      {prov.rotulo}
                    </div>
                    <div className="text-[11.5px] text-[#8E8E93] truncate">
                      {formatAccountSummary(
                        prov,
                        authorizingProvider,
                        activeServerName,
                        activeServerKind
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#6E6E73] shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}

      <CustomAndLocalProvidersSection onShowToast={onShowToast} />
    </div>
  );
}
