import type { CriativoDatabase } from "../database/client.ts";
import type { ContextResetService } from "./context-reset-service.ts";

export const CACHE_TTL_MS = 60 * 60_000;
export const PRE_EXPIRY_WINDOW_START_MS = 50 * 60_000;
export const MIN_CONTEXT_TOKENS_FOR_PRE_COMPACT = 200_000;
export const CONFIG_KEY = "cache_expiry_compaction_prefs";

export interface CacheExpiryCompactionPrefs {
  enabled: boolean;
  minTokens: number;
  idleMinutes: number;
}

export interface CacheCompactionSweepItem {
  agenteId: string;
  provider: string;
  tokensTotal: number;
  idleMs: number;
  compacted: boolean;
  cutoffAt?: string;
  reason: string;
}

export interface CacheCompactionSweepResult {
  enabled: boolean;
  checkedAt: string;
  inspectedCount: number;
  compactedCount: number;
  items: CacheCompactionSweepItem[];
}

interface UsageTurnRow {
  agent_id: string;
  provider: string;
  occurred_at: string;
  uncached_input: number;
  cached_input: number;
  cache_creation: number;
}

const DEFAULT_PREFS: CacheExpiryCompactionPrefs = {
  enabled: true,
  minTokens: MIN_CONTEXT_TOKENS_FOR_PRE_COMPACT,
  idleMinutes: Math.round(PRE_EXPIRY_WINDOW_START_MS / 60_000),
};

