import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acpSessionCache } from "../src/providers/acp-session-cache.ts";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import {
  buildClaudeCliArgs,
  buildClaudeEnv,
  claudeSessionCache,
} from "../src/providers/cli-oauth/claude-session-settings.ts";
import { executeCliAgentTurn } from "../src/providers/cli-oauth/cli-turn-executor.ts";
import type { CliAccountRecord, CliServiceRuntimeContext } from "../src/providers/cli-oauth/cli-types-and-helpers.ts";
import { OpenCodeLiveService } from "../src/providers/opencode-live-service.ts";

function installFakeBin(dir: string, binBase: string, scriptPath: string): string {
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const cmdPath = join(dir, `${binBase}.cmd`);
    writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    return cmdPath;
  }
  const shPath = join(dir, binBase);
  writeFileSync(shPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, "utf8");
  chmodSync(shPath, 0o755);
  return shPath;
}

test("EX48-05: Claude CLI aplica higiene nativa, omite MCP no light e reutiliza --resume com retry limpo", async () => {
  claudeSessionCache.clearAll();
  const root = mkdtempSync(join(tmpdir(), "crv-ex48-claude-"));
  const appDataDir = join(root, "appdata");
  const claudeHome = join(root, "claude-home");
  const logFile = join(root, "claude-invocations.jsonl");
  mkdirSync(claudeHome, { recursive: true });
  writeFileSync(join(claudeHome, ".claude.json"), JSON.stringify({ oauthAccount: {} }), "utf8");

  const fakeScript = join(root, "fake-claude.mjs");
  writeFileSync(
    fakeScript,
    `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const logFile = process.env.CRV_CLAUDE_LOG;
const failFile = process.env.CRV_CLAUDE_FAIL_RESUME_ONCE;
let stdinText = "";
process.stdin.on("data", (c) => { stdinText += c.toString("utf8"); });
process.stdin.on("end", () => {
  appendFileSync(logFile, JSON.stringify({ args, stdinText }) + "\\n", "utf8");
  const isResume = args.includes("--resume");
  if (isResume && failFile && readFileSync(failFile, "utf8").trim() === "1") {
    writeFileSync(failFile, "0", "utf8");
    process.stderr.write("error: session not found");
    process.exit(1);
  }
  const sidIdx = args.indexOf("--session-id");
  const resIdx = args.indexOf("--resume");
  const sid = resIdx >= 0 ? args[resIdx + 1] : (sidIdx >= 0 ? args[sidIdx + 1] : "claude-s1");
  process.stdout.write(JSON.stringify({
    result: isResume ? "Resposta quente Claude" : "Resposta fria Claude",
    is_error: false,
    session_id: sid,
    usage: { input_tokens: isResume ? 15 : 120, cache_read_input_tokens: isResume ? 80 : 0, output_tokens: 10 },
  }));
});
`,
    "utf8"
  );

  const failFlagFile = join(root, "fail-resume-once.txt");
  writeFileSync(failFlagFile, "0", "utf8");
  installFakeBin(
    join(appDataDir, "CriativoStudio", "provider-runtimes", "claude", "1.0.0", "bin"),
    "claude",
    fakeScript
  );

  // Asserts diretos dos helpers de higiene
  const envCheck = buildClaudeEnv(claudeHome);
  assert.equal(envCheck.ENABLE_TOOL_SEARCH, "true");
  assert.equal(envCheck.DISABLE_AUTOUPDATER, "1");
  assert.equal(envCheck.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");

  const lightArgs = buildClaudeCliArgs({
    targetModel: "claude-sonnet-4-6",
    mcpConfigFile: "/tmp/ignored.json",
    newSessionId: "s-light",
    turnMode: "light",
  });
  assert.equal(lightArgs.includes("--mcp-config"), false);
  assert.equal(lightArgs.includes("--allowedTools"), false);
  assert.ok(lightArgs.includes("--strict-mcp-config"));
  assert.ok(lightArgs.includes("--disallowedTools"));

  const stored: CliAccountRecord[] = [
    { id: "acc-claude-1", provedor: "claude", label: "Claude", configDir: claudeHome, createdAt: "2026-11-28T00:00:00Z" },
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
    listAccounts: () => [{ id: "acc-claude-1", provedor: "claude", rotulo: "Claude", email: null, plano: "Pro", estado: "conectado", token_valido: true }],
    invalidateModelCache: () => {},
    invalidateQuotaCache: () => {},
    listAccountsWithQuotas: async () => [{ id: "acc-claude-1", provedor: "claude", rotulo: "Claude", email: null, plano: "Pro", estado: "conectado", token_valido: true }],
    registerLoopbackTargetFromAuthUrl: () => {},
  };

  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  const prevLog = process.env.CRV_CLAUDE_LOG;
  const prevFail = process.env.CRV_CLAUDE_FAIL_RESUME_ONCE;
  delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRV_CLAUDE_LOG = logFile;
  process.env.CRV_CLAUDE_FAIL_RESUME_ONCE = failFlagFile;

  try {
    // Turno 1: frio com --session-id e --system-prompt
    const r1 = await executeCliAgentTurn(ctx, {
      provedor: "claude",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "SYSTEM PROMPT ESTUDIO",
      messages: [
        { role: "user", text: "msg anterior 1" },
        { role: "assistant", text: "resp 1" },
        { role: "user", text: "pergunta 1" },
      ],
      agentId: "estrategista",
      threadId: "thr-cl-1",
      turnMode: "action",
      mcpConfig: { mcpServers: { criativo_studio: { url: "http://127.0.0.1:9999/mcp" } } },
    });
    assert.equal(r1.text, "Resposta fria Claude");

    // Turno 2: quente com --resume recebendo só "pergunta 2" no stdin
    const r2 = await executeCliAgentTurn(ctx, {
      provedor: "claude",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "SYSTEM PROMPT ESTUDIO",
      messages: [
        { role: "user", text: "pergunta 1" },
        { role: "assistant", text: "Resposta fria Claude" },
        { role: "user", text: "pergunta 2" },
      ],
      agentId: "estrategista",
      threadId: "thr-cl-1",
      turnMode: "action",
      mcpConfig: { mcpServers: { criativo_studio: { url: "http://127.0.0.1:9999/mcp" } } },
    });
    assert.equal(r2.text, "Resposta quente Claude");

    // Turno 3: falha simulada no --resume -> auto-retry limpo com --session-id novo
    writeFileSync(failFlagFile, "1", "utf8");
    const r3 = await executeCliAgentTurn(ctx, {
      provedor: "claude",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "SYSTEM PROMPT ESTUDIO",
      messages: [{ role: "user", text: "pergunta 3" }],
      agentId: "estrategista",
      threadId: "thr-cl-1",
      turnMode: "action",
      mcpConfig: { mcpServers: { criativo_studio: { url: "http://127.0.0.1:9999/mcp" } } },
    });
    assert.equal(r3.text, "Resposta fria Claude");

    const runs = readFileSync(logFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as { args: string[]; stdinText: string });

    assert.equal(runs.length, 4);
    assert.ok(runs[0].args.includes("--session-id") && runs[0].args.includes("--system-prompt"));
    assert.ok(runs[1].args.includes("--resume") && !runs[1].args.includes("--system-prompt"));
    assert.equal(runs[1].stdinText, "pergunta 2");
    assert.ok(runs[2].args.includes("--resume"));
    assert.ok(runs[3].args.includes("--session-id"), "Após falha de --resume deve recriar sessão limpa");
  } finally {
    claudeSessionCache.clearAll();
    if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    else delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    if (prevLog !== undefined) process.env.CRV_CLAUDE_LOG = prevLog;
    else delete process.env.CRV_CLAUDE_LOG;
    if (prevFail !== undefined) process.env.CRV_CLAUDE_FAIL_RESUME_ONCE = prevFail;
    else delete process.env.CRV_CLAUDE_FAIL_RESUME_ONCE;
    rmSync(root, { recursive: true, force: true });
  }
});

test("EX48-05: OpenCode ACP e Antigravity ACP reutilizam sessionId, invalidam ao trocar fingerprint e no /compact", async () => {
  acpSessionCache.clearAll();
  const root = mkdtempSync(join(tmpdir(), "crv-ex48-acp-"));
  const appDataDir = join(root, "appdata");
  const geminiDir = join(root, "gemini-acc-1");
  const logFile = join(root, "acp-log.jsonl");
  mkdirSync(geminiDir, { recursive: true });

  const fakeAcpScript = join(root, "fake-acp.mjs");
  writeFileSync(
    fakeAcpScript,
    `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const logFile = process.env.CRV_ACP_LOG;
let sessCounter = 0;
const rl = createInterface({ input: process.stdin });
rl.on("close", () => process.exit(0));
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  appendFileSync(logFile, JSON.stringify({ method: msg.method, params: msg.params }) + "\\n", "utf8");
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: false } } } }) + "\\n");
  } else if (msg.method === "authenticate") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { authenticated: true } }) + "\\n");
  } else if (msg.method === "session/new") {
    sessCounter += 1;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        sessionId: "sess-" + sessCounter,
        models: { currentModelId: "m-1", availableModels: [{ modelId: "m-1" }, { modelId: "m-2" }] },
      },
    }) + "\\n");
  } else if (msg.method === "session/set_model" || msg.method === "session/set_config_option" || msg.method === "session/close") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  } else if (msg.method === "session/prompt") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK ACP " + msg.params.sessionId } } },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
  }
});
`,
    "utf8"
  );

  installFakeBin(
    join(appDataDir, "CriativoStudio", "provider-runtimes", "opencode", "1.0.0", "bin"),
    "opencode",
    fakeAcpScript
  );

  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  const prevLog = process.env.CRV_ACP_LOG;
  delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRV_ACP_LOG = logFile;

  const ocService = new OpenCodeLiveService({ workspaceCwd: root, appDataDir });
  const agService = new AntigravityAcpService({
    appDataDir,
    executableOverride: process.execPath,
    spawnArgsFactory: () => [fakeAcpScript],
  });

  try {
    // OpenCode: Turno 1 -> session/new, Turno 2 -> mesmo sessionId + texto curto, Turno 3 (m-2) -> session/close + session/new
    const oc1 = await ocService.executePrompt({
      modelId: "opencode/m-1",
      systemPrompt: "SYS OC",
      messages: [
        { role: "user", text: "histórico inicial longo" },
        { role: "assistant", text: "certo" },
        { role: "user", text: "ola 1" },
      ],
      agentId: "estrategista",
      threadId: "thr-oc-1",
      mcpServers: [],
    });
    const oc2 = await ocService.executePrompt({
      modelId: "opencode/m-1",
      systemPrompt: "SYS OC",
      messages: [{ role: "user", text: "ola 2" }],
      agentId: "estrategista",
      threadId: "thr-oc-1",
      mcpServers: [],
    });
    const oc3 = await ocService.executePrompt({
      modelId: "opencode/m-2",
      systemPrompt: "SYS OC",
      messages: [{ role: "user", text: "ola 3" }],
      agentId: "estrategista",
      threadId: "thr-oc-1",
      mcpServers: [],
    });
    assert.equal(oc1.text, "OK ACP sess-1");
    assert.equal(oc2.text, "OK ACP sess-1");
    assert.equal(oc3.text, "OK ACP sess-2");

    // Antigravity: Turno 1 -> session/new, Turno 2 -> reuso, invalidação explícita -> nova sessão
    const ag1 = await agService.executePrompt("acc-ag-1", {
      geminiDir,
      cwd: root,
      systemPrompt: "SYS AG",
      promptText: "SYS AG\n\npedido 1",
      incrementalPromptText: "pedido 2",
      modelId: "m-1",
      agentId: "designer",
      threadId: "thr-ag-1",
      mcpServers: [],
    });
    const ag2 = await agService.executePrompt("acc-ag-1", {
      geminiDir,
      cwd: root,
      systemPrompt: "SYS AG",
      promptText: "SYS AG\n\npedido 2 completo",
      incrementalPromptText: "pedido 2",
      modelId: "m-1",
      agentId: "designer",
      threadId: "thr-ag-1",
      mcpServers: [],
    });
    assert.equal(ag1.text, "OK ACP sess-1");
    assert.equal(ag2.text, "OK ACP sess-1");

    const invalidated = acpSessionCache.invalidateByAgentAndThread("designer", "thr-ag-1");
    assert.equal(invalidated, 1);

    const ag3 = await agService.executePrompt("acc-ag-1", {
      geminiDir,
      cwd: root,
      systemPrompt: "SYS AG",
      promptText: "SYS AG\n\npedido 3 após compact",
      incrementalPromptText: "pedido 3",
      modelId: "m-1",
      agentId: "designer",
      threadId: "thr-ag-1",
      mcpServers: [],
    });
    assert.equal(ag3.text, "OK ACP sess-2");

    const events = readFileSync(logFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as { method: string; params: any });
    const prompts = events.filter((e) => e.method === "session/prompt");
    assert.equal(prompts[1]?.params?.prompt?.[0]?.text, "ola 2");
    assert.equal(prompts[4]?.params?.prompt?.[0]?.text, "pedido 2");
    assert.ok(events.some((e) => e.method === "session/close" && e.params?.sessionId === "sess-1"));
  } finally {
    ocService.close();
    agService.closeAll();
    acpSessionCache.clearAll();
    if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    else delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    if (prevLog !== undefined) process.env.CRV_ACP_LOG = prevLog;
    else delete process.env.CRV_ACP_LOG;
    await new Promise((r) => setTimeout(r, 150));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
  }
});
