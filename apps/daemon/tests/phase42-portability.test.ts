import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  WORKFLOW_PORTABLE_FORMAT,
  type PortableWorkflowBundle,
  type WorkflowImportResult,
} from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("Fase 42-04 — Exportação/Importação Portável com Assets, Zero Segredos e Estado Pausado", () => {
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

  it("exporta fluxo com assets embutidos bloqueando segredos, importa remapeando asset/agente e cria workflow com ativo=false", async () => {
    const dirSrc = mkdtempSync(join(tmpdir(), "crv-42-04-src-"));
    const dirDst = mkdtempSync(join(tmpdir(), "crv-42-04-dst-"));
    tempDirs.push(dirSrc, dirDst);

    let rtSrc: DaemonRuntime | null = null;
    let rtDst: DaemonRuntime | null = null;

    try {
      // 1. Instância Origem
      rtSrc = await createDaemonServer({
        port: 0,
        dbPath: join(dirSrc, "src.db"),
        workspaceRoot: dirSrc,
        autoStartLoops: false,
        controlSocketPath: null,
      });

      const customSrcId = "ag_custom_src_1";
      rtSrc.db.connection
        .prepare(
          `INSERT INTO projecao_agentes (agente_id, nome, papel, modelo_padrao, status, ordem_exibicao, config_json, atualizado_em)
           VALUES (?, 'Editor Criativo VIP', 'Editor', 'gemini-2.5-pro', 'ocioso', 99, '{}', ?);`
        )
        .run(customSrcId, new Date().toISOString());

      mkdirSync(join(dirSrc, "recursos", "uploads"), { recursive: true });
      const assetRel = "recursos/uploads/logo-teste.png";
      writeFileSync(join(dirSrc, assetRel), TINY_PNG);
      rtSrc.db.connection
        .prepare(
          `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
           VALUES ('arq-src-1', 'logo-teste.png', ?, 'image/png', ?, 'referencia', NULL, NULL, ?);`
        )
        .run(assetRel, TINY_PNG.length, new Date().toISOString());

      const srcUrl = `http://127.0.0.1:${rtSrc.port}`;
      const wfRes = await fetch(`${srcUrl}/api/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Fluxo Portável Teste",
          descricao: "Exporta asset e agente sem segredos",
          ativo: true,
          nos: [
            {
              id: "g_wh",
              tipo: "gatilho",
              titulo: "Webhook",
              x: 100,
              y: 100,
              triggerKind: "webhook",
              trigger: { kind: "webhook", secretHint: "hint-abc" },
              config: { triggerKind: "webhook", webhook_secret_vault_key: "wf_secret_ref" },
            },
            {
              id: "as_1",
              tipo: "asset",
              titulo: "Logo Referência",
              x: 340,
              y: 100,
              fileId: "arq-src-1",
              config: { fileId: "arq-src-1" },
            },
            {
              id: "ag_1",
              tipo: "agente",
              titulo: "Especialista Custom",
              x: 620,
              y: 100,
              agenteId: customSrcId,
              prompt: "Use a referência",
              config: { agenteId: customSrcId },
            },
            {
              id: "l_1",
              tipo: "llm",
              titulo: "LLM",
              x: 900,
              y: 100,
              prompt: "Texto sk-proj-fakeSecret1234567890",
              config: {
                apiKey: "sk-proj-fakeSecret1234567890",
                token: "ghp_faketoken12345678901234567890",
              },
            },
          ],
          arestas: [
            { id: "e1", origem: "g_wh", destino: "ag_1", type: "text" },
            { id: "e2", origem: "as_1", destino: "ag_1", type: "image" },
            { id: "e3", origem: "ag_1", destino: "l_1", type: "text" },
          ],
        }),
      });
      assert.equal(wfRes.status, 201);
      const { workflow } = (await wfRes.json()) as { workflow: { workflow_id: string } };

      const rotRes = await fetch(
        `${srcUrl}/api/workflows/${workflow.workflow_id}/gatilhos/g_wh/rotacionar-webhook`,
        { method: "POST" }
      );
      const rotJson = (await rotRes.json()) as { secret: string };
      assert.ok(rotJson.secret);

      const expRes = await fetch(`${srcUrl}/api/workflows/${workflow.workflow_id}/exportar`);
      assert.equal(expRes.status, 200);
      const bundleText = await expRes.text();
      const bundle = JSON.parse(bundleText) as PortableWorkflowBundle;

      assert.equal(bundle.format, WORKFLOW_PORTABLE_FORMAT);
      assert.equal(bundle.assets.length, 1);
      assert.equal(
        bundle.assets[0]?.sha256,
        createHash("sha256").update(TINY_PNG).digest("hex")
      );
      assert.equal(bundle.agents.length, 1);
      assert.equal(bundle.agents[0]?.nome, "Editor Criativo VIP");

      assert.doesNotMatch(bundleText, new RegExp(rotJson.secret));
      assert.doesNotMatch(bundleText, /sk-proj-/i);
      assert.doesNotMatch(bundleText, /ghp_/i);
      assert.doesNotMatch(bundleText, /webhook_secret_vault_key/i);
      assert.doesNotMatch(bundleText, /apiKey/i);

      // 2. Instância Destino limpa com outro ID para o mesmo nome de agente
      rtDst = await createDaemonServer({
        port: 0,
        dbPath: join(dirDst, "dst.db"),
        workspaceRoot: dirDst,
        autoStartLoops: false,
        controlSocketPath: null,
      });
      const customDstId = "ag_custom_dst_99";
      rtDst.db.connection
        .prepare(
          `INSERT INTO projecao_agentes (agente_id, nome, papel, modelo_padrao, status, ordem_exibicao, config_json, atualizado_em)
           VALUES (?, 'Editor Criativo VIP', 'Editor', 'gemini-2.5-pro', 'ocioso', 99, '{}', ?);`
        )
        .run(customDstId, new Date().toISOString());

      const dstUrl = `http://127.0.0.1:${rtDst.port}`;
      const impRes = await fetch(`${dstUrl}/api/workflows/importar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bundleText,
      });
      assert.equal(impRes.status, 201);
      const imported = (await impRes.json()) as WorkflowImportResult;

      assert.equal(imported.pausedOnImport, true);
      assert.equal(imported.workflow.ativo, false);
      assert.equal(imported.importedAssets, 1);

      const importedAssetNode = imported.workflow.nos.find((n) => n.id === "as_1");
      assert.ok(importedAssetNode?.fileId);
      assert.notEqual(importedAssetNode.fileId, "arq-src-1");
      assert.notEqual(importedAssetNode.fileId, "asset-1");

      const dstFileRow = rtDst.db.connection
        .prepare(`SELECT caminho_relativo FROM projecao_arquivos WHERE arquivo_id = ?;`)
        .get(importedAssetNode.fileId) as { caminho_relativo: string } | undefined;
      assert.ok(dstFileRow && existsSync(join(dirDst, dstFileRow.caminho_relativo)));

      const importedAgentNode = imported.workflow.nos.find((n) => n.id === "ag_1");
      assert.equal(importedAgentNode?.agenteId, customDstId);

      // 3. Segurança contra sha256 adulterado e path traversal
      const tamperedHash: PortableWorkflowBundle = {
        ...bundle,
        assets: [{ ...bundle.assets[0]!, sha256: "0000000000000000" }],
      };
      const badHashRes = await fetch(`${dstUrl}/api/workflows/importar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tamperedHash),
      });
      assert.equal(badHashRes.status, 400);

      const traversalBundle: PortableWorkflowBundle = {
        ...bundle,
        assets: [{ ...bundle.assets[0]!, fileName: "../../evil.png" }],
      };
      const badPathRes = await fetch(`${dstUrl}/api/workflows/importar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(traversalBundle),
      });
      assert.equal(badPathRes.status, 400);
    } finally {
      await rtSrc?.close();
      await rtDst?.close();
    }
  });
});
