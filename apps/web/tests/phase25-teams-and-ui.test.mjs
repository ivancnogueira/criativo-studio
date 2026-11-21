import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 25 — Equipes estilo OpenBot, Configurações da Equipe, Tooltip Fixados & Anéis por Conta", () => {
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

  const sampleAgents = [
    {
      agente_id: "estrategista",
      nome: "Estrategista Editorial",
      papel: "Estratégia",
      pasta: "estrategista",
      frente: "conteudo",
      modelo_padrao: "gemini-2.5-pro",
      ativo: true,
      status: "ocioso",
      config: { avatar_shape: "hex", avatar_color: "#31CF76" },
      atualizado_em: "2026-11-21T00:00:00.000Z",
    },
    {
      agente_id: "copywriter",
      nome: "Copywriter Sênior",
      papel: "Copywriting",
      pasta: "copywriter",
      frente: "conteudo",
      modelo_padrao: "claude-sonnet-4-5",
      ativo: true,
      status: "ocioso",
      config: { avatar_shape: "blob", avatar_color: "#38BDF8" },
      atualizado_em: "2026-11-21T00:00:00.000Z",
    },
  ];

  const sampleChannel = {
    canal_id: "canal-demo-1",
    nome: "Equipe de Organização",
    descricao: "Coordena pautas e criativos da semana",
    instrucoes: "Priorize entregas objetivas para Instagram",
    pasta: "Canais em Equipe",
    membros_agentes: ["estrategista", "copywriter"],
    lider_agente_id: "estrategista",
    navegador_modo: "all",
    manter_memorias: true,
    memorias_count: 2,
    rotinas_count: 1,
    criado_em: "2026-11-21T00:00:00.000Z",
    atualizado_em: "2026-11-21T00:00:00.000Z",
  };

  it("1. AgentConversationView em modo canal oculta seletor de provedor/modelo e exibe botão Configurações da equipe", async () => {
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx",
    );

    const html = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "channel",
        agente: null,
        canal: sampleChannel,
        allAgentes: sampleAgents,
        arquivos: [],
        mensagens: [],
        provedores: [],
        sending: false,
        inspectorOpen: true,
        onToggleInspector: () => {},
        onOpenChannelSettings: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => ({
          arquivo_id: "a1",
          nome_original: "demo.png",
          caminho_relativo: "uploads/demo.png",
          url: "/api/arquivos/a1",
          mime_type: "image/png",
          tamanho_bytes: 100,
          tipo_uso: "referencia",
          criado_em: "2026-11-21T00:00:00.000Z",
        }),
        onUpdateModelAndEffort: async () => {},
      }),
    );

    assert.match(html, /Equipe de Organização/);
    assert.match(html, /Avatar do canal em equipe/);
    assert.match(html, /Configurações da equipe/);
    assert.doesNotMatch(html, /Trocar provedor, modelo e esforço/);
  });

  it("2. RightInspectorPanel exibe Painel da equipe e todas as Configurações da equipe", async () => {
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx",
    );

    const hubHtml = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        initialSubView: "hub",
        agente: null,
        canal: sampleChannel,
        allAgentes: sampleAgents,
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
    assert.match(hubHtml, /Painel da equipe/);
    assert.match(hubHtml, /Configurações da equipe/);

    const cfgHtml = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        initialSubView: "channel_config",
        agente: null,
        canal: sampleChannel,
        allAgentes: sampleAgents,
        arquivos: [],
        previewTarefa: null,
        onClose: () => {},
        onOpenFilesPage: () => {},
        onOpenWhatsAppModal: () => {},
        onSaveAgentSettings: async () => {},
        onSaveChannelSettings: async () => {},
        onDeleteChannel: async () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      }),
    );

    for (const label of [
      "Configurações da equipe",
      "Título",
      "Instruções",
      "Navegador",
      "Manter as memórias neste canal",
      "Nova conversa",
      "Compactar contexto",
      "Excluir histórico",
      "Membros \\(2\\)",
      "Estrategista Editorial",
      "Copywriter Sênior",
      "Excluir equipe",
    ]) {
      assert.match(cfgHtml, new RegExp(label));
    }
    assert.doesNotMatch(cfgHtml, /<select/i);
  });

  it("3. Sidebar usa portal para tooltip dos agentes fixados sem title duplicado e oferece ações de equipe", async () => {
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: sampleAgents,
        canais: [sampleChannel],
        selectedAgentId: null,
        selectedChannelId: sampleChannel.canal_id,
        onSelectAgent: () => {},
        onSelectChannel: () => {},
        onEditChannel: () => {},
        onDeleteChannel: async () => {},
        sidebarLayout: {
          revision: 1,
          sections: [],
          order: [],
          agentAssignments: {},
          agentOrder: ["estrategista", "copywriter"],
          pins: ["estrategista"],
          hiddenAgentIds: [],
        },
      }),
    );

    assert.match(sidebarHtml, /data-testid="pinned-agent-tile-estrategista"/);
    assert.match(sidebarHtml, /Ações para Equipe de Organização/);
    assert.doesNotMatch(
      sidebarHtml,
      /data-testid="pinned-agent-tile-estrategista"[^>]*title=/,
    );

    const sidebarSrc = readFileSync(join(webRoot, "src", "components", "Sidebar.tsx"), "utf8");
    assert.match(sidebarSrc, /createPortal\(/);
    assert.match(sidebarSrc, /zIndex:\s*9999/);
  });

  it("4. WorkspaceRail exibe 1 anel por conta até o limite de 5 e botão Ver mais com menu lateral para todas as contas", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");

    const sevenAccounts = [
      { id: "oa1", provedor: "openai", rotulo: "ChatGPT", email: "c1@exemplo.invalid", estado: "conectado", padrao: true, grupos_cota: [] },
      { id: "ga1", provedor: "gemini", rotulo: "Gemini", email: "g1@exemplo.invalid", estado: "conectado", padrao: true, grupos_cota: [] },
      { id: "ga2", provedor: "gemini", rotulo: "Gemini", email: "g2@exemplo.invalid", estado: "conectado", padrao: false, grupos_cota: [] },
      { id: "ga3", provedor: "gemini", rotulo: "Gemini", email: "g3@exemplo.invalid", estado: "conectado", padrao: false, grupos_cota: [] },
      { id: "ca1", provedor: "claude", rotulo: "Claude", email: "cl1@exemplo.invalid", estado: "conectado", padrao: true, grupos_cota: [] },
      { id: "ga4", provedor: "gemini", rotulo: "Gemini", email: "g4@exemplo.invalid", estado: "conectado", padrao: false, grupos_cota: [] },
      { id: "oa2", provedor: "openai", rotulo: "ChatGPT", email: "c2@exemplo.invalid", estado: "conectado", padrao: false, grupos_cota: [] },
    ];

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "agentes",
        onSelectSection: () => {},
        uso: {
          contas: sevenAccounts,
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

    assert.match(html, /data-testid="rail-more-accounts-btn"/);
    assert.match(html, /\+2/);
    assert.match(html, /g1@exemplo\.invalid/);
    assert.match(html, /g2@exemplo\.invalid/);
    assert.doesNotMatch(html, /g4@exemplo\.invalid/);
  });
});
