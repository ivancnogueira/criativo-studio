import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { EditorialCalendarService } from "../src/social/editorial-calendar-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

function insertCachePost(
  db: CriativoDatabase,
  input: {
    id: string;
    timestamp: string;
    mediaType: string;
    productType: string;
    reach: number;
    views: number;
    saved: number;
    shares: number;
    reposts: number;
    likes: number;
    comments: number;
    skipRate?: number | null;
  }
): void {
  const payload = {
    id: input.id,
    caption_resumo: `Post ${input.id} [@SEU_PERFIL]`,
    media_type: input.mediaType,
    media_product_type: input.productType,
    permalink: `https://instagram.example/p/${input.id}`,
    timestamp: input.timestamp,
    likes: input.likes,
    comments: input.comments,
    reach: input.reach,
    views: input.views,
    saved: input.saved,
    shares: input.shares,
    reposts: input.reposts,
    total_interactions: input.likes + input.comments + input.saved + input.shares,
    avg_watch_time_ms: null,
    video_view_total_time_ms: null,
    taxa_salvamento_pct:
      input.reach > 0 ? Number(((input.saved / input.reach) * 100).toFixed(2)) : null,
    skip_rate_3s_pct: input.skipRate ?? null,
    hook_retention_3s_pct:
      typeof input.skipRate === "number" ? Number((100 - input.skipRate).toFixed(2)) : null,
  };
  db.connection
    .prepare(
      "INSERT INTO meta_posts_cache (media_id, conta_id, payload_json, sincronizado_em) VALUES (?, '999000111222', ?, ?);"
    )
    .run(input.id, JSON.stringify(payload), input.timestamp);
}

test("Caso 1: cache vazio retorna amostra_insuficiente=true e recomendacao de sincronizar", () => {
  const db = createTestDb();
  const editorial = new EditorialCalendarService(db);
  const report = editorial.getPostingIntelligence({ timezone: "America/Sao_Paulo" });

  assert.equal(report.ok, true);
  assert.equal(report.amostra_insuficiente, true);
  assert.equal(report.total_posts_analisados, 0);
  assert.deepEqual(report.melhores_horarios, []);
  assert.equal(report.proximo_slot_sugerido, null);
  assert.ok(report.recomendacoes.some((r) => r.tipo === "amostra"));
  db.close();
});

test("Caso 2: ranking de horarios, formatos campeoes e resumo de retencao/reposts", () => {
  const db = createTestDb();
  const editorial = new EditorialCalendarService(db);
  const refNow = new Date("2026-11-27T12:00:00.000Z");

  // Terça 19:00 America/Sao_Paulo = 22:00Z (2026-11-24 e 2026-11-17 são terças)
  insertCachePost(db, {
    id: "tue-1",
    timestamp: "2026-11-24T22:15:00.000Z",
    mediaType: "VIDEO",
    productType: "REELS",
    reach: 2000,
    views: 3500,
    saved: 180,
    shares: 70,
    reposts: 25,
    likes: 250,
    comments: 30,
    skipRate: 22,
  });
  insertCachePost(db, {
    id: "tue-2",
    timestamp: "2026-11-17T22:40:00.000Z",
    mediaType: "VIDEO",
    productType: "REELS",
    reach: 1800,
    views: 3100,
    saved: 160,
    shares: 60,
    reposts: 20,
    likes: 210,
    comments: 28,
    skipRate: 26,
  });

  // Sexta 10:00 America/Sao_Paulo = 13:00Z (2026-11-20 e 2026-11-13 são sextas)
  insertCachePost(db, {
    id: "fri-1",
    timestamp: "2026-11-20T13:10:00.000Z",
    mediaType: "VIDEO",
    productType: "REELS",
    reach: 1000,
    views: 1100,
    saved: 10,
    shares: 2,
    reposts: 1,
    likes: 30,
    comments: 2,
    skipRate: 64,
  });
  insertCachePost(db, {
    id: "fri-2",
    timestamp: "2026-11-13T13:20:00.000Z",
    mediaType: "IMAGE",
    productType: "FEED",
    reach: 900,
    views: 950,
    saved: 12,
    shares: 3,
    reposts: 0,
    likes: 25,
    comments: 3,
    skipRate: null,
  });
  insertCachePost(db, {
    id: "wed-1",
    timestamp: "2026-11-18T15:00:00.000Z",
    mediaType: "CAROUSEL_ALBUM",
    productType: "FEED",
    reach: 1500,
    views: 1800,
    saved: 60,
    shares: 15,
    reposts: 4,
    likes: 90,
    comments: 10,
    skipRate: null,
  });
  insertCachePost(db, {
    id: "thu-1",
    timestamp: "2026-11-19T16:00:00.000Z",
    mediaType: "CAROUSEL_ALBUM",
    productType: "FEED",
    reach: 1400,
    views: 1650,
    saved: 55,
    shares: 12,
    reposts: 3,
    likes: 85,
    comments: 8,
    skipRate: null,
  });

  const report = editorial.getPostingIntelligence({
    periodo: "30d",
    timezone: "America/Sao_Paulo",
    referenceNow: refNow,
  });

  assert.equal(report.ok, true);
  assert.equal(report.total_posts_analisados, 6);
  assert.equal(report.amostra_insuficiente, false);
  assert.equal(report.melhores_horarios[0].dia_semana, 1);
  assert.equal(report.melhores_horarios[0].dia_label, "Ter");
  assert.equal(report.melhores_horarios[0].hora, 19);

  assert.equal(report.formatos_campeoes[0].formato, "reels");
  assert.equal(report.formatos_campeoes[0].campeao, true);
  const imagemFmt = report.formatos_campeoes.find((f) => f.formato === "imagem");
  assert.equal(imagemFmt?.editorial_formato, "feed_4_5");

  assert.equal(report.resumo_retencao.total_reels_com_skip_rate, 3);
  assert.equal(report.resumo_retencao.avg_skip_rate_3s_pct, 37.33);
  assert.equal(report.resumo_retencao.avg_hook_retention_3s_pct, 62.67);
  assert.equal(report.resumo_retencao.total_reposts, 53);
  db.close();
});

