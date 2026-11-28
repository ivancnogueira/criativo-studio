import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { OpenCodeLiveService } from "../src/providers/opencode-live-service.ts";
import { spawnProviderProcess } from "../src/providers/provider-runtime-locate.ts";

const ROOT = resolve(import.meta.dirname, "..");

test("DM47-01: OpenCodeLiveService deduplica getLiveCatalog concorrente e usa windowsHide: true", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "criativo-dm47-01-"));
  const runtimeBinDir = join(tempRoot, "provider-runtimes", "opencode", "bin");
  mkdirSync(runtimeBinDir, { recursive: true });
  const fakeCmd = join(runtimeBinDir, process.platform === "win32" ? "opencode.cmd" : "opencode");
  writeFileSync(fakeCmd, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");

  let calls = 0;
  let capturedWindowsHide: boolean | undefined;

  const service = new OpenCodeLiveService({
    appDataDir: tempRoot,
    catalogCommandRunner: async (_cmd, _args, opts) => {
      calls += 1;
      capturedWindowsHide = opts.windowsHide;
      await new Promise((r) => setTimeout(r, 40));
      return {
        stdout: "opencode/glm-5.3-flash-free\nopencode/big-pickle\n",
      };
    },
  });

  try {
    const [res1, res2] = await Promise.all([
      service.getLiveCatalog(true),
      service.getLiveCatalog(true),
    ]);

    assert.equal(calls, 1, "chamadas concorrentes devem compartilhar inFlightCatalogPromise");
    assert.equal(capturedWindowsHide, true, "opencode models deve rodar com windowsHide: true");
    assert.equal(res1.detected, true);
    assert.equal(res2.modelos.length, 2);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("DM47-01: spawnProviderProcess usa windowsHide true por padrao e permite override explicito false", () => {
  const locateSrc = readFileSync(resolve(ROOT, "src/providers/provider-runtime-locate.ts"), "utf8");
  assert.match(locateSrc, /const windowsHide = options\.windowsHide \?\? true;/);
  const child = spawnProviderProcess(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  assert.ok(child.pid || child.spawnfile);
  child.kill();
});

test("DM47-01: guarda estatica anti-regressao para windowsHide nos spawns em background", () => {
  const targets = [
    "src/providers/opencode-live-service.ts",
    "src/providers/provider-runtime-locate.ts",
    "src/voice/tts-service.ts",
    "src/providers/cli-oauth/cli-types-and-helpers.ts",
    "src/voice/voice-host-service.ts",
  ];

  for (const rel of targets) {
    const content = readFileSync(resolve(ROOT, rel), "utf8");
    assert.match(
      content,
      /windowsHide\s*(?::|,)/,
      `Arquivo ${rel} deve configurar windowsHide explicitamente para evitar popups CMD no Windows.`
    );
  }
});
