/**
 * Motor unificado de roteamento do pool multi-conta (`fill_first` vs `spread`)
 * e coordenador de turnos ativos para drenagem segura antes de remover contas (SCALE41-02).
 */
import type {
  ContaProvedorInfo,
  PoolContasConfig,
  PoolEstrategiaContas,
} from "@criativo/contracts";

export type { PoolEstrategiaContas };

export const POOL_AFFINITY_WINDOW_MS = 10 * 60 * 1000;
export const POOL_BUFFER_SHORT_WINDOW_PCT = 15; // <= 24h (janela_5h)
export const POOL_BUFFER_WEEKLY_WINDOW_PCT = 5; // janela_semanal
export const SPREAD_ACTIVE_TURN_PENALTY_PCT = 5;

export function getAccountLongestWindowResetMs(conta: ContaProvedorInfo): number {
  const grupos = conta.grupos_cota ?? [];
  const weeklyResets: number[] = [];
  const shortResets: number[] = [];

  for (const grupo of grupos) {
    if (grupo.janela_semanal?.reseta_em) {
      const ts = Date.parse(grupo.janela_semanal.reseta_em);
      if (Number.isFinite(ts)) weeklyResets.push(ts);
    }
    if (grupo.janela_5h?.reseta_em) {
      const ts = Date.parse(grupo.janela_5h.reseta_em);
      if (Number.isFinite(ts)) shortResets.push(ts);
    }
  }

  if (weeklyResets.length > 0) return Math.min(...weeklyResets);
  if (shortResets.length > 0) return Math.min(...shortResets);
  return Number.MAX_SAFE_INTEGER;
}

