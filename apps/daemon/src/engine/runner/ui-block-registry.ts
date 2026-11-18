import { randomUUID } from "node:crypto";
import type {
  AskUserQuestion,
  ConversationUiBlock,
  MensagemChat,
  UiBlockSubmitPayload,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { ApiKeysBridge } from "../../vault/api-keys-bridge.ts";

export type UiBlockToolKind =
  | "ask_user"
  | "ask_ui"
  | "acknowledge_request"
  | "request_api_key";

export interface OpenBlockingBlockInput {
  agenteId: string;
  autorNome?: string;
  canalId: string;
  threadId?: string | null;
  turnoId: string;
  tipoFerramenta: UiBlockToolKind;
  spec: Record<string, unknown>;
  autoStartAfterMs?: number | null;
  conteudoMarkdown?: string;
}

export interface UiBlockResolutionResult {
  status: "answered" | "saved" | "closed" | "expired";
  actionId?: string;
  answers?: Record<string, string[] | string>;
  values?: Record<string, unknown>;
  name?: string;
  scope?: "todos_agentes" | "agente_especifico";
  autoAnswered?: boolean;
  reason?: string;
}

interface UiBlockRow {
  bloco_id: string;
  mensagem_id: string;
  canal_id: string;
  agente_id: string;
  turno_id: string;
  tipo_ferramenta: UiBlockToolKind;
  versao: number;
  spec_json: string;
  estado_json: string;
  status: "pending" | "answered" | "expired" | "closed";
  auto_responder_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

interface PendingResolverEntry {
  blocoId: string;
  canalId: string;
  resolve: (result: UiBlockResolutionResult) => void;
  timer: NodeJS.Timeout | null;
}

export class UiBlockHttpError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "UiBlockHttpError";
    this.statusCode = statusCode;
  }
}

export interface UiBlockRegistryOptions {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
  apiKeysBridge: ApiKeysBridge;
  getDefaultPlanStartAfterMs?: () => number | null;
}

/**
 * Orquestrador de blocos interativos bloqueantes no chat (Fase 14 - CHAT-02).
 * Suspende a execucao da tool ate que o usuario responda via POST /api/chat/ui-response
 * (ou ate o timer de acknowledge_request expirar), protegendo segredos com mascara e Cofre.
 */
export class UiBlockRegistry {
  private readonly db: CriativoDatabase;
  private readonly wsHub?: WebSocketHub;
  private readonly apiKeysBridge: ApiKeysBridge;
  private readonly getDefaultPlanStartAfterMs?: () => number | null;
  #pendingResolvers = new Map<string, PendingResolverEntry>();

  constructor(options: UiBlockRegistryOptions) {
    this.db = options.db;
    this.wsHub = options.wsHub;
    this.apiKeysBridge = options.apiKeysBridge;
    this.getDefaultPlanStartAfterMs = options.getDefaultPlanStartAfterMs;
    this.cleanupOrphanPendingBlocks();
  }

