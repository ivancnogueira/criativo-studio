import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 20 — Paridade de UX, In-Focus Settings, Rotinas, DynamicIsland, Loja & Chat", () => {
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

  it("1. (STAB20-01) DynamicIsland exibe 'Reconectando...' quando wsConnected === false e não exibe 'Pronto'", async () => {
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
    const html = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: false,
        runningCount: 0,
        pendingCount: 0,
        awaitingApprovalCount: 0,
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
      })
    );
    assert.match(html, /Reconectando\.\.\./);
    assert.doesNotMatch(html, /\bPronto\b/);
  });

  it("2. (UX20-01 & UPD20-01) SettingsModal variant='page' renderiza In-Focus sem overlay modal e SettingsUpdatesTab sem card duplicado", async () => {
    const { SettingsModal, DEFAULT_FRONTEND_USER_SETTINGS } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsModal.tsx"
    );
    const { SettingsUpdatesTab } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsUpdatesTab.tsx"
    );

    const settingsHtml = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: true,
        variant: "page",
        initialTab: "geral",
        settings: DEFAULT_FRONTEND_USER_SETTINGS,
        storageUsage: null,
        whatsNew: {
          versao_atual: "1.0.0",
          novidades: [],
        },
        browserProfiles: [],
        browserProxies: [],
        agentes: [],
        canais: [],
        onClose: () => {},
        onSaveSettings: async () => {},
      })
    );

    assert.match(settingsHtml, /Voltar/);
    assert.doesNotMatch(settingsHtml, /fixed inset-0/);

    const errUpdateHtml = renderToStaticMarkup(
      React.createElement(SettingsUpdatesTab, {
        updateStatus: {
          state: "error",
          current_version: "1.0.0",
          latest_version: null,
          progress_percent: 0,
          release_notes: null,
          last_checked_at: new Date().toISOString(),
          error_message: "Erro ao consultar atualizações",
        },
        whatsNew: {
          versao_atual: "1.0.0",
          novidades: [],
        },
        activeServerName: "Servidor Local Teste",
      })
    );
    assert.doesNotMatch(errUpdateHtml, /Você já está usando a versão mais recente/);
    assert.match(errUpdateHtml, /Erro ao consultar atualizações/);

    const versionCardMatches = errUpdateHtml.match(/Versão instalada/g) ?? [];
    assert.equal(versionCardMatches.length, 1, "Deve exibir Versão instalada apenas uma vez");
    assert.doesNotMatch(errUpdateHtml, /2\.15\.0/);
  });

  it("3. (UX20-06) WorkspaceRail exibe item dedicado 'Rotinas' na navegação lateral", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "fluxos",
        onSelectSection: () => {},
        pendingCount: 0,
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenSettings: () => {},
        onOpenHelp: () => {},
        servers: [],
        activeServerId: "local",
        serverQuota: null,
        onSelectServer: () => {},
        onOpenNewLocalServer: () => {},
        onOpenNewRemoteServer: () => {},
        onOpenJoinServer: () => {},
        onOpenServerSettings: () => {},
        onOpenDisplaySettings: () => {},
      })
    );
    assert.match(html, /Automações/);
    assert.doesNotMatch(html, /aria-label="Rotinas"/);
  });

  it("4. (UX20-03) ModelProviderPopover lista apenas provedor conectado no rail e possui container ampliado", async () => {
    const { ModelProviderPopover } = await vite.ssrLoadModule(
      "/src/components/ModelProviderPopover.tsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(ModelProviderPopover, {
        open: true,
        selectedModel: "gpt-4o",
        selectedEffort: "medio",
        provedores: [
          {
            provedor: "openai",
            rotulo: "OpenAI",
            conectado: true,
            modo_conexao: "api_key",
            modelos: [{ id: "gpt-4o", rotulo: "GPT-4o", gratuito: false }],
          },
          {
            provedor: "gemini",
            rotulo: "Google Gemini",
            conectado: false,
            modo_conexao: "nenhum",
            modelos: [],
          },
        ],
        onSelectModelAndEffort: () => {},
        onOpenConnectors: () => {},
        onClose: () => {},
      })
    );
    assert.match(html, /max-w-\[480px\]/);
    assert.match(html, /max-h-\[420px\]/);
    assert.match(html, /GPT-4o/);
    assert.doesNotMatch(html, /Google Gemini/);
  });

  it("5. (STORE20-01) MarketplacePage exibe App Nativo conectado em 'Seus apps' e badge 'Conectado' na grade", async () => {
    const { MarketplacePage } = await vite.ssrLoadModule(
      "/src/features/marketplace/MarketplacePage.tsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(MarketplacePage, {
        agentes: [],
        initialTab: "apps",
        initialNativeAccounts: [
          {
            conta_id: "ig-teste-20",
            app_slug: "instagram",
            conta_rotulo: "@marca_teste_20",
            status: "conectado",
            conectado: true,
            campos_visiveis: { INSTAGRAM_BUSINESS_ACCOUNT_ID: "178414000000020" },
            campos_mascarados: { INSTAGRAM_ACCESS_TOKEN: "••••••" },
            atualizado_em: new Date().toISOString(),
          },
        ],
        initialCatalog: {
          apps: [
            {
              slug: "instagram",
              name: "Instagram / Meta",
              tagline: "Publicação e métricas Meta Graph API v27.0",
              category: "Redes Sociais",
              authKind: "key",
              native: true,
            },
          ],
          agents: [],
          skills: [],
          connectedNativeSlugs: ["instagram"],
          nativeAccounts: [
            {
              conta_id: "ig-teste-20",
              app_slug: "instagram",
              conta_rotulo: "@marca_teste_20",
              status: "conectado",
              conectado: true,
              campos_visiveis: { INSTAGRAM_BUSINESS_ACCOUNT_ID: "178414000000020" },
              campos_mascarados: { INSTAGRAM_ACCESS_TOKEN: "••••••" },
              atualizado_em: new Date().toISOString(),
            },
          ],
        },
      })
    );
    assert.match(html, /Instagram \/ Meta/);
    assert.match(html, /Conectado/);
    assert.doesNotMatch(html, /Nenhum aplicativo conectado ainda/);
  });

  it("6. (UX20-04, UX20-02, BRWS20-01 & WPP20-01) Autocomplete / e @, Auto-layout de Fluxos, Navegador e WhatsApp self-chat", async () => {
    const { detectComposerTrigger } = await vite.ssrLoadModule(
      "/src/features/chat/ComposerAutocomplete.tsx"
    );
    const slashMatch = detectComposerTrigger("/car", 4);
    assert.equal(slashMatch?.kind, "slash");
    assert.equal(slashMatch?.query, "car");

    const mentionMatch = detectComposerTrigger("Chamar @desi", 12);
    assert.equal(mentionMatch?.kind, "mention");
    assert.equal(mentionMatch?.query, "desi");

    const { ServerBrowserProfilesPanel } = await vite.ssrLoadModule(
      "/src/features/browser/ServerBrowserProfilesPanel.tsx"
    );
    const browserHtml = renderToStaticMarkup(
      React.createElement(ServerBrowserProfilesPanel, {
        profiles: [
          {
            perfil_id: "perfil-1",
            nome: "Perfil Principal",
            cor: "#42A0FF",
            proxy_id: null,
            cdp_porta: 9222,
            agentes_vinculados: ["estrategista"],
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          },
        ],
        proxies: [],
        agentes: [],
        onCreateProfile: async () => {},
        onUpdateProfile: async () => {},
        onClearProfile: async () => {},
        onDeleteProfile: async () => {},
        onOpenProfile: async () => {},
        onSaveProxy: async () => ({
          proxy_id: "px-1",
          nome: "Local",
          server: "http://127.0.0.1:8888",
        }),
        onDeleteProxy: async () => {},
      })
    );
    assert.match(browserHtml, /Abrir navegador/);
    assert.match(browserHtml, /Chrome CDP :9222/);

    const { WhatsAppIntegrationPanel } = await vite.ssrLoadModule(
      "/src/features/whatsapp/WhatsAppPairingModal.tsx"
    );
    const wppHtml = renderToStaticMarkup(
      React.createElement(WhatsAppIntegrationPanel, {
        accounts: [
          {
            conta_id: "whatsapp-principal",
            nome_exibicao: "Número Teste",
            status: "desconectado",
            metodo_pareamento: "qr",
            politica: "own_number",
            ultimo_erro: "Falha de teste simulada",
          },
        ],
        activeAccountId: "whatsapp-principal",
      })
    );
    assert.match(wppHtml, /Falha de teste simulada/);
    assert.match(wppHtml, /Conversa comigo mesmo/);

    const { computeWorkflowAutoLayout } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowsCanvasPage.tsx"
    );
    const arranged = computeWorkflowAutoLayout(
      [
        { id: "n1", tipo: "gatilho", titulo: "Gatilho", x: 10, y: 10, config: {} },
        { id: "n2", tipo: "agente", titulo: "Agente", x: 20, y: 20, config: {} },
      ],
      [{ id: "e1", origem: "n1", destino: "n2", type: "flow" }]
    );
    assert.equal(arranged[0].x, 180);
    assert.equal(arranged[1].x, 520);
  });
});
