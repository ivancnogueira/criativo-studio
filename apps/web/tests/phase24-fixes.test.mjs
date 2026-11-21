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
});
