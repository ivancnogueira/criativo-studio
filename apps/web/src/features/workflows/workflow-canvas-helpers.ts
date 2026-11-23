import {
  isAnnotationNodeKind,
  normalizeNodeKind,
  type TipoNoWorkflow,
  type TipoNoWorkflowAnotacao,
  type TipoNoWorkflowExecutavel,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowRunDetail,
  type WorkflowRunOrigin,
  type WorkflowRunStatus,
  type WorkflowStepRecord,
  type WorkflowStepStatus,
  type WorkflowTraco,
} from "@criativo/contracts";

export interface WorkflowPortMeta {
  label: string;
  color: string;
  shapeClass: string;
}

export const WORKFLOW_PORT_META: Record<WorkflowPortType, WorkflowPortMeta> = {
  text: { label: "Texto", color: "#DCDCDC", shapeClass: "rounded-full" },
  image: { label: "Imagem", color: "#42A0FF", shapeClass: "rounded-[4px]" },
  file: { label: "Arquivo", color: "#31CF76", shapeClass: "rotate-45 rounded-[2px]" },
};

export interface WorkflowStatusStyle {
  label: string;
  color: string;
  badgeBgClass: string;
  badgeTextClass: string;
}

export const WORKFLOW_STATUS_META: Record<
  WorkflowRunStatus | WorkflowStepStatus,
  WorkflowStatusStyle
> = {
  running: {
    label: "Em andamento",
    color: "#007CF7",
    badgeBgClass: "bg-[#007CF7]/15 border-[#007CF7]/40",
    badgeTextClass: "text-[#42A0FF]",
  },
  approval: {
    label: "Aguardando aprovação",
    color: "#FF9412",
    badgeBgClass: "bg-[#FF9412]/15 border-[#FF9412]/40",
    badgeTextClass: "text-[#FF9412]",
  },
  stopping: {
    label: "Interrompendo",
    color: "#FF9412",
    badgeBgClass: "bg-[#FF9412]/15 border-[#FF9412]/40",
    badgeTextClass: "text-[#FF9412]",
  },
  done: {
    label: "Concluído",
    color: "#31CF76",
    badgeBgClass: "bg-[#31CF76]/15 border-[#31CF76]/40",
    badgeTextClass: "text-[#31CF76]",
  },
  failed: {
    label: "Falhou",
    color: "#FD2F3B",
    badgeBgClass: "bg-[#FD2F3B]/15 border-[#FD2F3B]/40",
    badgeTextClass: "text-[#FD2F3B]",
  },
  stopped: {
    label: "Interrompido",
    color: "#979797",
    badgeBgClass: "bg-[#2A2A2A] border-white/[0.12]",
    badgeTextClass: "text-[#979797]",
  },
  skipped: {
    label: "Pulado",
    color: "#979797",
    badgeBgClass: "bg-[#2A2A2A] border-white/[0.06]",
    badgeTextClass: "text-[#979797]",
  },
};

export const WORKFLOW_ORIGIN_LABELS: Record<WorkflowRunOrigin, string> = {
  manual: "Manual",
  schedule: "Agendada",
  webhook: "Webhook",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  conector: "Conector externo",
  agente: "Criativo",
};

export const WORKFLOW_NODE_DIMENSIONS: Record<
  TipoNoWorkflowExecutavel | TipoNoWorkflowAnotacao,
  number
> = {
  gatilho: 320,
  prompt: 296,
  asset: 240,
  llm: 350,
  agente: 350,
  gerar_imagem: 300,
  render_video: 300,
  condition: 300,
  approval: 300,
  output: 320,
  nota: 240,
  shape: 200,
  text: 240,
};

export function getWorkflowNodeWidth(node: WorkflowNo): number {
  if (typeof node.width === "number" && node.width > 120) return node.width;
  const normalized = normalizeNodeKind(node.tipo);
  return WORKFLOW_NODE_DIMENSIONS[normalized] ?? 300;
}

export interface WorkflowLibraryItem {
  tipo: TipoNoWorkflow;
  categoria: "gatilhos" | "processamento" | "midia" | "fluxo" | "anotacao";
  titulo: string;
  descricao: string;
}

