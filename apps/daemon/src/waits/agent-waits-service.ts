import type { AgenteEspera } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { resolveAgentIdFromDb } from "../server/agent-resolver.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import {
  AgentWaitStore,
  MAX_OPEN_WAITS_PER_AGENT,
  NEAR_WAIT_LIMIT_THRESHOLD,
} from "./agent-wait-store.ts";
import type { MailboxStore } from "./mailbox-store.ts";

export interface AgentWaitsServiceDeps {
  db: CriativoDatabase;
  waitStore: AgentWaitStore;
  wsHub: WebSocketHub;
}

/**
 * Gerencia o sistema de Esperas Longas (agent_waits) para processos >15 min,
 * validação contra rotinas ativas, despertar por rotina/webhook e card `OpenWaits`.
 */
export class AgentWaitsService {
  private readonly db: CriativoDatabase;
  private readonly waitStore: AgentWaitStore;
  private readonly wsHub: WebSocketHub;
  private readonly resumingByAgent = new Map<string, Set<string>>();
  private mailboxStore?: MailboxStore;

  constructor(deps: AgentWaitsServiceDeps) {
    this.db = deps.db;
    this.waitStore = deps.waitStore;
    this.wsHub = deps.wsHub;
  }

  public attachMailbox(store: MailboxStore): void {
    this.mailboxStore = store;
  }

  private resolveExistingAgentId(rawAgentId: string): string {
    const resolved = resolveAgentIdFromDb(this.db, rawAgentId) ?? rawAgentId.trim();
    const row = this.db.connection
      .prepare("SELECT agente_id FROM projecao_agentes WHERE agente_id = ?;")
      .get(resolved) as { agente_id: string } | undefined;
    if (!row) {
      throw new Error(`Agente não encontrado: ${rawAgentId}`);
    }
    return row.agente_id;
  }

  private verifyAgentExists(agenteId: string): void {
    this.resolveExistingAgentId(agenteId);
  }

  private findRoutineForAgent(agenteId: string, routineId?: string | null): {
    rotina_id: string;
    nome: string;
    ativa: boolean;
  } | null {
    if (routineId) {
      const v2 = this.db.connection
        .prepare(
          "SELECT rotina_id, nome, ativa FROM projecao_agente_rotinas WHERE rotina_id = ? AND owner_id = ? LIMIT 1;",
        )
        .get(routineId, agenteId) as { rotina_id: string; nome: string; ativa: number } | undefined;
      if (v2) {
        return { rotina_id: v2.rotina_id, nome: v2.nome, ativa: v2.ativa === 1 };
      }

      const legacy = this.db.connection
        .prepare("SELECT rotina_id, titulo, ativa FROM projecao_rotinas WHERE rotina_id = ? LIMIT 1;")
        .get(routineId) as { rotina_id: string; titulo: string; ativa: number } | undefined;
      if (legacy) {
        return { rotina_id: legacy.rotina_id, nome: legacy.titulo, ativa: legacy.ativa === 1 };
      }
      return null;
    }

    const anyV2 = this.db.connection
      .prepare(
        "SELECT rotina_id, nome, ativa FROM projecao_agente_rotinas WHERE owner_kind = 'agente' AND owner_id = ? AND ativa = 1 LIMIT 1;",
      )
      .get(agenteId) as { rotina_id: string; nome: string; ativa: number } | undefined;
    if (anyV2) {
      return { rotina_id: anyV2.rotina_id, nome: anyV2.nome, ativa: true };
    }

    const anyLegacy = this.db.connection
      .prepare("SELECT rotina_id, titulo, ativa FROM projecao_rotinas WHERE ativa = 1 LIMIT 1;")
      .get() as { rotina_id: string; titulo: string; ativa: number } | undefined;
    return anyLegacy
      ? { rotina_id: anyLegacy.rotina_id, nome: anyLegacy.titulo, ativa: true }
      : null;
  }

  public markResuming(agenteId: string, esperaIds: string[]): void {
    this.resumingByAgent.set(agenteId, new Set(esperaIds));
    this.emitWaitsChanged(agenteId);
  }

