import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import {
  AgentTemplatePublisher,
  TemplateValidationError,
} from "../src/marketplace/agent-template-publisher.ts";
import {
  DeepLinkSecurityError,
  parseCriativoDeepLink,
} from "../../desktop/src/deep-link-router.ts";

test("Deep links criativo:// roteiam com allowlist e templates exportam/instalam com verificação SHA-256", () => {
  // 1. Parser de deep link criativo://
  const agentRoute = parseCriativoDeepLink("criativo://agent/estrategista");
  assert.deepEqual(agentRoute, {
    kind: "agent",
    agenteId: "estrategista",
    rawUrl: "criativo://agent/estrategista",
  });

  const tplRoute = parseCriativoDeepLink(
    "criativo://template/install?url=https%3A%2F%2Fexample.com%2Ftpl.json",
  );
  assert.equal(tplRoute.kind, "template_install");
  assert.equal(tplRoute.sourceUrl, "https://example.com/tpl.json");

  assert.throws(
    () => parseCriativoDeepLink("javascript:alert(1)"),
    DeepLinkSecurityError,
  );
  assert.throws(
    () => parseCriativoDeepLink("criativo://unknown/hack?x=1"),
    DeepLinkSecurityError,
  );
  assert.throws(
    () => parseCriativoDeepLink("criativo://template/install?url=file:///etc/passwd"),
    DeepLinkSecurityError,
  );

  // 2. Publicação e instalação versionada com SHA-256
  const dir = mkdtempSync(join(tmpdir(), "criativo-tpl-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  const publisher = new AgentTemplatePublisher({ db });
  const now = new Date().toISOString();
  db.connection
    .prepare(
      "INSERT INTO projecao_agentes (agente_id, nome, papel, modelo_padrao, status, skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em) VALUES (?, ?, ?, ?, 'ocioso', ?, '', 1, ?, ?);",
    )
    .run(
      "roteirista_demo",
      "Roteirista",
      "Roteiros",
      "gemini-2.5-flash",
      JSON.stringify(["copywriter-instagram"]),
      JSON.stringify({
        temperatura: 0.7,
        cua_enabled: true,
        system_prompt: "Não vazar C:\\Users\\Example\\secret sk-1234567890abcdef",
      }),
      now,
    );

  try {
    const exported = publisher.exportAgentTemplate({
      agenteId: "roteirista_demo",
      version: "1.2.0",
      authorDisplay: "Studio Team",
    });

    assert.equal(exported.version, "1.2.0");
    assert.equal(exported.config_sanitized.cua_enabled, false);
    assert.ok(!JSON.stringify(exported).includes("sk-1234567890abcdef"));
    assert.ok(!JSON.stringify(exported).includes("C:\\Users\\Example"));

    // Adulteração do nome invalida hash SHA-256
    assert.throws(
      () =>
        publisher.installTemplatePackage({
          pkg: { ...exported, name: "Nome Adulterado" },
        }),
      TemplateValidationError,
    );

    // Pacote íntegro instala com sucesso
    const installed = publisher.installTemplatePackage({
      pkg: exported,
      agenteIdOverride: "roteirista_clonado",
    });
    assert.equal(installed.agente_id, "roteirista_clonado");
    assert.equal(installed.sha256, exported.sha256);

    const row = db.connection
      .prepare("SELECT nome FROM projecao_agentes WHERE agente_id = ?;")
      .get("roteirista_clonado");
    assert.equal(row?.nome, "Roteirista");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
