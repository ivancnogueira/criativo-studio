import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeNextVersion,
  parseCliArgs,
  syncWorkspaceVersions,
} from "../../scripts/release-bump.mjs";

describe("REL40-01 — Motor de Versionamento Semântico Base-10 (release:bump)", () => {
  it("incrementa patch de 0 a 8 e faz rollover Base-10 quando patch == 9", () => {
    assert.equal(computeNextVersion("1.0.0"), "1.0.1");
    assert.equal(computeNextVersion("1.0.1"), "1.0.2");
    assert.equal(computeNextVersion("1.0.8"), "1.0.9");
    assert.equal(computeNextVersion("1.0.9"), "1.1.0");
    assert.equal(computeNextVersion("1.9.9"), "1.10.0");
    assert.equal(computeNextVersion("v2.3.9"), "2.4.0");
  });

  it("suporta flags --minor, --major e --set explícito", () => {
    assert.equal(computeNextVersion("1.0.4", { mode: "minor" }), "1.1.0");
    assert.equal(computeNextVersion("1.4.9", { mode: "major" }), "2.0.0");
    assert.equal(computeNextVersion("1.0.0", { setVersion: "1.2.3" }), "1.2.3");
  });

  it("faz parse das flags CLI corretamente", () => {
    assert.deepEqual(parseCliArgs(["--minor", "--dry-run"]), {
      mode: "minor",
      setVersion: null,
      dryRun: true,
      jsonOutput: false,
      includePainel: true,
    });
    assert.deepEqual(parseCliArgs(["--set", "1.0.5", "--no-painel"]), {
      mode: "patch",
      setVersion: "1.0.5",
      dryRun: false,
      jsonOutput: false,
      includePainel: false,
    });
  });

  it("sincroniza produto.json, pacotes do monorepo e painel administrativo atomicamente", () => {
    const tempBase = mkdtempSync(join(tmpdir(), "criativoos-bump-test-"));
    const monorepoDir = join(tempBase, "criativo-ai-studio-online");
    const painelDir = join(tempBase, "criativo-ai-studio-painel");

    try {
      mkdirSync(join(monorepoDir, "apps", "daemon"), { recursive: true });
      mkdirSync(join(monorepoDir, "packages", "contracts"), { recursive: true });
      mkdirSync(painelDir, { recursive: true });

      writeFileSync(
        join(monorepoDir, "produto.json"),
        JSON.stringify({ nome: "CriativoOS", versao: "1.0.9" }, null, 2),
      );
      writeFileSync(
        join(monorepoDir, "package.json"),
        JSON.stringify({ name: "criativo-studio-online", version: "1.0.9" }, null, 2),
      );
      writeFileSync(
        join(monorepoDir, "apps", "daemon", "package.json"),
        JSON.stringify({ name: "@criativo/daemon", version: "1.0.9" }, null, 2),
      );
      writeFileSync(
        join(monorepoDir, "packages", "contracts", "package.json"),
        JSON.stringify({ name: "@criativo/contracts", version: "1.0.9" }, null, 2),
      );
      writeFileSync(
        join(painelDir, "package.json"),
        JSON.stringify({ name: "criativo-ai-studio-painel", version: "1.0.9" }, null, 2),
      );

      const nextVer = computeNextVersion("1.0.9");
      assert.equal(nextVer, "1.1.0");

      const dryResult = syncWorkspaceVersions(monorepoDir, nextVer, {
        dryRun: true,
        painelDir,
        packagePaths: ["package.json", "apps/daemon/package.json", "packages/contracts/package.json"],
      });
      assert.equal(dryResult.updatedFiles.length, 5);
      assert.equal(
        JSON.parse(readFileSync(join(monorepoDir, "produto.json"), "utf8")).versao,
        "1.0.9",
      );

      const liveResult = syncWorkspaceVersions(monorepoDir, nextVer, {
        dryRun: false,
        painelDir,
        packagePaths: ["package.json", "apps/daemon/package.json", "packages/contracts/package.json"],
      });
      assert.equal(liveResult.version, "1.1.0");
      assert.equal(liveResult.tag, "v1.1.0");
      assert.equal(
        JSON.parse(readFileSync(join(monorepoDir, "produto.json"), "utf8")).versao,
        "1.1.0",
      );
      assert.equal(
        JSON.parse(readFileSync(join(monorepoDir, "package.json"), "utf8")).version,
        "1.1.0",
      );
      assert.equal(
        JSON.parse(readFileSync(join(monorepoDir, "apps", "daemon", "package.json"), "utf8")).version,
        "1.1.0",
      );
      assert.equal(
        JSON.parse(readFileSync(join(painelDir, "package.json"), "utf8")).version,
        "1.1.0",
      );
    } finally {
      rmSync(tempBase, { recursive: true, force: true });
    }
  });
});
