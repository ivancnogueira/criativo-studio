import {
  type ToolDefinition,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowOp,
  type WorkflowPortType,
} from "@criativo/contracts";

export const LAYOUT_COL_WIDTH = 380;
export const LAYOUT_ROW_HEIGHT = 220;
export const MAX_STEP_PREVIEW_CHARS = 600;

export const WORKFLOW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_workflows",
    description:
      "Lista todos os workflows disponíveis no estúdio com status ativo, revisão atual e contagem de nós.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_workflow",
    description:
      "Lê a estrutura completa de um workflow (nós, arestas, gatilhos e execuções recentes). Por padrão omite coordenadas x/y para economizar contexto.",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow" },
        layout: {
          type: "boolean",
          description: "Quando true, inclui coordenadas visuais x/y e dimensões dos nós",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "edit_workflow",
    description:
      "Cria ou edita um workflow aplicando operações incrementais no grafo (add, update, move, remove, connect, disconnect) e auto-layout.",
    parameters: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Opcional. Se omitido, cria um novo workflow com os nós e operações informados.",
        },
        nome: { type: "string", description: "Nome do workflow" },
        descricao: { type: "string", description: "Descrição do workflow" },
        ativo: { type: "boolean", description: "Define se o workflow está ativo" },
        tidy: {
          type: "boolean",
          description: "Quando true, reorganiza automaticamente todas as coordenadas sem sobreposição",
        },
        ops: {
          type: "array",
          description: "Lista ordenada de operações de edição de nós e conexões",
          items: {
            type: "object",
          },
        },
      },
    },
  },
  {
    name: "delete_workflow",
    description:
      "Exclui permanentemente um workflow. Exige confirmação humana explícita (`confirmed_by_human: true`).",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow a excluir" },
        confirmed_by_human: {
          type: "boolean",
          description: "Obrigatório ser true após confirmação explícita do usuário no chat.",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "run_workflow",
    description:
      "Dispara a execução de um workflow completo, a partir de um gatilho específico ou parcialmente a partir de qualquer nó (`from_node_id`).",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow" },
        trigger_node_id: {
          type: "string",
          description: "Opcional. ID do nó gatilho inicial quando houver mais de um gatilho.",
        },
        from_node_id: {
          type: "string",
          description: "Opcional. Executa parcialmente a partir deste nó reutilizando saídas anteriores válidas.",
        },
        payload: {
          type: "string",
          description: "Opcional. Texto ou JSON de entrada inicial para o workflow.",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "read_workflow_runs",
    description:
      "Consulta o histórico de execuções de um workflow ou o detalhe nó-a-nó de uma execução (`run_id`) com saídas compactadas.",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Identificador do workflow" },
        run_id: { type: "string", description: "Opcional. ID de uma execução específica." },
        limit: { type: "number", description: "Máximo de execuções retornadas (padrão 10)" },
      },
      required: ["workflow_id"],
    },
  },
];

export const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOL_DEFINITIONS.map((t) => t.name));

export function isWorkflowToolName(name: string): boolean {
  return WORKFLOW_TOOL_NAMES.has(name);
}

export type WorkflowOpInput =
  | WorkflowOp
  | {
      op: "add";
      ref?: string;
      node: Partial<WorkflowNo> & { ref?: string };
    }
  | {
      op: "connect";
      edge?: Partial<WorkflowAresta> & { from?: string; to?: string };
      origem?: string;
      destino?: string;
      type?: WorkflowPortType;
      branch?: WorkflowBranch | null;
    };

