import assert from "node:assert/strict";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import type { FetchLike } from "../src/engine/providers/provider-interface.ts";
import { fetchMetaAccountAndMediaInsights } from "../src/engine/tools/meta-insights.ts";
import { MetaGalleryService } from "../src/social/meta-gallery-service.ts";
import { VaultService } from "../src/vault/vault-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

function setupVault(db: CriativoDatabase): VaultService {
  const vault = new VaultService(db, "chave-teste-fase45");
  vault.setSecret("instagram_access_token", "fake-test-token-not-real");
  vault.setSecret("instagram_business_account_id", "999000111222");
  return vault;
}

function makeBaseMockFetch(
  insightsHandler: (url: string) => Response
): FetchLike {
  return async (url) => {
    if (url.includes("/999000111222/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { name: "reach", total_value: { value: 4200 } },
            { name: "views", total_value: { value: 7800 } },
            { name: "profile_views", total_value: { value: 210 } },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/999000111222/media")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "reel-45-1",
              caption: "Reel gancho [NOME_DA_MARCA] [@SEU_PERFIL]",
              media_type: "VIDEO",
              media_product_type: "REELS",
              permalink: "https://instagram.example/p/reel45",
              timestamp: new Date().toISOString(),
              like_count: 180,
              comments_count: 24,
            },
            {
              id: "car-45-2",
              caption: "Carrossel educativo [@SEU_PERFIL]",
              media_type: "CAROUSEL_ALBUM",
              media_product_type: "FEED",
              permalink: "https://instagram.example/p/car45",
              timestamp: new Date().toISOString(),
              like_count: 120,
              comments_count: 14,
            },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/insights")) {
      return insightsHandler(url);
    }
    return new Response(
      JSON.stringify({
        id: "999000111222",
        username: "seu_perfil_teste",
        name: "[NOME_DA_MARCA]",
        followers_count: 2500,
        follows_count: 300,
        media_count: 45,
      }),
      { status: 200 }
    );
  };
}

test("Caso 1: coleta completa de reels_skip_rate e reposts em Reel e Carrossel", async () => {
  const db = createTestDb();
  const vault = setupVault(db);

  const mockFetch = makeBaseMockFetch((url) => {
    if (url.includes("/reel-45-1/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { name: "views", total_value: { value: 5000 } },
            { name: "reach", total_value: { value: 3000 } },
            { name: "saved", total_value: { value: 150 } },
            { name: "shares", total_value: { value: 45 } },
            { name: "ig_reels_avg_watch_time", total_value: { value: 9200 } },
            { name: "ig_reels_video_view_total_time", total_value: { value: 46000000 } },
            { name: "reels_skip_rate", total_value: { value: 34.5 } },
            { name: "reposts", total_value: { value: 12 } },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        data: [
          { name: "views", total_value: { value: 2200 } },
          { name: "reach", total_value: { value: 1600 } },
          { name: "saved", total_value: { value: 96 } },
          { name: "shares", total_value: { value: 20 } },
          { name: "total_interactions", total_value: { value: 270 } },
          { name: "reposts", total_value: { value: 7 } },
        ],
      }),
      { status: 200 }
    );
  });

  const report = await fetchMetaAccountAndMediaInsights(
    { periodo: "30d", limite_posts: 10 },
    { vault, fetchImpl: mockFetch }
  );

  assert.equal(report.ok, true);
  assert.equal(report.posts.length, 2);

  const reel = report.posts.find((p) => p.id === "reel-45-1")!;
  assert.equal(reel.skip_rate_3s_pct, 34.5);
  assert.equal(reel.hook_retention_3s_pct, 65.5);
  assert.equal(reel.reposts, 12);

  const car = report.posts.find((p) => p.id === "car-45-2")!;
  assert.equal(car.skip_rate_3s_pct, null);
  assert.equal(car.hook_retention_3s_pct, null);
  assert.equal(car.reposts, 7);
  db.close();
});

