import {
  randomUUID,
} from "node:crypto";
import type {
  AgenteThreadRegistro,
  AnexoChat,
  PassoChat,
} from "@criativo/contracts";
import { MAX_OPEN_THREADS_PER_AGENT, AGENT_STARTED_UNFINISHED_LIMIT, AGENT_STARTED_FINISHED_KEPT, type ThreadRow, type ChatRowForBranch, type CreateThreadInput, type UpdateThreadRuntimePatch, type CreateBranchInput, type AgentThreadStoreDeps } from "./thread-store-types.ts";

export function createThreadOp(deps: AgentThreadStoreDeps, input: CreateThreadInput): AgenteThreadRegistro {
  const threadId = input.threadId ?? `thread-${randomUUID()}`;
  const agora = new Date().toISOString();
  const titulo = input.titulo.trim().slice(0, 140) || "Nova tarefa";

  return deps.db.runInTransaction(() => {
    if (input.origem === "agente" && !input.rotinaId) {
      archiveOldAgentFinishedThreadsOp(deps, input.agenteId);
      const unfinished = deps.db.connection
        .prepare(
          `
          SELECT COUNT(*) AS total
          FROM projecao_agente_threads
          WHERE agente_id = ? AND origem = 'agente' AND rotina_id IS NULL
            AND estado IN ('executando', 'enfileirada');
        `,
        )
        .get(input.agenteId) as { total: number };
      if (unfinished.total >= AGENT_STARTED_UNFINISHED_LIMIT) {
        throw new Error(
          `Limite de ${AGENT_STARTED_UNFINISHED_LIMIT} sub-tarefas inacabadas iniciado pelo agente atingido.`,
        );
      }
    }

    if (!input.bypassOpenLimit) {
      const openCount = deps.db.connection
        .prepare(
          `
          SELECT COUNT(*) AS total
          FROM projecao_agente_threads
          WHERE agente_id = ? AND arquivada_em IS NULL;
        `,
        )
        .get(input.agenteId) as { total: number };
      if (openCount.total >= MAX_OPEN_THREADS_PER_AGENT) {
        throw new Error(
          `Limite de ${MAX_OPEN_THREADS_PER_AGENT} threads abertas atingido para o agente '${input.agenteId}'.`,
        );
      }
    }

    deps.db.connection
      .prepare(
        `
        INSERT INTO projecao_agente_threads (
          thread_id, agente_id, tarefa_id, origem, titulo, titulo_origem,
          estado, desfecho, erro, progresso_atual, turno_ativo_id, sessao_provedor_id,
          branch_origem_thread_id, branch_origem_mensagem_id, branch_ate_mensagem_id,
          rotina_id, ultima_mensagem_lida_id, criado_em, atualizado_em, arquivada_em,
          ultima_sequencia_evento
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, NULL, 0);
      `,
      )
      .run(
        threadId,
        input.agenteId,
        input.tarefaId ?? null,
        input.origem,
        titulo,
        input.tituloOrigem ?? "auto",
        input.estado ?? "ociosa",
        input.desfecho ?? null,
        input.progressoAtual ?? null,
        input.turnoAtivoId ?? null,
        input.sessaoProvedorId ?? null,
        input.rotinaId ?? null,
        agora,
        agora,
      );

    deps.registrarEvento(input.comandoId ?? randomUUID(), threadId, "thread_criada", {
      agente_id: input.agenteId,
      origem: input.origem,
      titulo,
      tarefa_id: input.tarefaId ?? null,
    });

    const created = deps.getThread(threadId);
    if (!created) {
      throw new Error(`Falha ao recuperar thread recém-criada: ${threadId}`);
    }
    return created;
  });
}

/**
 * Arquiva automaticamente threads iniciadas pelo agente já finalizadas (exceto usuário, branches e rotinas),
 * mantendo até AGENT_STARTED_FINISHED_KEPT (8) abertas mais recentes.
 */
export function archiveOldAgentFinishedThreadsOp(deps: AgentThreadStoreDeps, agenteId: string): string[] {
  return deps.db.runInTransaction(() => {
    const rows = deps.db.connection
      .prepare(
        `
        SELECT thread_id
        FROM projecao_agente_threads
        WHERE agente_id = ?
          AND origem = 'agente'
          AND rotina_id IS NULL
          AND branch_origem_thread_id IS NULL
          AND arquivada_em IS NULL
          AND estado = 'ociosa'
          AND desfecho IS NOT NULL
        ORDER BY atualizado_em DESC, criado_em DESC;
      `,
      )
      .all(agenteId) as Array<{ thread_id: string }>;

    const toArchive = rows.slice(AGENT_STARTED_FINISHED_KEPT);
    if (toArchive.length === 0) {
      return [];
    }

    const agora = new Date().toISOString();
    const archivedIds: string[] = [];
    const stmt = deps.db.connection.prepare(`
      UPDATE projecao_agente_threads
      SET estado = 'arquivada',
          arquivada_em = ?,
          atualizado_em = ?
      WHERE thread_id = ?;
    `);

    for (const item of toArchive) {
      stmt.run(agora, agora, item.thread_id);
      archivedIds.push(item.thread_id);
    }

    return archivedIds;
  });
}

