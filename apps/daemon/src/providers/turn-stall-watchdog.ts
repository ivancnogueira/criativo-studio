/**
 * Watchdog inteligente de inatividade ("stall detector") e rastreador de ferramentas MCP em execução.
 *
 * Inspirado no padrão do OpenBot (`acp-client.ts`, `claude-client.ts` e `app-server-client.ts`):
 * - Sem teto total de duração de turno (agentes podem trabalhar por horas).
 * - Detecta apenas silêncio real sem progresso.
 * - Pausa automaticamente enquanto houver ferramenta MCP ou `tool_call` ACP em andamento.
 * - Compensa hibernação/suspensão do sistema operacional para evitar falso timeout.
 */

export const DEFAULT_ACP_STALL_MS = 10 * 60_000;
export const DEFAULT_CLI_TURN_STALL_MS = 15 * 60_000;
export const DEFAULT_CLI_TOOL_STALL_MS = 60 * 60_000;

const activeMcpCallsByAgent = new Map<string, number>();
const lastMcpActivityByAgent = new Map<string, number>();
let globalActiveMcpCalls = 0;
let globalLastMcpActivityAt = 0;

export function normalizeAgentKey(agentId?: string | null): string {
  const clean = agentId?.trim();
  return clean && clean.length > 0 ? clean : "*";
}

/**
 * Envolve a execução de uma ferramenta no Studio MCP Bridge para que os motores
 * ACP e CLI saibam que há uma ferramenta pesada em andamento (ex.: FFmpeg, Remotion, Whisper).
 */
export async function trackMcpToolExecution<T>(
  agentId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const key = normalizeAgentKey(agentId);
  const startNow = Date.now();
  activeMcpCallsByAgent.set(key, (activeMcpCallsByAgent.get(key) ?? 0) + 1);
  lastMcpActivityByAgent.set(key, startNow);
  globalActiveMcpCalls += 1;
  globalLastMcpActivityAt = startNow;

  try {
    return await fn();
  } finally {
    const endNow = Date.now();
    const nextCount = Math.max(0, (activeMcpCallsByAgent.get(key) ?? 0) - 1);
    if (nextCount === 0) {
      activeMcpCallsByAgent.delete(key);
    } else {
      activeMcpCallsByAgent.set(key, nextCount);
    }
    lastMcpActivityByAgent.set(key, endNow);
    globalActiveMcpCalls = Math.max(0, globalActiveMcpCalls - 1);
    globalLastMcpActivityAt = endNow;
  }
}

export function hasActiveMcpToolForAgent(agentId?: string | null): boolean {
  const clean = agentId?.trim();
  if (clean && clean.length > 0) {
    return (activeMcpCallsByAgent.get(clean) ?? 0) > 0;
  }
  return globalActiveMcpCalls > 0;
}

export function getLastMcpActivityAt(agentId?: string | null): number {
  const clean = agentId?.trim();
  if (clean && clean.length > 0) {
    return lastMcpActivityByAgent.get(clean) ?? 0;
  }
  return globalLastMcpActivityAt;
}

export interface TurnStallWatchdogOptions {
  stallMs: number;
  /** Limite quando uma tool está rodando. `null` pausa o stall indefinidamente durante a tool. */
  toolStallMs?: number | null;
  isToolRunning?: () => boolean;
  getExternalActivityAt?: () => number;
  probeAlive?: () => Promise<boolean>;
  maxSilentProbes?: number;
  checkIntervalMs?: number;
  sleepCompensationThresholdMs?: number;
  onStall: (info: { silentMs: number; limitMs: number; toolRunning: boolean }) => void;
}

export interface TurnStallWatchdogHandle {
  touch(): void;
  stop(): void;
  isStopped(): boolean;
}

