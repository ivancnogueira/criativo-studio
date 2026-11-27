import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { computeHostAnalytics } from "../src/server/host-analytics-service.ts";
import { resolveProviderChartColor } from "../../web/src/features/pages/usage-chart-helpers.ts";

const tempDirs: string[] = [];
const openDbs: CriativoDatabase[] = [];

function createTestDb(): CriativoDatabase {
  const dir = mkdtempSync(join(tmpdir(), "criativo-phase43-usage-"));
  tempDirs.push(dir);
  const db = new CriativoDatabase({ dbPath: join(dir, "usage.db") });
  db.initializeDatabase();
  openDbs.push(db);
  return db;
}

function insertUsageRow(
  db: CriativoDatabase,
  input: {
    id: string;
    provider: string;
    daysAgo: number;
    uncachedInput: number;
    cacheCreation?: number;
    outputTokens: number;
    costUsd: number | null;
  },
) {
  const occurred = new Date(Date.now() - input.daysAgo * 24 * 60 * 60 * 1000).toISOString();
  db.connection
    .prepare(
      `INSERT INTO projecao_uso_registros
       (record_id, agent_id, session_id, turn_id, provider, model, occurred_at, uncached_input, cached_input, cache_creation, output_tokens, estimated_cost_usd, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    )
    .run(
      input.id,
      "estrategista",
      "chat:estrategista",
      `turn-${input.id}`,
      input.provider,
      `${input.provider}-model`,
      occurred,
      input.uncachedInput,
      0,
      input.cacheCreation ?? 0,
      input.outputTokens,
      input.costUsd,
      occurred,
    );
}

describe("Fase 43-02 — Analytics empilhado semanal (90d), mensal (1 ano / histórico) e cores determinísticas", () => {
  afterEach(() => {
    while (openDbs.length > 0) {
      const db = openDbs.pop();
      try {
        db?.connection.close();
      } catch {
        // ignora
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("agrega 90 dias com granularidade semanal contínua e soma exata por provedor", () => {
    const db = createTestDb();
    insertUsageRow(db, {
      id: "w-1",
      provider: "claude",
      daysAgo: 5,
      uncachedInput: 1000,
      outputTokens: 500,
      costUsd: 0.15,
    });
    insertUsageRow(db, {
      id: "w-2",
      provider: "antigravity",
      daysAgo: 35,
      uncachedInput: 2000,
      outputTokens: 1000,
      costUsd: 0.25,
    });
    insertUsageRow(db, {
      id: "w-3",
      provider: "custom_proxy",
      daysAgo: 75,
      uncachedInput: 4000,
      outputTokens: 1500,
      costUsd: 0.6,
    });

    const report = computeHostAnalytics(db, { dias: 90 });
    assert.equal(report.granularidade, "semanal");
    assert.ok(report.serie_empilhada && report.serie_empilhada.length >= 13);
    assert.ok(report.serie_empilhada.every((b) => /^\d{4}-W\d{2}$/.test(b.chave)));

    const totalTokensSerie = report.serie_empilhada.reduce((sum, b) => sum + b.tokens, 0);
    const totalCostSerie = report.serie_empilhada.reduce((sum, b) => sum + b.custo_usd, 0);
    assert.equal(totalTokensSerie, 1500 + 3000 + 5500);
    assert.ok(Math.abs(totalCostSerie - 1.0) < 1e-4);

    const byProv = new Map<string, number>();
    for (const bucket of report.serie_empilhada) {
      for (const seg of bucket.por_provedor) {
        byProv.set(seg.provedor, (byProv.get(seg.provedor) ?? 0) + seg.tokens);
      }
    }
    assert.equal(byProv.get("claude"), 1500);
    assert.equal(byProv.get("antigravity"), 3000);
    assert.equal(byProv.get("custom_proxy"), 5500);
  });

  it("agrega 365 dias com granularidade mensal e não trunca histórico em 365 quando dias=3650", () => {
    const db = createTestDb();
    insertUsageRow(db, {
      id: "m-1",
      provider: "claude",
      daysAgo: 20,
      uncachedInput: 800,
      outputTokens: 200,
      costUsd: 0.1,
    });
    insertUsageRow(db, {
      id: "m-2",
      provider: "openai",
      daysAgo: 200,
      uncachedInput: 1200,
      outputTokens: 800,
      costUsd: 0.2,
    });
    insertUsageRow(db, {
      id: "m-old",
      provider: "custom:meu_gateway",
      daysAgo: 520,
      uncachedInput: 5000,
      outputTokens: 1000,
      costUsd: 0.5,
    });

    const yearReport = computeHostAnalytics(db, { dias: 365 });
    assert.equal(yearReport.granularidade, "mensal");
    assert.ok(yearReport.serie_empilhada && yearReport.serie_empilhada.length >= 12);
    assert.ok(yearReport.serie_empilhada.every((b) => /^\d{4}-\d{2}$/.test(b.chave)));
    assert.equal(
      yearReport.serie_empilhada.reduce((sum, b) => sum + b.tokens, 0),
      1000 + 2000,
    );

    const fullReport = computeHostAnalytics(db, { dias: 3650 });
    assert.equal(fullReport.periodo_dias, 3650);
    assert.equal(fullReport.granularidade, "mensal");
    assert.ok(fullReport.serie_empilhada && fullReport.serie_empilhada.length >= 17);
    assert.equal(
      fullReport.serie_empilhada.reduce((sum, b) => sum + b.tokens, 0),
      1000 + 2000 + 6000,
    );
  });

  it("resolveProviderChartColor gera cores válidas, distintas e determinísticas para nativos e customizados", () => {
    const validColor = /^(#[0-9a-fA-F]{6}|hsl\(\d{1,3},\s*\d{1,3}%,\s*\d{1,3}%\))$/;
    const claude = resolveProviderChartColor("claude");
    const openai = resolveProviderChartColor("openai");
    const gemini = resolveProviderChartColor("antigravity");
    const customA = resolveProviderChartColor("custom:proxy-alfa");
    const customB = resolveProviderChartColor("custom:proxy-beta");

    for (const c of [claude, openai, gemini, customA, customB]) {
      assert.match(c, validColor);
    }
    assert.equal(customA, resolveProviderChartColor("custom:proxy-alfa"));
    assert.notEqual(claude, openai);
    assert.notEqual(openai, gemini);
    assert.notEqual(customA, customB);
  });
});
