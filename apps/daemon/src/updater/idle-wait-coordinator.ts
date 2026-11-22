export interface ActiveWorkProbeResult {
  busy: boolean;
  reason?: string;
}

export interface IdleWaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  force?: boolean;
  onWaiting?: (reason: string) => void;
}

export interface IdleWaitResult {
  proceeded: boolean;
  waitedMs: number;
  timedOut: boolean;
  forced: boolean;
  cancelled: boolean;
  lastReason?: string;
}

/**
 * Coordenador `idle-wait` para atualizações seguras: aguarda turnos ativos,
 * renderizações Remotion ou publicações Meta finalizarem antes do reinício do host.
 */
export class IdleWaitCoordinator {
  private readonly probeFn: () => ActiveWorkProbeResult;
  private forceRequested = false;
  private cancelled = false;

  constructor(probeFn: () => ActiveWorkProbeResult) {
    this.probeFn = probeFn;
  }

  public requestForceApply(): void {
    this.forceRequested = true;
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public reset(): void {
    this.forceRequested = false;
    this.cancelled = false;
  }

  public async waitUntilIdle(options: IdleWaitOptions = {}): Promise<IdleWaitResult> {
    this.reset();
    if (options.force) {
      return {
        proceeded: true,
        waitedMs: 0,
        timedOut: false,
        forced: true,
        cancelled: false,
      };
    }

    const timeoutMs = Math.max(100, options.timeoutMs ?? 60_000);
    const pollMs = Math.max(20, options.pollMs ?? 400);
    const startedAt = Date.now();
    let notified = false;
    let lastReason: string | undefined;

    while (true) {
      if (this.cancelled) {
        return {
          proceeded: false,
          waitedMs: Date.now() - startedAt,
          timedOut: false,
          forced: false,
          cancelled: true,
          lastReason,
        };
      }
      if (this.forceRequested) {
        return {
          proceeded: true,
          waitedMs: Date.now() - startedAt,
          timedOut: false,
          forced: true,
          cancelled: false,
          lastReason,
        };
      }

      const probe = this.probeFn();
      if (!probe.busy) {
        return {
          proceeded: true,
          waitedMs: Date.now() - startedAt,
          timedOut: false,
          forced: false,
          cancelled: false,
        };
      }

      lastReason = probe.reason ?? "Executando tarefa criativa ativa";
      if (!notified) {
        notified = true;
        options.onWaiting?.(lastReason);
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        return {
          proceeded: false,
          waitedMs: elapsed,
          timedOut: true,
          forced: false,
          cancelled: false,
          lastReason,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, timeoutMs - elapsed)));
    }
  }
}
