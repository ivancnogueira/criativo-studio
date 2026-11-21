import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

const SAMPLE_AGENTE = {
  agente_id: "estrategista",
  nome: "Estrategista Editorial",
  papel: "Planejamento de pautas e campanhas",
  frente: "conteudo",
  modelo_padrao: "gemini-2.5-pro",
  status: "ocioso",
  skills_paths: [],
  memoria_resumo: null,
  ordem_exibicao: 1,
  config: {},
  atualizado_em: "2026-11-17T10:00:00.000Z",
};

const SAMPLE_APPS = [
  {
    slug: "canva",
    name: "Canva",
    tagline: "Crie e exporte designs direto do estúdio.",
    description: "Integração completa para gerenciar kits de marca e artes.",
    category: "Design",
    creatorName: "Canva",
    verified: true,
    featured: true,
    iconKey: "canva",
    isNative: false,
    prompts: [{ id: "p1", title: "Gerar carrossel", text: "Crie 5 slides no Canva" }],
    authFlows: [{ id: "oauth", kind: "oauth", label: "OAuth 2.1 oficial" }],
    serverTemplate: { name: "Canva MCP", transport: "http", url: "https://mcp.canva.com/mcp" },
  },
  {
    slug: "figma",
    name: "Figma",
    tagline: "Inspecione protótipos e tokens de interface.",
    description: "Conector Figma MCP oficial.",
    category: "Design",
    creatorName: "Figma",
    verified: true,
    featured: false,
    iconKey: "figma",
    isNative: false,
    prompts: [],
    authFlows: [{ id: "oauth", kind: "oauth", label: "OAuth Figma" }],
    serverTemplate: { name: "Figma MCP", transport: "http", url: "https://mcp.figma.com/mcp" },
  },
  {
    slug: "higgsfield",
    name: "Higgsfield",
    tagline: "Vídeos curtos com controle cinematográfico de câmera.",
    description: "Geração de cenas e motion.",
    category: "Design",
    creatorName: "Higgsfield",
    verified: true,
    featured: false,
    iconKey: "higgsfield",
    isNative: false,
    prompts: [],
    authFlows: [{ id: "key", kind: "key", label: "Chave de API", fields: [{ key: "api_key", label: "API Key", target: "header", secret: true }] }],
    serverTemplate: null,
  },
  {
    slug: "sunra",
    name: "Sunra",
    tagline: "Modelos criativos em tempo real.",
    description: "Pipeline multimídia em nuvem.",
    category: "Design",
    creatorName: "Sunra",
    verified: true,
    featured: false,
    iconKey: "sunra",
    isNative: false,
    prompts: [],
    authFlows: [{ id: "key", kind: "key", label: "Chave de API", fields: [{ key: "api_key", label: "API Key", target: "header", secret: true }] }],
    serverTemplate: null,
  },
];

const SAMPLE_AGENT_PACKAGES = [
  {
    slug: "diretor-criativo",
    name: "Diretor Criativo",
    role: "Coordenação visual de campanhas",
    tagline: "Coordena identidade visual e roteiros.",
    description: "Pacote completo de agente verificável para produção em equipe.",
    category: "Conteúdo & Marca",
    source: "verified",
    verified: true,
    featured: true,
    recommendedModel: "gemini-2.5-pro",
    avatarShape: "hex",
    avatarColor: "#007CF7",
    promptBase: "Coordene a direção criativa.",
    skills: ["criar-identidade-visual"],
    routines: [],
    mcpSlugs: ["canva"],
  },
];

const SAMPLE_SKILLS = [
  {
    skillId: "nativa:planejar-conteudo",
    slug: "planejar-conteudo",
    name: "Planejar Conteúdo",
    description: "Estrutura calendários e pautas mensais.",
    category: "Conteúdo & Copy",
    source: "nativa",
    verified: true,
    featured: true,
    installed: true,
    agentIds: ["estrategista"],
    enabledByAgent: { estrategista: true },
    markdownPreview: "# Planejamento Editorial",
  },
  {
    skillId: "loja:checklist-reels",
    slug: "checklist-reels",
    name: "Checklist de Reels",
    description: "Audita retenção nos primeiros 3 segundos.",
    category: "Design & Vídeo",
    source: "loja",
    verified: false,
    featured: false,
    installed: false,
    agentIds: [],
    enabledByAgent: {},
    markdownPreview: "# Checklist",
  },
];

