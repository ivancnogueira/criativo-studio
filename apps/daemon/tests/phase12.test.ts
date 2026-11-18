import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  canConnectPorts,
  normalizeWorkflowGraph,
  workflowLoopEdges,
  type AIProviderClient,
  type AgentTurnContext,
  type AgentTurnResult,
  type WorkflowDetail,
  type WorkflowRunDetail,
} from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { currentAnswers, graphOrder, runScope } from "../src/workflows/workflow-walk.ts";

async function waitForCondition<T>(
  probe: () => Promise<T | null | undefined>,
  predicate: (val: T) => boolean,
  timeoutMs = 6000,
  label = "condição assíncrona"
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const val = await probe();
    if (val !== null && val !== undefined && predicate(val)) {
      return val;
    }
    await new Promise((r) => setTimeout(r, 35));
  }
  throw new Error(`Timeout aguardando ${label} após ${timeoutMs}ms`);
}

function makeMockGeminiProvider(
  handler: (ctx: AgentTurnContext) => Promise<AgentTurnResult> | AgentTurnResult
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

describe("Fase 12 — Motor Real de Workflows em Grafo, Gatilhos, Segurança Meta & Tools", () => {
  let prevSkipProbe: string | undefined;
  let tempDirs: string[] = [];

  before(() => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  });

  after(() => {
    if (prevSkipProbe === undefined) {
      delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    } else {
      process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    }
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignora erro de cleanup em tempDir
      }
    }
  });

  function makeTempWorkspace(prefix: string): { tempDir: string; dbPath: string } {
    const tempDir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(tempDir);
    return { tempDir, dbPath: join(tempDir, "studio-test.db") };
  }

  it("Cenário 1 (WFLW-01/02): algoritmo topológico puro, retrocompatibilidade, portas e loop detection", () => {
    // 1. Retrocompatibilidade de nós legados aprovacao -> approval e publicar_meta -> output(instagram)
    const legacy = normalizeWorkflowGraph({
      nos: [
        { id: "n1", tipo: "aprovacao", titulo: "Revisão", x: 100, y: 120, config: { question: "Ok?" } },
        { id: "n2", tipo: "publicar_meta", titulo: "Publicar", x: 420, y: 120, config: {} },
      ],
      arestas: [{ id: "e1", origem: "n1", destino: "n2" }],
    });
    assert.equal(legacy.nos[0].tipo, "approval");
    assert.equal(legacy.nos[1].tipo, "output");
    assert.equal(legacy.nos[1].target, "instagram");

    // 2. Validação de portas e condition
    const imgNode = { id: "g1", tipo: "gerar_imagem" as const, titulo: "Arte", x: 0, y: 0, config: {} };
    const outNode = { id: "o1", tipo: "output" as const, titulo: "Saída", x: 300, y: 0, config: {} };
    const noteNode = { id: "nt1", tipo: "nota" as const, titulo: "Nota", x: 50, y: 50, config: {} };
    const condNode = { id: "c1", tipo: "condition" as const, titulo: "Cond", x: 0, y: 100, config: { rule: "ok?" } };

    assert.equal(canConnectPorts(imgNode, outNode, "image").ok, true);
    assert.equal(canConnectPorts(noteNode, outNode).ok, false);
    assert.equal(canConnectPorts(condNode, outNode).ok, false);
    assert.equal(canConnectPorts(condNode, outNode, "text", "yes").ok, true);

    // 3. Loop edges e ordenação topológica
    const agNode = { id: "ag1", tipo: "agente" as const, titulo: "Agente", x: 0, y: 0, config: {} };
    const loopEdges = workflowLoopEdges(
      [agNode, condNode, outNode],
      [
        { id: "a1", origem: "ag1", destino: "c1", type: "text" },
        { id: "a2", origem: "c1", destino: "ag1", type: "text", branch: "no" },
        { id: "a3", origem: "c1", destino: "o1", type: "text", branch: "yes" },
      ]
    );
    assert.equal(loopEdges.has("a2"), true);
    assert.equal(loopEdges.size, 1);

    const order = graphOrder(
      [agNode, condNode, outNode],
      [
        { id: "a1", origem: "ag1", destino: "c1", type: "text" },
        { id: "a2", origem: "c1", destino: "ag1", type: "text", branch: "no" },
        { id: "a3", origem: "c1", destino: "o1", type: "text", branch: "yes" },
      ]
    );
    assert.deepEqual(order, ["ag1", "c1", "o1"]);

    // 4. Escopo parcial fromNodeId reutiliza respostas válidas a montante e invalida quando alterado
    const gBase = {
      nos: [
        { id: "p1", tipo: "prompt" as const, titulo: "Prompt", x: 0, y: 0, prompt: "Tema A", config: {} },
        { id: "l1", tipo: "llm" as const, titulo: "LLM", x: 300, y: 0, prompt: "Expandir", config: {} },
        { id: "o1", tipo: "output" as const, titulo: "Saída", x: 600, y: 0, target: "arquivo" as const, config: {} },
      ],
      arestas: [
        { id: "e1", origem: "p1", destino: "l1", type: "text" as const },
        { id: "e2", origem: "l1", destino: "o1", type: "text" as const },
      ],
    };
    const fakeNow = new Date().toISOString();
    const doneSteps = new Map([
      [
        "p1",
        {
          step_id: "s1",
          workflow_id: "w1",
          run_id: "r1",
          node_id: "p1",
          tentativa: 1,
          request_id: "q1",
          kind: "prompt",
          agente_id: null,
          status: "done" as const,
          tarefa_id: null,
          input: "",
          output: "Tema A",
          output_tipo: "text" as const,
          artefatos_json: "[]",
          branch: null,
          erro: null,
          iniciado_em: fakeNow,
          encerrado_em: fakeNow,
          criado_em: fakeNow,
          atualizado_em: fakeNow,
        },
      ],
    ]);

    const validUnchanged = currentAnswers(gBase, doneSteps, gBase);
    assert.equal(validUnchanged.has("p1"), true);

    const scopeFromL1 = runScope(gBase, { fromNodeId: "l1", answers: validUnchanged });
    assert.equal(scopeFromL1.scope.has("l1"), true);
    assert.equal(scopeFromL1.scope.has("p1"), false);
    assert.equal(scopeFromL1.reused.length, 1);

    const modifiedGraph = {
      ...gBase,
      nos: [{ ...gBase.nos[0], prompt: "Tema Alterado" }, gBase.nos[1], gBase.nos[2]],
    };
    const invalidated = currentAnswers(modifiedGraph, doneSteps, gBase);
    assert.equal(invalidated.has("p1"), false);
  });

  it("Cenário 2 (WFLW-01/02/03): execução prompt->llm->condition->approval->output(arquivo) e crash recovery pós-reboot", async () => {
    const { tempDir, dbPath } = makeTempWorkspace("criativo-wf-c2-");
    let runtime1: DaemonRuntime | null = null;
    let runtime2: DaemonRuntime | null = null;

    try {
      runtime1 = await createDaemonServer({
        port: 0,
        dbPath,
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
      });
      runtime1.vault.setSecret("gemini_api_key", "fake-gemini-key-test");
      runtime1.providers.registerCustomProvider(
        "gemini",
        makeMockGeminiProvider((ctx) => {
          const last = ctx.messages[ctx.messages.length - 1]?.content ?? "";
          if (last.includes("REGRA:")) {
            return { text: "yes", toolCalls: [], finishReason: "stop" };
          }
          return {
            text: `Copy gerada para [NOME_DA_MARCA] (${last.slice(0, 40)})`,
            toolCalls: [],
            finishReason: "stop",
          };
        })
      );

      const baseUrl1 = `http://127.0.0.1:${runtime1.port}`;
      const createRes = await fetch(`${baseUrl1}/api/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Pipeline Editorial Completo",
          nos: [
            { id: "n_prompt", tipo: "prompt", titulo: "Briefing", x: 100, y: 100, prompt: "Post para [NOME_DA_MARCA]", config: {} },
            { id: "n_llm", tipo: "llm", titulo: "Gerar Copy", x: 380, y: 100, prompt: "Escreva a legenda:", model: "gemini-2.5-pro", config: {} },
            { id: "n_cond", tipo: "condition", titulo: "Validar Regra", x: 700, y: 100, rule: "Tem CTA?", model: "gemini-2.5-pro", config: {} },
            { id: "n_appr", tipo: "approval", titulo: "Aprovação", x: 1020, y: 50, question: "Aprovar post?", config: {} },
            { id: "n_out_yes", tipo: "output", titulo: "Gravar Arquivo", x: 1340, y: 50, target: "arquivo", targetRef: "post-final.txt", config: {} },
            { id: "n_out_no", tipo: "output", titulo: "Ramo Não", x: 1020, y: 240, target: "notificacao", config: {} },
          ],
          arestas: [
            { id: "e1", origem: "n_prompt", destino: "n_llm", type: "text" },
            { id: "e2", origem: "n_llm", destino: "n_cond", type: "text" },
            { id: "e3", origem: "n_cond", destino: "n_appr", type: "text", branch: "yes" },
            { id: "e4", origem: "n_cond", destino: "n_out_no", type: "text", branch: "no" },
            { id: "e5", origem: "n_appr", destino: "n_out_yes", type: "text" },
          ],
        }),
      });
      assert.equal(createRes.status, 201);
      const createdJson = (await createRes.json()) as { workflow: { workflow_id: string } };
      const wfId = createdJson.workflow.workflow_id;

      const execRes = await fetch(`${baseUrl1}/api/workflows/${wfId}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(execRes.status, 200);
      const execJson = (await execRes.json()) as { run_id: string };

      const pausedRun = await waitForCondition<WorkflowRunDetail>(
        async () => {
          const r = await fetch(`${baseUrl1}/api/workflows/execucoes/${execJson.run_id}`);
          if (!r.ok) return null;
          const j = (await r.json()) as { execucao: WorkflowRunDetail };
          return j.execucao;
        },
        (val) => val.run.status === "approval",
        6000,
        "pausa em approval"
      );

      const skippedNo = pausedRun.steps.find((s) => s.node_id === "n_out_no");
      assert.equal(skippedNo?.status, "skipped");
      const approvalStep = pausedRun.steps.find((s) => s.node_id === "n_appr");
      assert.ok(approvalStep && approvalStep.status === "approval");

      // Simula também uma entrega travada em 'sending' no momento do crash
      runtime1.db.connection
        .prepare(
          `INSERT INTO projecao_workflow_entregas (step_id, destino, destino_ref, texto, anexos_json, status, tentativas, criado_em, atualizado_em)
           VALUES (?, 'notificacao', 'cockpit', 'msg crash', '[]', 'sending', 1, ?, ?);`
        )
        .run(skippedNo!.step_id, new Date().toISOString(), new Date().toISOString());

      // Reboot do Daemon
      await runtime1.close();
      runtime1 = null;

      runtime2 = await createDaemonServer({
        port: 0,
        dbPath,
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
      });
      const baseUrl2 = `http://127.0.0.1:${runtime2.port}`;

      // Confirma entrega 'sending' virou 'uncertain' sem reenviar
      const deliveryRow = runtime2.db.connection
        .prepare(`SELECT status FROM projecao_workflow_entregas WHERE step_id = ?;`)
        .get(skippedNo!.step_id) as { status: string };
      assert.equal(deliveryRow.status, "uncertain");

      // Confirma run ainda em approval pós-boot
      const postRebootRes = await fetch(`${baseUrl2}/api/workflows/execucoes/${execJson.run_id}`);
      const postRebootJson = (await postRebootRes.json()) as { execucao: WorkflowRunDetail };
      assert.equal(postRebootJson.execucao.run.status, "approval");

      // Aprova etapa após reinício
      const decideRes = await fetch(
        `${baseUrl2}/api/workflows/etapas/${approvalStep.step_id}/decidir`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved: true }),
        }
      );
      assert.equal(decideRes.status, 200);

      const doneRun = await waitForCondition<WorkflowRunDetail>(
        async () => {
          const r = await fetch(`${baseUrl2}/api/workflows/execucoes/${execJson.run_id}`);
          const j = (await r.json()) as { execucao: WorkflowRunDetail };
          return j.execucao;
        },
        (val) => val.run.status === "done",
        6000,
        "conclusão pós aprovação"
      );
      assert.equal(doneRun.run.status, "done");

      const outputFile = join(tempDir, "saidas", "workflows", "post-final.txt");
      assert.equal(existsSync(outputFile), true);
      assert.match(readFileSync(outputFile, "utf8"), /Copy gerada/);
    } finally {
      await runtime1?.close();
      await runtime2?.close();
    }
  });

  it("Cenário 3 (D-04 / WFLW-02): bloqueia output(instagram) sem approval e publica quando aprovado a montante", async () => {
    const { tempDir, dbPath } = makeTempWorkspace("criativo-wf-c3-");
    let metaCalls = 0;

    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
      fetchImpl: (async (url: string | URL) => {
        const str = String(url);
        if (str.includes("graph.facebook.com")) {
          metaCalls += 1;
          return new Response(JSON.stringify({ id: `ig_${metaCalls}` }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    try {
      runtime.vault.setSecret("instagram_access_token", "token-meta-fake");
      runtime.vault.setSecret("instagram_business_account_id", "17841400000000000");

      // A) Sem nó approval -> deve falhar com bloqueio de segurança e 0 chamadas na Meta API
      const unsafeWf = runtime.workflowStore.createWorkflow({
        nome: "Sem Aprovação",
        nos: [
          { id: "p1", tipo: "prompt", titulo: "Legenda", x: 100, y: 100, prompt: "Texto pronto", config: {} },
          {
            id: "ig1",
            tipo: "output",
            titulo: "IG",
            x: 420,
            y: 100,
            target: "instagram",
            config: { target: "instagram", mediaUrls: ["https://exemplo.invalid/img.png"] },
          },
        ],
        arestas: [{ id: "e1", origem: "p1", destino: "ig1", type: "text" }],
      });

      const unsafeRun = await runtime.workflowEngine.startRun({
        workflowId: unsafeWf.workflow.workflow_id,
        origem: "manual",
      });

      const failedRun = await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(unsafeRun.run.run_id),
        (v) => v.run.status === "failed",
        5000,
        "falha de segurança output instagram"
      );
      assert.equal(metaCalls, 0);
      assert.match(failedRun.run.erro ?? "", /BLOQUEIO DE SEGURANÇA/i);

      // B) Com nó approval aprovado -> dispara publicação com approved_by_human: true
      const safeWf = runtime.workflowStore.createWorkflow({
        nome: "Com Aprovação",
        nos: [
          { id: "p1", tipo: "prompt", titulo: "Legenda", x: 100, y: 100, prompt: "Post aprovado", config: {} },
          { id: "a1", tipo: "approval", titulo: "Revisão", x: 380, y: 100, question: "Ok?", config: {} },
          {
            id: "ig1",
            tipo: "output",
            titulo: "IG",
            x: 680,
            y: 100,
            target: "instagram",
            config: { target: "instagram", mediaUrls: ["https://exemplo.invalid/ok.png"] },
          },
        ],
        arestas: [
          { id: "e1", origem: "p1", destino: "a1", type: "text" },
          { id: "e2", origem: "a1", destino: "ig1", type: "text" },
        ],
      });

      const safeRun = await runtime.workflowEngine.startRun({
        workflowId: safeWf.workflow.workflow_id,
        origem: "manual",
      });
      const paused = await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(safeRun.run.run_id),
        (v) => v.run.status === "approval",
        5000,
        "pausa approval meta"
      );
      const apprStep = paused.steps.find((s) => s.node_id === "a1")!;
      await runtime.workflowEngine.decideStep(apprStep.step_id, true, "humano");

      const published = await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(safeRun.run.run_id),
        (v) => v.run.status === "done",
        5000,
        "conclusão publicação meta"
      );
      assert.equal(published.run.status, "done");
      assert.equal(metaCalls, 2); // container + media_publish
    } finally {
      await runtime.close();
    }
  });

  it("Cenário 4 (WFLW-04): execução parcial fromNodeId, runStep isolado, conflito 409 e restauração de versão", async () => {
    const { tempDir, dbPath } = makeTempWorkspace("criativo-wf-c4-");
    let llmCalls = 0;

    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });

    try {
      runtime.vault.setSecret("gemini_api_key", "fake-gemini-key-test");
      runtime.providers.registerCustomProvider(
        "gemini",
        makeMockGeminiProvider(() => {
          llmCalls += 1;
          return { text: `Saida LLM #${llmCalls}`, toolCalls: [], finishReason: "stop" };
        })
      );

      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const wf = runtime.workflowStore.createWorkflow({
        nome: "Parcial e Versões",
        nos: [
          { id: "n1", tipo: "llm", titulo: "Passo 1", x: 100, y: 100, prompt: "Passo 1", model: "gemini-2.5-pro", config: {} },
          { id: "n2", tipo: "prompt", titulo: "Passo 2", x: 400, y: 100, prompt: "Formatado: {{input}}", config: {} },
        ],
        arestas: [{ id: "e1", origem: "n1", destino: "n2", type: "text" }],
      });
      const wfId = wf.workflow.workflow_id;

      // Run completo inicial (llmCalls vai para 1)
      const fullRes = await fetch(`${baseUrl}/api/workflows/${wfId}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const fullJson = (await fullRes.json()) as { run_id: string };
      await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(fullJson.run_id),
        (v) => v.run.status === "done"
      );
      assert.equal(llmCalls, 1);

      // Run parcial a partir de n2 -> NÃO chama n1 novamente (llmCalls continua 1) e n1 tem request_id 'reuse:...'
      const partialRes = await fetch(`${baseUrl}/api/workflows/${wfId}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_node_id: "n2" }),
      });
      const partialJson = (await partialRes.json()) as { run_id: string };
      const partialDone = await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(partialJson.run_id),
        (v) => v.run.status === "done"
      );
      assert.equal(llmCalls, 1);
      const reusedStep = partialDone.steps.find((s) => s.node_id === "n1");
      assert.ok(reusedStep?.request_id.startsWith("reuse:"));

      // Run isolado (solo step, run_id = null)
      const soloRes = await fetch(`${baseUrl}/api/workflows/${wfId}/nos/n2/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const soloJson = (await soloRes.json()) as { step: { run_id: string | null; status: string } };
      assert.equal(soloJson.step.run_id, null);
      assert.equal(soloJson.step.status, "done");

      // Versionamento + Concorrência Otimista 409 + Restauração
      const curDetail = runtime.workflowStore.getWorkflowDetail(wfId)!;
      assert.ok(curDetail.versions.length >= 1);

      const saveOkRes = await fetch(`${baseUrl}/api/workflows/${wfId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Parcial Editado v2",
          nos: curDetail.workflow.nos,
          arestas: curDetail.workflow.arestas,
          base_revision: curDetail.workflow.revisao_grafo,
        }),
      });
      assert.equal(saveOkRes.status, 200);

      // Envia PUT com base_revision desatualizada -> HTTP 409 Conflict
      const conflictRes = await fetch(`${baseUrl}/api/workflows/${wfId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Colisão",
          nos: curDetail.workflow.nos,
          arestas: curDetail.workflow.arestas,
          base_revision: curDetail.workflow.revisao_grafo,
        }),
      });
      assert.equal(conflictRes.status, 409);

      // Restaura versão anterior
      const versionToRestore = curDetail.versions[0].version_id;
      const restoreRes = await fetch(
        `${baseUrl}/api/workflows/${wfId}/versoes/${versionToRestore}/restaurar`,
        { method: "POST" }
      );
      assert.equal(restoreRes.status, 200);
      const restoreJson = (await restoreRes.json()) as { detail: WorkflowDetail };
      assert.ok(restoreJson.detail.versions.some((v) => v.kind === "restore"));
    } finally {
      await runtime.close();
    }
  });

  it("Cenário 5 (WFLW-03 / D-05): gatilhos schedule (NO_OPEN_RUN), webhook HMAC anti-replay, WhatsApp, Telegram e Conector", async () => {
    const { tempDir, dbPath } = makeTempWorkspace("criativo-wf-c5-");
    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });

    try {
      const baseUrl = `http://127.0.0.1:${runtime.port}`;

      // 1. Schedule + NO_OPEN_RUN
      const schedWf = runtime.workflowStore.createWorkflow({
        nome: "Agendado Protegido",
        nos: [
          {
            id: "g_sched",
            tipo: "gatilho",
            titulo: "Cron Diário",
            x: 100,
            y: 100,
            triggerKind: "schedule",
            trigger: { kind: "schedule", schedule: { kind: "interval", intervalMinutes: 5 } },
            config: {},
          },
          { id: "a_pause", tipo: "approval", titulo: "Pausa", x: 400, y: 100, question: "Ok?", config: {} },
        ],
        arestas: [{ id: "e1", origem: "g_sched", destino: "a_pause", type: "text" }],
      });

      // Força vencimento no passado
      runtime.db.connection
        .prepare(`UPDATE projecao_workflow_gatilhos SET proxima_execucao_em = ? WHERE workflow_id = ?;`)
        .run(new Date(Date.now() - 60_000).toISOString(), schedWf.workflow.workflow_id);

      await runtime.workflowTriggers.processDue(new Date());
      await waitForCondition(
        async () => runtime.workflowStore.listRunsPaginated(schedWf.workflow.workflow_id),
        (r) => r.length === 1 && r[0].status === "approval"
      );

      // Com run ainda aberto em approval, novo vencimento é pulado por NO_OPEN_RUN
      runtime.db.connection
        .prepare(`UPDATE projecao_workflow_gatilhos SET proxima_execucao_em = ? WHERE workflow_id = ?;`)
        .run(new Date(Date.now() - 10_000).toISOString(), schedWf.workflow.workflow_id);
      await runtime.workflowTriggers.processDue(new Date());
      assert.equal(runtime.workflowStore.listRunsPaginated(schedWf.workflow.workflow_id).length, 1);

      // 2. Webhook HMAC-SHA256 + Anti-Replay
      const whWf = runtime.workflowStore.createWorkflow({
        nome: "Webhook Protegido",
        nos: [
          { id: "g_wh", tipo: "gatilho", titulo: "WH", x: 100, y: 100, triggerKind: "webhook", config: {} },
          { id: "p_wh", tipo: "prompt", titulo: "Eco", x: 400, y: 100, prompt: "Dados: {{input}}", config: {} },
        ],
        arestas: [{ id: "e1", origem: "g_wh", destino: "p_wh", type: "text" }],
      });

      const rotRes = await fetch(
        `${baseUrl}/api/workflows/${whWf.workflow.workflow_id}/gatilhos/g_wh/rotacionar-webhook`,
        { method: "POST" }
      );
      assert.equal(rotRes.status, 200);
      const rotJson = (await rotRes.json()) as { webhook_url: string; secret: string };
      assert.ok(rotJson.secret.length >= 32);

      // Assinatura inválida -> 401
      const badWh = await fetch(`${baseUrl}${rotJson.webhook_url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Criativo-Signature": "sha256=invalida" },
        body: JSON.stringify({ evento: "teste" }),
      });
      assert.equal(badWh.status, 401);

      // Assinatura válida HMAC-SHA256
      const payloadBody = JSON.stringify({ evento: "pedido_pago", valor: 99 });
      const validSig = createHmac("sha256", rotJson.secret).update(payloadBody).digest("hex");
      const okWh = await fetch(`${baseUrl}${rotJson.webhook_url}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Criativo-Signature": `sha256=${validSig}`,
          "X-Delivery-Id": "dlv-001",
        },
        body: payloadBody,
      });
      assert.equal(okWh.status, 202);
      const okWhJson = (await okWh.json()) as { status: string; run_id: string };
      assert.equal(okWhJson.status, "started");

      const whRunDone = await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(okWhJson.run_id),
        (v) => v.run.status === "done"
      );
      assert.match(whRunDone.run.payload ?? "", /\[EVENTO_EXTERNO_INICIO\]/);
      assert.match(whRunDone.run.payload ?? "", /\[EVENTO_EXTERNO_FIM\]/);

      // Replay mesmo X-Delivery-Id -> duplicate
      const replayWh = await fetch(`${baseUrl}${rotJson.webhook_url}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Criativo-Signature": `sha256=${validSig}`,
          "X-Delivery-Id": "dlv-001",
        },
        body: payloadBody,
      });
      const replayJson = (await replayWh.json()) as { status: string };
      assert.equal(replayJson.status, "duplicate");

      // 3. WhatsApp, Telegram e Conector triggers
      const msgWf = runtime.workflowStore.createWorkflow({
        nome: "Triggers Multi-Canal",
        nos: [
          {
            id: "g_wa",
            tipo: "gatilho",
            titulo: "WA",
            x: 100,
            y: 100,
            triggerKind: "whatsapp",
            trigger: { kind: "whatsapp", palavraChave: "/gerar" },
            config: {},
          },
          {
            id: "g_tg",
            tipo: "gatilho",
            titulo: "TG",
            x: 100,
            y: 260,
            triggerKind: "telegram",
            trigger: { kind: "telegram", palavraChave: "/alerta" },
            config: {},
          },
          {
            id: "g_conn",
            tipo: "gatilho",
            titulo: "Conn",
            x: 100,
            y: 420,
            triggerKind: "conector",
            trigger: { kind: "conector", conectorId: "github", evento: "release" },
            config: {},
          },
        ],
        arestas: [],
      });

      const waTriggered = await runtime.workflowTriggers.receiveWhatsAppTrigger({
        jid: "5511999990001@s.whatsapp.net",
        isGroup: false,
        text: "Por favor /gerar post agora",
        messageId: "wa-msg-1",
      });
      assert.equal(waTriggered.length, 1);

      await waitForCondition(
        async () => runtime.workflowStore.getRunDetail(waTriggered[0].run_id),
        (v) => v.run.status === "done"
      );

      const tgRes = await fetch(`${baseUrl}/api/mensageria/telegram/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: { message_id: 99, chat: { id: 123456 }, text: "/alerta novo" },
        }),
      });
      assert.equal(tgRes.status, 200);

      await waitForCondition(
        async () => runtime.workflowStore.listRunsPaginated(msgWf.workflow.workflow_id),
        (runs) => runs.length >= 2 && runs.every((r) => r.status === "done")
      );

      const connRes = await fetch(`${baseUrl}/api/workflows/conector-evento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conector_id: "github", evento: "release", dados: { tag: "v1.0" } }),
      });
      const connJson = (await connRes.json()) as { ok: boolean; triggered_runs: unknown[] };
      assert.equal(connJson.ok, true);
      assert.equal(connJson.triggered_runs.length, 1);
    } finally {
      await runtime.close();
    }
  });

  it("Cenário 6 (WFLW-05 / D-08): 6 ferramentas nativas de workflow operadas pelo chat e pelo AgentRunner", async () => {
    const { tempDir, dbPath } = makeTempWorkspace("criativo-wf-c6-");
    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });

    try {
      runtime.vault.setSecret("gemini_api_key", "fake-gemini-key-test");
      runtime.db.connection
        .prepare(`UPDATE projecao_agentes SET modelo_padrao = 'gemini-2.5-pro' WHERE agente_id = 'estrategista';`)
        .run();
      let createdWfId = "";
      let stepCallIndex = 0;

      runtime.providers.registerCustomProvider(
        "gemini",
        makeMockGeminiProvider((ctx) => {
          const lastTool = [...ctx.messages].reverse().find((m) => m.role === "tool");
          if (lastTool?.toolName === "edit_workflow") {
            const parsed = JSON.parse(lastTool.content) as { workflow?: { workflow_id?: string } };
            createdWfId = parsed.workflow?.workflow_id ?? createdWfId;
          }

          stepCallIndex += 1;
          if (stepCallIndex === 1) {
            return {
              text: "",
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "tc_1",
                  name: "edit_workflow",
                  arguments: {
                    nome: "Fluxo Criado Pelo Agente",
                    tidy: true,
                    ops: [
                      {
                        op: "add",
                        ref: "inicio",
                        node: { tipo: "prompt", titulo: "Prompt Inicial", prompt: "Ideia base" },
                      },
                      {
                        op: "add",
                        ref: "fim",
                        node: { tipo: "output", titulo: "Notificar", target: "notificacao" },
                      },
                      { op: "connect", origem: "inicio", destino: "fim", type: "text" },
                    ],
                  },
                },
              ],
            };
          }
          if (stepCallIndex === 2) {
            return {
              text: "",
              finishReason: "tool_calls",
              toolCalls: [
                { id: "tc_2", name: "list_workflows", arguments: {} },
                { id: "tc_3", name: "read_workflow", arguments: { workflow_id: createdWfId } },
              ],
            };
          }
          if (stepCallIndex === 3) {
            return {
              text: "",
              finishReason: "tool_calls",
              toolCalls: [{ id: "tc_4", name: "run_workflow", arguments: { workflow_id: createdWfId } }],
            };
          }
          if (stepCallIndex === 4) {
            return {
              text: "",
              finishReason: "tool_calls",
              toolCalls: [
                { id: "tc_5", name: "read_workflow_runs", arguments: { workflow_id: createdWfId } },
                { id: "tc_6", name: "delete_workflow", arguments: { workflow_id: createdWfId } },
              ],
            };
          }
          if (lastTool?.toolName === "delete_workflow") {
            const delOut = JSON.parse(lastTool.content) as { requires_confirmation?: boolean };
            assert.equal(delOut.requires_confirmation, true);
          }

          return {
            text: `Workflow ${createdWfId} criado, lido, executado e protegido contra exclusão sem confirmação.`,
            toolCalls: [],
            finishReason: "stop",
          };
        })
      );

      // 1. Execução via Chat Principal (HTTP POST /api/agentes/estrategista/mensagens)
      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const chatRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: "Crie e rode um workflow de notificação" }),
      });
      assert.equal(chatRes.status, 201);
      const chatJson = (await chatRes.json()) as {
        mensagem_agente?: { conteudo_markdown?: string };
      };
      assert.ok(createdWfId);
      assert.match(chatJson.mensagem_agente?.conteudo_markdown ?? "", /criado, lido, executado/);

      // Garante que delete sem confirmed_by_human NÃO excluiu
      assert.ok(runtime.workflowStore.getWorkflowDetail(createdWfId));

      // 2. Execução via AgentRunner.runTask com confirmação explícita de exclusão
      let runnerStep = 0;
      runtime.providers.registerCustomProvider(
        "gemini",
        makeMockGeminiProvider(() => {
          runnerStep += 1;
          if (runnerStep === 1) {
            return {
              text: "",
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "tc_del",
                  name: "delete_workflow",
                  arguments: { workflow_id: createdWfId, confirmed_by_human: true },
                },
              ],
            };
          }
          return { text: "Workflow removido com confirmação.", toolCalls: [], finishReason: "stop" };
        })
      );

      const task = runtime.queue.enqueueTask({
        agente_id: "estrategista",
        canal_origem: "web",
        tipo: "workflow_step",
        titulo: "Excluir workflow confirmado",
        payload: { workflow_id: createdWfId },
      });
      const runRes = await runtime.runner.runTask(task);
      assert.match(runRes.finalText, /removido/);
      assert.equal(runtime.workflowStore.getWorkflowDetail(createdWfId), null);
    } finally {
      await runtime.close();
    }
  });
});
