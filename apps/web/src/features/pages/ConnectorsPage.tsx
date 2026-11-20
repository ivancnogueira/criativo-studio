import React, { useMemo, useState } from "react";
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
  ArrowLeft,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Globe,
  Hash,
  Image as ImageIcon,
  KeyRound,
  MessageCircle,
  MessageSquare,
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { ProvidersCatalogView } from "./ProvidersCatalogView";

interface ConnectorsPageProps {
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

type HubSectionTab = "provedores" | "apps" | "habilidades" | "showcase" | "cofre";

const BrandTile: React.FC<{ id: ConectorIntegracaoInfo["id"]; color: string }> = ({ id, color }) => {
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

const AgentCustomPicker: React.FC<{
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
          <span className="truncate">{current ? current.nome : selectedId || "Selecionar agente"}</span>
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

/**
 * Central de Conexões:
 * - Provedores de IA (multi-contas, Pool toggle, CLI version, modelos dinâmicos e cotas)
 * - Apps & Canais (WhatsApp, Instagram, Telegram, Slack, Discord, GitHub, Voz e MCP sem dropdown nativo)
 * - Showcase Local (Publicação aprovada de entregáveis estáticos em /showcase/:slug/)
 * - Habilidades (leitura ao vivo de SKILL.md instalados na máquina)
 */
export const ConnectorsPage: React.FC<ConnectorsPageProps> = ({
  provedores,
  vaultKeys,
  whatsappStatus,
  onConnectProvider,
  onDisconnectProvider,
  onSaveVaultSecret,
  onOpenWhatsAppModal,
  onReopenOnboarding,
  agentes = [],
  habilidades = [],
  conectores,
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
  onAddProviderAccount,
  onRemoveProviderAccount,
  onSetModelsVisibility,
  onConfigureConnector,
  onTestConnector,
  upgrades = [],
  onInstallUpgrade,
  showcaseSites = [],
  onPublishShowcase,
  onReplaceShowcase,
  onDeleteShowcase,
}) => {
  const [hubTab, setHubTab] = useState<HubSectionTab>("provedores");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const [activeDetailProvider, setActiveDetailProvider] = useState<ProvedorStatusInfo | null>(() =>
    initialDetailProviderId
      ? provedores.find((p) => p.provedor === initialDetailProviderId) ?? null
      : null
  );

  const [authorizingProvider, setAuthorizingProvider] = useState<string | null>(null);
  const [authError, setAuthError] = useState<{ provedor: ProviderName; message: string } | null>(null);

  const [vaultKeyDraftName, setVaultKeyDraftName] = useState("");
  const [vaultKeyDraftVal, setVaultKeyDraftVal] = useState("");

  const [connectorSecretDrafts, setConnectorSecretDrafts] = useState<Record<string, string>>({});
  const [connectorAgentDrafts, setConnectorAgentDrafts] = useState<Record<string, string>>({});
  const [mcpNameDraft, setMcpNameDraft] = useState("");
  const [mcpCmdDraft, setMcpCmdDraft] = useState("");
  const [mcpArgsDraft, setMcpArgsDraft] = useState("");

  const [testResult, setTestResult] = useState<{
    conectorId: string;
    ok: boolean;
    mensagem: string;
  } | null>(null);
  const [testingConnector, setTestingConnector] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [skillQuery, setSkillQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"todas" | "criativo" | "sistema">("todas");
  const [inspectedSkill, setInspectedSkill] = useState<HabilidadeInstaladaInfo | null>(null);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);
  const [showcaseSlug, setShowcaseSlug] = useState("");
  const [showcaseTitle, setShowcaseTitle] = useState("");
  const [showcaseDesc, setShowcaseDesc] = useState("");
  const [showcaseSourceDir, setShowcaseSourceDir] = useState("saidas/");
  const [showcaseSpa, setShowcaseSpa] = useState(true);
  const [pendingPublishApproval, setPendingPublishApproval] = useState(false);
  const [replacingSite, setReplacingSite] = useState<ShowcaseSiteSummary | null>(null);
  const [replaceSourceDir, setReplaceSourceDir] = useState("");
  const [confirmDeleteSiteId, setConfirmDeleteSiteId] = useState<string | null>(null);
  const [showcaseBusy, setShowcaseBusy] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Fallback de lista de conectores se a prop ainda não tiver carregado do backend
  const effectiveConnectors: ConectorIntegracaoInfo[] = useMemo(() => {
    if (conectores && conectores.length > 0) return conectores;
    const hasKey = (k: string) => vaultKeys.some((v) => v.chave_nome === k);
    return [
      {
        id: "whatsapp",
        nome: "WhatsApp",
        categoria: "mensageria",
        descricao: "Receba áudios e briefings pelo WhatsApp (Baileys QR) e aprove prévias com '1'.",
        subtitulo: "Canal direto do Studio",
        status: whatsappStatus === "conectado" ? "conectado" : whatsappStatus === "aguardando_qrcode" ? "atencao" : "desconectado",
        resumo_estado: whatsappStatus === "conectado" ? "Pareado e ativo" : "Não conectado",
        cor_marca: "#25D366",
        agente_orquestrador_id: "estrategista",
        detalhes: [{ chave: "whatsapp_pairing", rotulo: "Pareamento Baileys", configurado: whatsappStatus === "conectado" }],
      },
      {
        id: "instagram",
        nome: "Instagram (Meta Graph API)",
        categoria: "publicacao",
        descricao: "Publique Posts, Carrosséis e Reels oficialmente após aprovação humana obrigatória.",
        subtitulo: "Meta Graph API + Métricas",
        status: hasKey("instagram_access_token") && hasKey("instagram_business_account_id") ? "conectado" : "desconectado",
        resumo_estado: hasKey("instagram_access_token") ? "Credenciais no Cofre" : "Não configurado",
        cor_marca: "#E1306C",
        agente_orquestrador_id: "publicador_meta",
        detalhes: [
          { chave: "instagram_access_token", rotulo: "Instagram Access Token", configurado: hasKey("instagram_access_token") },
          { chave: "instagram_business_account_id", rotulo: "Instagram Business Account ID", configurado: hasKey("instagram_business_account_id") },
        ],
      },
      {
        id: "telegram",
        nome: "Telegram Bot",
        categoria: "mensageria",
        descricao: "Notificações e aprovações em 1 toque direto no Telegram.",
        subtitulo: "Bot API oficial",
        status: hasKey("telegram_bot_token") ? "conectado" : "desconectado",
        resumo_estado: hasKey("telegram_bot_token") ? "Token salvo no Cofre" : "Não configurado",
        cor_marca: "#26A5E4",
        agente_orquestrador_id: "estrategista",
        detalhes: [{ chave: "telegram_bot_token", rotulo: "Telegram Bot Token", configurado: hasKey("telegram_bot_token") }],
      },
      {
        id: "elevenlabs",
        nome: "ElevenLabs Voice",
        categoria: "voz",
        descricao: "Síntese vocal realista em pt-br com clonagem de voz para Reels Faceless.",
        subtitulo: "Narração TTS Premium",
        status: hasKey("elevenlabs_api_key") ? "conectado" : "desconectado",
        resumo_estado: hasKey("elevenlabs_api_key") ? "API Key salva" : "Opcional (fallback edge-tts)",
        cor_marca: "#F0F0F0",
        detalhes: [{ chave: "elevenlabs_api_key", rotulo: "ElevenLabs API Key", configurado: hasKey("elevenlabs_api_key") }],
      },
      {
        id: "fish_audio",
        nome: "Fish Audio",
        categoria: "voz",
        descricao: "Voz expressiva de baixa latência para vídeos curtos e anúncios.",
        subtitulo: "TTS de baixa latência",
        status: hasKey("fish_audio_api_key") ? "conectado" : "desconectado",
        resumo_estado: hasKey("fish_audio_api_key") ? "API Key salva" : "Não configurado",
        cor_marca: "#00B4D8",
        detalhes: [{ chave: "fish_audio_api_key", rotulo: "Fish Audio API Key", configurado: hasKey("fish_audio_api_key") }],
      },
      {
        id: "mcp",
        nome: "Servidores MCP",
        categoria: "sistema",
        descricao: "Conecte servidores Model Context Protocol aos 15 agentes do estúdio.",
        subtitulo: "Ferramentas externas",
        status: "desconectado",
        resumo_estado: "Nenhum servidor externo",
        cor_marca: "#74B9FF",
        detalhes: [],
      },
      {
        id: "slack",
        nome: "Slack",
        categoria: "mensageria",
        descricao: "Menções, eventos e notificações em canais via Bot Token e Signing Secret.",
        subtitulo: "Events API + Notificações",
        status: hasKey("slack_bot_token") && hasKey("slack_signing_secret") ? "conectado" : "desconectado",
        resumo_estado: hasKey("slack_bot_token") ? "Credenciais no Cofre" : "Não configurado",
        cor_marca: "#E01E5A",
        agente_orquestrador_id: "estrategista",
        detalhes: [
          { chave: "slack_bot_token", rotulo: "Slack Bot Token (xoxb-...)", configurado: hasKey("slack_bot_token") },
          { chave: "slack_signing_secret", rotulo: "Slack Signing Secret", configurado: hasKey("slack_signing_secret") },
        ],
      },
      {
        id: "discord",
        nome: "Discord",
        categoria: "mensageria",
        descricao: "Comandos, interações Ed25519 e entregas via Bot Token ou Webhook.",
        subtitulo: "Interactions & Webhook",
        status: hasKey("discord_bot_token") || hasKey("discord_webhook_url") ? "conectado" : "desconectado",
        resumo_estado: hasKey("discord_bot_token") || hasKey("discord_webhook_url") ? "Credenciais no Cofre" : "Não configurado",
        cor_marca: "#5865F2",
        agente_orquestrador_id: "estrategista",
        detalhes: [
          { chave: "discord_bot_token", rotulo: "Discord Bot Token", configurado: hasKey("discord_bot_token") },
          { chave: "discord_public_key", rotulo: "Discord Public Key (Ed25519)", configurado: hasKey("discord_public_key") },
          { chave: "discord_webhook_url", rotulo: "Discord Webhook URL", configurado: hasKey("discord_webhook_url") },
        ],
      },
      {
        id: "github",
        nome: "GitHub",
        categoria: "sistema",
        descricao: "Webhooks HMAC-SHA256 de push/release/issue e automações via PAT.",
        subtitulo: "Repos, Issues & Releases",
        status: hasKey("github_token") ? "conectado" : "desconectado",
        resumo_estado: hasKey("github_token") ? "Credenciais no Cofre" : "Não configurado",
        cor_marca: "#F0F0F0",
        agente_orquestrador_id: "estrategista",
        detalhes: [
          { chave: "github_token", rotulo: "GitHub Personal Access Token", configurado: hasKey("github_token") },
          { chave: "github_webhook_secret", rotulo: "GitHub Webhook Secret", configurado: hasKey("github_webhook_secret") },
        ],
      },
    ];
  }, [conectores, vaultKeys, whatsappStatus]);

  const activeConnector = useMemo(
    () => effectiveConnectors.find((c) => c.id === selectedConnectorId) ?? null,
    [effectiveConnectors, selectedConnectorId]
  );

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return habilidades.filter((sk) => {
      if (skillFilter === "criativo" && sk.categoria === "sistema") return false;
      if (skillFilter === "sistema" && sk.categoria !== "sistema") return false;
      if (!q) return true;
      return (
        sk.nome.toLowerCase().includes(q) ||
        sk.id.toLowerCase().includes(q) ||
        sk.descricao.toLowerCase().includes(q)
      );
    });
  }, [habilidades, skillQuery, skillFilter]);

  const handleRefreshLive = async () => {
    if (!onRefreshProviders || refreshingLive) return;
    setRefreshingLive(true);
    try {
      await onRefreshProviders();
      showToast("Contas, CLIs e modelos atualizados em tempo real.");
    } finally {
      setRefreshingLive(false);
    }
  };

  const handleSaveConnector = async (conn: ConectorIntegracaoInfo) => {
    const segredos: Record<string, string> = {};
    for (const det of conn.detalhes) {
      const val = (connectorSecretDrafts[det.chave] ?? "").trim();
      if (val.length > 0 && det.chave !== "whatsapp_pairing") {
        segredos[det.chave] = val;
      }
    }
    const agentId = connectorAgentDrafts[conn.id] ?? conn.agente_orquestrador_id ?? undefined;

    if (onConfigureConnector) {
      await onConfigureConnector(conn.id, {
        segredos: Object.keys(segredos).length > 0 ? segredos : undefined,
        agente_orquestrador_id: agentId,
        ...(conn.id === "mcp" && mcpNameDraft.trim() && mcpCmdDraft.trim()
          ? {
              nome: mcpNameDraft.trim(),
              comando: mcpCmdDraft.trim(),
              args: mcpArgsDraft
                .split(/\s+/)
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
      });
    } else {
      for (const [k, v] of Object.entries(segredos)) {
        await onSaveVaultSecret(k, v);
      }
    }

    setConnectorSecretDrafts((prev) => {
      const next = { ...prev };
      for (const det of conn.detalhes) delete next[det.chave];
      return next;
    });
    if (conn.id === "mcp") {
      setMcpNameDraft("");
      setMcpCmdDraft("");
      setMcpArgsDraft("");
    }
    showToast(`${conn.nome} salvo com segurança no Cofre AES-256-GCM.`);
  };

  const handleTest = async (conn: ConectorIntegracaoInfo) => {
    if (!onTestConnector || testingConnector) return;
    setTestingConnector(true);
    try {
      const res = await onTestConnector(conn.id);
      setTestResult({ conectorId: conn.id, ok: res.ok, mensagem: res.mensagem });
    } finally {
      setTestingConnector(false);
    }
  };

  const navSections: Array<{
    key: HubSectionTab;
    rotulo: string;
    keywords: string;
    contagem: number;
    icone: React.ReactNode;
  }> = [
    {
      key: "provedores",
      rotulo: "Provedores de IA",
      keywords: "provedores gemini claude chatgpt openai opencode grok ollama modelos contas oauth",
      contagem: provedores.filter((p) => p.conectado).length,
      icone: <Cpu className="h-4 w-4 shrink-0" />,
    },
    {
      key: "apps",
      rotulo: "Apps & Canais",
      keywords: "apps canais whatsapp instagram telegram elevenlabs voz mcp meta",
      contagem: effectiveConnectors.filter((c) => c.status === "conectado").length,
      icone: <Plug className="h-4 w-4 shrink-0" />,
    },
    {
      key: "habilidades",
      rotulo: "Habilidades (Skills)",
      keywords: "habilidades skills carrossel reels copywriter criativo gsd",
      contagem: habilidades.length,
      icone: <Sparkles className="h-4 w-4 shrink-0" />,
    },
    {
      key: "showcase",
      rotulo: "Showcase Local",
      keywords: "showcase sites estaticos entregaveis html deploy local",
      contagem: showcaseSites.length,
      icone: <Globe className="h-4 w-4 shrink-0" />,
    },
    {
      key: "cofre",
      rotulo: "Cofre (Vault)",
      keywords: "cofre vault chaves api secrets aes-256-gcm tokens",
      contagem: vaultKeys.length,
      icone: <KeyRound className="h-4 w-4 shrink-0" />,
    },
  ];

  const visibleNavSections = navSections.filter((s) => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return true;
    return s.rotulo.toLowerCase().includes(q) || s.keywords.includes(q);
  });

  const activeSectionTitle =
    navSections.find((s) => s.key === hubTab)?.rotulo ?? "Provedores de IA";

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
                onShowToast={showToast}
              />
            )}

