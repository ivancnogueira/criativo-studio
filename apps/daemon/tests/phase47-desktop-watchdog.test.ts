import assert from "node:assert/strict";
import test from "node:test";
import { createWatchdogRecoveryController } from "../../desktop/src/daemon-launcher.ts";

test("DM47-07: Watchdog suspende auto-restart apos limite mas ensureRunning() ressuscita o daemon", async () => {
  let spawnCount = 0;
  let healthy = false;
  let attachedCount = 0;
  let currentProc = { exitCode: 1 as number | null, killed: false };

  const controller = createWatchdogRecoveryController({
    port: 3000,
    maxRestarts: 2,
    windowMs: 60_000,
    getCurrentProc: () => currentProc,
    setCurrentProc: (next) => {
      currentProc = next;
    },
    spawnProc: () => {
      spawnCount += 1;
      return { exitCode: null, killed: false };
    },
    waitHealthy: async () => {
      healthy = true;
    },
    attachWatchdog: () => {
      attachedCount += 1;
    },
    checkHealth: async () => healthy,
    isStopping: () => false,
  });

  const d1 = controller.canAutoRestart(1000);
  const d2 = controller.canAutoRestart(2000);
  const d3 = controller.canAutoRestart(3000);

  assert.equal(d1.allowed, true);
  assert.equal(d2.allowed, true);
  assert.equal(d3.allowed, false);
  assert.equal(controller.isWatchdogSuspended(), true);

  // Chamadas concorrentes ao reabrir janela devem deduplicar em um unico respawn
  const [r1, r2] = await Promise.all([controller.ensureRunning(), controller.ensureRunning()]);
  assert.deepEqual(r1, { ok: true, restarted: true, port: 3000 });
  assert.deepEqual(r2, { ok: true, restarted: true, port: 3000 });
  assert.equal(spawnCount, 1);
  assert.equal(attachedCount, 1);
  assert.equal(controller.isWatchdogSuspended(), false);

  // Com daemon vivo e saudavel, proxima verificacao nao faz respawn
  const r3 = await controller.ensureRunning();
  assert.deepEqual(r3, { ok: true, restarted: false, port: 3000 });
  assert.equal(spawnCount, 1);
});
