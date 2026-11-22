import assert from "node:assert/strict";
import test from "node:test";
import { IdleWaitCoordinator } from "../src/updater/idle-wait-coordinator.ts";

test("IdleWaitCoordinator: retorna imediato quando ocioso", async () => {
  const coordinator = new IdleWaitCoordinator(() => ({ busy: false }));
  const res = await coordinator.waitUntilIdle({ timeoutMs: 1000, pollMs: 25 });
  assert.equal(res.proceeded, true);
  assert.equal(res.timedOut, false);
  assert.equal(res.forced, false);
});

test("IdleWaitCoordinator: aguarda trabalho ativo concluir antes de liberar restart", async () => {
  let checks = 0;
  let waitingCalled = 0;
  const coordinator = new IdleWaitCoordinator(() => {
    checks += 1;
    if (checks < 3) {
      return { busy: true, reason: "Renderização Remotion em curso" };
    }
    return { busy: false };
  });

  const res = await coordinator.waitUntilIdle({
    timeoutMs: 2000,
    pollMs: 25,
    onWaiting: () => {
      waitingCalled += 1;
    },
  });

  assert.equal(res.proceeded, true);
  assert.equal(waitingCalled, 1);
  assert.ok(checks >= 3);
});

test("IdleWaitCoordinator: respeita timeout seguro e modo forceApply", async () => {
  const alwaysBusy = new IdleWaitCoordinator(() => ({ busy: true, reason: "Turno contínuo" }));
  const timedOut = await alwaysBusy.waitUntilIdle({ timeoutMs: 120, pollMs: 25 });
  assert.equal(timedOut.proceeded, false);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.lastReason, "Turno contínuo");

  const forced = await alwaysBusy.waitUntilIdle({ force: true });
  assert.equal(forced.proceeded, true);
  assert.equal(forced.forced, true);
});
