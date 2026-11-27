import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import type { FetchLike } from "../src/engine/providers/provider-interface.ts";
import { metaPublishTool } from "../src/engine/tools/meta-publish.ts";
import { checkMetaTrialReelEligibility } from "../src/engine/tools/meta-trial-eligibility.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { EditorialCalendarService } from "../src/social/editorial-calendar-service.ts";
import { VaultService } from "../src/vault/vault-service.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

test("Schema Fase 44: cria tabelas meta_first_comments_queue e meta_media_audit_logs de forma idempotente", () => {
  const db = createTestDb();
  assert.equal(db.hasTable("meta_first_comments_queue"), true);
  assert.equal(db.hasTable("meta_media_audit_logs"), true);

  // Idempotência ao reinicializar
  db.initializeDatabase();
  assert.equal(db.hasTable("meta_first_comments_queue"), true);
  assert.equal(db.hasTable("meta_media_audit_logs"), true);
  db.close();
});

test("metaPublishTool com trial_reel=true rejeita media_type diferente de REELS com CRV-META-TRIAL-TYPE", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  let fetchCalled = false;
  const mockFetch: FetchLike = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  await assert.rejects(
    () =>
      metaPublishTool(
        {
          media_type: "IMAGE",
          media_urls: ["/api/arquivos/raw?path=saidas/arte.png"],
          caption: "Teste Trial inválido [NOME_DA_MARCA]",
          approved_by_human: true,
          trial_reel: true,
        },
        { vault, db, fetchImpl: mockFetch }
      ),
    /CRV-META-TRIAL-TYPE/
  );
  assert.equal(fetchCalled, false);
  db.close();
});

test("metaPublishTool com trial_reel=true bloqueia conta abaixo de 1.000 seguidores antes do POST /media", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  const calls: Array<{ url: string; method: string }> = [];
  const mockFetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return new Response(
      JSON.stringify({
        id: "999000111222",
        username: "@SEU_PERFIL",
        followers_count: 850,
        account_type: "BUSINESS",
      }),
      { status: 200 }
    );
  };

  await assert.rejects(
    () =>
      metaPublishTool(
        {
          media_type: "REELS",
          media_urls: ["https://cdn.exemplo.invalid/video-teste.mp4"],
          caption: "Reel teste para [@SEU_PERFIL]",
          approved_by_human: true,
          trial_reel: true,
        },
        { vault, db, fetchImpl: mockFetch }
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /CRV-META-TRIAL-ELIGIBILITY/);
      assert.match(err.message, /1\.000 seguidores/);
      assert.equal(err.message.includes("fake-test-token-phase44"), false);
      return true;
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  db.close();
});

test("metaPublishTool com trial_reel=true e >= 1.000 seguidores envia trial_params MANUAL no POST /media", async () => {
  const db = createTestDb();
  const vault = new VaultService(db, "chave-teste-fase44");
  vault.setSecret("instagram_access_token", "fake-test-token-phase44");
  vault.setSecret("instagram_business_account_id", "999000111222");

  let capturedMediaBody: Record<string, unknown> | null = null;
  const mockFetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("/999000111222")) {
      return new Response(
        JSON.stringify({
          id: "999000111222",
          username: "@SEU_PERFIL",
          followers_count: 1500,
          account_type: "CREATOR",
        }),
        { status: 200 }
      );
    }
    if (method === "POST" && url.endsWith("/media")) {
      capturedMediaBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "container-trial-1" }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/media_publish")) {
      return new Response(JSON.stringify({ id: "media-trial-9001" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  const result = await metaPublishTool(
    {
      media_type: "REELS",
      media_urls: ["https://cdn.exemplo.invalid/reel-trial.mp4"],
      caption: "Trial Reel [NOME_DA_MARCA]",
      approved_by_human: true,
      trial_reel: true,
      trial_graduation_strategy: "MANUAL",
    },
    { vault, db, fetchImpl: mockFetch }
  );

  assert.equal(result.published, true);
  assert.equal(result.media_id, "media-trial-9001");
  assert.equal(result.is_trial_reel, true);
  assert.equal(result.trial_graduation_strategy, "MANUAL");
  assert.equal(result.followers_count_checked, 1500);
  assert.ok(capturedMediaBody);
  assert.deepEqual(
    (capturedMediaBody as Record<string, unknown>).trial_params,
    { graduation_strategy: "MANUAL" }
  );
  db.close();
});

test("checkMetaTrialReelEligibility trata conta PERSONAL e erro API sem vazar token", async () => {
  const personalFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        id: "999000111222",
        username: "@SEU_PERFIL",
        followers_count: 4200,
        account_type: "PERSONAL",
      }),
      { status: 200 }
    );

  const personalRes = await checkMetaTrialReelEligibility({
    accessToken: "fake-test-token-phase44",
    igUserId: "999000111222",
    fetchImpl: personalFetch,
  });
  assert.equal(personalRes.eligible, false);
  assert.equal(personalRes.error_code, "CRV-META-TRIAL-ACCOUNT-TYPE");

  const errorFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Token inválido fake-test-token-phase44 em access_token=fake-test-token-phase44",
        },
      }),
      { status: 401 }
    );

  const errRes = await checkMetaTrialReelEligibility({
    accessToken: "fake-test-token-phase44",
    igUserId: "999000111222",
    fetchImpl: errorFetch,
  });
  assert.equal(errRes.ok, false);
  assert.equal(errRes.eligible, false);
  assert.equal(errRes.error_code, "CRV-META-API-ERROR");
  assert.equal(errRes.reason.includes("fake-test-token-phase44"), false);
});

