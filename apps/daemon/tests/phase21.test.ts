import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  WhatsAppOrchestrator,
  WhatsAppArchiveService,
  WhatsAppMediaService,
  WhatsAppSenderRules,
  WhatsAppSessionManager,
  WhatsAppStudioClient,
  type BaileysSocketLike,
  type OutgoingWhatsAppPayload,
} from "@criativo/whatsapp";
import { initializeDatabase } from "../src/database/client.ts";
import {
  DEFAULT_PROMPT_TIMEOUT_MS,
  formatLabeledImageInstruction,
  resolveAcpModelSelection,
  type AntigravityAcpService,
} from "../src/providers/antigravity-acp-service.ts";
import { AntigravityLiveService } from "../src/providers/antigravity-live-service.ts";
import { OpenCodeLiveService } from "../src/providers/opencode-live-service.ts";
import { ProviderConnectionService } from "../src/providers/provider-connection-service.ts";
import { seedDefaultStudioExperience } from "../src/engine/runner/roster-defaults.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import {
  compactRecentHistory,
  hasExplicitVisualGenerationIntent,
  parseWorkflowTextToolCalls,
} from "../src/server/studio-routes.ts";
import {
  buildStudioLiveContext,
  selectBalancedVisualAssets,
  syncWorkspaceFilesToDatabase,
} from "../src/server/studio-tools-bridge.ts";
import { VaultService } from "../src/vault/vault-service.ts";

class MockWhatsAppSocket extends EventEmitter implements BaileysSocketLike {
  public user = {
    id: "5511999990001:1@s.whatsapp.net",
    lid: "9001122334455:1@lid",
    name: "Conta Teste",
  };
  public sentMessages: Array<{ jid: string; content: OutgoingWhatsAppPayload }> = [];

  public ev = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.on(event, listener);
    },
  };

  public async sendMessage(jid: string, content: OutgoingWhatsAppPayload): Promise<unknown> {
    this.sentMessages.push({ jid, content });
    return { key: { id: `echo-teste-${this.sentMessages.length}` } };
  }

  public end(): void {
    // noop
  }
}

