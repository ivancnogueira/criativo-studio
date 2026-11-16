import React, { useMemo, useState } from "react";
import {
  Activity,
  Bot,
  FolderOpen,
  GitBranch,
  HelpCircle,
  Plug,
  RefreshCw,
  Settings,
  Smartphone,
  WalletCards,
} from "lucide-react";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ProviderName,
  StatusMensageria,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import { MascoteAvatar } from "./MascoteAvatar";
import { ProviderLogo } from "./ProviderLogo";

export type StudioNavSection =
  | "agentes"
  | "fluxos"
  | "tarefas"
  | "uso"
  | "arquivos"
  | "conexoes";

interface WorkspaceRailProps {
  activeSection: StudioNavSection;
  onSelectSection: (section: StudioNavSection) => void;
  quotaPercent?: number;
  uso?: UsoProvedoresSnapshot | null;
  onRefreshUsage?: () => Promise<void>;
  whatsappStatus: StatusMensageria;
  pendingCount?: number;
  onOpenWhatsAppModal: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

const RAIL_ITEMS: Array<{
  id: StudioNavSection;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { id: "agentes", label: "Agentes e Chats", Icon: Bot },
  { id: "fluxos", label: "Fluxos de Trabalho", Icon: GitBranch },
  { id: "tarefas", label: "Fila e Tarefas", Icon: WalletCards },
  { id: "uso", label: "Uso e Cotas", Icon: Activity },
  { id: "arquivos", label: "Arquivos e ImagePaths", Icon: FolderOpen },
  { id: "conexoes", label: "Conexões e Cofre", Icon: Plug },
];

function ringStrokeColor(percent: number): string {
  if (percent >= 50) return "#31CF76";
  if (percent >= 20) return "#FDCB6E";
  return "#FF7675";
}

function flattenAccountBars(
  grupos: GrupoCotaConta[]
): Array<{ key: string; rotulo: string; restante: number; resetaTexto: string }> {
  const rows: Array<{ key: string; rotulo: string; restante: number; resetaTexto: string }> = [];
  const multipleGroups = grupos.length > 1;
  for (const g of grupos) {
    if (g.janela_5h) {
      rows.push({
        key: `${g.nome}-5h`,
        rotulo: multipleGroups ? `${g.nome} · 5h` : "5 horas",
        restante: Math.max(0, Math.min(100, g.janela_5h.restante_percentual)),
        resetaTexto: g.janela_5h.reseta_em_texto,
      });
    }
    if (g.janela_semanal) {
      rows.push({
        key: `${g.nome}-semanal`,
        rotulo: multipleGroups ? `${g.nome} · Semanal` : "Semanal",
        restante: Math.max(0, Math.min(100, g.janela_semanal.restante_percentual)),
        resetaTexto: g.janela_semanal.reseta_em_texto,
      });
    }
  }
  return rows;
}

function summarizeRingPercentages(grupos: GrupoCotaConta[]): number[] {
  if (!grupos || grupos.length === 0) return [100];
  const weeklyPcts = grupos
    .map((g) => g.janela_semanal?.restante_percentual)
    .filter((v): v is number => typeof v === "number");
  const fiveHourPcts = grupos
    .map((g) => g.janela_5h?.restante_percentual)
    .filter((v): v is number => typeof v === "number");

  const outer = weeklyPcts.length > 0 ? Math.min(...weeklyPcts) : undefined;
  const inner = fiveHourPcts.length > 0 ? Math.min(...fiveHourPcts) : undefined;

  if (outer !== undefined && inner !== undefined) return [outer, inner];
  if (outer !== undefined) return [outer];
  if (inner !== undefined) return [inner];
  return [100];
}

function providerDisplayTitle(acc: ContaProvedorInfo): string {
  if (acc.provedor === "openai") return acc.email ? `ChatGPT · ${acc.email}` : "ChatGPT";
  if (acc.provedor === "claude") return acc.email ? `Claude · ${acc.email}` : "Claude";
  return acc.email ?? acc.rotulo ?? acc.id;
}

const ConcentricQuotaRings: React.FC<{
  percentages: number[];
  inactive?: boolean;
  provider?: ProviderName;
}> = ({ percentages, inactive = false, provider }) => {
  const safePercents = percentages.length > 0 ? percentages.slice(0, 2) : [100];
  // Dois anéis externos (Semanal + 5h) mantendo miolo livre para o ProviderLogo centralizado
  const radii = [14.5, 11.4];

  return (
    <span className="relative inline-flex items-center justify-center w-[34px] h-[34px]">
      <svg width="34" height="34" viewBox="0 0 34 34" className="-rotate-90">
        {safePercents.map((pct, idx) => {
          const r = radii[idx] ?? 11.4;
          const clamped = Math.max(4, Math.min(100, pct));
          const circ = 2 * Math.PI * r;
          const offset = circ - (clamped / 100) * circ;
          return (
            <g key={`${r}-${idx}`}>
              <circle
                cx="17"
                cy="17"
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="2.1"
              />
              <circle
                cx="17"
                cy="17"
                r={r}
                fill="none"
                stroke={inactive ? "rgba(255,255,255,0.28)" : ringStrokeColor(pct)}
                strokeWidth="2.1"
                strokeDasharray={circ}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>
      {provider && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <ProviderLogo provider={provider} size={11} />
        </span>
      )}
    </span>
  );
};

/**
 * Trilho de navegação vertical estreito à esquerda (52px) espelhando o OpenBot Desktop,
 * com anéis concêntricos reais por conta conectada e popover de cotas ao vivo.
 */
export const WorkspaceRail: React.FC<WorkspaceRailProps> = ({
  activeSection,
  onSelectSection,
  quotaPercent = 96,
  uso,
  onRefreshUsage,
  whatsappStatus,
  pendingCount = 0,
  onOpenWhatsAppModal,
  onOpenSettings,
  onOpenHelp,
}) => {
  const [activeProvider, setActiveProvider] = useState<ProviderName | null>(null);
  const [fallbackPopoverOpen, setFallbackPopoverOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const allAccounts = uso?.contas ?? [];
  const providerGroups = useMemo<
    Array<{
      provedor: ProviderName;
      primary: ContaProvedorInfo;
      accounts: ContaProvedorInfo[];
    }>
  >(() => {
    const withQuota = allAccounts.filter((c) => c.grupos_cota && c.grupos_cota.length > 0);
    const byProv = new Map<ProviderName, ContaProvedorInfo[]>();
    for (const acc of withQuota) {
      const list = byProv.get(acc.provedor) ?? [];
      list.push(acc);
      byProv.set(acc.provedor, list);
    }
    const order: ProviderName[] = ["openai", "claude", "gemini", "grok", "opencode", "ollama"];
    return order
      .filter((p) => (byProv.get(p)?.length ?? 0) > 0)
      .map((provedor) => {
        const accounts = byProv.get(provedor)!;
        const primary = accounts.find((a) => a.padrao) ?? accounts[0];
        return { provedor, primary, accounts };
      });
  }, [allAccounts]);

  const popoverOpen = activeProvider !== null || (providerGroups.length === 0 && fallbackPopoverOpen);
  const popoverAccounts = useMemo<ContaProvedorInfo[]>(() => {
    if (!activeProvider) return [];
    return providerGroups.find((g) => g.provedor === activeProvider)?.accounts ?? [];
  }, [providerGroups, activeProvider]);

  const fallbackPercent = Math.max(5, Math.min(100, quotaPercent));
  const hasAnyConnectedAccount = allAccounts.length > 0;

  const handleRefresh = async () => {
    if (!onRefreshUsage || refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshUsage();
    } finally {
      setRefreshing(false);
    }
  };

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

      {/* Rodapé: anéis concêntricos de cota + WhatsApp móvel + Ajuda + Configurações */}
      <div
        className="relative flex flex-col items-center gap-1.5 w-full px-1.5"
        onMouseLeave={() => {
          setActiveProvider(null);
          setFallbackPopoverOpen(false);
        }}
      >
        {/* Anéis concêntricos reais: 1 anel por provedor com logo centralizado; hover exibe só aquele provedor */}
        <div className="flex flex-col items-center gap-1.5">
          {providerGroups.length > 0 ? (
            providerGroups.map(({ provedor, primary }) => {
              const bars = flattenAccountBars(primary.grupos_cota);
              const percents = bars.map((b) => b.restante);
              const ringPercents = summarizeRingPercentages(primary.grupos_cota);
              const minPct = percents.length > 0 ? Math.min(...percents) : 100;
              const isSelectedRing = activeProvider === provedor;
              return (
                <button
                  key={provedor}
                  type="button"
                  onMouseEnter={() => setActiveProvider(provedor)}
                  onClick={() =>
                    setActiveProvider((prev) => (prev === provedor ? null : provedor))
                  }
                  onDoubleClick={() => onSelectSection("uso")}
                  title={`${providerDisplayTitle(primary)} — mínimo ${minPct}% restante`}
                  aria-label={`Uso da conta ${providerDisplayTitle(primary)}: ${minPct}% restante`}
                  className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
                    isSelectedRing ? "bg-[#1A1A1A]" : "hover:bg-[#1A1A1A]"
                  }`}
                >
                  <ConcentricQuotaRings percentages={ringPercents} provider={provedor} />
                </button>
              );
            })
          ) : (
            <button
              type="button"
              onMouseEnter={() => setFallbackPopoverOpen(true)}
              onClick={() => setFallbackPopoverOpen((v) => !v)}
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

        {/* Popover flutuante 'Uso' mostrando exclusivamente o provedor do anel em hover */}
        {popoverOpen && (
          <div
            role="dialog"
            aria-label="Resumo de uso e cotas do provedor"
            className="absolute left-[54px] bottom-14 w-[315px] rounded-2xl bg-[#1C1C1C]/98 backdrop-blur-xl border border-white/[0.11] shadow-2xl p-3.5 z-50 text-left"
          >
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  setActiveProvider(null);
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
                    setActiveProvider(null);
                    setFallbackPopoverOpen(false);
                    onSelectSection("uso");
                  }}
                  className="text-[11px] text-[#979797] hover:text-white px-2 py-0.5 rounded-lg bg-white/[0.05]"
                >
                  Ver relatório
                </button>
              </div>
            </div>

            <div className="mt-2.5 space-y-3 max-h-[340px] overflow-y-auto pr-0.5">
              {popoverAccounts.length > 0 ? (
                popoverAccounts.map((acc) => {
                  const bars = flattenAccountBars(acc.grupos_cota);
                  return (
                    <div key={acc.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-white">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <ProviderLogo provider={acc.provedor} size={13} />
                          <span className="truncate">
                            {acc.provedor === "openai"
                              ? "ChatGPT"
                              : acc.provedor === "claude"
                                ? "Claude"
                                : "Gemini"}
                          </span>
                        </span>
                        {acc.email && (
                          <span className="text-[10.5px] font-normal text-[#787878] truncate max-w-[175px]">
                            {acc.email}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {bars.map((bar) => (
                          <div
                            key={bar.key}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="text-[#979797] truncate w-[108px]">{bar.rotulo}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${bar.restante}%`,
                                  backgroundColor:
                                    bar.restante >= 50
                                      ? "#DCDCDC"
                                      : bar.restante >= 20
                                        ? "#FDCB6E"
                                        : "#FF7675",
                                }}
                              />
                            </div>
                            <span
                              className={`font-semibold shrink-0 tabular-nums ${
                                bar.restante >= 50
                                  ? "text-white"
                                  : bar.restante >= 20
                                    ? "text-[#FDCB6E]"
                                    : "text-[#FF7675]"
                              }`}
                            >
                              {bar.restante}% restante
                            </span>
                            {bar.resetaTexto && (
                              <span className="text-[#787878] text-[10px] shrink-0 tabular-nums">
                                {bar.resetaTexto}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
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
                    Clique em <strong>↻</strong> acima para sincronizar as janelas de cota.
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
                      setActiveProvider(null);
                      setFallbackPopoverOpen(false);
                      onSelectSection("conexoes");
                    }}
                    className="openbot-btn-primary w-full py-1.5 text-[11.5px] text-center"
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
          className="h-9 w-9 rounded-xl flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#1A1A1A] transition-colors"
        >
          <Settings className="h-[17px] w-[17px]" />
        </button>
      </div>
    </aside>
  );
};
