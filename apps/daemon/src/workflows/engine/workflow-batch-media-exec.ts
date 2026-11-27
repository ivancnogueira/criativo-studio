import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_WORKFLOW_MEDIA_BATCH,
  normalizeNodeKind,
  type WorkflowBatchVariantResult,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowStepRecord,
} from "@criativo/contracts";
import { generateImageTool } from "../../engine/tools/generate-image.ts";
import { executeRemotionRender } from "../../engine/tools/remotion-bridge.ts";
import { WorkflowValidationError } from "../workflow-store.ts";
import { buildNodeInputs, soloInputs, type WorkflowBuiltInputs } from "../workflow-walk.ts";
import {
  collectUpstreamStructuredVariables,
  interpolateWorkflowVariables,
} from "../workflow-structured-fields.ts";
import { safeJsonParse, type WorkflowEngineRuntimeContext } from "./workflow-engine-types.ts";

function variantToArtifactEntry(v: WorkflowBatchVariantResult): Record<string, unknown> {
  return {
    ...(v.relPath ? { path: v.relPath, relPath: v.relPath } : {}),
    ...(v.arquivoId ? { arquivoId: v.arquivoId } : {}),
    ...(v.mimeType ? { mimeType: v.mimeType } : {}),
    slotIndex: v.slotIndex,
    status: v.status,
    ...(v.error ? { error: v.error } : {}),
    ...(v.providerUsed ? { providerUsed: v.providerUsed } : {}),
    ...(v.modelUsed ? { modelUsed: v.modelUsed } : {}),
  };
}

export function parseVariantsFromStep(step: WorkflowStepRecord): WorkflowBatchVariantResult[] {
  const raw = safeJsonParse<unknown[]>(step.artefatos_json, []);
  if (!Array.isArray(raw)) return [];
  const results: WorkflowBatchVariantResult[] = [];

  raw.forEach((item, idx) => {
    if (typeof item === "string" && item.trim()) {
      results.push({
        slotIndex: idx,
        status: "done",
        relPath: item.trim(),
      });
      return;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const slotIndex =
        typeof obj.slotIndex === "number" && Number.isInteger(obj.slotIndex)
          ? obj.slotIndex
          : idx;
      const status =
        obj.status === "pending" ||
        obj.status === "running" ||
        obj.status === "done" ||
        obj.status === "failed"
          ? obj.status
          : obj.path || obj.caminho
            ? "done"
            : "failed";
      const relPath =
        typeof obj.path === "string"
          ? obj.path
          : typeof obj.caminho === "string"
            ? obj.caminho
            : typeof obj.relPath === "string"
              ? obj.relPath
              : undefined;
      results.push({
        slotIndex,
        status,
        ...(typeof obj.arquivoId === "string"
          ? { arquivoId: obj.arquivoId }
          : typeof obj.arquivo_id === "string"
            ? { arquivoId: obj.arquivo_id }
            : {}),
        ...(relPath ? { relPath } : {}),
        ...(typeof obj.mimeType === "string"
          ? { mimeType: obj.mimeType }
          : typeof obj.mime_type === "string"
            ? { mimeType: obj.mime_type }
            : {}),
        ...(typeof obj.error === "string" ? { error: obj.error } : {}),
        ...(typeof obj.providerUsed === "string" ? { providerUsed: obj.providerUsed } : {}),
        ...(typeof obj.modelUsed === "string" ? { modelUsed: obj.modelUsed } : {}),
      });
    }
  });

  return results.sort((a, b) => a.slotIndex - b.slotIndex);
}

