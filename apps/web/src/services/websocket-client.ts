import type {
  AgentAllowedFolder,
  AgenteEspera,
  AgenteMemoria,
  AgenteMemoriasSnapshot,
  AgentNotificationLevel,
  AgenteRegistro,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AgentRoutine,
  AnexoChat,
  ApiKeyMetadata,
  AprendizadoConfig,
  ArquivoStudio,
  AvatarShape,
  AvatarStyle,
  BackupModelChoice,
  BackupModelsConfig,
  BibliotecaPasta,
  BibliotecasPastasSnapshot,
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserSnapshotResult,
  BrowserStatusReport,
  BrowserTakeoverReason,
  BrowserTakeoverSession,
  BrowserTargetSelector,
  CanalEquipe,
  ConectorIntegracaoInfo,
  ContaProvedorInfo,
  ConversationUiBlock,
  DeletedNativeAgentInfo,
  EventFilter,
  FilaChatEntrega,
  FilaChatSnapshot,
  GithubImportPreview,
  HabilidadeInstaladaInfo,
  IdentidadeMarcaStudio,
  LicenseActivationStatus,
  LicenseDeviceRecord,
  LojaCatalogoSnapshot,
  MarketplaceAgentPackage,
  MarketplaceAppItem,
  MarketplaceAuthKind,
  MarketplaceSkillItem,
  MarketplaceSourceFilter,
  MarketplaceTab,
  McpAcessoAgentes,
  McpOAuthAccountView,
  McpOAuthStatus,
  McpProbeResultado,
  McpServidorConfig,
  McpTransporte,
  MemoriaInclusao,
  MemoryReviewAlteracao,
  MensagemChat,
  MensagemFixada,
  NativeAppAccountSummary,
  NivelEsforco,
  OnboardingEstado,
  PacoteUpgradeInfo,
  PaginaConversaThread,
  PerguntaLateralTroca,
  PermissionLevel,
  ProvedorStatusInfo,
  ProviderName,
  ReadVideoResult,
  RelatorioAnalyticsHost,
  RoutineCalendar,
  RoutineDestinationOption,
  RoutineFlowCanvas,
  RoutineFlowLink,
  RoutineOwnerKind,
  RoutineResultDelivery,
  RoutineResultDestination,
  RoutineRun,
  RoutineWebhookConfig,
  SaveAgentRoutineInput,
  ServerClaimTicket,
  ServerInviteToken,
  ServerQuotaSummary,
  SharedTableDetail,
  SharedTableQueryResult,
  SharedTableSummary,
  ShowcaseSiteSummary,
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  SkillSugestaoItem,
  StatusMensageria,
  StorageUsageSnapshot,
  StudioServerRecord,
  StudioUserSettings,
  TarefaRegistro,
  UiBlockSubmitPayload,
  UpdateAgentRoutineInput,
  UpdateStatusSnapshot,
  UserBrowsingStep,
  UsoProvedoresSnapshot,
  WebhookReceipt,
  WebhookTestResult,
  WebSocketEnvelope,
  WebSocketEventMap,
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMensagemRegistro,
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
  WhatsAppPairingRequest,
  WhatsNewReleaseInfo,
  WorkflowAresta,
  WorkflowDetail,
  WorkflowNo,
  WorkflowRunDetail,
  WorkflowStepRecord,
  WorkflowSummary,
  WorkflowTraco,
  WorkflowVersionRecord,
  WorkflowVersionSummary,
  WorkflowVisual,
} from "@criativo/contracts";

export class WorkflowRevisionConflictError extends Error {
  public readonly conflict: WorkflowDetail;
  public readonly statusCode = 409;

  constructor(message: string, conflict: WorkflowDetail) {
    super(message);
    this.name = "WorkflowRevisionConflictError";
    this.conflict = conflict;
  }
}

export class DaemonHttpError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly payload?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    payload?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DaemonHttpError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

let licenseRequiredListener: ((status: LicenseActivationStatus | null) => void) | null = null;
const ACTIVE_SERVER_STORAGE_KEY = "criativo_active_server_id";
let activeServerId = (() => {
  if (typeof window === "undefined") return "primary";
  try {
    return window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY) || "primary";
  } catch {
    return "primary";
  }
})();

export function getActiveServerId(): string {
  return activeServerId;
}

export function setActiveServerId(serverId: string): void {
  activeServerId = serverId || "primary";
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, activeServerId);
    } catch {
      // ignora erro de quota
    }
  }
}

function shouldForwardToActiveServer(rawInput: RequestInfo | URL): boolean {
  if (!activeServerId || activeServerId === "primary") return false;
  const urlStr = typeof rawInput === "string" ? rawInput : rawInput instanceof URL ? rawInput.pathname : rawInput.url;
  if (!urlStr.startsWith("/api/")) return false;
  if (urlStr.startsWith("/api/studio/servers") || urlStr.startsWith("/api/studio/license")) {
    return false;
  }
  return true;
}

