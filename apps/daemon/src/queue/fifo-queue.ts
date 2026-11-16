import { randomUUID } from "node:crypto";
import type { StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { mapTarefaRow, type EnqueueTaskInput, type TarefaRow } from "./types.ts";

/**
 * Gerenciador de Fila FIFO com prioridade (1 = máxima, 10 = mínima) persistida em SQLite.
 * Todas as mutações gravam eventos imutáveis em eventos_orquestracao dentro da mesma transação.
 */
export class FifoQueueManager {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private registrarEvento(
    comandoId: string,
    agregadoId: string,
    tipoEvento: string,
    payload: Record<string, unknown>
  ): void {
    const stmt = this.db.connection.prepare(`
      INSERT INTO eventos_orquestracao (
        evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
      ) VALUES (?, ?, 'tarefa', ?, ?, ?, ?);
    `);
    stmt.run(
      randomUUID(),
      comandoId,
      agregadoId,
      tipoEvento,
      new Date().toISOString(),
      JSON.stringify(payload)
    );
  }

  /**
   * Enfileira uma nova tarefa criativa com garantia de persistência e ordem por prioridade.
   */
  public enqueueTask(input: EnqueueTaskInput): TarefaRegistro {
    const tarefaId = input.tarefa_id ?? randomUUID();
    const comandoId = input.comando_id ?? randomUUID();
    const agora = new Date().toISOString();
    const prioridade = Math.max(1, Math.min(10, Math.round(input.prioridade ?? 5)));
    const canalOrigem = input.canal_origem ?? "web";
    const payloadJson = JSON.stringify(input.payload ?? {});

    return this.db.runInTransaction(() => {
      const insertStmt = this.db.connection.prepare(`
        INSERT INTO projecao_tarefas (
          tarefa_id, agente_id, canal_origem, tipo, titulo, prioridade,
          status, payload_json, resultado_json, erro_detalhes, tentativas,
          criado_em, atualizado_em, concluido_em
        ) VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, NULL, NULL, 0, ?, ?, NULL);
      `);
      insertStmt.run(
        tarefaId,
        input.agente_id ?? null,
        canalOrigem,
        input.tipo,
        input.titulo,
        prioridade,
        payloadJson,
        agora,
        agora
      );

      this.registrarEvento(comandoId, tarefaId, "tarefa_criada", {
        tipo: input.tipo,
        titulo: input.titulo,
        prioridade,
        canal_origem: canalOrigem,
      });

      const created = this.getTask(tarefaId);
      if (!created) {
        throw new Error(`Falha inesperada ao recuperar tarefa recém-criada: ${tarefaId}`);
      }
      return created;
    });
  }

  /**
   * Desenfileira atomicamente a próxima tarefa pendente respeitando ORDER BY prioridade ASC, criado_em ASC.
   */
  public dequeueNextTask(): TarefaRegistro | null {
    return this.db.runInTransaction(() => {
      const selectStmt = this.db.connection.prepare(`
        SELECT * FROM projecao_tarefas
        WHERE status = 'pendente'
        ORDER BY prioridade ASC, criado_em ASC
        LIMIT 1;
      `);
      const row = selectStmt.get() as TarefaRow | undefined;
      if (!row) {
        return null;
      }

      const agora = new Date().toISOString();
      const updateStmt = this.db.connection.prepare(`
        UPDATE projecao_tarefas
        SET status = 'executando',
            atualizado_em = ?
        WHERE tarefa_id = ? AND status = 'pendente';
      `);
      const info = updateStmt.run(agora, row.tarefa_id);
      if (info.changes === 0) {
        return null;
      }

      this.registrarEvento(randomUUID(), row.tarefa_id, "tarefa_iniciada", {
        prioridade: row.prioridade,
        tentativas: row.tentativas,
      });

      return this.getTask(row.tarefa_id);
    });
  }

  /**
   * Atualiza o status de uma tarefa e registra resultado ou erro dentro de transação atômica.
   */
  public updateTaskStatus(
    tarefaId: string,
    status: StatusTarefa,
    result?: Record<string, unknown> | null,
    errorDetails?: string | null
  ): TarefaRegistro {
    return this.db.runInTransaction(() => {
      const existing = this.getTask(tarefaId);
      if (!existing) {
        throw new Error(`Tarefa não encontrada: ${tarefaId}`);
      }

      const agora = new Date().toISOString();
      const concluidoEm =
        status === "concluido" || status === "falha" || status === "cancelado" ? agora : null;
      const resultadoJson = result === undefined ? existing.resultado ? JSON.stringify(existing.resultado) : null : result ? JSON.stringify(result) : null;
      const erroTexto = errorDetails === undefined ? existing.erro_detalhes : errorDetails;

      const stmt = this.db.connection.prepare(`
        UPDATE projecao_tarefas
        SET status = ?,
            resultado_json = ?,
            erro_detalhes = ?,
            atualizado_em = ?,
            concluido_em = ?
        WHERE tarefa_id = ?;
      `);
      stmt.run(status, resultadoJson, erroTexto, agora, concluidoEm, tarefaId);

      this.registrarEvento(randomUUID(), tarefaId, `tarefa_status_${status}`, {
        status_anterior: existing.status,
        status_novo: status,
        erro_detalhes: erroTexto ?? null,
      });

      const updated = this.getTask(tarefaId);
      if (!updated) {
        throw new Error(`Falha ao recarregar tarefa atualizada: ${tarefaId}`);
      }
      return updated;
    });
  }

  /**
   * Cancela uma tarefa pendente, em execução ou aguardando aprovação.
   */
  public cancelTask(tarefaId: string, motivo = "Cancelado pelo usuário"): TarefaRegistro {
    return this.updateTaskStatus(tarefaId, "cancelado", null, motivo);
  }

  /**
   * Reenfileira uma tarefa falhada ou cancelada voltando para 'pendente' e incrementando tentativas.
   */
  public retryTask(tarefaId: string): TarefaRegistro {
    return this.db.runInTransaction(() => {
      const existing = this.getTask(tarefaId);
      if (!existing) {
        throw new Error(`Tarefa não encontrada para reprocessamento: ${tarefaId}`);
      }

      const agora = new Date().toISOString();
      const stmt = this.db.connection.prepare(`
        UPDATE projecao_tarefas
        SET status = 'pendente',
            erro_detalhes = NULL,
            tentativas = tentativas + 1,
            atualizado_em = ?,
            concluido_em = NULL
        WHERE tarefa_id = ?;
      `);
      stmt.run(agora, tarefaId);

      this.registrarEvento(randomUUID(), tarefaId, "tarefa_reenfileirada", {
        tentativas: existing.tentativas + 1,
      });

      const updated = this.getTask(tarefaId);
      if (!updated) {
        throw new Error(`Falha ao recarregar tarefa reenfileirada: ${tarefaId}`);
      }
      return updated;
    });
  }

  /**
   * Obtém uma tarefa por ID.
   */
  public getTask(tarefaId: string): TarefaRegistro | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_tarefas WHERE tarefa_id = ?;")
      .get(tarefaId) as TarefaRow | undefined;
    return row ? mapTarefaRow(row) : null;
  }

  /**
   * Lista tarefas com filtro opcional de status mantendo ordenação de fila/recência.
   */
  public listTasks(status?: StatusTarefa, limit = 100): TarefaRegistro[] {
    const safeLimit = Math.max(1, Math.min(500, limit));
    if (status) {
      const rows = this.db.connection
        .prepare(
          `SELECT * FROM projecao_tarefas WHERE status = ? ORDER BY prioridade ASC, criado_em ASC LIMIT ?;`
        )
        .all(status, safeLimit) as unknown as TarefaRow[];
      return rows.map(mapTarefaRow);
    }

    const rows = this.db.connection
      .prepare(`SELECT * FROM projecao_tarefas ORDER BY prioridade ASC, criado_em ASC LIMIT ?;`)
      .all(safeLimit) as unknown as TarefaRow[];
    return rows.map(mapTarefaRow);
  }
}
