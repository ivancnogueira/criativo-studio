/**
 * Contratos compartilhados do Criativo AI Studio Online.
 * Define tipos de provedores de IA, fila FIFO, eventos WebSocket e agentes.
 */

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
  [key: string]: unknown;
}

export interface OnboardingEstado {
  onboarding_concluido: boolean;
  modo_provedor_inicial: "gratuito" | "assinatura" | null;
  provedor_selecionado: ProviderName | null;
  telemetria_anonima: boolean;
  marca_nome: string;
  perfil_handle: string;
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

export type TipoNoWorkflow =
  | "gatilho"
  | "agente"
  | "gerar_imagem"
  | "render_video"
  | "aprovacao"
  | "publicar_meta"
  | "nota";

export interface WorkflowNo {
  id: string;
  tipo: TipoNoWorkflow;
  titulo: string;
  subtitulo?: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

export interface WorkflowAresta {
  id: string;
  origem: string;
  destino: string;
}

export interface WorkflowVisual {
  workflow_id: string;
  nome: string;
  descricao: string;
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
  ativo: boolean;
  ultima_execucao_em: string | null;
  atualizado_em: string;
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
