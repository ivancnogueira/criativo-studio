/**
 * Serviço de busca e leitura paginada de histórico (`HistorySearchService` — LRN-02).
 * Aplica redação prévia de segredos ANTES de avaliar correspondência textual para impedir
 * ataque de oráculo contra tokens armazenados no Cofre AES-256-GCM.
 */
import type { PassoChat } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";

export interface HistorySearchServiceDeps {
  db: CriativoDatabase;
  redactSecrets?: (text: string) => string;
}

export interface HistorySearchMatch {
  mensagem_id: string;
  canal_id: string;
  thread_id: string | null;
  tarefa_id: string | null;
  autor: "usuario" | "agente" | "sistema";
  trecho: string;
  criado_em: string;
}

export interface RecentConversationSummary {
  tipo: "conversa" | "thread" | "tarefa";
  id: string;
  canal_id: string | null;
  titulo: string;
  status: string;
  atualizado_em: string;
}

interface SearchCursorPayload {
  criadoEm: string;
  offsetId: string;
}

function encodeHistoryCursor(payload: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeHistoryCursor(raw?: string | null): SearchCursorPayload | null {
  if (!raw || raw.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<SearchCursorPayload>;
    if (typeof parsed.criadoEm === "string" && typeof parsed.offsetId === "string") {
      return { criadoEm: parsed.criadoEm, offsetId: parsed.offsetId };
    }
  } catch {
    // cursor inválido
  }
  return null;
}

export function resolveAfterFilterIso(after?: string | null, now = new Date()): string | null {
  if (!after || !after.trim()) return null;
  const clean = after.trim();

  const relMatch = clean.match(/^(\d+)\s*(h|d|m)$/i);
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2]!.toLowerCase();
    if (Number.isFinite(amount) && amount > 0) {
      const ms =
        unit === "h"
          ? amount * 3_600_000
          : unit === "d"
            ? amount * 86_400_000
            : amount * 60_000;
      return new Date(now.getTime() - ms).toISOString();
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return `${clean}T00:00:00.000Z`;
  }

  const parsed = Date.parse(clean);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return null;
}

export class HistorySearchService {
  private readonly db: CriativoDatabase;
  private readonly redactSecrets: (text: string) => string;

  constructor(deps: HistorySearchServiceDeps) {
    this.db = deps.db;
    this.redactSecrets = deps.redactSecrets ?? ((t) => t);
  }

