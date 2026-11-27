/**
 * Descoberta de binário Chromium/Chrome/Edge, pool de BrowserContext persistentes com proxy,
 * screencast JPEG por CDPSession com backpressure (<= 8 fps) e dispatch de input humano (BRWS-01, BRWS-02).
 * Auto-unload seletivo de abas ociosas sob pressão de RAM com recarga transparente (SCALE41-01).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext, CDPSession, Dialog, Page } from "playwright-core";
import type { BrowserTabSummary } from "@criativo/contracts";
import {
  assertLoopbackCdpEndpoint,
  NativeCdpBrowserSession,
} from "./browser-native-cdp.ts";
import type { SnapshotRefMeta } from "./browser-snapshot.ts";
import {
  type BrowserMemoryHostReader,
  type MemoryPressureLevel,
  closeContextIfNoLoadedPages,
  executeNonDestructiveTabUnload,
  rehydrateUnloadedTabEntry,
  runMemoryPressureUnloadSweep,
} from "./browser/browser-tab-unload.ts";

export const CONTEXT_IDLE_TTL_MS = 15 * 60_000;
export const MIN_SCREENCAST_FRAME_INTERVAL_MS = 125; // <= 8 fps

export interface ChromiumDetectionResult {
  available: boolean;
  executablePath: string | null;
  reason?: string;
}

export interface LaunchProfileContextOptions {
  perfilId: string;
  userDataDir: string;
  cdpUrl?: string | null;
  headless?: boolean;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  } | null;
}

export interface ManagedTabEntry {
  tabId: string;
  perfilId: string;
  agenteId: string | null;
  page: Page | null;
  cdpSession: CDPSession | null;
  revision: number;
  snapshotRefs: Map<string, SnapshotRefMeta>;
  lastDialog: { type: string; message: string; defaultValue: string } | null;
  pendingDialogObj: Dialog | null;
  userControl: boolean;
  screencastActive: boolean;
  screencastTimer: ReturnType<typeof setInterval> | null;
  lastFrameSentAt: number;
  teachRecording: boolean;
  teachStartedAt: number | null;
  lastActivityAt: number;
  virtualUrl: string;
  virtualTitle: string;
  userDataDir: string;
  unloaded: boolean;
  unloadedAt: number | null;
  unloadReason: string | null;
  suppressCloseCleanup?: boolean;
  onPageNavigated?: (tab: ManagedTabEntry, url: string, title: string) => void;
}

export interface HumanCdpInputEvent {
  type:
    | "mousePressed"
    | "mouseReleased"
    | "mouseMoved"
    | "mouseWheel"
    | "wheel"
    | "keyDown"
    | "keyUp"
    | "insertText";
  x?: number;
  y?: number;
  button?: "left" | "middle" | "right" | "none";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

/**
 * Localiza um executável compatível com Chrome DevTools Protocol no host atual sem quebrar se ausente.
 */
export function detectChromiumExecutable(workspaceRoot: string): ChromiumDetectionResult {
  if (process.env.CRIATIVO_DISABLE_CHROMIUM === "1") {
    return {
      available: false,
      executablePath: null,
      reason: "Execução Chromium desativada explicitamente via CRIATIVO_DISABLE_CHROMIUM=1.",
    };
  }

  const envPath = process.env.CRIATIVO_CHROMIUM_PATH?.trim();
  if (envPath && existsSync(envPath)) {
    return { available: true, executablePath: envPath };
  }

  const managedDir = resolve(workspaceRoot, "dados", "browser-runtime");
  const candidates: string[] = [
    join(managedDir, "chrome-linux", "chrome"),
    join(managedDir, "chrome-win", "chrome.exe"),
    // Linux / VPS
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ...(process.env.LOCALAPPDATA
      ? [
          join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
          join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]
      : []),
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return { available: true, executablePath: candidate };
    }
  }

  return {
    available: false,
    executablePath: null,
    reason:
      "Nenhum executável Chromium/Chrome/Edge foi encontrado no sistema. Defina CRIATIVO_CHROMIUM_PATH ou instale o pacote chromium no host.",
  };
}

