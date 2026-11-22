import type {
  AnexoChat,
  ArquivoStudio,
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
  OnboardingEstado,
  ReadVideoResult,
  SharedTableDetail,
  SharedTableQueryResult,
  SharedTableSummary,
  ShowcaseSiteSummary,
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  StatusMensageria,
  StorageUsageSnapshot,
  StudioUserSettings,
  UserBrowsingStep,
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMensagemRegistro,
  WhatsAppMetodoPareamento,
  WhatsAppModoOperacao,
  WhatsAppPairingRequest,
  WhatsNewReleaseInfo,
} from "@criativo/contracts";
import { apiFetch, requestJson } from "../http-client";

export const filesTablesApi = {
  async listFiles(): Promise<ArquivoStudio[]> {
    const res = await apiFetch("/api/arquivos");
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
    return (await filesTablesApi.uploadFileCategorized(file, undefined, agenteId)).anexo;
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

  async listSharedTables(): Promise<SharedTableSummary[]> {
    const data = await requestJson<{ tables?: SharedTableSummary[] }>("/api/tabelas-compartilhadas");
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
    return await requestJson<SharedTableQueryResult>("/api/tabelas-compartilhadas/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, ...(params ? { params } : {}) }),
    });
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
    return await requestJson(`/api/armazenamento/arquivos/${encodeURIComponent(arquivoId)}`, {
      method: "DELETE",
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
};