  private hasAgentThreadsTable(): boolean {
    const row = this.db.connection
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'projecao_agente_threads' LIMIT 1;",
      )
      .get() as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  public searchHistory(params: {
    agenteId: string;
    taskId?: string | null;
    query?: string | null;
    after?: string | null;
    cursor?: string | null;
    limit?: number;
  }): {
    recentes?: RecentConversationSummary[];
    resultados: HistorySearchMatch[];
    nextCursor: string | null;
  } {
    const limit = Math.min(Math.max(1, params.limit ?? 20), 50);
    const afterIso = resolveAfterFilterIso(params.after);
    const cleanQuery = (params.query ?? "").trim();
    const cleanTaskId = (params.taskId ?? "").trim();

    // Modo resumo recente quando nem query nem taskId foram informados
    if (!cleanQuery && !cleanTaskId) {
      const recentes: RecentConversationSummary[] = [];

      if (this.hasAgentThreadsTable()) {
        const thRows = this.db.connection
          .prepare(
            `SELECT thread_id, titulo, estado, atualizado_em
             FROM projecao_agente_threads
             WHERE agente_id = ?
               AND (? IS NULL OR atualizado_em >= ?)
             ORDER BY atualizado_em DESC
             LIMIT ?;`,
          )
          .all(params.agenteId, afterIso, afterIso, limit) as Array<{
          thread_id: string;
          titulo: string;
          estado: string;
          atualizado_em: string;
        }>;
        for (const t of thRows) {
          recentes.push({
            tipo: "thread",
            id: t.thread_id,
            canal_id: `thread:${t.thread_id}`,
            titulo: this.redactSecrets(t.titulo),
            status: t.estado,
            atualizado_em: t.atualizado_em,
          });
        }
      }

      const taskRows = this.db.connection
        .prepare(
          `SELECT tarefa_id, titulo, status, atualizado_em
           FROM projecao_tarefas
           WHERE agente_id = ?
             AND (? IS NULL OR atualizado_em >= ?)
           ORDER BY atualizado_em DESC
           LIMIT ?;`,
        )
        .all(params.agenteId, afterIso, afterIso, limit) as Array<{
        tarefa_id: string;
        titulo: string;
        status: string;
        atualizado_em: string;
      }>;
      for (const tk of taskRows) {
        recentes.push({
          tipo: "tarefa",
          id: tk.tarefa_id,
          canal_id: null,
          titulo: this.redactSecrets(tk.titulo),
          status: tk.status,
          atualizado_em: tk.atualizado_em,
        });
      }

      recentes.sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
      return {
        recentes: recentes.slice(0, limit),
        resultados: [],
        nextCursor: null,
      };
    }

    // Busca paginada com redação prévia anti-oráculo
    const decoded = decodeHistoryCursor(params.cursor);
    const lowerQuery = cleanQuery.toLowerCase();
    const matches: HistorySearchMatch[] = [];
    let scanCursor = decoded;
    let exhausted = false;
    let lastScannedRow: { criado_em: string; mensagem_id: string } | null = null;
    const batchSize = 120;

    while (matches.length < limit + 1 && !exhausted) {
      const clauses: string[] = ["agente_id = ?"];
      const sqlParams: Array<string | number> = [params.agenteId];

      if (cleanTaskId) {
        clauses.push("(tarefa_id = ? OR thread_id = ?)");
        sqlParams.push(cleanTaskId, cleanTaskId);
      }
      if (afterIso) {
        clauses.push("criado_em >= ?");
        sqlParams.push(afterIso);
      }
      if (scanCursor) {
        clauses.push("(criado_em < ? OR (criado_em = ? AND mensagem_id < ?))");
        sqlParams.push(scanCursor.criadoEm, scanCursor.criadoEm, scanCursor.offsetId);
      }

      const batch = this.db.connection
        .prepare(
          `SELECT mensagem_id, canal_id, thread_id, tarefa_id, autor, conteudo_markdown, criado_em
           FROM projecao_conversas_chat
           WHERE ${clauses.join(" AND ")}
           ORDER BY criado_em DESC, mensagem_id DESC
           LIMIT ?;`,
        )
        .all(...sqlParams, batchSize) as Array<{
        mensagem_id: string;
        canal_id: string;
        thread_id: string | null;
        tarefa_id: string | null;
        autor: "usuario" | "agente" | "sistema";
        conteudo_markdown: string;
        criado_em: string;
      }>;

      if (batch.length < batchSize) {
        exhausted = true;
      }
      if (batch.length === 0) {
        break;
      }

      for (const row of batch) {
        lastScannedRow = { criado_em: row.criado_em, mensagem_id: row.mensagem_id };
        // Redige segredos ANTES do teste de correspondência textual
        const redactedContent = this.redactSecrets(row.conteudo_markdown);
        if (!lowerQuery || redactedContent.toLowerCase().includes(lowerQuery)) {
          const idx = lowerQuery ? redactedContent.toLowerCase().indexOf(lowerQuery) : 0;
          const start = Math.max(0, idx - 80);
          const snippet = redactedContent.slice(start, start + 260).replace(/\s+/g, " ").trim();
          matches.push({
            mensagem_id: row.mensagem_id,
            canal_id: row.canal_id,
            thread_id: row.thread_id,
            tarefa_id: row.tarefa_id,
            autor: row.autor,
            trecho: snippet,
            criado_em: row.criado_em,
          });
          if (matches.length >= limit + 1) {
            break;
          }
        }
      }

      if (lastScannedRow) {
        scanCursor = {
          criadoEm: lastScannedRow.criado_em,
          offsetId: lastScannedRow.mensagem_id,
        };
      }
    }

    const hasMore = matches.length > limit;
    const sliced = hasMore ? matches.slice(0, limit) : matches;
    const tail = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && tail
        ? encodeHistoryCursor({ criadoEm: tail.criado_em, offsetId: tail.mensagem_id })
        : null;

    return {
      resultados: sliced,
      nextCursor,
    };
  }

