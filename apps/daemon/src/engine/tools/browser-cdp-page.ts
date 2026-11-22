import {
  CdpWebSocketClient,
  DEFAULT_VIEWPORT,
  KEY_CODE_MAP,
} from "./browser-cdp-websocket.ts";
import { NativeCdpLocator } from "./browser-cdp-locator.ts";

export class NativeCdpPage {
  private readonly targetId: string;
  private readonly httpBaseUrl: string;
  private readonly cdp: CdpWebSocketClient;
  private currentUrl: string;
  private currentTitle = "";
  private viewport = { ...DEFAULT_VIEWPORT };
  private readonly mainFrameSentinel: { url: () => string };
  private readonly pageListeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(params: {
    targetId: string;
    httpBaseUrl: string;
    initialUrl: string;
    cdp: CdpWebSocketClient;
  }) {
    this.targetId = params.targetId;
    this.httpBaseUrl = params.httpBaseUrl;
    this.currentUrl = params.initialUrl;
    this.cdp = params.cdp;
    this.mainFrameSentinel = {
      url: () => this.currentUrl,
    };
  }

  public async init(): Promise<void> {
    await Promise.all([
      this.cdp.send("Page.enable").catch(() => {}),
      this.cdp.send("Runtime.enable").catch(() => {}),
      this.cdp.send("DOM.enable").catch(() => {}),
      this.cdp.send("Network.enable").catch(() => {}),
    ]);
    await this.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    try {
      const ver = await this.cdp.send<{ userAgent?: string }>("Browser.getVersion");
      const rawUa = typeof ver?.userAgent === "string" ? ver.userAgent : "";
      if (rawUa.includes("HeadlessChrome/")) {
        await this.cdp.send("Network.setUserAgentOverride", {
          userAgent: rawUa.replace(/HeadlessChrome\//g, "Chrome/"),
          acceptLanguage: "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        });
      }
    } catch {
      // Fallback silencioso caso o endpoint CDP não exponha Browser.getVersion
    }
    await this.setViewportSize(DEFAULT_VIEWPORT).catch(() => {});

    this.cdp.on("Page.frameNavigated", (payload: { frame?: { parentId?: string; url?: string } }) => {
      const frame = payload.frame;
      if (frame && !frame.parentId && typeof frame.url === "string") {
        this.currentUrl = frame.url;
        this.emit("framenavigated", this.mainFrameSentinel);
      }
    });

    this.cdp.on(
      "Page.javascriptDialogOpening",
      (payload: { type?: string; message?: string; defaultPrompt?: string }) => {
        const dlg = {
          type: () => payload.type ?? "alert",
          message: () => payload.message ?? "",
          defaultValue: () => payload.defaultPrompt ?? "",
          accept: async (promptText?: string) => {
            await this.cdp.send("Page.handleJavaScriptDialog", {
              accept: true,
              ...(promptText !== undefined ? { promptText } : {}),
            });
          },
          dismiss: async () => {
            await this.cdp.send("Page.handleJavaScriptDialog", { accept: false });
          },
        };
        this.emit("dialog", dlg);
      },
    );

    this.cdp.on("__ws_close__", () => {
      this.emit("close");
    });
  }

  public getCdpSession(): CdpWebSocketClient {
    return this.cdp;
  }

  public mainFrame(): { url: () => string } {
    return this.mainFrameSentinel;
  }

  public url(): string {
    return this.currentUrl;
  }

  public viewportSize(): { width: number; height: number } {
    return { ...this.viewport };
  }

  public async title(): Promise<string> {
    try {
      const res = await this.evaluate(() => {
        const g = globalThis as unknown as { document?: { title?: string } };
        return g.document?.title ?? "";
      });
      this.currentTitle = typeof res === "string" ? res : "";
    } catch {
      // mantém cache atual se página estiver em transição
    }
    return this.currentTitle;
  }

  public on(eventName: string, listener: (...args: any[]) => void): this {
    let set = this.pageListeners.get(eventName);
    if (!set) {
      set = new Set();
      this.pageListeners.set(eventName, set);
    }
    set.add(listener);
    return this;
  }

  public off(eventName: string, listener: (...args: any[]) => void): this {
    this.pageListeners.get(eventName)?.delete(listener);
    return this;
  }

  private emit(eventName: string, ...args: any[]): void {
    const set = this.pageListeners.get(eventName);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(...args);
      } catch {
        // ignora erro de listener
      }
    }
  }

  public async goto(
    targetUrl: string,
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number },
  ): Promise<void> {
    const timeoutMs = Math.max(1000, opts?.timeout ?? 25_000);
    const waitKind = opts?.waitUntil ?? "load";
    let loaded = false;

    const onLoaded = () => {
      loaded = true;
    };
    this.cdp.on("Page.loadEventFired", onLoaded);
    if (waitKind === "domcontentloaded") {
      this.cdp.on("Page.domContentEventFired", onLoaded);
    }

    try {
      const navRes = await this.cdp.send<{ errorText?: string }>(
        "Page.navigate",
        { url: targetUrl },
        timeoutMs,
      );
      if (navRes?.errorText) {
        throw new Error(`Falha ao navegar para '${targetUrl}': ${navRes.errorText}`);
      }
      this.currentUrl = targetUrl;

      const deadline = Date.now() + timeoutMs;
      while (!loaded && Date.now() < deadline) {
        const ready = await this.evaluate(() => {
          const g = globalThis as unknown as {
            document?: { readyState?: string };
            location?: { href?: string };
          };
          return {
            readyState: g.document?.readyState ?? "loading",
            href: g.location?.href ?? "",
          };
        }).catch(() => null);

        if (ready?.href && ready.href !== "about:blank") {
          this.currentUrl = ready.href;
        }
        if (
          ready &&
          (waitKind === "domcontentloaded"
            ? ready.readyState === "interactive" || ready.readyState === "complete"
            : ready.readyState === "complete")
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      this.currentTitle = await this.title();
      this.emit("framenavigated", this.mainFrameSentinel);
    } finally {
      this.cdp.off("Page.loadEventFired", onLoaded);
      this.cdp.off("Page.domContentEventFired", onLoaded);
    }
  }

  public async evaluate<R = unknown, A = unknown>(
    fnOrExpression: ((arg: A) => R) | (() => R) | string,
    arg?: A,
  ): Promise<R> {
    const expression =
      typeof fnOrExpression === "function"
        ? `((function(){ var __name = function(fn){ return fn; }; return (${fnOrExpression.toString()}); })())(${arg === undefined ? "" : JSON.stringify(arg)})`
        : String(fnOrExpression);

    const out = await this.cdp.send<{
      result?: { value?: R; description?: string };
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string; value?: unknown };
      };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (out?.exceptionDetails) {
      const msg =
        out.exceptionDetails.exception?.description ||
        out.exceptionDetails.text ||
        "Erro ao executar script na página via CDP.";
      throw new Error(msg);
    }
    return out?.result?.value as R;
  }

  public async goBack(): Promise<boolean> {
    const hist = await this.cdp.send<{
      currentIndex?: number;
      entries?: Array<{ id?: number; url?: string; title?: string }>;
    }>("Page.getNavigationHistory");
    const idx = typeof hist?.currentIndex === "number" ? hist.currentIndex : 0;
    const prevEntry = idx > 0 ? hist?.entries?.[idx - 1] : undefined;
    if (!prevEntry?.id) return false;
    await this.cdp.send("Page.navigateToHistoryEntry", { entryId: prevEntry.id });
    if (prevEntry.url) this.currentUrl = prevEntry.url;
    if (prevEntry.title) this.currentTitle = prevEntry.title;
    this.emit("framenavigated", this.mainFrameSentinel);
    return true;
  }

  public async goForward(): Promise<boolean> {
    const hist = await this.cdp.send<{
      currentIndex?: number;
      entries?: Array<{ id?: number; url?: string; title?: string }>;
    }>("Page.getNavigationHistory");
    const idx = typeof hist?.currentIndex === "number" ? hist.currentIndex : 0;
    const nextEntry = hist?.entries?.[idx + 1];
    if (!nextEntry?.id) return false;
    await this.cdp.send("Page.navigateToHistoryEntry", { entryId: nextEntry.id });
    if (nextEntry.url) this.currentUrl = nextEntry.url;
    if (nextEntry.title) this.currentTitle = nextEntry.title;
    this.emit("framenavigated", this.mainFrameSentinel);
    return true;
  }

  public async reload(): Promise<void> {
    await this.cdp.send("Page.reload", { ignoreCache: false });
    await this.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
    this.currentTitle = await this.title();
    this.emit("framenavigated", this.mainFrameSentinel);
  }

  public async screenshot(opts?: {
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const format = opts?.type === "jpeg" ? "jpeg" : "png";
    const res = await this.cdp.send<{ data?: string }>("Page.captureScreenshot", {
      format,
      fromSurface: true,
      ...(format === "jpeg" ? { quality: opts?.quality ?? 75 } : {}),
    });
    if (!res?.data) {
      throw new Error("Captura CDP não retornou bytes de imagem.");
    }
    return Buffer.from(res.data, "base64");
  }

  public async setViewportSize(size: { width: number; height: number }): Promise<void> {
    this.viewport = { width: size.width, height: size.height };
    await this.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  public async emulateMedia(opts: { colorScheme?: "dark" | "light" }): Promise<void> {
    if (!opts.colorScheme) return;
    await this.cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: opts.colorScheme }],
    });
  }

  public async waitForURL(pattern: string, opts?: { timeout?: number }): Promise<void> {
    const cleanNeedle = pattern.replace(/^\*\*\/\*|\*$/g, "");
    const deadline = Date.now() + Math.max(500, opts?.timeout ?? 10_000);
    while (Date.now() < deadline) {
      const href = await this.evaluate(() => {
        const g = globalThis as unknown as { location?: { href?: string } };
        return g.location?.href ?? "";
      }).catch(() => this.currentUrl);
      this.currentUrl = href || this.currentUrl;
      if (!cleanNeedle || this.currentUrl.includes(cleanNeedle)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timeout aguardando URL contendo '${cleanNeedle}'.`);
  }

  public async waitForLoadState(
    _state: "load" | "domcontentloaded" | "networkidle" = "load",
    opts?: { timeout?: number },
  ): Promise<void> {
    const deadline = Date.now() + Math.max(400, opts?.timeout ?? 10_000);
    while (Date.now() < deadline) {
      const readyState = await this.evaluate(() => {
        const g = globalThis as unknown as { document?: { readyState?: string } };
        return g.document?.readyState ?? "loading";
      }).catch(() => "loading");
      if (readyState === "complete") return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  public locator(selector: string): NativeCdpLocator {
    return new NativeCdpLocator(this, { kind: "css", selector, nth: 0 });
  }

  public getByRole(
    role: string,
    opts?: { name?: string; exact?: boolean },
  ): NativeCdpLocator {
    return new NativeCdpLocator(this, {
      kind: "role",
      role,
      name: opts?.name,
      exact: opts?.exact,
      nth: 0,
    });
  }

  public getByText(text: string, opts?: { exact?: boolean }): NativeCdpLocator {
    return new NativeCdpLocator(this, {
      kind: "text",
      text,
      exact: opts?.exact,
      nth: 0,
    });
  }

  public readonly mouse = {
    click: async (x: number, y: number): Promise<void> => {
      const rx = Math.max(0, Math.round(x));
      const ry = Math.max(0, Math.round(y));
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: rx,
        y: ry,
        button: "none",
      });
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: rx,
        y: ry,
        button: "left",
        clickCount: 1,
      });
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: rx,
        y: ry,
        button: "left",
        clickCount: 1,
      });
    },
    move: async (x: number, y: number, opts?: { steps?: number }): Promise<void> => {
      const steps = Math.max(1, opts?.steps ?? 1);
      for (let i = 1; i <= steps; i += 1) {
        await this.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          button: "none",
        });
      }
    },
    down: async (): Promise<void> => {
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 0,
        y: 0,
        button: "left",
        clickCount: 1,
      });
    },
    up: async (): Promise<void> => {
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 0,
        y: 0,
        button: "left",
        clickCount: 1,
      });
    },
    wheel: async (deltaX: number, deltaY: number): Promise<void> => {
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.round(this.viewport.width / 2),
        y: Math.round(this.viewport.height / 2),
        deltaX: Math.round(deltaX),
        deltaY: Math.round(deltaY),
      });
    },
  };

  public readonly keyboard = {
    press: async (key: string): Promise<void> => {
      const meta = KEY_CODE_MAP[key];
      const code = meta?.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
      const vk = meta?.keyCode ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      const text = meta?.text ?? (key.length === 1 ? key : undefined);
      await this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        ...(text ? { text } : {}),
      });
      await this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
      });
    },
    down: async (key: string): Promise<void> => {
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
    },
    up: async (key: string): Promise<void> => {
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
    },
    type: async (text: string): Promise<void> => {
      await this.cdp.send("Input.insertText", { text });
    },
  };

  public async close(): Promise<void> {
    try {
      await fetch(`${this.httpBaseUrl}/json/close/${encodeURIComponent(this.targetId)}`, {
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // fallback se target já fechou
    }
    this.cdp.close();
    this.emit("close");
  }
}
