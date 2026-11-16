import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CriativoDatabase, initializeDatabase } from "../src/database/client.ts";
import { SCHEMA_TABLE_NAMES } from "../src/database/schema.ts";
import { FifoQueueManager } from "../src/queue/fifo-queue.ts";
import { recoverInterruptedTasks } from "../src/queue/task-recovery.ts";
import { computeNextCronExecution, CronScheduler } from "../src/routines/cron-scheduler.ts";
import { createDaemonServer } from "../src/server/daemon-server.ts";
import { VaultService } from "../src/vault/vault-service.ts";

describe("Fase 2 — Núcleo do Daemon, SQLite, Fila FIFO, Vault & Servidor", () => {
  let tempDir: string;
  let dbPath: string;
  let db: CriativoDatabase;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase2-"));
    dbPath = join(tempDir, "criativo-teste.db");
    db = initializeDatabase({ dbPath });
  });

  after(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("cria todas as 11 tabelas do API-SPEC.md de forma idempotente e impõe integridade referencial", () => {
    // Executa novamente para garantir idempotência
    db.initializeDatabase();

    const tables = db.listTables();
    for (const expectedTable of SCHEMA_TABLE_NAMES) {
      assert.ok(
        tables.includes(expectedTable),
        `Tabela ausente no schema: ${expectedTable}`
      );
    }

    // Testa foreign key de memoria -> agente
    assert.throws(() => {
      db.connection
        .prepare(
          `INSERT INTO projecao_agente_memorias (memoria_id, agente_id, texto, origem, criado_em) VALUES ('m1', 'agente_inexistente', 'teste', 'manual', ?);`
        )
        .run(new Date().toISOString());
    }, /FOREIGN KEY constraint failed/i);
  });

  it("processa Fila FIFO respeitando prioridade ASC e ordem cronológica em empates", async () => {
    const queue = new FifoQueueManager(db);

    const baixa = queue.enqueueTask({
      tipo: "stories",
      titulo: "Tarefa prioridade 8",
      prioridade: 8,
      payload: { tema: "baixa" },
    });

    await new Promise((r) => setTimeout(r, 15));

    const media1 = queue.enqueueTask({
      tipo: "carrossel",
      titulo: "Tarefa prioridade 5 (primeira)",
      prioridade: 5,
      payload: { tema: "media-1" },
    });

    await new Promise((r) => setTimeout(r, 15));

    const media2 = queue.enqueueTask({
      tipo: "carrossel",
      titulo: "Tarefa prioridade 5 (segunda)",
      prioridade: 5,
      payload: { tema: "media-2" },
    });

    const maxima = queue.enqueueTask({
      tipo: "reels",
      titulo: "Tarefa prioridade 1 (urgente)",
      prioridade: 1,
      payload: { tema: "urgente" },
    });

    const p1 = queue.dequeueNextTask();
    const p2 = queue.dequeueNextTask();
    const p3 = queue.dequeueNextTask();
    const p4 = queue.dequeueNextTask();
    const vazio = queue.dequeueNextTask();

    assert.equal(p1?.tarefa_id, maxima.tarefa_id);
    assert.equal(p2?.tarefa_id, media1.tarefa_id);
    assert.equal(p3?.tarefa_id, media2.tarefa_id);
    assert.equal(p4?.tarefa_id, baixa.tarefa_id);
    assert.equal(vazio, null);

    const retried = queue.retryTask(p1!.tarefa_id);
    assert.equal(retried.status, "pendente");
    assert.equal(retried.tentativas, 1);

    const cancelled = queue.cancelTask(p1!.tarefa_id, "Cancelamento de teste");
    assert.equal(cancelled.status, "cancelado");
  });

  it("recupera tarefas órfãs ('executando') no boot com limite de tentativas (Crash Recovery)", () => {
    const queue = new FifoQueueManager(db);

    const recuperavel = queue.enqueueTask({
      tipo: "carrossel",
      titulo: "Tarefa interrompida recuperável",
      prioridade: 3,
      payload: {},
    });
    queue.dequeueNextTask(); // coloca em 'executando' (ou garantimos explícito abaixo)
    db.connection
      .prepare(`UPDATE projecao_tarefas SET status = 'executando', tentativas = 1 WHERE tarefa_id = ?;`)
      .run(recuperavel.tarefa_id);

    const excedida = queue.enqueueTask({
      tipo: "reels",
      titulo: "Tarefa interrompida excedida",
      prioridade: 3,
      payload: {},
    });
    db.connection
      .prepare(`UPDATE projecao_tarefas SET status = 'executando', tentativas = 2 WHERE tarefa_id = ?;`)
      .run(excedida.tarefa_id);

    const report = recoverInterruptedTasks(db);
    assert.ok(report.reenfileiradas.includes(recuperavel.tarefa_id));
    assert.ok(report.marcadasFalha.includes(excedida.tarefa_id));

    const recDepois = queue.getTask(recuperavel.tarefa_id);
    const excDepois = queue.getTask(excedida.tarefa_id);
    assert.equal(recDepois?.status, "pendente");
    assert.equal(recDepois?.tentativas, 2);
    assert.equal(excDepois?.status, "falha");
    assert.equal(excDepois?.tentativas, 3);
  });

  it("criptografa e recupera segredos no VaultService usando AES-256-GCM sem expor valores nos metadados", () => {
    const vault = new VaultService(db, "chave-mestra-teste-segura-2026");
    const tokenExemplo = "tok_teste_simulacao_nao_real_12345";

    vault.setSecret("GEMINI_API_KEY", tokenExemplo);

    const rawRow = db.connection
      .prepare(`SELECT valor_criptografado, iv FROM cofre_segredos WHERE chave_nome = 'GEMINI_API_KEY';`)
      .get() as { valor_criptografado: string; iv: string };

    assert.notEqual(rawRow.valor_criptografado, tokenExemplo);
    assert.equal(rawRow.iv.split(":").length, 3);

    const decrypted = vault.getSecret("GEMINI_API_KEY");
    assert.equal(decrypted, tokenExemplo);

    const metadata = vault.listSecretsMetadata();
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0].chave_nome, "GEMINI_API_KEY");
    assert.equal("valor_criptografado" in metadata[0], false);

    // Chave mestra errada não consegue descriptografar
    const wrongVault = new VaultService(db, "chave-errada");
    assert.throws(() => wrongVault.getSecret("GEMINI_API_KEY"));
  });

  it("avalia expressões cron no fuso America/Sao_Paulo e enfileira rotinas devidas", () => {
    const queue = new FifoQueueManager(db);
    const cron = new CronScheduler(db, queue);

    // Verifica parser com horário de São Paulo (-03:00): 18:00 BRT = 21:00 UTC
    const baseUtc = new Date("2026-11-16T20:50:00.000Z"); // 17:50 BRT (segunda)
    const nextRun = computeNextCronExecution("0 18 * * 1-5", baseUtc, "America/Sao_Paulo");
    assert.equal(nextRun.toISOString(), "2026-11-16T21:00:00.000Z");

    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const rotina = cron.createRoutine({
      titulo: "Rotina editorial de teste",
      expressao_cron: "0 9 * * *",
      tipo_tarefa: "planejamento",
      proxima_execucao_em: pastIso,
      payload_modelo: { formato: "carrossel" },
    });

    const createdIds = cron.checkAndEnqueueDueRoutines();
    assert.equal(createdIds.length, 1);
    const createdTask = queue.getTask(createdIds[0]);
    assert.equal(createdTask?.canal_origem, "rotina_cron");
    assert.equal(createdTask?.titulo, "Rotina editorial de teste");

    const updatedRoutine = db.connection
      .prepare(`SELECT proxima_execucao_em FROM projecao_rotinas WHERE rotina_id = ?;`)
      .get(rotina.rotina_id) as { proxima_execucao_em: string };
    assert.ok(updatedRoutine.proxima_execucao_em > pastIso);
  });

  it("sobe DaemonServer HTTP + WebSocket em porta dinâmica, responde /health e faz broadcast de task:queued", async () => {
    const serverDbPath = join(tempDir, "server-test.db");
    const runtime = await createDaemonServer({
      port: 0,
      dbPath: serverDbPath,
      vaultMasterKey: "chave-servidor-teste",
      autoStartLoops: false,
    });

    try {
      const healthRes = await fetch(`http://127.0.0.1:${runtime.port}/health`);
      assert.equal(healthRes.status, 200);
      const healthJson = (await healthRes.json()) as { status: string; service: string };
      assert.equal(healthJson.status, "ok");
      assert.equal(healthJson.service, "criativo-daemon");

      // Conecta via WebSocket nativo do Node 22 para validar transmissão em tempo real
      const ws = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws`);
      const receivedEvents: Array<{ event: string; data: { titulo?: string } }> = [];

      await new Promise<void>((resolveOpen, rejectOpen) => {
        ws.addEventListener("open", () => resolveOpen());
        ws.addEventListener("error", (err) => rejectOpen(err));
      });

      const messagePromise = new Promise<void>((resolveMsg) => {
        ws.addEventListener("message", (evt) => {
          const parsed = JSON.parse(String(evt.data)) as {
            event: string;
            data: { titulo?: string };
          };
          receivedEvents.push(parsed);
          if (parsed.event === "task:queued") {
            resolveMsg();
          }
        });
      });

      const createRes = await fetch(`http://127.0.0.1:${runtime.port}/api/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "carrossel",
          titulo: "Carrossel de validação HTTP+WS",
          prioridade: 2,
          payload: { slides: 5 },
        }),
      });
      assert.equal(createRes.status, 201);

      await messagePromise;
      assert.equal(receivedEvents[0].event, "task:queued");
      assert.equal(receivedEvents[0].data.titulo, "Carrossel de validação HTTP+WS");
      ws.close();

      // Testa Vault via HTTP
      const saveVaultRes = await fetch(`http://127.0.0.1:${runtime.port}/api/vault/salvar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chave_nome: "OPENAI_API_KEY",
          valor: "sk-teste-simulacao-000",
        }),
      });
      assert.equal(saveVaultRes.status, 200);

      const statusVaultRes = await fetch(`http://127.0.0.1:${runtime.port}/api/vault/status`);
      const statusVaultJson = (await statusVaultRes.json()) as {
        chaves: Array<{ chave_nome: string }>;
      };
      assert.equal(statusVaultJson.chaves[0].chave_nome, "OPENAI_API_KEY");
    } finally {
      await runtime.close();
    }
  });
});
