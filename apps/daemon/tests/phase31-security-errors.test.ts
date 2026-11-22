import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { mapErrorToCatalog } from "../src/server/error-catalog-mapper.ts";
import { StructuredLogger } from "../src/server/structured-logger.ts";
import { VaultService } from "../src/vault/vault-service.ts";

test("VaultService bloqueia fallback hardcoded quando NODE_ENV=production e nenhuma chave foi definida", () => {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();

  const prevNodeEnv = process.env.NODE_ENV;
  const prevVaultKey = process.env.CRIATIVO_VAULT_KEY;
  const prevMasterKey = process.env.VAULT_MASTER_KEY;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.CRIATIVO_VAULT_KEY;
    delete process.env.VAULT_MASTER_KEY;

    assert.throws(
      () => new VaultService(db),
      (err: unknown) => err instanceof Error && err.message.includes("CRV-VAULT-001")
    );

    const vaultWithKey = new VaultService(db, "chave-segura-teste-fase31");
    vaultWithKey.setSecret("TOKEN_TESTE", "valor-seguro");
    assert.equal(vaultWithKey.getSecret("TOKEN_TESTE"), "valor-seguro");
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevVaultKey !== undefined) process.env.CRIATIVO_VAULT_KEY = prevVaultKey;
    else delete process.env.CRIATIVO_VAULT_KEY;
    if (prevMasterKey !== undefined) process.env.VAULT_MASTER_KEY = prevMasterKey;
    else delete process.env.VAULT_MASTER_KEY;
  }
});

test("mapErrorToCatalog converte erros brutos em codigos CRV-* sem vazar segredos", () => {
  const mappedVault = mapErrorToCatalog(
    new Error("Chave mestra CRIATIVO_VAULT_KEY ausente Bearer sk-1234567890abcdef")
  );
  assert.equal(mappedVault.code, "CRV-VAULT-001");
  assert.ok(mappedVault.traceId.startsWith("trc-"));
  assert.ok(!(mappedVault.rawSummary ?? "").includes("sk-1234567890abcdef"));

  const mappedMeta = mapErrorToCatalog(
    new Error("Meta Graph API falhou access_token=EAAGfakeSecretToken123456789"),
    ["EAAGfakeSecretToken123456789"]
  );
  assert.equal(mappedMeta.code, "CRV-META-002");
  assert.ok(!(mappedMeta.rawSummary ?? "").includes("EAAGfakeSecretToken123456789"));

  const mappedOAuth = mapErrorToCatalog(new Error("OAuth code_verifier expirado"));
  assert.equal(mappedOAuth.code, "CRV-AUTH-003");
});

test("StructuredLogger redige tokens/chaves antes de persistir JSONL e permite consultar por nivel/codigo", () => {
  const dir = mkdtempSync(join(tmpdir(), "crv-logger-31-"));
  try {
    const logger = new StructuredLogger({ logsDir: dir });
    logger.error("meta", "Falha Graph API com Bearer segredo-bearer-abc12345", {
      code: "CRV-META-002",
      traceId: "trc-test01",
      metadata: {
        access_token: "token-super-secreto",
        conta: "principal",
      },
      secrets: ["segredo-bearer-abc12345"],
    });
    logger.info("system", "Inicialização normal concluída");

    const diskContent = readFileSync(logger.filePath, "utf8");
    assert.ok(!diskContent.includes("segredo-bearer-abc12345"));
    assert.ok(!diskContent.includes("token-super-secreto"));
    assert.ok(diskContent.includes("[REDACTED]"));

    const filtered = logger.queryRecentLogs({ level: "error", code: "CRV-META-002", limit: 10 });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.code, "CRV-META-002");
    assert.equal(filtered[0]?.metadata?.access_token, "[REDACTED]");
    assert.equal(filtered[0]?.metadata?.conta, "principal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
