import type {
  AnexoChat,
  MensagemChat,
  PaginaConversaThread,
  PassoChat,
  TipoItemMensagemChat,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export const INITIAL_CONVERSATION_PAGE_SIZE = 24;
export const MAX_UNREAD_INITIAL_PAGE_SIZE = 100;

export interface CursorPayload {
  schemaVersion: 1;
  criado_em: string;
  ordinal: number;
  mensagem_id: string;
}

interface ConversaRow {
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
  item_type: TipoItemMensagemChat | null;
  status: MensagemChat["status"] | null;
  resposta_para_mensagem_id: string | null;
  ordinal: number | null;
  branch_origem_mensagem_id: string | null;
  metadados_json: string | null;
}

/**
 * Codifica cursor opaco determinístico em base64url.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decodifica e valida estritamente o cursor opaco base64url (rejeita payloads > 1KB ou JSON inválido).
 */
export function decodeCursor(raw: string): CursorPayload | null {
  if (!raw || raw.length > 1024) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<CursorPayload>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.criado_em !== "string" ||
      parsed.criado_em.length === 0 ||
      typeof parsed.ordinal !== "number" ||
      !Number.isInteger(parsed.ordinal) ||
      typeof parsed.mensagem_id !== "string" ||
      parsed.mensagem_id.length === 0
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      criado_em: parsed.criado_em,
      ordinal: parsed.ordinal,
      mensagem_id: parsed.mensagem_id,
    };
  } catch {
    return null;
  }
}

/**
 * Leitor determinístico e paginado de threads longas mantendo grupos de turno inteiros (wholeGroups).
 */
export class ConversationPaginationReader {
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

  private mapRow(row: ConversaRow): MensagemChat {
    return {
      mensagem_id: row.mensagem_id,
      canal_id: row.canal_id,
      agente_id: row.agente_id,
      autor: row.autor,
      autor_nome: row.autor_nome ?? undefined,
      conteudo_markdown: row.conteudo_markdown,
      anexos: this.safeJsonParse<AnexoChat[]>(row.anexos_json, []),
      steps: this.safeJsonParse<PassoChat[]>(row.steps_json, []),
      tarefa_id: row.tarefa_id ?? null,
      thread_id: row.thread_id ?? null,
      turno_id: row.turno_id ?? null,
      item_type: row.item_type ?? "mensagem",
      status: row.status ?? "completed",
      resposta_para_mensagem_id: row.resposta_para_mensagem_id ?? null,
      ordinal: row.ordinal ?? 0,
      branch_origem_mensagem_id: row.branch_origem_mensagem_id ?? null,
      metadados: this.safeJsonParse<Record<string, unknown>>(row.metadados_json, {}),
      lida: row.lida === 1,
      criado_em: row.criado_em,
    };
  }

  private loadAllThreadMessages(threadId: string, agenteId: string): MensagemChat[] {
    const legacyMainCanal = threadId === `main:${agenteId}` ? `agente:${agenteId}` : null;
    const rows = (legacyMainCanal
      ? this.db.connection
          .prepare(
            `
            SELECT * FROM projecao_conversas_chat
            WHERE thread_id = ? OR (thread_id IS NULL AND canal_id = ?)
            ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC, mensagem_id ASC;
          `,
          )
          .all(threadId, legacyMainCanal)
      : this.db.connection
          .prepare(
            `
            SELECT * FROM projecao_conversas_chat
            WHERE thread_id = ?
            ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC, mensagem_id ASC;
          `,
          )
          .all(threadId)) as unknown as ConversaRow[];
    return rows.map((row) => this.mapRow(row));
  }

  private compareTuple(
    a: { criado_em: string; ordinal?: number; mensagem_id: string },
    b: { criado_em: string; ordinal: number; mensagem_id: string },
  ): number {
    if (a.criado_em < b.criado_em) return -1;
    if (a.criado_em > b.criado_em) return 1;
    const ordA = a.ordinal ?? 0;
    if (ordA < b.ordinal) return -1;
    if (ordA > b.ordinal) return 1;
    if (a.mensagem_id < b.mensagem_id) return -1;
    if (a.mensagem_id > b.mensagem_id) return 1;
    return 0;
  }