        {/* ABA 2: APPS & CANAIS (Marketplace Grid + IntegrationPage sem selects crus) */}
        {hubTab === "apps" && (
          <div className="space-y-4">
            {!activeConnector ? (
              <>
                <div className="rounded-2xl bg-[#202020] border border-white/[0.07] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-[#31CF76]" />
                    <div className="text-[12.5px] text-[#DCDCDC]">
                      <strong>Trava Segura Meta API ativa:</strong> nenhuma arte ou Reels é publicado sem sua aprovação explícita no Cockpit ou via &ldquo;1&rdquo; no WhatsApp.
                    </div>
                  </div>
                  <span className="rounded-full bg-[#31CF76]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#31CF76] shrink-0">
                    Cofre AES-256-GCM
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {effectiveConnectors.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => {
                        setSelectedConnectorId(conn.id);
                        setTestResult(null);
                      }}
                      className="rounded-2xl bg-[#202020] hover:bg-[#252525] border border-white/[0.07] hover:border-white/15 p-4 text-left flex flex-col justify-between gap-3 transition-colors"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <BrandTile id={conn.id} color={conn.cor_marca} />
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
                              conn.status === "conectado"
                                ? "bg-[#31CF76]/15 text-[#31CF76]"
                                : conn.status === "atencao"
                                  ? "bg-[#FF9412]/15 text-[#FF9412]"
                                  : "bg-white/[0.06] text-[#888]"
                            }`}
                          >
                            {conn.status === "conectado"
                              ? "Conectado"
                              : conn.status === "atencao"
                                ? "Atenção"
                                : "Configurar"}
                          </span>
                        </div>
                        <div>
                          <div className="text-[14px] font-semibold text-white">{conn.nome}</div>
                          <div className="text-[12px] text-[#888] mt-1 line-clamp-2">
                            {conn.descricao}
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-[#787878]">
                        <span className="truncate">{conn.resumo_estado}</span>
                        <span className="text-white/80 font-medium shrink-0">Abrir →</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              /* IntegrationPage dedicada para o App selecionado */
              <div className="rounded-2xl bg-[#202020] border border-white/[0.08] p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedConnectorId(null)}
                      className="h-8 w-8 rounded-xl bg-[#161616] border border-white/10 flex items-center justify-center text-[#B5B5B5] hover:text-white"
                      aria-label="Voltar para lista de Apps"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <BrandTile id={activeConnector.id} color={activeConnector.cor_marca} />
                    <div>
                      <h2 className="text-[16px] font-semibold text-white">{activeConnector.nome}</h2>
                      <p className="text-[12px] text-[#888]">{activeConnector.descricao}</p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                      activeConnector.status === "conectado"
                        ? "bg-[#31CF76]/15 text-[#31CF76]"
                        : "bg-white/[0.06] text-[#979797]"
                    }`}
                  >
                    {activeConnector.resumo_estado}
                  </span>
                </div>

                {/* Ação especial WhatsApp Baileys QR */}
                {activeConnector.id === "whatsapp" && (
                  <div className="rounded-xl bg-[#161616] border border-white/[0.06] p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-5 w-5 text-[#25D366]" />
                      <div>
                        <div className="text-[13px] font-semibold text-white">
                          Pareamento Baileys Nativo
                        </div>
                        <div className="text-[11.5px] text-[#888]">
                          Gere o QR Code ao vivo e escaneie pelo WhatsApp no celular.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenWhatsAppModal}
                      className="studio-btn-primary px-4 py-2 text-[12px]"
                    >
                      {whatsappStatus === "conectado" ? "Gerenciar Conexão" : "Gerar QR Code"}
                    </button>
                  </div>
                )}

                {/* Campos dedicados por conector (sem dropdown nativo) */}
                {(activeConnector.id === "slack" ||
                  activeConnector.id === "discord" ||
                  activeConnector.id === "github") && (
                  <div className="rounded-xl bg-[#161616] border border-white/[0.06] p-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#979797]">
                        Endpoint local do Webhook ({activeConnector.nome})
                      </div>
                      <code className="block truncate font-mono text-[11.5px] text-[#42A0FF] mt-0.5">
                        {`${typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4190"}/api/conectores/${activeConnector.id}/webhook`}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const url = `${typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4190"}/api/conectores/${activeConnector.id}/webhook`;
                        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                          await navigator.clipboard.writeText(url);
                        }
                        setCopiedWebhookId(activeConnector.id);
                        setTimeout(() => setCopiedWebhookId(null), 2000);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#242424] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[#2A2A2A]"
                    >
                      <Copy className="h-3.5 w-3.5 text-[#42A0FF]" />
                      <span>
                        {copiedWebhookId === activeConnector.id
                          ? "Endpoint copiado!"
                          : "Copiar endpoint"}
                      </span>
                    </button>
                  </div>
                )}

