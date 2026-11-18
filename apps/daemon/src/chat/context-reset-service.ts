import { randomUUID } from "node:crypto";
import type { MensagemChat } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { MemoryManager } from "../engine/runner/memory-manager.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";

export interface ContextResetServiceDeps {
  db: CriativoDatabase;
  wsHub: WebSocketHub;
  providers?: ProviderRegistry;
  providerConnection?: ProviderConnectionService;
}

/**
 * Gerencia `start_new_chat` e a rotação limpa de contexto do modelo (`context_cutoff_at`)
 * preservando integralmente o histórico visual no SQLite e consolidando memórias essenciais.
 */
export class ContextResetService {
  private readonly db: CriativoDatabase;
  private readonly wsHub: WebSocketHub;
  private readonly memoryManager: MemoryManager;
  private readonly pendingNewChatByAgent = new Set<string>();

  constructor(deps: ContextResetServiceDeps) {
    this.db = deps.db;
    this.wsHub = deps.wsHub;
    this.memoryManager = new MemoryManager(deps.db);
  }

  private getAgentRow(agenteId: string): {
    agente_id: string;
    nome: string;
    config_json: string;
  } {
    const row = this.db.connection
      .prepare("SELECT agente_id, nome, config_json FROM projecao_agentes WHERE agente_id = ?;")
      .get(agenteId) as { agente_id: string; nome: string; config_json: string } | undefined;
    if (!row) {
      throw new Error(`Agente não encontrado: ${agenteId}`);
    }
    return row;
  }