  public readConversationExcerpt(params: {
    agenteId: string;
    canalId?: string | null;
    messageId?: string | null;
    before?: string | null;
    offset?: number;
    limit?: number;
    includeWorkSteps?: boolean;
    workStepsOffset?: number;
  }): {
    mensagens: Array<{
      mensagem_id: string;
      autor: string;
      conteudo_markdown: string;
      criado_em: string;
      steps?: PassoChat[];
      totalSteps?: number;
    }>;
    hasMore: boolean;
  } {
    const limit = Math.min(Math.max(1, params.limit ?? 20), 60);
    const offset = Math.max(0, params.offset ?? 0);
    const clauses: string[] = ["agente_id = ?"];
    const sqlParams: Array<string | number> = [params.agenteId];

    if (params.canalId) {
      clauses.push("(canal_id = ? OR thread_id = ?)");
      sqlParams.push(params.canalId, params.canalId);
    }
    if (params.messageId) {
      const anchor = this.db.connection
        .prepare("SELECT criado_em FROM projecao_conversas_chat WHERE mensagem_id = ? LIMIT 1;")
        .get(params.messageId) as { criado_em?: string } | undefined;
      if (anchor?.criado_em) {
        clauses.push("criado_em <= ?");
        sqlParams.push(anchor.criado_em);
      }
    } else if (params.before) {
      clauses.push("criado_em < ?");
      sqlParams.push(params.before);
    }

    const rows = this.db.connection
      .prepare(
        `SELECT mensagem_id, autor, conteudo_markdown, steps_json, criado_em
         FROM projecao_conversas_chat
         WHERE ${clauses.join(" AND ")}
         ORDER BY criado_em DESC, mensagem_id DESC
         LIMIT ? OFFSET ?;`,
      )
      .all(...sqlParams, limit + 1, offset) as Array<{
      mensagem_id: string;
      autor: string;
      conteudo_markdown: string;
      steps_json: string | null;
      criado_em: string;
    }>;

    const hasMore = rows.length > limit;
    const chronological = (hasMore ? rows.slice(0, limit) : rows).reverse();
    const stepsOffset = Math.max(0, params.workStepsOffset ?? 0);

    const mensagens = chronological.map((r) => {
      let parsedSteps: PassoChat[] | undefined;
      let totalSteps: number | undefined;
      if (params.includeWorkSteps && r.steps_json) {
        try {
          const allSteps = JSON.parse(r.steps_json) as PassoChat[];
          if (Array.isArray(allSteps)) {
            totalSteps = allSteps.length;
            parsedSteps = allSteps.slice(stepsOffset, stepsOffset + 25).map((s) => ({
              ...s,
              titulo: this.redactSecrets(s.titulo),
              detalhes: s.detalhes ? this.redactSecrets(s.detalhes) : undefined,
            }));
          }
        } catch {
          parsedSteps = [];
        }
      }

      return {
        mensagem_id: r.mensagem_id,
        autor: r.autor,
        conteudo_markdown: this.redactSecrets(r.conteudo_markdown),
        criado_em: r.criado_em,
        ...(parsedSteps !== undefined ? { steps: parsedSteps, totalSteps } : {}),
      };
    });

    return { mensagens, hasMore };
  }

