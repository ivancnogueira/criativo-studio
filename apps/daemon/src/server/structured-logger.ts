import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { StructuredLogEntry } from "@criativo/contracts";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const SENSITIVE_KEY_RE = /(token|secret|password|senha|api[-_]?key|vault[-_]?key|authorization|cookie|bearer|private[-_]?key)/i;

/**
 * Redige tokens, chaves Bearer, API Keys e credenciais sensíveis antes de gravar ou retornar texto.
 */
export function redactSensitiveText(input: string, extraSecrets: string[] = []): string {
  let out = String(input ?? "");
  for (const rawSecret of extraSecrets) {
    const clean = rawSecret?.trim();
    if (clean && clean.length >= 6) {
      out = out.split(clean).join("[REDACTED]");
    }
  }
  out = out
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|token|api_key|apikey|key|secret)=)[^&\s"'`]+/gi, "$1[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{16,}|gh[pousr]_[A-Za-z0-9]{12,}|EAA[A-Za-z0-9]{16,})\b/g, "[REDACTED]");
  return out;
}

export function redactMetadataValue(value: unknown, extraSecrets: string[] = [], depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") {
    return redactSensitiveText(value, extraSecrets);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactMetadataValue(item, extraSecrets, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactMetadataValue(v, extraSecrets, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export interface StructuredLoggerOptions {
  logsDir?: string;
  fileName?: string;
  maxBytes?: number;
}

/**
 * Logger estruturado JSONL com redação automática de segredos e rotação por tamanho.
 */
export class StructuredLogger {
  public readonly filePath: string;
  private readonly maxBytes: number;

  constructor(options: StructuredLoggerOptions = {}) {
    const dir = options.logsDir ? resolve(options.logsDir) : resolve(process.cwd(), "logs");
    this.filePath = join(dir, options.fileName ?? "daemon-structured.jsonl");
    this.maxBytes = Math.max(16_384, options.maxBytes ?? DEFAULT_MAX_BYTES);
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const st = statSync(this.filePath);
      if (st.size < this.maxBytes) return;
      const rotated = `${this.filePath}.1`;
      if (existsSync(rotated)) {
        try {
          renameSync(this.filePath, rotated);
        } catch {
          // em Windows, se houver bloqueio momentâneo, ignora e continua
        }
      } else {
        renameSync(this.filePath, rotated);
      }
    } catch {
      // ignora erro de stat/rotação
    }
  }

  public log(
    input: {
      level: "info" | "warn" | "error";
      domain: StructuredLogEntry["domain"];
      code?: string;
      message: string;
      traceId?: string;
      metadata?: Record<string, unknown>;
    },
    extraSecrets: string[] = []
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      id: `log-${randomUUID().slice(0, 10)}`,
      ts: new Date().toISOString(),
      level: input.level,
      domain: input.domain,
      ...(input.code ? { code: input.code } : {}),
      message: redactSensitiveText(input.message, extraSecrets).slice(0, 1200),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.metadata
        ? { metadata: redactMetadataValue(input.metadata, extraSecrets) as Record<string, unknown> }
        : {}),
    };

    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // falha de I/O não deve derrubar o servidor HTTP
    }

    return entry;
  }

  public info(
    domain: StructuredLogEntry["domain"],
    message: string,
    opts?: { code?: string; traceId?: string; metadata?: Record<string, unknown>; secrets?: string[] }
  ): StructuredLogEntry {
    return this.log(
      { level: "info", domain, message, code: opts?.code, traceId: opts?.traceId, metadata: opts?.metadata },
      opts?.secrets
    );
  }

  public warn(
    domain: StructuredLogEntry["domain"],
    message: string,
    opts?: { code?: string; traceId?: string; metadata?: Record<string, unknown>; secrets?: string[] }
  ): StructuredLogEntry {
    return this.log(
      { level: "warn", domain, message, code: opts?.code, traceId: opts?.traceId, metadata: opts?.metadata },
      opts?.secrets
    );
  }

  public error(
    domain: StructuredLogEntry["domain"],
    message: string,
    opts?: { code?: string; traceId?: string; metadata?: Record<string, unknown>; secrets?: string[] }
  ): StructuredLogEntry {
    return this.log(
      { level: "error", domain, message, code: opts?.code, traceId: opts?.traceId, metadata: opts?.metadata },
      opts?.secrets
    );
  }

  public queryRecentLogs(
    filters: { level?: "info" | "warn" | "error"; code?: string; domain?: string; limit?: number } = {}
  ): StructuredLogEntry[] {
    if (!existsSync(this.filePath)) return [];
    const limit = Math.max(1, Math.min(500, Number(filters.limit) || 100));
    const levelFilter = filters.level;
    const codeFilter = filters.code?.trim().toUpperCase();
    const domainFilter = filters.domain?.trim().toLowerCase();

    try {
      const lines = readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
      const result: StructuredLogEntry[] = [];
      for (let i = lines.length - 1; i >= 0 && result.length < limit; i -= 1) {
        try {
          const parsed = JSON.parse(lines[i]!) as StructuredLogEntry;
          if (levelFilter && parsed.level !== levelFilter) continue;
          if (codeFilter && !(parsed.code ?? "").toUpperCase().includes(codeFilter)) continue;
          if (domainFilter && String(parsed.domain ?? "").toLowerCase() !== domainFilter) continue;
          result.push(parsed);
        } catch {
          // ignora linha malformada
        }
      }
      return result;
    } catch {
      return [];
    }
  }
}
