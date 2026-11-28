import type { ContaProvedorInfo, ProvedorStatusInfo } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export const PROVIDER_STATUS_SNAPSHOT_KEY = "provedores_status_snapshot_v1";
export const DEFAULT_PROVIDER_STATUS_CACHE_TTL_MS = 60_000;
export const DEFAULT_PROVIDER_PROBE_TIMEOUT_MS = 4_000;

interface CachedProviderSnapshotEntry {
  updatedAtMs: number;
  data: ProvedorStatusInfo[];
}

const memorySnapshots = new WeakMap<CriativoDatabase, CachedProviderSnapshotEntry>();
const inFlightRefreshes = new WeakMap<CriativoDatabase, Promise<ProvedorStatusInfo[]>>();

/**
 * Executa uma sondagem de provedor com timeout isolado para que nenhuma CLI ou URL lenta
 * trave toda a resposta de `GET /api/provedores/status`.
 */
export async function withProviderProbeTimeout<T>(
  promise: Promise<T>,
  timeoutMs = DEFAULT_PROVIDER_PROBE_TIMEOUT_MS,
  fallbackValue: T
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallbackValue),
      new Promise<T>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(fallbackValue), Math.max(100, timeoutMs));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitizeAccountForSnapshot(acc: ContaProvedorInfo): ContaProvedorInfo {
  return {
    id: acc.id,
    provedor: acc.provedor,
    rotulo: acc.rotulo ?? null,
    email: null,
    plano: acc.plano ?? null,
    estado: acc.estado,
    token_valido: Boolean(acc.token_valido),
    grupos_cota: Array.isArray(acc.grupos_cota) ? acc.grupos_cota : [],
    removendo: acc.removendo,
  };
}

/**
 * Garante que apenas metadados operacionais (zero tokens, senhas ou e-mails reais)
 * sejam gravados no snapshot persistido do SQLite.
 */
export function sanitizeProvidersSnapshotForPersistence(
  list: ProvedorStatusInfo[]
): ProvedorStatusInfo[] {
  return list.map((item) => ({
    ...item,
    contas: Array.isArray(item.contas) ? item.contas.map(sanitizeAccountForSnapshot) : undefined,
    modelos: Array.isArray(item.modelos) ? item.modelos.slice(0, 60) : [],
  }));
}

export function readPersistedProvidersSnapshot(db: CriativoDatabase): {
  updatedAtMs: number;
  data: ProvedorStatusInfo[];
} | null {
  try {
    const row = db.connection
      .prepare(`SELECT valor_json, atualizado_em FROM projecao_studio_config WHERE chave = ? LIMIT 1;`)
      .get(PROVIDER_STATUS_SNAPSHOT_KEY) as { valor_json?: string; atualizado_em?: string } | undefined;
    if (!row?.valor_json) return null;
    const parsed = JSON.parse(row.valor_json) as ProvedorStatusInfo[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const parsedAt = row.atualizado_em ? Date.parse(row.atualizado_em) : Date.now();
    return {
      updatedAtMs: Number.isFinite(parsedAt) ? parsedAt : Date.now(),
      data: parsed,
    };
  } catch {
    return null;
  }
}

export function persistProvidersSnapshot(db: CriativoDatabase, list: ProvedorStatusInfo[]): void {
  if (!Array.isArray(list) || list.length === 0) return;
  const sanitized = sanitizeProvidersSnapshotForPersistence(list);
  const nowMs = Date.now();
  memorySnapshots.set(db, { updatedAtMs: nowMs, data: list });
  try {
    db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(PROVIDER_STATUS_SNAPSHOT_KEY, JSON.stringify(sanitized), new Date(nowMs).toISOString());
  } catch {
    // falha ao persistir snapshot não impede uso em memória
  }
}

export function invalidateProvidersSnapshotCache(db: CriativoDatabase): void {
  memorySnapshots.delete(db);
}

/**
 * Entrega snapshot instantâneo (*stale-while-revalidate*) quando `forceProbe === false`
 * e deduplica atualizações concorrentes em background.
 */
export async function readOrRefreshProviderStatusSnapshot(options: {
  db: CriativoDatabase;
  forceProbe: boolean;
  ttlMs?: number;
  computeFresh: () => Promise<ProvedorStatusInfo[]>;
}): Promise<ProvedorStatusInfo[]> {
  const ttlMs = options.ttlMs ?? DEFAULT_PROVIDER_STATUS_CACHE_TTL_MS;
  const runDeduplicatedFresh = (): Promise<ProvedorStatusInfo[]> => {
    const existingFlight = inFlightRefreshes.get(options.db);
    if (existingFlight) return existingFlight;

    const promise = options
      .computeFresh()
      .then((fresh) => {
        persistProvidersSnapshot(options.db, fresh);
        return fresh;
      })
      .finally(() => {
        if (inFlightRefreshes.get(options.db) === promise) {
          inFlightRefreshes.delete(options.db);
        }
      });
    inFlightRefreshes.set(options.db, promise);
    return promise;
  };

  if (options.forceProbe || process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return await runDeduplicatedFresh();
  }

  const memEntry = memorySnapshots.get(options.db);
  if (memEntry && memEntry.data.length > 0) {
    if (Date.now() - memEntry.updatedAtMs > ttlMs) {
      void runDeduplicatedFresh().catch(() => {});
    }
    return memEntry.data;
  }

  const diskEntry = readPersistedProvidersSnapshot(options.db);
  if (diskEntry && diskEntry.data.length > 0) {
    memorySnapshots.set(options.db, diskEntry);
    if (Date.now() - diskEntry.updatedAtMs > ttlMs) {
      void runDeduplicatedFresh().catch(() => {});
    }
    return diskEntry.data;
  }

  return await runDeduplicatedFresh();
}
