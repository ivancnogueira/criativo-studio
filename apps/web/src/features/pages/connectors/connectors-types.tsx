import React, { useState } from "react";
import type {
  AgenteRegistro,
  ConectorIntegracaoInfo,
  HabilidadeInstaladaInfo,
  PacoteUpgradeInfo,
  ProvedorStatusInfo,
  ProviderName,
  ShowcaseSiteSummary,
  StatusMensageria,
} from "@criativo/contracts";
import {
  Bot,
  ChevronDown,
  Code2,
  Hash,
  Image as ImageIcon,
  MessageCircle,
  MessageSquare,
  Plug,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";

export interface ConnectorsPageProps {
  provedores: ProvedorStatusInfo[];
  vaultKeys: Array<{ chave_nome: string; atualizado_em: string }>;
  whatsappStatus: StatusMensageria;
  onConnectProvider: (provedor: ProviderName, apiKey?: string) => Promise<void>;
  onDisconnectProvider: (provedor: ProviderName) => Promise<void>;
  onSaveVaultSecret: (chave: string, valor: string) => Promise<void>;
  onOpenWhatsAppModal: () => void;
  onReopenOnboarding: () => void;
  // Props estendidas da Fase 8 (opcionais para manter compatibilidade com testes existentes)
  agentes?: AgenteRegistro[];
  habilidades?: HabilidadeInstaladaInfo[];
  conectores?: ConectorIntegracaoInfo[];
  defaultProvider?: ProviderName;
  initialDetailProviderId?: ProviderName | null;
  onSelectDefaultProvider?: (provedor: ProviderName) => Promise<void>;
  onRefreshProviders?: () => Promise<void>;
  onTogglePool?: (provedor: ProviderName, habilitado: boolean) => Promise<void>;
  onSetAccountActive?: (provedor: ProviderName, contaId: string) => Promise<void>;
  onToggleAccountExcluded?: (
    provedor: ProviderName,
    contaId: string,
    exclude: boolean
  ) => Promise<void>;
  onConnectProviderViaBrowser?: (
    provedor: "gemini" | "claude" | "openai",
    label?: string
  ) => Promise<{ ok: boolean; canceled?: boolean; erro?: string }>;
  onCancelProviderBrowserSignIn?: (
    provedor: "gemini" | "claude" | "openai"
  ) => Promise<void>;
  pendingAuthUrl?: { provedor: "gemini" | "claude" | "openai"; url: string } | null;
  activeServerName?: string;
  activeServerKind?: "primary" | "local_child" | "remote_vps" | "joined";
  onSubmitManualOAuthCallback?: (
    provedor: "claude" | "openai",
    callbackUrl: string
  ) => Promise<void>;
  onAddProviderAccount?: (
    provedor: ProviderName,
    payload: { email: string; access_token: string; label?: string }
  ) => Promise<void>;
  onRemoveProviderAccount?: (provedor: ProviderName, contaId: string) => Promise<void>;
  onSetModelsVisibility?: (provedor: ProviderName, hiddenIds: string[]) => Promise<void>;
  onConfigureConnector?: (
    conectorId: string,
    payload: {
      segredos?: Record<string, string>;
      agente_orquestrador_id?: string;
      nome?: string;
      comando?: string;
      args?: string[];
    }
  ) => Promise<void>;
  onTestConnector?: (
    conectorId: string
  ) => Promise<{ ok: boolean; mensagem: string; detalhes?: unknown }>;
  upgrades?: PacoteUpgradeInfo[];
  onInstallUpgrade?: (pacote: "bonus" | "video") => Promise<void>;
  showcaseSites?: ShowcaseSiteSummary[];
  onPublishShowcase?: (payload: {
    slug: string;
    titulo: string;
    descricao?: string;
    sourceDir: string;
    spaFallback?: boolean;
    aprovadoPorHumano: boolean;
  }) => Promise<{ ok: boolean; requiresApproval?: boolean; site?: ShowcaseSiteSummary; erro?: string }>;
  onReplaceShowcase?: (
    siteId: string,
    payload: {
      sourceDir: string;
      titulo?: string;
      descricao?: string;
      spaFallback?: boolean;
      aprovadoPorHumano: boolean;
    }
  ) => Promise<{ ok: boolean; requiresApproval?: boolean; site?: ShowcaseSiteSummary; erro?: string }>;
  onDeleteShowcase?: (siteId: string) => Promise<void>;
}

export type HubSectionTab =
  | "provedores"
  | "apps"
  | "mensageria"
  | "habilidades"
  | "showcase"
  | "cofre"
  | "logins";

export const BrandTile: React.FC<{ id: ConectorIntegracaoInfo["id"]; color: string }> = ({ id, color }) => {
  const iconMap: Record<ConectorIntegracaoInfo["id"], React.ReactNode> = {
    whatsapp: <MessageCircle className="h-5 w-5" />,
    instagram: <ImageIcon className="h-5 w-5" />,
    telegram: <Send className="h-5 w-5" />,
    elevenlabs: <Volume2 className="h-5 w-5" />,
    fish_audio: <Sparkles className="h-5 w-5" />,
    mcp: <Plug className="h-5 w-5" />,
    slack: <Hash className="h-5 w-5" />,
    discord: <MessageSquare className="h-5 w-5" />,
    github: <Code2 className="h-5 w-5" />,
  };
  return (
    <div
      className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 border border-white/10"
      style={{
        backgroundColor: `${color}1F`,
        color: id === "elevenlabs" || id === "github" ? "#F0F0F0" : color,
      }}
    >
      {iconMap[id] ?? <Plug className="h-5 w-5" />}
    </div>
  );
};

export const AgentCustomPicker: React.FC<{
  agentes: AgenteRegistro[];
  selectedId: string;
  onSelect: (id: string) => void;
}> = ({ agentes, selectedId, onSelect }) => {
  const [open, setOpen] = useState(false);
  const current = agentes.find((a) => a.agente_id === selectedId);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white hover:border-white/25 transition-colors"
      >
        <span className="flex items-center gap-2 truncate">
          <Bot className="h-3.5 w-3.5 text-[#31CF76]" />
          <span className="truncate">{current ? current.nome : selectedId || "Selecionar Criativo"}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-[#888]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-xl bg-[#212121] border border-white/15 shadow-2xl p-1 z-30">
          {agentes.map((ag) => (
            <button
              key={ag.agente_id}
              type="button"
              onClick={() => {
                onSelect(ag.agente_id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-[12px] flex items-center justify-between transition-colors ${
                ag.agente_id === selectedId
                  ? "bg-[#31CF76]/15 text-[#31CF76] font-medium"
                  : "text-[#DCDCDC] hover:bg-white/[0.06]"
              }`}
            >
              <span className="truncate">{ag.nome}</span>
              <span className="text-[10px] text-[#787878] shrink-0">{ag.agente_id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
