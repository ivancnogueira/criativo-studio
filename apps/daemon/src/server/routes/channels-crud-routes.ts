import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  resolveMetaGraphApiVersion, type AgentAllowedFolder, type AgentNotificationLevel, type AnexoChat, type AprendizadoConfig, type ArquivoStudio, type AvatarStyle, type BackupModelChoice, type BackupModelsConfig, type CanalEquipe, type CanalMemoria, type CanalNavegadorModo, type ChatVisualMeta, type ConversationMessage, type ConversationUiBlock, type DeletedNativeAgentInfo, type MemoriaInclusao, type MemoryReviewAlteracao, type MensagemChat, type OnboardingEstado, type PassoChat, type PermissionLevel, type ProviderName, type SkillSugestaoItem, type ToolDefinition, type UiBlockSubmitPayload, type UsageLimitAskPayload, type WorkflowAresta, type WorkflowNo, type WorkflowTraco, type WorkflowVisual, } from "@criativo/contracts";
import type { StudioRouteContext, StudioRoutesDeps } from "./route-helpers.ts";
import { mapChatRow, safeJsonParse } from "./route-helpers.ts";
import { compactRecentHistory } from "./chat-routing-helpers.ts";

// 4. Canais em Equipe
  export interface RawCanalRow {
    canal_id: string;
    nome: string;
    descricao: string | null;
    instrucoes?: string | null;
    pasta: string;
    membros_agentes_json: string;
    lider_agente_id?: string | null;
    navegador_modo?: string | null;
    manter_memorias?: number | null;
    context_cutoff_at?: string | null;
    context_summary?: string | null;
    criado_em: string;
    atualizado_em: string;
  }

export const normalizeNavegadorModo = (raw: unknown): CanalNavegadorModo =>
  raw === "leader" || raw === "none" ? raw : "all";

