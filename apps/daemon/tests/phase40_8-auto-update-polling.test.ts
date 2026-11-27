import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStudioPaths } from "../src/config/app-paths.ts";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import { OpenCodeAcpConnection } from "../src/providers/opencode-acp-connection.ts";
import type { AcpToolStepEvent } from "../src/providers/turn-stall-watchdog.ts";
import { AutoUpdateService } from "../src/updater/auto-update-service.ts";
import type { LicenseClientService } from "../src/license/license-service.ts";
import type { WebSocketHub } from "../src/server/websocket-hub.ts";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createMockLicenseService(valid = true): LicenseClientService {
  return {
    hubBaseUrl: "https://painel.criativo.test",
    isBypassedForTests: () => false,
    getStatus: () => ({
      valid,
      status: valid ? "active" : "unlicensed",
      license_key: valid ? "CRV-TEST-0001" : null,
      plan_tier: "agencia_ilimitada",
      max_servers: -1,
      max_machines: 10,
      upgrades: ["video", "whatsapp", "carousel", "ads"],
      expires_at: null,
      offline_grace_until: null,
      last_verified_at: new Date().toISOString(),
      machine_id: "mach-40-8",
      server_id: "srv-40-8",
      error_code: null,
      error_message: null,
    }),
    getCredentialHeaders: () =>
      valid
        ? {
            "x-criativo-license-key": "CRV-TEST-0001",
            "x-criativo-machine-id": "mach-40-8",
          }
        : null,
  } as unknown as LicenseClientService;
}