export const WORKFLOW_NODE_LIBRARY: readonly WorkflowLibraryItem[] = [
  {
    tipo: "gatilho",
    categoria: "gatilhos",
    titulo: "Gatilho do fluxo",
    descricao: "Agenda, Webhook, WhatsApp, Telegram ou Conector",
  },
  {
    tipo: "prompt",
    categoria: "processamento",
    titulo: "Bloco de Prompt",
    descricao: "Texto ou template com {{input}} e dados da marca",
  },
  {
    tipo: "asset",
    categoria: "midia",
    titulo: "Ativo do Estúdio",
    descricao: "Imagem, logo ou arquivo da biblioteca local",
  },
  {
    tipo: "llm",
    categoria: "processamento",
    titulo: "Modelo IA Direto",
    descricao: "Chamada LLM leve sem ferramentas extras",
  },
  {
    tipo: "agente",
    categoria: "processamento",
    titulo: "Executar Criativo",
    descricao: "Delega tarefa completa a um dos 15 especialistas",
  },
  {
    tipo: "gerar_imagem",
    categoria: "midia",
    titulo: "Gerar Imagem IA",
    descricao: "Gera peça visual com referências conectadas",
  },
  {
    tipo: "render_video",
    categoria: "midia",
    titulo: "Renderizar Vídeo",
    descricao: "Monta Reels/Shorts MP4 via Remotion",
  },
  {
    tipo: "condition",
    categoria: "fluxo",
    titulo: "Condição (Sim / Não)",
    descricao: "Ramifica dinamicamente conforme regra booleana",
  },
  {
    tipo: "approval",
    categoria: "fluxo",
    titulo: "Aprovação Humana",
    descricao: "Pausa fluxo aguardando revisão no Cockpit ou Telegram",
  },
  {
    tipo: "output",
    categoria: "fluxo",
    titulo: "Entrega de Saída",
    descricao: "Envia para Canal, WhatsApp, Telegram, Arquivo ou Instagram",
  },
  {
    tipo: "slack_notificar",
    categoria: "fluxo",
    titulo: "Notificar no Slack",
    descricao: "Enviar resumo ou aprovação em canal Slack",
  },
  {
    tipo: "discord_notificar",
    categoria: "fluxo",
    titulo: "Publicar no Discord",
    descricao: "Enviar entrega via bot ou webhook no Discord",
  },
  {
    tipo: "github_acao",
    categoria: "fluxo",
    titulo: "Ação no GitHub",
    descricao: "Abrir issue ou comentar release no repositório",
  },
  {
    tipo: "nota",
    categoria: "anotacao",
    titulo: "Nota Adesiva",
    descricao: "Lembrete visual sem execução",
  },
  {
    tipo: "shape",
    categoria: "anotacao",
    titulo: "Forma Geométrica",
    descricao: "Bloco SVG com 7 formas e cor editável",
  },
  {
    tipo: "text",
    categoria: "anotacao",
    titulo: "Título Livre",
    descricao: "Cabeçalho tipográfico 28px no canvas",
  },
];

export interface WorkflowNodeRunView {
  nodeId: string;
  stepId: string;
  status: WorkflowStepStatus;
  tentativa: number;
  branch: "yes" | "no" | null;
  output: string | null;
  outputTipo: WorkflowPortType | null;
  artifacts: string[];
  erro: string | null;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  tarefaId: string | null;
}

