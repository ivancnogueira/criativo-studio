import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { metaPublishTool } from "../../apps/daemon/dist/engine/tools/meta-publish.js";
import { createDaemonServer } from "../../apps/daemon/dist/server/daemon-server.js";

class MockBaileysSocket extends EventEmitter {
  constructor() {
    super();
    this.user = { id: "5500999990000:1@s.whatsapp.net", name: "[NOME_DA_MARCA] Estúdio" };
    this.sentMessages = [];
    this.ended = false;
    this.ev = {
      on: (event, listener) => {
        this.on(event, listener);
      },
    };
  }

  async sendMessage(jid, content) {
    this.sentMessages.push({ jid, content });
    return { key: { id: `wa-msg-${this.sentMessages.length}` } };
  }

  end() {
    this.ended = true;
  }
}

async function waitForCondition(predicate, timeoutMs = 6000, label = "condição E2E") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timeout (${timeoutMs}ms) aguardando: ${label}`);
}

function requestControlSocket(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(body) });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("E2E — Ciclo Completo de Produção (WhatsApp -> IA Multimodal -> Remotion -> Aprovação -> Meta)", () => {
  const originalFetch = globalThis.fetch;
  let tempDir;
  let refImagePath;
  let slideOutputPath;
  let videoOutputPath;
  let socketPath;
  let mockSocket;
  let daemon;
  let wsClient;
  const receivedWsEvents = [];
  const externalFetchCalls = [];

  // PNG mínimo 1x1 válido em base64 para simular fotografia real de referência e arte gerada
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-e2e-ciclo-"));
    refImagePath = join(tempDir, "foto-referencia-usuario.png");
    slideOutputPath = join(tempDir, "carrossel-slide-01.png");
    videoOutputPath = join(tempDir, "reels-motion-final.mp4");
    writeFileSync(refImagePath, Buffer.from(tinyPngBase64, "base64"));

    socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\criativo-e2e-ciclo-${process.pid}-${Date.now()}`
        : join(tempDir, "control.sock");

    mockSocket = new MockBaileysSocket();

    // Intercepta chamadas HTTP externas (Gemini Transcrição/Imagem e Meta Graph API) sem custos reais
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
        return originalFetch(input, init);
      }

      const rawBody = typeof init.body === "string" ? init.body : "";
      externalFetchCalls.push({ url, body: rawBody });

      // 1. Gemini Transcrição ou Imagem Multimodal
      if (url.includes("generativelanguage.googleapis.com")) {
        if (url.includes("gemini-2.5-flash:generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: "Crie um carrossel premium sobre rotina produtiva para o perfil [@SEU_PERFIL]",
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        // Geração multimodal de imagem
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: tinyPngBase64,
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 2. Meta Graph API (Criação de Container & Publicação)
      if (url.includes("graph.facebook.com")) {
        if (url.endsWith("/media")) {
          return new Response(JSON.stringify({ id: "container_e2e_9001" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/media_publish")) {
          return new Response(JSON.stringify({ id: "IG_MEDIA_E2E_7788" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      throw new Error(`Chamada HTTP inesperada no teste E2E: ${url}`);
    };

    daemon = await createDaemonServer({
      dbPath: join(tempDir, "e2e-ciclo.db"),
      vaultMasterKey: "chave-mestra-e2e-segura-001",
      port: 0,
      workerPollMs: 30,
      controlSocketPath: socketPath,
      whatsappSocketFactory: async () => mockSocket,
      customTools: {
        exec_remotion_render: async (args) => {
          const outPath = typeof args.output_path === "string" ? args.output_path : videoOutputPath;
          writeFileSync(outPath, Buffer.from("SIMULATED_MP4_STREAM_E2E"));
          return {
            rendered: true,
            output_path: outPath,
            composition: args.composition ?? "ReelsMotion",
            duration_sec: args.duration_sec ?? 15,
          };
        },
      },
      onApproveAndPublishHook: async (tarefa) => {
        const res = await metaPublishTool(
          {
            media_type: "IMAGE",
            media_urls: ["https://cdn.exemplo.invalid/carrossel-slide-01.png"],
            caption: String(tarefa.resultado?.copy ?? "Legenda aprovada via WhatsApp"),
            approved_by_human: true,
          },
          { vault: daemon.vault }
        );
        return { permalink: res.permalink };
      },
    });

    // Configura credenciais fictícias no Cofre Criptografado AES-256-GCM
    daemon.vault.setSecret("GEMINI_API_KEY", "gem-e2e-fake-key-00001");
    daemon.vault.setSecret("META_ACCESS_TOKEN", "meta-e2e-fake-token-00001");
    daemon.vault.setSecret("META_IG_USER_ID", "17841400000000001");

    // Registra provedor IA determinístico simulando a cadeia Estrategista -> Copywriter -> Imagem -> Remotion
    let aiTurnCounter = 0;
    daemon.providers.registerCustomProvider("gemini", {
      name: "gemini",
      async streamTurn(_req, onEvent) {
        aiTurnCounter += 1;
        onEvent({ type: "thought", tokenChunk: `Analisando turno ${aiTurnCounter}...` });

        if (aiTurnCounter === 1) {
          return {
            text: "Alinhando briefing estratégico e copy com o time antes da geração visual.",
            toolCalls: [
              {
                id: "tc-handoff-1",
                name: "handoff_agente",
                arguments: {
                  para_agente_id: "copywriter",
                  instrucao: "Validar gancho de alta retenção para o carrossel da marca [NOME_DA_MARCA].",
                },
              },
              {
                id: "tc-gen-img-1",
                name: "generate_image",
                arguments: {
                  aspect_ratio: "3:4",
                  prompt: "Slide 1 editorial escuro premium para [NOME_DA_MARCA] sem marcas d'água",
                  image_paths: [refImagePath],
                  facial_consistency: true,
                  output_path: slideOutputPath,
                  engine: "gemini",
                },
              },
              {
                id: "tc-remotion-1",
                name: "exec_remotion_render",
                arguments: {
                  composition: "ReelsCarrosselMotion",
                  output_path: videoOutputPath,
                  duration_sec: 12,
                },
              },
            ],
            finishReason: "tool_calls",
          };
        }

        return {
          text: "Carrossel e Reels Motion prontos para [@SEU_PERFIL]! Gancho: Como estruturar sua rotina criativa em 3 blocos.",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    });

    // Conecta WhatsApp mockado em estado aberto e inicia listener WebSocket em tempo real
    await daemon.whatsapp.connect();
    mockSocket.emit("connection.update", { connection: "open" });

    wsClient = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
    await new Promise((resolve, reject) => {
      wsClient.addEventListener("open", () => resolve());
      wsClient.addEventListener("error", (err) => reject(err));
    });
    wsClient.addEventListener("message", (evt) => {
      receivedWsEvents.push(JSON.parse(String(evt.data)));
    });
  });

  after(async () => {
    try {
      wsClient?.close();
    } catch {
      // ignora erro ao encerrar socket ws no cleanup
    }
    await daemon?.close();
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("bloqueia publicação direta na Meta API quando approved_by_human !== true", async () => {
    await assert.rejects(
      () =>
        metaPublishTool(
          {
            media_type: "IMAGE",
            media_urls: ["https://cdn.exemplo.invalid/bloqueado.png"],
            caption: "Tentativa sem aprovação humana",
            approved_by_human: false,
          },
          { vault: daemon.vault }
        ),
      /BLOQUEIO DE SEGURANÇA/
    );
  });

  it("executa esteira completa WhatsApp Áudio -> Multi-Agente -> Imagem Multimodal -> Remotion -> Aprovação -> Meta Publish", async () => {
    const remetenteJid = "5500988887777@s.whatsapp.net";

    // 1. Usuário envia comando de áudio no WhatsApp
    mockSocket.emit("messages.upsert", {
      messages: [
        {
          key: { id: "wa-audio-001", remoteJid: remetenteJid, fromMe: false },
          pushName: "[NOME_DO_USUARIO]",
          message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
          audioBuffer: Buffer.from("AUDIO_OGG_SIMULADO_E2E"),
        },
      ],
    });

    // 2. Aguarda produção entrar em aguardando_aprovacao e enviar prévias no WhatsApp
    await waitForCondition(
      () =>
        receivedWsEvents.some((e) => e.event === "task:awaiting_approval") &&
        mockSocket.sentMessages.some((m) =>
          typeof m.content.text === "string" && m.content.text.includes("1 - Aprovar e Publicar Agora")
        ),
      8000,
      "entrega de prévias para aprovação no WhatsApp"
    );

    // Valida artefatos físicos gerados (PNG multimodal + MP4 Remotion)
    assert.equal(existsSync(slideOutputPath), true);
    assert.equal(existsSync(videoOutputPath), true);
    assert.deepEqual(readFileSync(slideOutputPath), Buffer.from(tinyPngBase64, "base64"));

    // Valida que generate_image enviou inlineData (foto referência) + cláusulas biométricas e anti-cópia
    const imageApiCall = externalFetchCalls.find((c) =>
      c.url.includes("gemini-2.5-flash-image-preview:generateContent")
    );
    assert.ok(imageApiCall, "Chamada Gemini generate_image deve ter ocorrido");
    assert.match(imageApiCall.body, /SUBJECT \/ FACIAL CONSISTENCY/);
    assert.match(imageApiCall.body, /REGRA ANTI-CÓPIA/);

    // Valida handoff entre agentes persistido no SQLite
    const handoffRows = daemon.db.connection
      .prepare(`SELECT * FROM projecao_canal_mensagens WHERE tipo_mensagem = 'handoff';`)
      .all();
    assert.ok(handoffRows.length >= 1, "Deve registrar handoff entre agentes");

    // Valida Control Socket ativo durante a produção
    const statusSocket = await requestControlSocket(socketPath, "/status");
    assert.equal(statusSocket.statusCode, 200);
    assert.equal(statusSocket.body.status, "ok");

    const queueSocket = await requestControlSocket(socketPath, "/queue");
    assert.equal(queueSocket.statusCode, 200);
    assert.equal(queueSocket.body.total, 1);
    const tarefaId = queueSocket.body.tarefas[0].tarefa_id;
    assert.equal(queueSocket.body.tarefas[0].status, "aguardando_aprovacao");

    // 3. Usuário responde "1" no WhatsApp aprovando a publicação
    mockSocket.emit("messages.upsert", {
      messages: [
        {
          key: { id: "wa-reply-002", remoteJid: remetenteJid, fromMe: false },
          pushName: "[NOME_DO_USUARIO]",
          message: { conversation: "1" },
        },
      ],
    });

    // 4. Aguarda publicação Meta e conclusão oficial no WebSocket + WhatsApp
    await waitForCondition(
      () =>
        receivedWsEvents.some((e) => e.event === "task:completed") &&
        mockSocket.sentMessages.some((m) =>
          typeof m.content.text === "string" && m.content.text.includes("https://www.instagram.com/p/IG_MEDIA_E2E_7788/")
        ),
      6000,
      "conclusão e permalink da Meta Graph API"
    );

    const finalTask = daemon.queue.getTask(tarefaId);
    assert.equal(finalTask?.status, "concluido");
    assert.equal(finalTask?.resultado?.aprovado, true);
    assert.equal(
      finalTask?.resultado?.permalink,
      "https://www.instagram.com/p/IG_MEDIA_E2E_7788/"
    );

    // Confirma sequência completa de eventos recebidos em tempo real pelo Cockpit WebSocket
    const eventNames = receivedWsEvents.map((e) => e.event);
    assert.ok(eventNames.includes("task:queued"));
    assert.ok(eventNames.includes("task:started"));
    assert.ok(eventNames.includes("agent:step"));
    assert.ok(eventNames.includes("task:awaiting_approval"));
    assert.ok(eventNames.includes("task:completed"));
  });
});
