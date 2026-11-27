import {
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTemplateDefinition,
  type WorkflowTemplateId,
  type WorkflowViableModelInfo,
} from "@criativo/contracts";

export const WORKFLOW_MARKETING_TEMPLATES: readonly WorkflowTemplateDefinition[] = [
  {
    id: "briefing-diario",
    nome: "Briefing Diário de Conteúdo",
    descricao:
      "Dispara todo dia às 08:00, estrutura 3 pautas alinhadas a [NOME_DA_MARCA] e envia resumo pronto para o canal da equipe.",
    categoria: "conteudo",
    badge: "Rotina Diária",
    estimativaNos: 4,
    nos: [
      {
        id: "tpl-bd-trigger",
        tipo: "gatilho",
        titulo: "Agenda Diária 08:00",
        x: 120,
        y: 160,
        triggerKind: "schedule",
        trigger: {
          kind: "schedule",
          schedule: {
            kind: "daily",
            hour: 8,
            minute: 0,
            timezone: "America/Sao_Paulo",
          },
        },
        config: {
          triggerKind: "schedule",
          schedule: {
            kind: "daily",
            hour: 8,
            minute: 0,
            timezone: "America/Sao_Paulo",
          },
        },
      },
      {
        id: "tpl-bd-agente",
        tipo: "agente",
        titulo: "Estrategista de Pautas",
        x: 480,
        y: 160,
        agenteId: "estrategista",
        prompt:
          "Crie 3 pautas estratégicas de Instagram para [NOME_DA_MARCA] ([@SEU_PERFIL]) no nicho [NICHO] com tom [TOM_DE_VOZ].",
        config: { agenteId: "estrategista" },
      },
      {
        id: "tpl-bd-llm",
        tipo: "llm",
        titulo: "Síntese Executiva",
        x: 840,
        y: 160,
        prompt:
          "Transforme o briefing recebido abaixo em lista objetiva com gancho, formato sugerido e CTA:\n\n{{input}}",
        config: {},
      },
      {
        id: "tpl-bd-out",
        tipo: "output",
        titulo: "Entregar no Canal",
        x: 1200,
        y: 160,
        target: "canal",
        config: { target: "canal" },
      },
    ],
    arestas: [
      { id: "e-bd-1", origem: "tpl-bd-trigger", destino: "tpl-bd-agente", type: "text" },
      { id: "e-bd-2", origem: "tpl-bd-agente", destino: "tpl-bd-llm", type: "text" },
      { id: "e-bd-3", origem: "tpl-bd-llm", destino: "tpl-bd-out", type: "text" },
    ],
  },
  {
    id: "post-com-imagem",
    nome: "Post com Imagem Automático",
    descricao:
      "Recebe tema sob demanda, gera legenda em [TOM_DE_VOZ], cria arte 3:4, pede aprovação humana e publica no Instagram.",
    categoria: "criacao",
    badge: "Produção Visual",
    estimativaNos: 6,
    nos: [
      {
        id: "tpl-pi-trigger",
        tipo: "gatilho",
        titulo: "Disparo Manual",
        x: 100,
        y: 180,
        triggerKind: "manual",
        trigger: { kind: "manual" },
        config: { triggerKind: "manual" },
      },
      {
        id: "tpl-pi-prompt",
        tipo: "prompt",
        titulo: "Tema da Campanha",
        x: 440,
        y: 180,
        prompt:
          "Marca: [NOME_DA_MARCA] ([@SEU_PERFIL]) · Nicho: [NICHO] · Tom: [TOM_DE_VOZ]\nTema recebido: {{input}}",
        config: {},
      },
      {
        id: "tpl-pi-copy",
        tipo: "agente",
        titulo: "Copywriter Social",
        x: 780,
        y: 180,
        agenteId: "copywriter",
        prompt:
          "Escreva uma headline curta para a arte e legenda persuasiva com CTA para [NOME_DA_MARCA] mantendo o tom [TOM_DE_VOZ].\n\n{{input}}",
        config: { agenteId: "copywriter" },
      },
      {
        id: "tpl-pi-img",
        tipo: "gerar_imagem",
        titulo: "Gerar Arte 3:4",
        x: 1120,
        y: 180,
        prompt:
          "Crie criativo editorial limpo para [NOME_DA_MARCA] inspirado na copy:\n{{input}}",
        config: { aspectRatio: "3:4" },
      },
      {
        id: "tpl-pi-aprov",
        tipo: "approval",
        titulo: "Aprovação Humana",
        x: 1460,
        y: 180,
        question: "Aprovar arte e legenda para envio ao Instagram de [@SEU_PERFIL]?",
        config: {},
      },
      {
        id: "tpl-pi-out",
        tipo: "output",
        titulo: "Publicar no Instagram",
        x: 1800,
        y: 180,
        target: "instagram",
        config: { target: "instagram" },
      },
    ],
    arestas: [
      { id: "e-pi-1", origem: "tpl-pi-trigger", destino: "tpl-pi-prompt", type: "text" },
      { id: "e-pi-2", origem: "tpl-pi-prompt", destino: "tpl-pi-copy", type: "text" },
      { id: "e-pi-3", origem: "tpl-pi-copy", destino: "tpl-pi-img", type: "text" },
      { id: "e-pi-4", origem: "tpl-pi-img", destino: "tpl-pi-aprov", type: "image" },
      { id: "e-pi-5", origem: "tpl-pi-aprov", destino: "tpl-pi-out", type: "image" },
    ],
  },
  {
    id: "relatorio-meta",
    nome: "Relatório Meta para Aprovação",
    descricao:
      "Consolida semanalmente métricas do perfil [@SEU_PERFIL], redige diagnóstico executivo e submete à revisão humana.",
    categoria: "metricas",
    badge: "Analytics Weekly",
    estimativaNos: 5,
    nos: [
      {
        id: "tpl-rm-trigger",
        tipo: "gatilho",
        titulo: "Segunda às 09:00",
        x: 100,
        y: 180,
        triggerKind: "schedule",
        trigger: {
          kind: "schedule",
          schedule: {
            kind: "weekly",
            daysOfWeek: [1],
            hour: 9,
            minute: 0,
            timezone: "America/Sao_Paulo",
          },
        },
        config: {
          triggerKind: "schedule",
          schedule: {
            kind: "weekly",
            daysOfWeek: [1],
            hour: 9,
            minute: 0,
            timezone: "America/Sao_Paulo",
          },
        },
      },
      {
        id: "tpl-rm-analista",
        tipo: "agente",
        titulo: "Analista de Métricas",
        x: 460,
        y: 180,
        agenteId: "analista_metricas",
        prompt:
          "Colete os principais destaques recentes de [@SEU_PERFIL] ([NOME_DA_MARCA], nicho [NICHO]) incluindo alcance, salvamentos e retenção.",
        config: { agenteId: "analista_metricas" },
      },
      {
        id: "tpl-rm-llm",
        tipo: "llm",
        titulo: "Diagnóstico & Próximos Passos",
        x: 820,
        y: 180,
        prompt:
          "Organize os dados abaixo em relatório semanal claro com top 3 acertos, gargalos e 3 ações recomendadas para [NOME_DA_MARCA]:\n\n{{input}}",
        config: {},
      },
      {
        id: "tpl-rm-aprov",
        tipo: "approval",
        titulo: "Validar Relatório",
        x: 1180,
        y: 180,
        question: "Aprovar envio do relatório semanal Meta de [NOME_DA_MARCA]?",
        config: {},
      },
      {
        id: "tpl-rm-out",
        tipo: "output",
        titulo: "Postar no Canal",
        x: 1540,
        y: 180,
        target: "canal",
        config: { target: "canal" },
      },
    ],
    arestas: [
      { id: "e-rm-1", origem: "tpl-rm-trigger", destino: "tpl-rm-analista", type: "text" },
      { id: "e-rm-2", origem: "tpl-rm-analista", destino: "tpl-rm-llm", type: "text" },
      { id: "e-rm-3", origem: "tpl-rm-llm", destino: "tpl-rm-aprov", type: "text" },
      { id: "e-rm-4", origem: "tpl-rm-aprov", destino: "tpl-rm-out", type: "text" },
    ],
  },
  {
    id: "radar-concorrente",
    nome: "Radar Concorrente",
    descricao:
      "Mapeia formatos, ganchos e brechas de posicionamento no nicho [NICHO] e salva dossiê acionável em arquivo.",
    categoria: "inteligencia",
    badge: "Pesquisa Forense",
    estimativaNos: 4,
    nos: [
      {
        id: "tpl-rc-trigger",
        tipo: "gatilho",
        titulo: "Execução Sob Demanda",
        x: 120,
        y: 180,
        triggerKind: "manual",
        trigger: { kind: "manual" },
        config: { triggerKind: "manual" },
      },
      {
        id: "tpl-rc-agente",
        tipo: "agente",
        titulo: "Pesquisador de Mercado",
        x: 480,
        y: 180,
        agenteId: "pesquisador",
        prompt:
          "Analise referências e concorrentes no nicho [NICHO] para posicionar [NOME_DA_MARCA] ([@SEU_PERFIL]) com diferenciação clara. Contexto adicional: {{input}}",
        config: { agenteId: "pesquisador" },
      },
      {
        id: "tpl-rc-llm",
        tipo: "llm",
        titulo: "Matriz de Brechas & Ganchos",
        x: 840,
        y: 180,
        prompt:
          "Transforme os achados abaixo em tabela markdown com: Padrão dos Concorrentes, Brecha Explorável por [NOME_DA_MARCA] e 5 Ganchos em tom [TOM_DE_VOZ]:\n\n{{input}}",
        config: {},
      },
      {
        id: "tpl-rc-out",
        tipo: "output",
        titulo: "Salvar Dossiê em Arquivo",
        x: 1200,
        y: 180,
        target: "arquivo",
        targetRef: "radar-concorrente-[NOME_DA_MARCA].md",
        config: { target: "arquivo", targetRef: "radar-concorrente-[NOME_DA_MARCA].md" },
      },
    ],
    arestas: [
      { id: "e-rc-1", origem: "tpl-rc-trigger", destino: "tpl-rc-agente", type: "text" },
      { id: "e-rc-2", origem: "tpl-rc-agente", destino: "tpl-rc-llm", type: "text" },
      { id: "e-rc-3", origem: "tpl-rc-llm", destino: "tpl-rc-out", type: "text" },
    ],
  },
];

