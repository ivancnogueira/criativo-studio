import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { CacheExpiryCompactionService } from "../src/chat/cache-expiry-compaction-service.ts";
import { ContextResetService } from "../src/chat/context-reset-service.ts";
import { CriativoDatabase } from "../src/database/client.ts";
import { parseDocxPreviewFromBuffer } from "../src/server/docx-preview-parser.ts";
import { resolveOrCreateImageThumbnail } from "../src/server/image-thumbnail-service.ts";
import {
  UnsafeFilePathError,
  resolveSafeAllowedFilePath,
  tryHandleFilesPreviewRoutes,
} from "../src/server/routes/files-preview-routes.ts";
import type { StudioRouteContext } from "../src/server/routes/route-helpers.ts";
import { WebSocketHub } from "../src/server/websocket-hub.ts";

function buildSyntheticZip(
  entries: Array<{ name: string; content: Buffer; method?: 0 | 8 }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = method === 8 ? deflateRawSync(entry.content) : entry.content;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function createFakePreviewRouteContext(
  workspaceRoot: string,
  reqUrl: string,
  headers: Record<string, string> = {}
) {
  let statusCode = 0;
  let resHeaders: Record<string, string> = {};
  let jsonBody: unknown = null;
  let rawBody: Buffer | null = null;

  const res = {
    writeHead(status: number, hdrs?: Record<string, string>) {
      statusCode = status;
      resHeaders = hdrs ?? {};
      return res;
    },
    end(chunk?: Buffer | string) {
      if (chunk) {
        rawBody = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  } as unknown as ServerResponse;

  const url = new URL(reqUrl, "http://localhost");
  const ctx = {
    req: { headers } as IncomingMessage,
    res,
    path: url.pathname,
    method: "GET",
    url,
    workspaceRoot,
    deps: {
      sendJson: (_r: ServerResponse, status: number, payload: unknown) => {
        statusCode = status;
        jsonBody = payload;
      },
    },
  } as unknown as StudioRouteContext;

  return {
    ctx,
    getResult: () => ({ statusCode, resHeaders, jsonBody, rawBody }),
  };
}

describe("Fase 43-04 — Cache 1h, Presença TTL, Parser .docx e Miniaturas", () => {
  const tempDirs: string[] = [];

  after(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Caso 1 (Cache 1h): pré-compacta agente claude ocioso há 53 min com >= 200K tokens e ignora < 200K ou < 50 min", () => {
    const dir = mkdtempSync(join(tmpdir(), "criativo-p43-cache-"));
    tempDirs.push(dir);
    const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
    db.initializeDatabase();

    try {
      const nowMs = Date.parse("2026-11-27T18:00:00.000Z");
      const nowIso = new Date(nowMs).toISOString();

      const insertAgent = db.connection.prepare(
        `INSERT INTO projecao_agentes (
          agente_id, nome, papel, modelo_padrao, status, skills_paths_json, config_json, atualizado_em
        ) VALUES (?, ?, 'especialista', 'claude-sonnet-4-5', 'ocioso', '[]', '{}', ?);`
      );
      insertAgent.run("agente-elegivel", "Estrategista", nowIso);
      insertAgent.run("agente-poucos-tokens", "Redator", nowIso);
      insertAgent.run("agente-recente", "Revisor", nowIso);

      const insertUsage = db.connection.prepare(
        `INSERT INTO projecao_uso_registros (
          record_id, agent_id, session_id, turn_id, provider, model, occurred_at,
          uncached_input, cached_input, cache_creation, output_tokens, recorded_at
        ) VALUES (?, ?, 'sess-1', ?, 'claude', 'claude-sonnet-4-5', ?, ?, ?, ?, 1200, ?);`
      );
      // 53 min atrás com 240.000 tokens
      insertUsage.run(
        "rec-1",
        "agente-elegivel",
        "turn-1",
        new Date(nowMs - 53 * 60_000).toISOString(),
        40_000,
        150_000,
        50_000,
        nowIso
      );
      // 54 min atrás com 150.000 tokens (< 200.000)
      insertUsage.run(
        "rec-2",
        "agente-poucos-tokens",
        "turn-2",
        new Date(nowMs - 54 * 60_000).toISOString(),
        30_000,
        90_000,
        30_000,
        nowIso
      );
      // 30 min atrás (< 50 min) com 260.000 tokens
      insertUsage.run(
        "rec-3",
        "agente-recente",
        "turn-3",
        new Date(nowMs - 30 * 60_000).toISOString(),
        60_000,
        150_000,
        50_000,
        nowIso
      );

      const wsHub = new WebSocketHub();
      const resetEvents: Array<{ agente_id: string; cutoff_at: string }> = [];
      wsHub.subscribe((env) => {
        if (env.event === "context:reset") {
          const data = env.data as { agente_id: string; cutoff_at: string };
          resetEvents.push({ agente_id: data.agente_id, cutoff_at: data.cutoff_at });
        }
      });

      const contextReset = new ContextResetService({ db, wsHub });
      const cacheService = new CacheExpiryCompactionService({ db, contextReset });

      const sweep = cacheService.runSweep(nowMs);
      assert.equal(sweep.enabled, true);
      assert.equal(sweep.compactedCount, 1);

      const eligibleItem = sweep.items.find((i) => i.agenteId === "agente-elegivel");
      assert.ok(eligibleItem);
      assert.equal(eligibleItem.compacted, true);
      assert.equal(eligibleItem.tokensTotal, 240_000);

      const lowTokensItem = sweep.items.find((i) => i.agenteId === "agente-poucos-tokens");
      assert.equal(lowTokensItem?.compacted, false);
      assert.equal(lowTokensItem?.reason, "below_min_tokens");

      const recentItem = sweep.items.find((i) => i.agenteId === "agente-recente");
      assert.equal(recentItem?.compacted, false);
      assert.equal(recentItem?.reason, "below_idle_window");

      assert.equal(resetEvents.length, 1);
      assert.equal(resetEvents[0]?.agente_id, "agente-elegivel");

      const msgRow = db.connection
        .prepare(
          "SELECT item_type, metadados_json FROM projecao_conversas_chat WHERE agente_id = ? AND item_type = 'context_reset' LIMIT 1;"
        )
        .get("agente-elegivel") as { item_type: string; metadados_json: string } | undefined;
      assert.equal(msgRow?.item_type, "context_reset");
      assert.ok(msgRow?.metadados_json.includes("expira"));

      const agentRow = db.connection
        .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ?;")
        .get("agente-elegivel") as { config_json: string };
      const parsedCfg = JSON.parse(agentRow.config_json) as { context_cutoff_at?: string };
      assert.ok(typeof parsedCfg.context_cutoff_at === "string" && parsedCfg.context_cutoff_at.length > 0);

      // Segundo sweep não compacta novamente após o cutoff já gravado
      const secondSweep = cacheService.runSweep(nowMs + 1_000);
      assert.equal(secondSweep.compactedCount, 0);

      // Preferência desabilitada suspende sweep
      cacheService.updatePreferences({ enabled: false });
      const disabledSweep = cacheService.runSweep(nowMs + 2_000);
      assert.equal(disabledSweep.enabled, false);
      assert.equal(disabledSweep.compactedCount, 0);
    } finally {
      db.close();
    }
  });

  it("Caso 2 (Presença TTL > 45s): expira membro inativo mantendo apenas o colaborador ativo", () => {
    const wsHub = new WebSocketHub();
    const baseMs = Date.parse("2026-11-27T18:30:00.000Z");

    wsHub.upsertWorkflowPresence({
      workflowId: "wf-collab-1",
      memberId: "membro-expirado",
      displayName: "Colaborador A",
      role: "editor",
      selectedNodeId: "no-1",
      cursorX: 120,
      cursorY: 240,
      updatedAt: new Date(baseMs - 46_000).toISOString(),
    });
    wsHub.upsertWorkflowPresence({
      workflowId: "wf-collab-1",
      memberId: "membro-ativo",
      displayName: "Colaborador B",
      role: "owner",
      selectedNodeId: "no-2",
      cursorX: 520,
      cursorY: 310,
      updatedAt: new Date(baseMs - 10_000).toISOString(),
    });

    const pruned = wsHub.pruneStaleWorkflowPresence("wf-collab-1", baseMs, 45_000);
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0]?.memberId, "membro-ativo");
    assert.equal(pruned[0]?.cursorX, 520);
    assert.equal(pruned[0]?.selectedNodeId, "no-2");

    const listed = wsHub.listWorkflowPresence("wf-collab-1", baseMs, 45_000);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.memberId, "membro-ativo");
  });

  it("Caso 3 (Parser .docx): lê ZIP comprimido com deflateRawSync (Heading1, negrito, tabela 2x2) e rejeita não-ZIP", () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
            <w:r><w:t>Plano Editorial &amp; &lt;Briefing&gt;</w:t></w:r>
          </w:p>
          <w:p>
            <w:r><w:rPr><w:b/></w:rPr><w:t>Destaque em negrito</w:t></w:r>
            <w:r><w:t> e texto normal.</w:t></w:r>
          </w:p>
          <w:tbl>
            <w:tr>
              <w:tc><w:p><w:r><w:t>Canal</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>Formato</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr>
              <w:tc><w:p><w:r><w:t>Instagram</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>Carrossel</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>`;

    const zipBuffer = buildSyntheticZip([
      {
        name: "word/document.xml",
        content: Buffer.from(documentXml, "utf8"),
        method: 8,
      },
    ]);

    const parsed = parseDocxPreviewFromBuffer(zipBuffer);
    assert.equal(parsed.stats.headings, 1);
    assert.equal(parsed.stats.paragraphs, 1);
    assert.equal(parsed.stats.tables, 1);

    assert.deepEqual(parsed.blocks[0], {
      kind: "heading",
      level: 1,
      text: "Plano Editorial & <Briefing>",
    });
    assert.deepEqual(parsed.blocks[1], {
      kind: "paragraph",
      runs: [
        { text: "Destaque em negrito", bold: true },
        { text: " e texto normal." },
      ],
    });
    assert.deepEqual(parsed.blocks[2], {
      kind: "table",
      rows: [
        ["Canal", "Formato"],
        ["Instagram", "Carrossel"],
      ],
    });

    assert.throws(
      () => parseDocxPreviewFromBuffer(Buffer.from("arquivo-texto-invalido", "utf8")),
      /inválido|ZIP/i
    );
  });

  it("Caso 4 (Thumbnail & Segurança): bloqueia path traversal ../ com 403 e serve thumbnail cacheável", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "criativo-p43-thumbs-"));
    tempDirs.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, "recursos"), { recursive: true });
    writeFileSync(join(workspaceRoot, ".env"), "SEGREDO=123\n", "utf8");

    // 1x1 PNG válido mínimo
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const pngPath = join(workspaceRoot, "recursos", "amostra.png");
    writeFileSync(pngPath, tinyPng);

    assert.throws(
      () => resolveSafeAllowedFilePath(workspaceRoot, "../.env"),
      (err: unknown) => err instanceof UnsafeFilePathError && err.statusCode === 403
    );
    assert.throws(
      () => resolveSafeAllowedFilePath(workspaceRoot, ".env"),
      (err: unknown) => err instanceof UnsafeFilePathError && err.statusCode === 403
    );

    const safeResolved = resolveSafeAllowedFilePath(workspaceRoot, "recursos/amostra.png");
    assert.equal(safeResolved, pngPath);

    const thumb = await resolveOrCreateImageThumbnail({
      sourcePath: pngPath,
      workspaceRoot,
      width: 480,
    });
    assert.equal(existsSync(thumb.filePath), true);
    assert.ok(thumb.mode === "generated" || thumb.mode === "original-fallback");

    // Rota bloqueia traversal com status 403
    const traversalReq = createFakePreviewRouteContext(
      workspaceRoot,
      "/api/arquivos/preview-docx?path=../.env"
    );
    const handledTraversal = await tryHandleFilesPreviewRoutes(traversalReq.ctx);
    assert.equal(handledTraversal, true);
    assert.equal(traversalReq.getResult().statusCode, 403);

    // Rota de thumbnail retorna 200 com ETag/Cache-Control e 304 em revalidação
    const thumbReq = createFakePreviewRouteContext(
      workspaceRoot,
      "/api/arquivos/thumbnail?path=recursos/amostra.png&w=480"
    );
    const handledThumb = await tryHandleFilesPreviewRoutes(thumbReq.ctx);
    assert.equal(handledThumb, true);
    const firstRes = thumbReq.getResult();
    assert.equal(firstRes.statusCode, 200);
    assert.ok(firstRes.resHeaders.ETag);
    assert.equal(firstRes.resHeaders["Cache-Control"], "private, max-age=86400");
    assert.ok(firstRes.rawBody && firstRes.rawBody.length > 0);

    const revalidateReq = createFakePreviewRouteContext(
      workspaceRoot,
      "/api/arquivos/thumbnail?path=recursos/amostra.png&w=480",
      { "if-none-match": firstRes.resHeaders.ETag }
    );
    await tryHandleFilesPreviewRoutes(revalidateReq.ctx);
    assert.equal(revalidateReq.getResult().statusCode, 304);
  });
});
