import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AIProviderClient, AgentTurnContext, AgentTurnResult } from "@criativo/contracts";
import { CriativoDatabase } from "../src/database/client.ts";
import { recoverInterruptedTasks } from "../src/queue/task-recovery.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { executePhase13Tool, readAgentContextCutoffAt } from "../src/server/studio-tools-bridge.ts";
import { ConversationPaginationReader } from "../src/threads/conversation-pagination.ts";

async function waitForCondition<T>(
  probe: () => Promise<T | null | undefined> | T | null | undefined,
  predicate: (val: T) => boolean,
  timeoutMs = 7000,
  label = "condição assíncrona",
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const val = await probe();
    if (val !== null && val !== undefined && predicate(val)) {
      return val;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timeout aguardando ${label} após ${timeoutMs}ms`);
}

function makeMockGeminiProvider(
  handler: (ctx: AgentTurnContext) => Promise<AgentTurnResult> | AgentTurnResult,
): AIProviderClient {
  return {
    name: "gemini",
    async generateText(prompt, systemPrompt) {
      const res = await handler({
        model: "gemini-2.5-pro",
        systemPrompt: systemPrompt ?? "",
        messages: [{ role: "user", content: prompt }],
      });
      return res.text;
    },
    async executeTurn(ctx) {
      return await handler(ctx);
    },
    async streamTurn(ctx, onChunk) {
      const res = await handler(ctx);
      if (res.text) {
        onChunk({ type: "text_delta", tokenChunk: res.text });
      }
      onChunk({ type: "done" });
      return res;
    },
  };
}

describe("Fase 13 — Sub-tarefas Paralelas, Esperas Longas, Branches, Fila Granular, Pergunta Lateral, Reset & Pins", () => {
  let prevSkipProbe: string | undefined;
  let prevSkipAntigravity: string | undefined;
  const tempDirs: string[] = [];

  before(() => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    prevSkipAntigravity = process.env.CRIATIVO_SKIP_ANTIGRAVITY_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    process.env.CRIATIVO_SKIP_ANTIGRAVITY_PROBE = "1";
  });

  after(() => {
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    if (prevSkipAntigravity === undefined) delete process.env.CRIATIVO_SKIP_ANTIGRAVITY_PROBE;
    else process.env.CRIATIVO_SKIP_ANTIGRAVITY_PROBE = prevSkipAntigravity;

    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignora erros de limpeza temporária no Windows
      }
    }
  });

  function makeTempPaths(prefix: string): { tempDir: string; dbPath: string } {
    const tempDir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(tempDir);
    return { tempDir, dbPath: join(tempDir, "phase13-studio.db") };
  }

  async function bootRuntime(
    prefix: string,
    turnHandler: (ctx: AgentTurnContext) => Promise<AgentTurnResult> | AgentTurnResult,
  ): Promise<{ runtime: DaemonRuntime; baseUrl: string }> {
    const { tempDir, dbPath } = makeTempPaths(prefix);
    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    runtime.providers.registerCustomProvider("gemini", makeMockGeminiProvider(turnHandler));
    runtime.vault.setSecret("gemini_api_key", "fake-gemini-key-phase13-clean");
    runtime.db.connection
      .prepare(`UPDATE projecao_agentes SET modelo_padrao = 'gemini-2.5-pro' WHERE agente_id IN ('estrategista', 'copywriter', 'designer_carrossel');`)
      .run();
    return { runtime, baseUrl: `http://127.0.0.1:${runtime.port}` };
  }

  it("Teste 1: Migração DDL idempotente (D-01..D-08) e backfill de thread_id = main:<agente_id>", async () => {
    const { dbPath } = makeTempPaths("criativo-p13-ddl-");
    const db1 = new CriativoDatabase({ dbPath });
    db1.initializeDatabase();
    const now = new Date().toISOString();

    // Confirma existência das 4 novas tabelas Fase 13
    const tableNames = (
      db1.connection
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
            'projecao_agente_threads',
            'projecao_agente_esperas',
            'projecao_fila_chat',
            'projecao_mensagens_fixadas'
          );`,
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    assert.equal(tableNames.length, 4);

    // Insere mensagem legada com thread_id NULL para testar backfill ao reabrir banco
    db1.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, lida, criado_em, thread_id
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', NULL, 1, ?, NULL);`,
      )
      .run("msg-legado-1", "agente:estrategista", "estrategista", "usuario", "Você", "Mensagem legada", now);
    db1.close();

    // Reabre o banco pela 2a vez: migração deve ser idempotente e aplicar backfill
    const db2 = new CriativoDatabase({ dbPath });
    db2.initializeDatabase();
    const backfilled = db2.connection
      .prepare(`SELECT thread_id FROM projecao_conversas_chat WHERE mensagem_id = 'msg-legado-1';`)
      .get() as { thread_id: string | null } | undefined;
    assert.equal(backfilled?.thread_id, "main:estrategista");

    // Reexecução da 3a vez mantém consistência
    db2.close();
    const db3 = new CriativoDatabase({ dbPath });
    db3.initializeDatabase();
    const rechecked = db3.connection
      .prepare(`SELECT thread_id FROM projecao_conversas_chat WHERE mensagem_id = 'msg-legado-1';`)
      .get() as { thread_id: string | null } | undefined;
    assert.equal(rechecked?.thread_id, "main:estrategista");
    db3.close();
  });

  it("Teste 2: Sub-conversas paralelas, start_task (limites, SHA-256, isolamento WS e auto-arquivamento)", async () => {
    const { runtime, baseUrl } = await bootRuntime("criativo-p13-t2-", async (ctx) => ({
      text: `Execução paralela concluída (${ctx.messages.at(-1)?.content?.slice(0, 32) ?? "ok"})`,
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 18 },
    }));

    const receivedEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws`);

    try {
      await new Promise<void>((resolveOpen, rejectOpen) => {
        const timer = setTimeout(() => rejectOpen(new Error("Timeout WebSocket Teste 2")), 4000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolveOpen();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          rejectOpen(new Error("Erro WebSocket Teste 2"));
        };
      });

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as { event: string; data: Record<string, unknown> };
          receivedEvents.push(parsed);
        } catch {
          // ignora payload inválido
        }
      };

      const resMain = await executePhase13Tool(
        "start_task",
        { title: "Pesquisa Paralela [NOME_DA_MARCA]", brief: "Mapear referências de [NOME_DA_MARCA] em 3 pilares." },
        {
          agenteId: "estrategista",
          turnoId: "turn-t2-01",
          callId: "call-t2-01",
          threadId: null,
          canalId: null,
          entregaOrigemId: "ent-orig-1",
          pedidoTexto: "Briefing principal",
        },
        { tasksService: runtime.tasksService },
      );

      assert.equal(resMain.handled, true);
      const startedPayload = resMain.result as {
        taskId: string;
        threadId: string;
        title: string;
        note: string;
      };
      assert.ok(startedPayload.taskId);
      assert.ok(startedPayload.threadId);

      // Idempotência SHA-256 com o mesmo (agenteId, turnoId, callId)
      const resIdem = await executePhase13Tool(
        "start_task",
        { title: "Pesquisa Paralela [NOME_DA_MARCA]", brief: "Mapear referências de [NOME_DA_MARCA] em 3 pilares." },
        {
          agenteId: "estrategista",
          turnoId: "turn-t2-01",
          callId: "call-t2-01",
          threadId: null,
          canalId: null,
          entregaOrigemId: "ent-orig-1",
          pedidoTexto: "Briefing principal",
        },
        { tasksService: runtime.tasksService },
      );
      const idemPayload = resIdem.result as { threadId: string; note: string };
      assert.equal(idemPayload.threadId, startedPayload.threadId);
      assert.match(idemPayload.note, /idempotência/i);

      // Aguarda eventos WS exclusivos da thread e confirma ZERO vazamento em chat:message principal
      await waitForCondition(
        () => receivedEvents.filter((e) => e.event === "thread:message" && e.data.thread_id === startedPayload.threadId),
        (arr) => arr.length >= 2,
        7000,
        "thread:message da sub-tarefa paralela",
      );

      const leakedMain = receivedEvents.filter(
        (e) =>
          e.event === "chat:message" &&
          e.data.canal_id === "agente:estrategista" &&
          String((e.data.mensagem as { thread_id?: string | null })?.thread_id ?? "") === startedPayload.threadId,
      );
      assert.equal(leakedMain.length, 0);

      // Confirma histórico principal isolado via REST
      const mainMsgsRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens`);
      const mainMsgsJson = (await mainMsgsRes.json()) as { mensagens: Array<{ thread_id?: string | null }> };
      assert.equal(
        mainMsgsJson.mensagens.some((m) => m.thread_id === startedPayload.threadId),
        false,
      );

      // Recusa chamada recursiva dentro de sub-thread e dentro de canal de equipe
      const recSub = await executePhase13Tool(
        "start_task",
        { title: "Sub recursiva", brief: "Não deve permitir" },
        {
          agenteId: "estrategista",
          turnoId: "turn-rec-1",
          callId: "call-rec-1",
          threadId: startedPayload.threadId,
          canalId: null,
          entregaOrigemId: "ent-rec",
          pedidoTexto: "x",
        },
        { tasksService: runtime.tasksService },
      );
      assert.match(String((recSub.result as { erro?: string }).erro ?? ""), /sub-conversa|recurs/i);

      const recChannel = await executePhase13Tool(
        "start_task",
        { title: "Canal equipe", brief: "Não deve permitir" },
        {
          agenteId: "estrategista",
          turnoId: "turn-ch-1",
          callId: "call-ch-1",
          threadId: null,
          canalId: "canal-equipe-1",
          entregaOrigemId: "ent-ch",
          pedidoTexto: "x",
        },
        { tasksService: runtime.tasksService },
      );
      assert.match(String((recChannel.result as { erro?: string }).erro ?? ""), /canal em equipe|principal/i);

      // Testa limite de 8 tarefas inacabadas iniciadas pelo agente e auto-arquivamento de concluídas excedentes
      for (let i = 1; i <= 8; i++) {
        runtime.threadStore.createThread({
          threadId: `open-ag-${i}`,
          agenteId: "copywriter",
          origem: "agente",
          titulo: `Inacabada ${i}`,
          tituloOrigem: "auto",
          estado: "executando",
        });
      }
      const limitErr = await executePhase13Tool(
        "start_task",
        { title: "Nona tarefa", brief: "Deve bater teto 8" },
        {
          agenteId: "copywriter",
          turnoId: "turn-lim-9",
          callId: "call-lim-9",
          threadId: null,
          canalId: null,
          entregaOrigemId: "ent-lim",
          pedidoTexto: "x",
        },
        { tasksService: runtime.tasksService },
      );
      assert.match(String((limitErr.result as { erro?: string }).erro ?? ""), /8/);

      // Testa auto-arquivamento no designer_carrossel preservando usuario, branch e rotina
      const userThread = runtime.threadStore.createThread({
        threadId: "preservar-user",
        agenteId: "designer_carrossel",
        origem: "usuario",
        titulo: "Criada pelo usuário",
        tituloOrigem: "usuario",
        estado: "ociosa",
        desfecho: "concluida",
      });
      const branchThread = runtime.threadStore.createThread({
        threadId: "preservar-branch",
        agenteId: "designer_carrossel",
        origem: "agente",
        titulo: "Branch preservado",
        tituloOrigem: "auto",
        estado: "ociosa",
        desfecho: "concluida",
      });
      runtime.db.connection
        .prepare(
          `UPDATE projecao_agente_threads
           SET branch_origem_thread_id = 'main:designer_carrossel', branch_origem_mensagem_id = 'm0', branch_ate_mensagem_id = 'm0'
           WHERE thread_id = 'preservar-branch';`,
        )
        .run();
      const routineThread = runtime.threadStore.createThread({
        threadId: "preservar-rotina",
        agenteId: "designer_carrossel",
        origem: "agente",
        titulo: "Rotina preservada",
        tituloOrigem: "auto",
        estado: "ociosa",
        desfecho: "concluida",
        rotinaId: "rot-test-1",
      });

      const baseMs = Date.now() - 100_000;
      for (let i = 1; i <= 10; i++) {
        const ts = new Date(baseMs + i * 1000).toISOString();
        runtime.threadStore.createThread({
          threadId: `done-ag-${i}`,
          agenteId: "designer_carrossel",
          origem: "agente",
          titulo: `Concluída ${i}`,
          tituloOrigem: "auto",
          estado: "ociosa",
          desfecho: "concluida",
          bypassOpenLimit: true,
        });
        runtime.db.connection
          .prepare(`UPDATE projecao_agente_threads SET criado_em = ?, atualizado_em = ? WHERE thread_id = ?;`)
          .run(ts, ts, `done-ag-${i}`);
      }
      runtime.threadStore.archiveOldAgentFinishedThreads("designer_carrossel");

      const allAfterArchive = runtime.threadStore.listThreadsByAgent("designer_carrossel").threads;
      const archivedAgentDone = allAfterArchive.filter(
        (t) => t.thread_id.startsWith("done-ag-") && t.arquivada_em !== null,
      );
      const openAgentDone = allAfterArchive.filter(
        (t) => t.thread_id.startsWith("done-ag-") && t.arquivada_em === null,
      );
      assert.equal(openAgentDone.length, 8);
      assert.equal(archivedAgentDone.length, 2);
      assert.equal(runtime.threadStore.getThread(userThread.thread_id)?.arquivada_em, null);
      assert.equal(runtime.threadStore.getThread(branchThread.thread_id)?.arquivada_em, null);
      assert.equal(runtime.threadStore.getThread(routineThread.thread_id)?.arquivada_em, null);
    } finally {
      ws.close();
      await runtime.close();
    }
  });

  it("Teste 3: Ramificação (branch) transacional, idempotência request_id, remapeamento de reply, anexos e sobrevivência após exclusão", async () => {
    const { runtime, baseUrl } = await bootRuntime("criativo-p13-t3-", async () => ({
      text: "ok",
      toolCalls: [],
    }));

    try {
      // Cria sub-thread de origem com turnos encadeados e anexo
      const origemThread = runtime.threadStore.createThread({
        threadId: "origem-branch-1",
        agenteId: "estrategista",
        origem: "usuario",
        titulo: "Campanha Base [NOME_DA_MARCA]",
        tituloOrigem: "usuario",
        estado: "ociosa",
      });

      const now = Date.now();
      const anexos = [
        {
          arquivo_id: "arq-1",
          nome: "briefing.png",
          url: "/api/arquivos/raw/briefing.png",
          mime_type: "image/png",
        },
      ];
      const insertStmt = runtime.db.connection.prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, lida, criado_em,
          thread_id, turno_id, item_type, resposta_para_mensagem_id, ordinal
        ) VALUES (?, ?, 'estrategista', ?, ?, ?, ?, '[]', NULL, 1, ?, ?, ?, 'message', ?, ?);`,
      );
      insertStmt.run(
        "orig-m1",
        `thread:${origemThread.thread_id}`,
        "usuario",
        "Você",
        "Mensagem inicial da campanha",
        JSON.stringify(anexos),
        new Date(now + 10).toISOString(),
        origemThread.thread_id,
        "t-br-1",
        null,
        1,
      );
      insertStmt.run(
        "orig-m2",
        `thread:${origemThread.thread_id}`,
        "agente",
        "Estrategista",
        "Resposta ligada à inicial",
        "[]",
        new Date(now + 20).toISOString(),
        origemThread.thread_id,
        "t-br-1",
        "orig-m1",
        2,
      );
      insertStmt.run(
        "orig-m3",
        `thread:${origemThread.thread_id}`,
        "usuario",
        "Você",
        "Mensagem posterior que NÃO deve entrar no corte do branch",
        "[]",
        new Date(now + 30).toISOString(),
        origemThread.thread_id,
        "t-br-2",
        null,
        3,
      );

      // 1o POST de branch
      const reqPayload = {
        thread_id: origemThread.thread_id,
        mensagem_id: "orig-m2",
        request_id: "req-br-idem-001",
      };
      const brRes1 = await fetch(`${baseUrl}/api/agentes/estrategista/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqPayload),
      });
      assert.equal(brRes1.status, 201);
      const brJson1 = (await brRes1.json()) as {
        thread: {
          thread_id: string;
          origem: string;
          branch: { origem_thread_id: string; origem_mensagem_id: string; origem_titulo?: string | null };
        };
      };
      assert.equal(brJson1.thread.origem, "usuario");
      assert.ok(brJson1.thread.branch);
      assert.equal(brJson1.thread.branch.origem_thread_id, origemThread.thread_id);

      // 2o POST com mesmo request_id -> idempotente
      const brRes2 = await fetch(`${baseUrl}/api/agentes/estrategista/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqPayload),
      });
      const brJson2 = (await brRes2.json()) as { thread: { thread_id: string } };
      assert.equal(brJson2.thread.thread_id, brJson1.thread.thread_id);

      // Verifica mensagens clonadas, remapeamento de resposta_para_mensagem_id e anexo preservado
      const brMsgsRes = await fetch(`${baseUrl}/api/threads/${brJson1.thread.thread_id}/mensagens`);
      const brMsgsJson = (await brMsgsRes.json()) as {
        pagina: {
          mensagens: Array<{
            mensagem_id: string;
            conteudo_markdown: string;
            resposta_para_mensagem_id?: string | null;
            anexos: Array<{ nome: string }>;
            branch_origem_mensagem_id?: string | null;
          }>;
        };
      };
      const cloned = brMsgsJson.pagina.mensagens;
      assert.equal(cloned.length, 2);
      assert.notEqual(cloned[0].mensagem_id, "orig-m1");
      assert.equal(cloned[0].anexos[0]?.nome, "briefing.png");
      assert.equal(cloned[1].resposta_para_mensagem_id, cloned[0].mensagem_id);
      assert.equal(cloned[1].branch_origem_mensagem_id, "orig-m2");

      // Exclui thread de origem e verifica que branch sobrevive intacto com fallback de origem excluída
      const delRes = await fetch(`${baseUrl}/api/threads/${origemThread.thread_id}`, {
        method: "DELETE",
      });
      assert.equal(delRes.status, 200);

      const getBrAfter = await fetch(`${baseUrl}/api/threads/${brJson1.thread.thread_id}`);
      assert.equal(getBrAfter.status, 200);
      const afterJson = (await getBrAfter.json()) as {
        thread: { branch: { origem_excluida?: boolean; origem_thread_id: string } };
      };
      assert.equal(afterJson.thread.branch.origem_thread_id, origemThread.thread_id);
      assert.equal(afterJson.thread.branch.origem_excluida, true);
    } finally {
      await runtime.close();
    }
  });

  it("Teste 4: Esperas Longas (agent_waits), teto 20 + nearLimit 17 e despertar por Rotina + Webhook waitId", async () => {
    const { runtime, baseUrl } = await bootRuntime("criativo-p13-t4-", async () => ({
      text: "ok",
      toolCalls: [],
    }));

    try {
      const now = new Date().toISOString();
      // Insere rotina ativa para estrategista e webhook ativo
      runtime.db.connection
        .prepare(
          `INSERT INTO projecao_agente_rotinas (
            rotina_id, owner_kind, owner_id, nome, instrucao, ativa,
            timezone, trigger_kind, schedule_json, limit_policy, missed_policy,
            run_in, criado_em, atualizado_em
          ) VALUES (?, 'agente', 'estrategista', 'Checar Monitoramento', 'Verificar status externo', 1,
            'America/Sao_Paulo', 'webhook', NULL, 'wait', 'skip', 'chat', ?, ?);`,
        )
        .run("rot-wait-1", now, now);

      const rawToken = "wh-secret-phase13-token";
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      runtime.db.connection
        .prepare(
          `INSERT INTO projecao_webhooks (webhook_id, chave_secreta_hash, tipo_evento, ativo)
           VALUES ('wh-p13', ?, 'post_publicado', 1);`,
        )
        .run(tokenHash);

      const createdWaitIds: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const res = await executePhase13Tool(
          "await_event",
          { note: `Aguardar etapa externa ${i}`, routineId: "rot-wait-1" },
          {
            agenteId: "estrategista",
            turnoId: `turn-w-${i}`,
            callId: `call-w-${i}`,
            threadId: null,
            canalId: null,
            entregaOrigemId: `ent-w-${i}`,
            pedidoTexto: `Pedido original ${i}`,
          },
          { waitsService: runtime.waitsService },
        );
        const out = res.result as { waitId: string; openWaits: number; nearLimit?: boolean };
        createdWaitIds.push(out.waitId);
        if (i >= 17) {
          assert.equal(out.nearLimit, true);
        }
      }

      // 21a espera deve ser bloqueada atomicamente
      const blocked = await executePhase13Tool(
        "await_event",
        { note: "21a espera", routineId: "rot-wait-1" },
        {
          agenteId: "estrategista",
          turnoId: "turn-w-21",
          callId: "call-w-21",
          threadId: null,
          canalId: null,
          entregaOrigemId: "ent-w-21",
          pedidoTexto: "Excede limite",
        },
        { waitsService: runtime.waitsService },
      );
      assert.match(String((blocked.result as { erro?: string }).erro ?? ""), /20/);

      // Fecha todas as 20 esperas pelo tool close_wait e REST
      for (let i = 0; i < createdWaitIds.length; i++) {
        if (i < 10) {
          const closeRes = await executePhase13Tool(
            "close_wait",
            { waitId: createdWaitIds[i] },
            {
              agenteId: "estrategista",
              turnoId: "turn-close",
              callId: `c-${i}`,
              threadId: null,
              canalId: null,
              entregaOrigemId: "ent",
              pedidoTexto: "x",
            },
            { waitsService: runtime.waitsService },
          );
          assert.equal((closeRes.result as { closed: string }).closed, createdWaitIds[i]);
        } else {
          const del = await fetch(`${baseUrl}/api/agentes/estrategista/esperas/${createdWaitIds[i]}`, {
            method: "DELETE",
          });
          assert.equal(del.status, 200);
        }
      }

      // Abre espera limpa para testar disparo real de webhook com { waitId }
      const fresh = await executePhase13Tool(
        "await_event",
        { note: "Aprovar lote de criativos externos", routineId: "rot-wait-1" },
        {
          agenteId: "estrategista",
          turnoId: "turn-wh",
          callId: "call-wh",
          threadId: null,
          canalId: null,
          entregaOrigemId: "ent-orig-wh",
          pedidoTexto: "Publicar pacote após webhook de revisão",
        },
        { waitsService: runtime.waitsService },
      );
      const waitId = (fresh.result as { waitId: string }).waitId;

      const whRes = await fetch(`${baseUrl}/api/webhooks/disparo/${rawToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitId, status: "aprovado" }),
      });
      assert.equal(whRes.status, 202);

      const listRes = await fetch(`${baseUrl}/api/agentes/estrategista/esperas`);
      const listJson = (await listRes.json()) as {
        esperas: Array<{
          espera_id: string;
          despertada_em: string | null;
          estado?: string;
          pedido_texto: string;
          nota: string;
        }>;
      };
      const resumingWait = listJson.esperas.find((w) => w.espera_id === waitId);
      assert.ok(resumingWait);
      assert.ok(resumingWait.despertada_em !== null);
      assert.equal(resumingWait.estado, "resuming");

      runtime.waitsService.clearResuming("estrategista");
      const listAfterDoneRes = await fetch(`${baseUrl}/api/agentes/estrategista/esperas`);
      const listAfterDoneJson = (await listAfterDoneRes.json()) as {
        esperas: Array<{ espera_id: string; estado?: string }>;
      };
      const wokenWait = listAfterDoneJson.esperas.find((w) => w.espera_id === waitId);
      assert.equal(wokenWait?.estado, "woken");

      // Verifica também bloco formatado de wakeForRun
      const directWake = runtime.waitsService.wakeForRun({
        agenteId: "estrategista",
        waitId: undefined,
        rotinaId: "rot-wait-1",
        entregaDespertarId: "ent-desp-direct",
      });
      // wait já acordada não desperta duplicada; abrimos outra para conferir promptBlock
      const second = runtime.waitsService.openWaitFromTool(
        {
          agenteId: "estrategista",
          entregaOrigemId: "ent-orig-2",
          pedidoTexto: "Monitorar publicação agendada",
        },
        { note: "Validar permalink retorno", routineId: "rot-wait-1" },
      );
      const wake2 = runtime.waitsService.wakeForRun({
        agenteId: "estrategista",
        rotinaId: "rot-wait-1",
        entregaDespertarId: "ent-desp-2",
      });
      assert.equal(directWake.woken.length, 0);
      assert.equal(wake2.woken.length, 1);
      assert.equal(wake2.woken[0].espera_id, second.waitId);
      assert.match(wake2.promptBlock ?? "", /Monitorar publicação agendada/);
      assert.match(wake2.promptBlock ?? "", /Validar permalink retorno/);
    } finally {
      await runtime.close();
    }
  });

  it("Teste 5: Controle granular da fila (edit lock, 409 conflict, reorder, steer, mover-para-tarefa) e interrupt_agent", async () => {
    const { runtime, baseUrl } = await bootRuntime("criativo-p13-t5-", async () => ({
      text: "Resposta pós-fila",
      toolCalls: [],
    }));

    try {
      // Mantém a lane principal de estrategista ocupada por um turno ativo durante testes de manipulação da fila
      const laneHoldAbort = new AbortController();
      runtime.queueControls.registerActiveTurn({
        agenteId: "estrategista",
        threadId: null,
        turnoId: "t-hold-queue",
        deliveries: [],
        abortController: laneHoldAbort,
      });

      // Enfileira 2 entregas pendentes na lane principal de estrategista
      const e1 = runtime.queueControls.queueStore.enqueue({
        mensagemId: randomUUID(),
        agenteId: "estrategista",
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: "Entrega 1 original",
      });
      const e2 = runtime.queueControls.queueStore.enqueue({
        mensagemId: randomUUID(),
        agenteId: "estrategista",
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: "Entrega 2 segunda",
      });

      // Begin edit lock em e1
      const beginRes = await fetch(`${baseUrl}/api/agentes/estrategista/fila-chat/editar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: null,
          entrega_id: e1.entrega_id,
          acao: "begin",
          edit_id: "edit-lock-1",
        }),
      });
      assert.equal(beginRes.status, 200);

      // Enquanto e1 tem editando=1, dequeueNextForLane deve PULAR e1 e pegar apenas e2 (ou ignorar e1)
      const dequeued = runtime.queueControls.queueStore.dequeueNextForLane("estrategista", null);
      assert.equal(dequeued?.entrega_id, e2.entrega_id);
      runtime.queueControls.queueStore.markFinished(e2.entrega_id, "concluida");

      const e3 = runtime.queueControls.queueStore.enqueue({
        mensagemId: randomUUID(),
        agenteId: "estrategista",
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: "Entrega 3 terceira",
      });

      // Conflito 409 se tentar salvar e1 com edit_id incorreto
      const conflictRes = await fetch(`${baseUrl}/api/agentes/estrategista/fila-chat/editar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: null,
          entrega_id: e1.entrega_id,
          acao: "save",
          edit_id: "edit-errado",
          conteudo: "Não deve salvar",
        }),
      });
      assert.equal(conflictRes.status, 409);

      // Salva com edit_id válido
      const saveRes = await fetch(`${baseUrl}/api/agentes/estrategista/fila-chat/editar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: null,
          entrega_id: e1.entrega_id,
          acao: "save",
          edit_id: "edit-lock-1",
          conteudo: "Entrega 1 editada com anexo",
          anexos: [
            {
              arquivo_id: "arq-edit",
              nome: "guia.pdf",
              url: "/api/arquivos/raw/guia.pdf",
              mime_type: "application/pdf",
            },
          ],
        }),
      });
      assert.equal(saveRes.status, 200);
      const savedJson = (await saveRes.json()) as {
        snapshot: { entregas: Array<{ entrega_id: string; conteudo_markdown: string; editando: boolean }> };
      };
      const editedItem = savedJson.snapshot.entregas.find((x) => x.entrega_id === e1.entrega_id);
      assert.equal(editedItem?.editando, false);
      assert.equal(editedItem?.conteudo_markdown, "Entrega 1 editada com anexo");

      // Reordena fila colocando e3 antes de e1
      const reorderRes = await fetch(`${baseUrl}/api/agentes/estrategista/fila-chat/reordenar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: null,
          entrega_ids: [e3.entrega_id, e1.entrega_id],
        }),
      });
      assert.equal(reorderRes.status, 200);

      // Move e3 para nova tarefa paralela
      const moveRes = await fetch(`${baseUrl}/api/agentes/estrategista/fila-chat/mover-para-tarefa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: null, entrega_id: e3.entrega_id }),
      });
      assert.equal(moveRes.status, 201);
      const moveJson = (await moveRes.json()) as { thread: { thread_id: string; titulo: string } };
      assert.ok(moveJson.thread.thread_id);

      // Steer em e1 com provedor Gemini ativo
      const steerRes = await fetch(`${baseUrl}/api/agentes/estrategista/fila-chat/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: null, entrega_id: e1.entrega_id }),
      });
      assert.equal(steerRes.status, 200);
      runtime.queueControls.clearActiveTurn("estrategista", null, "t-hold-queue");

      // Testes de interrupt_agent:
      // 1) Bloqueia auto-interrupção
      const selfInt = await executePhase13Tool(
        "interrupt_agent",
        { agentId: "estrategista", reason: "Auto" },
        {
          agenteId: "estrategista",
          turnoId: "t-self",
          callId: "c-self",
          threadId: null,
          canalId: null,
          entregaOrigemId: "e-self",
          pedidoTexto: "x",
        },
        { queueControls: runtime.queueControls },
      );
      assert.match(String((selfInt.result as { erro?: string }).erro ?? ""), /si mesmo|próprio/i);

      // 2) Recusa interromper turno iniciado por usuário
      const userAbort = new AbortController();
      const userTurnDel = runtime.queueControls.queueStore.enqueue({
        mensagemId: randomUUID(),
        agenteId: "copywriter",
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: "Pedido direto do usuário",
      });
      runtime.queueControls.registerActiveTurn({
        agenteId: "copywriter",
        threadId: null,
        turnoId: "t-copy-user",
        deliveries: [userTurnDel],
        abortController: userAbort,
      });
      const intUserTurn = await executePhase13Tool(
        "interrupt_agent",
        { agentId: "copywriter", reason: "Tentativa" },
        {
          agenteId: "estrategista",
          turnoId: "t-e",
          callId: "c-e",
          threadId: null,
          canalId: null,
          entregaOrigemId: "e-e",
          pedidoTexto: "x",
        },
        { queueControls: runtime.queueControls },
      );
      assert.equal(userAbort.signal.aborted, false);
      assert.equal((intUserTurn.result as { interruptedTurnId?: string | null }).interruptedTurnId, null);
      runtime.queueControls.clearActiveTurn("copywriter", null, "t-copy-user");

      // 3) Permite interromper turno iniciado exclusivamente pelo agente chamador (estrategista -> designer_carrossel)
      const agentAbort = new AbortController();
      const agTurnDel = runtime.queueControls.queueStore.enqueue({
        mensagemId: randomUUID(),
        agenteId: "designer_carrossel",
        threadId: null,
        remetenteTipo: "agente",
        remetenteAgenteId: "estrategista",
        conteudoMarkdown: "Briefing delegado pelo estrategista",
      });
      runtime.queueControls.registerActiveTurn({
        agenteId: "designer_carrossel",
        threadId: null,
        turnoId: "t-des-ag",
        deliveries: [agTurnDel],
        abortController: agentAbort,
      });
      const intAgTurn = await executePhase13Tool(
        "interrupt_agent",
        { agentId: "designer_carrossel", reason: "Mudança de diretriz" },
        {
          agenteId: "estrategista",
          turnoId: "t-e2",
          callId: "c-e2",
          threadId: null,
          canalId: null,
          entregaOrigemId: "e-e2",
          pedidoTexto: "x",
        },
        { queueControls: runtime.queueControls },
      );
      assert.equal((intAgTurn.result as { interruptedTurnId?: string | null }).interruptedTurnId, "t-des-ag");
      assert.equal(agentAbort.signal.aborted, true);
    } finally {
      await runtime.close();
    }
  });

  it("Teste 6: Pergunta Lateral efêmera, start_new_chat, pin_message (teto 50 + proteção usuário), paginação 65 msgs & Crash Recovery", async () => {
    let lastSideToolsLen: number | undefined;
    const { runtime, baseUrl } = await bootRuntime("criativo-p13-t6-", async (ctx) => {
      lastSideToolsLen = ctx.tools?.length;
      return {
        text: "Resposta sintética ao lado sem gravar no histórico.",
        toolCalls: [],
      };
    });

    try {
      // 1. Paginação com 65 mensagens agrupadas em pares de turno (para não quebrar turno no meio)
      const insertMsg = runtime.db.connection.prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, lida, criado_em,
          thread_id, turno_id, item_type, ordinal
        ) VALUES (?, 'agente:estrategista', 'estrategista', ?, ?, ?, '[]', '[]', NULL, 1, ?, 'main:estrategista', ?, 'mensagem', ?);`,
      );
      const t0 = Date.now() - 200_000;
      for (let i = 1; i <= 65; i++) {
        const turno = `turno-p-${Math.ceil(i / 2)}`;
        insertMsg.run(
          `msg-pag-${i}`,
          i % 2 === 1 ? "usuario" : "agente",
          i % 2 === 1 ? "Você" : "Estrategista",
          `Conteúdo paginado ${i} [NOME_DA_MARCA]`,
          new Date(t0 + i * 500).toISOString(),
          turno,
          i,
        );
      }

      const reader = new ConversationPaginationReader(runtime.db);
      const page1 = reader.readPage({
        threadId: "main:estrategista",
        agenteId: "estrategista",
        limit: 20,
      });
      assert.equal(page1.has_older, true);
      assert.ok(page1.older_cursor);
      assert.ok(page1.mensagens.length >= 20);
      // Turno da primeira mensagem da page1 não pode estar cortado na fronteira
      const firstTurn = page1.mensagens[0]?.turno_id;
      const page2 = reader.readPage({
        threadId: "main:estrategista",
        agenteId: "estrategista",
        limit: 20,
        beforeCursor: page1.older_cursor,
      });
      assert.ok(page2.mensagens.length >= 20);
      assert.equal(
        page2.mensagens.some((m) => m.turno_id === firstTurn),
        false,
        "Não deve dividir o mesmo turno entre duas páginas",
      );

      const around = reader.readAround({
        threadId: "main:estrategista",
        agenteId: "estrategista",
        aroundMessageId: "msg-pag-10",
        limit: 15,
      });
      assert.ok(around.mensagens.some((m) => m.mensagem_id === "msg-pag-10"));

      // 2. Pergunta Lateral efêmera (tools: [] + ZERO inserção em projecao_conversas_chat)
      const countBeforeSide = (
        runtime.db.connection
          .prepare(`SELECT COUNT(*) AS c FROM projecao_conversas_chat WHERE agente_id = 'estrategista';`)
          .get() as { c: number }
      ).c;

      const sideRes = await fetch(`${baseUrl}/api/agentes/estrategista/pergunta-lateral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pergunta: "Qual o resumo rápido dessa campanha?",
          historico_lateral: [],
        }),
      });
      assert.equal(sideRes.status, 200);
      const sideJson = (await sideRes.json()) as { resposta: string };
      assert.match(sideJson.resposta, /Resposta sintética ao lado/);
      assert.equal(lastSideToolsLen, 0);

      const countAfterSide = (
        runtime.db.connection
          .prepare(`SELECT COUNT(*) AS c FROM projecao_conversas_chat WHERE agente_id = 'estrategista';`)
          .get() as { c: number }
      ).c;
      assert.equal(countAfterSide, countBeforeSide);

      // 3. Novo chat / Reset limpo de contexto mantendo histórico visual 100% preservado
      const resetRes = await fetch(`${baseUrl}/api/agentes/estrategista/novo-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forcar: true }),
      });
      assert.equal(resetRes.status, 200);
      const resetJson = (await resetRes.json()) as {
        cutoff_at: string;
        mensagem_divisor: { item_type?: string };
      };
      assert.equal(resetJson.mensagem_divisor.item_type, "context_reset");
      assert.equal(readAgentContextCutoffAt(runtime.db, "estrategista"), resetJson.cutoff_at);

      // Histórico visual na UI mantém todas as 65 mensagens + marcador
      const fullVisualRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens?limit=100`);
      const fullVisualJson = (await fullVisualRes.json()) as {
        mensagens: Array<{ mensagem_id: string; item_type?: string }>;
      };
      assert.equal(fullVisualJson.mensagens.some((m) => m.mensagem_id === "msg-pag-1"), true);
      assert.equal(fullVisualJson.mensagens.some((m) => m.item_type === "context_reset"), true);

      // 4. Pin Message: teto 50 + proteção de pin de usuário contra unpin pelo agente
      const userPinRes = await fetch(`${baseUrl}/api/agentes/estrategista/pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: "main:estrategista", mensagem_id: "msg-pag-1" }),
      });
      assert.equal(userPinRes.status, 201);

      const unpinUserByAgent = await executePhase13Tool(
        "pin_message",
        { pinned: false },
        {
          agenteId: "estrategista",
          turnoId: "turno-p-1",
          callId: "c-pin-unpin",
          threadId: "main:estrategista",
          canalId: null,
          entregaOrigemId: "e-pin",
          pedidoTexto: "x",
        },
        { pinsService: runtime.pinsService },
      );
      // Como msg-pag-1 pertence ao usuário, agente não pode desafixá-la
      assert.match(
        String((unpinUserByAgent.result as { erro?: string }).erro ?? ""),
        /usuário|proteg|permit/i,
      );

      for (let p = 2; p <= 50; p++) {
        runtime.pinsService.pinMessage({
          agenteId: "estrategista",
          threadId: "main:estrategista",
          mensagemId: `msg-pag-${p}`,
          actorTipo: "agente",
          actorId: "estrategista",
        });
      }
      assert.throws(
        () =>
          runtime.pinsService.pinMessage({
            agenteId: "estrategista",
            threadId: "main:estrategista",
            mensagemId: "msg-pag-51",
            actorTipo: "agente",
          }),
        /50/,
      );

      // 5. Crash Recovery preserva esperas abertas e recupera threads/entregas interrompidas
      runtime.threadStore.createThread({
        threadId: "th-crash-1",
        agenteId: "estrategista",
        origem: "usuario",
        titulo: "Thread em curso antes do crash",
        tituloOrigem: "usuario",
        estado: "executando",
      });
      const entCrash = runtime.queueControls.queueStore.enqueue({
        mensagemId: randomUUID(),
        agenteId: "estrategista",
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: "Entrega presa durante crash",
      });
      runtime.db.connection
        .prepare(`UPDATE projecao_fila_chat SET status = 'executando', editando = 1 WHERE entrega_id = ?;`)
        .run(entCrash.entrega_id);

      const nowCrash = new Date().toISOString();
      runtime.db.connection
        .prepare(
          `INSERT INTO projecao_agente_rotinas (
            rotina_id, owner_kind, owner_id, nome, instrucao, ativa,
            timezone, trigger_kind, schedule_json, limit_policy, missed_policy,
            run_in, criado_em, atualizado_em
          ) VALUES (?, 'agente', 'estrategista', 'Rotina Crash Recovery', 'Verificar após crash', 1,
            'America/Sao_Paulo', 'webhook', NULL, 'wait', 'skip', 'chat', ?, ?);`,
        )
        .run("rot-crash-1", nowCrash, nowCrash);

      const esperaAntes = runtime.waitsService.openWaitFromTool(
        {
          agenteId: "estrategista",
          entregaOrigemId: "ent-orig-c",
          pedidoTexto: "Sobreviver ao crash recovery",
        },
        { note: "Não pode sumir", routineId: "rot-crash-1" },
      );

      const report = recoverInterruptedTasks(runtime.db);
      assert.ok((report.threadsInterrompidas ?? 0) >= 1);
      assert.ok((report.entregasFilaInterrompidas ?? 0) >= 1);

      const thAfter = runtime.threadStore.getThread("th-crash-1");
      assert.equal(thAfter?.desfecho, "interrompida");
      const entAfter = runtime.queueControls.queueStore.getDelivery(entCrash.entrega_id);
      assert.equal(entAfter?.editando, false);
      const waitsAfter = runtime.waitsService.listWaitsForUi("estrategista");
      assert.equal(waitsAfter.some((w) => w.espera_id === esperaAntes.waitId), true);
    } finally {
      await runtime.close();
    }
  });
});