export function findWorkflowTemplate(
  templateId: WorkflowTemplateId | string
): WorkflowTemplateDefinition | undefined {
  return WORKFLOW_MARKETING_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Clona um template oficial e injeta automaticamente o modelo conectado viável nos nós `llm`/`condition` sem modelo fixo.
 */
export function buildTemplateGraphWithViableModel(
  templateId: WorkflowTemplateId | string,
  viableModel?: WorkflowViableModelInfo | null
): { template: WorkflowTemplateDefinition; nos: WorkflowNo[]; arestas: WorkflowAresta[] } {
  const template = findWorkflowTemplate(templateId);
  if (!template) {
    throw new Error(`Template de workflow '${templateId}' não encontrado.`);
  }

  const clonedNos: WorkflowNo[] = template.nos.map((node) => {
    const nextConfig: Record<string, unknown> = { ...(node.config ?? {}) };
    const clone: WorkflowNo = {
      ...node,
      config: nextConfig,
    };

    if ((clone.tipo === "llm" || clone.tipo === "condition") && !clone.model && viableModel?.model) {
      clone.model = viableModel.model;
      nextConfig.model = viableModel.model;
      if (viableModel.provider) {
        clone.provider = viableModel.provider;
        nextConfig.provider = viableModel.provider;
      }
    }
    return clone;
  });

  const clonedEdges: WorkflowAresta[] = template.arestas.map((edge) => ({ ...edge }));
  const normalized = normalizeWorkflowGraph({ nos: clonedNos, arestas: clonedEdges });
  const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
  if (problem) {
    throw new Error(`Template '${templateId}' inválido: ${problem}`);
  }

  return {
    template,
    nos: normalized.nos,
    arestas: normalized.arestas,
  };
}
