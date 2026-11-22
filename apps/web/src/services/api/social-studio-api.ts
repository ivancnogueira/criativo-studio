import type {
  CreateEditorialPostInput,
  EditorialPostRecord,
  EditorialPostsFilter,
  MetaGalleryPeriod,
  MetaGalleryResponse,
  UpdateEditorialPostInput,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

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
};
