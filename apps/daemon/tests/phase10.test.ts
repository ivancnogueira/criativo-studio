import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WhatsAppMediaService,
  WhatsAppSenderRules,
  useSqliteAuthState,
  type BaileysSocketLike,
  type OutgoingWhatsAppPayload,
} from "@criativo/whatsapp";
import { whatsAppNumberForms } from "@criativo/contracts";
import { initializeDatabase } from "../src/database/client.ts";
import { toAcpMcpServers } from "../src/mcp/mcp-provider-shapes.ts";
import { redactMcpSecrets } from "../src/mcp/mcp-redaction.ts";
import { inspectMcpServer } from "../src/mcp/mcp-probe.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { executeStudioExtensionTool } from "../src/server/studio-tools-bridge.ts";

class FakeBaileysSocket extends EventEmitter implements BaileysSocketLike {
  public user: { id: string; name?: string } | null = {
    id: "5511900000000:1@s.whatsapp.net",
    name: "Estudio Teste",
  };
  public sentMessages: Array<{ jid: string; content: OutgoingWhatsAppPayload }> = [];
  public pairingRequests: string[] = [];
  public lidMap = new Map<string, string>();
  public ended = false;

  public ev = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.on(event, listener);
    },
  };

  public signalRepository = {
    lidMapping: {
      getPNForLID: async (lid: string) => this.lidMap.get(lid) ?? null,
    },
  };

  public async requestPairingCode(phoneNumber: string): Promise<string> {
    this.pairingRequests.push(phoneNumber);
    return "12345678";
  }

  public async sendMessage(jid: string, content: OutgoingWhatsAppPayload): Promise<unknown> {
    this.sentMessages.push({ jid, content });
    return { key: { id: `sent-${this.sentMessages.length}` } };
  }

  public end(): void {
    this.ended = true;
  }
}

function listenHttpServer(server: HttpServer): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