test("Caso 3: skip_rate_3s_pct medio acima de 50 gera recomendacao alerta_gancho", () => {
  const db = createTestDb();
  const editorial = new EditorialCalendarService(db);
  const refNow = new Date("2026-11-27T12:00:00.000Z");

  insertCachePost(db, {
    id: "hook-bad-1",
    timestamp: "2026-11-25T15:00:00.000Z",
    mediaType: "VIDEO",
    productType: "REELS",
    reach: 1000,
    views: 1300,
    saved: 15,
    shares: 4,
    reposts: 1,
    likes: 40,
    comments: 3,
    skipRate: 62,
  });
  insertCachePost(db, {
    id: "hook-bad-2",
    timestamp: "2026-11-24T15:00:00.000Z",
    mediaType: "VIDEO",
    productType: "REELS",
    reach: 1100,
    views: 1400,
    saved: 18,
    shares: 5,
    reposts: 1,
    likes: 45,
    comments: 4,
    skipRate: 58,
  });

  const report = editorial.getPostingIntelligence({
    periodo: "30d",
    timezone: "America/Sao_Paulo",
    referenceNow: refNow,
  });

  assert.equal(report.resumo_retencao.avg_skip_rate_3s_pct, 60);
  assert.ok(report.recomendacoes.some((r) => r.tipo === "alerta_gancho"));
  db.close();
});

test("Caso 4: proximo_slot_sugerido pula Terca ocupada em calendario_editorial_posts e rota HTTP responde 200", async () => {
  const db = createTestDb();
  const editorial = new EditorialCalendarService(db);
  // Sexta-feira 2026-11-27 -> primeira terça futura é 2026-12-01; terça seguinte é 2026-12-08
  const refNow = new Date("2026-11-27T12:00:00.000Z");

  insertCachePost(db, {
    id: "slot-tue-1",
    timestamp: "2026-11-24T22:00:00.000Z",
    mediaType: "CAROUSEL_ALBUM",
    productType: "FEED",
    reach: 2000,
    views: 2500,
    saved: 180,
    shares: 40,
    reposts: 10,
    likes: 150,
    comments: 20,
  });

  editorial.createPost({
    titulo: "Pauta ocupando primeira terça [NOME_DA_MARCA]",
    formato: "carrossel",
    status: "agendado",
    data_agendada: "2026-12-01",
  });

  const report = editorial.getPostingIntelligence({
    periodo: "30d",
    timezone: "America/Sao_Paulo",
    referenceNow: refNow,
  });

  assert.ok(report.proximo_slot_sugerido);
  assert.equal(report.proximo_slot_sugerido.data_agendada, "2026-12-08");
  assert.equal(report.proximo_slot_sugerido.dia_label, "Ter");
  assert.equal(report.proximo_slot_sugerido.hora_sugerida, "19:00");
  assert.equal(report.proximo_slot_sugerido.formato_recomendado, "carrossel");
  db.close();

  // Teste HTTP integrado da rota GET /api/editorial/inteligencia-horarios
  const prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  const tempDir = mkdtempSync(join(tmpdir(), "criativo-phase45-"));
  let runtime: DaemonRuntime | null = null;
  try {
    runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "phase45.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
    });
    const res = await fetch(
      `http://127.0.0.1:${runtime.port}/api/editorial/inteligencia-horarios?periodo=30d&timezone=America/Sao_Paulo`
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; amostra_insuficiente: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.amostra_insuficiente, true);
  } finally {
    if (runtime) await runtime.close();
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