export const mapCanalRow = (db: StudioRoutesDeps["db"], row: RawCanalRow): CanalEquipe => {
    const unreadRow = db.connection
      .prepare(
        `SELECT COUNT(*) as total FROM projecao_conversas_chat WHERE canal_id = ? AND lida = 0;`
      )
      .get(row.canal_id) as { total: number };
    const lastRow = db.connection
      .prepare(
        `SELECT conteudo_markdown FROM projecao_conversas_chat WHERE canal_id = ? AND COALESCE(item_type, 'mensagem') = 'mensagem' ORDER BY criado_em DESC LIMIT 1;`
      )
      .get(row.canal_id) as { conteudo_markdown: string } | undefined;
    const memCountRow = db.connection
      .prepare(`SELECT COUNT(*) as total FROM projecao_canal_memorias WHERE canal_id = ?;`)
      .get(row.canal_id) as { total: number };
    const rotCountRow = db.connection
      .prepare(`SELECT COUNT(*) as total FROM projecao_agente_rotinas WHERE owner_kind = 'canal' AND owner_id = ?;`)
      .get(row.canal_id) as { total: number };

    const membros = safeJsonParse<string[]>(row.membros_agentes_json, []);
    const lider =
      typeof row.lider_agente_id === "string" && membros.includes(row.lider_agente_id)
        ? row.lider_agente_id
        : membros[0] ?? null;

    return {
      canal_id: row.canal_id,
      nome: row.nome,
      descricao: row.descricao ?? "",
      instrucoes: row.instrucoes ?? "",
      pasta: row.pasta,
      membros_agentes: membros,
      lider_agente_id: lider,
      navegador_modo: normalizeNavegadorModo(row.navegador_modo),
      manter_memorias: Boolean(row.manter_memorias),
      context_cutoff_at: row.context_cutoff_at ?? null,
      context_summary: row.context_summary ?? null,
      memorias_count: Number(memCountRow?.total ?? 0),
      rotinas_count: Number(rotCountRow?.total ?? 0),
      nao_lidas: Number(unreadRow?.total ?? 0),
      ultima_mensagem: lastRow ? lastRow.conteudo_markdown.slice(0, 90) : row.descricao,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  };

export const getCanalRow = (db: StudioRoutesDeps["db"], canalId: string): RawCanalRow | undefined =>
  db.connection
    .prepare(`SELECT * FROM projecao_grupos_equipe WHERE canal_id = ?;`)
    .get(canalId) as RawCanalRow | undefined;


export async function tryHandleChannelsCrudRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, deps, db, wsHub } = ctx;
  const { sendJson, readJsonBody } = deps;
  if (method === "GET" && path === "/api/canais") {
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_grupos_equipe ORDER BY atualizado_em DESC;`)
      .all() as unknown as RawCanalRow[];
    sendJson(res, 200, { canais: rows.map((r) => mapCanalRow(db, r)) });
    return true;
  }

  if (method === "POST" && path === "/api/canais") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'nome'." });
      return true;
    }
    const formattedName = body.nome.trim();
    const rawMembros = Array.isArray(body.membros_agentes)
      ? body.membros_agentes.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : ["estrategista", "copywriter", "designer_carrossel"];
    const membros = Array.from(new Set(rawMembros));
    if (membros.length === 0) {
      sendJson(res, 400, { erro: "Selecione ao menos 1 agente para a equipe." });
      return true;
    }

    const lider =
      typeof body.lider_agente_id === "string" && membros.includes(body.lider_agente_id)
        ? body.lider_agente_id
        : membros[0];
    const descricao =
      typeof body.descricao === "string" ? body.descricao.trim() : "";
    const instrucoes =
      typeof body.instrucoes === "string" ? body.instrucoes.trim() : "";
    const navegadorModo = normalizeNavegadorModo(body.navegador_modo);
    const manterMemorias = body.manter_memorias === true ? 1 : 0;

    const canalId = `canal-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_grupos_equipe (
          canal_id, nome, descricao, instrucoes, pasta, membros_agentes_json,
          lider_agente_id, navegador_modo, manter_memorias, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        canalId,
        formattedName,
        descricao,
        instrucoes,
        typeof body.pasta === "string" ? body.pasta : "Canais em Equipe",
        JSON.stringify(membros),
        lider,
        navegadorModo,
        manterMemorias,
        agora,
        agora
      );

    const createdRow = getCanalRow(db, canalId);
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 201, {
      canal: createdRow
        ? mapCanalRow(db, createdRow)
        : {
            canal_id: canalId,
            nome: formattedName,
            descricao,
            instrucoes,
            pasta: typeof body.pasta === "string" ? body.pasta : "Canais em Equipe",
            membros_agentes: membros,
            lider_agente_id: lider,
            navegador_modo: navegadorModo,
            manter_memorias: Boolean(manterMemorias),
            memorias_count: 0,
            rotinas_count: 0,
            nao_lidas: 0,
            ultima_mensagem: null,
            criado_em: agora,
            atualizado_em: agora,
          },
    });
    return true;
  }

  const canalMemoriesItemMatch = path.match(/^\/api\/canais\/([^/]+)\/memorias\/([^/]+)$/);
  if (canalMemoriesItemMatch && method === "DELETE") {
    const canalId = decodeURIComponent(canalMemoriesItemMatch[1]);
    const memoriaId = decodeURIComponent(canalMemoriesItemMatch[2]);
    const delRes = db.connection
      .prepare(`DELETE FROM projecao_canal_memorias WHERE canal_id = ? AND memoria_id = ?;`)
      .run(canalId, memoriaId);
    sendJson(res, 200, { ok: Number(delRes.changes) > 0 });
    return true;
  }

  const canalMemoriesMatch = path.match(/^\/api\/canais\/([^/]+)\/memorias$/);
  if (canalMemoriesMatch && (method === "GET" || method === "POST")) {
    const canalId = decodeURIComponent(canalMemoriesMatch[1]);
    const canal = getCanalRow(db, canalId);
    if (!canal) {
      sendJson(res, 404, { erro: `Equipe '${canalId}' não encontrada.` });
      return true;
    }
    if (method === "GET") {
      const memorias = db.connection
        .prepare(
          `SELECT memoria_id, canal_id, texto, origem, criado_em FROM projecao_canal_memorias WHERE canal_id = ? ORDER BY criado_em DESC;`
        )
        .all(canalId) as unknown as CanalMemoria[];
      sendJson(res, 200, { memorias });
      return true;
    }
    const body = await readJsonBody(req);
    const texto = typeof body.texto === "string" ? body.texto.trim() : "";
    if (!texto) {
      sendJson(res, 400, { erro: "Informe 'texto' para salvar a memória da equipe." });
      return true;
    }
    const memoriaId = `cmem-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();
    db.connection
      .prepare(
        `INSERT OR IGNORE INTO projecao_canal_memorias (memoria_id, canal_id, texto, origem, criado_em) VALUES (?, ?, ?, 'manual', ?);`
      )
      .run(memoriaId, canalId, texto, agora);
    const memorias = db.connection
      .prepare(
        `SELECT memoria_id, canal_id, texto, origem, criado_em FROM projecao_canal_memorias WHERE canal_id = ? ORDER BY criado_em DESC;`
      )
      .all(canalId) as unknown as CanalMemoria[];
    sendJson(res, 201, { memorias });
    return true;
  }

  const canalNewConvMatch = path.match(/^\/api\/canais\/([^/]+)\/nova-conversa$/);
  if (canalNewConvMatch && method === "POST") {
    const canalId = decodeURIComponent(canalNewConvMatch[1]);
    const canal = getCanalRow(db, canalId);
    if (!canal) {
      sendJson(res, 404, { erro: `Equipe '${canalId}' não encontrada.` });
      return true;
    }
    const cutoffAt = new Date().toISOString();
    const dividerMsgId = `msg-reset-${randomUUID().slice(0, 8)}`;
    const dividerText =
      "Nova conversa iniciada — os membros esqueceram as mensagens anteriores · histórico visual preservado";
    const mensagemDivisor: MensagemChat = {
      mensagem_id: dividerMsgId,
      canal_id: canalId,
      agente_id: null,
      autor: "sistema",
      autor_nome: "Sistema",
      conteudo_markdown: dividerText,
      anexos: [],
      steps: [],
      tarefa_id: null,
      item_type: "context_reset",
      status: "completed",
      metadados: { cutoff_at: cutoffAt, mode: "new_conversation" },
      lida: true,
      criado_em: cutoffAt,
    };

    db.runInTransaction(() => {
      db.connection
        .prepare(
          `UPDATE projecao_grupos_equipe SET context_cutoff_at = ?, context_summary = NULL, atualizado_em = ? WHERE canal_id = ?;`
        )
        .run(cutoffAt, cutoffAt, canalId);

      db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, lida, criado_em,
            thread_id, item_type, status, ordinal, metadados_json
          ) VALUES (?, ?, NULL, 'sistema', 'Sistema', ?, '[]', '[]', NULL, 1, ?, ?, 'context_reset', 'completed', 0, ?);`
        )
        .run(
          dividerMsgId,
          canalId,
          dividerText,
          cutoffAt,
          canalId,
          JSON.stringify(mensagemDivisor.metadados)
        );
    });

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: null,
      mensagem: mensagemDivisor,
    });
    const updatedRow = getCanalRow(db, canalId);
    sendJson(res, 200, {
      ok: true,
      canal: updatedRow ? mapCanalRow(db, updatedRow) : undefined,
      mensagem_divisor: mensagemDivisor,
    });
    return true;
  }

  const canalCompactMatch = path.match(/^\/api\/canais\/([^/]+)\/compactar-contexto$/);
  if (canalCompactMatch && method === "POST") {
    const canalId = decodeURIComponent(canalCompactMatch[1]);
    const canal = getCanalRow(db, canalId);
    if (!canal) {
      sendJson(res, 404, { erro: `Equipe '${canalId}' não encontrada.` });
      return true;
    }
    const previousCutoff = canal.context_cutoff_at ?? null;
    const recentRows = db.connection
      .prepare(
        `SELECT autor, autor_nome, conteudo_markdown, criado_em
         FROM projecao_conversas_chat
         WHERE canal_id = ?
           AND COALESCE(item_type, 'mensagem') = 'mensagem'
           AND (? IS NULL OR criado_em > ?)
         ORDER BY criado_em ASC
         LIMIT 40;`
      )
      .all(canalId, previousCutoff, previousCutoff) as Array<{
      autor: string;
      autor_nome: string | null;
      conteudo_markdown: string;
      criado_em: string;
    }>;

    const summaryLines: string[] = [];
    if (canal.context_summary) {
      summaryLines.push(`Resumo anterior: ${canal.context_summary}`);
    }
    for (const r of recentRows.slice(-10)) {
      const speaker = r.autor === "usuario" ? "Usuário" : r.autor_nome || "Agente";
      const snippet = r.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 180);
      if (snippet) summaryLines.push(`- ${speaker}: ${snippet}`);
    }
    const compactSummary =
      summaryLines.length > 0
        ? summaryLines.join("\n").slice(0, 1600)
        : "Sessão sem mensagens anteriores para compactar.";

    const cutoffAt = new Date().toISOString();
    const dividerMsgId = `msg-compact-${randomUUID().slice(0, 8)}`;
    const dividerText =
      "Contexto da equipe compactado — resumo preservado para economizar tokens";
    const mensagemDivisor: MensagemChat = {
      mensagem_id: dividerMsgId,
      canal_id: canalId,
      agente_id: null,
      autor: "sistema",
      autor_nome: "Sistema",
      conteudo_markdown: dividerText,
      anexos: [],
      steps: [],
      tarefa_id: null,
      item_type: "context_reset",
      status: "completed",
      metadados: { cutoff_at: cutoffAt, mode: "compact_context" },
      lida: true,
      criado_em: cutoffAt,
    };

    db.runInTransaction(() => {
      db.connection
        .prepare(
          `UPDATE projecao_grupos_equipe SET context_cutoff_at = ?, context_summary = ?, atualizado_em = ? WHERE canal_id = ?;`
        )
        .run(cutoffAt, compactSummary, cutoffAt, canalId);

      db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, lida, criado_em,
            thread_id, item_type, status, ordinal, metadados_json
          ) VALUES (?, ?, NULL, 'sistema', 'Sistema', ?, '[]', '[]', NULL, 1, ?, ?, 'context_reset', 'completed', 0, ?);`
        )
        .run(
          dividerMsgId,
          canalId,
          dividerText,
          cutoffAt,
          canalId,
          JSON.stringify(mensagemDivisor.metadados)
        );
    });

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: null,
      mensagem: mensagemDivisor,
    });
    const updatedRow = getCanalRow(db, canalId);
    sendJson(res, 200, {
      ok: true,
      canal: updatedRow ? mapCanalRow(db, updatedRow) : undefined,
      mensagem_divisor: mensagemDivisor,
      resumo: compactSummary,
    });
    return true;
  }

  return false;
}
