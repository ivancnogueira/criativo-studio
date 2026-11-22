import type { BrowserProfileInfo, BrowserProfileProxyPayload, BrowserProxyConfig, BrowserSnapshotResult, BrowserStatusReport, BrowserTakeoverReason, BrowserTakeoverSession, BrowserTargetSelector, ReadVideoResult, UserBrowsingStep } from "@criativo/contracts";
import { requestJson } from "../http-client";

export const browserApi = {
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
    return await requestJson(`/api/navegador/sessoes/${encodeURIComponent(tabId)}/segredo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
    return await requestJson(`/api/navegador/sessoes/${encodeURIComponent(tabId)}/teach/parar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  },

  async listUserBrowsingLog(agenteId: string): Promise<{
    agenteId: string;
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  }> {
    return await requestJson(`/api/navegador/browsing-log/${encodeURIComponent(agenteId)}`);
  },

  async clearUserBrowsingLog(agenteId: string): Promise<{ ok: boolean; removed: number }> {
    return await requestJson(`/api/navegador/browsing-log/${encodeURIComponent(agenteId)}`, {
      method: "DELETE",
    });
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
};
