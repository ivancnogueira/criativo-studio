import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import type { FetchLike } from "../src/engine/providers/provider-interface.ts";
import { metaPublishTool } from "../src/engine/tools/meta-publish.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { MetaFirstCommentService } from "../src/social/meta-first-comment-service.ts";
import { VaultService } from "../src/vault/vault-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

test("Caso 1: metaPublishTool com first_comment e first_comment_approved=false publica midia sem disparar POST /comments", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-fc");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  const calls: string[] = [];
  const mockFetch: FetchLike = async (url) => {
    calls.push(url);
    if (url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "container-fc-1" }), { status: 200 });
    }
    if (url.endsWith("/media_publish")) {
      return new Response(JSON.stringify({ id: "media-fc-9001" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  const result = await metaPublishTool(
    {
      media_type: "IMAGE",
      media_urls: ["/api/arquivos/raw?path=saidas/post.png"],
      caption: "Post principal [NOME_DA_MARCA]",
      approved_by_human: true,
      first_comment: "Acesse [@SEU_PERFIL] #marketing",
      first_comment_approved: false,
      first_comment_delay_seconds: 0,
    },
    { vault, db, fetchImpl: mockFetch }
  );

  assert.equal(result.published, true);
  assert.equal(result.media_id, "media-fc-9001");
  assert.equal(result.first_comment_status, "pending_approval");
  assert.ok(result.first_comment_job_id);
  assert.equal(calls.some((u) => u.includes("/comments")), false);

  const row = db.connection
    .prepare("SELECT status, approved_by_human FROM meta_first_comments_queue WHERE comment_job_id = ?;")
    .get(result.first_comment_job_id) as { status: string; approved_by_human: number } | undefined;
  assert.equal(row?.status, "pending_approval");
  assert.equal(row?.approved_by_human, 0);
  db.close();
});

test("Caso 2: dispatchDueComments ignora jobs sem approved_by_human=1 mesmo com scheduled_for vencido", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-fc");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  let fetchCalled = false;
  const mockFetch: FetchLike = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ id: "comment-unexpected" }), { status: 200 });
  };

  const service = new MetaFirstCommentService({ db, vault, fetchImpl: mockFetch });
  const job = service.enqueueFirstComment({
    mediaId: "media-fc-9002",
    commentText: "Comentário sem aprovação humana",
    approvedByHuman: false,
    delaySeconds: 0,
  });

  // Mesmo forçando scheduled_for no passado, sem approved_by_human=1 não pode disparar
  db.connection
    .prepare("UPDATE meta_first_comments_queue SET scheduled_for = '2020-01-01T00:00:00.000Z' WHERE comment_job_id = ?;")
    .run(job.comment_job_id);

  const stats = await service.dispatchDueComments("2099-01-01T00:00:00.000Z");
  assert.equal(stats.processed, 0);
  assert.equal(fetchCalled, false);
  assert.equal(service.getCommentJob(job.comment_job_id)?.status, "pending_approval");
  db.close();
});

test("Caso 3: approveFirstComment(jobId, 0) agenda e dispatchDueComments envia POST /comments e grava auditoria", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-fc");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  let capturedCommentBody: Record<string, unknown> | null = null;
  const mockFetch: FetchLike = async (url, init) => {
    if (url.endsWith("/media-fc-9003/comments") && init?.method === "POST") {
      capturedCommentBody = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "ig-comment-777" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  const service = new MetaFirstCommentService({ db, vault, fetchImpl: mockFetch });
  const draft = service.enqueueFirstComment({
    mediaId: "media-fc-9003",
    commentText: "Hashtags de [NOME_DA_MARCA] #dicas",
    approvedByHuman: false,
    delaySeconds: 60,
  });
  assert.equal(draft.status, "pending_approval");

  const approved = service.approveFirstComment(draft.comment_job_id, 0);
  assert.equal(approved.status, "scheduled");
  assert.equal(approved.approved_by_human, true);
  assert.equal(approved.delay_seconds, 0);

  const stats = await service.dispatchDueComments(new Date(Date.now() + 1000).toISOString());
  assert.equal(stats.processed, 1);
  assert.equal(stats.posted, 1);
  assert.equal(stats.failed, 0);
  assert.equal((capturedCommentBody as Record<string, unknown> | null)?.message, "Hashtags de [NOME_DA_MARCA] #dicas");

  const posted = service.getCommentJob(draft.comment_job_id);
  assert.equal(posted?.status, "posted");
  assert.equal(posted?.meta_comment_id, "ig-comment-777");
  assert.ok(posted?.posted_em);

  const auditRow = db.connection
    .prepare("SELECT action, outcome, confirmed_by_human FROM meta_media_audit_logs WHERE media_id = ? LIMIT 1;")
    .get("media-fc-9003") as { action: string; outcome: string; confirmed_by_human: number } | undefined;
  assert.equal(auditRow?.action, "first_comment");
  assert.equal(auditRow?.outcome, "success");
  assert.equal(auditRow?.confirmed_by_human, 1);
  db.close();
});

test("Caso 4: erro HTTP 500 faz retry ate 3 tentativas e marca failed com token redigido", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-fc");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  const mockFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Erro temporario Graph API com token fake-test-token-phase44 e access_token=fake-test-token-phase44",
          code: 2,
        },
      }),
      { status: 500 }
    );

  const service = new MetaFirstCommentService({ db, vault, fetchImpl: mockFetch });
  const job = service.enqueueFirstComment({
    mediaId: "media-fc-9004",
    commentText: "Comentário com falha transitória",
    approvedByHuman: true,
    delaySeconds: 0,
  });

  // Tentativa 1: reagenda (attempts = 1, status = scheduled)
  await service.dispatchDueComments(new Date(Date.now() + 1000).toISOString());
  let current = service.getCommentJob(job.comment_job_id)!;
  assert.equal(current.status, "scheduled");
  assert.equal(current.attempts, 1);
  assert.equal((current.last_error ?? "").includes("fake-test-token-phase44"), false);

  // Tentativa 2: reagenda (attempts = 2, status = scheduled)
  await service.dispatchDueComments(new Date(Date.now() + 120_000).toISOString());
  current = service.getCommentJob(job.comment_job_id)!;
  assert.equal(current.status, "scheduled");
  assert.equal(current.attempts, 2);

  // Tentativa 3: falha definitiva (attempts = 3, status = failed)
  await service.dispatchDueComments(new Date(Date.now() + 240_000).toISOString());
  current = service.getCommentJob(job.comment_job_id)!;
  assert.equal(current.status, "failed");
  assert.equal(current.attempts, 3);
  assert.equal((current.last_error ?? "").includes("fake-test-token-phase44"), false);
  db.close();
});

