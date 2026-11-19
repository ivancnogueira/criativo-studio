/**
 * Contratos compartilhados do Criativo AI Studio Online.
 * Define tipos de provedores de IA, fila FIFO, eventos WebSocket e agentes.
 */

import type { McpOAuthStatus } from "./mcp-contracts.ts";
import type {
  RoutineOwnerKind,
  RoutineRunStatus,
} from "./routines.ts";
import type {
  WhatsAppMensagemRegistro,
  WhatsAppPairingRequest,
} from "./whatsapp-contracts.ts";
import type {
  WorkflowBranch,
  WorkflowRunStatus,
  WorkflowStepStatus,
} from "./workflow-graph.ts";

export type ProviderName = "gemini" | "claude" | "openai" | "grok" | "opencode" | "ollama";

export type FrenteAgente = "conteudo" | "bonus" | "video" | "custom";

export type NivelEsforco = "baixo" | "medio" | "alto";

export type AvatarShape =
  | "hex"
  | "blob"
  | "pill"
  | "triangle"
  | "diamond"
  | "cloud"
  | "rounded_square"
  | "octo";

export type CanalOrigem = "web" | "whatsapp" | "telegram" | "rotina_cron" | "webhook";

export type StatusTarefa =
  | "pendente"
  | "executando"
  | "aguardando_aprovacao"
  | "concluido"
  | "falha"
  | "cancelado";

export type StatusAgente = "ocioso" | "trabalhando" | "pausado";

export type StatusMensageria = "desconectado" | "aguardando_qrcode" | "conectado";

export type TipoMensagemCanal =
  | "texto"
  | "handoff"
  | "ferramenta_log"
  | "solicitacao_aprovacao";

export interface AgenteRegistro {
  agente_id: string;
  nome: string;
  papel: string;
  frente?: FrenteAgente;
  modelo_padrao: string;
  status: StatusAgente;
  skills_paths: string[];
  memoria_resumo: string | null;
  ordem_exibicao: number;
  config: Record<string, unknown>;
  backup_models?: BackupModelsConfig;
  permission_level?: PermissionLevel;
  allow_new_chat?: boolean;
  allow_quick_ack?: boolean;
  browser_profile_id?: string | null;
  notification_level?: AgentNotificationLevel;
  pinned?: boolean;
  hidden?: boolean;
  section_id?: string | null;
  atualizado_em: string;
}

export interface TarefaRegistro {
  tarefa_id: string;
  agente_id: string | null;
  canal_origem: CanalOrigem;
  tipo: string;
  titulo: string;
  prioridade: number;
  status: StatusTarefa;
  payload: Record<string, unknown>;
  resultado: Record<string, unknown> | null;
  erro_detalhes: string | null;
  tentativas: number;
  thread_id?: string | null;
  origem?: "usuario" | "agente" | "rotina" | "webhook";
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  output: unknown;
  isError?: boolean;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallRequest[];
}