  private groupByTurn(messages: MensagemChat[]): MensagemChat[][] {
    const groups: MensagemChat[][] = [];
    for (const msg of messages) {
      const lastGroup = groups[groups.length - 1];
      if (
        lastGroup &&
        msg.turno_id &&
        lastGroup[0]?.turno_id === msg.turno_id
      ) {
        lastGroup.push(msg);
      } else {
        groups.push([msg]);
      }
    }
    return groups;
  }

  private buildReferencesMap(
    windowMessages: MensagemChat[],
    allMessages: MensagemChat[],
  ): Record<string, MensagemChat> {
    const inWindow = new Set(windowMessages.map((m) => m.mensagem_id));
    const allMap = new Map(allMessages.map((m) => [m.mensagem_id, m]));
    const refs: Record<string, MensagemChat> = {};
    for (const msg of windowMessages) {
      const refId = msg.resposta_para_mensagem_id;
      if (refId && !inWindow.has(refId)) {
        const target = allMap.get(refId);
        if (target) {
          refs[refId] = target;
        }
      }
    }
    return refs;
  }

  private readActiveState(threadId: string, agenteId: string): {
    turno_ativo_id: string | null;
    revisao: number;
  } {
    if (!threadId.startsWith("main:")) {
      const row = this.db.connection
        .prepare(
          "SELECT turno_ativo_id, ultima_sequencia_evento FROM projecao_agente_threads WHERE thread_id = ?;",
        )
        .get(threadId) as { turno_ativo_id: string | null; ultima_sequencia_evento: number } | undefined;
      return {
        turno_ativo_id: row?.turno_ativo_id ?? null,
        revisao: row?.ultima_sequencia_evento ?? 0,
      };
    }
    const activeTurn = this.db.connection
      .prepare(
        `
        SELECT turno_id FROM projecao_fila_chat
        WHERE agente_id = ? AND thread_id IS NULL AND status IN ('iniciando', 'executando')
        ORDER BY atualizado_em DESC LIMIT 1;
      `,
      )
      .get(agenteId) as { turno_id: string | null } | undefined;
    return {
      turno_ativo_id: activeTurn?.turno_id ?? null,
      revisao: 0,
    };
  }

  /**
   * Resolve dinamicamente quantas mensagens carregar inicialmente:
   * padrão enxuto de 24 mensagens, expandindo até 100 quando houver mais não lidas.
   */
  public resolveInitialPageLimit(threadId: string, agenteId: string): number {
    const legacyMainCanal = threadId === `main:${agenteId}` ? `agente:${agenteId}` : null;
    const row = (legacyMainCanal
      ? this.db.connection
          .prepare(
            `
            SELECT COUNT(*) AS total FROM projecao_conversas_chat
            WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?)) AND lida = 0;
          `,
          )
          .get(threadId, legacyMainCanal)
      : this.db.connection
          .prepare(
            `
            SELECT COUNT(*) AS total FROM projecao_conversas_chat
            WHERE thread_id = ? AND lida = 0;
          `,
          )
          .get(threadId)) as { total?: number } | undefined;
    const unreadCount = Number(row?.total ?? 0);
    return Math.min(
      MAX_UNREAD_INITIAL_PAGE_SIZE,
      Math.max(INITIAL_CONVERSATION_PAGE_SIZE, unreadCount),
    );
  }