describe("Fase 21 — Fotos Reais, generate_image, ACP Effort, MCP 2025-11-25, WhatsApp Self-Chat & Tópicos", () => {
  const tempDirs: string[] = [];
  const runtimes: DaemonRuntime[] = [];
  let prevSkipProbe: string | undefined;

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

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
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
      } catch {
        // Ignora lock residual no Windows
      }
    }
  });

  it("1. (MEDIA21-01) Prioriza fotos reais de recursos/fotos/ acima de >=6 referências, rotula papéis e exclui arquivos com anti-traversal", async () => {
    const wsDir = makeTempDir("p21-media-");
    mkdirSync(join(wsDir, "recursos", "fotos"), { recursive: true });
    mkdirSync(join(wsDir, "recursos", "referencias"), { recursive: true });
    mkdirSync(join(wsDir, "recursos", "logos"), { recursive: true });

    writeFileSync(join(wsDir, "recursos", "fotos", "retrato-teste-1.jpg"), Buffer.from("foto1"));
    writeFileSync(join(wsDir, "recursos", "fotos", "retrato-teste-2.png"), Buffer.from("foto2"));
    for (let i = 1; i <= 6; i += 1) {
      writeFileSync(
        join(wsDir, "recursos", "referencias", `ref-estilo-${i}.png`),
        Buffer.from(`ref${i}`)
      );
    }
    writeFileSync(join(wsDir, "recursos", "logos", "logo-teste.png"), Buffer.from("logo"));

    const rt = await createDaemonServer({
      workspaceRoot: wsDir,
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);

    const prevProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    try {
      syncWorkspaceFilesToDatabase(rt.db, wsDir);
      const balanced = selectBalancedVisualAssets(rt.db, wsDir, {
        maxFotos: 3,
        maxReferencias: 2,
        maxLogos: 1,
      });

      const fotos = balanced.filter((a) => a.role === "foto_real");
      const refs = balanced.filter((a) => a.role === "referencia_estilo");
      const logos = balanced.filter((a) => a.role === "logo");

      assert.equal(fotos.length, 2, "Deve incluir todas as fotos reais disponíveis (<= maxFotos)");
      assert.equal(refs.length, 2, "Referências devem ficar limitadas a maxReferencias=2");
      assert.equal(logos.length, 1, "Deve incluir 1 logo");
      assert.ok(fotos.every((f) => f.relPath.startsWith("recursos/fotos/")));
      assert.match(
        formatLabeledImageInstruction(fotos[0]!),
        /\[FOTO REAL DO USUÁRIO/
      );
      assert.match(
        formatLabeledImageInstruction(refs[0]!),
        /\[REFERÊNCIA DE ESTILO/
      );
    } finally {
      if (prevProbe !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevProbe;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    }

    // Inserir registro legítimo em recursos/fotos/ e registro malicioso fora das pastas permitidas
    const agora = new Date().toISOString();
    rt.db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run("arq-foto-del", "retrato-teste-1.jpg", "recursos/fotos/retrato-teste-1.jpg", "image/jpeg", 5, "referencia", "designer_post", null, agora);
    rt.db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run("arq-traversal", "segredo.txt", "../../segredo.txt", "text/plain", 5, "upload", "designer_post", null, agora);

    const addr = rt.httpServer.address();
    assert.ok(addr && typeof addr === "object");

    const traversalRes = await fetch(`http://127.0.0.1:${addr.port}/api/arquivos/arq-traversal`, {
      method: "DELETE",
    });
    assert.equal(traversalRes.status, 403, "Path traversal deve ser bloqueado com HTTP 403");

    const notFoundRes = await fetch(`http://127.0.0.1:${addr.port}/api/arquivos/inexistente-999`, {
      method: "DELETE",
    });
    assert.equal(notFoundRes.status, 404);

    const delOkRes = await fetch(`http://127.0.0.1:${addr.port}/api/arquivos/arq-foto-del`, {
      method: "DELETE",
    });
    assert.equal(delOkRes.status, 200);
    const delBody = (await delOkRes.json()) as { ok: boolean; arquivo_id: string };
    assert.equal(delBody.ok, true);
    assert.equal(delBody.arquivo_id, "arq-foto-del");
    assert.equal(
      existsSync(join(wsDir, "recursos", "fotos", "retrato-teste-1.jpg")),
      false,
      "Arquivo físico deve ser removido do disco"
    );
  });

  it("2. (IMG21-01) Expõe generate_image no MCP Bridge e reconhece follow-ups corretivos em hasExplicitVisualGenerationIntent", async () => {
    const wsDir = makeTempDir("p21-img-");
    const rt = await createDaemonServer({
      workspaceRoot: wsDir,
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);

    const visualTools = rt.studioMcpBridge.listToolsForAgent("designer_post");
    assert.ok(
      visualTools.some((t) => t.name === "generate_image"),
      "Catálogo MCP deve expor generate_image explicitamente"
    );

    // Follow-up corretivo em designer_post com contexto visual recente
    assert.equal(
      hasExplicitVisualGenerationIntent("esse ai nao sou eu, minhas fotos estao em recursos/fotos", "designer_post"),
      true
    );
    assert.equal(hasExplicitVisualGenerationIntent("kd?", "designer_post"), true);
    assert.equal(hasExplicitVisualGenerationIntent("oi, tudo bem?", "designer_post"), false);

    // Follow-up corretivo em agente não-visual com anexo gerado recente no histórico
    assert.equal(
      hasExplicitVisualGenerationIntent("refaca usando minha foto", "estrategista", false, [
        {
          mensagem_id: "m-prev",
          canal_id: "agente:estrategista",
          agente_id: "estrategista",
          autor: "agente",
          autor_nome: "Estrategista",
          conteudo_markdown: "Já estou processando a arte para você.",
          anexos: [
            {
              arquivo_id: "arq-1",
              nome: "arte-1.jpg",
              caminho_relativo: "saidas/artes/arte-1.jpg",
              url: "/api/arquivos/raw?path=saidas/artes/arte-1.jpg",
              mime_type: "image/jpeg",
              tipo_uso: "gerado",
            },
          ],
          steps: [],
          tarefa_id: null,
          lida: true,
          criado_em: new Date().toISOString(),
        },
      ]),
      true
    );
  });

  it("3. (MODEL21-01) Timeout ACP 180s, resolveAcpModelSelection com effort, zero fallback silencioso gemini-2.5-flash quando CLI ativo e fallbackReason em REST puro", async () => {
    assert.equal(DEFAULT_PROMPT_TIMEOUT_MS, 180_000);

    const candidates = [
      "gemini-4-argon-low",
      "gemini-4-argon-medium",
      "gemini-4-argon-high",
      "gemini-4-argon-xhigh",
    ];
    assert.equal(resolveAcpModelSelection("gemini-4-argon", candidates, "baixo"), "gemini-4-argon-low");
    assert.equal(resolveAcpModelSelection("gemini-4-argon", candidates, "medio"), "gemini-4-argon-medium");
    assert.equal(resolveAcpModelSelection("gemini-4-argon", candidates, "alto"), "gemini-4-argon-high");
    assert.equal(resolveAcpModelSelection("gemini-4-argon", candidates, "maximo"), "gemini-4-argon-xhigh");

    // Configurar DB + conta sintética Antigravity
    const dir = makeTempDir("p21-model-");
    const db = initializeDatabase({ dbPath: join(dir, "studio.sqlite") });
    const geminiDir = join(dir, "conta-1");
    mkdirSync(join(geminiDir, "antigravity-acp"), { recursive: true });
    writeFileSync(
      join(geminiDir, "antigravity-acp", "antigravity-oauth-token"),
      JSON.stringify({
        id_token_email: "usuario-teste@example.com",
        token: {
          access_token: "ya29.token-teste",
          refresh_token: "1//refresh-token-teste",
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        },
      }),
      "utf8"
    );
    db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em) VALUES ('antigravity_contas_studio', ?, ?);`
      )
      .run(
        JSON.stringify([{ id: "acc-teste-1", email: "usuario-teste@example.com", geminiDir }]),
        new Date().toISOString()
      );

    try {
      // 3a. CLI ativo e falha em modelo interno -> NÃO pode cair silenciosamente para gemini-2.5-flash REST
      let generateContentCalled = false;
      const acpMockActive = {
        getCliExecutable: () => "mock-agy",
        listAvailableModels: async () => ({
          models: [{ modelId: "gemini-4-argon-high", name: "Gemini 4 Argon", description: null, isDefault: true }],
          defaultModelId: "gemini-4-argon-high",
        }),
        executePrompt: async () => {
          throw new Error("Erro transitório ACP mockado");
        },
        disposeAccount: () => {},
        refreshAccountToken: async () => ({ accessToken: "ya29.token-teste" }),
        closeAll: () => {},
      } as unknown as AntigravityAcpService;

      const svcWithCli = new AntigravityLiveService({
        db,
        workspaceCwd: dir,
        acpService: acpMockActive,
        fetchImpl: (async (url) => {
          if (String(url).includes("generateContent")) {
            generateContentCalled = true;
            throw new Error("generateContent REST não deveria ser chamado quando CLI ACP está ativo");
          }
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as typeof fetch,
      });

      await assert.rejects(
        () =>
          svcWithCli.executeCodeAssistGenerate({
            model: "gemini-4-argon",
            effort: "alto",
            messages: [{ role: "user", text: "Olá teste" }],
          }),
        /runtime Antigravity ACP.*gemini-4-argon/i
      );
      assert.equal(generateContentCalled, false, "Não deve rebaixar para Code Assist REST quando CLI ACP está ativo");

      // 3b. Sem CLI ACP (REST puro) -> permite redirecionamento informando fallbackReason
      const acpMockAbsent = {
        getCliExecutable: () => null,
        listAvailableModels: async () => ({ models: [], defaultModelId: null }),
        closeAll: () => {},
      } as unknown as AntigravityAcpService;

      const svcRestOnly = new AntigravityLiveService({
        db,
        workspaceCwd: dir,
        acpService: acpMockAbsent,
        fetchImpl: (async (url) => {
          const urlStr = String(url);
          if (urlStr.includes("loadCodeAssist")) {
            return new Response(JSON.stringify({ cloudaicompanionProject: "proj-teste" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({
              response: {
                candidates: [{ content: { parts: [{ text: "Resposta REST sintética" }] } }],
                usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }) as typeof fetch,
      });

      const restOut = await svcRestOnly.executeCodeAssistGenerate({
        model: "gemini-4-argon",
        messages: [{ role: "user", text: "Olá teste REST" }],
      });
      assert.equal(restOut.text, "Resposta REST sintética");
      assert.ok(restOut.fallbackReason && restOut.fallbackReason.includes("gemini-4-argon"));
    } finally {
      db.close();
    }
  });

  it("4. (MCP21-01) MCP negocia 2025-11-25, oculta 23 aliases browser_*, OpenCode passa --pure e contexto/histórico são compactados", async () => {
    const dir = makeTempDir("p21-mcp-");
    const rt = await createDaemonServer({
      workspaceRoot: dir,
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);

    const mcpUrl = rt.studioMcpBridge.getEndpointUrlForAgent("estrategista");
    assert.ok(mcpUrl);
    const mcpHeaders = {
      "Content-Type": "application/json",
      "X-Criativo-Mcp-Token": rt.studioMcpBridge.getAuthToken(),
    };

    const initRes = await fetch(mcpUrl, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {} },
      }),
    });
    assert.equal(initRes.status, 200);
    const initJson = (await initRes.json()) as { result: { protocolVersion: string } };
    assert.equal(initJson.result.protocolVersion, "2025-11-25");

    const listRes = await fetch(mcpUrl, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { result: { tools: Array<{ name: string }> } };
    const names = listJson.result.tools.map((t) => t.name);
    assert.ok(names.includes("criativo_browser"), "criativo_browser deve estar exposta em tools/list");
    assert.equal(
      names.filter((n) => n.startsWith("browser_")).length,
      0,
      "Os 23 aliases browser_* devem ficar ocultos em tools/list"
    );

    // Normalização de prefixo criativo_studio_* em parseWorkflowTextToolCalls
    const parsedCalls = parseWorkflowTextToolCalls(
      '<tool_call>{"name":"criativo_studio_criativo_browser","arguments":{"action":"status"}}</tool_call>\n' +
        '<tool_call>{"name":"mcp__criativo_studio__generate_image","arguments":{"prompt":"post 3:4"}}</tool_call>'
    );
    assert.equal(parsedCalls.length, 2);
    assert.equal(parsedCalls[0]?.name, "criativo_browser");
    assert.equal(parsedCalls[1]?.name, "generate_image");

    // Compactação de histórico (<= 6 msgs, <= 1200 chars cada) e contexto vivo condicional
    const longMsg = "X".repeat(2200);
    const fakeHistory = Array.from({ length: 10 }, (_, idx) => ({
      mensagem_id: `m-${idx}`,
      canal_id: "agente:copywriter",
      agente_id: "copywriter",
      autor: (idx % 2 === 0 ? "usuario" : "agente") as "usuario" | "agente",
      autor_nome: "Teste",
      conteudo_markdown: longMsg,
      anexos: [],
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    }));
    const compacted = compactRecentHistory(fakeHistory, 6, 1200);
    assert.equal(compacted.length, 6);
    assert.ok(compacted.every((m) => m.text.length <= 1230));

    const compactCtx = buildStudioLiveContext({
      db: rt.db,
      vault: rt.vault,
      providerConnection: rt.providerConnection,
      workspaceRoot: dir,
      agenteId: "copywriter",
      userPrompt: "Escreva 3 ganchos curtos",
    });
    const fullCtx = buildStudioLiveContext({
      db: rt.db,
      vault: rt.vault,
      providerConnection: rt.providerConnection,
      workspaceRoot: dir,
      agenteId: "copywriter",
      userPrompt: "Delegue para @designer_post criar o criativo",
    });
    assert.ok(compactCtx.length < fullCtx.length, "Prompt simples deve carregar contexto mais enxuto");

    // Stub OpenCode verificando que '--pure' é passado no spawn de acp
    const binDir = makeTempDir("p21-oc-bin-");
    const stubPath = join(binDir, "opencode-p21-stub.mjs");
    writeFileSync(
      stubPath,
      [
        "import readline from 'node:readline';",
        "if (process.argv.includes('models')) { console.log('opencode/test-free'); process.exit(0); }",
        "const rl = readline.createInterface({ input: process.stdin });",
        "const hasPure = process.argv.includes('--pure');",
        "rl.on('line', (line) => {",
        "  if (!line.trim()) return;",
        "  const msg = JSON.parse(line);",
        "  if (msg.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } }));",
        "  else if (msg.method === 'session/new') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-p21' } }));",
        "  else if (msg.method === 'session/prompt') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PURE:' + hasPure } } } }));",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }));",
        "  }",
        "});",
      ].join("\n"),
      "utf8"
    );
    if (process.platform === "win32") {
      writeFileSync(
        join(binDir, "opencode.cmd"),
        `@echo off\r\n"${process.execPath}" "${stubPath}" %*\r\n`,
        "utf8"
      );
    } else {
      const sh = join(binDir, "opencode");
      writeFileSync(sh, `#!/bin/sh\n"${process.execPath}" "${stubPath}" "$@"\n`, "utf8");
      chmodSync(sh, 0o755);
    }

    const prevPath = process.env.PATH ?? "";
    const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${prevPath}`;
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    const ocSvc = new OpenCodeLiveService({ workspaceCwd: dir, appDataDir: binDir });
    try {
      const ocRes = await ocSvc.executePrompt({
        modelId: "opencode/test-free",
        agentId: "estrategista",
        messages: [{ role: "user", text: "Testar --pure" }],
        timeoutMs: 10_000,
      });
      assert.equal(ocRes.text, "PURE:true");
    } finally {
      ocSvc.close();
      if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
      process.env.PATH = prevPath;
    }
  });

  it("5. (WPP21-01) WhatsApp Self-Chat reconhece @lid, append recente com emitOwnEvents e dispara onAuthorizedMessage sem eco", async () => {
    const dir = makeTempDir("p21-wpp-");
    const db = initializeDatabase({ dbPath: join(dir, "wpp.sqlite") });
    seedDefaultStudioExperience(db);
    try {
      const clientSrcPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../packages/whatsapp/src/client.ts"
      );
      assert.match(readFileSync(clientSrcPath, "utf8"), /emitOwnEvents:\s*true/);

      const rules = new WhatsAppSenderRules(db.connection);
      const evalLid = await rules.evaluateIncoming({
        contaId: "default",
        modoOperacao: "ownNumber",
        codigoAutorizacaoObrigatorio: false,
        grupoAutoResponder: false,
        ownJid: "5511999990001@s.whatsapp.net",
        ownLid: "9001122334455:1@lid",
        msg: {
          contaId: "default",
          messageId: "wamid-self-1",
          remoteJid: "9001122334455@lid",
          fromMe: true,
          isGroup: false,
          pushName: "Teste",
          text: "Olá self-chat",
          timestamp: Math.floor(Date.now() / 1000),
          hasMedia: false,
        },
      });
      assert.equal(evalLid.decision, "allow");
      assert.equal(evalLid.reason, "self_chat");

      const mockSocket = new MockWhatsAppSocket();
      const sessionMgr = new WhatsAppSessionManager({
        db: db.connection,
        socketFactory: async () => mockSocket,
      });
      const client = sessionMgr.getOrCreateClient("default");
      await client.connect();
      mockSocket.emit("connection.update", { connection: "open" });
      for (let i = 0; i < 30 && client.getStatus().status !== "conectado"; i += 1) {
        await new Promise((r) => setTimeout(r, 15));
      }

      assert.equal(client.getOwnLid(), "9001122334455:1@lid");

      const handledTexts: string[] = [];
      const orch = new WhatsAppOrchestrator({
        db: db.connection,
        sessionManager: sessionMgr,
        senderRules: rules,
        mediaService: new WhatsAppMediaService({ db: db.connection, workspaceRoot: dir }),
        archiveService: new WhatsAppArchiveService({ db: db.connection, workspaceRoot: dir }),
        onAuthorizedMessage: async (evt) => {
          handledTexts.push(evt.text);
          await evt.client.sendMessage(evt.msg.remoteJid, {
            text: `Eco controlado: ${evt.text}`,
          });
          return true;
        },
      });

      // Atualiza para modo ownNumber no banco
      db.connection
        .prepare(
          `UPDATE whatsapp_contas SET modo_operacao = 'ownNumber', jid_proprio = '5511999990001@s.whatsapp.net' WHERE conta_id = 'default';`
        )
        .run();

      // Mensagem antiga via 'append' (120s antes do openedAt) deve ser ignorada
      const nowSec = Math.floor(Date.now() / 1000);
      mockSocket.emit("messages.upsert", {
        type: "append",
        messages: [
          {
            key: { id: "msg-antiga-append", remoteJid: "9001122334455@lid", fromMe: true },
            messageTimestamp: nowSec - 120,
            message: { conversation: "Histórico antigo" },
          },
        ],
      });

      // Mensagem recente via 'append' deve ser aceita e responder sem loop
      mockSocket.emit("messages.upsert", {
        type: "append",
        messages: [
          {
            key: { id: "msg-nova-append", remoteJid: "9001122334455@lid", fromMe: true },
            messageTimestamp: nowSec + 2,
            message: { conversation: "Testar resposta self-chat" },
          },
        ],
      });

      for (let i = 0; i < 40 && handledTexts.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.deepEqual(handledTexts, ["Testar resposta self-chat"]);
      assert.equal(mockSocket.sentMessages.length, 1);

      // Reenvio do ID gerado pelo próprio sendText deve ser bloqueado como eco
      const sentPayload = mockSocket.sentMessages[0]!.content;
      assert.ok(sentPayload);
      mockSocket.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { id: "echo-teste-1", remoteJid: "9001122334455@lid", fromMe: true },
            messageTimestamp: nowSec + 3,
            message: { conversation: "Eco controlado: Testar resposta self-chat" },
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(handledTexts.length, 1, "Eco não pode reentrar no onAuthorizedMessage");

      await orch.stop();
    } finally {
      db.close();
    }
  });

  it("6. (UX21-02) POST /api/agentes/:id/threads { vazio: true } cria 'Novo tópico' e auto-renomeia na 1ª mensagem", async () => {
    const dir = makeTempDir("p21-topics-");
    const rt = await createDaemonServer({
      workspaceRoot: dir,
      port: 0,
      bypassLicense: true,
    });
    runtimes.push(rt);

    const addr = rt.httpServer.address();
    assert.ok(addr && typeof addr === "object");

    const createRes = await fetch(`http://127.0.0.1:${addr.port}/api/agentes/estrategista/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vazio: true }),
    });
    assert.equal(createRes.status, 201);
    const createdBody = (await createRes.json()) as {
      thread: { thread_id: string; titulo: string; estado: string };
    };
    assert.equal(createdBody.thread.titulo, "Novo tópico");
    assert.equal(createdBody.thread.estado, "ociosa");

    const renamed = rt.tasksService.maybeAutoRenameTopic(
      createdBody.thread.thread_id,
      "Planejar calendário editorial da semana"
    );
    assert.ok(renamed);
    assert.match(renamed.titulo, /Planejar calendário editorial/);
    assert.equal(renamed.titulo_origem, "auto");
  });
});
