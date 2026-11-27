import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import type { FetchLike } from "../src/engine/providers/provider-interface.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { EditorialCalendarService } from "../src/social/editorial-calendar-service.ts";
import { MetaFirstCommentService } from "../src/social/meta-first-comment-service.ts";
import { MetaMediaDeletionService } from "../src/social/meta-media-deletion-service.ts";
import { VaultService } from "../src/vault/vault-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

test("Caso 1: deletePublishedMedia bloqueia sem dupla confirmacao, nao chama fetchImpl e audita blocked", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-del");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  let fetchCalled = false;
  const mockFetch: FetchLike = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  const service = new MetaMediaDeletionService({ db, vault, fetchImpl: mockFetch });

  await assert.rejects(
    () =>
      service.deletePublishedMedia({
        mediaId: "media-del-1",
        approvedByHuman: false,
        confirmText: "EXCLUIR",
      }),
    /BLOQUEIO DE SEGURANÇA/
  );

  await assert.rejects(
    () =>
      service.deletePublishedMedia({
        mediaId: "media-del-1",
        approvedByHuman: true,
        confirmText: "texto-errado",
      }),
    /BLOQUEIO DE SEGURANÇA/
  );

  assert.equal(fetchCalled, false);
  const logs = service.listAuditLogs({ mediaId: "media-del-1" });
  assert.equal(logs.length, 2);
  assert.equal(logs[0].outcome, "blocked");
  assert.equal(logs[0].confirmed_by_human, false);
  db.close();
});

test("Caso 2: deletePublishedMedia confirmado limpa cache, desvincula calendario, cancela comentarios e grava deleted_remote + eventos_orquestracao", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-del");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  const mediaId = "media-del-2";
  db.connection
    .prepare(
      "INSERT INTO meta_posts_cache (media_id, conta_id, payload_json, sincronizado_em) VALUES (?, '999000111222', '{}', ?);"
    )
    .run(mediaId, new Date().toISOString());

  const calendar = new EditorialCalendarService(db);
  const post = calendar.createPost({
    titulo: "Post para exclusão [NOME_DA_MARCA]",
    formato: "feed_4_5",
    status: "publicado",
    meta_media_id: mediaId,
  });

  const commentService = new MetaFirstCommentService({ db, vault });
  const pendingComment = commentService.enqueueFirstComment({
    mediaId,
    commentText: "Comentário pendente de [@SEU_PERFIL]",
    approvedByHuman: false,
  });

  let calledMethod = "";
  const mockFetch: FetchLike = async (url, init) => {
    calledMethod = init?.method ?? "GET";
    assert.ok(url.includes(`/${mediaId}?access_token=`));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  const service = new MetaMediaDeletionService({ db, vault, fetchImpl: mockFetch });
  const result = await service.deletePublishedMedia({
    mediaId,
    approvedByHuman: true,
    confirmText: "EXCLUIR",
    actorLabel: "operador_teste",
    reason: "Teste de exclusão remota",
  });

  assert.equal(calledMethod, "DELETE");
  assert.equal(result.ok, true);
  assert.equal(result.deleted_remote, true);
  assert.equal(result.removed_local_cache, true);

  const cacheCount = db.connection
    .prepare("SELECT COUNT(*) AS total FROM meta_posts_cache WHERE media_id = ?;")
    .get(mediaId) as { total: number };
  assert.equal(cacheCount.total, 0);

  const refreshedPost = calendar.getPost(post.id);
  assert.equal(refreshedPost?.meta_media_id, null);

  const refreshedComment = commentService.getCommentJob(pendingComment.comment_job_id);
  assert.equal(refreshedComment?.status, "cancelled");

  const logs = service.listAuditLogs({ mediaId });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].outcome, "deleted_remote");
  assert.equal(logs[0].confirmed_by_human, true);

  const evtRow = db.connection
    .prepare(
      "SELECT tipo_agregado, agregado_id, tipo_evento FROM eventos_orquestracao WHERE agregado_id = ? LIMIT 1;"
    )
    .get(mediaId) as { tipo_agregado: string; agregado_id: string; tipo_evento: string } | undefined;
  assert.equal(evtRow?.tipo_agregado, "meta_media");
  assert.equal(evtRow?.agregado_id, mediaId);
  assert.equal(evtRow?.tipo_evento, "meta.media_audit");
  db.close();
});

