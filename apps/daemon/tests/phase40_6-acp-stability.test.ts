import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import { executeAntigravityCodeAssistGenerate } from "../src/providers/antigravity/codeassist-executor.ts";
import { planTurnContext } from "../src/server/turn-context-planner.ts";
import type { AntigravityGenerateRuntimeContext } from "../src/providers/antigravity/live-types.ts";

function createMockAcpScript(dir: string): string {
  const scriptPath = join(dir, "mock-acp.mjs");
  const source = [
    'import { createInterface } from "node:readline";',
    'const rl = createInterface({ input: process.stdin });',
    'const cancelled = new Set();',
    'rl.on("line", (line) => {',
    '  const trimmed = line.trim();',
    '  if (!trimmed.startsWith("{")) return;',
    '  const msg = JSON.parse(trimmed);',
    '  if (msg.method === "session/cancel") {',
    '    const sid = msg.params?.sessionId;',
    '    if (sid) cancelled.add(sid);',
    '    process.stderr.write(`CANCELLED:${sid}\\n`);',
    '    return;',
    '  }',
    '  if (msg.method === "initialize") {',
    '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { agentCapabilities: { promptCapabilities: { image: false } } } }));',
    '    return;',
    '  }',
    '  if (msg.method === "authenticate") {',
    '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));',
    '    return;',
    '  }',
    '  if (msg.method === "session/new") {',
    '    const sid = `sess-${Math.random().toString(36).slice(2, 8)}`;',
    '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid, models: { currentModelId: "gemini-4-neon", availableModels: [{ modelId: "gemini-4-neon", name: "Gemini 4 Neon" }] } } }));',
    '    return;',
    '  }',
    '  if (msg.method === "session/close") {',
    '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));',
    '    return;',
    '  }',
    '  if (msg.method === "session/prompt") {',
    '    const sid = msg.params?.sessionId;',
    '    const text = msg.params?.prompt?.[0]?.text || "";',
    '    if (text.includes("SLOW_TIMEOUT")) {',
    '      // Fica em silencio para acionar timeout de prompt sem derrubar outros workers',
    '      return;',
    '    }',
    '    if (text.includes("WAIT_CANCEL")) {',
    '      setTimeout(() => {',
    '        if (!cancelled.has(sid)) {',
    '          console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "NAO_CANCELADO" } } } }));',
    '          console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }));',
    '        }',
    '      }, 3000);',
    '      return;',
    '    }',
    '    if (text.includes("STREAM_ALIVE")) {',
    '      setTimeout(() => {',
    '        console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "PARTE1 " } } } }));',
    '      }, 120);',
    '      setTimeout(() => {',
    '        console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "PARTE2" } } } }));',
    '        console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }));',
    '      }, 240);',
    '      return;',
    '    }',
    '    setTimeout(() => {',
    '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK_CONCORRENTE" } } } }));',
    '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }));',
    '    }, 220);',
    '  }',
    '});',
  ].join("\n");
  writeFileSync(scriptPath, source, "utf8");
  return scriptPath;
}

