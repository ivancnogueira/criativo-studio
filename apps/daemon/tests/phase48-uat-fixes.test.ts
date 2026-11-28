import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveStudioPaths } from "../src/config/app-paths.ts";
import type { LicenseClientService } from "../src/license/license-service.ts";
import { buildClaudeCliArgs } from "../src/providers/cli-oauth/claude-session-settings.ts";
import { codexAppServerPool } from "../src/providers/cli-oauth/codex-app-server-client.ts";
import {
  buildCodexConfigOverrideArgs,
  buildCodexThreadStartParams,
  CODEX_UNFIT_SKILLS,
  isCodexToolItemType,
} from "../src/providers/cli-oauth/codex-prompt-settings.ts";
import {
  isLegacyNpmRuntime,
  resolveManagedProviderRuntime,
  unwrapNpmNativeBinary,
} from "../src/providers/provider-runtime-resolver.ts";
import {
  ensureIsolatedLightCwd,
  mapEffortToCliLevel,
  resolveUniversalTurnPolicy,
} from "../src/providers/universal-turn-policy.ts";
import { AutoUpdateService } from "../src/updater/auto-update-service.ts";
import type { WebSocketHub } from "../src/server/websocket-hub.ts";
import { buildWindowsUpdateRelaunchScript } from "../../desktop/src/update-relauncher.ts";

function createMockLicense(): LicenseClientService {
  return {
    hubBaseUrl: "https://painel.criativo.test",
    isBypassedForTests: () => false,
    getStatus: () => ({
      valid: true,
      status: "active",
      license_key: "CRV-TEST-4807",
      plan_tier: "agencia_ilimitada",
      max_servers: -1,
      max_machines: 10,
      upgrades: ["video", "whatsapp", "carousel", "ads"],
      expires_at: null,
      offline_grace_until: null,
      last_verified_at: new Date().toISOString(),
      machine_id: "mach-48-07",
      server_id: "srv-48-07",
      error_code: null,
      error_message: null,
    }),
    getCredentialHeaders: () => ({
      "x-criativo-license-key": "CRV-TEST-4807",
      "x-criativo-machine-id": "mach-48-07",
    }),
  } as unknown as LicenseClientService;
}

