import type { DetectedLocalProvider } from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";

const LOCAL_CACHE_TTL_MS = 15_000;

export interface LocalProviderDetectorOptions {
  fetchImpl?: FetchLike;
  ollamaUrl?: string;
  lmStudioUrl?: string;
  timeoutMs?: number;
}

/**
 * Sonda servidores LLM locais (Ollama em :11434 e LM Studio em :1234) com cache curto
 * e timeout não-bloqueante.
 */
export class LocalProviderDetector {
  private readonly fetchFn: FetchLike;
  private readonly ollamaUrl: string;
  private readonly lmStudioUrl: string;
  private readonly timeoutMs: number;
  private cache: { expiresAt: number; items: DetectedLocalProvider[] } | null = null;

  constructor(options: LocalProviderDetectorOptions = {}) {
    this.fetchFn = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.ollamaUrl = (options.ollamaUrl ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.lmStudioUrl = (options.lmStudioUrl ?? "http://127.0.0.1:1234").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  private async probeOllama(): Promise<DetectedLocalProvider> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const res = await this.fetchFn(`${this.ollamaUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      } as RequestInit);
      if (!res.ok) {
        return {
          kind: "ollama",
          label: "Ollama Local",
          baseUrl: this.ollamaUrl,
          online: false,
          models: [],
          latencyMs: null,
          checkedAt,
        };
      }
      const data = (await res.json().catch(() => ({}))) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      const models = (data.models ?? [])
        .map((m) => String(m.name ?? m.model ?? "").trim())
        .filter(Boolean);
      return {
        kind: "ollama",
        label: "Ollama Local",
        baseUrl: this.ollamaUrl,
        online: true,
        models,
        latencyMs: Date.now() - started,
        checkedAt,
      };
    } catch {
      return {
        kind: "ollama",
        label: "Ollama Local",
        baseUrl: this.ollamaUrl,
        online: false,
        models: [],
        latencyMs: null,
        checkedAt,
      };
    }
  }

  private async probeLmStudio(): Promise<DetectedLocalProvider> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const res = await this.fetchFn(`${this.lmStudioUrl}/v1/models`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      } as RequestInit);
      if (!res.ok) {
        return {
          kind: "lmstudio",
          label: "LM Studio Local",
          baseUrl: `${this.lmStudioUrl}/v1`,
          online: false,
          models: [],
          latencyMs: null,
          checkedAt,
        };
      }
      const data = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id?: string }>;
      };
      const models = (data.data ?? [])
        .map((m) => String(m.id ?? "").trim())
        .filter(Boolean);
      return {
        kind: "lmstudio",
        label: "LM Studio Local",
        baseUrl: `${this.lmStudioUrl}/v1`,
        online: true,
        models,
        latencyMs: Date.now() - started,
        checkedAt,
      };
    } catch {
      return {
        kind: "lmstudio",
        label: "LM Studio Local",
        baseUrl: `${this.lmStudioUrl}/v1`,
        online: false,
        models: [],
        latencyMs: null,
        checkedAt,
      };
    }
  }

  public async detect(refresh = false): Promise<DetectedLocalProvider[]> {
    const now = Date.now();
    if (!refresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.items;
    }

    const items = await Promise.all([this.probeOllama(), this.probeLmStudio()]);
    this.cache = { expiresAt: Date.now() + LOCAL_CACHE_TTL_MS, items };
    return items;
  }
}
