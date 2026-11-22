/**
 * Contratos de memoria, aprendizado de skills, shared tables, UI blocks, biblioteca e handoffs.
 */

import type { SkillLearningMode } from "./agents-core.ts";

export type MemoriaInclusao = "essential" | "searchable";

export interface AgenteMemoria {
  memoria_id: string;
  agente_id: string;
  texto: string;
  categoria: MemoriaInclusao;
  escopo_site: string | null;
  origem: "automatica" | "manual";
  controlado_usuario: boolean;
  revisao: number;
  criado_em: string;
  atualizado_em: string;
}

export interface AgenteMemoriasSnapshot {
  memorias: AgenteMemoria[];
  usedBytes: number;
  budgetBytes: number;
  total: number;
  limit: number;
}

export interface SkillSugestaoItem {
  sugestao_id: string;
  mensagem_id: string;
  agente_id: string;
  thread_id: string | null;
  acao: "create" | "update";
  skill_id: string | null;
  nome_skill: string;
  pergunta_markdown: string;
  instrucoes_preview?: string | null;
  status: "aberta" | "salva" | "dispensada" | "expirada";
  criado_em: string;
  atualizado_em: string;
}

export interface AprendizadoConfig {
  skill_learning_mode: SkillLearningMode;
  memory_review_interval: number;
  memory_limit: number;
  plan_start_after_ms: number | null;
}

export interface MemoryReviewAlteracao {
  memoria_id: string;
  acao: "saved" | "updated" | "forgotten" | "notChanged";
  texto: string;
  categoria?: MemoriaInclusao;
  escopo_site?: string | null;
}

export interface SharedTableSummary {
  name: string;
  ownerAgentId: string | null;
  rowCount: number | null;
  sql: string;
  createdAt?: string | null;
}

export interface SharedTableDetail {
  name: string;
  ownerAgentId: string | null;
  sql: string;
  columns: string[];
  rows: unknown[][];
  totalRows: number;
  truncated: boolean;
}

export interface SharedTableQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  note?: string;
}

export interface ChatVisualMeta {
  arquivo_id: string;
  titulo: string;
  altura_inicial?: number;
  url?: string;
}

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  id: string;
  header?: string;
  question: string;
  detail?: string;
  isSecret?: boolean;
  multiSelect?: boolean;
  options?: AskUserQuestionOption[];
}

export interface UiBlockAction {
  id: string;
  label: string;
  tone?: "default" | "primary" | "warning" | "danger";
  confirmHold?: { label?: string; durationMs?: number } | boolean;
}

export interface UiBlockFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface UiBlockFormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "toggle" | "checkbox" | "date";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: UiBlockFieldOption[];
  min?: number;
  max?: number;
}

export type UiBlockVariant =
  | "confirm"
  | "quick_replies"
  | "choice"
  | "form"
  | "approval"
  | "progress"
  | "block_run";

export interface AskUserBlockSpec {
  kind: "ask_user";
  title?: string;
  questions: AskUserQuestion[];
}

export interface AskUiBlockSpec {
  kind: "ask_ui";
  variant: UiBlockVariant;
  title: string;
  description?: string;
  markdownPreview?: string;
  danger?: boolean;
  confirmHold?: { label?: string; durationMs?: number } | boolean;
  options?: UiBlockFieldOption[];
  multiSelect?: boolean;
  fields?: UiBlockFormField[];
  actions?: UiBlockAction[];
}

export interface AcknowledgeBlockSpec {
  kind: "acknowledge_request";
  title: string;
  summaryMarkdown: string;
  steps?: string[];
  planStartAfterMs?: number | null;
}

export interface RequestApiKeyBlockSpec {
  kind: "request_api_key";
  name: string;
  label?: string;
  description?: string;
  docsUrl?: string;
  defaultScope?: "todos_agentes" | "agente_especifico";
}

export interface ConversationUiBlock {
  bloco_id: string;
  mensagem_id: string;
  canal_id: string;
  agente_id: string;
  turno_id: string;
  tipo_ferramenta: "ask_user" | "ask_ui" | "acknowledge_request" | "request_api_key";
  status: "pending" | "answered" | "expired" | "closed";
  versao: number;
  auto_responder_em?: string | null;
  criado_em: string;
  atualizado_em: string;
  spec: Record<string, unknown>;
  estado: Record<string, unknown>;
}

export interface UiBlockSubmitPayload {
  bloco_id: string;
  canal_id: string;
  acao: "answer" | "skip" | "cancel";
  respostas_ask_user?: Record<string, string[] | string>;
  ui_response?: {
    actionId: string;
    values?: Record<string, unknown>;
  };
  api_key_payload?: {
    nome: string;
    valor: string;
    escopo: "todos_agentes" | "agente_especifico";
  };
}

export interface ApiKeyMetadata {
  name: string;
  scope: "todos_agentes" | "agente_especifico";
  agente_id?: string | null;
  source: "vault";
  configured: boolean;
  updated_at: string;
}

export interface BibliotecaPasta {
  pasta_id: string;
  agente_id: string;
  parent_id: string | null;
  nome: string;
  caminho_completo: string;
  nivel: number;
  criado_em: string;
  atualizado_em: string;
}

export interface BibliotecasPastasSnapshot {
  folders: BibliotecaPasta[];
  placement: Record<string, string>;
  unfiledByAgent: Record<string, number>;
}

export interface SendMessageInterAgenteInput {
  recipientAgentIds: string[];
  text: string;
  paths?: string[];
  replyToMessageId?: string | null;
  expectsReply?: boolean;
}

export interface SendMessageInterAgenteResult {
  ok: boolean;
  entregas: Array<{
    mensagem_id: string;
    para_agente_id: string;
    outcome: "steered" | "queued";
    queuedBecause?: "own-turn" | "recipient-queues" | "idle-dispatched";
    reply_to_message_id: string | null;
    expects_reply: boolean;
  }>;
  corretivo?: {
    erro: string;
    pendentes: Array<{
      mensagem_id: string;
      de_agente_id: string;
      trecho: string;
      criado_em: string;
    }>;
  };
}