describe("Phase 40.8 — Auto-Update Automático Ponta a Ponta & Update Beam", () => {
  it("startPeriodicCheck dispara checkForUpdates automaticamente e emite update:status no WebSocket", async () => {
    const dir = makeTempDir("crv-p408-poll-");
    try {
      const productRoot = join(dir, "product");
      mkdirSync(productRoot, { recursive: true });
      writeFileSync(join(productRoot, "produto.json"), JSON.stringify({ versao: "1.0.6" }), "utf8");

      const events: Array<{ event: string; payload: unknown }> = [];
      const mockWsHub = {
        broadcast: (event: string, payload: unknown) => {
          events.push({ event, payload });
        },
      } as unknown as WebSocketHub;

      let fetchCalls = 0;
      const service = new AutoUpdateService({
        licenseService: createMockLicenseService(true),
        paths: resolveStudioPaths({ productRoot, dataRoot: join(dir, "dados") }),
        wsHub: mockWsHub,
        currentVersion: "1.0.6",
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response(
            JSON.stringify({
              version: "1.0.7",
              published_at: new Date().toISOString(),
              channel: "stable",
              changelog_markdown: "- Auto-update automático",
              artifacts: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        },
      });

      service.startPeriodicCheck({ initialDelayMs: 25, intervalMs: 5_000 });
      await new Promise((r) => setTimeout(r, 110));
      service.stopPeriodicCheck();

      assert.ok(fetchCalls >= 1, "startPeriodicCheck deve consultar /api/releases/latest após o boot");
      const snap = service.getStatus();
      assert.equal(snap.update_available, true);
      assert.equal(snap.latest_version, "1.0.7");
      assert.ok(
        events.some(
          (e) =>
            e.event === "update:status" &&
            (e.payload as { update_available?: boolean; latest_version?: string }).update_available === true &&
            (e.payload as { latest_version?: string }).latest_version === "1.0.7"
        )
      );

      // Após stopPeriodicCheck, não deve haver novas chamadas de rede
      const callsAfterStop = fetchCalls;
      await new Promise((r) => setTimeout(r, 90));
      assert.equal(fetchCalls, callsAfterStop);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("startPeriodicCheck nao sobrescreve estado quando o app ja esta em ready_to_restart", async () => {
    const dir = makeTempDir("crv-p408-busy-");
    try {
      const productRoot = join(dir, "product");
      mkdirSync(productRoot, { recursive: true });
      const bundleContent = JSON.stringify({
        format: "criativo-update-bundle-v1",
        version: "1.0.7",
        files: { "VERSAO_TESTE.txt": "ok" },
      });
      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(bundleContent, "utf8").digest("hex");

      let latestFetchCalls = 0;
      const service = new AutoUpdateService({
        licenseService: createMockLicenseService(true),
        paths: resolveStudioPaths({ productRoot, dataRoot: join(dir, "dados") }),
        currentVersion: "1.0.6",
        fetchImpl: async (url) => {
          const u = String(url);
          if (u.includes("/api/releases/latest")) {
            latestFetchCalls += 1;
            return new Response(
              JSON.stringify({
                version: "1.0.7",
                published_at: new Date().toISOString(),
                channel: "stable",
                changelog_markdown: "- Nova versão",
                artifacts: [
                  {
                    platform: "vps-tarball",
                    arch: "x64",
                    filename: "criativo-update-1.0.7.json",
                    sha256,
                    size_bytes: Buffer.byteLength(bundleContent),
                    download_path: "/api/releases/download/1.0.7/criativo-update-1.0.7.json",
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(bundleContent, { status: 200 });
        },
      });

      await service.downloadAndApplyUpdate();
      assert.equal(service.getStatus().state, "ready_to_restart");

      const callsBeforePolling = latestFetchCalls;
      service.startPeriodicCheck({ initialDelayMs: 20, intervalMs: 40 });
      await new Promise((r) => setTimeout(r, 110));
      service.stopPeriodicCheck();

      assert.equal(latestFetchCalls, callsBeforePolling, "Polling não pode sobrescrever ready_to_restart");
      assert.equal(service.getStatus().state, "ready_to_restart");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("workflow CI notifica webhook do painel e frontend integra triggerUpdateBeam estilo OpenBot", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const workflowSrc = readFileSync(join(repoRoot, ".github/workflows/build-desktop-releases.yml"), "utf8");
    const bannerSrc = readFileSync(
      join(repoRoot, "apps/web/src/features/updates/UpdateNotificationBanner.tsx"),
      "utf8"
    );
    const beamSrc = readFileSync(
      join(repoRoot, "apps/web/src/features/updates/update-beam-effect.ts"),
      "utf8"
    );
    const bootstrapSrc = readFileSync(join(repoRoot, "apps/web/src/hooks/useStudioBootstrap.ts"), "utf8");

    assert.match(workflowSrc, /PAINEL_RELEASE_SYNC_SECRET/);
    assert.match(workflowSrc, /\/api\/releases\/sync-webhook/);
    assert.match(bannerSrc, /triggerUpdateBeam/);
    assert.match(beamSrc, /prefers-reduced-motion/);
    assert.match(bootstrapSrc, /visibilitychange/);
    assert.match(bootstrapSrc, /verificarAtualizacoes/);
  });

  it("Antigravity ACP e OpenCode ACP separam blocos entre tool_call/thought e emitem etapas reais onToolStep", async () => {
    const dir = makeTempDir("crv-p408-blocks-");
    try {
      const mockScript = join(dir, "mock-acp-blocks.mjs");
      writeFileSync(
        mockScript,
        [
          'import { createInterface } from "node:readline";',
          'const rl = createInterface({ input: process.stdin });',
          'rl.on("line", (line) => {',
          '  const trimmed = line.trim();',
          '  if (!trimmed.startsWith("{")) return;',
          '  const msg = JSON.parse(trimmed);',
          '  if (msg.method === "initialize") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { agentCapabilities: { promptCapabilities: { image: false } } } }));',
          '    return;',
          '  }',
          '  if (msg.method === "authenticate") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));',
          '    return;',
          '  }',
          '  if (msg.method === "session/new") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-blk", models: { currentModelId: "gemini-4-neon", availableModels: [{ modelId: "gemini-4-neon", name: "Gemini 4 Neon" }] } } }));',
          '    return;',
          '  }',
          '  if (msg.method === "session/close") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));',
          '    return;',
          '  }',
          '  if (msg.method === "session/prompt") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Validando mídia." } } } }));',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "tc1", title: "Analisar vídeo com FFmpeg", status: "in_progress" } } }));',
          '    setTimeout(() => {',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "tc1", title: "Analisar vídeo com FFmpeg", status: "completed" } } }));',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Origem confirmada." } } } }));',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Pensando..." } } } }));',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Pronto!" } } } }));',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }));',
          '    }, 35);',
          '  }',
          '});',
        ].join("\n"),
        "utf8"
      );

      // 1. Valida AntigravityAcpService
      const geminiDir = join(dir, "ag");
      mkdirSync(geminiDir, { recursive: true });
      const agService = new AntigravityAcpService({
        executableOverride: process.execPath,
        spawnArgsFactory: () => [mockScript],
      });

      const agDeltas: string[] = [];
      const agSteps: AcpToolStepEvent[] = [];
      const agOut = await agService.executePrompt("acc-blk", {
        geminiDir,
        cwd: dir,
        promptText: "TEST_BLOCKS",
        modelId: "gemini-4-neon",
        timeoutMs: 2_000,
        onDelta: (d) => agDeltas.push(d),
        onToolStep: (s) => agSteps.push(s),
      });

      assert.equal(agOut.text, "Validando mídia.\n\nOrigem confirmada.\n\nPronto!");
      assert.equal(agDeltas.join(""), "Validando mídia.\n\nOrigem confirmada.\n\nPronto!");
      assert.equal(agSteps.length, 2);
      assert.equal(agSteps[0]?.status, "executando");
      assert.equal(agSteps[0]?.title, "Analisar vídeo com FFmpeg");
      assert.equal(agSteps[1]?.status, "concluido");
      assert.ok((agSteps[1]?.duracaoMs ?? 0) >= 1);

      agService.closeAll();

      // 2. Valida OpenCodeAcpConnection via shim .cmd/.sh
      const isWin = process.platform === "win32";
      const shimPath = join(dir, isWin ? "opencode-mock.cmd" : "opencode-mock.sh");
      if (isWin) {
        writeFileSync(shimPath, `@echo off\r\n"${process.execPath}" "${mockScript}" %*\r\n`, "utf8");
      } else {
        writeFileSync(shimPath, `#!/bin/sh\n"${process.execPath}" "${mockScript}" "$@"\n`, { mode: 0o755 });
      }
      const ocConn2 = new OpenCodeAcpConnection(shimPath, dir, {});
      const ocDeltas: string[] = [];
      const ocSteps: AcpToolStepEvent[] = [];
      const ocOut = await ocConn2.runPrompt({
        cwd: dir,
        promptText: "TEST_OC_BLOCKS",
        modelId: "opencode/glm-5.3-flash-free",
        timeoutMs: 2_000,
        onDelta: (d) => ocDeltas.push(d),
        onToolStep: (s) => ocSteps.push(s),
      });

      assert.equal(ocOut.text, "Validando mídia.\n\nOrigem confirmada.\n\nPronto!");
      assert.equal(ocDeltas.join(""), "Validando mídia.\n\nOrigem confirmada.\n\nPronto!");
      assert.equal(ocSteps.length, 2);
      assert.equal(ocSteps[0]?.status, "executando");
      assert.equal(ocSteps[1]?.status, "concluido");

      ocConn2.dispose();
      await new Promise((r) => setTimeout(r, 120));
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 60 });
      } catch {
        // ignora lock temporário no Windows
      }
    }
  });
});
