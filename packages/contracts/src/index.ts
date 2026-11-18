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
  | "routine_run";

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
  | "um_turno_por_vez";

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
  item_type?: TipoItemMensagemChat;
  status?: "streaming" | "completed" | "failed" | "interrupted";
  resposta_para_mensagem_id?: string | null;
  ordinal?: number;
  branch_origem_mensagem_id?: string | null;
  metadados?: Record<string, unknown>;
  lida: boolean;
  criado_em: string;
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
  id: "whatsapp" | "instagram" | "telegram" | "elevenlabs" | "fish_audio" | "mcp";
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
  criado_em: string;
}

export interface WebSocketEnvelope<K extends keyof WebSocketEventMap = keyof WebSocketEventMap> {
  event: K;
  data: WebSocketEventMap[K];
  timestamp: string;
}

export * from "./whatsapp-contracts.ts";
export * from "./mcp-contracts.ts";
export * from "./marketplace-contracts.ts";
export * from "./routines.ts";
export * from "./workflow-graph.ts";