describe("Phase 40.6-01 — Estabilidade ACP & Turn Context Planner", () => {
  it("isola workers por agente no AntigravityAcpService e nao derruba turno concorrente em timeout PT-BR", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p406-acp-"));
    try {
      const mockScript = createMockAcpScript(tmp);
      const geminiDir = join(tmp, "conta-1");
      mkdirSync(geminiDir, { recursive: true });

      const acpService = new AntigravityAcpService({
        executableOverride: process.execPath,
        spawnArgsFactory: () => [mockScript],
      });

      const slowCall = acpService.executePrompt("acc-1", {
        geminiDir,
        cwd: tmp,
        promptText: "SLOW_TIMEOUT",
        modelId: "gemini-4-neon",
        agentId: "analista_metricas",
        timeoutMs: 180,
      });

      const fastCall = acpService.executePrompt("acc-1", {
        geminiDir,
        cwd: tmp,
        promptText: "NORMAL_PROMPT",
        modelId: "gemini-4-neon",
        agentId: "editor_video",
        timeoutMs: 2_500,
      });

      const [slowRes, fastRes] = await Promise.allSettled([slowCall, fastCall]);
      assert.equal(slowRes.status, "rejected");
      assert.match(String((slowRes as PromiseRejectedResult).reason), /Tempo limite/i);
      assert.equal(fastRes.status, "fulfilled");
      assert.equal((fastRes as PromiseFulfilledResult<{ text: string }>).value.text, "OK_CONCORRENTE");

      acpService.closeAll();
      await new Promise((r) => setTimeout(r, 120));
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 60 });
      } catch {
        // ignora lock temporário de tempdir no Windows
      }
    }
  });

  it("renova timeout por atividade durante streaming e cancela limpo via AbortSignal", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p406-abort-"));
    try {
      const mockScript = createMockAcpScript(tmp);
      const geminiDir = join(tmp, "conta-2");
      mkdirSync(geminiDir, { recursive: true });

      const acpService = new AntigravityAcpService({
        executableOverride: process.execPath,
        spawnArgsFactory: () => [mockScript],
      });

      // Timeout de inatividade de 170ms, mas chunks chegam a cada 120ms -> deve completar
      const streamed = await acpService.executePrompt("acc-2", {
        geminiDir,
        cwd: tmp,
        promptText: "STREAM_ALIVE",
        modelId: "gemini-4-neon",
        agentId: "editor_video",
        timeoutMs: 170,
      });
      assert.equal(streamed.text, "PARTE1 PARTE2");

      // AbortSignal deve cancelar rapidamente com AbortError sem esperar 3s
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 80);
      await assert.rejects(
        () =>
          acpService.executePrompt("acc-2", {
            geminiDir,
            cwd: tmp,
            promptText: "WAIT_CANCEL",
            modelId: "gemini-4-neon",
            agentId: "analista_metricas",
            timeoutMs: 4_000,
            signal: controller.signal,
          }),
        (err: Error) => err.name === "AbortError"
      );

      acpService.closeAll();
      await new Promise((r) => setTimeout(r, 120));
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 60 });
      } catch {
        // ignora lock temporário de tempdir no Windows
      }
    }
  });

  it("codeassist-executor nao faz retry em timeout PT-BR e usa disposeWorker seletivo", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p406-exec-"));
    try {
      const geminiDir = join(tmp, "conta-exec");
      mkdirSync(geminiDir, { recursive: true });

      let executeAttempts = 0;
      let disposeWorkerCalls = 0;
      let disposeAccountCalls = 0;

      const ctx: AntigravityGenerateRuntimeContext = {
        workspaceCwd: tmp,
        fetchImpl: fetch,
        acpService: {
          getCliExecutable: () => "mock-antigravity",
          executePrompt: async () => {
            executeAttempts += 1;
            throw new Error("Tempo limite (180s) aguardando resposta de 'session/prompt'.");
          },
          disposeWorker: () => {
            disposeWorkerCalls += 1;
          },
          disposeAccount: () => {
            disposeAccountCalls += 1;
          },
        } as unknown as AntigravityGenerateRuntimeContext["acpService"],
        getLiveSnapshot: async () => ({
          contas: [{ id: "acc-1", provedor: "gemini", email: "user@example.com", estado: "conectado", padrao: true, token_valido: true, grupos_cota: [], rotulo: null }],
          pool: { habilitado: true, contas_excluidas: [], conta_em_uso: "acc-1" },
          modelos: [],
          defaultModelId: null,
          imageGenerationModelIds: [],
          atualizado_em: new Date().toISOString(),
        }),
        discoverStudioTokenEntries: () => ({
          entries: [
            {
              id: "acc-1",
              geminiDir,
              email: "user@example.com",
              accessToken: "tok",
              refreshToken: "ref",
              hasRefreshToken: true,
              tokenValid: true,
              expiryIso: null,
            },
          ],
        }),
        clearSnapshotCache: () => {},
      };

      await assert.rejects(
        () =>
          executeAntigravityCodeAssistGenerate(ctx, {
            model: "gemini-4-neon",
            messages: [{ role: "user", text: "analise meu perfil" }],
            agentId: "analista_metricas",
          }),
        /Tempo limite \(180s\)/
      );

      assert.equal(executeAttempts, 1, "Timeout em PT-BR não deve disparar segunda tentativa duplicada");
      assert.equal(disposeAccountCalls, 0, "Não deve derrubar toda a conta em timeout");
      assert.equal(disposeWorkerCalls, 0, "Ao interromper sem retry não deve destruir worker de forma cruzada");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("planTurnContext carrega SKILL.md para analise/diagnostico e ativa escopo media para agentes de video", () => {
    const planAnalise = planTurnContext({
      userPrompt: "analise meu perfil e me de um diagnostico completo",
      agenteId: "analista_metricas",
      isGreetingOrCapability: false,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
    });
    assert.equal(planAnalise.loadFullSkill, true);
    assert.ok(planAnalise.mcpScopes.includes("meta"));

    const planVideo = planTurnContext({
      userPrompt: "vamos conversar sobre o formato do proximo material",
      agenteId: "editor_video",
      isGreetingOrCapability: false,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
    });
    assert.ok(planVideo.mcpScopes.includes("media"));
  });
});