/** Resolve URL de mídia/preview do servidor ativo para tags <img>/<video>/<iframe> sem headers customizados. */
export function resolveActiveServerUrl(rawUrl: string): string {
  if (!activeServerId || activeServerId === "primary") return rawUrl;
  if (!rawUrl.startsWith("/api/")) return rawUrl;
  if (rawUrl.includes("serverId=")) return rawUrl;
  const sep = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${sep}serverId=${encodeURIComponent(activeServerId)}`;
}

async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!shouldForwardToActiveServer(input)) {
    return await globalThis.fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  if (!headers.has("X-Criativo-Server-Id")) {
    headers.set("X-Criativo-Server-Id", activeServerId);
  }
  return await globalThis.fetch(input, { ...init, headers });
}

export function setOnLicenseRequiredHandler(
  handler: ((status: LicenseActivationStatus | null) => void) | null
): void {
  licenseRequiredListener = handler;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  if (!res.ok) {
    if (res.status === 402 && licenseRequiredListener) {
      const licStatus =
        parsed.status && typeof parsed.status === "object"
          ? (parsed.status as LicenseActivationStatus)
          : null;
      licenseRequiredListener(licStatus);
    }
    const errMsg =
      typeof parsed.erro === "string"
        ? parsed.erro
        : typeof parsed.message === "string"
          ? parsed.message
          : `Erro HTTP ${res.status} ao consultar ${input}.`;
    const errCode =
      typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error === "string"
          ? parsed.error
          : undefined;
    throw new DaemonHttpError(errMsg, res.status, errCode, parsed);
  }
  return parsed as T;
}

type EventName = keyof WebSocketEventMap;
type EventListener<K extends EventName> = (
  payload: WebSocketEventMap[K],
  envelope: WebSocketEnvelope<K>
) => void;

/**
 * Cliente WebSocket reativo com reconexão exponencial (1s -> 2s -> 4s -> máx 15s)
 * para consumir os eventos do DaemonServer em tempo real.
 */
export class WebSocketClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedManually = false;
  private hasConnectedOnce = false;
  private readonly listeners = new Map<EventName, Set<EventListener<any>>>();
  private readonly connectionListeners = new Set<
    (connected: boolean, reconnected: boolean) => void
  >();

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.url = `${protocol}//${window.location.host}/ws`;
    } else {
      this.url = "ws://127.0.0.1:3000/ws";
    }
  }

  public onConnectionChange(
    listener: (connected: boolean, reconnected: boolean) => void
  ): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  public on<K extends EventName>(event: K, listener: EventListener<K>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket?.delete(listener);
    };
  }

  private buildTargetUrl(): string {
    if (!activeServerId || activeServerId === "primary") {
      return this.url;
    }
    const sep = this.url.includes("?") ? "&" : "?";
    return `${this.url}${sep}serverId=${encodeURIComponent(activeServerId)}`;
  }

  public connect(): void {
    this.closedManually = false;
    if (typeof WebSocket === "undefined") return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(this.buildTargetUrl());
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      const reconnected = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      for (const cb of this.connectionListeners) cb(true, reconnected);
    });

    ws.addEventListener("message", (evt) => {
      try {
        const envelope = JSON.parse(String(evt.data)) as WebSocketEnvelope;
        const bucket = this.listeners.get(envelope.event);
        if (bucket) {
          for (const listener of bucket) {
            listener(envelope.data, envelope);
          }
        }
      } catch {
        // ignora payload inválido
      }
    });

    ws.addEventListener("close", () => {
      if (this.socket === ws) {
        this.socket = null;
      }
      for (const cb of this.connectionListeners) cb(false, false);
      if (!this.closedManually) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  public reconnectForServer(serverId: string): void {
    setActiveServerId(serverId);
    this.disconnect();
    this.reconnectAttempt = 0;
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || typeof window === "undefined") return;
    const delayMs = Math.min(15_000, 1000 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  public disconnect(): void {
    this.closedManually = true;
    if (this.reconnectTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * Cliente HTTP tipado para interagir com os endpoints REST do Daemon.
 */
export const daemonApi = {
  async listTasks(): Promise<TarefaRegistro[]> {
    const res = await fetch("/api/tarefas");
    const json = (await res.json()) as { tarefas: TarefaRegistro[] };
    return json.tarefas ?? [];
  },

  async createTask(input: {
    titulo: string;
    tipo: string;
    prioridade?: number;
    agente_id?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<TarefaRegistro> {
    const res = await fetch("/api/tarefas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async approveTask(tarefaId: string): Promise<TarefaRegistro> {
    const res = await fetch(`/api/tarefas/${encodeURIComponent(tarefaId)}/aprovar`, {
      method: "POST",
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async cancelTask(tarefaId: string): Promise<TarefaRegistro> {
    const res = await fetch(`/api/tarefas/${encodeURIComponent(tarefaId)}/cancelar`, {
      method: "POST",
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async retryTask(tarefaId: string): Promise<TarefaRegistro> {
    const res = await fetch(`/api/tarefas/${encodeURIComponent(tarefaId)}/retentar`, {
      method: "POST",
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async listAgents(options?: {
    onlyUnlocked?: boolean;
    includeSetup?: boolean;
    includeVps?: boolean;
  }): Promise<AgenteRegistro[]> {
    const qs = new URLSearchParams();
    if (options?.onlyUnlocked) qs.set("apenas_desbloqueados", "1");
    if (options?.includeSetup) qs.set("incluir_setup", "1");
    if (options?.includeVps) qs.set("incluir_vps", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const json = await requestJson<{
      agentes: Array<
        AgenteRegistro & {
          skills_paths_json?: string;
          config_json?: string;
        }
      >;
      unlocked_agents_count?: number;
    }>(`/api/agentes${suffix}`);
    return (json.agentes ?? []).map((raw) => {
      const cfg = raw.config_json
        ? (JSON.parse(raw.config_json) as { frente?: AgenteRegistro["frente"] })
        : {};
      return {
        ...raw,
        frente: raw.frente ?? cfg.frente ?? "conteudo",
        skills_paths: raw.skills_paths ?? (raw.skills_paths_json ? JSON.parse(raw.skills_paths_json) : []),
        config: raw.config ?? cfg,
      };
    });
  },

  async updateAgentModel(agenteId: string, modeloPadrao: string): Promise<void> {
    await fetch(`/api/agentes/${encodeURIComponent(agenteId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelo_padrao: modeloPadrao }),
    });
  },

  async getWhatsAppStatus(): Promise<{
    status: StatusMensageria;
    qrcode_base64: string | null;
  }> {
    const res = await fetch("/api/mensageria/whatsapp/status");
    return (await res.json()) as { status: StatusMensageria; qrcode_base64: string | null };
  },

  async connectWhatsApp(): Promise<{
    status: StatusMensageria;
    qrcode_base64: string | null;
  }> {
    const res = await fetch("/api/mensageria/whatsapp/conectar", { method: "POST" });
    return (await res.json()) as { status: StatusMensageria; qrcode_base64: string | null };
  },

  async disconnectWhatsApp(): Promise<void> {
    await fetch("/api/mensageria/whatsapp/desconectar", { method: "POST" });
  },

  async getVaultStatus(): Promise<Array<{ chave_nome: string; atualizado_em: string }>> {
    const res = await fetch("/api/vault/status");
    const json = (await res.json()) as {
      chaves: Array<{ chave_nome: string; atualizado_em: string }>;
    };
    return json.chaves ?? [];
  },

  async saveVaultSecret(chave_nome: string, valor: string): Promise<void> {
    await fetch("/api/vault/salvar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave_nome, valor }),
    });
  },

  // --- Rotas Fase 7 (Paridade Carbon Dark) ---
  async getOnboarding(): Promise<OnboardingEstado> {
    const json = await requestJson<{ onboarding: OnboardingEstado }>("/api/onboarding");
    return json.onboarding;
  },

  async updateOnboarding(patch: Partial<OnboardingEstado>): Promise<OnboardingEstado> {
    const json = await requestJson<{ onboarding: OnboardingEstado }>("/api/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return json.onboarding;
  },

  async setSetupAssistantState(
    action: "dismiss" | "reopen"
  ): Promise<{ ok: boolean; onboarding: OnboardingEstado; setup_assistant_visible: boolean }> {
    return await requestJson("/api/onboarding/setup-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  },

  async setVpsAssistantState(
    action: "dismiss" | "reopen"
  ): Promise<{ ok: boolean; vps_assistant_visible: boolean }> {
    return await requestJson("/api/servers/vps-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  },

  async listProvidersStatus(refresh = false): Promise<ProvedorStatusInfo[]> {
    const res = await fetch(`/api/provedores/status${refresh ? "?refresh=1" : ""}`);
    const json = (await res.json()) as { provedores: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async connectProvider(provedor: ProviderName, apiKey?: string): Promise<ProvedorStatusInfo> {
    const res = await fetch("/api/provedores/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor, api_key: apiKey }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      provedor?: ProvedorStatusInfo;
      erro?: string;
    };
    if (!res.ok || !json.provedor) {
      throw new Error(json.erro || `Falha ao conectar provedor (${res.status}).`);
    }
    return json.provedor;
  },

  async disconnectProvider(provedor: ProviderName): Promise<ProvedorStatusInfo> {
    const res = await fetch("/api/provedores/desconectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor }),
    });
    const json = (await res.json()) as { provedor: ProvedorStatusInfo };
    return json.provedor;
  },

  async getProvidersUsage(refresh = false): Promise<UsoProvedoresSnapshot> {
    const res = await fetch(`/api/provedores/uso${refresh ? "?refresh=1" : ""}`);
    const json = (await res.json()) as { uso: UsoProvedoresSnapshot };
    return json.uso;
  },

  async setProviderPool(
    provedor: ProviderName | string,
    payload: {
      habilitado?: boolean;
      contas_excluidas?: string[];
      conta_em_uso?: string | null;
    }
  ): Promise<ProvedorStatusInfo[]> {
    const res = await fetch(`/api/provedores/${encodeURIComponent(provedor)}/pool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { provedores: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async connectProviderViaBrowser(
    provedor: "gemini" | "claude" | "openai",
    label?: string
  ): Promise<{ ok: boolean; canceled?: boolean; conta?: ContaProvedorInfo; provedores?: ProvedorStatusInfo[]; uso?: UsoProvedoresSnapshot; erro?: string }> {
    const res = await fetch(`/api/provedores/${encodeURIComponent(provedor)}/conectar-navegador`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    return (await res.json()) as {
      ok: boolean;
      canceled?: boolean;
      conta?: ContaProvedorInfo;
      provedores?: ProvedorStatusInfo[];
      uso?: UsoProvedoresSnapshot;
      erro?: string;
    };
  },

  async cancelProviderBrowserSignIn(
    provedor: "gemini" | "claude" | "openai"
  ): Promise<{ ok: boolean; canceled?: boolean }> {
    const res = await fetch(`/api/provedores/${encodeURIComponent(provedor)}/cancelar-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return (await res.json()) as { ok: boolean; canceled?: boolean };
  },

  async setProviderModelsVisibility(
    provedor: ProviderName,
    ocultos: string[]
  ): Promise<ProvedorStatusInfo[]> {
    const res = await fetch(
      `/api/provedores/${encodeURIComponent(provedor)}/modelos-visibilidade`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ocultos }),
      }
    );
    const json = (await res.json()) as { provedores?: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async addProviderAccount(
    provedor: ProviderName | string,
    payload: {
      email: string;
      access_token: string;
      label?: string;
      refresh_token?: string;
    }
  ): Promise<{ conta: ContaProvedorInfo; provedores: ProvedorStatusInfo[] }> {
    const res = await fetch(`/api/provedores/${encodeURIComponent(provedor)}/contas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { conta: ContaProvedorInfo; provedores: ProvedorStatusInfo[] };
  },

  async removeProviderAccount(
    provedor: ProviderName | string,
    contaId: string
  ): Promise<ProvedorStatusInfo[]> {
    const res = await fetch(
      `/api/provedores/${encodeURIComponent(provedor)}/contas/${encodeURIComponent(contaId)}`,
      { method: "DELETE" }
    );
    const json = (await res.json()) as { provedores: ProvedorStatusInfo[] };
    return json.provedores ?? [];
  },

  async getUsageAnalytics(params?: {
    dias?: number;
    agente_id?: string | null;
  }): Promise<RelatorioAnalyticsHost> {
    const qs = new URLSearchParams();
    if (params?.dias !== undefined) qs.set("dias", String(params.dias));
    if (params?.agente_id) qs.set("agente_id", params.agente_id);
    const query = qs.toString();
    const res = await fetch(`/api/uso/analytics${query ? `?${query}` : ""}`);
    const json = (await res.json()) as { analytics: RelatorioAnalyticsHost };
    return json.analytics;
  },

  async listSkills(): Promise<HabilidadeInstaladaInfo[]> {
    const res = await fetch("/api/habilidades");
    const json = (await res.json()) as { habilidades: HabilidadeInstaladaInfo[] };
    return json.habilidades ?? [];
  },

  async listConnectors(): Promise<ConectorIntegracaoInfo[]> {
    const res = await fetch("/api/conectores");
    const json = (await res.json()) as { conectores: ConectorIntegracaoInfo[] };
    return json.conectores ?? [];
  },

  async configureConnector(
    conectorId: string,
    payload: {
      segredos?: Record<string, string>;
      agente_orquestrador_id?: string;
      nome?: string;
      comando?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  ): Promise<{ ok: boolean; conectores: ConectorIntegracaoInfo[] }> {
    const res = await fetch(`/api/conectores/${encodeURIComponent(conectorId)}/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { ok: boolean; conectores: ConectorIntegracaoInfo[] };
  },

  async testConnector(conectorId: string): Promise<{
    ok: boolean;
    mensagem: string;
    detalhes?: unknown;
  }> {
    const res = await fetch(`/api/conectores/${encodeURIComponent(conectorId)}/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return (await res.json()) as { ok: boolean; mensagem: string; detalhes?: unknown };
  },

  async createAgent(input: {
    nome: string;
    prompt_base: string;
    papel: string;
    modelo_padrao: string;
    avatar_shape: AvatarShape;
    avatar_color: string;
    avatar_style?: AvatarStyle;
    avatar_variant?: string;
    avatar_image_url?: string | null;
    effort: NivelEsforco;
  }): Promise<AgenteRegistro> {
    const res = await fetch("/api/agentes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { agente: AgenteRegistro & { config_json?: string } };
    const cfg = json.agente.config_json
      ? (JSON.parse(json.agente.config_json) as Record<string, unknown>)
      : {};
    return { ...json.agente, config: json.agente.config ?? cfg };
  },

  async updateAgentSettings(
    agenteId: string,
    patch: {
      nome?: string;
      papel?: string;
      modelo_padrao?: string;
      effort?: NivelEsforco;
      prompt_base?: string;
      avatar_shape?: AvatarShape;
      avatar_color?: string;
      avatar_style?: AvatarStyle;
      avatar_variant?: string;
      avatar_image_url?: string | null;
      chat_color?: string | null;
      allowed_folders?: AgentAllowedFolder[];
      auto_memory_enabled?: boolean;
      marked_unread?: boolean;
      backup_models?: BackupModelsConfig;
      permission_level?: PermissionLevel;
      allow_new_chat?: boolean;
      allow_quick_ack?: boolean;
      browser_profile_id?: string | null;
      notification_level?: AgentNotificationLevel;
      pinned?: boolean;
      hidden?: boolean;
      section_id?: string | null;
    }
  ): Promise<AgenteRegistro> {
    const json = await requestJson<{ agente: AgenteRegistro & { config_json?: string } }>(
      `/api/agentes/${encodeURIComponent(agenteId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    const cfg = json.agente.config_json
      ? (JSON.parse(json.agente.config_json) as Record<string, unknown>)
      : {};
    return { ...json.agente, config: json.agente.config ?? cfg };
  },

  async uploadAgentAvatar(file: File): Promise<{
    ok: boolean;
    avatar_image_url: string;
    caminho_relativo: string;
    mime_type: string;
    tamanho_bytes: number;
  }> {
    const dataUrl = await new Promise<string>((resolveRead, rejectRead) => {
      const reader = new FileReader();
      reader.onload = () => resolveRead(String(reader.result ?? ""));
      reader.onerror = () => rejectRead(new Error("Falha ao ler imagem local."));
      reader.readAsDataURL(file);
    });
    return await requestJson("/api/agentes/avatar/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: file.name,
        mime_type: file.type || "image/png",
        conteudo_base64: dataUrl,
      }),
    });
  },

  async generateAgentAvatar(input: {
    prompt: string;
    estilo?: string;
    nome_agente?: string;
  }): Promise<{
    ok: boolean;
    avatar_image_url: string;
    caminho_relativo: string;
    engine?: string;
    model?: string;
  }> {
    return await requestJson("/api/agentes/avatar/gerar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async restoreAgentDefaults(agenteId: string): Promise<AgenteRegistro> {
    const json = await requestJson<{ agente: AgenteRegistro & { config_json?: string } }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/restaurar`,
      { method: "POST" },
    );
    const cfg = json.agente.config_json
      ? (JSON.parse(json.agente.config_json) as Record<string, unknown>)
      : {};
    return { ...json.agente, config: json.agente.config ?? cfg };
  },

  async deleteAgent(agenteId: string): Promise<{ ok: boolean; agente_id: string; nativo: boolean }> {
    return await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}`, {
      method: "DELETE",
    });
  },

  async listDeletedNativeAgents(): Promise<DeletedNativeAgentInfo[]> {
    const json = await requestJson<{ excluidos?: DeletedNativeAgentInfo[] }>(
      "/api/agentes/excluidos",
    );
    return json.excluidos ?? [];
  },

  async restoreAllDeletedAgents(): Promise<{ ok: boolean; restored_ids: string[] }> {
    return await requestJson("/api/agentes/restaurar-excluidos", {
      method: "POST",
    });
  },

  async markAgentUnread(agenteId: string): Promise<void> {
    await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens/nao-lida`, {
      method: "POST",
    });
  },

  async clearAgentHistory(agenteId: string): Promise<{ ok: boolean; removidas: number }> {
    return await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`, {
      method: "DELETE",
    });
  },

  async listUpgrades(): Promise<PacoteUpgradeInfo[]> {
    const res = await fetch("/api/upgrades");
    const json = (await res.json()) as { upgrades: PacoteUpgradeInfo[] };
    return json.upgrades ?? [];
  },

  async installUpgrade(pacote: "bonus" | "video"): Promise<PacoteUpgradeInfo[]> {
    const res = await fetch("/api/upgrades/instalar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pacote }),
    });
    const json = (await res.json()) as { upgrades: PacoteUpgradeInfo[] };
    return json.upgrades ?? [];
  },

  async saveBrandIdentity(patch: Partial<IdentidadeMarcaStudio>): Promise<IdentidadeMarcaStudio> {
    const res = await fetch("/api/marca/identidade", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { identidade: IdentidadeMarcaStudio };
    return json.identidade;
  },

  async listAgentMessages(agenteId: string): Promise<MensagemChat[]> {
    const res = await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`);
    const json = (await res.json()) as { mensagens: MensagemChat[] };
    return json.mensagens ?? [];
  },

  async markAgentRead(agenteId: string): Promise<void> {
    await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens/lidas`, {
      method: "POST",
    });
  },

  async sendAgentMessage(
    agenteId: string,
    conteudo: string,
    anexos: AnexoChat[],
    clientMessageId?: string
  ): Promise<{
    enfileirada?: boolean;
    steered?: boolean;
    entrega?: FilaChatEntrega;
    mensagem_usuario: MensagemChat;
    mensagem_agente?: MensagemChat;
    mensagens_handoff?: MensagemChat[];
  }> {
    const res = await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conteudo,
        anexos,
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      }),
    });
    const json = (await res.json()) as {
      erro?: string;
      enfileirada?: boolean;
      steered?: boolean;
      entrega?: FilaChatEntrega;
      mensagem_usuario: MensagemChat;
      mensagem_agente?: MensagemChat;
      mensagens_handoff?: MensagemChat[];
    };
    if (!res.ok) {
      throw new DaemonHttpError(json.erro ?? "Falha ao enviar mensagem ao agente.", res.status);
    }
    return json;
  },

  async listAgentMemories(
    agenteId: string
  ): Promise<Array<{ memoria_id: string; texto: string; criado_em: string }>> {
    const res = await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/memorias`);
    const json = (await res.json()) as {
      memorias: Array<{ memoria_id: string; texto: string; criado_em: string }>;
    };
    return json.memorias ?? [];
  },

  async addAgentMemory(agenteId: string, texto: string): Promise<void> {
    await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/memorias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
  },

  async listChannels(): Promise<CanalEquipe[]> {
    const res = await fetch("/api/canais");
    const json = (await res.json()) as { canais: CanalEquipe[] };
    return json.canais ?? [];
  },

  async createChannel(input: {
    nome: string;
    descricao: string;
    membros_agentes: string[];
  }): Promise<CanalEquipe> {
    const res = await fetch("/api/canais", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { canal: CanalEquipe };
    return json.canal;
  },

  async listChannelMessages(canalId: string): Promise<MensagemChat[]> {
    const res = await fetch(`/api/canais/${encodeURIComponent(canalId)}/mensagens`);
    const json = (await res.json()) as { mensagens: MensagemChat[] };
    return json.mensagens ?? [];
  },

  async sendChannelMessage(
    canalId: string,
    conteudo: string,
    anexos: AnexoChat[]
  ): Promise<{ mensagem_usuario: MensagemChat; mensagens_equipe: MensagemChat[] }> {
    const res = await fetch(`/api/canais/${encodeURIComponent(canalId)}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo, anexos }),
    });
    return (await res.json()) as {
      mensagem_usuario: MensagemChat;
      mensagens_equipe: MensagemChat[];
    };
  },

  async clearChannelHistory(canalId: string): Promise<{ ok: boolean; removidas: number }> {
    return await requestJson(`/api/canais/${encodeURIComponent(canalId)}/mensagens`, {
      method: "DELETE",
    });
  },

  async listWorkflows(): Promise<WorkflowSummary[]> {
    const res = await fetch("/api/workflows");
    const json = (await res.json()) as { workflows: WorkflowSummary[] };
    return json.workflows ?? [];
  },

  async getWorkflowDetail(workflowId: string): Promise<WorkflowDetail> {
    const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`);
    const json = (await res.json()) as WorkflowDetail & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar detalhes do workflow.");
    }
    return json;
  },

  async saveWorkflow(wf: {
    workflow_id?: string;
    nome: string;
    descricao?: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos?: WorkflowTraco[];
    ativo?: boolean;
    base_revision?: number;
  }): Promise<WorkflowVisual> {
    const isUpdate = Boolean(wf.workflow_id);
    const res = await fetch(
      isUpdate ? `/api/workflows/${encodeURIComponent(wf.workflow_id!)}` : "/api/workflows",
      {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wf),
      }
    );
    const json = (await res.json()) as {
      ok?: boolean;
      erro?: string;
      workflow?: WorkflowVisual;
      conflict?: WorkflowDetail;
    };
    if (res.status === 409 && json.conflict) {
      throw new WorkflowRevisionConflictError(
        json.erro ?? "O fluxo foi atualizado em outra sessão ou por um agente.",
        json.conflict
      );
    }
    if (!res.ok || !json.workflow) {
      throw new Error(json.erro ?? "Falha ao salvar fluxo.");
    }
    return json.workflow;
  },

  async deleteWorkflow(workflowId: string): Promise<void> {
    const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao excluir workflow.");
    }
  },

  async listWorkflowVersions(workflowId: string): Promise<WorkflowVersionSummary[]> {
    const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/versoes`);
    const json = (await res.json()) as { versoes?: WorkflowVersionSummary[] };
    return json.versoes ?? [];
  },

  async getWorkflowVersion(workflowId: string, versionId: string): Promise<WorkflowVersionRecord> {
    const res = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/versoes/${encodeURIComponent(versionId)}`
    );
    const json = (await res.json()) as { versao?: WorkflowVersionRecord; erro?: string };
    if (!res.ok || !json.versao) {
      throw new Error(json.erro ?? "Versão de workflow não encontrada.");
    }
    return json.versao;
  },

  async restoreWorkflowVersion(workflowId: string, versionId: string): Promise<WorkflowDetail> {
    const res = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/versoes/${encodeURIComponent(versionId)}/restaurar`,
      { method: "POST" }
    );
    const json = (await res.json()) as { detail?: WorkflowDetail; erro?: string };
    if (!res.ok || !json.detail) {
      throw new Error(json.erro ?? "Falha ao restaurar versão do workflow.");
    }
    return json.detail;
  },

  async executeWorkflow(
    workflowId: string,
    options?: {
      from_node_id?: string;
      trigger_node_id?: string;
      payload?: string;
      request_id?: string;
    }
  ): Promise<{ ok: boolean; execucao: WorkflowRunDetail; tarefas_criadas: string[] }> {
    const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/executar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      execucao?: WorkflowRunDetail;
      tarefas_criadas?: string[];
      erro?: string;
    };
    if (!res.ok || !json.execucao) {
      throw new Error(json.erro ?? "Falha ao executar workflow.");
    }
    return {
      ok: Boolean(json.ok ?? true),
      execucao: json.execucao,
      tarefas_criadas: json.tarefas_criadas ?? [],
    };
  },

  async executeWorkflowStep(
    workflowId: string,
    nodeId: string,
    requestId?: string
  ): Promise<WorkflowStepRecord> {
    const res = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/nos/${encodeURIComponent(nodeId)}/executar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      }
    );
    const json = (await res.json()) as { step?: WorkflowStepRecord; erro?: string };
    if (!res.ok || !json.step) {
      throw new Error(json.erro ?? "Falha ao executar nó individual do workflow.");
    }
    return json.step;
  },

  async listWorkflowRuns(
    workflowId: string,
    options?: { limit?: number; before?: string }
  ): Promise<{ execucoes: WorkflowRunDetail[]; solo_steps: WorkflowStepRecord[] }> {
    const qs = new URLSearchParams();
    if (options?.limit) qs.set("limit", String(options.limit));
    if (options?.before) qs.set("before", options.before);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/execucoes${suffix}`
    );
    const json = (await res.json()) as {
      execucoes?: WorkflowRunDetail[];
      solo_steps?: WorkflowStepRecord[];
    };
    return {
      execucoes: json.execucoes ?? [],
      solo_steps: json.solo_steps ?? [],
    };
  },

  async getWorkflowRunDetail(runId: string): Promise<WorkflowRunDetail> {
    const res = await fetch(`/api/workflows/execucoes/${encodeURIComponent(runId)}`);
    const json = (await res.json()) as { execucao?: WorkflowRunDetail; erro?: string };
    if (!res.ok || !json.execucao) {
      throw new Error(json.erro ?? "Execução de workflow não encontrada.");
    }
    return json.execucao;
  },

  async stopWorkflowRun(runId: string): Promise<WorkflowRunDetail> {
    const res = await fetch(`/api/workflows/execucoes/${encodeURIComponent(runId)}/parar`, {
      method: "POST",
    });
    const json = (await res.json()) as { execucao?: WorkflowRunDetail; erro?: string };
    if (!res.ok || !json.execucao) {
      throw new Error(json.erro ?? "Falha ao parar execução.");
    }
    return json.execucao;
  },

  async decideWorkflowStep(
    stepId: string,
    approved: boolean
  ): Promise<{ ok: boolean; step_id: string; approved: boolean }> {
    const res = await fetch(`/api/workflows/etapas/${encodeURIComponent(stepId)}/decidir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      step_id?: string;
      approved?: boolean;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao decidir etapa de aprovação.");
    }
    return {
      ok: Boolean(json.ok ?? true),
      step_id: json.step_id ?? stepId,
      approved: Boolean(json.approved ?? approved),
    };
  },

  async retryWorkflowStep(stepId: string): Promise<unknown> {
    const res = await fetch(`/api/workflows/etapas/${encodeURIComponent(stepId)}/retentar`, {
      method: "POST",
    });
    const json = (await res.json()) as { resultado?: unknown; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao retentar etapa.");
    }
    return json.resultado;
  },

  async stopWorkflowStep(stepId: string): Promise<void> {
    const res = await fetch(`/api/workflows/etapas/${encodeURIComponent(stepId)}/parar`, {
      method: "POST",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao parar etapa.");
    }
  },

  async rotateWorkflowWebhookSecret(
    workflowId: string,
    nodeId: string
  ): Promise<{ route_id: string; webhook_url: string; secret: string }> {
    const res = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/gatilhos/${encodeURIComponent(nodeId)}/rotacionar-webhook`,
      { method: "POST" }
    );
    const json = (await res.json()) as {
      route_id?: string;
      webhook_url?: string;
      secret?: string;
      erro?: string;
    };
    if (!res.ok || !json.route_id || !json.webhook_url || !json.secret) {
      throw new Error(json.erro ?? "Falha ao rotacionar segredo de webhook.");
    }
    return {
      route_id: json.route_id,
      webhook_url: json.webhook_url,
      secret: json.secret,
    };
  },

  async listFiles(): Promise<ArquivoStudio[]> {
    const res = await fetch("/api/arquivos");
    const json = (await res.json()) as { arquivos: ArquivoStudio[] };
    return json.arquivos ?? [];
  },

  async deleteFile(arquivoId: string): Promise<{ ok: boolean; arquivo_id: string }> {
    return await requestJson<{ ok: boolean; arquivo_id: string }>(
      `/api/arquivos/${encodeURIComponent(arquivoId)}`,
      { method: "DELETE" }
    );
  },

  async uploadFile(file: File, agenteId?: string | null): Promise<AnexoChat> {
    return (await this.uploadFileCategorized(file, undefined, agenteId)).anexo;
  },

  async uploadFileCategorized(
    file: File,
    categoria?: "logo" | "foto" | "referencia" | "personagem" | "ficha_pdf" | "upload",
    agenteId?: string | null
  ): Promise<{
    anexo: AnexoChat;
    arquivo: ArquivoStudio;
    onboarding?: OnboardingEstado;
    brandExtraction?: {
      ok: boolean;
      extracted_chars: number;
      patch: Record<string, unknown>;
    };
  }> {
    const dataUrl = await new Promise<string>((resolveRead, rejectRead) => {
      const reader = new FileReader();
      reader.onload = () => resolveRead(String(reader.result ?? ""));
      reader.onerror = () => rejectRead(new Error("Falha ao ler arquivo local."));
      reader.readAsDataURL(file);
    });
    const suffix = categoria ? `?categoria=${encodeURIComponent(categoria)}` : "";
    const json = await requestJson<{
      arquivo: ArquivoStudio;
      onboarding?: OnboardingEstado;
      brandExtraction?: {
        ok: boolean;
        extracted_chars: number;
        patch: Record<string, unknown>;
      };
    }>(`/api/arquivos/upload${suffix}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: file.name,
        mime_type: file.type || "application/octet-stream",
        conteudo_base64: dataUrl,
        agente_id: agenteId ?? null,
        ...(categoria ? { categoria } : {}),
      }),
    });
    return {
      anexo: {
        arquivo_id: json.arquivo.arquivo_id,
        nome: json.arquivo.nome_original,
        caminho_relativo: json.arquivo.caminho_relativo,
        url: json.arquivo.url,
        mime_type: json.arquivo.mime_type,
        tamanho_bytes: json.arquivo.tamanho_bytes,
        tipo_uso: json.arquivo.tipo_uso,
      },
      arquivo: json.arquivo,
      onboarding: json.onboarding,
      brandExtraction: json.brandExtraction,
    };
  },

  // ------------------------------------------------------------------
  // Fase 10 — WhatsApp Multi-Número
  // ------------------------------------------------------------------
  async listWhatsAppAccounts(): Promise<WhatsAppContaResumo[]> {
    const res = await fetch("/api/mensageria/whatsapp/contas");
    const json = (await res.json()) as { contas?: WhatsAppContaResumo[] };
    return json.contas ?? [];
  },

  async createWhatsAppAccount(input: {
    rotulo: string;
    modo_operacao?: WhatsAppModoOperacao;
    notificar_aprovacoes?: boolean;
    codigo_autorizacao_obrigatorio?: boolean;
    grupo_auto_responder?: boolean;
    agente_orquestrador_id?: string | null;
  }): Promise<WhatsAppContaResumo> {
    const res = await fetch("/api/mensageria/whatsapp/contas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { conta?: WhatsAppContaResumo; erro?: string };
    if (!res.ok || !json.conta) {
      throw new Error(json.erro ?? "Falha ao criar conta WhatsApp.");
    }
    return json.conta;
  },

  async updateWhatsAppAccount(
    contaId: string,
    patch: Partial<{
      rotulo: string;
      modo_operacao: WhatsAppModoOperacao;
      notificar_aprovacoes: boolean;
      codigo_autorizacao_obrigatorio: boolean;
      grupo_auto_responder: boolean;
      agente_orquestrador_id: string | null;
    }>
  ): Promise<WhatsAppContaResumo> {
    const res = await fetch(`/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { conta?: WhatsAppContaResumo; erro?: string };
    if (!res.ok || !json.conta) {
      throw new Error(json.erro ?? "Falha ao atualizar configurações do WhatsApp.");
    }
    return json.conta;
  },

  async deleteWhatsAppAccount(contaId: string): Promise<void> {
    const res = await fetch(`/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover conta WhatsApp.");
    }
  },

  async connectWhatsAppAccount(
    contaId: string,
    input: { mode?: WhatsAppMetodoPareamento; phoneNumber?: string }
  ): Promise<{ status: Record<string, unknown>; conta: WhatsAppContaResumo | null }> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/conectar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const json = (await res.json()) as {
      status?: Record<string, unknown>;
      conta?: WhatsAppContaResumo | null;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao iniciar conexão WhatsApp.");
    }
    return { status: json.status ?? {}, conta: json.conta ?? null };
  },

  async disconnectWhatsAppAccount(
    contaId: string,
    limparSessao = false
  ): Promise<{ status: Record<string, unknown>; conta: WhatsAppContaResumo | null }> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/desconectar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limparSessao }),
      }
    );
    const json = (await res.json()) as {
      status?: Record<string, unknown>;
      conta?: WhatsAppContaResumo | null;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao desconectar conta WhatsApp.");
    }
    return { status: json.status ?? {}, conta: json.conta ?? null };
  },

  async listWhatsAppContacts(contaId: string): Promise<WhatsAppContatoAutorizado[]> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/contatos`
    );
    const json = (await res.json()) as { contatos?: WhatsAppContatoAutorizado[] };
    return json.contatos ?? [];
  },

  async addWhatsAppContact(
    contaId: string,
    input: {
      tipo?: "contato" | "grupo";
      identificador_jid: string;
      nome_exibicao?: string | null;
      permitido?: boolean;
      somente_mencao?: boolean;
    }
  ): Promise<WhatsAppContatoAutorizado> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/contatos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const json = (await res.json()) as { contato?: WhatsAppContatoAutorizado; erro?: string };
    if (!res.ok || !json.contato) {
      throw new Error(json.erro ?? "Falha ao autorizar contato ou grupo.");
    }
    return json.contato;
  },

  async removeWhatsAppContact(contaId: string, autorizacaoId: string): Promise<void> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/contatos/${encodeURIComponent(autorizacaoId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao revogar contato autorizado.");
    }
  },

  async listWhatsAppPairings(contaId: string): Promise<WhatsAppPairingRequest[]> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/pareamentos`
    );
    const json = (await res.json()) as { pareamentos?: WhatsAppPairingRequest[] };
    return json.pareamentos ?? [];
  },

  async resolveWhatsAppPairing(
    contaId: string,
    requestId: string,
    aprovar: boolean
  ): Promise<Record<string, unknown>> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/pareamentos/${encodeURIComponent(requestId)}/resolver`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aprovar }),
      }
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(json.erro ?? "Falha ao resolver pedido de pareamento."));
    }
    return json;
  },

  async getWhatsAppHistory(
    contaId: string,
    chatJid?: string,
    limit = 30
  ): Promise<WhatsAppMensagemRegistro[]> {
    const params = new URLSearchParams();
    if (chatJid) params.set("chatJid", chatJid);
    params.set("limit", String(limit));
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/historico?${params.toString()}`
    );
    const json = (await res.json()) as { mensagens?: WhatsAppMensagemRegistro[] };
    return json.mensagens ?? [];
  },

  async sendWhatsAppMessage(
    contaId: string,
    payload: { chatJid: string; text?: string; mediaPath?: string }
  ): Promise<Record<string, unknown>> {
    const res = await fetch(
      `/api/mensageria/whatsapp/contas/${encodeURIComponent(contaId)}/enviar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(json.erro ?? "Falha ao enviar mensagem pelo WhatsApp."));
    }
    return json;
  },

  // ------------------------------------------------------------------
  // Fase 10 — MCPs & OAuth 2.1 PKCE
  // ------------------------------------------------------------------
  async listMcpServers(agentId?: string): Promise<
    Array<
      McpServidorConfig & {
        oauthStatus: McpOAuthStatus;
        oauthAccounts?: McpOAuthAccountView[];
      }
    >
  > {
    const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    const res = await fetch(`/api/mcps/servidores${qs}`);
    const json = (await res.json()) as {
      servidores?: Array<
        McpServidorConfig & {
          oauthStatus: McpOAuthStatus;
          oauthAccounts?: McpOAuthAccountView[];
        }
      >;
    };
    return json.servidores ?? [];
  },

  async saveMcpServer(payload: {
    mcp_id?: string;
    nome: string;
    transporte: McpTransporte;
    comando?: string;
    args?: string[];
    env?: Record<string, string>;
    envPassthrough?: string[];
    workingDirectory?: string | null;
    url?: string | null;
    headers?: Record<string, string>;
    acesso?: McpAcessoAgentes;
    origemAppSlug?: string | null;
    contaRotulo?: string | null;
    ativo?: boolean;
    testar?: boolean;
  }): Promise<{ servidor: McpServidorConfig; probe?: McpProbeResultado }> {
    const res = await fetch("/api/mcps/servidores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      servidor?: McpServidorConfig;
      probe?: McpProbeResultado;
      erro?: string;
    };
    if (!res.ok || !json.servidor) {
      throw new Error(json.erro ?? "Falha ao registrar servidor MCP.");
    }
    return { servidor: json.servidor, probe: json.probe };
  },

  async updateMcpServer(
    mcpId: string,
    payload: Record<string, unknown>
  ): Promise<McpServidorConfig> {
    const res = await fetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { servidor?: McpServidorConfig; erro?: string };
    if (!res.ok || !json.servidor) {
      throw new Error(json.erro ?? "Falha ao atualizar servidor MCP.");
    }
    return json.servidor;
  },

  async deleteMcpServer(mcpId: string): Promise<void> {
    const res = await fetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover servidor MCP.");
    }
  },

  async testMcpServer(mcpId: string): Promise<McpProbeResultado & { servidor?: McpServidorConfig }> {
    const res = await fetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/testar`, {
      method: "POST",
    });
    const json = (await res.json()) as McpProbeResultado & {
      servidor?: McpServidorConfig;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao testar servidor MCP.");
    }
    return json;
  },

  async testMcpDraft(payload: Record<string, unknown>): Promise<McpProbeResultado> {
    const res = await fetch("/api/mcps/testar-rascunho", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as McpProbeResultado & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao validar rascunho MCP.");
    }
    return json;
  },

  async setMcpServerStatus(
    mcpId: string,
    patch: { ativo?: boolean; acesso?: McpAcessoAgentes }
  ): Promise<McpServidorConfig> {
    const res = await fetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/ativo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { servidor?: McpServidorConfig; erro?: string };
    if (!res.ok || !json.servidor) {
      throw new Error(json.erro ?? "Falha ao atualizar status/acesso do servidor MCP.");
    }
    return json.servidor;
  },

  async startMcpOAuth(
    mcpId: string,
    opts?: { contaChave?: string; scopes?: string[] }
  ): Promise<{ authorizeUrl: string; state: string; redirectUri: string; contaChave: string }> {
    const res = await fetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/oauth/iniciar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
    const json = (await res.json()) as {
      authorizeUrl?: string;
      state?: string;
      redirectUri?: string;
      contaChave?: string;
      erro?: string;
    };
    if (!res.ok || !json.authorizeUrl) {
      throw new Error(json.erro ?? "Falha ao iniciar fluxo OAuth 2.1.");
    }
    return {
      authorizeUrl: json.authorizeUrl,
      state: json.state ?? "",
      redirectUri: json.redirectUri ?? "",
      contaChave: json.contaChave ?? "",
    };
  },

  async disconnectMcpOAuth(mcpId: string, contaChave?: string): Promise<void> {
    const res = await fetch(`/api/mcps/servidores/${encodeURIComponent(mcpId)}/oauth/desconectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contaChave ? { contaChave } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao desconectar conta OAuth.");
    }
  },

  // ------------------------------------------------------------------
  // Fase 10 — Loja Unificada (Apps, Agentes e Habilidades)
  // ------------------------------------------------------------------
  async getLojaCatalogo(params?: {
    q?: string;
    tab?: MarketplaceTab;
    fonte?: MarketplaceSourceFilter;
    category?: string;
  }): Promise<LojaCatalogoSnapshot> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.tab) qs.set("tab", params.tab);
    if (params?.fonte) qs.set("fonte", params.fonte);
    if (params?.category) qs.set("category", params.category);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(`/api/loja/catalogo${suffix}`);
    const json = (await res.json()) as LojaCatalogoSnapshot & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar catálogo da Loja.");
    }
    return json;
  },

  async getLojaAppDetail(slug: string): Promise<{
    app: MarketplaceAppItem;
    accounts: Array<{
      server: McpServidorConfig;
      contaRotulo: string | null;
      oauthStatus: McpOAuthStatus;
      oauthAccounts: McpOAuthAccountView[];
    }>;
    nativeAccounts?: NativeAppAccountSummary[];
    agents: Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;
    nativeStatus?: {
      configuredKeys: string[];
      missingKeys: string[];
      whatsappAccountsCount?: number;
      whatsappConnectedCount?: number;
    };
  }> {
    const json = await requestJson<{
      app?: MarketplaceAppItem;
      accounts?: Array<{
        server: McpServidorConfig;
        contaRotulo: string | null;
        oauthStatus: McpOAuthStatus;
        oauthAccounts: McpOAuthAccountView[];
      }>;
      nativeAccounts?: NativeAppAccountSummary[];
      agents?: Array<{ agente_id: string; nome: string; papel: string; modelo_padrao: string }>;
      nativeStatus?: {
        configuredKeys: string[];
        missingKeys: string[];
        whatsappAccountsCount?: number;
        whatsappConnectedCount?: number;
      };
      erro?: string;
    }>(`/api/loja/apps/${encodeURIComponent(slug)}`);
    if (!json.app) {
      throw new Error(json.erro ?? "Falha ao carregar detalhes do aplicativo.");
    }
    return {
      app: json.app,
      accounts: json.accounts ?? [],
      nativeAccounts: json.nativeAccounts ?? [],
      agents: json.agents ?? [],
      nativeStatus: json.nativeStatus,
    };
  },

  async connectLojaApp(
    slug: string,
    payload: {
      flowId?: string;
      kind?: MarketplaceAuthKind;
      mcpId?: string;
      contaId?: string;
      contaRotulo?: string;
      fields?: Record<string, string>;
      url?: string;
      comando?: string;
      args?: string[];
      workingDirectory?: string | null;
      acesso?: McpAcessoAgentes;
      skipProbe?: boolean;
    }
  ): Promise<{
    ok: boolean;
    kind: MarketplaceAuthKind;
    appSlug: string;
    native?: boolean;
    mcpId?: string;
    authorizeUrl?: string;
    state?: string;
    server?: McpServidorConfig;
    probe?: McpProbeResultado;
    instructions?: string[];
    nativeAccount?: NativeAppAccountSummary;
    validationReport?: { ok: boolean; estagio: number; resumo: string; detalhes?: Record<string, unknown> };
  }> {
    const json = await requestJson<{
      ok?: boolean;
      kind?: MarketplaceAuthKind;
      appSlug?: string;
      native?: boolean;
      mcpId?: string;
      authorizeUrl?: string;
      state?: string;
      server?: McpServidorConfig;
      probe?: McpProbeResultado;
      instructions?: string[];
      nativeAccount?: NativeAppAccountSummary;
      validationReport?: { ok: boolean; estagio: number; resumo: string; detalhes?: Record<string, unknown> };
    }>(`/api/loja/apps/${encodeURIComponent(slug)}/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      ok: Boolean(json.ok),
      kind: json.kind ?? "oauth",
      appSlug: json.appSlug ?? slug,
      native: json.native,
      mcpId: json.mcpId,
      authorizeUrl: json.authorizeUrl,
      state: json.state,
      server: json.server,
      probe: json.probe,
      instructions: json.instructions,
      nativeAccount: json.nativeAccount,
      validationReport: json.validationReport,
    };
  },

  async updateNativeAppAccess(
    slug: string,
    payload: { acesso: McpAcessoAgentes; contaId?: string | null }
  ): Promise<{ ok: boolean; appSlug: string; nativeAccounts: NativeAppAccountSummary[] }> {
    return await requestJson(`/api/loja/apps/${encodeURIComponent(slug)}/acesso`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async testNativeAppConnection(
    slug: string,
    payload?: { contaId?: string }
  ): Promise<{
    ok: boolean;
    appSlug: string;
    contaId: string | null;
    resumo: string;
    account?: NativeAppAccountSummary | null;
    validationReport?: { ok: boolean; estagio: number; resumo: string; detalhes?: Record<string, unknown> };
    nativeAccounts: NativeAppAccountSummary[];
  }> {
    return await requestJson(`/api/loja/apps/${encodeURIComponent(slug)}/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
  },

  async deleteNativeAppAccount(
    slug: string,
    contaId: string
  ): Promise<{ ok: boolean; appSlug: string; contaId: string; nativeAccounts: NativeAppAccountSummary[] }> {
    return await requestJson(
      `/api/loja/apps/${encodeURIComponent(slug)}/contas/${encodeURIComponent(contaId)}`,
      { method: "DELETE" }
    );
  },

  async installLojaAgent(
    slug: string,
    overrides?: {
      name?: string;
      model?: string;
      pasta?: string;
      activateRoutines?: boolean;
      manifest?: Partial<MarketplaceAgentPackage>;
    }
  ): Promise<{
    agente: { agente_id: string; nome: string; papel: string; modelo_padrao: string };
    installedSkills: MarketplaceSkillItem[];
  }> {
    const res = await fetch(`/api/loja/agentes/${encodeURIComponent(slug)}/instalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides ? { overrides, manifest: overrides.manifest } : {}),
    });
    const json = (await res.json()) as {
      agente?: { agente_id: string; nome: string; papel: string; modelo_padrao: string };
      installedSkills?: MarketplaceSkillItem[];
      erro?: string;
    };
    if (!res.ok || !json.agente) {
      throw new Error(json.erro ?? "Falha ao instalar agente da Loja.");
    }
    return {
      agente: json.agente,
      installedSkills: json.installedSkills ?? [],
    };
  },

  async exportLojaAgent(agenteId: string): Promise<MarketplaceAgentPackage & Record<string, unknown>> {
    const res = await fetch(`/api/loja/agentes/${encodeURIComponent(agenteId)}/exportar`);
    const json = (await res.json()) as (MarketplaceAgentPackage & Record<string, unknown>) & {
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao exportar agente.");
    }
    return json;
  },

  async duplicateLojaAgent(
    agenteId: string,
    nome?: string
  ): Promise<{ agente: { agente_id: string; nome: string } }> {
    const res = await fetch(`/api/loja/agentes/${encodeURIComponent(agenteId)}/duplicar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nome ? { nome } : {}),
    });
    const json = (await res.json()) as {
      agente?: { agente_id: string; nome: string };
      erro?: string;
    };
    if (!res.ok || !json.agente) {
      throw new Error(json.erro ?? "Falha ao duplicar agente.");
    }
    return { agente: json.agente };
  },

  async inspectGithubRepo(url: string, tipo: "skills" | "agents"): Promise<GithubImportPreview> {
    const params = new URLSearchParams({ url, tipo });
    const res = await fetch(`/api/loja/github/inspecionar?${params.toString()}`);
    const json = (await res.json()) as GithubImportPreview & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao inspecionar repositório do GitHub.");
    }
    return json;
  },

  async installFromGithub(payload: {
    url: string;
    kind: "skills" | "agents";
    itemPaths?: string[];
    targetAgentIds?: string[];
  }): Promise<{ installedCount: number; installedSkills: unknown[]; installedAgents: unknown[] }> {
    const res = await fetch("/api/loja/github/instalar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      installedCount?: number;
      installedSkills?: unknown[];
      installedAgents?: unknown[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao instalar pacote do GitHub.");
    }
    return {
      installedCount: json.installedCount ?? 0,
      installedSkills: json.installedSkills ?? [],
      installedAgents: json.installedAgents ?? [],
    };
  },

  async listLojaSkills(params?: {
    q?: string;
    fonte?: MarketplaceSourceFilter;
    agentId?: string;
  }): Promise<MarketplaceSkillItem[]> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.fonte) qs.set("fonte", params.fonte);
    if (params?.agentId) qs.set("agentId", params.agentId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(`/api/loja/habilidades${suffix}`);
    const json = (await res.json()) as { habilidades?: MarketplaceSkillItem[] };
    return json.habilidades ?? [];
  },

  async readLojaSkill(skillId: string): Promise<{ skill: MarketplaceSkillItem; markdown: string }> {
    const res = await fetch(`/api/loja/habilidades/${encodeURIComponent(skillId)}`);
    const json = (await res.json()) as {
      skill?: MarketplaceSkillItem;
      markdown?: string;
      erro?: string;
    };
    if (!res.ok || !json.skill) {
      throw new Error(json.erro ?? "Habilidade não encontrada.");
    }
    return { skill: json.skill, markdown: json.markdown ?? "" };
  },

  async createCustomSkill(payload: {
    name: string;
    slug?: string;
    description: string;
    category?: string;
    instructions: string;
    agentIds?: string[];
  }): Promise<MarketplaceSkillItem> {
    const res = await fetch("/api/loja/habilidades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { habilidade?: MarketplaceSkillItem; erro?: string };
    if (!res.ok || !json.habilidade) {
      throw new Error(json.erro ?? "Falha ao criar habilidade personalizada.");
    }
    return json.habilidade;
  },

  async installCatalogSkill(
    slugOrId: string,
    targetAgentIds?: string[]
  ): Promise<MarketplaceSkillItem> {
    const res = await fetch(`/api/loja/habilidades/${encodeURIComponent(slugOrId)}/instalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetAgentIds: targetAgentIds ?? [] }),
    });
    const json = (await res.json()) as { habilidade?: MarketplaceSkillItem; erro?: string };
    if (!res.ok || !json.habilidade) {
      throw new Error(json.erro ?? "Falha ao instalar habilidade.");
    }
    return json.habilidade;
  },

  async setSkillAgentsBatch(
    skillId: string,
    agentIds: string[]
  ): Promise<{ skillId: string; previousAgentIds: string[]; currentAgentIds: string[] }> {
    const res = await fetch(`/api/loja/habilidades/${encodeURIComponent(skillId)}/agentes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds }),
    });
    const json = (await res.json()) as {
      skillId?: string;
      previousAgentIds?: string[];
      currentAgentIds?: string[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao vincular habilidade aos agentes.");
    }
    return {
      skillId: json.skillId ?? skillId,
      previousAgentIds: json.previousAgentIds ?? [],
      currentAgentIds: json.currentAgentIds ?? agentIds,
    };
  },

  async setAgentSkillEnabled(
    agenteId: string,
    skillId: string,
    habilitada: boolean
  ): Promise<{ ok: boolean }> {
    const res = await fetch(
      `/api/loja/agentes/${encodeURIComponent(agenteId)}/habilidades/${encodeURIComponent(skillId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habilitada }),
      }
    );
    const json = (await res.json()) as { ok?: boolean; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao alterar habilidade do agente.");
    }
    return { ok: Boolean(json.ok ?? true) };
  },

  async deleteLojaSkill(skillId: string): Promise<void> {
    const res = await fetch(`/api/loja/habilidades/${encodeURIComponent(skillId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover habilidade.");
    }
  },

  // --- Fase 11: Rotinas, Agenda, Webhooks & Fluxos de Rotinas ---

  async listAllRoutines(): Promise<AgentRoutine[]> {
    const res = await fetch("/api/rotinas?owner_kind=all");
    const json = (await res.json()) as { rotinas?: AgentRoutine[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao listar rotinas.");
    }
    return json.rotinas ?? [];
  },

  async listOwnerRoutines(
    ownerKind: RoutineOwnerKind,
    ownerId: string
  ): Promise<AgentRoutine[]> {
    const base =
      ownerKind === "canal"
        ? `/api/canais/${encodeURIComponent(ownerId)}/rotinas`
        : `/api/agentes/${encodeURIComponent(ownerId)}/rotinas`;
    const res = await fetch(base);
    const json = (await res.json()) as { rotinas?: AgentRoutine[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao listar rotinas do proprietário.");
    }
    return json.rotinas ?? [];
  },

  async saveRoutine(
    input: SaveAgentRoutineInput | ({ rotina_id: string } & UpdateAgentRoutineInput)
  ): Promise<{ rotina: AgentRoutine; secret: string | null }> {
    const hasId = "rotina_id" in input && Boolean(input.rotina_id);
    const endpoint = hasId
      ? `/api/rotinas/gerenciar/${encodeURIComponent(input.rotina_id)}`
      : "/api/rotinas/gerenciar";
    const res = await fetch(endpoint, {
      method: hasId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as {
      rotina?: AgentRoutine;
      secret?: string | null;
      erro?: string;
    };
    if (!res.ok || !json.rotina) {
      throw new Error(json.erro ?? "Falha ao salvar rotina.");
    }
    return { rotina: json.rotina, secret: json.secret ?? null };
  },

  async deleteRoutine(rotinaId: string): Promise<void> {
    const res = await fetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao excluir rotina.");
    }
  },

  async testRoutine(rotinaId: string, instrucao?: string): Promise<RoutineRun> {
    const res = await fetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(instrucao ? { instrucao } : {}),
    });
    const json = (await res.json()) as { execucao?: RoutineRun; erro?: string };
    if (!res.ok || !json.execucao) {
      throw new Error(json.erro ?? "Falha ao disparar teste da rotina.");
    }
    return json.execucao;
  },

  async stopRoutineRun(rotinaId: string, execucaoId: string): Promise<void> {
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/execucoes/${encodeURIComponent(execucaoId)}/parar`,
      { method: "POST" }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao interromper execução.");
    }
  },

  async listRoutineRuns(
    rotinaId: string,
    options?: { limit?: number; withSkipped?: boolean }
  ): Promise<RoutineRun[]> {
    const qs = new URLSearchParams();
    if (options?.limit) qs.set("limit", String(options.limit));
    if (options?.withSkipped) qs.set("with_skipped", "true");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/execucoes${suffix}`
    );
    const json = (await res.json()) as { execucoes?: RoutineRun[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao listar execuções da rotina.");
    }
    return json.execucoes ?? [];
  },

  async listRoutineDestinationOptions(): Promise<RoutineDestinationOption[]> {
    const res = await fetch("/api/rotinas/destinos-opcoes");
    const json = (await res.json()) as { opcoes?: RoutineDestinationOption[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar opções de entrega.");
    }
    return json.opcoes ?? [];
  },

  async updateRoutineDestination(
    rotinaId: string,
    destino: RoutineResultDestination
  ): Promise<AgentRoutine> {
    const res = await fetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/destino`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destino }),
    });
    const json = (await res.json()) as { rotina?: AgentRoutine; erro?: string };
    if (!res.ok || !json.rotina) {
      throw new Error(json.erro ?? "Falha ao atualizar destino da rotina.");
    }
    return json.rotina;
  },

  async listRoutineDeliveries(rotinaId: string): Promise<RoutineResultDelivery[]> {
    const res = await fetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/entregas`);
    const json = (await res.json()) as { entregas?: RoutineResultDelivery[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao listar entregas.");
    }
    return json.entregas ?? [];
  },

  async resendRoutineDelivery(
    rotinaId: string,
    execucaoId: string
  ): Promise<RoutineResultDelivery | null> {
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/entregas/${encodeURIComponent(execucaoId)}/reenviar`,
      { method: "POST" }
    );
    const json = (await res.json()) as { entrega?: RoutineResultDelivery | null; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao reenviar entrega.");
    }
    return json.entrega ?? null;
  },

  async rotateWebhookSecret(
    rotinaId: string
  ): Promise<{ secret: string; webhook: RoutineWebhookConfig; rotina?: AgentRoutine | null }> {
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/webhook/rotacionar-segredo`,
      { method: "POST" }
    );
    const json = (await res.json()) as {
      secret?: string;
      webhook?: RoutineWebhookConfig;
      rotina?: AgentRoutine | null;
      erro?: string;
    };
    if (!res.ok || !json.secret || !json.webhook) {
      throw new Error(json.erro ?? "Falha ao rotacionar segredo do webhook.");
    }
    return { secret: json.secret, webhook: json.webhook, rotina: json.rotina ?? null };
  },

  async setCustomWebhookSecret(
    rotinaId: string,
    secret: string
  ): Promise<{ webhook: RoutineWebhookConfig; rotina?: AgentRoutine | null }> {
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/webhook/segredo`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      }
    );
    const json = (await res.json()) as {
      webhook?: RoutineWebhookConfig;
      rotina?: AgentRoutine | null;
      erro?: string;
    };
    if (!res.ok || !json.webhook) {
      throw new Error(json.erro ?? "Falha ao aplicar segredo externo.");
    }
    return { webhook: json.webhook, rotina: json.rotina ?? null };
  },

  async testWebhookRoutine(
    rotinaId: string,
    payload?: { type?: string; data?: unknown }
  ): Promise<WebhookTestResult> {
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/webhook/testar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }
    );
    const json = (await res.json()) as { resultado?: WebhookTestResult; erro?: string };
    if (!res.ok || !json.resultado) {
      throw new Error(json.erro ?? "Falha ao testar webhook.");
    }
    return json.resultado;
  },

  async listWebhookReceipts(rotinaId: string): Promise<WebhookReceipt[]> {
    const res = await fetch(
      `/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/webhook/recibos`
    );
    const json = (await res.json()) as { recibos?: WebhookReceipt[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar recibos do webhook.");
    }
    return json.recibos ?? [];
  },

  async getAgenda(fromIso: string, toIso: string): Promise<RoutineCalendar> {
    const qs = new URLSearchParams({ from: fromIso, to: toIso });
    const res = await fetch(`/api/agenda?${qs.toString()}`);
    const json = (await res.json()) as RoutineCalendar & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar agenda de rotinas.");
    }
    return {
      rotinas: json.rotinas ?? [],
      execucoes: json.execucoes ?? [],
    };
  },

  async getRoutineFlowCanvas(agenteId: string): Promise<RoutineFlowCanvas> {
    const res = await fetch(`/api/fluxos-rotinas/${encodeURIComponent(agenteId)}`);
    const json = (await res.json()) as { canvas?: RoutineFlowCanvas; erro?: string };
    if (!res.ok || !json.canvas) {
      throw new Error(json.erro ?? "Falha ao carregar canvas de fluxos de rotinas.");
    }
    return json.canvas;
  },

  async saveRoutineFlowPosition(
    agenteId: string,
    nodeKey: string,
    x: number,
    y: number
  ): Promise<void> {
    const res = await fetch(
      `/api/fluxos-rotinas/${encodeURIComponent(agenteId)}/posicoes/${encodeURIComponent(nodeKey)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao salvar posição do nó.");
    }
  },

  async deleteRoutineFlowPosition(agenteId: string, nodeKey: string): Promise<void> {
    const res = await fetch(
      `/api/fluxos-rotinas/${encodeURIComponent(agenteId)}/posicoes/${encodeURIComponent(nodeKey)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover nó do fluxo.");
    }
  },

  async createRoutineFlowLink(input: {
    rotina_id: string;
    owner_id: string;
    from_agent_id: string;
    to_agent_id: string;
    instrucao?: string;
  }): Promise<RoutineFlowLink> {
    const res = await fetch("/api/fluxos-rotinas/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { link?: RoutineFlowLink; erro?: string };
    if (!res.ok || !json.link) {
      throw new Error(json.erro ?? "Falha ao conectar agentes no fluxo.");
    }
    return json.link;
  },

  async updateRoutineFlowLink(linkId: string, instrucao: string): Promise<RoutineFlowLink> {
    const res = await fetch(`/api/fluxos-rotinas/links/${encodeURIComponent(linkId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrucao }),
    });
    const json = (await res.json()) as { link?: RoutineFlowLink; erro?: string };
    if (!res.ok || !json.link) {
      throw new Error(json.erro ?? "Falha ao atualizar instrução da conexão.");
    }
    return json.link;
  },

  async deleteRoutineFlowLink(linkId: string, ownerId: string): Promise<{ deletedLinkIds: string[] }> {
    const res = await fetch(
      `/api/fluxos-rotinas/links/${encodeURIComponent(linkId)}?owner_id=${encodeURIComponent(ownerId)}`,
      { method: "DELETE" }
    );
    const json = (await res.json()) as { deletedLinkIds?: string[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao remover conexão do fluxo.");
    }
    return { deletedLinkIds: json.deletedLinkIds ?? [linkId] };
  },

  async stopRoutineFlowRun(execucaoId: string): Promise<void> {
    const res = await fetch(`/api/fluxos-rotinas/runs/${encodeURIComponent(execucaoId)}/parar`, {
      method: "POST",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao parar execução do fluxo.");
    }
  },

  async listRoutineThreadMessages(agenteId: string, rotinaId: string): Promise<MensagemChat[]> {
    const res = await fetch(
      `/api/agentes/${encodeURIComponent(agenteId)}/rotinas/${encodeURIComponent(rotinaId)}/mensagens`
    );
    const json = (await res.json()) as { mensagens?: MensagemChat[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar conversa da rotina.");
    }
    return json.mensagens ?? [];
  },

  // ------------------------------------------------------------------
  // Fase 13 — Threads Paralelas, Branches, Esperas, Fila, Lateral & Pins
  // ------------------------------------------------------------------
  async listAllThreads(): Promise<AgenteThreadRegistro[]> {
    const data = await requestJson<{ threads?: AgenteThreadRegistro[] }>("/api/threads");
    return data.threads ?? [];
  },

  async listAgentThreads(agenteId: string): Promise<AgenteThreadsSnapshot> {
    return await requestJson<AgenteThreadsSnapshot>(
      `/api/agentes/${encodeURIComponent(agenteId)}/threads`
    );
  },

  async createAgentThread(
    agenteId: string,
    input: {
      titulo?: string;
      conteudo: string;
      anexos?: AnexoChat[];
      prioridade?: number;
      client_message_id?: string;
    }
  ): Promise<{ thread: AgenteThreadRegistro; tarefa: TarefaRegistro }> {
    return await requestJson<{ thread: AgenteThreadRegistro; tarefa: TarefaRegistro }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
  },

  async createEmptyTopic(
    agenteId: string,
    titulo?: string
  ): Promise<{ thread: AgenteThreadRegistro }> {
    return await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vazio: true,
          ...(titulo ? { titulo } : {}),
        }),
      }
    );
  },

  async readThreadMessages(
    threadId: string,
    opts?: { limit?: number; beforeCursor?: string | null; aroundMessageId?: string | null }
  ): Promise<PaginaConversaThread> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.beforeCursor) q.set("beforeCursor", opts.beforeCursor);
    if (opts?.aroundMessageId) q.set("aroundMessageId", opts.aroundMessageId);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const data = await requestJson<{ pagina: PaginaConversaThread }>(
      `/api/threads/${encodeURIComponent(threadId)}/mensagens${suffix}`
    );
    return data.pagina;
  },

  async readAgentMessagesPage(
    agenteId: string,
    opts?: { limit?: number; beforeCursor?: string | null; aroundMessageId?: string | null }
  ): Promise<PaginaConversaThread> {
    const q = new URLSearchParams();
    q.set("limit", String(opts?.limit ?? 50));
    if (opts?.beforeCursor) q.set("beforeCursor", opts.beforeCursor);
    if (opts?.aroundMessageId) q.set("aroundMessageId", opts.aroundMessageId);
    const data = await requestJson<{ pagina: PaginaConversaThread; mensagens: MensagemChat[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/mensagens?${q.toString()}`
    );
    return data.pagina;
  },

  async sendThreadMessage(
    threadId: string,
    conteudo: string,
    anexos: AnexoChat[],
    clientMessageId?: string
  ): Promise<{
    enfileirada?: boolean;
    steered?: boolean;
    entrega?: FilaChatEntrega;
    mensagem_usuario?: MensagemChat;
    mensagem_agente?: MensagemChat;
    thread?: AgenteThreadRegistro;
  }> {
    return await requestJson(
      `/api/threads/${encodeURIComponent(threadId)}/mensagens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conteudo,
          anexos,
          ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
        }),
      }
    );
  },

  async renameThread(threadId: string, titulo: string): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/threads/${encodeURIComponent(threadId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo }),
      }
    );
    return data.thread;
  },

  async archiveThread(threadId: string): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/threads/${encodeURIComponent(threadId)}/arquivar`,
      { method: "POST" }
    );
    return data.thread;
  },

  async reopenThread(threadId: string): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/threads/${encodeURIComponent(threadId)}/reabrir`,
      { method: "POST" }
    );
    return data.thread;
  },

  async stopThread(threadId: string): Promise<{ interrupted: boolean }> {
    return await requestJson<{ interrupted: boolean }>(
      `/api/threads/${encodeURIComponent(threadId)}/parar`,
      { method: "POST" }
    );
  },

  async markThreadRead(threadId: string, lastMessageId?: string): Promise<AgenteThreadRegistro | null> {
    const data = await requestJson<{ thread: AgenteThreadRegistro | null }>(
      `/api/threads/${encodeURIComponent(threadId)}/lida`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastMessageId ? { ultima_mensagem_id: lastMessageId } : {}),
      }
    );
    return data.thread;
  },

  async deleteThread(threadId: string): Promise<void> {
    await requestJson(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    });
  },

  async branchConversation(
    agenteId: string,
    input: { thread_id: string | null; mensagem_id: string; request_id: string }
  ): Promise<AgenteThreadRegistro> {
    const data = await requestJson<{ thread: AgenteThreadRegistro }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/branch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    return data.thread;
  },

  async listWaits(agenteId: string): Promise<AgenteEspera[]> {
    const data = await requestJson<{ esperas?: AgenteEspera[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/esperas`
    );
    return data.esperas ?? [];
  },

  async cancelWait(agenteId: string, esperaId: string): Promise<void> {
    await requestJson(
      `/api/agentes/${encodeURIComponent(agenteId)}/esperas/${encodeURIComponent(esperaId)}`,
      { method: "DELETE" }
    );
  },

  async listChatQueue(agenteId: string, threadId?: string | null): Promise<FilaChatSnapshot> {
    const q = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    return await requestJson<FilaChatSnapshot>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat${q}`
    );
  },

  async editChatQueue(
    agenteId: string,
    payload: {
      thread_id?: string | null;
      entrega_id: string;
      acao: "begin" | "retain-attachments" | "save" | "cancel";
      edit_id: string;
      conteudo?: string;
      anexos?: AnexoChat[];
    }
  ): Promise<FilaChatSnapshot> {
    const data = await requestJson<{ snapshot: FilaChatSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/editar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.snapshot;
  },

  async cancelChatQueue(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_id: string; delete_after?: boolean }
  ): Promise<FilaChatSnapshot> {
    const data = await requestJson<{ snapshot: FilaChatSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/cancelar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: payload.thread_id ?? null,
          entrega_id: payload.entrega_id,
          excluir: payload.delete_after === true,
        }),
      }
    );
    return data.snapshot;
  },

  async reorderChatQueue(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_ids: string[] }
  ): Promise<FilaChatSnapshot> {
    const data = await requestJson<{ snapshot: FilaChatSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/reordenar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.snapshot;
  },

  async steerChatQueue(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_id: string }
  ): Promise<{ mode: "steered" | "fallback_send_now"; snapshot: FilaChatSnapshot }> {
    return await requestJson(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/steer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async runQueuedAsTask(
    agenteId: string,
    payload: { thread_id?: string | null; entrega_id: string }
  ): Promise<{ thread: AgenteThreadRegistro; snapshot: FilaChatSnapshot }> {
    return await requestJson(
      `/api/agentes/${encodeURIComponent(agenteId)}/fila-chat/mover-para-tarefa`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async interruptTurn(agenteId: string, threadId?: string | null): Promise<{ interrupted: boolean }> {
    return await requestJson<{ interrupted: boolean }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/interromper`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId ?? null }),
      }
    );
  },

  async askSideQuestion(
    agenteId: string,
    payload: {
      pergunta: string;
      historico_lateral: Array<{ pergunta: string; resposta: string }>;
      thread_id?: string | null;
    }
  ): Promise<{ resposta: string }> {
    return await requestJson<{ resposta: string }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/pergunta-lateral`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async startNewChat(
    agenteId: string
  ): Promise<{ cutoff_at: string; mensagem_divisor: MensagemChat }> {
    return await requestJson<{ cutoff_at: string; mensagem_divisor: MensagemChat }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/novo-chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forcar: true }),
      }
    );
  },

  async listPins(agenteId: string): Promise<MensagemFixada[]> {
    const data = await requestJson<{ pins?: MensagemFixada[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/pins`
    );
    return data.pins ?? [];
  },

  async setMessagePinned(
    agenteId: string,
    payload: { thread_id: string; mensagem_id: string; pinned: boolean }
  ): Promise<MensagemFixada[]> {
    if (payload.pinned) {
      await requestJson(
        `/api/agentes/${encodeURIComponent(agenteId)}/pins`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: payload.thread_id,
            mensagem_id: payload.mensagem_id,
          }),
        }
      );
    } else {
      await requestJson(
        `/api/agentes/${encodeURIComponent(agenteId)}/pins/${encodeURIComponent(payload.thread_id)}/${encodeURIComponent(payload.mensagem_id)}`,
        { method: "DELETE" }
      );
    }
    return await this.listPins(agenteId);
  },

  // ------------------------------------------------------------------
  // Fase 14 — Shared Tables, Biblioteca Hierárquica, UI Blocks,
  // Generative UI, Cofre de API Keys & Aprendizado Autônomo
  // ------------------------------------------------------------------

  async listSharedTables(): Promise<SharedTableSummary[]> {
    const data = await requestJson<{ tables?: SharedTableSummary[] }>(
      "/api/tabelas-compartilhadas"
    );
    return data.tables ?? [];
  },

  async inspectSharedTable(
    nome: string,
    params?: { limit?: number; offset?: number; busca?: string }
  ): Promise<SharedTableDetail> {
    const qs = new URLSearchParams();
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.offset !== undefined) qs.set("offset", String(params.offset));
    if (params?.busca) qs.set("busca", params.busca);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await requestJson<SharedTableDetail>(
      `/api/tabelas-compartilhadas/${encodeURIComponent(nome)}${suffix}`
    );
  },

  async querySharedTable(
    sql: string,
    params?: Array<string | number | boolean | null>
  ): Promise<SharedTableQueryResult> {
    return await requestJson<SharedTableQueryResult>(
      "/api/tabelas-compartilhadas/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, ...(params ? { params } : {}) }),
      }
    );
  },

  getSharedTableExportUrl(nome: string, formato: "csv" | "json"): string {
    return `/api/tabelas-compartilhadas/${encodeURIComponent(nome)}/export?formato=${formato}`;
  },

  async deleteSharedTable(nome: string): Promise<{ deleted: string }> {
    return await requestJson<{ deleted: string }>(
      `/api/tabelas-compartilhadas/${encodeURIComponent(nome)}`,
      { method: "DELETE" }
    );
  },

  async listLibraryFolders(): Promise<BibliotecasPastasSnapshot> {
    return await requestJson<BibliotecasPastasSnapshot>("/api/bibliotecas/pastas");
  },

  async createLibraryFolder(input: {
    agente_id: string;
    nome: string;
    parent_id?: string | null;
  }): Promise<{ pasta: BibliotecaPasta; snapshot: BibliotecasPastasSnapshot }> {
    return await requestJson<{ pasta: BibliotecaPasta; snapshot: BibliotecasPastasSnapshot }>(
      "/api/bibliotecas/pastas",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
  },

  async updateLibraryFolder(
    pastaId: string,
    patch: { nome?: string; parent_id?: string | null }
  ): Promise<{ pasta: BibliotecaPasta; snapshot: BibliotecasPastasSnapshot }> {
    return await requestJson<{ pasta: BibliotecaPasta; snapshot: BibliotecasPastasSnapshot }>(
      `/api/bibliotecas/pastas/${encodeURIComponent(pastaId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
  },

  async deleteLibraryFolder(
    pastaId: string
  ): Promise<{ deletedIds: string[]; snapshot: BibliotecasPastasSnapshot }> {
    return await requestJson<{ deletedIds: string[]; snapshot: BibliotecasPastasSnapshot }>(
      `/api/bibliotecas/pastas/${encodeURIComponent(pastaId)}`,
      { method: "DELETE" }
    );
  },

  async moveFilesToLibraryFolder(
    arquivoIds: string[],
    pastaId: string | null
  ): Promise<{ moved: number; snapshot: BibliotecasPastasSnapshot }> {
    return await requestJson<{ moved: number; snapshot: BibliotecasPastasSnapshot }>(
      "/api/bibliotecas/pastas/mover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arquivo_ids: arquivoIds, pasta_id: pastaId }),
      }
    );
  },

  async submitChatUiResponse(
    payload: UiBlockSubmitPayload
  ): Promise<{ ok: boolean; bloco: ConversationUiBlock }> {
    return await requestJson<{ ok: boolean; bloco: ConversationUiBlock }>(
      "/api/chat/ui-response",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async saveSkillSuggestion(mensagemId: string): Promise<{
    ok: boolean;
    sugestao?: SkillSugestaoItem;
    fallbackToReply?: boolean;
    erro?: string;
  }> {
    return await requestJson(
      `/api/chat/skill-sugestao/${encodeURIComponent(mensagemId)}/salvar`,
      { method: "POST" }
    );
  },

  async dismissSkillSuggestion(mensagemId: string): Promise<{
    ok: boolean;
    sugestao: SkillSugestaoItem;
  }> {
    return await requestJson(
      `/api/chat/skill-sugestao/${encodeURIComponent(mensagemId)}/dispensar`,
      { method: "POST" }
    );
  },

  async getVisualPage(
    agenteId: string,
    arquivoId: string
  ): Promise<{ arquivo_id: string; titulo: string; html: string }> {
    return await requestJson<{ arquivo_id: string; titulo: string; html: string }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/visual-pages/${encodeURIComponent(arquivoId)}`
    );
  },

  async listVaultApiKeys(agenteId?: string | null): Promise<ApiKeyMetadata[]> {
    const suffix = agenteId ? `?agente_id=${encodeURIComponent(agenteId)}` : "";
    const data = await requestJson<{ keys?: ApiKeyMetadata[] }>(
      `/api/cofre/api-keys${suffix}`
    );
    return data.keys ?? [];
  },

  async saveVaultApiKey(input: {
    name: string;
    value: string;
    scope: "todos_agentes" | "agente_especifico";
    agente_id?: string | null;
  }): Promise<{ status: "saved"; name: string; scope: "todos_agentes" | "agente_especifico" }> {
    return await requestJson(
      "/api/cofre/api-keys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
  },

  async removeVaultApiKey(
    nome: string,
    scope: "todos_agentes" | "agente_especifico",
    agenteId?: string | null
  ): Promise<{ removed: boolean }> {
    const qs = new URLSearchParams({ scope });
    if (agenteId) qs.set("agente_id", agenteId);
    return await requestJson<{ removed: boolean }>(
      `/api/cofre/api-keys/${encodeURIComponent(nome)}?${qs.toString()}`,
      { method: "DELETE" }
    );
  },

  async listAgentMemoriesSnapshot(
    agenteId: string,
    filters?: {
      categoria?: MemoriaInclusao;
      site?: string;
      busca?: string;
      after?: string;
    }
  ): Promise<AgenteMemoriasSnapshot> {
    const qs = new URLSearchParams();
    if (filters?.categoria) qs.set("categoria", filters.categoria);
    if (filters?.site) qs.set("site", filters.site);
    if (filters?.busca) qs.set("busca", filters.busca);
    if (filters?.after) qs.set("after", filters.after);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await requestJson<AgenteMemoriasSnapshot>(
      `/api/agentes/${encodeURIComponent(agenteId)}/memorias${suffix}`
    );
  },

  async updateAgentMemory(
    agenteId: string,
    memoriaId: string,
    patch: {
      texto?: string;
      categoria?: MemoriaInclusao;
      escopo_site?: string | null;
    }
  ): Promise<{ memoria: AgenteMemoria; snapshot: AgenteMemoriasSnapshot }> {
    return await requestJson<{ memoria: AgenteMemoria; snapshot: AgenteMemoriasSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/memorias/${encodeURIComponent(memoriaId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
  },

  async deleteAgentMemory(
    agenteId: string,
    memoriaId: string
  ): Promise<{ ok: boolean; snapshot: AgenteMemoriasSnapshot }> {
    return await requestJson<{ ok: boolean; snapshot: AgenteMemoriasSnapshot }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/memorias/${encodeURIComponent(memoriaId)}`,
      { method: "DELETE" }
    );
  },

  async triggerMemoryReview(
    agenteId: string,
    threadId?: string | null
  ): Promise<{ ok: boolean; alteracoes: MemoryReviewAlteracao[] }> {
    return await requestJson<{ ok: boolean; alteracoes: MemoryReviewAlteracao[] }>(
      `/api/agentes/${encodeURIComponent(agenteId)}/memorias/revisar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(threadId ? { thread_id: threadId } : {}),
      }
    );
  },

  async getLearningConfig(): Promise<AprendizadoConfig> {
    const data = await requestJson<{ configuracao: AprendizadoConfig }>(
      "/api/configuracoes/aprendizado"
    );
    return data.configuracao;
  },

  async updateLearningConfig(patch: Partial<AprendizadoConfig>): Promise<AprendizadoConfig> {
    const data = await requestJson<{ configuracao: AprendizadoConfig }>(
      "/api/configuracoes/aprendizado",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return data.configuracao;
  },

  // ------------------------------------------------------------------
  // Fase 15 — Navegador CDP, Mídia, Backup Models, Sidebar,
  // Configurações, Armazenamento, Conectores Opcionais & Showcase
  // ------------------------------------------------------------------

  async getBrowserStatus(): Promise<BrowserStatusReport> {
    return await requestJson<BrowserStatusReport>("/api/navegador/status");
  },

  async listBrowserProfiles(): Promise<BrowserProfileInfo[]> {
    const data = await requestJson<{ perfis?: BrowserProfileInfo[] }>("/api/navegador/perfis");
    return data.perfis ?? [];
  },

  async createBrowserProfile(input: {
    nome: string;
    cor_hex?: string;
    proxy_json?: BrowserProfileProxyPayload;
  }): Promise<BrowserProfileInfo> {
    const data = await requestJson<{ perfil: BrowserProfileInfo }>("/api/navegador/perfis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return data.perfil;
  },

  async updateBrowserProfile(
    perfilId: string,
    patch: {
      nome?: string;
      cor_hex?: string;
      cdp_porta?: number | null;
      proxy_json?: BrowserProfileProxyPayload | null;
    }
  ): Promise<{ perfil: BrowserProfileInfo; closedTabs: number }> {
    return await requestJson<{ perfil: BrowserProfileInfo; closedTabs: number }>(
      `/api/navegador/perfis/${encodeURIComponent(perfilId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
  },

  async openBrowserProfileWindow(
    perfilId: string,
    url?: string
  ): Promise<{ ok: boolean; tab: unknown; cdpPort?: number | null }> {
    return await requestJson<{ ok: boolean; tab: unknown; cdpPort?: number | null }>(
      `/api/navegador/perfis/${encodeURIComponent(perfilId)}/abrir`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(url ? { url } : {}),
      }
    );
  },

  async clearBrowserProfile(perfilId: string): Promise<{ ok: boolean; closedTabs: number }> {
    return await requestJson<{ ok: boolean; closedTabs: number }>(
      `/api/navegador/perfis/${encodeURIComponent(perfilId)}/limpar`,
      { method: "POST" }
    );
  },

  async deleteBrowserProfile(perfilId: string): Promise<{ ok: boolean; reassignedAgents: number }> {
    return await requestJson<{ ok: boolean; reassignedAgents: number }>(
      `/api/navegador/perfis/${encodeURIComponent(perfilId)}`,
      { method: "DELETE" }
    );
  },

  async listBrowserProxies(): Promise<BrowserProxyConfig[]> {
    const data = await requestJson<{ proxies?: BrowserProxyConfig[] }>("/api/navegador/proxies");
    return data.proxies ?? [];
  },

  async saveBrowserProxy(input: {
    proxy_id?: string;
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
    ativo?: boolean;
  }): Promise<BrowserProxyConfig> {
    const data = await requestJson<{ proxy: BrowserProxyConfig }>("/api/navegador/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return data.proxy;
  },

  async deleteBrowserProxy(proxyId: string): Promise<{ ok: boolean }> {
    return await requestJson<{ ok: boolean }>(
      `/api/navegador/proxies/${encodeURIComponent(proxyId)}`,
      { method: "DELETE" }
    );
  },

  async runBrowserSessionAction(input: Record<string, unknown>): Promise<unknown> {
    return await requestJson("/api/navegador/sessoes/acao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async startBrowserTakeover(
    tabId: string,
    payload?: { agenteId?: string | null; canalId?: string | null; reason?: BrowserTakeoverReason }
  ): Promise<{ ok: boolean; session: BrowserTakeoverSession }> {
    return await requestJson<{ ok: boolean; session: BrowserTakeoverSession }>(
      `/api/navegador/sessoes/${encodeURIComponent(tabId)}/takeover/iniciar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }
    );
  },

  async respondBrowserTakeover(
    tabId: string,
    decision: "complete" | "cancel"
  ): Promise<{ ok: boolean; decision: "complete" | "cancel"; snapshot: BrowserSnapshotResult }> {
    return await requestJson(
      `/api/navegador/sessoes/${encodeURIComponent(tabId)}/takeover/responder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      }
    );
  },

  async sendBrowserInput(
    tabId: string,
    input: {
      type:
        | "mousePressed"
        | "mouseReleased"
        | "mouseMoved"
        | "wheel"
        | "keyDown"
        | "keyUp"
        | "insertText";
      x?: number;
      y?: number;
      button?: "left" | "right" | "middle";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      key?: string;
      code?: string;
      text?: string;
      modifiers?: number;
      autoAssume?: boolean;
    }
  ): Promise<{ ok: boolean }> {
    return await requestJson<{ ok: boolean }>(
      `/api/navegador/sessoes/${encodeURIComponent(tabId)}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
  },

  async submitBrowserSecret(
    tabId: string,
    payload: {
      method: "password" | "otp" | "authenticator";
      targets: BrowserTargetSelector[];
      loginId?: string | null;
      username?: string | null;
      secret?: string | null;
      saveToVault?: boolean;
      loginLabel?: string | null;
      submission?: "enter" | "click" | "none";
      submitTarget?: BrowserTargetSelector | null;
    }
  ): Promise<{ ok: boolean; tabId: string; filledFields: number; savedLoginId: string | null }> {
    return await requestJson(
      `/api/navegador/sessoes/${encodeURIComponent(tabId)}/segredo`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async startTeachRecording(
    tabId: string,
    agenteId?: string | null
  ): Promise<{ ok: boolean; tabId: string; agenteId: string; startedAt: number }> {
    return await requestJson(
      `/api/navegador/sessoes/${encodeURIComponent(tabId)}/teach/iniciar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agenteId ? { agenteId } : {}),
      }
    );
  },

  async stopTeachRecording(
    tabId: string,
    action: "save" | "discard"
  ): Promise<{
    ok: boolean;
    action: "save" | "discard";
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  }> {
    return await requestJson(
      `/api/navegador/sessoes/${encodeURIComponent(tabId)}/teach/parar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }
    );
  },

  async listUserBrowsingLog(agenteId: string): Promise<{
    agenteId: string;
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  }> {
    return await requestJson(
      `/api/navegador/browsing-log/${encodeURIComponent(agenteId)}`
    );
  },

  async clearUserBrowsingLog(agenteId: string): Promise<{ ok: boolean; removed: number }> {
    return await requestJson(
      `/api/navegador/browsing-log/${encodeURIComponent(agenteId)}`,
      { method: "DELETE" }
    );
  },

  async readVideoPreview(url: string, frames = 6): Promise<{ ok: boolean; video: ReadVideoResult }> {
    return await requestJson("/api/navegador/read-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, frames }),
    });
  },

  async respondScreenCapture(
    captureId: string,
    payload: {
      decision: "granted" | "declined";
      dataUrl?: string;
      width?: number;
      height?: number;
      reason?: string;
    }
  ): Promise<{ ok: boolean; captureId: string; decision: string }> {
    return await requestJson(
      `/api/navegador/captura-tela/${encodeURIComponent(captureId)}/responder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async duplicateAgent(
    agenteId: string
  ): Promise<{ agente: AgenteRegistro; layout: SidebarLayoutSnapshot }> {
    return await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}/duplicar`, {
      method: "POST",
    });
  },

  async respondUsageLimit(
    agenteId: string,
    payload: {
      askId?: string;
      choice: BackupModelChoice;
      remember?: boolean;
    }
  ): Promise<{
    ok: boolean;
    choice: BackupModelChoice;
    backupConfig?: BackupModelsConfig;
    mensagem?: MensagemChat;
  }> {
    return await requestJson(`/api/agentes/${encodeURIComponent(agenteId)}/uso-limite/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async getSidebarLayout(): Promise<SidebarLayoutSnapshot> {
    return await requestJson<SidebarLayoutSnapshot>("/api/sidebar/layout");
  },

  async mutateSidebarLayout(mutation: SidebarLayoutMutation): Promise<SidebarLayoutSnapshot> {
    return await requestJson<SidebarLayoutSnapshot>("/api/sidebar/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
    });
  },

  async updateSidebarPins(pins: string[]): Promise<SidebarLayoutSnapshot> {
    return await requestJson<SidebarLayoutSnapshot>("/api/sidebar/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pins }),
    });
  },

  async getUserSettings(): Promise<StudioUserSettings> {
    const data = await requestJson<{ settings: StudioUserSettings }>("/api/configuracoes");
    return data.settings;
  },

  async updateUserSettings(patch: Partial<StudioUserSettings>): Promise<StudioUserSettings> {
    const data = await requestJson<{ ok: boolean; settings: StudioUserSettings }>(
      "/api/configuracoes",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return data.settings;
  },

  async getWhatsNew(): Promise<WhatsNewReleaseInfo> {
    return await requestJson<WhatsNewReleaseInfo>("/api/configuracoes/atualizacoes");
  },

  async getStorageUsage(): Promise<StorageUsageSnapshot> {
    return await requestJson<StorageUsageSnapshot>("/api/armazenamento");
  },

  async clearStorageCategory(
    category: "browser_cache" | "temp_previews"
  ): Promise<{
    ok: boolean;
    category: string;
    freedBytes: number;
    removedCount: number;
    snapshot: StorageUsageSnapshot;
  }> {
    return await requestJson("/api/armazenamento/limpar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
  },

  async deleteStorageFile(
    arquivoId: string
  ): Promise<{ ok: boolean; arquivoId: string; freedBytes: number; snapshot: StorageUsageSnapshot }> {
    return await requestJson(
      `/api/armazenamento/arquivos/${encodeURIComponent(arquivoId)}`,
      { method: "DELETE" }
    );
  },

  async configureOptionalConnector(
    conector: "slack" | "discord" | "github",
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return await requestJson(`/api/conectores/${conector}/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async testOptionalConnector(
    conector: "slack" | "discord" | "github"
  ): Promise<Record<string, unknown>> {
    return await requestJson(`/api/conectores/${conector}/testar`, {
      method: "POST",
    });
  },

  async listShowcaseSites(): Promise<ShowcaseSiteSummary[]> {
    const data = await requestJson<{ sites?: ShowcaseSiteSummary[] }>("/api/showcase/sites");
    return data.sites ?? [];
  },

  async publishShowcaseSite(payload: {
    slug: string;
    titulo: string;
    descricao?: string;
    sourceDir: string;
    spaFallback?: boolean;
    agenteId?: string | null;
    aprovadoPorHumano: boolean;
  }): Promise<{ ok: boolean; requiresApproval?: boolean; site?: ShowcaseSiteSummary; erro?: string }> {
    return await requestJson("/api/showcase/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async replaceShowcaseSite(
    siteId: string,
    payload: {
      sourceDir: string;
      titulo?: string;
      descricao?: string;
      spaFallback?: boolean;
      aprovadoPorHumano: boolean;
    }
  ): Promise<{ ok: boolean; requiresApproval?: boolean; site?: ShowcaseSiteSummary; erro?: string }> {
    return await requestJson(`/api/showcase/sites/${encodeURIComponent(siteId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async deleteShowcaseSite(
    siteId: string,
    aprovadoPorHumano = true
  ): Promise<{ ok: boolean; erro?: string }> {
    return await requestJson(`/api/showcase/sites/${encodeURIComponent(siteId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aprovadoPorHumano }),
    });
  },

  // Fase 16 — Licenciamento Comercial
  async obterStatusLicenca(): Promise<LicenseActivationStatus> {
    const data = await requestJson<{ license: LicenseActivationStatus }>("/api/studio/license/status");
    return data.license;
  },

  async ativarLicenca(payload: {
    license_key: string;
    email: string;
  }): Promise<LicenseActivationStatus> {
    const data = await requestJson<{ ok: boolean; license: LicenseActivationStatus }>(
      "/api/studio/license/activate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.license;
  },

  async sincronizarLicenca(): Promise<LicenseActivationStatus> {
    const data = await requestJson<{ ok: boolean; license: LicenseActivationStatus }>(
      "/api/studio/license/heartbeat",
      { method: "POST" }
    );
    return data.license;
  },

  async desvincularDispositivoLicenca(payload: {
    target_machine_id: string;
    license_key?: string;
    email?: string;
  }): Promise<{ ok: boolean; devices: LicenseDeviceRecord[]; status?: LicenseActivationStatus }> {
    return await requestJson("/api/studio/license/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  // Fase 17 — Multi-Servidores Local & Pareamento VPS
  async listarServidores(): Promise<{
    servers: StudioServerRecord[];
    active_server_id: string;
    quota: ServerQuotaSummary | null;
  }> {
    return await requestJson("/api/studio/servers");
  },

  async criarServidorLocal(payload: {
    nome: string;
    cor_hex?: string;
  }): Promise<{
    ok: boolean;
    server: StudioServerRecord;
    servers: StudioServerRecord[];
    quota: ServerQuotaSummary;
  }> {
    return await requestJson("/api/studio/servers/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async criarClaimVps(payload: { server_name?: string }): Promise<ServerClaimTicket> {
    const data = await requestJson<{ ok: boolean; claim: ServerClaimTicket }>(
      "/api/studio/servers/claims",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return data.claim;
  },

  async consultarClaimVps(claimId: string): Promise<ServerClaimTicket> {
    const data = await requestJson<{ ok: boolean; claim: ServerClaimTicket }>(
      `/api/studio/servers/claims/${encodeURIComponent(claimId)}`
    );
    return data.claim;
  },

  async entrarEmServidor(payload: {
    invite_url?: string;
    nome?: string;
    base_url?: string;
    access_token?: string;
  }): Promise<{
    ok: boolean;
    server: StudioServerRecord;
    servers: StudioServerRecord[];
    quota: ServerQuotaSummary;
  }> {
    return await requestJson("/api/studio/servers/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async selecionarServidor(serverId: string): Promise<{
    ok: boolean;
    server: StudioServerRecord;
    active_server_id: string;
    servers: StudioServerRecord[];
  }> {
    const data = await requestJson<{
      ok: boolean;
      server: StudioServerRecord;
      active_server_id: string;
      servers: StudioServerRecord[];
    }>(`/api/studio/servers/${encodeURIComponent(serverId)}/select`, {
      method: "POST",
    });
    setActiveServerId(data.active_server_id);
    return data;
  },

  async atualizarServidor(
    serverId: string,
    patch: { nome?: string; cor_hex?: string }
  ): Promise<{ ok: boolean; server: StudioServerRecord; servers: StudioServerRecord[] }> {
    return await requestJson(`/api/studio/servers/${encodeURIComponent(serverId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  async reiniciarServidor(serverId: string): Promise<{ ok: boolean; server: StudioServerRecord }> {
    return await requestJson(`/api/studio/servers/${encodeURIComponent(serverId)}/restart`, {
      method: "POST",
    });
  },

  async removerServidor(
    serverId: string,
    deleteFiles = false
  ): Promise<{ ok: boolean; servers: StudioServerRecord[]; active_server_id: string }> {
    const data = await requestJson<{
      ok: boolean;
      servers: StudioServerRecord[];
      active_server_id: string;
    }>(`/api/studio/servers/${encodeURIComponent(serverId)}?delete_files=${deleteFiles ? "1" : "0"}`, {
      method: "DELETE",
    });
    if (getActiveServerId() === serverId) {
      setActiveServerId(data.active_server_id || "primary");
    }
    return data;
  },

  async gerarConviteServidor(serverId: string): Promise<ServerInviteToken> {
    const data = await requestJson<{ ok: boolean; invite: ServerInviteToken }>(
      `/api/studio/servers/${encodeURIComponent(serverId)}/invite`,
      { method: "POST" }
    );
    return data.invite;
  },

  // Fase 18 — Auto-Update (Desktop e VPS)
  async obterStatusAtualizacao(): Promise<UpdateStatusSnapshot> {
    const data = await requestJson<{ ok: boolean; status: UpdateStatusSnapshot }>(
      "/api/studio/updates/status"
    );
    return data.status;
  },

  async verificarAtualizacoes(): Promise<UpdateStatusSnapshot> {
    const data = await requestJson<{ ok: boolean; status: UpdateStatusSnapshot }>(
      "/api/studio/updates/check",
      { method: "POST" }
    );
    return data.status;
  },

  async aplicarAtualizacao(payload?: {
    platform?: "win32" | "darwin" | "linux" | "vps-tarball";
    restart?: boolean;
  }): Promise<UpdateStatusSnapshot> {
    const data = await requestJson<{ ok: boolean; status: UpdateStatusSnapshot }>(
      "/api/studio/updates/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }
    );
    return data.status;
  },

  async triggerUpdateRestart(): Promise<{
    ok: boolean;
    triggered: boolean;
    mode: "hot_bundle" | "native_installer";
    stagedArtifactPath: string | null;
    version: string;
  }> {
    return await requestJson("/api/studio/updates/restart", {
      method: "POST",
    });
  },

  async transcribeAudio(
    audioBase64: string,
    mimeType = "audio/webm"
  ): Promise<{ ok: boolean; texto: string }> {
    return await requestJson("/api/voz/transcrever", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: mimeType,
      }),
    });
  },
};
