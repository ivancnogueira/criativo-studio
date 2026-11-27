/**
 * Contratos de chat, threads, esperas, fila de entregas e canais de equipe.
 */

import type { ModoMensagemOcupado } from "./agents-core.ts";
import type {
  ChatVisualMeta,
  ConversationUiBlock,
  MemoryReviewAlteracao,
  SkillSugestaoItem,
} from "./memory-ui-data.ts";

export interface AnexoChat {
  arquivo_id?: string;
  nome: string;
  caminho_relativo: string;
  url: string;
  mime_type: string;
  tamanho_bytes?: number;
  tipo_uso?: string;
}

export interface PassoChat {
  id: string;
  ferramenta: string;
  titulo: string;
  detalhes?: string;
  formato?: string;
  status: "executando" | "concluido" | "erro";
  duracao_ms?: number;
}

export type TipoItemMensagemChat =
  | "mensagem"
  | "context_reset"
  | "branch_marker"
  | "wait_event"
  | "routine_run"
  | "ui-block"
  | "memory-changes"
  | "skill-suggestion:create"
  | (string & {});

export type OrigemThread = "usuario" | "agente";
export type OrigemTituloThread = "auto" | "agente" | "usuario";
export type EstadoThreadAgente = "executando" | "enfileirada" | "ociosa" | "arquivada";
export type DesfechoThreadAgente = "concluida" | "falha" | "interrompida";
export type MotivoHoldThread =
  | "limite_tarefas"
  | "reiniciando_agente"
  | "limite_uso"
  | "servidor_ocupado"
  | "agente_ocupado"
  | "um_turno_por_vez"
  | "ask_user"
  | "ask_ui"
  | "acknowledge_request"
  | "request_api_key"
  | "approval";

export interface AgenteThreadBranch {
  origem_thread_id: string;
  origem_task_id: string | null;
  origem_titulo: string | null;
  origem_mensagem_id: string;
  ate_mensagem_id: string;
  origem_excluida?: boolean;
}

export interface AgenteThreadMensagemNaFila {
  entrega_id: string;
  texto: string;
  criado_em: string;
}

export interface AgenteThreadRegistro {
  thread_id: string;
  agente_id: string;
  tarefa_id: string | null;
  origem: OrigemThread;
  titulo: string;
  titulo_origem: OrigemTituloThread;
  estado: EstadoThreadAgente;
  desfecho: DesfechoThreadAgente | null;
  hold: MotivoHoldThread | null;
  turno_ativo_id: string | null;
  progresso: string | null;
  erro: string | null;
  mensagens_enfileiradas: AgenteThreadMensagemNaFila[];
  fila?: FilaChatEntrega[];
  branch: AgenteThreadBranch | null;
  rotina_id: string | null;
  ultima_mensagem_lida_id: string | null;
  criado_em: string;
  atualizado_em: string;
  arquivada_em: string | null;
}

export interface AgenteThreadsSnapshot {
  agente_id: string;
  threads: AgenteThreadRegistro[];
  limite_concorrencia: number;
}

export type EstadoEsperaVisual = "waiting" | "resuming" | "woken";

export interface AgenteEspera {
  espera_id: string;
  agente_id: string;
  entrega_origem_id: string;
  pedido_texto: string;
  nota: string;
  rotina_id: string | null;
  criado_em: string;
  despertada_em: string | null;
  entrega_despertar_id: string | null;
  estado?: EstadoEsperaVisual;
}

export type FilaChatStatus =
  | "enfileirada"
  | "iniciando"
  | "executando"
  | "concluida"
  | "falha"
  | "interrompida"
  | "cancelada";

export type MotivoSteerFallback = "provedor_nao_suporta" | "falha_steer";

export interface FilaChatEntrega {
  entrega_id: string;
  mensagem_id: string;
  agente_id: string;
  thread_id: string | null;
  remetente_tipo: "usuario" | "agente" | "rotina" | "webhook";
  remetente_agente_id?: string | null;
  rotina_id?: string | null;
  conteudo_markdown: string;
  anexos: AnexoChat[];
  resposta_para_mensagem_id: string | null;
  status: FilaChatStatus;
  posicao: number | null;
  turno_id: string | null;
  erro: string | null;
  editando: boolean;
  espera_resposta: boolean;
  steer_fallback?: MotivoSteerFallback | null;
  criado_em: string;
}

export interface FilaChatSnapshot {
  agente_id: string;
  thread_id: string | null;
  modo_ocupado: ModoMensagemOcupado;
  suporta_steer_nativo: boolean;
  entregas: FilaChatEntrega[];
}

export interface MensagemFixada {
  thread_id: string;
  mensagem_id: string;
  thread_titulo: string | null;
  fixado_em: string;
  fixado_por_tipo: "usuario" | "agente";
  fixado_por_id: string | null;
  fixado_por_nome: string | null;
  autor: "usuario" | "agente";
  autor_nome: string;
  conteudo_resumo: string;
  criado_em: string;
}

export interface PaginaConversaThread {
  agente_id: string;
  thread_id: string;
  turno_ativo_id: string | null;
  revisao: number;
  mensagens: MensagemChat[];
  referencias: Record<string, MensagemChat>;
  has_older: boolean;
  older_cursor: string | null;
  older_count?: number;
  has_newer?: boolean;
}

export interface PerguntaLateralTroca {
  id: string;
  pergunta: string;
  perguntada_em: string;
  resposta: string | null;
  respondida_em: string | null;
}

export interface MensagemChat {
  mensagem_id: string;
  canal_id: string;
  agente_id: string | null;
  autor: "usuario" | "agente" | "sistema";
  autor_nome?: string;
  conteudo_markdown: string;
  anexos: AnexoChat[];
  steps: PassoChat[];
  tarefa_id?: string | null;
  thread_id?: string | null;
  turno_id?: string | null;
  item_type?: TipoItemMensagemChat | null;
  status?: "streaming" | "completed" | "failed" | "interrupted";
  resposta_para_mensagem_id?: string | null;
  ordinal?: number;
  branch_origem_mensagem_id?: string | null;
  metadados?: Record<string, unknown>;
  ui_block?: ConversationUiBlock | null;
  reacao_emoji?: string | null;
  skill_sugestao?: SkillSugestaoItem | null;
  visual_page?: ChatVisualMeta | null;
  memory_changes?: MemoryReviewAlteracao[] | null;
  lida: boolean;
  criado_em: string;
}

export type CanalNavegadorModo = "all" | "leader" | "none";

export interface CanalMemoria {
  memoria_id: string;
  canal_id: string;
  texto: string;
  origem: "automatica" | "manual";
  criado_em: string;
}

export interface CanalEquipe {
  canal_id: string;
  nome: string;
  descricao: string;
  instrucoes?: string;
  pasta: string;
  membros_agentes: string[];
  lider_agente_id?: string | null;
  navegador_modo?: CanalNavegadorModo;
  manter_memorias?: boolean;
  context_cutoff_at?: string | null;
  context_summary?: string | null;
  memorias_count?: number;
  rotinas_count?: number;
  nao_lidas?: number;
  ultima_mensagem?: string | null;
  /** Sinaliza que o registro teve erro isolado de leitura/mapeamento e foi degradado com segurança. */
  erro_leitura?: boolean;
  criado_em: string;
  atualizado_em: string;
}
