import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 11 — UI Agenda, Switch Rotinas, Webhook 3 Passos, Editor & Canvas Fluxos", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true, hmr: false },
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
      papel: "Planejamento de pautas",
      frente: "conteudo",
      modelo_padrao: "gemini-2.5-pro",
      status: "ocioso",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: 1,
      config: { avatar_shape: "hex", avatar_color: "#31cf76" },
      ultima_mensagem: "Resumo diário pronto.",
      ultima_mensagem_em: "2026-11-18T10:00:00.000Z",
      atualizado_em: "2026-11-18T10:00:00.000Z",
    },
    {
      agente_id: "copywriter",
      nome: "Copywriter Criativo",
      papel: "Legendas e ganchos",
      frente: "conteudo",
      modelo_padrao: "claude-3-7-sonnet-latest",
      status: "ocioso",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: 2,
      config: { avatar_shape: "blob", avatar_color: "#38bdf8" },
      ultima_mensagem: null,
      ultima_mensagem_em: null,
      atualizado_em: "2026-11-18T10:00:00.000Z",
    },
  ];

  const sampleChannels = [
    {
      canal_id: "canal-geral",
      nome: "#pauta-semanal",
      descricao: "Canal de produção [NOME_DA_MARCA]",
      membros_agentes: ["estrategista", "copywriter"],
      criado_em: "2026-11-18T10:00:00.000Z",
      atualizado_em: "2026-11-18T10:00:00.000Z",
    },
  ];

  it("1. Formata todas as 9 agendas, calcula períodos Dia/Semana/Mês, valida formulário e gera curl assinado", async () => {
    const fmt = await vite.ssrLoadModule("/src/features/routines/routine-schedule-format.ts");
    const tz = "America/Sao_Paulo";

    assert.match(fmt.formatScheduleSummaryPt({ kind: "hourly", minute: 15 }, tz), /:15/);
    assert.match(fmt.formatScheduleSummaryPt({ kind: "daily", time: "09:00" }, tz), /09:00/);
    assert.match(fmt.formatScheduleSummaryPt({ kind: "weekdays", time: "08:30" }, tz), /Seg–Sex/);
    assert.match(fmt.formatScheduleSummaryPt({ kind: "weekly", weekday: 1, time: "10:00" }, tz), /Seg/);
    assert.match(fmt.formatScheduleSummaryPt({ kind: "monthly", day: 5, time: "07:00" }, tz), /dia 5/);
    assert.match(
      fmt.formatScheduleSummaryPt(
        { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-11-18T00:00:00.000Z" },
        tz
      ),
      /15 minutos/
    );
    assert.match(
      fmt.formatScheduleSummaryPt(
        {
          kind: "advanced",
          months: [],
          days: { kind: "days-of-week", days: [1, 4] },
          time: { kind: "at-time", time: "11:00" },
        },
        tz
      ),
      /11:00/
    );
    assert.match(fmt.formatScheduleSummaryPt({ kind: "custom", expression: "*/10 * * * *" }, tz), /Cron/);
    assert.match(fmt.formatScheduleSummaryPt({ kind: "once", date: "2099-05-01", time: "14:00" }, tz), /01\/05\/2099/);
    assert.equal(fmt.formatScheduleSummaryPt(null, tz, "webhook"), "Webhook autenticado");

    const weekRange = fmt.buildCalendarPeriodRange(new Date("2026-11-18T12:00:00"), "week");
    assert.equal(weekRange.days.length, 7);
    assert.equal(weekRange.days[0].getDay(), 1); // Segunda-feira

    const tooFast = fmt.validateRoutineFormDraft({
      nome: "Teste",
      instrucao: "Checar",
      triggerKind: "schedule",
      schedule: { kind: "interval", amount: 2, unit: "minutes", anchorAt: "2026-11-18T00:00:00Z" },
      timezone: tz,
    });
    assert.match(tooFast ?? "", /3 minutos/);

    const curl = fmt.buildSignedCurlExample("http://127.0.0.1:3000/api/webhooks/rotina/tok-1");
    assert.match(curl, /X-Criativo-Timestamp/);
    assert.match(curl, /X-Criativo-Delivery-Id/);
    assert.match(curl, /X-Criativo-Signature/);
  });

  it("2. Renderiza WorkspaceRail com Agenda e Sidebar alternando Agentes | Rotinas", async () => {
    const { WorkspaceRail } = await vite.ssrLoadModule("/src/components/WorkspaceRail.tsx");
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.tsx");

    const railHtml = renderToStaticMarkup(
      React.createElement(WorkspaceRail, {
        activeSection: "agenda",
        onSelectSection: () => {},
        whatsappStatus: "desconectado",
        onOpenWhatsAppModal: () => {},
        onOpenSettings: () => {},
        onOpenHelp: () => {},
      })
    );
    assert.match(railHtml, /aria-label="Agenda"/);
    assert.doesNotMatch(railHtml, /<select/i);

    const sidebarAgentsHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: sampleAgents,
        canais: sampleChannels,
        selectedAgentId: "estrategista",
        onSelectAgent: () => {},
        viewMode: "agents",
        onChangeViewMode: () => {},
        routineCountsByAgent: { estrategista: 3 },
      })
    );
    assert.match(sidebarAgentsHtml, /Agentes/);
    assert.match(sidebarAgentsHtml, /Rotinas/);
    assert.match(sidebarAgentsHtml, /Canais em Equipe/);

    const sidebarRoutinesHtml = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agentes: sampleAgents,
        canais: sampleChannels,
        selectedAgentId: "estrategista",
        onSelectAgent: () => {},
        viewMode: "routines",
        onChangeViewMode: () => {},
        routineCountsByAgent: { estrategista: 3 },
      })
    );
    assert.doesNotMatch(sidebarRoutinesHtml, /Canais em Equipe/);
    assert.match(sidebarRoutinesHtml, /3 rotinas/);
    assert.doesNotMatch(sidebarRoutinesHtml, /<select/i);
  });

  it("3. Renderiza SchedulePage com grade e estado vazio sem <select>", async () => {
    const { SchedulePage } = await vite.ssrLoadModule("/src/features/schedule/SchedulePage.tsx");

    const filledHtml = renderToStaticMarkup(
      React.createElement(SchedulePage, {
        agentes: sampleAgents,
        canais: sampleChannels,
        initialAgenda: {
          rotinas: [
            {
              rotina_id: "rot-1",
              nome: "Relatório [NOME_DA_MARCA]",
              owner_kind: "agente",
              owner_id: "estrategista",
              ativa: true,
              timezone: "America/Sao_Paulo",
              trigger_kind: "schedule",
              schedule: { kind: "daily", time: "09:00" },
            },
          ],
          execucoes: [
            {
              id: "sched-1",
              rotina_id: "rot-1",
              at: new Date(Date.now() + 3_600_000).toISOString(),
              status: "scheduled",
            },
          ],
        },
        onOpenRoutine: () => {},
        onOpenAgentChat: () => {},
        onCreateFirstRoutine: () => {},
      })
    );
    assert.match(filledHtml, /Agenda de Rotinas/);
    assert.match(filledHtml, /Voltar para hoje/);
    assert.match(filledHtml, /Próximas execuções/);
    assert.match(filledHtml, /Dia/);
    assert.match(filledHtml, /Semana/);
    assert.match(filledHtml, /Mês/);
    assert.doesNotMatch(filledHtml, /<select/i);

    const emptyHtml = renderToStaticMarkup(
      React.createElement(SchedulePage, {
        agentes: sampleAgents,
        canais: sampleChannels,
        initialAgenda: { rotinas: [], execucoes: [] },
        onOpenRoutine: () => {},
        onOpenAgentChat: () => {},
        onCreateFirstRoutine: () => {},
      })
    );
    assert.match(emptyHtml, /Criar rotina/);
    assert.doesNotMatch(emptyHtml, /<select/i);
  });

  it("4. Renderiza AgentRoutinesSettings, WebhookRoutineEditor, RightInspectorPanel e RoutineFlowsCanvas sem <select>", async () => {
    const { AgentRoutinesSettings } = await vite.ssrLoadModule(
      "/src/features/routines/AgentRoutinesSettings.tsx"
    );
    const { WebhookRoutineEditor } = await vite.ssrLoadModule(
      "/src/features/routines/WebhookRoutineEditor.tsx"
    );
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx"
    );
    const { RoutineFlowsCanvas, computeConnectProblem } = await vite.ssrLoadModule(
      "/src/features/routines/RoutineFlowsCanvas.tsx"
    );

    const sampleRoutine = {
      rotina_id: "rot-wh-1",
      owner_kind: "agente",
      owner_id: "estrategista",
      nome: "Gatilho Webhook [NOME_DA_MARCA]",
      instrucao: "Processar evento recebido",
      ativa: true,
      timezone: "America/Sao_Paulo",
      trigger_kind: "webhook",
      schedule: null,
      next_run_at: null,
      webhook: {
        webhook_id: "wh-1",
        route_token: "tok-123456",
        url: "http://127.0.0.1:3000/api/webhooks/rotina/tok-123456",
        event_type: "order.created",
        filters: [{ pointer: "/pedido/status", value: "pago" }],
        ultimo_disparo_em: null,
      },
      limit_policy: "wait",
      missed_policy: "skip",
      run_in: "side_thread",
      destino_resultado: { tipo: "notificacao", destino_nome: "Notificação no Cockpit" },
      criado_em: "2026-11-18T10:00:00.000Z",
      atualizado_em: "2026-11-18T10:00:00.000Z",
    };

    const editorHtml = renderToStaticMarkup(
      React.createElement(AgentRoutinesSettings, {
        ownerKind: "agente",
        ownerId: "estrategista",
        ownerName: "Estrategista Editorial",
        canais: sampleChannels,
        initialRoutines: [sampleRoutine],
        initialSelectedRoutineId: "rot-wh-1",
      })
    );
    assert.match(editorHtml, /Salvar rotina/);
    assert.match(editorHtml, /Excluir rotina/);
    assert.match(editorHtml, /Testar rotina/);
    assert.match(editorHtml, /routine_no_update/);
    assert.match(editorHtml, /Copiar URL do webhook/);
    assert.match(editorHtml, /Rotacionar segredo/);
    assert.match(editorHtml, /Aplicar segredo externo/);
    assert.match(editorHtml, /Enviar evento de teste/);
    assert.match(editorHtml, /Adicionar filtro/);
    assert.match(editorHtml, /Remover filtro/);
    assert.doesNotMatch(editorHtml, /<select/i);

    const whPendingHtml = renderToStaticMarkup(
      React.createElement(WebhookRoutineEditor, {
        rotinaId: null,
        webhook: null,
        revealedSecret: "whsec_teste_unico",
        eventType: "",
        filters: [],
        onChangeEventType: () => {},
        onChangeFilters: () => {},
        onGenerateEndpoint: async () => {},
        onRotateSecret: async () => {},
        onApplyCustomSecret: async () => {},
        onClearRevealedSecret: () => {},
      })
    );
    assert.match(whPendingHtml, /Gerar URL do webhook/);
    assert.match(whPendingHtml, /Copiar segredo HMAC/);
    assert.doesNotMatch(whPendingHtml, /<select/i);

    const inspHtml = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        agente: sampleAgents[0],
        arquivos: [],
        canais: sampleChannels,
        routineCount: 2,
        previewTarefa: null,
        onClose: () => {},
        onOpenFilesPage: () => {},
        onOpenWhatsAppModal: () => {},
        onSaveAgentSettings: async () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      })
    );
    assert.match(inspHtml, /Gerenciar rotinas \(2\)/);
    assert.doesNotMatch(inspHtml, /<select/i);

    const canvasHtml = renderToStaticMarkup(
      React.createElement(RoutineFlowsCanvas, {
        agente: sampleAgents[0],
        allAgentes: sampleAgents,
        initialCanvas: {
          agente_id: "estrategista",
          rotinas: [
            {
              rotina: { ...sampleRoutine, trigger_kind: "schedule", schedule: { kind: "daily", time: "09:00" }, webhook: null },
              recent_runs: [],
              upcoming_runs: [],
              active_flow_run: null,
            },
          ],
          links: [
            {
              link_id: "lnk-1",
              rotina_id: "rot-wh-1",
              from_agent_id: "estrategista",
              to_agent_id: "copywriter",
              instrucao: "Escrever legenda",
              criado_em: "2026-11-18T10:00:00.000Z",
            },
          ],
          positions: [],
          placed_agent_ids: ["estrategista", "copywriter"],
        },
        onOpenRoutineSettings: () => {},
        onOpenAgentChat: () => {},
      })
    );
    assert.match(canvasHtml, /studio-dot-grid/);
    assert.match(canvasHtml, /routine:rot-wh-1/);
    assert.match(canvasHtml, /agent:estrategista/);
    assert.match(canvasHtml, /Executar rotina agora/);
    assert.match(canvasHtml, /Adicionar agente ao fluxo/);
    assert.doesNotMatch(canvasHtml, /<select/i);

    // Valida computeConnectProblem puro no cliente
    assert.equal(computeConnectProblem("estrategista", "estrategista", "estrategista", []), "same-agent");
    assert.equal(computeConnectProblem("estrategista", "copywriter", "estrategista", []), "into-owner");

    // Checa fonte bruto de todos os componentes novos quanto à ausência absoluta de <select
    const filesToScan = [
      "src/features/schedule/SchedulePage.tsx",
      "src/features/routines/WebhookRoutineEditor.tsx",
      "src/features/routines/AgentRoutinesSettings.tsx",
      "src/features/routines/RoutineFlowsCanvas.tsx",
      "src/features/inspector/RightInspectorPanel.tsx",
      "src/components/WorkspaceRail.tsx",
      "src/components/Sidebar.tsx",
    ];
    for (const rel of filesToScan) {
      const content = readFileSync(resolve(webRoot, rel), "utf8");
      assert.doesNotMatch(content, /<select/i, `Proibido elemento select HTML nativo em ${rel}`);
    }
  });
});