export class BrowserCdpSessionManager {
  private readonly workspaceRoot: string;
  private readonly contexts = new Map<
    string,
    { context: BrowserContext; proxySignature: string; lastUsedAt: number }
  >();
  private readonly tabs = new Map<string, ManagedTabEntry>();
  private readonly idleSweepTimer: ReturnType<typeof setInterval>;
  private memoryReader?: BrowserMemoryHostReader;
  private onTabUnloadedCb?: (
    tab: ManagedTabEntry,
    pressureLevel: "elevated" | "critical" | "manual",
  ) => void;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.idleSweepTimer = setInterval(() => {
      void this.sweepIdleContexts();
      void this.sweepMemoryPressureTabs();
    }, 60_000);
    this.idleSweepTimer.unref?.();
  }

  public setMemoryPressureReader(reader: BrowserMemoryHostReader): void {
    this.memoryReader = reader;
  }

  public getMemoryPressureLevel(): MemoryPressureLevel {
    return this.memoryReader ? this.memoryReader().level : "normal";
  }

  public setOnTabUnloaded(
    cb: (tab: ManagedTabEntry, pressureLevel: "elevated" | "critical" | "manual") => void,
  ): void {
    this.onTabUnloadedCb = cb;
  }

  public detectBinary(): ChromiumDetectionResult {
    return detectChromiumExecutable(this.workspaceRoot);
  }

  public getActiveContextCount(): number {
    return this.contexts.size;
  }

  public listTabSummaries(filterAgentId?: string): BrowserTabSummary[] {
    const out: BrowserTabSummary[] = [];
    for (const entry of this.tabs.values()) {
      if (filterAgentId && entry.agenteId !== filterAgentId) continue;
      out.push({
        tabId: entry.tabId,
        perfilId: entry.perfilId,
        agenteId: entry.agenteId,
        url: entry.page ? entry.page.url() : entry.virtualUrl,
        title: entry.virtualTitle,
        revision: entry.revision,
        userControl: entry.userControl,
        screencastActive: entry.screencastActive,
        lastActivityAt: new Date(entry.lastActivityAt).toISOString(),
        unloaded: entry.unloaded || undefined,
        unloadedAt: entry.unloadedAt ? new Date(entry.unloadedAt).toISOString() : undefined,
        unloadReason: entry.unloadReason ?? undefined,
      });
    }
    return out;
  }

  public getTab(tabId: string): ManagedTabEntry | null {
    return this.tabs.get(tabId) ?? null;
  }

  public countProfileTabs(perfilId: string): number {
    let count = 0;
    for (const t of this.tabs.values()) {
      if (t.perfilId === perfilId) count += 1;
    }
    return count;
  }

  private buildSafeLaunchArgs(): string[] {
    const args = [
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-popup-blocking",
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    return args;
  }

  public async ensurePersistentContext(opts: LaunchProfileContextOptions): Promise<BrowserContext> {
    const wantsHeadless =
      opts.headless ?? (process.env.CRIATIVO_BROWSER_HEADLESS !== "0");
    const cdpSig = opts.cdpUrl ? `cdp:${opts.cdpUrl}` : "spawn";
    const proxySig = `${cdpSig}|${wantsHeadless ? "headless" : "headed"}|${
      opts.proxy ? `${opts.proxy.server}|${opts.proxy.username ?? ""}` : "direct"
    }`;

    const existing = this.contexts.get(opts.perfilId);
    if (existing && existing.proxySignature === proxySig) {
      existing.lastUsedAt = Date.now();
      return existing.context;
    }

    if (existing) {
      await this.closeProfileContext(opts.perfilId);
    }

    if (opts.cdpUrl && opts.cdpUrl.trim()) {
      const safeEndpoint = assertLoopbackCdpEndpoint(opts.cdpUrl);
      const nativeExisting = await NativeCdpBrowserSession.connectExisting(safeEndpoint);
      const context = nativeExisting as unknown as BrowserContext;
      this.contexts.set(opts.perfilId, {
        context,
        proxySignature: proxySig,
        lastUsedAt: Date.now(),
      });
      return context;
    }

    const detected = this.detectBinary();
    if (!detected.available || !detected.executablePath) {
      throw new Error(
        detected.reason ?? "Chromium não disponível neste host para iniciar contexto CDP.",
      );
    }

    mkdirSync(opts.userDataDir, { recursive: true });

    const preferNative = process.env.CRIATIVO_BROWSER_DRIVER !== "playwright";
    const pw = preferNative ? null : await import("playwright-core").catch(() => null);

    let context: BrowserContext;
    if (pw) {
      context = await pw.chromium.launchPersistentContext(opts.userDataDir, {
        executablePath: detected.executablePath,
        headless: wantsHeadless,
        args: this.buildSafeLaunchArgs(),
        viewport: { width: 1280, height: 800 },
        ...(opts.proxy?.server
          ? {
              proxy: {
                server: opts.proxy.server,
                ...(opts.proxy.username ? { username: opts.proxy.username } : {}),
                ...(opts.proxy.password ? { password: opts.proxy.password } : {}),
              },
            }
          : {}),
      });
    } else {
      const nativeSession = await NativeCdpBrowserSession.launch({
        executablePath: detected.executablePath,
        userDataDir: opts.userDataDir,
        headless: wantsHeadless,
        args: this.buildSafeLaunchArgs(),
        proxy: opts.proxy ?? null,
      });
      context = nativeSession as unknown as BrowserContext;
    }

    this.contexts.set(opts.perfilId, {
      context,
      proxySignature: proxySig,
      lastUsedAt: Date.now(),
    });
    return context;
  }

  public async openTab(params: {
    perfilId: string;
    userDataDir: string;
    agenteId: string | null;
    url: string;
    cdpUrl?: string | null;
    headless?: boolean;
    proxy?: LaunchProfileContextOptions["proxy"];
    onPageNavigated?: (tab: ManagedTabEntry, url: string, title: string) => void;
  }): Promise<ManagedTabEntry> {
    const context = await this.ensurePersistentContext({
      perfilId: params.perfilId,
      userDataDir: params.userDataDir,
      cdpUrl: params.cdpUrl,
      headless: params.headless,
      proxy: params.proxy,
    });

    const page = await context.newPage();
    const cdpSession = await context.newCDPSession(page);
    const tabId = `tab-${randomUUID().slice(0, 8)}`;

    const entry: ManagedTabEntry = {
      tabId,
      perfilId: params.perfilId,
      agenteId: params.agenteId,
      page,
      cdpSession,
      revision: 1,
      snapshotRefs: new Map(),
      lastDialog: null,
      pendingDialogObj: null,
      userControl: false,
      screencastActive: false,
      screencastTimer: null,
      lastFrameSentAt: 0,
      teachRecording: false,
      teachStartedAt: null,
      lastActivityAt: Date.now(),
      virtualUrl: params.url,
      virtualTitle: "",
      userDataDir: params.userDataDir,
      unloaded: false,
      unloadedAt: null,
      unloadReason: null,
      onPageNavigated: params.onPageNavigated,
    };

    this.attachPageListeners(entry, page);
    this.tabs.set(tabId, entry);
    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    entry.virtualUrl = page.url();
    entry.virtualTitle = await page.title().catch(() => "");
    entry.lastActivityAt = Date.now();

    return entry;
  }

  private attachPageListeners(entry: ManagedTabEntry, page: Page): void {
    page.on("dialog", (dialog) => {
      entry.lastDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
      };
      entry.pendingDialogObj = dialog;
    });
    page.on("framenavigated", async (frame) => {
      if (frame === page.mainFrame()) {
        entry.revision += 1;
        entry.lastActivityAt = Date.now();
        entry.virtualUrl = frame.url();
        entry.virtualTitle = await page.title().catch(() => "");
        entry.onPageNavigated?.(entry, entry.virtualUrl, entry.virtualTitle);
      }
    });
    page.on("close", () => {
      if (entry.suppressCloseCleanup) return;
      if (entry.screencastTimer) clearInterval(entry.screencastTimer);
      this.tabs.delete(entry.tabId);
    });
  }

  /**
   * Cria uma aba virtual leve quando o host não possui binário Chromium instalado,
   * permitindo exercitar a máquina de estados de Takeover e Teach sem falhar por falta de GUI/browser.
   */
  public createVirtualTab(params: {
    perfilId: string;
    agenteId: string | null;
    url: string;
    title?: string;
  }): ManagedTabEntry {
    const tabId = `tab-${randomUUID().slice(0, 8)}`;
    const entry: ManagedTabEntry = {
      tabId,
      perfilId: params.perfilId,
      agenteId: params.agenteId,
      page: null,
      cdpSession: null,
      revision: 1,
      snapshotRefs: new Map(),
      lastDialog: null,
      pendingDialogObj: null,
      userControl: false,
      screencastActive: false,
      screencastTimer: null,
      lastFrameSentAt: 0,
      teachRecording: false,
      teachStartedAt: null,
      lastActivityAt: Date.now(),
      virtualUrl: params.url,
      virtualTitle: params.title ?? "Sessão de Navegador",
      userDataDir: "",
      unloaded: false,
      unloadedAt: null,
      unloadReason: null,
    };
    this.tabs.set(tabId, entry);
    return entry;
  }

  public async captureAndEmitFrame(
    tabId: string,
    onFrame: (frame: {
      tabId: string;
      dataUrl: string;
      width: number;
      height: number;
      url: string;
      title: string;
      userControl: boolean;
    }) => void,
  ): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || !entry.page) return;
    try {
      const buf = await entry.page.screenshot({ type: "jpeg", quality: 72 });
      const vp = entry.page.viewportSize() ?? { width: 1280, height: 800 };
      entry.virtualUrl = entry.page.url();
      entry.virtualTitle = await entry.page.title().catch(() => entry.virtualTitle);
      entry.lastFrameSentAt = Date.now();
      onFrame({
        tabId: entry.tabId,
        dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
        width: vp.width,
        height: vp.height,
        url: entry.virtualUrl,
        title: entry.virtualTitle,
        userControl: entry.userControl,
      });
    } catch {
      // Ignora falha transitória durante navegação inicial
    }
  }

  public async startScreencast(
    tabId: string,
    onFrame: (frame: {
      tabId: string;
      dataUrl: string;
      width: number;
      height: number;
      url: string;
      title: string;
      userControl: boolean;
    }) => void,
    fpsIntervalMs = MIN_SCREENCAST_FRAME_INTERVAL_MS,
  ): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.screencastActive) return;

    entry.screencastActive = true;
    entry.lastActivityAt = Date.now();
    const minInterval = Math.max(MIN_SCREENCAST_FRAME_INTERVAL_MS, fpsIntervalMs);

    const emitThrottled = (base64Jpeg: string, width = 1280, height = 800): void => {
      const now = Date.now();
      if (now - entry.lastFrameSentAt < minInterval) {
        return; // Backpressure: descarta quadros intermediários acima do limite configurado
      }
      entry.lastFrameSentAt = now;
      onFrame({
        tabId: entry.tabId,
        dataUrl: `data:image/jpeg;base64,${base64Jpeg}`,
        width,
        height,
        url: entry.page ? entry.page.url() : entry.virtualUrl,
        title: entry.virtualTitle,
        userControl: entry.userControl,
      });
    };

    if (entry.cdpSession && entry.page) {
      await this.captureAndEmitFrame(tabId, onFrame);

      try {
        entry.cdpSession.on("Page.screencastFrame", async (payload: {
          data: string;
          sessionId: number;
          metadata?: { deviceWidth?: number; deviceHeight?: number };
        }) => {
          if (!entry.screencastActive) return;
          await entry.cdpSession
            ?.send("Page.screencastFrameAck", { sessionId: payload.sessionId })
            .catch(() => {});
          emitThrottled(
            payload.data,
            payload.metadata?.deviceWidth ?? 1280,
            payload.metadata?.deviceHeight ?? 800,
          );
        });

        await entry.cdpSession.send("Page.startScreencast", {
          format: "jpeg",
          quality: 72,
          maxWidth: 1280,
          maxHeight: 800,
          everyNthFrame: 2,
        });
      } catch {
        // Segue com fallback de polling abaixo
      }

      // Fallback periódico caso páginas estáticas em headless não emitam quadros contínuos
      entry.screencastTimer = setInterval(async () => {
        if (!entry.screencastActive || !entry.page) return;
        if (Date.now() - entry.lastFrameSentAt < 420) return;
        try {
          const buf = await entry.page.screenshot({ type: "jpeg", quality: 70 });
          const vp = entry.page.viewportSize() ?? { width: 1280, height: 800 };
          entry.virtualTitle = await entry.page.title().catch(() => entry.virtualTitle);
          emitThrottled(buf.toString("base64"), vp.width, vp.height);
        } catch {
          // Ignora falha transitória de captura
        }
      }, 450);
      entry.screencastTimer.unref?.();
    }
  }

  public async stopScreencast(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    entry.screencastActive = false;
    if (entry.screencastTimer) {
      clearInterval(entry.screencastTimer);
      entry.screencastTimer = null;
    }
    if (entry.cdpSession) {
      await entry.cdpSession.send("Page.stopScreencast").catch(() => {});
    }
  }

  public async dispatchHumanInput(tabId: string, event: HumanCdpInputEvent): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    entry.lastActivityAt = Date.now();

    if (!entry.cdpSession) {
      return;
    }

    if (
      event.type === "mousePressed" ||
      event.type === "mouseReleased" ||
      event.type === "mouseMoved"
    ) {
      await entry.cdpSession.send("Input.dispatchMouseEvent", {
        type: event.type,
        x: Math.max(0, Math.round(event.x ?? 0)),
        y: Math.max(0, Math.round(event.y ?? 0)),
        button: event.button ?? "left",
        clickCount: event.clickCount ?? 1,
        modifiers: event.modifiers ?? 0,
      });
      return;
    }

    if (event.type === "wheel" || event.type === "mouseWheel") {
      await entry.cdpSession.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.max(0, Math.round(event.x ?? 0)),
        y: Math.max(0, Math.round(event.y ?? 0)),
        deltaX: Math.round(event.deltaX ?? 0),
        deltaY: Math.round(event.deltaY ?? 0),
      });
      return;
    }

    if (event.type === "insertText" && typeof event.text === "string") {
      await entry.cdpSession.send("Input.insertText", { text: event.text });
      return;
    }

    if (event.type === "keyDown" || event.type === "keyUp") {
      await entry.cdpSession.send("Input.dispatchKeyEvent", {
        type: event.type,
        key: event.key ?? "",
        code: event.code ?? "",
        text: event.type === "keyDown" && event.text ? event.text : undefined,
        modifiers: event.modifiers ?? 0,
      });
    }
  }

  public async closeTab(tabId: string): Promise<boolean> {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;
    await this.stopScreencast(tabId);
    this.tabs.delete(tabId);
    if (entry.page) {
      await entry.page.close().catch(() => {});
    }
    return true;
  }

  public async closeProfileContext(perfilId: string): Promise<number> {
    let closedTabs = 0;
    for (const [id, tab] of this.tabs.entries()) {
      if (tab.perfilId === perfilId) {
        await this.closeTab(id);
        closedTabs += 1;
      }
    }
    const ctxEntry = this.contexts.get(perfilId);
    if (ctxEntry) {
      this.contexts.delete(perfilId);
      await ctxEntry.context.close().catch(() => {});
    }
    return closedTabs;
  }

  private async sweepIdleContexts(): Promise<void> {
    const now = Date.now();
    for (const [perfilId, ctxEntry] of this.contexts.entries()) {
      let latestTabActivity = ctxEntry.lastUsedAt;
      let hasActiveTakeover = false;
      for (const tab of this.tabs.values()) {
        if (tab.perfilId === perfilId) {
          latestTabActivity = Math.max(latestTabActivity, tab.lastActivityAt);
          if (tab.userControl || tab.screencastActive) {
            hasActiveTakeover = true;
          }
        }
      }
      if (!hasActiveTakeover && now - latestTabActivity > CONTEXT_IDLE_TTL_MS) {
        await this.closeProfileContext(perfilId);
      }
    }
  }

  public async unloadTab(
    tabId: string,
    reason = "Pressão de memória",
    pressureLevel: "elevated" | "critical" | "manual" = "manual",
  ): Promise<boolean> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.unloaded) return false;
    await executeNonDestructiveTabUnload(entry, reason, (id) => this.stopScreencast(id));
    await closeContextIfNoLoadedPages(entry.perfilId, Array.from(this.tabs.values()), this.contexts);
    this.onTabUnloadedCb?.(entry, pressureLevel);
    return true;
  }

  public async sweepMemoryPressureTabs(
    forceLevel?: "elevated" | "critical",
    options?: { elevatedIdleMs?: number; criticalIdleMs?: number; maxUnloadPerSweep?: number; nowMs?: number },
  ): Promise<string[]> {
    return await runMemoryPressureUnloadSweep({
      tabs: this.tabs,
      level: forceLevel ?? this.getMemoryPressureLevel(),
      options,
      unloadById: (id, reason, lvl) => this.unloadTab(id, reason, lvl),
    });
  }

  public async reloadUnloadedTab(
    tabId: string,
    resolveLaunchOpts: (entry: ManagedTabEntry) => LaunchProfileContextOptions,
  ): Promise<ManagedTabEntry> {
    const entry = this.tabs.get(tabId);
    if (!entry) throw new Error(`Aba '${tabId}' não encontrada para recarga.`);
    if (entry.page && !entry.unloaded) return entry;
    return await rehydrateUnloadedTabEntry(
      entry,
      async () => {
        const context = await this.ensurePersistentContext(resolveLaunchOpts(entry));
        const page = await context.newPage();
        const cdpSession = await context.newCDPSession(page);
        return { page, cdpSession };
      },
      (t, p) => this.attachPageListeners(t, p),
    );
  }

  public async closeAll(): Promise<void> {
    clearInterval(this.idleSweepTimer);
    for (const tabId of Array.from(this.tabs.keys())) {
      await this.closeTab(tabId);
    }
    for (const [perfilId, entry] of this.contexts.entries()) {
      this.contexts.delete(perfilId);
      await entry.context.close().catch(() => {});
    }
  }
}
