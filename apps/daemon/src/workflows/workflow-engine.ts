import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
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
import type { CriativoDatabase } from "../database/client.ts";
import { sanitizeProviderError, type FetchLike } from "../engine/providers/provider-interface.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { AgentRunner } from "../engine/runner/agent-runner.ts";
import { generateImageTool } from "../engine/tools/generate-image.ts";
import { metaPublishTool } from "../engine/tools/meta-publish.ts";
import { executeRemotionRender } from "../engine/tools/remotion-bridge.ts";
import type { TelegramNotificationBot } from "../messaging/telegram-bot.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import { recordChatTurnUsage } from "../server/analytics-skills-service.ts";
import { getBrandIdentity } from "../server/brand-onboarding-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { WorkflowStore, WorkflowValidationError } from "./workflow-store.ts";
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
} from "./workflow-walk.ts";

class AsyncSemaphore {
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

const VAULT_KEYS_BY_PROVIDER: Record<string, string[]> = {
  gemini: ["gemini_api_key", "google_api_key"],
  claude: ["anthropic_api_key", "claude_api_key"],
  openai: ["openai_api_key"],
  grok: ["xai_api_key", "grok_api_key"],
};

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;
  private readonly generationLock = new AsyncSemaphore(1);
  private readonly mediaLock = new AsyncSemaphore(1);
  private readonly sweepingRuns = new Set<string>();
  private readonly pendingSweepRuns = new Set<string>();
  private readonly runScopeCache = new Map<string, Set<string>>();
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly activePromises = new Set<Promise<void>>();
  private whatsappAdapter: WorkflowWhatsAppAdapter | null;
  private disposed = false;

  constructor(deps: WorkflowEngineDeps) {
    this.deps = deps;
    this.whatsappAdapter = deps.whatsapp ?? null;
  }

  public setWhatsAppAdapter(adapter: WorkflowWhatsAppAdapter | null): void {
    this.whatsappAdapter = adapter;
  }

  public setRunner(runner: AgentRunner): void {
    this.deps.runner = runner;
  }

  private trackPromise(promise: Promise<void>): void {
    this.activePromises.add(promise);
    void promise.finally(() => {
      this.activePromises.delete(promise);
    });
  }

  private resolveWithinRoot(relOrAbsPath: string): string {
    const absRoot = resolve(this.deps.workspaceRoot);
    const cleaned = relOrAbsPath.trim();
    if (!cleaned || cleaned.includes("\0")) {
      throw new Error("Caminho de arquivo vazio ou inválido.");
    }
    const resolved = resolve(absRoot, cleaned);
    if (resolved !== absRoot && !resolved.startsWith(absRoot + sep)) {
      throw new Error("Acesso negado: caminho fora da área permitida do workspace.");
    }
    return resolved;
  }

  private resolveSafeOutputFile(requestedName: string): { absPath: string; relPath: string } {
    const absOutputsRoot = resolve(this.deps.workspaceRoot, "saidas", "workflows");
    mkdirSync(absOutputsRoot, { recursive: true });
    const sanitized = requestedName.replace(/^[\\/]+/, "").trim() || `workflow-${randomUUID().slice(0, 8)}.txt`;
    if (sanitized.includes("\0") || sanitized.includes("..")) {
      throw new Error("Caminho inválido para entrega de arquivo: '..' não é permitido.");
    }
    const target = resolve(absOutputsRoot, sanitized);
    if (target !== absOutputsRoot && !target.startsWith(absOutputsRoot + sep)) {
      throw new Error("Acesso negado: entrega de arquivo deve permanecer em saidas/workflows/.");
    }
    mkdirSync(resolve(target, ".."), { recursive: true });
    const relFromWorkspace = relative(resolve(this.deps.workspaceRoot), target).replace(/\\/g, "/");
    return { absPath: target, relPath: relFromWorkspace };
  }

  private getSecretsListForRedaction(): string[] {
    const secrets: string[] = [];
    for (const meta of this.deps.vault.listSecretsMetadata()) {
      const val = this.deps.vault.getSecret(meta.chave_nome);
      if (val) secrets.push(val);
    }
    return secrets;
  }

  private hasVaultApiKey(providerName: string): boolean {
    const keys = VAULT_KEYS_BY_PROVIDER[providerName] ?? [];
    return keys.some((k) => {
      const val = this.deps.vault.getSecret(k);
      return Boolean(val && val.trim().length > 0);
    });
  }