export function updateRuntimeStateOp(deps: AgentThreadStoreDeps, threadId: string, patch: UpdateThreadRuntimePatch): AgenteThreadRegistro | null {
  return deps.db.runInTransaction(() => {
    const existing = deps.db.connection
      .prepare("SELECT * FROM projecao_agente_threads WHERE thread_id = ?;")
      .get(threadId) as ThreadRow | undefined;
    if (!existing) {
      return null;
    }
    const agora = new Date().toISOString();
    deps.db.connection
      .prepare(
        `
        UPDATE projecao_agente_threads
        SET estado = ?,
            desfecho = ?,
            erro = ?,
            progresso_atual = ?,
            turno_ativo_id = ?,
            sessao_provedor_id = ?,
            arquivada_em = ?,
            ultima_sequencia_evento = ?,
            atualizado_em = ?
        WHERE thread_id = ?;
      `,
      )
      .run(
        patch.estado ?? existing.estado,
        patch.desfecho !== undefined ? patch.desfecho : existing.desfecho,
        patch.erro !== undefined ? patch.erro : existing.erro,
        patch.progresso_atual !== undefined ? patch.progresso_atual : existing.progresso_atual,
        patch.turno_ativo_id !== undefined ? patch.turno_ativo_id : existing.turno_ativo_id,
        patch.sessao_provedor_id !== undefined ? patch.sessao_provedor_id : existing.sessao_provedor_id,
        patch.arquivada_em !== undefined ? patch.arquivada_em : existing.arquivada_em,
        patch.ultima_sequencia_evento ?? existing.ultima_sequencia_evento,
        agora,
        threadId,
      );
    return deps.getThread(threadId);
  });
}

/**
 * Ramifica uma conversa a partir de qualquer mensagem finalizada preservando o histórico até o fim do turno correspondente.
 * Idempotente via requestId gravado em eventos_orquestracao.
 */
