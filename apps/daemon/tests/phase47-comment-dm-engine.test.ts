import assert from "node:assert/strict";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { MetaCommentDmClient } from "../src/social/meta-comment-dm-client.ts";
import {
  currentHourBucketUtc,
  HOURLY_DM_RATE_LIMIT,
  MetaCommentDmEngine,
} from "../src/social/meta-comment-dm-engine.ts";
import { MetaCommentDmService } from "../src/social/meta-comment-dm-service.ts";

function createTestEnv(loginMode: "instagram" | "facebook" = "instagram") {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  const vault = new VaultService(db, "chave-mestra-teste-fase47");
  vault.setSecret("IG_ACCESS_TOKEN", "ig-token-teste-000");
  vault.setSecret("IG_USER_ID", "178414000000001");
  vault.setSecret("IG_LOGIN_MODE", loginMode);
  if (loginMode === "facebook") {
    vault.setSecret("IG_PAGE_ID", "998877665544");
  }

  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string, init?: { body?: string }) => {
    const parsed = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url, body: parsed });
    return new Response(JSON.stringify({ message_id: `mid_${calls.length}`, id: `rep_${calls.length}` }), {
      status: 200,
    });
  };

  const client = new MetaCommentDmClient({ vault, fetchImpl: fetchImpl as never });
  const engine = new MetaCommentDmEngine({ db, client });
  const service = new MetaCommentDmService({ db, engine });
  return { db, vault, client, engine, service, calls };
}

test("DM47-02: Dual-Endpoint roteia Instagram Login (/me/messages) e Facebook Page (/{pageId}/messages)", async () => {
  const igEnv = createTestEnv("instagram");
  const r1 = await igEnv.client.sendPrivateReply({
    contaId: "principal",
    commentId: "cmt-1",
    payload: { text: "Oi!", metadataTag: "criativo_dm:s1:open" },
  });
  assert.equal(r1.ok, true);
  assert.match(igEnv.calls[0]!.url, /^https:\/\/graph\.instagram\.com\/v\d+\.\d+\/me\/messages$/);

  const fbEnv = createTestEnv("facebook");
  const r2 = await fbEnv.client.sendPrivateReply({
    contaId: "principal",
    commentId: "cmt-2",
    payload: { text: "Oi FB!", metadataTag: "criativo_dm:s2:open" },
  });
  assert.equal(r2.ok, true);
  assert.match(fbEnv.calls[0]!.url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/998877665544\/messages$/);
  igEnv.db.close();
  fbEnv.db.close();
});

