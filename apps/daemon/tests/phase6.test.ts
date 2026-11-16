import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

function requestSocketJson(
  socketPath: string,
  method: "GET" | "POST",
  path: string
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode ?? 0,
            body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Fase 6 — Control Socket & Telemetria CLI", () => {
  let tempDir: string;
  let socketPath: string;
  let daemon: DaemonRuntime;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase6-"));
    socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\criativo-phase6-${process.pid}-${Date.now()}`
        : join(tempDir, "control.sock");

    daemon = await createDaemonServer({
      dbPath: join(tempDir, "phase6.db"),
      port: 0,
      autoStartLoops: false,
      controlSocketPath: socketPath,
    });
  });

  after(async () => {
    await daemon.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("expõe telemetria do daemon em GET /status via socket local", async () => {
    assert.ok(daemon.controlSocket);
    const res = await requestSocketJson(socketPath, "GET", "/status");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.version, "1.0.0");
    assert.equal(typeof res.body.uptime_sec, "number");
    assert.equal(typeof res.body.memoria_rss_mb, "number");
    assert.equal(res.body.agentes_ativos, 0);
    assert.equal(res.body.tarefas_pendentes, 0);
  });

  it("lista tarefas da fila FIFO em GET /queue e status WhatsApp em GET /whatsapp-status", async () => {
    daemon.queue.enqueueTask({
      canal_origem: "cli",
      tipo: "carrossel",
      agente_id: "designer_carrossel",
      titulo: "Carrossel CLI Teste",
      prioridade: 1,
      payload: { origem: "teste" },
    });

    const queueRes = await requestSocketJson(socketPath, "GET", "/queue");
    assert.equal(queueRes.statusCode, 200);
    assert.equal(queueRes.body.total, 1);
    const tarefas = queueRes.body.tarefas as Array<{ titulo: string; status: string }>;
    assert.equal(tarefas[0].titulo, "Carrossel CLI Teste");
    assert.equal(tarefas[0].status, "pendente");

    const waRes = await requestSocketJson(socketPath, "GET", "/whatsapp-status");
    assert.equal(waRes.statusCode, 200);
    assert.equal(waRes.body.status, "desconectado");
  });

  it("aceita comando POST /restart e retorna 404 para rota desconhecida", async () => {
    const restartRes = await requestSocketJson(socketPath, "POST", "/restart");
    assert.equal(restartRes.statusCode, 200);
    assert.equal(restartRes.body.ok, true);

    const notFound = await requestSocketJson(socketPath, "GET", "/desconhecida");
    assert.equal(notFound.statusCode, 404);
  });
});
