import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Fase 38 — UI, WebSocket & Integrações Pós-Auditoria", () => {
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

  it("1. (AUDIT38-02) registerSystemWsHandlers trata browser:challenge_detected sem bypass e limpa listeners no unmount", async () => {
    const { registerSystemWsHandlers } = await vite.ssrLoadModule(
      "/src/hooks/ws/registerSystemWsHandlers.ts",
    );

    const listeners = new Map();
    let connectCalls = 0;
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
      connect() {
        connectCalls += 1;
      },
    };

    let takeoverByAgent = {};
    let activeBrowserTabId = null;
    let browserPanelMode = "closed";
    let browserTabs = [
      {
        tabId: "tab-c38",
        url: "https://exemplo.invalid/inicial",
        title: "Inicial",
        userControl: false,
      },
    ];

    const noop = () => {};
    const applyUpdater = (current, next) => (typeof next === "function" ? next(current) : next);

    const stateSpy = {
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
      setBrowserStatus: noop,
      setBrowserTabs: (next) => {
        browserTabs = applyUpdater(browserTabs, next);
      },
      setBrowserFramesByTab: noop,
      setActiveBrowserTabId: (next) => {
        activeBrowserTabId = applyUpdater(activeBrowserTabId, next);
      },
      setBrowserPanelMode: (next) => {
        browserPanelMode = applyUpdater(browserPanelMode, next);
      },
      setTakeoverByAgent: (next) => {
        takeoverByAgent = applyUpdater(takeoverByAgent, next);
      },
      setCaptureByAgent: noop,
      setActiveTakeoverModal: noop,
      setPendingAutofillRequest: noop,
      setActiveTakeoverFrame: noop,
      setTeachStatusByTab: noop,
      setShowcaseSites: noop,
      setLicenseStatus: noop,
      servers: [],
      setServers: noop,
      setServerQuota: noop,
      setUpdateStatus: noop,
      setCuaStatus: noop,
      userSettings: { aparencia: { tema_externo_id: null } },
    };

    const bootStub = {
      hydrateAll: async () => {},
      refreshAgentThreadsState: async () => {},
    };

    const cleanup = registerSystemWsHandlers(fakeWs, stateSpy, bootStub);
    assert.equal(connectCalls, 1);

    const challengeHandlers = listeners.get("browser:challenge_detected");
    assert.ok(challengeHandlers && challengeHandlers.size === 1);

    const payload = {
      kind: "turnstile",
      tabId: "tab-c38",
      agenteId: "estrategista",
      url: "https://exemplo.invalid/challenge",
      title: "Just a moment...",
      reason: "Turnstile",
      detectedAt: "2026-11-22T18:00:00.000Z",
    };
    for (const handler of challengeHandlers) {
      handler(payload, { event: "browser:challenge_detected", data: payload, timestamp: payload.detectedAt });
    }

    assert.deepEqual(takeoverByAgent.estrategista, {
      takeoverId: "challenge:tab-c38",
      tabId: "tab-c38",
      agenteId: "estrategista",
      reason: "captcha",
      url: "https://exemplo.invalid/challenge",
      title: "Just a moment...",
      status: "pending",
      criadoEm: "2026-11-22T18:00:00.000Z",
    });
    assert.equal(activeBrowserTabId, "tab-c38");
    assert.equal(browserPanelMode, "sidebar");
    assert.equal(browserTabs[0].userControl, true);
    assert.equal(browserTabs[0].url, "https://exemplo.invalid/challenge");
    assert.equal(browserTabs[0].title, "Just a moment...");

    assert.doesNotThrow(() => cleanup());
    assert.equal(listeners.get("browser:challenge_detected")?.size ?? 0, 0);
  });

  it("2. (AUDIT38-02) updateWorkflowPresence, WS workflow:presence e WorkflowCanvasTopHud fecham o ciclo join/leave", async () => {
    const { phase36Api } = await vite.ssrLoadModule("/src/services/api/phase36-api.ts");
    const { subscribeWsEvent, dispatchWsEvent, emitWsEventForTest } = await vite.ssrLoadModule(
      "/src/services/ws-transport.ts",
    );
    const { WorkflowCanvasTopHud } = await vite.ssrLoadModule(
      "/src/features/workflows/WorkflowCanvasTopHud.tsx",
    );

    const members = [
      {
        workflowId: "wf-38",
        memberId: "mem_1",
        displayName: "Operador Um Sintetico",
        role: "editor",
        joinedAt: "2026-11-22T18:00:00.000Z",
        lastSeenAt: "2026-11-22T18:00:10.000Z",
      },
      {
        workflowId: "wf-38",
        memberId: "mem_2",
        displayName: "Admin Dois Sintetico",
        role: "admin",
        joinedAt: "2026-11-22T18:00:00.000Z",
        lastSeenAt: "2026-11-22T18:00:10.000Z",
      },
    ];

    const calls = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
        return new Response(JSON.stringify({ ok: true, members }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const joined = await phase36Api.updateWorkflowPresence("wf-38", "join");
      const left = await phase36Api.updateWorkflowPresence("wf-38", "leave");

      assert.equal(joined.length, 2);
      assert.equal(left.length, 2);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "/api/workflows/presence");
      assert.equal(calls[0].method, "POST");
      assert.deepEqual(JSON.parse(calls[0].body), { workflowId: "wf-38", action: "join" });
      assert.equal(calls[1].url, "/api/workflows/presence");
      assert.equal(calls[1].method, "POST");
      assert.deepEqual(JSON.parse(calls[1].body), { workflowId: "wf-38", action: "leave" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const received = [];
    const unsub = subscribeWsEvent("workflow:presence", (data) => {
      received.push(data);
    });
    emitWsEventForTest({
      event: "workflow:presence",
      data: { workflowId: "wf-38", members },
      timestamp: "2026-11-22T18:01:00.000Z",
    });
    dispatchWsEvent({
      event: "workflow:presence",
      data: { workflowId: "wf-38", members: [members[0]] },
      timestamp: "2026-11-22T18:02:00.000Z",
    });
    assert.equal(received.length, 2);
    assert.equal(received[0].workflowId, "wf-38");
    assert.equal(received[0].members.length, 2);
    assert.equal(received[1].members.length, 1);

    unsub();
    emitWsEventForTest({
      event: "workflow:presence",
      data: { workflowId: "wf-38", members: [] },
      timestamp: "2026-11-22T18:03:00.000Z",
    });
    assert.equal(received.length, 2);

    const sampleWf = {
      workflow_id: "wf-38",
      nome: "Fluxo Sintetico 38",
      descricao: "Fluxo de validacao",
      nos: [],
      arestas: [],
      tracos: [],
      ativo: true,
      revisao_grafo: 1,
      criado_em: "2026-11-22T00:00:00.000Z",
      atualizado_em: "2026-11-22T00:00:00.000Z",
    };

    const hudHtml = renderToStaticMarkup(
      React.createElement(WorkflowCanvasTopHud, {
        props: {
          workflows: [sampleWf],
          agentes: [],
          uso: null,
          onSaveWorkflow: async () => sampleWf,
          onExecuteWorkflow: async () => ({ tarefas_criadas: [] }),
        },
        ctrl: {
          setHiddenDeletedIds: () => {},
          visibleWorkflows: [sampleWf],
          setActiveWfId: () => {},
          currentWf: sampleWf,
          localNos: [],
          setLocalNos: () => {},
          localArestas: [],
          setLocalArestas: () => {},
          localTracos: [],
          setLocalTracos: () => {},
          setLocalRevision: () => {},
          selectedEdgeId: null,
          runsMenuOpen: false,
          setRunsMenuOpen: () => {},
          setInspectorOpen: () => {},
          versions: [],
          setVersions: () => {},
          runs: [],
          setSelectedRunId: () => {},
          previewVersion: null,
          setPreviewVersion: () => {},
          restoringVersion: false,
          setRestoringVersion: () => {},
          setPendingDelete: () => {},
          setStatusFeedback: () => {},
          executing: false,
          undoStack: [],
          redoStack: [],
          localRevRef: { current: 1 },
          hydrateWorkflowSideData: async () => {},
          isReadOnly: false,
          liveRun: null,
          handleDeleteEdge: () => {},
          handleUndo: () => {},
          handleRedo: () => {},
          handleAutoLayout: () => {},
          handleSaveNow: async () => {},
          handleRunWorkflow: async () => {},
          handleCreateFlow: async () => {},
          doneCount: 0,
          totalExecCount: 0,
        },
        initialPresenceMembers: members,
      }),
    );

    assert.ok(hudHtml.includes('data-testid="workflow-presence-badge"'));
    assert.ok(hudHtml.includes("2 ativo(s)"));
    assert.ok(hudHtml.includes("Operador Um Sintetico (editor), Admin Dois Sintetico (admin)"));
    assert.equal(/<select[\s>]/i.test(hudHtml), false);

    const hudSource = readFileSync(
      resolve(webRoot, "src/features/workflows/WorkflowCanvasTopHud.tsx"),
      "utf8",
    );
    assert.match(hudSource, /updateWorkflowPresence\(wfId,\s*"join"\)/);
    assert.match(hudSource, /updateWorkflowPresence\(wfId,\s*"leave"\)/);
  });

  it("3. (AUDIT38-02) InspectorAgentConfigTab exibe botão de exportação de template sem <select> e phase37Api.exportAgentTemplate retorna sha256", async () => {
    const { RightInspectorPanel } = await vite.ssrLoadModule(
      "/src/features/inspector/RightInspectorPanel.tsx",
    );
    const { phase37Api } = await vite.ssrLoadModule("/src/services/api/phase37-api.ts");

    const html = renderToStaticMarkup(
      React.createElement(RightInspectorPanel, {
        open: true,
        initialSubView: "config",
        agente: {
          agente_id: "estrategista",
          nome: "Estrategista Editorial",
          papel: "Planejamento",
          pasta: "estrategista",
          modelo_padrao: "gemini-4-argon",
          ativo: true,
          status: "ocioso",
          config: {
            avatar_shape: "hex",
            avatar_color: "#31CF76",
          },
          atualizado_em: "2026-11-22T00:00:00.000Z",
        },
        arquivos: [],
        threads: [],
        previewTarefa: null,
        onClose: () => {},
        onOpenFilesPage: () => {},
        onOpenWhatsAppModal: () => {},
        onSaveAgentSettings: async () => {},
        onApproveTask: async () => {},
        onRequestRevision: async () => {},
      }),
    );

    assert.ok(html.includes('data-testid="export-agent-template-btn"'));
    assert.ok(html.includes("Exportar template (.json)"));
    assert.equal(/<select[\s>]/i.test(html), false);

    const expectedSha = "a".repeat(64);
    const exportCalls = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        exportCalls.push({ url: String(input), method: init?.method ?? "GET" });
        return new Response(
          JSON.stringify({
            ok: true,
            package: {
              schema_version: 1,
              template_id: "tpl-estrategista-1.0.0",
              name: "Estrategista",
              role: "Planejamento",
              version: "1.0.0",
              author_display: "Studio",
              description: "Template",
              created_at: "2026-11-22T00:00:00.000Z",
              skills: [],
              config_sanitized: { cua_enabled: false },
              sha256: expectedSha,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const exported = await phase37Api.exportAgentTemplate("estrategista");
      assert.equal(exportCalls.length, 1);
      assert.equal(exportCalls[0].url, "/api/templates/export/estrategista");
      assert.equal(exportCalls[0].method, "GET");
      assert.equal(exported.ok, true);
      assert.equal(exported.package.sha256, expectedSha);
      assert.equal(exported.package.template_id, "tpl-estrategista-1.0.0");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
