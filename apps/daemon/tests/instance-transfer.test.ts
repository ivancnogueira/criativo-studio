import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { InstanceTransferService } from "../src/servers/instance-transfer-service.ts";

test("InstanceTransferService exporta seletivamente sem segredos, rejeita chunk corrompido e restaura em banco limpo", () => {
  const srcDir = mkdtempSync(join(tmpdir(), "criativo-xfer-src-"));
  const dstDir = mkdtempSync(join(tmpdir(), "criativo-xfer-dst-"));
  const srcDb = new CriativoDatabase({ dbPath: join(srcDir, "src.db") });
  const dstDb = new CriativoDatabase({ dbPath: join(dstDir, "dst.db") });
  srcDb.initializeDatabase();
  dstDb.initializeDatabase();

  try {
    const srcVault = new VaultService(srcDb, "segredo-origem");
    srcVault.setSecret("OPENAI_API_KEY", "sk-nao-pode-ir-no-bundle");

    srcDb.connection
      .prepare(
        `INSERT INTO projecao_agentes (
          agente_id, nome, papel, modelo_padrao, status, config_json, ordem_exibicao, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agente_id) DO UPDATE SET nome = excluded.nome;`,
      )
      .run(
        "agente_migrado",
        "Agente Migrado Teste",
        "Estrategista",
        "gemini-2.5-pro",
        "ocioso",
        "{}",
        50,
        new Date().toISOString(),
      );

    srcDb.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em) VALUES (?, ?, ?);`,
      )
      .run("pref_ui_teste", JSON.stringify({ ok: true }), new Date().toISOString());

    const srcTransfer = new InstanceTransferService(srcDb);
    const dstTransfer = new InstanceTransferService(dstDb);

    // Exportar em chunks pequenos para testar múltiplos pacotes
    const { manifest, chunks } = srcTransfer.exportToChunks({
      scope: {
        agents: true,
        memories: false,
        workflows: true,
        routines: false,
        library: false,
        preferences: true,
      },
      chunkSizeBytes: 512,
    });

    assert.equal(manifest.secretsExcluded, true);
    assert.ok(chunks.length >= 1);
    assert.equal(
      chunks.some((c) => Buffer.from(c.dataBase64, "base64").toString("utf8").includes("sk-nao-pode-ir-no-bundle")),
      false,
    );

    // Corrupção simulada de chunk deve falhar e fazer rollback
    dstTransfer.beginImportJob({ ...manifest, jobId: "xfer_corrompido" });
    const badChunk = { ...chunks[0]!, chunkSha256: "0".repeat(64) };
    dstTransfer.receiveChunk("xfer_corrompido", badChunk);
    assert.throws(() => dstTransfer.commitImport("xfer_corrompido"));

    // Importação íntegra
    dstTransfer.beginImportJob(manifest);
    for (const pkt of chunks) {
      dstTransfer.receiveChunk(manifest.jobId, pkt);
    }
    const result = dstTransfer.commitImport(manifest.jobId);
    assert.equal(result.ok, true);

    const restoredAgent = dstDb.connection
      .prepare("SELECT nome FROM projecao_agentes WHERE agente_id = ?;")
      .get("agente_migrado") as { nome?: string } | undefined;
    assert.equal(restoredAgent?.nome, "Agente Migrado Teste");
  } finally {
    srcDb.close();
    dstDb.close();
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstDir, { recursive: true, force: true });
  }
});
