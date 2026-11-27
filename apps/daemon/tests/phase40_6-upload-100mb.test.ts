import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { readJsonBody, readRawBody, sendJson } from "../src/server/daemon-http-utils.ts";
import { MAX_UPLOAD_FILE_BYTES, tryHandleFilesRoutes } from "../src/server/routes/files-routes.ts";
import type { StudioRouteContext } from "../src/server/routes/route-helpers.ts";

describe("Phase 40.6-02 — Upload 100 MB Streaming & Protecao 2 MB", () => {
  it("aceita upload binario direto e JSON base64, mantendo limite de 2 MB em rotas comuns e 413 CRV-UPLOAD-413 > 100 MB", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "crv-p406-upl-"));
    const db = new CriativoDatabase(join(tmp, "test.db"));
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";
      try {
        if (path === "/api/rota-comum" && method === "POST") {
          const body = await readJsonBody(req);
          sendJson(res, 200, { ok: true, keys: Object.keys(body).length });
          return;
        }
        const ctx = {
          req,
          res,
          path,
          method,
          url,
          db,
          wsHub: { broadcast: () => {} },
          workspaceRoot: tmp,
          deps: {
            db,
            sendJson,
            readJsonBody,
            readRawBody,
            providerConnection: {
              getOnboardingState: () => ({ marcos: {}, pendencias_setup: [] }),
              getStudioConfig: (_k: string, def: unknown) => def,
              setStudioConfig: () => {},
              updateOnboardingState: (patch: Record<string, unknown>) => patch,
              getProvidersStatus: async () => [],
              getAntigravityService: () => ({ getLiveSnapshot: async () => ({ contas: [] }) }),
            },
          },
        } as unknown as StudioRouteContext;
        const handled = await tryHandleFilesRoutes(ctx);
        if (!handled) sendJson(res, 404, { erro: "nao encontrado" });
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode ?? 500;
        sendJson(res, status, { erro: err instanceof Error ? err.message : String(err) });
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      assert.equal(MAX_UPLOAD_FILE_BYTES, 100 * 1024 * 1024);

      // 1. Upload binario direto (> 2 MB para provar que nao sofre gargalo de 2 MB)
      const binPayload = Buffer.alloc(3 * 1024 * 1024, 0x41);
      const resBin = await fetch(
        `${baseUrl}/api/arquivos/upload?nome=video-teste.mp4&mime_type=video/mp4`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: binPayload,
        }
      );
      assert.equal(resBin.status, 201);
      const jsonBin = (await resBin.json()) as { arquivo: { caminho_relativo: string; tamanho_bytes: number } };
      assert.equal(jsonBin.arquivo.tamanho_bytes, 3 * 1024 * 1024);
      const savedPath = join(tmp, jsonBin.arquivo.caminho_relativo);
      assert.equal(existsSync(savedPath), true);
      assert.equal(readFileSync(savedPath).length, 3 * 1024 * 1024);

      // 2. Retrocompatibilidade JSON base64
      const smallBuf = Buffer.from("conteudo-teste-40-6");
      const resJson = await fetch(`${baseUrl}/api/arquivos/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "nota.txt",
          mime_type: "text/plain",
          conteudo_base64: smallBuf.toString("base64"),
        }),
      });
      assert.equal(resJson.status, 201);

      // 3. Rota comum continua protegida com teto de 2 MB
      const bigJson = JSON.stringify({ pad: "x".repeat(2_200_000) });
      const resCommon = await fetch(`${baseUrl}/api/rota-comum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigJson,
      });
      assert.equal(resCommon.status, 413);
      const commonErr = (await resCommon.json()) as { erro: string };
      assert.match(commonErr.erro, /2 MB/);

      // 4. Upload acima de 100 MB (Content-Length antecipado via HTTP raw) retorna 413 CRV-UPLOAD-413 com sugestao
      const net = await import("node:net");
      const raw413 = await new Promise<string>((resolveSock, rejectSock) => {
        const sock = net.createConnection({ host: "127.0.0.1", port: addr.port }, () => {
          sock.write(
            `POST /api/arquivos/upload?nome=bruto.mp4 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/octet-stream\r\nContent-Length: ${105 * 1024 * 1024}\r\nConnection: close\r\n\r\n`
          );
        });
        let data = "";
        sock.on("data", (c) => {
          data += c.toString("utf8");
        });
        sock.on("end", () => resolveSock(data));
        sock.on("error", rejectSock);
      });
      assert.match(raw413, /HTTP\/1\.1 413/);
      assert.match(raw413, /CRV-UPLOAD-413/);
      assert.match(raw413, /Pastas Autorizadas/);
    } finally {
      server.close();
      db.close();
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