  /**
   * Lê uma página cronológica terminando antes do cursor informado (ou a janela mais recente).
   */
  public readPage(params: {
    threadId: string;
    agenteId: string;
    beforeCursor?: string | null;
    limit?: number;
  }): PaginaConversaThread {
    const requestedLimit =
      params.limit !== undefined
        ? params.limit
        : params.beforeCursor
          ? INITIAL_CONVERSATION_PAGE_SIZE
          : this.resolveInitialPageLimit(params.threadId, params.agenteId);
    const safeLimit = Math.max(
      1,
      Math.min(MAX_UNREAD_INITIAL_PAGE_SIZE, Math.floor(requestedLimit)),
    );
    const allMessages = this.loadAllThreadMessages(params.threadId, params.agenteId);

    let eligible = allMessages;
    let hasNewer = false;

    if (params.beforeCursor) {
      const cursor = decodeCursor(params.beforeCursor);
      if (!cursor) {
        throw new Error("Cursor de paginação inválido.");
      }
      eligible = allMessages.filter((m) => this.compareTuple(m, cursor) < 0);
      hasNewer = eligible.length < allMessages.length;
    }

    const groups = this.groupByTurn(eligible);
    const selectedReversedGroups: MensagemChat[][] = [];
    let count = 0;

    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i]!;
      if (count > 0 && count + group.length > safeLimit) {
        break;
      }
      if (count === 0 && group.length > safeLimit) {
        // Turno único maior que o teto: fatia apenas a cauda para manter segurança sem loop infinito
        selectedReversedGroups.push(group.slice(-safeLimit));
        count += safeLimit;
        break;
      }
      selectedReversedGroups.push(group);
      count += group.length;
    }

    const selected = selectedReversedGroups.reverse().flat();
    const olderCount = eligible.length - selected.length;
    const firstMsg = selected[0];
    const state = this.readActiveState(params.threadId, params.agenteId);

    return {
      agente_id: params.agenteId,
      thread_id: params.threadId,
      turno_ativo_id: state.turno_ativo_id,
      revisao: state.revisao,
      mensagens: selected,
      referencias: this.buildReferencesMap(selected, allMessages),
      has_older: olderCount > 0,
      older_cursor:
        olderCount > 0 && firstMsg
          ? encodeCursor({
              schemaVersion: 1,
              criado_em: firstMsg.criado_em,
              ordinal: firstMsg.ordinal ?? 0,
              mensagem_id: firstMsg.mensagem_id,
            })
          : null,
      older_count: olderCount,
      has_newer: hasNewer,
    };
  }

  /**
   * Lê uma janela centrada em aroundMessageId preservando grupos de turno inteiros para saltos de pin/busca.
   */
  public readAround(params: {
    threadId: string;
    agenteId: string;
    aroundMessageId: string;
    limit?: number;
  }): PaginaConversaThread {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 50)));
    const allMessages = this.loadAllThreadMessages(params.threadId, params.agenteId);
    const groups = this.groupByTurn(allMessages);
    const anchorGroupIndex = groups.findIndex((g) =>
      g.some((m) => m.mensagem_id === params.aroundMessageId),
    );

    if (anchorGroupIndex < 0) {
      return this.readPage({ threadId: params.threadId, agenteId: params.agenteId, limit: safeLimit });
    }

    let startGroup = anchorGroupIndex;
    let endGroup = anchorGroupIndex;
    let total = groups[anchorGroupIndex]!.length;

    const halfBudget = Math.floor(safeLimit / 2);
    let afterAdded = 0;
    while (endGroup + 1 < groups.length && afterAdded + groups[endGroup + 1]!.length <= halfBudget && total + groups[endGroup + 1]!.length <= safeLimit) {
      endGroup += 1;
      const len = groups[endGroup]!.length;
      afterAdded += len;
      total += len;
    }

    while (startGroup - 1 >= 0 && total + groups[startGroup - 1]!.length <= safeLimit) {
      startGroup -= 1;
      total += groups[startGroup]!.length;
    }

    while (endGroup + 1 < groups.length && total + groups[endGroup + 1]!.length <= safeLimit) {
      endGroup += 1;
      total += groups[endGroup]!.length;
    }

    const selected = groups.slice(startGroup, endGroup + 1).flat();
    const firstMsg = selected[0];
    const olderCount = groups.slice(0, startGroup).reduce((sum, g) => sum + g.length, 0);
    const newerCount = groups.slice(endGroup + 1).reduce((sum, g) => sum + g.length, 0);
    const state = this.readActiveState(params.threadId, params.agenteId);

    return {
      agente_id: params.agenteId,
      thread_id: params.threadId,
      turno_ativo_id: state.turno_ativo_id,
      revisao: state.revisao,
      mensagens: selected,
      referencias: this.buildReferencesMap(selected, allMessages),
      has_older: olderCount > 0,
      older_cursor:
        olderCount > 0 && firstMsg
          ? encodeCursor({
              schemaVersion: 1,
              criado_em: firstMsg.criado_em,
              ordinal: firstMsg.ordinal ?? 0,
              mensagem_id: firstMsg.mensagem_id,
            })
          : null,
      older_count: olderCount,
      has_newer: newerCount > 0,
    };
  }
}
