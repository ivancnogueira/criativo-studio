import assert from "node:assert/strict";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { ProviderRegistry } from "../src/engine/providers/provider-registry.ts";
import { CustomEndpointsService } from "../src/providers/custom-endpoints-service.ts";
import { LocalProviderDetector } from "../src/providers/local-provider-detector.ts";
import { VaultService } from "../src/vault/vault-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

test("CustomEndpointsService: CRUD mascarado no Vault, teste de conexão e roteamento custom/<id>/<modelo>", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase33-custom");
  let requestedAuthHeader = "";
  let requestedUrl = "";

  const fakeFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    requestedUrl = url;
    requestedAuthHeader = init?.headers?.Authorization ?? "";
    if (url.endsWith("/models")) {
      return new Response(
        JSON.stringify({ data: [{ id: "deepseek/deepseek-r1" }, { id: "meta-llama/llama-3.3" }] }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Resposta mock OpenAI-compatível" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 }
    );
  };

  const registry = new ProviderRegistry({ vault, fetchImpl: fakeFetch as never });
  const service = new CustomEndpointsService({
    db,
    vault,
    registry,
    fetchImpl: fakeFetch as never,
  });

  const saved = service.upsertEndpoint({
    id: "openrouter",
    name: "OpenRouter Teste",
    baseUrl: "https://openrouter.example/api/v1/",
    models: ["deepseek/deepseek-r1"],
    apiKey: "sk-or-fake-secret-123",
  });

  assert.equal(saved.id, "openrouter");
  assert.equal(saved.hasApiKey, true);
  assert.equal("apiKey" in (saved as unknown as Record<string, unknown>), false);
  assert.equal(vault.getSecret("custom_provider_openrouter_api_key"), "sk-or-fake-secret-123");

  const testResult = await service.testEndpoint("openrouter");
  assert.equal(testResult.ok, true);
  assert.equal(requestedUrl, "https://openrouter.example/api/v1/models");
  assert.equal(requestedAuthHeader, "Bearer sk-or-fake-secret-123");
  assert.deepEqual(testResult.models, ["deepseek/deepseek-r1", "meta-llama/llama-3.3"]);

  // Roteamento dinâmico no ProviderRegistry
  assert.equal(registry.resolveProviderName("custom/openrouter/deepseek/deepseek-r1"), "custom:openrouter");
  const client = registry.getClientForModel("custom/openrouter/deepseek/deepseek-r1");
  const reply = await client.generateText("Olá!");
  assert.equal(reply, "Resposta mock OpenAI-compatível");

  assert.equal(service.deleteEndpoint("openrouter"), true);
  assert.equal(vault.getSecret("custom_provider_openrouter_api_key"), null);
});

test("LocalProviderDetector: sonda Ollama (:11434) e LM Studio (:1234) em paralelo com cache curto", async () => {
  let calls = 0;
  const fakeFetch = async (url: string) => {
    calls += 1;
    if (url.includes("11434")) {
      return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }), { status: 200 });
    }
    if (url.includes("1234")) {
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-coder-7b" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  const detector = new LocalProviderDetector({ fetchImpl: fakeFetch as never });
  const first = await detector.detect(false);
  assert.equal(first.length, 2);
  assert.equal(first[0].kind, "ollama");
  assert.equal(first[0].online, true);
  assert.deepEqual(first[0].models, ["llama3.2:latest"]);
  assert.equal(first[1].kind, "lmstudio");
  assert.equal(first[1].online, true);
  assert.deepEqual(first[1].models, ["qwen2.5-coder-7b"]);
  assert.equal(calls, 2);

  // Cache evita novas chamadas imediatas
  await detector.detect(false);
  assert.equal(calls, 2);

  // refresh = true ignora cache
  await detector.detect(true);
  assert.equal(calls, 4);
});
