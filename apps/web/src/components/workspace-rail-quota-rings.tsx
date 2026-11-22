import React from "react";
import {
  Activity,
  Bot,
  CalendarClock,
  FolderOpen,
  GitBranch,
  Plug,
  Store,
  WalletCards,
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
import {
  ProviderLogo,
} from "./ProviderLogo";

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

export interface WorkspaceRailProps {
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

export const RAIL_ITEMS: Array<{
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

export function ringStrokeColor(percent: number): string {
  if (percent >= 50) return "#31CF76";
  if (percent >= 20) return "#FDCB6E";
  return "#FF7675";
}

export function flattenAccountBars(
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

export const MiniQuotaRing: React.FC<{ percentage: number }> = ({ percentage }) => {
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

export function providerDisplayTitle(acc: ContaProvedorInfo): string {
  if (acc.provedor === "openai") return acc.email ? `ChatGPT · ${acc.email}` : "ChatGPT";
  if (acc.provedor === "claude") return acc.email ? `Claude · ${acc.email}` : "Claude";
  return acc.email ?? acc.rotulo ?? acc.id;
}

export const ConcentricQuotaRings: React.FC<{
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
export const MAX_VISIBLE_ACCOUNT_RINGS = 5;
export const PROVIDER_DISPLAY_ORDER: Record<ProviderName, number> = {
  openai: 0,
  claude: 1,
  gemini: 2,
  grok: 3,
  opencode: 4,
  ollama: 5,
};

export function providerShortName(provedor: ProviderName): string {
  if (provedor === "openai") return "ChatGPT";
  if (provedor === "claude") return "Claude";
  if (provedor === "gemini") return "Gemini";
  if (provedor === "grok") return "Grok";
  if (provedor === "opencode") return "OpenCode";
  return "Ollama";
}