  public clearResuming(agenteId: string): void {
    if (this.resumingByAgent.delete(agenteId)) {
      this.emitWaitsChanged(agenteId);
    }
  }

  public emitWaitsChanged(agenteId: string): AgenteEspera[] {
    const esperas = this.listWaitsForUi(agenteId);
    this.wsHub.broadcast("waits:changed", {
      agente_id: agenteId,
      esperas,
    });
    return esperas;
  }

  public listWaitsForUi(agenteId: string): AgenteEspera[] {
    const resumingSet = this.resumingByAgent.get(agenteId);
    return this.waitStore.listWaits(agenteId).map((item) => ({
      ...item,
      estado: resumingSet?.has(item.espera_id)
        ? "resuming"
        : item.despertada_em
          ? "woken"
          : "waiting",
    }));
  }

  public listWaitsFromTool(agenteId: string): {
    agentId: string;
    limit: number;
    waits: Array<{
      waitId: string;
      note: string;
      openedAt: string;
      routineId: string | null;
      wokenAt: string | null;
    }>;
  } {
    const canonicalAgentId = this.resolveExistingAgentId(agenteId);
    const items = this.waitStore.listWaits(canonicalAgentId);
    return {
      agentId: canonicalAgentId,
      limit: MAX_OPEN_WAITS_PER_AGENT,
      waits: items.map((w) => ({
        waitId: w.espera_id,
        note: w.nota,
        openedAt: w.criado_em,
        routineId: w.rotina_id,
        wokenAt: w.despertada_em,
      })),
    };
  }

  public openWaitFromTool(
    ctx: {
      agenteId: string;
      entregaOrigemId: string;
      pedidoTexto: string;
      callerThreadId: string | null;
      callerIsRoutine: boolean;
      isResumingWait?: boolean;
    },
    args: { note: string; routineId?: string },
  ): Record<string, unknown> {
    this.verifyAgentExists(ctx.agenteId);

    if (ctx.callerThreadId && !ctx.callerThreadId.startsWith("main:") && !ctx.callerIsRoutine) {
      throw new Error(
        "A ferramenta await_event só pode ser chamada no chat principal do agente ou em uma thread de rotina.",
      );
    }

    const note = typeof args.note === "string" ? args.note.trim() : "";
    if (note.length < 1 || note.length > 2000) {
      throw new Error("O campo 'note' em await_event deve ter entre 1 e 2.000 caracteres.");
    }

    if (ctx.isResumingWait) {
      return {
        status: "already_resuming",
        message:
          "Você já está retomando uma espera despertada neste turno. Conclua o atendimento da espera ou feche-a explicitamente com close_wait ao terminar, sem duplicar novas esperas para o mesmo motivo.",
      };
    }

    const targetRoutine = this.findRoutineForAgent(ctx.agenteId, args.routineId);
    if (args.routineId) {
      if (!targetRoutine || !targetRoutine.ativa) {
        throw new Error(
          `A rotina '${args.routineId}' não foi encontrada ou está pausada para o agente '${ctx.agenteId}'.`,
        );
      }
    } else if (!targetRoutine) {
      throw new Error(
        `O agente '${ctx.agenteId}' precisa de ao menos 1 rotina ativa (ou um webhook) antes de abrir uma espera com await_event.`,
      );
    }

    const result = this.waitStore.openWait({
      agenteId: ctx.agenteId,
      entregaOrigemId: ctx.entregaOrigemId || `turn-${Date.now()}`,
      pedidoTexto: ctx.pedidoTexto.trim() || note,
      nota: note,
      rotinaId: args.routineId ?? null,
    });

    this.emitWaitsChanged(ctx.agenteId);

    return {
      waitId: result.espera.espera_id,
      openWaits: result.openWaits,
      limit: MAX_OPEN_WAITS_PER_AGENT,
      ...(result.nearLimit || result.openWaits >= NEAR_WAIT_LIMIT_THRESHOLD
        ? {
            nearLimit: true,
            warning: `Atenção: ${result.openWaits}/${MAX_OPEN_WAITS_PER_AGENT} esperas abertas. Encerre esperas já resolvidas usando close_wait.`,
          }
        : {}),
      wakes: result.espera.rotina_id
        ? `Rotina vinculada: ${result.espera.rotina_id}`
        : "Qualquer rotina futura deste agente ou webhook direcionado com waitId",
      scriptEvent: { waitId: result.espera.espera_id },
      next: "Encerre sua resposta avisando o usuário que o monitoramento longo foi registrado e será retomado automaticamente.",
    };
  }