export function getAccountAverageRemainingPct(conta: ContaProvedorInfo): number {
  const values: number[] = [];
  for (const grupo of conta.grupos_cota ?? []) {
    if (grupo.janela_5h) values.push(grupo.janela_5h.restante_percentual);
    if (grupo.janela_semanal) values.push(grupo.janela_semanal.restante_percentual);
  }
  if (values.length === 0) return 100;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function getAccountMinRemainingPct(conta: ContaProvedorInfo): number {
  const values: number[] = [];
  for (const grupo of conta.grupos_cota ?? []) {
    if (grupo.janela_5h) values.push(grupo.janela_5h.restante_percentual);
    if (grupo.janela_semanal) values.push(grupo.janela_semanal.restante_percentual);
  }
  if (values.length === 0) return 100;
  return Math.min(...values);
}

export function accountRespectsQuotaBuffers(conta: ContaProvedorInfo): boolean {
  for (const grupo of conta.grupos_cota ?? []) {
    if (grupo.janela_5h) {
      const dur = Number(grupo.janela_5h.duracao_minutos ?? 300);
      const minRequired =
        dur <= 24 * 60 ? POOL_BUFFER_SHORT_WINDOW_PCT : POOL_BUFFER_WEEKLY_WINDOW_PCT;
      if (grupo.janela_5h.restante_percentual < minRequired) {
        return false;
      }
    }
    if (grupo.janela_semanal) {
      if (grupo.janela_semanal.restante_percentual < POOL_BUFFER_WEEKLY_WINDOW_PCT) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Coordena contagem de turnos ativos e drenagem segura antes da exclusão de contas.
 */
export class AccountTurnCoordinator {
  private readonly activeTurns = new Map<string, number>();
  private readonly drainingAccounts = new Set<string>();
  private readonly drainWaiters = new Map<string, Array<() => void>>();

  private key(provedor: string, accountId: string): string {
    return `${provedor}:${accountId}`;
  }

  public beginTurn(provedor: string, accountId: string): (() => void) | null {
    const k = this.key(provedor, accountId);
    if (this.drainingAccounts.has(k)) {
      return null;
    }
    this.activeTurns.set(k, (this.activeTurns.get(k) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.activeTurns.get(k) ?? 0;
      const next = Math.max(0, current - 1);
      if (next === 0) {
        this.activeTurns.delete(k);
        const waiters = this.drainWaiters.get(k);
        if (waiters) {
          this.drainWaiters.delete(k);
          for (const notify of waiters) {
            notify();
          }
        }
      } else {
        this.activeTurns.set(k, next);
      }
    };
  }

  public markDraining(
    provedor: string,
    accountId: string,
  ): { activeTurns: number; isIdle: boolean } {
    const k = this.key(provedor, accountId);
    this.drainingAccounts.add(k);
    const active = this.activeTurns.get(k) ?? 0;
    return { activeTurns: active, isIdle: active === 0 };
  }

  public clearDraining(provedor: string, accountId: string): void {
    const k = this.key(provedor, accountId);
    this.drainingAccounts.delete(k);
    this.drainWaiters.delete(k);
  }

  public isDraining(provedor: string, accountId: string): boolean {
    return this.drainingAccounts.has(this.key(provedor, accountId));
  }

  public getActiveTurns(provedor: string, accountId: string): number {
    return this.activeTurns.get(this.key(provedor, accountId)) ?? 0;
  }

  public getActiveTurnsMap(provedor: string): Map<string, number> {
    const prefix = `${provedor}:`;
    const map = new Map<string, number>();
    for (const [k, count] of this.activeTurns.entries()) {
      if (k.startsWith(prefix) && count > 0) {
        map.set(k.slice(prefix.length), count);
      }
    }
    return map;
  }

  public getDrainingAccountIds(provedor: string): Set<string> {
    const prefix = `${provedor}:`;
    const ids = new Set<string>();
    for (const k of this.drainingAccounts.values()) {
      if (k.startsWith(prefix)) {
        ids.add(k.slice(prefix.length));
      }
    }
    return ids;
  }

  public waitForDrain(
    provedor: string,
    accountId: string,
    timeoutMs = 120_000,
  ): Promise<boolean> {
    const k = this.key(provedor, accountId);
    if ((this.activeTurns.get(k) ?? 0) === 0) {
      return Promise.resolve(true);
    }
    return new Promise((resolvePromise) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise((this.activeTurns.get(k) ?? 0) === 0);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const currentWaiters = this.drainWaiters.get(k);
        if (currentWaiters) {
          this.drainWaiters.set(
            k,
            currentWaiters.filter((fn) => fn !== done),
          );
        }
        resolvePromise((this.activeTurns.get(k) ?? 0) === 0);
      }, timeoutMs);
      timer.unref?.();

      const waiters = this.drainWaiters.get(k) ?? [];
      waiters.push(done);
      this.drainWaiters.set(k, waiters);
    });
  }
}

export const accountTurnCoordinator = new AccountTurnCoordinator();

export interface SafeAccountRemovalResult {
  exists: boolean;
  removedImmediately: boolean;
  pendingRemoval: boolean;
  activeTurns: number;
  migratedToAccountId: string | null;
}

/**
 * Executa remoção segura compartilhada entre CliOAuth e Antigravity:
 * se não houver turnos ativos remove imediatamente; se houver turnos em andamento,
 * marca a conta em drenagem, migra `conta_em_uso` para a próxima elegível e só executa
 * `performPhysicalRemove()` quando o último turno concluir.
 */
export function executeSafeAccountRemoval(params: {
  provedor: string;
  accountId: string;
  coordinator?: AccountTurnCoordinator;
  accounts: ContaProvedorInfo[];
  pool: PoolContasConfig | null | undefined;
  updatePoolAccountInUse: (nextAccountId: string | null) => void;
  performPhysicalRemove: () => void;
  onFinalized?: () => void;
  timeoutMs?: number;
}): SafeAccountRemovalResult {
  const coordinator = params.coordinator ?? accountTurnCoordinator;
  const target = params.accounts.find((a) => a.id === params.accountId);
  if (!target) {
    return {
      exists: false,
      removedImmediately: false,
      pendingRemoval: false,
      activeTurns: 0,
      migratedToAccountId: null,
    };
  }

  const activeTurns = coordinator.getActiveTurns(params.provedor, params.accountId);
  const drainingNext = new Set(coordinator.getDrainingAccountIds(params.provedor));
  drainingNext.add(params.accountId);

  const fallbackPool: PoolContasConfig = {
    habilitado: params.pool?.habilitado ?? params.accounts.length > 1,
    contas_excluidas: params.pool?.contas_excluidas ?? [],
    conta_em_uso: null,
    estrategia: params.pool?.estrategia ?? "fill_first",
  };
  const nextEligible =
    selectPoolAccount(params.accounts, fallbackPool, null, {
      activeTurnsByAccount: coordinator.getActiveTurnsMap(params.provedor),
      drainingAccountIds: drainingNext,
    }) ??
    params.accounts.find(
      (a) => a.id !== params.accountId && a.estado === "conectado" && !drainingNext.has(a.id),
    ) ??
    null;

  const migratedToAccountId = nextEligible?.id ?? null;
  if (params.pool?.conta_em_uso === params.accountId || activeTurns > 0) {
    params.updatePoolAccountInUse(migratedToAccountId);
  }

  if (activeTurns === 0) {
    params.performPhysicalRemove();
    coordinator.clearDraining(params.provedor, params.accountId);
    return {
      exists: true,
      removedImmediately: true,
      pendingRemoval: false,
      activeTurns: 0,
      migratedToAccountId,
    };
  }

  coordinator.markDraining(params.provedor, params.accountId);
  void coordinator
    .waitForDrain(params.provedor, params.accountId, params.timeoutMs)
    .then(() => {
      params.performPhysicalRemove();
      coordinator.clearDraining(params.provedor, params.accountId);
      params.onFinalized?.();
    });

  return {
    exists: true,
    removedImmediately: false,
    pendingRemoval: true,
    activeTurns,
    migratedToAccountId,
  };
}

export function buildPoolSnapshotsForStudioRecords(
  provedor: "gemini" | "claude" | "openai",
  records: ReadonlyArray<{ id: string; label: string | null; email: string | null }>,
  poolOverride?: {
    habilitado?: boolean;
    contas_excluidas?: string[];
    conta_em_uso?: string | null;
    estrategia?: PoolEstrategiaContas;
  },
): { contas: ContaProvedorInfo[]; pool: PoolContasConfig | null } {
  const contas: ContaProvedorInfo[] = records.map((acc) => ({
    id: acc.id,
    provedor,
    rotulo: acc.label,
    email: acc.email,
    estado: "conectado",
    grupos_cota: [],
    removendo: accountTurnCoordinator.isDraining(provedor, acc.id),
    turnos_ativos: accountTurnCoordinator.getActiveTurns(provedor, acc.id),
  }));
  const pool: PoolContasConfig | null =
    contas.length > 0
      ? {
          habilitado: poolOverride?.habilitado ?? contas.length > 1,
          contas_excluidas: poolOverride?.contas_excluidas ?? [],
          conta_em_uso: poolOverride?.conta_em_uso ?? null,
          estrategia: poolOverride?.estrategia === "spread" ? "spread" : "fill_first",
        }
      : null;
  return { contas, pool };
}

export interface SelectPoolAccountOptions {
  activeTurnsByAccount?: ReadonlyMap<string, number>;
  drainingAccountIds?: ReadonlySet<string>;
}

/**
 * Seleciona a melhor conta conectada do pool respeitando exclusões, contas em drenagem,
 * reserva mínima de segurança e estratégia escolhida (`fill_first` ou `spread`).
 */
export function selectPoolAccount(
  contas: ContaProvedorInfo[],
  pool: PoolContasConfig | null | undefined,
  preferredAccountId?: string | null,
  options?: SelectPoolAccountOptions,
): ContaProvedorInfo | null {
  const excluded = new Set(pool?.contas_excluidas ?? []);
  const draining = options?.drainingAccountIds;

  const usable = contas.filter(
    (c) =>
      c.estado === "conectado" &&
      !excluded.has(c.id) &&
      c.removendo !== true &&
      !(draining?.has(c.id) ?? false) &&
      accountRespectsQuotaBuffers(c),
  );

  if (usable.length === 0) {
    return null;
  }

  const strategy: PoolEstrategiaContas = pool?.estrategia ?? "fill_first";

  if (strategy === "spread") {
    if (preferredAccountId) {
      const explicit = usable.find((c) => c.id === preferredAccountId);
      if (explicit) return explicit;
    }

    const getTurns = (c: ContaProvedorInfo) =>
      options?.activeTurnsByAccount?.get(c.id) ?? c.turnos_ativos ?? 0;

    const spreadSorted = [...usable].sort((a, b) => {
      const turnsA = getTurns(a);
      const turnsB = getTurns(b);
      const headroomA = getAccountMinRemainingPct(a) - turnsA * SPREAD_ACTIVE_TURN_PENALTY_PCT;
      const headroomB = getAccountMinRemainingPct(b) - turnsB * SPREAD_ACTIVE_TURN_PENALTY_PCT;
      if (headroomA !== headroomB) {
        return headroomB - headroomA;
      }
      const avgDiff = getAccountAverageRemainingPct(b) - getAccountAverageRemainingPct(a);
      if (avgDiff !== 0) {
        return avgDiff;
      }
      return turnsA - turnsB;
    });

    return spreadSorted[0] ?? null;
  }

  // Modo fill_first (padrão): menor resetTime + afinidade com stickyId por até 10 min
  const sorted = [...usable].sort((a, b) => {
    const resetA = getAccountLongestWindowResetMs(a);
    const resetB = getAccountLongestWindowResetMs(b);
    if (resetA !== resetB) {
      return resetA - resetB;
    }
    return getAccountAverageRemainingPct(b) - getAccountAverageRemainingPct(a);
  });

  const best = sorted[0]!;
  const stickyId = preferredAccountId ?? pool?.conta_em_uso ?? null;
  if (stickyId) {
    const sticky = usable.find((c) => c.id === stickyId);
    if (sticky) {
      const bestReset = getAccountLongestWindowResetMs(best);
      const stickyReset = getAccountLongestWindowResetMs(sticky);
      if (
        bestReset === stickyReset ||
        (bestReset !== Number.MAX_SAFE_INTEGER &&
          stickyReset !== Number.MAX_SAFE_INTEGER &&
          Math.abs(stickyReset - bestReset) < POOL_AFFINITY_WINDOW_MS)
      ) {
        return sticky;
      }
    }
  }

  return best;
}
