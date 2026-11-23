import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHmac, generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import type { BackupModelChoice, ContaProvedorInfo, ProvedorStatusInfo } from "@criativo/contracts";
import { CriativoDatabase } from "../src/database/client.ts";
import { BackupModelsResolver, isRetryableQuotaOrProviderError } from "../src/engine/runner/backup-models-resolver.ts";
import { seedDefaultAgents } from "../src/engine/runner/roster-defaults.ts";
import { assertSafeNavigationUrl } from "../src/engine/tools/browser-snapshot.ts";
import { readImageTool } from "../src/engine/tools/image-reader.ts";
import { UserBrowsingLogService } from "../src/engine/tools/user-browsing-log.ts";
import { readVideoTool } from "../src/engine/tools/video-reader.ts";
import { selectPoolAccount } from "../src/providers/provider-connection-service.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { executeShowcaseTool } from "../src/server/showcase-service.ts";
import { executeSidebarTool } from "../src/server/sidebar-service.ts";

function buildValidPngBuffer(width = 2, height = 2): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * rowSize] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createFakeProcess(
  code: number,
  stdout = "",
  stderr = "",
  onSpawn?: () => void,
): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => true;
  queueMicrotask(() => {
    onSpawn?.();
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout, "utf8"));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr, "utf8"));
    proc.emit("close", code);
  });
  return proc;
}