  /**
   * Busca global unificada no estúdio para a Paleta Ctrl+K (`G-04`).
   * Aplica redação prévia de segredos em mensagens antes do match para evitar vazamento ou oráculo de segredos.
   */
  public searchGlobalStudio(query: string, limitPerGroup = 5): {
    query: string;
    total: number;
    grupos: {
      agentes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }>;
      equipes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }>;
      threads: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string; section: "agentes" }>;
      mensagens: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string | null; section: "agentes" }>;
      workflows: Array<{ id: string; titulo: string; subtitulo: string; section: "fluxos" }>;
      rotinas: Array<{ id: string; titulo: string; subtitulo: string; section: "agenda" }>;
      arquivos: Array<{ id: string; titulo: string; subtitulo: string; section: "arquivos" }>;
    };
  } {
    const cleanQ = String(query ?? "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(20, Number(limitPerGroup) || 5));
    const likePattern = `%${cleanQ}%`;

    const agentes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }> = [];
    const equipes: Array<{ id: string; titulo: string; subtitulo: string; section: "agentes" }> = [];
    const threads: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string; section: "agentes" }> = [];
    const mensagens: Array<{ id: string; titulo: string; subtitulo: string; agente_id: string | null; section: "agentes" }> = [];
    const workflows: Array<{ id: string; titulo: string; subtitulo: string; section: "fluxos" }> = [];
    const rotinas: Array<{ id: string; titulo: string; subtitulo: string; section: "agenda" }> = [];
    const arquivos: Array<{ id: string; titulo: string; subtitulo: string; section: "arquivos" }> = [];

    if (!cleanQ) {
      return {
        query: "",
        total: 0,
        grupos: { agentes, equipes, threads, mensagens, workflows, rotinas, arquivos },
      };
    }

    try {
      const agRows = this.db.connection
        .prepare(
          `SELECT agente_id, nome, papel FROM projecao_agentes
           WHERE LOWER(nome) LIKE ? OR LOWER(papel) LIKE ? OR LOWER(agente_id) LIKE ?
           ORDER BY ordem_exibicao ASC LIMIT ?;`
        )
        .all(likePattern, likePattern, likePattern, limit) as Array<{ agente_id: string; nome: string; papel: string }>;
      for (const r of agRows) {
        agentes.push({ id: r.agente_id, titulo: r.nome, subtitulo: r.papel, section: "agentes" });
      }
    } catch {
      // tabela opcional
    }

    try {
      const teamRows = this.db.connection
        .prepare(
          `SELECT canal_id, nome, COALESCE(descricao, '') AS descricao FROM projecao_grupos_equipe
           WHERE LOWER(nome) LIKE ? OR LOWER(COALESCE(descricao, '')) LIKE ?
           LIMIT ?;`
        )
        .all(likePattern, likePattern, limit) as Array<{ canal_id: string; nome: string; descricao: string }>;
      for (const r of teamRows) {
        equipes.push({
          id: r.canal_id,
          titulo: r.nome,
          subtitulo: r.descricao || "Equipe multi-agente",
          section: "agentes",
        });
      }
    } catch {
      // tabela opcional
    }

    if (this.hasAgentThreadsTable()) {
      try {
        const thRows = this.db.connection
          .prepare(
            `SELECT thread_id, agente_id, titulo, estado FROM projecao_agente_threads
             WHERE LOWER(titulo) LIKE ? AND arquivada_em IS NULL
             ORDER BY atualizado_em DESC LIMIT ?;`
          )
          .all(likePattern, limit) as Array<{ thread_id: string; agente_id: string; titulo: string; estado: string }>;
        for (const r of thRows) {
          threads.push({
            id: r.thread_id,
            titulo: r.titulo,
            subtitulo: `Thread (${r.agente_id}) · ${r.estado}`,
            agente_id: r.agente_id,
            section: "agentes",
          });
        }
      } catch {
        // tabela opcional
      }
    }

    try {
      // Inspeciona apenas janela recente de mensagens e redige segredos ANTES de testar correspondência
      const msgRows = this.db.connection
        .prepare(
          `SELECT mensagem_id, agente_id, canal_id, conteudo_markdown
           FROM projecao_conversas_chat
           WHERE COALESCE(item_type, 'mensagem') = 'mensagem'
           ORDER BY criado_em DESC LIMIT 250;`
        )
        .all() as Array<{ mensagem_id: string; agente_id: string | null; canal_id: string; conteudo_markdown: string }>;
      for (const m of msgRows) {
        if (mensagens.length >= limit) break;
        const safeText = this.redactSecrets(String(m.conteudo_markdown ?? ""));
        if (!safeText.toLowerCase().includes(cleanQ)) continue;
        mensagens.push({
          id: m.mensagem_id,
          titulo: safeText.replace(/\s+/g, " ").trim().slice(0, 90),
          subtitulo: m.agente_id ? `Conversa com ${m.agente_id}` : m.canal_id,
          agente_id: m.agente_id,
          section: "agentes",
        });
      }
    } catch {
      // tabela opcional
    }

    try {
      const wfRows = this.db.connection
        .prepare(
          `SELECT workflow_id, nome, COALESCE(descricao, '') AS descricao FROM projecao_workflows
           WHERE LOWER(nome) LIKE ? OR LOWER(COALESCE(descricao, '')) LIKE ?
           ORDER BY atualizado_em DESC LIMIT ?;`
        )
        .all(likePattern, likePattern, limit) as Array<{ workflow_id: string; nome: string; descricao: string }>;
      for (const w of wfRows) {
        workflows.push({
          id: w.workflow_id,
          titulo: w.nome,
          subtitulo: w.descricao || "Workflow em grafo",
          section: "fluxos",
        });
      }
    } catch {
      // tabela opcional
    }

    try {
      const rtRows = this.db.connection
        .prepare(
          `SELECT rotina_id, nome, owner_id FROM projecao_agente_rotinas
           WHERE LOWER(nome) LIKE ?
           ORDER BY atualizado_em DESC LIMIT ?;`
        )
        .all(likePattern, limit) as Array<{ rotina_id: string; nome: string; owner_id: string }>;
      for (const r of rtRows) {
        rotinas.push({
          id: r.rotina_id,
          titulo: r.nome,
          subtitulo: `Rotina · ${r.owner_id}`,
          section: "agenda",
        });
      }
    } catch {
      // tabela opcional
    }

    try {
      const fileRows = this.db.connection
        .prepare(
          `SELECT arquivo_id, nome, caminho_relativo FROM projecao_arquivos
           WHERE LOWER(nome) LIKE ? OR LOWER(caminho_relativo) LIKE ?
           ORDER BY criado_em DESC LIMIT ?;`
        )
        .all(likePattern, likePattern, limit) as Array<{ arquivo_id: string; nome: string; caminho_relativo: string }>;
      for (const f of fileRows) {
        arquivos.push({
          id: f.arquivo_id,
          titulo: f.nome,
          subtitulo: f.caminho_relativo,
          section: "arquivos",
        });
      }
    } catch {
      // tabela opcional
    }

    const total =
      agentes.length +
      equipes.length +
      threads.length +
      mensagens.length +
      workflows.length +
      rotinas.length +
      arquivos.length;

    return {
      query: query.trim(),
      total,
      grupos: { agentes, equipes, threads, mensagens, workflows, rotinas, arquivos },
    };
  }
}
