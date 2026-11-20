import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

// PNG 1x1 pixel transparente válido para teste de upload
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("Avatares V2 (Daemon API) — Persistência em Agentes, Upload em recursos/avatares e Validações", () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-avatars-"));
    dbPath = join(tempDir, "avatars-test.db");

    runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    baseUrl = `http://127.0.0.1:${runtime.port}`;
  });

  after(async () => {
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    await runtime.close().catch(() => {});
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
    } catch {
      // Ignora lock residual no Windows
    }
  });

  it("1. Faz upload de foto de avatar PNG em recursos/avatares/ e serve em /api/arquivos/raw", async () => {
    const res = await fetch(`${baseUrl}/api/agentes/avatar/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "foto-teste.png",
        mime_type: "image/png",
        conteudo_base64: `data:image/png;base64,${TINY_PNG_BASE64}`,
      }),
    });

    assert.equal(res.status, 201);
    const json = (await res.json()) as {
      ok: boolean;
      avatar_image_url: string;
      caminho_relativo: string;
      mime_type: string;
      tamanho_bytes: number;
    };
    assert.equal(json.ok, true);
    assert.match(json.caminho_relativo, /^recursos\/avatares\/avatar-.+\.png$/);
    assert.match(json.avatar_image_url, /^\/api\/arquivos\/raw\?path=/);
    assert.equal(json.mime_type, "image/png");
    assert.ok(json.tamanho_bytes > 0);

    const diskPath = join(tempDir, json.caminho_relativo);
    assert.equal(existsSync(diskPath), true);
    assert.deepEqual(readFileSync(diskPath), Buffer.from(TINY_PNG_BASE64, "base64"));

    const rawRes = await fetch(`${baseUrl}${json.avatar_image_url}`);
    assert.equal(rawRes.status, 200);
    assert.equal(rawRes.headers.get("content-type"), "image/png");
    const fetchedBuf = Buffer.from(await rawRes.arrayBuffer());
    assert.deepEqual(fetchedBuf, Buffer.from(TINY_PNG_BASE64, "base64"));
  });

  it("2. Rejeita upload com MIME inválido e retorna erro claro ao gerar avatar por IA sem credencial", async () => {
    const badMimeRes = await fetch(`${baseUrl}/api/agentes/avatar/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "malicioso.txt",
        mime_type: "text/plain",
        conteudo_base64: Buffer.from("hello").toString("base64"),
      }),
    });
    assert.equal(badMimeRes.status, 400);

    const noCredGenRes = await fetch(`${baseUrl}/api/agentes/avatar/gerar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Mascote robô amigável azul em estilo 3D",
        estilo: "3D Pixar",
      }),
    });
    assert.equal(noCredGenRes.status, 400);
    const errJson = (await noCredGenRes.json()) as { ok: boolean; erro: string };
    assert.equal(errJson.ok, false);
    assert.match(errJson.erro, /chave|Antigravity|Cofre/i);
  });

  it("3. Persiste avatar_style, avatar_variant e avatar_image_url em POST /api/agentes e PUT /api/agentes/:id", async () => {
    const createRes = await fetch(`${baseUrl}/api/agentes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Robô Criativo",
        papel: "Analista visual",
        prompt_base: "Prompt de teste",
        modelo_padrao: "gemini-2.5-flash",
        avatar_shape: "hex",
        avatar_color: "#a855f7",
        avatar_style: "robots",
        avatar_variant: "bot_cat",
        effort: "medio",
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as {
      agente: { agente_id: string; config: Record<string, unknown> };
    };
    const agId = createdJson.agente.agente_id;
    assert.equal(createdJson.agente.config.avatar_style, "robots");
    assert.equal(createdJson.agente.config.avatar_variant, "bot_cat");
    assert.equal(createdJson.agente.config.avatar_color, "#a855f7");

    // Atualiza para estilo "image" com foto salva
    const putImgRes = await fetch(`${baseUrl}/api/agentes/${encodeURIComponent(agId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar_style: "image",
        avatar_image_url: "/api/arquivos/raw?path=recursos%2Favatares%2Ffoto.png",
      }),
    });
    assert.equal(putImgRes.status, 200);
    const putImgJson = (await putImgRes.json()) as {
      agente: { config: Record<string, unknown> };
    };
    assert.equal(putImgJson.agente.config.avatar_style, "image");
    assert.equal(
      putImgJson.agente.config.avatar_image_url,
      "/api/arquivos/raw?path=recursos%2Favatares%2Ffoto.png"
    );

    // Troca para cartoon limpando avatar_image_url: null
    const putCartoonRes = await fetch(`${baseUrl}/api/agentes/${encodeURIComponent(agId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar_style: "cartoon",
        avatar_variant: "cart_shades",
        avatar_color: "#f97316",
        avatar_image_url: null,
      }),
    });
    assert.equal(putCartoonRes.status, 200);
    const putCartoonJson = (await putCartoonRes.json()) as {
      agente: { config: Record<string, unknown> };
    };
    assert.equal(putCartoonJson.agente.config.avatar_style, "cartoon");
    assert.equal(putCartoonJson.agente.config.avatar_variant, "cart_shades");
    assert.equal(putCartoonJson.agente.config.avatar_image_url, null);
  });
});
