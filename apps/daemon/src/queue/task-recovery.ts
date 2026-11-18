import { randomUUID } from "node:crypto";
import type { CriativoDatabase } from "../database/client.ts";
import type { RecoveryReport, TarefaRow } from "./types.ts";

const MAX_TENTATIVAS_CRASH = 3;

/**
 * Executa no boot do daemon para localizar tarefas órfãs deixadas no estado 'executando'
 * após desligamento abrupto, crash ou reinício da VPS.
 */
export function recoverInterruptedTasks(db: CriativoDatabase): RecoveryReport {
  return db.runInTransaction(() => {
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_tarefas WHERE status = 'executando' ORDER BY criado_em ASC;`)
      .all() as unknown as TarefaRow[];

    const reenfileiradas: string[] = [];
    const marcadasFalha: string[] = [];
    const agora = new Date().toISOString();

    const updateRequeue = db.connection.prepare(`
      UPDATE projecao_tarefas
      SET status = 'pendente',
          tentativas = ?,
          erro_detalhes = ?,
          atualizado_em = ?
      WHERE tarefa_id = ?;
    `);

    const updateFailed = db.connection.prepare(`
      UPDATE projecao_tarefas
      SET status = 'falha',
          tentativas = ?,
          erro_detalhes = ?,
          atualizado_em = ?,
          concluido_em = ?
      WHERE tarefa_id = ?;
    `);

    const insertEvent = db.connection.prepare(`
      INSERT INTO eventos_orquestracao (
        evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
      ) VALUES (?, ?, 'tarefa', ?, ?, ?, ?);
    `);

    const comandoId = randomUUID();

    for (const row of rows) {
      const novasTentativas = row.tentativas + 1;
      if (novasTentativas < MAX_TENTATIVAS_CRASH) {
        const aviso = `Interrupção inesperada detectada na reinicialização do daemon; tarefa devolvida para fila (tentativa ${novasTentativas}/${MAX_TENTATIVAS_CRASH}).`;
        updateRequeue.run(novasTentativas, aviso, agora, row.tarefa_id);
        reenfileiradas.push(row.tarefa_id);

        insertEvent.run(
          randomUUID(),
          comandoId,
          row.tarefa_id,
          "crash_recovery_reenfileirada",
          agora,
          JSON.stringify({ tentativas: novasTentativas, aviso })
        );
      } else {
        const erro = `Tarefa interrompida abruptamente ${novasTentativas} vezes (limite de segurança ${MAX_TENTATIVAS_CRASH} atingido). Intervenção manual requerida.`;
        updateFailed.run(novasTentativas, erro, agora, agora, row.tarefa_id);
        marcadasFalha.push(row.tarefa_id);

        insertEvent.run(
          randomUUID(),
          comandoId,
          row.tarefa_id,
          "crash_recovery_falha",
          agora,
          JSON.stringify({ tentativas: novasTentativas, erro })
        );
      }
    }

    // Libera qualquer agente que tenha ficado travado em 'trabalhando' antes da queda abrupta
    db.connection
      .prepare(`UPDATE projecao_agentes SET status = 'ocioso', atualizado_em = ? WHERE status = 'trabalhando';`)
      .run(agora);

    // Fase 13: recupera threads paralelas e entregas de fila interrompidas por queda sem perder esperas nem histórico
    const threadsReset = db.connection
      .prepare(
        `
        UPDATE projecao_agente_threads
        SET estado = 'ociosa',
            desfecho = 'interrompida',
            turno_ativo_id = NULL,
            progresso_atual = 'Interrompida durante reinicialização do sistema',
            atualizado_em = ?
        WHERE estado = 'executando';
      `,
      )
      .run(agora);

    const filaReset = db.connection
      .prepare(
        `
        UPDATE projecao_fila_chat
        SET status = 'interrompida',
            editando = 0,
            edit_id = NULL,
            erro = 'Execução interrompida durante reinicialização do daemon.',
            atualizado_em = ?
        WHERE status IN ('iniciando', 'executando');
      `,
      )
      .run(agora);

    db.connection
      .prepare(
        `
        UPDATE projecao_fila_chat
        SET editando = 0,
            edit_id = NULL,
            atualizado_em = ?
        WHERE status = 'enfileirada' AND editando = 1;
      `,
      )
      .run(agora);

    return {
      totalInterrompidas: rows.length,
      reenfileiradas,
      marcadasFalha,
      threadsInterrompidas: Number(threadsReset.changes),
      entregasFilaInterrompidas: Number(filaReset.changes),
    };
  });
}