test("DM47-02: Idempotencia, isCommentReply, Live guard e fluxo 7d->24h com Dry-Run", async () => {
  const { db, engine, service, calls } = createTestEnv("instagram");

  const rule = service.createRule({
    conta_id: "principal",
    nome: "Regra Guia Grátis",
    ativo: true,
    match_mode: "contains",
    keywords: ["quero"],
    negative_keywords: ["reclamacao"],
    post_scope: "specific_posts",
    target_media_ids: ["media-100"],
    include_comment_replies: false,
    allow_live_comments: true,
    reply_once_per_user_per_post: true,
    public_replies: ["Te mandei no Direct!"],
    opening_message: {
      text: "Clique abaixo para liberar seu acesso:",
      button_label: "Quero agora",
      next_node_id: "node-ask-email",
    },
    flow_nodes: [
      {
        node_id: "node-ask-email",
        type: "collect_input",
        input_kind: "email",
        prompt_text: "Qual seu melhor e-mail?",
        next_node_id: "node-send-msg",
      },
      {
        node_id: "node-send-msg",
        type: "send_message",
        messages: ["Acesso enviado com sucesso!"],
      },
    ],
  });

  // Resposta a comentario ignorada quando include_comment_replies = false
  const replyIgnored = await engine.handleIncomingComment({
    contaId: "principal",
    commentId: "cmt-reply-1",
    mediaId: "media-100",
    parentId: "cmt-raiz-0",
    senderIgId: "user-1",
    text: "Eu quero!",
    timestamp: new Date().toISOString(),
    sourceMode: "direct_webhook",
  });
  assert.equal(replyIgnored.outcome, "skipped");
  assert.equal(replyIgnored.reason, "comment_reply_ignored");

  // Live comment dispara Private Reply mas NAO envia resposta publica
  const liveRes = await engine.handleIncomingComment({
    contaId: "principal",
    commentId: "cmt-live-1",
    mediaId: "media-100",
    senderIgId: "user-live",
    text: "QUERO muito",
    timestamp: new Date().toISOString(),
    isLive: true,
    sourceMode: "direct_webhook",
  });
  assert.equal(liveRes.outcome, "sent");
  assert.equal(calls.length, 1, "Live comment nao deve chamar /replies publico");

  // Mesmo comment_id duplicado e ignorado atomicamente
  const dupRes = await engine.handleIncomingComment({
    contaId: "principal",
    commentId: "cmt-live-1",
    mediaId: "media-100",
    senderIgId: "user-live",
    text: "QUERO muito",
    timestamp: new Date().toISOString(),
    sourceMode: "polling",
  });
  assert.equal(dupRes.reason, "duplicate_comment_id");

  // Clique postback abre janela 24h e pede email (collect_input)
  const clickRes = await engine.handleIncomingDmInteraction({
    contaId: "principal",
    senderIgId: "user-live",
    postbackPayload: `dm_open:${liveRes.sessionId}`,
    timestamp: new Date().toISOString(),
  });
  assert.equal(clickRes.outcome, "waiting_input");
  assert.equal(calls[calls.length - 1]!.body.message && (calls[calls.length - 1]!.body.message as { text: string }).text, "Qual seu melhor e-mail?");

  // Mensagem com email valido avanca para node-send-msg
  const emailRes = await engine.handleIncomingDmInteraction({
    contaId: "principal",
    senderIgId: "user-live",
    text: "cliente@exemplo.invalid",
    timestamp: new Date().toISOString(),
  });
  assert.equal(emailRes.outcome, "flow_completed");

  // Echo com metadata proprio e descartado sem loop
  const echoRes = await engine.handleIncomingDmInteraction({
    contaId: "principal",
    senderIgId: "user-live",
    text: "Acesso enviado com sucesso!",
    isEcho: true,
    metadata: `criativo_dm:${liveRes.sessionId}:step`,
    timestamp: new Date().toISOString(),
  });
  assert.equal(echoRes.outcome, "ignored_echo");

  // Dry-run nao faz chamadas HTTP
  const callsBeforeDry = calls.length;
  const dry = service.simulateDryRun({
    rule_id: rule.rule_id,
    comment_text: "Eu quero!",
    media_id: "media-100",
    simulated_button_clicks: ["open"],
  });
  assert.equal(dry.matched, true);
  assert.equal(calls.length, callsBeforeDry);
  assert.ok(dry.trace.some((t) => t.window_required === "24h_dm_open" && t.window_open));

  db.close();
});

test("DM47-02: Rate-limiter 200 req/h e Modo Aprovacao Humana protegem envios", async () => {
  const { db, engine, service, calls } = createTestEnv("instagram");

  service.createRule({
    conta_id: "principal",
    nome: "Regra Moderada",
    ativo: true,
    match_mode: "any",
    post_scope: "all_posts",
    require_human_approval: true,
    public_replies: ["Confirmado!"],
    opening_message: { text: "Olá!", button_label: "Ver" },
  });

  const pending = await engine.handleIncomingComment({
    contaId: "principal",
    commentId: "cmt-apr-1",
    mediaId: "media-1",
    senderIgId: "user-apr",
    text: "Oi",
    timestamp: new Date().toISOString(),
    sourceMode: "direct_webhook",
  });
  assert.equal(pending.outcome, "pending_approval");
  assert.equal(calls.length, 0);

  const list = service.listApprovals("pending");
  assert.equal(list.length, 1);

  // Preenche cota até 200/h e confirma adiamento antes de aprovar
  db.connection
    .prepare(
      `INSERT INTO meta_comment_rate_buckets (conta_id, hour_bucket_utc, request_count, atualizado_em)
       VALUES ('principal', ?, ?, ?)
       ON CONFLICT(conta_id, hour_bucket_utc) DO UPDATE SET request_count = excluded.request_count;`
    )
    .run(currentHourBucketUtc(), HOURLY_DM_RATE_LIMIT, new Date().toISOString());

  const deferred = await service.decideApproval({
    approvalId: list[0]!.approval_id,
    approved: true,
    decidedBy: "operador",
  });
  assert.equal(deferred.status, "deferred_rate_limit");
  assert.equal(calls.length, 0);

  db.close();
});
