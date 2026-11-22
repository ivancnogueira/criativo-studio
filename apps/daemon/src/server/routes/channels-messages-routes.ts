import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  resolveMetaGraphApiVersion,
  type AgentAllowedFolder,
  type AgentNotificationLevel,
  type AnexoChat,
  type AprendizadoConfig,
  type ArquivoStudio,
  type AvatarStyle,
  type BackupModelChoice,
  type BackupModelsConfig,
  type CanalEquipe,
  type CanalMemoria,
  type CanalNavegadorModo,
  type ChatVisualMeta,
  type ConversationMessage,
  type ConversationUiBlock,
  type DeletedNativeAgentInfo,
  type MemoriaInclusao,
  type MemoryReviewAlteracao,
  type MensagemChat,
  type OnboardingEstado,
  type PassoChat,
  type PermissionLevel,
  type ProviderName,
  type SkillSugestaoItem,
  type ToolDefinition,
  type UiBlockSubmitPayload,
  type UsageLimitAskPayload,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTraco,
  type WorkflowVisual,
} from "@criativo/contracts";
import { HandoffBus } from "../../engine/runner/handoff-bus.ts";
import {
  activateUpgradePackage,
  computeUnlockedAgentsSummary,
  evaluateAndSyncSetupCompletion,
  getBrandIdentity,
  hasConfiguredBrand,
  importBrandPdfFromBuffer,
  interpolateBrandPlaceholders,
  isSetupAssistantVisible,
  isVpsAssistantVisible,
  listUpgradePackages,
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
  syncBrandPlaceholdersInDatabase,
} from "../brand-onboarding-service.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { applyBrandToMessage, mapChatRow, safeJsonParse, type BrandSummary } from "./route-helpers.ts";
import { extractMentionedAgentIds, isGreetingOrCapabilityQuestion } from "./chat-routing-helpers.ts";
import { generateAgentChatReply } from "./agent-reply-runner.ts";
import { getCanalRow, mapCanalRow, normalizeNavegadorModo } from "./channels-crud-routes.ts";

export async function tryHandleChannelsMessagesRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;

  const canalItemMatch = path.match(/^\/api\/canais\/([^/]+)$/);
  if (canalItemMatch && method === "PATCH") {
    const canalId = decodeURIComponent(canalItemMatch[1]);
    const existing = getCanalRow(db, canalId);
    if (!existing) {
      sendJson(res, 404, { erro: `Equipe '${canalId}' não encontrada.` });
      return true;
    }
    const body = await readJsonBody(req);
    const currentMembers = safeJsonParse<string[]>(existing.membros_agentes_json, []);
    const nextNome =
      typeof body.nome === "string" && body.nome.trim().length > 0
        ? body.nome.trim()
        : existing.nome;
    const nextDescricao =
      typeof body.descricao === "string" ? body.descricao.trim() : existing.descricao ?? "";
    const nextInstrucoes =
      typeof body.instrucoes === "string" ? body.instrucoes.trim() : existing.instrucoes ?? "";
    const nextMembers = Array.isArray(body.membros_agentes)
      ? Array.from(
          new Set(
            body.membros_agentes.filter(
              (m): m is string => typeof m === "string" && m.trim().length > 0
            )
          )
        )
      : currentMembers;

    if (nextMembers.length === 0) {
      sendJson(res, 400, { erro: "A equipe precisa ter ao menos 1 agente participante." });
      return true;
    }

    const requestedLeader =
      body.lider_agente_id !== undefined
        ? body.lider_agente_id
        : existing.lider_agente_id;
    const nextLider =
      typeof requestedLeader === "string" && nextMembers.includes(requestedLeader)
        ? requestedLeader
        : nextMembers[0];

    const nextNav =
      body.navegador_modo !== undefined
        ? normalizeNavegadorModo(body.navegador_modo)
        : normalizeNavegadorModo(existing.navegador_modo);

    const nextManterMemorias =
      typeof body.manter_memorias === "boolean"
        ? body.manter_memorias
          ? 1
          : 0
        : existing.manter_memorias
          ? 1
          : 0;

    const agora = new Date().toISOString();
    db.connection
      .prepare(
        `UPDATE projecao_grupos_equipe
         SET nome = ?, descricao = ?, instrucoes = ?, membros_agentes_json = ?,
             lider_agente_id = ?, navegador_modo = ?, manter_memorias = ?, atualizado_em = ?
         WHERE canal_id = ?;`
      )
      .run(
        nextNome,
        nextDescricao,
        nextInstrucoes,
        JSON.stringify(nextMembers),
        nextLider,
        nextNav,
        nextManterMemorias,
        agora,
        canalId
      );

    const updated = getCanalRow(db, canalId)!;
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { canal: mapCanalRow(db, updated) });
    return true;
  }

  if (canalItemMatch && method === "DELETE") {
    const canalId = decodeURIComponent(canalItemMatch[1]);
    const existing = getCanalRow(db, canalId);
    if (!existing) {
      sendJson(res, 404, { erro: `Equipe '${canalId}' não encontrada.` });
      return true;
    }
    db.runInTransaction(() => {
      db.connection.prepare(`DELETE FROM projecao_conversas_chat WHERE canal_id = ?;`).run(canalId);
      db.connection.prepare(`DELETE FROM projecao_canal_memorias WHERE canal_id = ?;`).run(canalId);
      db.connection
        .prepare(`DELETE FROM projecao_agente_rotinas WHERE owner_kind = 'canal' AND owner_id = ?;`)
        .run(canalId);
      db.connection.prepare(`DELETE FROM projecao_grupos_equipe WHERE canal_id = ?;`).run(canalId);
    });
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true });
    return true;
  }

  const canalMsgMatch = path.match(/^\/api\/canais\/([^/]+)\/mensagens$/);
  if (canalMsgMatch && method === "DELETE") {
    const canalId = decodeURIComponent(canalMsgMatch[1]);
    const delRes = db.connection
      .prepare(`DELETE FROM projecao_conversas_chat WHERE canal_id = ?;`)
      .run(canalId);
    db.connection
      .prepare(
        `UPDATE projecao_grupos_equipe SET context_cutoff_at = NULL, context_summary = NULL, atualizado_em = ? WHERE canal_id = ?;`
      )
      .run(new Date().toISOString(), canalId);
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, removidas: Number(delRes.changes) });
    return true;
  }

  if (canalMsgMatch && (method === "GET" || method === "POST")) {
    const canalId = decodeURIComponent(canalMsgMatch[1]);
    if (method === "GET") {
      const currentBrand = getBrandIdentity(providerConnection);
      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC LIMIT 150;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db, currentBrand)) });
      return true;
    }

    const canal = getCanalRow(db, canalId);
    if (!canal) {
      sendJson(res, 404, { erro: `Canal '${canalId}' não encontrado.` });
      return true;
    }

    const body = await readJsonBody(req);
    const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
    const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
    if (!conteudo && anexos.length === 0) {
      sendJson(res, 400, { erro: "Envie 'conteudo' para o canal." });
      return true;
    }

    const userMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: null,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo,
      anexos,
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const insertStmt = db.connection.prepare(
      `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    );

    insertStmt.run(
      userMsg.mensagem_id,
      userMsg.canal_id,
      null,
      "usuario",
      "Você",
      userMsg.conteudo_markdown,
      JSON.stringify(anexos),
      "[]",
      null,
      1,
      userMsg.criado_em
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: null,
      mensagem: userMsg,
    });

    const membrosConfig = safeJsonParse<string[]>(canal.membros_agentes_json, ["estrategista"]);
    const liderId =
      typeof canal.lider_agente_id === "string" && membrosConfig.includes(canal.lider_agente_id)
        ? canal.lider_agente_id
        : membrosConfig[0] ?? null;
    const membrosOrdenados = liderId
      ? [liderId, ...membrosConfig.filter((m) => m !== liderId)]
      : membrosConfig;

    const mencionados = extractMentionedAgentIds(userMsg.conteudo_markdown, undefined, db);
    const membrosAtivos =
      mencionados.length > 0
        ? Array.from(
            new Set([
              ...membrosOrdenados.filter((m) => mencionados.includes(m)),
              ...mencionados,
            ])
          )
        : membrosOrdenados;

    const canalCutoff = canal.context_cutoff_at ?? null;
    // Carrega histórico recente real do canal em ordem cronológica (respeitando corte de contexto)
    const prevRowsDesc = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat
         WHERE canal_id = ?
           AND mensagem_id != ?
           AND COALESCE(item_type, 'mensagem') = 'mensagem'
           AND (? IS NULL OR criado_em > ?)
         ORDER BY criado_em DESC LIMIT 16;`
      )
      .all(canalId, userMsg.mensagem_id, canalCutoff, canalCutoff) as Array<
      Parameters<typeof mapChatRow>[0]
    >;
    const runningHistory: MensagemChat[] = [
      ...prevRowsDesc.reverse().map((r) => mapChatRow(r, db)),
      userMsg,
    ];

    const canalMemorias = canal.manter_memorias
      ? (db.connection
          .prepare(
            `SELECT texto FROM projecao_canal_memorias WHERE canal_id = ? ORDER BY criado_em DESC LIMIT 12;`
          )
          .all(canalId) as Array<{ texto: string }>)
      : [];

    const canalMetaLines: string[] = [];
    if (canal.descricao?.trim()) {
      canalMetaLines.push(`Objetivo da equipe: ${canal.descricao.trim()}`);
    }
    if (canal.instrucoes?.trim()) {
      canalMetaLines.push(`Instruções permanentes da equipe:\n${canal.instrucoes.trim()}`);
    }
    if (canal.context_summary?.trim()) {
      canalMetaLines.push(`Resumo compactado do contexto anterior:\n${canal.context_summary.trim()}`);
    }
    if (canalMemorias.length > 0) {
      canalMetaLines.push(
        `Memórias exclusivas deste canal:\n${canalMemorias.map((m) => `- ${m.texto}`).join("\n")}`
      );
    }
    const canalContextBlock =
      canalMetaLines.length > 0 ? `\n\n${canalMetaLines.join("\n\n")}` : "";

    const respostas: MensagemChat[] = [];
    const liveTurnId = `turn-${randomUUID().slice(0, 8)}`;
    const handoffBus = new HandoffBus(db, deps.queue);

    for (let idx = 0; idx < membrosAtivos.length; idx += 1) {
      const mId = membrosAtivos[idx];
      const ag = db.connection
        .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
        .get(mId) as Parameters<typeof generateAgentChatReply>[1] | undefined;
      if (!ag) continue;

      const isLeader = Boolean(liderId && ag.agente_id === liderId);
      const colegasAnteriores = respostas
        .map((r) => `### Contribuição anterior de ${r.autor_nome ?? r.agente_id} (@${r.agente_id}):\n${r.conteudo_markdown}`)
        .join("\n\n");

      const promptCanal =
        idx === 0 || !colegasAnteriores
          ? `[Equipe ${canal.nome}${isLeader ? " · Líder/Coordenador" : ""}] Pedido do usuário: ${userMsg.conteudo_markdown}\n(Sua equipe neste canal: ${membrosAtivos.map((id) => `@${id}${id === liderId ? " [líder]" : ""}`).join(", ")}. Entregue a parte da sua especialidade para o próximo colega continuar.)${canalContextBlock}`
          : `[Equipe ${canal.nome}${isLeader ? " · Líder/Coordenador" : ""}] Pedido original: ${userMsg.conteudo_markdown}${canalContextBlock}\n\n${colegasAnteriores}\n\nAgora é a sua vez (${ag.nome} / @${ag.agente_id}). Leia o que seus colegas produziram acima e execute a sua etapa especializada complementando e avançando a produção sem repetir o que já foi feito.`;

      if (idx > 0 && respostas[idx - 1]?.agente_id) {
        handoffBus.dispatchHandoff({
          tarefa_id: respostas[idx - 1].tarefa_id ?? null,
          de_agente_id: respostas[idx - 1].agente_id!,
          para_agente_id: ag.agente_id,
          instrucao: `Passagem de bastão no canal ${canal.nome}`,
          artefatos: respostas[idx - 1].anexos.map((a) => a.caminho_relativo),
          enfileirarNovaTarefa: false,
        });
      }

      const reply = await generateAgentChatReply(
        deps,
        ag,
        promptCanal,
        anexos,
        runningHistory,
        (prog) => {
          wsHub.broadcast("chat:progress", {
            canal_id: canalId,
            agente_id: ag.agente_id,
            turno_id: liveTurnId,
            ...prog,
          });
        },
        {
          isHandoff: idx > 0,
          originalUserPrompt: userMsg.conteudo_markdown,
        }
      );

      const agentMsg: MensagemChat = {
        mensagem_id: `msg-${randomUUID()}`,
        canal_id: canalId,
        agente_id: ag.agente_id,
        autor: "agente",
        autor_nome: ag.nome,
        conteudo_markdown: reply.markdown,
        anexos: reply.anexosGerados,
        steps:
          idx > 0 && respostas[idx - 1]
            ? [
                {
                  id: `step-${randomUUID().slice(0, 8)}`,
                  ferramenta: "handoff_agente",
                  titulo: `Recebeu contexto de ${respostas[idx - 1].autor_nome ?? respostas[idx - 1].agente_id}`,
                  status: "concluido",
                  duracao_ms: 18,
                },
                ...reply.steps,
              ]
            : reply.steps,
        tarefa_id: reply.tarefaCriadaId,
        lida: true,
        criado_em: new Date(Date.now() + 5 + idx * 5).toISOString(),
      };

      insertStmt.run(
        agentMsg.mensagem_id,
        canalId,
        ag.agente_id,
        "agente",
        ag.nome,
        agentMsg.conteudo_markdown,
        JSON.stringify(agentMsg.anexos),
        JSON.stringify(agentMsg.steps),
        agentMsg.tarefa_id ?? null,
        1,
        agentMsg.criado_em
      );
      wsHub.broadcast("chat:message", {
        canal_id: canalId,
        agente_id: ag.agente_id,
        mensagem: agentMsg,
      });
      respostas.push(agentMsg);
      runningHistory.push(agentMsg);
    }

    if (canal.manter_memorias && userMsg.conteudo_markdown.trim().length > 16) {
      const memText = `Pedido na equipe: ${userMsg.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 180)}`;
      db.connection
        .prepare(
          `INSERT OR IGNORE INTO projecao_canal_memorias (memoria_id, canal_id, texto, origem, criado_em) VALUES (?, ?, ?, 'automatica', ?);`
        )
        .run(`cmem-${randomUUID().slice(0, 8)}`, canalId, memText, new Date().toISOString());
    }

    db.connection
      .prepare(`UPDATE projecao_grupos_equipe SET atualizado_em = ? WHERE canal_id = ?;`)
      .run(new Date().toISOString(), canalId);

    sendJson(res, 201, { mensagem_usuario: userMsg, mensagens_equipe: respostas });
    return true;
  }

  return false;
}
