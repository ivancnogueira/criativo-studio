import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  isLegacyNpmRuntime,
  migrateLegacyNpmRuntimes,
  resolveManagedProviderRuntime,
  unwrapNpmNativeBinary,
} from "../src/providers/provider-runtime-resolver.ts";

const ROOT = resolve(import.meta.dirname, "..");

test("EX48-01: unwrapNpmNativeBinary resolve codex.cmd/codex.js direto para codex.exe nativo", () => {
  if (process.platform !== "win32") return;
  const tempRoot = mkdtempSync(join(tmpdir(), "crv-ex48-codex-"));
  try {
    const npmDir = join(tempRoot, "CriativoStudio", "provider-runtimes", "codex", "npm");
    const binCmd = join(npmDir, "node_modules", ".bin", "codex.cmd");
    const jsEntry = join(npmDir, "node_modules", "@openai", "codex", "bin", "codex.js");
    const archTriple =
      process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    const platPkg = process.arch === "arm64" ? "@openai/codex-win32-arm64" : "@openai/codex-win32-x64";
    const nativeExe = join(npmDir, "node_modules", ...platPkg.split("/"), "vendor", archTriple, "codex", "codex.exe");

    mkdirSync(join(npmDir, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(npmDir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    mkdirSync(join(nativeExe, ".."), { recursive: true });
    writeFileSync(binCmd, "@echo off\r\n", "utf8");
    writeFileSync(jsEntry, "console.log('wrapper');", "utf8");
    writeFileSync(
      join(npmDir, "node_modules", "@openai", "codex", "package.json"),
      JSON.stringify({ name: "@openai/codex", version: "0.170.0" }),
      "utf8"
    );
    writeFileSync(nativeExe, "stub-exe", "utf8");

    assert.equal(unwrapNpmNativeBinary(binCmd), nativeExe);
    assert.equal(unwrapNpmNativeBinary(jsEntry), nativeExe);

    const resolved = resolveManagedProviderRuntime("codex", {
      appDataDir: tempRoot,
      includeSystemPaths: false,
    });
    assert.equal(resolved.executable, nativeExe);
    assert.equal(resolved.version, "0.170.0");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("EX48-01: unwrapNpmNativeBinary resolve claude.cmd/cli-wrapper.cjs direto para bin/claude.exe", () => {
  if (process.platform !== "win32") return;
  const tempRoot = mkdtempSync(join(tmpdir(), "crv-ex48-claude-"));
  try {
    const npmDir = join(tempRoot, "CriativoStudio", "provider-runtimes", "claude", "npm");
    const binCmd = join(npmDir, "node_modules", ".bin", "claude.cmd");
    const wrapperJs = join(npmDir, "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs");
    const nativeExe = join(npmDir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");

    mkdirSync(join(npmDir, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(nativeExe, ".."), { recursive: true });
    writeFileSync(binCmd, "@echo off\r\n", "utf8");
    writeFileSync(wrapperJs, "module.exports = {};", "utf8");
    writeFileSync(
      join(npmDir, "node_modules", "@anthropic-ai", "claude-code", "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-code", version: "2.1.263" }),
      "utf8"
    );
    writeFileSync(nativeExe, "stub-claude-exe", "utf8");

    assert.equal(unwrapNpmNativeBinary(binCmd), nativeExe);
    assert.equal(unwrapNpmNativeBinary(wrapperJs), nativeExe);

    const resolved = resolveManagedProviderRuntime("claude", {
      appDataDir: tempRoot,
      includeSystemPaths: false,
    });
    assert.equal(resolved.executable, nativeExe);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("EX48-01: isLegacyNpmRuntime detecta legado npm e migrateLegacyNpmRuntimes respeita modo offline", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "crv-ex48-legacy-"));
  const prevDisable = process.env.CRIATIVO_DISABLE_AUTO_INSTALL;
  try {
    const codexBase = join(tempRoot, "CriativoStudio", "provider-runtimes", "codex");
    const standaloneExe = join(codexBase, "win32-x64", "0.170.0", "bin", "codex.exe");
    const legacyCmd = join(codexBase, "npm", "node_modules", ".bin", "codex.cmd");

    mkdirSync(join(legacyCmd, ".."), { recursive: true });
    writeFileSync(legacyCmd, "stub", "utf8");
    assert.equal(isLegacyNpmRuntime(codexBase, legacyCmd), true);
    assert.equal(isLegacyNpmRuntime(codexBase, standaloneExe), false);

    process.env.CRIATIVO_DISABLE_AUTO_INSTALL = "1";
    const skipped = await migrateLegacyNpmRuntimes({ appDataDir: tempRoot });
    assert.equal(skipped.skipped, true);
    assert.deepEqual(skipped.migrated, []);
  } finally {
    if (prevDisable === undefined) delete process.env.CRIATIVO_DISABLE_AUTO_INSTALL;
    else process.env.CRIATIVO_DISABLE_AUTO_INSTALL = prevDisable;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("EX48-01: guarda estatica proibe windowsHide: false e !opts.interactiveLogin nos spawns", () => {
  const agConn = readFileSync(resolve(ROOT, "src/providers/antigravity-acp-connection.ts"), "utf8");
  assert.doesNotMatch(agConn, /windowsHide:\s*!opts\.interactiveLogin/);
  assert.match(agConn, /windowsHide:\s*true/);

  const cliHelpers = readFileSync(resolve(ROOT, "src/providers/cli-oauth/cli-types-and-helpers.ts"), "utf8");
  assert.match(cliHelpers, /windowsHide:\s*process\.platform === "win32" \? true : !input\.interactiveWindow/);

  const locateSrc = readFileSync(resolve(ROOT, "src/providers/provider-runtime-locate.ts"), "utf8");
  assert.match(locateSrc, /const windowsHide = options\.windowsHide \?\? true;/);
  assert.match(locateSrc, /unwrapNpmNativeBinary/);
});
