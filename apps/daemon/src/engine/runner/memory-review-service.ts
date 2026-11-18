/**
 * Serviço de Revisão Automática de Memória em segundo plano (`MemoryReviewService` — LRN-01).
 * Dispara por intervalo de turnos (padrão 20), por inatividade (15 min com >= 3 turnos novos)
 * ou ao limpar/encerrar conversa, sem competir com turnos interativos do usuário.
 */
import { randomUUID } from "node:crypto";
import type {
  MemoriaInclusao,
  MemoryReviewAlteracao,
  PassoChat,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import type { MemoryManager } from "./memory-manager.ts";
import type { DetectedSkillSignal, SkillLearningService } from "./skill-learning-service.ts";

export const DEFAULT_MEMORY_REVIEW_INTERVAL = 20;
export const MEMORY_REVIEW_IDLE_MS = 15 * 60_000;
export const MEMORY_REVIEW_IDLE_TURNS = 3;

export interface MemoryReviewServiceDeps {
  db: CriativoDatabase;
  memoryManager: MemoryManager;
  skillLearning?: SkillLearningService;
  providers: ProviderRegistry;
  providerConnection?: ProviderConnectionService;
  wsHub?: WebSocketHub;
  redactSecrets?: (text: string) => string;
  isInteractiveSlotBusy?: () => boolean;
  idleTimeoutMs?: number;
}

interface ReviewQueueItem {
  chave: string;
  agenteId: string;
  threadId: string | null;
  canalId: string;
}

interface ParsedReviewJson {
  memories?: Array<{
    op?: "save" | "update" | "forget";
    memoriaId?: string;
    texto?: string;
    categoria?: MemoriaInclusao;
    escopoSite?: string | null;
  }>;
  skill?: {
    action?: "create" | "update";
    skillId?: string | null;
    name?: string;
    message?: string;
  } | null;
}

function extractFirstJsonObject(raw: string): ParsedReviewJson | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]!.trim() : raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ParsedReviewJson;
  } catch {
    return null;
  }
}

export class MemoryReviewService {
  private readonly db: CriativoDatabase;
  private readonly memoryManager: MemoryManager;
  private skillLearning?: SkillLearningService;
  private readonly providers: ProviderRegistry;
  private readonly providerConnection?: ProviderConnectionService;
  private readonly wsHub?: WebSocketHub;
  private readonly redactSecrets: (text: string) => string;
  private readonly isInteractiveSlotBusy: () => boolean;
  private readonly idleTimeoutMs: number;

  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly workStepsByKey = new Map<string, PassoChat[]>();
  private readonly pendingQueue: ReviewQueueItem[] = [];
  private running = false;
  private retrySlotTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(deps: MemoryReviewServiceDeps) {
    this.db = deps.db;
    this.memoryManager = deps.memoryManager;
    this.skillLearning = deps.skillLearning;
    this.providers = deps.providers;
    this.providerConnection = deps.providerConnection;
    this.wsHub = deps.wsHub;
    this.redactSecrets = deps.redactSecrets ?? ((t) => t);
    this.isInteractiveSlotBusy = deps.isInteractiveSlotBusy ?? (() => false);
    this.idleTimeoutMs = deps.idleTimeoutMs ?? MEMORY_REVIEW_IDLE_MS;
  }

  public setSkillLearningService(svc: SkillLearningService): void {
    this.skillLearning = svc;
  }

  public static buildCursorKey(agenteId: string, threadId?: string | null): string {
    const norm = threadId && !threadId.startsWith("main:") ? threadId : "main";
    return `${agenteId}:${norm}`;
  }

  public getConfiguredInterval(): number {
    try {
      const row = this.db.connection
        .prepare(
          "SELECT valor_json FROM projecao_studio_config WHERE chave = 'memory_review_interval' LIMIT 1;",
        )
        .get() as { valor_json?: string } | undefined;
      if (row?.valor_json !== undefined) {
        const num = Number(JSON.parse(row.valor_json));
        if (Number.isFinite(num) && num >= 0 && num <= 500) {
          return Math.floor(num);
        }
      }
    } catch {
      // ignora
    }
    return DEFAULT_MEMORY_REVIEW_INTERVAL;
  }

  private clearIdleTimer(chave: string): void {
    const existing = this.idleTimers.get(chave);
    if (existing) {
      clearTimeout(existing);
      this.idleTimers.delete(chave);
    }
  }

  private readCursorRow(chave: string): {
    ultimo_mensagem_id: string;
    turnos_desde_revisao: number;
    atualizado_em: string;
  } | null {
    const row = this.db.connection
      .prepare(
        "SELECT ultimo_mensagem_id, turnos_desde_revisao, atualizado_em FROM projecao_memory_review_cursores WHERE chave = ? LIMIT 1;",
      )
      .get(chave) as
      | { ultimo_mensagem_id: string; turnos_desde_revisao: number; atualizado_em: string }
      | undefined;
    return row ?? null;
  }

