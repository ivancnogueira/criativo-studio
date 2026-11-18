import { randomUUID } from "node:crypto";
import type {
  AgenteThreadBranch,
  AgenteThreadMensagemNaFila,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  DesfechoThreadAgente,
  EstadoThreadAgente,
  FilaChatEntrega,
  OrigemThread,
  OrigemTituloThread,
  PassoChat,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export const MAX_OPEN_THREADS_PER_AGENT = 64;
export const AGENT_STARTED_UNFINISHED_LIMIT = 8;
export const AGENT_STARTED_FINISHED_KEPT = 8;

interface ThreadRow {
  thread_id: string;
  agente_id: string;
  tarefa_id: string | null;
  origem: OrigemThread;
  titulo: string;
  titulo_origem: OrigemTituloThread;
  estado: EstadoThreadAgente;
  desfecho: DesfechoThreadAgente | null;
  erro: string | null;
  progresso_atual: string | null;
  turno_ativo_id: string | null;
  sessao_provedor_id: string | null;
  branch_origem_thread_id: string | null;
  branch_origem_mensagem_id: string | null;
  branch_ate_mensagem_id: string | null;
  rotina_id: string | null;
  ultima_mensagem_lida_id: string | null;
  criado_em: string;
  atualizado_em: string;
  arquivada_em: string | null;
  ultima_sequencia_evento: number;
}

interface ChatRowForBranch {
  mensagem_id: string;
  canal_id: string;
  agente_id: string | null;
  autor: "usuario" | "agente" | "sistema";
  autor_nome: string | null;
  conteudo_markdown: string;
  anexos_json: string | null;
  steps_json: string | null;
  tarefa_id: string | null;
  lida: number;
  criado_em: string;
  thread_id: string | null;
  turno_id: string | null;
  item_type: string | null;
  status: string | null;
  resposta_para_mensagem_id: string | null;
  ordinal: number | null;
  branch_origem_mensagem_id: string | null;
  metadados_json: string | null;
}

export interface CreateThreadInput {
  threadId?: string;
  agenteId: string;
  tarefaId?: string | null;
  origem: OrigemThread;
  titulo: string;
  tituloOrigem?: OrigemTituloThread;
  estado?: EstadoThreadAgente;
  desfecho?: DesfechoThreadAgente | null;
  progressoAtual?: string | null;
  turnoAtivoId?: string | null;
  sessaoProvedorId?: string | null;
  rotinaId?: string | null;
  bypassOpenLimit?: boolean;
  comandoId?: string;
}

export interface UpdateThreadRuntimePatch {
  estado?: EstadoThreadAgente;
  desfecho?: DesfechoThreadAgente | null;
  erro?: string | null;
  progresso_atual?: string | null;
  turno_ativo_id?: string | null;
  sessao_provedor_id?: string | null;
  arquivada_em?: string | null;
  ultima_sequencia_evento?: number;
}

export interface CreateBranchInput {
  agenteId: string;
  origemThreadId: string;
  origemMensagemId: string;
  requestId: string;
}

/**
 * Store transacional em node:sqlite para sub-conversas paralelas, branches e threads de rotina.
 */
export class AgentThreadStore {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private registrarEvento(
    comandoId: string,
    agregadoId: string,
    tipoEvento: string,
    payload: Record<string, unknown>,
  ): void {
    this.db.connection
      .prepare(
        `
        INSERT INTO eventos_orquestracao (
          evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
        ) VALUES (?, ?, 'thread', ?, ?, ?, ?);
      `,
      )
      .run(
        randomUUID(),
        comandoId,
        agregadoId,
        tipoEvento,
        new Date().toISOString(),
        JSON.stringify(payload),
      );
  }

  private safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private loadQueuedSummaryForThread(threadId: string): {
    mensagens: AgenteThreadMensagemNaFila[];
    fila: FilaChatEntrega[];
  } {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_fila_chat
        WHERE thread_id = ? AND status IN ('enfileirada', 'iniciando', 'executando')
        ORDER BY CASE WHEN status = 'executando' THEN 0 WHEN status = 'iniciando' THEN 1 ELSE 2 END,
                 COALESCE(posicao, 999999) ASC, criado_em ASC;
      `,
      )
      .all(threadId) as Array<{
      entrega_id: string;
      mensagem_id: string;
      agente_id: string;
      thread_id: string | null;
      remetente_tipo: "usuario" | "agente" | "rotina" | "webhook";
      remetente_agente_id: string | null;
      rotina_id: string | null;
      conteudo_markdown: string;
      anexos_json: string;
      resposta_para_mensagem_id: string | null;
      status: FilaChatEntrega["status"];
      posicao: number | null;
      turno_id: string | null;
      erro: string | null;
      editando: number;
      espera_resposta: number;
      steer_fallback: FilaChatEntrega["steer_fallback"];
      criado_em: string;
    }>;

    const mensagens: AgenteThreadMensagemNaFila[] = rows
      .filter((r) => r.status === "enfileirada" || r.status === "iniciando")
      .map((r) => ({
        entrega_id: r.entrega_id,
        texto: r.conteudo_markdown,
        criado_em: r.criado_em,
      }));

    const fila: FilaChatEntrega[] = rows.map((r) => ({
      entrega_id: r.entrega_id,
      mensagem_id: r.mensagem_id,
      agente_id: r.agente_id,
      thread_id: r.thread_id,
      remetente_tipo: r.remetente_tipo,
      remetente_agente_id: r.remetente_agente_id,
      rotina_id: r.rotina_id,
      conteudo_markdown: r.conteudo_markdown,
      anexos: this.safeJsonParse<AnexoChat[]>(r.anexos_json, []),
      resposta_para_mensagem_id: r.resposta_para_mensagem_id,
      status: r.status,
      posicao: r.posicao,
      turno_id: r.turno_id,
      erro: r.erro,
      editando: r.editando === 1,
      espera_resposta: r.espera_resposta === 1,
      steer_fallback: r.steer_fallback ?? null,
      criado_em: r.criado_em,
    }));

    return { mensagens, fila };
  }

  private mapThreadRow(row: ThreadRow): AgenteThreadRegistro {
    let branch: AgenteThreadBranch | null = null;
    if (
      row.branch_origem_thread_id &&
      row.branch_origem_mensagem_id &&
      row.branch_ate_mensagem_id
    ) {
      const origemIsMain = row.branch_origem_thread_id.startsWith("main:");
      let origemTaskId: string | null = null;
      let origemTitulo: string | null = origemIsMain ? "Chat principal" : null;
      let origemExcluida = false;

      if (!origemIsMain) {
        const origemRow = this.db.connection
          .prepare("SELECT tarefa_id, titulo FROM projecao_agente_threads WHERE thread_id = ?;")
          .get(row.branch_origem_thread_id) as { tarefa_id: string | null; titulo: string } | undefined;
        if (origemRow) {
          origemTaskId = origemRow.tarefa_id;
          origemTitulo = origemRow.titulo;
        } else {
          origemExcluida = true;
        }
      }

      branch = {
        origem_thread_id: row.branch_origem_thread_id,
        origem_task_id: origemTaskId,
        origem_titulo: origemTitulo,
        origem_mensagem_id: row.branch_origem_mensagem_id,
        ate_mensagem_id: row.branch_ate_mensagem_id,
        origem_excluida: origemExcluida,
      };
    }

    const queued = this.loadQueuedSummaryForThread(row.thread_id);

    return {
      thread_id: row.thread_id,
      agente_id: row.agente_id,
      tarefa_id: row.tarefa_id,
      origem: row.origem,
      titulo: row.titulo,
      titulo_origem: row.titulo_origem,
      estado: row.estado,
      desfecho: row.desfecho,
      hold: null,
      turno_ativo_id: row.turno_ativo_id,
      progresso: row.progresso_atual,
      erro: row.erro,
      mensagens_enfileiradas: queued.mensagens,
      fila: queued.fila,
      branch,
      rotina_id: row.rotina_id,
      ultima_mensagem_lida_id: row.ultima_mensagem_lida_id,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
      arquivada_em: row.arquivada_em,
    };
  }

  public createThread(input: CreateThreadInput): AgenteThreadRegistro {
    const threadId = input.threadId ?? `thread-${randomUUID()}`;
    const agora = new Date().toISOString();
    const titulo = input.titulo.trim().slice(0, 140) || "Nova tarefa";

    return this.db.runInTransaction(() => {
      if (input.origem === "agente" && !input.rotinaId) {
        this.archiveOldAgentFinishedThreads(input.agenteId);
        const unfinished = this.db.connection
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
        const openCount = this.db.connection
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

      this.db.connection
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

      this.registrarEvento(input.comandoId ?? randomUUID(), threadId, "thread_criada", {
        agente_id: input.agenteId,
        origem: input.origem,
        titulo,
        tarefa_id: input.tarefaId ?? null,
      });

      const created = this.getThread(threadId);
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
  public archiveOldAgentFinishedThreads(agenteId: string): string[] {
    return this.db.runInTransaction(() => {
      const rows = this.db.connection
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
      const stmt = this.db.connection.prepare(`
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

  public getThread(threadId: string): AgenteThreadRegistro | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_agente_threads WHERE thread_id = ?;")
      .get(threadId) as ThreadRow | undefined;
    return row ? this.mapThreadRow(row) : null;
  }

  public getThreadByTaskId(tarefaId: string): AgenteThreadRegistro | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_agente_threads WHERE tarefa_id = ?;")
      .get(tarefaId) as ThreadRow | undefined;
    return row ? this.mapThreadRow(row) : null;
  }

  public getThreadByRoutine(agenteId: string, rotinaId: string): AgenteThreadRegistro | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_agente_threads WHERE agente_id = ? AND rotina_id = ?;")
      .get(agenteId, rotinaId) as ThreadRow | undefined;
    return row ? this.mapThreadRow(row) : null;
  }

  public listThreadsByAgent(agenteId: string, concurrencyLimit = 4): AgenteThreadsSnapshot {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_agente_threads
        WHERE agente_id = ?
        ORDER BY CASE WHEN arquivada_em IS NULL THEN 0 ELSE 1 END ASC, atualizado_em DESC, criado_em DESC;
      `,
      )
      .all(agenteId) as unknown as ThreadRow[];

    return {
      agente_id: agenteId,
      threads: rows.map((row) => this.mapThreadRow(row)),
      limite_concorrencia: Math.max(1, concurrencyLimit),
    };
  }

  public listAllThreads(): AgenteThreadRegistro[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_agente_threads
        ORDER BY CASE WHEN arquivada_em IS NULL THEN 0 ELSE 1 END ASC, atualizado_em DESC, criado_em DESC;
      `,
      )
      .all() as unknown as ThreadRow[];
    return rows.map((row) => this.mapThreadRow(row));
  }

  public renameThread(
    threadId: string,
    titulo: string,
    origemTitulo: OrigemTituloThread = "usuario",
  ): AgenteThreadRegistro {
    const clean = titulo.trim().slice(0, 140);
    if (!clean) {
      throw new Error("Título da thread não pode ficar vazio.");
    }
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_agente_threads
          SET titulo = ?, titulo_origem = ?, atualizado_em = ?
          WHERE thread_id = ?;
        `,
        )
        .run(clean, origemTitulo, agora, threadId);
      if (info.changes === 0) {
        throw new Error(`Thread não encontrada: ${threadId}`);
      }
      return this.getThread(threadId)!;
    });
  }

  public archiveThread(threadId: string): AgenteThreadRegistro {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_agente_threads
          SET estado = 'arquivada',
              arquivada_em = COALESCE(arquivada_em, ?),
              atualizado_em = ?
          WHERE thread_id = ?;
        `,
        )
        .run(agora, agora, threadId);
      if (info.changes === 0) {
        throw new Error(`Thread não encontrada: ${threadId}`);
      }
      return this.getThread(threadId)!;
    });
  }

  public reopenThread(threadId: string): AgenteThreadRegistro {
    return this.db.runInTransaction(() => {
      const current = this.getThread(threadId);
      if (!current) {
        throw new Error(`Thread não encontrada: ${threadId}`);
      }
      if (current.arquivada_em !== null) {
        const openCount = this.db.connection
          .prepare(
            `
            SELECT COUNT(*) AS total
            FROM projecao_agente_threads
            WHERE agente_id = ? AND arquivada_em IS NULL;
          `,
          )
          .get(current.agente_id) as { total: number };
        if (openCount.total >= MAX_OPEN_THREADS_PER_AGENT) {
          throw new Error(
            `Limite de ${MAX_OPEN_THREADS_PER_AGENT} threads abertas atingido para o agente '${current.agente_id}'.`,
          );
        }
      }
      const agora = new Date().toISOString();
      this.db.connection
        .prepare(
          `
          UPDATE projecao_agente_threads
          SET estado = 'ociosa',
              arquivada_em = NULL,
              atualizado_em = ?
          WHERE thread_id = ?;
        `,
        )
        .run(agora, threadId);
      return this.getThread(threadId)!;
    });
  }

  public deleteThread(threadId: string): boolean {
    return this.db.runInTransaction(() => {
      const current = this.getThread(threadId);
      if (!current) {
        return false;
      }
      this.db.connection.prepare("DELETE FROM projecao_conversas_chat WHERE thread_id = ?;").run(threadId);
      this.db.connection.prepare("DELETE FROM projecao_fila_chat WHERE thread_id = ?;").run(threadId);
      this.db.connection.prepare("DELETE FROM projecao_mensagens_fixadas WHERE thread_id = ?;").run(threadId);
      this.db.connection.prepare("DELETE FROM projecao_agente_threads WHERE thread_id = ?;").run(threadId);
      this.registrarEvento(randomUUID(), threadId, "thread_excluida", {
        agente_id: current.agente_id,
      });
      return true;
    });
  }

  public markThreadRead(threadId: string, lastMsgId?: string | null): AgenteThreadRegistro | null {
    return this.db.runInTransaction(() => {
      const current = this.getThread(threadId);
      if (!current) {
        return null;
      }
      let targetMsgId = lastMsgId ?? null;
      if (!targetMsgId) {
        const lastRow = this.db.connection
          .prepare(
            `
            SELECT mensagem_id FROM projecao_conversas_chat
            WHERE thread_id = ?
            ORDER BY criado_em DESC, ordinal DESC, mensagem_id DESC
            LIMIT 1;
          `,
          )
          .get(threadId) as { mensagem_id: string } | undefined;
        targetMsgId = lastRow?.mensagem_id ?? null;
      }
      this.db.connection
        .prepare("UPDATE projecao_conversas_chat SET lida = 1 WHERE thread_id = ?;")
        .run(threadId);
      if (targetMsgId) {
        this.db.connection
          .prepare("UPDATE projecao_agente_threads SET ultima_mensagem_lida_id = ? WHERE thread_id = ?;")
          .run(targetMsgId, threadId);
      }
      return this.getThread(threadId);
    });
  }

  public updateRuntimeState(threadId: string, patch: UpdateThreadRuntimePatch): AgenteThreadRegistro | null {
    return this.db.runInTransaction(() => {
      const existing = this.db.connection
        .prepare("SELECT * FROM projecao_agente_threads WHERE thread_id = ?;")
        .get(threadId) as ThreadRow | undefined;
      if (!existing) {
        return null;
      }
      const agora = new Date().toISOString();
      this.db.connection
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
      return this.getThread(threadId);
    });
  }

  /**
   * Ramifica uma conversa a partir de qualquer mensagem finalizada preservando o histórico até o fim do turno correspondente.
   * Idempotente via requestId gravado em eventos_orquestracao.
   */
  public createBranch(input: CreateBranchInput): AgenteThreadRegistro {
    const comandoId = `branch:${input.requestId}`;

    return this.db.runInTransaction(() => {
      const existingEvent = this.db.connection
        .prepare("SELECT agregado_id FROM eventos_orquestracao WHERE comando_id = ? LIMIT 1;")
        .get(comandoId) as { agregado_id: string } | undefined;
      if (existingEvent) {
        const already = this.getThread(existingEvent.agregado_id);
        if (already) {
          return already;
        }
      }

      const openCount = this.db.connection
        .prepare(
          "SELECT COUNT(*) AS total FROM projecao_agente_threads WHERE agente_id = ? AND arquivada_em IS NULL;",
        )
        .get(input.agenteId) as { total: number };
      if (openCount.total >= MAX_OPEN_THREADS_PER_AGENT) {
        throw new Error(
          `Limite de ${MAX_OPEN_THREADS_PER_AGENT} threads abertas atingido para criar ramificação.`,
        );
      }

      const allMsgs = this.db.connection
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
        const origemThread = this.getThread(input.origemThreadId);
        if (origemThread?.titulo) {
          baseTitle = origemThread.titulo.replace(/\s+#\d+$/, "");
        }
      } else {
        const firstUser = slice.find((m) => m.autor === "usuario" && m.conteudo_markdown.trim().length > 0);
        if (firstUser) {
          baseTitle = firstUser.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 56);
        }
      }

      const branchCountRow = this.db.connection
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

      this.db.connection
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

      const insertMsgStmt = this.db.connection.prepare(
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
        const anx = this.safeJsonParse<AnexoChat[]>(msg.anexos_json, []);
        const stps = this.safeJsonParse<PassoChat[]>(msg.steps_json, []);
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

      this.registrarEvento(comandoId, novaThreadId, "thread_branch_criado", {
        agente_id: input.agenteId,
        origem_thread_id: input.origemThreadId,
        origem_mensagem_id: input.origemMensagemId,
        ate_mensagem_id: ateMsg.mensagem_id,
        mensagens_copiadas: slice.length,
      });

      return this.getThread(novaThreadId)!;
    });
  }
}
