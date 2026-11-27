import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { workflowGraphProblemAt, type ProvedorStatusInfo } from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { resolveViableWorkflowModel } from "../src/workflows/workflow-model-resolver.ts";
import {
  WORKFLOW_MARKETING_TEMPLATES,
  buildTemplateGraphWithViableModel,
} from "../src/workflows/workflow-templates-catalog.ts";

describe("Fase 42-01 — Templates de Marketing, Resolver de Modelo Viável e Rotas HTTP", () => {
  let prevSkipProbe: string | undefined;
  const tempDirs: string[] = [];

  before(() => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  });

  after(() => {
    if (prevSkipProbe === undefined) {
      delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    } else {
      process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    }
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignora
      }
    }
  });

  it("resolveViableWorkflowModel prioriza provedor conectado real e evita provedor desconectado mesmo com modelo explícito", async () => {
    const registry = {
      resolveProviderName: (modelId: string) => {
        if (modelId.startsWith("claude")) return "claude";
        if (modelId.startsWith("gpt")) return "openai";
        return "gemini";
      },
    } as never;
    const statuses: ProvedorStatusInfo[] = [
      {
        provedor: "gemini",
        rotulo: "Google Gemini",
        subtitulo: "Gemini",
        conectado: false,
        cli_detectado: false,
        cli_versao: null,
        vault_configurado: false,
        modo_conexao: "nenhum",
        modelos: [{ id: "gemini-2.5-pro", rotulo: "Gemini 2.5 Pro", padrao: true }],
      },
      {
        provedor: "claude",
        rotulo: "Claude",
        subtitulo: "Anthropic",
        conectado: true,
        cli_detectado: true,
        cli_versao: "1.0.0",
        vault_configurado: false,
        modo_conexao: "cli",
        modelos: [
          { id: "claude-haiku-4-5", rotulo: "Haiku 4.5", oculto: false, restante_percentual: 95 },
          { id: "claude-sonnet-4-5", rotulo: "Sonnet 4.5", padrao: true, restante_percentual: 80 },
          { id: "claude-secret", rotulo: "Oculto", padrao: true, oculto: true },
        ],
      },
    ];

    const fakeConnection = {
      getProvidersStatus: async () => statuses,
    } as never;

    const autoPick = await resolveViableWorkflowModel({
      providers: registry,
      providerConnection: fakeConnection,
    });
    assert.equal(autoPick.provider, "claude");
    assert.equal(autoPick.model, "claude-sonnet-4-5");
    assert.equal(autoPick.source, "connected_default");

    const fallbackFromDisconnected = await resolveViableWorkflowModel(
      {
        providers: registry,
        providerConnection: fakeConnection,
      },
      "gemini-2.5-pro",
      "gemini"
    );
    assert.equal(fallbackFromDisconnected.provider, "claude");
    assert.equal(fallbackFromDisconnected.model, "claude-sonnet-4-5");
  });

  it("catálogo oficial contém exatamente os 4 templates com grafos válidos e placeholders genéricos", () => {
    const ids = WORKFLOW_MARKETING_TEMPLATES.map((t) => t.id);
    assert.deepEqual(ids, [
      "briefing-diario",
      "post-com-imagem",
      "relatorio-meta",
      "radar-concorrente",
    ]);

    for (const tpl of WORKFLOW_MARKETING_TEMPLATES) {
      assert.equal(workflowGraphProblemAt(tpl.nos, tpl.arestas), null, `Grafo inválido em ${tpl.id}`);
      const serialized = JSON.stringify(tpl);
      assert.ok(
        serialized.includes("[NOME_DA_MARCA]") || serialized.includes("[@SEU_PERFIL]"),
        `Template ${tpl.id} deve utilizar placeholders genéricos`
      );
    }

    const built = buildTemplateGraphWithViableModel("briefing-diario", {
      model: "gpt-4o",
      provider: "openai",
      label: "OpenAI · GPT-4o",
      source: "connected_default",
    });
    const llmNode = built.nos.find((n) => n.tipo === "llm");
    assert.ok(llmNode);
    assert.equal(llmNode.model, "gpt-4o");
    assert.equal(llmNode.provider, "openai");
  });

  it("rotas GET /api/workflows/templates e GET /api/workflows/modelo-viavel respondem HTTP 200 sem conflito com CRUD", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "crv-42-01-"));
    tempDirs.push(tempDir);
    let runtime: DaemonRuntime | null = null;
    try {
      runtime = await createDaemonServer({
        port: 0,
        dbPath: join(tempDir, "studio.db"),
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
      });
      runtime.vault.setSecret("openai_api_key", "sk-test-fake-key-phase42");

      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const tplRes = await fetch(`${baseUrl}/api/workflows/templates`);
      assert.equal(tplRes.status, 200);
      const tplJson = (await tplRes.json()) as {
        templates: Array<{ id: string }>;
        viable_model: { model: string | null; provider: string | null; source: string };
      };
      assert.equal(tplJson.templates.length, 4);
      assert.ok(tplJson.viable_model.model);
      assert.notEqual(tplJson.viable_model.source, "none");

      const modelRes = await fetch(`${baseUrl}/api/workflows/modelo-viavel`);
      assert.equal(modelRes.status, 200);
      const modelJson = (await modelRes.json()) as { model: string | null; source: string };
      assert.ok(modelJson.model);
      assert.notEqual(modelJson.source, "none");
    } finally {
      await runtime?.close();
    }
  });
});
