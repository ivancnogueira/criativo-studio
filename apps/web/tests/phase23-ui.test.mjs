import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 23 — UI, Multi-Server, Dock, Identidade Própria, Pastas Autorizadas & Blocos de Chat", () => {
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

  it("1. (SRV23-01) ServerSwitcherPopover evita clipping em Adicionar servidor e FloatingDesktopDock reage a licença/WS", async () => {
    const { ServerSwitcherPopover } = await vite.ssrLoadModule(
      "/src/features/servers/ServerSwitcherPopover.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(ServerSwitcherPopover, {
        open: true,
        initialAddSubmenuOpen: true,
        servers: [
          {
            server_id: "primary",
            nome: "Servidor Principal",
            tipo: "local",
            url: "http://127.0.0.1:4310",
            status: "online",
            padrao: true,
            workspace_path: "/tmp/ws",
            criado_em: "2026-11-20T00:00:00.000Z",
          },
        ],
        activeServerId: "primary",
        quota: {
          plan: "Agência Ilimitada",
          max_servers: -1,
          servers_used: 1,
          can_add_more: true,
        },
        onClose: () => {},
        onSelectServer: () => {},
        onOpenNewLocalModal: () => {},
        onOpenNewRemoteModal: () => {},
        onOpenJoinModal: () => {},
        onOpenServerSettings: () => {},
      }),
    );

    assert.match(html, /data-testid="add-server-trigger"/);
    assert.match(html, /Novo servidor neste computador/);
    assert.match(html, /Novo servidor em outro computador/);
    assert.match(html, /Entrar em um servidor/);
    assert.match(html, /1 · Ilimitado/);

    // O botão de adicionar servidor deve estar fora do wrapper overflow-y-auto para não clipar o submenu
    const listEndIdx = html.indexOf("data-testid=\"add-server-trigger\"");
    const overflowIdx = html.lastIndexOf("overflow-y-auto", listEndIdx);
    assert.ok(overflowIdx !== -1 && overflowIdx < listEndIdx);
    const sliceBetween = html.slice(overflowIdx, listEndIdx);
    assert.ok(sliceBetween.includes("</div>"), "O container overflow-y-auto deve fechar antes do trigger Adicionar servidor");

    const dockSrc =
      readFileSync(join(webRoot, "src", "features", "dock", "FloatingDesktopDock.tsx"), "utf8") +
      "\n" +
      readFileSync(join(webRoot, "src", "features", "dock", "useFloatingDockController.ts"), "utf8") +
      "\n" +
      readFileSync(join(webRoot, "src", "features", "dock", "FloatingDesktopDockView.tsx"), "utf8");
    assert.match(dockSrc, /license:updated/);
    assert.match(dockSrc, /servers:updated/);
    assert.match(dockSrc, /onConnectionChange/);
    assert.match(dockSrc, /2500/);
  });

  it("2. (TERM23-01) WorkspaceRail, DynamicIsland e ThreadTabsBar adotam termos próprios e removem Rotinas do trilho", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
    const { ThreadTabsBar } = await vite.ssrLoadModule("/src/features/chat/ThreadTabsBar.tsx");

    const railHtml = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "agentes",
        onSelectSection: () => {},
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenSettings: () => {},
        onOpenHelp: () => {},
      }),
    );

    assert.match(railHtml, /Estúdio/);
    assert.match(railHtml, /Automações/);
    assert.match(railHtml, /Tarefas/);
    assert.match(railHtml, /Calendário/);
    assert.match(railHtml, /Consumo/);
    assert.match(railHtml, /Biblioteca/);
    assert.match(railHtml, /Catálogo/);
    assert.match(railHtml, /Integrações/);
    assert.doesNotMatch(railHtml, /aria-label="Rotinas"/);
    assert.doesNotMatch(railHtml, /title="Rotinas"/);

    const islandHtml = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: true,
        runningCount: 0,
        pendingCount: 0,
        awaitingApprovalCount: 0,
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
        onNewTopic: () => {},
      }),
    );
    assert.match(islandHtml, /Barra de Pulso/);
    assert.match(islandHtml, /Nova Subconversa/);

    const threadsHtml = renderToStaticMarkup(
      React.createElement(ThreadTabsBar, {
        agentName: "Estrategista",
        threads: [],
        activeThreadId: null,
        onSelectMain: () => {},
        onSelectThread: () => {},
        onCreateQuickThread: () => {},
      }),
    );
    assert.match(threadsHtml, /Nova Subconversa/);
  });

  it("3. (SIDE23-01 & DEL23-01) Sidebar mostra fixados horizontais só com avatar + tooltip hover, Nova equipe/diretório e zero window.confirm", async () => {
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");

    const html = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Planejamento",
            frente: "conteudo",
            pasta: "estrategista",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-20T00:00:00.000Z",
          },
          {
            agente_id: "copywriter",
            nome: "Copywriter",
            papel: "Texto",
            frente: "conteudo",
            pasta: "copywriter",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-20T00:00:00.000Z",
          },
        ],
        canais: [
          {
            canal_id: "eq-1",
            nome: "Equipe Criativa",
            descricao: "Campanhas",
            membros_agentes: ["estrategista", "copywriter"],
            criado_em: "2026-11-20T00:00:00.000Z",
          },
        ],
        deletedNativeAgents: [
          { agente_id: "roteirista_reels", nome: "Roteirista Reels", papel: "Vídeos" },
        ],
        selectedAgentId: "estrategista",
        sidebarLayout: {
          sections: [],
          pins: ["estrategista"],
          order: [],
          hiddenAgentIds: [],
          agentAssignments: {},
          agentOrder: [],
        },
        onSelectAgent: () => {},
        onMutateSidebar: async () => {},
        onDeleteAgent: async () => {},
      }),
    );

    assert.match(html, /data-testid="sidebar-pinned-strip"/);
    assert.match(html, /data-testid="pinned-agent-tile-estrategista"/);
    assert.match(html, /aria-label="Estrategista Editorial"/);
    assert.match(html, /Equipes/);

    const sidebarSrc = [
      join(webRoot, "src", "components", "Sidebar.tsx"),
      join(webRoot, "src", "components", "sidebar", "SidebarAgentContextMenu.tsx"),
      join(webRoot, "src", "components", "sidebar", "SidebarAgentItems.tsx"),
      join(webRoot, "src", "components", "sidebar", "SidebarChannelsAndSections.tsx"),
      join(webRoot, "src", "components", "sidebar", "SidebarModals.tsx"),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.doesNotMatch(sidebarSrc, /window\.confirm/);
    assert.match(sidebarSrc, /Excluir Criativo/);
    assert.match(sidebarSrc, /Nova equipe|sidebar\.newTeam/);
    assert.match(sidebarSrc, /Novo diretório/);
    assert.match(sidebarSrc, /Nova Subconversa/);
    assert.match(sidebarSrc, /Abrir em nova janela/);
  });

  it("4. (INSP23-01 & FOLD23-01) RightInspectorPanel agrupa seções e diferencia Pasta Autorizada singular/plural", async () => {
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx",
    );

    const buildPanel = (folders) =>
      renderToStaticMarkup(
        React.createElement(RightInspectorPanel, {
          open: true,
          initialSubView: "config",
          agente: {
            agente_id: "estrategista",
            nome: "Estrategista",
            papel: "Estratégia",
            pasta: "estrategista",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: {
              chat_color: "#22C55E",
              allowed_folders: folders,
              auto_memory_enabled: true,
              permission_level: "workspace",
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

    const htmlZero = buildPanel([]);
    assert.match(htmlZero, /Motor IA/);
    assert.match(htmlZero, /Conhecimento/);
    assert.match(htmlZero, /Operações/);
    assert.match(htmlZero, /Controle/);
    assert.match(htmlZero, /Modelo Reserva/);
    assert.match(htmlZero, /Cor dos balões/);
    assert.match(htmlZero, /Especialidades/);
    assert.match(htmlZero, /Subconversas/);
    assert.match(htmlZero, /Alertas/);
    assert.match(htmlZero, /Pastas Autorizadas/);
    assert.doesNotMatch(htmlZero, />Pasta Autorizada</);

    const htmlOne = buildPanel([{ path: "/tmp/um", mode: "read_write" }]);
    assert.match(htmlOne, />Pasta Autorizada</);

    const htmlTwo = buildPanel([
      { path: "/tmp/um", mode: "read_write" },
      { path: "/tmp/dois", mode: "read" },
    ]);
    assert.match(htmlTwo, />Pastas Autorizadas</);

    const inspSrc = readFileSync(
      join(webRoot, "src", "features", "inspector", "RightInspectorPanel.tsx"),
      "utf8",
    );
    assert.doesNotMatch(inspSrc, /window\.confirm/);
  });

  it("5. (CHAT23-01 & SET23-01) Balões em blocos sólidos com contraste + Settings sem desligar animação inicial", async () => {
    const { computeBubbleColors, splitMarkdownIntoBubbleChunks } = await vite.ssrLoadModule(
      "/src/features/chat/chat-bubble-theme.ts",
    );
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx",
    );
    const { SettingsAppearanceTab, SettingsBehaviorTab } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsGeneralTabs.tsx",
    );

    const brightPalette = computeBubbleColors("#0BFF5C", "#212121");
    assert.equal(brightPalette.isLightBg, true);
    assert.equal(brightPalette.textColor, "#0D1117");
    const darkPalette = computeBubbleColors("#1E3A8A", "#212121");
    assert.equal(darkPalette.isLightBg, false);
    assert.equal(darkPalette.textColor, "#FFFFFF");

    const chunks = splitMarkdownIntoBubbleChunks(
      "Primeiro bloco de diagnóstico.\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n\nConclusão final.",
    );
    assert.equal(chunks.length, 3);

    const convHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista",
          papel: "Estratégia",
          pasta: "estrategista",
          modelo_padrao: "gemini-4-argon",
          ativo: true,
          status: "ocioso",
          config: { chat_color: "#1B6B3A" },
          atualizado_em: "2026-11-20T00:00:00.000Z",
        },
        mensagens: [
          {
            mensagem_id: "m-u1",
            canal_id: "agente:estrategista",
            autor: "operador",
            autor_nome: "Você",
            conteudo_markdown: "Oi",
            anexos: [],
            steps: [],
            tarefa_id: null,
            lida: true,
            criado_em: "2026-11-20T12:00:00.000Z",
          },
          {
            mensagem_id: "m-a1",
            canal_id: "agente:estrategista",
            autor: "agente",
            autor_nome: "Estrategista",
            conteudo_markdown: "Bloco 1.\n\nBloco 2.",
            anexos: [],
            steps: [],
            tarefa_id: null,
            lida: true,
            criado_em: "2026-11-20T12:00:05.000Z",
          },
        ],
        provedores: [],
        sending: false,
        inspectorOpen: true,
        userBubbleColor: "#B91C1C",
        solidBubbles: true,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => {
          throw new Error("noop");
        },
        onUpdateModelAndEffort: async () => {},
      }),
    );

    assert.match(convHtml, /data-testid="agent-reply-bubble"/);

    const appearanceHtml = renderToStaticMarkup(
      React.createElement(SettingsAppearanceTab, {
        aparencia: {
          tema: "carbon_dark",
          cor_acento: "#007CF7",
          cor_balao_usuario: "#B91C1C",
          baloes_solidos: true,
          escala: 100,
          fonte_interface: "Inter",
          fonte_codigo: "JetBrains Mono",
          idioma: "pt-BR",
        },
        onChange: () => {},
      }),
    );
    assert.match(appearanceHtml, /Cor do balão do operador/);
    assert.match(appearanceHtml, /Mensagens do estúdio em blocos sólidos/);

    const behaviorHtml = renderToStaticMarkup(
      React.createElement(SettingsBehaviorTab, {
        comportamento: {
          restaurar_ultima_aba: true,
          exibir_dynamic_island: true,
          detalhe_dynamic_island: "detalhado",
          habilitar_drawer_rapido: true,
        },
        onChange: () => {},
      }),
    );
    assert.match(behaviorHtml, /Barra de Pulso/);
    assert.doesNotMatch(behaviorHtml, /Desligar animação de inicialização|Desativar animação inicial/i);
  });
});
