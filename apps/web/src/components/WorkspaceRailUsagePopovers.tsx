import {
  Activity,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import {
  ProviderLogo,
} from "./ProviderLogo";
import { ConcentricQuotaRings, MiniQuotaRing, flattenAccountBars, providerShortName, summarizeRingPercentages, formatUsageWindowLabel, shouldShowGroupHeading } from "./workspace-rail-quota-rings";
import type { WorkspaceRailController } from "./useWorkspaceRailController";

export function WorkspaceRailUsagePopovers({ ctrl }: { ctrl: WorkspaceRailController }) {
  const {
    onSelectSection,
    uso,
    onRefreshUsage,
    whatsappStatus,
    onOpenWhatsAppModal,
    setActiveAccountId,
    moreRingsMenuOpen,
    setMoreRingsMenuOpen,
    setFallbackPopoverOpen,
    refreshing,
    allAccounts,
    orderedAccounts,
    hasOverflowAccounts,
    popoverOpen,
    popoverAccounts,
    fallbackPercent,
    hasAnyConnectedAccount,
    handleRefresh,
    triggerFallbackUsageSync,
  } = ctrl;
  return (
    <>
        {/* Menu lateral com todos os anéis de cada conta quando houver mais de 5 contas */}
        {moreRingsMenuOpen && hasOverflowAccounts && (
          <div
            role="dialog"
            aria-label="Todas as contas conectadas"
            data-testid="rail-all-accounts-menu"
            className="absolute left-[54px] bottom-14 w-[312px] rounded-2xl bg-[#1C1C1C]/98 backdrop-blur-xl border border-white/[0.11] shadow-2xl p-3 z-50 text-left space-y-2"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                <Activity className="h-3.5 w-3.5 text-[#31CF76]" />
                <span>Contas conectadas ({orderedAccounts.length})</span>
              </span>
              {onRefreshUsage && (
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  title="Atualizar cotas ao vivo"
                  className="h-6 w-6 rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-white/[0.06]"
                >
                  <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
            <div className="space-y-1 max-h-[320px] overflow-y-auto pr-0.5">
              {orderedAccounts.map((acc) => {
                const hasQuota = Boolean(acc.grupos_cota && acc.grupos_cota.length > 0);
                const bars = flattenAccountBars(acc.grupos_cota);
                const percents = bars.map((b) => b.restante);
                const ringPercents = hasQuota
                  ? summarizeRingPercentages(acc.grupos_cota)
                  : [fallbackPercent];
                const minPct = percents.length > 0 ? Math.min(...percents) : null;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => {
                      setMoreRingsMenuOpen(false);
                      setActiveAccountId(acc.id);
                      if (!hasQuota) triggerFallbackUsageSync();
                    }}
                    className="w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/[0.06] transition-colors text-left"
                  >
                    <ConcentricQuotaRings
                      percentages={ringPercents}
                      inactive={!hasQuota}
                      provider={acc.provedor}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-white truncate">
                          {providerShortName(acc.provedor)}
                        </span>
                        <span
                          className={`text-[11px] font-semibold tabular-nums shrink-0 ${
                            minPct === null
                              ? "text-[#31CF76]"
                              : minPct >= 50
                                ? "text-[#DCDCDC]"
                                : minPct >= 20
                                  ? "text-[#FDCB6E]"
                                  : "text-[#FF7675]"
                          }`}
                        >
                          {minPct !== null ? `${minPct}%` : "Conectada"}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-[#8E8E93] truncate">
                        {acc.email ?? acc.rotulo ?? acc.id}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Popover flutuante 'Uso' exibindo exclusivamente a conta selecionada */}
        {popoverOpen && (
          <div
            role="dialog"
            aria-label="Resumo de uso e cotas da conta"
            className="absolute left-[54px] bottom-14 w-[320px] rounded-2xl bg-[#1C1C1C]/98 backdrop-blur-xl border border-white/[0.11] shadow-2xl p-3.5 z-50 text-left"
          >
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  setActiveAccountId(null);
                  setMoreRingsMenuOpen(false);
                  setFallbackPopoverOpen(false);
                  onSelectSection("uso");
                }}
                className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white hover:text-[#31CF76] transition-colors"
              >
                <Activity className="h-3.5 w-3.5 text-[#979797]" />
                <span>Uso</span>
              </button>
              <div className="flex items-center gap-1.5">
                {onRefreshUsage && (
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    title="Atualizar cotas ao vivo"
                    className="h-6 w-6 rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-white/[0.06]"
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveAccountId(null);
                    setMoreRingsMenuOpen(false);
                    setFallbackPopoverOpen(false);
                    onSelectSection("uso");
                  }}
                  className="text-[11px] text-[#979797] hover:text-white px-2 py-0.5 rounded-lg bg-white/[0.05]"
                >
                  Ver relatório
                </button>
              </div>
            </div>

            <div className="mt-2.5 space-y-3 max-h-[380px] overflow-y-auto pr-0.5">
              {popoverAccounts.length > 0 ? (
                popoverAccounts.map((acc) => {
                  const hasAccountQuotas = acc.grupos_cota && acc.grupos_cota.length > 0;
                  return (
                    <div key={acc.id} className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-white">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <ProviderLogo provider={acc.provedor} size={13} />
                          <span className="truncate">{providerShortName(acc.provedor)}</span>
                        </span>
                        {acc.email && (
                          <span className="text-[10.5px] font-normal text-[#787878] truncate max-w-[185px]">
                            {acc.email}
                          </span>
                        )}
                      </div>

                      {hasAccountQuotas ? (
                        <div className="space-y-3">
                          {acc.grupos_cota.map((grupo) => {
                            const showHeading = shouldShowGroupHeading(acc, grupo);
                            const windows = [grupo.janela_semanal, grupo.janela_5h].filter(
                              (w): w is NonNullable<typeof w> => Boolean(w)
                            );
                            return (
                              <div key={grupo.nome} className="space-y-1.5">
                                {showHeading && (
                                  <div className="text-[12px] font-semibold text-white leading-tight">
                                    {grupo.nome}
                                  </div>
                                )}
                                <div className="space-y-2">
                                  {windows.map((win) => {
                                    const pct = Math.max(0, Math.min(100, win.restante_percentual));
                                    return (
                                      <div
                                        key={`${grupo.nome}-${win.janela}`}
                                        className="flex items-center justify-between gap-3"
                                      >
                                        <div className="min-w-0">
                                          <div className="text-[11.5px] text-[#979797] leading-snug">
                                            {formatUsageWindowLabel(win.janela, win.rotulo)}
                                          </div>
                                          {win.reseta_em_texto && (
                                            <div className="text-[10.5px] text-[#787878] leading-snug">
                                              Reinicia em {win.reseta_em_texto}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span
                                            className={`text-[11.5px] font-semibold tabular-nums ${
                                              pct >= 50
                                                ? "text-[#DCDCDC]"
                                                : pct >= 20
                                                  ? "text-[#FDCB6E]"
                                                  : "text-[#FF7675]"
                                            }`}
                                          >
                                            {pct}% restante
                                          </span>
                                          <MiniQuotaRing percentage={pct} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11.5px]">
                            <span className="text-[#979797]">Status</span>
                            <span className="text-[#31CF76]">Conectada</span>
                          </div>
                          <p className="text-[11px] text-[#787878]">
                            {refreshing ? (
                              "Sincronizando janelas de cota..."
                            ) : (
                              <>
                                Clique em <strong>↻</strong> acima para sincronizar as janelas de cota.
                              </>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : hasAnyConnectedAccount ? (
                <div className="space-y-2">
                  {allAccounts.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between text-[11.5px] gap-2">
                      <div className="flex items-center gap-1.5 text-[#DCDCDC] truncate">
                        <ProviderLogo provider={acc.provedor} size={13} />
                        <span className="truncate">{acc.email ?? acc.rotulo ?? acc.id}</span>
                      </div>
                      <span className="text-[#31CF76] shrink-0">Conectada</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-[#787878]">
                    {refreshing ? (
                      "Sincronizando janelas de cota..."
                    ) : (
                      <>
                        Clique em <strong>↻</strong> acima para sincronizar as janelas de cota.
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 py-1">
                  <p className="text-[11.5px] text-[#979797] leading-relaxed">
                    Nenhuma conta Google, Claude ou ChatGPT conectada ainda no Studio.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveAccountId(null);
                      setMoreRingsMenuOpen(false);
                      setFallbackPopoverOpen(false);
                      onSelectSection("conexoes");
                    }}
                    className="studio-btn-primary w-full py-1.5 text-[11.5px] text-center"
                  >
                    Conectar Conta Agora
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onOpenWhatsAppModal}
          title={whatsappStatus === "conectado" ? "WhatsApp Conectado" : "Conectar WhatsApp"}
          aria-label="WhatsApp Móvel QR"
          className="relative h-9 w-9 rounded-xl flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#1A1A1A] transition-colors"
        >
          <Smartphone className="h-[17px] w-[17px]" />
          <span
            className={`absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-[#0D0D0D] ${
              whatsappStatus === "conectado"
                ? "bg-[#31CF76]"
                : whatsappStatus === "aguardando_qrcode"
                  ? "bg-[#FF9412]"
                  : "bg-[#6A6A6A]"
            }`}
          />
        </button>

    </>
  );
}