async function runSingleMediaSlot(
  ctx: WorkflowEngineRuntimeContext,
  params: {
    kind: "gerar_imagem" | "render_video";
    node: WorkflowNo;
    cfg: Record<string, unknown>;
    promptFinal: string;
    inputs: WorkflowBuiltInputs;
    slotIndex: number;
  }
): Promise<WorkflowBatchVariantResult> {
  const { kind, node, cfg, promptFinal, inputs, slotIndex } = params;
  const mediaProviderId =
    node.mediaProviderId ??
    (typeof cfg.mediaProviderId === "string" ? cfg.mediaProviderId : undefined);
  const mediaModelId =
    node.mediaModelId ??
    (typeof cfg.mediaModelId === "string" ? cfg.mediaModelId : undefined);

  if (kind === "gerar_imagem") {
    const aspect =
      cfg.aspectRatio === "9:16" || cfg.aspectRatio === "1:1" || cfg.aspectRatio === "3:4"
        ? cfg.aspectRatio
        : "3:4";
    const safeRefs = inputs.mediaInputs
      .filter((m) => m.portType === "image")
      .map((m) => {
        try {
          return ctx.resolveWithinRoot(m.path);
        } catch {
          return null;
        }
      })
      .filter((p): p is string => Boolean(p && existsSync(p)));

    const arquivoId = `arte-wf-${randomUUID().slice(0, 8)}-v${slotIndex}`;
    const relPath = `saidas/artes/${arquivoId}.png`;
    const outputPath = resolve(ctx.deps.workspaceRoot, relPath);
    mkdirSync(resolve(outputPath, ".."), { recursive: true });

    const hasImgApiKey =
      Boolean(ctx.deps.vault.getSecret("gemini_api_key")) ||
      Boolean(ctx.deps.vault.getSecret("google_api_key")) ||
      Boolean(ctx.deps.vault.getSecret("openai_api_key")) ||
      Boolean(ctx.deps.vault.getSecret("fal_api_key"));

    let providerUsed = mediaProviderId;
    let modelUsed = mediaModelId;

    if (ctx.deps.mediaCatalog && (mediaProviderId || hasImgApiKey)) {
      const catRes = await ctx.deps.mediaCatalog.executeImageStep({
        providerId: mediaProviderId,
        modelId: mediaModelId,
        generateParams: {
          aspect_ratio: aspect,
          prompt: promptFinal,
          image_paths: safeRefs,
          output_path: outputPath,
        },
      });
      providerUsed = catRes.providerUsed ?? providerUsed;
      modelUsed = catRes.modelUsed ?? modelUsed;
    } else if (hasImgApiKey) {
      const imgRes = await generateImageTool(
        {
          aspect_ratio: aspect,
          prompt: promptFinal,
          image_paths: safeRefs,
          output_path: outputPath,
        },
        { vault: ctx.deps.vault, fetchImpl: ctx.deps.fetchImpl }
      );
      providerUsed = imgRes.engine_used ?? providerUsed;
      modelUsed = imgRes.model_used ?? modelUsed;
    } else {
      const agRes = await ctx.deps.providerConnection
        .getAntigravityService()
        .executeCodeAssistGenerate({
          model: mediaModelId || "gemini-3.1-flash-image",
          messages: [{ role: "user", text: promptFinal }],
          generateImage: true,
          imagePaths: safeRefs,
        });
      if (!agRes.images || agRes.images.length === 0) {
        throw new Error("Nenhuma imagem retornada pelo provedor de geração.");
      }
      writeFileSync(outputPath, Buffer.from(agRes.images[0].dataBase64, "base64"));
      providerUsed = "antigravity";
      modelUsed = agRes.modelUsed;
    }

    const sizeBytes = existsSync(outputPath) ? readFileSync(outputPath).length : 0;
    ctx.deps.db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
         VALUES (?, ?, ?, 'image/png', ?, 'gerado', NULL, NULL, ?);`
      )
      .run(arquivoId, `${arquivoId}.png`, relPath, sizeBytes, new Date().toISOString());

    return {
      slotIndex,
      status: "done",
      arquivoId,
      relPath,
      mimeType: "image/png",
      ...(providerUsed ? { providerUsed } : {}),
      ...(modelUsed ? { modelUsed } : {}),
    };
  }

  // render_video
  const audioInput = inputs.mediaInputs.find(
    (m) => m.portType === "file" && /\.(mp3|wav|m4a|ogg)$/i.test(m.path)
  );
  const composicao =
    cfg.composicao === "ReelsTalkingHead" ? "ReelsTalkingHead" : "ReelsFaceless";
  const arquivoId = `video-wf-${randomUUID().slice(0, 8)}-v${slotIndex}`;
  const relPath = `saidas/videos/${arquivoId}.mp4`;
  const outputPath = resolve(ctx.deps.workspaceRoot, relPath);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  const audioAbs = audioInput
    ? ctx.resolveWithinRoot(audioInput.path)
    : typeof cfg.audioPath === "string"
      ? ctx.resolveWithinRoot(cfg.audioPath)
      : "";

  const imgPaths = inputs.mediaInputs
    .filter((m) => m.portType === "image")
    .map((m) => m.path);

  if (ctx.deps.mediaCatalog) {
    await ctx.deps.mediaCatalog.executeVideoStep({
      providerId: mediaProviderId,
      modelId: mediaModelId,
      videoParams: {
        prompt: promptFinal || "Vídeo Reels profissional",
        output_path: outputPath,
        image_paths: imgPaths,
      },
      remotionArgs: {
        composicao,
        audio_path: audioAbs,
        output_path: outputPath,
        remotionProjectDir: ctx.deps.workspaceRoot,
        props: {
          roteiroTexto: promptFinal,
          imagens: imgPaths,
        },
      },
    });
  } else {
    await executeRemotionRender({
      composicao,
      audio_path: audioAbs,
      output_path: outputPath,
      remotionProjectDir: ctx.deps.workspaceRoot,
      props: {
        roteiroTexto: promptFinal,
        imagens: imgPaths,
      },
    });
  }

  const sizeBytes = existsSync(outputPath) ? readFileSync(outputPath).length : 0;
  ctx.deps.db.connection
    .prepare(
      `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
       VALUES (?, ?, ?, 'video/mp4', ?, 'video', NULL, NULL, ?);`
    )
    .run(arquivoId, `${arquivoId}.mp4`, relPath, sizeBytes, new Date().toISOString());

  return {
    slotIndex,
    status: "done",
    arquivoId,
    relPath,
    mimeType: "video/mp4",
    ...(mediaProviderId ? { providerUsed: mediaProviderId } : {}),
    ...(mediaModelId ? { modelUsed: mediaModelId } : {}),
  };
}

/**
 * Executa geração em lote (1 a 4 variações simultâneas) para `gerar_imagem` e `render_video`.
 */
export async function executeBatchMediaNode(
  ctx: WorkflowEngineRuntimeContext,
  params: {
    kind: "gerar_imagem" | "render_video";
    step: WorkflowStepRecord;
    node: WorkflowNo;
    cfg: Record<string, unknown>;
    inputs: WorkflowBuiltInputs;
    promptFinal: string;
    signal?: AbortSignal;
  }
): Promise<void> {
  const { kind, step, node, cfg, inputs, promptFinal, signal } = params;
  const rawCount = Number(node.batchCount ?? cfg.batchCount ?? 1);
  const batchCount = Math.max(
    1,
    Math.min(MAX_WORKFLOW_MEDIA_BATCH, Math.trunc(Number.isFinite(rawCount) ? rawCount : 1))
  );

  const runBatch = async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: batchCount }, (_, slotIndex) =>
        runSingleMediaSlot(ctx, { kind, node, cfg, promptFinal, inputs, slotIndex })
      )
    );
    return settled.map<WorkflowBatchVariantResult>((entry, slotIndex) => {
      if (entry.status === "fulfilled") {
        return entry.value;
      }
      return {
        slotIndex,
        status: "failed",
        error:
          entry.reason instanceof Error
            ? entry.reason.message
            : String(entry.reason ?? "Falha na geração da variação."),
      };
    });
  };

  const variants =
    batchCount === 1
      ? await ctx.mediaLock.withLock(runBatch, signal)
      : await runBatch();

  const succeeded = variants.filter((v) => v.status === "done" && v.arquivoId);
  if (succeeded.length === 0) {
    const firstError = variants.find((v) => v.error)?.error || "Todas as variações falharam.";
    throw new Error(firstError);
  }

  const preferredIdx =
    typeof node.selectedVariantIndex === "number" ? node.selectedVariantIndex : 0;
  const primary =
    variants.find((v) => v.slotIndex === preferredIdx && v.status === "done") ?? succeeded[0];

  const artifactsPayload =
    batchCount === 1 && succeeded[0]?.relPath
      ? [succeeded[0].relPath]
      : variants.map(variantToArtifactEntry);

  const outputTipo: WorkflowPortType = kind === "gerar_imagem" ? "image" : "file";
  const updated = ctx.deps.store.updateStep(step.step_id, {
    status: "done",
    output: primary.arquivoId ?? primary.relPath ?? null,
    outputTipo,
    artefatos: artifactsPayload,
  });
  if (updated) ctx.emitStepUpdated(updated);
}

/**
 * Reexecuta individualmente um slot específico (0..3) sem refazer as variações concluídas.
 */
export async function retryBatchMediaVariant(
  ctx: WorkflowEngineRuntimeContext,
  stepId: string,
  slotIndex: number
): Promise<{ step: WorkflowStepRecord; variants: WorkflowBatchVariantResult[] }> {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= MAX_WORKFLOW_MEDIA_BATCH) {
    throw new WorkflowValidationError(
      `slotIndex inválido (${slotIndex}). Esperado inteiro entre 0 e ${MAX_WORKFLOW_MEDIA_BATCH - 1}.`,
      400
    );
  }

  const step = ctx.deps.store.getStep(stepId);
  if (!step) {
    throw new WorkflowValidationError(`Etapa não encontrada: ${stepId}`, 404);
  }

  const kind = normalizeNodeKind(step.kind as WorkflowNo["tipo"]);
  if (kind !== "gerar_imagem" && kind !== "render_video") {
    throw new WorkflowValidationError(
      `Retry de variação individual suportado apenas em 'gerar_imagem' e 'render_video'.`,
      400
    );
  }

  let graphNos: WorkflowNo[] = [];
  let graphArestas: ReturnType<WorkflowEngineRuntimeContext["parseRunGraph"]>["arestas"] = [];
  let stepsByNode = new Map<string, WorkflowStepRecord>();

  if (step.run_id) {
    const detail = ctx.deps.store.getRunDetail(step.run_id);
    if (detail) {
      const parsed = ctx.parseRunGraph(detail.run);
      graphNos = parsed.nos;
      graphArestas = parsed.arestas;
      stepsByNode = ctx.buildLatestStepsMap(detail.steps);
    }
  } else {
    const visual = ctx.deps.store.getWorkflowVisual(step.workflow_id);
    if (visual) {
      graphNos = visual.nos;
      graphArestas = visual.arestas;
      stepsByNode = ctx.deps.store.listLatestDoneStepsByNode(step.workflow_id).stepsByNode;
    }
  }

  const node = graphNos.find((n) => n.id === step.node_id);
  if (!node) {
    throw new WorkflowValidationError(`Nó '${step.node_id}' não encontrado no grafo.`, 404);
  }

  const cfg = node.config ?? {};
  const inputs = step.run_id
    ? buildNodeInputs({
        node,
        nos: graphNos,
        arestas: graphArestas,
        latestSteps: stepsByNode,
        loops: new Set<string>(),
      })
    : soloInputs({
        node,
        nos: graphNos,
        arestas: graphArestas,
        latestDoneSteps: stepsByNode,
      });

  const upstreamVars = collectUpstreamStructuredVariables(
    node,
    graphArestas,
    stepsByNode,
    inputs.inputText
  );
  const rawPromptBase =
    node.prompt ?? (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ?? "";
  const interpolated = interpolateWorkflowVariables(rawPromptBase, upstreamVars, inputs.inputText);
  const promptFinal =
    interpolated && inputs.inputText && !rawPromptBase.includes("{{")
      ? `${interpolated}\n\n${inputs.inputText}`
      : interpolated || inputs.inputText || "Arte visual profissional em estética limpa";

  const existingVariants = parseVariantsFromStep(step);
  let nextSlotResult: WorkflowBatchVariantResult;
  try {
    nextSlotResult = await runSingleMediaSlot(ctx, {
      kind,
      node,
      cfg,
      promptFinal,
      inputs,
      slotIndex,
    });
  } catch (err) {
    nextSlotResult = {
      slotIndex,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const merged = new Map<number, WorkflowBatchVariantResult>();
  for (const v of existingVariants) merged.set(v.slotIndex, v);
  merged.set(slotIndex, nextSlotResult);
  const nextVariants = Array.from(merged.values()).sort((a, b) => a.slotIndex - b.slotIndex);

  const preferredIdx =
    typeof node.selectedVariantIndex === "number" ? node.selectedVariantIndex : 0;
  const primary =
    nextVariants.find((v) => v.slotIndex === preferredIdx && v.status === "done") ??
    nextVariants.find((v) => v.status === "done");

  const updated =
    ctx.deps.store.updateStep(step.step_id, {
      status: primary ? "done" : "failed",
      output: primary ? primary.arquivoId ?? primary.relPath ?? step.output : step.output,
      artefatos: nextVariants.map(variantToArtifactEntry),
      erro: primary ? null : nextSlotResult.error ?? "Falha ao retentar variação.",
    }) ?? step;

  ctx.emitStepUpdated(updated);
  return { step: updated, variants: nextVariants };
}
