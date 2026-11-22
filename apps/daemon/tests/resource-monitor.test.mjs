import test from "node:test";
import assert from "node:assert/strict";
import {
  HostResourceMonitorService,
  ProcessControlError,
} from "../src/server/resource-monitor.ts";

test("HostResourceMonitorService coleta métricas do host e restringe kill apenas a PIDs rastreados", () => {
  const monitor = new HostResourceMonitorService({ workspaceRoot: process.cwd() });

  // 1. Snapshot contém CPU, RAM, Disco e RSS do daemon
  const snap1 = monitor.getSnapshot();
  assert.ok(snap1.cpus >= 1);
  assert.ok(snap1.memory_total_mb > 0);
  assert.ok(snap1.daemon_rss_mb > 0);
  assert.ok(snap1.cpu_percent >= 0 && snap1.cpu_percent <= 100);

  // 2. Bloqueia tentativa de encerrar o próprio daemon ou PID externo não rastreado
  assert.throws(() => monitor.killTrackedProcess(process.pid), ProcessControlError);
  assert.throws(() => monitor.killTrackedProcess(999999), ProcessControlError);

  // 3. Registra processo filho simulado e permite encerramento via handler seguro
  let killed = false;
  monitor.registerProcess({
    pid: 424242,
    kind: "remotion",
    label: "Renderizador Remotion #1",
    memoryMbHint: 312,
    onKill: () => {
      killed = true;
    },
  });

  const snap2 = monitor.getSnapshot();
  assert.equal(snap2.processes.length, 1);
  assert.equal(snap2.processes[0]?.pid, 424242);
  assert.equal(snap2.processes[0]?.can_kill, true);

  const killRes = monitor.killTrackedProcess(424242);
  assert.equal(killRes.ok, true);
  assert.equal(killed, true);
  assert.equal(monitor.getSnapshot().processes.length, 0);
});