describe("Fase 10 — UI Carbon Dark da Loja Unificada, WhatsApp Multi-Número & McpSignInChatCard", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  it("1. Renderiza WorkspaceRail com Loja e controles CarbonControls sem <select>", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const { CarbonSelect, SlidingTabs, AppBrandIcon } = await vite.ssrLoadModule(
      "/src/components/ui/CarbonControls.tsx"
    );

    const railHtml = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "loja",
        onSelectSection: () => {},
        whatsappStatus: "conectado",
        onOpenWhatsAppModal: () => {},
        onOpenSettings: () => {},
        onOpenHelp: () => {},
      })
    );
    assert.match(railHtml, /Catálogo/);
    assert.match(railHtml, /Estúdio/);
    assert.match(railHtml, /Integrações/);

    const controlsHtml = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        React.createElement(CarbonSelect, {
          ariaLabel: "Conta ativa",
          value: "acc-1",
          options: [
            { value: "acc-1", label: "Número Principal", badge: "Conectado" },
            { value: "acc-2", label: "Suporte" },
          ],
          onChange: () => {},
        }),
        React.createElement(SlidingTabs, {
          ariaLabel: "Abas",
          value: "qr",
          tabs: [
            { id: "qr", label: "QR Code" },
            { id: "pairing_code", label: "Código no telefone" },
          ],
          onChange: () => {},
        }),
        React.createElement(AppBrandIcon, { slug: "canva", name: "Canva", size: 32 })
      )
    );
    assert.match(controlsHtml, /Número Principal/);
    assert.match(controlsHtml, /role="tablist"/);
    assert.match(controlsHtml, /Código no telefone/);
    assert.doesNotMatch(controlsHtml, /<select/i);
  });

  it("2. Renderiza MarketplacePage nas 3 abas (Apps, Agentes, Habilidades), CustomMcpModal e CreateSkillModal sem <select>", async () => {
    const { MarketplacePage, CustomMcpModal, CreateSkillModal } = await vite.ssrLoadModule(
      "/src/features/marketplace/MarketplacePage.tsx"
    );

    const catalog = {
      apps: SAMPLE_APPS,
      agents: SAMPLE_AGENT_PACKAGES,
      skills: SAMPLE_SKILLS,
    };

    const appsHtml = renderToStaticMarkup(
      React.createElement(MarketplacePage, {
        agentes: [SAMPLE_AGENTE],
        initialCatalog: catalog,
        initialTab: "apps",
      })
    );
    assert.match(appsHtml, /Adicionar personalizado/);
    assert.match(appsHtml, /Canva/);
    assert.match(appsHtml, /Figma/);
    assert.match(appsHtml, /Higgsfield/);
    assert.match(appsHtml, /Sunra/);
    assert.doesNotMatch(appsHtml, /<select/i);

    const appDetailHtml = renderToStaticMarkup(
      React.createElement(MarketplacePage, {
        agentes: [SAMPLE_AGENTE],
        initialCatalog: catalog,
        initialTab: "apps",
        initialAppSlug: "canva",
      })
    );
    assert.match(appDetailHtml, /Conectar aplicativo/);
    assert.match(appDetailHtml, /Autenticar no navegador/);
    assert.match(appDetailHtml, /Acesso de agentes/);
    assert.match(appDetailHtml, /Experimentar prompt/);
    assert.doesNotMatch(appDetailHtml, /<select/i);

    const agentsHtml = renderToStaticMarkup(
      React.createElement(MarketplacePage, {
        agentes: [SAMPLE_AGENTE],
        initialCatalog: catalog,
        initialTab: "agents",
      })
    );
    assert.match(agentsHtml, /Importar repositório/);
    assert.match(agentsHtml, /Diretor Criativo/);
    assert.match(agentsHtml, /Instalar agente/);
    assert.match(agentsHtml, /Duplicar agente/);
    assert.doesNotMatch(agentsHtml, /<select/i);

    const skillsHtml = renderToStaticMarkup(
      React.createElement(MarketplacePage, {
        agentes: [SAMPLE_AGENTE],
        initialCatalog: catalog,
        initialTab: "skills",
      })
    );
    assert.match(skillsHtml, /Criar habilidade/);
    assert.match(skillsHtml, /Suas habilidades/);
    assert.match(skillsHtml, /Ativada em 1 de 1/);
    assert.match(skillsHtml, /Adicionar aos agentes/);
    assert.match(skillsHtml, /Instalar habilidade/);
    assert.doesNotMatch(skillsHtml, /<select/i);

    const mcpModalHtml = renderToStaticMarkup(
      React.createElement(CustomMcpModal, {
        open: true,
        agentes: [SAMPLE_AGENTE],
        onClose: () => {},
      })
    );
    assert.match(mcpModalHtml, /Registrar servidor MCP personalizado/);
    assert.match(mcpModalHtml, /STDIO \(Local\)/);
    assert.match(mcpModalHtml, /Streamable HTTP \(Remoto\)/);
    assert.match(mcpModalHtml, /Testar conexão/);
    assert.match(mcpModalHtml, /Registrar servidor/);
    assert.doesNotMatch(mcpModalHtml, /<select/i);

    const skillModalHtml = renderToStaticMarkup(
      React.createElement(CreateSkillModal, {
        open: true,
        agentes: [SAMPLE_AGENTE],
        onClose: () => {},
      })
    );
    assert.match(skillModalHtml, /Assistida por agente/);
    assert.match(skillModalHtml, /Definição manual/);
    assert.match(skillModalHtml, /Criar habilidade/);
    assert.doesNotMatch(skillModalHtml, /<select/i);
  });

  it("3. Renderiza WhatsAppIntegrationPanel multi-número e McpSignInChatCard inline nos 4 estados", async () => {
    const { WhatsAppIntegrationPanel, WhatsAppPairingModal } = await vite.ssrLoadModule(
      "/src/features/whatsapp/WhatsAppPairingModal.tsx"
    );
    const { McpSignInChatCard, AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx"
    );

    const wppHtml = renderToStaticMarkup(
      React.createElement(WhatsAppIntegrationPanel, {
        accounts: [
          {
            conta_id: "whatsapp-principal",
            rotulo: "Número Principal",
            numero_telefone: "+55 11 90000-0000",
            jid_proprio: "5511900000000@s.whatsapp.net",
            modo_operacao: "dedicated",
            status: "aguardando_qrcode",
            qrcode_base64: null,
            pairing_code: "1234-5678",
            notificar_aprovacoes: true,
            codigo_autorizacao_obrigatorio: true,
            grupo_auto_responder: false,
            agente_orquestrador_id: "estrategista",
            total_contatos_autorizados: 1,
            pareamentos_pendentes: 1,
            ultimo_erro: null,
            conectado_em: null,
            atualizado_em: "2026-11-17T10:00:00.000Z",
          },
        ],
        agentes: [SAMPLE_AGENTE],
        pairings: [
          {
            request_id: "req-1",
            conta_id: "whatsapp-principal",
            codigo: "AB12CD",
            remetente_jid: "5521999990000@s.whatsapp.net",
            remetente_pn: "5521999990000",
            nome_contato: "Cliente Teste",
            status: "pendente",
            criado_em: "2026-11-17T10:00:00.000Z",
            expira_em: "2026-11-17T11:00:00.000Z",
            resolvido_em: null,
          },
        ],
        contacts: [],
      })
    );
    assert.match(wppHtml, /Adicionar número/);
    assert.match(wppHtml, /QR Code/);
    assert.match(wppHtml, /Código no telefone/);
    assert.match(wppHtml, /Número dedicado/);
    assert.match(wppHtml, /Meu número \(Conversa comigo mesmo\)/);
    assert.match(wppHtml, /AB12CD/);
    assert.match(wppHtml, /Aprovar pareamento/);
    assert.match(wppHtml, /Recusar pedido/);
    assert.match(wppHtml, /9º dígito brasileiro/);
    assert.match(wppHtml, /Agente Orquestrador/);
    assert.doesNotMatch(wppHtml, /<select/i);

    const legacyModalHtml = renderToStaticMarkup(
      React.createElement(WhatsAppPairingModal, {
        open: true,
        status: "desconectado",
        qrcodeBase64: null,
        onClose: () => {},
        onConnect: async () => {},
        onDisconnect: async () => {},
      })
    );
    assert.match(legacyModalHtml, /Abra o WhatsApp &gt; Aparelhos Conectados &gt; Conectar Aparelho/);
    assert.doesNotMatch(legacyModalHtml, /<select/i);

    const pendingCard = renderToStaticMarkup(
      React.createElement(McpSignInChatCard, {
        mcpId: "mcp-canva",
        nome: "Canva MCP",
        appSlug: "canva",
        status: "pending",
        onAuthenticate: () => {},
        onOpenAppPage: () => {},
      })
    );
    assert.match(pendingCard, /Autenticar no navegador/);

    const signingCard = renderToStaticMarkup(
      React.createElement(McpSignInChatCard, {
        mcpId: "mcp-canva",
        nome: "Canva MCP",
        status: "signing_in",
        onAuthenticate: () => {},
      })
    );
    assert.match(signingCard, /Aguardando autenticação\.\.\./);

    const connectedCard = renderToStaticMarkup(
      React.createElement(McpSignInChatCard, {
        mcpId: "mcp-canva",
        nome: "Canva MCP",
        status: "connected",
        onAuthenticate: () => {},
        onRetryContinue: () => {},
      })
    );
    assert.match(connectedCard, /Continuar execução/);

    const chatHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: SAMPLE_AGENTE,
        mensagens: [],
        provedores: [],
        sending: false,
        inspectorOpen: true,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => ({
          arquivo_id: "a1",
          nome: "f.png",
          caminho_relativo: "saidas/f.png",
          url: "/arquivos/a1",
          mime_type: "image/png",
        }),
        onUpdateModelAndEffort: async () => {},
        pendingMcpSignIn: {
          mcpId: "mcp-canva",
          nome: "Canva MCP",
          appSlug: "canva",
          status: "pending",
        },
        onAuthenticateMcp: () => {},
        onOpenStoreApp: () => {},
      })
    );
    assert.match(chatHtml, /mcp-signin-card-mcp-canva/);
  });

  it("4. Verifica ausência estrita de <select> nativo nos componentes novos da Fase 10", () => {
    const filesToCheck = [
      "src/components/ui/CarbonControls.tsx",
      "src/features/marketplace/MarketplacePage.tsx",
      "src/features/whatsapp/WhatsAppPairingModal.tsx",
    ];
    for (const rel of filesToCheck) {
      const content = readFileSync(resolve(webRoot, rel), "utf8");
      assert.equal(/<select\b/i.test(content), false, `Encontrado <select> nativo em ${rel}`);
    }
  });
});
