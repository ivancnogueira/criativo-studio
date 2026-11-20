import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer as createNetServer } from "node:net";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const KEY_CODE_MAP: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Space: { code: "Space", keyCode: 32, text: " " },
  " ": { code: "Space", keyCode: 32, text: " " },
};

/**
 * Valida estritamente endpoints CDP contra SSRF: permite apenas localhost / 127.0.0.1 / ::1
 * e portas válidas entre 1024 e 65535.
 */
export function assertLoopbackCdpEndpoint(rawUrlOrPort: string | number): string {
  if (typeof rawUrlOrPort === "number") {
    if (!Number.isInteger(rawUrlOrPort) || rawUrlOrPort < 1024 || rawUrlOrPort > 65535) {
      throw new Error(
        `Porta CDP inválida (${rawUrlOrPort}). Informe um inteiro entre 1024 e 65535.`,
      );
    }
    return `http://127.0.0.1:${rawUrlOrPort}`;
  }

  const trimmed = String(rawUrlOrPort ?? "").trim();
  if (!trimmed) {
    throw new Error("Endpoint CDP vazio.");
  }

  if (/^\d+$/.test(trimmed)) {
    return assertLoopbackCdpEndpoint(Number.parseInt(trimmed, 10));
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Endpoint CDP inválido: '${trimmed}'.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Protocolo '${parsed.protocol}' não permitido para anexo CDP. Use apenas http://127.0.0.1:<porta>.`,
    );
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostLower)) {
    throw new Error(
      `Anexo CDP recusado pela proteção anti-SSRF: host '${parsed.hostname}' não é loopback (use 127.0.0.1 ou localhost).`,
    );
  }

  const portNum = parsed.port ? Number.parseInt(parsed.port, 10) : 9222;
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    throw new Error(
      `Porta CDP inválida em '${trimmed}'. Informe uma porta entre 1024 e 65535.`,
    );
  }

  const normalizedHost = hostLower.includes(":") && !hostLower.startsWith("[")
    ? `[${hostLower}]`
    : hostLower;
  return `${parsed.protocol}//${normalizedHost}:${portNum}`;
}

async function findFreeLoopbackTcpPort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const srv = createNetServer();
    srv.unref();
    srv.once("error", rejectPort);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

export class CdpWebSocketClient {
  private readonly wsUrl: string;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (val: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly eventListeners = new Map<string, Set<(payload: any) => void>>();
  private closed = false;

  private constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  public static async connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpWebSocketClient> {
    if (typeof globalThis.WebSocket !== "function") {
      throw new Error(
        "WebSocket nativo indisponível neste runtime Node.js (Node 22+ requerido para driver CDP nativo).",
      );
    }
    const client = new CdpWebSocketClient(wsUrl);
    await client.open(timeoutMs);
    return client;
  }

  private open(timeoutMs: number): Promise<void> {
    return new Promise((resolveOpen, rejectOpen) => {
      const ws = new globalThis.WebSocket(this.wsUrl);
      this.socket = ws;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            // ignora
          }
          rejectOpen(new Error(`Timeout conectando ao WebSocket CDP '${this.wsUrl}'.`));
        }
      }, timeoutMs);

