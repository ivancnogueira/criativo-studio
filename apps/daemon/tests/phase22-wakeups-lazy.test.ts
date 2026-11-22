import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ROUTINE_MINIMUM_INTERVAL_MINUTES } from "@criativo/contracts";
import { initializeDatabase } from "../src/database/client.ts";
import { seedDefaultStudioExperience } from "../src/engine/runner/roster-defaults.ts";
import { sanitizeJsonSchemaForGemini } from "../src/mcp/gemini-schema-sanitizer.ts";
import { ROUTINE_AGENT_TOOLS_SCHEMA } from "../src/routines/routine-agent-tools.ts";
import { resolveAgentIdFromDb } from "../src/server/agent-resolver.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import {
  extractMentionedAgentIds,
  generateAgentChatReply,
} from "../src/server/studio-routes.ts";
import {
  executePhase13Tool,
  executeStudioRoutineTool,
  normalizeBrowserTargetInput,
  PHASE15_TOOLS_SCHEMA,
} from "../src/server/studio-tools-bridge.ts";
import { planTurnContext } from "../src/server/turn-context-planner.ts";
import { AgentWakeupService } from "../src/waits/agent-wakeup-service.ts";
import { WebSocketHub } from "../src/server/websocket-hub.ts";

describe("Fase 22 — Schemas MCP, Wakeups Reais, Resolução @Apelido, Lazy Loading & Dock", () => {
  const tempDirs: string[] = [];
  const runtimes: DaemonRuntime[] = [];

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  after(async () => {
    for (const rt of runtimes) {
      await rt.close().catch(() => {});
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("1. (MCP22-01) sanitizeJsonSchemaForGemini preserva target/schedule completos e normalizeBrowserTargetInput aceita shorthands", () => {
    const browserTool = PHASE15_TOOLS_SCHEMA.find((t) => t.name === "criativo_browser");
    assert.ok(browserTool, "criativo_browser deve existir em PHASE15_TOOLS_SCHEMA");

    const sanitizedBrowser = sanitizeJsonSchemaForGemini(browserTool.parameters);
    const propsBrowser = sanitizedBrowser.properties as Record<string, any>;
    assert.ok(propsBrowser.target?.properties?.ref, "target.properties.ref deve ser preservado");
    assert.ok(propsBrowser.target?.properties?.selector, "target.properties.selector deve ser preservado");
    assert.ok(propsBrowser.target?.properties?.x, "target.properties.x deve ser preservado");
    assert.ok(propsBrowser.toTarget?.properties?.ref, "toTarget.properties.ref deve ser preservado");
    assert.ok(propsBrowser.submitTarget?.properties?.selector, "submitTarget deve preservar properties");
    assert.ok(propsBrowser.fields?.items?.properties?.target?.properties?.ref, "fields[].target deve preservar properties");
    assert.ok(propsBrowser.viewport?.properties?.width, "viewport deve declarar width");
    assert.ok(propsBrowser.viewport?.properties?.height, "viewport deve declarar height");

    const createRoutine = ROUTINE_AGENT_TOOLS_SCHEMA.find((t) => t.name === "create_routine");
    const updateRoutine = ROUTINE_AGENT_TOOLS_SCHEMA.find((t) => t.name === "update_routine");
    assert.ok(createRoutine && updateRoutine);
    for (const schema of [createRoutine.parameters, updateRoutine.parameters]) {
      const sanitized = sanitizeJsonSchemaForGemini(schema);
      const props = sanitized.properties as Record<string, any>;
      assert.ok(props.schedule?.properties?.kind, "schedule.kind deve ser preservado");
      assert.ok(props.schedule?.properties?.amount, "schedule.amount deve ser preservado");
      assert.ok(props.schedule?.properties?.unit, "schedule.unit deve ser preservado");
      assert.ok(props.schedule?.properties?.time, "schedule.time deve ser preservado");
      assert.ok(props.schedule?.properties?.days?.properties?.kind, "schedule.days deve ser preservado");
    }

    assert.deepEqual(normalizeBrowserTargetInput({ ref: "e12" }), { kind: "ref", ref: "e12" });
    assert.deepEqual(normalizeBrowserTargetInput({ selector: "#btn-enviar" }), {
      kind: "css",
      selector: "#btn-enviar",
    });
    assert.deepEqual(normalizeBrowserTargetInput({ x: 120, y: 240 }), {
      kind: "point",
      x: 120,
      y: 240,
    });
    assert.deepEqual(normalizeBrowserTargetInput("e7"), { kind: "ref", ref: "e7" });
    assert.deepEqual(normalizeBrowserTargetInput("#campo"), { kind: "css", selector: "#campo" });
  });

  it("2. (WAKE22-01) AgentWakeupService executa ciclo recorrente na thread e respeita auto-cancelamento sem alterar piso 3 min", async () => {
    const dir = makeTempDir("p22-wakeup-");
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    const rt = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "wake.sqlite"),
      workspaceRoot: dir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    runtimes.push(rt);

    try {
      assert.equal(ROUTINE_MINIMUM_INTERVAL_MINUTES, 3);
      const routineToolsDeps = {
        db: rt.db,
        routineStore: rt.routineStore,
        timer: rt.routineTimer,
        executionService: rt.routineExecutionService,
        webhookService: rt.routineWebhookService,
        flowsEngine: rt.routineFlowsEngine,
        wsHub: rt.wsHub,
      };

      // Erro de rotina < 3 min deve orientar uso de schedule_wakeup
      await assert.rejects(
        () =>
          executeStudioRoutineTool(
            "create_routine",
            {
              name: "Checagem rápida",
              instruction: "Verificar status",
              schedule: { kind: "interval", amount: 1, unit: "minutes" },
            },
            {
              agenteId: "estrategista",
              turnOrigin: "human",
              routineToolsDeps,
            },
          ),
        /schedule_wakeup/i,
      );

      const wsHub = rt.wsHub;
      const events: Array<{ event: string; data: unknown }> = [];
      const origBroadcast = wsHub.broadcast.bind(wsHub);
      wsHub.broadcast = ((evt: any, payload: any) => {
        events.push({ event: String(evt), data: payload });
        return origBroadcast(evt, payload);
      }) as typeof wsHub.broadcast;

      const localWakeup = new AgentWakeupService({ db: rt.db, wsHub });
      const firedLogs: Array<{ threadId: string; iteracao: number }> = [];
      let cancelOnSecondCycle = false;

      localWakeup.setOnFire(async (row) => {
        firedLogs.push({ threadId: row.thread_id, iteracao: row.iteracao_atual });
        if (cancelOnSecondCycle) {
          localWakeup.cancelWakeup(row.wakeup_id, row.agente_id);
        }
      });

      const scheduled = await executePhase13Tool(
        "schedule_wakeup",
        {
          delaySeconds: 15,
          recurring: true,
          maxIterations: 5,
          instruction: "Checar resposta no canal de teste",
        },
        {
          agenteId: "estrategista",
          turnoId: "turn-wk-1",
          callId: "call-wk-1",
          threadId: "th-wk-42",
          canalId: "thread:th-wk-42",
          entregaOrigemId: "msg-wk-1",
          pedidoTexto: "Monitorar retorno",
          channelOrigin: "web",
        },
        {
          db: rt.db,
          wakeupService: localWakeup,
        },
      );

      assert.equal(scheduled.handled, true);
      const resObj = scheduled.result as { ok: boolean; wakeupId: string; threadId: string };
      assert.equal(resObj.ok, true);
      assert.equal(resObj.threadId, "th-wk-42");

      // Dispara 1o ciclo manualmente avançando o relógio 16s
      const processed1 = await localWakeup.processDueWakeups(new Date(Date.now() + 16_000));
      assert.equal(processed1, 1);
      assert.deepEqual(firedLogs, [{ threadId: "th-wk-42", iteracao: 1 }]);
      assert.equal(localWakeup.hasActiveWakeups("estrategista"), true);

      // No 2o ciclo o próprio handler chama cancelWakeup e o status cancelado não pode ser sobrescrito
      cancelOnSecondCycle = true;
      const processed2 = await localWakeup.processDueWakeups(new Date(Date.now() + 40_000));
      assert.equal(processed2, 1);
      assert.equal(firedLogs.length, 2);
      assert.equal(localWakeup.hasActiveWakeups("estrategista"), false);

      const allWakeups = localWakeup.listWakeups("estrategista", true);
      const targetRow = allWakeups.find((w) => w.wakeup_id === resObj.wakeupId);
      assert.equal(targetRow?.status, "cancelado");
      assert.equal(targetRow?.iteracao_atual, 2);
      assert.ok(events.some((e) => e.event === "wakeup:updated"));

      localWakeup.dispose();
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    }
  });

  it("3. (ALIAS22-01) Agente customizado 'custom_vendedor_1234' é resolvido por @apelido em DB, menções, rotinas e send_message", async () => {
    const dir = makeTempDir("p22-alias-");
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    const rt = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "alias.sqlite"),
      workspaceRoot: dir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    runtimes.push(rt);

    try {
      const nowIso = new Date().toISOString();
      rt.db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status, skills_paths_json,
             memoria_resumo, ordem_exibicao, config_json, atualizado_em
           ) VALUES (?, ?, ?, ?, 'ocioso', '[]', NULL, 25, '{}', ?);`,
        )
        .run("custom_vendedor_1234", "Vendedor Teste", "Prospecção", "gemini-4-argon", nowIso);

      assert.equal(resolveAgentIdFromDb(rt.db, "@vendedor_teste"), "custom_vendedor_1234");
      assert.equal(resolveAgentIdFromDb(rt.db, "Vendedor Teste"), "custom_vendedor_1234");
      assert.equal(resolveAgentIdFromDb(rt.db, "custom_vendedor_1234"), "custom_vendedor_1234");

      assert.deepEqual(
        extractMentionedAgentIds("Por favor @vendedor_teste verificar agora", undefined, rt.db),
        ["custom_vendedor_1234"],
      );

      const routineToolsDeps = {
        db: rt.db,
        routineStore: rt.routineStore,
        timer: rt.routineTimer,
        executionService: rt.routineExecutionService,
        webhookService: rt.routineWebhookService,
        flowsEngine: rt.routineFlowsEngine,
        wsHub: rt.wsHub,
      };

      const routinesOut = (await executeStudioRoutineTool(
        "list_routines",
        { agentId: "@vendedor_teste" },
        {
          agenteId: "estrategista",
          turnOrigin: "human",
          routineToolsDeps,
        },
      )) as { agenteId: string };
      assert.equal(routinesOut.agenteId, "custom_vendedor_1234");

      const sent = rt.handoffBus.sendMessageAsync({
        senderAgentId: "estrategista",
        sourceCanalId: "agente:estrategista",
        sourceThreadId: "main:estrategista",
        recipientAgentIds: ["@vendedor_teste"],
        text: "Verifique o acompanhamento de teste.",
        wsHub: rt.wsHub,
      });
      assert.equal(sent.entregas[0]?.para_agente_id, "custom_vendedor_1234");
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    }
  });

  it("4. (TOK22-01) planTurnContext economiza tokens em saudações, filtra escopos MCP e expõe load_skill/list_agents sob demanda", async () => {
    const lightPlan = planTurnContext({
      userPrompt: "ola",
      agenteId: "designer_carrossel",
      isGreetingOrCapability: true,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
      hasExternalMcps: true,
    });
    assert.equal(lightPlan.mode, "light");
    assert.deepEqual(lightPlan.mcpScopes, []);
    assert.equal(lightPlan.loadFullSkill, false);
    assert.equal(lightPlan.attachBrandImages, false);
    assert.equal(lightPlan.compactLiveContext, true);
    assert.equal(lightPlan.includeExternalMcps, false);

    const actionPlan = planTurnContext({
      userPrompt: "abra o navegador e verifique respostas a cada 1 minuto",
      agenteId: "custom_vendedor_1234",
      isGreetingOrCapability: false,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
      hasExternalMcps: false,
    });
    assert.equal(actionPlan.mode, "action");
    assert.deepEqual(actionPlan.mcpScopes, ["core", "browser", "schedule"]);

    const dir = makeTempDir("p22-lazy-mcp-");
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    const rt = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "lazy.sqlite"),
      workspaceRoot: dir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    runtimes.push(rt);

    try {
      const zeroTools = rt.studioMcpBridge.listToolsForAgent("estrategista", []);
      assert.equal(zeroTools.length, 0);

      const scopedTools = rt.studioMcpBridge.listToolsForAgent("estrategista", ["core", "browser"]);
      const scopedNames = new Set(scopedTools.map((t) => t.name));
      assert.ok(scopedNames.has("criativo_browser"), "escopo browser deve expor criativo_browser");
      assert.ok(scopedNames.has("load_skill"), "escopo core deve expor load_skill");
      assert.ok(scopedNames.has("list_agents"), "escopo core deve expor list_agents");
      assert.equal(scopedNames.has("list_tables"), false, "list_tables não deve aparecer em core+browser");
      assert.equal(scopedNames.has("run_workflow"), false, "run_workflow não deve aparecer em core+browser");
      assert.equal(scopedNames.has("create_routine"), false, "create_routine não deve aparecer em core+browser");

      const fullTools = rt.studioMcpBridge.listToolsForAgent("estrategista");
      assert.ok(fullTools.length > scopedTools.length);

      const customSkillDir = join(dir, ".agents", "skills", "skill-vendedor-teste");
      mkdirSync(customSkillDir, { recursive: true });
      const customSkillFile = join(customSkillDir, "SKILL.md");
      writeFileSync(customSkillFile, "---\nname: skill-vendedor-teste\n---\nInstruções de teste.", "utf8");

      const nowIso = new Date().toISOString();
      rt.db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status, skills_paths_json,
             memoria_resumo, ordem_exibicao, config_json, atualizado_em
           ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, 26, '{}', ?);`,
        )
        .run(
          "custom_vendedor_1234",
          "Vendedor Teste",
          "Prospecção",
          "gemini-4-argon",
          JSON.stringify([customSkillFile]),
          nowIso,
        );

      const listed = (await rt.studioMcpBridge.callToolForAgent(
        "list_agents",
        {},
        "estrategista",
      )) as { total: number; agents: Array<{ agente_id: string; apelido: string }> };
      assert.ok(
        listed.agents.some(
          (a) => a.agente_id === "custom_vendedor_1234" && a.apelido === "vendedor_teste",
        ),
      );

      const loadedCustomSkill = (await rt.studioMcpBridge.callToolForAgent(
        "load_skill",
        {},
        "custom_vendedor_1234",
      )) as { ok: boolean; content: string };
      assert.equal(loadedCustomSkill.ok, true);
      assert.match(loadedCustomSkill.content, /Instruções de teste/);
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    }
  });

  it("5. (OC22-01 & WPP22-01) OpenCode sem --pure + stderr, Antigravity lean e fallback WhatsApp sem tabelas Markdown", async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const openCodeSrc = readFileSync(
      join(repoRoot, "apps/daemon/src/providers/opencode-live-service.ts"),
      "utf8",
    );
    const cliOAuthSrc =
      readFileSync(join(repoRoot, "apps/daemon/src/providers/cli-oauth-accounts-service.ts"), "utf8") +
      "\n" +
      readFileSync(join(repoRoot, "apps/daemon/src/providers/cli-oauth/cli-turn-executor.ts"), "utf8");
    const acpSrc =
      readFileSync(join(repoRoot, "apps/daemon/src/providers/antigravity-acp-service.ts"), "utf8") +
      "\n" +
      readFileSync(join(repoRoot, "apps/daemon/src/providers/antigravity-acp-connection.ts"), "utf8");

    assert.equal(openCodeSrc.includes('["acp", "--pure"]'), false);
    assert.match(openCodeSrc, /spawnProviderProcess\(executable,\s*\["acp"\]/);
    assert.match(openCodeSrc, /stderrTail/);
    assert.match(cliOAuthSrc, /mcp_servers\./);
    assert.match(acpSrc, /--include-default-customizations=false/);
    assert.match(acpSrc, /--disable-telemetry/);

    const dir = makeTempDir("p22-wpp-fb-");
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    const rt = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "fb.sqlite"),
      workspaceRoot: dir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    runtimes.push(rt);

    try {
      const reply = await generateAgentChatReply(
        {
          db: rt.db,
          queue: rt.queue,
          vault: rt.vault,
          providers: rt.providers,
          providerConnection: rt.providerConnection,
          wsHub: rt.wsHub,
          sendJson: () => {},
          readJsonBody: async () => ({}),
          workspaceRoot: dir,
          mcpGateway: rt.mcpGateway,
          catalogService: rt.catalogService,
          skillsManager: rt.skillsManager,
          whatsappManager: rt.whatsappManager,
          whatsappOrchestrator: rt.whatsappOrchestrator,
          memoryManager: rt.memoryManager,
          browserService: rt.browserService,
          phase13: {
            threadStore: rt.threadStore,
            tasksService: rt.tasksService,
            waitsService: rt.waitsService,
            wakeupService: rt.wakeupService,
            queueControls: rt.queueControls,
            pagination: {} as any,
            sideQuestion: {} as any,
            contextReset: rt.contextReset,
            pinsService: rt.pinsService,
            onDrainLane: () => {},
          },
        },
        {
          agente_id: "designer_carrossel",
          nome: "Designer Carrossel",
          papel: "Design",
          modelo_padrao: "opencode/modelo-indisponivel-teste",
          config_json: JSON.stringify({ skill_slug: "criar-carrossel" }),
          backup_models_json: null,
        },
        "ola",
        [],
        [],
        undefined,
        { channelOrigin: "whatsapp" },
      );

      assert.doesNotMatch(reply.markdown, /\| Etapa do Plano \|/);
      assert.doesNotMatch(reply.markdown, /\|---\|/);
      assert.doesNotMatch(reply.markdown, /^#/m);
      assert.match(reply.markdown, /Designer Carrossel/);
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    }
  });

  it("6. (DOCK22-01) FloatingDockController usa flags anti-DWM e modo retrátil pinned", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const dockSrc = readFileSync(join(repoRoot, "apps/desktop/src/floating-dock.ts"), "utf8");

    assert.match(dockSrc, /thickFrame:\s*false/);
    assert.match(dockSrc, /hasShadow:\s*false/);
    assert.match(dockSrc, /roundedCorners:\s*false/);
    assert.match(dockSrc, /autoHideMenuBar:\s*true/);
    assert.match(dockSrc, /title:\s*""/);
    assert.match(dockSrc, /removeMenu/);
    assert.match(dockSrc, /safeSetBounds/);
    assert.match(dockSrc, /pinned:\s*this\.state\.pinned/);
  });
});
