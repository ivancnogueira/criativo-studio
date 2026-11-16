import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { seedDefaultAgents } from "../src/engine/runner/roster-defaults.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { validateMetaIntegration } from "../src/server/studio-tools-bridge.ts";

describe("Fase 9 — Empacotamento Base/Upgrades, Cofre Meta, Backfill de Agentes, Ferramentas & Inter-Agentes", () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase9-"));
    dbPath = join(tempDir, "criativo-phase9.db");
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

  it("faz backfill de prompt_base e ferramentas em agentes pré-existentes vazios e restaura padrão via API", async () => {
    // Simula banco legado com prompt_base vazio no estrategista e ausente no copywriter
    runtime.db.connection
      .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = 'estrategista';`)
      .run(JSON.stringify({ avatar_shape: "hex", avatar_color: "#31cf76", prompt_base: "" }));
    runtime.db.connection
      .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = 'copywriter';`)
      .run(JSON.stringify({ avatar_shape: "blob", avatar_color: "#38bdf8" }));

    seedDefaultAgents(runtime.db);

    const res = await fetch(`${baseUrl}/api/agentes`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      agentes: Array<{
        agente_id: string;
        config: { prompt_base?: string; ferramentas?: string[]; pacote?: string };
      }>;
    };
    const estr = body.agentes.find((a) => a.agente_id === "estrategista");
    const copy = body.agentes.find((a) => a.agente_id === "copywriter");
    assert.ok(estr?.config.prompt_base && estr.config.prompt_base.length > 20);
    assert.ok(copy?.config.prompt_base && copy.config.prompt_base.length > 20);
    assert.ok(Array.isArray(copy?.config.ferramentas) && copy.config.ferramentas.length > 0);

    // Edita e restaura padrão
    await fetch(`${baseUrl}/api/agentes/copywriter`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_base: "Prompt customizado temporário" }),
    });
    const restoreRes = await fetch(`${baseUrl}/api/agentes/copywriter/restaurar`, { method: "POST" });
    assert.equal(restoreRes.status, 200);
    const restoredJson = (await restoreRes.json()) as {
      agente: { config: { prompt_base: string } };
    };
    assert.ok(restoredJson.agente.config.prompt_base.includes("Copywriter"));
  });

  it("unifica chaves Meta no Cofre e valida via Graph API v21.0 sem expor segredos", async () => {
    const segredoToken = "TOKEN_SECRETO_TESTE_NAO_EXPOR";
    const configRes = await fetch(`${baseUrl}/api/conectores/instagram/configurar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segredos: {
          instagram_access_token: segredoToken,
          instagram_business_account_id: "17841400000000001",
        },
      }),
    });
    assert.equal(configRes.status, 200);

    // Confirma aliases salvos no Cofre
    assert.equal(runtime.vault.getSecret("META_ACCESS_TOKEN"), segredoToken);
    assert.equal(runtime.vault.getSecret("META_IG_USER_ID"), "17841400000000001");

    // Executa validação direta com fetch simulado
    const report = await validateMetaIntegration(runtime.vault, async () => {
      return new Response(
        JSON.stringify({
          id: "17841400000000001",
          username: "perfil_validado_teste",
          followers_count: 4200,
          media_count: 112,
        }),
        { status: 200 }
      );
    });

    assert.equal(report.ok, true);
    assert.equal(report.estagio, 5);
    assert.equal(report.detalhes.username, "perfil_validado_teste");
    assert.ok(!JSON.stringify(report).includes(segredoToken), "Token nunca pode aparecer no diagnóstico");
  });

  it("executa conversa encadeada entre 3+ membros em Canal em Equipe e Handoff 1:1 com @menção", async () => {
    const channelRes = await fetch(`${baseUrl}/api/canais/${encodeURIComponent("canal-campanha-semanal")}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo: "Planejem a pauta, a copy e o carrossel de abertura." }),
    });
    assert.equal(channelRes.status, 201);
    const channelJson = (await channelRes.json()) as {
      mensagens_equipe: Array<{ agente_id: string; steps: Array<{ ferramenta: string }> }>;
    };
    // Antes o código cortava em Math.min(2, membros.length); agora os 4 membros do canal colaboram
    assert.equal(channelJson.mensagens_equipe.length, 4);
    assert.ok(
      channelJson.mensagens_equipe[1].steps.some((s) => s.ferramenta === "handoff_agente"),
      "Segundo agente do canal deve registrar passo de recebimento de contexto do colega"
    );

    const handoffRows = runtime.db.connection
      .prepare(`SELECT * FROM projecao_canal_mensagens WHERE tipo_mensagem = 'handoff';`)
      .all();
    assert.ok(handoffRows.length >= 3, "HandoffBus deve registrar passagens entre colegas");

    // Handoff 1:1 com @copywriter dentro do chat do Estrategista
    const oneToOneRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo: "Defina a tese e passe para o @copywriter escrever 5 títulos." }),
    });
    assert.equal(oneToOneRes.status, 201);
    const oneToOneJson = (await oneToOneRes.json()) as {
      mensagem_agente: { agente_id: string };
      mensagens_handoff?: Array<{ agente_id: string }>;
    };
    assert.equal(oneToOneJson.mensagem_agente.agente_id, "estrategista");
    assert.ok(
      oneToOneJson.mensagens_handoff?.some((m) => m.agente_id === "copywriter"),
      "Menção @copywriter deve acionar resposta real do agente colaborador no mesmo chat"
    );
  });

  it("gerencia upgrades modulares em etapas e salva identidade da marca", async () => {
    const upInitRes = await fetch(`${baseUrl}/api/upgrades`);
    assert.equal(upInitRes.status, 200);
    const upInit = (await upInitRes.json()) as {
      upgrades: Array<{ id: string; instalado: boolean }>;
    };
    assert.equal(upInit.upgrades.find((u) => u.id === "bonus")?.instalado, false);
    assert.equal(upInit.upgrades.find((u) => u.id === "video")?.instalado, false);

    // Ativa apenas o upgrade bônus em etapa posterior
    const actRes = await fetch(`${baseUrl}/api/upgrades/instalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pacote: "bonus" }),
    });
    assert.equal(actRes.status, 200);
    const actJson = (await actRes.json()) as {
      upgrades: Array<{ id: string; instalado: boolean }>;
    };
    assert.equal(actJson.upgrades.find((u) => u.id === "bonus")?.instalado, true);
    assert.equal(actJson.upgrades.find((u) => u.id === "video")?.instalado, false);

    // Atualiza identidade da marca e verifica reflexão no onboarding
    const brandRes = await fetch(`${baseUrl}/api/marca/identidade`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marca_nome: "Estúdio Exemplo Agnóstico",
        perfil_handle: "@estudio_exemplo",
        nicho: "Educação Digital",
      }),
    });
    assert.equal(brandRes.status, 200);
    const brandJson = (await brandRes.json()) as {
      identidade: { marca_nome: string; marcos: { perfil: string } };
      onboarding: { marca_nome: string; perfil_handle: string };
    };
    assert.equal(brandJson.identidade.marca_nome, "Estúdio Exemplo Agnóstico");
    assert.equal(brandJson.identidade.marcos.perfil, "concluido");
    assert.equal(brandJson.onboarding.perfil_handle, "@estudio_exemplo");
  });
});
