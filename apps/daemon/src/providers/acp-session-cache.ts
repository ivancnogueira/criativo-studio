import { createHash } from "node:crypto";

export interface AcpCachedSessionEntry {
  key: string;
  provider: "opencode" | "antigravity";
  connectionRef: object;
  sessionId: string;
  modelUsed?: string;
  fingerprint: string;
  modelId: string;
  createdAtMs: number;
  lastUsedAtMs: number;
}

const DEFAULT_ACP_SESSION_TTL_MS = 30 * 60_000;

export function computeAcpConfigFingerprint(input: {
  modelId?: string;
  effort?: string;
  systemPrompt?: string;
  mcpServers?: unknown[];
}): string {
  const hash = createHash("sha256");
  hash.update(String(input.modelId ?? "").trim());
  hash.update("\0");
  hash.update(String(input.effort ?? "").trim());
  hash.update("\0");
  hash.update(String(input.systemPrompt ?? ""));
  hash.update("\0");
  hash.update(JSON.stringify(Array.isArray(input.mcpServers) ? input.mcpServers : []));
  return hash.digest("hex").slice(0, 16);
}

/**
 * Gerencia sessões ACP persistentes compartilhadas entre OpenCode ACP e Antigravity ACP
 * para evitar `session/new` e reenvio integral de `systemPrompt + histórico` a cada turno.
 */
class AcpSessionCacheManager {
  private readonly entries = new Map<string, AcpCachedSessionEntry>();

  public buildKey(input: {
    provider: "opencode" | "antigravity";
    accountId?: string | null;
    agentId?: string | null;
    threadId?: string | null;
  }): string {
    return [
      input.provider,
      input.accountId?.trim() || "default",
      input.agentId?.trim() || "default",
      input.threadId?.trim() || "main",
    ].join("::");
  }

  public getValidSession(
    key: string,
    connectionRef: object,
    currentFingerprint: string,
    ttlMs = DEFAULT_ACP_SESSION_TTL_MS
  ): {
    reusable: AcpCachedSessionEntry | null;
    replacedSessionId: string | null;
  } {
    const entry = this.entries.get(key);
    if (!entry) {
      return { reusable: null, replacedSessionId: null };
    }
    const expired = Date.now() - entry.lastUsedAtMs > ttlMs;
    const wrongConn = entry.connectionRef !== connectionRef;
    const wrongFingerprint = entry.fingerprint !== currentFingerprint;

    if (expired || wrongConn || wrongFingerprint) {
      this.entries.delete(key);
      return {
        reusable: null,
        replacedSessionId: entry.connectionRef === connectionRef ? entry.sessionId : null,
      };
    }

    entry.lastUsedAtMs = Date.now();
    return { reusable: entry, replacedSessionId: null };
  }

  public setSession(entry: AcpCachedSessionEntry): void {
    this.entries.set(entry.key, entry);
  }

  public invalidateSession(key: string): string | null {
    const prev = this.entries.get(key);
    this.entries.delete(key);
    return prev?.sessionId ?? null;
  }

  public invalidateByConnection(connectionRef: object): void {
    for (const [k, v] of this.entries.entries()) {
      if (v.connectionRef === connectionRef) {
        this.entries.delete(k);
      }
    }
  }

  public invalidateByAgentAndThread(agentId?: string | null, threadId?: string | null): number {
    const cleanAgent = agentId?.trim() || "default";
    const cleanThread = threadId?.trim();
    let count = 0;
    for (const [k, v] of this.entries.entries()) {
      const parts = k.split("::");
      if (parts[2] !== cleanAgent) continue;
      if (cleanThread && parts[3] !== cleanThread) continue;
      this.entries.delete(k);
      count += 1;
    }
    return count;
  }

  public clearAll(): void {
    this.entries.clear();
  }
}

export const acpSessionCache = new AcpSessionCacheManager();

export function isStaleAcpSessionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("session not found") ||
    msg.includes("unknown session") ||
    msg.includes("invalid session") ||
    msg.includes("no such session") ||
    msg.includes("session closed") ||
    msg.includes("expired") ||
    msg.includes("does not exist")
  );
}

/**
 * Orquestra reuso seguro de sessão ACP aquecida com invalidação por fingerprint e 1 retry limpo.
 * Mantém a sessão viva quando `reuseKey` está presente; fecha imediatamente no modo efêmero.
 */
export async function runWithAcpSessionCache<T>(opts: {
  provider: "opencode" | "antigravity";
  reuseKey?: string;
  connectionRef: object;
  configFingerprint?: string;
  modelId: string;
  hasDeferredClose?: () => boolean;
  createSession: () => Promise<{ sessionId: string; modelUsed: string }>;
  closeSession: (sessionId: string) => void;
  executePrompt: (ctx: { sessionId: string; modelUsed: string; reused: boolean }) => Promise<T>;
}): Promise<T> {
  if (!opts.reuseKey || !opts.configFingerprint) {
    const created = await opts.createSession();
    try {
      return await opts.executePrompt({ ...created, reused: false });
    } finally {
      if (!opts.hasDeferredClose?.()) {
        opts.closeSession(created.sessionId);
      }
    }
  }

  const cached = acpSessionCache.getValidSession(
    opts.reuseKey,
    opts.connectionRef,
    opts.configFingerprint
  );
  if (cached.replacedSessionId) {
    opts.closeSession(cached.replacedSessionId);
  }

  if (cached.reusable) {
    try {
      return await opts.executePrompt({
        sessionId: cached.reusable.sessionId,
        modelUsed: cached.reusable.modelUsed ?? opts.modelId,
        reused: true,
      });
    } catch (err) {
      if (!isStaleAcpSessionError(err)) {
        acpSessionCache.invalidateSession(opts.reuseKey);
        opts.closeSession(cached.reusable.sessionId);
        throw err;
      }
      acpSessionCache.invalidateSession(opts.reuseKey);
      opts.closeSession(cached.reusable.sessionId);
    }
  }

  const created = await opts.createSession();
  const now = Date.now();
  acpSessionCache.setSession({
    key: opts.reuseKey,
    provider: opts.provider,
    connectionRef: opts.connectionRef,
    sessionId: created.sessionId,
    modelUsed: created.modelUsed,
    fingerprint: opts.configFingerprint,
    modelId: opts.modelId,
    createdAtMs: now,
    lastUsedAtMs: now,
  });

  try {
    return await opts.executePrompt({ ...created, reused: false });
  } catch (err) {
    acpSessionCache.invalidateSession(opts.reuseKey);
    opts.closeSession(created.sessionId);
    throw err;
  }
}
