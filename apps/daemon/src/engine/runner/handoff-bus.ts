import { randomUUID } from "node:crypto";
import type {
  SendMessageInterAgenteInput,
  SendMessageInterAgenteResult,
  TipoMensagemCanal,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import { ROSTER_15_AGENTES } from "./roster-defaults.ts";

export const MAX_SEND_MESSAGE_RECIPIENTS = 32;
export const MAX_SEND_MESSAGE_TEXT_CHARS = 100_000;
export const MAX_SEND_MESSAGE_PATHS = 10;
export const MAX_INTER_AGENT_HOP_DEPTH = 12;

export interface HandoffInput {
  tarefa_id?: string | null;
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
  reply_to_message_id?: string | null;
  expects_reply?: number;
  thread_origem_id?: string | null;
  status_entrega?: "enfileirada" | "entregue_steer" | "respondida" | "sem_resposta_necessaria";
}

export interface SendMessageAsyncContext extends SendMessageInterAgenteInput {
  senderAgentId: string;
  sourceCanalId: string;
  sourceThreadId?: string | null;
  tarefaId?: string | null;
  hopDepth?: number;
  wsHub?: WebSocketHub;
  isAgentBusy?: (agenteId: string) => { busy: boolean; policy: "steer" | "queue" };
  onSteerMessage?: (recipientId: string, row: CanalMensagemRow) => void;
  onDispatchQueued?: (recipientId: string, row: CanalMensagemRow, nextHopDepth: number) => void;
}

/**
 * Barramento inter-agentes: registra passagens de bastão em `projecao_canal_mensagens`,
 * audita em `eventos_orquestracao` e suporta mensageria assíncrona multi-agente (`send_message` — CHAT-04).
 */
export class HandoffBus {
  private readonly db: CriativoDatabase;
  private readonly queue: FifoQueueManager;
  private wsHub?: WebSocketHub;

  constructor(db: CriativoDatabase, queue: FifoQueueManager, wsHub?: WebSocketHub) {
    this.db = db;
    this.queue = queue;
    this.wsHub = wsHub;
  }

  public setWebSocketHub(wsHub: WebSocketHub): void {
    this.wsHub = wsHub;
  }

  private agentExists(agenteId: string): boolean {
    if (ROSTER_15_AGENTES.some((a) => a.agente_id === agenteId)) {
      return true;
    }
    const row = this.db.connection
      .prepare("SELECT 1 AS ok FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(agenteId) as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  public postChannelMessage(params: {
    tarefa_id?: string | null;
    de_agente_id: string;
    para_agente_id?: string | null;
    tipo_mensagem: TipoMensagemCanal;
    conteudo: string;
    artefatos?: string[];
    reply_to_message_id?: string | null;
    expects_reply?: boolean;
    thread_origem_id?: string | null;
    status_entrega?: "enfileirada" | "entregue_steer" | "respondida" | "sem_resposta_necessaria";
  }): CanalMensagemRow {
    const mensagemId = randomUUID();
    const agora = new Date().toISOString();
    const artefatosJson = JSON.stringify(params.artefatos ?? []);
    const expectsReplyInt = params.expects_reply === false ? 0 : 1;
    const statusEntrega =
      params.status_entrega ??
      (params.expects_reply === false ? "sem_resposta_necessaria" : "enfileirada");

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_canal_mensagens (
            mensagem_id, tarefa_id, de_agente_id, para_agente_id,
            tipo_mensagem, conteudo, artefatos_json, enviado_em,
            reply_to_message_id, expects_reply, thread_origem_id, status_entrega
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        )
        .run(
          mensagemId,
          params.tarefa_id ?? null,
          params.de_agente_id,
          params.para_agente_id ?? null,
          params.tipo_mensagem,
          params.conteudo,
          artefatosJson,
          agora,
          params.reply_to_message_id ?? null,
          expectsReplyInt,
          params.thread_origem_id ?? null,
          statusEntrega,
        );
    });

    return this.db.connection
      .prepare("SELECT * FROM projecao_canal_mensagens WHERE mensagem_id = ?;")
      .get(mensagemId) as unknown as CanalMensagemRow;
  }

  public dispatchHandoff(input: HandoffInput): {
    mensagem: CanalMensagemRow;
    proximaTarefaId: string | null;
  } {
    const mensagem = this.postChannelMessage({
      tarefa_id: input.tarefa_id ?? null,
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
      `,
      )
      .run(
        randomUUID(),
        randomUUID(),
        input.tarefa_id ?? mensagem.mensagem_id,
        new Date().toISOString(),
        JSON.stringify({
          de: input.de_agente_id,
          para: input.para_agente_id,
          artefatos: input.artefatos ?? [],
        }),
      );

    let proximaTarefaId: string | null = null;
    if (input.enfileirarNovaTarefa) {
      const nextTask = this.queue.enqueueTask({
        agente_id: input.para_agente_id,
        tipo: input.tipoProximaTarefa ?? "carrossel",
        titulo: `Handoff [${input.de_agente_id} -> ${input.para_agente_id}]`,
        prioridade: input.prioridade ?? 3,
        payload: {
          tarefa_origem_id: input.tarefa_id ?? null,
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
      .prepare("SELECT * FROM projecao_canal_mensagens WHERE tarefa_id = ? ORDER BY enviado_em ASC;")
      .all(tarefaId) as unknown as CanalMensagemRow[];
  }

  public listOpenInboundRequests(recipientAgentId: string): Array<{
    mensagem_id: string;
    de_agente_id: string;
    trecho: string;
    thread_origem_id: string | null;
    criado_em: string;
  }> {
    const rows = this.db.connection
      .prepare(
        `SELECT mensagem_id, de_agente_id, conteudo, thread_origem_id, enviado_em
         FROM projecao_canal_mensagens
         WHERE para_agente_id = ?
           AND expects_reply = 1
           AND status_entrega IN ('enfileirada', 'entregue_steer')
         ORDER BY enviado_em DESC
         LIMIT 15;`,
      )
      .all(recipientAgentId) as Array<{
      mensagem_id: string;
      de_agente_id: string;
      conteudo: string;
      thread_origem_id: string | null;
      enviado_em: string;
    }>;

    return rows.map((r) => ({
      mensagem_id: r.mensagem_id,
      de_agente_id: r.de_agente_id,
      trecho: r.conteudo.slice(0, 140),
      thread_origem_id: r.thread_origem_id,
      criado_em: r.enviado_em,
    }));
  }

  public markRequestAnswered(mensagemId: string): void {
    this.db.connection
      .prepare("UPDATE projecao_canal_mensagens SET status_entrega = 'respondida' WHERE mensagem_id = ?;")
      .run(mensagemId);
  }

  /**
   * Envia mensagem assíncrona estruturada para 1..32 agentes (`send_message` — CHAT-04),
   * com suporte a `expectsReply`, `replyToMessageId`, roteamento `steer` vs `queue` e proteção `hopDepth <= 12`.
   */
  public sendMessageAsync(input: SendMessageAsyncContext): SendMessageInterAgenteResult {
    const hopDepth = input.hopDepth ?? 0;
    if (hopDepth >= MAX_INTER_AGENT_HOP_DEPTH) {
      throw new Error(
        `Profundidade máxima de delegação entre agentes (${MAX_INTER_AGENT_HOP_DEPTH} saltos) atingida para prevenir loop infinito.`,
      );
    }

    if (!Array.isArray(input.recipientAgentIds) || input.recipientAgentIds.length === 0) {
      throw new Error("Informe pelo menos 1 agente destinatário em recipientAgentIds.");
    }
    if (input.recipientAgentIds.length > MAX_SEND_MESSAGE_RECIPIENTS) {
      throw new Error(
        `Máximo de ${MAX_SEND_MESSAGE_RECIPIENTS} agentes destinatários permitido por chamada.`,
      );
    }

    const seen = new Set<string>();
    const cleanRecipients: string[] = [];
    for (const rawId of input.recipientAgentIds) {
      const id = String(rawId ?? "").trim();
      if (!id) continue;
      if (id === input.senderAgentId) {
        throw new Error("Um agente não pode enviar send_message para si mesmo.");
      }
      if (seen.has(id)) {
        throw new Error(`Agente destinatário duplicado na chamada: '${id}'.`);
      }
      if (!this.agentExists(id)) {
        throw new Error(`Agente destinatário inexistente: '${id}'.`);
      }
      seen.add(id);
      cleanRecipients.push(id);
    }

    if (cleanRecipients.length === 0) {
      throw new Error("Nenhum agente destinatário válido informado.");
    }

    const cleanText = (input.text ?? "").trim();
    if (cleanText.length < 1 || cleanText.length > MAX_SEND_MESSAGE_TEXT_CHARS) {
      throw new Error(
        `O texto de send_message deve ter entre 1 e ${MAX_SEND_MESSAGE_TEXT_CHARS} caracteres.`,
      );
    }

    const cleanPaths = (input.paths ?? []).map((p) => p.trim()).filter(Boolean);
    if (cleanPaths.length > MAX_SEND_MESSAGE_PATHS) {
      throw new Error(`Máximo de ${MAX_SEND_MESSAGE_PATHS} arquivos anexados por send_message.`);
    }

    const expectsReply = input.expectsReply !== false;
    const replyTo = input.replyToMessageId?.trim() || null;
    let effectiveOriginThread = input.sourceThreadId ?? input.sourceCanalId;

    if (replyTo) {
      const originRow = this.db.connection
        .prepare(
          `SELECT mensagem_id, de_agente_id, para_agente_id, thread_origem_id, status_entrega
           FROM projecao_canal_mensagens
           WHERE mensagem_id = ? AND para_agente_id = ?
           LIMIT 1;`,
        )
        .get(replyTo, input.senderAgentId) as
        | {
            mensagem_id: string;
            de_agente_id: string;
            para_agente_id: string;
            thread_origem_id: string | null;
            status_entrega: string;
          }
        | undefined;

      if (!originRow || originRow.status_entrega === "respondida") {
        const pendentes = this.listOpenInboundRequests(input.senderAgentId);
        return {
          ok: false,
          entregas: [],
          corretivo: {
            erro: !originRow
              ? `replyToMessageId '${replyTo}' não encontrado para o agente '${input.senderAgentId}'.`
              : `A solicitação '${replyTo}' já foi respondida anteriormente.`,
            pendentes: pendentes.map((p) => ({
              mensagem_id: p.mensagem_id,
              de_agente_id: p.de_agente_id,
              trecho: p.trecho,
              criado_em: p.criado_em,
            })),
          },
        };
      }

      if (originRow.thread_origem_id) {
        effectiveOriginThread = originRow.thread_origem_id;
      }
      if (!expectsReply) {
        this.markRequestAnswered(replyTo);
      }
    }

    const hub = input.wsHub ?? this.wsHub;
    const entregas: SendMessageInterAgenteResult["entregas"] = [];

    for (const recipientId of cleanRecipients) {
      const busyState = input.isAgentBusy?.(recipientId) ?? { busy: false, policy: "queue" as const };
      const canSteer = busyState.busy && busyState.policy === "steer" && !expectsReply;
      const statusEntrega: CanalMensagemRow["status_entrega"] = canSteer
        ? "entregue_steer"
        : expectsReply
          ? "enfileirada"
          : "sem_resposta_necessaria";

      const row = this.postChannelMessage({
        tarefa_id: input.tarefaId ?? null,
        de_agente_id: input.senderAgentId,
        para_agente_id: recipientId,
        tipo_mensagem: "handoff",
        conteudo: cleanText,
        artefatos: cleanPaths,
        reply_to_message_id: replyTo,
        expects_reply: expectsReply,
        thread_origem_id: effectiveOriginThread,
        status_entrega: statusEntrega,
      });

      const outcome: "steered" | "queued" = canSteer ? "steered" : "queued";
      const queuedBecause: "own-turn" | "recipient-queues" | "idle-dispatched" | undefined =
        canSteer
          ? undefined
          : busyState.busy
            ? busyState.policy === "queue"
              ? "recipient-queues"
              : "own-turn"
            : "idle-dispatched";

      entregas.push({
        mensagem_id: row.mensagem_id,
        para_agente_id: recipientId,
        outcome,
        ...(queuedBecause ? { queuedBecause } : {}),
        reply_to_message_id: replyTo,
        expects_reply: expectsReply,
      });

      hub?.broadcast("agent:message_queued", {
        mensagem_id: row.mensagem_id,
        de_agente_id: input.senderAgentId,
        para_agente_id: recipientId,
        outcome,
        reply_to_message_id: replyTo,
        expects_reply: expectsReply,
      });

      if (canSteer) {
        input.onSteerMessage?.(recipientId, row);
      } else {
        input.onDispatchQueued?.(recipientId, row, hopDepth + 1);
      }
    }

    return {
      ok: true,
      entregas,
    };
  }
}
