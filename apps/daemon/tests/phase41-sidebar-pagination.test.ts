import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { initializeDatabase } from "../src/database/client.ts";
import { seedDefaultStudioExperience } from "../src/engine/runner/roster-defaults.ts";
import {
  ConversationPaginationReader,
  INITIAL_CONVERSATION_PAGE_SIZE,
  MAX_UNREAD_INITIAL_PAGE_SIZE,
} from "../src/threads/conversation-pagination.ts";
import { tryHandleAgentMessagesRoutes } from "../src/server/routes/agent-messages-routes.ts";
import { tryHandleChannelsCrudRoutes } from "../src/server/routes/channels-crud-routes.ts";
import { tryHandleChannelsMessagesRoutes } from "../src/server/routes/channels-messages-routes.ts";
import { tryHandleAgentsCrudRoutes } from "../src/server/routes/agents-crud-routes.ts";

function callRoute(
  handler: (ctx: never) => Promise<boolean>,
  params: { method: string; path: string; db: ReturnType<typeof initializeDatabase>; pagination?: ConversationPaginationReader; dir: string },
): Promise<{ handled: boolean; statusCode: number; data: Record<string, unknown> }> {
  return new Promise(async (resolve) => {
    const req = new PassThrough() as unknown as IncomingMessage;
    (req as unknown as { method: string; url: string }).method = params.method;
    (req as unknown as { url: string }).url = params.path;
    process.nextTick(() => (req as unknown as PassThrough).end());

    let statusCode = 200;
    let body = "";
    const res = {
      writeHead: (code: number) => { statusCode = code; },
      end: (chunk?: string | Buffer) => { body += chunk?.toString() ?? ""; },
      setHeader: () => {},
    } as unknown as ServerResponse;

    const handled = await handler({
      req,
      res,
      method: params.method,
      path: params.path.split("?")[0],
      url: new URL(`http://127.0.0.1${params.path}`),
      db: params.db,
      wsHub: { broadcast: () => {} },
      workspaceRoot: params.dir,
      deps: {
        db: params.db,
        providerConnection: {
          getOnboardingState: () => ({ setup_assistant_dismissed: false, onboarding_concluido: false }),
          getStudioConfig: <T>(_key: string, fallback: T): T => fallback,
        },
        sendJson: (r: ServerResponse, code: number, data: unknown) => {
          r.writeHead(code);
          r.end(JSON.stringify(data));
        },
        readJsonBody: async () => ({}),
        phase13: params.pagination ? { pagination: params.pagination } : undefined,
      },
    } as never);

    resolve({ handled, statusCode, data: body ? (JSON.parse(body) as Record<string, unknown>) : {} });
  });
}