  public closeWait(esperaId: string, agenteId?: string): { closed: string } {
    const canonicalAgentId = agenteId ? this.resolveExistingAgentId(agenteId) : undefined;
    const existing = this.waitStore.getWait(esperaId);
    const removed = this.waitStore.closeWait(esperaId, canonicalAgentId);
    if (!removed) {
      throw new Error(`Espera '${esperaId}' não encontrada ou já encerrada anteriormente.`);
    }
    const targetAgent = canonicalAgentId ?? existing?.agente_id;
    if (targetAgent) {
      this.resumingByAgent.get(targetAgent)?.delete(esperaId);
      this.emitWaitsChanged(targetAgent);
    }
    return { closed: esperaId };
  }

  /**
   * Acorda esperas abertas no disparo de uma rotina ou webhook (`waitId`), retornando o bloco de contexto formatado.
   */
  public wakeForRun(params: {
    agenteId: string;
    rotinaId?: string | null;
    waitId?: string | null;
    entregaDespertarId: string;
    webhookPayload?: unknown;
  }): { woken: AgenteEspera[]; promptBlock: string | null } {
    const allWaits = this.waitStore.listWaits(params.agenteId);
    let targetIds: string[] = [];

    if (params.waitId) {
      const exact = allWaits.find((w) => w.espera_id === params.waitId && w.despertada_em === null);
      if (exact) {
        targetIds = [exact.espera_id];
      }
    } else {
      targetIds = allWaits
        .filter(
          (w) =>
            w.despertada_em === null &&
            (w.rotina_id === null || (params.rotinaId ? w.rotina_id === params.rotinaId : true)),
        )
        .map((w) => w.espera_id);
    }

    if (targetIds.length === 0) {
      return { woken: [], promptBlock: null };
    }

    const woken = this.waitStore.markWoken(targetIds, params.entregaDespertarId);
    if (woken.length > 0) {
      if (this.mailboxStore) {
        for (const w of woken) {
          this.mailboxStore.enqueue({
            agente_id: params.agenteId,
            source_kind: "wait_event",
            idempotency_key: `wait:${params.entregaDespertarId}:${w.espera_id}`,
            payload: {
              espera_id: w.espera_id,
              rotina_id: params.rotinaId ?? null,
              nota: w.nota,
            },
            priority: 2,
          });
        }
      }
      this.markResuming(
        params.agenteId,
        woken.map((w) => w.espera_id),
      );
    }

    const lines: string[] = [
      "### Esperas Longas Despertadas (retomada automática)",
      "As esperas abaixo foram acordadas por esta rotina/webhook. Após resolver cada item com segurança, encerre-as com `close_wait(waitId)`:",
    ];

    for (const w of woken) {
      lines.push(
        `- **waitId**: \`${w.espera_id}\` | Aberta em: ${w.criado_em}\n  - **Pedido original**: ${w.pedido_texto}\n  - **Nota da espera**: ${w.nota}`,
      );
    }

    if (params.webhookPayload !== undefined) {
      const serialized =
        typeof params.webhookPayload === "string"
          ? params.webhookPayload
          : JSON.stringify(params.webhookPayload, null, 2);
      lines.push("", "#### Dados recebidos no evento/webhook:", "```json", serialized.slice(0, 6000), "```");
    }

    return {
      woken,
      promptBlock: lines.join("\n"),
    };
  }
}
