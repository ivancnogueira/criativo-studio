import type {
  AgentAllowedFolder,
  AgenteEspera,
  AgenteMemoria,
  AgenteMemoriasSnapshot,
  AgentNotificationLevel,
  AgenteRegistro,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  AprendizadoConfig,
  AvatarShape,
  AvatarStyle,
  BackupModelChoice,
  BackupModelsConfig,
  CanalEquipe,
  CanalMemoria,
  CanalNavegadorModo,
  ConversationUiBlock,
  DeletedNativeAgentInfo,
  FilaChatEntrega,
  FilaChatSnapshot,
  MemoriaInclusao,
  MemoryReviewAlteracao,
  MensagemChat,
  MensagemFixada,
  NivelEsforco,
  PaginaConversaThread,
  PermissionLevel,
  SkillSugestaoItem,
  TarefaRegistro,
  UiBlockSubmitPayload,
} from "@criativo/contracts";
import { apiFetch, DaemonHttpError, requestJson } from "../http-client";

export const agentsChatApi = {
  async listTasks(): Promise<TarefaRegistro[]> {
    const res = await apiFetch("/api/tarefas");
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
    const res = await apiFetch("/api/tarefas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async approveTask(tarefaId: string): Promise<TarefaRegistro> {
    const res = await apiFetch(`/api/tarefas/${encodeURIComponent(tarefaId)}/aprovar`, {
      method: "POST",
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async cancelTask(tarefaId: string): Promise<TarefaRegistro> {
    const res = await apiFetch(`/api/tarefas/${encodeURIComponent(tarefaId)}/cancelar`, {
      method: "POST",
    });
    const json = (await res.json()) as { tarefa: TarefaRegistro };
    return json.tarefa;
  },

  async retryTask(tarefaId: string): Promise<TarefaRegistro> {
    const res = await apiFetch(`/api/tarefas/${encodeURIComponent(tarefaId)}/retentar`, {
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
    await apiFetch(`/api/agentes/${encodeURIComponent(agenteId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelo_padrao: modeloPadrao }),
    });
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
    const res = await apiFetch("/api/agentes", {
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
      { method: "POST" }
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
      "/api/agentes/excluidos"
    );
    return json.excluidos ?? [];
  },

  async restoreAllDeletedAgents(): Promise<{ ok: boolean; restored_ids: string[] }> {
    return await requestJson("/api/agentes/restaurar-excluidos", {
      method: "POST",
    });
  },

  async duplicateAgent(
    agenteId: string
  ): Promise<{ agente: AgenteRegistro; layout: import("@criativo/contracts").SidebarLayoutSnapshot }> {
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

  async listAgentMessages(agenteId: string): Promise<MensagemChat[]> {
    const res = await apiFetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`);
    const json = (await res.json()) as { mensagens: MensagemChat[] };
    return json.mensagens ?? [];
  },

  async markAgentRead(agenteId: string): Promise<void> {
    await apiFetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens/lidas`, {
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
    const res = await apiFetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`, {
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
    const res = await apiFetch(`/api/agentes/${encodeURIComponent(agenteId)}/memorias`);
    const json = (await res.json()) as {
      memorias: Array<{ memoria_id: string; texto: string; criado_em: string }>;
    };
    return json.memorias ?? [];
  },

  async addAgentMemory(agenteId: string, texto: string): Promise<void> {
    await apiFetch(`/api/agentes/${encodeURIComponent(agenteId)}/memorias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
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

  async listChannels(): Promise<CanalEquipe[]> {
    const res = await apiFetch("/api/canais");
    const json = (await res.json()) as { canais: CanalEquipe[] };
    return json.canais ?? [];
  },

  async createChannel(input: {
    nome: string;
    descricao: string;
    instrucoes?: string;
    membros_agentes: string[];
    lider_agente_id?: string | null;
    navegador_modo?: CanalNavegadorModo;
    manter_memorias?: boolean;
  }): Promise<CanalEquipe> {
    const json = await requestJson<{ canal: CanalEquipe }>("/api/canais", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return json.canal;
  },

  async updateChannel(
    canalId: string,
    patch: {
      nome?: string;
      descricao?: string;
      instrucoes?: string;
      membros_agentes?: string[];
      lider_agente_id?: string | null;
      navegador_modo?: CanalNavegadorModo;
      manter_memorias?: boolean;
    }
  ): Promise<CanalEquipe> {
    const json = await requestJson<{ canal: CanalEquipe }>(
      `/api/canais/${encodeURIComponent(canalId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return json.canal;
  },

  async deleteChannel(canalId: string): Promise<{ ok: boolean }> {
    return await requestJson<{ ok: boolean }>(
      `/api/canais/${encodeURIComponent(canalId)}`,
      { method: "DELETE" }
    );
  },

  async listChannelMemories(canalId: string): Promise<CanalMemoria[]> {
    const json = await requestJson<{ memorias: CanalMemoria[] }>(
      `/api/canais/${encodeURIComponent(canalId)}/memorias`
    );
    return json.memorias ?? [];
  },

  async addChannelMemory(canalId: string, texto: string): Promise<CanalMemoria[]> {
    const json = await requestJson<{ memorias: CanalMemoria[] }>(
      `/api/canais/${encodeURIComponent(canalId)}/memorias`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      }
    );
    return json.memorias ?? [];
  },

  async deleteChannelMemory(canalId: string, memoriaId: string): Promise<{ ok: boolean }> {
    return await requestJson<{ ok: boolean }>(
      `/api/canais/${encodeURIComponent(canalId)}/memorias/${encodeURIComponent(memoriaId)}`,
      { method: "DELETE" }
    );
  },

  async startNewChannelConversation(
    canalId: string
  ): Promise<{ ok: boolean; canal?: CanalEquipe; mensagem_divisor: MensagemChat }> {
    return await requestJson(
      `/api/canais/${encodeURIComponent(canalId)}/nova-conversa`,
      { method: "POST" }
    );
  },

  async compactChannelContext(
    canalId: string
  ): Promise<{ ok: boolean; canal?: CanalEquipe; mensagem_divisor: MensagemChat; resumo: string }> {
    return await requestJson(
      `/api/canais/${encodeURIComponent(canalId)}/compactar-contexto`,
      { method: "POST" }
    );
  },

  async listChannelMessages(canalId: string, limit?: number): Promise<MensagemChat[]> {
    const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
    const res = await apiFetch(`/api/canais/${encodeURIComponent(canalId)}/mensagens${qs}`);
    const json = (await res.json()) as { mensagens: MensagemChat[] };
    return json.mensagens ?? [];
  },

  async sendChannelMessage(
    canalId: string,
    conteudo: string,
    anexos: AnexoChat[]
  ): Promise<{ mensagem_usuario: MensagemChat; mensagens_equipe: MensagemChat[] }> {
    const res = await apiFetch(`/api/canais/${encodeURIComponent(canalId)}/mensagens`, {
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
};
