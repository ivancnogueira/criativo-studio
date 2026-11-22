import assert from "node:assert/strict";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { metaPublishTool } from "../src/engine/tools/meta-publish.ts";
import { EditorialCalendarService } from "../src/social/editorial-calendar-service.ts";
import { MetaGalleryService } from "../src/social/meta-gallery-service.ts";
import { VaultService } from "../src/vault/vault-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

test("EditorialCalendarService: CRUD, filtros por mes/status/formato, reagendamento e reordenacao de slides", () => {
  const db = createTestDb();
  const service = new EditorialCalendarService(db);

  const post = service.createPost({
    titulo: "Carrossel Bastidores [NOME_DA_MARCA]",
    formato: "carrossel",
    status: "rascunho",
    pilar: "Autoridade",
    data_agendada: "2026-12-10",
    agente_id: "designer_chefe",
    legenda: "Gancho principal para [@SEU_PERFIL]",
    slides: [
      { id: "s1", url: "/api/arquivos/raw?path=saidas/slide-1.png", ordem: 0 },
      { id: "s2", url: "/api/arquivos/raw?path=saidas/slide-2.png", ordem: 1 },
      { id: "s3", url: "/api/arquivos/raw?path=saidas/slide-3.png", ordem: 2 },
    ],
  });

  assert.ok(post.id.startsWith("ed-"));
  assert.equal(post.slides.length, 3);
  assert.equal(post.status, "rascunho");

  const outroMes = service.createPost({
    titulo: "Story CTA Janeiro",
    formato: "story",
    status: "ideia",
    data_agendada: "2027-01-05",
  });
  assert.equal(outroMes.formato, "story");

  const dez = service.listPosts({ mes: "2026-12", formato: "carrossel", status: "rascunho" });
  assert.equal(dez.length, 1);
  assert.equal(dez[0].id, post.id);

  // Reagendar data e reordenar slides invertendo ordem
  const updated = service.updatePost(post.id, {
    data_agendada: "2026-12-15",
    status: "aprovacao",
    slides: [
      { id: "s3", url: "/api/arquivos/raw?path=saidas/slide-3.png", ordem: 0 },
      { id: "s1", url: "/api/arquivos/raw?path=saidas/slide-1.png", ordem: 1 },
    ],
  });

  assert.equal(updated.data_agendada, "2026-12-15");
  assert.equal(updated.status, "aprovacao");
  assert.equal(updated.slides.length, 2);
  assert.equal(updated.slides[0].id, "s3");
  assert.equal(updated.slides[0].ordem, 0);
  assert.equal(updated.slides[1].id, "s1");
  assert.equal(updated.slides[1].ordem, 1);

  assert.equal(service.deletePost(outroMes.id), true);
  assert.equal(service.getPost(outroMes.id), null);
});

test("MetaGalleryService: fallback sem credenciais retorna CRV-META-001 e sync com fetch mockado popula cache e KPIs", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase32");

  // Sem credenciais: retorna fallback gracioso
  const semCreds = new MetaGalleryService({ db, vault });
  const resSemCreds = await semCreds.getGallery({ periodo: "30d", refresh: true });
  assert.equal(resSemCreds.ok, false);
  assert.equal(resSemCreds.error_code, "CRV-META-001");
  assert.equal(resSemCreds.posts.length, 0);

  // Configurar credenciais fictícias de teste no Vault em memória
  vault.setSecret("instagram_access_token", "fake-test-token-not-real");
  vault.setSecret("instagram_business_account_id", "999000111222");

  const editorial = new EditorialCalendarService(db);
  const pauta = editorial.createPost({
    titulo: "Post Teste Vinculado",
    formato: "carrossel",
    status: "agendado",
  });

  const fakeFetch = async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    }
    if (init?.method === "POST" && url.endsWith("/media_publish")) {
      return new Response(JSON.stringify({ id: "media-9001" }), { status: 200 });
    }
    if (url.includes("/999000111222/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { name: "reach", total_value: { value: 3200 } },
            { name: "views", total_value: { value: 5400 } },
            { name: "profile_views", total_value: { value: 180 } },
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
              id: "media-9001",
              caption: "Carrossel estratégico de teste [NOME_DA_MARCA]",
              media_type: "CAROUSEL_ALBUM",
              media_product_type: "FEED",
              permalink: "https://instagram.example/p/fake1",
              timestamp: new Date().toISOString(),
              like_count: 140,
              comments_count: 18,
            },
            {
              id: "media-9002",
              caption: "Reels demonstrativo",
              media_type: "VIDEO",
              media_product_type: "REELS",
              permalink: "https://instagram.example/p/fake2",
              timestamp: new Date().toISOString(),
              like_count: 210,
              comments_count: 25,
            },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/media-9001/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { name: "reach", total_value: { value: 1000 } },
            { name: "views", total_value: { value: 1500 } },
            { name: "saved", total_value: { value: 80 } },
            { name: "shares", total_value: { value: 20 } },
            { name: "total_interactions", total_value: { value: 258 } },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/media-9002/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { name: "reach", total_value: { value: 2000 } },
            { name: "views", total_value: { value: 3900 } },
            { name: "saved", total_value: { value: 100 } },
            { name: "shares", total_value: { value: 40 } },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        id: "999000111222",
        username: "seu_perfil_teste",
        name: "[NOME_DA_MARCA]",
        followers_count: 1200,
        follows_count: 300,
        media_count: 42,
      }),
      { status: 200 }
    );
  };

  // Publicar via metaPublishTool deve marcar a pauta editorial como publicada automaticamente
  const pubResult = await metaPublishTool(
    {
      media_type: "IMAGE",
      media_urls: ["/api/arquivos/raw?path=saidas/arte.png"],
      caption: "Legenda aprovada",
      approved_by_human: true,
      editorial_post_id: pauta.id,
    },
    { vault, db, fetchImpl: fakeFetch as never }
  );
  assert.equal(pubResult.published, true);
  assert.equal(pubResult.media_id, "media-9001");
  const pautaAtualizada = editorial.getPost(pauta.id);
  assert.equal(pautaAtualizada?.status, "publicado");
  assert.equal(pautaAtualizada?.meta_media_id, "media-9001");

  // Galeria online popula SQLite cache e agrega KPIs
  const galleryService = new MetaGalleryService({
    db,
    vault,
    fetchImpl: fakeFetch as never,
  });
  const live = await galleryService.getGallery({ periodo: "30d", refresh: true });
  assert.equal(live.ok, true);
  assert.equal(live.from_cache, false);
  assert.equal(live.posts.length, 2);
  assert.equal(live.summary.alcance_total, 3000);
  assert.equal(live.summary.salvamentos_total, 180);
  assert.equal(live.summary.melhor_taxa_salvamento_pct, 8);
  assert.equal(live.posts[0].editorial_post_id, pauta.id);

  // Leitura subsequente sem refresh deve servir diretamente do cache local
  const fromCache = await galleryService.getGallery({ periodo: "30d", refresh: false });
  assert.equal(fromCache.ok, true);
  assert.equal(fromCache.from_cache, true);
  assert.equal(fromCache.posts.length, 2);
});
