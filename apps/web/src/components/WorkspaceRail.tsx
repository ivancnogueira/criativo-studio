import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CalendarClock,
  FolderOpen,
  GitBranch,
  HelpCircle,
  Plug,
  RefreshCw,
  Settings,
  Smartphone,
  Store,
  WalletCards,
  Workflow,
} from "lucide-react";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ProviderName,
  ServerQuotaSummary,
  StatusMensageria,
  StudioServerRecord,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import { MascoteAvatar } from "./MascoteAvatar";
import { ProviderLogo } from "./ProviderLogo";
import { ServerSwitcherPopover } from "../features/servers/ServerSwitcherPopover";

export type StudioNavSection =
  | "agentes"
  | "rotinas"
  | "fluxos"
  | "tarefas"
  | "agenda"
  | "uso"
  | "arquivos"
  | "loja"
  | "conexoes"
  | "configuracoes";

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
  servers?: StudioServerRecord[];
  activeServerId?: string;
  serverQuota?: ServerQuotaSummary | null;
  onSelectServer?: (serverId: string) => void;
  onOpenNewLocalServer?: () => void;
  onOpenNewRemoteServer?: () => void;
  onOpenJoinServer?: () => void;
  onOpenServerSettings?: (server: StudioServerRecord) => void;
  onOpenDisplaySettings?: () => void;
}

