import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  installOpenCodeStandaloneBinary,
  resolveManagedProviderRuntime,
  resolveOpenCodeReleaseAssetName,
} from "../src/providers/provider-runtime-resolver.ts";

describe("OpenCode Standalone Auto-Install (Sem Node/npm)", () => {
  it("1. resolveOpenCodeReleaseAssetName mapeia assets oficiais por SO e arquitetura", () => {
    assert.deepEqual(resolveOpenCodeReleaseAssetName("win32", "x64"), {
      assetName: "opencode-windows-x64.zip",
      archFolder: "win32-x64",
      binName: "opencode.exe",
      archiveKind: "zip",
    });
    assert.deepEqual(resolveOpenCodeReleaseAssetName("win32", "arm64"), {
      assetName: "opencode-windows-arm64.zip",
      archFolder: "win32-arm64",
      binName: "opencode.exe",
      archiveKind: "zip",
    });
    assert.deepEqual(resolveOpenCodeReleaseAssetName("darwin", "arm64"), {
      assetName: "opencode-darwin-arm64.zip",
      archFolder: "darwin-arm64",
      binName: "opencode",
      archiveKind: "zip",
    });
    assert.deepEqual(resolveOpenCodeReleaseAssetName("darwin", "x64"), {
      assetName: "opencode-darwin-x64.zip",
      archFolder: "darwin-x64",
      binName: "opencode",
      archiveKind: "zip",
    });
    assert.deepEqual(resolveOpenCodeReleaseAssetName("linux", "x64"), {
      assetName: "opencode-linux-x64.tar.gz",
      archFolder: "linux-x64",
      binName: "opencode",
      archiveKind: "tar.gz",
    });
    assert.deepEqual(resolveOpenCodeReleaseAssetName("linux", "arm64"), {
      assetName: "opencode-linux-arm64.tar.gz",
      archFolder: "linux-arm64",
      binName: "opencode",
      archiveKind: "tar.gz",
    });
  });

  it("2. installOpenCodeStandaloneBinary instala na pasta gerenciada, limpa _tmp e deduplica chamadas concorrentes", async () => {
    const fakeAppData = mkdtempSync(join(tmpdir(), "criativo-opencode-test-"));
    const nativeSpec = resolveOpenCodeReleaseAssetName(process.platform, process.arch);
    assert.ok(nativeSpec, "Plataforma atual deve mapear asset OpenCode");

    let fetchCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      fetchCalls += 1;
      assert.match(String(input), new RegExp(`${nativeSpec.assetName}$`));
      await new Promise((r) => setTimeout(r, 30));
      const res = new Response(Buffer.from("mock-opencode-archive-bytes"), { status: 200 });
      Object.defineProperty(res, "url", {
        value: `https://github.com/anomalyco/opencode/releases/download/v1.19.6/${nativeSpec.assetName}`,
      });
      return res;
    };

    const mockExtract = async (
      archivePath: string,
      destDir: string,
      archiveKind: "zip" | "tar.gz"
    ) => {
      assert.equal(archiveKind, nativeSpec.archiveKind);
      assert.equal(existsSync(archivePath), true);
      const nestedDir = join(destDir, "package");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(nestedDir, nativeSpec.binName), "stub-binary-content", "utf8");
    };

    try {
      const [first, second] = await Promise.all([
        installOpenCodeStandaloneBinary({
          appDataDir: fakeAppData,
          fetchImpl: mockFetch,
          extractImpl: mockExtract,
          includeSystemPaths: false,
        }),
        installOpenCodeStandaloneBinary({
          appDataDir: fakeAppData,
          fetchImpl: mockFetch,
          extractImpl: mockExtract,
          includeSystemPaths: false,
        }),
      ]);

      assert.equal(fetchCalls, 1, "Chamadas concorrentes devem compartilhar o mesmo download");
      assert.equal(first.installedNow, true);
      assert.equal(second.installedNow, true);
      assert.equal(first.version, "1.19.6");
      assert.ok(first.executable && existsSync(first.executable));
      assert.equal(
        first.executable,
        join(
          fakeAppData,
          "CriativoStudio",
          "provider-runtimes",
          "opencode",
          nativeSpec.archFolder,
          "1.19.6",
          "bin",
          nativeSpec.binName
        )
      );

      const resolved = resolveManagedProviderRuntime("opencode", {
        appDataDir: fakeAppData,
        includeSystemPaths: false,
      });
      assert.equal(resolved.executable, first.executable);
      assert.equal(resolved.version, "1.19.6");

      const tmpBase = join(fakeAppData, "CriativoStudio", "provider-runtimes", "opencode", "_tmp");
      if (existsSync(tmpBase)) {
        const leftover = await import("node:fs").then((fs) => fs.readdirSync(tmpBase));
        assert.equal(leftover.length, 0, "Diretórios temporários em _tmp devem ser removidos");
      }
    } finally {
      rmSync(fakeAppData, { recursive: true, force: true });
    }
  });
});
