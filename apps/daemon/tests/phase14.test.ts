import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AIProviderClient } from "@criativo/contracts";
import {
  AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
  normalizeMemorySite,
} from "../src/engine/runner/memory-manager.ts";
import { MemoryReviewService } from "../src/engine/runner/memory-review-service.ts";
import { revisionKeepsSkill, writerCanRevise } from "../src/engine/runner/skill-learning-service.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import {
  executePhase14ToolCall,
  type Phase14ToolContext,
  type Phase14ToolServices,
} from "../src/server/studio-tools-bridge.ts";

describe("Fase 14 — Aprendizado Autônomo, Shared Tables SQL, Generative UI, Biblioteca 4 Níveis & send_message", () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: DaemonRuntime;
  let baseUrl: string;
  let prevSkipProbe: string | undefined;
  let nextSyntheticModelText = "";

  const makeServices = (): Phase14ToolServices => ({
    db: runtime.db,
    wsHub: runtime.wsHub,
    sharedTables: runtime.sharedTables,
    memoryManager: runtime.memoryManager,
    memoryReview: runtime.memoryReview,
    skillLearning: runtime.skillLearning,
    historySearch: runtime.historySearch,
    libraryFolders: runtime.libraryFolders,
    handoffBus: runtime.handoffBus,
    visualPreview: runtime.visualPreview,
    uiBlockRegistry: runtime.uiBlockRegistry,
    apiKeysBridge: runtime.apiKeysBridge,
  });

  const makeCtx = (overrides: Partial<Phase14ToolContext> = {}): Phase14ToolContext => ({
    agenteId: "estrategista",
    canalId: "agente:estrategista",
    threadId: "main:estrategista",
    tarefaId: null,
    turnId: `turn-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    origemTurno: "usuario_local",
    isOneToOneUserChat: true,
    lastUserMessageId: null,
    hopDepth: 0,
    generatedArtifacts: [],
    generatedAnexos: [],
    ...overrides,
  });

  before(async () => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase14-"));
    dbPath = join(tempDir, "criativo-phase14.db");
    runtime = await createDaemonServer({
      port: 0,
      dbPath,
      workspaceRoot: tempDir,
      autoStartLoops: false,
      controlSocketPath: null,
    });
    baseUrl = `http://127.0.0.1:${runtime.port}`;

    // Registra chaves sintéticas no Cofre e clientes locais determinísticos sem chamadas externas
    runtime.vault.setSecret("gemini_api_key", "SYNTHETIC_PROVIDER_KEY_000");
    runtime.vault.setSecret("GEMINI_API_KEY", "SYNTHETIC_PROVIDER_KEY_000");
    runtime.vault.setSecret("claude_api_key", "SYNTHETIC_PROVIDER_KEY_000");
    runtime.vault.setSecret("anthropic_api_key", "SYNTHETIC_PROVIDER_KEY_000");
    const makeSyntheticClient = (name: "gemini" | "claude"): AIProviderClient => ({
      name,
      async generateText() {
        return nextSyntheticModelText;
      },
      async generateWithTools() {
        return { text: nextSyntheticModelText, toolCalls: [] };
      },
    });
    runtime.providers.registerCustomProvider("gemini", makeSyntheticClient("gemini"));
    runtime.providers.registerCustomProvider("claude", makeSyntheticClient("claude"));
  });

  after(async () => {
    await runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
  });

  it("LRN-01: MemoryManager aplica staging por turno, orçamento 8.192 bytes, escopo_site, FTS5 BM25, trava controlado_usuario e MemoryReviewService", async () => {
    // 1. Normalização de domínio site
    assert.equal(normalizeMemorySite("https://WWW.Example.com/post?ref=1"), "example.com");
    assert.equal(normalizeMemorySite("sub.portal.example.org/guia"), "sub.portal.example.org");

    // 2. Staging transacional: turno abortado ('failed') descarta mutação
    const failedTurn = "turn-abort-01";
    const stagedFail = runtime.memoryManager.stageTurnMutation(failedTurn, "estrategista", {
      action: "remember",
      texto: "Memória que não deve persistir após falha",
      categoria: "essential",
    });
    assert.equal(stagedFail.ok, true);
    const failedCommit = runtime.memoryManager.commitTurnMutations(failedTurn, "failed");
    assert.equal(failedCommit.discarded, true);
    assert.equal(runtime.memoryManager.listMemories("estrategista").length, 0);

    // 3. Staging transacional: turno concluído ('completed') persiste memória e FTS5 BM25 encontra
    const okTurn = "turn-ok-01";
    runtime.memoryManager.stageTurnMutation(okTurn, "estrategista", {
      action: "remember",
      texto: "Sempre estruturar ganchos editoriais para [NOME_DA_MARCA] com promessa objetiva",
      categoria: "essential",
      escopoSite: "https://WWW.Example.com/blog",
    });
    const okCommit = runtime.memoryManager.commitTurnMutations(okTurn, "completed");
    assert.equal(okCommit.committed, true);
    assert.equal(okCommit.changes[0]?.escopo_site, "example.com");

    const ftsHits = runtime.memoryManager.searchMemoriesFts("estrategista", "estruturar ganchos", {
      site: "example.com",
    });
    assert.ok(ftsHits.length >= 1);
    assert.match(ftsHits[0]!.texto, /\[NOME_DA_MARCA\]/);

    // 4. Trava controlado_usuario = 1 impede sobrescrita ou esquecimento automático pelo agente
    const manualMem = runtime.memoryManager.addMemory(
      "estrategista",
      "Diretriz fixa manual definida para [@SEU_PERFIL]",
      "manual",
      { categoria: "essential" },
    );
    assert.ok(manualMem);
    assert.equal(manualMem.controlado_usuario, true);

    const blockedForget = runtime.memoryManager.stageTurnMutation("turn-try-forget", "estrategista", {
      action: "forget",
      memoriaId: manualMem.memoria_id,
    });
    assert.equal(blockedForget.ok, false);
    assert.match(blockedForget.erro ?? "", /usuário/i);

    // 5. Orçamento estrito de 8.192 bytes UTF-8 para 'essential' rebaixa excedente para 'searchable'
    let downgradedDetected = false;
    for (let i = 0; i < 15; i += 1) {
      const chunk = `Regra extensa sintética #${i}: ${" diretriz editorial ".repeat(45)}`;
      const saved = runtime.memoryManager.addMemory("estrategista", chunk, "automatica", {
        categoria: "essential",
      });
      if (saved?.downgradedToSearchable) {
        downgradedDetected = true;
        assert.equal(saved.categoria, "searchable");
        break;
      }
    }
    assert.equal(downgradedDetected, true);
    const snap = runtime.memoryManager.getMemoriesSnapshot("estrategista");
    assert.ok(snap.usedBytes <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES);

    // 6. MemoryReviewService: cursor persistido + triggerNow via endpoint REST
    const nowIso = new Date().toISOString();
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, thread_id, lida, criado_em
        ) VALUES (?, 'agente:copywriter', 'copywriter', 'usuario', 'Você', ?, '[]', '[]', NULL, 'main:copywriter', 1, ?);`,
      )
      .run(
        "msg-rev-user-1",
        "Prefiro legendas em listas curtas de 3 tópicos para [NOME_DA_MARCA].",
        nowIso,
      );

    runtime.memoryReview.recordCompletedTurn({
      agenteId: "copywriter",
      threadId: null,
      canalId: "agente:copywriter",
      lastMessageId: "msg-rev-user-1",
    });

    const cursorKey = MemoryReviewService.buildCursorKey("copywriter", null);
    const cursorBefore = runtime.db.connection
      .prepare("SELECT turnos_desde_revisao FROM projecao_memory_review_cursores WHERE chave = ?;")
      .get(cursorKey) as { turnos_desde_revisao: number } | undefined;
    assert.equal(cursorBefore?.turnos_desde_revisao, 1);

    nextSyntheticModelText = JSON.stringify({
      memories: [
        {
          op: "save",
          texto: "Formato preferido: legendas em listas curtas de 3 tópicos para [NOME_DA_MARCA].",
          categoria: "essential",
          escopoSite: "example.com",
        },
      ],
      skill: null,
    });

    const reviewRes = await fetch(`${baseUrl}/api/agentes/copywriter/memorias/revisar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(reviewRes.status, 200);
    const reviewBody = (await reviewRes.json()) as {
      ok: boolean;
      alteracoes: Array<{ acao: string; texto: string }>;
    };
    assert.equal(reviewBody.ok, true);
    assert.equal(reviewBody.alteracoes.length, 1);
    assert.match(reviewBody.alteracoes[0]!.texto, /3 tópicos/);
  });

  it("LRN-02: SkillLearningService nos modos ask/automatic, guardas revisionKeepsSkill e redação prévia em HistorySearchService", async () => {
    // 1. Guardas puras de integridade revisionKeepsSkill e writerCanRevise
    const corpoPortugues =
      "## Diretrizes de Revisão\n1. Mantenha acentuação impecável em português.\n2. Verifique contraste, hierarquia tipográfica e clareza dos botões de ação.\n".repeat(
        3,
      );
    assert.equal(writerCanRevise(corpoPortugues), true);

    const shrunkTooMuch = revisionKeepsSkill(corpoPortugues, "Resumo curto demais.");
    assert.equal(shrunkTooMuch.ok, false);

    const strippedAccents = revisionKeepsSkill(
      corpoPortugues,
      corpoPortugues.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    );
    assert.equal(strippedAccents.ok, false);
    assert.match(strippedAccents.reason ?? "", /acentuação/i);

    // 2. Modo 'ask': emite sugestão persistida + aprovação via POST /api/chat/skill-sugestao/:mensagemId/salvar
    runtime.skillLearning.updateLearningConfig({ skill_learning_mode: "ask" });
    const askOutcome = await runtime.skillLearning.handleDetectedSignal({
      agenteId: "estrategista",
      threadId: null,
      canalId: "agente:estrategista",
      signal: {
        acao: "create",
        nomeSkill: "Estrutura Semanal Sintética",
        perguntaMarkdown: "Deseja gravar o fluxo recorrente de pauta semanal para [NOME_DA_MARCA]?",
      },
    });
    assert.equal(askOutcome.mode, "ask");
    if (askOutcome.mode !== "ask") throw new Error("Esperado modo ask");

    nextSyntheticModelText = JSON.stringify({
      description: "Fluxo recorrente de estruturação semanal para [NOME_DA_MARCA].",
      instructions:
        "# Estrutura Semanal\n\n1. Mapear pilares de conteúdo.\n2. Distribuir formatos com revisão de clareza e acentuação.",
    });

    const saveSugRes = await fetch(
      `${baseUrl}/api/chat/skill-sugestao/${encodeURIComponent(askOutcome.sugestao.mensagem_id)}/salvar`,
      { method: "POST" },
    );
    assert.equal(saveSugRes.status, 200);
    const saveSugJson = (await saveSugRes.json()) as {
      ok: boolean;
      filePath?: string;
      sugestao?: { status: string };
    };
    assert.equal(saveSugJson.ok, true);
    assert.equal(saveSugJson.sugestao?.status, "salva");
    assert.ok(saveSugJson.filePath && existsSync(saveSugJson.filePath));

    // 3. Modo 'automatic': grava SKILL.md diretamente, e faz fallback para 'ask' se revisionKeepsSkill reprovar
    runtime.skillLearning.updateLearningConfig({ skill_learning_mode: "automatic" });
    const autoCreate = await runtime.skillLearning.handleDetectedSignal({
      agenteId: "copywriter",
      threadId: null,
      canalId: "agente:copywriter",
      signal: {
        acao: "create",
        nomeSkill: "Checklist Copy Sintético",
        perguntaMarkdown: "Checklist automático de revisão textual.",
      },
      generateTextFn: async () =>
        JSON.stringify({
          description: "Checklist de revisão textual em português para [NOME_DA_MARCA].",
          instructions:
            "# Checklist de Copy\n\n- Validar promessa central e clareza semântica.\n- Conferir acentuação, pontuação e chamada de ação objetiva.\n".repeat(
              4,
            ),
        }),
    });
    assert.equal(autoCreate.mode, "automatic");
    if (autoCreate.mode !== "automatic") throw new Error("Esperado modo automatic");
    assert.equal(existsSync(autoCreate.filePath), true);

    // Tenta atualizar a skill recém-criada com texto curto demais -> guarda bloqueia e faz fallback para 'ask'
    const fallbackAsk = await runtime.skillLearning.handleDetectedSignal({
      agenteId: "copywriter",
      threadId: null,
      canalId: "agente:copywriter",
      signal: {
        acao: "update",
        skillId: autoCreate.slug,
        nomeSkill: "Revisão Destrutiva Bloqueada",
        perguntaMarkdown: "Tentativa de encurtar excessivamente a skill existente.",
      },
      generateTextFn: async () =>
        JSON.stringify({
          description: "Versão truncada",
          instructions: "Curto.",
        }),
    });
    assert.equal(fallbackAsk.mode, "ask");

    // 4. HistorySearchService: redação ANTES do match impede oráculo de substring de segredo + paginação base64url
    const secretToken = "SEGREDO_ORACULO_SUPER_CONFIDENCIAL_987654";
    runtime.apiKeysBridge.saveApiKey({
      name: "CHAVE_TESTE_ORACULO",
      value: secretToken,
      scope: "todos_agentes",
      origemTurno: "usuario_local",
    });

    for (let idx = 1; idx <= 3; idx += 1) {
      runtime.db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, thread_id, lida, criado_em
          ) VALUES (?, 'agente:estrategista', 'estrategista', 'usuario', 'Você', ?, '[]', '[]', NULL, 'main:estrategista', 1, ?);`,
        )
        .run(
          `msg-hist-${idx}`,
          idx === 1
            ? `Pauta editorial lote ${idx} contendo token acidental ${secretToken}`
            : `Pauta editorial lote ${idx} para campanha institucional`,
          new Date(Date.now() + idx * 1000).toISOString(),
        );
    }

    // Substring exclusiva do segredo NÃO pode gerar match pós-redação prévia
    const oracleAttempt = runtime.historySearch.searchHistory({
      agenteId: "estrategista",
      query: "SUPER_CONFIDENCIAL_987654",
    });
    assert.equal(oracleAttempt.resultados.length, 0);

    // Busca legítima pagina via cursor base64url e redige o token no trecho retornado
    const page1 = runtime.historySearch.searchHistory({
      agenteId: "estrategista",
      query: "Pauta editorial lote",
      limit: 2,
    });
    assert.equal(page1.resultados.length, 2);
    assert.ok(page1.nextCursor && page1.nextCursor.length > 8);

    const page2 = runtime.historySearch.searchHistory({
      agenteId: "estrategista",
      query: "Pauta editorial lote",
      cursor: page1.nextCursor,
      limit: 2,
    });
    assert.equal(page2.resultados.length, 1);
    assert.equal(page2.resultados[0]!.trecho.includes(secretToken), false);
  });

  it("LRN-03: SharedTablesService isola owner_agent_id, bloqueia PRAGMA/ATTACH/VACUUM/multi-SQL, aplica SIGKILL 5s e exporta CSV/JSON", async () => {
    const services = makeServices();

    // 1. Criação e escrita pelo estrategista
    await executePhase14ToolCall(
      "execute_data",
      {
        sql: "CREATE TABLE pautas_compartilhadas (id INTEGER PRIMARY KEY, pilar TEXT, prioridade INTEGER)",
      },
      makeCtx({ agenteId: "estrategista" }),
      services,
    );
    await executePhase14ToolCall(
      "execute_data",
      {
        sql: "INSERT INTO pautas_compartilhadas (pilar, prioridade) VALUES (?, ?), (?, ?)",
        params: ["Educacional", 1, "Autoridade", 2],
      },
      makeCtx({ agenteId: "estrategista" }),
      services,
    );

    // 2. Leitura colaborativa por outro agente (copywriter)
    const readByCopy = (await executePhase14ToolCall(
      "query_data",
      { sql: "SELECT pilar, prioridade FROM pautas_compartilhadas ORDER BY id ASC" },
      makeCtx({ agenteId: "copywriter" }),
      services,
    )) as { rowCount: number; rows: unknown[][] };
    assert.equal(readByCopy.rowCount, 2);
    assert.equal(readByCopy.rows[0]?.[0], "Educacional");

    // 3. Rejeição de instruções perigosas e violação de posse
    const blockedQueries = [
      { tool: "query_data", sql: "PRAGMA table_info(pautas_compartilhadas)", agent: "estrategista" },
      { tool: "execute_data", sql: "ATTACH DATABASE ':memory:' AS aux", agent: "estrategista" },
      { tool: "execute_data", sql: "VACUUM", agent: "estrategista" },
      {
        tool: "query_data",
        sql: "SELECT 1; SELECT 2",
        agent: "estrategista",
      },
      {
        tool: "query_data",
        sql: "SELECT readfile('/etc/passwd')",
        agent: "estrategista",
      },
      {
        tool: "execute_data",
        sql: "DELETE FROM criativo_shared_metadata",
        agent: "estrategista",
      },
      {
        tool: "execute_data",
        sql: "DROP TABLE pautas_compartilhadas",
        agent: "copywriter",
      },
    ];

    for (const bq of blockedQueries) {
      await assert.rejects(
        () =>
          executePhase14ToolCall(
            bq.tool,
            { sql: bq.sql },
            makeCtx({ agenteId: bq.agent }),
            services,
          ),
        (err: unknown) => err instanceof Error && err.message.length > 0,
      );
    }

    await assert.rejects(() =>
      executePhase14ToolCall(
        "delete_table",
        { name: "pautas_compartilhadas" },
        makeCtx({ agenteId: "copywriter" }),
        services,
      ),
    );

    // 4. Timeout real de 5.000ms + SIGKILL sobre CTE recursivo infinito + recuperação imediata do host
    await assert.rejects(
      () =>
        executePhase14ToolCall(
          "query_data",
          {
            sql: "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT count(*) FROM r",
          },
          makeCtx({ agenteId: "estrategista" }),
          services,
        ),
      /tempo limite|timeout|5\.?000|excedeu/i,
    );

    // Verifica que o supervisor sobe novo host imediatamente e responde normalmente
    const afterKill = (await executePhase14ToolCall(
      "query_data",
      { sql: "SELECT count(*) AS total FROM pautas_compartilhadas" },
      makeCtx({ agenteId: "estrategista" }),
      services,
    )) as { rows: unknown[][] };
    assert.equal(afterKill.rows[0]?.[0], 2);

    // 5. Endpoints REST de inspeção, query read-only, exportação CSV/JSON e exclusão pelo usuário
    const listRes = await fetch(`${baseUrl}/api/tabelas-compartilhadas`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { tables: Array<{ name: string; ownerAgentId: string }> };
    assert.equal(listJson.tables.length, 1);
    assert.equal(listJson.tables[0]!.name, "pautas_compartilhadas");
    assert.equal(listJson.tables[0]!.ownerAgentId, "estrategista");

    const inspectRes = await fetch(`${baseUrl}/api/tabelas-compartilhadas/pautas_compartilhadas`);
    assert.equal(inspectRes.status, 200);
    const inspectJson = (await inspectRes.json()) as { totalRows: number; columns: string[] };
    assert.equal(inspectJson.totalRows, 2);
    assert.deepEqual(inspectJson.columns, ["id", "pilar", "prioridade"]);

    const queryRes = await fetch(`${baseUrl}/api/tabelas-compartilhadas/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT pilar FROM pautas_compartilhadas WHERE prioridade = ?", params: [2] }),
    });
    assert.equal(queryRes.status, 200);
    const queryJson = (await queryRes.json()) as { rows: unknown[][] };
    assert.equal(queryJson.rows[0]?.[0], "Autoridade");

    const csvRes = await fetch(
      `${baseUrl}/api/tabelas-compartilhadas/pautas_compartilhadas/export?formato=csv`,
    );
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.match(csvText, /Educacional/);
    assert.match(csvText, /Autoridade/);

    const jsonRes = await fetch(
      `${baseUrl}/api/tabelas-compartilhadas/pautas_compartilhadas/export?formato=json`,
    );
    assert.equal(jsonRes.status, 200);
    const jsonExported = JSON.parse(await jsonRes.text()) as {
      table: string;
      rows: Array<{ pilar: string }>;
    };
    assert.equal(jsonExported.table, "pautas_compartilhadas");
    assert.equal(jsonExported.rows.length, 2);

    const delRes = await fetch(`${baseUrl}/api/tabelas-compartilhadas/pautas_compartilhadas`, {
      method: "DELETE",
    });
    assert.equal(delRes.status, 200);
  });

  it("CHAT-01 & CHAT-02: html_render sandboxed, ask_user isSecret mascarado, ask_ui, acknowledge_request timer e Cofre API Keys seguro", async () => {
    const services = makeServices();

    // 1. html_render + GET /api/agentes/:id/visual-pages/:arquivoId
    const visualOut = (await executePhase14ToolCall(
      "html_render",
      {
        title: "Simulador de Alcance Editorial",
        height: 320,
        html: "<section><h1>Simulador [NOME_DA_MARCA]</h1><button id='acao'>Calcular</button></section>",
      },
      makeCtx({ agenteId: "estrategista" }),
      services,
    )) as { ok: boolean; arquivoId: string };
    assert.equal(visualOut.ok, true);

    const pageRes = await fetch(
      `${baseUrl}/api/agentes/estrategista/visual-pages/${encodeURIComponent(visualOut.arquivoId)}`,
    );
    assert.equal(pageRes.status, 200);
    const pageJson = (await pageRes.json()) as { ok: boolean; html: string };
    assert.equal(pageJson.ok, true);
    assert.match(pageJson.html, /window\.criativoPage/);
    assert.match(pageJson.html, /--studio-/);

    // 2. ask_user com isSecret: true mascara valor em projecao_chat_ui_blocos
    const askUserPromise = executePhase14ToolCall(
      "ask_user",
      {
        title: "Configuração Inicial",
        questions: [
          { id: "objetivo", question: "Qual o objetivo principal?", options: [{ label: "Engajamento" }] },
          { id: "codigo_interno", question: "Informe a senha temporária de homologação:", isSecret: true },
        ],
      },
      makeCtx({ canalId: "agente:estrategista" }),
      services,
    );

    const pendingAskRow = runtime.db.connection
      .prepare(
        "SELECT bloco_id FROM projecao_chat_ui_blocos WHERE tipo_ferramenta = 'ask_user' AND status = 'pending' ORDER BY criado_em DESC LIMIT 1;",
      )
      .get() as { bloco_id: string };
    assert.ok(pendingAskRow?.bloco_id);

    const secretInputAnswer = "SENHA_CONFIDENCIAL_ASK_USER_777";
    const uiRes1 = await fetch(`${baseUrl}/api/chat/ui-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bloco_id: pendingAskRow.bloco_id,
        canal_id: "agente:estrategista",
        acao: "answer",
        respostas_ask_user: {
          objetivo: ["Engajamento"],
          codigo_interno: secretInputAnswer,
        },
      }),
    });
    assert.equal(uiRes1.status, 200);
    const resolvedAskUser = (await askUserPromise) as { status: string; answers?: Record<string, unknown> };
    assert.equal(resolvedAskUser.status, "answered");
    assert.equal(resolvedAskUser.answers?.codigo_interno, secretInputAnswer);

    // No banco SQLite o valor isSecret DEVE estar mascarado
    const storedAskRow = runtime.db.connection
      .prepare("SELECT estado_json FROM projecao_chat_ui_blocos WHERE bloco_id = ?;")
      .get(pendingAskRow.bloco_id) as { estado_json: string };
    assert.equal(storedAskRow.estado_json.includes(secretInputAnswer), false);
    assert.match(storedAskRow.estado_json, /SEGREDO_PREENCHIDO_MASCARADO/);

    // 3. ask_ui com confirmHold
    const askUiPromise = executePhase14ToolCall(
      "ask_ui",
      {
        block: {
          variant: "confirm",
          title: "Confirmar arquivamento de lote",
          danger: true,
          confirmHold: { label: "Segurar para aprovar", durationMs: 1200 },
        },
      },
      makeCtx({ canalId: "agente:copywriter", agenteId: "copywriter" }),
      services,
    );
    const pendingUiRow = runtime.db.connection
      .prepare(
        "SELECT bloco_id FROM projecao_chat_ui_blocos WHERE tipo_ferramenta = 'ask_ui' AND status = 'pending' ORDER BY criado_em DESC LIMIT 1;",
      )
      .get() as { bloco_id: string };

    const uiRes2 = await fetch(`${baseUrl}/api/chat/ui-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bloco_id: pendingUiRow.bloco_id,
        canal_id: "agente:copywriter",
        acao: "answer",
        ui_response: { actionId: "confirm" },
      }),
    });
    assert.equal(uiRes2.status, 200);
    const resolvedUi = (await askUiPromise) as { status: string; actionId?: string };
    assert.equal(resolvedUi.status, "answered");
    assert.equal(resolvedUi.actionId, "confirm");

    // 4. acknowledge_request com planStartAfterMs auto-iniciando
    const ackResolved = (await executePhase14ToolCall(
      "acknowledge_request",
      {
        title: "Plano Automático",
        steps: ["Mapear referências", "Consolidar entrega"],
        planStartAfterMs: 60,
      },
      makeCtx({ canalId: "agente:estrategista" }),
      services,
    )) as { status: string; autoAnswered?: boolean };
    assert.equal(ackResolved.status, "answered");
    assert.equal(ackResolved.autoAnswered, true);

    // 5. request_api_key -> Cofre AES-256-GCM sem expor segredo + travas save_api_key / remove_api_key
    const apiSecretVal = "CHAVE_SECREta_VAULT_FASE14_9999";
    const reqKeyPromise = executePhase14ToolCall(
      "request_api_key",
      {
        name: "SERVICO_EXTERNO_API_KEY",
        label: "Configurar chave externa",
        defaultScope: "todos_agentes",
      },
      makeCtx({ canalId: "agente:estrategista", agenteId: "estrategista" }),
      services,
    );

    const pendingKeyRow = runtime.db.connection
      .prepare(
        "SELECT bloco_id FROM projecao_chat_ui_blocos WHERE tipo_ferramenta = 'request_api_key' AND status = 'pending' ORDER BY criado_em DESC LIMIT 1;",
      )
      .get() as { bloco_id: string };

    const uiResKey = await fetch(`${baseUrl}/api/chat/ui-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bloco_id: pendingKeyRow.bloco_id,
        canal_id: "agente:estrategista",
        acao: "answer",
        api_key_payload: {
          nome: "SERVICO_EXTERNO_API_KEY",
          valor: apiSecretVal,
          escopo: "todos_agentes",
        },
      }),
    });
    assert.equal(uiResKey.status, 200);
    const resolvedKey = (await reqKeyPromise) as { status: string; name?: string };
    assert.equal(resolvedKey.status, "saved");
    assert.equal(resolvedKey.name, "SERVICO_EXTERNO_API_KEY");

    // Segredo está cifrado no Vault, mas NUNCA aparece em estado_json, GET /api/cofre/api-keys ou list_api_keys
    assert.equal(
      runtime.apiKeysBridge.resolveSecretForAgent("SERVICO_EXTERNO_API_KEY", "estrategista"),
      apiSecretVal,
    );
    const storedKeyBlock = runtime.db.connection
      .prepare("SELECT estado_json, spec_json FROM projecao_chat_ui_blocos WHERE bloco_id = ?;")
      .get(pendingKeyRow.bloco_id) as { estado_json: string; spec_json: string };
    assert.equal(storedKeyBlock.estado_json.includes(apiSecretVal), false);
    assert.equal(storedKeyBlock.spec_json.includes(apiSecretVal), false);

    const getKeysRes = await fetch(`${baseUrl}/api/cofre/api-keys`);
    const getKeysText = await getKeysRes.text();
    assert.equal(getKeysText.includes(apiSecretVal), false);
    assert.match(getKeysText, /SERVICO_EXTERNO_API_KEY/);

    const listKeysTool = await executePhase14ToolCall(
      "list_api_keys",
      {},
      makeCtx({ agenteId: "estrategista" }),
      services,
    );
    assert.equal(JSON.stringify(listKeysTool).includes(apiSecretVal), false);

    // Bloqueia save_api_key quando origemTurno !== 'usuario_local'
    await assert.rejects(() =>
      executePhase14ToolCall(
        "save_api_key",
        { name: "CHAVE_INJETADA_WEBHOOK", key: "VALOR_BLOQUEADO" },
        makeCtx({ origemTurno: "webhook" }),
        services,
      ),
    );

    // Bloqueia remove_api_key por agente sobre chave global ('todos_agentes')
    await assert.rejects(() =>
      executePhase14ToolCall(
        "remove_api_key",
        { name: "SERVICO_EXTERNO_API_KEY" },
        makeCtx({ agenteId: "estrategista" }),
        services,
      ),
    );
  });

  it("CHAT-03 & CHAT-04: Biblioteca 4 níveis, attach_files_to_response seguro, react_to_user_message 1 grafema e send_message multi-agente", async () => {
    const services = makeServices();

    // 1. Pastas até 4 níveis + bloqueio de nível 5, nome > 60 chars e ciclo ao mover
    const f1 = runtime.libraryFolders.createFolder({ agenteId: "estrategista", nome: "Campanha Outono" });
    const f2 = runtime.libraryFolders.createFolder({
      agenteId: "estrategista",
      nome: "Semana 01",
      parentId: f1.pasta_id,
    });
    const f3 = runtime.libraryFolders.createFolder({
      agenteId: "estrategista",
      nome: "Carrosséis",
      parentId: f2.pasta_id,
    });
    const f4 = runtime.libraryFolders.createFolder({
      agenteId: "estrategista",
      nome: "Aprovados",
      parentId: f3.pasta_id,
    });
    assert.equal(f4.nivel, 4);
    assert.equal(f4.caminho_completo, "Campanha Outono/Semana 01/Carrosséis/Aprovados");

    assert.throws(
      () =>
        runtime.libraryFolders.createFolder({
          agenteId: "estrategista",
          nome: "Nivel Cinco Proibido",
          parentId: f4.pasta_id,
        }),
      /4 níveis/i,
    );

    assert.throws(
      () =>
        runtime.libraryFolders.createFolder({
          agenteId: "estrategista",
          nome: "N".repeat(65),
        }),
      /60 caracteres/i,
    );

    assert.throws(
      () =>
        runtime.libraryFolders.renameOrMoveFolder(f1.pasta_id, {
          parentId: f3.pasta_id,
        }),
      /ciclo/i,
    );

    // 2. attach_files_to_response criando pasta automaticamente e bloqueando path traversal
    const outDir = join(tempDir, "saidas", "relatorios");
    mkdirSync(outDir, { recursive: true });
    const csvFile = join(outDir, "metricas-sinteticas.csv");
    writeFileSync(csvFile, "pilar,alcance\nEducacional,1200\n", "utf8");

    const attachCtx = makeCtx({ agenteId: "estrategista" });
    const attachRes = (await executePhase14ToolCall(
      "attach_files_to_response",
      {
        paths: ["saidas/relatorios/metricas-sinteticas.csv"],
        folder: "Entregas Trimestrais/Planilhas",
      },
      attachCtx,
      services,
    )) as { ok: boolean; attachedCount: number; files: Array<{ folder_path: string }> };
    assert.equal(attachRes.ok, true);
    assert.equal(attachRes.attachedCount, 1);
    assert.equal(attachRes.files[0]?.folder_path, "Entregas Trimestrais/Planilhas");
    assert.equal(attachCtx.generatedAnexos?.length, 1);

    await assert.rejects(
      () =>
        executePhase14ToolCall(
          "attach_files_to_response",
          { paths: ["../../fora-do-workspace.txt"] },
          makeCtx({ agenteId: "estrategista" }),
          services,
        ),
      /bloqueado|permitido/i,
    );

    // 3. react_to_user_message: aceita 1 grafema emoji em 1:1 e rejeita múltiplos ou canal não 1:1
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, thread_id, lida, criado_em
        ) VALUES ('msg-user-react-1', 'agente:estrategista', 'estrategista', 'usuario', 'Você', 'Ótimo direcionamento!', '[]', '[]', NULL, 'main:estrategista', 1, ?);`,
      )
      .run(new Date().toISOString());

    const okReact = (await executePhase14ToolCall(
      "react_to_user_message",
      { emoji: "🔥" },
      makeCtx({
        agenteId: "estrategista",
        canalId: "agente:estrategista",
        isOneToOneUserChat: true,
        lastUserMessageId: "msg-user-react-1",
      }),
      services,
    )) as { ok: boolean; emoji: string };
    assert.equal(okReact.ok, true);
    assert.equal(okReact.emoji, "🔥");

    await assert.rejects(
      () =>
        executePhase14ToolCall(
          "react_to_user_message",
          { emoji: "🔥🎯" },
          makeCtx({
            agenteId: "estrategista",
            canalId: "agente:estrategista",
            isOneToOneUserChat: true,
            lastUserMessageId: "msg-user-react-1",
          }),
          services,
        ),
      /1 grafema/i,
    );

    const groupReact = (await executePhase14ToolCall(
      "react_to_user_message",
      { emoji: "✅" },
      makeCtx({
        agenteId: "estrategista",
        canalId: "canal-equipe",
        isOneToOneUserChat: false,
      }),
      services,
    )) as { ok: boolean };
    assert.equal(groupReact.ok, false);

    // 4. send_message inter-agentes: múltiplos destinatários, steer vs queue, replyToMessageId corretivo e expectsReply: false
    const steeredIds: string[] = [];
    const queuedIds: string[] = [];
    const customSendServices: Phase14ToolServices = {
      ...services,
      isAgentBusy: (agId) =>
        agId === "copywriter"
          ? { busy: true, policy: "steer" }
          : { busy: true, policy: "queue" },
      onSteerMessage: (recipientId) => {
        steeredIds.push(recipientId);
      },
      onDispatchQueuedInterAgent: (recipientId) => {
        queuedIds.push(recipientId);
      },
    };

    const multiSend = (await executePhase14ToolCall(
      "send_message",
      {
        recipientAgentIds: ["copywriter", "designer_carrossel"],
        text: "Estruturar narrativa e slides para campanha [NOME_DA_MARCA].",
        expectsReply: true,
      },
      makeCtx({ agenteId: "estrategista" }),
      customSendServices,
    )) as {
      ok: boolean;
      entregas: Array<{
        para_agente_id: string;
        outcome: string;
        queuedBecause?: string;
        mensagem_id: string;
      }>;
    };
    assert.equal(multiSend.ok, true);
    assert.equal(multiSend.entregas.length, 2);
    assert.equal(
      multiSend.entregas.find((e) => e.para_agente_id === "copywriter")?.queuedBecause,
      "own-turn",
    );
    assert.equal(
      multiSend.entregas.find((e) => e.para_agente_id === "designer_carrossel")?.queuedBecause,
      "recipient-queues",
    );
    assert.equal(queuedIds.length, 2);

    // Quando expectsReply === false e o destinatário está ocupado em política 'steer', entrega via steered
    const steerSend = (await executePhase14ToolCall(
      "send_message",
      {
        recipientAgentIds: ["copywriter", "designer_carrossel"],
        text: "Aviso complementar de briefing sem exigir nova resposta.",
        expectsReply: false,
      },
      makeCtx({ agenteId: "estrategista" }),
      customSendServices,
    )) as {
      ok: boolean;
      entregas: Array<{ para_agente_id: string; outcome: string }>;
    };
    assert.equal(steerSend.ok, true);
    assert.equal(
      steerSend.entregas.find((e) => e.para_agente_id === "copywriter")?.outcome,
      "steered",
    );
    assert.equal(
      steerSend.entregas.find((e) => e.para_agente_id === "designer_carrossel")?.outcome,
      "queued",
    );
    assert.deepEqual(steeredIds, ["copywriter"]);

    // replyToMessageId inválido retorna lista corretiva de solicitações pendentes
    const invalidReply = (await executePhase14ToolCall(
      "send_message",
      {
        recipientAgentIds: ["estrategista"],
        text: "Retorno com ID inexistente",
        replyToMessageId: "msg-inexistente-000",
      },
      makeCtx({ agenteId: "copywriter", canalId: "agente:copywriter" }),
      services,
    )) as {
      ok: boolean;
      corretivo?: { erro: string; pendentes: Array<{ mensagem_id: string }> };
    };
    assert.equal(invalidReply.ok, false);
    assert.ok(invalidReply.corretivo);
    assert.ok(invalidReply.corretivo.pendentes.length >= 1);

    // Resposta final com expectsReply: false encerra troca sem reabrir pendência
    const validMsgId = multiSend.entregas.find((e) => e.para_agente_id === "copywriter")!.mensagem_id;
    const finalReply = (await executePhase14ToolCall(
      "send_message",
      {
        recipientAgentIds: ["estrategista"],
        text: "Copy finalizada e revisada para [NOME_DA_MARCA].",
        replyToMessageId: validMsgId,
        expectsReply: false,
      },
      makeCtx({ agenteId: "copywriter", canalId: "agente:copywriter" }),
      services,
    )) as {
      ok: boolean;
      entregas: Array<{ expects_reply: boolean }>;
    };
    assert.equal(finalReply.ok, true);
    assert.equal(finalReply.entregas[0]?.expects_reply, false);
  });
});
