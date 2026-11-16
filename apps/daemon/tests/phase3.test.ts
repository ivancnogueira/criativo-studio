import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AIProviderClient, AgentTurnContext } from "@criativo/contracts";
import { CriativoDatabase, initializeDatabase } from "../src/database/client.ts";
import { ClaudeProvider } from "../src/engine/providers/claude-provider.ts";
import { GeminiProvider } from "../src/engine/providers/gemini-provider.ts";
import { McpClient } from "../src/engine/providers/mcp-client.ts";
import { OllamaProvider } from "../src/engine/providers/ollama-provider.ts";
import { OpenAIProvider } from "../src/engine/providers/openai-provider.ts";
import { ProviderRegistry } from "../src/engine/providers/provider-registry.ts";
import { AgentRunner } from "../src/engine/runner/agent-runner.ts";
import { HandoffBus } from "../src/engine/runner/handoff-bus.ts";
import { MemoryManager } from "../src/engine/runner/memory-manager.ts";
import { ROSTER_15_AGENTES, seedDefaultAgents } from "../src/engine/runner/roster-defaults.ts";
import { SkillLoader } from "../src/engine/runner/skill-loader.ts";
import {
  buildGenerativeImagePrompt,
  generateImageTool,
} from "../src/engine/tools/generate-image.ts";
import { metaPublishTool } from "../src/engine/tools/meta-publish.ts";
import { buildRemotionCliArgs } from "../src/engine/tools/remotion-bridge.ts";
import {
  processImageMarginsAndCrop,
  resolveTargetDimensions,
} from "../src/engine/tools/sharp-pipeline.ts";
import { FifoQueueManager } from "../src/queue/fifo-queue.ts";
import { VaultService } from "../src/vault/vault-service.ts";

