import { randomUUID } from "node:crypto";
import type { CriativoDatabase } from "../database/client.ts";
import { resolveAgentIdFromDb } from "../server/agent-resolver.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";

export const MIN_WAKEUP_DELAY_SECONDS = 10;
export const MAX_WAKEUP_DELAY_SECONDS = 86_400;
export const MAX_WAKEUP_ITERATIONS = 50;
export const MAX_ACTIVE_WAKEUPS_PER_AGENT = 10;
export const WAKEUP_TIMER_CAP_MS = 30_000;

export type AgentWakeupStatus =
  | "agendado"
  | "executando"
  | "concluido"
  | "cancelado"
  | "falha";

export interface AgentWakeupRow {
  wakeup_id: string;
  agente_id: string;
  thread_id: string;
  canal_id: string;
  channel_origin: "web" | "whatsapp";
  whatsapp_conta_id: string | null;
  whatsapp_chat_jid: string | null;
  instrucao: string;
  intervalo_segundos: number;
  recorrente: number;
  max_iteracoes: number;
  iteracao_atual: number;
  status: AgentWakeupStatus;
  proximo_disparo_em: string;
  ultimo_disparo_em: string | null;
  ultimo_erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ScheduleWakeupContext {
  agenteId: string;
  canalId?: string | null;
  threadId?: string | null;
  channelOrigin?: "web" | "whatsapp" | string | null;
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
}

export interface ScheduleWakeupInput {
  agentId?: string;
  delaySeconds?: number;
  recurring?: boolean;
  maxIterations?: number;
  instruction: string;
}

export interface AgentWakeupServiceDeps {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
}

/**
 * Motor persistido no SQLite para timers curtos (10s–86400s) e ciclos de retomada automática.
 * Acorda o agente na mesma conversa/tópico (ou WhatsApp) sem exigir rotinas >= 3 minutos.
 */
export class AgentWakeupService {
  private readonly db: CriativoDatabase;
  private readonly wsHub?: WebSocketHub;
  private onFire?: (wakeup: AgentWakeupRow) => Promise<void> | void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private disposed = false;

  constructor(deps: AgentWakeupServiceDeps) {
    this.db = deps.db;
    this.wsHub = deps.wsHub;
  }

  public setOnFire(handler: (wakeup: AgentWakeupRow) => Promise<void> | void): void {
    this.onFire = handler;
  }

  private resolveCanonicalAgentId(rawAgentId: string): string {
    const trimmed = String(rawAgentId ?? "").trim();
    if (!trimmed) {
      throw new Error("Informe um agente válido para o wakeup.");
    }
    const resolved = resolveAgentIdFromDb(this.db, trimmed) ?? trimmed;
    const exists = this.db.connection
      .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(resolved) as { agente_id: string } | undefined;
    if (!exists) {
      throw new Error(`Agente não encontrado para wakeup: ${rawAgentId}`);
    }
    return exists.agente_id;
  }

  private broadcastUpdate(
    agenteId: string,
    wakeupId: string,
    status: AgentWakeupStatus,
    iteracaoAtual: number,
  ): void {
    this.wsHub?.broadcast("wakeup:updated", {
      agente_id: agenteId,
      wakeup_id: wakeupId,
      status,
      iteracao_atual: iteracaoAtual,
    });
  }

