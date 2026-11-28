import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

async function loadDaemonModule(relDistJs, relSrcTs) {
  const distPath = join(repoRoot, "apps", "daemon", "dist", relDistJs);
  const srcPath = join(repoRoot, "apps", "daemon", "src", relSrcTs);
  const target = existsSync(distPath) ? distPath : srcPath;
  return await import(pathToFileURL(target).href);
}

async function main() {
  const budgetPath = join(repoRoot, "apps", "daemon", "config", "agent-context-budget.json");
  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));

  const { createDaemonServer } = await loadDaemonModule("server/daemon-server.js", "server/daemon-server.ts");
  const { prepareAgentReplySetup } = await loadDaemonModule(
    "server/routes/agent-reply-setup.js",
    "server/routes/agent-reply-setup.ts"
  );
  const { measureTotalGuidanceBytes } = await loadDaemonModule(
    "engine/tools/tool-guidance-registry.js",
    "engine/tools/tool-guidance-registry.ts"
  );
  const { formatMcpToolsListPayload } = await loadDaemonModule(
    "mcp/mcp-lazy-catalog.js",
    "mcp/mcp-lazy-catalog.ts"
  );

  const tmpDir = mkdtempSync(join(tmpdir(), "crv-budget-check-"));
  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";

  const rt = await createDaemonServer({
    workspaceRoot: tmpDir,
    dbPath: join(tmpDir, "budget.sqlite"),
    port: 0,
    bypassLicense: true,
    autoStartLoops: false,
    controlSocketPath: null,
  });

  try {
    const studioDeps = {
      db: rt.db,
      queue: rt.queue,
      vault: rt.vault,
      providers: rt.providers,
      providerConnection: rt.providerConnection,
      wsHub: rt.wsHub,
      mcpGateway: rt.mcpGateway,
      catalogService: rt.catalogService,
      skillsManager: rt.skillsManager,
      workflowStore: rt.workflowStore,
      workflowEngine: rt.workflowEngine,
      memoryManager: rt.memoryManager,
      browserService: rt.browserService,
      screenCapture: rt.screenCapture,
      showcaseService: rt.showcaseService,
      remoteClaimService: rt.remoteClaimService,
      workspaceRoot: tmpDir,
      sendJson: () => {},
      readJsonBody: async () => ({}),
    };

    const agentStub = {
      agente_id: "designer_stories",
      nome: "Designer de Stories",
      papel: "Criação visual 9:16",
      modelo_padrao: "openai/gpt-6.2-sol",
      config_json: JSON.stringify({ skill_slug: "gerar-stories" }),
    };

    const lightSetup = await prepareAgentReplySetup(
      studioDeps,
      agentStub,
      "oi",
      [],
      [],
      undefined,
      { threadId: "main:designer_stories" }
    );

    const actionSetup = await prepareAgentReplySetup(
      studioDeps,
      agentStub,
      "Criar carrossel para Instagram e buscar tendências no browser com legenda estratégica",
      [],
      [],
      undefined,
      { threadId: "main:designer_stories" }
    );

    const defaultMcpTools = rt.studioMcpBridge.listMcpExposedToolsForAgent("estrategista");
    const agMcpTools = rt.studioMcpBridge.listMcpExposedToolsForAgent("estrategista", null, {
      provider: "antigravity",
    });

    const defaultToolsPayloadBytes = Buffer.byteLength(
      JSON.stringify(formatMcpToolsListPayload(defaultMcpTools)),
      "utf8"
    );
    const agToolsPayloadBytes = Buffer.byteLength(
      JSON.stringify(formatMcpToolsListPayload(agMcpTools)),
      "utf8"
    );
    const totalGuidanceBytes = measureTotalGuidanceBytes();

    const checks = [
      {
        metric: "prompt.light.maxBytes",
        measured: Buffer.byteLength(lightSetup.promptBase, "utf8"),
        limit: Number(budget["prompt.light.maxBytes"]),
      },
      {
        metric: "prompt.action.maxBytes",
        measured: Buffer.byteLength(actionSetup.promptBase, "utf8"),
        limit: Number(budget["prompt.action.maxBytes"]),
      },
      {
        metric: "mcp.tools_list.default.maxBytes",
        measured: defaultToolsPayloadBytes,
        limit: Number(budget["mcp.tools_list.default.maxBytes"]),
      },
      {
        metric: "mcp.tools_list.antigravity.maxBytes",
        measured: agToolsPayloadBytes,
        limit: Number(budget["mcp.tools_list.antigravity.maxBytes"]),
      },
      {
        metric: "mcp.tools_list.maxToolsCount",
        measured: defaultMcpTools.length,
        limit: Number(budget["mcp.tools_list.maxToolsCount"]),
      },
      {
        metric: "guidance.total.maxBytes",
        measured: totalGuidanceBytes,
        limit: Number(budget["guidance.total.maxBytes"]),
      },
    ];

    console.log("check:context-budget — Orçamento de Contexto e MCP:");
    let failed = false;
    for (const item of checks) {
      const ok = item.measured <= item.limit;
      if (!ok) failed = true;
      const pct = Math.round((item.measured / Math.max(1, item.limit)) * 100);
      console.log(
        `  - ${ok ? "OK" : "EXCEDIDO"} ${item.metric}: ${item.measured} / ${item.limit} (${pct}%)`
      );
    }

    if (failed) {
      console.error("FALHA: Um ou mais limites de agent-context-budget.json foram excedidos.");
      process.exitCode = 1;
    }
  } finally {
    await rt.close();
    if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

await main();