test("Caso 3 e 4: erro 2207085 retorna META_DELETE_UNSUPPORTED e prova zero vazamento de token na auditoria", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-del");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  const mediaId = "media-del-2207085";
  db.connection
    .prepare(
      "INSERT INTO meta_posts_cache (media_id, conta_id, payload_json, sincronizado_em) VALUES (?, '999000111222', '{}', ?);"
    )
    .run(mediaId, new Date().toISOString());

  const mockFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 100,
          error_subcode: 2207085,
          message:
            "Unsupported delete request for access_token=fake-test-token-phase44 token fake-test-token-phase44",
        },
      }),
      { status: 400 }
    );

  const service = new MetaMediaDeletionService({ db, vault, fetchImpl: mockFetch });
  const res = await service.deletePublishedMedia({
    mediaId,
    approvedByHuman: true,
    confirmText: mediaId,
    removeFromLocalCacheOnUnsupported: true,
  });

  assert.equal(res.ok, false);
  assert.equal(res.deleted_remote, false);
  assert.equal(res.removed_local_cache, true);
  assert.equal(res.limitation_code, "META_DELETE_UNSUPPORTED");

  const auditRows = db.connection
    .prepare("SELECT outcome, reason, detail_json FROM meta_media_audit_logs WHERE media_id = ?;")
    .all(mediaId) as Array<{ outcome: string; reason: string; detail_json: string }>;
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].outcome, "unsupported_by_meta_api");
  assert.equal(auditRows[0].reason.includes("fake-test-token-phase44"), false);
  assert.equal(auditRows[0].detail_json.includes("fake-test-token-phase44"), false);

  const eventRows = db.connection
    .prepare("SELECT payload_json FROM eventos_orquestracao WHERE agregado_id = ?;")
    .all(mediaId) as Array<{ payload_json: string }>;
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0].payload_json.includes("fake-test-token-phase44"), false);
  db.close();
});

test("Caso 5: rotas HTTP POST /api/instagram/midia/:mediaId/excluir (403/200) e GET /api/instagram/auditoria", async () => {
  const prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  const tempDir = mkdtempSync(join(tmpdir(), "criativo-phase44-del-"));
  let runtime: DaemonRuntime | null = null;

  const mockFetch: FetchLike = async (_url, init) => {
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  try {
    runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "phase44-del.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
      fetchImpl: mockFetch,
    });
    runtime.vault.setSecret("instagram_access_token", "fake-test-token-phase44");
    runtime.vault.setSecret("instagram_business_account_id", "999000111222");

    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    const blockedRes = await fetch(`${baseUrl}/api/instagram/midia/media-http-del/excluir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved_by_human: false, confirm_text: "EXCLUIR" }),
    });
    assert.equal(blockedRes.status, 403);

    const okRes = await fetch(`${baseUrl}/api/instagram/midia/media-http-del/excluir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved_by_human: true, confirm_text: "EXCLUIR" }),
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as { ok: boolean; deleted_remote: boolean };
    assert.equal(okJson.ok, true);
    assert.equal(okJson.deleted_remote, true);

    const auditRes = await fetch(`${baseUrl}/api/instagram/auditoria?media_id=media-http-del`);
    assert.equal(auditRes.status, 200);
    const auditJson = (await auditRes.json()) as {
      ok: boolean;
      logs: Array<{ outcome: string }>;
    };
    assert.equal(auditJson.ok, true);
    assert.equal(auditJson.logs.length, 2);
  } finally {
    if (runtime) {
      await runtime.close();
    }
    if (prevSkipProbe === undefined) {
      delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    } else {
      process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
