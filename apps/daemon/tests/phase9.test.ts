import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedDefaultAgents } from "../src/engine/runner/roster-defaults.ts";
import { ProviderConnectionService } from "../src/providers/provider-connection-service.ts";
import { createDaemonServer, resolveDefaultWorkspaceRoot, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { hasExplicitVisualGenerationIntent, isGreetingOrCapabilityQuestion } from "../src/server/studio-routes.ts";
import { buildStudioLiveContext, validateMetaIntegration } from "../src/server/studio-tools-bridge.ts";

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

  it("unifica chaves Meta no Cofre e valida via Graph API v27.0 sem expor segredos", async () => {
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

  it("instala e remove skills nas plataformas Antigravity, Claude Code e Codex e protege dados na atualização", async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const platMod = await import(pathToFileURL(join(repoRoot, "scripts", "lib", "plataformas.mjs")).href);
    const skillsMod = await import(pathToFileURL(join(repoRoot, "scripts", "instalar-skills.mjs")).href);
    const updMod = await import(pathToFileURL(join(repoRoot, "scripts", "atualizar.mjs")).href);

    const fakeHome = mkdtempSync(join(tmpdir(), "criativo-home-plat-"));
    try {
      // Pré-cria uma skill de outro produto no Claude para validar preservação
      const skillTerceiro = join(fakeHome, ".claude", "skills", "outra-skill-cliente");
      mkdirSync(skillTerceiro, { recursive: true });
      writeFileSync(join(skillTerceiro, "SKILL.md"), "# Outra Skill\n", "utf8");

      const plataformas = platMod.interpretarPlataformas("todas", fakeHome);
      assert.deepEqual(plataformas, ["claude", "codex", "antigravity"]);

      const installRes = await skillsMod.instalarSkills({
        diretorioRaiz: repoRoot,
        plataformas,
        home: fakeHome,
      });
      assert.equal(installRes.total, 9);
      assert.ok(existsSync(join(fakeHome, ".claude", "skills", "planejar-conteudo", "SKILL.md")));
      assert.ok(existsSync(join(fakeHome, ".codex", "skills", "copywriter-instagram", "SKILL.md")));
      assert.ok(existsSync(join(fakeHome, ".gemini", "config", "skills", "configurar-instagram", ".instalado-por.json")));

      // Remoção limpa apenas skills marcadas por este produto
      await skillsMod.removerSkills({
        diretorioRaiz: repoRoot,
        plataformas,
        home: fakeHome,
      });
      assert.ok(!existsSync(join(fakeHome, ".claude", "skills", "planejar-conteudo")));
      assert.ok(existsSync(join(skillTerceiro, "SKILL.md")), "Skill de terceiro não pode ser apagada");

      // Regras do atualizador preservam dados de instância e upgrades
      assert.equal(updMod.pertenceAoProduto("AGENTS.md"), true);
      assert.equal(updMod.pertenceAoProduto(".agents/skills/planejar-conteudo/SKILL.md"), true);
      assert.equal(updMod.pertenceAoProduto(".env"), false);
      assert.equal(updMod.pertenceAoProduto("apps/daemon/dados/criativo.db"), false);
      assert.equal(updMod.pertenceAoProduto("conteudos/perfil-da-marca.md"), false);
      assert.equal(updMod.pertenceAoProduto("saidas/carrosseis/slide-1.png"), false);
      assert.equal(updMod.pertenceAoProduto(".agents/skills/criar-video-reels/SKILL.md"), false);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("bloqueia handoff/imagem involuntários em saudações, resolve raiz correta e serve referências no Cockpit", async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    // Mesmo simulando cwd em apps/daemon, resolveDefaultWorkspaceRoot encontra a raiz do monorepo
    assert.equal(resolveDefaultWorkspaceRoot(join(repoRoot, "apps", "daemon")), repoRoot);

    assert.equal(isGreetingOrCapabilityQuestion("oi"), true);
    assert.equal(isGreetingOrCapabilityQuestion("o que voce pode fazer?"), true);
    assert.equal(isGreetingOrCapabilityQuestion("vc tem acesso a pasta de referencias?"), true);
    assert.equal(hasExplicitVisualGenerationIntent("oi", "designer_carrossel", false), false);
    assert.equal(hasExplicitVisualGenerationIntent("o que voce pode fazer?", "designer_carrossel", false), false);
    assert.equal(hasExplicitVisualGenerationIntent("Crie uma arte de carrossel sobre gestão", "designer_carrossel", false), true);
    assert.equal(hasExplicitVisualGenerationIntent("oi", "estrategista", false), false);

    // Saudação e pergunta de capacidade via API não criam tarefa nem handoff
    const greetRes = await fetch(`${baseUrl}/api/agentes/estrategista/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo: "oi" }),
    });
    assert.equal(greetRes.status, 201);
    const greetJson = (await greetRes.json()) as {
      mensagem_agente: { tarefa_id: string | null; anexos: unknown[] };
      mensagens_handoff?: unknown[];
    };
    assert.equal(greetJson.mensagem_agente.tarefa_id, null);
    assert.equal(greetJson.mensagem_agente.anexos.length, 0);
    assert.equal(greetJson.mensagens_handoff?.length ?? 0, 0);

    // Mesmo perguntando ao designer_carrossel "o que voce pode fazer?", não dispara produção nem imagem
    const capRes = await fetch(`${baseUrl}/api/agentes/designer_carrossel/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo: "o que voce pode fazer?" }),
    });
    assert.equal(capRes.status, 201);
    const capJson = (await capRes.json()) as {
      mensagem_agente: { tarefa_id: string | null; anexos: unknown[] };
    };
    assert.equal(capJson.mensagem_agente.tarefa_id, null);
    assert.equal(capJson.mensagem_agente.anexos.length, 0);

    // Arquivos colocados em recursos/referencias/, recursos/logos/ e brandbook são indexados, servidos e injetados no aprendizado
    const refDir = join(tempDir, "recursos", "referencias");
    const brandDir = join(tempDir, "recursos", "brand");
    const contDir = join(tempDir, "conteudos");
    mkdirSync(refDir, { recursive: true });
    mkdirSync(brandDir, { recursive: true });
    mkdirSync(contDir, { recursive: true });

    writeFileSync(join(refDir, "ref-editorial.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]));
    writeFileSync(join(brandDir, "brandbook.md"), "# Brandbook Teste\nDireção editorial de alto contraste com serifas finas.\n".repeat(4));
    writeFileSync(join(contDir, "identidade-visual.yml"), "tema:\n  cor_fundo: \"#07080C\"\n  cor_destaque: \"#FF6B00\"\n  estilo: \"Editorial Luxo\"\n".repeat(4));

    const prevProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    try {
      const listRes = await fetch(`${baseUrl}/api/arquivos`);
      assert.equal(listRes.status, 200);
      const listJson = (await listRes.json()) as {
        arquivos: Array<{ nome_original: string; caminho_relativo: string; url: string; tipo_uso: string }>;
      };
      const foundRef = listJson.arquivos.find((a) => a.caminho_relativo === "recursos/referencias/ref-editorial.png");
      assert.ok(foundRef, "Referência salva na pasta recursos/referencias/ deve aparecer no Cockpit");
      assert.equal(foundRef.tipo_uso, "referencia");

      const rawRes = await fetch(`${baseUrl}${foundRef.url}`);
      assert.equal(rawRes.status, 200, "Rota /api/arquivos/raw deve servir recursos/referencias/ sem erro 403");

      const provConn = new ProviderConnectionService({
        db: runtime.db,
        vault: runtime.vault,
        workspaceRoot: tempDir,
      });
      const liveCtx = buildStudioLiveContext({
        db: runtime.db,
        vault: runtime.vault,
        providerConnection: provConn,
        workspaceRoot: tempDir,
      });
      provConn.close();
      assert.ok(liveCtx.includes("ref-editorial.png"), "Contexto vivo deve listar referências reais");
      assert.ok(liveCtx.includes("Brandbook Teste"), "Contexto vivo deve ensinar brandbook.md aos agentes");
      assert.ok(liveCtx.includes("Editorial Luxo"), "Contexto vivo deve ensinar identidade-visual.yml aos agentes");
    } finally {
      if (prevProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevProbe;
    }
  });
});
