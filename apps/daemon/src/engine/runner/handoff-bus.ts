import { randomUUID } from "node:crypto";
import type { TipoMensagemCanal } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";

export interface HandoffInput {
  tarefa_id: string;
  de_agente_id: string;
  para_agente_id: string;
  instrucao: string;
  artefatos?: string[];
  enfileirarNovaTarefa?: boolean;
  tipoProximaTarefa?: string;
  prioridade?: number;
}

export interface CanalMensagemRow {
  mensagem_id: string;
  tarefa_id: string | null;
  de_agente_id: string;
  para_agente_id: string | null;
  tipo_mensagem: TipoMensagemCanal;
  conteudo: string;
  artefatos_json: string;
  enviado_em: string;
}

/**
 * Barramento inter-agentes: registra passagens de bastão em `projecao_canal_mensagens`,
 * audita em `eventos_orquestracao` e opcionalmente despacha a próxima tarefa na fila FIFO.
 */
export class HandoffBus {
  private readonly db: CriativoDatabase;
  private readonly queue: FifoQueueManager;

  constructor(db: CriativoDatabase, queue: FifoQueueManager) {
    this.db = db;
    this.queue = queue;
  }

  public postChannelMessage(params: {
    tarefa_id?: string | null;
    de_agente_id: string;
    para_agente_id?: string | null;
    tipo_mensagem: TipoMensagemCanal;
    conteudo: string;
    artefatos?: string[];
  }): CanalMensagemRow {
    const mensagemId = randomUUID();
    const agora = new Date().toISOString();
    const artefatosJson = JSON.stringify(params.artefatos ?? []);

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_canal_mensagens (
            mensagem_id, tarefa_id, de_agente_id, para_agente_id,
            tipo_mensagem, conteudo, artefatos_json, enviado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `
        )
        .run(
          mensagemId,
          params.tarefa_id ?? null,
          params.de_agente_id,
          params.para_agente_id ?? null,
          params.tipo_mensagem,
          params.conteudo,
          artefatosJson,
          agora
        );
    });

    return this.db.connection
      .prepare(`SELECT * FROM projecao_canal_mensagens WHERE mensagem_id = ?;`)
      .get(mensagemId) as unknown as CanalMensagemRow;
  }

  public dispatchHandoff(input: HandoffInput): {
    mensagem: CanalMensagemRow;
    proximaTarefaId: string | null;
  } {
    const mensagem = this.postChannelMessage({
      tarefa_id: input.tarefa_id,
      de_agente_id: input.de_agente_id,
      para_agente_id: input.para_agente_id,
      tipo_mensagem: "handoff",
      conteudo: input.instrucao,
      artefatos: input.artefatos ?? [],
    });

    this.db.connection
      .prepare(
        `
        INSERT INTO eventos_orquestracao (
          evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
        ) VALUES (?, ?, 'canal', ?, 'handoff_agentes', ?, ?);
      `
      )
      .run(
        randomUUID(),
        randomUUID(),
        input.tarefa_id,
        new Date().toISOString(),
        JSON.stringify({
          de: input.de_agente_id,
          para: input.para_agente_id,
          artefatos: input.artefatos ?? [],
        })
      );

    let proximaTarefaId: string | null = null;
    if (input.enfileirarNovaTarefa) {
      const nextTask = this.queue.enqueueTask({
        agente_id: input.para_agente_id,
        tipo: input.tipoProximaTarefa ?? "carrossel",
        titulo: `Handoff [${input.de_agente_id} -> ${input.para_agente_id}]`,
        prioridade: input.prioridade ?? 3,
        payload: {
          tarefa_origem_id: input.tarefa_id,
          instrucao: input.instrucao,
          artefatos: input.artefatos ?? [],
        },
      });
      proximaTarefaId = nextTask.tarefa_id;
    }

    return { mensagem, proximaTarefaId };
  }

  public listTaskMessages(tarefaId: string): CanalMensagemRow[] {
    return this.db.connection
      .prepare(
        `SELECT * FROM projecao_canal_mensagens WHERE tarefa_id = ? ORDER BY enviado_em ASC;`
      )
      .all(tarefaId) as unknown as CanalMensagemRow[];
  }
}
