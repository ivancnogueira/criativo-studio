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
