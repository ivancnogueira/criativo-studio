import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 13 — Cockpit Tasks, Threads Paralelas, Esperas, Fila, Branch, Pins & Pergunta Lateral (SSR)", () => {
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

  const nowIso = "2026-11-17T12:00:00.000Z";

  const sampleAgents = [
    {
      agente_id: "estrategista",
      nome: "Estrategista Editorial",
      papel: "Calendário & Posicionamento",
      frente: "conteudo",
      modelo_padrao: "gemini-2.5-pro",
      status: "ocioso",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: 1,
      config: { avatar_shape: "hex", avatar_color: "#31CF76" },
      atualizado_em: nowIso,
    },
    {
      agente_id: "copywriter",
      nome: "Copywriter",
      papel: "Ganchos & Legendas",
      frente: "conteudo",
      modelo_padrao: "gemini-2.5-pro",
      status: "trabalhando",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: 2,
      config: { avatar_shape: "blob", avatar_color: "#42A0FF" },
      atualizado_em: nowIso,
    },
  ];

  const sampleThread = {
    thread_id: "th-p13-1",
    agente_id: "estrategista",
    tarefa_id: "task-p13-1",
    origem: "agente",
    titulo: "Roteiro Campanha [NOME_DA_MARCA]",
    titulo_origem: "auto",
    estado: "executando",
    desfecho: null,
    hold: null,
    turno_ativo_id: "turn-1",
    progresso: "Analisando referências visuais...",
    erro: null,
    mensagens_enfileiradas: [],
    branch: {
      origem_thread_id: "main:estrategista",
      origem_task_id: null,
      origem_titulo: "Conversa principal [@SEU_PERFIL]",
      origem_mensagem_id: "msg-orig-1",
      ate_mensagem_id: "msg-orig-1",
      origem_excluida: false,
    },
    rotina_id: null,
    ultima_mensagem_lida_id: null,
    criado_em: nowIso,
    atualizado_em: nowIso,
    arquivada_em: null,
  };

  it("renderiza TaskAgentSelect (listbox sem <select>), TasksComposer, TaskTookLine, TasksSidePanel e TasksQueuePage", async () => {
    const { TaskAgentSelect } = await vite.ssrLoadModule("/src/features/tasks/TaskAgentSelect.tsx");
    const { TasksComposer, TaskTookLine } = await vite.ssrLoadModule(
      "/src/features/tasks/TasksComposer.tsx",
    );
    const { TasksSidePanel } = await vite.ssrLoadModule("/src/features/tasks/TasksSidePanel.tsx");
    const { TasksQueuePage } = await vite.ssrLoadModule("/src/features/pages/TasksQueuePage.tsx");

    const selectHtml = renderToStaticMarkup(
      React.createElement(TaskAgentSelect, {
        agentes: sampleAgents,
        selectedAgentId: "estrategista",
        onSelectAgent: () => {},
        defaultOpen: true,
      }),
    );
    assert.match(selectHtml, /role="listbox"/);
    assert.match(selectHtml, /Estrategista Editorial/);
    assert.match(selectHtml, /Copywriter/);
    assert.doesNotMatch(selectHtml, /<select/i);

    const composerHtml = renderToStaticMarkup(
      React.createElement(TasksComposer, {
        agentes: sampleAgents,
        selectedAgentId: "estrategista",
        onChangeAgent: () => {},
        draft: "Criar série para [@SEU_PERFIL]",
        onChangeDraft: () => {},
        tituloDraft: "Série Semanal",
        onChangeTituloDraft: () => {},
        anexos: [],
        onChangeAnexos: () => {},
        onStartTask: () => {},
      }),
    );
    assert.match(composerHtml, /Iniciar tarefa/);
    assert.match(composerHtml, /\[NOME_DA_MARCA\]/);
    assert.doesNotMatch(composerHtml, /<select/i);

    const undoHtml = renderToStaticMarkup(
      React.createElement(TaskTookLine, {
        pending: {
          clientMessageId: "cli-1",
          agenteId: "estrategista",
          titulo: "Tarefa Rápida",
          conteudo: "Briefing",
          anexos: [],
          expiresAt: Date.now() + 6000,
        },
        agentes: sampleAgents,
        remainingSeconds: 6,
        onChangePendingAgent: () => {},
        onUndo: () => {},
        onOpenNow: () => {},
        onDismiss: () => {},
      }),
    );
    assert.match(undoHtml, /Desfazer envio/);
    assert.match(undoHtml, /Abrir thread/);

    const sidePanelHtml = renderToStaticMarkup(
      React.createElement(TasksSidePanel, {
        open: true,
        thread: sampleThread,
        tarefa: null,
        agente: sampleAgents[0],
        pagina: {
          agente_id: "estrategista",
          thread_id: "th-p13-1",
          turno_ativo_id: "turn-1",
          revisao: 1,
          mensagens: [],
          referencias: {},
          has_older: false,
          older_cursor: null,
        },
        onClose: () => {},
        onOpenInChat: () => {},
        onToggleArchive: async () => {},
        onSendMessage: async () => {},
      }),
    );
    assert.match(sidePanelHtml, /Abrir no Chat/);
    assert.match(sidePanelHtml, /Arquivar thread/);
    assert.match(sidePanelHtml, /Fechar painel/);
    assert.doesNotMatch(sidePanelHtml, /<select/i);

    const emptyPageHtml = renderToStaticMarkup(
      React.createElement(TasksQueuePage, {
        tarefas: [],
        agentes: sampleAgents,
        threads: [],
        selectedTaskId: null,
        steps: [],
        thoughtStream: "",
        onSelectTask: () => {},
        onRetryTask: () => {},
        onCancelTask: () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      }),
    );
    assert.match(emptyPageHtml, /\[NOME_DA_MARCA\]/);
    assert.doesNotMatch(emptyPageHtml, /<select/i);

    const populatedPageHtml = renderToStaticMarkup(
      React.createElement(TasksQueuePage, {
        tarefas: [],
        agentes: sampleAgents,
        threads: [
          sampleThread,
          { ...sampleThread, thread_id: "th-hold", estado: "ociosa", turno_ativo_id: null, hold: "ask_user" },
          { ...sampleThread, thread_id: "th-wait", estado: "enfileirada", turno_ativo_id: null },
          { ...sampleThread, thread_id: "th-unread", estado: "ociosa", turno_ativo_id: null, desfecho: "concluida", ultima_mensagem_lida_id: null },
          { ...sampleThread, thread_id: "th-read", estado: "ociosa", turno_ativo_id: null, desfecho: "concluida", ultima_mensagem_lida_id: "m1" },
          { ...sampleThread, thread_id: "th-arch", estado: "arquivada", turno_ativo_id: null, desfecho: "concluida", arquivada_em: nowIso },
        ],
        selectedTaskId: null,
        steps: [],
        thoughtStream: "",
        onSelectTask: () => {},
        onRetryTask: () => {},
        onCancelTask: () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      }),
    );
    assert.match(populatedPageHtml, /Precisa de você/);
    assert.match(populatedPageHtml, /Em execução/);
    assert.match(populatedPageHtml, /Aguardando/);
    assert.match(populatedPageHtml, /Não lidas/);
    assert.match(populatedPageHtml, /Lidas/);
    assert.match(populatedPageHtml, /Arquivadas/);
    assert.doesNotMatch(populatedPageHtml, /<select/i);
  });

  it("renderiza ThreadTabsBar, BranchDivider, OpenWaitsCard, QueuePanel, SideQuestionPanel, PinnedMessagesPopover e AgentConversationView", async () => {
    const { ThreadTabsBar } = await vite.ssrLoadModule("/src/features/chat/ThreadTabsBar.tsx");
    const { BranchDivider } = await vite.ssrLoadModule("/src/features/chat/BranchDivider.tsx");
    const { OpenWaitsCard } = await vite.ssrLoadModule("/src/features/chat/OpenWaitsCard.tsx");
    const { QueuePanel } = await vite.ssrLoadModule("/src/features/chat/QueuePanel.tsx");
    const { SideQuestionPanel } = await vite.ssrLoadModule("/src/features/chat/SideQuestionPanel.tsx");
    const { PinnedMessagesPopover } = await vite.ssrLoadModule(
      "/src/features/chat/PinnedMessagesPopover.tsx",
    );
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx",
    );

    const tabsHtml = renderToStaticMarkup(
      React.createElement(ThreadTabsBar, {
        threads: [sampleThread],
        activeThreadId: sampleThread.thread_id,
        onSelectThread: () => {},
        onStartNewTaskTab: () => {},
        onDismissThreadTab: () => {},
      }),
    );
    assert.match(tabsHtml, /Conversa principal/);
    assert.match(tabsHtml, /Nova Subconversa/);

    const dividerActive = renderToStaticMarkup(
      React.createElement(BranchDivider, {
        branch: sampleThread.branch,
        onNavigateToOrigin: () => {},
      }),
    );
    assert.match(dividerActive, /Ramificado de Conversa principal \[@SEU_PERFIL\]/);

    const dividerDeleted = renderToStaticMarkup(
      React.createElement(BranchDivider, {
        branch: { ...sampleThread.branch, origem_excluida: true },
        onNavigateToOrigin: () => {},
      }),
    );
    assert.match(dividerDeleted, /Ramificado de conversa removida/);

    const waitsHtml = renderToStaticMarkup(
      React.createElement(OpenWaitsCard, {
        esperas: [
          {
            espera_id: "w1",
            agente_id: "estrategista",
            entrega_origem_id: "m1",
            pedido_texto: "Publicar campanha",
            nota: "Esperar aprovação",
            rotina_id: "rot-1",
            criado_em: nowIso,
            despertada_em: null,
            entrega_despertar_id: null,
            estado: "waiting",
          },
          {
            espera_id: "w2",
            agente_id: "estrategista",
            entrega_origem_id: "m2",
            pedido_texto: "Conferir métricas",
            nota: "Webhook externo",
            rotina_id: "rot-1",
            criado_em: nowIso,
            despertada_em: nowIso,
            entrega_despertar_id: "e-wake",
            estado: "woken",
          },
        ],
        onViewOriginPedido: () => {},
        onCloseWait: async () => {},
      }),
    );
    assert.match(waitsHtml, /Esperas abertas \(2\)/);
    assert.match(waitsHtml, /Aguardando evento/);
    assert.match(waitsHtml, /Despertada/);

    const queueDeliveries = [
      {
        entrega_id: "del-1",
        mensagem_id: "m-q1",
        agente_id: "estrategista",
        thread_id: null,
        remetente_tipo: "usuario",
        conteudo_markdown: "Ajustar CTA do post de [@SEU_PERFIL]",
        anexos: [],
        resposta_para_mensagem_id: null,
        status: "enfileirada",
        posicao: 1,
        turno_id: null,
        erro: null,
        editando: false,
        espera_resposta: true,
        criado_em: nowIso,
      },
      {
        entrega_id: "del-2",
        mensagem_id: "m-q2",
        agente_id: "estrategista",
        thread_id: null,
        remetente_tipo: "usuario",
        conteudo_markdown: "Item em edição bloqueada",
        anexos: [],
        resposta_para_mensagem_id: null,
        status: "enfileirada",
        posicao: 2,
        turno_id: null,
        erro: null,
        editando: true,
        espera_resposta: true,
        criado_em: nowIso,
      },
    ];
    const queueHtml = renderToStaticMarkup(
      React.createElement(QueuePanel, {
        entregas: queueDeliveries,
        suportaSteerNativo: true,
        onBeginEdit: async () => {},
        onCancelOrDelete: async () => {},
        onReorder: async () => {},
        onSteer: async () => {},
        onMoveToTask: async () => {},
        initialConfirmRemoveId: "del-2",
      }),
    );
    assert.match(queueHtml, /Direcionar agora/);
    assert.match(queueHtml, /Mover para tarefa/);
    assert.match(queueHtml, /Editar mensagem/);
    assert.match(queueHtml, /Remover da fila/);
    assert.match(queueHtml, /Confirmar remoção/);
    assert.match(queueHtml, /Manter na fila/);

    const sideHtml = renderToStaticMarkup(
      React.createElement(SideQuestionPanel, {
        open: true,
        agenteNome: "Estrategista [@SEU_PERFIL]",
        threadId: "main:estrategista",
        onAsk: async () => "Resposta",
        onClose: () => {},
      }),
    );
    assert.match(sideHtml, /Perguntar ao lado/);
    assert.match(sideHtml, /Enviar pergunta/);
    assert.match(sideHtml, /\[@SEU_PERFIL\]/);

    const pinsHtml = renderToStaticMarkup(
      React.createElement(PinnedMessagesPopover, {
        pins: [
          {
            thread_id: "main:estrategista",
            mensagem_id: "msg-pin-1",
            thread_titulo: "Chat principal",
            fixado_em: nowIso,
            fixado_por_tipo: "usuario",
            fixado_por_id: null,
            fixado_por_nome: "Você",
            autor: "agente",
            autor_nome: "Estrategista",
            conteudo_resumo: "Decisão fixa de [NOME_DA_MARCA]",
            criado_em: nowIso,
          },
        ],
        currentThreadId: "main:estrategista",
        onJumpToPin: async () => {},
        onUnpin: async () => {},
        defaultOpen: true,
      }),
    );
    assert.match(pinsHtml, /Desafixar mensagem/);

    const chatHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: sampleAgents[0],
        allAgentes: sampleAgents,
        mensagens: [
          {
            mensagem_id: "m-hist-1",
            canal_id: "agente:estrategista",
            thread_id: "main:estrategista",
            agente_id: "estrategista",
            autor: "usuario",
            autor_nome: "Você",
            conteudo_markdown: "Ideia inicial [NOME_DA_MARCA]",
            anexos: [],
            steps: [],
            tarefa_id: null,
            lida: true,
            criado_em: nowIso,
          },
          {
            mensagem_id: "m-reset-1",
            canal_id: "agente:estrategista",
            thread_id: "main:estrategista",
            agente_id: "estrategista",
            autor: "sistema",
            autor_nome: "Sistema",
            conteudo_markdown: "Contexto reiniciado a partir daqui.",
            anexos: [],
            steps: [],
            tarefa_id: null,
            lida: true,
            item_type: "context_reset",
            criado_em: nowIso,
          },
        ],
        provedores: [],
        sending: true,
        inspectorOpen: false,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async () => ({}),
        onUpdateModelAndEffort: async () => {},
        threads: [sampleThread],
        activeThread: null,
        onSelectThread: () => {},
        onCreateQuickThread: () => {},
        pagination: { has_older: true, older_count: 15, has_newer: true },
        onLoadOlderMessages: async () => {},
        onJumpToLatest: async () => {},
        esperas: [],
        filaSnapshot: {
          agente_id: "estrategista",
          thread_id: null,
          modo_ocupado: "queue",
          suporta_steer_nativo: true,
          entregas: [],
        },
        pins: [],
        onBranchFromMessage: async () => {},
        onTogglePinMessage: async () => {},
        onAskSideQuestion: async () => "ok",
        onStartNewChat: async () => {},
        onInterruptTurn: async () => {},
      }),
    );

    assert.match(chatHtml, /Carregar anteriores/);
    assert.match(chatHtml, /Voltar ao fim/);
    assert.match(chatHtml, /Reiniciar contexto/);
    assert.match(chatHtml, /Novo chat iniciado — contexto do modelo reiniciado/);
    assert.match(chatHtml, /Interromper turno/);
    assert.match(chatHtml, /Ramificar conversa/);
    assert.match(chatHtml, /Fixar mensagem/);
    assert.doesNotMatch(chatHtml, /<select/i);
  });
});
