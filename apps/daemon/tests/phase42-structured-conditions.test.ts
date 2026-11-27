import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AIProviderClient, WorkflowRunDetail } from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

async function waitForRunDone(baseUrl: string, runId: string): Promise<WorkflowRunDetail> {
  const started = Date.now();
  while (Date.now() - started < 6000) {
    const res = await fetch(`${baseUrl}/api/workflows/execucoes/${runId}`);
    if (res.ok) {
      const json = (await res.json()) as { execucao?: WorkflowRunDetail };
      const detail = json.execucao;
      if (detail && (detail.run.status === "done" || detail.run.status === "failed")) {
        return detail;
      }
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timeout aguardando conclusão do run ${runId}`);
}

describe("Fase 42-02 — Answer Fields Tipados, Tokens {{campo}} e Condições Determinísticas Zero-IA", () => {
  let prevSkipProbe: string | undefined;
  const tempDirs: string[] = [];

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
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignora
      }
    }
  });

  it("Answer fields em llm + interpolação {{campo}} e condição determinística sem chamadas a IA", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "crv-42-02-"));
    tempDirs.push(tempDir);
    let runtime: DaemonRuntime | null = null;
    let llmCalls = 0;

    try {
      runtime = await createDaemonServer({
        port: 0,
        dbPath: join(tempDir, "studio.db"),
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
      });
      runtime.vault.setSecret("gemini_api_key", "fake-gemini-key-4202");

      let returnApproved = true;
      const mockProvider: AIProviderClient = {
        name: "gemini",
        async generateText() {
          throw new Error("Não esperado generateText direto");
        },
        async executeTurn() {
          llmCalls += 1;
          return {
            text: returnApproved
              ? '```json\n{"tema":"Lançamento [NOME_DA_MARCA]","slides":"6","aprovado":"sim"}\n```'
              : '```json\n{"tema":"Rascunho Curto","slides":2,"aprovado":false}\n```',
            toolCalls: [],
            finishReason: "stop",
          };
        },
        async streamTurn() {
          throw new Error("Não esperado stream");
        },
      };
      runtime.providers.registerCustomProvider("gemini", mockProvider);

      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const wfCreate = await fetch(`${baseUrl}/api/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Workflow Answer Fields e Condição Zero-IA",
          nos: [
            {
              id: "t1",
              tipo: "gatilho",
              titulo: "Início",
              x: 80,
              y: 120,
              triggerKind: "manual",
              config: { triggerKind: "manual" },
            },
            {
              id: "llm1",
              tipo: "llm",
              titulo: "Planejar Campos",
              x: 360,
              y: 120,
              model: "gemini-2.5-pro",
              prompt: "Gere os campos do roteiro",
              answerFields: [
                { id: "f1", key: "tema", label: "Tema", type: "text", required: true },
                { id: "f2", key: "slides", label: "Slides", type: "number", required: true },
                { id: "f3", key: "aprovado", label: "Aprovado", type: "boolean", required: true },
              ],
              config: {},
            },
            {
              id: "cond1",
              tipo: "condition",
              titulo: "Validar Regra Determinística",
              x: 640,
              y: 120,
              conditionMode: "deterministic",
              deterministicRule: {
                combine: "and",
                clauses: [
                  { fieldRef: "aprovado", operator: "is_true" },
                  { fieldRef: "slides", operator: "gte", value: "5" },
                ],
              },
              config: {},
            },
            {
              id: "p_yes",
              tipo: "prompt",
              titulo: "Montar Resumo",
              x: 920,
              y: 60,
              prompt: "Pauta: {{tema}} ({{slides}})",
              config: {},
            },
            {
              id: "out_yes",
              tipo: "output",
              titulo: "Salvar Ramo Sim",
              x: 1200,
              y: 60,
              target: "arquivo",
              targetRef: "ramo-sim.txt",
              config: { target: "arquivo", targetRef: "ramo-sim.txt" },
            },
            {
              id: "out_no",
              tipo: "output",
              titulo: "Ramo Não",
              x: 920,
              y: 260,
              target: "notificacao",
              config: { target: "notificacao" },
            },
          ],
          arestas: [
            { id: "e1", origem: "t1", destino: "llm1", type: "text" },
            { id: "e2", origem: "llm1", destino: "cond1", type: "text" },
            { id: "e3", origem: "cond1", destino: "p_yes", type: "text", branch: "yes" },
            { id: "e4", origem: "p_yes", destino: "out_yes", type: "text" },
            { id: "e5", origem: "cond1", destino: "out_no", type: "text", branch: "no" },
          ],
        }),
      });
      assert.equal(wfCreate.status, 201);
      const { workflow } = (await wfCreate.json()) as { workflow: { workflow_id: string } };

      // 1) Execução ramo YES: llmCalls deve incrementar apenas 1 (nó llm1); cond1 faz 0 chamadas LLM!
      const run1Res = await fetch(`${baseUrl}/api/workflows/${workflow.workflow_id}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(run1Res.status, 200);
      const { run_id: run1Id } = (await run1Res.json()) as { run_id: string };
      const detail1 = await waitForRunDone(baseUrl, run1Id);

      assert.equal(detail1.run.status, "done");
      assert.equal(llmCalls, 1, "Nó condition determinístico NÃO deve chamar IA");

      const llmStep = detail1.steps.find((s) => s.node_id === "llm1");
      assert.ok(llmStep?.structured_output_json);
      assert.deepEqual(JSON.parse(llmStep.structured_output_json), {
        tema: "Lançamento [NOME_DA_MARCA]",
        slides: 6,
        aprovado: true,
      });

      const condStep1 = detail1.steps.find((s) => s.node_id === "cond1");
      assert.equal(condStep1?.branch, "yes");

      const outFile = join(tempDir, "saidas", "workflows", "ramo-sim.txt");
      assert.equal(existsSync(outFile), true);
      assert.equal(readFileSync(outFile, "utf8").trim(), "Pauta: Lançamento [NOME_DA_MARCA] (6)");

      // 2) Execução ramo NO (aprovado=false, slides=2): cond1 escolhe 'no' sem chamar IA
      returnApproved = false;
      const run2Res = await fetch(`${baseUrl}/api/workflows/${workflow.workflow_id}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const { run_id: run2Id } = (await run2Res.json()) as { run_id: string };
      const detail2 = await waitForRunDone(baseUrl, run2Id);
      assert.equal(detail2.run.status, "done");
      assert.equal(llmCalls, 2);
      assert.equal(detail2.steps.find((s) => s.node_id === "cond1")?.branch, "no");
      assert.ok(detail2.steps.find((s) => s.node_id === "out_no" && s.status === "done"));
    } finally {
      await runtime?.close();
    }
  });

  it("Answer fields em gatilho(webhook) extrai campos do JSON HMAC sem chamar IA", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "crv-42-02-wh-"));
    tempDirs.push(tempDir);
    let runtime: DaemonRuntime | null = null;

    try {
      runtime = await createDaemonServer({
        port: 0,
        dbPath: join(tempDir, "studio.db"),
        workspaceRoot: tempDir,
        autoStartLoops: false,
        controlSocketPath: null,
      });

      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      const wfRes = await fetch(`${baseUrl}/api/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Webhook Answer Fields",
          ativo: true,
          nos: [
            {
              id: "wh1",
              tipo: "gatilho",
              titulo: "Webhook Entrada",
              x: 100,
              y: 120,
              triggerKind: "webhook",
              answerFields: [
                { id: "w1", key: "formato", label: "Formato", type: "text", required: true },
                { id: "w2", key: "prioridade", label: "Prioridade", type: "number", required: true },
              ],
              config: { triggerKind: "webhook" },
            },
            {
              id: "p1",
              tipo: "prompt",
              titulo: "Formatar",
              x: 380,
              y: 120,
              prompt: "Formato={{formato}};Prioridade={{wh1.prioridade}}",
              config: {},
            },
            {
              id: "o1",
              tipo: "output",
              titulo: "Salvar",
              x: 660,
              y: 120,
              target: "arquivo",
              targetRef: "wh-out.txt",
              config: { target: "arquivo", targetRef: "wh-out.txt" },
            },
          ],
          arestas: [
            { id: "ew1", origem: "wh1", destino: "p1", type: "text" },
            { id: "ew2", origem: "p1", destino: "o1", type: "text" },
          ],
        }),
      });
      const { workflow } = (await wfRes.json()) as { workflow: { workflow_id: string } };

      const rotRes = await fetch(
        `${baseUrl}/api/workflows/${workflow.workflow_id}/gatilhos/wh1/rotacionar-webhook`,
        { method: "POST" }
      );
      const { route_id, secret } = (await rotRes.json()) as { route_id: string; secret: string };

      const rawBody = JSON.stringify({ evento: { formato: "carrossel", prioridade: 9 } });
      const sig = createHmac("sha256", secret).update(rawBody).digest("hex");
      const hookRes = await fetch(`${baseUrl}/api/workflows/webhook/${route_id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Criativo-Signature": `sha256=${sig}`,
        },
        body: rawBody,
      });
      assert.equal(hookRes.status, 202);
      const hookJson = (await hookRes.json()) as { status?: string; run_id?: string };
      assert.equal(hookJson.status, "started");
      assert.ok(hookJson.run_id, "Webhook ativo deve retornar run_id");
      const detail = await waitForRunDone(baseUrl, hookJson.run_id);

      assert.equal(detail.run.status, "done");
      const whStep = detail.steps.find((s) => s.node_id === "wh1");
      assert.deepEqual(JSON.parse(whStep?.structured_output_json ?? "{}"), {
        formato: "carrossel",
        prioridade: 9,
      });
      assert.equal(
        readFileSync(join(tempDir, "saidas", "workflows", "wh-out.txt"), "utf8").trim(),
        "Formato=carrossel;Prioridade=9"
      );
    } finally {
      await runtime?.close();
    }
  });
});