  /**
   * Marca blocos pendentes remanescentes de crash/reinicio anterior como 'expired'
   * para evitar cards fantasmas bloqueados na interface.
   */
  public cleanupOrphanPendingBlocks(): number {
    if (!this.db.hasTable("projecao_chat_ui_blocos")) return 0;

    const orphans = this.db.connection
      .prepare(
        `SELECT * FROM projecao_chat_ui_blocos WHERE status = 'pending';`,
      )
      .all() as unknown as UiBlockRow[];

    if (orphans.length === 0) return 0;

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      const updateBlock = this.db.connection.prepare(`
        UPDATE projecao_chat_ui_blocos
        SET status = 'expired',
            versao = versao + 1,
            estado_json = ?,
            atualizado_em = ?
        WHERE bloco_id = ?;
      `);
      const updateMsg = this.db.connection.prepare(`
        UPDATE projecao_conversas_chat
        SET ui_block_json = ?
        WHERE mensagem_id = ?;
      `);

      for (const row of orphans) {
        const estado = {
          ...this.safeParseRecord(row.estado_json),
          expiredOnBoot: true,
        };
        const updatedBlock = this.rowToConversationBlock({
          ...row,
          status: "expired",
          versao: Number(row.versao || 1) + 1,
          estado_json: JSON.stringify(estado),
          atualizado_em: agora,
        });
        updateBlock.run(JSON.stringify(estado), agora, row.bloco_id);
        updateMsg.run(JSON.stringify(updatedBlock), row.mensagem_id);
      }
    });

    return orphans.length;
  }

  private safeParseRecord(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private rowToConversationBlock(row: UiBlockRow): ConversationUiBlock {
    return {
      bloco_id: row.bloco_id,
      mensagem_id: row.mensagem_id,
      canal_id: row.canal_id,
      agente_id: row.agente_id,
      turno_id: row.turno_id,
      tipo_ferramenta: row.tipo_ferramenta,
      status: row.status,
      versao: Number(row.versao || 1),
      auto_responder_em: row.auto_responder_em,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
      spec: this.safeParseRecord(row.spec_json),
      estado: this.safeParseRecord(row.estado_json),
    };
  }

  private resolveDefaultMarkdown(
    tipoFerramenta: UiBlockToolKind,
    spec: Record<string, unknown>,
    explicit?: string,
  ): string {
    if (explicit && explicit.trim()) return explicit.trim();
    if (typeof spec.title === "string" && spec.title.trim()) {
      return spec.title.trim();
    }
    switch (tipoFerramenta) {
      case "ask_user":
        return "Preciso de algumas informacoes para continuar.";
      case "ask_ui":
        return "Confirme os parametros abaixo para prosseguir.";
      case "acknowledge_request":
        return "Plano pronto para inicio.";
      case "request_api_key":
        return `Solicitacao de chave segura: ${String(spec.name ?? "API_KEY")}`;
    }
  }

  public openBlockingBlock(input: OpenBlockingBlockInput): Promise<UiBlockResolutionResult> {
    const blocoId = randomUUID();
    const mensagemId = randomUUID();
    const agora = new Date().toISOString();

    let effectiveAutoMs: number | null = null;
    if (input.tipoFerramenta === "acknowledge_request") {
      if (input.autoStartAfterMs !== undefined) {
        effectiveAutoMs = input.autoStartAfterMs;
      } else if (typeof input.spec.planStartAfterMs === "number") {
        effectiveAutoMs = input.spec.planStartAfterMs;
      } else {
        effectiveAutoMs = this.getDefaultPlanStartAfterMs?.() ?? null;
      }
    }

    const autoResponderEm =
      effectiveAutoMs !== null && Number.isFinite(effectiveAutoMs) && effectiveAutoMs > 0
        ? new Date(Date.now() + effectiveAutoMs).toISOString()
        : null;

    const specWithAuto =
      input.tipoFerramenta === "acknowledge_request" && effectiveAutoMs !== null
        ? { ...input.spec, planStartAfterMs: effectiveAutoMs }
        : { ...input.spec };

    const bloco: ConversationUiBlock = {
      bloco_id: blocoId,
      mensagem_id: mensagemId,
      canal_id: input.canalId,
      agente_id: input.agenteId,
      turno_id: input.turnoId,
      tipo_ferramenta: input.tipoFerramenta,
      status: "pending",
      versao: 1,
      auto_responder_em: autoResponderEm,
      criado_em: agora,
      atualizado_em: agora,
      spec: specWithAuto,
      estado: {},
    };

    const threadId =
      input.threadId ??
      (input.canalId.startsWith("agente:")
        ? `main:${input.agenteId}`
        : input.canalId);

    const conteudoMarkdown = this.resolveDefaultMarkdown(
      input.tipoFerramenta,
      specWithAuto,
      input.conteudoMarkdown,
    );

    const autorNome = input.autorNome ?? this.lookupAgentName(input.agenteId);

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_chat_ui_blocos (
            bloco_id, mensagem_id, canal_id, agente_id, turno_id,
            tipo_ferramenta, versao, spec_json, estado_json, status,
            auto_responder_em, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, '{}', 'pending', ?, ?, ?);`,
        )
        .run(
          blocoId,
          mensagemId,
          input.canalId,
          input.agenteId,
          input.turnoId,
          input.tipoFerramenta,
          JSON.stringify(specWithAuto),
          autoResponderEm,
          agora,
          agora,
        );

      this.db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome,
            conteudo_markdown, anexos_json, steps_json, thread_id,
            turno_id, item_type, status, ui_block_json, lida, criado_em
          ) VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', ?, ?, 'ui-block', 'completed', ?, 1, ?);`,
        )
        .run(
          mensagemId,
          input.canalId,
          input.agenteId,
          autorNome,
          conteudoMarkdown,
          threadId,
          input.turnoId,
          JSON.stringify(bloco),
          agora,
        );
    });

    const chatMsg: MensagemChat = {
      mensagem_id: mensagemId,
      canal_id: input.canalId,
      agente_id: input.agenteId,
      autor: "agente",
      autor_nome: autorNome,
      conteudo_markdown: conteudoMarkdown,
      anexos: [],
      steps: [],
      thread_id: threadId,
      turno_id: input.turnoId,
      item_type: "ui-block",
      status: "completed",
      ui_block: bloco,
      lida: true,
      criado_em: agora,
    };

    this.wsHub?.broadcast("chat:message", {
      canal_id: input.canalId,
      agente_id: input.agenteId,
      mensagem: chatMsg,
    });
    this.wsHub?.broadcast("chat:ui_block", {
      canal_id: input.canalId,
      agente_id: input.agenteId,
      mensagem_id: mensagemId,
      bloco,
    });

    return new Promise<UiBlockResolutionResult>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      if (
        input.tipoFerramenta === "acknowledge_request" &&
        effectiveAutoMs !== null &&
        effectiveAutoMs > 0
      ) {
        timer = setTimeout(() => {
          this.autoResolveAcknowledgeBlock(blocoId);
        }, effectiveAutoMs);
        timer.unref?.();
      }

      this.#pendingResolvers.set(blocoId, {
        blocoId,
        canalId: input.canalId,
        resolve,
        timer,
      });
    });
  }

  private lookupAgentName(agenteId: string): string {
    try {
      const row = this.db.connection
        .prepare(`SELECT nome FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
        .get(agenteId) as { nome?: string } | undefined;
      return row?.nome ?? agenteId;
    } catch {
      return agenteId;
    }
  }

  private autoResolveAcknowledgeBlock(blocoId: string): void {
    const row = this.getBlockRow(blocoId);
    if (!row || row.status !== "pending") {
      this.clearPendingEntry(blocoId);
      return;
    }

    const estado = {
      actionId: "start",
      autoAnswered: true,
      answeredAt: new Date().toISOString(),
    };
    const updatedBlock = this.persistBlockTransition(row, "answered", estado);
    this.wsHub?.broadcast("chat:ui_block", {
      canal_id: updatedBlock.canal_id,
      agente_id: updatedBlock.agente_id,
      mensagem_id: updatedBlock.mensagem_id,
      bloco: updatedBlock,
    });

    const pending = this.clearPendingEntry(blocoId);
    pending?.resolve({
      status: "answered",
      actionId: "start",
      autoAnswered: true,
    });
  }

  private getBlockRow(blocoId: string): UiBlockRow | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_chat_ui_blocos WHERE bloco_id = ? LIMIT 1;`)
      .get(blocoId) as unknown as UiBlockRow | undefined;
    return row ?? null;
  }

  private clearPendingEntry(blocoId: string): PendingResolverEntry | null {
    const entry = this.#pendingResolvers.get(blocoId) ?? null;
    if (entry) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      this.#pendingResolvers.delete(blocoId);
    }
    return entry;
  }

  private persistBlockTransition(
    row: UiBlockRow,
    nextStatus: "answered" | "expired" | "closed",
    estado: Record<string, unknown>,
  ): ConversationUiBlock {
    const agora = new Date().toISOString();
    const nextVersion = Number(row.versao || 1) + 1;
    const estadoJson = JSON.stringify(estado);
    const updatedBlock = this.rowToConversationBlock({
      ...row,
      status: nextStatus,
      versao: nextVersion,
      estado_json: estadoJson,
      atualizado_em: agora,
    });

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `UPDATE projecao_chat_ui_blocos
           SET status = ?, versao = ?, estado_json = ?, atualizado_em = ?
           WHERE bloco_id = ?;`,
        )
        .run(nextStatus, nextVersion, estadoJson, agora, row.bloco_id);

      this.db.connection
        .prepare(
          `UPDATE projecao_conversas_chat
           SET ui_block_json = ?
           WHERE mensagem_id = ?;`,
        )
        .run(JSON.stringify(updatedBlock), row.mensagem_id);
    });

    return updatedBlock;
  }

  public submitUiResponse(payload: UiBlockSubmitPayload): {
    bloco: ConversationUiBlock;
    result: UiBlockResolutionResult;
  } {
    const blocoId = String(payload?.bloco_id ?? "").trim();
    if (!blocoId) {
      throw new UiBlockHttpError("bloco_id e obrigatorio.", 400);
    }

    const row = this.getBlockRow(blocoId);
    if (!row) {
      throw new UiBlockHttpError(`Bloco interativo '${blocoId}' nao encontrado.`, 404);
    }

    if (row.status !== "pending") {
      throw new UiBlockHttpError(
        `Este bloco interativo ja foi encerrado com status '${row.status}'.`,
        409,
      );
    }

    if (payload.acao === "skip" || payload.acao === "cancel") {
      const estado = {
        actionId: payload.acao,
        skipped: payload.acao === "skip",
        cancelled: payload.acao === "cancel",
        closedAt: new Date().toISOString(),
      };
      const updatedBlock = this.persistBlockTransition(row, "closed", estado);
      this.wsHub?.broadcast("chat:ui_block", {
        canal_id: updatedBlock.canal_id,
        agente_id: updatedBlock.agente_id,
        mensagem_id: updatedBlock.mensagem_id,
        bloco: updatedBlock,
      });

      const result: UiBlockResolutionResult = {
        status: "closed",
        actionId: payload.acao,
        reason: payload.acao,
      };
      const pending = this.clearPendingEntry(blocoId);
      pending?.resolve(result);
      return { bloco: updatedBlock, result };
    }

    const spec = this.safeParseRecord(row.spec_json);

    // 1. Fluxo de chave secreta no Cofre (request_api_key)
    if (row.tipo_ferramenta === "request_api_key" || payload.api_key_payload) {
      const keyPayload = payload.api_key_payload;
      const keyName = String(keyPayload?.nome ?? spec.name ?? "").trim();
      const keyValue = String(keyPayload?.valor ?? "");
      const keyScope =
        keyPayload?.escopo === "agente_especifico" ? "agente_especifico" : "todos_agentes";

      if (!keyValue.trim()) {
        throw new UiBlockHttpError("Informe o valor da chave de API antes de enviar.", 400);
      }

      const saved = this.apiKeysBridge.saveApiKey({
        name: keyName,
        value: keyValue,
        scope: keyScope,
        agenteId: row.agente_id,
        origemTurno: "usuario_local",
      });

      // Descarta completamente `valor` antes de gravar `estado_json` no SQLite
      const safeEstado = {
        actionId: "submit",
        values: {
          name: saved.name,
          scope: saved.scope,
        },
        saved: true,
        answeredAt: new Date().toISOString(),
      };

      const updatedBlock = this.persistBlockTransition(row, "answered", safeEstado);
      this.wsHub?.broadcast("chat:ui_block", {
        canal_id: updatedBlock.canal_id,
        agente_id: updatedBlock.agente_id,
        mensagem_id: updatedBlock.mensagem_id,
        bloco: updatedBlock,
      });

      const result: UiBlockResolutionResult = {
        status: "saved",
        actionId: "submit",
        name: saved.name,
        scope: saved.scope,
      };
      const pending = this.clearPendingEntry(blocoId);
      pending?.resolve(result);
      return { bloco: updatedBlock, result };
    }

    // 2. Fluxo de perguntas estruturadas (ask_user) com protecao para isSecret
    if (row.tipo_ferramenta === "ask_user") {
      const questions = Array.isArray(spec.questions)
        ? (spec.questions as AskUserQuestion[])
        : [];
      const secretIds = new Set<string>(
        questions.filter((q) => q && q.isSecret === true).map((q) => String(q.id)),
      );

      const incomingAnswers = payload.respostas_ask_user ?? {};
      const runtimeAnswers: Record<string, string[] | string> = {};
      const persistedAnswers: Record<string, string[] | string> = {};

      for (const [questionId, rawAnswer] of Object.entries(incomingAnswers)) {
        runtimeAnswers[questionId] = rawAnswer;
        if (secretIds.has(questionId)) {
          if (Array.isArray(rawAnswer)) {
            for (const val of rawAnswer) {
              this.apiKeysBridge.observeRuntimeSecret(String(val));
            }
            persistedAnswers[questionId] = rawAnswer.map(
              () => "[SEGREDO_PREENCHIDO_MASCARADO]",
            );
          } else {
            this.apiKeysBridge.observeRuntimeSecret(String(rawAnswer));
            persistedAnswers[questionId] = "[SEGREDO_PREENCHIDO_MASCARADO]";
          }
        } else {
          persistedAnswers[questionId] = rawAnswer;
        }
      }

      const safeEstado = {
        actionId: "answer",
        answers: persistedAnswers,
        answeredAt: new Date().toISOString(),
      };

      const updatedBlock = this.persistBlockTransition(row, "answered", safeEstado);
      this.wsHub?.broadcast("chat:ui_block", {
        canal_id: updatedBlock.canal_id,
        agente_id: updatedBlock.agente_id,
        mensagem_id: updatedBlock.mensagem_id,
        bloco: updatedBlock,
      });

      const result: UiBlockResolutionResult = {
        status: "answered",
        actionId: "answer",
        answers: runtimeAnswers,
      };
      const pending = this.clearPendingEntry(blocoId);
      pending?.resolve(result);
      return { bloco: updatedBlock, result };
    }

    // 3. Fluxos ask_ui e acknowledge_request
    const actionId = String(payload.ui_response?.actionId ?? "confirm");
    const values =
      payload.ui_response?.values && typeof payload.ui_response.values === "object"
        ? { ...payload.ui_response.values }
        : {};

    const safeEstado = {
      actionId,
      values,
      answeredAt: new Date().toISOString(),
    };
    const updatedBlock = this.persistBlockTransition(row, "answered", safeEstado);
    this.wsHub?.broadcast("chat:ui_block", {
      canal_id: updatedBlock.canal_id,
      agente_id: updatedBlock.agente_id,
      mensagem_id: updatedBlock.mensagem_id,
      bloco: updatedBlock,
    });

    const result: UiBlockResolutionResult = {
      status: "answered",
      actionId,
      values,
    };
    const pending = this.clearPendingEntry(blocoId);
    pending?.resolve(result);
    return { bloco: updatedBlock, result };
  }

  /**
   * Expira ou fecha blocos pendentes em um canal quando o usuario envia nova mensagem
   * pulando o card interativo ou quando o turno e abortado.
   */
  public expirePendingBlocksForCanal(
    canalId: string,
    reason: "skipped" | "expired" = "skipped",
  ): number {
    const pendingRows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_chat_ui_blocos WHERE canal_id = ? AND status = 'pending';`,
      )
      .all(canalId) as unknown as UiBlockRow[];

    if (pendingRows.length === 0) return 0;

    const nextStatus: "closed" | "expired" = reason === "skipped" ? "closed" : "expired";
    for (const row of pendingRows) {
      const estado = {
        ...this.safeParseRecord(row.estado_json),
        reason,
        closedAt: new Date().toISOString(),
      };
      const updatedBlock = this.persistBlockTransition(row, nextStatus, estado);
      this.wsHub?.broadcast("chat:ui_block", {
        canal_id: updatedBlock.canal_id,
        agente_id: updatedBlock.agente_id,
        mensagem_id: updatedBlock.mensagem_id,
        bloco: updatedBlock,
      });

      const pending = this.clearPendingEntry(row.bloco_id);
      pending?.resolve({
        status: nextStatus,
        reason,
      });
    }

    return pendingRows.length;
  }

  public getBlock(blocoId: string): ConversationUiBlock | null {
    const row = this.getBlockRow(blocoId);
    return row ? this.rowToConversationBlock(row) : null;
  }

  public dispose(): void {
    for (const [blocoId, entry] of this.#pendingResolvers.entries()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      entry.resolve({
        status: "expired",
        reason: "daemon_shutdown",
      });
      this.#pendingResolvers.delete(blocoId);
    }
  }
}
