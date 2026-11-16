import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SCHEMA_TABLE_NAMES } from "../src/database/schema.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

describe("Fase 7 — Paridade OpenBot Backend (Onboarding, Provedores, Chat, Canais, Workflows & Uploads)", () => {
  let tempDir: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  const previousProbeFlag = process.env.CRIATIVO_SKIP_LOCAL_PROBE;

  before(async () => {
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase7-"));
    runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "phase7.db"),
      workspaceRoot: tempDir,
      vaultMasterKey: "chave-mestra-fase-7-teste",
      autoStartLoops: false,
      controlSocketPath: null,
    });
    baseUrl = `http://127.0.0.1:${runtime.port}`;
  });

  after(async () => {
    if (previousProbeFlag === undefined) {
      delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    } else {
      process.env.CRIATIVO_SKIP_LOCAL_PROBE = previousProbeFlag;
    }
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("inicializa todas as 16 tabelas e enriquece os 15 agentes padrão com avatar_shape, avatar_color e effort", async () => {
    const tables = runtime.db.listTables();
    for (const t of SCHEMA_TABLE_NAMES) {
      assert.ok(tables.includes(t), `Tabela esperada ausente: ${t}`);
    }

    const res = await fetch(`${baseUrl}/api/agentes`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      agentes: Array<{
        agente_id: string;
        config: { avatar_shape?: string; avatar_color?: string; effort?: string };
      }>;
    };
    assert.equal(json.agentes.length, 15);
    assert.ok(json.agentes[0].config.avatar_shape);
    assert.ok(json.agentes[0].config.avatar_color);
    assert.ok(json.agentes[0].config.effort);
  });

  it("persiste onboarding em 2 etapas e conecta/desconecta provedores + uso", async () => {
    const getInit = await fetch(`${baseUrl}/api/onboarding`);
    assert.equal(getInit.status, 200);
    const initJson = (await getInit.json()) as {
      onboarding: { onboarding_concluido: boolean; marca_nome: string };
    };
    assert.equal(initJson.onboarding.onboarding_concluido, false);
    assert.equal(initJson.onboarding.marca_nome, "[NOME_DA_MARCA]");

    const putRes = await fetch(`${baseUrl}/api/onboarding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        onboarding_concluido: true,
        modo_provedor_inicial: "assinatura",
        provedor_selecionado: "gemini",
        telemetria_anonima: false,
      }),
    });
    assert.equal(putRes.status, 200);
    const putJson = (await putRes.json()) as {
      onboarding: { onboarding_concluido: boolean; provedor_selecionado: string };
    };
    assert.equal(putJson.onboarding.onboarding_concluido, true);
    assert.equal(putJson.onboarding.provedor_selecionado, "gemini");

    const connRes = await fetch(`${baseUrl}/api/provedores/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor: "grok", api_key: "xai-teste-1234" }),
    });
    assert.equal(connRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/provedores/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      provedores: Array<{ provedor: string; conectado: boolean; vault_configurado: boolean }>;
    };
    const grok = statusJson.provedores.find((p) => p.provedor === "grok");
    assert.ok(grok?.conectado);
    assert.ok(grok?.vault_configurado);

    const usoRes = await fetch(`${baseUrl}/api/provedores/uso`);
    assert.equal(usoRes.status, 200);
    const usoJson = (await usoRes.json()) as {
      uso: { provedores: Array<{ provedor: string; janelas: unknown[] }> };
    };
    assert.ok(usoJson.uso.provedores.length >= 3);

    const discRes = await fetch(`${baseUrl}/api/provedores/desconectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor: "grok" }),
    });
    assert.equal(discRes.status, 200);
  });

  it("cria agente customizado, envia mensagem no chat (enfileirando produção) e coordena canal em equipe", async () => {
    const createAgentRes = await fetch(`${baseUrl}/api/agentes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Diretor de Ofertas Sazonais",
        prompt_base: "Monte campanhas para [NOME_DA_MARCA] sem usar nomes reais.",
        modelo_padrao: "grok-4.6",
        avatar_shape: "blob",
        avatar_color: "#f27ba5",
        effort: "alto",
      }),
    });
    assert.equal(createAgentRes.status, 201);
    const createdAgentJson = (await createAgentRes.json()) as {
      agente: { agente_id: string; modelo_padrao: string; config: { effort: string } };
    };
    const agId = createdAgentJson.agente.agente_id;
    assert.equal(createdAgentJson.agente.modelo_padrao, "grok-4.6");
    assert.equal(createdAgentJson.agente.config.effort, "alto");

    const chatRes = await fetch(`${baseUrl}/api/agentes/${encodeURIComponent(agId)}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conteudo: "Criar carrossel de 5 slides sobre produtividade para [@SEU_PERFIL]",
      }),
    });
    assert.equal(chatRes.status, 201);
    const chatJson = (await chatRes.json()) as {
      mensagem_agente: { conteudo_markdown: string; tarefa_id: string | null };
    };
    assert.match(chatJson.mensagem_agente.conteudo_markdown, /Etapa do Plano/);
    assert.ok(chatJson.mensagem_agente.tarefa_id);

    const createCanalRes = await fetch(`${baseUrl}/api/canais`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "lancamento-q4",
        descricao: "Alinhamento de equipe criativa",
        membros_agentes: ["estrategista", "copywriter"],
      }),
    });
    assert.equal(createCanalRes.status, 201);
    const canalJson = (await createCanalRes.json()) as { canal: { canal_id: string; nome: string } };
    assert.equal(canalJson.canal.nome, "#lancamento-q4");

    const postCanalMsg = await fetch(
      `${baseUrl}/api/canais/${encodeURIComponent(canalJson.canal.canal_id)}/mensagens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: "Definir pauta semanal e ganchos iniciais" }),
      }
    );
    assert.equal(postCanalMsg.status, 201);
    const canalMsgJson = (await postCanalMsg.json()) as { mensagens_equipe: unknown[] };
    assert.equal(canalMsgJson.mensagens_equipe.length, 2);
  });

  it("cria, atualiza e executa workflows visuais e faz upload/leitura segura de ImagePaths bloqueando path traversal", async () => {
    const wfRes = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Pipeline Carrossel Automático",
        nos: [
          { id: "n1", tipo: "gatilho", titulo: "Gatilho Manual", x: 120, y: 120, config: {} },
          {
            id: "n2",
            tipo: "agente",
            titulo: "Copywriter",
            x: 380,
            y: 120,
            config: { agente_id: "copywriter" },
          },
        ],
        arestas: [{ id: "e1", origem: "n1", destino: "n2" }],
      }),
    });
    assert.equal(wfRes.status, 201);
    const wfJson = (await wfRes.json()) as { workflow: { workflow_id: string } };

    const execRes = await fetch(`${baseUrl}/api/workflows/${wfJson.workflow.workflow_id}/executar`, {
      method: "POST",
    });
    assert.equal(execRes.status, 200);
    const execJson = (await execRes.json()) as { ok: boolean; tarefas_criadas: string[] };
    assert.equal(execJson.ok, true);
    assert.equal(execJson.tarefas_criadas.length, 1);

    // Upload de imagem PNG simulada
    const sampleBase64 = Buffer.from("PNG-SIMULADO-REFERENCIA").toString("base64");
    const upRes = await fetch(`${baseUrl}/api/arquivos/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "rosto-referencia.png",
        mime_type: "image/png",
        tipo_uso: "referencia",
        conteudo_base64: sampleBase64,
      }),
    });
    assert.equal(upRes.status, 201);
    const upJson = (await upRes.json()) as {
      arquivo: { caminho_relativo: string; url: string };
    };

    const rawRes = await fetch(`${baseUrl}${upJson.arquivo.url}`);
    assert.equal(rawRes.status, 200);
    assert.equal(await rawRes.text(), "PNG-SIMULADO-REFERENCIA");

    // Proteção contra path traversal
    const evilRes = await fetch(`${baseUrl}/api/arquivos/raw?path=../../package.json`);
    assert.equal(evilRes.status, 403);
  });
});
