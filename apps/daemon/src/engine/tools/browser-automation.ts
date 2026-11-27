/**
 * Motor real de automação Chromium via Chrome DevTools Protocol (BrowserAutomationService — BRWS-01, BRWS-02).
 * Fachada delegando perfis, proxies, 22 ações CDP, Takeover, submit_secret e TeachBar.
 */
import { resolve } from "node:path";
import type {
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserSnapshotResult,
  BrowserStatusReport,
  BrowserTakeoverReason,
  BrowserTakeoverSession,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import {
  BrowserCdpSessionManager,
  type HumanCdpInputEvent,
  type ManagedTabEntry,
} from "./browser-cdp-session.ts";
import { assertSafeNavigationUrl, buildSemanticSnapshot } from "./browser-snapshot.ts";
import { BrowserSessionRecorder } from "./browser-session-recorder.ts";
import { UserBrowsingLogService } from "./user-browsing-log.ts";
import {
  BROWSER_FILL_FIELDS_MAX_FIELDS,
  BROWSER_FILL_FIELDS_MAX_TEXT_BYTES,
  SHARED_BROWSER_PROFILE_ID,
  type BrowserAutomationRuntimeContext,
  type BrowserCdpActionName,
  type BrowserExecuteActionInput,
  type BrowserNavigationParams,
  type BrowserNavigationResult,
  type BrowserProfile,
  type PendingTakeoverEntry,
} from "./browser/browser-types.ts";
import {
  clearBrowserProfileStorage,
  createBrowserProfile,
  deleteBrowserProfile,
  ensureBrowserProfile,
  ensureDefaultSharedBrowserProfile,
  getBrowserProfileInfo,
  listBrowserProfiles,
  openBrowserProfileWindow,
  sanitizeBrowserProxyForClient,
  updateBrowserProfile,
} from "./browser/browser-profiles-store.ts";
import {
  deleteBrowserProxy,
  listBrowserProxies,
  resolveBrowserProfileAndLaunchProxy,
  saveBrowserProxy,
} from "./browser/browser-proxies-store.ts";
import { executeBrowserCdpAction } from "./browser/browser-actions-exec.ts";
import {
  broadcastBrowserTeachStatus,
  createVirtualBrowserTabForSession,
  dispatchBrowserTakeoverInput,
  requestBrowserTakeover,
  resolveBrowserTakeover,
  startBrowserTeachRecording,
  stopBrowserTeachRecording,
  submitBrowserSecret,
} from "./browser/browser-takeover-teach.ts";

export {
  SHARED_BROWSER_PROFILE_ID,
  BROWSER_FILL_FIELDS_MAX_FIELDS,
  BROWSER_FILL_FIELDS_MAX_TEXT_BYTES,
  type BrowserProfile,
  type BrowserNavigationParams,
  type BrowserNavigationResult,
  type BrowserCdpActionName,
  type BrowserExecuteActionInput,
};

export class BrowserAutomationService {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private wsHub?: WebSocketHub;
  private readonly workspaceRoot: string;
  public readonly sessionManager: BrowserCdpSessionManager;
  public readonly browsingLog: UserBrowsingLogService;
  public readonly sessionRecorder: BrowserSessionRecorder;
  private readonly activeTakeovers = new Map<string, PendingTakeoverEntry>();

  constructor(
    db: CriativoDatabase,
    vault?: VaultService,
    wsHub?: WebSocketHub,
    workspaceRoot?: string,
  ) {
    this.db = db;
    this.vault = vault;
    this.wsHub = wsHub;
    this.workspaceRoot = resolve(workspaceRoot ?? process.cwd());
    this.sessionManager = new BrowserCdpSessionManager(this.workspaceRoot);
    this.sessionManager.setOnTabUnloaded((tab, pressureLevel) => {
      this.wsHub?.broadcast("browser:tab_unloaded", {
        tabId: tab.tabId,
        perfilId: tab.perfilId,
        agenteId: tab.agenteId,
        url: tab.virtualUrl,
        title: tab.virtualTitle,
        reason: tab.unloadReason ?? "pressão de memória",
        unloadedAt: tab.unloadedAt
          ? new Date(tab.unloadedAt).toISOString()
          : new Date().toISOString(),
        pressureLevel,
      });
      this.broadcastTabsAndFrame(null);
    });
    this.browsingLog = new UserBrowsingLogService(db);
    this.sessionRecorder = new BrowserSessionRecorder(this.workspaceRoot);
  }

  public setWebSocketHub(wsHub: WebSocketHub): void {
    this.wsHub = wsHub;
  }


  private getCtx(): BrowserAutomationRuntimeContext {
    return {
      db: this.db,
      vault: this.vault,
      getWsHub: () => this.wsHub,
      workspaceRoot: this.workspaceRoot,
      sessionManager: this.sessionManager,
      browsingLog: this.browsingLog,
      activeTakeovers: this.activeTakeovers,
      ensureDefaultSharedProfile: () => this.ensureDefaultSharedProfile(),
      sanitizeProxyForClient: (raw) => this.sanitizeProxyForClient(raw),
      resolveProfileAndLaunchProxy: (reqId, agId) => this.resolveProfileAndLaunchProxy(reqId, agId),
      getStatus: (agId) => this.getStatus(agId),
      requireRealTab: (tabId) => this.requireRealTab(tabId),
      ensureRealTabLoaded: (tabId) => this.ensureRealTabLoaded(tabId),
      ensureTabPreviewStream: (tab) => this.ensureTabPreviewStream(tab),
      broadcastTabsAndFrame: (tab) => this.broadcastTabsAndFrame(tab),
      captureTabSnapshot: (tab, includeImage) => this.captureTabSnapshot(tab, includeImage),
      requestTakeover: (p) => this.requestTakeover(p),
      resolveTakeover: (tabId, decision) => this.resolveTakeover(tabId, decision),
      broadcastTeachStatus: (tab) => this.broadcastTeachStatus(tab),
      stopTeachRecording: (tabId, action) => this.stopTeachRecording(tabId, action),
    };
  }

  public ensureDefaultSharedProfile(): BrowserProfileInfo {
    return ensureDefaultSharedBrowserProfile(this.getCtx());
  }

  public ensureProfile(nome: string, proxyUrl?: string): BrowserProfile {
    return ensureBrowserProfile(this.getCtx(), nome, proxyUrl);
  }

  private sanitizeProxyForClient(rawJson?: string | null): BrowserProfileProxyPayload {
    return sanitizeBrowserProxyForClient(this.getCtx(), rawJson);
  }

  public getProfileInfo(perfilId: string): BrowserProfileInfo | null {
    return getBrowserProfileInfo(this.getCtx(), perfilId);
  }

  public listProfiles(): BrowserProfileInfo[] {
    return listBrowserProfiles(this.getCtx());
  }

  public createProfile(input: Parameters<typeof createBrowserProfile>[1]): BrowserProfileInfo {
    return createBrowserProfile(this.getCtx(), input);
  }

  public async updateProfile(
    perfilId: string,
    patch: Parameters<typeof updateBrowserProfile>[2]
  ) {
    return await updateBrowserProfile(this.getCtx(), perfilId, patch);
  }

  public async openProfileWindow(perfilId: string, initialUrl?: string) {
    return await openBrowserProfileWindow(this.getCtx(), perfilId, initialUrl);
  }

  public async clearProfileStorage(perfilId: string) {
    return await clearBrowserProfileStorage(this.getCtx(), perfilId);
  }

  public async deleteProfile(perfilId: string) {
    return await deleteBrowserProfile(this.getCtx(), perfilId);
  }

  public listProxies(): BrowserProxyConfig[] {
    return listBrowserProxies(this.getCtx());
  }

  public saveProxy(input: Parameters<typeof saveBrowserProxy>[1]): BrowserProxyConfig {
    return saveBrowserProxy(this.getCtx(), input);
  }

  public deleteProxy(proxyId: string): boolean {
    return deleteBrowserProxy(this.getCtx(), proxyId);
  }

  private resolveProfileAndLaunchProxy(requestedProfileId?: string | null, agenteId?: string | null) {
    return resolveBrowserProfileAndLaunchProxy(this.getCtx(), requestedProfileId, agenteId);
  }

  public getStatus(agenteId?: string): BrowserStatusReport {
    const bin = this.sessionManager.detectBinary();
    const tabs = this.sessionManager.listTabSummaries(agenteId);
    const unloadedTabs = tabs.filter((t) => t.unloaded === true).length;
    return {
      available: bin.available,
      executablePath: bin.executablePath,
      reason: bin.reason ?? null,
      activeContexts: this.sessionManager.getActiveContextCount(),
      activeTabs: Math.max(0, tabs.length - unloadedTabs),
      tabs,
      unloadedTabs,
      memoryPressure: this.sessionManager.getMemoryPressureLevel(),
    };
  }

  // ===========================================================================
  // 2. Retrocompatibilidade inspectPublicPage (CDP real + fallback HTTP seguro)
  // ===========================================================================

  public async inspectPublicPage(
    params: BrowserNavigationParams,
  ): Promise<BrowserNavigationResult> {
    const parsedUrl = assertSafeNavigationUrl(params.url);
    const bin = this.sessionManager.detectBinary();

    if (bin.available && process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
      try {
        const opened = (await this.executeAction({
          action: "open",
          url: parsedUrl.toString(),
          perfilId: params.perfil_id ?? SHARED_BROWSER_PROFILE_ID,
        })) as BrowserSnapshotResult;
        await this.sessionManager.closeTab(opened.tabId);
        return {
          url: opened.url,
          status: 200,
          title: opened.title || parsedUrl.hostname,
          textPreview: opened.textSummary.slice(0, 1500),
          perfil_id: opened.perfilId,
        };
      } catch {
        // Fallback gracioso para leitura HTTP leve caso o host headless restrinja sandbox
      }
    }

    const profile = params.perfil_id
      ? ((this.db.connection
          .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
          .get(params.perfil_id) as unknown as BrowserProfile | undefined) ??
        this.ensureProfile("perfil-pesquisa-padrao"))
      : this.ensureProfile("perfil-pesquisa-padrao");

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "CriativoOS-ResearchBot/2.0",
        Accept: "text/html,application/xhtml+xml,application/json",
      },
    });
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1]!.trim() : parsedUrl.hostname;
    const textPreview = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1500);

    this.db.connection
      .prepare("UPDATE projecao_perfis_navegador SET ultimo_uso_em = ? WHERE perfil_id = ?;")
      .run(new Date().toISOString(), profile.perfil_id);

    return {
      url: parsedUrl.toString(),
      status: response.status,
      title,
      textPreview,
      perfil_id: profile.perfil_id,
    };
  }

  // ===========================================================================
  // 3. Execução das 22 Ações Semânticas CDP (BRWS-01)
  // ===========================================================================

  private requireRealTab(tabId?: string): ManagedTabEntry {
    if (!tabId) {
      throw new Error("Informe 'tabId' da aba ativa para executar esta ação.");
    }
    const entry = this.sessionManager.getTab(tabId);
    if (!entry) {
      throw new Error(`Aba '${tabId}' não encontrada ou já encerrada.`);
    }
    if (entry.userControl) {
      throw new Error(
        `A aba '${tabId}' está atualmente sob controle interativo humano (BrowserTakeover). Aguarde o usuário concluir a sessão.`,
      );
    }
    if (!entry.page) {
      throw new Error(`A aba '${tabId}' não possui página Chromium ativa neste ambiente.`);
    }
    entry.lastActivityAt = Date.now();
    return entry;
  }

  public async ensureRealTabLoaded(tabId?: string): Promise<ManagedTabEntry> {
    if (!tabId) {
      throw new Error("Informe 'tabId' da aba ativa para executar esta ação.");
    }
    const entry = this.sessionManager.getTab(tabId);
    if (!entry) {
      throw new Error(`Aba '${tabId}' não encontrada ou já encerrada.`);
    }
    if (entry.userControl) {
      throw new Error(
        `A aba '${tabId}' está atualmente sob controle interativo humano (BrowserTakeover). Aguarde o usuário concluir a sessão.`,
      );
    }
    if (entry.unloaded || (!entry.page && entry.userDataDir)) {
      const reloaded = await this.sessionManager.reloadUnloadedTab(tabId, (tab) => {
        const resolved = this.resolveProfileAndLaunchProxy(tab.perfilId, tab.agenteId);
        return {
          perfilId: tab.perfilId,
          userDataDir: tab.userDataDir || resolved.profile.user_data_dir,
          cdpUrl: resolved.profile.cdp_porta ? `http://127.0.0.1:${resolved.profile.cdp_porta}` : null,
          proxy: resolved.proxy,
        };
      });
      this.broadcastTabsAndFrame(reloaded);
      return reloaded;
    }
    return this.requireRealTab(tabId);
  }

  private ensureTabPreviewStream(tab: ManagedTabEntry): void {
    const emitFrame = (frame: {
      tabId: string;
      dataUrl: string;
      width: number;
      height: number;
      url: string;
      title: string;
      userControl: boolean;
    }) => {
      if (this.sessionRecorder.getStatus(tab.tabId).recording) {
        this.sessionRecorder.appendDataUrlFrame(tab.tabId, frame.dataUrl);
      }
      this.wsHub?.broadcast("browser:frame", {
        ...frame,
        agenteId: tab.agenteId,
        perfilId: tab.perfilId,
      });
    };

    if (!tab.screencastActive) {
      void this.sessionManager
        .startScreencast(tab.tabId, emitFrame, tab.userControl ? 125 : 320)
        .catch(() => {});
    } else {
      void this.sessionManager.captureAndEmitFrame(tab.tabId, emitFrame).catch(() => {});
    }
  }

  private broadcastTabsAndFrame(tab?: ManagedTabEntry | null): void {
    this.wsHub?.broadcast("browser:tabs_updated", {
      tabs: this.sessionManager.listTabSummaries(),
      activeTabId: tab?.tabId ?? null,
      agenteId: tab?.agenteId ?? null,
    });
    if (tab && tab.page) {
      this.ensureTabPreviewStream(tab);
    }
  }

  private async captureTabSnapshot(
    entry: ManagedTabEntry,
    includeImage = false,
  ): Promise<BrowserSnapshotResult> {
    if (!entry.page) {
      return {
        tabId: entry.tabId,
        perfilId: entry.perfilId,
        url: entry.virtualUrl,
        title: entry.virtualTitle,
        revision: entry.revision,
        elements: [],
        textSummary: `Página: ${entry.virtualTitle} — ${entry.virtualUrl}`,
        truncated: false,
      };
    }
    const { snapshot, refMap } = await buildSemanticSnapshot(
      entry.page,
      entry.tabId,
      entry.perfilId,
      entry.revision,
      includeImage,
    );
    entry.snapshotRefs = refMap;
    entry.virtualUrl = snapshot.url;
    entry.virtualTitle = snapshot.title;
    return snapshot;
  }


  public async executeAction(input: BrowserExecuteActionInput): Promise<unknown> {
    return await executeBrowserCdpAction(this.getCtx(), input);
  }

  public createVirtualTabForSession(params: Parameters<typeof createVirtualBrowserTabForSession>[1]) {
    return createVirtualBrowserTabForSession(this.getCtx(), params);
  }

  public async requestTakeover(params: Parameters<typeof requestBrowserTakeover>[1]) {
    return await requestBrowserTakeover(this.getCtx(), params);
  }

  public async resolveTakeover(tabId: string, decision: "complete" | "cancel") {
    return await resolveBrowserTakeover(this.getCtx(), tabId, decision);
  }

  public async dispatchTakeoverInput(
    tabId: string,
    event: HumanCdpInputEvent,
    options?: { autoAssume?: boolean }
  ) {
    return await dispatchBrowserTakeoverInput(this.getCtx(), tabId, event, options);
  }

  public async submitSecret(params: Parameters<typeof submitBrowserSecret>[1]) {
    return await submitBrowserSecret(this.getCtx(), params);
  }

  private broadcastTeachStatus(tab: ManagedTabEntry): void {
    broadcastBrowserTeachStatus(this.getCtx(), tab);
  }

  public async startTeachRecording(tabId: string, agenteId?: string | null) {
    return await startBrowserTeachRecording(this.getCtx(), tabId, agenteId);
  }

  public stopTeachRecording(tabId: string, action: "save" | "discard" = "save") {
    return stopBrowserTeachRecording(this.getCtx(), tabId, action);
  }

  public startSessionRecording(tabId: string) {
    const tab = this.sessionManager.getTab(tabId);
    const state = this.sessionRecorder.startRecording(tabId);
    if (tab && tab.page) {
      this.ensureTabPreviewStream(tab);
    }
    return state;
  }

  public stopSessionRecording(tabId: string) {
    return this.sessionRecorder.stopRecording(tabId);
  }

  public getSessionRecordingStatus(tabId: string) {
    return this.sessionRecorder.getStatus(tabId);
  }


  public async closeAll(): Promise<void> {
    this.activeTakeovers.clear();
    await this.sessionManager.closeAll();
  }
}
