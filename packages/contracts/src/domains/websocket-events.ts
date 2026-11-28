/**
 * Mapa de eventos WebSocket do CriativoOS.
 */

import type { McpOAuthStatus } from "../mcp-contracts.ts";
import type { BrowserAutofillConsentRequest } from "../phase34-messaging-vault.ts";
import type { WorkflowPresenceMember } from "../phase36-team-transfer-crm-voice.ts";
import type { CuaStatusSnapshot, ThemeReloadEventPayload } from "../phase37-ecosystem.ts";
import type { RoutineOwnerKind, RoutineRunStatus } from "../routines.ts";
import type { WhatsAppMensagemRegistro, WhatsAppPairingRequest } from "../whatsapp-contracts.ts";
import type { WorkflowBranch, WorkflowRunStatus, WorkflowStepStatus } from "../workflow-graph.ts";
import type { CanalOrigem, ProviderName, StatusMensageria } from "./agents-core.ts";
import type {
  BrowserTabSummary,
  BrowserTakeoverSession,
  CaptureScreenConsentRequest,
} from "./browser-media.ts";
import type {
  AgenteEspera,
  AgenteThreadsSnapshot,
  FilaChatSnapshot,
  MensagemChat,
  MensagemFixada,
  PassoChat,
} from "./chat-threads.ts";
import type { ConversationUiBlock, MemoryReviewAlteracao } from "./memory-ui-data.ts";
import type { OnboardingEstado } from "./providers-usage-brand.ts";
import type {
  LicenseActivationStatus,
  ServerClaimTicket,
  StudioServerRecord,
  UpdateStatusSnapshot,
} from "./servers-license-updates.ts";

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
  "vps_assistant:updated": {
    vps_assistant_visible: boolean;
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
  "wakeup:updated": {
    agente_id: string;
    wakeup_id: string;
    status: "agendado" | "executando" | "concluido" | "cancelado" | "falha";
    iteracao_atual: number;
  };
  "background_job:updated": {
    job_id: string;
    agente_id: string;
    thread_id: string;
    kind: "command" | "async_task";
    label: string;
    status: "executando" | "concluido" | "falha" | "cancelado" | "timeout";
    duracao_ms: number;
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
  "browser:tabs_updated": {
    tabs: BrowserTabSummary[];
    activeTabId?: string | null;
    agenteId?: string | null;
  };
  "browser:tab_unloaded": {
    tabId: string;
    perfilId: string;
    agenteId: string | null;
    url: string;
    title: string;
    reason: string;
    unloadedAt: string;
    pressureLevel: "elevated" | "critical" | "manual";
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
  "browser:challenge_detected": {
    tabId: string;
    agenteId: string | null;
    kind: "recaptcha" | "hcaptcha" | "turnstile" | "2fa" | "login_wall" | "anti_bot";
    url: string;
    title: string;
    reason: string;
    detectedAt: string;
  };
  "browser:autofill_requested": BrowserAutofillConsentRequest;
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
  "editorial:updated": {
    acao: "criado" | "atualizado" | "excluido" | "em_producao";
    id: string;
    tarefa_id?: string;
  };
  "meta:first_comment_updated": {
    comment_job_id: string;
    media_id: string;
    status: string;
    editorial_post_id?: string | null;
  };
  "meta:media_audit_updated": {
    audit_id: string;
    media_id: string;
    action: string;
    outcome: string;
  };
  "license:updated": LicenseActivationStatus;
  "servers:updated": {
    servers: StudioServerRecord[];
    active_server_id: string;
  };
  "server:claim_updated": ServerClaimTicket;
  "update:status": UpdateStatusSnapshot;
  "workflow:presence": {
    workflowId: string;
    members: WorkflowPresenceMember[];
  };
  "theme:reloaded": ThemeReloadEventPayload;
  "cua:status": CuaStatusSnapshot;
  "comment_dm:updated": Record<string, unknown>;
};

export interface WebSocketEnvelope<K extends keyof WebSocketEventMap = keyof WebSocketEventMap> {
  event: K;
  data: WebSocketEventMap[K];
  timestamp: string;
}
