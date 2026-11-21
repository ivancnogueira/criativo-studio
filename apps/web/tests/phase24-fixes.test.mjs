import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 24 — UI: Logo Servidor Remoto, Cotas Auto, Dock Settings & Seletor de Avatares Aberto/Ampliado", () => {
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

  it("1. (SRV24-01) NewRemoteServerClaimModal exibe logo oficial Criativo Studio em vez de pontos pretos", async () => {
    const { NewRemoteServerClaimModal } = await vite.ssrLoadModule(
      "/src/features/servers/ServerModals.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(NewRemoteServerClaimModal, {
        open: true,
        quota: {
          allowed: true,
          servers_used: 1,
          max_servers: -1,
          local_used: 1,
          max_local_servers: -1,
          remote_used: 0,
          max_remote_servers: -1,
        },
        initialClaim: {
          claim_id: "clm_logo_test",
          server_name: "VPS Cliente",
          command_bash: "echo CRIATIVO_CLAIM=CRV_demo",
          command_agent_prompt: "Instale o Criativo Studio",
          expires_at: new Date(Date.now() + 900_000).toISOString(),
          ttl_seconds: 900,
          status: "pending",
          paired_server: null,
        },
        onClose: () => {},
        onConfigureWithAgent: () => {},
        onOpenPairedServer: () => {},
      }),
    );

    assert.match(html, /Novo servidor em outro computador/);
    assert.match(html, /#31cf76/i);
    assert.doesNotMatch(html, /cx="8\.5" cy="12" r="3"/);
  });

  it("2. (QUOTA24-01) WorkspaceRail possui sincronização automática de cotas para contas conectadas sem janelas", () => {
    const railSrc = readFileSync(
      join(webRoot, "src", "components", "WorkspaceRail.tsx"),
      "utf8",
    );
    assert.match(railSrc, /autoSyncedAccountsKeyRef/);
    assert.match(railSrc, /providerGroups\.length > 0/);
  });

  it("3. (DOCK24-01 & DOCK24-02) Aba 'Dock de agentes' em SettingsModal e botão '+' adiciona agentes existentes", async () => {
    const { SettingsModal, DEFAULT_FRONTEND_USER_SETTINGS } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsModal.tsx",
    );
    const { FloatingDesktopDock } = await vite.ssrLoadModule(
      "/src/features/dock/FloatingDesktopDock.tsx",
    );
    const { QuickAgentDrawer } = await vite.ssrLoadModule(
      "/src/features/settings/LiveVoiceAndQuickDrawer.tsx",
    );

    const sampleAgents = [
      {
        agente_id: "estrategista",
        nome: "Estrategista Editorial",
        papel: "Planejamento",
        pasta: "estrategista",
        modelo_padrao: "gemini-4-argon",
        ativo: true,
        status: "ocioso",
        config: { avatar_shape: "hex", avatar_color: "#31CF76" },
        atualizado_em: "2026-11-20T00:00:00.000Z",
      },
      {
        agente_id: "copywriter",
        nome: "Copywriter Sênior",
        papel: "Copywriting",
        pasta: "copywriter",
        modelo_padrao: "gemini-4-argon",
        ativo: true,
        status: "ocioso",
        config: { avatar_shape: "blob", avatar_color: "#38BDF8" },
        atualizado_em: "2026-11-20T00:00:00.000Z",
      },
    ];

    const settingsDockHtml = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: true,
        initialTab: "dock",
        settings: DEFAULT_FRONTEND_USER_SETTINGS,
        storageUsage: null,
        whatsNew: null,
        browserProfiles: [],
        browserProxies: [],
        agentes: sampleAgents,
        canais: [],
        activeServerName: "Servidor Local",
        onClose: () => {},
        onSaveSettings: async () => {},
        onCreateBrowserProfile: async () => {},
        onUpdateBrowserProfile: async () => {},
        onClearBrowserProfile: async () => {},
        onDeleteBrowserProfile: async () => {},
        onSaveBrowserProxy: async () => ({
          proxy_id: "p1",
          nome: "Proxy",
          servidor: "http://proxy.exemplo.invalid:8080",
          protocolo: "http",
          ativo: true,
          criado_em: "2026-11-20T00:00:00.000Z",
          atualizado_em: "2026-11-20T00:00:00.000Z",
        }),
        onDeleteBrowserProxy: async () => {},
      }),
    );

    for (const expected of [
      "Dock de agentes",
      "Mostrar o dock de agentes",
      "Posição",
      "Tela",
      "Borda da tela",
      "Tamanho do dock",
      "Ocultar quando não estiver em uso",
      "Mostrar uma faixa na borda",
      "Mostrar trabalho concluído",
      "Mostrar agentes com novidades",
      "Agentes no dock",
      "Estrategista Editorial",
      "Copywriter Sênior",
      "Cada servidor tem seu próprio dock",
    ]) {
      assert.match(settingsDockHtml, new RegExp(expected));
    }
    assert.doesNotMatch(settingsDockHtml, /<select/i);

    const floatingHtml = renderToStaticMarkup(
      React.createElement(FloatingDesktopDock, {
        initialAgentes: sampleAgents,
      }),
    );
    assert.match(floatingHtml, /Adicionar agentes ao dock/);
    assert.doesNotMatch(floatingHtml, /Criar novo agente/);

    const drawerHtml = renderToStaticMarkup(
      React.createElement(QuickAgentDrawer, {
        enabled: true,
        agentes: sampleAgents,
        pinnedIds: ["estrategista"],
        selectedAgentId: "estrategista",
        onSelectAgent: () => {},
        onToggleAgentInDock: async () => {},
      }),
    );
    assert.match(drawerHtml, /Adicionar agentes ao dock/);
    assert.doesNotMatch(drawerHtml, /Criar novo agente/);
  });

  it("4. (AVAT24-01) RightInspectorPanel inicia com seletor de avatar aberto por padrão e miniaturas individuais ampliadas", async () => {
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        initialSubView: "config",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Estratégia",
          pasta: "estrategista",
          modelo_padrao: "gemini-4-argon",
          ativo: true,
          status: "ocioso",
          config: {
            avatar_style: "cartoon",
            avatar_variant: "c_01",
            avatar_color: "#22C55E",
          },
          atualizado_em: "2026-11-20T00:00:00.000Z",
        },
        arquivos: [],
        threads: [],
        previewTarefa: null,
        onClose: () => {},
        onOpenFilesPage: () => {},
        onOpenWhatsAppModal: () => {},
        onSaveAgentSettings: async () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      }),
    );

    assert.match(html, /Personalizar avatar/);
    assert.match(html, /data-testid="avatar-variants-grid"/);
    assert.match(html, /grid-cols-3/);
    assert.match(html, /width="88"[^>]*height="88"/);
    assert.match(html, /width="54"[^>]*height="54"/);
  });

  it("5. (CLR25-01 & VPS25-02) StudioColorPicker (HSV/HEX/12 cores), fallback de copiar em ServerModals e card VPS oculto na Sidebar", async () => {
    const { StudioColorPicker, DEFAULT_STUDIO_COLOR_SWATCHES } = await vite.ssrLoadModule(
      "/src/components/StudioColorPicker.tsx",
    );
    const { SERVER_ACCENT_COLORS, ServerSettingsModal } = await vite.ssrLoadModule(
      "/src/features/servers/ServerModals.tsx",
    );
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");

    assert.equal(DEFAULT_STUDIO_COLOR_SWATCHES.length, 12);
    assert.equal(SERVER_ACCENT_COLORS.length, 12);

    const pickerHtml = renderToStaticMarkup(
      React.createElement(StudioColorPicker, {
        value: "#0BFF5C",
        onChange: () => {},
        allowDefaultReset: true,
        isDefaultSelected: false,
        onResetDefault: () => {},
        ariaLabelPrefix: "Teste",
      }),
    );
    assert.match(pickerHtml, /data-testid="studio-color-picker"/);
    assert.match(pickerHtml, /HEX/);
    assert.match(pickerHtml, /value="0BFF5C"/);
    assert.match(pickerHtml, /Conta-gotas de cor/);

    const settingsSrvHtml = renderToStaticMarkup(
      React.createElement(ServerSettingsModal, {
        open: true,
        server: {
          server_id: "srv-vps-1",
          nome: "VPS Produção",
          kind: "remote_vps",
          base_url: "http://203.0.113.10:3000",
          cor_hex: "#0BFF5C",
          port: 3000,
          criado_em: "2026-11-21T00:00:00.000Z",
          atualizado_em: "2026-11-21T00:00:00.000Z",
        },
        onClose: () => {},
        onUpdated: async () => {},
        onRemoved: async () => {},
      }),
    );
    assert.match(settingsSrvHtml, /#0BFF5C/);
    assert.match(settingsSrvHtml, /Mais cores/);

    const serverModalsSrc = readFileSync(
      join(webRoot, "src", "features", "servers", "ServerModals.tsx"),
      "utf8",
    );
    assert.match(serverModalsSrc, /copyTextToClipboard/);
    assert.match(serverModalsSrc, /execCommand\("copy"\)/);

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Planejamento",
            pasta: "estrategista",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: { avatar_shape: "hex", avatar_color: "#31CF76", frente: "conteudo" },
            atualizado_em: "2026-11-21T00:00:00.000Z",
          },
          {
            agente_id: "assistente_servidor_vps",
            nome: "Especialista em Servidor VPS",
            papel: "Instalação VPS",
            pasta: "Infraestrutura VPS",
            modelo_padrao: "gemini-2.5-flash",
            ativo: true,
            status: "ocioso",
            config: { avatar_shape: "hex", avatar_color: "#2EC4B6", frente: "conteudo" },
            atualizado_em: "2026-11-21T00:00:00.000Z",
          },
        ],
        selectedAgentId: "assistente_servidor_vps",
        onSelectAgent: () => {},
        onDismissVpsAssistant: async () => {},
      }),
    );
    assert.match(sidebarHtml, /data-vps-assistant-card="true"/);
    assert.match(sidebarHtml, /Especialista em Servidor VPS/);
    assert.match(sidebarHtml, /Roster \(1 Agentes\)/);
  });

  it("6. (DOCK28-01 & QUOTA28-03) Protege WebSocket contra close antigo, sincroniza servidor ativo no Dock, atualiza cotas em provider:updated e evita colisão na porta 1455", () => {
    const wsClientSrc = readFileSync(
      join(webRoot, "src", "services", "websocket-client.ts"),
      "utf8",
    );
    assert.match(wsClientSrc, /subscribeActiveServerChanges/);
    assert.match(wsClientSrc, /addEventListener\("storage"/);
    assert.match(wsClientSrc, /if \(this\.socket !== ws\) return;/);
    assert.match(wsClientSrc, /conectarOpenAiRemotoViaDesktop/);

    const dockSrc = readFileSync(
      join(webRoot, "src", "features", "dock", "FloatingDesktopDock.tsx"),
      "utf8",
    );
    assert.match(dockSrc, /listarServidores/);
    assert.match(dockSrc, /subscribeActiveServerChanges/);
    assert.match(dockSrc, /onDockActiveServerChanged/);
    assert.match(dockSrc, /DEFAULT_FRONTEND_DOCK_SETTINGS/);
    assert.match(dockSrc, /Tentar novamente/);

    const railSrc = readFileSync(
      join(webRoot, "src", "components", "WorkspaceRail.tsx"),
      "utf8",
    );
    assert.match(railSrc, /\$\{activeServerId\}::/);
    assert.match(railSrc, /triggerFallbackUsageSync/);
    assert.match(railSrc, /Sincronizando janelas de cota\.\.\./);

    const appSrc = readFileSync(join(webRoot, "src", "App.tsx"), "utf8");
    assert.match(appSrc, /ws\.on\("provider:updated"[\s\S]*?getProvidersUsage/);
    assert.match(appSrc, /dockSyncActiveServer/);
    assert.match(appSrc, /desktopAssistedProviderRef\.current !== evt\.provedor/);
    assert.match(appSrc, /setUso\(null\)/);
  });

  it("7. (QUOTA29-02) WorkspaceRail renderiza até 5 anéis concêntricos no Gemini, preserva todos os provedores conectados no trilho e exibe popover agrupado estilo Antigravity", async () => {
    const {
      WorkspaceRail,
      summarizeRingPercentages,
      formatUsageWindowLabel,
    } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");

    const geminiGroups = [
      {
        nome: "Gemini Models",
        modelos: ["Gemini 3 Pro"],
        janela_semanal: {
          rotulo: "Limite semanal",
          janela: "semanal",
          duracao_minutos: 10080,
          restante_percentual: 60,
          usado_percentual: 40,
          reseta_em: null,
          reseta_em_texto: "6 d 14 h",
        },
        janela_5h: {
          rotulo: "Limite de 5 horas",
          janela: "5h",
          duracao_minutos: 300,
          restante_percentual: 17,
          usado_percentual: 83,
          reseta_em: null,
          reseta_em_texto: "42 min",
        },
      },
      {
        nome: "Claude and GPT models",
        modelos: ["Claude Sonnet 4.6"],
        janela_semanal: {
          rotulo: "Limite semanal",
          janela: "semanal",
          duracao_minutos: 10080,
          restante_percentual: 100,
          usado_percentual: 0,
          reseta_em: null,
          reseta_em_texto: "",
        },
        janela_5h: {
          rotulo: "Limite de 5 horas",
          janela: "5h",
          duracao_minutos: 300,
          restante_percentual: 100,
          usado_percentual: 0,
          reseta_em: null,
          reseta_em_texto: "",
        },
      },
      {
        nome: "Gemini 4 Argon",
        modelos: ["Gemini 4 Argon"],
        janela_semanal: {
          rotulo: "Limite semanal",
          janela: "semanal",
          duracao_minutos: 10080,
          restante_percentual: 19,
          usado_percentual: 81,
          reseta_em: null,
          reseta_em_texto: "6 d 14 h",
        },
        janela_5h: null,
      },
    ];

    assert.deepEqual(summarizeRingPercentages(geminiGroups), [60, 17, 100, 100, 19]);
    assert.equal(formatUsageWindowLabel("semanal"), "Limite semanal");
    assert.equal(formatUsageWindowLabel("5h"), "Limite de 5h");

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "agentes",
        onSelectSection: () => {},
        uso: {
          contas: [
            {
              id: "acc-openai",
              provedor: "openai",
              rotulo: "ChatGPT",
              email: "codex29@exemplo.invalid",
              estado: "conectado",
              padrao: true,
              grupos_cota: [
                {
                  nome: "ChatGPT",
                  modelos: ["gpt-5.4"],
                  janela_semanal: {
                    rotulo: "Semanal",
                    janela: "semanal",
                    duracao_minutos: 10080,
                    restante_percentual: 50,
                    usado_percentual: 50,
                    reseta_em: null,
                    reseta_em_texto: "1 d 9 h",
                  },
                  janela_5h: {
                    rotulo: "5 horas",
                    janela: "5h",
                    duracao_minutos: 300,
                    restante_percentual: 100,
                    usado_percentual: 0,
                    reseta_em: null,
                    reseta_em_texto: "4 h 59 min",
                  },
                },
              ],
            },
            {
              id: "acc-gemini",
              provedor: "gemini",
              rotulo: "Gemini",
              email: "gemini29@exemplo.invalid",
              estado: "conectado",
              padrao: true,
              grupos_cota: geminiGroups,
            },
            {
              id: "acc-claude",
              provedor: "claude",
              rotulo: "Claude",
              email: "claude29@exemplo.invalid",
              estado: "conectado",
              padrao: true,
              grupos_cota: [],
            },
          ],
          janelas: [],
          sessoes_hoje: 0,
          mensagens_hoje: 0,
          tokens_entrada_hoje: 0,
          tokens_saida_hoje: 0,
          gasto_hoje_usd: 0,
          gasto_mes_usd: 0,
          atualizado_em: new Date().toISOString(),
        },
      }),
    );

    // Todos os provedores conectados aparecem no Rail (incluindo Claude mesmo com grupos_cota=[])
    assert.match(html, /ChatGPT · codex29@exemplo\.invalid/);
    assert.match(html, /Uso da conta gemini29@exemplo\.invalid: 17% restante/);
    assert.match(html, /Conta Claude · claude29@exemplo\.invalid conectada/);
    // Os 5 raios concêntricos do Gemini aparecem renderizados no SVG
    for (const r of ["16.3", "14", "11.7", "9.4", "7.1"]) {
      assert.ok(html.includes(`r="${r}"`), `Faltou anel concêntrico com raio r="${r}"`);
    }

    const railSrc = readFileSync(
      join(webRoot, "src", "components", "WorkspaceRail.tsx"),
      "utf8",
    );
    assert.match(railSrc, /MiniQuotaRing/);
    assert.match(railSrc, /Limite semanal/);
    assert.match(railSrc, /Limite de 5h/);
    assert.match(railSrc, /Reinicia em \{win\.reseta_em_texto\}/);
    assert.match(railSrc, /hasAnyMissingQuota/);
    assert.doesNotMatch(railSrc, /w-\[108px\]/);
  });
});
