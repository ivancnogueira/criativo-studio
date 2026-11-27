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
import type { ProviderRegistry } from "../../engine/providers/provider-registry.ts";
import { recordChatTurnUsage } from "../../server/analytics-skills-service.ts";
import { getBrandIdentity } from "../../server/brand-onboarding-service.ts";
import { VAULT_KEYS_BY_PROVIDER, type WorkflowEngineRuntimeContext } from "./workflow-engine-types.ts";
import { resolveViableWorkflowModel } from "../workflow-model-resolver.ts";


export function resolveWorkflowPathWithinRoot(
  ctx: WorkflowEngineRuntimeContext,
relOrAbsPath: string): string {
    const absRoot = resolve(ctx.deps.workspaceRoot);
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

export function resolveWorkflowSafeOutputFile(
  ctx: WorkflowEngineRuntimeContext,
requestedName: string): { absPath: string; relPath: string } {
    const absOutputsRoot = resolve(ctx.deps.workspaceRoot, "saidas", "workflows");
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
    const relFromWorkspace = relative(resolve(ctx.deps.workspaceRoot), target).replace(/\\/g, "/");
    return { absPath: target, relPath: relFromWorkspace };
  }

export function getWorkflowSecretsForRedaction(
  ctx: WorkflowEngineRuntimeContext,
): string[] {
    const secrets: string[] = [];
    for (const meta of ctx.deps.vault.listSecretsMetadata()) {
      const val = ctx.deps.vault.getSecret(meta.chave_nome);
      if (val) secrets.push(val);
    }
    return secrets;
  }

export function hasWorkflowVaultApiKey(
  ctx: WorkflowEngineRuntimeContext,
providerName: string): boolean {
    const keys = VAULT_KEYS_BY_PROVIDER[providerName] ?? [];
    return keys.some((k) => {
      const val = ctx.deps.vault.getSecret(k);
      return Boolean(val && val.trim().length > 0);
    });
  }

export async function executeWorkflowDirectModelText(
  ctx: WorkflowEngineRuntimeContext,
params: {
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

    let model = params.model?.trim() || "";
    let resolvedProvider = params.provider?.trim() || "";

    if (!model) {
      const viable = await resolveViableWorkflowModel(
        {
          providers: ctx.deps.providers,
          providerConnection: ctx.deps.providerConnection,
          hasVaultApiKey: (prov) => hasWorkflowVaultApiKey(ctx, prov),
        },
        undefined,
        resolvedProvider || undefined
      );
      if (viable.source !== "none" && viable.model) {
        model = viable.model;
        resolvedProvider = viable.provider ?? ctx.deps.providers.resolveProviderName(model);
      } else {
        model = "gemini-2.5-pro";
      }
    }
    if (!resolvedProvider) {
      resolvedProvider = ctx.deps.providers.resolveProviderName(model);
    }
    const turnId = `wft_${randomUUID().slice(0, 12)}`;
    const sessionId = `workflow:${params.agentId ?? "llm"}`;

    const tryRegistryClient = async () => {
      const client = ctx.deps.providers.getClientForModel(model);
      const res = await client.executeTurn({
        model,
        systemPrompt: params.systemPrompt ?? "",
        messages: [{ role: "user", content: params.prompt }],
      });
      recordChatTurnUsage(ctx.deps.db, {
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
    if (hasWorkflowVaultApiKey(ctx, resolvedProvider) || resolvedProvider === "ollama") {
      return await tryRegistryClient();
    }

    // 2. OAuth CLI (Claude / OpenAI) -> OpenCode -> Antigravity Live
    try {
      const statuses = await ctx.deps.providerConnection.getProvidersStatus(false);
      const statusForProvider = statuses.find((s) => s.provedor === resolvedProvider);

      if (
        (resolvedProvider === "claude" || resolvedProvider === "openai") &&
        statusForProvider?.conectado &&
        statusForProvider.modo_conexao !== "nenhum"
      ) {
        const res = await ctx.deps.providerConnection.getCliOAuthService().executeTurn({
          provedor: resolvedProvider,
          modelId: model,
          systemPrompt: params.systemPrompt || undefined,
          messages: [{ role: "user", text: params.prompt }],
        });
        recordChatTurnUsage(ctx.deps.db, {
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
        const res = await ctx.deps.providerConnection.getOpenCodeService().executePrompt({
          modelId: model,
          systemPrompt: params.systemPrompt || undefined,
          messages: [{ role: "user", text: params.prompt }],
          agentId: params.agentId,
        });
        return { text: res.text, modelUsed: model, providerUsed: "opencode" };
      }

      const agStatus = statuses.find((s) => s.provedor === "gemini");
      if (resolvedProvider === "gemini" && agStatus?.conectado && agStatus.modo_conexao !== "api_key") {
        const res = await ctx.deps.providerConnection.getAntigravityService().executeCodeAssistGenerate({
          model,
          systemPrompt: params.systemPrompt || undefined,
          messages: [{ role: "user", text: params.prompt }],
          imagePaths: params.imagePaths,
          agentId: params.agentId,
        });
        recordChatTurnUsage(ctx.deps.db, {
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


export function interpolateWorkflowBrandPlaceholders(
  ctx: WorkflowEngineRuntimeContext,
raw: string): string {
    const brand = getBrandIdentity(ctx.deps.providerConnection);
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

export function createWorkflowAgentTaskForStep(
  ctx: WorkflowEngineRuntimeContext,
params: {
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

    return ctx.deps.queue.enqueueTask({
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
