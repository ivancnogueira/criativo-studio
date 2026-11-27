import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { initializeDatabase } from "../src/database/client.ts";
import { BrowserAutomationService } from "../src/engine/tools/browser-automation.ts";
import {
  BrowserCdpSessionManager,
  type LaunchProfileContextOptions,
  type ManagedTabEntry,
} from "../src/engine/tools/browser-cdp-session.ts";
import {
  DEFAULT_CRITICAL_IDLE_MS,
  DEFAULT_ELEVATED_IDLE_MS,
  selectTabsForMemoryUnload,
} from "../src/engine/tools/browser/browser-tab-unload.ts";
import { evaluateMemoryPressure } from "../src/server/resource-monitor.ts";
import { handlePhase15BrowserRoutes } from "../src/server/phase15-browser-routes.ts";

class FakePage extends EventEmitter {
  public closed = false;
  public currentUrl: string;
  public currentTitle: string;
  private readonly frame = { url: () => this.currentUrl };

  constructor(initialUrl: string, initialTitle: string) {
    super();
    this.currentUrl = initialUrl;
    this.currentTitle = initialTitle;
  }

  public mainFrame() {
    return this.frame;
  }

  public url(): string {
    return this.currentUrl;
  }

  public async title(): Promise<string> {
    return this.currentTitle;
  }

  public async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.currentTitle = `Título de ${url}`;
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.emit("close");
  }

  public async screenshot(): Promise<Buffer> {
    return Buffer.from("fake-png");
  }

  public viewportSize(): { width: number; height: number } {
    return { width: 1280, height: 800 };
  }

  public async evaluate<T>(fn: (() => T) | ((arg: unknown) => T), arg?: unknown): Promise<T> {
    if (fn.toString().includes("textSummary") || fn.toString().includes("tagName")) {
      return {
        textSummary: `Resumo de ${this.currentUrl}`,
        elements: [],
      } as unknown as T;
    }
    return undefined as unknown as T;
  }
}

class FakeBrowserContext {
  public closed = false;
  public pagesCreated = 0;

  public async newPage(): Promise<FakePage> {
    this.pagesCreated += 1;
    return new FakePage("about:blank", "Nova Aba");
  }

