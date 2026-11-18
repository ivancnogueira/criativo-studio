import { randomUUID } from "node:crypto";
import type {
  AnexoChat,
  FilaChatEntrega,
  FilaChatSnapshot,
  FilaChatStatus,
  ModoMensagemOcupado,
  MotivoSteerFallback,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

interface FilaChatRow {
  entrega_id: string;
  mensagem_id: string;
  agente_id: string;
  thread_id: string | null;
  remetente_tipo: "usuario" | "agente" | "rotina" | "webhook";
  remetente_agente_id: string | null;
  rotina_id: string | null;
  run_id: string | null;
  conteudo_markdown: string;
  anexos_json: string;
  resposta_para_mensagem_id: string | null;
  status: FilaChatStatus;
  posicao: number | null;
  turno_id: string | null;
  erro: string | null;
  editando: number;
  edit_id: string | null;
  espera_resposta: number;
  steer_fallback: MotivoSteerFallback | null;
  chave_idempotencia: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface EnqueueChatDeliveryInput {
  entregaId?: string;
  mensagemId: string;
  agenteId: string;
  threadId?: string | null;
  remetenteTipo: "usuario" | "agente" | "rotina" | "webhook";
  remetenteAgenteId?: string | null;
  rotinaId?: string | null;
  runId?: string | null;
  conteudoMarkdown: string;
  anexos?: AnexoChat[];
  respostaParaMensagemId?: string | null;
  esperaResposta?: boolean;
  chaveIdempotencia?: string | null;
}

export type EditQueueResult =
  | { ok: true; entrega: FilaChatEntrega }
  | { ok: false; conflict: true; motivo: string };

/**
 * Store transacional para a fila granular de mensagens no chat por lane (agente_id, thread_id).
 */
export class ChatQueueStore {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private mapRow(row: FilaChatRow): FilaChatEntrega {
    return {
      entrega_id: row.entrega_id,
      mensagem_id: row.mensagem_id,
      agente_id: row.agente_id,
      thread_id: row.thread_id,
      remetente_tipo: row.remetente_tipo,
      remetente_agente_id: row.remetente_agente_id,
      rotina_id: row.rotina_id,
      conteudo_markdown: row.conteudo_markdown,
      anexos: this.safeJsonParse<AnexoChat[]>(row.anexos_json, []),
      resposta_para_mensagem_id: row.resposta_para_mensagem_id,
      status: row.status,
      posicao: row.posicao,
      turno_id: row.turno_id,
      erro: row.erro,
      editando: row.editando === 1,
      espera_resposta: row.espera_resposta === 1,
      steer_fallback: row.steer_fallback ?? null,
      criado_em: row.criado_em,
    };
  }

  public enqueue(input: EnqueueChatDeliveryInput): FilaChatEntrega {
    const normalizedThreadId = input.threadId && !input.threadId.startsWith("main:") ? input.threadId : null;
    const entregaId = input.entregaId ?? `ent-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();

    return this.db.runInTransaction(() => {
      if (input.chaveIdempotencia) {
        const existing = this.db.connection
          .prepare("SELECT * FROM projecao_fila_chat WHERE chave_idempotencia = ? LIMIT 1;")
          .get(input.chaveIdempotencia) as FilaChatRow | undefined;
        if (existing) {
          return this.mapRow(existing);
        }
      }

      const maxPosRow = this.db.connection
        .prepare(
          `
          SELECT COALESCE(MAX(posicao), -1) AS max_pos
          FROM projecao_fila_chat
          WHERE agente_id = ?
            AND ((? IS NULL AND thread_id IS NULL) OR thread_id = ?)
            AND status IN ('enfileirada', 'iniciando', 'executando');
        `,
        )
        .get(input.agenteId, normalizedThreadId, normalizedThreadId) as { max_pos: number };
      const nextPos = maxPosRow.max_pos + 1;

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_fila_chat (
            entrega_id, mensagem_id, agente_id, thread_id, remetente_tipo,
            remetente_agente_id, rotina_id, run_id, conteudo_markdown, anexos_json,
            resposta_para_mensagem_id, status, posicao, turno_id, erro, editando, edit_id,
            espera_resposta, steer_fallback, chave_idempotencia, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enfileirada', ?, NULL, NULL, 0, NULL, ?, NULL, ?, ?, ?);
        `,
        )
        .run(
          entregaId,
          input.mensagemId,
          input.agenteId,
          normalizedThreadId,
          input.remetenteTipo,
          input.remetenteAgenteId ?? null,
          input.rotinaId ?? null,
          input.runId ?? null,
          input.conteudoMarkdown,
          JSON.stringify(input.anexos ?? []),
          input.respostaParaMensagemId ?? null,
          nextPos,
          input.esperaResposta === false ? 0 : 1,
          input.chaveIdempotencia ?? null,
          agora,
          agora,
        );

      return this.getDelivery(entregaId)!;
    });
  }

  public getDelivery(entregaId: string): FilaChatEntrega | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_fila_chat WHERE entrega_id = ?;")
      .get(entregaId) as FilaChatRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listLane(agenteId: string, threadId: string | null): FilaChatEntrega[] {
    const normalizedThreadId = threadId && !threadId.startsWith("main:") ? threadId : null;
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_fila_chat
        WHERE agente_id = ?
          AND ((? IS NULL AND thread_id IS NULL) OR thread_id = ?)
          AND status IN ('enfileirada', 'iniciando', 'executando')
        ORDER BY CASE WHEN status = 'executando' THEN 0 WHEN status = 'iniciando' THEN 1 ELSE 2 END,
                 COALESCE(posicao, 999999) ASC, criado_em ASC;
      `,
      )
      .all(agenteId, normalizedThreadId, normalizedThreadId) as unknown as FilaChatRow[];
    return rows.map((row) => this.mapRow(row));
  }

  public getSnapshot(
    agenteId: string,
    threadId: string | null,
    modoOcupado: ModoMensagemOcupado = "steer",
    suportaSteerNativo = false,
  ): FilaChatSnapshot {
    const normalizedThreadId = threadId && !threadId.startsWith("main:") ? threadId : null;
    return {
      agente_id: agenteId,
      thread_id: normalizedThreadId,
      modo_ocupado: modoOcupado,
      suporta_steer_nativo: suportaSteerNativo,
      entregas: this.listLane(agenteId, normalizedThreadId),
    };
  }

  public listRunningTurnDeliveries(agenteId: string, turnoId: string): FilaChatEntrega[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_fila_chat
        WHERE agente_id = ? AND turno_id = ? AND status IN ('iniciando', 'executando')
        ORDER BY criado_em ASC;
      `,
      )
      .all(agenteId, turnoId) as unknown as FilaChatRow[];
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Seleciona atomicamente a próxima entrega enfileirada da lane com trava editando = 0.
   */
  public dequeueNextForLane(agenteId: string, threadId: string | null): FilaChatEntrega | null {
    const normalizedThreadId = threadId && !threadId.startsWith("main:") ? threadId : null;
    return this.db.runInTransaction(() => {
      const candidate = this.db.connection
        .prepare(
          `
          SELECT * FROM projecao_fila_chat
          WHERE agente_id = ?
            AND ((? IS NULL AND thread_id IS NULL) OR thread_id = ?)
            AND status = 'enfileirada'
            AND editando = 0
          ORDER BY COALESCE(posicao, 999999) ASC, criado_em ASC
          LIMIT 1;
        `,
        )
        .get(agenteId, normalizedThreadId, normalizedThreadId) as FilaChatRow | undefined;

      if (!candidate) {
        return null;
      }

      const agora = new Date().toISOString();
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET status = 'iniciando', atualizado_em = ?
          WHERE entrega_id = ? AND status = 'enfileirada' AND editando = 0;
        `,
        )
        .run(agora, candidate.entrega_id);

      if (info.changes === 0) {
        return null;
      }
      return this.getDelivery(candidate.entrega_id);
    });
  }

  public beginEdit(entregaId: string, editId: string): EditQueueResult {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const row = this.db.connection
        .prepare("SELECT * FROM projecao_fila_chat WHERE entrega_id = ?;")
        .get(entregaId) as FilaChatRow | undefined;
      if (!row || row.status !== "enfileirada") {
        return {
          ok: false,
          conflict: true,
          motivo: "A mensagem já saiu da fila ou foi cancelada antes de abrir edição.",
        };
      }
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET editando = 1, edit_id = ?, atualizado_em = ?
          WHERE entrega_id = ? AND status = 'enfileirada';
        `,
        )
        .run(editId, agora, entregaId);
      if (info.changes === 0) {
        return {
          ok: false,
          conflict: true,
          motivo: "Conflito concorrente ao travar mensagem para edição.",
        };
      }
      return { ok: true, entrega: this.getDelivery(entregaId)! };
    });
  }

  public retainAttachments(entregaId: string, editId: string, anexos: AnexoChat[]): EditQueueResult {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET anexos_json = ?, atualizado_em = ?
          WHERE entrega_id = ? AND status = 'enfileirada' AND editando = 1 AND edit_id = ?;
        `,
        )
        .run(JSON.stringify(anexos), agora, entregaId, editId);
      if (info.changes === 0) {
        return {
          ok: false,
          conflict: true,
          motivo: "Edição expirada ou mensagem já processada.",
        };
      }
      return { ok: true, entrega: this.getDelivery(entregaId)! };
    });
  }

  public saveEdit(
    entregaId: string,
    editId: string,
    conteudo: string,
    anexos?: AnexoChat[],
  ): EditQueueResult {
    return this.db.runInTransaction(() => {
      const row = this.db.connection
        .prepare("SELECT * FROM projecao_fila_chat WHERE entrega_id = ?;")
        .get(entregaId) as FilaChatRow | undefined;
      if (!row || row.status !== "enfileirada" || row.edit_id !== editId) {
        return {
          ok: false,
          conflict: true,
          motivo: "Não foi possível salvar: a mensagem já foi iniciada ou cancelada.",
        };
      }
      const agora = new Date().toISOString();
      const nextAnexos = anexos !== undefined ? JSON.stringify(anexos) : row.anexos_json;
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET conteudo_markdown = ?,
              anexos_json = ?,
              editando = 0,
              edit_id = NULL,
              atualizado_em = ?
          WHERE entrega_id = ? AND status = 'enfileirada' AND edit_id = ?;
        `,
        )
        .run(conteudo, nextAnexos, agora, entregaId, editId);
      if (info.changes === 0) {
        return {
          ok: false,
          conflict: true,
          motivo: "Conflito concorrente ao salvar edição da mensagem na fila.",
        };
      }
      return { ok: true, entrega: this.getDelivery(entregaId)! };
    });
  }

  public cancelEdit(entregaId: string, editId?: string | null): EditQueueResult {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const info = editId
        ? this.db.connection
            .prepare(
              `
              UPDATE projecao_fila_chat
              SET editando = 0, edit_id = NULL, atualizado_em = ?
              WHERE entrega_id = ? AND status = 'enfileirada' AND edit_id = ?;
            `,
            )
            .run(agora, entregaId, editId)
        : this.db.connection
            .prepare(
              `
              UPDATE projecao_fila_chat
              SET editando = 0, edit_id = NULL, atualizado_em = ?
              WHERE entrega_id = ? AND status = 'enfileirada';
            `,
            )
            .run(agora, entregaId);
      if (info.changes === 0) {
        return {
          ok: false,
          conflict: true,
          motivo: "A mensagem não está mais disponível para cancelar edição.",
        };
      }
      return { ok: true, entrega: this.getDelivery(entregaId)! };
    });
  }

  public reorderLane(
    agenteId: string,
    threadId: string | null,
    entregaIds: string[],
  ): FilaChatEntrega[] {
    const normalizedThreadId = threadId && !threadId.startsWith("main:") ? threadId : null;
    return this.db.runInTransaction(() => {
      const currentRows = this.db.connection
        .prepare(
          `
          SELECT entrega_id FROM projecao_fila_chat
          WHERE agente_id = ?
            AND ((? IS NULL AND thread_id IS NULL) OR thread_id = ?)
            AND status = 'enfileirada'
          ORDER BY COALESCE(posicao, 999999) ASC, criado_em ASC;
        `,
        )
        .all(agenteId, normalizedThreadId, normalizedThreadId) as Array<{ entrega_id: string }>;

      const validIds = new Set(currentRows.map((r) => r.entrega_id));
      const seen = new Set<string>();
      const ordered: string[] = [];

      for (const id of entregaIds) {
        if (validIds.has(id) && !seen.has(id)) {
          ordered.push(id);
          seen.add(id);
        }
      }
      for (const row of currentRows) {
        if (!seen.has(row.entrega_id)) {
          ordered.push(row.entrega_id);
        }
      }

      const agora = new Date().toISOString();
      const stmt = this.db.connection.prepare(
        "UPDATE projecao_fila_chat SET posicao = ?, atualizado_em = ? WHERE entrega_id = ?;",
      );
      ordered.forEach((id, idx) => {
        stmt.run(idx, agora, id);
      });

      return this.listLane(agenteId, normalizedThreadId);
    });
  }

  public markRunning(entregaId: string, turnoId: string): FilaChatEntrega | null {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET status = 'executando', turno_id = ?, editando = 0, edit_id = NULL, atualizado_em = ?
          WHERE entrega_id = ?;
        `,
        )
        .run(turnoId, agora, entregaId);
      return this.getDelivery(entregaId);
    });
  }

  public markFinished(
    entregaId: string,
    status: "concluida" | "falha" | "interrompida" | "cancelada",
    erro?: string | null,
  ): FilaChatEntrega | null {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET status = ?, erro = ?, editando = 0, edit_id = NULL, atualizado_em = ?
          WHERE entrega_id = ?;
        `,
        )
        .run(status, erro ?? null, agora, entregaId);
      return this.getDelivery(entregaId);
    });
  }

  public markSteerFallback(entregaId: string, reason: MotivoSteerFallback): FilaChatEntrega | null {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET steer_fallback = ?, atualizado_em = ?
          WHERE entrega_id = ?;
        `,
        )
        .run(reason, agora, entregaId);
      return this.getDelivery(entregaId);
    });
  }

  public cancelDelivery(entregaId: string): boolean {
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const info = this.db.connection
        .prepare(
          `
          UPDATE projecao_fila_chat
          SET status = 'cancelada', editando = 0, edit_id = NULL, atualizado_em = ?
          WHERE entrega_id = ? AND status IN ('enfileirada', 'iniciando');
        `,
        )
        .run(agora, entregaId);
      return info.changes > 0;
    });
  }

  public deleteDelivery(entregaId: string): boolean {
    return this.db.runInTransaction(() => {
      const info = this.db.connection
        .prepare("DELETE FROM projecao_fila_chat WHERE entrega_id = ?;")
        .run(entregaId);
      return info.changes > 0;
    });
  }
}
