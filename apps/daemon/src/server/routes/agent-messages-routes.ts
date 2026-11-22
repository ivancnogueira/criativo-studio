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
import { extractExplicitAgentHandoffTags, extractMentionedAgentIds, isGreetingOrCapabilityQuestion, loadResolvableAgentsForRouting } from "./chat-routing-helpers.ts";
import { executeAgentConversationTurn, generateAgentChatReply } from "./agent-reply-runner.ts";

export async function tryHandleAgentMessagesRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;

  // Mensagens do Agente (GET / POST / DELETE / lidas / nao-lida)
  const agentReadMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens\/lidas$/);
  if (method === "POST" && agentReadMatch) {
    const agenteId = decodeURIComponent(agentReadMatch[1]);
    db.connection
      .prepare(`UPDATE projecao_conversas_chat SET lida = 1 WHERE canal_id = ?;`)
      .run(`agente:${agenteId}`);
    const row = db.connection
      .prepare(`SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { config_json?: string } | undefined;
    if (row?.config_json) {
      const cfg = safeJsonParse<Record<string, unknown>>(row.config_json, {});
      if (cfg.marked_unread === true) {
        cfg.marked_unread = false;
        db.connection
          .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`)
          .run(JSON.stringify(cfg), agenteId);
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  const agentUnreadMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens\/nao-lida$/);
  if (method === "POST" && agentUnreadMatch) {
    const agenteId = decodeURIComponent(agentUnreadMatch[1]);
    const row = db.connection
      .prepare(`SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { config_json?: string } | undefined;
    if (!row) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }
    const lastMsg = db.connection
      .prepare(
        `SELECT mensagem_id FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC LIMIT 1;`,
      )
      .get(`agente:${agenteId}`) as { mensagem_id?: string } | undefined;
    if (lastMsg?.mensagem_id) {
      db.connection
        .prepare(`UPDATE projecao_conversas_chat SET lida = 0 WHERE mensagem_id = ?;`)
        .run(lastMsg.mensagem_id);
    }
    const cfg = safeJsonParse<Record<string, unknown>>(row.config_json ?? "{}", {});
    cfg.marked_unread = true;
    db.connection
      .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`)
      .run(JSON.stringify(cfg), agenteId);
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, nao_lidas: 1 });
    return true;
  }

  const agentRoutineMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/rotinas\/([^/]+)\/mensagens$/);
  if (agentRoutineMsgMatch && method === "GET") {
    const rotinaId = decodeURIComponent(agentRoutineMsgMatch[2]);
    const canalId = `rotina:${rotinaId}`;
    const currentBrand = getBrandIdentity(providerConnection);
    const rows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 120;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db, currentBrand)) });
    return true;
  }

  const agentMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens$/);
  if (agentMsgMatch && method === "DELETE") {
    const agenteId = decodeURIComponent(agentMsgMatch[1]);
    const canalId = `agente:${agenteId}`;
    const delRes = db.connection
      .prepare(`DELETE FROM projecao_conversas_chat WHERE canal_id = ?;`)
      .run(canalId);
    const row = db.connection
      .prepare(`SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
      .get(agenteId) as { config_json?: string } | undefined;
    if (row?.config_json) {
      const cfg = safeJsonParse<Record<string, unknown>>(row.config_json, {});
      if (cfg.marked_unread === true) {
        cfg.marked_unread = false;
        db.connection
          .prepare(`UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`)
          .run(JSON.stringify(cfg), agenteId);
      }
    }
    wsHub.broadcast("sidebar:updated", { revision: Date.now() });
    sendJson(res, 200, { ok: true, removidas: Number(delRes.changes) });
    return true;
  }

  if (agentMsgMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMsgMatch[1]);
    const canalIdQuery = url.searchParams.get("canal_id");
    const canalId =
      method === "GET" && canalIdQuery && canalIdQuery.startsWith("rotina:")
        ? canalIdQuery
        : `agente:${agenteId}`;

    if (method === "GET") {
      const currentBrand = getBrandIdentity(providerConnection);
      const beforeCursor = url.searchParams.get("beforeCursor");
      const aroundMessageId = url.searchParams.get("aroundMessageId");
      const limitParam = url.searchParams.get("limit");
      if (
        deps.phase13?.pagination &&
        !canalIdQuery?.startsWith("rotina:") &&
        (beforeCursor || aroundMessageId || limitParam)
      ) {
        try {
          const limitNum = limitParam ? Number(limitParam) : 50;
          const mainThreadId = `main:${agenteId}`;
          const pagina = aroundMessageId
            ? deps.phase13.pagination.readAround({
                threadId: mainThreadId,
                agenteId,
                aroundMessageId,
                limit: Number.isFinite(limitNum) ? limitNum : 50,
              })
            : deps.phase13.pagination.readPage({
                threadId: mainThreadId,
                agenteId,
                beforeCursor,
                limit: Number.isFinite(limitNum) ? limitNum : 50,
              });
          sendJson(res, 200, {
            mensagens: pagina.mensagens.map((m) => applyBrandToMessage(m, currentBrand)),
            pagina: {
              ...pagina,
              mensagens: pagina.mensagens.map((m) => applyBrandToMessage(m, currentBrand)),
            },
          });
        } catch (err) {
          sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC, mensagem_id ASC LIMIT 120;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map((r) => mapChatRow(r, db, currentBrand)) });
      return true;
    }

    deps.uiBlockRegistry?.expirePendingBlocksForCanal(canalId, "skipped");

    const agente = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof generateAgentChatReply>[1] | undefined;

    if (!agente) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const body = await readJsonBody(req);
    const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
    const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
    if (!conteudo && anexos.length === 0) {
      sendJson(res, 400, { erro: "Envie 'conteudo' ou ao menos um anexo." });
      return true;
    }

    const mainThreadId = `main:${agenteId}`;
    const liveTurnId = `turn-${randomUUID().slice(0, 8)}`;
    const maxOrdUserRow = db.connection
      .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
      .get(mainThreadId) as { max_ord: number };
    const userOrdinal = maxOrdUserRow.max_ord + 1;

    const userMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: agenteId,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo || "Referências enviadas para produção.",
      anexos,
      steps: [],
      tarefa_id: null,
      thread_id: mainThreadId,
      turno_id: liveTurnId,
      item_type: "mensagem",
      status: "completed",
      resposta_para_mensagem_id:
        typeof body.resposta_para_mensagem_id === "string" ? body.resposta_para_mensagem_id : null,
      ordinal: userOrdinal,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const insertMsgStmt = db.connection.prepare(
      `INSERT INTO projecao_conversas_chat (
         mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
         anexos_json, steps_json, tarefa_id, lida, criado_em,
         thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
         ordinal, branch_origem_mensagem_id, metadados_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mensagem', 'completed', ?, ?, NULL, '{}');`
    );

    insertMsgStmt.run(
      userMsg.mensagem_id,
      userMsg.canal_id,
      userMsg.agente_id,
      userMsg.autor,
      userMsg.autor_nome ?? "Você",
      userMsg.conteudo_markdown,
      JSON.stringify(userMsg.anexos),
      "[]",
      null,
      1,
      userMsg.criado_em,
      mainThreadId,
      liveTurnId,
      userMsg.resposta_para_mensagem_id ?? null,
      userOrdinal,
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agenteId,
      mensagem: userMsg,
    });

    if (deps.phase13?.queueControls.isLaneBusy(agenteId, null)) {
      const entrega = deps.phase13.queueControls.enqueueMessage({
        mensagemId: userMsg.mensagem_id,
        agenteId,
        threadId: null,
        remetenteTipo: "usuario",
        conteudoMarkdown: userMsg.conteudo_markdown,
        anexos,
        respostaParaMensagemId: userMsg.resposta_para_mensagem_id,
        chaveIdempotencia:
          typeof body.client_message_id === "string" ? `chat-msg:${body.client_message_id}` : null,
        skipWake: true,
      });
      const snapshot = deps.phase13.queueControls.getLaneSnapshot(agenteId, null);
      if (snapshot.modo_ocupado === "steer" && snapshot.suporta_steer_nativo) {
        try {
          const steerRes = deps.phase13.queueControls.steerDelivery(agenteId, null, entrega.entrega_id);
          if (steerRes.mode === "steered") {
            sendJson(res, 202, {
              enfileirada: false,
              steered: true,
              entrega: steerRes.entrega,
              mensagem_usuario: userMsg,
            });
            return true;
          }
        } catch {
          // segue enfileirada na lane
        }
      }
      deps.phase13.onDrainLane(agenteId, null);
      sendJson(res, 202, {
        enfileirada: true,
        entrega,
        mensagem_usuario: userMsg,
      });
      return true;
    }

    const abortController = deps.phase13
      ? deps.phase13.tasksService.registerTurnAbort(mainThreadId, liveTurnId)
      : new AbortController();
    if (deps.phase13) {
      deps.phase13.queueControls.registerActiveTurn({
        agenteId,
        threadId: null,
        turnoId: liveTurnId,
        deliveries: [
          {
            entrega_id: `direct-${liveTurnId}`,
            mensagem_id: userMsg.mensagem_id,
            agente_id: agenteId,
            thread_id: null,
            remetente_tipo: "usuario",
            conteudo_markdown: userMsg.conteudo_markdown,
            anexos,
            resposta_para_mensagem_id: userMsg.resposta_para_mensagem_id ?? null,
            status: "executando",
            posicao: 0,
            turno_id: liveTurnId,
            erro: null,
            editando: false,
            espera_resposta: true,
            criado_em: userMsg.criado_em,
          },
        ],
        abortController,
      });
    }

    let agentMsg: MensagemChat;
    try {
      const turnOut = await executeAgentConversationTurn({
        deps,
        agente,
        userPrompt: userMsg.conteudo_markdown,
        anexos,
        threadId: mainThreadId,
        turnoId: liveTurnId,
        signal: abortController.signal,
        entregaOrigemId: userMsg.mensagem_id,
        respostaParaMensagemId: userMsg.mensagem_id,
      });
      agentMsg = turnOut.agentMsg;
    } finally {
      if (deps.phase13) {
        deps.phase13.queueControls.clearActiveTurn(agenteId, null, liveTurnId);
        deps.phase13.tasksService.clearTurnAbort(mainThreadId, liveTurnId);
        deps.phase13.onDrainLane(agenteId, null);
      }
    }

    const historyRows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC LIMIT 20;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    const history = historyRows.map((r) => mapChatRow(r, db));

    // Handoff 1:1 somente quando não for saudação/dúvida:
    // - do usuário: aceita @agente_id ou [HANDOFF:agente_id]
    // - da resposta do agente: exige [HANDOFF:agente_id] explícito (nunca @mencao em explicação)
    const isSimpleGreeting = isGreetingOrCapabilityQuestion(userMsg.conteudo_markdown);
    const handoffTargets = isSimpleGreeting
      ? []
      : Array.from(
          new Set([
            ...extractMentionedAgentIds(userMsg.conteudo_markdown, agenteId, db),
            ...extractExplicitAgentHandoffTags(agentMsg.conteudo_markdown, agenteId, db),
          ])
        ).slice(0, 2);
    const mensagensHandoff: MensagemChat[] = [];

    if (handoffTargets.length > 0) {
      const handoffBus = new HandoffBus(db, deps.queue);
      let chainHistory = [...history, agentMsg];
      for (let hIdx = 0; hIdx < handoffTargets.length; hIdx += 1) {
        const targetId = handoffTargets[hIdx];
        const targetAg = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(targetId) as Parameters<typeof generateAgentChatReply>[1] | undefined;
        if (!targetAg) continue;

        handoffBus.dispatchHandoff({
          tarefa_id: agentMsg.tarefa_id ?? null,
          de_agente_id: agenteId,
          para_agente_id: targetId,
          instrucao: `Handoff de ${agente.nome}: ${userMsg.conteudo_markdown}`,
          artefatos: agentMsg.anexos.map((a) => a.caminho_relativo),
          enfileirarNovaTarefa: false,
        });

        const hReply = await generateAgentChatReply(
          deps,
          targetAg,
          `[Handoff recebido de ${agente.nome} (@${agenteId})]\nSolicitação original: ${userMsg.conteudo_markdown}\nEntrega do colega anterior:\n${agentMsg.conteudo_markdown}`,
          anexos,
          chainHistory,
          (prog) => {
            wsHub.broadcast("chat:progress", {
              canal_id: canalId,
              agente_id: targetId,
              turno_id: `${liveTurnId}-h${hIdx}`,
              ...prog,
            });
          },
          {
            isHandoff: true,
            originalUserPrompt: userMsg.conteudo_markdown,
          }
        );

        const hMsg: MensagemChat = {
          mensagem_id: `msg-${randomUUID()}`,
          canal_id: canalId,
          agente_id: targetId,
          autor: "agente",
          autor_nome: targetAg.nome,
          conteudo_markdown: hReply.markdown,
          anexos: hReply.anexosGerados,
          steps: [
            {
              id: `step-${randomUUID().slice(0, 8)}`,
              ferramenta: "handoff_agente",
              titulo: `Recebeu o bastão de ${agente.nome}`,
              status: "concluido",
              duracao_ms: 20,
            },
            ...hReply.steps,
          ],
          tarefa_id: hReply.tarefaCriadaId,
          thread_id: mainThreadId,
          turno_id: liveTurnId,
          item_type: "mensagem",
          status: "completed",
          resposta_para_mensagem_id: agentMsg.mensagem_id,
          ordinal: userOrdinal + 2 + hIdx,
          lida: true,
          criado_em: new Date(Date.now() + 10 + hIdx * 10).toISOString(),
        };

        insertMsgStmt.run(
          hMsg.mensagem_id,
          canalId,
          targetId,
          "agente",
          targetAg.nome,
          hMsg.conteudo_markdown,
          JSON.stringify(hMsg.anexos),
          JSON.stringify(hMsg.steps),
          hMsg.tarefa_id ?? null,
          1,
          hMsg.criado_em,
          mainThreadId,
          liveTurnId,
          agentMsg.mensagem_id,
          userOrdinal + 2 + hIdx,
        );
        wsHub.broadcast("chat:message", {
          canal_id: canalId,
          agente_id: targetId,
          mensagem: hMsg,
        });
        mensagensHandoff.push(hMsg);
        chainHistory = [...chainHistory, hMsg];
      }
    }

    sendJson(res, 201, {
      mensagem_usuario: userMsg,
      mensagem_agente: agentMsg,
      mensagens_handoff: mensagensHandoff,
    });
    return true;
  }

  return false;
}