export function createTurnStallWatchdog(options: TurnStallWatchdogOptions): TurnStallWatchdogHandle {
  const stallMs = Math.max(10, options.stallMs);
  const toolStallMs = options.toolStallMs === undefined ? null : options.toolStallMs;
  const maxSilentProbes = options.maxSilentProbes ?? 2;
  const checkIntervalMs =
    options.checkIntervalMs ?? Math.min(30_000, Math.max(25, Math.floor(stallMs / 3)));
  const sleepThresholdMs =
    options.sleepCompensationThresholdMs ?? Math.max(checkIntervalMs * 2, 15_000);

  let lastActivityAt = Date.now();
  let lastCheckAt = lastActivityAt;
  let consecutiveProbes = 0;
  let probing = false;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };

  const triggerStall = (silentMs: number, limitMs: number, toolRunning: boolean) => {
    if (stopped) return;
    stop();
    options.onStall({ silentMs, limitMs, toolRunning });
  };

  const check = async () => {
    if (stopped || probing) return;

    const now = Date.now();
    const asleep = now - lastCheckAt - checkIntervalMs;
    lastCheckAt = now;
    if (asleep > sleepThresholdMs) {
      lastActivityAt = Math.min(now, lastActivityAt + asleep);
    }

    if (options.getExternalActivityAt) {
      const extAt = options.getExternalActivityAt();
      if (extAt > lastActivityAt) {
        lastActivityAt = extAt;
        consecutiveProbes = 0;
      }
    }

    const toolRunning = Boolean(options.isToolRunning?.());
    if (toolRunning && toolStallMs === null) {
      return;
    }

    const limitMs =
      toolRunning && typeof toolStallMs === "number" ? Math.max(10, toolStallMs) : stallMs;
    const silentMs = now - lastActivityAt;
    if (silentMs < limitMs) {
      return;
    }

    if (!toolRunning && options.probeAlive && consecutiveProbes < maxSilentProbes) {
      probing = true;
      let alive = false;
      try {
        alive = await options.probeAlive();
      } catch {
        alive = false;
      } finally {
        probing = false;
      }
      if (stopped) return;
      if (alive) {
        consecutiveProbes += 1;
        lastActivityAt = Date.now();
        return;
      }
    }

    triggerStall(silentMs, limitMs, toolRunning);
  };

  const timer = setInterval(() => {
    void check();
  }, checkIntervalMs);
  timer.unref?.();

  return {
    touch: () => {
      if (stopped) return;
      lastActivityAt = Date.now();
      consecutiveProbes = 0;
    },
    stop,
    isStopped: () => stopped,
  };
}

export interface AcpToolStepEvent {
  id: string;
  toolName: string;
  title: string;
  status: "executando" | "concluido" | "erro";
  duracaoMs?: number;
}

export function formatAcpToolStepTitle(raw: {
  title?: unknown;
  name?: unknown;
  kind?: unknown;
}): { toolName: string; title: string } {
  const rawTitle = typeof raw.title === "string" ? raw.title.trim() : "";
  const rawName = typeof raw.name === "string" ? raw.name.trim() : "";
  const rawKind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  const toolName = (rawName || rawKind || "acp_tool").slice(0, 60);
  const title = (rawTitle || rawName || rawKind || "Executando ferramenta").slice(0, 110);
  return { toolName, title };
}

/**
 * Gerencia separação visual de blocos entre rodadas de ferramentas/pensamento ACP
 * e traduz eventos `tool_call` / `tool_call_update` em etapas estruturadas do chat.
 */
