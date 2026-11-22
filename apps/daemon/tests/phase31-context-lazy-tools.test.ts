import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ConversationMessage, ToolDefinition } from "@criativo/contracts";
import { ContextResetService } from "../src/chat/context-reset-service.ts";
import { CriativoDatabase } from "../src/database/client.ts";
import { buildPortableHandoffHistory } from "../src/engine/runner/handoff-history-builder.ts";
import { MemoryManager } from "../src/engine/runner/memory-manager.ts";
import { LazyToolRouter } from "../src/engine/tools/lazy-tool-router.ts";
import { WebSocketHub } from "../src/server/websocket-hub.ts";

function setupDbWithAgent(agenteId = "estrategista"): CriativoDatabase {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  const now = new Date().toISOString();
  db.connection
    .prepare(
      `INSERT INTO projecao_agentes (
        agente_id, nome, papel, modelo_padrao, status, skills_paths_json,
        config_json, ordem_exibicao, atualizado_em
      ) VALUES (?, ?, ?, ?, 'ocioso', '[]', '{}', 1, ?);`
    )
    .run(agenteId, "Estrategista", "Estratégia", "gemini-2.5-flash", now);
  return db;
}

test("ContextResetService.autoCompactIfNeeded compacta acima de 80% preservando 100% do historico visual", () => {
  const db = setupDbWithAgent("estrategista");
  const wsHub = new WebSocketHub();
  const mem = new MemoryManager(db);
  const resetService = new ContextResetService({ db, wsHub, memoryManager: mem });
  const now = new Date().toISOString();

  for (let i = 0; i < 4; i += 1) {
    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, lida, criado_em, thread_id, item_type, status, ordinal, metadados_json
        ) VALUES (?, 'agente:estrategista', 'estrategista', ?, ?, ?, '[]', '[]', 1, ?, 'main:estrategista', 'mensagem', 'completed', ?, '{}');`
      )
      .run(
        `msg-${randomUUID().slice(0, 8)}`,
        i % 2 === 0 ? "usuario" : "agente",
        i % 2 === 0 ? "Você" : "Estrategista",
        `Mensagem de histórico #${i + 1} sobre planejamento editorial.`,
        now,
        i
      );
  }

  // Abaixo de 80% não compacta
  const noOp = resetService.autoCompactIfNeeded({
    agenteId: "estrategista",
    estimatedTokens: 50_000,
    maxContextTokens: 100_000,
    thresholdRatio: 0.8,
  });
  assert.equal(noOp.compacted, false);

  // Acima de 80% compacta, atualiza cutoff e preserva todas as mensagens visuais originais
  const compacted = resetService.autoCompactIfNeeded({
    agenteId: "estrategista",
    estimatedTokens: 86_000,
    maxContextTokens: 100_000,
    thresholdRatio: 0.8,
  });
  assert.equal(compacted.compacted, true);
  assert.ok(compacted.cutoff_at);
  assert.ok(compacted.memorias_salvas >= 1);
  assert.equal(compacted.mensagem_divisor?.item_type, "context_reset");

  const visualRows = db.connection
    .prepare("SELECT COUNT(*) AS total FROM projecao_conversas_chat WHERE agente_id = 'estrategista' AND item_type = 'mensagem';")
    .get() as { total: number };
  assert.equal(visualRows.total, 4);
});

test("buildPortableHandoffHistory converte toolCalls e respostas tool para formato portatil cross-provider", () => {
  const msgs: ConversationMessage[] = [
    { role: "user", content: "Analise os últimos 5 posts de [@SEU_PERFIL]" },
    {
      role: "assistant",
      content: "Vou consultar as métricas agora.",
      toolCalls: [{ id: "tc-1", name: "consultar_metricas_meta", arguments: { periodo: "30d" } }],
    },
    {
      role: "tool",
      toolCallId: "tc-1",
      toolName: "consultar_metricas_meta",
      content: JSON.stringify({ posts: [{ id: "1", reach: 1200 }] }),
    },
    { role: "assistant", content: "Alcance médio positivo nos carrosséis." },
  ];

  const portable = buildPortableHandoffHistory(msgs, "claude-sonnet-4-5", "gpt-5.2");
  assert.ok(portable.messages.every((m) => m.role === "user" || m.role === "assistant"));
  assert.ok(portable.messages.every((m) => !m.toolCalls));
  assert.ok(portable.handoffNotice.includes("claude-sonnet-4-5"));
  assert.ok(portable.handoffNotice.includes("gpt-5.2"));
});

test("LazyToolRouter reduz payload acima do limiar, executa tool_search -> tool_describe -> tool_call e bloqueia tool nao autorizada", async () => {
  const tools: ToolDefinition[] = [
    {
      name: "salvar_memoria",
      description: "Salva memória durável",
      parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
    },
  ];
  for (let i = 1; i <= 24; i += 1) {
    tools.push({
      name: `mcp_demo_tool_${i}`,
      description: `Ferramenta secundária número ${i} para integração externa`,
      parameters: {
        type: "object",
        properties: { item: { type: "string" } },
        required: ["item"],
      },
    });
  }

  const router = new LazyToolRouter(tools, { threshold: 20 });
  assert.equal(router.isLazyActive(), true);

  const exposed = router.selectExposedTools();
  // Core (salvar_memoria) + 3 meta-tools (tool_search, tool_describe, tool_call)
  assert.equal(exposed.length, 4);
  assert.ok(exposed.some((t) => t.name === "tool_search"));
  assert.ok(exposed.some((t) => t.name === "tool_describe"));
  assert.ok(exposed.some((t) => t.name === "tool_call"));

  const searchRes = (await router.executeMetaTool(
    "tool_search",
    { query: "tool_12" },
    async () => ({})
  )) as { resultados: Array<{ name: string }> };
  assert.ok(searchRes.resultados.some((r) => r.name === "mcp_demo_tool_12"));

  const describeRes = (await router.executeMetaTool(
    "tool_describe",
    { tool_name: "mcp_demo_tool_12" },
    async () => ({})
  )) as { schema: ToolDefinition };
  assert.equal(describeRes.schema.name, "mcp_demo_tool_12");

  let calledTarget = "";
  await router.executeMetaTool(
    "tool_call",
    { tool_name: "mcp_demo_tool_12", arguments: { item: "abc" } },
    async (targetName) => {
      calledTarget = targetName;
      return { ok: true };
    }
  );
  assert.equal(calledTarget, "mcp_demo_tool_12");

  // Ferramenta fora do conjunto autorizado é bloqueada com CRV-AUTH-002
  await assert.rejects(
    async () =>
      await router.executeMetaTool(
        "tool_call",
        { tool_name: "ferramenta_proibida", arguments: {} },
        async () => ({})
      ),
    (err: unknown) => err instanceof Error && err.message.includes("CRV-AUTH-002")
  );
});