describe("Fase 3 — Multi-Provedor BYOK, MCP, Geração Multimodal & 15 Agentes", () => {
  let tempDir: string;
  let db: CriativoDatabase;
  let vault: VaultService;
  let queue: FifoQueueManager;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase3-"));
    db = initializeDatabase({ dbPath: join(tempDir, "phase3.db") });
    vault = new VaultService(db, "chave-fase-3-teste");
    queue = new FifoQueueManager(db);

    vault.setSecret("GEMINI_API_KEY", "gem-key-simulada-12345");
    vault.setSecret("CLAUDE_API_KEY", "ant-key-simulada-12345");
    vault.setSecret("OPENAI_API_KEY", "oai-key-simulada-12345");
    vault.setSecret("META_ACCESS_TOKEN", "meta-tok-simulado-12345");
    vault.setSecret("META_IG_USER_ID", "17841400000000000");
  });

  after(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("formata requisições e extrai tool calls em Gemini, Claude, OpenAI e Ollama sem vazar segredos", async () => {
    const context: AgentTurnContext = {
      model: "modelo-teste",
      systemPrompt: "Sistema de teste",
      messages: [{ role: "user", content: "Gere um post" }],
      tools: [
        {
          name: "generate_image",
          description: "Gera imagem",
          parameters: { type: "object", properties: { prompt: { type: "string" } } },
        },
      ],
    };

    const gemini = new GeminiProvider({
      vault,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: "generate_image",
                        args: { prompt: "capa" },
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const gemRes = await gemini.executeTurn({ ...context, model: "gemini-2.5-pro" });
    assert.equal(gemRes.toolCalls[0].name, "generate_image");

    const claude = new ClaudeProvider({
      vault,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                id: "tu_1",
                name: "generate_image",
                input: { prompt: "capa claude" },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const claRes = await claude.executeTurn({ ...context, model: "claude-3-7-sonnet-latest" });
    assert.equal(claRes.toolCalls[0].name, "generate_image");

    const openai = new OpenAIProvider({
      vault,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "generate_image",
                        arguments: JSON.stringify({ prompt: "capa gpt" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const oaiRes = await openai.executeTurn({ ...context, model: "gpt-4o" });
    assert.equal(oaiRes.toolCalls[0].name, "generate_image");

    const ollama = new OllamaProvider({
      vault,
      fetchImpl: async (url) => {
        assert.match(String(url), /localhost:11434\/v1\/chat\/completions/);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Resposta local Ollama" } }],
          }),
          { status: 200 }
        );
      },
    });
    const ollText = await ollama.generateText("Olá local");
    assert.equal(ollText, "Resposta local Ollama");

    // Garante higienização de chaves em erros
    const failingGemini = new GeminiProvider({
      vault,
      fetchImpl: async () => {
        throw new Error("Falha ao acessar endpoint com chave gem-key-simulada-12345");
      },
    });
    await assert.rejects(
      () => failingGemini.generateText("teste"),
      (err: Error) => !err.message.includes("gem-key-simulada-12345")
    );
  });

  it("conecta cliente MCP HTTP, lista e invoca ferramenta remota", async () => {
    const mcp = new McpClient(
      {
        mcp_id: "busca_local",
        nome: "Busca Teste",
        comando: "http://mcp.local/rpc",
        args: [],
        transport: "http",
      },
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { id: string; method: string };
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ id: body.id, result: { protocolVersion: "2024-11-05" } }));
        }
        if (body.method === "tools/list") {
          return new Response(
            JSON.stringify({
              id: body.id,
              result: { tools: [{ name: "buscar_tendencias", description: "Busca trends" }] },
            })
          );
        }
        return new Response(
          JSON.stringify({
            id: body.id,
            result: { ok: true, items: ["trend-1"] },
          })
        );
      }
    );

    const tools = await mcp.connect();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "mcp_busca_local_buscar_tendencias");
    const callRes = (await mcp.callTool(tools[0].name, { nicho: "saas" })) as { ok: boolean };
    assert.equal(callRes.ok, true);
  });

  it("monta prompt multimodal em generate_image com ImagePaths + consistência facial + anti-cópia", async () => {
    const refPhoto = join(tempDir, "foto-criador.png");
    const fakePng = Buffer.from("iVBORw0KGgo=", "base64");
    writeFileSync(refPhoto, fakePng);

    const outImage = join(tempDir, "out", "post-gerado.png");
    const builtPrompt = buildGenerativeImagePrompt({
      aspect_ratio: "3:4",
      prompt: "Editorial minimalista com tipografia em contraste",
      image_paths: [refPhoto],
      facial_consistency: true,
      output_path: outImage,
    });

    assert.match(builtPrompt, /SUBJECT \/ FACIAL CONSISTENCY/);
    assert.match(builtPrompt, /REGRA ANTI-CÓPIA/);

    const genRes = await generateImageTool(
      {
        aspect_ratio: "3:4",
        prompt: "Capa de carrossel com retrato em estúdio",
        image_paths: [refPhoto],
        facial_consistency: true,
        output_path: outImage,
        engine: "gemini",
      },
      {
        vault,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "image/png",
                          data: Buffer.from("IMAGEM_PNG_MOCK").toString("base64"),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 }
          ),
      }
    );

    assert.equal(genRes.references_loaded, 1);
    assert.equal(genRes.engine_used, "gemini");
    assert.equal(readFileSync(outImage).toString("utf8"), "IMAGEM_PNG_MOCK");
  });

  it("valida dimensões de corte Sharp, argumentos Remotion e trava de segurança Meta API", async () => {
    const dim45 = resolveTargetDimensions("3:4");
    assert.equal(dim45.width, 1080);
    assert.equal(dim45.height, 1350);
    assert.equal(dim45.safeMarginsPx.left, 108);

    const dim916 = resolveTargetDimensions("9:16");
    assert.equal(dim916.width, 1080);
    assert.equal(dim916.height, 1920);

    const srcFile = join(tempDir, "in.png");
    const dstFile = join(tempDir, "cropped.png");
    writeFileSync(srcFile, Buffer.from("png-placeholder"));
    const cropRes = await processImageMarginsAndCrop({
      inputPath: srcFile,
      outputPath: dstFile,
      aspect: "3:4",
    });
    assert.equal(cropRes.spec.height, 1350);

    const remotionArgs = buildRemotionCliArgs(
      {
        composicao: "ReelsFaceless",
        audio_path: "audio.mp3",
        legendas_srt_path: "sub.srt",
        output_path: "reel.mp4",
      },
      "props.json"
    );
    assert.ok(remotionArgs.includes("ReelsFaceless"));
    assert.ok(remotionArgs.includes("--width=1080"));
    assert.ok(remotionArgs.includes("--height=1920"));

    // Trava crítica: sem aprovação humana = erro imediato
    await assert.rejects(
      () =>
        metaPublishTool(
          {
            media_type: "IMAGE",
            media_urls: ["https://exemplo.invalid/img.png"],
            caption: "Legenda teste",
            approved_by_human: false,
          },
          { vault }
        ),
      /BLOQUEIO DE SEGURANÇA/
    );

    const pubOk = await metaPublishTool(
      {
        media_type: "IMAGE",
        media_urls: ["https://exemplo.invalid/img.png"],
        caption: "Legenda aprovada",
        approved_by_human: true,
      },
      {
        vault,
        fetchImpl: async (url) => {
          if (String(url).endsWith("/media")) {
            return new Response(JSON.stringify({ id: "cont_123" }), { status: 200 });
          }
          return new Response(JSON.stringify({ id: "post_999" }), { status: 200 });
        },
      }
    );
    assert.equal(pubOk.published, true);
    assert.equal(pubOk.media_id, "post_999");
  });

  it("carrega todos os 15 agentes especialistas e executa loop multi-turn com handoff no SQLite", async () => {
    seedDefaultAgents(db);
    assert.equal(ROSTER_15_AGENTES.length, 15);

    const dbAgentsCount = (
      db.connection.prepare(`SELECT COUNT(*) as total FROM projecao_agentes;`).get() as {
        total: number;
      }
    ).total;
    assert.equal(dbAgentsCount, 15);

    const loader = new SkillLoader();
    for (const def of ROSTER_15_AGENTES) {
      const compiled = loader.loadAgentSkill(def.agente_id);
      assert.ok(compiled.systemPrompt.length > 50);
    }

    const providers = new ProviderRegistry({ vault });
    let turnCount = 0;
    const mockGeminiClient: AIProviderClient = {
      name: "gemini",
      async generateText() {
        return "ok";
      },
      async executeTurn(ctx) {
        return this.streamTurn(ctx, () => {});
      },
      async streamTurn(_ctx, onChunk) {
        turnCount += 1;
        if (turnCount === 1) {
          onChunk({ type: "thought", tokenChunk: "Definindo pauta e passando para o Copywriter..." });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tc_handoff_1",
                name: "handoff_agente",
                arguments: {
                  para_agente_id: "copywriter",
                  instrucao: "Escreva 5 slides educativos sobre produtividade.",
                  enfileirar_proxima_tarefa: true,
                  tipo_proxima_tarefa: "copy",
                },
              },
            ],
          };
        }
        return {
          text: "Pauta estratégica gerada e encaminhada para o Copywriter.",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };
    providers.registerCustomProvider("gemini", mockGeminiClient);

    const runner = new AgentRunner({ db, queue, vault, providers });
    const tarefa = queue.enqueueTask({
      agente_id: "estrategista",
      tipo: "planejamento",
      titulo: "Pauta semanal de validação",
      prioridade: 2,
      payload: { pilar: "autoridade" },
    });
    const activeTask = queue.dequeueNextTask();
    assert.ok(activeTask);

    const runResult = await runner.runTask(activeTask!);
    assert.equal(runResult.turnsExecuted, 2);
    assert.equal(runResult.agenteId, "estrategista");

    const bus = new HandoffBus(db, queue);
    const msgs = bus.listTaskMessages(tarefa.tarefa_id);
    assert.ok(msgs.some((m) => m.tipo_mensagem === "handoff" && m.para_agente_id === "copywriter"));

    const mems = new MemoryManager(db).listMemories("estrategista");
    assert.ok(mems.length >= 1);

    const pendentesCopy = queue.listTasks("pendente").filter((t) => t.agente_id === "copywriter");
    assert.equal(pendentesCopy.length, 1);
  });
});
