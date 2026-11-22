import {
  randomUUID,
} from "node:crypto";
import type {
  AgenteThreadBranch,
  AgenteThreadMensagemNaFila,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  FilaChatEntrega,
  OrigemTituloThread,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import { type AgentThreadStoreDeps, type TailArgs, MAX_OPEN_THREADS_PER_AGENT, type ThreadRow } from "./thread-store-types.ts";
import * as extOps from "./thread-lifecycle-branch-ops.ts";

export * from "./thread-store-types.ts";

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


  private deps(): AgentThreadStoreDeps {
    return {
      db: this.db,
      registrarEvento: this.registrarEvento.bind(this),
      safeJsonParse: this.safeJsonParse.bind(this),
      loadQueuedSummaryForThread: this.loadQueuedSummaryForThread.bind(this),
      mapThreadRow: this.mapThreadRow.bind(this),
      getThread: this.getThread.bind(this),
    };
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


  public createThread(...args: TailArgs<typeof extOps.createThreadOp>): ReturnType<typeof extOps.createThreadOp> {
    return extOps.createThreadOp(this.deps(), ...args);
  }

  public archiveOldAgentFinishedThreads(...args: TailArgs<typeof extOps.archiveOldAgentFinishedThreadsOp>): ReturnType<typeof extOps.archiveOldAgentFinishedThreadsOp> {
    return extOps.archiveOldAgentFinishedThreadsOp(this.deps(), ...args);
  }

  public updateRuntimeState(...args: TailArgs<typeof extOps.updateRuntimeStateOp>): ReturnType<typeof extOps.updateRuntimeStateOp> {
    return extOps.updateRuntimeStateOp(this.deps(), ...args);
  }

  public createBranch(...args: TailArgs<typeof extOps.createBranchOp>): ReturnType<typeof extOps.createBranchOp> {
    return extOps.createBranchOp(this.deps(), ...args);
  }
}
