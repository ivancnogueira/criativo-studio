import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../src/database/client.ts";
import {
  DEFAULT_CORE_EXPOSED_TOOLS,
  LazyToolRouter,
} from "../src/engine/tools/lazy-tool-router.ts";
import {
  detectAcpBackgroundTaskOutput,
  promisesBackgroundContinuationWithoutHandle,
} from "../src/providers/turn-stall-watchdog.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { buildPhase13SystemGuidance } from "../src/server/tools/phase13-orchestration-tools.ts";
import {
  planTurnContext,
  toolBelongsToScopes,
} from "../src/server/turn-context-planner.ts";
import {
  BackgroundJobService,
  MAX_ACTIVE_BG_JOBS_PER_AGENT,
} from "../src/waits/background-job-service.ts";
import { buildBackgroundJobWakePrompt } from "../src/waits/background-job-wakeup-handler.ts";

const tempDirs: string[] = [];
const runtimes: DaemonRuntime[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (runtimes.length > 0) {
    const rt = runtimes.pop();
    if (rt) await rt.close().catch(() => {});
  }
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignora lock temporário
      }
    }
  }
});

describe("Subfase 40.9 — Motor Universal de Background Jobs & Auto-Despertar Reativo", () => {
  it("1. BackgroundJobService executa processo cross-platform, grava log e dispara onComplete ao concluir", async () => {
    const dir = makeTempDir("criativo-p409-bg-");
    const db = initializeDatabase({ dbPath: join(dir, "test.sqlite") });
    const service = new BackgroundJobService({ db, workspaceRoot: dir });

    let completedSnap: Awaited<ReturnType<typeof service.getJob>> | null = null;
    const donePromise = new Promise<void>((resolveDone) => {
      service.setOnComplete((job) => {
        completedSnap = job;
        resolveDone();
      });
    });

    const snap = service.startCommandJob(
      { agenteId: "estrategista", workspaceRoot: dir },
      {
        label: "Teste Node Cross-Platform",
        executable: process.execPath,
        args: ["-e", "console.log('render_ok_40_9');"],
        onCompleteInstruction: "Anexar arquivo e avisar o usuário.",
      }
    );

    assert.equal(snap.status, "executando");
    assert.ok(snap.jobId.startsWith("bg_"));
    assert.equal(snap.kind, "command");

    await donePromise;
    assert.ok(completedSnap, "onComplete deve ser invocado");
    assert.equal(completedSnap.status, "concluido");
    assert.equal(completedSnap.exitCode, 0);
    assert.match(completedSnap.stdoutTail, /render_ok_40_9/);
    assert.ok(completedSnap.logPath && existsSync(completedSnap.logPath));
    assert.match(readFileSync(completedSnap.logPath, "utf8"), /render_ok_40_9/);

    const promptText = buildBackgroundJobWakePrompt(completedSnap);
    assert.match(promptText, /\[BACKGROUND JOB CONCLUÍDO/);
    assert.match(promptText, /render_ok_40_9/);
    assert.match(promptText, /Anexar arquivo e avisar o usuário/);

    service.dispose();
    db.close();
  });

  it("2. BackgroundJobService captura falhas (exitCode != 0), cancelJob cross-platform e limite por agente", async () => {
    const dir = makeTempDir("criativo-p409-fail-");
    const db = initializeDatabase({ dbPath: join(dir, "test.sqlite") });
    const service = new BackgroundJobService({ db, workspaceRoot: dir });

    let failedJob: ReturnType<typeof service.getJob> = null;
    let completionCount = 0;
    const failDone = new Promise<void>((resolveFail) => {
      service.setOnComplete((job) => {
        completionCount += 1;
        if (job.label === "Job Falho") {
          failedJob = job;
          resolveFail();
        }
      });
    });

    service.startCommandJob(
      { agenteId: "estrategista", workspaceRoot: dir },
      {
        label: "Job Falho",
        executable: process.execPath,
        args: ["-e", "console.error('ffmpeg_err_simulado'); process.exit(2);"],
        onCompleteInstruction: "Reportar erro.",
      }
    );
    await failDone;
    assert.equal(failedJob?.status, "falha");
    assert.equal(failedJob?.exitCode, 2);
    assert.match(failedJob?.stderrTail ?? "", /ffmpeg_err_simulado/);

    // Job longo cancelado manualmente não deve disparar onComplete
    const prevCount = completionCount;
    const longJob = service.startCommandJob(
      { agenteId: "estrategista", workspaceRoot: dir },
      {
        label: "Job Longo Cancelável",
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        onCompleteInstruction: "Não deve rodar",
      }
    );
    assert.equal(service.hasActiveJobs("estrategista"), true);
    const cancelRes = service.cancelJob(longJob.jobId, "estrategista");
    assert.equal(cancelRes.ok, true);
    assert.equal(cancelRes.status, "cancelado");
    assert.equal(service.hasActiveJobs("estrategista"), false);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(completionCount, prevCount, "job cancelado não deve despertar o agente");

    // Tarefa assíncrona interna (simula exec_ffmpeg_edit / exec_remotion_render com background=true)
    const asyncPromise = new Promise<ReturnType<typeof service.getJob>>((resolveAsync) => {
      service.setOnComplete((job) => {
        if (job.kind === "async_task") resolveAsync(job);
      });
    });
    const asyncStart = service.startAsyncTask(
      { agenteId: "estrategista", workspaceRoot: dir },
      {
        label: "Render Remotion Assíncrono",
        onCompleteInstruction: "Publicar prévia do Reel.",
        run: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return { output_path: "saidas/videos/reel.mp4", duration_s: 32 };
        },
      }
    );
    assert.equal(asyncStart.kind, "async_task");
    const asyncDone = await asyncPromise;
    assert.equal(asyncDone?.status, "concluido");
    assert.match(asyncDone?.resultSummary ?? "", /saidas\/videos\/reel\.mp4/);

    // Limite máximo por agente
    for (let i = 0; i < MAX_ACTIVE_BG_JOBS_PER_AGENT; i += 1) {
      service.startCommandJob(
        { agenteId: "estrategista", workspaceRoot: dir },
        {
          label: `Hold ${i}`,
          executable: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000);"],
          onCompleteInstruction: "Hold",
        }
      );
    }
    assert.throws(() => {
      service.startCommandJob(
        { agenteId: "estrategista", workspaceRoot: dir },
        {
          label: "Excedente",
          executable: process.execPath,
          args: ["-e", "process.exit(0)"],
          onCompleteInstruction: "Falha esperada",
        }
      );
    }, /Limite/);

    service.dispose();
    db.close();
  });

  it("3. turn-context-planner, LazyToolRouter e guidance liberam background jobs e wakeups para TODOS os agentes em ação", () => {
    const planVideo = planTurnContext({
      userPrompt: "edite o vídeo principal e faça o corte de silêncios",
      agenteId: "editor_video",
      isGreetingOrCapability: false,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasActiveBackgroundJobs: false,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
    });
    assert.equal(planVideo.mode, "action");
    assert.ok(planVideo.mcpScopes.includes("core"));
    assert.ok(planVideo.mcpScopes.includes("media"));

    const scopeSet = new Set(planVideo.mcpScopes);
    for (const toolName of [
      "start_background_job",
      "list_background_jobs",
      "get_background_job",
      "cancel_background_job",
      "schedule_wakeup",
      "list_wakeups",
      "cancel_wakeup",
    ]) {
      assert.equal(
        toolBelongsToScopes(toolName, scopeSet),
        true,
        `${toolName} deve estar liberada no escopo core+media`
      );
      assert.equal(
        DEFAULT_CORE_EXPOSED_TOOLS.has(toolName),
        true,
        `${toolName} deve permanecer exposta no LazyToolRouter`
      );
    }
    assert.equal(toolBelongsToScopes("create_routine", scopeSet), false);

    // Job ativo força modo action mesmo em saudação curta ("oi")
    const wakeDuringBg = planTurnContext({
      userPrompt: "oi",
      agenteId: "editor_video",
      isGreetingOrCapability: true,
      anexosCount: 0,
      hasOpenBrowserTabs: false,
      hasActiveWakeups: false,
      hasActiveBackgroundJobs: true,
      hasWokenWaits: false,
      isHandoff: false,
      isRoutine: false,
    });
    assert.equal(wakeDuringBg.mode, "action");

    const guidance = buildPhase13SystemGuidance({ includeScheduleTools: false });
    assert.match(guidance, /start_background_job/);
    assert.match(guidance, /schedule_wakeup/);
    assert.match(guidance, /REGRA ANTI-SILÊNCIO/);

    // LazyToolRouter com > 20 tools continua expondo tools de background e wakeup
    const manyTools = Array.from({ length: 25 }, (_, i) => ({
      name: `extra_tool_${i}`,
      description: "tool extra",
      parameters: { type: "object", properties: {} },
    }));
    manyTools.push(
      { name: "start_background_job", description: "bg", parameters: { type: "object", properties: {} } },
      { name: "schedule_wakeup", description: "wk", parameters: { type: "object", properties: {} } }
    );
    const router = new LazyToolRouter(manyTools, { enabled: true, threshold: 20 });
    const exposedNames = new Set(router.selectExposedTools().map((t) => t.name));
    assert.equal(exposedNames.has("start_background_job"), true);
    assert.equal(exposedNames.has("schedule_wakeup"), true);
  });

  it("4. Helpers ACP/Safety-Net detectam comandos em background do CLI e promessas de espera sem handle", () => {
    assert.equal(
      detectAcpBackgroundTaskOutput("Command started running in background (pid 1234)"),
      true
    );
    assert.equal(
      detectAcpBackgroundTaskOutput({ status: "ok", run_in_background: true }),
      true
    );
    assert.equal(detectAcpBackgroundTaskOutput("Arquivo salvo com sucesso."), false);

    assert.equal(
      promisesBackgroundContinuationWithoutHandle(
        "Render rodando em background.\n\nAssim que o MP4 fechar, sigo para o Reel de 72s e o exec_remotion_render."
      ),
      true
    );
    assert.equal(
      promisesBackgroundContinuationWithoutHandle(
        "Concluí a renderização do vídeo e o arquivo final está pronto em saidas/videos/final.mp4."
      ),
      false
    );
  });

  it("5. Integração ponta a ponta no daemon: MCP start_background_job acorda agente e grava continuação", async () => {
    const dir = makeTempDir("criativo-p409-e2e-");
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    const rt = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "e2e.sqlite"),
      workspaceRoot: dir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    runtimes.push(rt);

    try {
      const mcpTools = rt.studioMcpBridge.listToolsForAgent("estrategista", ["core", "media"]);
      const toolNames = new Set(mcpTools.map((t) => t.name));
      assert.equal(toolNames.has("start_background_job"), true);
      assert.equal(toolNames.has("schedule_wakeup"), true);

      const res = (await rt.studioMcpBridge.callToolForAgent(
        "start_background_job",
        {
          label: "E2E Node Task",
          executable: process.execPath,
          args: ["-e", "console.log('e2e_bg_done');"],
          onCompleteInstruction: "Confirmar conclusão E2E.",
        },
        "estrategista",
        { threadId: "main:estrategista" }
      )) as { ok?: boolean; jobId?: string };

      assert.equal(res.ok, true);
      assert.ok(res.jobId?.startsWith("bg_"));

      let rows: Array<{ conteudo_markdown: string; metadados_json: string }> = [];
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        rows = rt.db.connection
          .prepare(
            `SELECT conteudo_markdown, metadados_json
             FROM projecao_conversas_chat
             WHERE agente_id = 'estrategista'
               AND metadados_json LIKE '%background_job%'
             ORDER BY ordinal DESC LIMIT 5;`
          )
          .all() as Array<{ conteudo_markdown: string; metadados_json: string }>;
        if (rows.length > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.ok(
        rows.some((r) => r.metadados_json.includes("background_job")),
        "Mensagem de despertar do background job deve estar persistida no chat"
      );
    } finally {
      if (prevSkip === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    }
  });
});
