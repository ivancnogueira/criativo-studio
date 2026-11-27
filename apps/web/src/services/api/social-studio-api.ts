import type {
  CreateEditorialPostInput,
  EditorialPostRecord,
  EditorialPostsFilter,
  MetaFirstCommentRecord,
  MetaFirstCommentStatus,
  MetaGalleryPeriod,
  MetaGalleryResponse,
  MetaMediaAuditLogRecord,
  MetaPostingIntelligencePeriod,
  MetaPostingIntelligenceReport,
  MetaTrialEligibilityResult,
  UpdateEditorialPostInput,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

export interface MetaMediaDeletionApiResponse {
  ok: boolean;
  deleted_remote: boolean;
  removed_local_cache: boolean;
  media_id: string;
  audit_id?: string;
  limitation_code?: "META_DELETE_UNSUPPORTED" | "META_API_ERROR" | "CONFIRMATION_REQUIRED";
  message: string;
}

export const socialStudioApi = {
  async listEditorialPosts(filters: EditorialPostsFilter = {}): Promise<EditorialPostRecord[]> {
    const qs = new URLSearchParams();
    if (filters.mes) qs.set("mes", filters.mes);
    if (filters.status) qs.set("status", filters.status);
    if (filters.formato) qs.set("formato", filters.formato);
    if (filters.pilar) qs.set("pilar", filters.pilar);
    if (filters.busca) qs.set("busca", filters.busca);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/editorial/posts${suffix}`);
    const json = (await res.json()) as { ok?: boolean; posts?: EditorialPostRecord[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar pautas editoriais.");
    }
    return json.posts ?? [];
  },

  async createEditorialPost(input: CreateEditorialPostInput): Promise<EditorialPostRecord> {
    const res = await apiFetch("/api/editorial/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { ok?: boolean; post?: EditorialPostRecord; erro?: string };
    if (!res.ok || !json.post) {
      throw new Error(json.erro ?? "Falha ao criar pauta editorial.");
    }
    return json.post;
  },

  async updateEditorialPost(
    id: string,
    patch: UpdateEditorialPostInput
  ): Promise<EditorialPostRecord> {
    const res = await apiFetch(`/api/editorial/posts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { ok?: boolean; post?: EditorialPostRecord; erro?: string };
    if (!res.ok || !json.post) {
      throw new Error(json.erro ?? "Falha ao atualizar pauta editorial.");
    }
    return json.post;
  },

  async deleteEditorialPost(id: string): Promise<void> {
    const res = await apiFetch(`/api/editorial/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao excluir pauta editorial.");
    }
  },

  async produceEditorialPost(
    id: string,
    options?: { agente_id?: string; instrucoes?: string }
  ): Promise<{
    ok: boolean;
    post: EditorialPostRecord;
    tarefa_id: string;
    thread_id: string | null;
    agente_id: string;
  }> {
    const res = await apiFetch(`/api/editorial/posts/${encodeURIComponent(id)}/produzir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      post?: EditorialPostRecord;
      tarefa_id?: string;
      thread_id?: string | null;
      agente_id?: string;
      erro?: string;
    };
    if (!res.ok || !json.post || !json.tarefa_id) {
      throw new Error(json.erro ?? "Falha ao enviar pauta para produção pelo agente.");
    }
    return {
      ok: true,
      post: json.post,
      tarefa_id: json.tarefa_id,
      thread_id: json.thread_id ?? null,
      agente_id: json.agente_id ?? "designer_chefe",
    };
  },

  async getInstagramMetricsGallery(options?: {
    periodo?: MetaGalleryPeriod;
    refresh?: boolean;
    conta_id?: string;
    limite?: number;
  }): Promise<MetaGalleryResponse> {
    const qs = new URLSearchParams();
    if (options?.periodo) qs.set("periodo", options.periodo);
    if (options?.refresh) qs.set("refresh", "1");
    if (options?.conta_id) qs.set("conta_id", options.conta_id);
    if (options?.limite) qs.set("limite", String(options.limite));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/instagram/galeria-metricas${suffix}`);
    const json = (await res.json()) as MetaGalleryResponse & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar galeria de métricas do Instagram.");
    }
    return json;
  },

  async checkTrialReelEligibility(contaId?: string): Promise<MetaTrialEligibilityResult> {
    const qs = new URLSearchParams();
    if (contaId) qs.set("conta_id", contaId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/instagram/elegibilidade-trial${suffix}`);
    const json = (await res.json()) as MetaTrialEligibilityResult & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao verificar elegibilidade de Trial Reels.");
    }
    return json;
  },

  async listFirstComments(filters?: {
    media_id?: string;
    editorial_post_id?: string;
    status?: MetaFirstCommentStatus;
  }): Promise<MetaFirstCommentRecord[]> {
    const qs = new URLSearchParams();
    if (filters?.media_id) qs.set("media_id", filters.media_id);
    if (filters?.editorial_post_id) qs.set("editorial_post_id", filters.editorial_post_id);
    if (filters?.status) qs.set("status", filters.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/instagram/primeiro-comentario${suffix}`);
    const json = (await res.json()) as { ok?: boolean; jobs?: MetaFirstCommentRecord[]; erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar fila de primeiro comentário.");
    }
    return json.jobs ?? [];
  },

  async scheduleFirstComment(input: {
    media_id: string;
    comment_text: string;
    approved_by_human: boolean;
    delay_seconds?: number;
    editorial_post_id?: string | null;
    conta_id?: string | null;
  }): Promise<MetaFirstCommentRecord> {
    const res = await apiFetch("/api/instagram/primeiro-comentario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { ok?: boolean; job?: MetaFirstCommentRecord; erro?: string };
    if (!res.ok || !json.job) {
      throw new Error(json.erro ?? "Falha ao agendar primeiro comentário.");
    }
    return json.job;
  },

  async approveFirstComment(
    commentJobId: string,
    delaySeconds?: number
  ): Promise<MetaFirstCommentRecord> {
    const res = await apiFetch(
      `/api/instagram/primeiro-comentario/${encodeURIComponent(commentJobId)}/aprovar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          typeof delaySeconds === "number" ? { delay_seconds: delaySeconds } : {}
        ),
      }
    );
    const json = (await res.json()) as { ok?: boolean; job?: MetaFirstCommentRecord; erro?: string };
    if (!res.ok || !json.job) {
      throw new Error(json.erro ?? "Falha ao aprovar primeiro comentário.");
    }
    return json.job;
  },

  async cancelFirstComment(commentJobId: string): Promise<MetaFirstCommentRecord> {
    const res = await apiFetch(
      `/api/instagram/primeiro-comentario/${encodeURIComponent(commentJobId)}/cancelar`,
      { method: "POST" }
    );
    const json = (await res.json()) as { ok?: boolean; job?: MetaFirstCommentRecord; erro?: string };
    if (!res.ok || !json.job) {
      throw new Error(json.erro ?? "Falha ao cancelar primeiro comentário.");
    }
    return json.job;
  },

  async deleteInstagramMedia(
    mediaId: string,
    payload: {
      approved_by_human: boolean;
      confirm_text: string;
      reason?: string;
      conta_id?: string | null;
      remove_from_local_cache?: boolean;
    }
  ): Promise<MetaMediaDeletionApiResponse> {
    const res = await apiFetch(
      `/api/instagram/midia/${encodeURIComponent(mediaId)}/excluir`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = (await res.json()) as MetaMediaDeletionApiResponse & { erro?: string };
    if (!res.ok) {
      throw new Error(json.message ?? json.erro ?? "Falha ao excluir mídia na Meta Graph API.");
    }
    return json;
  },

  async listInstagramAuditLogs(params?: {
    media_id?: string;
    action?: string;
    limit?: number;
  }): Promise<MetaMediaAuditLogRecord[]> {
    const qs = new URLSearchParams();
    if (params?.media_id) qs.set("media_id", params.media_id);
    if (params?.action) qs.set("action", params.action);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/instagram/auditoria${suffix}`);
    const json = (await res.json()) as {
      ok?: boolean;
      logs?: MetaMediaAuditLogRecord[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao consultar trilha de auditoria Meta.");
    }
    return json.logs ?? [];
  },

  async getPostingIntelligence(options?: {
    periodo?: MetaPostingIntelligencePeriod;
    formato?: "carrossel" | "reels" | "imagem" | "story";
    conta_id?: string;
    timezone?: string;
  }): Promise<MetaPostingIntelligenceReport> {
    const qs = new URLSearchParams();
    if (options?.periodo) qs.set("periodo", options.periodo);
    if (options?.formato) qs.set("formato", options.formato);
    if (options?.conta_id) qs.set("conta_id", options.conta_id);
    if (options?.timezone) qs.set("timezone", options.timezone);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/editorial/inteligencia-horarios${suffix}`);
    const json = (await res.json()) as MetaPostingIntelligenceReport & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao consultar inteligência de horários e retenção.");
    }
    return json;
  },
};