describe("Fase 10 — Loja Unificada, WhatsApp Real Completo & MCPs Ponta-a-Ponta", () => {
  const createdDirs: string[] = [];
  let prevSkipProbe: string | undefined;

  before(() => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  });

  after(() => {
    for (const dir of createdDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (prevSkipProbe === undefined) {
      delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    } else {
      process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    }
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    createdDirs.push(dir);
    return dir;
  }

  it("1. Migração não-destrutiva em SQLite legado + catálogo clean-room (>=253 apps, >=40 skills, >=27 agentes)", async () => {
    const tempDir = makeTempDir("criativo-p10-mig-");
    const dbPath = join(tempDir, "legado.db");

    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE projecao_conexoes_mensageria (
        tipo_servico TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'desconectado',
        qrcode_base64 TEXT,
        sessao_dados_json TEXT,
        notificar_aprovacoes INTEGER NOT NULL DEFAULT 1,
        atualizado_em TEXT NOT NULL
      );
      CREATE TABLE projecao_mcp_servidores (
        mcp_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        comando TEXT NOT NULL,
        args_json TEXT NOT NULL,
        env_json TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1
      );
    `);

    const authCredsJson = JSON.stringify({ creds: { registered: true, me: { id: "5511912345678:1@s.whatsapp.net" } }, keys: {} });
    raw
      .prepare(
        `INSERT INTO projecao_conexoes_mensageria (tipo_servico, status, qrcode_base64, sessao_dados_json, atualizado_em) VALUES (?, ?, ?, ?, ?);`
      )
      .run("whatsapp", "conectado", "data:image/png;base64,OLDQR", authCredsJson, new Date().toISOString());

    raw
      .prepare(
        `INSERT INTO projecao_mcp_servidores (mcp_id, nome, comando, args_json, env_json, ativo) VALUES (?, ?, ?, ?, ?, ?);`
      )
      .run("legacy-srv", "Servidor Legado", "node", JSON.stringify(["server.js"]), JSON.stringify({ API_KEY: "segredo-legado-123" }), 1);
    raw.close();

    const db = initializeDatabase({ dbPath });
    try {
      const migratedAccount = db.connection
        .prepare(`SELECT * FROM whatsapp_contas WHERE conta_id = ?;`)
        .get(DEFAULT_WHATSAPP_ACCOUNT_ID) as { conta_id: string; qrcode_base64: string | null } | undefined;
      assert.ok(migratedAccount, "Conta legada 'whatsapp' deve ser migrada para 'whatsapp-principal'");
      assert.equal(migratedAccount.qrcode_base64, "data:image/png;base64,OLDQR");

      const legacyMcp = db.connection
        .prepare(`SELECT * FROM projecao_mcp_servidores WHERE mcp_id = 'legacy-srv';`)
        .get() as { nome: string; transporte: string } | undefined;
      assert.equal(legacyMcp?.nome, "Servidor Legado");
      assert.equal(legacyMcp?.transporte, "stdio");

      const tables = db.connection
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table';`)
        .all() as Array<{ name: string }>;
      const tableSet = new Set(tables.map((t) => t.name));
      for (const required of [
        "whatsapp_contas",
        "whatsapp_contatos_autorizados",
        "whatsapp_pairing_requests",
        "whatsapp_historico_mensagens",
        "projecao_mcp_oauth_tokens",
        "projecao_habilidades_catalogo",
        "projecao_agente_habilidades",
      ]) {
        assert.ok(tableSet.has(required), `Tabela obrigatória ausente: ${required}`);
      }
    } finally {
      db.close();
    }

    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${runtime.port}/api/loja/catalogo`);
      assert.equal(res.status, 200);
      const snapshot = (await res.json()) as {
        apps: Array<{ slug: string; iconUrl?: string }>;
        skills: Array<{ slug: string; nome: string }>;
        agents: Array<{ slug: string; nome: string }>;
      };
      assert.ok(snapshot.apps.length >= 253, `Esperado >= 253 apps, veio ${snapshot.apps.length}`);
      assert.ok(snapshot.skills.length >= 40, `Esperado >= 40 skills, veio ${snapshot.skills.length}`);
      assert.ok(snapshot.agents.length >= 27, `Esperado >= 27 agentes, veio ${snapshot.agents.length}`);

      const rawJson = JSON.stringify(snapshot);
      assert.equal(/claramendes|ivancnogueira/i.test(rawJson), false);
    } finally {
      await runtime.close();
    }
  });

  it("2. WhatsApp multi-número: auto-boot, QR/código numérico, 9º dígito BR, pareamento 6 chars, mídia real e retenção 90 dias", async () => {
    const tempDir = makeTempDir("criativo-p10-wapp-");
    const dbPath = join(tempDir, "wapp.db");
    const socketByAccount = new Map<string, FakeBaileysSocket>();
    const observedBrowsers: Array<[string, string, string]> = [];

    const dbPre = initializeDatabase({ dbPath });
    const preAuth = await useSqliteAuthState(dbPre.connection, DEFAULT_WHATSAPP_ACCOUNT_ID);
    preAuth.state.creds.registered = true;
    preAuth.state.creds.me = { id: "5511900000000:1@s.whatsapp.net", name: "Conta Principal" };
    await preAuth.saveCreds();
    dbPre.close();

    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: true,
      controlSocketPath: null,
      whatsappVersionFetcher: async () => ({ version: [2, 3000, 1020000000], isLatest: true }),
      whatsappSocketFactory: async (_authState, ctx) => {
        if (ctx?.browser) {
          observedBrowsers.push(ctx.browser);
        }
        const sock = new FakeBaileysSocket();
        const key = `${observedBrowsers.length}`;
        socketByAccount.set(key, sock);
        return sock;
      },
    });

    const baseUrl = `http://127.0.0.1:${runtime.port}`;
    try {
      // Aguarda auto-boot conectar whatsapp-principal e abrir o socket
      for (let i = 0; i < 60 && !socketByAccount.has("1"); i += 1) {
        await new Promise((r) => setTimeout(r, 25));
      }
      const sockPrincipal = socketByAccount.get("1");
      assert.ok(sockPrincipal, "Auto-boot deveria abrir socket para conta registrada");
      sockPrincipal.emit("connection.update", { connection: "open" });

      // Cria segunda conta e testa pareamento por código numérico (browser Linux) e QR (browser CriativoOS)
      const createRes = await fetch(`${baseUrl}/api/mensageria/whatsapp/contas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rotulo: "Atendimento Secundario",
          modo_operacao: "dedicated",
          codigo_autorizacao_obrigatorio: true,
          grupo_auto_responder: true,
        }),
      });
      assert.equal(createRes.status, 201);
      const createdJson = (await createRes.json()) as { conta: { conta_id: string } };
      const secondId = createdJson.conta.conta_id;

      const pairPhoneRes = await fetch(
        `${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/conectar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "pairing_code", phoneNumber: "+55 (11) 98888-7777" }),
        }
      );
      assert.equal(pairPhoneRes.status, 200);
      const sockSecondPair = Array.from(socketByAccount.values()).at(-1)!;
      sockSecondPair.emit("connection.update", { connection: "connecting" });
      for (let i = 0; i < 40 && !runtime.whatsappManager.getClient(secondId)?.getStatus().pairing_code; i += 1) {
        await new Promise((r) => setTimeout(r, 15));
      }
      const pairStatus = runtime.whatsappManager.getClient(secondId)?.getStatus();
      assert.equal(pairStatus?.pairing_code, "1234-5678");
      assert.ok(
        observedBrowsers.some((b) => b[0] === "Chrome (Linux)"),
        "Modo pairing_code deve usar browser 'Chrome (Linux)'"
      );

      await fetch(`${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/desconectar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limparSessao: true }),
      });

      const qrRes = await fetch(`${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/conectar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "qr" }),
      });
      assert.equal(qrRes.status, 200);
      assert.ok(
        observedBrowsers.some((b) => b[0] === "CriativoOS"),
        "Modo QR deve usar browser 'CriativoOS'"
      );

      // Regras de remetente: ownNumber ignora estranho; dedicated gera código 6 chars e aprova via API
      const rules = new WhatsAppSenderRules(runtime.db.connection);
      assert.ok(whatsAppNumberForms("5511988887777").includes("551188887777"));

      // Modo ownNumber: bloqueia silenciosamente terceiros e permite self-chat
      await fetch(`${baseUrl}/api/mensageria/whatsapp/contas/${DEFAULT_WHATSAPP_ACCOUNT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo_operacao: "ownNumber" }),
      });
      const evalOwn = await rules.evaluateIncoming({
        contaId: DEFAULT_WHATSAPP_ACCOUNT_ID,
        modoOperacao: "ownNumber",
        codigoAutorizacaoObrigatorio: true,
        grupoAutoResponder: false,
        ownJid: "5511900000000@s.whatsapp.net",
        msg: {
          messageId: "m-own-1",
          remoteJid: "5511977776666@s.whatsapp.net",
          fromMe: false,
          text: "Oi",
        },
      });
      assert.equal(evalOwn.decision, "ignore");

      // Contato com 9º dígito normalizado na secundária (dedicated)
      await fetch(`${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/contatos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "contato",
          identificador_jid: "5511988887777",
          nome_exibicao: "Contato Teste",
          permitido: true,
        }),
      });
      const evalBr = await rules.evaluateIncoming({
        contaId: secondId,
        modoOperacao: "dedicated",
        codigoAutorizacaoObrigatorio: true,
        grupoAutoResponder: false,
        msg: {
          messageId: "m-br-1",
          remoteJid: "551188887777@s.whatsapp.net",
          fromMe: false,
          text: "Criar post sobre produtividade",
        },
      });
      assert.equal(evalBr.decision, "allow");

      // Desconhecido na secundária recebe desafio com código de 6 chars e aprovação via endpoint
      const sockSecond = Array.from(socketByAccount.values()).at(-1)!;
      sockSecond.emit("connection.update", { connection: "open" });
      await runtime.whatsappOrchestrator.handleIncomingMessage(
        secondId,
        {
          messageId: "m-unk-1",
          remoteJid: "5521991112222@s.whatsapp.net",
          pushName: "Lead Novo",
          fromMe: false,
          text: "Quero falar com um agente",
        },
        runtime.whatsappManager.getClient(secondId)!
      );

      const pairingsRes = await fetch(
        `${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/pareamentos`
      );
      const pairingsJson = (await pairingsRes.json()) as {
        pareamentos: Array<{ request_id: string; codigo: string; status: string }>;
      };
      assert.equal(pairingsJson.pareamentos.length, 1);
      assert.equal(pairingsJson.pareamentos[0].codigo.length, 6);

      const resolveRes = await fetch(
        `${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/pareamentos/${pairingsJson.pareamentos[0].request_id}/resolver`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aprovar: true }),
        }
      );
      assert.equal(resolveRes.status, 200);

      // Grupo com somente_mencao = true: ignora sem menção e libera quando mencionado
      await fetch(`${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/contatos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "grupo",
          identificador_jid: "120363000111@g.us",
          nome_exibicao: "Grupo Editorial",
          permitido: true,
          somente_mencao: true,
        }),
      });
      const evalGrpNoMention = await rules.evaluateIncoming({
        contaId: secondId,
        modoOperacao: "dedicated",
        codigoAutorizacaoObrigatorio: true,
        grupoAutoResponder: false,
        ownJid: "5511900000000@s.whatsapp.net",
        msg: {
          messageId: "m-grp-1",
          remoteJid: "120363000111@g.us",
          participant: "5511911110000@s.whatsapp.net",
          fromMe: false,
          isGroup: true,
          mentionedJids: [],
          text: "Conversa paralela",
        },
      });
      assert.equal(evalGrpNoMention.decision, "ignore");

      const evalGrpMentioned = await rules.evaluateIncoming({
        contaId: secondId,
        modoOperacao: "dedicated",
        codigoAutorizacaoObrigatorio: true,
        grupoAutoResponder: false,
        ownJid: "5511900000000@s.whatsapp.net",
        msg: {
          messageId: "m-grp-2",
          remoteJid: "120363000111@g.us",
          participant: "5511911110000@s.whatsapp.net",
          fromMe: false,
          isGroup: true,
          mentionedJids: ["5511900000000@s.whatsapp.net"],
          text: "@estudio cria um roteiro",
        },
      });
      assert.equal(evalGrpMentioned.decision, "allow");

      // Download real de mídia para recursos/uploads/whatsapp/ + indexação em projecao_arquivos e retenção 90d
      const mediaService = new WhatsAppMediaService({
        db: runtime.db.connection,
        workspaceRoot: tempDir,
        mediaDownloader: async () => Readable.from([Buffer.from("PNG_BINARY_BYTES")]),
      });
      const downloaded = await mediaService.downloadIncomingMedia(
        sockSecond,
        {
          messageId: "m-img-1",
          remoteJid: "551188887777@s.whatsapp.net",
          fromMe: false,
          mediaType: "image",
          mediaMimeType: "image/png",
          mediaFileName: "referencia.png",
          rawMessage: { key: { id: "m-img-1" } },
        },
        secondId
      );
      assert.ok(downloaded);
      assert.ok(downloaded.caminhoRelativo.startsWith("recursos/uploads/whatsapp/"));
      assert.ok(existsSync(downloaded.diskPath));

      const fileRow = runtime.db.connection
        .prepare(`SELECT arquivo_id FROM projecao_arquivos WHERE arquivo_id = ?;`)
        .get(downloaded.arquivoId);
      assert.ok(fileRow, "Mídia recebida deve ser indexada em projecao_arquivos");

      // Histórico + expira_em 90 dias no endpoint
      runtime.db.connection
        .prepare(
          `INSERT INTO whatsapp_historico_mensagens (mensagem_id, conta_id, chat_jid, remetente_jid, direcao, tipo_conteudo, texto, ocorrido_em, expira_em) VALUES (?, ?, ?, ?, 'entrada', 'texto', 'Mensagem recente', ?, ?);`
        )
        .run(
          "hist-ok",
          secondId,
          "551188887777@s.whatsapp.net",
          "551188887777@s.whatsapp.net",
          new Date().toISOString(),
          new Date(Date.now() + 89 * 86_400_000).toISOString()
        );
      const histRes = await fetch(
        `${baseUrl}/api/mensageria/whatsapp/contas/${secondId}/historico`
      );
      assert.equal(histRes.status, 200);
      const histJson = (await histRes.json()) as {
        mensagens: Array<{ mensagem_id: string }>;
      };
      assert.ok(histJson.mensagens.some((m) => m.mensagem_id === "hist-ok"));
    } finally {
      await runtime.close();
    }
  });

  it("3. MCP Gateway: OAuth 2.1 PKCE (RFC 9728/8414/7591), Proxy Loopback -32001, STDIO real, toAcpMcpServers & redactMcpSecrets", async () => {
    const tempDir = makeTempDir("criativo-p10-mcp-");
    const dbPath = join(tempDir, "mcp.db");
    let requireReauth = false;
    let issuedAccessToken = "oauth-access-token-super-secreto-999";
    let capturedCodeChallenge = "";
    const authCodes = new Map<string, { codeChallenge: string }>();

    let mockPort = 0;
    const mockOAuthMcp = createHttpServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${mockPort}`);
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            resource: `http://127.0.0.1:${mockPort}/mcp`,
            authorization_servers: [`http://127.0.0.1:${mockPort}`],
          })
        );
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: `http://127.0.0.1:${mockPort}`,
            authorization_endpoint: `http://127.0.0.1:${mockPort}/authorize`,
            token_endpoint: `http://127.0.0.1:${mockPort}/token`,
            registration_endpoint: `http://127.0.0.1:${mockPort}/register`,
            revocation_endpoint: `http://127.0.0.1:${mockPort}/revoke`,
            code_challenge_methods_supported: ["S256"],
          })
        );
        return;
      }
      if (url.pathname === "/register" && req.method === "POST") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ client_id: "dyn-client-123", client_secret: "dyn-secret-456" }));
        return;
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const code = form.get("code") ?? "";
        const verifier = form.get("code_verifier") ?? "";
        const saved = authCodes.get(code);
        if (!saved) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        const computed = createHash("sha256").update(verifier).digest("base64url");
        assert.equal(computed, saved.codeChallenge, "PKCE S256 verifier deve corresponder ao challenge");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: issuedAccessToken,
            refresh_token: "oauth-refresh-token-888",
            token_type: "Bearer",
            expires_in: 3600,
          })
        );
        return;
      }
      if (url.pathname === "/mcp" && req.method === "POST") {
        const authHeader = req.headers.authorization;
        if (requireReauth || authHeader !== `Bearer ${issuedAccessToken}`) {
          res.writeHead(401, {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${mockPort}/.well-known/oauth-protected-resource"`,
          });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }

        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          id?: number | string;
          method: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
        };

        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-mcp-1" });
        if (body.method === "initialize") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05" } }));
          return;
        }
        if (body.method === "tools/list") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [
                  {
                    name: "ping_remoto",
                    description: "Executa ping autenticado",
                    inputSchema: { type: "object", properties: { msg: { type: "string" } } },
                  },
                ],
              },
            })
          );
          return;
        }
        if (body.method === "tools/call") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [{ type: "text", text: `pong:${String(body.params?.arguments?.msg ?? "")}` }],
              },
            })
          );
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    mockPort = await listenHttpServer(mockOAuthMcp);

    // Servidor MCP STDIO filho em Node puro
    const stdioScriptPath = join(tempDir, "echo-mcp-stdio.mjs");
    writeFileSync(
      stdioScriptPath,
      [
        'import { createInterface } from "node:readline";',
        'const rl = createInterface({ input: process.stdin });',
        'rl.on("line", (line) => {',
        '  if (!line.trim()) return;',
        '  const req = JSON.parse(line);',
        '  if (req.id === undefined) return;',
        '  if (req.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } }) + "\\n");',
        '  else if (req.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [{ name: "echo_local", description: "Eco STDIO", inputSchema: { type: "object", properties: { texto: { type: "string" } } } }] } }) + "\\n");',
        '  else if (req.method === "tools/call") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "stdio:" + (req.params?.arguments?.texto ?? "") }] } }) + "\\n");',
        '  else process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }) + "\\n");',
        '});',
      ].join("\n"),
      "utf8"
    );

    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    try {
      // Cadastra servidor HTTP OAuth sem token ainda -> probe deve indicar needs_sign_in
      const mcpHttpCreate = await fetch(`${baseUrl}/api/mcps/servidores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcp_id: "mcp-oauth-remoto",
          nome: "Mcp OAuth Teste",
          transporte: "http",
          url: `http://127.0.0.1:${mockPort}/mcp`,
          headers: { "X-Api-Secret": "hdr-secret-abc" },
          ativo: true,
        }),
      });
      assert.equal(mcpHttpCreate.status, 201);

      const probeBefore = await fetch(`${baseUrl}/api/mcps/servidores/mcp-oauth-remoto/testar`, {
        method: "POST",
      });
      assert.equal(probeBefore.status, 200);
      const probeBeforeJson = (await probeBefore.json()) as { status: string };
      assert.equal(probeBeforeJson.status, "needs_sign_in");

      // Inicia fluxo OAuth 2.1 PKCE e simula aprovação no servidor OAuth
      const oauthStart = await fetch(`${baseUrl}/api/mcps/servidores/mcp-oauth-remoto/oauth/iniciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(oauthStart.status, 200);
      const oauthStartJson = (await oauthStart.json()) as { authorizeUrl: string; state: string };
      const authUrl = new URL(oauthStartJson.authorizeUrl);
      capturedCodeChallenge = authUrl.searchParams.get("code_challenge") ?? "";
      assert.ok(capturedCodeChallenge.length > 10);
      authCodes.set("code-aprovado-1", { codeChallenge: capturedCodeChallenge });

      const cbRes = await fetch(
        `${baseUrl}/api/mcps/oauth/callback?code=code-aprovado-1&state=${encodeURIComponent(oauthStartJson.state)}`
      );
      assert.equal(cbRes.status, 200);
      const cbHtml = await cbRes.text();
      assert.ok(cbHtml.includes("Autenticação concluída"));

      // Token salvo cifrado no SQLite + Proxy loopback conectado
      const tokenRow = runtime.db.connection
        .prepare(`SELECT payload_criptografado FROM projecao_mcp_oauth_tokens WHERE mcp_id = 'mcp-oauth-remoto';`)
        .get() as { payload_criptografado: string } | undefined;
      assert.ok(tokenRow);
      assert.equal(tokenRow.payload_criptografado.includes(issuedAccessToken), false);

      // Probe após OAuth retorna passed e descobre tool remota
      const probeAfter = await fetch(`${baseUrl}/api/mcps/servidores/mcp-oauth-remoto/testar`, {
        method: "POST",
      });
      const probeAfterJson = (await probeAfter.json()) as {
        status: string;
        toolNames: string[];
      };
      assert.equal(probeAfterJson.status, "passed");
      assert.ok(probeAfterJson.toolNames.includes("ping_remoto"));

      // Proxy loopback injeta Bearer sem vazar ao caller e traduz 401 -> -32001
      const routeInfo = runtime.mcpGateway.oauthProxy.getRouteInfo("mcp-oauth-remoto");
      assert.ok(routeInfo && routeInfo.proxyUrl.startsWith("http://127.0.0.1:"));

      const proxyCallOk = await fetch(routeInfo.proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [routeInfo.proxyHeaderName]: routeInfo.proxySecret,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ping_remoto", arguments: { msg: "ola" } },
        }),
      });
      assert.equal(proxyCallOk.status, 200);
      const proxyOkBody = (await proxyCallOk.json()) as {
        result: { content: Array<{ text: string }> };
      };
      assert.equal(proxyOkBody.result.content[0].text, "pong:ola");

      requireReauth = true;
      const proxyCall401 = await fetch(routeInfo.proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [routeInfo.proxyHeaderName]: routeInfo.proxySecret,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const proxy401Body = (await proxyCall401.json()) as { error?: { code: number } };
      assert.equal(proxy401Body.error?.code, -32001);
      requireReauth = false;

      // STDIO real + regra de exclusão de workingDirectory em toAcpMcpServers + redação de segredos
      const stdioServer = runtime.mcpGateway.store.saveServer({
        mcp_id: "mcp-stdio-eco",
        nome: "Eco STDIO",
        transporte: "stdio",
        comando: process.execPath,
        args: [stdioScriptPath],
        env: { SECRET_ENV_VAR: "valor-ultra-secreto-stdio" },
        ativo: true,
      });
      const stdioProbe = await inspectMcpServer(stdioServer);
      assert.equal(stdioProbe.status, "passed");
      assert.ok(stdioProbe.toolNames.includes("echo_local"));

      runtime.mcpGateway.store.saveServer({
        mcp_id: "mcp-stdio-workdir",
        nome: "STDIO Com Workdir",
        transporte: "stdio",
        comando: process.execPath,
        args: [stdioScriptPath],
        workingDirectory: tempDir,
        ativo: true,
      });

      const acpList = runtime.mcpGateway.getAcpMcpServers("estrategista");
      assert.ok(acpList.some((s) => s.url?.startsWith("http://127.0.0.1:")));
      assert.ok(acpList.some((s) => s.command === process.execPath));
      assert.equal(
        acpList.some((s) => s.name.includes("stdio_com_workdir")),
        false,
        "STDIO com workingDirectory não deve ser repassado ao ACP"
      );

      const redacted = redactMcpSecrets(
        "Falha usando token hdr-secret-abc e Bearer oauth-access-token-super-secreto-999",
        ["hdr-secret-abc", issuedAccessToken]
      );
      assert.equal(redacted.includes("hdr-secret-abc"), false);
      assert.equal(redacted.includes(issuedAccessToken), false);
      assert.ok(redacted.includes("[SEGREDO_REDIGIDO]"));
    } finally {
      await runtime.close();
      await new Promise<void>((r) => mockOAuthMcp.close(() => r()));
    }
  });

  it("4. Executa as 18 ferramentas de agente e opera Loja completa (instalação 1-clique, export/duplicação, batch de skills e anti-SSRF GitHub)", async () => {
    const tempDir = makeTempDir("criativo-p10-tools-");
    const dbPath = join(tempDir, "tools.db");
    const sock = new FakeBaileysSocket();

    const runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
      whatsappSocketFactory: async () => sock,
    });
    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    try {
      const deps = {
        db: runtime.db,
        vault: runtime.vault,
        wsHub: runtime.wsHub,
        mcpGateway: runtime.mcpGateway,
        catalogService: runtime.catalogService,
        skillsManager: runtime.skillsManager,
        whatsappManager: runtime.whatsappManager,
        whatsappOrchestrator: runtime.whatsappOrchestrator,
        workspaceRoot: tempDir,
        agenteId: "estrategista",
      };

      // Prepara imagem segura dentro do workspace para messaging_post
      const imgRel = "saidas/artes/demo-p10.png";
      mkdirSync(resolve(tempDir, "saidas", "artes"), { recursive: true });
      writeFileSync(resolve(tempDir, imgRel), Buffer.from("FAKE_PNG"));
      await runtime.whatsappManager.connectAccount(DEFAULT_WHATSAPP_ACCOUNT_ID);
      sock.emit("connection.update", { connection: "open" });

      // Autoriza o destinatário de teste na política de segurança antes do envio por tool
      await fetch(
        `${baseUrl}/api/mensageria/whatsapp/contas/${DEFAULT_WHATSAPP_ACCOUNT_ID}/contatos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "contato",
            identificador_jid: "5511977771111@s.whatsapp.net",
            nome_exibicao: "Destino Autorizado",
            permitido: true,
          }),
        }
      );

      // 5 Tools WhatsApp
      const places = (await executeStudioExtensionTool("messaging_list_places", {}, deps)) as {
        contas: unknown[];
      };
      assert.ok(places.contas.length >= 1);

      const postRes = (await executeStudioExtensionTool(
        "messaging_post",
        { chatJid: "5511977771111@s.whatsapp.net", text: "Prévia pronta", mediaPath: imgRel },
        deps
      )) as { ok: boolean };
      assert.equal(postRes.ok, true);

      const histTool = (await executeStudioExtensionTool(
        "messaging_history",
        { chatJid: "5511977771111@s.whatsapp.net" },
        deps
      )) as { mensagens: Array<{ texto: string }> };
      assert.ok(histTool.mensagens.length >= 1);

      const memCreated = (await executeStudioExtensionTool(
        "messaging_remember",
        { texto: "Cliente prefere aprovação após 18h", chatJid: "5511977771111@s.whatsapp.net" },
        deps
      )) as { memoria: { memoria_id: string } };
      assert.ok(memCreated.memoria.memoria_id);

      const memDeleted = (await executeStudioExtensionTool(
        "messaging_forget_memory",
        { memoriaId: memCreated.memoria.memoria_id },
        deps
      )) as { removed: boolean };
      assert.equal(memDeleted.removed, true);

      // 5 Tools MCP + suggest_marketplace_app
      await executeStudioExtensionTool(
        "save_mcp_server",
        {
          mcpId: "tool-mcp-1",
          nome: "Tool MCP",
          transporte: "http",
          url: "http://127.0.0.1:9999/mcp",
          headers: { Authorization: "Bearer secret-header-123" },
          ativo: true,
        },
        deps
      );

      const mcpList = (await executeStudioExtensionTool("list_mcp_servers", {}, deps)) as {
        servidores: Array<{ mcp_id: string; headers: Record<string, string> }>;
      };
      const listedJson = JSON.stringify(mcpList);
      assert.equal(listedJson.includes("secret-header-123"), false, "list_mcp_servers deve mascarar headers");

      const mcpTested = (await executeStudioExtensionTool("test_mcp_server", { mcpId: "tool-mcp-1" }, deps)) as {
        mcpId: string;
      };
      assert.equal(mcpTested.mcpId, "tool-mcp-1");

      const mcpToggled = (await executeStudioExtensionTool(
        "set_mcp_server_enabled",
        { mcpId: "tool-mcp-1", ativo: false },
        deps
      )) as { servidor: { ativo: boolean } };
      assert.equal(mcpToggled.servidor.ativo, false);

      const mcpRemoved = (await executeStudioExtensionTool(
        "remove_mcp_server",
        { mcpId: "tool-mcp-1" },
        deps
      )) as { removed: boolean };
      assert.equal(mcpRemoved.removed, true);

      const appSuggested = (await executeStudioExtensionTool(
        "suggest_marketplace_app",
        { slug: "canva" },
        deps
      )) as { type: string; app: { slug: string } | null };
      assert.equal(appSuggested.type, "marketplace_app_suggestion");
      assert.equal(appSuggested.app?.slug, "canva");

      // 7 Tools de Skills locais
      const createdSkill = (await executeStudioExtensionTool(
        "create_skill",
        {
          slug: "skill-teste-p10",
          name: "Skill Teste P10",
          description: "Guia prático de validação",
          instructions: "# Instruções\nPasso 1.",
          agentIds: ["estrategista"],
        },
        deps
      )) as { ok: boolean; skill: { skillId: string; slug: string } };
      assert.equal(createdSkill.skill.skillId, "personalizada:skill-teste-p10");
      assert.equal(createdSkill.skill.slug, "skill-teste-p10");

      await executeStudioExtensionTool(
        "revise_skill",
        { skillId: "skill-teste-p10", instructions: "# Instruções\nPasso 1 e Passo 2." },
        deps
      );
      const listedSkills = (await executeStudioExtensionTool("list_local_skills", {}, deps)) as {
        skills: Array<{ slug: string }>;
      };
      assert.ok(listedSkills.skills.some((s) => s.slug === "skill-teste-p10"));

      const readSkillRes = (await executeStudioExtensionTool(
        "read_local_skill",
        { slugOrId: "skill-teste-p10" },
        deps
      )) as { markdown: string };
      assert.ok(readSkillRes.markdown.includes("Passo 2."));

      await executeStudioExtensionTool("set_skill_enabled", { skillId: "skill-teste-p10", habilitada: false }, deps);
      await executeStudioExtensionTool("install_local_skill", { slug: "project-plan" }, deps).catch(() => undefined);
      const removedSkill = (await executeStudioExtensionTool(
        "uninstall_skill",
        { skillId: "skill-teste-p10" },
        deps
      )) as { ok: boolean };
      assert.equal(removedSkill.ok, true);

      // Loja: instalar pacote de agente em 1 clique + exportar + duplicar + batch skills
      const catSnap = await (await fetch(`${baseUrl}/api/loja/catalogo?tab=agents`)).json() as {
        agents: Array<{ slug: string }>;
      };
      const firstAgentSlug = catSnap.agents[0].slug;
      const installAgentRes = await fetch(
        `${baseUrl}/api/loja/agentes/${encodeURIComponent(firstAgentSlug)}/instalar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: { name: "Agente Loja Teste" } }),
        }
      );
      assert.equal(installAgentRes.status, 201);
      const installedAgent = (await installAgentRes.json()) as {
        agente: { agente_id: string; nome: string };
      };
      assert.equal(installedAgent.agente.nome, "Agente Loja Teste");

      const exportedRes = await fetch(
        `${baseUrl}/api/loja/agentes/${encodeURIComponent(installedAgent.agente.agente_id)}/exportar`
      );
      assert.equal(exportedRes.status, 200);

      const dupRes = await fetch(
        `${baseUrl}/api/loja/agentes/${encodeURIComponent(installedAgent.agente.agente_id)}/duplicar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: "Agente Loja Copia" }),
        }
      );
      assert.equal(dupRes.status, 201);

      const skillsRes = await (await fetch(`${baseUrl}/api/loja/habilidades`)).json() as {
        habilidades: Array<{ skillId: string }>;
      };
      const targetSkillId = skillsRes.habilidades[0].skillId;
      const batchRes = await fetch(
        `${baseUrl}/api/loja/habilidades/${encodeURIComponent(targetSkillId)}/agentes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentIds: ["estrategista", installedAgent.agente.agente_id] }),
        }
      );
      assert.equal(batchRes.status, 200);

      // Anti-SSRF GitHub via endpoint e via GithubImporter com fetch mockado local
      const ssrfRes = await fetch(
        `${baseUrl}/api/loja/github/inspecionar?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}`
      );
      assert.equal(ssrfRes.status >= 400, true);

      const mockedGhPreview = await runtime.githubImporter.inspectRepository(
        "https://github.com/exemplo-org/repo-skills",
        "skills",
        async (urlInput) => {
          const u = String(urlInput);
          assert.ok(u.startsWith("https://api.github.com/") || u.startsWith("https://raw.githubusercontent.com/"));
          if (u.includes("/git/trees/")) {
            return new Response(
              JSON.stringify({
                sha: "abc1234",
                tree: [{ path: "skills/teste-gh/SKILL.md", type: "blob", size: 120 }],
              }),
              { status: 200 }
            );
          }
          if (u.includes("/repos/")) {
            return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
          }
          return new Response(
            `---\nname: "Teste GH"\ndescription: "Skill vinda de GitHub"\n---\n\nCorpo seguro.`,
            { status: 200 }
          );
        }
      );
      assert.equal(mockedGhPreview.unreviewedExternalSource, true);
      assert.equal(mockedGhPreview.items.length, 1);
      assert.equal(mockedGhPreview.items[0].slug, "teste-gh");
    } finally {
      await runtime.close();
      // Garante remoção mesmo que chmod tenha restringido algo
      try {
        chmodSync(tempDir, 0o700);
      } catch {
        // Ignora
      }
    }
  });
});
