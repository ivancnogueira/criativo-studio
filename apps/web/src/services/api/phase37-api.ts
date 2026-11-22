import type {
  AgentTemplatePackage,
  CuaActionRequest,
  CuaActionResult,
  CuaStatusSnapshot,
  ExternalThemePalette,
  HostResourceSnapshot,
} from "@criativo/contracts";
import { requestJson } from "../http-client";

export const phase37Api = {
  // CUA Driver (G-21)
  async getCuaStatus(): Promise<CuaStatusSnapshot> {
    return requestJson<CuaStatusSnapshot>("/api/cua/status");
  },
  async executeCuaAction(payload: CuaActionRequest): Promise<CuaActionResult> {
    return requestJson<CuaActionResult>("/api/cua/execute", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async abortCua(reason?: string): Promise<{ ok: boolean; status: CuaStatusSnapshot }> {
    return requestJson("/api/cua/abort", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  async resetCuaAbort(): Promise<{ ok: boolean; status: CuaStatusSnapshot }> {
    return requestJson("/api/cua/reset-abort", { method: "POST" });
  },

  // Temas Externos JSON (G-22)
  async listExternalThemes(): Promise<{ themes: ExternalThemePalette[]; themes_dir: string }> {
    return requestJson("/api/themes");
  },
  async reloadExternalThemes(): Promise<{ ok: boolean; themes: ExternalThemePalette[] }> {
    return requestJson("/api/themes/reload", { method: "POST" });
  },
  async importExternalTheme(
    themeJson: string | Record<string, unknown>,
  ): Promise<{ ok: boolean; theme: ExternalThemePalette; themes: ExternalThemePalette[] }> {
    return requestJson("/api/themes/import", {
      method: "POST",
      body: JSON.stringify({ themeJson }),
    });
  },

  // Templates Versionados (G-23)
  async exportAgentTemplate(
    agentId: string,
    opts?: { version?: string; author?: string; description?: string },
  ): Promise<{ ok: boolean; package: AgentTemplatePackage }> {
    const qs = new URLSearchParams();
    if (opts?.version) qs.set("version", opts.version);
    if (opts?.author) qs.set("author", opts.author);
    if (opts?.description) qs.set("description", opts.description);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestJson(`/api/templates/export/${encodeURIComponent(agentId)}${suffix}`);
  },
  async installAgentTemplate(payload: {
    package?: AgentTemplatePackage;
    sourceUrl?: string;
    agenteId?: string;
  }): Promise<{
    ok: boolean;
    installed: { agente_id: string; template_id: string; version: string; sha256: string };
  }> {
    return requestJson("/api/templates/install", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Monitor de Recursos do Host (G-24)
  async getHostResources(): Promise<HostResourceSnapshot> {
    return requestJson<HostResourceSnapshot>("/api/system/resources");
  },
  async killTrackedHostProcess(pid: number): Promise<{ ok: boolean; pid: number; label: string }> {
    return requestJson(`/api/system/processes/${pid}/kill`, {
      method: "POST",
    });
  },
};