                {activeConnector.id !== "whatsapp" && activeConnector.id !== "mcp" && (
                  <div className="space-y-3">
                    {activeConnector.detalhes.map((det) => (
                      <div key={det.chave} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor={`field-${det.chave}`}
                            className="text-[12px] font-medium text-[#DCDCDC] flex items-center gap-1.5"
                          >
                            <KeyRound className="h-3.5 w-3.5 text-[#42A0FF]" />
                            <span>{det.rotulo}</span>
                          </label>
                          {det.configurado && (
                            <span className="text-[11px] text-[#31CF76]">
                              {det.valor_mascarado ?? "Salvo e cifrado no Cofre"}
                            </span>
                          )}
                        </div>
                        <input
                          id={`field-${det.chave}`}
                          name={`field_${det.chave}`}
                          aria-label={det.rotulo}
                          type="password"
                          value={connectorSecretDrafts[det.chave] ?? ""}
                          onChange={(e) =>
                            setConnectorSecretDrafts((prev) => ({
                              ...prev,
                              [det.chave]: e.target.value,
                            }))
                          }
                          placeholder={
                            det.configurado
                              ? "Já salvo no Cofre — digite apenas se desejar substituir"
                              : `Cole aqui ${det.rotulo}`
                          }
                          className="w-full rounded-xl bg-[#141414] border border-white/10 px-3.5 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Servidores MCP cadastro limpo */}
                {activeConnector.id === "mcp" && (
                  <div className="space-y-3">
                    {activeConnector.detalhes.length > 0 && (
                      <div className="space-y-2">
                        {activeConnector.detalhes.map((srv) => (
                          <div
                            key={srv.chave}
                            className="rounded-xl bg-[#161616] border border-white/[0.05] px-3 py-2 flex items-center justify-between text-[12px]"
                          >
                            <span className="text-white">{srv.rotulo}</span>
                            <span className="text-[#31CF76]">Ativo</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        id="mcp-server-name"
                        name="mcp_server_name"
                        aria-label="Nome do servidor MCP"
                        type="text"
                        value={mcpNameDraft}
                        onChange={(e) => setMcpNameDraft(e.target.value)}
                        placeholder="Nome (ex: wordpress-mcp)"
                        className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
                      />
                      <input
                        id="mcp-server-cmd"
                        name="mcp_server_cmd"
                        aria-label="Comando do servidor MCP"
                        type="text"
                        value={mcpCmdDraft}
                        onChange={(e) => setMcpCmdDraft(e.target.value)}
                        placeholder="Comando (ex: npx)"
                        className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
                      />
                      <input
                        id="mcp-server-args"
                        name="mcp_server_args"
                        aria-label="Argumentos do servidor MCP"
                        type="text"
                        value={mcpArgsDraft}
                        onChange={(e) => setMcpArgsDraft(e.target.value)}
                        placeholder="Args (ex: -y @org/mcp)"
                        className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
                      />
                    </div>
                  </div>
                )}

                {/* Seletor customizado de Agente Orquestrador */}
                {agentes.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="block text-[12px] font-medium text-[#DCDCDC]">
                      Agente Orquestrador Vinculado
                    </span>
                    <AgentCustomPicker
                      agentes={agentes}
                      selectedId={
                        connectorAgentDrafts[activeConnector.id] ??
                        activeConnector.agente_orquestrador_id ??
                        agentes[0].agente_id
                      }
                      onSelect={(id) =>
                        setConnectorAgentDrafts((prev) => ({
                          ...prev,
                          [activeConnector.id]: id,
                        }))
                      }
                    />
                  </div>
                )}

                {testResult && testResult.conectorId === activeConnector.id && (
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 text-[12px] ${
                      testResult.ok
                        ? "bg-[#31CF76]/15 border-[#31CF76]/30 text-[#31CF76]"
                        : "bg-[#FF7675]/15 border-[#FF7675]/30 text-[#FF7675]"
                    }`}
                  >
                    {testResult.mensagem}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  {onTestConnector && activeConnector.id !== "mcp" && (
                    <button
                      type="button"
                      disabled={testingConnector}
                      onClick={() => void handleTest(activeConnector)}
                      className="studio-btn-secondary px-4 py-2 text-[12px] inline-flex items-center gap-1.5"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      {testingConnector ? "Testando..." : "Testar conector"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSaveConnector(activeConnector)}
                    className="studio-btn-primary px-5 py-2 text-[12px]"
                  >
                    Salvar credenciais
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA 3: HABILIDADES (Catálogo real de SKILL.md instalados + Upgrades em etapas) */}
        {hubTab === "habilidades" && (
          <div className="space-y-4">
            {upgrades.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {upgrades.map((up) => (
                  <div
                    key={up.id}
                    className="rounded-2xl bg-[#1C1C20] border border-white/[0.08] p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-white">{up.nome}</span>
                        <span
                          className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium ${
                            up.instalado
                              ? "bg-[#31CF76]/15 text-[#31CF76]"
                              : "bg-white/[0.07] text-[#B5B5B5]"
                          }`}
                        >
                          {up.instalado ? "Instalado" : "Upgrade modular"}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#979797]">{up.descricao}</p>
                      <p className="text-[11px] text-[#787878]">
                        Agentes: {up.agentes.join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
                      <code className="text-[10.5px] text-[#787878] truncate">{up.comando_cli}</code>
                      {!up.instalado && onInstallUpgrade && (
                        <button
                          type="button"
                          onClick={async () => {
                            await onInstallUpgrade(up.id);
                            showToast(`${up.nome} desbloqueado nos seus agentes!`);
                          }}
                          className="rounded-lg bg-[#F0F0F0] hover:bg-white text-[#141414] px-3 py-1 text-[11.5px] font-semibold shrink-0"
                        >
                          Ativar pacote
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="h-3.5 w-3.5 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="conn-filter-skills"
                  name="conn_filter_skills"
                  aria-label="Buscar skill instalada"
                  type="text"
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder="Buscar skill instalada (ex: carrossel, copywriter, reels)..."
                  className="w-full rounded-xl bg-[#202020] border border-white/10 pl-8 pr-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                />
              </div>

              <div className="flex items-center gap-1.5">
                {[
                  { id: "todas", rotulo: "Todas" },
                  { id: "criativo", rotulo: "Criativo AI Studio" },
                  { id: "sistema", rotulo: "Engenharia & GSD" },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSkillFilter(f.id as typeof skillFilter)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] transition-colors ${
                      skillFilter === f.id
                        ? "bg-[#2A2A2A] text-white border border-white/10"
                        : "text-[#888] hover:text-white bg-[#1D1D1D]"
                    }`}
                  >
                    {f.rotulo}
                  </button>
                ))}
              </div>
            </div>

            {filteredSkills.length === 0 ? (
              <div className="rounded-2xl bg-[#202020] border border-white/[0.07] p-6 text-center text-[12.5px] text-[#888]">
                Nenhuma skill correspondente encontrada em <code className="text-[#DCDCDC]">~/.gemini/config/skills/</code>.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredSkills.map((sk) => (
                  <div
                    key={sk.id}
                    className="rounded-2xl bg-[#202020] border border-white/[0.07] p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-white flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-[#31CF76]" />
                          {sk.nome}
                        </span>
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[#B5B5B5]">
                          {sk.categoria}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#888] line-clamp-2">{sk.descricao}</p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05] text-[11px]">
                      <span className="text-[#787878] truncate">
                        {sk.agentes_vinculados.length > 0
                          ? `Agentes: ${sk.agentes_vinculados.join(", ")}`
                          : sk.id}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectedSkill(sk)}
                        className="text-[#42A0FF] hover:underline shrink-0"
                      >
                        Inspecionar SKILL.md
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

            {/* ABA SHOWCASE LOCAL */}
            {hubTab === "showcase" && (
              <div className="space-y-5 pb-6">
                <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[16px] font-semibold text-white">
                        Publicar entregável no Showcase Local
                      </h2>
                      <p className="text-[12px] text-[#979797] mt-0.5">
                        Hospede páginas estáticas ou prévias HTML aprovadas localmente na rota{" "}
                        <code className="text-[#42A0FF]">/showcase/:slug/</code> sem expor pastas do sistema.
                      </p>
                    </div>
                    <span className="rounded-full bg-[#007CF7]/15 px-3 py-1 text-[11px] font-semibold text-[#42A0FF]">
                      Aprovação humana obrigatória
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="showcase-slug" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Slug da URL pública local
                      </label>
                      <input
                        id="showcase-slug"
                        type="text"
                        value={showcaseSlug}
                        onChange={(e) => setShowcaseSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "-"))}
                        placeholder="ex: campanha-lancamento"
                        className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="showcase-title" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Título do site
                      </label>
                      <input
                        id="showcase-title"
                        type="text"
                        value={showcaseTitle}
                        onChange={(e) => setShowcaseTitle(e.target.value)}
                        placeholder="ex: Landing Page Campanha"
                        className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="showcase-source-dir" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Pasta aprovada de origem
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="showcase-source-dir"
                          type="text"
                          value={showcaseSourceDir}
                          onChange={(e) => setShowcaseSourceDir(e.target.value)}
                          placeholder="saidas/ ou previas/"
                          className="flex-1 rounded-xl bg-[#141414] border border-white/10 px-3 py-2 font-mono text-[12px] text-white placeholder-[#6A6A6A]"
                        />
                        {["saidas/", "previas/"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setShowcaseSourceDir(preset)}
                            className={`rounded-lg border px-2.5 py-2 font-mono text-[11px] ${
                              showcaseSourceDir === preset
                                ? "border-[#007CF7] bg-[#007CF7]/15 text-[#42A0FF]"
                                : "border-white/10 bg-[#141414] text-[#979797] hover:text-white"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="showcase-desc" className="text-[11.5px] font-medium text-[#DCDCDC]">
                        Descrição
                      </label>
                      <input
                        id="showcase-desc"
                        type="text"
                        value={showcaseDesc}
                        onChange={(e) => setShowcaseDesc(e.target.value)}
                        placeholder="Resumo opcional do entregável"
                        className="w-full rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showcaseSpa}
                      onClick={() => setShowcaseSpa((v) => !v)}
                      className="inline-flex items-center gap-2 text-[12px] text-[#DCDCDC]"
                    >
                      <span
                        className={`inline-flex h-5 w-9 rounded-full border transition-colors ${
                          showcaseSpa ? "border-[#007CF7] bg-[#007CF7]" : "border-white/15 bg-[#141414]"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 translate-y-0.5 rounded-full bg-white transition-transform ${
                            showcaseSpa ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                      <span>Fallback SPA (`index.html` para rotas internas)</span>
                    </button>

                    {!pendingPublishApproval ? (
                      <button
                        type="button"
                        disabled={!showcaseSlug.trim() || !showcaseTitle.trim() || !showcaseSourceDir.trim() || !onPublishShowcase}
                        onClick={() => setPendingPublishApproval(true)}
                        className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40"
                      >
                        Publicar showcase
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 rounded-xl border border-[#FF9412]/50 bg-[#FF9412]/10 px-3 py-2">
                        <span className="text-[12px] text-[#FF9412]">
                          Confirmar publicação de <strong>/showcase/{showcaseSlug}/</strong>?
                        </span>
                        <button
                          type="button"
                          disabled={showcaseBusy}
                          onClick={async () => {
                            if (!onPublishShowcase) return;
                            setShowcaseBusy(true);
                            try {
                              const res = await onPublishShowcase({
                                slug: showcaseSlug.trim(),
                                titulo: showcaseTitle.trim(),
                                descricao: showcaseDesc.trim() || undefined,
                                sourceDir: showcaseSourceDir.trim(),
                                spaFallback: showcaseSpa,
                                aprovadoPorHumano: true,
                              });
                              if (res.ok) {
                                setShowcaseSlug("");
                                setShowcaseTitle("");
                                setShowcaseDesc("");
                                setPendingPublishApproval(false);
                                showToast("Site publicado com sucesso no Showcase Local.");
                              } else {
                                showToast(res.erro || "Não foi possível publicar o showcase.");
                              }
                            } finally {
                              setShowcaseBusy(false);
                            }
                          }}
                          className="rounded-lg bg-[#31CF76] px-3 py-1 text-[11.5px] font-semibold text-[#141414]"
                        >
                          Confirmar publicação
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPublishApproval(false)}
                          className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[11.5px] text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {showcaseSites.length === 0 ? (
                  <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-8 text-center space-y-2">
                    <Globe className="h-7 w-7 text-[#42A0FF] mx-auto" />
                    <p className="text-[13px] text-[#979797]">
                      Nenhum site publicado localmente. Publique uma pasta de entregáveis aprovada.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {showcaseSites.map((site) => (
                      <div
                        key={site.site_id}
                        className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-semibold text-white truncate">
                                {site.titulo}
                              </span>
                              <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                                {site.ativo ? "Ativo" : "Inativo"}
                              </span>
                            </div>
                            <div className="text-[11.5px] font-mono text-[#42A0FF] truncate">
                              {site.url_local || `/showcase/${site.slug}/`}
                            </div>
                            {site.descricao && (
                              <p className="text-[12px] text-[#979797] mt-0.5">{site.descricao}</p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={site.url_local || `/showcase/${site.slug}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white"
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-[#42A0FF]" />
                              <span>Abrir showcase</span>
                            </a>
                            {onReplaceShowcase && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReplacingSite(site);
                                  setReplaceSourceDir(site.source_dir || "saidas/");
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#242424] hover:bg-[#2A2A2A] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC]"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Substituir arquivos</span>
                              </button>
                            )}
                            {onDeleteShowcase && (
                              confirmDeleteSiteId === site.site_id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={showcaseBusy}
                                    onClick={async () => {
                                      setShowcaseBusy(true);
                                      try {
                                        await onDeleteShowcase(site.site_id);
                                        setConfirmDeleteSiteId(null);
                                        showToast("Site despublicado do Showcase Local.");
                                      } finally {
                                        setShowcaseBusy(false);
                                      }
                                    }}
                                    className="rounded-lg bg-[#FD2F3B] px-2.5 py-1.5 text-[11.5px] font-semibold text-white"
                                  >
                                    Confirmar despublicação
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteSiteId(null)}
                                    className="rounded-lg bg-[#2A2A2A] px-2.5 py-1.5 text-[11.5px] text-white"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteSiteId(site.site_id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 px-3 py-1.5 text-[12px] font-semibold text-[#FF7675] hover:bg-[#FD2F3B]/20"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Despublicar site</span>
                                </button>
                              )
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-[#787878] border-t border-white/[0.05] pt-2">
                          <span>Origem: {site.source_dir}</span>
                          <span>Arquivos: {site.arquivos_count ?? 0}</span>
                          {typeof site.tamanho_bytes === "number" && (
                            <span>{(site.tamanho_bytes / 1024).toFixed(1)} KB</span>
                          )}
                        </div>

                        {replacingSite?.site_id === site.site_id && onReplaceShowcase && (
                          <div className="rounded-xl border border-[#007CF7]/40 bg-[#141414] p-3 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={replaceSourceDir}
                              onChange={(e) => setReplaceSourceDir(e.target.value)}
                              aria-label="Nova pasta aprovada para substituição"
                              placeholder="saidas/..."
                              className="flex-1 rounded-lg bg-[#212121] border border-white/10 px-3 py-1.5 font-mono text-[12px] text-white"
                            />
                            <button
                              type="button"
                              disabled={showcaseBusy || !replaceSourceDir.trim()}
                              onClick={async () => {
                                setShowcaseBusy(true);
                                try {
                                  const res = await onReplaceShowcase(site.site_id, {
                                    sourceDir: replaceSourceDir.trim(),
                                    aprovadoPorHumano: true,
                                  });
                                  if (res.ok) {
                                    setReplacingSite(null);
                                    showToast("Arquivos do Showcase substituídos.");
                                  } else {
                                    showToast(res.erro || "Falha ao substituir arquivos.");
                                  }
                                } finally {
                                  setShowcaseBusy(false);
                                }
                              }}
                              className="rounded-lg bg-[#007CF7] px-3 py-1.5 text-[11.5px] font-semibold text-white"
                            >
                              Confirmar substituição
                            </button>
                            <button
                              type="button"
                              onClick={() => setReplacingSite(null)}
                              className="rounded-lg bg-[#2A2A2A] px-2.5 py-1.5 text-[11.5px] text-white"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ABA 4: COFRE (Vault AES-256-GCM) */}
            {hubTab === "cofre" && (
              <div className="space-y-5 pb-6">
                <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] px-4 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-[#31CF76] shrink-0" />
                    <div className="text-[12.5px] text-[#DCDCDC]">
                      <strong>Cofre Local AES-256-GCM:</strong> todas as chaves de API e segredos de publicação são armazenados cifrados apenas na sua máquina.
                    </div>
                  </div>
                  <span className="rounded-full bg-[#31CF76]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#31CF76] shrink-0">
                    {vaultKeys.length} chave(s)
                  </span>
                </div>

                <div className="rounded-2xl bg-[#18181A] border border-white/[0.07] divide-y divide-white/[0.05]">
                  {vaultKeys.map((item) => (
                    <div
                      key={item.chave_nome}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <KeyRound className="h-4 w-4 text-[#42A0FF] shrink-0" />
                        <span className="text-[13px] font-mono text-white truncate">
                          {item.chave_nome}
                        </span>
                      </div>
                      <span className="text-[11.5px] text-[#8E8E93] shrink-0">
                        Atualizada em {new Date(item.atualizado_em).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  ))}
                  {vaultKeys.length === 0 && (
                    <div className="px-4 py-5 text-[12.5px] text-[#8E8E93]">
                      Nenhuma chave salva no Cofre até o momento.
                    </div>
                  )}
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!vaultKeyDraftName.trim() || !vaultKeyDraftVal.trim()) return;
                    await onSaveVaultSecret(vaultKeyDraftName.trim(), vaultKeyDraftVal.trim());
                    setVaultKeyDraftName("");
                    setVaultKeyDraftVal("");
                    showToast("Segredo cifrado e salvo no Cofre.");
                  }}
                  className="rounded-2xl bg-[#18181A] border border-white/[0.07] p-4 space-y-3"
                >
                  <div className="text-[13px] font-medium text-white">Adicionar ou atualizar segredo</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      id="vault-secret-name"
                      name="vault_secret_name"
                      aria-label="Nome da chave no Cofre"
                      type="text"
                      value={vaultKeyDraftName}
                      onChange={(e) => setVaultKeyDraftName(e.target.value)}
                      placeholder="Ex: elevenlabs_api_key"
                      className="rounded-xl bg-[#111113] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                    />
                    <input
                      id="vault-secret-val"
                      name="vault_secret_val"
                      aria-label="Valor da chave no Cofre"
                      type="password"
                      value={vaultKeyDraftVal}
                      onChange={(e) => setVaultKeyDraftVal(e.target.value)}
                      placeholder="Valor secreto"
                      className="rounded-xl bg-[#111113] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder-[#6A6A6A]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="rounded-xl bg-[#F0F0F0] hover:bg-white text-[#141414] px-4 py-1.5 text-[12px] font-semibold"
                    >
                      Salvar no Cofre
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de inspeção do SKILL.md real */}
      {inspectedSkill && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setInspectedSkill(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[80vh] rounded-2xl bg-[#212121] border border-white/15 p-5 flex flex-col gap-3 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
              <div>
                <h3 className="text-[15px] font-semibold text-white">{inspectedSkill.nome}</h3>
                <p className="text-[11px] text-[#787878] truncate">{inspectedSkill.caminho}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedSkill(null)}
                className="text-[#888] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto rounded-xl bg-[#141414] border border-white/[0.06] p-3.5 text-[11.5px] text-[#DCDCDC] whitespace-pre-wrap font-mono leading-relaxed">
              {inspectedSkill.conteudo_preview}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
