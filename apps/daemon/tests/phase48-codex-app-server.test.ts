import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  executeCliAgentTurn,
} from "../src/providers/cli-oauth/cli-turn-executor.ts";
import { codexAppServerPool } from "../src/providers/cli-oauth/codex-app-server-client.ts";
import { buildCodexConfigOverrideArgs } from "../src/providers/cli-oauth/codex-prompt-settings.ts";
import type { CliAccountRecord, CliServiceRuntimeContext } from "../src/providers/cli-oauth/cli-types-and-helpers.ts";

function setupFakeCodexFixture() {
  const root = mkdtempSync(join(tmpdir(), "crv-ex48-codex-"));
  const appDataDir = join(root, "appdata");
  const codexHome = join(root, "codex-home");
  const logFile = join(root, "rpc-log.jsonl");
  const runtimeBinDir = join(appDataDir, "CriativoStudio", "provider-runtimes", "codex", "1.0.0", "bin");
  mkdirSync(runtimeBinDir, { recursive: true });
  mkdirSync(codexHome, { recursive: true });

  writeFileSync(
    join(codexHome, "auth.json"),
    JSON.stringify({ tokens: { id_token: "" } }),
    "utf8"
  );

  const fakeScript = join(root, "fake-codex.mjs");
  writeFileSync(
    fakeScript,
    `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const logFile = process.env.CRV_FAKE_LOG_FILE;
const rejectAppServer = process.env.CRV_FAKE_REJECT_APP_SERVER === "1";
const args = process.argv.slice(2);
const record = (entry) => appendFileSync(logFile, JSON.stringify({ pid: process.pid, ...entry }) + "\\n", "utf8");

if (args[0] === "app-server") {
  if (rejectAppServer) {
    process.stderr.write("error: unknown subcommand 'app-server'\\n");
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin });
  let threadCounter = 0;
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    record({ kind: "rpc", args, method: msg.method, params: msg.params });
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { userAgent: "fake-codex/1.0" } }) + "\\n");
    } else if (msg.method === "thread/start") {
      threadCounter += 1;
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "thr-" + threadCounter } } }) + "\\n");
    } else if (msg.method === "thread/compact/start") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }) + "\\n");
    } else if (msg.method === "turn/start") {
      const tId = msg.params.threadId;
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn-1" } } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: tId, delta: "Olá " } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: tId, delta: "via app-server!" } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "thread/tokenUsage/updated", params: { threadId: tId, tokenUsage: { total: { input_tokens: 120, cached_input_tokens: 90, output_tokens: 14 } } } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: tId, turn: { id: "turn-1", status: "completed" } } }) + "\\n");
    }
  });
} else if (args[0] === "exec") {
  let stdinData = "";
  process.stdin.on("data", (c) => { stdinData += c.toString("utf8"); });
  process.stdin.on("end", () => {
    record({ kind: "exec", args, stdin: stdinData });
    process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Resposta via fallback exec" } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 60, cached_input_tokens: 0, output_tokens: 8 } }) + "\\n");
  });
}
`,
    "utf8"
  );

  if (process.platform === "win32") {
    writeFileSync(
      join(runtimeBinDir, "codex.cmd"),
      `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`,
      "utf8"
    );
  } else {
    const shPath = join(runtimeBinDir, "codex");
    writeFileSync(shPath, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, "utf8");
    chmodSync(shPath, 0o755);
  }

  const stored: CliAccountRecord[] = [
    {
      id: "acc-codex-1",
      provedor: "openai",
      label: "Conta Teste",
      configDir: codexHome,
      createdAt: "2026-11-28T00:00:00.000Z",
    },
  ];

  const ctx: CliServiceRuntimeContext = {
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
    listAccounts: () => [
      {
        id: "acc-codex-1",
        provedor: "openai",
        rotulo: "Conta Teste",
        email: null,
        plano: "Pro",
        estado: "conectado",
        token_valido: true,
      },
    ],
    invalidateModelCache: () => {},
    invalidateQuotaCache: () => {},
    listAccountsWithQuotas: async () => [
      {
        id: "acc-codex-1",
        provedor: "openai",
        rotulo: "Conta Teste",
        email: null,
        plano: "Pro",
        estado: "conectado",
        token_valido: true,
      },
    ],
    registerLoopbackTargetFromAuthUrl: () => {},
  };

  return {
    root,
    logFile,
    ctx,
    cleanup: () => {
      codexAppServerPool.disposeAll();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("EX48-04: CodexAppServerPool reutiliza processo/thread, invalida por fingerprint, compacta e faz fallback para exec", async () => {
  const fix = setupFakeCodexFixture();
  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  const prevLog = process.env.CRV_FAKE_LOG_FILE;
  const prevReject = process.env.CRV_FAKE_REJECT_APP_SERVER;
  delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRV_FAKE_LOG_FILE = fix.logFile;
  delete process.env.CRV_FAKE_REJECT_APP_SERVER;

  try {
    // 1. Turno frio: initialize + thread/start + turn/start com streaming e usage
    const deltas: string[] = [];
    const r1 = await executeCliAgentTurn(fix.ctx, {
      provedor: "openai",
      modelId: "gpt-5.4",
      systemPrompt: "PERSONA CURTA DO ESTUDIO",
      messages: [
        { role: "user", text: "contexto anterior grande ".repeat(5) },
        { role: "assistant", text: "ok" },
        { role: "user", text: "primeira pergunta real" },
      ],
      agentId: "estrategista",
      threadId: "thr-chat-1",
      turnMode: "light",
      onDelta: (c) => deltas.push(c),
    });

    assert.equal(r1.text, "Olá via app-server!");
    assert.deepEqual(deltas, ["Olá ", "via app-server!"]);
    assert.equal(r1.usage.cachedInput, 90);
    assert.equal(r1.usage.uncachedInput, 30);
    assert.equal(r1.usage.output, 14);

    // 2. Turno quente na mesma thread/fingerprint: mesmo PID, zero thread/start e payload só da nova mensagem
    const r2 = await executeCliAgentTurn(fix.ctx, {
      provedor: "openai",
      modelId: "gpt-5.4",
      systemPrompt: "PERSONA CURTA DO ESTUDIO",
      messages: [
        { role: "user", text: "primeira pergunta real" },
        { role: "assistant", text: "Olá via app-server!" },
        { role: "user", text: "segunda mensagem curta" },
      ],
      agentId: "estrategista",
      threadId: "thr-chat-1",
      turnMode: "light",
    });
    assert.equal(r2.text, "Olá via app-server!");

    // 3. Mudança de turnMode para 'action' altera fingerprint e abre novo worker/thread limpa
    const r3 = await executeCliAgentTurn(fix.ctx, {
      provedor: "openai",
      modelId: "gpt-5.4",
      systemPrompt: "PERSONA CURTA DO ESTUDIO",
      messages: [{ role: "user", text: "gerar campanha" }],
      agentId: "estrategista",
      threadId: "thr-chat-1",
      turnMode: "action",
      mcpConfig: { mcpServers: { criativo_studio: { url: "http://127.0.0.1:9999/mcp" } } },
    });
    assert.equal(r3.text, "Olá via app-server!");

    // 4. Compactação nativa dispara thread/compact/start
    const compacted = await codexAppServerPool.compactThread({
      agenteId: "estrategista",
      threadId: "thr-chat-1",
      accountId: "acc-codex-1",
    });
    assert.equal(compacted, true);

    const events = readFileSync(fix.logFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as { pid: number; kind: string; method?: string; params?: any; args?: string[] });

    const rpcs = events.filter((e) => e.kind === "rpc");
    const lightThreadStarts = rpcs.filter(
      (e) => e.method === "thread/start" && e.args?.includes("agents.enabled=false")
    );
    const lightTurnStarts = rpcs.filter(
      (e) => e.method === "turn/start" && e.args?.includes("agents.enabled=false")
    );
    assert.equal(lightThreadStarts.length, 1, "Turno 2 não deve chamar thread/start novamente");
    assert.equal(lightTurnStarts.length, 2);
    assert.equal(lightTurnStarts[0].pid, lightTurnStarts[1].pid, "Deve reusar o mesmo PID app-server");
    assert.equal(lightTurnStarts[1].params.input[0].text, "segunda mensagem curta");
    assert.ok(rpcs.some((e) => e.method === "thread/compact/start"));

    // 5. Fallback automático para codex exec quando binário não suporta app-server
    codexAppServerPool.disposeAll();
    process.env.CRV_FAKE_REJECT_APP_SERVER = "1";
    const rFallback = await executeCliAgentTurn(fix.ctx, {
      provedor: "openai",
      modelId: "gpt-5.4",
      systemPrompt: "PERSONA TESTE",
      messages: [{ role: "user", text: "oi" }],
      agentId: "estrategista",
      threadId: "thr-chat-2",
      turnMode: "light",
      mcpConfig: { mcpServers: { criativo_studio: { url: "http://127.0.0.1:9999/mcp" } } },
    });
    assert.equal(rFallback.text, "Resposta via fallback exec");

    const allEventsAfter = readFileSync(fix.logFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as { kind: string; args?: string[] });
    const execEvent = allEventsAfter.find((e) => e.kind === "exec");
    assert.ok(execEvent?.args?.includes("features.tool_suggest=false"));
    assert.ok(execEvent?.args?.includes("agents.enabled=false"));
    assert.equal(execEvent?.args?.some((a) => a.startsWith("mcp_servers.")), false);

    // OverrideArgs unitário confirma flags esperadas
    const lightOverrides = buildCodexConfigOverrideArgs({
      mcpConfig: { mcpServers: { criativo_studio: { url: "http://127.0.0.1:1/mcp" } } },
      turnMode: "light",
    });
    assert.ok(lightOverrides.includes("features.recommended_plugins=false"));
    assert.ok(lightOverrides.includes("agents.enabled=false"));
    assert.equal(lightOverrides.some((a) => a.startsWith("mcp_servers.")), false);
  } finally {
    if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    else delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    if (prevLog !== undefined) process.env.CRV_FAKE_LOG_FILE = prevLog;
    else delete process.env.CRV_FAKE_LOG_FILE;
    if (prevReject !== undefined) process.env.CRV_FAKE_REJECT_APP_SERVER = prevReject;
    else delete process.env.CRV_FAKE_REJECT_APP_SERVER;
    fix.cleanup();
  }
});