test("EditorialCalendarService persiste e atualiza trial_reel_enabled e trial_graduation_strategy", () => {
  const db = createTestDb();
  const service = new EditorialCalendarService(db);

  const created = service.createPost({
    titulo: "Reel Trial [NOME_DA_MARCA]",
    formato: "reels",
    status: "rascunho",
    legenda: "Teste [@SEU_PERFIL]",
    trial_reel_enabled: true,
    trial_graduation_strategy: "MANUAL",
  });
  assert.equal(created.formato, "reels");
  assert.equal(created.trial_reel_enabled, true);
  assert.equal(created.trial_graduation_strategy, "MANUAL");

  const updated = service.updatePost(created.id, {
    trial_graduation_strategy: "SS_PERFORMANCE",
    primeiro_comentario: "Comente EU QUERO!",
    primeiro_comentario_delay_seg: 45,
  });
  assert.equal(updated.trial_reel_enabled, true);
  assert.equal(updated.trial_graduation_strategy, "SS_PERFORMANCE");
  assert.equal(updated.primeiro_comentario, "Comente EU QUERO!");
  assert.equal(updated.primeiro_comentario_delay_seg, 45);
  db.close();
});

test("Rota HTTP GET /api/instagram/elegibilidade-trial retorna CRV-META-001 sem credenciais e valida com fetchImpl", async () => {
  const prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  const tempDir = mkdtempSync(join(tmpdir(), "criativo-phase44-"));
  let runtime: DaemonRuntime | null = null;

  const mockFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        id: "999000111222",
        username: "@SEU_PERFIL",
        followers_count: 1840,
        account_type: "BUSINESS",
      }),
      { status: 200 }
    );

  try {
    runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "phase44-http.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
      fetchImpl: mockFetch,
    });

    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    // Sem credenciais: retorna CRV-META-001 amigável
    const resMissing = await fetch(`${baseUrl}/api/instagram/elegibilidade-trial`);
    assert.equal(resMissing.status, 200);
    const bodyMissing = (await resMissing.json()) as {
      ok: boolean;
      eligible: boolean;
      error_code?: string;
    };
    assert.equal(bodyMissing.ok, false);
    assert.equal(bodyMissing.eligible, false);
    assert.equal(bodyMissing.error_code, "CRV-META-001");

    // Com credenciais no Vault: usa fetchImpl injetada e retorna elegível
    runtime.vault.setSecret("instagram_access_token", "fake-test-token-phase44");
    runtime.vault.setSecret("instagram_business_account_id", "999000111222");

    const resOk = await fetch(`${baseUrl}/api/instagram/elegibilidade-trial`);
    assert.equal(resOk.status, 200);
    const bodyOk = (await resOk.json()) as {
      ok: boolean;
      eligible: boolean;
      followers_count: number | null;
      username: string | null;
    };
    assert.equal(bodyOk.ok, true);
    assert.equal(bodyOk.eligible, true);
    assert.equal(bodyOk.followers_count, 1840);
    assert.equal(bodyOk.username, "@SEU_PERFIL");
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