test("Caso 5: cancelFirstComment altera status para cancelled e impede disparo futuro", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44-fc");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  let fetchCalled = false;
  const mockFetch: FetchLike = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ id: "never" }), { status: 200 });
  };

  const service = new MetaFirstCommentService({ db, vault, fetchImpl: mockFetch });
  const job = service.enqueueFirstComment({
    mediaId: "media-fc-9005",
    commentText: "Será cancelado",
    approvedByHuman: true,
    delaySeconds: 0,
  });

  const cancelled = service.cancelFirstComment(job.comment_job_id);
  assert.equal(cancelled.status, "cancelled");

  const stats = await service.dispatchDueComments(new Date(Date.now() + 60_000).toISOString());
  assert.equal(stats.processed, 0);
  assert.equal(fetchCalled, false);
  db.close();
});

test("Caso 6: rotas HTTP /api/instagram/primeiro-comentario (POST, GET, aprovar, cancelar)", async () => {
  const prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  const tempDir = mkdtempSync(join(tmpdir(), "criativo-phase44-fc-"));
  let runtime: DaemonRuntime | null = null;

  const mockFetch: FetchLike = async (url, init) => {
    if (url.endsWith("/media-http-1/comments") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "ig-comment-http-1" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  try {
    runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "phase44-fc.db"),
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

    const createRes = await fetch(`${baseUrl}/api/instagram/primeiro-comentario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_id: "media-http-1",
        comment_text: "Link na bio [@SEU_PERFIL]",
        approved_by_human: false,
        delay_seconds: 30,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as { ok: boolean; job: { comment_job_id: string; status: string } };
    assert.equal(createdJson.ok, true);
    assert.equal(createdJson.job.status, "pending_approval");

    const listRes = await fetch(`${baseUrl}/api/instagram/primeiro-comentario?media_id=media-http-1`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { ok: boolean; jobs: Array<{ comment_job_id: string }> };
    assert.equal(listJson.ok, true);
    assert.equal(listJson.jobs.length, 1);

    const approveRes = await fetch(
      `${baseUrl}/api/instagram/primeiro-comentario/${createdJson.job.comment_job_id}/aprovar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delay_seconds: 0 }),
      }
    );
    assert.equal(approveRes.status, 200);
    const approveJson = (await approveRes.json()) as {
      ok: boolean;
      job: { status: string; meta_comment_id: string | null };
    };
    assert.equal(approveJson.ok, true);
    assert.equal(approveJson.job.status, "posted");
    assert.equal(approveJson.job.meta_comment_id, "ig-comment-http-1");

    const cancelDraftRes = await fetch(`${baseUrl}/api/instagram/primeiro-comentario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_id: "media-http-2",
        comment_text: "Rascunho cancelável",
        approved_by_human: false,
      }),
    });
    const cancelDraftJson = (await cancelDraftRes.json()) as { job: { comment_job_id: string } };
    const cancelRes = await fetch(
      `${baseUrl}/api/instagram/primeiro-comentario/${cancelDraftJson.job.comment_job_id}/cancelar`,
      { method: "POST" }
    );
    assert.equal(cancelRes.status, 200);
    const cancelJson = (await cancelRes.json()) as { ok: boolean; job: { status: string } };
    assert.equal(cancelJson.ok, true);
    assert.equal(cancelJson.job.status, "cancelled");
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
