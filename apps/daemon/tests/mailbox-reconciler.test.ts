import assert from "node:assert/strict";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { MailboxDeliveryGate } from "../src/waits/mailbox-delivery-gate.ts";
import { MailboxReconciler } from "../src/waits/mailbox-reconciler.ts";
import { MailboxStore } from "../src/waits/mailbox-store.ts";

function createTestDb(): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  return db;
}

test("MailboxStore e MailboxDeliveryGate: idempotência, ordem por prioridade e bloqueio quando agente está ocupado", async () => {
  const db = createTestDb();
  const store = new MailboxStore(db);

  const first = store.enqueue({
    agente_id: "designer_chefe",
    source_kind: "handoff",
    idempotency_key: "handoff:msg-1:designer_chefe",
    payload: { texto: "Primeira entrega" },
    priority: 4,
  });
  const duplicate = store.enqueue({
    agente_id: "designer_chefe",
    source_kind: "handoff",
    idempotency_key: "handoff:msg-1:designer_chefe",
    payload: { texto: "Duplicata ignorada" },
    priority: 1,
  });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.item.mailbox_id, first.item.mailbox_id);
  assert.equal(store.listByAgent("designer_chefe").length, 1);

  let busy = true;
  const deliveredPayloads: string[] = [];
  const gate = new MailboxDeliveryGate({
    store,
    isAgentBusy: () => busy,
    onDeliver: async (item) => {
      const parsed = JSON.parse(item.payload_json) as { texto: string };
      deliveredPayloads.push(parsed.texto);
    },
  });

  // Enquanto agente está ocupado, item fica em pending e não despacha
  const blocked = await gate.enqueueAndTryDeliver({
    agente_id: "designer_chefe",
    source_kind: "wakeup",
    idempotency_key: "wakeup:w-2",
    payload: { texto: "Segunda prioridade alta" },
    priority: 1,
  });
  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.item.status, "pending");
  assert.equal(deliveredPayloads.length, 0);

  // Quando agente fica livre, despacha primeiro a prioridade 1, depois prioridade 4
  busy = false;
  assert.equal(await gate.tryDispatchNext("designer_chefe"), true);
  assert.equal(await gate.tryDispatchNext("designer_chefe"), true);
  assert.deepEqual(deliveredPayloads, ["Segunda prioridade alta", "Primeira entrega"]);
  assert.equal(store.listByAgent("designer_chefe", "acked").length, 2);
});

test("MailboxReconciler: recupera leases expirados após crash para pending e move excesso de tentativas para dead_letter", () => {
  const db = createTestDb();
  const store = new MailboxStore(db);
  const reconciler = new MailboxReconciler(db);

  const recoverable = store.enqueue({
    agente_id: "copywriter",
    source_kind: "wait_event",
    idempotency_key: "wait:crash-1",
    payload: { ok: true },
    max_attempts: 3,
  }).item;

  const exhausted = store.enqueue({
    agente_id: "copywriter",
    source_kind: "webhook",
    idempotency_key: "webhook:crash-2",
    payload: { ok: false },
    max_attempts: 2,
  }).item;

  const pastIso = new Date(Date.now() - 120_000).toISOString();
  db.connection
    .prepare(
      "UPDATE projecao_agent_mailbox SET status = 'leased', attempt_count = 1, lease_owner = 'old-pid', lease_expires_at = ? WHERE mailbox_id = ?;"
    )
    .run(pastIso, recoverable.mailbox_id);
  db.connection
    .prepare(
      "UPDATE projecao_agent_mailbox SET status = 'leased', attempt_count = 2, lease_owner = 'old-pid', lease_expires_at = ? WHERE mailbox_id = ?;"
    )
    .run(pastIso, exhausted.mailbox_id);

  const report = reconciler.reconcileOnStartup();
  assert.equal(report.recovered, 1);
  assert.equal(report.deadLettered, 1);
  assert.equal(report.pendingByAgent.copywriter, 1);

  assert.equal(store.getById(recoverable.mailbox_id)?.status, "pending");
  assert.equal(store.getById(recoverable.mailbox_id)?.lease_owner, null);
  assert.equal(store.getById(exhausted.mailbox_id)?.status, "dead_letter");
});