  public async newCDPSession() {
    return {
      on: () => {},
      send: async () => ({}),
      detach: async () => {},
    };
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

function setupMockTabLifecycle(
  manager: BrowserCdpSessionManager,
  opts: {
    tabId: string;
    perfilId: string;
    agenteId?: string | null;
    url: string;
    title: string;
    lastActivityAt: number;
    userControl?: boolean;
    teachRecording?: boolean;
    contextRef?: FakeBrowserContext;
  },
): { entry: ManagedTabEntry; page: FakePage; context: FakeBrowserContext } {
  const context = opts.contextRef ?? new FakeBrowserContext();
  const page = new FakePage(opts.url, opts.title);

  // Registra contexto e aba nos mapas internos para testes determinísticos sem binário Chromium
  const mgrAny = manager as unknown as {
    contexts: Map<string, { context: unknown; proxySignature: string; lastUsedAt: number }>;
    tabs: Map<string, ManagedTabEntry>;
    ensurePersistentContext: (launch: LaunchProfileContextOptions) => Promise<unknown>;
  };
  mgrAny.contexts.set(opts.perfilId, {
    context,
    proxySignature: "mock",
    lastUsedAt: opts.lastActivityAt,
  });

  const entry: ManagedTabEntry = {
    tabId: opts.tabId,
    perfilId: opts.perfilId,
    agenteId: opts.agenteId ?? "estrategista",
    page: page as unknown as ManagedTabEntry["page"],
    cdpSession: {
      send: async () => ({}),
      detach: async () => {},
    } as unknown as ManagedTabEntry["cdpSession"],
    revision: 1,
    snapshotRefs: new Map(),
    lastDialog: null,
    pendingDialogObj: null,
    userControl: opts.userControl ?? false,
    screencastActive: false,
    screencastTimer: null,
    lastFrameSentAt: 0,
    teachRecording: opts.teachRecording ?? false,
    teachStartedAt: opts.teachRecording ? opts.lastActivityAt : null,
    lastActivityAt: opts.lastActivityAt,
    virtualUrl: opts.url,
    virtualTitle: opts.title,
    userDataDir: join(tmpdir(), "mock-profile"),
    unloaded: false,
    unloadedAt: null,
    unloadReason: null,
  };

  page.on("close", () => {
    if (entry.suppressCloseCleanup) return;
    mgrAny.tabs.delete(entry.tabId);
  });

  mgrAny.tabs.set(opts.tabId, entry);
  return { entry, page, context };
}

describe("Fase 41-01 — Browser Auto-Unload sob Pressão de RAM", () => {
  it("evaluateMemoryPressure classifica corretamente normal, elevated e critical", () => {
    assert.equal(evaluateMemoryPressure({ totalMemMb: 4096, freeMemMb: 2048 }).level, "normal");
    assert.equal(evaluateMemoryPressure({ totalMemMb: 4096, freeMemMb: 800 }).level, "elevated");
    assert.equal(evaluateMemoryPressure({ totalMemMb: 2048, freeMemMb: 450 }).level, "elevated");
    assert.equal(evaluateMemoryPressure({ totalMemMb: 4096, freeMemMb: 350 }).level, "critical");
    assert.equal(evaluateMemoryPressure({ totalMemMb: 8192, freeMemMb: 200 }).level, "critical");
  });

  it("não descarrega abas sob pressão normal nem abas em takeover, teach ou atividade recente", () => {
    const now = 1_000_000;
    const base = {
      perfilId: "p1",
      agenteId: "a1",
      screencastActive: false,
      unloaded: false,
      virtualUrl: "https://exemplo.com",
      virtualTitle: "Exemplo",
    };
    const tabs = [
      { ...base, tabId: "idle-old", lastActivityAt: now - DEFAULT_ELEVATED_IDLE_MS - 5000, userControl: false, teachRecording: false },
      { ...base, tabId: "user-ctrl", lastActivityAt: now - 500_000, userControl: true, teachRecording: false },
      { ...base, tabId: "teach-rec", lastActivityAt: now - 500_000, userControl: false, teachRecording: true },
      { ...base, tabId: "recent", lastActivityAt: now - DEFAULT_CRITICAL_IDLE_MS + 5000, userControl: false, teachRecording: false },
    ];

    assert.deepEqual(selectTabsForMemoryUnload(tabs, "normal", now), []);
    const selectedCritical = selectTabsForMemoryUnload(tabs, "critical", now);
    assert.deepEqual(
      selectedCritical.map((t) => t.tabId),
      ["idle-old"],
    );
  });

  it("descarrega aba ociosa sob pressão elevada, fecha page e fecha BrowserContext vazio preservando estado lógico", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-01-"));
    try {
      const manager = new BrowserCdpSessionManager(dir);
      const unloadedEvents: string[] = [];
      manager.setOnTabUnloaded((tab) => unloadedEvents.push(tab.tabId));

      const now = Date.now();
      const { entry, page, context } = setupMockTabLifecycle(manager, {
        tabId: "tab-ociosa",
        perfilId: "perfil-vps",
        url: "https://criativoos.local/painel",
        title: "Painel CriativoOS",
        lastActivityAt: now - 180_000,
      });

      const unloadedIds = await manager.sweepMemoryPressureTabs("elevated", { nowMs: now });
      assert.deepEqual(unloadedIds, ["tab-ociosa"]);
      assert.deepEqual(unloadedEvents, ["tab-ociosa"]);
      assert.equal(page.closed, true);
      assert.equal(context.closed, true);
      assert.equal(manager.getActiveContextCount(), 0);
      assert.equal(entry.unloaded, true);

      const summaries = manager.listTabSummaries();
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0]?.tabId, "tab-ociosa");
      assert.equal(summaries[0]?.url, "https://criativoos.local/painel");
      assert.equal(summaries[0]?.title, "Painel CriativoOS");
      assert.equal(summaries[0]?.unloaded, true);

      await manager.closeAll();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recarrega aba unloaded transparentemente ao executar snapshot ou navigate e expõe rotas HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-01-svc-"));
    const db = initializeDatabase({ dbPath: join(dir, "test.db") });
    try {
      const service = new BrowserAutomationService(db, undefined, undefined, dir);
      const profile = service.ensureDefaultSharedProfile();
      const reloadedContext = new FakeBrowserContext();

      // Stub determinístico para evitar lançamento real de Chromium durante o teste unitário
      const mgrAny = service.sessionManager as unknown as {
        ensurePersistentContext: (launch: LaunchProfileContextOptions) => Promise<FakeBrowserContext>;
      };
      mgrAny.ensurePersistentContext = async () => reloadedContext;

      service.sessionManager.setMemoryPressureReader(() => ({
        level: "elevated",
        totalMemMb: 2048,
        freeMemMb: 400,
        usedPercent: 80.5,
        daemonRssMb: 120,
      }));

      const now = Date.now();
      const { entry } = setupMockTabLifecycle(service.sessionManager, {
        tabId: "tab-reload-1",
        perfilId: profile.perfil_id,
        url: "https://example.com/briefing",
        title: "Briefing",
        lastActivityAt: now - 240_000,
      });

      await service.sessionManager.sweepMemoryPressureTabs("elevated", { nowMs: now });
      assert.equal(entry.unloaded, true);
      assert.equal(service.getStatus().unloadedTabs, 1);
      assert.equal(service.getStatus().memoryPressure, "elevated");

      // Redefine captureTabSnapshot apenas para simular leitura de DOM após reload transparente
      (service as unknown as { captureTabSnapshot: (t: ManagedTabEntry) => Promise<unknown> }).captureTabSnapshot = async (t) => ({
        tabId: t.tabId,
        perfilId: t.perfilId,
        url: t.virtualUrl,
        title: t.virtualTitle,
        revision: t.revision,
        elements: [],
        textSummary: "Recarregada OK",
        truncated: false,
      });

      const snap = (await service.executeAction({
        action: "snapshot",
        tabId: "tab-reload-1",
      })) as { tabId: string; url: string; textSummary: string };

      assert.equal(entry.unloaded, false);
      assert.ok(entry.page !== null);
      assert.equal(snap.url, "https://example.com/briefing");
      assert.equal(reloadedContext.pagesCreated, 1);

      // Agora testa rota HTTP POST /api/navegador/sessoes/unload-ociosas + /recarregar
      entry.lastActivityAt = Date.now() - 300_000;
      const runRoute = async (method: string, path: string, body?: Record<string, unknown>) => {
        const req = new PassThrough() as unknown as IncomingMessage;
        (req as unknown as { method: string; url: string }).method = method;
        (req as unknown as { url: string }).url = path;
        if (body) {
          process.nextTick(() => {
            (req as unknown as PassThrough).end(JSON.stringify(body));
          });
        } else {
          process.nextTick(() => (req as unknown as PassThrough).end());
        }
        let statusCode = 200;
        let payload = "";
        const res = {
          writeHead: (code: number) => { statusCode = code; },
          end: (chunk?: string | Buffer) => { payload += chunk?.toString() ?? ""; },
          setHeader: () => {},
        } as unknown as ServerResponse;

        const handled = await handlePhase15BrowserRoutes(
          req,
          res,
          path,
          method,
          new URL(`http://127.0.0.1${path}`),
          {
            db,
            workspaceRoot: dir,
            browserService: service,
            readJsonBody: async (r: IncomingMessage) =>
              await new Promise((resolve) => {
                let raw = "";
                r.on("data", (c) => { raw += c.toString(); });
                r.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
              }),
            sendJson: (r: ServerResponse, code: number, data: unknown) => {
              r.writeHead(code);
              r.end(JSON.stringify(data));
            },
          } as never,
        );
        return { handled, statusCode, data: payload ? JSON.parse(payload) : null };
      };

      const unloadResp = await runRoute("POST", "/api/navegador/sessoes/unload-ociosas", {
        level: "critical",
      });
      assert.equal(unloadResp.handled, true);
      assert.equal(unloadResp.statusCode, 200);
      assert.deepEqual(unloadResp.data.unloadedTabIds, ["tab-reload-1"]);
      assert.equal(entry.unloaded, true);

      const reloadResp = await runRoute("POST", "/api/navegador/sessoes/tab-reload-1/recarregar");
      assert.equal(reloadResp.handled, true);
      assert.equal(reloadResp.statusCode, 200);
      assert.equal(reloadResp.data.ok, true);
      assert.equal(entry.unloaded, false);

      await service.closeAll();
    } finally {
      db.connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
