import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { initializeDatabase, type CriativoDatabase } from "../src/database/client.ts";
import { generateImageTool } from "../src/engine/tools/generate-image.ts";
import { generateVideoTool } from "../src/engine/tools/generate-video.ts";
import { executeStudioExtensionTool } from "../src/server/studio-tools-bridge.ts";
import { planTurnContext, toolBelongsToScopes } from "../src/server/turn-context-planner.ts";
import { VaultService } from "../src/vault/vault-service.ts";

describe("Media Generation v2 — Nano Banana 2.1, GPT Image 2.6/2.5, Multi-Referências & Omni 1.2 Flash", () => {
  let tempDir: string;
  let db: CriativoDatabase;
  let vault: VaultService;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-media-v2-"));
    db = initializeDatabase({ dbPath: join(tempDir, "media-v2.db") });
    vault = new VaultService(db, "chave-teste-media-v2");
  });

  after(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("1. Gemini Nano Banana 2.1 envia todas as 8 referências, respeita imageConfig sem params proibidos e faz fallback automático", async () => {
    vault.setSecret("gemini_api_key", "gem-key-teste-v2");
    const refsDir = join(tempDir, "refs-gemini");
    mkdirSync(refsDir, { recursive: true });
    const imgPaths: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const p = join(refsDir, `ref-${i + 1}.png`);
      writeFileSync(p, Buffer.from(`fake-png-${i + 1}`));
      imgPaths.push(p);
    }

    const calledUrls: string[] = [];
    let capturedBody: Record<string, unknown> | null = null;

    const outPath = join(tempDir, "out", "nano-banana-out.png");
    const res = await generateImageTool(
      {
        aspect_ratio: "3:4",
        prompt: "Arte editorial com todos os produtos",
        image_paths: imgPaths,
        facial_consistency: true,
        output_path: outPath,
        engine: "gemini",
      },
      {
        vault,
        fetchImpl: async (url, init) => {
          const urlStr = String(url);
          calledUrls.push(urlStr);
          if (!capturedBody && init?.body) {
            capturedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          }
          if (urlStr.includes("gemini-nano-banana-2.1")) {
            return new Response(
              JSON.stringify({ error: { message: "Model gemini-nano-banana-2.1 not found" } }),
              { status: 404 }
            );
          }
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "image/png",
                          data: Buffer.from("NANO_BANANA_FALLBACK_OK").toString("base64"),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 }
          );
        },
      }
    );

    assert.equal(calledUrls.length, 2);
    assert.match(calledUrls[0]!, /gemini-nano-banana-2\.1:generateContent/);
    assert.match(calledUrls[1]!, /gemini-3\.1-flash-image:generateContent/);

    const contents = (capturedBody as { contents: Array<{ parts: unknown[] }> }).contents;
    assert.equal(contents[0]!.parts.length, 9, "1 prompt de texto + todas as 8 referências");

    const genCfg = (capturedBody as { generationConfig: Record<string, unknown> }).generationConfig;
    assert.deepEqual(genCfg.imageConfig, { aspectRatio: "3:4", imageSize: "2K" });
    assert.equal("temperature" in genCfg, false);
    assert.equal("seed" in genCfg, false);

    assert.equal(res.references_loaded, 8);
    assert.equal(res.model_used, "gemini-3.1-flash-image");
    assert.equal(readFileSync(outPath, "utf8"), "NANO_BANANA_FALLBACK_OK");

    // Sucesso direto na 1ª tentativa com gemini-nano-banana-2.1
    const directOut = join(tempDir, "out", "nano-banana-direct.png");
    const directRes = await generateImageTool(
      {
        aspect_ratio: "9:16",
        prompt: "Capa vertical",
        image_paths: imgPaths.slice(0, 4),
        output_path: directOut,
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
                          data: Buffer.from("NANO_BANANA_2_1_DIRECT").toString("base64"),
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
    assert.equal(directRes.model_used, "gemini-nano-banana-2.1");
    assert.equal(directRes.references_loaded, 4);
  });

  it("2. OpenAI GPT Image 2.6 / 2.5 envia 5 referências em multipart (/v1/images/edits) e faz fallback de 2.6 para 2.5", async () => {
    vault.setSecret("openai_api_key", "oai-key-teste-v2");
    const refsDir = join(tempDir, "refs-openai");
    mkdirSync(refsDir, { recursive: true });
    const imgPaths: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const p = join(refsDir, `foto-${i + 1}.png`);
      writeFileSync(p, Buffer.from(`openai-ref-${i + 1}`));
      imgPaths.push(p);
    }

    const calledModels: string[] = [];
    const outPath = join(tempDir, "out", "gpt-image-out.png");
    const res = await generateImageTool(
      {
        aspect_ratio: "3:4",
        prompt: "Anúncio premium com 5 ângulos do produto",
        image_paths: imgPaths,
        output_path: outPath,
        engine: "openai",
      },
      {
        vault,
        fetchImpl: async (url, init) => {
          assert.equal(String(url), "https://api.openai.com/v1/images/edits");
          assert.ok(init?.body instanceof FormData, "Deve usar multipart/form-data");
          const form = init.body as FormData;
          const model = String(form.get("model"));
          calledModels.push(model);
          assert.equal(form.get("size"), "1024x1536");
          assert.equal(form.getAll("image[]").length, 5);

          if (model === "gpt-image-2.6-sunburst") {
            return new Response(
              JSON.stringify({ error: { message: "Model gpt-image-2.6-sunburst not_found" } }),
              { status: 404 }
            );
          }
          return new Response(
            JSON.stringify({
              data: [{ b64_json: Buffer.from("GPT_IMAGE_2_5_OK").toString("base64") }],
            }),
            { status: 200 }
          );
        },
      }
    );

    assert.deepEqual(calledModels, ["gpt-image-2.6-sunburst", "gpt-image-2.5-sunburst"]);
    assert.equal(res.engine_used, "openai");
    assert.equal(res.model_used, "gpt-image-2.5-sunburst");
    assert.equal(res.references_loaded, 5);
    assert.equal(readFileSync(outPath, "utf8"), "GPT_IMAGE_2_5_OK");
  });

  it("3. Gemini Omni 1.2 Flash gera vídeo com áudio, 4 referências, polling Files API e download MP4", async () => {
    vault.setSecret("gemini_api_key", "gem-key-video-v2");
    const refsDir = join(tempDir, "refs-video");
    mkdirSync(refsDir, { recursive: true });
    const refPaths: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const p = join(refsDir, `cena-${i + 1}.jpg`);
      writeFileSync(p, Buffer.from(`video-ref-${i + 1}`));
      refPaths.push(p);
    }

    let filePollCount = 0;
    const outVideo = join(tempDir, "out", "reel-omni.mp4");
    const vidRes = await generateVideoTool(
      {
        prompt: "Cena dinâmica vertical com narração em português",
        aspect_ratio: "9:16",
        duration_seconds: 10,
        resolution: "720p",
        image_paths: refPaths,
        output_path: outVideo,
        poll_interval_ms: 10,
      },
      {
        vault,
        fetchImpl: async (url, init) => {
          const urlStr = String(url);
          if (urlStr.includes("/v1beta/interactions")) {
            const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
            assert.equal(payload.model, "gemini-omni-1.2-flash");
            assert.deepEqual(payload.response_format, {
              type: "video",
              duration: "10s",
              aspect_ratio: "9:16",
              resolution: "720p",
              delivery: "uri",
            });
            assert.equal((payload.image_inputs as unknown[]).length, 4);
            return new Response(
              JSON.stringify({ id: "int-omni-1", output_video: { uri: "files/vid-omni-99" } }),
              { status: 200 }
            );
          }
          if (urlStr.includes("/v1beta/files/vid-omni-99:download")) {
            return new Response(Buffer.from("MP4_OMNI_1_2_STREAM_BYTES"), { status: 200 });
          }
          if (urlStr.includes("/v1beta/files/vid-omni-99")) {
            filePollCount += 1;
            const state = filePollCount === 1 ? "PROCESSING" : "ACTIVE";
            return new Response(JSON.stringify({ state }), { status: 200 });
          }
          throw new Error(`URL inesperada no mock de vídeo: ${urlStr}`);
        },
      }
    );

    assert.equal(filePollCount, 2);
    assert.equal(vidRes.model_used, "gemini-omni-1.2-flash");
    assert.equal(vidRes.duration_seconds, 10);
    assert.equal(vidRes.aspect_ratio, "9:16");
    assert.equal(vidRes.resolution, "720p");
    assert.equal(vidRes.references_loaded, 4);
    assert.equal(vidRes.interaction_id, "int-omni-1");
    assert.ok(vidRes.size_bytes > 0);
    assert.equal(readFileSync(outVideo, "utf8"), "MP4_OMNI_1_2_STREAM_BYTES");
  });

  it("4. MCP tools generate_image (OpenAI fallback sem Antigravity) e generate_video integram com projecao_arquivos e planTurnContext", async () => {
    const plan = planTurnContext({
      userPrompt: "Crie um clipe vertical usando omniflash com minhas fotos",
      agenteId: "editor_video",
      isGreetingOrCapability: false,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
      hasExternalMcps: false,
    });
    assert.ok(plan.mcpScopes.includes("media"));
    assert.equal(toolBelongsToScopes("generate_video", new Set(plan.mcpScopes)), true);

    // Prepara 4 imagens relativas dentro do workspaceRoot temporário
    const wsRoot = join(tempDir, "ws-mcp");
    const fotosDir = join(wsRoot, "recursos", "fotos");
    mkdirSync(fotosDir, { recursive: true });
    const relRefs: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const rel = `recursos/fotos/modelo-${i + 1}.png`;
      writeFileSync(join(wsRoot, rel), Buffer.from(`ws-foto-${i + 1}`));
      relRefs.push(rel);
    }

    // Cria Cofre isolado contendo APENAS openai_api_key (zero Gemini e zero Antigravity)
    const dbOpenAiOnly = initializeDatabase({ dbPath: join(tempDir, "openai-only.db") });
    const vaultOpenAiOnly = new VaultService(dbOpenAiOnly, "chave-openai-only");
    vaultOpenAiOnly.setSecret("openai_api_key", "oai-only-key");

    try {
      const imgOut = (await executeStudioExtensionTool(
        "generate_image",
        {
          prompt: "Post editorial com 4 ângulos escolhidos pelo agente",
          formato: "3:4",
          imagens_referencia: relRefs,
        },
        {
          db: dbOpenAiOnly,
          vault: vaultOpenAiOnly,
          workspaceRoot: wsRoot,
          agenteId: "designer_individual",
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                data: [{ b64_json: Buffer.from("MCP_GPT_IMAGE_OK").toString("base64") }],
              }),
              { status: 200 }
            ),
        }
      )) as {
        ok: boolean;
        engine_used: string;
        references_loaded: number;
        anexo: { caminho_relativo: string; tipo_uso: string };
      };

      assert.equal(imgOut.ok, true);
      assert.equal(imgOut.engine_used, "openai");
      assert.equal(imgOut.references_loaded, 4);
      assert.equal(imgOut.anexo.tipo_uso, "gerado");
      assert.equal(existsSync(join(wsRoot, imgOut.anexo.caminho_relativo)), true);

      const dbImgRow = dbOpenAiOnly.connection
        .prepare(`SELECT tipo_uso, mime_type FROM projecao_arquivos WHERE caminho_relativo = ?;`)
        .get(imgOut.anexo.caminho_relativo) as { tipo_uso: string; mime_type: string } | undefined;
      assert.equal(dbImgRow?.tipo_uso, "gerado");

      // Agora adiciona gemini_api_key e gera vídeo via generate_video
      vaultOpenAiOnly.setSecret("gemini_api_key", "gem-key-mcp-vid");
      const vidOut = (await executeStudioExtensionTool(
        "generate_video",
        {
          prompt: "Vídeo curto para Reels",
          formato: "9:16",
          duracao_segundos: 6,
          imagens_referencia: relRefs.slice(0, 2),
        },
        {
          db: dbOpenAiOnly,
          vault: vaultOpenAiOnly,
          workspaceRoot: wsRoot,
          agenteId: "editor_video",
          fetchImpl: async (url) => {
            const urlStr = String(url);
            if (urlStr.includes("/v1beta/interactions")) {
              return new Response(
                JSON.stringify({ id: "int-mcp-1", output_video: { uri: "files/vid-mcp-1" } }),
                { status: 200 }
              );
            }
            if (urlStr.includes("/v1beta/files/vid-mcp-1:download")) {
              return new Response(Buffer.from("MCP_OMNI_MP4"), { status: 200 });
            }
            return new Response(JSON.stringify({ state: "ACTIVE" }), { status: 200 });
          },
        }
      )) as {
        ok: boolean;
        duracao_segundos: number;
        references_loaded: number;
        anexo: { caminho_relativo: string; mime_type: string; tipo_uso: string };
      };

      assert.equal(vidOut.ok, true);
      assert.equal(vidOut.duracao_segundos, 6);
      assert.equal(vidOut.references_loaded, 2);
      assert.equal(vidOut.anexo.mime_type, "video/mp4");
      assert.equal(vidOut.anexo.tipo_uso, "video");
      assert.match(vidOut.anexo.caminho_relativo, /^saidas\/videos\/video-.*\.mp4$/);
      assert.equal(existsSync(join(wsRoot, vidOut.anexo.caminho_relativo)), true);

      const dbVidRow = dbOpenAiOnly.connection
        .prepare(`SELECT tipo_uso, mime_type FROM projecao_arquivos WHERE caminho_relativo = ?;`)
        .get(vidOut.anexo.caminho_relativo) as { tipo_uso: string; mime_type: string } | undefined;
      assert.equal(dbVidRow?.tipo_uso, "video");
      assert.equal(dbVidRow?.mime_type, "video/mp4");
    } finally {
      dbOpenAiOnly.close();
    }
  });
});