function parseArtifactsSafe(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const paths: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) {
        paths.push(item.trim());
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const candidate =
          typeof obj.path === "string"
            ? obj.path
            : typeof obj.caminho === "string"
              ? obj.caminho
              : "";
        if (candidate) paths.push(candidate);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

export function buildNodeRunViewMap(
  runDetail: WorkflowRunDetail | null,
  soloSteps: readonly WorkflowStepRecord[]
): Map<string, WorkflowNodeRunView> {
  const map = new Map<string, WorkflowNodeRunView>();

  for (const step of soloSteps) {
    if (!map.has(step.node_id)) {
      map.set(step.node_id, {
        nodeId: step.node_id,
        stepId: step.step_id,
        status: step.status,
        tentativa: step.tentativa,
        branch: step.branch,
        output: step.output,
        outputTipo: step.output_tipo,
        artifacts: parseArtifactsSafe(step.artefatos_json),
        erro: step.erro,
        iniciadoEm: step.iniciado_em,
        encerradoEm: step.encerrado_em,
        tarefaId: step.tarefa_id,
      });
    }
  }

  if (runDetail) {
    for (const step of runDetail.steps) {
      map.set(step.node_id, {
        nodeId: step.node_id,
        stepId: step.step_id,
        status: step.status,
        tentativa: step.tentativa,
        branch: step.branch,
        output: step.output,
        outputTipo: step.output_tipo,
        artifacts: parseArtifactsSafe(step.artefatos_json),
        erro: step.erro,
        iniciadoEm: step.iniciado_em,
        encerradoEm: step.encerrado_em,
        tarefaId: step.tarefa_id,
      });
    }
  }

  return map;
}

function buildSnippet72(source: string, termLower: string): string {
  const clean = source.replace(/\s+/g, " ").trim();
  if (clean.length <= 72) return clean;
  const idx = clean.toLowerCase().indexOf(termLower);
  if (idx === -1) return `${clean.slice(0, 69)}...`;
  const start = Math.max(0, idx - 24);
  const end = Math.min(clean.length, start + 72);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < clean.length ? "..." : "";
  return `${prefix}${clean.slice(start, end)}${suffix}`.slice(0, 72);
}

export function searchWorkflowNodes(
  nos: readonly WorkflowNo[],
  runViewMap: ReadonlyMap<string, WorkflowNodeRunView>,
  query: string
): Array<{ node: WorkflowNo; snippet: string; field: string }> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return [];

  const results: Array<{ node: WorkflowNo; snippet: string; field: string }> = [];
  for (const node of nos) {
    const view = runViewMap.get(node.id);
    const candidates: Array<[string, string | null | undefined]> = [
      ["titulo", node.titulo],
      ["subtitulo", node.subtitulo],
      ["prompt", node.prompt ?? (typeof node.config.prompt === "string" ? node.config.prompt : null)],
      [
        "systemPrompt",
        node.systemPrompt ??
          (typeof node.config.systemPrompt === "string" ? node.config.systemPrompt : null),
      ],
      ["rule", node.rule ?? (typeof node.config.rule === "string" ? node.config.rule : null)],
      [
        "question",
        node.question ?? (typeof node.config.question === "string" ? node.config.question : null),
      ],
      ["output", view?.output],
    ];

    for (const [field, value] of candidates) {
      if (value && value.toLowerCase().includes(cleanQuery)) {
        results.push({
          node,
          field,
          snippet: buildSnippet72(value, cleanQuery),
        });
        break;
      }
    }
  }

  return results;
}

export function computeGraphBounds(
  nos: readonly WorkflowNo[],
  tracos: readonly WorkflowTraco[] = []
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  if (nos.length === 0 && tracos.length === 0) {
    return { minX: 0, minY: 0, maxX: 1200, maxY: 720, width: 1200, height: 720 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const n of nos) {
    const w = getWorkflowNodeWidth(n);
    const h = n.height ?? (isAnnotationNodeKind(n.tipo) ? 140 : 210);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }

  for (const t of tracos) {
    for (const [px, py] of t.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 1200, maxY: 720, width: 1200, height: 720 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(400, maxX - minX),
    height: Math.max(260, maxY - minY),
  };
}

export function formatStepDuration(startIso?: string | null, endIso?: string | null): string {
  if (!startIso) return "—";
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return "—";
  const endMs = endIso ? Date.parse(endIso) : Date.now();
  if (Number.isNaN(endMs)) return "—";
  const diffSec = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${mins}m ${secs}s`;
}

export function defaultTitleForNodeType(tipo: TipoNoWorkflow): string {
  const exact = WORKFLOW_NODE_LIBRARY.find((i) => i.tipo === tipo)?.titulo;
  if (exact) return exact;
  const norm = normalizeNodeKind(tipo);
  return WORKFLOW_NODE_LIBRARY.find((i) => i.tipo === norm)?.titulo ?? "Etapa do Fluxo";
}
