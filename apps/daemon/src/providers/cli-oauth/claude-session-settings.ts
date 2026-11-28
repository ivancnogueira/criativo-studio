import { createHash, randomUUID } from "node:crypto";

/**
 * Ferramentas nativas de host do Claude Code que duplicam recursos do CriativoOS
 * ou confundem o agente em turnos de chat/rotina.
 */
export const CLAUDE_DISALLOWED_HOST_TOOLS = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  "ReportFindings",
  "DesignSync",
  "PushNotification",
] as const;

export interface ClaudeSessionEntry {
  sessionId: string;
  fingerprint: string;
  updatedAtMs: number;
}

const CLAUDE_SESSION_IDLE_TTL_MS = 60 * 60_000;

export function buildClaudeEnv(
  absConfigDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  return {
    ...baseEnv,
    CLAUDE_CONFIG_DIR: absConfigDir,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_TOOL_SEARCH: "true",
  };
}

export function computeClaudeFingerprint(input: {
  modelId: string;
  systemPrompt?: string;
  mcpConfig?: Record<string, unknown> | null;
  turnMode?: "light" | "action";
}): string {
  const hash = createHash("sha256");
  hash.update(String(input.modelId ?? "").trim());
  hash.update("\0");
  hash.update(String(input.turnMode ?? "action"));
  hash.update("\0");
  hash.update(String(input.systemPrompt ?? ""));
  hash.update("\0");
  hash.update(JSON.stringify(input.turnMode === "light" ? null : (input.mcpConfig ?? null)));
  return hash.digest("hex").slice(0, 16);
}

export function buildClaudeCliArgs(input: {
  targetModel: string;
  mcpConfigFile?: string | null;
  resumeSessionId?: string | null;
  newSessionId?: string | null;
  systemPrompt?: string;
  turnMode?: "light" | "action";
  effort?: "low" | "medium" | "high";
  minimalCompat?: boolean;
  includeAllowedMcpTools?: boolean;
}): string[] {
  const args: string[] = [
    "-p",
    "--output-format",
    "json",
    "--strict-mcp-config",
    "--tools",
    "",
    "--disallowedTools",
    CLAUDE_DISALLOWED_HOST_TOOLS.join(","),
  ];

  if (!input.minimalCompat) {
    if (input.turnMode === "light") {
      args.push("--setting-sources", "", "--effort", "low");
    } else if (input.effort) {
      args.push("--effort", input.effort);
    }
  }

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  } else {
    const sid = input.newSessionId || randomUUID();
    args.push("--session-id", sid);
    if (input.systemPrompt && input.systemPrompt.trim().length > 0) {
      args.push("--system-prompt", input.systemPrompt);
    }
  }

  if (input.turnMode !== "light" && input.mcpConfigFile) {
    args.push("--mcp-config", input.mcpConfigFile);
    if (input.includeAllowedMcpTools !== false) {
      args.push("--allowedTools", "mcp__criativo_studio__*");
    }
  }

  args.push("--model", input.targetModel);
  return args;
}

class ClaudeSessionCacheManager {
  private readonly sessions = new Map<string, ClaudeSessionEntry>();

  public buildKey(accountId: string, agenteId?: string | null, threadId?: string | null): string {
    return `${accountId}::${agenteId?.trim() || "default"}::${threadId?.trim() || "main"}`;
  }

  public getValid(key: string, fingerprint: string): ClaudeSessionEntry | null {
    const entry = this.sessions.get(key);
    if (!entry) return null;
    if (Date.now() - entry.updatedAtMs > CLAUDE_SESSION_IDLE_TTL_MS) {
      this.sessions.delete(key);
      return null;
    }
    if (entry.fingerprint !== fingerprint) {
      this.sessions.delete(key);
      return null;
    }
    return entry;
  }

  public set(key: string, entry: ClaudeSessionEntry): void {
    this.sessions.set(key, entry);
  }

  public delete(key: string): void {
    this.sessions.delete(key);
  }

  public invalidateByAgentAndThread(agenteId?: string | null, threadId?: string | null): number {
    const cleanAgent = agenteId?.trim() || "default";
    const cleanThread = threadId?.trim();
    let count = 0;
    for (const key of Array.from(this.sessions.keys())) {
      const parts = key.split("::");
      if (parts[1] !== cleanAgent) continue;
      if (cleanThread && parts[2] !== cleanThread) continue;
      this.sessions.delete(key);
      count += 1;
    }
    return count;
  }

  public clearAll(): void {
    this.sessions.clear();
  }
}

export const claudeSessionCache = new ClaudeSessionCacheManager();
