import type {
  AgenteRegistro,
  AnexoChat,
  ArquivoStudio,
  AvatarShape,
  CanalEquipe,
  ConectorIntegracaoInfo,
  ContaProvedorInfo,
  HabilidadeInstaladaInfo,
  IdentidadeMarcaStudio,
  MensagemChat,
  NivelEsforco,
  OnboardingEstado,
  PacoteUpgradeInfo,
  ProvedorStatusInfo,
  ProviderName,
  RelatorioAnalyticsHost,
  StatusMensageria,
  TarefaRegistro,
  UsoProvedoresSnapshot,
  WebSocketEnvelope,
  WebSocketEventMap,
  WorkflowAresta,
  WorkflowNo,
  WorkflowVisual,
} from "@criativo/contracts";

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
  private readonly listeners = new Map<EventName, Set<EventListener<any>>>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();

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

  public onConnectionChange(listener: (connected: boolean) => void): () => void {
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

  public connect(): void {
    this.closedManually = false;
    if (typeof WebSocket === "undefined") return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      for (const cb of this.connectionListeners) cb(true);
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
      for (const cb of this.connectionListeners) cb(false);
      if (!this.closedManually) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
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

  async listAgents(): Promise<AgenteRegistro[]> {
    const res = await fetch("/api/agentes");
    const json = (await res.json()) as {
      agentes: Array<
        AgenteRegistro & {
          skills_paths_json?: string;
          config_json?: string;
        }
      >;
    };
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

  // --- Rotas Fase 7 (OpenBot Parity) ---
  async getOnboarding(): Promise<OnboardingEstado> {
    const res = await fetch("/api/onboarding");
    const json = (await res.json()) as { onboarding: OnboardingEstado };
    return json.onboarding;
  },

  async updateOnboarding(patch: Partial<OnboardingEstado>): Promise<OnboardingEstado> {
    const res = await fetch("/api/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { onboarding: OnboardingEstado };
    return json.onboarding;
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
    const json = (await res.json()) as { provedor: ProvedorStatusInfo };
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
    }
  ): Promise<AgenteRegistro> {
    const res = await fetch(`/api/agentes/${encodeURIComponent(agenteId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { agente: AgenteRegistro & { config_json?: string } };
    const cfg = json.agente.config_json
      ? (JSON.parse(json.agente.config_json) as Record<string, unknown>)
      : {};
    return { ...json.agente, config: json.agente.config ?? cfg };
  },

  async restoreAgentDefaults(agenteId: string): Promise<AgenteRegistro> {
    const res = await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/restaurar`, {
      method: "POST",
    });
    const json = (await res.json()) as { agente: AgenteRegistro & { config_json?: string } };
    const cfg = json.agente.config_json
      ? (JSON.parse(json.agente.config_json) as Record<string, unknown>)
      : {};
    return { ...json.agente, config: json.agente.config ?? cfg };
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
    anexos: AnexoChat[]
  ): Promise<{
    mensagem_usuario: MensagemChat;
    mensagem_agente: MensagemChat;
    mensagens_handoff?: MensagemChat[];
  }> {
    const res = await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo, anexos }),
    });
    return (await res.json()) as {
      mensagem_usuario: MensagemChat;
      mensagem_agente: MensagemChat;
      mensagens_handoff?: MensagemChat[];
    };
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

  async listWorkflows(): Promise<WorkflowVisual[]> {
    const res = await fetch("/api/workflows");
    const json = (await res.json()) as { workflows: WorkflowVisual[] };
    return json.workflows ?? [];
  },

  async saveWorkflow(wf: {
    workflow_id?: string;
    nome: string;
    descricao?: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
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
    const json = (await res.json()) as { workflow: WorkflowVisual };
    return json.workflow;
  },

  async executeWorkflow(workflowId: string): Promise<{ tarefas_criadas: string[] }> {
    const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/executar`, {
      method: "POST",
    });
    return (await res.json()) as { tarefas_criadas: string[] };
  },

  async listFiles(): Promise<ArquivoStudio[]> {
    const res = await fetch("/api/arquivos");
    const json = (await res.json()) as { arquivos: ArquivoStudio[] };
    return json.arquivos ?? [];
  },

  async uploadFile(file: File, agenteId?: string | null): Promise<AnexoChat> {
    const dataUrl = await new Promise<string>((resolveRead, rejectRead) => {
      const reader = new FileReader();
      reader.onload = () => resolveRead(String(reader.result ?? ""));
      reader.onerror = () => rejectRead(new Error("Falha ao ler arquivo local."));
      reader.readAsDataURL(file);
    });
    const res = await fetch("/api/arquivos/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: file.name,
        mime_type: file.type || "application/octet-stream",
        conteudo_base64: dataUrl,
        agente_id: agenteId ?? null,
      }),
    });
    const json = (await res.json()) as { arquivo: ArquivoStudio };
    return {
      arquivo_id: json.arquivo.arquivo_id,
      nome: json.arquivo.nome_original,
      caminho_relativo: json.arquivo.caminho_relativo,
      url: json.arquivo.url,
      mime_type: json.arquivo.mime_type,
      tamanho_bytes: json.arquivo.tamanho_bytes,
      tipo_uso: json.arquivo.tipo_uso,
    };
  },
};
