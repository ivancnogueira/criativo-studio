import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import {
  installAntigravityStandaloneBinary,
  isLikelyAntigravityGuiBinary,
  resolveManagedProviderRuntime,
} from "../src/providers/provider-runtime-resolver.ts";
import { ensureAntigravityRuntimeInBackgroundOp } from "../src/providers/provider-status-and-actions.ts";

describe("Antigravity CLI Auto-Install e Detecção Blindada", () => {
  it("1. Rejeita binário GUI Electron do Antigravity App no PATH e prioriza CLI real (agy)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-agy-detect-"));
    const prevPath = process.env.PATH;
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;

    try {
      const fakeAppData = join(tempDir, "appdata");
      const guiDir = join(tempDir, "Programs", "antigravity");
      const cliDir = join(tempDir, "agy", "bin");
      mkdirSync(fakeAppData, { recursive: true });
      mkdirSync(guiDir, { recursive: true });
      mkdirSync(cliDir, { recursive: true });

      const guiBinName = process.platform === "win32" ? "Antigravity.exe" : "antigravity";
      const cliBinName = process.platform === "win32" ? "agy.exe" : "agy";
      const guiBinPath = join(guiDir, guiBinName);
      const cliBinPath = join(cliDir, cliBinName);

      writeFileSync(guiBinPath, "gui-stub", "utf8");
      writeFileSync(join(guiDir, "chrome_100_percent.pak"), "pak-stub", "utf8");
      writeFileSync(cliBinPath, "cli-stub", "utf8");

      assert.equal(isLikelyAntigravityGuiBinary(guiBinPath), true);
      assert.equal(isLikelyAntigravityGuiBinary(cliBinPath), false);
      assert.equal(
        isLikelyAntigravityGuiBinary("/Applications/Antigravity.app/Contents/MacOS/Antigravity"),
        true
      );

      // Mesmo com a pasta GUI na frente no PATH, o resolvedor ignora o app GUI e acha o agy real
      process.env.PATH = `${guiDir}${delimiter}${cliDir}`;
      const resolved = resolveManagedProviderRuntime("antigravity", {
        appDataDir: fakeAppData,
      });
      assert.equal(resolved.executable, cliBinPath);
    } finally {
      process.env.PATH = prevPath;
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("2. Faz fallback automático para o manifesto oficial Google (raw .exe + .tar.gz + SHA-512) quando GitHub retorna HTTP 403", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-agy-cdn-"));
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;

    try {
      // 2A. Fallback Windows raw (.exe direto com verificação SHA-512)
      const appDataWin = join(tempDir, "appdata-win");
      mkdirSync(appDataWin, { recursive: true });
      const winRawPayload = Buffer.from("fake-windows-raw-agy-binary-v1.5.17");
      const winSha512 = createHash("sha512").update(winRawPayload).digest("hex");

      const mockFetchWinCdn: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("github.com")) {
          return new Response("rate limit exceeded", { status: 403 });
        }
        if (url.endsWith("/windows_amd64.json")) {
          return new Response(
            JSON.stringify({
              version: "1.5.17",
              url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.17/windows-x64/cli_windows_x64.exe",
              sha512: winSha512,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/cli_windows_x64.exe")) {
          return new Response(winRawPayload, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      };

      const winInstalled = await installAntigravityStandaloneBinary({
        appDataDir: appDataWin,
        platform: "win32",
        arch: "x64",
        includeSystemPaths: false,
        manifestBaseUrl: "https://mock-cdn.local/manifests",
        fetchImpl: mockFetchWinCdn,
      });
      assert.equal(winInstalled.installedNow, true);
      assert.equal(winInstalled.version, "1.5.17");
      assert.ok(winInstalled.executable && existsSync(winInstalled.executable));
      assert.equal(readFileSync(winInstalled.executable, "utf8"), winRawPayload.toString("utf8"));

      // 2B. Rejeita payload se SHA-512 divergir
      const appDataBadSha = join(tempDir, "appdata-badsha");
      mkdirSync(appDataBadSha, { recursive: true });
      const mockFetchBadSha: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("github.com")) {
          return new Response("rate limit", { status: 403 });
        }
        if (url.endsWith("/windows_amd64.json")) {
          return new Response(
            JSON.stringify({
              version: "1.5.17",
              url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.17/windows-x64/cli_windows_x64.exe",
              sha512: "0".repeat(128),
            }),
            { status: 200 }
          );
        }
        return new Response(winRawPayload, { status: 200 });
      };

      const badShaRes = await installAntigravityStandaloneBinary({
        appDataDir: appDataBadSha,
        platform: "win32",
        arch: "x64",
        includeSystemPaths: false,
        manifestBaseUrl: "https://mock-cdn.local/manifests",
        fetchImpl: mockFetchBadSha,
      });
      assert.equal(badShaRes.executable, null);
      assert.match(badShaRes.error ?? "", /SHA-512/);

      // 2C. Fallback Unix (.tar.gz via manifesto oficial)
      const appDataLinux = join(tempDir, "appdata-linux");
      mkdirSync(appDataLinux, { recursive: true });
      const tarPayload = Buffer.from("fake-linux-tar-gz-bytes");
      const tarSha512 = createHash("sha512").update(tarPayload).digest("hex");

      const mockFetchLinuxCdn: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("github.com")) {
          return new Response("rate limit", { status: 403 });
        }
        if (url.endsWith("/linux_amd64.json")) {
          return new Response(
            JSON.stringify({
              version: "1.5.17",
              url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.17/linux-x64/cli_linux_x64.tar.gz",
              sha512: tarSha512,
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/cli_linux_x64.tar.gz")) {
          return new Response(tarPayload, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      };

      const linuxInstalled = await installAntigravityStandaloneBinary({
        appDataDir: appDataLinux,
        platform: "linux",
        arch: "x64",
        includeSystemPaths: false,
        manifestBaseUrl: "https://mock-cdn.local/manifests",
        fetchImpl: mockFetchLinuxCdn,
        extractImpl: async (_archive, destDir) => {
          writeFileSync(join(destDir, "antigravity"), "#!/bin/sh\necho 1.5.17\n", "utf8");
        },
      });
      assert.equal(linuxInstalled.installedNow, true);
      assert.equal(linuxInstalled.version, "1.5.17");
      assert.ok(linuxInstalled.executable?.includes(join("antigravity", "linux-x64", "1.5.17", "bin", "antigravity")));
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("3. signInWithGoogleBrowser tenta auto-instalar quando ausente e ensureAntigravityRuntimeInBackgroundOp detecta binário pronto", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-agy-bg-"));
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    const prevDisable = process.env.CRIATIVO_DISABLE_AUTO_INSTALL;

    try {
      process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
      process.env.CRIATIVO_DISABLE_AUTO_INSTALL = "1";

      const acpSvc = new AntigravityAcpService({
        appDataDir: join(tempDir, "empty-appdata"),
      });
      await assert.rejects(
        () => acpSvc.signInWithGoogleBrowser({ geminiDir: join(tempDir, "gdir") }),
        /não pôde ser instalado automaticamente/
      );

      let invalidated = false;
      const bgAlreadyReady = await ensureAntigravityRuntimeInBackgroundOp({
        antigravityLive: {
          getCliExecutable: () => join(tempDir, "fake-agy"),
        },
        invalidateCliProbeCache: () => {
          invalidated = true;
        },
      } as unknown as Parameters<typeof ensureAntigravityRuntimeInBackgroundOp>[0]);

      assert.deepEqual(bgAlreadyReady, { installed: false, available: true });
      assert.equal(invalidated, false);
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
      if (prevDisable === undefined) delete process.env.CRIATIVO_DISABLE_AUTO_INSTALL;
      else process.env.CRIATIVO_DISABLE_AUTO_INSTALL = prevDisable;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
