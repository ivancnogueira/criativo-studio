import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { initializeDatabase, MAX_SQLITE_CACHE_KB } from "../src/database/client.ts";
import { EventRetentionService } from "../src/database/event-retention-service.ts";
import {
  ACP_MAX_MESSAGE_BYTES,
  NdjsonBufferedLineReader,
} from "../src/providers/acp-stream-framing.ts";
import { OpenCodeAcpConnection } from "../src/providers/opencode-acp-connection.ts";
import {
  detectUnparsedTextToolAttempt,
  parseTextToolCalls,
} from "../src/server/routes/text-tool-call-detector.ts";
import { runTextModelWorkflowToolLoop } from "../src/server/routes/chat-routing-helpers.ts";

describe("Fase 41-03 — Escala ACP 256 MB, SQLite 64 MB, Retenção Indexada e Detector <execute>", () => {
  it("ACP_MAX_MESSAGE_BYTES equivale a 256 MB e NdjsonBufferedLineReader descarta linha excedente sem envenenar as seguintes", async () => {
    assert.equal(ACP_MAX_MESSAGE_BYTES, 256 * 1024 * 1024);

    const stream = new PassThrough();
    const lines: string[] = [];
    const oversized: number[] = [];

    const reader = new NdjsonBufferedLineReader({
      stream,
      maxMessageBytes: 2048,
      onLine: (line) => lines.push(line),
      onOversizedLine: (info) => oversized.push(info.byteLength),
    });

    const validBefore = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const huge = JSON.stringify({ payload: "x".repeat(5000) });
    const validAfter = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { recovered: true } });

    stream.write(`${validBefore}\n`);
    stream.write(`${huge.slice(0, 1500)}`);
    stream.write(`${huge.slice(1500)}\n`);
    stream.write(`${validAfter}\n`);
    stream.end();

    await new Promise((r) => setTimeout(r, 20));
    reader.dispose();

    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).id, 1);
    assert.equal(JSON.parse(lines[1]!).result.recovered, true);
    assert.equal(oversized.length, 1);
    assert.ok(oversized[0]! > 2048);
  });

  it("OpenCodeAcpConnection isola falha de payload gigante no turno afetado e mantém sessões seguintes vivas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-03-acp-"));
    let conn: OpenCodeAcpConnection | null = null;
    try {
      const mockScript = join(dir, "mock-opencode.mjs");
      writeFileSync(
        mockScript,
        [
          'import { createInterface } from "node:readline";',
          'const rl = createInterface({ input: process.stdin });',
          'let count = 0;',
          'rl.on("line", (line) => {',
          '  if (!line.trim()) return;',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));',
          '  } else if (msg.method === "session/new") {',
          '    count += 1;',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s-" + count } }));',
          '  } else if (msg.method === "session/prompt") {',
          '    const txt = msg.params?.prompt?.[0]?.text || "";',
          '    if (txt.includes("HUGE_LINE")) {',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { big: "a".repeat(8000) } }));',
          '    } else {',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "RESPOSTA_OK" } } } }));',
          '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }));',
          '    }',
          '  } else if (msg.method === "session/close") {',
          '    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));',
          '  }',
          '});',
        ].join("\n"),
        "utf8",
      );

      conn = new OpenCodeAcpConnection(mockScript, dir, {}, { maxMessageBytes: 4096 });
      await assert.rejects(
        () =>
          conn!.runPrompt({
            cwd: dir,
            promptText: "HUGE_LINE",
            modelId: "minimax",
            timeoutMs: 10_000,
          }),
        /256 MB/i,
      );

      assert.equal(conn.isAlive(), true);

      const second = await conn.runPrompt({
        cwd: dir,
        promptText: "NORMAL_TURN",
        modelId: "minimax",
        timeoutMs: 10_000,
      });
      assert.equal(second.text, "RESPOSTA_OK");
    } finally {
      conn?.dispose();
      await new Promise((r) => setTimeout(r, 90));
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("SQLite aplica PRAGMA cache_size de 64 MB (-65536), temp_store MEMORY e EventRetentionService usa índice idx_eventos_ocorrido_em sem SCAN", () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-03-db-"));
    const db = initializeDatabase({ dbPath: join(dir, "scale.db"), cacheSizeMb: 64 });
    try {
      const cacheRow = db.connection.prepare("PRAGMA cache_size;").get() as { cache_size: number };
      const tempRow = db.connection.prepare("PRAGMA temp_store;").get() as { temp_store: number };
      assert.equal(cacheRow.cache_size, -MAX_SQLITE_CACHE_KB);
      assert.equal(tempRow.temp_store, 2); // 2 = MEMORY

      const planRows = db.connection
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT sequencia FROM eventos_orquestracao
           WHERE ocorrido_em < ?
           ORDER BY ocorrido_em ASC
           LIMIT 500;`,
        )
        .all("2026-10-01T00:00:00.000Z") as Array<{ detail: string }>;
      const planText = planRows.map((r) => r.detail).join(" | ");
      assert.match(planText, /idx_eventos_ocorrido_em/i);
      assert.doesNotMatch(planText, /^SCAN eventos_orquestracao/i);

      const now = Date.parse("2026-11-27T12:00:00.000Z");
      const oldIso = new Date(now - 45 * 86_400_000).toISOString();
      const recentIso = new Date(now - 2 * 86_400_000).toISOString();
      const insertStmt = db.connection.prepare(
        `INSERT INTO eventos_orquestracao (evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json)
         VALUES (?, ?, 'sistema', 's1', 'teste', ?, '{}');`,
      );
      for (let i = 0; i < 6; i += 1) {
        insertStmt.run(`ev-old-${i}`, "cmd-1", oldIso);
      }
      insertStmt.run("ev-recent-1", "cmd-2", recentIso);

      const retention = new EventRetentionService({ db, retentionDays: 30, batchSize: 10 });
      const report = retention.pruneExpiredEvents({ nowMs: now });
      assert.equal(report.deletedEvents, 6);

      const remaining = db.connection
        .prepare("SELECT evento_id FROM eventos_orquestracao;")
        .all() as Array<{ evento_id: string }>;
      assert.deepEqual(remaining.map((r) => r.evento_id), ["ev-recent-1"]);
    } finally {
      db.connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseTextToolCalls executa <execute> válido e runTextModelWorkflowToolLoop recupera tentativa malformada sem vazar markup", async () => {
    const calls = parseTextToolCalls(
      'Vou listar agora:\n<execute>{"name":"list_workflows","arguments":{}}</execute>\n',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "list_workflows");

    const attrCalls = parseTextToolCalls(
      '<invoke name="mcp_browser_open"><parameter name="url">"https://criativoos.local"</parameter></invoke>',
    );
    assert.equal(attrCalls.length, 1);
    assert.equal(attrCalls[0]?.name, "mcp_browser_open");
    assert.equal(attrCalls[0]?.arguments.url, "https://criativoos.local");

    const bad = detectUnparsedTextToolAttempt("Texto útil antes <execute>acao invalida()</execute> depois");
    assert.equal(bad.detected, true);
    assert.equal(bad.matchedTag, "<execute>");
    assert.doesNotMatch(bad.sanitizedText, /<execute>/i);

    let followUps = 0;
    const recoveredReply = await runTextModelWorkflowToolLoop({
      initialText: "<execute>list_workflows()</execute>",
      invokeFollowUp: async () => {
        followUps += 1;
        return "Pronto! Segue texto limpo após recuperação.";
      },
      deps: {
        db: {} as never,
        vault: {} as never,
      } as never,
      agenteId: "estrategista",
      turnId: "turn-1",
      steps: [],
    });

    assert.equal(followUps, 1);
    assert.equal(recoveredReply, "Pronto! Segue texto limpo após recuperação.");
  });
});
