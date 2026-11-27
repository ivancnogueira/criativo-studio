import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 46 — Fechamento de Gaps Clean-Room & WebSocket browser:tab_unloaded", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  it("1. (AUDIT46-01) BrowserWindowActionsBar e SideSplitContainer renderizam controles Carbon Dark sem <select> nativo", async () => {
    const { BrowserWindowActionsBar } = await vite.ssrLoadModule(
      "/src/features/browser/BrowserWindowActionsBar.tsx"
    );
    const { SideSplitContainer } = await vite.ssrLoadModule(
      "/src/features/inspector/SideSplitContainer.tsx"
    );

    const actionsHtml = renderToStaticMarkup(
      React.createElement(BrowserWindowActionsBar, {
        tabId: "tab-46",
        agenteId: "estrategista",
        canMoveLeft: true,
        canMoveRight: false,
        onMoveTab: () => {},
      })
    );
    assert.match(actionsHtml, /Destacar janela/);
    assert.equal(/<select[\s>]/i.test(actionsHtml), false);

    const splitHtml = renderToStaticMarkup(
      React.createElement(SideSplitContainer, {
        layout: {
          groups: [
            { id: "grp-1", kind: "inspector", ratio: 0.6 },
            { id: "grp-2", kind: "browser", ratio: 0.4 },
          ],
        },
        onChange: () => {},
        renderGroup: (kind) => React.createElement("div", null, `Conteúdo ${kind}`),
        onCloseKind: () => {},
        openableKinds: ["preview", "side_thread"],
        onOpenKind: () => {},
      })
    );
    assert.match(splitHtml, /Grupo/);
    assert.match(splitHtml, /Inspetor/);
    assert.match(splitHtml, /Navegador/);
    assert.equal(/<select[\s>]/i.test(splitHtml), false);
  });

  it("2. (AUDIT46-02) registerSystemWsHandlers sincroniza browser:tab_unloaded em tabs/frames/status e remove listener no cleanup", async () => {
    const { registerSystemWsHandlers } = await vite.ssrLoadModule(
      "/src/hooks/ws/registerSystemWsHandlers.ts"
    );

    const listeners = new Map();
    const fakeWs = {
      on(event, cb) {
        let bucket = listeners.get(event);
        if (!bucket) {
          bucket = new Set();
          listeners.set(event, bucket);
        }
        bucket.add(cb);
        return () => {
          bucket.delete(cb);
          if (bucket.size === 0) listeners.delete(event);
        };
      },
      connect() {},
    };

    const applyUpdater = (current, next) => (typeof next === "function" ? next(current) : next);
    let browserTabs = [
      {
        tabId: "tab-u46",
        perfilId: "perfil-1",
        agenteId: "estrategista",
        url: "https://exemplo.invalid/antes",
        title: "Aba Ativa",
        userControl: false,
        unloaded: false,
      },
    ];
    let browserFramesByTab = {
      "tab-u46": {
        tabId: "tab-u46",
        dataUrl: "data:image/png;base64,AAA",
        width: 800,
        height: 600,
        url: "https://exemplo.invalid/antes",
        title: "Aba Ativa",
        userControl: false,
      },
    };
    let browserStatus = {
      available: true,
      executablePath: null,
      activeContexts: 1,
      activeTabs: 1,
      unloadedTabs: 0,
      tabs: browserTabs,
    };

    const noop = () => {};
    const cleanup = registerSystemWsHandlers(fakeWs, {
      onboarding: null,
      setOnboarding: noop,
      setAgentes: noop,
      setCanais: noop,
      setArquivos: noop,
      setHabilidades: noop,
      steps: [],
      setChatByKey: noop,
      activeTabId: "agent:estrategista",
      setDeletedNativeAgents: noop,
      setThreadChatById: noop,
      setSharedTablesRefreshNonce: noop,
      setFoldersSnapshot: noop,
      setUserSettings: noop,
      setSidebarLayout: noop,
      setBrowserStatus: (next) => {
        browserStatus = applyUpdater(browserStatus, next);
      },
      setBrowserTabs: (next) => {
        browserTabs = applyUpdater(browserTabs, next);
      },
      setBrowserFramesByTab: (next) => {
        browserFramesByTab = applyUpdater(browserFramesByTab, next);
      },
      setActiveBrowserTabId: noop,
      setBrowserPanelMode: noop,
      setTakeoverByAgent: noop,
      setActiveTakeoverFrame: noop,
      setActiveTakeoverModal: noop,
      setTeachStatusByTab: noop,
      setCaptureByAgent: noop,
      setPendingAutofillRequest: noop,
      setShowcase: noop,
      setLicenseStatus: noop,
      setServersSnapshot: noop,
      setUpdateStatus: noop,
      setVpsAssistantState: noop,
      setCuaSessionState: noop,
      onThemeReloaded: noop,
    }, {
      hydrateAll: async () => {},
      refreshAgentThreadsState: async () => {},
    });

    const handlers = listeners.get("browser:tab_unloaded");
    assert.ok(handlers && handlers.size === 1, "Listener de browser:tab_unloaded deve estar registrado");

    for (const cb of handlers) {
      cb({
        tabId: "tab-u46",
        perfilId: "perfil-1",
        agenteId: "estrategista",
        url: "https://exemplo.invalid/suspensa",
        title: "Aba Suspensa",
        reason: "memory_pressure_elevated",
        unloadedAt: "2026-11-27T18:40:00.000Z",
        pressureLevel: "elevated",
      });
    }

    assert.equal(browserTabs[0]?.unloaded, true);
    assert.equal(browserTabs[0]?.unloadReason, "memory_pressure_elevated");
    assert.equal(browserTabs[0]?.unloadedAt, "2026-11-27T18:40:00.000Z");
    assert.equal(browserTabs[0]?.title, "Aba Suspensa");
    assert.equal("tab-u46" in browserFramesByTab, false);
    assert.equal(browserStatus.unloadedTabs, 1);
    assert.equal(browserStatus.tabs[0]?.unloaded, true);

    cleanup();
    assert.equal(listeners.has("browser:tab_unloaded"), false);
  });
});
