import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { buildRemotionCliArgs } from "../src/engine/tools/remotion-bridge.ts";
import { resolveAuthorizedVideoInputPath } from "../src/engine/tools/video-editing-tools.ts";
import { resolveRemotionCompositionId } from "../src/engine/tools/video-runtime-resolver.ts";
import { CriativoStudioMcpBridge } from "../src/mcp/studio-mcp-bridge.ts";
import type { LicenseClientService } from "../src/license/license-service.ts";
import type { WebSocketHub } from "../src/server/websocket-hub.ts";

describe("Phase 40.6-03 — Ferramentas Nativas de Video no MCP Bridge", () => {
  it("expoe as 4 ferramentas de video no MCP Bridge quando o pacote video esta desbloqueado e bloqueia quando nao esta", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p406-vidmcp-"));
    const db = new CriativoDatabase(join(tmp, "test.db"));
    const wsHub = { broadcast: () => {} } as unknown as WebSocketHub;

    try {
      const unlockedLicense = {
        isBypassedForTests: () => false,
        hasSignedUpgradeEntitlement: (pkg: string) => pkg === "video",
      } as unknown as LicenseClientService;

      const bridgeUnlocked = new CriativoStudioMcpBridge({
        db,
        wsHub,
        workspaceRoot: tmp,
        licenseService: unlockedLicense,
      });

      const toolsUnlocked = bridgeUnlocked.listToolsForAgent("editor_video", ["core", "media"]);
      const namesUnlocked = toolsUnlocked.map((t) => t.name);
      for (const expected of [
        "exec_remotion_render",
        "video_inspect_and_silences",
        "video_transcribe_words",
        "exec_ffmpeg_edit",
      ]) {
        assert.ok(namesUnlocked.includes(expected), `Esperava ferramenta ${expected} exposta no MCP`);
      }

      const lockedLicense = {
        isBypassedForTests: () => false,
        hasSignedUpgradeEntitlement: () => false,
      } as unknown as LicenseClientService;

      const bridgeLocked = new CriativoStudioMcpBridge({
        db,
        wsHub,
        workspaceRoot: tmp,
        licenseService: lockedLicense,
      });
      const toolsLocked = bridgeLocked.listToolsForAgent("editor_video", ["core", "media"]);
      const namesLocked = toolsLocked.map((t) => t.name);
      assert.equal(namesLocked.includes("exec_remotion_render"), false);
      assert.equal(namesLocked.includes("exec_ffmpeg_edit"), false);

      await assert.rejects(
        () => bridgeLocked.callToolForAgent("exec_ffmpeg_edit", { input_path: "x.mp4" }, "editor_video"),
        /Acesso negado/
      );
    } finally {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolveAuthorizedVideoInputPath permite Pastas Autorizadas e bloqueia caminhos externos nao autorizados", () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p406-vidpath-"));
    const allowedDir = join(tmp, "pasta-autorizada");
    const forbiddenDir = join(tmp, "pasta-privada");
    const workspaceDir = join(tmp, "workspace");
    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(forbiddenDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });

    const okFile = join(allowedDir, "bruto.mp4");
    const blockedFile = join(forbiddenDir, "secreto.mp4");
    writeFileSync(okFile, "ok");
    writeFileSync(blockedFile, "nope");

    try {
      const resolvedOk = resolveAuthorizedVideoInputPath(okFile, {
        workspaceRoot: workspaceDir,
        allowedFolders: [{ path: allowedDir, mode: "ro", added_at: new Date().toISOString() }],
      });
      assert.equal(resolvedOk, okFile);

      assert.throws(
        () =>
          resolveAuthorizedVideoInputPath(blockedFile, {
            workspaceRoot: workspaceDir,
            allowedFolders: [{ path: allowedDir, mode: "ro", added_at: new Date().toISOString() }],
          }),
        /Pastas Autorizadas/
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("normaliza composicoes Remotion e monta argumentos CLI validos", () => {
    assert.equal(resolveRemotionCompositionId("FacelessReels"), "ReelsFaceless");
    assert.equal(resolveRemotionCompositionId("TalkingHeadReels"), "ReelsTalkingHead");
    const args = buildRemotionCliArgs(
      {
        composicao: "TalkingHeadReels",
        audio_path: "a.mp3",
        output_path: "out.mp4",
      },
      "props.json"
    );
    assert.ok(args.includes("ReelsTalkingHead"));
    assert.ok(args.includes("--width=1080"));
    assert.ok(args.includes("--height=1920"));
  });
});
