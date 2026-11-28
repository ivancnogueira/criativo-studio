import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextResetService } from "../src/chat/context-reset-service.ts";
import {
  buildDeterministicHandoffPacket,
  MAX_HANDOFF_PACKET_CHARS,
} from "../src/chat/handoff-packet-builder.ts";
import { acpSessionCache } from "../src/providers/acp-session-cache.ts";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import { claudeSessionCache } from "../src/providers/cli-oauth/claude-session-settings.ts";
import { executeCliAgentTurn } from "../src/providers/cli-oauth/cli-turn-executor.ts";
import type { CliAccountRecord, CliServiceRuntimeContext } from "../src/providers/cli-oauth/cli-types-and-helpers.ts";
import { codexAppServerPool } from "../src/providers/cli-oauth/codex-app-server-client.ts";
import { OpenCodeLiveService } from "../src/providers/opencode-live-service.ts";
import { createDaemonServer } from "../src/server/daemon-server.ts";
import { prepareAgentReplySetup } from "../src/server/routes/agent-reply-setup.ts";
import type { StudioRoutesDeps } from "../src/server/routes/route-helpers.ts";

function installFakeCli(dir: string, base: string, scriptPath: string): void {
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(join(dir, `${base}.cmd`), `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
  } else {
    const p = join(dir, base);
    writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, "utf8");
    chmodSync(p, 0o755);
  }
}

function buildStudioDepsFromRuntime(rt: Awaited<ReturnType<typeof createDaemonServer>>, workspaceRoot: string): StudioRoutesDeps {
  return {
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
    workspaceRoot,
    sendJson: () => {},
    readJsonBody: async () => ({}),
  };
}

test("EX48-06 Fluxo 1: turno light ('oi') isola todas as 5 rotas sem schemas MCP ou alucinação visual", async () => {
  claudeSessionCache.clearAll();
  acpSessionCache.clearAll();
  codexAppServerPool.disposeAll();

  const root = mkdtempSync(join(tmpdir(), "crv-ex48-e2e-light-"));
  const appDataDir = join(root, "appdata");
  const codexHome = join(root, "codex-home");
  const claudeHome = join(root, "claude-home");
  const geminiDir = join(root, "gemini-home");
  const traceLog = join(root, "trace.jsonl");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(claudeHome, { recursive: true });
  mkdirSync(geminiDir, { recursive: true });
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ tokens: {} }), "utf8");
  writeFileSync(join(claudeHome, ".claude.json"), JSON.stringify({ oauthAccount: {} }), "utf8");

  const fakeScript = join(root, "fake-all.mjs");
  writeFileSync(
    fakeScript,
    `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const log = process.env.CRV_E2E_LOG;
const args = process.argv.slice(2);
if (args[0] === "app-server" || args[0] === "acp" || args[0] === "--acp") {
  const rl = createInterface({ input: process.stdin });
  rl.on("close", () => process.exit(0));
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    appendFileSync(log, JSON.stringify({ proto: args[0], args, method: msg.method, params: msg.params }) + "\\n", "utf8");
    if (msg.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: false } } } }) + "\\n");
    else if (msg.method === "authenticate") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { authenticated: true } }) + "\\n");
    else if (msg.method === "thread/start") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "thr-e2e" } } }) + "\\n");
    else if (msg.method === "turn/start") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "t1" } } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: msg.params.threadId, delta: "Oi! Tudo pronto." } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: msg.params.threadId, turn: { id: "t1", status: "completed" } } }) + "\\n");
    } else if (msg.method === "session/new") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "acp-e2e", models: { currentModelId: "m1", availableModels: [{ modelId: "m1" }] } } }) + "\\n");
    else if (msg.method === "session/prompt") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Oi via ACP" } } } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
    } else if (msg.method) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  });
} else {
  let stdinText = "";
  process.stdin.on("data", (c) => { stdinText += c.toString("utf8"); });
  process.stdin.on("end", () => {
    appendFileSync(log, JSON.stringify({ proto: "claude", args, stdinText }) + "\\n", "utf8");
    process.stdout.write(JSON.stringify({ result: "Oi via Claude", is_error: false, session_id: "cl-e2e", usage: { input_tokens: 20, output_tokens: 5 } }));
  });
}
`,
    "utf8"
  );

  installFakeCli(join(appDataDir, "CriativoStudio", "provider-runtimes", "codex", "1.0.0", "bin"), "codex", fakeScript);
  installFakeCli(join(appDataDir, "CriativoStudio", "provider-runtimes", "claude", "1.0.0", "bin"), "claude", fakeScript);
  installFakeCli(join(appDataDir, "CriativoStudio", "provider-runtimes", "opencode", "1.0.0", "bin"), "opencode", fakeScript);

  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  const prevLog = process.env.CRV_E2E_LOG;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";

  const rt = await createDaemonServer({
    workspaceRoot: root,
    dbPath: join(root, "e2e-light.sqlite"),
    port: 0,
    bypassLicense: true,
    autoStartLoops: false,
    controlSocketPath: null,
  });

  const ocService = new OpenCodeLiveService({ workspaceCwd: root, appDataDir });
  const agService = new AntigravityAcpService({
    appDataDir,
    executableOverride: process.execPath,
    spawnArgsFactory: () => [fakeScript, "acp"],
  });

  try {
    const setup = await prepareAgentReplySetup(
      buildStudioDepsFromRuntime(rt, root),
      {
        agente_id: "designer_stories",
        nome: "Designer de Stories",
        papel: "Stories 9:16",
        modelo_padrao: "openai/gpt-5.4",
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
    assert.equal(setup.turnAcpMcpServers.length, 0);
    assert.equal(setup.turnCliMcpConfig, null);

    // Ativa fakes locais para executar rotas Codex, Claude, OpenCode e Antigravity
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRV_E2E_LOG = traceLog;

    const stored: CliAccountRecord[] = [
      { id: "acc-oai", provedor: "openai", label: "OAI", configDir: codexHome, createdAt: "2026-11-28T00:00:00Z" },
      { id: "acc-cl", provedor: "claude", label: "CL", configDir: claudeHome, createdAt: "2026-11-28T00:00:00Z" },
    ];
    const makeCtx = (prov: "openai" | "claude"): CliServiceRuntimeContext => ({
      workspaceCwd: root,
      accountsRootDir: root,
      appDataDir,
      fetchImpl: fetch,
      pendingSignInAbort: new Map(),
      pendingLoopbackTarget: new Map(),
      dynamicModelsCache: new Map(),
      accountsQuotaCache: new Map(),
      getMcpConfigResolver: () => null,
      cancelPendingSignIn: () => false,
      getStoredRecords: () => stored,
      saveStoredRecords: () => {},
      getPoolConfig: () => null,
      listAccounts: () => [{ id: prov === "openai" ? "acc-oai" : "acc-cl", provedor: prov, rotulo: prov, email: null, plano: "Pro", estado: "conectado", token_valido: true }],
      invalidateModelCache: () => {},
      invalidateQuotaCache: () => {},
      listAccountsWithQuotas: async () => [{ id: prov === "openai" ? "acc-oai" : "acc-cl", provedor: prov, rotulo: prov, email: null, plano: "Pro", estado: "conectado", token_valido: true }],
      registerLoopbackTargetFromAuthUrl: () => {},
    });

    // 1. Codex
    const codexOut = await executeCliAgentTurn(makeCtx("openai"), {
      provedor: "openai",
      modelId: "gpt-5.4",
      systemPrompt: setup.promptBase,
      messages: [{ role: "user", text: "oi" }],
      agentId: "designer_stories",
      threadId: "thr-e2e",
      turnMode: setup.turnMode,
      mcpConfig: setup.turnCliMcpConfig,
    });
    assert.ok(codexOut.text.includes("app-server") === false && codexOut.text.includes("Oi!"));

    // 2. Claude
    const claudeOut = await executeCliAgentTurn(makeCtx("claude"), {
      provedor: "claude",
      modelId: "claude-sonnet-4-6",
      systemPrompt: setup.promptBase,
      messages: [{ role: "user", text: "oi" }],
      agentId: "designer_stories",
      threadId: "thr-e2e",
      turnMode: setup.turnMode,
      mcpConfig: setup.turnCliMcpConfig,
    });
    assert.equal(claudeOut.text, "Oi via Claude");

    // 3. OpenCode ACP
    const ocOut = await ocService.executePrompt({
      modelId: "opencode/m1",
      systemPrompt: setup.promptBase,
      messages: [{ role: "user", text: "oi" }],
      agentId: "designer_stories",
      threadId: "thr-e2e",
      mcpServers: setup.turnAcpMcpServers,
    });
    assert.equal(ocOut.text, "Oi via ACP");

    // 4. Antigravity ACP
    const agOut = await agService.executePrompt("acc-ag", {
      geminiDir,
      cwd: root,
      systemPrompt: setup.promptBase,
      promptText: `${setup.promptBase}\n\noi`,
      incrementalPromptText: "oi",
      modelId: "m1",
      agentId: "designer_stories",
      threadId: "thr-e2e",
      mcpServers: setup.turnAcpMcpServers,
    });
    assert.equal(agOut.text, "Oi via ACP");

    // 5. API Direta (ProviderRegistry com mock provider em modo light -> sem toolSchemas extras no turno)
    let apiReceivedToolCount = -1;
    rt.providers.registerCustomProvider("openai", {
      name: "openai",
      async generateText(prompt) {
        return `Oi! (${prompt})`;
      },
      async executeTurn(turnCtx) {
        apiReceivedToolCount = Array.isArray(turnCtx.tools) ? turnCtx.tools.length : 0;
        return {
          text: "Oi via API Direta",
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 30, outputTokens: 6 },
        };
      },
      async streamTurn(turnCtx) {
        return await this.executeTurn(turnCtx);
      },
    });
    const apiClient = rt.providers.getClientForModel("openai/gpt-5.4");
    const apiRes = await apiClient.executeTurn({
      model: "gpt-5.4",
      systemPrompt: setup.promptBase,
      messages: [{ role: "user", content: "oi" }],
      tools: [],
    });
    assert.equal(apiRes.text, "Oi via API Direta");
    assert.equal(apiReceivedToolCount, 0);

    const traces = readFileSync(traceLog, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as { proto: string; args: string[]; method?: string; params?: any });
    const claudeTrace = traces.find((t) => t.proto === "claude");
    assert.equal(claudeTrace?.args.includes("--mcp-config"), false);
    const acpNews = traces.filter((t) => t.method === "session/new");
    assert.ok(acpNews.length >= 2);
    for (const s of acpNews) {
      assert.deepEqual(s.params.mcpServers, []);
    }
  } finally {
    codexAppServerPool.disposeAll();
    claudeSessionCache.clearAll();
    acpSessionCache.clearAll();
    ocService.close();
    agService.closeAll();
    await rt.close();
    if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    else delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    if (prevLog !== undefined) process.env.CRV_E2E_LOG = prevLog;
    else delete process.env.CRV_E2E_LOG;
    await new Promise((r) => setTimeout(r, 150));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
  }
});

test("EX48-06 Fluxo 2 & 3: Action setup libera Lazy MCP e /compact gera handoff <= 32k chars preservando histórico", async () => {
  const root = mkdtempSync(join(tmpdir(), "crv-ex48-e2e-compact-"));
  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";

  const rt = await createDaemonServer({
    workspaceRoot: root,
    dbPath: join(root, "e2e-compact.sqlite"),
    port: 0,
    bypassLicense: true,
    autoStartLoops: false,
    controlSocketPath: null,
  });

  try {
    const actionSetup = await prepareAgentReplySetup(
      buildStudioDepsFromRuntime(rt, root),
      {
        agente_id: "estrategista",
        nome: "Estrategista",
        papel: "Estratégia Digital",
        modelo_padrao: "openai/gpt-5.4",
        config_json: "{}",
      },
      "Navegue na web e faça upload no Instagram com imagem gerada",
      [],
      [],
      undefined,
      { threadId: "main:estrategista" }
    );
    assert.equal(actionSetup.turnMode, "action");
    assert.ok(actionSetup.turnCliMcpConfig || actionSetup.turnAcpMcpServers.length > 0);

    // Pacote de handoff > 80k truncado deterministicamente em <= 32k preservando bordas e redigindo segredo
    const hugeMessages = Array.from({ length: 16 }, (_, idx) => ({
      role: (idx % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Bloco-${idx} ` + "detalhe extenso ".repeat(400) + ` TOKEN_SECRETO_TESTE FIM-${idx}`,
    }));
    const packet = buildDeterministicHandoffPacket({
      messages: hugeMessages,
      workSteps: [{ tool: "criativo_browser", title: "Captura concluída", status: "concluido" }],
      instructions: ["Responder em pt-br"],
      redactSecrets: ["TOKEN_SECRETO_TESTE"],
    });
    assert.ok(packet.length <= MAX_HANDOFF_PACKET_CHARS, `Handoff excedeu 32k: ${packet.length}`);
    assert.equal(packet.includes("TOKEN_SECRETO_TESTE"), false);
    assert.ok(packet.includes("FIM-15"), "Borda final da última mensagem deve ser preservada");

    // Preenche mensagens no SQLite + caches de sessão e dispara /compact via ContextResetService
    const beforeCountRow = rt.db.connection
      .prepare(`SELECT COUNT(*) AS c FROM projecao_conversas_chat WHERE agente_id = 'estrategista' AND item_type = 'mensagem';`)
      .get() as { c: number };
    rt.db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, lida, criado_em, thread_id, item_type, status, ordinal)
         VALUES ('m1', 'agente:estrategista', 'estrategista', 'usuario', 'Usuário', 'Criar série semanal de Reels sobre produtividade', '[]', '[]', 1, '2026-11-28T00:01:00.000Z', 'main:estrategista', 'mensagem', 'completed', 1),
                ('m2', 'agente:estrategista', 'estrategista', 'agente', 'Estrategista', 'Plano com 3 ganchos definido e pronto.', '[]', '[]', 1, '2026-11-28T00:02:00.000Z', 'main:estrategista', 'mensagem', 'completed', 2);`
      )
      .run();

    claudeSessionCache.set("acc-cl::estrategista::main:estrategista", {
      sessionId: "cl-warm",
      fingerprint: "fp-1",
      updatedAtMs: Date.now(),
    });
    acpSessionCache.setSession({
      key: "opencode::default::estrategista::main:estrategista",
      provider: "opencode",
      connectionRef: {},
      sessionId: "oc-warm",
      fingerprint: "fp-1",
      modelId: "m1",
      createdAtMs: Date.now(),
      lastUsedAtMs: Date.now(),
    });

    const broadcasted: Array<{ event: string; payload: any }> = [];
    const spyHub = {
      broadcast(event: string, payload: unknown) {
        broadcasted.push({ event, payload });
      },
    } as unknown as typeof rt.wsHub;

    const resetSvc = new ContextResetService({
      db: rt.db,
      wsHub: spyHub,
      providers: rt.providers,
      providerConnection: rt.providerConnection,
    });

    const res = resetSvc.executeContextReset("estrategista", { forceImmediate: true });
    assert.ok(res.cutoff_at);
    assert.ok(res.memorias_salvas >= 1);

    assert.equal(claudeSessionCache.getValid("acc-cl::estrategista::main:estrategista", "fp-1"), null);
    assert.equal(acpSessionCache.getValidSession("opencode::default::estrategista::main:estrategista", {}, "fp-1").reusable, null);

    const remainingVisualCount = rt.db.connection
      .prepare(`SELECT COUNT(*) AS c FROM projecao_conversas_chat WHERE agente_id = 'estrategista' AND item_type = 'mensagem';`)
      .get() as { c: number };
    assert.equal(remainingVisualCount.c, beforeCountRow.c + 2, "Histórico visual deve ser 100% preservado");

    assert.ok(broadcasted.some((b) => b.event === "context:reset"));
    const evtCompact = broadcasted.find((b) => b.event === "contexto.compactado");
    assert.ok(evtCompact, "Deve emitir evento WS contexto.compactado");
    assert.equal(evtCompact.payload.modo, "manual");
    assert.ok(evtCompact.payload.chars_handoff <= MAX_HANDOFF_PACKET_CHARS);
  } finally {
    claudeSessionCache.clearAll();
    acpSessionCache.clearAll();
    await rt.close();
    if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    else delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
