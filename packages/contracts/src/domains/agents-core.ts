/**
 * Contratos base de agentes, provedores, tarefas, sidebar, dock e configuracoes do usuario.
 */

export type ProviderName = "gemini" | "claude" | "openai" | "grok" | "opencode" | "ollama";

export type FrenteAgente = "conteudo" | "bonus" | "video" | "custom";

export type NivelEsforco = "baixo" | "medio" | "alto";

export type ModoMensagemOcupado = "steer" | "queue";

export type SkillLearningMode = "off" | "ask" | "automatic";

export type AvatarShape =
  | "hex"
  | "blob"
  | "pill"
  | "triangle"
  | "diamond"
  | "cloud"
  | "rounded_square"
  | "octo";

export type AvatarStyle =
  | "classic"
  | "plush"
  | "cartoon"
  | "robots"
  | "personas"
  | "pets"
  | "monsters"
  | "image";

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

export type PermissionLevel = "workspace" | "ask" | "full";
export type AgentNotificationLevel = "all" | "mentions" | "muted";

export interface BackupModelChoice {
  provedor: ProviderName;
  modelo: string;
  conta_id?: string | null;
}

export interface BackupModelsConfig {
  automatic: boolean;
  order: BackupModelChoice[];
}

export interface UsageLimitAskPayload {
  ask_id: string;
  agente_id: string;
  canal_id: string;
  modelo_atual: string;
  provedor_atual: ProviderName;
  motivo: string;
  opcoes: BackupModelChoice[];
}

export interface AgentAllowedFolder {
  path: string;
  mode: "read" | "read_write";
  added_at?: string;
}

export interface DeletedNativeAgentInfo {
  agente_id: string;
  nome: string;
  papel: string;
  pasta: string;
  avatar_shape: AvatarShape;
  avatar_color: string;
  pacote: "base" | "bonus" | "video";
  deleted_at?: string;
}

export interface AgenteConfigVisual {
  frente?: FrenteAgente;
  skill_slug?: string;
  pasta?: string;
  avatar_shape?: AvatarShape;
  avatar_color?: string;
  avatar_style?: AvatarStyle;
  avatar_variant?: string;
  avatar_image_url?: string | null;
  chat_color?: string | null;
  allowed_folders?: AgentAllowedFolder[];
  auto_memory_enabled?: boolean;
  marked_unread?: boolean;
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

export interface StudioDockSettings {
  mostrar_dock: boolean;
  posicao: "sobre_outros_apps" | "apenas_janela";
  tela: string;
  borda: "right" | "left";
  tamanho_percentual: number;
  ocultar_quando_inativo: boolean;
  mostrar_faixa_borda: boolean;
  mostrar_trabalho_concluido: boolean;
  mostrar_agentes_com_novidades: boolean;
  agentes_ids: string[] | null;
}

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
    cor_balao_usuario?: string;
    baloes_solidos?: boolean;
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
  dock?: StudioDockSettings;
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
