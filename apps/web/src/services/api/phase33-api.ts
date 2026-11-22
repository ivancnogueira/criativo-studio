import type {
  CustomOpenAIEndpointConfig,
  DetectedLocalProvider,
  MediaProviderDescriptor,
  RoutineCalendarFeedInfo,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const phase33Api = {
  async listCustomProviders(): Promise<CustomOpenAIEndpointConfig[]> {
    const res = await apiFetch("/api/providers/custom");
    const json = (await res.json()) as { endpoints?: CustomOpenAIEndpointConfig[] };
    return json.endpoints ?? [];
  },

  async saveCustomProvider(input: {
    id?: string;
    name: string;
    baseUrl: string;
    models: string[];
    apiKey?: string;
    enabled?: boolean;
  }): Promise<CustomOpenAIEndpointConfig> {
    const res = await apiFetch("/api/providers/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as { endpoint?: CustomOpenAIEndpointConfig; erro?: string };
    if (!res.ok || !json.endpoint) {
      throw new Error(json.erro ?? "Falha ao salvar provedor customizado.");
    }
    return json.endpoint;
  },

  async deleteCustomProvider(id: string): Promise<void> {
    const res = await apiFetch(`/api/providers/custom/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { erro?: string };
      throw new Error(json.erro ?? "Falha ao remover provedor customizado.");
    }
  },

  async testCustomProvider(id: string): Promise<{
    ok: boolean;
    status: number | null;
    models: string[];
    erro?: string;
  }> {
    const res = await apiFetch(`/api/providers/custom/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
    return (await res.json()) as {
      ok: boolean;
      status: number | null;
      models: string[];
      erro?: string;
    };
  },

  async detectLocalProviders(refresh = false): Promise<DetectedLocalProvider[]> {
    const qs = refresh ? "?refresh=1" : "";
    const res = await apiFetch(`/api/providers/local/detect${qs}`);
    const json = (await res.json()) as { providers?: DetectedLocalProvider[] };
    return json.providers ?? [];
  },

  async getRoutineIcsFeedConfig(): Promise<RoutineCalendarFeedInfo> {
    const res = await apiFetch("/api/rotinas/feed-config");
    const json = (await res.json()) as RoutineCalendarFeedInfo & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao consultar configuração do feed iCalendar.");
    }
    return {
      enabled: Boolean(json.enabled),
      feedPath: json.feedPath,
      updatedAt: json.updatedAt ?? null,
    };
  },

  async rotateRoutineIcsFeedToken(): Promise<RoutineCalendarFeedInfo> {
    const res = await apiFetch("/api/rotinas/feed-token/rotate", { method: "POST" });
    const json = (await res.json()) as RoutineCalendarFeedInfo & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao rotacionar token do feed iCalendar.");
    }
    return {
      enabled: Boolean(json.enabled),
      feedPath: json.feedPath,
      updatedAt: json.updatedAt ?? null,
    };
  },

  async listWorkflowMediaProviders(): Promise<MediaProviderDescriptor[]> {
    const res = await apiFetch("/api/workflows/media-providers");
    const json = (await res.json()) as { providers?: MediaProviderDescriptor[] };
    return json.providers ?? [];
  },
};