test("EX48-07 UniversalTurnPolicy aplica redução uniforme de histórico, esforço, ferramentas e cwd isolado", () => {
  const lightWeb = resolveUniversalTurnPolicy({
    turnMode: "light",
    configuredEffort: "alto",
    channelOrigin: "web",
    agentName: "Estrategista",
    promptBase: "Persona enxuta.",
    studioToolsPromptGuidance: "\nFerramentas: web_search, meta_publicar",
  });
  assert.equal(lightWeb.mode, "light");
  assert.equal(lightWeb.historyLimit, 2);
  assert.equal(lightWeb.historyMaxChars, 300);
  assert.equal(lightWeb.effectiveEffort, "baixo");
  assert.equal(lightWeb.cliEffort, "low");
  assert.equal(lightWeb.includeTools, false);
  assert.equal(lightWeb.includeMcpServers, false);
  assert.equal(lightWeb.isolateCwd, true);
  assert.equal(lightWeb.maxOutputTokens, 384);
  assert.equal(lightWeb.systemPrompt.includes("Ferramentas:"), false);

  const actionWpp = resolveUniversalTurnPolicy({
    turnMode: "action",
    configuredEffort: "medio",
    channelOrigin: "whatsapp",
    agentName: "Estrategista",
    promptBase: "Persona ativa.",
    studioToolsPromptGuidance: "\nFerramentas: tool_search",
  });
  assert.equal(actionWpp.mode, "action");
  assert.equal(actionWpp.historyLimit, 6);
  assert.equal(actionWpp.historyMaxChars, 1200);
  assert.equal(actionWpp.effectiveEffort, "medio");
  assert.equal(actionWpp.cliEffort, "medium");
  assert.equal(actionWpp.includeTools, true);
  assert.equal(actionWpp.includeMcpServers, true);
  assert.equal(actionWpp.isolateCwd, false);
  assert.equal(actionWpp.maxOutputTokens, undefined);
  assert.ok(actionWpp.systemPrompt.includes("Ferramentas: tool_search"));

  assert.equal(mapEffortToCliLevel("baixo"), "low");
  assert.equal(mapEffortToCliLevel("médio"), "medium");
  assert.equal(mapEffortToCliLevel("xhigh"), "high");

  const tempRoot = mkdtempSync(join(tmpdir(), "crv-light-cwd-"));
  try {
    const isolated = ensureIsolatedLightCwd(tempRoot);
    assert.ok(existsSync(isolated));
    assert.ok(isolated.endsWith(".light-cwd"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("EX48-07 Claude CLI args em modo light adicionam --setting-sources e --effort low com fallback minimalCompat", () => {
  const lightArgs = buildClaudeCliArgs({
    targetModel: "claude-sonnet-4-6",
    turnMode: "light",
    systemPrompt: "Breve",
  });
  const settingIdx = lightArgs.indexOf("--setting-sources");
  assert.ok(settingIdx >= 0);
  assert.equal(lightArgs[settingIdx + 1], "");
  const effortIdx = lightArgs.indexOf("--effort");
  assert.ok(effortIdx >= 0);
  assert.equal(lightArgs[effortIdx + 1], "low");
  assert.equal(lightArgs.includes("--mcp-config"), false);

  const compatArgs = buildClaudeCliArgs({
    targetModel: "claude-sonnet-4-6",
    turnMode: "light",
    systemPrompt: "Breve",
    minimalCompat: true,
  });
  assert.equal(compatArgs.includes("--setting-sources"), false);
  assert.equal(compatArgs.includes("--effort"), false);
});

test("EX48-07 Windows native unwrap resolve vendor/<arch>/bin/codex.exe, claude-code-win32 e evita migração desnecessária", () => {
  if (process.platform !== "win32") return;
  const tempRoot = mkdtempSync(join(tmpdir(), "crv-ex4807-win-"));
  try {
    const archTriple =
      process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    const codexPlatPkg = process.arch === "arm64" ? "@openai/codex-win32-arm64" : "@openai/codex-win32-x64";
    const codexBase = join(tempRoot, "CriativoStudio", "provider-runtimes", "codex");
    const codexCmd = join(codexBase, "npm", "node_modules", ".bin", "codex.cmd");
    const codexBinExe = join(
      codexBase,
      "npm",
      "node_modules",
      ...codexPlatPkg.split("/"),
      "vendor",
      archTriple,
      "bin",
      "codex.exe"
    );

    mkdirSync(join(codexCmd, ".."), { recursive: true });
    mkdirSync(join(codexBinExe, ".."), { recursive: true });
    mkdirSync(join(codexBase, "npm", "node_modules", "@openai", "codex"), { recursive: true });
    writeFileSync(codexCmd, "@echo off\r\n", "utf8");
    writeFileSync(codexBinExe, "exe-stub", "utf8");
    writeFileSync(
      join(codexBase, "npm", "node_modules", "@openai", "codex", "package.json"),
      JSON.stringify({ name: "@openai/codex", version: "0.172.0" }),
      "utf8"
    );

    assert.equal(unwrapNpmNativeBinary(codexCmd), codexBinExe);
    const resolvedCodex = resolveManagedProviderRuntime("codex", {
      appDataDir: tempRoot,
      includeSystemPaths: false,
    });
    assert.equal(resolvedCodex.executable, codexBinExe);
    assert.equal(isLegacyNpmRuntime(codexBase, codexBinExe), false);
    assert.equal(isLegacyNpmRuntime(codexBase, codexCmd), false);

    const claudeSuffix = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
    const claudeBase = join(tempRoot, "CriativoStudio", "provider-runtimes", "claude");
    const claudeCmd = join(claudeBase, "npm", "node_modules", ".bin", "claude.cmd");
    const claudeExe = join(
      claudeBase,
      "npm",
      "node_modules",
      "@anthropic-ai",
      `claude-code-${claudeSuffix}`,
      "claude.exe"
    );
    mkdirSync(join(claudeCmd, ".."), { recursive: true });
    mkdirSync(join(claudeExe, ".."), { recursive: true });
    writeFileSync(claudeCmd, "@echo off\r\n", "utf8");
    writeFileSync(claudeExe, "claude-exe-stub", "utf8");

    assert.equal(unwrapNpmNativeBinary(claudeCmd), claudeExe);
    assert.equal(isLegacyNpmRuntime(claudeBase, claudeExe), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("EX48-07 Codex thread/start light envia baseInstructions mínimo, desliga features pesadas e filtra userMessage de onToolStep", async () => {
  const lightParams = buildCodexThreadStartParams({
    modelId: "gpt-5.4",
    cwd: "/tmp/empty",
    systemPrompt: "Persona curta",
    turnMode: "light",
  });
  assert.equal(lightParams.effort, "low");
  assert.deepEqual(lightParams.dynamicTools, []);
  assert.ok(typeof lightParams.baseInstructions === "string" && lightParams.baseInstructions.length < 300);
  const lightCfg = lightParams.config as Record<string, unknown>;
  assert.equal(lightCfg.web_search, "disabled");
  assert.equal(lightCfg.project_doc_max_bytes, 0);
  assert.equal(lightCfg["skills.include_instructions"], false);
  assert.equal((lightCfg.features as Record<string, boolean>).shell_tool, false);
  assert.equal((lightCfg.features as Record<string, boolean>).plugins, false);
  assert.equal((lightCfg["skills.config"] as unknown[]).length, CODEX_UNFIT_SKILLS.length);

  const lightArgs = buildCodexConfigOverrideArgs({ turnMode: "light" });
  assert.ok(lightArgs.includes("project_doc_max_bytes=0"));
  assert.ok(lightArgs.includes("features.shell_tool=false"));

  assert.equal(isCodexToolItemType("userMessage"), false);
  assert.equal(isCodexToolItemType("reasoning"), false);
  assert.equal(isCodexToolItemType("plan"), false);
  assert.equal(isCodexToolItemType("contextCompaction"), false);
  assert.equal(isCodexToolItemType("mcpToolCall"), true);
  assert.equal(isCodexToolItemType("commandExecution"), true);

  const root = mkdtempSync(join(tmpdir(), "crv-ex4807-codex-filter-"));
  const fakeScript = join(root, "fake-codex-filter.mjs");
  writeFileSync(
    fakeScript,
    `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("close", () => process.exit(0));
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "t-filter" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    const tId = msg.params.threadId;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn-1" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/started", params: { threadId: tId, item: { id: "u1", type: "userMessage" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { threadId: tId, item: { id: "u1", type: "userMessage" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { threadId: tId, item: { id: "r1", type: "reasoning" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/started", params: { threadId: tId, item: { id: "m1", type: "mcpToolCall", tool: "tool_search" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { threadId: tId, item: { id: "m1", type: "mcpToolCall", tool: "tool_search", status: "completed" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: tId, delta: "Oi!" } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: tId, turn: { id: "turn-1", status: "completed" } } }) + "\\n");
  }
});
`,
    "utf8"
  );

  let exePath = join(root, "fake-codex");
  if (process.platform === "win32") {
    exePath = join(root, "fake-codex.cmd");
    writeFileSync(exePath, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`, "utf8");
  } else {
    writeFileSync(exePath, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, "utf8");
    chmodSync(exePath, 0o755);
  }

  const emittedSteps: Array<{ toolName: string; title: string; status: string }> = [];
  try {
    const res = await codexAppServerPool.executeTurn({
      executable: exePath,
      cwd: root,
      codexHome: root,
      accountId: "acc-filter",
      modelId: "gpt-5.4",
      agenteId: "estrategista",
      threadId: "thr-filter",
      turnMode: "light",
      systemPrompt: "Persona",
      coldPrompt: "oi",
      incrementalPrompt: "oi",
      overrideArgs: buildCodexConfigOverrideArgs({ turnMode: "light" }),
      configFingerprint: "fp-filter-1",
      onToolStep: (s) => emittedSteps.push({ toolName: s.toolName, title: s.title, status: s.status }),
    });
    assert.equal(res.text, "Oi!");
    assert.equal(emittedSteps.some((s) => s.toolName === "userMessage"), false);
    assert.equal(emittedSteps.some((s) => s.toolName === "reasoning"), false);
    assert.equal(emittedSteps.filter((s) => s.toolName === "tool_search").length, 2);
  } finally {
    codexAppServerPool.disposeAll();
    await new Promise((r) => setTimeout(r, 150));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
  }
});

test("EX48-07 AutoUpdateService faz download em streaming com progresso, reusa SHA-256 em disco e script PS é válido", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crv-ex4807-update-"));
  try {
    const productRoot = join(dir, "product");
    mkdirSync(productRoot, { recursive: true });
    writeFileSync(join(productRoot, "produto.json"), JSON.stringify({ versao: "1.1.2" }), "utf8");

    const installerPayload = Buffer.alloc(64 * 1024, 0x5a);
    const sha256 = createHash("sha256").update(installerPayload).digest("hex");

    const events: number[] = [];
    const mockWsHub = {
      broadcast: (event: string, payload: unknown) => {
        if (event === "update:status") {
          const p = payload as { state?: string; progress_percent?: number };
          if (p.state === "downloading" && typeof p.progress_percent === "number") {
            events.push(p.progress_percent);
          }
        }
      },
    } as unknown as WebSocketHub;

    let downloadCalls = 0;
    const fakeFetcher = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/api/releases/latest")) {
        return new Response(
          JSON.stringify({
            version: "1.1.3",
            published_at: new Date().toISOString(),
            channel: "stable",
            changelog_markdown: "- Correções UAT",
            artifacts: [
              {
                platform: process.platform === "win32" ? "win32" : "vps-tarball",
                filename: process.platform === "win32" ? "CriativoOS-Setup-1.1.3.exe" : "criativo-1.1.3.pkg",
                download_path: "/api/releases/download/v1.1.3/pkg",
                sha256,
                size_bytes: installerPayload.length,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      downloadCalls += 1;
      const chunkSize = 16 * 1024;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let off = 0; off < installerPayload.length; off += chunkSize) {
            controller.enqueue(new Uint8Array(installerPayload.subarray(off, off + chunkSize)));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Length": String(installerPayload.length) },
      });
    }) as unknown as typeof fetch;

    const paths = resolveStudioPaths({ productRoot, dataRoot: join(dir, "dados") });
    const svc1 = new AutoUpdateService({
      licenseService: createMockLicense(),
      paths,
      wsHub: mockWsHub,
      currentVersion: "1.1.2",
      autoDownload: false,
      fetchImpl: fakeFetcher,
    });
    const snap1 = await svc1.downloadAndApplyUpdate({
      platform: process.platform === "win32" ? "win32" : "vps-tarball",
    });
    assert.equal(snap1.state, "ready_to_restart");
    assert.equal(downloadCalls, 1);
    assert.ok(events.some((p) => p >= 10 && p <= 78));

    // Segunda instância apontando para o mesmo updatesDir deve reutilizar o arquivo íntegro sem baixar novamente
    const svc2 = new AutoUpdateService({
      licenseService: createMockLicense(),
      paths,
      currentVersion: "1.1.2",
      autoDownload: false,
      fetchImpl: fakeFetcher,
    });
    const snap2 = await svc2.downloadAndApplyUpdate({
      platform: process.platform === "win32" ? "win32" : "vps-tarball",
    });
    assert.equal(snap2.state, "ready_to_restart");
    assert.equal(downloadCalls, 1, "Artefato íntegro em updatesDir deve ser reutilizado sem novo GET");

    const script = buildWindowsUpdateRelaunchScript();
    assert.match(script, /\/currentuser/);
    assert.match(script, /--updated/);
    assert.match(script, /CRIATIVO_UPDATER_LOG/);
    assert.match(script, /Remove-Item\s+-LiteralPath\s+\$PSCommandPath/);

    if (process.platform === "win32") {
      const checkFile = join(dir, "check-relauncher.ps1");
      writeFileSync(checkFile, `\uFEFF${script}`, "utf8");
      const psCheck = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$errs = $null; [System.Management.Automation.Language.Parser]::ParseFile('${checkFile.replace(/'/g, "''")}', [ref]$null, [ref]$errs) | Out-Null; if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Error $_.Message }; exit 1 }`,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.equal(psCheck.status, 0, psCheck.stderr || psCheck.stdout);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