describe("Fase 41-04 — Paginação Enxuta 24/100, Filtros Rápidos e Isolamento de Canal", () => {
  it("carrega 24 mensagens por padrão e expande até 100 quando houver não lidas em agentes, threads e canais", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-04-pag-"));
    const db = initializeDatabase({ dbPath: join(dir, "pag.db") });
    try {
      seedDefaultStudioExperience(db);
      db.connection
        .prepare("DELETE FROM projecao_conversas_chat WHERE agente_id = 'estrategista' OR canal_id = 'agente:estrategista';")
        .run();
      const pagination = new ConversationPaginationReader(db);

      const insertMsg = db.connection.prepare(
        `INSERT INTO projecao_conversas_chat
         (mensagem_id, canal_id, agente_id, thread_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, lida, ordinal, criado_em)
         VALUES (?, ?, ?, ?, 'agente', 'Agente', ?, '[]', '[]', ?, ?, ?);`,
      );

      // 60 mensagens lidas no agente estrategista
      for (let i = 1; i <= 60; i += 1) {
        const ts = new Date(Date.UTC(2026, 10, 1, 10, i, 0)).toISOString();
        insertMsg.run(
          `m-ag-${i}`,
          "agente:estrategista",
          "estrategista",
          "main:estrategista",
          `Mensagem agente ${i}`,
          1,
          i,
          ts,
        );
      }

      // 60 mensagens lidas no canal eq-1
      db.connection
        .prepare(
          `INSERT INTO projecao_grupos_equipe (canal_id, nome, descricao, pasta, membros_agentes_json, criado_em, atualizado_em)
           VALUES ('eq-1', 'Equipe Criativa', 'Desc', 'Canais em Equipe', '["estrategista"]', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');`,
        )
        .run();
      for (let i = 1; i <= 60; i += 1) {
        const ts = new Date(Date.UTC(2026, 10, 1, 11, i, 0)).toISOString();
        insertMsg.run(
          `m-ch-${i}`,
          "eq-1",
          null,
          null,
          `Mensagem canal ${i}`,
          1,
          i,
          ts,
        );
      }

      const pageDefault = pagination.readPage({ threadId: "main:estrategista", agenteId: "estrategista" });
      assert.equal(pageDefault.mensagens.length, INITIAL_CONVERSATION_PAGE_SIZE);
      assert.equal(pageDefault.has_older, true);
      assert.equal(pageDefault.older_count, 36);
      assert.equal(pageDefault.mensagens[0]?.mensagem_id, "m-ag-37");
      assert.equal(pageDefault.mensagens[23]?.mensagem_id, "m-ag-60");

      const agentGet = await callRoute(tryHandleAgentMessagesRoutes, {
        method: "GET",
        path: "/api/agentes/estrategista/mensagens",
        db,
        pagination,
        dir,
      });
      assert.equal(agentGet.statusCode, 200);
      assert.equal((agentGet.data.mensagens as unknown[]).length, 24);

      const channelGet = await callRoute(tryHandleChannelsMessagesRoutes, {
        method: "GET",
        path: "/api/canais/eq-1/mensagens",
        db,
        dir,
      });
      assert.equal(channelGet.statusCode, 200);
      const chMsgs = channelGet.data.mensagens as Array<{ mensagem_id: string }>;
      assert.equal(chMsgs.length, 24);
      assert.equal(chMsgs[0]?.mensagem_id, "m-ch-37");
      assert.equal(chMsgs[23]?.mensagem_id, "m-ch-60");

      // Agora marca 45 novas não lidas -> expande automaticamente até 45
      for (let i = 61; i <= 105; i += 1) {
        const ts = new Date(Date.UTC(2026, 10, 2, 10, Math.floor(i / 60), i % 60)).toISOString();
        insertMsg.run(
          `m-ag-${i}`,
          "agente:estrategista",
          "estrategista",
          "main:estrategista",
          `Nova não lida ${i}`,
          0,
          i,
          ts,
        );
      }
      const pageUnread45 = pagination.readPage({ threadId: "main:estrategista", agenteId: "estrategista" });
      assert.equal(pageUnread45.mensagens.length, 45);

      // Adiciona mais 75 não lidas (total 120 não lidas) -> limita no teto de 100
      for (let i = 106; i <= 180; i += 1) {
        const ts = new Date(Date.UTC(2026, 10, 3, Math.floor(i / 60), i % 60, 0)).toISOString();
        insertMsg.run(
          `m-ag-${i}`,
          "agente:estrategista",
          "estrategista",
          "main:estrategista",
          `Extra não lida ${i}`,
          0,
          i,
          ts,
        );
      }
      const pageUnreadCap = pagination.readPage({ threadId: "main:estrategista", agenteId: "estrategista" });
      assert.equal(pageUnreadCap.mensagens.length, MAX_UNREAD_INITIAL_PAGE_SIZE);
    } finally {
      db.connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/canais isola canal com membros_agentes_json corrompido retornando HTTP 200 e fallback seguro", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-04-ch-"));
    const db = initializeDatabase({ dbPath: join(dir, "ch.db") });
    try {
      seedDefaultStudioExperience(db);
      const baselineChannels = (
        db.connection.prepare("SELECT COUNT(*) AS c FROM projecao_grupos_equipe;").get() as { c: number }
      ).c;
      db.connection
        .prepare(
          `INSERT INTO projecao_grupos_equipe (canal_id, nome, descricao, pasta, membros_agentes_json, criado_em, atualizado_em)
           VALUES
             ('eq-ok', 'Equipe Saudável', 'OK', 'Canais em Equipe', '["estrategista"]', '2026-11-01T10:00:00.000Z', '2026-11-02T10:00:00.000Z'),
             ('eq-bad', 'Equipe Corrompida', 'Quebrada', 'Canais em Equipe', '{corrompido', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');`,
        )
        .run();

      const resp = await callRoute(tryHandleChannelsCrudRoutes, {
        method: "GET",
        path: "/api/canais",
        db,
        dir,
      });

      assert.equal(resp.handled, true);
      assert.equal(resp.statusCode, 200);
      const canais = resp.data.canais as Array<{
        canal_id: string;
        membros_agentes: string[];
        erro_leitura?: boolean;
        pasta: string;
      }>;
      assert.equal(canais.length, baselineChannels + 2);

      const healthy = canais.find((c) => c.canal_id === "eq-ok");
      const broken = canais.find((c) => c.canal_id === "eq-bad");
      assert.ok(healthy);
      assert.deepEqual(healthy.membros_agentes, ["estrategista"]);
      assert.equal(healthy.erro_leitura, undefined);
      assert.equal(healthy.pasta, "Canais em Equipe");

      assert.ok(broken);
      assert.deepEqual(broken.membros_agentes, []);
      assert.equal(broken.erro_leitura, true);

      const agentsResp = await callRoute(tryHandleAgentsCrudRoutes, {
        method: "GET",
        path: "/api/agentes",
        db,
        dir,
      });
      assert.equal(agentsResp.statusCode, 200);
      assert.ok(Array.isArray(agentsResp.data.agentes));
    } finally {
      db.connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