export function createAcpStreamPresentation() {
  const toolStartedAt = new Map<string, number>();
  let onToolStep: ((step: AcpToolStepEvent) => void) | null = null;
  let hasEmittedText = false;
  let needsParagraphBreak = false;
  let lastTextTail = "";

  const reset = (listener?: ((step: AcpToolStepEvent) => void) | null) => {
    toolStartedAt.clear();
    onToolStep = listener ?? null;
    hasEmittedText = false;
    needsParagraphBreak = false;
    lastTextTail = "";
  };

  const handleUpdate = (
    upd: {
      sessionUpdate?: string;
      toolCallId?: string;
      status?: string;
      title?: unknown;
      name?: unknown;
      kind?: unknown;
      content?: { type?: string; text?: string };
    },
    onChunk: ((txt: string) => void) | null
  ) => {
    if (upd.sessionUpdate === "tool_call" || upd.sessionUpdate === "tool_call_update") {
      if (hasEmittedText) {
        needsParagraphBreak = true;
      }
      if (typeof upd.toolCallId === "string" && upd.toolCallId) {
        const st = String(
          upd.status ?? (upd.sessionUpdate === "tool_call" ? "in_progress" : "")
        ).toLowerCase();
        const stepStatus: "executando" | "concluido" | "erro" =
          st === "failed" || st === "error" || st === "cancelled"
            ? "erro"
            : st === "completed"
              ? "concluido"
              : "executando";
        if (!toolStartedAt.has(upd.toolCallId)) {
          toolStartedAt.set(upd.toolCallId, Date.now());
        }
        let duracaoMs: number | undefined;
        if (stepStatus !== "executando") {
          const startedAt = toolStartedAt.get(upd.toolCallId) ?? Date.now();
          duracaoMs = Math.max(1, Date.now() - startedAt);
          toolStartedAt.delete(upd.toolCallId);
        }
        const { toolName, title } = formatAcpToolStepTitle(upd);
        onToolStep?.({
          id: `acp-tool-${upd.toolCallId}`,
          toolName,
          title,
          status: stepStatus,
          ...(duracaoMs ? { duracaoMs } : {}),
        });
      }
      return;
    }

    if (upd.sessionUpdate === "agent_thought_chunk") {
      if (hasEmittedText) {
        needsParagraphBreak = true;
      }
      return;
    }

    if (upd.sessionUpdate === "agent_message_chunk" && upd.content?.type === "text" && upd.content.text) {
      let text = upd.content.text;
      if (needsParagraphBreak) {
        needsParagraphBreak = false;
        if (hasEmittedText && !lastTextTail.endsWith("\n\n") && !text.startsWith("\n\n")) {
          const sep = lastTextTail.endsWith("\n") || text.startsWith("\n") ? "\n" : "\n\n";
          text = sep + text;
        }
      }
      hasEmittedText = true;
      lastTextTail = (lastTextTail + text).slice(-2);
      onChunk?.(text);
    }
  };

  return { reset, handleUpdate };
}

/**
 * Detecta se a saída bruta de uma ferramenta ACP (`tool_call_update`) indica que o CLI
 * moveu um comando ou subagente para segundo plano internamente.
 */
export function detectAcpBackgroundTaskOutput(rawOutput: unknown): boolean {
  if (rawOutput == null) return false;
  let serialized = "";
  if (typeof rawOutput === "string") {
    serialized = rawOutput;
  } else {
    try {
      serialized = JSON.stringify(rawOutput);
    } catch {
      serialized = String(rawOutput);
    }
  }
  if (!serialized) return false;
  return /\b(?:running|started|moved|launched)\s+in\s+(?:the\s+)?background\b|rodando\s+em\s+background|background[_\s]?(?:task|job|pid|process|id)|"run_in_background"\s*:\s*true/i.test(
    serialized,
  );
}

/**
 * Detecta se o texto final do modelo promete continuar após um processo em background terminar
 * (rede de segurança agnóstica a modelo quando nenhum backgroundJob/wakeup foi registrado).
 */
export function promisesBackgroundContinuationWithoutHandle(replyText: string): boolean {
  const clean = String(replyText ?? "").trim();
  if (!clean || clean.length < 18) return false;
  const recentTail = clean.slice(-700);
  return (
    /(?:assim\s+que|quando|logo\s+que|ap[oó]s)\s+[^.\n]{0,70}(?:fechar|terminar|concluir|acabar|finalizar|completar)[^.\n]{0,90}(?:sigo|continuo|prossigo|volto|aviso|rodo|executo|envio)/i.test(
      recentTail,
    ) ||
    /(?:rodando|executando|renderizando)\s+em\s+(?:segundo\s+plano|background)[^.\n]{0,140}(?:assim\s+que|quando|sigo|continuo|volto)/i.test(
      recentTail,
    )
  );
}
