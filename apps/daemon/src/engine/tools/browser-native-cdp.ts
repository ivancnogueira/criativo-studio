import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  assertLoopbackCdpEndpoint,
  CdpWebSocketClient,
  findFreeLoopbackTcpPort,
} from "./browser-cdp-websocket.ts";
import { NativeCdpPage } from "./browser-cdp-page.ts";
import { detectPageChallenge } from "./browser-challenge-detector.ts";

export { assertLoopbackCdpEndpoint, CdpWebSocketClient, NativeCdpPage, detectPageChallenge };

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
