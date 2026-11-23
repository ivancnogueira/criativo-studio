import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

describe("Fase 21 — UI, Prévia Borrada, Avatares Sincronizados, Fotos Reais, Tópicos & Dock Lateral", () => {
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

  it("1. (CLEAN21-01) Higienização total: tokens-studio.css, ProvidersCatalogView.tsx e 0 menções legadas em apps/web/src", () => {
    const srcRoot = join(webRoot, "src");
    assert.ok(existsSync(join(srcRoot, "styles", "tokens-studio.css")));
    assert.equal(existsSync(join(srcRoot, "styles", `tokens-${LEGACY_TERM}.css`)), false);
    assert.ok(existsSync(join(srcRoot, "features", "pages", "ProvidersCatalogView.tsx")));
    const legacyProviderView = `Providers${["Open", "Bot"].join("")}View.tsx`;
    assert.equal(existsSync(join(srcRoot, "features", "pages", legacyProviderView)), false);

    const legacyRe = new RegExp(LEGACY_TERM, "i");
    for (const file of collectFilesRecursive(srcRoot)) {
      const content = readFileSync(file, "utf8");
      assert.equal(
        legacyRe.test(content),
        false,
        `Menção legada não permitida encontrada em ${file}`
      );
    }

    const wppModal = collectFilesRecursive(join(srcRoot, "features", "whatsapp"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.match(wppModal, /Conversa Interna \(Comigo mesmo\)/);
  });

  it("2. (IMG21-01 & UX21-01) AgentConversationView exibe card image-generating-preview e avatares 36/38/44; MascoteAvatar e Sidebar animam working", async () => {
    const themeCss = readFileSync(join(webRoot, "src", "styles", "theme.css"), "utf8");
    assert.match(themeCss, /studioImageMorph/);
    assert.match(themeCss, /studioImageShimmer/);
    assert.match(themeCss, /\.studio-image-generating-card/);

    const { MascoteAvatar } = await vite.ssrLoadModule("/src/components/MascoteAvatar.tsx");
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx"
    );

    const mascotSrc = readFileSync(join(webRoot, "src", "components", "MascoteAvatar.tsx"), "utf8");
    assert.match(mascotSrc, /squint/);
    assert.match(mascotSrc, /focused/);
    assert.match(mascotSrc, /wide/);

    const mascotWorkingHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        shape: "hex",
        color: "#42A0FF",
        size: 44,
        mood: "working",
        animated: true,
      })
    );
    assert.match(mascotWorkingHtml, /mascote-working/);

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: [
          {
            agente_id: "designer_post",
            nome: "Designer de Post",
            papel: "Arte estática",
            frente: "conteudo",
            pasta: "designer_post",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-19T00:00:00.000Z",
          },
        ],
        selectedAgentId: "designer_post",
        workingAgentIds: new Set(["designer_post"]),
        onSelectAgent: () => {},
      })
    );
    assert.match(sidebarHtml, /mascote-working/);

    const chatSource = collectFilesRecursive(join(webRoot, "src", "features", "chat"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.match(chatSource, /size=\{36\}/);
    assert.match(chatSource, /size=\{38\}/);
    assert.match(chatSource, /size=\{44\}/);

    const chatGeneratingHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: {
          agente_id: "designer_post",
          nome: "Designer de Post",
          papel: "Arte estática",
          pasta: "designer_post",
          modelo_padrao: "gemini-4-argon",
          ativo: true,
          status: "trabalhando",
          config: {},
          atualizado_em: "2026-11-19T00:00:00.000Z",
        },
        mensagens: [
          {
            mensagem_id: "m-1",
            canal_id: "agente:designer_post",
            agente_id: "designer_post",
            autor: "agente",
            autor_nome: "Designer de Post",
            conteudo_markdown: "Olá!",
            anexos: [],
            steps: [],
            tarefa_id: null,
            lida: true,
            criado_em: "2026-11-19T00:00:00.000Z",
          },
        ],
        provedores: [],
        sending: true,
        liveRun: {
          agenteId: "designer_post",
          agenteNome: "Designer de Post",
          startedAt: Date.now(),
          statusText: "Gerando imagem 3:4...",
          steps: [
            {
              id: "step-img-1",
              ferramenta: "generate_image",
              titulo: "Compondo iluminação e rosto real",
              formato: "3:4",
              status: "executando",
            },
          ],
          streamingText: "",
        },
        inspectorOpen: false,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => ({
          arquivo_id: "a1",
          nome: "foto.jpg",
          caminho_relativo: "recursos/fotos/foto.jpg",
          url: "/api/arquivos/raw?path=recursos/fotos/foto.jpg",
          mime_type: "image/jpeg",
          tipo_uso: "referencia",
        }),
        onUpdateModelAndEffort: async () => {},
      })
    );
    assert.match(chatGeneratingHtml, /data-testid="image-generating-preview"/);
    assert.match(chatGeneratingHtml, /studio-image-generating-card/);
    assert.match(chatGeneratingHtml, /Gerando imagem \(3:4\)/);
  });

  it("3. (MEDIA21-01) Exclusão inline sem window.confirm e filtro 'Fotos reais' em FilesVaultPage e RightInspectorPanel", async () => {
    const wsClientSrc = collectFilesRecursive(join(webRoot, "src", "services"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.match(wsClientSrc, /async deleteFile\(/);
    assert.match(wsClientSrc, /async createEmptyTopic\(/);

    const vaultSrc = readFileSync(join(webRoot, "src", "features", "pages", "FilesVaultPage.tsx"), "utf8");
    const inspectorSrc = collectFilesRecursive(join(webRoot, "src", "features", "inspector"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.doesNotMatch(vaultSrc, /window\.confirm/);
    assert.doesNotMatch(inspectorSrc, /window\.confirm/);

    const { FilesVaultPage } = await vite.ssrLoadModule("/src/features/pages/FilesVaultPage.tsx");
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx"
    );

    const vaultHtml = renderToStaticMarkup(
      React.createElement(FilesVaultPage, {
        arquivos: [
          {
            arquivo_id: "arq-foto-teste",
            nome_original: "foto-usuario-teste.jpg",
            caminho_relativo: "recursos/fotos/foto-usuario-teste.jpg",
            url: "/api/arquivos/raw?path=recursos/fotos/foto-usuario-teste.jpg",
            mime_type: "image/jpeg",
            tamanho_bytes: 1024,
            tipo_uso: "referencia",
            agente_id: "designer_post",
            criado_em: "2026-11-19T00:00:00.000Z",
          },
        ],
        onUploadFile: async () => ({
          arquivo_id: "x",
          nome: "x.jpg",
          caminho_relativo: "recursos/fotos/x.jpg",
          url: "/api/arquivos/raw?path=recursos/fotos/x.jpg",
          mime_type: "image/jpeg",
          tipo_uso: "referencia",
        }),
        onDeleteFile: async () => {},
      })
    );
    assert.match(vaultHtml, /Fotos reais/);
    assert.match(vaultHtml, /Foto real \(recursos\/fotos\)/);
    assert.match(vaultHtml, /Excluir foto-usuario-teste\.jpg/);

    const inspectorHtml = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        initialSubView: "files",
        agente: {
          agente_id: "designer_post",
          nome: "Designer de Post",
          papel: "Arte",
          pasta: "designer_post",
          modelo_padrao: "gemini-4-argon",
          ativo: true,
          status: "ocioso",
          config: {},
          atualizado_em: "2026-11-19T00:00:00.000Z",
        },
        arquivos: [
          {
            arquivo_id: "arq-foto-teste",
            nome_original: "foto-usuario-teste.jpg",
            caminho_relativo: "recursos/fotos/foto-usuario-teste.jpg",
            url: "/api/arquivos/raw?path=recursos/fotos/foto-usuario-teste.jpg",
            mime_type: "image/jpeg",
            tamanho_bytes: 1024,
            tipo_uso: "referencia",
            agente_id: "designer_post",
            criado_em: "2026-11-19T00:00:00.000Z",
          },
        ],
        previewTarefa: null,
        onClose: () => {},
        onOpenFilesPage: () => {},
        onDeleteFile: async () => {},
        onOpenWhatsAppModal: () => {},
        onSaveAgentSettings: async () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      })
    );
    assert.match(inspectorHtml, /Excluir foto-usuario-teste\.jpg/);
  });

  it("4. (UX21-02, UX21-03 & UX21-04) DynamicIsland com GitFork + Novo tópico, Rotinas com padding/scroll e QuickAgentDrawer Dock Vertical", async () => {
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");
    const { QuickAgentDrawer } = await vite.ssrLoadModule(
      "/src/features/settings/LiveVoiceAndQuickDrawer.tsx"
    );

    const islandHtml = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: true,
        runningCount: 1,
        pendingCount: 0,
        awaitingApprovalCount: 0,
        whatsappStatus: "conectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
        onNewTopic: () => {},
        tabs: [
          {
            id: "thread:estrategista:th-1",
            titulo: "Novo tópico",
            kind: "topic",
            working: true,
          },
        ],
        activeTabId: "thread:estrategista:th-1",
      })
    );
    assert.match(islandHtml, /lucide-git-fork/);
    assert.match(islandHtml, /Novo tópico/);

    const dockHtml = renderToStaticMarkup(
      React.createElement(QuickAgentDrawer, {
        enabled: true,
        pinned: true,
        workingAgentIds: new Set(["designer_post"]),
        agentes: [
          {
            agente_id: "designer_post",
            nome: "Designer de Post",
            papel: "Arte",
            pasta: "designer_post",
            modelo_padrao: "gemini-4-argon",
            ativo: true,
            status: "ocioso",
            config: {},
            atualizado_em: "2026-11-19T00:00:00.000Z",
          },
        ],
        pinnedIds: ["designer_post"],
        selectedAgentId: "designer_post",
        onSelectAgent: () => {},
        onTogglePinned: () => {},
        onCreateAgent: () => {},
      })
    );
    assert.match(dockHtml, /fixed right-0 top-1\/2 -translate-y-1\/2/);
    assert.match(dockHtml, /rounded-l-\[24px\]/);
    assert.match(dockHtml, /Recolher ilha lateral/);
    assert.match(dockHtml, /Adicionar Criativos ao dock/);
    assert.match(dockHtml, /mascote-working/);

    const appSrc = [
      join(webRoot, "src", "App.tsx"),
      ...collectFilesRecursive(join(webRoot, "src", "components", "studio")),
      ...collectFilesRecursive(join(webRoot, "src", "hooks")),
      ...collectFilesRecursive(join(webRoot, "src", "utils")),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.match(appSrc, /data-testid="routines-right-panel"/);
    assert.match(appSrc, /overflow-y-auto px-5 py-5 pb-12/);
    assert.match(appSrc, /criativo\.agent_dock\.pinned/);
    assert.match(appSrc, /handleCreateNewTopic/);

    const dockSrc = readFileSync(
      join(webRoot, "src", "features", "settings", "LiveVoiceAndQuickDrawer.tsx"),
      "utf8"
    );
    assert.match(dockSrc, /criativo\.agent_dock\.pinned/);

    const connectorsSrc = [
      join(webRoot, "src", "features", "pages", "ConnectorsPage.tsx"),
      ...collectFilesRecursive(join(webRoot, "src", "features", "pages", "connectors")),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    assert.match(connectorsSrc, /authError\.provedor === activeDetailProvider\.provedor/);
    assert.match(connectorsSrc, /onActiveProviderChange=\{\(prov\) => \{[\s\S]*setAuthError\(null\)/);
  });
});
