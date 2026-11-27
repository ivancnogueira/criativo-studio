import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROSTER_15_AGENTES } from "../src/engine/runner/roster-defaults.ts";
import { prepareDesktopBundle } from "../../desktop/scripts/prepare-bundle.mjs";

describe("Phase 40.6-04 — Template Remotion no Bundle Desktop & Roster/Skill de Video", () => {
  it("roster-defaults atribui as 4 ferramentas nativas de video ao editor_video sem depender de pasta externa", () => {
    const editor = ROSTER_15_AGENTES.find((a) => a.agente_id === "editor_video");
    assert.ok(editor, "Agente editor_video deve existir no roster");
    for (const tool of [
      "exec_remotion_render",
      "video_inspect_and_silences",
      "video_transcribe_words",
      "exec_ffmpeg_edit",
    ]) {
      assert.ok(editor.ferramentas.includes(tool), `editor_video deve incluir ${tool}`);
    }
    assert.ok(
      editor.skills_paths.every((p) => !p.includes("../criativo-video-studio/")),
      "skills_paths nao deve depender de repositorio irmao externo"
    );
  });

  it("SKILL.md de criar-video-reels orienta ferramentas nativas MCP e caminho/Pastas Autorizadas > 100 MB", () => {
    const skillPath = resolve(
      process.cwd(),
      "../../.agents/skills-upgrades/video/criar-video-reels/SKILL.md"
    );
    const fallbackPath = resolve(
      process.cwd(),
      ".agents/skills-upgrades/video/criar-video-reels/SKILL.md"
    );
    const target = existsSync(skillPath) ? skillPath : fallbackPath;
    const raw = readFileSync(target, "utf8");
    assert.match(raw, /video_inspect_and_silences/);
    assert.match(raw, /video_transcribe_words/);
    assert.match(raw, /exec_ffmpeg_edit/);
    assert.match(raw, /exec_remotion_render/);
    assert.match(raw, /100 MB/);
    assert.match(raw, /Pastas Autorizadas/);
    assert.equal(raw.includes("npm run video:render"), false);
  });

  it("prepareDesktopBundle inclui templates/video-studio limpo sem node_modules", () => {
    const repoRoot = existsSync(resolve(process.cwd(), "produto.json"))
      ? process.cwd()
      : resolve(process.cwd(), "../..");
    const distServer = join(repoRoot, "apps/daemon/dist/server/daemon-server.js");
    const distWeb = join(repoRoot, "apps/web/dist/index.html");
    if (!existsSync(distServer) || !existsSync(distWeb)) {
      return;
    }

    const outDir = mkdtempSync(join(tmpdir(), "crv-p406-bundle-"));
    try {
      prepareDesktopBundle({ repoRoot, outDir, bundleWithEsbuild: false });
      assert.equal(existsSync(join(outDir, "templates/video-studio/package.json")), true);
      assert.equal(existsSync(join(outDir, "templates/video-studio/src/index.ts")), true);
      assert.equal(existsSync(join(outDir, "templates/video-studio/src/Root.tsx")), true);
      assert.equal(existsSync(join(outDir, "templates/video-studio/node_modules")), false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