describe("Fase 15 — Navegador CDP, Mídia, Backup Models, Sidebar, Settings, Storage, Conectores & Showcase", () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let testPageServer: HttpServer;
  let testPageUrl: string;
  let prevSkipProbe: string | undefined;
  let prevAllowLocalhost: string | undefined;

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    prevAllowLocalhost = process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER = "1";

    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase15-"));
    mkdirSync(join(tempDir, "recursos", "Uploads"), { recursive: true });
    mkdirSync(join(tempDir, "saidas"), { recursive: true });
    mkdirSync(join(tempDir, "previas"), { recursive: true });

    dbPath = join(tempDir, "criativo-phase15.db");
    runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    seedDefaultAgents(runtime.db);
    baseUrl = `http://127.0.0.1:${runtime.port}`;

    testPageServer = createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><head><title>Formulário [NOME_DA_MARCA]</title></head><body><h1>Portal</h1><form><input aria-label='Usuário' placeholder='usuario' /><input type='password' aria-label='Senha' /><button type='submit'>Entrar</button></form></body></html>",
      );
    });
    await new Promise<void>((resolvePromise) => {
      testPageServer.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const addr = testPageServer.address() as { port: number };
    testPageUrl = `http://127.0.0.1:${addr.port}/login`;
  });

  after(async () => {
    await new Promise<void>((resolvePromise) => {
      testPageServer.close(() => resolvePromise());
    });
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    if (prevAllowLocalhost === undefined) delete process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER;
    else process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER = prevAllowLocalhost;
  });

  it("Bloco 1 — aplica migrações SQLite da Fase 15 de forma idempotente preservando dados legados", () => {
    const legacyDbPath = join(tempDir, "legacy-p15.db");
    const raw = new DatabaseSync(legacyDbPath);
    raw.exec(`
      CREATE TABLE projecao_perfis_navegador (
        perfil_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        user_data_dir TEXT NOT NULL,
        proxy_url TEXT,
        ultimo_uso_em TEXT
      );
      INSERT INTO projecao_perfis_navegador (perfil_id, nome, user_data_dir)
      VALUES ('perf-legado', 'Perfil Antigo', 'dados/browser-profiles/perf-legado');

      CREATE TABLE projecao_agentes (
        agente_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        papel TEXT NOT NULL,
        pasta TEXT NOT NULL,
        modelo_padrao TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'ocioso',
        config_json TEXT NOT NULL DEFAULT '{}',
        atualizado_em TEXT NOT NULL
      );
      INSERT INTO projecao_agentes (agente_id, nome, papel, pasta, modelo_padrao, atualizado_em)
      VALUES ('legado-1', 'Agente Antigo', 'Pesquisa', 'custom', 'gemini-2.5-flash', '2026-01-01T00:00:00.000Z');
    `);
    raw.close();

    const db = new CriativoDatabase({ dbPath: legacyDbPath });
    db.initializeDatabase();
    db.initializeDatabase(); // segunda passagem deve ser 100% idempotente

    const perfilRow = db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = 'perf-legado';")
      .get() as Record<string, unknown>;
    assert.equal(perfilRow.nome, "Perfil Antigo");
    assert.equal(perfilRow.cor_hex, "#42A0FF");
    assert.equal(perfilRow.proxy_json, "{}");

    const agentCols = db.connection
      .prepare("PRAGMA table_info(projecao_agentes);")
      .all() as Array<{ name: string }>;
    const agentColNames = new Set(agentCols.map((c) => c.name));
    assert.ok(agentColNames.has("backup_models_json"));
    assert.ok(agentColNames.has("permission_level"));
    assert.ok(agentColNames.has("allow_new_chat"));
    assert.ok(agentColNames.has("allow_quick_ack"));
    assert.ok(agentColNames.has("browser_profile_id"));

    const tables = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table';")
      .all() as Array<{ name: string }>;
    const tableSet = new Set(tables.map((t) => t.name));
    for (const requiredTable of [
      "projecao_browser_proxies",
      "projecao_agent_browsing_log",
      "projecao_sidebar_secoes",
      "projecao_showcase_sites",
    ]) {
      assert.ok(tableSet.has(requiredTable), `Tabela ausente: ${requiredTable}`);
    }

    const agentRow = db.connection
      .prepare("SELECT nome FROM projecao_agentes WHERE agente_id = 'legado-1';")
      .get() as { nome: string };
    assert.equal(agentRow.nome, "Agente Antigo");
    db.connection.close();
  });

  it("Bloco 2 — valida SSRF, CRUD de proxies/perfis sem vazar senha, UserBrowsingLog, Takeover, submitSecret e Teach", async () => {
    const savedAllow = process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER;
    delete process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER;
    try {
      for (const badUrl of [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "chrome://settings",
        "http://169.254.169.254/latest/meta-data",
        "http://127.0.0.1:4190/api/saude",
      ]) {
        assert.throws(() => assertSafeNavigationUrl(badUrl));
      }
      assert.equal(assertSafeNavigationUrl("https://exemplo.invalid/posts").hostname, "exemplo.invalid");
    } finally {
      if (savedAllow !== undefined) process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER = savedAllow;
    }

    // Proxies e Perfis
    const proxySecret = `SENHA_PROXY_${randomUUID().slice(0, 8)}`;
    const proxyRes = await fetch(`${baseUrl}/api/navegador/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Proxy Teste",
        servidor: "http://proxy.exemplo.invalid:8080",
        usuario: "operador_proxy",
        senha: proxySecret,
      }),
    });
    assert.equal(proxyRes.status, 201);
    const proxyRawText = await proxyRes.clone().text();
    assert.ok(!proxyRawText.includes(proxySecret), "Senha de proxy jamais deve aparecer na resposta HTTP");
    const proxyJson = JSON.parse(proxyRawText) as {
      proxy: { proxy_id: string; senha_configurada: boolean };
    };
    assert.equal(proxyJson.proxy.senha_configurada, true);

    const createProfileRes = await fetch(`${baseUrl}/api/navegador/perfis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Conta [NOME_DA_MARCA]",
        cor_hex: "#31CF76",
        proxy_json: {
          proxy_id: proxyJson.proxy.proxy_id,
          server: "http://proxy.exemplo.invalid:8080",
          username: "operador_proxy",
        },
      }),
    });
    assert.equal(createProfileRes.status, 201);
    const createdProf = (await createProfileRes.json()) as {
      perfil: { perfil_id: string; nome: string; cor_hex: string };
    };
    assert.equal(createdProf.perfil.nome, "Conta [NOME_DA_MARCA]");

    const updateProfRes = await fetch(`${baseUrl}/api/navegador/perfis/${createdProf.perfil.perfil_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Conta Principal", proxy_json: null }),
    });
    assert.equal(updateProfRes.status, 200);

    // UserBrowsingLogService: remoção de query/hash, :id, limite 80 e retenção 30d
    const logSvc = new UserBrowsingLogService(runtime.db);
    logSvc.recordStep("estrategista", {
      kind: "page",
      url: "https://exemplo.invalid/campanhas/550e8400-e29b-41d4-a716-446655440000/detalhes/abcdef1234567890?token=SEGREDO_ABC#hash123",
      title: "Título longo ".repeat(12),
    });
    logSvc.recordStep("estrategista", {
      kind: "click",
      url: "https://exemplo.invalid/campanhas/12345?secret=xyz",
      role: "button",
      name: "Publicar agora",
    });
    // Passo antigo (> 30 dias) deve ser podado ao registrar próximo passo
    const oldMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_agent_browsing_log (log_id, agente_id, kind, host, path, title, role, name, revisado, criado_em)
         VALUES ('ubl-antigo', 'estrategista', 'page', 'exemplo.invalid', '/expirado', 'Antigo', NULL, NULL, 0, ?);`,
      )
      .run(oldMs);
    for (let i = 0; i < 85; i += 1) {
      logSvc.recordStep("estrategista", {
        kind: "page",
        url: `https://exemplo.invalid/passo/${i}`,
        title: `Passo ${i}`,
      });
    }
    const allSteps = logSvc.listSteps("estrategista");
    assert.equal(allSteps.length, 80);
    assert.ok(!allSteps.some((s) => s.path.includes("expirado")));
    assert.ok(!allSteps.some((s) => s.path.includes("SEGREDO") || s.path.includes("#")));

    const sampleSteps = logSvc.recordStep("copywriter", {
      kind: "page",
      url: "https://exemplo.invalid/posts/550e8400-e29b-41d4-a716-446655440000?auth=XYZ#sec",
      title: "A".repeat(120),
    });
    assert.ok(sampleSteps);
    assert.equal(sampleSteps.path, "/posts/:id");
    assert.ok((sampleSteps.title?.length ?? 0) <= 80);
    const recordedTxt = logSvc.formatRecordedTaskFile([sampleSteps]);
    assert.match(recordedTxt, /\[Página\] exemplo\.invalid\/posts\/:id/);

    // Status e CDP / State Machine
    const statusRes = await fetch(`${baseUrl}/api/navegador/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as { available: boolean };

    let activeTabId: string;
    if (statusJson.available) {
      const openRes = await fetch(`${baseUrl}/api/navegador/sessoes/acao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          agenteId: "estrategista",
          perfilId: createdProf.perfil.perfil_id,
          url: testPageUrl,
        }),
      });
      const openText = await openRes.text();
      assert.equal(openRes.status, 200, `Falha ao abrir aba CDP: ${openText}`);
      const openData = JSON.parse(openText) as {
        tabId?: string;
        pausedForHuman?: boolean;
        result?: { tabId?: string; pausedForHuman?: boolean };
      };
      activeTabId = openData.result?.tabId ?? openData.tabId!;

      if (openData.result?.pausedForHuman ?? openData.pausedForHuman) {
        await fetch(`${baseUrl}/api/navegador/sessoes/acao`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "release_takeover", tabId: activeTabId }),
        });
      }

      const snapRes = await fetch(`${baseUrl}/api/navegador/sessoes/acao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snapshot", tabId: activeTabId }),
      });
      assert.equal(snapRes.status, 200);

      const shotRes = await fetch(`${baseUrl}/api/navegador/sessoes/acao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screenshot", tabId: activeTabId }),
      });
      assert.equal(shotRes.status, 200);
    } else {
      // Quando binário Chromium não existe na máquina de CI, cria entrada de aba controlada no sessionManager para validar state machine HTTP real
      activeTabId = "tab-ci-virtual";
      const tabsMap = (
        runtime.browserService.sessionManager as unknown as { tabs: Map<string, Record<string, unknown>> }
      ).tabs;
      tabsMap.set(activeTabId, {
        tabId: activeTabId,
        perfilId: createdProf.perfil.perfil_id,
        agenteId: "estrategista",
        page: null,
        cdpSession: null,
        revision: 1,
        snapshotRefs: new Map(),
        lastDialog: null,
        pendingDialogObj: null,
        userControl: false,
        screencastActive: false,
        screencastTimer: null,
        lastFrameSentAt: 0,
        teachRecording: false,
        teachStartedAt: null,
        lastActivityAt: Date.now(),
        virtualUrl: "https://exemplo.invalid/login",
        virtualTitle: "Portal Teste",
      });
    }

    const tkStartRes = await fetch(`${baseUrl}/api/navegador/sessoes/${activeTabId}/takeover/iniciar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agenteId: "estrategista", reason: "login" }),
    });
    assert.equal(tkStartRes.status, 200);

    const teachStartRes = await fetch(`${baseUrl}/api/navegador/sessoes/${activeTabId}/teach/iniciar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agenteId: "estrategista" }),
    });
    assert.equal(teachStartRes.status, 200);

    const secretToken = `SENHA_SECRETA_${randomUUID().slice(0, 8)}`;
    const secRes = await fetch(`${baseUrl}/api/navegador/sessoes/${activeTabId}/segredo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "password",
        targets: [{ kind: "role", role: "textbox", name: "Senha" }],
        username: "usuario_teste",
        secret: secretToken,
        saveToVault: true,
        loginLabel: "Login Portal",
        submission: "none",
      }),
    });
    assert.equal(secRes.status, 200);
    const secRaw = await secRes.text();
    assert.ok(!secRaw.includes(secretToken), "Segredo injetado jamais pode voltar na resposta");

    const teachStopRes = await fetch(`${baseUrl}/api/navegador/sessoes/${activeTabId}/teach/parar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save" }),
    });
    assert.equal(teachStopRes.status, 200);

    const tkRespRes = await fetch(`${baseUrl}/api/navegador/sessoes/${activeTabId}/takeover/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "complete" }),
    });
    assert.equal(tkRespRes.status, 200);

    await fetch(`${baseUrl}/api/navegador/perfis/${createdProf.perfil.perfil_id}`, {
      method: "DELETE",
    });
    await fetch(`${baseUrl}/api/navegador/proxies/${proxyJson.proxy.proxy_id}`, {
      method: "DELETE",
    });
  });

  it("Bloco 3 — valida read_video, read_image e ScreenCaptureBridge (granted & declined)", async () => {
    const tmpBefore = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("criativo-video-")));

    // readVideoTool com spawnImpl injetado simulando yt-dlp + .vtt + ffmpeg
    const videoResult = await readVideoTool(
      { url: "https://video.exemplo.invalid/watch?v=123", frames: 2 },
      {
        spawnImpl: ((cmd: string, args: readonly string[]) => {
          if (args.includes("--version") || args.includes("-version")) {
            return createFakeProcess(0, "2026.1.0");
          }
          if (cmd === "yt-dlp" && args.includes("--dump-single-json")) {
            const outIdx = args.indexOf("-o");
            const prefix = outIdx >= 0 ? String(args[outIdx + 1]) : "";
            if (prefix) {
              writeFileSync(
                `${prefix}.pt.vtt`,
                "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nOlá criadores [NOME_DA_MARCA]!\n",
                "utf8",
              );
            }
            return createFakeProcess(
              0,
              JSON.stringify({
                title: "Vídeo Demo [NOME_DA_MARCA]",
                uploader: "Canal Oficial",
                webpage_url: "https://video.exemplo.invalid/watch?v=123",
                duration: 18,
                upload_date: "20261118",
                view_count: 1500,
                like_count: 120,
                comment_count: 14,
                description: "Descrição de teste",
              }),
            );
          }
          return createFakeProcess(1, "", "não solicitado");
        }) as unknown as typeof import("node:child_process").spawn,
        fetchImpl: (async () =>
          new Response("<html><title>Fallback</title></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          })) as unknown as typeof fetch,
      },
    );
    assert.equal(videoResult.title, "Vídeo Demo [NOME_DA_MARCA]");
    assert.equal(videoResult.transcript.length, 1);
    assert.equal(videoResult.transcript[0]?.seconds, 1);
    assert.match(videoResult.transcript[0]?.text ?? "", /Olá criadores/);

    // Degradação graciosa sem yt-dlp/ffmpeg + cleanup de pasta temporária
    const fallbackVideo = await readVideoTool(
      { url: "https://video.exemplo.invalid/no-bin", frames: 0 },
      {
        spawnImpl: (() => createFakeProcess(1, "", "ENOENT")) as unknown as typeof import("node:child_process").spawn,
        fetchImpl: (async () =>
          new Response("<html><meta property='og:title' content='Título OG Demo' /></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          })) as unknown as typeof fetch,
      },
    );
    assert.equal(fallbackVideo.title, "Título OG Demo");

    const tmpAfter = readdirSync(tmpdir()).filter((f) => f.startsWith("criativo-video-"));
    for (const d of tmpAfter) {
      assert.ok(tmpBefore.has(d), `Diretório temporário não foi removido: ${d}`);
    }

    await assert.rejects(() => readVideoTool({ url: "file:///etc/passwd" }));

    // readImageTool: PNG válido, magic bytes inválidos e path traversal
    const imgRel = "recursos/amostra-p15.png";
    writeFileSync(join(tempDir, imgRel), buildValidPngBuffer(2, 2));
    const imgRes = await readImageTool({ path: imgRel }, tempDir);
    assert.equal(imgRes.width, 2);
    assert.equal(imgRes.height, 2);
    assert.ok(imgRes.dataUrl.startsWith("data:image/png;base64,"));

    writeFileSync(join(tempDir, "recursos", "adulterada.png"), Buffer.from("NOT_A_PNG", "utf8"));
    await assert.rejects(() => readImageTool({ path: "recursos/adulterada.png" }, tempDir));
    await assert.rejects(() => readImageTool({ path: "../../package.json" }, tempDir));

    // ScreenCaptureBridge granted & declined
    const cap1 = runtime.screenCapture.openCaptureSession({
      agenteId: "estrategista",
      canalId: "agente:estrategista",
      purpose: "Revisar card visual",
      timeoutMs: 10_000,
    });
    const fakePngDataUrl = `data:image/png;base64,${buildValidPngBuffer(2, 2).toString("base64")}`;
    const grantHttp = await fetch(
      `${baseUrl}/api/navegador/captura-tela/${cap1.request.captureId}/responder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "granted",
          dataUrl: fakePngDataUrl,
          width: 2,
          height: 2,
        }),
      },
    );
    assert.equal(grantHttp.status, 200);
    const resolvedGrant = await cap1.waitForResolution;
    assert.equal(resolvedGrant.ok, true);
    assert.equal(resolvedGrant.decision, "granted");

    const cap2 = runtime.screenCapture.openCaptureSession({
      agenteId: "estrategista",
      canalId: "agente:estrategista",
      purpose: "Captura recusada",
      timeoutMs: 10_000,
    });
    const declHttp = await fetch(
      `${baseUrl}/api/navegador/captura-tela/${cap2.request.captureId}/responder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "declined",
          reason: "Usuário cancelou compartilhamento.",
        }),
      },
    );
    assert.equal(declHttp.status, 200);
    const resolvedDecl = await cap2.waitForResolution;
    assert.equal(resolvedDecl.ok, false);
    assert.equal(resolvedDecl.decision, "declined");
  });

  it("Bloco 4 — valida pickPoolAccount, governança por agente e BackupModelsResolver sem alterar modelo_padrao", async () => {
    const baseAccount = (
      id: string,
      rem5h: number,
      remSemanal: number,
      resetIso: string,
    ): ContaProvedorInfo => ({
      id,
      email: `${id}@exemplo.invalid`,
      estado: "conectado",
      ativa: false,
      excluida_do_pool: false,
      origem: "oauth_cli",
      grupos_cota: [
        {
          nome: "Principal",
          janela_5h: { restante_percentual: rem5h, reseta_em_texto: "em 2h" },
          janela_semanal: {
            restante_percentual: remSemanal,
            reseta_em_texto: "em 2d",
            reseta_em: resetIso,
            reseta_em_iso: resetIso,
          },
        },
      ],
    });

    const low5hAccount = baseAccount("conta-baixa-5h", 10, 80, "2026-11-19T10:00:00.000Z"); // 10% < 15% buffer
    const laterResetAccount = baseAccount("conta-reset-tarde", 70, 60, "2026-11-23T10:00:00.000Z");
    const soonerResetAccount = baseAccount("conta-reset-cedo", 65, 50, "2026-11-20T10:00:00.000Z");

    const picked = selectPoolAccount(
      [low5hAccount, laterResetAccount, soonerResetAccount],
      { habilitado: true, conta_em_uso: null, contas_excluidas: [] },
    );
    assert.equal(picked?.id, "conta-reset-cedo");

    const updateAgentRes = await fetch(`${baseUrl}/api/agentes/estrategista`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backup_models: {
          automatic: false,
          order: [
            { provedor: "openai", modelo: "gpt-4.1-mini" },
            { provedor: "claude", modelo: "claude-sonnet-4-5" },
          ],
        },
        permission_level: "ask",
        allow_new_chat: false,
        allow_quick_ack: true,
        notification_level: "mentions",
      }),
    });
    assert.equal(updateAgentRes.status, 200);
    const updatedAgentData = (await updateAgentRes.json()) as {
      agente: {
        modelo_padrao: string;
        config: { permission_level?: string; notification_level?: string; allow_new_chat?: boolean };
      };
    };
    const originalModel = updatedAgentData.agente.modelo_padrao;
    assert.equal(updatedAgentData.agente.config.permission_level, "ask");
    assert.equal(updatedAgentData.agente.config.notification_level, "mentions");
    assert.equal(updatedAgentData.agente.config.allow_new_chat, false);

    // BackupModelsResolver: classifica 429 e resolve ordem configurada
    assert.equal(isRetryableQuotaOrProviderError(new Error("HTTP 429 Too Many Requests")).retryable, true);
    const resolver = new BackupModelsResolver();
    const statuses: ProvedorStatusInfo[] = [
      {
        provedor: "openai",
        titulo: "OpenAI",
        conectado: true,
        vault_configurado: true,
        cli_instalada: false,
        modelos: [{ id: "gpt-4.1-mini", nome: "GPT-4.1 Mini" }],
      },
      {
        provedor: "claude",
        titulo: "Claude",
        conectado: true,
        vault_configurado: true,
        cli_instalada: false,
        modelos: [{ id: "claude-sonnet-4-5", nome: "Claude Sonnet" }],
      },
    ];
    const candidates = resolver.resolveCandidates({
      primaryModel: originalModel,
      backupConfig: {
        automatic: true,
        order: [
          { provedor: "openai", modelo: "gpt-4.1-mini" },
          { provedor: "claude", modelo: "claude-sonnet-4-5" },
        ],
      },
      statuses,
    });
    assert.deepEqual(
      candidates.map((c: BackupModelChoice) => c.modelo),
      ["gpt-4.1-mini", "claude-sonnet-4-5"],
    );

    const limitResp = await fetch(`${baseUrl}/api/agentes/estrategista/uso-limite/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        choice: { provedor: "openai", modelo: "gpt-4.1-mini" },
        remember: true,
      }),
    });
    assert.equal(limitResp.status, 200);
    const limitJson = (await limitResp.json()) as {
      ok: boolean;
      backupConfig: { automatic: boolean; order: BackupModelChoice[] };
    };
    assert.equal(limitJson.ok, true);
    assert.equal(limitJson.backupConfig.automatic, true);

    const checkRow = runtime.db.connection
      .prepare("SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = 'estrategista';")
      .get() as { modelo_padrao: string };
    assert.equal(checkRow.modelo_padrao, originalModel);
  });

  it("Bloco 5 — valida Sidebar customizável (nível máx 3, pins, ocultos, delete), 5 tools e duplicação de agente", async () => {
    const dupRes = await fetch(`${baseUrl}/api/agentes/copywriter/duplicar`, { method: "POST" });
    const dupText = await dupRes.text();
    assert.equal(dupRes.status, 201, `Falha em /duplicar: ${dupText}`);
    const dupJson = JSON.parse(dupText) as {
      agente: { agente_id: string; nome: string };
      layout: { agentOrder: string[] };
    };
    const origIdx = dupJson.layout.agentOrder.indexOf("copywriter");
    const cloneIdx = dupJson.layout.agentOrder.indexOf(dupJson.agente.agente_id);
    assert.ok(origIdx >= 0 && cloneIdx === origIdx + 1, "Clone deve aparecer imediatamente após original");

    const createSec = async (nome: string, parentId: string | null = null) => {
      const res = await fetch(`${baseUrl}/api/sidebar/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "create_section", nome, parentId }),
      });
      return { status: res.status, data: await res.json() };
    };

    const s1 = await createSec("Nivel 1", null);
    assert.equal(s1.status, 200);
    const sec1Id = (s1.data as { sections: Array<{ section_id: string; nome: string }> }).sections.find(
      (s) => s.nome === "Nivel 1",
    )!.section_id;

    const s2 = await createSec("Nivel 2", sec1Id);
    assert.equal(s2.status, 200);
    const sec2Id = (s2.data as { sections: Array<{ section_id: string; nome: string }> }).sections.find(
      (s) => s.nome === "Nivel 2",
    )!.section_id;

    const s3 = await createSec("Nivel 3", sec2Id);
    assert.equal(s3.status, 200);
    const sec3Id = (s3.data as { sections: Array<{ section_id: string; nome: string }> }).sections.find(
      (s) => s.nome === "Nivel 3",
    )!.section_id;

    // Nível 4 deve ser bloqueado com 400
    const s4 = await createSec("Nivel 4 Proibido", sec3Id);
    assert.equal(s4.status, 400);

    // Move agente, pin e hidden
    const moveRes = await fetch(`${baseUrl}/api/sidebar/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "move_agent", agentId: "copywriter", sectionId: sec2Id }),
    });
    assert.equal(moveRes.status, 200);
    const afterMove = (await moveRes.json()) as { agentAssignments: Record<string, string | null> };
    assert.equal(afterMove.agentAssignments.copywriter, sec2Id);

    const pinRes = await fetch(`${baseUrl}/api/sidebar/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "set_pin", agentId: "estrategista", pinned: true }),
    });
    assert.equal(pinRes.status, 200);

    const hideRes = await fetch(`${baseUrl}/api/sidebar/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "set_hidden", agentId: dupJson.agente.agente_id, hidden: true }),
    });
    assert.equal(hideRes.status, 200);
    const afterHide = (await hideRes.json()) as {
      pins: string[];
      hiddenAgentIds: string[];
    };
    assert.ok(afterHide.pins.includes("estrategista"));
    assert.ok(afterHide.hiddenAgentIds.includes(dupJson.agente.agente_id));

    // Remoção de seção preserva copywriter
    const delRes = await fetch(`${baseUrl}/api/sidebar/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "delete_section", sectionId: sec1Id }),
    });
    assert.equal(delRes.status, 200);
    const agCheck = runtime.db.connection
      .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = 'copywriter';")
      .get() as { agente_id: string } | undefined;
    assert.equal(agCheck?.agente_id, "copywriter");

    // 5 tools do agente
    const tCreate = executeSidebarTool(runtime.db, "create_section", { nome: "Criativos Tool" });
    const toolSecId = String((tCreate as { section: { section_id: string } }).section.section_id);
    executeSidebarTool(runtime.db, "rename_section", {
      section_id: toolSecId,
      nome: "Criativos Renomeados",
    });
    executeSidebarTool(runtime.db, "assign_agent_section", {
      agent_id: "copywriter",
      section_id: toolSecId,
    });
    const tList = executeSidebarTool(runtime.db, "list_sections", {}) as {
      ok: boolean;
      sections: Array<{ nome: string }>;
    };
    assert.ok(tList.sections.some((s) => s.nome === "Criativos Renomeados"));
    executeSidebarTool(runtime.db, "delete_section", { section_id: toolSecId });
  });

  it("Bloco 6 — valida GET/PUT /api/configuracoes, /atualizacoes e cálculo/limpeza de /api/armazenamento", async () => {
    const putSetRes = await fetch(`${baseUrl}/api/configuracoes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geral: { atalho_envio: "mod_enter", acoes_compactas: true },
        aparencia: { escala: 110, cor_acento: "#31CF76" },
      }),
    });
    assert.equal(putSetRes.status, 200);

    const getSetRes = await fetch(`${baseUrl}/api/configuracoes`);
    assert.equal(getSetRes.status, 200);
    const getSetJson = (await getSetRes.json()) as {
      settings: {
        geral: { atalho_envio: string; acoes_compactas: boolean };
        aparencia: { escala: number; cor_acento: string };
      };
    };
    assert.equal(getSetJson.settings.geral.atalho_envio, "mod_enter");
    assert.equal(getSetJson.settings.aparencia.escala, 110);

    const whatsNewRes = await fetch(`${baseUrl}/api/configuracoes/atualizacoes`);
    assert.equal(whatsNewRes.status, 200);
    const whatsNewJson = (await whatsNewRes.json()) as { versao_atual: string; notas: unknown[] };
    assert.ok(whatsNewJson.versao_atual);
    assert.ok(Array.isArray(whatsNewJson.notas) && whatsNewJson.notas.length >= 1);

    const cacheDir = join(tempDir, "dados", "browser-profiles", "perf-teste", "Cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "cache.bin"), Buffer.alloc(4096, 1));
    writeFileSync(join(tempDir, "saidas", "arte-teste.png"), Buffer.alloc(2048, 2));

    const storageRes = await fetch(`${baseUrl}/api/armazenamento`);
    assert.equal(storageRes.status, 200);
    const storageJson = (await storageRes.json()) as { totalBytes: number };
    assert.ok(storageJson.totalBytes >= 6144);

    const cleanRes = await fetch(`${baseUrl}/api/armazenamento/limpar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "browser_cache" }),
    });
    assert.equal(cleanRes.status, 200);
    const cleanJson = (await cleanRes.json()) as { ok: boolean; freedBytes: number };
    assert.equal(cleanJson.ok, true);
    assert.ok(cleanJson.freedBytes >= 4096);
  });

  it("Bloco 7 — valida webhooks assinados Slack/Discord/GitHub e servidor estático Showcase anti-traversal", async () => {
    const slackSecret = `SLACK_SEC_${randomUUID().slice(0, 8)}`;
    const ghSecret = `GH_SEC_${randomUUID().slice(0, 8)}`;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubDer = publicKey.export({ format: "der", type: "spki" });
    const discordPubKeyHex = pubDer.subarray(pubDer.length - 32).toString("hex");

    const cfgSlack = await fetch(`${baseUrl}/api/conectores/slack/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botToken: "xoxb-teste-invalido", signingSecret: slackSecret }),
    });
    assert.equal(cfgSlack.status, 200);

    const cfgDiscord = await fetch(`${baseUrl}/api/conectores/discord/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: discordPubKeyHex, botToken: "bot-teste-invalido" }),
    });
    assert.equal(cfgDiscord.status, 200);

    const cfgGh = await fetch(`${baseUrl}/api/conectores/github/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ghp_teste_invalido", webhookSecret: ghSecret }),
    });
    assert.equal(cfgGh.status, 200);

    // Sem segredos expostos em GET /api/conectores ou GET /api/conectores/opcionais
    const listConnsRes = await fetch(`${baseUrl}/api/conectores`);
    const listConnsText = await listConnsRes.text();
    assert.ok(!listConnsText.includes(slackSecret));
    assert.ok(!listConnsText.includes(ghSecret));

    // Slack webhook HMAC v0
    const slackTs = String(Math.floor(Date.now() / 1000));
    const slackBody = JSON.stringify({ type: "url_verification", challenge: "desafio_ok" });
    const slackSig = `v0=${createHmac("sha256", slackSecret).update(`v0:${slackTs}:${slackBody}`, "utf8").digest("hex")}`;
    const slackOk = await fetch(`${baseUrl}/api/conectores/slack/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": slackTs,
        "X-Slack-Signature": slackSig,
      },
      body: slackBody,
    });
    assert.equal(slackOk.status, 200);
    assert.equal(((await slackOk.json()) as { challenge: string }).challenge, "desafio_ok");

    const slackBad = await fetch(`${baseUrl}/api/conectores/slack/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": slackTs,
        "X-Slack-Signature": "v0=deadbeef",
      },
      body: slackBody,
    });
    assert.equal(slackBad.status, 401);

    // GitHub webhook HMAC-SHA256
    const ghBody = JSON.stringify({
      ref: "refs/heads/main",
      repository: { full_name: "org/repo-teste" },
      sender: { login: "autor-teste" },
    });
    const ghSig = `sha256=${createHmac("sha256", ghSecret).update(ghBody, "utf8").digest("hex")}`;
    const ghOk = await fetch(`${baseUrl}/api/conectores/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": ghSig,
        "X-GitHub-Event": "push",
      },
      body: ghBody,
    });
    assert.equal(ghOk.status, 200);

    const ghBad = await fetch(`${baseUrl}/api/conectores/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=invalido",
        "X-GitHub-Event": "push",
      },
      body: ghBody,
    });
    assert.equal(ghBad.status, 401);

    // Discord Ed25519 PING
    const discordTs = String(Math.floor(Date.now() / 1000));
    const discordBody = JSON.stringify({ type: 1 });
    const discordSig = cryptoSign(
      null,
      Buffer.from(`${discordTs}${discordBody}`, "utf8"),
      privateKey,
    ).toString("hex");
    const discordOk = await fetch(`${baseUrl}/api/conectores/discord/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": discordSig,
        "X-Signature-Timestamp": discordTs,
      },
      body: discordBody,
    });
    assert.equal(discordOk.status, 200);
    assert.equal(((await discordOk.json()) as { type: number }).type, 1);

    const discordBad = await fetch(`${baseUrl}/api/conectores/discord/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": "00".repeat(64),
        "X-Signature-Timestamp": discordTs,
      },
      body: discordBody,
    });
    assert.equal(discordBad.status, 401);

    // Showcase Local + Aprovação Humana + Bloqueio de extensão proibida + Anti-traversal
    const unsafeDir = join(tempDir, "saidas", "landing-insegura");
    mkdirSync(unsafeDir, { recursive: true });
    writeFileSync(join(unsafeDir, "index.html"), "<!doctype html><h1>Teste</h1>", "utf8");
    writeFileSync(join(unsafeDir, "script.sh"), "#!/bin/sh\necho blocked\n", "utf8");
    assert.throws(() =>
      executeShowcaseTool(
        runtime.showcaseService,
        "publish_site",
        { slug: "landing-insegura", titulo: "Insegura", sourceDir: "saidas/landing-insegura" },
        { aprovadoPorHumano: true },
      ),
    );

    const landingDir = join(tempDir, "saidas", "landing-teste");
    mkdirSync(landingDir, { recursive: true });
    writeFileSync(join(landingDir, "index.html"), "<!doctype html><h1>[NOME_DA_MARCA] Showcase</h1>", "utf8");

    const toolNoApproval = executeShowcaseTool(
      runtime.showcaseService,
      "publish_site",
      { slug: "landing-teste", titulo: "Teste", sourceDir: "saidas/landing-teste" },
      { aprovadoPorHumano: false },
    );
    assert.equal(toolNoApproval.requiresApproval, true);

    const httpNoApproval = await fetch(`${baseUrl}/api/showcase/sites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "landing-teste",
        titulo: "Landing [NOME_DA_MARCA]",
        sourceDir: "saidas/landing-teste",
        aprovadoPorHumano: false,
      }),
    });
    assert.equal(httpNoApproval.status, 409);

    const pubRes = await fetch(`${baseUrl}/api/showcase/sites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "landing-teste",
        titulo: "Landing [NOME_DA_MARCA]",
        sourceDir: "saidas/landing-teste",
        spaFallback: false,
        aprovadoPorHumano: true,
      }),
    });
    assert.equal(pubRes.status, 201);
    const pubJson = (await pubRes.json()) as { site: { site_id: string; public_dir: string } };

    const getShowcase = await fetch(`${baseUrl}/showcase/landing-teste/`);
    assert.equal(getShowcase.status, 200);
    assert.match(getShowcase.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(getShowcase.headers.get("x-content-type-options"), "nosniff");
    assert.ok(getShowcase.headers.get("content-security-policy"));
    assert.match(await getShowcase.text(), /\[NOME_DA_MARCA\] Showcase/);

    const traversalStatus = await new Promise<number>((resolvePromise, rejectPromise) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: runtime.port,
          path: "/showcase/landing-teste/..%2f..%2fpackage.json",
          method: "GET",
        },
        (res) => {
          res.resume();
          resolvePromise(res.statusCode ?? 0);
        },
      );
      req.on("error", rejectPromise);
      req.end();
    });
    assert.equal(traversalStatus, 403);

    // Arquivo .sh mesmo se existir no public_dir é bloqueado com 403
    writeFileSync(join(tempDir, pubJson.site.public_dir, "bloqueado.sh"), "#!/bin/sh\n", "utf8");
    assert.ok(existsSync(join(tempDir, pubJson.site.public_dir, "bloqueado.sh")));
    const shRes = await fetch(`${baseUrl}/showcase/landing-teste/bloqueado.sh`);
    assert.equal(shRes.status, 403);

    // Substituir e despublicar
    const updShowcase = await fetch(`${baseUrl}/api/showcase/sites/${pubJson.site.site_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceDir: "saidas/landing-teste",
        titulo: "Landing Atualizada",
        aprovadoPorHumano: true,
      }),
    });
    assert.equal(updShowcase.status, 200);

    const delShowcase = await fetch(`${baseUrl}/api/showcase/sites/${pubJson.site.site_id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aprovadoPorHumano: true }),
    });
    assert.equal(delShowcase.status, 200);

    const afterDelShowcase = await fetch(`${baseUrl}/showcase/landing-teste/`);
    assert.equal(afterDelShowcase.status, 404);
  });
});