      ws.addEventListener("open", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolveOpen();
        }
      });

      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rejectOpen(new Error(`Falha ao conectar no WebSocket CDP '${this.wsUrl}'.`));
        }
      });

      ws.addEventListener("message", (evt) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (typeof msg.id === "number") {
          const wait = this.pending.get(msg.id);
          if (!wait) return;
          this.pending.delete(msg.id);
          clearTimeout(wait.timer);
          if (msg.error && typeof msg.error === "object") {
            const errObj = msg.error as { message?: string; code?: number };
            wait.reject(new Error(errObj.message || `Erro CDP (${errObj.code ?? -1})`));
          } else {
            wait.resolve(msg.result);
          }
          return;
        }

        if (typeof msg.method === "string") {
          const listeners = this.eventListeners.get(msg.method);
          if (listeners) {
            for (const fn of listeners) {
              try {
                fn(msg.params ?? {});
              } catch {
                // listener isolado não derruba despacho CDP
              }
            }
          }
        }
      });

      ws.addEventListener("close", () => {
        this.closed = true;
        for (const [id, wait] of this.pending.entries()) {
          clearTimeout(wait.timer);
          wait.reject(new Error("Conexão WebSocket CDP encerrada."));
          this.pending.delete(id);
        }
        const closeListeners = this.eventListeners.get("__ws_close__");
        if (closeListeners) {
          for (const fn of closeListeners) {
            try {
              fn({});
            } catch {
              // ignore
            }
          }
        }
      });
    });
  }

  public on(method: string, listener: (payload: any) => void): this {
    let set = this.eventListeners.get(method);
    if (!set) {
      set = new Set();
      this.eventListeners.set(method, set);
    }
    set.add(listener);
    return this;
  }

  public off(method: string, listener: (payload: any) => void): this {
    this.eventListeners.get(method)?.delete(listener);
    return this;
  }

  public async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    if (this.closed || !this.socket || this.socket.readyState !== globalThis.WebSocket.OPEN) {
      throw new Error(`Sessão CDP não está aberta para executar '${method}'.`);
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return await new Promise<T>((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`Timeout aguardando comando CDP '${method}'.`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        resolve: resolveSend as (val: unknown) => void,
        reject: rejectSend,
        timer,
      });

      try {
        this.socket!.send(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectSend(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public close(): void {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      // ignora
    }
    this.socket = null;
  }
}

interface NativeLocatorSpec {
  kind: "css" | "role" | "text";
  selector?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  text?: string;
  nth: number;
}

class NativeCdpLocator {
  private readonly page: NativeCdpPage;
  private readonly spec: NativeLocatorSpec;

  constructor(page: NativeCdpPage, spec: NativeLocatorSpec) {
    this.page = page;
    this.spec = spec;
  }

  public nth(index: number): NativeCdpLocator {
    return new NativeCdpLocator(this.page, { ...this.spec, nth: Math.max(0, index) });
  }

  public first(): NativeCdpLocator {
    return this.nth(0);
  }

  private async resolveElementCenter(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    tag: string;
  }> {
    return await this.page.evaluate(
      ({ spec }) => {
        const g = globalThis as unknown as {
          document: {
            querySelectorAll(s: string): ArrayLike<any>;
          };
          getComputedStyle(el: any): { display: string; visibility: string; opacity: string };
        };

        const isVisible = (el: any): boolean => {
          const st = g.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
            return false;
          }
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        };

        const inferRole = (el: any): string => {
          const explicit = el.getAttribute?.("role");
          if (explicit) return explicit;
          const tag = String(el.tagName || "").toLowerCase();
          if (tag === "a") return "link";
          if (tag === "button") return "button";
          if (tag === "select") return "combobox";
          if (tag === "textarea") return "textbox";
          if (tag === "input") {
            const tp = (el.getAttribute?.("type") || "text").toLowerCase();
            if (tp === "checkbox") return "checkbox";
            if (tp === "radio") return "radio";
            if (tp === "submit" || tp === "button") return "button";
            return "textbox";
          }
          return tag;
        };

        const accessibleName = (el: any): string =>
          String(
            el.getAttribute?.("aria-label") ||
              el.innerText ||
              el.textContent ||
              el.getAttribute?.("placeholder") ||
              el.getAttribute?.("title") ||
              el.value ||
              "",
          )
            .replace(/\s+/g, " ")
            .trim();

        let matches: any[] = [];
        if (spec.kind === "css" && spec.selector) {
          matches = Array.from(g.document.querySelectorAll(spec.selector));
        } else if (spec.kind === "role" && spec.role) {
          const candidates = Array.from(
            g.document.querySelectorAll(
              "a,button,input,select,textarea,[role],[contenteditable='true'],h1,h2,h3,h4,summary",
            ),
          );
          const wantedRole = spec.role.toLowerCase();
          matches = candidates.filter((el) => {
            if (inferRole(el).toLowerCase() !== wantedRole) return false;
            if (!spec.name) return true;
            const n = accessibleName(el).toLowerCase();
            const q = spec.name.toLowerCase();
            return spec.exact ? n === q : n.includes(q);
          });
        } else if (spec.kind === "text" && spec.text) {
          const all = Array.from(g.document.querySelectorAll("*")).filter((el) => {
            if (!isVisible(el)) return false;
            const txt = accessibleName(el).toLowerCase();
            const q = spec.text!.toLowerCase();
            return spec.exact ? txt === q : txt.includes(q);
          });
          // Prefere o elemento folha mais específico
          matches = all.filter((el) => !all.some((other) => other !== el && el.contains?.(other)));
          if (matches.length === 0) matches = all;
        }

        const picked = matches[spec.nth] ?? null;
        if (!picked) {
          throw new Error(
            `Elemento não encontrado no DOM (${spec.kind}:${spec.selector || spec.role || spec.text}[${spec.nth}]).`,
          );
        }

        picked.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
        const rect = picked.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          tag: String(picked.tagName || "").toLowerCase(),
        };
      },
      { spec: this.spec },
    );
  }

  private async runOnElement<R>(actionFn: (el: any, payload: any) => R, payload?: unknown): Promise<R> {
    const fnStr = actionFn.toString();
    return await this.page.evaluate(
      ({ spec, serializedFn, extraPayload }) => {
        const g = globalThis as unknown as {
          document: { querySelectorAll(s: string): ArrayLike<any> };
          getComputedStyle(el: any): { display: string; visibility: string; opacity: string };
        };
        const inferRole = (el: any): string => {
          const explicit = el.getAttribute?.("role");
          if (explicit) return explicit;
          const tag = String(el.tagName || "").toLowerCase();
          if (tag === "a") return "link";
          if (tag === "button") return "button";
          if (tag === "select") return "combobox";
          if (tag === "textarea") return "textbox";
          if (tag === "input") {
            const tp = (el.getAttribute?.("type") || "text").toLowerCase();
            if (tp === "checkbox") return "checkbox";
            if (tp === "radio") return "radio";
            if (tp === "submit" || tp === "button") return "button";
            return "textbox";
          }
          return tag;
        };
        const accessibleName = (el: any): string =>
          String(
            el.getAttribute?.("aria-label") ||
              el.innerText ||
              el.textContent ||
              el.getAttribute?.("placeholder") ||
              el.getAttribute?.("title") ||
              el.value ||
              "",
          )
            .replace(/\s+/g, " ")
            .trim();

        let matches: any[] = [];
        if (spec.kind === "css" && spec.selector) {
          matches = Array.from(g.document.querySelectorAll(spec.selector));
        } else if (spec.kind === "role" && spec.role) {
          const candidates = Array.from(
            g.document.querySelectorAll(
              "a,button,input,select,textarea,[role],[contenteditable='true'],h1,h2,h3,h4,summary",
            ),
          );
          const wantedRole = spec.role.toLowerCase();
          matches = candidates.filter((el) => {
            if (inferRole(el).toLowerCase() !== wantedRole) return false;
            if (!spec.name) return true;
            const n = accessibleName(el).toLowerCase();
            const q = spec.name.toLowerCase();
            return spec.exact ? n === q : n.includes(q);
          });
        } else if (spec.kind === "text" && spec.text) {
          const all = Array.from(g.document.querySelectorAll("*")).filter((el) => {
            const st = g.getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
              return false;
            }
            const txt = accessibleName(el).toLowerCase();
            const q = spec.text!.toLowerCase();
            return spec.exact ? txt === q : txt.includes(q);
          });
          matches = all.filter((el) => !all.some((other) => other !== el && el.contains?.(other)));
          if (matches.length === 0) matches = all;
        }

        const el = matches[spec.nth] ?? null;
        if (!el) {
          throw new Error(
            `Elemento não encontrado (${spec.kind}:${spec.selector || spec.role || spec.text}[${spec.nth}]).`,
          );
        }
        el.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
        const fn = (0, eval)(`(function(){ var __name = function(f){ return f; }; return (${serializedFn}); })()`);
        return fn(el, extraPayload);
      },
      { spec: this.spec, serializedFn: fnStr, extraPayload: payload ?? null },
    );
  }

  public async click(_opts?: { timeout?: number }): Promise<void> {
    const pt = await this.resolveElementCenter();
    if (pt.width > 0 && pt.height > 0) {
      await this.page.mouse.click(pt.x, pt.y);
      return;
    }
    await this.runOnElement((el) => {
      el.click?.();
    });
  }

  public async hover(_opts?: { timeout?: number }): Promise<void> {
    const pt = await this.resolveElementCenter();
    await this.page.mouse.move(pt.x, pt.y);
  }

  public async scrollIntoViewIfNeeded(_opts?: { timeout?: number }): Promise<void> {
    await this.resolveElementCenter();
  }

  public async fill(value: string, _opts?: { timeout?: number }): Promise<void> {
    await this.runOnElement((el, val: string) => {
      el.focus?.();
      const g = globalThis as unknown as {
        Event: new (t: string, o?: { bubbles?: boolean }) => unknown;
        HTMLInputElement?: { prototype?: object };
        HTMLTextAreaElement?: { prototype?: object };
      };
      if (el.isContentEditable) {
        el.textContent = val;
        el.dispatchEvent?.(new g.Event("input", { bubbles: true }));
        el.dispatchEvent?.(new g.Event("change", { bubbles: true }));
        return;
      }
      const tag = String(el.tagName || "").toLowerCase();
      const proto =
        tag === "textarea"
          ? g.HTMLTextAreaElement?.prototype
          : g.HTMLInputElement?.prototype;
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "value") : undefined;
      if (descriptor?.set) {
        descriptor.set.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent?.(new g.Event("input", { bubbles: true }));
      el.dispatchEvent?.(new g.Event("change", { bubbles: true }));
    }, value);
  }

  public async pressSequentially(value: string, _opts?: { timeout?: number }): Promise<void> {
    await this.runOnElement((el) => {
      el.focus?.();
    });
    await this.page.getCdpSession().send("Input.insertText", { text: value });
  }

  public async press(key: string, _opts?: { timeout?: number }): Promise<void> {
    await this.runOnElement((el) => {
      el.focus?.();
    });
    await this.page.keyboard.press(key);
  }

  public async selectOption(values: string | string[], _opts?: { timeout?: number }): Promise<void> {
    const list = Array.isArray(values) ? values : [values];
    await this.runOnElement((el, targetVals: string[]) => {
      const g = globalThis as unknown as {
        Event: new (t: string, o?: { bubbles?: boolean }) => unknown;
      };
      const options = Array.from(el.options ?? []) as Array<{
        value: string;
        text: string;
        selected: boolean;
      }>;
      let matched = false;
      for (const opt of options) {
        const hit = targetVals.includes(opt.value) || targetVals.includes(opt.text?.trim());
        opt.selected = hit;
        if (hit) matched = true;
      }
      if (!matched && targetVals[0] !== undefined) {
        el.value = targetVals[0];
      }
      el.dispatchEvent?.(new g.Event("input", { bubbles: true }));
      el.dispatchEvent?.(new g.Event("change", { bubbles: true }));
    }, list);
  }

  public async setChecked(checked: boolean, _opts?: { timeout?: number }): Promise<void> {
    const currentlyChecked = await this.runOnElement((el) => Boolean(el.checked));
    if (currentlyChecked !== Boolean(checked)) {
      await this.click();
    }
  }

  public async dragTo(target: NativeCdpLocator, _opts?: { timeout?: number }): Promise<void> {
    const fromPt = await this.resolveElementCenter();
    const toPt = await target.resolveElementCenter();
    await this.page.mouse.move(fromPt.x, fromPt.y);
    await this.page.mouse.down();
    await this.page.mouse.move(toPt.x, toPt.y, { steps: 8 });
    await this.page.mouse.up();
  }

  public async setInputFiles(files: string[], _opts?: { timeout?: number }): Promise<void> {
    const cdp = this.page.getCdpSession();
    const markerAttr = `data-criativo-upload-${Date.now()}`;
    await this.runOnElement((el, attr: string) => {
      el.setAttribute(attr, "1");
    }, markerAttr);

    const doc = await cdp.send<{ root?: { nodeId?: number } }>("DOM.getDocument", { depth: -1 });
    const rootNodeId = doc.root?.nodeId;
    if (!rootNodeId) {
      throw new Error("DOM root indisponível para upload_files.");
    }
    const found = await cdp.send<{ nodeId?: number }>("DOM.querySelector", {
      nodeId: rootNodeId,
      selector: `[${markerAttr}="1"]`,
    });
    if (!found.nodeId) {
      throw new Error("Input de arquivo não localizado via CDP DOM.querySelector.");
    }
    await cdp.send("DOM.setFileInputFiles", {
      nodeId: found.nodeId,
      files,
    });
    await this.runOnElement((el, attr: string) => {
      el.removeAttribute(attr);
    }, markerAttr).catch(() => {});
  }

  public async waitFor(opts?: { timeout?: number }): Promise<void> {
    const deadline = Date.now() + Math.max(500, opts?.timeout ?? 10_000);
    while (Date.now() < deadline) {
      try {
        await this.resolveElementCenter();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    throw new Error(
      `Timeout aguardando elemento '${this.spec.selector || this.spec.role || this.spec.text}'.`,
    );
  }

  public async evaluate<R>(fn: (el: unknown, arg?: unknown) => R, arg?: unknown): Promise<R> {
    return await this.runOnElement(fn, arg);
  }
}

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

export class NativeCdpBrowserSession {
  private readonly httpBaseUrl: string;
  private readonly childProcess: ChildProcess | null;
  private readonly externalProcess: boolean;
  private readonly pages = new Set<NativeCdpPage>();

  private constructor(params: {
    httpBaseUrl: string;
    childProcess: ChildProcess | null;
    externalProcess: boolean;
  }) {
    this.httpBaseUrl = params.httpBaseUrl;
    this.childProcess = params.childProcess;
    this.externalProcess = params.externalProcess;
  }

  public static async launch(opts: {
    executablePath: string;
    userDataDir: string;
    headless: boolean;
    args: string[];
    proxy?: { server: string; username?: string; password?: string } | null;
  }): Promise<NativeCdpBrowserSession> {
    mkdirSync(opts.userDataDir, { recursive: true });
    const port = await findFreeLoopbackTcpPort();
    const httpBaseUrl = `http://127.0.0.1:${port}`;

    const launchArgs = [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${opts.userDataDir}`,
      "--window-size=1280,800",
      "--disable-blink-features=AutomationControlled",
      ...(opts.headless ? ["--headless=new"] : []),
      ...(opts.proxy?.server ? [`--proxy-server=${opts.proxy.server}`] : []),
      ...opts.args,
      "about:blank",
    ];

    const child = spawn(opts.executablePath, launchArgs, {
      stdio: "ignore",
      detached: false,
      windowsHide: opts.headless,
    });

    let earlyExitErr: Error | null = null;
    child.once("error", (err) => {
      earlyExitErr = err;
    });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (earlyExitErr) throw earlyExitErr;
      if (child.exitCode !== null) {
        throw new Error(
          `Navegador encerrou durante a inicialização CDP (código ${child.exitCode}).`,
        );
      }
      try {
        const res = await fetch(`${httpBaseUrl}/json/version`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          return new NativeCdpBrowserSession({
            httpBaseUrl,
            childProcess: child,
            externalProcess: false,
          });
        }
      } catch {
        // aguardando porta CDP responder
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    throw new Error(
      `Timeout aguardando Chrome DevTools Protocol responder em ${httpBaseUrl}/json/version.`,
    );
  }

  public static async connectExisting(endpoint: string): Promise<NativeCdpBrowserSession> {
    const httpBaseUrl = assertLoopbackCdpEndpoint(endpoint);
    try {
      const res = await fetch(`${httpBaseUrl}/json/version`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      throw new Error(
        `Não foi possível conectar ao Chrome existente em ${httpBaseUrl} (${
          err instanceof Error ? err.message : String(err)
        }). Inicie o Chrome com --remote-debugging-port=${new URL(httpBaseUrl).port || 9222}.`,
      );
    }

    return new NativeCdpBrowserSession({
      httpBaseUrl,
      childProcess: null,
      externalProcess: true,
    });
  }

  public async newPage(): Promise<NativeCdpPage> {
    let targetRes = await fetch(`${this.httpBaseUrl}/json/new?about:blank`, {
      method: "PUT",
      signal: AbortSignal.timeout(5000),
    });
    if (targetRes.status === 405) {
      targetRes = await fetch(`${this.httpBaseUrl}/json/new?about:blank`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
    }
    if (!targetRes.ok) {
      throw new Error(`Falha ao criar nova aba CDP em ${this.httpBaseUrl} (HTTP ${targetRes.status}).`);
    }
    const target = (await targetRes.json()) as {
      id?: string;
      webSocketDebuggerUrl?: string;
      url?: string;
    };
    if (!target.id || !target.webSocketDebuggerUrl) {
      throw new Error("Target CDP retornou payload sem 'webSocketDebuggerUrl'.");
    }

    const cdp = await CdpWebSocketClient.connect(target.webSocketDebuggerUrl);
    const page = new NativeCdpPage({
      targetId: target.id,
      httpBaseUrl: this.httpBaseUrl,
      initialUrl: target.url || "about:blank",
      cdp,
    });
    await page.init();
    this.pages.add(page);
    page.on("close", () => {
      this.pages.delete(page);
    });
    return page;
  }

  public async newCDPSession(page: NativeCdpPage): Promise<CdpWebSocketClient> {
    return page.getCdpSession();
  }

  public async close(): Promise<void> {
    for (const page of Array.from(this.pages)) {
      await page.close().catch(() => {});
    }
    this.pages.clear();

    if (!this.externalProcess && this.childProcess && this.childProcess.exitCode === null) {
      try {
        this.childProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (this.childProcess && this.childProcess.exitCode === null) {
          try {
            this.childProcess.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, 1500).unref?.();
    }
  }
}
