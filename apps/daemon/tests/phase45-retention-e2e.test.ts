import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import type {
  MetaGalleryResponse,
  MetaPostingIntelligenceReport,
} from "@criativo/contracts";
import { CriativoDatabase } from "../src/database/client.ts";
import type { StudioRouteContext, StudioRoutesDeps } from "../src/server/routes/route-helpers.ts";
import { tryHandleSocialStudioRoutes } from "../src/server/social-studio-routes.ts";
import { EditorialCalendarService } from "../src/social/editorial-calendar-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

async function invokeSocialRoute(
  db: CriativoDatabase,
  pathAndQuery: string
): Promise<{ handled: boolean; statusCode: number; body: unknown }> {
  let capturedStatus = 0;
  let capturedBody: unknown = null;

  const deps: Pick<
    StudioRoutesDeps,
    "db" | "sendJson" | "readJsonBody" | "wsHub"
  > = {
    db,
    wsHub: {
      broadcast: () => undefined,
    } as unknown as StudioRoutesDeps["wsHub"],
    sendJson: (_res, statusCode, body) => {
      capturedStatus = statusCode;
      capturedBody = body;
    },
    readJsonBody: async () => ({}),
  };

  const url = new URL(`http://127.0.0.1${pathAndQuery}`);
  const ctx: StudioRouteContext = {
    req: { method: "GET", url: pathAndQuery } as IncomingMessage,
    res: {} as ServerResponse,
    path: url.pathname,
    method: "GET",
    url,
    deps: deps as StudioRoutesDeps,
    db,
    wsHub: deps.wsHub,
    workspaceRoot: process.cwd(),
  };

  const handled = await tryHandleSocialStudioRoutes(ctx);
  return { handled, statusCode: capturedStatus, body: capturedBody };
}

test("E2E Rotas Fase 45: /api/instagram/galeria-metricas e /api/editorial/inteligencia-horarios", async () => {
  const db = createTestDb();
  const nowMs = Date.now();
  const syncIso = new Date(nowMs - 60_000).toISOString();
  const reelTs = new Date(nowMs - 2 * 86_400_000).toISOString();
  const carouselTs = new Date(nowMs - 4 * 86_400_000).toISOString();

  const reelPayload = {
    id: "e2e-reel-1",
    caption_resumo: "Reel E2E [NOME_DA_MARCA] [@SEU_PERFIL]",
    media_type: "VIDEO",
    media_product_type: "REELS",
    permalink: "https://instagram.example/p/e2e-reel",
    timestamp: reelTs,
    likes: 210,
    comments: 25,
    reach: 2400,
    views: 4100,
    saved: 168,
    shares: 48,
    reposts: 14,
    total_interactions: 451,
    avg_watch_time_ms: 8800,
    video_view_total_time_ms: 36080000,
    taxa_salvamento_pct: 7,
    skip_rate_3s_pct: 28.5,
    hook_retention_3s_pct: 71.5,
  };

  const carouselPayload = {
    id: "e2e-car-2",
    caption_resumo: "Carrossel E2E [@SEU_PERFIL]",
    media_type: "CAROUSEL_ALBUM",
    media_product_type: "FEED",
    permalink: "https://instagram.example/p/e2e-car",
    timestamp: carouselTs,
    likes: 150,
    comments: 18,
    reach: 1800,
    views: 2500,
    saved: 126,
    shares: 30,
    reposts: 8,
    total_interactions: 324,
    avg_watch_time_ms: null,
    video_view_total_time_ms: null,
    taxa_salvamento_pct: 7,
    skip_rate_3s_pct: null,
    hook_retention_3s_pct: null,
  };

  const insertCache = db.connection.prepare(
    "INSERT INTO meta_posts_cache (media_id, conta_id, payload_json, sincronizado_em) VALUES (?, '999000111222', ?, ?);"
  );
  insertCache.run("e2e-reel-1", JSON.stringify(reelPayload), syncIso);
  insertCache.run("e2e-car-2", JSON.stringify(carouselPayload), syncIso);

  const editorial = new EditorialCalendarService(db);
  editorial.createPost({
    titulo: "Pauta E2E [NOME_DA_MARCA]",
    formato: "reels",
    status: "publicado",
    meta_media_id: "e2e-reel-1",
    data_agendada: "2026-12-20",
  });

  // 1) GET /api/instagram/galeria-metricas?periodo=30d&refresh=0
  const galleryRes = await invokeSocialRoute(
    db,
    "/api/instagram/galeria-metricas?periodo=30d&refresh=0"
  );
  assert.equal(galleryRes.handled, true);
  assert.equal(galleryRes.statusCode, 200);
  const gallery = galleryRes.body as MetaGalleryResponse;
  assert.equal(gallery.ok, true);
  assert.equal(gallery.from_cache, true);
  assert.equal(gallery.posts.length, 2);
  assert.equal(gallery.summary.reposts_total, 22);
  assert.equal(gallery.summary.skip_rate_3s_medio_pct, 28.5);
  assert.equal(gallery.summary.retencao_3s_media_pct, 71.5);

  const reelItem = gallery.posts.find((p) => p.id === "e2e-reel-1")!;
  assert.equal(reelItem.skip_rate_3s_pct, 28.5);
  assert.equal(reelItem.hook_retention_3s_pct, 71.5);
  assert.equal(reelItem.reposts, 14);

  const carItem = gallery.posts.find((p) => p.id === "e2e-car-2")!;
  assert.equal(carItem.skip_rate_3s_pct, null);
  assert.equal(carItem.reposts, 8);

  // 2) GET /api/editorial/inteligencia-horarios?periodo=30d&timezone=America/Sao_Paulo
  const intelRes = await invokeSocialRoute(
    db,
    "/api/editorial/inteligencia-horarios?periodo=30d&timezone=America/Sao_Paulo"
  );
  assert.equal(intelRes.handled, true);
  assert.equal(intelRes.statusCode, 200);
  const intel = intelRes.body as MetaPostingIntelligenceReport;
  assert.equal(intel.ok, true);
  assert.equal(intel.total_posts_analisados, 2);
  assert.ok(intel.melhores_horarios.length > 0);
  assert.ok(intel.formatos_campeoes.length > 0);
  assert.ok(intel.proximo_slot_sugerido);
  assert.equal(intel.resumo_retencao.total_reposts, 22);
  assert.equal(intel.resumo_retencao.avg_skip_rate_3s_pct, 28.5);
  db.close();
});
