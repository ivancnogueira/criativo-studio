import {
  isAnnotationNodeKind,
  normalizeNodeKind,
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  workflowLoopEdges,
  type TarefaRegistro,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowOutputTarget,
  type WorkflowPortType,
  type WorkflowRunDetail,
  type WorkflowRunOrigin,
  type WorkflowRunRecord,
  type WorkflowStepRecord,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import { sanitizeProviderError, type FetchLike } from "../../engine/providers/provider-interface.ts";
import type { ProviderRegistry } from "../../engine/providers/provider-registry.ts";
import type { AgentRunner } from "../../engine/runner/agent-runner.ts";
import type { TelegramNotificationBot } from "../../messaging/telegram-bot.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../../queue/fifo-queue.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import { WorkflowStore, WorkflowValidationError } from "../workflow-store.ts";
import {
  buildNodeInputs,
  conditionAnswer,
  conditionPrompt,
  currentAnswers,
  hasUpstreamApprovedStep,
  MAX_LOOP_PASSES,
  nextActions,
  runScope,
  soloInputs,
  type WorkflowBuiltInputs,
} from "../workflow-walk.ts";

export class AsyncSemaphore {
  private active = 0;
  private readonly maxConcurrent: number;
  private readonly waiters: Array<() => void> = [];

  constructor(maxConcurrent = 1) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  public async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error("Execução cancelada.");
    }
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onAbort = () => {
        const idx = this.waiters.indexOf(grant);
        if (idx >= 0) this.waiters.splice(idx, 1);
        rejectPromise(new Error("Execução cancelada."));
      };
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        this.active += 1;
        resolvePromise();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(grant);
    });
  }

  public release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }

  public async withLock<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export interface WorkflowWhatsAppAdapter {
  getStatus(): { status: string; numero?: string | null };
  sendMessage(
    toJid: string,
    payload: { text?: string; image?: Buffer; caption?: string }
  ): Promise<unknown>;
}

export interface WorkflowEngineDeps {
  db: CriativoDatabase;
  store: WorkflowStore;
  queue: FifoQueueManager;
  vault: VaultService;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  wsHub: WebSocketHub;
  runner?: AgentRunner;
  whatsapp?: WorkflowWhatsAppAdapter | null;
  telegramBot?: TelegramNotificationBot;
  workspaceRoot: string;
  fetchImpl?: FetchLike;
}

export const VAULT_KEYS_BY_PROVIDER: Record<string, string[]> = {
  gemini: ["gemini_api_key", "google_api_key"],
  claude: ["anthropic_api_key", "claude_api_key"],
  openai: ["openai_api_key"],
  grok: ["xai_api_key", "grok_api_key"],
};

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}


export interface WorkflowEngineRuntimeContext {
  deps: WorkflowEngineDeps;
  generationLock: AsyncSemaphore;
  mediaLock: AsyncSemaphore;
  runScopeCache: Map<string, Set<string>>;
  sweepingRuns: Set<string>;
  pendingSweepRuns: Set<string>;
  runAbortControllers: Map<string, AbortController>;
  activePromises: Set<Promise<void>>;
  isDisposed: () => boolean;
  getWhatsAppAdapter: () => WorkflowWhatsAppAdapter | null;
  trackPromise: (promise: Promise<void>) => void;
  resolveWithinRoot: (relOrAbsPath: string) => string;
  resolveSafeOutputFile: (requestedName: string) => { absPath: string; relPath: string };
  getSecretsListForRedaction: () => string[];
  hasVaultApiKey: (providerName: string) => boolean;
  executeDirectModelText: (params: {
    model?: string;
    provider?: string;
    effort?: string;
    systemPrompt?: string;
    prompt: string;
    imagePaths?: string[];
    agentId?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; modelUsed: string; providerUsed: string }>;
  getScopeForRun: (run: WorkflowRunRecord, graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] }) => Set<string>;
  emitStepUpdated: (step: WorkflowStepRecord) => void;
  emitRunUpdated: (run: WorkflowRunRecord) => void;
  parseRunGraph: (run: WorkflowRunRecord) => { nos: WorkflowNo[]; arestas: WorkflowAresta[] };
  buildLatestStepsMap: (steps: WorkflowStepRecord[]) => Map<string, WorkflowStepRecord>;
  interpolateBrandPlaceholders: (raw: string) => string;
  createAgentTaskForStep: (params: {
    workflowId: string;
    runId: string;
    stepId: string;
    node: WorkflowNo;
    promptText: string;
    mediaPaths: string[];
  }) => TarefaRegistro;
  runNodeExecution: (params: {
    step: WorkflowStepRecord;
    node: WorkflowNo;
    graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] };
    inputs: WorkflowBuiltInputs;
    stepsByNode: Map<string, WorkflowStepRecord>;
    loops: Set<string>;
    runPayload: string | null;
    signal?: AbortSignal;
    skipSweep?: boolean;
  }) => Promise<void>;
  sweepRun: (runId: string) => Promise<void>;
  stopRun: (runId: string) => Promise<WorkflowRunDetail | null>;
}
