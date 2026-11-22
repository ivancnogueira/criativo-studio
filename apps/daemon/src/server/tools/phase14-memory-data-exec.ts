import { randomUUID } from "node:crypto";
import type { ChatVisualMeta, MemoriaInclusao, MensagemChat } from "@criativo/contracts";
import { MemoryManager } from "../../engine/runner/memory-manager.ts";
import type { Phase14ToolContext, Phase14ToolServices } from "./phase14-tools-schema.ts";
import { readStringArg } from "./studio-tool-helpers.ts";

const HANDLED_MEMORY_DATA_TOOLS = new Set([
  "remember",
  "forget_memory",
  "search_memories",
  "list_memories",
  "set_memory_inclusion",
  "memory_recall",
  "history_read",
  "history_search",
  "list_tables",
  "query_data",
  "execute_data",
  "delete_table",
  "html_render",
  "html_preview",
]);

export function isPhase14MemoryDataTool(toolName: string): boolean {
  return HANDLED_MEMORY_DATA_TOOLS.has(toolName);
}
export async function executePhase14MemoryDataTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Phase14ToolContext,
  services: Phase14ToolServices
): Promise<{ handled: boolean; result?: unknown }> {
  if (!HANDLED_MEMORY_DATA_TOOLS.has(toolName)) {
    return { handled: false };
  }
  const memMgr = services.memoryManager ?? new MemoryManager(services.db);
  const redact = (text: string): string =>
    services.apiKeysBridge ? services.apiKeysBridge.redactSecretValues(text) : text;

  const run = async (): Promise<unknown> => {
    switch (toolName) {
    case "remember": {
      const rawText = readStringArg(args, "text", "texto") ?? "";
      if (!rawText) {
        throw new Error("Informe o texto da memória em 'text'.");
      }
      const safeText = redact(rawText);
      const memoryId = readStringArg(args, "memoryId", "memoriaId", "memoria_id");
      const rawInclusion = readStringArg(args, "inclusion", "categoria");
      const inclusion: MemoriaInclusao =
        rawInclusion === "essential" ? "essential" : "searchable";
      const site = readStringArg(args, "site", "escopoSite", "escopo_site") ?? null;

      const staged = memMgr.stageTurnMutation(ctx.turnId, ctx.agenteId, {
        action: "remember",
        memoriaId: memoryId,
        texto: safeText,
        categoria: inclusion,
        escopoSite: site,
      });
      return staged;
    }

    case "forget_memory": {
      const memoryId = readStringArg(args, "memoryId", "memoriaId", "memoria_id");
      const text = readStringArg(args, "text", "texto");
      if (!memoryId && !text) {
        throw new Error("Informe 'memoryId' ou 'text' da memória a esquecer.");
      }
      return memMgr.stageTurnMutation(ctx.turnId, ctx.agenteId, {
        action: "forget",
        memoriaId: memoryId,
        texto: text,
      });
    }

    case "search_memories": {
      const query = readStringArg(args, "query", "busca") ?? "";
      const site = readStringArg(args, "site") ?? null;
      const limit = typeof args.limit === "number" ? args.limit : 15;
      const items = memMgr.searchMemoriesFts(ctx.agenteId, query, {
        limit,
        site,
        redact,
      });
      return { action: "search", count: items.length, memories: items };
    }

    case "list_memories": {
      const rawCat = readStringArg(args, "inclusion", "categoria");
      const categoria: MemoriaInclusao | undefined =
        rawCat === "essential" || rawCat === "searchable" ? rawCat : undefined;
      const site = readStringArg(args, "site") ?? null;
      const after = readStringArg(args, "after");
      const limit = typeof args.limit === "number" ? args.limit : 30;
      const listed = memMgr.listMemoriesPaginated(ctx.agenteId, {
        categoria,
        site,
        after,
        limit,
      });
      return {
        action: "list",
        memories: listed.items.map((m) => ({ ...m, texto: redact(m.texto) })),
        nextCursor: listed.nextCursor,
      };
    }

    case "set_memory_inclusion": {
      const rawChanges = Array.isArray(args.changes) ? args.changes : [];
      const parsedChanges: Array<{ memoriaId: string; categoria: MemoriaInclusao }> = [];
      for (const item of rawChanges) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const id = readStringArg(rec, "memoryId", "memoriaId", "memoria_id");
        const inc = readStringArg(rec, "inclusion", "categoria");
        if (id && (inc === "essential" || inc === "searchable")) {
          parsedChanges.push({ memoriaId: id, categoria: inc });
        }
      }
      if (parsedChanges.length === 0) {
        throw new Error("Informe ao menos um item válido em 'changes'.");
      }
      const snap = memMgr.setMemoryInclusion(ctx.agenteId, parsedChanges, false);
      return {
        action: "set_inclusion",
        usedBytes: snap.usedBytes,
        budgetBytes: snap.budgetBytes,
        updated: parsedChanges.length,
      };
    }

    case "memory_recall": {
      const query = readStringArg(args, "query", "busca");
      const explicitAction = readStringArg(args, "action");
      const effectiveAction =
        explicitAction ??
        (Array.isArray(args.changes)
          ? "set_inclusion"
          : query
            ? "search"
            : "list");

      if (effectiveAction === "set_inclusion") {
        return await (async (t, a, c, s) => (await executePhase14MemoryDataTool(t, a, c, s)).result)("set_memory_inclusion", args, ctx, services);
      }
      if (effectiveAction === "search") {
        return await (async (t, a, c, s) => (await executePhase14MemoryDataTool(t, a, c, s)).result)(
          "search_memories",
          { ...args, query: query ?? "" },
          ctx,
          services,
        );
      }
      return await (async (t, a, c, s) => (await executePhase14MemoryDataTool(t, a, c, s)).result)("list_memories", args, ctx, services);
    }

    case "history_read": {
      if (!services.historySearch) {
        throw new Error("HistorySearchService não inicializado neste daemon.");
      }
      return services.historySearch.readConversationExcerpt({
        agenteId: ctx.agenteId,
        canalId: readStringArg(args, "canalId", "canal_id") ?? null,
        messageId: readStringArg(args, "messageId", "mensagem_id") ?? null,
        before: readStringArg(args, "before") ?? null,
        offset: typeof args.offset === "number" ? args.offset : 0,
        limit: typeof args.limit === "number" ? args.limit : 20,
        includeWorkSteps: Boolean(args.includeWorkSteps),
        workStepsOffset: typeof args.workStepsOffset === "number" ? args.workStepsOffset : 0,
      });
    }

    case "history_search": {
      if (!services.historySearch) {
        throw new Error("HistorySearchService não inicializado neste daemon.");
      }
      const messageId = readStringArg(args, "messageId", "mensagem_id");
      const before = readStringArg(args, "before");
      if (messageId || before || args.includeWorkSteps === true) {
        return services.historySearch.readConversationExcerpt({
          agenteId: ctx.agenteId,
          canalId: readStringArg(args, "taskId", "canalId") ?? null,
          messageId: messageId ?? null,
          before: before ?? null,
          offset: typeof args.offset === "number" ? args.offset : 0,
          limit: typeof args.limit === "number" ? args.limit : 20,
          includeWorkSteps: Boolean(args.includeWorkSteps),
          workStepsOffset: typeof args.workStepsOffset === "number" ? args.workStepsOffset : 0,
        });
      }
      return services.historySearch.searchHistory({
        agenteId: ctx.agenteId,
        taskId: readStringArg(args, "taskId", "threadId") ?? null,
        query: readStringArg(args, "query", "busca") ?? null,
        after: readStringArg(args, "after") ?? null,
        cursor: readStringArg(args, "cursor") ?? null,
        limit: typeof args.limit === "number" ? args.limit : 20,
      });
    }

    // -------------------------------------------------------------------------
    // 2. Banco SQL Compartilhado (Shared Tables — LRN-03)
    // -------------------------------------------------------------------------
    case "list_tables": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const tables = await services.sharedTables.listTables();
      return { tables };
    }

    case "query_data": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const sql = typeof args.sql === "string" ? args.sql : "";
      const params = Array.isArray(args.params) ? args.params : undefined;
      return await services.sharedTables.queryData(sql, params, ctx.agenteId);
    }

    case "execute_data": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const sql = typeof args.sql === "string" ? args.sql : "";
      const params = Array.isArray(args.params) ? args.params : undefined;
      return await services.sharedTables.executeData(sql, params, ctx.agenteId);
    }

    case "delete_table": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "tableName", "nome") ?? "";
      return await services.sharedTables.deleteTable(name, ctx.agenteId);
    }

    // -------------------------------------------------------------------------
    // 3. Generative UI em Sandbox (CHAT-01)
    // -------------------------------------------------------------------------
    case "html_render": {
      if (!services.visualPreview) {
        throw new Error("ChatVisualPreviewService não inicializado neste daemon.");
      }
      const html = typeof args.html === "string" ? args.html : "";
      const title = readStringArg(args, "title", "titulo") ?? "Painel Interativo";
      const height = typeof args.height === "number" ? args.height : undefined;

      const rendered = services.visualPreview.renderAndPersistPage({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        html,
        title,
        height,
        tarefaId: ctx.tarefaId ?? null,
      });

      const visualMeta: ChatVisualMeta = {
        arquivo_id: rendered.arquivoId,
        titulo: rendered.title,
        altura_inicial: rendered.height,
        url: rendered.url,
      };

      ctx.generatedArtifacts?.push(rendered.relPath);
      ctx.onVisualMessage?.(visualMeta, rendered.itemType);

      if (ctx.persistVisualMessage !== false) {
        const msgId = randomUUID();
        const agora = new Date().toISOString();
        const threadId =
          ctx.threadId ??
          (ctx.canalId.startsWith("agente:") ? `main:${ctx.agenteId}` : ctx.canalId);
        const agentRow = services.db.connection
          .prepare("SELECT nome FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
          .get(ctx.agenteId) as { nome?: string } | undefined;
        const autorNome = agentRow?.nome ?? ctx.agenteId;

        services.db.connection
          .prepare(
            `INSERT INTO projecao_conversas_chat (
              mensagem_id, canal_id, agente_id, autor, autor_nome,
              conteudo_markdown, anexos_json, steps_json, tarefa_id,
              thread_id, turno_id, item_type, status, metadados_json, lida, criado_em
            ) VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', ?, ?, ?, ?, 'completed', ?, 1, ?);`,
          )
          .run(
            msgId,
            ctx.canalId,
            ctx.agenteId,
            autorNome,
            `Painel visual: **${rendered.title}**`,
            ctx.tarefaId ?? null,
            threadId,
            ctx.turnId,
            rendered.itemType,
            JSON.stringify({ visual_page: visualMeta }),
            agora,
          );

        const chatMsg: MensagemChat = {
          mensagem_id: msgId,
          canal_id: ctx.canalId,
          agente_id: ctx.agenteId,
          autor: "agente",
          autor_nome: autorNome,
          conteudo_markdown: `Painel visual: **${rendered.title}**`,
          anexos: [],
          steps: [],
          tarefa_id: ctx.tarefaId ?? null,
          thread_id: threadId,
          turno_id: ctx.turnId,
          item_type: rendered.itemType,
          status: "completed",
          visual_page: visualMeta,
          metadados: { visual_page: visualMeta },
          lida: true,
          criado_em: agora,
        };
        services.wsHub?.broadcast("chat:message", {
          canal_id: ctx.canalId,
          agente_id: ctx.agenteId,
          mensagem: chatMsg,
        });
      }

      return {
        ok: true,
        arquivoId: rendered.arquivoId,
        title: rendered.title,
        height: rendered.height,
        url: rendered.url,
      };
    }

    case "html_preview": {
      if (!services.visualPreview) {
        throw new Error("ChatVisualPreviewService não inicializado neste daemon.");
      }
      const html = typeof args.html === "string" ? args.html : "";
      const width = typeof args.width === "number" ? args.width : undefined;
      const appearance = args.appearance === "light" ? "light" : "dark";
      return await services.visualPreview.previewHtmlOffscreen({
        html,
        width,
        appearance,
      });
    }
      default:
        return undefined;
    }
  };

  return { handled: true, result: await run() };
}