  /**
   * Registra conclusão de um turno e agenda/dispara revisão conforme intervalo e ociosidade.
   */
  public recordCompletedTurn(params: {
    agenteId: string;
    threadId?: string | null;
    canalId?: string;
    lastMessageId: string;
    workSteps?: PassoChat[];
  }): void {
    if (this.disposed) return;

    const normThread = params.threadId && !params.threadId.startsWith("main:") ? params.threadId : null;
    const chave = MemoryReviewService.buildCursorKey(params.agenteId, normThread);
    const canalId = params.canalId ?? (normThread ? `thread:${normThread}` : `agente:${params.agenteId}`);
    const agora = new Date().toISOString();

    if (params.workSteps && params.workSteps.length > 0) {
      const prev = this.workStepsByKey.get(chave) ?? [];
      this.workStepsByKey.set(chave, [...prev, ...params.workSteps].slice(-80));
    }

    const current = this.readCursorRow(chave);
    const nextTurns = (current?.turnos_desde_revisao ?? 0) + 1;

    this.db.connection
      .prepare(
        `INSERT INTO projecao_memory_review_cursores (
          chave, agente_id, thread_id, ultimo_mensagem_id, turnos_desde_revisao, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chave) DO UPDATE SET
          turnos_desde_revisao = excluded.turnos_desde_revisao,
          atualizado_em = excluded.atualizado_em;`,
      )
      .run(
        chave,
        params.agenteId,
        normThread,
        current?.ultimo_mensagem_id ?? "",
        nextTurns,
        agora,
      );

    const interval = this.getConfiguredInterval();
    this.clearIdleTimer(chave);

    if (interval === 0) {
      return;
    }

    if (nextTurns >= interval) {
      this.enqueueBackgroundReview({ chave, agenteId: params.agenteId, threadId: normThread, canalId });
      return;
    }

    if (nextTurns >= MEMORY_REVIEW_IDLE_TURNS) {
      const timer = setTimeout(() => {
        this.idleTimers.delete(chave);
        if (!this.disposed) {
          this.enqueueBackgroundReview({
            chave,
            agenteId: params.agenteId,
            threadId: normThread,
            canalId,
          });
        }
      }, this.idleTimeoutMs);
      timer.unref?.();
      this.idleTimers.set(chave, timer);
    }
  }

  public async onChatCleared(agenteId: string, canalId?: string): Promise<MemoryReviewAlteracao[]> {
    const chave = MemoryReviewService.buildCursorKey(agenteId, null);
    this.clearIdleTimer(chave);
    const cur = this.readCursorRow(chave);
    if (!cur || cur.turnos_desde_revisao <= 0) {
      return [];
    }
    return await this.triggerNow(agenteId, null, canalId ?? `agente:${agenteId}`);
  }

  public async onThreadClosed(
    agenteId: string,
    threadId: string,
    canalId?: string,
  ): Promise<MemoryReviewAlteracao[]> {
    const chave = MemoryReviewService.buildCursorKey(agenteId, threadId);
    this.clearIdleTimer(chave);
    const cur = this.readCursorRow(chave);
    if (!cur || cur.turnos_desde_revisao <= 0) {
      return [];
    }
    return await this.triggerNow(agenteId, threadId, canalId ?? `thread:${threadId}`);
  }

  private enqueueBackgroundReview(item: ReviewQueueItem): void {
    if (!this.pendingQueue.some((q) => q.chave === item.chave)) {
      this.pendingQueue.push(item);
    }
    void this.drainBackgroundReviews();
  }

  private async drainBackgroundReviews(): Promise<void> {
    if (this.running || this.disposed) return;
    if (this.pendingQueue.length === 0) return;

    if (this.isInteractiveSlotBusy()) {
      if (!this.retrySlotTimer) {
        this.retrySlotTimer = setTimeout(() => {
          this.retrySlotTimer = null;
          void this.drainBackgroundReviews();
        }, 2000);
        this.retrySlotTimer.unref?.();
      }
      return;
    }

    this.running = true;
    try {
      while (this.pendingQueue.length > 0 && !this.disposed) {
        if (this.isInteractiveSlotBusy()) {
          break;
        }
        const next = this.pendingQueue.shift()!;
        try {
          await this.triggerNow(next.agenteId, next.threadId, next.canalId);
        } catch {
          // Falha silenciosa em background sem derrubar o daemon
        }
      }
    } finally {
      this.running = false;
      if (this.pendingQueue.length > 0 && !this.disposed) {
        this.retrySlotTimer = setTimeout(() => {
          this.retrySlotTimer = null;
          void this.drainBackgroundReviews();
        }, 2500);
        this.retrySlotTimer.unref?.();
      }
    }
  }

