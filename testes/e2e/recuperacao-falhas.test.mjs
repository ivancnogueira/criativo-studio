import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { initializeDatabase } from "../../apps/daemon/dist/database/client.js";
import { seedDefaultAgents } from "../../apps/daemon/dist/engine/runner/roster-defaults.js";
import { createDaemonServer } from "../../apps/daemon/dist/server/daemon-server.js";

function requestJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        });
      })
      .on("error", reject);
  });
}

describe("E2E — Recuperação de Falhas e Resiliência do SQLite após Crash", () => {
  let tempDir;
  let dbPath;
  let daemon;
  let socketPath;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-e2e-recovery-"));
    dbPath = join(tempDir, "criativo-crash.db");
    socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\criativo-e2e-recovery-${process.pid}-${Date.now()}`
        : join(tempDir, "control-recovery.sock");

    // Prepara cenário pré-crash diretamente no banco SQLite
    const db = initializeDatabase({ dbPath });
    seedDefaultAgents(db);
    const agora = new Date().toISOString();

    // Tarefa 1: interrompida com 1 tentativa -> deve voltar para 'pendente' (tentativas=2) e rodar novamente
    db.connection
      .prepare(
        `INSERT INTO projecao_tarefas (
          tarefa_id, agente_id, canal_origem, tipo, titulo, prioridade, status, payload_json, tentativas, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        "task-crash-recoverable",
        "estrategista",
        "web",
        "planejamento",
        "Planejamento interrompido antes do crash",
        1,
        "executando",
        JSON.stringify({ nota: "recuperar" }),
        1,
        agora,
        agora
      );

    // Tarefa 2: interrompida já no limite de 3 tentativas -> deve ir para 'falha'
    db.connection
      .prepare(
        `INSERT INTO projecao_tarefas (
          tarefa_id, agente_id, canal_origem, tipo, titulo, prioridade, status, payload_json, tentativas, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        "task-crash-exhausted",
        "copywriter",
        "cli",
        "copy",
        "Copy com limite máximo de falhas",
        2,
        "executando",
        JSON.stringify({ nota: "esgotada" }),
        3,
        agora,
        agora
      );

    // Simula agente travado em 'trabalhando' no momento da queda de energia
    db.connection
      .prepare(`UPDATE projecao_agentes SET status = 'trabalhando' WHERE agente_id = 'estrategista';`)
      .run();

    // Fecha abruptamente sem passar pelo DaemonServer.close()
    db.close();
  });

  after(async () => {
    await daemon?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("recupera tarefas interrompidas no boot, destrava agentes e reprocessa a fila preservando integridade", async () => {
    const executedIds = [];
    let markCompletedResolve;
    const recoveredTaskCompleted = new Promise((resolve) => {
      markCompletedResolve = resolve;
    });

    daemon = await createDaemonServer({
      dbPath,
      port: 0,
      workerPollMs: 30,
      controlSocketPath: socketPath,
      taskExecutor: {
        execute: async (tarefa) => {
          executedIds.push(tarefa.tarefa_id);
          daemon.queue.updateTaskStatus(tarefa.tarefa_id, "concluido", {
            recuperada: true,
          });
          markCompletedResolve();
        },
      },
    });

    // 1. Verifica telemetria de crash recovery no /health
    const healthRes = await requestJson(`http://127.0.0.1:${daemon.port}/health`);
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.body.status, "ok");
    assert.equal(healthRes.body.crashRecovery.totalInterrompidas, 2);
    assert.deepEqual(healthRes.body.crashRecovery.reenfileiradas, ["task-crash-recoverable"]);
    assert.deepEqual(healthRes.body.crashRecovery.marcadasFalha, ["task-crash-exhausted"]);

    // 2. Verifica que a tarefa esgotada foi marcada como 'falha' definitivamente
    const exhaustedTask = daemon.queue.getTask("task-crash-exhausted");
    assert.equal(exhaustedTask?.status, "falha");
    assert.match(String(exhaustedTask?.erro_detalhes ?? ""), /limite de segurança 3 atingido/i);

    // 3. Aguarda o worker reprocessar automaticamente a tarefa recuperada
    await recoveredTaskCompleted;
    const recoveredTask = daemon.queue.getTask("task-crash-recoverable");
    assert.equal(recoveredTask?.status, "concluido");
    assert.equal(recoveredTask?.tentativas, 2);
    assert.equal(recoveredTask?.resultado?.recuperada, true);
    assert.deepEqual(executedIds, ["task-crash-recoverable"]);

    // 4. Confirma que o agente destravado voltou para 'ocioso' e a integridade do SQLite está 100% íntegra
    const agentRow = daemon.db.connection
      .prepare(`SELECT status FROM projecao_agentes WHERE agente_id = 'estrategista';`)
      .get();
    assert.equal(agentRow?.status, "ocioso");

    const integrityCheck = daemon.db.connection.prepare(`PRAGMA integrity_check;`).get();
    assert.equal(integrityCheck?.integrity_check, "ok");
  });
});
