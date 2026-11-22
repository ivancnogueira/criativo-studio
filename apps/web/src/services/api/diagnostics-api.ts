import type { CriativoUserError, StructuredLogEntry } from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const diagnosticsApi = {
  async listDiagnosticLogs(filters?: {
    level?: "info" | "warn" | "error";
    code?: string;
    domain?: string;
    limit?: number;
  }): Promise<{ redigido: boolean; arquivo: string | null; logs: StructuredLogEntry[] }> {
    const qs = new URLSearchParams();
    if (filters?.level) qs.set("level", filters.level);
    if (filters?.code) qs.set("code", filters.code);
    if (filters?.domain) qs.set("domain", filters.domain);
    if (filters?.limit) qs.set("limit", String(filters.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await apiFetch(`/api/diagnostico/logs${suffix}`);
    const json = (await res.json()) as {
      ok?: boolean;
      redigido?: boolean;
      arquivo?: string | null;
      logs?: StructuredLogEntry[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao carregar logs estruturados de diagnóstico.");
    }
    return {
      redigido: json.redigido !== false,
      arquivo: json.arquivo ?? null,
      logs: json.logs ?? [],
    };
  },

  async listErrorCatalog(): Promise<CriativoUserError[]> {
    const res = await apiFetch("/api/diagnostico/erros-catalogo");
    const json = (await res.json()) as {
      ok?: boolean;
      erros?: CriativoUserError[];
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao consultar catálogo de erros CRV-*.");
    }
    return json.erros ?? [];
  },

  async searchGlobalStudio(query: string, limit = 5): Promise<{
    query: string;
    total: number;
    grupos: {
      agentes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }>;
      equipes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }>;
      threads: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string; section: "agentes" }>;
      mensagens: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string | null; section: "agentes" }>;
      workflows: Array<{ id: string; titulo: string; subtitulo: string; section: "fluxos" }>;
      rotinas: Array<{ id: string; titulo: string; subtitulo: string; section: "agenda" }>;
      arquivos: Array<{ id: string; titulo: string; subtitulo: string; section: "arquivos" }>;
    };
  }> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await apiFetch(`/api/busca-global?${qs.toString()}`);
    const json = (await res.json()) as {
      ok?: boolean;
      erro?: string;
      query: string;
      total: number;
      grupos: {
        agentes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }>;
        equipes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }>;
        threads: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string; section: "agentes" }>;
        mensagens: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string | null; section: "agentes" }>;
        workflows: Array<{ id: string; titulo: string; subtitulo: string; section: "fluxos" }>;
        rotinas: Array<{ id: string; titulo: string; subtitulo: string; section: "agenda" }>;
        arquivos: Array<{ id: string; titulo: string; subtitulo: string; section: "arquivos" }>;
      };
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha na busca global.");
    }
    return { query: json.query, total: json.total, grupos: json.grupos };
  },
};
