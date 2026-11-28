import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createDaemonServer } from "../src/server/daemon-server.ts";
import { prepareAgentReplySetup } from "../src/server/routes/agent-reply-setup.ts";
import type { StudioRoutesDeps } from "../src/server/routes/route-helpers.ts";

function makeJsonRpcReq(body: unknown, token: string, query = ""): IncomingMessage {
  const payload = JSON.stringify(body);
  const req = Readable.from([Buffer.from(payload, "utf8")]) as unknown as IncomingMessage;
  req.headers = { "x-criativo-mcp-token": token };
  req.method = "POST";
  req.url = `/api/internal/mcp${query}`;
  return req;
}

async function callMcpHttp(
  bridge: {
    handleHttpRequest: (
      req: IncomingMessage,
      res: ServerResponse,
      path: string,
      method: string,
      url: URL,
      readJsonBody: (r: IncomingMessage) => Promise<Record<string, unknown>>
    ) => Promise<boolean>;
    getAuthToken: () => string;
  },
  body: Record<string, unknown>,
  query = ""
): Promise<Record<string, unknown>> {
  const token = bridge.getAuthToken();
  const req = makeJsonRpcReq(body, token, query);
  let statusCode = 0;
  let rawBody = "";
  const res = {
    writeHead(code: number) {
      statusCode = code;
      return this;
    },
    end(chunk?: string | Buffer) {
      rawBody += chunk ? chunk.toString() : "";
      return this;
    },
  } as unknown as ServerResponse;

  await bridge.handleHttpRequest(
    req,
    res,
    "/api/internal/mcp",
    "POST",
    new URL(`http://127.0.0.1/api/internal/mcp${query}`),
    async () => body
  );
  assert.equal(statusCode, 200);
  return JSON.parse(rawBody) as Record<string, unknown>;
}

test("EX48-02: Lazy MCP reduz tools/list >= 65%, retorna schemas+guidance top-3 no tool_search e despacha tool_call", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "crv-ex48-mcp-"));
  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";

  const rt = await createDaemonServer({
    workspaceRoot: tmpDir,
    dbPath: join(tmpDir, "mcp-lazy.sqlite"),
    port: 0,
    bypassLicense: true,
    autoStartLoops: false,
    controlSocketPath: null,
  });

  try {
    const fullAuthorized = rt.studioMcpBridge.listToolsForAgent("estrategista");
    const fullBytes = Buffer.byteLength(JSON.stringify(fullAuthorized), "utf8");

    const listResp = (await callMcpHttp(
      rt.studioMcpBridge,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      "?agentId=estrategista"
    )) as { result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> } };

    const lazyBytes = Buffer.byteLength(JSON.stringify(listResp.result.tools), "utf8");
    const reductionRatio = 1 - lazyBytes / fullBytes;
    const exposedNames = new Set(listResp.result.tools.map((t) => t.name));

    assert.ok(fullAuthorized.length >= 25, "Deve haver dezenas de tools autorizadas no catálogo completo");
    assert.ok(listResp.result.tools.length <= 16, `Esperado <= 16 tools no MCP lazy, veio ${listResp.result.tools.length}`);
    assert.ok(reductionRatio >= 0.65, `Redução esperada >= 65%, obtida ${Math.round(reductionRatio * 100)}%`);
    assert.ok(exposedNames.has("tool_search"));
    assert.ok(exposedNames.has("tool_describe"));
    assert.ok(exposedNames.has("tool_call"));

    // Modo compacto específico Antigravity
    const agListResp = (await callMcpHttp(
      rt.studioMcpBridge,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      "?agentId=estrategista&provider=antigravity"
    )) as { result: { tools: Array<{ name: string; inputSchema: { required?: string[] } }> } };
    const agSearch = agListResp.result.tools.find((t) => t.name === "tool_search");
    assert.deepEqual(agSearch?.inputSchema.required, ["query"]);

    // tool_search já embute inputSchema + guidance para os top-3 matches fortes
    const searchCall = (await callMcpHttp(
      rt.studioMcpBridge,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "tool_search", arguments: { query: "criativo_browser" } },
      },
      "?agentId=estrategista"
    )) as { result: { content: Array<{ text: string }>; isError: boolean } };
    assert.equal(searchCall.result.isError, false);
    const searchPayload = JSON.parse(searchCall.result.content[0]!.text) as {
      ok: boolean;
      resultados: Array<{ name: string; inputSchema?: Record<string, unknown> }>;
      guidance?: string[];
    };
    assert.equal(searchPayload.ok, true);
    const browserMatch = searchPayload.resultados.find((r) => r.name === "criativo_browser");
    assert.ok(browserMatch?.inputSchema, "Match forte deve vir com inputSchema direto no tool_search");
    assert.ok(
      searchPayload.guidance?.some((g) => g.includes("[Guia Browser CDP]")),
      "tool_search deve entregar guidance sob demanda"
    );

    // tool_call despacha ferramenta secundária autorizada (list_tables)
    const callTables = (await callMcpHttp(
      rt.studioMcpBridge,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "tool_call", arguments: { tool_name: "list_tables", arguments: {} } },
      },
      "?agentId=estrategista"
    )) as { result: { isError: boolean } };
    assert.equal(callTables.result.isError, false);
  } finally {
    await rt.close();
    if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("EX48-02: modo light ('oi') em designer_stories omite REGRA ANTI-ALUCINACAO VISUAL e MCPs", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "crv-ex48-light-"));
  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";

  const rt = await createDaemonServer({
    workspaceRoot: tmpDir,
    dbPath: join(tmpDir, "light.sqlite"),
    port: 0,
    bypassLicense: true,
    autoStartLoops: false,
    controlSocketPath: null,
  });

  try {
    const studioDeps: StudioRoutesDeps = {
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
    const setup = await prepareAgentReplySetup(
      studioDeps,
      {
        agente_id: "designer_stories",
        nome: "Designer de Stories",
        papel: "Criação visual 9:16",
        modelo_padrao: "openai/gpt-6.2-sol",
        config_json: JSON.stringify({ skill_slug: "gerar-stories" }),
      },
      "oi",
      [],
      [],
      undefined,
      { threadId: "main:designer_stories" }
    );

    assert.equal(setup.turnMode, "light");
    assert.equal(setup.promptBase.includes("REGRA ANTI-ALUCINAÇÃO VISUAL"), false);
    assert.equal(setup.studioToolsPromptGuidance, "");
    assert.equal(setup.turnAcpMcpServers.length, 0);
    assert.equal(setup.turnCliMcpConfig, null);
    assert.ok(
      Buffer.byteLength(setup.promptBase, "utf8") <= 2500,
      `Prompt light excedeu 2500 bytes: ${Buffer.byteLength(setup.promptBase, "utf8")}`
    );
  } finally {
    await rt.close();
    if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
