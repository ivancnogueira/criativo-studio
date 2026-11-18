export const ROUTINE_TIMER_MAX_DELAY_MS = 60_000;

export interface RoutineTimerOptions {
  getEarliestDue: () => Date | null;
  onTick: (now: Date) => Promise<void>;
  now?: () => number;
  onError?: (err: unknown) => void;
}

/**
 * Timer único anti-drift com teto de 60 segundos por ciclo, proteção de reentrância (`firing`),
 * suporte a suspensão (`suspend`/`resume`) e bloqueio temporário durante mutações (`hold`/`release`).
 */
export class RoutineTimer {
  private readonly getEarliestDue: () => Date | null;
  private readonly onTick: (now: Date) => Promise<void>;
  private readonly now: () => number;
  private readonly onError?: (err: unknown) => void;

  private timer: NodeJS.Timeout | null = null;
  private firing = false;
  private disposed = false;
  private suspended = false;
  private holdDepth = 0;

  constructor(options: RoutineTimerOptions) {
    this.getEarliestDue = options.getEarliestDue;
    this.onTick = options.onTick;
    this.now = options.now ?? (() => Date.now());
    this.onError = options.onError;
  }

  public isSuspended(): boolean {
    return this.suspended;
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public isFiring(): boolean {
    return this.firing;
  }

  public arm(): void {
    this.clearTimer();
    if (this.disposed || this.suspended || this.holdDepth > 0 || this.firing) {
      return;
    }

    const earliest = this.getEarliestDue();
    if (!earliest) {
      return;
    }

    const delta = earliest.getTime() - this.now();
    const delay = Math.max(0, Math.min(ROUTINE_TIMER_MAX_DELAY_MS, delta));

    this.timer = setTimeout(() => {
      void this.handleTimerFire();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async handleTimerFire(): Promise<void> {
    this.clearTimer();
    if (this.disposed || this.suspended || this.holdDepth > 0 || this.firing) {
      return;
    }

    const currentNowMs = this.now();
    const earliest = this.getEarliestDue();
    if (!earliest) {
      return;
    }

    // Se acordou apenas por causa do limite anti-drift de 60s, apenas re-arma para o próximo chunk
    if (earliest.getTime() > currentNowMs) {
      this.arm();
      return;
    }

    this.firing = true;
    try {
      await this.onTick(new Date(this.now()));
    } catch (err) {
      this.onError?.(err);
    } finally {
      this.firing = false;
      this.arm();
    }
  }

  public async triggerNow(): Promise<void> {
    if (this.disposed || this.suspended || this.holdDepth > 0 || this.firing) {
      return;
    }
    this.clearTimer();
    this.firing = true;
    try {
      await this.onTick(new Date(this.now()));
    } catch (err) {
      this.onError?.(err);
    } finally {
      this.firing = false;
      this.arm();
    }
  }

  public suspend(): void {
    this.suspended = true;
    this.clearTimer();
  }

  public resume(): void {
    if (this.disposed) return;
    this.suspended = false;
    this.arm();
  }

  public hold(): void {
    this.holdDepth += 1;
    this.clearTimer();
  }

  public release(): void {
    if (this.holdDepth > 0) {
      this.holdDepth -= 1;
    }
    if (this.holdDepth === 0) {
      this.arm();
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }
}