  private parseConfig(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  public requestNewChat(ctx: { agenteId: string; threadId?: string | null }): {
    status: "requested";
    note: string;
  } {
    if (ctx.threadId && !ctx.threadId.startsWith("main:")) {
      throw new Error(
        "A ferramenta start_new_chat só pode ser utilizada no chat principal do agente (não em sub-tarefas ou canais).",
      );
    }

    const row = this.getAgentRow(ctx.agenteId);
    const cfg = this.parseConfig(row.config_json);
    if (cfg.allow_new_chat === false) {
      throw new Error(
        `A configuração atual do agente '${ctx.agenteId}' desabilita start_new_chat automático (allow_new_chat: false).`,
      );
    }

    this.pendingNewChatByAgent.add(ctx.agenteId);
    return {
      status: "requested",
      note: "Rotação de contexto agendada para o término do turno atual assim que a fila não-rotina estiver livre.",
    };
  }

  public hasPendingReset(agenteId: string): boolean {
    return this.pendingNewChatByAgent.has(agenteId);
  }

  public flushPendingResetIfIdle(agenteId: string, excludeEntregaId?: string): {
    executed: boolean;
    cutoff_at?: string;
    mensagem_divisor?: MensagemChat;
  } {
    if (!this.pendingNewChatByAgent.has(agenteId)) {
      return { executed: false };
    }
    const res = this.executeContextReset(agenteId, { excludeEntregaId });
    if (res.delayed) {
      return { executed: false };
    }
    return {
      executed: true,
      cutoff_at: res.cutoff_at,
      mensagem_divisor: res.mensagem_divisor,
    };
  }

  public executeContextReset(
    agenteId: string,
    options?: { forceImmediate?: boolean; excludeEntregaId?: string },
  ): {
    delayed?: boolean;
    cutoff_at: string;
    mensagem_divisor?: MensagemChat;
    memorias_salvas: number;
  } {
    const row = this.getAgentRow(agenteId);
    const cfg = this.parseConfig(row.config_json);
    const previousCutoff =
      typeof cfg.context_cutoff_at === "string" && cfg.context_cutoff_at.length > 0
        ? cfg.context_cutoff_at
        : null;

    if (!options?.forceImmediate) {
      const pendingNonRoutine = this.db.connection
        .prepare(
          `
          SELECT COUNT(*) AS total
          FROM projecao_fila_chat
          WHERE agente_id = ?
            AND thread_id IS NULL
            AND status IN ('enfileirada', 'iniciando', 'executando')
            AND remetente_tipo != 'rotina'
            AND (? IS NULL OR entrega_id != ?);
        `,
        )
        .get(
          agenteId,
          options?.excludeEntregaId ?? null,
          options?.excludeEntregaId ?? null,
        ) as { total: number };

      if (pendingNonRoutine.total > 0) {
        this.pendingNewChatByAgent.add(agenteId);
        return {
          delayed: true,
          cutoff_at: previousCutoff ?? "",
          memorias_salvas: 0,
        };
      }
    }

    const threadId = `main:${agenteId}`;
    const canalId = `agente:${agenteId}`;

    const recentMessages = this.db.connection
      .prepare(
        `
        SELECT autor, conteudo_markdown, criado_em
        FROM projecao_conversas_chat
        WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
          AND COALESCE(item_type, 'mensagem') = 'mensagem'
          AND COALESCE(status, 'completed') != 'streaming'
          AND (? IS NULL OR criado_em > ?)
        ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC
        LIMIT 20;
      `,
      )
      .all(threadId, canalId, previousCutoff, previousCutoff) as Array<{
      autor: string;
      conteudo_markdown: string;
      criado_em: string;
    }>;

    // Extrai síntese estruturada dos objetivos/decisões recentes antes do corte de contexto
    let memoriasSalvas = 0;
    const userPoints = recentMessages
      .filter((m) => m.autor === "usuario" && m.conteudo_markdown.trim().length > 8)
      .slice(0, 2)
      .map((m) => m.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 180));
    const agentPoints = recentMessages
      .filter((m) => m.autor === "agente" && m.conteudo_markdown.trim().length > 8)
      .slice(0, 1)
      .map((m) => m.conteudo_markdown.trim().replace(/\s+/g, " ").slice(0, 180));

    for (const point of [...userPoints, ...agentPoints]) {
      const saved = this.memoryManager.addMemory(agenteId, `[Contexto anterior]: ${point}`, "automatica");
      if (saved) memoriasSalvas += 1;
    }

    const cutoffAt = new Date().toISOString();
    const dividerMsgId = `msg-reset-${randomUUID().slice(0, 8)}`;
    const dividerText =
      "Novo chat iniciado — contexto do modelo reiniciado · histórico visual preservado";

    const mensagemDivisor: MensagemChat = {
      mensagem_id: dividerMsgId,
      canal_id: canalId,
      agente_id: agenteId,
      autor: "sistema",
      autor_nome: "Sistema",
      conteudo_markdown: dividerText,
      anexos: [],
      steps: [],
      tarefa_id: null,
      thread_id: threadId,
      item_type: "context_reset",
      status: "completed",
      ordinal: 0,
      metadados: { cutoff_at: cutoffAt, memorias_salvas: memoriasSalvas },
      lida: true,
      criado_em: cutoffAt,
    };

    this.db.runInTransaction(() => {
      const updatedConfig = {
        ...cfg,
        context_cutoff_at: cutoffAt,
        sessao_provedor_id: null,
      };
      this.db.connection
        .prepare("UPDATE projecao_agentes SET config_json = ?, atualizado_em = ? WHERE agente_id = ?;")
        .run(JSON.stringify(updatedConfig), cutoffAt, agenteId);

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, lida, criado_em,
            thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
            ordinal, branch_origem_mensagem_id, metadados_json
          ) VALUES (?, ?, ?, 'sistema', 'Sistema', ?, '[]', '[]', NULL, 1, ?, ?, NULL, 'context_reset', 'completed', NULL, 0, NULL, ?);
        `,
        )
        .run(
          dividerMsgId,
          canalId,
          agenteId,
          dividerText,
          cutoffAt,
          threadId,
          JSON.stringify(mensagemDivisor.metadados),
        );

      this.db.connection
        .prepare(
          `
          INSERT INTO eventos_orquestracao (
            evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
          ) VALUES (?, ?, 'agente', ?, 'contexto_reiniciado', ?, ?);
        `,
        )
        .run(
          randomUUID(),
          `reset:${randomUUID()}`,
          agenteId,
          cutoffAt,
          JSON.stringify({ cutoff_at: cutoffAt, memorias_salvas: memoriasSalvas }),
        );
    });

    this.pendingNewChatByAgent.delete(agenteId);

    this.wsHub.broadcast("context:reset", {
      agente_id: agenteId,
      thread_id: threadId,
      cutoff_at: cutoffAt,
      mensagem_divisor: mensagemDivisor,
    });
    this.wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agenteId,
      mensagem: mensagemDivisor,
    });

    return {
      cutoff_at: cutoffAt,
      mensagem_divisor: mensagemDivisor,
      memorias_salvas: memoriasSalvas,
    };
  }
}
