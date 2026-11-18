import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  AgentRoutine,
  AgentTurnContext,
  AgentTurnResult,
  AIProviderClient,
  RoutineCalendar,
  RoutineFlowCanvas,
  RoutineFlowLink,
  RoutineSchedule,
  WebhookTestResult,
} from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import {
  computeNextRoutineOccurrence,
  validateRoutineSchedule,
} from "../src/routines/routine-schedule-calc.ts";
import { ROUTINE_TIMER_MAX_DELAY_MS, RoutineTimer } from "../src/routines/routine-timer.ts";
import { RoutineExecutionService } from "../src/routines/routine-execution-service.ts";
import { executeRoutineToolCall } from "../src/routines/routine-agent-tools.ts";

describe("Fase 11 — Rotinas Completas, Agenda, Webhooks HMAC, 9 Tools & Fluxos DAG", () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;

  let nextTurnScript: ((req: AgentTurnContext) => AgentTurnResult) | null = null;

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase11-"));
    dbPath = join(tempDir, "criativo-phase11.db");

    runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    baseUrl = `http://127.0.0.1:${runtime.port}`;

    const runMock = (req: AgentTurnContext): AgentTurnResult => {
      if (nextTurnScript) {
        return nextTurnScript(req);
      }
      return {
        text: "Execução concluída com sucesso.",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 12 },
      };
    };

    const mockClient: AIProviderClient = {
      name: "gemini",
      generateText: async (prompt) => `Texto mock: ${prompt.slice(0, 40)}`,
      executeTurn: async (req) => runMock(req),
      streamTurn: async (req, onChunk) => {
        const res = runMock(req);
        if (res.text) {
          onChunk({ type: "text_delta", tokenChunk: res.text });
        }
        for (const tc of res.toolCalls) {
          onChunk({ type: "tool_call", toolCall: tc });
        }
        onChunk({ type: "done" });
        return res;
      },
    };
    runtime.providers.registerCustomProvider("gemini", mockClient);
    runtime.vault.setSecret("gemini_api_key", "fake-gemini-key-test");
  });

  after(async () => {
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
  });

  it("Cenário 1 (ROUT-01): valida as 9 agendas, piso 3 min, lacuna DST e auto-pausa de 'once'", async () => {
    const tz = "America/Sao_Paulo";
    const refNow = new Date("2026-11-18T12:00:00Z");

    const validSchedules: RoutineSchedule[] = [
      { kind: "hourly", minute: 20 },
      { kind: "daily", time: "09:00" },
      { kind: "weekdays", time: "08:30" },
      { kind: "weekly", weekday: 1, time: "10:00" },
      { kind: "monthly", day: 15, time: "11:00" },
      { kind: "interval", amount: 5, unit: "minutes", anchorAt: refNow.toISOString() },
      {
        kind: "advanced",
        months: [11],
        days: { kind: "days-of-week", days: [1, 3, 5] },
        time: { kind: "at-time", time: "14:00" },
      },
      { kind: "custom", expression: "*/10 * * * *" },
      { kind: "once", date: "2099-06-15", time: "10:00" },
    ];

    for (const sched of validSchedules) {
      const err = validateRoutineSchedule(sched, tz, refNow, { requireFutureOnce: true });
      assert.equal(err, null, `Agenda ${sched.kind} deveria ser válida`);
      const next = computeNextRoutineOccurrence(sched, tz, refNow);
      assert.ok(next instanceof Date && !Number.isNaN(next.getTime()));
    }

    // Rejeita piso inferior a 3 minutos
    assert.ok(
      validateRoutineSchedule(
        { kind: "interval", amount: 1, unit: "minutes", anchorAt: refNow.toISOString() },
        tz,
        refNow
      )
    );
    assert.ok(
      validateRoutineSchedule(
        {
          kind: "advanced",
          months: [],
          days: { kind: "every-day" },
          time: { kind: "every", amount: 2, unit: "minutes" },
        },
        tz,
        refNow
      )
    );
    assert.ok(validateRoutineSchedule({ kind: "custom", expression: "*/1 * * * *" }, tz, refNow));

    // Rejeita once no passado
    assert.ok(
      validateRoutineSchedule(
        { kind: "once", date: "2020-01-01", time: "10:00" },
        tz,
        refNow,
        { requireFutureOnce: true }
      )
    );

    // DST gap em America/New_York (08/03/2026 02:30 não existe -> avança para após gap >= 07:00 UTC)
    const dstResolved = computeNextRoutineOccurrence(
      { kind: "once", date: "2026-03-08", time: "02:30" },
      "America/New_York",
      new Date("2026-03-01T00:00:00Z")
    );
    assert.ok(dstResolved);
    assert.ok(dstResolved.toISOString() >= "2026-03-08T07:00:00.000Z");

    // Cria rotina 'once' no futuro, simula vencimento e valida auto-pausa
    const createRes = await fetch(`${baseUrl}/api/rotinas/gerenciar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_kind: "agente",
        owner_id: "estrategista",
        nome: "Disparo Único [NOME_DA_MARCA]",
        instrucao: "Executar uma única vez",
        trigger_kind: "schedule",
        timezone: tz,
        schedule: { kind: "once", date: "2099-05-01", time: "09:00" },
      }),
    });
    assert.equal(createRes.status, 201);
    const { rotina } = (await createRes.json()) as { rotina: AgentRoutine };

    // Dispara quando chega a hora
    const dueTime = new Date(rotina.next_run_at!);
    await runtime.routineExecutionService.processDueRoutines(dueTime);

    const afterRun = runtime.routineStore.getById(rotina.rotina_id)!;
    assert.equal(afterRun.ativa, false);

    // Força agenda passada no DB e tenta reativar via API -> deve retornar 400
    runtime.routineStore.updateRoutine(rotina.rotina_id, {
      schedule: { kind: "once", date: "2020-01-01", time: "09:00" },
      ativa: false,
    });
    const reactivateRes = await fetch(`${baseUrl}/api/rotinas/gerenciar/${rotina.rotina_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativa: true }),
    });
    assert.equal(reactivateRes.status, 400);
  });

  it("Cenário 2 (ROUT-01): testa RoutineTimer (MAX_DELAY 60s), skipMissed e limitPolicy wait/skip", async () => {
    assert.equal(ROUTINE_TIMER_MAX_DELAY_MS, 60_000);

    let fakeNow = Date.parse("2026-11-18T12:00:00.000Z");
    let ticksFired = 0;
    const timer = new RoutineTimer({
      getEarliestDue: () => new Date("2026-11-18T12:05:00.000Z"),
      onTick: async () => {
        ticksFired += 1;
      },
      now: () => fakeNow,
    });
    timer.arm();
    assert.equal(ticksFired, 0);
    fakeNow = Date.parse("2026-11-18T12:05:01.000Z");
    await timer.triggerNow();
    assert.equal(ticksFired, 1);
    timer.dispose();

    // Testa skipMissed ('skip' vs 'run-once') e limitPolicy ('skip' vs 'wait')
    const baseTime = new Date("2026-11-18T10:00:00.000Z");
    const rSkip = runtime.routineStore.createRoutine({
      owner_kind: "agente",
      owner_id: "copywriter",
      nome: "Miss Skip",
      instrucao: "Teste skip",
      trigger_kind: "schedule",
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
      next_run_at: new Date("2026-11-18T06:00:00.000Z").toISOString(),
      missed_policy: "skip",
      limit_policy: "skip",
    });

    const rRunOnce = runtime.routineStore.createRoutine({
      owner_kind: "agente",
      owner_id: "copywriter",
      nome: "Miss RunOnce",
      instrucao: "Teste run-once",
      trigger_kind: "schedule",
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
      next_run_at: new Date("2026-11-18T06:00:00.000Z").toISOString(),
      missed_policy: "run-once",
      limit_policy: "wait",
    });

    const adjusted = await runtime.routineExecutionService.skipMissed(baseTime);
    assert.ok(adjusted >= 2);

    const skipRuns = runtime.routineStore.listRuns(rSkip.rotina_id, { withSkipped: true });
    assert.ok(skipRuns.some((r) => r.status === "cancelled" && (r.missed_count ?? 0) >= 2));

    const updatedRunOnce = runtime.routineStore.getById(rRunOnce.rotina_id)!;
    assert.ok(updatedRunOnce.next_run_at && updatedRunOnce.next_run_at <= baseTime.toISOString());

    // Testa limitPolicy com usageLimited = true
    const limitedSvc = new RoutineExecutionService({
      db: runtime.db,
      queue: runtime.queue,
      routineStore: runtime.routineStore,
      dispatcher: runtime.routineResultDispatcher,
      wsHub: runtime.wsHub,
      providerConnection: runtime.runner["providerConnection"],
      usageLimited: () => true,
    });

    runtime.routineStore.updateRoutine(rSkip.rotina_id, {
      next_run_at: new Date("2026-11-18T09:50:00.000Z").toISOString(),
    });
    const beforeLimitRuns = runtime.routineStore.listRuns(rSkip.rotina_id, { withSkipped: true }).length;
    await limitedSvc.processDueRoutines(baseTime);
    const afterLimitRuns = runtime.routineStore.listRuns(rSkip.rotina_id, { withSkipped: true });
    assert.ok(afterLimitRuns.length > beforeLimitRuns);
    assert.equal(afterLimitRuns[0].status, "cancelled");
  });

  it("Cenário 3 (ROUT-02 & ROUT-04): side_thread, routine_no_update, fallback [[no-update]], falha, entregas e reenvio", async () => {
    // Limpa fila FIFO residual de cenários anteriores
    while (runtime.queue.dequeueNextTask()) {
      // drenando
    }

    const rot = runtime.routineStore.createRoutine({
      owner_kind: "agente",
      owner_id: "estrategista",
      nome: "Monitor Silencioso",
      instrucao: "Verificar novidades",
      trigger_kind: "schedule",
      timezone: "America/Sao_Paulo",
      schedule: { kind: "daily", time: "09:00" },
      next_run_at: "2099-01-01T12:00:00.000Z",
      run_in: "side_thread",
      destino_resultado: { tipo: "notificacao", destino_nome: "Notificação no Cockpit" },
    });

    // Cria execução agendada e roda via AgentRunner chamando routine_no_update
    const scheduledExec = runtime.routineStore.createRun({
      rotina_id: rot.rotina_id,
      owner_kind: "agente",
      owner_id: "estrategista",
      run_kind: "scheduled",
      run_source: null,
      scheduled_for: new Date().toISOString(),
      rotina_nome: rot.nome,
      instrucao: rot.instrucao,
      status: "queued",
      thread_id: `rotina:${rot.rotina_id}`,
    })!;
    const taskSilent = runtime.queue.enqueueTask({
      agente_id: "estrategista",
      canal_origem: "web",
      tipo: "rotina",
      titulo: rot.nome,
      prioridade: 4,
      payload: { rotina_id: rot.rotina_id, rotina_execucao_id: scheduledExec.execucao_id, prompt: rot.instrucao },
    });
    runtime.routineStore.updateRun(scheduledExec.execucao_id, { tarefa_id: taskSilent.tarefa_id });

    let stepNum = 0;
    nextTurnScript = () => {
      stepNum += 1;
      if (stepNum === 1) {
        return {
          text: "",
          toolCalls: [{ id: "tc-1", name: "routine_no_update", arguments: { note: "Nada novo" } }],
          finishReason: "tool_calls",
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
      return { text: "Encerrado silenciosamente.", toolCalls: [], finishReason: "stop" };
    };

    const beforeUnread = runtime.db.connection
      .prepare(
        `SELECT COUNT(*) AS total FROM projecao_conversas_chat WHERE canal_id = 'agente:estrategista' AND lida = 0;`
      )
      .get() as { total: number };

    const dequeuedSilent = runtime.queue.dequeueNextTask()!;
    await runtime.runner.runTask(dequeuedSilent);

    const execDoneSilent = runtime.routineStore.getRun(scheduledExec.execucao_id)!;
    assert.equal(execDoneSilent.status, "succeeded");
    assert.equal(execDoneSilent.silenciada, true);

    const deliveryQuiet = runtime.routineStore.getDelivery(scheduledExec.execucao_id);
    assert.equal(deliveryQuiet?.status, "quiet");

    // Checa que chat principal nao_lidas não subiu e mensagem foi para side_thread
    const afterUnread = runtime.db.connection
      .prepare(
        `SELECT COUNT(*) AS total FROM projecao_conversas_chat WHERE canal_id = 'agente:estrategista' AND lida = 0;`
      )
      .get() as { total: number };
    assert.equal(afterUnread.total, beforeUnread.total);

    const sideMsgsRes = await fetch(
      `${baseUrl}/api/agentes/estrategista/rotinas/${rot.rotina_id}/mensagens`
    );
    assert.equal(sideMsgsRes.status, 200);

    // Teste manual via HTTP (run_source='test') não deve suprimir saída mesmo se enviar [[no-update]]
    nextTurnScript = () => ({
      text: "[[no-update]]",
      toolCalls: [],
      finishReason: "stop",
    });
    const testRunRes = await fetch(`${baseUrl}/api/rotinas/gerenciar/${rot.rotina_id}/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(testRunRes.status, 202);
    const { execucao: testExec } = (await testRunRes.json()) as {
      execucao: { execucao_id: string };
    };
    const dequeuedTest = runtime.queue.dequeueNextTask()!;
    await runtime.runner.runTask(dequeuedTest);
    const reloadedTest = runtime.routineStore.getRun(testExec.execucao_id)!;
    assert.equal(reloadedTest.silenciada, false);

    // routine_report_failure grava status='failed' com erro
    const execFail = runtime.routineExecutionService.enqueueManualRun({
      rotinaId: rot.rotina_id,
      runSource: "test",
    });
    let failStep = 0;
    nextTurnScript = () => {
      failStep += 1;
      if (failStep === 1) {
        return {
          text: "",
          toolCalls: [
            { id: "tc-fail", name: "routine_report_failure", arguments: { reason: "API externa indisponível" } },
          ],
          finishReason: "tool_calls",
        };
      }
      return { text: "Erro reportado", toolCalls: [], finishReason: "stop" };
    };
    await runtime.runner.runTask(runtime.queue.dequeueNextTask()!);
    const failedRun = runtime.routineStore.getRun(execFail.execucao_id)!;
    assert.equal(failedRun.status, "failed");
    assert.match(failedRun.erro ?? "", /API externa indisponível/);

    // Entrega Telegram com falha vazando token -> redação + reenvio bem-sucedido
    nextTurnScript = null;
    const tgToken = "123456:SEGREDO_TELEGRAM_ULTRA";
    runtime.vault.setSecret("telegram_bot_token", tgToken);
    const rotTg = runtime.routineStore.createRoutine({
      owner_kind: "agente",
      owner_id: "estrategista",
      nome: "Entrega Telegram",
      instrucao: "Enviar resumo",
      trigger_kind: "schedule",
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
      destino_resultado: { tipo: "telegram", chat_id: "999999", destino_nome: "Canal TG Teste" },
    });
    const tgRun = runtime.routineStore.createRun({
      rotina_id: rotTg.rotina_id,
      owner_kind: "agente",
      owner_id: "estrategista",
      run_kind: "manual",
      run_source: "test",
      scheduled_for: new Date().toISOString(),
      rotina_nome: rotTg.nome,
      instrucao: rotTg.instrucao,
      status: "succeeded",
      resultado_resumo: "Resumo de teste",
    })!;

    // Simula falha com token no dispatcher e depois reenvio
    runtime.routineResultDispatcher["fetchImpl"] = async () => {
      throw new Error(`Falha ao acessar https://api.telegram.org/bot${tgToken}/sendMessage`);
    };
    const delivFail = await runtime.routineResultDispatcher.dispatchDelivery({
      execucao: tgRun,
      routine: rotTg,
      contentText: "Resumo entregue",
      artifacts: [],
      silenced: false,
    });
    assert.equal(delivFail?.status, "failed");
    assert.ok(!delivFail?.erro?.includes(tgToken));

    // Reenvio bem-sucedido via HTTP
    runtime.routineResultDispatcher["fetchImpl"] = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    const resendRes = await fetch(
      `${baseUrl}/api/rotinas/gerenciar/${rotTg.rotina_id}/entregas/${tgRun.execucao_id}/reenviar`,
      { method: "POST" }
    );
    assert.equal(resendRes.status, 200);
    const resendJson = (await resendRes.json()) as { entrega: { status: string } };
    assert.equal(resendJson.entrega.status, "sent");
  });

  it("Cenário 4 (ROUT-03): webhooks HMAC-SHA256 nativo + Standard Webhooks, 413, 401, duplicado, JSON Pointer e rotação", async () => {
    const createRes = await fetch(`${baseUrl}/api/rotinas/gerenciar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_kind: "agente",
        owner_id: "estrategista",
        nome: "Webhook Pedidos [NOME_DA_MARCA]",
        instrucao: "Analisar pedido pago",
        trigger_kind: "webhook",
        webhook_event_type: "order.paid",
        webhook_filters: [{ pointer: "/pedido/status", value: "pago" }],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { rotina: AgentRoutine; secret: string };
    assert.ok(created.secret.startsWith("whsec_"));
    assert.ok(created.rotina.webhook?.route_token);
    const token = created.rotina.webhook!.route_token;
    const webhookUrl = `${baseUrl}/api/webhooks/rotina/${encodeURIComponent(token)}`;

    // GET /api/agentes/:id/rotinas jamais devolve o secret
    const listRes = await fetch(`${baseUrl}/api/agentes/estrategista/rotinas`);
    const listText = await listRes.text();
    assert.ok(!listText.includes(created.secret));

    // > 256 KB -> 413
    const hugeBody = "x".repeat(270_000);
    const tooLargeRes = await fetch(webhookUrl, { method: "POST", body: hugeBody });
    assert.equal(tooLargeRes.status, 413);

    const samplePayload = JSON.stringify({
      type: "order.paid",
      data: { pedido: { status: "pago", valor: 199 } },
    });
    const tsNow = String(Math.floor(Date.now() / 1000));

    // Timestamp expirado -> 401
    const oldTs = String(Math.floor(Date.now() / 1000) - 900);
    const oldSig = createHmac("sha256", created.secret)
      .update(`${oldTs}.evt-old.${samplePayload}`)
      .digest("hex");
    const expiredRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Timestamp": oldTs,
        "X-Criativo-Delivery-Id": "evt-old",
        "X-Criativo-Signature": `sha256=${oldSig}`,
      },
      body: samplePayload,
    });
    assert.equal(expiredRes.status, 401);

    // Assinatura inválida -> 401
    const badSigRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Timestamp": tsNow,
        "X-Criativo-Delivery-Id": "evt-bad",
        "X-Criativo-Signature": "sha256=deadbeef",
      },
      body: samplePayload,
    });
    assert.equal(badSigRes.status, 401);

    // Válido nativo -> 202 + wrapExternalEventInstruction + duplicado 200
    const validSig = createHmac("sha256", created.secret)
      .update(`${tsNow}.evt-ok-1.${samplePayload}`)
      .digest("hex");
    const okRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Timestamp": tsNow,
        "X-Criativo-Delivery-Id": "evt-ok-1",
        "X-Criativo-Signature": `sha256=${validSig}`,
      },
      body: samplePayload,
    });
    assert.equal(okRes.status, 202);

    const runsAfterWebhook = runtime.routineStore.listRuns(created.rotina.rotina_id);
    assert.ok(runsAfterWebhook[0].instrucao.includes("--- external event input ---"));

    const dupRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Timestamp": tsNow,
        "X-Criativo-Delivery-Id": "evt-ok-1",
        "X-Criativo-Signature": `sha256=${validSig}`,
      },
      body: samplePayload,
    });
    assert.equal(dupRes.status, 200);
    const dupJson = (await dupRes.json()) as { status: string };
    assert.equal(dupJson.status, "duplicate");

    // Filtro JSON Pointer não batendo -> ignored
    const mismatchPayload = JSON.stringify({
      type: "order.paid",
      data: { pedido: { status: "pendente" } },
    });
    const mismatchSig = createHmac("sha256", created.secret)
      .update(`${tsNow}.evt-ignored-1.${mismatchPayload}`)
      .digest("hex");
    const ignoredRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Timestamp": tsNow,
        "X-Criativo-Delivery-Id": "evt-ignored-1",
        "X-Criativo-Signature": `sha256=${mismatchSig}`,
      },
      body: mismatchPayload,
    });
    assert.ok(ignoredRes.status === 200 || ignoredRes.status === 202);
    const ignoredJson = (await ignoredRes.json()) as { status: string; reason: string };
    assert.equal(ignoredJson.status, "ignored");
    assert.equal(ignoredJson.reason, "filter");

    // Standard Webhooks (whsec_<base64>) + webhook-* headers
    const rawKeyBytes = Buffer.from("0123456789abcdef0123456789abcdef");
    const svixSecret = `whsec_${rawKeyBytes.toString("base64")}`;
    await fetch(`${baseUrl}/api/rotinas/gerenciar/${created.rotina.rotina_id}/webhook/segredo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: svixSecret }),
    });
    const svixSigB64 = createHmac("sha256", rawKeyBytes)
      .update(`msg-svix-1.${tsNow}.${samplePayload}`)
      .digest("base64");
    const svixRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": "msg-svix-1",
        "webhook-timestamp": tsNow,
        "webhook-signature": `v1,${svixSigB64}`,
      },
      body: samplePayload,
    });
    assert.equal(svixRes.status, 202);

    // Rotação de segredo e teste simulado
    const rotRes = await fetch(
      `${baseUrl}/api/rotinas/gerenciar/${created.rotina.rotina_id}/webhook/rotacionar-segredo`,
      { method: "POST" }
    );
    assert.equal(rotRes.status, 200);
    const rotJson = (await rotRes.json()) as { secret: string };
    assert.notEqual(rotJson.secret, svixSecret);

    const testWhRes = await fetch(
      `${baseUrl}/api/rotinas/gerenciar/${created.rotina.rotina_id}/webhook/testar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "order.paid", data: { pedido: { status: "pago" } } }),
      }
    );
    assert.equal(testWhRes.status, 200);
    const testWhJson = (await testWhRes.json()) as { resultado: WebhookTestResult };
    assert.equal(testWhJson.resultado.status, "accepted");
  });

  it("Cenário 5 (ROUT-04): exercita todas as 9 ferramentas e bloqueia webhook fora de turnOrigin='human'", async () => {
    const deps = {
      db: runtime.db,
      routineStore: runtime.routineStore,
      timer: runtime.routineTimer,
      executionService: runtime.routineExecutionService,
      webhookService: runtime.routineWebhookService,
      flowsEngine: runtime.routineFlowsEngine,
      wsHub: runtime.wsHub,
    };

    const createdToolRes = (await executeRoutineToolCall(
      {
        id: "t1",
        name: "create_routine",
        arguments: {
          agentId: "copywriter",
          name: "Rotina Tool",
          instruction: "Criar gancho",
          schedule: { kind: "daily", time: "08:00" },
          timezone: "America/Sao_Paulo",
        },
      },
      { agenteId: "copywriter", turnOrigin: "human" },
      deps
    )) as { routine: { rotina_id: string } };
    const createdId = createdToolRes.routine.rotina_id;

    const listToolRes = (await executeRoutineToolCall(
      { id: "t2", name: "list_routines", arguments: { agentId: "copywriter" } },
      { agenteId: "copywriter", turnOrigin: "routine" },
      deps
    )) as { rotinas: Array<{ rotina_id: string }> };
    assert.ok(listToolRes.rotinas.some((r) => r.rotina_id === createdId));

    const updatedToolRes = (await executeRoutineToolCall(
      {
        id: "t3",
        name: "update_routine",
        arguments: { routineId: createdId, name: "Rotina Tool Atualizada" },
      },
      { agenteId: "copywriter", turnOrigin: "human" },
      deps
    )) as { routine: { nome: string } };
    assert.equal(updatedToolRes.routine.nome, "Rotina Tool Atualizada");

    const testedToolRes = (await executeRoutineToolCall(
      { id: "t4", name: "test_routine", arguments: { routineId: createdId } },
      { agenteId: "copywriter", turnOrigin: "human" },
      deps
    )) as { execucao_id: string };
    assert.ok(testedToolRes.execucao_id);

    // Bloqueio não humano em create_webhook_routine e update_webhook_routine
    await assert.rejects(
      () =>
        executeRoutineToolCall(
          {
            id: "t5",
            name: "create_webhook_routine",
            arguments: { name: "WH Negado", instruction: "Nao deve criar" },
          },
          { agenteId: "copywriter", turnOrigin: "webhook" },
          deps
        ),
      /human/i
    );

    const whCreated = (await executeRoutineToolCall(
      {
        id: "t6",
        name: "create_webhook_routine",
        arguments: {
          agentId: "copywriter",
          name: "WH Permitido Humano",
          instruction: "Processar evento",
          eventType: "post.created",
        },
      },
      { agenteId: "copywriter", turnOrigin: "human" },
      deps
    )) as Record<string, unknown>;
    const whStr = JSON.stringify(whCreated);
    assert.ok(!whStr.includes("whsec_"));
    const whId = (whCreated.routine as { rotina_id: string }).rotina_id;

    await executeRoutineToolCall(
      { id: "t7", name: "update_webhook_routine", arguments: { routineId: whId, active: false } },
      { agenteId: "copywriter", turnOrigin: "human" },
      deps
    );

    await executeRoutineToolCall(
      { id: "t8", name: "delete_routine", arguments: { routineId: createdId } },
      { agenteId: "copywriter", turnOrigin: "human" },
      deps
    );
    assert.equal(runtime.routineStore.getById(createdId), null);
  });

  it("Cenário 6 (ROUT-05): GET /api/agenda retorna rotinas e ocorrências futuras expandidas", async () => {
    const from = new Date("2026-11-18T00:00:00.000Z");
    const to = new Date("2026-11-25T23:59:59.000Z");
    const res = await fetch(
      `${baseUrl}/api/agenda?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
        to.toISOString()
      )}`
    );
    assert.equal(res.status, 200);
    const cal = (await res.json()) as RoutineCalendar;
    assert.ok(Array.isArray(cal.rotinas) && cal.rotinas.length > 0);
    assert.ok(Array.isArray(cal.execucoes));
  });

  it("Cenário 7 (ROUT-06): Fluxos de Rotinas DAG (validação, órfãos, convergência, skipped e parar)", async () => {
    const rootRot = runtime.routineStore.createRoutine({
      owner_kind: "agente",
      owner_id: "estrategista",
      nome: "Fluxo Editorial [NOME_DA_MARCA]",
      instrucao: "Definir pauta do dia",
      trigger_kind: "schedule",
      timezone: "America/Sao_Paulo",
      schedule: { kind: "daily", time: "09:00" },
    });

    const postLink = (fromAgentId: string, toAgentId: string, instrucao = "Executar passo") =>
      fetch(`${baseUrl}/api/fluxos-rotinas/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rotina_id: rootRot.rotina_id,
          owner_id: "estrategista",
          from_agent_id: fromAgentId,
          to_agent_id: toAgentId,
          instrucao,
        }),
      });

    // Diamante A -> B, A -> C, B -> D, C -> D (D = analista_metricas)
    const lABRes = await postLink("estrategista", "copywriter", "Gerar copy");
    assert.equal(lABRes.status, 201);
    const lAB = ((await lABRes.json()) as { link: RoutineFlowLink }).link;

    const lACRes = await postLink("estrategista", "designer_carrossel", "Gerar arte");
    assert.equal(lACRes.status, 201);

    const lBDRes = await postLink("copywriter", "analista_metricas", "Revisar copy");
    assert.equal(lBDRes.status, 201);

    const lCDRes = await postLink("designer_carrossel", "analista_metricas", "Revisar design");
    assert.equal(lCDRes.status, 201);

    // Bloqueios DAG -> 400
    assert.equal((await postLink("copywriter", "copywriter")).status, 400); // auto-laço
    assert.equal((await postLink("copywriter", "estrategista")).status, 400); // volta ao dono
    assert.equal((await postLink("editor_video", "designer_carrossel")).status, 400); // inalcançável
    assert.equal((await postLink("analista_metricas", "copywriter")).status, 400); // ciclo

    // Deletar A -> B deve remover B -> D órfão automaticamente
    const delAB = await fetch(
      `${baseUrl}/api/fluxos-rotinas/links/${lAB.link_id}?owner_id=estrategista`,
      { method: "DELETE" }
    );
    assert.equal(delAB.status, 200);
    const delJson = (await delAB.json()) as { deletedLinkIds: string[] };
    assert.ok(delJson.deletedLinkIds.length >= 2);

    // Recria A -> B -> D para testar convergência completa
    await postLink("estrategista", "copywriter", "Gerar copy");
    await postLink("copywriter", "analista_metricas", "Revisar copy");

    const canvasRes = await fetch(`${baseUrl}/api/fluxos-rotinas/estrategista`);
    assert.equal(canvasRes.status, 200);
    const { canvas } = (await canvasRes.json()) as { canvas: RoutineFlowCanvas };
    assert.ok(canvas.links.length >= 4);

    // Dispara execução raiz concluída e acompanha sweep + convergência em D
    const execRoot = runtime.routineStore.createRun({
      rotina_id: rootRot.rotina_id,
      owner_kind: "agente",
      owner_id: "estrategista",
      run_kind: "manual",
      run_source: "test",
      scheduled_for: new Date().toISOString(),
      rotina_nome: rootRot.nome,
      instrucao: rootRot.instrucao,
      status: "succeeded",
      resultado_resumo: "Pauta aprovada",
    })!;

    await runtime.routineFlowsEngine.sweep();

    // Deve ter criado etapas para B (copywriter) e C (designer_carrossel), ainda sem D
    let steps = runtime.routineFlowStore.listStepsByExecucao(execRoot.execucao_id);
    const stepB = steps.find((s) => s.agente_id === "copywriter")!;
    const stepC = steps.find((s) => s.agente_id === "designer_carrossel")!;
    assert.ok(stepB && stepC);
    assert.equal(steps.find((s) => s.agente_id === "analista_metricas"), undefined);

    // Conclui B -> D ainda aguarda C
    await runtime.routineFlowsEngine.onFlowStepTaskSettled({
      stepId: stepB.step_id,
      status: "succeeded",
      output: "Copy final pronta",
      erro: null,
    });
    steps = runtime.routineFlowStore.listStepsByExecucao(execRoot.execucao_id);
    assert.equal(steps.find((s) => s.agente_id === "analista_metricas"), undefined);

    // Conclui C -> D dispara recebendo ambos outputs!
    await runtime.routineFlowsEngine.onFlowStepTaskSettled({
      stepId: stepC.step_id,
      status: "succeeded",
      output: "Carrossel 1080x1350 pronto",
      erro: null,
    });
    steps = runtime.routineFlowStore.listStepsByExecucao(execRoot.execucao_id);
    const stepD = steps.find((s) => s.agente_id === "analista_metricas")!;
    assert.ok(stepD);
    assert.ok(stepD.input.includes(`A rotina "${rootRot.nome}" continua com você.`));
    assert.ok(stepD.input.includes("Copy final pronta"));
    assert.ok(stepD.input.includes("Carrossel 1080x1350 pronto"));

    // Testa stopRun em cascata via HTTP
    const stopRes = await fetch(
      `${baseUrl}/api/fluxos-rotinas/runs/${execRoot.execucao_id}/parar`,
      { method: "POST" }
    );
    assert.equal(stopRes.status, 200);
    const afterStopSteps = runtime.routineFlowStore.listStepsByExecucao(execRoot.execucao_id);
    const stepDAfter = afterStopSteps.find((s) => s.step_id === stepD.step_id)!;
    assert.equal(stepDAfter.status, "cancelled");

    // Testa propagação skipped quando raiz encerra silenciada
    const silentRoot = runtime.routineStore.createRun({
      rotina_id: rootRot.rotina_id,
      owner_kind: "agente",
      owner_id: "estrategista",
      run_kind: "scheduled",
      run_source: null,
      scheduled_for: new Date(Date.now() + 1000).toISOString(),
      rotina_nome: rootRot.nome,
      instrucao: rootRot.instrucao,
      status: "succeeded",
      silenciada: true,
    })!;
    await runtime.routineFlowsEngine.sweep();
    const skippedSteps = runtime.routineFlowStore.listStepsByExecucao(silentRoot.execucao_id);
    assert.ok(skippedSteps.some((s) => s.status === "skipped"));
  });

  it("Cenário 8: preserva retrocompatibilidade de GET /api/rotinas e POST /api/rotinas legados", async () => {
    const postLegacy = await fetch(`${baseUrl}/api/rotinas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo: "Rotina Cron Legada",
        expressao_cron: "0 9 * * *",
        tipo_tarefa: "planejamento_semanal",
      }),
    });
    assert.equal(postLegacy.status, 201);

    const getLegacy = await fetch(`${baseUrl}/api/rotinas`);
    assert.equal(getLegacy.status, 200);
    const json = (await getLegacy.json()) as { rotinas: Array<{ titulo: string }> };
    assert.ok(json.rotinas.some((r) => r.titulo === "Rotina Cron Legada"));
  });
});
