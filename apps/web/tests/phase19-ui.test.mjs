import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 19 — Onboarding 4 Etapas, Layout Redimensionável, Apps Nativos & Contagem Dinâmica SSR", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  function makeAgents(count) {
    return Array.from({ length: count }, (_, idx) => ({
      agente_id: idx === 0 ? "estrategista" : `agente_${idx + 1}`,
      nome: idx === 0 ? "Estrategista Editorial" : `Agente ${idx + 1}`,
      papel: "Especialista",
      frente: idx < 6 ? "base" : idx < 11 ? "bonus" : "video",
      modelo_padrao: "gpt-4o",
      status: "ocioso",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: idx + 1,
      config: { pacote: idx < 6 ? "base" : "bonus", upgrade_desbloqueado: true },
      atualizado_em: new Date().toISOString(),
    }));
  }

  it("Teste 1 (UX19-02/04) — OnboardingFlow renderiza 4 etapas puláveis sem '15 agentes' estático e com upload categorizado + Meta v27.0", async () => {
    const { OnboardingFlow } = await vite.ssrLoadModule("/src/features/onboarding/OnboardingFlow.tsx");

    const baseOnboarding = {
      onboarding_concluido: false,
      etapa_atual: 1,
      modo_operacao_preferido: "autonomo",
      provedor_padrao: "antigravity",
      provedor_conectado_em: null,
      instagram_testado: false,
      whatsapp_pareado: false,
      checklist_ativos: { logo: false, fotos: false, referencias: false, ficha_pdf: false },
      marcos: {
        ambiente: "concluido",
        provedor: "pendente",
        perfil: "pendente",
        identidade_visual: "pendente",
        integracoes: "pendente",
        primeiro_ciclo: "pendente",
      },
      atualizado_em: new Date().toISOString(),
    };

    const step1Html = renderToStaticMarkup(
      React.createElement(OnboardingFlow, {
        provedores: [{ provedor: "antigravity", nome: "Antigravity", conectado: true }],
        initialState: baseOnboarding,
        unlockedAgentsCount: 9,
        onConnectProvider: async () => {},
        onComplete: async () => {},
      })
    );
    assert.doesNotMatch(step1Html, /15(?:<!-- -->|\s)+agentes/i);
    assert.match(step1Html, /9(?:<!-- -->|\s)+agentes/i);
    assert.match(step1Html, /Monte sua/);
    assert.match(step1Html, /Nome da sua marca/);
    assert.match(step1Html, /Usar minha assinatura de IA/);

    const step3Html = renderToStaticMarkup(
      React.createElement(OnboardingFlow, {
        provedores: [],
        initialState: { ...baseOnboarding, etapa_atual: 3 },
        initialStep: 3,
        unlockedAgentsCount: 9,
        onConnectProvider: async () => {},
        onComplete: async () => {},
      })
    );
    assert.match(step3Html, /Etapa 3 de 4/);
    assert.match(step3Html, /recursos\/logos/);
    assert.match(step3Html, /Fotos \(Rosto \/ Produto\)/);
    assert.match(step3Html, /Referências Visuais/);
    assert.match(step3Html, /Ficha Institucional \(PDF\)/);
    assert.match(step3Html, /Pular e configurar depois/);

    const step4Html = renderToStaticMarkup(
      React.createElement(OnboardingFlow, {
        provedores: [],
        initialState: { ...baseOnboarding, etapa_atual: 4 },
        initialStep: 4,
        unlockedAgentsCount: 15,
        onConnectProvider: async () => {},
        onTestInstagram: async () => ({ ok: true, resumo: "OK", username: "marca_teste_demo" }),
        onComplete: async () => {},
      })
    );
    assert.match(step4Html, /Etapa 4 de 4/);
    assert.match(step4Html, /Conectar Instagram/);
    assert.match(step4Html, /Meta Graph API v27\.0/);
    assert.match(step4Html, /Salvar e testar Graph API/);
    assert.match(step4Html, /Pular e configurar depois/);
  });

  it("Teste 2 (UX19-02/04) — LicenseActivationGate sem '15 agentes' e Sidebar com card temporário Assistente de Configuração + Roster dinâmico", async () => {
    const { LicenseActivationGate } = await vite.ssrLoadModule("/src/features/license/LicenseActivationGate.tsx");
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");

    const gateHtml = renderToStaticMarkup(
      React.createElement(LicenseActivationGate, {
        status: {
          valid: false,
          reason: "not_activated",
          hub_url: "https://painel.criativoaistudio.com.br",
        },
        onActivate: async () => {},
        onRetryCheck: async () => {},
      })
    );
    assert.doesNotMatch(gateHtml, /15\s+agentes/i);

    const setupAgent = {
      agente_id: "assistente_setup",
      nome: "Assistente de Configuração",
      papel: "Onboarding guiado e pendências iniciais",
      frente: "base",
      modelo_padrao: "gpt-4o",
      status: "ocioso",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: 0,
      config: { temporario: true, auto_ocultar_ao_concluir: true, papel_sistema: "setup_assistant" },
      atualizado_em: new Date().toISOString(),
    };

    const sidebar9Html = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: [setupAgent, ...makeAgents(9)],
        selectedAgentId: null,
        widthPx: 320,
        onSelectAgent: () => {},
        onChangeModel: () => {},
        onDismissSetupAssistant: async () => {},
      })
    );
    assert.match(sidebar9Html, /Roster \(9 Agentes\)/);
    assert.match(sidebar9Html, /Assistente de Configuração/);
    assert.match(sidebar9Html, /Concluir e ocultar/);
    assert.match(sidebar9Html, /width:320px/);
  });

  it("Teste 3 (UX19-03) — SplitResizeHandle, RightInspectorPanel visível sem hidden xl:flex, DynamicIsland Modo Foco e SettingsModal", async () => {
    const { SplitResizeHandle } = await vite.ssrLoadModule("/src/components/ui/SplitResizeHandle.tsx");
    const { RightInspectorPanel } = await vite.ssrLoadModule("/src/features/inspector/RightInspectorPanel.tsx");
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
    const { SettingsModal, DEFAULT_FRONTEND_USER_SETTINGS } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsModal.tsx"
    );

    const handleHtml = renderToStaticMarkup(
      React.createElement(SplitResizeHandle, {
        ariaLabel: "Redimensionar barra lateral",
        currentWidth: 276,
        minWidth: 220,
        maxWidth: 460,
        onResize: () => {},
        onReset: () => {},
      })
    );
    assert.match(handleHtml, /role="separator"/);
    assert.match(handleHtml, /aria-orientation="vertical"/);
    assert.match(handleHtml, /aria-valuenow="276"/);

    const inspHtml = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        agente: makeAgents(1)[0],
        agentes: makeAgents(9),
        arquivos: [],
        tarefas: [],
        widthPx: 390,
      })
    );
    assert.doesNotMatch(inspHtml, /hidden\s+xl:flex/);
    assert.match(inspHtml, /width:390px/);

    const islandHtml = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: true,
        runningCount: 0,
        pendingCount: 0,
        awaitingApprovalCount: 0,
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
        focusMode: false,
        onToggleFocusMode: () => {},
      })
    );
    assert.match(islandHtml, /Modo Foco/);

    const settingsHtml = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: true,
        settings: DEFAULT_FRONTEND_USER_SETTINGS,
        onClose: () => {},
        onReopenSetupAssistant: async () => {},
        onResetLayoutWidths: () => {},
      })
    );
    assert.match(settingsHtml, /Reabrir Assistente de Configuração/);
    assert.match(settingsHtml, /Restaurar larguras padrão das colunas/);
  });

  it("Teste 4 (MCP19-01) — MarketplacePage renderiza Contas conectadas nativas, badge Cofre e botão Aplicar acesso", async () => {
    const { MarketplacePage } = await vite.ssrLoadModule("/src/features/marketplace/MarketplacePage.tsx");

    const html = renderToStaticMarkup(
      React.createElement(MarketplacePage, {
        agentes: [
          ...makeAgents(9),
          {
            agente_id: "assistente_setup",
            nome: "Assistente de Configuração",
            papel: "Setup",
            frente: "base",
            modelo_padrao: "gpt-4o",
            status: "ocioso",
            skills_paths: [],
            memoria_resumo: null,
            ordem_exibicao: 0,
            config: { upgrade_desbloqueado: true },
            atualizado_em: new Date().toISOString(),
          },
          {
            agente_id: "bloqueado_bonus",
            nome: "Agente Bloqueado Upgrade",
            papel: "Upgrade",
            frente: "bonus",
            modelo_padrao: "gpt-4o",
            status: "ocioso",
            skills_paths: [],
            memoria_resumo: null,
            ordem_exibicao: 20,
            config: { pacote: "bonus", upgrade_desbloqueado: false },
            atualizado_em: new Date().toISOString(),
          },
        ],
        initialTab: "apps",
        initialAppSlug: "instagram",
        initialCatalog: {
          apps: [
            {
              slug: "instagram",
              name: "Instagram / Meta",
              tagline: "Publicação oficial Graph API v27.0 e análise de métricas",
              description: "Conector nativo Meta Graph API v27.0.",
              category: "Redes Sociais & Marketing",
              creatorName: "Meta / Criativo Studio",
              verified: true,
              isNative: true,
              authFlows: [
                {
                  id: "instagram-vault-keys",
                  kind: "key",
                  label: "Credenciais Meta Graph API (Cofre)",
                  fields: [
                    { key: "IG_USER_ID", label: "ID da Conta Profissional", secret: false },
                    { key: "IG_ACCESS_TOKEN", label: "Token Longa Duração", secret: true },
                  ],
                },
              ],
            },
          ],
          agents: [],
          skills: [],
        },
        initialNativeAccounts: [
          {
            conta_id: "acc_ig_teste",
            app_slug: "instagram",
            conta_rotulo: "Conta Teste Loja",
            campos_mascarados: { IG_ACCESS_TOKEN: "****9999" },
            campos_visiveis: { IG_USER_ID: "178414000000999" },
            configurado: true,
            testado_ok: true,
            ultimo_teste_em: new Date().toISOString(),
            ultimo_erro: null,
            perfil_conectado: {
              username: "marca_teste_demo",
              followers_count: 4200,
              media_count: 64,
            },
            acesso: { mode: "agents", agentIds: ["estrategista"] },
            atualizado_em: new Date().toISOString(),
          },
        ],
      })
    );

    assert.match(html, /Contas conectadas/);
    assert.match(html, /Conta Teste Loja/);
    assert.match(html, /@marca_teste_demo/);
    assert.match(html, /Salvo no Cofre \(\*\*\*\*9999\)/);
    assert.match(html, /Aplicar acesso/);
    assert.doesNotMatch(html, /Agente Bloqueado Upgrade/);
    assert.doesNotMatch(html, /Assistente de Configuração/);
  });
});
