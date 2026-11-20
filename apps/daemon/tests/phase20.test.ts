import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { initializeDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { useSqliteAuthState } from "../../../packages/whatsapp/src/auth-store.ts";
import {
  sanitizeJsonSchemaForGemini,
  validateGeminiToolSchema,
} from "../src/mcp/gemini-schema-sanitizer.ts";
import { GeminiProvider } from "../src/engine/providers/gemini-provider.ts";
import { BrowserCdpSessionManager } from "../src/engine/tools/browser-cdp-session.ts";
import { BrowserAutomationService } from "../src/engine/tools/browser-automation.ts";
import { assertLoopbackCdpEndpoint } from "../src/engine/tools/browser-native-cdp.ts";
import { AutoUpdateService } from "../src/updater/auto-update-service.ts";
import { LicenseClientService } from "../src/license/license-service.ts";
import { getWhatsNewInfo } from "../src/server/settings-storage-service.ts";
import { ProviderConnectionService } from "../src/providers/provider-connection-service.ts";
import { TranscriptionService } from "../src/voice/transcription-service.ts";
import { CatalogService } from "../src/marketplace/catalog-service.ts";
import {
  interpolateBrandPlaceholders,
  saveBrandIdentity,
  syncBrandPlaceholdersInDatabase,
} from "../src/server/brand-onboarding-service.ts";
import { seedDefaultStudioExperience } from "../src/engine/runner/roster-defaults.ts";
import {
  createDaemonServer,
  type DaemonRuntime,
} from "../src/server/daemon-server.ts";
import { executePhase15ToolCall } from "../src/server/studio-tools-bridge.ts";
import { OpenCodeLiveService } from "../src/providers/opencode-live-service.ts";
import type { StudioResolvedPaths } from "../src/config/app-paths.ts";

function sendWsTextFrame(socket: import("node:net").Socket, text: string): void {
  const payload = Buffer.from(text, "utf8");
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

function decodeWsClientFrames(
  chunk: Buffer,
  onMessage: (text: string) => void
): void {
  let offset = 0;
  while (offset + 2 <= chunk.length) {
    const first = chunk[offset]!;
    const second = chunk[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > chunk.length) break;
      len = chunk.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      break;
    }
    const maskBytes = masked ? chunk.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    if (cursor + len > chunk.length) break;
    const raw = Buffer.from(chunk.subarray(cursor, cursor + len));
    if (masked && maskBytes) {
      for (let i = 0; i < raw.length; i += 1) {
        raw[i] = raw[i]! ^ maskBytes[i % 4]!;
      }
    }
    offset = cursor + len;
    if (opcode === 0x01) {
      onMessage(raw.toString("utf8"));
    }
  }
}

describe("Fase 20 — Backend, Gemini Schemas, Baileys, CDP Nativo, ACP, Marca & Loja", () => {
  const tempDirs: string[] = [];
  const runtimes: DaemonRuntime[] = [];
  const servers: Array<import("node:http").Server> = [];
  let prevSkipProbe: string | undefined;

  before(() => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  });

  after(async () => {
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;

    for (const rt of runtimes) {
      await rt.close().catch(() => {});
    }
    for (const srv of servers) {
      await new Promise<void>((res) => srv.close(() => res())).catch(() => {});
    }
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
      } catch {
        // Ignora lock residual no Windows
      }
    }
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function makeTestPaths(root: string): StudioResolvedPaths {
    const updatesDir = join(root, "updates");
    const servidoresDir = join(root, "servidores");
    const dadosDir = join(root, "dados");
    mkdirSync(updatesDir, { recursive: true });
    mkdirSync(servidoresDir, { recursive: true });
    mkdirSync(dadosDir, { recursive: true });
    return {
      productRoot: root,
      userDataRoot: root,
      dbPath: join(dadosDir, "studio.sqlite"),
      envPath: join(root, ".env"),
      webDistDir: join(root, "web-dist"),
      templatesDir: join(root, "templates"),
      nativeSkillsDir: join(root, "skills"),
      servidoresDir,
      updatesDir,
      isPackaged: false,
      separatedRoots: false,
    };
  }

  it("1. (GEM20-01) Todas as ferramentas expostas em CriativoStudioMcpBridge + GeminiProvider passam com 0 violações Gemini", async () => {
    const dir = makeTempDir("p20-gemini-");
    const rt = await createDaemonServer({
      workspaceRoot: dir,
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);

    const tools = rt.studioMcpBridge.listToolsForAgent("estrategista");
    assert.ok(tools.length > 5, "Deveria expor diversas ferramentas nativas para o agente");
    assert.ok(
      tools.some((t) => t.name === "criativo_browser"),
      "Catálogo MCP deve expor a ferramenta renomeada criativo_browser"
    );

    const violations: string[] = [];
    for (const tool of tools) {
      const errs = validateGeminiToolSchema(tool.parameters, tool.name);
      violations.push(...errs);
    }
    assert.deepEqual(violations, [], `Schemas com violação Gemini: ${violations.join("; ")}`);

    // Testa também sanitização forçada de schema defeituoso externo no GeminiProvider
    const gemini = new GeminiProvider({ apiKey: "sk-test-dummy-20" });
    const reqBody = gemini.buildRequestBody({
      modelId: "gemini-2.5-pro",
      systemPrompt: "Sistema teste",
      messages: [{ role: "user", content: "Oi" }],
      tools: [
        {
          name: "broken_external_tool",
          description: "Tool malformada",
          parameters: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            properties: {
              filters: { type: ["array", "null"], description: "Filtros por campo" },
              anyPayload: {},
              mode: { oneOf: [{ type: "null" }, { type: "string", enum: ["fast", "deep"] }] },
            },
          },
        },
      ],
    }) as {
      tools: Array<{ functionDeclarations: Array<{ name: string; parameters: unknown }> }>;
    };

    const decl = reqBody.tools[0]!.functionDeclarations[0]!;
    assert.deepEqual(
      validateGeminiToolSchema(decl.parameters, decl.name),
      [],
      "GeminiProvider.buildRequestBody deve sanitizar esquemas malformados sem erros"
    );
    const sanitized = sanitizeJsonSchemaForGemini({
      type: "object",
      properties: { filters: { type: "array", description: "Lista de filtros" } },
    }) as { properties: { filters: { items?: Record<string, unknown> } } };
    assert.ok(sanitized.properties.filters.items, "Array sem items deve receber fallback automático");
  });

  it("2. (WPP20-01) useSqliteAuthState inicializa Baileys com noiseKey.public / signedIdentityKey.public e auto-cura sessão legada incompleta", async () => {
    const dir = makeTempDir("p20-wpp-");
    const db = initializeDatabase(join(dir, "studio.sqlite"));

    const accountId = "whatsapp-teste-20";
    const fresh = await useSqliteAuthState(db.connection, accountId);
    const noise = fresh.state.creds.noiseKey as { public?: unknown; private?: unknown } | undefined;
    const identity = fresh.state.creds.signedIdentityKey as
      | { public?: unknown; private?: unknown }
      | undefined;

    assert.ok(noise?.public, "noiseKey.public precisa estar presente em creds novas");
    assert.ok(identity?.public, "signedIdentityKey.public precisa estar presente em creds novas");

    // Injeta registro legado quebrado sem noiseKey/signedIdentityKey
    const brokenId = "whatsapp-legado-quebrado";
    db.connection
      .prepare(
        `INSERT OR REPLACE INTO whatsapp_contas (conta_id, rotulo, status, modo_operacao, sessao_dados_json, atualizado_em)
         VALUES (?, ?, 'desconectado', 'dedicated', ?, ?);`
      )
      .run(
        brokenId,
        "Número Legado",
        JSON.stringify({ creds: { registered: false }, keys: {} }),
        new Date().toISOString()
      );

    const healed = await useSqliteAuthState(db.connection, brokenId);
    const healedNoise = healed.state.creds.noiseKey as { public?: unknown } | undefined;
    const healedIdKey = healed.state.creds.signedIdentityKey as { public?: unknown } | undefined;
    assert.ok(healedNoise?.public, "Sessão legada quebrada deve auto-curar noiseKey.public");
    assert.ok(healedIdKey?.public, "Sessão legada quebrada deve auto-curar signedIdentityKey.public");

    db.close();
  });

  it("3. (UPD20-01) AutoUpdateService trata HTTP 404 { error: no_release_published } como atualizado e lê versão 1.0.0 de produto.json", async () => {
    const dir = makeTempDir("p20-upd-");
    writeFileSync(
      join(dir, "produto.json"),
      JSON.stringify({ nome: "Criativo AI Studio", versao: "1.0.0" }),
      "utf8"
    );
    const paths = makeTestPaths(dir);
    const db = initializeDatabase(paths.dbPath);
    const vault = new VaultService(
      db,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const licenseService = new LicenseClientService({
      db,
      vault,
      bypassForTests: true,
      hubBaseUrl: "http://127.0.0.1:9999",
      productRoot: dir,
    });

    const updaterNoRelease = new AutoUpdateService({
      licenseService,
      paths,
      currentVersion: "1.0.0",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: "no_release_published" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });

    const snapOk = await updaterNoRelease.checkForUpdates();
    assert.equal(snapOk.state, "up_to_date");
    assert.equal(snapOk.error_message, null);

    const updaterBroken404 = new AutoUpdateService({
      licenseService,
      paths,
      currentVersion: "1.0.0",
      fetchImpl: (async () =>
        new Response("<html>Not Found</html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        })) as unknown as typeof fetch,
    });

    const snapErr = await updaterBroken404.checkForUpdates();
    assert.equal(snapErr.state, "error");
    assert.ok(snapErr.error_message && snapErr.error_message.includes("404"));

    const whatsNew = getWhatsNewInfo(dir, dir);
    assert.equal(whatsNew.versao_atual, "1.0.0");
    assert.notEqual(whatsNew.versao_atual, "2.15.0");

    db.close();
  });

  it("4. (UX20-03) ProviderConnectionService retorna modelos vazios ([]) quando provedor não está conectado", async () => {
    const dir = makeTempDir("p20-models-");
    const db = initializeDatabase(join(dir, "studio.sqlite"));
    const vault = new VaultService(
      db,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const connSvc = new ProviderConnectionService({
      db,
      vault,
      workspaceRoot: dir,
      sharedAuthDir: join(dir, "contas-isoladas"),
    });

    const statuses = await connSvc.getProvidersStatus(false);
    assert.ok(statuses.length > 0);
    for (const st of statuses) {
      if (st.modo_conexao === "nenhum") {
        assert.deepEqual(
          st.modelos,
          [],
          `Provedor desconectado '${st.provedor}' não pode retornar modelos hardcoded`
        );
      }
    }

    db.close();
  });

  it("5. (UX20-05) TranscriptionService aceita chave case-insensitive e /api/voz/transcrever transcreve .webm ou retorna 422 sem chave", async () => {
    const dir = makeTempDir("p20-voice-");
    const db = initializeDatabase(join(dir, "studio.sqlite"));
    const vault = new VaultService(
      db,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    for (const k of ["gemini_api_key", "GEMINI_API_KEY", "openai_api_key", "OPENAI_API_KEY", "google_api_key", "GOOGLE_API_KEY"]) {
      vault.deleteSecret(k);
    }

    // Vault vazio -> MISSING_TRANSCRIPTION_KEY
    const emptySvc = new TranscriptionService({ vault });
    await assert.rejects(
      () => emptySvc.transcribeAudio(Buffer.from("WEBM_FAKE"), "audio/webm"),
      /MISSING_TRANSCRIPTION_KEY/
    );

    // Chave salva em minúsculas no Vault -> encontrada e usada na chamada Gemini
    vault.setSecret("gemini_api_key", "AIzaDummyTestKey20");
    let capturedUrl = "";
    const mockedSvc = new TranscriptionService({
      vault,
      fetchImpl: (async (url: string) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Criar carrossel de teste" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch,
    });

    const texto = await mockedSvc.transcribeAudio(Buffer.from("AUDIO_WEBM_BYTES"), "audio/webm");
    assert.equal(texto, "Criar carrossel de teste");
    assert.match(capturedUrl, /generativelanguage\.googleapis\.com/);

    // Testa também endpoint HTTP POST /api/voz/transcrever sem chave no daemon
    const rt = await createDaemonServer({
      workspaceRoot: makeTempDir("p20-voice-http-"),
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);
    const addr = rt.httpServer.address();
    assert.ok(addr && typeof addr === "object");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const res422 = await fetch(`${baseUrl}/api/voz/transcrever`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: Buffer.from("FAKE_WEBM").toString("base64"),
        mime_type: "audio/webm",
      }),
    });
    assert.equal(res422.status, 422);
    const body422 = (await res422.json()) as { code?: string };
    assert.equal(body422.code, "MISSING_TRANSCRIPTION_KEY");

    db.close();
  });

  it("6. (STORE20-01 & BRAND20-01) CatalogService expõe App Nativo conectado em connectedNativeSlugs/nativeAccounts e marca configurada remove placeholders", async () => {
    const dir = makeTempDir("p20-store-brand-");
    const rt = await createDaemonServer({
      workspaceRoot: dir,
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);

    seedDefaultStudioExperience(rt.db);
    const catalog = new CatalogService({
      db: rt.db,
      vault: rt.vault,
      workspaceRoot: dir,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ id: "178414000000020", username: "marca_teste_20" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch,
    });

    const connected = await catalog.connectCatalogApp("instagram", {
      kind: "key",
      contaRotulo: "Conta Teste 20",
      skipProbe: true,
      fields: {
        IG_ACCESS_TOKEN: "EAATESTDUMMY20",
        IG_USER_ID: "178414000000020",
      },
    });
    assert.ok(connected.ok, "connectCatalogApp deve retornar ok: true");

    const snapshot = catalog.getCatalogSnapshot();
    assert.ok(
      snapshot.connectedNativeSlugs?.includes("instagram"),
      "connectedNativeSlugs deve conter instagram"
    );
    assert.ok(
      snapshot.nativeAccounts?.some((a) => a.app_slug === "instagram"),
      "nativeAccounts deve listar a conta nativa conectada do Instagram"
    );

    // Verifica interpolação e limpeza global dos placeholders da marca no banco + HTTP
    await saveBrandIdentity(
      rt.providerConnection,
      dir,
      {
        marca_nome: "Marca Teste 20",
        perfil_handle: "@marca_teste_20",
      },
      rt.db
    );
    syncBrandPlaceholdersInDatabase(rt.db, {
      marca_nome: "Marca Teste 20",
      perfil_handle: "@marca_teste_20",
    });

    const row = rt.db.connection
      .prepare(
        `SELECT conteudo_markdown FROM projecao_conversas_chat WHERE canal_id = 'agente:estrategista' LIMIT 1;`
      )
      .get() as { conteudo_markdown: string } | undefined;
    assert.ok(row);
    assert.ok(!row.conteudo_markdown.includes("[NOME_DA_MARCA]"));
    assert.ok(!row.conteudo_markdown.includes("[@SEU_PERFIL]"));

    const addr = rt.httpServer.address();
    assert.ok(addr && typeof addr === "object");
    const convRes = await fetch(`http://127.0.0.1:${addr.port}/api/agentes/estrategista/mensagens`);
    assert.equal(convRes.status, 200);
    const convBody = (await convRes.json()) as { mensagens?: Array<{ conteudo_markdown: string }> };
    const msgs = convBody.mensagens ?? [];
    assert.ok(msgs.length > 0);
    for (const m of msgs) {
      assert.ok(!m.conteudo_markdown.includes("[NOME_DA_MARCA]"));
      assert.ok(!m.conteudo_markdown.includes("[@SEU_PERFIL]"));
    }

    assert.equal(
      interpolateBrandPlaceholders("Olá [NOME_DA_MARCA] ([@SEU_PERFIL])", {
        marca_nome: "Marca Teste 20",
        perfil_handle: "@marca_teste_20",
      }),
      "Olá Marca Teste 20 (@marca_teste_20)"
    );
  });

  it("7. (BRWS20-01) Proteção anti-SSRF CDP, BrowserCdpSessionManager nativo sem playwright-core, criativo_browser e auto-aprovação ACP", async () => {
    // 7a. Validação anti-SSRF
    assert.throws(() => assertLoopbackCdpEndpoint("http://192.168.1.10:9222"), /loopback|SSRF/i);
    assert.equal(assertLoopbackCdpEndpoint(9222), "http://127.0.0.1:9222");
    assert.equal(assertLoopbackCdpEndpoint("http://127.0.0.1:9222"), "http://127.0.0.1:9222");

    // 7b. Mock de Chrome DevTools Protocol HTTP + WebSocket local para BrowserCdpSessionManager
    const wsSockets = new Set<import("node:net").Socket>();
    let targetUrl = "about:blank";
    const cdpMock = createHttpServer((req, res) => {
      if (req.url === "/json/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const addr = cdpMock.address() as import("node:net").AddressInfo;
        res.end(
          JSON.stringify({
            Browser: "Chrome/Test-CDP",
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/browser/test`,
          })
        );
        return;
      }
      if (req.url?.startsWith("/json/new")) {
        const addr = cdpMock.address() as import("node:net").AddressInfo;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "target-page-1",
            type: "page",
            url: targetUrl,
            title: "Página CDP Mockada",
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/target-page-1`,
          })
        );
        return;
      }
      if (req.url === "/json/list" || req.url === "/json") {
        const addr = cdpMock.address() as import("node:net").AddressInfo;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              id: "target-page-1",
              type: "page",
              url: targetUrl,
              title: "Página CDP Mockada",
              webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/target-page-1`,
            },
          ])
        );
        return;
      }
      res.writeHead(404).end();
    });

    cdpMock.on("upgrade", (req, socket) => {
      wsSockets.add(socket);
      const key = req.headers["sec-websocket-key"];
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.on("data", (buf) => {
        decodeWsClientFrames(buf, (raw) => {
          const msg = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
          let result: unknown = {};
          if (msg.method === "Target.getTargets") {
            result = { targetInfos: [{ targetId: "target-page-1", type: "page", url: targetUrl, title: "Página CDP Mockada" }] };
          } else if (msg.method === "Page.navigate") {
            targetUrl = String(msg.params?.url ?? "about:blank");
            result = { frameId: "frame-1" };
          } else if (msg.method === "Runtime.evaluate") {
            const expr = String(msg.params?.expression ?? "");
            result = {
              result: {
                value: expr.includes("document.title")
                  ? "Página CDP Mockada"
                  : expr.includes("location.href")
                    ? targetUrl
                    : null,
              },
            };
          }
          sendWsTextFrame(socket, JSON.stringify({ id: msg.id, result }));
        });
      });
      socket.on("close", () => wsSockets.delete(socket));
    });

    await new Promise<void>((resolve) => cdpMock.listen(0, "127.0.0.1", resolve));
    servers.push(cdpMock);
    const cdpAddr = cdpMock.address() as import("node:net").AddressInfo;

    const prevDriver = process.env.CRIATIVO_BROWSER_DRIVER;
    process.env.CRIATIVO_BROWSER_DRIVER = "native";
    const browserDir = makeTempDir("p20-cdp-");
    const sessionMgr = new BrowserCdpSessionManager(browserDir);
    try {
      const tab = await sessionMgr.openTab({
        perfilId: "perfil_cdp_teste",
        userDataDir: join(browserDir, "perfil"),
        agenteId: "estrategista",
        url: "https://example.com/teste",
        cdpUrl: `http://127.0.0.1:${cdpAddr.port}`,
        headless: false,
      });
      assert.ok(tab.tabId);
      assert.equal(tab.virtualUrl, "https://example.com/teste");
    } finally {
      for (const s of wsSockets) s.destroy();
      await sessionMgr.disposeAll?.();
      if (prevDriver === undefined) delete process.env.CRIATIVO_BROWSER_DRIVER;
      else process.env.CRIATIVO_BROWSER_DRIVER = prevDriver;
    }

    // 7c. Verifica executor oficial criativo_browser
    const aliasDir = makeTempDir("p20-alias-");
    const aliasDb = initializeDatabase(join(aliasDir, "s.sqlite"));
    const aliasVault = new VaultService(
      aliasDb,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const aliasBrowser = new BrowserAutomationService(aliasDb, aliasVault, undefined, aliasDir);
    const aliasResult = await executePhase15ToolCall(
      "criativo_browser",
      { action: "status" },
      { agenteId: "estrategista", canalId: "canal-teste" },
      { db: aliasDb, workspaceRoot: aliasDir, browserService: aliasBrowser } as never
    );
    assert.ok(aliasResult !== undefined);
    await aliasBrowser.closeAll();
    aliasDb.close();

    // 7d. Verifica auto-aprovação de session/request_permission no OpenCodeLiveService
    const binDir = makeTempDir("p20-acp-bin-");
    const stubScriptPath = join(binDir, "opencode-acp-stub.mjs");
    writeFileSync(
      stubScriptPath,
      [
        "import readline from 'node:readline';",
        "if (process.argv.includes('models')) { console.log('opencode/test-free'); process.exit(0); }",
        "const rl = readline.createInterface({ input: process.stdin });",
        "let currentSession = 'sess-20';",
        "let promptMsgId = null;",
        "rl.on('line', (line) => {",
        "  if (!line.trim()) return;",
        "  const msg = JSON.parse(line);",
        "  if (msg.method === 'initialize') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } }));",
        "  } else if (msg.method === 'session/new') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: currentSession } }));",
        "  } else if (msg.method === 'session/prompt') {",
        "    promptMsgId = msg.id;",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: 9001, method: 'session/request_permission', params: { sessionId: currentSession, options: [{ optionId: 'allow_always', kind: 'allow_always' }, { optionId: 'reject', kind: 'reject_once' }] } }));",
        "  } else if (msg.id === 9001) {",
        "    const chosen = msg.result?.outcome?.optionId;",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PERM:' + chosen } } } }));",
        "    if (promptMsgId !== null) {",
        "      console.log(JSON.stringify({ jsonrpc: '2.0', id: promptMsgId, result: { stopReason: 'end_turn' } }));",
        "    }",
        "  }",
        "});",
      ].join("\n"),
      "utf8"
    );

    if (process.platform === "win32") {
      writeFileSync(
        join(binDir, "opencode.cmd"),
        `@echo off\r\n"${process.execPath}" "${stubScriptPath}" %*\r\n`,
        "utf8"
      );
    } else {
      const shPath = join(binDir, "opencode");
      writeFileSync(shPath, `#!/bin/sh\n"${process.execPath}" "${stubScriptPath}" "$@"\n`, "utf8");
      chmodSync(shPath, 0o755);
    }

    const prevPath = process.env.PATH ?? "";
    const prevSkipInSubtest = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${prevPath}`;
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    const openCodeSvc = new OpenCodeLiveService({ workspaceCwd: browserDir, appDataDir: binDir });
    try {
      const res = await openCodeSvc.executePrompt({
        modelId: "opencode/test-free",
        agentId: "estrategista",
        messages: [{ role: "user", text: "Testar permissão ACP" }],
        timeoutMs: 10_000,
      });
      assert.equal(res.text, "PERM:allow_always");
    } finally {
      openCodeSvc.close();
      if (prevSkipInSubtest !== undefined) {
        process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipInSubtest;
      }
      process.env.PATH = prevPath;
    }
  });
});
