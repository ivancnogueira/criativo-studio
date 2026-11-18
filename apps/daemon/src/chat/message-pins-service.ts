import type { MensagemFixada } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";

export const MAX_PINS_PER_THREAD = 50;

export interface MessagePinsServiceDeps {
  db: CriativoDatabase;
  wsHub: WebSocketHub;
}

interface PinJoinedRow {
  thread_id: string;
  agente_id: string;
  mensagem_id: string;
  fixado_em: string;
  fixado_por_tipo: "usuario" | "agente";
  fixado_por_id: string | null;
  fixado_por_nome: string | null;
  thread_titulo: string | null;
  autor: "usuario" | "agente";
  autor_nome: string | null;
  conteudo_markdown: string;
  msg_criado_em: string;
}

/**
 * Gerencia fixação/desafixação de mensagens (`projecao_mensagens_fixadas`) com limite de 50 por thread
 * e proteção estrita para pins criados pelo usuário contra remoção por agentes.
 */
export class MessagePinsService {
  private readonly db: CriativoDatabase;
  private readonly wsHub: WebSocketHub;

  constructor(deps: MessagePinsServiceDeps) {
    this.db = deps.db;
    this.wsHub = deps.wsHub;
  }

  private mapJoinedRow(row: PinJoinedRow): MensagemFixada {
    return {
      thread_id: row.thread_id,
      mensagem_id: row.mensagem_id,
      thread_titulo: row.thread_titulo ?? (row.thread_id.startsWith("main:") ? "Chat principal" : null),
      fixado_em: row.fixado_em,
      fixado_por_tipo: row.fixado_por_tipo,
      fixado_por_id: row.fixado_por_id,
      fixado_por_nome: row.fixado_por_nome,
      autor: row.autor === "usuario" ? "usuario" : "agente",
      autor_nome: row.autor_nome ?? (row.autor === "usuario" ? "Você" : "Agente"),
      conteudo_resumo: row.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 160),
      criado_em: row.msg_criado_em,
    };
  }

  public normalizeThreadId(agenteId: string, threadId?: string | null): string {
    if (!threadId || !threadId.trim()) {
      return `main:${agenteId}`;
    }
    return threadId.trim();
  }

  public listPinsByAgent(agenteId: string): MensagemFixada[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT p.thread_id, p.agente_id, p.mensagem_id, p.fixado_em, p.fixado_por_tipo,
               p.fixado_por_id, p.fixado_por_nome,
               t.titulo AS thread_titulo,
               COALESCE(c.autor, 'agente') AS autor,
               c.autor_nome AS autor_nome,
               COALESCE(c.conteudo_markdown, '') AS conteudo_markdown,
               COALESCE(c.criado_em, p.fixado_em) AS msg_criado_em
        FROM projecao_mensagens_fixadas p
        LEFT JOIN projecao_conversas_chat c ON c.mensagem_id = p.mensagem_id
        LEFT JOIN projecao_agente_threads t ON t.thread_id = p.thread_id
        WHERE p.agente_id = ?
        ORDER BY p.fixado_em DESC;
      `,
      )
      .all(agenteId) as unknown as PinJoinedRow[];
    return rows.map((row) => this.mapJoinedRow(row));
  }

  public listPinsByThread(agenteId: string, threadId: string): MensagemFixada[] {
    const normalized = this.normalizeThreadId(agenteId, threadId);
    return this.listPinsByAgent(agenteId).filter((p) => p.thread_id === normalized);
  }

  public emitPinsChanged(agenteId: string): MensagemFixada[] {
    const pins = this.listPinsByAgent(agenteId);
    this.wsHub.broadcast("pins:changed", {
      agente_id: agenteId,
      pins,
    });
    return pins;
  }

  public pinMessage(input: {
    agenteId: string;
    threadId?: string | null;
    mensagemId: string;
    actorTipo: "usuario" | "agente";
    actorId?: string | null;
  }): { pin: MensagemFixada; count: number } {
    const threadId = this.normalizeThreadId(input.agenteId, input.threadId);
    const canalFallback = threadId === `main:${input.agenteId}` ? `agente:${input.agenteId}` : null;

    const msgRow = this.db.connection
      .prepare(
        `
        SELECT mensagem_id, status, item_type
        FROM projecao_conversas_chat
        WHERE mensagem_id = ?
          AND (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
        LIMIT 1;
      `,
      )
      .get(input.mensagemId, threadId, canalFallback) as
      | { mensagem_id: string; status: string | null; item_type: string | null }
      | undefined;

    if (!msgRow) {
      throw new Error(`Mensagem '${input.mensagemId}' não encontrada na thread '${threadId}'.`);
    }
    if ((msgRow.status ?? "completed") === "streaming") {
      throw new Error("Não é possível fixar uma mensagem enquanto ela ainda está em streaming.");
    }
    if ((msgRow.item_type ?? "mensagem") !== "mensagem") {
      throw new Error("Apenas mensagens comuns da conversa podem ser fixadas.");
    }

    const fixadoPorId = input.actorTipo === "agente" ? (input.actorId ?? input.agenteId) : null;
    const fixadoPorNome = null;
    const agora = new Date().toISOString();

    this.db.runInTransaction(() => {
      const existing = this.db.connection
        .prepare(
          "SELECT 1 AS ok FROM projecao_mensagens_fixadas WHERE thread_id = ? AND mensagem_id = ?;",
        )
        .get(threadId, input.mensagemId);

      if (!existing) {
        const countRow = this.db.connection
          .prepare(
            "SELECT COUNT(*) AS total FROM projecao_mensagens_fixadas WHERE thread_id = ?;",
          )
          .get(threadId) as { total: number };

        if (countRow.total >= MAX_PINS_PER_THREAD) {
          throw new Error(
            `Limite de ${MAX_PINS_PER_THREAD} mensagens fixadas atingido nesta thread. Desafixe uma mensagem antiga antes de fixar outra.`,
          );
        }
      }

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_mensagens_fixadas (
            thread_id, agente_id, mensagem_id, fixado_em, fixado_por_tipo, fixado_por_id, fixado_por_nome
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, mensagem_id) DO UPDATE SET
            fixado_em = excluded.fixado_em,
            fixado_por_tipo = excluded.fixado_por_tipo,
            fixado_por_id = excluded.fixado_por_id,
            fixado_por_nome = excluded.fixado_por_nome;
        `,
        )
        .run(
          threadId,
          input.agenteId,
          input.mensagemId,
          agora,
          input.actorTipo,
          fixadoPorId,
          fixadoPorNome,
        );
    });

    const allPins = this.emitPinsChanged(input.agenteId);
    const threadPins = allPins.filter((p) => p.thread_id === threadId);
    const pin = threadPins.find((p) => p.mensagem_id === input.mensagemId)!;
    return { pin, count: threadPins.length };
  }

  public unpinMessage(input: {
    agenteId: string;
    threadId?: string | null;
    mensagemId: string;
    actorTipo: "usuario" | "agente";
  }): { removed: boolean; count: number } {
    const threadId = this.normalizeThreadId(input.agenteId, input.threadId);
    const existing = this.db.connection
      .prepare(
        "SELECT fixado_por_tipo FROM projecao_mensagens_fixadas WHERE thread_id = ? AND mensagem_id = ?;",
      )
      .get(threadId, input.mensagemId) as { fixado_por_tipo: "usuario" | "agente" } | undefined;

    if (!existing) {
      const count = this.listPinsByThread(input.agenteId, threadId).length;
      return { removed: false, count };
    }

    if (existing.fixado_por_tipo === "usuario" && input.actorTipo === "agente") {
      throw new Error(
        "Esta mensagem foi fixada pelo usuário. Apenas o usuário pode desafixar mensagens fixadas manualmente.",
      );
    }

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare("DELETE FROM projecao_mensagens_fixadas WHERE thread_id = ? AND mensagem_id = ?;")
        .run(threadId, input.mensagemId);
    });

    const allPins = this.emitPinsChanged(input.agenteId);
    const count = allPins.filter((p) => p.thread_id === threadId).length;
    return { removed: true, count };
  }

  /**
   * Executa a ferramenta `pin_message` a partir de uma citação textual (`quote`) ou da última mensagem do usuário no turno.
   */
  public pinFromTool(ctx: {
    agenteId: string;
    threadId?: string | null;
    currentTurnId: string;
    quote?: string;
    pinned?: boolean;
  }): { status: "pinned" | "unpinned"; messageId: string; count: number } {
    const threadId = this.normalizeThreadId(ctx.agenteId, ctx.threadId);
    const canalFallback = threadId === `main:${ctx.agenteId}` ? `agente:${ctx.agenteId}` : null;
    const shouldPin = ctx.pinned !== false;
    const quote = typeof ctx.quote === "string" ? ctx.quote.trim() : "";

    if (quote.length > 500) {
      throw new Error("A citação para pin_message deve ter no máximo 500 caracteres.");
    }

    const candidates = this.db.connection
      .prepare(
        `
        SELECT mensagem_id, autor, conteudo_markdown, turno_id, criado_em
        FROM projecao_conversas_chat
        WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
          AND COALESCE(status, 'completed') != 'streaming'
          AND COALESCE(item_type, 'mensagem') = 'mensagem'
        ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC;
      `,
      )
      .all(threadId, canalFallback) as Array<{
      mensagem_id: string;
      autor: string;
      conteudo_markdown: string;
      turno_id: string | null;
      criado_em: string;
    }>;

    let targetMsgId: string | null = null;

    if (!quote) {
      const currentUserMsg =
        candidates.find((c) => c.autor === "usuario" && c.turno_id === ctx.currentTurnId) ??
        candidates.find((c) => c.autor === "usuario");
      targetMsgId = currentUserMsg?.mensagem_id ?? null;
    } else {
      const eligible = candidates.filter((c) => c.turno_id !== ctx.currentTurnId);
      const exactMatch = eligible.find((c) => c.conteudo_markdown.includes(quote));
      const lowerQuote = quote.toLowerCase();
      const insensitiveMatch = exactMatch ?? eligible.find((c) => c.conteudo_markdown.toLowerCase().includes(lowerQuote));

      if (!insensitiveMatch) {
        const onlyInCurrentTurn = candidates.some(
          (c) => c.turno_id === ctx.currentTurnId && c.conteudo_markdown.toLowerCase().includes(lowerQuote),
        );
        if (onlyInCurrentTurn) {
          throw new Error(
            "A citação informada aparece apenas no turno atual. Cite uma mensagem anterior finalizada para fixá-la.",
          );
        }
        throw new Error(`Nenhuma mensagem anterior correspondente à citação "${quote.slice(0, 60)}" foi encontrada.`);
      }
      targetMsgId = insensitiveMatch.mensagem_id;
    }

    if (!targetMsgId) {
      throw new Error("Nenhuma mensagem elegível encontrada nesta conversa para fixar/desafixar.");
    }

    if (shouldPin) {
      const res = this.pinMessage({
        agenteId: ctx.agenteId,
        threadId,
        mensagemId: targetMsgId,
        actorTipo: "agente",
        actorId: ctx.agenteId,
      });
      return {
        status: "pinned",
        messageId: targetMsgId,
        count: res.count,
      };
    }

    const res = this.unpinMessage({
      agenteId: ctx.agenteId,
      threadId,
      mensagemId: targetMsgId,
      actorTipo: "agente",
    });
    return {
      status: "unpinned",
      messageId: targetMsgId,
      count: res.count,
    };
  }
}