function sanitizePrefs(raw: Partial<CacheExpiryCompactionPrefs>): CacheExpiryCompactionPrefs {
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_PREFS.enabled;
  const minTokens =
    typeof raw.minTokens === "number" && Number.isFinite(raw.minTokens)
      ? Math.max(10_000, Math.round(raw.minTokens))
      : DEFAULT_PREFS.minTokens;
  const idleMinutes =
    typeof raw.idleMinutes === "number" && Number.isFinite(raw.idleMinutes)
      ? Math.max(1, Math.min(59, Math.round(raw.idleMinutes)))
      : DEFAULT_PREFS.idleMinutes;
  return { enabled, minTokens, idleMinutes };
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Monitora sessões ociosas com cache de prompt de 1h (>= 200K tokens)
 * para pré-compactar contexto na janela 50–59 min antes da expiração do TTL.
 */
export class CacheExpiryCompactionService {
  private readonly db: CriativoDatabase;
  private readonly contextReset: ContextResetService;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: { db: CriativoDatabase; contextReset: ContextResetService }) {
    this.db = deps.db;
    this.contextReset = deps.contextReset;
  }

  public getPreferences(): CacheExpiryCompactionPrefs {
    const row = this.db.connection
      .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;")
      .get(CONFIG_KEY) as { valor_json?: string } | undefined;
    return row?.valor_json ? sanitizePrefs(parseJsonObject(row.valor_json)) : { ...DEFAULT_PREFS };
  }

  public updatePreferences(patch: {
    enabled?: boolean;
    minTokens?: number;
    idleMinutes?: number;
  }): CacheExpiryCompactionPrefs {
    const current = this.getPreferences();
    const next = sanitizePrefs({
      enabled: patch.enabled ?? current.enabled,
      minTokens: patch.minTokens ?? current.minTokens,
      idleMinutes: patch.idleMinutes ?? current.idleMinutes,
    });
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em) VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(CONFIG_KEY, JSON.stringify(next), new Date().toISOString());
    return next;
  }

  public runSweep(nowMs = Date.now()): CacheCompactionSweepResult {
    const prefs = this.getPreferences();
    const checkedAt = new Date(nowMs).toISOString();
    if (!prefs.enabled) {
      return { enabled: false, checkedAt, inspectedCount: 0, compactedCount: 0, items: [] };
    }

    const rows = this.db.connection
      .prepare(
        `SELECT r.agent_id, r.provider, r.occurred_at, r.uncached_input, r.cached_input, r.cache_creation
         FROM projecao_uso_registros r
         INNER JOIN (
           SELECT agent_id, MAX(occurred_at) AS max_occurred_at
           FROM projecao_uso_registros
           WHERE LOWER(provider) IN ('claude', 'anthropic') OR cache_creation > 0 OR cached_input > 0
           GROUP BY agent_id
         ) latest ON latest.agent_id = r.agent_id AND latest.max_occurred_at = r.occurred_at
         WHERE LOWER(r.provider) IN ('claude', 'anthropic') OR r.cache_creation > 0 OR r.cached_input > 0
         ORDER BY r.occurred_at DESC;`
      )
      .all() as unknown as UsageTurnRow[];

    const latestByAgent = new Map<string, UsageTurnRow>();
    for (const row of rows) {
      if (!latestByAgent.has(row.agent_id)) latestByAgent.set(row.agent_id, row);
    }

    const windowStartMs = prefs.idleMinutes * 60_000;
    const items: CacheCompactionSweepItem[] = [];
    let compactedCount = 0;

    for (const row of latestByAgent.values()) {
      const lastTurnMs = Date.parse(row.occurred_at);
      if (!Number.isFinite(lastTurnMs)) continue;
      const idleMs = nowMs - lastTurnMs;
      const tokensTotal =
        Number(row.uncached_input ?? 0) + Number(row.cached_input ?? 0) + Number(row.cache_creation ?? 0);

      const skip = (reason: string): void => {
        items.push({ agenteId: row.agent_id, provider: row.provider, tokensTotal, idleMs, compacted: false, reason });
      };

      if (idleMs < windowStartMs || idleMs >= CACHE_TTL_MS) {
        skip(idleMs < windowStartMs ? "below_idle_window" : "cache_already_expired");
        continue;
      }
      if (tokensTotal < prefs.minTokens) {
        skip("below_min_tokens");
        continue;
      }

      const agentRow = this.db.connection
        .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(row.agent_id) as { config_json?: string } | undefined;
      if (!agentRow) {
        skip("agent_not_found");
        continue;
      }

      const cfg = parseJsonObject(agentRow.config_json);
      if (cfg.auto_compact_enabled === false) {
        skip("agent_auto_compact_disabled");
        continue;
      }

      const cutoffMs = typeof cfg.context_cutoff_at === "string" && cfg.context_cutoff_at ? Date.parse(cfg.context_cutoff_at) : NaN;
      if (Number.isFinite(cutoffMs) && cutoffMs >= lastTurnMs) {
        skip("already_compacted_after_turn");
        continue;
      }

      const activeRow = this.db.connection
        .prepare("SELECT COUNT(*) AS total FROM projecao_fila_chat WHERE agente_id = ? AND status IN ('enfileirada', 'iniciando', 'executando');")
        .get(row.agent_id) as { total: number };
      if ((activeRow?.total ?? 0) > 0) {
        skip("active_turn_in_queue");
        continue;
      }

      const compactRes = this.contextReset.autoCompactIfNeeded({
        agenteId: row.agent_id,
        estimatedTokens: tokensTotal,
        maxContextTokens: Math.max(tokensTotal, MIN_CONTEXT_TOKENS_FOR_PRE_COMPACT),
        forceThresholdOverride: true,
        reasonLabel: "Pré-expiração cache 1h",
      });
      if (compactRes.compacted) compactedCount += 1;
      items.push({
        agenteId: row.agent_id,
        provider: row.provider,
        tokensTotal,
        idleMs,
        compacted: compactRes.compacted,
        cutoffAt: compactRes.cutoff_at,
        reason: compactRes.compacted ? "compacted_pre_expiry" : "compaction_skipped",
      });
    }

    return { enabled: true, checkedAt, inspectedCount: latestByAgent.size, compactedCount, items };
  }

  public start(intervalMs = 60_000): void {
    this.dispose();
    this.timer = setInterval(() => {
      try {
        this.runSweep();
      } catch {
        // Isola falha pontual de varredura para não interromper o daemon
      }
    }, Math.max(5_000, Math.round(intervalMs)));
    this.timer.unref?.();
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
