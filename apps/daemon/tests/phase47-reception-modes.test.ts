import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { MetaCommentDmClient } from "../src/social/meta-comment-dm-client.ts";
import { MetaCommentDmEngine } from "../src/social/meta-comment-dm-engine.ts";
import { MetaCommentDmService } from "../src/social/meta-comment-dm-service.ts";
import { MetaCommentPollingWorker } from "../src/social/meta-comment-polling-worker.ts";
import { MetaRelayClient, verifyMetaWebhookHmac } from "../src/social/meta-relay-client.ts";
import { tryHandleSocialCommentDmRoutes } from "../src/server/social-comment-dm-routes.ts";

function setup() {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  const vault = new VaultService(db, "chave-teste-modos-47");
  vault.setSecret("IG_ACCESS_TOKEN", "ig-tok-123");
  vault.setSecret("IG_USER_ID", "17841400001");
  vault.setSecret("IG_APP_SECRET", "app-secret-47");
  vault.setSecret("IG_WEBHOOK_VERIFY_TOKEN", "verify-47");
  return { db, vault };
}

test("DM47-03 Polling Worker: recupera comentarios dentro da janela 7d e avanca cursor sem duplicar", async () => {
  const { db, vault } = setup();
  const sent: Array<Record<string, unknown>> = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();

  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    if (url.includes("/comments")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "c-old", text: "quero", timestamp: tenDaysAgo, from: { id: "u1", username: "a" } },
            { id: "c-3d", text: "quero guia", timestamp: threeDaysAgo, from: { id: "u2", username: "b" } },
          ],
        }),
        { status: 200 }
      );
    }
    sent.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
    return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 });
  };

  const client = new MetaCommentDmClient({ vault, fetchImpl: fetchImpl as never });
  const engine = new MetaCommentDmEngine({ db, client });
  const service = new MetaCommentDmService({ db, engine });
  service.createRule({
    conta_id: "principal",
    nome: "Polling",
    ativo: true,
    match_mode: "contains",
    keywords: ["quero"],
    post_scope: "specific_posts",
    target_media_ids: ["med-1"],
    opening_message: { text: "Oi!", button_label: "Pegar" },
  });

  const worker = new MetaCommentPollingWorker({
    db,
    vault,
    engine,
    service,
    fetchImpl: fetchImpl as never,
  });

  const r1 = await worker.scanOnce("principal");
  assert.equal(r1.recovered, 1);
  assert.equal(sent.length, 1);

  const r2 = await worker.scanOnce("principal");
  assert.equal(r2.recovered, 0);
  assert.equal(sent.length, 1);

  db.close();
});

test("DM47-03 Webhook Direto e Relay Client validam HMAC-SHA256 e hub.challenge", async () => {
  const { db, vault } = setup();
  const payloadStr = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "17841400001",
        changes: [
          {
            field: "comments",
            value: {
              id: "cmt-wh-1",
              text: "quero agora",
              from: { id: "u99", username: "seguidor_teste" },
              media: { id: "med-9" },
            },
          },
        ],
      },
    ],
  });
  const goodSig = `sha256=${createHmac("sha256", "app-secret-47").update(payloadStr, "utf8").digest("hex")}`;
  assert.equal(verifyMetaWebhookHmac(payloadStr, goodSig, "app-secret-47"), true);
  assert.equal(verifyMetaWebhookHmac(payloadStr, "sha256=invalida", "app-secret-47"), false);

  const dmCalls: unknown[] = [];
  const client = new MetaCommentDmClient({
    vault,
    fetchImpl: (async (_u: string, init?: { body?: string }) => {
      dmCalls.push(init?.body);
      return new Response(JSON.stringify({ message_id: "dm-ok" }), { status: 200 });
    }) as never,
  });
  const engine = new MetaCommentDmEngine({ db, client });
  const service = new MetaCommentDmService({ db, engine });
  service.createRule({
    conta_id: "principal",
    nome: "Webhook/Relay",
    ativo: true,
    match_mode: "contains",
    keywords: ["quero"],
    post_scope: "all_posts",
    opening_message: { text: "Receba aqui:", button_label: "Abrir" },
  });

  // 1. Testar hub.challenge GET
  let getStatus = 0;
  let getBody = "";
  await tryHandleSocialCommentDmRoutes({
    req: { headers: {} } as never,
    res: {
      setHeader() {},
      end(txt: string) {
        getBody = txt;
      },
      set statusCode(code: number) {
        getStatus = code;
      },
    } as never,
    path: "/api/instagram/webhook",
    method: "GET",
    url: new URL("http://127.0.0.1:3000/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify-47&hub.challenge=CHAL99"),
    db,
    wsHub: { broadcast() {} } as never,
    workspaceRoot: process.cwd(),
    deps: { vault, sendJson() {}, readJsonBody: async () => ({}) } as never,
  });
  assert.equal(getStatus, 200);
  assert.equal(getBody, "CHAL99");

  // 2. Testar POST Webhook com assinatura invalida -> 401
  let postStatus = 0;
  await tryHandleSocialCommentDmRoutes({
    req: { headers: { "x-hub-signature-256": "sha256=errado" } } as never,
    res: {} as never,
    path: "/api/instagram/webhook",
    method: "POST",
    url: new URL("http://127.0.0.1:3000/api/instagram/webhook"),
    db,
    wsHub: { broadcast() {} } as never,
    workspaceRoot: process.cwd(),
    deps: {
      vault,
      sendJson(_r: unknown, code: number) {
        postStatus = code;
      },
      readRawBody: async () => Buffer.from(payloadStr, "utf8"),
      readJsonBody: async () => ({}),
    } as never,
  });
  assert.equal(postStatus, 401);

  // 3. Testar MetaRelayClient validando HMAC local e enviando ACK
  vault.setSecret("META_RELAY_BASE_URL", "https://painel.exemplo.invalid");
  vault.setSecret("META_RELAY_CHANNEL_ID", "mrelay_01");
  vault.setSecret("META_RELAY_CHANNEL_SECRET", "rsec_01");
  service.saveConnectionConfig({
    conta_id: "principal",
    reception_mode: "painel_relay",
    relay_channel_id: "mrelay_01",
    relay_enabled: true,
  });

  let ackedIds: string[] = [];
  const relay = new MetaRelayClient({
    vault,
    engine,
    service,
    fetchImpl: (async (url: string, init?: { body?: string }) => {
      if (url.includes("/pull")) {
        return new Response(
          JSON.stringify({
            items: [
              { id: "ev-bad", raw_body: payloadStr, signature_header: "sha256=bad" },
              { id: "ev-good", raw_body: payloadStr, signature_header: goodSig },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/ack")) {
        ackedIds = (JSON.parse(init?.body ?? "{}") as { ids: string[] }).ids;
        return new Response(JSON.stringify({ ok: true, deleted: ackedIds.length }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as never,
  });

  const relayRes = await relay.pullOnce("principal");
  assert.equal(relayRes.accepted, 1);
  assert.equal(relayRes.rejected, 1);
  assert.deepEqual(ackedIds, ["ev-bad", "ev-good"]);
  assert.equal(dmCalls.length, 1);

  db.close();
});