  public scheduleWakeup(
    ctx: ScheduleWakeupContext,
    args: ScheduleWakeupInput,
  ): {
    ok: true;
    wakeupId: string;
    agentId: string;
    status: "agendado";
    proximoDisparoEm: string;
    intervaloSegundos: number;
    recorrente: boolean;
    maxIteracoes: number;
    threadId: string;
    canalId: string;
  } {
    const canonicalAgentId = this.resolveCanonicalAgentId(args.agentId ?? ctx.agenteId);
    const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
    if (instruction.length < 1 || instruction.length > 4000) {
      throw new Error(
        "O campo 'instruction' em schedule_wakeup deve ter entre 1 e 4.000 caracteres.",
      );
    }

    const rawDelay = args.delaySeconds === undefined ? 60 : Number(args.delaySeconds);
    if (!Number.isFinite(rawDelay)) {
      throw new Error("Informe um valor numérico válido em 'delaySeconds' (10 a 86400).");
    }
    const delaySeconds = Math.round(rawDelay);
    if (delaySeconds < MIN_WAKEUP_DELAY_SECONDS || delaySeconds > MAX_WAKEUP_DELAY_SECONDS) {
      throw new Error(
        `'delaySeconds' (${delaySeconds}) deve estar entre ${MIN_WAKEUP_DELAY_SECONDS}s e ${MAX_WAKEUP_DELAY_SECONDS}s.`,
      );
    }

    const recurring = Boolean(args.recurring);
    const rawMaxIter =
      args.maxIterations === undefined
        ? recurring
          ? 10
          : 1
        : Math.round(Number(args.maxIterations));
    if (!Number.isFinite(rawMaxIter) || rawMaxIter < 1 || rawMaxIter > MAX_WAKEUP_ITERATIONS) {
      throw new Error(
        `'maxIterations' deve estar entre 1 e ${MAX_WAKEUP_ITERATIONS}.`,
      );
    }
    const maxIterations = recurring ? rawMaxIter : 1;

    const countRow = this.db.connection
      .prepare(
        `SELECT COUNT(*) AS total
         FROM projecao_agente_wakeups
         WHERE agente_id = ? AND status IN ('agendado', 'executando');`,
      )
      .get(canonicalAgentId) as { total: number } | undefined;

    if ((countRow?.total ?? 0) >= MAX_ACTIVE_WAKEUPS_PER_AGENT) {
      throw new Error(
        `Limite de ${MAX_ACTIVE_WAKEUPS_PER_AGENT} wakeups ativos atingido para '${canonicalAgentId}'. Cancele wakeups antigos com cancel_wakeup antes de agendar novos.`,
      );
    }

    const wakeupId = `wk_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const threadId =
      typeof ctx.threadId === "string" && ctx.threadId.trim()
        ? ctx.threadId.trim()
        : `main:${canonicalAgentId}`;
    const canalId =
      typeof ctx.canalId === "string" && ctx.canalId.trim()
        ? ctx.canalId.trim()
        : `agente:${canonicalAgentId}`;
    const channelOrigin = ctx.channelOrigin === "whatsapp" ? "whatsapp" : "web";
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const proximoDisparoEm = new Date(nowMs + delaySeconds * 1000).toISOString();

    this.db.connection
      .prepare(
        `INSERT INTO projecao_agente_wakeups (
           wakeup_id, agente_id, thread_id, canal_id, channel_origin,
           whatsapp_conta_id, whatsapp_chat_jid, instrucao,
           intervalo_segundos, recorrente, max_iteracoes, iteracao_atual,
           status, proximo_disparo_em, ultimo_disparo_em, ultimo_erro,
           criado_em, atualizado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'agendado', ?, NULL, NULL, ?, ?);`,
      )
      .run(
        wakeupId,
        canonicalAgentId,
        threadId,
        canalId,
        channelOrigin,
        ctx.whatsappContaId?.trim() || null,
        ctx.whatsappChatJid?.trim() || null,
        instruction,
        delaySeconds,
        recurring ? 1 : 0,
        maxIterations,
        proximoDisparoEm,
        nowIso,
        nowIso,
      );

    this.broadcastUpdate(canonicalAgentId, wakeupId, "agendado", 0);
    this.arm();

    return {
      ok: true,
      wakeupId,
      agentId: canonicalAgentId,
      status: "agendado",
      proximoDisparoEm,
      intervaloSegundos: delaySeconds,
      recorrente: recurring,
      maxIteracoes: maxIterations,
      threadId,
      canalId,
    };
  }

  public listWakeups(agenteId?: string, includeInactive = false): AgentWakeupRow[] {
    const resolvedAgent = agenteId
      ? resolveAgentIdFromDb(this.db, agenteId) ?? agenteId.trim()
      : null;

    if (resolvedAgent) {
      return this.db.connection
        .prepare(
          includeInactive
            ? `SELECT * FROM projecao_agente_wakeups WHERE agente_id = ? ORDER BY proximo_disparo_em ASC;`
            : `SELECT * FROM projecao_agente_wakeups WHERE agente_id = ? AND status IN ('agendado', 'executando') ORDER BY proximo_disparo_em ASC;`,
        )
        .all(resolvedAgent) as unknown as AgentWakeupRow[];
    }

    return this.db.connection
      .prepare(
        includeInactive
          ? `SELECT * FROM projecao_agente_wakeups ORDER BY proximo_disparo_em ASC;`
          : `SELECT * FROM projecao_agente_wakeups WHERE status IN ('agendado', 'executando') ORDER BY proximo_disparo_em ASC;`,
      )
      .all() as unknown as AgentWakeupRow[];
  }

  public hasActiveWakeups(agenteId: string): boolean {
    const resolvedAgent = resolveAgentIdFromDb(this.db, agenteId) ?? agenteId.trim();
    const row = this.db.connection
      .prepare(
        `SELECT 1 AS ok
         FROM projecao_agente_wakeups
         WHERE agente_id = ? AND status IN ('agendado', 'executando')
         LIMIT 1;`,
      )
      .get(resolvedAgent) as { ok: number } | undefined;
    return Boolean(row);
  }

  public cancelWakeup(
    wakeupId: string,
    agenteId?: string,
  ): { ok: true; wakeupId: string; status: "cancelado"; agentId: string } {
    const id = String(wakeupId ?? "").trim();
    if (!id) {
      throw new Error("Informe 'wakeupId' para cancelar o wakeup.");
    }
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_agente_wakeups WHERE wakeup_id = ? LIMIT 1;")
      .get(id) as AgentWakeupRow | undefined;
    if (!existing) {
      throw new Error(`Wakeup '${id}' não encontrado.`);
    }

    if (agenteId && agenteId.trim()) {
      const canonicalAgent = resolveAgentIdFromDb(this.db, agenteId) ?? agenteId.trim();
      if (existing.agente_id !== canonicalAgent) {
        throw new Error(
          `Wakeup '${id}' pertence ao agente '${existing.agente_id}', não a '${canonicalAgent}'.`,
        );
      }
    }

    const nowIso = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE projecao_agente_wakeups
         SET status = 'cancelado', atualizado_em = ?
         WHERE wakeup_id = ?;`,
      )
      .run(nowIso, id);