test("Caso 2: fallback por permissao mantem reposts quando reels_skip_rate falha com HTTP 400", async () => {
  const db = createTestDb();
  const vault = setupVault(db);

  const mockFetch = makeBaseMockFetch((url) => {
    const metricParam = decodeURIComponent(url.split("metric=")[1]?.split("&")[0] ?? "");
    if (metricParam.includes("reels_skip_rate")) {
      return new Response(
        JSON.stringify({ error: { message: "(#100) Invalid metric reels_skip_rate", code: 100 } }),
        { status: 400 }
      );
    }
    if (url.includes("/reel-45-1/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { name: "views", total_value: { value: 4000 } },
            { name: "reach", total_value: { value: 2400 } },
            { name: "saved", total_value: { value: 100 } },
            { name: "shares", total_value: { value: 30 } },
            { name: "reposts", total_value: { value: 9 } },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        data: [
          { name: "views", total_value: { value: 1800 } },
          { name: "reach", total_value: { value: 1200 } },
          { name: "saved", total_value: { value: 60 } },
          { name: "shares", total_value: { value: 15 } },
          { name: "reposts", total_value: { value: 4 } },
        ],
      }),
      { status: 200 }
    );
  });

  const report = await fetchMetaAccountAndMediaInsights(
    { periodo: "30d" },
    { vault, fetchImpl: mockFetch }
  );

  assert.equal(report.ok, true);
  const reel = report.posts.find((p) => p.id === "reel-45-1")!;
  assert.equal(reel.reposts, 9);
  assert.equal(reel.skip_rate_3s_pct, null);
  assert.equal(reel.hook_retention_3s_pct, null);
  assert.ok(report.avisos.some((a) => a.includes("reels_skip_rate")));
  db.close();
});

test("Caso 3: fallback duplo sem reels_skip_rate e sem reposts cai para baseline v27.0 sem erro", async () => {
  const db = createTestDb();
  const vault = setupVault(db);

  const mockFetch = makeBaseMockFetch((url) => {
    const metricParam = decodeURIComponent(url.split("metric=")[1]?.split("&")[0] ?? "");
    if (metricParam.includes("reels_skip_rate") || metricParam.includes("reposts")) {
      return new Response(
        JSON.stringify({ error: { message: "(#100) Unsupported metric", code: 100 } }),
        { status: 400 }
      );
    }
    return new Response(
      JSON.stringify({
        data: [
          { name: "views", total_value: { value: 1500 } },
          { name: "reach", total_value: { value: 1000 } },
          { name: "saved", total_value: { value: 50 } },
          { name: "shares", total_value: { value: 10 } },
        ],
      }),
      { status: 200 }
    );
  });

  const report = await fetchMetaAccountAndMediaInsights(
    { periodo: "30d" },
    { vault, fetchImpl: mockFetch }
  );

  assert.equal(report.ok, true);
  assert.equal(report.posts.length, 2);
  assert.equal(report.posts[0].skip_rate_3s_pct, null);
  assert.equal(report.posts[0].reposts, null);
  assert.equal(report.posts[0].reach, 1000);
  db.close();
});

test("Caso 4: MetaGalleryService le snapshot legado de meta_posts_cache com coalescencia para null", async () => {
  const db = createTestDb();
  const vault = setupVault(db);
  const nowIso = new Date().toISOString();

  const legacyPayload = {
    id: "legacy-45-1",
    caption_resumo: "Post legado [NOME_DA_MARCA]",
    media_type: "VIDEO",
    media_product_type: "REELS",
    permalink: "https://instagram.example/p/legacy",
    timestamp: nowIso,
    likes: 80,
    comments: 10,
    reach: 1000,
    views: 1500,
    saved: 40,
    shares: 12,
    total_interactions: 142,
    avg_watch_time_ms: 7000,
    video_view_total_time_ms: 10500000,
    taxa_salvamento_pct: 4,
  };

  db.connection
    .prepare(
      "INSERT INTO meta_posts_cache (media_id, conta_id, payload_json, sincronizado_em) VALUES (?, '999000111222', ?, ?);"
    )
    .run("legacy-45-1", JSON.stringify(legacyPayload), nowIso);

  const gallery = new MetaGalleryService({ db, vault });
  const res = await gallery.getGallery({ periodo: "30d", refresh: false });

  assert.equal(res.ok, true);
  assert.equal(res.from_cache, true);
  assert.equal(res.posts.length, 1);
  assert.equal(res.posts[0].skip_rate_3s_pct, null);
  assert.equal(res.posts[0].hook_retention_3s_pct, null);
  assert.equal(res.posts[0].reposts, null);
  assert.equal(res.summary.reposts_total, 0);
  assert.equal(res.summary.skip_rate_3s_medio_pct, null);
  db.close();
});