export function createBranchOp(deps: AgentThreadStoreDeps, input: CreateBranchInput): AgenteThreadRegistro {
  const comandoId = `branch:${input.requestId}`;

  return deps.db.runInTransaction(() => {
    const existingEvent = deps.db.connection
      .prepare("SELECT agregado_id FROM eventos_orquestracao WHERE comando_id = ? LIMIT 1;")
      .get(comandoId) as { agregado_id: string } | undefined;
    if (existingEvent) {
      const already = deps.getThread(existingEvent.agregado_id);
      if (already) {
        return already;
      }
    }

    const openCount = deps.db.connection
      .prepare(
        "SELECT COUNT(*) AS total FROM projecao_agente_threads WHERE agente_id = ? AND arquivada_em IS NULL;",
      )
      .get(input.agenteId) as { total: number };
    if (openCount.total >= MAX_OPEN_THREADS_PER_AGENT) {
      throw new Error(
        `Limite de ${MAX_OPEN_THREADS_PER_AGENT} threads abertas atingido para criar ramificação.`,
      );
    }

    const allMsgs = deps.db.connection
      .prepare(
        `
        SELECT * FROM projecao_conversas_chat
        WHERE thread_id = ? OR (canal_id = ? AND thread_id IS NULL)
        ORDER BY criado_em ASC, ordinal ASC, mensagem_id ASC;
      `,
      )
      .all(
        input.origemThreadId,
        input.origemThreadId.startsWith("main:")
          ? `agente:${input.agenteId}`
          : `thread:${input.origemThreadId}`,
      ) as unknown as ChatRowForBranch[];

    const targetIndex = allMsgs.findIndex((m) => m.mensagem_id === input.origemMensagemId);
    if (targetIndex < 0) {
      throw new Error(`Mensagem '${input.origemMensagemId}' não pertence à thread de origem.`);
    }
    const targetMsg = allMsgs[targetIndex]!;
    if ((targetMsg.status ?? "completed") === "streaming") {
      throw new Error("Aguarde a mensagem concluir o streaming antes de ramificar a conversa.");
    }

    // Inclui todo o grupo de turno quando o ponto de corte pertence a um turno multi-mensagem
    let cutIndex = targetIndex;
    if (targetMsg.turno_id) {
      for (let i = targetIndex + 1; i < allMsgs.length; i += 1) {
        if (allMsgs[i]!.turno_id === targetMsg.turno_id) {
          cutIndex = i;
        } else {
          break;
        }
      }
    }

    const slice = allMsgs.slice(0, cutIndex + 1).filter((m) => (m.status ?? "completed") !== "streaming");
    if (slice.length === 0) {
      throw new Error("Não há mensagens finalizadas suficientes para ramificar neste ponto.");
    }
    const ateMsg = slice[slice.length - 1]!;

    let baseTitle = "Ramificação";
    if (!input.origemThreadId.startsWith("main:")) {
      const origemThread = deps.getThread(input.origemThreadId);
      if (origemThread?.titulo) {
        baseTitle = origemThread.titulo.replace(/\s+#\d+$/, "");
      }
    } else {
      const firstUser = slice.find((m) => m.autor === "usuario" && m.conteudo_markdown.trim().length > 0);
      if (firstUser) {
        baseTitle = firstUser.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 56);
      }
    }

    const branchCountRow = deps.db.connection
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM projecao_agente_threads
        WHERE agente_id = ? AND branch_origem_thread_id = ?;
      `,
      )
      .get(input.agenteId, input.origemThreadId) as { total: number };
    const numberedTitle = `${baseTitle} #${branchCountRow.total + 2}`.slice(0, 140);

    const novaThreadId = `thread-${randomUUID()}`;
    const agora = new Date().toISOString();

    deps.db.connection
      .prepare(
        `
        INSERT INTO projecao_agente_threads (
          thread_id, agente_id, tarefa_id, origem, titulo, titulo_origem,
          estado, desfecho, erro, progresso_atual, turno_ativo_id, sessao_provedor_id,
          branch_origem_thread_id, branch_origem_mensagem_id, branch_ate_mensagem_id,
          rotina_id, ultima_mensagem_lida_id, criado_em, atualizado_em, arquivada_em,
          ultima_sequencia_evento
        ) VALUES (?, ?, NULL, 'usuario', ?, 'auto', 'ociosa', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, NULL, 0);
      `,
      )
      .run(
        novaThreadId,
        input.agenteId,
        numberedTitle,
        input.origemThreadId,
        input.origemMensagemId,
        ateMsg.mensagem_id,
        agora,
        agora,
      );

    const oldToNewId = new Map<string, string>();
    for (const msg of slice) {
      oldToNewId.set(msg.mensagem_id, `msg-${randomUUID()}`);
    }

    const insertMsgStmt = deps.db.connection.prepare(
      `
      INSERT INTO projecao_conversas_chat (
        mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
        anexos_json, steps_json, tarefa_id, lida, criado_em,
        thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
        ordinal, branch_origem_mensagem_id, metadados_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    );

    for (const [idx, msg] of slice.entries()) {
      const novoId = oldToNewId.get(msg.mensagem_id)!;
      const mappedReplyTo = msg.resposta_para_mensagem_id
        ? (oldToNewId.get(msg.resposta_para_mensagem_id) ?? null)
        : null;
      const anx = deps.safeJsonParse<AnexoChat[]>(msg.anexos_json, []);
      const stps = deps.safeJsonParse<PassoChat[]>(msg.steps_json, []);
      insertMsgStmt.run(
        novoId,
        `thread:${novaThreadId}`,
        msg.agente_id ?? input.agenteId,
        msg.autor,
        msg.autor_nome ?? null,
        msg.conteudo_markdown,
        JSON.stringify(anx),
        JSON.stringify(stps),
        msg.tarefa_id ?? null,
        1,
        msg.criado_em,
        novaThreadId,
        msg.turno_id ?? null,
        msg.item_type ?? "mensagem",
        msg.status ?? "completed",
        mappedReplyTo,
        msg.ordinal ?? idx,
        msg.mensagem_id === input.origemMensagemId
          ? input.origemMensagemId
          : (msg.branch_origem_mensagem_id ?? null),
        msg.metadados_json ?? "{}",
      );
    }

    deps.registrarEvento(comandoId, novaThreadId, "thread_branch_criado", {
      agente_id: input.agenteId,
      origem_thread_id: input.origemThreadId,
      origem_mensagem_id: input.origemMensagemId,
      ate_mensagem_id: ateMsg.mensagem_id,
      mensagens_copiadas: slice.length,
    });

    return deps.getThread(novaThreadId)!;
  });
}
