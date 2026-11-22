import type {
  AgenteThreadRegistro,
  DesfechoThreadAgente,
  EstadoThreadAgente,
  OrigemThread,
  OrigemTituloThread,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";

export const MAX_OPEN_THREADS_PER_AGENT = 64;
export const AGENT_STARTED_UNFINISHED_LIMIT = 8;
export const AGENT_STARTED_FINISHED_KEPT = 8;

export interface ThreadRow {
  thread_id: string;
  agente_id: string;
  tarefa_id: string | null;
  origem: OrigemThread;
  titulo: string;
  titulo_origem: OrigemTituloThread;
  estado: EstadoThreadAgente;
  desfecho: DesfechoThreadAgente | null;
  erro: string | null;
  progresso_atual: string | null;
  turno_ativo_id: string | null;
  sessao_provedor_id: string | null;
  branch_origem_thread_id: string | null;
  branch_origem_mensagem_id: string | null;
  branch_ate_mensagem_id: string | null;
  rotina_id: string | null;
  ultima_mensagem_lida_id: string | null;
  criado_em: string;
  atualizado_em: string;
  arquivada_em: string | null;
  ultima_sequencia_evento: number;
}

export interface ChatRowForBranch {
  mensagem_id: string;
  canal_id: string;
  agente_id: string | null;
  autor: "usuario" | "agente" | "sistema";
  autor_nome: string | null;
  conteudo_markdown: string;
  anexos_json: string | null;
  steps_json: string | null;
  tarefa_id: string | null;
  lida: number;
  criado_em: string;
  thread_id: string | null;
  turno_id: string | null;
  item_type: string | null;
  status: string | null;
  resposta_para_mensagem_id: string | null;
  ordinal: number | null;
  branch_origem_mensagem_id: string | null;
  metadados_json: string | null;
}

export interface CreateThreadInput {
  threadId?: string;
  agenteId: string;
  tarefaId?: string | null;
  origem: OrigemThread;
  titulo: string;
  tituloOrigem?: OrigemTituloThread;
  estado?: EstadoThreadAgente;
  desfecho?: DesfechoThreadAgente | null;
  progressoAtual?: string | null;
  turnoAtivoId?: string | null;
  sessaoProvedorId?: string | null;
  rotinaId?: string | null;
  bypassOpenLimit?: boolean;
  comandoId?: string;
}

export interface UpdateThreadRuntimePatch {
  estado?: EstadoThreadAgente;
  desfecho?: DesfechoThreadAgente | null;
  erro?: string | null;
  progresso_atual?: string | null;
  turno_ativo_id?: string | null;
  sessao_provedor_id?: string | null;
  arquivada_em?: string | null;
  ultima_sequencia_evento?: number;
}

export interface CreateBranchInput {
  agenteId: string;
  origemThreadId: string;
  origemMensagemId: string;
  requestId: string;
}

/**
 * Store transacional em node:sqlite para sub-conversas paralelas, branches e threads de rotina.
 */

export interface AgentThreadStoreDeps {
  db: import("../database/client.ts").CriativoDatabase;
  registrarEvento: (comandoId: string, agregadoId: string, tipoEvento: string, payload: Record<string, unknown>) => void;
  safeJsonParse: <T>(raw: string | null | undefined, fallback: T) => T;
  loadQueuedSummaryForThread: (threadId: string) => {
    mensagens: import("@criativo/contracts").AgenteThreadMensagemNaFila[];
    fila: import("@criativo/contracts").FilaChatEntrega[];
  };
  mapThreadRow: (row: ThreadRow) => import("@criativo/contracts").AgenteThreadRegistro;
  getThread: (threadId: string) => import("@criativo/contracts").AgenteThreadRegistro | null;
}

export type TailArgs<F> = F extends (deps: AgentThreadStoreDeps, ...args: infer A) => unknown ? A : never;
