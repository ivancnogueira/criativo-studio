import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkflowBatchVariantResult, WorkflowRunDetail } from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

async function waitForRunDone(baseUrl: string, runId: string): Promise<WorkflowRunDetail> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const res = await fetch(`${baseUrl}/api/workflows/execucoes/${runId}`);
    if (res.ok) {
      const json = (await res.json()) as { execucao?: WorkflowRunDetail };
      const detail = json.execucao;
      if (detail && (detail.run.status === "done" || detail.run.status === "failed")) {
        return detail;
      }
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timeout aguardando conclusão do run ${runId}`);
}

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Fase 42-03 — Lote 4x Simultâneo, Retry Individual e Drop/Upload MOV/MP4/MP3/WAV", () => {
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
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignora
      }
    }
  });

  it("gera lote 4x simultâneo com falha parcial em 1 slot e executa retry individual sem refazer os demais", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "crv-42-03-batch-"));
    tempDirs.push(tempDir);
    let runtime: DaemonRuntime | null = null;

    let callSeq = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    let failOnCallNumber = 2;

    try {
      const fetchMock: typeof fetch = async (input) => {
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes("generativelanguage.googleapis.com") || urlStr.includes("openai.com")) {
          callSeq += 1;
          const myCall = callSeq;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 45));
          inFlight -= 1;

          if (myCall === failOnCallNumber) {
            return new Response(JSON.stringify({ error: { message: "Erro simulado no slot" } }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" } }],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      };

      runtime = await createDaemonServer({
        port: 0,
        dbPath: join(tempDir, "studio.db"),
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
        fetchImpl: fetchMock,
      });
      runtime.vault.setSecret("gemini_api_key", "fake-gemini-img-key-4203");

      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const wfRes = await fetch(`${baseUrl}/api/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Lote 4x Imagens",
          nos: [
            {
              id: "g1",
              tipo: "gatilho",
              titulo: "Início",
              x: 100,
              y: 120,
              triggerKind: "manual",
              config: { triggerKind: "manual" },
            },
            {
              id: "img4",
              tipo: "gerar_imagem",
              titulo: "Gerar 4 variações",
              x: 420,
              y: 120,
              prompt: "Arte minimalista para [NOME_DA_MARCA]",
              batchCount: 4,
              mediaProviderId: "native:gemini",
              config: { batchCount: 4, aspectRatio: "3:4" },
            },
          ],
          arestas: [{ id: "eb1", origem: "g1", destino: "img4", type: "text" }],
        }),
      });
      assert.equal(wfRes.status, 201);
      const { workflow } = (await wfRes.json()) as { workflow: { workflow_id: string } };

      const runRes = await fetch(`${baseUrl}/api/workflows/${workflow.workflow_id}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(runRes.status, 200);
      const { run_id } = (await runRes.json()) as { run_id: string };
      const detail = await waitForRunDone(baseUrl, run_id);

      assert.equal(detail.run.status, "done");
      assert.ok(maxInFlight >= 2, `Esperado paralelismo simultâneo (>=2), obtido ${maxInFlight}`);
      assert.equal(callSeq, 4);

      const imgStep = detail.steps.find((s) => s.node_id === "img4");
      assert.ok(imgStep);
      const variants = JSON.parse(imgStep.artefatos_json) as WorkflowBatchVariantResult[];
      assert.equal(variants.length, 4);
      assert.equal(variants.filter((v) => v.status === "done").length, 3);
      const failedSlot = variants.find((v) => v.status === "failed");
      assert.ok(failedSlot, "Deveria haver exatamente 1 variação com falha");

      for (const doneVar of variants.filter((v) => v.status === "done")) {
        assert.ok(doneVar.relPath && existsSync(join(tempDir, doneVar.relPath)));
      }

      const prevFileIds = new Map(variants.map((v) => [v.slotIndex, v.arquivoId]));

      // Corrige mock e executa retry INDIVIDUAL apenas do slot falho
      failOnCallNumber = -1;
      const retryRes = await fetch(
        `${baseUrl}/api/workflows/etapas/${imgStep.step_id}/variacoes/${failedSlot.slotIndex}/retentar`,
        { method: "POST" }
      );
      assert.equal(retryRes.status, 200);
      const retryJson = (await retryRes.json()) as {
        ok: boolean;
        variants: WorkflowBatchVariantResult[];
      };

      assert.equal(retryJson.ok, true);
      assert.equal(callSeq, 5, "Retry individual deve disparar apenas +1 chamada ao provedor");
      assert.equal(retryJson.variants.length, 4);
      assert.equal(retryJson.variants.filter((v) => v.status === "done").length, 4);

      for (const slot of [0, 1, 2, 3]) {
        if (slot !== failedSlot.slotIndex) {
          const item = retryJson.variants.find((v) => v.slotIndex === slot);
          assert.equal(item?.arquivoId, prevFileIds.get(slot));
        }
      }
    } finally {
      await runtime?.close();
    }
  });

  it("upload streaming e leitura /api/arquivos/raw suportam MP4, MOV, MP3 e WAV", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "crv-42-03-media-"));
    tempDirs.push(tempDir);
    let runtime: DaemonRuntime | null = null;

    try {
      mkdirSync(join(tempDir, "recursos"), { recursive: true });
      runtime = await createDaemonServer({
        port: 0,
        dbPath: join(tempDir, "studio.db"),
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
      });

      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const samples = [
        { name: "clipe.mov", expectedMime: "video/quicktime", bytes: Buffer.from("ftypqt  mov") },
        { name: "reel.mp4", expectedMime: "video/mp4", bytes: Buffer.from("ftypisommp4") },
        { name: "trilha.mp3", expectedMime: "audio/mpeg", bytes: Buffer.from("ID3mp3data") },
        { name: "voz.wav", expectedMime: "audio/wav", bytes: Buffer.from("RIFFwavdata") },
      ];

      for (const sample of samples) {
        const upRes = await fetch(
          `${baseUrl}/api/arquivos/upload?nome=${encodeURIComponent(sample.name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: sample.bytes,
          }
        );
        assert.equal(upRes.status, 201, `Upload falhou para ${sample.name}`);
        const upJson = (await upRes.json()) as {
          arquivo: { mime_type: string; caminho_relativo: string };
        };
        assert.equal(upJson.arquivo.mime_type, sample.expectedMime);

        const rawRes = await fetch(
          `${baseUrl}/api/arquivos/raw?path=${encodeURIComponent(upJson.arquivo.caminho_relativo)}`
        );
        assert.equal(rawRes.status, 200);
        assert.equal(rawRes.headers.get("content-type"), sample.expectedMime);
      }
    } finally {
      await runtime?.close();
    }
  });
});
