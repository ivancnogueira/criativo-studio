import React, { useMemo, useState } from "react";
import type {
  ConectorIntegracaoInfo,
  HabilidadeInstaladaInfo,
  ProviderName,
  ProvedorStatusInfo,
  ShowcaseSiteSummary,
} from "@criativo/contracts";
import {
  Bot,
  Cpu,
  Globe,
  KeyRound,
  Plug,
  Sparkles,
} from "lucide-react";
import type { ConnectorsPageProps, HubSectionTab } from "./connectors-types";

export function useConnectorsController(props: ConnectorsPageProps) {
  const {
    provedores,
    vaultKeys,
    whatsappStatus,
    onSaveVaultSecret,
    agentes = [],
    habilidades = [],
    conectores,
    initialDetailProviderId = null,
    onRefreshProviders,
    onConfigureConnector,
    onTestConnector,
    showcaseSites = []
  } = props;

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


  return {
    hubTab,
    setHubTab,
    sidebarSearch,
    setSidebarSearch,
    selectedConnectorId,
    setSelectedConnectorId,
    activeDetailProvider,
    setActiveDetailProvider,
    authorizingProvider,
    setAuthorizingProvider,
    authError,
    setAuthError,
    vaultKeyDraftName,
    setVaultKeyDraftName,
    vaultKeyDraftVal,
    setVaultKeyDraftVal,
    connectorSecretDrafts,
    setConnectorSecretDrafts,
    connectorAgentDrafts,
    setConnectorAgentDrafts,
    mcpNameDraft,
    setMcpNameDraft,
    mcpCmdDraft,
    setMcpCmdDraft,
    mcpArgsDraft,
    setMcpArgsDraft,
    testResult,
    setTestResult,
    testingConnector,
    setTestingConnector,
    refreshingLive,
    setRefreshingLive,
    toast,
    setToast,
    skillQuery,
    setSkillQuery,
    skillFilter,
    setSkillFilter,
    inspectedSkill,
    setInspectedSkill,
    copiedWebhookId,
    setCopiedWebhookId,
    showcaseSlug,
    setShowcaseSlug,
    showcaseTitle,
    setShowcaseTitle,
    showcaseDesc,
    setShowcaseDesc,
    showcaseSourceDir,
    setShowcaseSourceDir,
    showcaseSpa,
    setShowcaseSpa,
    pendingPublishApproval,
    setPendingPublishApproval,
    replacingSite,
    setReplacingSite,
    replaceSourceDir,
    setReplaceSourceDir,
    confirmDeleteSiteId,
    setConfirmDeleteSiteId,
    showcaseBusy,
    setShowcaseBusy,
    showToast,
    effectiveConnectors,
    activeConnector,
    filteredSkills,
    handleRefreshLive,
    handleSaveConnector,
    handleTest,
    navSections,
    visibleNavSections,
    activeSectionTitle
  };
}

export type ConnectorsController = ReturnType<typeof useConnectorsController>;