  private async executeDirectModelText(params: {
    model?: string;
    provider?: string;
    effort?: string;
    systemPrompt?: string;
    prompt: string;
    imagePaths?: string[];
    agentId?: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; modelUsed: string; providerUsed: string }> {
    if (params.signal?.aborted) {
      throw new Error("Execução cancelada.");
    }

    const model = params.model?.trim() || "gemini-2.5-pro";
    const resolvedProvider =
      params.provider?.trim() || this.deps.providers.resolveProviderName(model);
    const turnId = `wft_${randomUUID().slice(0, 12)}`;
    const sessionId = `workflow:${params.agentId ?? "llm"}`;

    const tryRegistryClient = async () => {
      const client = this.deps.providers.getClientForModel(model);
      const res = await client.executeTurn({
        model,
        systemPrompt: params.systemPrompt ?? "",
        messages: [{ role: "user", content: params.prompt }],
      });
      recordChatTurnUsage(this.deps.db, {
        agentId: params.agentId ?? "workflow-llm",
        sessionId,
        turnId,
        provider: resolvedProvider,
        model,
        uncachedInput: res.usage?.inputTokens ?? Math.max(20, Math.round(params.prompt.length / 4)),
        cachedInput: 0,
        output: res.usage?.outputTokens ?? Math.max(10, Math.round(res.text.length / 4)),
      });
      return { text: res.text, modelUsed: model, providerUsed: resolvedProvider };
    };

    // 1. API Key no Vault ou Ollama local
    if (this.hasVaultApiKey(resolvedProvider) || resolvedProvider === "ollama") {
      return await tryRegistryClient();
    }

    // 2. OAuth CLI (Claude / OpenAI) -> OpenCode -> Antigravity Live
    try {
      const statuses = await this.deps.providerConnection.getProvidersStatus(false);
      const statusForProvider = statuses.find((s) => s.provedor === resolvedProvider);

      if (
        (resolvedProvider === "claude" || resolvedProvider === "openai") &&
        statusForProvider?.conectado &&
        statusForProvider.modo_conexao !== "nenhum"
      ) {
        const res = await this.deps.providerConnection.getCliOAuthService().executeTurn({
          provedor: resolvedProvider,
          modelId: model,
          systemPrompt: params.systemPrompt || undefined,
          messages: [{ role: "user", text: params.prompt }],
        });
        recordChatTurnUsage(this.deps.db, {
          agentId: params.agentId ?? "workflow-llm",
          sessionId,
          turnId,
          provider: resolvedProvider,
          model: res.modelUsed,
          uncachedInput: res.usage.uncachedInput,
          cachedInput: res.usage.cachedInput,
          output: res.usage.output,
        });
        return { text: res.text, modelUsed: res.modelUsed, providerUsed: resolvedProvider };
      }

      const opencodeStatus = statuses.find((s) => s.provedor === "opencode");
      if (resolvedProvider === "opencode" && opencodeStatus?.conectado) {
        const res = await this.deps.providerConnection.getOpenCodeService().executePrompt({
          modelId: model,
          systemPrompt: params.systemPrompt || undefined,
          messages: [{ role: "user", text: params.prompt }],
          agentId: params.agentId,
        });
        return { text: res.text, modelUsed: model, providerUsed: "opencode" };
      }

      const agStatus = statuses.find((s) => s.provedor === "gemini");
      if (resolvedProvider === "gemini" && agStatus?.conectado && agStatus.modo_conexao !== "api_key") {
        const res = await this.deps.providerConnection.getAntigravityService().executeCodeAssistGenerate({
          model,
          systemPrompt: params.systemPrompt || undefined,
          messages: [{ role: "user", text: params.prompt }],
          imagePaths: params.imagePaths,
          agentId: params.agentId,
        });
        recordChatTurnUsage(this.deps.db, {
          agentId: params.agentId ?? "workflow-llm",
          sessionId,
          turnId,
          provider: "antigravity",
          model: res.modelUsed,
          uncachedInput: res.usage.uncachedInput,
          cachedInput: res.usage.cachedInput,
          output: res.usage.output,
        });
        return { text: res.text, modelUsed: res.modelUsed, providerUsed: "antigravity" };
      }
    } catch {
      // fallback final ao ProviderRegistry (permite mocks customizados via registerCustomProvider)
    }

    return await tryRegistryClient();
  }

  private getScopeForRun(run: WorkflowRunRecord, graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] }): Set<string> {
    const cached = this.runScopeCache.get(run.run_id);
    if (cached) return cached;

    const latestDone = this.deps.store.listLatestDoneStepsByNode(run.workflow_id);
    const answers = currentAnswers(graph, latestDone.stepsByNode, latestDone.ranWithGraph);
    const scopeRes = runScope(graph, {
      triggerNodeId: run.trigger_node_id ?? undefined,
      fromNodeId: run.from_node_id ?? undefined,
      answers,
    });
    this.runScopeCache.set(run.run_id, scopeRes.scope);
    return scopeRes.scope;
  }

  private emitStepUpdated(step: WorkflowStepRecord): void {
    this.deps.wsHub.broadcast("workflow:step_updated", {
      workflow_id: step.workflow_id,
      run_id: step.run_id,
      step_id: step.step_id,
      node_id: step.node_id,
      status: step.status,
      branch: step.branch,
    });
  }

  private emitRunUpdated(run: WorkflowRunRecord): void {
    this.deps.wsHub.broadcast("workflow:run_updated", {
      workflow_id: run.workflow_id,
      run_id: run.run_id,
      numero: run.numero,
      status: run.status,
    });
  }

  private parseRunGraph(run: WorkflowRunRecord): { nos: WorkflowNo[]; arestas: WorkflowAresta[] } {
    const parsed = safeJsonParse<{ nos?: WorkflowNo[]; arestas?: WorkflowAresta[] }>(run.grafo_json, {});
    const normalized = normalizeWorkflowGraph({
      nos: parsed.nos ?? [],
      arestas: parsed.arestas ?? [],
    });
    return { nos: normalized.nos, arestas: normalized.arestas };
  }

  private buildLatestStepsMap(steps: WorkflowStepRecord[]): Map<string, WorkflowStepRecord> {
    const map = new Map<string, WorkflowStepRecord>();
    for (const step of steps) {
      map.set(step.node_id, step);
    }
    return map;
  }

  private interpolateBrandPlaceholders(raw: string): string {
    const brand = getBrandIdentity(this.deps.providerConnection);
    return raw
      .replaceAll("[NOME_DA_MARCA]", brand.marca_nome)
      .replaceAll("[@SEU_PERFIL]", brand.perfil_handle)
      .replaceAll("[NICHO]", brand.nicho)
      .replaceAll("[TOM_DE_VOZ]", brand.tom_voz)
      .replaceAll("{{marca_nome}}", brand.marca_nome)
      .replaceAll("{{perfil_handle}}", brand.perfil_handle)
      .replaceAll("{{nicho}}", brand.nicho)
      .replaceAll("{{tom_voz}}", brand.tom_voz);
  }

  private createAgentTaskForStep(params: {
    workflowId: string;
    runId: string | null;
    stepId: string;
    node: WorkflowNo;
    promptText: string;
    mediaPaths: string[];
  }): TarefaRegistro {
    const agenteId =
      params.node.agenteId ??
      (typeof params.node.config.agenteId === "string" ? params.node.config.agenteId : undefined) ??
      "estrategista";

    return this.deps.queue.enqueueTask({
      agente_id: agenteId,
      canal_origem: "web",
      tipo: "workflow_step",
      titulo: params.node.titulo || `Etapa ${params.node.id}`,
      prioridade: 3,
      payload: {
        workflow_id: params.workflowId,
        run_id: params.runId,
        step_id: params.stepId,
        node_id: params.node.id,
        prompt: params.promptText,
        image_paths: params.mediaPaths,
      },
    });
  }

  private async runNodeExecution(params: {
    step: WorkflowStepRecord;
    node: WorkflowNo;
    graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] };
    inputs: WorkflowBuiltInputs;
    stepsByNode: Map<string, WorkflowStepRecord>;
    loops: Set<string>;
    runPayload: string | null;
    signal?: AbortSignal;
    skipSweep?: boolean;
  }): Promise<void> {
    const { step, node, graph, inputs, stepsByNode, loops, runPayload, signal, skipSweep } = params;
    const kind = normalizeNodeKind(node.tipo);
    const cfg = node.config ?? {};

    if (this.disposed || signal?.aborted) {
      const stopped = this.deps.store.updateStep(step.step_id, {
        status: "stopped",
        erro: "Execução interrompida.",
      });
      if (stopped) this.emitStepUpdated(stopped);
      return;
    }

    try {
      if (kind === "gatilho") {
        const out = runPayload ?? inputs.inputText ?? "Disparado manualmente";
        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: out,
          outputTipo: "text",
          artefatos: [],
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "prompt") {
        const template =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        let resolvedText = template.includes("{{input}}")
          ? template.replaceAll("{{input}}", inputs.inputText)
          : template && inputs.inputText
            ? `${template}\n\n${inputs.inputText}`
            : template || inputs.inputText;
        resolvedText = this.interpolateBrandPlaceholders(resolvedText);

        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: resolvedText,
          outputTipo: "text",
          artefatos: [],
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "asset") {
        const fileIdOrPath =
          node.fileId ??
          (typeof cfg.fileId === "string" ? cfg.fileId : undefined) ??
          (typeof cfg.caminho_relativo === "string" ? cfg.caminho_relativo : undefined) ??
          "";
        if (!fileIdOrPath) {
          throw new Error(`Nó asset '${node.titulo || node.id}' sem arquivo selecionado.`);
        }

        const fileRow = this.deps.db.connection
          .prepare(
            `SELECT arquivo_id, caminho_relativo, mime_type FROM projecao_arquivos WHERE arquivo_id = ? OR caminho_relativo = ? LIMIT 1;`
          )
          .get(fileIdOrPath, fileIdOrPath) as
          | { arquivo_id: string; caminho_relativo: string; mime_type: string }
          | undefined;

        const relPath = fileRow?.caminho_relativo ?? fileIdOrPath;
        const absFile = this.resolveWithinRoot(relPath);
        if (!existsSync(absFile)) {
          throw new Error(`Arquivo de ativo não encontrado no disco: ${relPath}`);
        }

        const isImage =
          fileRow?.mime_type?.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif)$/i.test(relPath);
        const outTipo: WorkflowPortType = isImage ? "image" : "file";
        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: fileRow?.arquivo_id ?? relPath,
          outputTipo: outTipo,
          artefatos: [relPath],
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "llm") {
        const basePrompt =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const fullPrompt =
          basePrompt && inputs.inputText
            ? `${basePrompt}\n\n${inputs.inputText}`
            : basePrompt || inputs.inputText || "Responda de forma objetiva.";
        const sysPrompt =
          node.systemPrompt ??
          (typeof cfg.systemPrompt === "string" ? cfg.systemPrompt : undefined);
        const safeImagePaths = inputs.mediaInputs
          .filter((m) => m.portType === "image")
          .map((m) => {
            try {
              return this.resolveWithinRoot(m.path);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p && existsSync(p)));

        const result = await this.generationLock.withLock(
          () =>
            this.executeDirectModelText({
              model: node.model ?? (typeof cfg.model === "string" ? cfg.model : undefined),
              provider: node.provider ?? (typeof cfg.provider === "string" ? cfg.provider : undefined),
              effort: node.effort ?? (typeof cfg.effort === "string" ? cfg.effort : undefined),
              systemPrompt: sysPrompt,
              prompt: fullPrompt,
              imagePaths: safeImagePaths,
              signal,
            }),
          signal
        );

        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: result.text,
          outputTipo: "text",
          artefatos: [],
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "agente") {
        const agenteId =
          node.agenteId ??
          (typeof cfg.agenteId === "string" ? cfg.agenteId : undefined) ??
          "estrategista";

        const promptBase =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const combinedPrompt =
          promptBase && inputs.inputText
            ? `${promptBase}\n\n[Entrada do workflow]\n${inputs.inputText}`
            : promptBase || inputs.inputText || `Executar etapa '${node.titulo}'`;

        const mediaPaths = inputs.mediaInputs
          .map((m) => {
            try {
              return this.resolveWithinRoot(m.path);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p));

        let tarefa: TarefaRegistro | null = null;
        if (step.tarefa_id) {
          tarefa = this.deps.queue.getTask(step.tarefa_id);
        }
        if (!tarefa) {
          tarefa = this.createAgentTaskForStep({
            workflowId: step.workflow_id,
            runId: step.run_id,
            stepId: step.step_id,
            node,
            promptText: combinedPrompt,
            mediaPaths,
          });
          this.deps.store.updateStep(step.step_id, { tarefaId: tarefa.tarefa_id });
        }

        if (!this.deps.runner) {
          throw new Error("AgentRunner não conectado ao WorkflowEngine.");
        }

        const runnerRes = await this.deps.runner.runTask(tarefa);

        // Verifica se a etapa não foi interrompida externamente enquanto o agente executava
        const latestSelf = this.deps.store.getStep(step.step_id);
        if (latestSelf?.status === "stopped") {
          return;
        }

        if (runnerRes.failureReason) {
          throw new Error(runnerRes.failureReason);
        }

        const relArtifacts = runnerRes.generatedArtifacts.map((p) => {
          try {
            const abs = resolve(this.deps.workspaceRoot, p);
            if (abs.startsWith(resolve(this.deps.workspaceRoot) + sep)) {
              return relative(resolve(this.deps.workspaceRoot), abs).replace(/\\/g, "/");
            }
          } catch {
            // mantém string original
          }
          return p;
        });

        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: runnerRes.finalText,
          outputTipo: relArtifacts.length > 0 ? "file" : "text",
          artefatos: relArtifacts,
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "gerar_imagem") {
        const promptBase =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const promptFinal =
          promptBase && inputs.inputText
            ? `${promptBase}\n\n${inputs.inputText}`
            : promptBase || inputs.inputText || "Arte visual profissional em estética limpa";
        const aspect =
          cfg.aspectRatio === "9:16" || cfg.aspectRatio === "1:1" || cfg.aspectRatio === "3:4"
            ? cfg.aspectRatio
            : "3:4";

        const safeRefs = inputs.mediaInputs
          .filter((m) => m.portType === "image")
          .map((m) => {
            try {
              return this.resolveWithinRoot(m.path);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p && existsSync(p)));

        const result = await this.mediaLock.withLock(async () => {
          const arquivoId = `arte-wf-${randomUUID().slice(0, 8)}`;
          const relPath = `saidas/artes/${arquivoId}.png`;
          const outputPath = resolve(this.deps.workspaceRoot, relPath);
          mkdirSync(resolve(outputPath, ".."), { recursive: true });

          const hasImgApiKey =
            Boolean(this.deps.vault.getSecret("gemini_api_key")) ||
            Boolean(this.deps.vault.getSecret("google_api_key")) ||
            Boolean(this.deps.vault.getSecret("openai_api_key")) ||
            Boolean(this.deps.vault.getSecret("fal_api_key"));

          if (hasImgApiKey) {
            await generateImageTool(
              {
                aspect_ratio: aspect,
                prompt: promptFinal,
                image_paths: safeRefs,
                output_path: outputPath,
              },
              { vault: this.deps.vault, fetchImpl: this.deps.fetchImpl }
            );
          } else {
            const agRes = await this.deps.providerConnection
              .getAntigravityService()
              .executeCodeAssistGenerate({
                model: "gemini-3.1-flash-image",
                messages: [{ role: "user", text: promptFinal }],
                generateImage: true,
                imagePaths: safeRefs,
              });
            if (!agRes.images || agRes.images.length === 0) {
              throw new Error("Nenhuma imagem retornada pelo provedor de geração.");
            }
            writeFileSync(outputPath, Buffer.from(agRes.images[0].dataBase64, "base64"));
          }

          const sizeBytes = existsSync(outputPath) ? readFileSync(outputPath).length : 0;
          this.deps.db.connection
            .prepare(
              `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
               VALUES (?, ?, ?, 'image/png', ?, 'gerado', NULL, NULL, ?);`
            )
            .run(arquivoId, `${arquivoId}.png`, relPath, sizeBytes, new Date().toISOString());

          return { arquivoId, relPath };
        }, signal);

        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: result.arquivoId,
          outputTipo: "image",
          artefatos: [result.relPath],
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "render_video") {
        const audioInput = inputs.mediaInputs.find(
          (m) => m.portType === "file" && /\.(mp3|wav|m4a|ogg)$/i.test(m.path)
        );
        const composicao =
          cfg.composicao === "ReelsTalkingHead" ? "ReelsTalkingHead" : "ReelsFaceless";

        const result = await this.mediaLock.withLock(async () => {
          const arquivoId = `video-wf-${randomUUID().slice(0, 8)}`;
          const relPath = `saidas/videos/${arquivoId}.mp4`;
          const outputPath = resolve(this.deps.workspaceRoot, relPath);
          const audioAbs = audioInput
            ? this.resolveWithinRoot(audioInput.path)
            : typeof cfg.audioPath === "string"
              ? this.resolveWithinRoot(cfg.audioPath)
              : "";

          await executeRemotionRender({
            composicao,
            audio_path: audioAbs,
            output_path: outputPath,
            remotionProjectDir: this.deps.workspaceRoot,
            props: {
              roteiroTexto: inputs.inputText,
              imagens: inputs.mediaInputs
                .filter((m) => m.portType === "image")
                .map((m) => m.path),
            },
          });

          const sizeBytes = existsSync(outputPath) ? readFileSync(outputPath).length : 0;
          this.deps.db.connection
            .prepare(
              `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
               VALUES (?, ?, ?, 'video/mp4', ?, 'video', NULL, NULL, ?);`
            )
            .run(arquivoId, `${arquivoId}.mp4`, relPath, sizeBytes, new Date().toISOString());

          return { arquivoId, relPath };
        }, signal);

        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: result.arquivoId,
          outputTipo: "file",
          artefatos: [result.relPath],
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "condition") {
        const rule =
          node.rule ??
          (typeof cfg.rule === "string" ? cfg.rule : undefined) ??
          "A entrada atende à condição?";
        const promptCond = conditionPrompt(rule, inputs.inputText);
        const result = await this.generationLock.withLock(
          () =>
            this.executeDirectModelText({
              model: node.model ?? (typeof cfg.model === "string" ? cfg.model : undefined),
              provider: node.provider ?? (typeof cfg.provider === "string" ? cfg.provider : undefined),
              prompt: promptCond,
              signal,
            }),
          signal
        );

        const branch = conditionAnswer(result.text);
        if (!branch) {
          throw new Error(
            `Resposta ambígua ao avaliar condição ('${result.text.slice(0, 80)}'). Esperado 'yes' ou 'no'.`
          );
        }

        const updated = this.deps.store.updateStep(step.step_id, {
          status: "done",
          output: inputs.inputText,
          outputTipo: "text",
          artefatos: [],
          branch,
        });
        if (updated) this.emitStepUpdated(updated);
      } else if (kind === "approval") {
        const updated = this.deps.store.updateStep(step.step_id, {
          status: "approval",
          output: null,
          artefatos: inputs.mediaInputs.map((m) => m.path),
        });
        if (updated) this.emitStepUpdated(updated);

        if (step.run_id) {
          const pausedRun = this.deps.store.updateRunStatus(step.run_id, "approval");
          if (pausedRun) this.emitRunUpdated(pausedRun);
        }

        const wfVisual = this.deps.store.getWorkflowVisual(step.workflow_id);
        const question =
          node.question ??
          (typeof cfg.question === "string" ? cfg.question : undefined) ??
          "Confirma a continuação deste workflow?";

        if (this.deps.telegramBot) {
          const chatId =
            (typeof cfg.telegramChatId === "string" ? cfg.telegramChatId : undefined) ??
            (typeof cfg.chatId === "string" ? cfg.chatId : undefined);
          try {
            await this.deps.telegramBot.sendWorkflowApproval({
              stepId: step.step_id,
              workflowNome: wfVisual?.nome ?? step.workflow_id,
              question,
              previewText: inputs.inputText || "(etapa com anexos pronta para revisão)",
              chatId,
            });
          } catch {
            // Notificação Telegram é opcional; nunca bloqueia pausa de aprovação
          }
        }

        const waJid = typeof cfg.whatsappJid === "string" ? cfg.whatsappJid.trim() : "";
        if (waJid && this.whatsappAdapter?.getStatus().status === "conectado") {
          try {
            await this.whatsappAdapter.sendMessage(waJid, {
              text: `⏸ Aprovação pendente no workflow "${wfVisual?.nome ?? step.workflow_id}": ${question}\nEtapa #${step.step_id}`,
            });
          } catch {
            // opcional
          }
        }
        return;
      } else if (kind === "output") {
        const target: WorkflowOutputTarget =
          node.target ??
          (typeof cfg.target === "string" ? (cfg.target as WorkflowOutputTarget) : undefined) ??
          "notificacao";
        const targetRef =
          node.targetRef ??
          (typeof cfg.targetRef === "string" ? cfg.targetRef : undefined) ??
          "";

        const mediaPaths = inputs.mediaInputs.map((m) => m.path);
        const delivery = this.deps.store.upsertDelivery({
          stepId: step.step_id,
          destino: target,
          destinoRef: targetRef || "default",
          texto: inputs.inputText,
          anexos: mediaPaths,
        });

        // Trava obrigatória antes de claim/envio para Meta API (D-04)
        if (target === "instagram") {
          const approvedUpstream = hasUpstreamApprovedStep(
            node.id,
            graph.arestas,
            stepsByNode,
            loops,
            graph.nos
          );
          if (!approvedUpstream) {
            const blockMsg =
              "BLOQUEIO DE SEGURANÇA: Nó output(instagram) exige uma etapa approval aprovada a montante antes da publicação oficial.";
            this.deps.store.markDeliveryResult(delivery.step_id, "failed", blockMsg);
            throw new Error(blockMsg);
          }
        }

        const claimed = this.deps.store.claimDeliveryForSending(delivery.step_id);
        if (!claimed) {
          throw new Error("Entrega desta etapa já está em processamento ou foi enviada.");
        }

        try {
          let resultSummary = "";

          if (target === "canal") {
            const canalId = targetRef || "canal-geral";
            const msgId = `msg_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
            const nowIso = new Date().toISOString();
            const textoFinal = inputs.inputText || "(workflow concluído)";
            const wfVisual = this.deps.store.getWorkflowVisual(step.workflow_id);
            const authorName = wfVisual?.nome || "Workflow";

            this.deps.db.connection
              .prepare(
                `
                INSERT INTO projecao_conversas_chat (
                  mensagem_id, canal_id, agente_id, autor, autor_nome,
                  conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em
                ) VALUES (?, ?, NULL, 'agente', ?, ?, ?, '[]', NULL, 0, ?);
              `
              )
              .run(
                msgId,
                canalId,
                authorName,
                textoFinal,
                JSON.stringify(mediaPaths),
                nowIso
              );

            this.deps.wsHub.broadcast("chat:message", {
              canal_id: canalId,
              agente_id: null,
              mensagem: {
                mensagem_id: msgId,
                canal_id: canalId,
                agente_id: null,
                autor: "agente",
                autor_nome: authorName,
                conteudo_markdown: textoFinal,
                anexos: [],
                steps: [],
                tarefa_id: null,
                lida: false,
                criado_em: nowIso,
              },
            });
            resultSummary = `Mensagem entregue no canal '${canalId}'.`;
          } else if (target === "whatsapp") {
            if (!this.whatsappAdapter || this.whatsappAdapter.getStatus().status !== "conectado") {
              throw new Error("WhatsApp desconectado para entrega do workflow.");
            }
            if (!targetRef) {
              throw new Error("Destino WhatsApp (targetRef JID/número) não configurado.");
            }
            const firstImage = inputs.mediaInputs.find((m) => m.portType === "image");
            if (firstImage) {
              const absImg = this.resolveWithinRoot(firstImage.path);
              await this.whatsappAdapter.sendMessage(targetRef, {
                image: readFileSync(absImg),
                caption: inputs.inputText || undefined,
              });
            } else {
              await this.whatsappAdapter.sendMessage(targetRef, {
                text: inputs.inputText || "(workflow concluído)",
              });
            }
            resultSummary = `Enviado no WhatsApp para '${targetRef}'.`;
          } else if (target === "telegram") {
            if (!this.deps.telegramBot) {
              throw new Error("Bot Telegram indisponível para entrega do workflow.");
            }
            const res = await this.deps.telegramBot.sendWorkflowMessage({
              text: inputs.inputText || "(workflow concluído)",
              chatId: targetRef || undefined,
            });
            resultSummary = `Enviado no Telegram (message_id=${res.message_id}).`;
          } else if (target === "arquivo") {
            const { absPath, relPath } = this.resolveSafeOutputFile(
              targetRef || `workflow-${step.workflow_id}-${step.node_id}.txt`
            );
            const firstMedia = inputs.mediaInputs[0];
            if (firstMedia && !inputs.inputText) {
              const srcAbs = this.resolveWithinRoot(firstMedia.path);
              copyFileSync(srcAbs, absPath);
            } else {
              writeFileSync(absPath, inputs.inputText || "", "utf8");
            }
            const sizeBytes = existsSync(absPath) ? readFileSync(absPath).length : 0;
            const arquivoId = `out-wf-${randomUUID().slice(0, 8)}`;
            const ext = extname(absPath).toLowerCase();
            const mimeType =
              ext === ".png"
                ? "image/png"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".mp4"
                    ? "video/mp4"
                    : "text/plain; charset=utf-8";

            this.deps.db.connection
              .prepare(
                `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
                 VALUES (?, ?, ?, ?, ?, 'documento', NULL, NULL, ?);`
              )
              .run(arquivoId, basename(absPath), relPath, mimeType, sizeBytes, new Date().toISOString());

            resultSummary = `Arquivo salvo em ${relPath}`;
          } else if (target === "instagram") {
            const mediaUrls =
              Array.isArray(cfg.mediaUrls) && cfg.mediaUrls.length > 0
                ? cfg.mediaUrls.filter((u): u is string => typeof u === "string")
                : mediaPaths;
            const mediaType =
              cfg.mediaType === "REELS" || cfg.mediaType === "STORIES" || cfg.mediaType === "CAROUSEL"
                ? cfg.mediaType
                : mediaPaths.some((p) => /\.mp4$/i.test(p))
                  ? "REELS"
                  : "IMAGE";

            const pub = await metaPublishTool(
              {
                media_type: mediaType,
                media_urls: mediaUrls,
                caption: inputs.inputText || "",
                approved_by_human: true,
              },
              { vault: this.deps.vault, fetchImpl: this.deps.fetchImpl }
            );
            resultSummary = `Publicado no Instagram (${pub.media_id}): ${pub.permalink}`;
          } else {
            this.deps.wsHub.broadcast("workflow:status", {
              workflow_id: step.workflow_id,
              status: "concluido",
              no_atual: node.id,
              resumo: (inputs.inputText || "Etapa de notificação concluída.").slice(0, 300),
            });
            resultSummary = inputs.inputText || "Notificação emitida no Cockpit.";
          }

          this.deps.store.markDeliveryResult(delivery.step_id, "sent", null);
          const updated = this.deps.store.updateStep(step.step_id, {
            status: "done",
            output: resultSummary,
            outputTipo: "text",
            artefatos: mediaPaths,
          });
          if (updated) this.emitStepUpdated(updated);
        } catch (deliveryErr) {
          const msg = sanitizeProviderError(
            deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr),
            this.getSecretsListForRedaction()
          );
          this.deps.store.markDeliveryResult(delivery.step_id, "failed", msg);
          throw new Error(msg);
        }
      }
    } catch (err) {
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : String(err),
        this.getSecretsListForRedaction()
      );
      const updated = this.deps.store.updateStep(step.step_id, {
        status: "failed",
        erro: msg,
      });
      if (updated) this.emitStepUpdated(updated);
      if (step.run_id && !skipSweep) {
        await this.sweepRun(step.run_id);
      }
      return;
    }

    if (step.run_id && !skipSweep) {
      await this.sweepRun(step.run_id);
    }
  }

  private async dispatchReadyInitialSteps(runDetail: WorkflowRunDetail): Promise<WorkflowRunDetail> {
    const run = runDetail.run;
    const graph = this.parseRunGraph(run);
    const execNodes = graph.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
    const loops = workflowLoopEdges(execNodes, graph.arestas);
    const nodeById = new Map(execNodes.map((n) => [n.id, n]));
    const scope = this.getScopeForRun(run, graph);

    const controller = new AbortController();
    this.runAbortControllers.set(run.run_id, controller);

    // 1. Executa síncronamente gatilhos prontos iniciais para liberar raízes imediatamente
    for (let pass = 0; pass < 3; pass += 1) {
      const latestDetail = this.deps.store.getRunDetail(run.run_id);
      if (!latestDetail) break;

      const actions = nextActions({
        nos: graph.nos,
        arestas: graph.arestas,
        scope,
        steps: latestDetail.steps,
        maxLoopPasses: MAX_LOOP_PASSES,
      });

      const triggerRuns = actions.filter(
        (a) => a.action === "run" && nodeById.get(a.nodeId)?.tipo === "gatilho"
      );
      if (triggerRuns.length === 0) break;

      const stepsByNode = this.buildLatestStepsMap(latestDetail.steps);
      for (const act of triggerRuns) {
        const node = nodeById.get(act.nodeId)!;
        const attemptNum =
          latestDetail.steps.filter((s) => s.node_id === node.id).length + 1;
        const reqId = `run:${run.run_id}:node:${node.id}:t${attemptNum}`;
        const { step, created } = this.deps.store.createOrGetStep({
          workflowId: run.workflow_id,
          runId: run.run_id,
          nodeId: node.id,
          requestId: reqId,
          kind: normalizeNodeKind(node.tipo),
          agenteId: node.agenteId ?? null,
          status: "running",
          input: run.payload ?? "",
        });
        if (created) {
          this.emitStepUpdated(step);
          const inputs = buildNodeInputs({
            node,
            nos: graph.nos,
            arestas: graph.arestas,
            latestSteps: stepsByNode,
            loops,
          });
          await this.runNodeExecution({
            step,
            node,
            graph,
            inputs,
            stepsByNode,
            loops,
            runPayload: run.payload,
            signal: controller.signal,
            skipSweep: true,
          });
        }
      }
    }

    // 2. Despacha etapas raiz imediatas (garantindo tarefa_id gravado para `agente`)
    const afterTriggers = this.deps.store.getRunDetail(run.run_id);
    if (afterTriggers && afterTriggers.run.status === "running") {
      const initialActions = nextActions({
        nos: graph.nos,
        arestas: graph.arestas,
        scope,
        steps: afterTriggers.steps,
        maxLoopPasses: MAX_LOOP_PASSES,
      });

      const stepsByNode = this.buildLatestStepsMap(afterTriggers.steps);

      for (const act of initialActions) {
        const node = nodeById.get(act.nodeId);
        if (!node) continue;
        const attemptNum =
          afterTriggers.steps.filter((s) => s.node_id === node.id).length + 1;
        const reqId = `run:${run.run_id}:node:${node.id}:t${attemptNum}`;

        if (act.action === "skip") {
          const { step, created } = this.deps.store.createOrGetStep({
            workflowId: run.workflow_id,
            runId: run.run_id,
            nodeId: node.id,
            requestId: reqId,
            kind: normalizeNodeKind(node.tipo),
            agenteId: node.agenteId ?? null,
            status: "skipped",
            input: "",
            erro: act.reason ?? null,
          });
          if (created) this.emitStepUpdated(step);
          continue;
        }

        const kind = normalizeNodeKind(node.tipo);
        const inputs = buildNodeInputs({
          node,
          nos: graph.nos,
          arestas: graph.arestas,
          latestSteps: stepsByNode,
          loops,
        });

        let initialTarefaId: string | null = null;
        const { step, created } = this.deps.store.createOrGetStep({
          workflowId: run.workflow_id,
          runId: run.run_id,
          nodeId: node.id,
          requestId: reqId,
          kind,
          agenteId:
            node.agenteId ??
            (typeof node.config.agenteId === "string" ? node.config.agenteId : null),
          status: "running",
          input: inputs.inputText,
        });

        if (created && kind === "agente") {
          const promptBase =
            node.prompt ??
            (typeof node.config.prompt === "string" ? node.config.prompt : "") ??
            "";
          const combinedPrompt =
            promptBase && inputs.inputText
              ? `${promptBase}\n\n[Entrada do workflow]\n${inputs.inputText}`
              : promptBase || inputs.inputText || `Executar etapa '${node.titulo}'`;
          const mediaPaths = inputs.mediaInputs
            .map((m) => {
              try {
                return this.resolveWithinRoot(m.path);
              } catch {
                return null;
              }
            })
            .filter((p): p is string => Boolean(p));

          const tarefa = this.createAgentTaskForStep({
            workflowId: run.workflow_id,
            runId: run.run_id,
            stepId: step.step_id,
            node,
            promptText: combinedPrompt,
            mediaPaths,
          });
          initialTarefaId = tarefa.tarefa_id;
          this.deps.store.updateStep(step.step_id, { tarefaId: initialTarefaId });
        }

        if (created) {
          const refreshedStep = this.deps.store.getStep(step.step_id) ?? step;
          this.emitStepUpdated(refreshedStep);

          const taskPromise = this.runNodeExecution({
            step: refreshedStep,
            node,
            graph,
            inputs,
            stepsByNode,
            loops,
            runPayload: run.payload,
            signal: controller.signal,
          });
          this.trackPromise(taskPromise);
        }
      }

      if (initialActions.length === 0) {
        await this.sweepRun(run.run_id);
      }
    }

    return this.deps.store.getRunDetail(run.run_id) ?? runDetail;
  }

  public async sweep(workflowId?: string): Promise<void> {
    if (this.disposed) return;
    const rows = workflowId
      ? (this.deps.db.connection
          .prepare(
            `SELECT run_id FROM projecao_workflow_execucoes WHERE workflow_id = ? AND status IN ('running', 'stopping') ORDER BY iniciado_em ASC;`
          )
          .all(workflowId) as Array<{ run_id: string }>)
      : (this.deps.db.connection
          .prepare(
            `SELECT run_id FROM projecao_workflow_execucoes WHERE status IN ('running', 'stopping') ORDER BY iniciado_em ASC;`
          )
          .all() as Array<{ run_id: string }>);

    for (const row of rows) {
      await this.sweepRun(row.run_id);
    }
  }

  public async sweepRun(runId: string): Promise<void> {
    if (this.disposed) return;
    if (this.sweepingRuns.has(runId)) {
      this.pendingSweepRuns.add(runId);
      return;
    }

    this.sweepingRuns.add(runId);
    try {
      let keepRunning = true;
      while (keepRunning && !this.disposed) {
        this.pendingSweepRuns.delete(runId);
        const detail = this.deps.store.getRunDetail(runId);
        if (!detail) break;

        const { run, steps } = detail;
        if (run.status === "stopping") {
          for (const s of steps) {
            if (s.status === "running" || s.status === "approval") {
              const updated = this.deps.store.updateStep(s.step_id, {
                status: "stopped",
                erro: s.erro ?? "Execução interrompida.",
              });
              if (updated) this.emitStepUpdated(updated);
            }
          }
          const stoppedRun = this.deps.store.updateRunStatus(runId, "stopped");
          if (stoppedRun) this.emitRunUpdated(stoppedRun);
          this.runAbortControllers.delete(runId);
          break;
        }

        if (run.status !== "running") {
          break;
        }

        const graph = this.parseRunGraph(run);
        const execNodes = graph.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
        const loops = workflowLoopEdges(execNodes, graph.arestas);
        const nodeById = new Map(execNodes.map((n) => [n.id, n]));
        const scope = this.getScopeForRun(run, graph);

        const actions = nextActions({
          nos: graph.nos,
          arestas: graph.arestas,
          scope,
          steps,
          maxLoopPasses: MAX_LOOP_PASSES,
        });

        const controller =
          this.runAbortControllers.get(runId) ??
          (() => {
            const c = new AbortController();
            this.runAbortControllers.set(runId, c);
            return c;
          })();

        const stepsByNode = this.buildLatestStepsMap(steps);
        let didSyncChange = false;

        for (const act of actions) {
          const node = nodeById.get(act.nodeId);
          if (!node) continue;
          const attemptNum = steps.filter((s) => s.node_id === node.id).length + 1;
          const reqId = `run:${runId}:node:${node.id}:t${attemptNum}`;

          if (act.action === "skip") {
            const { step, created } = this.deps.store.createOrGetStep({
              workflowId: run.workflow_id,
              runId,
              nodeId: node.id,
              requestId: reqId,
              kind: normalizeNodeKind(node.tipo),
              agenteId: node.agenteId ?? null,
              status: "skipped",
              input: "",
              erro: act.reason ?? null,
            });
            if (created) {
              this.emitStepUpdated(step);
              didSyncChange = true;
            }
            continue;
          }

          const kind = normalizeNodeKind(node.tipo);
          const inputs = buildNodeInputs({
            node,
            nos: graph.nos,
            arestas: graph.arestas,
            latestSteps: stepsByNode,
            loops,
          });

          const { step, created } = this.deps.store.createOrGetStep({
            workflowId: run.workflow_id,
            runId,
            nodeId: node.id,
            requestId: reqId,
            kind,
            agenteId:
              node.agenteId ??
              (typeof node.config.agenteId === "string" ? node.config.agenteId : null),
            status: "running",
            input: inputs.inputText,
          });

          if (created) {
            this.emitStepUpdated(step);
            const execPromise = this.runNodeExecution({
              step,
              node,
              graph,
              inputs,
              stepsByNode,
              loops,
              runPayload: run.payload,
              signal: controller.signal,
            });
            this.trackPromise(execPromise);
          }
        }

        // Recarrega etapas para checar convergência terminal do run
        const fresh = this.deps.store.getRunDetail(runId);
        if (!fresh) break;

        const hasOpenSteps = fresh.steps.some(
          (s) => s.status === "running" || s.status === "approval"
        );
        const hasApprovalStep = fresh.steps.some((s) => s.status === "approval");

        if (hasApprovalStep && fresh.run.status !== "approval") {
          const paused = this.deps.store.updateRunStatus(runId, "approval");
          if (paused) this.emitRunUpdated(paused);
          break;
        }

        const remainingActions = nextActions({
          nos: graph.nos,
          arestas: graph.arestas,
          scope,
          steps: fresh.steps,
          maxLoopPasses: MAX_LOOP_PASSES,
        });

        if (!hasOpenSteps && remainingActions.length === 0) {
          const anyFailed = fresh.steps.find((s) => s.status === "failed");
          const finalStatus = anyFailed ? "failed" : "done";
          const closedRun = this.deps.store.updateRunStatus(
            runId,
            finalStatus,
            anyFailed?.erro ?? null
          );
          if (closedRun) {
            this.emitRunUpdated(closedRun);
            this.deps.wsHub.broadcast("workflow:status", {
              workflow_id: closedRun.workflow_id,
              status: finalStatus === "done" ? "concluido" : "falha",
              resumo:
                finalStatus === "done"
                  ? `Execução #${closedRun.numero} concluída`
                  : anyFailed?.erro ?? "Falha na execução do workflow",
            });
          }
          this.runAbortControllers.delete(runId);
          break;
        }

        keepRunning = didSyncChange || this.pendingSweepRuns.has(runId);
      }
    } finally {
      this.sweepingRuns.delete(runId);
    }
  }

  public async startRun(input: {
    workflowId: string;
    origem: WorkflowRunOrigin;
    triggerNodeId?: string;
    fromNodeId?: string;
    payload?: unknown;
    requestId?: string;
    scheduledFor?: string;
  }): Promise<WorkflowRunDetail> {
    if (this.disposed) {
      throw new Error("WorkflowEngine já encerrado.");
    }

    const visual = this.deps.store.getWorkflowVisual(input.workflowId);
    if (!visual) {
      throw new WorkflowValidationError(`Workflow não encontrado: ${input.workflowId}`, 404);
    }

    const normalized = normalizeWorkflowGraph({
      nos: visual.nos,
      arestas: visual.arestas,
      tracos: visual.tracos,
    });
    const problem = workflowGraphProblemAt(normalized.nos, normalized.arestas);
    if (problem) {
      throw new WorkflowValidationError(problem, 400);
    }

    this.deps.store.saveRunVersionSnapshot(input.workflowId);

    const latestDone = this.deps.store.listLatestDoneStepsByNode(input.workflowId);
    const answers = currentAnswers(
      { nos: normalized.nos, arestas: normalized.arestas },
      latestDone.stepsByNode,
      latestDone.ranWithGraph
    );

    const scopeRes = runScope(
      { nos: normalized.nos, arestas: normalized.arestas },
      {
        triggerNodeId: input.triggerNodeId,
        fromNodeId: input.fromNodeId,
        answers,
      }
    );

    const payloadText =
      input.payload === undefined || input.payload === null
        ? null
        : typeof input.payload === "string"
          ? input.payload
          : JSON.stringify(input.payload);

    const idempotencyKey =
      input.requestId?.trim() || `manual:${randomUUID()}`;

    const { detail, deduplicated } = this.deps.store.createRunWithReusedSteps({
      workflowId: input.workflowId,
      triggerNodeId: input.triggerNodeId ?? null,
      fromNodeId: input.fromNodeId ?? null,
      origem: input.origem,
      scheduledFor: input.scheduledFor ?? null,
      idempotencyKey,
      payload: payloadText,
      reusedSteps: scopeRes.reused,
    });

    this.runScopeCache.set(detail.run.run_id, scopeRes.scope);

    if (deduplicated) {
      return detail;
    }

    this.emitRunUpdated(detail.run);
    this.deps.wsHub.broadcast("workflow:status", {
      workflow_id: input.workflowId,
      status: "executando",
      no_atual: input.fromNodeId ?? input.triggerNodeId ?? null,
      resumo: `Execução #${detail.run.numero} iniciada`,
    });

    return await this.dispatchReadyInitialSteps(detail);
  }

  public async runStep(input: {
    workflowId: string;
    nodeId: string;
    requestId?: string;
    payload?: unknown;
  }): Promise<WorkflowStepRecord> {
    if (this.disposed) {
      throw new Error("WorkflowEngine já encerrado.");
    }

    const visual = this.deps.store.getWorkflowVisual(input.workflowId);
    if (!visual) {
      throw new WorkflowValidationError(`Workflow não encontrado: ${input.workflowId}`, 404);
    }

    const node = visual.nos.find((n) => n.id === input.nodeId);
    if (!node || isAnnotationNodeKind(node.tipo)) {
      throw new WorkflowValidationError(`Nó executável não encontrado: ${input.nodeId}`, 404);
    }

    const latestDone = this.deps.store.listLatestDoneStepsByNode(input.workflowId);
    const validAnswers = currentAnswers(
      { nos: visual.nos, arestas: visual.arestas },
      latestDone.stepsByNode,
      latestDone.ranWithGraph
    );
    const inputs = soloInputs({
      node,
      nos: visual.nos,
      arestas: visual.arestas,
      latestDoneSteps: validAnswers,
    });

    const payloadText =
      input.payload === undefined || input.payload === null
        ? inputs.inputText
        : typeof input.payload === "string"
          ? input.payload
          : JSON.stringify(input.payload);

    const reqId = input.requestId?.trim() || `solo:${node.id}:${randomUUID()}`;
    const { step, created } = this.deps.store.createOrGetStep({
      workflowId: input.workflowId,
      runId: null,
      nodeId: node.id,
      requestId: reqId,
      kind: normalizeNodeKind(node.tipo),
      agenteId: node.agenteId ?? null,
      status: "running",
      input: payloadText,
    });

    if (!created) {
      return step;
    }

    this.emitStepUpdated(step);
    const execNodes = visual.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
    const loops = workflowLoopEdges(execNodes, visual.arestas);

    await this.runNodeExecution({
      step,
      node,
      graph: { nos: visual.nos, arestas: visual.arestas },
      inputs: { ...inputs, inputText: payloadText },
      stepsByNode: validAnswers,
      loops,
      runPayload: payloadText,
    });

    return this.deps.store.getStep(step.step_id) ?? step;
  }

  public async retryStep(stepId: string): Promise<WorkflowRunDetail | WorkflowStepRecord> {
    const oldStep = this.deps.store.getStep(stepId);
    if (!oldStep) {
      throw new WorkflowValidationError(`Etapa não encontrada: ${stepId}`, 404);
    }

    if (!oldStep.run_id) {
      return await this.runStep({
        workflowId: oldStep.workflow_id,
        nodeId: oldStep.node_id,
      });
    }

    const detail = this.deps.store.getRunDetail(oldStep.run_id);
    if (!detail) {
      throw new WorkflowValidationError(`Execução não encontrada: ${oldStep.run_id}`, 404);
    }

    const graph = this.parseRunGraph(detail.run);
    const node = graph.nos.find((n) => n.id === oldStep.node_id);
    if (!node) {
      throw new WorkflowValidationError(`Nó '${oldStep.node_id}' ausente no grafo do run.`, 404);
    }

    if (detail.run.status !== "running") {
      const reopened = this.deps.store.updateRunStatus(detail.run.run_id, "running", null);
      if (reopened) this.emitRunUpdated(reopened);
    }

    const reqId = `retry:${stepId}:${randomUUID().slice(0, 8)}`;
    const { step } = this.deps.store.createOrGetStep({
      workflowId: oldStep.workflow_id,
      runId: oldStep.run_id,
      nodeId: oldStep.node_id,
      requestId: reqId,
      kind: oldStep.kind,
      agenteId: oldStep.agente_id,
      status: "running",
      input: oldStep.input,
    });

    this.emitStepUpdated(step);

    const execNodes = graph.nos.filter((n) => !isAnnotationNodeKind(n.tipo));
    const loops = workflowLoopEdges(execNodes, graph.arestas);
    const stepsByNode = this.buildLatestStepsMap(detail.steps);
    const inputs = buildNodeInputs({
      node,
      nos: graph.nos,
      arestas: graph.arestas,
      latestSteps: stepsByNode,
      loops,
    });

    const controller = this.runAbortControllers.get(detail.run.run_id) ?? new AbortController();
    this.runAbortControllers.set(detail.run.run_id, controller);

    const p = this.runNodeExecution({
      step,
      node,
      graph,
      inputs,
      stepsByNode,
      loops,
      runPayload: detail.run.payload,
      signal: controller.signal,
    }).then(async () => {
      await this.sweepRun(detail.run.run_id!);
    });
    this.trackPromise(p);

    return this.deps.store.getRunDetail(detail.run.run_id) ?? detail;
  }

  public async decideStep(
    stepId: string,
    approved: boolean,
    decidedBy?: string
  ): Promise<WorkflowStepRecord> {
    const step = this.deps.store.getStep(stepId);
    if (!step) {
      throw new WorkflowValidationError(`Etapa não encontrada: ${stepId}`, 404);
    }
    if (step.status !== "approval") {
      throw new WorkflowValidationError(`Etapa '${stepId}' não está aguardando aprovação.`, 400);
    }

    if (approved) {
      const artefatos = safeJsonParse<unknown[]>(step.artefatos_json, []);
      const outTipo: WorkflowPortType =
        step.output_tipo ?? (artefatos.length > 0 ? "file" : "text");
      const doneStep = this.deps.store.updateStep(stepId, {
        status: "done",
        output: step.input || "Aprovado pelo usuário.",
        outputTipo: outTipo,
        erro: null,
      })!;
      this.emitStepUpdated(doneStep);

      if (step.run_id) {
        const resumedRun = this.deps.store.updateRunStatus(step.run_id, "running", null);
        if (resumedRun) this.emitRunUpdated(resumedRun);
        await this.sweepRun(step.run_id);
      }
      return doneStep;
    }

    const reason = decidedBy ? `Rejeitado por ${decidedBy}.` : "Rejeitado pelo usuário.";
    const stoppedStep = this.deps.store.updateStep(stepId, {
      status: "stopped",
      erro: reason,
    })!;
    this.emitStepUpdated(stoppedStep);

    if (step.run_id) {
      const detail = this.deps.store.getRunDetail(step.run_id);
      if (detail) {
        for (const s of detail.steps) {
          if (s.step_id !== stepId && (s.status === "running" || s.status === "approval")) {
            const closedOther = this.deps.store.updateStep(s.step_id, {
              status: "stopped",
              erro: reason,
            });
            if (closedOther) this.emitStepUpdated(closedOther);
          }
        }
      }
      const stoppedRun = this.deps.store.updateRunStatus(step.run_id, "stopped", reason);
      if (stoppedRun) this.emitRunUpdated(stoppedRun);
      this.runAbortControllers.get(step.run_id)?.abort();
      this.runAbortControllers.delete(step.run_id);
    }

    return stoppedStep;
  }

  public async stopRun(runId: string): Promise<WorkflowRunDetail | null> {
    const detail = this.deps.store.getRunDetail(runId);
    if (!detail) return null;

    this.runAbortControllers.get(runId)?.abort();
    this.runAbortControllers.delete(runId);

    for (const step of detail.steps) {
      if (step.status === "running" || step.status === "approval") {
        const updated = this.deps.store.updateStep(step.step_id, {
          status: "stopped",
          erro: "Execução parada pelo usuário.",
        });
        if (updated) this.emitStepUpdated(updated);
      }
    }

    const stoppedRun = this.deps.store.updateRunStatus(
      runId,
      "stopped",
      "Execução parada pelo usuário."
    );
    if (stoppedRun) this.emitRunUpdated(stoppedRun);

    return this.deps.store.getRunDetail(runId);
  }

  public async stopStep(stepId: string): Promise<void> {
    const step = this.deps.store.getStep(stepId);
    if (!step) return;
    if (step.run_id) {
      this.runAbortControllers.get(step.run_id)?.abort();
    }
    const updated = this.deps.store.updateStep(stepId, {
      status: "stopped",
      erro: "Etapa interrompida pelo usuário.",
    });
    if (updated) this.emitStepUpdated(updated);
  }

  public async recoverAndSweep(): Promise<{
    recoveredRuns: number;
    pausedApprovals: number;
    uncertainDeliveries: number;
  }> {
    let recoveredRuns = 0;
    let pausedApprovals = 0;
    let uncertainDeliveries = 0;

    // 1. Transicionar entregas em trânsito (`sending`) para `uncertain` sem reenviar duplicado
    const uncertainInfo = this.deps.db.connection
      .prepare(
        `
        UPDATE projecao_workflow_entregas
        SET status = 'uncertain',
            motivo = 'Envio interrompido por reinício do Daemon; verifique manualmente antes de reenviar.',
            atualizado_em = ?
        WHERE status = 'sending';
      `
      )
      .run(new Date().toISOString());
    uncertainDeliveries = Number(uncertainInfo.changes ?? 0);

    // 2. Recuperar execuções abertas
    const openRuns = this.deps.db.connection
      .prepare(
        `SELECT * FROM projecao_workflow_execucoes WHERE status IN ('running', 'approval', 'stopping') ORDER BY iniciado_em ASC;`
      )
      .all() as unknown as WorkflowRunRecord[];

    for (const run of openRuns) {
      const detail = this.deps.store.getRunDetail(run.run_id);
      if (!detail) continue;

      if (run.status === "stopping") {
        await this.stopRun(run.run_id);
        recoveredRuns += 1;
        continue;
      }

      let hasApproval = false;
      for (const step of detail.steps) {
        if (step.status === "approval") {
          hasApproval = true;
          pausedApprovals += 1;
          continue;
        }

        if (step.status === "running") {
          if (step.kind === "agente") {
            const tarefa = step.tarefa_id ? this.deps.queue.getTask(step.tarefa_id) : null;
            if (!tarefa) {
              const graph = this.parseRunGraph(run);
              const node = graph.nos.find((n) => n.id === step.node_id);
              if (node) {
                const newTask = this.createAgentTaskForStep({
                  workflowId: run.workflow_id,
                  runId: run.run_id,
                  stepId: step.step_id,
                  node,
                  promptText: step.input || `Retomando etapa ${node.titulo}`,
                  mediaPaths: [],
                });
                this.deps.store.updateStep(step.step_id, { tarefaId: newTask.tarefa_id });
              }
            } else if (tarefa.status === "concluido") {
              const resObj = (tarefa.resultado ?? {}) as Record<string, unknown>;
              const outText =
                typeof resObj.texto === "string"
                  ? resObj.texto
                  : typeof resObj.copy === "string"
                    ? resObj.copy
                    : "";
              const arts = Array.isArray(resObj.artefatos) ? resObj.artefatos : [];
              this.deps.store.updateStep(step.step_id, {
                status: "done",
                output: outText,
                artefatos: arts,
              });
            } else if (tarefa.status === "falha" || tarefa.status === "pendente") {
              this.deps.store.updateStep(step.step_id, {
                status: "failed",
                erro: tarefa.erro_detalhes ?? "Etapa de agente interrompida pelo reinício do Daemon.",
              });
            }
          } else {
            this.deps.store.updateStep(step.step_id, {
              status: "failed",
              erro: "Execução interrompida por reinício do Daemon.",
            });
          }
          recoveredRuns += 1;
        }
      }

      if (hasApproval && run.status !== "approval") {
        this.deps.store.updateRunStatus(run.run_id, "approval");
      } else if (!hasApproval && run.status === "running") {
        await this.sweepRun(run.run_id);
      }
    }

    return { recoveredRuns, pausedApprovals, uncertainDeliveries };
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.runAbortControllers.values()) {
      controller.abort();
    }
    this.runAbortControllers.clear();
    await Promise.allSettled([...this.activePromises]);
  }
}
