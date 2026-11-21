import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 5 — Componentes React do Cockpit Web & Mobile", () => {
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

  it("renderiza Sidebar com os 15 agentes nas 3 frentes e DynamicIsland", async () => {
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");
    const { DynamicIsland } = await vite.ssrLoadModule("/src/components/DynamicIsland.tsx");

    const frentes = [
      ...Array.from({ length: 9 }, (_, i) => ({
        agente_id: `base_${i}`,
        nome: i === 0 ? "Estrategista Editorial" : `Agente Base ${i + 1}`,
        papel: "Especialidade base",
        frente: "conteudo",
        modelo_padrao: "gemini-2.5-pro",
        status: i === 0 ? "trabalhando" : "ocioso",
        skills_paths: [],
        memoria_resumo: null,
        ordem_exibicao: i + 1,
        config: i === 0 ? { skill_slug: "planejar-conteudo" } : {},
        ultima_mensagem: i === 0 ? "# 📋 Carteira Editorial — O que fazer" : null,
        ultima_mensagem_em: i === 0 ? "2026-11-16T08:30:00.000Z" : null,
        atualizado_em: new Date().toISOString(),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        agente_id: `bonus_${i}`,
        nome: `Agente Bônus ${i + 1}`,
        papel: "Especialidade bônus",
        frente: "bonus",
        modelo_padrao: "claude-3-7-sonnet-latest",
        status: "ocioso",
        skills_paths: [],
        memoria_resumo: null,
        ordem_exibicao: i + 10,
        config: {},
        atualizado_em: new Date().toISOString(),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        agente_id: `video_${i}`,
        nome: `Agente Vídeo ${i + 1}`,
        papel: "Remotion vídeo",
        frente: "video",
        modelo_padrao: "gpt-4o",
        status: "ocioso",
        skills_paths: [],
        memoria_resumo: null,
        ordem_exibicao: i + 13,
        config: {},
        atualizado_em: new Date().toISOString(),
      })),
    ];

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: frentes,
        selectedAgentId: null,
        onSelectAgent: () => {},
        onChangeModel: () => {},
      })
    );
    assert.match(sidebarHtml, /Roster \(15 Agentes\)/);
    assert.match(sidebarHtml, /Estrategista Editorial/);
    assert.match(sidebarHtml, /Agente Base 2/);
    assert.match(sidebarHtml, /Agente Bônus 3/);
    assert.match(sidebarHtml, /Agente Vídeo 3/);
    assert.doesNotMatch(sidebarHtml, /planejar-conteudo/);
    assert.doesNotMatch(sidebarHtml, /># 📋 Carteira/);
    assert.match(sidebarHtml, /📋 Carteira Editorial/);
    assert.match(sidebarHtml, /mascote-working/);

    const islandHtml = renderToStaticMarkup(
      React.createElement(DynamicIsland, {
        wsConnected: true,
        runningCount: 1,
        pendingCount: 2,
        awaitingApprovalCount: 1,
        whatsappStatus: "conectado",
        onOpenWhatsAppModal: () => {},
        onOpenVaultModal: () => {},
      })
    );
    assert.match(islandHtml, /Daemon Live/);
    assert.match(islandHtml, /Produzindo agora/);
    assert.match(islandHtml, /WhatsApp Conectado/);
  });

  it("renderiza QueueTimeline, AgentStepsWaterfall, InstagramMobilePreview, ApprovalBridge e WhatsAppPairingModal", async () => {
    const { QueueTimeline } = await vite.ssrLoadModule("/src/features/queue/QueueTimeline.tsx");
    const { AgentStepsWaterfall } = await vite.ssrLoadModule(
      "/src/features/trace/AgentStepsWaterfall.tsx"
    );
    const { InstagramMobilePreview } = await vite.ssrLoadModule(
      "/src/features/preview/InstagramMobilePreview.tsx"
    );
    const { ApprovalBridge } = await vite.ssrLoadModule(
      "/src/features/preview/ApprovalBridge.tsx"
    );
    const { WhatsAppPairingModal } = await vite.ssrLoadModule(
      "/src/features/whatsapp/WhatsAppPairingModal.tsx"
    );

    const emptyQueueHtml = renderToStaticMarkup(
      React.createElement(QueueTimeline, {
        tarefas: [],
        selectedTaskId: null,
        onSelectTask: () => {},
        onCreateTask: async () => {},
        onRetryTask: () => {},
        onCancelTask: () => {},
      })
    );
    assert.match(
      emptyQueueHtml,
      /Nenhuma tarefa pendente\. Os agentes estão prontos para agir\./
    );
    assert.match(emptyQueueHtml, /Disparar Nova Tarefa/);

    const sampleTask = {
      tarefa_id: "12345678-abcd",
      agente_id: "designer_carrossel",
      canal_origem: "whatsapp",
      tipo: "carrossel",
      titulo: "Carrossel 5 Dicas",
      prioridade: 2,
      status: "aguardando_aprovacao",
      payload: {},
      resultado: {
        previews: ["https://exemplo.invalid/s1.png", "https://exemplo.invalid/s2.png"],
        copy: "Legenda de validação da vitrine mobile",
      },
      erro_detalhes: null,
      tentativas: 0,
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
      concluido_em: null,
    };

    const waterfallHtml = renderToStaticMarkup(
      React.createElement(AgentStepsWaterfall, {
        steps: [
          {
            id: "step-1",
            tarefa_id: sampleTask.tarefa_id,
            agente_id: "designer_carrossel",
            step_index: 1,
            ferramenta: "generate_image",
            input: { aspect_ratio: "3:4" },
            timestamp: new Date().toISOString(),
          },
        ],
        thoughtStream: "Gerando lâmina 1 com consistência facial...",
        selectedTaskId: sampleTask.tarefa_id,
      })
    );
    assert.match(waterfallHtml, /#1 generate_image/);
    assert.match(waterfallHtml, /Gerando lâmina 1/);

    const previewHtml = renderToStaticMarkup(
      React.createElement(InstagramMobilePreview, { tarefa: sampleTask })
    );
    assert.match(previewHtml, /@SEU_PERFIL/);
    assert.match(previewHtml, /1\/2/);
    assert.match(previewHtml, /4:5 Feed/);

    const approvalHtml = renderToStaticMarkup(
      React.createElement(ApprovalBridge, {
        tarefa: sampleTask,
        onApprove: async () => {},
        onRequestRevision: async () => {},
      })
    );
    assert.match(approvalHtml, /✓ Aprovar e Publicar Agora/);

    const modalHtml = renderToStaticMarkup(
      React.createElement(WhatsAppPairingModal, {
        open: true,
        status: "aguardando_qrcode",
        qrcodeBase64: "data:image/png;base64,AAA",
        onClose: () => {},
        onConnect: async () => {},
        onDisconnect: async () => {},
      })
    );
    assert.match(
      modalHtml,
      /Abra o WhatsApp &gt; Aparelhos Conectados &gt; Conectar Aparelho/
    );
  });

  it("renderiza componentes principais: MascoteAvatar, OnboardingFlow, NewAgentScreen, AgentConversationView e WorkflowsCanvasPage", async () => {
    const { MascoteAvatar, ChannelMascoteCluster } = await vite.ssrLoadModule(
      "/src/components/MascoteAvatar.tsx"
    );
    const { OnboardingFlow } = await vite.ssrLoadModule(
      "/src/features/onboarding/OnboardingFlow.tsx"
    );
    const { NewAgentScreen } = await vite.ssrLoadModule(
      "/src/features/agents/NewAgentScreen.tsx"
    );
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx"
    );
    const { WorkflowsCanvasPage } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowsCanvasPage.tsx"
    );

    const mascotHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        shape: "hex",
        color: "#31cf76",
        size: 48,
        label: "Mascote Estrategista",
      })
    );
    assert.match(mascotHtml, /Mascote Estrategista/);
    assert.match(mascotHtml, /<svg/);

    const clusterHtml = renderToStaticMarkup(
      React.createElement(ChannelMascoteCluster, {
        members: [{ agente_id: "estrategista" }, { agente_id: "copywriter" }],
      })
    );
    assert.match(clusterHtml, /Avatar do canal em equipe/);

    const onboardingHtml = renderToStaticMarkup(
      React.createElement(OnboardingFlow, {
        initialState: {
          onboarding_concluido: false,
          modo_provedor_inicial: null,
          provedor_selecionado: null,
          telemetria_anonima: false,
          marca_nome: "[NOME_DA_MARCA]",
          perfil_handle: "[@SEU_PERFIL]",
          runtime_versao: "v2.3.0",
          atualizado_em: new Date().toISOString(),
        },
        provedores: [],
        onConnectProvider: async () => {},
        onConnectProviderViaBrowser: async () => ({ ok: true }),
        onComplete: async () => {},
      })
    );
    assert.match(onboardingHtml, /Monte sua/);
    assert.match(onboardingHtml, /equipe de IA\./);
    assert.match(onboardingHtml, /Usar modelos gratuitos/);

    const newAgentHtml = renderToStaticMarkup(
      React.createElement(NewAgentScreen, {
        provedores: [],
        onCreateAgent: async () => {},
      })
    );
    assert.match(newAgentHtml, /Em que este agente deve ajudar\?/);
    assert.match(newAgentHtml, /Criar agente/);
    assert.match(newAgentHtml, /Curador de Ganchos Virais/);

    const chatHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Calendário e pilares",
          modelo_padrao: "gemini-2.5-pro",
          status: "ocioso",
          skills_paths: [],
          memoria_resumo: null,
          ordem_exibicao: 1,
          config: { effort: "alto" },
          atualizado_em: new Date().toISOString(),
        },
        mensagens: [
          {
            mensagem_id: "m1",
            canal_id: "agente:estrategista",
            agente_id: "estrategista",
            autor: "agente",
            autor_nome: "Estrategista Editorial",
            conteudo_markdown: "| Pilar | Formato |\n| --- | --- |\n| Autoridade | Carrossel |",
            anexos: [],
            steps: [],
            lida: true,
            criado_em: new Date().toISOString(),
          },
        ],
        provedores: [],
        sending: false,
        inspectorOpen: true,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async (f) => ({
          nome: f.name,
          caminho_relativo: "recursos/uploads/x.png",
          url: "/api/arquivos/raw?path=x.png",
          mime_type: "image/png",
        }),
        onUpdateModelAndEffort: async () => {},
      })
    );
    assert.match(chatHtml, /Copiar como Markdown/);
    assert.match(chatHtml, /Copiar como CSV/);
    assert.match(chatHtml, /Mensagem para Estrategista Editorial/);

    const wfHtml = renderToStaticMarkup(
      React.createElement(WorkflowsCanvasPage, {
        workflows: [
          {
            workflow_id: "wf-1",
            nome: "Fluxo de trabalho sem título",
            descricao: "",
            nos: [],
            arestas: [],
            ativo: true,
            ultima_execucao_em: null,
            atualizado_em: new Date().toISOString(),
          },
        ],
        agentes: [],
        uso: null,
        onSaveWorkflow: async (w) => ({
          workflow_id: w.workflow_id ?? "wf-1",
          nome: w.nome,
          descricao: "",
          nos: w.nos,
          arestas: w.arestas,
          ativo: true,
          ultima_execucao_em: null,
          atualizado_em: new Date().toISOString(),
        }),
        onExecuteWorkflow: async () => ({ tarefas_criadas: [] }),
      })
    );
    assert.match(wfHtml, /Comece com um gatilho/);
    assert.match(wfHtml, /Adicionar gatilho/);
    assert.match(wfHtml, /Adicionar nó/);
    assert.match(wfHtml, /Uso/);
  });

  it("renderiza Fase 8: anéis na Rail, UsageMetricsPage Carbon Dark, ConnectorsPage sem select nativo e markdown seguro", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const { UsageMetricsPage } = await vite.ssrLoadModule("/src/features/pages/UsageMetricsPage.tsx");
    const { ConnectorsPage } = await vite.ssrLoadModule("/src/features/pages/ConnectorsPage.tsx");
    const { AgentConversationView } = await vite.ssrLoadModule(
      "/src/features/chat/AgentConversationView.tsx"
    );

    const sampleConta = {
      id: "ag-teste-1",
      provedor: "gemini",
      rotulo: "Conta Teste",
      email: "criador@exemplo.invalid",
      plano: "Google AI Pro",
      estado: "conectado",
      padrao: true,
      token_valido: true,
      grupos_cota: [
        {
          nome: "Gemini Models",
          modelos: ["gemini-2.5-pro"],
          janela_5h: {
            rotulo: "5h",
            janela: "5h",
            duracao_minutos: 300,
            restante_percentual: 82,
            usado_percentual: 18,
            reseta_em: null,
            reseta_em_texto: "4 h 12 min",
          },
          janela_semanal: null,
        },
      ],
    };

    const railHtml = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "uso",
        onSelectSection: () => {},
        uso: {
          total_execucoes_24h: 3,
          total_tokens_estimados: 12000,
          contas: [sampleConta],
          provedores: [],
          atualizado_em: new Date().toISOString(),
        },
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenSettings: () => {},
        onOpenHelp: () => {},
      })
    );
    assert.match(railHtml, /Uso da conta criador@exemplo\.invalid: 82% restante/);

    const usageHtml = renderToStaticMarkup(
      React.createElement(UsageMetricsPage, {
        uso: {
          total_execucoes_24h: 3,
          total_tokens_estimados: 42940,
          contas: [sampleConta],
          provedores: [],
          atualizado_em: new Date().toISOString(),
        },
        provedores: [],
        onRefresh: async () => {},
        analytics: {
          periodo_dias: 30,
          agente_id: null,
          coleta_iniciada_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
          totais: {
            sessoes: 1,
            turnos: 2,
            turnos_sem_uso: 0,
            registros_sem_preco: 1,
            registros_incompletos: 0,
            tokens_sem_cache: 42940,
            tokens_processados: 75670,
            entrada_cache: 32730,
            entrada_sem_cache: 37870,
            criacao_cache: 0,
            saida: 5070,
            custo_estimado_usd: null,
          },
          provedores: [
            {
              provedor: "antigravity",
              rotulo: "Antigravity CLI",
              tokens: 42940,
              custo_estimado_usd: null,
              participacao_percentual: 100,
            },
          ],
          por_modelo: [],
          por_agente: [],
          por_dia: [],
          por_habilidade: [],
        },
      })
    );
    assert.match(usageHtml, /Dados parciais/);
    assert.match(usageHtml, /Antigravity CLI/);
    assert.match(usageHtml, /Tokens sem leituras de cache/);
    assert.match(usageHtml, /Habilidade/);
    assert.doesNotMatch(usageHtml, /<select/i);

    const connectorsHtml = renderToStaticMarkup(
      React.createElement(ConnectorsPage, {
        provedores: [
          {
            provedor: "gemini",
            rotulo: "Gemini (Google Antigravity)",
            subtitulo: "Contas OAuth e geração de imagens",
            conectado: true,
            cli_detectado: true,
            cli_versao: "v1.5.9",
            vault_configurado: false,
            modo_conexao: "cli",
            modelos: [
              { id: "gemini-3.1-flash-image", rotulo: "Nano Banana (Imagem)", suporta_imagem: true, restante_percentual: 82 },
            ],
            contas: [sampleConta],
            pool: { habilitado: true, contas_excluidas: [], conta_em_uso: null },
          },
          {
            provedor: "opencode",
            rotulo: "OpenCode",
            subtitulo: "Modelos gratuitos ativos",
            conectado: true,
            cli_detectado: true,
            cli_versao: "v2.3.0",
            vault_configurado: false,
            modo_conexao: "cli",
            modelos: [
              { id: "opencode/glm-5.3-flash-free", rotulo: "OpenCode / GLM 5.3 Flash Free", gratuito: true, padrao: true },
            ],
            contas: [],
            pool: null,
          },
        ],
        vaultKeys: [],
        whatsappStatus: "desconectado",
        habilidades: [
          {
            id: "criar-carrossel",
            nome: "criar-carrossel",
            descricao: "Criação de carrosséis 4:5",
            categoria: "conteudo",
            caminho: "SKILL.md",
            agentes_vinculados: ["designer_carrossel"],
            conteudo_preview: "# Carrossel",
          },
        ],
        onConnectProvider: async () => {},
        onConnectProviderViaBrowser: async () => ({ ok: true }),
        onDisconnectProvider: async () => {},
        onSaveVaultSecret: async () => {},
        onOpenWhatsAppModal: () => {},
        onReopenOnboarding: () => {},
      })
    );
    assert.match(connectorsHtml, /Navegação de Configurações/);
    assert.match(connectorsHtml, /Pesquisar configurações\.\.\./);
    assert.match(connectorsHtml, /Provedores de IA/);
    assert.match(connectorsHtml, /Apps &amp; Canais/);
    assert.match(connectorsHtml, /Habilidades \(Skills\)/);
    assert.match(connectorsHtml, /Cofre \(Vault\)/);
    assert.match(connectorsHtml, /Provedor padrão/);
    assert.match(connectorsHtml, /Conectados/);
    assert.match(connectorsHtml, /OpenCode/);
    assert.match(connectorsHtml, /viewBox="0 0 240 300"/);
    assert.match(connectorsHtml, /criador@exemplo\.invalid/);
    assert.doesNotMatch(connectorsHtml, /<select/i);

    const detailGeminiHtml = renderToStaticMarkup(
      React.createElement(ConnectorsPage, {
        provedores: [
          {
            provedor: "gemini",
            rotulo: "Gemini",
            subtitulo: "Contas OAuth e geração de imagens",
            conectado: true,
            cli_detectado: true,
            cli_versao: "v1.5.9",
            vault_configurado: false,
            modo_conexao: "assinatura",
            modelos: [
              { id: "gemini-3.1-flash-image", rotulo: "Nano Banana (Imagem)", suporta_imagem: true, restante_percentual: 82 },
              { id: "gemini-2.5-pro", rotulo: "Gemini 2.5 Pro", oculto: true },
            ],
            contas: [sampleConta],
            pool: { habilitado: true, contas_excluidas: [], conta_em_uso: sampleConta.id },
          },
        ],
        vaultKeys: [],
        whatsappStatus: "desconectado",
        habilidades: [],
        initialDetailProviderId: "gemini",
        onConnectProvider: async () => {},
        onConnectProviderViaBrowser: async () => ({ ok: true }),
        onTogglePool: async () => {},
        onSetModelsVisibility: async () => {},
        onDisconnectProvider: async () => {},
        onSaveVaultSecret: async () => {},
        onOpenWhatsAppModal: () => {},
        onReopenOnboarding: () => {},
      })
    );
    assert.match(detailGeminiHtml, /Agrupar contas/);
    assert.match(detailGeminiHtml, /1 de 2 modelos aparecem no seletor de modelos\./);
    assert.match(detailGeminiHtml, /Ocultar todos/);
    assert.match(detailGeminiHtml, /Add key/);
    assert.match(detailGeminiHtml, /Adicionar conta/);

    const { ProvidersCatalogView } = await vite.ssrLoadModule(
      "/src/features/pages/ProvidersCatalogView.tsx"
    );
    const connectingClaudeHtml = renderToStaticMarkup(
      React.createElement(ProvidersCatalogView, {
        provedores: [
          {
            provedor: "claude",
            rotulo: "Claude",
            subtitulo: "Claude Code CLI e OAuth",
            conectado: false,
            cli_detectado: true,
            cli_versao: "v2.1.325",
            vault_configurado: false,
            modo_conexao: "nenhum",
            modelos: [{ id: "claude-sonnet-4-5", rotulo: "Claude Sonnet 4.5" }],
            contas: [],
            pool: null,
          },
        ],
        defaultProvider: "claude",
        initialDetailProviderId: "claude",
        authorizingProvider: "claude",
        authError: null,
        pendingAuthUrl: { provedor: "claude", url: "https://claude.ai/oauth/authorize?demo=1" },
        onStartBrowserSignIn: async () => {},
        onCancelBrowserSignIn: async () => {},
        onConnectApiKey: async () => {},
        onDisconnectProvider: async () => {},
        onShowToast: () => {},
      })
    );
    assert.match(connectingClaudeHtml, /Conectando/);
    assert.match(connectingClaudeHtml, /viewBox="0 0 248 248"/);
    assert.match(connectingClaudeHtml, /Conclua o login se uma página do navegador abrir\./);
    assert.match(connectingClaudeHtml, /Cancelar/);
    assert.match(connectingClaudeHtml, /Reiniciar/);
    assert.match(connectingClaudeHtml, /Abrir login aqui/);

    const { ModelProviderPopover } = await vite.ssrLoadModule(
      "/src/components/ModelProviderPopover.tsx"
    );
    const popoverHtml = renderToStaticMarkup(
      React.createElement(ModelProviderPopover, {
        open: true,
        onClose: () => {},
        selectedModel: "gemini-3.8-flash-high",
        selectedEffort: "alto",
        onSelectModelAndEffort: () => {},
        provedores: [
          {
            provedor: "gemini",
            rotulo: "Gemini",
            subtitulo: "Google",
            conectado: true,
            cli_detectado: true,
            cli_versao: "1.5.9",
            vault_configurado: false,
            modo_conexao: "assinatura",
            modelos: [
              { id: "gemini-3.8-flash-high", rotulo: "Gemini Visível" },
              { id: "gemini-hidden-id", rotulo: "Gemini Oculto", oculto: true },
            ],
            contas: [],
            pool: null,
          },
        ],
      })
    );
    assert.match(popoverHtml, /Gemini Visível/);
    assert.doesNotMatch(popoverHtml, /Gemini Oculto/);

    const brandMarkdownHtml = renderToStaticMarkup(
      React.createElement(AgentConversationView, {
        mode: "agent",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Calendário",
          modelo_padrao: "gemini-2.5-pro",
          status: "ocioso",
          skills_paths: [],
          memoria_resumo: null,
          ordem_exibicao: 1,
          config: {},
          atualizado_em: new Date().toISOString(),
        },
        mensagens: [
          {
            mensagem_id: "m-brand",
            canal_id: "agente:estrategista",
            agente_id: "estrategista",
            autor: "agente",
            autor_nome: "Estrategista Editorial",
            conteudo_markdown:
              "Calendário para **[NOME_DA_MARCA]** ([@SEU_PERFIL]) com _destaque editorial_.\n\n---\n\n## O que você pode planejar\n\n### 1. Fundação\n\n| Entregável | Ação |\n| --- | --- |\n| **Diagnóstico editorial** | **Mapeamento** e `tokens` com [Guia Oficial](https://exemplo.invalid) |",
            anexos: [],
            steps: [],
            lida: true,
            criado_em: new Date().toISOString(),
          },
        ],
        provedores: [],
        sending: true,
        liveRun: {
          agenteId: "estrategista",
          agenteNome: "Estrategista Editorial",
          startedAt: Date.now() - 4000,
          statusText: "Executando opencode/glm-5.3-flash-free...",
          steps: [
            {
              id: "st-live-1",
              ferramenta: "opencode:glm-5.3-flash-free",
              titulo: "Gerando resposta em tempo real...",
              status: "executando",
            },
          ],
          streamingText: "Construindo **matriz** inicial...",
        },
        inspectorOpen: true,
        onToggleInspector: () => {},
        onSendMessage: async () => {},
        onUploadFile: async (f) => ({
          nome: f.name,
          caminho_relativo: "recursos/uploads/x.png",
          url: "/api/arquivos/raw?path=x.png",
          mime_type: "image/png",
        }),
        onUpdateModelAndEffort: async () => {},
      })
    );
    assert.match(brandMarkdownHtml, /\[NOME_DA_MARCA\]/);
    assert.doesNotMatch(brandMarkdownHtml, /<em[^>]*>DA<\/em>/);
    assert.match(brandMarkdownHtml, /<em[^>]*>destaque editorial<\/em>/);
    assert.match(brandMarkdownHtml, /<hr/);
    assert.match(brandMarkdownHtml, /<h2[^>]*>O que você pode planejar<\/h2>/);
    assert.match(brandMarkdownHtml, /<h3[^>]*>1\. Fundação<\/h3>/);
    assert.match(brandMarkdownHtml, /<strong[^>]*>Diagnóstico editorial<\/strong>/);
    assert.match(brandMarkdownHtml, /<a[^>]*href="https:\/\/exemplo\.invalid"/);
    assert.match(brandMarkdownHtml, /Executando opencode\/glm-5\.3-flash-free/);
    assert.match(brandMarkdownHtml, /<strong[^>]*>matriz<\/strong>/);
  });

  it("renderiza anéis multi-provedor no WorkspaceRail e botão discreto Reconectar no OnboardingFlow", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const { OnboardingFlow } = await vite.ssrLoadModule("/src/features/onboarding/OnboardingFlow.tsx");

    const railHtml = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "agentes",
        onSelectSection: () => {},
        uso: {
          total_execucoes_24h: 3,
          total_tokens_estimados: 1200,
          atualizado_em: new Date().toISOString(),
          provedores: [],
          contas: [
            {
              id: "ag-1",
              provedor: "gemini",
              rotulo: "Google",
              email: "gemini@exemplo.local",
              padrao: true,
              estado: "conectado",
              grupos_cota: [
                {
                  nome: "Gemini Models",
                  modelos: [],
                  janela_5h: {
                    rotulo: "5 horas",
                    janela: "5h",
                    duracao_minutos: 300,
                    restante_percentual: 82,
                    usado_percentual: 18,
                    reseta_em: null,
                    reseta_em_texto: "3 h 10 min",
                  },
                  janela_semanal: null,
                },
              ],
            },
            {
              id: "ag-2",
              provedor: "gemini",
              rotulo: "Google Secundário",
              email: "gemini2@exemplo.local",
              padrao: false,
              estado: "conectado",
              grupos_cota: [
                {
                  nome: "Gemini Models",
                  modelos: [],
                  janela_5h: {
                    rotulo: "5 horas",
                    janela: "5h",
                    duracao_minutos: 300,
                    restante_percentual: 100,
                    usado_percentual: 0,
                    reseta_em: null,
                    reseta_em_texto: "4 h 59 min",
                  },
                  janela_semanal: null,
                },
              ],
            },
            {
              id: "oa-1",
              provedor: "openai",
              rotulo: "ChatGPT",
              email: "chatgpt@exemplo.local",
              estado: "conectado",
              grupos_cota: [
                {
                  nome: "ChatGPT",
                  modelos: [],
                  janela_5h: {
                    rotulo: "5 horas",
                    janela: "5h",
                    duracao_minutos: 300,
                    restante_percentual: 0,
                    usado_percentual: 100,
                    reseta_em: null,
                    reseta_em_texto: "1 h 50 min",
                  },
                  janela_semanal: {
                    rotulo: "Semanal",
                    janela: "semanal",
                    duracao_minutos: 10080,
                    restante_percentual: 84,
                    usado_percentual: 16,
                    reseta_em: null,
                    reseta_em_texto: "6 d 20 h",
                  },
                },
              ],
            },
            {
              id: "cl-1",
              provedor: "claude",
              rotulo: "Claude",
              email: "claude@exemplo.local",
              estado: "conectado",
              grupos_cota: [
                {
                  nome: "Claude",
                  modelos: [],
                  janela_5h: {
                    rotulo: "5 horas",
                    janela: "5h",
                    duracao_minutos: 300,
                    restante_percentual: 100,
                    usado_percentual: 0,
                    reseta_em: null,
                    reseta_em_texto: "",
                  },
                  janela_semanal: null,
                },
              ],
            },
          ],
        },
      })
    );

    // Ordem: ChatGPT antes de Claude e Gemini + logo interno em cada anel + 1 anel por conta (incluindo múltiplas contas do mesmo provedor)
    const chatGptPos = railHtml.indexOf("Uso da conta ChatGPT");
    const claudePos = railHtml.indexOf("Uso da conta Claude");
    const geminiPos = railHtml.indexOf("Uso da conta gemini@exemplo.local");
    const gemini2Pos = railHtml.indexOf("Uso da conta gemini2@exemplo.local");
    assert.ok(chatGptPos >= 0 && claudePos > chatGptPos && geminiPos > claudePos && gemini2Pos > geminiPos);
    assert.equal(railHtml.includes("Resumo de uso e cotas da conta"), false);

    const onboardingHtml = renderToStaticMarkup(
      React.createElement(OnboardingFlow, {
        initialState: {
          onboarding_concluido: false,
          modo_provedor_inicial: "assinatura",
          provedor_selecionado: "openai",
          telemetria_anonima: true,
        },
        initialStep: 2,
        provedores: [
          {
            provedor: "openai",
            rotulo: "ChatGPT",
            subtitulo: "ChatGPT Plus / Pro",
            conectado: true,
            cli_detectado: true,
            cli_versao: "0.169.0",
            vault_configurado: false,
            modo_conexao: "assinatura",
            modelos: [],
            contas: [
              {
                id: "oa-1",
                provedor: "openai",
                rotulo: "ChatGPT",
                email: "usuario.longo@exemplo.local",
                estado: "conectado",
                grupos_cota: [],
              },
            ],
          },
          {
            provedor: "claude",
            rotulo: "Claude",
            subtitulo: "Claude Pro / Max",
            conectado: false,
            cli_detectado: true,
            cli_versao: "2.1.325",
            vault_configurado: false,
            modo_conexao: "nenhum",
            modelos: [],
          },
        ],
        onConnectProvider: async () => {},
        onComplete: async () => {},
      })
    );

    assert.match(onboardingHtml, /Conecte seu plano/);
    assert.match(onboardingHtml, /border-white\/15 bg-\[#242428\][^"]*">Reconectar<\/button>/);
    assert.match(onboardingHtml, /bg-\[#F0F0F0\][^"]*">Conectar<\/button>/);
    assert.match(onboardingHtml, /max-w-\[165px\]/);
  });

  it("Fase 12 — Editor de Workflows em Grafo, Nós Avançados, Inspetor e Produtividade", async () => {
    const { WorkflowsCanvasPage } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowsCanvasPage.tsx"
    );
    const { WorkflowVersionBar } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowVersionBar.tsx"
    );
    const { WorkflowRunDetail } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowRunDetail.tsx"
    );
    const { WorkflowMinimap } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowMinimap.tsx"
    );
    const { WorkflowSearch } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowSearch.tsx"
    );
    const { WorkflowDeleteUndoToast } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowDeleteUndoToast.tsx"
    );
    const { WorkflowTriggerModal } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowTriggerModal.tsx"
    );
    const { WorkflowSwitcher } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowSwitcher.tsx"
    );

    const nowIso = new Date().toISOString();
    const fullNodes = [
      { id: "n1", tipo: "gatilho", titulo: "Gatilho", x: 100, y: 100, triggerKind: "schedule", config: {} },
      { id: "n2", tipo: "prompt", titulo: "Briefing", x: 460, y: 100, prompt: "Ideia {{input}}", config: {} },
      { id: "n3", tipo: "asset", titulo: "Ativo", x: 460, y: 320, config: {} },
      { id: "n4", tipo: "llm", titulo: "Modelo", x: 820, y: 100, prompt: "Gerar legenda", config: {} },
      { id: "n5", tipo: "agente", titulo: "Especialista", x: 820, y: 320, agenteId: "estrategista", config: {} },
      { id: "n6", tipo: "gerar_imagem", titulo: "Gerar Arte", x: 1180, y: 100, config: {} },
      { id: "n7", tipo: "render_video", titulo: "Render Reels", x: 1180, y: 320, config: {} },
      { id: "n8", tipo: "condition", titulo: "Validar Regra", x: 1540, y: 100, rule: "Tem CTA?", config: {} },
      { id: "n9", tipo: "approval", titulo: "Aprovação", x: 1900, y: 100, question: "Aprovar envio?", config: {} },
      { id: "n10", tipo: "output", titulo: "Saída", x: 2260, y: 100, target: "arquivo", targetRef: "out.txt", config: {} },
      { id: "n11", tipo: "nota", titulo: "Nota", x: 100, y: 400, subtitulo: "Observação", config: {} },
      { id: "n12", tipo: "shape", titulo: "Bloco", x: 400, y: 460, shape: "diamond", config: {} },
      { id: "n13", tipo: "text", titulo: "Cabeçalho", x: 700, y: 460, config: {} },
    ];
    const fullEdges = [
      { id: "e1", origem: "n1", destino: "n2", type: "text" },
      { id: "e2", origem: "n2", destino: "n4", type: "text" },
      { id: "e3", origem: "n4", destino: "n8", type: "text" },
      { id: "e4", origem: "n8", destino: "n9", type: "text", branch: "yes" },
      { id: "e5", origem: "n8", destino: "n10", type: "text", branch: "no" },
      { id: "e6", origem: "n9", destino: "n10", type: "text" },
    ];

    const wfPageHtml = renderToStaticMarkup(
      React.createElement(WorkflowsCanvasPage, {
        workflows: [
          {
            workflow_id: "wf-12",
            nome: "Fluxo Completo",
            descricao: "",
            nos: fullNodes,
            arestas: fullEdges,
            tracos: [{ id: "tr-1", points: [[10, 10], [80, 90]], color: "#42A0FF", width: 3 }],
            ativo: true,
            revisao_grafo: 2,
            ultima_execucao_em: null,
            atualizado_em: nowIso,
          },
        ],
        agentes: [
          {
            agente_id: "estrategista",
            nome: "Estrategista Editorial",
            papel: "Planejamento",
            modelo_padrao: "gemini-2.5-pro",
            status: "ocioso",
            skills_paths: [],
            memoria_resumo: null,
            ordem_exibicao: 1,
            config: {},
            atualizado_em: nowIso,
          },
        ],
        uso: null,
        onSaveWorkflow: async (w) => ({
          workflow_id: w.workflow_id ?? "wf-12",
          nome: w.nome,
          descricao: "",
          nos: w.nos,
          arestas: w.arestas,
          ativo: true,
          revisao_grafo: 3,
          ultima_execucao_em: null,
          atualizado_em: nowIso,
        }),
        onExecuteWorkflow: async () => ({ tarefas_criadas: [] }),
      })
    );

    assert.match(wfPageHtml, /Sim/);
    assert.match(wfPageHtml, /Não/);
    assert.match(wfPageHtml, /Executar fluxo/);
    assert.match(wfPageHtml, /Adicionar nó/);
    assert.match(wfPageHtml, /Abrir inspetor/);
    assert.doesNotMatch(wfPageHtml, /<select/i);

    const verHtml = renderToStaticMarkup(
      React.createElement(WorkflowVersionBar, {
        previewVersion: {
          version_id: "ver-1",
          workflow_id: "wf-12",
          revisao_grafo: 2,
          kind: "auto",
          grafo_json: "{}",
          criado_em: nowIso,
        },
        onExitPreview: () => {},
        onRestoreVersion: () => {},
      })
    );
    assert.match(verHtml, /Versão salva/);
    assert.match(verHtml, /Somente leitura/);
    assert.match(verHtml, /Voltar ao atual/);
    assert.match(verHtml, /Restaurar versão/);

    const sampleRun = {
      run: {
        run_id: "run-7",
        workflow_id: "wf-12",
        numero: 7,
        trigger_node_id: "n1",
        from_node_id: null,
        origem: "manual",
        agendado_para: null,
        chave_idempotencia: "idemp-7",
        revisao_grafo: 2,
        grafo_json: "{}",
        payload: null,
        status: "approval",
        erro: null,
        iniciado_em: nowIso,
        encerrado_em: null,
        atualizado_em: nowIso,
      },
      steps: [
        {
          step_id: "st-fail",
          workflow_id: "wf-12",
          run_id: "run-7",
          node_id: "n4",
          tentativa: 1,
          request_id: "req-1",
          kind: "llm",
          agente_id: null,
          status: "failed",
          tarefa_id: null,
          input: "entrada",
          output: null,
          output_tipo: null,
          artefatos_json: "[]",
          branch: null,
          erro: "Erro de rede simulado",
          iniciado_em: nowIso,
          encerrado_em: nowIso,
          criado_em: nowIso,
          atualizado_em: nowIso,
        },
        {
          step_id: "st-appr",
          workflow_id: "wf-12",
          run_id: "run-7",
          node_id: "n9",
          tentativa: 1,
          request_id: "req-2",
          kind: "approval",
          agente_id: null,
          status: "approval",
          tarefa_id: null,
          input: "Revisar criativo",
          output: null,
          output_tipo: null,
          artefatos_json: "[]",
          branch: null,
          erro: null,
          iniciado_em: nowIso,
          encerrado_em: null,
          criado_em: nowIso,
          atualizado_em: nowIso,
        },
      ],
      deliveries: [],
    };

    const runDetailHtml = renderToStaticMarkup(
      React.createElement(WorkflowRunDetail, {
        open: true,
        runs: [sampleRun],
        selectedRun: sampleRun,
        soloSteps: [],
        nodes: fullNodes,
        onSelectRun: () => {},
        onFocusNode: () => {},
        onStopRun: () => {},
        onDecideStep: () => {},
        onRetryStep: () => {},
        onStopStep: () => {},
        onClose: () => {},
      })
    );
    assert.match(runDetailHtml, /Execução #7/);
    assert.match(runDetailHtml, /Aprovar etapa/);
    assert.match(runDetailHtml, /Rejeitar etapa/);
    assert.match(runDetailHtml, /Retentar etapa/);
    assert.match(runDetailHtml, /Interromper execução/);
    assert.match(runDetailHtml, /Fechar inspetor/);
    assert.doesNotMatch(runDetailHtml, /<select/i);

    const miniHtml = renderToStaticMarkup(
      React.createElement(WorkflowMinimap, {
        nos: fullNodes,
        tracos: [],
        selectedNodeId: "n1",
        viewport: { x: 0, y: 0, width: 1000, height: 600, zoom: 1 },
        onPanToWorld: () => {},
      })
    );
    assert.match(miniHtml, /<svg/);

    const searchHtml = renderToStaticMarkup(
      React.createElement(WorkflowSearch, {
        open: true,
        nos: fullNodes,
        runViewMap: new Map(),
        onSelectResult: () => {},
        onClose: () => {},
      })
    );
    assert.match(searchHtml, /Buscar por nome, prompt ou saída/);
    assert.match(searchHtml, /Fechar busca/);

    const undoHtml = renderToStaticMarkup(
      React.createElement(WorkflowDeleteUndoToast, {
        pending: { workflowId: "wf-12", nome: "Fluxo Completo" },
        onUndoDelete: () => {},
        onCommitDelete: () => {},
      })
    );
    assert.match(undoHtml, /Fluxo excluído/);
    assert.match(undoHtml, /Desfazer exclusão/);

    const trigSchedHtml = renderToStaticMarkup(
      React.createElement(WorkflowTriggerModal, {
        workflowId: "wf-12",
        node: fullNodes[0],
        triggerState: null,
        onApply: () => {},
        onRotateWebhook: async () => ({
          route_id: "r1",
          webhook_url: "/api/workflows/webhook/r1",
          secret: "sec",
        }),
        onClose: () => {},
      })
    );
    assert.match(trigSchedHtml, /Execuções são puladas se o fluxo anterior ainda estiver aberto/);
    assert.doesNotMatch(trigSchedHtml, /<select/i);

    const trigWhHtml = renderToStaticMarkup(
      React.createElement(WorkflowTriggerModal, {
        workflowId: "wf-12",
        node: { ...fullNodes[0], triggerKind: "webhook" },
        triggerState: null,
        onApply: () => {},
        onRotateWebhook: async () => ({
          route_id: "r1",
          webhook_url: "/api/workflows/webhook/r1",
          secret: "sec",
        }),
        onClose: () => {},
      })
    );
    assert.match(trigWhHtml, /Gerar segredo/);
    assert.match(trigWhHtml, /X-Criativo-Signature/);
    assert.doesNotMatch(trigWhHtml, /<select/i);

    const switcherHtml = renderToStaticMarkup(
      React.createElement(WorkflowSwitcher, {
        workflows: [
          {
            workflow_id: "wf-12",
            nome: "Fluxo Completo",
            descricao: "",
            nos: fullNodes,
            arestas: fullEdges,
            ativo: true,
            revisao_grafo: 2,
            ultima_execucao_em: null,
            atualizado_em: nowIso,
          },
        ],
        activeWorkflow: {
          workflow_id: "wf-12",
          nome: "Fluxo Completo",
          descricao: "",
          nos: fullNodes,
          arestas: fullEdges,
          ativo: true,
          revisao_grafo: 2,
          ultima_execucao_em: null,
          atualizado_em: nowIso,
        },
        versions: [],
        onSelectWorkflow: () => {},
        onCreateWorkflow: () => {},
        onRenameWorkflow: () => {},
        onDuplicateWorkflow: () => {},
        onDeleteWorkflow: () => {},
        onPreviewVersion: () => {},
      })
    );
    assert.match(switcherHtml, /Fluxo Completo/);
    assert.doesNotMatch(switcherHtml, /<select/i);
  });
});