  private async invokeModelText(
    modeloPadrao: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string | null> {
    try {
      const client = this.providers.getClientForModel(modeloPadrao);
      if (this.providerConnection) {
        const providerName = this.providers.resolveProviderName(modeloPadrao);
        const statuses = await this.providerConnection.getProvidersStatus(false);
        const st = statuses.find((s) => s.provedor === providerName);
        if (st && !st.conectado && !st.vault_configurado) {
          return null;
        }
      }
      return await client.generateText(userPrompt, systemPrompt);
    } catch {
      return null;
    }
  }

  /**
   * Executa imediatamente um ciclo completo de revisão de memórias e detecção de habilidades pós-cursor.
   */
  public async triggerNow(
    agenteId: string,
    threadId?: string | null,
    canalId?: string,
  ): Promise<MemoryReviewAlteracao[]> {
    const normThread = threadId && !threadId.startsWith("main:") ? threadId : null;
    const effectiveThreadKey = normThread ?? `main:${agenteId}`;
    const resolvedCanal = canalId ?? (normThread ? `thread:${normThread}` : `agente:${agenteId}`);
    const chave = MemoryReviewService.buildCursorKey(agenteId, normThread);
    this.clearIdleTimer(chave);

    const agente = this.db.connection
      .prepare("SELECT agente_id, nome, papel, modelo_padrao FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(agenteId) as
      | { agente_id: string; nome: string; papel: string; modelo_padrao: string }
      | undefined;
    if (!agente) return [];

    const cursor = this.readCursorRow(chave);
    let cursorTimestamp = "";
    if (cursor?.ultimo_mensagem_id) {
      const msgRow = this.db.connection
        .prepare("SELECT criado_em FROM projecao_conversas_chat WHERE mensagem_id = ? LIMIT 1;")
        .get(cursor.ultimo_mensagem_id) as { criado_em?: string } | undefined;
      cursorTimestamp = msgRow?.criado_em ?? "";
    }

    const rawMessages = this.db.connection
      .prepare(
        `SELECT mensagem_id, autor, conteudo_markdown, steps_json, criado_em
         FROM projecao_conversas_chat
         WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
           AND COALESCE(item_type, 'mensagem') = 'mensagem'
           AND (? = '' OR criado_em > ? OR (criado_em = ? AND mensagem_id != ?))
         ORDER BY criado_em ASC, COALESCE(ordinal, 0) ASC
         LIMIT 80;`,
      )
      .all(
        effectiveThreadKey,
        resolvedCanal,
        cursorTimestamp,
        cursorTimestamp,
        cursorTimestamp,
        cursor?.ultimo_mensagem_id ?? "",
      ) as Array<{
      mensagem_id: string;
      autor: string;
      conteudo_markdown: string;
      steps_json: string | null;
      criado_em: string;
    }>;

    if (rawMessages.length === 0) {
      return [];
    }

    const lastMsgId = rawMessages[rawMessages.length - 1]!.mensagem_id;
    const collectedSteps: PassoChat[] = [...(this.workStepsByKey.get(chave) ?? [])];
    for (const m of rawMessages) {
      if (m.steps_json) {
        try {
          const parsed = JSON.parse(m.steps_json) as PassoChat[];
          if (Array.isArray(parsed)) {
            collectedSteps.push(...parsed);
          }
        } catch {
          // ignora steps inválidos
        }
      }
    }
    const trimmedSteps = collectedSteps.slice(-80);

    const currentMemories = this.memoryManager.listMemories(agenteId, 60);
    const earlierSuggestions = this.skillLearning
      ? this.skillLearning.listRecentSuggestions(agenteId, 5)
      : [];

    const transcriptText = rawMessages
      .map((m) => `[${m.autor}]: ${this.redactSecrets(m.conteudo_markdown).slice(0, 2000)}`)
      .join("\n\n");

    const stepsSummary = trimmedSteps
      .map(
        (s) =>
          `- ${s.titulo} [${s.status}]${s.detalhes ? `: ${this.redactSecrets(s.detalhes).slice(0, 300)}` : ""}`,
      )
      .join("\n");

    const systemPrompt = [
      `Você é o revisor silencioso de memória e aprendizado contínuo do agente ${agente.nome} (${agente.papel}).`,
      "Analise os turnos recentes e retorne APENAS um objeto JSON válido com o formato:",
      `{"memories":[{"op":"save"|"update"|"forget","memoriaId":"opcional","texto":"fato durável conciso em pt-br","categoria":"essential"|"searchable","escopoSite":"dominio.com opcional"}],"skill":null|{"action":"create"|"update","skillId":null,"name":"Nome da Habilidade","message":"Justificativa curta em 1-2 frases em pt-br"}}`,
      "Regras:",
      "- Nunca inclua chaves de API, senhas ou dados temporários descartáveis.",
      "- Use 'essential' apenas para preferências recorrentes críticas da marca/usuário; use 'searchable' para aprendizados pontuais ou regras de um site específico.",
      "- Só preencha 'skill' se houver correção clara de método recorrente ou solução técnica reutilizável.",
    ].join("\n");

    const userPrompt = [
      `<existing_memories>\n${currentMemories
        .map(
          (m) =>
            `- id=${m.memoria_id} [${m.categoria}${m.controlado_usuario ? ",user_locked" : ""}${m.escopo_site ? `,site:${m.escopo_site}` : ""}]: ${this.redactSecrets(m.texto)}`,
        )
        .join("\n")}\n</existing_memories>`,
      `<earlier_skill_questions>\n${earlierSuggestions
        .map((s) => `- [${s.acao}] ${s.nome_skill}: ${s.pergunta_markdown}`)
        .join("\n")}\n</earlier_skill_questions>`,
      `<work_steps>\n${stepsSummary || "(nenhum passo)"}\n</work_steps>`,
      `<recent_conversation>\n${transcriptText}\n</recent_conversation>`,
    ].join("\n\n");

    const rawReply = await this.invokeModelText(agente.modelo_padrao, systemPrompt, userPrompt);
    const agora = new Date().toISOString();

    if (!rawReply) {
      return [];
    }

    const parsed = extractFirstJsonObject(rawReply);
    const reviewTurnId = `memrev-${randomUUID().slice(0, 8)}`;

    const validOps = (parsed?.memories ?? [])
      .filter((m) => m && (m.op === "save" || m.op === "update" || m.op === "forget"))
      .map((m) => ({
        op: m.op!,
        memoriaId: m.memoriaId,
        texto: m.texto ? this.redactSecrets(m.texto) : undefined,
        categoria: m.categoria,
        escopoSite: m.escopoSite ?? null,
      }));

    const alteracoes =
      validOps.length > 0
        ? this.memoryManager.applyReviewOperations(agenteId, reviewTurnId, validOps)
        : [];

    // Atualiza cursor persistido para não reprocessar as mesmas mensagens em reinícios futuros
    this.db.connection
      .prepare(
        `INSERT INTO projecao_memory_review_cursores (
          chave, agente_id, thread_id, ultimo_mensagem_id, turnos_desde_revisao, atualizado_em
        ) VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(chave) DO UPDATE SET
          ultimo_mensagem_id = excluded.ultimo_mensagem_id,
          turnos_desde_revisao = 0,
          atualizado_em = excluded.atualizado_em;`,
      )
      .run(chave, agenteId, normThread, lastMsgId, agora);

    this.workStepsByKey.delete(chave);

    if (alteracoes.length > 0) {
      const resumo = alteracoes
        .map((a) => {
          const verb =
            a.acao === "saved" ? "salva" : a.acao === "updated" ? "atualizada" : "removida";
          return `${verb}: ${a.texto}`;
        })
        .join(" · ")
        .slice(0, 400);

      const sysMsgId = `memchg-${randomUUID().slice(0, 10)}`;
      this.db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, lida, criado_em,
            thread_id, item_type, metadados_json
          ) VALUES (?, ?, ?, 'sistema', 'Memória Automática', ?, '[]', '[]', NULL, 1, ?, ?, 'memory-changes', ?);`,
        )
        .run(
          sysMsgId,
          resolvedCanal,
          agenteId,
          `Memórias revisadas (${alteracoes.length}) — ${resumo}`,
          agora,
          effectiveThreadKey,
          JSON.stringify({ memory_changes: alteracoes }),
        );

      this.wsHub?.broadcast("memory:reviewed", {
        agente_id: agenteId,
        thread_id: normThread,
        alteracoes,
      });
    }

    if (
      this.skillLearning &&
      parsed?.skill &&
      (parsed.skill.action === "create" || parsed.skill.action === "update") &&
      parsed.skill.name &&
      parsed.skill.message
    ) {
      const signal: DetectedSkillSignal = {
        acao: parsed.skill.action,
        skillId: parsed.skill.skillId ?? null,
        nomeSkill: this.redactSecrets(parsed.skill.name).trim(),
        perguntaMarkdown: this.redactSecrets(parsed.skill.message).trim(),
      };
      await this.skillLearning.handleDetectedSignal({
        agenteId,
        threadId: normThread,
        canalId: resolvedCanal,
        signal,
        workSteps: trimmedSteps,
        generateTextFn: (sys, usr) => this.invokeModelText(agente.modelo_padrao, sys, usr),
      });
    }

    return alteracoes;
  }

  public dispose(): void {
    this.disposed = true;
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    if (this.retrySlotTimer) {
      clearTimeout(this.retrySlotTimer);
      this.retrySlotTimer = null;
    }
    this.pendingQueue.length = 0;
  }
}
