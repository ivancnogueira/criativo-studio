import {
  normalizeWorkflowGraph,
  type ProvedorStatusInfo,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTemplateDefinition,
  type WorkflowTemplateId,
} from "@criativo/contracts";
import { resolveFirstConnectedModel } from "./workflow-model-picker";
import { tidyWorkflowLayout } from "./workflow-tidy-layout";

export const WORKFLOW_EMPTY_TEMPLATES: readonly WorkflowTemplateDefinition[] = [
  {
    id: "briefing-diario",
    nome: "Briefing Diário de Conteúdo",
    descricao:
      "Agenda diária às 08:00 para gerar 3 pautas para [NOME_DA_MARCA] e publicar resumo no canal.",
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
          schedule: { kind: "daily", hour: 8, minute: 0, timezone: "America/Sao_Paulo" },
        },
        config: {
          triggerKind: "schedule",
          schedule: { kind: "daily", hour: 8, minute: 0, timezone: "America/Sao_Paulo" },
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
      "Tema sob demanda, copy em [TOM_DE_VOZ], geração de arte 3:4, aprovação humana e publicação no Instagram.",
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
      "Consolida semanalmente métricas de [@SEU_PERFIL], redige diagnóstico executivo e envia após aprovação.",
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
      "Mapeia padrões e brechas competitivas no nicho [NICHO] e salva dossiê pronto para [NOME_DA_MARCA].",
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

/**
 * Instancia um template oficial com novos IDs únicos, preenche modelo viável conectado nos nós de IA
 * e aplica o auto-layout topológico limpo.
 */
export function instantiateWorkflowTemplate(
  templateId: WorkflowTemplateId,
  provedores: readonly ProvedorStatusInfo[],
  overrideTemplates?: readonly WorkflowTemplateDefinition[]
): { template: WorkflowTemplateDefinition; nos: WorkflowNo[]; arestas: WorkflowAresta[] } {
  const sourceList = overrideTemplates && overrideTemplates.length > 0
    ? overrideTemplates
    : WORKFLOW_EMPTY_TEMPLATES;
  const template = sourceList.find((t) => t.id === templateId) ?? WORKFLOW_EMPTY_TEMPLATES[0];

  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const idMap = new Map<string, string>();
  for (const node of template.nos) {
    idMap.set(node.id, `${node.id}_${suffix}`);
  }

  const viable = resolveFirstConnectedModel(provedores);
  const rawNos: WorkflowNo[] = template.nos.map((node) => {
    const newId = idMap.get(node.id)!;
    const nextCfg: Record<string, unknown> = { ...(node.config ?? {}) };
    const clone: WorkflowNo = {
      ...node,
      id: newId,
      config: nextCfg,
    };
    if ((clone.tipo === "llm" || clone.tipo === "condition") && !clone.model && viable) {
      clone.model = viable.model;
      clone.provider = viable.provider;
      nextCfg.model = viable.model;
      nextCfg.provider = viable.provider;
    }
    return clone;
  });

  const rawArestas: WorkflowAresta[] = template.arestas.map((edge, idx) => ({
    ...edge,
    id: `edge_${suffix}_${idx}`,
    origem: idMap.get(edge.origem) ?? edge.origem,
    destino: idMap.get(edge.destino) ?? edge.destino,
  }));

  const normalized = normalizeWorkflowGraph({ nos: rawNos, arestas: rawArestas });
  const arranged = tidyWorkflowLayout(normalized.nos, normalized.arestas);
  return {
    template,
    nos: arranged,
    arestas: normalized.arestas,
  };
}