const RAIL_ITEMS: Array<{
  id: StudioNavSection;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { id: "agentes", label: "Estúdio", Icon: Bot },
  { id: "fluxos", label: "Automações", Icon: GitBranch },
  { id: "tarefas", label: "Tarefas", Icon: WalletCards },
  { id: "agenda", label: "Calendário", Icon: CalendarClock },
  { id: "uso", label: "Consumo", Icon: Activity },
  { id: "arquivos", label: "Biblioteca", Icon: FolderOpen },
  { id: "loja", label: "Catálogo", Icon: Store },
  { id: "conexoes", label: "Integrações", Icon: Plug },
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

export function summarizeRingPercentages(grupos: GrupoCotaConta[]): number[] {
  if (!grupos || grupos.length === 0) return [100];
  const out: number[] = [];
  for (const g of grupos) {
    if (typeof g.janela_semanal?.restante_percentual === "number") {
      out.push(Math.max(0, Math.min(100, g.janela_semanal.restante_percentual)));
    }
    if (typeof g.janela_5h?.restante_percentual === "number") {
      out.push(Math.max(0, Math.min(100, g.janela_5h.restante_percentual)));
    }
  }
  return out.length > 0 ? out.slice(0, 5) : [100];
}

export function formatUsageWindowLabel(
  janela: NonNullable<GrupoCotaConta["janela_5h"]>["janela"],
  rotulo?: string | null
): string {
  if (janela === "semanal") return "Limite semanal";
  if (janela === "5h") return "Limite de 5h";
  if (janela === "mensal") return "Limite mensal";
  return rotulo?.trim() || "Limite";
}

export function shouldShowGroupHeading(acc: ContaProvedorInfo, grupo: GrupoCotaConta): boolean {
  if (acc.grupos_cota.length > 1) return true;
  const lower = grupo.nome.trim().toLowerCase();
  return lower !== "chatgpt" && lower !== "openai" && lower !== "padrão" && lower !== "default";
}

const MiniQuotaRing: React.FC<{ percentage: number }> = ({ percentage }) => {
  const clamped = Math.max(4, Math.min(100, percentage));
  const r = 6.6;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamped / 100) * circ;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 shrink-0" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2.1" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={ringStrokeColor(percentage)}
        strokeWidth="2.1"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
};

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
  const safePercents = percentages.length > 0 ? percentages.slice(0, 5) : [100];
  const ringCount = safePercents.length;
  // Anéis concêntricos escalonados (1 a 5 anéis, ex.: 2 janelas Gemini Models + 2 Claude/GPT + 1 Gemini 4 Argon)
  const radiiByCount: Record<number, { radii: number[]; strokeWidth: number; logoSize: number }> = {
    1: { radii: [15.2], strokeWidth: 2.1, logoSize: 11 },
    2: { radii: [15.2, 11.9], strokeWidth: 2.1, logoSize: 11 },
    3: { radii: [15.8, 12.9, 10.0], strokeWidth: 1.85, logoSize: 10 },
    4: { radii: [16.0, 13.4, 10.8, 8.2], strokeWidth: 1.6, logoSize: 9 },
    5: { radii: [16.3, 14.0, 11.7, 9.4, 7.1], strokeWidth: 1.45, logoSize: 8 },
  };
  const layout = radiiByCount[ringCount] ?? radiiByCount[5];

  return (
    <span className="relative inline-flex items-center justify-center w-[36px] h-[36px]">
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
        {safePercents.map((pct, idx) => {
          const r = layout.radii[idx] ?? 7.1;
          const clamped = Math.max(4, Math.min(100, pct));
          const circ = 2 * Math.PI * r;
          const offset = circ - (clamped / 100) * circ;
          return (
            <g key={`${r}-${idx}`}>
              <circle
                cx="18"
                cy="18"
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={layout.strokeWidth}
              />
              <circle
                cx="18"
                cy="18"
                r={r}
                fill="none"
                stroke={inactive ? "rgba(255,255,255,0.28)" : ringStrokeColor(pct)}
                strokeWidth={layout.strokeWidth}
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
          <ProviderLogo provider={provider} size={layout.logoSize} />
        </span>
      )}
    </span>
  );
};

/**
 * Trilho de navegação vertical estreito à esquerda (52px) espelhando o Criativo Studio Desktop,
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
  servers = [],
  activeServerId = "primary",
  serverQuota = null,
  onSelectServer,
  onOpenNewLocalServer,
  onOpenNewRemoteServer,
  onOpenJoinServer,
  onOpenServerSettings,
  onOpenDisplaySettings,
}) => {
  const [activeProvider, setActiveProvider] = useState<ProviderName | null>(null);
  const [fallbackPopoverOpen, setFallbackPopoverOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [serverPopoverOpen, setServerPopoverOpen] = useState(false);

  const activeServer = useMemo(
    () => servers.find((s) => s.server_id === activeServerId) ?? servers[0] ?? null,
    [servers, activeServerId]
  );

  const allAccounts = uso?.contas ?? [];
  const hasAnyMissingQuota = useMemo(
    () => allAccounts.some((c) => !c.grupos_cota || c.grupos_cota.length === 0),
    [allAccounts]
  );

  const providerGroups = useMemo<
    Array<{
      provedor: ProviderName;
      primary: ContaProvedorInfo;
      accounts: ContaProvedorInfo[];
      hasQuota: boolean;
    }>
  >(() => {
    const byProv = new Map<ProviderName, ContaProvedorInfo[]>();
    for (const acc of allAccounts) {
      const list = byProv.get(acc.provedor) ?? [];
      list.push(acc);
      byProv.set(acc.provedor, list);
    }
    const order: ProviderName[] = ["openai", "claude", "gemini", "grok", "opencode", "ollama"];
    return order
      .filter((p) => (byProv.get(p)?.length ?? 0) > 0)
      .map((provedor) => {
        const accounts = byProv.get(provedor)!;
        const withQuota = accounts.filter((c) => c.grupos_cota && c.grupos_cota.length > 0);
        const primary =
          withQuota.find((a) => a.padrao) ??
          withQuota[0] ??
          accounts.find((a) => a.padrao) ??
          accounts[0];
        return { provedor, primary, accounts, hasQuota: withQuota.length > 0 };
      });
  }, [allAccounts]);

  const popoverOpen = activeProvider !== null || (providerGroups.length === 0 && fallbackPopoverOpen);
  const popoverAccounts = useMemo<ContaProvedorInfo[]>(() => {
    if (!activeProvider) return [];
    return providerGroups.find((g) => g.provedor === activeProvider)?.accounts ?? [];
  }, [providerGroups, activeProvider]);

  const fallbackPercent = Math.max(5, Math.min(100, quotaPercent));
  const hasAnyConnectedAccount = allAccounts.length > 0;
  const autoSyncedAccountsKeyRef = useRef<string | null>(null);
  const lastAutoSyncAtRef = useRef<number>(0);

  const handleRefresh = useCallback(async () => {
    if (!onRefreshUsage || refreshing) return;
    lastAutoSyncAtRef.current = Date.now();
    setRefreshing(true);
    try {
      await onRefreshUsage();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshUsage, refreshing]);

  const triggerFallbackUsageSync = useCallback(() => {
    if (!onRefreshUsage || refreshing || allAccounts.length === 0 || !hasAnyMissingQuota) {
      return;
    }
    if (Date.now() - lastAutoSyncAtRef.current < 15_000) {
      return;
    }
    void handleRefresh();
  }, [allAccounts.length, handleRefresh, hasAnyMissingQuota, onRefreshUsage, refreshing]);

  useEffect(() => {
    if (!onRefreshUsage || allAccounts.length === 0 || !hasAnyMissingQuota) {
      return;
    }
    const key = `${activeServerId}::${allAccounts
      .map((acc) => `${acc.provedor}:${acc.id}:${acc.grupos_cota?.length ?? 0}`)
      .sort()
      .join("|")}`;
    if (autoSyncedAccountsKeyRef.current === key) {
      return;
    }
    autoSyncedAccountsKeyRef.current = key;
    void handleRefresh();
  }, [activeServerId, allAccounts, handleRefresh, hasAnyMissingQuota, onRefreshUsage]);

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
        {/* Anéis concêntricos reais: todos os anéis de cota com logo centralizado; hover exibe só aquele provedor */}
        <div className="flex flex-col items-center gap-1.5">
          {providerGroups.length > 0 ? (
            providerGroups.map(({ provedor, primary, hasQuota }) => {
              const bars = flattenAccountBars(primary.grupos_cota);
              const percents = bars.map((b) => b.restante);
              const ringPercents = hasQuota ? summarizeRingPercentages(primary.grupos_cota) : [fallbackPercent];
              const minPct = percents.length > 0 ? Math.min(...percents) : 100;
              const isSelectedRing = activeProvider === provedor;
              return (
                <button
                  key={provedor}
                  type="button"
                  onMouseEnter={() => {
                    setActiveProvider(provedor);
                    if (!hasQuota) triggerFallbackUsageSync();
                  }}
                  onClick={() => {
                    setActiveProvider((prev) => (prev === provedor ? null : provedor));
                    if (!hasQuota) triggerFallbackUsageSync();
                  }}
                  onDoubleClick={() => onSelectSection("uso")}
                  title={
                    hasQuota
                      ? `${providerDisplayTitle(primary)} — mínimo ${minPct}% restante`
                      : `${providerDisplayTitle(primary)} — conectada (clique para sincronizar)`
                  }
                  aria-label={
                    hasQuota
                      ? `Uso da conta ${providerDisplayTitle(primary)}: ${minPct}% restante`
                      : `Conta ${providerDisplayTitle(primary)} conectada`
                  }
                  className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
                    isSelectedRing ? "bg-[#1A1A1A]" : "hover:bg-[#1A1A1A]"
                  }`}
                >
                  <ConcentricQuotaRings
                    percentages={ringPercents}
                    inactive={!hasQuota}
                    provider={provedor}
                  />
                </button>
              );
            })
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

        {/* Popover flutuante 'Uso' agrupado no estilo Antigravity mostrando exclusivamente o provedor em hover */}
        {popoverOpen && (
          <div
            role="dialog"
            aria-label="Resumo de uso e cotas do provedor"
            className="absolute left-[54px] bottom-14 w-[332px] rounded-2xl bg-[#1C1C1C]/98 backdrop-blur-xl border border-white/[0.11] shadow-2xl p-3.5 z-50 text-left"
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

            <div className="mt-2.5 space-y-3 max-h-[380px] overflow-y-auto pr-0.5">
              {popoverAccounts.length > 0 ? (
                popoverAccounts.map((acc) => {
                  const hasAccountQuotas = acc.grupos_cota && acc.grupos_cota.length > 0;
                  return (
                    <div key={acc.id} className="space-y-2.5">
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
                      setActiveProvider(null);
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
