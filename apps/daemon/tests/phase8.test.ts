import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { AntigravityAcpService } from "../src/providers/antigravity-acp-service.ts";
import { AntigravityLiveService } from "../src/providers/antigravity-live-service.ts";
import { CliOAuthAccountsService } from "../src/providers/cli-oauth-accounts-service.ts";
import {
  computeHostAnalytics,
  importExternalTelemetryIfAvailable,
  listInstalledSkills,
  recordChatTurnUsage,
} from "../src/server/analytics-skills-service.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

describe("Fase 8 — Conexões Reais Multi-Conta, Limites Dinâmicos, Analytics e Conectores", () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase8-"));
    dbPath = join(tempDir, "criativo-phase8.db");
    runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    baseUrl = `http://127.0.0.1:${runtime.port}`;
  });

  after(async () => {
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
  });

  it("gerencia apenas contas próprias do Studio (sem scraping externo), consulta cotas/modelos e executa ACP + generateContent", async () => {
    const accountsRoot = join(tempDir, "studio-contas-gemini");
    mkdirSync(accountsRoot, { recursive: true });

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith(":loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "proj-demo-1" }), { status: 200 });
      }
      if (url.endsWith(":retrieveUserQuotaSummary")) {
        return new Response(
          JSON.stringify({
            groups: [
              {
                displayName: "Gemini Models",
                description: "Models within this group: Gemini 3.8 Flash",
                buckets: [
                  { window: "5h", remainingFraction: 0.65, resetTime: new Date(Date.now() + 3600_000).toISOString() },
                  {
                    window: "weekly",
                    remainingFraction: 0.89,
                    resetTime: new Date(Date.now() + 6 * 86400_000).toISOString(),
                  },
                ],
              },
              {
                displayName: "Claude and GPT models",
                description: "Models within this group: Claude Opus 5.5, GPT-OSS 120B",
                buckets: [{ window: "weekly", remainingFraction: 1.0, resetTime: new Date(Date.now() + 6 * 86400_000).toISOString() }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith(":fetchAvailableModels")) {
        return new Response(
          JSON.stringify({
            defaultAgentModelId: "gemini-3.8-flash-high",
            imageGenerationModelIds: ["gemini-3.1-flash-image"],
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash",
                supportsThinking: true,
                recommended: true,
                modelProvider: "MODEL_PROVIDER_GOOGLE",
                quotaInfo: { remainingFraction: 0.65 },
              },
              "gemini-3.8-flash-low": {
                displayName: "Gemini 3.8 Flash",
                supportsThinking: true,
                modelProvider: "MODEL_PROVIDER_GOOGLE",
                quotaInfo: { remainingFraction: 0.65 },
              },
              "claude-opus-5-5-medium": {
                displayName: "Claude Opus 5.5",
                supportsThinking: true,
                modelProvider: "MODEL_PROVIDER_ANTHROPIC",
                quotaInfo: { remainingFraction: 1.0 },
              },
              "gemini-3.1-flash-image": {
                displayName: "Gemini 3.1 Flash Image",
                supportsImages: true,
                modelProvider: "MODEL_PROVIDER_GOOGLE",
                quotaInfo: { remainingFraction: 0.65 },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith(":generateContent")) {
        return new Response(
          JSON.stringify({
            response: {
              candidates: [{ content: { parts: [{ text: "Roteiro criado ao vivo para [@SEU_PERFIL]." }] } }],
              usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 45 },
            },
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    };

    const service = new AntigravityLiveService({
      db: runtime.db,
      accountsRootDir: accountsRoot,
      workspaceCwd: tempDir,
      fetchImpl: mockFetch,
    });

    // 0. Ambiente limpo começa com 0 contas (zero scraping de pastas externas)
    const emptySnap = await service.getLiveSnapshot(true);
    assert.equal(emptySnap.contas.length, 0);

    // 1. Conecta 2 contas próprias do Studio e testa deduplicação ao repetir mesmo e-mail
    service.addManualTokenAccount({
      email: "criador-principal@exemplo.local",
      label: "Principal",
      accessToken: "tok-default-demo",
    });
    service.addManualTokenAccount({
      email: "criador-principal@exemplo.local",
      label: "Principal Atualizada",
      accessToken: "tok-default-novo",
    });
    const acc2 = service.addManualTokenAccount({
      email: "criador-reserva@exemplo.local",
      label: "Conta Reserva",
      accessToken: "tok-reserva-demo",
    });

    const snap = await service.getLiveSnapshot(true);
    assert.equal(snap.contas.length, 2);
    assert.equal(snap.contas[0].email, "criador-principal@exemplo.local");
    assert.equal(snap.contas[1].email, "criador-reserva@exemplo.local");
    assert.equal(snap.contas[0].grupos_cota.length, 2);
    assert.equal(snap.contas[0].grupos_cota[0].janela_5h?.restante_percentual, 65);
    assert.ok(snap.modelos.some((m) => m.id === "claude-opus-5-5-medium"));
    // Deduplicou gemini-3.8-flash-high e -low que tinham mesmo displayName
    assert.equal(snap.modelos.filter((m) => m.rotulo === "Gemini 3.8 Flash").length, 1);
    assert.equal(snap.pool?.habilitado, true);

    const gen = await service.executeCodeAssistGenerate({
      model: "gemini-3.8-flash-high",
      messages: [{ role: "user", text: "Gerar hook" }],
    });
    assert.ok(gen.text.includes("Roteiro criado ao vivo"));
    assert.equal(gen.usage.uncachedInput, 100);
    assert.equal(gen.usage.cachedInput, 20);
    assert.equal(gen.usage.output, 45);

    assert.equal(service.removeAccount(acc2.id), true);
    const afterDel = await service.getLiveSnapshot(true);
    assert.equal(afterDel.contas.length, 1);

    // 2. Testa protocolo JSON-RPC ACP de Sign-In navegador + prompt streaming com processo simulado
    const mockAcpScript = join(tempDir, "mock-acp-server.mjs");
    writeFileSync(
      mockAcpScript,
      `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { createInterface } from "node:readline";
      const targetDir = process.argv[2];
      const rl = createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: false } } } }) + "\\n");
        } else if (msg.method === "authenticate") {
          mkdirSync(join(targetDir, "antigravity-acp"), { recursive: true });
          writeFileSync(join(targetDir, "antigravity-acp", "antigravity-oauth-token"), JSON.stringify({ id_token_email: "oauth-acp@exemplo.local", token: { access_token: "tok-acp", refresh_token: "ref-acp", expiry: new Date(Date.now() + 3600000).toISOString() } }));
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        } else if (msg.method === "session/new") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-1", configOptions: [{ id: "model", category: "model", currentValue: "gemini-3.8-flash-high", options: [{ value: "gemini-3.8-flash-high" }] }] } }) + "\\n");
        } else if (msg.method === "session/set_config_option") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { configOptions: [] } }) + "\\n");
        } else if (msg.method === "session/prompt") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Resposta real via ACP" } } } }) + "\\n");
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
        } else if (msg.method === "session/close") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
      `,
      "utf8"
    );

    const acpSvc = new AntigravityAcpService({
      executableOverride: process.execPath,
      spawnArgsFactory: (dir) => [mockAcpScript, dir],
    });
    const acpGeminiDir = join(accountsRoot, "ag-acp-mock");
    try {
      const signed = await acpSvc.signInWithGoogleBrowser({ geminiDir: acpGeminiDir });
      assert.equal(signed.email, "oauth-acp@exemplo.local");
      const out = await acpSvc.executePrompt("ag-acp-mock", {
        geminiDir: acpGeminiDir,
        cwd: tempDir,
        promptText: "Olá",
        modelId: "gemini-3.8-flash-high",
      });
      assert.equal(out.text, "Resposta real via ACP");
    } finally {
      acpSvc.closeAll();
    }

    // 3. Confirma isolamento de contas Claude/OpenAI OAuth sem ler pastas de terceiros
    const cliSvc = new CliOAuthAccountsService({
      db: runtime.db,
      workspaceCwd: tempDir,
      accountsRootDir: join(tempDir, "studio-contas-cli"),
    });
    assert.equal(cliSvc.listAccounts("claude").length, 0);
    assert.equal(cliSvc.listAccounts("openai").length, 0);
  });

  it("importa histórico de telemetria SQLite, registra novos turnos e expõe GET /api/uso/analytics", async () => {
    const extDbPath = join(tempDir, "ext-telemetry-mock.db");
    const extDb = new DatabaseSync(extDbPath);
    extDb.exec(`
      CREATE TABLE projection_agents (agent_id TEXT PRIMARY KEY, agent_json TEXT NOT NULL);
      CREATE TABLE agent_usage_records (
        agent_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        tokens_json TEXT NOT NULL,
        estimated_cost_usd REAL,
        rate_basis TEXT,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE agent_usage_skill_loads (
        agent_id TEXT NOT NULL,
        load_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        skill TEXT NOT NULL,
        tokens INTEGER,
        estimated_cost_usd REAL,
        occurred_at TEXT NOT NULL
      );
    `);
    const nowIso = new Date().toISOString();
    extDb
      .prepare(`INSERT INTO projection_agents VALUES (?, ?);`)
      .run("ext-agent-1", JSON.stringify({ name: "Organizador pessoal" }));
    extDb
      .prepare(`INSERT INTO agent_usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`)
      .run(
        "ext-agent-1",
        "rec-import-1",
        "sess-1",
        "turn-1",
        "antigravity",
        "gemini-4-hydrogen",
        nowIso,
        JSON.stringify({ uncachedInput: 37866, cachedInput: 32728, cacheCreation: 0, output: 5071 }),
        null,
        null,
        nowIso
      );
    extDb.close();

    const count = importExternalTelemetryIfAvailable(runtime.db, extDbPath);
    assert.equal(count, 1);

    recordChatTurnUsage(runtime.db, {
      agentId: "estrategista",
      sessionId: "chat:estrategista",
      turnId: "turn-new-1",
      provider: "antigravity",
      model: "gemini-3.8-flash-high",
      uncachedInput: 500,
      cachedInput: 100,
      output: 250,
    });

    const analyticsLocal = computeHostAnalytics(runtime.db, { dias: 30 });
    assert.equal(analyticsLocal.totais.sessoes, 2);
    assert.equal(analyticsLocal.totais.entrada_sem_cache, 38366);
    assert.equal(analyticsLocal.totais.entrada_cache, 32828);
    assert.equal(analyticsLocal.totais.saida, 5321);
    assert.equal(analyticsLocal.totais.tokens_sem_cache, 38366 + 5321);
    assert.equal(analyticsLocal.totais.tokens_processados, 38366 + 5321 + 32828);
    assert.ok(analyticsLocal.por_agente.some((a) => a.nome === "Organizador pessoal"));

    const res = await fetch(`${baseUrl}/api/uso/analytics?dias=30`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { analytics: typeof analyticsLocal };
    assert.equal(body.analytics.totais.turnos, 2);
  });

  it("lê SKILL.md reais de pasta local, expõe conectores e configura segredos sem selects crus", async () => {
    const fakeSkillsDir = join(tempDir, "skills");
    mkdirSync(join(fakeSkillsDir, "criar-carrossel"), { recursive: true });
    writeFileSync(
      join(fakeSkillsDir, "criar-carrossel", "SKILL.md"),
      `---\nname: criar-carrossel\ndescription: Carrossel editorial 4:5\n---\n# Instruções\nCrie 5 lâminas.`
    );

    const skills = listInstalledSkills(runtime.db, fakeSkillsDir);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].nome, "criar-carrossel");
    assert.ok(skills[0].agentes_vinculados.length >= 0);

    const cfgRes = await fetch(`${baseUrl}/api/conectores/instagram/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agente_orquestrador_id: "publicador_meta",
        segredos: {
          instagram_access_token: "EAAG-token-sintetico-1234",
          instagram_business_account_id: "1784140000009999",
        },
      }),
    });
    assert.equal(cfgRes.status, 200);

    const listRes = await fetch(`${baseUrl}/api/conectores`);
    assert.equal(listRes.status, 200);
    const data = (await listRes.json()) as { conectores: Array<{ id: string; status: string }> };
    const ig = data.conectores.find((c) => c.id === "instagram");
    assert.equal(ig?.status, "conectado");
  });

  it("transmite chat:message do usuário e eventos chat:progress em tempo real via WebSocket e injeta WSL_DISTRO_NAME no ACP", async () => {
    // 1. Verifica injeção de WSL_DISTRO_NAME no processo filho do AntigravityAcpService
    const envCheckScript = join(tempDir, "mock-acp-env-check.mjs");
    writeFileSync(
      envCheckScript,
      `
        import readline from "node:readline";
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { agentCapabilities: { promptCapabilities: { image: false } } } }) + "\\n");
          } else if (msg.method === "authenticate") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { envDistro: process.env.WSL_DISTRO_NAME || null } }) + "\\n");
          } else if (msg.method === "session/new") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s-env" } }) + "\\n");
          } else if (msg.method === "session/prompt") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              method: "session/update",
              params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "DISTRO=" + (process.env.WSL_DISTRO_NAME || "") } } }
            }) + "\\n");
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
          }
        });
      `,
      "utf8"
    );

    const envAcp = new AntigravityAcpService({
      executableOverride: process.execPath,
      spawnArgsFactory: () => [envCheckScript],
    });
    try {
      const chunks: string[] = [];
      const out = await envAcp.executePrompt("ag-env-1", {
        geminiDir: join(tempDir, "gem-env-check"),
        cwd: tempDir,
        promptText: "ping",
        onDelta: (c) => chunks.push(c),
      });
      assert.equal(out.text, "DISTRO=CriativoStudio");
      assert.deepEqual(chunks, ["DISTRO=CriativoStudio"]);
    } finally {
      envAcp.closeAll();
    }

    // 2. Valida ordem de eventos WebSocket em tempo real ao enviar mensagem
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}/ws`;
    const receivedEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolveWs, rejectWs) => {
      const t = setTimeout(() => rejectWs(new Error("Timeout conectando WebSocket de teste.")), 4000);
      ws.addEventListener("open", () => {
        clearTimeout(t);
        resolveWs();
      });
      ws.addEventListener("error", () => {
        clearTimeout(t);
        rejectWs(new Error("Erro no WebSocket de teste."));
      });
    });

    ws.addEventListener("message", (evt) => {
      try {
        const parsed = JSON.parse(String(evt.data)) as { event: string; data: Record<string, unknown> };
        receivedEvents.push(parsed);
      } catch {
        // ignora
      }
    });

    try {
      const chatRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: "Teste de tempo real no chat" }),
      });
      assert.equal(chatRes.status, 201);

      // Aguarda último envelope WS ser entregue
      await new Promise((r) => setTimeout(r, 150));

      const chatOrProgress = receivedEvents.filter(
        (e) => e.event === "chat:message" || e.event === "chat:progress"
      );
      assert.ok(chatOrProgress.length >= 4, "Esperava eventos chat:message e chat:progress");

      const firstEvt = chatOrProgress[0];
      assert.equal(firstEvt.event, "chat:message");
      const firstMsg = firstEvt.data.mensagem as { autor?: string };
      assert.equal(firstMsg.autor, "usuario");

      assert.ok(
        chatOrProgress.some(
          (e) => e.event === "chat:progress" && e.data.fase === "iniciado"
        )
      );
      assert.ok(
        chatOrProgress.some(
          (e) => e.event === "chat:progress" && e.data.fase === "concluido"
        )
      );
    } finally {
      ws.close();
    }
  });

  it("persiste visibilidade de modelos por provedor e responde cancelar-login", async () => {
    const visRes = await fetch(`${baseUrl}/api/provedores/gemini/modelos-visibilidade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ocultos: ["gemini-3.8-flash-high"] }),
    });
    assert.equal(visRes.status, 200);
    const visJson = (await visRes.json()) as {
      ok: boolean;
      provedores: Array<{
        provedor: string;
        modelos: Array<{ id: string; oculto?: boolean }>;
      }>;
    };
    assert.equal(visJson.ok, true);
    const gem = visJson.provedores.find((p) => p.provedor === "gemini");
    assert.ok(gem, "Provedor gemini presente no retorno");
    const hiddenModel = gem.modelos.find((m) => m.id === "gemini-3.8-flash-high");
    assert.equal(hiddenModel?.oculto, true);

    const cancelRes = await fetch(`${baseUrl}/api/provedores/claude/cancelar-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = (await cancelRes.json()) as { ok: boolean; canceled: boolean };
    assert.equal(cancelJson.ok, true);
    assert.equal(cancelJson.canceled, false);
  });

  it("descobre modelos reais via antigravity ACP (Argon/Hydrogen/Orchestrator) e consulta cotas de Claude", async () => {
    // 1. Mock ACP retornando availableModels reais (session/new) + Code Assist com imagem
    const acpModelsScript = join(tempDir, "mock-acp-models.mjs");
    writeFileSync(
      acpModelsScript,
      `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { createInterface } from "node:readline";
      const targetDir = process.argv[2];
      const rl = createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }) + "\\n");
        } else if (msg.method === "authenticate") {
          mkdirSync(join(targetDir, "antigravity-acp"), { recursive: true });
          writeFileSync(
            join(targetDir, "antigravity-acp", "antigravity-oauth-token"),
            JSON.stringify({
              id_token_email: "acp-models@exemplo.local",
              token: { access_token: "tok-acp-m", refresh_token: "ref-acp-m", expiry: new Date(Date.now() + 3600000).toISOString() },
            })
          );
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        } else if (msg.method === "session/new") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              sessionId: "sess-models-1",
              models: {
                currentModelId: "gemini-4-argon-medium",
                availableModels: [
                  { modelId: "gemini-4-argon-low", name: "Gemini 4 Argon (Low)" },
                  { modelId: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
                  { modelId: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" },
                  { modelId: "gemini-4-hydrogen-xhigh", name: "Gemini 4 Hydrogen (XHigh)" },
                  { modelId: "gemini-pro-orchestrator-g1-pro", name: "Orchestrator (Argon)" },
                  { modelId: "claude-opus-5-5-high", name: "Claude Opus 5.5 (High)" },
                  { modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" }
                ]
              }
            }
          }) + "\\n");
        } else if (msg.method === "session/close") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
      `,
      "utf8"
    );

    const acpModelsRoot = join(tempDir, "ag-acp-models");
    const acpSvc = new AntigravityAcpService({
      executableOverride: process.execPath,
      spawnArgsFactory: (dir) => [acpModelsScript, dir],
    });
    const mockFetchImg: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(":loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "proj-acp" }), { status: 200 });
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return new Response(
          JSON.stringify({
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [{ window: "5h", remainingFraction: 0.82, resetTime: new Date(Date.now() + 3600000).toISOString() }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes(":fetchAvailableModels")) {
        return new Response(
          JSON.stringify({
            imageGenerationModelIds: ["gemini-3.1-flash-image"],
            models: {
              "gemini-3.1-flash-image": { displayName: "Nano Banana (Imagem)", supportsImages: true },
            },
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    };

    const liveAcpSvc = new AntigravityLiveService({
      db: runtime.db,
      accountsRootDir: acpModelsRoot,
      workspaceCwd: tempDir,
      fetchImpl: mockFetchImg,
      acpService: acpSvc,
    });
    try {
      await liveAcpSvc.connectGoogleViaBrowser("Conta ACP Modelos");
      const snapAcp = await liveAcpSvc.getLiveSnapshot(true);
      assert.ok(snapAcp.modelos.some((m) => m.id === "gemini-4-argon" && m.rotulo === "Gemini 4 Argon"));
      assert.ok(snapAcp.modelos.some((m) => m.id === "gemini-4-hydrogen" && m.rotulo === "Gemini 4 Hydrogen"));
      assert.ok(snapAcp.modelos.some((m) => m.id === "gemini-pro-orchestrator-g1-pro" && m.rotulo === "Orchestrator (Argon)"));
      assert.ok(snapAcp.modelos.some((m) => m.id === "gpt-oss-120b-medium"));
      assert.ok(snapAcp.modelos.some((m) => m.id === "gemini-3.1-flash-image"));
    } finally {
      acpSvc.closeAll();
    }

    // 2. Consulta cotas reais de Claude via api.anthropic.com/api/oauth/usage mockada
    const cliRoot = join(tempDir, "cli-oauth-quotas");
    const clDir = join(cliRoot, "claude", "cl-test1");
    mkdirSync(clDir, { recursive: true });
    writeFileSync(
      join(clDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "tok-cl-test" } })
    );
    writeFileSync(
      join(clDir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "claude-cota@exemplo.local", billingType: "max" } })
    );
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('studio_cli_accounts', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json;`
      )
      .run(
        JSON.stringify([
          {
            id: "cl-test1",
            provedor: "claude",
            configDir: clDir,
            label: "Claude Teste",
            email: "claude-cota@exemplo.local",
            plano: "Claude Max",
          },
        ]),
        new Date().toISOString()
      );

    const cliQuotaSvc = new CliOAuthAccountsService({
      db: runtime.db,
      accountsRootDir: cliRoot,
      workspaceCwd: tempDir,
      fetchImpl: async (url) => {
        if (String(url).includes("/api/oauth/usage")) {
          return new Response(
            JSON.stringify({
              five_hour: { utilization: 25, resets_at: new Date(Date.now() + 7200000).toISOString() },
              seven_day: { utilization: 40, resets_at: new Date(Date.now() + 86400000).toISOString() },
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 404 });
      },
    });
    const clQuotas = await cliQuotaSvc.listAccountsWithQuotas("claude", true);
    assert.equal(clQuotas.length, 1);
    assert.equal(clQuotas[0].grupos_cota.length, 1);
    assert.equal(clQuotas[0].grupos_cota[0].janela_5h?.restante_percentual, 75);
    assert.equal(clQuotas[0].grupos_cota[0].janela_semanal?.restante_percentual, 60);
  });
});