export interface AgentTurnContext {
  model: string;
  systemPrompt: string;
  messages: ConversationMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface AgentStepEvent {
  type: "thought" | "tool_call" | "text_delta" | "done";
  tokenChunk?: string;
  toolCall?: ToolCallRequest;
}

export interface AgentTurnResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AIProviderClient {
  name: ProviderName;
  generateText(prompt: string, systemPrompt?: string): Promise<string>;
  executeTurn(turnContext: AgentTurnContext): Promise<AgentTurnResult>;
  streamTurn(
    turnContext: AgentTurnContext,
    onChunk: (event: AgentStepEvent) => void
  ): Promise<AgentTurnResult>;
}

export type WebSocketEventMap = {
  "task:queued": {
    tarefa_id: string;
    tipo: string;
    titulo: string;
    prioridade: number;
    canal_origem?: CanalOrigem;
  };
  "task:started": {
    tarefa_id: string;
    agente_id: string;
  };
  "agent:step": {
    tarefa_id: string;
    agente_id: string;
    ferramenta: string;
    input: unknown;
    step_index: number;
  };
  "agent:thought": {
    tarefa_id: string;
    agente_id: string;
    token_chunk: string;
  };
  "task:awaiting_approval": {
    tarefa_id: string;
    tipo: string;
    previews: string[];
    copy: string;
  };
  "task:completed": {
    tarefa_id: string;
    permalink_instagram?: string | null;
    tempo_total_ms: number;
  };
  "task:failed": {
    tarefa_id: string;
    erro: string;
    pode_retentar: boolean;
  };
  "whatsapp:status": {
    status: StatusMensageria;
    qrcode: string | null;
    numero?: string | null;
  };
  "chat:message": {
    canal_id: string;
    agente_id: string | null;
    mensagem: MensagemChat;
  };
  "chat:progress": {
    canal_id: string;
    agente_id: string | null;
    turno_id: string;
    fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
    mensagem_status?: string;
    step?: PassoChat;
    delta?: string;
  };
  "workflow:status": {
    workflow_id: string;
    status: "executando" | "concluido" | "falha";
    no_atual?: string | null;
    resumo?: string | null;
  };
  "provider:updated": {
    provedor: ProviderName;
    conectado: boolean;
    modo: "cli" | "api_key" | "local" | "assinatura" | "nenhum";
  };
  "provider:auth_url": {
    provedor: "gemini" | "claude" | "openai";
    url: string;
  };
  "whatsapp.conta_atualizada": {
    conta_id: string;
    status: StatusMensageria;
    qrcode_base64: string | null;
    pairing_code: string | null;
    numero_telefone: string | null;
    ultimo_erro?: string | null;
  };
  "whatsapp.pairing_solicitado": {
    conta_id: string;
    request: WhatsAppPairingRequest;
  };
  "whatsapp.mensagem_recebida": {
    conta_id: string;
    mensagem: WhatsAppMensagemRegistro;
  };
  "mcp.status_atualizado": {
    mcp_id: string;
    ativo: boolean;
    oauth_status: McpOAuthStatus;
    qtd_ferramentas: number;
    ultimo_erro?: string | null;
  };
  "mcp.oauth_solicitado": {
    mcp_id: string;
    nome: string;
    app_slug?: string | null;
    authorize_url?: string | null;
    canal_id?: string | null;
    agente_id?: string | null;
    motivo: string;
  };
  "mcp.oauth_concluido": {
    mcp_id: string;
    sucesso: boolean;
    conta_chave?: string | null;
    erro?: string | null;
  };
  "loja.skill_atualizada": {
    skill_id: string;
    acao: "criada" | "instalada" | "atualizada" | "vinculada" | "removida";
  };
  "loja.agente_instalado": {
    agente_id: string;
    slug: string;
  };
  "loja.app_atualizado": {
    app_slug: string;
    acao: "conectado" | "acesso" | "testado" | "conta_removida";
    ok?: boolean;
  };
  "onboarding:updated": {
    onboarding: OnboardingEstado;
    setup_assistant_visible: boolean;
  };
  "routine:updated": {
    owner_kind: RoutineOwnerKind;
    owner_id: string;
    rotina_id: string;
    acao: "created" | "updated" | "deleted";
  };
  "routine:run_updated": {
    rotina_id: string;
    execucao_id: string;
    owner_kind: RoutineOwnerKind;
    owner_id: string;
    status: RoutineRunStatus;
    silenciada: boolean;
  };
  "routine:webhook_received": {
    rotina_id: string;
    recibo_id: string;
    status: "started" | "ignored";
    reason: "event-type" | "filter" | "inactive" | null;
  };
  "routine_flow:updated": {
    affected_agent_ids: string[];
    rotina_id: string;
    execucao_id?: string;
  };
  "routine:notification": {
    rotina_id: string;
    rotina_nome: string;
    owner_id: string;
    resumo: string;
    execucao_id: string;
  };
  "workflow:updated": {
    workflow_id: string;
    revisao_grafo: number;
    agente_id?: string | null;
    acao: "created" | "saved" | "deleted" | "restored";
  };
  "workflow:run_updated": {
    workflow_id: string;
    run_id: string;
    numero: number;
    status: WorkflowRunStatus;
  };
  "workflow:step_updated": {
    workflow_id: string;
    run_id: string | null;
    step_id: string;
    node_id: string;
    status: WorkflowStepStatus;
    branch?: WorkflowBranch | null;
  };
  "threads:changed": {
    agente_id: string;
    snapshot: AgenteThreadsSnapshot;
  };
  "thread:message": {
    agente_id: string;
    thread_id: string;
    mensagem: MensagemChat;
  };
  "thread:progress": {
    agente_id: string;
    thread_id: string;
    turno_id: string;
    fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
    mensagem_status?: string;
    step?: PassoChat;
    delta?: string;
  };
  "waits:changed": {
    agente_id: string;
    esperas: AgenteEspera[];
  };
  "chat_queue:changed": {
    agente_id: string;
    thread_id: string | null;
    snapshot: FilaChatSnapshot;
  };
  "pins:changed": {
    agente_id: string;
    pins: MensagemFixada[];
  };
  "context:reset": {
    agente_id: string;
    thread_id: string;
    cutoff_at: string;
    mensagem_divisor: MensagemChat;
  };
  "chat:ui_block": {
    canal_id: string;
    agente_id: string;
    mensagem_id: string;
    bloco: ConversationUiBlock;
  };
  "chat:reaction": {
    canal_id: string;
    mensagem_id: string;
    emoji: string;
    agente_id: string;
  };
  "memory:reviewed": {
    agente_id: string;
    thread_id: string | null;
    alteracoes: MemoryReviewAlteracao[];
  };
  "skill:suggested": {
    agente_id: string;
    mensagem_id: string;
    sugestao_id: string;
    acao: "create" | "update";
    nome_skill: string;
  };
  "library:folders_changed": {
    agente_id?: string;
    revisao: number;
  };
  "shared_table:changed": {
    acao: "created" | "updated" | "deleted";
    table_name: string;
    owner_agent_id: string | null;
  };
  "agent:message_queued": {
    mensagem_id: string;
    de_agente_id: string;
    para_agente_id: string;
    outcome: "steered" | "queued";
    reply_to_message_id: string | null;
    expects_reply: boolean;
  };
  "browser:frame": {
    tabId: string;
    dataUrl: string;
    width: number;
    height: number;
    url: string;
    title: string;
    userControl: boolean;
    agenteId?: string | null;
    perfilId?: string | null;
  };
  "browser:takeover_requested": BrowserTakeoverSession;
  "browser:takeover_resolved": {
    takeoverId: string;
    tabId: string;
    agenteId: string | null;
    decision: "complete" | "cancel";
    url?: string;
    title?: string;
  };
  "browser:teach_status": {
    tabId: string;
    agenteId: string;
    recording: boolean;
    startedAt: number | null;
    stepsCount: number;
  };
  "screen:capture_requested": CaptureScreenConsentRequest;
  "sidebar:updated": {
    revision: number;
  };
  "settings:updated": {
    atualizado_em: string;
  };
  "showcase:updated": {
    acao: "published" | "replaced" | "deleted";
    site_id: string;
    slug: string;
  };
  "license:updated": LicenseActivationStatus;
  "servers:updated": {
    servers: StudioServerRecord[];
    active_server_id: string;
  };
  "server:claim_updated": ServerClaimTicket;
  "update:status": UpdateStatusSnapshot;
};

export interface AgenteConfigVisual {
  frente?: FrenteAgente;
  skill_slug?: string;
  pasta?: string;
  avatar_shape?: AvatarShape;
  avatar_color?: string;
  effort?: NivelEsforco;
  customizado?: boolean;
  prompt_base?: string;
  modo_ocupado?: ModoMensagemOcupado;
  allow_new_chat?: boolean;
  allow_quick_acknowledgement?: boolean;
  allow_quick_ack?: boolean;
  backup_models?: BackupModelsConfig;
  permission_level?: PermissionLevel;
  browser_profile_id?: string | null;
  notification_level?: AgentNotificationLevel;
  pinned?: boolean;
  hidden?: boolean;
  section_id?: string | null;
  skill_learning_mode?: SkillLearningMode;
  task_limit?: number;
  context_cutoff_at?: string | null;
  [key: string]: unknown;
}

export interface MarcosOnboardingStudio {
  instalacao: "pendente" | "concluido";
  perfil: "pendente" | "concluido";
  identidade_visual: "pendente" | "concluido";
  configuracoes: "pendente" | "concluido";
  primeiro_post: "pendente" | "concluido";
  postagem: "pendente" | "concluido";
}

export interface IdentidadeMarcaStudio {
  marca_nome: string;
  perfil_handle: string;
  nicho: string;
  publico_alvo: string;
  oferta_principal: string;
  tom_voz: string;
  cores: {
    fundo: string;
    texto: string;
    primaria: string;
    secundaria: string;
    acento: string;
  };
  fontes: {
    titulo: string;
    texto: string;
  };
  marcos: MarcosOnboardingStudio;
  atualizado_em: string;
}

export interface PacoteUpgradeInfo {
  id: "bonus" | "video";
  nome: string;
  descricao: string;
  instalado: boolean;
  agentes: string[];
  skills: string[];
  comando_cli: string;
}

export interface OnboardingEstado {
  onboarding_concluido: boolean;
  modo_provedor_inicial: "gratuito" | "assinatura" | null;
  provedor_selecionado: ProviderName | null;
  telemetria_anonima: boolean;
  marca_nome: string;
  perfil_handle: string;
  marcos?: MarcosOnboardingStudio;
  setup_assistant_dismissed?: boolean;
  pendencias_setup?: string[];
  runtime_versao: string;
  atualizado_em: string;
}

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

export type ModoMensagemOcupado = "steer" | "queue";
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

// ============================================================================
// Fase 14 — Aprendizado Autônomo, Shared SQL, Generative UI, Biblioteca & Handoff
// ============================================================================

export type MemoriaInclusao = "essential" | "searchable";
export type SkillLearningMode = "off" | "ask" | "automatic";

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

export interface CanalEquipe {
  canal_id: string;
  nome: string;
  descricao: string;
  pasta: string;
  membros_agentes: string[];
  nao_lidas?: number;
  ultima_mensagem?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ModeloProvedorInfo {
  id: string;
  rotulo: string;
  padrao?: boolean;
  suporta_imagem?: boolean;
  gratuito?: boolean;
  oculto?: boolean;
  restante_percentual?: number | null;
  reseta_em?: string | null;
  esforcos_suportados?: NivelEsforco[];
  grupo_cota?: string | null;
  descoberto_em_conta?: boolean;
}

export interface JanelaCotaConta {
  bucket_id?: string;
  rotulo: string;
  janela: "5h" | "semanal" | "mensal" | "outro";
  duracao_minutos: number;
  restante_percentual: number;
  usado_percentual: number;
  reseta_em: string | null;
  reseta_em_texto: string;
}

export interface GrupoCotaConta {
  nome: string;
  modelos: string[];
  janela_5h: JanelaCotaConta | null;
  janela_semanal: JanelaCotaConta | null;
}

export interface ContaProvedorInfo {
  id: string;
  provedor: ProviderName;
  rotulo: string | null;
  email: string | null;
  organizacao?: string | null;
  plano?: string | null;
  estado: "conectado" | "verificando" | "desconectado" | "erro";
  padrao?: boolean;
  token_valido?: boolean;
  token_expira_em?: string | null;
  grupos_cota: GrupoCotaConta[];
  modelos_disponiveis?: string[];
  origem?: "sistema" | "openbot" | "criativo";
}

export interface PoolContasConfig {
  habilitado: boolean;
  contas_excluidas: string[];
  conta_em_uso: string | null;
}

export interface ProvedorStatusInfo {
  provedor: ProviderName;
  rotulo: string;
  subtitulo: string;
  conectado: boolean;
  cli_detectado: boolean;
  cli_versao: string | null;
  cli_executavel?: string | null;
  vault_configurado: boolean;
  modo_conexao: "cli" | "api_key" | "local" | "assinatura" | "nenhum";
  modelos: ModeloProvedorInfo[];
  contas?: ContaProvedorInfo[];
  pool?: PoolContasConfig | null;
  usado_por_agentes?: string[];
  reporta_cota?: boolean;
}

export interface JanelaCotaUso {
  janela: string;
  rotulo: string;
  restante_percentual: number;
  usado_tokens: number;
  limite_tokens: number;
  reseta_em_texto: string;
  reseta_em?: string | null;
}

export interface UsoProvedoresSnapshot {
  total_execucoes_24h: number;
  total_tokens_estimados: number;
  contas?: ContaProvedorInfo[];
  provedores: Array<{
    provedor: ProviderName;
    rotulo: string;
    conectado: boolean;
    email?: string | null;
    janelas: JanelaCotaUso[];
    grupos?: GrupoCotaConta[];
  }>;
  atualizado_em: string;
}

export interface TotaisAnalyticsUso {
  sessoes: number;
  turnos: number;
  turnos_sem_uso: number;
  registros_sem_preco: number;
  registros_incompletos: number;
  tokens_sem_cache: number;
  tokens_processados: number;
  entrada_cache: number;
  entrada_sem_cache: number;
  criacao_cache: number;
  saida: number;
  custo_estimado_usd: number | null;
}

export interface LinhaDetalheUso extends TotaisAnalyticsUso {
  chave: string;
  nome: string;
  provedor?: string | null;
  participacao_percentual: number | null;
}

export interface PontoDiarioUso {
  data: string;
  rotulo: string;
  custo_usd: number;
  tokens: number;
  turnos: number;
}

export interface RelatorioAnalyticsHost {
  periodo_dias: number;
  agente_id: string | null;
  coleta_iniciada_em: string;
  atualizado_em: string;
  totais: TotaisAnalyticsUso;
  provedores: Array<{
    provedor: string;
    rotulo: string;
    tokens: number;
    custo_estimado_usd: number | null;
    participacao_percentual: number | null;
  }>;
  por_modelo: LinhaDetalheUso[];
  por_agente: LinhaDetalheUso[];
  por_dia: PontoDiarioUso[];
  por_habilidade: Array<{
    habilidade: string;
    carregamentos: number;
    tokens: number;
    custo_estimado_usd: number | null;
    participacao_percentual: number | null;
  }>;
}

export interface HabilidadeInstaladaInfo {
  id: string;
  nome: string;
  descricao: string;
  categoria: "conteudo" | "video" | "estrategia" | "sistema" | "outros";
  caminho: string;
  agentes_vinculados: string[];
  conteudo_preview: string;
}

export interface ConectorIntegracaoInfo {
  id:
    | "whatsapp"
    | "instagram"
    | "telegram"
    | "elevenlabs"
    | "fish_audio"
    | "mcp"
    | "slack"
    | "discord"
    | "github";
  nome: string;
  categoria: "mensageria" | "publicacao" | "voz" | "sistema";
  descricao: string;
  subtitulo: string;
  status: "conectado" | "atencao" | "desconectado";
  resumo_estado: string;
  cor_marca: string;
  agente_orquestrador_id?: string | null;
  detalhes: Array<{ chave: string; rotulo: string; configurado: boolean; valor_mascarado?: string | null }>;
}

export interface ArquivoStudio {
  arquivo_id: string;
  nome_original: string;
  caminho_relativo: string;
  url: string;
  mime_type: string;
  tamanho_bytes: number;
  tipo_uso: "referencia" | "logo" | "personagem" | "gerado" | "video" | "documento";
  agente_id: string | null;
  tarefa_id: string | null;
  pasta_id?: string | null;
  folder_path?: string | null;
  criado_em: string;
}

export interface WebSocketEnvelope<K extends keyof WebSocketEventMap = keyof WebSocketEventMap> {
  event: K;
  data: WebSocketEventMap[K];
  timestamp: string;
}

// ============================================================================
// Fase 15 — Browser CDP, Mídia, Backup Models, Sidebar, Settings & Showcase
// ============================================================================

export type BrowserProxyProtocol = "http" | "https" | "socks5";

export interface BrowserProxyConfig {
  proxy_id: string;
  nome: string;
  servidor: string;
  protocolo?: BrowserProxyProtocol;
  usuario?: string | null;
  senha_configurada?: boolean;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface BrowserProfileProxyPayload {
  proxy_id?: string | null;
  server?: string | null;
  username?: string | null;
  password_vault_key?: string | null;
}

export interface BrowserProfileInfo {
  perfil_id: string;
  nome: string;
  cor_hex: string;
  user_data_dir: string;
  cdp_porta?: number | null;
  proxy_url?: string | null;
  proxy?: BrowserProfileProxyPayload;
  agentes_count?: number;
  abas_count?: number;
  compartilhado?: boolean;
  criado_em?: string | null;
  ultimo_uso_em?: string | null;
}

export type BrowserTargetSelector =
  | { kind: "ref"; ref: string; revision?: number }
  | { kind: "role"; role: string; name?: string; exact?: boolean; nth?: number }
  | { kind: "text"; text: string; exact?: boolean; nth?: number }
  | { kind: "css"; selector: string; nth?: number }
  | { kind: "point"; x: number; y: number };

export interface BrowserSnapshotElement {
  ref: string;
  role: string;
  tag: string;
  name: string;
  value?: string;
  placeholder?: string;
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  isSensitive?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface BrowserSnapshotResult {
  tabId: string;
  perfilId: string;
  url: string;
  title: string;
  revision: number;
  elements: BrowserSnapshotElement[];
  textSummary: string;
  truncated: boolean;
  imageDataUrl?: string | null;
}

export interface BrowserTabSummary {
  tabId: string;
  perfilId: string;
  agenteId: string | null;
  url: string;
  title: string;
  revision: number;
  userControl: boolean;
  screencastActive: boolean;
  lastActivityAt: string;
}

export interface BrowserStatusReport {
  available: boolean;
  executablePath: string | null;
  reason?: string | null;
  activeContexts: number;
  activeTabs: number;
  tabs: BrowserTabSummary[];
}

export type BrowserTakeoverReason =
  | "login"
  | "2fa"
  | "captcha"
  | "passkey"
  | "payment"
  | "sign-in-blocked"
  | "manual";

export interface BrowserTakeoverSession {
  takeoverId: string;
  tabId: string;
  perfilId?: string;
  agenteId: string | null;
  canalId?: string | null;
  reason: BrowserTakeoverReason;
  url: string;
  title: string;
  status: "pending" | "active" | "completed" | "cancelled";
  previewDataUrl?: string | null;
  criadoEm: string;
}

export interface BrowserSecretRequest {
  requestId: string;
  tabId: string;
  agenteId: string | null;
  canalId?: string | null;
  host: string;
  method: "password" | "otp" | "authenticator";
  targets: BrowserTargetSelector[];
  digits?: number;
  loginId?: string | null;
  username?: string | null;
  submission?: "enter" | "click" | "none";
  submitTarget?: BrowserTargetSelector | null;
}

export interface UserBrowsingStep {
  log_id: string;
  agente_id: string;
  kind: "page" | "click";
  host: string;
  path: string;
  title?: string | null;
  role?: string | null;
  name?: string | null;
  revisado: boolean;
  criado_em: number;
}

export interface ReadVideoResult {
  url: string;
  title: string;
  uploader?: string | null;
  webpage_url?: string | null;
  durationSeconds?: number | null;
  uploadDate?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  description?: string | null;
  transcript: Array<{ seconds: number; text: string }>;
  frames: string[];
  transcriptNote?: string;
  framesNote?: string;
}

export interface ReadImageResult {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  mimeType: string;
  bytes: number;
}

export interface CaptureScreenConsentRequest {
  captureId: string;
  agenteId: string;
  canalId: string;
  purpose: string;
  targetHint?: string | null;
  status: "pending" | "granted" | "declined" | "expired";
  criadoEm: string;
}

export interface BackupModelChoice {
  provedor: ProviderName;
  modelo: string;
  conta_id?: string | null;
}

export interface BackupModelsConfig {
  automatic: boolean;
  order: BackupModelChoice[];
}

export type PermissionLevel = "workspace" | "ask" | "full";
export type AgentNotificationLevel = "all" | "mentions" | "muted";

export interface UsageLimitAskPayload {
  ask_id: string;
  agente_id: string;
  canal_id: string;
  modelo_atual: string;
  provedor_atual: ProviderName;
  motivo: string;
  opcoes: BackupModelChoice[];
}

export interface SidebarSectionNode {
  section_id: string;
  nome: string;
  parent_id: string | null;
  ordem: number;
  colapsada: boolean;
  nivel: number;
  criado_em: string;
  atualizado_em: string;
}

export interface SidebarLayoutSnapshot {
  revision: number;
  sections: SidebarSectionNode[];
  order: string[];
  agentAssignments: Record<string, string | null>;
  agentOrder: string[];
  pins: string[];
  hiddenAgentIds: string[];
}

export type SidebarLayoutMutation =
  | { op: "create_section"; nome: string; parentId?: string | null }
  | { op: "rename_section"; sectionId: string; nome: string }
  | { op: "delete_section"; sectionId: string }
  | { op: "toggle_collapse"; sectionId: string; colapsada: boolean }
  | { op: "nest_section"; sectionId: string; parentId: string | null; beforeSectionId?: string | null }
  | { op: "move_agent"; agentId: string; sectionId: string | null; beforeAgentId?: string | null }
  | { op: "set_pin"; agentId: string; pinned: boolean }
  | { op: "set_hidden"; agentId: string; hidden: boolean }
  | { op: "reorder_pins"; pins: string[] };

export interface StudioUserSettings {
  geral: {
    atalho_envio: "enter" | "mod_enter";
    ordenacao_sidebar: "secoes" | "recente" | "alfabetica";
    exibir_passos_agente: boolean;
    acoes_compactas: boolean;
  };
  aparencia: {
    tema: "carbon_dark" | "midnight_contrast" | "light";
    cor_acento: string;
    escala: 80 | 90 | 100 | 110 | 120;
    fonte_interface: string;
    fonte_codigo: string;
    idioma: "pt-BR" | "en" | "es";
    sidebar_width?: number;
    inspector_width?: number;
  };
  comportamento: {
    restaurar_ultima_aba: boolean;
    exibir_dynamic_island: boolean;
    detalhe_dynamic_island: "compacto" | "detalhado";
    habilitar_drawer_rapido: boolean;
    sidebar_open?: boolean;
    inspector_open?: boolean;
    focus_mode?: boolean;
  };
  notificacoes: {
    web_habilitadas: boolean;
    mostrar_preview: boolean;
    som_tarefa: "cristal" | "suave" | "pulso" | "silencio";
    som_feedback: "cristal" | "suave" | "pulso" | "silencio";
    matriz: Record<string, AgentNotificationLevel>;
  };
  voz: {
    provedor_ditado: "web_speech" | "whisper" | "gemini";
    modelo_tts: "edge_tts" | "elevenlabs" | "fish_audio";
    velocidade: number;
    leitura_automatica: boolean;
    live_voice_habilitada: boolean;
  };
  atualizado_em: string;
}

export interface WhatsNewReleaseInfo {
  versao_atual: string;
  verificado_em: string;
  atualizacao_disponivel: boolean;
  notas: Array<{
    versao: string;
    data: string;
    added: string[];
    changed: string[];
    fixed: string[];
  }>;
}

export type StorageUsageCategory =
  | "uploads"
  | "artes_geradas"
  | "videos"
  | "perfis_navegador"
  | "banco_dados";

export interface StorageUsageItem {
  categoria: StorageUsageCategory;
  rotulo: string;
  cor_hex: string;
  bytes: number;
  arquivos_count: number;
}

export interface StorageUsageSnapshot {
  totalBytes: number;
  categorias: StorageUsageItem[];
  topFiles: Array<{
    arquivo_id: string;
    nome: string;
    caminho_relativo: string;
    bytes: number;
    agente_id: string | null;
    criado_em: string;
  }>;
  porAgente: Record<string, number>;
  atualizado_em: string;
}

export interface ShowcaseSiteSummary {
  site_id: string;
  slug: string;
  titulo: string;
  descricao: string;
  source_dir: string;
  public_dir: string;
  url_local: string;
  spa_fallback: boolean;
  agente_id: string | null;
  aprovado_por_humano: boolean;
  ativo: boolean;
  arquivos_count?: number;
  tamanho_bytes?: number;
  criado_em: string;
  atualizado_em: string;
}

export interface OptionalConnectorWebhookEvent {
  conector_id: "slack" | "discord" | "github";
  evento: string;
  canal_ou_repo?: string | null;
  autor?: string | null;
  texto?: string | null;
  dados: Record<string, unknown>;
  recebido_em: string;
}

export type LicensePlanTier = "individual" | "agencia_10" | "agencia_ilimitada";
export type LicenseUpgradeSlug = "bonus" | "video";
export type LicenseStatusCode =
  | "active"
  | "grace_offline"
  | "missing"
  | "revoked"
  | "expired"
  | "machine_limit"
  | "grace_exceeded"
  | "invalid_signature";

export interface LicenseLimitsConfig {
  plan_tier: LicensePlanTier;
  nome_exibicao: string;
  max_servers: number;
  max_local_servers: number;
  max_remote_servers: number;
  max_machines: number;
  permite_multimarca: boolean;
}

export interface LicensePayload {
  version: number;
  license_id: string;
  license_key: string;
  customer_email: string;
  customer_name?: string;
  plan_tier: LicensePlanTier;
  status: "active" | "suspended" | "revoked" | "expired";
  max_servers: number;
  max_machines: number;
  upgrades: LicenseUpgradeSlug[];
  machine_id: string;
  issued_at: string;
  last_verified_at: string;
  grace_until: string;
  expires_at: string | null;
}

export interface LicenseCertificate {
  payload: LicensePayload;
  signature: string;
  key_id: string;
}

export interface LicenseDeviceRecord {
  machine_id: string;
  hostname: string;
  os_platform: string;
  app_version?: string;
  first_activated_at: string;
  last_heartbeat_at: string;
  is_current_machine?: boolean;
}

export interface LicenseActivationStatus {
  valid: boolean;
  status_code: LicenseStatusCode;
  plan_tier: LicensePlanTier | null;
  plan_label: string;
  customer_email?: string;
  masked_key?: string;
  max_servers: number;
  servers_used: number;
  max_machines: number;
  machines_used: number;
  upgrades: LicenseUpgradeSlug[];
  unlocked_agents_count?: number;
  last_verified_at?: string;
  grace_until?: string;
  offline_days_remaining?: number;
  devices: LicenseDeviceRecord[];
  message?: string;
  hub_url: string;
}

export type ServerConnectionKind = "primary" | "local_child" | "remote_vps" | "joined";
export type ServerRuntimeStatus = "online" | "starting" | "offline" | "error";

export interface StudioServerRecord {
  server_id: string;
  nome: string;
  slug: string;
  kind: ServerConnectionKind;
  status: ServerRuntimeStatus;
  cor_hex: string;
  base_url: string;
  workspace_path?: string | null;
  port?: number | null;
  remote_ip?: string | null;
  version?: string | null;
  is_active: boolean;
  created_at: string;
  last_seen_at?: string | null;
  last_error?: string | null;
}

export interface ServerClaimTicket {
  claim_id: string;
  server_name: string;
  command_bash: string;
  command_agent_prompt: string;
  expires_at: string;
  ttl_seconds: number;
  status: "pending" | "redeemed" | "expired";
  paired_server?: StudioServerRecord | null;
}

export interface ServerInviteToken {
  server_id: string;
  invite_url: string;
  token_masked: string;
  expires_at: string;
}

export interface ServerQuotaSummary {
  allowed: boolean;
  servers_used: number;
  max_servers: number;
  local_used: number;
  max_local_servers: number;
  remote_used: number;
  max_remote_servers: number;
  reason?: string;
}

export type UpdateChannel = "stable" | "beta";
export type UpdatePhaseState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "applying"
  | "ready_to_restart"
  | "up_to_date"
  | "error"
  | "license_blocked";

export const META_GRAPH_API_VERSION = "v27.0" as const;

export function resolveMetaGraphApiVersion(overrideVersion?: string | null): string {
  const candidate =
    overrideVersion?.trim() ||
    (typeof process !== "undefined" ? process.env?.META_API_VERSION?.trim() : "") ||
    META_GRAPH_API_VERSION;
  return /^v\d+\.\d+$/i.test(candidate) ? candidate : META_GRAPH_API_VERSION;
}

export function resolveMetaGraphApiBase(overrideVersion?: string | null): string {
  return `https://graph.facebook.com/${resolveMetaGraphApiVersion(overrideVersion)}`;
}

export interface NativeAppAccountSummary {
  conta_id: string;
  app_slug: string;
  conta_rotulo: string;
  campos_mascarados: Record<string, string>;
  campos_visiveis: Record<string, string>;
  configurado: boolean;
  testado_ok: boolean;
  ultimo_teste_em: string | null;
  ultimo_erro: string | null;
  perfil_conectado?: {
    username?: string | null;
    account_id?: string | null;
    followers_count?: number | null;
    media_count?: number | null;
  } | null;
  acesso: import("./mcp-contracts.ts").McpAcessoAgentes;
  atualizado_em: string;
}

export interface ReleaseArtifactInfo {
  platform: "win32" | "darwin" | "linux" | "vps-tarball";
  arch: "x64" | "arm64" | "universal";
  filename: string;
  sha256: string;
  size_bytes: number;
  download_path: string;
  external_url?: string;
  install_mode?: "hot_bundle" | "native_installer";
}

export interface UpdateBundlePayloadV2 {
  format: "criativo-update-bundle-v2";
  version: string;
  files: Array<{
    path: string;
    encoding: "utf8" | "base64";
    content: string;
  }>;
}

export interface ReleaseManifest {
  version: string;
  published_at: string;
  channel: UpdateChannel;
  changelog_markdown: string;
  min_compatible_version?: string;
  artifacts: ReleaseArtifactInfo[];
}

export interface UpdateStatusSnapshot {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  state: UpdatePhaseState;
  progress_percent: number;
  changelog_markdown?: string | null;
  requires_active_license: boolean;
  can_apply_in_app: boolean;
  is_desktop_packaged: boolean;
  install_mode?: "hot_bundle" | "native_installer" | null;
  staged_artifact_name?: string | null;
  server_id: string;
  server_kind: ServerConnectionKind;
  last_checked_at: string | null;
  error_message?: string | null;
}

export * from "./whatsapp-contracts.ts";
export * from "./mcp-contracts.ts";
export * from "./marketplace-contracts.ts";
export * from "./routines.ts";
export * from "./workflow-graph.ts";
export * from "./license-crypto.ts";
