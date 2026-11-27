import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import { spawnCommandWithStdin } from "../src/providers/cli-oauth/cli-types-and-helpers.ts";
import {
  createTurnStallWatchdog,
  getLastMcpActivityAt,
  hasActiveMcpToolForAgent,
  trackMcpToolExecution,
} from "../src/providers/turn-stall-watchdog.ts";

function createToolMockAcpScript(dir: string): string {
  const scriptPath = join(dir, "mock-acp-tools.mjs");
  const source = [
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
    '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-tool-1", models: { currentModelId: "gemini-4-neon", availableModels: [{ modelId: "gemini-4-neon", name: "Gemini 4 Neon" }] } } }));',
    '    return;',
    '  }',
    '  if (msg.method === "session/close") {',
    '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));',
    '    return;',
    '  }',
    '  if (msg.method === "session/prompt") {',
    '    // Emite tool_call aberta e permanece em silencio por 280ms (maior que timeoutMs 120ms)',
    '    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "t1", status: "in_progress" } } }));',
    '    setTimeout(() => {',
    '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } } }));',
    '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "RENDER_CONCLUIDO" } } } }));',
    '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }));',
    '    }, 280);',
    '  }',
    '});',
  ].join("\n");
  writeFileSync(scriptPath, source, "utf8");
  return scriptPath;
}

describe("Phase 40.7 — Stall Detector Inteligente & Turnos Longos (Padrão OpenBot)", () => {
  it("createTurnStallWatchdog nao impoe teto total quando touch() continua chegando", async () => {
    let stalled = false;
    const watchdog = createTurnStallWatchdog({
      stallMs: 120,
      checkIntervalMs: 30,
      onStall: () => {
        stalled = true;
      },
    });

    try {
      // 8 batidas a cada 60ms = 480ms (4x o stallMs), mas sempre ativo
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 60));
        watchdog.touch();
      }
      assert.equal(stalled, false, "Não deve disparar stall enquanto há atividade");
    } finally {
      watchdog.stop();
    }
  });

  it("pausa stall durante trackMcpToolExecution(toolStallMs: null) e dispara somente apos terminar e ficar em silencio", async () => {
    let stalledAt = 0;
    const agentId = "editor_video_teste_40_7";
    const watchdog = createTurnStallWatchdog({
      stallMs: 110,
      toolStallMs: null,
      checkIntervalMs: 25,
      isToolRunning: () => hasActiveMcpToolForAgent(agentId),
      getExternalActivityAt: () => getLastMcpActivityAt(agentId),
      onStall: () => {
        stalledAt = Date.now();
      },
    });

    try {
      const toolDoneAt = await trackMcpToolExecution(agentId, async () => {
        await new Promise((r) => setTimeout(r, 260));
        return Date.now();
      });

      assert.equal(stalledAt, 0, "Stall não pode disparar enquanto ferramenta MCP está ativa");
      assert.equal(hasActiveMcpToolForAgent(agentId), false);

      // Agora aguarda passar do limite de silêncio após fim da tool
      await new Promise((r) => setTimeout(r, 190));
      assert.ok(stalledAt >= toolDoneAt + 95, "Stall deve disparar após encerramento da tool + silêncio");
    } finally {
      watchdog.stop();
    }
  });

  it("usa probeAlive para adiar stall ate maxSilentProbes e dispara quando probe retorna false", async () => {
    let probeCalls = 0;
    let stalled = false;
    const watchdog = createTurnStallWatchdog({
      stallMs: 70,
      checkIntervalMs: 20,
      maxSilentProbes: 2,
      probeAlive: async () => {
        probeCalls += 1;
        return probeCalls === 1; // 1º ping responde vivo; 2º responde morto
      },
      onStall: () => {
        stalled = true;
      },
    });

    try {
      await new Promise((r) => setTimeout(r, 95));
      assert.equal(probeCalls, 1);
      assert.equal(stalled, false, "1º probe vivo deve dar sobrevida ao turno");

      await new Promise((r) => setTimeout(r, 110));
      assert.equal(probeCalls, 2);
      assert.equal(stalled, true, "2º probe morto deve encerrar por stall");
    } finally {
      watchdog.stop();
    }
  });

  it("AntigravityAcpService nao interrompe turno enquanto tool_call ACP estiver aberta", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p407-acp-tool-"));
    try {
      const mockScript = createToolMockAcpScript(tmp);
      const geminiDir = join(tmp, "conta-tool");
      mkdirSync(geminiDir, { recursive: true });

      const acpService = new AntigravityAcpService({
        executableOverride: process.execPath,
        spawnArgsFactory: () => [mockScript],
      });

      const res = await acpService.executePrompt("acc-tool", {
        geminiDir,
        cwd: tmp,
        promptText: "RUN_LONG_TOOL",
        modelId: "gemini-4-neon",
        agentId: "editor_video",
        timeoutMs: 120,
      });

      assert.equal(res.text, "RENDER_CONCLUIDO");
      acpService.closeAll();
      await new Promise((r) => setTimeout(r, 120));
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 60 });
      } catch {
        // ignora lock temporário no Windows
      }
    }
  });

  it("spawnCommandWithStdin em stallMode completa com streaming longo, respeita AbortSignal e detecta silencio real", async () => {
    // 1. Streaming de stdout a cada 110ms por ~550ms com timeoutMs 320ms -> deve completar
    const streamRes = await spawnCommandWithStdin({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write('chunk-0\\n'); let i = 0; const t = setInterval(() => { process.stdout.write('chunk-' + (++i) + '\\n'); if (i >= 5) { clearInterval(t); process.exit(0); } }, 110);",
      ],
      env: process.env as Record<string, string | undefined>,
      cwd: process.cwd(),
      timeoutMs: 320,
      stallMode: true,
    });
    assert.equal(streamRes.code, 0);
    assert.match(streamRes.stdout, /chunk-5/);

    // 2. AbortSignal cancela imediatamente com AbortError
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
      () =>
        spawnCommandWithStdin({
          executable: process.execPath,
          args: ["-e", "setTimeout(() => process.exit(0), 3000);"],
          env: process.env as Record<string, string | undefined>,
          cwd: process.cwd(),
          timeoutMs: 2_000,
          stallMode: true,
          signal: controller.signal,
        }),
      (err: Error) => err.name === "AbortError"
    );

    // 3. Processo silencioso sem tool MCP ativa falha com mensagem de silêncio
    await assert.rejects(
      () =>
        spawnCommandWithStdin({
          executable: process.execPath,
          args: ["-e", "setTimeout(() => process.exit(0), 2500);"],
          env: process.env as Record<string, string | undefined>,
          cwd: process.cwd(),
          timeoutMs: 180,
          stallMode: true,
        }),
      /Tempo limite .* de silêncio/i
    );
  });
});
