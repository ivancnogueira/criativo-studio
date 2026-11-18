import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 14 — Componentes React SSR (Generative UI, UI Blocks, Shared Tables, Biblioteca 4 Níveis & Previews)", () => {
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

  it("renderiza ChatVisualReply com sandbox estrito sem allow-same-origin e botão de tela cheia", async () => {
    const { ChatVisualReply } = await vite.ssrLoadModule("/src/features/chat/ChatVisualReply.tsx");

    const html = renderToStaticMarkup(
      React.createElement(ChatVisualReply, {
        agenteId: "estrategista",
        visualMeta: {
          arquivo_id: "vis-01",
          titulo: "Painel Editorial Interativo",
          altura_inicial: 300,
        },
        initialHtml: "<!doctype html><html><body><h1>Painel [NOME_DA_MARCA]</h1></body></html>",
      }),
    );

    assert.match(html, /sandbox="allow-scripts allow-forms"/);
    assert.doesNotMatch(html, /allow-same-origin/);
    assert.match(html, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i);
    assert.match(html, /Abrir em tela cheia/);
  });

  it("renderiza ConversationQuestionPrompt paginado, campo isSecret mascarado e CTAs verbo + substantivo", async () => {
    const { ConversationQuestionPrompt } = await vite.ssrLoadModule(
      "/src/features/chat/ConversationQuestionPrompt.tsx",
    );

    const htmlPage1 = renderToStaticMarkup(
      React.createElement(ConversationQuestionPrompt, {
        bloco: {
          bloco_id: "blk-q1",
          mensagem_id: "msg-q1",
          canal_id: "agente:estrategista",
          agente_id: "estrategista",
          turno_id: "turn-1",
          tipo_ferramenta: "ask_user",
          status: "pending",
          versao: 1,
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
          spec: {
            kind: "ask_user",
            questions: [
              {
                id: "q_secret",
                question: "Informe o código interno de revisão:",
                isSecret: true,
              },
              {
                id: "q_format",
                question: "Qual formato priorizar?",
                options: [{ label: "Carrossel" }, { label: "Reels" }],
              },
            ],
          },
          estado: {},
        },
        onSubmit: async () => {},
      }),
    );

    assert.match(htmlPage1, /1 de 2/);
    assert.match(htmlPage1, /type="password"/);
    assert.match(htmlPage1, /Submeter respostas/);
    assert.match(htmlPage1, /Pular pergunta/);
    assert.match(htmlPage1, /Descartar questionário/);
    assert.doesNotMatch(htmlPage1, /<select/i);
  });

  it("renderiza UiBlockPrompt (confirmHold + form com listbox customizado sem <select>)", async () => {
    const { UiBlockPrompt } = await vite.ssrLoadModule("/src/features/chat/UiBlockPrompt.tsx");

    const confirmHtml = renderToStaticMarkup(
      React.createElement(UiBlockPrompt, {
        bloco: {
          bloco_id: "blk-ui-1",
          mensagem_id: "msg-ui-1",
          canal_id: "agente:estrategista",
          agente_id: "estrategista",
          turno_id: "turn-1",
          tipo_ferramenta: "ask_ui",
          status: "pending",
          versao: 1,
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
          spec: {
            kind: "ask_ui",
            variant: "confirm",
            title: "Aprovar lote de publicação",
            danger: true,
            confirmHold: { label: "Segurar para aprovar", durationMs: 1200 },
            actions: [
              {
                id: "approve",
                label: "Segurar para aprovar",
                tone: "danger",
                confirmHold: { label: "Segurar para aprovar", durationMs: 1200 },
              },
              { id: "cancel", label: "Cancelar operação", tone: "default" },
            ],
          },
          estado: {},
        },
        onSubmit: async () => {},
      }),
    );

    assert.match(confirmHtml, /Segurar para aprovar/);

    const formHtml = renderToStaticMarkup(
      React.createElement(UiBlockPrompt, {
        bloco: {
          bloco_id: "blk-ui-form",
          mensagem_id: "msg-ui-form",
          canal_id: "agente:estrategista",
          agente_id: "estrategista",
          turno_id: "turn-2",
          tipo_ferramenta: "ask_ui",
          status: "pending",
          versao: 1,
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
          spec: {
            kind: "ask_ui",
            variant: "form",
            title: "Parâmetros da Pauta",
            fields: [
              {
                name: "objetivo",
                label: "Objetivo editorial",
                type: "select",
                options: [
                  { value: "alcance", label: "Alcance" },
                  { value: "conversao", label: "Conversão" },
                ],
              },
            ],
          },
          estado: {},
        },
        onSubmit: async () => {},
      }),
    );

    assert.match(formHtml, /role="listbox"/);
    assert.match(formHtml, /role="option"/);
    assert.doesNotMatch(formHtml, /<select/i);
  });

  it("renderiza AcknowledgeRequestCard, ApiKeyRequestCard e SkillSuggestionChatCard com CTAs em pt-br", async () => {
    const { AcknowledgeRequestCard } = await vite.ssrLoadModule(
      "/src/features/chat/AcknowledgeRequestCard.tsx",
    );
    const { ApiKeyRequestCard } = await vite.ssrLoadModule(
      "/src/features/chat/ApiKeyRequestCard.tsx",
    );
    const { SkillSuggestionChatCard } = await vite.ssrLoadModule(
      "/src/features/chat/SkillSuggestionChatCard.tsx",
    );

    const ackHtml = renderToStaticMarkup(
      React.createElement(AcknowledgeRequestCard, {
        bloco: {
          bloco_id: "blk-ack",
          mensagem_id: "msg-ack",
          canal_id: "agente:estrategista",
          agente_id: "estrategista",
          turno_id: "turn-ack",
          tipo_ferramenta: "acknowledge_request",
          status: "pending",
          versao: 1,
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
          spec: {
            kind: "acknowledge_request",
            title: "Revisão de Pré-requisitos",
            summaryMarkdown: "Confirme os itens antes de prosseguir.",
            steps: ["Validar paleta visual", "Conferir calendário"],
          },
          estado: {},
        },
        onSubmit: async () => {},
      }),
    );
    assert.match(ackHtml, /Reconhecer requisitos/);
    assert.match(ackHtml, /Recusar continuação/);
    assert.doesNotMatch(ackHtml, /checked=""/);

    const apiKeyHtml = renderToStaticMarkup(
      React.createElement(ApiKeyRequestCard, {
        bloco: {
          bloco_id: "blk-key",
          mensagem_id: "msg-key",
          canal_id: "agente:estrategista",
          agente_id: "estrategista",
          turno_id: "turn-key",
          tipo_ferramenta: "request_api_key",
          status: "pending",
          versao: 1,
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
          spec: {
            kind: "request_api_key",
            name: "INTEGRACAO_SINTETICA_KEY",
            label: "Configurar chave de integração",
          },
          estado: {},
        },
        onSubmit: async () => {},
      }),
    );
    assert.match(apiKeyHtml, /type="password"/);
    assert.match(apiKeyHtml, /role="radiogroup"/);
    assert.match(apiKeyHtml, /Gravar chave no Cofre/);
    assert.doesNotMatch(apiKeyHtml, /<select/i);

    const skillCreateHtml = renderToStaticMarkup(
      React.createElement(SkillSuggestionChatCard, {
        sugestao: {
          sugestao_id: "sug-1",
          mensagem_id: "msg-sug-1",
          agente_id: "estrategista",
          thread_id: null,
          acao: "create",
          skill_id: null,
          nome_skill: "Pauta Trimestral [NOME_DA_MARCA]",
          pergunta_markdown: "Deseja transformar este processo em habilidade?",
          status: "aberta",
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
        },
      }),
    );
    assert.match(skillCreateHtml, /Gravar habilidade/);
    assert.match(skillCreateHtml, /Dispensar sugestão/);
    assert.match(skillCreateHtml, /Expandir instruções/);

    const skillUpdateHtml = renderToStaticMarkup(
      React.createElement(SkillSuggestionChatCard, {
        sugestao: {
          sugestao_id: "sug-2",
          mensagem_id: "msg-sug-2",
          agente_id: "estrategista",
          thread_id: null,
          acao: "update",
          skill_id: "pauta-trimestral",
          nome_skill: "Pauta Trimestral [NOME_DA_MARCA]",
          pergunta_markdown: "Deseja atualizar esta habilidade?",
          status: "aberta",
          criado_em: "2026-11-18T10:00:00.000Z",
          atualizado_em: "2026-11-18T10:00:00.000Z",
        },
      }),
    );
    assert.match(skillUpdateHtml, /Atualizar habilidade/);
  });

  it("renderiza SharedTablesModal, FilesVaultPage com LibraryFolderTree e FilePreviewPanel sem <select>", async () => {
    const { SharedTablesModal } = await vite.ssrLoadModule(
      "/src/features/chat/SharedTablesModal.tsx",
    );
    const { FilesVaultPage } = await vite.ssrLoadModule(
      "/src/features/pages/FilesVaultPage.tsx",
    );
    const { FilePreviewPanel } = await vite.ssrLoadModule(
      "/src/features/chat/FilePreviewPanel.tsx",
    );
    const { CodePreview } = await vite.ssrLoadModule("/src/features/chat/CodePreview.tsx");
    const { MarkdownFilePreview } = await vite.ssrLoadModule(
      "/src/features/chat/MarkdownMathMermaidPreview.tsx",
    );

    const modalHtml = renderToStaticMarkup(
      React.createElement(SharedTablesModal, {
        open: true,
        onClose: () => {},
        initialTables: [
          {
            name: "calendario_editorial",
            ownerAgentId: "estrategista",
            rowCount: 2,
            sql: "CREATE TABLE calendario_editorial (id INTEGER, tema TEXT)",
          },
        ],
        initialSelectedDetail: {
          name: "calendario_editorial",
          ownerAgentId: "estrategista",
          sql: "CREATE TABLE calendario_editorial (id INTEGER, tema TEXT)",
          columns: ["id", "tema"],
          rows: [
            [1, "Bastidores [NOME_DA_MARCA]"],
            [2, "Estudo de Caso"],
          ],
          totalRows: 2,
          truncated: false,
        },
      }),
    );
    assert.match(modalHtml, /Tabelas SQL Compartilhadas/);
    assert.match(modalHtml, /Exportar CSV/);
    assert.match(modalHtml, /Exportar JSON/);
    assert.match(modalHtml, /Excluir tabela/);
    assert.doesNotMatch(modalHtml, /<select/i);

    const vaultHtml = renderToStaticMarkup(
      React.createElement(FilesVaultPage, {
        arquivos: [
          {
            arquivo_id: "arq-1",
            nome_original: "roteiro-campanha.md",
            caminho_relativo: "saidas/roteiro-campanha.md",
            url: "/api/arquivos/raw/saidas%2Froteiro-campanha.md",
            mime_type: "text/markdown",
            tamanho_bytes: 1024,
            tipo_uso: "gerado",
            agente_id: "estrategista",
            tarefa_id: null,
            pasta_id: "fld-1",
            folder_path: "Campanha Outono",
            criado_em: "2026-11-18T10:00:00.000Z",
          },
        ],
        agentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Planejamento",
            frente: "conteudo",
            modelo_padrao: "gemini-2.5-pro",
            status: "ocioso",
            skills_paths: [],
            memoria_resumo: null,
            ordem_exibicao: 1,
            config: {},
            atualizado_em: "2026-11-18T10:00:00.000Z",
          },
        ],
        foldersSnapshot: {
          folders: [
            {
              pasta_id: "fld-1",
              agente_id: "estrategista",
              parent_id: null,
              nome: "Campanha Outono",
              caminho_completo: "Campanha Outono",
              nivel: 1,
              criado_em: "2026-11-18T10:00:00.000Z",
              atualizado_em: "2026-11-18T10:00:00.000Z",
            },
          ],
          placement: { "arq-1": "fld-1" },
          unfiledByAgent: {},
        },
        onUploadFile: async () => ({
          nome: "x.png",
          caminho_relativo: "recursos/x.png",
          url: "/api/arquivos/raw/recursos%2Fx.png",
          mime_type: "image/png",
        }),
      }),
    );
    assert.match(vaultHtml, /Todos os arquivos/);
    assert.match(vaultHtml, /Criar pasta/);
    assert.match(vaultHtml, /Gerado por IA/);
    assert.doesNotMatch(vaultHtml, /<select/i);

    const csvPreviewHtml = renderToStaticMarkup(
      React.createElement(FilePreviewPanel, {
        file: {
          nome: "dados-campanha.csv",
          caminho_relativo: "saidas/dados-campanha.csv",
          url: "/api/arquivos/raw/saidas%2Fdados-campanha.csv",
          mime_type: "text/csv",
        },
        initialTextContent: "formato,meta\nCarrossel,Educar\nReels,Atrair\n",
        onClose: () => {},
      }),
    );
    assert.match(csvPreviewHtml, /Copiar CSV/);
    assert.match(csvPreviewHtml, /Carrossel/);

    const codeHtml = renderToStaticMarkup(
      React.createElement(CodePreview, {
        code: "const marca = '[NOME_DA_MARCA]';\n",
        language: "typescript",
      }),
    );
    assert.match(codeHtml, /Copiar código/);

    const mdHtml = renderToStaticMarkup(
      React.createElement(MarkdownFilePreview, {
        markdown: "# Planejamento [NOME_DA_MARCA]\n\n| Etapa | Status |\n| --- | --- |\n| Briefing | Concluído |",
      }),
    );
    assert.match(mdHtml, /Copiar Markdown/);
    assert.match(mdHtml, /Planejamento \[NOME_DA_MARCA\]/);
  });

  it("renderiza AgentConversationView com pílula reacao_emoji, card embutido por item_type e botão Tabelas SQL", async () => {
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx",
    );

    const chatHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Planejamento de Conteúdo",
          frente: "conteudo",
          modelo_padrao: "gemini-2.5-pro",
          status: "ocioso",
          skills_paths: [],
          memoria_resumo: null,
          ordem_exibicao: 1,
          config: {},
          atualizado_em: "2026-11-18T10:00:00.000Z",
        },
        mensagens: [
          {
            mensagem_id: "msg-u-1",
            canal_id: "agente:estrategista",
            agente_id: "estrategista",
            autor: "usuario",
            autor_nome: "Você",
            conteudo_markdown: "Estruture o calendário de [@SEU_PERFIL].",
            anexos: [],
            steps: [],
            reacao_emoji: "🔥",
            lida: true,
            criado_em: "2026-11-18T10:00:00.000Z",
          },
          {
            mensagem_id: "msg-blk-1",
            canal_id: "agente:estrategista",
            agente_id: "estrategista",
            autor: "agente",
            autor_nome: "Estrategista Editorial",
            conteudo_markdown: "",
            anexos: [],
            steps: [],
            item_type: "ui-block",
            ui_block: {
              bloco_id: "blk-chat-1",
              mensagem_id: "msg-blk-1",
              canal_id: "agente:estrategista",
              agente_id: "estrategista",
              turno_id: "turn-9",
              tipo_ferramenta: "acknowledge_request",
              status: "pending",
              versao: 1,
              criado_em: "2026-11-18T10:00:05.000Z",
              atualizado_em: "2026-11-18T10:00:05.000Z",
              spec: {
                kind: "acknowledge_request",
                title: "Plano Editorial Semanal",
                summaryMarkdown: "Confirme as etapas antes de iniciar.",
                steps: ["Definir pilares", "Gerar briefings"],
              },
              estado: {},
            },
            lida: true,
            criado_em: "2026-11-18T10:00:05.000Z",
          },
        ],
        provedores: [],
        sending: false,
        inspectorOpen: false,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => ({
          nome: "a.png",
          caminho_relativo: "recursos/a.png",
          url: "/api/arquivos/raw/recursos%2Fa.png",
          mime_type: "image/png",
        }),
        onUpdateModelAndEffort: async () => {},
        onOpenSharedTables: () => {},
      }),
    );

    assert.match(chatHtml, /reaction-pill-msg-u-1/);
    assert.match(chatHtml, /🔥/);
    assert.match(chatHtml, /Plano Editorial Semanal/);
    assert.match(chatHtml, /Reconhecer requisitos/);
    assert.match(chatHtml, /Tabelas SQL/);
    assert.doesNotMatch(chatHtml, /<select/i);
  });
});
