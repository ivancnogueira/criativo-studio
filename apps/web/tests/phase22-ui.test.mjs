import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");
const LEGACY_TERM = ["open", "bot"].join("");

function collectFilesRecursive(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFilesRecursive(full, out);
    else if (/\.(ts|tsx|css|html|mjs)$/i.test(entry)) out.push(full);
  }
  return out;
}

describe("Fase 22 — Navegador Integrado, Dock Flutuante Desktop, WhatsApp Sync & Abas Unificadas (SSR)", () => {
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

  it("1. (CLEAN22-01) Zero menções legadas em todo apps/web/src", () => {
    const legacyRe = new RegExp(LEGACY_TERM, "i");
    for (const file of collectFilesRecursive(join(webRoot, "src"))) {
      const content = readFileSync(file, "utf8");
      assert.equal(legacyRe.test(content), false, `Menção legada encontrada em ${file}`);
    }
  });

  it("2. (BRWS22-02) InAppBrowserPanel renderiza coluna direita (sidebar) e tela cheia integrada (expanded)", async () => {
    const { InAppBrowserPanel } = await vite.ssrLoadModule(
      "/src/features/browser/InAppBrowserPanel.tsx"
    );

    const tabs = [
      {
        tabId: "tab-wpp-1",
        perfilId: "shared",
        agenteId: "prospectador",
        url: "https://web.example.invalid",
        title: "Sessão Web",
        revision: 1,
        userControl: false,
        screencastActive: true,
        lastActivityAt: "2026-11-19T23:00:00.000Z",
      },
    ];
    const framesByTab = {
      "tab-wpp-1": {
        tabId: "tab-wpp-1",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        width: 1280,
        height: 800,
        url: "https://web.example.invalid",
        title: "Sessão Web",
        userControl: false,
      },
    };

    const commonProps = {
      tabs,
      activeTabId: "tab-wpp-1",
      framesByTab,
      agentName: "Prospectador",
      onSelectTab: () => {},
      onNewTab: () => {},
      onCloseTab: () => {},
      onNavigate: () => {},
      onGoBack: () => {},
      onGoForward: () => {},
      onReload: () => {},
      onExpand: () => {},
      onCollapseToChat: () => {},
      onClosePanel: () => {},
      onAssumeControl: () => {},
      onCompleteControl: () => {},
      onSendInput: () => {},
      onSendQuickChat: () => {},
    };

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(InAppBrowserPanel, { ...commonProps, mode: "sidebar" })
    );
    assert.match(sidebarHtml, /data-testid="inapp-browser-sidebar"/);
    assert.match(sidebarHtml, /Navegador/);
    assert.match(sidebarHtml, /Expandir/);
    assert.match(sidebarHtml, /Assumir/);

    const expandedHtml = renderToStaticMarkup(
      React.createElement(InAppBrowserPanel, { ...commonProps, mode: "expanded" })
    );
    assert.match(expandedHtml, /data-testid="inapp-browser-expanded"/);
    assert.match(expandedHtml, /Voltar ao chat/);
    assert.match(expandedHtml, /Assumir/);
    assert.match(expandedHtml, /Mensagem para Prospectador/);

    const expandedTakeoverHtml = renderToStaticMarkup(
      React.createElement(InAppBrowserPanel, {
        ...commonProps,
        mode: "expanded",
        takeoverPending: true,
        framesByTab: {
          "tab-wpp-1": { ...framesByTab["tab-wpp-1"], userControl: true },
        },
      })
    );
    assert.match(expandedTakeoverHtml, /Terminei/);
    assert.match(expandedTakeoverHtml, /Prospectador aguarda você concluir nesta página/);
  });

  it("3. (DOCK22-01) FloatingDesktopDock exibe pílula arrastável + card de chat inline com mensagens e input", async () => {
    const { FloatingDesktopDock } = await vite.ssrLoadModule(
      "/src/features/dock/FloatingDesktopDock.tsx"
    );

    const html = renderToStaticMarkup(
      React.createElement(FloatingDesktopDock, {
        initialAgentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Planejamento",
            pasta: "estrategista",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: { avatar_shape: "hex", avatar_color: "#31CF76" },
            atualizado_em: "2026-11-19T23:00:00.000Z",
          },
        ],
        initialSelectedAgentId: "estrategista",
        initialMessagesByAgent: {
          estrategista: [
            {
              mensagem_id: "m-wpp-1",
              canal_id: "agente:estrategista",
              agente_id: "estrategista",
              autor: "usuario",
              autor_nome: "Você",
              conteudo_markdown: "Resumo via celular [NOME_DA_MARCA]",
              anexos: [],
              steps: [],
              tarefa_id: null,
              metadados: { origem: "whatsapp" },
              lida: true,
              criado_em: "2026-11-19T23:00:00.000Z",
            },
          ],
        },
      })
    );

    assert.match(html, /data-testid="floating-desktop-dock"/);
    assert.match(html, /data-testid="floating-dock-pill"/);
    assert.match(html, /data-testid="floating-dock-chat-card"/);
    assert.match(html, /data-testid="floating-dock-pin-toggle"/);
    assert.match(html, /Criar novo agente/);
    assert.match(html, /WhatsApp/);
    assert.match(html, /Mensagem para Estrategista Editorial/);

    // Sem sombras difusas DWM nem título visível do app na ilha flutuante
    assert.doesNotMatch(html, /shadow-\[/);
    assert.doesNotMatch(html, /Criativo AI Studio/);

    // Modo recolhido na borda exibindo a lingueta discreta
    const peekHtml = renderToStaticMarkup(
      React.createElement(FloatingDesktopDock, {
        initialAgentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Planejamento",
            pasta: "estrategista",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: { avatar_shape: "hex", avatar_color: "#31CF76" },
            atualizado_em: "2026-11-19T23:00:00.000Z",
          },
        ],
        initialPinned: false,
        initialPeeked: false,
      })
    );
    assert.match(peekHtml, /data-testid="floating-dock-peek-handle"/);
    assert.doesNotMatch(peekHtml, /data-testid="floating-dock-pill"/);

    // Presença dos controles da ilha retrátil nas configurações
    const settingsGeneralSrc = readFileSync(
      join(webRoot, "src", "features", "settings", "SettingsGeneralTabs.tsx"),
      "utf8"
    );
    assert.match(settingsGeneralSrc, /desktop-dock-settings-card/);
    assert.match(settingsGeneralSrc, /Recolher ilha flutuante na borda da tela/);
    assert.match(settingsGeneralSrc, /dockSetPinned/);
  });

  it("4. (TABS22-01 & WPP22-02) DynamicIsland mantém aba do agente sem fechar, hideInlineThreadTabs remove barra duplicada e chat exibe badge WhatsApp", async () => {
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx"
    );

    const islandHtml = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: true,
        runningCount: 0,
        pendingCount: 0,
        awaitingApprovalCount: 0,
        whatsappStatus: "conectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
        onNewTopic: () => {},
        tabs: [
          { id: "agent:estrategista", titulo: "Estrategista Editorial", kind: "agent", closable: false },
          { id: "thread:estrategista:th-1", titulo: "Pauta Semanal", kind: "topic", closable: true },
        ],
        activeTabId: "agent:estrategista",
        onCloseTab: () => {},
      })
    );

    assert.doesNotMatch(islandHtml, /Fechar aba Estrategista Editorial/);
    assert.match(islandHtml, /Fechar aba Pauta Semanal/);
    assert.match(islandHtml, /aria-label="Novo tópico"/);

    const chatHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Planejamento",
          pasta: "estrategista",
          modelo_padrao: "gemini-4-argon",
          ativo: true,
          status: "ocioso",
          config: {},
          atualizado_em: "2026-11-19T23:00:00.000Z",
        },
        mensagens: [
          {
            mensagem_id: "m-wpp-u1",
            canal_id: "agente:estrategista",
            agente_id: "estrategista",
            autor: "usuario",
            autor_nome: "Você",
            conteudo_markdown: "Oi via WhatsApp [@SEU_PERFIL]",
            anexos: [],
            steps: [],
            tarefa_id: null,
            metadados: { origem: "whatsapp" },
            lida: true,
            criado_em: "2026-11-19T23:00:00.000Z",
          },
          {
            mensagem_id: "m-wpp-a1",
            canal_id: "agente:estrategista",
            agente_id: "estrategista",
            autor: "agente",
            autor_nome: "Estrategista Editorial",
            conteudo_markdown: "Resposta objetiva para celular",
            anexos: [],
            steps: [],
            tarefa_id: null,
            metadados: { origem: "whatsapp" },
            lida: true,
            criado_em: "2026-11-19T23:01:00.000Z",
          },
        ],
        provedores: [],
        sending: false,
        inspectorOpen: false,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => ({}),
        onUpdateModelAndEffort: async () => {},
        threads: [],
        activeThread: null,
        onSelectThread: () => {},
        onCreateQuickThread: () => {},
        hideInlineThreadTabs: true,
      })
    );

    assert.doesNotMatch(chatHtml, /aria-label="Sub-threads da conversa"/);
    assert.match(chatHtml, /WhatsApp/);

    const appSrc = readFileSync(join(webRoot, "src", "App.tsx"), "utf8");
    assert.match(appSrc, /hideInlineThreadTabs=\{true\}/);
    assert.match(appSrc, /onCreateQuickThread=\{\(\) => void handleCreateNewTopic\(\)\}/);
    assert.doesNotMatch(appSrc, /onCreateQuickThread=\{\(\) => setActiveSection\("tarefas"\)\}/);
  });

  it("5. (SPLASH22-01) StudioSplashPreloader renderiza os 7 mascotes sem texto de boot e sincroniza com splash Electron", async () => {
    const {
      SPLASH_REVEAL_TIMINGS,
      StudioSplashPreloader,
      computeSplashStageScale,
      resolveInitialSplashStageFromSearch,
    } = await vite.ssrLoadModule("/src/components/StudioSplashPreloader.tsx");

    assert.equal(resolveInitialSplashStageFromSearch(""), "scout");
    assert.equal(resolveInitialSplashStageFromSearch("?fromSplash=1&splashElapsed=800"), "expand");
    assert.equal(resolveInitialSplashStageFromSearch("?fromSplash=1&splashElapsed=2400"), "jumping");

    const scaleFullHd = computeSplashStageScale(1920, 1040);
    assert.ok(scaleFullHd > 1.35 && scaleFullHd <= 1.5, `Escala esperada ~1.44 em Full HD, obtida ${scaleFullHd}`);
    assert.ok(computeSplashStageScale(1380, 880) > 1.0);
    const scaleMin = computeSplashStageScale(1024, 680);
    assert.ok(scaleMin > 0.7 && scaleMin < 0.85, `Escala esperada entre 0.7 e 0.85 em 1024x680, obtida ${scaleMin}`);

    assert.ok(SPLASH_REVEAL_TIMINGS.burstMs < SPLASH_REVEAL_TIMINGS.openMs);
    assert.ok(SPLASH_REVEAL_TIMINGS.openMs < SPLASH_REVEAL_TIMINGS.completeMs);

    const html = renderToStaticMarkup(
      React.createElement(StudioSplashPreloader, {
        loading: true,
        initialStage: "jumping",
      })
    );

    assert.match(html, /data-testid="studio-splash-preloader"/);
    assert.match(html, /role="status"/);
    assert.match(html, /data-splash-stage="jumping"/);
    assert.match(html, /data-splash-stage-root="1"/);
    for (const slot of [-3, -2, -1, 0, 1, 2, 3]) {
      assert.match(html, new RegExp(`data-splash-mascot="${slot}"`));
    }
    assert.doesNotMatch(html, /Iniciando Criativo/i);
    assert.doesNotMatch(html, /Iniciando sua equipe/i);

    const splashSrc = readFileSync(
      join(webRoot, "src", "components", "StudioSplashPreloader.tsx"),
      "utf8"
    );
    assert.match(splashSrc, /revealTimersRef\.current/);
    const act4Match = splashSrc.match(
      /\/\/ Ato 4:[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[loading, stage, reducedMotion\]\);/
    );
    assert.ok(act4Match, "Bloco do Ato 4 em StudioSplashPreloader.tsx não encontrado");
    assert.match(act4Match[1], /scheduleReveal\(/);
    assert.doesNotMatch(
      act4Match[1],
      /clearTimeout/,
      "O effect do Ato 4 não deve cancelar timers no cleanup ao mudar stage para reveal-squash"
    );

    const appSrc = readFileSync(join(webRoot, "src", "App.tsx"), "utf8");
    assert.match(appSrc, /StudioSplashPreloader/);
    assert.doesNotMatch(appSrc, /Iniciando Criativo AI Studio/);
    assert.match(appSrc, /const isAppBooting = bootLoading;/);
    assert.doesNotMatch(appSrc, /isAppBooting = bootLoading \|\|/);
    assert.match(
      appSrc,
      /if \(isAppBooting\) \{\s*return \(\s*<>\s*<div className="min-h-screen w-full bg-\[#0D0D0D\]" \/>\s*\{renderSplashOverlay\(\)\}\s*<\/>\s*\);\s*\}/
    );

    const desktopMainSrc = readFileSync(
      join(webRoot, "..", "desktop", "src", "main.ts"),
      "utf8"
    );
    assert.match(desktopMainSrc, /fromSplash=1&splashElapsed=/);
    assert.match(desktopMainSrc, /applyStageScale/);
    assert.match(desktopMainSrc, /scale\(2\.65\)/);
    assert.match(desktopMainSrc, /win\.maximize\(\)/);
    assert.doesNotMatch(desktopMainSrc, /Iniciando sua equipe de Agentes Especialistas/);
  });

  it("6. (OC22-INSTALL) ProvidersCatalogView exibe botão gratuito de instalação do OpenCode e orientação clara no Gemini", async () => {
    const { ProvidersCatalogView } = await vite.ssrLoadModule(
      "/src/features/pages/ProvidersCatalogView.tsx"
    );

    const baseProviders = [
      {
        provedor: "opencode",
        rotulo: "OpenCode",
        subtitulo: "Modelos gratuitos ativos neste computador (API Key opcional)",
        conectado: false,
        cli_detectado: false,
        cli_versao: null,
        cli_executavel: null,
        vault_configurado: false,
        modo_conexao: "nenhum",
        modelos: [],
        contas: [],
        pool: null,
        usado_por_agentes: [],
        reporta_cota: false,
      },
      {
        provedor: "gemini",
        rotulo: "Gemini",
        subtitulo: "Conta Google OAuth ou Gemini API Key",
        conectado: false,
        cli_detectado: false,
        cli_versao: null,
        cli_executavel: null,
        vault_configurado: false,
        modo_conexao: "nenhum",
        modelos: [],
        contas: [],
        pool: null,
        usado_por_agentes: [],
        reporta_cota: false,
      },
    ];

    const ocHtml = renderToStaticMarkup(
      React.createElement(ProvidersCatalogView, {
        provedores: baseProviders,
        defaultProvider: "opencode",
        initialDetailProviderId: "opencode",
        authorizingProvider: null,
        authError: null,
        onStartBrowserSignIn: async () => {},
        onConnectApiKey: async () => {},
        onDisconnectProvider: async () => {},
        onShowToast: () => {},
      })
    );
    assert.match(ocHtml, /Instalar OpenCode \(Grátis\)/);
    assert.match(ocHtml, /sem precisar de Node\.js/);

    const gemHtml = renderToStaticMarkup(
      React.createElement(ProvidersCatalogView, {
        provedores: baseProviders,
        defaultProvider: "gemini",
        initialDetailProviderId: "gemini",
        authorizingProvider: null,
        authError: null,
        onStartBrowserSignIn: async () => {},
        onConnectApiKey: async () => {},
        onDisconnectProvider: async () => {},
        onShowToast: () => {},
      })
    );
    assert.match(gemHtml, /Antigravity CLI/);
    assert.match(gemHtml, /Gemini API Key/);
  });
});
