import type {
  AgentRoutine,
  MensagemChat,
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
  UpdateAgentRoutineInput,
  WebhookReceipt,
  WebhookTestResult,
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
import { apiFetch, WorkflowRevisionConflictError } from "../http-client";

export const workflowsRoutinesApi = {
  async listWorkflows(): Promise<WorkflowSummary[]> {
    const res = await apiFetch("/api/workflows");
    const json = (await res.json()) as { workflows: WorkflowSummary[] };
    return json.workflows ?? [];
  },

  async getWorkflowDetail(workflowId: string): Promise<WorkflowDetail> {
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}`);
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
    const res = await apiFetch(
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
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao excluir workflow.");
    }
  },

  async listWorkflowVersions(workflowId: string): Promise<WorkflowVersionSummary[]> {
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/versoes`);
    const json = (await res.json()) as { versoes?: WorkflowVersionSummary[] };
    return json.versoes ?? [];
  },

  async getWorkflowVersion(workflowId: string, versionId: string): Promise<WorkflowVersionRecord> {
    const res = await apiFetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/versoes/${encodeURIComponent(versionId)}`
    );
    const json = (await res.json()) as { versao?: WorkflowVersionRecord; erro?: string };
    if (!res.ok || !json.versao) {
      throw new Error(json.erro ?? "Versão de workflow não encontrada.");
    }
    return json.versao;
  },

  async restoreWorkflowVersion(workflowId: string, versionId: string): Promise<WorkflowDetail> {
    const res = await apiFetch(
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
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/executar`, {
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
    const res = await apiFetch(
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
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/execucoes${suffix}`);
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
    const res = await apiFetch(`/api/workflows/execucoes/${encodeURIComponent(runId)}`);
    const json = (await res.json()) as { execucao?: WorkflowRunDetail; erro?: string };
    if (!res.ok || !json.execucao) {
      throw new Error(json.erro ?? "Execução de workflow não encontrada.");
    }
    return json.execucao;
  },

  async stopWorkflowRun(runId: string): Promise<WorkflowRunDetail> {
    const res = await apiFetch(`/api/workflows/execucoes/${encodeURIComponent(runId)}/parar`, {
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
    const res = await apiFetch(`/api/workflows/etapas/${encodeURIComponent(stepId)}/decidir`, {
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
    const res = await apiFetch(`/api/workflows/etapas/${encodeURIComponent(stepId)}/retentar`, {
      method: "POST",
    });
    const json = (await res.json()) as { resultado?: unknown; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao retentar etapa.");
    }
    return json.resultado;
  },

  async stopWorkflowStep(stepId: string): Promise<void> {
    const res = await apiFetch(`/api/workflows/etapas/${encodeURIComponent(stepId)}/parar`, {
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
    const res = await apiFetch(
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

  async listAllRoutines(): Promise<AgentRoutine[]> {
    const res = await apiFetch("/api/rotinas?owner_kind=all");
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
    const res = await apiFetch(base);
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
    const res = await apiFetch(endpoint, {
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
    const res = await apiFetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao excluir rotina.");
    }
  },

  async testRoutine(rotinaId: string, instrucao?: string): Promise<RoutineRun> {
    const res = await apiFetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/testar`, {
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
    const res = await apiFetch(
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
    const res = await apiFetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/execucoes${suffix}`);
    const json = (await res.json()) as { execucoes?: RoutineRun[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao listar execuções da rotina.");
    }
    return json.execucoes ?? [];
  },

  async listRoutineDestinationOptions(): Promise<RoutineDestinationOption[]> {
    const res = await apiFetch("/api/rotinas/destinos-opcoes");
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
    const res = await apiFetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/destino`, {
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
    const res = await apiFetch(`/api/rotinas/gerenciar/${encodeURIComponent(rotinaId)}/entregas`);
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
    const res = await apiFetch(
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
    const res = await apiFetch(
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
    const res = await apiFetch(
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
    const res = await apiFetch(
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
    const res = await apiFetch(
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
    const res = await apiFetch(`/api/agenda?${qs.toString()}`);
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
    const res = await apiFetch(`/api/fluxos-rotinas/${encodeURIComponent(agenteId)}`);
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
    const res = await apiFetch(
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
    const res = await apiFetch(
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
    const res = await apiFetch("/api/fluxos-rotinas/links", {
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
    const res = await apiFetch(`/api/fluxos-rotinas/links/${encodeURIComponent(linkId)}`, {
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
    const res = await apiFetch(
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
    const res = await apiFetch(`/api/fluxos-rotinas/runs/${encodeURIComponent(execucaoId)}/parar`, {
      method: "POST",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao parar execução do fluxo.");
    }
  },

  async listRoutineThreadMessages(agenteId: string, rotinaId: string): Promise<MensagemChat[]> {
    const res = await apiFetch(
      `/api/agentes/${encodeURIComponent(agenteId)}/rotinas/${encodeURIComponent(rotinaId)}/mensagens`
    );
    const json = (await res.json()) as { mensagens?: MensagemChat[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar conversa da rotina.");
    }
    return json.mensagens ?? [];
  },
};
