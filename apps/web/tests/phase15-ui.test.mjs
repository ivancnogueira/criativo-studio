import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

function listTsxFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("Fase 15 — UI Carbon Dark SSR & Auditoria Estática Clean-Room", () => {
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

  it("Teste 1 — Renderiza SSR Browser CDP, Takeover, BrowserTeachBar, Perfis & Mídia", async () => {
    const { BrowserTakeoverCard, BrowserTakeoverModal, BrowserSecretCard, CaptureScreenConsentCard } =
      await vite.ssrLoadModule("/src/features/browser/BrowserTakeoverModal.tsx");
    const { BrowserTeachBar, UserBrowsingLogInspector } = await vite.ssrLoadModule(
      "/src/features/browser/BrowserTeachBar.tsx",
    );
    const { ServerBrowserProfilesPanel, BrowserProxyDialog } = await vite.ssrLoadModule(
      "/src/features/browser/ServerBrowserProfilesPanel.tsx",
    );

    const cardHtml = renderToStaticMarkup(
      React.createElement(BrowserTakeoverCard, {
        takeoverId: "tkv-1",
        tabId: "tab-1",
        reason: "login",
        url: "https://exemplo.invalid/login",
        title: "Login [NOME_DA_MARCA]",
        onAssume: () => {},
        onCancel: () => {},
      }),
    );
    assert.match(cardHtml, /Assumir navegador/);

    const modalHtml = renderToStaticMarkup(
      React.createElement(BrowserTakeoverModal, {
        open: true,
        tabId: "tab-1",
        agentName: "Pesquisador",
        url: "https://exemplo.invalid/painel",
        title: "Painel",
        teachRecording: true,
        teachStartedAt: Date.now() - 5000,
        teachStepsCount: 3,
        onClose: () => {},
        onCompleteSession: () => {},
        onCancelSession: () => {},
        onSendInput: () => {},
        onStartTeach: () => {},
        onStopTeach: () => {},
      }),
    );
    assert.match(modalHtml, /Concluir sessão/);
    assert.match(modalHtml, /data-recording="true"/);
    assert.match(modalHtml, /Gravar passos|Descartar gravação/);

    const teachIdleHtml = renderToStaticMarkup(
      React.createElement(BrowserTeachBar, {
        recording: false,
        startedAt: null,
        stepsCount: 0,
        onStart: () => {},
        onStopSave: () => {},
        onStopDiscard: () => {},
      }),
    );
    assert.match(teachIdleHtml, /Iniciar gravação/);

    const logHtml = renderToStaticMarkup(
      React.createElement(UserBrowsingLogInspector, {
        open: true,
        agentName: "Estrategista",
        steps: [
          {
            log_id: "l1",
            agente_id: "estrategista",
            kind: "page",
            host: "exemplo.invalid",
            path: "/posts/:id",
            title: "Painel",
            revisado: false,
            criado_em: Date.now(),
          },
        ],
        recordedTaskText: "Visitou exemplo.invalid/posts/:id",
        onClose: () => {},
      }),
    );
    assert.match(logHtml, /exemplo\.invalid/);

    const secretHtml = renderToStaticMarkup(
      React.createElement(BrowserSecretCard, {
        request: {
          requestId: "req-1",
          tabId: "tab-1",
          agenteId: "estrategista",
          host: "exemplo.invalid",
          method: "password",
          targets: [],
          submission: "enter",
        },
        onSubmitSecret: () => {},
      }),
    );
    assert.match(secretHtml, /Preencher credencial/);

    const captureHtml = renderToStaticMarkup(
      React.createElement(CaptureScreenConsentCard, {
        captureId: "cap-1",
        agentName: "Designer",
        purpose: "Inspecionar layout [NOME_DA_MARCA]",
        onAuthorizeCapture: () => {},
        onDeclineCapture: () => {},
      }),
    );
    assert.match(captureHtml, /Autorizar captura/);
    assert.match(captureHtml, /Recusar captura/);

    const profilesHtml = renderToStaticMarkup(
      React.createElement(ServerBrowserProfilesPanel, {
        profiles: [
          {
            perfil_id: "p1",
            nome: "Perfil [NOME_DA_MARCA]",
            cor_hex: "#42A0FF",
            user_data_dir: "dados/browser-profiles/p1",
          },
        ],
        proxies: [],
        onCreateProfile: async () => {},
        onUpdateProfile: async () => {},
        onClearProfile: async () => {},
        onDeleteProfile: async () => {},
        onSaveProxy: async () => ({
          proxy_id: "prx-1",
          nome: "Proxy Teste",
          servidor: "http://proxy.exemplo.invalid:8080",
          protocolo: "http",
          ativo: true,
          criado_em: "2026-11-18T00:00:00.000Z",
          atualizado_em: "2026-11-18T00:00:00.000Z",
        }),
        onDeleteProxy: async () => {},
      }),
    );
    assert.match(profilesHtml, /Criar perfil/);

    const proxyHtml = renderToStaticMarkup(
      React.createElement(BrowserProxyDialog, {
        open: true,
        profileName: "Perfil Teste",
        tabCount: 0,
        proxies: [],
        onClose: () => {},
        onApplyProxy: () => {},
        onSaveProxyPreset: async () => ({
          proxy_id: "prx-1",
          nome: "Proxy Teste",
          servidor: "http://proxy.exemplo.invalid:8080",
          protocolo: "http",
          ativo: true,
          criado_em: "2026-11-18T00:00:00.000Z",
          atualizado_em: "2026-11-18T00:00:00.000Z",
        }),
        onDeleteProxyPreset: () => {},
      }),
    );
    assert.match(proxyHtml, /Aplicar proxy/);

    for (const h of [cardHtml, modalHtml, teachIdleHtml, logHtml, secretHtml, captureHtml, profilesHtml, proxyHtml]) {
      assert.doesNotMatch(h, /<select/i);
    }
  });

  it("Teste 2 — Renderiza SSR Backup Models, Governança & Sidebar Customizável", async () => {
    const { BackupModelsEditor, UsageLimitAskCard, reorderBackupModels } = await vite.ssrLoadModule(
      "/src/features/inspector/BackupModelsEditor.tsx",
    );
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx",
    );
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");

    const reordered = reorderBackupModels(
      [
        { provedor: "gemini", modelo: "gemini-2.5-flash" },
        { provedor: "openai", modelo: "gpt-4.1-mini" },
      ],
      0,
      1,
    );
    assert.equal(reordered[0].modelo, "gpt-4.1-mini");

    const backupHtml = renderToStaticMarkup(
      React.createElement(BackupModelsEditor, {
        primaryModel: "gemini-2.5-pro",
        config: { automatic: true, order: reordered },
        provedores: [],
        onChange: () => {},
      }),
    );
    assert.doesNotMatch(backupHtml, /<select/i);

    const askHtml = renderToStaticMarkup(
      React.createElement(UsageLimitAskCard, {
        ask: {
          ask_id: "ask-1",
          agente_id: "estrategista",
          canal_id: "agente:estrategista",
          modelo_atual: "gemini-2.5-pro",
          provedor_atual: "gemini",
          motivo: "Limite de cota atingido",
          opcoes: [{ provedor: "openai", modelo: "gpt-4.1-mini" }],
        },
        onResolve: () => {},
      }),
    );
    assert.match(askHtml, /Alternar modelo/);
    assert.match(askHtml, /Aguardar janela/);

    const inspectorHtml = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        initialSubView: "config",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Estratégia de Marca",
          pasta: "estrategista",
          modelo_padrao: "gemini-2.5-flash",
          ativo: true,
          status: "ocioso",
          config: { permission_level: "workspace", avatar_shape: "hex", avatar_color: "#31cf76" },
          atualizado_em: "2026-11-18T00:00:00.000Z",
        },
        arquivos: [],
        previewTarefa: null,
        onClose: () => {},
        onOpenFilesPage: () => {},
        onOpenWhatsAppModal: () => {},
        onSaveAgentSettings: async () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      }),
    );
    assert.match(inspectorHtml, /Governança &amp; Navegador|Governança & Navegador/);
    assert.match(inspectorHtml, /Configurar backup models/);
    assert.match(inspectorHtml, /Gerenciar perfis de navegador/);
    assert.doesNotMatch(inspectorHtml, /<select/i);

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Estratégia",
            pasta: "estrategista",
            frente: "conteudo",
            modelo_padrao: "gemini-2.5-flash",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-18T00:00:00.000Z",
          },
          {
            agente_id: "copywriter",
            nome: "Copywriter",
            papel: "Texto",
            pasta: "copywriter",
            frente: "conteudo",
            modelo_padrao: "gemini-2.5-flash",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-18T00:00:00.000Z",
          },
          {
            agente_id: "auditor_marca",
            nome: "Auditor de Marca",
            papel: "Qualidade",
            pasta: "auditor",
            frente: "bonus",
            modelo_padrao: "gemini-2.5-flash",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-18T00:00:00.000Z",
          },
        ],
        selectedAgentId: "estrategista",
        onSelectAgent: () => {},
        sidebarLayout: {
          revision: 1,
          sections: [
            {
              section_id: "sec-1",
              nome: "Campanhas",
              parent_id: null,
              ordem: 0,
              colapsada: false,
              nivel: 1,
              criado_em: "2026-11-18T00:00:00.000Z",
              atualizado_em: "2026-11-18T00:00:00.000Z",
            },
            {
              section_id: "sec-2",
              nome: "Lançamentos",
              parent_id: "sec-1",
              ordem: 0,
              colapsada: false,
              nivel: 2,
              criado_em: "2026-11-18T00:00:00.000Z",
              atualizado_em: "2026-11-18T00:00:00.000Z",
            },
          ],
          order: ["sec-1", "sec-2"],
          agentAssignments: { copywriter: "sec-2" },
          agentOrder: ["estrategista", "copywriter", "auditor_marca"],
          pins: ["estrategista"],
          hiddenAgentIds: ["auditor_marca"],
        },
      }),
    );
    assert.match(sidebarHtml, /Fixados/);
    assert.match(sidebarHtml, /Campanhas/);
    assert.match(sidebarHtml, /Lançamentos/);
    assert.match(sidebarHtml, /Ocultos \(1\)/);
    assert.doesNotMatch(sidebarHtml, /<select/i);
  });

  it("Teste 3 — Renderiza SSR SettingsModal, StorageUsageBar, WhatsNew, LiveVoiceBar, QuickAgentDrawer, Connectors & Workflows", async () => {
    const { StorageUsageBar, WhatsNewPanel, formatStorageBytes, computeStorageSegments } =
      await vite.ssrLoadModule("/src/features/settings/StorageUsageBar.tsx");
    const { SettingsModal, DEFAULT_FRONTEND_USER_SETTINGS } = await vite.ssrLoadModule(
      "/src/features/settings/SettingsModal.tsx",
    );
    const { LiveVoiceBar, QuickAgentDrawer } = await vite.ssrLoadModule(
      "/src/features/settings/LiveVoiceAndQuickDrawer.tsx",
    );
    const { ConnectorsPage } = await vite.ssrLoadModule("/src/features/pages/ConnectorsPage.tsx");
    const { WorkflowsCanvasPage } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowsCanvasPage.tsx",
    );

    assert.equal(formatStorageBytes(2048), "2.0 KB");
    const snapshot = {
      totalBytes: 4000,
      categorias: [
        { categoria: "artes_geradas", rotulo: "Artes Geradas", cor_hex: "#007CF7", bytes: 2000, arquivos_count: 2 },
        { categoria: "uploads", rotulo: "Uploads", cor_hex: "#31CF76", bytes: 1000, arquivos_count: 1 },
        { categoria: "perfis_navegador", rotulo: "Perfis Chromium", cor_hex: "#FF9412", bytes: 1000, arquivos_count: 1 },
      ],
      topFiles: [],
      porAgente: {},
      atualizado_em: "2026-11-18T00:00:00.000Z",
    };
    const segs = computeStorageSegments(snapshot);
    assert.equal(segs[0].percent, 50);

    const settingsHtml = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: true,
        settings: DEFAULT_FRONTEND_USER_SETTINGS,
        storageUsage: snapshot,
        whatsNew: {
          versao_atual: "1.5.0",
          verificado_em: "2026-11-18T00:00:00.000Z",
          atualizacao_disponivel: false,
          notas: [{ versao: "1.5.0", data: "2026-11-18", added: ["Browser CDP"], changed: [], fixed: [] }],
        },
        browserProfiles: [],
        browserProxies: [],
        agentes: [],
        canais: [],
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
          criado_em: "2026-11-18T00:00:00.000Z",
          atualizado_em: "2026-11-18T00:00:00.000Z",
        }),
        onDeleteBrowserProxy: async () => {},
      }),
    );
    for (const label of [
      "Geral",
      "Aparência",
      "Comportamento",
      "Navegador &amp; Proxies",
      "Notificações &amp; Sons",
      "Voz &amp; Live Voice",
      "Armazenamento",
      "Atualizações &amp; Novidades",
    ]) {
      assert.match(settingsHtml, new RegExp(label));
    }

    const storageBarHtml = renderToStaticMarkup(React.createElement(StorageUsageBar, { snapshot }));
    assert.match(storageBarHtml, /role="img"/);

    const whatsNewHtml = renderToStaticMarkup(
      React.createElement(WhatsNewPanel, {
        whatsNew: {
          versao_atual: "1.5.0",
          verificado_em: "2026-11-18T00:00:00.000Z",
          atualizacao_disponivel: false,
          notas: [{ versao: "1.5.0", data: "2026-11-18", added: ["Navegador real"], changed: [], fixed: [] }],
        },
        onCheckUpdates: async () => {},
      }),
    );
    assert.match(whatsNewHtml, /Verificar atualizações/);

    const liveVoiceHtml = renderToStaticMarkup(
      React.createElement(LiveVoiceBar, {
        active: true,
        agentName: "Estrategista",
        onSendTranscript: () => {},
        onClose: () => {},
      }),
    );
    assert.match(liveVoiceHtml, /Encerrar voz contínua/);

    const drawerHtml = renderToStaticMarkup(
      React.createElement(QuickAgentDrawer, {
        enabled: true,
        agentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Estratégia",
            pasta: "estrategista",
            modelo_padrao: "gemini-2.5-flash",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-18T00:00:00.000Z",
          },
        ],
        pinnedIds: ["estrategista"],
        selectedAgentId: "estrategista",
        onSelectAgent: () => {},
      }),
    );
    assert.match(drawerHtml, /Recolher ilha lateral|Expandir ilha lateral de agentes/);
    assert.match(drawerHtml, /Abrir rapidamente Estrategista Editorial/);

    const connectorsHtml = renderToStaticMarkup(
      React.createElement(ConnectorsPage, {
        provedores: [],
        vaultKeys: [],
        whatsappStatus: "desconectado",
        onConnectProvider: async () => {},
        onDisconnectProvider: async () => {},
        onSaveVaultSecret: async () => {},
        onOpenWhatsAppModal: () => {},
        onReopenOnboarding: () => {},
        showcaseSites: [
          {
            site_id: "site-1",
            slug: "demo-site",
            titulo: "Showcase [NOME_DA_MARCA]",
            descricao: "Página aprovada",
            source_dir: "saidas/demo",
            public_dir: "dados/showcase/demo-site",
            url_local: "/showcase/demo-site/",
            spa_fallback: true,
            agente_id: null,
            aprovado_por_humano: true,
            ativo: true,
            criado_em: "2026-11-18T00:00:00.000Z",
            atualizado_em: "2026-11-18T00:00:00.000Z",
          },
        ],
      }),
    );
    assert.match(connectorsHtml, /Showcase Local/);

    const workflowsHtml = renderToStaticMarkup(
      React.createElement(WorkflowsCanvasPage, {
        workflows: [
          {
            workflow_id: "wf-1",
            nome: "Fluxo Teste",
            descricao: "",
            nos: [],
            arestas: [],
            ativo: true,
            ultima_execucao_em: null,
            atualizado_em: "2026-11-18T00:00:00.000Z",
          },
        ],
        agentes: [],
        uso: null,
        onSaveWorkflow: async (w) => ({
          workflow_id: w.workflow_id || "wf-1",
          nome: w.nome,
          descricao: w.descricao || "",
          nos: w.nos,
          arestas: w.arestas,
          ativo: true,
          ultima_execucao_em: null,
          atualizado_em: "2026-11-18T00:00:00.000Z",
        }),
        onExecuteWorkflow: async () => ({ tarefas_criadas: [] }),
      }),
    );
    assert.match(workflowsHtml, /Salvar fluxo/);
    assert.match(workflowsHtml, /Executar fluxo/);

    for (const h of [settingsHtml, storageBarHtml, whatsNewHtml, liveVoiceHtml, drawerHtml, connectorsHtml, workflowsHtml]) {
      assert.doesNotMatch(h, /<select/i);
    }
  });

  it("Teste 4 — Auditoria estática Clean-Room: zero select nativo em Fase 15, zero Electron e zero contaminação", () => {
    const phase15WebFiles = [
      "src/features/browser/BrowserTeachBar.tsx",
      "src/features/browser/BrowserTakeoverModal.tsx",
      "src/features/browser/ServerBrowserProfilesPanel.tsx",
      "src/features/inspector/BackupModelsEditor.tsx",
      "src/features/inspector/RightInspectorPanel.tsx",
      "src/components/Sidebar.tsx",
      "src/features/chat/AgentConversationView.tsx",
      "src/features/settings/StorageUsageBar.tsx",
      "src/features/settings/SettingsGeneralTabs.tsx",
      "src/features/settings/SettingsNotificationsVoiceTabs.tsx",
      "src/features/settings/LiveVoiceAndQuickDrawer.tsx",
      "src/features/settings/SettingsModal.tsx",
      "src/features/pages/ConnectorsPage.tsx",
      "src/features/workflows/WorkflowsCanvasPage.tsx",
      "src/features/workflows/WorkflowNodes.tsx",
      "src/App.tsx",
    ];

    const forbiddenSelectTag = new RegExp("<" + "select\\b", "i");
    const forbiddenElectron = /\b(electron|BrowserWindow|webContentsView|ipcRenderer)\b/;

    for (const rel of phase15WebFiles) {
      const content = readFileSync(resolve(webRoot, rel), "utf8");
      assert.doesNotMatch(
        content,
        forbiddenSelectTag,
        `Elemento HTML nativo proibido encontrado em ${rel}`,
      );
      assert.doesNotMatch(
        content,
        forbiddenElectron,
        `Referência Electron proibida encontrada em ${rel}`,
      );
    }

    // Confirma todos os arquivos .tsx do frontend livres de select nativo em código JSX
    for (const tsxFile of listTsxFiles(resolve(webRoot, "src"))) {
      const content = readFileSync(tsxFile, "utf8");
      assert.doesNotMatch(
        content,
        forbiddenSelectTag,
        `Elemento <select encontrado em ${tsxFile}`,
      );
    }
  });
});
