import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentTurnContext, AgentTurnResult, AIProviderClient } from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

describe("Configurações de Equipe, Líder, Memórias Isoladas e Provedor por Agente", () => {
  let tempDir: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;
  const calledModels: string[] = [];

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-canais-"));

    runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "criativo-canais.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    baseUrl = `http://127.0.0.1:${runtime.port}`;

    const makeMock = (name: "gemini" | "openai" | "claude"): AIProviderClient => ({
      name,
      generateText: async (prompt) => `Mock ${name}: ${prompt.slice(0, 30)}`,
      executeTurn: async (req: AgentTurnContext): Promise<AgentTurnResult> => {
        calledModels.push(req.model);
        return {
          text: `Resposta de ${req.model}`,
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 8, outputTokens: 10 },
        };
      },
      streamTurn: async (req: AgentTurnContext, onChunk) => {
        calledModels.push(req.model);
        const text = `Resposta de ${req.model}`;
        onChunk({ type: "text_delta", tokenChunk: text });
        onChunk({ type: "done" });
        return {
          text,
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 8, outputTokens: 10 },
        };
      },
    });

    runtime.providers.registerCustomProvider("gemini", makeMock("gemini"));
    runtime.providers.registerCustomProvider("openai", makeMock("openai"));
    runtime.providers.registerCustomProvider("claude", makeMock("claude"));
    runtime.vault.setSecret("gemini_api_key", "fake-gemini-key");
    runtime.vault.setSecret("openai_api_key", "fake-openai-key");
    runtime.vault.setSecret("claude_api_key", "fake-claude-key");
  });

  after(async () => {
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
  });

  it("cria equipe sem # obrigatório, atualiza configurações, gerencia memórias, nova conversa, compactação e exclusão", async () => {
    const createRes = await fetch(`${baseUrl}/api/canais`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Equipe de Organização",
        descricao: "Coordena tarefas do estúdio",
        instrucoes: "Manter tom direto",
        membros_agentes: ["estrategista", "copywriter"],
        lider_agente_id: "copywriter",
        navegador_modo: "leader",
        manter_memorias: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()).canal;
    assert.equal(created.nome, "Equipe de Organização");
    assert.equal(created.lider_agente_id, "copywriter");
    assert.equal(created.navegador_modo, "leader");
    assert.equal(created.manter_memorias, true);

    const patchRes = await fetch(`${baseUrl}/api/canais/${created.canal_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Equipe Editorial",
        descricao: "Planejamento completo",
        instrucoes: "Validar com o líder primeiro",
        membros_agentes: [
          "estrategista",
          "copywriter",
          "designer_post",
          "designer_carrossel",
          "designer_stories",
        ],
        lider_agente_id: "estrategista",
        navegador_modo: "all",
      }),
    });
    assert.equal(patchRes.status, 200);
    const patched = (await patchRes.json()).canal;
    assert.equal(patched.nome, "Equipe Editorial");
    assert.equal(patched.lider_agente_id, "estrategista");
    assert.equal(patched.membros_agentes.length, 5);

    const addMemRes = await fetch(`${baseUrl}/api/canais/${created.canal_id}/memorias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: "Usar paleta escura nas capas" }),
    });
    assert.equal(addMemRes.status, 201);
    const memBody = await addMemRes.json();
    assert.equal(memBody.memorias.length, 1);

    const newConvRes = await fetch(`${baseUrl}/api/canais/${created.canal_id}/nova-conversa`, {
      method: "POST",
    });
    assert.equal(newConvRes.status, 200);
    const newConv = await newConvRes.json();
    assert.equal(newConv.mensagem_divisor.item_type, "context_reset");

    const compactRes = await fetch(`${baseUrl}/api/canais/${created.canal_id}/compactar-contexto`, {
      method: "POST",
    });
    assert.equal(compactRes.status, 200);
    const compactBody = await compactRes.json();
    assert.equal(compactBody.mensagem_divisor.item_type, "context_reset");

    const delMemRes = await fetch(
      `${baseUrl}/api/canais/${created.canal_id}/memorias/${memBody.memorias[0].memoria_id}`,
      { method: "DELETE" },
    );
    assert.equal(delMemRes.status, 200);

    const delRes = await fetch(`${baseUrl}/api/canais/${created.canal_id}`, {
      method: "DELETE",
    });
    assert.equal(delRes.status, 200);
  });
});
