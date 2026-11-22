import {
  HelpCircle,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import {
  MascoteAvatar,
} from "./MascoteAvatar";
import {
  ServerSwitcherPopover,
} from "../features/servers/ServerSwitcherPopover";
import { WorkspaceRailProps, RAIL_ITEMS, ConcentricQuotaRings, flattenAccountBars, providerDisplayTitle, MAX_VISIBLE_ACCOUNT_RINGS, summarizeRingPercentages } from "./workspace-rail-quota-rings";
import { useWorkspaceRailController } from "./useWorkspaceRailController";
import { WorkspaceRailUsagePopovers } from "./WorkspaceRailUsagePopovers";

export {
  type StudioNavSection,
  summarizeRingPercentages,
  formatUsageWindowLabel,
  shouldShowGroupHeading,
} from "./workspace-rail-quota-rings";

export const WorkspaceRail: React.FC<WorkspaceRailProps> = (props) => {
  const ctrl = useWorkspaceRailController(props);
  const {
    activeSection,
    onSelectSection,
    uso,
    pendingCount,
    onOpenSettings,
    onOpenHelp,
    servers,
    activeServerId,
    serverQuota,
    onSelectServer,
    onOpenNewLocalServer,
    onOpenNewRemoteServer,
    onOpenJoinServer,
    onOpenServerSettings,
    onOpenDisplaySettings,
    activeAccountId,
    setActiveAccountId,
    moreRingsMenuOpen,
    setMoreRingsMenuOpen,
    setFallbackPopoverOpen,
    serverPopoverOpen,
    setServerPopoverOpen,
    activeServer,
    allAccounts,
    orderedAccounts,
    visibleAccounts,
    hasOverflowAccounts,
    fallbackPercent,
    hasAnyConnectedAccount,
    triggerFallbackUsageSync,
  } = ctrl;

  return (
    <aside
      aria-label="Navegação principal do estúdio"
      className="relative w-[52px] shrink-0 bg-[#0D0D0D] border-r border-white/[0.06] flex flex-col items-center justify-between py-2.5 select-none z-40"
    >
      {/* Topo: emblema Criativo + módulos principais */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
        <button
          type="button"
          onClick={() => onSelectSection("agentes")}
          title="Criativo AI Studio"
          aria-label="Início Criativo AI Studio"
          className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-[#212121] transition-colors mb-1"
        >
          <MascoteAvatar shape="hex" color="#31cf76" size={24} />
        </button>

        {RAIL_ITEMS.map(({ id, label, Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectSection(id)}
              title={label}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={`relative h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
                isActive
                  ? "bg-[#242424] text-white shadow-inner"
                  : "text-[#979797] hover:text-white hover:bg-[#1A1A1A]"
              }`}
            >
              <Icon className="h-[17px] w-[17px]" />
              {id === "tarefas" && pendingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-[#42A0FF] text-[9.5px] font-semibold text-[#0D0D0D] flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rodapé: anéis concêntricos de cota (1 por conta, limite 5 + ver mais) + WhatsApp móvel + Ajuda + Configurações */}
      <div
        className="relative flex flex-col items-center gap-1.5 w-full px-1.5"
        onMouseLeave={() => {
          setActiveAccountId(null);
          setMoreRingsMenuOpen(false);
          setFallbackPopoverOpen(false);
        }}
      >
        {/* Anéis concêntricos reais: 1 anel por conta (até 5 no trilho); botão ver mais abre todas as contas */}
        <div className="flex flex-col items-center gap-1.5">
          {visibleAccounts.length > 0 ? (
            <>
              {visibleAccounts.map((acc) => {
                const hasQuota = Boolean(acc.grupos_cota && acc.grupos_cota.length > 0);
                const bars = flattenAccountBars(acc.grupos_cota);
                const percents = bars.map((b) => b.restante);
                const ringPercents = hasQuota
                  ? summarizeRingPercentages(acc.grupos_cota)
                  : [fallbackPercent];
                const minPct = percents.length > 0 ? Math.min(...percents) : 100;
                const isSelectedRing = activeAccountId === acc.id;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onMouseEnter={() => {
                      setMoreRingsMenuOpen(false);
                      setActiveAccountId(acc.id);
                      if (!hasQuota) triggerFallbackUsageSync();
                    }}
                    onClick={() => {
                      setMoreRingsMenuOpen(false);
                      setActiveAccountId((prev) => (prev === acc.id ? null : acc.id));
                      if (!hasQuota) triggerFallbackUsageSync();
                    }}
                    onDoubleClick={() => onSelectSection("uso")}
                    title={
                      hasQuota
                        ? `${providerDisplayTitle(acc)} — mínimo ${minPct}% restante`
                        : `${providerDisplayTitle(acc)} — conectada (clique para sincronizar)`
                    }
                    aria-label={
                      hasQuota
                        ? `Uso da conta ${providerDisplayTitle(acc)}: ${minPct}% restante`
                        : `Conta ${providerDisplayTitle(acc)} conectada`
                    }
                    className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
                      isSelectedRing ? "bg-[#1A1A1A]" : "hover:bg-[#1A1A1A]"
                    }`}
                  >
                    <ConcentricQuotaRings
                      percentages={ringPercents}
                      inactive={!hasQuota}
                      provider={acc.provedor}
                    />
                  </button>
                );
              })}

              {hasOverflowAccounts && (
                <button
                  type="button"
                  data-testid="rail-more-accounts-btn"
                  onMouseEnter={() => {
                    setActiveAccountId(null);
                    setMoreRingsMenuOpen(true);
                  }}
                  onClick={() => {
                    setActiveAccountId(null);
                    setMoreRingsMenuOpen((v) => !v);
                  }}
                  title={`Ver todas as ${orderedAccounts.length} contas conectadas`}
                  aria-label={`Ver mais ${orderedAccounts.length - MAX_VISIBLE_ACCOUNT_RINGS} contas conectadas`}
                  aria-expanded={moreRingsMenuOpen}
                  className={`relative h-8 w-9 rounded-xl flex items-center justify-center transition-colors border ${
                    moreRingsMenuOpen
                      ? "bg-[#242424] border-white/15 text-white"
                      : "border-white/[0.06] bg-[#161618] text-[#979797] hover:text-white hover:bg-[#1E1E22]"
                  }`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#2A2A2E] border border-white/15 text-[9.5px] font-semibold text-[#DCDCDC] flex items-center justify-center tabular-nums">
                    +{orderedAccounts.length - MAX_VISIBLE_ACCOUNT_RINGS}
                  </span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onMouseEnter={() => {
                setFallbackPopoverOpen(true);
                triggerFallbackUsageSync();
              }}
              onClick={() => {
                setFallbackPopoverOpen((v) => !v);
                triggerFallbackUsageSync();
              }}
              onDoubleClick={() => onSelectSection("uso")}
              title={
                hasAnyConnectedAccount
                  ? `${allAccounts.length} conta(s) conectada(s) — clique para ver uso`
                  : "Nenhuma conta conectada — clique para conectar"
              }
              aria-label={
                hasAnyConnectedAccount
                  ? `Cota disponível: ${fallbackPercent}%`
                  : "Nenhuma conta conectada"
              }
              className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-[#1A1A1A] transition-colors"
            >
              <ConcentricQuotaRings
                percentages={hasAnyConnectedAccount ? [fallbackPercent, fallbackPercent] : [100]}
                inactive={!hasAnyConnectedAccount}
                provider={allAccounts[0]?.provedor}
              />
            </button>
          )}
        </div>

        <WorkspaceRailUsagePopovers ctrl={ctrl} />

        <button
          type="button"
          onClick={onOpenHelp}
          title="Guia rápido & Atalhos"
          aria-label="Ajuda"
          className="h-9 w-9 rounded-xl flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#1A1A1A] transition-colors"
        >
          <HelpCircle className="h-[17px] w-[17px]" />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title="Configurações do Studio e Onboarding"
          aria-label="Configurações"
          aria-current={activeSection === "configuracoes" ? "page" : undefined}
          className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
            activeSection === "configuracoes"
              ? "bg-[#242424] text-white shadow-inner ring-1 ring-white/10"
              : "text-[#979797] hover:text-white hover:bg-[#1A1A1A]"
          }`}
        >
          <Settings className="h-[17px] w-[17px]" />
        </button>

        {/* Avatar quadrado do servidor ativo abrindo ServerSwitcherPopover (seletor de servidor) */}
        <div className="relative pt-0.5">
          <button
            type="button"
            onClick={() => setServerPopoverOpen((prev) => !prev)}
            title={
              activeServer
                ? `Servidor ativo: ${activeServer.nome} (${activeServer.status})`
                : "Servidores conectados"
            }
            aria-label="Trocar ou adicionar servidor"
            aria-expanded={serverPopoverOpen}
            className={`relative h-8 w-8 rounded-[10px] flex items-center justify-center text-[12px] font-bold text-[#0D0D0D] shadow-md transition-transform hover:scale-105 ${
              serverPopoverOpen ? "ring-2 ring-white/80" : "ring-1 ring-white/15"
            }`}
            style={{ backgroundColor: activeServer?.cor_hex || "#E88B2D" }}
          >
            {activeServer?.nome?.trim().slice(0, 1).toUpperCase() || "S"}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#0D0D0D] ${
                activeServer?.status === "error"
                  ? "bg-[#FF5A5F]"
                  : activeServer?.status === "offline"
                    ? "bg-[#6A6A6A]"
                    : "bg-[#31CF76]"
              }`}
            />
          </button>

          <ServerSwitcherPopover
            open={serverPopoverOpen}
            servers={
              servers.length > 0
                ? servers
                : [
                    {
                      server_id: "primary",
                      nome: "Servidor Principal",
                      slug: "primary",
                      kind: "primary",
                      status: "online",
                      cor_hex: "#E88B2D",
                      base_url: "http://127.0.0.1:3000",
                      is_active: true,
                      created_at: new Date().toISOString(),
                    },
                  ]
            }
            activeServerId={activeServerId}
            quota={serverQuota}
            onClose={() => setServerPopoverOpen(false)}
            onSelectServer={(sid) => onSelectServer?.(sid)}
            onOpenNewLocalModal={() => onOpenNewLocalServer?.()}
            onOpenNewRemoteModal={() => onOpenNewRemoteServer?.()}
            onOpenJoinModal={() => onOpenJoinServer?.()}
            onOpenServerSettings={(srv) => onOpenServerSettings?.(srv)}
            onOpenDisplaySettings={() => {
              if (onOpenDisplaySettings) {
                onOpenDisplaySettings();
              } else {
                onOpenSettings();
              }
            }}
          />
        </div>
      </div>
    </aside>
  );
};