    this.broadcastUpdate(existing.agente_id, id, "cancelado", existing.iteracao_atual);
    this.arm();

    return {
      ok: true,
      wakeupId: id,
      status: "cancelado",
      agentId: existing.agente_id,
    };
  }

  public start(): void {
    this.disposed = false;
    const nowIso = new Date().toISOString();
    // Recupera linhas presas em 'executando' de um encerramento inesperado do daemon
    this.db.connection
      .prepare(
        `UPDATE projecao_agente_wakeups
         SET status = 'agendado', atualizado_em = ?
         WHERE status = 'executando';`,
      )
      .run(nowIso);
    this.arm();
  }

  public arm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.disposed) return;

    const next = this.db.connection
      .prepare(
        `SELECT proximo_disparo_em
         FROM projecao_agente_wakeups
         WHERE status = 'agendado'
         ORDER BY proximo_disparo_em ASC
         LIMIT 1;`,
      )
      .get() as { proximo_disparo_em: string } | undefined;

    if (!next) return;

    const targetMs = Date.parse(next.proximo_disparo_em);
    const delayMs = Number.isFinite(targetMs)
      ? Math.max(0, Math.min(WAKEUP_TIMER_CAP_MS, targetMs - Date.now()))
      : 1000;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processDueWakeups();
    }, delayMs);
    this.timer.unref?.();
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public async processDueWakeups(now: Date = new Date()): Promise<number> {
    if (this.disposed || this.processing) return 0;
    this.processing = true;
    let processed = 0;

    try {
      const nowIso = now.toISOString();
      const dueRows = this.db.connection
        .prepare(
          `SELECT *
           FROM projecao_agente_wakeups
           WHERE status = 'agendado' AND proximo_disparo_em <= ?
           ORDER BY proximo_disparo_em ASC
           LIMIT 25;`,
        )
        .all(nowIso) as unknown as AgentWakeupRow[];

      for (const candidate of dueRows) {
        if (this.disposed) break;
        const stampIso = new Date().toISOString();
        const claim = this.db.connection
          .prepare(
            `UPDATE projecao_agente_wakeups
             SET status = 'executando',
                 iteracao_atual = iteracao_atual + 1,
                 ultimo_disparo_em = ?,
                 atualizado_em = ?
             WHERE wakeup_id = ? AND status = 'agendado';`,
          )
          .run(stampIso, stampIso, candidate.wakeup_id);

        if (claim.changes === 0) continue;
        processed += 1;

        const claimedRow = this.db.connection
          .prepare("SELECT * FROM projecao_agente_wakeups WHERE wakeup_id = ? LIMIT 1;")
          .get(candidate.wakeup_id) as AgentWakeupRow | undefined;

        if (!claimedRow) continue;

        this.broadcastUpdate(
          claimedRow.agente_id,
          claimedRow.wakeup_id,
          "executando",
          claimedRow.iteracao_atual,
        );

        let errorMessage: string | null = null;
        try {
          if (this.onFire) {
            await this.onFire(claimedRow);
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
        }

        // Relê para preservar eventual auto-cancelamento feito pelo agente durante o turno despertado
        const fresh = this.db.connection
          .prepare("SELECT * FROM projecao_agente_wakeups WHERE wakeup_id = ? LIMIT 1;")
          .get(claimedRow.wakeup_id) as AgentWakeupRow | undefined;

        if (!fresh || fresh.status === "cancelado" || fresh.status === "concluido") {
          continue;
        }

        const hasMoreCycles =
          fresh.recorrente === 1 && fresh.iteracao_atual < fresh.max_iteracoes;
        const doneAt = new Date();
        const doneIso = doneAt.toISOString();

        if (hasMoreCycles) {
          const baseMs = Math.max(now.getTime(), doneAt.getTime());
          const nextIso = new Date(baseMs + fresh.intervalo_segundos * 1000).toISOString();
          this.db.connection
            .prepare(
              `UPDATE projecao_agente_wakeups
               SET status = 'agendado',
                   proximo_disparo_em = ?,
                   ultimo_erro = ?,
                   atualizado_em = ?
               WHERE wakeup_id = ?;`,
            )
            .run(nextIso, errorMessage, doneIso, fresh.wakeup_id);
          this.broadcastUpdate(fresh.agente_id, fresh.wakeup_id, "agendado", fresh.iteracao_atual);
        } else {
          const finalStatus: AgentWakeupStatus = errorMessage ? "falha" : "concluido";
          this.db.connection
            .prepare(
              `UPDATE projecao_agente_wakeups
               SET status = ?,
                   ultimo_erro = ?,
                   atualizado_em = ?
               WHERE wakeup_id = ?;`,
            )
            .run(finalStatus, errorMessage, doneIso, fresh.wakeup_id);
          this.broadcastUpdate(fresh.agente_id, fresh.wakeup_id, finalStatus, fresh.iteracao_atual);
        }
      }
    } finally {
      this.processing = false;
      this.arm();
    }

    return processed;
  }
}
