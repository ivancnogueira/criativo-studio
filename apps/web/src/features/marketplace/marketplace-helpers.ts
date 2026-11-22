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

export type MarketplaceYourAppEntry = McpServidorConfig & {
  oauthStatus?: McpOAuthStatus;
};

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

export const SKILL_CATEGORY_OPTIONS: CarbonSelectOption[] = [
  { value: "Automação & Rotinas", label: "Automação & Rotinas" },
  { value: "Conteúdo & Copy", label: "Conteúdo & Copy" },
  { value: "Design & Vídeo", label: "Design & Vídeo" },
  { value: "Pesquisa & Estratégia", label: "Pesquisa & Estratégia" },
  { value: "Integração & Dados", label: "Integração & Dados" },
];

export function slugifyLocal(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isGithubUrlCandidate(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(trimmed) ||
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)
  );
}

export function statusDotColor(server: MarketplaceYourAppEntry): string {
  if (!server.ativo || server.oauthStatus === "lost") return "#FF9412";
  if (server.ultimoErro) return "#FD2F3B";
  if (server.oauthStatus === "signing_in") return "#007CF7";
  return "#31CF76";
}

export function groupByCategory<T extends { category: string }>(
  items: readonly T[]
): Array<{ category: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const cat = item.category?.trim() || "Geral";
    const list = map.get(cat) ?? [];
    list.push(item);
    map.set(cat, list);
  }
  return Array.from(map.entries()).map(([category, list]) => ({
    category,
    items: list,
  }));
}

// ====================================================================
// Modal 1: CustomMcpModal (+ Adicionar personalizado / Editar MCP)
// ====================================================================
